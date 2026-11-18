# Spec: link-shortener

## Goal
A link shortener with click statistics: a JSON API plus a single web page to create links and see their click counts. Zero runtime dependencies (Node 22 built-ins only), file persistence.

## Interface (exact)
Start: `node src/server.js`. Env: `PORT` (default 3000), `DATA_FILE` (default `./data/links.json`).
On startup it prints a line containing `listening on <port>` once it accepts connections.
On `SIGTERM` and `SIGINT` it closes the server and exits with code 0 (needed so coverage of the process is collected).
API bodies are JSON. Errors are `{"error": "<message>"}`.

A link object: `{slug, url, clicks, createdAt, expiresAt, expired}`. `clicks` is an integer, `createdAt` ISO-8601, `expiresAt` ISO-8601 or `null`, `expired` boolean (true once `expiresAt` has passed).

| Method + path | Request | Success | Failure |
|---|---|---|---|
| `POST /api/links` | `{url: string, slug?: string, expiresAt?: string}` | `201` link object, `clicks: 0` | `400` invalid input or malformed JSON; `409` slug taken; `413` body over 10 KB; `429` rate limited |
| `GET /api/links` | - | `200` array, newest first | - |
| `GET /api/links/:slug` | - | `200` link object (also when expired) | `404` unknown slug |
| `DELETE /api/links/:slug` | - | `204` empty body (also when expired) | `404` unknown slug |
| `GET /:slug` | - | `302` with `Location: <url>`; `clicks` increases by 1 | `404` unknown slug; `410` expired (click not counted) |
| `GET /` | - | `200` `text/html` page (see below) | - |
| `GET /healthz` | - | `200` `{"ok": true}` | - |
| anything else | - | - | `404` unknown route, `405` known path with the wrong method |

Validation for `POST /api/links`:
- `url`: required string, at most 2048 chars, must parse as an absolute URL whose protocol is exactly `http:` or `https:` (so `javascript:`, `data:`, `file:`, `ftp:` and relative URLs are rejected).
- `slug`: optional; 3 to 32 chars of `A-Za-z0-9_-`, case-sensitive. Reserved (rejected with 400): `api`, `healthz`. If omitted, a random 7-char `a-z0-9` slug is generated that does not collide with an existing one.
- `expiresAt`: optional ISO-8601 string that parses and is in the future, else 400.
- Rate limit: at most 30 `POST /api/links` per minute per client address; the 31st gets `429` with a `Retry-After` header (seconds).

Persistence: every mutation, including a click, is written to `DATA_FILE` before the response is sent. A restarted server serves the same links and counts. Missing or empty file means no links; the directory is created if needed.

Web page (`GET /`): contains a form `id="create-form"` with inputs named `url` and `slug`, and a table `id="links"` whose body lists each link's slug, target and click count, loaded from the API with `fetch`. Link text is inserted with `textContent`, never `innerHTML`. Responsive, keyboard usable, labels on inputs, readable in light and dark.

## Acceptance criteria
Visible: `acceptance/shortener.acceptance.test.js`. A hidden holdout set also grades the final result.

## Out of scope
Auth, accounts, databases, frameworks, analytics beyond a click counter, custom domains.

## Verify command (definition of done)
```
node ../../.claude/harness/bin/verify.js
```
Reads `verify.config.json`: tests pass with none skipped, at least 16 tests, source coverage at least 80%, real assertions in `tests/`, a mutation spot-check, and the hidden holdout.

## Constraints
- No dependencies; no outbound network calls.
- Never commit secrets. Work only on the current feature branch; never push to main.
