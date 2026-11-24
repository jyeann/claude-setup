# GitHub issues are the tracker; TASKS.md is a generated task list

Specs and tickets live as GitHub issues (`working.md`), but the build loop (`next-task.js`, `loop-runbook.md`) and the pipeline's plan check read `TASKS.md`. We keep `TASKS.md` as a **generated, uncommitted** task list written by `tasks-sync.js` from a spec issue's tickets, with each ticket's status **derived** from facts (issue closed, a `Closes #N` commit or open PR, a ticket branch) instead of typed by the agent. This keeps builds working without network access after one pull, leaves the tested loop machinery unchanged, and still meets "no hand-written status files".

## Considered Options

- **Issues only**: `next-task.js` and `pipeline.js` query GitHub directly. One source of truth, but every unattended build needs network and a token, and cloud sessions without `gh` cannot build. Rejected for now; this ADR is the first step towards it.
- **Committed, hand-maintained TASKS.md** (the old `plan-to-tasks`): drifts from the issues and breaks the tracker rule. Rejected.

## Consequences

- The loop no longer types `doing` / `done`. It commits with `Closes #N` and re-pulls.
- A hand edit to `TASKS.md` is overwritten on the next pull and is reported by `tasks-sync.js check` when GitHub is reachable.
