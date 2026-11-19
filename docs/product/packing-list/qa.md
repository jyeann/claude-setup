# QA walkthrough: packing-list

Defects: BLOCKER 0, MAJOR 1, MINOR 5, COSMETIC 2

## How I walked

- Read only `brief.md` and `ux.md`. Did not read tests, acceptance, journeys or source before walking (after the walk I looked at `src/server.js` once, only to understand defect D1).
- Real Chromium via Playwright from Node scripts in `/tmp/claude-0/-home-user-claude-setup/b44ccfab-4551-590d-a034-f2affe6fb51d/scratchpad/qa/` (`shots.js`, `long.js`, `a.js`, `b.js`, `c.js`, `d.js`, `e.js`, `g.js`). Each script spawned `PORT=<43xx> DATA_FILE=<scratchpad file> node src/server.js` and stopped it with SIGTERM at the end.
- Viewports: 1280x800 and 375x667 (screenshots, deviceScaleFactor 1), 320x568 (overflow and target sizes), 640x400 at DPR 2 (200% zoom stand-in), dark mode (`colorScheme: 'dark'`), JavaScript disabled context.
- Two browser contexts for "share link into a second browser"; two pages in one context for the "two tabs" case.
- I looked at the screenshots: home, home with error, empty list, partly ticked, long text, not-found, desktop and phone. Layout is a single clean column, nothing clipped or overlapping, share link and Copy sit directly under the title.
- Not checked: real screen reader, real mobile browser, real browser zoom (I used a 640px-wide viewport at 2x and a 200% root font size instead), clipboard paste of rich text from another app (I used `insertText`).

## Success criteria

| SC | Result | Evidence |
|---|---|---|
| SC1 | Met | Server printed `Packing list running at http://localhost:<port>`. Home shows h1 "Packing list", explainer, "New packing list" form, "Trip name", "Create list". No sign-in anywhere (`desktop-home.png`). |
| SC2 | Met | "Lisbon weekend" (typed with surrounding spaces, shown trimmed) opens `/l/<id>`; h1, "No items yet", "0 of 0 packed", full URL in read-only "Share link" with Copy (`desktop-list-empty.png`). Focus landed on `#list-title`. |
| SC3 | Met | Empty and whitespace-only name: "Enter a trip name." with role alert, URL stays `/`. 81 chars: "Trip name is too long (81 characters). The limit is 80." and text kept (`desktop-home-error.png`). |
| SC4 | Met | Added Passport etc. at once, count updates. Empty and spaces: "Enter an item to add."; 121 chars: "Item is too long (121 characters). The limit is 120."; 120 chars accepted. 200 items added, 201st: "This list is full (200 items)", count stayed 200, typed text kept; removing one allowed another add. |
| SC5 | Met | Tick and untick update progress; state survived reload (15 of 15 packed after fast ticking, reload showed the same, apart from D1 intermittent failure). |
| SC6 | Met | Second context showed same items and ticks. Add appeared in the other browser after about 2.0 s; tick synced (checked: "1 of 3 packed" after the other context ticked; my first timing assertion was wrong, not the app); remove about 0.35 s. |
| SC7 | Met | Remove in browser 2 vanished from browser 1 within 0.35 s, progress matched. |
| SC8 | Met | List name `<b>hi</b>` shows literally in h1 and title; item `<b>hi</b>` and `<script>alert(1)</script>` show literally, `#items b` count 0, no script ran. |
| SC9 | Met | Stopped and restarted with the same DATA_FILE; items and tick states intact, new add worked and persisted after reload. |
| SC10 | Met | Mistyped id, `/l/short`, `/l/` all show "List not found" with "Create a new list" (HTTP 404). First-use journey (create, 8 items, share, tick in both) finished well under 3 minutes with no docs needed. Caveat: see D1 and D5. |

## What the scripted journeys miss

