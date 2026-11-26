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
- **Moving ownership** is an edit to `pages.json`. The owning session makes it, or the owner tells you to.
  Commit it before the new owner publishes.
- **Page not in the register:** the publish is allowed, and the session that publishes becomes the owner. If
  several product folders exist and the page's file lives outside `docs/design/<product>/`, the hook cannot tell
  which product the page belongs to. Then add the page to the right `pages.json` yourself.

## One current-direction file per product

- `docs/design/<product>/direction.md`, made from `.claude/harness/templates/design-direction.md`, holds the chosen
  look, the tool, the character list, the reference images, and a dated `Changed` log.
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
  empty or still a placeholder, when the brief does not link `direction.md`, or when it repeats a direction heading
  or copies a line of the direction file. Run it with no `--brief` to check every product folder.

## Not covered here

Quality checks before calling an asset done (#111), the platform's commit-loop stop message (#112), "run without
me" and "stop" (#113), and the list of owner requests at the end (#114) are separate tickets under #109.
