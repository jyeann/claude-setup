# Definition of done for the agent process and its testing

Decision made by the orchestrating agent on 2026-11-18, without waiting for a human, as asked. It is written down so it can be checked and overturned.

## Decision
The testing and the product-team process are **complete for this scope**: small, dependency-free web products built by one orchestrator with sonnet, with the owner asked only at the end (final acceptance). They stay complete as long as every condition below holds. No further validation run is needed to call them complete; the triggers further down say when to reopen.

| # | Condition | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Every product's full verify gate (tests, coverage, test quality, **hidden holdout**, mutation) runs on every pull request | Done in `.github/workflows/ci.yml` (`gate-retro-board`; `gate-link-shortener` also ran until its product was removed on 2026-11-24, last at `bfad3bb`) | The holdout is in the repo (`testbench/retro-board/holdout/`), the command is `node --test "${HARNESS_HIDDEN_DIR:-holdout}/*.test.js"`, no machine-specific path remains |
| 2 | The evaluation graders still accept the golden artifacts and reject degraded ones | Done (`eval-kit-selftest`) | `testbench/retro-board/tune/selftest.js` |
| 3 | The harness's own tests keep a 90% line floor | Done (`harness-tests`) | 275 tests, 99.5% |
| 4 | These checks are **required**, not advisory | Done: the repository owner applied the `protect-main` ruleset with admin rights on 2026-11-18 | `.claude/harness/ci/ruleset.json` lists the required checks (five on 2026-11-18; four since `gate-link-shortener` was removed on 2026-11-24), pinned to the GitHub Actions app. With the default ruleset an admin can bypass through a pull request, and the GitHub connection used by the agent is signed in as the owner, so it is applied with `--no-bypass`: `bash .claude/harness/ci/protect.sh --repo jyeann/claude-setup --apply --no-bypass`. The human override is then to switch the ruleset off in Settings. The first PR through the ruleset is the one that made this edit |
| 5 | The process ran end to end from a one-line idea with no human prompt after the first | Done once (retro-board) | `docs/testbench/retro-board/retro.md`; the first product (link-shortener) had 5 interventions, which are listed and fixed in its retro, removed on 2026-11-24 and kept in history: `git show bfad3bb:docs/product/link-shortener/retro.md` |
| 6 | Agent work is observable | Done | `agents-kpi.js` roll-up: per agent, phase, model and effort, with outcome-not-reported and completion-notice figures; human prompts classified |

**Required since 2026-11-18:** nothing reaches `main` except through a pull request whose required checks pass and whose branch is up to date. Read the diff of `.github/` and `.claude/` before merging, because a PR can change the workflow that judges it. If `eval-kit-selftest` fails for no clear reason, re-run it: it installs a browser from the network.

**CI proof:** a manual run of the new workflow on the branch (run 13, commit `b23d6ce`) passed all five jobs on GitHub runners: `gate-link-shortener` (since removed), `gate-retro-board` (both include the hidden holdout and the mutation check), `eval-kit-selftest` (installs Playwright and Chromium, then all 8 graders accept golden and reject degraded), `harness-tests` and `secret-scan`. The same gates also pass from a clean extraction of the commit with no files from the authoring session.

## What the evidence supports, and what it does not
- **Supports:** 13 delegated agent runs produced a product that passes 149 tests, a 14-test hidden holdout, a mutation check and an independent 15-check browser walkthrough. An independent test owner wrote the tests before any code. Reviews found real defects that were fixed. A per-phase comparison (24 cells) gave measured effort defaults.
- **Does not support:** anything about other models, larger codebases, or products that handle money, logins or personal data. One product went through the whole process. Effort results are 1 to 2 trials per cell and most graders check coverage by keyword. High-effort build failed the holdout twice, one diagnosed.
- **Confidence:** moderate inside the scope above, low outside it.

