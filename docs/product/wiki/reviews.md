# Reviews: wiki (phase 6, round 1)

Four reviewers ran in parallel on the build at commit "feat: wiki browser UI". None had write access to the repo. Probes ran in the scratchpad.

| Reviewer | CRITICAL | HIGH | MEDIUM | LOW/INFO | Verdict |
|---|---|---|---|---|---|
| code-reviewer | 0 | 0 | 4 | 5 | approve with caveats |
| security-reviewer (effort high) | 0 | 0 | 5 | 9 | perimeter held; availability and robustness issues |
| a11y-architect | 0 | 2 | 8 | 10 | contrast passes everywhere; focus and announcement gaps |
| performance-optimizer | 0 | 0 | 2 | 5 | all targets met by wide margin |

Measured: search 62 ms at 5,000 notes (target 500 ms), graph data 79 ms at 5,000, list 40 ms, open 2 ms, RSS 112 MB at 5,000 notes. Rename of a heavily linked note takes 1.0 s at 5,000 notes.

## Verified clean by security probes
Host/DNS rebinding (uppercase, trailing dot, userinfo, missing, duplicate), Origin/CSRF, request smuggling, body limit boundary, path traversal (about 20 forms), symlinks and hardlinks (no write-through), prototype pollution, markdown XSS and every link-scheme bypass tried, DOM clobbering, CSP and headers, ReDoS in the link regexes and search.

## Findings and disposition

| # | Sev | Finding | Disposition |
|---|---|---|---|
| R1 | HIGH (a11y) | Focus lost on every /graph route change (graph.js, app.js) | Fix round 1 |
| R2 | HIGH (a11y) | Dialog errors not announced (dialogs.js) | Fix round 1 |
| R3 | MEDIUM | Rename reads every note; blocks the loop (rename.js:55-68) | Fix round 1: only rewrite notes whose indexed links include the old key |
| R4 | MEDIUM | Rename corrupts invalid UTF-8 in linking notes (rename.js) | Fix round 1: skip into `failed` when bytes do not round-trip |
| R5 | MEDIUM | Unreadable note aborts rename after the move (rename.js) | Fix round 1: read errors go to `failed` |
| R6 | MEDIUM | Quadratic scanCode on unclosed backtick runs: 2 MiB note freezes the server 3.6 s (wikilink.js) | Fix round 1 |
| R7 | MEDIUM | Quadratic emphasis, straddles, heading regex and deep blockquote in markdown.js: a note can hang or break the tab | Fix round 1: linear scans, depth cap, try/catch with plain-text fallback |
| R8 | MEDIUM | Lock file read as stale while empty: two servers can share a vault | Fix round 1: write pid via tmp + link; empty lock means retry |
| R9 | MEDIUM | Uncapped search results (1.2 MB at 5,000) | Logged, not fixed: spec says `total === results.length`. Cheap client win only (`content-visibility`). Revisit with a spec change |
| R10 | MEDIUM | a11y M2-M8: banner re-announces on Copy, Save loses focus, aria-current on li only, silent search failure, search count re-announced on save, stale results after delete, dialog text not described | Fix round 1 (all cheap) |
| R11 | LOW | Atomic write resets mode to 0644 on private notes | Fix round 1: copy the existing mode, 0600 for new |
| R12 | LOW | Lone surrogate titles give 500 after the file exists, or 503 after a rename succeeded | Fix round 1: reject in validateTitle (rule 4, `title_control` message) |
| R13 | LOW | Missing 404 mapping in delete and rename dialogs; search over 200 chars gives a misleading error | Fix round 1: maxlength 200 and 404 messages |
| R14 | LOW | FIFO open without O_NONBLOCK; stale tmp deletion pattern too broad; filename log injection | Fix round 1 (one-line fixes) |
| R15 | LOW | No cap on GET of an external multi-GB file | Logged, not fixed: local-only, user's own files |
| R16 | LOW | Search with `İ` finds nothing (regex fallback) | Logged, not fixed: rare |
| R17 | LOW | bidi and format characters allowed in titles | Logged, not fixed: display spoofing only, no trust boundary in a single-user local app |
| R18 | LOW | a11y L3-L10 (hidden-tab tabpanel roles, graph hit radius floor, 1,000 graph tab stops, forced-colors marker, phone home landmarks M1) | M1 fixed in round 1; the rest backlog |
