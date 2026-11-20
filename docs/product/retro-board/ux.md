# UX: retro-board

Plain HTML, CSS and JS. No framework, no build step. English only. Source: `brief.md` (15 success criteria, "SC1" to "SC15").

## Conventions used below

- Ids are stable and unique per page. Repeating things use a class plus data attributes.
- Every control has an `id` or a `data-testid`. Tests should use `[data-testid="..."]`; ids are given for labels and ARIA wiring. In this spec `id` and `data-testid` are the same string unless stated.
- Routes (a contract for the developer; the brief fixes only behaviour):
  - `/` home
  - `/b/<participantToken>` participant view
  - `/b/<participantToken>/f/<facilitatorToken>` facilitator view
  - `/b/<participantToken>/f/<facilitatorToken>/export` export preview
  - anything unknown: Board not found page, HTTP 404
  - Correct participant token with a wrong or truncated facilitator token: render the participant view (no facilitator controls, no error). A wrong participant token: Board not found.
- Page `<title>`: Home `Retro board`, board `<title> - Retro board`, export `Export: <title> - Retro board`, not found `Board not found - Retro board`.
- Each page has one `<h1>`, a `<main id="main">` and a "Skip to main content" link as the first focusable element (`id="skip-link"`).

## Journeys

### J1. Start the app (SC1)
1. Person runs the one documented command. The terminal prints a local address, for example `Retro board running at http://localhost:3000`.
2. They open it. Home page shows h1 "Retro board", a one-line explainer, and the "Create a retro" form with a Title field and a "Create retro" button.
3. No sign-in, cookie banner or name prompt anywhere.

### J2. Create a retro (SC2, SC3)
1. Person types "Sprint 12" in Title and presses Enter or "Create retro".
2. Button shows "Creating..." and is disabled until the response arrives.
3. Browser goes to the facilitator view. Focus lands on the h1 (tabindex -1) so a screen reader hears "Sprint 12".
4. Page shows: title, the Share panel (participant link with Copy, then facilitator link with private warning), three empty columns each with an empty-state hint, "3 votes left", and the facilitator toolbar.
5. Empty title: inline error under the field, focus on the field, no board created, URL stays `/`.

### J3. Share the link (SC2, SC4)
1. Facilitator presses "Copy" next to the participant link. Button text becomes "Copied" for 2 seconds; a live region says "Participant link copied".
2. They send that link to the team. The facilitator link block is visually separate, red-bordered "Private" badge, and says to keep it private and bookmark it.
3. A teammate opens the participant link and sees the same board without Close, Export, Reopen, the facilitator link, or Delete on other people's cards.

### J4. Add a card (SC5, SC6)
1. Participant types in the "To improve" column's card box and presses "Add card" (or Ctrl/Cmd+Enter).
2. The card appears at the top... at the bottom of that column at once (optimistic, marked saving until confirmed). The box is cleared and focus stays in the box so they can add another. A live region says "Card added to To improve".
3. Within 5 seconds the facilitator's window shows the card with no reload.
4. Empty or whitespace-only text: message "Write something before adding the card." No card is added. Over 500 characters: message "That card is 512 characters. The limit is 500. Shorten it by 12." Focus returns to the box, text is kept.
5. `<b>hi</b>` shows literally as `<b>hi</b>`.

### J5. Vote (SC7, SC8)
1. Participant sees "3 votes left". Presses "Vote" on a card. Count goes up by 1, button becomes "Remove vote" (pressed), label says "2 votes left". Focus stays on that same button.
2. At 0 votes left the label reads "No votes left" and every un-voted card's vote button is disabled (`aria-disabled` and `disabled`), with the hint "Remove a vote to vote on another card."
3. Pressing "Remove vote" on a voted card takes the vote back; label goes up by one and buttons re-enable.
4. Reload: counts and votes left are unchanged.
5. A second browser has its own 3 votes. Both browsers' votes add into the same card count.

### J6. Delete a card (SC9)
1. Author sees "Delete" only on their own cards (same browser). Others' cards show none.
2. Press "Delete" opens an inline confirm on the card: "Delete this card?" with "Delete" and "Cancel". Confirm removes the card; focus moves to the column's card box. Live region: "Card deleted".
3. Within 5 seconds the card disappears for every viewer.
4. Facilitator sees "Delete" on every card; same confirm.

