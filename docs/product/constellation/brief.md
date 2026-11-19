# Brief: constellation

## Problem and user

Constellation is a new take on the existing Markdown wiki (`examples/wiki`). Each note is a star in a night sky, and the links between notes form constellations. You move around by panning, zooming and "flying to" a note. Writing a new note lights a new star. Under the sky it is still a real tool: plain `<Title>.md` files in a vault the user owns, `[[wikilinks]]`, backlinks, renaming that rewrites links, search, saves that never overwrite someone else's change, and a server that only listens on loopback.

- **Note-taker who wants to wander** (a writer, student or researcher with tens to thousands of notes): they want to see their knowledge as a place, find forgotten notes by chance, and enjoy coming back. They do not want to give up plain files, git, or a fast keyboard path.

The job: "capture and link a thought in seconds, and rediscover old ideas by exploring rather than only by searching."

Constraints: Node >=22, zero npm dependencies, `node src/server.js`, `node:test`, vanilla browser JS, no build step, CSP-safe (no inline script or style), loopback only. The sky is drawn with Canvas 2D. WebGL is not justified because 5,000 points plus edges fit in 2D if we batch draws and cull off-screen items. A keyboard and screen-reader path that does not need the sky is required. `prefers-reduced-motion` is respected. Targets: 60 fps at 1,000 notes and usable at 5,000.

Repository check: `examples/wiki` already has the whole vault core: title rules, atomic writes, revision hashes, rename rewrite, an in-memory index, substring search, Host/Origin checks and CSP. Its graph is a plain force layout that is not stable between visits. Its acceptance suite and README limits are proven: 305 tests and 5,000-note search at 62-156 ms.

## Existing products (from knowledge, not re-fetched)

| Product | Does well | Gets wrong (for this job) | Source |
|---|---|---|---|
| Obsidian graph view | Live link graph over plain Markdown, filters, local graph | The graph is a utility panel, not a place: force layout reshuffles every time, it is unreadable at thousands of nodes, and it has no sense of age or discovery. Closed source. | https://obsidian.md |
| Kinopio | Joyful spatial cards, colour, playful motion | Cloud account, its own data format rather than `.md` files, and you place cards by hand (no derived layout) | https://kinopio.club |
| InfraNodus | Network analysis of text, topic clusters, gap detection | Analytics tool, mostly SaaS, focused on text and not on a personal vault you edit | https://infranodus.com |
| Roam Research | Bidirectional links, block references | Cloud, paid, outliner data model, its graph is rarely useful | https://roamresearch.com |
| Logseq | Open source, local files, graph | Every line becomes an outline block, the graph is static, and a heavy Electron stack | https://github.com/logseq/logseq |
| Star map toys (Stellarium web, "your tweets as stars") | Wonder, a sense of depth, a calm palette | Not tools: no editing, no files, no links you write yourself | https://stellarium-web.org |

## Decision (build/adopt/extend and why)

**Extend the wiki core and replace its UI.** Copy `examples/wiki/src/` and `public/js/{titles,wikilink}.js` into `examples/constellation` so the product stands alone. Keep the wiki's vault, security, rename, search and conflict behaviour and its acceptance rules unchanged, then add a sky API (stable positions, brightness, clusters) and a new browser UI. None of the products above combines a beautiful, stable sky with plain-file ownership. Rebuilding the core would only add risk to code that is already tested.

## MVP scope (in / out / later)

**In**
- Everything in the wiki MVP, kept as it is: create, edit, save, delete, safe preview, wikilinks, backlinks, rename with rewrite, search, conflict detection, title validation, loopback only, Host/Origin checks, CSP.
- **Stable sky.** Each star's position comes from a hash of its normalised title, refined by a fixed number of seeded layout passes. The same vault always gives the same sky, and adding one note moves its neighbours only slightly.
- **Brightness** comes from recency (file modified time) and backlink count, shown through both size and glow.
- **Constellations.** Link clusters (connected components, plus label propagation when a component is large) are drawn as faint lines with a name near the centre. The name is the title of the brightest member.
- **Unlit stars.** A `[[link]]` to a missing note appears as a dim hollow star. Clicking it creates the note, and the star then lights up.
- **Navigation.** Pan and zoom with mouse, trackpad, keyboard and touch (pinch and drag). "Fly to" search animates to a star. A "Random star" button. Hovering or focusing a star shows its title.
- **Seeded first run.** An empty vault gets a 5-note sample constellation ("Start here" and four linked notes) and a banner with "Remove sample notes".
- **List view.** A first-class list of all notes, plus search, backlinks and the editor, all usable with no canvas. Screen readers and keyboard users land on this path.
- Reduced motion: no flight animation, twinkle or drift. Moves jump instantly.

**Out (non-goals)**: ambient sound, WebGL/3D, accounts, sync, plugins, subfolders, attachments, tags, WYSIWYG, letting users place stars by hand, themes, sharing or publishing the sky, mobile app, non-loopback hosting.

**Later**: a time-lapse of the sky growing (from git history), user-named constellations, star colours from front-matter, a minimap, a persisted layout cache.

## Success criteria (testable, user-visible)

