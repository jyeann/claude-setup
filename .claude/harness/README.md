# Harness: unattended build loop

A small, dependency-free guardrail layer for running agents to completion without a human in the loop.
The agent decides *how*; the harness decides *when it is done* and *what it may never do*.

| Piece | File | What it enforces |
|---|---|---|
| Definition of done | `hooks/stop.js` + `lib/stop-loop.js` | Agent cannot stop until the verify command exits 0. Re-runs it on every stop attempt and feeds failures back. |
| Iteration cap | `lib/stop-loop.js` | Halts after `--max` iterations. |
| Circuit breaker | `lib/stop-loop.js` | Halts when the same failure (numbers stripped) repeats `--stall` times. |
| Time budget | `lib/stop-loop.js` | `--max-minutes N` halts (`halted-time`) once the run is older than N minutes, checked on each failing Stop attempt. |
| No-progress breaker | `lib/stop-loop.js` | `--no-progress N` halts (`halted-no-progress`) when the number of failing tests has not dropped below its best for N failing iterations. Skipped when failures cannot be counted (non-`node:test` output). |
| Model x effort search | `bin/tune.js` + `lib/tune.js` | Runs the same task per `model:effort` candidate in a throwaway git worktree, grades with the verify command, reports the cheapest that passes (see below). |
| Commit gate | `hooks/pre-bash.js` | `git commit` is refused while verify fails (`--no-commit-gate` allows checkpoint commits). |
| WIP checkpoint | `lib/checkpoint.js` + `hooks/stop.js` | Every Stop attempt snapshots the worktree to `refs/harness/wip/<branch>` via a throwaway index: the branch, index and worktree are untouched, so the commit gate still holds. Skips `.harness/`, `.env*`, `*.pem`, `*.key`, `*.p12`. `--no-checkpoint` disables it; `--checkpoint-push` also pushes that one ref to `origin` so it survives losing the sandbox. |
| Stuck diagnosis | `lib/failure-cluster.js` + `hooks/stop.js` | At the iteration cap or a stall the agent gets ONE bounded turn (no fixing) to classify the remaining failures, grouped by error, as `IMPL_BUG`, `TEST_AMBIGUOUS`, `TEST_WRONG` or `ENV` in `HARNESS-DIAGNOSIS.md`, then the run halts. A stuck loop is usually a broken eval. `--no-diagnosis` halts immediately. |
| Hidden holdout | `lib/strong-verify.js` + `hooks/pre-read.js` | Acceptance tests the agent never sees (see below). |
| Whole-pipeline gate | `bin/pipeline.js` + `lib/pipeline.js` | For `orch-product-team`: done means every phase has its output, both owner gate labels are on the spec issue and the product gate is green (see below). |
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
| Layout check | `bin/check-layout.js` + `lib/layout.js` | Opt-in per repository through `.claude/layout.json`: fails when a forbidden folder exists, a tracked doc cites a forbidden path, or it names a retired skill (`retiredNames`, matched as a whole name, path forms included). Path references written as `git show <rev>:<path>` are history and allowed; retired names have no such exception, only files listed in `retiredNamesSkip`. This repo's policy forbids the old product folders listed there (products are built in their own repository; the test bench is `testbench/`) and the retired task-list skill that `to-tickets` and `tasks-sync` replaced. Runs in CI via the test suite. |

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
node .claude/harness/bin/harness.js restore  # after a crash: put the last checkpoint's files back (fetches from origin if needed)
```
Or `/harness-build <spec> --verify "<cmd>"`. Start Claude with `--permission-mode auto` (or `acceptEdits` + the allow list
in `.claude/settings.json`), never `--dangerously-skip-permissions`.

## Strong verify (`bin/verify.js`)
`--verify "node .claude/harness/bin/verify.js"` with a `verify.config.json` (see [`fixtures/todo-api/`](fixtures/todo-api/) for JavaScript, [`fixtures/slug-ts/`](fixtures/slug-ts/) for TypeScript). Seven checks, in order:
1. **Tests**: exit 0, none skipped or todo, at least `minTests` ran. Then **replicates** (`replicates`, default 2): the same command runs again and must give the same pass/fail counts, otherwise the gate is noise and is rejected as flaky. `--fast` skips the extra runs.
2. **Type check** (optional, TypeScript: `"typecheck": {"command": "npx tsc --noEmit", "timeoutMs": 120000}`): runs after the tests and fails the gate with the tail of the compiler output. Node strips types without checking them, so without this a type error never fails anything. Off when the key is absent. `--fast` still runs it: it is cheap and it is exactly the feedback the agent needs while iterating. The harness never installs or bundles `tsc`; the command is yours.
3. **Source coverage**: line coverage of `srcDirs` only, from raw V8 coverage across *all* processes (so a server spawned by an acceptance test counts). Total and per-file floors. For `.ts` files, lines that hold only types (`interface`, `type`, `import type`) are not counted as executable.
4. **Test quality**: each test file in `testQuality.dirs` must reference `src/`, contain at least N real assertions, and no tautologies (`assert.ok(true)`) or skips. This is what rejects a placeholder `smoke.test.js`. Type arguments and casts (`assert.deepEqual<T>(...)`, `assert.ok(true as boolean)`) are understood.
5. **Holdout** (optional, `"holdout": {"command": "node --test \"/abs/holdout/*.test.js\"", "minTests": 1}`): hidden acceptance tests run only here, only after checks 1-4 pass. The agent is told just `holdout: K of N hidden acceptance test(s) fail`: no names, paths or expected values. An empty or deleted holdout fails. `--fast` skips it.
6. **User journeys** (optional, `"journeys": {"command": "node --test \"journeys/*.test.js\"", "uxFile": "docs/ux.md", "minTests": 1}`): browser tests of the product as a person uses it, run after checks 1-5 pass. They must pass with none skipped, and when `uxFile` is set every journey or UI-check id in it (`J1`, `UC3`) needs a passing test whose name contains that id. Failures are shown in full. Start from `templates/journeys.test.js` (Playwright under `node:test`). The harness does not install a browser, and it cannot tell a real walkthrough from a test that only carries the right name, so an independent QA pass is still worth having. Journey runs do not count toward source coverage. `--fast` skips it.
7. **Mutation spot-check**: flips one operator (`===`/`!==`, `&&`/`||`, `>=`/`>`, `true`/`false`) in a copy of `src/` for a seeded sample of mutants; the suite must fail on at least `minKillRate` of them. Survivors are printed as `file:line op -> op`, which is concrete feedback for the agent. A mutant that hangs the suite counts as killed; the timeout is 3x the healthy run time (floor 10 s).

`--fast` skips replicates, holdout, journeys and mutation for quick iteration (the type check still runs); the full run is the definition of done. Protect `verify.config.json` and `acceptance/` with `--protect`; the script itself is already read-only under `.claude/`.

### TypeScript
Supported: projects that run tests with Node's built-in runner and native type stripping, e.g. `"testCommand": "node --test \"tests/*.test.ts\""` (Node 22.18+ or 23.6+; earlier 22.x/23.x need `--experimental-strip-types`, put it in your own `testCommand`). Files ending `.ts`, `.mts` and `.cts` count as source and test files (`*.test.ts`, `*.spec.ts`); `.d.ts` files never count as source. Use erasable syntax only (no `enum`, `namespace` or parameter properties); import siblings with the `.ts` extension.
- **Mutants only land in runtime code.** For a TypeScript file the gate asks `node:module`'s `stripTypeScriptTypes` for the type-erased text (types are overwritten with spaces, so offsets and line numbers equal the original), and only looks for operators in what survives. A `true` in `strict: true`, the `>=` in `Array<T>= []`, `false` in `T extends true ? false : never`, or anything in an `interface` or `type` is never a mutation site, so no mutant is falsely "killed" by a syntax error or falsely "survives" because stripping erased it. Every mutant must also still parse after stripping, or it is dropped (the plain-JS filter cannot do this for ES modules). A source file that cannot be stripped fails the mutation step by name instead of being skipped. This needs `module.stripTypeScriptTypes` (Node 22.13+/23.2+); the experimental-warning it prints is silenced.
- **Coverage offsets** from V8 already refer to the original text for stripped files, so uncovered lines are the line numbers in your `.ts` file.
- `.tsx` and `.jsx` are **not** supported on this path: Node's type stripping does not handle JSX, so such files are ignored as source (they are not measured or mutated). They count as source and test files only with `"adapter": "junit"` and a runner that compiles JSX (`vitest`); see the report contract below.
- Not yet supported: Vitest and Jest (the gate parses `node:test` output), `--experimental-transform-types` (it changes offsets, so mutation fails closed on such files).

Requirements and limits: Node/`node:test` projects (JavaScript, or TypeScript as above); the mutation run copies `srcDirs`, the test dirs and `mutation.copy` to a temp dir (add `tsconfig.json` there if your test command reads it), first proves that copy passes its own tests, and never touches your real files; a child process that is killed by a signal writes no coverage, so servers must handle `SIGTERM` and exit 0 (the gate says so when a file shows 0%); the mutation operator set is small and equivalent mutants make 100% unrealistic, hence a 60% default floor; the sample changes with the source (seeded from it) so the agent cannot memorise it. Not covered: logic placed outside `srcDirs`, non-`node:test` runners, JSX, and deleting a source file (set `coverage.minSourceFiles`; the git-tracked list is not consulted).

### Report contract (`"adapter": "junit"`, ADR-0003)
With `"adapter": "junit"` the gate judges test results from a **JUnit XML** report written by the project's own runner, so the runner need not be JavaScript. Without `adapter` (or with `"node"`) nothing changes.
```json
{ "adapter": "junit", "runner": "vitest", "testCommand": "npx vitest run",
  "holdout": { "command": "npx vitest run --root /abs/holdout" },
  "journeys": { "command": "npx playwright test", "runner": "playwright", "uxFile": "docs/ux.md" },
  "weakerGate": { "missing": ["test-quality", "mutation"], "decision": "decisions.md: weaker gate for slug-react, 2026-11-24" } }
