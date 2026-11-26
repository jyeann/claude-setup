---
name: repo-setup
description: Set up a product repository in one command - the harness, the product-team and mattpocock-skills plugins, the labels (owner gates, afk/hitl, triage, needs-fable), the repository docs (docs/agents/, GLOSSARY.md, docs/adr/) and a report on the cloud environment - and print one checklist. Use when the owner says "set up this repo", names a new repository for a product, or before a product run starts in a repository not set up yet.
metadata:
  origin: local
---

# Repository setup

One command does every step a new product repository needs before a product run, and prints one
checklist. Each row ends as `done` (this run did it), `already there`, or `needs you` with a link and
the one action for the owner. Re-running changes nothing that is already right and reports what was
missing.

## Steps

1. Use the repository the owner named; its root is the target. Never target `claude-setup` itself.
2. Run it (from a clone of `claude-setup`, the installer is `.claude/harness/bin/setup-repo.js`):
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/harness/bin/setup-repo.js" <product-repo> [--repo owner/name] [--environment <name>]
   ```
   `--repo` defaults to the target's `origin` remote. `--check` writes nothing and creates nothing.
   `--labels-json <file>` is a saved copy of the repository's labels (a JSON array of names or label
   objects), read only when `gh` cannot reach GitHub; the labels row then says so.
3. **Cloud environment.** The command never creates one (owner decision on #108). In a cloud session,
   call `get_environment`: if this session already runs in an environment made for the product, pass
   its name with `--environment`. Otherwise leave the row as `needs you` and give the owner its action.
4. Show the owner the checklist as printed. For each `needs you` row, give its link and action in one line.
5. Commit what it wrote in `<product-repo>` (`.claude/`, `.gitignore`, `docs/agents/`, `GLOSSARY.md`,
   `docs/adr/`) on a branch, and tell the owner to open a new session there: plugins and hooks load only
   when a session starts.

If `${CLAUDE_PLUGIN_ROOT}` is still a literal string in the command above, the command is at
`harness/bin/setup-repo.js` two folders above this skill's own folder.

## Rows

| Row | What the command does |
|---|---|
| Harness | Runs the `harness-install` installer (guards, verify gate, rules, settings). |
| Plugin product-team, plugin mattpocock-skills | Adds the `jyeann` marketplace and enables the plugin in `.claude/settings.json`. A plugin the owner switched off (`false`) stays off and is reported. |
| Labels | Lists the repository's labels through `gh` and creates the missing ones: `spec-approved`, `accepted`, `afk`, `hitl`, `needs-triage`, `needs-info`, `wontfix`, `needs-fable`. Where `gh` cannot reach GitHub, the row is `needs you` with the labels page. |
| Repository docs | Writes `docs/agents/issue-tracker.md`, `triage-labels.md`, `domain.md`, `GLOSSARY.md` and `docs/adr/README.md` from `harness/templates/repo/`, only where a file is missing. |
| Cloud environment | Reports it. With `--environment <name>`, records the name in `docs/agents/environment.md`. |

Exit 0: checklist complete. Exit 1: a row needs the owner (or is missing, with `--check`). Exit 2: refused.

A product run depends on this: `harness.js init` with `pipeline.js check` as its verify command runs the same
check first and refuses to start (exit 2, nothing written) while any row is open. Run from the product's own
installed copy (`.claude/harness/bin/setup-repo.js` in `<product-repo>`), the harness row is `already there`
and the harness is left as it is; run it from `claude-setup` to update the harness.

## Do not

- Do not apply `spec-approved` or `accepted` to any issue. The command only creates labels in the
  repository; applying a gate label is the owner's alone.
- Do not create a repository or a paid service for the owner.
- Do not run it during an unattended harness run.
