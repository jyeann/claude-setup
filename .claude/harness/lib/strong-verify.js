'use strict';
// A stricter "definition of done" than "tests exit 0":
//   1. tests pass, none skipped/todo, at least minTests ran
//   2. line coverage of the SOURCE files (all processes, V8) meets a total and a per-file floor
//   3. the agent's own tests are not placeholders (reference src, real assertions)
//   4. hidden holdout tests pass (optional)
//   5. user journeys pass in a browser, one passing test per journey id in ux.md (optional)
//   6. mutation spot-check: flipping one operator in src must make the suite fail
// TypeScript (.ts/.mts/.cts) is supported through Node's native type stripping; an optional type-check command
// (typecheck.command) is a separate step, because stripping does not check types.
// Config lives in verify.config.json; protect it (and this file) so the agent cannot weaken the gate.
// With "adapter": "junit" the test steps (1, replicates, holdout, journeys) are judged from a JUnit report and
// the runner's own summary instead of node:test output (lib/reports/, ADR-0003). Coverage then comes from the
// runner's lcov when the runner can write one (#58); test quality and mutation are reported as not checked
// until their readers exist.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { runVerify } = require('./verify');
const { tailOutput } = require('./stop-loop');
const { parseTestSummary, extractFailures } = require('./summary');
const { lineCoverage, collectCoverage } = require('./v8-coverage');
const { analyzeTestFile } = require('./test-quality');
const { listMutations, applyMutation, selectMutations } = require('./mutate');
const { TS_FILE, DECLARATION_FILE, stripTypes } = require('./typescript');
const { makeTemp, removeTemp, cleanupTempDirs } = require('./temp-dirs');
const { RUNNERS } = require('./reports/runners');
const { runReported, counts, formatFailures, passedNames } = require('./reports/test-run');
const { indexLcov, fileCoverage, coverageHints, isBlankSource, countLines } = require('./reports/lcov');

const SOURCE_FILE = /\.[cm]?[jt]s$/; // .tsx/.jsx are not supported: Node's type stripping does not handle JSX
const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]s$/;
const JSX_SOURCE_FILE = /\.(?:[cm]?[jt]s|[jt]sx)$/;
const JSX_TEST_FILE = /\.(?:test|spec)\.(?:[cm]?[jt]s|[jt]sx)$/;

// .tsx/.jsx count only when the runner compiles JSX and declares it (#58); the node path keeps its patterns.
const filePatterns = (config) => (config.adapter !== 'node' && RUNNERS[config.runner]?.jsx
  ? { source: JSX_SOURCE_FILE, test: JSX_TEST_FILE }
  : { source: SOURCE_FILE, test: TEST_FILE });
const lcovCoverage = (config) => config.adapter !== 'node' && typeof RUNNERS[config.runner]?.coverage === 'function';

function loadConfig(file) {
  let raw;
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (err) { throw new Error(`Cannot read config ${file}: ${err.message}`); }
  if (typeof raw.testCommand !== 'string' || !raw.testCommand.trim()) throw new Error('config.testCommand (string) is required');
  const config = {
    adapter: raw.adapter ?? 'node',
    runner: raw.runner ?? null,
    weakerGate: raw.weakerGate ?? null,
    testCommand: raw.testCommand,
    timeoutMs: raw.timeoutMs ?? 300_000,
    minTests: raw.minTests ?? 1,
    srcDirs: raw.srcDirs ?? ['src'],
    coverage: { minLines: 80, minFileLines: 50, minSourceFiles: 1, exclude: [], ...raw.coverage },
    testQuality: { dirs: ['tests'], minAssertionsPerFile: 3, ...raw.testQuality },
    replicates: raw.replicates ?? 2,
    holdout: raw.holdout ? { minTests: 1, runner: raw.runner ?? null, ...raw.holdout } : null,
    journeys: raw.journeys ? { minTests: 1, runner: raw.runner ?? null, ...raw.journeys } : null,
    typecheck: raw.typecheck ? { timeoutMs: 120_000, ...raw.typecheck } : null,
    mutation: { samples: 6, minKillRate: 0.6, copy: ['acceptance', 'package.json'], timeoutMs: 120_000, timeoutFactor: 3, minTimeoutMs: 10_000, ...raw.mutation },
  };
  validate(config);
  return config;
}

// `node` (default) is the built-in node:test path. `junit` judges any runner from its JUnit report and its own
// stdout summary (ADR-0003); `runner` names how the gate hands that runner the report path (lib/reports/runners.js).
const ADAPTERS = ['node', 'junit'];

