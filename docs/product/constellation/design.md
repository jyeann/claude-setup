# Constellation: system design

Node 22, zero dependencies, one process, ESM, no build step, Canvas 2D. The product is a standalone copy of the wiki core in `examples/constellation/`, with a sky API and a new browser UI added beside it. Written by the `architect` agent, saved by the orchestrator. Sources: `brief.md` (what and why), `design-direction.md` (numbers for look and motion), `ux.md` (behaviour, copy, testids, checks 1-60), `examples/wiki/spec.md` and `docs/product/wiki/design.md` (the core being extended). Where this document is more exact than ux.md or design-direction.md, this document wins for architecture and API. ux.md wins for copy, and design-direction.md wins for visual numbers.

## 0. Ground rules

- Everything in the wiki spec and the wiki design stays accepted behaviour, except the items listed in section 2: title rules, request check order, error JSON, revisions and If-Match, rename rewrite, search, backlinks, the stat-scan index, atomic writes, symlink and dotfile rules, CSP and security headers.
- The routes under `/api/notes...`, `/api/search` and `/api/graph` keep their exact contracts. That lets the wiki's acceptance rules carry over.
- New behaviour goes into new modules. A copied module is edited only where section 2 says so.

## 1. Module layout (`examples/constellation/`)

### 1.1 Copied from `examples/wiki`, byte-for-byte unchanged

| File | Note |
|---|---|
| `public/js/titles.js` | Shared title rules. The import contract is unchanged. |
| `public/js/wikilink.js` | `scanCode`, `parseWikilinks`, `rewriteWikilinks` |
| `src/search.js` | Pure search |
| `src/revision.js` | `revisionOf`, `parseIfMatch` |
| `src/errors.js` | `WikiError` and the other error classes. The class name is kept so copied tests still match. |
| `src/index.js` | The index already holds valid link targets per entry, including missing ones. That is everything the sky needs. |
| `public/js/dom.js`, `public/js/live.js`, `public/js/note-model.js` | Small client helpers, reused as-is |
| `tests/titles.test.js`, `tests/wikilink.test.js`, `tests/search.test.js`, `tests/index.test.js`, `tests/revision.test.js` | Unit tests for the unchanged modules |

### 1.2 Copied, then changed (only as listed)

| File | Change |
|---|---|
| `src/server.js` | Product name in messages. Seeds samples (section 8). Builds the sky once before `listen`. Builds the forbidden page bytes with the actual port. Reads `CONSTELLATION_SAMPLES`. |
| `src/vault.js` | Lock name `.constellation.lock`. Also refuses a live `.wiki.lock`. Tmp files are `.constellation-<pid>-<8hex>.tmp`. Adds `readSidecar()`, `writeSidecar(buf)` and `sidecarStat()`, so this is still the only module that touches the filesystem. |
| `src/router.js` | New routes `GET /api/sky`, `GET /api/unlit`, `DELETE /api/samples`. `Allow` entries for them. A non-API request with a bad Host gets the HTML permission page. The `bad_origin` message says "Constellation page". |
| `src/http.js` | `sendForbiddenPage(res, bytes)`. ETag and 304 support used by `/api/sky` only. |
| `src/api.js` | Adds `sky(ctx, ifNoneMatch)`, `unlit(ctx)`, `removeSamples(ctx)`. `deleteNote` also prunes the sidecar. |
| `src/rename.js` | One step added between "move file" and "rewrite links": record the carried seed in the sidecar (section 6). |
| `public/js/markdown.js` | `stripFrontMatter(text)` added (section 8.3). The renderer skips that block. The rest is unchanged. |
| `public/js/api.js` | Adds `getSky(etag)`, `getUnlit()`, `removeSamples()`. |
| `public/js/router.js` | Routes `/`, `/n/:t`, `/list`, `/list/n/:t`, not-found. The leave guard is unchanged. |
| `public/js/search.js` | Adds the Sky-view combobox mode (8 options, `aria-activedescendant`). List mode is unchanged. |
| `public/js/dialogs.js` | Copy for "New star" and a new remove-samples dialog. The native `<dialog>` rules are unchanged. |
| `public/js/note-view.js` | Panel or sheet container, `locate-button`, the partial-load notice `note-notice`. |
| `public/js/notes.js` becomes `public/js/list-view.js` | Sort select, `unlit-list`, `constellation-list` |
| `public/index.html`, `public/app.css` | Replaced by the new shell and the tokens from design-direction.md section 4 |

Removed: `public/js/graph.js` and `public/js/layout.js`. The browser never runs a layout. `GET /api/graph` stays on the server, unchanged.

### 1.3 New server modules

All are pure unless marked otherwise.

- `src/sky-layout.js`: `layout({nodes, edges}) -> {x: Float64Array, y: Float64Array}`. Deterministic positions (section 5). No I/O.
- `src/sky-seeds.js`: `resolveSeeds(litKeys, unlitKeys, sidecarSeeds) -> Map<key, seed>`, `hashPoint(seed, salt) -> [x, y]` (sha256 from `node:crypto`, which is pure).
- `src/sky-graph.js`: builds nodes, edges, backlink counts, the unlit selection (cap) and constellations (components plus label propagation) from index entries.
- `src/brightness.js`: `brightness(ageDays, backlinks)`, exactly design-direction.md section 5.
- `src/sky.js`: puts the pieces together. `buildSky(index, sidecar, nowMs) -> {body: Buffer, etag}`, with a two-level cache (section 4.4).
- `src/sidecar.js`: `parseSidecar(buf) -> {version, samplesSeeded, seeds: Map}` and `serializeSidecar(obj) -> Buffer`. Validation as in section 6.
- `src/samples.js`: the 5 exact sample byte strings and their precomputed revisions, plus `isUneditedSample(title, bytes)`.

### 1.4 New client modules (`public/js/`)

Every pure module must be import-safe. At import time it may not touch `document`, `window`, `performance`, `requestAnimationFrame` or Node built-ins. All of them are unit-tested under `node:test`.

