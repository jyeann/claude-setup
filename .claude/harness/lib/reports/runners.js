'use strict';
// How the gate hands a test runner its JUnit report path, and how it reads that runner's own stdout summary
// (the second witness the report must agree with, ADR-0003). The gate builds the flags itself; a project's
// config never chooses where the report goes. Summary readers are pure; they return null when no summary is
// found, and add up several summaries (a command such as `a && b` runs the tool twice).
const path = require('node:path');

const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g;
const clean = (output) => String(output ?? '').replace(ANSI, '');

function tally(parts, map) {
  const counts = { tests: 0, failures: 0, skipped: 0 };
  for (const [, n, word] of parts) {
    const key = map[word];
    if (key === undefined) continue;
    counts.tests += Number(n);
    if (key !== 'passed') counts[key] += Number(n);
  }
  return counts;
}

const add = (a, b) => (a === null ? b : { tests: a.tests + b.tests, failures: a.failures + b.failures, skipped: a.skipped + b.skipped });

// `Tests  1 failed | 3 passed | 1 skipped (5)`; the total in brackets is Vitest's own and must agree with the parts.
const VITEST_LINE = /^\s*Tests\s+((?:\d+ [a-z]+(?:\s*\|\s*)?)+)\s*\((\d+)\)\s*$/gm;
const VITEST_WORDS = { passed: 'passed', failed: 'failures', skipped: 'skipped', todo: 'skipped' };
function vitestSummary(output) {
  let total = null;
  for (const m of clean(output).matchAll(VITEST_LINE)) {
    const counts = tally(m[1].matchAll(/(\d+) ([a-z]+)/g), VITEST_WORDS);
    counts.tests = Number(m[2]);
    total = add(total, counts);
  }
  return total;
}

// Playwright's line reporter ends with one line per outcome: `  1 failed`, `  3 passed (1.7s)`.
const PLAYWRIGHT_LINE = /^\s{2}(\d+) (passed|failed|flaky|skipped|interrupted|did not run)(?: \([^)]*\))?\s*$/gm;
const PLAYWRIGHT_WORDS = { passed: 'passed', flaky: 'passed', failed: 'failures', interrupted: 'failures', skipped: 'skipped', 'did not run': 'skipped' };
function playwrightSummary(output) {
  const parts = [...clean(output).matchAll(PLAYWRIGHT_LINE)];
  return parts.length === 0 ? null : tally(parts, PLAYWRIGHT_WORDS);
}

// pytest: `==== 1 failed, 3 passed, 1 skipped in 0.12s ====` (or the same without the rules under -q).
const PYTEST_LINE = /^=*\s*((?:\d+ [a-z]+(?:, )?)+|no tests ran) in \d+(?:\.\d+)?s(?: \([^)]*\))?\s*=*\s*$/gm;
const PYTEST_WORDS = { passed: 'passed', xpassed: 'passed', failed: 'failures', error: 'failures', errors: 'failures', skipped: 'skipped', xfailed: 'skipped' };
function pytestSummary(output) {
  let total = null;
  for (const m of clean(output).matchAll(PYTEST_LINE)) total = add(total, tally(m[1].matchAll(/(\d+) ([a-z]+)/g), PYTEST_WORDS));
  return total;
}

// handover(dir) -> { file, args, env }: the report file in the gate's directory, the flags appended to the
// command, and environment variables for that one child process (Playwright has no flag for the path).
// A runner that can write lcov has coverage(dir, srcDirs) -> { file, args } (#58); `jsx: true` makes .tsx/.jsx
// count as source and test files (only a runner that compiles JSX may declare it).
const RUNNERS = {
  vitest: {
    handover: (dir) => {
      const file = path.join(dir, 'junit.xml');
      return { file, args: ['--reporter=default', '--reporter=junit', `--outputFile.junit=${file}`], env: {} };
    },
    flags: '--reporter=default --reporter=junit --outputFile.junit=<file>',
    summary: vitestSummary,
    summaryShape: '"Tests  N passed (N)"',
    jsx: true,
    // Spike amendment 4 on #55: without --coverage.include untested files are missing from lcov, and without
    // --coverage.reportOnFailure a failing run writes none.
    coverage: (dir, srcDirs) => {
      const reports = path.join(dir, 'coverage');
      const include = srcDirs.map((d) => `--coverage.include=${d.replace(/\/+$/, '')}/**`);
      return { file: path.join(reports, 'lcov.info'), args: ['--coverage.enabled', '--coverage.reporter=lcovonly', `--coverage.reportsDirectory=${reports}`, ...include, '--coverage.reportOnFailure'] };
    },
    coverageFlags: '--coverage.enabled --coverage.reporter=lcovonly --coverage.reportsDirectory=<dir> --coverage.include=<srcDir>/** --coverage.reportOnFailure',
  },
  playwright: {
    handover: (dir) => {
      const file = path.join(dir, 'junit.xml');
      return { file, args: ['--reporter=junit,line', `--output=${path.join(dir, 'artifacts')}`], env: { PLAYWRIGHT_JUNIT_OUTPUT_FILE: file } };
    },
    flags: '--reporter=junit,line --output=<dir> (report path in PLAYWRIGHT_JUNIT_OUTPUT_FILE)',
    summary: playwrightSummary,
    summaryShape: '"  N passed (Xs)"',
  },
  // Test-only: the shape of the shell stand-in runner (test/fixtures/standin-runner.sh), which speaks pytest's
  // flag and summary to prove the gate is not tied to JavaScript. Python is not a supported stack (#55 scope).
  'standin-pytest': {
    testOnly: true,
    handover: (dir) => {
      const file = path.join(dir, 'junit.xml');
      return { file, args: [`--junitxml=${file}`], env: {} };
    },
    flags: '--junitxml=<file>',
    summary: pytestSummary,
    summaryShape: '"=== N passed in Xs ==="',
  },
};

const shellQuote = (arg) => `'${arg.replace(/'/g, "'\\''")}'`;

module.exports = { RUNNERS, vitestSummary, playwrightSummary, pytestSummary, shellQuote };
