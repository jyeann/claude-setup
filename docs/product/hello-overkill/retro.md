# Retro: hello-overkill

## Outcome
Homework Hello World API rebuilt as an over-engineered product with zero runtime dependencies: core `POST /hello` kept byte-exact, plus polyglot greetings (10 x 4), streaks, signed certificates with verify, greeting battle, chaos mode, 429 politeness, and an SPA.
Final gate: `verify.js` PASSED (201/201 tests, 99.53% line coverage, hidden holdout 22/22, mutation 8/8). Browser QA: 30/30 checks over J1-J10 and UC1-UC11.

## Phases run
discover, ux, design, plan (spec, TASKS.md, 83 acceptance tests, 22 holdout tests), build (3 builders, then a fix round), review (4 parallel reviewers), qa (Playwright), release, retro.

## What went wrong, with evidence
1. **A design caveat was lost in handoff.** The read-only architect returned design text; I re-saved a shortened `design.md` and dropped "whitespace outside the certificate JSON still verifies". I had also told the holdout author that rule. Result: a visible acceptance test (trailing space is Forged) and a holdout test (it is Authentic) contradicted each other and the build failed the holdout on one test. Resolution: strict rule kept, holdout test corrected, decision logged in `decisions.md`. Root cause: a human-in-the-loop copy step between agents. Change proposed below.
2. **Reviewer advice conflicted with the UX spec.** The a11y review said to remove `aria-busy`; `ux.md` required it on the loading card. Browser QA caught it (D1). Reviewers should be given `ux.md` as a hard requirement list, not only WCAG.
3. **Mutation testing found weak tests after the fix round** (6/8 killed; `battle.js:12`, `greetings.js:92` survived); it read 8/8 again on the final run. I did not confirm why, but the sample of 8 mutants appears to vary between runs. The two survivors point at real test gaps (distinct-pair check, greeting template guard) and are not yet covered by dedicated tests. Logged as follow-up.
4. **Background agents.** Every delegated agent ran as a background task even when foreground was requested, so I waited on notifications. One builder's hand-back arrived after the work had already been verified by me.
5. **No KPI evidence.** `agents-kpi.js` reported 0 runs for all 36 agents, so this run does not meet the skill's KPI proof bar (tagged, effort-stamped, zero interventions). The phase tags and efforts were passed, but nothing recorded them here.

## Review dispositions that were rejected, on purpose
- Debounced async persist (perf P1/sec S1): rejected; breaks "persist before responding" and the SIGKILL acceptance test. Documented cost: ~10 ms per write at the 10,000 cap.
- Global limiter, per-IP connection cap, rate limits on read endpoints, chaos gating: logged, not built.

## Proposed change (ONE, evidence-backed)
Make the orchestrator hand architect output to a writer agent verbatim instead of re-typing it: add to `orch-product-team` phase 3 "when `architect` (read-only) returns the design, spawn a writer agent with the exact text and require a diff-free save, or give the architect Write". Evidence: item 1 cost one failed gate and one contradictory test pair.

## Wild ideas still open (from the brief)
Hello Weather, live SSE hello wall, SLA dashboard, greeting time machine, haiku compiler, federation of two services.

## Follow-ups found during release (not fixed)
- A `chaos=1` test failed once with `fetch failed` while other servers were running, then passed on a clean rerun: likely timing-sensitive under load. Needs a deterministic seed or a longer timeout; the gate's replicate check did not catch it.
- `node src/server.js | head` crashes with an unhandled EPIPE on stdout (src/server.js). Harmless for normal use; add a stdout `error` handler.
- Two mutants survived in one run (`battle.js:12`, `greetings.js:92`): add dedicated tests.

# v2 retro: six wild ideas (weather, wall, SLA, time machine, haiku, federation)

## Outcome
All six built and wired. Final gate `verify.js` PASSED: 531 tests, ~99.6% line coverage, both holdouts 40/40, mutation 6-8/8 across runs. Browser QA 42/42 (30 v1 + 12 v2), no app defects. Reviews (security, code): no CRITICAL/HIGH; 4 MEDIUM security findings, of which 3 fixed and 1 accepted with a documented switch. The three v1 follow-ups are done: EPIPE handler, deterministic `chaos=1` tests, mutant-killing tests.

## What went wrong, with evidence
1. **Holdout vs spec, again (3 of 40 failed at first gate).** Two were real implementation bugs found only by the hidden tests (`Date.UTC` year 0-99 quirk; whitespace collapse before control-char check) and two were wrong holdout assertions (unescaped spaces in a request path; era name "social era" for 2024). The retro-1 proposal (hand architect output verbatim) was applied this time: the spec agent had Write, so no lossy re-typing step. The remaining source of error is hidden tests written without running them (author "did not run the suite" twice).
2. **Acceptance tests were written while src/ was changing.** The author could not produce a clean RED, so "tests fail for the right reason" is only partly evidenced (first run: 103 of 136 failing, mostly 404). Next time: gate the test author before any builder starts.
3. **A review fix conflicted with an acceptance test.** M3 (SLA token >= 16 chars, hard error) broke a read-only acceptance test using a 12-char token. Resolved by limiting the hard error to `NODE_ENV=production`. Lesson: a review finding that adds a new rule should be checked against the acceptance suite before dispatch.
4. **I relayed a wrong claim.** I told the code reviewer the "federation never links" check had `|| true`; it had not (the page builder had said so). Verify claims from agents before passing them on.
5. **Mutation survivors, resolved with a full scan.** The gate samples 8 mutants, and the sample is seeded by a hash of the source text, so it changes when source changes (not per run of the same code); that is why 6/8, 7/8 and 8/8 appeared across edits. A full scan of `battle`, `greetings`, `haiku`, `config` and `certificates` (every mutant, full suite, baseline checked green first) found 13 survivors. 10 are now killed by new unit tests (`config.js:17`, `config.js:46` x2, `greetings.js:92`, `haiku.js:69`, `haiku.js:88`, `haiku.js:108` x4). 4 are equivalent and left alone: `battle.js:11-12` (3, because all 40 greetings are distinct so equal id and equal text always agree; a new test pins that invariant) and `certificates.js:20` (1, the later per-key string check returns the same `unreadable` verdict). With the real banks the `haiku.js:108` first candidate never fails (0 failures in 16,000 name x theme combinations), so its tests tamper with the exported `BANKS` and restore them.
6. **Background-only agents again; KPI file still shows no runs**, so cost/intervention proof is still absent.

## Accepted and open
- M2 enumeration via `/api/time-machine?name=` accepted (switch: `HELLO_TIME_MACHINE_STREAKS=0`). `ts` timing side channel on the stream, proxy-trust for rate limits: logged.
- `haiku.js:108`: done (see item 5). A mutation scan run earlier in this follow-up was invalid because its unmutated baseline failed (a test hard-coded 2026-11-18); scanners must check the baseline first.
- UC11 in the QA script needed `visible=true` after new views added hidden inputs: label-based selectors are brittle when views add same-named fields; use testids.
