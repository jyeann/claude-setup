'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { checkPipeline, formatReport } = require('../lib/pipeline');
const { buildState } = require('../lib/state');

const PIPELINE = path.join(__dirname, '..', 'bin', 'pipeline.js');
const VERIFY = path.join(__dirname, '..', 'bin', 'verify.js');
const LONG = 'x'.repeat(320);
const passGate = async () => ({ pass: true, output: 'VERIFY PASSED' });

const MATH = `'use strict';
function add(a, b) {
  if (typeof a !== 'number' || typeof b !== 'number') throw new TypeError('numbers only');
  return a + b;
}
module.exports = { add };
`;
const UNIT = `const test = require('node:test');
const assert = require('node:assert/strict');
const { add } = require('../src/math');
test('add', () => {
  assert.equal(add(1, 2), 3);
  assert.equal(add(-1, 1), 0);
  assert.throws(() => add('a', 1), TypeError);
  assert.throws(() => add(1, 'b'), TypeError);
});
`;
const one = (name, body = "assert.equal(add(2, 2), 4);") => `const test = require('node:test');
const assert = require('node:assert/strict');
const { add } = require('../src/math');
test('${name}', () => { ${body} });
`;
const CONFIG = {
  testCommand: 'node --test "tests/*.test.js" "acceptance/*.test.js"',
  minTests: 2,
  replicates: 1,
  srcDirs: ['src'],
  holdout: { command: 'node --test "holdout/*.test.js"' },
  journeys: { command: 'node --test "journeys/*.test.js"', uxFile: 'docs/ux.md' },
  mutation: { samples: 2, minKillRate: 0.5, copy: ['acceptance'] },
};

function write(root, files) {
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), typeof text === 'string' ? text : JSON.stringify(text));
  }
}

// A product with every phase's output in place. Product files under app/, documents under docs/.
function project(overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-'));
  write(root, {
    'docs/brief.md': `# Brief\n## Success criteria\nSC1 a person can add two numbers. ${LONG}`,
    'docs/ux.md': `# UX\n### J1. Add (SC1)\nUC1 the sum is shown. ${LONG}`,
    'docs/design.md': `# Design\n${LONG}`,
    'docs/decisions.md': '# Decisions\n',
    'docs/reviews.md': `# Reviews\n${LONG}\nOpen: CRITICAL 0, HIGH 0\n`,
    'docs/qa.md': `# QA\n${LONG}`,
    'docs/retro.md': `# Retro\n${LONG}`,
    'app/spec.md': '# Spec\n',
    'app/TASKS.md': '# Tasks\n',
    'app/verify.config.json': { ...CONFIG, journeys: { ...CONFIG.journeys, uxFile: '../docs/ux.md' } },
    'app/acceptance/add.test.js': one('adds'),
    'app/README.md': '# App\n```bash\nnode src/math.js\n```\n',
    'app/CHANGELOG.md': '# Changelog\n',
    ...overrides,
  });
  return root;
}
const check = (root, runGate = passGate) => checkPipeline({ root, product: 'app', docs: 'docs', runGate });
const statusOf = (r) => Object.fromEntries(r.phases.map((p) => [p.name, p.status]));

test('a project with every phase complete and a green gate passes', async () => {
  const r = await check(project());
  assert.equal(r.pass, true);
  assert.ok(r.phases.every((p) => p.status === 'done'));
  assert.match(formatReport(r), /PIPELINE COMPLETE$/);
});

test('an empty project is blocked at discover, later phases are pending, and the gate is not run', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-'));
  let ran = false;
  const r = await check(root, async () => { ran = true; return { pass: true, output: '' }; });
  assert.equal(r.pass, false);
  assert.equal(r.blocked, 'discover');
  assert.equal(statusOf(r).ux, 'pending');
  assert.equal(ran, false);
  const report = formatReport(r);
  assert.match(report, /INCOMPLETE at phase "discover"/);
  assert.match(report, /do not stop to ask a human/);
  assert.match(report, /write brief\.md/);
});