function validateAdapter({ adapter, runner, holdout, journeys }) {
  if (!ADAPTERS.includes(adapter)) throw new Error(`adapter must be one of ${ADAPTERS.join(', ')}`);
  const runners = Object.keys(RUNNERS).join(', ');
  if (adapter === 'node') {
    if (runner !== null || holdout?.runner || journeys?.runner) throw new Error('runner applies only with "adapter": "junit"; the node adapter reads node:test output');
    return;
  }
  const named = [['runner', runner]];
  if (holdout) named.push(['holdout.runner', holdout.runner]);
  if (journeys) named.push(['journeys.runner', journeys.runner]);
  for (const [key, value] of named) {
    if (!Object.hasOwn(RUNNERS, value ?? '')) throw new Error(`${key} must be one of ${runners} with "adapter": "junit"`);
  }
}

function validate(config) {
  validateAdapter(config);
  const { weakerGate } = config;
  if (weakerGate !== null && (!Array.isArray(weakerGate.missing) || !weakerGate.missing.every((c) => typeof c === 'string')
    || typeof weakerGate.decision !== 'string' || !weakerGate.decision.trim())) {
    throw new Error('weakerGate needs "missing" (array of check names) and "decision" (where the owner\'s decision is recorded)');
  }
  const { coverage, mutation, replicates, holdout, journeys, typecheck } = config;
  const inRange = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
  if (!Number.isInteger(replicates) || replicates < 1 || replicates > 5) throw new Error('replicates must be an integer between 1 and 5');
  if (holdout && (typeof holdout.command !== 'string' || !holdout.command.trim())) throw new Error('holdout.command (string) is required when holdout is set');
  if (holdout && (!Number.isInteger(holdout.minTests) || holdout.minTests < 1)) throw new Error('holdout.minTests must be an integer >= 1');
  if (journeys && (typeof journeys.command !== 'string' || !journeys.command.trim())) throw new Error('journeys.command (string) is required when journeys is set');
  if (journeys && (!Number.isInteger(journeys.minTests) || journeys.minTests < 1)) throw new Error('journeys.minTests must be an integer >= 1');
  if (journeys && journeys.uxFile !== undefined && (typeof journeys.uxFile !== 'string' || !journeys.uxFile.trim())) throw new Error('journeys.uxFile must be a path string');
  if (typecheck && (typeof typecheck.command !== 'string' || !typecheck.command.trim())) throw new Error('typecheck.command (string) is required when typecheck is set');
  if (typecheck && (!Number.isInteger(typecheck.timeoutMs) || typecheck.timeoutMs < 1)) throw new Error('typecheck.timeoutMs must be a positive integer');
  if (!Number.isInteger(mutation.samples) || mutation.samples < 1) throw new Error('mutation.samples must be an integer >= 1');
  if (!inRange(mutation.minKillRate, 0.01, 1)) throw new Error('mutation.minKillRate must be a number in (0, 1]');
  if (!inRange(coverage.minLines, 0, 100)) throw new Error('coverage.minLines must be between 0 and 100');
  if (!inRange(coverage.minFileLines, 0, 100)) throw new Error('coverage.minFileLines must be between 0 and 100');
  if (!Number.isInteger(coverage.minSourceFiles) || coverage.minSourceFiles < 0) throw new Error('coverage.minSourceFiles must be an integer >= 0');
}

function walk(root, dir, accept) {
  const abs = path.join(root, dir);
  if (!fs.existsSync(abs)) return [];
  return fs.readdirSync(abs, { withFileTypes: true }).flatMap((entry) => {
    const rel = path.posix.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : walk(root, rel, accept);
    return accept.test(entry.name) ? [rel] : [];
  });
}

const isExcluded = (rel, exclude) => exclude.some((e) => rel === e || rel.startsWith(e.endsWith('/') ? e : `${e}/`));
const sourceFiles = (root, config) => {
  const { source, test } = filePatterns(config);
  return config.srcDirs
    .flatMap((d) => walk(root, d, source))
    .filter((f) => !test.test(f) && !DECLARATION_FILE.test(f) && !isExcluded(f, config.coverage.exclude));
};

function ranges(lines) {
  const out = [];
  for (const n of lines) {
    const last = out[out.length - 1];
    if (last && n === last[1] + 1) last[1] = n; else out.push([n, n]);
  }
  return out.map(([a, b]) => (a === b ? `${a}` : `${a}-${b}`)).join(', ');
}

