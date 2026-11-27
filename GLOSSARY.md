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

**Product repository**:
The repository one product lives in, never `claude-setup` itself.
_Avoid_: project repo, app repo

**Setup checklist**:
The rows `setup-repo.js` prints for a product repository (harness, the two plugins, labels, repository docs, cloud environment), each `done`, `already there` or `needs you` with a link and one action; complete when no row needs the owner.
_Avoid_: onboarding, bootstrap

**Product run**:
A harness run whose verify command is `pipeline.js check` (a first run or a change run of `orch-product-team`); `harness.js init` starts one only when the product repository's setup checklist is complete. A run with `verify.js` as its command is a build-only run.
_Avoid_: pipeline run (for the start check)

## Approvals

**Owner**:
The person who decides scope, spend, secrets, legal questions, and the owner gates.
_Avoid_: user, admin

**Owner gate**:
A point where a run waits for the owner; there are three, design-approved, spec-approved and accepted (two for a product with no designed screens, or a run started before design-approved existed).
_Avoid_: human gate, checkpoint, approval step

**Design-approved**:
The owner gate on a spec issue where the owner approves the look and the key screens, rendered, before the system is designed. Its phase is the look phase; its page is the design-approved page.
_Avoid_: design review, design sign-off

**Look phase**:
The phase between the experience phase and system design that renders look variations and the key screens with the chosen look onto the design-approved page, with the rendered files in `screens/`.
_Avoid_: design phase (that is system design)

**Spec-approved**:
The owner gate on a spec issue, passed before tickets and tests are written. It includes the chosen look only when the run has no design-approved gate; otherwise its page links the approved design.

**Accepted**:
The owner gate where the owner accepts the finished result against its spec issue.

**Change request**:
A request to change a product the owner has already accepted, on its own issue, sized as a fix, a change or a new direction; the size decides its phases and gates.
_Avoid_: follow-up, v2, enhancement

**Size**:
How much weight a change request gets: fix, change or new direction, written on the request's issue and as a `Size:` line in its `decisions.md`. A size only goes up.
_Avoid_: priority, estimate

**Fix**:
A change request that adds no new behaviour. The owner's issue is the request: no spec issue and no spec-approved gate, one ticket, the build gate, and the owner's accepted on that issue. A fix found to need new behaviour is re-sized as a change.
_Avoid_: hotfix, patch, bug (for the size)

**Change**:
A change request that adds new behaviour inside the approved product: its own spec issue, a short spec phase and both owner gates.
_Avoid_: feature, enhancement (for the size)

**New direction**:
A change request that changes what the product is: phases 1 to 4a in full, in the change's records, and both owner gates.
_Avoid_: pivot, v2

**Change run**:
The harness run for one change request (`pipeline.js check ... --change <N>`), walked by its size: a fix walks size, plan, build, review, qa, release and accepted; a change size, spec, spec-approved, plan, build, review, qa, release and accepted; a new direction adds discover, ux and design before its spec. Gates are on issue #N, records in `changes/<N>/` beside the first run's.
_Avoid_: rerun, second run

**Gate response**:
The owner's first prompt after a run stopped at an owner gate (the pipeline reported `waiting`); not an intervention.

**Stopped**:
The owner's "stop" (or `harness: stop`): nothing is published, pushed or written to GitHub until the owner says "continue", whoever started the turn (#113).
_Avoid_: paused, halted

**Run-unattended**:
The owner's "run without me" (or `harness: unattended`): the session does not end a turn to ask permission for a step inside the agreed work. Owner gates and owner-only decisions still end the turn, on an **Owner decision line** (#113).
_Avoid_: autopilot, auto mode

**Owner decision line**:
A line starting `Owner decision:` in a closing message: the one way to end a turn with a question while run-unattended.

