# Effort by phase: retro-board (sonnet, low / medium / high)

Run with the kit in `testbench/retro-board/tune/`: one fresh git repo per phase (no history, so the golden answer cannot be read from git), the phase's inputs and task, and an objective grader. 06:53 to 09:20 UTC for the main run, plus two re-runs and one diagnostic build. Raw numbers: `effort-by-phase.json`.

| Phase | Effort | Passed | Mean cost | Mean time |
|---|---|---|---|---|
| discover | low / medium / high | 2/2, 2/2, 2/2 | $0.11 / $0.12 / $0.17 | 36 / 41 / 55 s |
| ux | low / medium / high | 2/2, 2/2, 2/2 | $0.22 / $0.26 / $0.38 | 85 / 107 / 151 s |
| design | low / medium / high | 2/2, 2/2, 2/2 | $0.49 / $0.55 / $0.98 | 191 / 218 / 420 s |
| tests | low / medium / high | **1/2**, 1/1, 1/1 | $0.79 / $0.98 / $1.98 | 259 / 450 / 1,178 s |
| build | low / medium / high | 1/1, 1/1, **0/2** | $0.72 / $1.19 / $1.53 | 213 / 408 / 780 s |
| review | low / medium / high | 1/1, 1/1, 1/1 | $0.28 / $0.32 / $0.47 | 38 / 50 / 92 s |
| qa | low / medium / high | 1/1, 1/1, 1/1 | $0.61 / $0.72 / $0.91 | 571 / 724 / 652 s |
| release | low / medium / high | 2/2, 2/2, 2/2 | $0.20 / $0.19 / $0.29 | 48 / 49 / 67 s |

## What it shows
- In 6 of 8 phases every level passed, so the graders did not tell the levels apart; only cost and time differ, and `high` costs 1.4x to 2.0x `low`.
- **tests:** `low` failed once and passed once (50%); `medium` is the cheapest level that passed every time, and `high` doubles its cost.
- **build:** `high` failed the full gate in both trials, the opposite of what more effort is supposed to buy. I reproduced one `high` build by hand and kept the grader output: 128 of 128 visible tests pass and coverage is 99.4%, but it fails 1 of 14 hidden holdout tests. The missed case: card text containing control characters must be refused with 400; it returned 201. The design stated the rule, no visible test covered it. This is one diagnosed run; the first `high` failure was not diagnosed (the worktree is deleted after grading).
- The earlier link-shortener tune (all levels passed, `medium` cheapest) points the same way.

## What it does not show
- Quality differences inside a pass. Discover, design, review, qa and release graders measure coverage by keyword; a report that mentions "innerHTML" can pass the review grader.
- Anything about other models or other products. 1 to 2 trials per cell; the build `high` result is 2 trials, the diagnosis 1.
- Leak safety: the grader's path appears in each agent's prompt, so an agent could have read the graders or the golden copies despite being told not to. Nothing in the results suggests it, but the trial transcripts were not inspected.
- The build gate's mutation step samples mutants at random; the golden build cleared its floor narrowly (5 of 8) at the start and now clears it at 7 of 8 after two tests were added.

## Defaults (also written into `orch-product-team`)
discover, ux, design, release, review, qa: `low`. tests: `medium`. build: `low` or `medium` with the hidden holdout in the gate. `high` only on judgment, for security-sensitive review.