function checkTests(result, config) {
  const failures = [];
  const s = parseTestSummary(result.output);
  if (result.timedOut) failures.push(`tests timed out after ${config.timeoutMs} ms`);
  else if (!result.pass || s.fail > 0) failures.push(`tests failed (${s.fail} failing)`);
  if (s.skipped > 0 || s.todo > 0) failures.push(`${s.skipped} skipped and ${s.todo} todo test(s): skipping is not passing`);
  if (s.tests < config.minTests) failures.push(`only ${s.tests} test(s) ran; at least ${config.minTests} expected`);
  return { summary: s, failures };
}

// Node strips types without checking them, so a project can opt into a real compiler run. Runs after the tests,
// also under --fast (it is cheap and the agent needs the feedback), and only reports the tail of the output.
async function checkTypes(root, config, out) {
  const { command, timeoutMs } = config.typecheck;
  const result = await runVerify(command, { cwd: root, timeoutMs });
  if (result.pass) { out('  ok'); return []; }
  out(tailOutput(result.output, 25, 2500));
  return [result.timedOut ? `type check timed out after ${timeoutMs} ms` : `type check failed: \`${command}\` exited non-zero (output tail above)`];
}

function checkCoverage(root, config, covDir, out) {
  const files = sourceFiles(root, config);
  if (files.length === 0) return [`no source files found under ${config.srcDirs.join(', ')}`];
  const failures = [];
  if (files.length < config.coverage.minSourceFiles) {
    failures.push(`coverage: expected at least ${config.coverage.minSourceFiles} source file(s) under ${config.srcDirs.join(', ')}, found ${files.length}; do not delete source to raise coverage`);
  }
  const byFile = collectCoverage(covDir, root);
  let executable = 0;
  let covered = 0;
  for (const rel of files) {
    const text = fs.readFileSync(path.join(root, rel), 'utf8');
    let erasedSource;
    if (TS_FILE.test(rel)) { try { erasedSource = stripTypes(text); } catch { /* unparsable: count every non-comment line */ } }
    const r = lineCoverage(text, byFile.get(rel) ?? [], { erasedSource });
    executable += r.executable;
    covered += r.covered;
    const detail = r.uncoveredLines.length ? ` uncovered lines: ${ranges(r.uncoveredLines)}` : '';
    out(`  ${rel}  ${r.pct}% (${r.covered}/${r.executable})${detail}`);
    if (r.pct < config.coverage.minFileLines) {
      const hint = r.pct === 0 ? ' (0% usually means the file was never loaded, or a child process running it was killed by a signal before it could write coverage: handle SIGTERM and exit 0)' : '';
      failures.push(`coverage: ${rel} is ${r.pct}%, below the ${config.coverage.minFileLines}% per-file floor${hint}`);
    }
  }
  const total = executable === 0 ? 100 : Math.round((covered / executable) * 10000) / 100;
  out(`  total source line coverage: ${total}% (floor ${config.coverage.minLines}%)`);
  if (total < config.coverage.minLines) failures.push(`coverage: total ${total}% is below the ${config.coverage.minLines}% floor`);
  return failures;
}

// coverage.exclude takes files out of the measurement, so every run says so (#55: printed as a weakening).
function printExcluded(config, out) {
  if (config.coverage.exclude.length > 0) out(`  weakening: coverage.exclude leaves ${config.coverage.exclude.join(', ')} unmeasured`);
}

