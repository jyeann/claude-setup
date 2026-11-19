# ADR 0001: One JSON file with atomic rename

## Status
Accepted

## Context
Lists must survive a restart (SC9). The brief and ux.md fix one data file named by DATA_FILE. Zero runtime dependencies. At most 200 short items per list, a handful of users.

## Decision
Store every list in one pretty-printed JSON file (`{"schema":1,"lists":{...}}`). Each mutation rewrites the whole file synchronously: write `<file>.tmp-<pid>`, fsync, rename. Memory is swapped only after the rename succeeds. A corrupt file is moved aside and the app starts empty.

## Alternatives
- Per-list files (retro-board): bounded write cost, but conflicts with the single DATA_FILE contract.
- Append-only log: cheap writes, needs compaction and replay code.
- node:sqlite: still experimental, harder to inspect.
- In-memory only: fails SC9.

## Consequences
- Simple, readable, crash-safe; a 2xx means the data is on disk.
- Write cost grows with total data; bounded by 200 items per list and MAX_LISTS 10000. Revisit if lists grow beyond a few thousand.
- A corrupt file loses all lists from the live view (the corrupt copy is kept for manual recovery).
