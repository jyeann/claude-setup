'use strict';
// Reads a spec issue's tickets and the repository's open PRs live from GitHub through `gh api`, in the
// same input shape that `tasks-sync pull --from-json` takes ({ issues, external, pullRequests }), so the
// live and saved-JSON paths build the same task list. `run(args)` is injectable for tests and returns
// spawnSync's { status, stdout, stderr, error }.
const { spawnSync } = require('node:child_process');
const { bodyBlockers } = require('./tasks-sync');

// gh failures that mean "GitHub cannot be asked right now", as opposed to an answer that is an error
// (an unknown issue, a bad repository). `check` warns on these instead of failing.
const UNAUTHENTICATED = /auth login|not logged in|authentication|bad credentials|HTTP 401|GH_TOKEN/i;
// A 403 is an answer (no access, SSO), except a rate limit, which only means "not now".
const OFFLINE = /error connecting|could not resolve|no such host|connection refused|connection reset|i\/o timeout|timed out|ECONN|EAI_AGAIN|proxyconnect|rate limit/i;

const ghRunner = (args) => spawnSync('gh', args, { encoding: 'utf8', timeout: 60000 });

function ghError(message, unreachable) {
  return Object.assign(new Error(message), { unreachable });
}

function api(run, endpoint) {
  const r = run(['api', '--paginate', '--slurp', endpoint]);
  if (r.error) {
    if (r.error.code === 'ENOENT') throw ghError('gh is not installed', true);
    if (r.error.code === 'ETIMEDOUT') throw ghError('cannot reach GitHub (gh timed out)', true);
    throw ghError(`gh failed: ${r.error.message}`, false);
  }
  const stderr = String(r.stderr || '').trim();
  if (r.status !== 0) {
    if (/unable to expand placeholder/i.test(stderr)) throw ghError('no GitHub repository found here (pass --repo owner/name)', true);
    if (UNAUTHENTICATED.test(stderr)) throw ghError(`gh is not authenticated (${stderr.split('\n')[0]})`, true);
    if (OFFLINE.test(stderr)) throw ghError(`cannot reach GitHub (${stderr.split('\n')[0]})`, true);
    throw ghError(`gh api ${endpoint}: ${stderr || `exit ${r.status}`}`, false);
  }
  let pages;
  try {
    pages = JSON.parse(r.stdout);
  } catch {
    pages = null;
  }
  if (!Array.isArray(pages)) throw ghError(`gh api ${endpoint}: unexpected answer (not JSON pages)`, false);
  return pages;
}

const list = (run, endpoint, query = '') => api(run, `${endpoint}?${query}per_page=100`).flat();

// Open PRs in the `pullRequests` shape lib/tasks-sync.js reads. The REST pulls API has no closing references,
// so a PR closes a ticket through a whole "Closes #N" line in its title or body, the same rule as for commits.
function fetchOpenPullRequests(run, repo) {
  return list(run, `repos/${repo || '{owner}/{repo}'}/pulls`, 'state=open&').map((p) => ({
    number: p.number, state: p.state, draft: Boolean(p.draft), title: p.title, body: p.body,
  }));
}

// spec: the spec issue number. repo: "owner/name"; default lets gh resolve {owner}/{repo} from the clone.
// Throws an Error with `unreachable` true when gh is missing, unauthenticated or offline.
function fetchSpecIssues(spec, { run = ghRunner, repo } = {}) {
  const base = `repos/${repo || '{owner}/{repo}'}/issues`;
  const subIssues = list(run, `${base}/${Number(spec)}/sub_issues`);
  const inSpec = new Set(subIssues.map((i) => Number(i.number)));

  const issues = subIssues.map((issue) => {
    // The summary counts open and closed blockers; ask only when it is absent or non-zero.
    const total = issue.issue_dependencies_summary && issue.issue_dependencies_summary.total_blocked_by;
    if (total === 0 || issue.pull_request) return { ...issue, blockedBy: [] };
    const blockers = list(run, `${base}/${Number(issue.number)}/dependencies/blocked_by`);
    return { ...issue, blockedBy: blockers.map((b) => ({ number: b.number, state: b.state })) };
  });

  // Body "Blocked by" references outside the spec and without a native edge: look up their state.
  const outside = new Set();
  for (const issue of issues) {
    const native = new Set(issue.blockedBy.map((b) => Number(b.number)));
    for (const n of bodyBlockers(issue.body)) if (!inSpec.has(n) && !native.has(n)) outside.add(n);
  }
  // A deleted or transferred blocker (404) stays unknown, which counts as open, instead of failing the pull.
  const external = [...outside].sort((a, b) => a - b).map((n) => {
    try {
      const [found] = api(run, `${base}/${n}`);
      return { number: n, state: found && found.state };
    } catch (err) {
      if (err.unreachable || !/HTTP 404|Not Found/i.test(err.message)) throw err;
      return { number: n, state: undefined };
    }
  });
  return { issues, external, pullRequests: fetchOpenPullRequests(run, repo) };
}

// One issue (for its labels): the owner gates read the spec issue live. Throws like fetchSpecIssues.
function fetchIssue(number, { run = ghRunner, repo } = {}) {
  const [issue] = api(run, `repos/${repo || '{owner}/{repo}'}/issues/${Number(number)}`);
  if (!issue || typeof issue !== 'object') throw ghError(`issue #${Number(number)}: unexpected answer`, false);
  return issue;
}

// The comments of one issue, oldest first (the owner's layer verdicts are comments on the spec issue).
function fetchIssueComments(number, { run = ghRunner, repo } = {}) {
  return list(run, `repos/${repo || '{owner}/{repo}'}/issues/${Number(number)}/comments`);
}

module.exports = { fetchSpecIssues, fetchIssue, fetchIssueComments };