| Module | Pure? | Exports (exact names) |
|---|---|---|
| `camera.js` | yes | `worldToScreen(cam, vp, wx, wy)`, `screenToWorld(cam, vp, sx, sy)`, `zoomAbout(cam, vp, sx, sy, factor)`, `panBy(cam, dxScreen, dyScreen)`, `clampZoom(z)` (0.1 to 6), `fitCamera(bounds, freeArea, vp, opts)`, `centreOn(cam, vp, freeArea, wx, wy, z)`, `planFlight(from, to, vp) -> {duration, at(t) -> cam}` |
| `easing.js` | yes | `easeOut`, `easeInOut`, `easeRing` (formulas in design-direction.md section 4), `flightDuration(distPx, viewW)` |
| `star-style.js` | yes | `brightness`, `baseRadius(b)`, `screenRadius(r, z)`, `ageColor(ageDays) -> [r, g, b]`, `toHex`, `colorBucket(ageDays)` (0 to 7), `sizeBucket(r)` (0 to 3), `coreAlpha(b, theme)`, `glowAlpha(b, theme)` |
| `sky-model.js` | yes | `decodeSky(json) -> model` (typed arrays, see section 9.1), `selectEdges(model, cap = 6000)`, `diffPositions(prev, next) -> settle list` |
| `grid.js` | yes | `buildGrid(xs, ys, n, cell = 128) -> grid` (CSR: `cellStart: Int32Array`, `items: Int32Array`), `queryRect(grid, x0, y0, x1, y1, out) -> count`, `nearest(grid, model, wx, wy, rWorld) -> index or -1` |
| `labels.js` | yes | `placeLabels(candidates, safeRect, maxLabels, measure) -> rects[]` |
| `twinkle.js` | yes | `assignSlots(model, radius = 60) -> Int8Array` (-1 means no twinkle), `periodMs(title)`, `twinkleFactor(slot, period, tMs)` |
| `focus-ring.js` | yes | `readingOrder(visible, cam, vp) -> indices`, `nearestInCone(fromIdx, dir, candidates, cam, vp)` |
| `bag.js` | yes | `createBag(rng)`, `bag.next(keys) -> key or null`, `mulberry32(seed)` |
| `frame-stats.js` | yes | `createFrameStats(n = 120)`, `.push(ms)`, `.p95()`, `.count` |
| `gestures.js` | yes | `createGestureState()`, `onDown/onMove/onUp(state, ev) -> action`, where `action` is one of `{type: "pan"\|"pinch"\|"tap"\|"none", ...}`. Also `classifyWheel(ev) -> "zoom"\|"pan"` (ux.md rule). |
| `anim.js` | yes | Timeline of named animations: `start(name, t0, dur, data)`, `cancel(kind)`, `tokens(t) -> string`, `progress(name, t)`. Produces the `data-animating` tokens. |
| `format.js` | yes | `pluralNotes`, `skySummary`, `ageText(mtime, now)`, `starDescription(...)`, `removedText(removed, kept)` (all ux.md copy) |
| `sky-render.js` | yes, given a ctx | `drawFrame(ctx, model, view, sprites, scratch) -> stats`. Takes any object with the Canvas 2D methods. It is tested with a recording fake context that counts calls and checks the draw order and batching budgets. |
| `sprites.js` | glue | `buildSprites(tokens, makeCanvas)` (32 glow sprites plus the dust tile; `makeCanvas` is injected) |
| `sky-view.js` | glue | Canvas element, resize and DPR, the render loop, pointer, wheel and keyboard wiring, the `data-*` flush, `sky-labels` DOM, star card and tooltip |
| `app.js` | glue | Shell, view switch, banner, theme and motion `matchMedia` listeners |

Coverage plan: the verify gate needs 80% line coverage over `public/js`. Pure modules should be at least 75% of client lines and reach 95% or more each. The glue stays thin, about 900 lines in total. Glue modules are still import-safe, so `tests/sky-view.test.js` can drive `sky-view.js` with a minimal fake DOM (canvas stub, `dataset`, event dispatch) for the flush, the state attributes and keyboard handling.

## 2. Wiki spec items that change (exact list)

1. Startup line: `Constellation running at http://localhost:<actual port>`.
2. HOST refusal: `HOST must be a loopback address; exposing Constellation needs a security review`, exit 1.
3. Lock: `VAULT/.constellation.lock`. A live lock gives `Another Constellation server is using <vault>`, exit 1. A stale pid (ESRCH) or our own pid is taken over, as in the wiki. **New:** if `VAULT/.wiki.lock` exists and holds a live pid, exit 1 with `A wiki server is using <vault>`. Constellation never removes `.wiki.lock`.
4. Tmp files: `.constellation-<pid>-<8hex>.tmp`. Boot deletes stale files matching `^\.constellation-\d+-[0-9a-f]{8}\.tmp$` and leaves `.wiki-*.tmp` alone.
5. Request check 1 (Host). For `/api/*`, a bad Host still gives 403 JSON `bad_host`. **For a non-API path it gives 403 `text/html; charset=utf-8` with the permission page** (section 10.2) and all security headers. The page body never echoes the Host header.
6. `bad_origin` message: "This request did not come from the Constellation page." The code is unchanged.
7. New routes and their `Allow` headers: `/api/sky` `GET`, `/api/unlit` `GET`, `/api/samples` `DELETE`.
8. Conditional GET: `GET /api/sky` alone honours `If-None-Match` with 304 (section 4.4). Note routes still ignore `If-None-Match`, and HEAD and OPTIONS stay 405.
9. First-boot sample seeding (section 8). Disabled with `CONSTELLATION_SAMPLES=off`. With seeding on, the wiki's SC1 check "vault has no non-dot entries" does not hold. The ported acceptance suite sets `CONSTELLATION_SAMPLES=off` in its spawn helper.
10. The vault gains `.constellation-sky.json`. It is a dotfile, so it is already ignored by the note mapping. It is never listed and never readable or writable through `/api/notes`.
11. Rename also updates the sidecar (section 6). Delete prunes it.
12. The hardening check "served HTML/JS contains every ux.md data-testid" reads `docs/product/constellation/ux.md`.
13. Verify command: `cd examples/constellation && node --test "acceptance/*.test.js" "tests/*.test.js"`.
14. README and product name: Constellation.

Nothing else changes: titles, routes under `/api/notes`, search, backlinks, graph, revisions, limits, CSP, static allow-list and SPA fallback all stay as they are. `/n/...` and `/list...` fall back to `index.html` like any other non-API path.

## 3. Request flow for new routes

All new routes run the wiki check order: Host, route and method, Origin and Sec-Fetch-Site for mutations, then Content-Type. `DELETE /api/samples` needs no body and no content type, like a note DELETE. `GET /api/sky` and `GET /api/unlit` call `index.scan()` first, like `/api/graph`. That is how outside edits get picked up.

## 4. `GET /api/sky`

### 4.1 Response (200, `application/json; charset=utf-8`)

The body uses struct-of-arrays. Every number array is a JSON array of numbers.

```json
{
  "version": 1,
  "now": 1763550000000,
  "stars": {
    "title":         ["How the sky works", "Links and unlit stars", "Start here", "Writing a note", "Your vault"],
    "x":             [-812.4, -640.11, -731.9, -799.03, -655.6],
    "y":             [140.2, 90.77, 60.1, -20.5, -60.0],
    "b":             [0.698, 0.755, 0.827, 0.698, 0.755],
    "backlinks":     [1, 2, 4, 1, 2],
    "mtime":         [1763549990000, 1763549990000, 1763549990000, 1763549990000, 1763549990000],
    "constellation": [0, 0, 0, 0, 0]
  },
  "unlit": {
    "title":      [],
    "x":          [],
    "y":          [],
    "linkedFrom": []
  },
  "unlitTotal": 0,
  "edges": [0, 1, 0, 2, 1, 2, 2, 3, 2, 4, 3, 4],
  "constellations": [ { "id": 0, "name": "Start here", "star": 2, "count": 5 } ],
  "samples": 5
}
```

