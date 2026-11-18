#!/usr/bin/env node
'use strict';
const { readEvent, projectDirOf, failOpen } = require('../lib/hook-io');
const { readState, writeState } = require('../lib/state');
const { runVerify } = require('../lib/verify');
const { decideStop } = require('../lib/stop-loop');

// A corrupt state file must not silently end enforcement: block once, then let the session end
// (the agent cannot repair .harness/, so blocking forever would loop).
function corruptState(event, err) {
  if (event.stop_hook_active) return;
  process.stdout.write(JSON.stringify({ decision: 'block', reason: `Harness state is corrupt (${err.message}). Stop and tell the human to repair or remove .harness/state.json; do not continue working.` }));
}

async function main() {
  const event = readEvent();
  const projectDir = projectDirOf(event);
  let state;
  try {
    state = readState(projectDir);
  } catch (err) {
    return corruptState(event, err);
  }
  if (!state?.active) return;

  const result = await runVerify(state.verifyCommand, { cwd: projectDir, timeoutMs: state.verifyTimeoutMs });
  const { decision, reason, nextState } = decideStop(state, result);
  writeState(projectDir, nextState);

  if (decision === 'block') process.stdout.write(JSON.stringify({ decision: 'block', reason }));
  else process.stderr.write(`[harness] run ended: ${nextState.status}. ${reason}\n`);
}

main().catch((err) => failOpen('stop', err));
