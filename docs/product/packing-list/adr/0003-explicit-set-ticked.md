# ADR 0003: Explicit set of ticked state, not toggle

## Status
Accepted

## Context
Several people may tick the same item at nearly the same time, and the client retries or polls concurrently.

## Decision
`PUT /api/lists/:id/items/:itemId/ticked` with body `{"ticked": true|false}`. Idempotent; last write wins per item; a repeated value is a 200 no-op. Remove is `DELETE` and returns 404 item_not_found if already gone, which the client treats as done.

## Alternatives
- `POST .../toggle`: two people ticking flips the item back; retries double-flip.
- PATCH of the whole item: wider surface, item editing is out of scope.

## Consequences
- Retries are safe and the result matches what the user saw when clicking.
- A concurrent opposite change from someone else may overwrite yours; the next poll shows the final state.