Field rules:

- `now`: the server time used for every age-dependent value, as epoch ms. It equals `floor(Date.now() / 600000) * 600000` (a 10-minute bucket). The client uses it for colour and age text, so the server and client agree exactly.
- `stars.*`: one entry per note, sorted by `titleKey` ascending. `title` is the stored casing.
- `x`, `y`: world units, rounded to 2 decimals (section 5).
- `b`: brightness, rounded to 3 decimals. `ageDays = max(0, now - mtime) / 86400000`, and the formula is design-direction.md section 5.
- `backlinks`: the number of distinct other notes with a valid link whose key resolves to this note. This is the same number as the length of the wiki's backlinks list.
- `mtime`: integer `Math.round(mtimeMs)`.
- `constellation`: the integer `id` of its constellation, or `null`.
- `unlit.*`: up to 2,000 missing link targets, chosen by `linkedFrom` descending, then key ascending. The arrays are then sorted by key.
  - `title` is the target exactly as written in the first link to it. "First" means the linking note that sorts first by key, then document order within that note. It is always a valid title.
  - `linkedFrom` is the number of distinct linking notes.
- `unlitTotal`: the uncapped count. The list view gets the full set from `GET /api/unlit`.
- `edges`: a flat array of pairs `[a0, b0, a1, b1, ...]`. An index below `S = stars.title.length` is a star. An index `S + j` is `unlit[j]`.
  - There is one edge per unordered pair where either side links to the other with a valid target: star-star, or star to a drawn unlit star.
  - Self-links are excluded. Mutual links give one edge. Edges to unlit stars beyond the cap are omitted.
  - Each pair has `a < b`. Pairs are sorted by `(a, b)`.
  - `data-edge-count = edges.length / 2`.
- `constellations`: sorted by the name's `titleKey`. `id` is the position in that order. `star` is the index of the named star. `count` is the number of member notes (2 or more).
- `samples`: the number of notes whose bytes equal a shipped sample exactly (section 8). The banner shows while `samples > 0`.

### 4.2 Size

For 5,000 notes, 10,000 links and 2,000 unlit stars the body is about 0.6 MB, under the 1.5 MB budget. There is no pretty-printing.

### 4.3 `GET /api/unlit`

Returns 200 `{unlit: [{title, linkedFrom: [titles]}]}` with every missing valid target, uncapped. Entries are sorted by key. `linkedFrom` holds the stored titles of the linking notes, sorted by key. This feeds the list view's "Not written yet (N)" section (ux check 28 expects 2,500 entries).

### 4.4 Caching, ETag and invalidation

Each `GET /api/sky` first calls `index.scan()`. This is the wiki stat scan: `generation` bumps when any note is added, changed (ino, mtime or size) or removed. The scan also stats the sidecar, and a change in `(ino, mtimeMs, size)` bumps `sidecarGen`.

There are two cache levels in `src/sky.js`. Each holds one entry and is replaced, never grown.

1. **Layout cache.**
   - Key: `graphSig` = sha256 over the canonical text of the sorted seed list, node kinds excluded, plus the sorted edge list in seed terms.
   - Content-only edits (same links) keep `graphSig`, so they never rerun the layout.
   - The value is the position per seed.
2. **Body cache.**
   - Key: `${generation}:${sidecarGen}:${nowBucket}`.
   - Value: `{body: Buffer, etag}`, where `etag = '"' + sha256(body).hex.slice(0, 32) + '"'`.

Response headers: `ETag`, `Cache-Control: no-store` (the wiki rule) and the security headers. If the request has an `If-None-Match` exactly equal to the current ETag, the server answers 304 with no body. The client keeps the last body in memory and sends `If-None-Match` itself, because `no-store` means the browser cache plays no part.

When the client refetches:
- after page load;
- after every create, save, rename, delete or sample removal it performs;
- on `visibilitychange` to visible;
- on a "Try again".

There is no polling.

Warm start: `server.js` builds the sky once after the first scan and before `listen`, so the first request at 5,000 notes is served from cache. ux checks 26 and 27 need ready within 1 s and 3 s.

## 5. Deterministic star positions

### 5.1 Requirements

- **P1.** Same vault bytes and same sidecar give bit-identical positions on any run and on any Node 22 build.
- **P2.** Positions do not depend on insertion order, file order or readdir order.
- **P3.** Adding one unlinked note moves no existing star by more than 8.01 world units (proof in section 5.4).
- **P4.** Renaming a note keeps its exact position (section 6).
- **P5.** Creating a note from an unlit star keeps its exact position.

### 5.2 Nodes, seeds, base points

**Nodes.** The layout runs over every lit note plus the unlit stars selected for drawing (at most 2,000, section 4.1). Unlit stars are real layout nodes, so a note created from one has the same node, seed and edges. That gives P5 exactly.

**Seed.** Each node gets a seed string from `resolveSeeds`, in this order:
1. Lit notes that have a sidecar entry `seeds[key]`, in key order. Their seed is that value.
2. Lit notes without an entry, in key order. Their seed is their key.
3. Unlit nodes, in key order. Their seed is their key.

If a seed is already taken, append `#n` with the smallest `n >= 1` that is free. `#` can never appear in a title, so a suffixed seed cannot clash with a real key. **Every ordering in the layout is ascending seed order (code-unit compare), never title order.** This keeps the floating-point summation order identical across a rename.

**Base point.** `h(seed)` is a point uniform in a disk of radius `R = 3000` world units.
- Let `H = sha256("constellation/v1\u0000" + seed + "\u0000" + salt)`, with salt starting at 0.
- Read four pairs of big-endian uint32 from H.
- For each pair: `u = a / 2^32 * 2 - 1`, `v = b / 2^32 * 2 - 1`. Take the first pair with `u*u + v*v <= 1`.
- If none qualifies, increase the salt and repeat.
- The point is `(u * R, v * R)`.

No trigonometry or logarithm is used anywhere in the layout, only `+ - * /` and `Math.sqrt`, which are exactly rounded in IEEE 754. That is what makes P1 hold across platforms.

`R` is a constant and never depends on the note count.

### 5.3 Algorithm (`src/sky-layout.js`)

Constants: `L = 90`, `K = 60`, `R = 3000`, `DMIN = 12`, `NUDGE_CAP = 4`.

Edges for layout are the undirected, de-duplicated, non-self edges among layout nodes: lit-lit and lit-unlit.

**Stage A: components.** Find connected components of the layout graph with union-find. Process the nodes of each component in seed order. Components are processed in order of their smallest seed.

**Stage B: per-component force layout** (only components with `n >= 2`). Singletons keep `p = h`.

