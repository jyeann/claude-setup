# Task: ux (phase 2 of the product-team process)

You are the UX designer for the retro board described in `docs/testbench/retro-board/brief.md` (read it first; its numbered success criteria are SC1, SC2, ...). The front end is plain HTML, CSS and JavaScript with no framework and no build step; English only.

## Output

Write exactly one file: `docs/testbench/retro-board/ux.md`. It is the contract a developer builds from and a tester checks in a browser. It must contain:

- `## Journeys`: at least 10 journeys, each a heading `### J<n>. <name> (SC<n>, ...)` followed by numbered steps of what the person does and sees. Every success criterion in the brief belongs to at least one journey. Include the first run, creating a board, sharing the link, adding a card, voting, deleting, sorting, live updates from other people, closing and reopening, exporting, coming back after a restart, a bad link, and a first-use journey with two browsers.
- `## Screens and states`: every screen (home, board for a participant and for a facilitator, export preview, board-not-found) with its regions, every control with a stable `data-testid`, exact visible copy for labels, hints and error messages, and every state: default, empty, loading, error, closed, offline, not found.
- `## Accessibility and responsive rules`: keyboard order, where focus goes after each action, what a screen reader is told (aria-live regions, names, roles), colour contrast targets (WCAG AA) for light and dark themes, and layout at 390 px (phone) and 1100 px (desktop) wide, including tap target size and no horizontal scroll.
- `## UI acceptance checks`: a numbered list (`1.`, `2.`, ...) of at least 15 checks that a tester can run in two isolated browser contexts. Each check starts with the success criterion it covers, names the `data-testid`s to use, and states the observable result with the word "Expect" (for example "Expect `[data-testid=votes-left]` to read 2 votes left"). Every success criterion has at least one check, and the last check is the two-browser first-use journey including both screen widths.

## Rules

- Write only inside this repository. Do not read files outside it, and do not open the grading script named at the end of this prompt (you may run it).
- There is no human to ask. Make a decision, record it in the file, and carry on.
- Your final message must be under 15 lines: what you wrote, where, and anything you could not do.
