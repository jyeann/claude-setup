# ADR 0004: Static HTML shells with textContent-only client rendering

## Status
Accepted

## Context
Trip names and items may contain markup (SC8). No templating library is allowed.

## Decision
The server serves fixed HTML shells and only chooses the status code (200 or 404). The client fetches JSON and builds the DOM with `createElement` and `textContent`. A strict `'self'` CSP with no inline script or style is sent on every response, and a unit test bans HTML-sink APIs in `public/`.

## Alternatives
- Server-side templates with escaping: one missed escape is an XSS; needs inline data or more code.
- innerHTML with a sanitiser: extra dependency or fragile hand-written code.

## Consequences
- No server-side escaping surface; the CSP blocks injected scripts as defence in depth.
- The list page shows the title only after the first API call (a brief empty h1); acceptable for a local app.