### J7. Sort (SC10)
1. Person presses the "Sort by votes" toggle in the board toolbar. It becomes pressed ("Sorted by votes"); each column reorders highest votes first, ties keep the older card first. Only that viewer's view changes.
2. Pressing again returns to the order added. Choice is kept in that browser (sessionStorage).

### J8. Live updates (SC5, SC9, SC11)
1. The page polls every 3 seconds (so changes arrive in under 5). Changes from others appear without moving focus or scroll or clearing a half-typed card.
2. When cards from others arrive, a polite live region announces "2 new cards from others" (batched per poll). When cards are removed by others: "1 card removed".
3. If polling fails see "Offline" state.

### J9. Close and reopen (SC11)
1. Facilitator presses "Close retro". A banner "This retro is closed. No more cards or votes." appears at the top. Add boxes, Add buttons and Vote buttons are removed. Counts remain. The button becomes "Reopen retro". Focus stays on that button.
2. Every other viewer sees the banner within 5 seconds and the controls disappear. Announcement: "This retro is closed."
3. "Reopen retro" removes the banner and brings controls back; others see it within 5 seconds. Announcement: "The retro is open again."
4. Delete: the facilitator can still delete on a closed board; participants cannot add, vote, or delete (their own cards too).

### J10. Export markdown (SC12)
1. Facilitator presses "Export markdown". The export preview page opens (same tab) with a read-only monospace preview, "Copy to clipboard" and "Download .md", and a "Back to board" link.
2. The preview starts with `# Sprint 12`, the date line `Date: 2026-11-18` (ISO, local server date), then `## Went well`, `## To improve`, `## Actions`. Cards in each column are listed highest-voted first with counts, for example `- Pair more (3 votes)`. Actions use `- [ ] Write the runbook (2 votes)`. Empty columns show `_No cards._`.
3. Copy: the button says "Copied" and a live region says "Markdown copied to clipboard". If clipboard access fails: "Could not copy. Select the text and copy it by hand." and the preview text is selected.
4. Download saves `sprint-12.md` with identical content.
5. Works whether or not the retro is closed.

### J11. Come back after restart (SC13)
1. Server is stopped and started again with the same command. Both links show the same title, cards, votes, closed state.
2. A browser that had the page open shows the Offline banner while the server is down and recovers on its own when it returns.

### J12. Bad link (SC14)
1. Person opens a mistyped link. Page shows h1 "Board not found", text "That link does not match any board. Check it for typos, or ask the person who shared it to send it again.", and a link "Create a new retro" to `/`.
2. Participant link with the facilitator part removed or changed: the participant view, never any facilitator control.

### J13. First use, two browsers, under 5 minutes (SC15)
Create in browser A, copy participant link, open in browser B, each adds cards (2 per column across the two browsers), both vote, A closes, A exports and downloads. Needs no docs: every step is reachable from visible labelled controls, and the empty states say what to do ("No cards yet. Add the first one.").

## Screens and states

### Home (`/`)
Regions: `header` with product name, `main#main` with h1 "Retro board", `p#home-intro`, `form#create-form`.

- Form fields: `label for="title-input"` "Title"; `input#title-input[data-testid="title-input"]` maxlength 100, `autocomplete="off"`, `aria-describedby="title-hint title-error"`; hint `#title-hint` "For example, Sprint 12."; error `#title-error[data-testid="title-error"]` (hidden when empty, `role` not needed because focus moves to the field and it is referenced by aria-describedby; also `aria-invalid="true"`); submit `button#create-submit[data-testid="create-submit"]`.
- Default: empty field, no error.
- Loading (submitting): button disabled, text "Creating...".
- Error, empty or whitespace title: "Give your retro a title, for example Sprint 12."
- Error, title over 100 chars: "Keep the title to 100 characters or fewer."
- Error, server failure or offline: `#create-error[role="alert"]` "Could not create the retro. Check that the app is still running and try again." Form content kept.
- Hostile: `<b>x</b>` as title is stored and shown literally everywhere (h1, page title, export). Text is set with `textContent`, never `innerHTML`.

