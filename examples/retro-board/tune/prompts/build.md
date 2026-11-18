# Task: build (phase 5 of the product-team process)

Build the retro board in `examples/retro-board/`. The repository is in the RED state: `spec.md` (exact interface), `acceptance/` (human-written HTTP tests, read-only), `verify.config.json` and `package.json` exist, and the design documents are in `docs/product/retro-board/` (`brief.md`, `ux.md`, `design.md`). There is no `src/`, `public/` or `tests/`.

## Output

- `src/` and `public/` as laid out in `design.md` section 1 and `ux.md` (server, static pages, browser scripts). Node 22, no dependencies, no build step.
- Unit tests in `tests/*.test.js` (`node:test`), written beside the code as you go.

## Definition of done

Run from `examples/retro-board`: `node --test "acceptance/*.test.js" "tests/*.test.js"`. The final gate is stricter than green tests:

- at least 30 tests in total, none skipped, and the same result on a second run;
- at least 80% line coverage of `src/` overall and 60% per file, measured by V8 across all processes including the spawned server, so the server must exit 0 on SIGTERM and SIGINT so it can write its coverage;
- the unit tests are real: each file in `tests/` loads code from `src/` and makes at least 3 assertions;
- a hidden set of at least 8 more acceptance tests that you cannot see, so implement the whole of `spec.md` and `design.md`, not just what `acceptance/` happens to check;
- a mutation spot-check: operators in `src/` are flipped one at a time and at least 60% of those changes must make your tests fail.

Do not edit `acceptance/`, `spec.md`, `verify.config.json` or `package.json`'s scripts; they are restored before grading.

## Rules

- Write only inside this repository. Do not read files outside it, and do not open the grading script named at the end of this prompt (you may run it).
- There is no human to ask. Make a decision, record it in the file, and carry on.
- Your final message must be under 15 lines: what you wrote, where, and anything you could not do.
