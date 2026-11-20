'use strict';
// The builder adapter. A job names its builder ("native" = our delegated agents, "craft-anything" = the craft-anything
// CLI, which studies a target or a written request, builds a project with Claude Code, checks it and refines it).
// This module only prepares, runs and reads a craft-anything build under limits we set; it never loosens them:
//   - the CLI always runs --unattended (questions take the first choice, approvals are refused);
//   - --allow-run (the flag that lets tools run code) needs the job's intake to have tagged runs-generated-code, which
//     raises the risk to medium and brings the security reviewer;
//   - a rebuild of someone else's product is --clean-room unless Deep mode is asked for, with a recorded reason;
//   - --generate-assets spends money, so it is never passed;
//   - the build happens outside the repo; only app/ is copied in, and only to a path you name.
// The result enters the normal pipeline: the verify gate, review and approval still apply to whatever it built.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const jobs = require('./job');

const DEFAULT_BINARY = 'craft-anything-cli';
const MAX_ROUNDS = 5;
const MAX_REQUEST_CHARS = 8000;
const SCAN_SKIP_DIRS = new Set(['node_modules', 'target', '.git', 'dist', 'build']);
const SCAN_SKIP_EXT = /\.(?:png|jpe?g|gif|webp|ico|bmp|svg|woff2?|ttf|otf|eot|mp[34]|webm|ogg|wav|zip|gz|wasm|bin|pdf|lock)$/i;
const SCAN_MAX_BYTES = 1_000_000;
const SCAN_MAX_HITS = 50;

const buildsRoot = (projectDir, env = process.env) => path.resolve(projectDir, env.HARNESS_BUILDS_DIR || '.harness/builds');
const folderFor = (projectDir, id, env) => path.join(buildsRoot(projectDir, env), id);
const binaryFrom = (env = process.env) => env.CRAFT_ANYTHING_CLI || DEFAULT_BINARY;

// The command for one build, as an argument list (never a shell string). Throws when the job may not use this builder.
function buildCommand(job, { projectDir, env = process.env, request, rounds = 2, buildWith = '', backend = '', allowRun = false, deep = false, deepReason = '', generateAssets = false }) {
  if (job.builder !== 'craft-anything') throw new Error(`Job ${job.id} uses the ${job.builder} builder, not craft-anything.`);
  if (job.status !== 'active') throw new Error(`Job ${job.id} is ${job.status}.`);
  if (job.stage !== 'build') throw new Error(`Job ${job.id} is at ${job.stage}: advance it to build first (that needs a passing ref-check red or a waiver).`);
  if (generateAssets) throw new Error('--generate-assets spends money (a fal.ai key, a paid budget). It is a spend decision for the owner, so the adapter never passes it.');
  if (typeof request !== 'string' || !request.trim()) throw new Error('A build needs a request (what to make).');
  if (request.length > MAX_REQUEST_CHARS) throw new Error(`The request is ${request.length} characters; the limit is ${MAX_REQUEST_CHARS}. Put the detail in the spec and summarise.`);
  if (!Number.isInteger(rounds) || rounds < 1 || rounds > MAX_ROUNDS) throw new Error(`rounds must be an integer from 1 to ${MAX_ROUNDS}.`);
  const rebuild = job.kind === 'rebuild';
  if (rebuild && !String(job.source ?? '').trim()) throw new Error('A rebuild job needs a source (a web address or an absolute path to the original).');
  if (rebuild && !(job.requestedBy && job.acknowledgement)) throw new Error('A rebuild job needs its requester and acknowledgement recorded.');
  if (allowRun && !job.surfaces.includes('runs-generated-code')) {
    throw new Error('--allow-run lets the build run generated code. Intake must tag the job runs-generated-code first (it raises the risk to medium and adds the security reviewer).');
  }
  if (deep && !rebuild) throw new Error('--deep is for rebuilds of an existing target.');
  if (deep && !deepReason.trim()) throw new Error('Deep mode reads the original\'s code and files. Give a reason (it is recorded).');
  const folder = folderFor(projectDir, job.id, env);
  const argv = ['rebuild', rebuild ? job.source : '-', request.trim(), '--project-folder', folder, '--rounds', String(rounds), '--unattended'];
  if (buildWith) argv.push('--build-with', buildWith);
  if (backend) argv.push('--backend', backend);
  if (allowRun) argv.push('--allow-run');
  if (rebuild) argv.push(deep ? '--deep' : '--clean-room');
  return { binary: binaryFrom(env), argv, folder, mode: rebuild ? (deep ? 'deep' : 'clean-room') : 'build', allowRun };
}

