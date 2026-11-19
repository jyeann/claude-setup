# Hello Overkill: UX spec

One HTML page served at `GET /` by the same Node process as the API. No framework. All dynamic text is written with `textContent` (never `innerHTML`). Views are switched by hash route, so there is no extra server route for the UI: `#/hello` (default), `#/battle`, `#/verify`, `#/certificate/<id>`. Unknown hash falls back to `#/hello`. `POST /hello` and every other API path stay as in the brief (other non-API paths return 404 JSON).

Assumptions the builder must honour (the architect may rename endpoints, not these UI behaviours):
- The "certificate text" is a single pasteable string (compact JSON with name, greeting, date, signature). One edited character must make verify say Forged.
- Chaos is toggled by the UI checkbox, which adds `?chaos=1` to the greeting request. A chaos request may return 418 or be delayed 2 to 4 seconds. The UI cannot force it, so tests need a deterministic hook: the page also honours `#/hello?chaos=always418` and `?chaos=delay` in the page URL query, passed through to the API (decision for the architect: the server must support `chaos=418` and `chaos=delay` as forced values besides `chaos=1`).

## Journeys

**J1. First visit and first greeting (criteria 1, 3, 4).**
1. Person runs `node src/server.js`, sees the URL printed, opens it.
2. Page shows header, nav, a form: Name, Language, Tone, "Say hello" button, and an empty-state card "No greeting yet. Say hello to someone."
3. Person types "Ada", picks Spanish and Pirate, presses "Say hello" (or Enter in the name field).
4. Button shows "Greeting..." and is disabled while loading. Then the greeting card shows the greeting text containing "Ada", "Visit 1", "Streak 1 day", and a "View certificate" link. Status region announces "Greeting ready for Ada."
5. Focus stays on the Say hello button; the result is announced by the status region, not by moving focus.

**J2. Every language and tone works (criterion 4).** Language select has 10 or more options, tone select 4 or more. Choosing any pair and submitting yields a non-empty greeting.

**J3. Return visit and streak (criterion 5).** Person greets "Ada" again (any case, "ada" counts as the same person). Card shows "Visit 2" and "Streak N days". After the server restarts and they greet "Ada" again, the count continues ("Visit 3").

**J4. Certificate (criterion 6).** From the greeting card the person follows "View certificate". The certificate view shows name, greeting, date (UTC, YYYY-MM-DD), signature, and a read-only box with the certificate text plus a "Copy certificate" button and a "Verify this certificate" link.

**J5. Verify (criterion 7).** Person opens Verify, pastes the certificate text, presses "Verify". Result "Authentic" (success style plus text). They edit one character, press Verify, and see "Forged".

**J6. Battle (criterion 8).** Person opens Battle, sees two greeting buttons (A and B) and the leaderboard. Clicking one records a vote, the leaderboard updates with counts, the vote buttons are replaced by "Thanks, vote counted." and a "Next battle" button, which loads two new greetings.

**J7. Chaos (criterion 9).** Person ticks "Chaos mode". They press Say hello. Sometimes the card shows "The greeter spilled its tea (418)" with a "Try again" button. Pressing it repeats the same request. A success replaces the error. A delayed reply shows the loading state, never a blank screen.

**J8. Rate limit (criterion 10).** After more than 10 hellos in a minute, the next press shows "You've been greeted enough. Please wait N seconds and try again." N comes from the Retry-After header. The button is disabled with a countdown and re-enables at zero. The API returns 429 with Retry-After.

**J9. Core API (criterion 2).** No UI. Covered by node:test; one browser check confirms the page itself is served and an unknown path returns 404 JSON.

**J10. Tests (criterion 11).** No UI. The Playwright checks below cover criteria 1, 3, 5, 6, 7 and 8, plus 9 and 10 as extras.

## Screens and states

