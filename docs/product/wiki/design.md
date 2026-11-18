# Wiki: system design

Node 22, zero deps, one process, ESM, static vanilla JS UI, plain `.md` files in one vault folder, in-memory index refreshed by a stat scan, content-hash revisions. Written by the `architect` agent, saved by the orchestrator. The product lives in `examples/wiki/`.

## 1. Module layout (examples/wiki/)
- `package.json`: `"type": "module"`, `"start": "node src/server.js"`, `"test": "node --test"`, `engines.node >=22`, no dependencies. `README.md` documents PORT, HOST, VAULT_DIR and that notes are plain files.
- `src/server.js`: reads config (section 8), resolves and creates the vault, takes the lock, builds the index, starts `http.createServer` (headersTimeout 5 s, requestTimeout 15 s). Prints exactly `Wiki running at http://localhost:<actual port>` (PORT=0 allowed for tests). SIGINT/SIGTERM exit 0. EADDRINUSE: `Port N is in use, set PORT` and exit 1.
- `src/router.js`: route table, 405 + Allow, Host/Origin/Sec-Fetch-Site checks, JSON body reader (size and content-type limits), parses note titles out of the raw path, maps `WikiError(code, status, params)` to JSON.
- `src/http.js`: sendJson, sendStatic, security headers, static allow-list loaded once at boot from `public/` (URL path to {bytes, type}; never joins request input to a path). SPA fallback: any GET that is not `/api/...` and not in the allow-list returns `index.html` 200.
- `src/vault.js`: the only module that touches the filesystem. `titleToPath`, `scan()`, `readNote`, `createNote`, `writeNote(title, content, ifRevision)`, `deleteNote`, `renameFile`, atomic write, lock, tmp cleanup.
- `src/index.js`: in-memory index (entries, title map, link graph, backlinks, search data). Takes scan results; pure apart from what vault.js gives it.
- `src/search.js` (pure): `search(entries, query) -> results`, snippets and ranges.
- `src/rename.js`: rename orchestration and link rewriting (uses `public/js/wikilink.js`).
- `src/revision.js`: `revisionOf(buffer)`.
- Shared ES modules imported by both server and browser (one source of truth, no build step):
  - `public/js/titles.js`: `normalizeTitle`, `titleKey`, `validateTitle(raw) -> {ok, title} | {ok:false, code, message}`, all title error messages.
  - `public/js/wikilink.js`: `scanCode(text)` (code regions), `parseWikilinks(text) -> [{start, end, target, label, line}]`, `rewriteWikilinks(text, oldKey, newTitle)`.
- `public/`: `index.html` (one shell; no inline script/style), `app.css`. `public/js/`: `api.js` (fetch wrapper, revision handling, error mapping), `router.js` (history routing, leave guard), `markdown.js` (pure tokenizer + DOM builder), `notes.js` (list, note view, dialogs), `search.js`, `graph.js` (layout + SVG), `layout.js` (pure force layout, unit-testable), `live.js` (live regions, focus).
- `tests/*.test.js`: unit tests. `acceptance/` (human-written, read-only during harness runs): spawns the server with a temp VAULT_DIR and PORT=0.
- `vault/` is gitignored.

## 2. Vault and title mapping
- Vault = `realpath(VAULT_DIR)` after `mkdir -p`. Only regular files directly in it whose name ends in lowercase `.md` and whose stem is a valid title are notes. Subfolders, other extensions, dotfiles and symlinks are ignored (not listed, not readable through the API).
- Title to filename: `title + ".md"`, title already normalised. Filename to title: strip `.md`, NFC-normalise, validate. If it fails validation the file is skipped and logged once on stderr.
- `normalizeTitle(raw)`: `raw.normalize("NFC").trim()`. Inner spaces kept as typed.
- `titleKey(title) = normalizeTitle(title).toLowerCase()` (locale-independent). Uniqueness, lookup, wikilink resolution and rename matching all use the key.
- Validation, in this order; the first failing rule wins:
  1. empty: `title_empty` "Give the note a title."
  2. over 200 code points: `title_too_long` "Keep the title to 200 characters or fewer. It is N now."
  3. over 240 UTF-8 bytes: `title_too_long_bytes` "This title is too long for a file name. Shorten it."
  4. C0/C1 control characters or U+2028/2029: `title_control` "A title cannot contain control characters."
  5. `/` or `\`: `title_separator` "A title cannot contain / or \." (so `../escape` reports this message)
  6. contains `..`: `title_dotdot` "A title cannot contain \"..\"."
  7. starts with `.`: `title_leading_dot` "A title cannot start with a dot."
  8. contains any of `: * ? " < > | [ ] #`: `title_char` "A title cannot contain : * ? \" < > | [ ] or #."
  9. ends with `.`: `title_trailing_dot` "A title cannot end with a dot."
  10. reserved Windows device name (part before the first `.`, case-insensitive: CON PRN AUX NUL COM1-9 LPT1-9): `title_reserved` "\"CON\" is a reserved name. Choose another title."
