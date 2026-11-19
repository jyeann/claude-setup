# Hello Overkill: QA report

Run: `node qa/walkthrough.js` in `examples/hello-overkill` (Chromium via Playwright, deviceScaleFactor 1). Servers started with PORT=0, temp DATA_FILE, HELLO_SIGNING_SECRET=qa-test-secret-qa-test-secret-123, HELLO_RATE_LIMIT=1000 (a separate default-limit server for the 429 journey). Screenshots: `qa/*.png` (hello light/dark, 390px hello and battle, certificate, verify, battle, chaos, rate limit). Raw results: `qa/results.json`.

Totals: 30 checks, 29 PASS, 1 FAIL. Rows named "covered by" are aliases of a detailed check, so J1-J10 and UC1-UC11 are all accounted for: J1 J2 J3 J4 (UC5, J4b) J5 (UC6, J5b) J6 (UC7) J7 (UC8.x) J8 (UC9) J9 J10; UC1-UC11 as listed.

| Journey / check | What | Result | Evidence |
|---|---|---|---|
| UC1 | page and controls | PASS | 10 languages, 4 tones, empty card shown |
| J1 | first visit and first greeting | PASS | "¡Ahoy, Ada! ¡Bienvenido a bordo, grumete!"; focus=name-input |
| UC2 | Ada Spanish Pirate | PASS | greeting contains Ada, lang=es, status ok, cert-link enabled; light+dark screenshots |
| J2 | all 10 languages x 4 tones | PASS | 40 combos (en,es,fr,de,it,pt,nl,sv,ja,sw x formal,pirate,shakespearean,corporate) all non-empty with Ada and matching lang |
| UC3 | every combination (browser, raised limit) | PASS | covered by J2 loop (40 combos, HELLO_RATE_LIMIT=1000) |
| UC10 | core API, 404, hostile input, blank name | PASS | POST /hello exact body, 404 JSON, hostile name literal and no __x, blank-name error + focus + aria-invalid + status |
| J9 | core API in browser | PASS | GET / 200 html; /nope 404 JSON (see UC10) |
| UC10b | name longer than 40 chars | PASS | maxlength=40 on input; API with 41 chars -> 400 |
| UC10c | 390px viewport: no horizontal scroll (hello, battle, verify) | PASS | no overflow; touch heights 44,44,44,44; battle options stacked |
| UC11 | keyboard, labels, dark/light 390 | PASS | tab order nav-hello>nav-battle>nav-verify>name-input>language-select>tone-select>chaos-toggle>say-hello; focus ring solid 2px; Enter submits; keyboard-only greeting incl. selects; labels found; dark+light 390 no overflow |
| UC-A11Y-route | route change focuses h1, aria-current, unknown hash falls back | PASS | h1 focused after route change, aria-current=page, #/bogus -> #/hello |
| J1-dark | hello result in dark mode (colour scheme honoured) | PASS | dark body rgb(18, 18, 18); light body rgb(250, 250, 250) |
| UC4 | visit 2 and restart (J3) | PASS | Visit 1 -> Visit 2 ("Streak 1 day") -> restart -> Visit 3 |
| J3 | return visit and streak | PASS | covered by UC4 (case-insensitive ada, restart continues count) |
| UC5 | certificate view (J4) | PASS | id 67e51450c37e66a0, date, 64-char signature, copy status "Select the text and copy it yourself.", print hides nav+buttons |
| UC6 | verify Authentic then Forged (J5) | PASS | Authentic (glyph) -> one-char greeting edit Forged (glyph) -> signature edit Forged -> unreadable -> empty error -> >10000 chars message |
| J4b | permalink view in a fresh context + not found | PASS | permalink opens in a new context; unknown id shows not-found copy |
| J5b | certificate verifies after restart with same secret | PASS | Authentic after restart |
| UC7 | battle vote + leaderboard (J6) | PASS | options A/B distinct; empty msg; vote -> status, row votes 1, buttons removed, Next focused; second vote sums to 2 |
| UC8.2 | chaos=418 friendly error + focus + no raw output | PASS | 418 message, retry focused, no stack/JSON in page |
| UC8.3 | chaos=delay shows loading then greeting | PASS | loading visible, button disabled "Greeting...", greeting after 4349 ms |
| UC8.3b | loading card carries aria-busy=true (ux.md Loading state) | FAIL | no element with aria-busy=true while loading (count 0) |
| UC8.4 | mixed chaos=1 never blank / no page errors | PASS | greeting after 2 attempt(s), error state seen=true, no page errors |
| UC8.5 | Try again repeats request and replaces error | PASS | first request 418, retry produced greeting for Ada, error removed |
| UC8.6 | network down / 500 shows generic error | PASS | 500 and aborted request both show generic copy, body not leaked |
| J7 | chaos journey | PASS | covered by UC8.2 to UC8.6 (forced ?chaos=418 and ?chaos=delay, mixed chaos=1) |
| UC9 | rate limit 429 with countdown (J8) | PASS | 10x 200 then 429, Retry-After 60, message "You've been greeted enough. Please wait 60 seconds and try again.", button "Wait 60s" then re-enabled, status announced |
| J8 | rate limit journey | PASS | covered by UC9 |
| CONSOLE | console errors = none (excluding browser resource-load lines for forced 4xx/5xx) | PASS | 0 console errors / page errors; 7 expected "Failed to load resource" lines from forced 418/429/500 |
| J10 | tests journey (criterion 11) | PASS | no UI; this walkthrough covers criteria 1,3,5,6,7,8 (UC1,UC2,UC4,UC5,UC6,UC7) plus 9,10; npm test is run separately |

