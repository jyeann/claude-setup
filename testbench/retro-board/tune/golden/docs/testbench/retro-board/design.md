# Retro board: system design
Node 22, no runtime deps, one process, static HTML/CSS/JS, JSON files, 3 s polling, tokens in the URL.
(Written by the `architect` agent; saved by the orchestrator.)

## 1. Module layout (testbench/retro-board/)
- `package.json`: `"start": "node src/server.js"`, `engines.node >=22`, no dependencies. One command: `npm start`. `README.md` documents it, plus PORT/HOST/DATA_DIR.
- `src/server.js`: reads env (PORT=3000, HOST=127.0.0.1, DATA_DIR=<app>/data, MAX_BOARDS=1000), boots store, sets timeouts (headers 5 s, request 10 s, maxConnections 1000). Prints `Retro board running at http://localhost:<port>`. Shuts down on SIGINT/SIGTERM (exit 0). EADDRINUSE: prints "Port N is in use, set PORT" and exits 1.
- `src/router.js`: route table, method check (405 + Allow), Host/Origin check, rate limits, JSON body reader, maps DomainError to status.
- `src/http.js`: sendJson, sendPage, security headers, static assets read once at boot into an allowlist map (no path joins from input).
- `src/tokens.js`: newToken, sha256 helpers, safeEqual (timingSafeEqual on 32-byte digests), format regexes.
- `src/validation.js`: title, card text, column, client-id rules (NFC, trim, code-point length, control chars).
- `src/board.js` (pure): createBoard, addCard, deleteCard, vote, unvote, setClosed, toView(board, {role, voter}). Throws DomainError(code, status).
- `src/export.js` (pure): toMarkdown(board, isoDate), filename(title).
- `src/store.js`: load DATA_DIR, get(pHash), create(board), update(pHash, fn) with clone, persist, swap. Also atomic write and the lock file.
- `src/rate-limiter.js`: fixed window per key (socket remoteAddress, never X-Forwarded-For).
- `public/`: index.html, board.html, export.html, not-found.html (no inline script or style, no `style=` attributes), app.css. `public/js/` holds ES modules: api.js (fetch wrapper, client id, ETag), logic.js (pure: labels, counter text, sort, diff, backoff), live.js (live regions, focus), home.js, board.js, export.js.
- `tests/*.test.js`: unit tests next to the code. `acceptance/` (read-only during a harness run): helpers.js (spawn with PORT and a temp DATA_DIR), api.acceptance.test.js, pages.acceptance.test.js. `verify.config.json` as in link-shortener. `data/` is gitignored.

## 2. Data model
- Board (one file per board): `{schema:1, facHash, title, createdAt, closed, version, nextId, cards:[Card]}`. Keyed in memory and on disk by pHash = sha256(participantToken) hex. Raw tokens are never stored.
- Card: `{id, column: "went-well"|"to-improve"|"actions", text, createdAt, author, voters:[voterHash]}`. id = String(nextId++): never reused, gives creation order, not secret.
- Vote: a voterHash in `card.voters`. Count = voters.length.
- Identity without accounts: on first load the browser makes 16 random bytes, base64url (22 chars), kept in localStorage `retroBoard.clientId`, shared across tabs and boards, sent on every API call as `X-Client-Id`. The server checks `^[A-Za-z0-9_-]{22}$` (else 400 bad_client_id) and stores only voterHash = sha256(clientId) base64url.
- Budget, enforced server-side per voterHash: vote fails with 409 no_votes_left when the voter already appears on 3 cards of the board. Voting on an already-voted card is a no-op (at most 1 per card). Unvote removes the hash. Deleting a card removes its voters, which refunds their votes.
- Caps: title 1-100 code points after trim, whitespace collapsed. Card 1-500 code points after trim (newlines and tabs allowed, other C0/C1 controls rejected). At most 200 cards per board and 500 distinct voters per board (409 board_full). MAX_BOARDS on create (503 storage_full).
- View, computed per requester: `{title, role, closed, version, maxVotes:3, votesLeft, cards:[{id, column, text, votes, voted, own, createdAt}]}` in id order. It never contains hashes or tokens. The client derives canDelete = facilitator || (own && !closed).

## 3. HTTP API
Pages (static shells; the server only decides the status):
- `GET /`: index.html 200.
- `GET /b/:p`: board.html 200 if the board exists, else not-found.html 404.
- `GET /b/:p/f/:f`: board.html 200 if p exists, whatever f is. The role comes from the API, so a wrong f gives the participant view.
- `GET /b/:p/f/:f/export`: export.html 200 only if p exists and f matches, else 404 not-found.
- `GET /assets/<allowlisted name>`: 200 with the right content type.
- Anything else (including malformed tokens, trailing segments and `/b/:p/export`): 404 not-found.html.

