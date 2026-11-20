# Spec: incident-sim (Incident Simulator)

## Goal
A solo, offline, deterministic incident game. A small live architecture breaks, the player diagnoses and fixes it before the pager budget runs out, and a debrief replays the run next to the optimal path with a link to the matching public guide. One Node 22 process (ESM, zero dependencies) serves static files only; the whole game runs in the browser. The simulation engine is pure ES modules in `public/js/engine/` and is imported unchanged by Node tests, the solver and the browser. Sources: `docs/product/incident-sim/brief.md` (SC1-SC12), `design-direction.md` (look, tokens, budgets), `ux.md` (screens, copy, testids, UI checks 1-40), `design.md` (engine, server, formats), `decisions.md`. Where this spec is stricter or more exact than those, this spec wins (see "Resolved ambiguities"; design.md wins over ux.md on engine and server details).

Licence: the source guides (ByteByteGo system-design-101) are CC BY-NC-ND 4.0. We link only and write all text ourselves. No guide text or image is copied. Non-commercial only.

## Layout (`examples/incident-sim/`)
`package.json` (`"type":"module"`, `engines.node >=22`, scripts `start`, `test`, no dependencies), `src/{server,config,http,router,scenarios-load}.js`, `public/{index.html,tokens.css,app.css,favicon.svg}`, `public/js/engine/*.js`, `public/js/core/*.js`, `public/js/dom/*.js`, `scenarios/*.json` (10), `tests/*.test.js` (unit, builder-owned), `tests/tools/solve.js`, `acceptance/*.test.js` (read-only for builders), `verify.config.json`, `README.md`.

- `engine/` (pure, no DOM, no Date, no randomness source other than the seeded PRNG): `prng hash catalogue guides conditions model engine classify replay score solver fingerprint validate template`.
- `core/` (pure browser logic, no DOM access, importable from Node): `safe-json progress settings daily share routes testmode keys announcer viewmodel debrief-model layout particles scheduler-math format`.
- `dom/` (DOM glue only, not unit-covered): `main shell board play map-svg map-canvas text-view panels debrief data-page about dialogs live storage scheduler`.
- No module in `engine/` or `core/` may touch `document`, `window`, `localStorage`, `navigator` or Node built-ins at import time. Every `engine/` and `core/` file is served at `/js/engine/<name>.js` and `/js/core/<name>.js`.

## Interface: server (exact)
Start with `node src/server.js` (also `npm start`). Env vars:
- `PORT`: unset or empty means 3000; `0` means any free port; otherwise must match `^\d+$` and be 0..65535, else stderr `PORT must be an integer from 0 to 65535` and exit 1.
- `HOST`: default `127.0.0.1`; only `127.0.0.1`, `::1` or `localhost` allowed, else stderr `HOST must be a loopback address; exposing incident-sim needs a security review` and exit 1.
- `INCIDENT_SIM_TEST`: exactly `1` turns test mode on; any other value or unset means off.
- `SCENARIOS_DIR`: default `<app root>/scenarios` (app root = the folder holding `package.json`, not cwd); realpath'd. Unreadable or not a directory: stderr `Cannot read SCENARIOS_DIR <path>` and exit 1.

Startup output (stdout, in this order): one line `scenario error: <formatted error>` per problem (files in name order, errors in document order), then once listening `Incident Simulator running at http://localhost:<actual port>` (also when HOST is `::1`), then `Loaded <n> scenarios.` (`Loaded 1 scenario.` for exactly one; `Loaded 0 scenarios.` for none; zero valid scenarios still serves). Fatal messages go to stderr with exit 1. Port taken: `Port <N> is in use`. SIGINT and SIGTERM close the server and exit 0. `uncaughtException` logs to stderr and exits 1. Tests may read stdout and stderr combined.

### Scenario loading (boot, once; no hot reload)
- Only names matching `^[a-z0-9-]{1,40}\.json$` are scenarios. A `.json` name that does not match gives an error with field `(file)`. Other extensions are ignored.
- `lstat` first: a symlink or non-regular file is an error (field `(file)`). Size over 65,536 bytes is an error. Bytes must be valid UTF-8 (fatal decode) and parse through `core/safe-json.js` (same forbidden-key and depth rules as imports). Then `validate(obj, fileName)`.
- `loadScenarios(dir)` (in `src/scenarios-load.js`, importable from Node) returns `{scenarios:[{id, bytes (Buffer), scenario}], errors:[{file, field, message}], index:{valid:[ids sorted], errors}}`.
- `index.json` is the JSON of `index` (`{"valid":[...], "errors":[{"file","field","message"}]}`), `file` being the bare name such as `bad-guide.json`.

