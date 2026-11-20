# Spec: constellation

## Goal
A local-first Markdown notebook drawn as a night sky. Every note is a star, every `[[link]]` joins stars into constellations, and a link to a missing note is a dim hollow "unlit" star. Notes stay plain `<Title>.md` files in one vault folder. The product is the wiki core (`examples/wiki`) copied and extended: the wiki's vault, title, link, rename, search, conflict and security behaviour are kept, a deterministic sky API is added (`GET /api/sky`), and the browser UI is replaced by a Canvas 2D sky plus a complete no-canvas list path. Node 22, zero dependencies, ESM (`"type": "module"`), no build step, vanilla browser JS in `public/`.

Sources: `docs/product/constellation/brief.md` (what), `design-direction.md` (look and motion numbers), `ux.md` (behaviour, copy, testids, checks 1-60), `design.md` (architecture), `decisions.md`, and `examples/wiki/spec.md` (the core being extended; it stays normative for everything not changed here). Where this spec is stricter or more exact than those documents, this spec wins (see "Resolved ambiguities", which also says which document wins in each real conflict).

## Interface (exact)
Start with `node src/server.js` (also `npm start`). Env vars:
- `PORT`: default 3000; `0` means any free port.
- `HOST`: default `127.0.0.1`; only `127.0.0.1`, `::1` or `localhost`. Anything else writes `HOST must be a loopback address; exposing Constellation needs a security review` to stderr and exits 1.
- `VAULT_DIR`: default `./vault`, resolved against cwd; created with `mkdir -p`, then realpath'd.
- `CONSTELLATION_SAMPLES`: unset, or any value other than `off`, means sample seeding is on. The value `off` (trimmed, case-insensitive) turns it off.

Startup order: stale-tmp cleanup, lock, first scan, sample seeding (see "Samples"), first sky build (warms the cache), then `listen`. So by the time the ready line is printed the sample files exist and `GET /api/sky` is served from cache.
- Once listening, stdout gets exactly one line `Constellation running at http://localhost:<actual port>` (also when HOST is `::1`).
- SIGINT or SIGTERM: close, remove `.constellation.lock`, exit 0.

Startup failures (message on stderr, exit 1; tests read stdout and stderr together):
- Port taken: `Port <N> is in use, set PORT`.
- Vault not writable: `Cannot write to VAULT_DIR <path>`.
- Live `.constellation.lock`: `Another Constellation server is using <vault>`. The lock file holds the pid as decimal text. A stale pid (ESRCH) or the server's own pid is taken over.
- Live `.wiki.lock` (a pid that is alive): `A wiki server is using <vault>`. Constellation never creates, edits or removes `.wiki.lock`. A stale `.wiki.lock` is ignored.

Boot deletes stale files matching `^\.constellation-\d+-[0-9a-f]{8}\.tmp$` in the vault. It leaves `.wiki-*.tmp` alone.

### Request checks (every request, in this order; the first failure wins)
Identical to the wiki spec except check 1 and the new routes.
1. Host must be exactly `localhost:<port>`, `127.0.0.1:<port>` or `[::1]:<port>`; a missing or other Host fails.
   - Path is `/api` or starts with `/api/`: 403 JSON `bad_host`.
   - Any other path (any method): 403 `text/html; charset=utf-8` permission page (below).
2. Route. Unknown `/api/*` (any method) or wrong segment count: 404 `not_found`. Known route, wrong method: 405 `method_not_allowed` with `Allow`. OPTIONS and HEAD are 405. No CORS headers. `Allow` values: `/api/notes` `GET, POST`; `/api/notes/:t` `GET, PUT, DELETE`; `/api/notes/:t/rename` `POST`; `/api/notes/:t/backlinks`, `/api/search`, `/api/graph`, `/api/sky`, `/api/unlit` `GET`; `/api/samples` `DELETE`; any non-API path `GET`.
3. Title segment (notes routes): split the raw path on `/` before decoding, one `decodeURIComponent`, then `validateTitle`; any failure is 404 `note_not_found` (never 400). `/api/sky/x`, `/api/unlit/`, `/api/samples/x` are 404 `not_found`.
4. POST, PUT, DELETE (including `DELETE /api/samples`): an `Origin` header, if present, must equal `http://<Host>`; `Sec-Fetch-Site: cross-site` is refused. Both give 403 `bad_origin` with message `This request did not come from the Constellation page.`
5. POST and PUT: `Content-Type` `application/json` (charset parameter allowed) else 415 `unsupported_media_type`. DELETE needs none.
6. Body over 2,098,176 bytes: 413 `too_large`, request destroyed after the response finishes.
7. Body must be valid JSON and a flat object; wrong field types, missing required fields, arrays or nested objects: 400 `bad_request`. Unknown keys are ignored.

### Responses
- Every error is JSON `{"error":{"code","message",...params}}`. Unhandled exception: 500 `internal`.
- Every `/api` response has `Content-Type: application/json; charset=utf-8` and `Cache-Control: no-store`. The 304 from `/api/sky` has no body and no content type but keeps `ETag`, `Cache-Control: no-store` and the security headers.
- Every response (API, static, shell, 403 page) carries exactly the wiki security headers: `Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`, `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-origin`.
- Static files: an allow-list loaded at boot from `public/`: `/app.css` (`text/css; charset=utf-8`) and `/js/<name>.js` (`text/javascript; charset=utf-8`). Every other non-API GET (including `/n/<title>`, `/list`, `/list/n/<title>`, `/js/graph.js`, `/js/layout.js`, `/js/../src/server.js`, `/n/%2e%2e%2fsecret`) returns 200 `public/index.html` (`text/html; charset=utf-8`). Request input is never joined to a filesystem path.
- No second stylesheet or other asset type is served (no favicon, no fonts).

### Permission page (403 on a non-API path with a bad Host)
Built once at boot from a template and the integer port. Status 403, `text/html; charset=utf-8`, `Cache-Control: no-store`, all security headers. The body has `<html lang="en">`, a `<main data-testid="forbidden-page">`, an `<h1>` `This address is not allowed`, the text `Constellation only answers at localhost on this computer.`, and `<a href="http://localhost:<port>">`. It has no script, no `<style>`, no `style=`, no stylesheet link, and never contains the request's Host value, any request text, or any note text.

### Revision, notes, search, graph, rename (carried over unchanged)
Revision rules (32 hex of SHA-256, `ETag: "<rev>"`, strong quoted `If-Match`), all note routes, title rules, wikilinks, rename, search, graph, vault file mapping and outside-edit pickup are exactly `examples/wiki/spec.md`, with only these changes (design.md section 2):
1. Startup line, HOST refusal, lock file and messages as above.
2. Tmp files are `.constellation-<pid>-<8hex>.tmp`.
3. `bad_host` on non-API paths is the HTML page; `bad_origin` message is as above.
4. New routes `GET /api/sky`, `GET /api/unlit`, `DELETE /api/samples`.
5. `GET /api/sky` alone honours `If-None-Match` (304). All other routes ignore it.
6. First-boot sample seeding unless `CONSTELLATION_SAMPLES=off`.
7. A new dotfile `.constellation-sky.json` (the sidecar). It is never listed, readable or writable through `/api/notes` (`GET /api/notes/.constellation-sky.json` is 404 `note_not_found`).
8. Rename updates the sidecar and delete prunes it ("Rename carries position").
9. `GET /api/graph` is unchanged (no unlit nodes, wiki shape and order).

Compact reminder of the wiki routes: `GET/POST /api/notes`, `GET/PUT/DELETE /api/notes/:t`, `POST /api/notes/:t/rename`, `GET /api/notes/:t/backlinks`, `GET /api/search?q=`, `GET /api/graph`. `modified` is an ISO 8601 UTC string. Title fixed messages and the `title_exists` copy are in `public/js/titles.js` (unchanged).

