#!/usr/bin/env node
'use strict';
const { readEvent, projectDirOf, failOpen } = require('../lib/hook-io');
const { readState, writeState } = require('../lib/state');
const { runVerify } = require('../lib/verify');
const { decideStop } = require('../lib/stop-loop');

async function main() {
  const projectDir = projectDirOf(readEvent());
  const state = readState(projectDir);
  if (!state?.active) return;

  const result = await runVerify(state.verifyCommand, { cwd: projectDir });
  const { decision, reason, nextState } = decideStop(state, result);
  writeState(projectDir, nextState);

  if (decision === 'block') process.stdout.write(JSON.stringify({ decision: 'block', reason }));
  else process.stderr.write(`[harness] run ended: ${nextState.status}. ${reason}\n`);
}

main().catch((err) => failOpen('stop', err));
