# Hello Overkill: design

Paths are relative to `examples/hello-overkill/`. One Node 22 process, zero dependencies, `node src/server.js`, serves the SPA at `GET /` and a JSON API, persists to one JSON file. Dropped from the original app on purpose: HTTPS listener and cert files, `config.js`, the `'trimmedPath\t'` typo, the empty-body 404 (now `{"error":"not found"}`).

## 1. Modules (`src/`)
| File | Responsibility | Exports |
|---|---|---|
| server.js | wire modules, listen, SIGTERM/SIGINT; no logic | - |
| config.js | parse/validate env, warn on stderr | `loadConfig(env)` -> `{port,dataFile,rateLimit,signingSecret,secretIsDev}` |
| router.js | dispatch, send/error helpers, `readBody` with cap, security headers | `createRouter({store,limiter,voteLimiter,signer,chaos,now})`, `MAX_BODY` |
| store.js | Maps + atomic file persistence (visitors, certificates, votes) | `createStore(file, now)` |
| greetings.js | 10 languages x 4 tones = 40 templates; ids `"<lang>.<tone>"` | `LANGUAGES, TONES, CATALOGUE(Map), render(lang,tone,name), isLanguage, isTone` |
| hello.js | validate, record visit+streak, create+sign certificate, build response | `createHello({store,signer,now})` |
| certificates.js | canonical string, HMAC-SHA256, text format, verify | `createSigner(secret)` -> `{sign,toText,verifyText}` |
| battle.js | pick two distinct entries, validate vote, leaderboard | `pickPair(random)`, `leaderboard(votes)` |
| chaos.js | interpret `chaos` query | `decideChaos(value, random)` -> `{kind:'none'|'teapot'|'delay', ms}` |
| rate-limiter.js | sliding window, copy from examples/link-shortener | `createRateLimiter` |
| validation.js | validators returning error string or null | `validateHelloBody, validateVerifyBody, validateVote` |
| security.js | headers; CSP uses sha256 of inline script/style | `securityHeaders(page)` |
| page.js | whole HTML as a string; every `data-testid` from ux.md | string |

Tests: unit in `test/*.test.js`, human-written in `acceptance/` (read-only). `package.json`: `"test":"node --test"`, `"start":"node src/server.js"`. Factories take `now` and `random` (defaults `Date.now`, `Math.random`).

## 2. Config (env)
- `PORT` default 3000, integer 0-65535 (0 = ephemeral; out of range: exit 1).
- `DATA_FILE` default `./data/hello.json`; parent dir created on first write.
- `HELLO_RATE_LIMIT` default 10 hits/60 s/client, 1-100000; invalid -> stderr `invalid HELLO_RATE_LIMIT, using 10`.
- `HELLO_SIGNING_SECRET` unset -> random 32-byte per-process secret and stderr `WARNING: HELLO_SIGNING_SECRET not set; using a random per-process dev secret. Certificates will read as Forged after restart.` Never logged, returned or stored.
- First stdout line exactly `listening on <port>` (real bound port), then `open http://localhost:<port>/`. SIGTERM/SIGINT: `server.close(()=>process.exit(0))` + `closeAllConnections()`; chaos timers unref'd and cleared.
- Limits: headersTimeout 5000, requestTimeout 10000, maxConnections 1000.

## 3. HTTP interface
JSON responses `application/json; charset=utf-8` + security headers. Errors `{"error":"<msg>"}`. One trailing slash stripped. Target not starting with `/` or starting with `//` -> 404. Unknown path 404 `{"error":"not found"}`. Wrong method on a known path 405 with `allow`.

