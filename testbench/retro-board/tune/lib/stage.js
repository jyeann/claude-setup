'use strict';
// Stage an app under test: the trial's docs/ and acceptance files laid out like the real repo, with the golden
// implementation (optionally seeded with defects) next to them. Never touches the trial worktree.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const U = require('./util');
const { applySeeds } = require('../seeds/seeds');

// Returns {root, app}. `from` is the trial worktree root. Caller removes `root`.
function stageGolden(from, { seeds = [], extras = ['acceptance', 'spec.md', 'verify.config.json', 'tests'] } = {}) {
  const root = U.tmp('tune-stage-');
  const app = path.join(root, U.APP_REL);
  fs.mkdirSync(app, { recursive: true });
  for (const d of ['src', 'public']) U.copy(path.join(U.GOLDEN_APP, d), path.join(app, d));
  for (const f of ['package.json', '.gitignore']) U.copy(path.join(U.GOLDEN_APP, f), path.join(app, f));
  const trialApp = path.join(from, U.APP_REL);
  for (const e of extras) if (U.exists(path.join(trialApp, e))) U.copy(path.join(trialApp, e), path.join(app, e));
  if (U.exists(path.join(from, 'docs'))) U.copy(path.join(from, 'docs'), path.join(root, 'docs'));
  if (seeds.length) applySeeds(app, seeds);
  return { root, app };
}

// Async `node --test <pattern>` in `cwd`. Resolves {code, out, timedOut}.
function nodeTest(cwd, patterns, timeoutMs) {
  return new Promise((resolve) => {
    const { NODE_TEST_CONTEXT, ...env } = process.env;
    const child = spawn(process.execPath, ['--test', ...patterns], { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let timedOut = false;
    child.stdout.setEncoding('utf8').on('data', (c) => { out = (out + c).slice(-2_000_000); });
    child.stderr.setEncoding('utf8').on('data', (c) => { out = (out + c).slice(-2_000_000); });
    const kill = () => { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* gone */ } };
    const timer = setTimeout(() => { timedOut = true; kill(); }, timeoutMs);
    child.on('close', (code) => { clearTimeout(timer); kill(); resolve({ code, out, timedOut }); });
    child.on('error', (e) => { clearTimeout(timer); resolve({ code: 1, out: String(e), timedOut }); });
  });
}

module.exports = { stageGolden, nodeTest };