1. `c` = the mean of the members' `h`, summed in seed order.
2. `s = min(1, 0.8 * L * sqrt(n) / R)`, and `p_i = c + (h_i - c) * s`. The cluster starts at its natural size.
3. For `it = 0 .. K-1` (always exactly K iterations, with no early stop):
   - `T = 30 * (1 - it / K) + 0.5`.
   - Build a grid over this component only. Cell size is `2L`. Cell lists are in seed order.
   - For each member `i`, in seed order:
     - `f = 0`.
     - Repulsion: for each other member `j` in the 3x3 neighbouring cells, iterating cells row-major and members in seed order:
       - `d = |p_i - p_j|`. If `d < 2L`, add `(p_i - p_j) / d * (L*L / d)`.
       - If `d < 0.01`, use `d = 0.01` and direction `unit(h(seed_i + "|" + seed_j))`, normalised by dividing by `Math.sqrt` of its squared length.
     - Attraction: for each graph neighbour `j` (unique, seed order): `f -= (p_i - p_j) / d * (d*d / L)`. Pairs with `d < 0.01` are skipped.
     - `disp_i = |f| > 0 ? f * (min(|f|, T) / |f|) : 0`.
   - Apply every `disp` simultaneously (Jacobi update). The result does not depend on update order.

**Stage C: component separation** (only components with `n >= 2`; singletons take no part).
- Centroid `c_k` = the mean of positions. Radius `r_k = max |p - c_k| + L/2`.
- Run 16 Jacobi iterations:
  - Sort components by `(c.x - r, smallest seed)`. Sweep-and-prune to get the candidate pairs.
  - For each overlapping pair (`dist < r_a + r_b`):
    - `o = r_a + r_b - dist`.
    - `dir = (c_b - c_a) / dist`. If `dist < 0.01`, use the hash direction of the two smallest seeds instead.
    - Accumulate `-dir * o * n_b / (n_a + n_b)` on a and `+dir * o * n_a / (n_a + n_b)` on b.
  - Translate each component (centroid and all members) by its accumulated vector.

**Stage D: local nudge** (all nodes, a single pass).
- Use a grid of cell `DMIN`.
- For each node `i`: `Δ_i = Σ_j (p_i - p_j) / d * (DMIN - d) / 2` over every `j` with `d < DMIN` (seed order, coincident points use the hash direction).
- Clip `|Δ_i| <= NUDGE_CAP`.
- Apply all, then round x and y to 0.01 with `Math.round(v * 100) / 100`.

**Cost.** Stage B costs about `K × (N + E) ×` the neighbour count. At 7,000 nodes and 10,000 edges, the target is under 150 ms on a laptop, and a unit test enforces under 400 ms in CI. It runs only when `graphSig` changes.

### 5.4 Proof of P3 (adding one unlinked note u)

u has no links out and none in, and its key is not a missing target of any note. If it were, u would be linked.

1. **Seeds.** u is unmapped, and its seed is its key, which contains no `#`. Lit-mapped and other lit-unmapped seeds are resolved before or independently of u. The only seed u could collide with is a mapped seed equal to its key, in which case u itself gets the suffix. Unlit keys never equal u's key. So every other node keeps its seed.
2. **Nodes.** The unlit cap selection depends only on missing targets and their link counts, which are unchanged. So the layout node set grows by exactly `{u}`.
3. **Stage A.** u is a singleton component. Every other component has the same members and edges.
4. **Stage B.** It is component-local, uses per-component grids and seed-ordered sums, and never looks at u. Every other component's positions are bit-identical.
5. **Stage C.** It uses only components with `n >= 2`, and u is not one of them. The set of components and their inputs are identical, and so is the sweep order, which comes from component data only. So the output is bit-identical.
6. **Stage D.** For a node v, `Δ_v` changes only if u lies within `DMIN = 12` of v's position before stage D. In that case both the old and new `Δ_v` are clipped to at most 4, so `|change| <= 8`. Rounding adds at most 0.01. Nodes farther than 12 units from u keep the exact same terms, summed in the same order (u is skipped because `d >= DMIN`).

**Bound:** no existing star moves by more than **8.01 world units**. Every star more than 12 units from u does not move at all.

What this means in practice:
- At the default camera, the fit zoom is at most 1.0 (1.6 for the sample-sky spacing rule). 8.01 units is at most 12.8 CSS px, which is 1.0% of a 1280 px view width.
- On a phone, or zoomed in further, the shift can be a larger share of the view.
- For ux check 8 (`0.02 × (maxX - minX of A)`) the bound holds whenever A's x-extent is at least 401 world units. Two or more independent hash points in a disk of radius 3000 are almost always that far apart.
- A test generates G(50, 80) for 200 seeds and asserts the property.

Remaining caveat: the client's fit camera uses the bounding box. If u lands outside the old box, the default opening camera changes on the next load, while world positions still obey P3. SC2's "same screen position" is asserted for reloads without changes (check 7), which is exact.

### 5.5 Why linked notes cluster

Stage B gives each multi-node component its own FR layout, started around the mean of its members' hash points at a size proportional to `sqrt(n)`. Stage C keeps clusters from overlapping. Unlinked notes are scattered like a star field, and stage D keeps them from stacking. Accepted trade-off: singletons may sit inside a large cluster's disk. The unit `test layout keeps singletons at hash point (± nudge)` pins this behaviour.

## 6. Sidecar `.constellation-sky.json` (rename carries position)

**Purpose.** A star's seed must outlive a rename. Positions are a pure function of (note files and links, sidecar). The sidecar is never a note.

**Schema (version 1):**

```json
{"version":1,"samplesSeeded":true,"seeds":{"project ideas":"ideas"}}
```

- `seeds` maps the *current* key to the *original seed*. An entry exists only when they differ.
- `samplesSeeded` is a boolean (section 8). Unknown top-level keys are kept on rewrite.

**Write path.** Writes go only through `vault.writeSidecar`, which uses the atomic tmp, fsync and rename sequence with mode 0644. Renaming over a symlink replaces the link and never follows it. They happen:

1. **On rename** (`src/rename.js`, after the file move and before link rewriting):
   - `seed = currentSeed(oldKey)`, the existing entry or else `oldKey`.
   - Delete `seeds[oldKey]`.
   - If `newKey !== seed`, set `seeds[newKey] = seed`. A case-only rename keeps the key, so nothing changes.
   - Prune entries whose key is not a current note. Write.
2. **On delete via the API:** if an entry exists for the key, remove it, prune and write.
3. **On seeding:** set `samplesSeeded: true`.

**Read path.** `vault.readSidecar`:
- `lstat`. It must be a regular file and not a symlink, else treat it as absent and log once.
- Size at most 1 MiB, else treat as absent and log once.
- Open with `O_RDONLY | O_NOFOLLOW` and read.
- `parseSidecar`: `JSON.parse` inside try/catch. The top level must be a plain object with `version === 1`.
- Each `seeds` entry is kept only if both key and value are strings with `validateTitle(s).ok && titleKey(s) === s`. Entries are copied into a `Map`, never onto an object, so `__proto__` is just a key.
- At most 10,000 entries are read, in the order of `Object.keys`. The rest are dropped with a log line.

