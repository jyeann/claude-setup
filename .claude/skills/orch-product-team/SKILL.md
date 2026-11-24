---
name: orch-product-team
description: Run a product the way a small company would - discover and scope, design the experience, design the system, plan, build under the verify gate, review in parallel, walk the product as a user, document, and hold a retro - with one human gate (final acceptance), every other decision made by an agent and logged, and per-phase cost, effort and human-touch measurement. Use when a new product or large feature starts from an idea rather than from a finished spec.
metadata:
  origin: local
---

# orch-product-team

The `orch-*` skills assume a spec already exists. This one covers the work before the spec and after the
build, and replaces the human approval gates with logged agent decisions so an unattended run is not
interrupted. Build and verify still go through the harness (`/harness-build`, `verify.js`).

## Principles

- **One human gate: final acceptance.** Scope, design, plan and commit approvals are agent decisions. Each is written to `docs/product/<slug>/decisions.md` as: decision, options, chosen, why, decided by. Ask a human only for spend, legal or real personal data.
- **A stop to ask a human is a defect.** The `UserPromptSubmit` hook counts human prompts; every prompt after the first in a session is an intervention and shows in the KPI view. Do not end a turn to ask "shall I continue?".
- **Delegated agents run in the foreground** so tokens, time and outcome are recorded. Background runs show as "outcome not reported".
- **Tag every delegated agent** with its phase: `description: "[phase:design] ..."`. The KPI roll-up groups cost by this tag. Pass `effort` explicitly (see Effort).
- **Done means a person can use it.** Every journey and UI check in `ux.md` is a browser test inside the verify gate (`journeys` in `verify.config.json`), so the build cannot go green while a journey fails. Phase 7 is a second, independent walkthrough on top of that.
- **The run cannot end early.** The whole pipeline is the harness's definition of done (`pipeline.js`), so the Stop hook returns the next unfinished phase instead of letting the turn end.

## Starting the run

Start the harness **before phase 1**, with the whole pipeline as the definition of done:

`node .claude/harness/bin/harness.js init --verify 'node .claude/harness/bin/pipeline.js check --product examples/<p> --docs docs/product/<p>' --task "<the idea, verbatim>" --open-gate-files --no-commit-gate --max 40 --stall 4`

- `pipeline.js check` walks the nine phases in order and exits 0 only when each has its output and the product's own `verify.js` gate is green. On every stop attempt the Stop hook runs it and hands back the first unfinished phase and what is missing. That message is the next task: do it, do not ask.
- `--open-gate-files` leaves `spec.md`, `acceptance/` and `verify.config.json` writable, because this run writes them in phase 4. From the moment phase 4 is complete, `pipeline.js` freezes them, the holdout and `ux.md` by hash. A later change fails the check unless `decisions.md` has a line `AMEND: <path> - <reason>`, one line per change. Only the test author amends a test; a builder never does.
- `--no-commit-gate` is required: the commit gate would refuse every commit until phase 9.
- Use single quotes around the verify command.
- Each stop attempt costs one of the 40 iterations and re-runs the product gate once phase 4 is done, so stay in the turn while an agent works and stop only when a phase is finished.
- The holdout is not hidden by the harness in this mode, because its author must be able to correct it mid-run. Never give a builder the holdout path or contents. For harness-enforced hiding, use the build-only run below.

**Build-only run (spec and tests already exist, written outside the run):** `node .claude/harness/bin/harness.js init --verify 'cd examples/<p> && CLAUDE_PROJECT_DIR="$PWD" node ../../.claude/harness/bin/verify.js' --task-file examples/<p>/spec.md --protect examples/<p>/acceptance/,examples/<p>/verify.config.json,docs/product/<p>/ --hide examples/<p>/holdout --max 14 --stall 3`. Here the harness write-protects the tests and hides the holdout, but nothing stops the agent ending the turn in the other phases.

## Phases, roles, artifacts

