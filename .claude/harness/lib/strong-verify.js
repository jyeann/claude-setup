'use strict';
// A stricter "definition of done" than "tests exit 0":
//   1. tests pass, none skipped/todo, at least minTests ran
//   2. line coverage of the SOURCE files (all processes, V8) meets a total and a per-file floor
//   3. the agent's own tests are not placeholders (reference src, real assertions)
//   4. hidden holdout tests pass (optional)
//   5. user journeys pass in a browser, one passing test per journey id in ux.md (optional)
//   6. mutation spot-check: flipping one operator in src must make the suite fail
// Runners: node:test (default; coverage from raw V8), Vitest and Jest ("runner": "vitest"|"jest"; coverage from the
// runner's own Istanbul coverage-final.json, written to $VERIFY_COVERAGE_DIR by the test command).
// TypeScript (.ts/.mts/.cts) is supported through Node's native type stripping; an optional type-check command
// (typecheck.command) is a separate step, because stripping does not check types.
// Config lives in verify.config.json; protect it (and this file) so the agent cannot weaken the gate.
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runVerify } = require('./verify');
const { tailOutput } = require('./stop-loop');
const { parseTestSummary, extractFailures } = require('./summary');
const { lineCoverage, collectCoverage } = require('./v8-coverage');
const { collectIstanbul, istanbulLineCoverage, REPORT } = require('./istanbul-coverage');
const { analyzeTestFile } = require('./test-quality');
const { listMutations, applyMutation, selectMutations } = require('./mutate');
const { TS_FILE, DECLARATION_FILE, stripTypes } = require('./typescript');

const SOURCE_FILE = /\.[cm]?[jt]s$/; // .tsx/.jsx are not supported: Node's type stripping does not handle JSX
const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]s$/;

const RUNNERS = ['node', 'vitest', 'jest'];
const VITE_CONFIGS = ['js', 'ts', 'mjs', 'mts', 'cjs', 'cts'].flatMap((e) => [`vitest.config.${e}`, `vite.config.${e}`, `vitest.workspace.${e}`]);
// Config the runner reads from the project root; copied into the mutation copy when present.
const RUNNER_FILES = {
  node: [],
  vitest: [...VITE_CONFIGS, 'tsconfig.json'],
  jest: ['jest.config.js', 'jest.config.cjs', 'jest.config.mjs', 'jest.config.ts', 'jest.config.json', 'babel.config.js', 'babel.config.cjs', '.babelrc', 'tsconfig.json'],
};
const COVERAGE_HINT = {
  vitest: '`--coverage --coverage.reporter=json --coverage.reportOnFailure=true --coverage.reportsDirectory="$VERIFY_COVERAGE_DIR"` (needs @vitest/coverage-v8)',
  jest: '`--coverage --coverageReporters=json --coverageDirectory="$VERIFY_COVERAGE_DIR"`',
};

function loadConfig(file) {
  let raw;
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (err) { throw new Error(`Cannot read config ${file}: ${err.message}`); }
  if (typeof raw.testCommand !== 'string' || !raw.testCommand.trim()) throw new Error('config.testCommand (string) is required');
  const config = {
    testCommand: raw.testCommand,
    runner: raw.runner ?? 'node',
    timeoutMs: raw.timeoutMs ?? 300_000,
    minTests: raw.minTests ?? 1,
    srcDirs: raw.srcDirs ?? ['src'],
    coverage: { minLines: 80, minFileLines: 50, minSourceFiles: 1, exclude: [], ...raw.coverage },
    testQuality: { dirs: ['tests'], minAssertionsPerFile: 3, srcAliases: [], ...raw.testQuality },
    replicates: raw.replicates ?? 2,
    holdout: raw.holdout ? { minTests: 1, ...raw.holdout } : null,
    journeys: raw.journeys ? { minTests: 1, ...raw.journeys } : null,
    typecheck: raw.typecheck ? { timeoutMs: 120_000, ...raw.typecheck } : null,
    mutation: { samples: 6, minKillRate: 0.6, copy: ['acceptance', 'package.json'], exclude: [], timeoutMs: 120_000, timeoutFactor: 3, minTimeoutMs: 10_000, ...raw.mutation },
  };
  validate(config);
  return config;
}

