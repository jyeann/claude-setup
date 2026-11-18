# Review report: retro-board

Verdict: block. One defect lets a client spend more votes than the spec allows, one lets card text run as script in every viewer's browser, one breaks the "nothing changed" promise of a failed write, and two weaken the access checks.

### F1: Card text is inserted with innerHTML
Severity: CRITICAL
File: examples/retro-board/public/js/board.js:305
What: `updateCard` sets `p.text.innerHTML = card.text`. design.md section 6 and spec.md forbid innerHTML anywhere in served JS: card text must be set with textContent.
Why it matters: stored XSS. A card containing `<img src=x onerror=...>` runs script in every participant's and the facilitator's browser, and the facilitator link is in that page's URL.
Fix: `p.text.textContent = card.text`.

### F2: The store puts the new board in memory before the write succeeds
Severity: HIGH
File: examples/retro-board/src/store.js:135
What: in `update()` the line `boards.set(hash, draft)` runs before `persist(hash, draft)`. design.md section 4 says the copy is swapped in only after the rename succeeded, so a failed write leaves the old board.
Why it matters: when the disk write throws, the client gets 503 "Nothing changed" but the board in memory already has the new card or vote and a bumped version. Other viewers see state that was never saved, and it is lost on restart. There is no rollback.
Fix: call `persist` first and `boards.set` after it returns.

### F3: Vote budget allows 4 votes
Severity: HIGH
File: examples/retro-board/src/board.js:50
What: the check is `votesUsed(board, voter) > MAX_VOTES` where the spec says at most 3 votes per client id. With `>` the fourth vote is accepted (an off-by-one); it should be `>=`.
Why it matters: every participant gets one more vote than the spec and UI promise ("No votes left" shows at 3 but the server accepts a 4th), so vote results are skewed.
Fix: use `>=`.

### F4: Host and Origin checks are skipped when there is no Origin header
Severity: HIGH
File: examples/retro-board/src/router.js:70
What: `hostAllowed` returns true as soon as the Origin header is undefined, before the loopback Host check. design.md section 6 requires the Host check on every request when HOST is loopback.
Why it matters: a DNS-rebinding page or any client that omits Origin can reach the API with `Host: evil.example` and get a 200 instead of 403.
Fix: remove the early return; only compare Origin when it is present.

### F5: Facilitator token compared with ===
Severity: MEDIUM
File: examples/retro-board/src/router.js:107
What: `isFacilitator` compares `tokens.sha256Hex(f) === b.facHash`. design.md section 6 says the check is `timingSafeEqual` (tokens.safeEqual exists and is now unused).
Why it matters: string comparison with === is not constant-time, so response timing can leak how many leading characters of the facilitator hash match (a timing side channel on the facilitator check).
Fix: `tokens.safeEqual(tokens.sha256Hex(f), b.facHash)`.
