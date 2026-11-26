'use strict';
// One command that sets up a product repository (spec #108): harness, the two plugins, the labels,
// the repository docs, and a report on the cloud environment. Each row ends as `done` (this run did
// it), `already there`, `needs you` (with a link and one action), or `missing` (check mode only).
// GitHub is reached only through an injected client; the gh client below only lists and creates
// repository labels. It never applies a label to an issue: the gate labels are the owner's to apply.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { install } = require('./install');

const LABELS = [
  { name: 'spec-approved', color: '0E8A16', description: 'Owner gate: spec approved. Applied by the owner only.' },
  { name: 'accepted', color: '1D76DB', description: 'Owner gate: result accepted against the spec. Applied by the owner only.' },
  { name: 'afk', color: 'C2E0C6', description: 'Ticket an agent can finish alone' },
  { name: 'hitl', color: 'F9D0C4', description: 'Ticket that needs a human' },
  { name: 'needs-triage', color: 'FBCA04', description: 'Maintainer needs to evaluate this issue' },
  { name: 'needs-info', color: 'D4C5F9', description: 'Waiting on the reporter for more information' },
  { name: 'wontfix', color: 'FFFFFF', description: 'Will not be actioned' },
  { name: 'needs-fable', color: '5319E7', description: 'Owner approval for a fable run' },
];
const GATE_LABELS = ['spec-approved', 'accepted'];
const MARKETPLACE = 'jyeann';
const PLUGINS = [
  { id: 'product-team', title: 'Plugin product-team (agents, skills, commands)' },
  { id: 'mattpocock-skills', title: 'Plugin mattpocock-skills (spec, tickets, prototype)' },
];
const DOCS = [
  ['docs/agents/issue-tracker.md', 'issue-tracker.md'],
  ['docs/agents/triage-labels.md', 'triage-labels.md'],
  ['docs/agents/domain.md', 'domain.md'],
  ['GLOSSARY.md', 'GLOSSARY.md'],
  ['docs/adr/README.md', 'adr-README.md'],
];
const ENV_FILE = 'docs/agents/environment.md';
const ENV_LINE = /^Cloud environment: (.+)$/m;
const ENV_DOCS = 'https://code.claude.com/docs/en/claude-code-on-the-web';
const SKIP_IN_HARNESS = ['test', 'fixtures'];

const exists = (p) => fs.existsSync(p);
const real = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
const hash = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function parseRepo(url) {
  const m = /([^/:]+)\/([^/]+?)(?:\.git)?\/?$/.exec(String(url || '').trim());
  return m ? `${m[1]}/${m[2]}` : null;
}

function repoFromGit(dir) {
  const r = spawnSync('git', ['-C', dir, 'remote', 'get-url', 'origin'], { encoding: 'utf8' });
  return r.status === 0 ? parseRepo(r.stdout) : null;
}

// runner(cmd, args) -> { status, stdout, stderr, error }. Only `gh api repos/<repo>/labels` is ever called.
function ghClient(runner = (cmd, args) => spawnSync(cmd, args, { encoding: 'utf8', timeout: 30000 })) {
  const call = (args) => {
    const r = runner('gh', ['api', ...args]);
    if (r.error) return { ok: false, message: r.error.message };
    if (r.status !== 0) return { ok: false, message: (String(r.stderr || '').trim().split('\n')[0]) || `gh exited ${r.status}` };
    return { ok: true, stdout: String(r.stdout || '') };
  };
  return {
    listLabels(repo) {
      const r = call(['--paginate', `repos/${repo}/labels`, '--jq', '.[].name']);
      return r.ok ? { ok: true, names: r.stdout.split('\n').map((s) => s.trim()).filter(Boolean) } : r;
    },
    createLabel(repo, label) {
      const r = call(['--method', 'POST', `repos/${repo}/labels`,
        '-f', `name=${label.name}`, '-f', `color=${label.color}`, '-f', `description=${label.description}`]);
      return r.ok ? { ok: true } : r;
    },
  };
}

// The harness is current when a dry-run install would change no setting, rule or plan, and every
// harness file in the target equals the source's.
function harnessCurrent(src, targetDir, dry) {
  const rest = dry.actions.filter((a) => !a.startsWith('.claude/harness:'));
  if (!rest.every((a) => /: 0 file\(s\) written|already up to date/.test(a))) return false;
  const from = path.join(src, 'harness');
  const to = path.join(targetDir, '.claude', 'harness');
  const walk = (rel) => fs.readdirSync(path.join(from, rel), { withFileTypes: true }).every((e) => {
    const r = path.join(rel, e.name);
    if (SKIP_IN_HARNESS.includes(r)) return true;
    if (e.isDirectory()) return walk(r);
    return exists(path.join(to, r)) && hash(path.join(to, r)) === hash(path.join(from, r));
  });
  return walk('');
}

