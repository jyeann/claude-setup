# claude-setup

My Claude Code configuration, built on **ECC (Everything Claude Code)**
v2.2.3 (upstream commit b38be6a), MIT licensed.

Included under `.claude/`:
- `agents/`: 34 specialist subagents for web apps (planner, code-reviewer, security-reviewer, ...)
- `commands/`: 46 slash commands
- `skills/`: 55 skills, trimmed for web apps (JS/TS, React/Next.js, frontend, testing, general workflow)
  plus the `orch-*` feature/bugfix/refactor workflows. Re-add any others from upstream `skills/`.
- `rules/ecc-common/`: five short always-loaded rules (agents, git, performance/model, security, testing), rewritten for the harness. The generic upstream ones were removed or moved to the on-demand `skills/engineering-reference` (patterns, hooks, development-workflow, code-review) to keep the base context small.

Not included: ECC hooks. This repo ships its own `.claude/harness/` hooks instead (pre-bash and pre-write guards, a post-edit lint hook, and a Stop-time verify loop).

## Workflow additions (local, not from ECC)
- `skills/grill-me`: interview-until-aligned step before planning (`orch-pipeline` phase 1.5, standard and large tasks).
- `skills/plan-to-tasks` + `harness/templates/tasks.md`: backlog of vertical slices with `blocked-by` and `AFK`/`HITL`.
  `node .claude/harness/bin/next-task.js TASKS.md` picks the next ready AFK task; the loop runbook uses it.
- Status line (`harness/bin/statusline.js`): exact context token count, warns past ~100K ("dumb zone").
- Pruned: non-web language agents/commands, and commands that need ECC scripts this repo does not ship
  (`continuous-learning-v2`, instincts, sessions). Restore any of them from upstream if needed.

## Use it in another project
Install it as a plugin (Claude Code 2.1.275 or later):
```
/plugin install web-harness --marketplace jyeann/claude-setup
```
or from a shell: `claude plugin marketplace add jyeann/claude-setup && claude plugin install web-harness@jyeann`.

That gives the project the agents, commands and skills, namespaced as `/web-harness:<name>`. To share it with a team,
declare it in the project's `.claude/settings.json` instead:
```json
{
  "extraKnownMarketplaces": { "jyeann": { "source": { "source": "github", "repo": "jyeann/claude-setup" } } },
  "enabledPlugins": { "web-harness@jyeann": true }
}
```

The plugin does **not** activate the harness: a plugin cannot ship deny rules, sandbox settings, a status line or
always-loaded rules, and the guards expect to live in the project. Add them with `/web-harness:harness-install`, or directly:
```bash
node .claude/harness/bin/install.js /path/to/project --dry-run   # from a clone of this repo; drop --dry-run to write
```
It copies `.claude/harness/` (without this repo's own test suite), `.claude/rules/` and `.claude/plans/`, merges hooks,
permissions, sandbox and status line into the project's `.claude/settings.json` without removing anything already there,
and adds `.harness/` to `.gitignore`. Re-run it to update. Commands that call `node .claude/harness/bin/...`
(`/harness-build`, `/harness-improve`, the loop runbook) need this step.

The manifests are `.claude-plugin/marketplace.json` (marketplace `jyeann`) and `.claude/.claude-plugin/plugin.json`
(plugin `web-harness`; names starting with `claude-` are reserved, so it cannot be called `claude-setup`). No `version` is
set on purpose: installs track the latest commit on `main`, and a pinned version would hold users on a stale copy until
someone remembered to bump it. Check a change with `claude plugin validate .`.

Copying the `.claude/` folder into a repo, or opening a Claude Code session on this repo, still works.

## Update from upstream
```bash
git clone --depth 1 https://github.com/affaan-m/everything-claude-code /tmp/ecc
# Do NOT use --delete: it would restore everything pruned above and drop the local skills.
rsync -a /tmp/ecc/{agents,commands,skills} .claude/   # then re-run the prune, or copy only what you want
# Do NOT sync rules/common/ over .claude/rules/ecc-common/: those five files are customised.
```

## Pruned for being unrunnable here
Commands, skills and agents that need upstream ECC scripts, MCP servers or skills this repo does not ship were removed, because
an agent that picks them fails and wastes tool calls (the `efficiency` scorer would flag it). Removed: the instinct/learning stack
(`/evolve`, `/instinct-*`, `/projects`, `/promote`, `/prune`, `/skill-health`; replaced by `/harness-improve`), `/epic-*`,
`/multi-*`, `/astra-review`, `/santa-loop`, `/plan-canvas`, `/sessions`, `/quality-gate`, `/harness-audit` (the `harness-optimizer` agent stays; it runs the harness tests and `tune.js` instead),
`/auto-update`, `/project-init`, `/setup-pm`, `/skill-host-compat`, `/issue-review`, `/jira`, `/token-card`, `/cost-report` (its metrics log is never written here), the `ecc-guide`,
`plan-canvas` and `documentation-lookup` skills, and the `docs-lookup` agent (needs a Context7 MCP server). Re-add from upstream
only together with the scripts they call. Rule: after any upstream sync, run the reference check in `.claude/harness/README.md`.
