# TASKS: packing-list

Product folder: `examples/packing-list/` (plain JS, Node 22, node:test, zero runtime deps), laid out like `examples/retro-board/`. Sources: `docs/product/packing-list/brief.md` (SC1-SC10), `ux.md` (J1-J10, UC1-UC15), `design.md` (R1-R44).

## T1: Test-author pack: spec, acceptance, hidden holdout, journeys, gate config
- type: AFK
- blocked-by: none
- status: done

Scope: `examples/packing-list/spec.md`, `acceptance/helpers.js`, `acceptance/api.acceptance.test.js`, `acceptance/pages.acceptance.test.js`, `holdout/holdout.test.js` (hidden from builder), `journeys/` (one browser journey per J1-J10 plus UC1-UC15 checks), `verify.config.json`
Delivers: executable contract for SC1-SC10, J1-J10, UC1-UC15 and R1-R44. Tests boot the app with `createApp({dataFile})` or by running `node src/server.js` with PORT=0 and a temp DATA_FILE.
Done when: every J and UC id and every R id is referenced by at least one test. The tests run and fail with a clear reason (app missing), not a syntax error. `verify.config.json` turns on tests, 80% line coverage of `src/`, test quality, holdout, journeys and the mutation spot-check. After this task, `acceptance/` and `holdout/` are read-only.

## T2: Walking skeleton: start the app and see the home page
- type: AFK
- blocked-by: T1
- status: done

Scope: `package.json`, `README.md`, `.gitignore` (`data/`), `src/server.js`, `src/router.js`, `src/http.js`, `public/index.html`, `public/not-found.html`, `public/app.css`, `tests/http.test.js`, `tests/router.test.js`
Delivers: SC1 and J1 (the "Packing list running at http://localhost:<port>" line). Static home page with the form but no JS yet. 404 page for unknown paths (J10.1, UC7 for `/l/nope`). UC1, UC14 for `/` and the 404 page. R1-R4, R6-R9, R32 (pages), R33, R44.
Done when: `npm start` prints the address. `GET /` returns 200 HTML and `/l/nope` returns 404 HTML, both with all security headers. Traversal paths return 404. SIGTERM exits 0. Unit tests pass.

## T3: Create a list end to end (API, persistence, home JS, list shell)
- type: AFK
- blocked-by: T2
- status: done

Scope: `src/ids.js`, `src/validation.js`, `src/lists.js` (createList, toView, DomainError), `src/store.js` (load, create, get, writeAtomic), router routes for POST `/api/lists`, GET `/api/lists/:id` and `/l/:id`, `public/js/api.js`, `public/js/logic.js` (checkName), `public/js/home.js`, `public/list.html`, `public/js/list.js` (load, h1, share link, Copy, empty state, progress), tests for ids, validation, lists, store and logic
Delivers: SC2, SC3, J2, J3, UC4, UC6, UC13, UC14 (list page), J10.2. R5, R10-R16, R17 (names), R18-R21, R35, R37, R38, R40, plus body cap and content-type handling.
Done when: entering "Lisbon weekend" opens `/l/<22-char id>` showing "No items yet" and "0 of 0 packed". The Share link field equals the page URL. Pressing Copy shows "Copied" and the status says "Link copied". An empty or 81-character name shows the alert and creates no list. Focus moves to the h1 after create and back to the field after an error. The matching acceptance tests pass.

## T4: Add items, enforce limits, show text literally
- type: AFK
- blocked-by: T3
- status: done

Scope: `src/lists.js` (addItem, MAX_ITEMS), router POST `/api/lists/:id/items`, `public/js/logic.js` (checkItem, progressText, mergeItems), `public/js/list.js` (add form, optimistic add, `#form-error`, aria-invalid), tests
Delivers: SC4, SC8, J4, J8, UC3, UC5, UC8, UC10, UC12. R17 (items), R22-R26, R27 (insertion order), R34, R43.
Done when: after adding "Passport" it shows unticked, progress reads "0 of 1 packed", and focus is in `#new-item`. An empty item, a 121-character item and a 201st item are each refused with the exact message in a role alert, and the count stays the same. `<b>hi</b>` appears as literal text with no `b` element. `tests/public-safety.test.js` finds no innerHTML or inline script/style.

## T5: Tick and untick with progress bar, kept after reload
- type: AFK
- blocked-by: T4
- status: done

