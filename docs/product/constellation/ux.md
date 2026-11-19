# UX: constellation

Vanilla JS, plain HTML and CSS in `public/`, Canvas 2D for the sky, no framework, no build step. The server renders nothing: it serves static files and a JSON API under `/api`. Look and feel (tokens, motion numbers, budgets) are in `design-direction.md`; this file is behaviour, copy, the test contract and the acceptance checks. English only. Source: `brief.md` (SC1 to SC12). Wiki behaviour that is copied unchanged (title rules, conflict, rename rewrite, delete, unsaved guard, preview subset, search rules, error copy) is cited from `docs/product/wiki/ux.md`; only differences are restated.

## Conventions and data-testid contract

- Tests use `[data-testid="..."]` only ("`[t=x]`" below). This table is the single contract. Names are stable. Repeating things carry data attributes.
- All note text (titles, bodies, snippets) is set with `textContent` or DOM nodes, never `innerHTML`. Canvas text uses `fillText`. Highlights are `<mark>` nodes.
- Every page: `<html lang="en">`, one `<h1>`, `<main id="main">`, first focusable element is the link "Skip to list".
- Server assumptions for builder and tests: `PORT` (default 3000), `VAULT_DIR` (default `./vault`), loopback only, prints `Constellation running at http://localhost:<port>`, creates the vault folder if missing, lock file `.constellation.lock`. If the vault has no `.md` files at server start, the five sample notes (below) are written with `sample: true` front-matter. A vault that already has any `.md` file is never seeded.
- Dependencies on the API (architect to confirm): `GET /api/sky` returns, for each lit note, `title, x, y, b` (brightness 0.30 to 1), `backlinks, mtime, constellation` (id or null), plus `edges` (index pairs, including edges to unlit stars), `unlit` (title, x, y, linkedFrom) and `constellations` (id, name, member count). Positions are in world units and are a pure function of the vault content. **A rename carries the old position to the new title** (SC5); otherwise the title hash would move the star.
- Server fallback: any non-`/api` GET that is not a static file returns `public/index.html`. A non-loopback `Host` or `Origin` gets status 403 with the Permission page text (Copy).

### Client routes

| Route | Screen |
|---|---|
| `/` | Sky view, no note open |
| `/n/<encodeURIComponent(title)>` | Sky view with the note panel open for that title. Unsafe or unknown titles show Note not found inside the panel area. |
| `/list` | List view, no note open |
| `/list/n/<encodeURIComponent(title)>` | List view with the note open (two panes on desktop, one on phone) |
| anything else | Note not found screen |

Page `<title>`: Sky `Constellation`; note `<Title> - Constellation` (prefix `* ` while unsaved); list `All notes - Constellation`; not found `Note not found - Constellation`.

### Canvas state contract (`[t=sky-canvas]` data attributes)

No pixel diffing is needed for any check except one sanity read (check 2). These attributes reflect real state and are not debug hooks. Flush rule: attributes are written at most every 100 ms while frames are drawing and once when the sky becomes idle; `data-animating` and `data-ready` are written immediately on change. Tests that need exact values wait for `data-animating="none"` first.

| Attribute | Value |
|---|---|
| `data-ready` | `"false"` until the first frame with loaded data is drawn, then `"true"` |
| `data-star-count` | Lit stars (notes) in the sky |
| `data-unlit-count` | Unlit stars drawn (capped at 2000) |
| `data-edge-count` | Distinct linked pairs, including pairs that end at an unlit star |
| `data-constellation-count` | Link clusters with 2 or more notes (single notes are not constellations) |
| `data-camera` | `"x,y,z"`: world x and y (2 decimals) at the canvas centre, zoom z (3 decimals). Screen position of world point (wx, wy) is `((wx-x)*z + W/2, (wy-y)*z + H/2)` with W, H from `data-viewport` |
| `data-viewport` | `"W,H"` CSS px of the canvas |
| `data-free-area` | `"x,y,w,h"` canvas px: stage minus header, banner, panel or sheet. The camera centres flights and focus here |
| `data-animating` | Space-separated tokens from `intro flight zoom inertia lit-grow lit-ring lit-lines settle fade`, or `none` |
| `data-lit-progress` | 0.00 to 1.00 growth of the most recently lit star while `lit-grow` runs, otherwise `1.00` |
| `data-static-ring` | `"true"` for 2 s after a star is created with reduced motion, else `"false"` |
| `data-motion` | `full` or `reduced` (live) |
| `data-twinkle` | `on` or `off` |
| `data-focused-star` | Title of the focused or selected star, else empty |
| `data-focused-kind` | `lit`, `unlit` or empty |
| `data-focused-x`, `data-focused-y` | Screen px relative to the canvas top-left (1 decimal) |
| `data-focused-base-radius` | `1.5 + 5.0*b` for lit stars, `4.0` for unlit (2 decimals) |
| `data-focused-brightness` | `b` (3 decimals) |
| `data-focused-rendered` | `b` including twinkle (3 decimals) |
| `data-focused-color` | Lowercase hex of the age colour (no alpha) |
| `data-focus-index` | `"k/n"`: 1-based position in the Tab ring, `"0/n"` when none |
| `data-hover-star` | Title under the pointer, else empty |
| `data-visible-star-count` | Stars inside the viewport |
| `data-label-count` | Labels drawn, equal to the number of `[t=sky-label]` |
| `data-dust-offset` | `"x,y"` screen px offset of the background dust layer |
| `data-frame-count` | Increments once per drawn frame |
| `data-frame-p95` | 95th percentile frame time in ms over the last 120 frames (1 decimal) |

`[t=sky-labels]` is an `aria-hidden` list rebuilt when the sky is idle (and at most every 250 ms while moving). Each `[t=sky-label]` has `data-title` (raw title), `data-text` (drawn text, truncated), `data-kind="star|constellation"`, `data-focused="true|false"`, and `data-x data-y data-w data-h` (canvas px, rect of the drawn label including 4 px padding).

### data-testid table

