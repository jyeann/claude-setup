# claude-setup

My Claude Code configuration, built on **ECC (Everything Claude Code)**
v2.2.3 (upstream commit b38be6a), MIT licensed.

Included under `.claude/`:
- `agents/`: 34 specialist subagents for web apps (planner, code-reviewer, security-reviewer, ...)
- `commands/`: 46 slash commands
- `skills/`: 55 skills, trimmed for web apps (JS/TS, React/Next.js, frontend, testing, general workflow)
  plus the `orch-*` feature/bugfix/refactor workflows. Re-add any others from upstream `skills/`.
- `rules/ecc-common/`: the four always-loaded rules (coding style, git, testing, security). Everything else moved to the
  on-demand `skills/engineering-reference` to keep the base context small.

Not included: ECC hooks (they run Node scripts on every tool call).

## Workflow additions (local, not from ECC)
- `skills/grill-me`: interview-until-aligned step before planning (`orch-pipeline` phase 1.5, standard and large tasks).
- `skills/plan-to-tasks` + `harness/templates/tasks.md`: backlog of vertical slices with `blocked-by` and `AFK`/`HITL`.
  `node .claude/harness/bin/next-task.js TASKS.md` picks the next ready AFK task; the loop runbook uses it.
- Status line (`harness/bin/statusline.js`): exact context token count, warns past ~100K ("dumb zone").
- Pruned: non-web language agents/commands, and commands that need ECC scripts this repo does not ship
  (`continuous-learning-v2`, instincts, sessions). Restore any of them from upstream if needed.

## Use it in another project
Copy the `.claude/` folder into that repo, or open a Claude Code session on this repo.

## Update from upstream
```bash
git clone --depth 1 https://github.com/affaan-m/everything-claude-code /tmp/ecc
# Do NOT use --delete: it would restore everything pruned above and drop the local skills.
rsync -a /tmp/ecc/{agents,commands,skills} .claude/   # then re-run the prune, or copy only what you want
# rules/common/ is deliberately not synced; see skills/engineering-reference
```

## Pruned for being unrunnable here
Commands, skills and agents that need upstream ECC scripts, MCP servers or skills this repo does not ship were removed, because
an agent that picks them fails and wastes tool calls (the `efficiency` scorer would flag it). Removed: the instinct/learning stack
(`/evolve`, `/instinct-*`, `/projects`, `/promote`, `/prune`, `/skill-health`; replaced by `/harness-improve`), `/epic-*`,
`/multi-*`, `/astra-review`, `/santa-loop`, `/plan-canvas`, `/sessions`, `/quality-gate`, `/harness-audit`, `/harness-optimizer`,
`/auto-update`, `/project-init`, `/setup-pm`, `/skill-host-compat`, `/issue-review`, `/jira`, `/token-card`, the `ecc-guide`,
`plan-canvas` and `documentation-lookup` skills, and the `docs-lookup` agent (needs a Context7 MCP server). Re-add from upstream
only together with the scripts they call. Rule: after any upstream sync, run the reference check in `.claude/harness/README.md`.
