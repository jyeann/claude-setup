'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseJUnit, JUnitError } = require('../lib/reports/junit');
const { RUNNERS, vitestSummary, playwrightSummary, pytestSummary, shellQuote } = require('../lib/reports/runners');
const { counts, formatFailures, passedNames, inside } = require('../lib/reports/test-run');
const { clusterFailures } = require('../lib/failure-cluster');

const REPORTS = path.join(__dirname, 'fixtures', 'reports');
const real = (name) => fs.readFileSync(path.join(REPORTS, name), 'utf8');

test('reads the real Vitest report of a passing run: 3 passed, 1 skipped, names with escaped ">"', () => {
  const r = parseJUnit(real('vitest-pass.junit.xml'));
  assert.deepEqual({ tests: r.tests, passed: r.passed, failures: r.failures, skipped: r.skipped }, { tests: 4, passed: 3, failures: 0, skipped: 1 });
  assert.equal(r.cases[0].name, 'slugify > lowercases and joins words with dashes');
  assert.equal(r.cases[0].classname, 'tests/Slug.test.tsx');
  assert.equal(r.cases[2].status, 'skipped');
});

test('reads the real Vitest report of a failing run with the failure message decoded', () => {
  const r = parseJUnit(real('vitest-fail.junit.xml'));
  assert.deepEqual({ tests: r.tests, failures: r.failures, skipped: r.skipped }, { tests: 5, failures: 1, skipped: 1 });
  const failed = r.cases.find((c) => c.status === 'failed');
  assert.equal(failed.name, 'trims leading dashes (deliberately failing for the spike)');
  assert.equal(failed.message, "expected '-hello' to be 'hello' // Object.is equality");
});

test('reads the real Playwright report: the journey id is in the test name', () => {
  const r = parseJUnit(real('playwright.junit.xml'));
  assert.equal(r.tests, 1);
  assert.deepEqual(passedNames(r), ['J1 typing a title shows its slug']);
});

test('the real reports agree with the runners\' stdout summaries recorded in the spike', () => {
  const vitest = vitestSummary(' \x1b[2m Test Files \x1b[22m 1 failed | 1 passed (2)\n\x1b[2m      Tests \x1b[22m 1 failed | 3 passed | 1 skipped (5)\n');
  const fail = parseJUnit(real('vitest-fail.junit.xml'));
  assert.deepEqual(vitest, { tests: fail.tests, failures: fail.failures, skipped: fail.skipped });
  assert.deepEqual(playwrightSummary('Running 1 test using 1 worker\n  1 passed (1.7s)\n'), { tests: 1, failures: 0, skipped: 0 });
});

test('a <testsuite> root, <error> elements, nested suites, CDATA, comments, BOM and character references are read', () => {
  const xml = `﻿<?xml version="1.0"?>
<!-- written by some runner -->
<testsuite name='outer' tests="4">
  <testsuite name="inner">
    <testcase name="a &#x26; b &#38; c"/>
    <testcase name='errs'><error message="">boom<![CDATA[ <raw> & ]]>
second line</error></testcase>
  </testsuite>
  <testcase name="skipped one"><skipped message="later"/></testcase>
  <testcase name="plain"></testcase>
</testsuite>`;
  const r = parseJUnit(xml);
  assert.deepEqual({ tests: r.tests, passed: r.passed, failures: r.failures, skipped: r.skipped }, { tests: 4, passed: 2, failures: 1, skipped: 1 });
  assert.equal(r.cases[0].name, 'a & b & c');
  assert.equal(r.cases[1].message, 'boom <raw> &', 'with no message attribute the first line of the body is used');
});

