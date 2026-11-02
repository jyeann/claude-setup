# claude-setup

My Claude Code configuration, built on **ECC (Everything Claude Code)**
v2.2.3 (upstream commit b38be6a), MIT licensed.

Included under `.claude/`:
- `agents/`: 71 specialist subagents (planner, code-reviewer, security-reviewer, ...)
- `commands/`: 98 slash commands
- `skills/`: 314 skills
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
