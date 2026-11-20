# QA: wiki UI acceptance (checks 1-31)

Run: `node examples/wiki/qa/walkthrough.mjs` (Chromium via Playwright, fresh temp vault and server per check, no trace). Result of the last two full runs: 31 of 31 pass, 5 of them only after an amendment (listed below). Exit code 0. Screenshots are in `docs/product/wiki/qa/` (desktop-1280-note, graph-1280, phone-390-list, phone-390-note, phone-390-graph, dark-1280-note, conflict-banner; all deviceScaleFactor 2).

axe-core was reachable through the package proxy (installed into a temp dir outside the repo, injected with `page.evaluate` because the app's CSP blocks inline script tags). Tags wcag2a, wcag2aa, wcag22aa on home, note, graph, new-note, rename, delete and leave dialogs: zero violations. Check 29's axe part therefore ran as written (axe-core, not `@axe-core/playwright`).

Checks 18 and 21 wall-clock: search over 5,000 notes median 156 ms (limit 500); graph of 1,000 notes ready in 721 ms (limit 3,000).

## Results

| # | Result | Evidence / note |
|---|---|---|
| 1 | amended | Vault holds `.wiki.lock` while running, so "folder empty" as written fails. Corrected: no notes in it. |
| 2-10 | pass | As written. 9 and 10 compared vault and parent directory listings (lock file ignored) and the raw API returned 400 for all four unsafe titles. |
| 11 | amended | Chromium rewrites `/n/%2e%2e` to `/` before the request, so that address lands on Home (no leak). The other four addresses show Note not found. Corrected: normalised address must not leak, and `/api/notes/%2e%2e` and `..` return 404/400 over raw HTTP (they do). |
| 12-13 | pass | |
| 14 | pass | "Copied" is visible once (button label); the second occurrence is the visually hidden `status-live` region, which stays for the whole 1.2 s sampled. Builder deviation is benign. |
| 15 | pass | |
| 16 | amended | Title-only match ("Quarterly plan", body "Goals.") shows the body and no `mark`; this is what J8.1 says, so the check demanding a mark there contradicts the spec. Corrected: mark required only when the body matches (Review has one). |
| 17-25 | pass | 22 first failed in my script (typed into the previous note's editor before the new note loaded); fixed in the script, stable across 3 runs. |
| 26 | pass | Tops: note-list 114 vs note-view 88 (26 px, within 40). Builder's concern about tops does not apply. |
| 27, 28 | pass | |
| 29 | amended | `conflict-banner` itself has no `role`; the message `<p>` inside it has `role=alert` (deliberate, so Copied feedback is not re-announced). Intent met, literal testid table differs. Corrected: exactly one `[role=alert]` inside the banner. Focus stays in the editor, as written. |
| 30 | pass | Light/dark contrast: body 16.9/16.2, save-status 7.6/8.5, meta 7.1/7.6, focus ring 6.3/7.8 (3 px solid), orphan stroke 7.6/8.5, edge 3.6/5.0. All targets at least 24 px; reduced-motion graph static; transition 0s. |
| 31 | amended | An existing note opens on Preview, so Edit is not selected and has `tabindex=-1`; focusing it by script and pressing ArrowRight cycles back to Edit. Corrected: click Edit first, then ArrowRight selects and focuses Preview (passes). |

## Defects

No blocking defects. Low severity:

1. Tabs arrow handler uses the selected tab, not the focused one (`public/js/note-view.js` `tabs` keydown reads `data-tab`). Repro: open an existing note at 390 px, `tab-edit.focus()` by script, press ArrowRight: selection goes to Edit instead of Preview. Not reachable by keyboard alone because the unselected tab has tabindex -1.
2. `conflict-banner` lacks `role="alert"` on the element the testid table names (it is on the inner paragraph). Either update ux.md or move the role.
3. Vault contains `.wiki.lock` while running; ux.md check 1 ("empty") and the J1 text should say so.

## Usability notes (first-time walk, from the screenshots and the check flows)

- Graph: nodes occupy a small cluster in the middle of a large pane (see graph-1280.png); no fit-to-pane scaling, so a small vault looks sparse and labels are small. Worth scaling the layout to the pane.
- Graph ignores links to missing notes (Reading list links to "Missing note", which is not drawn). Correct per spec, but a first-time user may wonder where it went; the text list under the graph does not mention it either.
- Desktop note view has about 90 px of empty space above the title while the sidebar starts at the top; the two panes do not align visually.
- The sidebar "Wiki" h1 is not visible on desktop (no product name on screen).
- Current note in the sidebar is marked only by a left bar and white background; fine for contrast, subtle for a quick glance.
- Rename, search, new-note, link creation and conflict flows were clear; messages matched the copy table.

## List for the builder

- Fix defect 1 (use the event target's tab).
- Decide on defect 2 with the orchestrator (spec or code).
- Consider scaling the graph layout to the pane and listing unresolved links in the graph text list.
- ux.md corrections suggested: check 1 (lock file), check 11 (`%2e%2e` normalisation), check 16 (title-only match has no mark), check 29 (alert role), check 31 (select Edit before ArrowRight).
