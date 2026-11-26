#!/usr/bin/env node
'use strict';
// "Stop" stops (#113): while the owner has stopped the session, Artifact publishes, `git push`, GitHub writes
// (gh, GitHub MCP) and MCP publish/deploy/push tools are blocked, whoever started the turn. At all times the
// agent may not edit .harness/owner-mode.json or run the owner's clearing commands.
const { readEvent, projectDirOf, failOpen } = require('../lib/hook-io');
const { readMode, holdVerdict } = require('../lib/owner-mode');
const { logBlocked } = require('../lib/trace');

try {
  const event = readEvent();
  const projectDir = projectDirOf(event);
  const verdict = holdVerdict(event, readMode(projectDir));
  if (verdict.block) {
    logBlocked(projectDir, event, verdict.reason);
    process.stderr.write(`[harness] BLOCKED: ${verdict.reason}\n`);
    process.exit(2);
  }
} catch (err) {
  failOpen('owner-hold', err);
}