Shared shell: `<header>` with title "Hello Overkill", `<nav>` with three links (Hello, Battle, Verify), `<main>` with the current view, a persistent `role="status"` live region (`aria-live="polite"`), and a footer privacy notice: "Practice app. We store only your name, visit counts and dates on this server."

### Hello view (`#/hello`)
Regions: form, chaos checkbox, result card.
- **Empty (first load):** result card text "No greeting yet. Say hello to someone." Name field empty.
- **Validation error:** name blank or whitespace: field gets `aria-invalid="true"`, inline error "Enter a name so we know who to greet.", focus moves to the name field, status announces the same text. Name longer than 40 characters: "Names can be at most 40 characters." (input also has `maxlength=40`.)
- **Loading:** button disabled, label "Greeting...", result card shows "Warming up the greeting..." (`aria-busy="true"`). Delay chaos keeps this state up to 4 s.
- **Success:** card shows greeting, "Visit N", "Streak N day(s)", "View certificate" link. Status: "Greeting ready for <name>."
- **Error 418:** card shows "The greeter spilled its tea (418)." plus "Nothing is broken. Try again in a moment." and a "Try again" button. Focus moves to the Try again button.
- **Other error / network down / 5xx:** "The greeter is having a moment. Check that the server is running, then try again." plus "Try again". No stack traces, no raw JSON, no status body ever displayed.
- **Rate-limited 429:** card "You've been greeted enough. Please wait N seconds and try again." Say hello disabled with live countdown text on the button ("Wait 12s"); it re-enables at 0 and status announces "You can say hello again."
- **Hostile content:** name `<img src=x onerror=alert(1)>` or 40 chars of "W" is shown as literal text (textContent) and wraps (`overflow-wrap:anywhere`), layout intact. Name is trimmed; internal markup is never interpreted.

### Certificate view (`#/certificate/<id>`)
- **Loading:** "Loading certificate..."
- **Success:** heading "Certificate of Hello", rows Name, Greeting, Date, Signature (monospace, wraps), read-only textarea with certificate text, "Copy certificate" (status: "Certificate copied." or, if clipboard is blocked, "Select the text and copy it yourself."), link "Verify this certificate" (goes to `#/verify`). Print stylesheet hides nav and buttons.
- **Not found:** "We could not find that certificate. Go back and say hello again." with a link to Hello.
- **Error:** generic error text as above with "Try again".

### Verify view (`#/verify`)
- **Empty:** labelled textarea "Certificate text", button "Verify", hint "Paste a certificate to check it."
- **Empty submit:** inline error "Paste a certificate first."
- **Loading:** button "Checking...".
- **Authentic:** result box "Authentic" with "This certificate was signed by this server." Style: green plus a check mark glyph and the word, never colour alone.
- **Forged:** result box "Forged" with "The signature does not match. The certificate was changed or was not made here." Style: red plus a cross glyph and the word.
- **Unreadable text** (not JSON, missing fields): treated as Forged with the line "This is not a readable certificate." (no 400 shown to the user).
- **Error / 429 / 418:** same generic messages as Hello view.
- **Hostile:** a 100 KB paste is accepted up to 10,000 characters; above that, "That is too long to be a certificate (10,000 characters max)."

### Battle view (`#/battle`)
Regions: two vote buttons, leaderboard table.
- **Loading:** "Finding two greetings..." and an empty leaderboard "Loading leaderboard...".
- **Ready:** two buttons "Vote for A: <greeting>" and "Vote for B: <greeting>".
- **Voted:** buttons removed, status "Vote counted for <greeting>.", leaderboard refreshed, "Next battle" button gets focus.
- **Empty leaderboard:** "No votes yet. Cast the first one."
- **Leaderboard:** table with up to 10 rows: rank, greeting, votes. Caption "Top 10 greetings".
- **Error:** "Could not load the battle. Try again." with "Try again". A failed vote keeps the buttons and shows "Your vote was not saved. Try again."
- **Long text:** greetings wrap inside buttons and cells.

## Copy

