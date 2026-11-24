'use strict';
// The mutation step under the report contract (ADR-0003, #59): Stryker runs on a seeded sample of source files
// the gate chooses, writes the mutation-testing-elements report into a fresh gate-owned directory outside the
// project, and the gate judges it. Stryker has no flag for the report path, so the gate writes its own Stryker
// config file there (holding only jsonReporter.fileName and incremental: false) and passes it as the positional
// argument; the project's Stryker config is then not read at all (spike amendment 1 on #55).
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { runVerify } = require('../verify');
const { tailOutput } = require('../stop-loop');
const { seededRandom } = require('../mutate');
const { makeTemp, removeTemp } = require('../temp-dirs');
const { shellQuote } = require('./runners');
const { inside } = require('./test-run');
const { parseMutationReport, scoreMutants, normalisePath } = require('./mutation-elements');

const MAX_LISTED = 20;

// Up to k files, chosen with a seed taken from the source text (as the node path seeds its mutants), so the
// sample is stable for the same source and moves when the source changes. Sorted for the --mutate flag.
function sampleFiles(files, texts, k) {
  const seed = crypto.createHash('sha1').update(files.map((f) => texts.get(f)).join('\0')).digest('hex');
  const rand = seededRandom(seed);
  const order = [...files].sort();
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order.slice(0, k).sort();
}

const oneLine = (s) => { const first = String(s).split('\n')[0]; return first.length > 80 ? `${first.slice(0, 77)}...` : first; };
const describe = (file, m) => `${file}:${m.line} ${m.mutator} -> \`${oneLine(m.replacement)}\``;

