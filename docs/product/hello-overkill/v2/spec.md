# hello-overkill v2: addendum spec

Self-contained. Builds the six ideas the v1 brief marked later/out, plus three FIX items from retro.md. Read with design.md (v1) only for context; nothing here changes v1 behaviour.
Status: spec for the build phase. Paths are relative to `examples/hello-overkill/`.

## 0. Global rules (apply to every section)

- Zero dependencies, Node 22 built-ins only. No network calls except federation to `HELLO_PEERS` origins (section 8).
- Frozen contracts: `POST /hello` core body `{"message":"Hello World! Welcome to the API."}` byte-exact, `GET /hello` 200 core body, every v1 route, status code and header, the 38 `data-testid`s in ux.md, and all existing tests (`npm test`) keep passing unchanged. v2 testids are listed ONLY in this file. ux.md's table stays at 38 entries because tests parse it.
- v2 changes are additive: new modules in `src/`, new routes dispatched in `router.js` before the final `notFound`, new options on `createRouter` that all default (so existing `createRouter({store,limiter,voteLimiter,signer})` calls still work), new views and nav links in `page.js`, new env vars in `config.js` (new keys only, existing return keys unchanged).
- Pure logic lives in modules with no I/O. Anything time-, randomness- or network-dependent is injected: `now` (ms epoch, default `Date.now`), `random` (default `Math.random`), `fetchPeer` (section 8). Tests never touch the clock, RNG or network.
- All new `/api/` responses are JSON `application/json; charset=utf-8` (except the SSE stream), carry the existing security headers and `cache-control: no-store`. Errors are `{"error":"<message>"}`. Wrong method: 405 with `allow`. Query strings are parsed with the router's existing `URLSearchParams`; a repeated key uses the first value.
- Read limiter: new `readLimiter` (`createRateLimiter({limit: HELLO_READ_LIMIT, windowMs: 60000})`, default 120, env `HELLO_READ_LIMIT`, same validation as `HELLO_RATE_LIMIT`) guards weather, time-machine, haiku, sla, `/api/stream` connect attempts and the federation health route (`GET /api/federation`, cached 5 s). `GET /api/federation/hello` uses `fedLimiter` instead (see section 8). 429 body and `Retry-After` identical to v1 `tooMany`. The stream also keeps its own capacity caps. `/hello`, `/healthz`, `/` are never read-limited.
- Names: reuse `normalizeName` plus the v1 rules (string, 1..40 code points after trim, no `\p{Cc}\p{Cf}`) through a new shared `validateName(v)` in `validation.js` returning an error string or null. Existing exports unchanged.
- SPA: every dynamic string uses `textContent`. Inline script/style are covered by the existing hash CSP (`security.js` hashes whatever `page.html` contains); do not add inline event attributes, external scripts or `style=` attributes. `connect-src 'self'` already allows `EventSource` to `/api/stream`.

## 1. Route table

| Method | Path | Idea | Success | Errors |
|---|---|---|---|---|
| GET | `/api/weather` | Weather | 200 JSON | 400, 405, 429 |
| GET | `/api/stream` | Stream | 200 `text/event-stream` | 405, 503 |
| GET | `/api/sla` | SLA | 200 JSON | 405, 429 |
| GET | `/api/time-machine` | Time machine | 200 JSON | 400, 405, 429 |
| POST | `/api/haiku` | Haiku | 200 JSON | 400, 405, 413, 422, 429 |
| GET | `/api/federation` | Federation | 200 JSON | 405, 429 |
| GET | `/api/federation/hello` | Federation | 200 JSON | 400, 405, 429 |

## 2. Module list

| Module | Pure? | Exports |
|---|---|---|
| `src/weather.js` | pure | `fnv1a(str)`, `mulberry32(seed)`, `forecast({date, place})`, `weatherGreeting({forecast, greeting})`, `normalizePlace(v)`, `utcDate(now)` |
| `src/stream.js` | stateful, no I/O of its own | `createHub({now, maxClients=50, maxPerIp=5, ringSize=20, heartbeatMs=15000, setInterval, clearInterval})`, `anonymise(info)` |
| `src/sla.js` | stateful, no I/O | `createSla({now, clock, windowMs=300000, maxSamples=1024})`, `routeLabel(method, path)`, `percentile(sortedAsc, p)`, `withSla(handler, sla, {clock})` |
| `src/time-machine.js` | pure | `parseDate(str, todayStr)`, `eraFor(year)`, `greetingFor({date, name})`, `streakOn({visitor, date})` |
| `src/haiku.js` | pure | `countSyllables(word)`, `lineSyllables(text)`, `makeHaiku({name, theme, syllables, random|seed})`, `BANKS` |
| `src/federation.js` | pure + injected I/O | `parsePeers(envValue, {allowPrivate})`, `isPrivateAddress(ip)`, `createFederation({peers, fetchPeer, now, ttlMs=5000})`, `validateHealth(json)`, `validatePeerHello(json)`, `defaultFetchPeer({allowPrivate, lookup})` |