test('each phase reports what is missing', async () => {
  const cases = [
    [{ 'docs/brief.md': 'short' }, 'discover', /stub/],
    [{ 'docs/brief.md': `# Brief\n${LONG}` }, 'discover', /Success criteria/],
    [{ 'docs/ux.md': `# UX\n${LONG}` }, 'ux', /names no journeys/],
    [{ 'docs/brief.md': `## Success criteria\nSC1 SC2 ${LONG}` }, 'ux', /no journey for success criteria SC2/],
    [{ 'docs/design.md': '' }, 'design', /stub/],
    [{ 'app/verify.config.json': '{ nope' }, 'plan', /not valid JSON/],
    [{ 'app/verify.config.json': { testCommand: 'x' } }, 'plan', /holdout\.command[\s\S]*journeys\.command/],
    [{ 'docs/reviews.md': `# Reviews\n${LONG}` }, 'review', /Open: CRITICAL 0, HIGH 0/],
    [{ 'docs/reviews.md': `${LONG}\nOpen: CRITICAL 0, HIGH 2\n` }, 'review', /0 CRITICAL and 2 HIGH/],
    [{ 'docs/qa.md': '' }, 'qa', /stub/],
    [{ 'app/README.md': '# App' }, 'release', /run steps in a code block/],
    [{ 'docs/retro.md': '' }, 'retro', /stub/],
  ];
  for (const [files, phase, message] of cases) {
    const r = await check(project(files));
    assert.equal(r.blocked, phase, JSON.stringify(files));
    assert.match(r.phases.find((p) => p.name === phase).problems.join('\n'), message);
  }
});

test('plan needs a spec, acceptance tests, TASKS.md and the decision log', async () => {
  const root = project();
  for (const f of ['app/spec.md', 'app/TASKS.md', 'docs/decisions.md', 'app/acceptance/add.test.js', 'app/verify.config.json', 'app/CHANGELOG.md']) fs.rmSync(path.join(root, f));
  const r = await check(root);
  assert.equal(r.blocked, 'plan');
  const text = r.phases.find((p) => p.name === 'plan').problems.join('\n');
  for (const re of [/spec\.md is missing/, /verify\.config\.json is missing/, /no acceptance tests/, /TASKS\.md is missing/, /decisions\.md is missing/]) assert.match(text, re);
});

test('a failing gate blocks at build and its output ends the report', async () => {
  const r = await check(project(), async () => ({ pass: false, output: 'VERIFY FAILED:\n  - tests failed (1 failing)\n' }));
  assert.equal(r.blocked, 'build');
  assert.equal(statusOf(r).review, 'pending');
  assert.match(formatReport(r), /tests failed \(1 failing\)$/);
});

test('files that define done are frozen once the plan phase completes', async () => {
  const root = project();
  assert.equal((await check(root)).pass, true);
  fs.writeFileSync(path.join(root, 'app/acceptance/add.test.js'), one('adds', 'assert.ok(1);'));
  const changed = await check(root);
  assert.equal(changed.blocked, 'plan');
  assert.match(changed.phases[3].problems[0], /app\/acceptance\/add\.test\.js changed after the plan phase froze it/);
  // Still blocked on the next check: the freeze does not silently adopt the new content.
  assert.equal((await check(root)).blocked, 'plan');
});

test('an AMEND line in decisions.md lets the author change a frozen file once', async () => {
  const root = project();
  await check(root);
  const file = path.join(root, 'app/acceptance/add.test.js');
  fs.writeFileSync(file, one('adds, corrected'));
  fs.appendFileSync(path.join(root, 'docs/decisions.md'), '- AMEND: app/acceptance/add.test.js - expected value contradicted spec line 4\n');
  assert.equal((await check(root)).pass, true);
  fs.writeFileSync(file, one('adds, changed again'));
  assert.equal((await check(root)).blocked, 'plan', 'one AMEND line covers one change');
});

test('adding or deleting a frozen test file also needs an AMEND line', async () => {
  const root = project({ 'app/holdout/hidden.test.js': one('hidden') });
  await check(root);
  fs.rmSync(path.join(root, 'app/holdout/hidden.test.js'));
  fs.writeFileSync(path.join(root, 'app/acceptance/extra.test.js'), one('extra'));
  const problems = (await check(root)).phases[3].problems.join('\n');
  assert.match(problems, /app\/holdout\/hidden\.test\.js changed/);
  assert.match(problems, /app\/acceptance\/extra\.test\.js changed/);
});