**Corrupt or unknown file.**
- Invalid JSON or wrong shape: log once `Ignoring unreadable .constellation-sky.json`, and use empty seeds with `samplesSeeded` unknown, treated as `true` so samples are not reseeded into a vault that once had them. The next sidecar write replaces the file.
- `version > 1`: treat as empty and **never write** (read-only, logged), so a newer build's file is not destroyed.

**Failure.** If the sidecar write fails during a rename (EACCES, ENOSPC, a directory in the way), the rename still succeeds as the wiki API defines it. The renamed star then moves to `h(newKey)`. The failure is logged on stderr. Accepted, because a rename never loses notes.

**Outside renames.** `mv` in a terminal does not update the sidecar, so the star moves. This is documented in the README.

## 7. Brightness, colour, constellations

**Brightness and colour.** Both follow design-direction.md section 5 exactly, implemented once in `src/brightness.js` and once in `public/js/star-style.js`. A shared test vector table keeps the two identical: the five rows of the section 5 table, plus `200 d → #bdd3ff ±1`.

- `r = clamp(1 - ageDays / 90, 0, 1)`
- `B = min(1, log2(1 + backlinks) / log2(17))`
- `b = max(0.30, 0.60 r + 0.40 B)`
- `radius = 1.5 + 5 b`

The colour is a piecewise-linear sRGB interpolation over the stops (0, 14, 90, 365 days) using the theme tokens, with each channel rounded. `data-focused-color` is the lowercase hex of that unrounded-alpha colour. Unlit stars always have radius 4.0 and no `b`.

**Constellations (`src/sky-graph.js`)** use the lit-only graph (star-star edges). Unlit stars never join a constellation.

1. Take the connected components with 2 or more members.
2. A component with more than 60 members is split by asynchronous label propagation:
   - Initial label = the member's rank in seed order.
   - Run 10 fixed passes. Each pass visits members in seed order and sets each label to the most frequent neighbour label, breaking ties by the smallest label. A node keeps its own label if that label ties for most frequent.
   - Each resulting group with 2 or more members is a constellation. Members of groups of one get `null`.
3. **Name:** the title of the member with the highest `b`, then most backlinks, then smallest key. In fixture C2 this gives "Alpha" and "Beta". In the sample vault it gives "Start here".
4. **Cap:** 1,000 constellations, keeping the largest `count` first (ties by name key). Members of dropped groups get `null`.
5. The client draws at most 12 names (design-direction.md section 6).

`data-constellation-count = constellations.length`.

## 8. Sample notes

### 8.1 Exact bytes (`src/samples.js`)

Each file is UTF-8 with LF line endings and a trailing newline. Each begins with `---\nsample: true\n---\n\n`, followed by:

- `Start here.md`: `Welcome to your sky. Each note is a star, and links join stars into constellations.\n\n- [[How the sky works]]\n- [[Writing a note]]\n- [[Links and unlit stars]]\n- [[Your vault]]\n`
- `How the sky works.md`: `Newer notes are warm and bright. Older ones cool toward blue. Notes with many links are larger. Drag to pan, scroll or pinch to zoom, press 0 to see everything. Next: [[Links and unlit stars]]. Back to [[Start here]].\n`
- `Writing a note.md`: `Choose New star, give it a title, and write. Put a title in double square brackets to link to another note. Next: [[Your vault]]. Back to [[Start here]].\n`
- `Links and unlit stars.md`: `A link to a note that does not exist yet appears as a hollow star. Click it to write that note. Back to [[Start here]].\n`
- `Your vault.md`: `Every star is a plain .md file in the vault folder. Edit them anywhere. Back to [[Start here]].\n`

Result: 5 stars, 6 edges, backlinks 4, 1, 1, 2, 2, and 1 constellation named "Start here" (matches ux.md). The module also exports `SAMPLE_REVISIONS`, the `revisionOf` of each byte string, computed at import.

### 8.2 Seeding (boot, `src/server.js`)

Seeding happens only when all of these hold:
- `CONSTELLATION_SAMPLES` is not `off`;
- the first scan finds zero notes;
- the sidecar is absent, or present and valid with `samplesSeeded !== true`.

Each file is written with `vault.createFile`, the wiki's no-clobber tmp-plus-link path, so an existing file is never overwritten. Then the sidecar is written with `samplesSeeded: true`. If any write fails, log it and continue with whatever was written. Seeding failure is never fatal.

This refines ux.md ("no .md files at server start"): after a user removes the samples and empties the vault, a restart does not bring them back. Deleting the whole vault folder (ux check 1) also deletes the sidecar, so samples are seeded again.

### 8.3 Front-matter

The server does not parse front-matter. Brightness, removal and the banner all rely on exact byte comparison.

The client's `markdown.js` `stripFrontMatter(text)` works as follows:
- The block must start at offset 0 with `---\n` or `---\r\n`.
- It must close with a line that is exactly `---` within the first 50 lines and the first 4,096 UTF-16 units.
- Otherwise there is no front-matter, and the text renders normally.
- The block's content is never interpreted, only hidden in Preview. It stays visible in the editor.
- Wikilinks inside front-matter still count, because the shared parser is unchanged. This is documented.

### 8.4 Remove sample notes: `DELETE /api/samples`

Mutation checks apply: Host, Origin, Sec-Fetch-Site. There is no body.

1. Run `index.scan()`.
2. For each of the 5 sample titles, in fixed order, resolve the entry by key. Skip it if missing.
3. `lstat` (it must be a regular file), read the bytes, and compute `revisionOf`.
4. If the revision equals `SAMPLE_REVISIONS[title]`, `unlink` the file and drop it from the index: **removed**.
5. Otherwise, if the bytes start with `---\nsample: true\n---`, the note is **kept** (an edited sample).
6. Anything else is ignored. A user's own "Start here" without the marker is not counted.

Response: 200 `{removed: [titles], kept: [titles]}`. A 503 `storage_error` is returned if an unlink fails; the files already removed stay removed, and the response lists them in `error.removed`.

The client shows ux copy: "Removed 5 sample notes." or "Removed 4 sample notes. 1 you edited was kept." The banner is visible while `/api/sky` `samples > 0`.

If the user edits a sample, its bytes no longer match. From then on it is an ordinary note that keeps its front-matter line (hidden in Preview), is never deleted by removal, and stops counting toward `samples`.

## 9. Client architecture (sky)

### 9.1 Model (`sky-model.js`)

`decodeSky` produces:
- `n`, `m` (unlit count), `titles[]`, `keys[]`;
- `x`, `y` as `Float64Array(n + m)` (stars first, then unlit);
- `b`, `radius` as `Float32Array(n)`;
- `colorBucket`, `sizeBucket` as `Uint8Array`;
- `color` (hex strings per star, computed with `json.now`);
- `edges: Int32Array`, `edgeKind: Uint8Array` (0 normal, 2 unlit);
- `constellation: Int32Array` (-1 for none);
- `bounds`.

