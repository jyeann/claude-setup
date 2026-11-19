# Brief: incident-sim (Incident Simulator)

## Problem and user

A browser game where a small live architecture breaks and the player diagnoses and fixes it before the pager budget runs out. The 400+ system design guides in ByteByteGo's system-design-101 are the toolbox: after each incident the debrief explains WHY it happened and links to the matching public guide.

- **Interview candidate**: has read about cache stampedes and circuit breakers but never had to *recognise* one from a p99 graph. Wants practice that reasoning under pressure, in 10-minute sessions.
- **Engineer running a game-day**: wants a safe, repeatable outage drill for a team (same seed, same incident) with no infrastructure to set up.

The job: turn "I know the term" into "I spotted it in the metrics, picked the right fix, and know why the obvious fix made it worse."

**Wow moment (first 30 s)**: no sign-up, no tutorial wall. The page opens on a calm, live system diagram with flowing request dots and green metrics. About 5 s later a cache node flashes, the p99 line climbs, the DB saturation bar goes red and a page fires: "SEV2: checkout p99 > 2 s". The first keypress (`i`, inspect) shows a log line that hints at the cause. The player is already playing before they read any instructions.

Constraints (house stack): Node >=22, zero npm dependencies, `node:test`, vanilla JS, no build step, canvas 2D/SVG/CSS visuals, CSP-safe (no inline script or style), `node src/server.js` serves static files with the same Host/CSP hardening as `examples/wiki`. Progress lives in localStorage with optional JSON export/import. No accounts, no network calls at runtime, no personal data. Fully keyboard-playable, with a text-first mode and `prefers-reduced-motion` respected.

Licence: system-design-101 is CC BY-NC-SA 4.0. We link to guide URLs from its README and write all scenario and debrief text ourselves. We copy no guide text or images. An About screen and the README credit the source repo.

Repository check: nothing in `examples/` or `docs/product/` simulates systems. `examples/wiki` supplies the static-server hardening pattern to reuse.

## Existing products (from knowledge, not re-fetched)

| Product | Does well | Gets wrong for this job | Source |
|---|---|---|---|
| SRE game days / Wheel of Misfortune (Google SRE book) | Real teams, real tools, role-played outages; strong learning. | Needs a facilitator, prep time and real systems. Not solo, not repeatable, no instant feedback. | https://sre.google/sre-book/accelerating-sre-on-call/ |
| PagerDuty / Gremlin game-day and chaos tools | Inject real faults into real infrastructure. | Needs infrastructure and accounts, and is paid. Teaches tooling more than concepts. Not something an interview candidate can use. | https://www.gremlin.com/ |
| Katacoda-style labs (Killercoda, Instruqt) | Real terminals, real Kubernetes, guided steps. | Heavy, online and step-scripted. They teach commands, not causal reasoning. Katacoda itself shut down in 2022. | https://killercoda.com/ |
| Kubernetes simulators/games (e.g. k8s "Kubernetes the Hard Way" labs, SadServers) | Realistic broken servers to fix (SadServers is close in spirit). | Linux/ops level, not architecture level. Needs a VM, and gives no "why" debrief tied to design concepts. | https://sadservers.com/ |
| Papers, Please / Human Resource Machine | Rules-as-puzzles; tight loop; wrong choices have clear consequences; readable minimalist UI. | Not about systems. They are the bar for *feel*, not for content. | https://papersplea.se/ , https://tomorrowcorporation.com/humanresourcemachine |
| System Design Primer / system-design-101 itself | Comprehensive, free, visual explanations. | Passive reading. You never apply the knowledge under uncertainty. This is the gap we fill. | https://github.com/donnemartin/system-design-primer , https://github.com/ByteByteGoHq/system-design-101 |

## Decision (build/adopt/extend and why)

**Build.** No existing tool gives a solo, offline, deterministic, architecture-level incident game with a concept debrief. Game-day and chaos tools need real infrastructure, and the content repos are read-only learning. We **extend** system-design-101 only by linking to it: the guides stay the reference, and we add the practice loop it lacks. Anyone who wants to drill real infrastructure should use SadServers or a Gremlin game-day instead.