function harnessRow(src, targetDir, check) {
  const row = { id: 'harness', title: 'Harness (guards, verify gate, rules, settings)' };
  const dry = install({ sourceClaudeDir: src, targetDir, dryRun: true });
  if (!dry.ok) return { ...row, status: 'needs you', detail: dry.message, action: dry.message.includes('harness.js off') ? 'Finish the run or run `node .claude/harness/bin/harness.js off`, then re-run.' : 'Fix the problem above, then re-run.' };
  if (harnessCurrent(src, targetDir, dry)) return { ...row, status: 'already there' };
  if (check) return { ...row, status: 'missing', detail: 'install or update with this command' };
  const res = install({ sourceClaudeDir: src, targetDir });
  return { ...row, status: 'done', detail: `installed (${res.actions.length} change(s)); review \`git diff\` and commit it` };
}

function readSettings(file) {
  if (!exists(file)) return { ok: true, settings: {} };
  try { return { ok: true, settings: JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch (err) { return { ok: false, message: `${file} is not valid JSON (${err.message})` }; }
}

function pluginRow(plugin, src, targetDir, check) {
  const row = { id: plugin.id, title: plugin.title };
  const file = path.join(targetDir, '.claude', 'settings.json');
  const read = readSettings(file);
  if (!read.ok) return { ...row, status: 'needs you', detail: read.message, action: 'Fix .claude/settings.json, then re-run.' };
  const s = read.settings;
  const key = `${plugin.id}@${MARKETPLACE}`;
  const enabled = (s.enabledPlugins || {})[key];
  const known = Boolean((s.extraKnownMarketplaces || {})[MARKETPLACE]);
  if (enabled === false) {
    return { ...row, status: 'needs you', detail: `${key} is switched off in .claude/settings.json`, action: `Set enabledPlugins."${key}" to true in .claude/settings.json if this product should use it, then re-run.` };
  }
  if (enabled === true && known) return { ...row, status: 'already there' };
  if (check) return { ...row, status: 'missing', detail: `${key} is not enabled in .claude/settings.json` };
  const srcSettings = readSettings(path.join(src, 'settings.json'));
  const market = (srcSettings.ok && (srcSettings.settings.extraKnownMarketplaces || {})[MARKETPLACE])
    || { source: { source: 'github', repo: 'jyeann/claude-setup' } };
  const out = { ...s, extraKnownMarketplaces: { [MARKETPLACE]: market, ...(s.extraKnownMarketplaces || {}) }, enabledPlugins: { ...(s.enabledPlugins || {}), [key]: true } };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(out, null, 2)}\n`);
  return { ...row, status: 'done', detail: `enabled ${key} in .claude/settings.json; plugins load when a session starts, so open a new session here` };
}

function labelsRow(repo, github, check) {
  const row = { id: 'labels', title: 'Labels (owner gates, afk/hitl, triage, needs-fable)' };
  const names = LABELS.map((l) => l.name);
  if (!repo) return { ...row, status: 'needs you', detail: 'no GitHub repository found (no origin remote)', action: 'Re-run with --repo owner/name.' };
  const link = `https://github.com/${repo}/labels`;
  const listed = github.listLabels(repo);
  if (!listed.ok) {
    return { ...row, status: 'needs you', detail: `GitHub not reachable: ${listed.message}`, link, action: `Create the labels ${names.join(', ')} there, or re-run where gh can reach GitHub.` };
  }
  const missing = LABELS.filter((l) => !listed.names.includes(l.name));
  if (missing.length === 0) return { ...row, status: 'already there', link };
  if (check) return { ...row, status: 'missing', detail: `missing: ${missing.map((l) => l.name).join(', ')}`, link };
  const failed = missing.filter((l) => !github.createLabel(repo, l).ok);
  if (failed.length > 0) {
    return { ...row, status: 'needs you', detail: `could not create: ${failed.map((l) => l.name).join(', ')}`, link, action: `Create the labels ${failed.map((l) => l.name).join(', ')} there.` };
  }
  return { ...row, status: 'done', detail: `created: ${missing.map((l) => l.name).join(', ')}`, link };
}

function docsRow(src, targetDir, repo, check) {
  const row = { id: 'docs', title: 'Repository docs (docs/agents/, GLOSSARY.md, docs/adr/)' };
  const missing = DOCS.filter(([to]) => !exists(path.join(targetDir, to)));
  if (missing.length === 0) return { ...row, status: 'already there' };
  const list = missing.map(([to]) => to).join(', ');
  if (check) return { ...row, status: 'missing', detail: `missing: ${list}` };
  for (const [to, from] of missing) {
    const text = fs.readFileSync(path.join(src, 'harness', 'templates', 'repo', from), 'utf8').replaceAll('{{repo}}', repo || '<owner>/<name>');
    fs.mkdirSync(path.dirname(path.join(targetDir, to)), { recursive: true });
    fs.writeFileSync(path.join(targetDir, to), text);
  }
  return { ...row, status: 'done', detail: `wrote ${list}` };
}

// Reported, never created (owner decision on #108): the command records the name the owner gives.
function environmentRow(targetDir, repo, environment, check) {
  const row = { id: 'environment', title: 'Cloud environment (allowed hosts, keys)' };
  const file = path.join(targetDir, ENV_FILE);
  const current = exists(file) ? (ENV_LINE.exec(fs.readFileSync(file, 'utf8')) || [])[1] : undefined;
  const ask = { status: 'needs you', link: ENV_DOCS, action: `Create a cloud environment for ${repo || 'this repository'} (its allowed hosts and keys) in Claude Code on the web, then re-run with --environment <name>.` };
  if (environment !== undefined && !/^[\w .()-]{1,64}$/.test(environment)) return { ...row, ...ask, detail: `"${environment}" is not a valid environment name` };
  if (current && (environment === undefined || environment === current)) return { ...row, status: 'already there', detail: current };
  if (environment === undefined) return { ...row, ...ask, detail: 'no cloud environment recorded; this command does not create one' };
  if (check) return { ...row, status: 'missing', detail: `would record ${environment}` };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `# Cloud environment\n\nThe cloud environment product sessions for this repository run in, named by the owner.\n\nCloud environment: ${environment}\n`);
  return { ...row, status: 'done', detail: `recorded ${environment} in ${ENV_FILE}` };
}

