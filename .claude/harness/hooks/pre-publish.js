#!/usr/bin/env node
'use strict';
// One writer per page (#110): blocks an Artifact publish to a page the design page register gives to another session.
const { readEvent, projectDirOf, failOpen } = require('../lib/hook-io');
const { checkPublish } = require('../lib/design');
const { logBlocked } = require('../lib/trace');

try {
  const event = readEvent();
  const projectDir = projectDirOf(event);
  const verdict = checkPublish(event, projectDir);
  if (verdict.block) {
    logBlocked(projectDir, event, verdict.reason);
    process.stderr.write(`[harness] BLOCKED: ${verdict.reason}\n`);
    process.exit(2);
  }
} catch (err) {
  failOpen('pre-publish', err);
}
