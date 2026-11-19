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
