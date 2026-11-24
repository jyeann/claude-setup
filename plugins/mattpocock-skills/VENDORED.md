# Vendored: Matt Pocock's skills

- **Upstream**: https://github.com/mattpocock/skills at `abeeaf9` (2026-11-19), plugin version 1.3.2. MIT licence, see `LICENSE`.
- **Why a copy, not the upstream plugin**: the upstream plugin auto-updates, so changed instructions would reach our agents without review. This copy changes only when we update it here, in a reviewed PR.
- **Reviewed 2026-11-22**: all files read for scripts, network calls and instruction injection. Only three shell files: `misc/git-guardrails-claude-code/scripts/block-dangerous-git.sh` (a PreToolUse hook that blocks risky git commands), `engineering/wizard/template.sh` and `engineering/diagnosing-bugs/scripts/hitl-loop.template.sh` (templates a human runs). The `agents/openai.yaml` files are for Codex and are ignored by Claude Code. Nothing downloads or runs code on install.

## What is included
- `skills/engineering/*` and `skills/productivity/*`: everything in the upstream plugin manifest.
- Local additions to the manifest: `in-progress/software-factory`, `misc/git-guardrails-claude-code`, `misc/setup-pre-commit`.
- Not copied: `misc/migrate-to-shoehorn`, `misc/scaffold-exercises` (Matt's course tooling), other `in-progress/*` skills (writing and personal assistant drafts).

## Local deviations from upstream
- `.claude-plugin/plugin.json`: description changed and three skills added (above). No skill text is edited.

## Name clashes
Claude Code has built-ins named `/code-review`, `/prototype` and `/research`. Call ours with the plugin namespace: `/mattpocock-skills:code-review`. Upstream will not rename them (`.out-of-scope/harness-name-collisions.md` upstream).

## How to update
1. `git clone --depth 1 https://github.com/mattpocock/skills` to a scratch folder and note the commit.
2. Diff its `skills/` against this folder; read every changed file.
3. Copy the changes, update the commit and date above, and open a PR with the diff summary.
