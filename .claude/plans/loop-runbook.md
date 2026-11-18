# Loop Runbook (template)

Pattern: sequential | Mode: safe

## Goal
<ONE sentence: what the loop must achieve, e.g. "Make all tasks in TASKS.md pass their tests">

## Branch rules (agent does automatically)
1. Create branch `loop/<goal-slug>-<YYYYMMDD>` from the default branch. Never work on the default branch.
2. Commit small, one task per commit (conventional commits).
3. Push only this branch.

## Before iteration 1
- Run the test suite. If it fails, STOP and report (do not start).
- Record baseline: failing tests = 0, coverage = <x>%.

## Each iteration
1. Pick the next unfinished task.
2. Write/adjust a failing test, implement, run tests.
3. If tests pass and no new lint/type errors: commit, log a checkpoint line in `.claude/plans/loop-log.md`.
4. If tests fail: go to "On failure".

## On failure (check and repeat until cause is clear)
1. Reproduce and read the full error/logs.
2. State a root-cause hypothesis in the log.
3. Make the smallest fix, re-run tests.
4. Max 3 attempts per issue. Do not repeat an identical fix.
5. After 3 attempts with the cause still unclear: mark the task BLOCKED, write what was learned, move to next task.

## Stop conditions (stop at the FIRST that is true)
- All tasks done and tests green.  -> SUCCESS
- 20 total iterations reached.  -> STOP, report
- 3 consecutive BLOCKED tasks, or no progress across 2 checkpoints.  -> STOP, escalate
- Same stack trace repeats 3 times.  -> STOP, escalate
- Cost/time budget exceeded (budget: <set me>).  -> STOP, escalate
- Merge conflict or a change touching secrets/auth/payments.  -> STOP, ask human

## Finish (agent does)
1. Run full tests + lint + type check; confirm coverage >= 80%.
2. Push the branch and write a summary in `.claude/plans/loop-log.md`
   (done, blocked, how to roll back).
3. Open a PR to the default branch. DO NOT merge. A human reviews and merges.

## Rollback
`git revert` the loop's commits, or delete the branch. Default branch is never touched.
