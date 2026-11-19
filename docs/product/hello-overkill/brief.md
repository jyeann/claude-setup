# Hello Overkill: product brief

## Problem and user

**Idea:** turn the Pirple homework API (`POST /hello` returns `{"message":"Hello World! Welcome to the API."}`) into an extremely over-built but real greeting service.

- **Primary user: the practice builder.** A developer or agent team that wants to run a full pipeline (discover, ux, design, plan, build, review, qa, release, retro) on a product with no domain risk, so the process is what gets exercised.
- **Secondary user, from the joke premise: the visitor.** Someone who opens the web page and wants a greeting that is funnier, more personal and more ceremonial than it needs to be, and then comes back tomorrow for another one.

Harness constraints: zero runtime dependencies, Node 22 built-ins only, file persistence, one process (`node src/server.js`) serving both API and web UI, checked by node:test acceptance tests and a Playwright walkthrough.

## Existing products (with sources)

| Product | Does well | Gets wrong (for us) |
|---|---|---|
| Source app, `/home/user/HW-PIRPLE-1/index.js` | Tiny, clear router, keeps the `POST /hello` contract | Requires HTTPS cert files to start, has no UI and no tests, and a typo key (`'trimmedPath\t'`) |
| httpbin (https://github.com/postmanlabs/httpbin) | A playful request/response service that is very useful for testing | Just echoes requests, so there is no personality and no memory |
| FizzBuzz Enterprise Edition (https://github.com/EnterpriseQualityCoding/FizzBuzzEnterpriseEdition) | The classic over-engineering joke | Satire only. Nobody uses it and it has no user journey |
| hello-world collection (https://github.com/leachim6/hello-world) | Hello in hundreds of languages | A static catalogue with nothing interactive |

These are well-known public repositories. I listed them from memory and did not re-fetch them for this brief.

## Wild ideas (wow / cost)

1. **Polyglot Hello:** greetings in 10+ languages with a tone selector (formal, pirate, Shakespearean, corporate). Wow: high. Cost: low.
2. **Streaks and memory:** the service remembers a visitor by name and says "Welcome back, Ada. Day 4 streak." Wow: high. Cost: medium.
3. **Hello Weather:** a daily "greeting forecast" ("70% chance of warm regards") generated from a seeded date. Wow: medium. Cost: low.
4. **Greeting Battle:** two greetings go head to head, visitors vote, and a leaderboard ranks them. Wow: high. Cost: medium.
5. **Live hello stream:** greetings stream over Server-Sent Events into a live "wall of hellos". Wow: high. Cost: medium.
6. **Signed greeting certificates:** each greeting gets an HMAC signature, there is a printable certificate page, and `/verify` confirms it is authentic. Wow: high. Cost: medium.
7. **Chaos mode:** `?chaos=1` adds random latency, errors or a 418 teapot, and the UI degrades gracefully. Wow: medium. Cost: low.
8. **Hello SLA dashboard:** live uptime, greetings per minute and p95 "warmth latency". Wow: medium. Cost: medium.
9. **Greeting time machine:** replay any past greeting by ID through a permanent permalink. Wow: low. Cost: low.
10. **Hello haiku compiler:** turns a name into a 5-7-5 greeting haiku. Wow: medium. Cost: low.
11. **Rate-limited politeness:** after the 10th hello in a minute the service answers "You've been greeted enough" and returns 429 with a polite Retry-After header. Wow: medium. Cost: low.
12. **Hello federation:** two instances exchange greetings with each other. Wow: high. Cost: high, and it breaks the one-process constraint.

## Decision

**Extend** the original app by rewriting it as a dependency-free Node 22 service that keeps `POST /hello` byte-compatible as the core contract. No existing tool does the greeting job with personality and memory, and adopting httpbin or a similar tool would defeat the practice goal.

## MVP scope

**In (a bundle of 6 ideas):**
- Backward-compatible core: `POST /hello` with any body (or none) returns 200 and the original JSON message. No HTTPS cert is needed to start.
- #1 Polyglot Hello: at least 10 languages and 4 tones, chosen through the API body or query and through the UI.
- #2 Streaks and memory: per-name visit count and day streak, persisted to a JSON file and kept across restarts.
- #6 Signed certificates: an HMAC-SHA256 signature using a secret from an env var (with a dev default plus a warning), a certificate page and a verify page.
- #4 Greeting Battle (lite): vote between two random greetings, with a top-10 leaderboard persisted to file.
- #7 Chaos mode: an opt-in query flag that causes 418 or delay, and the UI shows a friendly error and lets the user retry.
- #11 Rate-limited politeness: a 429 response with Retry-After.

**Out:** federation (#12), user accounts and passwords, HTTPS listener, external translation APIs, databases.

**Later:** SSE live wall (#5), SLA dashboard (#8), haiku (#10), weather (#3), time machine (#9).

## Success criteria (testable, user-visible)

1. Running `node src/server.js` prints the URL it is listening on, and opening that URL shows a page with a name field, a language picker, a tone picker and a "Say hello" button.
2. `POST /hello` with any body or no body returns 200, `application/json` and exactly `{"message":"Hello World! Welcome to the API."}`, and any other path returns 404 JSON.
3. When a user enters "Ada", picks Spanish and Pirate, and clicks "Say hello", the page shows a greeting in that language and tone that includes "Ada".
4. The language picker offers at least 10 languages and the tone picker at least 4 tones, and every combination returns a non-empty greeting.
5. When the user greets as "Ada" a second time, the page shows "visit 2" (or similar) and a streak count, and these still show after the server restarts.
6. Every personalised greeting shows a "View certificate" link, and the certificate page shows the name, the greeting, the date and a signature.
7. Pasting a certificate into the verify page shows "Authentic", while a certificate with one edited character shows "Forged".
8. On the Battle page the user sees two greetings, can click one to vote, and sees the leaderboard update with the vote counts.
9. With chaos mode on, the user sometimes sees a friendly "The greeter spilled its tea (418)" message and a retry button that works, and the page never shows a blank screen or a raw stack trace.
10. After more than 10 hellos in one minute from the same client, the UI shows a polite slow-down message, and the API returns 429 with a Retry-After header.
11. `npm test` (node:test) passes with no installed dependencies, and the Playwright walkthrough covers criteria 1, 3, 5, 6, 7 and 8.

## Risks

- **Scope creep:** the joke invites endless features. The six-idea bundle is a hard cap.
- **Signing secret leaks or is hard-coded:** it must come from an env var, and the dev default must log a warning.
- **Names are personal data:** keep only name, counts and dates, store nothing else, and offer a "forget me" button later.
- **Concurrent file writes corrupting the JSON:** write to a temp file and rename it into place.

## Open questions with defaults

- Is a visitor identified by name only, or by a cookie as well? Default: name only, case-insensitive.
- How is a streak day measured? Default: UTC calendar day.
- Are greeting translations hand-written or machine-made? Default: hand-written table that ships with the code. No external API.
- Who owns the signing secret? Default: `HELLO_SIGNING_SECRET` env var.
- Does storing visitor names need a privacy note? Needs a human only if the service is deployed publicly. Default: a local practice app with a one-line notice on the page.