### Board (participant `/b/<p>` and facilitator `/b/<p>/f/<f>`)
Same layout. Facilitator-only regions have `data-role="facilitator"` and are not in the DOM for participants (not just hidden).

Regions in DOM and tab order:
1. `a#skip-link`
2. `header#board-header` containing `h1#board-title[data-testid="board-title"]`, `span#role-badge[data-testid="role-badge"]` ("Facilitator view" or "Participant view").
3. `div#status-region[data-testid="status-region"]`: banners. Contains `#closed-banner` (when closed), `#offline-banner` (when offline), `#load-error` (when initial load fails).
4. `section#share-panel[data-testid="share-panel"]` (facilitator only, see below).
5. `div#board-toolbar`: `p#votes-left[data-testid="votes-left"]`, `button#sort-toggle[data-testid="sort-toggle"]`, facilitator extras `button#close-retro[data-testid="close-retro"]` / `button#reopen-retro[data-testid="reopen-retro"]` and `a#export-link[data-testid="export-link"]` ("Export markdown", styled as a button).
6. `div#columns[data-testid="columns"]` with three `section.column` elements: `#col-went-well`, `#col-to-improve`, `#col-actions`, each `data-column="went-well|to-improve|actions"`, `aria-labelledby` the column heading `h2#col-<key>-title`.
7. `div#live-polite[aria-live="polite"][aria-atomic="true"]` and `div#live-assertive[role="alert"]` (visually hidden), always in DOM from page load.

Column contents (each): `h2` label with count `<span data-testid="count-<key>">`, add form (hidden when closed), `ul.card-list#cards-<key>[data-testid="cards-<key>"]`, empty-state `p.empty-hint#empty-<key>[data-testid="empty-<key>"]`.

Add form: `form.add-form[data-column]`, `label for="new-<key>"` visually hidden "Add a card to Went well" (similarly To improve, Actions), `textarea#new-<key>[data-testid="new-<key>"]` rows 3, `aria-describedby="counter-<key> error-<key>"`, character counter `#counter-<key>` ("0 / 500", turns to "Over by N" and uses text plus colour past 500), error `#error-<key>[data-testid="error-<key>"]`, `button#add-<key>[data-testid="add-<key>"]` "Add card".

Card: `li.card[data-testid="card"][data-card-id][data-column][data-votes][data-own="true|false"]`. Contains `p.card-text[data-testid="card-text"]`, `span.vote-count[data-testid="vote-count"]` with visually hidden suffix " votes", `button.vote-btn[data-testid="vote-btn"][aria-pressed="true|false"]`, and optional `button.delete-btn[data-testid="delete-btn"]`; the confirm group `div.confirm[data-testid="delete-confirm"]` with `button[data-testid="delete-confirm-yes"]` "Delete" and `button[data-testid="delete-confirm-no"]` "Cancel".

