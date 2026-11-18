# Harness: unattended build loop

A small, dependency-free guardrail layer for running agents to completion without a human in the loop.
The agent decides *how*; the harness decides *when it is done* and *what it may never do*.

| Piece | File | What it enforces |
|---|---|---|
| Definition of done | `hooks/stop.js` + `lib/stop-loop.js` | Agent cannot stop until the verify command exits 0. Re-runs it on every stop attempt and feeds failures back. |
| Iteration cap | `lib/stop-loop.js` | Halts after `--max` iterations. |
| Circuit breaker | `lib/stop-loop.js` | Halts when the same failure (numbers stripped) repeats `--stall` times. |
| Commit gate | `hooks/pre-bash.js` | `git commit` is refused while verify fails (`--no-commit-gate` allows checkpoint commits). |
| Strong verify | `bin/verify.js` + `lib/strong-verify.js` | A stricter done-gate than "tests exit 0" (see below). Use it as the `--verify` command. |
| CI + branch protection | `ci/` (`README.md`) | Server-side backstop: required PR + checks, protected-files check, secret scan, ruleset script. |
| Dangerous commands | `lib/guards.js` | Force/mirror push, push to main/master (including a bare `git push` while on main), `rm -rf /`, `curl \| sh`, `--no-verify`, `reset --hard`, reading/staging `.env`/keys. `lib/shell.js` understands quotes, env prefixes, wrappers, `git -C`, subshells, `$(...)`, `bash -c` and heredocs. |
| Secret scan | `hooks/pre-write.js` | Blocks writes containing high-confidence secrets. |
| Self-protection | `lib/guards.js` | While a run is active, settings, harness files, `.harness/` and `--protect` paths are read-only, and the agent cannot run `harness off/init`. |

| Session trace | `hooks/post-tool.js` + `lib/trace.js` | Records every tool call (ok or failed), guard block and stop to `.harness/traces/<session>.jsonl`. Redacted, truncated summaries only; never blocks. |
| Scorers | `lib/score.js` | `efficiency` (failed or repeated tool calls), `verified-before-done` (a passing check after the last code edit), `guardrail-attempts`. |
| Report + markers | `bin/report.js` + `lib/report.js` | Pass rates, last-10 vs previous-10 trend, most common failures, and before/after rates around changes you `--mark`. |
| Improver | `agents/harness-improver.md`, `/harness-improve` | Read-only agent proposes ONE change from the evidence; a human merges it. |

| Reference check | `bin/check-refs.js` + `lib/refs.js` | Fails on commands, agents, skills or rules that point at a script, skill, rules dir, agent or removed command that does not exist. Runs in CI via the test suite, so an upstream sync that re-adds a broken item is caught. |

Everything except the secret scan, the dangerous-command blocklist and tracing is inert unless `.harness/state.json` says a run is active.

## Learning loop (record, score, propose, measure)
```bash
node .claude/harness/bin/report.js            # what keeps going wrong
/harness-improve                              # read-only agent proposes one fix, you review and merge
node .claude/harness/bin/report.js --mark "merged port-discovery skill"   # later reports show before/after
```
Traces live in `.harness/` (gitignored, local to the machine). In an ephemeral cloud container they vanish with it:
copy `.harness/traces/` somewhere durable (artifact store, bucket) before the container is reclaimed, or run the report in the same session.
The scorers are deterministic and cheap. Subjective rubrics (verbosity, redundant tests) need an LLM judge reading the same traces; not built yet.
The improver is untrusted-input aware: traces are data, and it may not propose widening permissions or touching hooks, deny rules, harness code or CI.

## Use
```bash
node .claude/harness/bin/harness.js init --verify "npm test" --task-file spec.md --protect acceptance/ --max 15
# ... agent works; Stop hook loops it until green or halted ...
node .claude/harness/bin/harness.js status
node .claude/harness/bin/harness.js off      # human escape hatch
```
Or `/harness-build <spec> --verify "<cmd>"`. Start Claude with `--permission-mode auto` (or `acceptEdits` + the allow list
in `.claude/settings.json`), never `--dangerously-skip-permissions`.

