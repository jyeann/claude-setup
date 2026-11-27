# claude-setup

A product team for Claude Code. One idea goes in; a team of agents scopes it, designs it, builds it under an
objective gate, reviews it, walks it in a browser and documents it. The owner is asked at three owner gates only:
`design-approved` (the look and the key screens, rendered), `spec-approved` (the spec) and `accepted` (the released
result). A product with no designed screens has only the last two. The harness, not the
agent, decides when it is done.

Start with `.claude/skills/orch-product-team/SKILL.md` and `.claude/harness/README.md`.

## What is here

| Path | What it is |
|---|---|
| `.claude/skills/orch-product-team/` | The nine-phase workflow: discover, UX, design, plan, build, review, QA, release, retro. |
| `.claude/agents/` | The 15 agents the workflow calls (14 team roles plus `harness-optimizer`). |
| `.claude/skills/` | 10 skills: the workflow, `repo-setup`, `harness-install`, and companions the agents use (API design, ADRs, TDD, e2e testing, security review, accessibility, engineering reference). |
| `.claude/commands/` | `/harness-build` and `/harness-improve`. |
| `.claude/rules/ecc-common/` | Five short always-loaded rules. |
| `.claude/harness/` | Guard hooks, the verify gate (tests, type check, coverage, test quality, hidden holdout, browser journeys, mutation), the whole-pipeline stop gate, tracing and KPI roll-up. Dependency-free, with its own test suite. |
| `testbench/`, `docs/testbench/` | The test bench: `retro-board`, the reference product the process is proven and tuned on, and its run records. Its full verify gate runs in CI (`gate-retro-board`); `testbench/retro-board/tune/` is the per-phase effort comparison (`eval-kit-selftest`). New products are built in their own repository, not here. The small gate setup examples (`todo-api`, `slug-ts`, `sheet-engine`) are in `.claude/harness/fixtures/`. |
| `docs/process/definition-of-done.md` | What has been proven about the process, and when to re-check it. |

## Run the team
Give a session an idea and tell it to use `orch-product-team`. The product is built in its own repository (or a
path you give), never in this one: the skill sets that repository up there (see "New repository" below), works inside that repository,
and keeps the run records in `<product-repo>/docs/product/<slug>/`. With no target named, it proposes a new
repository named after the product and asks you once. It then starts the harness with the whole pipeline as the
definition of done, so the Stop hook sends the agent back to the next unfinished phase instead of letting it stop
to ask. The run pauses only at the owner gates, labels you add to the spec issue: `design-approved` after the look
and key screens are rendered, before the system is designed; `spec-approved` after the spec (phase 4a), before any
ticket or test is written; and `accepted` after release, before the retro. While a label is
missing, the pipeline reports `waiting for owner` and the turn ends; add the label and the run moves on. Your answer
at a gate counts as a gate response, not an intervention. This repo keeps only the process and its test bench
(`testbench/retro-board/`).

## New repository
Each product lives in its own repository. Set one up with one command (or tell a session "set up this repo",
which uses the `repo-setup` skill):
```bash
node .claude/harness/bin/setup-repo.js /path/to/product-repo [--repo owner/name] [--environment <name>]
```
It prints one checklist, one row per step: the harness (guards, verify gate, rules, settings), the `product-team`
and `mattpocock-skills` plugins (enabled in the project's `.claude/settings.json`), the labels (`spec-approved`,
`accepted`, `afk`, `hitl`, `needs-triage`, `needs-info`, `wontfix`, `needs-fable`, created through `gh`), the
repository docs (`docs/agents/`, `GLOSSARY.md`, `docs/adr/`) and the cloud environment. Each row is `done`,
`already there`, or `needs you` with a link and the one thing to do. It never creates a cloud environment, a
repository or a paid service, and never applies a gate label to an issue. Re-run it any time: it changes nothing
that is already right and reports what was missing; `--check` only reports. Then commit what it wrote and open a
new session in that repository, because plugins and hooks load only when a session starts.

A product run checks this first: `harness.js init` with `pipeline.js check` as its verify command refuses to start
(exit 2, nothing written) while any checklist row is open, and names each row and its action. Where `gh` cannot
reach GitHub, pass `--labels-json <file>` (a saved copy of the repository's labels) to `init` or `setup-repo.js`.

From a Claude Code session without a clone of this repo, install the plugin first
(`/plugin install product-team --marketplace jyeann/claude-setup`) and run `/product-team:repo-setup`.
The installer alone is still there for the harness only: `node .claude/harness/bin/install.js <dir> [--dry-run]`.

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
