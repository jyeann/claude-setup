# Brief: wiki

## Problem and user

A local-first Markdown wiki: the user's notes are plain `.md` files in one folder (the "vault"). The app opens in a browser, links notes with `[[wikilinks]]`, shows backlinks, searches every note, and draws a graph of the links.

- **Note-taker** (a developer, student or researcher who writes a lot in Markdown): wants to capture a thought in seconds, link it to what they already know, and find it again later. Their notes must stay ordinary files they can grep, back up with git, or open in any editor, with no account and no lock-in.

Constraints: Node >=22, zero npm dependencies, `node src/server.js` starts it, vanilla JS UI in `public/` with no build step, tests with `node:test`. There are no logins, no personal data and no money. One user on one machine.

Repository check: `examples/notes-api` stores notes behind a JSON API but has no Markdown files on disk, wikilinks, backlinks, search UI or graph. Nothing else in `examples/` or `docs/product/` does this job. Lesson carried over from the link-shortener retro: every criterion below describes what a person sees or does.

## Existing products (from knowledge, not re-fetched)

| Product | Does well | Gets wrong (for this job and these constraints) | Source |
|---|---|---|---|
| Obsidian | Plain-Markdown vault, `[[links]]`, backlinks, fast search, graph view. Renaming a note updates links. Huge plugin ecosystem. | Closed source Electron app. Sync and publish are paid. Commercial use once needed a licence. Cannot be embedded or changed. | https://obsidian.md |
| Logseq | Open source (AGPL), local Markdown, backlinks, graph, daily journals. | Outliner-first: every line is a block, so files fill with bullets and `id::` properties. The DB version moves away from plain files. Heavy ClojureScript/Electron stack. | https://github.com/logseq/logseq |
| Notion | Polished editor, databases, sharing. | Cloud only, account required, data lives on their servers. Markdown export is lossy. Not local-first. | https://www.notion.so |
| TiddlyWiki | One self-contained HTML file, runs anywhere, very hackable, long-lived. | Data lives in "tiddlers" inside one HTML file (or the Node edition's `.tid` format), not plain Markdown. WikiText syntax and unfamiliar concepts. | https://tiddlywiki.com |
| Dendron | VS Code extension, plain Markdown, hierarchical notes, rename refactoring. | Needs VS Code. Development stopped in 2023. Hierarchy (`a.b.c.md`) is opinionated. | https://github.com/dendronhq/dendron |

## Decision (build/adopt/extend and why)

**Build.** None of these can be run as one dependency-free Node process with a browser UI over a folder of plain `.md` files that the house stack can own, test and change. Someone who just wants a personal second brain today and accepts a closed-source desktop app should use Obsidian; this product's value is a small, inspectable, hackable one that keeps the same file format, so a vault works in both.

## MVP scope (in / out / later)

**In**
- Vault = one directory (default `./vault`, set by `VAULT_DIR`). One note = one `<title>.md` file at the vault root. Files edited outside the app are picked up on the next load or search.
- Note list (sorted by last modified), create note, open, edit Markdown in a textarea, save, delete (with confirmation), rendered preview.
- Safe Markdown rendering for a defined subset: headings, paragraphs, emphasis, lists, links, inline/fenced code, blockquotes. Raw HTML is shown as text.
- `[[Title]]` and `[[Title|label]]` links. Existing targets open the note; missing targets show distinctly and offer "create".
- Backlinks panel on every note, with a one-line context snippet.
- Rename a note: the file is renamed and every `[[Old]]`/`[[Old|label]]` in other notes is rewritten.
- Full-text search across titles and bodies, case-insensitive, with highlighted snippets.
- Graph view: notes as nodes, wikilinks as edges, click a node to open it. Simple force layout on a canvas or SVG, no library.
- Conflict detection: save sends the version it was based on; if the file changed since, the user is told and nothing is overwritten.
- Title validation: rejects path separators, `..`, control characters, reserved names, leading dots and over-long titles.

**Out**: accounts, sync, multi-user or real-time collaboration, plugins, folders/subdirectories, attachments and images upload, tags UI, WYSIWYG editor, embeds/transclusion, mobile app, publishing, encryption, hosting on the public internet.

**Later**: subfolders, daily notes, tags, `#heading` links, file-watcher live reload, a search index persisted to disk, export to static HTML, keyboard command palette, three-way merge on conflict.

## Success criteria (testable, user-visible)

SC1. **First use.** `node src/server.js` with no vault prints a local address and creates an empty vault folder. The page shows an empty-state "Create your first note" prompt and no sign-in. The user creates "Welcome", types text, saves, reloads, and sees the text; `vault/Welcome.md` exists with exactly that Markdown.

SC2. **Wikilinks and create-on-click.** In "Welcome", the text `[[Ideas]]` (no such note) renders as a visibly different "create" link. Clicking it creates and opens an empty "Ideas" note; back in "Welcome" the link now renders as a normal link that opens "Ideas". `[[Ideas|my ideas]]` shows the label "my ideas".

SC3. **Backlinks.** Opening "Ideas" shows a Backlinks panel listing "Welcome" with a snippet of the linking line. Removing the link from "Welcome" and saving removes it from the panel.

SC4. **Rename rewrites links.** Renaming "Ideas" to "Project ideas" renames the file, and "Welcome" now shows `[[Project ideas]]` (and `[[Project ideas|my ideas]]`) in both source and preview, with no broken link. Renaming to an existing title is refused with a visible message and nothing changes.

SC5. **Unsafe titles rejected.** Creating or renaming to `../escape`, `a/b`, `a\b`, `.hidden`, an empty or whitespace title, or a title over 200 characters shows an inline error, and no file appears outside or inside the vault. Requesting a note URL containing `..` or an encoded `%2e%2e%2f` shows "Note not found", never another file.

SC6. **Safe rendering.** A note containing `<script>alert(1)</script>` and `<img src=x onerror=alert(1)>` shows that text literally; no script runs and no image loads. `[link](javascript:alert(1))` is not clickable.

SC7. **Conflict detection.** The same note open in two tabs: tab A saves, then tab B saves its own change. Tab B sees "This note changed since you opened it" with options to reload or copy their text; tab A's content is still in the file. Editing the file in another editor and then saving from the app shows the same warning.

SC8. **Search.** Typing "quarterly" in search lists every note whose title or body contains it (any case), each with a highlighted snippet, and clicking a result opens the note. A query with no matches shows "No notes match". With a generated vault of 5,000 notes (about 10 MB) results appear within 500 ms of typing stopping on a typical laptop.

SC9. **Graph.** The Graph view shows one node per note and one edge per linked pair; the current note is highlighted and orphan notes still appear. Clicking a node opens that note. A 1,000-note vault renders an interactive graph within 3 seconds.

SC10. **Data ownership.** A `.md` file copied into the vault folder while the server runs appears in the note list after reload, its wikilinks and backlinks work, and deleting a note in the app (after confirming) removes only that file.

## Risks

- **Data loss** from a crash mid-write or a bad rename. Writes are atomic (temp file + rename); rename rewrites are done note by note and report any file they could not update.
- **Path traversal / unsafe filenames**: the main security surface; SC5 covers it and the `security-reviewer` agent must review the title-to-path code.
- **XSS** through a hand-rolled Markdown renderer; SC6 covers it. Render by escaping first, then adding allowed markup.
- **Case and Unicode titles**: `Ideas` vs `ideas` collide on macOS/Windows. Treat titles as case-insensitively unique and normalise to NFC.
- **Performance** of naive full scans on large vaults; an in-memory index rebuilt on change keeps SC8 achievable.
- **Scope creep** toward Obsidian parity; the Out list holds the line.

## Open questions with defaults

1. Who can reach the server? **Only 127.0.0.1.** No auth exists, so binding to other interfaces is out of scope.
2. Subfolders in the vault? **Ignored in the MVP**; only root-level `.md` files are notes.
3. Are wikilink targets case-sensitive? **No**; `[[ideas]]` resolves to `Ideas.md`, and rename rewrites all case variants.
4. Should rename rewrite links inside code blocks? **No**; links in fenced or inline code are left alone and not shown as links.
5. Autosave? **No**; explicit Save (and Ctrl+S), with an "unsaved changes" marker and a leave-page warning.
6. Delete: trash or permanent? **Permanent after a confirm dialog**; users who want history use git on the vault.
7. Markdown flavour? **CommonMark subset listed in scope**; tables and footnotes are later.
8. **Needs a human**: none. There is no spend, no legal question and no personal data; exposing it beyond localhost would need a human decision and a security review.