## New routes

### `GET /api/sky`
Runs `index.scan()` first (outside edits show up). 200 `application/json; charset=utf-8`, `ETag`, `Cache-Control: no-store`. Compact JSON (no whitespace), top-level key order `version, now, stars, unlit, unlitTotal, edges, constellations, samples`.

```json
{"version":1,"now":1763550000000,
 "stars":{"title":["How the sky works","Links and unlit stars","Start here","Writing a note","Your vault"],
          "x":[-812.4,-640.11,-731.9,-799.03,-655.6],"y":[140.2,90.77,60.1,-20.5,-60],
          "b":[0.698,0.755,0.827,0.698,0.755],"backlinks":[1,2,4,1,2],
          "mtime":[1763549990000,1763549990000,1763549990000,1763549990000,1763549990000],
          "constellation":[0,0,0,0,0]},
 "unlit":{"title":[],"x":[],"y":[],"linkedFrom":[]},"unlitTotal":0,
 "edges":[0,1,0,2,1,2,2,3,2,4,3,4],
 "constellations":[{"id":0,"name":"Start here","star":2,"count":5}],
 "samples":5}
```
(`x`, `y`, `mtime` and `now` are illustrative; everything else in this example is exact for a fresh sample vault.)

Field rules (struct-of-arrays; `S` = number of stars):
- `version` is the integer 1.
- `now`: `Math.floor(Date.now() / 600000) * 600000` at build time (10-minute bucket); a multiple of 600000 and at most the current time. Every age-dependent value uses this `now`.
- `stars.*`: one entry per note, sorted by `titleKey` ascending (code-unit compare, not `localeCompare`), `title` in stored casing. All seven arrays have length `S`.
  - `x`, `y`: world units, finite, rounded to 2 decimals (`Math.round(v*100)/100`).
  - `b`: brightness rounded to 3 decimals (`Math.round(b*1000)/1000`).
  - `backlinks`: distinct other notes with a valid link whose key resolves to this note (the length of the wiki backlinks list).
  - `mtime`: `Math.round(mtimeMs)`, integer.
  - `constellation`: integer constellation `id`, or `null` for a note not in any constellation.
- `unlit.*`: up to 2,000 missing valid link targets, chosen by `linkedFrom` descending then key ascending, then the four arrays are sorted by key ascending. `title` is the target as written in the first link to it, where "first" is the linking note that sorts first by key, then document order. `linkedFrom` is the number of distinct linking notes (an integer, not a list). `x`, `y` as for stars.
- `unlitTotal`: the uncapped count of missing valid targets.
- `edges`: flat `[a0,b0,a1,b1,...]`. Index `i < S` is `stars[i]`; index `S + j` is `unlit[j]`. One pair per unordered pair of distinct notes where either links to the other (star-star), or a star links to a drawn unlit star. Self-links, invalid targets, and links to unlit stars beyond the cap are excluded; mutual links give one edge. Each pair has `a < b`; pairs sorted by `(a, b)`.
- `constellations`: see "Constellations". Sorted by `titleKey(name)`; `id` is the position; `star` is the index of the named star; `count` the member count (2 or more).
- `samples`: the number of notes whose bytes equal a shipped sample exactly (0 to 5).
- An empty vault gives empty arrays, `unlitTotal` 0, `edges` `[]`, `constellations` `[]`, `samples` 0.

Size: at most 1,500,000 bytes for 5,000 notes, 10,000 links and 2,000 unlit stars.

### Caching, ETag, 304
- `ETag` is `"` + the first 32 hex characters of the SHA-256 of the exact response body bytes + `"`.
- The server keeps one body cache entry keyed `(index generation, sidecar generation, now bucket)` and one layout cache entry keyed by the graph signature (the sorted seed list and the sorted edge list in seed terms). Two consecutive requests with no vault change inside one `now` bucket return byte-identical bodies and the same ETag. A content edit that keeps the same links changes `mtime` (so the body and ETag change) but never reruns the layout: every `x`, `y` is unchanged.
- The sidecar generation is tracked from `vault.sidecarStat()` `(ino, mtimeMs, size)` on each sky request, outside `index.js`.
- `If-None-Match` exactly equal to the current ETag string: 304, empty body. A list, `*`, a weak `W/` form, or a stale ETag gets a normal 200.
- Tests that compare two responses tolerate a `now` bucket rollover by retrying once.

### `GET /api/unlit`
200 `{unlit:[{title, linkedFrom:[titles]}]}`: every missing valid target, uncapped, one entry per `titleKey`, sorted by key; `title` as in `/api/sky`; `linkedFrom` holds the stored titles of the linking notes sorted by key. Runs `index.scan()` first.

