# Decisions: packing-list

Every decision made without a human. Format: decision | options | chosen | why | decided by.
| # | Decision | Options | Chosen | Why | Decided by |
|---|----------|---------|--------|-----|------------|
| D1 | Branch for the run | reuse `claude/vigilant-cannon-ytq761` / new branch | new branch `claude/packing-list-product-run` from it | task says create own feature branch; no PR, no push to main | orchestrator |
| D2 | Harness start | before phase 1 with `pipeline.js check` / build-only | `harness.js init` with pipeline gate, `--open-gate-files --no-commit-gate --max 40 --stall 4` | skill "Starting the run" | orchestrator |
| D3 | Stack | plain JS + node:test / TypeScript | plain JavaScript, Node built-in test runner, zero runtime dependencies, like `examples/retro-board` | given in the task | orchestrator |
| D4 | Effort per phase | skill defaults / other | discover, ux, design, release, review, qa: low; tests: medium; build: medium | skill "Effort" table | orchestrator |
| D5 | Build, adopt or extend | adopt Keep/Todoist / extend / build | build | nothing fits local + zero deps + no accounts (brief.md) | product-scoper |
| D6 | Persistence, sync, access, limits | see brief.md "Decisions made without a human" | JSON file, 2 s polling, one full-edit link, name 80 / item 120 / 200 items | brief.md | product-scoper |
| D7 | UX choices (URL `/l/<id>`, no remove confirmation, insertion order, focus rules) | see ux.md "Decisions made without a human" | as listed there | ux.md | ux-designer |
| D8 | Accessibility review changes to ux.md, new checks UC14 and UC15 | accept / reject | accept | objective, Playwright-checkable, WCAG 2.2 AA | a11y-architect, accepted by orchestrator |
| D9 | How to save the read-only architect's design | retype / writer agent / script | a script copied the architect's final message byte-for-byte from its transcript into design.md and adr/ | skill: never retype or shorten it | orchestrator |
| D10 | Architecture choices | see adr/0001..0004 | single JSON file, polling, explicit set-ticked, static shells + textContent | adr/ | architect |
| D11 | Who writes tests vs who builds | same agent / different | `tdd-guide` writes spec, acceptance and holdout tests; `e2e-runner` writes journeys; `gan-generator` builds; `gan-evaluator` does QA | test author must not be the builder; QA must not be the journey author | orchestrator |
| D12 | TASKS.md format and approval | keep planner's layout / convert to the `plan-to-tasks` parser format; ask a human to approve the backlog / agent approves | converted mechanically by script (headings `## T<n>: `, `type`, `blocked-by`, `status`), text otherwise the planner's; backlog approved by the orchestrator; T12 changed from "open a PR" to "no pull request" | `next-task.js` must parse it; the skill makes plan approval an agent decision; the task forbids a PR | orchestrator |

## Test author log (phase 4)

Written by `tdd-guide`. Files: `examples/packing-list/spec.md`, `acceptance/{helpers,api.acceptance.test,pages.acceptance.test}.js`, `holdout/{helpers,holdout.test}.js`, `verify.config.json`.

Visible run (`node --test "acceptance/*.test.js"`):
```
# tests 45
# pass 0
# fail 45
```
Hidden run (`node --test "holdout/*.test.js"`):
```
# tests 25
# pass 0
# fail 25
```
Why they fail: `src/server.js` does not exist yet, so `startServer` throws `src/server.js not found` (the R44 test fails because `package.json` is missing). Not a test defect: all 45 visible and 25 hidden tests pass against a throwaway stub server kept outside the repo (scratchpad), which was written only to prove the tests themselves are sound.

Conflicts between ux.md and design.md: none found on anything testable (URLs, status codes, copy, error messages, selectors agree). `spec.md` "Resolved conflicts" says "None".

