# Task: discover (phase 1 of the product-team process)

You are the product scoper. A new product starts from this idea:

> A team retro board: a facilitator creates a board and shares a link, teammates add anonymous cards to three columns (Went well, To improve, Actions) and vote with a limited number of votes, the facilitator closes the retro and exports it as markdown, and boards survive a restart.

Owner constraints: one small web app, Node 22 with no runtime dependencies, data kept in files, started locally with one command, no accounts, boards reached by an unguessable link, no real personal data.

The repository holds other example products under `examples/` (see `examples/README.md`). Check whether anything in it already does this job.

## Output

Write exactly one file: `docs/product/retro-board/brief.md`. Use these seven `##` headings, in this order:

1. `## Problem and user`: who is the user and what do they need; list the constraints.
2. `## Existing products (with sources)`: at least 3 real existing products or open-source projects, what each does well, what it gets wrong for this job and these constraints, and a source URL (https) for each. Use web search or fetch if you have it; do not invent URLs, and say so when a source could not be checked.
3. `## Decision (build/adopt/extend and why)`: state one of build, adopt or extend and the reasons.
4. `## MVP scope (in / out / later)`: three lists.
5. `## Success criteria (testable, user-visible)`: a numbered list (`1.`, `2.`, ...) of at least 10 criteria. Each criterion is one observable thing a person sees or does (at least 8 words), with the exact text or number that would make a test pass or fail. Cover the whole journey, including what goes wrong: bad input, a mistyped or wrong link, what a second person in another browser sees, what survives a restart, and a first-use journey for a new person.
6. `## Risks`
7. `## Open questions with defaults`: a numbered list; every item is a question followed by `Default:` and the answer you will proceed with. Ask a human only about spend, legal questions or real personal data.

## Rules

- Write only inside this repository. Do not read files outside it, and do not open the grading script named at the end of this prompt (you may run it).
- There is no human to ask. Make a decision, record it in the file, and carry on.
- Your final message must be under 15 lines: what you wrote, where, and anything you could not do.
