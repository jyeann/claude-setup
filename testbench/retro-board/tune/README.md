# Effort tuning per phase (retro-board kit)

Compares effort levels for each phase of the product-team process, using the finished retro board as the golden
reference. Node only, no dependencies. A trial is `claude -p` in a throwaway worktree of a base repo; a node script
grades the result (exit 0 = acceptable). No LLM judging.

```sh
node tune/selftest.js                     # prove every grader accepts the golden and rejects degraded input (no claude)
node tune/run.js --phases discover,ux --levels low,medium,high --trials 2 \
  --model claude-sonnet-5-5 --out report.json       # COSTS TOKENS; add --dry-run to only print the commands
node tune/make-bases.js /tmp/bases        # just build the per-phase base repos
```

`run.js` builds each base in a temp dir, runs `.claude/harness/bin/tune.js` there (`CLAUDE_PROJECT_DIR=<base>`,
`--task-file TASK.md`, `--verify "node <abs>/graders/<phase>.js"`, 20 min agent timeout), runs phases one after
another, keeps going when one fails, and rewrites `report.json` after every phase:
`{phases:[{phase, results:[{model,effort,passRate,trials,meanCostUsd,meanSeconds,meanOutputTokens,meanTurns}]}]}`.
Set `HARNESS_DIR` if the harness is not at `../../../.claude/harness`.

| Phase | Agent input | Agent output | Grader checks |
|---|---|---|---|
| discover | repo, one-line idea | `docs/testbench/retro-board/brief.md` | 7 headings, 3+ https sources, decision word, 10+ criteria of 8+ words covering 6 of 8 concepts, open questions with defaults |
| ux | brief | `ux.md` | 10+ journeys, 6 screen states, 390 and 1100 px, 15+ UI checks with "expect", a11y terms |
| design | brief, ux | `design.md` | 8+ numbered sections, 85% of the golden HTTP routes, 5 of 6 security/consistency concerns |
| tests | brief, ux, design | `spec.md`, `acceptance/` | 25+ tests, 95% pass on the golden code, fail on 3+ of 7 broken copies of it |
| build | RED repo (spec, acceptance, config) | `src/`, `public/`, `tests/` | full harness gate incl. hidden holdout and mutation, on a copy with golden acceptance restored |
| review | golden code with 5 seeded defects, spec, design | `review-report.md` | finds 4 of 5 (file + keyword, or a cited line within 8), code untouched |
| qa | app with 3 seeded UI defects, ux | `qa-report.md` | `CHECK n: PASS/FAIL` lines with 10+ PASS, names 2 of 3 defects on `DEFECT`/FAIL lines, code untouched |
| release | code, spec, brief, design, no README | `testbench/retro-board/README.md` | under 120 lines, `npm start`, 4 env vars, both links, test command, no invented `ENV_LIKE` names |

Layout: `prompts/` task text (copied to `<base>/TASK.md`), `graders/`, `golden/` (docs, app, hidden holdout, route list,
hand-written review and QA reference reports), `seeds/seeds.js` (the seeded defects as exact replacements), `lib/`.

Known limits
- The verify command (and so the grader path) is appended to the agent prompt by tune.js, and agents run with
  `--permission-mode auto`, so an agent can read `tune/golden` and the graders if it ignores the prompt. The prompts forbid it; a
  trial that reads them should be discarded. Run trials on a machine where that path is not the working copy if that matters.
- Keyword graders (discover, design, review, qa, release) measure coverage, not quality. `token-compare` is timing-only, so no
  black-box test can see it; the tests grader leaves it out of its broken copies.
- The golden build passes the mutation floor narrowly (5/8 killed, floor 60%): a good build can still fail on that sample.
- `golden/` is a frozen copy of the retro board; update it deliberately if the real product changes.
