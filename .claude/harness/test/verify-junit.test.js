'use strict';
// The report contract end to end (ADR-0003): verify.js with "adapter": "junit", driven by a stand-in runner
// that is a shell script behaving like pytest (fixtures/standin-runner.sh), and by small scripts that replay the
// real Vitest and Playwright reports captured in the spike.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { decideStop } = require('../lib/stop-loop');

const VERIFY = path.join(__dirname, '..', 'bin', 'verify.js');
const STANDIN = path.join(__dirname, 'fixtures', 'standin-runner.sh');
const REPORTS = path.join(__dirname, 'fixtures', 'reports');
const sh = (script, ...args) => ['sh', JSON.stringify(script), ...args].join(' ');

const UNIT = 'pass adds two numbers\npass rejects text\npass J9 is not a journey\n';
const HIDDEN = 'pass HIDDEN-CASE-ALPHA\npass HIDDEN-CASE-BETA\n';
const JOURNEYS = 'pass J1 sign up\npass J2 log in\n';
// The owner's recorded acceptance of the checks the junit adapter cannot run yet.
const WEAKER = { missing: ['coverage', 'test-quality', 'mutation'], decision: 'decisions.md row 7' };

const tmp = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

// files: path -> text, relative to the project; hidden: the holdout cases (kept outside the project).
function project({ unit = UNIT, hidden = null, journeys = null, ux = null, config = {}, files = {} } = {}) {
  const dir = tmp('verify-junit-');
  const write = (rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
  write('tests/cases.txt', unit);
  const cfg = { adapter: 'junit', runner: 'standin-pytest', testCommand: sh(STANDIN, 'tests/cases.txt'), minTests: 2, replicates: 2, weakerGate: WEAKER, ...config };
  if (hidden !== null) {
    const hiddenDir = tmp('verify-junit-hidden-');
    fs.writeFileSync(path.join(hiddenDir, 'cases.txt'), hidden);
    cfg.holdout = { command: sh(STANDIN, path.join(hiddenDir, 'cases.txt')), ...cfg.holdout };
  }
  if (journeys !== null) {
    write('journeys/cases.txt', journeys);
    cfg.journeys = { command: sh(STANDIN, 'journeys/cases.txt'), ...cfg.journeys };
  }
  if (ux !== null) write('docs/ux.md', ux);
  for (const [rel, text] of Object.entries(files)) write(rel, text);
  write('verify.config.json', JSON.stringify(cfg));
  return dir;
}

const { NODE_TEST_CONTEXT, ...cleanEnv } = process.env;
function verify(dir, ...args) {
  const tmpdir = tmp('verify-junit-tmpdir-');
  const r = spawnSync('node', [VERIFY, ...args], { cwd: dir, encoding: 'utf8', env: { ...cleanEnv, TMPDIR: tmpdir } });
  return { ...r, leftovers: fs.readdirSync(tmpdir) };
}
const text = (r) => `${r.stdout}${r.stderr}`;

test('a non-JavaScript runner passes the gate from its JUnit report: tests, replicates, holdout, journeys and ids', () => {
  const dir = project({ hidden: HIDDEN, journeys: JOURNEYS, ux: '# UX\n\nJ1 sign up, J2 log in.\n', config: { journeys: { uxFile: 'docs/ux.md' } } });
  const r = verify(dir);
  assert.equal(r.status, 0, text(r));
  assert.match(r.stdout, /^ {2}3\/3 passing$/m);
  assert.match(r.stdout, /replicates: 2 runs agree/);
  assert.match(r.stdout, /holdout: 2\/2 passing/);
  assert.match(r.stdout, /journeys: 2\/2 passing/);
  assert.match(r.stdout, /VERIFY PASSED/);
  assert.match(r.stdout, /coverage: not available for the junit adapter/);
  assert.match(r.stdout, /test quality: not available for the junit adapter/);
  assert.match(r.stdout, /not checked \(weaker gate, junit adapter\): coverage, test-quality, mutation \(owner decision: decisions.md row 7\)/);
  assert.deepEqual(r.leftovers, [], 'every report directory is deleted after reading');
});

test('a weaker gate fails unless the owner\'s decision lists exactly the checks that are not run', () => {
  let r = verify(project({ config: { weakerGate: undefined } }));
  assert.equal(r.status, 1, text(r));
  assert.match(r.stdout, /weaker gate: the junit adapter does not run coverage, test-quality, mutation; this needs an owner decision recorded as "weakerGate": \{"missing": \["coverage","test-quality","mutation"\], "decision": "<where it is recorded>"\}/);
  assert.doesNotMatch(r.stdout, /VERIFY PASSED/);

  r = verify(project({ config: { weakerGate: { missing: ['coverage', 'mutation'], decision: 'x' } } }));
  assert.equal(r.status, 1, text(r));
  assert.match(r.stdout, /weaker gate: weakerGate\.missing must list exactly coverage, test-quality, mutation \(not listed: test-quality\)/);

  r = verify(project({ config: { weakerGate: { missing: ['coverage', 'test-quality', 'mutation', 'journeys'], decision: 'x' } } }));
  assert.equal(r.status, 1, text(r));
  assert.match(r.stdout, /\(listed but checked: journeys\)/);

  for (const bad of [{ missing: 'coverage', decision: 'x' }, { missing: ['coverage'] }, { missing: ['coverage'], decision: ' ' }]) {
    r = verify(project({ config: { weakerGate: bad } }));
    assert.equal(r.status, 2, JSON.stringify(bad));
    assert.match(r.stderr, /weakerGate needs "missing" \(array of check names\) and "decision"/);
  }
});

test('a malformed holdout report is refused with a fixed message: names in it never reach the output', () => {
  const hiddenDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-junit-hidden-'));
  const leaky = path.join(hiddenDir, 'leaky.xml');
  for (const xml of [
    '<testsuites><testcase name="HIDDEN-CASE-ALPHA">&HIDDENENTITY;</testcase></testsuites>',
    '<HIDDENROOT><testcase name="HIDDEN-CASE-ALPHA"/></HIDDENROOT>',
    '<testsuites tests="7HIDDENTOTAL"><testcase name="HIDDEN-CASE-ALPHA"/></testsuites>',
    '<testsuites><testcase name="HIDDEN-CASE-ALPHA"></HIDDENTAG></testsuites>',
  ]) {
    fs.writeFileSync(leaky, xml);
    const r = verify(project({ hidden: `pass HIDDEN-CASE-ALPHA\n@report-from ${leaky}\n` }));
    assert.equal(r.status, 1, text(r));
    assert.match(r.stdout, /holdout: the JUnit report could not be trusted \(parse or totals problem\); details hidden/);
    assert.doesNotMatch(text(r), /HIDDEN/, text(r));
  }
});

test('a report written a fraction of a second before the run is rejected (compared with the report directory\'s own time)', async () => {
  const { runReported } = require('../lib/reports/test-run');
  const dir = project();
  const early = path.join(dir, 'early.xml');
  fs.writeFileSync(early, '<testsuites><testcase name="adds two numbers"/></testsuites>');
  fs.writeFileSync(path.join(dir, 'tests', 'cases.txt'), `pass adds two numbers\n@report-from ${early}\n`);
  const now = Date.now() / 1000;
  fs.utimesSync(early, now, now);
  const run = await runReported(sh(STANDIN, 'tests/cases.txt'), 'standin-pytest', { cwd: dir, timeoutMs: 30_000 });
  assert.deepEqual(run.problems, ['the JUnit report is older than this run (stale or copied in); only a report written during the run is trusted']);
  assert.equal(run.report, null);
});

test('the report directory is never inside the project', () => {
  const dir = project();
  const r = spawnSync('node', [VERIFY], { cwd: dir, encoding: 'utf8', env: { ...cleanEnv, TMPDIR: dir } });
  assert.equal(r.status, 2, text(r));
  assert.match(r.stderr, /report directory .* is inside the project/);
});

test('a non-zero exit fails even when the report and the summary are green', () => {
  const r = verify(project({ unit: `${UNIT}@exit 3\n` }));
  assert.equal(r.status, 1, text(r));
  assert.match(r.stdout, /exited with code 3 although its JUnit report shows no failing test; a non-zero exit always fails/);
});

test('a report older than the run (stale or copied in) is rejected', () => {
  const r = verify(project({ unit: `${UNIT}@old-report\n` }));
  assert.equal(r.status, 1, text(r));
  assert.match(r.stdout, /tests: the JUnit report is older than this run/);
});

test('a report that disagrees with the runner\'s stdout summary fails, showing both', () => {
  const r = verify(project({ unit: `${UNIT}@lie-summary\n` }));
  assert.equal(r.status, 1, text(r));
  assert.match(r.stdout, /the JUnit report \(tests 3, failures 0, skipped 0\) disagrees with standin-pytest's own summary \(tests 4, failures 0, skipped 0\)/);
});

test('a missing report names the flags the gate appends; a missing summary and a malformed report are named too', () => {
  let r = verify(project({ unit: `${UNIT}@no-report\n` }));
  assert.equal(r.status, 1);
  assert.match(r.stdout, /no JUnit report was written\. The gate appends --junitxml=<file> to the command/);
  r = verify(project({ unit: `${UNIT}@no-summary\n` }));
  assert.equal(r.status, 1);
  assert.match(r.stdout, /no standin-pytest summary line \("=== N passed in Xs ==="\) in the output/);
  r = verify(project({ unit: `${UNIT}@garbage-report\n` }));
  assert.equal(r.status, 1);
  assert.match(r.stdout, /tests: malformed JUnit report: /);
});

test('skipped tests and too few tests fail as on the node path', () => {
  let r = verify(project({ unit: `${UNIT}skip later\n` }));
  assert.equal(r.status, 1);
  assert.match(r.stdout, /1 skipped or todo test\(s\): skipping is not passing/);
  r = verify(project({ unit: 'pass only one\n' }));
  assert.equal(r.status, 1);
  assert.match(r.stdout, /only 1 test\(s\) ran; at least 2 expected/);
});

test('a failing JUnit test reaches the no-progress breaker as a `not ok` line in the Failing tests block', () => {
  const r = verify(project({ unit: `${UNIT}fail keeps totals | expected 7 to equal 8\n` }));
  assert.equal(r.status, 1, text(r));
  assert.match(r.stdout, /tests failed \(1 failing\)/);
  const block = r.stdout.split('Failing tests (fix these at the root cause):\n')[1];
  assert.ok(block, r.stdout);
  assert.match(block, /^not ok 1 - keeps totals\n {2}error: expected 7 to equal 8$/m);

  const base = { active: true, iteration: 0, maxIterations: 50, stallLimit: 50, noProgressLimit: 2, diagnose: false, lastSignature: null, stallCount: 0, status: 'running', history: [] };
  let state = base;
  for (let i = 0; i < 3; i += 1) state = decideStop(state, { pass: false, output: r.stdout, timedOut: false }).nextState;
  assert.equal(state.history[0].failing, 1, 'the breaker counts the failing JUnit test');
  assert.equal(state.status, 'halted-no-progress');
});

test('replicates run the runner again with a fresh report and catch a flaky suite', () => {
  const r = verify(project({ unit: `${UNIT}@flaky\n` }));
  assert.equal(r.status, 1, text(r));
  assert.match(r.stdout, /flaky tests: run 1 -> pass: 3\/3 passing, 0 failing; run 2 -> fail: 2\/3 passing, 1 failing/);
  assert.equal(verify(project({ unit: `${UNIT}@flaky\n` }), '--fast').status, 0, '--fast skips replicates');
});

test('holdout: only counts are printed; hidden test names and messages never appear in the output', () => {
  const hidden = 'pass HIDDEN-CASE-ALPHA\nfail HIDDEN-CASE-BETA | HIDDEN-MESSAGE-GAMMA\n';
  let r = verify(project({ hidden }));
  assert.equal(r.status, 1, text(r));
  assert.match(r.stdout, /holdout: 1\/2 passing/);
  assert.match(r.stdout, /holdout: 1 of 2 hidden acceptance test\(s\) fail/);
  for (const forged of ['', '@lie-summary\n', '@no-report\n', '@garbage-report\n', '@old-report\n', '@exit 5\n', 'skip HIDDEN-CASE-DELTA\n']) {
    r = verify(project({ hidden: `${hidden}${forged}` }));
    assert.equal(r.status, 1, forged);
    assert.doesNotMatch(text(r), /HIDDEN-|verify-junit-hidden-/, `${forged}: ${text(r)}`);
  }
  r = verify(project({ hidden: 'pass HIDDEN-CASE-ALPHA\n', config: { holdout: { minTests: 2 } } }));
  assert.match(r.stdout, /holdout: only 1 hidden test\(s\) ran; at least 2 expected/);
  r = verify(project({ hidden: `${HIDDEN}skip HIDDEN-CASE-DELTA\n` }));
  assert.match(r.stdout, /holdout: skipped or todo hidden tests are not passing/);
});

test('journeys: failures are shown as `not ok` lines, and ids are matched against passing JUnit test names', () => {
  let r = verify(project({ journeys: 'pass J1 sign up\nfail J2 log in | button not found\n' }));
  assert.equal(r.status, 1, text(r));
  assert.match(r.stdout, /journeys: 1 browser journey test\(s\) fail/);
  assert.match(r.stdout, /^not ok 1 - J2 log in\n {2}error: button not found$/m);

  r = verify(project({ journeys: 'pass J1 sign up\n', ux: 'J1 sign up, J2 log in, UC3 empty state\n', config: { journeys: { uxFile: 'docs/ux.md' } } }));
  assert.equal(r.status, 1);
  assert.match(r.stdout, /no passing browser test is named for J2, UC3 \(docs\/ux\.md\)/);
  assert.doesNotMatch(r.stdout, /named for J1/, 'J9 in a unit test does not count; J1 is matched');

  r = verify(project({ journeys: 'pass J1 sign up\nskip J2 later\n', config: { journeys: { minTests: 3 } } }));
  assert.match(r.stdout, /journeys: skipped or todo journey tests are not passing/);
  assert.match(r.stdout, /journeys: only 2 journey test\(s\) ran; at least 3 expected/);

  r = verify(project({ journeys: `${JOURNEYS}@no-report\n` }));
  assert.match(r.stdout, /journeys: no JUnit report was written/);
});

// Replays the real captured reports: a script that takes the gate's flags and environment the way the real
// tool does, and prints that tool's summary line from the spike.
const replay = (report, summary, code) => `#!/bin/sh
out="$PLAYWRIGHT_JUNIT_OUTPUT_FILE"
for a in "$@"; do case "$a" in --outputFile.junit=*) out="\${a#--outputFile.junit=}" ;; --output=*) [ -n "\${a#--output=}" ] || exit 9 ;; esac; done
[ -n "$out" ] || { echo "no report path given" >&2; exit 8; }
cp ${JSON.stringify(path.join(REPORTS, report))} "$out"
printf '%s\\n' ${JSON.stringify(summary)}
exit ${code}
`;

test('a Vitest run replayed from the spike: its real failing report and summary give `not ok` lines', () => {
  const dir = project({
    files: { 'vitest.sh': replay('vitest-fail.junit.xml', '      Tests  1 failed | 3 passed | 1 skipped (5)', 1) },
    config: { runner: 'vitest', testCommand: 'sh vitest.sh run' },
  });
  const r = verify(dir);
  assert.equal(r.status, 1, text(r));
  assert.match(r.stdout, /^ {2}3\/5 passing$/m);
  assert.match(r.stdout, /tests failed \(1 failing\)/);
  assert.match(r.stdout, /1 skipped or todo test\(s\)/);
  assert.match(r.stdout, /^not ok 1 - trims leading dashes \(deliberately failing for the spike\)$/m);
});

test('Playwright journeys replayed from the spike: the report path arrives only in PLAYWRIGHT_JUNIT_OUTPUT_FILE', () => {
  const dir = project({
    journeys: '',
    ux: 'J1 typing a title shows its slug\n',
    files: { 'pw.sh': replay('playwright.junit.xml', '  1 passed (1.7s)', 0) },
    config: { journeys: { command: 'sh pw.sh test', runner: 'playwright', uxFile: 'docs/ux.md' } },
  });
  const r = verify(dir);
  assert.equal(r.status, 0, text(r));
  assert.match(r.stdout, /journeys: 1\/1 passing/);
  assert.deepEqual(r.leftovers, []);
});

test('config: unknown adapters and runners are refused; runner is only for the junit adapter', () => {
  const cases = [
    [{ adapter: 'jest' }, /adapter must be one of node, junit/],
    [{ runner: 'mocha' }, /runner must be one of vitest, playwright, standin-pytest/],
    [{ runner: undefined }, /runner must be one of/],
    [{ holdout: { command: 'x', runner: 'nope' } }, /holdout\.runner must be one of/],
    [{ journeys: { command: 'x', runner: 'nope' } }, /journeys\.runner must be one of/],
    [{ adapter: 'node', runner: 'standin-pytest' }, /runner applies only with "adapter": "junit"/],
    [{ adapter: undefined, journeys: { command: 'x', runner: 'playwright' } }, /runner applies only with "adapter": "junit"/],
  ];
  for (const [config, message] of cases) {
    const dir = project();
    const cfg = { ...JSON.parse(fs.readFileSync(path.join(dir, 'verify.config.json'), 'utf8')), ...config };
    for (const key of Object.keys(cfg)) if (cfg[key] === undefined) delete cfg[key];
    fs.writeFileSync(path.join(dir, 'verify.config.json'), JSON.stringify(cfg));
    const r = verify(dir);
    assert.equal(r.status, 2, JSON.stringify(config));
    assert.match(r.stderr, message, JSON.stringify(config));
  }
});
