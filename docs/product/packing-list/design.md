# Design: packing-list
Node 22, zero runtime dependencies, one process, static HTML/CSS/JS shells rendered on the client, one JSON data file, 2 s polling, unguessable list id in the URL.
(Written by the `architect` agent; saved by the orchestrator.) Sources: `brief.md` (SC1 to SC10), `ux.md` (fixed: URLs, selectors, copy, status codes).

## 1. Modules and files (examples/packing-list/)
- `package.json`: `"start": "node src/server.js"`, `"test": "node --test tests/"`, `engines.node >=22`, no `dependencies`. `README.md` documents `npm start` / `node src/server.js` and PORT, HOST, DATA_FILE. `data/` is gitignored.
- `src/server.js`: reads env, builds the store, starts http. Exports `createApp({dataFile, host, maxLists}) -> {server, store}` and `main()`; runs `main()` only when `require.main === module`. Env: PORT (default 3000; `0` allowed, prints the real port), HOST (default `127.0.0.1`), DATA_FILE (default `<app dir>/data/lists.json`, relative paths resolved against cwd). Prints exactly one line `Packing list running at http://localhost:<port>` (HOST loopback) or `http://<HOST>:<port>` (otherwise, plus a stderr LAN warning). Timeouts: headers 5 s, request 10 s. SIGTERM and SIGINT: `server.close()`, then exit 0 (forced exit 0 after 2 s). EADDRINUSE: stderr `Port <N> is in use, set PORT` and exit 1.
- `src/router.js`: `handle(req, res, ctx)`. Route table, method check (405 + `Allow`), Host/Origin check, body reading, maps `DomainError` to status.
- `src/http.js`: `securityHeaders()`, `sendJson(res, status, body)`, `sendError(res, status, code, message)`, `sendPage(res, status, name)`, `sendAsset(res, name)`, `readJsonBody(req, maxBytes) -> Promise<object>` (throws DomainError bad_content_type / body_too_large / bad_json / invalid_body). Pages and assets are read once at boot into an allowlist Map; no path is built from request input.
- `src/ids.js`: `newListId()` (= `crypto.randomBytes(16).toString('base64url')`), `LIST_ID_RE`, `ITEM_ID_RE`.
- `src/validation.js`: `codePointLength(s)`, `validateName(raw) -> string`, `validateItemText(raw) -> string`. Throw DomainError.
- `src/lists.js` (pure): `class DomainError(code, status, message)`, `createList(id, name, now)`, `addItem(list, text)`, `setTicked(list, itemId, ticked)`, `removeItem(list, itemId)`, `toView(list)`. Constants `MAX_ITEMS = 200`, `MAX_NAME = 80`, `MAX_ITEM = 120`.
- `src/store.js`: `createStore(file, {maxLists})` with `load()`, `get(id)`, `create(list)`, `update(id, fn)`, `size()`; and `writeAtomic(file, data)`.
- `public/` (no inline script, no inline style, no `style=`): `index.html`, `list.html`, `not-found.html`, `app.css`, `js/api.js` (fetch wrapper, returns `{ok, status, body}` or network error), `js/logic.js` (pure: `progressText(n,m)`, `checkName`, `checkItem` mirroring server rules and messages, `mergeItems(ul, items, pending)` plan), `js/home.js`, `js/list.js`. Served as `/assets/app.css`, `/assets/js/<name>.js`.
- `tests/*.test.js` unit tests (node:test). `acceptance/` is human-owned and read-only during a harness run.

## 2. Data model and validation
- List (stored): `{id, name, createdAt, nextItemId, items:[Item]}`. Item: `{id, text, ticked}`.
- View (API): `{id, name, items:[{id, text, ticked}]}`. Progress is derived by the client: N = ticked count, M = items.length.
- List id: 16 bytes from `crypto.randomBytes` (128 bits), base64url without padding, exactly 22 chars, regex `^[A-Za-z0-9_-]{22}$`. Never logged.
- Item id: decimal string of `nextItemId`, starting at `"1"`, incremented per add, never reused within a list. Regex `^[1-9][0-9]{0,9}$`. Not secret.
- Order: items kept in insertion order; ticking does not move them; remove keeps the others' order.
- Duplicates: allowed (two "Socks" items are two items with different ids). Duplicate trip names allowed.
- Text rules (name and item alike): input must be a JSON string. Trim with `String.prototype.trim()`. No Unicode normalisation; whitespace inside is kept as typed. After trim, reject if any char is in U+0000-U+001F or U+007F-U+009F (this includes tab and newline). Length = Unicode code points (`[...s].length`) after trim. Name 1..80, item 1..120. The stored value is the trimmed string.
- Check order: type -> trim -> empty -> length -> control chars -> list full (items only).