test('the real gate runs the browser journeys and the whole pipeline passes end to end', async () => {
  const root = project({
    'app/src/math.js': MATH,
    'app/tests/math.test.js': UNIT,
    'app/holdout/hidden.test.js': one('hidden'),
    'app/journeys/walk.test.js': `${one('J1: add two numbers')}test('UC1: the sum is shown', () => { assert.equal(add(1, 1), 2); });\n`,
  });
  const r = await checkPipeline({ root, product: 'app', docs: 'docs' });
  assert.equal(r.pass, true, formatReport(r));
  assert.match(r.gateOutput, /journeys: 2\/2 passing/);
});

const gate = (root) => spawnSync('node', [VERIFY], { cwd: root, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: root } });
function product(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'journeys-'));
  write(root, {
    'verify.config.json': CONFIG, 'src/math.js': MATH, 'tests/math.test.js': UNIT, 'acceptance/add.test.js': one('adds'),
    'holdout/hidden.test.js': one('hidden'), 'docs/ux.md': '### J1. Add\nUC1 the sum is shown.\n', ...files,
  });
  return root;
}

test('the gate fails when a journey named in ux.md has no passing browser test', () => {
  const r = gate(product({ 'journeys/walk.test.js': one('J1: add two numbers') }));
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stdout, /no passing browser test is named for UC1/);
});

test('the gate fails and shows the assertion when a journey test fails, and J1 does not match J10', () => {
  const r = gate(product({
    'docs/ux.md': '### J1. Add\n',
    'journeys/walk.test.js': one('J10: something else', "assert.equal(add(2, 2), 5, 'sum not shown');"),
  }));
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stdout, /browser journey test\(s\) fail/);
  assert.match(r.stdout, /sum not shown/);
  assert.match(r.stdout, /no passing browser test is named for J1 /);
});

test('skipped journeys, too few journeys and a missing ux file each fail the gate', () => {
  const skipped = gate(product({ 'journeys/walk.test.js': `${one('J1: add')}test('UC1: sum', { skip: true }, () => {});\n` }));
  assert.match(skipped.stdout, /skipped or todo journey tests are not passing/);
  const few = product({ 'journeys/walk.test.js': `${one('J1: add')}test('UC1: sum', () => { assert.equal(add(1, 1), 2); });\n` });
  write(few, { 'verify.config.json': { ...CONFIG, journeys: { ...CONFIG.journeys, minTests: 5 } } });
  assert.match(gate(few).stdout, /only 2 journey test\(s\) ran; at least 5 expected/);
  const noUx = product({ 'journeys/walk.test.js': one('J1: add') });
  fs.rmSync(path.join(noUx, 'docs/ux.md'));
  assert.match(gate(noUx).stdout, /docs\/ux\.md not found/);
});

test('--fast skips the journeys, and a bad journeys config is a usage error', () => {
  const root = product({ 'journeys/walk.test.js': one('nothing named') });
  const fast = spawnSync('node', [VERIFY, '--fast'], { cwd: root, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: root } });
  assert.equal(fast.status, 0, fast.stdout);
  assert.match(fast.stdout, /journeys: skipped \(--fast\)/);
  for (const journeys of [{ uxFile: 'docs/ux.md' }, { command: 'x', minTests: 0 }, { command: 'x', uxFile: 7 }]) {
    write(root, { 'verify.config.json': { ...CONFIG, journeys } });
    assert.equal(gate(root).status, 2);
  }
});

test('CLI: exit 1 with the next task when incomplete, exit 2 on bad usage', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-'));
  const run = (args) => spawnSync('node', [PIPELINE, ...args], { cwd: root, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: root } });
  const incomplete = run(['check', '--product', '.', '--docs', 'docs']);
  assert.equal(incomplete.status, 1);
  assert.match(incomplete.stdout, /\[1\/9\] discover: incomplete/);
  assert.equal(run(['check']).status, 2);
  assert.equal(run(['check', '--nope', 'x']).status, 2);
});

test('--open-gate-files leaves spec and acceptance writable for a whole-pipeline run', () => {
  const base = { verifyCommand: 'x', projectDir: '/p' };
  assert.ok(buildState(base).protectedPaths.includes('acceptance/'));
  assert.deepEqual(buildState({ ...base, gateFilesOpen: true, protectedPaths: ['keep/'] }).protectedPaths, ['keep/']);
});
