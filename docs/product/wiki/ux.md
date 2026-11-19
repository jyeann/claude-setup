# UX: wiki

Vanilla JS, plain HTML and CSS in `public/`, no framework, no build step. The server renders nothing: it serves static files and a JSON API under `/api`. All Markdown rendering, wikilink resolution, highlighting and graph layout happen in the browser. English only. Source: `brief.md` (success criteria "SC1" to "SC10").

## Conventions and data-testid contract

- Tests use `[data-testid="..."]` only. This table is the single contract shared by tests and the builder. Names are stable; do not rename without updating this file. Repeating things carry data attributes.
- All text from notes (titles, bodies, snippets) is set with `textContent` or DOM nodes, never `innerHTML`. Highlights are built as `<mark>` nodes.
- Every page has `<html lang="en">`, one `<h1>`, `<main id="main">`, and a "Skip to main content" link as the first focusable element.
- Assumption for the builder and tests: the server reads `PORT` (default 3000) and `VAULT_DIR` (default `./vault`), listens on 127.0.0.1 only, prints `Wiki running at http://localhost:<port>`, and creates the vault folder if missing.
- Server fallback: any non-`/api` GET path that is not a static file returns `public/index.html`; the client router decides what to show. Unknown `/api` paths return JSON 404.

### Client routes

| Route | Screen |
|---|---|
| `/` | Home: list plus placeholder (desktop), list only (phone) |
| `/n/<encodeURIComponent(title)>` | Note view. Title is decoded once. Unsafe or unknown titles show Note not found. |
| `/graph` or `/graph?note=<title>` | Graph view; `note` marks the current node |
| anything else | Note not found screen (client side, status 200 is acceptable; the API 404s are what protect files) |

Page `<title>`: Home `Wiki`; note `<Title> - Wiki` (prefixed `* ` while unsaved); graph `Graph - Wiki`; not found `Note not found - Wiki`.

### data-testid table

| data-testid | Element | Notes |
|---|---|---|
| `skip-link` | a | First focusable. "Skip to main content" |
| `search-input` | input type=search | Label "Search notes" |
| `search-clear` | button | "Clear search". Only present when input is non-empty |
| `search-status` | div role=status | "Searching...", "3 notes match", "No notes match" variants. Visually hidden for result counts, visible for "Searching..." |
| `new-note-button` | button | "New note" |
| `graph-link` | a | "Graph". href `/graph` or `/graph?note=<current>` |
| `note-list` | ul | Sorted by last modified, newest first |
| `note-list-item` | li | `data-title`, `aria-current="page"` on the open note. Contains the link `a` |
| `note-list-empty` | p | "No notes yet." |
| `list-loading` | p role=status | "Loading notes..." |
| `search-results` | ul | Replaces `note-list` while a query is active |
| `search-result` | li | `data-title`. Contains an `a` to the note |
| `search-snippet` | p | Contains `mark` elements around matches |
| `search-empty` | p | `No notes match "<query>"` |
| `empty-vault` | section | Main pane when the vault has zero notes |
| `empty-create` | button | "Create your first note" |
| `no-selection` | section | Main pane (desktop, `/`) when notes exist |
| `back-to-list` | a | "Notes". Phone only (display none at 720px and wider) |
| `status-live` | div aria-live=polite | Always in DOM. Receives "Saved", "Created Ideas", etc. Visually hidden |
| `alert-live` | div role=alert | Always in DOM. Receives errors. Visually hidden |
| `app-error` | div | Server unreachable on load. Contains `app-retry` |
| `app-retry` | button | "Try again" |
| `note-view` | article | Open note. `data-title`, `data-state="clean\|dirty\|saving\|conflict\|error"` |
| `note-title` | h1 | Title text, tabindex -1 |
| `save-status` | span | "Saved", "Unsaved changes", "Saving...", "Not saved" |
| `save-button` | button | "Save" |
| `rename-button` | button | "Rename" |
| `delete-button` | button | "Delete" |
| `tab-edit` | button role=tab | Phone only. "Edit" |
| `tab-preview` | button role=tab | Phone only. "Preview" |
| `editor` | textarea | Label "Note text". Raw Markdown |
| `preview` | div | Rendered Markdown, updates as you type (about 100 ms debounce) |
| `wikilink` | a (in preview) | `data-target` (title as written), `data-state="exists\|missing"`. Text is the label. Existing: href `/n/<title>`. Missing: href `#`, handled by click |
| `unsafe-link` | span (in preview) | A Markdown link with a disallowed scheme, shown as plain text |
| `backlinks` | section | Heading "Backlinks" with count |
| `backlink-item` | li | `data-title` of the linking note. Contains an `a` |
| `backlink-snippet` | p | The raw line that contains the link, trimmed to 160 chars |
| `backlinks-empty` | p | "No notes link here yet." |
| `conflict-banner` | div role=alert | "This note changed since you opened it." |
| `conflict-reload` | button | "Reload note" |
| `conflict-copy` | button | "Copy my text" |
| `save-error` | div role=alert | Non-conflict save failure |
| `new-note-dialog` | dialog | |
| `new-note-input` | input | Label "Title" |
| `new-note-error` | p | Inline error, empty when none |
| `new-note-submit` | button | "Create note" |
| `new-note-cancel` | button | "Cancel" |
| `rename-dialog` | dialog | |
| `rename-input` | input | Label "New title", prefilled with the current title |
| `rename-error` | p | Inline error |
| `rename-submit` | button | "Rename note" |
| `rename-cancel` | button | "Cancel" |
| `delete-dialog` | dialog | |
| `delete-confirm` | button | "Delete note" |
| `delete-cancel` | button | "Cancel". Initial focus |
| `leave-dialog` | dialog | Unsaved-changes guard for in-app navigation |
| `leave-stay` | button | "Keep editing". Initial focus |
| `leave-discard` | button | "Discard changes" |
| `not-found` | section | |
| `not-found-title` | h1 | "Note not found" |
| `not-found-back` | a | "Back to all notes" |
| `graph-view` | section | |
| `graph-svg` | svg | `data-ready="true"` once layout has settled enough to interact; `data-node-count`, `data-edge-count` |
| `graph-node` | g | `data-title`, `data-current="true\|false"`, `data-orphan="true\|false"`, `tabindex=0`, `role=link` |
| `graph-edge` | line | `data-from`, `data-to`. One per linked pair, either direction |
| `graph-summary` | p | "4 notes, 2 links" |
| `graph-loading` | p role=status | "Loading graph..." |
| `graph-empty` | p | "No notes to graph yet." |
| `graph-list` | ul | Text alternative to the graph: one item per note, always visible below the graph |
| `graph-list-item` | li | `data-title`. Contains a link to the note and the text "Links to B, C" or "No links" |

