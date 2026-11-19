# Changelog

All notable changes to this project are recorded here.

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