- Case-insensitive uniqueness: create or rename fails with 409 `title_exists {existing}`: "A note called \"<existing>\" already exists. Choose another title." If two files on disk share a key (Linux), the scan keeps the filename that sorts first and logs the other once. The skipped file is never modified.

## 3. Wikilinks and Markdown (shared rules)
Code regions (`scanCode`), computed once per text:
- Fenced block: a line with 0-3 spaces then 3+ backticks or tildes opens a fence; it closes at a line of 0-3 spaces then the same character, at least the same length, then only whitespace. An unclosed fence runs to the end. The whole block is code.
- Inline code: outside fences, a run of N backticks opens a span closed by the next run of exactly N backticks on the same line. No closing run means literal backticks. (Single-line only; differs from CommonMark, documented.)
- Indented code blocks are not supported; links in them are live.

Wikilink grammar, outside code regions only:
- Regex per line segment: `/\[\[([^\[\]|\n]+?)(?:\|([^\[\]\n]*?))?\]\]/g`.
- `target = normalizeTitle(group1)`; empty target is not a link. `label` is group2 trimmed, or null; an empty label shows the target.
- Resolution uses `titleKey(target)`. A target failing `validateTitle` renders as `unsafe-link` ("Not a valid note title"), is not a graph edge or backlink, and rename never touches it.
- Each match carries `{start, end, target, label, line}`. `line` is the source line, trimmed, cut to 160 code points, used as the backlink snippet.

Rewrite (`rewriteWikilinks(text, oldKey, newTitle)`): for each match with `titleKey(target) === oldKey`, replace with `[[newTitle]]`, or `[[newTitle|<original label, untrimmed>]]` when a `|` was present. Work last to first. All case variants are rewritten; code regions never are. Returns `{text, count}`.

Markdown renderer (`public/js/markdown.js`, client only):
- Block tokenizer: fence, ATX heading, blockquote (recursive), lists (`- * +`, `\d+[.)]`, one nesting level), blank line, paragraph. Inline: code span, wikilink, `[label](href)`, strong, em, text. Images are not tokenised and show as literal text.
- Output is built only with `document.createElement` from the allow-list `h2-h6 p em strong ul ol li a code pre blockquote span br`, using `textContent` and `setAttribute`. No HTML strings anywhere, so raw HTML is plain text. A unit test fails if any file in `public/js` contains `innerHTML`, `outerHTML`, `insertAdjacentHTML` or `document.write`.
- Headings shift down one level (`#` becomes h2) so the page keeps one h1.
- Link scheme allow-list: strip ASCII whitespace and control characters, then it must match `/^(https?:\/\/|mailto:)/i`, giving `a[href][target=_blank][rel="noopener noreferrer"]`. Anything else (`javascript:`, `data:`, relative, `//host`) becomes `span[data-testid=unsafe-link]` with the label as text.
- Wikilinks become `a[data-testid=wikilink][data-target][data-state=exists|missing]`. Existing: `href=/n/<encodeURIComponent(stored title)>`. Missing: `href="#"`, dashed class, hidden "(create note)".

