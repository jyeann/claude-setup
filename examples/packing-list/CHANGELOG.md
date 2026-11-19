# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## 1.0.0 - 2026-11-19

### Added

- Create a packing list from a home page form by entering a trip name (1 to 80 characters).
- One unguessable share link per list, with a Copy button; anyone with the link can edit the list.
- Add items (1 to 120 characters), tick or untick them, and remove them, with "N of M packed" progress and a progress bar.
- Items capped at 200 per list, with a visible message when the limit is reached.
- Changes made by others appear within about 5 seconds without a reload (polling).
- Lists persist across restarts in a single JSON file, written atomically.
- A "List not found" page with a link to create a new list for mistyped links.
- Start with one command (`npm start`) using only Node 22 or later and no dependencies.