SC1. **First 30 seconds.** `node src/server.js` with an empty vault prints a local address. Opening it shows a dark sky with a 5-star sample constellation fading in (within 2 s) and a "Start here" star focused. Clicking "New star", typing a title and saving shows a new star lighting up (it grows from 0 to full brightness) in the sky, and `vault/<Title>.md` exists. "Remove sample notes" deletes only those 5 files, and the sky is left with the user's star.

SC2. **Stable sky.** Reloading the page, or restarting the server, puts every star in the same screen position (within 1 px at the same zoom). Adding one unlinked note moves no existing star by more than 2% of the view width.

SC3. **Links and unlit stars.** Typing `[[Ideas]]` (missing) and saving adds a dim, hollow "unlit" star joined by a dashed line. Its tooltip says "Not written yet". Clicking it creates and opens "Ideas", and the star becomes solid and bright.

SC4. **Brightness and constellations.** A note with 10 backlinks is drawn visibly larger and brighter than an orphan created the same day. Two separate link clusters are drawn as two constellations, each labelled with its brightest member's title.

SC5. **Rename.** Renaming "Ideas" to "Project ideas" keeps the star in the same place, updates its label, and rewrites `[[Ideas]]` in linking notes, in both the source and the file. Renaming to an existing title (in any case) shows the wiki's refusal message and changes nothing.

SC6. **Hostile titles and content.** Titles such as `../escape`, `a/b`, `.hidden`, `<img src=x onerror=alert(1)>` and a 200-character title are refused or shown literally. Labels on the canvas and in the list show the raw text, and no script runs. The CSP header has no `unsafe-inline`.

SC7. **Conflict.** The same note open in two tabs: A saves, then B saves. B sees "This note changed since you opened it" with "Copy my text" and "Reload note", and the file keeps A's text.

SC8. **Fly to and random.** Pressing Ctrl+K and typing part of a title lists matches. Pressing Enter flies the camera to that star (in under 1.2 s) and opens it. "Random star" flies to a different note on each of 5 presses when the vault has 5 or more notes.

SC9. **Performance.** With 1,000 generated notes, continuous panning averages at least 55 fps (measured with `requestAnimationFrame` timing) on an ordinary laptop. With 5,000 notes and about 10,000 links, the sky is interactive within 3 s, panning stays at 30 fps or more, and search results appear within 500 ms.

SC10. **No-sky path.** Using only the keyboard, a user can reach "Skip to list" first. From there they can create, open, edit, save, rename and search notes and read backlinks without touching the canvas. The canvas has a text alternative ("Sky of N notes, M constellations"). Axe reports no serious or critical issues.

SC11. **Reduced motion.** With `prefers-reduced-motion: reduce`, nothing twinkles or drifts. "Fly to" and "Random star" jump the view instantly. New stars appear at full brightness with no animation.

SC12. **Phone touch.** On a 390x844 touch viewport, a one-finger drag pans, a pinch zooms around the pinch point, tapping a star opens its card, and the list view and editor fit with no horizontal scroll.

## Design bar (testable observations)

- **Memorable detail.** When a note is saved for the first time, its star is "lit": a single soft ring expands once (about 600 ms) and its constellation lines draw toward it. This happens only when motion is allowed.
- **Motion principles.** The camera eases (no linear moves), never overshoots, and finishes in 1.2 s or less. Input always cancels animation at once. Idle twinkle changes star brightness by no more than ±15% and is staggered so no two neighbours pulse together.
- **Depth.** A faint background star field moves at 0.3x the pan speed (parallax). It is decoration only and never clickable.
- **Typography.** One humanist sans for the UI and a monospace font for the editor, both system fonts (no web-font fetch). Constellation names are small caps with letter-spacing. Star labels appear only above a zoom threshold or on hover/focus, so labels never overlap at default zoom (a screenshot check finds no overlapping label boxes).
- **Colour.** A near-black blue sky (not #000), warm white for recent stars that cools toward blue for old ones, and a single accent colour for focus. All text meets WCAG AA contrast against the sky, and focus rings are visible on both the canvas and the list.
- **Calm.** At rest with 1,000 notes, the screen shows no more than about 40 labels, and the editor panel never covers the focused star.

## Risks

- **Layout cost at 5,000 notes.** Run the seeded layout on the server, cache it in memory, and send it with the graph. The browser only culls and draws.
- **Instability.** Hash-seeded positions plus a fixed number of passes keep the sky deterministic. Unit tests assert identical output for identical input.
- **Beauty versus usefulness.** Without the list path, the product is a toy. SC10 is a release blocker.
- **Canvas text and XSS.** `fillText` is safe, but tooltips and cards must use `textContent`. SC6 covers this.
- **Drifting from the wiki core.** The copied code keeps its acceptance tests as they are. New behaviour is added beside it, not by editing it.

## Open questions with defaults

1. Port and lock name? **Port 3000 and `.constellation.lock`**, so a wiki and a constellation can share neither the port nor the vault by accident.
2. Are sample notes marked? **Yes, by `sample: true` front-matter.** "Remove sample notes" deletes only unedited notes that carry the marker.
3. Recency window for brightness? **Brightness decays over 90 days and never goes below 30%.**
4. Can users drag stars? **No.** Positions are derived. Manual placement is out of scope.
5. Do unlit stars count toward 5,000? **No, and they are capped at 2,000 drawn.**
6. **Needs a human**: none. There is no spend, legal question or personal data. Exposing it beyond loopback would need a human decision and a security review.