## Defects

### D1 (low, UX spec deviation): loading card has no `aria-busy="true"`
- Spec: ux.md Hello view, Loading state: "result card shows 'Warming up the greeting...' (`aria-busy="true"`)".
- Repro: open `/?chaos=delay`, type a name, press Say hello, inspect `#result` while "Warming up the greeting..." is shown. `document.querySelectorAll('[aria-busy=true]').length` is 0.
- Cause: `src/page.js` `sendHello` (about line 207) appends `result-loading` without setting `aria-busy` on `#result` or the loading div.

### Observations (not failures)
- The Say hello button uses `aria-disabled="true"` instead of the `disabled` attribute while loading and rate-limited. Playwright and assistive tech treat it as disabled and clicks are ignored, but the button stays focusable and `button.disabled` is false. Matches the spec intent; noted for UC8 wording ("disabled").
- After pressing Enter in the name field, focus remains on the name input (not the button). Spec says focus stays where the user was; no focus move to the result. OK.
- Copy certificate reported "Select the text and copy it yourself." because the headless context has no clipboard permission. That is the spec's documented fallback, so it passes.
- Chromium logs "Failed to load resource" for forced 418, 429 and 500 responses (7 lines). These are browser network notices for intentionally forced statuses and are excluded from the console-errors check. There were 0 other console errors or page errors.

## v2 (six new views)

Run: `node qa/walkthrough.js` (same command; the v2 section runs before the CONSOLE check). Totals now: 42 checks, 42 PASS, 0 FAIL (30 v1 + 12 v2), run twice with the same result. v2 servers: HELLO_READ_LIMIT=1000 and HELLO_FED_LIMIT=1000 (so QA is not throttled), main server with `HELLO_PEERS=<real peer>,<stub peer>` and `HELLO_PEERS_ALLOW_PRIVATE=1`; the real peer is a second `src/server.js`, the stub peer is a tiny `http` server that answers `{"greeting":"<img src=x onerror=window.__x=1>"}`. Wall tests use their own server so the replay ring starts empty. Screenshots: `docs/product/hello-overkill/qa/v2-*.png` (22 files, deviceScaleFactor 1).

