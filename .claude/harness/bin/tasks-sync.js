#!/usr/bin/env node
'use strict';
// Usage: tasks-sync.js pull --spec <n> --from-json <issues.json> [--out TASKS.md]
// Writes the generated task list from a spec issue's tickets (saved as a JSON array of issues, or
// { "issues": [...] }). Status is derived: closed issue or a "Closes #N" commit in HEAD's history -> done.
// Exit 0: written. Exit 2: bad arguments, unreadable input or an invalid ticket (nothing written).
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { buildTaskList, closingRefs } = require('../lib/tasks-sync');

const USAGE = 'usage: tasks-sync.js pull --spec <n> --from-json <issues.json> [--out TASKS.md]';

function fail(msg) {
  console.error(`tasks-sync: ${msg}`);
  process.exit(2);
}

function opt(args, name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

const args = process.argv.slice(2);
const spec = Number(opt(args, '--spec'));
if (args[0] !== 'pull' || !Number.isInteger(spec) || spec <= 0) fail(USAGE);
const from = opt(args, '--from-json');
if (!from) fail('live GitHub pull is not available yet; save the spec issue\'s sub-issues as JSON and pass --from-json <file>');
const out = opt(args, '--out') || 'TASKS.md';

let issues;
try {
  issues = JSON.parse(fs.readFileSync(from, 'utf8'));
} catch (err) {
  fail(`cannot read ${from}: ${err.message}`);
}
if (issues && !Array.isArray(issues)) issues = issues.issues;
if (!Array.isArray(issues)) fail(`${from}: expected a JSON array of issues, or { "issues": [...] }`);

const log = spawnSync('git', ['log', '--format=%B'], { encoding: 'utf8' });
const closedByCommit = log.status === 0 ? closingRefs(log.stdout) : new Set();

const { text, errors } = buildTaskList(issues, { spec, closedByCommit });
if (errors.length) fail(`not written:\n  ${errors.join('\n  ')}`);

fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
fs.writeFileSync(out, text);
console.log(`tasks-sync: wrote ${out}: ${(text.match(/^## /gm) || []).length} tasks from spec issue #${spec}`);