| data-testid | Element | Notes |
|---|---|---|
| `skip-to-list` | a | First focusable. "Skip to list", href `/list`. Activating it focuses `list-heading` |
| `app-header` | header | |
| `brand` | a | Wordmark "Constellation", href `/` |
| `search-input` | input type=search, `role=combobox` | Label "Search notes". `aria-expanded`, `aria-controls` (results id), `aria-activedescendant` |
| `search-clear` | button | "Clear search". Only when non-empty |
| `search-status` | div role=status | "Searching...", "3 notes match", "1 note matches". Visually hidden except "Searching..." |
| `search-results` | ul | Sky view: `role=listbox` dropdown under the input (max 8). List view: replaces `note-list` in place (all matches) |
| `search-result` | li | `data-title`, `data-active`. Sky view `role=option`. Contains the title and a snippet |
| `search-snippet` | p | Contains `mark` nodes |
| `search-empty` | p | `No notes match "<query>"` |
| `new-star-button` | button | "New star" |
| `random-star-button` | button | "Random star" |
| `view-sky` | a | "Sky", href `/` or `/n/<current>`. `aria-current="page"` in Sky view |
| `view-list` | a | "List", href `/list` or `/list/n/<current>`. `aria-current="page"` in List view |
| `status-live` | div aria-live=polite | Always in DOM, visually hidden |
| `alert-live` | div role=alert | Always in DOM, visually hidden |
| `app-error` | div role=alert | Server unreachable. Contains `app-retry`. Focus lands on its heading |
| `app-retry` | button | "Try again" |
| `forbidden-page` | main | Permission state, with a link to the working address |
| `sky-stage` | div | `data-theme="night\|daylight"`. Holds the CSS sky gradient, the canvas and the overlays |
| `sky-canvas` | canvas | `tabindex=0`, `role=application`, `aria-roledescription="sky map"`, `aria-label="Sky of 5 notes, 1 constellation"`, `aria-describedby=sky-help`. Data attributes above |
| `sky-help` | p | Visually hidden instructions (Copy) |
| `sky-summary` | p | Visible "5 notes, 1 constellation" |
| `sky-legend` | div | "Newer" bar "Older", "Bigger means more links" |
| `sky-loading` | p role=status | "Charting the sky..." |
| `sky-loading-slow` | p | Appears after 3 s |
| `sky-empty` | section | Empty sky card |
| `empty-create` | button | "Write the first star" |
| `sky-announce` | div aria-live=polite | Hidden. Receives the focused star description and "Showing X." |
| `sky-labels` | ul aria-hidden | See above |
| `sky-label` | li | See above |
| `zoom-in` | button | "Zoom in" |
| `zoom-out` | button | "Zoom out" |
| `zoom-fit` | button | "Show whole sky" |
| `star-card` | div role=group | `data-title`, `data-kind="lit\|unlit"`. Labelled by its title. Non-modal |
| `star-card-title` | p | Full title, wraps anywhere |
| `star-card-meta` | p | Age, links in, constellation |
| `star-card-action` | button | "Open note" or "Write this note" |
| `star-card-close` | button | "Close" |
| `star-tooltip` | div | Hover tooltip (title; unlit adds "Not written yet"). `pointer-events: none` |
| `sample-banner` | div | Only while unedited sample notes exist |
| `remove-samples` | button | "Remove sample notes" |
| `remove-samples-dialog` | dialog | |
| `remove-samples-confirm` | button | "Remove sample notes" |
| `remove-samples-cancel` | button | "Keep them". Initial focus |
| `note-panel` | aside | Desktop right panel or phone bottom sheet (Sky view) or right pane (List view). `data-open="true\|false"` |
| `note-view` | article | `data-title`, `data-state="clean\|dirty\|saving\|conflict\|error"` |
| `note-title` | h1 | `tabindex=-1` |
| `close-note` | button | "Close note". Returns to `/` or `/list` |
| `locate-button` | button | "Show in sky" in List view; "Centre in sky" in Sky view |
| `save-status` | span | "Saved", "Unsaved changes", "Saving...", "Not saved" |
| `save-button` | button | "Save" |
| `rename-button` | button | "Rename" |
| `delete-button` | button | "Delete" |
| `tab-write` | button role=tab | "Write" (all sizes) |
| `tab-preview` | button role=tab | "Preview" (all sizes) |
| `editor` | textarea | Label "Note text" |
| `preview` | div | Rendered Markdown (wiki subset). A leading `---` front-matter block is not shown |
| `wikilink` | a | `data-target`, `data-state="exists\|missing"` |
| `unsafe-link` | span | Disallowed scheme or invalid title, plain text |
| `backlinks` | section | Heading "Backlinks (N)" |
| `backlink-item` | li | `data-title` |
| `backlink-snippet` | p | Raw line that links, 160 chars max |
| `backlinks-empty` | p | "No notes link here yet." |
| `conflict-banner` | div role=alert | |
| `conflict-reload`, `conflict-copy` | button | "Reload note", "Copy my text" |
| `save-error` | div role=alert | Non-conflict save failure |
| `note-notice` | div role=alert | Partial: note text could not load, with a `Try again` button `note-notice-retry` |
| `new-star-dialog` | dialog | |
| `new-star-input` | input | Label "Title" |
| `new-star-error` | p | |
| `new-star-submit` | button | "Create note" |
| `new-star-cancel` | button | "Cancel" |
| `rename-dialog`, `rename-input`, `rename-error`, `rename-submit`, `rename-cancel` | | As wiki |
| `delete-dialog`, `delete-confirm`, `delete-cancel` | | As wiki. `delete-cancel` has initial focus |
| `leave-dialog`, `leave-stay`, `leave-discard` | | As wiki |
| `list-view` | section | |
| `list-heading` | h1 | "All notes", `tabindex=-1` |
| `list-sort` | select | Label "Sort by" |
| `list-loading` | p role=status | "Loading notes..." |
| `note-list` | ul | |
| `note-list-item` | li | `data-title`, `aria-current="page"` when open. Contains the link and meta |
| `note-list-empty` | p | "No notes yet." |
| `unlit-list` | section | Heading "Not written yet (N)". Absent when N is 0 |
| `unlit-item` | li | `data-title`. Contains "Linked from A, B" |
| `unlit-create` | button | "Write note", accessible name `Write note "Ideas"` |
| `constellation-list` | section | Heading "Constellations (N)". Absent when N is 0 |
| `constellation-item` | li | `data-name`. Link "Open <name>" to the brightest note, text "5 notes" |
| `not-found`, `not-found-title`, `not-found-back` | | As wiki ("Back to all notes" goes to `/list`) |

## Journeys

### J1. First 30 seconds (SC1)
1. Person runs `node src/server.js` with an empty vault. Terminal prints `Constellation running at http://localhost:3000`.
2. They open it. The sky (dark blue gradient, faint dust) is on screen immediately with "Charting the sky...". Within 2 s five warm stars light one after another around the hub, lines draw between them and the name "START HERE" fades in. The "Start here" star gets a ring and a small card (title, "Edited today, 4 links in", "Open note"). A strip under the header reads "This is a sample sky. Write over it, or remove it any time." with "Remove sample notes". Keyboard focus is still on the page start.
3. They press `New star`. A dialog asks for a Title, focus in the field. They type "My first star" and press Enter. The dialog closes, the camera flies to a new place in the sky, a core grows from nothing, one ring expands and fades, and the panel opens with the cursor in the editor. `vault/My first star.md` exists.
4. They type a sentence and press Ctrl+S. Status goes "Unsaved changes", "Saving...", "Saved".
5. They press `Remove sample notes`, read "Remove the 5 sample notes? This deletes only sample notes you have not edited. Your own notes stay.", and confirm. The five stars fade out; one warm star remains; the banner is gone; the status says "Removed 5 sample notes."

### J2. Stable sky (SC2)
1. The person reloads, or stops and restarts the server. The same stars are in the same places at the same zoom and the opening view is identical.
2. They add one unlinked note. It appears in a free spot; no existing star moves by more than 2% of the sky's width (the moved neighbours ease over 300 ms).

### J3. Links and unlit stars (SC3)
1. In a note they type `[[Ideas]]` (no such note) and save. A hollow star with a gap in its ring appears, joined to the note by a dashed line.
2. Hovering it (or focusing it with Tab, or tapping it on a phone) shows its title and "Not written yet", and a button "Write this note".
3. Clicking or pressing Enter creates "Ideas". The camera moves to it, the star fills and rings once, and the editor opens. The status says "Created Ideas".
4. Without the sky: in List view the section "Not written yet (1)" lists "Ideas, Linked from Welcome" with "Write note".

### J4. Brightness and constellations (SC4)
1. A note with 10 backlinks looks clearly larger and brighter than an orphan from the same day.
2. Two separate link clusters are two constellations, each with a small-caps name equal to its brightest member's title.
3. Warm to cool tells age: the legend says "Newer" to "Older" and "Bigger means more links".

### J5. Rename (SC5)
1. In the panel, `Rename`, enter "Project ideas". The star stays where it was, its label changes, links in other notes are rewritten (source and file). The camera does not move.
2. Renaming to an existing title (any case) keeps the dialog open with the wiki's refusal text. Nothing changes.

### J6. Hostile titles and content (SC6)
1. Titles `../escape`, `a/b`, `.hidden`, `<img src=x onerror=alert(1)>` are refused in the New star dialog with a specific inline error; no file is created.
2. A 200-character title is accepted and shown literally everywhere: truncated with "…" on the canvas, in full in the card, list (ellipsis plus `title`) and panel (wrapped).
3. A note whose title or body contains markup shows it as text. Nothing runs.

### J7. Conflict (SC7)
Exactly as wiki J7, in the note panel: banner "This note changed since you opened it...", `Reload note`, `Copy my text`; the file keeps the first saver's text.

### J8. Fly to and random (SC8)
1. Ctrl+K focuses the search box from anywhere (not inside an open dialog). Typing "writ" shows up to 8 matches in a dropdown, first one active. Enter flies the camera to that star in 1.2 s or less and opens its note (focus on the title).
2. `Random star` flies to a note not visited since the last full cycle (a shuffled bag), shows its card, and says "Showing <title>." Five presses on a vault of 5 or more notes visit 5 different notes. It does not open the editor.
3. Pressing any arrow key, scrolling, dragging or touching during a flight cancels it at once.

