# Wiki

A local-first Markdown wiki. Your notes are plain `.md` files in one folder on your machine.
The browser UI adds `[[wikilinks]]`, backlinks, rename that rewrites links, search and a graph view.
It runs as one Node process with no dependencies, no accounts and no network calls.

## Run it

Requires Node 22 or later. No install step is needed.

```sh
cd examples/wiki
npm start
```

`npm start` runs `node src/server.js`. When the server is listening it prints exactly one line:

```
Wiki running at http://localhost:3000
```

Open that address in your browser. Stop the server with Ctrl+C (or SIGTERM).

### Configuration

Set these as environment variables, for example `PORT=8080 VAULT_DIR=~/notes npm start`.

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | Port to listen on. `0` picks any free port (the ready line shows which). If the port is in use the server prints `Port N is in use, set PORT` and exits 1. |
| `HOST` | `127.0.0.1` | Address to bind. Only `127.0.0.1`, `::1` or `localhost` are accepted. Any other value prints `HOST must be a loopback address; exposing the wiki needs a security review` and exits 1. |
| `VAULT_DIR` | `./vault`, relative to the folder you start from | Folder that holds your notes. It is created if missing. `./vault` is git-ignored. |

Startup failures also exit 1: `Cannot write to VAULT_DIR <path>` when the folder is not writable, and `Another wiki server is using <vault>` when a live server already holds the vault.

## First five minutes

1. **Create a note.** Click "New note", type a title and save. The title becomes the file name: a note called `Ideas` is stored as `Ideas.md`.
2. **Link notes.** Type `[[Welcome]]` in a note. A link to a note that does not exist yet is shown as missing and is not drawn in the graph until the note exists.
3. **Use a label.** `[[Ideas|my ideas]]` shows "my ideas" but still links to `Ideas`.
4. **See backlinks.** Open `Welcome`. Its Backlinks list shows each note that links to it, with the line of the first such link.
5. **Rename.** Rename `Ideas` to `Plans`. Every link to `Ideas` in every note is rewritten to `Plans`, and links with a label keep their label. Links inside code are never changed. The result lists the notes that changed.
6. **Search.** Press Ctrl+K (Cmd+K on a Mac) and type. Search is a case-insensitive substring match on titles and bodies. Title matches come first.
7. **Graph.** Open "Graph" to see notes as nodes and links as edges. Notes with no links are marked as orphans.

Save is explicit: use the Save button or Ctrl+S. A note with unsaved changes shows "Unsaved changes" until you save.

## Your notes are plain files

- Each note is one file: `<Title>.md`, directly in `VAULT_DIR`. Subfolders are not supported.
- Edit them with any editor. Files that you add, change or delete from outside the app appear on the next list, search, graph, create or rename request. No restart is needed. Opening a note always reads the file from disk.
- Copy files into the folder and they appear. Files with other extensions (`notes.txt`, `X.MD`), dotfiles and symlinks are ignored.
- For history, run `git init` in the vault folder and commit when you like. The app does not manage git.

## Title rules

A title is trimmed and Unicode-normalised (NFC). It must:

- not be empty;
- be at most 200 characters, and at most 240 UTF-8 bytes (a file name limit);
- contain no control characters (U+0000 to U+001F, U+007F to U+009F, U+2028, U+2029);
- contain no `/` or `\`;
- not contain `..`;
- not start with a dot, or end with a dot;
- not contain any of `: * ? " < > | [ ] #`;
- not be a Windows device name (`CON`, `PRN`, `AUX`, `NUL`, `COM1`-`COM9`, `LPT1`-`LPT9`) before the first dot, in any case.

Titles are unique regardless of case: `Ideas` and `ideas` are the same note, so creating or renaming to a title that exists in any case is refused with `A note called "Ideas" already exists. Choose another title.`

## Conflicts

The app never overwrites a change it has not seen. Each saved revision is a hash of the file bytes. When you save, the app sends the revision it opened. If the file has changed since then (in the app or in another program), the save is refused, the file is left as it is, and a banner says "This note changed since you opened it." Use "Copy my text" to keep your edits, then "Reload note" to get the current version. Then paste your text back in if you still want it.

## Safety

