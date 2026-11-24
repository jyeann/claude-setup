#!/usr/bin/env node
'use strict';
// Usage: tasks-sync.js pull  --spec <n> [--from-json <issues.json>] [--repo owner/name] [--out TASKS.md] [--base <ref>]
//        tasks-sync.js check --spec <n> [--from-json <issues.json>] [--repo owner/name] [--file TASKS.md] [--base <ref>]
//
// pull writes the generated task list from a spec issue's tickets. Without --from-json it reads the spec
// issue's sub-issues, their native blockers and the state of outside blockers live through `gh`
// (lib/gh-issues.js). The JSON is an array of issues (raw GitHub REST issues work, e.g. the spec issue's
// sub-issues), or
//   { "issues": [...], "external": [{number, state}], "pullRequests": [{number, state, title, body, ...}] }
// where `external` gives the state of blockers outside the spec and `pullRequests` the repo's open PRs
// (e.g. `gh pr list --json number,state,title,body,isDraft,closingIssuesReferences`; the live path does not
// fetch PRs yet). Shapes: lib/tasks-sync.js.
//
// check regenerates the task list in memory and compares it with the file, ignoring the generated-at time.
//
// Status is derived, first match wins (docs/adr/0001):
//   blocked  the issue was closed as not planned
//   done     the issue is closed; or a whole "Closes #N" line closes it in a commit on this branch; or an
//            open, non-draft PR closes it (a whole closing line in its title or body, or closingIssuesReferences)
//   blocked  a blocker outside the spec is open or unknown
//   doing    a ticket branch or a harness WIP checkpoint (refs/harness/wip/<branch>) exists for it
//   todo     otherwise
// A ticket branch is a local branch with a path segment issue-<N> or issue-<N>-<slug> (e.g.
// claude/issue-22-derived-status). With --from-json, refresh the file before each pull for PR and issue state. Commits count since --base; without it, the first of origin/HEAD,
// origin/main, origin/master, main, master that exists and is not the current branch; failing that, all history.
// pull exit 0: written. check exit 0: matches, or GitHub is unreachable (with a warning); exit 1: the file
// differs or is missing (the differing task ids are listed). Exit 2: bad arguments, unreadable input, a gh
// error other than unreachable, or an invalid ticket (nothing written).
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { buildTaskList, closingRefs, diffTaskLists, ticketBranchIssue } = require('../lib/tasks-sync');
const { fetchSpecIssues } = require('../lib/gh-issues');

const USAGE = 'usage: tasks-sync.js (pull|check) --spec <n> [--from-json <issues.json>] [--repo owner/name] [--out|--file TASKS.md] [--base <ref>]';
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

const REF_PREFIXES = [/^refs\/heads\//, /^refs\/harness\/wip\//];

// Git facts: issue numbers closed by commits on this branch, and local ticket branches or WIP checkpoints
// (Map<issue number, ref name>). Empty, with a warning, when there is no git history.
function gitFacts(base) {
  const inProgress = new Map();
  const range = base || defaultBase();
  const log = git('log', '--format=%H%x00%B%x01', ...(range ? [`${range}..HEAD`] : ['HEAD']));
  if (log.status !== 0) {
    if (base) fail(`cannot read commits since ${base}: ${log.stderr.trim()}`);
    console.error('tasks-sync: warning: no git history read; status comes from issue state only');
    return { closedByCommit: new Set(), inProgress };
  }
  if (!range) console.error('tasks-sync: warning: no base branch found; counting closing commits in all of HEAD (pass --base)');
  const refs = git('for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/harness/wip').stdout.split('\n').filter(Boolean);
  for (const ref of refs) {
    const name = REF_PREFIXES.reduce((r, re) => r.replace(re, ''), ref);
    const n = ticketBranchIssue(name);
    if (n !== null && !inProgress.has(n)) inProgress.set(n, ref.startsWith('refs/harness/wip/') ? `harness checkpoint ${name}` : name);
  }
  return { closedByCommit: closingRefs(log.stdout), inProgress };
}

// The spec's tickets as { issues, external, pullRequests }: from the JSON file, or live through gh. For check only,
// an unreachable GitHub gives { unreachable: reason } instead of failing.
function loadSource(command, spec, from, repo) {
  if (!from) {
    try {
      return fetchSpecIssues(spec, { repo });
    } catch (err) {
      if (command === 'check' && err.unreachable) return { unreachable: err.message };
      fail(`cannot read spec issue #${spec} from GitHub: ${err.message}. Save the spec issue's sub-issues as JSON and pass --from-json <file> (docs/agents/issue-tracker.md)`);
    }
  }
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
  return { issues, external, pullRequests };
}

const args = process.argv.slice(2);
const command = args[0];
const spec = Number(opt(args, '--spec'));
if (!['pull', 'check'].includes(command) || !Number.isInteger(spec) || spec <= 0) fail(USAGE);
const file = opt(args, '--file') || 'TASKS.md';
const { issues, external, pullRequests = [], unreachable } = loadSource(command, spec, opt(args, '--from-json'), opt(args, '--repo'));
if (unreachable) {
  console.error(`tasks-sync: warning: cannot check ${file} against GitHub (${unreachable}); it may be stale`);
  process.exit(0);
}

const { closedByCommit, inProgress } = gitFacts(opt(args, '--base'));
const { text, errors } = buildTaskList(issues, { spec, closedByCommit, external, pullRequests, inProgress });
if (errors.length) fail(`${command === 'pull' ? 'not written' : 'cannot check'}:\n  ${errors.join('\n  ')}`);

if (command === 'check') {
  const pullHint = `run tasks-sync pull --spec ${spec}${file === 'TASKS.md' ? '' : ` --out ${file}`}`;
  let current;
  try {
    current = fs.readFileSync(file, 'utf8');
  } catch {
    console.log(`tasks-sync: ${file} is missing: ${pullHint}`);
    process.exit(1);
  }
  const differ = diffTaskLists(text, current);
  if (differ.length) {
    console.log(`tasks-sync: ${file} differs from spec issue #${spec} in: ${differ.join(', ')}\nIt was edited by hand or the issues changed: ${pullHint}`);
    process.exit(1);
  }
  console.log(`tasks-sync: ${file} matches spec issue #${spec}`);
  process.exit(0);
}

const out = opt(args, '--out') || 'TASKS.md';
fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
fs.writeFileSync(out, text);
console.log(`tasks-sync: wrote ${out}: ${(text.match(/^## /gm) || []).length} tasks from spec issue #${spec}`);
