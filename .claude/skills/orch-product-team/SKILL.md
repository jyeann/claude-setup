---
name: orch-product-team
description: Run a product the way a small company would - discover and scope, design the experience, design the system, plan, build under the verify gate, review in parallel, walk the product as a user, document, and hold a retro - with two owner gates (spec-approved, accepted), every other decision made by an agent and logged, and per-phase cost, effort and human-touch measurement. Use when a new product or large feature starts from an idea rather than from a finished spec.
metadata:
  origin: local
---

# orch-product-team

The `orch-*` skills assume a spec already exists. This one covers the work before the spec and after the
build. The owner is asked at exactly two owner gates; every other approval is a logged agent decision, so an
unattended run is not interrupted between them. Build and verify still go through the harness (`/harness-build`, `verify.js`).

## Principles

- **Two owner gates, labels on the spec issue.** `spec-approved` (the spec issue, including the look chosen from rendered variations) comes after phase 4a, before any ticket or test is written; `accepted` (the result against the spec issue) comes after phase 8, before the retro. Only the owner adds these labels; never add one yourself. Scope, design, plan and commit approvals are agent decisions. Each is written to `<product-repo>/docs/product/<slug>/decisions.md` as a table row:

  | Decision | Options | Chosen | Why | Decided by | Door |
  |---|---|---|---|---|---|

  `Door` is `one-way` (hard to undo: scope, look, data model, a hosted service; shown on the spec-approved page) or `two-way` (cheap to undo: branch names, file layout, a library swap; only logged). Ask the owner outside the gates only for spend, legal or real personal data.