## Journeys

### J1. First use (SC1)
1. Person runs `node src/server.js`. Terminal prints `Wiki running at http://localhost:3000` and the vault folder now exists (empty).
2. They open the address. No sign-in, banner or prompt. The left pane has the search box, "New note", "Graph" and "No notes yet." The right pane shows `empty-vault`: h1 "Your vault is empty", a line "Notes are plain .md files in the vault folder.", and the button "Create your first note".
3. They press the button. A dialog asks for a Title with focus in the field. They type "Welcome" and press Enter or "Create note".
4. The dialog closes, the address becomes `/n/Welcome`, the empty note opens, focus is in the editor, the list shows "Welcome". `vault/Welcome.md` exists (empty).
5. They type text, press Ctrl+S (or "Save"). The status goes "Unsaved changes", "Saving...", "Saved". They reload and see the same text in the editor and the preview.

### J2. Link notes and create on click (SC2)
1. In "Welcome" they type `[[Ideas]]` and `[[Ideas|my ideas]]`. The preview shows both as links with a dashed underline and a hidden "(create note)" hint for screen readers; the second reads "my ideas".
2. They click the first. Since "Welcome" is saved, "Ideas" is created at once (empty file) and opens. Status: "Created Ideas".
3. They go back to "Welcome" via the list. Both links now render as normal links (solid underline); clicking either opens "Ideas".
4. If "Welcome" has unsaved changes when a link is clicked, the leave dialog (J11) appears first.

### J3. Backlinks (SC3)
1. Opening "Ideas" shows a Backlinks section beneath the note: "Backlinks (1)" with "Welcome" and the line that contains the link.
2. Clicking the backlink opens "Welcome".
3. They remove both links in "Welcome" and save. Opening "Ideas" shows "No notes link here yet."

### J4. Rename (SC4)
1. In "Ideas" they press "Rename". Dialog "Rename note" shows the current title selected.
2. They enter "Project ideas" and press "Rename note". Dialog closes; address becomes `/n/Project%20ideas`; heading changes; status "Renamed to Project ideas. Updated links in 1 note."
3. In "Welcome", source and preview show `[[Project ideas]]` and `[[Project ideas|my ideas]]`; links are normal.
4. Renaming to an existing title (any case) leaves the dialog open with the error. Nothing changes on disk.
5. If some notes could not be rewritten, the status reads "Renamed, but 2 notes could not be updated: A, B. Fix those links by hand." and is also sent to the alert region.

### J5. Unsafe titles (SC5)
1. In New note or Rename they enter `../escape`, `a/b`, `a\b`, `.hidden`, nothing, spaces only, or 201 characters.
2. Pressing the submit button shows the inline error under the field, focus returns to the field, and the dialog stays open. No file is created.
3. Opening a note address with `..` or `%2e%2e%2f` shows "Note not found".

### J6. Safe content (SC6)
1. A note containing `<script>alert(1)</script>` and `<img src=x onerror=alert(1)>` shows both strings literally in the preview and the search snippet. Nothing runs and no image loads.
2. `[link](javascript:alert(1))` appears as the plain text "link", not clickable.

### J7. Conflict (SC7)
1. The same note is open in tab A and tab B. A saves. B edits and saves.
2. B shows a red banner: "This note changed since you opened it." with "Reload note" and "Copy my text". B's text stays in the editor; B's Save is disabled; status "Not saved".
3. "Copy my text" copies B's editor text and says "Copied". "Reload note" replaces the editor with the newer file content, clears the banner, status "Saved".
4. The same banner appears if the file was edited in another editor between opening and saving.

### J8. Search (SC8)
1. Person focuses the search box (click or press Ctrl+K / Cmd+K) and types "quarterly". After about 120 ms of no typing, the list is replaced by results. Each shows the title and a snippet with the match highlighted. Title-only matches show the start of the body.
2. Clicking a result opens the note. Escape or "Clear search" returns to the full list.
3. No matches: `No notes match "xyzzy"`.

### J9. Graph (SC9)
1. "Graph" in the left pane opens the graph view (keeping the current note as `?note=`). Every note is a node labelled with its title; each linked pair has one line. The current note is filled with the accent colour and has a thicker ring; orphans float apart and are still drawn.
2. Clicking a node, or focusing it and pressing Enter, opens that note.
3. A summary line "4 notes, 2 links" sits above the graph.

### J10. Files that live outside the app (SC10)
1. While the server runs, the person copies `Imported.md` into the vault folder, then reloads. It is in the list; its wikilinks resolve; the notes it links to list it in Backlinks.
2. Files in subfolders and non-`.md` files are not listed.
3. Searching also picks up files added since the last load.

### J11. Unsaved changes guard (brief open question 5)
1. Typing marks the note "Unsaved changes" and the tab title gets `* `.
2. Following any in-app link, list item or Graph while dirty opens "Leave without saving?" with "Keep editing" (focus) and "Discard changes". Closing or reloading the tab shows the browser's own warning.

