# Brief: packing-list

## Problem and user

One person makes a packing list for a trip and shares one link. Everyone with the link (partner, kids, friends) ticks items off as they pack, and everyone sees what is still left.

- **Organiser**: wants to start a list in seconds, without signing up, and send one link to the group.
- **Packer**: opens the link on a phone or laptop, ticks what they packed, and sees what is still missing without asking anyone.

Constraints: plain JavaScript on Node (built-in `http`, built-in test runner), zero runtime dependencies, a small local web app with a browser UI, no accounts, started with one command.

Repository check: nothing in the repo does this today. `docs/product/retro-board/brief.md` is a sibling product used only as a reference for scale and format.

## Existing products (with sources)

A short look. No web search was run this session; these are well-known products, and the links are their public home pages.

| Product | Does well | Gets wrong (for this job and these constraints) | Source |
|---|---|---|---|
| PackPoint | Suggests items based on destination, weather and activities. | Mobile app, and you need an account or a paid tier to share. Not self-hosted. | https://www.packpnt.com |
| Google Keep shared checklist | Fast checklists that sync live. | Everyone needs a Google account, and data sits with Google. | https://keep.google.com |
| Todoist / Microsoft To Do shared lists | Solid sharing and sync. | Needs accounts and invites. Too heavy for a one-off trip. | https://todoist.com , https://to-do.office.com |
| Anonymous list sites (for example Listy-style "share by link" lists) | No accounts, share by link. | Hosted by third parties, often have ads, and none run locally with no dependencies. | (category, not one product) |

## Decision (build/adopt/extend and why)

**Build.** No product above runs locally with zero dependencies and no accounts, and the job is small enough that a tiny Node app covers it. A group that is fine with accounts and cloud storage should simply use a Google Keep shared checklist.

## MVP scope (in / out / later)

**In**
- A home page with a form to create a list by entering a trip name (1 to 80 characters).
- Each list gets one unguessable share link (random, at least 128 bits). Anyone with the link has full access.
- Anyone with the link can add an item (1 to 120 characters), remove an item, and tick or untick it.
- Progress shown as "N of M packed" plus a progress bar.
- Changes by other people appear within 5 seconds without a reload (polling).
- A Copy button for the share link.
- Lists survive a server restart (stored in a local JSON file, written atomically).
- A friendly "List not found" page for bad links.

**Limits a user sees**: trip name 1 to 80 characters; item text 1 to 120 characters; at most 200 items per list. Going over any limit shows a visible message and changes nothing.

**Out (non-goals)**: accounts or logins, separate owner/viewer links or permissions, who-ticked-what names, categories or sections, quantities, item editing, templates or suggested items, weather or trip dates, a list of all lists, deleting a whole list, offline mode, translations, public internet hosting.

**Later**: categories, edit item text, duplicate a list as a template, per-person assignment, list expiry.

## Success criteria

SC1. One documented command starts the app and prints a local address. Opening it shows a "New packing list" form with a trip name field and no sign-in anywhere.

SC2. Submitting the trip name "Lisbon weekend" opens the list page. It shows the heading "Lisbon weekend", an empty-state hint ("No items yet"), "0 of 0 packed", and the full share link with a Copy button.

SC3. Submitting an empty or whitespace-only trip name, or one longer than 80 characters, shows an inline error and no list is created.

SC4. Typing "Passport" and pressing Add shows "Passport" unticked in the list at once, and progress reads "0 of 1 packed". An empty item or one longer than 120 characters is refused with a visible message. When the list has 200 items, Add is refused with the message "This list is full (200 items)".

SC5. Ticking "Passport" shows it as checked and progress reads "1 of 1 packed"; unticking returns it to "0 of 1 packed". After a reload the tick state and progress are unchanged.

SC6. Opening the share link in a second browser shows the same trip name, items and tick states. A tick, untick, add or remove made in one browser appears in the other within 5 seconds without reloading.

SC7. Pressing Remove on an item removes it for every viewer within 5 seconds, and progress updates to match.

SC8. An item or trip name containing `<b>hi</b>` shows that text literally and is not rendered as bold.

SC9. After the server stops and the same command starts it again, the share link shows the same trip name, items and tick states.

SC10. A mistyped list link shows a "List not found" page with a link to create a new list. First-use journey: from a fresh start, one person in two browsers can create a list, add 5 items, share the link, and tick all 5 to see "5 of 5 packed" in both browsers, in under 3 minutes without reading docs.

## Risks

- **Leaked link**: anyone holding it can change the list. Links are unguessable; the page says "Anyone with this link can edit".
- **Simultaneous edits**: two people ticking the same item. Last write wins per item; ticks are set/unset operations, not toggles, so a repeat does no harm.
- **Injected markup** in names and items (SC8); the security reviewer checks rendering.
- **Corrupt or growing data file**: atomic writes, 200-item cap, request body size cap.

## Decisions made without a human

| Decision | Options | Chosen | Why |
|---|---|---|---|
| Build, adopt or extend | Adopt Keep/Todoist, extend an open-source app, build | Build | Nothing fits local + zero dependencies + no accounts. |
| Persistence | In-memory only, JSON file | JSON file, atomic write | A trip list is made days before packing; losing it on restart defeats the purpose. |
| Live updates | Manual refresh, polling, Server-Sent Events | Polling every 2 to 3 seconds (visible within 5 s) | Simplest with built-in `http`; enough for a handful of people. |
| Access model | One edit link, separate owner and tick-only links | One link, full edit | Matches the idea ("anyone with the link"); keeps the MVP small. |
| Who can remove items | Organiser only, anyone | Anyone with the link | No owner identity exists without a second link. |
| Item editing | Edit in place, remove and re-add | Remove and re-add | Fewer states to test. |
| Limits | Unbounded, capped | Name 80, item 120, 200 items | Keeps the file and page small; shown to users. |
| Concurrency | Toggle requests, explicit set state | Explicit set (ticked true/false) | Avoids double-toggle surprises between browsers. |
| Network reach | Localhost only, LAN | Localhost by default; a documented setting allows LAN | Safe default; the family on home Wi-Fi can still use it. |
| Needs a human | - | Public internet hosting only | Raises security and data-handling questions; out of scope. |
