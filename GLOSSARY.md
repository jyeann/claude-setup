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
A local git branch for one ticket, named with a path segment `issue-<N>` or `issue-<N>-<slug>` (for example `claude/issue-22-derived-status`); it makes the ticket `doing` until a closing commit on the current branch, an open PR or the closed issue makes it `done`.
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

**Gate response**:
The owner's first prompt after a run stopped at an owner gate (the pipeline reported `waiting`); not an intervention.

**Intervention**:
A human prompt mid-run that is not an answer to an owner gate; counted as a defect in the KPI.
_Avoid_: interruption

## Judgement

**Judgement layer**:
One of five things a product is judged on: problem (the right thing for the right people), impression (it feels right in use), approach (a sound design that will last), correctness (it does what the spec says) and craft (clean, safe, fast code).
_Avoid_: quality dimension, review axis

**Layer verdict**:
The owner's answer for one judgement layer at an owner gate, either pass or redirect, with a reason when it is a redirect.
_Avoid_: score, rating, sign-off

**Redirect**:
A layer verdict of redirect that names the failed layer and a reason, and sends the run back only to that layer's phase (problem to discover, impression to ux, approach to design, correctness or craft to build).
_Avoid_: rejection, rollback, restart

**Progress summary**:
A one-page note published once per build round when about 70% of tickets are done, showing what works, what drifted and what is left; it is not an owner gate and not a checkpoint, never blocks the build, and silence means carry on.
_Avoid_: checkpoint, status gate, mid-run approval

**Progress response**:
An owner comment on a progress summary; it is not an intervention.
_Avoid_: intervention

**One-way decision**:
A decision that is hard to undo, so it is shown on the spec-approved page for the owner to judge.
_Avoid_: major decision

**Two-way decision**:
A decision that is cheap to undo, so it is only logged in `decisions.md`.
_Avoid_: minor decision

## Gate

**Adapter**:
The `adapter` setting in `verify.config.json` that chooses how the verify gate measures a project: `node` (default) uses the gate's own `node:test` measuring, any other adapter judges the reports the project's own tools write under the report contract.
_Avoid_: plugin, driver, preset

**Report contract**:
The standard reports the verify gate reads (JUnit XML for test results; lcov and the mutation-testing-elements JSON to follow) and the trust rules it applies to them: a non-zero exit fails, the gate owns a fresh report directory outside the project, only a report written during the run counts, and its totals must match the runner's own summary. Recorded in ADR-0003.
_Avoid_: report format, output spec

## Layout

**Test bench**:
The one reference product kept in this repo (`testbench/retro-board/`, run records in `docs/testbench/retro-board/`) that the process and its gate are proven and tuned on. Other products live in their own repositories.
_Avoid_: example, sample app, demo

**Product repository**:
The repository (or owner-given path) where `orch-product-team` builds one new product, with the harness installed and the run records in `<product-repo>/docs/product/<slug>/`. Never this repo.
_Avoid_: example folder, product folder