Changes to existing modules (additive only): `config.js` (new keys, section 9), `store.js` (new read-only `peekVisitor(name)` returning a copy of `{displayName, visits, streak, firstDay, lastDay}` or `null`, no mutation, no persist), `router.js` (new routes, new injected deps `hub`, `sla`, `federation`, `readLimiter` with defaults, one `hub.publish` call after a successful hello), `validation.js` (`validateName`), `page.js`, `server.js` (wiring plus FIX 1).

## 3. Idea 1: Hello Weather

`GET /api/weather?place=<string>&date=<YYYY-MM-DD>&name=<string>&language=<code>&tone=<code>`

- `place` optional, default `anywhere`. `normalizePlace`: NFC, trim, collapse whitespace, lowercase for hashing only (echoed form keeps original case, trimmed). 1..40 code points, no `\p{Cc}\p{Cf}`. Bad: 400 `place must be 1-40 characters`.
- `date` optional, default `utcDate(now())`. Must be a real calendar date within today-1..today+1 (UTC) so the cache of "today's forecast" is bounded; otherwise 400 `date out of range`. (Arbitrary history belongs to the time machine.)
- `name` optional; if present it is validated by `validateName` and a personalised line is added. `language`/`tone` default `en`/`formal`, validated with `isLanguage`/`isTone` (400 `unknown language`/`unknown tone`). Without `name` the greeting is rendered for `World`.
- Seed: `fnv1a(date + '|' + placeLower)` (32-bit FNV-1a over UTF-8 bytes) fed to `mulberry32`. Draw order is fixed (condition, tempC, windKph, warmth, chanceOfWarmRegards, rainbow) so the same input always gives the same output across restarts and instances.
- 200 shape:
```json
{"date":"2026-11-18","place":"Lisbon","seed":123456789,"condition":"sunny spells of goodwill",
 "tempC":14,"windKph":22,"chanceOfWarmRegards":70,"warmthIndex":7,
 "forecast":"70% chance of warm regards in Lisbon, with sunny spells of goodwill.",
 "greeting":"Good day, Ada. It is a pleasure to make your acquaintance. Today: 70% chance of warm regards in Lisbon, with sunny spells of goodwill.",
 "simulated":true}
```
  `condition` comes from a fixed list of 8 strings; `tempC` -5..35 integer; `windKph` 0..60; `chanceOfWarmRegards` 0..100 integer; `warmthIndex` 1..10. `simulated` is always `true`.
- The greeting is the v1 `render()` text plus one appended sentence ("Today: " + forecast). `POST /hello` and its JSON are NOT changed (byte-exact contract; the weather variant is only reachable here).
- Persistence: none. No store read or write.
- Failure modes: invalid input 400; read limiter 429; no failure paths from I/O. Unknown query keys ignored.
- Security: pure computation on bounded input; the place is echoed only as JSON string (UI uses textContent). No external weather API, no geocoding.
- Tests (pure): same input gives deep-equal output; different date or place changes the seed; all outputs in range for 1000 random (date, place) pairs; mulberry32 golden values pinned; `fnv1a('')` equals 2166136261.
- SPA: hash `#/weather`. testids: `nav-weather`, `weather-place-input`, `weather-date-input`, `weather-name-input`, `weather-go`, `weather-forecast`, `weather-greeting`, `weather-chance`, `weather-error`. Empty state text in `weather-forecast`: "Pick a place to see today's greeting forecast." View title via existing `view-title`: "Hello Weather".

## 4. Idea 2: Live hello stream (SSE wall)

`GET /api/stream` with optional header `Last-Event-ID: <int>`.