States:
- Loading (first fetch): `div#loading[data-testid="loading"][role="status"]` "Loading the board..." with three skeleton columns. No empty hints during loading.
- Load failure: `#load-error` "Could not load this board. Check your connection and try again." with `button#retry-load` "Try again".
- Empty board: each column shows its hint. Went well: "Nothing here yet. What went well this sprint?" To improve: "Nothing here yet. What should we do better?" Actions: "Nothing here yet. What will we do about it?" Hint disappears when the column gets its first card.
- Adding a card: card appears immediately with class `is-saving` and "Saving..." text (visually small) until the server confirms; then it is a normal card. Add button disabled while the request is in flight.
- Add refused: see Copy. The text is kept; no card is added.
- Add failed (network): the card is removed from the list, the text restored to the box, and `#error-<key>` says "Could not save your card. Your text is still here. Try again."
- Votes: `#votes-left` is "3 votes left", "2 votes left", "1 vote left" (singular), "No votes left". It is `role="status"`-free; announcement is done via `#live-polite` to avoid double reading.
- Vote budget exhausted: un-voted cards' vote buttons `disabled`, voted cards' buttons still enabled ("Remove vote"). `#votes-hint` text "Remove a vote to vote on another card." shown next to the label.
- Closed: `#closed-banner[data-testid="closed-banner"]` "This retro is closed. No more cards or votes." for all. Add forms, Vote buttons removed (not just disabled) for all. Vote counts stay as text. `#votes-left` hidden. Participants lose Delete. Facilitator keeps Delete and sees "Reopen retro". The page has `data-state="closed"` on `body` (otherwise `data-state="open"`).
- Offline or failed update: `#offline-banner[data-testid="offline-banner"]` "You are offline or the server is not reachable. Showing the last version. Trying again..." Polling continues with a 3 s to 10 s back off. Actions that need the server (add, vote, delete, close) show their own error and do not change local state. On recovery the banner goes and the live region says "Back online. Board updated."
- Vote failed: the count reverts, and a toast `#toast[role="status"]` "Could not save your vote. Try again."
- Action conflict (card was deleted by someone else while voting): card disappears, toast "That card was removed."
- Closed while typing: add form is removed on the next poll. A typed draft is kept in a notice "The retro was closed. Your unsent card: <text>" (shown as text, not html), in `#draft-rescue[data-testid="draft-rescue"]`.
- Long or hostile content: `.card-text` uses `white-space: pre-wrap; overflow-wrap: anywhere` so a 500-character card or an unbroken 500-character string wraps and never widens the page (no horizontal scroll at 390px). Markup such as `<b>x</b>` shows literally. A 500-character card shows in full (no truncation). Title in h1 wraps the same way.
- Participant: no `#share-panel`, `#close-retro`, `#reopen-retro`, `#export-link`; Delete only where `data-own="true"`. Footer note `#participant-note` "Cards are anonymous. Your 3 votes are tied to this browser."

#### Share panel (facilitator only) `section#share-panel`
Two blocks, visibly different. Order: participant first.

- `div#participant-link-block[data-testid="participant-link-block"]` with a green "Share this" badge. Heading `h2` "Participant link". Text "Send this link to your team. Anyone with it can read the board, add cards and vote." Readonly input `input#participant-link[data-testid="participant-link"][readonly]` with label "Participant link (share this)" containing the full absolute URL. `button#copy-participant[data-testid="copy-participant"]` "Copy".
- `div#facilitator-link-block[data-testid="facilitator-link-block"]` with a red/orange "Private" badge, a heavy left border, and a lock text label (not icon only). Heading `h2` "Facilitator link". Text "Keep this private. Do not share it. Anyone with it can close the retro, delete any card and export. We cannot recover it for you, so bookmark it now." Readonly input `input#facilitator-link[data-testid="facilitator-link"][readonly]`, label "Facilitator link (keep private)". `button#copy-facilitator[data-testid="copy-facilitator"]` "Copy private link".
- Panel is expanded when the board is first created and collapsible afterwards via `button#share-toggle[aria-expanded]` "Hide links" / "Show links". The state is remembered in sessionStorage.
- The participant link input never contains the facilitator token and vice versa; the two are never in the same sentence as "share".
- Copy failure: "Could not copy. Select the link and copy it by hand." and the input text is selected.

### Export preview (`.../export`, facilitator only)
Regions: `a#back-to-board` "Back to board", h1 "Export markdown", `p#export-hint` "Preview of what will be copied or downloaded.", `div#export-actions` with `button#copy-markdown[data-testid="copy-markdown"]` "Copy to clipboard" and `a#download-markdown[data-testid="download-markdown"][download]` "Download .md", `pre#export-preview[data-testid="export-preview"][tabindex="0"]` with `aria-label="Markdown preview"`.

- Loading: `#loading` "Preparing the export...".
- Success: as in J10. Text is rendered via `textContent` in `<pre>`; markup in cards is literal. In the markdown, newlines inside a card are collapsed to spaces so each card is exactly one list line. Markdown special characters at line start in card text are escaped by the server (backslash before `#`, `-`, `*`, `>`, `[`).
- Empty board: all three sections show `_No cards._`. Copy and Download still work.
- Error: `#export-error[role="alert"]` "Could not prepare the export. Go back to the board and try again." plus the back link.
- Participant token only (no facilitator token) at `/export`: Board not found page.
- Long cards: the pre wraps (`white-space: pre-wrap`).

