'use strict';
// One test command run under the report contract (ADR-0003): a fresh report directory outside the project,
// created after the run starts and deleted after reading; the report path handed over by gate-built flags; and
// the trust rules: a report must exist, be written during this run, parse, and agree with the runner's own
// stdout summary. A non-zero exit fails whatever the report says (the callers check `result.pass`).
const fs = require('node:fs');
const path = require('node:path');
const { runVerify } = require('../verify');
const { makeTemp, removeTemp } = require('../temp-dirs');
const { parseJUnit } = require('./junit');
const { RUNNERS, shellQuote } = require('./runners');

const MAX_FAILURE_LINES = 40;
const MAX_MESSAGES = 6;
const MAX_MESSAGE_CHARS = 200;

const inside = (dir, root) => {
  const rel = path.relative(path.resolve(root), path.resolve(dir));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

const totals = (t) => `tests ${t.tests}, failures ${t.failures}, skipped ${t.skipped}`;

// Returns { result, report, summary, problems }. `problems` are trust failures, worded without report
// content, so they are safe to print for the hidden holdout.
async function runReported(command, runnerName, { cwd, timeoutMs, env = {} }) {
  const runner = RUNNERS[runnerName];
  const startedAt = Date.now();
  const dir = makeTemp('verify-report-');
  try {
    if (inside(dir, cwd)) throw new Error(`the report directory ${dir} is inside the project; set TMPDIR to a directory outside it`);
    const hand = runner.handover(dir);
    const full = `${command} ${hand.args.map(shellQuote).join(' ')}`;
    const result = await runVerify(full, { cwd, timeoutMs, env: { ...env, ...hand.env } });
    const problems = [];
    let report = null;
    if (!fs.existsSync(hand.file)) {
      problems.push(`no JUnit report was written. The gate appends ${runner.flags} to the command, so it must end with the ${runnerName} invocation for the flags to reach it`);
    } else if (fs.statSync(hand.file).mtimeMs < Math.floor(startedAt / 1000) * 1000) {
      // Whole seconds: some filesystems store coarse modification times.
      problems.push('the JUnit report is older than this run (stale or copied in); only a report written during the run is trusted');
    } else {
      try { report = parseJUnit(fs.readFileSync(hand.file, 'utf8')); } catch (err) { problems.push(err.message); }
    }
    const summary = runner.summary(result.output);
    if (summary === null) problems.push(`no ${runnerName} summary line (${runner.summaryShape}) in the output; the gate checks the report against it`);
    else if (report && (report.tests !== summary.tests || report.failures !== summary.failures || report.skipped !== summary.skipped)) {
      problems.push(`the JUnit report (${totals(report)}) disagrees with ${runnerName}'s own summary (${totals(summary)}); neither is trusted`);
    }
    return { result, report: problems.length === 0 ? report : null, summary, problems };
  } finally {
    removeTemp(dir);
  }
}

// Counts to show: the report when trusted, otherwise the runner's summary, otherwise nothing ran.
function counts(run) {
  const t = run.report ?? run.summary ?? { tests: 0, failures: 0, skipped: 0 };
  return { tests: t.tests, fail: t.failures, skipped: t.skipped, pass: t.tests - t.failures - t.skipped };
}

// Failing tests as `not ok N - <name>` lines with an `error:` line, the shape failure-cluster.js reads.
function formatFailures(report) {
  const failed = report ? report.cases.filter((c) => c.status === 'failed') : [];
  if (failed.length === 0) return '';
  const lines = [];
  failed.slice(0, MAX_FAILURE_LINES).forEach((c, i) => {
    lines.push(`not ok ${i + 1} - ${c.name}`);
    const message = (c.message ?? '').split('\n')[0].trim().slice(0, MAX_MESSAGE_CHARS);
    if (i < MAX_MESSAGES && message) lines.push(`  error: ${message}`);
  });
  const omitted = failed.length - MAX_FAILURE_LINES;
  if (omitted > 0) lines.push(`... and ${omitted} more failing test(s)`);
  return lines.join('\n');
}

const passedNames = (report) => (report ? report.cases.filter((c) => c.status === 'passed').map((c) => c.name) : []);

module.exports = { runReported, counts, formatFailures, passedNames, inside };