function setupRepo({ sourceClaudeDir, targetDir, repo, github = ghClient(), environment, check = false }) {
  const src = path.resolve(sourceClaudeDir);
  const dir = path.resolve(targetDir);
  if (!exists(dir) || !fs.statSync(dir).isDirectory()) return { ok: false, message: `${dir} is not a directory`, rows: [] };
  if (real(path.join(dir, '.claude')) === real(src)) return { ok: false, message: 'the target is this repository (claude-setup); name the product repository', rows: [] };
  const name = repo || repoFromGit(dir);
  const rows = [
    harnessRow(src, dir, check),
    ...PLUGINS.map((p) => pluginRow(p, src, dir, check)),
    labelsRow(name, github, check),
    docsRow(src, dir, name, check),
    environmentRow(dir, name, environment, check),
  ];
  const complete = rows.every((r) => r.status === 'done' || r.status === 'already there');
  return { ok: true, targetDir: dir, repo: name, check, rows, complete };
}

function formatChecklist(res) {
  const width = Math.max(...res.rows.map((r) => r.status.length)) + 2;
  const lines = [`Repository setup${res.check ? ' (check only, nothing written)' : ''}: ${res.targetDir}${res.repo ? ` (${res.repo})` : ''}`];
  for (const r of res.rows) {
    lines.push(`  ${`[${r.status}]`.padEnd(width + 1)} ${r.title}${r.detail ? `: ${r.detail}` : ''}`);
    if (r.status !== 'needs you') continue;
    if (r.link) lines.push(`  ${' '.repeat(width + 1)} -> ${r.link}`);
    lines.push(`  ${' '.repeat(width + 1)} ${r.action}`);
  }
  const owner = res.rows.filter((r) => r.status === 'needs you').length;
  const missing = res.rows.filter((r) => r.status === 'missing').length;
  if (res.complete) lines.push('Checklist complete: a product run can start here.');
  else lines.push([owner && `${owner} row(s) need you.`, missing && `${missing} row(s) missing: run without --check to set them up.`].filter(Boolean).join(' '));
  return lines.join('\n');
}

module.exports = { setupRepo, ghClient, parseRepo, formatChecklist, LABELS, GATE_LABELS, ENV_FILE };
