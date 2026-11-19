# Reviews: packing-list (phase 6)

Four reviewers ran in parallel on the build that first passed the gate (commit "feat: packing-list browser UI; gate green"). Each was given `ux.md` as a hard requirement list and told to escalate, not apply, any finding that contradicts it. None did: there were no escalations.

| Reviewer | Effort | CRITICAL | HIGH | MEDIUM | LOW |
|---|---|---|---|---|---|
| `code-reviewer` | low | 0 | 0 | 3 | 6 |
| `security-reviewer` | high | 0 | 0 | 2 | 6 |
| `a11y-architect` | low | 0 | 0 | 2 | 4 |
| `performance-optimizer` | low | 0 | 0 | 1 | 5 |

Open: CRITICAL 0, HIGH 0

There were no CRITICAL or HIGH findings in any review, before or after the fix round, so no reviewer was re-run on the fix (decision D21). The fix round was done by a builder (`gan-generator`) and the full gate was re-run after it: 172/172 tests, coverage 99.45%, hidden tests 25/25, journeys 25/25, mutation 8/8, VERIFY PASSED.

## MEDIUM findings

| # | From | Finding | Outcome |
|---|---|---|---|
| M1 | code | Optimistic add + poll race: an item could show twice (temporary row and real row) until the add response arrived | Fixed: `mergeItems` skips unseen incoming ids while an add is pending; unit test added. Side effect, accepted: another person's new item appears one poll later if it lands during your own add |
| M2 | code | Tick then remove on the same item: the tick's settle cleared the pending remove, so the row could flicker back and take focus | Fixed: `settlePending` clears only its own kind; unit test added |
| M3 | code | `src/http.js` "stop reading" latch after the body cap was not covered by any test (the surviving mutant from the first gate run) | Fixed: test asserts one `body_too_large` rejection and that the oversized body is never concatenated or parsed; mutation now 8/8 |
| M4 | a11y | Progress text rewritten on every poll, so a screen reader may re-announce it every 2 s (WCAG 4.1.3) | Fixed: written only when the text changes. No unit test (DOM code) |
| M5 | a11y | "Connection lost. Trying again..." rewritten on every failed poll (WCAG 4.1.3) | Fixed: same guard |
| M6 | security | Anyone who can reach the server can fill the 10000-list cap (no rate limit, no expiry), after which creating a list returns 503 | Logged, not fixed: only reachable from the same machine by default; LAN use is an explicit opt-in. Documented in the README as a limit. A per-client create limit and list expiry are backlog items |
| M7 | security, performance | Every write serialises the whole store synchronously; measured 4 ms at 10 full lists, 200 ms at 1000, about 1.8 s at 10000 | Logged, not fixed: whole-file synchronous writes are the accepted trade-off in ADR 0001 and the pretty-printed format and MAX_LISTS are in the frozen spec. The growth ceiling is documented in the README; compact JSON or a lower cap is a backlog item needing a spec amendment |

## LOW findings

Fixed in the fix round: poll chain could stop on an exception (now re-armed in `finally`); copy-fallback status message never cleared; focus lost when a poll finds the list gone (now moved to the new h1); data directory and file modes (0700 / 0600) and exclusive temp-file open so a planted symlink is not followed; persist failures now log the error code (never a list id); header and request timeouts were enforced only every 30 s (now `connectionsCheckingInterval: 1000`, `maxConnections = 1000`); unused `hasAsset` export removed.

Logged, not fixed (reason):
- Synchronous XHR for the first load of the list page (code, performance): the journey tests read the title immediately after navigation; cost is 1 to 5 ms on localhost. Backlog: async first load once the journeys wait for the title.
- `list.js` has no unit tests of its own; only the pure logic in `logic.js` is tested, the rest is covered by the 25 browser journeys.
- Unused `logic.js` script tag on the not-found page: a unit test requires two asset references per page; harmless.
- Temporary (unsaved) rows use `disabled` rather than `aria-disabled`: focus is in the item input at that time, so nothing is lost.
- Static page title "Packing list" until the first load completes.
- Loopback detection covers only 127.0.0.1, localhost and ::1; bidi override characters are accepted in text; no polling slow-down in hidden tabs; `Cache-Control: no-store` also on assets; no fetch timeout. All low impact for a local app; backlog.

## Not reviewable by these agents

Contrast and focus-outline appearance were computed from the CSS by hand, not measured in a browser; live-region behaviour was not tested with a real screen reader (also listed as open in `ux.md`).