It is rebuilt only on a new ETag. Rebuild steps: carry over the previous camera; compute settle entries for stars whose key moved (more than 0.5 world units, at most 300 ms of easing); keep rename aliases (old key to new key, handed over by the rename flow, so the focused star stays focused); rebuild the grid, twinkle slots and edge selection.

### 9.2 Camera (`camera.js`)

- State: `{x, y, z}`, where `(x, y)` is the world point at the canvas centre.
- `screen = ((wx - x) * z + W/2, (wy - y) * z + H/2)`, the ux.md formula, with `W` and `H` in CSS px.
- `z` is clamped to [0.1, 6].
- Wheel zoom: factor `exp(-deltaY * 0.0015)`. Keys and buttons: ×1.25 about the free-area centre, animated 120 ms with `easeOut`.
- `centreOn` puts a world point at the free-area centre: `x = wx - (fx + fw/2 - W/2) / z`, and likewise for y.
- `fitCamera`: the bounds of all drawn stars plus 10% padding. `z = min(fw / bw, fh / bh)`, clamped to [0.1, 1.0]. Exception: with 12 or fewer stars, raise z until the closest pair is 120 CSS px apart, capped at 1.6 (design-direction.md section 12). Centred on the free area. The opening camera is the fit camera.

### 9.3 Flights and animation (`camera.planFlight`, `anim.js`)

- `distPx = |Δworld| * z0`. Duration `= clamp(450 + 120 * log2(1 + distPx / W), 450, 1200)` ms.
- Position: `lerp(from, to, easeInOut(t))`.
- Zoom: if `distPx > 1.5 W`, log-interpolate `z0 → zMid = 0.7 * min(z0, z1)` over eased t in [0, 0.5], then `zMid → z1` over [0.5, 1]. Otherwise log-interpolate `z0 → z1` directly.
- Both segments are monotone, so z never exceeds `max(z0, z1)` and the distance to the target never grows (ux check 22).
- Target zoom is `clamp(current, 1.0, 2.0)` when opening a note.
- Any pointerdown, wheel, touchstart or pan, zoom or Escape key calls `anim.cancel("camera")` in the same event handler, keeping the current interpolated camera. Inertia `v * exp(-t/180)` stops below 5 px/s or at 400 ms.
- Other animations: `intro`, `lit-grow`, `lit-ring`, `lit-lines`, `settle`, `fade`, `zoom`, `inertia`. Timings are in design-direction.md sections 3, 10 and 12. `anim.tokens(t)` gives the `data-animating` value.

### 9.4 Render loop (`sky-view.js`)

- One `requestAnimationFrame` callback is scheduled only when `dirty || anim.active() || ambientDue`. Otherwise no rAF is pending.
- Ambient effects (twinkle, dust drift) run only with full motion, while the document is visible, at a 20 fps cap.
- With reduced motion there is no ambient loop at all, so an idle sky draws zero frames (ux check 33).
- Inputs, resize, data and theme changes set `dirty = true` and schedule a frame.
- Degradation (design-direction.md section 10): a rolling frame time above 20 ms for 30 frames turns twinkle and drift off. Above 28 ms, the glow sprite cap is halved.

### 9.5 Drawing (`sky-render.js`)

Draw order:
1. The baked haze and vignette bitmap, then the dust tile at offset `0.3 × camera screen offset`, plus drift.
2. Edges as 3 batched paths: normal, active and dashed unlit. At most 6,000 edges, chosen by `selectEdges`. Each edge is culled by a segment-against-viewport (plus margin) test.
3. Sub-pixel stars (screen radius under 1.2) as `fillRect`s, batched per colour bucket.
4. Glow sprites with `drawImage`, at most 800, brightest first. `globalAlpha` is the glow alpha times the twinkle factor. Blend from `--glow-blend`.
5. Cores: one path per (colour bucket, alpha step), where alpha step = `round(coreAlpha × 3)`. That is at most 32 fills, typically 8 to 12.
6. Stars under animation (lit, fade, settle), drawn individually.
7. Unlit rings as one path with a 40° gap per ring.
8. The selection ring.
9. Labels with a 3px halo, via `strokeText` then `fillText`.

Visibility: `grid.queryRect` over the viewport plus a 64 CSS px margin. Cell size is 128 world units.

Allocation: the scratch `Int32Array`s are allocated per model, never per frame.

Sprites: 32 glow sprites (8 colours × 4 sizes) and the dust tile come from `sprites.js` on load and on theme change. Tokens are read with `getComputedStyle` at those moments only.

DPR: `min(devicePixelRatio, 2)`. Canvas pixel size is capped at 4,096 per side. Sizing goes through CSSOM (`canvas.style.width`), never through markup.

`drawFrame` returns `{drawCalls, sprites, labels, visible}`. Unit tests assert the order and the budgets with a recording fake context.

### 9.6 Labels (`labels.js`)

- **Candidates:** constellation names first (at most 12, by member count), then stars by `b` descending. Stars qualify only when `z >= 1.4`, or `z >= 0.8` when there are 12 or fewer stars.
- **Placement:** each label tries right, left, above and below at an 8px offset. A rect (text plus 4px padding) is rejected if it leaves the safe rect (free area) or intersects an already placed rect.
- Placed rects are indexed in a 32px occupancy grid, so the overlap test is O(1).
- **Caps:** 40 labels in total, or 24 when the viewport is at most 390 CSS px wide.
- The hovered or focused star's label is drawn last, on a solid chip, without displacing others. It is published with `data-focused="true"`.
- Text is truncated to 24 code points plus "…". `measureText` results are cached per title in a `Map`.
- The same rects drive the canvas and the `[t=sky-labels]` list, which is rebuilt when idle and at most every 250 ms while moving, using `textContent` and `setAttribute`.

### 9.7 Hit testing, pointer and gestures

- **Hit test:** `grid.nearest` within `max(12, r + 6)` CSS px (22 on touch), converted to world units by `/z`. Nearest wins. Ties go to higher `b`, then the lit star.
- **Pointer events** go on the canvas, which has `touch-action: none`. `gestures.js` keeps a map of active pointers:
  - One pointer moving more than 4 px is a pan, by screen delta.
  - Two pointers make a pinch: zoom by `dist / dist0` about the current midpoint, and pan by the midpoint delta.
  - A pointerup without a drag is a tap or click.
- `pointercancel` resets the state.
- Mouse click: a lit star opens its note. An unlit star is created and opened.
- Touch tap: selects the star and shows the card. A second tap on the same star triggers the card action.
- Hover tooltip: mouse only, after 80 ms.
- Wheel: `classifyWheel` applies the ux.md rule (ctrlKey, `deltaMode`, or an integer `|deltaY| >= 50` with no deltaX means zoom; otherwise pan).

### 9.8 Keyboard and focus ring