test('malformed reports are refused with a reason that never quotes a test name', () => {
  const hidden = 'HIDDEN-TEST-NAME';
  const bad = {
    empty: '',
    blank: '  \n',
    truncated: `<testsuites><testsuite><testcase name="${hidden}">`,
    mismatched: `<testsuites><testcase name="${hidden}"></testsuite></testsuites>`,
    'wrong root': `<results><testcase name="${hidden}"/></results>`,
    'declared total disagrees': `<testsuites tests="3"><testcase name="${hidden}"/></testsuites>`,
    'declared total not a number': `<testsuites tests="x"><testcase name="${hidden}"/></testsuites>`,
    'text outside root': `${hidden}<testsuites/>`,
    'two roots': '<testsuites/><testsuites/>',
    'unknown entity': `<testsuites><testcase name="&nbsp;${hidden}"/></testsuites>`,
    'bad char reference': `<testsuites><testcase name="&#x110000;${hidden}"/></testsuites>`,
    'unquoted attribute': `<testsuites><testcase name=${hidden}/></testsuites>`,
    'testcase without a name': '<testsuites><testcase classname="x"/></testsuites>',
    'unterminated comment': `<testsuites><!-- ${hidden}`,
    'unterminated CDATA': `<testsuites><![CDATA[${hidden}`,
    'CDATA outside root': `<![CDATA[${hidden}]]><testsuites/>`,
    'unterminated tag': `<testsuites><testcase name="${hidden}"`,
    'tag without a name': `<testsuites>< name="${hidden}"/></testsuites>`,
    'only a declaration': '<?xml version="1.0"?>',
    'junk between attributes': `<testsuites><testcase name="a"junk="${hidden}"/></testsuites>`,
  };
  for (const [why, xml] of Object.entries(bad)) {
    assert.throws(() => parseJUnit(xml), (err) => {
      assert.ok(err instanceof JUnitError, why);
      assert.match(err.message, /^malformed JUnit report: /, why);
      assert.doesNotMatch(err.message, new RegExp(hidden), `${why}: ${err.message}`);
      return true;
    }, why);
  }
  assert.throws(() => parseJUnit(undefined), JUnitError);
});

test('stdout summaries: Vitest, Playwright and pytest lines are read; todo, xfail and "did not run" count as skipped', () => {
  assert.deepEqual(vitestSummary('Tests  2 passed | 1 todo (3)'), { tests: 3, failures: 0, skipped: 1 });
  assert.deepEqual(playwrightSummary('  1 failed\n    [chromium] › a.spec.ts:3 › J2 x\n  1 flaky\n  1 did not run\n  2 passed (3.0s)'), { tests: 5, failures: 1, skipped: 1 });
  assert.deepEqual(pytestSummary('=== 1 failed, 3 passed, 1 skipped, 1 xfailed, 2 warnings in 0.12s ==='), { tests: 6, failures: 1, skipped: 2 });
  assert.deepEqual(pytestSummary('2 passed, 1 error in 1.50s'), { tests: 3, failures: 1, skipped: 0 });
  assert.deepEqual(pytestSummary('============ no tests ran in 0.01s ============'), { tests: 0, failures: 0, skipped: 0 });
});

test('stdout summaries add up when a command runs the tool twice, and are null when absent', () => {
  assert.deepEqual(pytestSummary('== 2 passed in 0.1s ==\n== 1 failed in 0.1s =='), { tests: 3, failures: 1, skipped: 0 });
  assert.deepEqual(vitestSummary('Tests  2 passed (2)\nTests  1 failed (1)'), { tests: 3, failures: 1, skipped: 0 });
  for (const parse of [vitestSummary, playwrightSummary, pytestSummary]) {
    assert.equal(parse('all good\n'), null);
    assert.equal(parse(undefined), null);
  }
  assert.equal(vitestSummary(' Test Files  1 passed (1)'), null, 'the "Test Files" line is not the test count');
});

test('handover: every report path is in the gate\'s directory; Playwright gets it only through the child env', () => {
  const dir = '/tmp/gate-reports';
  for (const [name, runner] of Object.entries(RUNNERS)) assert.equal(path.dirname(runner.handover(dir).file), dir, name);
  const pw = RUNNERS.playwright.handover(dir);
  assert.equal(pw.env.PLAYWRIGHT_JUNIT_OUTPUT_FILE, pw.file);
  assert.ok(pw.args.includes('--reporter=junit,line'));
  assert.ok(pw.args.includes(`--output=${path.join(dir, 'artifacts')}`));
  assert.deepEqual(RUNNERS['standin-pytest'].handover(dir).args, [`--junitxml=${dir}/junit.xml`]);
  assert.ok(RUNNERS.vitest.handover(dir).args.includes(`--outputFile.junit=${dir}/junit.xml`));
});

test('shellQuote keeps spaces and quotes in a path as one argument', () => {
  assert.equal(shellQuote("/tmp/a b/it's"), "'/tmp/a b/it'\\''s'");
});

test('inside() tells a report directory in the project from one beside it', () => {
  assert.equal(inside('/p/x', '/p'), true);
  assert.equal(inside('/p', '/p'), true);
  assert.equal(inside('/p-reports', '/p'), false);
  assert.equal(inside('/tmp/r', '/p'), false);
});