- **Loopback only.** The server binds to `127.0.0.1` by default and refuses any other `HOST`.
- **Host and Origin checks.** Every request's `Host` must be `localhost:<port>`, `127.0.0.1:<port>` or `[::1]:<port>`, or it gets 403 `bad_host`. Changing requests (POST, PUT, DELETE) with a foreign `Origin` or `Sec-Fetch-Site: cross-site` get 403 `bad_origin`. No CORS headers are sent.
- **No accounts, no network calls.** The server only reads and writes `VAULT_DIR` and serves `public/`. The browser code only calls `/api/*` on the same server.
- **Rendering never runs HTML.** Note text is shown as text. The Content-Security-Policy allows scripts and styles only from the app itself.
- **Security headers** on every response: CSP, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`, and same-origin opener and resource policies.
- Requests cannot reach files outside `public/` or the vault. Path-traversal URLs return 404.

## Limits

| Limit | Value |
|---|---|
| Note size | 2 MiB (2,097,152 bytes). Larger content is refused with 413 `note_too_large`. Request bodies over 2 MiB + 1 KiB get 413 `too_large`. |
| Indexing | Files over 8 MiB are listed but never searched or linked. |
| Designed for | 5,000 notes |
| Title | 200 characters, 240 bytes |
| Search query | 200 characters |

Measured (from `docs/product/wiki/qa.md` and `docs/product/wiki/reviews.md`, 5,000 notes unless stated):

- Search: median 156 ms in the browser walkthrough and 62 ms in the performance review (target 500 ms). Server acceptance budget: under 300 ms.
- Graph: 1,000 notes ready in 721 ms in the walkthrough (limit 3 s). Graph data for 5,000 notes: 79 ms.
- Opening a note: 2 ms. Note list: 40 ms.
- Server memory: about 112 MB RSS at 5,000 notes.
- Rename of a heavily linked note: about 1.0 s at 5,000 notes.

## Known limitations

- **One server per vault.** A second server on the same `VAULT_DIR` exits 1. A stale lock from a crashed server is taken over automatically.
- **`.wiki.lock` is visible.** While the server runs, the vault holds a `.wiki.lock` file with the process id. It is removed on clean shutdown. It is not a note.
- **Search is substring, not fuzzy.** `quarter` finds `quarterly`; `qtrly` finds nothing. Regex syntax is taken literally.
- **No subfolders.** Notes must sit directly in `VAULT_DIR`.
- **No attachments.** Images and other files cannot be embedded or linked.
- **New files are created with mode 0644.** Anyone who can read the folder can read new notes.
- **Search results are not capped.** Every match is returned, so a broad query on a large vault returns a large response.
- **Unresolved links are not drawn in the graph.** A link to a missing note appears in the text but not as a node.

## Tests

Run the full suite (acceptance and unit tests; Node built-ins only):

```sh
cd examples/wiki
npm test
```

This runs `node --test "acceptance/*.test.js" "tests/*.test.js"`. The last run recorded 305 tests: 304 passed and 1 was skipped because the machine had no IPv6 loopback. Line coverage was 99.25% (`node --test --experimental-test-coverage ...`).

Acceptance tests in `acceptance/` are fixed. Add unit tests in `tests/`.

### Browser QA walkthrough

`node qa/walkthrough.mjs` runs UI checks 1 to 31 from `docs/product/wiki/ux.md` in headless Chromium. It is not part of `npm test`.

Requirements:

- **Playwright** must be resolvable from `examples/wiki` (`require('playwright')`). It is not a dependency of this project and nothing installs it.
- **Chromium** must be available to Playwright (`npx playwright install chromium`, or a path Playwright can use).
- The walkthrough writes screenshots to `docs/product/wiki/qa/` unless you set `QA_SHOTS=0`. Set `QA_TMP` to a folder you choose for the temporary vaults.
- Axe checks use axe-core, which is installed into a temp folder unless you set `AXE_CORE_PATH`.

Example with no screenshots:

```sh
cd examples/wiki
QA_SHOTS=0 QA_TMP="$HOME/wiki-qa-tmp" node qa/walkthrough.mjs
```

Results: `docs/product/wiki/qa.md` records 31 of 31 passing on the last two full runs, with five checks amended to match the spec. A later run on 2026-11-18 passed 30 of 31; check 26 (desktop layout) failed because the note list and note view tops differed by 46 px against a 40 px allowance. Treat the walkthrough as a check that can fail, not a guarantee.

## Project layout

- `src/`: server code. `server.js` is the entry point (config, lock, startup). `router.js` handles request checks and routes. `api.js` holds the handlers. `vault.js` is the only module that touches the vault folder. `index.js` is the in-memory index. `rename.js`, `search.js`, `revision.js`, `http.js` and `errors.js` do the rest.
- `public/`: `index.html` (the single page shell) and `app.css`.
- `public/js/`: browser code, no build step. `titles.js` and `wikilink.js` are shared with the server. `markdown.js` renders previews. Other files cover the views, router, dialogs, search, graph and live updates.
- `acceptance/`: HTTP acceptance tests and helpers. Read-only for changes.
- `holdout/`: held-out tests run by the orchestrator (`HARNESS_HIDDEN_DIR` may override the path).
- `tests/`: unit tests.
- `qa/walkthrough.mjs`: browser walkthrough (see above).
- `spec.md`: the exact behaviour (API, title rules, search, rename). Where the docs disagree, the spec wins.
- `verify.config.json`: gate settings for the harness (minimum tests, coverage, mutation and holdout).
- `vault/`: created at runtime by default (git-ignored).

Product documents are in `docs/product/wiki/` at the repository root: `brief.md`, `ux.md`, `design.md`, `decisions.md`, `TASKS.md`, `qa.md` and `reviews.md`.

## Out of scope

Accounts, sync, multi-user use, plugins, subfolders, attachments, tags, WYSIWYG editing, embeds, `#heading` links, a file watcher, a persisted index, export, three-way merge, non-loopback hosting, HEAD and conditional GET.
