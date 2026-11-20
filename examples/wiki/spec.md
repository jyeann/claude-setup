# Spec: wiki

## Goal
A local-first Markdown wiki. Notes are plain `<Title>.md` files in one vault folder. The browser UI provides wikilinks, backlinks, rename with link rewriting, full-text search, a graph view and conflict-safe saves. It runs on Node 22 with zero dependencies as one process using ESM (`"type": "module"`). The UI is static vanilla JS in `public/` with no build step. Sources: `docs/product/wiki/brief.md` (what), `ux.md` (screens, testids, UI checks), `design.md` (architecture, API in section 4). Where this spec is stricter or more exact than those documents, this spec wins (see "Resolved ambiguities").

## Interface (exact)
Start with `node src/server.js` (also `npm start`). Env vars:
- `PORT`: default 3000; `0` means any free port.
- `HOST`: default `127.0.0.1`; only `127.0.0.1`, `::1` or `localhost` are allowed. Anything else prints `HOST must be a loopback address; exposing the wiki needs a security review` and exits 1.
- `VAULT_DIR`: default `./vault`, resolved against cwd. It is created with `mkdir -p` and then realpath'd.

Startup:
- Once listening, stdout prints exactly one line `Wiki running at http://localhost:<actual port>` (also when HOST is `::1`).
- SIGINT or SIGTERM: close, remove the lock, exit 0.

Startup failures (all exit 1):
- Port taken: `Port <N> is in use, set PORT`.
- Vault not writable: `Cannot write to VAULT_DIR <path>`.
- A live lock: `Another wiki server is using <vault>`. A stale pid (ESRCH) or the server's own pid in `.wiki.lock` is taken over.

Boot deletes stale `VAULT/.wiki-*.tmp` files.

### Request checks (every request, in this order; the first failure wins)
1. `Host` must be exactly `localhost:<port>`, `127.0.0.1:<port>` or `[::1]:<port>`. A missing or other Host gives 403 `bad_host`.
2. Route. For unknown `/api/*` (any method), or the wrong number of path segments, the response is 404 `not_found`. For a known route with the wrong method it is 405 `method_not_allowed` with an `Allow` header: `/api/notes` `GET, POST`; `/api/notes/:t` `GET, PUT, DELETE`; `/api/notes/:t/rename` `POST`; `/api/notes/:t/backlinks` `GET`; `/api/search` and `/api/graph` `GET`; any non-API path `GET`. OPTIONS and HEAD are 405. No CORS headers are ever sent.
3. Title segment. The raw path (query stripped) is split on `/` before decoding, so `%2F` never creates a segment. The segment then gets exactly one `decodeURIComponent` and `validateTitle`. A throw, an empty segment or an invalid title gives 404 `note_not_found`, never 400. This covers GET, PUT, DELETE, backlinks and the rename source. Examples that must 404: `/api/notes/..`, `/api/notes/%2e%2e%2fsecret`, `/api/notes/..%2Fsecret`, `/api/notes/a%2Fb`, `/api/notes/%E0%A4%A`, `/api/notes/`.
4. POST, PUT and DELETE: an `Origin` header, if present, must equal `http://<Host>`; `Sec-Fetch-Site: cross-site` is also refused. Either gives 403 `bad_origin`.
5. POST and PUT: `Content-Type` must be `application/json` (a `; charset=utf-8` parameter is allowed), else 415 `unsupported_media_type`. DELETE needs no body or content type.
6. Body over 2,098,176 bytes (2 MiB + 1 KiB), checked against Content-Length or the streamed count, gives 413 `too_large` and the request is destroyed.
7. The body must be valid JSON and a flat object (values are primitives). A wrong field type, a missing required field, or arrays or nested objects give 400 `bad_request`. Unknown keys are ignored.

