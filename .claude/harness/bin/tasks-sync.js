#!/usr/bin/env node
'use strict';
// Usage: tasks-sync.js pull --spec <n> --from-json <issues.json> [--out TASKS.md] [--base <ref>]
//
// Writes the generated task list from a spec issue's tickets. The JSON is an array of issues (raw GitHub
// REST issues work, e.g. the spec issue's sub-issues), or { "issues": [...], "external": [{number, state}] }
// where `external` gives the state of blockers outside the spec. Shape: see lib/tasks-sync.js.
//
// Status is derived: a closed issue, or a "Closes #N" trailer line in a commit on this branch, is done.
// "On this branch" means commits since --base; without it, the first of origin/HEAD, origin/main,
// origin/master, main, master that exists and is not the current branch; failing that, all of HEAD.
// Exit 0: written. Exit 2: bad arguments, unreadable input or an invalid ticket (nothing written).
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { buildTaskList, closingRefs } = require('../lib/tasks-sync');

const USAGE = 'usage: tasks-sync.js pull --spec <n> --from-json <issues.json> [--out TASKS.md] [--base <ref>]';
const BASE_CANDIDATES = ['origin/HEAD', 'origin/main', 'origin/master', 'main', 'master'];

function fail(msg) {
  console.error(`tasks-sync: ${msg}`);
  process.exit(2);
}

function opt(args, name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

const git = (...a) => spawnSync('git', a, { encoding: 'utf8' });

function defaultBase() {
  const branch = git('rev-parse', '--abbrev-ref', 'HEAD').stdout.trim();
  return BASE_CANDIDATES.find((ref) => ref !== branch && ref !== `origin/${branch}` && git('rev-parse', '--verify', '-q', `${ref}^{commit}`).status === 0);
}

// Issue numbers closed by commits on this branch; empty (with a warning) when there is no git history.
function closedOnBranch(base) {
  const range = base || defaultBase();
  const log = git('log', '--format=%H%x00%B%x01', ...(range ? [`${range}..HEAD`] : ['HEAD']));
  if (log.status !== 0) {
    if (base) fail(`cannot read commits since ${base}: ${log.stderr.trim()}`);
    console.error('tasks-sync: warning: no git history read; status comes from issue state only');
    return new Set();
  }
  if (!range) console.error('tasks-sync: warning: no base branch found; counting closing commits in all of HEAD (pass --base)');
  return closingRefs(log.stdout);
}

const args = process.argv.slice(2);
const spec = Number(opt(args, '--spec'));
if (args[0] !== 'pull' || !Number.isInteger(spec) || spec <= 0) fail(USAGE);
const from = opt(args, '--from-json');
if (!from) fail('live GitHub pull is not available yet; save the spec issue\'s sub-issues as JSON and pass --from-json <file>');
const out = opt(args, '--out') || 'TASKS.md';

let input;
try {
  input = JSON.parse(fs.readFileSync(from, 'utf8'));
} catch (err) {
  fail(`cannot read ${from}: ${err.message}`);
}
const issues = Array.isArray(input) ? input : input && input.issues;
if (!Array.isArray(issues)) fail(`${from}: expected a JSON array of issues, or { "issues": [...] }`);
const external = (!Array.isArray(input) && Array.isArray(input.external)) ? input.external : [];

const closedByCommit = closedOnBranch(opt(args, '--base'));
const { text, errors } = buildTaskList(issues, { spec, closedByCommit, external });
if (errors.length) fail(`not written:\n  ${errors.join('\n  ')}`);

fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
fs.writeFileSync(out, text);
console.log(`tasks-sync: wrote ${out}: ${(text.match(/^## /gm) || []).length} tasks from spec issue #${spec}`);