## 3. HTTP API
Common: JSON responses use `Content-Type: application/json; charset=utf-8`. Errors are `{"error":{"code":"<code>","message":"<text>"}}`. Request bodies (POST, PUT) must have `Content-Type` `application/json` (parameters allowed) else 415 `bad_content_type`; body cap 4096 bytes (counted while streaming; over it gives 413 `body_too_large`, the read stops); invalid JSON gives 400 `bad_json`; JSON that is not an object, or whose field is missing or of the wrong type, gives 400 `invalid_body`. Malformed and unknown list ids behave identically. Query strings are ignored for routing.

| Method, path | Body | Success | Errors |
|---|---|---|---|
| POST `/api/lists` | `{"name": string}` | 201 view | 400 name_empty, name_too_long, name_invalid; 503 storage_full, storage_error |
| GET `/api/lists/:id` | - | 200 view | 404 list_not_found |
| POST `/api/lists/:id/items` | `{"text": string}` | 201 view (new item last) | 400 item_empty, item_too_long, item_invalid; 409 list_full; 404 list_not_found; 503 storage_error |
| PUT `/api/lists/:id/items/:itemId/ticked` | `{"ticked": true\|false}` | 200 view | 400 invalid_body (ticked not a boolean); 404 list_not_found, item_not_found; 503 storage_error |
| DELETE `/api/lists/:id/items/:itemId` | none (ignored) | 200 view | 404 list_not_found, item_not_found; 503 storage_error |

Error messages (exact):
- name_empty: `Enter a trip name.` | name_too_long: `Trip name is too long (N characters). The limit is 80.` (N = code points after trim)
- item_empty: `Enter an item to add.` | item_too_long: `Item is too long (N characters). The limit is 120.` | list_full: `This list is full (200 items)`
- name_invalid: `Trip name contains characters that are not allowed.` | item_invalid: `Item contains characters that are not allowed.`
- list_not_found: `That link does not match any list. Check it for typos.` | item_not_found: `That item was removed.`
- bad_json: `Request body is not valid JSON.` | invalid_body: `Request body is not valid.` | bad_content_type: `Content-Type must be application/json.` | body_too_large: `Request body is too large.`
- method_not_allowed (405): `Method not allowed.` | not_found (404, unknown `/api/...`): `Not found.` | forbidden (403): `Forbidden.`
- storage_full (503): `Too many lists are stored.` | storage_error (503): `Could not save that change. Try again.` | internal_error (500): `Something went wrong.`

Setting `ticked` to its current value is a 200 no-op. Removing an item twice gives 404 item_not_found the second time (client treats that as done).

Pages (static shells, server only chooses status), GET and HEAD:
- `/` -> index.html 200. `/l/:id` -> list.html 200 if id matches the regex and exists, else not-found.html 404. Anything else (including `/l/`, `/l/:id/`, `/index.html`) -> not-found.html 404. All pages `text/html; charset=utf-8`.
- `/assets/<allowlisted path>` -> 200 with `text/css` or `text/javascript` (charset utf-8); any other `/assets/...` -> 404 not-found.html.
- Other methods: on `/`, `/l/:id`, `/assets/*` -> 405 JSON `method_not_allowed`, `Allow: GET, HEAD`. On API routes -> 405 with the route's allowed methods (e.g. `Allow: POST` on `/api/lists`, `Allow: GET` on `/api/lists/:id`, `Allow: PUT` on `.../ticked`, `Allow: DELETE` on `.../items/:itemId`). OPTIONS is 405 (no CORS).

