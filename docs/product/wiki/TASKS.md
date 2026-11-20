# Tasks: wiki (examples/wiki/)
Paths are relative to `examples/wiki/`. Specs: `docs/product/wiki/{brief,ux,design}.md` and `examples/wiki/spec.md` (the spec wins).

These slices are a build order, not separate verify gates. The acceptance tests exist from the start, so verify stays red until S is done (HTTP suites) and then through P (browser walkthrough). Write unit tests first within each slice.

Builder S owns all of `src/`, `public/js/titles.js`, `public/js/wikilink.js` and the minimal `public/index.html` the HTTP tests need, and must go green over HTTP alone. Builder P then owns the rest of `public/` (UI per ux.md) and builds against the real API.

| Slice | Title | Group | Blocked by | Owner | Done when |
|---|---|---|---|---|---|
| T1 | Boot and shell: package.json (ESM), config, HOST check, ready line, vault mkdir and realpath, lock, tmp cleanup, signals, EADDRINUSE; http.js static allow-list, SPA fallback, security headers; router with Host check, 404 `not_found`, 405 + Allow | S | - | builder S | Ready line with PORT=0; `GET /` and `/n/x` return the shell with CSP; `/api/x` 404; OPTIONS 405; bad Host 403; second server exits 1 |
| T2 | Titles and note CRUD: `titles.js` (all rules and exports), `revision.js`, vault.js (titleToPath, scan, atomic write, no-clobber create via link), list, create, get, put (428/412), delete; body limits 413/415/400; traversal 404s | S | T1 | builder S | Spec CRUD rows and title rules pass; `..%2Fsecret` variants 404; file bytes equal sent content; unit tests for every title rule and order |
| T3 | Links and index: `wikilink.js` (scanCode, parseWikilinks, rewriteWikilinks), index.js (entries, byKey, backlinks, stat-scan freshness), backlinks and graph endpoints | S | T2 | builder S | Backlinks and graph match spec; code-region links ignored; external add/change/delete visible without restart; shared-module import tests pass |
| T4 | Rename: rename.js (move without clobber, case-only via tmp, rewrite every note, updated/failed) | S | T3 | builder S | SC4 tests: labels preserved, code untouched, 409 leaves all bytes unchanged, identical title is a no-op |
| T5 | Search: search.js (ordering, snippet window, ranges, regex fallback, title-only snippet), `/api/search` | S | T3 | builder S | Search tests pass incl. `<b>` and missing q 400; 5,000-note median under 300 ms |
| T6 | Hardening: Origin and Sec-Fetch-Site, streamed byte cap and destroy, flat-object check, timeouts, symlink/dotfile/subfolder/`.MD`/duplicate-key/8 MiB/invalid-UTF-8 handling, 500 `internal`, uncaughtException; graph perf | S | T4, T5 | builder S | All HTTP acceptance suites green; coverage at least 80% on src/ and shared modules; 1,000-note graph under 1 s |
| T7 | App shell and list: index.html landmarks and skip link, app.css themes, api.js, router.js (routes, titles, focus), live.js, note list, empty vault, new note dialog, not-found, app-error/retry | P | T6 | builder P | ux checks 1, 2, 9, 11, 25 (first half), 26 pass; all ux.md testids present in served HTML/JS |
| T8 | Note view: editor, Save and Ctrl+S, clean/dirty/saving/conflict/error states, conflict banner, save-error, note-gone, leave guard, delete dialog | P | T7 | builder P | ux checks 3, 13-15, 23-25 pass |
| T9 | Preview and links: markdown.js (allow-list DOM builder, heading shift, scheme allow-list), wikilinks exists/missing/invalid, create on click (409 opens `existing`), backlinks panel; no-innerHTML unit scan | P | T8 | builder P | ux checks 4-6, 12, 22 pass; markdown unit tests with a fake DOM |
| T10 | Rename dialog and search UI: rename (dirty guard, case-only, partial copy), search box (120 ms debounce, abort, marks from ranges, Ctrl+K, Escape, clear, status) | P | T9 | builder P | ux checks 7, 8, 10, 16, 17, 18 pass |
| T11 | Graph: layout.js (pure, deterministic, grid repulsion, 300 iterations, ready after 60 iterations or 1 s, reduced motion), graph.js (SVG, hit circles, labels rule, keyboard), graph-list | P | T7 | builder P | ux checks 19-21, 28 pass; layout unit tests |
| T12 | Responsive and a11y pass: phone single pane and tabs pattern, 44 px targets, 320 px reflow, contrast both themes, focus ring, reduced-motion transitions, axe clean | P | T8-T11 | builder P | ux checks 27, 29-31 pass |
| T13 | Acceptance suite (HTTP, per spec.md) and verify.config.json | phase 4 | - | test-owner agent | Suites in `acceptance/` cover every SC row of spec.md; written before the build; read-only afterwards |
| T14 | Browser walkthrough of ux.md UI checks 1-31 | phase 7 | all | e2e-runner | Every check passes or has a logged decision; defects routed back to builder P |
| T15 | README: `npm start`, PORT/HOST/VAULT_DIR, notes are plain files, loopback only and exposure needs a human, lock file, limits | phase 8 | T6 | doc-updater | README matches spec.md Interface |

Phase 6: `security-reviewer` reviews T2 (titles.js, vault.js), T1/T2 router path parsing and T9 markdown.js before the walkthrough.
