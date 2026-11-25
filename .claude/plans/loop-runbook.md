# Loop Runbook

Pattern: sequential | Mode: safe

## Goal
Work through every AFK task in `TASKS.md` until all are done and the test suite is green.
`TASKS.md` is generated from a spec issue's tickets (GitHub sub-issues made with `/mattpocock-skills:to-tickets`) by `tasks-sync.js pull` (format: `.claude/harness/templates/tasks.md`); never edit it.
Pull it with: `node .claude/harness/bin/tasks-sync.js pull --spec <n>` (through `gh`; without it, `--from-json <issues.json>` saved with the GitHub MCP tools, see `docs/agents/issue-tracker.md`).

## Run it under the harness (enforced limits)
Prose limits depend on the agent obeying them. Start the run with the harness so they are enforced:
```bash
node .claude/harness/bin/harness.js init --verify "<cmd>" --task-file TASKS.md \
  --max 10 --stall 3 --max-minutes 60 --no-progress 3 [--checkpoint-push]
```
| Stop condition | Enforced by |
|---|---|
| 10 total iterations | `--max 10` |
| Same stack trace 3 times | `--stall 3` |
| 1 hour wall-clock | `--max-minutes 60` |
| No progress (failing-test count not dropping) | `--no-progress 3` |
| 3 consecutive tasks handed to a human (`hitl`) | agent, on its honour (log it) |
| Merge conflict, or a change touching secrets/auth/payments | secret scan + guards; the agent stops and asks a human |

Every halt gets one bounded diagnosis turn (`HARNESS-DIAGNOSIS.md`) before the run ends.

## Branch rules (agent does automatically)
1. Work each task on a **ticket branch** `loop/issue-<N>-<slug>` for its issue `#N`: the first from the default branch,
   each next one from the previous, so earlier `Closes` commits stay on it. Never work on the default branch.
   That name is what makes the task `doing` after a crash (with its WIP checkpoint `refs/harness/wip/<branch>`).
2. Push only these branches.
3. Commits: one per task, ending with a `Closes #N` line; that commit is what makes the task `done`. With the harness
   commit gate on (the default), `git commit` is refused while verify fails, so a task's commit waits until verify is
   green; for one commit per task while later tasks still fail, start with `--no-commit-gate`. Conventional commits.

## Before iteration 1
- Run `node .claude/harness/bin/harness.js verify`. If it fails for a reason other than the unfinished tasks, STOP and report.
- Record the baseline in `.claude/plans/loop-log.md`: failing tests, coverage.

## Each iteration
1. Pull the task list (`tasks-sync.js pull`, above; with `--from-json`, save the JSON again first), then run `node .claude/harness/bin/next-task.js TASKS.md`. If a task is
   `doing` on your ticket branch, resume it first. Exit 0 lists the ready tasks (AFK, unblocked): take the first `T<N>`
   and create its ticket branch (rule 1). Exit 3 means stop: `ALL_DONE` = success, `NEEDS_HUMAN` or `STUCK` = escalate,
   `IN_PROGRESS` = an interrupted ticket branch or checkpoint exists: `git switch` to that ticket branch, run
   `harness.js restore` to bring back its checkpointed files, and resume it.
   Exit 2 = fix the issue the error names, then pull again. Never type a status into `TASKS.md`.
2. Write/adjust a failing test, implement, run tests.
3. If tests pass and no new lint/type errors: log a checkpoint line in `.claude/plans/loop-log.md`, commit with a
   `Closes #N` line, and pull the task list again; `T<N>` now shows `done`.
4. If tests fail: go to "On failure".

## On failure (check and repeat until cause is clear)
1. Reproduce and read the full error/logs.
2. State a root-cause hypothesis in the log.
3. Make the smallest fix, re-run tests.
4. Max 3 attempts per issue. Do not repeat an identical fix.
5. After 3 attempts with the cause still unclear: comment what was learned on issue `#N` and swap its label `afk` for
   `hitl`; switch back to the branch you started it from and rename the ticket branch to `parked/<N>-<slug>` (keeps
   the work, ends `doing`); pull again and move to the next task.

## Finish (agent does)
1. Run full tests + lint + type check; confirm coverage >= 80%.
2. Push the ticket branches and write a summary in `.claude/plans/loop-log.md` (done, blocked, how to roll back).
3. Open a PR from the last ticket branch to the default branch as a **draft**, with every `Closes #N` in its body; CI runs only the fast checks on it. Mark it ready when the work is pushed, which starts the full gate (ADR-0004). DO NOT merge. A human reviews and merges.

## Rollback
`git revert` the loop's commits, or delete the branch. Default branch is never touched. After a crash, `harness.js restore`.
