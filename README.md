# claude-setup

A product team for Claude Code. One idea goes in; a team of agents scopes it, designs it, builds it under an
objective gate, reviews it, walks it in a browser and documents it. The harness decides when it is done.

Two parts, kept apart on purpose:

| Part | Where | What it is |
|---|---|---|
| **Team + harness** (core) | `.claude/` | The `orch-product-team` workflow, the 15 agents it calls, 11 skills, 2 commands, five always-loaded rules, and the harness (`.claude/harness/`: guard hooks, verify gate, whole-pipeline gate, tracing). This is what the repo is for. |
| **Resource hub** (on demand) | `.claude/hub/` | 21 more agents, 48 skills and 43 commands for web apps, trimmed from **ECC (Everything Claude Code)** v2.2.3 (upstream commit b38be6a, MIT), plus the `orch-*` feature, fix and refactor workflows. Nothing in it is loaded into a session. The `resource-hub` skill (about 100 tokens) points an agent at `hub/INDEX.md`, and the agent reads only the item it needs. |

Start with `.claude/skills/orch-product-team/SKILL.md` and `.claude/harness/README.md`.

## Install in another project
Claude Code 2.1.275 or later:
```
/plugin install product-team --marketplace jyeann/claude-setup
```
or from a shell: `claude plugin marketplace add jyeann/claude-setup && claude plugin install product-team@jyeann`.
The hub ships inside `product-team` and is read on demand. To load the whole hub into every session instead (about 9,600 tokens), also run `claude plugin install ecc-web@jyeann`.

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
and adds `.harness/` to `.gitignore`. Re-run it to update. `/harness-build`, `/harness-improve` and the team's run need it.

Opening a Claude Code session on this repo gives you the core directly, with the hub available on demand.

## How ECC is used
ECC is a catalogue, not a base to edit in place. The rules this repo follows:
- **Core holds only what the team calls.** Twelve of the 15 core agents and six of the core skills come from ECC; the
  rest are local (`product-scoper`, `ux-designer`, `harness-improver`, `orch-product-team`, `plan-to-tasks`,
  `harness-install`, `engineering-reference`, the rules, the whole harness).
- **Everything else from ECC is a resource hub** in `.claude/hub/`: available to any agent at any time, loaded only
  when one is needed, so it costs no context until then.
- **Pinned, not tracked.** The measured results (effort defaults, the definition of done) hold for these exact agent
  files. An upstream change to an agent the team uses is a change to the team: re-run the checks in
  `docs/process/definition-of-done.md` before taking it.
- **ECC hooks are not used.** The harness ships its own.

## Update from upstream
```bash
git clone --depth 1 https://github.com/affaan-m/everything-claude-code /tmp/ecc
# Hub: copy only what you want into .claude/hub/{agents,commands,skills}. Do NOT use --delete.
# Then: node .claude/hub/build-index.js
# Core: take a changed agent or skill into .claude/ one file at a time, and read the diff first.
# Do NOT sync rules/common/ over .claude/rules/ecc-common/: those five files are customised.
node .claude/harness/bin/check-refs.js                                   # core must stand on its own
node .claude/harness/bin/check-refs.js .claude/hub --also .claude        # the hub may point into the core
claude plugin validate .
```
Items that need upstream ECC scripts, MCP servers or skills this repo does not ship stay out, because an agent that
picks them fails and wastes tool calls: the instinct/learning stack, `/epic-*`, `/multi-*`, `/sessions`,
`/quality-gate`, `/harness-audit`, `/cost-report`, the `docs-lookup` agent (needs a Context7 MCP server) and the
non-web language agents. The reference check lists the removed commands and fails if one comes back.

## Examples and products
`examples/` holds the specs and products used to test the harness and the team (`link-shortener` and `retro-board`
are gated in CI; `retro-board/tune/` is the per-phase effort comparison). Product documents are in `docs/product/`.
`hello-overkill` moved to https://github.com/jyeann/HW-PIRPLE-1 (branch `claude/hello-overkill`).

## Manifests
`.claude-plugin/marketplace.json` (marketplace `jyeann`), `.claude/.claude-plugin/plugin.json` (`product-team`) and
`.claude/hub/.claude-plugin/plugin.json` (`ecc-web`). Plugin names starting with `claude-` are reserved. No
`version` is set on purpose: installs track the latest commit on `main`, and a pinned version would hold users on a
stale copy until someone remembered to bump it.
