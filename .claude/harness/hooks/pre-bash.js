#!/usr/bin/env node
'use strict';
const { spawnSync } = require('node:child_process');
const { readEvent, projectDirOf, guardContext, failOpen } = require('../lib/hook-io');
const { checkBash, isGitCommit } = require('../lib/guards');
const { runVerify } = require('../lib/verify');
const { tailOutput } = require('../lib/stop-loop');

const block = (reason) => {
  process.stderr.write(`[harness] BLOCKED: ${reason}\n`);
  process.exit(2);
};

function currentBranch(cwd) {
  const r = spawnSync('git', ['symbolic-ref', '--quiet', '--short', 'HEAD'], { cwd, encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : '';
}

async function main() {
  const event = readEvent();
  const command = event.tool_input?.command ?? '';
  const projectDir = projectDirOf(event);
  const ctx = guardContext(projectDir);

  const branch = /\bpush\b/.test(command) ? currentBranch(projectDir) : '';
  const verdict = checkBash(command, { ...ctx, currentBranch: branch });
  if (verdict.block) block(verdict.reason);

  // Commit gate: while a run is active, commits are refused unless the verify command passes.
  if (ctx.active && isGitCommit(command) && ctx.corrupt) block('Commit refused: harness state is corrupt; a human must repair or remove .harness/state.json.');
  if (ctx.active && isGitCommit(command) && ctx.state?.commitGate !== false) {
    const result = await runVerify(ctx.state.verifyCommand, { cwd: projectDir, timeoutMs: ctx.state.verifyTimeoutMs });
    if (!result.pass) block(`Commit refused: the verify command is failing. Commit when it is green.\n${tailOutput(result.output)}`);
  }
}

main().catch((err) => failOpen('pre-bash', err));
