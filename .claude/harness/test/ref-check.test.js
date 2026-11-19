'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { refCheck, evaluate, parseFailures, suiteCommands } = require('../lib/ref-check');
const jobs = require('../lib/job');

const CLI = path.join(__dirname, '..', 'bin', 'ref-check.js');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'harness-refcheck-test-'));
const write = (root, rel, text) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); };

// A tiny product: add(a, b) lives in src/math.js. Acceptance and holdout tests call it.
function project({ acceptance, holdout } = {}) {
  const root = tmp();
  write(root, 'package.json', '{"name":"p"}');
  write(root, 'acceptance/add.test.js', acceptance ?? `
    const test = require('node:test'); const assert = require('node:assert/strict'); const { add } = require('../src/math');
    test('adds two numbers', () => assert.equal(add(2, 3), 5));
    test('adds negatives', () => assert.equal(add(-2, -3), -5));`);
  write(root, 'holdout/hidden.test.js', holdout ?? `
    const test = require('node:test'); const assert = require('node:assert/strict'); const { add } = require('../src/math');
    test('adds zero', () => assert.equal(add(0, 0), 0));`);
  write(root, 'verify.config.json', JSON.stringify({ testCommand: 'node --test "acceptance/*.test.js"', holdout: { command: 'node --test "${HARNESS_HIDDEN_DIR:-holdout}/*.test.js"', minTests: 1 } }));
  return root;
}
const config = (root) => JSON.parse(fs.readFileSync(path.join(root, 'verify.config.json'), 'utf8'));
const impl = (root, name, body) => write(root, `${name}/src/math.js`, body);
const REFERENCE = 'exports.add = (a, b) => a + b;';
const STUB = 'exports.add = () => { throw new Error("not implemented"); };';

test('green: a correct reference passes every acceptance and holdout test', async () => {
  const root = project();
  impl(root, 'reference', REFERENCE);
  const r = await refCheck(root, config(root), { impl: 'reference', expect: 'green' });
  assert.equal(r.passed, true, r.problems.join('\n'));
  assert.equal(r.tests, 3);
  assert.equal(r.failing, 0);
});

test('green: a failing test is reported by name as a wrong test or a wrong reference', async () => {
  const root = project({ holdout: `const test = require('node:test'); const assert = require('node:assert/strict'); const { add } = require('../src/math');
    test('adds as strings', () => assert.equal(add(1, 1), '11'));` });
  impl(root, 'reference', REFERENCE);
  const r = await refCheck(root, config(root), { impl: 'reference', expect: 'green' });
  assert.equal(r.passed, false);
  assert.match(r.problems[0], /holdout: 1 of 1 fail against the reference.*adds as strings/);
});

test('green catches two tests that contradict each other: no implementation can satisfy both', async () => {
  const root = project({ acceptance: `const test = require('node:test'); const assert = require('node:assert/strict'); const { add } = require('../src/math');
    test('go is accepted', () => assert.equal(add(1, 1), 2));
    test('go is rejected', () => assert.equal(add(1, 1), 3));` });
  impl(root, 'reference', REFERENCE);
  const r = await refCheck(root, config(root), { impl: 'reference', expect: 'green', suites: ['acceptance'] });
  assert.equal(r.passed, false);
  assert.equal(r.failing, 1);
});

test('green: skipped tests are a problem, because a skipped test proves nothing', async () => {
  const root = project({ acceptance: `const test = require('node:test'); const { add } = require('../src/math');
    test('later', { skip: true }, () => {}); test('now', () => { if (add(1, 2) !== 3) throw new Error('x'); });` });
  impl(root, 'reference', REFERENCE);
  const r = await refCheck(root, config(root), { impl: 'reference', expect: 'green', suites: ['acceptance'] });
  assert.equal(r.passed, false);
  assert.match(r.problems.join(), /skipped or todo/);
});

test('red: against a stub that throws, every test fails on an assertion path and the check passes', async () => {
  const root = project();
  impl(root, 'stub', STUB);
  const r = await refCheck(root, config(root), { impl: 'stub', expect: 'red' });
  assert.equal(r.passed, true, r.problems.join('\n'));
  assert.equal(r.failing, 3);
});

test('red: a test that passes against a stub is flagged as proving nothing', async () => {
  const root = project({ acceptance: `const test = require('node:test'); const assert = require('node:assert/strict');
    test('vacuous', () => assert.ok(true));
    test('real', () => { const { add } = require('../src/math'); assert.equal(add(1, 1), 2); });` });
  impl(root, 'stub', STUB);
  const r = await refCheck(root, config(root), { impl: 'stub', expect: 'red', suites: ['acceptance'] });
  assert.equal(r.passed, false);
  assert.match(r.problems[0], /1 test\(s\) pass against a stub/);
});