JSON API. Writes need `Content-Type: application/json` (415) and a body of 8 KB or less (413). Bad JSON gives 400 bad_json. Errors are `{error:{code,message}}`. Every 409 also carries `board` (a fresh view). Every mutation returns the full view plus ETag:
- `POST /api/boards {title}`: 201 `{participantToken, facilitatorToken, board}`. 400 title_empty|title_too_long, 429, 503 storage_full|storage_error.
- `GET /api/boards/:p` and `GET /api/boards/:p/f/:f`: 200 view with `ETag: "<version>"`, `Vary: X-Client-Id`, `Cache-Control: no-cache`. Matching If-None-Match gives 304 with an empty body. Wrong f gives 200 with role participant. Unknown p gives 404 board_not_found.
- `POST /api/boards/:p/cards {column, text}`: 201 view. 400 text_empty|text_too_long|bad_column, 409 board_closed|board_full, 404.
- `DELETE /api/boards/:p/cards/:id`: 200 (author only, open board). 403 not_author, 409 board_closed, 404 card_not_found|board_not_found.
- `PUT` and `DELETE /api/boards/:p/cards/:id/vote`: 200, idempotent. 409 no_votes_left|board_closed, 404 card_not_found.
- `DELETE /api/boards/:p/f/:f/cards/:id`: 200, allowed on closed boards too. Wrong f gives 403 forbidden.
- `PUT /api/boards/:p/f/:f/closed {closed: boolean}`: 200 view, idempotent. 400 or 403.
- `GET /api/boards/:p/f/:f/export`: 200 `{filename, markdown}`. The page shows `markdown` with textContent in the pre. Download uses a Blob URL on `a[download]`, so the file matches the preview byte for byte.

## 4. Persistence
- Files: `DATA_DIR/boards/<pHash>.json` (pretty JSON, schema 1). Bounded write cost per change; corruption stays inside one board.
- Atomic write: write `<file>.tmp-<pid>`, fsync, close, renameSync over the target, then fsync the directory (best effort).
- Rollback: `update()` deep-copies the board (`structuredClone`), mutates the copy, bumps version, persists. Only after a successful rename does it swap the copy into the Map. On any fs error the old board stays and the client gets 503 storage_error. Create only inserts after the file exists.
- Boot: mkdir -p, write and delete a probe file (if that fails, exit 1 with "Cannot write to DATA_DIR <path>"). Take `DATA_DIR/.lock` (flag 'wx', holds the pid; a stale pid is taken over, a live one exits 1). Delete leftover `*.tmp-*` files. Load every `*.json`. A file whose JSON or shape is invalid, or whose name does not match the hash, is renamed `<name>.corrupt-<epochms>` with a line on stderr and never overwritten; its board then shows Board not found.
- Restart: all boards load into memory and versions are persisted, so open tabs resume with 304 or a fresh view. Closed state, votes and authorship survive.

## 5. Concurrency and consistency
- One process per DATA_DIR (lock file). Body reading is async. Validate, clone, mutate, write and swap run synchronously with no `await`, so mutations are totally ordered and budget, closed and cap checks always see committed state.
- `version` goes up by 1 per committed mutation. The poll sends If-None-Match; an unchanged board costs one 304 with no body.
- The client polls with a `setTimeout` chain (never overlapping): 3 s, then 3, 6 and 10 s backoff on failure (honours Retry-After). It merges by card id in place, never rebuilding lists, so focus, scroll and drafts survive. Ids from its own adds are excluded from "new cards from others".
- Two tabs in one browser share a client id and a budget. Races are settled by the server (409 with a fresh view).

## 6. Security
- Tokens: `crypto.randomBytes(16).toString('base64url')`, 22 chars (128 bits), participant and facilitator generated independently. Format checked before lookup. Lookup is by sha256(p). The facilitator check is `timingSafeEqual(sha256(f), facHash)`. Tokens are returned only by create and never logged.
- No board list and no partial-match hints. Malformed and unknown p give identical 404s; a wrong f falls back silently on pages.
- XSS: no server-side HTML templating. The client uses createElement and textContent only. A unit test fails if `public/js` contains innerHTML, outerHTML, insertAdjacentHTML or document.write.
- Markdown export: newlines and tabs in a card become one space. A leading `#` `-` `*` `>` `[` `+` (and `1.`) in card text or title gets a backslash. Inline `<` is left as typed so success criterion 12 shows `<b>hi</b>` exactly. Known risk: target wikis must sanitise HTML. Decision 7 in decisions.md; the security review confirms it.
- Headers on every response: `Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`. Also nosniff, `Referrer-Policy: no-referrer`, X-Frame-Options DENY, COOP and CORP same-origin, `Cache-Control: no-store` on pages and API (no-cache plus ETag on board GETs).
- CSRF and DNS rebinding: no CORS headers (OPTIONS gives 405), so cross-site `X-Client-Id` and JSON bodies never pass preflight. An `Origin` that does not match `Host` gives 403. When HOST is loopback, Host must be localhost, 127.0.0.1 or [::1] with the port (else 403).
- Limits per IP per minute: create 20, writes 300, reads 900. Over the limit gives 429 with Retry-After.
- Bound to 127.0.0.1 by default. `HOST=0.0.0.0` serves the LAN and prints a warning. Public hosting needs a human.

