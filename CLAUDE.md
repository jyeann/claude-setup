# Project notes

## Ponytail (lazy senior dev ruleset)

- Use Ponytail (https://github.com/DietrichGebert/ponytail) only when the user asks for it or approves a suggestion. Never apply it on your own.
- Suggest it only for fast prototypes or mocks the user wants to look at.
- Do not suggest it for code that handles money, logins or user data.

## Pitfalls and the job record

- Before starting or changing a product run, read `docs/pitfalls.md` (mistakes already made, one rule each). It is not imported, to keep the always-loaded rules short.
- Job state (stage, risk, reviewers, cost, owner questions) is written only by `node .claude/harness/bin/job.js`; never hand-edit `docs/jobs/*/job.json`.
