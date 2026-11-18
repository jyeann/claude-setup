# Harness: unattended build loop

A small, dependency-free guardrail layer for running agents to completion without a human in the loop.
The agent decides *how*; the harness decides *when it is done* and *what it may never do*.

| Piece | File | What it enforces |
|---|---|---|
| Definition of done | `hooks/stop.js` + `lib/stop-loop.js` | Agent cannot stop until the verify command exits 0. Re-runs it on every stop attempt and feeds failures back. |
| Iteration cap | `lib/stop-loop.js` | Halts after `--max` iterations. |
| Circuit breaker | `lib/stop-loop.js` | Halts when the same failure (numbers stripped) repeats `--stall` times. |
| Commit gate | `hooks/pre-bash.js` | `git commit` is refused while verify fails (`--no-commit-gate` allows checkpoint commits). |
| WIP checkpoint | `lib/checkpoint.js` + `hooks/stop.js` | Every Stop attempt snapshots the worktree to `refs/harness/wip/<branch>` via a throwaway index: the branch, index and worktree are untouched, so the commit gate still holds. Skips `.harness/`, `.env*`, `*.pem`, `*.key`, `*.p12`. `--no-checkpoint` disables it; `--checkpoint-push` also pushes that one ref to `origin` so it survives losing the sandbox. |
| Stuck diagnosis | `lib/failure-cluster.js` + `hooks/stop.js` | At the iteration cap or a stall the agent gets ONE bounded turn (no fixing) to classify the remaining failures, grouped by error, as `IMPL_BUG`, `TEST_AMBIGUOUS`, `TEST_WRONG` or `ENV` in `HARNESS-DIAGNOSIS.md`, then the run halts. A stuck loop is usually a broken eval. `--no-diagnosis` halts immediately. |
| Hidden holdout | `lib/strong-verify.js` + `hooks/pre-read.js` | Acceptance tests the agent never sees (see below). |
| Strong verify | `bin/verify.js` + `lib/strong-verify.js` | A stricter done-gate than "tests exit 0" (see below). Use it as the `--verify` command. |
| CI + branch protection | `ci/` (`README.md`) | Server-side backstop: required PR + checks, protected-files check, secret scan, ruleset script. |
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
node .claude/harness/bin/harness.js restore  # after a crash: put the last checkpoint's files back (fetches from origin if needed)
```
Or `/harness-build <spec> --verify "<cmd>"`. Start Claude with `--permission-mode auto` (or `acceptEdits` + the allow list
in `.claude/settings.json`), never `--dangerously-skip-permissions`.

## Strong verify (`bin/verify.js`)
`--verify "node .claude/harness/bin/verify.js"` with a `verify.config.json` (see `examples/todo-api/`). Five checks, in order:
1. **Tests**: exit 0, none skipped or todo, at least `minTests` ran. Then **replicates** (`replicates`, default 2): the same command runs again and must give the same pass/fail counts, otherwise the gate is noise and is rejected as flaky. `--fast` skips the extra runs.
2. **Source coverage**: line coverage of `srcDirs` only, from raw V8 coverage across *all* processes (so a server spawned by an acceptance test counts). Total and per-file floors.
3. **Test quality**: each test file in `testQuality.dirs` must reference `src/`, contain at least N real assertions, and no tautologies (`assert.ok(true)`) or skips. This is what rejects a placeholder `smoke.test.js`.
4. **Holdout** (optional, `"holdout": {"command": "node --test \"/abs/holdout/*.test.js\"", "minTests": 1}`): hidden acceptance tests run only here, only after checks 1-3 pass. The agent is told just `holdout: K of N hidden acceptance test(s) fail`: no names, paths or expected values. An empty or deleted holdout fails. `--fast` skips it.
5. **Mutation spot-check**: flips one operator (`===`/`!==`, `&&`/`||`, `>=`/`>`, `true`/`false`) in a copy of `src/` for a seeded sample of mutants; the suite must fail on at least `minKillRate` of them. Survivors are printed as `file:line op -> op`, which is concrete feedback for the agent. A mutant that hangs the suite counts as killed; the timeout is 3x the healthy run time (floor 10 s).

`--fast` skips replicates, holdout and mutation for quick iteration; the full run is the definition of done. Protect `verify.config.json` and `acceptance/` with `--protect`; the script itself is already read-only under `.claude/`.

Requirements and limits: Node/`node:test` projects (JS only; the mutation run copies `srcDirs`, the test dirs and `mutation.copy` to a temp dir, first proves that copy passes its own tests, and never touches your real files); a child process that is killed by a signal writes no coverage, so servers must handle `SIGTERM` and exit 0 (the gate says so when a file shows 0%); the mutation operator set is small and equivalent mutants make 100% unrealistic, hence a 60% default floor; the sample changes with the source (seeded from it) so the agent cannot memorise it. Not covered: logic placed outside `srcDirs`, TypeScript, and deleting a source file (set `coverage.minSourceFiles`; the git-tracked list is not consulted).

## Holdout set (`--hide`)
```bash
node .claude/harness/bin/harness.js init --verify "node .claude/harness/bin/verify.js" --hide /abs/path/holdout --protect acceptance/
```
The human writes extra acceptance tests from the spec and keeps them **outside the project tree** (recommended). `--hide` makes the harness refuse, while a run is active, the Read/Grep/Glob tools and any shell command that names those paths (`hooks/pre-read.js`, `lib/guards.js`). A hidden path inside the project is also made read-only, but a repo-wide Grep can still surface its lines, so keep it outside. This is the analogue of a train/test split: the agent iterates against the visible acceptance tests and is graded once on cases it has not seen.

## Test
```bash
node --test .claude/harness/test/*.test.js
```

## Known limits (be honest about these)
- **Verify is only as strong as your tests.** With a plain `npm test` verify, an agent can pad with a placeholder test (seen live: `tests/smoke.test.js` asserting `true` passed an 80% coverage floor measured over test files). The strong verify closes that gap for Node projects; for other stacks write an equivalent gate. Acceptance tests written from the spec and protected with `--protect` remain the most important defence.
- **Shell guards are heuristic.** `lib/shell.js` is a best-effort parser, not a shell: variable indirection (`X=main; git push origin $X`), decoded payloads, and scripts written then executed get through. Pair with isolation (container/worktree, no prod credentials, network allowlist) and server-side branch protection + required CI.
- **Known gaps found by review and left open** (documented, not fixed): implicit staging of `.env` via `git add -A`/`commit -a`; `git apply`/`patch`/`tar -C`/`unzip -d`/`find -exec` writes into protected paths; `>|` redirects; `git clean -fdx`, `git branch -D main`; hook-bypass equivalents (`core.hooksPath`, `HUSKY=0`); killing the verifier with `pkill`. A read-only `node -e` that merely mentions a protected path is blocked (false positive, by design). `--force-with-lease` is blocked even on feature branches.
- **Hiding is heuristic.** The agent can still find a hidden path by guessing at it from the shell in ways the parser cannot see (see the shell-guard limit above). Isolation is the real answer; hiding raises the cost of overfitting, it does not make it impossible.
- **Replicates add test-suite time** (default 2 runs per Stop attempt). Set `replicates: 1` for very slow suites.
- **Diagnosis relies on `node:test` output** for grouping (spec or TAP reporter); other output falls back to the raw tail.
- **Hooks fail open** on internal crashes (exit 1) so a bug cannot brick a session, but a *corrupt state file* keeps guards on and refuses commits.
- **Checkpoints are local unless `--checkpoint-push`.** A local ref survives a crashed agent or lost context, not a lost container. `restore` copies files back but does not delete files created after the checkpoint. Gitignored files are not captured.
- **The Stop feedback sends the full spec once** (first block); later blocks carry only a pointer plus the verify-output tail, so context does not grow by one spec copy per iteration.
- **Every Stop attempt costs an iteration**, including when the agent stops to ask a human a question; with no human that is wasted budget, so tell the agent not to ask.
- **No cost cap yet.** Bound spend with the iteration cap and your account/session limits.
- **No evaluator-score gate yet.** `gan-evaluator` feedback is advisory; only the verify command is enforced.