| # | Phase tag | Who | Output (under `docs/product/<slug>/`) | Exit check |
|---|-----------|-----|----------------------------------------|------------|
| 1 | `discover` | `product-scoper` | `brief.md` | build/adopt/extend decided; success criteria are user-visible and testable |
| 2 | `ux` | `ux-designer` (+ `a11y-architect` for review) | `ux.md` | every success criterion has a journey and a UI acceptance check |
| 3 | `design` | `architect`, `api-design` skill; record choices with `architecture-decision-records` | `design.md`, `adr/` | interfaces, data, failure modes, security notes written; ADR per real choice; `architect` is read-only, so save its text verbatim (a writer agent given the exact text, a diff-free check, or give it Write). Never retype or shorten it: a dropped caveat reached the holdout author and failed a gate |
| 4 | `plan` | `planner`, then `plan-to-tasks` | `TASKS.md`, spec, acceptance tests, hidden tests, browser journey tests (`journeys/`, from `harness/templates/journeys.test.js`), `verify.config.json` with `holdout` and `journeys` | acceptance tests exist, fail for the right reason (RED), written by an agent other than the builder; the author of the visible and the hidden tests has run every file (see Test author rules) |
| 5 | `build` | `tdd-guide` / `gan-generator` under `/harness-build` | code, unit tests | `verify.js` exits 0 (tests, type check, coverage, test quality, holdout, browser journeys, mutation) |
| 6 | `review` | `code-reviewer`, `security-reviewer`, `a11y-architect`, `performance-optimizer` in parallel, foreground | `reviews.md`, containing the line `Open: CRITICAL 0, HIGH 0` with the true counts after the fix round | no CRITICAL or HIGH open; MEDIUM fixed or logged with a reason; every reviewer is given `ux.md` as a hard requirement list, and a finding that contradicts it is escalated, not applied |
| 7 | `qa` | `e2e-runner` (Playwright) or `gan-evaluator` | `qa.md`, screenshots | an agent that did not write the journey tests walks the product as a first-time user and records what the scripted journeys miss; defects go back to phase 5 |
| 8 | `release` | `doc-updater` | README with run steps, `CHANGELOG` entry | someone with only the README can run it |
| 9 | `retro` | `harness-improver` + the KPI roll-up | `retro.md` | one evidence-backed change proposed; KPI file refreshed |

All nine phases run inside the one harness run. The product gate is re-run on every check from phase 5 on, so a review fix that breaks a test or a journey sends the pipeline back to phase 5 by itself. A failing phase 6 or 7 goes back to 5 with the finding as the task. Cap the loop at 3 round trips, then halt and report.

## Test author rules (phase 4)

Wrong hidden tests failed the gate in two runs because their author never ran them. Before any builder starts, the test author must:

- **Run every visible and hidden test file once** and paste the summary line into `decisions.md`. Each test must fail because the behaviour is missing (404, missing export, wrong value), never because the test itself is broken (syntax error, bad import path, malformed URL, wrong port). Fix a broken test before handing over.
- **Cite the source of every expected value in a hidden test**: a comment with the line of `spec.md` or `design.md` it comes from. A value with no line to cite is a guess; remove the test or get the rule written into the spec first.
- **Check the two suites against each other**: no hidden test may contradict a visible one on the same input.

When the gate reports a holdout failure while the visible tests pass, do not send it straight to the builder. The test author (not the builder, who must not see the holdout) first checks each failing hidden test against its cited line, fixes any that are wrong, logs that in `decisions.md`, and only then passes "N hidden tests still fail" to the builder.

## Right-sizing

Small fixes and single-file changes do not need phases 1-4: give the fix to `tdd-guide` under `/harness-build`. Run this skill for a new product or a feature with a user-facing surface. A change that touches a screen always runs 2 and 7.

## Effort (measured defaults, sonnet, one product)

From the per-phase comparison on the retro board (`docs/testbench/retro-board/effort-by-phase.md`, 24 cells of 1 to 2 trials, objective graders):

| Phase | Default | Why |
|---|---|---|
| discover, ux, design, release | `low` | All levels passed; `high` cost 1.4x to 2.0x for no measured gain |
| review, qa | `low` | All levels passed the seeded-defect graders; `high` cost 1.5x. Use `high` for auth, input, files and money on judgment: the data does not show it helps |
| tests (test owner) | `medium` | `low` passed 1 of 2; `high` cost 2x `medium` with the same pass |
| build | `low` or `medium`, with the full gate including the hidden holdout | `high` failed the gate 2 of 2: in the one run diagnosed, it missed a rule from the design that no visible test covered (control characters in card text) |

Read this carefully: most graders check coverage by keyword, so "all passed" means the checklist was met, not that the work was equal. Trials are few. Re-run `testbench/retro-board/tune/run.js` on a second product before treating any row as settled, and keep a hidden holdout in the build gate: it was the only check that told the effort levels apart on quality.

## Limits and resuming

When a usage limit stops an agent, write the state to `docs/product/<slug>/status.md` (phase, what is done, what is next), schedule a resume with `send_later` at the reset time, and continue with `SendMessage` to the stopped agent. Do not wait for a human to say "try again".

## KPI proof

After phase 9, run `node .claude/harness/bin/agents-kpi.js --out kpi.json`. It reports per agent, per phase and per model/effort: runs, failures, outcome-not-reported, tokens, time; plus human prompts and interventions. A run is credible only if the KPI file shows foreground, tagged, effort-stamped runs and zero interventions after the first prompt.