### J12. Delete (SC10)
1. "Delete" opens a dialog "Delete "Imported"?" with "This permanently deletes Imported.md from your vault. Notes that link to it will show a create link." Focus is on "Cancel".
2. "Delete note" removes only that file, goes to `/`, and says `Deleted "Imported"`. Notes that linked to it now show a create link.

### J13. On a phone
1. At 390 px wide `/` shows the list only. Opening a note shows the note only with "Notes" at top-left to go back. Edit and Preview are tabs instead of side by side.

## Screens and states

### App shell
Regions in DOM and tab order: `skip-link`; sidebar `nav aria-label="Notes"` with `search-input` (and `search-clear`), `new-note-button`, `graph-link`, then `note-list` or `search-results`; `main#main`; `status-live`, `alert-live`.

- Desktop (720 px and wider): two panes. Left sidebar fixed width 300 px, scrolls on its own. Right pane fills the rest. Right pane for a note is: header (`note-title` h1, `save-status`, `save-button`, `rename-button`, `delete-button`), banners (`conflict-banner`, `save-error`), then the editor and preview side by side (equal widths, each scrolls on its own), then `backlinks` full width below. Both `editor` and `preview` are visible; the tab buttons are not in the DOM tab order.
- Phone (under 720 px): one pane at a time. `/` shows the sidebar full width. `/n/...` and `/graph` show main full width with `back-to-list` ("Notes") in the header. `tab-edit` and `tab-preview` appear; only the active one of editor and preview is visible (preview for an existing note, edit for a note just created or empty). Backlinks come after the editor or preview.
- Loading (first fetch of `/api/notes`): `list-loading` "Loading notes..."; main pane shows nothing but the heading area. No empty-state text until the response arrives.
- Server unreachable: `app-error` replaces the main pane: "Could not reach the wiki server. Check that it is still running, then try again." with `app-retry` "Try again". Focus moves to the message. Retry reloads the list.
- Home with notes, desktop: `no-selection` h1 "Wiki" and "Choose a note from the list, or create a new one."

### Empty vault
Left: `note-list-empty` "No notes yet." Right: `empty-vault` as in J1. Search of an empty vault shows `No notes match "..."`. Graph shows `graph-empty`.

### Note list
Each item: link with the title (single line, ellipsis, full title in `title` attribute) and small text "Modified 2026-11-18 14:05" (local time). Newest modified first. After save, create, rename or delete the list re-fetches and reorders. Long title (200 chars) never widens the sidebar.

### Note view
- Loading: header shows "Loading..." (status role) in place of the title; editor not rendered until loaded.
- Clean: `save-status` "Saved", `save-button` disabled (not hidden).
- Dirty: "Unsaved changes", Save enabled, `data-state="dirty"`.
- Saving: "Saving...", Save disabled, editor stays editable; edits made while saving keep the note dirty afterwards.
- Saved: "Saved", live region "Saved". Focus stays where it was.
- Conflict: `conflict-banner` below the header: "This note changed since you opened it. Your edit was not saved and the newer version is untouched. Copy your text if you want to keep it, then reload." Save disabled, status "Not saved", `data-state="conflict"`. Editor still editable.
- Save failed (network or 5xx): `save-error` "Could not save. Your text is still here. Check that the server is running, then try again." Save stays enabled; status "Not saved".
- Note deleted elsewhere (save returns 404): `save-error` "This note no longer exists. Copy your text before you leave." Save disabled.
- Preview: renders the subset (headings, paragraphs, emphasis, lists, links, inline and fenced code, blockquotes). Raw HTML is escaped text. Wikilinks outside code resolve case-insensitively against the note list. Inside code they are plain text. Links with `http`, `https` or `mailto` become `a[target=_blank][rel="noopener noreferrer"]`; any other scheme (for example `javascript:`, `data:`) becomes `unsafe-link` plain text showing only the label. Images (`![](...)`) are shown as literal text. Preview for an empty note: muted text "Nothing to preview yet."
- Hostile or long content: editor and preview wrap (`overflow-wrap: anywhere`, preview `pre` blocks scroll horizontally inside their box); a 5,000-character unbroken line never creates page-level horizontal scroll. h1 wraps.
- Backlinks: loading "Loading backlinks..."; empty `backlinks-empty`; items sorted by title. Each item shows the linking note's title (a link) and the first line that links here, as text. A note that links twice appears once.
- Broken link (a wikilink to a missing note): see Preview. Clicking it creates the note (J2) and shows "Created Ideas". If the title is invalid (for example `[[a/b]]`), the link is shown as an `unsafe-link` plain text with the hint `title` "Not a valid note title" and is not clickable. If creation fails: alert "Could not create "Ideas". Try again." and the user stays on the current note.

### New note dialog
Label "Title", hint "For example, Meeting notes. Up to 200 characters." Buttons "Create note" and "Cancel". Submit disables the button and shows "Creating...". Errors appear in `new-note-error` (referenced by `aria-describedby`, input `aria-invalid="true"`), focus on the input, text kept. See Copy for each message. Escape or Cancel closes and returns focus to the opener.

### Rename dialog
Same layout; title "Rename note", field "New title", prefilled and selected, hint "Links in other notes are updated for you." Same-title submit (identical string) closes without calling the server. Dirty note: error "Save or discard your unsaved changes before renaming." Existing title: error as in Copy.

### Delete dialog
See J12. Server failure: inline `role=alert` text in the dialog "Could not delete the note. Try again." and the dialog stays open.

### Leave dialog
Title "Leave without saving?", text "You have unsaved changes in "Welcome". They will be lost.", buttons "Keep editing" and "Discard changes".

