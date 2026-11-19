#!/usr/bin/env node
'use strict';
// ref-check --impl <dir> --expect red|green [--suites acceptance,holdout] [--holdout-dir dir] [--config verify.config.json] [--job ID]
//   red   against a stub: every test must fail, on an assertion (not "module not found" or "connection refused")
//   green against a reference implementation: every test must pass; a failure is a wrong test or a wrong reference
// With --job the result is recorded on the job record (the build stage will not start without a passing red check).
const path = require('node:path');
const { refCheck } = require('../lib/ref-check');
const { loadConfig } = require('../lib/strong-verify');
const jobs = require('../lib/job');

const argv = process.argv.slice(2);
const flag = (name) => { const i = argv.indexOf(`--${name}`); return i > -1 && argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[i + 1] : undefined; };

async function main() {
  const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const impl = flag('impl');
  const expect = flag('expect');
  if (!impl || !expect) throw new Error('--impl <folder> and --expect red|green are required.');
  const config = loadConfig(path.resolve(root, flag('config') ?? 'verify.config.json'));
  const suites = (flag('suites') ?? 'acceptance,holdout').split(',').map((s) => s.trim()).filter(Boolean);
  const result = await refCheck(root, config, { impl, expect, suites, holdoutDir: flag('holdout-dir') });
  const summary = result.passed
    ? `${expect}: ${result.tests} tests, ${result.failing} failing, as expected`
    : `${expect}: ${result.problems.join(' | ')}`;
  process.stdout.write(`ref-check ${expect} ${result.passed ? 'PASSED' : 'FAILED'}: ${summary}\n`);
  for (const p of result.problems) process.stdout.write(`  - ${p}\n`);
  const id = flag('job');
  if (id) jobs.recordRefCheck(jobs.rootOf(root), id, { expect, passed: result.passed, summary, suites });
  return result.passed ? 0 : 1;
}

main().then((code) => { process.exitCode = code; }).catch((err) => { process.stderr.write(`ref-check: ${err.message}\n`); process.exitCode = 2; });