test('red: tests that fail only because the module is missing fail for the wrong reason', async () => {
  const root = project();
  write(root, 'empty/README.md', 'no src here');
  const r = await refCheck(root, config(root), { impl: 'empty', expect: 'red' });
  assert.equal(r.passed, false);
  assert.match(r.problems.join(), /crashed before running/);
});

test('an empty suite, a missing folder and an unknown suite are errors, not silent passes', async () => {
  const root = project({ acceptance: `// no tests here\n` });
  impl(root, 'reference', REFERENCE);
  const r = await refCheck(root, config(root), { impl: 'reference', expect: 'green', suites: ['acceptance'] });
  assert.equal(r.passed, false);
  assert.match(r.problems[0], /contain no tests/);
  await assert.rejects(refCheck(root, config(root), { impl: 'nope', expect: 'green' }), /Implementation folder not found/);
  await assert.rejects(refCheck(root, config(root), { impl: 'reference', expect: 'green', suites: ['unit'] }), /Unknown suite/);
  await assert.rejects(refCheck(root, config(root), { impl: 'reference', expect: 'green', holdoutDir: 'missing' }), /No holdout folder/);
  const noHoldout = { ...config(root), holdout: null };
  await assert.rejects(refCheck(root, noHoldout, { impl: 'reference', expect: 'green', suites: ['holdout'] }), /not configured/);
  assert.throws(() => evaluate('blue', []), /red or green/);
});

test('the hidden holdout can live outside the project and is found through HARNESS_HIDDEN_DIR or --holdout-dir', async () => {
  const root = project();
  const outside = tmp();
  fs.cpSync(path.join(root, 'holdout'), outside, { recursive: true });
  fs.rmSync(path.join(root, 'holdout'), { recursive: true });
  impl(root, 'reference', REFERENCE);
  const r = await refCheck(root, config(root), { impl: 'reference', expect: 'green', holdoutDir: outside });
  assert.equal(r.passed, true, r.problems.join('\n'));
});

test('the check never touches the project or the implementation folder', async () => {
  const root = project();
  impl(root, 'reference', REFERENCE);
  const before = fs.readdirSync(root, { recursive: true }).sort().join();
  await refCheck(root, config(root), { impl: 'reference', expect: 'green' });
  assert.equal(fs.readdirSync(root, { recursive: true }).sort().join(), before);
});

test('evaluate reports timeouts and parseFailures separates assertion from environment failures', () => {
  assert.match(evaluate('green', [{ suite: 's', tests: 1, fail: 0, skipped: 0, todo: 0, timedOut: true, failures: [] }]).problems[0], /timed out/);
  const tap = ['not ok 1 - a', '  ---', "  error: 'Cannot find module ../src/x'", '  ...', 'not ok 2 - b', '  ---', "  error: 'Expected values to be strictly equal'", '  ...', 'not ok 3 - agg', '  ---', "  failureType: 'subtestsFailed'", '  ...'].join('\n');
  assert.deepEqual(parseFailures(tap).map((f) => [f.name, f.kind]), [['a', 'environment'], ['b', 'assertion']]);
  assert.match(evaluate('green', [{ suite: 's', tests: 0, fail: 0, skipped: 0, todo: 0, failures: [], crashed: [], empty: [] }]).problems[0], /no tests ran/);
  assert.deepEqual(suiteCommands({ holdout: { command: 'h' } }, ['holdout']), [{ suite: 'holdout', command: 'h' }]);
  assert.match(suiteCommands({ refCheck: { acceptance: 'acc' } }, ['acceptance'])[0].command, /acc\//);
});

test('the CLI exits 0 on a pass, 1 on a failed check, 2 on a usage error, and records the result on the job', () => {
  const root = project();
  impl(root, 'reference', REFERENCE);
  impl(root, 'stub', STUB);
  const run = (...a) => spawnSync('node', [CLI, ...a], { env: { ...process.env, CLAUDE_PROJECT_DIR: root }, encoding: 'utf8' });
  const jobsRoot = jobs.rootOf(root);
  jobs.create(jobsRoot, { id: 'p', title: 'Adder' });
  jobs.intake(jobsRoot, 'p', { decision: 'accept', risk: 'low' });
  const bad = run('--impl', 'reference', '--expect', 'red', '--job', 'p');
  assert.equal(bad.status, 1);
  assert.match(bad.stdout, /ref-check red FAILED/);
  assert.equal(run('--impl', 'stub', '--expect', 'red', '--job', 'p').status, 0);
  const ok = run('--impl', 'reference', '--expect', 'green', '--job', 'p', '--suites', 'acceptance');
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  const record = jobs.read(jobsRoot, 'p');
  assert.deepEqual(record.refChecks.map((c) => [c.expect, c.passed]), [['red', false], ['red', true], ['green', true]]);
  assert.equal(jobs.advance(jobsRoot, 'p', 'build').stage, 'build');
  assert.equal(run('--expect', 'red').status, 2);
  assert.match(run('--expect', 'red').stderr, /--impl/);
});