### J9. Performance (SC9)
At 1,000 notes the sky is interactive within 1 s and panning holds 55 fps or more. At 5,000 notes and 10,000 links it is interactive within 3 s, pans at 30 fps or more, and search answers within 500 ms. There is no spinner after first draw.

### J10. Without the sky (SC10)
1. First Tab stops on "Skip to list". Enter opens List view with focus on "All notes".
2. Everything works from there: Shift+Tab reaches `New star` and the search box; the list, unlit section, note panel (editor, Save, Rename, Delete), backlinks and constellations are all real elements.
3. A screen reader on the sky hears "Sky of N notes, M constellations" and a pointer to the list.

### J11. Reduced motion (SC11)
The sample sky appears at once. Nothing twinkles or drifts, and the sky draws no frames while idle. Fly to and Random jump. A new star appears at full brightness with a static ring that disappears after 2 s.

### J12. Phone (SC12)
At 390x844: one finger drags the sky, two fingers pinch about their midpoint, tapping a star opens its card, `Open note` raises a bottom sheet that never covers the star, and the dock holds `New star`, `Random star` and `Sky | List`. Zoom buttons are also there as a tap alternative to pinch. List and editor have no horizontal scroll.

### J13. Delete
As wiki J12 from the panel. The star fades out (300 ms, or at once when reduced). Focus goes to the sky (Sky view) or the first list item (List view).

### J14. Unsaved guard
As wiki J11. Any in-app navigation while dirty (star click, card, search result, list item, view switch, Random star that would open) shows the leave dialog first.

### J15. Edge states
Loading, empty, error, permission, partial and unsupported behave as in `design-direction.md` section 13 with the copy below.

## Screens and states

### App shell
DOM and tab order: `skip-to-list`; header (`brand`, `search-input`, `search-clear`, `random-star-button`, `new-star-button`, `view-sky`, `view-list`); `main#main` containing the view; `status-live`, `alert-live`. On phone (under 720 px) the three buttons and the view switch move to the bottom dock, but they stay before the main content in DOM order, so tab order is identical.

### Sky view
- Regions (DOM order inside main): `sky-stage` with `sky-canvas`, `star-card`/`star-tooltip`, `sky-summary`, `zoom-in`, `zoom-out`, `zoom-fit`, `sky-legend`, `sample-banner`; then `note-panel`.
- Desktop (720 px and wider): panel docked right (`--panel-w`, 461 px at 1280) when a note is open; free area excludes it. Without a note the sky is full width.
- Phone: bottom sheet of 58vh when a note is open; free area is above it.
- Loading: dust sky and `sky-loading`; the canvas has `data-ready="false"`; header already works.
- Ready: sky draws; with the sample vault the intro runs (design-direction section 12) and the hub star is selected (ring and card; DOM focus unchanged).
- Empty: `sky-empty` card. Error: `app-error`. See design-direction section 13.
- Canvas unsupported: redirect to `/list` with the notice.
- Pointer: drag pans (4 px threshold before it counts as a drag); click or tap on a star (hit radius `max(12, r+6)`, 22 on touch) selects it; mouse click on a lit star opens its note; mouse click on an unlit star creates and opens it; touch tap selects and shows the card (the card holds the action); a second tap on the same star acts as the card button. Hover (mouse only) shows `star-tooltip` after 80 ms. Wheel or pinch zooms about the pointer. Wheel events with `ctrlKey`, `deltaMode` other than 0, or an integer `|deltaY|` of 50 or more without `deltaX` zoom; smaller fractional deltas pan (trackpad two-finger scroll).
- Star card: shown for the keyboard-focused star, for a tapped star, and after Random or Fly to. Placed beside the star inside the free area, never over the star. Closes on `Escape`, `Close`, a click on empty sky, or opening the note. Lit: title, meta, `Open note`. Unlit: title, "Not written yet", "Linked from Welcome, Ideas index", `Write this note`.
- Note panel (Sky view): header with `close-note`, `locate-button` ("Centre in sky"), h1, `save-status`, `save-button`, `rename-button`, `delete-button`; banners; tabs `Write | Preview`; panel body; `backlinks`. States are exactly the wiki's note-view states (clean, dirty, saving, saved, conflict, save failed, note gone, preview rules, hostile content, backlinks, broken link), with one addition: **Partial** (note text request fails while the sky is fine): `note-notice` "Could not load "Start here". Try again." with `note-notice-retry`; editor not rendered.
- Opening a note from the sky flies the camera so the star sits in the free area centre and zoom is at least 1.0.

### List view
- `list-view`: `list-heading` "All notes"; `list-sort` (Newest first, Title A to Z, Most linked; default Newest first); `note-list`; `unlit-list`; `constellation-list`. Search input in the header filters in place: when non-empty `search-results` replaces `note-list` (all matches, with snippets; unlit and constellation sections stay).
- Each `note-list-item`: link with the title (one line, ellipsis, full title in `title`), meta "Edited 2026-11-18 14:05, 3 links in" (tabular figures). Long titles never widen the page.
- Desktop: list column 340 px left, note pane right. Phone: list or note, one at a time, with "Notes" back link at the top of the note.
- Loading `list-loading`; empty `note-list-empty` plus a `Create your first note` button (`empty-create`).
- Selecting an item opens `/list/n/<title>` and moves focus to `note-title`.

### Dialogs
New star, Rename, Delete, Leave: identical rules to the wiki (native `<dialog>` with `showModal()`, Escape closes, focus returns to the opener, inline error with `aria-invalid` and `aria-describedby`, submit disabled while working, text kept on error). New star differs only in names and copy. Remove samples: initial focus on "Keep them".

### Search
- Sky view: a combobox dropdown under the input; at most 8 options (title and a one-line snippet); first option active when results arrive; Up and Down move the active option; Enter acts on the active option (flies to the star and opens the note); Escape closes the list, a second Escape clears the text; mouse click acts the same. A line below the options is not needed; "No notes match" shows as a single non-option message.
- List view: same input, in-place filtering as the wiki (title matches first, then by last modified; snippet about 120 characters centred on the first match). Enter opens the first result.
- Debounce 120 ms; "Searching..." only after 150 ms. A hostile query such as `<b>` is literal.

### Sample banner
Shown while at least one unedited sample note exists. Hides itself when none remain. Text and button as Copy. It is a strip (role none, plain text) and never moves the focused star.

### Not found, App error, Permission
As wiki, plus the permission page: h1 "This address is not allowed", text "Constellation only answers at localhost on this computer.", a link to `http://localhost:<port>`.

## Copy

Voice: curious and a little poetic in headings and empty states; plain and exact in anything that reports a result or an error. Every error says what went wrong and how to fix it. Never cute where clarity is needed. No exclamation marks, no emoji.