- ux.md keyboard model: arrows pan 64 CSS px, Shift+Arrow does a 60° cone search (`focus-ring.nearestInCone`), and + / - / 0 / Home / Enter / Space / Escape work as listed.
- Tab ring: `readingOrder` returns up to 60 visible stars inside the free area, sorted by `floor(screenY / 48)`, then screenX, then title. It is recomputed when the camera goes idle, keeping the focused star.
- Tab past the ends does not call `preventDefault`, so focus leaves the canvas naturally. Past the last star it goes to the card action when shown.
- `sky-announce` gets the `format.starDescription` text.

### 9.9 Twinkle (`twinkle.js`)

- Slots are assigned greedily in star index order: each star takes the smallest of 6 slots not used by an already-assigned star within 60 world units (grid query).
- **If all 6 are used, the slot is -1 and the star never twinkles.** This fixes a soundness gap: in dense clusters the "no two within 60 share a slot" rule cannot always hold for every star. The unit test asserts it for every pair of twinkling stars.
- Period: 3.2 to 6.4 s, from FNV-1a of the title, used for display only.
- At most 150 of the brightest visible slotted stars twinkle. Rendered brightness is `b × (1 + 0.10 sin(...))`, which modulates glow alpha only.

### 9.10 Random star bag (`bag.js`)

- `createBag(rng)` keeps a shuffled array of keys (Fisher-Yates with `mulberry32`, seeded from `Date.now()` in the glue and fixed in tests).
- `next(currentKeys)`:
  - Drop keys that no longer exist.
  - When the bag is empty, refill with all current keys and shuffle. If the first key equals the last one shown and there are 2 or more keys, swap it with a random later position.
  - Keys created mid-cycle are appended at a random position.
  - Returns `null` when there are no notes (copy: "There are no stars yet. Write one first.").
- Five presses on 5 or more notes always give 5 different notes.

### 9.11 Canvas state contract and instrumentation

`sky-view.js` owns one `state` object and flushes it to `[t=sky-canvas]` dataset attributes, exactly the ux.md table:
- `data-animating` and `data-ready` immediately on change;
- everything else at most every 100 ms while drawing, and once when the sky goes idle.

Numbers are formatted as ux.md specifies (camera to 2 and 3 decimals, and so on).

Frame timing: each drawn frame increments `data-frame-count` and pushes a sample into `frame-stats`. The sample is the rAF timestamp delta if the previous rAF tick also drew, otherwise the frame's own draw duration from `performance.now()`. `data-frame-p95` is the 95th percentile of the last 120 samples (nearest-rank, 1 decimal).

`aria-label` and `sky-summary` come from `format.skySummary(n, constellations)`.

### 9.12 Reduced motion

Read live from `matchMedia("(prefers-reduced-motion: reduce)")` and exposed as `data-motion`.
- `planFlight` returns duration 0, so the camera jumps.
- The `zoom`, `inertia`, `intro`, `lit-*`, `settle` and `fade` animations are never started.
- Twinkle and drift are off (`data-twinkle="off"`).
- A new star sets `data-static-ring="true"` for 2,000 ms with a static accent ring.
- Parallax stays at 0.3×, because it follows input (design-direction.md section 10).
- The CSS sets `transition-duration: 0s` under the media query.

### 9.13 Unsupported canvas

If `getContext("2d")` returns null, redirect to `/list` with the ux.md notice. Everything still works through the list view.

## 10. Security

Everything in the wiki design section 7 carries over unchanged: loopback bind, Host and Origin and Sec-Fetch-Site checks, body limits, traversal defence, symlink refusal, CSP without `unsafe-inline`, and no HTML strings in `public/js`. Additions:

1. **Sidecar parsing** (section 6): `lstat` must show a regular file, no symlink, at most 1 MiB, `O_NOFOLLOW`, try/catch `JSON.parse`, validated keys and values copied into a `Map`, at most 10,000 entries, atomic writes, mode 0644.
   - A hostile sidecar can only move stars. It cannot name files: seeds are only hashed, never joined to a path.
2. **Permission page:** static HTML built at boot from a template and the integer port. It has no script and no user input. CSP still applies.
3. **Front-matter limits:** parsed only on the client, only to hide it. It is bounded to 50 lines and 4,096 units, and its content is never interpreted.
4. **`sample` flag injection:** the marker grants nothing. Removal deletes only files whose bytes hash to a shipped sample revision. Such a file is byte-identical to text we shipped, so deleting it loses nothing. A user note that merely carries `sample: true` is never deleted.
5. **Canvas and labels:** titles come only from the server and are validated stems, so they contain no control characters, `<` or `>`. The client draws them with `fillText` and `strokeText` only. Card, tooltip, `sky-labels`, announcements and list use `textContent` and `setAttribute`.
   - The existing no-`innerHTML` scan covers the new modules.
   - The forbidden-HTML test also bans `eval`, `new Function` and string arguments to `setTimeout` in `public/js`.
6. **New endpoints:**
   - `/api/sky` and `/api/unlit` are read-only, need a loopback Host, and send JSON with `no-store`.
   - `DELETE /api/samples` is a mutation (Origin checks), acts only on 5 hard-coded titles, and goes through `vault.js`.
7. **Wiki lock check:** refusing a live `.wiki.lock` prevents two writers with different tmp and lock conventions on one vault.

`security-reviewer` (phase 6) reviews `sidecar.js`, the sidecar I/O in `vault.js`, `samples.js` plus the removal route, router changes, `markdown.js` `stripFrontMatter`, and the label and card DOM code.

## 11. Failure modes and limits

| Situation | Behaviour |
|---|---|
| Sidecar corrupt, oversized, a symlink or a directory | Ignored with a log line. Stars use their own keys. Written over on the next write (except `version > 1` and a directory). |
| Sidecar write fails on rename | Rename succeeds. The star moves to the hash of its new key. Logged. |
| Sample seeding fails | Logged. The server starts with whatever was written. |
| Sample removal unlink fails | 503 `storage_error` with `removed` so far. The client shows the ux failure copy and refetches the sky. |
| `/api/sky` fails or is unreachable | The client shows the ux error state (`app-error`, dust at 40%) with `Try again`. |
| A note panel request fails | Partial state (`note-notice`). The sky keeps working. |
| Layout takes longer than expected | It runs at boot and on graph change only. Body cache by generation. |
| Very many missing links | Drawn unlit stars capped at 2,000. `/api/unlit` is uncapped (bounded by the notes). |
| Very many components | Constellations capped at 1,000. 12 names drawn. |

Limits:
- All wiki limits, unchanged.
- Unlit drawn: 2,000. Edges drawn per frame: 6,000. Glow sprites per frame: 800. Labels: 40 (24 on phone). Constellations: 1,000. Label-propagation threshold: 60 members.
- Sidecar: 1 MiB and 10,000 entries.
- `/api/sky` at most 1.5 MB at 5,000 notes and 10,000 links.
- Layout: under 400 ms in CI at 7,000 nodes.

