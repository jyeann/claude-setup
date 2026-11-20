# UX: packing-list

Plain HTML, CSS and JS served by Node. English only. Source: `brief.md` (success criteria SC1 to SC10).

## Conventions

- Routes: `/` home; `/l/<id>` list page (`<id>` is the unguessable token, URL-safe characters only); anything else returns HTTP 404 with the not-found page. A well-formed but unknown `/l/<id>` also gives 404 with the not-found page.
- Each page has `<html lang="en">`, one `<h1>`, a `<main id="main">`, and the page `<title>`: Home `Packing list`, list `<trip name> - Packing list`, not found `List not found - Packing list`.
- Selectors: prefer roles and accessible names; ids are given where a role is not enough.
- Polling interval is 2 seconds, so other people's changes show within 5 seconds.
- Config only the restart journey needs: the data file path comes from the environment variable DATA_FILE and the port from PORT.

## Journeys

### J1. Start the app (SC1)
1. Person runs the one documented command. The terminal prints a local address such as `Packing list running at http://localhost:3000`.
2. They open it. The page shows h1 "Packing list", a one-line explainer "Make a list, share the link, tick things off together.", and a form headed "New packing list" with a field labelled "Trip name" and a button "Create list".
3. No sign-in, account, cookie banner or name prompt is anywhere on the page.

### J2. Create a list (SC2)
1. On `/`, type "Lisbon weekend" in "Trip name" and press "Create list" (or Enter).
2. Browser goes to `/l/<id>`. h1 reads "Lisbon weekend". The page shows the text "No items yet", the progress text "0 of 0 packed", and the share link as the full absolute URL in a read-only field labelled "Share link" next to a "Copy" button. Below it: "Anyone with this link can edit."
3. Pressing "Copy" changes the button text to "Copied" for 2 seconds and the status region says "Link copied".
4. Focus lands on the h1 (tabindex -1) after creation.

### J3. Refuse a bad trip name (SC3)
1. On `/`, submit with the field empty, or only spaces: the error "Enter a trip name." appears under the field. URL stays `/`. No list is created.
2. Type 81 characters and submit: the error "Trip name is too long (81 characters). The limit is 80." appears. URL stays `/`. The typed text is kept.
3. Focus returns to the "Trip name" field after each error. The error is announced (role alert).

### J4. Add items and limits (SC4)
1. On a list page type "Passport" in "New item" and press "Add". "Passport" appears at once in the list, unticked. Progress reads "0 of 1 packed". The input is cleared and focus is in it.
2. Empty or whitespace-only item: message "Enter an item to add." Nothing is added.
3. Item of 121 characters: message "Item is too long (121 characters). The limit is 120." Nothing is added, the text is kept.
4. When the list already has 200 items, "Add" shows "This list is full (200 items)". Nothing is added.

### J5. Tick and untick (SC5)
1. Tick the checkbox named "Passport". It is checked; progress reads "1 of 1 packed"; the bar is full.
2. Untick it: unchecked; "0 of 1 packed".
3. Tick it again and reload. The checkbox is still checked and progress still reads "1 of 1 packed".

### J6. Two browsers stay in sync (SC6)
1. A second browser context opens the same share link. It shows the same trip name, items and tick states.
2. In the first browser add "Charger". Within 5 seconds, with no reload, the second shows "Charger" unticked and updated progress.
3. In the first browser tick "Passport", then untick it. Within 5 seconds the second shows the same state each time.

### J7. Remove an item (SC7)
1. With "Passport" ticked and "Charger" unticked, in browser one press "Remove" on "Charger". It disappears at once and progress reads "1 of 1 packed".
2. Within 5 seconds the second browser no longer shows "Charger" and its progress matches.
3. After removal, focus moves to the "New item" input.

### J8. Markup shows literally (SC8)
1. Create a list named `<b>hi</b>`. The h1 text is exactly `<b>hi</b>` and there is no `b` element inside it.
2. On a list, add the item `<b>hi</b>`. The list shows the literal text `<b>hi</b>`, not bold, and no `b` element exists in the list.
3. The same literal text shows in the second browser and after reload.

### J9. List survives a restart (SC9)
1. Start the app with DATA_FILE set to a file and PORT set. Create "Lisbon weekend", add "Passport" and "Charger", tick "Passport".
2. Stop the server. Start it again with the same DATA_FILE and PORT.
3. Open the same `/l/<id>`. h1 "Lisbon weekend", "Passport" checked, "Charger" unchecked, progress "1 of 2 packed".