const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };

// What a finished (or stopped) build left behind, from craft.json and usage.json. Decisions read typed fields only.
function readOutcome(folder) {
  const craft = readJson(path.join(folder, 'craft.json'));
  if (!craft) return { state: 'unreadable', status: null, checks: { total: 0, passed: 0, failed: 0, unknown: 0 }, similarity: null, app: false, usage: null, note: `No readable craft.json in ${folder}.` };
  const checks = Array.isArray(craft.checks) ? craft.checks : [];
  // Only the latest round counts: an early failed round that a later round fixed is not a failure of the build.
  const lastRound = checks.reduce((m, c) => Math.max(m, c.round ?? 0), 0);
  const latest = checks.filter((c) => (c.round ?? 0) === lastRound);
  const tally = { total: latest.length, passed: latest.filter((c) => c.passed === true).length, failed: latest.filter((c) => c.passed === false).length, unknown: latest.filter((c) => c.passed == null).length };
  const sims = latest.map((c) => c.similarity).filter((n) => typeof n === 'number');
  const status = typeof craft.status === 'string' ? craft.status : null;
  let state = { ready: 'ready', needs_you: 'needs-you', stopped: 'stopped' }[status] ?? 'incomplete';
  if (state === 'ready' && tally.failed > 0) state = 'not-ready';
  const usageRaw = readJson(path.join(folder, 'usage.json'));
  const usage = usageRaw ? {
    tokens: (usageRaw.input_tokens ?? 0) + (usageRaw.output_tokens ?? 0),
    incomplete: Boolean(usageRaw.tokens_incomplete),
    workMs: usageRaw.work_ms ?? 0,
    costUsd: usageRaw.cost_usd ?? 0,
    apiBilledUsd: usageRaw.api_billed_usd ?? 0,
  } : null;
  return {
    state, status, stack: craft.stack ?? '', checks: tally, similarity: sims.length ? Math.min(...sims) : null,
    app: fs.existsSync(path.join(folder, 'app')), usage, questions: Array.isArray(craft.questions) ? craft.questions.length : 0,
    note: typeof craft.note === 'string' ? craft.note : '',
  };
}

// A clean-room rebuild must not carry the original's name, logo text or copy. Looks for the terms you give in the
// text files of app/. It finds literal terms only; it is a tripwire, not a legal review.
function scanForbidden(appDir, terms) {
  const wanted = terms.map((t) => t.trim()).filter(Boolean);
  if (!wanted.length || !fs.existsSync(appDir)) return [];
  const lower = wanted.map((t) => t.toLowerCase());
  const hits = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (hits.length >= SCAN_MAX_HITS) return;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) { if (!SCAN_SKIP_DIRS.has(entry.name)) walk(abs); continue; }
      if (!entry.isFile() || SCAN_SKIP_EXT.test(entry.name) || fs.statSync(abs).size > SCAN_MAX_BYTES) continue;
      const lines = fs.readFileSync(abs, 'utf8').split('\n');
      lines.forEach((line, i) => {
        const low = line.toLowerCase();
        lower.forEach((t, k) => { if (low.includes(t) && hits.length < SCAN_MAX_HITS) hits.push({ file: path.relative(appDir, abs), line: i + 1, term: wanted[k] }); });
      });
    }
  };
  walk(appDir);
  return hits;
}

