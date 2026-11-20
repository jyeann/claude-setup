# claude-setup

A product team for Claude Code. One idea goes in; a team of agents scopes it, designs it, builds it under an
objective gate, reviews it, walks it in a browser and documents it, with no human input until final acceptance.
The harness, not the agent, decides when it is done.

Start with `.claude/skills/orch-product-team/SKILL.md` and `.claude/harness/README.md`.

## What is here

| Path | What it is |
|---|---|
| `.claude/skills/orch-product-team/` | The nine-phase workflow: discover, look and UX, design, plan, build, review, QA, release, retro. |
| `.claude/agents/` | The 16 agents the workflow calls (15 team roles plus `harness-optimizer`). |
| `.claude/skills/` | 11 skills: the workflow, `design-direction`, `plan-to-tasks`, `harness-install`, and companions the agents use (API design, ADRs, TDD, e2e testing, security review, accessibility, engineering reference). |
| `.claude/commands/` | `/harness-build`, `/harness-improve` and `/design`. |
| `.claude/rules/ecc-common/` | Five short always-loaded rules. |
| `.claude/harness/` | Guard hooks, the verify gate (tests, type check, coverage, test quality, hidden holdout, browser journeys, mutation), the whole-pipeline stop gate, tracing and KPI roll-up. Dependency-free, with its own test suite. |
| `examples/`, `docs/product/` | Products the team built and the specs used to test the gate. `link-shortener` and `retro-board` are gated in CI; `retro-board/tune/` is the per-phase effort comparison; `packing-list` and `wiki` are the latest full runs; `todo-api`, `sheet-engine` and `slug-ts` are small gate examples the harness README points to. |
| `docs/process/definition-of-done.md` | What has been proven about the process, and when to re-check it. |

## Run the team
In a session on this repo (or a project with the plugin and harness installed), give it an idea and tell it to use
`orch-product-team`. The skill starts the harness with the whole pipeline as the definition of done, so the Stop
hook sends the agent back to the next unfinished phase instead of letting it stop to ask.

## Starting a JavaScript or TypeScript project
The verify gate grades Node projects that run tests with `node:test`. Copy the closest config into the product folder:

| Stack | Copy | What differs |
|---|---|---|
| JavaScript | `examples/todo-api/verify.config.json` | `.test.js` globs |
| TypeScript | `examples/slug-ts/verify.config.json` and a `tsconfig.json` | `.test.ts` globs, `typecheck` (`npx tsc --noEmit`), `tsconfig.json` in `mutation.copy`; Node 22.18+, erasable syntax only |

Add `holdout` and `journeys` for a product with screens (see `examples/packing-list/verify.config.json`). Not graded by the strong gate: JSX/TSX, Vitest, Jest and other languages. Details: `.claude/harness/README.md`, sections "Strong verify" and "TypeScript".

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
Twelve of the 16 agents and six of the skills are taken from **ECC (Everything Claude Code)** v2.2.3 (upstream commit
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