- Response: 200, `content-type: text/event-stream; charset=utf-8`, `cache-control: no-cache, no-store`, `connection: keep-alive`, `x-accel-buffering: no`, plus security headers. The router must not set a `content-length`. First bytes: `retry: 3000\n\n` then `: connected\n\n`.
- Event format (one event per hello):
```
id: 42
event: hello
data: {"id":42,"ts":"2026-11-18T10:15:30.000Z","language":"es","tone":"pirate","milestone":"streak-7"}

```
  `milestone` is `null` or one of `first-visit`, `visit-10`, `visit-100`, `streak-7`, `streak-30`, `streak-100` (chosen by `anonymise` from the returned `visit`/`streak`; exact hits only, and when several apply the first in this priority order wins: `streak-100`, `visit-100`, `streak-30`, `visit-10`, `streak-7`, `first-visit`; the list order above is NOT the priority; pinned by a test in `test/stream.test.js`). `ts` is the server time truncated to the second. Core hellos (no name) publish `{"language":"en","tone":"formal","milestone":null,"kind":"core"}`. Heartbeat: comment line `: hb\n\n` every 15 s. `data:` is single-line JSON (no raw newlines).
- Anonymisation: `anonymise(info)` takes `{language, tone, visit, streak}` and returns exactly the event payload fields; it never receives the name, certificate id, greeting text or client address. A unit test asserts the serialised event never contains the name for a sample of names and that `anonymise` ignores extra keys (`name`, `greeting`, `id`).
- Hub: `createHub(...)` returns `{ publish(info), subscribe(res, {ip, lastEventId}) -> 'ok'|'full'|'ip-full', size(), closeAll(), history() }`. IDs are a monotonically increasing integer from 1 per process. Ring of the last 20 events; on connect, replay events with `id > lastEventId` (or all 20 when the header is absent or not a non-negative integer), then live.
- Caps: 50 concurrent streams total, 5 per client key (`clientKey()` of the socket address). Beyond: 503 `{"error":"too many streams"}` with `retry-after: 5` (total cap) or 429-style 503 for the per-client cap; both 503.
- Cleanup: on `res` `close`/`error` the hub removes the client and clears nothing global; one shared heartbeat timer is created when the first client joins and cleared when the last leaves (timer `unref`'d). `closeAll()` ends all streams; `server.js` calls it in `shutdown()` before `closeAllConnections()`.
- Backpressure: before each write, if `res.writableLength > 65536` the client is destroyed (slow consumer). `res.write` errors are caught and the client dropped.
- Persistence: none; the ring is in memory and resets on restart.
- Failure modes: client abort mid-replay (drop, no throw); write after end (guarded by `res.writableEnded`); hub never throws into the hello path: `router` wraps `hub.publish` in try/catch and ignores failure so `POST /hello` output is unchanged.
- Security: names, certificate ids and signatures never leave the hello path; events carry no IP or user agent; no CORS headers (same origin only); capacity caps stop connection exhaustion; `server.maxConnections` (1000) still applies. Stream connect attempts are read-limited (`readLimiter`, 429 with `Retry-After`) in addition to the per-client and global caps.
- Heartbeat interval env: `HELLO_STREAM_HEARTBEAT_MS` (integer 50..60000, default 15000; invalid values warn and fall back like `HELLO_RATE_LIMIT`) sets `heartbeatMs`, so tests can shorten it. `config.js` returns it as `streamHeartbeatMs`.
- Reconnect: `retry: 3000` plus `Last-Event-ID` replay means a reconnecting wall misses nothing within the ring.
- SPA: hash `#/wall`. `EventSource('/api/stream')` created on entering the view and `.close()`d on leaving it (and on `pagehide`). Each event appends a `li` (max 50 kept, oldest removed) with text like "A es/pirate hello" plus " (streak-7 milestone)"; text via `textContent`. testids: `nav-wall`, `wall-list`, `wall-item` (repeated), `wall-status` ("Connected", "Reconnecting...", "Wall is full, try later" on 503/failed open), `wall-count`, `wall-empty`. The shared `status` live region announces only connect/disconnect, not each event.

## 5. Idea 3: Hello SLA dashboard

`GET /api/sla`

- Recording: `withSla(handler, sla)` wraps the whole router handler in `server.js`/`createRouter`'s return value. On `res` `finish` or `close` (once) it records `{route, status, ms}` where `ms = clock() - start` using `performance.now()` (injectable `clock`). `routeLabel(method, path)` maps to a FIXED label set: `POST /hello`, `GET /hello`, `GET /`, `GET /healthz`, `GET /api/catalogue`, `GET /api/certificates/:id`, `POST /api/verify`, `GET /api/battle`, `POST /api/battle/vote`, `GET /api/leaderboard`, and one label per v2 route, else `other`. IDs, query strings and unknown paths never become labels, so the label set (and memory) is bounded at about 20. `/api/stream` is excluded from latency (long-lived) and counted only as `streamsOpened`.
- Window and memory: per label a ring buffer of the last `maxSamples` (1024) `{t, ms, status}`; snapshot ignores samples older than `windowMs` (5 min). Worst case about 20 x 1024 small objects, constant regardless of traffic.
- Percentiles: nearest-rank on the sorted window, `percentile(sorted, p)` returns `sorted[ceil(p/100*n)-1]`, `null` when n is 0. Values in ms rounded to 0.1.
- 200 shape:
```json
{"startedAt":"2026-11-18T09:00:00.000Z","uptimeSeconds":4312,"windowSeconds":300,
 "total":{"count":120,"errorRate":0.0083,"clientErrorRate":0.05,"p50":1.2,"p95":4.8,"p99":9.1},
 "helloPerMinute":3.4,"streamsOpen":2,
 "routes":[{"route":"POST /hello","count":40,"errors5xx":0,"errors4xx":2,"errorRate":0,"p50":1.1,"p95":3.9,"p99":6.0}]}
```
  `errorRate` = 5xx / count (0 when count is 0); 4xx (including 418 and 429) are reported as `errors4xx` and `clientErrorRate`, so chaos and politeness do not read as outages. `helloPerMinute` = `POST /hello` 2xx count in the window / window minutes. Routes sorted by count desc then label asc; routes with zero samples in the window are omitted. `uptimeSeconds` is `floor((now()-startedAt)/1000)` from the injected `now`.
- Persistence: none (uptime and window reset on restart; documented).
- Failure modes: a throw inside recording is swallowed (never affects the response); recording after a destroyed socket still runs once via the `close` fallback.
- Security: exposes only aggregates, no names, IPs or paths beyond the fixed labels. Read-limited. If `HELLO_SLA_TOKEN` is set, `GET /api/sla` requires `Authorization: Bearer <token>` (constant-time compare, 401 otherwise); the token must be at least 16 characters (a shorter value makes the server exit 1 at startup); unset means open outside production, and with `NODE_ENV=production` and no token the route answers 401. The SPA view shows "locked" when it gets 401.
- SPA: hash `#/sla`, polls every 5 s while the view is open (timer cleared on leave). testids: `nav-sla`, `sla-uptime`, `sla-total-count`, `sla-error-rate`, `sla-p50`, `sla-p95`, `sla-p99`, `sla-hello-rate`, `sla-table`, `sla-row` (repeated; cells `sla-route`, `sla-count`, `sla-row-p95`), `sla-error` (fetch failure or 401 text). Errors keep the last good numbers and set `sla-error`.

## 6. Idea 4: Greeting time machine

`GET /api/time-machine?date=YYYY-MM-DD&name=<string>&language=<code>&tone=<code>`

- `date` required. `parseDate(str, todayStr)`: must match `^\d{4}-\d{2}-\d{2}$`, be a real calendar date (round-trips through `Date.UTC`), `>= 1900-01-01` and `<= todayStr` (UTC today, inclusive). Errors, all 400: `date is required`, `date must be YYYY-MM-DD`, `date is not a real date`, `date before 1900-01-01`, `date is in the future`.
- Era table (by UTC year): 1900-1919 "Edwardian telegram", 1920-1945 "radio age", 1946-1969 "atomic age", 1970-1989 "disco and dial-up dawn", 1990-1999 "web 1.0", 2000-2019 "social era", 2020-today "now". Each era supplies `opening`, `closing` and a `medium` word, all from a fixed table in `time-machine.js`. Greeting: `"<opening>, <name or 'friend'>! <v1 greeting for language/tone with World or name> <closing>"`; `language`/`tone` default `en`/`formal` and are validated like section 3.
- `name` optional (validated by `validateName`). With a name, `streak` is computed read-only via `store.peekVisitor(name)`, never `recordHello`, never persist, never touches counts.
- `streakOn({visitor, date})` returns `status`:
  - `no-record`: visitor null.
  - `before-first-visit`: `date < firstDay`.
  - `on-streak` with `dayOfStreak` (1-based): `date` within `[lastDay - streak + 1, lastDay]` (UTC days). `streakLength` is the current streak; `onThatDay` is `dayOfStreak`.
  - `unknown`: `firstDay <= date` but outside the current streak window (the store keeps only first day, last day and the current streak, not each visit day, so earlier history cannot be known; this is a documented limit).
  - `inactive-after`: `date > lastDay` (since the last visit, streak lapsed or not yet continued).
- 200 shape:
```json
{"date":"1987-05-02","era":"disco and dial-up dawn","greeting":"...","language":"en","tone":"formal",
 "streak":{"name":"Ada","status":"unknown","dayOfStreak":null,"streakLength":4}}
```
  `streak` is `null` when no `name` was given. `name` echoes the validated input only; `firstDay`, `lastDay`, visit counts and display names are never returned.
- Persistence: none (read-only).
- Failure modes: 400 on bad input; store has no data file issues here because it only reads memory.
- Security: name lookup reveals whether a name exists and its streak length, the same as visiting `/hello` with it; mitigations: read limiter, status vocabulary only (no dates, counts or display name casing), no listing. Documented as acceptable for a local practice app; deployments that care should set `HELLO_TIME_MACHINE_STREAKS=0` (new env, default `1`) which makes `streak` always `null`.
- Tests (pure): boundary dates 1900-01-01 ok, 1899-12-31 400, today ok, tomorrow 400, 1900-02-29 400, 2000-02-29 ok; every era boundary year; each streak status with a fixed visitor; assert `peekVisitor` leaves `store.stats()` and the data file bytes unchanged.
- SPA: hash `#/time-machine`. testids: `nav-time-machine`, `tm-date-input`, `tm-name-input`, `tm-go`, `tm-era`, `tm-greeting`, `tm-streak`, `tm-error`. The date input has `min="1900-01-01"` and `max` set to today by script.

## 7. Idea 5: Hello haiku compiler

`POST /api/haiku` body `{"name":"Ada","theme":"morning","syllables":2}` (JSON, 16 KB body cap, `readBody` as v1).

- `name` required, `validateName`. `theme` optional, one of `morning`, `ocean`, `city`, `night` (default `morning`; else 400 `unknown theme`). `syllables` optional integer 1..6 overriding the heuristic count for the name (for names the heuristic mis-scans, e.g. "Siobhan"); else 400 `syllables must be an integer 1-6`.
- Heuristic `countSyllables(word)`: lowercase, strip non-letters (diacritics folded by NFD and mark removal), count maximal vowel groups `[aeiouy]+`, subtract 1 for a trailing silent `e` (not after `l` as in `table`, not for words ending `ee`/`ye`), subtract 1 for trailing `es`/`ed` after a non-t/d consonant (`makes`, `named`), add 1 for `ia`, `io`, `ua`, `eo` inside a word (`radio`), minimum 1 per word with letters; a small exception table (`the`, `fire`, `every`, `people`, `poem`, `quiet`...) takes precedence. Words with no ASCII-foldable letters count 0 and make the name unscannable.
- Documented limit: the check is against THIS heuristic, which is accurate on common English words (target at least 90% on a fixed 200-word test list) and weaker on foreign names, acronyms and irregular words. `verified:true` means "every line scans 5/7/5 under `countSyllables`", not "a linguist agrees". The `syllables` override exists for that reason. When `syllables` is given it replaces the heuristic name count, so `verified:true` then means the lines scan 5/7/5 assuming the name has the overridden number of syllables (it is based on the override, not on `countSyllables` of the name).
- Construction: all template and phrase banks in `BANKS` are checked at module load (`assert` via `countSyllables`): each fragment is stored with its declared count and the load fails if it disagrees. Line fragments are selected with a seeded RNG (`fnv1a(lower(name)+'|'+theme)`, or the injected `random`). The name occupies line 1 if `5 - n >= 1` (templates keyed by fixed count 1..4), else line 2 if `7 - n >= 1` (fixed count 1..6), else unscannable. After composing, `lineSyllables` is recomputed per line; on mismatch try the next candidate (max 20); if none, return 422.
- 200 shape:
```json
{"name":"Ada","theme":"morning","haiku":["Hello, Ada, hi","soft light on the waking street","welcome back to you"],
 "syllables":[5,7,5],"verified":true,"nameSyllables":2,
 "limit":"Syllables are counted by a simple English heuristic and may be off for names and rare words."}
```
  `haiku` always has exactly 3 non-empty lines (a route-level check returns 500 `internal error` if not, never sent to the client). Output is deterministic for a given (name, theme, syllables).
- Errors: 400 invalid body/name/theme/syllables; 422 `{"error":"name cannot be scanned into a haiku","hint":"try the syllables field or a shorter name"}`; 413 and 429 as v1.
- Persistence: none. The name is not stored and not published to the stream.
- Security: bounded input; output built only from fixed banks plus the validated name inserted as a string; UI uses `textContent` with `white-space: pre-line` for line breaks (no `innerHTML`).
- Tests: every bank fragment count; 3 lines and 5/7/5 for 500 random valid names (`random` injected); determinism; override changes placement; unscannable 422 for `"日本"`, a 7-syllable-plus name, and for punctuation only.
- SPA: hash `#/haiku`. testids: `nav-haiku`, `haiku-name-input`, `haiku-theme-select`, `haiku-syllables-input`, `haiku-go`, `haiku-line` (repeated, exactly 3), `haiku-counts` ("5-7-5 verified"), `haiku-error`.

## 8. Idea 6: Federation

Peers: env `HELLO_PEERS`, comma-separated http(s) origins, parsed once at startup by `parsePeers(value, {allowPrivate})`.

- Origin rule: `new URL(x)`; scheme `http:` or `https:`; no username/password; path `/` only; no query or hash; the stored origin is `url.origin` (lowercased, default port elided). Duplicates removed; at most 8 peers (extras dropped with a startup warning). Invalid entries are dropped with a warning that names the entry index, not its content. The user can NEVER supply a URL: no route accepts one, no query parameter selects a peer; only the fixed allowlist is contacted, paths are fixed to `/healthz` and `/hello`.
- Private-range restriction: by default a peer whose hostname is, or resolves (all A/AAAA results) to, a loopback, private, link-local, unique-local, CGNAT, multicast, unspecified or metadata address is refused with error `blocked_address`. Ranges: `127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16` (includes cloud metadata 169.254.169.254), `100.64.0.0/10`, `0.0.0.0/8`, `224.0.0.0/4`, `240.0.0.0/4`, `::1`, `::`, `fc00::/7`, `fe80::/10`, `ff00::/8`, and IPv4-mapped IPv6 are checked as their IPv4 form (`isPrivateAddress(ip)`). `defaultFetchPeer` resolves with `dns.lookup(host,{all:true})`, checks every address, then connects to the validated IP (via a `lookup` option that returns the vetted address) so DNS rebinding cannot swap in a private address after the check. Opt-out for local demos and tests: `HELLO_PEERS_ALLOW_PRIVATE=1` (default off; logged as a warning at startup when on).
- Fetch contract (injected): `fetchPeer({url, method, headers, body, timeoutMs, maxBytes}) -> Promise<{status, headers, text}>`; rejects with an `Error` whose `code` is one of the codes below. Default implementation uses `node:http`/`node:https`: `timeoutMs` 1500 as an overall deadline (socket timer plus `AbortSignal.timeout`), `maxBytes` 65536 (abort and reject `too_large` as soon as exceeded), `agent: false` (no keep-alive pool), header `user-agent: hello-overkill-federation`, and NO redirect following: any 3xx rejects `redirect`.
- Error codes (the only strings that ever reach clients about a peer failure): `timeout`, `refused`, `blocked_address`, `too_large`, `redirect`, `bad_status`, `bad_content_type`, `bad_json`, `bad_shape`, `network`. Raw peer error text, stack traces, headers and URLs are never forwarded.

`GET /api/federation`

- Concurrent `GET <origin>/healthz` to every peer with `Promise.allSettled` semantics; one peer failing never affects another. Result cached `ttlMs` (5 s, injected `now`) so repeated polling cannot amplify into peer traffic; concurrent callers during a fetch share one in-flight promise.
- `validateHealth(json)`: must be a plain object with `ok === true` exactly; else `bad_shape`.
- 200 shape (always 200, even when every peer fails or none are configured):
```json
{"configured":true,"summary":{"total":2,"up":1,"down":1},"checkedAt":"2026-11-18T10:00:00.000Z",
 "peers":[{"origin":"https://a.example","ok":true,"latencyMs":42},
          {"origin":"https://b.example","ok":false,"error":"timeout","latencyMs":1500}]}
```
  `origin` always comes from our parsed allowlist, never from peer data. Order equals `HELLO_PEERS` order. With no peers: `{"configured":false,"summary":{"total":0,"up":0,"down":0},"peers":[]}`.

`GET /api/federation/hello?name=<string>&language=<code>&tone=<code>`

- `name` required (`validateName`, 400 otherwise), `language`/`tone` optional and validated locally (400), then forwarded. Fan-out `POST <origin>/hello` with JSON `{"name","language","tone"}` and `content-type: application/json`, to every peer concurrently, plus the local greeting is NOT included (a peer-only view; the local greeting stays on `POST /hello`).
- `validatePeerHello(json)`: plain object; `greeting` a string 1..300 chars after removing `\p{Cc}\p{Cf}` characters; optional `visit`/`streak` integers 1..1000000; every other key discarded (certificate included, never relayed or verified). A peer answering the core body (no `greeting`) is `bad_shape`. Content-type must start with `application/json` (`bad_content_type`). HTTP status other than 200 is `bad_status`.
- Per-route limiter: `GET /api/federation` (health, cached 5 s) uses `readLimiter`; `GET /api/federation/hello` uses `fedLimiter` (10/min per client, env `HELLO_FED_LIMIT`) because fan-out has side effects on peers. Not cached.
- Global limiter: all clients share one `fedGlobalLimiter` (default 30/min, env `HELLO_FED_GLOBAL_LIMIT`) because peers rate-limit by our single IP. It is checked after validation and before any peer is contacted; when exceeded the route answers 429 with `Retry-After`.
- Blocked ranges (`isPrivateAddress`) also cover 192.0.0.0/24, 192.0.2.0/24, 198.18.0.0/15, 198.51.100.0/24, 203.0.113.0/24, 64:ff9b:1::/48, fec0::/10, Teredo 2001::/32 and SIIT `::ffff:0:a.b.c.d`.
- Startup warning (stderr) for each `http://` peer that is not loopback: names travel unencrypted.
- 200 shape:
```json
{"configured":true,"summary":{"total":2,"ok":1,"failed":1},
 "results":[{"origin":"https://a.example","ok":true,"latencyMs":61,"greeting":"Hola, Ada!","visit":2,"streak":2},
            {"origin":"https://b.example","ok":false,"error":"bad_shape","latencyMs":30}]}
```
- Peers' responses are untrusted data: parsed with `JSON.parse` in try/catch, shape-validated, truncated, control characters stripped, and only whitelisted fields output. The SPA renders greeting text with `textContent` only, never HTML, never as a link target; peer origins are shown as plain text, not anchors.
- Persistence: none. The name is sent to peers, who record a visit (a real side effect on the peer). The view warns "Your name is sent to the listed peers." (testid `fed-notice`). Operators list only peers they trust.
- Loop/recursion: federation routes are only reachable by users; peers call our `/hello` and `/healthz`, which never fan out, so no loops. We send `x-hello-federation: 1` for peer logs only; it changes no behaviour.
- Security summary: allowlist-only, fixed paths, timeouts, 64 KB cap, no redirects, address vetting with pinned connect, no response relayed raw, cached health, limited fan-out, peer count cap 8. Not covered: a malicious allowlisted public peer can still lie within the validated shape; mTLS or signatures between peers are out of scope.
- SPA: hash `#/federation`. testids: `nav-federation`, `fed-notice`, `fed-health-btn`, `fed-summary`, `fed-peer-row` (repeated; cells `fed-peer-origin`, `fed-peer-status`), `fed-name-input`, `fed-hello-btn`, `fed-result` (repeated; `fed-result-greeting`, `fed-result-error`), `fed-empty` ("No peers configured. Set HELLO_PEERS.").
- Tests: `parsePeers` accepts/rejects table (paths, userinfo, ftp, duplicates, 9 peers); `isPrivateAddress` table including mapped IPv6 and 169.254.169.254; fake `fetchPeer` for each error code and for one-fails-others-succeed isolation; response validators with hostile inputs (`<script>`, 1 MB string, control chars, nested keys); an integration test starts two real servers on 127.0.0.1 with `HELLO_PEERS_ALLOW_PRIVATE=1`; a stub server that 302s, one that sends 70 KB, one that hangs (timeout under 1.7 s with fake or real clock).

## 9. Config additions (`config.js`, new keys only)

| Env | Default | Meaning |
|---|---|---|
| `HELLO_PEERS` | empty | allowlisted peer origins |
| `HELLO_PEERS_ALLOW_PRIVATE` | `0` | `1` allows private/loopback peers (warn) |
| `HELLO_READ_LIMIT` | 120 | per-client reads per minute for v2 GET/haiku routes |
| `HELLO_FED_LIMIT` | 10 | per-client federation calls per minute |
| `HELLO_FED_GLOBAL_LIMIT` | 30 | all-client federation hello fan-outs per minute |
| `HELLO_SLA_TOKEN` | unset | optional bearer token for `/api/sla`, at least 16 chars (else exit 1) |
| `HELLO_TIME_MACHINE_STREAKS` | `1` | `0` hides streak data |
Invalid numeric values warn and fall back, exactly like `HELLO_RATE_LIMIT`. `loadConfig` return gains `peers`, `allowPrivatePeers`, `readLimit`, `fedLimit`, `fedGlobalLimit`, `slaToken`, `production`, `timeMachineStreaks`.

## 10. SPA wiring (`page.js`)

- New hash routes: `#/weather`, `#/wall`, `#/sla`, `#/time-machine`, `#/haiku`, `#/federation`. Unknown hash still falls back to `#/hello`. Nav gets six more links (`nav-<key>`, key = weather, wall, sla, time-machine, haiku, federation); the nav wraps (already `flex-wrap`).
- The same `view-title` h1 and the single `status` live region are reused. Leaving a view must stop its EventSource or timer. All v2 views follow the v1 states: empty, loading (`aria-busy`), success, error with friendly text and no stack traces.
- `test/page.test.js` and `acceptance/page.acceptance.test.js` read ux.md only; add `test/page-v2.test.js` that asserts this file's v2 testid list against `page.html`.

## 11. FIX items from retro.md (build in the same round)

1. EPIPE on stdout in `src/server.js`: `node src/server.js | head` crashes. Add `process.stdout.on('error', (e) => { if (e.code !== 'EPIPE') throw e; })` (and the same for stderr), and keep serving. Test: spawn the server with stdout piped to a closed reader and assert it stays up (`/healthz` 200) and exits 0 on SIGTERM.
2. Timing-sensitive `chaos=1` test (`acceptance/chaos-limits.acceptance.test.js:32`, one `fetch failed` under load): acceptance tests are read-only, so fix in `test/`: add a deterministic unit test with injected `random` (the `router.test.js:183` approach covers the three outcomes) and, where a live-server test must remain, give it a seeded `random` or `HELLO_CHAOS_SEED` hook plus a 15 s timeout and one retry on `ECONNRESET`/`fetch failed`. The human owner changes the acceptance file if they want it relaxed; the builder must not edit it.
3. Surviving mutants `battle.js:12` and `greetings.js:92`: add dedicated unit tests in `test/battle.test.js` and `test/greetings.test.js`. `battle.js:12` (distinct-pair check in `pickPair`): inject a `random` that returns the same index first so the loop and the fallback `POOL.find` both run, and assert `a.id !== b.id` and `a.greeting !== b.greeting`. `greetings.js:92` (`render` guard for unknown language/tone): assert `render('xx','formal','Ada') === null`, `render('en','nope','Ada') === null`, a prototype key like `render('__proto__','formal','Ada') === null`, and that a name containing `{name}` or `$&` is inserted literally and exactly once.

## 12. Build and verify notes

- Order: FIX items and shared bits (`validateName`, `peekVisitor`, config) first; then the pure modules (weather, time-machine, haiku, sla, stream hub, federation) with unit tests; then router wiring; then `page.js` views; then browser QA for the six hash routes.
- Gate: `npm test` green including all v1 tests, coverage floor 80%, holdout and acceptance untouched. Extra checks: a test that `POST /hello` returns the core body byte-for-byte with all v2 deps injected; a test that existing 38 testids are still present; an SSE integration test that opens a stream, posts a named hello and asserts the event arrives with no name, closes the client and asserts `hub.size() === 0`, and opens 51 streams and expects the 51st to be 503.
- Out of scope again: persistent stream history, authentication for peers, real weather or translation APIs, per-visit-day history for the time machine (would need a store format change).
