# Reviews: hello-overkill (phase 6)

Reviewers (parallel, read-only): code-reviewer, security-reviewer, a11y-architect, performance-optimizer. No CRITICAL anywhere.

## Triage
| # | Source | Sev | Finding | Disposition |
|---|---|---|---|---|
| S1/C2/P1 | sec, code, perf | HIGH | `visitors` unbounded, whole-file sync rewrite per write | FIX: `MAX_VISITORS` 10,000 oldest-first eviction. Debounced async persist REJECTED: breaks "persist before respond" (design 5, SIGKILL acceptance test); sync-write cost accepted and documented (~10 ms/write at the 10k cap). |
| P2 | perf | MED | `transact` copies all Maps per write | FIX: undo record instead of snapshot |
| C1 | code | MED | stale `.tmp` after failed persist | FIX: remove tmp on failure; write mode 0600, flag `wx` after unlinking stale tmp (S7) |
| C3/S6 | code, sec | MED/LOW | corrupt-file handling: any read error quarantines; rename failure swallowed but logged as success | FIX: quarantine only on parse/shape failure; other read errors exit 1; log true outcome |
| C6 | code | LOW | any store exception becomes "could not save" | FIX: typed `PersistError` |
| C4 | code | LOW | readBody has no `close` listener | FIX |
| S2/S3/C5 | sec, code | MED | limiter: IPv6 rotation, O(keys) sweep at capacity, early eviction | FIX: key IPv6 by /64, normalise IPv4-mapped, amortised sweep. Global limiter and trusted-proxy hops: LOGGED, out of scope (single-process practice app). |
| S4 | sec | MED | verify/read endpoints unmetered | LOGGED: cheap, 16 KB cap; accepted for MVP |
| S5 | sec | MED | per-IP connection cap | LOGGED: belongs to a reverse proxy |
| S8 | sec | LOW | secret fails open | FIX: with `NODE_ENV=production` require a secret of >= 32 chars, else exit 1 |
| S9 | sec | LOW | chaos reachable in production | LOGGED: chaos is a product feature (brief idea 7); documented |
| S10 | sec | LOW | no `cache-control` on API | FIX: `cache-control: no-store` on /api/* |
| P6 | perf | LOW | page not precomputed | LOGGED |
| C7 | code | LOW | no fsync | LOGGED: process-crash durable, OS-crash not; documented |
| A1 | a11y | HIGH | control border contrast < 3:1 | FIX: `--ctl-line` |
| A2 | a11y | HIGH | focus lost when retry/next-battle clears the focused control | FIX |
| A3-A8 | a11y | MED | aria-disabled for submit, verify aria-invalid+focus, re-announce repeated status, announce async loads, shared error helpers, `color-scheme` | FIX |
| A9-A11 | a11y | LOW | lang on foreign greetings, hashchange refocus, vote error association | FIX A10, A11; A9 only where the API returns a language |

## Gate
Open HIGH after fix round must be zero. Re-run verify.js (tests, coverage, holdout, mutation) after fixes.

# v2 review round (federation, wall, SLA, time machine, haiku, weather)

Reviewers: security-reviewer, code-reviewer (read-only); browser QA 42/42 (see qa.md). No CRITICAL or HIGH.

| # | Source | Sev | Finding | Disposition |
|---|---|---|---|---|
| M1 | sec | MED | federation hello fans out to every peer per request; peers rate-limit by our single IP | FIX: global shared limiter on outbound federation hellos (30/min) with `HELLO_FED_GLOBAL_LIMIT`; in-flight coalescing already exists |
| M2 | sec | MED | `/api/time-machine?name=` reveals whether a name has a streak (enumeration) | ACCEPTED + documented: spec default is on and acceptance tests pin it; `HELLO_TIME_MACHINE_STREAKS=0` disables it; README warns. Revisit if deployed publicly. |
| M3 | sec | MED | `/api/sla` open when no token; short tokens accepted | FIX: token must be >= 16 chars when set; with `NODE_ENV=production` and no token the route answers 401 |
| M4 | sec | MED | SSE connect attempts unmetered | FIX: `readLimiter` on `/api/stream`. Proxy trust (XFF): LOGGED, out of scope. |
| L1 | sec | LOW | blocklist gaps (Teredo, site-local, 198.18/15, doc ranges, 192.0.0.0/24, SIIT) | FIX: add ranges |
| L2 | sec | LOW | peer text is untrusted display content | ACCEPTED: textContent + cleanText, peers are operator-trusted |
| L3 | sec | LOW | names sent to peers over plain http | FIX: startup warning for non-loopback http peers; README |
| L4/C2 | sec, code | LOW/MED | `routeLabel` ignores trailing-slash normalisation (`/hello/`, `/api/stream/` land in `other`, skews latency) | FIX + test |
| L5 | sec | LOW | `ts` in events is a timing side channel | LOGGED: acceptance tests pin `ts`; revisit |
| C1 | code | MED | mutant `config.js:23` survives: invalid `HELLO_READ_LIMIT` / `HELLO_FED_LIMIT` untested | FIX: tests ('0','100001','x','-5','' fall back with one warning) |
| C3 | code | MED | acceptance check for "federation never links" only catches `setAttribute('href', ...)` | FIX in `test/page-v2.test.js` (ban `.href =`, require `#/` for href). Acceptance file untouched (read-only). |
| C4 | code | MED | spec ambiguous on which limiter guards `/api/federation` | RATIFY: health uses `readLimiter` (cached 5 s), hello uses `fedLimiter`; spec line updated |
| C5 | code | LOW | haiku `verified:true` under a `syllables` override | RATIFY: documented in spec |
| C6 | code | LOW | weather collapses tab/newline in place | RATIFIED (decisions.md) |
| C7 | code | LOW | milestone priority differs from spec list order | RATIFY: code order is the spec; list order in spec updated, test pins it |
| C8 | code | LOW | fixed `setTimeout(50)` in router-v2 test | FIX: poll with a deadline |

## Redesign review (2026-11-20)

The redesign had four reviewers working in parallel and read-only: code-reviewer, security-reviewer, a11y-architect (reviewing the build) and performance-optimizer. Each was given `ux.md` and `redesign/ux-redesign.md` as hard requirements. None found a CRITICAL issue, and the only HIGH was P1, which is deferred.

| ID | From | Sev | Finding | Disposition |
|---|---|---|---|---|
| F1 | code | MED | A failed response-body read could leave buttons busy forever | FIX: `api()` resolves `{status:0}` on body-read failure |
| F2 | code | MED | Time machine error after an earlier success left a random postmark year; the year roll was not cancelled | FIX: restore the previous year on error; cancel the roll with a sequence token |
| F3 | code | MED | No stale-response guard on battle or leaderboard; a late vote could steal focus | FIX: `battleSeq` guard and `isCur('battle')` |
| F4 | code | MED | Restoring from the back/forward cache left wall and SLA dead | FIX: re-route on `pageshow` when persisted |
| F5 | code | MED | A second option could vote while the first vote was pending | FIX: both options are `aria-disabled` while a vote is pending |
| F6 | code | LOW | Stale announcements after leaving a view | FIX: `slowSay` checks the view. ACCEPTED: the 429 countdown keeps running so "You can say hello again." is still announced, which is correct for the shared limit |
| F7-F9, F11, F12 | code | LOW | Certificate retry focus; dots timer; SLA samples kept across visits; string-replace pattern; stale federation output | FIX |
| F10 | code | LOW | `const` in ES5-style script | FIX |
| S1-S4 | security | LOW/INFO | `lang` not validated; same-origin text not cleaned; `cleanText` missing U+00AD and U+061C; server error text shown raw | FIX: `langOf`, `cleanText` at render, extra characters, cleaned error and hint |
| P1 | perf | HIGH | Page served uncompressed (156 KB; 44 KB gzip, 33 KB brotli) | FIXED after the user asked for it: `src/compress.js` precomputes a gzip variant (level 9) and a strong ETag at startup. `GET /` sends gzip when Accept-Encoding allows it (q-values honoured), adds `Vary: Accept-Encoding` and `Cache-Control: no-cache`, and answers 304 for a matching If-None-Match. The security headers are unchanged on every variant. API responses are not compressed. 12 new unit and router tests; no acceptance or holdout test pins page encoding. |
| P2 | perf | MED | Loops (scan glow, pen, skeleton) | ACCEPTED: they run only while loading, and are off under reduced motion |
| P6, P8 | perf | MED/LOW | Wall FLIP read before the trim; year flick not stopped on route change | FIX |
| N1 | a11y | MED | `.ghost-letter` pulsed under reduced motion | FIX (also RC3 in QA) |
| N2 | a11y | MED | Annex tiles and tabs at 320 px | FIX: `overflow-wrap`, `min-width:0`, tab icons hidden under 360 px |
| N3, N5-N8 | a11y | LOW | Silent battle and peer loading; forced-colours focus versus selection; theme pointer flag; certificate padding at 320 px; select arrow under forced colours | FIX |
| N4 | a11y | LOW | Wall reconnect flip-flop announcements | ACCEPTED: the EventSource retry cadence is the browser's (about 3 s), so each state change is real |
| 24 | a11y | LOW | Print had no heading | FIX: print shows the real h1 and hides the decorative title; footnote reworded |

The a11y reviewer verified every section-9 fix in code except two. 07 (loops in normal motion) is accepted as above. 25 (wall time as generated content) is accepted in decisions.md.