## Strong verify (`bin/verify.js`)
`--verify "node .claude/harness/bin/verify.js"` with a `verify.config.json` (see `examples/todo-api/`). Four checks, in order:
1. **Tests**: exit 0, none skipped or todo, at least `minTests` ran.
2. **Source coverage**: line coverage of `srcDirs` only, from raw V8 coverage across *all* processes (so a server spawned by an acceptance test counts). Total and per-file floors.
3. **Test quality**: each test file in `testQuality.dirs` must reference `src/`, contain at least N real assertions, and no tautologies (`assert.ok(true)`) or skips. This is what rejects a placeholder `smoke.test.js`.
4. **Mutation spot-check**: flips one operator (`===`/`!==`, `&&`/`||`, `>=`/`>`, `true`/`false`) in a copy of `src/` for a seeded sample of mutants; the suite must fail on at least `minKillRate` of them. Survivors are printed as `file:line op -> op`, which is concrete feedback for the agent. A mutant that hangs the suite counts as killed; the timeout is 3x the healthy run time (floor 10 s).

`--fast` skips mutation for quick iteration; the full run is the definition of done. Protect `verify.config.json` and `acceptance/` with `--protect`; the script itself is already read-only under `.claude/`.

Requirements and limits: Node/`node:test` projects (JS only; the mutation run copies `srcDirs`, the test dirs and `mutation.copy` to a temp dir, first proves that copy passes its own tests, and never touches your real files); a child process that is killed by a signal writes no coverage, so servers must handle `SIGTERM` and exit 0 (the gate says so when a file shows 0%); the mutation operator set is small and equivalent mutants make 100% unrealistic, hence a 60% default floor; the sample changes with the source (seeded from it) so the agent cannot memorise it. Not covered: logic placed outside `srcDirs`, TypeScript, and deleting a source file (set `coverage.minSourceFiles`; the git-tracked list is not consulted).

## Test
```bash
node --test .claude/harness/test/*.test.js
```

## Known limits (be honest about these)
- **Verify is only as strong as your tests.** With a plain `npm test` verify, an agent can pad with a placeholder test (seen live: `tests/smoke.test.js` asserting `true` passed an 80% coverage floor measured over test files). The strong verify closes that gap for Node projects; for other stacks write an equivalent gate. Acceptance tests written from the spec and protected with `--protect` remain the most important defence.
- **Shell guards are heuristic.** `lib/shell.js` is a best-effort parser, not a shell: variable indirection (`X=main; git push origin $X`), decoded payloads, and scripts written then executed get through. Pair with isolation (container/worktree, no prod credentials, network allowlist) and server-side branch protection + required CI.
- **Known gaps found by review and left open** (documented, not fixed): `git apply`/`patch`/`tar -C`/`unzip -d`/`find -exec` writes into protected paths; a read-only `node -e` that merely mentions a protected path is blocked (false positive, by design); `--force-with-lease` is blocked even on feature branches. Closed in this round: bulk staging of `.env` (`git add -A`, `commit -a`), `git clean`, deleting or moving `main`, `core.hooksPath` and `HUSKY=0`, `pkill`/`killall`, `>|` redirects. Bulk-staging detection runs `git status`, so a secret that is gitignored is correctly not flagged.
- **Allow list no longer has `Bash(node:*)`.** It let any `node -e` script bypass the shell guards. Only `node --test` and the harness `report.js` / `verify.js` are pre-approved; anything else asks.
- **Hooks fail open** on internal crashes (exit 1) so a bug cannot brick a session (each crash is now written to `.harness/hook-errors.jsonl` and shown in the report), but a *corrupt state file* keeps guards on and refuses commits.
- **Every Stop attempt costs an iteration**, including when the agent stops to ask a human a question; with no human that is wasted budget, so tell the agent not to ask.
- **No cost cap yet.** Bound spend with the iteration cap and your account/session limits.
- **No evaluator-score gate yet.** `gan-evaluator` feedback is advisory; only the verify command is enforced.
