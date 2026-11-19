'use strict';
// Checks the tests before anyone builds against them. A test nobody has run is a guess.
//   expect "red":   the suites run against a STUB (right interface, no behaviour). Every test must fail, and fail on an
//                   assertion. A test that passes against a stub proves nothing; one that fails with "module not found" or
//                   "connection refused" is failing for the wrong reason, so the suite is not yet a usable RED.
//   expect "green": the suites run against a REFERENCE (an implementation of the spec). Every test must pass. A failure is
//                   a wrong test or a wrong reference; either way it is settled before the builder starts. This is the only
//                   check that catches two tests contradicting each other.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runVerify } = require('./verify');
const { parseTestSummary } = require('./summary');

const SKIP = new Set(['node_modules', '.git', '.harness']);
// Errors that say the test never reached an assertion about behaviour.
const ENVIRONMENT = /ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND|Cannot find module|ECONNREFUSED|ECONNRESET|EADDRINUSE|fetch failed|SyntaxError|ReferenceError|TypeError: .* is not a (?:function|constructor)|is not defined|ENOENT/;

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dst);
    else if (entry.isFile()) fs.copyFileSync(src, dst);
  }
}

// Failing tests with the text of their error, from node:test TAP output.
function parseFailures(output) {
  const lines = output.split('\n');
  const failures = [];
  for (let i = 0; i < lines.length; i += 1) {
    const head = lines[i].match(/^\s*not ok \d+ - (.*)$/);
    if (!head) continue;
    const body = [];
    let aggregator = false;
    let j = i + 1;
    if (lines[j]?.trim() === '---') {
      for (j += 1; j < lines.length && lines[j].trim() !== '...'; j += 1) {
        if (/failureType:.*subtestsFailed/.test(lines[j])) aggregator = true;
        body.push(lines[j]);
      }
    }
    if (!aggregator) {
      const text = body.join('\n');
      failures.push({ name: head[1], kind: ENVIRONMENT.test(text) ? 'environment' : 'assertion', detail: text.replace(/\s+/g, ' ').trim().slice(0, 240) });
    }
    i = j;
  }
  return failures;
}

// A file that crashes before running a test, or holds no test at all, shows up as one file-level entry named after the
// file. It is not a test: node counts it as one, which would hide an empty suite and mislabel a crash as an assertion.
const FILE_ENTRY = /^(not )?ok \d+ - (\S+\.test\.[cm]?js)\s*$/gm;
function parseFileEntries(output) {
  const crashed = [];
  const empty = [];
  for (const [, notOk, name] of output.matchAll(FILE_ENTRY)) (notOk ? crashed : empty).push(name);
  return { crashed, empty };
}

function suiteCommands(config, suites) {
  const dir = config.refCheck?.acceptance ?? 'acceptance';
  const known = {
    acceptance: `node --test "${dir}/*.test.js"`,
    holdout: config.holdout?.command ?? null,
  };
  return suites.map((suite) => {
    if (!(suite in known)) throw new Error(`Unknown suite "${suite}". Use: ${Object.keys(known).join(', ')}.`);
    if (!known[suite]) throw new Error(`Suite "${suite}" is not configured (verify.config.json has no holdout.command).`);
    return { suite, command: known[suite] };
  });
}

async function runSuites(root, config, { impl, suites = ['acceptance', 'holdout'], holdoutDir, timeoutMs }) {
  const implDir = path.resolve(root, impl);
  if (!fs.existsSync(implDir) || !fs.statSync(implDir).isDirectory()) throw new Error(`Implementation folder not found: ${impl}`);
  const commands = suiteCommands(config, suites);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-refcheck-'));
  try {
    copyDir(implDir, temp);
    const acceptanceDir = config.refCheck?.acceptance ?? 'acceptance';
    if (suites.includes('acceptance')) {
      if (!fs.existsSync(path.join(root, acceptanceDir))) throw new Error(`No ${acceptanceDir}/ folder to check.`);
      copyDir(path.join(root, acceptanceDir), path.join(temp, acceptanceDir));
    }
    const env = {};
    if (suites.includes('holdout')) {
      const hidden = path.resolve(root, holdoutDir ?? process.env.HARNESS_HIDDEN_DIR ?? 'holdout');
      if (!fs.existsSync(hidden)) throw new Error(`No holdout folder at ${path.relative(root, hidden) || hidden}.`);
      copyDir(hidden, path.join(temp, 'holdout'));
      env.HARNESS_HIDDEN_DIR = path.join(temp, 'holdout');
    }
    if (!fs.existsSync(path.join(temp, 'package.json')) && fs.existsSync(path.join(root, 'package.json'))) {
      fs.copyFileSync(path.join(root, 'package.json'), path.join(temp, 'package.json'));
    }
    const results = [];
    for (const { suite, command } of commands) {
      const r = await runVerify(command, { cwd: temp, timeoutMs: timeoutMs ?? config.timeoutMs ?? 300_000, env });
      const totals = parseTestSummary(r.output);
      const { crashed, empty } = parseFileEntries(r.output);
      totals.tests -= crashed.length + empty.length;
      totals.fail -= crashed.length;
      totals.pass -= empty.length;
      const failures = parseFailures(r.output).filter((f) => !/\.test\.[cm]?js$/.test(f.name));
      results.push({ suite, ...totals, crashed, empty, timedOut: r.timedOut, failures, exitedClean: r.pass });
    }
    return results;
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

function evaluate(expect, results, { maxEnvironmentShare = 0 } = {}) {
  if (!['red', 'green'].includes(expect)) throw new Error('expect must be red or green.');
  const problems = [];
  for (const r of results) {
    if (r.timedOut) problems.push(`${r.suite}: timed out`);
    const crashed = r.crashed ?? [];
    const empty = r.empty ?? [];
    if (crashed.length) problems.push(`${r.suite}: ${crashed.length} test file(s) crashed before running (${crashed.slice(0, 3).join(', ')}); this is a wrong reason to fail, not a RED`);
    if (empty.length) problems.push(`${r.suite}: ${empty.length} test file(s) contain no tests (${empty.slice(0, 3).join(', ')})`);
    if (r.tests === 0) { if (!crashed.length && !empty.length) problems.push(`${r.suite}: no tests ran`); continue; }
    if (expect === 'green') {
      if (r.fail > 0) problems.push(`${r.suite}: ${r.fail} of ${r.tests} fail against the reference (a wrong test or a wrong reference): ${r.failures.slice(0, 5).map((f) => f.name).join('; ')}`);
      if (r.skipped + r.todo > 0) problems.push(`${r.suite}: ${r.skipped + r.todo} skipped or todo`);
    } else {
      const passing = r.tests - r.fail - r.skipped - r.todo;
      if (passing > 0) problems.push(`${r.suite}: ${passing} test(s) pass against a stub, so they prove nothing`);
      const env = r.failures.filter((f) => f.kind === 'environment');
      if (r.failures.length && env.length / r.failures.length > maxEnvironmentShare) {
        problems.push(`${r.suite}: ${env.length} of ${r.failures.length} fail for the wrong reason (${env[0].detail.slice(0, 120)})`);
      }
    }
  }
  const total = results.reduce((a, r) => ({ tests: a.tests + r.tests, fail: a.fail + r.fail }), { tests: 0, fail: 0 });
  return { expect, passed: problems.length === 0, problems, tests: total.tests, failing: total.fail };
}

async function refCheck(root, config, options) {
  const results = await runSuites(root, config, options);
  return { ...evaluate(options.expect, results, options), results };
}

module.exports = { refCheck, runSuites, evaluate, parseFailures, suiteCommands, ENVIRONMENT };