// Records the build as an agent run on the job: tokens, time, and an outcome that is never assumed to be a success.
function recordOutcome(jobsRoot, id, outcome, { forbiddenHits = 0 } = {}) {
  const ok = outcome.state === 'unreadable' ? null : outcome.state === 'ready' && forbiddenHits === 0;
  const parts = [`craft-anything: ${outcome.state}`];
  if (outcome.checks.total) parts.push(`${outcome.checks.passed}/${outcome.checks.total} checks passed`);
  if (outcome.usage && outcome.usage.incomplete) parts.push('token counts incomplete');
  if (forbiddenHits) parts.push(`${forbiddenHits} forbidden term hit(s)`);
  return jobs.recordAgent(jobsRoot, id, {
    agent: 'craft-anything', phase: 'build', task: parts.join('; '),
    tokens: outcome.usage ? outcome.usage.tokens : null, durationMs: outcome.usage ? outcome.usage.workMs : null, ok, source: 'builder',
  });
}

// The default runner: no stdin, a deadline, the whole process group killed on timeout, the output tail kept.
function spawnRunner(binary, argv, { timeoutMs, cwd }) {
  return new Promise((resolve) => {
    let output = '';
    let settled = false;
    const done = (value) => { if (!settled) { settled = true; clearTimeout(timer); resolve(value); } };
    let child;
    try { child = spawn(binary, argv, { cwd, detached: true, stdio: ['ignore', 'pipe', 'pipe'] }); } catch (err) { done({ code: null, output: err.message, timedOut: false, missing: err.code === 'ENOENT' }); return; }
    const collect = (c) => { output = (output + c).slice(-20_000); };
    child.stdout.setEncoding('utf8').on('data', collect);
    child.stderr.setEncoding('utf8').on('data', collect);
    const kill = () => { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* gone */ } };
    const timer = setTimeout(() => { kill(); done({ code: null, output, timedOut: true, missing: false }); }, timeoutMs);
    child.on('error', (err) => done({ code: null, output: `${output}\n${err.message}`, timedOut: false, missing: err.code === 'ENOENT' }));
    child.on('close', (code) => { kill(); done({ code, output, timedOut: false, missing: false }); });
  });
}

// Copies the built app/ into the repo at a path you name. Refuses a destination outside the project or one that has files.
function collect(projectDir, folder, to) {
  const app = path.join(folder, 'app');
  if (!fs.existsSync(app)) throw new Error(`The build has no app/ folder at ${folder}.`);
  const dest = path.resolve(projectDir, to);
  const rel = path.relative(projectDir, dest);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`--to must be a folder inside the project, not ${to}.`);
  if (fs.existsSync(dest) && fs.readdirSync(dest).length > 0) throw new Error(`${to} already has files; collect into an empty or new folder.`);
  let count = 0;
  const copy = (from, target) => {
    fs.mkdirSync(target, { recursive: true });
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
      if (SCAN_SKIP_DIRS.has(entry.name) && entry.isDirectory()) continue;
      const src = path.join(from, entry.name);
      const dst = path.join(target, entry.name);
      if (entry.isDirectory()) copy(src, dst);
      else if (entry.isFile()) { fs.copyFileSync(src, dst); count += 1; }
    }
  };
  copy(app, dest);
  return { dest: rel, files: count };
}

async function run(plan, { timeoutMs = 25 * 60_000, runner = spawnRunner } = {}) {
  fs.mkdirSync(path.dirname(plan.folder), { recursive: true });
  const result = await runner(plan.binary, plan.argv, { timeoutMs, cwd: path.dirname(plan.folder) });
  if (result.missing) {
    throw new Error(`${plan.binary} was not found. Build it (cargo build --release -p craft-anything-cli in a craft-anything checkout, about 7 minutes) and set CRAFT_ANYTHING_CLI to its path.`);
  }
  return result;
}

module.exports = { buildCommand, readOutcome, scanForbidden, recordOutcome, collect, run, spawnRunner, buildsRoot, folderFor, MAX_ROUNDS, MAX_REQUEST_CHARS };