### Board not found (any unknown URL, HTTP 404)
`h1#nf-title[data-testid="not-found-title"]` "Board not found", `p#nf-text` copy, `a#create-new[data-testid="create-new-link"]` "Create a new retro" to `/`. No board data, no hint about whether a token partly matched.

## Copy

| Where | Text |
|---|---|
| Home h1 | Retro board |
| Home intro | Run a retro in three columns. No sign-up, no names. |
| Form heading | Create a retro |
| Title label | Title |
| Title hint | For example, Sprint 12. |
| Submit | Create retro / Creating... |
| Empty title error | Give your retro a title, for example Sprint 12. |
| Title too long | Keep the title to 100 characters or fewer. |
| Create failed | Could not create the retro. Check that the app is still running and try again. |
| Column names | Went well, To improve, Actions |
| Empty hints | Nothing here yet. What went well this sprint? / Nothing here yet. What should we do better? / Nothing here yet. What will we do about it? |
| Add label | Add a card to Went well (or To improve, Actions) |
| Add button | Add card |
| Counter | 0 / 500 ; over: Over by 12 |
| Empty card | Write something before adding the card. |
| Too long | That card is 512 characters. The limit is 500. Shorten it by 12. |
| Add failed | Could not save your card. Your text is still here. Try again. |
| Card saving | Saving... |
| Vote button | Vote (accessible name "Vote for: <first 40 chars of card>") / Remove vote ("Remove your vote from: ...") |
| Votes left | 3 votes left / 2 votes left / 1 vote left / No votes left |
| Votes hint | Remove a vote to vote on another card. |
| Vote failed | Could not save your vote. Try again. |
| Card removed by other | That card was removed. |
| Sort | Sort by votes (off) / Sorted by votes (on, `aria-pressed="true"`) |
| Delete | Delete ; confirm: Delete this card? [Delete] [Cancel] |
| Delete failed | Could not delete the card. Try again. |
| Closed banner | This retro is closed. No more cards or votes. |
| Facilitator buttons | Close retro, Reopen retro, Export markdown |
| Close failed | Could not close the retro. Try again. |
| Draft rescue | The retro was closed. Your unsent card: <text> |
| Offline banner | You are offline or the server is not reachable. Showing the last version. Trying again... |
| Back online (live) | Back online. Board updated. |
| Load error | Could not load this board. Check your connection and try again. [Try again] |
| Loading | Loading the board... |
| Participant badge / note | Participant view / Cards are anonymous. Your 3 votes are tied to this browser. |
| Facilitator badge | Facilitator view |
| Participant link block | Share this. Participant link. Send this link to your team. Anyone with it can read the board, add cards and vote. [Copy] |
| Facilitator link block | Private. Facilitator link. Keep this private. Do not share it. Anyone with it can close the retro, delete any card and export. We cannot recover it for you, so bookmark it now. [Copy private link] |
| Copy states | Copy -> Copied ; live: Participant link copied / Facilitator link copied / Markdown copied to clipboard |
| Copy failed | Could not copy. Select the text and copy it by hand. |
| Export | Export markdown ; Copy to clipboard ; Download .md ; Back to board |
| Export empty column | _No cards._ |
| Export error | Could not prepare the export. Go back to the board and try again. |
| Not found | Board not found / That link does not match any board. Check it for typos, or ask the person who shared it to send it again. / Create a new retro |
| Live: cards arrive | 1 new card from others / 2 new cards from others |
| Live: cards removed | 1 card removed / 2 cards removed |
| Live: own add | Card added to To improve |
| Live: vote | 2 votes left (and "No votes left") |
| Live: closed/open | This retro is closed. / The retro is open again. |

Export markdown shape:

```
# Sprint 12

Date: 2026-11-18

## Went well

- Fast deploys (3 votes)
- Good pairing (0 votes)

## To improve

- _No cards._

## Actions

- [ ] Write the runbook (2 votes)
```
Singular: "(1 vote)". Ties keep older card first.

## Accessibility and responsive rules

