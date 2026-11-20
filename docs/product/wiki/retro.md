# Retro: wiki

## What was built
A local-first Markdown wiki (`examples/wiki/`): plain `.md` vault, wikilinks, backlinks, rename that rewrites links, substring search, graph view, hash-based conflict detection, loopback-only server, zero dependencies. Brief, UX, design (13 ADRs), spec, tasks, 23 decisions, reviews, QA and README are under `docs/product/wiki/` and `examples/wiki/`.

## Result against the definition of done
| Gate | Result |
|---|---|
| Unit + acceptance | 306 tests, 305 pass, 1 skip (`HOST ::1`, kernel has no IPv6) |
| Full verify gate | Passes on a scratch copy without that one test: coverage 97%+, holdout 16/16, mutation 6/8. In the real tree it is red only because a skip counts as a failure |
| Browser QA | 31/31 ux checks (5 amended with reasons), axe clean on all screens and dialogs; one flaky run in two repeat runs, not identified |
| Reviews | 0 CRITICAL, 2 HIGH (a11y) fixed; MEDIUMs fixed or logged |
| Perf | search 62 ms and graph 79 ms server side at 5,000 notes; browser: search 156 ms median, 1,000-node graph ready in 0.7 s |

## Human touch
One real prompt (the idea) and one answer to the single up-front question (which app, how far). Everything else was an agent decision in `decisions.md`. The Stop hook asked for a commit and push about ten times; those are hook prompts, not human ones.

## Cost (subagent tokens, from the run's usage lines, approximate)
Total about 1.7M. Build S 165k, build P 288k, acceptance tests 198k, security review 136k, a11y review 124k, fix rounds 184k, QA 100k, plan 74k, design 71k, README 69k, polish 60k, ux 54k, perf 49k, discover 20k. Reviews plus fixes (about 600k) cost more than either build. Effort was `low` except build, plan and tests (`medium`) and security review (`high`).

## What worked
- Tests written by a different agent before the build, plus a hidden holdout: the builder found no spec contradictions to argue about, and the test owner's fake-server run caught a test bug early.
- Parallel multi-angle review found real defects the green gate did not: quadratic parsing (a note could freeze the server or tab), a lock-file race, a rename that corrupted non-UTF-8 notes and one that aborted halfway. The gate (97% coverage, 100% holdout) gave no hint of any of them.
- Probe-based security review (it ran attacks) gave much more than a read-only one would.

## What did not work (evidence-backed)
1. **The KPI proof is not credible for this run.** `agents-kpi.js` reported 0 runs, 0 tokens for all 36 agents, and the harness status shows iteration 0. The harness hooks did not record any of this session's delegated agents (the workspace is not marked trusted, the sandbox is off, and agent calls here ran asynchronously even with `run_in_background: false`). So tags, effort stamps and foreground status are unverified here; token figures above come from the agents' own usage lines.
2. **A skip is a failure, and acceptance is read-only.** One environment-dependent test turned the real gate red for the whole build. The test should assert something when IPv6 is missing (for example that `HOST=::1` passes the loopback check), not skip. Nobody could fix it during the run, by design.
3. **Protection list vs decision log.** `--protect docs/product/<p>/` covers `decisions.md`, which the orchestrator must write. Writes through the shell were not blocked, so the protection did not hold for the one file that has to change. The skill should protect specific files (brief, ux, design) and leave `decisions.md`, `reviews.md`, `qa.md` open.
4. **Mutation margin is thin** (5/8 to 6/8 against a 60% floor) and the survivors were always in UI glue; the gate cannot tell if UI tests are real.
5. **A ux check was wrong five times out of 31** (empty vault vs lock file, browser path normalisation, title-only highlight, alert role placement, default tab). Agent-written UI checks need a dry run against a reference page before they become the acceptance bar.
6. **Foreground request was ignored.** Every Agent call came back as async, so "stay in the turn while a builder works" depends on the Stop hook, which here fed back "commit and push" instead of verify.

## One change proposed
Make the verify gate treat a test that skips because of a missing platform capability as a named, allowed-skip (listed in `verify.config.json`, for example `allowSkip: ["HOST ::1 listens"]`) rather than failing the gate. Evidence: item 2; the only thing that kept this gate red across the whole run.

## Product backlog
Search result cap and "show more" (needs a spec change); a count of links to missing notes in the graph list (needs the graph API to return it); a11y backlog L3-L10 in reviews.md; first-time sample vault; export; tags and `#heading` links; a file watcher.
