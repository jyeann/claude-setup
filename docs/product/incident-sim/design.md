# Design: incident-sim (Incident Simulator)

Sources: `brief.md` (SC1-SC12), `design-direction.md` (visual system, budgets), `ux.md` (behaviour, copy, testid contract, acceptance checks), server hardening from `docs/product/wiki/design.md` section 7 and `examples/wiki/src/{http,router}.js`. Where this file and ux.md disagree on engine or server details, this file wins (ux.md says so itself). Section 17 lists every conflict and the ux.md edits needed.

Stack: Node >= 22, ESM, zero npm runtime dependencies, `node:test`, vanilla browser modules, no build step, canvas 2D for request dots, SVG for structure.

---

## 1. Module layout (`examples/incident-sim/`)

```
package.json                 "type":"module", "engines":{"node":">=22"}, scripts: start, test; no dependencies
README.md                    run, test, scenario authoring, attribution (CC BY-NC-ND 4.0, see section 15)
src/                         Node only (server)
  server.js                  config, boot, scenario load, listen, startup lines
  config.js                  env parsing (PORT, HOST, INCIDENT_SIM_TEST, SCENARIOS_DIR) -> frozen config or throws ConfigError
  http.js                    SECURITY_HEADERS, static allow-list built at boot, send helpers
  router.js                  request checks in pinned order, static dispatch, test-mode.json
  scenarios-load.js          read dir, file checks, parse (safe-json), validate, build index.json bytes
public/
  index.html                 shell; inline SVG <symbol> sprite (#ic-ok, #ic-warn, #ic-crit, #ic-recv, node glyphs); no inline script/style
  tokens.css  app.css  favicon.svg
  js/
    engine/                  PURE, shared by Node and browser. No DOM, no Date, no Math.random, no I/O.
      prng.js                mulberry32 (functional)
      hash.js                fnv1a32 (UTF-8), hex8, canonicalJson
      catalogue.js           frozen node types, param whitelist per type, action catalogue (ids, kind, appliesTo, once)
      guides.js              frozen guide allow-list (section 6.4)
      conditions.js          condition evaluator (section 5.6)
      model.js               metric equations for one tick (section 4)
      engine.js              createRun, step, canApply, applyActions, status, alerts, logs, resolution
      classify.js            counterfactual effect classification (section 7.3)
      replay.js              replay(scenario, seed, log, opts) -> snapshots, final state
      score.js               score, tier (section 8)
      solver.js              optimal-path search (section 9)
      fingerprint.js         run fingerprint, state hash
      validate.js            scenario validator + error formatter (section 6)
      template.js            log/diagnostic template rendering, number formatting (no Intl)
    core/                    PURE browser-side logic, no DOM access (unit-tested in Node)
      safe-json.js           depth pre-scan + parse + prototype-less copy + forbidden keys
      progress.js            incident-sim:v1 schema, import validator, merge, bests, size cap
      settings.js            incident-sim:settings parse/serialise
      daily.js               date string -> {number, scenarioId, seed}
      share.js               share text
      routes.js              hash route parse/build, seed parse
      testmode.js            test-mode param parsing (given testMode flag + query string)
      keys.js                keyboard event descriptor -> command (ux keyboard model)
      announcer.js           live-region message queue + throttle (sim-time based)
      viewmodel.js           engine state -> play view model (all data-* values, labels, aria names)
      debrief-model.js       run -> result card, lanes, table rows, narration
      layout.js              map layout (wide/tall), pure and memoised per (size, node set)
      particles.js           dot simulation (spawn, advance, pile); own PRNG instance
      scheduler-math.js      due-tick computation from elapsed real time and speed
      format.js              T+mm:ss, mm:ss, 1.8k rps, percent, ms, grouped ints
    dom/                     DOM glue only (thin; covered by Playwright acceptance, not by unit coverage)
      main.js  shell.js  board.js  play.js  map-svg.js  map-canvas.js  text-view.js
      panels.js  debrief.js  data-page.js  about.js  dialogs.js  live.js  storage.js  scheduler.js
scenarios/                   10 JSON files, one per incident (section 10)
test/                        node:test unit + server + scenario tests (section 14)
acceptance/                  human-written Playwright checks from ux.md (read-only in harness runs)
```

Rules that keep coverage reachable: `engine/` and `core/` hold every branch of logic. A `dom/` file may only read the DOM, write attributes and `textContent`, wire events and call `core`/`engine`. **Coverage srcDirs: `src`, `public/js/engine`, `public/js/core`** (80% floor). `public/js/dom` is excluded from unit coverage, and the acceptance suite covers it.

Static checks run as tests: in `public/js/engine/**`, `Math.random`, `Date`, `performance`, `setTimeout`, `setInterval`, `crypto`, `globalThis`, `window`, `document`, `fetch`, `Math.exp`, `Math.log`, `Math.pow`, `**`, `Math.sin`, `Math.cos`, `Math.tan`, `Math.atan2`, `Math.cbrt`, `Math.hypot` and `Intl`/`toLocaleString` are absent (grep). In `public/js/**`, `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write` and `eval`/`new Function` are absent.

---

## 2. Determinism foundations

### 2.1 Arithmetic rule
The engine uses only `+ - * /`, `Math.sqrt`, `Math.min`, `Math.max`, `Math.floor`, `Math.ceil`, `Math.round`, `Math.abs`, `Math.imul` and `>>>`. These are correctly rounded IEEE-754 in every engine. Transcendental functions (`exp`, `log`, `pow`) are implementation-defined in ECMAScript and can differ across V8, SpiderMonkey and JavaScriptCore. They are banned (ADR-2). Integer powers are computed by loops.

### 2.2 PRNG: mulberry32
State is one uint32 kept in `state.rng`. The function is pure:

```js
export function next(s) {                 // returns [newState, u] with u in [0,1)
  s = (s + 0x6D2B79F5) >>> 0;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [s, ((t ^ (t >>> 14)) >>> 0) / 4294967296];
}
export const initial = (scenarioId, seed) => fnv1a32(`${scenarioId}:${seed >>> 0}`) || 0x9E3779B9;
```

Draw order per tick is fixed. First, one draw per `client` node in topology order for workload noise. Second, one draw per log template whose `when` holds, in file order, only if its text contains a `{rand:...}` placeholder. Actions and diagnostics never draw. A golden test pins the first 8 outputs for `initial("cache-stampede", 1)`. They are generated once and committed, and Node and Playwright both assert them.

### 2.3 Hash: FNV-1a 32
`fnv1a32(str)` runs over the UTF-8 bytes from `TextEncoder`. Offset 0x811C9DC5, `h = Math.imul(h ^ byte, 16777619) >>> 0`. `hex8(h)` gives 8 lowercase hex digits, zero-padded. `canonicalJson(v)` sorts keys, uses no whitespace and writes numbers with `String(n)`.

### 2.4 Tick model
- 1 tick = 1 simulated second, so `dt = 1` is implicit in every equation. `state.tick` is the number of completed ticks and is shown as `T+mm:ss`.
- `step(state, actions)` is pure. It applies `actions` (all stamped `t = state.tick`) in array order. Then it computes tick `state.tick + 1` and returns a new state. Effects are therefore visible on the very next tick (design bar: visible within 2 s).
- The UI keeps a pending-action queue. An action the UI accepts while the engine is at tick T is stamped `t = T` and passed to the next `step`. Wall-clock time, `?speed`, tab visibility and frame rate only decide *when* `step` is called, never *what* it computes. This is why outcomes are identical at every speed (ux check 10).
- Scheduler (`core/scheduler-math.js`): `due = floor(elapsedMs * speed / 1000) - ticksRun`, capped at `speed` ticks per call (and 64 total). It is driven by `requestAnimationFrame` when visible and by `setTimeout(1000/speed)` when hidden.
- The run ends when `status` becomes `resolved` or `out-of-budget`. After that, `step` returns the state unchanged.

---

## 3. System model

### 3.1 Node types and parameters
Node ids are fixed (ux): `clients, lb, service-1, service-2, service-3, cache, db-primary, db-replica, queue, consumer, third-party`. Each id has a fixed type:

| id | type |
|---|---|
| clients | client |
| lb | lb |
| service-1..3 | service |
| cache | cache |
| db-primary, db-replica | db |
| queue | queue |
| consumer | consumer |
| third-party | third-party |

Parameters, all numbers unless marked. Defaults are applied by the validator. "-" means the parameter is not allowed for that type.

