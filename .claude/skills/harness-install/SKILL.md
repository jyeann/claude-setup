---
name: harness-install
description: Install the verify-gated build harness (guard hooks, deny rules, sandbox settings, status line and the five always-loaded rules) into the current project's .claude/ folder. Use when this setup was installed as a plugin and the user asks to add the harness or guardrails to a project, or when a command needs `.claude/harness/` and it is missing.
metadata:
  origin: local
---

# Harness install

The plugin gives a project the agents, commands and skills. It cannot give it the harness, because a
plugin cannot ship permission rules, sandbox settings, a status line or always-loaded rules, and the
guards expect to live at `.claude/harness/` inside the project. This skill copies them in.

## Steps

1. Confirm the project root with the user if it is not the current directory.
2. Show what would change, and let the user read it:
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/harness/bin/install.js" --dry-run
   ```
3. On approval, run it without `--dry-run`. Pass a path as the first argument to target another directory.
4. Tell the user to restart Claude Code in that project, review `git diff`, and commit.

If `${CLAUDE_PLUGIN_ROOT}` is still a literal string in the command above, the installer is at
`harness/bin/install.js` two folders above this skill's own folder.

## What it does

- Writes `.claude/harness/` (overwrites, so re-running updates it), without the harness's own `test/` and `fixtures/`.
- Copies `.claude/rules/` and `.claude/plans/`, keeping any file that already exists (`--force` overwrites).
- Merges into `.claude/settings.json`: adds missing allow and deny rules and hook groups; sets `sandbox`
  and `statusLine` only when absent. It never removes or replaces an existing setting.
- Adds `.harness/` to `.gitignore`.

It refuses, writing nothing, when `settings.json` is not valid JSON, when a harness run is recorded in
`.harness/state.json`, or when the target already is this repository.

## Do not

- Do not run it during an unattended harness run.
- Do not hand-edit the merged hooks to point at the plugin folder: the guards protect the project copy.
