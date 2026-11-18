# claude-setup

My Claude Code configuration, built on **ECC (Everything Claude Code)**
v2.2.3 (upstream commit b38be6a), MIT licensed.

Included under `.claude/`:
- `agents/`: 70 specialist subagents (planner, code-reviewer, security-reviewer, ...)
- `commands/`: 66 slash commands
- `skills/`: 52 skills, trimmed for web apps (JS/TS, React/Next.js, frontend, testing, general workflow)
  plus the `orch-*` feature/bugfix/refactor workflows. Re-add any others from upstream `skills/`.
- `rules/ecc-common/`: general coding / git / testing / security rules

Not included: ECC hooks (they run Node scripts on every tool call).

## Use it in another project
Copy the `.claude/` folder into that repo, or open a Claude Code session on this repo.

## Update from upstream
```bash
git clone --depth 1 https://github.com/affaan-m/everything-claude-code /tmp/ecc
rsync -a --delete /tmp/ecc/{agents,commands,skills} .claude/
rsync -a --delete /tmp/ecc/rules/common/ .claude/rules/ecc-common/
```

## Pruned for being unrunnable here
Commands, skills and agents that need upstream ECC scripts, MCP servers or skills this repo does not ship were removed, because
an agent that picks them fails and wastes tool calls (the `efficiency` scorer would flag it). Removed: the instinct/learning stack
(`/evolve`, `/instinct-*`, `/projects`, `/promote`, `/prune`, `/skill-health`; replaced by `/harness-improve`), `/epic-*`,
`/multi-*`, `/astra-review`, `/santa-loop`, `/plan-canvas`, `/sessions`, `/quality-gate`, `/harness-audit`, `/harness-optimizer`,
`/auto-update`, `/project-init`, `/setup-pm`, `/skill-host-compat`, `/issue-review`, `/jira`, `/token-card`, the `ecc-guide`,
`plan-canvas` and `documentation-lookup` skills, and the `docs-lookup` agent (needs a Context7 MCP server). Re-add from upstream
only together with the scripts they call. Rule: after any upstream sync, run the reference check in `.claude/harness/README.md`.
