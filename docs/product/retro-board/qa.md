# QA walkthrough: retro-board (phase 7)

Run by `e2e-runner` (medium effort), independent of the builder's own smoke script. Real Chromium via Playwright, two browser contexts (A facilitator, B participant), 1100 px and 390 px, light and dark. Scripts, logs and screenshots were kept in the session scratchpad (not committed).

**Result: 15 of 15 UI acceptance checks PASS** against ux.md, one flake noted.

| # | Check | Result |
|---|-------|--------|
| 1 | Start the app, home page, no sign-in | PASS |
| 2 | Create a retro: URL shape, badge, three empty columns, both links with Copy | PASS |
| 3 | Empty and whitespace titles show the exact error, focus on the input, nothing created | PASS |
| 4 | Participant link: same board, no facilitator controls | PASS |
| 5 | Card appears in B in 41 ms and in A in 1.1 s, A's draft and focus untouched | PASS |
| 6 | Empty, 501-char, hostile `<b>hi</b>`, 500-char unbroken text, no overflow at 390 px | PASS |
| 7 | Vote budget, counter, remove vote, disabled at 0, same after reload | PASS |
| 8 | Second browser has its own 3 votes, counts add up across browsers | PASS |
| 9 | Delete: author and facilitator, inline confirm, focus, propagation to the other browser | PASS |
| 10 | Sort by votes per viewer, second press restores order | PASS |
| 11 | Close and reopen: banner, controls removed and restored, in both browsers | PASS |
| 12 | Export: preview, Copy, Download `sprint-12.md`, byte-identical, 404 without the facilitator token | PASS |
| 13 | Offline banner, self-recovery, "Back online. Board updated.", reload keeps everything | PASS (one intermittent empty live region in 1 of 5 runs; 4 re-runs clean) |
| 14 | Bad links give "Board not found"; wrong facilitator token gives the participant view | PASS |
| 15 | Two-person first-use journey to a downloaded .md | PASS (6.4 s of automation time, which is tool speed not human speed; the 5-minute human timing was not measured) |

No CSP violations or page errors. Layout at 390 px: stacked, no horizontal scroll, controls 44 px high.

## First-time-user problems found (ranked), and what happened
1. Phone: share links buried the board (columns started about 960 px down). Fixed (decision 22).
2. The facilitator link block is styled like an error. Open (decision 23).
3. Disabled vote buttons give no reason on the button. Open.
4. Votes are tied to the browser and clearing storage resets them. Documented in the README and the page footer.
5. Vote count is a bare number with no "votes" label. Open.
6. ux.md check 4 contradicted check 9. Doc fixed (decision 21).

## Not covered
The fix round (9 items) was verified by the builder's updated smoke script (116 of 116 checks at both widths) and the full verify gate, not by a second independent QA pass.