| Where | Text |
|---|---|
| Product name | Constellation |
| Terminal | `Constellation running at http://localhost:<port>` |
| Skip link | Skip to list |
| Search | Label and placeholder: Search notes. Shortcut hint chip: Ctrl K (Cmd K on macOS) |
| Search clear | Clear search |
| Header and dock | New star, Random star, Sky, List |
| Sky controls | Zoom in, Zoom out, Show whole sky |
| Summary (visible) | 5 notes, 1 constellation. Singular and zero forms: 1 note, 0 constellations |
| Canvas label | Sky of 5 notes, 1 constellation. Singular: Sky of 1 note, 1 constellation |
| Sky help (hidden, `sky-help`) | Arrow keys pan. Plus and minus zoom. Zero shows the whole sky. Tab steps through stars. Enter opens the focused star. Escape closes its card. Choose Skip to list for a text version. |
| Legend | Newer, Older, Bigger means more links |
| Star description (`sky-announce`) | Lit: `Start here. Edited today. 4 links in. Constellation Start here. Press Enter to open.` Orphan: `Ideas. Edited 3 days ago. No links in. Not in a constellation. Press Enter to open.` Unlit: `Ideas. Not written yet. Linked from 1 note. Press Enter to write it.` |
| Card meta | Edited today / Edited yesterday / Edited 3 days ago / Edited 2026-08-02 (after 30 days); 4 links in / 1 link in / No links in; Constellation: Start here / Not in a constellation yet |
| Card actions | Open note, Write this note, Close |
| Tooltip (unlit) | `Ideas` then `Not written yet` |
| Fly and random (live) | `Showing Start here.` Random with no notes: `There are no stars yet. Write one first.` |
| Loading | Charting the sky... then (after 3 s) Still charting. A large vault can take a few seconds. |
| Empty sky | h2 The sky is empty / Every note you write becomes a star. / button Write the first star |
| Empty list | No notes yet. / button Create your first note |
| Server unreachable | h2 Could not reach Constellation / The server may have stopped. Check the terminal where it is running, then try again. / Try again |
| Permission | This address is not allowed / Constellation only answers at localhost on this computer. |
| Canvas unavailable | This browser cannot draw the sky, so you are seeing the list. Everything still works. |
| Sample banner | This is a sample sky. Write over it, or remove it any time. / Remove sample notes |
| Remove samples dialog | Title: Remove the 5 sample notes? / Text: This deletes only sample notes you have not edited. Your own notes stay. / Buttons: Remove sample notes, Keep them |
| Remove samples result (live) | Removed 5 sample notes. / Removed 4 sample notes. 1 you edited was kept. |
| Remove samples failure | Could not remove the sample notes. Check that the server is still running, then try again. |
| New star dialog | Title: New star / label Title / hint Its title is its file name. Up to 200 characters. / Create note, Creating..., Cancel |
| Title errors (shared text with the wiki, client and server) | Give the note a title. / Keep the title to 200 characters or fewer. It is 215 now. / A title cannot contain / or \. / A title cannot contain "..". / A title cannot start with a dot. / A title cannot end with a dot. / A title cannot contain control characters. / A title cannot contain : * ? " < > \| [ ] or #. / "CON" is a reserved name. Choose another title. / This title is too long for a file name. Shorten it. / A note called "Ideas" already exists. Choose another title. / Create failure: Could not create the note. Check that the server is still running and try again. |
| Created (live) | Created Ideas |
| Rename dialog and messages | As wiki: Rename note / New title / Links in other notes are updated for you. / Renamed to Project ideas. Updated links in 1 note. / Renamed, but 2 notes could not be updated: A, B. Fix those links by hand. / Save or discard your unsaved changes before renaming. |
| Panel | Close note, Centre in sky, Show in sky, Write, Preview, Save, Rename, Delete, Note text (label) |
| Save status | Saved, Unsaved changes, Saving..., Not saved |
| Conflict, save error, note gone, copy | As wiki (conflict banner text, Reload note, Copy my text, Copied, save error, "This note no longer exists. Copy your text before you leave.") |
| Partial | Could not load "Start here". Try again. / Try again |
| Preview | Nothing to preview yet. Link hints as wiki: (create note), Not a valid note title, Could not create "Ideas". Try again. |
| Backlinks | Backlinks (2) / No notes link here yet. / Loading backlinks... |
| Delete | Delete "Ideas"? / This permanently deletes Ideas.md from your vault. Notes that link to it will show a create link. / Delete note, Cancel / Deleted "Ideas" / Could not delete the note. Try again. |
| Leave dialog | Leave without saving? / You have unsaved changes in "Welcome". They will be lost. / Keep editing, Discard changes |
| Search | Searching... / 3 notes match / 1 note matches / No notes match "xyzzy" (query truncated to 40 characters with "...") / Search failed. Check that the server is running, then try again. |
| List | All notes / Sort by: Newest first, Title A to Z, Most linked / Edited 2026-11-18 14:05, 3 links in / Not written yet (2) / Linked from Welcome, Start here / Write note / Constellations (2) / Open Start here, 5 notes / Loading notes... |
| Not found | Note not found / There is no note at this address. It may have been renamed or deleted. / Back to all notes |

### Sample notes (written once, exact titles and links)

All five start with the front-matter block `---`, `sample: true`, `---`.
- **Start here**: "Welcome to your sky. Each note is a star, and links join stars into constellations." followed by a list linking `[[How the sky works]]`, `[[Writing a note]]`, `[[Links and unlit stars]]`, `[[Your vault]]`.
- **How the sky works**: "Newer notes are warm and bright. Older ones cool toward blue. Notes with many links are larger. Drag to pan, scroll or pinch to zoom, press 0 to see everything. Next: [[Links and unlit stars]]. Back to [[Start here]]."
- **Writing a note**: "Choose New star, give it a title, and write. Put a title in double square brackets to link to another note. Next: [[Your vault]]. Back to [[Start here]]."
- **Links and unlit stars**: "A link to a note that does not exist yet appears as a hollow star. Click it to write that note. Back to [[Start here]]."
- **Your vault**: "Every star is a plain .md file in the vault folder. Edit them anywhere. Back to [[Start here]]."

Result: 5 stars, 6 edges, 1 constellation "Start here" (4 backlinks; the others have 1, 1, 2, 2).

## Keyboard model

The sky is fully operable by keyboard. Single-key commands below are active only while the sky canvas has focus (so WCAG 2.1.4 does not apply); global shortcuts use a modifier.

| Key | Where | Effect |
|---|---|---|
| Tab (first press from outside) | Page | Focus enters `sky-canvas` as one tab stop, no star yet (`data-focus-index` 0/n) |
| Tab / Shift+Tab | Canvas focused | Next / previous star in reading order. See the ring rule below. Never a trap: past the last star Tab leaves the canvas (to `star-card-action` when the card is shown, otherwise the zoom buttons); Shift+Tab on the first star leaves backwards |
| Arrow keys | Canvas | Pan 64 CSS px (the sky moves under you; the camera moves 64/zoom world units in that direction) |
| Shift+Arrow | Canvas | Move star focus to the nearest star in that direction (within a 60 degree cone); the camera pans only if the star would leave the free area |
| + or = (and numpad +) | Canvas | Zoom in x1.25 about the free-area centre |
| - (and numpad -) | Canvas | Zoom out /1.25 |
| 0 or Home | Canvas | Show whole sky (the fit camera) |
| Enter | Canvas, star focused | Lit: fly to it (if needed) and open its note, focus on `note-title`. Unlit: create it, focus the editor |
| Space | Canvas, star focused | Read the star description again (`sky-announce`) |
| Escape | Canvas | Close the star card and clear the star focus |
| Ctrl+K / Cmd+K | Anywhere except an open dialog | Focus `search-input` |
| Ctrl+S / Cmd+S | Editor | Save |
| Escape | Search | Close results, then clear |

**Reading-order ring.** The ring is the stars inside the canvas viewport and the free area, at most 60 (the 60 brightest if more are visible). Order: bands of 48 CSS px from the top (`floor(screenY/48)`), then left to right, then by title. The ring is recomputed when the camera is idle; the focused star stays focused when the ring changes, and a pan keeps focus on the same star. Everything else (all other stars, unlit stars beyond the ring) is reachable through Ctrl+K, the list, or Shift+Arrow.

**Focus indication.** The focused star shows the accent ring (2.5 px, radius + 6) and its card; the canvas element shows a 3 px accent outline inset by 2 px. The label of the focused star is always drawn.

## Accessibility and responsive rules

Semantics
- The sky has one tab stop and a text alternative: `aria-label` "Sky of N notes, M constellations", description in `sky-help`, and the same figures as visible text in `sky-summary`. Stars are not DOM nodes (5,000 nodes would be harmful); the List view and Ctrl+K give the same set. `skip-to-list` is the first focusable.
- The List view is a complete product path (SC10 is a release blocker): create, open, edit, save, rename, delete, search, backlinks, unlit notes, constellations.
- `sky-announce` (polite) speaks the focused star description; `status-live` carries "Saved", "Created X", "Renamed...", "Deleted...", "Removed N sample notes.", "Showing X."; `alert-live` and `role=alert` carry errors. Search counts live only in `search-status`.
- Tabs (`Write | Preview`) follow the tabs pattern (Left and Right arrows, one tab stop, `aria-controls`). Search is a combobox (`aria-expanded`, `aria-activedescendant`, options `role=option`).
- Unlit stars are not colour-only: hollow ring with a gap, dashed line, card text "Not written yet", list section. The current note: ring in addition to colour, `aria-current` in the list.
- Dialogs: native `<dialog>`, `aria-labelledby`, focus trapped and restored.
- No pointer-only action: pan, zoom and select have keys and buttons (WCAG 2.5.1, 2.5.7). Pinch has `zoom-in` and `zoom-out`. Dragging stars does not exist.

