# Agent setup

How work moves from an idea to a merged change in this repo's agent process: who decides, where work is tracked, and when a human is asked.

## Tracking

**Spec issue**:
A GitHub issue holding the agreed spec for one feature or product; its tickets are its sub-issues.
_Avoid_: PRD, plan, epic

**Ticket**:
A sub-issue of a spec issue describing one vertical slice that can be built and checked on its own in one session.
_Avoid_: task (except inside the generated task list), story, card

**Blocker**:
A ticket that must be closed before another ticket can start.
_Avoid_: dependency, prerequisite

**AFK**:
A ticket an agent can finish alone (label `afk`).

**HITL**:
A ticket that needs a human: a product decision, credentials, manual QA or visual judgement (label `hitl`).

**Task list**:
`TASKS.md`, generated from a spec issue's tickets for the build loop to read; never edited by hand and never committed.
_Avoid_: backlog file, todo file

**Derived status**:
A ticket's `todo` / `doing` / `done` / `blocked` in the task list, computed from GitHub and git facts (closed issue, a `Closes #N` commit or open PR, a ticket branch, an open blocker outside the spec) rather than typed by anyone. Precedence is in ADR-0001.

**Ticket branch**:
A git branch for one ticket, named with a path segment `issue-<N>` or `issue-<N>-<slug>` (for example `claude/issue-22-derived-status`); without a closing commit it makes the ticket `doing`.
_Avoid_: feature branch (for this meaning)

## Approvals

**Owner**:
The person who decides scope, spend, secrets, legal questions, and the two owner gates.
_Avoid_: user, admin

**Owner gate**:
A point where a run waits for the owner; there are exactly two, spec-approved and accepted.
_Avoid_: human gate, checkpoint, approval step

**Spec-approved**:
The owner gate on a spec issue, including the chosen look, passed before tickets and tests are written.

**Accepted**:
The owner gate where the owner accepts the finished result against its spec issue.

**Intervention**:
A human prompt mid-run that is not an answer to an owner gate; counted as a defect in the KPI.
_Avoid_: interruption