| Where | Text |
|---|---|
| Title | Hello Overkill |
| Nav | Hello, Battle, Verify |
| Labels | Name, Language, Tone, Certificate text, Chaos mode (sometimes the greeter misbehaves) |
| Primary button | Say hello |
| Loading button | Greeting... |
| Empty card | No greeting yet. Say hello to someone. |
| Visit line | Visit N |
| Streak line | Streak N day / Streak N days |
| Certificate link | View certificate |
| Retry | Try again |
| 418 | The greeter spilled its tea (418). Nothing is broken. Try again in a moment. |
| 429 | You've been greeted enough. Please wait N seconds and try again. |
| Generic error | The greeter is having a moment. Check that the server is running, then try again. |
| Name blank | Enter a name so we know who to greet. |
| Verify results | Authentic / Forged |
| Battle | Vote for A, Vote for B, Next battle, Thanks, vote counted. |
| Privacy | Practice app. We store only your name, visit counts and dates on this server. |

Languages (at least 10): English, Spanish, French, German, Italian, Portuguese, Dutch, Swedish, Japanese, Swahili. Tones (at least 4): Formal, Pirate, Shakespearean, Corporate. Default: English, Formal.

## Accessibility and responsive rules

- Every input has a visible `<label for>`; the select and checkbox are native elements. No placeholder-only labels.
- Tab order follows visual order: nav links, name, language, tone, chaos checkbox, Say hello, result links/buttons. Enter in the name field submits. All controls reachable and operable by keyboard; visible focus ring (2px outline, 3:1 against background).
- One persistent `role="status"` region (`data-testid="status"`, `aria-live="polite"`, `aria-atomic="true"`) announces: greeting ready, errors, verify result, vote counted, copy result, countdown finished. Do not announce every countdown tick.
- Focus rules: validation error focuses the field; 418 or error focuses Try again; after a vote focus goes to Next battle; route change moves focus to the view's `<h1>` (tabindex -1). Success of a greeting leaves focus on the button.
- Page language `lang="en"`; greeting element carries a `lang` attribute for the chosen language (es, fr, ...).
- Colour: use CSS custom properties with `prefers-color-scheme` for light and dark; text contrast at least 4.5:1 in both. Authentic and Forged use icon plus word as well as colour.
- `prefers-reduced-motion`: no animation beyond opacity.
- Responsive: single column; at 390px wide there is no horizontal scroll, controls are full width, touch targets at least 44px tall, the Battle options stack vertically, the leaderboard table stays a table with wrapping text, signature text wraps (`overflow-wrap:anywhere`).
- Use `<main>`, `<nav aria-label="Primary">`, one `<h1>` per view, `aria-current="page"` on the active nav link.

## Selector table

Shared by builder and QA. `data-testid` is the contract; ids are given where the label needs `for`.