// Same file, line, mutator and reason are shown once with a count.
function grouped(items) {
  const seen = new Map();
  for (const { file, m } of items) {
    const key = `${file}:${m.line} ${m.mutator}${m.reason ? ` ("${oneLine(m.reason)}")` : ''}`;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  return [...seen].map(([key, n]) => (n > 1 ? `${key} x${n}` : key)).join('; ');
}

const listed = (ignored, file, m) => ignored.some((e) => e.file === file && e.line === m.line && e.mutator === m.mutator);

// Problems that make the report untrustworthy: it must come from this run and match what the gate asked for.
function trustProblems(report, sample) {
  const problems = [];
  if (report.config?.incremental === true) problems.push('the report says Stryker ran incrementally (config.incremental is true); the gate never runs incrementally, so this is not the gate\'s run');
  if (Array.isArray(report.config?.mutate)) {
    const got = report.config.mutate.map((f) => normalisePath(String(f))).sort();
    if (got.join('\0') !== sample.join('\0')) problems.push(`the report's mutate list (${got.join(', ')}) is not the gate's sample (${sample.join(', ')})`);
  }
  const files = Object.keys(report.files);
  const missing = sample.filter((f) => !files.includes(f));
  const extra = files.filter((f) => !sample.includes(f));
  if (missing.length > 0) problems.push(`sampled file(s) missing from the report: ${missing.join(', ')}; every sampled file must be mutated, so leaving one out cannot raise the score`);
  if (extra.length > 0) problems.push(`the report holds file(s) the gate did not ask to mutate: ${extra.join(', ')}`);
  return problems;
}

function judge(report, config, out) {
  const { minKillRate, ignored = [] } = config.mutation;
  const failures = [];
  const weakenings = [];
  const all = Object.entries(report.files).flatMap(([file, { mutants }]) => mutants.map((m) => ({ file, m })));
  const score = scoreMutants(report.counts);
  const c = report.counts;
  const floor = `floor ${Math.round(minKillRate * 100)}%`;
  if (score.rate === null) out(`  mutation: no scoreable mutant (${floor})`);
  else out(`  mutation: killed ${score.detected}/${score.valid} (${Math.round(score.rate * 100)}%, ${floor})${c.Timeout > 0 ? `; ${c.Timeout} Timeout counted as killed` : ''}`);
  if (c.CompileError + c.RuntimeError > 0) out(`  mutation: excluded from the score: ${c.CompileError} CompileError, ${c.RuntimeError} RuntimeError`);
  const show = (status, label, why) => {
    const hits = all.filter(({ m }) => m.status === status);
    for (const { file, m } of hits.slice(0, MAX_LISTED)) out(`    ${label}: ${describe(file, m)} (${why})`);
    if (hits.length > MAX_LISTED) out(`    ... and ${hits.length - MAX_LISTED} more`);
  };
  show('Survived', 'survived', 'no test noticed');
  show('NoCoverage', 'no coverage', 'no test runs this code');

  const ignoredMutants = all.filter(({ m }) => m.status === 'Ignored');
  const unlisted = ignoredMutants.filter(({ file, m }) => !listed(ignored, file, m));
  const accepted = ignoredMutants.filter(({ file, m }) => listed(ignored, file, m));
  if (accepted.length > 0) {
    out(`  weakening: ${accepted.length} Ignored mutant(s) accepted by mutation.ignored in verify.config.json: ${grouped(accepted)}`);
    weakenings.push(`mutation.ignored accepts ${accepted.length} Ignored mutant(s)`);
  }
  if (unlisted.length > 0) {
    failures.push(`mutation: ${unlisted.length} Ignored mutant(s) not listed in mutation.ignored: ${grouped(unlisted)}; a \`Stryker disable\` comment does not pass the gate: test the code, or ask the owner to list the mutant as {"file", "line", "mutator"} in mutation.ignored`);
  }
  if (score.rate === null) failures.push('mutation: no mutant could be scored (only CompileError, RuntimeError or Ignored); the sample proves nothing');
  else if (score.rate < minKillRate) {
    failures.push(`mutation: ${score.valid - score.detected}/${score.valid} mutants survived or were not covered; the tests run this code but do not pin its behaviour (see survivors above)`);
  }
  return { failures, weakenings };
}

// -> { failures, weakenings }
async function checkReportMutation(root, config, files, texts, out) {
  const { command, testRunner, checkers = [], samples, budgetMs } = config.mutation;
  if (files.length === 0) return { failures: [`mutation: no source files found under ${config.srcDirs.join(', ')}`], weakenings: [] };
  const sample = sampleFiles(files, texts, samples);
  out(`  mutation: sampled ${sample.length} of ${files.length} source file(s): ${sample.join(', ')}`);
  const dir = makeTemp('verify-mutation-');
  try {
    const startedAt = fs.statSync(dir).mtimeMs;
    if (inside(dir, root)) throw new Error(`the report directory ${dir} is inside the project; set TMPDIR to a directory outside it`);
    const reportFile = path.join(dir, 'mutation.json');
    const configFile = path.join(dir, 'stryker.gate.json');
    fs.writeFileSync(configFile, JSON.stringify({ jsonReporter: { fileName: reportFile }, incremental: false }));
    const args = [configFile, '--testRunner', testRunner, '--mutate', sample.join(','), '--reporters', 'json',
      '--checkers', checkers.join(','), '--tempDirName', path.join(dir, 'stryker-tmp')];
    const began = Date.now();
    const result = await runVerify(`${command} ${args.map(shellQuote).join(' ')}`, { cwd: root, timeoutMs: budgetMs });
    const used = Date.now() - began;
    out(`  mutation: time used ${used} ms of the ${budgetMs} ms budget`);
    const failed = (why) => ({ failures: [`mutation: ${why}`], weakenings: [] });
    if (result.timedOut || used > budgetMs) {
      return failed(`the step exceeded its budget of ${budgetMs} ms (stopped after ${used} ms); lower mutation.samples, or ask the owner to raise mutation.budgetMs`);
    }
    if (!result.pass) {
      out(tailOutput(result.output, 20, 2000));
      return failed(`the mutation command exited with code ${result.code}; a non-zero exit always fails, whatever the report says`);
    }
    if (!fs.existsSync(reportFile)) {
      return failed(`no mutation report was written. The gate passes its own Stryker config file (holding jsonReporter.fileName) as the positional argument and --testRunner --mutate --reporters json --checkers --tempDirName, so mutation.command must end with \`stryker run\``);
    }
    if (fs.statSync(reportFile).mtimeMs < startedAt) return failed('the mutation report is older than this run (stale or copied in); only a report written during the run is trusted');
    let report;
    try { report = parseMutationReport(fs.readFileSync(reportFile, 'utf8')); } catch (err) { return failed(err.message); }
    const problems = trustProblems(report, sample);
    if (problems.length > 0) return { failures: problems.map((p) => `mutation: ${p}`), weakenings: [] };
    return judge(report, config, out);
  } finally {
    removeTemp(dir);
  }
}

module.exports = { checkReportMutation, sampleFiles };
