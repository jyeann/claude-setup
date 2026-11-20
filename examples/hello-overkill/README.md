# Hello Overkill

An intentionally over-engineered Hello World. It is rebuilt from the Pirple homework API (`POST /hello`, source: https://github.com/jyeann/HW-PIRPLE-1), and the original core contract still works byte for byte: `POST /hello` returns `{"message":"Hello World! Welcome to the API."}` for any body, or no body at all.

Around that contract it adds a web page, greetings in 10 languages and 4 tones, visit streaks, signed certificates, a greeting battle, chaos mode and rate limiting. It runs as one Node 22 process with zero dependencies and stores its state in one JSON file.

## Requirements

- Node 22. Nothing else. There is no `npm install` step because the project has no runtime dependencies.

## Run it

From this directory (`examples/hello-overkill/`):

```sh
node src/server.js
```

The first stdout line is `listening on <port>` and the second is `open http://localhost:<port>/`. Open that URL to use the page. With no environment variables set, the server listens on port 3000.

Check the core endpoint from another terminal (replace `3000` with the port printed at startup if you changed it):

```sh
curl -s -X POST http://localhost:3000/hello
# {"message":"Hello World! Welcome to the API."}
```

Personalised greeting:

```sh
curl -s -X POST http://localhost:3000/hello \
  -H 'content-type: application/json' \
  -d '{"name":"Ada","language":"es","tone":"pirate"}'
```

### Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | Integer 0-65535. `0` picks a free port and prints it. An invalid value exits with code 1. |
| `DATA_FILE` | `./data/hello.json` | JSON state file (visitors, certificates, votes). The parent directory is created on the first write. |
| `HELLO_RATE_LIMIT` | `10` | Hits per 60 seconds per client on `/hello`, 1-100000. An invalid value prints `invalid HELLO_RATE_LIMIT, using 10` to stderr and uses 10. |
| `HELLO_SIGNING_SECRET` | random per process | HMAC key for certificates. If unset, the server generates a random secret, prints a warning to stderr, and certificates read as Forged after a restart. |
| `HELLO_READ_LIMIT` | `120` | Per-client reads per minute for the v2 read routes and `/api/stream` connects, 1-100000. Invalid values warn and use the default. |
| `HELLO_FED_LIMIT` | `10` | Per-client calls per minute to `/api/federation/hello`, 1-100000. |
| `HELLO_FED_GLOBAL_LIMIT` | `30` | Calls per minute, shared by all clients, that may fan out to peers; beyond it `/api/federation/hello` answers 429 with `Retry-After` before any peer is contacted. 1-100000. |
| `HELLO_SLA_TOKEN` | unset | Bearer token for `/api/sla`. Shorter than 16 characters only warns, except with `NODE_ENV=production` where the server exits with code 1. With `NODE_ENV=production` and no token, `/api/sla` answers 401. |
| `HELLO_PEERS` | unset | Comma-separated peer origins. Names are sent to peers; `http://` peers that are not loopback trigger a startup warning because names travel unencrypted. |
| `NODE_ENV` | unset | When set to `production`, `HELLO_SIGNING_SECRET` is required and must be at least 32 characters, or the server exits with code 1. |

Example with settings:

```sh
PORT=8080 DATA_FILE=/tmp/hello.json HELLO_SIGNING_SECRET="$(node -e 'console.log(require("node:crypto").randomBytes(32).toString("hex"))')" node src/server.js
```

The server exits with code 0 on `SIGTERM` or `SIGINT`, and it keeps its state in `DATA_FILE`.

## Endpoints

Copied from `docs/product/hello-overkill/design.md`, section 3.

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

Errors use the body `{"error":"<message>"}`. Unknown paths return 404 `{"error":"not found"}`.

Rate-limited responses (429) carry a `retry-after` header and the body `{"error":"You've been greeted enough.","retryAfter":N}`.

## Features

1. **Polyglot Hello.** 10 languages (en, es, fr, de, it, pt, nl, sv, ja, sw) times 4 tones (formal, pirate, shakespearean, corporate) make 40 hand-written greeting templates.
2. **Streaks and memory.** Each visitor is identified by name (case-insensitive). The service counts visits and a daily streak by UTC day, and it remembers both across restarts.
3. **Signed certificates.** Every personalised greeting returns a certificate signed with HMAC-SHA256. `GET /api/certificates/:id` shows it, and `POST /api/verify` (or the page's verify route) answers Authentic or Forged. Editing one character in the certificate text gives Forged.
4. **Greeting Battle (lite).** `GET /api/battle` returns two different greetings. A vote with `POST /api/battle/vote` updates a top-10 leaderboard that is saved to the data file.
5. **Chaos mode.** `POST /hello` accepts a `chaos` query parameter, described below. The page shows a friendly error and a retry button.
6. **Rate-limited politeness.** After the limit (default 10 per minute per client), `/hello` answers 429 with a `retry-after` header and a polite message. The page shows a countdown.

### Chaos values (`POST /hello` only)

| Value | Behaviour |
|---|---|
| `?chaos=418` | Always 418 `{"error":"teapot","message":"The greeter spilled its tea (418)."}`. The body is not read and the store is not changed. |
| `?chaos=delay` | Waits about 2 to 4 seconds, then processes the request normally. |
| `?chaos=1` | Random: about one third 418, one third delay, one third normal. |

Any other value, or no value, means no chaos. A forced 418 still uses one rate-limit hit.

## Testing

Unit and acceptance tests (node:test, no install needed):

```sh
npm test
```

Playwright walkthrough. It needs Playwright preinstalled in the environment, and it starts its own servers on random ports with temporary data files:

```sh
node qa/walkthrough.js
```

It prints one `PASS` or `FAIL` line per check and ends with `TOTAL <n> PASS <n> FAIL <n>`. It also writes screenshots to `docs/product/hello-overkill/qa/` at the repository root.

Full verify gate. This is the harness command that runs acceptance and unit tests, coverage (80% floor), test quality, the hidden holdout set, and a mutation spot-check. Run it from this directory, and the harness lives at the repository root:

```sh
node ../../.claude/harness/bin/verify.js
```

Add `--fast` to skip the holdout and mutation steps while iterating. Exit code 0 means `VERIFY PASSED`.

## Known limits

- **Synchronous persistence.** Each state change is written to `DATA_FILE` before the response is sent. At the 10,000 visitor cap a write takes about 10 ms.
- **Caps.** Visitors and certificates are each capped at 10,000. When the cap is reached, the oldest entries are evicted, and an evicted certificate's permalink returns 404.
- **Single-process rate limiting.** Limits are kept in memory per process and keyed on the socket address. `X-Forwarded-For` is ignored, so behind a reverse proxy all clients share one bucket.
- **No fsync.** Writes use a temporary file and `rename`, but they are not flushed to disk. A power loss can lose the most recent change.
- **Secret rotation.** Certificates depend on the signing secret. Changing the secret, or running without `HELLO_SIGNING_SECRET`, makes older certificates read as Forged.

## Left out on purpose

These were on the idea list in `docs/product/hello-overkill/brief.md` and are not implemented:

- Hello Weather (daily greeting forecast)
- SSE wall (live stream of greetings)
- SLA dashboard (uptime and latency)
- Time machine (replay greetings by ID)
- Haiku compiler (5-7-5 greeting)
- Federation (greetings exchanged between instances)

Also left out: user accounts, an HTTPS listener, external translation APIs and databases.

## The page

The page is styled as "The Overkill Greeting Office", a fictional ministry of correspondence. There are three counters (Hello, Battle, Verify) and six other departments: Weather, Wall, SLA, Time machine, Haiku and Federation. The footer has an Appearance control that switches between System, Light and Dark and remembers the choice in this browser. Certificates print on one page from the Print certificate button. The page is sent gzip-compressed to browsers that accept it, with an ETag so a reload revalidates with a 304. The design spec is in `docs/product/hello-overkill/redesign/ux-redesign.md`.

## Layout

- `src/` - server, router, store, certificates, battle, chaos, page (the single HTML page, assembled from `src/page/`: tokens, geometry, icons, style, markup, script)
- `test/` - unit tests, written with this project
- `acceptance/` - acceptance tests (human-written, read-only during a harness run)
- `holdout/` - hidden holdout tests used by the verify gate
- `qa/walkthrough.js` - Playwright walkthrough of every v1/v2 journey (`QA_SHOTS=<dir>` changes where screenshots go)
- `qa/redesign.js` - Playwright checks for the redesign: theme, reduced motion, 390 px, print, contrast, focus and order, plus screenshots at 390 and 1280 in light and dark
- `spec.md`, `TASKS.md`, `verify.config.json` - harness inputs
- `CHANGELOG.md` - version history
