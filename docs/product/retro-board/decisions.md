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
| 7 | Markdown export and inline `<` | escape all HTML; leave inline `<` as typed | Leave as typed, escape only leading markdown characters | UI check 12 requires `<b>hi</b>` to appear as typed; risk documented in design.md section 6, security review in phase 6 must confirm | architect |
| 8 | Data location, command, startup line | DATA_FILE; DATA_DIR with one file per board | DATA_DIR, `npm start`, startup line `Retro board running at http://localhost:<port>` | ux check 13 says "same data directory"; bounded write cost and corruption isolation | architect |
| 9 | Limits not in the brief | none; caps | 500 voters per board, MAX_BOARDS=1000, 200 cards per board | Guards the "unbounded growth" risk in the brief | architect |
| 10 | ADRs | separate adr/ files; section 9 of design.md | design.md section 9 holds the 10 ADR-worthy decisions | One place to read; no extra files to drift | orchestrator |