Decisions:
- T-D1: spec.md copies design.md sections 1, 2, 3 (table, messages, pages), 4, 6 and rules R1-R44 byte for byte via script, so rule numbers and wording are identical.
- T-D2: `verify.config.json` drops `timeoutMs` under `journeys` (strong-verify.js uses the top-level `timeoutMs` for journeys; the key is not read). minTests: tests 45, holdout 25, journeys 25.
- T-D3: `holdout/helpers.js` finds the app from `process.cwd()` (not `__dirname`), because the gate may run the hidden dir from elsewhere via HARNESS_HIDDEN_DIR.
- T-D4: hidden tests cite `design.md:<line>` (same text as in spec.md) for every expected value.
- T-D5: the EADDRINUSE message and exit code 1 (design.md:7) are in the hidden set; the wrong-shape case `{"schema":1,"lists":[]}` was dropped from the corrupt-file test because "lists not an object" is ambiguous for arrays.

Rules not tested over HTTP (covered by unit tests or journeys): R2 defaults (PORT 3000, default DATA_FILE path), R12 randomness source, R39 write failure gives 503 storage_error (needs fs fault injection), R41 and R42 polling behaviour (journeys), design.md:56 storage_full at 10000 lists (too slow), 10 s request timeouts, 500 internal_error, SIGINT, `createApp` export. R43 and R44 are checked statically in the visible pages tests.

## Journey test author log (phase 4)

Files: `examples/packing-list/journeys/journeys.test.js` (J1..J10, 10 tests), `ui-checks.test.js` (UC1..UC15, 15 tests), `support.js` (helpers, not a test file).

Run: `cd examples/packing-list && node --test "journeys/*.test.js"`
```
# tests 25
# pass 0
# fail 25
```
Why they fail: `src/server.js` does not exist yet; every test fails fast with "Product missing: .../src/server.js does not exist". Checked beyond that against a throwaway stub outside the repo: all 25 passed there, so the test code itself is sound.

Interpretations:
- Each test starts its own server (free PORT, temp DATA_FILE) and its own Chromium; the browser opens `http://127.0.0.1:<port>` (allowed Host), while J1 checks stdout for `http://localhost:<port>`.
- J1 "no sign-in, account, cookie banner, name prompt": exactly one textbox on the page, no password input, no dialog, no cookies in the context, body text has no "sign in", "log in", "account", "cookie", "your name".
- J2 "Copy" in J2/UC13: the "Copied" button must show within 2 s and revert to "Copy" within 4 s (J2) or 3 s (UC13); clipboard permissions are granted on the context.
- J2 focus on h1: checked as `document.activeElement` is an H1 with tabindex -1 shortly after creation.
- J3: "no list is created" is checked only through the URL staying `/`, not through the API (tests never call the API).
- J4 and UC8: all 200 items are added through the UI (about 1 s against the stub); nothing is seeded through the API.
- J4 step 1 "at once": the item must appear within 1.5 s (less than one poll interval); J7 "disappears at once" and progress update likewise 1.5 s.
- J5 "bar is full": progressbar aria-valuenow equals aria-valuemax.
- J6/J7/J10 "within 5 s": polling assertions with a 5000 ms limit, no fixed sleeps. J10 ticks all 5 items in browser one and checks both browsers.
- J8: h1 and the item are checked by textContent and by the absence of `b` elements; item shown as a label text inside `ul#items` and as the checkbox's accessible name.
- J9: SIGTERM must give exit code 0 (design R3); the restart reuses the same PORT and DATA_FILE.
- J10 mistyped id: `/l/xxxxxxxxxxxxxxxxxxxxxQ` (22 URL-safe characters that do not exist).
- UC15 "bounding box at least 44 by 44": for checkboxes the enclosing `label` box is accepted when the checkbox box itself is smaller (ux.md says the hit area comes through the label row). The Tab check runs on a freshly opened share link (new page), not on the page that just created the list, because J2 puts focus on the h1 after creation and Tab from there would not reach the skip link. If the builder focuses the h1 on every list page load, UC15 will fail; that conflict between J2 step 4 and UC15 is a spec ambiguity.
- UC2 and UC15 use a 320x640 viewport. UC14 loads `/`, a created list page and `/l/nope`.
- "Share link field value equals the page URL" (J2, UC6) is polled for up to 3 s, since the page may fill it after the first data load.
- Not objectively testable here: nothing in J1..J10 or UC1..UC15 was untestable; contrast, live-region announcement order and focus outline appearance (Accessibility section) are outside these tests, as ux.md itself says.

