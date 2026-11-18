# Decision log: wiki

Format: decision | options | chosen | why | decided by. Only spend, legal or real personal data go to a human.

| # | Decision | Options | Chosen | Why | By |
|---|----------|---------|--------|-----|----|
| 1 | Which app to reimagine and how far | habit tracker; reimagine an existing example; markdown wiki / second brain; phases 1-4 only vs all 9 | Markdown wiki / second brain, all 9 phases with the full gate | Human answer to the single up-front question (the one allowed prompt) | human |
| 2 | House stack | any; Node 22, zero deps, node:test, vanilla JS UI, plain .md vault | Node 22, zero deps, node:test, vanilla JS UI, plain .md files | Matches the existing examples so the same verify gate and holdout/mutation checks apply; user owns the data | orchestrator |
| 3 | Build, adopt or extend | Obsidian, Logseq, TiddlyWiki, Dendron, Notion; build | Build | None runs as one dependency-free Node app over plain files; brief points Obsidian users elsewhere. Comparison is from model knowledge, URLs unverified | product-scoper |
| 4 | MVP scope | see brief.md (10 success criteria SC1-SC10) | Accepted as written | Smallest end-to-end product that still has links, backlinks, rename, search, graph | orchestrator |
| 5 | Search shortcut (a11y finding SC 2.1.4, medium) | keep `/`; setting; modifier key | Ctrl+K / Cmd+K, `/` removed | Modifier shortcut needs no setting and is the common convention; ux.md and check 17 updated | orchestrator |
| 6 | Graph accessibility | role=img svg; role=group plus text list | role=group plus visible `graph-list` text alternative | role=img hides node links from screen readers | a11y-architect |
| 7 | Routes, env, startup line | unspecified in brief | `/n/<title>`, `/graph?note=`, `PORT` default 3000, `VAULT_DIR`, startup line `Wiki running at http://localhost:<port>`, SPA fallback for non-/api paths | Needed by tests and builder; ux-designer assumptions accepted | ux-designer, orchestrator |