### J10. Wrong link and first use (SC10)
1. Open `/l/` followed by a mistyped id. The page shows h1 "List not found", the text "That link does not match any list. Check it for typos.", and a link "Create a new list" to `/`. HTTP status is 404.
2. Following "Create a new list" shows the "New packing list" form.
3. First use end to end: from a fresh start one person creates a list, adds 5 items, opens the share link in a second browser, ticks all 5 in either browser, and both show "5 of 5 packed" within 5 seconds. No step needs documentation beyond the visible labels.

## Screens and states

### Home `/`
- Regions: h1 "Packing list", explainer, form "New packing list" (`form` named "New packing list").
- Controls: textbox "Trip name" (`#trip-name`, maxlength not set so the over-limit error can show), button "Create list".
- States: default; submitting (button text "Creating...", disabled); error (`#trip-name-error`, role alert, linked with aria-describedby, field aria-invalid true); network failure shows "Could not create the list. Check that the app is running and try again." in the same alert region.
- Hostile content: very long text is accepted for typing and refused by the 80 limit with the error above.

### List page `/l/<id>`
- Regions in order: h1 trip name (`#list-title`, `overflow-wrap: anywhere`); share section with read-only textbox "Share link" (`#share-link`), button "Copy", note "Anyone with this link can edit."; progress (`#progress` text "N of M packed" plus `role="progressbar"` named "Packing progress" with aria-valuenow N, aria-valuemin 0, aria-valuemax M); add form with textbox "New item" (`#new-item`) and button "Add"; error area (`#form-error`, role alert); list (`ul#items`, aria-label "Items").
- Each item (`li`): checkbox whose accessible name is the item text, and a button named "Remove <item text>" (visible text "Remove").
- States:
  - Empty: `#empty` text "No items yet" shown when M is 0; hidden otherwise. Progress "0 of 0 packed".
  - Loaded: items in the order added.
  - Full: at 200 items, Add shows "This list is full (200 items)" in `#form-error`.
  - Error: validation messages in `#form-error`; text is kept.
  - Connection lost (poll or save fails): `#status` shows "Connection lost. Trying again..." and clears on the next success. Failed tick reverts and shows "Could not save that change. Try again."
  - Long text: items wrap, never widen the page.
  - Markup: always inserted as text, never as HTML.
- `#status` is a polite live region (`role="status"`) present in the DOM and empty at page load, so later text is announced, for "Link copied", "Could not save that change. Try again." and connection messages.

### Not found (any unknown path, HTTP 404)
- h1 "List not found", explanatory text, link "Create a new list" to `/`.

## Copy

| Where | Exact text |
|---|---|
| Home h1 and title | Packing list |
| Home explainer | Make a list, share the link, tick things off together. |
| Home form heading | New packing list |
| Trip name label | Trip name |
| Create button | Create list |
| Create button busy | Creating... |
| Empty trip name error | Enter a trip name. |
| Long trip name error | Trip name is too long (N characters). The limit is 80. |
| Create network error | Could not create the list. Check that the app is running and try again. |
| Share link label | Share link |
| Copy button | Copy |
| Copy button after press | Copied |
| Copy status | Link copied |
| Share note | Anyone with this link can edit. |
| Empty state | No items yet |
| Progress text | N of M packed |
| Progress bar name | Packing progress |
| Item input label | New item |
| Add button | Add |
| Remove button | Remove (accessible name "Remove <item text>") |
| Empty item error | Enter an item to add. |
| Long item error | Item is too long (N characters). The limit is 120. |
| Full list error | This list is full (200 items) |
| Items list name | Items |
| Save failure | Could not save that change. Try again. |
| Connection lost | Connection lost. Trying again... |
| Not found h1 | List not found |
| Not found text | That link does not match any list. Check it for typos. |
| Not found link | Create a new list |
| Skip link | Skip to main content |

## Accessibility and responsive rules

- Every input has a visible `<label>`. "New item" and "Trip name" are the accessible names. Errors are linked with aria-describedby and the field gets aria-invalid (on the list page `#new-item` points to `#form-error`; both are cleared when the next input is valid).
- Errors appear in elements with role alert. Progress text is in a polite live region (`aria-live="polite"`) so changes from other people are announced; polling must not move focus or reset a half-typed item.
- Focus: after a failed submit, focus returns to the field; after Add, focus stays in or returns to `#new-item`; after Remove, focus goes to `#new-item`; after create, focus goes to the h1.
- Keyboard: Tab order is skip link, share link, Copy, New item, Add, then each item checkbox and its Remove button. Enter submits forms, Space toggles checkboxes, Enter or Space presses buttons. Visible focus outline on every control, at least 2px thick, 3:1 contrast against adjacent colours, never clipped or hidden under sticky content. The skip link is the first Tab stop, becomes visible on focus, and moves focus to `#main` (tabindex -1). Busy buttons use aria-disabled instead of the disabled attribute so focus is not lost.
- Target size: buttons and checkboxes at least 44 by 44 CSS pixels (checkbox hit area included through its label row).
- Zoom and text spacing: layout works at 200% text zoom and with increased line, letter and word spacing without clipped or overlapping text; no fixed heights on text containers.
- Responsive: layout is a single column; at 320px wide there is no horizontal scrollbar (document scrollWidth not greater than the viewport width), including with a 120-character unbroken item and an 80-character unbroken trip name. Base font size at least 16px so mobile browsers do not zoom on focus.
- Contrast: text 4.5:1 or better against its background in light and dark (`prefers-color-scheme`). Borders of inputs and buttons, the progress bar fill and track, and the focus outline are 3:1 or better. State is never shown by colour alone: checked items also use a checkbox and strikethrough; errors also carry message text (no colour-only red border).
- Reduced motion: no animation required; the bar does not animate under `prefers-reduced-motion`.