| Journey | What | Result | Evidence |
|---|---|---|---|
| V2-weather | forecast, determinism, bad place/date errors | PASS | forecast "52% chance of warm regards in Lisbon, with fog lifting to re"; repeat + fresh context identical; bad place -> "Place can be at most 40 characters."; bad date -> "date out of range" |
| V2-wall | anonymised rows, no name, announcements, EventSource closes on route change | PASS | 2 anonymised rows ("A en/formal hello (first-visit milestone)"), no name in DOM or raw stream, status "Live wall connected.", EventSource readyState 2 after leaving, server streamsOpen=0 |
| V2-wall-reconnect | disconnect announcement and re-entry opens a fresh stream | PASS | after server stop wall-status "Reconnecting...", live region "Live wall reconnecting." |
| V2-sla | numbers appear, update, polling stops after leaving | PASS | count 8 -> 15 without reload (2 /api/sla fetches while open); routes GET /healthz, GET /api/weather, GET /; 0 fetches in 11 s after leaving |
| V2-time-machine | min/max, era, streak status, pre-1900 error | PASS | min/max ok (max 2026-11-18); 1987-05-02 era "disco and dial-up dawn"; streak "Day 1 of a 1-day streak for Ada."; unknown name "No streak on record"; 1850-01-01 -> "date before 1900-01-01" |
| V2-haiku | three lines, 5-7-5 verified, 422 for unscannable name | PASS | lines ["Well met, kind Ada","a white sail leans on the wind","waves fold on the sand"] "5-7-5 verified", API [5,7,5]; 日本 -> 422 "name cannot be scanned into a haiku. try the syllables field or a shorter name" |
| V2-federation | health, federated hello, plain-text hostile greeting, notice | PASS | health "2 of 2 peers up", 2 plain-text origins; real peer greeting "Good day, Ada. It is a pleasure to make your acqua"; stub greeting shown literally, 0 img, window.__x undefined |
| V2-federation-down | stopped peer is isolated, others still work | PASS | down row "http://127.0.0.1:43479 Down: refused the connection"; up row "http://127.0.0.1:35593 Up (2 ms)"; hello: "This peer refused the connection." + 1 greeting; POST /hello still exact |
| V2-keyboard | Tab order (8 original first) then More views nav, Enter navigates | PASS | tab order nav-hello>nav-battle>nav-verify>name-input>language-select>tone-select>chaos-toggle>say-hello>nav-weather>nav-wall>nav-sla>nav-time-machine>nav-haiku>nav-federation; focus ring solid 2px; Enter on nav-wall -> #/wall, h1 focused, aria-current; keyboard-only haiku |
| V2-390 | 390px: no horizontal scroll on each new view | PASS | weather-empty:ok weather:ok wall:ok sla:ok time-machine:ok haiku:ok haiku-result:ok federation:ok hello-with-more-nav:ok; more-nav link heights 50,50,50,50,44,44 |
| V2-dark | dark mode for wall and SLA (dark bg, readable, no overflow) | PASS | wall bg rgb(18,18,18) min contrast 7.7; sla bg rgb(18,18,18) min contrast 7.7 |
| V2-CONSOLE | zero console/page errors during v2 (resource-load lines for forced 4xx excluded) | PASS | 0 console/page errors in v2 section |

### v2 defects

None found. All six views behaved per `v2/spec.md` in every check above.

### v2 notes (not failures)
- Existing check UC11 had to be adjusted in the walkthrough (not in src): `getByLabel('Name', {exact:true})` now matches 5 elements because the hidden weather, time-machine, haiku and federation views each have a Name input, so Playwright strict mode threw. The check now narrows to the visible one (`.locator('visible=true').first()`). Behaviour is unchanged; hidden sections are correctly excluded from the accessibility tree.
- The weather "bad place" error shown in the browser is the client-side text "Place can be at most 40 characters." (the input has maxlength 40, which the check removes to reach the 41-char case). The server's 400 `place must be 1-40 characters` is covered by unit tests, not the browser.
- Disconnect copy: after the server stops, the wall shows "Reconnecting..." and announces "Live wall reconnecting." The 503 "Wall is full, try later" state and the 50-row cap were not exercised in the browser.
- Federation health is cached for 5 s on the server, so the stopped-peer check waits 5.3 s before refreshing. SLA polling: 0 `/api/sla` requests in the 11 s after leaving the view.
- Chromium logs "Failed to load resource" lines for forced 400/422 responses (time machine, haiku, weather); these are excluded from the console check as in v1. 0 other console or page errors.
- "More views" nav links are 44 to 50 px tall at 390 px; Tab order is the 8 original stops first, then the six new links.