// Coverage judged from the runner's lcov (#58). The file set comes from srcDirs, never from the report: a source
// file without a record fails by name, because a file left out of the report would otherwise raise the score.
function checkLcovCoverage(root, config, run, out) {
  const files = sourceFiles(root, config);
  printExcluded(config, out);
  const inSource = config.srcDirs.flatMap((d) => walk(root, d, filePatterns(config).test))
    .map((rel) => `coverage: ${rel} is a test file inside the source dir (it is excluded from coverage); keep tests in ${config.testQuality.dirs.join(', ')}`);
  if (files.length === 0) return [`no source files found under ${config.srcDirs.join(', ')}`, ...inSource];
  const failures = [...inSource];
  if (files.length < config.coverage.minSourceFiles) {
    failures.push(`coverage: expected at least ${config.coverage.minSourceFiles} source file(s) under ${config.srcDirs.join(', ')}, found ${files.length}; do not delete source to raise coverage`);
  }
  // Ignore hints make lines vanish from lcov, so they are refused outright; coverage.exclude (printed) is the
  // only way to leave code unmeasured.
  const texts = new Map(files.map((rel) => [rel, fs.readFileSync(path.join(root, rel), 'utf8')]));
  for (const [rel, text] of texts) {
    for (const line of coverageHints(text)) failures.push(`coverage: ${rel}:${line} has a coverage ignore hint; lines it hides are not measured. Remove it, or list the file in coverage.exclude (printed as a weakening)`);
  }
  if (run.coverageProblems.length > 0) return [...failures, ...run.coverageProblems.map((p) => `coverage: ${p}`)];
  const roots = [...new Set([path.resolve(root), fs.realpathSync(root)])];
  const byFile = indexLcov(run.lcov, { roots, files });
  let executable = 0;
  let covered = 0;
  for (const rel of files) {
    const lines = byFile.get(rel);
    if (!lines) {
      out(`  ${rel}  missing from the lcov report`);
      failures.push(`coverage: ${rel} is missing from the lcov report; every source file under ${config.srcDirs.join(', ')} must appear in it (the gate passes --coverage.include for each srcDir; a file the report leaves out fails rather than being skipped)`);
      continue;
    }
    const length = countLines(texts.get(rel));
    const beyond = [...lines.keys()].find((n) => n > length);
    if (beyond !== undefined) failures.push(`coverage: ${rel}: the lcov report names line ${beyond}, but the file has ${length} line(s); the report does not describe this file`);
    if (lines.size === 0 && !isBlankSource(texts.get(rel))) failures.push(`coverage: ${rel}: no executable lines reported for a non-empty file (only a file that is blank after removing comments may have none)`);
    const r = fileCoverage(lines);
    executable += r.executable;
    covered += r.covered;
    const detail = r.uncoveredLines.length ? ` uncovered lines: ${ranges(r.uncoveredLines)}` : '';
    out(`  ${rel}  ${r.pct}% (${r.covered}/${r.executable})${detail}`);
    if (r.pct < config.coverage.minFileLines) failures.push(`coverage: ${rel} is ${r.pct}%, below the ${config.coverage.minFileLines}% per-file floor`);
  }
  const total = executable === 0 ? 100 : Math.round((covered / executable) * 10000) / 100;
  out(`  total source line coverage: ${total}% (floor ${config.coverage.minLines}%)`);
  if (total < config.coverage.minLines) failures.push(`coverage: total ${total}% is below the ${config.coverage.minLines}% floor`);
  return failures;
}

function checkTestQuality(root, config) {
  const { dirs, minAssertionsPerFile } = config.testQuality;
  const files = dirs.flatMap((d) => walk(root, d, TEST_FILE));
  const hidden = config.srcDirs.flatMap((d) => walk(root, d, TEST_FILE))
    .map((rel) => `test quality: ${rel} is a test file inside the source dir (it is excluded from coverage); keep tests in ${dirs.join(', ')}`);
  if (dirs.length > 0 && files.length === 0) return [`no unit tests found in ${dirs.join(', ')}`, ...hidden];
  return hidden.concat(files.flatMap((rel) => {
    const { issues } = analyzeTestFile(fs.readFileSync(path.join(root, rel), 'utf8'), { srcDirs: config.srcDirs, minAssertions: minAssertionsPerFile });
    return issues.map((issue) => `test quality: ${rel} ${issue}`);
  }));
}

const runSignature = (result) => {
  const s = parseTestSummary(result.output);
  return `${result.pass ? 'pass' : 'fail'}: ${s.pass}/${s.tests} passing, ${s.fail} failing`;
};

// Variance check (the first run's tests passed): the same command must give the same answer again, or the
// gate is noise and the agent would be steered by luck.
async function checkReplicates(root, config, first, out) {
  const failures = [];
  const expected = runSignature(first);
  for (let run = 2; run <= config.replicates; run += 1) {
    const again = await runVerify(config.testCommand, { cwd: root, timeoutMs: config.timeoutMs });
    const got = runSignature(again);
    if (got !== expected) {
      failures.push(`flaky tests: run 1 -> ${expected}; run ${run} -> ${got}. The suite is non-deterministic, so it cannot be a definition of done; make it deterministic`);
      out(tailOutput(again.output, 25, 2500));
      break;
    }
  }
  out(failures.length === 0 ? `  replicates: ${config.replicates} runs agree` : '  replicates: DISAGREE');
  return failures;
}

