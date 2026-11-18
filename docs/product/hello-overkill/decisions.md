# Decisions: hello-overkill

## 2026-11-18: MVP scope

- **Decision:** which over-built features make up the MVP.
- **Options:** 12 wild ideas (see brief.md): Polyglot, Streaks, Weather, Battle, SSE wall, Signed certificates, Chaos, SLA dashboard, Time machine, Haiku, Rate-limited politeness, Federation.
- **Chosen:** the backward-compatible `POST /hello` core, plus six ideas: Polyglot Hello, Streaks and memory, Signed certificates, Greeting Battle (lite), Chaos mode, and Rate-limited politeness.
- **Why:** each of these produces something the visitor can see and that a browser or node:test check can confirm. Together they exercise file persistence, crypto, error UX and HTTP semantics using only Node 22 built-ins in one process. Federation breaks the one-process constraint. The SSE wall, SLA dashboard, haiku, weather and time machine are fun, but they add surface without adding new practice areas, so they are deferred.
- **Decided by:** product-scoper

## 2026-11-18: UX structure

- **Decision:** how the web UI is structured and tested.
- **Options:** (a) separate server-rendered pages per feature; (b) one static page with hash-routed views and a shared live region.
- **Chosen:** (b). One page at `GET /`, views at `#/hello`, `#/battle`, `#/verify`, `#/certificate/<id>`, all text set with `textContent`, one persistent `role="status"` region, and a 38-entry `data-testid` selector table in ux.md as the contract between builder and QA.
- **Why:** no extra server routes beyond the API, which fits the one-process, no-framework constraint, and stable test ids keep the Playwright walkthrough independent of styling. Certificate text is a pasteable string so the verify journey works without a server-side session.
- **Consequences for the architect:** the server needs forced chaos values (`chaos=418`, `chaos=delay`) besides `chaos=1`, and a configurable rate limit (for example `HELLO_RATE_LIMIT`) so tests can sample all language and tone combinations in the browser.
- **Decided by:** ux-designer