## Orchestrator decisions after the test authors (phase 4)

| # | Decision | Options | Chosen | Why | Decided by |
|---|----------|---------|--------|-----|------------|
| D13 | ux.md J2 step 4 (focus on h1 after create) vs UC15 (first Tab stop is the skip link), flagged by the journey author | focus h1 on every list load / only after create | only after create; written into spec.md "Resolved conflicts" before the plan-phase freeze | both checks can then pass; matches ux.md "after create, focus goes to the h1" | orchestrator |
| D14 | Both phase-4 test authors were sent in one message with `run_in_background: false` and still ran in the background | wait in turn / end turn | stayed in the turn and used the wait for Part 2 work (retro-board journeys) | ending the turn costs a harness iteration; recorded as a finding | orchestrator |
| D15 | Phase-4 exit check (RED for the right reason) | accept / redo | accepted: 45 visible, 25 hidden, 25 journey tests, all failing with "src/server.js not found"; both authors proved their files against throwaway stubs outside the repo | skill "Test author rules" | orchestrator |
| D16 | Builder brief | include holdout path / omit | the builder is given spec.md, ux.md, design.md, acceptance/ and journeys/ only; the hidden test directory is never named | skill: never give a builder the holdout path or contents | orchestrator |
AMEND: examples/packing-list/verify.config.json - mutation.copy lacked package.json, so the mutation baseline failed on the R44 tests that read ../package.json; added it. No test or threshold changed. (test author)

## Orchestrator decisions during build, review and after (phases 5 to 9)

| # | Decision | Options | Chosen | Why | Decided by |
|---|----------|---------|--------|-----|------------|
| D17 | Build split | one builder / server then UI | builder S (`gan-generator`, medium): src/, unit tests, HTML shells; then builder P (`gan-generator`, medium): public/ JS and CSS against the journeys | fits one agent context each; visible tests green before the UI starts | orchestrator |
| D18 | Mutation baseline failed (package.json not copied) | builder edits config / orchestrator edits / test author amends | sent back to the test author (`tdd-guide`, resumed), who added `package.json` to `mutation.copy` and wrote the AMEND line; the omission came from the orchestrator's config template | skill: only the test author amends a frozen gate file | orchestrator |
| D19 | Surviving mutant `src/http.js:114 true -> false` (kill rate 7/8, floor 60%) | fix now / hand to review round | handed to the review fix round as a test gap | gate passes; one fix round is cheaper than two | orchestrator |
| D20 | Review effort | all low / security high | `code-reviewer`, `a11y-architect`, `performance-optimizer` low; `security-reviewer` high | skill: high for input and files on judgment (this app parses untrusted input and writes a file) | orchestrator |
| D21 | Review findings: 0 CRITICAL, 0 HIGH, 8 MEDIUM, 21 LOW | fix all / fix real defects and cheap wins / fix none | fixed M1 to M5 and 7 LOWs in one builder fix round; M6 (list-cap lockout) and M7 (write cost growth) logged with reasons in reviews.md; reviewers not re-run because nothing CRITICAL or HIGH was ever open | skill: MEDIUM fixed or logged with a reason; no review hop the spec did not ask for; the full gate re-ran green after the fixes | orchestrator |
| D22 | The fix-round builder edited an existing unit test of its own (`mergeItems keeps rows with a write in flight`) because fix M1 reverses the behaviour it asserted | accept / revert | accepted: it is a builder-owned unit test in tests/, not an acceptance, hidden or journey test, and the frozen files are unchanged | testing rule: fix the test only when it is demonstrably wrong; here the reviewed behaviour changed | orchestrator |
| D23 | QA agent | `e2e-runner` / `gan-evaluator` | `gan-evaluator`, effort low | `e2e-runner` wrote the journey tests, and QA must be done by an agent that did not | orchestrator |