Keyboard order (board): skip link, share panel toggle, participant Copy, facilitator Copy (facilitator only), sort toggle, Close or Reopen retro, Export markdown, then columns left to right: for each column the add textarea, Add card, then each card in order (Vote, then Delete). Tab order matches visual order at both widths. No tab stops inside `pre` except `#export-preview` (tabindex 0 so it can scroll with keyboard). Enter in the home title input submits. Ctrl/Cmd+Enter in a card box adds; plain Enter makes a newline. Escape closes a delete confirm and returns focus to that card's Delete button.

Focus after each action:
- Create retro: h1 of the facilitator view. Create error: the title field.
- Add card ok: stays in the same textarea (emptied). Add refused: same textarea, error shown and linked with `aria-describedby`, `aria-invalid="true"`.
- Vote or remove vote: stays on the same button (re-rendering must preserve it, so update in place; do not rebuild the list).
- Delete: confirm opens with focus on "Cancel"; after confirmed delete, focus goes to the column's textarea (or, on a closed board for the facilitator, to the next card's Delete, else the column heading with tabindex -1). After Cancel, back to Delete.
- Close or Reopen: stays on the button, which swaps label and id; focus is re-set to the new button.
- Copy: stays on the button.
- Polling updates never move focus, and never reset a draft in a textarea.
- Export page open: focus on its h1. Back to board: normal navigation.
- Retry load: moves to h1 when loaded.

Announcements:
- `#live-polite` (aria-live polite) receives: votes left after each vote ("2 votes left"), cards arriving from others ("2 new cards from others", batched once per poll, never the card text), removals, copy results, closed or reopened, back online. Messages are written by clearing then setting the text after 50 ms so repeated identical messages are re-announced.
- `#live-assertive` (role alert) receives errors from add, vote, delete, close, create.
- Own actions are not announced as "from others".
- `#votes-left` text is visible and is not itself live, to avoid double speech.
- Own cards the person adds are not announced as arriving from others.

Labels and semantics: columns are `section` with `aria-labelledby`; card lists are `ul`; every button has a text name; icon-only buttons are not used. Vote button uses `aria-pressed`. Disabled vote buttons keep a visible reason through `#votes-hint` (referenced by `aria-describedby`). Badges "Share this" and "Private" carry words, not just colour. Banners use text and a border, not colour alone. Respect `prefers-reduced-motion` (no animation on card arrival other than a 1 second background highlight which is disabled under reduced motion).

Contrast (WCAG AA, 4.5:1 text, 3:1 UI components and focus ring) in both themes through `prefers-color-scheme`, via CSS custom properties:
- Light: background `#ffffff`, surface `#f6f7f9`, text `#1a1d21`, muted text `#4b5563`, border `#8a94a3` (3:1 on white), accent `#1d4ed8` (white text on it), private/danger `#b42318` on `#fff1f0`, share/success `#146c43` on `#eefaf3`, focus ring 3px `#1d4ed8` with 2px offset.
- Dark: background `#12151a`, surface `#1c2027`, text `#eef1f5`, muted `#a9b2bf`, border `#7b8696`, accent `#8ab4ff` (dark text `#0b1220` on it), private `#ffb4a9` on `#3a1512`, share `#8fe0b0` on `#10281b`, focus ring `#8ab4ff`.
- Disabled buttons still reach 3:1 on their label and show a strike-free muted style; the reason is in text.
- Focus ring is always visible; never `outline: none` without a replacement.

Responsive:
- 1100px wide: `#columns` is a 3-column grid with equal widths (`repeat(3, minmax(0, 1fr))`, gap 16px). Columns grow with their cards; the page scrolls vertically. Toolbar is one row. Share panel shows participant and facilitator blocks side by side.
- 390px wide: `#columns` becomes a single column stack in the order Went well, To improve, Actions, scrolling vertically as one page (no horizontal scroll, `document.documentElement.scrollWidth <= 390`). Each column has a sticky-free heading with its count. Toolbar wraps, buttons full width, tap targets at least 44 x 44 px. Share panel blocks stack, participant block first. Link inputs scroll internally and Copy buttons go on their own row. Text 16px minimum in inputs (stops iOS zoom). The home form is full width.
- Text zoom 200%: nothing is clipped, no overlapping.
- Export `pre` wraps at 390px.

## UI acceptance checks

