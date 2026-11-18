# Task: qa (phase 7 of the product-team process)

Walk the retro board as a user would, in a real browser, and report what you find. The app is in `examples/retro-board/` (start it from that directory with `PORT=<free port> DATA_DIR=<a directory inside this repo> node src/server.js`; it prints `Retro board running at http://localhost:<port>`). The contract is `docs/product/retro-board/ux.md`: its section "UI acceptance checks" has 15 numbered checks.

## How

Use Chromium through Playwright for Node: `require('playwright')` works from any directory and the browsers are installed. Keep your scripts inside this repository (for example under `.qa/`). Use two isolated browser contexts (A is the facilitator, B a participant) as the checks say. Execute each of the 15 checks as written, against a fresh data directory (check 13 needs you to stop and restart the server). Wait for what the check expects rather than sleeping a fixed time. Stop the server when you are done.

When something differs from what `ux.md` says, work out the cause: say what you did, what you expected, what you saw, and the file in `public/js/` or `src/` that you think is responsible. Do not edit any code: you report, you do not fix.

## Output

Write exactly one file at the repository root: `qa-report.md`. It must contain one line per check, in this exact form (a table or prose elsewhere is fine, but these lines must exist):

```
CHECK <n>: PASS - <what you verified>
CHECK <n>: FAIL - <what differed>
```

for every n from 1 to 15, and one line per distinct defect, in this exact form:

```
DEFECT <k>: <file or area> - <expected behaviour> but <observed behaviour>
```

## Rules

- Write only inside this repository. Do not read files outside it, and do not open the grading script named at the end of this prompt (you may run it).
- There is no human to ask. Make a decision, record it in the file, and carry on.
- Your final message must be under 15 lines: what you wrote, where, and anything you could not do.