### Responses
- Every error is JSON `{"error":{"code","message",...params}}`.
- Every `/api` response has `Content-Type: application/json; charset=utf-8` and `Cache-Control: no-store`.
- Every response (API, static, shell) carries these headers:
  - `Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'`
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: no-referrer`
  - `X-Frame-Options: DENY`
  - `Cross-Origin-Opener-Policy: same-origin`
  - `Cross-Origin-Resource-Policy: same-origin`
- Static files: an allow-list loaded at boot from `public/`, serving `/app.css` (`text/css; charset=utf-8`) and `/js/<name>.js` (`text/javascript; charset=utf-8`). Any other non-API GET (including `/n/%2e%2e%2fsecret`, `/js/../src/server.js` and `/graph`) returns 200 with `public/index.html` (`text/html; charset=utf-8`). Request input is never joined to a filesystem path, so no response ever contains bytes from outside `public/` or the vault notes.

### Revision
- The revision is the first 32 hex characters of the SHA-256 of the file bytes (content only).
- It is returned as `revision` and as the header `ETag: "<revision>"` on GET and PUT of a note.
- `If-Match` must be the quoted strong form `"<revision>"`. Any other value, including `*` and `W/`, counts as a mismatch.
- `If-None-Match` is ignored.

### Routes
`modified` is `new Date(mtimeMs).toISOString()`; `size` is bytes. Titles in responses are the stored (on-disk) casing.

| Request | Success | Errors |
|---|---|---|
| `GET /api/notes` | 200 `{notes:[{title, modified, size}]}`, sorted by modified desc, then key asc | |
| `POST /api/notes` `{title:string, content?:string=""}` | 201 `{title, revision, modified}`, `Location: /api/notes/<encodeURIComponent(title)>`. Title stored as `normalizeTitle`; content written byte for byte as UTF-8 (default 0 bytes). Never overwrites. | 400 `title_*`; 409 `title_exists {existing}`; 413 `too_large`, or `note_too_large` if content is over 2,097,152 UTF-8 bytes; 503 `storage_error` |
| `GET /api/notes/:t` | 200 `{title, content, revision, modified}` + ETag. Lookup by `titleKey` (`/api/notes/ideas` returns `Ideas`). The file is always read fresh; invalid UTF-8 decodes to U+FFFD. | 404 `note_not_found` |
| `PUT /api/notes/:t` `If-Match`, `{content:string}` | 200 `{title, revision, modified}` + ETag; file content equals the sent content byte for byte | 428 `revision_required` (no If-Match); 404 `note_not_found`; 412 `conflict {currentRevision}` (file bytes changed since that revision, including outside edits; file untouched); 413 `note_too_large`; 503 |
| `DELETE /api/notes/:t` (optional If-Match) | 204 empty; removes only that file | 404; 412 `conflict` only when If-Match is sent and differs; 503 |
| `POST /api/notes/:t/rename` `{title:newTitle}` | 200 `{title, revision, updated:[titles], failed:[{title, reason:"write_failed"}]}` | 404 (source, checked first); 400 `title_*` (new title); 409 `title_exists {existing}`; 503 with nothing changed if the move fails |
| `GET /api/notes/:t/backlinks` | 200 `{backlinks:[{title, snippet}]}`: one entry per source note with a valid link whose key matches; self excluded; sorted by key; snippet is the `line` of that note's first such link | 404 |
| `GET /api/search?q=` | 200 `{query, total, results:[{title, titleMatch, modified, snippet, ranges:[[start,end]]}]}`, `total === results.length` (no cap) | 400 `bad_request` if `q` is absent or over 200 code points after NFC and trim |
| `GET /api/graph` | 200 `{nodes:[{title, orphan}], edges:[[a,b]]}` | |

Fixed messages: `note_not_found` is "Note not found."; `conflict` is "This note changed since you opened it."; `title_exists` is `A note called "<existing>" already exists. Choose another title.` Other non-title codes have free-form messages; tests check codes only. An unhandled exception gives 500 `internal` with a generic message.

### Title rules (`public/js/titles.js`, shared by client and server)
- `normalizeTitle(raw)` returns `String(raw).normalize("NFC").trim()`.
- `titleKey(t)` returns `normalizeTitle(t).toLowerCase()`.
- `validateTitle(raw)` returns `{ok:true, title}` (normalised) or `{ok:false, code, message}`. Non-string input counts as empty. Rules are checked in order on the normalised title; the first failure wins.

1. `title_empty`: "Give the note a title."
2. `title_too_long` (over 200 code points): "Keep the title to 200 characters or fewer. It is N now."
3. `title_too_long_bytes` (over 240 UTF-8 bytes): "This title is too long for a file name. Shorten it."
4. `title_control` (U+0000-001F, U+007F-009F, U+2028, U+2029): "A title cannot contain control characters."
5. `title_separator` (`/` or `\`): "A title cannot contain / or \." (so `../escape` reports this)
6. `title_dotdot` (contains `..`): `A title cannot contain "..".`
7. `title_leading_dot`: "A title cannot start with a dot."
8. `title_char` (any of `: * ? " < > | [ ] #`): `A title cannot contain : * ? " < > | [ ] or #.`
9. `title_trailing_dot`: "A title cannot end with a dot."
10. `title_reserved` (part before the first `.`, case-insensitive, is CON, PRN, AUX, NUL, COM1-9 or LPT1-9): `"<part as typed>" is a reserved name. Choose another title.`

