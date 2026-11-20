# Retro: packing-list

Run of `orch-product-team` under the whole-pipeline stop gate, one session, no human. Product: `examples/packing-list/`.

## Outcome

- Product gate green: 175/175 tests, source coverage 99.45%, hidden tests 25/25, browser journeys 25/25 (J1 to J10, UC1 to UC15), mutation 8/8.
- Reviews: 0 CRITICAL, 0 HIGH. QA: 0 BLOCKER, 1 MAJOR (fixed in round trip 1 of 3), 5 MINOR, 2 COSMETIC.
- Stop hook: never fired before the end of phase 9, because the orchestrator never ended its turn (harness iteration 0 of 40 at the time of writing).
- Frozen gate files: three amendments, all by the test author with `AMEND:` lines: `verify.config.json` (`mutation.copy` lacked `package.json`) and the two test helper files (a port race that made the gate flaky, found on the final pipeline check).

## Cost by phase (from `kpi.json`)

| Phase | Agent runs | Tokens | Agent time |
|---|---|---|---|
| discover | 1 | 18,186 | 0.6 min |
| ux | 2 | 42,654 | 1.2 min |
| design | 1 | 37,165 | 1.6 min |
| plan | 6 | 204,492 | 22.0 min |
| build | 4 | 253,412 | 27.5 min |
| review | 4 | 206,687 | 9.0 min |
| qa | 1 | 69,306 | 7.0 min |
| release | 1 | 25,599 | 0.4 min |
| retro | 1 | 14,399 | 0.3 min |
| total | 21 | 871,900 | 69.7 min |

How to read it: 9 of the 18 delegated runs before this retro ran longer than 120 seconds and were moved to the background by the host, so the trace hook recorded no tokens or time for them. Their figures were typed in from the completion notices (`agent-finals.json`, passed with `--finals`). Without that file the KPI shows 9 of 18 runs unreported and 276,566 tokens. The orchestrator's own tokens are not in the KPI at all. Three resumed test-author runs (the amendments, via SendMessage) are counted with time but no tokens, because their notices give only a cumulative token figure. The KPI counts 2 human prompts and 1 intervention; the second "prompt" was the host's "worker process was restarted" notice, not a person.

## What went well

- The hidden tests passed first time (25/25) for both builders; the test author had proved them against a throwaway stub and cited a design line for every expected value.
- The journey gate did its job: the build could not go green until all 25 browser tests passed, and the server-only build was correctly held at "journeys 3/25".
- Saving the read-only architect's design by script from its transcript avoided retyping.
- The independent QA walk found a real defect that 95 gate tests missed (an idle kept-alive connection was answered with a 400, breaking about 1 page load in 12).

## What went badly

1. Cost data: `run_in_background: false` does not keep a long agent in the foreground. Every call over 120 s was backgrounded (9 of 18), with no tokens or time in the trace.
2. The gate config the orchestrator handed to the test author left `package.json` out of `mutation.copy`. The mutation step is the last of seven, so this only showed after everything else was green, and the frozen file needed an amendment.
3. The MAJOR defect in QA came from the review fix round (`connectionsCheckingInterval: 1000`, a reviewer's suggestion) meeting an older catch-all 400 handler. Nothing between review and QA exercised a connection that sits idle.
4. Two `pre-bash` guard crashes failed open (`.harness/hook-errors.jsonl`): a regular expression built from command text, and a JSON parse of command text.
5. The guard blocked one read-only orchestrator command that only named a path under `.harness/` (documented false positive).
6. A delegated agent left a server process running; the orchestrator's attempt to stop it was denied by the permission system.
7. The gate was flaky once: the test helpers picked a free port and started the server afterwards, so under parallel load a test could fail with "Port N is in use". It showed as a failed mutation baseline on the final check and was fixed by the test authors (decision D29).
8. The run stopped for 5.8 hours in phase 9. The trace has no records between 13:47 and 19:34 UTC; the session that started this run reports the cause as the account's 5-hour usage limit. The limit ended the orchestrator's turn mid-step, so the skill's "Limits and resuming" steps (write `status.md`, schedule a resume, continue) never ran and the run did not resume itself: it continued only when a "worker process was restarted" notice arrived. That notice is the second "human prompt" in the KPI.
9. This retro's own agent (`harness-improver`) reported that it did not run the report or open any of the evidence files it was pointed to, and proposed a `verify.js --only mutation` flag that does not exist. Its proposal below is kept because the orchestrator checked it against the run; the wording is corrected.

## The one proposed change (not applied; a human merges it)

File: `.claude/skills/orch-product-team/SKILL.md`, "Test author rules (phase 4)", add one bullet:

> - **Prove the gate config before it is frozen.** `mutation.copy` must list everything the copied tree needs to run its own tests: `package.json`, any config file a test reads, the source and test directories. Do not copy the list from another example without comparing it with `ls`. With a throwaway stub that passes the visible tests, run the full `verify.js` once outside the repo; the mutation step must get past "baseline run of the unmutated copy".

Evidence: decision D18 and the `AMEND:` line in `decisions.md`; first full gate run of builder P ended `mutation: baseline run of the unmutated copy failed` with every other check green. Both test authors already built such a stub in this run, so the extra cost is one gate run.

Measure on the next run: zero `AMEND:` lines for `verify.config.json`; the first full gate run of the build phase does not fail at the mutation step.

## Candidates not chosen (most valuable first)

- Record cost for backgrounded agents automatically (a hook on the completion notice, or have the KPI read the host's agent transcripts) instead of hand-typed `--finals`. Needs a harness change and a human decision.
- Make the "human prompt" classifier ignore the host's restart notice, so a restart is not counted as an intervention.
- After a review fix round that touches server timeouts or connection handling, re-run QA's idle-connection check. One occurrence so far; revisit if it recurs.
- Fix the two fail-open guard crashes.
- Have `pipeline.js` require evidence that the retro agent read the trace (see the limit checks in the final report).
