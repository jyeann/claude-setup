# Brief: retro-board

## Problem and user

A team retro board where a facilitator runs a retrospective in three fixed columns (Went well, To improve, Actions). Teammates add cards and vote, and the facilitator exports the result as markdown.

- **Facilitator** (scrum master, team lead or whoever's turn it is): wants a board running in under a minute, with no sign-ups for anyone, and a clean record of the actions to paste into the team wiki or tracker afterwards.
- **Team member**: wants to open a link, write honest cards without giving a name, spend a few votes on what matters, and see the agreed actions.

Constraints: a single small web app, Node 22 with no runtime dependencies, file persistence, started locally with one command, no accounts, boards reached by an unguessable link, and no real personal data.

Repository check: nothing in `testbench/README.md` (todo-api, notes-api, sheet-engine, link-shortener) or `docs/` does this. `docs/testbench/retro-board/decisions.md` only records the choice of this product. The link-shortener retro records the last product's lesson, which was that the spec described stored data and never what a person sees. The criteria below are written to avoid that.

## Existing products (with sources)

| Product | Does well | Gets wrong (for this job and these constraints) | Source |
|---|---|---|---|
| scrumlr.io (MIT, inovex) | No registration. Moderator controls. Exports to Markdown, PDF, CSV and JSON. Free hosted instance. | Self-hosting needs a Go backend, a React app and Docker/Kubernetes deployment, so it is heavy for a one-command local run. | https://github.com/inovex/scrumlr.io , https://www.scrumlr.io |
| Parabol (AGPL-3.0) | Guided flow (reflect, group, vote, discuss). Anonymous reflections and anonymous voting with a set number of votes per person. | Needs accounts and teams. The free tier is limited. Self-hosting has used PostgreSQL, Redis and RethinkDB through Docker Compose. The flow is long for a 30-minute retro. | https://parabol.co/agile/retrospectives , https://github.com/ParabolInc/parabol/blob/fe128f017f01148ebd132fd532a771c6ab80ef16/docker/README.md |
| Postfacto (Pivotal, AGPL-3.0) | Simple items, voting and action items. Live updates. Boards can be password-protected or opened by link. | Archived and read-only since March 2023. Needs Rails, React and a cloud platform (Kubernetes, Cloud Foundry or Heroku). | https://github.com/vmware-archive/postfacto , https://www.stride.build/blog/postfacto-sunsets-remoteretro-rises |
| Refacto (GPL-3.0, Postfacto rewrite) | Runs on Node 22 with `npm start`. Maintained. Has a public instance. | Uses npm dependencies and Google auth in production. A database is needed for real deployment. | https://github.com/davidje13/Refacto |
| EasyRetro (commercial) | Fast board setup. Many templates. Paid plans export to PDF, CSV, Excel and Jira. | Export appears to be paid. The free plan allows only 1 to 3 public boards a month (sources disagree). It is hosted only. | https://retrospectivetools.pages.dev/tool/easyretro , https://freetier.co/directory/products/easyretro (easyretro.io itself was not reachable from this session) |

## Decision (build/adopt/extend and why)

**Build.** None of these tools meets the hard constraints: Node 22 with no runtime dependencies, one command, local files and no accounts. Each one needs a database, a container stack, an auth provider or a paid hosted plan. Extending them would mean rewriting most of their stack. A team that only wants to run a retro today and accepts a hosted service should use scrumlr.io, which is free, MIT-licensed, needs no sign-up and has markdown export.

## MVP scope (in / out / later)

**In**
- A home page with a form to create a retro by giving it a title.
- Two links per board. The participant link (random, at least 128 bits) lets people add cards and vote. The separate facilitator link (also random) adds controls.
- Three fixed columns: Went well, To improve, Actions. Anyone with the participant link can add cards to any column. Cards are anonymous, no names are asked, and the text limit is 1 to 500 characters.
- Voting: 3 votes per participant per board, at most 1 per card, and a vote can be taken back. Voting covers cards in all three columns. Each participant is identified by a random id stored in their browser.
- Card authors can delete their own cards from the same browser. The facilitator can delete any card.
- Other people's changes appear within 5 seconds without a reload.
- Anyone can sort their own view by votes.
- The facilitator can close the retro (no more cards or votes) and reopen it.
- The facilitator can export markdown: preview, copy to clipboard and download as a `.md` file.
- Boards survive a server restart. A friendly "board not found" page handles bad links.

**Out**: accounts or logins, card grouping or merging, timers, icebreakers, custom columns or templates, comments, reactions, PDF/CSV/Jira export, integrations, a board list or history page, translations, and public internet hosting.

**Later**: hiding cards until the facilitator reveals them (to avoid anchoring), editing cards, an owner and due date on each action, carrying open actions into the next retro, custom columns, board deletion and expiry, and a setting to adjust vote count.

## Success criteria (testable, user-visible)

1. One documented command starts the app and prints a local address. Opening it shows a "Create a retro" form with a title field. There is no sign-in anywhere.
2. Submitting the title "Sprint 12" opens the facilitator view. It shows the title, three empty columns labelled Went well, To improve and Actions, each with an empty-state hint, and the full participant link with a Copy button. It also shows the facilitator link with a note to keep it private.
3. Submitting an empty title shows an inline error and no board is created.
4. Opening the participant link in a second browser shows the same board without Close, Export, or delete buttons on other people's cards.
5. A participant who types a card in To improve and presses Add sees it in that column at once. The facilitator's window shows it within 5 seconds without reloading.
6. A card that is empty or only whitespace, or longer than 500 characters, is refused with a visible message. A card containing `<b>hi</b>` shows that text literally and is not rendered as bold.
7. A participant sees "3 votes left". Voting on a card raises its count by 1 and changes the label to "2 votes left". At 0, vote buttons are disabled and the label says "No votes left". Clicking a voted card again removes the vote. After a reload, the counts and the votes left are unchanged.
8. A second browser has its own 3 votes, and its votes add to the same card counts.
9. An author sees Delete on their own card only, and deleting it removes it from every viewer within 5 seconds. The facilitator sees Delete on every card.
10. Choosing "Sort by votes" reorders each column from highest to lowest votes for that viewer.
11. When the facilitator presses "Close retro", every viewer sees a "This retro is closed" banner within 5 seconds, and the add and vote controls disappear. "Reopen" brings them back.
12. When the facilitator presses "Export markdown", a preview appears with a `# Sprint 12` heading, the date, and one section per column. Cards are listed highest-voted first with their vote counts, and Actions appear as `- [ ]` checklist items. Copy puts the text on the clipboard, and Download saves a `.md` file with the same content.
13. After the server stops and the same command starts it again, both links show the same cards, votes and closed state.
14. A mistyped board link shows a "Board not found" page with a link to create a new retro. Removing or changing the facilitator part of a link never shows facilitator controls.
15. First-use journey: from a fresh start with no data, one person in two browsers can create a retro, add 2 cards per column, vote, close the retro and download the markdown in under 5 minutes without reading any docs.

## Risks

- **Leaked link.** Anyone holding the participant link can read and add cards. The links are unguessable, and the facilitator link is separate. The share UI warns about this.
- **A lost facilitator link** cannot be recovered because there are no accounts. The facilitator view tells them to bookmark it.
- **Vote integrity** depends on browser-held ids, so a private window gets 3 more votes. This is acceptable for a trusted team and is stated, not engineered around.
- **Injected markup** in card text. Criterion 6 covers it, and the security reviewer should check rendering and the export.
- **A corrupted data file** after a crash mid-write, or unbounded growth. Writes must be atomic, and each board is capped at 200 cards.
- **Scope creep** toward Parabol-style phases. The deferred list holds the line.

## Open questions with defaults

1. Should names appear on cards? **No.** Cards are anonymous and no personal data is collected.
2. How many votes, and can someone stack them on one card? **3 per board, at most 1 per card.**
3. Who can add to Actions? **Anyone.** The facilitator curates by deleting cards.
4. Should cards be hidden until revealed? **Not in the MVP.** All cards are visible at once (deferred).
5. What about card edits? **Delete and re-add for now.** Editing is deferred.
6. How long are boards kept? **Until the data file is removed.** There is no expiry in the MVP.
7. Who can reach the app? **Only this machine by default.** A documented startup setting lets teammates on the same network reach it. Language is English only.
8. Can export happen before the retro is closed? **Yes,** at any time, by the facilitator only.
9. **Needs a human:** hosting the app on the public internet or a shared company server. That raises a security review and data-handling decisions, and it is out of scope here. Nothing else needs a human: there is no spend, no legal question and no real personal data.