| # | Route | Request | Success | Errors |
|---|---|---|---|---|
| 1 | GET / | - | 200 text/html page | 405 |
| 2 | GET /healthz | - | 200 `{"ok":true}` | 405 |
| 3 | POST /hello (core) | empty / non-JSON / non-object / object with no own `name` | 200 body EXACTLY `{"message":"Hello World! Welcome to the API."}` | 413, 429, chaos |
| 4 | POST /hello (personalised) | `{"name":string,"language"?,"tone"?}` | 200 personalised | 400, 413, 429, 418, 500 |
| 5 | any other method /hello | ignored | 200 same exact core body; no chaos/personalisation | 429 |
| 6 | GET /api/catalogue | - | 200 `{"languages":[{"code","label"}x10],"tones":[{"code","label"}x4],"defaults":{"language":"en","tone":"formal"}}` | 405 |
| 7 | GET /api/certificates/:id (`^[a-f0-9]{16}$`) | - | 200 `{id,name,greeting,language,date,signature,text}` | 404 `{"error":"certificate not found"}` (also malformed id) |
| 8 | POST /api/verify | `{"text":string}` <=10000 | 200 `{"verdict":"Authentic"}` or `{"verdict":"Forged","reason":"mismatch"|"unreadable"}` | 400 missing/not string; 400 `{"error":"too long"}`; 413 |
| 9 | GET /api/battle | - | 200 `{"a":{"id","greeting"},"b":{...}}`, distinct ids AND distinct texts | 405 |
| 10 | POST /api/battle/vote | `{"choice":"<catalogue id>"}` | 200 `{"ok":true,"leaderboard":[...]}` after persist | 400 unknown/missing; 429 (vote limiter 60/min); 500 |
| 11 | GET /api/leaderboard | - | 200 `{"leaderboard":[{"rank","id","greeting","votes"}]}` top 10, zero-vote ids omitted, `[]` if none | 405 |

### 3.1 Core contract (byte exact)
Body is the frozen constant `CORE_BODY = '{"message":"Hello World! Welcome to the API."}'`, status 200, no extra fields. These all return exactly that: no body, `""`, `"garbage"`, `"[]"`, `"null"`, `{"foo":1}`, `{"language":"es"}`. Content-type ignored.

### 3.2 Personalised
`name`: string, NFC-normalised, trimmed, 1-40 code points, no `\p{Cc}`/`\p{Cf}`. Errors: `name is required`, `name too long (max 40)`, `name has invalid characters`, `name must be a string`. `language` in `en es fr de it pt nl sv ja sw` (default en) else `unknown language`. `tone` in `formal pirate shakespearean corporate` (default formal) else `unknown tone`. Other keys ignored.
```json
{"message":"Hello World! Welcome to the API.","greeting":"...","name":"Ada","language":"es","tone":"pirate",
 "visit":1,"streak":1,"certificate":{"id":"<16 hex>","date":"YYYY-MM-DD","signature":"<64 hex>","text":"<certificate text>"}}
```
`name` is the trimmed display name as typed this time. `visit`,`streak` integers >= 1.

### 3.3 Order for /hello
1) rate limit (key `req.socket.remoteAddress`, never X-Forwarded-For; on hit `req.resume()` then 429) 2) chaos (POST only, `chaos` query) 3) read body with cap 4) classify core/personalised 5) validate 6) mutate store + persist 7) respond. A chaos 418 still consumes a rate-limit hit.

### 3.4 429
Header `retry-after: <int >=1>`, body `{"error":"You've been greeted enough.","retryAfter":N}`. `createRateLimiter({limit:HELLO_RATE_LIMIT,windowMs:60000})` on /hello (all methods). Votes use a separate fixed 60/min limiter. Verify and read endpoints unlimited.

### 3.5 Chaos (POST /hello only)
`418`: always 418 `{"error":"teapot","message":"The greeter spilled its tea (418)."}`, body not read, store untouched. `delay`: wait `2000+floor(random()*2001)` ms then process normally. `1`: r=random(); <1/3 418, <2/3 delay, else normal. Absent/other: none. The page reads `chaos` from `location.search` and hash query (`#/hello?chaos=always418` maps to 418) and forwards `/hello?chaos=<v>`; the checkbox sends `chaos=1` unless forced.

### 3.6 Body limit
`MAX_BODY` = 16 KB (declared content-length and streamed). Over: 413 `{"error":"request body too large"}` with `connection: close`. Invalid UTF-8 decoded with replacement chars, then just "not JSON" (core).

## 4. Certificates
Canonical input `JSON.stringify(["hello-overkill/v1", id, name, greeting, date])`; `id` = 16 lowercase hex from `randomBytes(8)`; `date` UTC `YYYY-MM-DD`. Signature = HMAC-SHA256 hex (64). Text = compact JSON in fixed order `{"id","name","greeting","date","signature"}`.
`verifyText`: JSON.parse in try (fail -> Forged/unreadable); must be plain non-array object with 5 string keys, date `^\d{4}-\d{2}-\d{2}$`, id hex rule, signature `^[0-9a-f]{64}$` else unreadable; recompute and compare with `crypto.timingSafeEqual` (equal length guaranteed by regex); equal -> Authentic, else Forged/mismatch. Stateless (no store lookup); any single-char edit inside the JSON gives Forged.