Focus after actions
- Create (dialog or unlit star): editor of the new note. Open from sky, search result, list item or card: `note-title`. Rename ok: `note-title`. Delete ok: the sky canvas (Sky view) or the first list item, else `empty-create`. Close note: the canvas (Sky) or the list item (List). Dialog cancel or Escape: the opener. Dialog error: the input. Remove samples confirm: `new-star-button`. Fly to or Random: focus stays where it was (the card appears without taking focus, announced by `sky-announce`). App error: heading of `app-error`. Skip to list: `list-heading`.

Contrast and themes
- All values, ratios and the theme tokens are in `design-direction.md` sections 4 and 9. Text 4.5:1, UI parts and focus ring 3:1 in `night` and `daylight` (system preference). Focus ring: 3 px accent, 2 px offset, never `outline: none` without a replacement; canvas labels have a halo so text contrast is measured against the halo.
- `forced-colors: active`: panels use `Canvas` and `CanvasText`, borders are visible, the canvas draws with `CanvasText` for stars and labels and `Highlight` for the focus ring (read once from computed styles).

Responsive
- 1280: header 56 px, panel 461 px right, free area 819 x 744 (design-direction section 14).
- 390: header with wordmark and search; dock 56 px with `New star`, `Random star`, `Sky | List`; zoom buttons above the dock; sheet 58vh; free area is the top 298 px of the stage. Targets at least 44 px; inputs and the editor 16 px; no horizontal scroll (`scrollWidth <= 390`); dialogs full width with a 16 px margin.
- 320: same layout, wordmark 12 px, search placeholder "Search", legend one line; no horizontal scroll except inside `pre` blocks.
- 200% text zoom: header wraps; nothing clipped. The Sky view never scrolls the document.
- Reduced motion, `prefers-reduced-transparency`, `prefers-color-scheme` are read live.

## UI acceptance checks

Setup for all checks: a fresh temp vault and `PORT`; server started with `VAULT_DIR=<tmp>`; base URL `http://localhost:<port>`; Playwright Chromium at 1280 x 800, light motion (`reducedMotion: "no-preference"`), dark scheme, unless stated. `[t=x]` means `[data-testid="x"]`; `S` means `[t=sky-canvas]`. "Poll" means `expect.poll` with a 5 s timeout unless a time is given. Filesystem steps read the vault with `node:fs`. "Idle" means `S[data-animating="none"]`. "Fly to X" means Ctrl+K, type X, Enter, wait for idle. Sky positions come from `data-focused-x/y` and the camera formula, never from pixels, except check 2.

Fixtures: **U** = a vault with `Welcome.md` containing `Hello.\n\nSee [[Ideas]].\n` and nothing else. **H** = hub vault: `Hub.md`, `L01.md` to `L10.md` each containing `[[Hub]]`, `Orphan.md`, all modified today. **C2** = two clusters: `Alpha.md`, `A1.md`, `A2.md`, `A3.md` (each A links `[[Alpha]]`) and `Beta.md`, `B1.md`, `B2.md` (each B links `[[Beta]]`). **G(n, l)** = generator for n notes `N0001`... of about 2 KB with l random `[[...]]` links in total (seeded), and "quarterly" in the body of exactly three notes.

### First 30 seconds and samples (SC1)
1. Delete the vault folder and start the server. stdout matches `Constellation running at http://localhost:\d+`. Go to the base URL and record `t0`. Poll `S[data-ready="true"]` with `performance.now() - t0 <= 2000`. Expect `S[data-star-count="5"]`, `[data-constellation-count="1"]`, `[data-edge-count="6"]`, `[data-unlit-count="0"]`; `S` aria-label equals `Sky of 5 notes, 1 constellation`; `[t=sky-summary]` text `5 notes, 1 constellation`. The vault holds exactly `Start here.md`, `How the sky works.md`, `Writing a note.md`, `Links and unlit stars.md`, `Your vault.md`, each containing `sample: true`.
2. (SC1) In the same session: within 2500 ms of `t0` `S[data-focused-star="Start here"]` and idle; during the first 1000 ms at least one poll sees `data-animating` containing `intro`. `[t=star-card]` is visible with `[t=star-card-title]` "Start here" and `[t=star-card-action]` "Open note". `[t=sample-banner]` contains "This is a sample sky." and `[t=remove-samples]` is visible. `document.activeElement` is `body`. `[t=sky-stage]` computed `background-color` is not `rgb(0, 0, 0)` and `background-image` contains `radial-gradient` and `linear-gradient`. Sanity pixel read (the only one): `S.getContext("2d")` `getImageData` over the whole canvas has at least 200 pixels with alpha above 0.
3. (SC1) Click `[t=new-star-button]`: `[t=new-star-dialog]` visible, `[t=new-star-input]` focused. Fill "My first star", click `[t=new-star-submit]` and record `t1`. Sample every 40 ms for 1500 ms: `data-animating` contains `lit-ring` for a continuous span of 450 to 800 ms; the first `data-lit-progress` sample is below 0.5 and a later one is `1.00`. Expect `S[data-star-count="6"]`, `S[data-focused-star="My first star"]`, URL path `/n/My%20first%20star`, `[t=editor]` focused and empty, and `My first star.md` exists with length 0.
4. (SC1) Fill `[t=editor]` with `A thought.` and press Control+S: `[t=save-status]` "Saved" and the file equals `A thought.`. Click `[t=remove-samples]`: `[t=remove-samples-dialog]` contains "Remove the 5 sample notes?" and `[t=remove-samples-cancel]` is focused. Click `[t=remove-samples-confirm]`: `[t=status-live]` contains "Removed 5 sample notes.", `S[data-star-count="1"]`, `[t=sample-banner]` absent, none of the five sample files exist, `My first star.md` still equals `A thought.`.
5. (SC1) Fresh vault again. Open "Your vault" (Fly to), append " Edited." and save, then Remove sample notes and confirm: `[t=status-live]` contains "Removed 4 sample notes. 1 you edited was kept.", `Your vault.md` exists, `S[data-star-count="1"]`, `[t=sample-banner]` absent.
6. (SC1) Start the server on a vault that already contains `Mine.md`: no sample file is created, `[t=sample-banner]` is absent, `S[data-star-count="1"]`.

### Stable sky (SC2)
7. (SC2) Vault G(50, 80). `GET /api/sky` as A. Load the page, read `S[data-camera]` as K1, Tab into the canvas and Tab once, read `data-focused-x/y` as P1. Reload: `data-camera` equals K1 and `data-focused-x/y` are within 1 px of P1. Restart the server and `GET /api/sky`: every star's `x`, `y` deep-equals A.
8. (SC2) With A from check 7, `POST /api/notes` creating one unlinked note, then `GET /api/sky` as B. For every title in both A and B, `abs(dx)` and `abs(dy)` are at most `0.02 * (maxX - minX of A)`. In the UI with the page open at the default camera, reload and assert `data-star-count` is 51.

### Links and unlit stars (SC3)
9. (SC3) Vault U. Open `/`. `S[data-unlit-count="1"]`, `S[data-star-count="1"]`, `S[data-edge-count="1"]`. Focus the canvas and press Tab until `data-focused-star` is "Ideas" (at most 20 presses); `data-focused-kind="unlit"`; `[t=star-card]` contains "Not written yet" and `[t=star-card-action]` "Write this note". Press Escape (card gone), then move the mouse to `S` box origin plus `data-focused-x/y` read before Escape: `[t=star-tooltip]` is visible and contains "Ideas" and "Not written yet".
10. (SC3) Click at that position: URL path `/n/Ideas`, `Ideas.md` exists with length 0, `S[data-unlit-count="0"]`, `S[data-star-count="2"]`, `S[data-focused-kind="lit"]`, a poll sees `lit-ring` in `data-animating`, `[t=note-title]` "Ideas", `[t=editor]` focused, `[t=status-live]` "Created Ideas". Then edit "Welcome" to add `[[More]]`, save: `S[data-unlit-count="1"]` and `S[data-edge-count="2"]` (a line to an unlit star counts as an edge).
11. (SC3, list path) Vault U, open `/list`: `[t=unlit-list]` shows "Not written yet (1)" and `[t=unlit-item][data-title="Ideas"]` contains "Linked from Welcome". Click its `[t=unlit-create]`: URL path `/list/n/Ideas`, `[t=unlit-item]` count 0, `Ideas.md` exists.