## UI acceptance checks

| Id | Check |
|---|---|
| UC1 | On `/` the page has no password field, no link or button named "Sign in", and has a form with textbox "Trip name" and button "Create list". |
| UC2 | At 320px viewport width the list page, loaded with a 120-character unbroken item, has `document.documentElement.scrollWidth` less than or equal to `clientWidth`. |
| UC3 | On a list page the textbox has accessible name "New item" (`getByRole('textbox', {name: 'New item'})`). |
| UC4 | Submitting an empty trip name shows "Enter a trip name." inside an element with role alert, and the URL is still `/`. |
| UC5 | After pressing "Add" with a valid item, `document.activeElement` is `#new-item`. |
| UC6 | After creating a list the page URL matches `/l/<id>` where `<id>` has at least 22 URL-safe characters, and the "Share link" field value equals the page URL. |
| UC7 | An unknown path `/l/nope` returns status 404, shows heading "List not found", and the link "Create a new list" has href `/`. |
| UC8 | With 200 items present, pressing "Add" shows "This list is full (200 items)" in a role alert element and the item count stays 200. |
| UC9 | Progress element with role progressbar named "Packing progress" has aria-valuenow 1 and aria-valuemax 2 after ticking one of two items, and the text "1 of 2 packed" is visible. |
| UC10 | Adding an item of 121 characters shows "Item is too long (121 characters). The limit is 120." in a role alert element and the item count is unchanged. |
| UC11 | Every item has a checkbox named by its text and a button named "Remove <text>"; pressing Remove on "Charger" removes it from `ul#items`. |
| UC12 | The item `<b>hi</b>` renders as text equal to `<b>hi</b>` and `ul#items b` matches zero elements. |
| UC13 | Pressing "Copy" changes the button text to "Copied", then back to "Copy" within 3 seconds, and `#status` contains "Link copied". |
| UC14 | Every page (`/`, a list page, a 404 page) has `document.documentElement.lang` equal to `en`, and `#status` on a list page has role status. |
| UC15 | On a list page at 320px width with one item, every button and checkbox has a bounding box at least 44 by 44 CSS pixels, and the first Tab stop is the link "Skip to main content". |

## Decisions made without a human

- List URL shape is `/l/<id>`; unknown ids return a real 404 so tests can check status.
- Error wording for limits includes the actual count and the limit, as in the retro-board reference.
- Remove has no confirmation step (undo is re-adding), to keep the MVP small.
- Items keep the order added; ticked items do not move.
- Trip name input has no maxlength attribute so the 80-character error is reachable and testable.
- Polling every 2 seconds never moves focus or clears typed text.
- Focus after Remove goes to the "New item" input because the removed row no longer exists.
- Optimistic updates revert with "Could not save that change. Try again." when the save fails.

## Accessibility review

Checked against WCAG 2.2 AA: labels and names, error identification, status messages, focus order and appearance, target size, reflow, contrast, motion, language.

Changed:
- Added `lang="en"` requirement on every page (3.1.1) and UC14.
- Linked `#new-item` to `#form-error` with aria-invalid (3.3.1).
- Focus outline: thickness, 3:1 contrast, not obscured (2.4.7, 2.4.11); skip link behaviour defined (2.4.1).
- Busy buttons use aria-disabled so focus is not lost.
- Added 200% zoom and text-spacing rule (1.4.4, 1.4.12).
- Added 3:1 non-text contrast for borders, bar and focus; errors not colour-only (1.4.11, 1.4.1).
- `#status` is role status, present empty at load, and also carries the save failure (4.1.3).
- Added UC15 for target size (2.5.8) and skip link.

Open: contrast ratios and the live-region announcement order need a manual screen reader pass once built; Playwright cannot verify them.
