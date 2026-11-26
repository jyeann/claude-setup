#!/usr/bin/env node
'use strict';
// Usage: owner-mode.js status | stop | continue | unattended | attended   (#113)
//   Shows or sets the owner's states in .harness/owner-mode.json, for an owner at a terminal. The same states are
//   set from a prompt: "stop", "continue", "run without me", "ask me first", or a first line `harness: <state>`.
//   The agent may run `status` and `stop`; the owner-hold hook refuses the others to it.
const { readMode, setMode } = require('../lib/owner-mode');

const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const [sub] = process.argv.slice(2);
const yes = (v) => (v ? 'yes' : 'no');

if (['stop', 'continue', 'unattended', 'attended'].includes(sub)) setMode(projectDir, [sub]);
else if (sub !== 'status') {
  console.error('usage: owner-mode.js status | stop | continue | unattended | attended');
  process.exit(1);
}
const mode = readMode(projectDir);
console.log(`stopped: ${yes(mode.stopped)}\nrun-unattended: ${yes(mode.unattended)}${mode.corrupt ? '\n(owner-mode.json is corrupt; read as stopped)' : ''}`);