// Hidden acceptance tests: run only here, and only counts are reported, so the agent cannot code to them.
async function checkHoldout(root, config, out) {
  const { command, minTests } = config.holdout;
  const result = await runVerify(command, { cwd: root, timeoutMs: config.timeoutMs });
  const s = parseTestSummary(result.output);
  out(`  holdout: ${s.pass}/${s.tests} passing`);
  const detail = 'Details are withheld on purpose: re-read the spec\'s acceptance criteria and handle cases beyond the visible tests.';
  if (result.timedOut) return [`holdout: the hidden tests timed out. ${detail}`];
  if (s.tests < minTests) return [`holdout: only ${s.tests} hidden test(s) ran; at least ${minTests} expected (is the holdout set missing?)`];
  if (s.skipped > 0 || s.todo > 0) return ['holdout: skipped or todo hidden tests are not passing'];
  if (!result.pass || s.fail > 0) return [`holdout: ${s.fail || 'some'} of ${s.tests} hidden acceptance test(s) fail. ${detail}`];
  return [];
}

// Journey and UI-check ids as ux.md writes them: J1, J12, UC3.
const journeyIds = (text) => [...new Set(text.match(/\b(?:J|UC)\d+\b/g) ?? [])];
const PASSED_TEST = /^\s*(?:ok \d+ - |✔ )(.+)$/gm;
const passedTestNames = (output) => [...output.matchAll(PASSED_TEST)].map((m) => m[1]).filter((name) => !/#\s*(?:SKIP|TODO)/i.test(name));

// "Done means a person can use it": the user journeys run in a real browser as part of the gate, and every
// journey or UI check that ux.md names must have a passing test named after it. Unlike the holdout, failures
// are shown in full, because the journeys are the visible requirement.
async function checkJourneys(root, config, out) {
  const { command, minTests, uxFile } = config.journeys;
  const result = await runVerify(command, { cwd: root, timeoutMs: config.timeoutMs });
  const s = parseTestSummary(result.output);
  out(`  journeys: ${s.pass}/${s.tests} passing`);
  const failures = [];
  if (result.timedOut) failures.push(`journeys: the browser walkthrough timed out after ${config.timeoutMs} ms`);
  else if (!result.pass || s.fail > 0) failures.push(`journeys: ${s.fail || 'some'} browser journey test(s) fail; the product does not work for a user yet`);
  if (s.skipped > 0 || s.todo > 0) failures.push('journeys: skipped or todo journey tests are not passing');
  if (s.tests < minTests) failures.push(`journeys: only ${s.tests} journey test(s) ran; at least ${minTests} expected`);
  if (failures.length > 0) out(extractFailures(result.output) || tailOutput(result.output, 25, 2500));
  return uxFile ? [...failures, ...checkJourneyIds(root, uxFile, passedTestNames(result.output))] : failures;
}

// Every journey or UI-check id that ux.md names needs a passing test whose name contains it.
function checkJourneyIds(root, uxFile, names) {
  const file = path.resolve(root, uxFile);
  if (!fs.existsSync(file)) return [`journeys: ${uxFile} not found; it lists the journeys the walkthrough must cover`];
  const failures = [];
  const ids = journeyIds(fs.readFileSync(file, 'utf8'));
  if (ids.length === 0) failures.push(`journeys: ${uxFile} names no journey (J1, J2, ...) or UI check (UC1, ...) ids`);
  const missing = ids.filter((id) => !names.some((n) => new RegExp(`\\b${id}\\b`).test(n)));
  if (missing.length > 0) failures.push(`journeys: no passing browser test is named for ${missing.join(', ')} (${uxFile}); start each test name with the id it walks, e.g. "J1: ..."`);
  return failures;
}

// ---- Report contract (adapter "junit", ADR-0003): the same checks, judged from JUnit and the runner's summary.

const trustFailures = (label, run) => run.problems.map((p) => `${label}: ${p}`);

function judgeReportTests(run, config) {
  const failures = trustFailures('tests', run);
  const s = counts(run);
  if (run.result.timedOut) failures.push(`tests timed out after ${config.timeoutMs} ms`);
  else if (!run.result.pass && run.report && s.fail === 0) failures.push(`tests failed: the command exited with code ${run.result.code} although its JUnit report shows no failing test; a non-zero exit always fails`);
  else if (!run.result.pass || s.fail > 0) failures.push(`tests failed (${s.fail} failing)`);
  if (s.skipped > 0) failures.push(`${s.skipped} skipped or todo test(s): skipping is not passing`);
  if (s.tests < config.minTests) failures.push(`only ${s.tests} test(s) ran; at least ${config.minTests} expected`);
  return { summary: s, failures };
}

const reportSignature = (run) => {
  const s = counts(run);
  return `${run.result.pass ? 'pass' : 'fail'}: ${s.pass}/${s.tests} passing, ${s.fail} failing`;
};

async function checkReportReplicates(root, config, first, out) {
  const failures = [];
  const expected = reportSignature(first);
  for (let run = 2; run <= config.replicates; run += 1) {
    const again = await runReported(config.testCommand, config.runner, { cwd: root, timeoutMs: config.timeoutMs });
    const got = reportSignature(again);
    if (again.problems.length > 0) failures.push(...trustFailures(`replicate run ${run}`, again));
    else if (got !== expected) failures.push(`flaky tests: run 1 -> ${expected}; run ${run} -> ${got}. The suite is non-deterministic, so it cannot be a definition of done; make it deterministic`);
    if (failures.length > 0) {
      out(tailOutput(again.result.output, 25, 2500));
      break;
    }
  }
  out(failures.length === 0 ? `  replicates: ${config.replicates} runs agree` : '  replicates: DISAGREE');
  return failures;
}

async function checkReportTests(root, config, fast, out) {
  const coverage = lcovCoverage(config) ? config.srcDirs : null;
  const run = await runReported(config.testCommand, config.runner, { cwd: root, timeoutMs: config.timeoutMs, coverage });
  const tests = judgeReportTests(run, config);
  const failures = [...tests.failures];
  let failingTests = '';
  out(`  ${tests.summary.pass}/${tests.summary.tests} passing`);
  if (failures.length > 0) {
    failingTests = formatFailures(run.report);
    if (failingTests === '') out(tailOutput(run.result.output, 25, 2500));
  }
  if (failures.length === 0 && config.replicates > 1) {
    if (fast) out('  replicates: skipped (--fast); the full run is the definition of done');
    else failures.push(...await checkReportReplicates(root, config, run, out));
  }
  return { failures, failingTests, run };
}

// Counts only: no test name, message, path or output of the hidden set is ever printed.
async function checkReportHoldout(root, config, out) {
  const { command, minTests, runner } = config.holdout;
  const run = await runReported(command, runner, { cwd: root, timeoutMs: config.timeoutMs });
  const s = counts(run);
  out(`  holdout: ${s.pass}/${s.tests} passing`);
  const detail = 'Details are withheld on purpose: re-read the spec\'s acceptance criteria and handle cases beyond the visible tests.';
  if (run.result.timedOut) return [`holdout: the hidden tests timed out. ${detail}`];
  // Trust problems are summarised in one fixed sentence: even their wording is not allowed to carry report text.
  if (run.problems.length > 0) return ['holdout: the JUnit report could not be trusted (parse or totals problem); details hidden'];
  if (s.tests < minTests) return [`holdout: only ${s.tests} hidden test(s) ran; at least ${minTests} expected (is the holdout set missing?)`];
  if (s.skipped > 0) return ['holdout: skipped or todo hidden tests are not passing'];
  if (!run.result.pass || s.fail > 0) return [`holdout: ${s.fail || 'some'} of ${s.tests} hidden acceptance test(s) fail. ${detail}`];
  return [];
}

async function checkReportJourneys(root, config, out) {
  const { command, minTests, uxFile, runner } = config.journeys;
  const run = await runReported(command, runner, { cwd: root, timeoutMs: config.timeoutMs });
  const s = counts(run);
  out(`  journeys: ${s.pass}/${s.tests} passing`);
  const failures = trustFailures('journeys', run);
  if (run.result.timedOut) failures.push(`journeys: the browser walkthrough timed out after ${config.timeoutMs} ms`);
  else if (!run.result.pass || s.fail > 0) failures.push(`journeys: ${s.fail || 'some'} browser journey test(s) fail; the product does not work for a user yet`);
  if (s.skipped > 0) failures.push('journeys: skipped or todo journey tests are not passing');
  if (s.tests < minTests) failures.push(`journeys: only ${s.tests} journey test(s) ran; at least ${minTests} expected`);
  if (failures.length > 0) out(formatFailures(run.report) || tailOutput(run.result.output, 25, 2500));
  return uxFile ? [...failures, ...checkJourneyIds(root, uxFile, passedNames(run.report))] : failures;
}

// A mutant that hangs the suite counts as killed, so wait only a few multiples of the healthy run time.
function mutationTimeoutMs(baselineMs, { timeoutMs, timeoutFactor, minTimeoutMs }) {
  return Math.min(timeoutMs, Math.max(minTimeoutMs, Math.round(baselineMs * timeoutFactor)));
}

function copyProject(root, copy) {
  const tmp = makeTemp('verify-mutants-');
  for (const entry of copy) {
    const from = path.join(root, entry);
    if (fs.existsSync(from)) fs.cpSync(from, path.join(tmp, entry), { recursive: true });
  }
  const modules = path.join(root, 'node_modules');
  if (fs.existsSync(modules)) fs.symlinkSync(modules, path.join(tmp, 'node_modules'), 'dir');
  return tmp;
}

async function checkMutation(root, config, baselineMs, out) {
  const files = sourceFiles(root, config);
  const texts = new Map(files.map((f) => [f, fs.readFileSync(path.join(root, f), 'utf8')]));
  const failures = [];
  const pool = files.flatMap((file) => {
    try { return listMutations(texts.get(file), { typescript: TS_FILE.test(file) }).map((m) => ({ ...m, file })); } catch (err) {
      failures.push(`mutation: cannot type-strip ${file} (${err.message.split('\n')[0]}); Node's type stripping needs this file to parse as erasable TypeScript, so it could not be mutated`);
      return [];
    }
  });
  if (failures.length > 0) return failures;
  if (pool.length === 0) { out('  mutation: no mutable operators found, skipped'); return []; }

  const seed = crypto.createHash('sha1').update([...texts.values()].join('\0')).digest('hex');
  const picked = selectMutations(pool, config.mutation.samples, seed);
  const tmp = copyProject(root, [...new Set([...config.srcDirs, ...config.testQuality.dirs, ...config.mutation.copy])]);
  const timeoutMs = mutationTimeoutMs(baselineMs, config.mutation);
  const survivors = [];
  const env = { CLAUDE_PROJECT_DIR: tmp };
  try {
    const baseline = await runVerify(config.testCommand, { cwd: tmp, timeoutMs, env });
    if (!baseline.pass) {
      out(tailOutput(baseline.output, 20, 2000));
      return ['mutation: baseline run of the unmutated copy failed, so mutants would all look killed. The copy is missing something the tests need: add it to mutation.copy in verify.config.json'];
    }
    for (const m of picked) {
      const target = path.join(tmp, m.file);
      fs.writeFileSync(target, applyMutation(texts.get(m.file), m));
      const r = await runVerify(config.testCommand, { cwd: tmp, timeoutMs, env });
      fs.writeFileSync(target, texts.get(m.file));
      if (r.pass) survivors.push(m);
    }
  } finally {
    removeTemp(tmp);
  }
  if (picked.length === 0) return ['mutation: no mutants could be sampled'];
  const killRate = (picked.length - survivors.length) / picked.length;
  out(`  mutation: killed ${picked.length - survivors.length}/${picked.length} (${Math.round(killRate * 100)}%, floor ${Math.round(config.mutation.minKillRate * 100)}%)`);
  for (const m of survivors) out(`    survived: ${m.file}:${m.line} \`${m.from}\` -> \`${m.to}\` (no test noticed)`);
  return killRate < config.mutation.minKillRate
    ? [`mutation: ${survivors.length}/${picked.length} mutants survived; the tests run this code but do not pin its behaviour (see survivors above)`]
    : [];
}

// A gate that cannot run some checks passes only on a recorded owner decision naming exactly those checks
// (#55: a weaker gate is an owner choice with the missing checks listed, never a silent pass).
function checkWeakerGate(config, notChecked) {
  const accepted = config.weakerGate;
  if (!accepted) {
    if (notChecked.length === 0) return [];
    return [`weaker gate: the ${config.adapter} adapter does not run ${notChecked.join(', ')}; this needs an owner decision recorded as "weakerGate": {"missing": ${JSON.stringify(notChecked)}, "decision": "<where it is recorded>"} in verify.config.json`];
  }
  const unlisted = notChecked.filter((c) => !accepted.missing.includes(c));
  const extra = accepted.missing.filter((c) => !notChecked.includes(c));
  if (unlisted.length === 0 && extra.length === 0) return [];
  const detail = [unlisted.length > 0 ? ` (not listed: ${unlisted.join(', ')})` : '', extra.length > 0 ? ` (listed but checked: ${extra.join(', ')})` : ''].join('');
  return [`weaker gate: weakerGate.missing must list exactly ${notChecked.join(', ') || 'nothing'}${detail}`];
}

async function strongVerify(root, config, { fast = false, out = console.log } = {}) {
  const reports = config.adapter !== 'node';
  const notChecked = [];
  const notAvailable = (step, label) => { notChecked.push(label); out(`  ${step}: not available for the ${config.adapter} adapter`); };
  const covDir = makeTemp('verify-cov-');
  const failures = [];
  let failingTests = '';
  let baselineMs = 0;
  let reportRun = null;
  try {
    out('[1/7] tests');
    if (reports) {
      const tests = await checkReportTests(root, config, fast, out);
      failures.push(...tests.failures);
      failingTests = tests.failingTests;
      reportRun = tests.run;
    } else {
      const startedAt = Date.now();
      const result = await runVerify(config.testCommand, { cwd: root, timeoutMs: config.timeoutMs, env: { NODE_V8_COVERAGE: covDir } });
      baselineMs = Date.now() - startedAt;
      const tests = checkTests(result, config);
      failures.push(...tests.failures);
      out(`  ${tests.summary.pass}/${tests.summary.tests} passing`);
      if (tests.failures.length > 0) {
        failingTests = extractFailures(result.output);
        if (failingTests === '') out(tailOutput(result.output, 25, 2500));
      }
      if (tests.failures.length === 0 && config.replicates > 1) {
        if (fast) out('  replicates: skipped (--fast); the full run is the definition of done');
        else failures.push(...await checkReplicates(root, config, result, out));
      }
    }

    out('[2/7] type check');
    if (!config.typecheck) out('  typecheck: not configured');
    else failures.push(...await checkTypes(root, config, out));

    out('[3/7] source coverage');
    if (reports && lcovCoverage(config)) failures.push(...checkLcovCoverage(root, config, reportRun, out));
    else if (reports) notAvailable('coverage', 'coverage');
    else {
      printExcluded(config, out);
      failures.push(...checkCoverage(root, config, covDir, out));
    }
    out('[4/7] test quality');
    if (reports) notAvailable('test quality', 'test-quality');
    else {
      const quality = checkTestQuality(root, config);
      failures.push(...quality);
      out(quality.length === 0 ? '  ok' : quality.map((q) => `  ${q}`).join('\n'));
    }

    out('[5/7] hidden holdout set');
    if (!config.holdout) out('  holdout: not configured');
    else if (fast) out('  holdout: skipped (--fast); the full run is the definition of done');
    else if (failures.length > 0) out('  holdout: skipped until the checks above pass');
    else failures.push(...await (reports ? checkReportHoldout : checkHoldout)(root, config, out));

    out('[6/7] user journeys in a browser');
    if (!config.journeys) out('  journeys: not configured');
    else if (fast) out('  journeys: skipped (--fast); the full run is the definition of done');
    else if (failures.length > 0) out('  journeys: skipped until the checks above pass');
    else failures.push(...await (reports ? checkReportJourneys : checkJourneys)(root, config, out));

    out('[7/7] mutation spot-check');
    if (reports) notAvailable('mutation', 'mutation');
    else if (fast) out('  mutation: skipped (--fast); the full run is the definition of done');
    else if (failures.length > 0) out('  mutation: skipped until the checks above pass');
    else failures.push(...await checkMutation(root, config, baselineMs, out));
  } finally {
    removeTemp(covDir);
  }
  failures.push(...checkWeakerGate(config, notChecked));
  out(failures.length === 0 ? 'VERIFY PASSED' : `VERIFY FAILED:\n${failures.map((f) => `  - ${f}`).join('\n')}`);
  if (notChecked.length > 0) {
    const decision = config.weakerGate ? ` (owner decision: ${config.weakerGate.decision})` : '';
    out(`  not checked (weaker gate, ${config.adapter} adapter): ${notChecked.join(', ')}${decision}`);
  }
  const weakenings = config.coverage.exclude.length > 0 ? [`coverage.exclude ${config.coverage.exclude.join(', ')}`] : [];
  if (weakenings.length > 0) out(`  weakened (verify.config.json): ${weakenings.join('; ')}`);
  if (failingTests !== '') out(`\nFailing tests (fix these at the root cause):\n${failingTests}`);
  return { pass: failures.length === 0, failures, notChecked, weakenings };
}

module.exports = { strongVerify, loadConfig, mutationTimeoutMs, cleanupTempDirs, filePatterns };
