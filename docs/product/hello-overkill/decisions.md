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

## 2026-11-19/20: flagship redesign ("The Overkill Greeting Office")

Full spec: `redesign/ux-redesign.md` (section 8 lists 22 smaller design calls with reasons; section 9 is the a11y review). Code design: `redesign/design.md`.

- **Decision:** art direction. **Options:** postal ministry (stamps, seals, telegrams); terminal/hacker; brutalist; soft SaaS. **Chosen:** postal ministry, one recurring gesture (the stamp). **Why:** "overkill hello" is a joke told sincerely; postal ceremony gives serials, seals and departments, a distinctive palette and type without a template look. **Decided by:** ux-designer.
- **Decision:** dependencies and fonts. **Options:** add a framework or web fonts (needs CSP font-src and a build); stay dependency-free with system font stacks. **Chosen:** no dependencies, no web fonts, CSP unchanged. **Why:** the bar was reachable with CSS and inline SVG; adding font-src or a bundler would widen the CSP that the acceptance tests pin. **Decided by:** orchestrator.
- **Decision:** UC11 keeps the first 8 Tab stops. **Options:** skip link and header theme toggle; footer theme radios and secondary nav after main. **Chosen:** footer radios ("Appearance", System/Light/Dark, `localStorage['ho-theme']`), secondary nav "Other departments" after main (right rail at 1200px+, sticky only when the window is 640px+ tall). **Why:** UC11 is a fixed acceptance check; landmarks satisfy bypass blocks. **Decided by:** ux-designer, a11y-architect.
- **Decision:** module structure. **Options:** one 2,500-line page.js; split into `src/page/` parts. **Chosen:** split (tokens, geometry, icons, style, markup, script) behind the same `{ html, styleHash, scriptHash }` export; security.js and router.js unchanged. **Why:** pure geometry and contrast maths get exact unit tests; the served HTML is identical in shape for the acceptance regexes. **Decided by:** architect.
- **Decision:** certificate art. **Options:** build the guilloche and seal in the browser; precompute in Node. **Chosen:** precompute in Node and inline static SVG (19 border paths, scalloped seal, 30 per-glyph ring texts, no textPath since href is banned). Border art rounded to 1 decimal and drawn with 4-unit steps so the page stays under the 160 KB budget. **Why:** first-paint rendering, no client maths, deterministic hash. **Decided by:** architect (precompute), orchestrator (budget trims).
- **Decision:** view transitions. **Options:** shared-element stamp morph hello to certificate; none. **Chosen:** none. **Why:** the certificate loads asynchronously after the route change, so the morph has no target at swap time; the spec marked it optional. Route changes use the section rise. **Decided by:** orchestrator.
- **Decision:** a11y review findings (27: 1 critical, 3 high). **Chosen:** all CRITICAL and HIGH fixed in the build: wall flash budget (one animated row per 500 ms, no luminance wash or flip), forced-colors rules, certificate content in normal flow with the ratio as a minimum and the seal in flow, sticky rail gated on height. MEDIUM/LOW applied: seal is `role=img` with a label and hidden glyphs; reduced motion zeroes all delays and turns motion-only effects into no-ops; Pause updates toggle on the wall (`wall-pause`); delayed (1 s) loading announcements; `lang` on certificate and battle greetings; counter on the first cell; "Your pick" is real text in a list; theme change announced only for pointer use; pulse floor .7, tick .6, shake 2 cycles 400 ms, year flick 150 ms for 3 s; seal gloss .12; idle map strokes use `--control`; SLA tiles auto-fit; sparkline figure aria-hidden. **Accepted, not changed:** A11Y-25 wall time is generated content (the v2 row text is fixed by tests and the time is supplementary); A11Y-22 the v1 validation rule announces and focuses at once (fixed by ux.md). **Decided by:** orchestrator.
- **Decision:** process shortcuts. **Chosen:** the plan was written by the orchestrator (`redesign/TASKS.md`) instead of a planner hop, because the spec and design already split the work; the orchestrator built the UI (one coherent art direction in one file set) while two other agents wrote the tests (tdd-guide: unit; e2e-runner: Playwright RC suite). **Decided by:** orchestrator.