Exports (exact names): `normalizeTitle`, `titleKey`, `validateTitle`, `MAX_TITLE_LENGTH` (200), `MAX_TITLE_BYTES` (240), `TITLE_MESSAGES`. `TITLE_MESSAGES` is a frozen object mapping each code above plus `title_exists` to its message template, with `{n}`, `{name}` and `{existing}` placeholders.

### Wikilinks (`public/js/wikilink.js`, shared)
Exports (exact names):
- `scanCode(text)` returns `[{start, end}]`: half-open UTF-16 ranges, sorted, non-overlapping.
  - A fenced block opens at a line of 0-3 spaces followed by 3 or more backticks or tildes. It closes at a line of 0-3 spaces followed by the same character, at least the same count, then only whitespace. An unclosed fence runs to the end.
  - Inline code (outside fences): a run of N backticks is closed by the next run of exactly N backticks on the same line. With no closing run the backticks are literal.
  - Indented code blocks are not code.
- `parseWikilinks(text)` returns `[{start, end, target, label, line}]` in document order.
  - Matching runs outside code regions, per line, with `/\[\[([^\[\]|\n]+?)(?:\|([^\[\]\n]*?))?\]\]/g`.
  - `target = normalizeTitle(group1)`; matches with an empty target are dropped.
  - `label` is group2 trimmed, `""` when the `|` has nothing after it, `null` when there is no `|`.
  - `start` and `end` cover `[[...]]`. `line` is the source line, trimmed and cut to 160 code points.
  - Invalid targets are included; callers filter with `validateTitle`. Invalid targets are never edges, backlinks or rewritten.
- `rewriteWikilinks(text, oldKey, newTitle)` returns `{text, count}`. Each match with `titleKey(target) === oldKey` (and a valid target) becomes `[[newTitle]]`, or `[[newTitle|<original group2, untrimmed>]]` when a `|` was present. All case variants are rewritten; code regions never are; everything else stays byte-identical.

### Rename
- New title identical to the stored title: 200, nothing changes on disk, `updated: []`.
- A case-only change is allowed: the file is renamed through a tmp name.
- Otherwise the file is moved without clobbering (hard link plus unlink). Then every note, including the renamed note's own self-links, is rewritten from fresh bytes and written atomically only when `count > 0`.
- `updated` lists the other notes that were rewritten, sorted by key. Write failures go to `failed` and the loop continues.
- Notes whose links did not change keep identical bytes.
- `revision` is the renamed note's revision after any self-link rewrite.

### Search
- `ql = normalizeTitle(q).toLowerCase()`. Empty `ql` gives `{query:"", total:0, results:[]}`. `query` echoes `normalizeTitle(q)`.
- Matching is literal (no regex syntax). A note matches when `key.includes(ql)` (`titleMatch`) or the body contains `ql` case-insensitively. Notes whose lowercase form changes length use an escaped `iu` regex.
- Order: `titleMatch` true first, then modified desc, then key asc.
- Body match snippet: a window of about 120 UTF-16 units around the first body match.
  - `start = max(0, idx - floor((120 - matchLen)/2))`, `end = min(len, start + 120)`, then `start = max(0, end - 120)`. The window never splits a surrogate pair.
  - `...` is prefixed when `start > 0` and appended when `end < len`. Newlines are kept.
  - `ranges` are `[start, end)` offsets into the returned `snippet` (including the 3-character prefix), one per non-overlapping match fully inside the window, ascending. For each, `snippet.slice(s, e).toLowerCase() === ql` (when lowercasing keeps the length).
- Title-only match: snippet is the first 120 units of the body (plus `...` if cut), `ranges` is `[]`.
- Files over 8 MiB are listed but never searched or linked.