Scope: `src/lists.js` (setTicked), router PUT `.../items/:itemId/ticked`, `public/js/list.js` (checkbox, strikethrough, progressbar aria values, optimistic tick with revert), `public/app.css`, tests
Delivers: SC5, J5, UC9. R28, R29, R31 (PUT), the save-failure revert from design section 7.
Done when: ticking one of two items shows "1 of 2 packed" with aria-valuenow 1 and aria-valuemax 2. Ticking the same state twice returns 200 with no change. After a reload the tick state is unchanged. A failed save reverts the checkbox and shows "Could not save that change. Try again." in `#status`.

## T6: Remove an item
- type: AFK
- blocked-by: T4
- status: done

Scope: `src/lists.js` (removeItem), router DELETE `.../items/:itemId`, `public/js/list.js` (Remove button named "Remove <text>", focus to `#new-item`, 404 item_not_found treated as done), tests
Delivers: SC7 (single browser), J7.1, J7.3, UC11. R23, R27 (order after removal), R30, R31 (DELETE).
Done when: pressing Remove on "Charger" takes it out of `ul#items`, progress updates, and focus is in `#new-item`. Removing the same item a second time returns 404 item_not_found. Item ids are never reused after removal.

## T7: Live sync across browsers by polling
- type: AFK
- blocked-by: T5, T6
- status: done

Scope: `public/js/list.js` (setTimeout poll chain every 2000 ms, merge by item id), `public/js/logic.js` (mergeItems plan), `tests/logic.test.js`
Delivers: SC6, SC7 (second browser), SC10 first-use run, J6, J7.2, J8.3, J10.3. Shows "Connection lost. Trying again..." when a request fails. If a poll gets list_not_found, the page switches to the not-found content. R41, R42.
Done when: in the two-browser journeys, adds, ticks, unticks and removals appear in the other browser within 5 seconds. A poll never changes the text being typed, the error message or focus. Polls never overlap. Unit tests cover the merge planner: add, remove, reorder, and rows with a pending write.

## T8: Restart survival, storage failures, LAN option
- type: AFK
- blocked-by: T3
- status: done

Scope: `src/store.js` (corrupt file moved aside, leftover tmp files deleted, MAX_LISTS limit, write failure leaves memory unchanged), `src/server.js` (HOST, EADDRINUSE, LAN warning), `README.md`, `tests/store.test.js`, `tests/server.test.js`
Delivers: SC9, J9. R2, R35-R39, R40 (Host check on loopback), storage_full and storage_error responses.
Done when: the J9 restart journey shows "1 of 2 packed" after the restart. A corrupt data file is renamed `.corrupt-<ms>` and the app starts empty. A simulated write failure returns 503 and the file and memory are unchanged. A port already in use exits 1 with the documented message.

## T9: Accessibility and responsive polish
- type: AFK
- blocked-by: T5, T6
- status: done

Scope: `public/*.html` (skip link, `#main` with tabindex -1, `lang`, labels), `public/app.css` (44px targets, focus outline, wrapping, dark mode, reduced motion), `tests/public-a11y.test.js`
Delivers: UX accessibility rules. UC2, UC14, UC15. Long-text handling for J8 and the 320px layout. Busy Create button uses aria-disabled.
Done when: UC2 and UC15 pass at 320px with a 120-character unbroken item and an 80-character trip name. The skip link is the first Tab stop. The a11y unit test passes.

## T10: Review-fix
- type: AFK
- blocked-by: T7, T8, T9
- status: done

Done when: code-reviewer and security-reviewer pass over T2-T9; fix all CRITICAL and HIGH findings.

## T11: QA
- type: AFK
- blocked-by: T10
- status: done

Done when: run the full verify gate (tests, coverage of 80% or more, test quality, holdout, journeys, mutation spot-check) and write the QA report.

## T12: Release
- type: AFK
- blocked-by: T11
- status: todo

Done when: final README check, CHANGELOG entry, commit on the feature branch (no pull request in this run: orchestrator decision D12).


## Risks and order
- Order: T1, then T2, then T3. After T3, T4 and T8 can run in parallel. T5 and T6 can run in parallel after T4. T7 and T9 come after T5 and T6. Then T10, T11, T12.
- Shared-file conflicts: T4, T5, T6 and T7 all edit `public/js/list.js`, `src/lists.js` and `src/router.js`. Merge them one at a time, or keep each in its own function block.
- Hidden holdout: build from design.md's exact messages and status codes (R10), not from the visible tests alone.
- Flaky timing in journeys: use the 2 s poll with a 5 s wait and never fixed sleeps. Each test uses its own DATA_FILE and PORT=0.
- Coverage: `src/` runs inside the test process via `createApp`, so its lines count toward coverage. Test client code through the pure `public/js/logic.js`.
- The mutation spot-check is most likely to catch edges in validation, item-id handling and the store; unit tests must assert the boundaries 80/81, 120/121 and 200/201.
