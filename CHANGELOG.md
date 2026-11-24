# Changelog

## Unreleased

### Added

- **Generated task list from GitHub issues** (#20, spec #19, ADR-0001): `tasks-sync.js pull --spec <n> --from-json <file>` writes `TASKS.md` from a spec issue's tickets in the format `next-task.js` already reads, with derived status (closed issue or a `Closes #N` commit = done; open blocker outside the spec = blocked). `TASKS.md` is now gitignored. Tracker setup for the vendored skills in `docs/agents/`, `GLOSSARY.md`, and an `## Agent skills` section in `CLAUDE.md`. Live `gh` pull, `check`, and the runbook change follow in #21 and #22.
- **Rules and agents by task class** (owner decisions of 2026-11-22): `performance.md` routes work by task class (opus for coding and judgement, sonnet for checks and small edits, haiku for reports, fable only after owner approval on a `needs-fable` issue); new always-loaded `working.md` (English, glossary and ADRs, GitHub issues as tracker, session/PR/flag limits, spike before build, approvals and merge danger); every agent sets `model:` and `effort:`; new `spec-reviewer` agent for the spec axis beside `code-reviewer`; this repo enables `mattpocock-skills` in its own `.claude/settings.json`.
- **mattpocock-skills** (`plugins/mattpocock-skills`): a pinned, reviewed copy of Matt Pocock's engineering and productivity skills (MIT, upstream `abeeaf9`), listed as a second plugin in the marketplace. See its `VENDORED.md`.
- **packing-list** (`examples/packing-list`): a shareable trip packing checklist, built end to end by `orch-product-team` under the whole-pipeline gate. Run record in `docs/product/packing-list/`.
- **Harness:** browser journeys and an optional type check inside `verify.js` (seven checks), TypeScript support for `node:test` projects, a whole-pipeline stop gate (`pipeline.js`), an installer (`install.js`), and plugin packaging as `product-team`.

- **wiki** (`examples/wiki`, version 1.0.0): a local-first Markdown wiki. Notes are plain `<Title>.md` files in one vault folder. The browser UI provides `[[wikilinks]]`, backlinks, rename that rewrites links, Ctrl+K search, a graph view and conflict-safe saves. It runs on Node 22 with no dependencies and no build step, bound to loopback by default. See `examples/wiki/README.md` for run steps, limits and known limitations.

### Removed

- **link-shortener, packing-list and wiki** (#29, spec #27): `examples/{link-shortener,packing-list,wiki}/`, their run records in `docs/product/`, `docs/product/agent-runs.json`, `docs/product/human-corrected.json`, and the `gate-link-shortener` CI job and required check. Git history keeps them (last at `bfad3bb`). `agents-kpi.js` reads the two JSON files only when passed `--finals` or `--human-corrected`, so nothing depends on them by default.
- The ECC catalogue beyond what `orch-product-team` calls (21 agents, 48 skills, 43 commands, the `orch-*` single-feature workflows): a full product run used none of it. `hello-overkill` moved to jyeann/HW-PIRPLE-1. `examples/notes-api` and a stale `HARNESS-DIAGNOSIS.md`.
