---
name: design-sessions
description: Coordinate design work that spans several sessions - one owning session per published page, one current-direction file per product that every brief links to, and handing content to the owner instead of publishing over it. Use when design work (looks, brand kits, concept art, animation) is split across sessions or agents, or before briefing another session on design.
metadata:
  origin: local
---

# design-sessions

Design work runs as its own kind of run, not as a phase of `orch-product-team` (spec #109). The rules below come
from the Gachi Market sessions of 2026-11-25. Four sessions published over the same two pages. Briefs carried a
look the owner had already moved past. The owner said "Blender only" three times.

## One writer per page

- **Each published page has one owning session.** The first session to publish a page becomes its owner. The
  `post-publish.js` hook records it in `docs/design/<product>/pages.json` (page URL, file, owning session). Commit
  that file so sessions in other containers see it too. The owner is the session id that Claude Code gives the
  hooks (`session_id`), and the hook prints it when it records a page.
- **Other sessions do not publish to it.** The `pre-publish.js` guard blocks a publish to a page owned by another
  session, matched by URL or by file, asset uploads included. The block message names the owner. When it fires, do
  not try another route: hand your content to the owner.
- **Hand back, then the owner publishes.** Put the finished files where the brief's "Hand back" section says (a
  branch, or files in the repo) and tell the owning session with `send_message`. The owner merges the content and
  publishes. One session never removes or restores another session's preview.
- **A broken register blocks every publish.** If a `pages.json` cannot be read or is not valid (a merge
  conflict, a page with no owner), the guard cannot tell who owns what, so it blocks all Artifact publishes until
  the file is fixed. This is on purpose: unlike the other guards, it fails closed for a bad register.
- **Moving ownership** is an edit to `pages.json`. The owning session makes it, or the owner tells you to.
  Commit it before the new owner publishes.
- **Page not in the register:** the publish is allowed, and the session that publishes becomes the owner. If
  several product folders exist and the page's file lives outside `docs/design/<product>/`, the hook cannot tell
  which product the page belongs to. Then add the page to the right `pages.json` yourself.

## One current-direction file per product

- `docs/design/<product>/direction.md`, made from `.claude/harness/templates/design-direction.md`, holds the chosen
  look, the tool, the character list, the reference images, the check for each asset kind, and a dated `Changed`
  log.
- **When the owner changes direction, change this file first.** Add a line to `Changed`, commit, and only then
  brief anyone or continue.
- The file wins over anything older: a brief, a transcript, or an earlier page.

## Briefs link the direction, never restate it

- Every brief to another session or agent is made from `.claude/harness/templates/design-brief.md`. It has five
  sections: Task, Direction (the link to `direction.md`), Page and owner, Hand back, Done means. Fill every
  section.
- Do not copy the Look, Tool, Characters or Reference images into the brief. A copied direction goes stale the
  moment the owner changes it.
- Before sending, run `node .claude/harness/bin/design-check.js --brief <file>`. It fails when a section is
  empty or still a placeholder, when the brief does not link `direction.md`, when it repeats a direction heading
  or copies a line of the direction file, or when `Done means` does not ask for the check line. Run it with
  no `--brief` to check every product folder.

## Done only with a check line

In the Gachi Market sessions "done" was said three times before any check ran; the benchmark then passed 0 of 56
animations. So:

- **Every asset kind has a check.** `direction.md`'s `## Checks` section names one command per asset kind:
  `- animations: \`node tools/bench.js\` files: docs/design/<product>/animations/**`. The `files:` globs say which files
  the asset covers (default: the whole product folder). `design-check.js` fails while the section is missing or a
  line has no command in backticks.
- **Run it, then report.** `node .claude/harness/bin/design-check.js run` runs every check and writes
  `docs/design/<product>/checks.json`: command, exit code, pass count, time and one check line per asset, such as
  `animations: pass - 56/56 passed, exit 0, <time>, <command>`. It exits 1 when any check fails. A count below its
  total is a fail even when the command exits 0. Commit `checks.json` with the assets.
- **"Done" means quoting the check line.** A final message calls an asset done only by quoting its line from
  `checks.json`. An asset with no record, a failing record, or a stale record is listed as **not done**, with the
  reason. `node .claude/harness/bin/design-check.js status` prints exactly that list (`done: <line>` or
  `not done: <asset> - <why>`); paste it rather than paraphrasing.
- **A change after the check makes it stale.** The record holds a hash of every file the asset covers. Editing,
  adding or removing one, or changing the command, makes the record stale until the check runs again. The
  `stop-design.js` Stop hook holds the turn once when an asset with uncommitted changes is stale or has no record,
  and tells the session to run the check first. A stale record that arrived committed (a merge or pull) does not
  hold the turn, but `status` still lists the asset as not done.
- **A check that ran nothing is a fail.** A printed count of 0/0 records a fail.
- **Checks lines run as shell commands.** `run` executes what `direction.md` says, so treat its Checks section as
  owner-approved content: do not `run` on a branch whose `direction.md` has not been reviewed. Write each glob in
  `files:` separately (no `{a,b}` braces). The Stop hook never runs the commands.
- **Briefs ask for it.** A brief's `Done means` asks the receiving session for each asset's check line;
  `design-check.js --brief` fails a brief whose `Done means` does not mention `checks.json`.

## Helpers keep unfinished work out of git's view

In the 2026-11-25 sessions one session posted the same checkpoint message as 17 of its 48 closing messages. The
message is not from this repository: cloud sessions have a platform Stop hook, `~/.claude/stop-hook-git-check.sh`.
It blocks every stop while the checkout has any of:

- **tracked changes**, staged or not ("There are uncommitted changes in the repository...");
- **untracked files** that are not gitignored (what `git ls-files --others --exclude-standard` lists);
- **unpushed commits** on the current branch.

It cannot be changed or turned off from here, and must not be (`security.md`). So do not trigger it:

- **Helpers write unfinished work to `.harness/work/<run>/`** (or the session scratchpad), never straight into
  the tree. `.harness/` is gitignored by the installer, and the run guards keep `.harness/work/` writable while the
  rest of `.harness/` is read-only. Say in a brief's "Hand back" section where the drafts go.
- **Move it in only when it is finished**, then commit and push in one step. Commit at each finished step, so a
  stop finds little open work.
- **Do not end a turn while your helpers are still running** (`agents.md`; a Stop-hook check for it is #86).

## Not covered here

"Run without me" and "stop" (#113), and the list of owner requests at the end (#114) are separate tickets
under #109.
