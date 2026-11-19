# ADR 0002: Client polling every 2 seconds

## Status
Accepted

## Context
Other people's changes must appear within 5 s (SC6, SC7). Built-in `http` only; a few concurrent viewers per list.

## Decision
The list page polls `GET /api/lists/:id` every 2000 ms through a non-overlapping `setTimeout` chain and merges the result by item id in place, never touching the input, error text or focus.

## Alternatives
- Server-Sent Events: lower latency, but long-lived connections, reconnect logic, and server fan-out state.
- ETag/304 on polls: saves bytes; skipped because a list view is under ~30 KB and it adds versioning state. Can be added later without API breakage.
- Manual refresh: fails SC6.

## Consequences
- Worst-case latency about 2 s plus request time, well under 5 s.
- Constant small load per open tab; fine for local use.
- In-place merge is required so polling never clobbers typing or focus.
