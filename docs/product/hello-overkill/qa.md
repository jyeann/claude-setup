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