Each check has an id (`UC1` to `UC15`) so the verify gate can require a passing browser test named after it (`examples/retro-board/journeys/`). Run against a fresh data directory. Two isolated browser contexts: A (facilitator) and B (participant). `[t=x]` means `[data-testid="x"]`. Poll waits are at most 5 seconds.

1. **UC1** (SC1) Start the app with the documented command; assert stdout contains a `http://localhost:` address. In A open it. Expect h1 "Retro board", `form#create-form` with `[t=title-input]` and `[t=create-submit]` labelled "Create retro", and no element matching input type=password or text "Sign in" / "Log in".
2. **UC2** (SC2) In A fill `[t=title-input]` with "Sprint 12", click `[t=create-submit]`. Expect URL matching `/b/<token>/f/<token>`, `[t=board-title]` "Sprint 12", `[t=role-badge]` "Facilitator view". Expect three `section.column` with h2 "Went well", "To improve", "Actions"; each `[t=empty-<key>]` visible with its hint, zero `[t=card]`. Expect `[t=participant-link]` value is an absolute URL without `/f/`, `[t=copy-participant]` "Copy", `[t=facilitator-link]` contains `/f/`, and `#facilitator-link-block` text contains "Keep this private". `#participant-link-block` text contains "Participant link" and "Send this link to your team". The tokens in the path are 22 or more URL-safe characters. After clicking `[t=copy-participant]` its text is "Copied".
3. **UC3** (SC3) In a fresh context open `/`, leave title empty (and again with only spaces), click `[t=create-submit]`. Expect `[t=title-error]` visible with "Give your retro a title, for example Sprint 12.", focus on `[t=title-input]`, URL still `/`. Then check (via the server data or by reloading) that no board was created.
4. **UC4** (SC4) In B open the value of `[t=participant-link]` read from A. Expect `[t=board-title]` "Sprint 12", `[t=role-badge]` "Participant view", three columns. Expect no `[t=close-retro]`, `[t=reopen-retro]`, `[t=export-link]`, `#share-panel`, `[t=facilitator-link]`. Add a card in B, then in A add a card; in B expect no `[t=delete-btn]` on A's card. In A (the facilitator) a Delete button is expected on B's card too, as check 9 says. (Corrected after the QA walkthrough: this line used to say A would have none.)
5. **UC5** (SC5) In B fill `[t=new-to-improve]` with "Slow builds", click `[t=add-to-improve]`. Expect immediately (within 500 ms) one `li.card` inside `[t=cards-to-improve]` with text "Slow builds", textarea empty, `[t=empty-to-improve]` gone. Without reloading A, wait up to 5 s. Expect A's `[t=cards-to-improve]` to contain "Slow builds" and `#live-polite` to read "1 new card from others". A's focus and any draft text in its textareas is unchanged.
6. **UC6** (SC6) In B: submit `[t=new-went-well]` with empty text and then with "   ". Expect `[t=error-went-well]` "Write something before adding the card.", no new card, `aria-invalid="true"`. Enter 501 characters, click Add. Expect `[t=error-went-well]` "That card is 501 characters. The limit is 500. Shorten it by 1.", no new card, text kept. Enter `<b>hi</b>`, add. Expect the card's `[t=card-text]` textContent is exactly `<b>hi</b>`, and no `b` element exists inside `.card-text`. Enter exactly 500 characters of "a" plus a 500-character unbroken string: expect added in full and `document.documentElement.scrollWidth <= window.innerWidth` at 390px viewport.
7. **UC7** (SC7) In B, with at least 2 cards: expect `[t=votes-left]` "3 votes left". Click the first card's `[t=vote-btn]`. Expect that card's `[t=vote-count]` increased by 1, button `aria-pressed="true"` with text "Remove vote", `[t=votes-left]` "2 votes left", `#live-polite` "2 votes left", focus still on that button. Vote on a second and a third card: after the third, `[t=votes-left]` "No votes left", and every un-voted card's `[t=vote-btn]` is disabled (use a 4th card to verify). Click a voted card's vote button: count drops by 1, label "1 vote left", disabled buttons re-enable. Re-vote to 0 left, reload the page: all counts, `aria-pressed` and `[t=votes-left]` are unchanged.
8. **UC8** (SC8) In A (a second browser identity) open the participant view or the facilitator view, expect "3 votes left" on a fresh context. Vote on the same card B voted on. Expect its `[t=vote-count]` equals 2 in A and, within 5 s, in B; B's own "votes left" is not affected by A's vote.
9. **UC9** (SC9) In B add a card "Mine". Expect that card has `[t=delete-btn]` and A's cards do not. In A expect `[t=delete-btn]` on every card, including "Mine". In B click Delete on "Mine", expect `[t=delete-confirm]` "Delete this card?", click `[t=delete-confirm-yes]`; the card is gone in B at once, focus is in the column textarea, and within 5 s it is gone in A. Then in A delete a card created by B: within 5 s it is gone in B.
10. **UC10** (SC10) In B with cards having different counts in one column, click `[t=sort-toggle]`. Expect `aria-pressed="true"`, text "Sorted by votes", and in each column the `data-votes` values on `[t=card]` in DOM order are non-increasing. A's order is unchanged. Click again: original order returns.
11. **UC11** (SC11) In A click `[t=close-retro]`. Expect `[t=closed-banner]` "This retro is closed. No more cards or votes." and no `[t=add-went-well]`, `[t=vote-btn]` in A; the button is now `[t=reopen-retro]`. In B within 5 s expect the same banner, no add forms, no vote buttons, `#live-polite` "This retro is closed.", `body[data-state="closed"]`. Click `[t=reopen-retro]` in A: banner gone, add and vote controls back in A, and in B within 5 s.
12. **UC12** (SC12) In A (with a card voted 2 times in To improve, one in Actions, and one in Went well) click `[t=export-link]`. Expect URL ending `/export`, `[t=export-preview]` text starting `# Sprint 12`, containing a `Date: YYYY-MM-DD` line, headings `## Went well`, `## To improve`, `## Actions` in that order, cards ordered by votes descending with `(N votes)`, and every Actions line starting `- [ ] `. Grant clipboard permission, click `[t=copy-markdown]`: expect text "Copied", `#live-polite` "Markdown copied to clipboard", and the clipboard equals the preview text. Click `[t=download-markdown]`: a download named `sprint-12.md` whose content equals the preview text. A card with `<b>hi</b>` appears literally in both preview and file. Open the export URL without the `/f/` part: expect Board not found.
13. **UC13** (SC13) Record all card texts, counts, votes left in B, and closed state (close the retro first). Stop the server process, check that A and B show `[t=offline-banner]` within 10 s, start it again with the same command and same data directory. Reload A and B: same title, cards, counts, B's "votes left", and `[t=closed-banner]`. Without reload, the offline banner clears on its own and `#live-polite` reads "Back online. Board updated."
14. **UC14** (SC14) Open `/b/not-a-real-token`, and also a participant link with one character changed. Expect h1 `[t=not-found-title]` "Board not found", `[t=create-new-link]` "Create a new retro"; clicking it goes to `/` with the create form. Open the participant link plus `/f/` and a wrong token, and the participant link with `/f/<token>` removed: expect the participant view with no `[t=close-retro]`, `[t=export-link]`, `#share-panel` and no delete buttons on others' cards. Both with and without the right facilitator token, expect an unknown path returns status 404 and the participant view returns 200.
15. **UC15** (SC15) With a fresh data directory, start a stopwatch. In A create "Sprint 12" (copy the participant link from `[t=participant-link]`), in B open it. Using only visible controls: A and B each add cards so each column has 2 cards (6 total); both vote on 3 cards; A clicks `[t=close-retro]`, then `[t=export-link]`, then `[t=download-markdown]`. Expect the downloaded file has `# Sprint 12`, 6 card lines, and the closed banner showed on both. Total elapsed under 5 minutes; no step needs a URL typed by hand beyond the participant link, and no console errors. Repeat the layout checks: at 1100px wide `#columns` shows three side-by-side columns (distinct `getBoundingClientRect().left` values, same top); at 390px wide they stack (same left, increasing top), the page has no horizontal scroll, and Add, Vote, Close and Copy buttons are at least 44px tall.
