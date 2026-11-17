# Harness: unattended build loop

A small, dependency-free guardrail layer for running agents to completion without a human in the loop.
The agent decides *how*; the harness decides *when it is done* and *what it may never do*.

| Piece | File | What it enforces |
|---|---|---|
| Definition of done | `hooks/stop.js` + `lib/stop-loop.js` | Agent cannot stop until the verify command exits 0. Re-runs it on every stop attempt and feeds failures back. |
| Iteration cap | `lib/stop-loop.js` | Halts after `--max` iterations. |
| Circuit breaker | `lib/stop-loop.js` | Halts when the same failure (numbers stripped) repeats `--stall` times. |
| Commit gate | `hooks/pre-bash.js` | `git commit` is refused while verify fails (`--no-commit-gate` allows checkpoint commits). |
| Dangerous commands | `lib/guards.js` | Force/mirror push, push to main/master (including a bare `git push` while on main), `rm -rf /`, `curl \| sh`, `--no-verify`, `reset --hard`, reading/staging `.env`/keys. `lib/shell.js` understands quotes, env prefixes, wrappers, `git -C`, subshells, `$(...)`, `bash -c` and heredocs. |
| Secret scan | `hooks/pre-write.js` | Blocks writes containing high-confidence secrets. |
| Self-protection | `lib/guards.js` | While a run is active, settings, harness files, `.harness/` and `--protect` paths are read-only, and the agent cannot run `harness off/init`. |

Everything except the secret scan and dangerous-command blocklist is inert unless `.harness/state.json` says a run is active.

## Use
```bash
node .claude/harness/bin/harness.js init --verify "npm test" --task-file spec.md --protect acceptance/ --max 15
# ... agent works; Stop hook loops it until green or halted ...
node .claude/harness/bin/harness.js status
node .claude/harness/bin/harness.js off      # human escape hatch
```
Or `/harness-build <spec> --verify "<cmd>"`. Start Claude with `--permission-mode auto` (or `acceptEdits` + the allow list
in `.claude/settings.json`), never `--dangerously-skip-permissions`.

## Test
```bash
node --test .claude/harness/test/*.test.js
```

## Known limits (be honest about these)
- **Verify is only as strong as your tests.** A weak verify command means "done" is cheap. In a live run the agent added a placeholder `tests/smoke.test.js` that asserts `true`, and the 80% coverage floor still passed (coverage was measured over test files; I did not find a flag that attributes the child-process server's coverage to `src/`). Treat a coverage number as advisory. Better gates: acceptance tests written from the spec and protected with `--protect`, a verify script that fails when `tests/` contains no assertion about `src/` modules, or mutation testing.
- **Shell guards are heuristic.** `lib/shell.js` is a best-effort parser, not a shell: variable indirection (`X=main; git push origin $X`), decoded payloads, and scripts written then executed get through. Pair with isolation (container/worktree, no prod credentials, network allowlist) and server-side branch protection + required CI.
- **Known gaps found by review and left open** (documented, not fixed): implicit staging of `.env` via `git add -A`/`commit -a`; `git apply`/`patch`/`tar -C`/`unzip -d`/`find -exec` writes into protected paths; `>|` redirects; `git clean -fdx`, `git branch -D main`; hook-bypass equivalents (`core.hooksPath`, `HUSKY=0`); killing the verifier with `pkill`. A read-only `node -e` that merely mentions a protected path is blocked (false positive, by design). `--force-with-lease` is blocked even on feature branches.
- **Hooks fail open** on internal crashes (exit 1) so a bug cannot brick a session, but a *corrupt state file* keeps guards on and refuses commits.
- **Every Stop attempt costs an iteration**, including when the agent stops to ask a human a question; with no human that is wasted budget, so tell the agent not to ask.
- **No cost cap yet.** Bound spend with the iteration cap and your account/session limits.
- **No evaluator-score gate yet.** `gan-evaluator` feedback is advisory; only the verify command is enforced.
