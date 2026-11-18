# Reviews: retro-board (phase 6)

Three agents, in parallel, effort high / high / medium. No CRITICAL or HIGH finding from any of them. Fix round: decision 15.

## Code review (`code-reviewer`, high): APPROVE
Sound: synchronous write path (validate, clone, mutate, atomic write, swap), rollback on a failed rename, 409 carrying a fresh view, ETag tied to the persisted version, own-card exclusion, in-place merge keeping focus.
- M1 a failed add lost the card text when the textarea was no longer empty (message even said "Your text is still here"). Fixed.
- M2 a lock file holding the current process's own pid counted as live (container restart as pid 1). Fixed.
- M3 `public/js/board.js` (617 lines) has no tests; the coverage gate only measures `src/`. **Open.** Pure decisions were extracted into `logic.js` and tested; the DOM code is covered only by the browser smoke and QA scripts.
- M4 any exception in the poll was shown as "offline". Fixed.
- L5 `escapeLine('a \n b')` gave three spaces. Fixed. L8 `board_full` showed a generic error. Fixed. L6/L7 dead branch and a tautological test: noted.

## Security review (`security-reviewer`, high): no blocker
Verified: 128-bit tokens stored as hashes, timing-safe facilitator check on every facilitator route, no path traversal (asset allowlist, hashed filenames), no prototype pollution, no token logging, full CSP, CSRF and DNS-rebinding controls, body limits.
- M1 board slot exhaustion with the LAN opt-in: accepted (decision 18).
- M2 the per-client-id vote budget can be reset by minting ids: accepted (decision 17).
- M3 the markdown export leaves inline HTML, links and images as typed: confirmed as a documented, non-blocking risk, notice added (decision 16).
- L4 loopback detection, L5 file permissions, L8 U+2028/9: fixed. L6 lock race and predictable tmp name, L7 rate-limit gaps: open, low, single-user local scope.

## Accessibility review (`a11y-architect`, medium): one serious issue
**The agent had no shell, so it could not run the browser checks it was asked for; every finding is from reading code and computing contrast by hand.**
- Serious: validation errors were silent for keyboard submits. Fixed.
- Moderate fixed: vote button names now start with the visible text; offline banner announced; retry focus kept; Copy buttons labelled.
- Moderate open: `disabled` vs `aria-disabled` on vote buttons, double speech from toast plus assertive region (decisions 19, 20).
- Minor open: share toggle double signal, `pre` label, column names reading "Went well 3", saving-text contrast, light border at 2.86:1.
- Contrast: light and dark themes computed as passing (text 7+:1, accent 6.7+:1).
