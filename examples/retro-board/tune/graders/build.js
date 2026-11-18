#!/usr/bin/env node
'use strict';
// Phase 5 grader (build). cwd = trial worktree root.
// Output: the implementation (src/, public/, package.json) and unit tests (tests/) under examples/retro-board/.
// Runs the full harness gate (tests, replicate run, coverage, test quality, hidden holdout, mutation check) on a
// COPY of the trial's app. acceptance/, spec.md and verify.config.json are taken from the golden kit, so editing
// them does not help, and the hidden holdout tests are added to the config here.
const fs = require('node:fs');
const path = require('node:path');
const U = require('../lib/util');

const r = U.reporter('build');
const cwd = process.cwd();
const trialApp = path.join(cwd, U.APP_REL);
const verifyJs = path.join(U.HARNESS_DIR, 'bin', 'verify.js');

r.check('harness verify.js is available to the grader', U.exists(verifyJs), verifyJs);
r.check('src/server.js exists', U.exists(path.join(trialApp, 'src', 'server.js')));
r.check('unit tests exist in tests/', U.exists(path.join(trialApp, 'tests')) && fs.readdirSync(path.join(trialApp, 'tests')).some((f) => /\.test\.js$/.test(f)));
if (r.failed() > 0) process.exit(r.done());

const root = U.tmp('tune-build-');
const app = path.join(root, U.APP_REL);
try {
  U.copy(trialApp, app, (src) => !/(^|\/)(node_modules|data|\.git|\.harness)(\/|$)/.test(path.relative(trialApp, src)));
  if (U.exists(path.join(cwd, 'docs'))) U.copy(path.join(cwd, 'docs'), path.join(root, 'docs'));
  // protected inputs
  U.rmrf(path.join(app, 'acceptance'));
  U.copy(path.join(U.GOLDEN_APP, 'acceptance'), path.join(app, 'acceptance'));
  U.copy(path.join(U.GOLDEN_APP, 'spec.md'), path.join(app, 'spec.md'));
  if (!U.exists(path.join(app, 'package.json'))) U.copy(path.join(U.GOLDEN_APP, 'package.json'), path.join(app, 'package.json'));
  const config = JSON.parse(U.read(path.join(U.GOLDEN_APP, 'verify.config.json')));
  const holdout = path.join(U.GOLDEN, 'holdout', 'holdout.test.js');
  config.holdout = { command: `node --test "${holdout}"`, minTests: 8 };
  fs.writeFileSync(path.join(app, 'verify.config.json'), `${JSON.stringify(config, null, 2)}\n`);

  const res = U.run(process.execPath, [verifyJs], { cwd: app, env: { CLAUDE_PROJECT_DIR: app }, timeoutMs: 9 * 60_000 });
  const lines = res.out.split('\n');
  console.log(lines.filter((l) => l.trim()).map((l) => `  | ${l}`).join('\n'));
  const failures = lines.filter((l) => /^\s+- /.test(l)).map((l) => l.replace(/^\s+- /, ''));
  const STAGES = [
    ['tests pass (acceptance + unit), at least 30 tests, no skips, stable across replicate runs', /^(tests |only \d+ test|\d+ skipped|flaky)/i],
    ['line coverage of src/ meets the floors', /^coverage/i],
    ['unit tests are real (reference src, enough assertions)', /^test quality|^no unit tests/i],
    ['hidden holdout set passes', /^holdout/i],
    ['mutation spot-check kills enough mutants', /^mutation/i],
  ];
  for (const [label, re] of STAGES) {
    const hits = failures.filter((f) => re.test(f));
    r.check(label, hits.length === 0 && !res.timedOut, hits.join('; ').slice(0, 300) || (res.timedOut ? 'timed out' : ''));
  }
  const unclassified = failures.filter((f) => !STAGES.some(([, re]) => re.test(f)));
  r.check('verify gate exits 0 (VERIFY PASSED)', res.code === 0 && /VERIFY PASSED/.test(res.out), unclassified.join('; ').slice(0, 300) || `exit ${res.code}`);
} finally {
  U.rmrf(root);
}
process.exit(r.done());
