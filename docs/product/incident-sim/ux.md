# UX: incident-sim

Vanilla JS, plain HTML and CSS in `public/`, no framework, no build step. The visual system (tokens, status language, map, motion, replay, scoring, refusals, evaluator rubric) is in `design-direction.md`; this file is the behaviour, copy, test contract and acceptance checks. Source: `brief.md` (success criteria "SC1" to "SC12"). English only. All text in the UI is original; nothing is copied from system-design-101.

## Conventions and data-testid contract

- Tests use `[data-testid="..."]` only (written `[t=x]` below). The contract table below is the single source for tests and builder. Names are stable; rename only by editing this file. Repeating things carry data attributes. No pixel diffing: all state a test needs is in `data-*` attributes.
- Every string from scenario files, imports and logs is set with `textContent` or DOM nodes, never `innerHTML`. Markup in data is shown literally.
- Every screen has `<html lang="en">`, exactly one `<h1>`, `<main id="main">`, and "Skip to main content" as the first focusable element. `document.title` is `<Screen> - incident-sim`; during play it is `[OK|WARN|CRIT|RECV] <Incident title> - incident-sim` and follows the worst node.
- Assumptions for the builder and tests (the engine and server specs win on conflict):
  - Server: `PORT` (default 3000), listens on 127.0.0.1, prints `Incident Simulator running at http://localhost:<port>` and then `Loaded 10 scenarios.`. Env `SCENARIOS_DIR` (default `./scenarios`) names the scenario folder. Env `INCIDENT_SIM_TEST=1` enables test mode (below).
  - On start the server validates every scenario file and prints one line per problem, then keeps serving the valid ones: `scenario error: scenarios/<file>.json: field "<path>": <what is wrong>. Expected: <what is expected>.` It also serves `scenarios/index.json` with `{ "valid": [ids...], "errors": [{ "file", "field", "message" }] }`. The client re-validates what it loads with the same shared validator and adds its own errors. `node --test` fails on any invalid shipped scenario.
  - Scenario ids equal their file names and match `^[a-z0-9-]{1,40}$`. Shipped ids: `cache-stampede`, `thundering-herd`, `retry-storm`, `hot-partition`, `queue-backlog`, `n-plus-one`, `connection-pool-exhaustion`, `expiring-certificate`, `split-brain`, `cascading-failure`.
  - Action ids (kebab-case of the brief's names): diagnostic `inspect`, `trace-request`, `tail-logs`, `compare-dashboards`, `deploy-history`; fix `scale-service`, `add-ttl-jitter`, `circuit-breaker`, `backoff-jitter`, `shed-load`, `failover`, `shard-rekey`, `add-index`, `rollback`, `raise-pool-size`, `renew-cert`. `inspect` is always free; every other cost comes from the scenario and is only displayed by the UI.
  - Node ids: `clients`, `lb`, `service-1`, `service-2`, `service-3`, `cache`, `db-primary`, `db-replica`, `queue`, `consumer`, `third-party`. A scenario uses a subset; absent nodes are not drawn.
  - One simulated tick is one simulated second. The sim time shown is `T+mm:ss`.

### Routes (hash routing, so the static server needs no fallback)

| Route | Screen |
|---|---|
| `#/` | First run on a profile with no saved progress: starts `cache-stampede` immediately (with the daily seed). Otherwise redirects to `#/incidents`. |
| `#/incidents` | Incident board (home/picker) |
| `#/play/<id>` or `#/play/<id>?seed=<n>` | Live incident. Default seed is the scenario's standard seed; `n` is an integer 0 to 4294967295. |
| `#/debrief/<id>` | Debrief for the last finished run of that scenario (rebuilt by replaying the saved seed and actions). With no saved run: the unknown-incident error state. |
| `#/data` | Your data: export, import, clear |
| `#/about` | About and attribution |
| anything else | "That incident is not on the board." error state |

Test mode params go in the real query string, before the hash: `/?speed=16&paused=1&pause-at=60#/play/cache-stampede?seed=1`.

### Test mode rule (cannot be abused)

- Test mode exists only when the server was started with `INCIDENT_SIM_TEST=1`; it then serves `/test-mode.json` as `{ "testMode": true }`. Without the env var that path is a 404 and the client treats every test parameter as absent. The client requests it once at boot (a same-origin static request).
- Honoured parameters, only in test mode: `speed` (one of 1, 2, 4, 8, 16, 32, 64; anything else is ignored and means 1), `paused=1` (start paused at T+00:00), `pause-at=<seconds>` (pause automatically when the sim reaches that second), `fail-at=<seconds>` (throw a deliberate engine error at that second, to test the error state).
- `speed` only changes how often the scheduler asks the engine for the next tick. The engine takes no wall-clock input, an action is stamped with the tick on which the UI accepted it (never with wall-clock time), and at most `speed` ticks run per second. Therefore outcomes, series, logs, score and `data-state-hash` are identical at every speed; there is no way to gain time or points. Speed above 1 cannot be set by the player in the interface and is never persisted.
- While any test parameter is active a persistent banner `[t=test-banner]` reads `Test mode: speed 16x.` (with `paused` and `pause-at` listed when set).
- The server in test mode still listens on 127.0.0.1 only.

### Deterministic state attributes

`[t=play-view]` carries: `data-scenario`, `data-seed`, `data-sim-time` (integer seconds), `data-status` (`running`, `paused`, `resolved`, `out-of-budget`), `data-grace` (`true` during the 10 s after the budget hits 0 while the sim keeps running), `data-mode` (`map` or `text`), `data-reduced-motion` (`true` or `false`), `data-budget-left`, `data-budget-total`, `data-selected-node`, `data-alert-count` (firing alerts), `data-actions-taken`, `data-harmful-count`, `data-hint-used`, `data-updated-at` (sim second of the last metric repaint; always even under reduced motion), `data-speed`, `data-state-hash` (8 hex characters, FNV-1a over all metric series and log lines so far, recomputed each tick). The same names appear on `[t=debrief-view]` where relevant, plus `data-result` (`resolved` or `out-of-budget`), `data-score`, `data-time-to-mitigate` (seconds, or empty when not mitigated).

### data-testid table

| data-testid | Element | Notes |
|---|---|---|
| `skip-link` | a | First focusable. "Skip to main content" |
| `nav-incidents`, `nav-data`, `nav-about` | a | Header navigation: "Incidents", "Your data", "About" |
| `status-live` | div aria-live=polite | Always in DOM, visually hidden |
| `alert-live` | div role=alert | Always in DOM, visually hidden. New SEV1/SEV2 pages only |
| `boot-loading` | div role=status | "Plugging in the pager..." skeleton map |
| `app-error` | div role=alert | Load error or engine exception. Contains `app-retry` or `app-reload` |
| `app-retry` | button | "Try again" |
| `app-reload` | button | "Reload" |
| `storage-warning` | div role=status | Storage blocked notice |
| `test-banner` | div | Only in test mode with parameters. "Test mode: speed 16x." |
| `not-found` | section | Unknown incident or route. Contains h1 and `not-found-back` |
| `not-found-back` | a | "Back to the incident board" |
| `picker-view` | section | Incident board |
| `daily-card` | section | `data-scenario`, `data-seed`, `data-date`, `data-number` |
| `daily-start` | button | "Start today's incident" |
| `seed-input` | input | Label "Seed (optional)" |
| `seed-error` | p | Inline error, empty when none |
| `incident-list` | ul | All valid scenarios |
| `incident-row` | li | `data-scenario`, `data-difficulty`, `data-state` (`new`, `resolved`, `out-of-budget`), `data-best-time` |
| `incident-start` | a | "Start <title>" |
| `picker-empty` | section | Zero valid scenarios |
| `scenario-errors` | details | Summary "N scenario files could not be loaded" |
| `scenario-error-item` | li | `data-file`, `data-field`; text per the error format |
| `play-view` | section | State attributes above |
| `seed-chip` | span | "Seed 48213" |
| `mission-clock` | time | "T+02:41", `data-seconds` |
| `pager-lamps` | div role=group | `aria-label` "Pager budget: 4 of 6 left" |
| `pager-lamp` | span | `data-state="on|spent"`, `data-preview="true"` when previewed |
| `pager-text` | span | "Pager 4 / 6" |
| `pause-button` | button | "Pause" or "Resume", `aria-pressed` |
| `step-button` | button | "Step 1 s". Visible when paused or in text mode |
| `step-5-button` | button | "Step 5 s". Same visibility |
| `run-button` | button | "Run". Text mode only |
| `hint-button` | button | "Hint" or "Hint used" (aria-disabled) |
| `mode-toggle` | button role=switch | "Text mode", `aria-checked` |
| `shortcuts-toggle` | button role=switch | "Shortcuts", `aria-checked` |
| `help-button` | button | "Keys" |
| `system-map` | div role=group | `aria-label` "System map", `data-layout="wide|tall"`, `data-ready` |
| `map-canvas` | canvas | aria-hidden. `data-dots` (live dots), `data-dot-cap`, `data-animating` |
| `map-node` | g | `data-node`, `data-status` (`ok|warn|crit|recovering`), `data-selected`, `data-saturation`, `data-p50`, `data-p99`, `data-error-rate`, `data-queue`, `data-hit-rate`, `data-pile`; role=button, roving tabindex |
| `map-node-badge` | g | Status shape plus label text `OK`, `WARN`, `CRIT`, `RECV` |
| `map-node-ring` | rect/circle | Selection and focus ring (child of the node) |
| `map-edge` | path | `data-from`, `data-to`, `data-state` (`normal|loaded|failing|cut`), `data-rps`, `data-dot-rate` |
| `edge-label` | text | Rate label at the midpoint, e.g. "1.8k rps" |
| `toast-region` | div aria-hidden | Holds toasts |
| `alert-toast` | div | `data-kind` (`page|warn|clear|note`) |
| `text-view` | section | Text mode table region |
| `text-row` | tr | `data-node`, `data-status`; first cell contains a button |
| `alerts-panel` | section | h2 "Pages" with count |
| `alert-item` | li/button | `data-alert-id`, `data-state` (`firing|resolved`), `data-severity` (1-3) |
| `alerts-empty` | p | "No pages. Enjoy it while it lasts." |
| `panel-tabs` | div role=tablist | Phone and tablet: tabs `tab-alerts`, `tab-inspect`, `tab-actions`, `tab-metrics` (button role=tab, `aria-selected`) |
| `inspect-panel` | section | `data-node` |
| `inspect-empty` | p | Nothing selected |
| `inspect-title` | h2 | tabindex -1, node name |
| `inspect-status` | span | Status badge |
| `inspect-metrics` | dl/table | Contains `metric-value` elements |
| `metric-value` | span | `data-metric` (`p50|p99|errors|saturation|queue|cache-hit`), `data-value` |
| `log-list` | ul | tabindex 0, `aria-label` "Logs for Cache", scrollable |
| `log-line` | li | `data-time`, `data-level` (`info|warn|error`), `data-kind` (`log|action`) |
| `log-empty` | p | "Quiet. Nothing logged for Cache yet..." |
| `log-latest` | button | "Jump to latest", only when scrolled up |
| `diag-result` | div | Output of trace, tail, compare, deploy history |
| `action-panel` | section | `data-node` of target |
| `action-item` | li/button | `data-action-id`, `data-kind` (`diagnostic|fix`), `data-cost`, `data-state` (`enabled|disabled|applied`), `aria-disabled`, `aria-describedby` |
| `action-cost` | span | "Cost 2" or "Free" |
| `action-reason` | span | Disabled reason |
| `action-feedback` | p role=status | "Applied: ..." |
| `history-list` | ol | Your actions |
| `history-item` | li | `data-action-id`, `data-time`, `data-effect` (`helpful|harmful|diagnostic|none`) |
| `metrics-strip` | section | |
| `spark` | div | `data-metric` (`p99|errors|saturation|queue|cache-hit`), `data-value`, `data-status` |
| `spark-status` | span | Status label text |
| `out-of-budget-banner` | div | "Out of pager budget." with countdown |
| `resolved-banner` | div | "Resolved at T+02:41. The pager goes quiet." |
| `open-debrief` | button | "Open debrief" |
| `hint-dialog` | dialog | |
| `hint-confirm`, `hint-cancel` | button | "Take hint", "Cancel" (focus) |
| `hint-text` | p | The hint line once taken |
| `shortcuts-dialog` | dialog | Keys table |
| `shortcuts-close` | button | "Close" |
| `debrief-view` | section | `data-scenario`, `data-seed`, `data-result`, `data-score`, `data-time-to-mitigate`, `data-budget-left`, `data-harmful-count`, `data-hint-used`, `data-state-hash` |
| `result-title` | h1 | "Resolved" or "Out of pager budget", tabindex -1 |
| `result-card` | section | |
| `score-value` | span | Number 0-100 |
| `result-tier` | span | Textbook, Solid, Survived, Escalated |
| `score-time` | div | "02:41" and "Optimal 01:50", or "Not mitigated" |
| `score-pager` | div | "4 / 6" and "2 spent" |
| `score-collateral` | div | "1 harmful step" |
| `run-fingerprint` | span | "Run fingerprint 9c41ab07" |
| `replay` | section | |
| `replay-lane-you`, `replay-lane-optimal` | div | Lanes |
| `replay-mark` | button | `data-lane`, `data-action-id`, `data-time`, `data-kind` (`D|F|x|.`); text is the letter |
| `replay-slider` | input range | Label "Replay position", `aria-valuetext` |
| `replay-play` | button | "Play replay" or "Pause replay" |
| `replay-map` | div | Static mini map; contains `replay-node` (`data-node`, `data-status`) |
| `replay-narration` | p | "T+00:42. You scaled the service. ..." |
| `replay-unavailable` | p | Replay not possible message |
| `steps-table` | table | Text alternative: Step, You, Optimal, Effect |
| `step-row` | tr | `data-lane` (`you|optimal`), `data-index`, `data-action-id`, `data-effect` |
| `harmful-badge` | span | "Harmful" |
| `step-why` | p | Explanation for a harmful step |
| `root-cause` | p | At most 72ch |
| `concept` | p | At most 72ch |
| `guide-link` | a | `href`, target blank, rel noopener noreferrer |
| `copy-result` | button | "Copy result" |
| `copy-status` | span role=status | "Copied" or the failure text |
| `share-text` | pre | Exact copied text |
| `retry-seed` | button | "Retry this seed" |
| `back-to-board` | a | "Back to incidents" |
| `data-view` | section | Your data screen |
| `data-summary` | p | "3 incidents resolved." |
| `data-run-row` | li | `data-scenario`, `data-best-time`, `data-score` |
| `export-button` | button | "Export progress" |
| `import-input` | input type=file | Label "Import progress file" |
| `import-status` | p role=status | "Imported 3 incidents." |
| `import-error` | p role=alert | "Import rejected: ..." |
| `import-confirm-dialog` | dialog | |
| `import-confirm`, `import-cancel` | button | "Replace progress", "Cancel" (focus) |
| `clear-button` | button | "Clear progress" |
| `clear-dialog` | dialog | |
| `clear-confirm`, `clear-cancel` | button | "Clear progress", "Cancel" (focus) |
| `about-view` | section | |
| `attribution-text` | p | Credit text |
| `attribution-link`, `license-link` | a | Credit and licence links |
| `about-privacy` | p | No accounts, no tracking |
| `schema-docs` | section | Scenario file format table |

## Journeys

### J1. First run, the wow moment (SC1)
1. Person runs `node src/server.js`. Terminal prints `Incident Simulator running at http://localhost:3000`, then `Loaded 10 scenarios.`
2. They open the address. No sign-in, banner, modal or tutorial. The play screen opens at once on `cache-stampede`: a calm map with dots flowing, all nodes `OK`, clock at `T+00:00`, pager lamps full, the inspector saying "Select a node to inspect it. Press I, or click one."
3. At about T+00:04 the cache node flashes (pulse), the p99 sparkline climbs, the DB saturation bar fills into the hatched zone, and at about T+00:06 a toast and an alert row appear: `SEV2: checkout p99 > 2 s`. At least one node shows `CRIT` with the diamond shape. The assertive live region announces the page.
4. They press `i` (or click the cache). The inspector opens on the earliest-affected node (the cache) with a log line hinting at the cause. They are playing before reading any instruction.

### J2. Diagnose and fix a cache stampede (SC2)
1. In the inspector they read `00:07  WARN  1,842 misses for key product:42 in 1 s`.
2. They press `a`, move to `Add TTL jitter` (cost shown as `Cost 1`), press Enter. Feedback: `Applied: Add TTL jitter. Pager 5 / 6. Takes effect next tick.` The action appears in the Your actions list and as an `action` log line.
3. Within 2 simulated seconds DB saturation starts falling; within 30 simulated seconds the sparklines return to `OK` and alerts clear one by one (J14). The header shows `Resolved at T+00:41. The pager goes quiet.` and the button `Open debrief` appears.
4. Debrief shows the result card, the replay, root cause, concept and a working link `Read the guide: How can cache systems go wrong` to `https://bytebytego.com/guides/how-can-cache-systems-go-wrong`.

### J3. A wrong fix makes it worse (SC3)
1. On `connection-pool-exhaustion` they choose `Scale service`. Within 2 simulated seconds DB saturation and service error rate rise; the log shows `too many connections`; a `warn` toast appears.
2. The Your actions list marks the step `Harmful`. They apply `Raise pool size` and resolve.
3. Debrief marks the scale step `Harmful` in both the lane (`x`) and the table, and `Why that step hurt` explains the moved bottleneck in our words.

### J4. A boss that one action cannot solve (SC4)
1. On `cascading-failure` any single fix leaves at least one alert firing (`data-alert-count` above 0 after 30 simulated seconds).
2. Only the documented ordered sequence (for example shed load, circuit breaker, scale service) resolves it.
3. Debrief shows the optimal path in the Optimal lane next to the player's lane and in the table.

### J5. Same seed, same incident; daily and game-day (SC5)
1. The incident board's top card shows today's incident, its date `2026-11-19`, number `#323` and `Seed 48213`. The same date gives every player the same scenario and seed.
2. A team lead types a seed into the board's Seed field and starts any incident; teammates enter the same number. The header seed chip shows `Seed 48213`; the debrief shows the same run fingerprint when the same actions were taken at the same ticks.

### J6. Running out of pager budget (SC6)
1. Every action row shows `Cost n` (or `Free`) before it is chosen; hovering or focusing previews the lamps that would go dark.
2. When the budget reaches 0, the banner `Out of pager budget. Actions are off. Watching 10 s to see if your last fix lands.` shows with a countdown; priced actions become `aria-disabled` with the reason; `i` (read-only inspect) still works.
3. If the last fix lands the incident resolves. Otherwise after 10 simulated seconds `Open debrief` appears. The debrief says `Out of pager budget`, still reveals the root cause, concept and guide link.

### J7. Keyboard only (SC7)
1. Tab: skip link, header navigation, header controls, then one tab stop on the map (the selected node, roving).
2. Arrow keys move between nodes spatially; Enter or `i` inspects; focus moves to the inspector title. `l` focuses the log list. Escape returns focus to the node. `a` moves focus into the action list; Up and Down move; Enter applies. Space pauses and resumes. `d` or Tab to `Open debrief`, Enter. In the debrief Tab reaches the guide link; Enter opens it in a new tab.
3. Focus is always visible (3 px warm-white ring). New pages are announced through the assertive live region; other results through the polite one.

### J8. Text mode and reduced motion (SC8)
1. `t` or the Text mode switch replaces the map with a table of nodes, metrics, alerts and logs. No canvas exists. The clock runs only when they act or step (after an action it advances 2 s, then pauses); `Step 1 s`, `Step 5 s` and `Run` control time. The same incident can be finished.
2. With `prefers-reduced-motion: reduce` the map stays but dots, pulses and shakes stop; edges show thickness and rate labels, nodes show queue numbers, metrics repaint every 2 simulated seconds. Everything remains playable.

### J9. Broken scenario files (SC9)
1. A scenario file is missing `rootCause`, names an unknown action id, or has a `guideUrl` outside `https://bytebytego.com/guides/`. The server prints `scenario error: ...` naming the file and field and keeps running.
2. The incident board lists only valid scenarios and shows `2 scenario files could not be loaded` with a `Scenario problems` disclosure listing each `file`, `field` and message plus how to fix it. The game never crashes.

### J10. Progress round trip (SC10)
1. After 3 finished incidents `#/data` shows `3 incidents resolved.` and a row per incident with best time and score.
2. `Export progress` downloads `incident-sim-progress-2026-11-19.json`. The person clears site data. `#/data` now shows "No incidents resolved yet. Your first one is a click away." They choose the file in `Import progress file`: `Imported 3 incidents.` The same rows, scores and best times are back, and the board shows them as resolved.

### J11. Hostile import (SC11)
1. A file over 256 KB, a non-JSON file, JSON with `__proto__` or `constructor` keys, or JSON with markup in a name field is chosen.
2. `Import rejected: <reason> Your saved progress was not changed.` appears in an alert. Stored progress is byte-identical, no script runs, `Object.prototype` is unchanged. The reason names a field path or key (truncated to 40 characters, set as text) and never echoes a value.

### J12. Share and credits (SC12)
1. In the debrief `Copy result` puts the two-line plain-text summary on the clipboard; status `Copied`. If the clipboard is denied the text is shown selected with "Could not copy. Select the text above and copy it by hand."
2. The page makes no request outside its own origin. `About` credits ByteByteGo system-design-101 under CC BY-NC-SA 4.0 with links.

### J13. Pause, step and hint (open questions 1 and 3)
1. Space pauses (`Paused.`); while paused `Step 1 s` (`.`) and `Step 5 s` (`>`) appear. Space resumes.
2. `h` opens "Take one hint?" with "It costs score, not pager." Confirming shows one hint line from the scenario; the hint is one per incident.

### J14. Resolution moment (design bar "feel")
1. When the last alert's condition clears the sim stops, the clock freezes, the header shows `Resolved at T+02:41. The pager goes quiet.`
2. Alerts switch to `Cleared` one by one, 300 ms apart (all at once under reduced motion); no confetti. The dots calm to baseline. Focus does not move; the polite live region says `Resolved at T+02:41. Open the debrief.`

### J15. On a phone (brief: must work, not optimised)
1. At 390 px the mission bar sticks at the top; the tall map sits under it; tabs `Pages`, `Inspect`, `Actions`, `Metrics` follow. Tapping a node opens Inspect. A full incident can be played by taps.

## Screens and states

### App shell
Header `banner` (56 px desktop): wordmark `incident-sim` (link to the board), nav links `Incidents`, `Your data`, `About`. On the play screen the header also shows the seed chip, mission clock, pager lamps and controls. Tab order: skip link, nav, header controls, main. `status-live` and `alert-live` are always in the DOM, visually hidden.

- **Loading** (fetching `scenarios/index.json`, over 300 ms): `[t=boot-loading]` skeleton map with dashed node outlines and "Plugging in the pager...". After 8 s it becomes the load error.
- **Load error**: `[t=app-error]` with "Could not load the incidents. Check that the server is still running (node src/server.js), then try again." and `[t=app-retry]` "Try again". Focus moves to the message.
- **Storage blocked**: `[t=storage-warning]` (role status) on every screen until reload: "This browser is blocking storage, so progress will not be saved. You can still play and use Export on the Your data page."
- **Engine exception**: `[t=app-error]` "The simulator hit an unexpected error. Your saved progress is safe. Reload to restart this incident; the seed is 48213." with `[t=app-reload]` "Reload".

### Incident board (`#/incidents`)
- Heading h1 "Incident board".
- Daily card `[t=daily-card]`: kicker `TODAY · 2026-11-19 · #323`, incident title, difficulty, "Same incident and seed for everyone on this date.", "Seed 48213", button `[t=daily-start]` "Start today's incident". The first run (profile with no progress) skips the board and starts `cache-stampede`; the daily card appears here afterwards.
- Seed field `[t=seed-input]` "Seed (optional)", hint "Leave blank for the standard seed. Share a number to replay the same incident with a team." The seed applies to whichever Start control is used next. Invalid value: inline error "Seed must be a whole number from 0 to 4294967295." in `[t=seed-error]`, focus on the field, nothing starts.
- List `[t=incident-list]` "All incidents", one row each: title, one-line concept (original text), `Difficulty 2 of 3` with filled squares, state (`New`, `Resolved`, `Out of budget`; shape plus text), `Best 02:41` or `Not tried`, link `[t=incident-start]` "Start". Row link names include the title: "Start Cache stampede".
- Partial: `[t=scenario-errors]` (a `details`) summary "2 scenario files could not be loaded"; each `[t=scenario-error-item]` reads `scenarios/bad-guide.json: field "guideUrl": must start with https://bytebytego.com/guides/. Fix the file and restart the server.` Valid scenarios stay listed.
- Empty (zero valid): `[t=picker-empty]` "No incidents on the board. Every scenario file failed validation, so there is nothing to run. Open Scenario problems to see which file and field to fix, then restart the server." The daily card is hidden.
- Long or hostile titles: single line with ellipsis in rows (the full title is in the play h1 and debrief, which wrap); no horizontal scroll.

### Live incident (`#/play/<id>`)
Regions, desktop (1280): left main column holds `system-map` (or `text-view`) over `metrics-strip`; the 360 px rail holds `alerts-panel`, `inspect-panel`, `action-panel`. Below 1024 px: tabs `Pages`, `Inspect`, `Actions`, `Metrics` (`role=tablist`) under the map; the map and the sticky mission bar stay visible.

Header controls (tab order): `pause-button` ("Pause" or "Resume", `aria-pressed` reflects paused), `step-button` and `step-5-button` (only when paused or in text mode), `hint-button` ("Hint"), `mode-toggle` ("Text mode", `role=switch`), `shortcuts-toggle` ("Shortcuts", `role=switch`, on by default), `help-button` ("Keys").

States:
- **Calm** (before onset): all nodes `OK`, dots at baseline, log lines `INFO`.
- **Incident**: statuses per node, alerts firing, toasts (max 3, 8 s, no controls).
- **Paused**: `data-status="paused"`, clock frozen, header chip `Paused`, dots freeze on one frame.
- **Budget zero (grace)**: out-of-budget banner with a 10 s countdown; priced actions disabled with reason "Out of pager budget."; `inspect` still free.
- **Resolved**: sim stopped, `[t=resolved-banner]` "Resolved at T+02:41. The pager goes quiet." and `[t=open-debrief]` "Open debrief".
- **Out of budget (final)**: `[t=out-of-budget-banner]` "Out of pager budget." with `[t=open-debrief]`; `data-status="out-of-budget"`.
- Reload mid-incident restarts it at T+00:00 with the same seed.

**Map** `[t=system-map]`: see `design-direction.md` section 7. Each node `[t=map-node]` is `role=button`, roving `tabindex`, accessible name like `Cache. CRIT. Saturation 91 percent. p99 2140 milliseconds. Errors 6.2 percent. Press I to inspect, A for actions.` (updated on state change; not a live region). Click or Enter selects and inspects. Space on a node pauses (documented in the keys dialog) instead of activating it, because Space is the brief's pause key. Edges `[t=map-edge]` are not focusable; their values are in the node names, text mode and the inspector.

**Text mode** `[t=text-view]`: caption "System status"; `table` with columns Node, Status, p50, p99, Errors, Saturation, Queue, Hit rate; each row `[t=text-row]` has a button in the first cell that selects the node. Status cell has shape plus text (`WARN`). Below it the same alerts, inspector, actions and sparkline panels. Banner "Text mode: the clock runs only when you act or step." Auto-pause: after an action the sim advances 2 s and pauses; `Run` resumes real time.

**Alerts** `[t=alerts-panel]` h2 "Pages" with count. Row `[t=alert-item]` is a button that selects the affected node: `SEV2 · checkout p99 > 2 s · since T+00:06`; cleared: `Cleared · SEV2 · checkout p99 > 2 s · T+00:31`. Empty `[t=alerts-empty]` "No pages. Enjoy it while it lasts."

**Inspect panel** `[t=inspect-panel]` h2 `[t=inspect-title]` "Cache" with status badge `[t=inspect-status]`; metrics `[t=inspect-metrics]` (p50, p99, Errors, Saturation, Queue, Hit rate, each `[t=metric-value]` with `data-metric`, `data-value`); `[t=log-list]` (scrollable, `tabindex=0`, `aria-label="Logs for Cache"`, newest at the bottom, stays pinned unless the person scrolls up, with a `Jump to latest` button when pinned off); `[t=log-line]` rows `00:07  WARN  1,842 misses for key product:42 in 1 s`. Empty: `[t=inspect-empty]` "Select a node to inspect it. Press I, or click one." and `[t=log-empty]` "Quiet. Nothing logged for Cache yet. Logs fill in as traffic flows." Diagnostic output (trace, tail, compare, deploy history) renders in `[t=diag-result]` under the metrics as plain text lines, kept until replaced.

**Action panel** `[t=action-panel]` h2 "Actions" with the line "Target: Cache" when a node is selected. Groups `Diagnose` then `Fix`, in a fixed order that never depends on the selected node (no hint leakage). Row `[t=action-item]` shows name, one-line effect, `[t=action-cost]`. States: `enabled`; `disabled` with `[t=action-reason]` ("Not enough pager. It costs 2 and you have 1.", "Out of pager budget.", "Works on a service. Select one first."); `applied` for persistent fixes (reason "Already on."). Disabled rows use `aria-disabled`, stay focusable and keep their reason in `aria-describedby`. Feedback in `[t=action-feedback]` (role status) and `status-live`. Your actions `[t=history-list]` with `[t=history-item]` shows what you did, with `data-effect` set once known and the text `Harmful` plus the `x` shape when an action raised saturation or errors in the next 5 simulated seconds.

**Metrics strip** `[t=metrics-strip]`: five `[t=spark]` tiles with `data-metric`, `data-value`, `data-status`; each has `[t=spark-status]` label text. Phone: 2 columns.

**Pager and clock**: `[t=pager-lamps]` (`role=group`, `aria-label="Pager budget: 4 of 6 left"`) with `[t=pager-lamp]` children and `[t=pager-text]` "Pager 4 / 6". `[t=mission-clock]` "T+02:41" with `data-seconds`.

### Debrief (`#/debrief/<id>`)
h1 is the result: `Resolved` or `Out of pager budget` (`[t=result-title]`, focus moves here on arrival). Layout in `design-direction.md` sections 12 and 13. Regions: `[t=result-card]` (score, tier, three stats, fingerprint), `[t=replay]` (status ribbon, p99 trace, two lanes, slider, mini map, narration), `[t=steps-table]` text alternative, story column (`[t=root-cause]`, `[t=concept]`, `[t=step-why]` for each harmful step, `[t=guide-link]`), actions `[t=copy-result]`, `[t=retry-seed]`, `[t=back-to-board]`, and `[t=share-text]` with `[t=copy-status]`. A hint taken shows "Hint used (-5 score)" in the stat strip (value from the engine).
- Out of budget: result title "Out of pager budget", time to mitigate "Not mitigated", root cause still shown.
- Replay unavailable (the saved run no longer replays, for example the scenario file changed): `[t=replay-unavailable]` "This run cannot be replayed because the scenario file changed since you played it. Your score is still saved." The table and story still show.
- Hostile content in scenario text renders literally; line length of prose at most 72ch.

### Your data (`#/data`)
h1 "Your data": intro "Progress lives in this browser only. Export it before clearing site data." `[t=data-summary]` ("3 incidents resolved." or "No incidents resolved yet. Your first one is a click away." with a link `Go to the incident board`), rows `[t=data-run-row]`, `[t=export-button]` "Export progress", file input `[t=import-input]` labelled "Import progress file" (hint "JSON file up to 256 KB, exported from this page."), `[t=import-status]` (role status), `[t=import-error]` (role alert), `[t=clear-button]` "Clear progress".
- Import when saved progress is non-empty opens `[t=import-confirm-dialog]` "Replace saved progress?" "This replaces 2 saved incidents with 3 from the file. This cannot be undone." (`[t=import-confirm]` "Replace progress", `[t=import-cancel]` "Cancel", focus on Cancel). When nothing is saved it imports directly.
- Clear opens `[t=clear-dialog]` "Clear all saved progress?" "This deletes 3 saved incidents from this browser. Export first if you want a copy." (`[t=clear-confirm]` "Clear progress", `[t=clear-cancel]` "Cancel", focus on Cancel).
- Storage key: `incident-sim:v1`. Progress file format the UI accepts (versioned, strict): `{ "version": 1, "runs": [ { "scenario": "<id>", "seed": <integer>, "result": "resolved|out-of-budget", "timeToMitigate": <seconds or null>, "budgetLeft": <integer>, "harmful": <integer>, "hintUsed": <boolean>, "score": <0-100>, "actions": [ { "t": <seconds>, "id": "<action id>" } ] } ] }`. At most 200 runs, 256 KB. Unknown keys, wrong types, ids not on the known list, and `__proto__`, `constructor` and `prototype` keys anywhere are rejected. Best times and scores are derived from `runs`; the file carries no names or free text.

### About (`#/about`)
h1 "About". `[t=attribution-text]`: "Incident Simulator teaches reliability patterns using the guides in ByteByteGo's system-design-101. We link to the guides and wrote every scenario, debrief and label ourselves; we copied no guide text or images. system-design-101 is licensed CC BY-NC-SA 4.0, so this project is for non-commercial use." Links `[t=attribution-link]` "ByteByteGo system-design-101 on GitHub" (`https://github.com/ByteByteGoHq/system-design-101`) and `[t=license-link]` "CC BY-NC-SA 4.0" (`https://creativecommons.org/licenses/by-nc-sa/4.0/`). Both `target=_blank`, `rel="noopener noreferrer"`, visible text followed by "(opens in new tab)". Also `[t=about-privacy]` "No accounts, no tracking, no network calls while you play. Progress stays in this browser." and `[t=schema-docs]` "Scenario file format": a table of the fields below.

Scenario file schema (what the UI shows in errors and in About; the engine spec owns exact keys, the UI requires these to exist and be of the stated kind):

| Field | Kind and rule | Shown in UI as |
|---|---|---|
| `id` | string `^[a-z0-9-]{1,40}$`, equals file name | Route and `data-scenario` |
| `title` | non-empty string, up to 80 characters | Row title, play h1 |
| `difficulty` | integer 1 to 3 | `Difficulty 2 of 3` |
| `summary` | non-empty string (the one-line concept) | Board row |
| `budget` | integer 1 to 12 | Pager lamps |
| `topology` | nodes drawn, all ids from the known node list | Map |
| `onset`, `alerts`, `logs`, `faults` | engine-defined, validated by the shared validator | Alerts, logs, sparklines |
| `hint` | non-empty string | Hint dialog |
| `rootCause` | non-empty string | Debrief |
| `concept` | non-empty string, our own words | Debrief |
| `harmfulWhy` | object: action id to explanation | `Why that step hurt` |
| `optimalPath` | non-empty array of known action ids in order | Optimal lane |
| `guideUrl` | string starting `https://bytebytego.com/guides/` and listed in the pinned README table of contents | Guide link |
| every action id used | one of the known action ids | Action panel |

Error message format everywhere: `scenarios/<file>.json: field "<path>": <what is wrong>. Expected: <what is expected>.` Examples: `scenarios/no-root-cause.json: field "rootCause": missing. Expected: a non-empty string.`; `scenarios/bad-action.json: field "optimalPath[1]": unknown action "reboot-everything". Expected: one of scale-service, add-ttl-jitter, ...`; `scenarios/bad-guide.json: field "guideUrl": "https://example.com/x" is not allowed. Expected: a URL starting with https://bytebytego.com/guides/.` On the board each item adds "Fix the file and restart the server."

### Dialogs
Native `<dialog>` with `showModal()`, `aria-labelledby`, focus trapped, Escape closes and returns focus to the opener. Dialogs: `[t=hint-dialog]` (`[t=hint-confirm]` "Take hint", `[t=hint-cancel]` "Cancel", focus on Cancel), `[t=shortcuts-dialog]` (keys table, `[t=shortcuts-close]` "Close"), import and clear dialogs above.

## Keyboard model

Single-character shortcuts work only when focus is not in a text field, select, dialog or textarea, and no Ctrl, Alt or Meta key is held. They can be turned off with the `Shortcuts` switch (WCAG 2.1.4); the setting persists in `incident-sim:settings` (not exported). Every shortcut has a visible control.

| Key | Where | Does |
|---|---|---|
| Tab / Shift+Tab | everywhere | Standard order |
| Arrow keys | map | Move selection to the nearest node in that direction (roving tabindex, focus follows) |
| Home / End | map | First or last node in reading order |
| Enter | map node | Select and inspect (same as `i`) |
| `i` | play | Inspect the selected node; with none selected, the earliest node that is still non-OK, or Clients when all are OK. Moves focus to the inspector title |
| `a` | play | Focus the first enabled action |
| Up / Down | action list | Move between actions |
| Enter | action row | Apply the action |
| `1` to `9` | action list focused | Jump to the nth action (does not apply it) |
| `l` | play | Focus the log list |
| `s` | play | Say status: polite announcement such as "2 nodes failing, 1 warning. Worst: Cache, saturation 91 percent." |
| `[` / `]` | play | Select the previous or next node with a firing alert |
| Space | play, focus on body or map | Pause or resume. On a button, Space activates the button as usual |
| `.` | paused or text mode | Step 1 s |
| `>` | paused or text mode | Step 5 s |
| `t` | play | Toggle text mode |
| `h` | play | Open the hint dialog |
| `d` | play, when resolved or out of budget | Open the debrief |
| `?` | everywhere | Open the keys dialog |
| Escape | dialogs, panels | Close dialog; from the rail return focus to the selected node |
| `c`, `r`, `b` | debrief | Copy result, Retry this seed, Back to incidents |
| Left / Right, Shift+Left / Right, Home / End | replay slider | 1 s, 10 s, start, end |
| `[` / `]` | replay | Previous or next action mark |

Focus after actions: apply an action keeps focus on its row (disabled rows are `aria-disabled`, so focus is never lost); inspect moves focus to the inspector title; Escape returns to the node; opening the debrief moves focus to `result-title`; closing a dialog returns focus to its opener; route change focuses the h1 (except the first-run autostart, which leaves focus at the start of the page).

## Copy

Voice rules: dry on-call humour, at most one joke per screen, never in a fix instruction or an error's recovery step. Sentence case. No exclamation marks, no emoji, no "Oops". Errors say what went wrong and how to fix it. Numbers are given in full.

| Where | Text |
|---|---|
| Product | Incident Simulator; wordmark `incident-sim` |
| Skip link | Skip to main content |
| Nav | Incidents, Your data, About |
| Header controls | Pause, Resume, Step 1 s, Step 5 s, Run, Hint, Text mode, Shortcuts, Keys |
| Seed chip, clock, pager | Seed 48213; T+02:41; Pager 4 / 6 |
| Paused | Paused. / Running. (live text) |
| Inspector empty | Select a node to inspect it. Press I, or click one. |
| Log empty | Quiet. Nothing logged for Cache yet. Logs fill in as traffic flows. |
| Log line | `00:07  WARN  1,842 misses for key product:42 in 1 s` |
| Alerts empty | No pages. Enjoy it while it lasts. |
| Alert row | SEV2 · checkout p99 > 2 s · since T+00:06 / Cleared · SEV2 · checkout p99 > 2 s · T+00:31 |
| Page (live) | Page. SEV2: checkout p99 > 2 s. |
| Several pages (live) | 2 new pages. SEV1: DB primary down. SEV2: checkout p99 > 2 s. |
| Cleared (live) | Cleared: checkout p99 > 2 s. |
| Toast kickers | PAGE, WARN, CLEARED, NOTE |
| Action names and one-liners | Inspect: Read this node's metrics and recent logs. Trace request: Follow one slow request through the system and see where it waits. Tail logs: Stream the last 30 seconds of logs from every node, not just this one. Compare dashboards: Line up every node's metrics against five minutes ago. Deploy history: See what shipped recently and when. Scale service: Add instances behind the load balancer. Add TTL jitter: Spread cache expiry times so keys stop expiring together, and coalesce duplicate reloads. Circuit breaker: Stop calling a failing dependency and fail fast instead. Backoff with jitter: Make clients wait longer, and randomly, between retries. Shed load: Reject a slice of low-priority requests at the edge. Failover: Promote the replica to primary. Shard or rekey: Split a hot key across partitions. Add index: Add a database index for the slow query. Rollback: Return the service to the previous release. Raise pool size: Allow more connections per service instance. Renew certificate: Issue a new TLS certificate and reload it. |
| Cost chip | Cost 2 / Free |
| Cost preview (description) | Costs 2 of your 4 remaining pager. |
| Disabled reasons | Not enough pager. It costs 2 and you have 1. / Out of pager budget. / Works on a service. Select one first. / Already on. |
| Action feedback | Applied: Add TTL jitter. Pager 5 / 6. Takes effect next tick. / Ran: Trace request. Pager 4 / 5. |
| Harmful marker | Harmful |
| Budget zero | Out of pager budget. Actions are off. Watching 10 s to see if your last fix lands. (countdown: Watching: 7 s left) |
| Resolved | Resolved at T+02:41. The pager goes quiet. (live: Resolved at T+02:41. Open the debrief.) |
| Open debrief | Open debrief |
| Text mode | Text mode: the clock runs only when you act or step. |
| Status summary (live) | 2 nodes failing, 1 warning. Worst: Cache, saturation 91 percent. / All nodes healthy. |
| Hint dialog | Take one hint? / It costs score, not pager. / Take hint, Cancel / after use: Hint used |
| Shortcuts dialog | Keyboard shortcuts / Close |
| Board | Incident board / TODAY · 2026-11-19 · #323 / Same incident and seed for everyone on this date. / Start today's incident / Seed (optional) / All incidents / New, Resolved, Out of budget / Best 02:41, Not tried / Difficulty 2 of 3 / Start |
| Seed hint and error | Leave blank for the standard seed. Share a number to replay the same incident with a team. / Seed must be a whole number from 0 to 4294967295. |
| Scenario problems | 2 scenario files could not be loaded / Scenario problems / the error format above |
| Picker empty | No incidents on the board. Every scenario file failed validation, so there is nothing to run. Open Scenario problems to see which file and field to fix, then restart the server. |
| Unknown incident | That incident is not on the board. It may have been renamed, or its file failed validation. / Back to the incident board |
| Debrief | Resolved / Out of pager budget / Pager quiet at T+02:41. / The incident outlived your budget. The root cause is below, so it was not for nothing. / Time to mitigate / Optimal 01:50 / Not mitigated / Pager left / Collateral / 1 harmful step / 0 harmful steps / Peak errors 14% / Run fingerprint 9c41ab07 / Replay / Replay position / Play replay / Pause replay / Your steps and the optimal path / What happened / The concept / Why that step hurt / Read the guide: How can cache systems go wrong / (opens in new tab) / Copy result / Retry this seed / Back to incidents / Helped, Harmful, Diagnostic, No effect |
| Tiers | Textbook, Solid, Survived, Escalated |
| Share | Copied / Could not copy. Select the text above and copy it by hand. |
| Replay unavailable | This run cannot be replayed because the scenario file changed since you played it. Your score is still saved. |
| Data | Your data / Progress lives in this browser only. Export it before clearing site data. / 3 incidents resolved. / 1 incident resolved. / No incidents resolved yet. Your first one is a click away. / Export progress / Import progress file / JSON file up to 256 KB, exported from this page. / Imported 3 incidents. / Clear progress / Progress cleared. |
| Confirms | Replace saved progress? This replaces 2 saved incidents with 3 from the file. This cannot be undone. (Replace progress, Cancel) / Clear all saved progress? This deletes 3 saved incidents from this browser. Export first if you want a copy. (Clear progress, Cancel) |
| Import rejected (each ends "Your saved progress was not changed.") | Import rejected: the file is 312 KB and the limit is 256 KB. / Import rejected: the file is not valid JSON. Export a fresh file from this page and try again. / Import rejected: the file contains the key "__proto__", which is not allowed. / Import rejected: field "runs[0].name" is not part of the progress format. / Import rejected: field "runs[0].scenario" must use only lowercase letters, digits and hyphens. / Import rejected: this file is version 7 and this app reads version 1. / Import rejected: "runs[1].scenario" names an incident this copy does not have. / Import rejected: the file holds 240 runs and the limit is 200. |
| Loading and errors | Plugging in the pager... / Could not load the incidents. Check that the server is still running (node src/server.js), then try again. / Try again / The simulator hit an unexpected error. Your saved progress is safe. Reload to restart this incident; the seed is 48213. / Reload / This browser is blocking storage, so progress will not be saved. You can still play and use Export on the Your data page. |
| About | See the About section; link texts "ByteByteGo system-design-101 on GitHub", "CC BY-NC-SA 4.0" |
| Phone tabs | Pages, Inspect, Actions, Metrics |
| Test banner | Test mode: speed 16x. |
| Terminal | Incident Simulator running at http://localhost:<port> / Loaded 10 scenarios. / scenario error: scenarios/<file>.json: field "<path>": ... |

## Accessibility and responsive rules

Live regions
- `[t=alert-live]` (`role=alert`, assertive): only new SEV1 and SEV2 pages, "Page. SEV2: checkout p99 > 2 s." At most one update per 3 s; pages arriving inside the window merge into "N new pages. ...". Cleared alerts and SEV3 go to the polite region.
- `[t=status-live]` (polite): action feedback, pause and resume, budget changes ("Pager 3 of 6 left."), cleared alerts, resolved, out of budget, "Copied", import and export results, status summary (`s`). Messages are cleared then set after 50 ms so repeats are re-read.
- Not live: the clock, metrics, sparklines, log lines, toasts (`aria-hidden`; the alert list and live regions carry the content). The import error and `app-error` use `role=alert`.
- Log lines are never announced automatically; `l` focuses the list and `s` summarises.

Text mode and semantics
- Text mode is a full alternative: table of nodes (real `table`, `th scope`), alerts list, logs list, actions, hint, resolve and debrief. No canvas element exists. Time control is explicit (Step and Run) so a screen-reader user is never raced by the clock.
- Landmarks: `banner`, `nav` (aria-label "Primary"), `main`, region headings for Pages, Inspector, Actions, Metrics. One h1 per screen.
- Status is always shape plus text (`OK`, `WARN`, `CRIT`, `RECV`), in the map, table, alerts, sparklines, replay and board.
- Map: `role=group` with `aria-label`; nodes are `role=button` with full accessible names; the map is not `role=img`. Tabs on phone follow the tabs pattern (arrow keys, `aria-selected`, `aria-controls`, inactive tabs `tabindex=-1`).
- Replay: slider has `aria-valuetext`; marks are buttons with names like "Your step 3: Scale service at 00:42, harmful".
- Focus ring `--focus-ring` (3 px, offset 2) on every focusable; SVG nodes use a ring element; `scroll-padding-top` at least 72 px.
- Target size: desktop controls at least 32 px high (never under 24 x 24), phone at least 44 px.
- Contrast: all pairs in `design-direction.md` section 5, tested automatically in light and dark.
- Reduced motion: `prefers-reduced-motion: reduce` sets `data-reduced-motion="true"`; replacements per `design-direction.md` section 10. Forced colours and increased contrast are supported by tokens and shapes.
- Dialogs trap focus, Escape closes, focus returns. No keyboard trap anywhere. No time limit on reading: pausing is always possible.

Responsive
- 1280x800: rail layout; map, Pages and Actions fully inside the viewport; no page scroll in play.
- 390x844: sticky mission bar, tall map, tabs, 44 px targets, 16 px inputs, `scrollWidth <= 390`.
- 320x640: no horizontal scroll (`scrollWidth <= 320`), nodes at least 136 px wide, lamps fall back to text under 340 px.

## UI acceptance checks

Setup for all checks: fresh Playwright context (empty storage) per check, Chromium at 1280 x 800 unless stated, base URL `http://localhost:<port>`. Server: `INCIDENT_SIM_TEST=1 PORT=<p> node src/server.js` unless stated. `[t=x]` means `[data-testid="x"]`. Assertions auto-wait up to 5 s. "Step 5" means press `>` once, "step 1" means press `.`. A "stepped game" is `/?paused=1#/play/<id>?seed=<n>` followed by key presses; every key press is made with focus on the body (click the page background first). Daily seeds in checks are read from the DOM, never hard-coded. Optimal paths are read from `scenarios/<id>.json` `optimalPath`.

1. (SC1) Start the server without test mode. Expect stdout to match `Incident Simulator running at http://localhost:\d+` and a line `Loaded 10 scenarios.`. Open the base URL. Expect no `dialog[open]`, no `input[type=password]`, no text matching /sign in|log in/i, `[t=play-view]` visible with `data-scenario="cache-stampede"`, `[t=system-map]` with `data-ready="true"`, at least 8 `[t=map-node]` each with a `[t=map-node-badge]` reading `OK` at load, `[t=pager-text]` matching `/^Pager (\d+) \/ \1$/`, and `[t=inspect-empty]` containing "Select a node to inspect it. Press I, or click one."
2. (SC1) Continuing without test mode and without any key press: within 10 s of page load expect `[t=alert-item][data-state="firing"]` with text containing "SEV2: checkout p99 > 2 s", a toast `[t=alert-toast][data-kind="page"]` with the same text, at least one `[t=map-node][data-status="crit"]` whose `[t=map-node-badge]` text is `CRIT` and which contains a `use[href="#ic-crit"]`, `[t=alert-live]` text equal to "Page. SEV2: checkout p99 > 2 s.", `document.title` starting `[CRIT]`, and `[t=play-view]` `data-sim-time` at most 10.
3. (SC1) Fresh context, without test mode. At 12 s after load press `i` with focus on the body: expect `[t=inspect-panel]` visible, `[t=inspect-title]` focused, `[t=inspect-panel]` `data-node` equal to `[t=play-view]` `data-selected-node` and equal to `cache`, and at least one `[t=log-line]` visible. In a second fresh context, within 30 s of load click `[t=map-node][data-node="cache"]`: the same panel opens for `cache` and the node has `data-selected="true"`.
4. (SC2) Stepped game `/?paused=1#/play/cache-stampede?seed=1`. Press `>` until `[t=alert-item][data-state="firing"]` exists (at most 3 presses). Press `i`. Expect a `[t=log-line]` whose text matches `/\d[\d,]* misses for key product:42 in 1 s/`. Press `a`: focus is on the first enabled `[t=action-item]`. Read `[t=action-item][data-action-id="add-ttl-jitter"] [t=action-cost]`: text matches `/^(Cost \d+|Free)$/` and `data-cost` equals the number. Record `data-budget-left` (B), `data-saturation` of `[t=map-node][data-node="db-primary"]` (S0) and `data-sim-time` (T). Click the action. Expect `[t=action-feedback]` containing "Applied: Add TTL jitter.", `[t=status-live]` containing "Pager", `data-budget-left` equal to B minus the cost, one `[t=history-item][data-action-id="add-ttl-jitter"]` in `[t=history-list]`. Press `.` twice: `db-primary` `data-saturation` is below S0 and a `[t=log-line][data-kind="action"]` mentioning "TTL jitter" exists. Press `>` up to 6 times: expect `data-status="resolved"` with `data-sim-time` at most T + 30, `[t=resolved-banner]` containing "Resolved at T+", and each of `[t=spark][data-metric="saturation"]` and `[t=spark][data-metric="p99"]` has `data-status="ok"`. (The thing the player just did is visible in the history and the map and was usable throughout.)
5. (SC2) Continuing: click `[t=open-debrief]`. Expect `[t=result-title]` "Resolved" focused, `[t=debrief-view]` `data-result="resolved"`, `[t=result-card]` visible with `[t=score-time]` and `[t=score-pager]`, `[t=steps-table]` with at least one `[t=step-row][data-lane="you"][data-action-id="add-ttl-jitter"]`, `[t=root-cause]` and `[t=concept]` non-empty, and `[t=guide-link]` with `href` exactly `https://bytebytego.com/guides/how-can-cache-systems-go-wrong`, `target="_blank"`, `rel` containing `noopener` and `noreferrer`, text containing "(opens in new tab)". With an abort route on `https://bytebytego.com/**`, click it: a popup page is created with that URL.
6. (SC3) Stepped game on `connection-pool-exhaustion?seed=1`. Step until a page fires. Record `data-saturation` of `db-primary` (S0) and `data-error-rate` of `service-1` (E0). Click `scale-service` (select `service-1` first if the reason reads "Works on a service. Select one first."). Press `.` five times. Expect `db-primary` `data-saturation` above S0, `service-1` `data-error-rate` above E0, and a `[t=log-line]` whose text contains "too many connections". Expect `[t=history-item][data-action-id="scale-service"]` to have `data-effect="harmful"` and show the text "Harmful". Apply `raise-pool-size`, step until resolved, open the debrief: `[t=step-row][data-lane="you"][data-action-id="scale-service"]` has `data-effect="harmful"`, one `[t=replay-mark][data-lane="you"][data-kind="x"]` exists, and its `[t=step-why]` text is non-empty.
7. (SC4) For each fix id listed by `[t=action-item][data-kind="fix"]` on `cascading-failure?seed=1` (reload per id, stepped game): step until a page fires, click that single fix (select a valid target first when asked), press `>` six times. Expect `data-status` not `resolved` and `data-alert-count` at least 1 for every id.
8. (SC4) Stepped game on `cascading-failure?seed=1`. Read `optimalPath` from the scenario file (at least 3 actions, in order). After a page fires, apply the actions in that order with `.` pressed twice between them, then press `>` until resolved. Expect `data-status="resolved"`. Open the debrief: `[t=replay-lane-optimal] [t=replay-mark]` count equals the path length; `[t=step-row][data-lane="optimal"]` action ids equal the path in order; `[t=replay-lane-you]` and `[t=replay-lane-optimal]` are both visible at the same time.
9. (SC5) In one context open two pages A and B on `/?paused=1#/play/retry-storm?seed=77`. In both: press `>` twice (T+10), apply the first action of the scenario's `optimalPath`, press `>` six times. Expect identical `data-state-hash`, identical `data-value` for all five `[t=spark]`, identical joined text of all `[t=log-line]`, identical `data-budget-left`. Finish both with the remaining path and open the debrief: identical `data-score`, identical `[t=result-card]` text.
10. (SC5, speed rule) On the test-mode server open `/?speed=64&pause-at=60#/play/retry-storm?seed=77` in page A and, in page B, `/?paused=1#/play/retry-storm?seed=77` stepped with `>` until `data-sim-time` is 60. Expect both `[t=test-banner]` texts to contain "Test mode", `data-sim-time="60"` and identical `data-state-hash` on both. With `speed=3` expect `data-speed="1"` (value ignored). Start a second server without `INCIDENT_SIM_TEST` and open `/?speed=64&paused=1#/play/cache-stampede?seed=1`: expect no `[t=test-banner]`, `data-speed="1"`, `data-status="running"` (parameters ignored), and a recorded request to `/test-mode.json` that returned 404.
11. (SC5, daily) Two contexts with `page.clock.setFixedTime("2026-11-19T10:00:00")` and `"2026-11-19T23:30:00"`; open `#/incidents` in each. Expect `[t=daily-card]` `data-scenario`, `data-seed` and `data-date="2026-11-19"` equal in both; the card text contains "Seed " followed by the `data-seed` value and `#323`. Click `[t=daily-start]` in each: `[t=seed-chip]` text is `Seed <data-seed>` and `[t=play-view]` `data-scenario` and `data-seed` match the card.
12. (SC6) Stepped game on `hot-partition?seed=1`. Before any action every `[t=action-item]` has an `[t=action-cost]` matching `/^(Cost \d+|Free)$/` and `inspect` reads "Free". Focus an item with cost 1 (Tab or arrow): `[t=pager-lamp]` elements that would go dark have `data-preview="true"` and the item's `aria-describedby` text matches `/Costs \d+ of your \d+ remaining pager/`. Repeatedly click a `[t=action-item][data-kind="diagnostic"]` with cost at least 1 until `data-budget-left="0"` (`data-budget-total` unchanged). Expect `[t=out-of-budget-banner]` visible containing "Out of pager budget.", `data-grace="true"`, every priced `[t=action-item]` has `aria-disabled="true"` with `[t=action-reason]` "Out of pager budget.", while pressing `i` still opens the inspector. Press `>` twice (10 s): `[t=open-debrief]` visible and `data-status="out-of-budget"`. Open it: `[t=result-title]` "Out of pager budget", `data-result="out-of-budget"`, `[t=root-cause]` non-empty, `[t=guide-link]` present.
13. (SC6) In a stepped game on a scenario with budget 2 and a cost-2 action, after spending 1 expect the cost-2 row `aria-disabled="true"` with `[t=action-reason]` "Not enough pager. It costs 2 and you have 1." and clicking it changes neither `data-budget-left` nor `data-actions-taken`.
14. (SC7) Keyboard only (assert via a recorder that no `mousedown` fired). Open `/?paused=1#/incidents` fresh. Press Tab: `[t=skip-link]` focused. Tab to `[t=incident-start]` for Cache stampede (within 20 presses), press Enter: URL hash is `#/play/cache-stampede` and `data-status="paused"`. Tab until a `[t=map-node]` has focus (at most 12 presses); press ArrowRight, ArrowLeft, ArrowDown, ArrowUp: each time the focused element is a `[t=map-node]` with `data-selected="true"` equal to `data-selected-node`. Press Home then End: first and last node focused. Select the cache by arrows, press `>` until a page fires, press `i`: `[t=inspect-title]` focused and "Cache". Press `l`: `[t=log-list]` focused. Press Escape: the cache node focused. Press `a`: first enabled `[t=action-item]` focused; ArrowDown moves focus to the next row; navigate to `add-ttl-jitter`, press Enter: `[t=action-feedback]` "Applied: Add TTL jitter." and focus still on that row. Press `>` until resolved; press `d`: `[t=result-title]` focused. Tab to `[t=guide-link]`, press Enter: a popup opens with a URL starting `https://bytebytego.com/guides/` (route that host to abort). At every step above the focused element's computed `outline-width` is at least 3px and `outline-style` is not `none` (for `[t=map-node]` the child `[t=map-node-ring]` has computed `stroke-width` at least 3 and stroke equal to the `--c-focus` value).
15. (SC7) Test-mode server, `/?speed=8#/play/cache-stampede?seed=1`, with a MutationObserver on `[t=alert-live]` and `[t=status-live]`. When the SEV2 page fires: `[t=alert-live]` text is "Page. SEV2: checkout p99 > 2 s." and its `role` is `alert`; `[t=status-live]` never contains "Page."; `[t=alert-live]` received at most 1 update per 3 s of simulated time; every `[t=map-node]` `aria-label` includes a status word (`OK`, `WARN`, `CRIT` or `RECV`) and "Press I to inspect"; no `[t=log-line]` text appears in either live region.
16. (SC7, WCAG 2.1.4) Stepped game. Click `[t=shortcuts-toggle]` off (`aria-checked="false"`): press `i`, `a`, `t`, `h`: nothing opens (`[t=inspect-panel]` stays on its empty state, `data-mode` stays `map`, no `[t=hint-dialog]`). Toggle on: `i` works again. Focus `[t=seed-input]` on the board and type "ia1": the field contains "ia1" and no navigation happened. Press Ctrl+I in the stepped game: no inspect.
17. (SC8) Stepped game `/?paused=1#/play/cache-stampede?seed=1`. Press `t`: `data-mode="text"`, `[t=text-view]` visible, `canvas` count 0, `[t=system-map]` absent, `[t=text-row]` count equals the node count of the scenario, `data-status="paused"`. Wait 2 s real: `data-sim-time` unchanged. Press `[t=step-5-button]` until a page fires. Click the button in `[t=text-row][data-node="cache"]`: `[t=inspect-panel]` `data-node="cache"`. Click `add-ttl-jitter`: `data-sim-time` increases by exactly 2 and `data-status="paused"` afterwards. Click `[t=step-5-button]` until resolved, click `[t=open-debrief]`: `[t=result-title]` "Resolved". Each `[t=text-row]` status cell text matches `/^(OK|WARN|CRIT|RECV)$/`.
18. (SC8) Context with `reducedMotion: "reduce"`, test-mode server, `/?speed=8#/play/retry-storm?seed=1`. Expect `data-reduced-motion="true"`; `[t=map-canvas]` `data-dots="0"` for the whole run; computed `animation-name` is `none` and `transition-duration` `0s` for `[t=map-node]` and `[t=alert-toast]`; every `[t=map-edge]` has `data-rps` and a visible `[t=edge-label]`; `[t=play-view]` `data-updated-at` is an even number in each of 20 samples; press `i`, apply the first optimal action by keyboard and reach `data-status="resolved"` (playable). With `reducedMotion: "no-preference"` the same page shows `[t=map-canvas]` `data-dots` greater than 0 after 3 s and never above `data-dot-cap` (at most 500).
19. (SC8 and design bar, motion budget; frame timing is advisory under software rendering) Normal motion, test-mode server, `/?speed=1#/play/retry-storm?seed=1`. Sample `requestAnimationFrame` deltas for 5 s once `[t=map-canvas]` `data-dots` is at least 300: at most 5% of frames above 33 ms and `data-dot-cap` not below 250. At the retry-storm peak the `[t=map-edge][data-from="service-1"][data-to="third-party"]` `data-dot-rate` is at least 3 times its value at T+00:00. On `cache-stampede?seed=1` the `[t=map-node][data-node="cache"]` `data-pile` reaches at least 12 and the `[t=map-edge][data-to="db-primary"]` `data-dot-rate` at least 4 times its baseline.
20. (SC9) Create a temp scenarios folder with: a valid copy of `cache-stampede.json`; `no-root-cause.json` (valid but `rootCause` removed); `bad-action.json` (an `optimalPath` entry `reboot-everything`); `bad-guide.json` (`guideUrl` `https://example.com/x`). Start the server with `SCENARIOS_DIR=<tmp>`. Expect the server stays up (HTTP 200 on `/`), the server output contains `scenarios/no-root-cause.json: field "rootCause"`, `scenarios/bad-action.json: field "optimalPath[` with `reboot-everything`, and `scenarios/bad-guide.json: field "guideUrl"`. Open `#/incidents`: `[t=incident-row]` count is 1 (`data-scenario="cache-stampede"`), `[t=scenario-errors]` summary contains "3 scenario files could not be loaded", three `[t=scenario-error-item]` with `data-file` and `data-field` (`no-root-cause.json`/`rootCause`, `bad-action.json`/`optimalPath[n]`, `bad-guide.json`/`guideUrl`) whose text ends with "Fix the file and restart the server.", and no `pageerror` events. Open `#/play/no-root-cause`: `[t=not-found]` "That incident is not on the board." and `[t=not-found-back]`. With a folder where every file is invalid, `[t=picker-empty]` is visible with the empty-board text and `[t=daily-card]` is absent. Run `node --test` against that folder through the shipped scenario test: exit code is non-zero and the output names the file and field.
21. (SC9, UI errors) With `page.route` delaying `**/scenarios/index.json` by 1 s: `[t=boot-loading]` becomes visible (text "Plugging in the pager...") and is gone after load. With the route aborted: `[t=app-error]` text equals "Could not load the incidents. Check that the server is still running (node src/server.js), then try again." and focus is inside it; remove the route and click `[t=app-retry]`: the board appears.
22. (SC10) Test-mode server, speed 64. Finish `cache-stampede`, `connection-pool-exhaustion` and `expiring-certificate` using their optimal paths (stepped play, actions applied by click). Open `#/data`: `[t=data-summary]` "3 incidents resolved."; three `[t=data-run-row]`; store their `data-scenario`, `data-best-time`, `data-score`. Click `[t=export-button]` and wait for the download: filename matches `/^incident-sim-progress-\d{4}-\d{2}-\d{2}\.json$/`, the file parses and has `version` 1 and three runs. Clear site data (`localStorage.clear()` and reload): `[t=data-summary]` "No incidents resolved yet. Your first one is a click away.". Set the downloaded file on `[t=import-input]`: `[t=import-status]` "Imported 3 incidents."; the three `[t=data-run-row]` have the same `data-scenario`, `data-best-time`, `data-score`; `#/incidents` shows those three rows with `data-state="resolved"`. Importing the same file again with saved progress present opens `[t=import-confirm-dialog]` with `[t=import-cancel]` focused; cancelling leaves progress unchanged, confirming shows "Imported 3 incidents.".
23. (SC11) With saved progress present, record `localStorage.getItem("incident-sim:v1")` (L0). For each file imported via `[t=import-input]`: (a) valid JSON padded with spaces to 262145 bytes; (b) `not json {`; (c) the text `{"version":1,"runs":[{"scenario":"cache-stampede","__proto__":{"polluted":1}}]}`; (d) `{"constructor":{"prototype":{"polluted":1}}}`; (e) a progress file whose first run has `"name":"<img src=x onerror=window.__pwn=1>"`; (f) a progress file whose first run has `"scenario":"<img src=x onerror=window.__pwn=1>"`. Each time expect `[t=import-error]` visible with `role="alert"` and text starting "Import rejected:" and ending "Your saved progress was not changed.", with (a) containing "256 KB", (b) "not valid JSON", (c) `"__proto__"`, (d) `"constructor"`; `localStorage.getItem("incident-sim:v1")` strictly equals L0; `window.__pwn` is `undefined`; `({}).polluted` is `undefined` and `Object.keys(Object.prototype).length` is 0; `[t=data-view] img` count 0; no `dialog` event from the page; no request other than same-origin files.
24. (SC12) Finish `cache-stampede` (as in check 4) and open the debrief. Grant clipboard read and write. Click `[t=copy-result]`. Expect `[t=copy-status]` "Copied", the clipboard text equal to the exact text content of `[t=share-text]`, exactly 2 lines, line 1 matching `/^incident-sim (#\d+|seed:\d+) [a-z0-9-]+  \[[DFx. ]*\]  \d+\/\d+ pager  (\d{2}:\d{2}|OUT)$/`, line 2 matching `/^score \d+  optimal \d{2}:\d{2}  harmful \d+  fp [0-9a-f]{8}$/`, no `http`, no `localhost`, no emoji (`/\p{Extended_Pictographic}/u` finds nothing), at most 160 characters. Press `c` on a fresh debrief: same result. With clipboard permission denied: click `[t=copy-result]`, expect `[t=copy-status]` "Could not copy. Select the text above and copy it by hand." and `window.getSelection().toString()` equal to the `[t=share-text]` text.
25. (SC12) Register `page.on("request")` and `page.on("console")`, then visit the board, play `cache-stampede` to resolution, open the debrief, About and Your data. Expect every request URL's origin equals the base origin (guide link not clicked), no request with `resourceType` `font`, `document.fonts.size` is 0, the `/` response has a `Content-Security-Policy` header, the page has no `script:not([src])` and no console message containing "Content Security Policy", and no `img` or `link` with an external `src` or `href`.
26. (SC12) Open `#/about` through `[t=nav-about]`. Expect `[t=attribution-text]` containing "ByteByteGo's system-design-101" and "CC BY-NC-SA 4.0"; `[t=attribution-link]` `href` `https://github.com/ByteByteGoHq/system-design-101`; `[t=license-link]` `href` `https://creativecommons.org/licenses/by-nc-sa/4.0/`; both `target="_blank"`, `rel` containing `noopener` and `noreferrer`, with the text "(opens in new tab)"; `[t=about-privacy]` visible; `[t=schema-docs]` lists the fields `rootCause`, `optimalPath`, `guideUrl`; the About links are reachable by keyboard only (Tab, Enter).
27. (Board) Open `#/incidents` with a context that has saved progress (import a one-run file) so the board shows: `[t=incident-row]` count 10, each `data-difficulty` 1 to 3 with text `Difficulty n of 3`, each `[t=incident-start]` with an accessible name starting "Start ". Enter `abc` in `[t=seed-input]` and click `[t=daily-start]`: `[t=seed-error]` "Seed must be a whole number from 0 to 4294967295.", the input focused, hash unchanged. Enter `42`, click the Start link of Cache stampede: hash `#/play/cache-stampede?seed=42`, `[t=seed-chip]` "Seed 42", `data-seed="42"`. Open `#/play/nope`: `[t=not-found]` text containing "That incident is not on the board. It may have been renamed, or its file failed validation." and `[t=not-found-back]`.
28. (Pause, step, hint) Test-mode server, `/?speed=1#/play/cache-stampede?seed=1`. Press Space: `data-status="paused"`, `[t=pause-button]` text "Resume" and `aria-pressed="true"`, `[t=status-live]` "Paused."; `data-sim-time` is constant for 2 s real; `[t=step-button]` and `[t=step-5-button]` visible. Press `.`: `data-sim-time` +1; `>`: +5. Space: "Running.", time advances. Press `h`: `[t=hint-dialog]` with text "It costs score, not pager." and `[t=hint-cancel]` focused; Escape closes and focus returns to `[t=hint-button]`; press `h`, click `[t=hint-confirm]`: `[t=hint-text]` visible and non-empty, `data-hint-used="true"`, `data-budget-left` unchanged; `[t=hint-button]` has `aria-disabled="true"` and the text "Hint used".
29. (Resolution moment) Test-mode server, `/?speed=8#/play/cache-stampede?seed=1` with a MutationObserver recording timestamps of `data-state` changes on `[t=alert-item]`. After applying `add-ttl-jitter` and reaching resolved: expect `data-status="resolved"`, `data-sim-time` frozen for 2 s, every `[t=alert-item]` `data-state="resolved"`; with normal motion and more than one alert the recorded flips have distinct, increasing timestamps at least 200 ms apart; with `reducedMotion: "reduce"` all flips fall within one animation frame; `[t=resolved-banner]` text contains "Resolved at T+" and "The pager goes quiet."; `[t=status-live]` contains "Open the debrief."; focus has not moved from where it was; `document.title` starts `[OK]`.
30. (Debrief replay) After the connection-pool run of check 6, in the debrief: `[t=replay-slider]` has `min="0"`, `max` equal to the run's last second, `aria-valuetext` matching `/^\d{2}:\d{2}/`. Set it (keyboard) to the second of the harmful action: `[t=replay-map] [t=replay-node][data-node="db-primary"]` has a `data-status`; `[t=replay-narration]` text matches `/^T\+\d{2}:\d{2}\. You /` within 100 ms; ArrowRight changes `aria-valuenow` by 1, Shift+ArrowRight by 10, `]` jumps to the next `[t=replay-mark]`. Click a `[t=replay-mark]`: slider value equals that mark's `data-time`. Each `[t=replay-mark]` text is one of `D`, `F`, `x` and `data-kind` agrees. The longest rendered line in `[t=root-cause]` is at most 72ch (computed `max-width` equals the pixel width of a probe element with `width: 72ch`). Under `reducedMotion: "reduce"` `[t=replay-play]` has `aria-disabled="true"`.
31. (Typography and tokens) For the board, play (map and text mode), debrief, data and about screens: computed `font-size` of body text, `[t=root-cause]`, `[t=log-line]` and table cells is at least 16px; `[t=map-node-badge]` at least 13px; no rendered text under 12px (walk text nodes, including SVG text through its CTM); `[t=mission-clock]`, `[t=metric-value]` and `[t=log-line]` have `font-variant-numeric` containing `tabular-nums`; `[t=log-line]` `font-family` begins with the first family of `--font-mono`; `[t=mission-clock]` width is identical across 5 different values (fixed `8ch`); `public/app.css` contains no hex colour; `public/tokens.css` defines every token listed in `design-direction.md` section 4.
32. (Contrast, automated) `node --test` file `test/contrast.test.js` reads `public/tokens.css` and asserts every row of the design-direction contrast table in dark and in light (`prefers-color-scheme` block) at or above its minimum. In the browser, with `colorScheme` dark then light, compute contrast for body text, `[t=map-node-badge]` text on its fill, `[t=alert-item]` text on its tint, `[t=incident-start]`, and the focus ring against the surrounding background: at least 4.5 for text and 3 for the ring; `prefers-contrast: more` raises `--c-text-muted` contrast. Run `@axe-core/playwright` (wcag2a, wcag2aa, wcag22aa) on: board, play in map mode, play in text mode, debrief, data, about, and each open dialog: zero violations.
33. (Status never colour alone) At a moment with nodes in `warn`, `crit` and `recovering` states (retry-storm stepped to the peak and again after a fix): every `[t=map-node]` with `data-status` other than `ok` has a `[t=map-node-badge]` whose text equals `WARN`, `CRIT` or `RECV` and contains a `use` with href `#ic-warn`, `#ic-crit` or `#ic-recv` respectively; the `crit` node's saturation bar contains the hatch pattern element; every `[t=alert-item]` text starts with `SEV1`, `SEV2`, `SEV3` or `Cleared`; every `[t=spark]` has `[t=spark-status]` text; every `[t=incident-row]` state is text plus a shape. Re-run with `filter: grayscale(1)` on `html` through `page.addStyleTag` (or `emulateMedia({forcedColors:"active"})`): each status is still identifiable from the DOM label and shape. No token hue in `tokens.css` is between 250 and 330 degrees.
34. (Desktop layout) At 1280 x 800 on `/#/play/cache-stampede?seed=1`: `[t=system-map]` `data-layout="wide"`; bounding boxes of `[t=system-map]`, `[t=alerts-panel]`, `[t=action-panel]`, `[t=pager-lamps]`, `[t=mission-clock]` lie inside 1280 x 800; `document.documentElement.scrollHeight` is at most 800; `[t=alerts-panel]` left is greater than the right edge of `[t=system-map]`; `[t=system-map]` area is at least 45% of the viewport area; `[t=skip-link]` is the first Tab stop; `[t=shortcuts-dialog]` opens with `?` and Escape returns focus to the previously focused element; no focused element is covered by another (its bounding box is inside the viewport and is the `elementFromPoint` of its centre).
35. (Phone 390) Viewport 390 x 844, touch enabled, test-mode server `/?speed=8#/play/cache-stampede?seed=1`. Expect `[t=system-map]` `data-layout="tall"`, `document.documentElement.scrollWidth` at most 390, the mission bar sticky (stays visible after `scrollTo(0, 400)`), `[t=panel-tabs]` with tabs `Pages`, `Inspect`, `Actions`, `Metrics`; all buttons, tabs and `[t=alert-item]` have a bounding box height of at least 44px; the rendered font size of `[t=map-node]` labels is at least 12px. Tap `[t=map-node][data-node="cache"]` (`page.tap`): `tab-inspect` has `aria-selected="true"` and the panel shows `cache`. Tap the Actions tab, tap `add-ttl-jitter`: `[t=action-feedback]` "Applied: Add TTL jitter." Let it resolve: tap `[t=open-debrief]`, then tap `[t=copy-result]`: "Copied". Left and Right arrows on a focused tab move between tabs and inactive tabs have `tabindex="-1"`.
36. (Reflow 320) At 320 x 640 on the board, play, debrief, data and about: `scrollWidth` at most 320; map nodes at least 136px wide; a 5,000-character unbroken log line (fixture of check 37) does not create horizontal page scroll; `[t=pager-text]` visible when lamps collapse (under 340px) and on the same row as `[t=mission-clock]`; with the root font size set to 200% nothing is clipped (`scrollWidth <= clientWidth` for header and panels) and header controls wrap.
37. (Hostile scenario text) Scenario folder with an otherwise valid scenario whose `title` is 300 characters, whose `summary` is `<img src=x onerror=window.__pwn=1>`, and whose log text includes a 5,000-character unbroken string and `<script>window.__pwn=1</script>`. Register a dialog recorder. Open the board, play it, open the debrief: `window.__pwn` is `undefined`, no recorded dialog, `img` count inside `[t=incident-row]` 0, `[t=incident-row]` text contains the literal `<img src=x onerror=window.__pwn=1>`, the title in the row is on one line with ellipsis, the play h1 wraps, `[t=log-line]` contains the literal `<script>` text, no request URL ends with `/x`, and `scrollWidth` at 390 is at most 390.
38. (States) With `addInitScript` making `Storage.prototype.setItem` throw: `[t=storage-warning]` visible with "This browser is blocking storage, so progress will not be saved. You can still play and use Export on the Your data page."; play `cache-stampede` to resolution works and the debrief opens. On the test-mode server with `?fail-at=5`: `[t=app-error]` text equals "The simulator hit an unexpected error. Your saved progress is safe. Reload to restart this incident; the seed is <data-seed>." with `[t=app-reload]` available. With `#/debrief/cache-stampede` and no saved run: `[t=not-found]` visible. With a saved run whose scenario file was changed after playing: `[t=replay-unavailable]` "This run cannot be replayed because the scenario file changed since you played it. Your score is still saved." and `[t=steps-table]` still visible.
39. (Dialogs and focus) On `#/data` with saved progress: click `[t=clear-button]`: `[t=clear-dialog]` contains "Clear all saved progress?" and `[t=clear-cancel]` is focused; Escape closes and focus returns to `[t=clear-button]`; reopen and click `[t=clear-confirm]`: `[t=data-summary]` "No incidents resolved yet. Your first one is a click away." and `[t=status-live]` "Progress cleared.". Open `[t=shortcuts-dialog]` with `?`: it lists rows for `i`, `a`, `Space`, `.`, `>`, `t`, `h`, `s`, `l`, `?`; focus stays inside while tabbing 10 times; Escape returns focus. On route change to the debrief focus is on `[t=result-title]`; on the board it is on the h1.
40. (Pager lamps and score) On a finished run with budget 6 and 2 spent: `[t=pager-lamps]` has 6 `[t=pager-lamp]`, 4 with `data-state="on"` and 2 with `data-state="spent"`, `aria-label` "Pager budget: 4 of 6 left", `[t=pager-text]` "Pager 4 / 6"; the debrief `[t=score-pager]` text contains "4 / 6" and "2 spent", `[t=score-collateral]` matches `/^\d+ harmful steps?/`, `[t=score-value]` equals `data-score`, `[t=result-tier]` is one of Textbook, Solid, Survived, Escalated, and is `Escalated` when `data-result="out-of-budget"`.

### Coverage map

| SC | Journeys | Checks |
|---|---|---|
| SC1 | J1, J15 | 1, 2, 3, 35 |
| SC2 | J2 | 4, 5 |
| SC3 | J3 | 6 |
| SC4 | J4 | 7, 8 |
| SC5 | J5 | 9, 10, 11 |
| SC6 | J6 | 12, 13, 40 |
| SC7 | J7 | 14, 15, 16, 34 |
| SC8 | J8 | 17, 18, 19 |
| SC9 | J9 | 20, 21, 37 |
| SC10 | J10 | 22, 39 |
| SC11 | J11 | 23 |
| SC12 | J12 | 24, 25, 26 |
| Open questions 1 and 3 | J13 | 28 |
| Design bar (feel, motion, type, colour) | J14 | 19, 29, 30, 31, 32, 33 |
| States and responsive | all | 21, 27, 34, 35, 36, 37, 38 |
| Accessibility (WCAG 2.2 AA) | all | 14, 15, 16, 32, 33, 39 |