| # | data-testid | Element and id | Meaning |
|---|---|---|---|
| 1 | `nav-hello` | link | Nav to Hello |
| 2 | `nav-battle` | link | Nav to Battle |
| 3 | `nav-verify` | link | Nav to Verify |
| 4 | `status` | div role=status | Live region |
| 5 | `name-input` | input `#name` | Name field |
| 6 | `language-select` | select `#language` | Language picker |
| 7 | `tone-select` | select `#tone` | Tone picker |
| 8 | `chaos-toggle` | checkbox `#chaos` | Chaos mode |
| 9 | `say-hello` | button | Submit |
| 10 | `name-error` | p | Inline name validation message |
| 11 | `result-empty` | div | Empty-state card text |
| 12 | `result-loading` | div | Loading text |
| 13 | `greeting-text` | p | Greeting text |
| 14 | `visit-count` | span | "Visit N" |
| 15 | `streak-count` | span | "Streak N day(s)" |
| 16 | `cert-link` | a | "View certificate" |
| 17 | `error-message` | div | Friendly error text (418, generic) |
| 18 | `retry-btn` | button | Try again |
| 19 | `rate-limit-message` | div | 429 message |
| 20 | `cert-name` | dd | Certificate name |
| 21 | `cert-greeting` | dd | Certificate greeting |
| 22 | `cert-date` | dd | Certificate date |
| 23 | `cert-signature` | dd | Signature |
| 24 | `cert-text` | textarea readonly | Pasteable certificate text |
| 25 | `cert-copy` | button | Copy certificate |
| 26 | `cert-verify-link` | a | Go to Verify |
| 27 | `verify-input` | textarea `#cert-input` | Paste box |
| 28 | `verify-btn` | button | Verify |
| 29 | `verify-result` | div | Text exactly "Authentic" or "Forged" in its heading child `verify-verdict` |
| 30 | `verify-verdict` | strong inside `verify-result` | Verdict word |
| 31 | `battle-option-a` | button | Greeting A |
| 32 | `battle-option-b` | button | Greeting B |
| 33 | `battle-next` | button | Next battle |
| 34 | `leaderboard` | table | Top 10 |
| 35 | `leaderboard-row` | tr (repeated) | Row; cells `lb-greeting` and `lb-votes` |
| 36 | `lb-greeting` | td | Row greeting |
| 37 | `lb-votes` | td | Row vote count |
| 38 | `view-title` | h1 | Current view heading |

Table size: 38 selectors.

## UI acceptance checks

Environment: server started with a temp data file and `HELLO_SIGNING_SECRET=test`, base URL `http://localhost:<port>`. Each check starts with a fresh data file unless it says otherwise. Use `getByTestId` throughout.

**UC1 (criterion 1: page and controls).**
1. Goto `/`. Expect `view-title` visible, `name-input`, `language-select`, `tone-select` and `say-hello` visible; `say-hello` has text "Say hello".
2. Expect `result-empty` has text "No greeting yet".
3. Expect `language-select option` count >= 10 and `tone-select option` count >= 4 (criterion 4 structure).

**UC2 (criterion 3: Ada, Spanish, Pirate).**
1. Fill `name-input` "Ada". Select language "Spanish", tone "Pirate". Click `say-hello`.
2. Expect `greeting-text` visible and containing "Ada", and not empty.
3. Expect `greeting-text` to have `lang="es"`.
4. Expect `status` contains "Greeting ready for Ada".
5. Expect `cert-link` visible and enabled (the created thing is usable).

**UC3 (criterion 4: every combination).**
1. For each language option and each tone option: select, fill "Ada", click `say-hello`, expect `greeting-text` non-empty (text length > 0). Calls in a loop of at least 40 would trip the limit (10 per minute), so this check uses the API in node:test for all combinations and the browser samples 5 combinations at most per minute, or starts the server with the rate limit raised by env var (`HELLO_RATE_LIMIT`, architect to provide).

**UC4 (criterion 5: visit 2 and restart).**
1. Greet "Ada" (English, Formal). Expect `visit-count` "Visit 1", `streak-count` contains "Streak 1".
2. Greet "ada" again. Expect `visit-count` "Visit 2" and `streak-count` non-empty.
3. Restart the server process with the same data file; reload `/`.
4. Greet "Ada". Expect `visit-count` "Visit 3".

**UC5 (criterion 6: certificate).**
1. Greet "Ada". Click `cert-link`.
2. Expect URL hash to match `#/certificate/`, `view-title` contains "Certificate".
3. Expect `cert-name` "Ada", `cert-greeting` equals the earlier greeting text, `cert-date` matches `^\d{4}-\d{2}-\d{2}$`, `cert-signature` non-empty (at least 32 chars).
4. Expect `cert-text` non-empty and `cert-verify-link` visible.

**UC6 (criterion 7: Authentic then Forged).**
1. Greet "Ada", click `cert-link`, read the value of `cert-text` into `T`.
2. Click `nav-verify`. Fill `verify-input` with `T`. Click `verify-btn`.
3. Expect `verify-verdict` text equals "Authentic" and `status` contains "Authentic".
4. Replace one character in `T` inside the greeting (for example the first "A" to "B") to make `T2`. Fill `verify-input` with `T2`, click `verify-btn`.
5. Expect `verify-verdict` text equals "Forged".
6. Empty `verify-input`, click `verify-btn`. Expect `status` contains "Paste a certificate first."