### D1. MAJOR: list page intermittently loads with a broken script (shows "0 of 0 packed" for a list that has items)
- Steps: create a list with items, close the tab. Wait about 5 seconds (5.3 s in my run; the keep-alive timeout window), then open the list link again. Happened 1 in 12 tries in `d.js` and in 2 of 3 runs of the `a.js` flow (15-item list, reload a few seconds after heavy ticking in another tab).
- Expected: list loads normally.
- Happened: the request for `/assets/js/logic.js` got `400` with a JSON body (`application/json`), the browser refused to run it ("Refused to execute script ... MIME type"), a `pageerror: Cannot read properties of undefined (reading 'progressText')` fired, and the page showed "0 of 0 packed", empty share link, no items and no error message. To a user this looks like the list was lost. Reload fixes it. The 400 body matches the `clientError` handler in `src/server.js`, which answers a 400 on a connection that the server and browser are racing to reuse or close.
- Screenshot: none (I did not capture the broken state; log evidence only).
- Fix idea: in `clientError`, do not write a response for ECONNRESET or when the socket has no pending request; only answer 400 for real parse errors. Also make the page show a visible error if scripts fail to load.

### D2. MINOR: stale "Could not save that change. Try again." stays after the server comes back
- Steps: open a list, stop the server, tick an item (reverts, message shown), add an item, restart the server, wait 4 s.
- Expected: the message clears once polling succeeds ("clears on the next success" per ux.md for connection messages).
- Happened: items and progress recovered by themselves, but the save-failure message was still in `#status` 4 s after restart. Typed text "While down" was kept in the field (good). No data lost.

### D3. MINOR: a failed add shows the same message twice
- Steps: server stopped, type an item, press Enter.
- Happened: "Could not save that change. Try again." appears both as the red alert under the field and as the grey status text below it (`/tmp/.../qa/down2.png`, not in the repo). Redundant, and the wording does not say that the item was not added.

### D4. MINOR: trailing slash on a list link shows "List not found"
- Steps: open `<share link>/`.
- Expected: the list (people often add a slash when pasting).
- Happened: 404 "List not found".

### D5. MINOR: with JavaScript disabled both pages are silently dead
- Steps: open `/` with JS off, type a name, press Enter.
- Happened: the page reloads at `/?name=NoJS`; no list is created and no message appears. A list page with JS off shows an empty share link, "0 of 0 packed" and "No items yet" even when the list has items, which is misleading. Expected: a `<noscript>` message saying the app needs JavaScript. JS-off is outside the brief, so MINOR.

### D6. MINOR: adding the same item twice is allowed
- Steps: add "Dbl" twice.
- Happened: two "Dbl" rows. Not a spec violation (the brief is silent); possibly desirable. Recorded as an observation.

### D7. COSMETIC: unchecked checkbox in dark mode is a filled grey square
- Steps: open a list with `prefers-color-scheme: dark`. Unchecked boxes look filled and could be misread as checked at a glance until the strikethrough and tick are compared. I did not view a ticked row in dark mode.

### D8. COSMETIC: share link field truncates on phone
- Steps: open a list at 375px. The read-only field shows only about 25 characters of the link (`phone-list-long.png`). Select and Copy still work, but you cannot see the full link without scrolling inside the field.