## 4. HTTP API
JSON only. Errors: `{error:{code, message, ...params}}`. The router splits the raw `req.url` path on `/` before decoding; wrong segment count gives 404 `not_found`. Then one `decodeURIComponent` (throw gives 404 `note_not_found`), then `validateTitle` (failure on read/update/delete/rename-source gives 404 `note_not_found`, never 400). Mutating requests need `Content-Type: application/json` (415 `unsupported_media_type`) and a body of at most 2 MiB + 1 KiB (413 `too_large`). Bad JSON or shape: 400 `bad_request`. All API responses carry `Cache-Control: no-store`.

Revision: `sha256(file bytes).hex.slice(0, 32)`, sent as `revision` and `ETag: "<revision>"`. Content only, not mtime or size.

| Method and path | Request | Success | Errors |
|---|---|---|---|
| `GET /api/notes` | | 200 `{notes:[{title, modified, size}]}`, sorted modified desc then key asc | |
| `POST /api/notes` | `{title, content?:""}` | 201 `{title, revision, modified}`, `Location` | 400 `title_*`, 409 `title_exists {existing}`, 413, 503 `storage_error` |
| `GET /api/notes/:title` | | 200 `{title, content, revision, modified}` + ETag; lookup by key, stored casing returned | 404 `note_not_found` |
| `PUT /api/notes/:title` | `If-Match: "<revision>"`, `{content}` (at most 2 MiB) | 200 `{title, revision, modified}` | 428 `revision_required`, 412 `conflict {currentRevision}`, 404, 413 `note_too_large`, 503 |
| `DELETE /api/notes/:title` | optional `If-Match` | 204 | 404, 412 `conflict` (only if If-Match sent and differs), 503 |
| `POST /api/notes/:title/rename` | `{title:newTitle}` | 200 `{title, revision, updated:[titles], failed:[{title, reason}]}` | 400 `title_*`, 404, 409 `title_exists`, 503 |
| `GET /api/notes/:title/backlinks` | | 200 `{backlinks:[{title, snippet}]}` one per source note, self excluded, sorted by key | 404 |
| `GET /api/search?q=` | q at most 200 code points | 200 `{query, total, results:[{title, titleMatch, modified, snippet, ranges:[[start,end]]}]}` | 400 if q missing |
| `GET /api/graph` | | 200 `{nodes:[{title, orphan}], edges:[[a, b]]}` | |
| other `/api/*` | | | 404 `not_found`; wrong method 405 + Allow |

- Empty `q` after trim returns `{total:0, results:[]}`.
- Static: allow-listed `/app.css`, `/js/*.js`; everything else non-API is `index.html`.
- Missing-link click: client POSTs `{title: target}`; on 409 `title_exists` it opens `existing`.

