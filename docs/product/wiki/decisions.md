# Decision log: wiki

Format: decision | options | chosen | why | decided by. Only spend, legal or real personal data go to a human.

| # | Decision | Options | Chosen | Why | By |
|---|----------|---------|--------|-----|----|
| 1 | Which app to reimagine and how far | habit tracker; reimagine an existing example; markdown wiki / second brain; phases 1-4 only vs all 9 | Markdown wiki / second brain, all 9 phases with the full gate | Human answer to the single up-front question (the one allowed prompt) | human |
| 2 | House stack | any; Node 22, zero deps, node:test, vanilla JS UI, plain .md vault | Node 22, zero deps, node:test, vanilla JS UI, plain .md files | Matches the existing examples so the same verify gate and holdout/mutation checks apply; user owns the data | orchestrator |
| 3 | Build, adopt or extend | Obsidian, Logseq, TiddlyWiki, Dendron, Notion; build | Build | None runs as one dependency-free Node app over plain files; brief points Obsidian users elsewhere. Comparison is from model knowledge, URLs unverified | product-scoper |
| 4 | MVP scope | see brief.md (10 success criteria SC1-SC10) | Accepted as written | Smallest end-to-end product that still has links, backlinks, rename, search, graph | orchestrator |
