#!/usr/bin/env node
'use strict';
// Records that a human sent a prompt (length only, never the text), and applies the owner's "stop", "continue",
// "run without me" and "ask me first" instructions to .harness/owner-mode.json (#113). It never blocks a prompt;
// what it prints is added to the session's context (the new state, or a reminder that the session is stopped).
const { readEvent, projectDirOf } = require('../lib/hook-io');
const { logHuman, recordHookError } = require('../lib/trace');
const { applyPrompt, noticeFor } = require('../lib/owner-mode');

try {
  const event = readEvent();
  const projectDir = projectDirOf(event);
  logHuman(projectDir, event);
  try {
    const notice = noticeFor(applyPrompt(projectDir, event.prompt));
    if (notice) process.stdout.write(`${notice}\n`);
  } catch (err) {
    recordHookError('user-prompt', err, projectDir); // the PreToolUse hold still reads whatever state is on disk
  }
} catch { /* tracing is best-effort */ }