### Search
- Query empty: `note-list` visible. Query non-empty (after trim): `search-results` replaces it.
- Searching: `search-status` "Searching..." (visible) for requests that take over 150 ms.
- Results: `search-status` (hidden text) "3 notes match" (singular "1 note matches"). Results ordered title matches first, then by last modified. Each snippet is about 120 characters centred on the first match with "..." at cut ends; all occurrences in the snippet are `mark`ed. Highlight is by text and colour (mark has underline too).
- No results: `search-empty` `No notes match "<query>"` (query shown as text, truncated to 40 chars with "...").
- Search error: `search-empty` replaced by "Search failed. Check that the server is running, then try again."
- A hostile query such as `<b>` is searched literally and shown literally.

### Graph
- `graph-loading` while fetching `/api/graph` and while layout starts.
- Ready: `svg[data-testid="graph-svg"]` fills the main pane (min height 60vh); nodes are circles with a text label (title, truncated to 24 characters with the full title in `<title>`); `data-ready="true"` once the layout is interactive (first paint after at most 3 s for 1,000 notes; layout may keep settling). Layout stops moving after it settles or after 300 iterations.
- Current node: `data-current="true"`, filled accent, thicker ring. Orphans: `data-orphan="true"`, same shape, drawn in the muted colour but with the same label.
- Empty: `graph-empty`. Error: "Could not load the graph. Try again." with a "Try again" button.
- Large vault: labels are only drawn for the current node, hovered or focused nodes and neighbours when over 200 notes (the `<title>` tooltip still names every node).
- Self links are ignored. Two notes that link each other have one edge.

### Note not found
`not-found-title` h1 "Note not found", text "There is no note at this address. It may have been renamed or deleted.", `not-found-back` "Back to all notes". Shown for unknown titles, `..` forms, and unsafe titles. It never shows or hints at other files, and does not offer to create.

## Copy

| Where | Text |
|---|---|
| Product name | Wiki |
| Search label / placeholder | Search notes / Search notes |
| Search clear | Clear search |
| Skip link | Skip to main content |
| Sidebar buttons | New note, Graph |
| Empty list | No notes yet. |
| Empty vault heading and help | Your vault is empty / Notes are plain .md files in the vault folder. |
| Empty vault button | Create your first note |
| No selection | Choose a note from the list, or create a new one. |
| Note list meta | Modified 2026-11-18 14:05 |
| New note dialog | Title: New note / label Title / hint For example, Meeting notes. Up to 200 characters. / Create note, Creating..., Cancel |
| Title errors (client and server use identical text) | see next rows |
| Empty | Give the note a title. |
| Too long | Keep the title to 200 characters or fewer. It is 215 now. |
| Separator | A title cannot contain / or \. |
| Dot dot | A title cannot contain "..". |
| Leading dot | A title cannot start with a dot. |
| Control characters | A title cannot contain control characters. |
| Reserved name | "CON" is a reserved name. Choose another title. |
| Exists | A note called "Ideas" already exists. Choose another title. |
| Create failed | Could not create the note. Check that the server is still running and try again. |
| Rename dialog | Rename note / New title / Links in other notes are updated for you. / Rename note, Renaming..., Cancel |
| Rename dirty | Save or discard your unsaved changes before renaming. |
| Rename ok (live) | Renamed to Project ideas. Updated links in 1 note. (0 notes: "Renamed to X."; many: "...in 3 notes.") |
| Rename partial | Renamed, but 2 notes could not be updated: A, B. Fix those links by hand. |
| Save status | Saved / Unsaved changes / Saving... / Not saved |
| Save button | Save |
| Conflict banner | This note changed since you opened it. Your edit was not saved and the newer version is untouched. Copy your text if you want to keep it, then reload. |
| Conflict buttons | Reload note, Copy my text (then "Copied" for 2 s; failure: "Could not copy. Select the text in the editor and copy it by hand.") |
| Save error | Could not save. Your text is still here. Check that the server is running, then try again. |
| Save, note gone | This note no longer exists. Copy your text before you leave. |
| Preview empty | Nothing to preview yet. |
| Missing link hint (hidden) | (create note) |
| Invalid link hint | Not a valid note title |
| Link create failed | Could not create "Ideas". Try again. |
| Created (live) | Created Ideas |
| Backlinks heading | Backlinks (2) |
| Backlinks empty | No notes link here yet. |
| Backlinks loading | Loading backlinks... |
| Delete dialog | Delete "Ideas"? / This permanently deletes Ideas.md from your vault. Notes that link to it will show a create link. / Delete note, Cancel |
| Deleted (live) | Deleted "Ideas" |
| Delete failed | Could not delete the note. Try again. |
| Leave dialog | Leave without saving? / You have unsaved changes in "Welcome". They will be lost. / Keep editing, Discard changes |
| Search states | Searching... / 3 notes match / 1 note matches / No notes match "xyzzy" / Search failed. Check that the server is running, then try again. |
| Graph | Graph / 4 notes, 2 links / 1 note, 0 links / Loading graph... / No notes to graph yet. / Could not load the graph. Try again. |
| Graph node label | (accessible name) Open note Ideas |
| Not found | Note not found / There is no note at this address. It may have been renamed or deleted. / Back to all notes |
| Server unreachable | Could not reach the wiki server. Check that it is still running, then try again. / Try again |
| Loading | Loading notes... / Loading... / Loading backlinks... |
| Phone | Notes (back), Edit, Preview |

Terminal line: `Wiki running at http://localhost:<port>`.

## Accessibility and responsive rules

