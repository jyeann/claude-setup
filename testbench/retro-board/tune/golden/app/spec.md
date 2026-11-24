# Spec: retro-board

## Goal
A team retro board: three fixed columns (Went well, To improve, Actions), anonymous cards, 3 votes per participant, facilitator controls (close, reopen, delete any card, markdown export). Node 22, zero runtime dependencies, one process, per-board JSON files, static HTML/CSS/JS pages that poll every 3 s. Source documents: `docs/testbench/retro-board/brief.md` (what), `ux.md` (what a person sees, testids), `design.md` (architecture and the API contract in section 3). Where this spec is stricter or more exact than those, this spec wins.

## Interface (exact)
Start: `node src/server.js` (also `npm start`). Env: `PORT` (3000), `HOST` (127.0.0.1), `DATA_DIR` (`<app>/data`), `MAX_BOARDS` (1000). Prints a line containing `Retro board running at http://localhost:<port>` once it accepts connections. `SIGTERM`/`SIGINT`: close and exit 0. A second server on the same `DATA_DIR` while one is alive exits 1 (lock file); a stale lock is taken over.

Pages (`GET`, `text/html`, static shells): `/` 200; `/b/:p` 200 if board exists; `/b/:p/f/:f` 200 if `p` exists, whatever `f` is; `/b/:p/f/:f/export` 200 only if `p` exists and `f` matches; `GET /assets/...` allowlisted files only. Everything else (malformed or unknown tokens, trailing segments, `/b/:p/export`, path tricks) is 404 with the Board not found page (title `Board not found - Retro board`, `data-testid` `not-found-title` and `create-new-link`, identical for every bad link).

JSON API (errors `{error:{code,message}}`; every 409 also has `board`, a fresh view). Every request carries `X-Client-Id` (22 chars of `A-Za-z0-9_-`, else `400 bad_client_id`). Writes need `Content-Type: application/json` (else 415), body at most 8192 bytes (else 413), valid JSON object (else 400 `bad_json`). All mutations return the full view for the requester with `ETag: "<version>"`.

| Request | Success | Failure |
|---|---|---|
| `POST /api/boards {title}` | 201 `{participantToken, facilitatorToken, board}` (tokens 22+ chars `A-Za-z0-9_-`, independent) | 400 `title_empty`, `title_too_long`; 429; 503 |
| `GET /api/boards/:p`, `GET /api/boards/:p/f/:f` | 200 view, `ETag`, `Vary: X-Client-Id`, `Cache-Control: no-cache`; `If-None-Match` match gives 304 empty; wrong `f` gives role `participant` | 404 `board_not_found` |
| `POST /api/boards/:p/cards {column,text}` | 201 view | 400 `text_empty`, `text_too_long`, `bad_column`; 409 `board_closed`, `board_full` (200 cards) |
| `DELETE /api/boards/:p/cards/:id` | 200 view (author, open board) | 403 `not_author`; 409 `board_closed`; 404 `card_not_found`, `board_not_found` |
| `PUT` / `DELETE /api/boards/:p/cards/:id/vote` | 200 view, idempotent | 409 `no_votes_left`, `board_closed`; 404 |
| `DELETE /api/boards/:p/f/:f/cards/:id` | 200 view, also when closed | 403 `forbidden` (wrong `f`); 404 |
| `PUT /api/boards/:p/f/:f/closed {closed:boolean}` | 200 view, idempotent | 400; 403 `forbidden` |
| `GET /api/boards/:p/f/:f/export` | 200 `{filename, markdown}` | 403 or 404 on wrong `f`; 404 |

View: `{title, role: "participant"|"facilitator", closed, version, maxVotes: 3, votesLeft, cards:[{id (string), column: "went-well"|"to-improve"|"actions", text, votes, voted, own, createdAt}]}` in id order. It never contains tokens, hashes or client ids. `version` goes up by 1 per committed change and survives restarts.

Rules: title 1-100 code points after trim and whitespace collapse; card 1-500 code points after trim, NFC, tabs and newlines allowed, other control characters rejected; at most 3 votes per client id per board, 1 per card, deleting a card refunds its voters; card ids never reused; non-matching `Host` (loopback bind: must be localhost, 127.0.0.1 or [::1]) or foreign `Origin` gives 403; wrong method on a known route 405 with `Allow` (so `OPTIONS` is 405).

Markdown export: `# <title>`, blank, `Date: YYYY-MM-DD` (local server date), then `## Went well`, `## To improve`, `## Actions`, each followed by a blank line and one line per card, highest votes first, older first on ties: `- <text> (N votes)` (`(1 vote)` singular), Actions as `- [ ] <text> (N votes)`, empty column `- _No cards._`. Newlines and tabs in cards become a single space; a leading `# - * > [ +` in card text or title gets a backslash; `<` is left as typed. Filename: slugified title + `.md` (`sprint-12.md`).

Persistence: `DATA_DIR/boards/<sha256(participantToken) hex>.json`, written atomically before the response. Corrupt files are renamed `<name>.corrupt-<ms>`, logged to stderr, and the board then 404s. Leftover `*.tmp-*` files are removed at boot.

Security: headers on every response `Content-Security-Policy` (`default-src 'none'`, `script-src 'self'`, `frame-ancestors 'none'`, ...), `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`, `Cache-Control: no-store` (board GET: no-cache); no CORS headers. No inline script, `<style>`, `style=` attribute or inline handler in any served page; no `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write` in served JS. Pages reference their scripts and stylesheet by URL; HTML or served JS must contain every `data-testid` that ux.md lists (per-column ids may be built as prefix + column key).

## Acceptance criteria (brief SC -> test)
Visible, over HTTP only: `acceptance/api.acceptance.test.js`, `acceptance/pages.acceptance.test.js`. A holdout set also grades the result.
- SC1 start and home form: ready line test, home page tests. SC2 create: tokens, empty board, role tests. SC3 empty title: `title_empty` (that no file is written is not checkable over HTTP; unit-test it).
- SC4/SC14 roles and bad links: role, fallback, 404 page tests. SC5/SC6 cards: limits 1/500/501, empty, bad column, `<b>hi</b>`.
- SC7/SC8 votes: budget, double vote, refund, two clients. SC9 delete: author, other, facilitator, closed. SC11 close/reopen: 409 `board_closed`, facilitator delete. SC12 export: exact shape, order, filename, access.
- SC13 restart: persistence test, ETag 304 after restart. Poll support: ETag tests. Hardening: 415, 413, 405, headers, inline-code tests, testid presence.
- Not checkable over HTTP (browser walkthrough, ux.md checks): SC5 live latency, SC10 sort (client side), focus, clipboard and download, layout, SC15.

## Out of scope
Accounts, card grouping, timers, custom columns, editing, comments, PDF/CSV export, board list, expiry, translations, public hosting.

## Verify command
`cd testbench/retro-board && node --test "acceptance/*.test.js" "tests/*.test.js"` (config: `verify.config.json`: 30 tests minimum, 80% line coverage, mutation and holdout gates). Acceptance tests are read-only for the builder; add unit tests under `tests/`.

## Constraints
Node 22 built-ins only, no dependencies, no build step. Never store raw tokens or client ids. Do not edit `acceptance/`. No `style=` attributes, inline scripts or `innerHTML` anywhere.
