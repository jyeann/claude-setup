#!/usr/bin/env node
'use strict';
// Usage: tasks-sync.js pull --spec <n> --from-json <issues.json> [--out TASKS.md] [--base <ref>]
//
// Writes the generated task list from a spec issue's tickets. The JSON is an array of issues (raw GitHub
// REST issues work, e.g. the spec issue's sub-issues), or
//   { "issues": [...], "external": [{number, state}], "pullRequests": [{number, state, title, body, ...}] }
// where `external` gives the state of blockers outside the spec and `pullRequests` the repo's open PRs
// (e.g. `gh pr list --json number,state,title,body,isDraft,closingIssuesReferences`). Shapes: lib/tasks-sync.js.
//
// Status is derived, first match wins (docs/adr/0001):
//   blocked  the issue was closed as not planned
//   done     the issue is closed; or a whole "Closes #N" line closes it in a commit on this branch, or in a
//            commit on its own ticket branch; or an open, non-draft PR closes it (title/body line, or
//            closingIssuesReferences)
//   blocked  a blocker outside the spec is open or unknown
//   doing    a ticket branch or a harness WIP checkpoint (refs/harness/wip/<branch>) exists for it
//   todo     otherwise
// A ticket branch is a local or remote-tracking branch with a path segment issue-<N> or issue-<N>-<slug>
// (e.g. claude/issue-22-derived-status). Commits count since --base; without it, the first of origin/HEAD,
// origin/main, origin/master, main, master that exists and is not the current branch; failing that, all history.
// Exit 0: written. Exit 2: bad arguments, unreadable input or an invalid ticket (nothing written).
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { buildTaskList, closingRefs, ticketBranchIssue } = require('../lib/tasks-sync');

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

const commitsSince = (range, ref) => git('log', '--format=%H%x00%B%x01', ...(range ? [`${range}..${ref}`] : [ref]));

const REF_PREFIXES = [/^refs\/heads\//, /^refs\/remotes\/[^/]+\//, /^refs\/harness\/wip\//];

// Git facts: issue numbers closed by commits on this branch or on their own ticket branch, and ticket
// branches or WIP checkpoints without a closing commit (Map<issue number, ref name>). Empty, with a
// warning, when there is no git history.
function gitFacts(base) {
  const closedByCommit = new Set();
  const inProgress = new Map();
  const range = base || defaultBase();
  const log = commitsSince(range, 'HEAD');
  if (log.status !== 0) {
    if (base) fail(`cannot read commits since ${base}: ${log.stderr.trim()}`);
    console.error('tasks-sync: warning: no git history read; status comes from issue state only');
    return { closedByCommit, inProgress };
  }
  if (!range) console.error('tasks-sync: warning: no base branch found; counting closing commits in all of HEAD (pass --base)');
  for (const n of closingRefs(log.stdout)) closedByCommit.add(n);

  const refs = git('for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/remotes', 'refs/harness/wip').stdout.split('\n').filter(Boolean);
  for (const ref of refs) {
    const prefix = REF_PREFIXES.find((re) => re.test(ref));
    const name = ref.replace(prefix, '');
    const n = ticketBranchIssue(name);
    if (n === null || closedByCommit.has(n)) continue;
    const own = commitsSince(range, ref);
    if (own.status === 0 && closingRefs(own.stdout).has(n)) {
      closedByCommit.add(n);
      inProgress.delete(n);
    } else if (!inProgress.has(n)) {
      inProgress.set(n, ref.startsWith('refs/harness/wip/') ? `harness checkpoint ${name}` : name);
    }
  }
  return { closedByCommit, inProgress };
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
const pullRequests = Array.isArray(input) || input.pullRequests === undefined ? [] : input.pullRequests;
if (!Array.isArray(pullRequests)) fail(`${from}: pullRequests must be an array of pull requests`);

const { closedByCommit, inProgress } = gitFacts(opt(args, '--base'));
const { text, errors } = buildTaskList(issues, { spec, closedByCommit, external, pullRequests, inProgress });
if (errors.length) fail(`not written:\n  ${errors.join('\n  ')}`);

fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
fs.writeFileSync(out, text);
console.log(`tasks-sync: wrote ${out}: ${(text.match(/^## /gm) || []).length} tasks from spec issue #${spec}`);
