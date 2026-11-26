# Issue tracker: GitHub

Issues and specs for this repository live as GitHub issues in `{{repo}}`. Use the `gh` CLI; in cloud sessions where `gh` cannot reach GitHub, use the GitHub MCP tools (`issue_write`, `issue_read`, `sub_issue_write`, `list_issues`) for the same operations.

**Task list:** `node .claude/harness/bin/tasks-sync.js pull --spec <n>` writes `TASKS.md` from the spec issue's sub-issues (add `--from-json <file>` with the sub-issues saved by the MCP tools where `gh` is unavailable). Name a branch for ticket `#N` with a path segment `issue-<N>` or `issue-<N>-<slug>`.

**Labels** (created by `setup-repo.js`; see `.claude/rules/ecc-common/working.md`): `afk` / `hitl` on tickets, `needs-triage`, `needs-info`, `wontfix` for triage (`triage-labels.md`), `needs-fable` for owner approval of a fable run, and the owner gates `spec-approved` and `accepted` on spec issues. Only the owner applies a gate label.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`; a ticket is a sub-issue of its spec issue (`gh issue create --parent <spec>`).
- **Read an issue**: `gh issue view <number> --json number,title,body,labels,comments`.
- **Blocking**: GitHub's native issue dependencies (`gh issue edit <child> --add-blocked-by <blocker>`); where unavailable, a `Blocked by: #<n>` line at the top of the child body.
- **Comment**: `gh issue comment <number> --body "..."`.
- **Close**: comment with the explanation, then `gh issue close <number>`.

File issues only into `{{repo}}`.
