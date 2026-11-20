# Changelog

All notable changes to this project are recorded here.

## Unreleased: redesign ("The Overkill Greeting Office")

- New visual and interaction design for the page. It is a postal-ministry art direction with a full token system (colour, type, spacing, motion), light and dark themes and an Appearance control (System, Light, Dark) in the footer.
- Ceremonies:
  - The greeting arrives as a letter from an opening envelope and is postmarked.
  - The certificate is a printable portrait document with a guilloche border, a wax seal and a serial number. It has a Print button and fits on one A4 or Letter page.
  - Verify stamps Authentic or Forged.
  - Battle deals two letters onto a table.
  - The wall is a departure board with a Pause updates button.
  - Weather is a telegram.
  - SLA is a control room with a sparkline.
  - The time machine rolls a postmark to the chosen year.
  - Haiku is a typeset card.
  - Federation shows a map of sister offices.
- Accessibility (WCAG 2.2 AA):
  - Reduced motion becomes opacity-only.
  - The live wall has a flash budget.
  - Forced-colours rules are added.
  - Slow loading states are announced.
  - Greetings carry their `lang`.
  - Layout is responsive from 320 px.
- No dependencies are added. The page is still one inline style and one inline script, hashed in the CSP. The API, router and security headers are unchanged.
- `src/page.js` now assembles parts from `src/page/` (tokens, geometry, icons, style, markup, script).

## 1.0.0

First release. A rebuild of the Pirple homework API (`POST /hello`, source: https://github.com/jyeann/HW-PIRPLE-1) as an intentionally over-engineered Hello World.

- Core contract kept byte for byte: `POST /hello` returns 200 `{"message":"Hello World! Welcome to the API."}` for any body or no body.
- Polyglot Hello: 10 languages and 4 tones (40 greeting templates), selectable through the API and the page.
- Streaks and memory: visit counts and UTC-day streaks per name, persisted to a JSON file.
- Signed certificates: HMAC-SHA256 certificates, a certificate endpoint, and a verify endpoint that answers Authentic or Forged.
- Greeting Battle (lite): vote between two greetings, with a persisted top-10 leaderboard.
- Chaos mode: `?chaos=418|delay|1` on `POST /hello` for forced teapot responses and delays.
- Rate-limited politeness: 429 with `retry-after` after the per-minute limit (default 10).
- Single Node 22 process, zero runtime dependencies, one data file. Started with `node src/server.js`.
- Configuration through `PORT`, `DATA_FILE`, `HELLO_RATE_LIMIT`, `HELLO_SIGNING_SECRET` and `NODE_ENV=production` (requires a secret of at least 32 characters).
- No HTTPS listener and no certificate files are needed to start.