function validate({ runner, testQuality, coverage, mutation, replicates, holdout, journeys, typecheck }) {
  const inRange = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
  if (!RUNNERS.includes(runner)) throw new Error(`runner must be one of ${RUNNERS.join(', ')}`);
  if (!Array.isArray(testQuality.srcAliases) || testQuality.srcAliases.some((a) => typeof a !== 'string' || !a)) throw new Error('testQuality.srcAliases must be an array of non-empty strings');
  if (!Array.isArray(mutation.exclude) || mutation.exclude.some((e) => typeof e !== 'string')) throw new Error('mutation.exclude must be an array of paths');
  if (mutation.testCommand !== undefined && (typeof mutation.testCommand !== 'string' || !mutation.testCommand.trim())) throw new Error('mutation.testCommand must be a non-empty string');
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

// Temp dirs are removed on normal exit and, via cleanupTempDirs(), when the process is signalled.
const tempDirs = new Set();
function makeTemp(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.add(dir);
  return dir;
}
function removeTemp(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  tempDirs.delete(dir);
}
function cleanupTempDirs() { for (const dir of [...tempDirs]) removeTemp(dir); }

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
const sourceFiles = (root, config) => config.srcDirs
  .flatMap((d) => walk(root, d, SOURCE_FILE))
  .filter((f) => !TEST_FILE.test(f) && !DECLARATION_FILE.test(f) && !isExcluded(f, config.coverage.exclude));

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

// Where this runner's coverage goes: raw V8 for node:test, an Istanbul report in $VERIFY_COVERAGE_DIR for the others.
const coverageEnv = (config, dir) => (config.runner === 'node' ? { NODE_V8_COVERAGE: dir } : { VERIFY_COVERAGE_DIR: dir });

function checkCoverage(root, config, covDir, out, testsPassed = true) {
  const files = sourceFiles(root, config);
  if (files.length === 0) return [`no source files found under ${config.srcDirs.join(', ')}`];
  const failures = [];
  if (files.length < config.coverage.minSourceFiles) {
    failures.push(`coverage: expected at least ${config.coverage.minSourceFiles} source file(s) under ${config.srcDirs.join(', ')}, found ${files.length}; do not delete source to raise coverage`);
  }
  const viaRunner = config.runner !== 'node';
  const byFile = viaRunner ? collectIstanbul(covDir, root) : collectCoverage(covDir, root);
  if (byFile === null) {
    const why = testsPassed ? '' : ' (the tests failed, and Vitest writes no report then unless coverage.reportOnFailure is on)';
    return [...failures, `coverage: the test command wrote no ${REPORT} to $VERIFY_COVERAGE_DIR${why}. For ${config.runner}, add ${COVERAGE_HINT[config.runner]} to testCommand`];
  }
  let executable = 0;
  let covered = 0;
  for (const rel of files) {
    const text = fs.readFileSync(path.join(root, rel), 'utf8');
    let erasedSource;
    if (TS_FILE.test(rel)) { try { erasedSource = stripTypes(text); } catch { /* unparsable: count every non-comment line */ } }
    const r = viaRunner && byFile.has(rel) ? istanbulLineCoverage(byFile.get(rel)) : lineCoverage(text, viaRunner ? [] : byFile.get(rel) ?? [], { erasedSource });
    executable += r.executable;
    covered += r.covered;
    const detail = r.uncoveredLines.length ? ` uncovered lines: ${ranges(r.uncoveredLines)}` : '';
    out(`  ${rel}  ${r.pct}% (${r.covered}/${r.executable})${detail}`);
    if (r.pct < config.coverage.minFileLines) {
      const wrongRunner = !viaRunner && /\b(?:vitest|jest)\b/.test(config.testCommand) ? ' (testCommand runs Vitest or Jest: set "runner" in verify.config.json so coverage is read from their report)' : '';
      const hint = wrongRunner || (r.pct === 0 ? ' (0% usually means the file was never loaded, or a child process running it was killed by a signal before it could write coverage: handle SIGTERM and exit 0)' : '');
      failures.push(`coverage: ${rel} is ${r.pct}%, below the ${config.coverage.minFileLines}% per-file floor${hint}`);
    }
  }
  const total = executable === 0 ? 100 : Math.round((covered / executable) * 10000) / 100;
  out(`  total source line coverage: ${total}% (floor ${config.coverage.minLines}%)`);
  if (total < config.coverage.minLines) failures.push(`coverage: total ${total}% is below the ${config.coverage.minLines}% floor`);
  return failures;
}

function checkTestQuality(root, config) {
  const { dirs, minAssertionsPerFile, srcAliases } = config.testQuality;
  const files = dirs.flatMap((d) => walk(root, d, TEST_FILE));
  const hidden = config.srcDirs.flatMap((d) => walk(root, d, TEST_FILE))
    .map((rel) => `test quality: ${rel} is a test file inside the source dir (it is excluded from coverage); keep tests in ${dirs.join(', ')}`);
  if (dirs.length > 0 && files.length === 0) return [`no unit tests found in ${dirs.join(', ')}`, ...hidden];
  return hidden.concat(files.flatMap((rel) => {
    const { issues } = analyzeTestFile(fs.readFileSync(path.join(root, rel), 'utf8'), { srcDirs: config.srcDirs, minAssertions: minAssertionsPerFile, srcAliases });
    return issues.map((issue) => `test quality: ${rel} ${issue}`);
  }));
}

const runSignature = (result) => {
  const s = parseTestSummary(result.output);
  return `${result.pass ? 'pass' : 'fail'}: ${s.pass}/${s.tests} passing, ${s.fail} failing`;
};

// Variance check (the first run's tests passed): the same command must give the same answer again, or the
// gate is noise and the agent would be steered by luck.
async function checkReplicates(root, config, first, out, env) {
  const failures = [];
  const expected = runSignature(first);
  for (let run = 2; run <= config.replicates; run += 1) {
    const again = await runVerify(config.testCommand, { cwd: root, timeoutMs: config.timeoutMs, env });
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
async function checkHoldout(root, config, out, env) {
  const { command, minTests } = config.holdout;
  const result = await runVerify(command, { cwd: root, timeoutMs: config.timeoutMs, env });
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
  if (uxFile) {
    const file = path.resolve(root, uxFile);
    if (!fs.existsSync(file)) return [...failures, `journeys: ${uxFile} not found; it lists the journeys the walkthrough must cover`];
    const ids = journeyIds(fs.readFileSync(file, 'utf8'));
    if (ids.length === 0) failures.push(`journeys: ${uxFile} names no journey (J1, J2, ...) or UI check (UC1, ...) ids`);
    const names = passedTestNames(result.output);
    const missing = ids.filter((id) => !names.some((n) => new RegExp(`\\b${id}\\b`).test(n)));
    if (missing.length > 0) failures.push(`journeys: no passing browser test is named for ${missing.join(', ')} (${uxFile}); start each test name with the id it walks, e.g. "J1: ..."`);
  }
  return failures;
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

async function checkMutation(root, config, baselineMs, out, scratchEnv) {
  const files = sourceFiles(root, config).filter((f) => !isExcluded(f, config.mutation.exclude));
  const texts = new Map(files.map((f) => [f, fs.readFileSync(path.join(root, f), 'utf8')]));
  const failures = [];
  const pool = files.flatMap((file) => {
    try { return listMutations(texts.get(file), { typescript: TS_FILE.test(file) }).map((m) => ({ ...m, file })); } catch (err) {
      const fix = config.runner === 'node' ? "Node's type stripping needs this file to parse as erasable TypeScript" : 'mutation needs erasable TypeScript (no enum, namespace or parameter properties) even though the runner can compile more; rewrite the file, or list it in mutation.exclude (the check is skipped for it)';
      failures.push(`mutation: cannot type-strip ${file} (${err.message.split('\n')[0]}), so it could not be mutated; ${fix}`);
      return [];
    }
  });
  if (failures.length > 0) return failures;
  if (pool.length === 0) { out('  mutation: no mutable operators found, skipped'); return []; }

  const seed = crypto.createHash('sha1').update([...texts.values()].join('\0')).digest('hex');
  const picked = selectMutations(pool, config.mutation.samples, seed);
  const tmp = copyProject(root, [...new Set([...config.srcDirs, ...config.testQuality.dirs, ...config.mutation.copy, ...RUNNER_FILES[config.runner]])]);
  const timeoutMs = mutationTimeoutMs(baselineMs, config.mutation);
  const survivors = [];
  const env = { ...scratchEnv, CLAUDE_PROJECT_DIR: tmp };
  const command = config.mutation.testCommand ?? config.testCommand;
  try {
    const baseline = await runVerify(command, { cwd: tmp, timeoutMs, env });
    if (!baseline.pass) {
      out(tailOutput(baseline.output, 20, 2000));
      return ['mutation: baseline run of the unmutated copy failed, so mutants would all look killed. The copy is missing something the tests need: add it to mutation.copy in verify.config.json'];
    }
    for (const m of picked) {
      const target = path.join(tmp, m.file);
      fs.writeFileSync(target, applyMutation(texts.get(m.file), m));
      const r = await runVerify(command, { cwd: tmp, timeoutMs, env });
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

async function strongVerify(root, config, { fast = false, out = console.log } = {}) {
  const covDir = makeTemp('verify-cov-');
  // Runs that are not the coverage run still expand $VERIFY_COVERAGE_DIR; point them at a throwaway directory.
  const scratchDir = config.runner === 'node' ? null : makeTemp('verify-scratch-');
  const scratchEnv = scratchDir ? coverageEnv(config, scratchDir) : {};
  const failures = [];
  let failingTests = '';
  try {
    out('[1/7] tests');
    const startedAt = Date.now();
    const result = await runVerify(config.testCommand, { cwd: root, timeoutMs: config.timeoutMs, env: coverageEnv(config, covDir) });
    const baselineMs = Date.now() - startedAt;
    const tests = checkTests(result, config);
    failures.push(...tests.failures);
    out(`  ${tests.summary.pass}/${tests.summary.tests} passing`);
    if (tests.failures.length > 0) {
      failingTests = extractFailures(result.output);
      if (failingTests === '') out(tailOutput(result.output, 25, 2500));
    }
    if (tests.failures.length === 0 && config.replicates > 1) {
      if (fast) out('  replicates: skipped (--fast); the full run is the definition of done');
      else failures.push(...await checkReplicates(root, config, result, out, scratchEnv));
    }

    out('[2/7] type check');
    if (!config.typecheck) out('  typecheck: not configured');
    else failures.push(...await checkTypes(root, config, out));

    out('[3/7] source coverage');
    failures.push(...checkCoverage(root, config, covDir, out, tests.failures.length === 0));
    out('[4/7] test quality');
    const quality = checkTestQuality(root, config);
    failures.push(...quality);
    out(quality.length === 0 ? '  ok' : quality.map((q) => `  ${q}`).join('\n'));

    out('[5/7] hidden holdout set');
    if (!config.holdout) out('  holdout: not configured');
    else if (fast) out('  holdout: skipped (--fast); the full run is the definition of done');
    else if (failures.length > 0) out('  holdout: skipped until the checks above pass');
    else failures.push(...await checkHoldout(root, config, out, scratchEnv));

    out('[6/7] user journeys in a browser');
    if (!config.journeys) out('  journeys: not configured');
    else if (fast) out('  journeys: skipped (--fast); the full run is the definition of done');
    else if (failures.length > 0) out('  journeys: skipped until the checks above pass');
    else failures.push(...await checkJourneys(root, config, out));

    out('[7/7] mutation spot-check');
    if (fast) out('  mutation: skipped (--fast); the full run is the definition of done');
    else if (failures.length > 0) out('  mutation: skipped until the checks above pass');
    else failures.push(...await checkMutation(root, config, baselineMs, out, scratchEnv));
  } finally {
    removeTemp(covDir);
    if (scratchDir) removeTemp(scratchDir);
  }
  out(failures.length === 0 ? 'VERIFY PASSED' : `VERIFY FAILED:\n${failures.map((f) => `  - ${f}`).join('\n')}`);
  if (failingTests !== '') out(`\nFailing tests (fix these at the root cause):\n${failingTests}`);
  return { pass: failures.length === 0, failures };
}

module.exports = { strongVerify, loadConfig, mutationTimeoutMs, cleanupTempDirs };