- **One page before `spec-approved`.** Before asking for the label, fill `.claude/harness/templates/spec-approved-page.md` from `brief.md`, `ux.md`, `design.md` and the `one-way` rows of `decisions.md`, save it as `<product-repo>/docs/product/<slug>/spec-approved-page.md`, and post it on the spec issue (a comment, or a link to the page). Its seven sections: problem and who it is for; not building; the 3-4 real choices, each with alternatives and the trade-off, with a **Stack** part (the proposed stack and 1-2 alternatives, each with its adapter status and the checks the gate would not run); screens (rendered, linked); done means, in user terms; what we're unsure about; who judges each judgement layer (owner, checks, developer review or skip). Write it in plain language for the owner: no code, commands or file formats. `pipeline.js` keeps phase 4a incomplete until the page exists with every section filled, names any missing or unfilled section, and refuses a code block.
- **The stack is chosen at kickoff, from the adapter catalogue.** In phase 3 the `architect` reads `.claude/harness/adapters/catalogue.json` (each adapter's stacks, product kinds, checks, missing checks and status: `proven`, `experimental` or `planned`) and proposes a stack plus 1-2 alternatives, with how well the gate supports each. `design.md` gets a `## Stack` section with the choice on a line `Adapter: <id> (<status>)`, the status exactly as the catalogue gives it. A stack whose adapter is `planned` or missing has three options, shown to the owner on the page: a supported alternative (`Unsupported: <stack>; option: supported alternative` plus the `Adapter:` line of the alternative), a weaker gate (`option: weaker gate` plus the `Adapter:` line of the adapter that runs it; the missing checks go on a line `Weaker gate: <checks>` in the same Stack section, where the owner approves them with the page, and exactly the same list in `verify.config.json` `weakerGate`; `verify.js` prints them on every run, and a `decisions.md` line alone does not count), or building the adapter first as its own spec (`option: adapter first`; the plan phase stays incomplete until the adapter is in the catalogue). The chosen stack is a one-way row in `decisions.md`. `pipeline.js` keeps the design phase incomplete until the Stack section names a catalogue adapter with its status or records one of the three options. Until `spec-approved` the owner may change the stack freely: redo the Stack section and the page. The page's Stack part names at least one alternative, and all three options for an unsupported stack. In the plan phase write the chosen `adapter` into `verify.config.json` (without one the gate uses `node`); `pipeline.js` checks that it matches the Stack section.
- **A stack change after `spec-approved` is an approach redirect.** `design.md` is approved at `spec-approved`, so changing its Stack section otherwise voids the approval. Ask the owner for a verdict with `approach=redirect "<the new stack>"`: design and the page are redone, the owner judges again, then the plan is redone. `verify.config.json` and the adapter's tool configs are frozen, so the new `adapter`, the rewritten tests and every changed config need an `AMEND: <path> - <reason>` line each.
- **At a gate, end the turn; anywhere else, a stop to ask a human is a defect.** While a gate label is missing, `pipeline.js` reports `waiting for owner: spec issue #N needs label <gate>` and the Stop hook lets the turn end: tell the owner which issue to review, then stop. The owner's next prompt is a gate response. The `UserPromptSubmit` hook counts human prompts; every other prompt after the first in a session is an intervention and shows in the KPI view. Do not end a turn to ask "shall I continue?".
- **Delegated agents run in the foreground** so tokens, time and outcome are recorded. Background runs show as "outcome not reported".
- **Tag every delegated agent** with its phase: `description: "[phase:design] ..."`. The KPI roll-up groups cost by this tag. Pass `effort` explicitly (see Effort).
- **Done means a person can use it.** Every journey and UI check in `ux.md` is a browser test inside the verify gate (`journeys` in `verify.config.json`), so the build cannot go green while a journey fails. Phase 7 is a second, independent walkthrough on top of that.
- **The run cannot end early.** The whole pipeline is the harness's definition of done (`pipeline.js`), so the Stop hook returns the next unfinished phase instead of letting the turn end. The only exception is an owner gate whose label is really missing on the spec issue, read from GitHub on every check.

## Starting the run

A product run never writes into this repository (`claude-setup`). Each product lives in its own repository, called `<product-repo>` below, or at a path the owner gives. Its run records go in `<product-repo>/docs/product/<slug>/`, inside the product's repository.

1. **Pick the target.** Use the repository or path the owner named. With no target, propose a new repository named after the product (`<slug>`) and ask the owner once: a new repository is a spend and access decision. Do not start the run without the answer.
2. **Install the harness there** with the `harness-install` skill, or from a clone of this repo: `node .claude/harness/bin/install.js <product-repo>` (add `--dry-run` first to show the changes). Commit the result in `<product-repo>`.
3. **Work inside `<product-repo>`** from here on: open the session there, so its hooks and settings load. In the commands below, `<product-repo>` is that repository's absolute path.
4. **Start the harness before phase 1**, with the whole pipeline as the definition of done:

`node .claude/harness/bin/harness.js init --verify 'node .claude/harness/bin/pipeline.js check --product <product-repo> --docs <product-repo>/docs/product/<slug>' --task "<the idea, verbatim>" --open-gate-files --no-commit-gate --max 40 --stall 4`

When the owner gave a folder inside an existing repository, install the harness at that repository's root and pass the folder as `--product`. The first `pipeline.js check` reports `discover` as the next phase.

- `pipeline.js check` walks the phases and the two owner gates in order and exits 0 only when each phase has its output, both gate labels are on the spec issue and the product's own `verify.js` gate is green. On every stop attempt the Stop hook runs it and hands back the first unfinished phase and what is missing. That message is the next task: do it, do not ask.
- **Owner gates.** The spec issue lives in `<product-repo>` and its number is recorded in phase 4a as a line `Spec issue: #N` in `decisions.md`; the gates and the task list both use that number. `pipeline.js` reads the issue's labels live with `gh api` from the product directory. A missing label, or a GitHub it cannot reach, is `waiting` (exit 3): the Stop hook holds the agent once so it can tell the owner, then lets the turn end and keeps the run active at no iteration cost. Once the owner adds the label, the next check moves on with no other input. Where `gh` cannot reach GitHub at all, add `--issue-json <file>` to the verify command with a copy of the spec issue saved by the GitHub MCP `issue_read` tool; it is read only while `gh` is unreachable, and the report then warns that the labels came from that copy. Once `spec-approved` has passed, the spec issue number is pinned; changing the `Spec issue:` line afterwards fails the check.
- **Layer verdicts and redirects** (ADR-0002). At each owner gate the owner may leave a comment on the spec issue with a line naming every judgement layer once, for example `verdict: problem=pass impression=redirect "too cluttered" approach=pass correctness=pass craft=pass`. `pipeline.js` reads the latest verdict comment through the same source as the label (live with `gh`, or the `--issue-json` copy, which must then hold the issue's comments as an array, from `issue_read get_comments`). The gate passes when the label is on and the latest verdict, if any, is all pass. A **redirect** sends the run back only to that layer's phase: problem to `discover`, impression to `ux`, approach to `design`, correctness or craft to `build`. That phase is incomplete again until its output changes, its files may change without an `AMEND:` line until the gate is passed, and every other phase stays complete. Redo it (write a new spec-approved page when the gate is `spec-approved`), then end the turn and tell the owner what changed: the gate waits for a new verdict, and the label alone does not pass it. A malformed verdict (a layer missing or given twice, a redirect without a quoted reason, or more than one verdict line in a comment) is reported with the expected form and never counts as a pass; ask the owner to post it again. Verdict lines inside code blocks or blockquotes are quotes and are ignored.
- **Never write a `verdict:` line anywhere on GitHub** (comment, issue, pull request, edit), not even quoted: verdicts are the owner's alone. A harness guard blocks `gh` commands that carry one; describe what changed in your own words and ask the owner for the verdict.
- **Correctness and craft are judged at `accepted`**, on the built product. A redirect on either at `spec-approved` is reported as malformed and the gate waits; ask the owner to post the verdict again with those layers as `pass`.
- **3 rounds per gate.** Redirects are counted per gate in `.harness/pipeline/`. A 4th redirect at the same gate stops the run: `pipeline.js` reports `PIPELINE STOPPED` with the layer and every reason given. Redo nothing; end the turn and report to the owner, so the disagreement becomes a conversation. A new all-pass verdict lets the run continue.
- **Approval is tied to the approved files.** When a gate passes, `pipeline.js` records the hashes of what it approved (`spec-approved`: `brief.md`, `ux.md`, `design.md`, `adr/` and the page; `accepted`: the product). Changing any of them later without an `AMEND: <path> - <reason>` line voids the approval and the gate is `waiting` again until the owner posts a new verdict. A redirect frees its phase's files only at the gate that gave it: an impression redirect at `accepted` changes `ux.md`, which voids the `spec-approved` approval too, so the owner's next verdict answers both.
- **A new idea at `accepted` is not a redirect.** If the owner raises something the spec issue did not ask for, write it up as a new spec issue and judge the current result against its own spec; never stretch this run to fit it.
- `--open-gate-files` leaves `spec.md`, `acceptance/` and `verify.config.json` writable, because this run writes them in phase 4. From the moment phase 4 is complete, `pipeline.js` freezes them, the holdout, `ux.md` and the tool configs of the chosen adapter (for `vitest-stryker`: `vitest.config.*`, `vite.config.*`, `stryker.conf*`, `tsconfig*.json`, `playwright.config.*`, and any config file a command names; the list in `lib/protected.js`) by hash. A later change fails the check unless `decisions.md` has a line `AMEND: <path> - <reason>`, one line per change. Only the test author amends a test; a builder never does.
- `--no-commit-gate` is required: the commit gate would refuse every commit until phase 9.
- Use single quotes around the verify command.
- Each stop attempt (except a stop at an owner gate) costs one of the 40 iterations and re-runs the product gate once phase 4 is done, so stay in the turn while an agent works and stop only when a phase is finished.
- The holdout is not hidden by the harness in this mode, because its author must be able to correct it mid-run. Never give a builder the holdout path or contents. For harness-enforced hiding, use the build-only run below.

**Build-only run (spec and tests already exist, written outside the run):** in `<product-repo>`, with the harness installed as above: `node .claude/harness/bin/harness.js init --verify 'node .claude/harness/bin/verify.js' --task-file spec.md --protect acceptance/,verify.config.json,<product-repo>/docs/product/<slug>/ --hide holdout --max 14 --stall 3`. These paths assume the product is at the repository root; for a folder inside it, put the folder in front of `spec.md`, `acceptance/`, `verify.config.json` and `holdout`, and run `verify.js` from that folder. Here the harness write-protects the tests and hides the holdout, but nothing stops the agent ending the turn in the other phases.

## Phases, roles, artifacts

| # | Phase tag | Who | Output (under `<product-repo>/docs/product/<slug>/`) | Exit check |
|---|-----------|-----|----------------------------------------|------------|
| 1 | `discover` | `product-scoper` | `brief.md` | build/adopt/extend decided; success criteria are user-visible and testable |
| 2 | `ux` | `ux-designer` (+ `a11y-architect` for review) | `ux.md` | every success criterion has a journey and a UI acceptance check |
| 3 | `design` | `architect`, `api-design` skill; record choices with `architecture-decision-records` | `design.md` (with its `## Stack` section), `adr/` | stack chosen from the adapter catalogue (see above); interfaces, data, failure modes, security notes written; ADR per real choice; `architect` is read-only, so save its text verbatim (a writer agent given the exact text, a diff-free check, or give it Write). Never retype or shorten it: a dropped caveat reached the holdout author and failed a gate |
| 4a | `spec` | `to-spec`, `prototype` for the look | spec issue in `<product-repo>`; `decisions.md` lines `Spec issue: #N` and `Look: <choice>`; `spec-approved-page.md`, posted on the spec issue | the spec issue holds the scope and the look chosen from rendered variations; the page has all seven sections filled, the Stack part included, in plain language |
| gate | `spec-approved` | the owner | label `spec-approved` on the spec issue | until the owner adds it, `pipeline.js` reports `waiting`: end the turn and tell the owner which issue to review |
| 4b | `plan` | `planner`, then `/mattpocock-skills:to-tickets` (tickets as sub-issues of the spec issue, labelled `afk` or `hitl`), then `node .claude/harness/bin/tasks-sync.js pull --spec <n>` (generated, uncommitted `TASKS.md`; never hand-edited) | ticket sub-issues of the spec issue, `spec.md`, acceptance tests, hidden tests, browser journey tests (`journeys/`, from `harness/templates/journeys.test.js`), `verify.config.json` with the chosen `adapter`, `holdout` and `journeys` | acceptance tests exist, fail for the right reason (RED), written by an agent other than the builder; the author of the visible and the hidden tests has run every file (see Test author rules) |
| 5 | `build` | `tdd-guide` / `gan-generator` under `/harness-build` | code, unit tests | `verify.js` exits 0 (tests, type check, coverage, test quality, holdout, browser journeys, mutation) |
| 6 | `review` | `code-reviewer`, `security-reviewer`, `a11y-architect`, `performance-optimizer` in parallel, foreground | `reviews.md`, containing the line `Open: CRITICAL 0, HIGH 0` with the true counts after the fix round | no CRITICAL or HIGH open; MEDIUM fixed or logged with a reason; every reviewer is given `ux.md` as a hard requirement list, and a finding that contradicts it is escalated, not applied |
| 7 | `qa` | `e2e-runner` (Playwright) or `gan-evaluator` | `qa.md`, screenshots | an agent that did not write the journey tests walks the product as a first-time user and records what the scripted journeys miss; defects go back to phase 5 |
| 8 | `release` | `doc-updater` | README with run steps, `CHANGELOG` entry | someone with only the README can run it |
| gate | `accepted` | the owner | label `accepted` on the spec issue | the owner accepts the released result against the spec issue; until then `pipeline.js` reports `waiting` |
| 9 | `retro` | `harness-improver` + the KPI roll-up | `retro.md` | one evidence-backed change proposed; KPI file refreshed |

All phases and both owner gates run inside the one harness run. The product gate is re-run on every check from phase 5 on, so a review fix that breaks a test or a journey sends the pipeline back to phase 5 by itself. A failing phase 6 or 7 goes back to 5 with the finding as the task. Cap the loop at 3 round trips, then halt and report.

## Test author rules (phase 4)

Wrong hidden tests failed the gate in two runs because their author never ran them. Before any builder starts, the test author must:

- **Run every visible and hidden test file once** and paste the summary line into `decisions.md`. Each test must fail because the behaviour is missing (404, missing export, wrong value), never because the test itself is broken (syntax error, bad import path, malformed URL, wrong port). Fix a broken test before handing over.
- **Cite the source of every expected value in a hidden test**: a comment with the line of `spec.md` or `design.md` it comes from. A value with no line to cite is a guess; remove the test or get the rule written into the spec first.
- **Check the two suites against each other**: no hidden test may contradict a visible one on the same input.

When the gate reports a holdout failure while the visible tests pass, do not send it straight to the builder. The test author (not the builder, who must not see the holdout) first checks each failing hidden test against its cited line, fixes any that are wrong, logs that in `decisions.md`, and only then passes "N hidden tests still fail" to the builder.

## Right-sizing

Small fixes and single-file changes do not need phases 1-4: give the fix to `tdd-guide` under `/harness-build`. Run this skill for a new product or a feature with a user-facing surface. A change that touches a screen always runs 2 and 7.

## Change requests

Once the owner has added `accepted` to the first run's spec issue, a change to the product is a **change run** on its own spec issue (spec #88). Write the change's spec issue in `<product-repo>`, then start the harness with `--change <N>` (the issue number) added to the first run's verify command:

`node .claude/harness/bin/harness.js init --verify 'node .claude/harness/bin/pipeline.js check --product <product-repo> --docs <product-repo>/docs/product/<slug> --change <N>' --task "<the change, verbatim>" --open-gate-files --no-commit-gate --max 30 --stall 4`

- The walk is `spec`, gate `spec-approved` on issue #N, `plan`, `build`, `review`, `qa`, `release`, gate `accepted` on issue #N. The gates, waiting, layer verdicts, redirects, the 3-round limit and approvals tied to files work as in a first run, on issue #N. A redirect on problem, impression or approach goes back to the change's `spec`; correctness or craft to `build`.
- The change's records go in `<product-repo>/docs/product/<slug>/changes/<N>/`: `decisions.md` (its decisions and its `AMEND:` lines), `TASKS.md` (`tasks-sync pull --spec <N> --out <that folder>/TASKS.md`), `reviews.md` with the `Open: CRITICAL 0, HIGH 0` line, `qa.md`, and any other file there is the change's spec output, approved at `spec-approved` (write a redone spec there after a redirect). Release: the product README still has run steps and its `CHANGELOG.md` names `#N`.
- The product's frozen files (`spec.md`, `acceptance/`, `holdout/`, `ux.md`, `verify.config.json`, the adapter's tool configs) are frozen from the change's first check: each change needs an `AMEND: <path> - <reason>` line in the change's `decisions.md`, never in the first run's.
- The first run's records and its state in `.harness/pipeline/` are only read, never written; the change keeps its own (`<slug>.change-<N>.*`). `pipeline.js` refuses to start a change run (exit 2) while the first run is not accepted, or when `<N>` is the first run's spec issue.

## Effort (measured defaults, sonnet, one product)

From the per-phase comparison on the retro board (`docs/testbench/retro-board/effort-by-phase.md`, 24 cells of 1 to 2 trials, objective graders):

| Phase | Default | Why |
|---|---|---|
| discover, ux, design, release | `low` | All levels passed; `high` cost 1.4x to 2.0x for no measured gain |
| review, qa | `low` | All levels passed the seeded-defect graders; `high` cost 1.5x. Use `high` for auth, input, files and money on judgment: the data does not show it helps |
| tests (test owner) | `medium` | `low` passed 1 of 2; `high` cost 2x `medium` with the same pass |
| build | `low` or `medium`, with the full gate including the hidden holdout | `high` failed the gate 2 of 2: in the one run diagnosed, it missed a rule from the design that no visible test covered (control characters in card text) |

Read this carefully: most graders check coverage by keyword, so "all passed" means the checklist was met, not that the work was equal. Trials are few. Re-run `testbench/retro-board/tune/run.js` on a second product (built in its own repository, like any new product) before treating any row as settled, and keep a hidden holdout in the build gate: it was the only check that told the effort levels apart on quality.

## Limits and resuming

When a usage limit stops an agent, write the state to `<product-repo>/docs/product/<slug>/status.md` (phase, what is done, what is next), schedule a resume with `send_later` at the reset time, and continue with `SendMessage` to the stopped agent. Do not wait for a human to say "try again".

## KPI proof

After phase 9, run `node .claude/harness/bin/agents-kpi.js --out kpi.json`. It reports per agent, per phase and per model/effort: runs, failures, outcome-not-reported, tokens, time; plus human prompts and interventions. A run is credible only if the KPI file shows foreground, tagged, effort-stamped runs and zero interventions after the first prompt (answers to the two owner gates are counted as gate responses, not interventions).
