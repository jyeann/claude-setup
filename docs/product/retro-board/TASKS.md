# Tasks: retro-board (examples/retro-board/)
Paths relative to examples/retro-board/. Specs: docs/product/retro-board/{brief,ux,design}.md. Planner output, adapted by the orchestrator (see decisions 11 and 12).
Build order, not separate verify gates: the acceptance tests exist up front, so verify is red until the last slice. Within each slice write unit tests first.

| Slice | Title | Builder group | Blocked by | Owner |
|---|---|---|---|---|
| T1 | Thin end-to-end: start server, create a retro, see the empty board, Board not found | A | - | builder |
| T2 | Persistence and restart (per-board files, atomic write, rollback, lock, corrupt files moved aside) | A | T1 | builder |
| T3 | Add cards (limits, counter, optimistic add, hostile text shown literally) | A | T1 | builder |
| T4 | Delete cards (author vs facilitator, inline confirm, focus) | B | T3 | builder |
| T5 | Voting budget (3 per client id, refund, disabled at 0, reload-safe) | B | T3 | builder |
| T6 | Sort by votes (per viewer, sessionStorage) | B | T5 | builder |
| T7 | Live polling (3 s, ETag/304, backoff, offline banner, announcements) | B | T4, T5 | builder |
| T8 | Facilitator close and reopen (banner, controls removed, draft rescue) | B | T7 | builder |
| T9 | Export markdown (preview, Copy, Download identical, 404 without facilitator token) | C | T5 | builder |
| T10 | Security headers and limits (CSP, 405/413/415/403/429, caps, timeouts, no-innerHTML scan) | C | T8, T9 | builder |
| T11 | Accessibility and responsive layout (skip link, live regions, AA contrast, 390/1100 px) | C | T8, T9 | builder |
| T12 | Acceptance suite and verify config | done in phase 4 | - | test-owner agent |
| T13 | Browser walkthrough of ux.md UI checks 1-15 | phase 7 | all | e2e-runner |
| T14 | README (npm start, env vars, the two links, backup and reset, public hosting needs a human) | phase 8 | T10 | doc-updater |

Full slice detail (done-when and files) is in the planner's output summarised in design.md section 1 and ux.md; T1 must not copy link-shortener's scratchpad holdout path into verify config (the holdout path is set by the orchestrator).
