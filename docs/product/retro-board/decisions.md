# Decision log: retro-board

Format: decision | options | chosen | why | decided by. Only spend, legal or real personal data go to a human.

| # | Decision | Options | Chosen | Why | By |
|---|----------|---------|--------|-----|----|
| 1 | Which second product to build | team retro board; invoice tracker; feedback board | Team retro board | Real UI with design choices (anonymity, voting, facilitator controls); no money, logins or real personal data; the user approved "start the second product" without naming one | orchestrator |
| 2 | Build, adopt or extend | scrumlr.io, Parabol, Postfacto, Refacto, EasyRetro (adopt); build | Build | None fits Node 22 with no dependencies, one command, local files, no accounts; Postfacto archived since 2023. Teams that only want a hosted tool should use scrumlr.io | product-scoper |
| 3 | MVP scope | see brief.md (15 user-visible success criteria) | Accepted as written | Meets the idea with the smallest end-to-end journey; deferred items listed in the brief | orchestrator |
| 4 | Routes and token handling | single URL with query tokens; path routes | `/b/<p>`, `/b/<p>/f/<f>`, `/b/<p>/f/<f>/export`; wrong facilitator token falls back to the participant view, wrong participant token shows Board not found | Keeps the facilitator link separate and non-escalating; no hint that a board exists on a bad link | ux-designer |
| 5 | Live updates | polling; server-sent events; websockets | Poll every 3 s | Meets the 5 s criterion with no dependencies and the simplest failure handling | ux-designer |
| 6 | Card delete confirmation, markdown escaping, ISO date | various | Inline confirm, escape leading markdown characters, ISO date in export | Prevents accidental loss and broken markdown | ux-designer |
