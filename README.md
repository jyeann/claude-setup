# claude-setup

A product team for Claude Code. One idea goes in; a team of agents scopes it, designs it, builds it under an
objective gate, reviews it, walks it in a browser and documents it. The owner is asked at two owner gates only:
`spec-approved` (the spec, including the chosen look) and `accepted` (the released result). The harness, not the
agent, decides when it is done.

Start with `.claude/skills/orch-product-team/SKILL.md` and `.claude/harness/README.md`.

## What is here

| Path | What it is |
|---|---|
| `.claude/skills/orch-product-team/` | The eleven-phase workflow: discover, UX, design, plan, build, review, QA, UAT, staging guide, release, retro. |
| `.claude/agents/` | The 15 agents the workflow calls (14 team roles plus `harness-optimizer`). |
| `.claude/skills/` | 9 skills: the workflow, `harness-install`, and companions the agents use (API design, ADRs, TDD, e2e testing, security review, accessibility, engineering reference). |
| `.claude/commands/` | `/harness-build` and `/harness-improve`. |
| `.claude/rules/ecc-common/` | Five short always-loaded rules. |
| `.claude/harness/` | Guard hooks, the verify gate (tests, type check, coverage, test quality, hidden holdout, browser journeys, mutation), the whole-pipeline stop gate, tracing and KPI roll-up. Dependency-free, with its own test suite. |
| `testbench/`, `docs/testbench/` | The test bench: `retro-board`, the reference product the process is proven and tuned on, and its run records. Its full verify gate runs in CI (`gate-retro-board`); `testbench/retro-board/tune/` is the per-phase effort comparison (`eval-kit-selftest`). New products are built in their own repository, not here. The small gate setup examples (`todo-api`, `slug-ts`, `sheet-engine`) are in `.claude/harness/fixtures/`. |
| `docs/process/definition-of-done.md` | What has been proven about the process, and when to re-check it. |

## Run the team
Give a session an idea and tell it to use `orch-product-team`. The product is built in its own repository (or a
path you give), never in this one: the skill installs the harness there (see below), works inside that repository,
and keeps the run records in `<product-repo>/docs/product/<slug>/`. With no target named, it proposes a new
repository named after the product and asks you once. It then starts the harness with the whole pipeline as the
definition of done, so the Stop hook sends the agent back to the next unfinished phase instead of letting it stop
to ask. The run pauses only at the two owner gates, labels you add to the spec issue: `spec-approved` after the spec
(phase 4a), before any ticket or test is written, and `accepted` after release, before the retro. While a label is
missing, the pipeline reports `waiting for owner` and the turn ends; add the label and the run moves on. Your answer
at a gate counts as a gate response, not an intervention. This repo keeps only the process and its test bench
(`testbench/retro-board/`).

## Install in another project
Claude Code 2.1.275 or later:
```
/plugin install product-team --marketplace jyeann/claude-setup
```
or from a shell: `claude plugin marketplace add jyeann/claude-setup && claude plugin install product-team@jyeann`.

To share with a team, declare it in the project's `.claude/settings.json`:
```json
{
  "extraKnownMarketplaces": { "jyeann": { "source": { "source": "github", "repo": "jyeann/claude-setup" } } },
  "enabledPlugins": { "product-team@jyeann": true }
}
```

The plugin does **not** activate the harness: a plugin cannot ship deny rules, sandbox settings, a status line or
always-loaded rules, and the guards expect to live in the project. Add them with `/product-team:harness-install`, or:
```bash
node .claude/harness/bin/install.js /path/to/project --dry-run   # from a clone of this repo; drop --dry-run to write
```
It copies `.claude/harness/` (without this repo's own test suite), `.claude/rules/` and `.claude/plans/`, merges hooks,
permissions, sandbox and status line into the project's `.claude/settings.json` without removing anything already there,
and adds `.harness/` to `.gitignore`. Re-run it to update.

## Where the agents came from
Twelve of the 15 agents and six of the skills are taken from **ECC (Everything Claude Code)** v2.2.3 (upstream commit
b38be6a, MIT, see `.claude/ECC-LICENSE`); the rest is local. Only what the team calls is kept. The rest of the ECC
catalogue (web-framework skills, extra reviewers, slash commands) and the `orch-*` single-feature workflows were removed
on 2026-11-20 after a full product run used none of them. To get any of it back, take it from upstream
(https://github.com/affaan-m/everything-claude-code) or from this repo's history before that date, one file at a time,
then run the checks below.

The team's measured results hold for these exact agent files. A change to an agent the team uses is a change to the
team: re-run the checks in `docs/process/definition-of-done.md` before taking it.

## Checks
```bash
node --test .claude/harness/test/*.test.js     # harness suite, 90% line floor in CI
node .claude/harness/bin/check-refs.js         # no agent, skill or command points at something missing
claude plugin validate .
```

## Manifests
`.claude-plugin/marketplace.json` (marketplace `jyeann`) and `.claude/.claude-plugin/plugin.json` (`product-team`).
Plugin names starting with `claude-` are reserved. No `version` is set on purpose: installs track the latest commit on
`main`, and a pinned version would hold users on a stale copy until someone remembered to bump it.