## 4. Persistence
- One file at DATA_FILE: `{"schema":1,"lists":{"<id>":{id,name,createdAt,nextItemId,items}}}`, pretty-printed UTF-8.
- Write path: each mutation deep-copies the list (`structuredClone`), mutates the copy, serialises the whole store with the copy, `writeAtomic`, then swaps the copy into the Map. Steps run synchronously (no `await`) so mutations are totally ordered. On any fs error the in-memory state is unchanged and the request gets 503 storage_error. A 2xx means the change is on disk.
- `writeAtomic`: mkdir -p the directory, write `<file>.tmp-<pid>`, fsync, close, `renameSync` over the file.
- Boot: missing file -> empty store (file created on first write). Unreadable JSON or wrong shape (schema not 1, lists not an object, a list or item failing the id/text rules) -> rename to `<file>.corrupt-<epochms>`, one stderr line, start empty; never overwritten. Leftover `<file>.tmp-*` are deleted. MAX_LISTS = 10000 (create beyond it -> 503 storage_full).

## 5. Client polling and focus
- list.js loads `GET /api/lists/:id` on start, then polls with a `setTimeout` chain every 2000 ms, never overlapping (next poll is scheduled after the previous one settles). Failures retry at the same 2 s.
- On poll or write failure `#status` shows `Connection lost. Trying again...`; the next success clears it. A 404 list_not_found on poll replaces the page with the not-found content.
- Merge by item id in place: update text/checked on existing `li`, append new ones, remove missing ones, reorder only if order differs. `#new-item` value, `#form-error`, and focus are never touched by a poll. Items with a write in flight keep their optimistic state until it settles. If the focused row is removed by a poll, focus moves to `#new-item`.
- Optimistic writes: add appends at once and replaces with the server view on 201; tick sets state at once; a failed tick reverts and `#status` shows `Could not save that change. Try again.`; a failed add removes the row, keeps the text, and shows the server message (or the save failure text) in `#form-error`.
- Client-side checks mirror server rules (same messages) before sending; the server stays authoritative.

## 6. Security
- Rendering: shells are static; all user text goes in via `textContent`, `value` or `setAttribute('aria-label', ...)`. A unit test fails if `public/` contains `innerHTML`, `outerHTML`, `insertAdjacentHTML` or `document.write`. API returns text exactly as stored (`<b>hi</b>` verbatim).
- Headers on every response: `Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`, `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-origin`, `Cache-Control: no-store`.
- Static files from a boot-time allowlist; `..`, encoded slashes and unknown names simply miss the Map (404).
- Body cap 4096 bytes; 200 items per list; MAX_LISTS; header and request timeouts.
- Host/Origin: a request with an `Origin` header whose host differs from `Host` gets 403 forbidden. When HOST is loopback, `Host` must be `localhost`, `127.0.0.1` or `[::1]` (any port) else 403 forbidden (DNS rebinding).
- Bound to 127.0.0.1 by default; `HOST=0.0.0.0` is the documented LAN opt-in. No secrets, no cookies, list ids never logged. Leaked link = full edit access (stated on the page).

## 7. Failure modes
| Failure | Server | UI |
|---|---|---|
| Server down / network error | - | `#status` "Connection lost. Trying again...", last view stays, polls continue |
| Tick save fails | 503 or none | revert, `#status` "Could not save that change. Try again." |
| Add fails | 4xx/503 | row removed, text kept, message in `#form-error` |
| Create fails (network/5xx) | - | home alert "Could not create the list. Check that the app is running and try again." |
| Item already removed | 404 item_not_found | row removed, no error |
| List gone / bad link | 404 | not-found page |
| Disk write error | 503 storage_error, memory unchanged | as save failure |
| Corrupt data file at boot | moved aside, stderr, start empty | old links show not found |
| Port in use | stderr, exit 1 | - |
| Unexpected exception in handler | 500 internal_error, process continues | as save failure |

