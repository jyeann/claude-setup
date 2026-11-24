# GitHub issues are the tracker; TASKS.md is a generated task list

Specs and tickets live as GitHub issues (`working.md`), but the build loop (`next-task.js`, `loop-runbook.md`) and the pipeline's plan check read `TASKS.md`. We keep `TASKS.md` as a **generated, uncommitted** task list written by `tasks-sync.js` from a spec issue's tickets, with each ticket's status **derived** from facts (issue closed, a `Closes #N` commit or open PR, a ticket branch) instead of typed by the agent. This keeps builds working without network access after one pull, leaves the tested loop machinery unchanged, and still meets "no hand-written status files".

## Considered Options

- **Issues only**: `next-task.js` and `pipeline.js` query GitHub directly. One source of truth, but every unattended build needs network and a token, and cloud sessions without `gh` cannot build. Rejected for now; this ADR is the first step towards it.
- **Committed, hand-maintained TASKS.md** (the old `plan-to-tasks`): drifts from the issues and breaks the tracker rule. Rejected.

## Consequences

- Status precedence, first match wins: closed as not planned → `blocked`; issue closed, or a closing commit, or an open PR that closes it → `done`; an open blocker outside the spec → `blocked`; a ticket branch or WIP checkpoint → `doing`; otherwise `todo`.
- Only a whole `Closes #N` line counts (not `- Closes #N` or `Closes #N.`), in a commit on this branch (since the base branch), and reverted commits do not, so prose or old history cannot mark a ticket done. An open, non-draft PR closes `#N` the same way in its title or body, or through GitHub's `closingIssuesReferences`; the PR list comes from the saved JSON (`pullRequests`). A draft PR is unfinished work, so it does not count.
- A **ticket branch** is a local branch with a path segment `issue-<N>` or `issue-<N>-<slug>` (for example `claude/issue-22-derived-status`); a harness WIP checkpoint `refs/harness/wip/<ticket branch>` counts the same. The pattern is strict so unrelated branches (`fix-22`, `issue22`, a dated loop branch) never match. Remote-tracking branches do not count, so another session's branch never stops this loop. A ticket branch that is not checked out stays `doing` even with a closing commit, until its PR is open: its dependents must not start on a branch without its code. A stale ticket branch keeps its ticket `doing` until it is renamed or deleted, or the issue closes. A closing commit on this branch wins over an open issue on purpose: that is a finished ticket waiting for the owner's merge. An issue closed as not planned is `blocked`, never `done`, so its dependents do not start.
- A hand edit to `TASKS.md` is overwritten on the next pull.
- The build loop commits each task with `Closes #N` and re-pulls instead of typing status (`loop-runbook.md`). With the commit gate on (the default) those commits wait until verify is green; one commit per task needs `--no-commit-gate`, as before.
- Until #21's live pull, PR and issue state are only as fresh as the saved JSON.
- Planned, not built yet: a live `gh` pull and a `tasks-sync.js check` that reports a stale or hand-edited list (#21).