test('failing JUnit tests print as `not ok N - <name>` lines that failure-cluster.js groups unchanged', () => {
  const report = parseJUnit(real('vitest-fail.junit.xml'));
  const text = formatFailures(report);
  assert.match(text, /^not ok 1 - trims leading dashes \(deliberately failing for the spike\)$/m);
  assert.match(text, /^ {2}error: expected '-hello' to be 'hello'/m);
  const clusters = clusterFailures(text);
  assert.equal(clusters.length, 1);
  assert.deepEqual(clusters[0].tests, ['trims leading dashes (deliberately failing for the spike)']);
  assert.match(clusters[0].message, /expected '-hello'/);
  assert.equal(formatFailures(null), '');
  assert.equal(formatFailures(parseJUnit(real('vitest-pass.junit.xml'))), '');
});

test('formatFailures names every failing test up to a cap, with messages for the first few', () => {
  const cases = Array.from({ length: 45 }, (_, i) => `<testcase name="t${i}"><failure message="m${i}"/></testcase>`).join('');
  const text = formatFailures(parseJUnit(`<testsuites>${cases}</testsuites>`));
  assert.equal(text.match(/^not ok /gm).length, 40);
  assert.equal(text.match(/^ {2}error: /gm).length, 6);
  assert.match(text, /\.\.\. and 5 more failing test\(s\)$/);
  assert.equal(clusterFailures(text).reduce((n, c) => n + c.count, 0), 40);
});

test('counts prefer the trusted report, then the summary, then zero', () => {
  const report = { tests: 3, failures: 1, skipped: 1 };
  assert.deepEqual(counts({ report, summary: null }), { tests: 3, fail: 1, skipped: 1, pass: 1 });
  assert.deepEqual(counts({ report: null, summary: { tests: 2, failures: 0, skipped: 0 } }), { tests: 2, fail: 0, skipped: 0, pass: 2 });
  assert.deepEqual(counts({ report: null, summary: null }), { tests: 0, fail: 0, skipped: 0, pass: 0 });
});

test('malformed-report errors never echo report text: entity, tag and root names or a declared total', () => {
  const bad = {
    'entity name': '<testsuites><testcase name="&LEAKYNAME;"/></testsuites>',
    'closing tag name': '<testsuites><testcase name="a"></LEAKYNAME></testsuites>',
    'unclosed tag name': '<testsuites><LEAKYNAME>',
    'root name': '<LEAKYNAME><testcase name="a"/></LEAKYNAME>',
    'declared total': '<testsuites tests="9LEAKYNAME"><testcase name="a"/></testsuites>',
    'attribute junk': '<testsuites><LEAKYNAME =/></testsuites>',
  };
  for (const [why, xml] of Object.entries(bad)) {
    assert.throws(() => parseJUnit(xml), (err) => {
      assert.ok(err instanceof JUnitError, why);
      assert.doesNotMatch(err.message, /LEAKYNAME/, `${why}: ${err.message}`);
      assert.match(err.message, /offset \d+|root element|declared total/, `${why}: ${err.message}`);
      return true;
    }, why);
  }
});

test('a raw ">" inside a quoted attribute value does not end the tag', () => {
  const r = parseJUnit('<testsuites><testcase name="a > b"><failure message="1 > 0 failed"/></testcase></testsuites>');
  assert.equal(r.cases[0].name, 'a > b');
  assert.equal(r.cases[0].message, '1 > 0 failed');
});

test('inside() resolves symlinks, so a report directory reached through a link to the project is inside it', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'inside-'));
  const project = path.join(base, 'project');
  fs.mkdirSync(path.join(project, 'reports'), { recursive: true });
  fs.symlinkSync(project, path.join(base, 'link'), 'dir');
  assert.equal(inside(path.join(base, 'link', 'reports'), project), true);
  assert.equal(inside(path.join(project, 'reports'), path.join(base, 'link')), true);
  assert.equal(inside(base, project), false);
  fs.rmSync(base, { recursive: true, force: true });
});

test('the pytest-shaped runner is marked test-only: it is the stand-in, not a supported stack', () => {
  assert.equal(RUNNERS.pytest, undefined);
  assert.equal(RUNNERS['standin-pytest'].testOnly, true);
  assert.ok(!RUNNERS.vitest.testOnly && !RUNNERS.playwright.testOnly);
});
