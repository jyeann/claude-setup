'use strict';
// Whole-pipeline definition of done for orch-product-team. Used as the harness verify command, it makes the
// Stop hook hold the agent until every phase has produced its output and the product passes its own gate,
// so there is no phase in which the agent can end the turn to ask a human.
// Phases are checked in order and the first incomplete one is reported; that message is the agent's next task.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { runVerify } = require('./verify');

const VERIFY_BIN = path.join(__dirname, '..', 'bin', 'verify.js');
const MIN_DOC_CHARS = 300;
const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]s$/;
const OPEN_FINDINGS = /^\s*Open:\s*CRITICAL\s+(\d+)\s*,\s*HIGH\s+(\d+)\s*$/mi;
const AMEND = /^\s*(?:[-*]\s*)?AMEND:?\s+`?([^\s`]+)`?/gm;

const read = (file) => { try { return fs.readFileSync(file, 'utf8'); } catch { return null; } };
const sha = (text) => crypto.createHash('sha256').update(text).digest('hex');
const rel = (root, file) => path.relative(root, file).split(path.sep).join('/');

function filesUnder(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? (e.name === 'node_modules' ? [] : filesUnder(p)) : [p];
  }).sort();
}

// A document counts when it exists and is more than a stub.
function doc(dir, name, label, extra = () => []) {
  const text = read(path.join(dir, name));
  if (text === null) return [`${label} is missing: write ${name}`];
  if (text.trim().length < MIN_DOC_CHARS) return [`${name} is a stub (${text.trim().length} characters): write the real ${label}`];
  return extra(text);
}

const ids = (text, re) => [...new Set(text.match(re) ?? [])];

function planProblems({ product, docs }) {
  const out = [];
  if (read(path.join(product, 'spec.md')) === null) out.push('spec.md is missing in the product directory');
  const raw = read(path.join(product, 'verify.config.json'));
  let config = null;
  if (raw === null) out.push('verify.config.json is missing in the product directory');
  else { try { config = JSON.parse(raw); } catch (err) { out.push(`verify.config.json is not valid JSON: ${err.message}`); } }
  if (config) {
    if (!config.holdout?.command) out.push('verify.config.json has no holdout.command: hidden acceptance tests are part of the gate');
    if (!config.journeys?.command || !config.journeys?.uxFile) out.push('verify.config.json has no journeys.command and journeys.uxFile: the browser walkthrough of ux.md is part of the gate');
  }
  if (!filesUnder(path.join(product, 'acceptance')).some((f) => TEST_FILE.test(f))) out.push('no acceptance tests in acceptance/ (the test author writes them before any builder starts)');
  if (read(path.join(product, 'TASKS.md')) === null && read(path.join(docs, 'TASKS.md')) === null) out.push('TASKS.md is missing (run plan-to-tasks)');
  if (read(path.join(docs, 'decisions.md')) === null) out.push('decisions.md is missing: every decision made without a human is logged there');
  return out;
}

// The files that define "done". Hashed when the plan phase first completes; a later change needs an
// AMEND line in decisions.md, so a wrong test can be corrected by its author without a human, on the record.
function frozenFiles({ root, product, docs }) {
  const single = [path.join(product, 'spec.md'), path.join(product, 'verify.config.json'), path.join(docs, 'ux.md')];
  const trees = ['acceptance', 'holdout'].flatMap((d) => filesUnder(path.join(product, d)));
  return Object.fromEntries([...single, ...trees].filter((f) => fs.existsSync(f)).map((f) => [rel(root, f), sha(fs.readFileSync(f))]));
}

function amendCounts(docs) {
  const counts = {};
  for (const [, file] of (read(path.join(docs, 'decisions.md')) ?? '').matchAll(AMEND)) counts[file] = (counts[file] ?? 0) + 1;
  return counts;
}

function freezeFile({ root, product }) {
  const slug = rel(root, product).replace(/[^A-Za-z0-9_-]+/g, '_') || 'root';
  return path.join(root, '.harness', 'pipeline', `${slug}.json`);
}

function freezeProblems(ctx) {
  const file = freezeFile(ctx);
  const now = frozenFiles(ctx);
  const counts = amendCounts(ctx.docs);
  const saved = read(file);
  let state = saved ? JSON.parse(saved) : { files: now, amends: counts };
  const changed = [...new Set([...Object.keys(now), ...Object.keys(state.files)])].filter((f) => now[f] !== state.files[f]);
  const unexplained = changed.filter((f) => (counts[f] ?? 0) <= (state.amends[f] ?? 0));
  if (unexplained.length === 0) state = { files: now, amends: counts };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`);
  return unexplained.map((f) => `${f} changed after the plan phase froze it. Restore it; if it is wrong, its author (never the builder) fixes it and adds a line "AMEND: ${f} - <reason>" to decisions.md`);
}