### Graph
- `nodes`: one per note, sorted by key.
- `edges`: one per unordered pair of distinct notes where either links to the other with a valid, existing target. Self-links, missing and invalid targets are excluded; mutual links give one edge. Each edge is `[a, b]` in stored titles with `key(a) < key(b)`, sorted by `(key(a), key(b))`.
- `orphan` is true when a node has no edge. An empty vault gives `{nodes:[], edges:[]}`.

### Vault file mapping
- A note is a regular file (lstat) directly in the vault whose name ends in lowercase `.md` and whose stem, NFC-normalised, passes `validateTitle`. The title is that stem.
- Ignored (not listed, never readable or writable through the API, never modified or deleted by the app): subfolders and their contents; other extensions (`notes.txt`, `X.MD`); dotfiles (`.hidden.md`, `.wiki.lock`, `.wiki-*.tmp`); symlinks, even to a `.md` file inside the vault; directories named `*.md`; files with invalid stems (logged once on stderr).
- Two files with the same key: the filename that sorts first by code unit wins (`Ideas.md` before `ideas.md`). The other is skipped and logged once.
- Save and delete act on the existing on-disk filename. Create and rename write `normalizeTitle(title) + ".md"`.
- Creating a title whose filename already exists as a non-note (for example a symlink) gives 409 `title_exists` with `existing` set to the requested title, and nothing is overwritten.
- Writes are atomic: tmp file `.wiki-<pid>-<8hex>.tmp`, fsync, rename. Files are created with mode 0644. A failed write leaves the old file intact (503).

### Outside edits
- List, backlinks, search, graph, create and rename run a stat scan first. Files added, changed (ino, mtime or size) or removed by another program show up on the next such request, with no restart.
- Single-note GET and PUT always read the file itself. An outside edit after the client's GET makes that client's PUT return 412, and the outside bytes stay.

## Shared-module import contract
The acceptance suite may run `import { normalizeTitle, titleKey, validateTitle, TITLE_MESSAGES, MAX_TITLE_LENGTH, MAX_TITLE_BYTES } from "../public/js/titles.js"` and `import { scanCode, parseWikilinks, rewriteWikilinks } from "../public/js/wikilink.js"`. Neither module may touch `document`, `window` or Node built-ins at import time. Both are served at `/js/titles.js` and `/js/wikilink.js`.

## Acceptance criteria (brief SC to HTTP-checkable test)
Visible tests: `acceptance/api.acceptance.test.js`, `acceptance/vault.acceptance.test.js`, `acceptance/shared.acceptance.test.js`, `acceptance/hardening.acceptance.test.js`. Each spawns the server with a temp `VAULT_DIR` and `PORT=0`. A holdout set also grades the result.

| SC | What the tests check over HTTP |
|---|---|
| SC1 | Ready line; vault created with no non-dot entries; `GET /` 200 shell; create `Welcome`; PUT content; GET returns it; file bytes equal it |
| SC2 | Create `Ideas` returns 201; a duplicate in any case gives 409 with `existing`; `parseWikilinks` labels |
| SC3 | Backlinks list and snippet; removal after PUT; self excluded; case-variant links; links in code ignored |
| SC4 | Rename moves the file and rewrites `[[Ideas]]`, `[[ideas]]`, `[[Ideas|my ideas]]` (code untouched); `updated`; 409 on an existing title (any case) with every file's bytes unchanged; case-only rename; identical rename is a no-op |
| SC5 | Every title rule's code and message via POST and rename; traversal URLs 404 with no `TOPSECRET` in the body; no files appear inside or outside the vault |
| SC6 | Hostile content stored and returned byte for byte as JSON; served JS has no `innerHTML`, `outerHTML`, `insertAdjacentHTML` or `document.write`; `index.html` has no inline script body, `<style>` or `style=`; CSP header present |
| SC7 | 428 without If-Match; 412 with `currentRevision` after another PUT or an `fs` edit, file unchanged; revision equals sha256-32 of the bytes |
| SC8 | Case-insensitive search, ordering, snippet and range invariants, empty q, missing q gives 400, literal `<b>`. Perf: with 5,000 generated notes (10 MB), the median of 3 `GET /api/search?q=quarterly` after one warm-up is under 300 ms |
| SC9 | Graph nodes, edges and orphan flags for the ux.md check-19 vault. Perf: 1,000-note `GET /api/graph` under 1 s |
| SC10 | An external add, change or delete appears without restart; subfolder, `.txt`, `.MD`, dotfile, symlink and duplicate-key handling; delete removes only that file; list order |
| Hardening | 403 `bad_host` and `bad_origin`, cross-site `Sec-Fetch-Site`, 405 + `Allow` (OPTIONS too), 413 `too_large` and `note_too_large`, 415, 400 `bad_request`, security headers on API, static and shell responses, `Cache-Control: no-store`, static allow-list and SPA fallback, served HTML/JS contains every ux.md `data-testid`, lock (second server on the same vault exits 1), `HOST=0.0.0.0` exits 1 |