## 7. Failure modes and how the UI learns of them
- Server down or network fails: the poll fails, `#offline-banner` shows, backoff runs, the last view stays. On recovery the banner goes and "Back online. Board updated." is announced. Add, vote, delete and close show their own ux.md error; an optimistic add is reverted and its text restored.
- First load fails: `#load-error` with Try again. Create fails: `#create-error`.
- 409 board_closed: render the fresh view from the 409 body, show the banner, keep any draft in `#draft-rescue`.
- 404 card_not_found: the card is removed and the "That card was removed." toast shows. 409 no_votes_left: the count reverts and the view is re-rendered.
- 503 storage_error: the state is unchanged on the server and the action's error is shown. 429 is handled like a network failure for that action.
- 500 (unexpected): generic JSON, the process keeps running. Uncaught exceptions are logged and the process exits 1 (data is safe on disk).
- Boot problems (unwritable DATA_DIR, port in use, live lock) give a one-line stderr message and exit 1. Corrupt board files are moved aside, logged, and the app continues.

## 8. Test strategy
- Acceptance (`acceptance/`, node:test over HTTP against a spawned server with a temp DATA_DIR): stdout address; create gives 201 with 22+ char URL-safe tokens; empty title gives 400 and no file; page status codes and role for a wrong or missing f; text limits and `<b>hi</b>` returned as-is; budget per client id, two clients' votes add up; delete authorisation; close and reopen with 409s; markdown order, singular, checklist, escaping, filename; stop and start on the same DATA_DIR; 304 on an unchanged poll; security headers; pages with no inline script or style attributes and all ux.md testids present.
- Unit (`tests/`): board.js rules and refunds, views never leak hashes; export.js ties, empty columns, escaping; store.js atomic write, rollback on an injected fs error, corrupt file moved aside, tmp cleanup, lock, version persisted; tokens.js and http.js headers, Host/Origin checks, 413, 415, 405; rate-limiter.js; router.js route table; `public/js/logic.js` via `await import()`; the no-innerHTML scan.
- Coverage floor 80%.
- Needs a real browser (ux.md UI checks 1-15, run in the phase-7 walkthrough with Playwright as an external tool, not a package dependency): focus and live regions, clipboard and download, optimistic timing, offline banner, layout at 390 and 1100 px, the two-context live-update and first-use flows, no console or CSP errors.

## 9. Decisions worth an ADR
1. Persistence. One JSON file; per-board JSON files; append-only log; node:sqlite. Chosen: per-board files with atomic rename: bounded write cost, corruption stays in one board, readable files, no experimental API.
2. Tokens and client ids. Raw values; hashes. Chosen: SHA-256 hashes, so a leaked data file cannot open, run or impersonate anyone.
3. Participant identity. Cookie; server-issued id; localStorage plus a header. Chosen: localStorage plus `X-Client-Id`: no cookies or banner, survives reload, the custom header blocks CSRF through preflight.
4. Change detection. Full GET every poll; `?since=`; per-board version with ETag and 304; SSE. Chosen: ETag with persisted version: an unchanged poll costs almost nothing and survives restart.
5. Mutation responses. Return the item; return the full viewer view. Chosen: full view (409s too), so one round trip resyncs the client.
6. Rendering. Server templates; static shells plus client rendering. Chosen: static shells: no server-side escaping surface, a strict `'self'` CSP.
7. Write path. Async queue or debounce; synchronous write inside the request. Chosen: synchronous: trivial ordering, a 2xx means the change is on disk.
8. Vote API. POST toggle; idempotent PUT and DELETE. Chosen: PUT and DELETE: safe to retry, never double-counts.
9. Deleted cards. Keep votes spent; refund. Chosen: refund.
10. Network exposure. Bind all interfaces; loopback default with a HOST opt-in. Chosen: loopback, plus a Host check against DNS rebinding.
