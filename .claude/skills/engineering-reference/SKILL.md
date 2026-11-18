---
name: engineering-reference
description: On-demand reference rules - agent roster and delegation, performance and model selection, design patterns, hooks usage, the research-plan-TDD-review-commit development workflow, and the full code review checklist. Use when choosing an agent or model, planning a feature, reviewing code, or when the user asks how these conventions work.
metadata:
  origin: ECC (moved out of always-loaded rules to keep the base context small)
---

# Engineering Reference

These files used to load into every session as rules. They are rarely needed, so they are pulled on demand instead,
which keeps the always-on context small (the "smart zone" shrinks as context grows). Read only the one you need.

| Need | Read |
|---|---|
| Which agent for which job, parallel delegation | `references/agents.md` |
| Model choice, context window, effort and thinking | `references/performance.md` |
| Research-first feature workflow before commits | `references/development-workflow.md` |
| Full review checklist and severity levels (the `code-reviewer` agent reads this) | `references/code-review.md` |
| Repository pattern, API envelope, skeleton projects | `references/patterns.md` |
| Hook types and permission guidance | `references/hooks.md` |

Rules that still load every session: `rules/ecc-common/` (coding-style, security, testing, git-workflow).