| param | client | lb | service | cache | db | queue | consumer | third-party | range | default |
|---|---|---|---|---|---|---|---|---|---|---|
| `rps` (base offered load) | yes | - | - | - | - | - | - | - | 1..100000 | required |
| `capacity` (rps per instance) | - | yes | yes | yes | yes | yes (drain cap unused) | yes | yes | 1..1000000 | required except client |
| `instances` | - | yes | yes | yes | yes | yes | yes | yes | int 1..64 | 1 |
| `capFactor` | - | yes | yes | yes | yes | yes | yes | yes | 0..10 | 1 |
| `baseMs` | - | yes | yes | yes | yes | yes | yes | yes | 0..10000 | 5 |
| `extraMs` | - | yes | yes | yes | yes | yes | yes | yes | 0..30000 | 0 |
| `timeoutMs` | - | yes | yes | - | yes | - | yes | yes | 50..60000 | 3000 |
| `errorBase` | - | yes | yes | yes | yes | - | yes | yes | 0..1 | 0 |
| `backlogMax` (requests) | - | yes | yes | yes | yes | - | yes | yes | int 0..1000000 | 0 |
| `maxDepth` | - | - | - | - | - | yes | - | - | int 1..10000000 | required for queue |
| `shed` (fraction rejected) | - | yes | - | - | - | - | - | - | 0..0.9 | 0 |
| `workers` (per instance; Little's-law cap) | - | - | yes | - | - | - | yes | - | 0..100000 (0 = off) | 0 |
| `poolSize` (DB connections per instance) | - | - | yes | - | - | - | yes | - | int 0..1000 (0 = no pool limit) | 0 |
| `hitRate` | - | - | - | yes | - | - | - | - | 0..1 | 0.95 |
| `missCost` (miss reload load on cache itself) | - | - | - | yes | - | - | - | - | 0..10 | 0 |
| `maxConnections` | - | - | - | - | yes | - | - | - | int 1..100000 | 100000 |
| `connOverhead` (saturation per open connection) | - | - | - | - | yes | - | - | - | 0..0.01 | 0 |
| `shards`, `hotShare` | - | - | - | - | yes | - | - | - | int 1..64; 0..1 | 1; 1/shards |
| `writers` (nodes accepting writes) | - | - | - | - | yes | - | - | - | int 1..2 | 1 |
| `conflictRate` (error rate per extra writer) | - | - | - | - | yes | - | - | - | 0..1 | 0 |

Edge parameters live on `edge:<from>><to>`:

| param | range | default | meaning |
|---|---|---|---|
| `calls` | 0..100 | 1 | downstream calls per upstream request |
| `share` | 0..1 | 1 | fraction of upstream requests that make this call |
| `retries` | int 0..5 | 0 | retries per failed call |
| `backoff` | bool | false | backoff with jitter on retries |
| `breaker` | bool | false | circuit breaker installed |
| `fallback` | bool | true | when the breaker is open, upstream degrades instead of erroring |
| `missOnly` | bool | true for edges from a cache, else false | carries only cache misses |

Topology must be a DAG rooted at `clients`. Edges follow the allowed direction list in `catalogue.js`: client->lb; lb->service; service->service|cache|db|queue|third-party; cache->db; queue->consumer; consumer->db|third-party|service; db-primary->db-replica (replication, `calls` = write share, used only by split-brain logic). The validator rejects cycles, unreachable nodes and nodes with no edges.

### 3.2 Per-tick computation (`model.js`). Two-pass, one-tick lag.
Notation for node n at tick k+1: `prev` = values from tick k. `clamp(x,a,b)`. Every division by zero yields 0.

**Pass 1, forward in topological order (load and local metrics):**

1. Offered load `λ_n`:
   - client: `λ = rps * W(k+1) * (1 + 0.02*(2u - 1))`. `W` is the workload curve, piecewise linear over `[[tick, multiplier], ...]` and held constant after the last point. `u` is a PRNG draw.
   - others: `λ_n = Σ_{edges e=(p->n)} out_p * calls_e * share_e * miss_e * amp_e * open_e`, where:
     - `out_p` = requests p actually forwards = `served_p` (below), and for lb `served_lb * (1 - shed)`.
     - `miss_e = (1 - hitRate_p)` if `missOnly`, else 1.
     - `amp_e` (retry amplification) uses the child's previous error rate `ε = min(0.95, prev.errorRate_n)`: `A = Σ_{i=0..retries} ε^i` (loop). With `backoff`: `A = 1 + (A - 1) * 0.25`.
     - `open_e` = 0 if the breaker on e is open, else 1.
   - Shed requests: `shedRps = served_lb * shed`. They are not errors (they appear only in logs and the `rps` label).
2. Capacity `μ_n = capacity * instances * capFactor`. With `workers > 0` (thread-bound): `μ_n = min(μ_n, workers * instances * 1000 / max(1, prev.p50_n))`. Slow dependencies therefore reduce throughput (cascade).
3. Extra demand on itself:
   - cache: `λ_eff = λ + missCost * λ * (1 - hitRate)`.
   - db: `ρ_conn = connOverhead * conns`, where `conns = Σ_{services/consumers s with edge s->n} instances_s * poolSize_s` (pools pre-fill).
   - db with `shards > 1`: hot shard utilisation `ρ_hot = (λ * hotShare) / (μ / shards)`.
4. Utilisation: `ρ = λ_eff / μ + ρ_conn`. For sharded db: `ρ = max(ρ, ρ_hot + ρ_conn)`.
5. Backlog (requests waiting): `raw = prev.backlog + λ_eff - μ`, `backlog = clamp(raw, 0, backlogMax)`, `dropped = max(0, raw - backlogMax)`, `served = min(λ_eff, μ + prev.backlog) - dropped` floored at 0.
   - Queue node: `depth = clamp(prev.depth + λ - drain, 0, maxDepth)`, `drain = min(prev.depth + λ, μ_consumer)` where `μ_consumer` is the consumer's prev-tick capacity. Overflow `max(0, prev.depth + λ - drain - maxDepth)` counts as `dropped`. Queue `served = λ - dropped`. Consumer `λ = drain`.
6. Local error terms:
   - `e_drop = dropped / λ_eff`.
   - Pool wait (service/consumer with `poolSize > 0`): required concurrency `c = λ_db_from_n * prev.p50_db / 1000`, `pool = instances * poolSize`, `e_pool = c > pool ? (c - pool) / c : 0`.
   - DB connections: `e_conn = conns > maxConnections ? (conns - maxConnections) / conns : 0`.
   - DB split-brain: `e_split = (writers - 1) * conflictRate`.
7. Saturation: `saturation = backlog > 0 ? 1 : clamp(ρ, 0, 1)`. Queue: `saturation = depth / maxDepth`.
8. Own latency: `ρc = min(ρ, 0.95)`, `q = 1 / (1 - ρc)`, `wait = 1000 * backlog / μ` (queue: `1000 * depth / max(1, drain)`), `p50_own = baseMs * q + extraMs + wait`, `p99_own = 3 * baseMs * q + extraMs + 1.5 * wait`.

**Pass 2, reverse topological order (latency and errors bubble up):**

For each outgoing edge e from n to child c, with weight `w_e = calls * share * miss_e` (calls-per-request actually made; breaker open makes the child term 0):

- `p50_n = p50_own + Σ w_e * p50_c`
- `p99_n = p99_own + Σ (w_e >= 1 ? (w_e - 1) * p50_c + p99_c : w_e * p99_c)` (one slow call plus the rest at median)
- Queue edges (queue->consumer) do not add consumer latency to producers (async).
- Child error seen after retries: `ε_c^(retries+1)` (loop). Breaker open: 0 if `fallback`, else 1.
- Timeout: `e_to = p99_n > timeoutMs ? min(1, (p99_n - timeoutMs) / (2 * timeoutMs)) : 0`.
- `errorRate_n = clamp(errorBase + e_drop + e_pool + e_conn + e_split + e_to + Σ min(1, w_e) * ε_c_after_retry, 0, 1)` (queue edges excluded).
- Clamp `p50`, `p99` to `[0, 30000]` and enforce `p99 = max(p99, p50)`.

**Breaker state** (per edge with `breaker: true`, updated at end of tick): closed -> open when the child's `errorRate >= 0.5` or `p99 >= timeoutMs`. Open lasts 5 ticks. It then goes half-open for 1 tick (`open_e = 0.1`). Half-open -> closed if the child's `errorRate < 0.2`, else back to open.

**Derived metrics:** `missRps` (cache) `= λ * (1 - hitRate)`; `connections` (db) `= conns`; `rps = λ`; `queue` = backlog (services, db, cache) or depth (queue); `hitRate` for cache nodes only (null elsewhere).

### 3.3 Invariants (checked after every tick; violation throws `EngineError("invariant: <name> on <node>")`)
- All metrics finite.
- `0 <= errorRate, saturation <= 1`; `0 <= hitRate <= 1`.
- `0 <= p50 <= p99 <= 30000`.
- `0 <= queue <= backlogMax` (or `maxDepth`).
- `λ >= 0`, `served <= λ_eff + prev.backlog`.
- `budgetLeft` is an integer in `[0, budget]`.
- `tick <= maxTicks`.

A property test runs 10 scenarios x 25 seeds x random legal action logs and asserts the invariants hold.

### 3.4 Quantisation
State keeps full doubles. Series, logs, the state hash and every `data-*` value use quantised values:
- ms: `Math.round`.
- rates and saturation: `Math.round(x * 10000) / 10000`.
- queue and rps: `Math.round`.

Display: saturation and error as percent with 1 decimal (`6.2%`), and `data-saturation`, `data-error-rate`, `data-hit-rate` as percent numbers with 1 decimal. Thresholds compare quantised values.

### 3.5 Status
Default thresholds (design-direction section 6). A scenario may override per metric in `thresholds`.

| metric | warn | crit |
|---|---|---|
| saturation | >= 0.70 | >= 0.90 |
| errorRate | >= 0.01 | >= 0.05 |
| p99 | >= 1000 ms | >= 2000 ms |
| queue/maxDepth (queue nodes) or backlog/backlogMax | >= 0.5 | >= 0.8 |
| hitRate (cache) | < 0.80 | < 0.50 |

A node's status is its worst metric. `recovering` applies when status would be `ok` but was `warn` or `crit` in any of the previous 10 ticks. Edge `data-state`: `cut` if the breaker is open; `failing` if the child `errorRate >= crit`; `loaded` if the child `saturation > 0.8`; else `normal`.

---

## 4. Alerts, logs, diagnostics, resolution

- **Alert rule:** `{id, severity 1..3, text, when: Condition, forTicks 1..30 (default 2)}`. Fires when `when` has held `forTicks` consecutive ticks. Clears when false for 3 consecutive ticks (hysteresis). A rule can fire again. `state.firstPageTick` = first tick any severity 1-2 rule fired.
- **Log template:** `{node, level info|warn|error, when?: Condition, every: int 1..60 (default 1), from?: tick, text}`. Emitted at tick k if `when` holds and `(k - from) % every == 0`. At most 6 lines per tick (file order). Engine keeps at most 5,000 lines; the UI shows the last 200.
  - Placeholders: `{m:<node>.<metric>[|int|pct|ms]}`, `{p:<path>}`, `{rand:<a>-<b>}` (integer in [a,b] from the PRNG) and `{tick}`. Integers are grouped with commas by `template.js` (no Intl). Unknown placeholders fail validation. Example: `"{m:cache.missRps|int} misses for key product:42 in 1 s"` renders `1,842 misses ...`.
- **Action log lines:** every applied action adds `{kind:"action", level:"info", node:target|null, text:"Applied: <name>"}` (diagnostics: `"Ran: <name>"`).
- **Diagnostics:** `trace-request`, `tail-logs`, `compare-dashboards`, `deploy-history` cost pager and produce text lines in `diag-result`. They never change system state or draw from the PRNG.
  - The engine always generates a default body: trace = the critical path from clients picking the child with the largest `w_e * p50_c` at each hop (one line per hop, `lb 12 ms -> service-1 840 ms -> db-primary 2,100 ms`); tail = last 30 ticks of logs from all nodes; compare = every node now vs tick 0 (p99, errors, saturation); deploy-history = scenario `deploys`.
  - Scenario `diagnostics.<id>.lines` (templates) are appended after the default.
  - `inspect` is a UI read (metrics plus that node's logs). It is free, not an engine action, not in the action log and not in the share grid.
- **Resolution:** `holdTicks` (default 5) consecutive ticks with no rule firing, after `firstPageTick` exists, and every condition in `resolve.require` (optional) true. `resolvedTick` = the tick the hold completes. `timeToMitigate = resolvedTick` (seconds from T+0, matching ux "Resolved at T+00:41" and share time). The run stops at that tick.
- **Budget:** `budgetLeft` starts at `budget`. Escalation drain: every `escalateEvery` ticks (default 90, 0 = off) after `firstPageTick` while unresolved, 1 lamp is spent (log `"Escalation: still paging after 90 s."`). Reaching 0 by any means starts grace (`graceLeft = 10`). If the incident resolves during grace the result is `resolved`; otherwise `out-of-budget` after 10 ticks. At `maxTicks` (60..600, default 600) the budget is forced to 0, so every run ends within `maxTicks + 10` ticks. Snapshots per second are at most 610.

---

## 5. Actions and effects

### 5.1 Catalogue (`catalogue.js`, fixed; scenarios cannot add ids)

| id | kind | appliesTo types | once (fix stays on) |
|---|---|---|---|
| inspect | diagnostic (UI read) | any | - |
| trace-request, tail-logs, compare-dashboards, deploy-history | diagnostic | none (global) | no |
| scale-service | fix | service, consumer | no (repeatable) |
| add-ttl-jitter | fix | cache | yes |
| circuit-breaker | fix | service, consumer | yes |
| backoff-jitter | fix | client, service | yes |
| shed-load | fix | lb | yes |
| failover | fix | db | yes |
| shard-rekey | fix | db | yes |
| add-index | fix | db | yes |
| rollback | fix | service, consumer | yes |
| raise-pool-size | fix | service, consumer | yes |
| renew-cert | fix | lb, service, third-party | yes |

### 5.2 Targeting
A fix applies to the selected node. If the topology has exactly one node of an `appliesTo` type, that node is the target automatically, with no selection needed. Otherwise the action is disabled with the reason `Works on a <type>. Select one first.` The action list order is fixed (catalogue order), independent of selection, so there is no hint leakage. Every catalogue action appears in every scenario. Its cost comes from `actions.<id>.cost`; if the scenario omits an action, it gets the default cost (diagnostic 1, fix 2) and no effects.

### 5.3 Effects
`actions.<id>.effects` is an object keyed by target node id -> array of Effect. A target with no entry is a legal no-op that still costs (history `none`).

Effect: `{path, op: "set"|"add"|"mul", value: number|boolean, ramp?: 1..30, if?: Condition}`.
- `path` is `node:<id>.<param>` or `edge:<from>><to>.<param>`, whitelisted by type (3.1).
- Booleans only with `set`.
- `if` is evaluated at apply time; false means that effect is skipped.

Semantics:
- At apply tick t the target value is computed from the current value: `set: v`, `add: cur + v`, `mul: cur * v`, then clamped to the param range.
- With ramp r the param equals `start + (V - start) * j / r` at tick `t + j` for `j = 1..r`. Without ramp it is V from tick t+1.
- A later op on the same path cancels a pending ramp, starting from the current value.
- Faults use the same Effect type.

### 5.4 Faults
`faults[]: {id, trigger: {atTick: int 0..maxTicks} | {when: Condition}, effects: Effect[]}`. Each fault triggers at most once. `state.onsetTick` = first fault trigger.

### 5.5 Cost and disable rules (UI shows, engine enforces in `canApply`)
`canApply(state, id, node)` returns `{ok:false, reason}` with exactly these reasons:
- `Out of pager budget.` when `budgetLeft == 0`.
- `Not enough pager. It costs <c> and you have <b>.`
- `Works on a <type>. Select one first.`
- `Already on.` for `once` fixes already applied to that target.
- The incident is over: the panel is hidden.

Costs: diagnostics 1..4, fixes 1..4, `inspect` 0. `step` re-checks and silently drops an illegal action (it never enters the log).

### 5.6 Condition grammar (`conditions.js`)
`Condition` is one of:
- `{node, metric, op, value}` with metric in `p50|p99|errorRate|saturation|queue|hitRate|rps|missRps|connections` (current tick; quantised).
- `{path, op, value}` (current param).
- `{tickGte: n}`.
- `{applied: actionId}` (applied to any target).
- `{fault: faultId}` (has triggered).
- `{all: Condition[]}`, `{any: Condition[]}`, `{not: Condition}`.

`op` is in `gt|gte|lt|lte|eq`. Nesting depth is at most 4; at most 16 leaves per condition.

---

## 6. Scenario JSON schema and validator

### 6.1 Top-level fields (unknown keys rejected)

| field | type and limits | required |
|---|---|---|
| `schema` | integer, must be 1 | yes |
| `id` | `^[a-z0-9-]{1,40}$`, equals file name without `.json` | yes |
| `title` | string 1..300 chars (UI truncates in rows) | yes |
| `difficulty` | int 1..3 | yes |
| `summary` | string 1..160 | yes |
| `budget` | int 1..12 | yes |
| `seed` | int 0..4294967295 (standard seed) | yes |
| `maxTicks` | int 60..600 | no (600) |
| `holdTicks` | int 1..30 | no (5) |
| `escalateEvery` | int 0..600 | no (90) |
| `labels` | object nodeId -> string 1..24 (display names, e.g. `service-1: "Checkout"`) | no (catalogue names) |
| `topology.nodes` | object nodeId -> params object (3.1), 3..11 entries, must include `clients` | yes |
| `topology.edges` | array 1..14 of `{from, to, ...edge params}` | yes |
| `workload` | array 1..32 of `[tick int, multiplier 0..20]`, ticks strictly increasing, first tick 0 | yes |
| `thresholds` | object metric -> `{warn, crit}` numbers | no |
| `sparks` | object with keys `p99, errors, saturation, queue, cache-hit` -> nodeId or null | yes |
| `faults` | array 1..8 | yes |
| `alerts` | array 1..8; at least one severity <= 2 | yes |
| `logs` | array 0..40 log templates; `text` 1..6000 chars | yes |
| `deploys` | array 0..10 of `{tick int (may be negative = before T+0), node, text 1..200}` | no |
| `diagnostics` | object diag action id -> `{cost?: 1..4, lines?: string[0..10] (templates, each 1..300)}` | no |
| `actions` | object action id -> `{cost: 1..4, effects?: {nodeId: Effect[1..8]}}` | yes (at least the optimal-path ids) |
| `resolve.require` | Condition[] 0..4 | no |
| `hint` | string 1..300 | yes |
| `rootCause` | string 1..600 | yes |
| `rootCauseNode` | nodeId in topology | yes |
| `concept` | string 1..600 | yes |
| `harmfulWhy` | object action id -> string 1..600 | yes (may be `{}`) |
| `optimalPath` | array 1..4 of `{id, node}` (fix ids only; node = target) | yes |
| `optimalSummary` | `{timeToMitigate: int, cost: int}` written by the solver tool | yes |
| `guideUrl` | string, in the allow-list (6.4) | yes |
| `guideTitle` | string 1..80 (our wording for "Read the guide: <name>") | yes |

File limits: at most 65,536 bytes, UTF-8, parsed with `core/safe-json.js` (forbidden keys are rejected the same way as in imports).

ux.md accepts `optimalPath` as action ids. This design makes each entry `{id, node}` because a target is needed to replay. The UI reads `.id` (section 17).

### 6.2 Cross-field rules
- Every node id in edges, sparks, labels, conditions, effects, logs, deploys and optimalPath exists in `topology.nodes`.
- Every action id anywhere is a catalogue id.
- An effect target node's type is in that action's `appliesTo`.
- Effect paths are whitelisted.
- Every template placeholder resolves.
- The graph is a DAG reachable from `clients`.
- `optimalPath` total cost <= `budget`.
- `harmfulWhy` keys are fix ids.
- `sparks` values are null or present nodes of a compatible type (`cache-hit` -> cache, `queue` -> a node with a queue).

### 6.3 Error format and collection
Errors are collected in document order, at most 10 per file:

`scenarios/<file>.json: field "<path>": <what is wrong>. Expected: <what is expected>.`

- `<path>` uses dots and `[i]`, for example `faults[0].effects[1].path` or `topology.nodes.cache.hitRate`. A whole-file problem uses `field "(file)"`.
- Values are echoed only for strings, as JSON, truncated to 60 chars plus `...`. Never echoed on the client board (set via `textContent` anyway).

Canonical messages:
- `missing. Expected: a non-empty string.`
- `unknown action "reboot-everything". Expected: one of <catalogue ids, comma-separated>.`
- `"https://example.com/x" is not allowed. Expected: a URL starting with https://bytebytego.com/guides/.`
- `"https://bytebytego.com/guides/nope" is not in the guide allow-list. Expected: one of the URLs in public/js/engine/guides.js.`
- `is not a known field. Expected: one of <keys>.`
- `has a cycle through service-1. Expected: edges that form a directed acyclic graph from clients.`

ux.md shows the board version `field "guideUrl": must start with https://bytebytego.com/guides/. Fix the file and restart the server.`. The board renders the same message as the server, so it reads `field "guideUrl": "https://example.com/x" is not allowed. Expected: a URL starting with https://bytebytego.com/guides/. Fix the file and restart the server.`. Check 20 matches on file, field and suffix only.

`validate(obj, file) -> {ok:true, scenario}` (deep-frozen, defaults filled) or `{ok:false, errors:[{file, field, message}]}`. The same function runs in the server at boot, in the browser on load and in `node --test`.

### 6.4 Guide allow-list (`public/js/engine/guides.js`)
A frozen array of exact URLs copied from the system-design-101 README table of contents, no trailing slash:

how-can-cache-systems-go-wrong, things-to-consider-when-using-cache, how-do-we-retry-on-failures, resiliency-patterns, a-crash-course-in-database-sharding, consistent-hashing, types-of-message-queue, 7-must-know-strategies-to-scale-your-database, how-does-https-work, cap-theorem-one-of-the-most-misunderstood-terms, how-to-deploy-services (each prefixed `https://bytebytego.com/guides/`).

All 11 are verified present in README lines 124-429. The rule: an entry must start with `https://bytebytego.com/guides/` and match `^https://bytebytego\.com/guides/[a-z0-9-]{1,120}$`. `test/guides.test.js` asserts the regex for each entry. When `SD101_README` (env) or the sibling path `../../../system-design-101/README.md` exists, it also asserts each entry appears verbatim in it, otherwise it skips with a note. URLs are never fetched.

---

## 7. Engine API, runs, classification

### 7.1 Exports (`engine.js`)
- `createRun(scenario, seed, {failAtTick} = {}) -> State`
- `step(state, actions) -> State`, where `actions: [{id, node|null}]`
- `canApply(state, id, node) -> {ok, reason?, target?}`
- `statusOf(state, nodeId)`, `firingAlerts(state)`

State is a plain JSON-serialisable object:
```
{ v:1, scenarioId, scenarioHash, seed, tick, rng,
  params:{node:{...}}, edgeParams:{"a>b":{...}}, ramps:[...],
  m:{node:{p50,p99,errorRate,saturation,queue,hitRate,rps,missRps,connections,served,backlog}},
  breakers:{"a>b":{state,left}}, faultsFired:[], alerts:{id:{firing,run,clearRun,since}},
  logs:[{t,node,level,kind,text}], series:{p99:[],errors:[],saturation:[],queue:[],"cache-hit":[]},
  statusHistory:{node:[last 10]}, budgetLeft, graceLeft, status, onsetTick, firstPageTick,
  resolvedTick, holdRun, peakError, actionLog:[{t,id,node}], applied:{"id@node":true},
  pendingClass:[{t,id,node,revealAt,effect}], hash }
```

`failAtTick` throws `EngineError("deliberate failure")` when reached. Only test mode passes it.

### 7.2 State hash and fingerprint (`fingerprint.js`)
- `data-state-hash` is chained. `hash_0 = fnv1a32("")`. Each tick, `hash_k = fnv1a32(hex8(hash_{k-1}) + "|" + tickLine)`, where `tickLine` = canonical quantised metrics of all nodes in id order, then that tick's log lines joined by `\n`.
- Run fingerprint = `hex8(fnv1a32("v1|" + scenarioId + "|" + scenarioHash + "|" + seed + "|" + actionLog.map(a => a.t + ":" + a.id + "@" + (a.node || "-")).join(";") + "|" + (hintUsed ? "h" : "")))`.
- `scenarioHash` = `hex8(fnv1a32(canonicalJson(scenario)))` of the validated scenario.

### 7.3 Effect classification (`classify.js`)
At apply tick t, the engine forks two states. A = with the action, B = without. Each runs 5 ticks with no further actions. `badness(s) = Σ_nodes (saturation + 5 * errorRate) + 2 * firingAlerts`.
- diagnostic actions -> `diagnostic`
- fix with `badness(A) - badness(B) >= 0.25` -> `harmful`
- fix with `badness(B) - badness(A) >= 0.25`, or A resolves earlier -> `helpful`
- else -> `none`

The result is stored in `pendingClass` and revealed at tick t+5 (or at run end if sooner), so history `data-effect` appears "once known". This matches ux.md "raised saturation or errors in the next 5 s" and stays deterministic. Harm in a scenario therefore comes only from data (effects and physics). `harmfulWhy[id]` supplies the text, and the scenario test fails if a fix classifies as harmful at `firstPageTick` with no `harmfulWhy` entry. Share letters: `D` diagnostic, `F` helpful, `x` harmful, `.` none.

---

## 8. Scoring (`score.js`)

Inputs:
- `tYou` = timeToMitigate or null
- `tOpt` = `optimalSummary.timeToMitigate`
- `left` = budgetLeft
- `budget`
- `costOpt` = `optimalSummary.cost`
- `harmful` = count of `x`
- `hint` = whether a hint was used

Formula:
- `time = tYou ? 50 * min(1, tOpt / tYou) : 0`
- `pager = tYou ? 30 * min(1, left / max(1, budget - costOpt)) : 0`
- `collateral = max(0, 20 - 10 * harmful)`
- `hintCost = hint ? 5 : 0`
- `score = clamp(Math.round(time + pager + collateral - hintCost), 0, 100)`

Tier:
- `out-of-budget` -> `Escalated`
- resolved and score >= 90 -> `Textbook`
- resolved and score >= 70 -> `Solid`
- other resolved -> `Survived`

The stat strip shows `Hint used (-5 score)`.

**Worked example** (cache-stampede, budget 6, optimal `[add-ttl-jitter]`, `tOpt = 35`, `costOpt = 1`). The player runs `trace-request` (1) and then `add-ttl-jitter` (1) and resolves at 41, with no harm and no hint:
- time = 50 * 35/41 = 42.68
- pager = 30 * min(1, 4/5) = 24
- collateral = 20
- total 86.68 -> **87**, tier `Solid`

Share line: `incident-sim #323 cache-stampede  [D F]  4/6 pager  00:41` then `score 87  optimal 00:35  harmful 0  fp xxxxxxxx`. The same run with one harmful `scale-service` first (cost 2, so left 2): pager = 12, collateral 10, time maybe 50 * 35/55 = 31.8 -> 54 `Survived`. Out of budget with one harmful step and a hint: 0 + 0 + 10 - 5 = 5, `Escalated`.

---

## 9. Optimal-path solver (`solver.js`)

- **Candidates:** every `(fixId, node)` pair that has a non-empty `actions.<id>.effects.<node>` entry (at most 12 after the validator; distractors are included).
- **Schedule:** the first action at `firstPageTick` of the no-action run, each later one 2 ticks after the previous (the ux checks press `.` twice). This makes paths comparable to human play.
- **Search:** iterative deepening, depth 1..4, no repeated pair. Prefix states are cached (a pure state is a snapshot), so each node of the search costs at most `maxTicks` ticks for its suffix only. The bound is `Σ_{d=1..4} 12^d <= 22,620` leaf runs x at most 610 ticks x 11 nodes, about 150M node-updates worst case. Prune any path whose total cost exceeds `budget`, and any branch whose prefix already resolved.
- **Objective (lexicographic):** resolved, then min timeToMitigate, then min cost, then min length, then lexicographic `id@node` string.
- **When it runs:** never in the browser at runtime. `node test/tools/solve.js <file>` prints the path and `optimalSummary` for authors. `test/scenarios.test.js` runs the solver on every shipped scenario (time cap 20 s per scenario, enforced by `node:test` timeout) and asserts the declared `optimalPath` and `optimalSummary` equal the solver output.
- **Debrief:** replays the stored `optimalPath` once with the run's seed (at most 610 ticks, well under 50 ms) for the dashed p99 trace and the Optimal lane. The optimal lane uses the run's seed. `optimalSummary` was computed with the standard seed, and workload noise is only ±2%. The debrief displays the replayed optimal time, and scoring uses `optimalSummary` so scores are seed-stable.

---

## 10. The 10 shipped scenarios

Common to all: onset by tick 4-6; first SEV2 page between ticks 6 and 9 for every seed (test with 50 seeds, needed for SC1 within 10 s); `sparks.p99 = "lb"` labelled "checkout p99"; diagnostic costs 1; all numbers are starting values that authors tune until the scenario tests pass. Topology notation `a>b`.

1. **cache-stampede** (d1, budget 6, guide how-can-cache-systems-go-wrong)
   - Topology: clients>lb>service-1(Checkout)>cache>db-primary. clients rps 2000. cache capacity 3000, `missCost 1`, hitRate 0.95. db capacity 1200, backlogMax 20000, baseMs 8.
   - Fault: at tick 4, `node:cache.hitRate set 0.08` (TTLs of the hot keys expire together).
   - Chain: misses 100 -> 1,840 rps, so db ρ = 1.53 and the backlog grows. Cache ρ = 1.28 (pile at the cache). lb p99 > 2 s by tick 6.
   - Alerts: SEV2 "checkout p99 > 2 s" (`lb.p99 gt 2000`, for 2); SEV3 "Cache hit rate under 80%".
   - Log (cache, warn, every 1): `{m:cache.missRps|int} misses for key product:42 in 1 s`.
   - Optimal `[add-ttl-jitter@cache]` (cost 1): `hitRate set 0.95 ramp 3`. The backlog drains at about 1,100 rps, so it resolves by about T+35.
   - Harmful: `failover@db-primary` (cost 2): `db-primary.capFactor set 0.2` then `ramp` back over 15 (cold replica). harmfulWhy given.
   - Distractor: `scale-service@service-1` no effect on the bottleneck (`none`).
2. **thundering-herd** (d2, budget 6, things-to-consider-when-using-cache)
   - Topology: clients>lb>service-1>cache>db-primary. clients>lb edge `retries 4`.
   - Fault: at tick 5, cache restart (deploy at tick 4): `hitRate set 0`, with a warm-up ramp only after load drops (`resolve` via a fix). Every client reconnects at once: workload spike x3 for 20 ticks, then x1.6 sustained by retries.
   - Chain: cold cache -> db overload -> lb errors -> synchronised client retries keep load at about 4x, so the cache never warms.
   - Optimal `[backoff-jitter@clients]`: `edge:clients>lb.backoff set true`, `retries set 2`, plus `node:cache.hitRate set 0.93 ramp 20 if {node:lb, metric:errorRate, op:lt, value:0.3}` (it evaluates at apply time after the backoff effect, so it is listed second and the condition reads the post-effect metric of the previous tick). If that does not resolve within maxTicks, the solver finds the two-step `[shed-load@lb, backoff-jitter@clients]` and the file records it.
   - Harmful: `scale-service@service-1` (more served -> more cold misses -> db crit).
3. **retry-storm** (d2, budget 6, how-do-we-retry-on-failures)
   - Topology: clients>lb>service-1>third-party(Payments), service-1>db-primary. Edge service-1>third-party `retries 4`. third-party capacity 500, base load 400. service-1 capacity 1500 x 2.
   - Fault: at tick 5, `third-party.errorBase set 0.3`, `extraMs set 600`.
   - Chain: a 30% error rate triggers retries, offered load exceeds capacity, drops push error toward 0.9, and amplification reaches about 4.1 (edge dot rate >= 3x baseline, ux check 19).
   - Optimal `[backoff-jitter@service-1]`: `edge:service-1>third-party.backoff set true`, `retries set 1`. Partner load falls below capacity and errors fall to its 30% base. A SEV2 on `lb.errorRate gt 0.05` would keep firing, so the alert uses partner overload: SEV2 "payments timeouts" `third-party.saturation gte 0.9`, plus SEV2 checkout p99. The fault also has a self-heal effect, `third-party.errorBase set 0.02 ramp 10`, triggered `when {node:third-party, metric:saturation, op:lt, value:0.7}`. The storm keeps a recovering dependency down, and removing it lets the partner recover.
   - Harmful: `scale-service@service-1` (service was capping retries; scaling forwards more).
4. **hot-partition** (d2, budget 6, a-crash-course-in-database-sharding)
   - Topology: clients>lb>service-1>db-primary with `shards 4`, `hotShare 0.25`, capacity 4000.
   - Fault: at tick 4, `hotShare set 0.7` (a celebrity key).
   - Chain: hot shard ρ = 2800/1000 = 2.8 against total ρ 0.7. Compare-dashboards shows the db at "70% total" while the p99 explodes, and the log reads `shard 3 handling {rand:68-72}% of writes for key user:9001`.
   - Optimal `[shard-rekey@db-primary]`: `hotShare set 0.27 ramp 5`.
   - Harmful: `scale-service@service-1`; `failover@db-primary` (the replica has the same key layout, plus a promotion blip).
   - Distractor: `add-index` (db baseMs x0.8, `none`).
5. **queue-backlog** (d1, budget 6, types-of-message-queue)
   - Topology: clients>lb>service-1>queue>consumer>db-primary. queue maxDepth 60000. consumer capacity 900, base flow 800.
   - Fault: at tick 4, consumer deploy (deploy-history shows `consumer v41 at T-00:02` with a sync HTTP call): `consumer.capFactor set 0.35`.
   - Chain: drain 315 < 800, so depth grows to 80% and producer drops show up as service errors. Alert SEV2 "order confirmations delayed" `queue.queue gte 30000`; the SEV3 queue warn has a lower threshold.
   - Optimal `[rollback@consumer]`: `capFactor set 1`. The extra headroom (900-800) drains slowly, so `scale-service@consumer` (+2 instances) is also needed. The solver's best is recorded (expected `[rollback@consumer, scale-service@consumer]` or the single scale).
   - Harmful: `shed-load@lb` is `none`. No harmful action in this scenario.
6. **n-plus-one** (d2, budget 6, 7-must-know-strategies-to-scale-your-database)
   - Topology: clients>lb>service-1>db-primary, plus cache>db-primary unused. db capacity 6000, base calls 1, load 1200.
   - Fault: at tick 3, deploy `service-1 v212 "order page shows line items"`; at tick 4, `edge:service-1>db-primary.calls set 12`.
   - Chain: 14,400 queries/s, so db ρ = 2.4. The service p99 grows with 12 sequential calls. Trace shows `12 x SELECT * FROM line_items WHERE order_id = ?`.
   - Optimal `[rollback@service-1]`: `calls set 1`.
   - Distractor `add-index@db-primary`: `capacity mul 1.3`, `baseMs mul 0.7`, which helps but leaves ρ about 1.8 (`helpful` but not resolving).
   - Harmful: `scale-service@service-1` (more served -> more queries).
7. **connection-pool-exhaustion** (d2, budget 6, 7-must-know-strategies-to-scale-your-database)
   - Topology: clients>lb>service-1(3 instances, poolSize 30)>db-primary (maxConnections 120, connOverhead 0.002, capacity 5000, baseMs 20).
   - Fault: at tick 4, workload x2.4 (flash sale) plus `db-primary.baseMs set 45` (heavier queries). Required concurrency is about 3600 x 0.05 = 180 > pool 90, so `e_pool` is about 0.5 and the service error rate goes crit.
   - Log (service-1): `timeout waiting for connection from pool (90/90 in use)`.
   - Optimal `[raise-pool-size@service-1]`: `poolSize set 40` -> 120 connections <= 120. The resolve test tunes baseMs or capacity so that required concurrency is <= 120.
   - Harmful (SC3): `scale-service@service-1` (`instances add 3`) -> conns 180 > 120, so `e_conn` = 0.33 and db saturation +0.18. Log (db, error, `when {node:db-primary, metric:connections, op:gt, value:120}`): `FATAL: too many connections (180/120)`. harmfulWhy: "Scaling the service added more connection pools, and the database was already at its connection limit. The bottleneck moved to the database and more requests failed."
8. **expiring-certificate** (d1, budget 6, how-does-https-work)
   - Topology: clients>lb>service-1>db-primary. Edge clients>lb `retries 2`.
   - Fault: at tick 5, `lb.errorBase set 0.62`. Clients with strict validation fail, and retries add load.
   - Logs: `TLS handshake failed: certificate expired at {tick}` (lb, error); deploy-history shows no recent deploy (a red herring is removed).
   - Optimal `[renew-cert@lb]`: `errorBase set 0`.
   - Harmful: `rollback@service-1` (`service-1.capFactor set 0.5 ramp` for a cold restart; no effect on TLS).
9. **split-brain** (d3, budget 8, cap-theorem-one-of-the-most-misunderstood-terms)
   - Topology: clients>lb>service-1>db-primary, service-1>db-replica (reads, share 0.6), db-primary>db-replica.
   - Fault: at tick 5, network partition: `db-replica.writers set 2`, `db-primary.writers set 2`, `conflictRate 0.08` on both. Metrics look mild except the error rate (8% write conflicts). Logs: `write conflict on order:{rand:10000-99999}: two primaries accepted versions` and `replication link down`.
   - Optimal `[shed-load@lb, failover@db-replica]`: shed `lb.shed set 0.3`, then failover fences: `db-primary.writers set 1`, `db-replica.writers set 1`, `conflictRate set 0`. Failover is harmful when `lb.shed lt 0.2`: the effect `if {path:"node:lb.shed", op:lt, value:0.2}` adds `db-replica.capFactor set 0.25 ramp 1` (promotion replay under full load). The solver confirms the order.
   - Harmful: `scale-service@service-1` (more writers -> more conflicts via the `connections` condition on conflictRate `add 0.04`); failover first.
10. **cascading-failure** (boss, d3, budget 8, resiliency-patterns)
    - Topology: clients>lb>service-1(Checkout, workers 200)>db-primary; lb>service-2(Recommendations, workers 100, share 0.5 of lb out)>third-party; service-1>cache. Edge clients>lb `retries 3`. db capacity 4000.
    - Fault: at tick 5, `third-party.extraMs set 4000`.
    - Chain:
      1. service-2 throughput falls to `workers * 1000 / p50` (about 25 rps per instance), so it backlogs and times out.
      2. Client retries (3) amplify at the lb, about x2.5.
      3. service-1 saturates and backlogs, so its p99 > 2 s.
      4. This is a metastable retry loop. Alerts: SEV1 "checkout errors > 5%" (`service-1.errorRate`), SEV2 "checkout p99 > 2 s", SEV2 "recommendations timeouts".
    - Required order `[shed-load@lb, circuit-breaker@service-2, scale-service@service-1]`:
      - shed `lb.shed set 0.4` breaks the retry loop;
      - breaker `edge:service-2>third-party.breaker set true`, `fallback true` frees service-2 workers;
      - scale `service-1.instances add 2` drains the backlog.
    - Single fixes all leave >= 1 alert (scenario test plus ux check 7).
    - `scale-service` before shed is harmful: served retries reach db ρ > 1 (crit), with a "db saturation" alert. harmfulWhy given. Scenario test: the solver's best has length 3, no path of length <= 2 resolves within maxTicks, and the declared order equals the solver output.

Scenario tests assert, per scenario:
- validity;
- solver = declared;
- first page tick within 6..9 (50 seeds);
- for each optimal step, the "metric direction" (rootCauseNode badness falls within 5 ticks);
- each listed harmful action classifies `harmful` at firstPageTick;
- each `harmfulWhy` key is harmful somewhere in solver exploration.

ux check 19 measurements: retry-storm edge dot rate >= 3x and stampede cache pile >= 12 and db edge >= 4x (section 12.3).

---

## 11. Daily seed, share, progress

### 11.1 Daily seed (`core/daily.js`)
Input is the local date string `YYYY-MM-DD` (`dom` builds it from `new Date()` local fields).
- `number = (Date.UTC(y, m-1, d) - Date.UTC(2026, 0, 1)) / 86400000 + 1`, so 2026-11-19 is 323.
- `scenarioId = sortedValidIds[fnv1a32("daily:" + date) % n]`.
- `seed = fnv1a32("daily-seed:" + date)`.

Identical for everyone with the same date and the same valid scenario set (stated on the card). The first run (`#/`) starts `cache-stampede` with the daily seed.

### 11.2 Share text (`core/share.js`)
Exact format per design-direction section 13. Line 1: `incident-sim <#n|seed:s> <id>  [<letters space-separated>]  <left>/<budget> pager  <mm:ss|OUT>`. Line 2: `score <n>  optimal <mm:ss>  harmful <n>  fp <hex8>`. Letters cover every logged action, at most 12 because every non-inspect action costs at least 1. The text has no URL, name or emoji and is at most 160 chars (asserted). Clipboard: `navigator.clipboard.writeText`. On rejection or absence, select the `pre` text with a Range and show the ux fallback text. There is no `execCommand`.

### 11.3 Progress storage (`incident-sim:v1`)
The value is exactly the export format:
```
{ "version": 1, "runs": [ { "scenario": id, "seed": uint32, "scenarioHash": hex8,
  "result": "resolved"|"out-of-budget", "timeToMitigate": int|null, "budgetLeft": int 0..12,
  "harmful": int 0..12, "hintUsed": bool, "score": int 0..100,
  "actions": [ { "t": int 0..610, "id": actionId, "node": nodeId|null } ] (0..12) } ] }
```
- At most 200 runs (append; drop oldest). Serialised at most 262,144 bytes (drop oldest until it fits).
- Best time and score per scenario are derived.
- The debrief replays the last run of that scenario. If `scenarioHash` differs from the loaded scenario, it shows `replay-unavailable`.
- `incident-sim:settings` = `{shortcuts: bool}` (not exported). Storage access is wrapped in try/catch. A probe write at boot detects blocked storage and shows `storage-warning`.
- Corrupt stored value: parsed with the same strict validator. If invalid, the app treats progress as empty for display, never overwrites it until the next successful save, and shows the storage-warning variant "Saved progress could not be read; new results will replace it." (new copy, section 17).

### 11.4 Strict import (`core/safe-json.js` + `core/progress.js`)
Order (first failure wins; the reason never echoes a value; key and path names are truncated to 40 chars):
1. `file.size > 262144`, or UTF-8 byte length > 262144 -> `the file is <n> KB and the limit is 256 KB.`
2. Depth pre-scan over the raw text, skipping string contents with escapes: max nesting 8, max 20,000 tokens (`{`, `[`, `,`), else `the file is nested too deeply.`
3. `JSON.parse` in try/catch -> `the file is not valid JSON. Export a fresh file from this page and try again.`
4. Walk: any key `__proto__`, `constructor` or `prototype` at any depth -> `the file contains the key "<k>", which is not allowed.`. `JSON.parse` creates own properties, so nothing is polluted. The walk uses `Object.keys` and never reads `obj[k]` through the prototype chain.
5. Rebuild into `Object.create(null)` objects with an exact key whitelist. Then check `version` (`this file is version 7 and this app reads version 1.`), unknown key (`field "runs[0].name" is not part of the progress format.`), types and ranges, scenario id pattern (`field "runs[0].scenario" must use only lowercase letters, digits and hyphens.`), known scenario (`"runs[1].scenario" names an incident this copy does not have.`), action ids in the catalogue, run count.
6. Success: confirm dialog if progress exists. Then write `JSON.stringify` of the rebuilt object, then read back and re-validate.

Every shown string uses `textContent`. Stored progress is untouched on any rejection (ux check 23).

---

## 12. UI architecture

### 12.1 Boot and routing (`dom/main.js`)
1. Fetch `/test-mode.json` (404 means off).
2. Read settings and the progress probe.
3. Fetch `/scenarios/index.json` (300 ms -> `boot-loading`; 8 s timeout -> `app-error`).
4. Fetch each valid scenario and re-validate. Client errors are appended to the board list.
5. Start the hash router (`core/routes.js`): routes per ux. `?seed=` accepts `^\d{1,10}$` <= 4294967295, else the board's inline error.

Route change focuses the h1, except first-run autostart.

### 12.2 Play loop (`dom/play.js`)
- Holds `state`, `pendingActions`, `snapshots[]` (one per tick, for the debrief).
- Scheduler: for each due tick, `state = step(state, pending.splice(0))`. Then `vm = viewmodel(state, ui)` and a DOM diff of attributes and `textContent` only where changed (budget <= 2 ms per tick).
- Particles run per animation frame from the latest `vm.edges`. The canvas never reads engine state directly.
- Text mode: no scheduler. `Step 1 s`, `Step 5 s` and `Run` call step. After an action, 2 steps run, then pause.
- Engine exceptions are caught -> `app-error` with the seed. The run is not saved.
- On end: save the run (11.3), stop the scheduler, clear alerts one by one (300 ms stagger; all at once under reduced motion). This stagger is UI-only; the engine already cleared them.

### 12.3 Map (`core/layout.js`, `dom/map-svg.js`, `core/particles.js`, `dom/map-canvas.js`)
Per design-direction section 7 and section 11:
- SVG built once per layout; updates are attribute and text only. Canvas holds dots only, with 3 sprites, `drawImage`, DPR capped at 2.
- `data-dot-rate` per edge: `clamp(rps / baselineRps * 8, 0.5, 40)`. `baselineRps` = that edge's rps at tick 0, computed even under reduced motion and in text mode (the attribute is still set where the map exists).
- `data-pile` per node: `min(24, round(24 * max(clamp((saturation - 0.7) / 0.3, 0, 1), queueRatio)))`. This is a pure function, so tests read it without a canvas.
- Particle positions use a separate mulberry32 seeded `seed ^ 0xA5A5A5A5`, so visuals are reproducible and never fed back into the engine.
- Frame-budget governor: rolling 60-frame p95 > 12 ms halves `data-dot-cap` (500 -> 250 -> 125), never raised within an incident.
- `requestAnimationFrame` is cancelled when hidden, paused or in text mode.

### 12.4 Keyboard (`core/keys.js`)
`keys.resolve({key, ctrl, alt, meta, targetKind, context, shortcutsOn}) -> command|null` implements the ux keyboard table exactly. `targetKind` is `text|button|map-node|action|slider|dialog|other`. Single keys are ignored when `targetKind` is `text` or `dialog`, any modifier is held, or shortcuts are off. Space maps to pause only for `other` or `map-node`. Map arrow movement uses `layout.nearest(fromId, dir)` (pure: the smallest angle-weighted distance among nodes whose centre lies in the 90-degree cone).

### 12.5 Live regions (`core/announcer.js`)
- Pure queue keyed by sim time. Assertive (`alert-live`) only for new SEV1/SEV2 pages, at most 1 update per 3 simulated seconds. Pages inside the window merge into `N new pages. ...`.
- Polite: the rest of the ux list.
- Clear-then-set after 50 ms is done in `dom/live.js`.
- Log lines and toasts are never announced.

### 12.6 data-* contract
`core/viewmodel.js` produces every `data-*` value and aria name in ux.md from `(state, uiState)`. `data-updated-at` = last repainted tick. Under reduced motion the view model repaints only on even ticks and holds the previous metrics on odd ticks; the engine still steps every tick. `data-speed` is the honoured speed, else 1. `data-state-hash` = `hex8(state.hash)`.

### 12.7 Test mode gating (`core/testmode.js`)
`parse(testModeFlag, search)` returns `{speed, paused, pauseAt, failAt, active}`. With the flag false it always returns defaults (`speed 1`, nothing active). `speed` must be in {1,2,4,8,16,32,64}. `pause-at` and `fail-at` must be integers 0..600. The banner shows when `active`. These values are never persisted or settable in the UI.

### 12.8 Reduced motion
`matchMedia('(prefers-reduced-motion: reduce)')`, live-updated. When on: no canvas spawn (`data-dots=0`), metric repaint on even ticks, alerts clear at once, replay play `aria-disabled`, toasts instant. CSS kill switch per tokens.

### 12.9 Debrief (`core/debrief-model.js`)
1. `replay(scenario, run.seed, run.actions)` -> snapshots and final state.
2. If the final `resolvedTick`, `budgetLeft` and score do not match the saved run, or `scenarioHash` differs -> `replay-unavailable`. The saved stats still show.
3. The optimal lane is the stored `optimalPath` scheduled as in section 9 and replayed with the same seed.
4. Narration: `T+mm:ss. You <past-tense action>. <spark metric> <a>% to <b>%.` comparing that tick with 5 ticks later.

Scrubbing reads snapshots, so it is instant.

---

## 13. Server (`src/`)

Same discipline as `examples/wiki` (wiki design section 7, `http.js`, `router.js`), reduced to static GET.

- **Config:**
  - `PORT` (default 3000; 0 = any free port; integer 0..65535 else exit 1 `PORT must be an integer from 0 to 65535`).
  - `HOST` (default `127.0.0.1`; only `127.0.0.1`, `::1`, `localhost`, else exit 1 `HOST must be a loopback address; exposing incident-sim needs a security review`).
  - `INCIDENT_SIM_TEST` (`1` = on; anything else off).
  - `SCENARIOS_DIR` (default `./scenarios` relative to the app root, realpath'd).
- **Startup output:** each problem line `scenario error: <formatted error>`, then `Incident Simulator running at http://localhost:<port>` and `Loaded <n> scenarios.` (`Loaded 1 scenario.` singular). Zero valid scenarios keeps serving (the board shows empty). An unreadable dir exits 1 with `Cannot read SCENARIOS_DIR <path>`.
- **Scenario load:**
  - Only names matching `^[a-z0-9-]{1,40}\.json$`. Other `.json` names produce an error with `field "(file)"`.
  - `lstat`: symlinks and non-regular files are rejected. Size <= 65,536.
  - Read once at boot. No hot reload; edits need a restart, as stated in the copy.
  - `index.json` = `{ "valid": [ids sorted], "errors": [{file, field, message}] }`.
- **Request pipeline, pinned order:**
  1. Host header must be in `{localhost:<port>, 127.0.0.1:<port>, [::1]:<port>}`, else 403 text `This host name is not allowed.` (DNS rebinding).
  2. Method `GET` or `HEAD`, else 405 with `Allow: GET, HEAD`. No request body is ever read. There is no API, so no Origin or CSRF surface; `Sec-Fetch-Site: cross-site` on any request gets 403.
  3. Path: the query string is stripped, and the raw path is compared as an exact Map key against a boot-time allow-list. There is no filesystem lookup from request input, so `..`, `%2e%2e` and `%2F` can never resolve.
     - `/` and `/index.html` -> shell
     - `/app.css`, `/tokens.css`, `/favicon.svg`
     - `/js/engine/*.js`, `/js/core/*.js`, `/js/dom/*.js` (names matching `^[a-z0-9-]+\.js$`)
     - `/scenarios/index.json`
     - `/scenarios/<id>.json` for valid ids only (exact bytes read at boot)
     - `/test-mode.json` only when test mode is on (`{"testMode":true}`)
  4. Anything else -> 404 `text/plain` `Not found.` There is no SPA fallback because routing uses the hash.
- **Headers on every response, including errors:**
  - `Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; font-src 'none'; manifest-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'`
  - `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`, `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=(), clipboard-read=()`
  - `Cache-Control: no-cache` (static) and `no-store` (`test-mode.json`, `index.json`)
  - Content types: html, css, js (`text/javascript`), json, svg (`image/svg+xml`)
- **Errors:** a handler exception logs and sends 500 `Something went wrong on the server.`. A request `error` is ignored. `uncaughtException` logs and exits 1. Port in use: exit 1 `Port <p> is in use`.
- Export download uses `URL.createObjectURL(Blob)` with an `a[download]` click. That is not a network request, and CSP does not need `blob:` for downloads.

---

## 14. Testing

`node --test` in `test/`:
- **Engine:** PRNG golden; FNV vectors (`""` -> 811c9dc5, `"a"` -> e40c292c); each equation on hand-computed cases (cache miss load, retry amp with ε 0.5/retries 2 = 1.75 and with backoff 1.1875, pool wait, connection overflow, hot shard, Little's-law workers, queue drain, timeout errors, breaker transitions); invariants property test; determinism (same seed and log gives identical hash at every intermediate tick and when stepping in chunks of 1, 5 or 64); action stamping (an action given at tick T affects T+1 only); escalation drain and grace; resolution hold; banned-API grep.
- **Validator:** one test per rule, plus the three SC9 fixtures and exact message strings. The shipped scenarios are all valid. A `SCENARIOS_DIR` override test fails with file and field named (ux check 20).
- **Scenarios** (section 10 list), solver equality, cascade single-fix failure.
- **Core:** score worked example (87); share format regexes from ux check 24; daily (2026-11-19 -> #323, deterministic); routes and seeds; progress import with all six hostile fixtures from ux check 23 plus depth bomb `[[[[...` and 20k-key object; prototype unpolluted; keys table; announcer throttle; viewmodel attributes; particles cap and pile; layout nearest-neighbour; testmode parsing.
- **Server:** Host 403, 405 with Allow, 404 for `/js/../src/server.js`, `/scenarios/../package.json`, `/%2e%2e/`, `/scenarios/invalid-id.json`; headers present on 200, 403, 404 and 405; `/test-mode.json` 404 without env and 200 with it; startup lines; HOST rejection.
- **Contrast:** `test/contrast.test.js` per design-direction.
- **Coverage:** srcDirs `src`, `public/js/engine`, `public/js/core`; floor 80%.
- **Acceptance:** `acceptance/` Playwright per ux.md checks 1-40 (human-written, read-only).

`security-reviewer` reviews `core/safe-json.js`, `core/progress.js`, `dom/storage.js`, `src/router.js`, `src/http.js` and `src/scenarios-load.js`.

---

## 15. Security summary

- **No network at runtime:** `connect-src 'self'` and only same-origin fetches (`test-mode.json`, `scenarios/*`). Guide and About links are user-initiated `target=_blank rel="noopener noreferrer"` navigations, not fetches.
- **XSS:** all scenario, log, import and storage strings go through `textContent` or `createElementNS` with fixed attribute names. No `innerHTML` (test scan). No inline script or style; the CSP forbids both. SVG text uses `textContent`. `href` values come only from the validated allow-list or constants.
- **Hostile JSON:** section 11.4. The same parser handles scenario files on the server.
- **localStorage corruption:** read via the strict validator; never trusted; never auto-overwritten on parse failure (11.3).
- **Clipboard:** write-only, plain text, user-initiated. `clipboard-read` is disabled by Permissions-Policy.
- **Server:** loopback-only bind, Host allow-list, exact-key static map, no body parsing, full headers, test mode only by env and still loopback.
- **Licence and attribution:** the source repo LICENSE.md states **CC BY-NC-ND 4.0** (Attribution-NonCommercial-NoDerivatives 4.0 International), linking `http://creativecommons.org/licenses/by-nc-nd/4.0/`. It is not BY-NC-SA as the brief and ux.md say.
  - About text: "Incident Simulator teaches reliability patterns using the guides in ByteByteGo's system-design-101. We link to the guides and wrote every scenario, debrief and label ourselves; we copied no guide text or images. system-design-101 is licensed CC BY-NC-ND 4.0, so this project is for non-commercial use."
  - Links: `https://github.com/ByteByteGoHq/system-design-101` and `https://creativecommons.org/licenses/by-nc-nd/4.0/` (link text "CC BY-NC-ND 4.0").
  - Because the licence is NoDerivatives, authors must not paraphrase guide text closely. Our text explains concepts independently.
  - Any commercial use, or use of the ByteByteGo name beyond attribution, needs a human decision.

---

## 16. Failure modes and limits

| Failure | Behaviour |
|---|---|
| Scenario invalid | Server line, index error, board partial list; route to it -> not-found |
| All invalid | `picker-empty`, daily card hidden, server still serves |
| index.json fetch slow or fails | boot-loading at 300 ms, app-error at 8 s or on failure, Retry |
| Client-side validation disagrees (stale cache) | client errors appended; scenario excluded |
| Engine exception or invariant | app-error with the seed; progress untouched |
| Storage blocked or quota | storage-warning; play continues; export still works from memory |
| Stored progress corrupt | treated as empty plus notice; not overwritten until a new save |
| Replay mismatch or scenario changed | replay-unavailable; stats and story shown |
| Clipboard denied | selected text plus note |
| Tab hidden | ticks continue on timers; no rAF |
| Slow device | dot cap halves; engine unaffected |

| Limit | Value |
|---|---|
| Scenario file | 64 KB; 11 nodes, 14 edges, 8 faults, 8 alerts, 40 log templates, 4 optimal steps |
| Run length | `maxTicks` <= 600 plus 10 s grace; snapshots <= 610 |
| Engine logs | 5,000 lines (UI 200) |
| Actions per run | <= 12 (each costs >= 1; budget <= 12) |
| Import and storage | 256 KB, 200 runs, depth 8, 20k tokens |
| Share text | <= 160 chars |
| Solver | depth 4, <= 12 candidates, test cap 20 s per scenario |
| Live dots | 500 (governor 250, 125) |

---

## 17. Conflicts and resolutions (ux.md edits required)

1. **Licence (blocking):** brief and ux.md say CC BY-NC-SA 4.0. The source LICENSE.md says **CC BY-NC-ND 4.0**. Edit the ux About copy, the copy table row, check 26 (`"CC BY-NC-ND 4.0"`, `https://creativecommons.org/licenses/by-nc-nd/4.0/`) and the brief licence line. Flag to the human.
2. **Title length:** the ux schema says 80 chars, but check 37 requires a valid 300-char title. Limit set to 300 (6.1).
3. **Progress format:** add `scenarioHash` per run and `node` per action (needed for replay, targeting and replay-unavailable). Update the ux Your data format line.
4. **`optimalPath` shape:** entries are `{id, node}` objects, not bare ids. ux checks reading "action ids from optimalPath" use `.id`. `optimalSummary` is a new required field.
5. **Board error text:** the board shows the full validator message plus "Fix the file and restart the server." (6.3), not the shortened `must start with ...` form.
6. **Inspect:** a free UI read, not an engine action. It never appears in history, share grid or fingerprint (it still lists in the action panel as "Free").
7. **Escalation drain** (`escalateEvery`, default 90 s) is new and makes "time keeps running" bite. Add the log copy `Escalation: still paging after 90 s.` and the polite announcement `Pager 3 of 6 left.`
8. **New storage copy:** "Saved progress could not be read; new results will replace it."
9. **`HOST` env added** (loopback only), mirroring wiki.

### Resolution of ux.md "Assumptions for the builder and tests"
- `PORT` default 3000, loopback, startup lines: **confirmed**, plus `HOST` and singular wording (section 13).
- `SCENARIOS_DIR`, validate at start, keep serving valid ones, `scenarios/index.json` shape, client re-validation, `node --test` fails on invalid shipped files: **confirmed** (6.3, 13, 14).
- Scenario ids equal file names, the regex and the 10 shipped ids: **confirmed** (section 10).
- Action ids: **confirmed** as the catalogue. Inspect free; others cost 1..4 from the scenario (default diag 1, fix 2).
- Node ids and subsets: **confirmed** with a fixed id->type map.
- 1 tick = 1 simulated second, `T+mm:ss`: **confirmed** (2.4).

---

## 18. ADRs

**ADR-1 mulberry32 plus FNV-1a for randomness and hashing.**
- Context: identical results in Node and every browser, serialisable state, no dependencies.
- Decision: mulberry32 with uint32 state in the engine state; seed derived by FNV-1a of `id:seed`.
- Positive: 6 lines, pure, period 2^32, fast, `Math.imul` exact everywhere.
- Negative: not cryptographic and a modest period, both irrelevant here.
- Alternatives: xoshiro128** (more state, no benefit), sfc32 (4 words), `crypto.getRandomValues` (not seedable).

**ADR-2 No transcendental math in the engine.**
- Context: ECMAScript leaves `exp`, `log`, `pow` and `sin` implementation-approximated, which breaks SC5 across browsers.
- Decision: rational queueing approximations (`1/(1-ρ)`), loop powers, a grep test.
- Positive: bit-identical numbers.
- Negative: no exact M/M/1 tail percentile; p99 uses a fixed multiplier (3x), which we document as "explainable, not physics".

**ADR-3 One-tick lag for feedback loops.**
- Context: retries, breakers, pool wait and worker-bound capacity depend on downstream results in the same tick.
- Decision: use previous-tick values; no fixed-point iteration.
- Positive: deterministic, O(nodes + edges) per tick, stable, explainable as "retries react to last second's errors".
- Negative: oscillation is possible with extreme params. Validator ranges plus the invariant property test bound it.

**ADR-4 Engine lives in `public/js/engine` and is imported by Node directly.**
- Positive: one source of truth for the browser, tests and solver; no build.
- Negative: server code imports from `public/` (same as wiki `titles.js`).
- Alternative: a `shared/` dir served separately, which adds a static mount for no gain.

**ADR-5 Optimal path stored in the scenario, verified by the solver in tests.**
- Positive: no runtime search, instant debrief, authors see the path, CI catches drift.
- Negative: the author must re-run `test/tools/solve.js` after tuning (the test tells them the exact values).
- Alternative: on-demand solve in a Worker with a time cap, which is heavier and nondeterministic in time.

**ADR-6 Harm is classified by a 5-tick counterfactual, not by a declared list.**
- Positive: one source of truth (effects plus physics). The ux "made it worse within 5 s" wording becomes testable. Scenarios still control harm through data effects with `if`.
- Negative: two extra 5-tick simulations per action (negligible).
- Alternative: a declared `harmful` list, which can contradict the visible metrics.

**ADR-7 Static-only loopback server with hash routing.**
- Positive: there is no API, so there is no CSRF and no body parsing. The exact-key allow-list kills traversal, and the wiki header set is reused.
- Negative: deep links need the hash. Scenario edits need a restart.

**ADR-8 Bounded runs (escalation drain plus maxTicks).**
- Positive: every run ends, snapshots are bounded, the solver is bounded and time pressure is real.
- Negative: a new rule players must learn. It is announced in the log and live region.

**ADR-9 Attribution follows the source LICENSE.md (CC BY-NC-ND 4.0) over the brief.**
- The licence file is authoritative. ND reinforces the link-only, original-text policy.
- Status: needs human acknowledgement.