## 5. Persistence, writes and rename
- Atomic write: open `VAULT/.wiki-<pid>-<8 hex>.tmp` with `wx` mode 0o644, write, fsync, close, `renameSync` to final, fsync the directory (best effort). On error unlink tmp and throw `storage_error`. Boot deletes stale `.wiki-*.tmp`.
- Lock: `VAULT/.wiki.lock` created `wx` with the pid. Stale pid (ESRCH) is taken over; live pid exits 1 with `Another wiki server is using <vault>`. Removed on clean exit.
- Create: validate, `scan()`, key collision gives 409. Write tmp, `linkSync(tmp, final)` (EEXIST gives 409), unlink tmp. Never overwrites. Default content is empty (0 bytes).
- Save runs synchronously without `await`: resolve entry, `lstatSync` (missing or not regular gives 404), read bytes, compute revision; mismatch gives 412; else `writeAtomic` and update the index. Content stored byte for byte as sent.
- Delete: lstat, optional revision check, `unlinkSync`, drop from index. Only that file.
- Rename (synchronous):
  1. Validate new title, `scan()`, resolve old (else 404). Identical stored title returns 200 unchanged. Key of new exists and differs from old's gives 409.
  2. Move the file. Case-only change: rename via a tmp name. Otherwise `linkSync(old, new)` (EEXIST gives 409) then `unlinkSync(old)`; without hard links fall back to exists-check + `renameSync`. Failure gives 503 with nothing changed.
  3. Rewrite links in every note (renamed note's self-links included) from fresh bytes with `rewriteWikilinks`; count > 0 means `writeAtomic`. Errors go to `failed` with `write_failed`; the loop continues.
  4. Update the index; return `updated` (excluding the renamed note) and `failed`. File is moved before links are rewritten, so a crash leaves broken links, never lost notes.

## 6. Index, change detection, search, graph
- Entry: `{title, key, filename, ino, mtimeMs, size, content, lower, revision, links:[{key, target, line}]}`; `lower = content.toLowerCase()`; links hold valid targets only, de-duplicated per key.
- Derived maps `byKey`, `backlinks` rebuilt lazily when `generation` changes.
- Change detection: an on-demand stat scan. Requests that read index-wide data (list, backlinks, search, graph, create, rename) call `scan()` first: `readdirSync` with file types, keep regular `.md` files, `statSync` each, re-read only entries whose `(ino, mtimeMs, size)` changed, drop vanished ones, bump `generation` on change. Concurrent requests share one scan per tick. Single-note GET and PUT always read the file itself, so conflicts never depend on scan freshness. `fs.watch` rejected: unreliable across editors and mounts, and still needs a rescan to recover.
- Search: `ql = normalize(q).toLowerCase()`. `titleMatch = key.includes(ql)`, `bodyIdx = lower.indexOf(ql)`. Order: title matches first, then modified desc, then key. If `lower.length !== content.length` for an entry, search with an escaped case-insensitive unicode regex on `content`. Snippet: about 120 code units centred on the first match without splitting surrogate pairs, "..." when cut; `ranges` are relative to the snippet. Title-only match: first 120 code units of the body, no ranges. Client debounces 120 ms and aborts the previous request.
- Graph: nodes = all entries by key; edges = unordered existing-target pairs, no self-links, de-duplicated; `orphan` = no edge.
- Client layout (`layout.js`, pure; `graph.js` draws): deterministic sunflower seed (`r = 30*sqrt(i)`, angle `i*2.39996`); repulsion `k²/d` only between nodes in the same or adjacent cells of a grid of size `2k` (k = 40); edge springs `d²/k`; gravity `0.02*d`; temperature `50*(1 - i/300)`; hard stop at 300 iterations or max displacement under 0.5. Run iterations in 16 ms chunks until 60 iterations or 1,000 ms, then draw the SVG once (visible circle, invisible 24 px hit circle, `<title>`, label only per ux.md rule) and set `data-ready="true"`. Continue remaining iterations on `requestAnimationFrame`. `viewBox` is the bounding box plus 40 px, so orphans stay inside. With `prefers-reduced-motion`, run all iterations (cap 1,500 ms) before one draw. `graph-list` text alternative per ux.md.

## 7. Security
- Bind `HOST` default `127.0.0.1`; only `127.0.0.1`, `::1`, `localhost` accepted, else exit 1 with `HOST must be a loopback address; exposing the wiki needs a security review`. No auth, so exposure needs a human decision.
- DNS rebinding: Host header must be `localhost:<port>`, `127.0.0.1:<port>` or `[::1]:<port>`, else 403 `bad_host`.
- CSRF on POST/PUT/DELETE: `Origin`, if present, must equal `http://` + Host, else 403 `bad_origin`; `Sec-Fetch-Site: cross-site` gives 403. JSON content type forces preflight. No CORS headers; OPTIONS gives 405.
- Body streamed with a byte count; over the limit gives 413 and destroys the request. Only flat objects accepted.
- Path traversal: `titleToPath` re-runs `validateTitle`, then `path.join(vaultReal, title + ".md")` and asserts `dirname === vaultReal`. Raw path is split before decoding so `%2F` never makes segments.
- Symlinks: vault is realpath'd at boot; inside it symlinks are not notes. Reads use `lstat` and `O_NOFOLLOW`; create uses `link` with EEXIST.
- Headers: `Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`, COOP and CORP `same-origin`.
- XSS: section 3; server responses are JSON only.
- `security-reviewer` reviews `titles.js`, `vault.js`, `router.js` path parsing and `markdown.js` in phase 6.

## 8. Failure modes, limits, config, tests
Config: `PORT` (default 3000; 0 = any free port), `HOST` (default 127.0.0.1, loopback only), `VAULT_DIR` (default `./vault`, resolved against cwd).

Limits: title 200 code points and 240 bytes; save body 2 MiB; vault files over 8 MiB listed but not indexed; query 200 code points; JSON body 2 MiB + 1 KiB; no cap on note count (designed for 5,000 notes / 10 MB).

Failure modes:
- Vault not writable at boot: `Cannot write to VAULT_DIR <path>`, exit 1. Live lock or port in use: exit 1.
- fs error on write: 503 `storage_error`, old file untouched. Client shows save-error.
- 412 shows the conflict banner. 404 on save: "This note no longer exists". Network failure or 5xx: save-error, Save stays enabled.
- Partial rename: 200 with `failed`; client shows the partial copy.
- File deleted between scan and read: entry dropped, 404.
- Invalid UTF-8 decodes with U+FFFD; an in-app save writes the replacement characters. CRLF comes back as LF after an in-app save.
- Handler exception: 500 `internal`, generic message, logged. uncaughtException: log and exit 1.

Tests:
- Unit (`tests/`): titles (every rule, order, messages, NFC, key); wikilink (fences, spans, labels, case variants, invalid targets, rewrite preserving labels and code); markdown via a fake DOM (allow-list, schemes, heading shift, HTML as text); search (ordering, snippets, ranges, length-changing lowercase); layout (determinism, iteration cap, 1,000 nodes in budget); vault (atomic write, tmp cleanup, no-clobber create, symlink refusal, traversal assertion, case-only rename); index (rescan after external add/change/delete); router (Host/Origin, 413/415/428/412/405, `..%2Fsecret`); the no-innerHTML scan.
- Acceptance: ux.md checks over HTTP and Playwright; perf checks 18 and 21 use generated vaults. Coverage floor 80%.

## 9. ADRs
1. **Revision token**: SHA-256 of bytes (32 hex). Catches every real change including external edits; mtime/size only skip re-reads. Rejected: mtime, counter.
2. **Conflict protocol**: `If-Match` required on PUT (428 without), 412 `conflict`. Standard HTTP; no blind overwrite.
3. **Index freshness**: on-demand stat scan. Correct by construction, about 50 ms at 5k notes; watcher is Later.
4. **Search**: linear `indexOf` over precomputed lowercase text, regex fallback for length-changing case maps. About 10 ms at 10 MB; revisit past about 100 MB.
5. **Title charset**: portable subset (section 2) with case-insensitive NFC keys. Vaults move between OSes; other filenames are skipped with a log.
6. **Shared parser**: one ESM module in `public/js` imported by the server. Preview, backlinks, graph and rename agree by construction.
7. **Links in code**: skip fenced and single-line inline code; indented code unsupported.
8. **Rename order**: move first (link + unlink, no clobber), then rewrite atomically and report failures. A crash never loses a note.
9. **Create without clobber**: tmp + `link`.
10. **Renderer safety**: tokenizer to DOM nodes, tag and scheme allow-lists, strict CSP. No `escapeHtml` function exists by design.
11. **Graph layout**: grid-bucket repulsion, deterministic seed, 300-iteration cap, ready after 60 iterations or 1 s.
12. **Network exposure**: loopback only plus Host/Origin/Sec-Fetch-Site checks. LAN use needs a human decision.
13. **Delete safety**: If-Match optional; the UI does not send it. Accepted loss window; users can use git.

## 10. ux.md changes required by this design (applied in ux.md addendum)
1. New copy for title rules 3, 8, 9 (section 2).
2. Markdown headings render one level lower.
3. Relative Markdown links show as `unsafe-link`.
4. "Too long" counts Unicode code points after NFC and trim.
5. Case-only rename (`ideas` to `Ideas`) goes to the server and is allowed; identical string closes without a call.
6. Delete sends no If-Match; a 404 shows "Could not delete the note. Try again."
7. Reviewers should not expect an `escapeHtml` function (ADR 10).
8. The client resolves wikilinks against the note list, re-fetched on every route change and after mutations.
9. Graph `data-ready` is set after 60 iterations or 1 s; tests must not assert final positions.