```
`runner` (`vitest` or `playwright`; `holdout.runner` and `journeys.runner` default to it) says which flags the gate appends to the command and which stdout summary it reads: Vitest `--reporter=default --reporter=junit --outputFile.junit=<file>`, Playwright `--reporter=junit,line --output=<dir>` with the report path in `PLAYWRIGHT_JUNIT_OUTPUT_FILE`, set only for that child process. `standin-pytest` (pytest's `--junitxml=<file>` and `=== N passed in Xs ===` line) exists **only for the harness's own tests**: it is the shape of the shell stand-in runner, not a supported stack (Python is outside #55). The flags go at the end of the command, so the command must end with the runner itself (`npm test -- ` style wrappers need the `--`).
- **Trust rules.** A non-zero exit fails whatever the report says. Every run (the main run, each replicate, the holdout, the journeys) gets a fresh report directory outside the project (symlinks resolved), created after the run starts and deleted after reading; the gate refuses to start if the temp directory is inside the project. A missing report (the message names the flags), one modified before the report directory was created (both times from the same filesystem, so no rounding), a malformed one, or one whose totals (tests, failures, skipped) differ from the runner's own summary line fails the step, showing both sets of numbers.
- **Same checks as the node path.** Skipped and todo tests fail, `minTests` and replicates apply, and journey ids in `uxFile` must each have a passing JUnit test whose name contains them. Failing tests are printed as `not ok N - <name>` lines with an `error:` line in the "Failing tests" block, so the no-progress breaker and failure clustering work unchanged.
- **Holdout stays hidden.** Only counts are printed. A holdout report that cannot be trusted (missing, old, malformed, totals disagree) gives one fixed message, `holdout: the JUnit report could not be trusted (parse or totals problem); details hidden`, and the JUnit reader's own errors carry a character offset at most, never report text.
- **Coverage from lcov (#58).** For a runner that can write lcov (`vitest`), the main test run also gets `--coverage.enabled --coverage.reporter=lcovonly --coverage.reportsDirectory=<dir> --coverage.include=<srcDir>/** --coverage.reportOnFailure` (one `include` per `srcDir`, so untested files appear at 0%, and a failing run still writes lcov), into the same gate-owned directory under the same trust rules: a missing, older-than-the-run or malformed lcov fails the coverage step. `lib/reports/lcov.js` reads `SF:`/`DA:`/`LF:`/`LH:` (other `KEY:value` records are skipped), checks that `LF`/`LH` agree with the `DA:` lines, and refuses anything else with a line number. `SF:` paths may be relative to the project root or absolute (the project's real path also counts), with `\` separators or another letter case (a case-insensitive match is used only when exactly one source file fits). **The file set comes from `srcDirs`, never from the report:** a source file with no record fails, naming the file. `minLines`, `minFileLines` and `minSourceFiles` apply as on the node path, with uncovered line ranges printed, and a test file inside `srcDirs` fails. `.tsx`/`.jsx` count as source and test files only for a runner that declares JSX (`vitest`); the node path and other runners keep their patterns. Replicates, holdout and journeys are not measured.
- **`coverage.exclude` is a weakening.** On every adapter the excluded paths are printed in the coverage step (`weakening: coverage.exclude leaves ... unmeasured`) and again at the end of the result (`weakened (verify.config.json): coverage.exclude ...`).
- **Weaker gate needs an owner decision.** Checks an adapter cannot run print `not available for the junit adapter`: test quality and mutation (#59) for every runner, and coverage for runners without lcov (`playwright` as the main runner, `standin-pytest`). While any check is not available, the gate **fails** unless `verify.config.json` has `"weakerGate": {"missing": [...], "decision": "..."}` whose `missing` equals exactly the checks not run (for `vitest`: `test-quality`, `mutation`; listing `coverage` there fails as "listed but checked"; an extra or a missing entry fails) and whose `decision` points at where the owner recorded it (a `decisions.md` line or an issue). Once accepted, every run still ends with `not checked (weaker gate, junit adapter): ... (owner decision: ...)`. The gate checks the list, not the record itself; the pipeline will check the `decisions.md` record (#62).
- **Known limit of the reader.** It reads the XML subset runners write (a `>` inside a quoted attribute is fine) and refuses everything else (unknown entities, unquoted attributes, DTD tricks it cannot follow): it fails safe rather than guessing.
- **Remaining risk.** Test code runs with the same rights as the runner, so it could write a consistent fake report *and* print a matching summary. The gate-owned path outside the project, the flags appended at run time and a protected `verify.config.json` make that deliberate cheating rather than an accident, which review and the hidden holdout are there to catch; the gate alone cannot rule it out. A report copied in with a fresh modification time is likewise caught only by the summary check.

Neutrality is tested with `test/fixtures/standin-runner.sh`, a POSIX shell script that behaves like pytest, and with replays of the real Vitest and Playwright reports from the spike (`test/fixtures/reports/`, `docs/process/spike-gate-adapters.md`).


## Whole-pipeline gate (`bin/pipeline.js`)
```bash
node .claude/harness/bin/harness.js init --verify 'node .claude/harness/bin/pipeline.js check --product app --docs docs/app' \
  --task "one-line idea" --open-gate-files --no-commit-gate --max 40 --stall 4
```
Run it in the product's own repository, not in `claude-setup`: a new product lives in its own repository or a path the owner gives. Install the harness there first (`harness-install`, or `node .claude/harness/bin/install.js <product-repo>` from a clone of `claude-setup`), open the session in that repository, then run the `init` above with `--product` and `--docs` pointing inside it (`orch-product-team` uses `--product <product-repo> --docs <product-repo>/docs/product/<slug>`). The first `pipeline.js check` reports `discover` as the next phase.

The Stop hook only holds an agent while verify fails, so with `verify.js` as the command the agent is held during the build and free to end the turn (usually to ask a question) in every other phase. `pipeline.js check` is a verify command for the whole of `orch-product-team`: it checks the phases and the two owner gates in order (brief, UX, design, spec issue and look, gate `spec-approved`, plan, build, review, QA, release, gate `accepted`, retro), stops at the first incomplete one and prints what is missing last, so that is what the Stop hook feeds back. The build phase runs the product's own `verify.js`; later phases are only looked at once it is green, and it is re-run on every check.

**Owner gates (`waiting`).** Phase 4a records the spec issue as a line `Spec issue: #N` in `decisions.md` (an issue in the product's own repository); the task list in the plan phase must be generated from that same issue. At each gate `pipeline.js` reads the issue's labels live (`gh api repos/{owner}/{repo}/issues/N`, run from the product directory). While the label is missing, or GitHub cannot be reached, the check exits 3 and its last line is `waiting for owner: spec issue #N needs label <gate>`. The Stop hook accepts that only from a verify command that runs `pipeline.js`: it holds the agent once so it can tell the owner, then lets the turn end, keeps the run active and charges no iteration. When the label is there, the next check moves on by itself. A read error other than "unreachable" (a wrong issue number, no access) blocks like any incomplete phase. `--issue-json <file>` gives a saved copy of the spec issue (from the GitHub MCP `issue_read` tool) for sessions where `gh` cannot reach GitHub; it is ignored while `gh` can. Each turn the hook lets end this way is traced as a `gate-wait`, and `agents-kpi.js` counts the next human prompt as a gate response (`human.gateResponses`), not an intervention. Once `spec-approved` passes, the spec issue number is pinned in `.harness/pipeline/`, and a different `Spec issue:` line fails the check. A pull request is never accepted as the spec issue. The Bash guard (`lib/guards.js`) refuses `gh` commands that add or remove `spec-approved` or `accepted`. Limits: the labels are read with the session's own GitHub access, so GitHub cannot tell who added one; the guard does not cover the GitHub MCP tools or raw HTTP calls, and a saved copy given with `--issue-json` is written by the session (it is used only while `gh` cannot reach GitHub, and the report warns when it is). The first spec issue named is trusted, so in a repository with earlier labelled issues the owner checks the number in the waiting message. Every human prompt after a wait counts as a gate response, even one that changes scope.

The plan phase writes the spec and tests inside the run, so start with `--open-gate-files` (the default write-protection of `spec.md`, `acceptance/` and `verify.config.json` is off). Instead, when the plan phase first completes, `pipeline.js` records hashes of `spec.md`, `verify.config.json`, `acceptance/`, `holdout/` and `ux.md` in `.harness/pipeline/`. Any later change, addition or deletion fails the check until `decisions.md` has an `AMEND: <path> - reason` line (one line per change). This is tamper detection with an audit trail, not prevention: it lets a test author correct a wrong test without a human, and it means the holdout is not hidden from the agent in this mode. `--no-commit-gate` is needed because the commit gate would refuse every commit until the last phase.

Limits: the document checks are structural (the file exists, is not a stub, has the required section or line), so they prove a phase was done, not that it was done well; `reviews.md` reports its own open-finding counts; every stop attempt after the plan phase costs a full product gate run.

## Holdout set (`--hide`)
```bash
node .claude/harness/bin/harness.js init --verify "node .claude/harness/bin/verify.js" --hide /abs/path/holdout --protect acceptance/
```
The human writes extra acceptance tests from the spec and keeps them **outside the project tree** (recommended). `--hide` makes the harness refuse, while a run is active, the Read/Grep/Glob tools and any shell command that names those paths (`hooks/pre-read.js`, `lib/guards.js`). A hidden path inside the project is also made read-only, but a repo-wide Grep can still surface its lines, so keep it outside. This is the analogue of a train/test split: the agent iterates against the visible acceptance tests and is graded once on cases it has not seen.

## Tuning model and effort (`bin/tune.js`)
```bash
node .claude/harness/bin/tune.js --task-file spec.md --verify "node .claude/harness/bin/verify.js" \
  --candidates "claude-opus-5-5:low,claude-sonnet-5-5:low,claude-sonnet-5-5:high" --trials 2
```
Commit the spec and acceptance tests first: each trial runs `claude -p --model … --effort …` in a fresh worktree of `HEAD`, then the verify command grades it. Output is a table of pass rate, mean cost (from `--output-format json`) and mean time, the cheapest candidate that meets `--min-pass-rate` (default 100%), and `.harness/tune-report.json`. `--agent-cmd` replaces the default command (it receives `$HARNESS_MODEL`, `$HARNESS_EFFORT`, `$HARNESS_PROMPT_FILE`). This spends real tokens: use a small spec, and trials >= 2 when results are noisy. The rule of thumb to test is that a stronger model at low effort beats a weaker one at high effort on cost.

## Held-out tests: environment variable (`HARNESS_HIDDEN_DIR`)
The other way to hold out tests, besides `--hide` above. Use `--hide` when the harness starts the run; use this when you launch `claude` yourself and want the path kept out of `state.json` too. Both are enforced by the same read guards, and either can be used alone.
A visible acceptance suite can be read, and a strong model will satisfy it. A **held-out suite** checks the same rules on
inputs the agent has not seen, so "underspecified" actually bites. Put the tests in a directory **outside the project**,
and start the agent with the path in an environment variable that only the `claude` process carries:

```bash
HARNESS_HIDDEN_DIR=/abs/path/to/held-out claude -p "..."      # verify.config.json: "... \"$HARNESS_HIDDEN_DIR/*.test.js\""
```
While a run is active, shell commands and `Read`/`Grep`/`Glob` calls that name that directory or the variable are blocked
(`hooks/pre-read.js`, `lib/guards.js`). The held-out tests run inside `verify.js` (and so inside the Stop hook), and their
failing assertions come back in the verify output; that is the intended feedback channel. They resolve the project from the
current directory (`path.resolve('src/...')`), so they also run against the mutation copy. See [`fixtures/sheet-engine/`](fixtures/sheet-engine/).
Limits: this stops a good-faith agent from reading the suite, not a determined one, and every failure reveals one expected value.

## Test
```bash
node --test .claude/harness/test/*.test.js
```
`fixtures/` holds the gate setup examples (spec, acceptance tests and `verify.config.json`, no `src/`). They are
starting points for a harness run, not products, and the installer does not copy them (or `test/`) into other projects.

## Known limits (be honest about these)
- **Verify is only as strong as your tests.** With a plain `npm test` verify, an agent can pad with a placeholder test (seen live: `tests/smoke.test.js` asserting `true` passed an 80% coverage floor measured over test files). The strong verify closes that gap for Node projects; for other stacks write an equivalent gate. Acceptance tests written from the spec and protected with `--protect` remain the most important defence.
- **Shell guards are heuristic.** `lib/shell.js` is a best-effort parser, not a shell: variable indirection (`X=main; git push origin $X`), decoded payloads, and scripts written then executed get through. Pair with isolation (container/worktree, no prod credentials, network allowlist) and server-side branch protection + required CI.
- **Known gaps found by review and left open** (documented, not fixed): `git apply`/`patch`/`tar -C`/`unzip -d`/`find -exec` writes into protected paths; a read-only `node -e` that merely mentions a protected path is blocked (false positive, by design); `--force-with-lease` is blocked even on feature branches. Closed since: bulk staging of `.env` (`git add -A`, `commit -a`), `git clean`, deleting or moving `main`, `core.hooksPath` and `HUSKY=0`, `pkill`/`killall`, `>|` redirects. Bulk-staging detection runs `git status`, so a secret that is gitignored is correctly not flagged.
- **Allow list no longer has `Bash(node:*)`.** It let any `node -e` script bypass the shell guards. Only `node --test` and the harness `report.js` / `verify.js` are pre-approved; anything else asks.
- **Hiding is heuristic.** The agent can still find a hidden path by guessing at it from the shell in ways the parser cannot see (see the shell-guard limit above). Isolation is the real answer; hiding raises the cost of overfitting, it does not make it impossible.
- **Replicates add test-suite time** (default 2 runs per Stop attempt). Set `replicates: 1` for very slow suites.
- **Diagnosis relies on `node:test` output** for grouping (spec or TAP reporter); other output falls back to the raw tail.
- **Checkpoints are local unless `--checkpoint-push`.** A local ref survives a crashed agent or lost context, not a lost container. `restore` copies files back but does not delete files created after the checkpoint. Gitignored files are not captured.
- **The Stop feedback sends the full spec once** (first block); later blocks carry only a pointer plus the verify-output tail, so context does not grow by one spec copy per iteration.
- **Hooks fail open** on internal crashes (exit 1) so a bug cannot brick a session (each crash is written to `.harness/hook-errors.jsonl` and shown in the report). A *corrupt state file* is stricter: guards stay on, commits are refused, and the Stop hook blocks once (then lets the session end, since the agent cannot repair `.harness/`).
- **Gate files are always read-only during a run**: `verify.config.json`, `acceptance/` and `spec.md` are protected by default, in addition to any `--protect` paths.
- **Timeouts:** verify defaults to 600 s (`--verify-timeout SECONDS` to change); the Stop and commit hooks time out at 900 s in `settings.json`. Keep the verify budget (tests plus mutation samples) below that.
- **Per-edit lint:** `init --lint "<cmd>"` runs the command after every Write/Edit (`hooks/post-edit.js`) and sends failures back to the agent with exit 2. Exit 1 would not block.
- **Sandbox:** `settings.json` enables the OS sandbox for Bash and its child processes (credential dirs unreadable, network limited to npm and GitHub). Hooks cannot see what `npm test` reads; the sandbox can. **It needs `bwrap` and `socat`; without them Claude Code silently runs commands unsandboxed** and only the deny rules and shell guards apply. `init` warns when this is the case, and `init --require-sandbox` refuses to start instead. Verify the key names against your Claude Code version.
- **Trust the workspace first.** Non-interactive runs (`claude -p`) ignore the project `permissions.allow` list until the workspace is trusted, so the agent cannot even run `node --test` or `verify.js` and is graded blind (seen live: the Stop hook still passed the run, but the agent could not test its own work). Open Claude Code in the project once and accept the trust dialog, or set `projects["<dir>"].hasTrustDialogAccepted` in `~/.claude.json`. `init` warns when the workspace is not recorded as trusted.
- **Failure output matters as much as the gate.** A live run showed an agent spending about ten attempts reading a verify tail that said only "tests failed (3 failing)". `verify.js` now ends with a "Failing tests" section (names, error, expected/actual), and the Stop hook forwards up to 70 lines / 5000 characters.
- **Every Stop attempt costs an iteration**, including when the agent stops to ask a human a question; with no human that is wasted budget, so tell the agent not to ask.
- **No cost cap yet.** Time and iterations are capped (`--max`, `--max-minutes`); dollars are not. Bound spend with account/session limits, and use `tune.js` to find a cheaper model/effort.
- **The time budget is checked at Stop attempts**, so one long agent turn can overrun it; it is not a watchdog.
- **No evaluator-score gate yet.** `gan-evaluator` feedback is advisory; only the verify command is enforced.
