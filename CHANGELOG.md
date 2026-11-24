# Changelog

## Unreleased

### Added

- **Generated task list from GitHub issues** (#20, spec #19, ADR-0001): `tasks-sync.js pull --spec <n> --from-json <file>` writes `TASKS.md` from a spec issue's tickets in the format `next-task.js` already reads, with derived status (closed issue or a `Closes #N` commit = done; open blocker outside the spec = blocked). `TASKS.md` is now gitignored. Tracker setup for the vendored skills in `docs/agents/`, `GLOSSARY.md`, and an `## Agent skills` section in `CLAUDE.md`. Live `gh` pull and `check` follow in #21.
- **Derived status from open PRs and ticket branches** (#22, spec #19): an open, non-draft PR that closes `#N` (whole closing line in its title or body, or `closingIssuesReferences`, given as `pullRequests` in the JSON wrapper) makes the ticket `done`; a **ticket branch** (path segment `issue-<N>` or `issue-<N>-<slug>`, local or remote-tracking) or its harness WIP checkpoint without a closing commit makes it `doing`, so `next-task.js` reports `IN_PROGRESS` after an interrupted session. A closing commit on the ticket's own branch also counts. `loop-runbook.md` now pulls, takes the first ready task on a ticket branch, commits with `Closes #N` and pulls again instead of typing status; `templates/tasks.md` says the file is generated and how status is derived.
- **Rules and agents by task class** (owner decisions of 2026-11-22): `performance.md` routes work by task class (opus for coding and judgement, sonnet for checks and small edits, haiku for reports, fable only after owner approval on a `needs-fable` issue); new always-loaded `working.md` (English, glossary and ADRs, GitHub issues as tracker, session/PR/flag limits, spike before build, approvals and merge danger); every agent sets `model:` and `effort:`; new `spec-reviewer` agent for the spec axis beside `code-reviewer`; this repo enables `mattpocock-skills` in its own `.claude/settings.json`.
- **mattpocock-skills** (`plugins/mattpocock-skills`): a pinned, reviewed copy of Matt Pocock's engineering and productivity skills (MIT, upstream `abeeaf9`), listed as a second plugin in the marketplace. See its `VENDORED.md`.
- **packing-list** (`examples/packing-list`): a shareable trip packing checklist, built end to end by `orch-product-team` under the whole-pipeline gate. Run record in `docs/product/packing-list/`.
- **Harness:** browser journeys and an optional type check inside `verify.js` (seven checks), TypeScript support for `node:test` projects, a whole-pipeline stop gate (`pipeline.js`), an installer (`install.js`), and plugin packaging as `product-team`.

- **wiki** (`examples/wiki`, version 1.0.0): a local-first Markdown wiki. Notes are plain `<Title>.md` files in one vault folder. The browser UI provides `[[wikilinks]]`, backlinks, rename that rewrites links, Ctrl+K search, a graph view and conflict-safe saves. It runs on Node 22 with no dependencies and no build step, bound to loopback by default. See `examples/wiki/README.md` for run steps, limits and known limitations.

### Changed

- **Gate setup examples are harness fixtures** (#30, spec #27): `examples/todo-api`, `examples/slug-ts` and `examples/sheet-engine` moved unchanged to `.claude/harness/fixtures/`, and the harness README links there. `install.js` does not copy `fixtures/` into other projects: they are specs and acceptance tests without `src/`, so a target's test runner would only find failing tests.

### Fixed

- **retro-board votes clicked faster than the server answers** (#28): vote requests could reach the server out of order, and an earlier answer flipped a later vote back on screen, so a quick "Remove vote" could be lost. Votes now go out one at a time and answers keep the votes still pending; `#votes-left` is `aria-busy` until they are saved. Journeys wait for that before a reload, restart or close, which removes the J5 flake.

### Removed

- **link-shortener, packing-list and wiki** (#29, spec #27): `examples/{link-shortener,packing-list,wiki}/`, their run records in `docs/product/`, `docs/product/agent-runs.json`, `docs/product/human-corrected.json`, and the `gate-link-shortener` CI job and required check. Git history keeps them (last at `bfad3bb`). `agents-kpi.js` reads the two JSON files only when passed `--finals` or `--human-corrected`, so nothing depends on them by default.
- The ECC catalogue beyond what `orch-product-team` calls (21 agents, 48 skills, 43 commands, the `orch-*` single-feature workflows): a full product run used none of it. `hello-overkill` moved to jyeann/HW-PIRPLE-1. `examples/notes-api` and a stale `HARNESS-DIAGNOSIS.md`.
