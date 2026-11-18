# Definition of done for the agent process and its testing

Decision made by the orchestrating agent on 2026-11-18, without waiting for a human, as asked. It is written down so it can be checked and overturned.

## Decision
The testing and the product-team process are **complete for this scope**: small, dependency-free web products built by one orchestrator with sonnet, one human gate at the end. They stay complete as long as every condition below holds. No further validation run is needed to call them complete; the triggers further down say when to reopen.

| # | Condition | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Every product's full verify gate (tests, coverage, test quality, **hidden holdout**, mutation) runs on every pull request | Done in `.github/workflows/ci.yml` (`gate-link-shortener`, `gate-retro-board`) | The holdouts are in the repo (`examples/*/holdout/`), the command is `node --test "${HARNESS_HIDDEN_DIR:-holdout}/*.test.js"`, no machine-specific path remains |
| 2 | The evaluation graders still accept the golden artifacts and reject degraded ones | Done (`eval-kit-selftest`) | `examples/retro-board/tune/selftest.js` |
| 3 | The harness's own tests keep a 90% line floor | Done (`harness-tests`) | 275 tests, 99.5% |
| 4 | These checks are **required**, not advisory | Done: the repository owner applied the `protect-main` ruleset with admin rights on 2026-11-18 | `.claude/harness/ci/ruleset.json` lists all five required checks, pinned to the GitHub Actions app. Admins can bypass only through a pull request. The first PR through the ruleset is the one that made this edit |
| 5 | The process ran end to end from a one-line idea with no human prompt after the first | Done once (retro-board) | `docs/product/retro-board/retro.md`; the first product (link-shortener) had 5 interventions, which are listed and fixed |
| 6 | Agent work is observable | Done | `agents-kpi.js` roll-up: per agent, phase, model and effort, with outcome-not-reported and completion-notice figures; human prompts classified |

**Required since 2026-11-18:** nothing reaches `main` except through a pull request whose five checks pass and whose branch is up to date. Read the diff of `.github/` and `.claude/` before merging, because a PR can change the workflow that judges it. If `eval-kit-selftest` fails for no clear reason, re-run it: it installs a browser from the network.

**CI proof:** a manual run of the new workflow on the branch (run 13, commit `b23d6ce`) passed all five jobs on GitHub runners: `gate-link-shortener`, `gate-retro-board` (both include the hidden holdout and the mutation check), `eval-kit-selftest` (installs Playwright and Chromium, then all 8 graders accept golden and reject degraded), `harness-tests` and `secret-scan`. The same gates also pass from a clean extraction of the commit with no files from the authoring session.

## What the evidence supports, and what it does not
- **Supports:** 13 delegated agent runs produced a product that passes 149 tests, a 14-test hidden holdout, a mutation check and an independent 15-check browser walkthrough. An independent test owner wrote the tests before any code. Reviews found real defects that were fixed. A per-phase comparison (24 cells) gave measured effort defaults.
- **Does not support:** anything about other models, larger codebases, or products that handle money, logins or personal data. One product went through the whole process. Effort results are 1 to 2 trials per cell and most graders check coverage by keyword. High-effort build failed the holdout twice, one diagnosed.
- **Confidence:** moderate inside the scope above, low outside it.

## Reopen the decision when any of these happens
1. A required check fails on `main`.
2. The model, an agent definition, or `orch-product-team` changes: re-run the per-phase comparison (`node examples/retro-board/tune/run.js --phases discover,ux,design,tests,build,review,qa,release --levels low,medium,high`, about $20 and 2.5 hours; the self-test in CI is the cheap check in between).
3. A run needs a human prompt after the first (the KPI view counts them).
4. The process is used on a product that handles money, logins or personal data.
5. A second full run of the process on a different product fails any condition above.

## How holdouts work now
Holdouts live in `examples/<product>/holdout/` so a fresh checkout, CI and any new session can run them. While a harness run is active they are hidden from the agent: start the run with `--hide examples/<product>/holdout`. Outside a run they are readable, which is weaker secrecy than the out-of-tree layout the harness README recommends; CI runs them regardless of that. To keep them out of the tree, set `HARNESS_HIDDEN_DIR` to a directory elsewhere and the same command uses it.