Only checkable in a browser, so left to the phase 7 walkthrough: ux.md UI checks 1-31 as far as they involve rendering, dialogs, focus, live regions, clipboard, layout at 1280, 390 and 320 px, themes and contrast, reduced motion, axe scans, client-side perf (checks 18 and 21), the leave guard and the create-on-click flow.

## Out of scope
Accounts, sync, multi-user, plugins, subfolders, attachments, tags, WYSIWYG, embeds, `#heading` links, file watcher, persisted index, export, three-way merge, non-loopback hosting, HEAD and conditional GET.

## Verify command
`cd examples/wiki && node --test "acceptance/*.test.js" "tests/*.test.js"`. Config `verify.config.json`: at least 40 tests, 80% line coverage, plus the mutation and holdout gates (the holdout path is set by the orchestrator). Acceptance tests are read-only for builders; unit tests go in `tests/`.

## Constraints
- Node >=22 built-ins only, zero dependencies, ESM, no build step.
- `vault/` is gitignored. `src/vault.js` is the only module touching the vault.
- No `innerHTML`, `outerHTML`, `insertAdjacentHTML` or `document.write` in `public/js`. No inline script or style in `index.html`.
- Do not edit `acceptance/`.
- `security-reviewer` reviews `titles.js`, `vault.js`, router path parsing and `markdown.js` in phase 6.

## Resolved ambiguities (spec over design.md / ux.md)
1. Error codes design.md left unnamed: Host and Origin give `bad_host` and `bad_origin`; wrong method is `method_not_allowed`; a bad or missing search q is `bad_request`.
2. `modified` is an ISO 8601 UTC string.
3. The 415 check applies to POST and PUT only.
4. Unknown body keys are ignored. Non-flat bodies get 400.
5. Check order is pinned. The rename source 404 comes before new-title validation.
6. `If-Match: *` and weak ETags count as a mismatch.
7. Exact snippet window formula; ranges index the returned snippet including the `...` prefix.
8. `parseWikilinks` returns invalid targets too. `label` is `""` vs `null`.
9. Graph edge orientation and sort order, and node sort order.
10. Backlink snippet comes from the first matching link in the source note.
11. Control characters include U+007F.
12. The reserved-name message quotes the part before the first dot as typed.
13. `.wiki.lock` lives in the vault, which contradicts ux.md checks 1, 8 and 23 ("empty", "listing is exactly"). Tests compare listings with dot entries filtered out.
14. A symlink or other non-note occupying the target filename gives 409 `title_exists` with `existing` set to the requested title.
15. HEAD and OPTIONS give 405. No 304.
16. The search query length is counted after NFC and trim.
17. External-edit pickup relies on a change in ino, mtime or size. Tests make outside edits change the size (append). Conflicts are hash-based and do not depend on this.
18. `TITLE_MESSAGES`, `MAX_TITLE_LENGTH` and `MAX_TITLE_BYTES` are new exports so tests can import the messages.
19. Server-side perf budgets (300 ms search, 1 s graph) are new; they support SC8 and SC9, and the browser checks still apply.
20. `title_exists` is included in `TITLE_MESSAGES` so the client and server share it.
21. A note whose title and body both match: title-match rule applies (`titleMatch` true), snippet is the body window around the first body match if there is one, ranges as for a body match.
22. A non-string `content` (including `null`) on POST or PUT is 400 `bad_request`. The BOM is kept on GET (bytes round-trip). Files over 8 MiB are not searched at all, even by title match in the body, but title matches still list them with an empty snippet and `ranges: []`.
23. A missing Host header must give 403 `bad_host` (Node's `requireHostHeader` must be false). On 413, write the response, then destroy the request on `finish`.
24. A title containing a lone (unpaired) UTF-16 surrogate is rejected by `validateTitle` with `title_control` and the same message as other control characters; such a title cannot be written to a file name.
