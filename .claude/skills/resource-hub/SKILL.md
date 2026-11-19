---
name: resource-hub
description: Find and load a specialist skill, agent or command from the on-demand hub (React, Next.js, TypeScript, Postgres, Prisma, Docker, SEO, motion, i18n, reviewers, the orch-* feature and fix workflows). Use when a task needs know-how or a specialist that the loaded skills and agents do not cover.
metadata:
  origin: local
---

# Resource hub

The hub is a library of about 110 skills, agents and commands, trimmed from Everything Claude Code. None of
it is loaded into a session, so it costs no context until you take something from it.

Location: the `hub/` folder next to this skill's `skills/` folder (`.claude/hub/` in this repository,
`${CLAUDE_PLUGIN_ROOT}/hub/` when installed as a plugin).

## Use

1. Read `hub/INDEX.md`. It has one line per item: name, path, what it is for.
2. Pick the one or two items the task needs. Do not load items "to be safe".
3. Load each as follows:
   - **Skill**: Read its `SKILL.md` and follow it. Read files under its `references/` only when it tells you to.
   - **Agent**: Read the agent file, then start a general-purpose agent with that file's body as its brief plus
     your task. Keep to the tools and model its frontmatter names.
   - **Command**: Read the file and carry out its steps.
4. Say which item you used in your report or in `decisions.md`.

## Rules

- Hub items are reference material. The rules in `.claude/rules/`, the harness and `orch-product-team` win where they disagree.
- Several hub commands wait for a human to confirm (`plan`, the `orch-*` workflows). In an unattended run, take
  the decision yourself, log it, and continue.
- Nothing in the hub may change harness files, settings or the verify gate.
- If nothing fits, carry on without it. An empty search is not a reason to stop.

Everyone who wants the whole library loaded all the time can install the `ecc-web` plugin instead, at about
9,600 tokens per session.