Keyboard
- Tab order: skip link, search input, clear, New note, Graph, list items, then main (Notes back on phone, Save, Rename, Delete, editor, preview links, backlinks). On phone tabs come before the editor.
- Ctrl+S or Cmd+S in the editor saves (and the browser's save-page dialog is suppressed). Enter in a dialog field submits. Escape closes a dialog (focus returns to the opener) and, in the search box, clears the query.
- Ctrl+K (Cmd+K on macOS) focuses the search box from anywhere except an open dialog. There is no single-character shortcut (WCAG 2.1.4). Tab inside the editor moves focus out normally (no tab-indent trap).
- Graph nodes are `tabindex=0` `role=link`; Enter or Space opens the note; arrow keys are not required.

Focus after actions
- Create note or click a missing wikilink: focus on the editor of the new note. Rename ok: focus on the h1 (tabindex -1). Delete ok: on the list's first item or, if the list is empty, on `empty-create`. Dialog cancel or Escape: back to the opener. Dialog error: the input. Conflict banner appearing: focus stays in the editor (banner is announced by `role=alert`). Conflict reload: focus on the editor. Search result open: focus on the note h1. Back to list (phone): on the list item that was open.
- Route change always sets the document title and moves focus to the h1 (except when the editor takes it).

Announcements
- `status-live` (polite): "Saved", "Created X", "Renamed ...", "Deleted ...", "Copied". The search result count lives only in `search-status` (role=status), not in `status-live`, so it is announced once. Messages clear then set after 50 ms so repeats are re-read.
- `alert-live` and `role=alert` elements: save errors, conflicts, create/rename/delete failures, server unreachable.
- The editor's dirty state is also in `save-status` text, not colour only.

Semantics and labels
- The sidebar is a `nav` with `aria-label="Notes"`; the open note has `aria-current="page"`. Dialogs use native `<dialog>` with `showModal()` (focus trapped, background inert) and `aria-labelledby` on the dialog title. Editor has a visible label "Note text". Tabs (phone) use `role=tablist/tab/tabpanel` with `aria-selected`.
- Missing wikilinks differ by dashed underline, a muted accent colour, and the hidden text "(create note)". Colour is never the only cue. `mark` keeps a visible underline.
- Graph: the `svg` has `role="group"` plus `aria-label="Graph of notes and links"`. Never `role="img"`: it makes the child nodes presentational and hides them from screen readers. `graph-summary` is real text. Every node is reachable by keyboard and has an accessible name. The `graph-list` below the graph is the screen reader alternative: every note as a link with its outgoing links as text, so the full structure is available without the picture. No graph action needs dragging or a pointer path (no drag-to-move is required).
- Keyboard and focus: the tab buttons on phone follow the tabs pattern (Left/Right arrows move between tabs, only the selected tab is in the tab order, `aria-controls` points to the panel). Sticky headers must not hide a focused element (`scroll-padding-top` at least the header height). The search shortcut is Ctrl+K / Cmd+K (a modifier shortcut, so SC 2.1.4 does not apply); it is shown in the search placeholder hint.
- Target size: on desktop every button, icon button (`search-clear`) and list item is at least 24 x 24 CSS px; inline links in text are exempt. Graph nodes have an invisible hit circle of at least 12 px radius on desktop (24 px on phone).
- Graph colours: node rings, edges and the muted orphan colour meet 3:1 against the pane background in both themes; the current node differs by ring width and fill, not colour alone.
- Links that open a new tab (`target=_blank`) carry the hidden text "(opens in new tab)".
- Respect `prefers-reduced-motion`: the layout runs to its settled state without animating (or is pre-computed for a few hundred iterations); no transitions on route changes.

Contrast and themes: WCAG AA (4.5:1 text, 3:1 UI parts and focus ring) in light and dark via `prefers-color-scheme` and CSS custom properties. Suggested values: light bg `#ffffff`, surface `#f6f7f9`, text `#1a1d21`, muted `#4b5563`, border `#8a94a3`, accent `#1d4ed8`, danger `#b42318`, mark background `#fff3b0` with text `#1a1d21`; dark bg `#12151a`, surface `#1c2027`, text `#eef1f5`, muted `#a9b2bf`, border `#7b8696`, accent `#8ab4ff`, danger `#ffb4a9`, mark background `#5c4b00` with text `#fff6cc`. Focus ring 3 px accent with 2 px offset; never `outline: none` without a replacement. Disabled buttons keep 3:1 on their label.

Responsive
- 1280 px: sidebar left (300 px), main right; editor and preview side by side; `graph-svg` fills the pane.
- 390 px: single pane as in Screens and states; no horizontal scroll (`document.documentElement.scrollWidth <= 390`); buttons and list items at least 44 px tall; inputs and the editor use 16 px font to prevent iOS zoom; dialogs are full width with 16 px margin; the graph fills the width and supports tap on a node (hit area at least 24 px radius via an invisible larger circle).
- 200% text zoom: nothing is clipped or overlapping; header buttons wrap to a second row.
- Reflow (SC 1.4.10): at 320 CSS px wide (equal to 400% zoom on 1280) there is no horizontal scroll except inside `pre` blocks and the graph; the phone layout applies.

## UI acceptance checks

Setup for all checks: a fresh temp vault and `PORT`, server started with `VAULT_DIR=<tmp>`, base URL `http://localhost:<port>`, Playwright Chromium at 1280 x 800 unless stated. `[t=x]` means `[data-testid="x"]`. Filesystem steps read the vault folder directly with `node:fs`. "Visible" means in the DOM and not hidden. Unless said otherwise assertions auto-wait up to 5 s.

Welcome text used below (W): `Hello from Welcome.` newline, newline, `See [[Ideas]] and [[Ideas|my ideas]].` (file content must equal this exact string).

1. (SC1) Delete the vault folder if present and start the server (`node src/server.js`). Expect stdout to match `http://localhost:\d+` and the vault folder to exist and be empty. Open the base URL. Expect `[t=empty-vault]` visible containing "Create your first note", `[t=note-list-empty]` "No notes yet.", no `input[type=password]`, no text matching /sign in|log in/i.
2. (SC1) Click `[t=empty-create]`. Expect `[t=new-note-dialog]` visible and `[t=new-note-input]` focused. Fill "Welcome", click `[t=new-note-submit]`. Expect URL path `/n/Welcome`, `[t=note-title]` "Welcome", `[t=editor]` focused and empty, `[t=note-list-item][data-title="Welcome"]` visible, and file `Welcome.md` exists with length 0.
3. (SC1) Fill `[t=editor]` with W. Expect `[t=save-status]` "Unsaved changes" and `document.title` starting `* `. Press Control+S. Expect `[t=save-status]` "Saved". Reload the page. Expect `[t=editor]` value equals W and `[t=preview]` contains "Hello from Welcome.". Read `Welcome.md`: content equals W exactly.
4. (SC2) With "Welcome" open, expect two `[t=wikilink]` in `[t=preview]`, both `data-state="missing"` and `data-target="Ideas"`; their texts are "Ideas" and "my ideas". Expect computed `text-decoration-style` is `dashed` for them. Assert no other file exists in the vault.
5. (SC2) Click the first `[t=wikilink]`. Expect URL path `/n/Ideas`, `[t=note-title]` "Ideas", `[t=editor]` value empty, `[t=editor]` focused, file `Ideas.md` exists (empty). Click `[t=note-list-item][data-title="Welcome"] a`. Expect both `[t=wikilink]` now `data-state="exists"` with `href` ending `/n/Ideas` and `text-decoration-style` not `dashed`; the second's text is "my ideas". Click the second link: URL path `/n/Ideas` and `[t=note-title]` "Ideas".
6. (SC3) On "Ideas" expect `[t=backlinks]` heading text "Backlinks (1)", one `[t=backlink-item][data-title="Welcome"]` whose `[t=backlink-snippet]` text equals `See [[Ideas]] and [[Ideas|my ideas]].`. Click its link: URL `/n/Welcome`. Fill `[t=editor]` with `Hello from Welcome.`, press Control+S, expect "Saved". Open "Ideas" via the list: expect `[t=backlinks-empty]` "No notes link here yet." and zero `[t=backlink-item]`. Restore W in "Welcome" and save, for the next checks.
7. (SC4) Open "Ideas". Click `[t=rename-button]`. Expect `[t=rename-dialog]` visible, `[t=rename-input]` value "Ideas". Fill "Project ideas", click `[t=rename-submit]`. Expect dialog closed, URL path `/n/Project%20ideas`, `[t=note-title]` "Project ideas", `[t=status-live]` containing "Renamed to Project ideas. Updated links in 1 note.". Files: `Ideas.md` absent, `Project ideas.md` present. Open "Welcome": `[t=editor]` value contains `[[Project ideas]]` and `[[Project ideas|my ideas]]` and no `[[Ideas`; both `[t=wikilink]` have `data-state="exists"`; the file on disk has the same text.
8. (SC4) Create note "Other" (via `[t=new-note-button]`). Click `[t=rename-button]`, fill "project IDEAS", click `[t=rename-submit]`. Expect `[t=rename-dialog]` still visible, `[t=rename-error]` `A note called "Project ideas" already exists. Choose another title.`, `[t=rename-input]` focused. Cancel. Directory listing is exactly `Other.md`, `Project ideas.md`, `Welcome.md`, with contents unchanged. `[t=note-title]` still "Other".
9. (SC5) Click `[t=new-note-button]`. For each value (value then expected `[t=new-note-error]`): `../escape` then "A title cannot contain / or \."; `a/b` the same; `a\b` the same; `.hidden` then "A title cannot start with a dot."; empty then "Give the note a title."; `   ` (spaces) then "Give the note a title."; 201 times "x" then "Keep the title to 200 characters or fewer. It is 201 now.". After each submit expect `[t=new-note-dialog]` still visible, `[t=new-note-input]` focused with `aria-invalid="true"`, URL unchanged, and the vault directory listing and its parent directory listing unchanged (no `escape.md`, no `.hidden.md`, no new files).
10. (SC5) Open "Other", click `[t=rename-button]`, repeat the same seven values in `[t=rename-input]` and `[t=rename-submit]`: expect the same errors in `[t=rename-error]` (an empty value gives "Give the note a title."), dialog open, `Other.md` unchanged on disk and no new files inside or outside the vault. Also send API requests with the request fixture: `POST /api/notes` with title `../escape`, `a/b`, `a\b` and `.hidden` each returns status 400 and creates no file.
11. (SC5) Place a file `secret.md` containing "TOPSECRET" in the parent directory of the vault. Open `/n/%2e%2e%2fsecret`, `/n/%2e%2e%2f`, `/n/..%2fsecret`, `/n/%2e%2e`, and `/n/Does%20not%20exist`. Each shows `[t=not-found-title]` "Note not found" and `[t=not-found-back]`; the page text never contains "TOPSECRET". With the request fixture, `GET /api/notes/..`, `GET /api/notes/%2e%2e%2fsecret` and `GET /api/notes/..%2Fsecret` return 404 (or 400) and the body does not contain "TOPSECRET". Click `[t=not-found-back]`: URL path `/`.
12. (SC6) Register a `page.on("dialog")` handler that records any dialog and a `page.on("request")` recorder. Create note "Hostile", fill `[t=editor]` with these lines: `<script>alert(1)</script>`, `<img src=x onerror=alert(1)>`, `<b>bold?</b>`, `[link](javascript:alert(1))`, `[ok](https://example.com)`. Save and reload. Expect `[t=preview]` text contains `<script>alert(1)</script>`, `<img src=x onerror=alert(1)>` and `<b>bold?</b>` literally; `[t=preview] script`, `[t=preview] img`, `[t=preview] b` counts are 0; no recorded dialog; no request URL ending `/x`; `[t=unsafe-link]` text "link" and no `a[href^="javascript"]` anywhere on the page; `a[href="https://example.com"]` has `rel` containing `noopener`. Search "onerror": `[t=search-snippet]` text contains `onerror=alert(1)` and `[t=search-results] img` count is 0.
13. (SC7) Open "Welcome" in page A and page B (same browser context, two tabs). In A append " A-edit" to the editor and press Control+S: "Saved". In B append " B-edit" and press Control+S. Expect in B: `[t=conflict-banner]` visible containing "This note changed since you opened it.", `[t=conflict-reload]` and `[t=conflict-copy]` visible, `[t=save-status]` "Not saved", `[t=save-button]` disabled, and `[t=editor]` value still contains "B-edit". The file on disk contains "A-edit" and not "B-edit".
14. (SC7) Continuing: grant clipboard permissions, click `[t=conflict-copy]` in B. Expect the clipboard text equals B's editor value and a "Copied" label appears. Click `[t=conflict-reload]`: `[t=editor]` value equals the file content (contains "A-edit", not "B-edit"), `[t=conflict-banner]` is gone, `[t=save-status]` "Saved".
15. (SC7) Open "Welcome" in the app. With `node:fs` append "\nexternal" to `Welcome.md`. In the app append " app-edit" and press Control+S. Expect `[t=conflict-banner]` with the same text, and the file still ends with "external" and does not contain "app-edit".
16. (SC8) Create a fresh vault via files: `Quarterly plan.md` (body "Goals."), `Review.md` ("The QUARTERLY review is due."), `Other.md` ("nothing here"). Reload, click `[t=search-input]` and type "quarterly" with a 30 ms key delay. Expect `[t=search-results]` visible and `[t=note-list]` hidden, exactly two `[t=search-result]` (`data-title` "Quarterly plan" and "Review", title match first), each `[t=search-snippet]` containing a `mark` whose lowercased text is "quarterly" (for "Quarterly plan" the snippet shows its body "Goals."). Press Escape: `[t=search-input]` is empty and `[t=note-list]` is visible with three items.
17. (SC8) Type "REVIEW" in search: results include "Review". Click that `[t=search-result] a`: URL path `/n/Review`, `[t=note-title]` "Review". Type "zzqx" in search: `[t=search-empty]` text `No notes match "zzqx"`, zero `[t=search-result]`. Click `[t=search-clear]`: input empty, list back. Press Ctrl+K with focus on the body: `[t=search-input]` is focused.
18. (SC8, performance) Before starting the server, generate 5,000 notes (`Note 0001.md` ...) of about 2 KB each (about 10 MB), with "quarterly" in the body of exactly three of them. Start the server, open the app, wait for the list. Focus `[t=search-input]`, take `t0 = performance.now()` immediately after typing the last character of "quarterly" (key delay 20 ms), wait for `[t=search-result]` count 3, take `t1`. Repeat three times with different case ("Quarterly", "QUARTERLY"); the median of `t1 - t0` must be under 500 ms.
19. (SC9) Vault of four notes: `A.md` = `[[B]] [[C]] [[A]]`, `B.md` = `[[a]]`, `C.md` = `leaf`, `D.md` = `alone`. Open `/graph?note=A`. Expect `[t=graph-svg]` with `data-ready="true"`, 4 `[t=graph-node]`, 2 `[t=graph-edge]` (pairs A-B and A-C only, no self edge, one edge for the mutual A-B links), `[t=graph-summary]` "4 notes, 2 links". `[t=graph-node][data-title="A"]` has `data-current="true"` and the others `"false"`. `[data-title="D"]` has `data-orphan="true"` and is within the svg bounds.
20. (SC9) Click `[t=graph-node][data-title="C"]`: URL path `/n/C`, `[t=note-title]` "C". Click `[t=graph-link]` in the sidebar: URL is `/graph?note=C` and node C is current. Focus node B with Tab (or `.focus()`), press Enter: URL path `/n/B`. With an empty vault `/graph` shows `[t=graph-empty]` "No notes to graph yet.".
21. (SC9, performance) Generate 1,000 notes `N0001`..`N1000`, each linking to two other random notes with `[[...]]`. Start the server. Record `t0` at `page.goto("/graph")` start, wait for `[t=graph-svg][data-ready="true"]`, take `t1`: under 3000 ms. Expect 1,000 `[t=graph-node]`, at least 1,000 `[t=graph-edge]`, no console errors. Click a node: the note opens.
22. (SC10) With the server running and Welcome-like notes present, copy `Imported.md` (body `Imported links to [[Welcome]].`) into the vault, and also `sub/Hidden.md` and `notes.txt`. Reload. Expect `[t=note-list-item][data-title="Imported"]` visible and no item named "Hidden" or "notes". Open "Imported": the `[t=wikilink]` has `data-state="exists"`. Open "Welcome": `[t=backlink-item][data-title="Imported"]` exists. Edit "Other" and save: it moves to the top of `[t=note-list]` (newest modified first).
23. (SC10) Open "Imported", click `[t=delete-button]`. Expect `[t=delete-dialog]` containing `Delete "Imported"?` and "Imported.md", focus on `[t=delete-cancel]`. Click Cancel: file still exists. Click `[t=delete-button]` then `[t=delete-confirm]`: URL path `/`, `[t=status-live]` contains `Deleted "Imported"`, no `[t=note-list-item][data-title="Imported"]`. On disk only `Imported.md` is gone; every other `.md` file (and `sub/Hidden.md`, `notes.txt`) still exists with the same bytes. Open "Welcome": nothing links to Imported, but add `[[Imported]]` in the editor: the preview link is `data-state="missing"`.
24. (Unsaved guard, brief decision 5) Open "Welcome", type "x" in `[t=editor]`. Expect `[t=save-status]` "Unsaved changes". Click another `[t=note-list-item] a`: `[t=leave-dialog]` visible, `[t=leave-stay]` focused, URL unchanged. Click `[t=leave-stay]`: dialog closed, editor focus restored with the text kept. Click the other item again and `[t=leave-discard]`: the other note opens, and reopening "Welcome" shows the original text.
25. (States) Use `page.route` to abort `**/api/notes` on first load. Expect `[t=app-error]` with "Could not reach the wiki server. Check that it is still running, then try again." Remove the route, click `[t=app-retry]`: `[t=note-list]` appears. Open a note, abort `PUT`/`POST` save requests, edit, press Control+S: `[t=save-error]` "Could not save. Your text is still here. Check that the server is running, then try again.", editor value unchanged, `[t=save-button]` enabled. Remove the route and save again: "Saved" and `[t=save-error]` gone.
26. (Desktop layout and keyboard) At 1280 x 800 open a note: `[t=note-list]` bounding box left is less than `[t=note-view]` left and their tops match within 40 px; `[t=editor]` and `[t=preview]` are side by side (preview left > editor left, same top); `[t=tab-edit]` is not visible. The first Tab press focuses `[t=skip-link]`. Open `[t=new-note-dialog]` with the button, press Escape: dialog closed and focus on `[t=new-note-button]`.
27. (Phone layout, SC1/SC5) Viewport 390 x 844. Vault has a note titled with 200 "W" characters, a note whose body has a 5,000-character unbroken line, and "Welcome". Open `/`: `[t=note-list]` visible, `[t=note-view]` not present, `[t=back-to-list]` not visible, `document.documentElement.scrollWidth <= 390`. Open the long-body note: `[t=note-view]` visible, `[t=note-list]` hidden, `[t=back-to-list]` "Notes" visible, `[t=tab-edit]` and `[t=tab-preview]` visible with only one of editor and preview visible; click `[t=tab-preview]` then `[t=tab-edit]` to swap; `scrollWidth <= 390`. `[t=save-button]`, `[t=rename-button]`, `[t=delete-button]`, `[t=new-note-button]`, `[t=back-to-list]` and each `[t=note-list-item]` have a bounding box height of at least 44 px. Click `[t=back-to-list]`: the list shows again. Create a note via the phone dialog, type text, save, reload: the text persists (SC1 on phone).
28. (A11y, graph) Vault as in check 19, open `/graph?note=A`. Expect `[t=graph-svg]` has `role="group"` (not `img`) and an `aria-label`; `[t=graph-node]` count 4, each with an accessible name starting "Open note". `[t=graph-list-item]` count 4; the item for "A" contains a link and the text "Links to B, C"; the one for "D" contains "No links". Click the link in the "C" item: URL path `/n/C`. With a viewport of 390 x 844, node hit area is at least 48 px across.
29. (A11y, live regions and focus) Open "Welcome" and save: `[t=status-live]` text "Saved" and `[t=save-status]` is not inside any live region. Type "quarterly" in search: `[t=search-status]` has role status and `[t=status-live]` text does not contain "match". Trigger the conflict of check 13: `[t=conflict-banner]` has role alert and focus stays in `[t=editor]`. Open `[t=delete-dialog]` and press Escape: focus returns to `[t=delete-button]`. Click a list item: `[t=note-title]` is focused and `document.title` ends with " - Wiki". Run an axe scan (`@axe-core/playwright`, tags wcag2a, wcag2aa, wcag22aa) on `/`, a note, `/graph`, and each open dialog: zero violations. `document.documentElement.lang` is "en".
30. (A11y, contrast, size, motion) With `colorScheme` light then dark, assert computed contrast: body text 4.5:1 or better, `[t=save-status]`, muted note-list meta text 4.5:1, focus ring (focus `[t=search-input]`, read outline colour and width) 3:1 against the background and at least 2 px wide, `[t=graph-node][data-orphan="true"]` stroke 3:1. At 1280 x 800 each `button` and `[t=note-list-item] a` has a bounding box at least 24 x 24 px. With `reducedMotion: "reduce"`, open `/graph` and read all `[t=graph-node]` positions twice 1 s apart after `data-ready="true"`: identical; computed `transition-duration` of `main` and `dialog` is `0s`.
31. (A11y, phone, reflow, keyboard) At 320 x 640 open a note with the 5,000-character line: `document.documentElement.scrollWidth <= 320`. At 390 x 844 focus `[t=tab-edit]`, press ArrowRight: `[t=tab-preview]` has `aria-selected="true"` and is focused, and `[t=tab-edit]` has `tabindex="-1"`. At 1280 x 800 press Tab from the page start through the sidebar and main until `[t=editor]`: the order follows the Keyboard rule, no `[t=tab-edit]` is reached, and no focused element is covered by another (its bounding box is inside the viewport and is the `document.elementFromPoint` of its centre).

Coverage map (each success criterion to its journey and checks)

| SC | Journey | Checks |
|---|---|---|
| SC1 | J1, J13 | 1, 2, 3, 27 |
| SC2 | J2 | 4, 5 |
| SC3 | J3 | 6 |
| SC4 | J4 | 7, 8 |
| SC5 | J5 | 9, 10, 11, 27 |
| SC6 | J6 | 12 |
| SC7 | J7 | 13, 14, 15 |
| SC8 | J8 | 16, 17, 18 |
| SC9 | J9 | 19, 20, 21 |
| SC10 | J10, J12 | 22, 23 |
| Decision 5 | J11 | 24 |
| States, layout | all | 25, 26, 27 |
| Accessibility (WCAG 2.2 AA) | all | 28, 29, 30, 31 |

## Addendum from design.md (decided by the orchestrator; design.md section 10 wins on conflict)
- New error copy: `title_too_long_bytes` "This title is too long for a file name. Shorten it."; `title_char` "A title cannot contain : * ? \" < > | [ ] or #."; `title_trailing_dot` "A title cannot end with a dot." Messages for all title rules are listed in design.md section 2 and are shared by client and server through `public/js/titles.js`.
- Markdown headings render one level lower (`#` is an h2) so each page keeps one h1.
- Relative Markdown links render as `unsafe-link` text, like `javascript:` links.
- A case-only rename is allowed and goes to the server. Delete sends no revision. The "Too long" count is code points after NFC and trim.
- Graph `data-ready` is set after 60 iterations or 1 s; tests must not assert final node positions.
