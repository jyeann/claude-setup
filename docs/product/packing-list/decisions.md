# Decisions: packing-list

Every decision made without a human. Format: decision | options | chosen | why | decided by.

| # | Decision | Options | Chosen | Why | Decided by |
|---|----------|---------|--------|-----|------------|
| D1 | Branch for the run | reuse `claude/vigilant-cannon-ytq761` / new branch | new branch `claude/packing-list-product-run` from it | task says create own feature branch; no PR, no push to main | orchestrator |
| D2 | Harness start | before phase 1 with `pipeline.js check` / build-only | `harness.js init` with pipeline gate, `--open-gate-files --no-commit-gate --max 40 --stall 4` | skill "Starting the run" | orchestrator |
| D3 | Stack | plain JS + node:test / TypeScript | plain JavaScript, Node built-in test runner, zero runtime dependencies, like `examples/retro-board` | given in the task | orchestrator |
| D4 | Effort per phase | skill defaults / other | discover, ux, design, release, review, qa: low; tests: medium; build: medium | skill "Effort" table | orchestrator |
| D5 | Build, adopt or extend | adopt Keep/Todoist / extend / build | build | nothing fits local + zero deps + no accounts (brief.md) | product-scoper |
| D6 | Persistence, sync, access, limits | see brief.md "Decisions made without a human" | JSON file, 2 s polling, one full-edit link, name 80 / item 120 / 200 items | brief.md | product-scoper |
| D7 | UX choices (URL `/l/<id>`, no remove confirmation, insertion order, focus rules) | see ux.md "Decisions made without a human" | as listed there | ux.md | ux-designer |
| D8 | Accessibility review changes to ux.md, new checks UC14 and UC15 | accept / reject | accept | objective, Playwright-checkable, WCAG 2.2 AA | a11y-architect, accepted by orchestrator |
| D9 | How to save the read-only architect's design | retype / writer agent / script | a script copied the architect's final message byte-for-byte from its transcript into design.md and adr/ | skill: never retype or shorten it | orchestrator |
| D10 | Architecture choices | see adr/0001..0004 | single JSON file, polling, explicit set-ticked, static shells + textContent | adr/ | architect |
| D11 | Who writes tests vs who builds | same agent / different | `tdd-guide` writes spec, acceptance and holdout tests; `e2e-runner` writes journeys; `gan-generator` builds; `gan-evaluator` does QA | test author must not be the builder; QA must not be the journey author | orchestrator |