## Update, 2026-11-20: the decision is reopened
Reopen triggers 2 and 5 fired: `orch-product-team` and the gate changed (whole-pipeline stop gate, browser journeys and a type check inside `verify.js`, TypeScript support), and more products went through the process (`packing-list`, see `git show bfad3bb:docs/product/packing-list/retro.md`; `wiki`, see `git show bfad3bb:docs/product/wiki/`; both products and their records were removed on 2026-11-24 and are kept in git history). The table above describes the state on 2026-11-18 and its counts are out of date (the harness suite is now 325 tests).

What the packing-list run added:
- **Held:** one idea to a working product with no human prompt; product gate green (175 tests, hidden 25/25, browser journeys 25/25, mutation 8/8); independent QA found a real defect the gate's tests missed, and it was fixed.
- **Did not hold (condition 5):** the account usage limit stopped the run for 5.8 hours and it did not resume itself.
- **Did not hold (condition 6):** half the delegated agents were moved to the background after 120 seconds and their cost was not recorded; the KPI figures were completed by hand.
- **New, open:** the pipeline's document checks pass on filler text, so only the build phase is a real gate; the stop gate was never exercised because the agent never tried to stop; journey tests are not in the frozen set; two guard-hook crashes failed open. `packing-list` and `wiki` are not gated in CI.

Until those are fixed and one run passes without them, treat the process as: **builds a working small product unattended, with cost reporting and resume after a usage limit not yet reliable.**

## Update, 2026-11-24: the scope changed (spec #19, spec #27)
Reopen trigger 2 fired again: agent definitions and `orch-product-team` changed. Every agent now sets `model:` and `effort:` by task class, a `spec-reviewer` agent was added, tickets are now GitHub issues made with `to-tickets`, with a generated task list (#20 to #23, #41), and the run has **two owner gates**, `spec-approved` after the spec and `accepted` after release, with a `waiting` state the KPI counts as gate responses, not interventions (#24). Spec #27 changed where products live: new products are built in their own repository, and `retro-board` is the test bench in `testbench/retro-board/` (#28 to #32).

So the scope of the decision above no longer matches the process: it was small products built in this repository with the owner asked once, at the end; it is now small products built in their own repository with two owner gates, by agents whose definitions changed.

- **Owed, not run:** the per-phase re-measurement that trigger 2 asks for (`testbench/retro-board/tune/run.js`, about $20 and about 2.5 hours). It is waiting for the owner's approval; spec #19 kept it out of scope. Until it runs, the effort defaults in `orch-product-team` are carried over from the old agent definitions, not measured on the new ones.
- **Planned evidence:** the first full run under the new process is issue #37, an expense splitter built in its own repository with both owner gates. Its KPI (cost, tokens and time per phase, interventions after the first prompt) will show whether the conditions above still hold.

Until both are in, treat the process as described in the 2026-11-20 update, with the two owner gates in place but not yet exercised by a full run.

## Reopen the decision when any of these happens
1. A required check fails on `main`.
2. The model, an agent definition, or `orch-product-team` changes: re-run the per-phase comparison (`node testbench/retro-board/tune/run.js --phases discover,ux,design,tests,build,review,qa,release --levels low,medium,high`, about $20 and 2.5 hours; the self-test in CI is the cheap check in between).
3. A run needs a human prompt after the first that is not a gate response (the KPI view counts interventions).
4. The process is used on a product that handles money, logins or personal data.
5. A second full run of the process on a different product fails any condition above.

## How holdouts work now
Holdouts live in the product's tree (`<product>/holdout/`; here `testbench/retro-board/holdout/`) so a fresh checkout, CI and any new session can run them. While a harness run is active they are hidden from the agent: start the run with `--hide <product>/holdout`. Outside a run they are readable, which is weaker secrecy than the out-of-tree layout the harness README recommends; CI runs them regardless of that. To keep them out of the tree, set `HARNESS_HIDDEN_DIR` to a directory elsewhere and the same command uses it.