## MVP scope (in / out / later)

**In**
- Deterministic engine: seeded PRNG, fixed tick (1 tick = 1 simulated second), pure `step(state, action) -> state`. Topology: clients, LB, 1-3 services, cache, DB (primary/replica), queue + consumer, third-party API. Metrics per node: p50/p99 latency, error rate, saturation, queue depth, cache hit rate.
- Player loop: alerts, dashboards (sparklines), logs, and a system map. Diagnostic actions: inspect, trace request, tail logs, compare dashboards, deploy history. Fix actions: scale, add TTL jitter, circuit breaker, exponential backoff + jitter, shed load, failover, shard/rekey, add index, rollback, raise pool size, renew cert. Each action costs pager budget, and simulated time keeps running.
- Wrong fixes have modelled consequences, e.g. scaling the service during connection pool exhaustion moves the bottleneck to the DB and makes it worse.
- Scenarios are JSON files in `scenarios/`, checked by a schema validator (hand-written, no deps). Adding a scenario needs no code. 10 ship at launch (difficulty 1-3):
  cache stampede, thundering herd, retry storm, hot partition, slow consumer/queue backlog, N+1 queries, connection pool exhaustion, expiring certificate, split brain, cascading failure (boss: needs at least 2 ordered fixes).
- Guide links (from the README TOC): how-can-cache-systems-go-wrong, things-to-consider-when-using-cache, how-do-we-retry-on-failures, resiliency-patterns, a-crash-course-in-database-sharding, consistent-hashing, types-of-message-queue, 7-must-know-strategies-to-scale-your-database, how-does-https-work, cap-theorem-one-of-the-most-misunderstood-terms, how-to-deploy-services (all under `https://bytebytego.com/guides/`).
- Incident of the day: seed and scenario derived from the local date (no network).
- Debrief: your action timeline against the optimal path, the root cause, the concept in our own words, a guide link, and a score (time to mitigate, budget left, collateral damage).
- Shareable text result (emoji-free grid, e.g. `incident-sim #312 retry-storm  [D D F x F]  4/6 pager  02:41`) copied to the clipboard.
- Progress in localStorage, with JSON export/import.

**Out**: accounts, leaderboards, multiplayer, any runtime network call, sound, scenario editor UI, real infrastructure integration, mobile-first layout (it must work, but it is not optimised), copying guide content or images.

**Later**: noisy neighbour and clock skew scenarios (clock skew has no exact guide in the TOC), a scenario editor, team game-day mode with a facilitator view, custom topologies, localisation, daily streaks.

## Success criteria (testable, user-visible)

SC1. **First run, wow moment.** `node src/server.js` prints a local URL. Opening it shows a live system map with no sign-in or modal. Within 10 s of load an alert banner appears and at least one metric visibly turns red. The player can press `i` or click a node to inspect it within the first 30 s.

SC2. **Full incident end to end.** On "cache stampede" the player inspects the cache, sees a log like "1,842 misses for key product:42 in 1 s", applies "add TTL jitter / request coalescing", and sees DB saturation and p99 return to green within 30 simulated seconds. The "Resolved" debrief then shows the timeline, root cause, concept and a working link to `https://bytebytego.com/guides/how-can-cache-systems-go-wrong`.

SC3. **Wrong fix makes it worse.** On "connection pool exhaustion", choosing "scale service" first produces a visible change: DB saturation and error rate rise, and the log shows "too many connections". The debrief marks that step as harmful and explains why.

SC4. **Not solvable by one action.** In "cascading failure", any single fix action leaves at least one alert firing. Only the documented sequence (e.g. shed load, then circuit breaker, then scale) resolves it, and the debrief shows the optimal path next to the player's.

SC5. **Determinism.** Two runs with the same seed and the same action sequence, in two browser tabs or via `node --test`, produce identical metric series, logs and score. The daily incident shows the same scenario and seed for every player on the same date, and the seed is shown on screen.

