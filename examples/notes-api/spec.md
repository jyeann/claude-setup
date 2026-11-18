# Spec: notes-api

## Goal
A multi-user notes service over JSON/HTTP: accounts with hashed passwords, bearer-token sessions, private notes with
tags, search, cursor pagination, login rate limiting and file persistence. Zero runtime dependencies (Node 22 built-ins
only; use `node:crypto` for hashing and tokens).

## Process contract
Start: `node src/server.js`. Environment (all optional):

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | listen port |
| `DATA_FILE` | `./data/notes.json` | persisted state (users and notes); parent directory is created |
| `TOKEN_TTL_MS` | `3600000` | session token lifetime |
| `LOGIN_MAX_FAILURES` | `5` | failed logins per username allowed inside one window |
| `LOGIN_WINDOW_MS` | `60000` | rate-limit window |

Once accepting connections it prints a line containing `listening on <port>` to stdout. On `SIGTERM` and `SIGINT` it
closes the server and exits with code 0. Request and response bodies are JSON. Errors are `{"error": "<message>"}`.
A request body larger than 100000 bytes gets `413`. Malformed JSON gets `400`. Unknown routes get `404`; a known path
with the wrong method gets `405`.

## Endpoints

### Public
- `GET /health` -> `200 {"status":"ok"}`
- `POST /register` `{username, password}`; `username` matches `^[a-z0-9_]{3,20}$`, `password` is a string of 8..72 chars.
  -> `201 {id, username}` (never any password or hash), `400` invalid, `409` username taken.
- `POST /login` `{username, password}` -> `200 {token, expiresAt}` where `token` is an unguessable string of at least 32
  characters, different for every login, and `expiresAt` is ISO-8601. Wrong password and unknown user both give `401`
  with the identical error message.
  Rate limit: once `LOGIN_MAX_FAILURES` failed attempts for one username have happened inside `LOGIN_WINDOW_MS` (the window
  starts at the first failure), every further login for that username, even with the correct password, gets `429` with a
  `Retry-After` header (whole seconds, at least 1) until the window has passed. Other usernames are unaffected.

### Authenticated (`Authorization: Bearer <token>`; otherwise `401`)
A missing header, malformed header, unknown token, logged-out token and expired token are all `401`.
- `POST /logout` -> `204`; the token is invalid afterwards.
- `POST /notes` `{title, body?, tags?}`; `title` string 1..100 chars after trim (stored trimmed); `body` string up to
  10000 chars (default `""`); `tags` array of at most 10 unique strings each matching `^[a-z0-9-]{1,30}$` (default `[]`;
  duplicates are a `400`). -> `201 {id, title, body, tags, createdAt, updatedAt}` (ISO timestamps), `400` invalid.
- `GET /notes?tag=&q=&limit=&cursor=` -> `200 {items: [note], nextCursor: string|null}`. Newest first (descending creation
  order; ties by insertion order). `tag` is an exact tag match; `q` is a case-insensitive substring of title or body;
  filters combine with AND. `limit` is an integer 1..100 (default 20), else `400`. `cursor` is an opaque string taken from
  a previous `nextCursor`; an invalid cursor is `400`. `nextCursor` is `null` on the last page. Paging through all pages
  returns every matching note exactly once.
- `GET /notes/:id` -> `200 note`, `404` if unknown **or owned by another user**.
- `PATCH /notes/:id` `{title?, body?, tags?}` (at least one, same validation as create) -> `200 note`; `updatedAt` is set to
  now, `id` and `createdAt` never change; `400` invalid or empty; `404` as above.
- `DELETE /notes/:id` -> `204` (empty body); `404` as above.
- `GET /tags` -> `200 [{tag, count}]` over the caller's notes only, sorted by `count` descending then `tag` ascending.

## Persistence and security
- Users and notes are written to `DATA_FILE` before the response of every mutation; a restarted server serves the same
  users and notes, and users can log in again with their password (tokens need not survive a restart).
- Passwords are stored only as salted hashes (`crypto.scrypt` or `pbkdf2`); the plaintext never appears in the data file.
- Users can never read, change, list, tag-count or delete each other's notes.

## Acceptance criteria
All in `acceptance/notes.acceptance.test.js` (read-only for the generator).

## Out of scope
Password reset, email, roles, note sharing, HTTPS, frameworks, a UI.

## Verify command (definition of done)
```
node .claude/harness/bin/verify.js
```
It reads `verify.config.json`: tests pass with none skipped, at least 30 tests ran, `src/` line coverage at least 80%
(60% per file), the generator's tests in `tests/` reference `src/` and contain real assertions, and a mutation
spot-check kills at least 60% of sampled mutants.

## Constraints
- No dependencies; no network calls other than serving.
- Never commit secrets. Work only on the current feature branch; never push.
- Organise `src/` into small modules (server/routing, auth, notes, storage, rate limiting); no file over 400 lines.
