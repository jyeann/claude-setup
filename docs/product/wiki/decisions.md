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
| 8 | Product location | repo root; examples/wiki | `examples/wiki/` | Same layout and gate as retro-board | architect |
| 9 | Revision and conflicts | mtime; hash; counter | SHA-256 content hash, `If-Match` required on PUT (428), 412 on stale | Catches external edits; standard HTTP | architect |
| 10 | Index freshness | fs.watch; timer; stat scan per request | On-demand stat scan | Correct by construction; watcher is Later | architect |
| 11 | Renderer safety | escape then HTML string; DOM nodes | DOM nodes with allow-lists, strict CSP, no `innerHTML` anywhere (unit test enforces) | No HTML-string attack surface | architect |
| 12 | Title charset stricter than brief | brief rules only; portable subset | Portable subset (design.md section 2); ux.md addendum adds copy | Vault must survive Windows/macOS and avoid link syntax chars | architect, orchestrator |
| 13 | Network exposure | any HOST; loopback only | Refuse non-loopback HOST; Host/Origin/Sec-Fetch-Site checks | No auth, so exposure is a human decision (not made here) | architect |
| 14 | ADRs | adr/ files; design.md section 9 | design.md section 9 (13 ADRs) | One place to read, as in retro-board | orchestrator |
| 15 | `.wiki.lock` inside the vault vs ux.md "empty vault / exact listing" | keep lock in vault, tests ignore dot entries; move lock outside | Keep in vault; tests filter dot entries | A lock outside the vault is not found when the vault is moved; dotfiles are never notes | planner, orchestrator |
| 16 | Plan | see TASKS.md | 12 build slices in builder groups S (src and shared modules, green over HTTP) then P (UI) | Same split as retro-board decisions 12-13 | planner |
| 17 | Who writes acceptance tests and holdout | builder; test-owner agent | Separate test-owner agent, before the build; holdout kept apart in `examples/wiki/holdout` and hidden during the run | Builder must not grade its own work | orchestrator |
| 18 | Server-side perf budgets (search 300 ms at 5,000 notes, graph 1 s at 1,000) | none; add | Added to acceptance | Gives SC8/SC9 an objective check before the browser walkthrough | planner |
| 19 | Spec rulings after test-owner questions (null content, BOM, both-match search, over 8 MiB titles) | leave open; rule | Ruled in spec.md items 21-23 | Tests must not depend on builder guesses | orchestrator |
| 20 | Skips count as failures in verify (`::1` test, case-insensitive FS) | remove tests; accept | Accept: environmental, rare | Keeps the coverage of the loopback and duplicate-key rules | test-owner, orchestrator |
| 21 | Gate red in this sandbox only because of the `HOST ::1` acceptance test skipping (kernel has no IPv6; skip counts as failure) | edit the protected test; turn the harness off; carry on and prove the gate in a scratch copy | Carry on. Scratch copy without that one test passes all 5 steps (tests, 97.5% coverage, quality, holdout 16/16, mutation 6/8). Fix needs a human: make the test assert something when IPv6 is missing, or run on a host with `::1` | orchestrator |
| 22 | UI deviations from ux.md reported by builder P | accept; send back | Accept for now, route to QA: check 11 (`/n/%2e%2e` normalised by browser to `/`), check 26 (42 px vs 40 px top gap), check 16 (title-only match has no mark), check 14 (Copied appears twice), axe not run | orchestrator |