**Kickoff choices**:
The owner's twelve process choices for a product (how gates are approved, who judges them, who merges, absent or reachable, how a halt arrives, who picks standards and the look, staging, user testing, security review), made before a run starts and kept in the product's `kickoff.json`. About the process only; what goes into the product is the build standards checklist (#127). A choice that no check holds yet is **recorded only**.
_Avoid_: settings, preferences, config (for the owner's choices)

**Hard limits**:
The areas whose work always stops for the owner, whatever the kickoff choices say: login and accounts, payments, user data, data migrations, deploy, secrets, spend and legal. Fixed in `lib/kickoff.js`; a product can add areas, never remove one.
_Avoid_: sensitive list, red lines

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
_Avoid_: plugin, driver

**Adapter catalogue**:
The list of adapters in `.claude/harness/adapters/catalogue.json`, each with the stacks and product kinds it fits, the gate checks it provides and leaves out, and its status: `proven` (fixture green in CI and a product built), `experimental` (fixture green only) or `planned` (no adapter yet). The stack of each product is chosen from it at kickoff.
_Avoid_: stack list, support matrix

**Build standard**:
One checkable line of what a product of a given kind must have, in the standards catalogue: what must be true, how it is tested, why, and a source (OWASP ASVS, an OWASP cheat sheet, WCAG, a file in this repository or an owner issue). Standards in scope become tested requirements; the rest are listed under "not building" (spec #127).
_Avoid_: requirement (that is the product's own), rule, best practice

**Standards catalogue**:
The build standards in `.claude/harness/standards/`, one file per layer: every product, then per capability (for example accounts and sign-in), product kind, domain and implementation. A topic a layer should cover but has no source for is listed as a **gap**. Checked by `check-standards.js`.
_Avoid_: checklist (outside owner-facing text), standards list

**Report contract**:
The standard reports the verify gate reads (JUnit XML for test results; lcov and the mutation-testing-elements JSON to follow) and the trust rules it applies to them: a non-zero exit fails, the gate owns a fresh report directory outside the project, only a report written during the run counts, and its totals must match the runner's own summary. Recorded in ADR-0003.
_Avoid_: report format, output spec

**Full gate**:
The heavy CI jobs that decide a merge: the template's `verify`, and this repository's `gate-retro-board`, `gate-slug-react` and `eval-kit-selftest`. They run on a PR that is not a draft and on a manual run, never after a merge to `main`; on a docs-only PR their steps skip. Recorded in ADR-0004.
_Avoid_: heavy CI, slow checks, the full suite

**Draft PR (fast checks only)**:
A pull request opened as a draft. CI runs only the fast checks on it (`secret-scan`, `protected-files`, and here `harness-tests`); the full gate starts when the PR is marked ready. Agents open PRs as drafts and mark them ready when their work is done. A draft PR does not mark its ticket done (ADR-0001).
_Avoid_: WIP PR

**Docs-only change**:
A PR whose every changed file ends in `.md` or is a text or image file under `docs/`, and none of them is a gate input (a protected path or a `--keep` path such as `testbench/`). Only such a PR skips the full gate's steps; one other file runs the gate. Recorded in ADR-0004.
_Avoid_: docs PR, trivial change

## Layout

**Test bench**:
The one reference product kept in this repo (`testbench/retro-board/`, run records in `docs/testbench/retro-board/`) that the process and its gate are proven and tuned on. Other products live in their own repositories.
_Avoid_: example, sample app, demo

**Product repository**:
The repository (or owner-given path) where `orch-product-team` builds one new product, with the harness installed and the run records in `<product-repo>/docs/product/<slug>/`. Never this repo.
_Avoid_: example folder, product folder

**Work folder**:
`.harness/work/<run>/`: gitignored space where helper agents keep unfinished work, writable during a harness run. Files move into the tree only when finished, so the cloud platform's commit-check Stop hook does not fire on work in progress (#112).
_Avoid_: scratch dir, tmp folder, staging area

**Running helper**:
A background agent this session started (its Agent call returned `async_launched`) with no end record yet: no SubagentStop and no successful TaskStop for it in the session trace, and launched under four hours ago. The Stop hook holds a stop once while one exists (#86).
_Avoid_: pending agent, open task

## Design

**Design run**:
Design work (looks, brand kits, concept art, animation) carried out across one or more sessions under the `design-sessions` rules. It is its own kind of run, not a phase of the product pipeline, and has no owner gates of its own (spec #109).
_Avoid_: design phase

**Owning session**:
The one session that may publish to a given published page. The first session to publish the page becomes its owner, and the owner is recorded in the page register. Other sessions hand their content back to it.
_Avoid_: page author, writer session

**Page register**:
`docs/design/<product>/pages.json`: each published design page's URL, its file and its owning session. The publish guard reads it, and the post-publish hook adds a page that has no owner yet.
_Avoid_: page list, artifact log

**Current-direction file**:
`docs/design/<product>/direction.md`: the chosen look, the tool, the characters, the reference images, the quality check for each asset kind, and a dated log of changes. When the owner changes direction, this file changes first. Briefs link it and never copy it.
_Avoid_: design notes, style guide, mood board

**Check record**:
`docs/design/<product>/checks.json`: for each asset kind, the last run of its quality check (command, exit code, pass count, time, a one-line result and a hash of every file the asset covers). `design-check.js run` writes it from the current-direction file's `Checks` section (#111).
_Avoid_: test log, benchmark notes

**Check line**:
An asset's one-line result in the check record, such as `animations: pass - 56/56 passed, exit 0, <time>, <command>`. An asset is called done only by quoting its passing check line; with no line, a failing line or a stale one, it is not done.
_Avoid_: done message, sign-off

**Stale check**:
A check record whose asset files were changed, added or removed (or whose command changed) after it ran. It no longer counts until the check is run again. When the session has uncommitted changes to that asset, the design Stop hook tells it to run the check before ending the turn.
_Avoid_: old result, outdated benchmark

**Design brief**:
A hand-off to another session or agent, made from `templates/design-brief.md`. It has five sections: Task, Direction (a link to the current-direction file), Page and owner, Hand back, Done means (which asks for each asset's check line). `design-check.js --brief` checks it.
_Avoid_: prompt, handover note

**Hand back**:
How a session that does not own a page gets its content published: it delivers the files to the owning session, and the owning session publishes them.
_Avoid_: republish, sync