## 5. Store
File v1: `{"version":1,"visitors":[{key,displayName,visits,streak,firstDay,lastDay}],"certificates":[{id,name,greeting,language,date,signature}],"votes":[[id,count]]}`. In memory all `Map`s. Visitor key = `name.normalize('NFC').trim().toLowerCase()`. Streak by UTC day: lastDay==today unchanged; yesterday -> +1; else 1. `visits` always +1; `displayName` updated. Certificate cap 10,000 (oldest evicted, its permalink 404s). Load: ENOENT -> empty; valid v1 -> rows validated one by one, invalid skipped; anything else -> rename to `<file>.corrupt-<ms>`, log, start empty. Visitor cap `MAX_VISITORS` 10,000 (oldest-created evicted first, exported from store.js; the ~10 ms synchronous write at the cap is accepted). Persist: write `<file>.<pid>.tmp` then `renameSync`, synchronously BEFORE responding; on failure roll back in-memory change, log, respond 500 `{"error":"could not save"}`.

## 6. Battle
Pool = 40 entries rendered with name "World". `pickPair(random)`: different ids and different texts (re-roll). Vote: `CATALOGUE.has(choice)`, increment, persist, return leaderboard sorted votes desc then id asc, top 10, zeros omitted.

## 7. Failure modes
Handler throw -> 500 `{"error":"internal error"}` (no stack to client). Persist failure -> rollback + 500. Corrupt file -> moved aside. Unset secret -> random + warning. Port in use -> log `port <n> in use`, exit 1. Client disconnect during chaos delay -> timer cleared on `res.on('close')`. Rate limiter `maxKeys` 10,000, swept as in link-shortener.

## 8. Security
No secret in source. HMAC via timingSafeEqual after length/format checks. Limits: name 40 cp, cert text 10,000 chars, body 16 KB, header default 16 KB + timeouts, chaos whitelist, id regex before lookup. All dictionaries are Maps; bodies read field by field, never spread/merged (`__proto__`, `constructor` are ordinary keys). `textContent` only in the page; CSP `default-src 'none'; script-src 'sha256-..'; style-src 'sha256-..'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`; `x-content-type-options: nosniff`, `referrer-policy: no-referrer`. Names stored verbatim (escaping is the renderer's job). Same origin, no CORS headers. Never echo exception messages.

## 9. UI contract (from ux.md)
`GET /` page contains all 38 `data-testid`s plus ids `#name #language #tone #chaos #cert-input`. Hash routes `#/hello` (default), `#/battle`, `#/verify`, `#/certificate/<id>`. Select options built from a static copy in `page.js` that must equal `/api/catalogue` (unit test). `greeting-text` gets `lang=<language>`. 429 UI reads `retry-after`. 418 UI keys on status 418. Client checks mirror server rules (server is truth). `verify-verdict` text is exactly `verdict`; unreadable shows Forged plus "This is not a readable certificate." `cert-date`=date, `cert-signature`=64 hex, `cert-name`=signed name. Battle options text "Vote for A: <greeting>"; vote sends `choice=<id>`; rows render `lb-greeting`, `lb-votes`.

## 10. Test seams
Start with `PORT=0 DATA_FILE=<tmp> HELLO_SIGNING_SECRET=test`, parse `/listening on (\d+)/`. `HELLO_RATE_LIMIT=1000` for loops over all language/tone combos. `chaos=418` and `chaos=delay` are deterministic. Persistence test: SIGTERM, restart same `DATA_FILE`, counts continue.

## 11. ADRs
1. **One endpoint for core + personalised** (vs separate endpoint / query flag): personalised only when the JSON body has an own `name`; otherwise the frozen constant. Old clients unaffected; a body with only `language` still gets core.
2. **Stateless readable certificate** (vs opaque token / store lookup): compact JSON + HMAC over version-tagged canonical array; survives eviction; fails after secret rotation or dev-secret restart (documented).
3. **Dev secret fallback** (vs constant / refuse to start): random per process + warning; no constant to leak; zero-config start still works; tests set the env var.
4. **Single JSON file, atomic whole-state rewrite** (vs per-collection files / append log): link-shortener pattern; O(state) per write bounded by the 10,000 cert cap; move to log if volume grows.
5. **Chaos as whitelisted query param with forced values and injected randomness** (vs only `1` with stubbed random / test env var): deterministic tests, no test-only code paths; any client can force a 418 (harmless); delays bounded by requestTimeout and rate limit.
