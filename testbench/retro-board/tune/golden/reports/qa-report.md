# QA report: retro-board

Chromium through Playwright, two isolated contexts (A facilitator, B participant), fresh data directory. 3 defects found, 10 of 15 checks pass.

CHECK 1: PASS - home page shows the Create a retro form, no sign-in anywhere
CHECK 2: PASS - creating Sprint 12 opens the facilitator view with three empty columns and both links
CHECK 3: PASS - empty and whitespace titles show the exact error and focus stays on the field
CHECK 4: PASS - participant link shows the same board without facilitator controls
CHECK 5: PASS - card appears in B at once and in A within 5 s, draft untouched
CHECK 6: PASS - empty, 501 character and hostile text handled as written
CHECK 7: FAIL - the vote count on the card stays at 0 after clicking Vote; it only shows the new value after a reload
CHECK 8: FAIL - second browser votes are not reflected in the card count in either window until reload
CHECK 9: FAIL - Delete removes the card immediately, there is no "Delete this card?" confirmation
CHECK 10: PASS - sort by votes orders each column by data-votes and the second press restores the order
CHECK 11: FAIL - after Close retro the Add card form and textarea are still visible in A and B
CHECK 12: PASS - export preview, copy, download sprint-12.md all identical
CHECK 13: PASS - offline banner, recovery and reload keep the same state
CHECK 14: PASS - bad links show Board not found, wrong facilitator token gives the participant view
CHECK 15: FAIL - first-use journey stops at the close step because the add form is still shown on a closed retro

DEFECT 1: public/js/board.js updateCard - the vote count should change as soon as a vote is added or removed, but the count stays stale and does not update until the page is reloaded
DEFECT 2: public/js/board.js openConfirm - Delete should ask "Delete this card?" with Delete and Cancel, but the click deletes the card immediately without any confirmation
DEFECT 3: public/js/board.js render - closing the retro should remove the add-card form, but the form and textarea are still visible after the retro is closed
