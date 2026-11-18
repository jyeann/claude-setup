# Task: tests (the test-owner role in phase 4 of the product-team process)

You are the test owner. Three documents describe the retro board: `docs/product/retro-board/brief.md` (what, with numbered success criteria SC1, SC2, ...), `ux.md` (what a person sees) and `design.md` (architecture and the HTTP API contract). **No implementation exists and you must not write one** (no `src/`, no `public/`). Another agent will build the app from the same documents; then your tests decide whether it is right. Your tests will also be run against a different implementation written by someone else from the same documents, and against deliberately broken copies of it, so assert what the documents state and nothing more: where they are silent, assert the status class or the field, not exact wording.

## Output (all under `examples/retro-board/`)

- `spec.md`: the exact interface and rules the builder must meet (start command, environment variables, pages, JSON API table with statuses and error codes, view shape, rules and limits, export format, persistence, security headers) and a map from each success criterion to the test that checks it. Where the documents allow two readings, pick one here and say so; the spec wins over the other documents.
- `acceptance/helpers.js`: HTTP-only test helpers (contract below).
- `acceptance/*.test.js`: at least 30 tests with `node:test` and `node:assert/strict`, run from `examples/retro-board` with `node --test "acceptance/*.test.js"`. Name each test after the behaviour (for example `returns 400 title_empty when the title is blank`). Cover every success criterion that can be checked over HTTP, plus: limits at the boundary (1, 500, 501 characters), hostile text returned unchanged, vote budget and refunds, two clients, author versus facilitator delete, closed boards, export format and ordering, persistence across a restart, bad and wrong links, ETag and 304, wrong content type, oversized body, wrong method, response headers, no inline script or style in served pages, no unsafe DOM sinks in served JavaScript, every `data-testid` that `ux.md` lists present in the served HTML or JavaScript.

## Helper contract

`helpers.js` spawns the real server as a child process with the app directory (`examples/retro-board`) as its working directory: `node src/server.js` with environment variables `PORT` (a free port you chose) and `DATA_DIR` (a fresh temporary directory). The server prints a line containing `Retro board running at http://localhost:<port>` once it accepts connections; wait for that line (fail after 8 seconds, showing stderr). Stopping the server means sending SIGTERM and expecting exit code 0. Offer: start with options, stop, restart on the same `DATA_DIR`, a `withServer(fn)` that starts a fresh server per test and always cleans up, and a call function `(method, path, body, {clientId, headers, raw})` that sends JSON with `X-Client-Id` (22 characters from `A-Za-z0-9_-`) and returns `{status, body, text, headers}`. Use a fresh server per test: the server rate-limits each IP (create 20, write 300, read 900 requests per minute). Tests use HTTP only and never import anything from `src/`, so they can run against any implementation. Avoid fixed sleeps over one second.

No implementation exists, so the tests cannot pass yet: check with `node --check` that every file parses, and run them once to confirm that they fail because the server does not start.

## Rules

- Write only inside this repository. Do not read files outside it, and do not open the grading script named at the end of this prompt (you may run it).
- There is no human to ask. Make a decision, record it in the file, and carry on.
- Your final message must be under 15 lines: what you wrote, where, and anything you could not do.
