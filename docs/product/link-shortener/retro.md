# Retro: link-shortener first run

Built with the existing harness and agents, before the team process existed. Result: a working product that passes verify, with a user-visible gap found by the person using it.

## What went wrong (root causes)

- **No discovery or UX step.** The spec was written by the orchestrating session from a one-line idea. It asked for slug, target and clicks, never "the user sees the short link". The product stored links and did not show them. Nothing between idea and build owned "what must a person see and do", and no phase walked the product as a user. Fixed in the product (aaff08b) and in the process (`product-scoper`, `ux-designer`, phase 7 walkthrough).
- **Human gates and habits caused 5 interventions** (see `interventions.json`). Three were stops to ask; one was an unowned eval defect; one was a usage limit with no resume.
- **Cost evidence was thin.** Effort was not recorded, two agents ran in the background with no outcome, and the first KPI view counted a failed review as a success. Fixed in the roll-up (unreported outcomes, phase tag, model x effort, human prompts).
- **The tune gate was weaker than the real gate** (no holdout) and its worktree shared history with the finished code.

## Measured so far

- tune (sonnet, 2 trials each): low $0.27 / 68 s, medium $0.25 / 71 s, high $0.43 / 152 s, all 100% pass. Not a discriminating task.
- review at low vs high effort, same code: 35.7k tokens / 35 s vs 50.4k / 86 s; high found one extra real bug (`//` routing).

## Next checks for the new process

1. Run `orch-product-team` end to end on a second product with zero interventions after the first prompt.
2. Confirm the `[phase:...]` tags and effort land in the KPI file.
3. Re-tune effort per phase on a task that actually separates the levels.
