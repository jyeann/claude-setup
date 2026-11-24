# Tasks

> **Generated, do not edit.** `node .claude/harness/bin/tasks-sync.js pull --spec <n>` writes this
> file from a spec issue's tickets (task `T<N>` = issue `#N`, `afk`/`hitl` labels = type, `Blocked by` = blocked-by) and
> overwrites hand edits. Change the issues, or commit with `Closes #N`, then pull again. The tasks below are an example.
>
> One heading per task: `## <id>: <title>`, then `- key: value` lines. Anything else is ignored.
> `node .claude/harness/bin/next-task.js TASKS.md` lists the AFK tasks that are ready (exit 0),
> or prints ALL_DONE / NEEDS_HUMAN / STUCK (exit 3), or lists format errors (exit 2).
>
> - type:       `AFK` = an agent can finish it alone. `HITL` = needs a human (design call, credentials, manual QA).
> - blocked-by: comma-separated task ids, or `none`.
> - status:     `todo` | `doing` | `done` | `blocked`, derived, never typed. First match wins: closed as not planned =
>               `blocked`; issue closed, a `Closes #N` commit on this branch, or an open, non-draft PR
>               that closes it = `done`; an open blocker outside the spec = `blocked`; a local ticket branch (`issue-<N>` or
>               `issue-<N>-<slug>` path segment) or its WIP checkpoint = `doing`; otherwise `todo`. See docs/adr/0001.
>
> Each task is a **vertical slice**: it cuts through every layer it needs (schema, service, API, UI) and ends in
> something you can run and check. Never write "all the schema" or "all the UI" as a task.

## T1: Award points for lesson completion, visible on the dashboard
- type: AFK
- blocked-by: none
- status: todo

Done when: completing a lesson adds points and the dashboard shows the total.
Touches: new `gamification` module (deep: small interface, logic inside), progress route, dashboard route.
Tests: through the `gamification` interface, not its internals.

## T2: Streak tracking
- type: AFK
- blocked-by: T1
- status: todo

## T3: Choose level thresholds
- type: HITL
- blocked-by: none
- status: todo

## T4: Retroactive backfill of existing progress
- type: AFK
- blocked-by: T1, T3
- status: todo