### Brightness and constellations (SC4)
12. (SC4) Vault H. `GET /api/sky`: `b(Hub) - b(Orphan) >= 0.25` and `(1.5 + 5*b(Hub)) / (1.5 + 5*b(Orphan)) >= 1.35`; `b(Orphan)` equals 0.60 (+-0.01) and `b(Hub)` equals 0.938 (+-0.01). In the UI Fly to "Hub", read `data-focused-base-radius` and `data-focused-brightness`; Fly to "Orphan", read both; the radius ratio is at least 1.35 and brightness difference at least 0.25. Both `data-focused-color` equal `#fff0c4`.
13. (SC4) Set `Orphan.md` mtime to 200 days ago (`fs.utimes`) and reload. Fly to "Orphan": `data-focused-brightness` equals 0.300 (+-0.005), `data-focused-base-radius` 3.00 (+-0.05), `data-focused-color` within 1 per channel of `#bdd3ff`.
14. (SC4) Vault C2. `S[data-constellation-count="2"]`. Press `[t=zoom-fit]` (idle). `[t=sky-label][data-kind="constellation"]` count is 2 and their `data-title` values are exactly `Alpha` and `Beta`. Compute the stated order from the API (most backlinks wins: Alpha 3, Beta 2).

### Rename (SC5)
15. (SC5) Vault U, create "Ideas" via its unlit star (as check 10), `GET /api/sky` for the position of "Ideas" as (x0, y0). Click `[t=rename-button]`, fill "Project ideas", click `[t=rename-submit]`. Expect `[t=status-live]` "Renamed to Project ideas. Updated links in 1 note.", `S[data-focused-star="Project ideas"]`, `S[data-camera]` unchanged from before the dialog, `GET /api/sky` has no "Ideas" and "Project ideas" at exactly (x0, y0), `Ideas.md` absent, `Project ideas.md` present, `Welcome.md` and the editor of "Welcome" contain `[[Project ideas]]` and no `[[Ideas`. Press `[t=zoom-in]` until zoom is at least 1.4: `[t=sky-label][data-title="Project ideas"]` exists.
16. (SC5) Create "Other". Rename it to "project IDEAS": `[t=rename-dialog]` stays open, `[t=rename-error]` is `A note called "Project ideas" already exists. Choose another title.`, `[t=rename-input]` focused; cancel. `S[data-star-count]` unchanged, the directory listing is unchanged, `[t=note-title]` still "Other".

### Hostile titles and content (SC6)
17. (SC6) Open `[t=new-star-dialog]`. For each value, press Enter, then expect the dialog still open, `[t=new-star-input]` focused with `aria-invalid="true"`, `S[data-star-count]` unchanged and no new file in the vault or its parent: `../escape` and `a/b` and `a\b` show "A title cannot contain / or \."; `.hidden` shows "A title cannot start with a dot."; `<img src=x onerror=alert(1)>` shows `A title cannot contain : * ? " < > | [ ] or #.`; empty and spaces show "Give the note a title."; 201 times "x" shows "Keep the title to 200 characters or fewer. It is 201 now.".
18. (SC6) Register handlers for `dialog`, `request` and the page's `securitypolicyviolation` event. In the vault place `img src=x onerror=alert(1).md` with the body `<script>alert(1)</script>` and `<img src=x onerror=alert(1)>` and `[link](javascript:alert(1))`. Load `/`. Fly to the title: `[t=star-card-title]` text equals the exact title; mouse-hover the star: `[t=star-tooltip]` text contains the exact title; `[t=sky-label][data-title]` (if present) has the raw title. Open the note: `[t=preview]` text contains `<script>alert(1)</script>` and `<img src=x onerror=alert(1)>`; `[t=preview] script`, `[t=preview] img` counts are 0; `[t=unsafe-link]` text "link" and no `a[href^="javascript"]`. Open `/list`: the item text equals the title. No recorded dialog, no request ending `/x`, no `securitypolicyviolation`. The HTML response header `Content-Security-Policy` does not contain `unsafe-inline` or `unsafe-eval`.
19. (SC6) Create via the dialog a note titled with 200 times "W". Expect it is accepted. `[t=sky-label][data-title]` for it (zoom at least 1.4) has `data-text` of at most 25 characters ending with "…"; `[t=star-card-title]` text is the full 200 characters; in List view the item link has `title` equal to the full text. At 1280 and at 390 wide, `document.documentElement.scrollWidth <= innerWidth`.

### Conflict (SC7)
20. (SC7) Vault U. Open "Welcome" (`/n/Welcome`) in two tabs of one context. In A append " A-edit", Control+S: "Saved". In B append " B-edit", Control+S. In B expect `[t=conflict-banner]` containing "This note changed since you opened it.", `[t=conflict-reload]` and `[t=conflict-copy]` visible, `[t=save-status]` "Not saved", `[t=save-button]` disabled, `[t=editor]` containing "B-edit"; `Welcome.md` contains "A-edit" and not "B-edit"; focus stays in the editor.
21. (SC7) Continuing: with clipboard permission click `[t=conflict-copy]`: clipboard equals B's editor text and "Copied" shows. Click `[t=conflict-reload]`: editor equals the file, banner gone, "Saved". Then with `fs` append "\nexternal" to `Welcome.md`, edit in the app and save: banner appears and the file ends with "external" without the app edit.

### Fly to and random (SC8)
22. (SC8) Sample vault. Click the page body, press Control+K: `[t=search-input]` focused. Type "writ" (30 ms delay): `[t=search-result]` count 1 with `data-title="Writing a note"`, `[t=search-status]` "1 note matches", input has `aria-expanded="true"`. Press Enter, record `t0` and sample `data-camera` and `data-animating` every 30 ms: a sample within 150 ms contains `flight`; idle by `t0 + 1200 ms`; across samples the distance from the camera to the final camera never increases by more than 1% and `z` never exceeds `max(z0, zEnd) + 0.001`. After: URL path `/n/Writing%20a%20note`, `[t=note-title]` focused with text "Writing a note", and the star's `data-focused-x/y` within 2 px of the centre of `data-free-area`.
23. (SC8) With a far target (vault G(1000, 2000), search "N0999"): press Enter, and 200 ms later press ArrowLeft. Within 100 ms `data-animating` is `none`, and the camera x moved by no more than `64/z + 0.5` world units after the key (input cancels at once).
24. (SC8) Sample vault. Press `[t=random-star-button]` five times, waiting for idle each time and reading `S[data-focused-star]`. The five titles are all different, each is one of the five sample titles, `[t=star-card]` is visible each time with that title, `[t=status-live]` reads `Showing <title>.`, and the URL path stays `/`.
25. (SC8) Vault with 0 notes (after removing samples): `[t=random-star-button]` is `aria-disabled="true"`; pressing it puts "There are no stars yet. Write one first." in `[t=status-live]` and does nothing else.

### Performance (SC9)
26. (SC9, 1,000 notes) Vault G(1000, 2000). Start the server, go to `/` and wait for `data-ready="true"`: elapsed from navigation start is at most 1000 ms; `data-star-count` 1000; `data-label-count` at most 40; no console errors. Then, in the page, for 5000 ms in a `requestAnimationFrame` loop, dispatch `pointerdown` at the canvas centre, then one `pointermove` of 6 px per frame (reversing direction every 120 frames), then `pointerup`; count frames. Average fps is at least 55 and `S[data-frame-p95]` is at most 18 (ms).
27. (SC9, 5,000 notes) Vault G(5000, 10000). Elapsed from navigation start to `data-ready="true"` at most 3000 ms; `data-star-count` 5000; `GET /api/sky` body at most 1,500,000 bytes uncompressed; no console errors. The same 5000 ms pan: average at least 30 fps and `data-frame-p95` at most 40. Focus `[t=search-input]`, type "quarterly" with a 20 ms key delay, take `t0` after the last key and wait for 3 `[t=search-option]` (`search-result`): three runs (with "Quarterly" and "QUARTERLY") have a median `t1 - t0` under 500 ms.
28. (SC9, labels and unlit cap) In check 26's vault, `data-label-count` stays at most 40 at the fit camera and after pressing `+` three times; at 390x844 it is at most 24. A vault of 100 notes with 2,500 distinct missing links has `S[data-unlit-count="2000"]` while `[t=unlit-list]` lists all 2,500 (heading "Not written yet (2500)").

