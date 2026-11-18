# claude-setup

My Claude Code configuration, built on **ECC (Everything Claude Code)**
v2.2.3 (upstream commit b38be6a), MIT licensed.

Included under `.claude/`:
- `agents/`: 71 specialist subagents (planner, code-reviewer, security-reviewer, ...)
- `commands/`: 98 slash commands
- `skills/`: 55 skills, trimmed for web apps (JS/TS, React/Next.js, frontend, testing, general workflow)
  plus the `orch-*` feature/bugfix/refactor workflows. Re-add any others from upstream `skills/`.
- `rules/ecc-common/`: five short rules (agents, git, performance/model, security, testing), rewritten for the harness. The generic upstream ones (coding-style, patterns, hooks, development-workflow, code-review) were removed on purpose

Not included: ECC hooks. This repo ships its own `.claude/harness/` hooks instead (pre-bash and pre-write guards, a post-edit lint hook, and a Stop-time verify loop).

## Use it in another project
Copy the `.claude/` folder into that repo, or open a Claude Code session on this repo.

## Update from upstream
```bash
git clone --depth 1 https://github.com/affaan-m/everything-claude-code /tmp/ecc
rsync -a --delete /tmp/ecc/{agents,commands,skills} .claude/
# Do NOT sync rules/common/ over .claude/rules/ecc-common/: those five files are customised and the sync would restore the removed ones.
```
