# Spec: todo-api

## Goal
A tiny JSON HTTP API for a todo list, with file persistence. Zero runtime dependencies (Node 22 built-ins only).

## Interface (exact)
Start: `node src/server.js`. Env: `PORT` (default 3000), `DATA_FILE` (default `./data/todos.json`).
On startup it prints a line containing `listening on <port>` to stdout once it accepts connections.
On `SIGTERM` and `SIGINT` it closes the server and exits with code 0 (required so test coverage of the process can be collected).
All bodies are JSON (`content-type: application/json`). Errors are `{"error": "<message>"}`.

| Method + path | Request | Success | Failure |
|---|---|---|---|
| `POST /todos` | `{"title": string, 1-200 chars after trim}` | `201` `{id, title, done:false, createdAt}` (`title` trimmed, `id` string, `createdAt` ISO-8601) | `400` missing/non-string/empty/too-long title, or malformed JSON |
| `GET /todos` | optional `?done=true\|false` | `200` array, oldest first | `400` for any other `done` value |
| `GET /todos/:id` | - | `200` todo | `404` unknown id |
| `PATCH /todos/:id` | `{title?: string, done?: boolean}` (at least one) | `200` updated todo | `400` empty body / wrong types / invalid title; `404` unknown id |
| `DELETE /todos/:id` | - | `204` empty body | `404` unknown id |
| anything else | - | - | `404` for unknown routes, `405` for a known path with the wrong method |

Persistence: every mutation is written to `DATA_FILE` before the response is sent; a restarted server serves the same todos.
A missing or empty `DATA_FILE` means an empty list. The directory is created if needed.

## Acceptance criteria
All in `acceptance/todo.acceptance.test.js` (read-only for the generator).

## Out of scope
Auth, pagination, databases, frameworks, a UI.

## Verify command (definition of done)
```
node .claude/harness/bin/verify.js
```
It reads `verify.config.json`: tests pass with none skipped, at least 12 tests ran, source (`src/`) line coverage at least 80% (60% per file), the generator's tests in `tests/` reference `src/` and contain real assertions, and a mutation spot-check kills at least 60% of sampled mutants. `--fast` skips mutation for quick iteration only. Protect `verify.config.json` and `acceptance/` with `--protect`.

## Constraints
- No dependencies; no network calls other than serving.
- Never commit secrets. Work only on the current feature branch; never push.
