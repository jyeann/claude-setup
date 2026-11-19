# Packing list

A shared packing list for a trip. One person makes the list and sends one link; everyone with the link ticks items off as they pack and sees what is still missing. It runs as one Node process with no dependencies and stores all lists in a single JSON file.

## Run it

Requires Node 22 or later. No install step is needed.

```sh
cd examples/packing-list
npm start
```

The app prints:

```
Packing list running at http://localhost:3000
```

Open http://localhost:3000 in your browser. Stop it with Ctrl+C.

## Use it

1. **Create a list.** On the home page, type a trip name (1 to 80 characters) under "New packing list" and submit. An empty or whitespace-only name shows an error and creates nothing.
2. **Share the link.** The list page shows the full share link with a Copy button. Send it to the group. Anyone with the link can edit the list. There are no accounts and no separate viewer link.
3. **Add items.** Type an item (1 to 120 characters) and press Add. The item appears at once, unticked, and the progress reads "N of M packed". A list holds at most 200 items; Add is refused with "This list is full (200 items)".
4. **Tick items.** Click an item to tick it when packed, and click again to untick it. Ticks are set explicitly, so repeating a tick does no harm.
5. **Remove items.** Press Remove on an item to delete it for everyone.

Other people's changes appear on your screen within about 5 seconds without a reload.

## Settings

Set these as environment variables when you start the app, for example `PORT=8080 npm start`.

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | Port to listen on. If it is in use the app prints "Port N is in use, set PORT" and exits 1. |
| `HOST` | `127.0.0.1` | Address to bind. Only this machine can reach the app by default. |
| `DATA_FILE` | `examples/packing-list/data/lists.json` | Path of the JSON file that stores all lists. Relative paths are resolved from where you start the app. |

To open the app to your home network, start it with `HOST=0.0.0.0 npm start`. Other devices can then use it at `http://<this-machine's-address>:3000`.

**Warning:** with `HOST=0.0.0.0`, anyone on your network can create lists, and anyone who has a list link can edit that list. The app prints a warning when it starts this way. Traffic is plain HTTP, so anyone who can see the network can read the links. Use this only on a trusted network.

## Your data

- All lists are stored in one JSON file, `examples/packing-list/data/lists.json` by default (or the path you set in `DATA_FILE`).
- Writes are atomic: the file is replaced in full or not at all, so a restart keeps the last saved state.
- **Back up:** stop the server, then copy the data file.
- **Reset:** stop the server, then delete the data file. All lists are removed. The next start creates an empty store.
- A file that cannot be read is moved aside as `<file>.corrupt-<time>` (for example `lists.json.corrupt-1763550000000`), an error is logged, and the app starts with an empty store.

## Limits

- **200 items per list.** Adding more is refused with a visible message.
- **10000 lists in total.** There is no delete and no expiry, so once the store is full, creating a new list is refused with a storage-full error. Remove the data file (after a backup) to start again.
- **Every change rewrites the whole data file.** This is fine for a household. With thousands of lists, each change becomes slow.
- **Needs JavaScript.** The list page is built in the browser.
- **No accounts.** A leaked link cannot be revoked. Anyone with it can edit the list.
- **Public internet hosting is not supported.** Use it on a local machine or a trusted network only.

## Tests

Run the unit and acceptance tests (no dependencies to install):

```sh
npm test
```

The full quality gate, which also runs the browser journeys, is:

```sh
CLAUDE_PROJECT_DIR="$PWD" node ../../.claude/harness/bin/verify.js
```

The browser journeys need Playwright with Chromium available.