SC6. **Pager budget.** Each action shows its cost before it is taken. When the budget hits 0, actions are disabled and the debrief shows "Out of pager budget" with the root cause still revealed.

SC7. **Keyboard-only play.** With no mouse, a player can start, move between nodes (arrow keys), open the action menu, pick actions, read logs, finish the incident and open the guide link, with visible focus at every step. Alerts are announced through an `aria-live` region.

SC8. **Text-first mode and reduced motion.** With text mode on, the same incident can be finished from a table of metrics, alerts and logs with no canvas. With `prefers-reduced-motion: reduce`, request dots and pulses stop, metrics update in steps, and the game stays fully playable.

SC9. **Bad scenario rejected.** Starting the server, or running `node --test`, with a scenario file missing `rootCause`, with an unknown action id, or with a `guideUrl` not on `https://bytebytego.com/guides/` fails with a message naming the file and field. The game lists only valid scenarios and never crashes.

SC10. **Progress round trip.** After finishing 3 incidents, Export downloads a JSON file. Clearing site data and then importing that file restores the same completed incidents, scores and best times.

SC11. **Hostile import.** Importing a file over 256 KB, non-JSON, JSON with `__proto__`/`constructor` keys, or JSON with `<img onerror>` in a name field shows "Import rejected: <reason>". Stored progress is unchanged, no script runs, and `Object.prototype` is not polluted.

SC12. **Share and attribution.** "Copy result" puts a plain-text summary with no personal data on the clipboard, and the page makes no network request (DevTools Network shows only same-origin static files). The About screen credits ByteByteGo system-design-101 under CC BY-NC-SA 4.0 with a link.

## Design bar (testable observations)

- **Memorable detail**: the system map tells the story on its own. During a stampede, viewers can see request dots pile up at the cache and then flood the DB. During a retry storm, dots visibly multiply on the path to the third party.
- **Motion principles**: motion only encodes data (dot rate = RPS, pulse = an alert firing). Nothing animates for decoration. Transitions are 150-250 ms. The simulation keeps 60 fps on a mid laptop with 500 dots. All motion stops under reduced motion (SC8).
- **Typography**: one monospace face for metrics and logs, with tabular numbers that do not jitter as values change, and one sans face for prose. Body text is at least 16 px and the debrief line length is at most 72 characters.
- **Colour**: a dark "ops console" theme. Status is never shown by colour alone: red/amber/green always comes with an icon or text label (OK/WARN/CRIT). All text passes WCAG AA contrast, checked by an automated contrast test on the palette tokens.
- **Feel**: an action takes effect on the next tick, and the effect is visible within 2 simulated seconds. The resolved moment gets a distinct, calm state change (alerts clear one by one) rather than confetti.
- **Sound**: out of scope.

## Risks

- **Simulation feels arbitrary**: if fixes do not follow believable causes, players learn nothing. Each scenario states a causal model, and unit tests assert the metric direction for each fix.
- **Licence (NC-SA)**: we link only and write original text. Any commercial use of this game needs a human decision.
- **Broken guide links**: a test checks every `guideUrl` appears in the pinned README TOC. The URLs are not fetched at runtime.
- **Hostile imports and XSS**: render all text through `textContent`, parse imports defensively, and have the `security-reviewer` agent review import and storage.
- **Scope creep** toward a general simulator: the topology stays fixed and new content comes from JSON.

## Open questions with defaults

1. Real-time or turn-based? **Real-time ticks with a pause key (`space`)**. Text mode auto-pauses between actions.
2. Daily seed source? **Local date (YYYY-MM-DD) hashed.** Players in different time zones may briefly see different incidents, which is acceptable.
3. Hints? **One free hint per incident costs score, not budget.**
4. Difficulty unlocks? **None. All scenarios are open, labelled 1-3.**
5. Can players see the optimal path before finishing? **No, only in the debrief.**
6. Scenario count at launch? **10**. Noisy neighbour and clock skew come later.
7. **Needs a human**: any commercial distribution or use of the ByteByteGo name beyond attribution (licence/trademark). Nothing else needs a human: there is no spend and no personal data.