### `DELETE /api/samples`
Mutation checks apply; no body, no content type. 200 `{removed:[titles], kept:[titles]}`:
1. `index.scan()`.
2. For each sample title in the fixed order `Start here`, `How the sky works`, `Writing a note`, `Links and unlit stars`, `Your vault`: resolve the note by `titleKey`; skip if absent; it must be a regular file.
3. If the file bytes' revision equals that sample's shipped revision: unlink it (**removed**, stored title listed).
4. Else if the bytes start with `---\nsample: true\n---`: **kept** (an edited sample).
5. Otherwise the note is ignored (a user's own "Start here" without the marker is untouched and unlisted).
An unlink failure gives 503 `storage_error` with `error.removed` listing what was already removed; those stay removed. Each removal also drops the note's sidecar seed entry, if any. Both lists are empty when nothing matches (still 200). The sample files are never touched by any other route.

## Position determinism
Normative algorithm: `design.md` sections 5.2-5.3 (hash base point, per-component seeded force layout with exactly 60 iterations, component separation, local nudge). This spec pins constants and the observable results.

Constants: `R = 3000`, `L = 90`, `K = 60`, `DMIN = 12`, `NUDGE_CAP = 4`. Output rounding 0.01.

**Seeds** (`resolveSeeds(litKeys, unlitKeys, sidecarSeeds)`): lit notes with a sidecar entry first (key order), then the other lit notes (key order), then unlit nodes (key order). A seed already taken gets `#n` appended, smallest `n >= 1` that is free. Every ordering inside the layout is ascending seed order (code-unit compare).

**Base point**: `hashPoint(seed, salt = 0)`: for `s = salt, salt+1, ...`, `H = sha256(utf8("constellation/v1\u0000" + seed + "\u0000" + String(s)))`; read four pairs of big-endian uint32 `(a, b)` at byte offsets `8k` and `8k+4`; `u = a / 4294967296 * 2 - 1`, `v = b / 4294967296 * 2 - 1`; the first pair with `u*u + v*v <= 1` gives `[u * 3000, v * 3000]` (expression order exactly as written). Only `+ - * /` and `Math.sqrt` are used anywhere in `src/sky-layout.js` and `src/sky-seeds.js`.

Reference values (exact, deepStrictEqual or within 1e-9):

| seed | `hashPoint(seed)` | rounded to 0.01 |
|---|---|---|
| `ideas` | `[-971.8543365597725, -2767.391263972968]` | (-971.85, -2767.39) |
| `orphan` | | (-2308.84, 507.13) |
| `alpha` | | (709.97, 2400.81) |
| `welcome` | | (-2536.32, 1363.31) |
| `hub` | | (2612.49, 1119.7) |

A singleton (an unlinked, lit note that is not within 12 units of another node) stays at its base point. So a vault of three unlinked notes `Ideas`, `Orphan`, `Alpha` (pairwise at least 800 apart) must report exactly `Ideas` (-971.85, -2767.39), `Orphan` (-2308.84, 507.13), `Alpha` (709.97, 2400.81). A vault with one note `Idea two` and sidecar `{"version":1,"samplesSeeded":false,"seeds":{"idea two":"ideas"}}` reports it at (-971.85, -2767.39).

Properties (all positions are in world units):
- **P1** Same vault bytes and sidecar give bit-identical `x`, `y` across runs, restarts, ports, and Node 22 builds.
- **P2** Positions do not depend on file creation order, readdir order or mtimes. A vault built in reverse creation order gives identical `x`, `y` per title.
- **P3** Adding one note with no links in or out, whose key is not a missing target, moves no existing star by more than 8.01 on either axis, and moves no star farther than 21 units from the new star by anything (exact equality).
- **P4** Rename keeps the exact position (see below).
- **P5** Writing an unlit star (creating the missing note with `POST /api/notes`, empty content) keeps its exact position, and every other position is unchanged, while `unlitTotal <= 2000`. (Above the cap, freeing a slot can admit another unlit node and change that component.)
- All positions are finite, with at most 2 decimals.

How tests check this over HTTP: `GET /api/sky` before and after the action and compare `stars.title`/`x`/`y` by title with `===`; restart the server on the same vault for P1; build the same vault in two creation orders for P2; for P3 use a seeded generator G(50, 80) over 200 seeds (the new note's title is not linked from anywhere) and assert the 8.01 and 21 rules, plus the ux check 8 form (`<= 0.02 * (maxX - minX)`) only when `maxX - minX >= 401`.

Performance: layout of 7,000 nodes and 10,000 edges under 400 ms in a unit test; it reruns only when the graph signature changes.

## Sidecar `.constellation-sky.json`
Purpose: a star's seed outlives a rename. Never a note. Schema version 1, compact JSON plus a trailing `\n`, keys in the order `version`, `samplesSeeded`, `seeds`, then any preserved unknown keys:

```json
{"version":1,"samplesSeeded":true,"seeds":{"project ideas":"ideas"}}
```
- `seeds` maps the current key to the original seed, only when they differ; keys serialised in code-unit order. `samplesSeeded` is a boolean.

Modules: `src/sidecar.js` exports `parseSidecar(buf)` and `serializeSidecar(obj)`.
- `parseSidecar(null)` (absent) returns `{version:1, samplesSeeded:false, seeds:new Map(), extra:new Map(), readOnly:false, unreadable:false}`.
- `parseSidecar(Buffer)` returns that same shape. `seeds` and `extra` are `Map`s (never plain objects). Rules:
  - Invalid JSON, or a top level that is not a plain object, or `version` not an integer: `unreadable:true`, `samplesSeeded:true`, empty seeds.
  - Integer `version > 1`: `readOnly:true`, `samplesSeeded:true`, empty seeds (the file is never written).
  - `version === 1`: `samplesSeeded` is the value when boolean, else false. `seeds` absent or not an object: empty. Entries come from the first 10,000 keys of `Object.keys(seeds)`; an entry is kept only when both key and value are strings, `validateTitle(s).ok` and `titleKey(s) === s` for each. `__proto__` is just a key; `Object.prototype` is never touched. Other top-level keys go to `extra` and are written back.
- `serializeSidecar({version, samplesSeeded, seeds, extra})` returns a Buffer.

Vault I/O (`src/vault.js`, still the only module touching the filesystem): `readSidecar()` (lstat must be a regular file, not a symlink; size at most 1 MiB; open with `O_RDONLY|O_NOFOLLOW`; otherwise treated as absent and logged once), `writeSidecar(buf)` (tmp `.constellation-<pid>-<8hex>.tmp`, fsync, rename, mode 0644; renaming over a symlink replaces the link), `sidecarStat()`.

Corruption handling (observable over HTTP):
- Invalid, wrong-shape or `unreadable` file: stderr gets `Ignoring unreadable .constellation-sky.json` once; `/api/sky` still 200, every star at its own-key position; no seeding into an empty vault; the next sidecar write replaces the file.
- Oversized (over 1 MiB), a symlink, or a directory: treated as absent, logged once (stderr mentions `.constellation-sky.json`). A directory in the way is never replaced; writes to it fail (logged, see rename).
- `version > 1`: read-only. Renames succeed but the file is byte-for-byte unchanged and the renamed star falls back to its new key's position.
- Entries for keys that are not current notes are ignored, and pruned at the next write.
- An external change to the sidecar (new size or mtime) is picked up by the next `GET /api/sky` with no restart.
- Outside renames (`mv` in a terminal) do not update the sidecar, so that star moves to the position of its new key. Documented in the README.

## Rename carries position
In `src/rename.js`, after the file is moved and before links are rewritten (a case-only rename and an identical-title rename never touch the sidecar):
1. `seed = seeds.get(oldKey) ?? oldKey`; delete `seeds[oldKey]`.
2. If `newKey !== seed`, set `seeds[newKey] = seed`.
3. Prune entries whose key is not a current note; write via `vault.writeSidecar`.
`DELETE /api/notes/:t` removes that key's entry (prune and write only if an entry existed). If a sidecar write fails (or the file is read-only), the rename or delete still succeeds exactly as the wiki defines it; the failure is logged on stderr.

Worked cases:
- Vault `Welcome` (links `[[Ideas]]`) and `Ideas` created by `POST` (empty): positions A. Rename `Ideas` to `Project ideas`: `GET /api/sky` has no `Ideas`, has `Project ideas` at exactly the same `x`, `y`, `Welcome` unchanged, the sidecar parses to `seeds: {"project ideas":"ideas"}`. Rename it back to `Ideas`: entry removed (`newKey === seed`), same position.
- Seeds example: `resolveSeeds(["project ideas"], ["ideas"], new Map([["project ideas","ideas"]]))` gives `project ideas` -> `ideas`, `ideas` -> `ideas#1`. `resolveSeeds(["ideas","project ideas"], [], new Map([["project ideas","ideas"]]))` gives `project ideas` -> `ideas`, `ideas` -> `ideas#1`.

## Samples
Exact bytes (`src/samples.js`; UTF-8, LF, trailing newline). Each file is `---\nsample: true\n---\n\n` followed by:

| Title (file) | Body | Bytes | Shipped revision |
|---|---|---|---|
| `Start here` | `Welcome to your sky. Each note is a star, and links join stars into constellations.\n\n- [[How the sky works]]\n- [[Writing a note]]\n- [[Links and unlit stars]]\n- [[Your vault]]\n` | 197 | `37d88bda884d2da0cfadc6eca7207095` |
| `How the sky works` | `Newer notes are warm and bright. Older ones cool toward blue. Notes with many links are larger. Drag to pan, scroll or pinch to zoom, press 0 to see everything. Next: [[Links and unlit stars]]. Back to [[Start here]].\n` | 240 | `2fff4f6ac27197b085609cf5fef0dcae` |
| `Writing a note` | `Choose New star, give it a title, and write. Put a title in double square brackets to link to another note. Next: [[Your vault]]. Back to [[Start here]].\n` | 176 | `d5879e0e7d5348649893f87c6ac53bbf` |
| `Links and unlit stars` | `A link to a note that does not exist yet appears as a hollow star. Click it to write that note. Back to [[Start here]].\n` | 142 | `8bac9942e5ac216c2b4929a0e7ffaee2` |
| `Your vault` | `Every star is a plain .md file in the vault folder. Edit them anywhere. Back to [[Start here]].\n` | 118 | `0c1dcdd15fc65f14eb4a458a95799066` |

`src/samples.js` exports `SAMPLES` (array of `{title, bytes: Buffer}` in the fixed order above), `SAMPLE_REVISIONS` (object title to the revision in the table), and `isUneditedSample(title, bytes)` (true when `titleKey(title)` matches a sample and `bytes` equal that sample byte for byte).

Seeding (boot, before `listen`), only when all hold: `CONSTELLATION_SAMPLES` is not `off`; the first scan finds zero notes (non-notes such as `notes.txt`, subfolders and dotfiles do not count); the sidecar parses with `samplesSeeded !== true` (absent counts as false). Each file is written with the no-clobber tmp-plus-link path (an existing file is never overwritten), then the sidecar is written with `samplesSeeded: true`. Failure is logged and never fatal. With `off`, no file and no sidecar are written.

Observable rules:
- Empty vault, default env: after the ready line the vault holds exactly the five files (plus dotfiles); `GET /api/notes` lists 5; `GET /api/sky` shows 5 stars, 6 edges, 1 constellation `Start here`, `samples: 5`; the sidecar has `samplesSeeded: true`.
- A vault with any note, `CONSTELLATION_SAMPLES=off`, or a sidecar with `samplesSeeded: true` or `unreadable`: nothing is written, `samples` is 0 (unless sample bytes already exist).
- Removal then restart does not reseed. Deleting the whole vault folder (sidecar included) reseeds.
- Sample sky, exact (sorted keys `how the sky works, links and unlit stars, start here, writing a note, your vault`): `backlinks [1,2,4,1,2]`, `b [0.698,0.755,0.827,0.698,0.755]`, `edges [0,1,0,2,1,2,2,3,2,4,3,4]`, `constellation [0,0,0,0,0]`, `constellations [{id:0,name:"Start here",star:2,count:5}]`, `unlit` empty.
- Editing a sample (any byte) makes it an ordinary note: it no longer counts toward `samples` and `DELETE /api/samples` keeps it (reported in `kept`).
- The server never parses front-matter. Wikilinks inside it still count (the shared parser is unchanged).

## Brightness, colour, constellations
Implemented once in `src/brightness.js` (`brightness(ageDays, backlinks)`) and once in `public/js/star-style.js`; a shared vector table test keeps them equal.

```
ageDays = max(0, now - mtime) / 86400000
r = clamp(1 - ageDays / 90, 0, 1)
B = min(1, log2(1 + backlinks) / log2(17))      // saturates at 16 backlinks
b = max(0.30, 0.60 * r + 0.40 * B)
radius = 1.5 + 5 * b                            // CSS px at zoom 1; unlit stars are 4.0 and have no b
screenRadius(radius, z) = radius * clamp(sqrt(z), 0.6, 2.2)
```
Colour: piecewise-linear sRGB over stops at ages 0, 14, 90, 365 days (older than 365 is the last stop), each channel rounded with `Math.round`. Night stops `#fff0c4, #fff8e8, #dce8ff, #8fb4ff`; daylight stops `#b45309, #8c5a1e, #2f55b8, #1e3a8a`. `coreAlpha(b)` is `0.55 + 0.45 b` (night) or `0.85 + 0.15 b` (daylight). `glowAlpha(b)` is `0.10 + 0.35 b` (night) or `0.06 + 0.25 b` (daylight).

Worked examples (`b` rounded to 3 decimals as in the API; radius within 0.01; hex per channel within 0 for these exact ages):

| ageDays | backlinks | b | radius | night colour |
|---|---|---|---|---|
| 0 | 0 | 0.600 | 4.50 | `#fff0c4` |
| 0 | 1 | 0.698 | 4.99 | `#fff0c4` |
| 0 | 2 | 0.755 | 5.28 | `#fff0c4` |
| 0 | 4 | 0.827 | 5.64 | `#fff0c4` |
| 0 | 10 | 0.939 | 6.19 | `#fff0c4` |
| 0 | 15 | 0.991 | 6.46 | `#fff0c4` |
| 0 | 16 | 1.000 | 6.50 | `#fff0c4` |
| 7 | 0 | 0.553 | 4.27 | `#fff4d6` |
| 14 | 0 | 0.507 | 4.03 | `#fff8e8` |
| 45 | 3 | 0.496 | 3.98 | (between stops 2 and 3) |
| 52 | 0 | 0.300 | 3.00 | `#eef0f4` |
| 90 | 0 | 0.300 | 3.00 | `#dce8ff` |
| 200 | 0 | 0.300 | 3.00 | `#bdd3ff` |
| 500 | 0 | 0.300 | 3.00 | `#8fb4ff` |

Daylight colours at 0, 14, 90, 365 days are exactly the four daylight stops. `screenRadius(4.5, 1) = 4.5`, `(4.5, 0.25) = 2.7`, `(4.5, 4) = 9`, `(4.5, 6) = 9.9`.

Over HTTP: for every star, `b === Math.round(brightness(max(0, now - mtime) / 86400000, backlinks) * 1000) / 1000` using the response's own `now`, `mtime`, `backlinks`. A file written within the current 10-minute bucket has age 0. Fixture H (`Hub`, `L01`..`L10` each `[[Hub]]`, `Orphan`; all written now): `b(Orphan)` in [0.598, 0.601]; `b(Hub)` in [0.937, 0.940] (0.939 unless a bucket boundary passed), difference at least 0.25, `(1.5+5 b(Hub))/(1.5+5 b(Orphan)) >= 1.35`. Setting `Orphan.md` mtime to `now - 200 days` (`fs.utimes`, `now` read from the response) gives `b` 0.300.

### Constellations (`src/sky-graph.js`)
Built on the lit-only graph (star-star edges); unlit stars never join one.
1. Components with 2 or more members.
2. A component over 60 members is split by asynchronous label propagation: initial label is the member's rank in seed order; 10 fixed passes; each pass visits members in seed order and sets the label to the most frequent neighbour label, ties to the smallest label; a node keeps its own label when it ties for most frequent. Groups of 2 or more are constellations; others get `null`. Result must be deterministic and independent of input order; tests assert properties (partition, counts, order independence), not specific groupings.
3. Name: the title of the member with the highest `b` (unrounded), then most backlinks, then smallest key.
4. At most 1,000 constellations; keep the largest `count` first (ties by name key); members of dropped groups get `null`.
5. The list is then sorted by `titleKey(name)` and numbered.

Fixture C2 (`Alpha`, `A1`, `A2`, `A3` each `[[Alpha]]`; `Beta`, `B1`, `B2` each `[[Beta]]`): sorted stars `a1,a2,a3,alpha,b1,b2,beta`; `constellation [0,0,0,0,1,1,1]`; `constellations [{id:0,name:"Alpha",star:3,count:4},{id:1,name:"Beta",star:6,count:3}]`; `edges [0,3,1,3,2,3,4,6,5,6]`; `backlinks [0,0,0,3,0,0,2]`. Fixture H: sorted `hub, l01..l10, orphan`; `constellation` is 0 for indexes 0-10 and `null` for index 11; `constellations [{id:0,name:"Hub",star:0,count:11}]`; `edges [0,1,0,2,...,0,10]`.

Unlit fixture U (`Welcome.md` = `Hello.\n\nSee [[Ideas]].\n`): `stars.title ["Welcome"]`, `unlit.title ["Ideas"]`, `unlit.linkedFrom [1]`, `unlitTotal 1`, `edges [0,1]`, `constellation [null]`, `constellations []`, `/api/unlit` `{unlit:[{title:"Ideas",linkedFrom:["Welcome"]}]}`.

## Shared-module import contract
Unchanged from the wiki and byte-identical to it: `public/js/titles.js` (`normalizeTitle`, `titleKey`, `validateTitle`, `MAX_TITLE_LENGTH`, `MAX_TITLE_BYTES`, `TITLE_MESSAGES`) and `public/js/wikilink.js` (`scanCode`, `parseWikilinks`, `rewriteWikilinks`). The wiki's unit tests for them are copied unchanged. Served at `/js/titles.js` and `/js/wikilink.js`.

Pure modules the unit tests may import. All are ESM with only named exports, no side effects at import, and import-safe in Node: no `document`, `window`, `performance`, `requestAnimationFrame`, or Node built-ins at import time (server modules may import `node:crypto`). Vectors are exact unless a tolerance is given. Camera `cam = {x, y, z}` (world point at canvas centre and zoom), viewport `vp = {w, h}`, free area `fa = {x, y, w, h}` (canvas px).

### Server (`src/`)
| Module | Exports and shapes |
|---|---|
| `brightness.js` | `brightness(ageDays, backlinks) -> number` (formula above, unrounded) |
| `sky-seeds.js` | `resolveSeeds(litKeys: string[], unlitKeys: string[], sidecarSeeds: Map) -> Map<key, seed>`; `hashPoint(seed, salt = 0) -> [x, y]` |
| `sky-layout.js` | `layout({nodes: string[] (seeds, unique), edges: [seedA, seedB][]}) -> {x: Float64Array, y: Float64Array}` aligned to the input `nodes` order; values do not depend on that order; edges with unknown seeds or self pairs are ignored, duplicates collapse; output already rounded to 0.01 |
| `sky-graph.js` | `buildSkyGraph(entries, nowMs, {unlitCap = 2000} = {}) -> {stars: [{key, title, mtimeMs, backlinks, b}], unlit: [{key, title, linkedFrom}], unlitTotal, edges: [[a, b], ...]}` (stars and unlit sorted by key; edge indexes as in the API; `entries` are index entries with `key, title, mtimeMs, links:[{key, target, line}]`); `findConstellations(stars, edges, seedOf) -> {assignment: (number\|null)[], constellations: [{id, name, star, count}]}` (`edges` star-star pairs; `seedOf(key)` returns the seed) |
| `sidecar.js` | `parseSidecar`, `serializeSidecar` (above) |
| `samples.js` | `SAMPLES`, `SAMPLE_REVISIONS`, `isUneditedSample` (above) |
| `sky.js` | `createSky() -> {build({index, sidecar, sidecarGen, nowMs}) -> {body: Buffer, etag: string}, stats: {layoutRuns, bodyBuilds}}` with the two single-entry caches; `buildSky(args)` is the uncached convenience form. `stats` counters let tests prove cache hits and layout reuse |

### Client (`public/js/`)
| Module | Exports and shapes |
|---|---|
| `camera.js` | `worldToScreen(cam, vp, wx, wy) -> [sx, sy]` = `((wx-x)*z + w/2, (wy-y)*z + h/2)`; `screenToWorld(cam, vp, sx, sy) -> [wx, wy]`; `zoomAbout(cam, vp, sx, sy, factor) -> cam` (z clamped; the world point under `(sx,sy)` stays within 1e-9 unless clamped; never mutates); `panBy(cam, dxScreen, dyScreen) -> cam` with **drag semantics**: `x - dx/z`, `y - dy/z` (ArrowRight calls `panBy(cam, -64, 0)`, so camera x grows by `64/z`); `clampZoom(z)` to [0.1, 6]; `wheelZoomFactor(deltaY, deltaMode = 0) = exp(-d * 0.0015)` with `d = deltaY * (deltaMode === 1 ? 16 : deltaMode === 2 ? 400 : 1)`; `centreOn(cam, vp, fa, wx, wy, z = cam.z) -> cam` with `x = wx - (fa.x + fa.w/2 - vp.w/2)/z` (same for y); `fitCamera(bounds, fa, vp, opts = {}) -> cam`; `planFlight(from, to, vp, opts = {reduced: false}) -> {duration, at(t) -> cam}` |
| `easing.js` | `easeOut(t) = 1-(1-t)^3`, `easeInOut(t) = t<.5 ? 4t^3 : 1-(-2t+2)^3/2`, `easeRing(t) = 1-(1-t)^4` (input clamped to [0,1]; each monotone with output in [0,1]; `easeOut(.5)=.875`, `easeInOut(.25)=.0625`, `easeInOut(.5)=.5`, `easeRing(.5)=.9375`); `flightDuration(distPx, viewW) = clamp(450 + 120*log2(1 + distPx/viewW), 450, 1200)` (0 -> 450, viewW -> 570, 3 viewW -> 690, huge -> 1200) |
| `star-style.js` | `brightness`, `baseRadius(b) = 1.5+5b`, `screenRadius(r, z)`, `ageColor(ageDays, theme = "night") -> [r,g,b]` (theme `"night"` or `"daylight"`), `toHex([r,g,b]) -> "#rrggbb"` lowercase, `colorBucket(ageDays) -> 0..7`, `sizeBucket(r) -> 0..3`, `coreAlpha(b, theme)`, `glowAlpha(b, theme)` |
| `sky-model.js` | `decodeSky(json, theme = "night") -> model`; `selectEdges(model, cap = 6000) -> Int32Array` of kept edge ids (ascending); `diffPositions(prev, next, aliases = new Map()) -> [{key, kind, fromX, fromY, toX, toY}]` |
| `grid.js` | `buildGrid(xs, ys, n, cell = 128) -> {cell, minX, minY, cols, rows, cellStart: Int32Array, items: Int32Array}` (CSR; ascending index inside a cell); `queryRect(grid, x0, y0, x1, y1, out: Int32Array) -> count` (exactly the points with `x0<=x<=x1` and `y0<=y<=y1`, at most `out.length`); `nearest(grid, model, wx, wy, rWorld) -> index \| -1` |
| `labels.js` | `labelText(title)` (first 24 code points, plus `…` when cut), `labelCap(viewportW)` (24 at 390 or less, else 40), `starLabelsAllowed(z, starCount)` (`z >= 1.4`, or `z >= 0.8` when `starCount <= 12`), `placeLabels(candidates, safeRect, maxLabels, measure) -> placed[]` |
| `twinkle.js` | `assignSlots(model, radius = 60) -> Int8Array(n)` (-1 = no twinkle); `periodMs(title)`; `twinkleFactor(slot, periodMs, tMs)` |
| `focus-ring.js` | `readingOrder(stars, max = 60) -> number[]`; `nearestInCone(from, dir, candidates, coneDeg = 60) -> index \| -1` |
| `bag.js` | `mulberry32(seed) -> () => number`; `createBag(rng) -> {next(keys) -> key \| null}` |
| `frame-stats.js` | `createFrameStats(n = 120) -> {push(ms), p95(), count, total}` |
| `gestures.js` | `createGestureState()`, `onDown(state, ev)`, `onMove(state, ev)`, `onUp(state, ev)`, `onCancel(state, ev)`, `classifyWheel(ev) -> "zoom" \| "pan"` |
| `anim.js` | `createAnim() -> {start(name, t0, dur, data), cancel(nameOrKind), active(t), tokens(t), progress(name, t)}` |
| `format.js` | `pluralNotes`, `skySummary`, `skyLabel`, `linksIn`, `ageText`, `starDescription`, `removedText` |
| `markdown.js` | `stripFrontMatter(text) -> {body, skipped}`; the rest of the wiki renderer, which skips the block |
| `sky-render.js` | `drawFrame(ctx, model, view, sprites, scratch) -> {drawCalls, sprites, labels, visible}`; `makeView(overrides) -> view` |
| `sprites.js` | `buildSprites(tokens, makeCanvas) -> {glow: canvas[32] indexed colorBucket*4+sizeBucket, dust, haze}` |

Details tests rely on:
- **fitCamera**: `bounds = {minX,minY,maxX,maxY}`; padding 10% (`bw = (maxX-minX)*1.1`, same for `bh`); `z = clamp(min(fa.w/bw, fa.h/bh), 0.1, 1.0)` where a zero extent counts as infinite and both zero gives 1.0; centred on the bounds centre in `fa`. With `opts = {xs, ys, n}` and `2 <= n <= 12`: `z = min(1.6, max(z, 120 / minPairDistanceWorld))`.
- **planFlight**: world distance `d = hypot(dx, dy)`, `distPx = d * from.z`, `duration = flightDuration(distPx, vp.w)`, or 0 with `reduced` (then `at(t)` is `to` for every t). `at(0)` is `from` and `at(1)` is `to`. Position `from + (to - from) * easeInOut(t)`. Zoom: if `distPx <= 1.5 * vp.w`, `z0 * (z1/z0)^easeInOut(t)`; otherwise with `zMid = 0.7 * min(z0, z1)`: for `t < .5`, `z0 * (zMid/z0)^easeInOut(2t)`, else `zMid * (z1/zMid)^easeInOut(2t-1)`. Distance to target never increases and `z` never exceeds `max(z0, z1)`.
- **decodeSky model**: `n`, `m`, `titles` and `keys` of length `n+m` (stars first), `x`/`y` `Float64Array(n+m)`, `b`/`radius` `Float32Array(n)`, `colorBucket`/`sizeBucket` `Uint8Array(n)`, `color` hex array of length `n` (age from `json.now`), `linkedFrom` `Int32Array(m)`, `edges` `Int32Array`, `edgeKind` `Uint8Array` (0 normal, 2 touches an unlit star), `constellation` `Int32Array(n)` (-1 none), `constellations`, `samples`, `now`, `unlitTotal`, `bounds` (all `n+m` points; zeros when empty).
- **selectEdges**: all edge ids when `<= cap`. Otherwise drop in this order until `cap` remain: edges whose endpoints both have `b < 0.4` first (unlit endpoint counts as 0.30), lowest `b_a + b_b` first, ties dropping the larger edge id first; then the rest by the same rule.
- **colorBucket / sizeBucket**: nearest sample, ties to the lower index. Colour sample ages `[0, 7, 14, 45, 90, 180, 270, 365]` (so 0->0, 7->1, 14->2, 45->3, 90->4, 180->5, 270->6, 365 and older->7). Size sample radii `[3, 4.5, 6, 7.5]` (3.0->0, 4.5->1, 6.5->2, 7.5->3, 3.75->0).
- **nearest**: Euclidean distance `<= rWorld` over all `n+m` points; the nearest wins; ties go to the higher `b` (unlit counts 0), then the lit star, then the smaller index.
- **placeLabels**: `candidates` are already in priority order: `[{text, x, y, r, kind: "star"|"constellation", focused?: boolean}]` (screen px, `r` screen radius, `text` already truncated); `measure(text) -> {w, h}`; `safeRect {x, y, w, h}`. Rect size is `(w+8, h+8)`. Sides tried in order right, left, above, below with an 8 px gap from the star edge (`right`: rect left = `x + r + 8`, vertically centred; `left`: rect right = `x - r - 8`; `above`: rect bottom = `y - r - 8`, horizontally centred; `below`: rect top = `y + r + 8`). A rect is accepted when it is inside `safeRect` and has zero overlap area with every placed rect (touching edges is fine). Returns `[{index, text, kind, x, y, w, h, side, chip}]` in placement order, each rect `{x, y, w, h}` being the padded rect. With a `focused` candidate the others are capped at `maxLabels - 1`; the focused label is placed last, tries the four sides without overlap first, and otherwise falls back to `right` clamped into `safeRect`; it always has `chip: true`; the others `chip: false`. Never more than `maxLabels` rects. Deterministic.
- **assignSlots**: greedy by index order, 6 slots; each star takes the smallest slot not used by an already-assigned star within distance `<= 60`; if none is free it gets -1. For every pair of twinkling stars within 60, slots differ. `periodMs(title) = 3200 + fnv1a32(utf8(title)) % 3201` (offset 2166136261, prime 16777619, `Math.imul`, unsigned); `periodMs("Start here") = 6345`, `periodMs("Ideas") = 3491`. `twinkleFactor(slot, period, t) = 1 + 0.10 * sin(2*pi*t/period + slot*pi/3)`, and exactly 1 for slot -1; always within [0.9, 1.1].
- **readingOrder**: `stars` is `[{index, title, sx, sy, b}]` (screen coordinates already limited to the free area). Keep the `max` brightest (by `b` desc, then title, then index) and return their `index` values sorted by `floor(sy/48)`, then `sx`, then title (code-unit). `nearestInCone(from {sx, sy}, dir "left"|"right"|"up"|"down", candidates [{index, sx, sy}], coneDeg)`: the nearest by Euclidean distance among candidates at distance > 0 whose direction is within `coneDeg/2` of `dir` (boundary inclusive); ties to the smaller index; -1 when none.
- **bag**: `mulberry32(1)()` is `0.6270739405881613`, then `0.002735721180215478`, then `0.5274470399599522`. `next(keys)` follows design.md 9.10: drops vanished keys, refills and shuffles (Fisher-Yates) when empty, never repeats the last key at a refill when `keys.length >= 2`, appends newly seen keys at a random position, returns `null` when `keys` is empty. Five calls on 5 or more keys give 5 different keys.
- **frame-stats**: `p95()` is the nearest-rank value over the held samples (sorted ascending, rank `ceil(0.95 * len)`), 0 when empty; `count` is the number held (at most `n`), `total` the number ever pushed.
- **gestures**: events are `{pointerId, x, y, pointerType, t}`. Actions: `{type: "none"}`, `{type: "pan", dx, dy}`, `{type: "pinch", factor, cx, cy, dx, dy}`, `{type: "tap", x, y, pointerType, t}`, `{type: "release", vx, vy}`. One pointer moving more than 4 px from its down point latches a drag; the first `pan` carries the whole displacement since the down point, later ones the delta since the previous event, so the sum equals the total movement. Two pointers make `pinch`: `factor = dist / previousDist`, `(cx, cy)` the current midpoint, `(dx, dy)` the midpoint delta since the previous event. When one finger of a pinch lifts the gesture ends (the other pointer is ignored until all are up). `onUp` of a single pointer that never exceeded 4 px is a `tap`; after a drag it is `release` with velocity in px/s from the last 100 ms of moves (0, 0 when the last move is older than 100 ms). `onCancel` resets. `classifyWheel({ctrlKey, deltaMode, deltaX, deltaY})` is `"zoom"` when `ctrlKey`, or `deltaMode !== 0`, or (`deltaX === 0` and `deltaY` an integer with `abs >= 50`); otherwise `"pan"`.
- **anim**: `start` with `dur <= 0` records nothing. An animation is active for `t0 <= t < t0 + dur`. `tokens(t)` is the active names joined by single spaces in the order `intro flight zoom inertia lit-grow lit-ring lit-lines settle fade`, or `none`. `progress(name, t)` is clamped 0..1 (0 before start, 1 when finished or unknown). `cancel("camera")` cancels `flight`, `zoom` and `inertia`; `cancel(name)` that name; `cancel()` all. Starting a name again replaces it.
- **format** (ux.md copy): `pluralNotes(n)` is `5 notes`, `1 note`, `0 notes`; `skySummary(n, c)` is `5 notes, 1 constellation`; `skyLabel(n, c)` is `Sky of 5 notes, 1 constellation`; `linksIn(n)` is `4 links in`, `1 link in`, `No links in`; `ageText(mtime, now)` with `d = floor(max(0, now-mtime)/86400000)`: `Edited today` (d=0), `Edited yesterday` (1), `Edited N days ago` (2 to 30), else `Edited YYYY-MM-DD` (UTC date of `mtime`); `starDescription({title, kind, mtime, now, backlinks, constellationName, linkedFrom})` is `Start here. Edited today. 4 links in. Constellation Start here. Press Enter to open.` or `Ideas. Edited 3 days ago. No links in. Not in a constellation. Press Enter to open.` or, for `kind: "unlit"`, `Ideas. Not written yet. Linked from 1 note. Press Enter to write it.` (`Linked from 2 notes`); `removedText(removed, kept)` is `Removed 5 sample notes.`, `Removed 1 sample note.`, and with `kept > 0` appends ` 1 you edited was kept.` or ` N you edited were kept.`.
- **stripFrontMatter(text)**: front-matter exists only when `text` starts at offset 0 with `---\n` or `---\r\n` (a BOM first means none) and a later line (line 2 to 50) is exactly `---` (terminated by `\n`, `\r\n` or the end of the text) whose last character is at offset 4096 or less. Then `body` is the text after that closing line's terminator and `skipped` the number of UTF-16 units removed; otherwise `{body: text, skipped: 0}`. The content is never interpreted.
- **sky-render**: with a recording fake 2D context, one `drawFrame` makes at most 32 core `fill()` calls, at most 3 edge `stroke()` calls (normal, active, unlit-dashed), one `stroke()` for the unlit rings, at most 800 `drawImage` calls for glow sprites, and draws in the order dust/haze, edges, sub-pixel stars, glow, cores, animated stars, unlit rings, selection ring, labels. `view` has at least `{cam, vp, theme, tMs, selected, labels, twinkleOn}`; `makeView` fills defaults. It culls with `grid.queryRect` (viewport plus 64 px) and allocates nothing per frame.

## Browser-checkable only
The ux.md checks below involve rendering, focus, motion, layout or touch, so they are left to the phase 7 browser walkthrough (all of ux.md checks 1-60 run there; the HTTP-reachable parts are in the table in the next section):
- Canvas state contract: `[data-testid="sky-canvas"]` carries `data-ready`, `data-star-count`, `data-unlit-count`, `data-edge-count`, `data-constellation-count`, `data-camera` (`"x,y,z"`, x and y 2 decimals, z 3), `data-viewport`, `data-free-area`, `data-animating`, `data-lit-progress` (2 decimals), `data-static-ring`, `data-motion`, `data-twinkle`, `data-focused-star`, `data-focused-kind`, `data-focused-x`, `data-focused-y` (1 decimal), `data-focused-base-radius` (2), `data-focused-brightness` (3), `data-focused-rendered` (3), `data-focused-color` (lowercase hex), `data-focus-index` (`k/n`), `data-hover-star`, `data-visible-star-count`, `data-label-count`, `data-dust-offset`, `data-frame-count`, `data-frame-p95` (1 decimal). The attribute table in `ux.md` is authoritative; flush timing and sampling are in `design.md` 9.11. `[data-testid="sky-labels"]` rows carry `data-title`, `data-text`, `data-kind`, `data-focused`, `data-x`, `data-y`, `data-w`, `data-h`.
- All data-testid names in the `ux.md` "data-testid table", with `search-result` as the search option element (check 27's `search-option` is not a testid).
- Ring and lit sequence timing, flights (check 22-24, 34), keyboard model (45-47), gestures (36-38, 48), labels (42-43), twinkle (44), parallax (35, 41), themes and contrast (58-59), fonts and requests (60), axe (31), states (54-57), phone and layout (36-40), client perf (26-27 frame timings), leave guard and delete flow (52).
- Reduced motion (32-35), the no-sky path (29-30), sky search combobox and list sorting (49-51).

## Acceptance criteria (brief SC to HTTP-checkable tests)
Visible tests in `acceptance/`: ported `api`, `vault`, `shared` and `hardening` suites (the wiki suites with only the design.md section 2 edits), plus new `sky.acceptance.test.js`, `samples.acceptance.test.js`, `sidecar.acceptance.test.js`. The spawn helper sets `CONSTELLATION_SAMPLES=off` unless a test asks for seeding, and each test uses a temp `VAULT_DIR` and `PORT=0`. A holdout set may also grade the result.

| SC / ux check | What the tests check over HTTP |
|---|---|
| SC1 (checks 1, 5, 6) | Ready line; with seeding on the five files exist with `sample: true` before the ready line; sample sky exactly as above; `samples: 5`; `DELETE /api/samples` removes 5 (and 4 + 1 kept after an edit); a vault with `Mine.md` is not seeded; restart after removal does not reseed |
| SC2 (checks 7, 8) | P1-P3 over G(50, 80); restart equality; creation-order independence; content-only PUT leaves `x`, `y` identical; ETag and 304 behaviour |
| SC3 (checks 9-11, 17) | Fixture U unlit fields; `/api/unlit`; P5; hostile titles refused with the wiki codes and no file created |
| SC4 (checks 12-14) | Fixtures H and C2, the brightness table, the 200-day case, `b` self-consistency |
| SC5 (checks 15, 16) | Rename keeps exact `x`, `y`; sidecar content; 409 on existing title (any case) changes nothing; rename-back clears the entry; read-only sidecar |
| SC6 (checks 17-19) | Hostile content stored and returned byte for byte; 200-character title accepted; served JS has no `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval`, `new Function`, or string `setTimeout`; `index.html` has no inline script body, `<style>` or `style=`; CSP header has no `unsafe-inline` or `unsafe-eval` |
| SC7 (checks 20, 21) | 428 without If-Match; 412 `conflict` with `currentRevision`; file keeps the first writer's bytes |
| SC8 (checks 22-25, API parts) | Search results and ordering per the wiki; `GET /api/sky` titles support the fly-to set |
| SC9 (checks 26-28, API parts) | 1,000-note `GET /api/sky` under 1 s; 5,000 notes and 10,000 links: ready line within 3 s, body at most 1,500,000 bytes, median of 3 warm `GET /api/sky` under 300 ms, one `PUT` that adds a link then `GET /api/sky` (cold layout) under 1 s, search median under 300 ms; 100 notes with 2,500 missing links give `unlit.title.length` 2000, `unlitTotal` 2500, `/api/unlit` 2500 entries |
| SC10 (checks 29-30, API parts) | Everything the list path needs exists over HTTP: notes, backlinks, search, `/api/unlit`, `/api/sky` constellations |
| Check 53 | External add, change, delete, subfolder, `.txt` show up in `/api/notes` and `/api/sky` without restart |
| Check 57 | `GET /` and `GET /n/x` with `Host: evil.example`: 403 HTML permission page, security headers, body has `This address is not allowed.`, `data-testid="forbidden-page"`, no Host echo, no note text; `GET /api/sky` with that Host: 403 JSON `bad_host` |
| Hardening | Everything the wiki hardening suite checks, with the new names and messages: ready line, lock messages (live `.constellation.lock`, live `.wiki.lock`, stale takeover), `HOST=0.0.0.0` refusal text, `bad_origin` message, 405 + `Allow` for every route (including `/api/sky`, `/api/unlit`, `/api/samples`), 404 for `/api/sky/x`, security headers on API, static, shell, 304 and 403 page, static allow-list, `/js/graph.js` and `/js/layout.js` fall back to HTML, every ux.md data-testid appears literally in `index.html` or a served `/js/*.js` file or the permission page (the test reads `docs/product/constellation/ux.md`, takes every backticked token in the first column of the data-testid table, and requires each as a full literal string) |
| SC11, SC12 | Browser only |

## Out of scope
Everything the brief lists as out: ambient sound, WebGL and 3D, accounts, sync, plugins, subfolders, attachments, tags, WYSIWYG, placing stars by hand, themes (beyond following the system), sharing, a mobile app, non-loopback hosting. Also: a time-lapse, user-named constellations, star colours from front-matter, a minimap, a persisted layout cache, a file watcher, HEAD and conditional GET on note routes, a browser-side layout, polling for changes.

## Verify command
`cd examples/constellation && node --test "acceptance/*.test.js" "tests/*.test.js"`.

`verify.config.json` (copied from the wiki and adjusted): `testCommand` as above; `srcDirs` `["src", "public/js"]`; `minTests` 120; coverage `minLines` 80 and `minFileLines` 60 with no excludes (pure modules should reach 95% each; thin glue is tested with a fake DOM); `testQuality` dir `tests`, 3 assertions per file; mutation gate copying `package.json`, `src`, `public`, `tests`, `acceptance`; holdout command `node --test "${HARNESS_HIDDEN_DIR:-holdout}/*.test.js"` with the holdout path set by the orchestrator. Acceptance tests are read-only for builders; unit tests go in `tests/`. Three non-browser tests must stay green: `contrast.test.js` (reads `app.css` tokens, checks `design-direction.md` section 9), the easing monotonicity test, and the twinkle and layout determinism tests.

## Constraints
- Node >=22 built-ins only, zero dependencies, ESM, no build step.
- `vault/` is gitignored. `src/vault.js` is the only module touching the vault, the sidecar included.
- `public/js/titles.js`, `public/js/wikilink.js`, `src/search.js`, `src/revision.js`, `src/errors.js` and `src/index.js` are byte-for-byte copies of the wiki files; the product name or lock changes live elsewhere.
- No `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval`, `new Function` or string `setTimeout` in `public/js`. No inline script or style in `index.html`, and no `style=` attributes; the canvas is sized through CSSOM. Titles and bodies reach the DOM only through `textContent` and `setAttribute`, and the canvas only through `fillText` and `strokeText`.
- `src/sky-layout.js` and `src/sky-seeds.js` contain no `Math.sin`, `cos`, `tan`, `atan`, `atan2`, `log`, `log2`, `log10`, `exp`, `pow`, `hypot`, `cbrt` and no `**` (a source scan enforces it).
- The browser never runs a layout; `public/js/graph.js` and `public/js/layout.js` do not exist.
- Do not edit `acceptance/`.
- `security-reviewer` (phase 6) reviews `sidecar.js`, the sidecar I/O in `vault.js`, `samples.js` and the removal route, router changes, `markdown.js` `stripFrontMatter`, and the label, card and tooltip DOM code.

## Resolved ambiguities
Which document wins is stated in each item.
1. **Seeding trigger.** `ux.md` says samples are written when the vault has "no `.md` files at server start". `design.md` adds a sidecar marker so removed samples never return. **design.md wins** (decision 11, section 8.2). A vault that had notes at first boot and is later emptied does reseed on restart if the sidecar lacks `samplesSeeded: true`.
2. **What counts as an unedited sample.** `brief.md` says unedited notes carrying the marker; `design.md` uses exact bytes. **design.md wins**: only byte-identical sample files are removed or counted; a user note with `sample: true` is never deleted, and an edited sample is kept.
3. **`unlit.linkedFrom` type.** `ux.md` leaves it open. **design.md wins**: a count in `/api/sky`; the names come from `/api/unlit`.
4. **Wiki acceptance tests "must pass unchanged".** `ux.md` says so; `decisions.md` 8 and `design.md` 14 show two cannot. **decisions.md and design.md win**: a test-owner agent ports the suite with only the design.md section 2 edits and `CONSTELLATION_SAMPLES=off`.
5. **Non-loopback Host.** `ux.md` says 403 with the permission text. **design.md wins**: HTML page on non-API paths, JSON `bad_host` on `/api`. A bad `Origin` only occurs on mutations (all under `/api`), so it is always JSON `bad_origin`.
6. **SC2 "2% of the view width".** The guarantee is 8.01 world units (design.md P3), at most about 1% of a 1280 px view at default zoom. **design.md wins** for the tests: assert 8.01 and the 21-unit exact-equality rule; the ux check 8 form is asserted only when the x-extent is at least 401.
7. **`.wiki.lock` handling.** `brief.md` assumed different lock names keep the wiki and Constellation apart. **design.md and decision 7 win**: Constellation also refuses to start on a live `.wiki.lock`.
8. **`index.js` unchanged versus "the scan also stats the sidecar".** `design.md` 1.1 says `src/index.js` is byte-identical, section 4.4 says the scan stats the sidecar. **Both cannot hold; 1.1 wins**: the sidecar generation is kept in `sky.js` from `vault.sidecarStat()`.
9. **`tests/revision.test.js`.** `design.md` 1.1 lists it as copied, but the wiki has no such file. Copy the existing unit tests of unchanged modules only; T1 adds a small `tests/revision.test.js`.
10. **`search-option` in check 27.** The data-testid table (single contract) has `search-result`. **ux.md table wins**; `search-option` is not a testid.
11. **Hub brightness.** `ux.md` and `design-direction.md` quote 0.938; the formula gives 0.938541 which rounds to 0.939 at 3 decimals. **The formula wins**; tests accept [0.937, 0.940] and the self-consistency check is exact.
12. **Colour buckets.** `design-direction.md` calls for 8 colour buckets but lists 7 sample ages. **This spec wins**: samples at 0, 7, 14, 45, 90, 180, 270, 365 days.
13. **Twinkle neighbour rule.** "Within 60" is taken as distance `<= 60`, and stars with no free slot among 6 get -1 (design.md decision 9).
14. **Cores batched by 4 alpha steps.** `design-direction.md` says "about 12 fill calls"; **design.md wins** (decision 10): at most 32 core fills.
15. **Focused label versus "no two label rects intersect" (check 42).** The focused label may need to overlap (design.md 9.6: drawn last as a solid chip). **This spec wins**: it first tries four non-overlapping sides and only then overlaps; check 42 runs with nothing focused.
16. **`panBy` sign.** `ux.md` says arrows pan the camera `+64/z`, and check 48 says a drag right moves the camera `-100/z`. `panBy` has drag semantics; ArrowRight is `panBy(cam, -64, 0)`.
17. **Gesture pan sum.** The first `pan` after the 4 px latch carries the full displacement from the down point, so a 100 px drag moves the camera exactly `100/z` (check 48).
18. **`focus-ring.js` signature.** `design.md` lists `(visible, cam, vp)`; the functions here take screen coordinates computed by the caller with `worldToScreen`. **This spec wins.**
19. **Edge ordering and unlit title.** `design.md` sections 4.1 apply as written; unlit `title` is the first link in sorted-note then document order, and edges use `S + j` for unlit stars.
20. **Fit camera for small skies.** `design.md` 9.2 and `design-direction.md` 12 differ in wording; the formula `z = min(1.6, max(zFit, 120 / minPairDistance))` for 2 to 12 stars is pinned above.
21. **Missing or oversized sidecar treated as absent** (so an empty vault still seeds) but **corrupt or newer-version sidecar treated as already seeded**, as design.md section 6.
22. **Where errors print.** Startup failures go to stderr (the wiki spec says "prints"); tests read both streams.
23. **`CONSTELLATION_SAMPLES`.** Only `off` (trimmed, any case) disables; every other value, including `on`, `0` and empty, leaves seeding on.
24. **No favicon, no extra static assets.** A browser's `/favicon.ico` falls back to the HTML shell; nothing may add a `data:` icon (CSP `img-src 'self'`).
25. **Permission page has no stylesheet.** `/app.css` on a bad Host is also a 403 page, so the page uses browser defaults plus `<meta name="color-scheme" content="dark light">`.
26. **Time-of-day ages.** Ages use the 10-minute `now` bucket, so a file written in the current bucket has age exactly 0; client ages in cards use the response's `now`, not the clock.
27. **Wiki spec ambiguities 1-24** carry over unchanged (error code names, `modified` format, check order, snippet formula, graph order, symlink and duplicate rules, and so on), except where a numbered change in "Revision, notes, search, graph, rename" above says otherwise.