async function defaultGate(product) {
  const result = await runVerify(`node "${VERIFY_BIN}"`, { cwd: product, env: { CLAUDE_PROJECT_DIR: product } });
  return { pass: result.pass, output: result.output };
}

const PHASES = [
  ['discover', ({ docs }) => doc(docs, 'brief.md', 'product brief', (t) => (/success criteria/i.test(t) ? [] : ['brief.md has no "Success criteria" section: list user-visible, testable criteria']))],
  ['ux', ({ docs }) => doc(docs, 'ux.md', 'UX design', (t) => {
    if (ids(t, /\bJ\d+\b/g).length === 0) return ['ux.md names no journeys: number them J1, J2, ... so the browser walkthrough can be checked against them'];
    const missing = ids(read(path.join(docs, 'brief.md')) ?? '', /\bSC\d+\b/g).filter((sc) => !new RegExp(`\\b${sc}\\b`).test(t));
    return missing.length ? [`ux.md has no journey for success criteria ${missing.join(', ')}`] : [];
  })],
  ['design', ({ docs }) => doc(docs, 'design.md', 'system design')],
  ['plan', (ctx) => { const p = planProblems(ctx); return p.length ? p : freezeProblems(ctx); }],
  ['build', async (ctx) => {
    const gate = await ctx.runGate(ctx.product);
    ctx.gateOutput = gate.output;
    return gate.pass ? [] : ['the product gate (verify.js: tests, coverage, test quality, holdout, browser journeys, mutation) fails; its output is below'];
  }],
  ['review', ({ docs }) => doc(docs, 'reviews.md', 'review record', (t) => {
    const m = OPEN_FINDINGS.exec(t);
    if (!m) return ['reviews.md needs a line of exactly this form, with the true counts after the fix round: "Open: CRITICAL 0, HIGH 0"'];
    return Number(m[1]) + Number(m[2]) === 0 ? [] : [`reviews.md records ${m[1]} CRITICAL and ${m[2]} HIGH findings still open: fix them, re-run the reviewers on the fix, then update the line`];
  })],
  ['qa', ({ docs }) => doc(docs, 'qa.md', 'independent browser walkthrough record')],
  ['release', ({ product }) => [
    ...(/```/.test(read(path.join(product, 'README.md')) ?? '') ? [] : ['README.md in the product directory needs run steps in a code block: someone with only the README must be able to run it']),
    ...(read(path.join(product, 'CHANGELOG.md')) === null ? ['CHANGELOG.md is missing in the product directory'] : []),
  ]],
  ['retro', ({ docs }) => doc(docs, 'retro.md', 'retro')],
];

// Returns the phase list with the first incomplete phase's problems. Later phases are not evaluated.
async function checkPipeline({ root, product, docs, runGate = defaultGate }) {
  const ctx = { root: path.resolve(root), product: path.resolve(root, product), docs: path.resolve(root, docs), runGate, gateOutput: '' };
  const phases = [];
  let blocked = null;
  for (const [name, check] of PHASES) {
    if (blocked) { phases.push({ name, status: 'pending', problems: [] }); continue; }
    const problems = await check(ctx);
    phases.push({ name, status: problems.length ? 'incomplete' : 'done', problems });
    if (problems.length) blocked = name;
  }
  return { pass: blocked === null, blocked, phases, gateOutput: ctx.gateOutput };
}

// The Stop hook forwards only the tail of the output, so the instruction and the gate's own failure
// details go last.
function formatReport({ pass, blocked, phases, gateOutput }) {
  const lines = phases.map((p, i) => `[${i + 1}/${phases.length}] ${p.name}: ${p.status}`);
  if (pass) return [...lines, 'PIPELINE COMPLETE'].join('\n');
  const current = phases.find((p) => p.name === blocked);
  return [
    ...lines,
    `PIPELINE INCOMPLETE at phase "${blocked}". Do this phase now; do not stop to ask a human. Decide, log the decision in decisions.md, continue.`,
    ...current.problems.map((p) => `  - ${p}`),
    ...(blocked === 'build' && gateOutput ? ['', gateOutput.trimEnd()] : []),
  ].join('\n');
}

module.exports = { checkPipeline, formatReport, frozenFiles, amendCounts };
