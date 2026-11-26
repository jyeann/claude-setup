#!/usr/bin/env node
'use strict';
// "Run without me" is said once (#113): while the owner's run-unattended state is on, a turn whose closing message
// asks permission ("shall I", "want me to ...?") is sent back once. A line starting "Owner decision:", an owner-gate
// wait, a stopped session or the hook's own second firing lets the turn end.
const { readEvent, projectDirOf } = require('../lib/hook-io');
const { readState } = require('../lib/state');
const { readMode, lastAssistantText, hasOwnerDecision, asksPermission, UNATTENDED_REASON } = require('../lib/owner-mode');
const { recordHookError } = require('../lib/trace');

function gateWait(projectDir) {
  try { return readState(projectDir)?.status === 'waiting-for-owner'; } catch { return false; }
}

function main() {
  const event = readEvent();
  if (event.stop_hook_active) return;
  const projectDir = projectDirOf(event);
  const mode = readMode(projectDir);
  if (!mode.unattended || mode.stopped || gateWait(projectDir)) return;
  const text = lastAssistantText(event);
  if (!text || hasOwnerDecision(text) || !asksPermission(text)) return;
  process.stdout.write(JSON.stringify({ decision: 'block', reason: UNATTENDED_REASON }));
}

try {
  main();
} catch (err) {
  recordHookError('stop-owner', err); // best-effort: the skill rule still holds
}