### Without the sky (SC10)
29. (SC10) Vault U. Load `/` and press Tab once: `[t=skip-to-list]` is focused with text "Skip to list". Press Enter: URL path `/list`, `[t=list-heading]` focused with text "All notes". Using only keyboard (no mouse calls): Shift+Tab until `[t=new-star-button]`, Enter, type "Keyboard note", Enter; URL `/list/n/Keyboard%20note`, editor focused. Type `[[Linked]] text`, Control+S: "Saved". Tab to `[t=rename-button]`, Enter, type "Keyboard note 2", Enter: `[t=note-title]` focused and reads "Keyboard note 2". Press Control+K, type "keyboard", Enter: the note opens. In `[t=unlit-list]` focus `[t=unlit-create]` for "Linked", Enter: "Linked" opens and `[t=backlink-item][data-title="Keyboard note 2"]` shows a `[t=backlink-snippet]` containing `[[Linked]]`. `Keyboard note 2.md` exists.
30. (SC10) `S` aria-label matches `^Sky of \d+ notes?, \d+ constellations?$` and `S` has `aria-describedby` pointing at `[t=sky-help]` whose text starts "Arrow keys pan.". `[t=constellation-list]` in `/list` shows one `[t=constellation-item]` per constellation with `data-name` equal to the brightest member.
31. (SC10, axe) Run `@axe-core/playwright` with tags `wcag2a`, `wcag2aa`, `wcag22aa` on: `/` (sample intro finished), `/` with `star-card` visible, `/n/Start%20here`, `/list`, `/list/n/Start%20here`, the new-star dialog, the rename dialog, the delete dialog, the remove-samples dialog, the empty sky, and the app-error state. Zero violations of impact serious or critical (target: zero violations). `document.documentElement.lang` is `en`.

### Reduced motion (SC11)
32. (SC11) New context with `reducedMotion: "reduce"`, empty vault. `S[data-motion="reduced"]` and `S[data-twinkle="off"]`. After `data-ready="true"`: `data-star-count` is 5, `data-lit-progress` is `1.00`, `S[data-focused-star="Start here"]` within 300 ms; in 40 polls spaced 50 ms `data-animating` is always `none`.
33. (SC11) Same context, idle. Read `data-frame-count`, wait 1500 ms without input, read it again: equal. In a context with no preference (full motion), the same wait raises `data-frame-count` by at least 10.
34. (SC11) Reduced context. Fly to "Writing a note" and press Random: after Enter, within 150 ms `data-animating` is `none` and the star is at the centre of `data-free-area` (+-2 px), and no sample ever contained `flight`. Create "Calm" via New star: the first poll after submit has `data-lit-progress` `1.00`, `data-animating` never contains `lit-grow`, `lit-ring` or `lit-lines`, `data-star-count` increments, `data-static-ring` is `"true"` and becomes `"false"` between 1800 and 2600 ms later. Computed `transition-duration` of `[t=note-panel]` and of the open `dialog` is `0s`.
35. (SC11) Parallax still follows input in reduced motion: focus the canvas, press ArrowRight 5 times (idle each time); the magnitude of the change in `data-dust-offset` x equals `0.30 * 5 * 64` (96 px) +-3 px (see check 41).

### Phone (SC12)
36. (SC12) Context 390 x 844, `hasTouch: true`, `isMobile: true`. Sample vault, wait for the intro. Using CDP `Input.dispatchTouchEvent`: a one-finger drag of 120 px to the left (start 280,400, end 160,400, 8 move events): `data-camera` x increases by `120/z` +-10%, y within 1 world unit, `window.scrollY` is 0, and `data-animating` is `none` within 700 ms (inertia included).
37. (SC12) Pinch: two touches at (150,300) and (250,300) moving to (100,300) and (300,300) over 10 steps. `z` after is `2.0 * z` before (+-15%) and the world point under the start midpoint (200,300) (from the formula) is within 3 px of (200,300) after.
38. (SC12) Fly to "Start here", press Escape (card closes), read the star position before it clears, then `page.touchscreen.tap` on it: `[t=star-card]` visible with "Start here". Tap `[t=star-card-action]`: `[t=note-panel]` visible and its bounding box top is at least `844 * 0.42 - 2`; the star's position is not inside the panel box and is inside `data-free-area`.
39. (SC12) At 390 x 844 and at 320 x 640: open `/list`, a note whose title is 200 "W", a note whose body has an unbroken 5,000-character line (Write and Preview), the dialogs and the sample banner: `document.documentElement.scrollWidth <= viewport width`. Every `button`, `[t=note-list-item] a`, `[t=search-input]` and the dock controls has a height of at least 44 px; `input` and `[t=editor]` computed `font-size` is at least 16 px. `[t=new-star-button]`, `[t=random-star-button]`, `[t=view-sky]`, `[t=view-list]` have a bounding box top of at least `innerHeight - 60` (the dock sits in the bottom thumb zone). Create a note through the phone dialog, type, save, reload: the text persists.

### Layout and labels
40. (Layout) At 1280 x 800 with a note open: `[t=note-panel]` right edge equals the viewport width, its width is 461 +-2; `[t=app-header]` height 56 +-1; `data-free-area` width is `1280 - panelWidth`; the focused star's `data-focused-x/y` lie inside `data-free-area` and outside the panel rect; `document.documentElement.scrollHeight <= innerHeight`. At 390 x 844 the same holds for the sheet. Resize from 1280 to 390 with a note open: the star stays outside the panel after 500 ms.
41. (Parallax and dust) Full motion off (reduced context). Record `data-dust-offset` and `data-camera`, press ArrowRight 5 times: `abs(dust dx) / abs(screen pan dx)` is 0.30 +-0.01 where screen pan dx is `abs(cam dx) * z`. Click on empty sky where no star is within 30 px: `data-focused-star` unchanged and `[t=star-card]` absent (the dust is not clickable).
42. (Labels) Vault G(1000, 2000). At the fit camera read all `[t=sky-label]`: count equals `data-label-count` and is at most 40; no two label rects `(data-x, data-y, data-w, data-h)` intersect (area 0); every label with `data-kind="star"` is absent unless `z >= 1.4` or `data-focused="true"`; at most 12 constellation labels. Press `+` until `z >= 1.4`: star labels appear, count still at most 40, still no intersections. At 390 x 844 the count is at most 24. In the 5-note sample the star-label threshold is 0.8 (labels appear at fit zoom).
43. (Labels) Tab to a star: `[t=sky-label][data-focused="true"]` exists with that `data-title`, even at the fit camera.
44. (Twinkle) Full motion, sample vault, focus "Start here". Every 100 ms for 8 s read `data-focused-rendered` and `data-focused-brightness`: `max(abs(rendered/base - 1)) <= 0.15` and `>= 0.02`. In a reduced context all samples are equal. (Neighbour stagger is a unit test: no two stars within 60 world units share a phase slot.)