**UC7 (criterion 8: battle).**
1. Click `nav-battle`. Expect `battle-option-a` and `battle-option-b` visible with different non-empty text, and `leaderboard` visible with the empty message (fresh data).
2. Click `battle-option-a`. Expect `status` contains "Vote counted".
3. Expect `leaderboard-row` count 1 or more, the first `lb-votes` text "1", and `lb-greeting` matches the voted greeting.
4. Expect `battle-option-a` and `battle-option-b` not visible; `battle-next` visible and focused.
5. Click `battle-next`. Expect two new options visible. Click `battle-option-b`. Expect the sum of all `lb-votes` equals 2.

**UC8 (criterion 9: chaos 418 and retry).**
1. Goto `/?chaos=418`. Check `chaos-toggle`. Fill "Ada", click `say-hello`.
2. Expect `error-message` contains "The greeter spilled its tea (418)". Expect `retry-btn` visible and focused. Expect page text does not contain "at " stack frames, "Error:" or "{".
3. Goto `/?chaos=delay`. Click `say-hello`. Expect `result-loading` visible within 500 ms, and `say-hello` disabled. After the response (timeout 6 s) expect `greeting-text` visible.
4. With the mixed `chaos=1` flag: repeat clicking `retry-btn` or `say-hello` up to 20 times (rate limit raised) until `greeting-text` shows; expect never an empty `main` and never an uncaught page error (`page.on('pageerror')` count 0).
5. Using `chaos=418`, intercept the first request with `page.route` to return 418 and the second to continue with no chaos: click `retry-btn`, expect `greeting-text` visible and `error-message` gone.

**UC9 (criterion 10: rate limit).**
1. Greet "Ada" 11 times quickly (default limit). Expect the 11th shows `rate-limit-message` containing "You've been greeted enough" and a number of seconds, and `say-hello` disabled.
2. Check by `page.request.post('/hello')` that the status is 429 and header `retry-after` is a positive integer.
3. After the countdown (or with `page.clock` fast-forward) expect `say-hello` enabled and `status` contains "You can say hello again."

**UC10 (criterion 2 in browser, and hostile input).**
1. `page.request.post('/hello')` with no body: status 200, content-type contains `application/json`, body text exactly `{"message":"Hello World! Welcome to the API."}`.
2. `page.request.get('/nope')`: status 404, JSON body.
3. Greet with name `<img src=x onerror=window.__x=1>`. Expect `greeting-text` contains that literal text and `window.__x` is undefined. Expect no horizontal overflow at 390px viewport (`document.documentElement.scrollWidth <= innerWidth`).
4. Submit a blank name. Expect `name-error` "Enter a name so we know who to greet." and `name-input` focused.

**UC11 (accessibility and keyboard).**
1. Tab from page start: order reaches `nav-hello`, `nav-battle`, `nav-verify`, `name-input`, `language-select`, `tone-select`, `chaos-toggle`, `say-hello`.
2. Fill the name via keyboard and press Enter. Expect `greeting-text` visible.
3. Expect `status` has `role="status"`. Each of `name-input`, `language-select`, `tone-select`, `verify-input` has an accessible name (`getByLabel` finds it).
4. Emulate `colorScheme: 'dark'` and then `'light'` at 390x844: page renders with no overflow and `say-hello` has visible text in both.

Criteria coverage: 1 UC1, 2 UC10, 3 UC2, 4 UC1 and UC3, 5 UC4, 6 UC5, 7 UC6, 8 UC7, 9 UC8, 10 UC9, 11 (the walkthrough is UC1, UC2, UC4, UC5, UC6, UC7; `npm test` itself is not a UI check).