### Request pipeline (every request, in this order; first failure wins)
1. `Host` must be exactly `localhost:<port>`, `127.0.0.1:<port>` or `[::1]:<port>`; missing or other gives 403, `text/plain; charset=utf-8`, body `This host name is not allowed.` (Node's `requireHostHeader` must be false.)
2. Method must be `GET` or `HEAD`, else 405 with `Allow: GET, HEAD` (OPTIONS, POST, PUT, DELETE, PATCH all 405). No request body is ever read. A request with `Sec-Fetch-Site: cross-site` gets 403 `This request is not allowed.` (checked after the method).
3. Path: strip the query string, then look the raw path up as an exact key in a map built at boot. Nothing is decoded and nothing is joined to a filesystem path. Entries:
   - `/` and `/index.html`: the shell, `text/html; charset=utf-8`.
   - `/app.css`, `/tokens.css` (`text/css; charset=utf-8`), `/favicon.svg` (`image/svg+xml`).
   - `/js/engine/<n>.js`, `/js/core/<n>.js`, `/js/dom/<n>.js` for files that exist in those folders at boot and match `^[a-z0-9-]+\.js$` (`text/javascript; charset=utf-8`).
   - `/scenarios/index.json` and `/scenarios/<id>.json` for valid ids only (exact bytes read at boot; `application/json; charset=utf-8`).
   - `/test-mode.json` only in test mode: 200 `{"testMode":true}`.
4. Anything else: 404, `text/plain; charset=utf-8`, body `Not found.` There is no SPA fallback (routing uses the hash). So these are 404: `/js/../src/server.js`, `/scenarios/../package.json`, `/%2e%2e/`, `/js/engine/%70rng.js`, `/js/engine/`, `/APP.CSS`, `/scenarios/invalid-id.json` (an id that failed validation), `/test-mode.json` without the env var, `/src/server.js`, `/package.json`, `/spec.md`.
- HEAD returns the same status and headers as GET with an empty body. A query string never changes the response (`/?speed=16` returns the shell).
- Handler exception: 500, `Something went wrong on the server.`, logged to stderr. A request-level `error` event is ignored.

### Headers (every response, including 403, 404, 405 and 500)
- `Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; font-src 'none'; manifest-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'`
- `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`, `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=(), clipboard-read=()`.
- `Cache-Control: no-cache` for static files and scenario files; `no-store` for `/test-mode.json` and `/scenarios/index.json`. No CORS headers.
- `index.html`: `<html lang="en">`, no `<script>` without `src`, no `<style>`, no `style=` attribute, no `on*=` attribute, one `<main id="main">`, `skip-link` as the first focusable element, always-present `status-live` (aria-live polite) and `alert-live` (role alert). Served JS and HTML contain every `data-testid` value of the ux.md table as a literal string.

### Test mode
Only the server's `INCIDENT_SIM_TEST=1` creates `/test-mode.json`. Without it the path is 404 and the client treats every test parameter as absent. The client-side parameter rules are in `core/testmode.js` (below). The test-mode server still listens on loopback only.

## Interface: engine (exact; importable from Node with no DOM)
All paths are under `public/js/`. Names are exact; return shapes are exact for the fields listed (extra fields allowed unless stated). State and all inputs/outputs are plain JSON data.

### `engine/hash.js`
- `fnv1a32(str) -> uint32` over UTF-8 bytes (offset 0x811C9DC5, `Math.imul(h ^ byte, 16777619) >>> 0`). Vectors: `""` -> `811c9dc5`, `"a"` -> `e40c292c`, `"foobar"` -> `bf9cf968` (as `hex8`).
- `hex8(n) -> 8 lowercase hex digits, zero-padded`.
- `canonicalJson(v) -> string`: object keys sorted by code unit, no whitespace, numbers via `String(n)`, arrays in order. Key order in the input never changes the output.

### `engine/prng.js`
- `next(state:uint32) -> [newState:uint32, u:number in [0,1)]` (mulberry32: `s=(s+0x6D2B79F5)>>>0; t=s; t=Math.imul(t^(t>>>15),t|1); t^=t+Math.imul(t^(t>>>7),t|61); u=((t^(t>>>14))>>>0)/4294967296`).
- `initial(scenarioId, seed) -> uint32 = fnv1a32(`${scenarioId}:${seed>>>0}`) || 0x9E3779B9`.
- Goldens (assert exactly with `===`):
  - From state `1`, the first 8 `u` are `0.6270739405881613, 0.002735721180215478, 0.5274470399599522, 0.9810509674716741, 0.9683778982143849, 0.281103502959013, 0.6128388606011868, 0.7207431411370635`.
  - `initial("cache-stampede", 1) === 991975984`; from that state the first 8 `u` are `0.13986613787710667, 0.10009580221958458, 0.5148854400031269, 0.6781341361347586, 0.7575293970294297, 0.9323439956642687, 0.75363909592852, 0.8480869282502681`.

### `engine/catalogue.js` (frozen)
- `NODE_IDS` = `clients, lb, service-1, service-2, service-3, cache, db-primary, db-replica, queue, consumer, third-party`; `NODE_TYPES` maps each to `client, lb, service, service, service, cache, db, db, queue, consumer, third-party`.
- `ACTIONS`: array of `{id, kind:"diagnostic"|"fix", appliesTo:[types], once:boolean}` in this order: `inspect` (diagnostic, any), `trace-request`, `tail-logs`, `compare-dashboards`, `deploy-history` (diagnostic, global, appliesTo `[]`), then fixes `scale-service` (service, consumer; once false), `add-ttl-jitter` (cache; once), `circuit-breaker` (service, consumer; once), `backoff-jitter` (client, service; once), `shed-load` (lb; once), `failover` (db; once), `shard-rekey` (db; once), `add-index` (db; once), `rollback` (service, consumer; once), `raise-pool-size` (service, consumer; once), `renew-cert` (lb, service, third-party; once). `ACTION_IDS`, `FIX_IDS`, `DIAGNOSTIC_IDS` derive from it (16, 11 and 5 ids; `inspect` is in `DIAGNOSTIC_IDS`).
- `DEFAULT_COST = {diagnostic:1, fix:2}`; `PARAMS` (type -> param -> `{min,max,int?,bool?,default?,required?}`), `EDGE_PARAMS`, `EDGE_RULES` exactly as design.md sections 3.1 and 6 (allowed edge directions: client>lb, lb>service, service>service|cache|db|queue|third-party, cache>db, queue>consumer, consumer>db|third-party|service, db>db for primary>replica).

### `engine/guides.js`
`GUIDES` (frozen array of exactly these 11 strings, each `https://bytebytego.com/guides/` + slug): `how-can-cache-systems-go-wrong`, `things-to-consider-when-using-cache`, `how-do-we-retry-on-failures`, `resiliency-patterns`, `a-crash-course-in-database-sharding`, `consistent-hashing`, `types-of-message-queue`, `7-must-know-strategies-to-scale-your-database`, `how-does-https-work`, `cap-theorem-one-of-the-most-misunderstood-terms`, `how-to-deploy-services`. `GUIDE_PATTERN = /^https:\/\/bytebytego\.com\/guides\/[a-z0-9-]{1,120}$/`. `isAllowedGuide(url) -> boolean` is true only for a string that matches the pattern and is in `GUIDES`. URLs are never fetched.

### `engine/validate.js`
- `validate(obj, fileName) -> {ok:true, scenario}` (deep-frozen, defaults filled) `| {ok:false, errors:[{file, field, message}]}`. `file` is the bare name (e.g. `bad-guide.json`). Errors are collected in document order, at most 10.
- `formatError({file, field, message}) -> "scenarios/<file>: field \"<field>\": <message>"`, so a full line is `scenarios/<file>.json: field "<path>": <what is wrong>. Expected: <what is expected>.`
- `MAX_FILE_BYTES = 65536`, `SCENARIO_KEYS` (array of top-level keys in the order of the schema table).

### `engine/engine.js`
- `createRun(scenario, seed, {failAtTick}={}) -> State` at tick 0 (metrics for the calm tick are computed; every node status is `ok`). `seed` is an integer 0..4294967295 (`>>> 0`).
- `step(state, actions) -> State`: pure; never mutates its arguments (the input state's `canonicalJson` is identical before and after). `actions` is `[{id, node}]`. Any `t` the caller supplies is ignored: the engine stamps `t = state.tick`. Illegal actions (per `canApply`), `inspect` and unknown ids are silently dropped (no log line, no cost). Legal actions apply in array order at `t = state.tick`; then tick `state.tick + 1` is computed. On a finished run (`status` not `running`) `step` returns an equal state. `failAtTick` makes `step` throw `EngineError("deliberate failure")` when the new tick would equal it.
- `canApply(state, id, node) -> {ok:true, target:nodeId|null} | {ok:false, reason}`. `target` is the selected node, or the only node of an applicable type, or `null` for global diagnostics. Checks run in this order and the first failing reason is returned, exactly:
  1. status not `running`: `The incident is over.`
  2. cost > 0 and `budgetLeft === 0`: `Out of pager budget.`
  3. cost > `budgetLeft`: `Not enough pager. It costs <c> and you have <b>.`
  4. fix with no resolvable target (none selected, wrong type, or several candidates): `Works on a <types>. Select one first.` where `<types>` is the `appliesTo` list joined by ` or ` (`service`, `service or consumer`).
  5. `once` fix already applied to that target: `Already on.`
  `inspect` returns `{ok:true, target:node||null, free:true}` (it is a UI read, not an engine action).
- `statusOf(state, nodeId) -> "ok"|"warn"|"crit"|"recovering"` (worst metric against thresholds; `recovering` when `ok` but `warn` or `crit` within the previous 10 ticks). Default thresholds (exported as `THRESHOLDS`): saturation 0.70/0.90; errorRate 0.01/0.05; p99 1000/2000 ms; queue ratio (queue/maxDepth or backlog/backlogMax) 0.5/0.8; cache hitRate under 0.80 warn, under 0.50 crit. A scenario `thresholds` entry overrides per metric. Comparisons use quantised values.
- `metric(state, nodeId, name) -> number|null`, quantised: `p50 p99 queue rps missRps connections` rounded to integers, `errorRate saturation hitRate` rounded to 4 decimals; `hitRate` is `null` for non-cache nodes.
- `edgeRps(state, from, to) -> number` quantised flow on that edge for the current tick (0 when the breaker is open).
- `firingAlerts(state) -> [{id, severity, text, since}]` ordered by severity then file order.
- `firstNonOk(state) -> nodeId|null`: the node that left `ok` earliest (ties by topology order), used by the `i` shortcut.
- `result(state) -> {result:"running"|"resolved"|"out-of-budget", timeToMitigate:int|null, budgetLeft, harmful:int, peakError:number, onsetTick, firstPageTick, resolvedTick}`.
- `EngineError` (class), `THRESHOLDS`.
- State fields tests may read: `v:1, scenarioId, scenarioHash, seed, tick, status ("running"|"resolved"|"out-of-budget"), budgetLeft, graceLeft, onsetTick, firstPageTick, resolvedTick (null until resolved), peakError, hash (uint32), params, edgeParams, m, alerts, logs, series, actionLog, applied, diag, faultsFired`.
  - `alerts[id] = {firing, run, clearRun, since, clearedAt}`.
  - `logs`: `[{t,node,level:"info"|"warn"|"error",kind:"log"|"action",text}]`, `t` = tick of the state that emitted the line, at most 6 template lines per tick, at most 5,000 kept.
  - `series.{p99,errors,saturation,queue,"cache-hit"}`: arrays of quantised values for the `sparks` nodes (`null` entries when the scenario's spark is `null`), `length === tick + 1`, index 0 = tick 0.
  - `actionLog`: `[{t,id,node}]` with `node` the resolved target or `null`.
  - `diag = {id, t, lines:[string]}|null`, replaced by each diagnostic.
- Invariants after every tick (a violation throws `EngineError("invariant: <name> on <node>")`): all metrics finite; `0<=errorRate,saturation<=1`; `0<=hitRate<=1`; `0<=p50<=p99<=30000`; `0<=queue<=backlogMax|maxDepth`; `budgetLeft` integer in `[0,budget]`; `tick <= maxTicks + 10`.

### `engine/model.js`
Implements design.md section 3.2 with these fixed deviations: displayed `saturation = clamp(rho, 0, 1)` (no backlog override; see Resolved ambiguities 3). Exports (exact): `retryAmplification(errorRate, retries, backoff) -> number` with `ε=min(0.95, errorRate)`, `A = Σ_{i=0..retries} ε^i` by loop, and with backoff `1 + (A-1)*0.25`. Cases: `(0.5, 2, false) === 1.75`, `(0.5, 2, true) === 1.1875`, `(0, 3, false) === 1`, `(0.99, 1, false) === 1.95`.

### `engine/classify.js`
- `badness(state) -> number = Σ_nodes(saturation + 5*errorRate) + 2*firingAlerts.length` (quantised metrics).
- `classify(state, action) -> "diagnostic"|"helpful"|"harmful"|"none"`: `state` is the state before the action; the engine forks A (with the action) and B (without), each run 5 ticks with no other actions. Diagnostic ids give `diagnostic`; a fix with `badness(A) - badness(B) >= 0.25` is `harmful`; `badness(B) - badness(A) >= 0.25`, or A resolves strictly earlier than B, is `helpful`; else `none`.
- `historyEffects(state) -> [{t,id,node,effect:"diagnostic"|"helpful"|"harmful"|"none"|null}]` in action order; `effect` is `null` until tick `t+5` (or run end, whichever is first), then fixed. This is what `data-effect` shows. `result(state).harmful` counts `harmful` effects.

### `engine/replay.js`
`replay(scenario, seed, log, {snapshots=true, until}={}) -> {final:State, snapshots:[{tick, hash, m, statuses:{node:status}, firing:[alertIds], budgetLeft, status}], dropped:int}`. `log` is `[{t,id,node}]` sorted by `t` ascending. Each entry is applied by `step` when `state.tick === t`. Entries whose `t` is not reached before the run ends, or that `canApply` rejects, are counted in `dropped` and not applied. The run continues until `status !== "running"` or `until`. `snapshots[k]` is the state after `k` ticks (index 0 = initial). A full 610-tick replay finishes in under 250 ms in Node.

### `engine/score.js`
`score({result, timeToMitigate, optimalTime, budgetLeft, budget, optimalCost, harmful, hintUsed}) -> {score:int 0..100, tier, parts:{time, pager, collateral, hintCost}}`.
- `time = tYou ? 50*min(1, tOpt/tYou) : 0`; `pager = tYou ? 30*min(1, left/max(1, budget-costOpt)) : 0`; `collateral = max(0, 20 - 10*harmful)`; `hintCost = hint ? 5 : 0`; `score = clamp(Math.round(time+pager+collateral-hintCost), 0, 100)`. `tYou` is `timeToMitigate` (null when out of budget); `tOpt` is `optimalTime`.
- `tier`: `result==="out-of-budget"` -> `Escalated`; resolved and score >= 90 -> `Textbook`; >= 70 -> `Solid`; otherwise `Survived`.
- Vectors: `{resolved, 41, 35, 4, 6, 1, 0, false}` -> `86.68` rounds to `87`, `Solid`, parts `time 42.68..`, `pager 24`, `collateral 20`. Out of budget, harmful 1, hint: `5`, `Escalated`. Out of budget, harmful 0, no hint: `20`, `Escalated`.

### `engine/solver.js`
- `firstPageTick(scenario, seed) -> int` (tick of the first severity 1-2 alert in a no-action run).
- `schedule(firstPage, path, gap=2) -> [{t,id,node}]`: action `k` at `t = firstPage + gap*k`.
- `solve(scenario, {seed=scenario.seed, maxDepth=4}={}) -> {path:[{id,node}]|null, summary:{timeToMitigate, cost}|null, explored:int}`. Candidates are every `(fixId, node)` pair with a non-empty `actions.<id>.effects.<node>`; schedule as `schedule()`; iterative deepening depth 1..maxDepth, no repeated pair; prune paths over `budget` and prefixes that already resolved; objective lexicographic: resolved, min `timeToMitigate`, min `cost`, min length, then lexicographic `id@node` string. `path:null` when nothing resolves. Runs under 20 s per shipped scenario.
- `tests/tools/solve.js <file>` prints the path and `optimalSummary` as JSON for authors.

### `engine/fingerprint.js`
- `scenarioHash(scenario) -> hex8(fnv1a32(canonicalJson(scenario)))` of the validated scenario.
- `fingerprint({scenarioId, scenarioHash, seed, actionLog, hintUsed}) -> hex8(fnv1a32("v1|"+scenarioId+"|"+scenarioHash+"|"+seed+"|"+actionLog.map(a=>a.t+":"+a.id+"@"+(a.node||"-")).join(";")+"|"+(hintUsed?"h":"")))`. Inspect never appears in `actionLog`, so it never changes the fingerprint.
- `stateHash(state) -> hex8(state.hash)`. The chain is `hash_0 = fnv1a32("")`, `hash_k = fnv1a32(hex8(hash_{k-1})+"|"+tickLine)`, `tickLine` = canonical quantised metrics of all nodes in id order followed by that tick's new log lines joined by `\n`.

### `engine/template.js`, `engine/conditions.js`
- `formatInt(n) -> string` with comma grouping and no `Intl` (`1842 -> "1,842"`, `999 -> "999"`, `-1234 -> "-1,234"`). `render(template, state, u) -> string` resolves `{m:<node>.<metric>[|int|pct|ms]}`, `{p:<path>}`, `{rand:<a>-<b>}` (integer in [a,b] from the draw `u` the engine passes in; only `{rand}` templates cause a PRNG draw, one per template, in file order) and `{tick}`. `placeholders(template) -> [{kind, ...}]` lists them for validation; an unknown placeholder is a validation error.
- `evaluate(cond, state) -> boolean` implements the grammar in design.md 5.6; `MAX_COND_DEPTH = 4`, `MAX_COND_LEAVES = 16`.

## Determinism contract and exact test recipes
The engine takes no wall-clock, no `Math.random`, no `Date`. Arithmetic uses only `+ - * /`, `Math.sqrt|min|max|floor|ceil|round|abs|imul`, `>>>`. Draw order per tick: one draw per `client` node in topology order, then one per log template whose `when` holds and whose text has `{rand:..}` in file order. Actions and diagnostics never draw.

Recipes (each must hold for all 10 shipped scenarios unless stated; "log" means `[{t,id,node}]`):
- **D1 replay equality.** `replay(sc, seed, log)` twice: identical `canonicalJson(final)` and identical `snapshots[k].hash` for every k. Seeds tried: the scenario standard seed, `0`, `1`, `77`, `4294967295`.
- **D2 chunking.** Drive `createRun`+`step` manually in chunks of 1, 5 and 64 ticks per batch, passing each log entry exactly when `state.tick === t`: the hash at every intermediate tick equals the one from `replay`.
- **D3 speed independence.** Using `core/scheduler-math.js` `dueTicks({elapsedMs, speed, ticksRun})` with a fake clock at speeds 1, 2, 4, 8, 16, 32, 64, accept the same action at tick 12 and run to tick 60: identical final `hash`, `series`, `logs`, `budgetLeft`. `dueTicks` returns `floor(elapsedMs*speed/1000) - ticksRun`, never below 0, capped at `min(speed, 64)` per call.
- **D4 seed sensitivity.** Seeds 1 and 2 give different hashes at tick 30 for every scenario; the same seed twice gives the same.
- **D5 serialisation.** `JSON.parse(JSON.stringify(state))` at tick 20 steps to the same hash as the original for 20 more ticks.
- **D6 stamping.** An action passed to `step` at tick T has `actionLog` entry `t = T` whatever `t` the caller wrote in it; `state.params` after the step reflect it; the metrics of tick T (the input state) are unchanged; metrics of tick T+1 already reflect an effect without ramp. A ramped effect (`ramp r`) reaches its final value at tick `T + r` exactly and is linear in between.
- **D7 no hidden inputs.** Banned-API scan of `public/js/engine/**/*.js` after stripping `//` and `/* */` comments: none of `Math.random`, `Date`, `performance`, `setTimeout`, `setInterval`, `crypto`, `globalThis`, `window`, `document`, `fetch`, `Math.exp|log|pow|sin|cos|tan|atan2|cbrt|hypot`, `**`, `Intl`, `toLocaleString`. In `public/js/**`: no `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval(`, `new Function`.
- **D8 invariants.** 10 scenarios x 25 seeds x a seeded random legal action log (generated with `prng.next`, up to 12 actions at random ticks 0..60, only those `canApply` accepts): no throw, and an independent re-check of the invariants on every tick passes.
- **D9 bounded runs.** With no actions every scenario ends `out-of-budget` (never `resolved`) at a tick `<= maxTicks + 10`; with budget exhaustion at tick `Tb` (state with `budgetLeft 0`, `graceLeft 10`) the status is still `running` after 9 more steps and `out-of-budget` after the 10th unless it resolved in the grace window. `series` lengths stay `<= 611`.
- **D10 purity.** `step` does not mutate: `canonicalJson(state)` before equals after; `createRun` called twice gives equal states.

## Gameplay rules the engine must implement (exact)
- 1 tick = 1 simulated second. A fault `{atTick: N}` triggers inside `step` when `state.tick === N`; `onsetTick = N` of the first fault. The effect is visible in the metrics of tick N+1. All node statuses are `ok` and no alert fires for every state with `tick <= onsetTick`.
- Alert rule fires after its condition holds `forTicks` consecutive ticks (default 2); clears after 3 consecutive false ticks; may fire again. `firstPageTick` = first tick any severity 1-2 rule fires.
- Resolution: `holdTicks` (default 5) consecutive ticks with no rule firing after `firstPageTick` exists, and every `resolve.require` condition true. `resolvedTick` is the tick the hold completes and equals `timeToMitigate`. The run stops there; `status = "resolved"`.
- Budget: starts at `budget`; every legal non-`inspect` action spends its cost (`actions.<id>.cost`, else `diagnostics.<id>.cost`, else default: diagnostic 1, fix 2). Every `escalateEvery` ticks (default 90; 0 = off) after `firstPageTick` while unresolved one lamp is spent and a log line `Escalation: still paging after <escalateEvery> s.` (kind `log`, node `null`, level `warn`) is added. When `budgetLeft` reaches 0 `graceLeft` becomes 10 and counts down one per step; a run that resolves inside the window is `resolved`; otherwise `out-of-budget` when `graceLeft` hits 0. At `tick === maxTicks` the budget is forced to 0 (grace starts).
- Action log lines: `{kind:"action", level:"info", node:target|null, text:"Applied: <name>"}` for fixes and `"Ran: <name>"` for diagnostics, emitted before that tick's template lines; `<name>` is the ux.md action name (`Add TTL jitter`, `Scale service`, ...).
- Diagnostics never change system state or draw from the PRNG. After applying one, `state.diag.lines` holds: `trace-request` one line per hop of the critical path from `clients` picking the child with the largest `w*p50` (`lb 12 ms -> service-1 840 ms -> db-primary 2,100 ms`); `tail-logs` the last 30 ticks of logs from all nodes; `compare-dashboards` every node now vs tick 0 (`p99`, errors, saturation); `deploy-history` the scenario `deploys` (`T-00:02 service-1 ...`); each followed by the scenario's `diagnostics.<id>.lines` templates.
- Effects: `{path, op:"set"|"add"|"mul", value, ramp?, if?}`; value computed from the current value at apply time and clamped to the param range; `if` evaluated at apply time (false skips that effect); a later op on the same path cancels a pending ramp. Faults use the same effect type; each fault fires at most once.

## Scenario JSON schema (testable rules)
Unknown top-level keys are rejected. File: at most 65,536 bytes, UTF-8, object. Field table and cross-field rules are design.md 6.1 and 6.2 unchanged; the rules tests must check, one fixture each:

| # | Rule | Fixture (mutate a valid copy of `cache-stampede`) | Message (after `scenarios/<file>: field "<path>": `) |
|---|---|---|---|
| V1 | Required fields present | delete `rootCause` | `missing. Expected: a non-empty string.` |
| V2 | Unknown top-level key | add `bonus: 1` | `is not a known field. Expected: one of <SCENARIO_KEYS joined by ", ">.` (field path `bonus`) |
| V3 | `schema` is the integer 1 | `schema: 2` | contains `Expected: ` |
| V4 | `id` matches `^[a-z0-9-]{1,40}$` and the file stem | file `x.json` with `id:"y"` | field `id`, contains `Expected: ` |
| V5 | `title` 1..300 chars (300 valid, 301 invalid); `summary` 1..160; `hint` 1..300; `rootCause`, `concept` 1..600; `guideTitle` 1..80 | per field | contains `Expected: ` |
| V6 | `difficulty` int 1..3, `budget` int 1..12, `seed` int 0..4294967295, `maxTicks` 60..600, `holdTicks` 1..30, `escalateEvery` 0..600 | per field, boundary and boundary+1 | contains `Expected: ` |
| V7 | Action ids are catalogue ids | `optimalPath[1].id = "reboot-everything"` | `unknown action "reboot-everything". Expected: one of inspect, trace-request, tail-logs, compare-dashboards, deploy-history, scale-service, add-ttl-jitter, circuit-breaker, backoff-jitter, shed-load, failover, shard-rekey, add-index, rollback, raise-pool-size, renew-cert.` |
| V8 | `optimalPath` entries are fix ids with a target node | `{id:"tail-logs", node:"cache"}` | field `optimalPath[0].id`, contains `Expected: ` |
| V9 | `guideUrl` starts with `https://bytebytego.com/guides/` and is in `GUIDES` | `https://example.com/x` | `"https://example.com/x" is not allowed. Expected: a URL starting with https://bytebytego.com/guides/.` |
| V10 | Same, well-formed but not in the list | `https://bytebytego.com/guides/nope` | `"https://bytebytego.com/guides/nope" is not in the guide allow-list. Expected: one of the URLs in public/js/engine/guides.js.` |
| V11 | Topology is a DAG rooted at `clients`, every node has an edge, all reachable; 3..11 nodes; at most 14 edges; direction per `EDGE_RULES` | add edge `cache>service-1` or `service-1>clients` | `has a cycle through <node>. Expected: edges that form a directed acyclic graph from clients.` for cycles; other shapes contain `Expected: ` |
| V12 | Node ids are known; params whitelisted per type with ranges and required ones (`rps` on client, `capacity` on non-client, `maxDepth` on queue) | `topology.nodes.cache.hitRate = 1.5`; `lb.hitRate = 0.5` | field `topology.nodes.cache.hitRate` etc., contains `Expected: ` |
| V13 | Every node id in edges, sparks, labels, conditions, effects, logs, deploys, optimalPath, rootCauseNode exists in the topology | `rootCauseNode: "nope"` | contains `Expected: ` |
| V14 | An effect target's type is in the action's `appliesTo`; effect paths are whitelisted; `ramp` 1..30; booleans only with `set`; max 8 effects per target | `actions.add-ttl-jitter.effects["lb"]` | contains `Expected: ` |
| V15 | Conditions: grammar, depth <= 4, leaves <= 16 | 17 leaves | contains `Expected: ` |
| V16 | Placeholders resolve; `text` 1..6000 chars (a 5,000 char unbroken string and the literal `<script>` are valid) | `{nope}` | contains `Expected: ` |
| V17 | Alerts: 1..8 rules, at least one severity <= 2, `forTicks` 1..30; faults 1..8, trigger `atTick` 0..maxTicks or `when`; `workload` ticks strictly increasing from 0, multipliers 0..20 | per rule | contains `Expected: ` |
| V18 | `optimalPath` total cost <= `budget` (costs from `actions.<id>.cost`, default 2); `harmfulWhy` keys are fix ids; `sparks` has exactly the keys `p99, errors, saturation, queue, cache-hit`, each a present node or `null` | per rule | contains `Expected: ` |
| V19 | `optimalSummary` is `{timeToMitigate:int, cost:int}` | missing | `missing. Expected: ...` |

- Only the V1, V2, V7, V9, V10 and cycle messages are pinned exactly; every other message must end with an `Expected: ...` clause and name the right `field`. Values are echoed only for strings, as JSON truncated to 60 characters plus `...`; numbers and objects are never echoed.
- `validate` never throws for any JSON value (including arrays, `null`, numbers); non-objects give field `(file)`, `is not a JSON object. Expected: an object with the scenario fields.`
- All 10 shipped files validate with zero errors; the result is deep-frozen (`Object.isFrozen` on the scenario and nested objects) and defaults are filled (`maxTicks` 600, `holdTicks` 5, `escalateEvery` 90, alert `forTicks` 2, node `instances` 1 ...).
- `tests/scenarios.test.js` reads `process.env.SCENARIOS_DIR` (default `./scenarios`), validates every `*.json`, and fails with the formatted message naming file and field for any invalid file; for files whose id is one of the 10 shipped ids it also asserts solver equality. With a folder where every file is invalid the run exits non-zero and the output names the file and field.

## The 10 shipped scenarios (pinned contract)
Pinned: ids, `difficulty`, `budget`, `guideUrl`, `rootCauseNode`, `optimalPath` with costs, and the outcome classes below. Free for the builder to tune: every physics number (rps, capacity, ramps, thresholds, log text) as long as every pinned outcome holds. Diagnostic costs are 1 in every scenario. Fix costs are 2 unless stated. `optimalSummary` is the solver output for the standard `seed` and must equal it exactly.

| # | id | d | budget | guide slug | rootCauseNode | optimalPath (cost each) |
|---|---|---|---|---|---|---|
| 1 | `cache-stampede` | 1 | 6 | how-can-cache-systems-go-wrong | cache | `add-ttl-jitter@cache` (1) |
| 2 | `thundering-herd` | 2 | 6 | things-to-consider-when-using-cache | cache | `backoff-jitter@clients` (2) |
| 3 | `retry-storm` | 2 | 6 | how-do-we-retry-on-failures | third-party | `backoff-jitter@service-1` (2) |
| 4 | `hot-partition` | 2 | 6 | a-crash-course-in-database-sharding | db-primary | `shard-rekey@db-primary` (2) |
| 5 | `queue-backlog` | 1 | 6 | types-of-message-queue | consumer | `rollback@consumer`, `scale-service@consumer` (2, 2) |
| 6 | `n-plus-one` | 2 | 6 | 7-must-know-strategies-to-scale-your-database | service-1 | `rollback@service-1` (2) |
| 7 | `connection-pool-exhaustion` | 2 | 6 | 7-must-know-strategies-to-scale-your-database | service-1 | `raise-pool-size@service-1` (2) |
| 8 | `expiring-certificate` | 1 | 6 | how-does-https-work | lb | `renew-cert@lb` (2) |
| 9 | `split-brain` | 3 | 8 | cap-theorem-one-of-the-most-misunderstood-terms | db-primary | `shed-load@lb`, `failover@db-replica` (2, 2) |
| 10 | `cascading-failure` | 3 | 8 | resiliency-patterns | third-party | `shed-load@lb`, `circuit-breaker@service-2`, `scale-service@service-1` (2, 2, 2) |

Topologies and causes follow design.md section 10 (same node ids, same fault story). Extra constraints:
- **cache-stampede has at least 8 nodes** (ux check 1 needs 8 `map-node`s on the first screen): `clients, lb, service-1, service-2, cache, db-primary, db-replica, third-party`. The extra nodes are healthy bystanders that stay `ok` for the whole no-action run. It has an alert with `severity 2` and text exactly `checkout p99 > 2 s` (condition `lb.p99 gt 2000`) and a severity 3 alert `Cache hit rate under 80%`. `firstNonOk` at tick 12, seed 1, is `cache`. Its `sparks.p99` is `lb`, `sparks.cache-hit` is `cache`.
- Every scenario: `sparks.p99 === "lb"`; `onsetTick` in 4..6; `firstPageTick` in 6..9 for every seed in `0..49`; at least one severity <= 2 alert; `deploys` entries negative or at least 0 ticks as written; no URL (`http`) in any text field other than `guideUrl`; no emoji (`\p{Extended_Pictographic}`); `guideTitle` names the guide in our words.
- `cascading-failure` alerts include SEV1 `checkout errors > 5%`, SEV2 `checkout p99 > 2 s`, SEV2 `recommendations timeouts`. `connection-pool-exhaustion` db log line `FATAL: too many connections (<n>/<max>)` appears when connections exceed `maxConnections`.

### Outcome classes (the playbook)
Playbook recipe: `firstPage = firstPageTick(sc, seed)`; actions at `firstPage + 2k` via `schedule`. A single fix "alone" is applied at `firstPage` with no other actions. Targets are every node whose type is in the fix's `appliesTo`. A (fix, node) pair without a non-empty `actions.<id>.effects.<node>` entry is a no-op: classification `none` and never resolves alone. Declared classes (at `firstPage`, by `classify`):

| id | resolves alone | other single-fix classes |
|---|---|---|
| cache-stampede | `add-ttl-jitter@cache` | harmful: `failover@db-primary` (cost 2); none: `scale-service@service-1` |
| thundering-herd | `backoff-jitter@clients` | harmful: `scale-service@service-1`; helpful, not resolving: `shed-load@lb` |
| retry-storm | `backoff-jitter@service-1` | harmful: `scale-service@service-1` |
| hot-partition | `shard-rekey@db-primary` | harmful: `scale-service@service-1`, `failover@db-primary`; none: `add-index@db-primary` |
| queue-backlog | nothing alone (`rollback@consumer` alone resolves strictly later than the optimal pair or not within `maxTicks`) | helpful, not resolving: `scale-service@consumer` (adds one instance); none: `shed-load@lb`; no harmful fix |
| n-plus-one | `rollback@service-1` | harmful: `scale-service@service-1`; helpful, not resolving: `add-index@db-primary` |
| connection-pool-exhaustion | `raise-pool-size@service-1` | harmful: `scale-service@service-1` (`instances add 3`) |
| expiring-certificate | `renew-cert@lb` | harmful: `rollback@service-1` |
| split-brain | nothing alone | harmful: `failover@db-replica` at `firstPage`, `scale-service@service-1`; `shed-load@lb` not resolving and not harmful (`helpful` or `none`) |
| cascading-failure | nothing alone | harmful: `scale-service@service-1` as the first action; every other single fix not resolving |

Required properties (each asserted through the engine for the standard seed, and for seeds `1` and `77` where marked *):
- **P1 optimal resolves.** Running `schedule(firstPage, optimalPath)` ends `resolved` with `timeToMitigate === optimalSummary.timeToMitigate` (standard seed) and `resolved` for any seed*. `timeToMitigate - lastActionTick <= 45`; for `cache-stampede`, `resolvedTick - applyTick <= 30` when `add-ttl-jitter` is applied at any tick in `[firstPage, firstPage+12]` (seed 1). Under the same schedule the score is exactly 100, tier `Textbook`, `harmful 0`.
- **P2 no help from doing nothing.** No-action run is `out-of-budget` for all 10 (D9).
- **P3 solver equals declared.** `solve(scenario).path` deep-equals `optimalPath` (ids and nodes) and `.summary` equals `optimalSummary`. For `cascading-failure`: `solve(sc,{maxDepth:2}).path === null` (no path of length <= 2 resolves) and `solve(sc).path.length === 3`.
- **P4 single fixes (SC4).** For `cascading-failure`, for every fix id and every valid target, applied alone at `firstPage`: the run never reaches `resolved`, and `firingAlerts(state).length >= 1` at tick `firstPage + 2 + 30`. Seeds: standard, `1`, `77`.
- **P5 harm is classified, not declared.** Each declared harmful pair has `classify(...) === "harmful"` at `firstPage` and a non-empty `harmfulWhy[id]`; every id in `harmfulWhy` is harmful somewhere in the solver's exploration; a pair classified `harmful` at `firstPage` without a `harmfulWhy` entry fails the scenario test; each declared `helpful` pair classifies `helpful`; each declared `none` pair classifies `none`.
- **P6 optimal steps help.** Each step of `optimalPath`, applied on the playbook schedule, classifies `helpful` (or resolves strictly earlier than the counterfactual).
- **P7 visible within 2 s.** For each declared helpful or resolving first step on scenarios 1-8: some node's quantised `saturation`, `errorRate` or `p99` at tick `T+2` is lower than at `T` (applied at `T = firstPage`) for the rootCauseNode or the `lb`. For `cache-stampede`, `db-primary` saturation at `T+2` is strictly below its value at `T`.
- **P8 harmful is visible within 5 ticks (SC3).** Applying the declared harmful fix at `firstPage`: for `connection-pool-exhaustion`, `db-primary` saturation at `firstPage` is at most 0.95 and rises (strictly) within 5 ticks; `service-1` `errorRate` rises strictly within 5 ticks; a `FATAL: too many connections` log line from `db-primary` exists by `firstPage+5`; `historyEffects` shows `harmful` for that action once `tick >= t+5`.
- **P9 map story.** `cache-stampede`: some tick `>= firstPage` has `pile(cache) >= 12` and `edgeRps(cache->db-primary) >= 4 * edgeRps(at tick 0)`; `retry-storm`: within 40 ticks after onset `edgeRps(service-1->third-party) >= 3 * edgeRps(at tick 0)` (`pile(n) = min(24, round(24*max(clamp((saturation-0.7)/0.3,0,1), queueRatio)))`, exported by `core/viewmodel.js` as `pileOf(saturation, queueRatio)`).

### Score bands (standard seed, playbook schedule)
| Run | Expectation |
|---|---|
| Optimal path only | score 100, `Textbook` |
| `trace-request` (cost 1) at `firstPage`, then optimal path from `firstPage + 2` | resolved; `score in [75, 100]`; tier `Solid` or `Textbook`; `score` equals `score()` recomputed from the run's `result`, `optimalSummary` and `budgetLeft` |
| Scenarios 1,2,3,4,6,7,8: the declared harmful fix at `firstPage`, then the optimal path from `firstPage + 2` | resolved; `harmful >= 1`; `score in [20, 85]`; tier `Solid` or `Survived`; `score` lower than the optimal-only score |
| Scenarios 9, 10: the declared harmful fix first, then the optimal path | `harmful >= 1`; `score <= 85`; result `resolved` or `out-of-budget` (either is legal) |
| `trace-request` spam until budget 0 (all 10) | `out-of-budget`; `result.timeToMitigate === null`; `score === 20`, tier `Escalated`; with `hintUsed` the score is 15 |

## Progress, daily, share (core modules, exact)
### `core/safe-json.js`
`parseSafe(text, {maxBytes=262144}={}) -> {ok:true, value} | {ok:false, reason}`. Order, first failure wins; reasons never echo a value; key and path names are cut to 40 characters plus `...`:
1. UTF-8 byte length over `maxBytes`: `the file is <n> KB and the limit is 256 KB.` (`<n>` = `Math.ceil(bytes/1024)`).
2. Pre-scan of the raw text skipping string contents with escapes: nesting deeper than 8 or more than 20,000 structural tokens (`{`, `[`, `,`): `the file is nested too deeply.` (`[[[[...` x 100 and a 20,000-key object must both reject before `JSON.parse`).
3. `JSON.parse` throws: `the file is not valid JSON. Export a fresh file from this page and try again.`
4. Any key `__proto__`, `constructor` or `prototype` at any depth: `the file contains the key "<k>", which is not allowed.` The walk uses `Object.keys`, never the prototype chain; nothing global is polluted (`({}).polluted === undefined`, `Object.keys(Object.prototype).length === 0` before and after).
5. `value` is rebuilt into prototype-less objects (`Object.getPrototypeOf(x) === null`); tests compare with `JSON.stringify`, not `deepStrictEqual`.

### `core/progress.js`
- Format (exactly the stored value under `incident-sim:v1` and the export): `{ "version":1, "runs":[ {"scenario":id, "seed":uint32, "scenarioHash":hex8, "result":"resolved"|"out-of-budget", "timeToMitigate":int 1..610|null, "budgetLeft":int 0..12, "harmful":int 0..12, "hintUsed":bool, "score":int 0..100, "actions":[{"t":int 0..610,"id":catalogue id (not "inspect"),"node":nodeId|null}] (0..12)} ] }`. At most 200 runs; serialised at most 262,144 bytes.
- `parseProgress(text, {knownScenarios}={}) -> {ok:true, progress} | {ok:false, reason}`: `parseSafe` first, then in this order: top level is an object (else `the file must contain a JSON object.`); `version` is 1 (else `this file is version <v> and this app reads version 1.`, `<v>` truncated to 40 chars, non-numbers show `unknown`); unknown top-level key `field "<k>" is not part of the progress format.`; `runs` array (else `field "runs" must be a list.`); length over 200: `the file holds <n> runs and the limit is 200.`; each run in order: unknown key `field "runs[i].<k>" is not part of the progress format.` (so `name` is rejected), missing key `field "runs[i].<k>" is missing.`, then types and ranges `field "runs[i].<k>" must be <what>.`, scenario pattern `field "runs[i].scenario" must use only lowercase letters, digits and hyphens.`, known scenario (only when `knownScenarios` is given) `"runs[i].scenario" names an incident this copy does not have.`, action ids `field "runs[i].actions[j].id" is not a known action.`, `timeToMitigate` null iff `out-of-budget`. A value is never echoed.
- `serialiseProgress(progress) -> JSON.stringify(progress, null, 2)`; `exportFilename("2026-11-19") -> "incident-sim-progress-2026-11-19.json"`. `parseProgress(serialiseProgress(p))` round-trips (compare with `JSON.stringify`).
- `emptyProgress() -> {version:1, runs:[]}`; `addRun(progress, run) -> progress` (pure; appends; drops the oldest beyond 200 and until it serialises to at most 262,144 bytes); `bests(progress) -> {[scenarioId]:{state:"new"|"resolved"|"out-of-budget", bestTime:int|null, bestScore:int|null, runs:int}}` where `state` is `resolved` if any run resolved, else `out-of-budget` if any run exists; `resolvedCount(progress) -> number of distinct scenarios with a resolved run`; `lastRun(progress, id) -> run|null`.
- `parseProgress` on text from a corrupt store gives `{ok:false}`; callers must not overwrite it until the next successful save (UI rule).
### `core/settings.js`
`parseSettings(text) -> {shortcuts:boolean}` (default `{shortcuts:true}` for anything invalid), `serialiseSettings(s)`. Key `incident-sim:settings`, not exported.

### `core/daily.js`
`daily(dateStr, validIds) -> {date, number, scenarioId, seed}`. `dateStr` matches `^\d{4}-\d{2}-\d{2}$`, is a real calendar date from `2026-01-01` to `2099-12-31`, else `RangeError`. `number = (Date.UTC(y,m-1,d) - Date.UTC(2026,0,1))/86400000 + 1`; ids sorted ascending by code unit (duplicates removed); `scenarioId = ids[fnv1a32("daily:"+date) % ids.length]` (`null` when the list is empty); `seed = fnv1a32("daily-seed:"+date)`. Vectors with the 10 shipped ids: `2026-11-19` -> `{number:323, scenarioId:"split-brain", seed:1775642406}`; `2026-01-01` -> `{number:1, scenarioId:"split-brain", seed:205601972}`; `2026-12-31` -> `{number:365, scenarioId:"thundering-herd", seed:3131713203}`. Timezones are irrelevant: the function takes the date string only.

### `core/share.js`
`shareText({daily:number|null, seed, scenarioId, letters:[...], left, budget, timeToMitigate:int|null, score, optimalTime:int, harmful, fp}) -> string` of exactly two lines joined by `\n` (no trailing newline):
- Line 1: `incident-sim <#n|seed:s> <id>  [<letters separated by single spaces>]  <left>/<budget> pager  <mm:ss|OUT>`. `#n` when `daily` is a number, else `seed:<seed>`. Two spaces between groups. `[]` when there are no letters. `OUT` when `timeToMitigate` is null.
- Line 2: `score <n>  optimal <mm:ss>  harmful <n>  fp <hex8>`.
- Letters: `D` diagnostic, `F` helpful fix, `x` harmful fix, `.` no effect, in action order, `inspect` excluded, at most 12.
- Total at most 160 characters; no URL, `http`, `localhost`, name or emoji. Regexes (ux check 24): line 1 `^incident-sim (#\d+|seed:\d+) [a-z0-9-]+  \[[DFx. ]*\]  \d+\/\d+ pager  (\d{2}:\d{2}|OUT)$`, line 2 `^score \d+  optimal \d{2}:\d{2}  harmful \d+  fp [0-9a-f]{8}$`.
- Example: `incident-sim #323 cache-stampede  [D F]  4/6 pager  00:41` and `score 87  optimal 00:35  harmful 0  fp 9c41ab07`.

### Other pure `core/` modules (names pinned, behaviour per design.md section 12; builder unit-tests them)
`routes.js` (`parseRoute(hash) -> {name:"first"|"board"|"play"|"debrief"|"data"|"about"|"notfound", id?, seed?, seedError?}`, `parseSeed(str)` accepts `^\d{1,10}$` <= 4294967295), `testmode.js` (`parse(flag, search) -> {active, speed, paused, pauseAt, failAt}`: with `flag` false always the defaults `{active:false, speed:1, paused:false, pauseAt:null, failAt:null}`; `speed` must be in `1,2,4,8,16,32,64` else 1; `pause-at` and `fail-at` integers 0..600), `scheduler-math.js` (`dueTicks`), `format.js` (`clock(t) -> "T+02:41"`, `mmss`, `rate`, `percent`, `ms`, `int`), `keys.js` (`resolve(descriptor) -> command|null`), `announcer.js`, `viewmodel.js` (`pileOf`, `dotRateOf(rps, baselineRps) = clamp(rps/baselineRps*8, 0.5, 40)`, every `data-*` value), `layout.js`, `particles.js`, `debrief-model.js`.

## Browser-only checks and the data-* contract
Not checkable over HTTP or from Node, so left to the phase 7 walkthrough: ux.md UI checks 1-40 as far as they involve rendering, focus, live regions, clipboard, downloads, dialogs, layout at 1280x800, 390x844 and 320x640, themes and axe, reduced motion, frame timing (advisory), the replay scrubber, the hostile-scenario render test (37), storage-blocked and fail-at states. The Node-level halves of those checks are covered above: check 7 and 8 (P4, P1), 9 and 10 (D1-D3), 11 (daily), 12-13 (`canApply`, D9), 20 (validator, loader, `SCENARIOS_DIR`), 23 (`parseProgress`), 24 (`shareText`), 25 (headers, served-file hygiene), 31-33 (token files, contrast), 40 (score).

The data-* contract (names are exact; values come from `core/viewmodel.js`):
- `[play-view]`: `data-scenario data-seed data-sim-time data-status (running|paused|resolved|out-of-budget) data-grace data-mode (map|text) data-reduced-motion data-budget-left data-budget-total data-selected-node data-alert-count data-actions-taken data-harmful-count data-hint-used data-updated-at (even under reduced motion) data-speed data-state-hash (= stateHash(state))`. `[debrief-view]` repeats the relevant ones plus `data-result data-score data-time-to-mitigate`.
- `[map-node]`: `data-node data-status data-selected data-saturation data-p50 data-p99 data-error-rate data-queue data-hit-rate data-pile` (percent values with 1 decimal; ms and queue integers). `[map-edge]`: `data-from data-to data-state (normal|loaded|failing|cut) data-rps data-dot-rate`. `[map-canvas]`: `data-dots data-dot-cap data-animating`. `[system-map]`: `data-layout (wide|tall) data-ready`.
- `[metric-value]`: `data-metric data-value`; `[spark]`: `data-metric data-value data-status`; `[action-item]`: `data-action-id data-kind data-cost data-state`; `[history-item]`: `data-action-id data-time data-effect`; `[alert-item]`: `data-alert-id data-state data-severity`; `[incident-row]`: `data-scenario data-difficulty data-state data-best-time`; `[daily-card]`: `data-scenario data-seed data-date data-number`; `[replay-mark]`: `data-lane data-action-id data-time data-kind`; `[data-run-row]`: `data-scenario data-best-time data-score`; `[scenario-error-item]`: `data-file data-field`.
- Every other testid is in the ux.md table; the acceptance suite embeds that list.

Static design checks (Node, over files): `public/tokens.css` defines every `--` token of design-direction section 4 in the dark `:root`, the `prefers-color-scheme: light` block, `prefers-contrast` blocks and the reduced-motion and forced-colors blocks; every row of the contrast table (section 5, rows 1-26) meets its minimum in dark and light using only values from `tokens.css`; no token hue between 250 and 330 degrees; `public/app.css` has no hex colour and no `@font-face`; no `url(` pointing outside the origin anywhere in CSS or HTML; no `@import`.

## Acceptance criteria (brief SC to Node/HTTP-checkable test)
Visible tests: `acceptance/engine.acceptance.test.js` (API shapes, goldens, D1-D10, classify, replay, score, solver), `acceptance/scenarios.acceptance.test.js` (validator fixtures, 10 scenarios, P1-P9, score bands), `acceptance/core.acceptance.test.js` (progress, hostile imports, daily, share, test-mode parse, scheduler-math), `acceptance/server.acceptance.test.js` and `acceptance/hardening.acceptance.test.js` (spawn the server with `PORT=0`), `acceptance/static.acceptance.test.js` (tokens, contrast, hygiene, served testids, banned APIs). A holdout set also grades the result.

| SC | What the tests check |
|---|---|
| SC1 | Ready line and `Loaded 10 scenarios.`; `GET /` shell with CSP; cache-stampede: `firstNonOk` is `cache`, all nodes `ok` at tick 0, a severity 2 page `checkout p99 > 2 s` by tick 9 for 50 seeds, at least 8 nodes |
| SC2 | Cache-stampede inspect-and-fix through the engine: diag then `add-ttl-jitter` -> db saturation falls within 2 ticks, resolved within 30 ticks, `Applied:` log line, guide link equals the pinned URL |
| SC3 | P8 and P5 on connection-pool-exhaustion |
| SC4 | P3, P4, P1 on cascading-failure |
| SC5 | D1-D4, D6, daily vectors, `/test-mode.json` gating over HTTP (404 without the env var, 200 `{"testMode":true}` with it) |
| SC6 | `canApply` reasons and order, costs, D9 grace and out-of-budget, score 20 for budget exhaustion |
| SC7, SC8 | Browser only (phase 7); engine halves: text mode needs no engine change, reduced motion only affects the view model |
| SC9 | V1-V19, exact messages for V1, V7, V9; loader with a temp `SCENARIOS_DIR` (valid copy, `no-root-cause`, `bad-action`, `bad-guide`): server stays up, `/` is 200, stdout has the three `scenario error:` lines, `index.json` lists `valid:["cache-stampede"]` with three errors (`file`, `field`, `message`), invalid ids 404; all-invalid folder serves `valid:[]` and prints `Loaded 0 scenarios.`; `SCENARIOS_DIR` missing exits 1 |
| SC10 | `serialiseProgress` and `parseProgress` round trip; `bests`, `resolvedCount`; filename |
| SC11 | The six hostile files of ux check 23 plus depth bomb, 20k-key object, 262,145 bytes and 262,144 bytes (valid, accepted): each rejection reason exact, `Object.prototype` unpolluted, no value echoed, input text never evaluated |
| SC12 | `shareText` regexes and length; served files contain no external origin except `https://bytebytego.com/guides/...`, `https://github.com/ByteByteGoHq/system-design-101`, `https://creativecommons.org/licenses/by-nc-nd/4.0/`; CSP header |
| Hardening | 403 bad Host (also missing Host), 405 + `Allow` for OPTIONS/POST/PUT/DELETE, cross-site `Sec-Fetch-Site` 403, all headers on 200/403/404/405, allow-list 404 list above, `HEAD`, query strings, `HOST=0.0.0.0` exits 1 with the exact message, bad `PORT`, port in use, `Cache-Control` values, content types, no byte from outside the allow-list ever served |

## Out of scope
Accounts, leaderboards, multiplayer, runtime network calls, sound, scenario editor UI, real infrastructure, hot reload of scenarios, an API, SPA fallback, HEAD-less static, non-loopback hosting, custom topologies, noisy-neighbour and clock-skew scenarios, localisation, streaks, pixel-diff tests, copying guide text or images.

## Verify command
`cd examples/incident-sim && node --test "acceptance/*.test.js" "tests/*.test.js"`.
`verify.config.json` (written by the test-owner agent in phase 4; same shape as `examples/wiki/verify.config.json`): `testCommand` as above; `minTests` at least 120; `srcDirs: ["src", "public/js/engine", "public/js/core"]` (the `dom/` glue is excluded from unit coverage and covered by the phase 7 walkthrough); coverage `minLines` 80 and `minFileLines` 60 (so every `engine/` and `core/` file, `keys`, `announcer`, `viewmodel`, `layout`, `particles`, `debrief-model` included, needs its own unit tests); `testQuality.dirs: ["tests"]`, at least 3 assertions per file; holdout set by the orchestrator; mutation: samples 8, kill rate at least 0.6, `copy` must list `package.json`, `src`, `public`, `scenarios`, `tests`, `acceptance` (tests read `scenarios/`). Mutation sampling flips `===`, `!==`, `&&`, `||`, `>=`, `<=`, `true`, `false` in files under `srcDirs`, round-robin by file; it must work on the ESM `engine/` and `core/` files, so tests import them by relative path as ES modules (no `require`), and boundary conditions (`>=` vs `>` in thresholds, hold ticks, budget checks, size limits, cost checks) need tests on both sides. Tests may read only files inside the project folder (the mutation run works on a copy; optional README checks for the guides skip when the sibling `system-design-101` path is absent).
Acceptance tests are read-only for builders; unit tests go in `tests/`.

## Constraints
- Node >=22 built-ins only, zero dependencies (also none for tests), ESM, no build step. Test tooling for the browser (axe) is injected from a scratch install outside the repo.
- No `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval`, `new Function` in `public/js`. No inline script, style or event-handler attribute in HTML. All scenario, log, import and storage strings use `textContent` or DOM nodes.
- `engine/` and `core/` stay free of DOM and Node built-ins; `src/` is the only place that reads files for serving.
- Do not edit `acceptance/`. `spec.md` changes only through the planner or orchestrator, with a decision-log line.
- If a pinned outcome proves infeasible, the builder records it and asks for a spec amendment instead of weakening a test or the scenario's class.
- `security-reviewer` reviews `core/safe-json.js`, `core/progress.js`, `dom/storage.js`, `src/router.js`, `src/http.js` and `src/scenarios-load.js` in phase 6.
- Licence: About text and README credit ByteByteGo system-design-101 under CC BY-NC-ND 4.0 (links `https://github.com/ByteByteGoHq/system-design-101` and `https://creativecommons.org/licenses/by-nc-nd/4.0/`); no close paraphrase of guide text.

## Resolved ambiguities (spec over design.md / ux.md)
1. The unit-test folder is `tests/` (not `test/`), so the verify glob matches wiki. `tests/tools/solve.js` lives one level down so the glob does not run it.
2. `acceptance/` holds Node and HTTP tests only (design.md and ux.md called it Playwright). ux checks 1-40 in a browser are the phase 7 walkthrough.
3. `saturation = clamp(rho, 0, 1)` with no "backlog above 0 means 1" override (design.md 3.2 step 7), because ux check 4 needs `db-primary` saturation to fall within 2 ticks of a fix while a backlog still drains. Backlog shows in `queue` and the queue/backlog status threshold.
4. cache-stampede has at least 8 nodes (ux check 1) although design.md sketched 5.
5. Pinned outcome classes and optimal paths for thundering-herd (single step, `shed-load@lb` helpful) and queue-backlog (the pair `rollback`, `scale-service` on the consumer, scale adds one instance), which design.md left open.
6. Design.md section 17 minor ux.md edits (the planner records them here; ux.md is not edited): (3) progress runs carry `scenarioHash` and each action carries `node`; (4) `optimalPath` entries are `{id,node}`, `optimalSummary` is a new required field, UI reads `.id`; (5) the board shows the full validator message plus ` Fix the file and restart the server.`; (6) `inspect` is a free UI read, never in history, share grid or fingerprint (it still lists as "Free"); (7) escalation drain `escalateEvery` (default 90) with log `Escalation: still paging after 90 s.` and polite announcement `Pager 3 of 6 left.`; (8) new storage copy `Saved progress could not be read; new results will replace it.`; (9) `HOST` env (loopback only). The blocking items (licence is CC BY-NC-ND 4.0, title cap 300) are in `decisions.md` rows 4, 8, 10.
7. Server stream and order: scenario errors, ready line, `Loaded` line on stdout; fatals on stderr; tests combine them.
8. `GET` and `HEAD` are allowed (unlike wiki), everything else 405; `Sec-Fetch-Site: cross-site` is checked after the method; `Origin` is ignored (no API).
9. Reasons from `canApply` follow design.md's list order (over, out of budget, not enough, target, already on); the unlisted "incident is over" text is `The incident is over.`; the target type list joins `appliesTo` with ` or `.
10. `step` ignores caller-supplied `t`; replay logs store the resolved target node, never `null` for targeted fixes.
11. `escalation` log lines are kind `log`, node `null`, level `warn`.
12. Share text uses `#n` only when the caller passes `daily` (the DOM passes it when the run's scenario and seed equal today's daily pick, computed from the local date at debrief time); otherwise `seed:<seed>`. Share's `optimal` uses `optimalSummary` (seed-stable); the debrief UI shows the replayed optimal time.
13. `parseProgress`, `parseSafe` return prototype-less objects; tests compare with `JSON.stringify`. Size reason uses `Math.ceil(bytes/1024)` KB.
14. `daily()` accepts 2026-01-01 to 2099-12-31 only; the 10 shipped ids sort to the order used by the vectors.
15. `fail-at` and `failAtTick`: the error is thrown by the step that would produce that tick; the UI catches it, shows `app-error` with the seed, and saves nothing.
16. `series` has one entry per tick including tick 0 (`length === tick + 1`); snapshots likewise.
17. Metric display units: `data-saturation`, `data-error-rate`, `data-hit-rate` are percent numbers with 1 decimal; quantised engine values are fractions.
18. Server `index.json` file field is the bare name (`bad-guide.json`) so `data-file` matches ux check 20; the printed line adds the `scenarios/` prefix.
19. The shipped scenario test uses `SCENARIOS_DIR` if set so ux check 20's "run node --test against that folder" is possible.
20. Text mode does not change the engine; after an action it runs 2 steps then pauses (UI rule, ux J8).
21. Out-of-budget score is 20 (not 0) when nothing harmful happened, per the formula; ux check 40 only requires tier `Escalated`.
22. Daily and first-run: `#/` on a profile without progress starts `cache-stampede` with the daily seed; the daily card on the board uses the daily pick (for 2026-11-19 that is `split-brain`, not cache-stampede).
23. (amendment from builder E1, accepted) Escalation never takes the last pager lamp; `maxTicks` forces budget 0 and the 10-tick grace. The 610-tick no-action replay in acceptance requires this.
24. (accepted) `safe-json` takes a `maxDepth` option (default 8); the scenario loader passes `{ maxBytes: 65536, maxDepth: 12 }` because real scenario shapes (`actions.x.effects.node[].if.all[]`) are 9 deep.
25. (accepted) The 20,000-token limit rejects at 20,000 or more (SC11 requires a 20,000-key object to be rejected).
26. (accepted) `step(state, actions)` carries the scenario as `state.scenario` so the JSON round trip works; `canonicalJson(state)` includes it.
27. (accepted) Served formula: `processed = min(backlog + load, capacity)`, leftover to backlog up to `backlogMax`, the rest dropped. Zero capacity with load reads as saturation 1. `stepRaw(state, actions)` is an engine export for the solver and classifier forks.
