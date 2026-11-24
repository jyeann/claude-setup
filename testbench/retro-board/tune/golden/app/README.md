# Retro board

A small team retro board with three columns (Went well, To improve, Actions) where people add anonymous cards and vote. The facilitator closes the retro and exports the result as markdown. It runs as one Node process with no dependencies and stores each board as a JSON file.

## Run it

Requires Node 22 or later. No install step is needed.

```sh
cd testbench/retro-board
npm start
```

The app prints:

```
Retro board running at http://localhost:3000
```

Open http://localhost:3000 in your browser. Stop it with Ctrl+C.

## Use it

1. **Create a retro.** On the home page, type a title (1 to 100 characters) and choose "Create retro". An empty title shows an error and creates nothing.
2. **Two links appear.**
   - **Participant link** (marked "Share this"): send this to your team. Anyone with it can read the board, add cards and vote.
   - **Facilitator link** (marked "Private"): keep this to yourself and bookmark it. It is the only way to close, reopen, delete any card and export. There are no accounts, so a lost facilitator link cannot be recovered.
3. **Add cards.** Pick a column and type up to 500 characters. Cards are anonymous. You can delete your own cards from the same browser. A board holds at most 200 cards.
4. **Vote.** Each participant has 3 votes per board, at most 1 per card. Click a card to vote and click it again to take the vote back. The label shows how many votes are left.
5. **Sort.** "Sort by votes" orders each column from highest to lowest for your view only.
6. **Close or reopen.** "Close retro" stops new cards and votes for everyone. "Reopen retro" turns them back on.
7. **Export.** "Export markdown" (facilitator link only) shows a preview. "Copy to clipboard" copies it, and "Download" saves a `.md` file named after the title, for example `sprint-12.md`.

Other people's changes appear on your screen within about 5 seconds without a reload.

## Configuration

Set these as environment variables when you start the app, for example `PORT=8080 npm start`.

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | Port to listen on. If it is in use the app prints "Port N is in use, set PORT" and exits 1. |
| `HOST` | `127.0.0.1` | Address to bind. Only this machine can reach the app by default. |
| `DATA_DIR` | `testbench/retro-board/data` | Folder where boards are stored. |
| `MAX_BOARDS` | `1000` | Maximum number of boards. Creating more returns a storage-full error. |

**Warning:** `HOST=0.0.0.0` makes the app reachable by everyone on your network. The app then prints a warning. Traffic is plain HTTP, so anyone who can see the network can read the capability links (the participant and facilitator links) and use them. Use this only on a trusted network.

## Data

- Boards are stored in `DATA_DIR/boards/`, one JSON file per board. File names are a hash of the participant token, so the raw links are never written to disk.
- Writes are atomic: a board file is replaced in full or not at all.
- Files are created with mode `0600` (owner read and write only). Folders are `0700`.
- **Back up:** stop the server, then copy the `DATA_DIR` folder.
- **Reset:** stop the server, then delete the `DATA_DIR` folder. All boards are removed. The next start creates an empty folder.
- A file that cannot be read is renamed to `<name>.corrupt-<milliseconds>`, a message is logged to stderr, and that board shows "Board not found". The other boards keep working.
- A `.lock` file in `DATA_DIR` holds the process id. A stale lock from a crashed run is taken over automatically.

## Limits and known limitations

- **Votes are tied to the browser.** Each browser holds a random id. A private window or another browser gets its own 3 votes. This is accepted for a trusted team.
- **Anyone with the participant link can post and vote.** Share it only with the team.
- **Export keeps card text as typed.** HTML such as `<b>hi</b>` stays as text in the markdown. Paste the export only into a tool that sanitises HTML, such as a wiki or tracker that does this.
- **One process per `DATA_DIR`.** A second server on the same folder exits with an error.
- **No accounts, no board list, no expiry.** Boards stay until you delete `DATA_DIR`.
- **Public hosting needs a human decision.** This app is for a local machine or a trusted network. Do not expose it to the internet without a security review.

## Tests

`npm test` is not defined in `package.json`. Run the tests with:

```sh
node --test "acceptance/*.test.js" "tests/*.test.js"
```

## Project layout

- `src/`: server code (`server.js` entry point, routing, HTTP helpers, validation, board rules, export, storage, tokens, rate limiter).
- `public/`: static pages (`index.html`, `board.html`, `export.html`, `not-found.html`) and `app.css`.
- `public/js/`: browser scripts (`home.js`, `board.js`, `export.js`, `api.js`, `live.js`, `logic.js`).
- `tests/`: unit tests.
- `acceptance/`: HTTP acceptance tests and their helpers.
- `data/`: created at runtime for boards (git-ignored).