### Keyboard model
45. (Keyboard) Sample vault, Tab into the canvas (`document.activeElement` is `S`, `data-focus-index` is `0/5`). Read `data-camera`. ArrowRight: x increases by `64/z` +-0.5; ArrowDown: y increases by `64/z`; ArrowLeft and ArrowUp return it. Press `+`: after idle `z` is `z0 * 1.25` +-0.01; `-` returns it; press `+` 30 times: `z` is 6.000; `-` 40 times: 0.100 (clamps). Press `0`: camera equals the camera after load +-0.01. Press Escape with a card open: `[t=star-card]` absent and `data-focused-star` empty.
46. (Keyboard) Reading order. Sample vault. Compute the expected order from `GET /api/sky` and the camera formula: stars inside the free area sorted by `floor(screenY/48)`, then `screenX`, then title. Tab five times: `data-focused-star` follows the expected order and `data-focus-index` reads `1/5` to `5/5`, with `[t=star-card]` matching each. A sixth Tab moves focus off the canvas (to `[t=star-card-action]`; `document.activeElement` is not `S`). Shift+Tab returns to the canvas on star 5/5. Shift+Tab four times: 1/5. A fifth Shift+Tab leaves the canvas backwards (not to `S`).
47. (Keyboard) Open and spatial move. With star 1 focused press Enter: URL becomes `/n/<title>`, `[t=note-panel]` visible, `[t=note-title]` focused and equal to the star title. Press Escape from the canvas, focus a star, then Shift+ArrowRight: `data-focused-star` is the nearest star with larger screen x inside a 60 degree cone (compute from the API); if none exists it is unchanged and `[t=sky-announce]` is unchanged.
48. (Pointer) Mouse drag of 100 px right with `pointerdown`, 10 moves, `pointerup`: `data-camera` x decreases by `100/z` +-1 and no note opens even when the drag started on a star (threshold 4 px). A click without movement on a lit star opens its note. Ctrl+wheel with `deltaY: -100` at (300,300) multiplies `z` by `exp(0.15)` (+-2%) and the world point under (300,300) stays within 1 px.

### Search and list
49. (Search, sky) Sample vault. Focus `[t=search-input]`, type "o": the dropdown has at most 8 `[t=search-result]` with `role=option`; press ArrowDown: `aria-activedescendant` equals the second option's id and it has `data-active="true"`; Escape: dropdown closes and the text stays; Escape again: text cleared. Type `<b>`: `[t=search-empty]` text `No notes match "<b>"`, zero `b` elements on the page. With `page.route` aborting `**/api/search*`: "Search failed. Check that the server is running, then try again." appears.
50. (List) Vault of three notes with mtimes set (A oldest, C newest) and one linking note. `/list`: `[t=note-list-item]` order is C, B, A. Choose "Title A to Z" in `[t=list-sort]`: order A, B, C. Choose "Most linked": the most linked first. Each item text matches `Edited \d{4}-\d{2}-\d{2} \d{2}:\d{2}, \d+ links? in`. Type a query: `[t=search-results]` visible, `[t=note-list]` hidden, each result with a `[t=search-snippet]` containing `mark`. Escape: list back with 3 items.
51. (Panel and backlinks) Sample vault. Open "Writing a note": `[t=backlinks]` heading "Backlinks (1)", one `[t=backlink-item][data-title="Start here"]` whose snippet equals the line containing `[[Writing a note]]`. Click it: URL `/n/Start%20here`. In "Start here" `[t=wikilink]` count is 4, all `data-state="exists"`. Add `[[Nowhere]]`: a fifth with `data-state="missing"` and computed `text-decoration-style` `dashed`.
52. (Guard and delete) Open "Start here", type "x": `[t=save-status]` "Unsaved changes", `document.title` starts with `* `. Press `[t=zoom-fit]`, click a star: `[t=leave-dialog]` visible, `[t=leave-stay]` focused. Keep editing, then Save. Click `[t=delete-button]`: `[t=delete-dialog]` contains `Delete "Start here"?` and "Start here.md", `[t=delete-cancel]` focused. Confirm: a poll sees `fade` in `data-animating` within 100 ms (full motion), `S[data-star-count]` is 4, `[t=status-live]` contains `Deleted "Start here"`, and only `Start here.md` is gone. Focus is on `S`.
53. (External files) With the server running copy `Imported.md` (`Imported links to [[Welcome]].`) and `sub/Hidden.md` and `notes.txt` into a vault of U. Reload: `S[data-star-count]` increases by 1; `/list` has an item "Imported" and no "Hidden" or "notes"; "Welcome" lists "Imported" in backlinks.

### States, themes, fonts
54. (States) Loading: `page.route("**/api/sky", delay 3500 ms)`. Go to `/`: `[t=sky-loading]` visible with "Charting the sky...", role `status`, `S[data-ready="false"]`, the header search works; after 3 s `[t=sky-loading-slow]` shows "Still charting. A large vault can take a few seconds."; after release `data-ready="true"` and the loading text is gone.
55. (States) Error: abort `**/api/sky`. `[t=app-error]` visible with "Could not reach Constellation" and "The server may have stopped. Check the terminal where it is running, then try again."; its heading is focused; the dust sky is drawn behind it. Remove the route and click `[t=app-retry]`: `data-ready="true"`.
56. (States) Empty: remove the samples and delete the user note: `[t=sky-empty]` visible with "The sky is empty" and "Every note you write becomes a star."; click `[t=empty-create]`: `[t=new-star-dialog]` opens. `/list` shows `[t=note-list-empty]` "No notes yet.".
57. (States) Partial: abort `GET **/api/notes/Start%20here`, open `/n/Start%20here`: `[t=note-notice]` reads `Could not load "Start here". Try again.`, `S[data-star-count="5"]` and the sky still responds to arrow keys; remove the route and click `[t=note-notice-retry]`: the editor shows. Permission: `GET /` with header `Host: evil.example` returns status 403 and a body containing "This address is not allowed." and no note text.
58. (Theme and contrast) For `colorScheme` dark then light: `[t=sky-stage][data-theme]` is `night` then `daylight`; `[t=sky-stage]` `background-color` is `rgb(5, 8, 15)` then `rgb(232, 238, 248)`; computed contrast (luminance formula in the test) of `[t=note-title]`, `[t=save-status]`, `[t=sky-summary]`, a `[t=note-list-item]` meta text, `[t=star-card-meta]` and a disabled button against their backgrounds meets the floors in `design-direction.md` section 9 (4.5, 4.5, 4.5, 4.5, 4.5, 3.0); for a fresh note `S[data-focused-color]` is `#fff0c4` (dark) and `#b45309` (light). Contrast row values come from the tokens read from `app.css`.
59. (Focus ring) Press Tab through the header, dock and panel: every focused element has computed `outline-width` of at least 3 px and `outline-offset` 2 px (canvas: 3 px, offset -2 px) and a colour with at least 3:1 against its background in both themes; at 1280 each button and list link is at least 24 x 24 px.
60. (Fonts and network) Record all requests while loading `/`, opening a note and `/list`: every request URL starts with the base URL; no response has a `font/*` content type; computed `font-family` of `body` starts with `Seravek` and of `[t=editor]` starts with `ui-monospace`; `[t=brand]` computed `font-variant-caps` is `small-caps` and `letter-spacing` is `2.52px` +-0.3 at 14 px; an element with the figures class (the `sky-summary`) has `font-variant-numeric` containing `tabular-nums`.

### Coverage map

| SC | Journey | Checks |
|---|---|---|
| SC1 first 30 seconds | J1 | 1, 2, 3, 4, 5, 6 |
| SC2 stable sky | J2 | 7, 8 |
| SC3 links and unlit | J3 | 9, 10, 11 |
| SC4 brightness and constellations | J4 | 12, 13, 14, 42 |
| SC5 rename | J5 | 15, 16 |
| SC6 hostile titles and content | J6 | 17, 18, 19 |
| SC7 conflict | J7 | 20, 21 |
| SC8 fly to and random | J8 | 22, 23, 24, 25 |
| SC9 performance | J9 | 26, 27, 28 |
| SC10 no-sky path | J10 | 29, 30, 31 |
| SC11 reduced motion | J11 | 32, 33, 34, 35 |
| SC12 phone touch | J12 | 36, 37, 38, 39 |
| Design bar (memorable detail, motion, depth, calm) | all | 3, 22, 23, 33, 41, 42, 43, 44, 58, 59, 60 |
| Keyboard model | J8, J10 | 45, 46, 47, 48 |
| Wiki behaviour carried over (delete, guard, search, files) | J13, J14 | 49, 50, 51, 52, 53 |
| States and layout | J15 | 40, 54, 55, 56, 57 |

Total: 60 browser checks. In addition the builder must keep three non-browser tests green: (a) a contrast test that reads `app.css` tokens and fails below every floor in `design-direction.md` section 9; (b) an easing test that samples each curve at 100 points and asserts values stay within [0, 1] and are monotonic; (c) a twinkle-slot and layout-determinism test (same vault, identical positions; no two stars within 60 world units share a phase slot). The wiki's own acceptance suite for the copied core stays unchanged and must still pass.