## 8. Rules
R1. `node src/server.js` starts the app; stdout contains `Packing list running at http://localhost:<port>` with the actual bound port.
R2. PORT defaults to 3000, HOST to 127.0.0.1, DATA_FILE to `<app dir>/data/lists.json`.
R3. SIGTERM makes the process exit with code 0.
R4. `GET /` returns 200 text/html (index.html).
R5. `GET /l/<id>` returns 200 list.html when the list exists, else 404 not-found.html.
R6. Any other path (including `/l/`, `/l/<id>/`, `/l/nope`) returns 404 with the not-found page and `text/html`.
R7. `GET /assets/<allowlisted>` returns 200 with the correct content type; any other `/assets/` path returns 404.
R8. Path traversal attempts (`..`, `%2e%2e`, `%2f`) never return a file outside the allowlist; they return 404.
R9. Every response carries the exact security headers in section 6 and `Cache-Control: no-store`.
R10. All API errors have body `{"error":{"code","message"}}` with codes and messages exactly as in section 3.
R11. `POST /api/lists {"name":"Lisbon weekend"}` returns 201 `{id, name:"Lisbon weekend", items:[]}`.
R12. List ids match `^[A-Za-z0-9_-]{22}$` and come from 16 random bytes; two creates never return the same id.
R13. Names and item texts are trimmed with `String.prototype.trim()`; the stored and returned value is the trimmed string.
R14. Empty or whitespace-only name gives 400 name_empty, `Enter a trip name.`, and no list is created.
R15. Length is counted in Unicode code points after trim.
R16. Name of 80 code points is accepted; 81 gives 400 name_too_long `Trip name is too long (81 characters). The limit is 80.`
R17. A name containing U+0000-U+001F or U+007F-U+009F after trim gives 400 name_invalid; same rule for items gives 400 item_invalid.
R18. Missing, non-string `name` or `text`, or a non-object body, gives 400 invalid_body.
R19. Invalid JSON gives 400 bad_json; non-JSON Content-Type on POST/PUT gives 415 bad_content_type.
R20. A body over 4096 bytes gives 413 body_too_large and changes nothing.
R21. `GET /api/lists/<id>` returns 200 view; unknown or malformed id gives 404 list_not_found.
R22. `POST /api/lists/<id>/items {"text":"Passport"}` returns 201 with the item last, `ticked:false`, id matching `^[1-9][0-9]{0,9}$`.
R23. Item ids are unique within a list and never reused after removal.
R24. Empty item gives 400 item_empty `Enter an item to add.`; 120 code points accepted; 121 gives 400 item_too_long `Item is too long (121 characters). The limit is 120.`
R25. Adding to a list with 200 items gives 409 list_full `This list is full (200 items)` and the count stays 200.
R26. Duplicate item texts and duplicate trip names are allowed.
R27. Items are returned in insertion order; ticking does not reorder; removal keeps the others' order.
R28. `PUT .../items/<itemId>/ticked {"ticked":true}` sets ticked true; `false` sets false; repeating a value is a 200 no-op.
R29. A `ticked` that is not a JSON boolean (e.g. `"true"`, `1`, missing) gives 400 invalid_body.
R30. `DELETE .../items/<itemId>` returns 200 view without that item.
R31. Unknown or malformed item id on PUT or DELETE gives 404 item_not_found; unknown list gives 404 list_not_found.
R32. Unsupported methods give 405 method_not_allowed with an `Allow` header listing the allowed methods; OPTIONS is 405.
R33. Unknown `/api/...` paths give 404 not_found (JSON).
R34. Text is returned exactly as stored; `<b>hi</b>` round-trips unchanged.
R35. Every successful mutation is on disk before the response is sent.
R36. After restart with the same DATA_FILE, lists, items, order and tick states are unchanged.
R37. Writes use temp file plus rename; the data file is always valid JSON with `schema: 1`.
R38. Missing data file at boot gives an empty store; corrupt file is renamed `<file>.corrupt-<epochms>` and the app starts empty.
R39. A write failure gives 503 storage_error and leaves memory and disk unchanged.
R40. A request whose `Origin` host differs from `Host`, or (on loopback HOST) whose `Host` is not localhost/127.0.0.1/[::1], gives 403 forbidden.
R41. Client polls every 2000 ms without overlap; others' changes appear within 5 s.
R42. Polling never changes `#new-item` value, `#form-error` text, or focus (except moving focus to `#new-item` if the focused row disappears).
R43. `public/` contains no `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, inline `<script>` content, `<style>` or `style=` attributes.
R44. No runtime dependencies in package.json.
