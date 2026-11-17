#!/usr/bin/env node
'use strict';
const { readEvent, projectDirOf, guardContext, failOpen } = require('../lib/hook-io');
const { checkWrite } = require('../lib/guards');

try {
  const event = readEvent();
  const projectDir = projectDirOf(event);
  const verdict = checkWrite(event, guardContext(projectDir), projectDir);
  if (verdict.block) {
    process.stderr.write(`[harness] BLOCKED: ${verdict.reason}\n`);
    process.exit(2);
  }
} catch (err) {
  failOpen('pre-write', err);
}
