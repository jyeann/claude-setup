# Task: review (phase 6 of the product-team process)

Review the retro board in `testbench/retro-board/` (server in `src/`, browser code in `public/`). The contract is `testbench/retro-board/spec.md` and `docs/testbench/retro-board/design.md`. The code was changed after it last passed review and has no tests. Find the real defects: places where the code breaks the spec or the design, loses or corrupts data, or is unsafe. Read the code, reason about what it does, and run it if that helps (`PORT=<free port> DATA_DIR=<a directory inside this repo> node src/server.js`).

## Output

Write exactly one file at the repository root: `review-report.md`. Do not change any other file, including the code you review. Start with a two-line verdict (approve or block, and why). Then one finding per heading, most severe first, at most 15, each in this form:

```
### F<n>: <short title>
Severity: CRITICAL | HIGH | MEDIUM | LOW
File: <path relative to the repository root>:<line>
What: what the code does and where it differs from the spec or design
Why it matters: the concrete failure or attack
Fix: the smallest change
```

Only report what you can point to in a file and line. Do not pad the report with style remarks.

## Rules

- Write only inside this repository. Do not read files outside it, and do not open the grading script named at the end of this prompt (you may run it).
- There is no human to ask. Make a decision, record it in the file, and carry on.
- Your final message must be under 15 lines: what you wrote, where, and anything you could not do.