Config:
- `PORT` (3000; 0 means any free port).
- `HOST` (loopback only).
- `VAULT_DIR` (`./vault`).
- `CONSTELLATION_SAMPLES` (`on` by default, or `off`).

## 12. Tests

**Unit tests (`tests/`)**
- The copied wiki unit tests.
- `sky-layout`:
  - identical output for identical input, including shuffled input orders;
  - bit-identical across a rename with the sidecar mapping;
  - unlit-to-lit keeps the position;
  - the P3 property over 200 random G(50, 80) vaults, plus a hand case with u within 12 units of a star;
  - stars more than 12 units from u are unchanged bit for bit;
  - 7,000-node time budget;
  - no `Math.sin`, `cos`, `log` or `atan2` in the file (source scan).
- `sky-seeds`: collision suffixes; mapped-first ordering.
- `sidecar`:
  - valid, corrupt, oversized, `__proto__`, invalid keys, more than 10,000 entries, `version` 2 (read-only);
  - a round trip;
  - `vault` tests: symlink refused, atomic write.
- `brightness`: the shared vector table against both implementations.
- `sky-graph`: edges incl. unlit, the cap order, components, label propagation determinism, naming ties, C2 and the sample vault.
- `sky.js`: JSON shape and sort orders, ETag and 304, cache hit on content-only edits, layout reuse, invalidation after an outside add (stat scan) and after a sidecar change.
- `samples`: seeding conditions (empty, `samplesSeeded`, `off`, an existing `.md`); removal of unedited only; kept count; a user note with `sample: true` is never removed.
- Router: new routes, `Allow`, the 403 HTML page for a non-API path with a bad Host and JSON for `/api`, Origin on `DELETE /api/samples`.
- `server`: refuses a live `.wiki.lock`, takes over a stale `.constellation.lock`.
- Client pure modules:
  - camera (formula round trip; `zoomAbout` keeps the point fixed; fit);
  - easing (100-sample monotonic in [0, 1]; ux test b);
  - `planFlight` (duration clamp; z bound; monotone distance);
  - star-style (vectors; `#bdd3ff`);
  - grid (query equals brute force on random data; nearest tie rules);
  - labels (no overlaps on 1,000 random candidates; caps 40 and 24; focused chip);
  - twinkle (ux test c);
  - focus ring (order rule; cone);
  - bag (5 distinct of 5; no back-to-back repeat across a refill; deletions);
  - frame-stats (p95);
  - gestures (pan threshold; pinch about midpoint; wheel classification);
  - anim tokens;
  - format copy (plurals; ages);
  - `stripFrontMatter` limits;
  - `sky-render` with a recording context (draw order; at most 32 fills plus 3 strokes; at most 800 `drawImage`; culling).
- `contrast.test.js`: reads `app.css` tokens and checks design-direction.md section 9 (ux test a).
- The no-HTML-sink scan of `public/js`.

**Acceptance**
- The ported wiki suite (only the section 2 edits), run against Constellation with `CONSTELLATION_SAMPLES=off`.
- `acceptance/sky.acceptance.test.js` covers ux checks 7, 8, 12, 13, 15 (API parts), 28 (API part) and 57 (permission), plus samples.
- The Playwright checks 1-60 run in the phase 7 walkthrough. Coverage floor 80% over `src` and `public/js`.

## 13. ADRs

1. **Hash seed plus component-local fixed-iteration layout on the server.** It gives exact determinism and the P3 proof without a stored layout. Rejected: a global force layout (any note moves every star); positions stored for every note (a cache that can drift from files; it was listed as Later); layout in the browser (cost at 5,000 notes).
2. **Order by seed, not by title.** Floating-point sums in a fixed seed order make rename bit-exact. Rejected: title order (a rename reorders sums and changes the last digits).
3. **No transcendental functions in the layout.** Only basic IEEE operations and `sqrt`, so the result is the same on every platform.
4. **Sidecar file for rename seeds only.** Small, in the vault the user owns, and optional. Losing it only moves renamed stars. Rejected: front-matter in notes (it edits user files and pollutes git); a file outside the vault (lost when the vault moves).
5. **Unlit stars are layout nodes.** Creating one keeps its exact position (SC3). Cost: up to 2,000 extra nodes.
6. **Sample identity by exact bytes, not the flag.** Safe against injection, and "edited" detection is free.
7. **Struct-of-arrays JSON, single-entry caches, explicit If-None-Match.** Meets 1.5 MB. The `no-store` wiki rule is kept.
8. **Canvas 2D with grid culling, sprite glow and bucket batching.** It meets the budget at 5,000 notes without WebGL (brief).
9. **Labels by greedy placement in an occupancy grid.** O(labels), and the no-overlap check is deterministic.
10. **Pure modules plus thin glue.** Meets 80% coverage and keeps every rule testable under `node:test`.
11. **Refuse a live `.wiki.lock`.** Fixes the brief's false assumption that different lock names keep the two apps apart.
12. **Twinkle slots may be -1.** The stagger rule stays true by construction.

## 14. Conflicts with brief, ux.md and design-direction.md, and resolutions

ux.md has **no "Decisions to confirm" section**. These are the five points it explicitly leaves to the architect, all accepted with refinements:

1. **`/api/sky` fields: accepted** as listed. The shape is struct-of-arrays. `unlit.linkedFrom` is a count; the names come from `/api/unlit` and the edges.
2. **Rename carries the position: accepted.** It is implemented with the sidecar seed map. Outside renames do not carry it.
3. **Positions are a pure function of vault content: accepted.** "Content" includes the sidecar inside the vault.
4. **Seeding when there is no `.md` at start: refined.** Seeding also requires that the vault was not seeded before (a sidecar marker), so samples never come back after removal.
5. **Unlit stars do not count toward 5,000 and are capped at 2,000: accepted.** The cap selection is deterministic (most linked, then key).

Other conflicts:
- **Brief open question 1:** the separate lock name does not stop a wiki and a Constellation sharing a vault. Section 2 item 3 adds the `.wiki.lock` check.
- **Wiki acceptance tests:** "no non-dot entries" (seeding) and "every ux.md testid" (UI replaced) cannot pass byte-for-byte. The ported suite needs the section 2 edits, and a human must make that port, because acceptance tests are human-owned.
- **Draw calls (design-direction.md section 11, "about 12 fill calls"):** exact per-star core alpha cannot be batched into 8 paths. Cores are batched by colour bucket and 4 alpha steps (at most 32 fills). The visible difference is under 1/6 alpha.
- **Twinkle stagger rule:** it is not always satisfiable in dense areas. Stars with no free slot do not twinkle, so the property holds for every twinkling star.
- **SC2 "2% of view width":** the guarantee is in world units (8.01). It is at most 1.0% of a 1280 px view at default zooms. At phone width, or zoomed in further, it can exceed 2% of the screen. ux check 8's form holds for any sky wider than 401 units.
- **Non-loopback Host 403:** the permission page applies to non-API paths. `/api` keeps the JSON `bad_host` so wiki hardening tests carry over.
