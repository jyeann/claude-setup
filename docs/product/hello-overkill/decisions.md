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

## Decision: certificate verification is strict about whitespace
- Decision: should whitespace added outside the certificate JSON still verify as Authentic?
- Options: (a) tolerate outer whitespace (architect's draft caveat); (b) strict: any edit, including added whitespace, is Forged.
- Chosen: (b). Brief criterion says any single-character edit is Forged; the visible acceptance test (`inserting or deleting one character`, adds a trailing space) and design.md section 4 already say so. The architect's caveat was dropped when design.md was saved, but it had been passed to the holdout author, so the holdout contradicted the visible acceptance test (TEST_AMBIGUOUS). The holdout test was corrected to expect Forged/mismatch.
- Decided by: orchestrator.

## 2026-11-18: v2 scope and semantics for the six deferred ideas
- Decision: exact semantics for Weather, SSE wall, SLA dashboard, time machine, haiku, federation (full detail in `v2/spec.md`).
- Options: (a) follow the brief's one-liners literally (time machine as permalink replay by greeting ID, SLA with "warmth latency", weather bundled into `POST /hello`); (b) redefine each so it is deterministic, testable and safe with Node built-ins.
- Chosen: (b). Weather is simulated from a seeded hash of (UTC date, place) and appended only on `GET /api/weather`, so the byte-exact `POST /hello` contract is untouched. The time machine takes a date (1900..today) instead of an ID because certificates already provide permalinks, and streak status is derived read-only from the stored first/last day and current streak, with an honest `unknown` state because per-visit history is not stored. Stream events are anonymised by construction (`anonymise` never receives the name), capped at 50 clients with a 20-event replay ring. SLA counts 5xx as errors and reports 4xx (418, 429) separately so chaos and politeness do not look like outages, with fixed route labels for bounded memory. Haiku verifies output against the same documented heuristic and exposes a `syllables` override rather than claiming linguistic accuracy. Federation is allowlist-only via `HELLO_PEERS`, with address vetting and pinned connect, no redirects, 1500 ms / 64 KB limits, peer data validated and whitelisted, private peers off by default.
- Why: every choice keeps zero dependencies and the v1 contracts, makes the logic pure with injected now/random/fetch for tests, and puts the security risk (SSRF, name leakage, unbounded memory, untrusted peer text) behind explicit limits. v1 decided federation was out because it breaks one-process; v2 reopens it only as outbound calls to a trusted allowlist, so the process stays single.
- Also decided: three retro FIX items (EPIPE, flaky chaos test, surviving mutants) ship in the same round.
- Decided by: orchestrator.

## Decision: v2 gate fixes (holdout vs spec)
- Findings from the first v2 gate run (3 of 40 holdout failures), resolved against `v2/spec.md`:
  1. `parseDate('0001-01-01')` said "not a real date": a `Date.UTC` two-digit-year quirk. IMPL bug, fixed (`setUTCFullYear`), unit test added.
  2. `normalizePlace('\tnew\n york ')` was rejected as control characters although the spec says collapse whitespace. IMPL bug, fixed (collapse first, then reject non-whitespace control/format characters). The builder's earlier unit test that rejected `a\nb` was corrected.
  3. Holdout test sent unescaped spaces in a request path (`ERR_UNESCAPED_CHARACTERS`) and expected era "social era" for 2024-02-29 (spec: 2020-today is "now"). TEST_WRONG, both corrected.
- Decided by: orchestrator.