### Not defects, checked
- Double-click Add and Enter twice: one item each time (no duplicates).
- Text with leading and trailing spaces is saved trimmed; a tab became a space; a newline became a space (`insertText` of "pasted\nline two" gave "pasted line two").
- Emoji and Arabic/Hebrew text saved and survived reload. They render in a left-to-right row (`direction: ltr`), so RTL text is aligned left; only checked via computed style, not a visual RTL review.
- Very long words (120 `A`, 80 `W` as trip name) wrap; no horizontal scroll at 375 or 320 (scrollWidth equals clientWidth) (`phone-list-long.png`).
- Keyboard only: Tab order skip link, Trip name, Create list; on a list share link, Copy, New item, Add, then checkbox and Remove per row. Enter creates and adds, Space ticks, Enter on Remove removes and focus goes to New item. Focus after create is the h1. Focus ring visible.
- Back button: after creating a list, Back goes to `/` with an empty field and Forward returns to the list. After an error nothing is pushed to history (Back leaves the page, as expected).
- Two tabs in one browser editing at once: both ended with 14 items, nothing lost. A half-typed item in tab 1 stayed intact and focused while tab 2 added items.
- Ticking 15 items as fast as possible: "15 of 15 packed" in both tabs.
- Zoom (640px wide at 2x, and root font 200%): no horizontal scroll, layout stays single column (`zoom.png` kept only in scratchpad).
- Console: only expected 404s for the not-found page and `ERR_CONNECTION_REFUSED` while the server was down, plus the D1 errors.
- Checkbox element is 24x24 px visually; buttons are 44 px high. I did not measure the row label hit area, so the 44x44 target rule is not confirmed for checkboxes.

## Worked well

- Create, add, share and tick needs no explanation; the share link and Copy are the first thing under the title and Copy gives "Copied" plus status text and really put the URL on the clipboard.
- Validation messages are exact, inline, and keep the typed text; focus returns to the field.
- Sync between browsers was well within 5 s (add about 2 s, remove about 0.35 s).
- Server down: the page shows "Connection lost. Trying again...", ticks revert instead of lying, typed text stays, and after restart the page picked up again by itself with no lost data.
- 200-item cap, 120 and 80 character limits behave as written; reload shows persistence.
- Markup is always shown literally.
- Long text wraps; layout holds at 320px, at 200% zoom and in dark mode; contrast looked fine.
- Calm, consistent visual design; strikethrough plus checkmark, not colour alone.

## Screenshots (`docs/product/packing-list/screenshots/`)

`desktop-home.png`, `desktop-home-error.png`, `desktop-list-empty.png`, `desktop-list-ticked.png`, `desktop-list-long.png`, `desktop-not-found.png`, `phone-home.png`, `phone-home-error.png`, `phone-list-empty.png`, `phone-list-ticked.png`, `phone-list-long.png`, `phone-not-found.png`.

## Fix round after this walkthrough (added by the orchestrator, not by the QA agent)

The defects went back to a builder (round trip 1 of 3). Status after the fix round, with the full gate green again (175/175 tests, hidden tests 25/25, journeys 25/25, mutation 8/8):

| Defect | Status | Evidence |
|---|---|---|
| D1 (MAJOR) broken list page after an idle connection | Fixed | Only a malformed request now gets a 400; a timed-out or idle connection is closed with no bytes; `keepAliveTimeout` 3 s is below the 5 s headers timeout. The builder could not reproduce the failure on the old code with a raw socket, so the root cause is inferred, not proven. Orchestrator soak on the fixed code: 60 idle-then-reload page loads over 6 pages, 0 broken, 531 responses all 200 (before the fix QA saw 1 broken load in 12) |
| D2 stale "Could not save" message after recovery | Fixed | cleared on the next successful poll; no automated test (client DOM code) |
| D3 failed add shows its message twice | Fixed defensively | the builder found no path that wrote it to the status line; a failed add now clears the status line. Not re-walked |
| D5 nothing shown with JavaScript off | Fixed | `<noscript>` notice on the home and list pages |
| D7 dark-mode checkboxes | Fixed | custom checkbox; orchestrator looked at a dark-mode screenshot after the fix: empty boxes are outlined, the ticked one is filled with a tick |
| D4 trailing slash gives "List not found" | Not changed | specified behaviour (design.md pages, rule R6) |
| D6 duplicate items allowed | Not changed | specified behaviour (rule R26) |
| D8 share field shows about 25 characters at 375 px | Not changed | the Copy button is next to the field; backlog |

Not re-done after the fixes: a second independent walkthrough. The screenshots in `screenshots/` are from before the fix round.
