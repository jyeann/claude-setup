// Run engine: createRun, step, canApply and the read helpers. Pure: step never mutates its input.
// The state is plain JSON and carries its (frozen) scenario, so a JSON round trip still steps.
import { next, initial } from './prng.js';
import { fnv1a32 } from './hash.js';
import { ACTION_BY_ID, DEFAULT_COST, PARAMS, EDGE_PARAMS } from './catalogue.js';
import { scenarioHash, chain } from './fingerprint.js';
import {
  metric, q4, METRICS, compileTopology, computeTick, nextBreakers,
} from './model.js';
import { evaluate } from './conditions.js';
import { render, formatInt, hasRand } from './template.js';
import { classifyRun } from './classify.js';

export { metric };

export class EngineError extends Error {
  constructor(message) {
    super(message);
    this.name = 'EngineError';
  }
}

export const THRESHOLDS = Object.freeze({
  saturation: Object.freeze({ warn: 0.7, crit: 0.9 }),
  errorRate: Object.freeze({ warn: 0.01, crit: 0.05 }),
  p99: Object.freeze({ warn: 1000, crit: 2000 }),
  queue: Object.freeze({ warn: 0.5, crit: 0.8 }),
  hitRate: Object.freeze({ warn: 0.8, crit: 0.5 }),
});

export const REVEAL_AFTER = 5;
export const GRACE_TICKS = 10;
export const RECOVER_TICKS = 10;
export const MAX_LOGS = 5000;
export const MAX_TEMPLATE_LINES = 6;
const NEVER = -1000000;

// ---------------------------------------------------------------- compiled scenario (content-addressed cache)
const compiled = new Map();
function compile(state) {
  let c = compiled.get(state.scenarioHash);
  if (c) return c;
  const sc = state.scenario;
  const T = compileTopology(sc);
  const thresholds = { ...THRESHOLDS };
  for (const k of Object.keys(sc.thresholds)) thresholds[k] = sc.thresholds[k];
  const costs = {};
  for (const [id, a] of Object.entries(ACTION_BY_ID)) {
    const fromAction = sc.actions[id] && sc.actions[id].cost;
    const fromDiag = sc.diagnostics[id] && sc.diagnostics[id].cost;
    costs[id] = fromAction ?? fromDiag ?? (a.kind === 'fix' ? DEFAULT_COST.fix : DEFAULT_COST.diagnostic);
  }
  c = {
    sc, T, thresholds, costs,
    sortedIds: [...T.ids].sort(),
    logs: sc.logs.map((l) => ({ ...l, rand: hasRand(l.text) })),
    maxTicks: sc.maxTicks,
    spark: sc.sparks,
  };
  if (compiled.size >= 48) compiled.clear();
  compiled.set(state.scenarioHash, c);
  return c;
}

// ---------------------------------------------------------------- helpers
const workloadAt = (w, tick) => {
  if (tick <= w[0][0]) return w[0][1];
  for (let i = 1; i < w.length; i++) {
    if (tick <= w[i][0]) {
      const [t0, v0] = w[i - 1];
      const [t1, v1] = w[i];
      return v0 + ((v1 - v0) * (tick - t0)) / (t1 - t0);
    }
  }
  return w[w.length - 1][1];
};

function quantised(m) {
  const out = {};
  for (const k of METRICS) {
    const v = m[k];
    if (v === null) out[k] = null;
    else out[k] = k === 'errorRate' || k === 'saturation' || k === 'hitRate' ? q4(v) : Math.round(v);
  }
  return out;
}

// Raw status of one node from quantised metrics (no recovering).
function rawStatus(C, id, m, p) {
  const type = C.T.type[id];
  if (type === 'client') return 'ok';
  const th = C.thresholds;
  const sat = q4(m.saturation);
  const err = q4(m.errorRate);
  const p99 = Math.round(m.p99);
  const cap = type === 'queue' ? p.maxDepth : p.backlogMax;
  const qr = cap > 0 ? Math.round(m.queue) / cap : 0;
  let crit = sat >= th.saturation.crit || err >= th.errorRate.crit || p99 >= th.p99.crit || qr >= th.queue.crit;
  let warn = sat >= th.saturation.warn || err >= th.errorRate.warn || p99 >= th.p99.warn || qr >= th.queue.warn;
  if (type === 'cache') {
    const hr = q4(m.hitRate);
    crit = crit || hr < th.hitRate.crit;
    warn = warn || hr < th.hitRate.warn;
  }
  return crit ? 'crit' : warn ? 'warn' : 'ok';
}

const cloneParams = (src) => {
  const out = {};
  for (const k of Object.keys(src)) out[k] = { ...src[k] };
  return out;
};

// ---------------------------------------------------------------- createRun
export function createRun(scenario, seed, { failAtTick = null } = {}) {
  const s32 = seed >>> 0;
  const sc = scenario;
  const sh = scenarioHash(sc);
  const params = cloneParams(sc.topology.nodes);
  const edgeParams = {};
  for (const e of sc.topology.edges) {
    const { from, to, ...rest } = e;
    edgeParams[`${from}>${to}`] = { ...rest };
  }
  const base = {
    v: 1, scenarioId: sc.id, scenarioHash: sh, seed: s32, scenario: sc, tick: 0, rng: initial(sc.id, s32),
    status: 'running', budgetLeft: sc.budget, graceLeft: 0, onsetTick: null, firstPageTick: null, resolvedTick: null,
    peakError: 0, hash: fnv1a32(''), failAtTick: failAtTick === null || failAtTick === undefined ? null : failAtTick,
    params, edgeParams, ramps: [], breakers: {}, faultsFired: [], alerts: {}, holdRun: 0, logs: [],
    actionLog: [], applied: {}, diag: null, pendingClass: [], hot: {}, leftOk: {}, m0: {}, edgeFlow: {},
    series: { p99: [], errors: [], saturation: [], queue: [], 'cache-hit': [] }, m: {},
  };
  const C = compile(base);
  const zero = {};
  for (const id of C.T.ids) zero[id] = { p50: 0, p99: 0, errorRate: 0, saturation: 0, queue: 0, hitRate: null, rps: 0, missRps: 0, connections: 0 };
  const us = [];
  let rng = base.rng;
  for (let i = 0; i < C.T.clients.length; i++) { const [r, u] = next(rng); rng = r; us.push(u); }
  const { m, flow } = computeTick(C.T, params, edgeParams, zero, {}, workloadAt(sc.workload, 0), us);
  const state = { ...base, rng, m, edgeFlow: flow };
  for (const a of sc.alerts) state.alerts[a.id] = { firing: false, run: 0, clearRun: 0, since: null, clearedAt: null };
  for (const id of C.T.ids) {
    state.hot[id] = NEVER;
    state.leftOk[id] = null;
    const q = quantised(m[id]);
    state.m0[id] = { p99: q.p99, errorRate: q.errorRate, saturation: q.saturation };
  }
  state.series = appendSeries(C, state.series, m);
  return state;
}

function appendSeries(C, series, m) {
  const sp = C.spark;
  const grow = (arr, node, name) => {
    const out = arr.slice();
    out.push(node === null ? null : metric({ m }, node, name));
    return out;
  };
  return {
    p99: grow(series.p99, sp.p99, 'p99'),
    errors: grow(series.errors, sp.errors, 'errorRate'),
    saturation: grow(series.saturation, sp.saturation, 'saturation'),
    queue: grow(series.queue, sp.queue, 'queue'),
    'cache-hit': grow(series['cache-hit'], sp['cache-hit'], 'hitRate'),
  };
}

// ---------------------------------------------------------------- canApply
function canApplyC(C, st, id, node) {
  const act = ACTION_BY_ID[id];
  if (!act) return { ok: false, reason: 'Unknown action.' };
  if (st.status !== 'running') return { ok: false, reason: 'The incident is over.' };
  if (id === 'inspect') return { ok: true, target: node || null, free: true };
  const cost = C.costs[id];
  if (cost > 0 && st.budgetLeft === 0) return { ok: false, reason: 'Out of pager budget.' };
  if (cost > st.budgetLeft) return { ok: false, reason: `Not enough pager. It costs ${cost} and you have ${st.budgetLeft}.` };
  if (act.kind === 'diagnostic') return { ok: true, target: null };
  const type = C.T.type;
  let target = null;
  if (node !== null && node !== undefined) {
    if (Object.hasOwn(type, node) && act.appliesTo.includes(type[node])) target = node;
  } else {
    const cands = C.T.ids.filter((n) => act.appliesTo.includes(type[n]));
    if (cands.length === 1) target = cands[0];
  }
  if (target === null) return { ok: false, reason: `Works on a ${act.appliesTo.join(' or ')}. Select one first.` };
  if (act.once && st.applied[`${id}@${target}`]) return { ok: false, reason: 'Already on.' };
  return { ok: true, target };
}

export function canApply(state, id, node) {
  return canApplyC(compile(state), state, id, node);
}

// ---------------------------------------------------------------- effects
const pathCache = new Map();
function parsePath(path) {
  let p = pathCache.get(path);
  if (!p) {
    const dot = path.lastIndexOf('.');
    const target = path.slice(0, dot);
    p = { edge: target.startsWith('edge:'), key: target.slice(target.indexOf(':') + 1), name: path.slice(dot + 1) };
    pathCache.set(path, p);
  }
  return p;
}

// A mutable draft over the pieces of state that effects touch. Containers are copied the first time they are written.
class Draft {
  constructor(state) {
    this.s = { ...state };
    this.copiedParams = false;
    this.copiedEdges = false;
  }

  holder(p) {
    const s = this.s;
    if (p.edge) {
      if (!this.copiedEdges) { s.edgeParams = cloneParams(s.edgeParams); this.copiedEdges = true; }
      return s.edgeParams[p.key];
    }
    if (!this.copiedParams) { s.params = cloneParams(s.params); this.copiedParams = true; }
    return s.params[p.key];
  }
}

function specOf(C, p) {
  if (p.edge) return EDGE_PARAMS[p.name];
  return PARAMS[C.T.type[p.key]][p.name];
}

function clampTo(spec, v) {
  if (spec.bool) return v;
  let x = Math.min(spec.max, Math.max(spec.min, v));
  if (spec.int) x = Math.round(x);
  return x;
}

function applyEffects(C, dr, effects, tickNow) {
  for (const eff of effects) {
    if (eff.if !== undefined && !evaluate(eff.if, dr.s)) continue;
    const p = parsePath(eff.path);
    const spec = specOf(C, p);
    const h = dr.holder(p);
    const cur = h[p.name];
    let v;
    if (eff.op === 'set') v = eff.value;
    else if (eff.op === 'add') v = cur + eff.value;
    else v = cur * eff.value;
    v = clampTo(spec, v);
    dr.s.ramps = dr.s.ramps.filter((r) => r.path !== eff.path);
    if (eff.ramp !== undefined && !spec.bool) dr.s.ramps = [...dr.s.ramps, { path: eff.path, start: cur, target: v, t: tickNow, r: eff.ramp }];
    else h[p.name] = v;
  }
}

function advanceRamps(dr, newTick) {
  if (dr.s.ramps.length === 0) return;
  const keep = [];
  for (const r of dr.s.ramps) {
    const p = parsePath(r.path);
    const h = dr.holder(p);
    const j = newTick - r.t;
    if (j >= r.r) h[p.name] = r.target;
    else { h[p.name] = r.start + ((r.target - r.start) * j) / r.r; keep.push(r); }
  }
  dr.s.ramps = keep;
}

// ---------------------------------------------------------------- diagnostics
const clock = (t) => {
  const a = Math.abs(t);
  return `T${t < 0 ? '-' : '+'}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
};

function traceLines(C, st) {
  const lines = [];
  let node = C.T.clients[0];
  const seen = new Set();
  while (node && !seen.has(node)) {
    seen.add(node);
    const p50 = metric(st, node, 'p50');
    let best = null;
    let bestScore = 0;
    let sub = 0;
    for (const e of C.T.outE[node]) {
      if (e.repl || e.async) continue;
      const ep = st.edgeParams[e.key];
      const b = st.breakers[e.key];
      const open = ep.breaker && b && b.state === 'open' ? 0 : 1;
      const miss = ep.missOnly ? 1 - (st.params[node].hitRate ?? 0) : 1;
      const w = ep.calls * ep.share * miss * open;
      const score = w * metric(st, e.to, 'p50');
      sub += score;
      if (score > bestScore) { bestScore = score; best = e.to; }
    }
    if (C.T.type[node] !== 'client') lines.push(`${lines.length ? '-> ' : ''}${node} ${formatInt(Math.max(0, p50 - Math.round(sub)))} ms`);
    node = best;
  }
  return lines;
}

function buildDiag(C, st, id) {
  const lines = [];
  if (id === 'trace-request') {
    lines.push(...traceLines(C, st));
  } else if (id === 'tail-logs') {
    for (const l of st.logs) if (l.t > st.tick - 30) lines.push(`${clock(l.t)} ${l.node === null ? '-' : l.node} ${l.level}: ${l.text}`);
    if (lines.length === 0) lines.push('No log lines in the last 30 seconds.');
  } else if (id === 'compare-dashboards') {
    for (const n of C.T.ids) {
      const now = quantised(st.m[n]);
      const was = st.m0[n];
      lines.push(`${n}: p99 ${formatInt(now.p99)} ms (was ${formatInt(was.p99)}), errors ${(now.errorRate * 100).toFixed(1)}% (was ${(was.errorRate * 100).toFixed(1)}%), saturation ${(now.saturation * 100).toFixed(1)}% (was ${(was.saturation * 100).toFixed(1)}%)`);
    }
  } else if (id === 'deploy-history') {
    const ds = st.scenario.deploys.filter((d) => d.tick <= st.tick).sort((a, b) => b.tick - a.tick);
    for (const d of ds) lines.push(`${clock(d.tick)} ${d.node} ${d.text}`);
    if (lines.length === 0) lines.push('No recent deploys.');
  }
  const extra = st.scenario.diagnostics[id];
  if (extra && extra.lines) for (const t of extra.lines) lines.push(render(t, st, 0.5));
  return { id, t: st.tick, lines };
}

// ---------------------------------------------------------------- step
export function step(state, actions) {
  return stepImpl(state, actions, false);
}

// Same physics, alerts, budget and resolution as step, but it skips what only the UI reads: log lines, diagnostics, series,
// the hash chain, statuses and effect classification. Used by classify and the solver, where only metrics and outcome matter.
// The result is a judging state: do not display it. Randomness is still drawn exactly as step draws it.
export function stepRaw(state, actions) {
  return stepImpl(state, actions, true);
}

function stepImpl(state, actions, lite) {
  const doClassify = !lite;
  if (state.status !== 'running') return state;
  const C = compile(state);
  const k = state.tick;
  const nk = k + 1;
  if (state.failAtTick === nk) throw new EngineError('deliberate failure');
  const dr = new Draft(state);
  const d = dr.s;
  const newLines = [];
  const legal = [];
  const pending = [];
  const addLine = (node, level, kind, text) => { if (!lite) newLines.push({ t: nk, node, level, kind, text }); };

  // 1. Actions, in order. Illegal ones, inspect and unknown ids are dropped silently.
  if (Array.isArray(actions)) {
    let prevB = null;
    for (const a of actions) {
      if (!a || typeof a.id !== 'string' || a.id === 'inspect') continue;
      const r = canApplyC(C, d, a.id, a.node);
      if (!r.ok) continue;
      const act = ACTION_BY_ID[a.id];
      d.budgetLeft -= C.costs[a.id];
      if (d.actionLog === state.actionLog) d.actionLog = state.actionLog.slice();
      d.actionLog.push({ t: k, id: a.id, node: r.target });
      if (act.kind === 'diagnostic') {
        if (!lite) d.diag = buildDiag(C, d, a.id);
        addLine(null, 'info', 'action', `Ran: ${act.name}`);
        if (doClassify) pending.push({ t: k, id: a.id, node: r.target, revealAt: k + REVEAL_AFTER, effect: 'diagnostic' });
      } else {
        if (d.applied === state.applied) d.applied = { ...state.applied };
        d.applied[`${a.id}@${r.target}`] = true;
        const eff = d.scenario.actions[a.id] && d.scenario.actions[a.id].effects && d.scenario.actions[a.id].effects[r.target];
        if (eff) applyEffects(C, dr, eff, k);
        addLine(r.target, 'info', 'action', `Applied: ${act.name}`);
        if (doClassify) {
          const withIt = [...legal, { id: a.id, node: r.target }];
          const res = classifyRun(state, withIt, legal, prevB);
          prevB = res.a;
          pending.push({ t: k, id: a.id, node: r.target, revealAt: k + REVEAL_AFTER, effect: res.effect });
        }
      }
      legal.push({ id: a.id, node: r.target });
    }
  }

  // 2. Faults.
  for (const f of d.scenario.faults) {
    if (d.faultsFired.includes(f.id)) continue;
    const t = f.trigger;
    const fire = Object.hasOwn(t, 'atTick') ? t.atTick === k : evaluate(t.when, d);
    if (!fire) continue;
    d.faultsFired = [...d.faultsFired, f.id];
    if (d.onsetTick === null) d.onsetTick = k;
    applyEffects(C, dr, f.effects, k);
  }

  // 3. Ramps advance to the new tick.
  advanceRamps(dr, nk);

  // 4. Physics for tick k + 1 (one draw per client first).
  let rng = d.rng;
  const us = [];
  for (let i = 0; i < C.T.clients.length; i++) { const [r, u] = next(rng); rng = r; us.push(u); }
  const { m, flow } = computeTick(C.T, d.params, d.edgeParams, state.m, state.breakers, workloadAt(d.scenario.workload, nk), us);
  d.breakers = nextBreakers(C.T, d.params, d.edgeParams, state.breakers, m);
  d.m = m;
  d.edgeFlow = flow;
  d.tick = nk;

  // 5. Statuses and the time each node left ok.
  if (!lite) {
    const hot = { ...state.hot };
    const leftOk = { ...state.leftOk };
    for (const id of C.T.ids) {
      const raw = rawStatus(C, id, m[id], d.params[id]);
      if (raw !== 'ok') hot[id] = nk;
      const nonOk = raw !== 'ok' || nk - hot[id] <= RECOVER_TICKS;
      if (nonOk) { if (leftOk[id] === null) leftOk[id] = nk; } else leftOk[id] = null;
    }
    d.hot = hot;
    d.leftOk = leftOk;
  }

  // 6. Alerts and resolution.
  const alerts = {};
  let anyFiring = false;
  for (const rule of d.scenario.alerts) {
    const was = state.alerts[rule.id];
    const a = { ...was };
    if (evaluate(rule.when, d)) {
      a.run = was.run + 1;
      a.clearRun = 0;
      if (!was.firing && a.run >= rule.forTicks) {
        a.firing = true;
        a.since = nk;
        if (rule.severity <= 2 && d.firstPageTick === null) d.firstPageTick = nk;
      }
    } else {
      a.run = 0;
      if (was.firing) {
        a.clearRun = was.clearRun + 1;
        if (a.clearRun >= 3) { a.firing = false; a.clearRun = 0; a.clearedAt = nk; }
      }
    }
    if (a.firing) anyFiring = true;
    alerts[rule.id] = a;
  }
  d.alerts = alerts;
  let requireOk = true;
  for (const c of d.scenario.resolve.require) if (!evaluate(c, d)) { requireOk = false; break; }
  d.holdRun = d.firstPageTick !== null && !anyFiring && requireOk ? state.holdRun + 1 : 0;
  const resolved = d.holdRun >= d.scenario.holdTicks;

  // 7. Escalation (never takes the last lamp: the run then ends by maxTicks).
  const es = d.scenario.escalateEvery;
  if (!resolved && es > 0 && d.firstPageTick !== null && nk > d.firstPageTick && (nk - d.firstPageTick) % es === 0 && d.budgetLeft > 1) {
    d.budgetLeft -= 1;
    addLine(null, 'warn', 'log', `Escalation: still paging after ${es} s.`);
  }

  // 8. Template log lines (a draw for every {rand} template whose condition holds; at most 6 lines kept).
  let kept = 0;
  for (const tpl of C.logs) {
    const from = tpl.from === undefined ? 0 : tpl.from;
    if (nk < from || (nk - from) % tpl.every !== 0) continue;
    if (tpl.when !== undefined && !evaluate(tpl.when, d)) continue;
    let u = 0;
    if (tpl.rand) { const [r, x] = next(rng); rng = r; u = x; }
    if (kept < MAX_TEMPLATE_LINES) { kept++; if (!lite) addLine(tpl.node, tpl.level, 'log', render(tpl.text, d, u)); }
  }
  d.rng = rng;

  // 9. Status, budget and grace.
  if (resolved) {
    d.status = 'resolved';
    d.resolvedTick = nk;
  } else {
    if (nk >= C.maxTicks && d.budgetLeft > 0) d.budgetLeft = 0;
    if (d.budgetLeft === 0) {
      d.graceLeft = state.graceLeft > 0 ? state.graceLeft - 1 : GRACE_TICKS;
      if (d.graceLeft === 0) d.status = 'out-of-budget';
    }
  }

  // 10. Bookkeeping: peak error, series, logs, hash chain.
  const errNode = d.scenario.sparks.errors;
  let peak = d.peakError;
  if (errNode !== null) peak = Math.max(peak, metric(d, errNode, 'errorRate'));
  else for (const id of C.T.ids) if (C.T.type[id] !== 'client') peak = Math.max(peak, metric(d, id, 'errorRate'));
  d.peakError = peak;
  if (!lite) d.series = appendSeries(C, state.series, m);
  if (newLines.length) {
    const all = state.logs.concat(newLines);
    d.logs = all.length > MAX_LOGS ? all.slice(all.length - MAX_LOGS) : all;
  }
  if (pending.length) d.pendingClass = state.pendingClass.concat(pending);
  if (!lite) d.hash = chain(state.hash, tickLine(C, d, newLines));

  checkInvariants(C, d);
  return d;
}

function tickLine(C, st, lines) {
  let s = '';
  for (const id of C.sortedIds) {
    const q = quantised(st.m[id]);
    s += `${id}:${q.p50},${q.p99},${q.errorRate},${q.saturation},${q.queue},${q.hitRate},${q.rps},${q.missRps},${q.connections};`;
  }
  for (const l of lines) s += `\n${l.kind}|${l.level}|${l.node}|${l.text}`;
  return s;
}

function checkInvariants(C, st) {
  for (const id of C.T.ids) {
    const m = st.m[id];
    for (const k of METRICS) {
      const v = m[k];
      if (k === 'hitRate' && v === null) continue;
      if (typeof v !== 'number' || !Number.isFinite(v)) throw new EngineError(`invariant: finite ${k} on ${id}`);
    }
    if (m.errorRate < 0 || m.errorRate > 1) throw new EngineError(`invariant: errorRate on ${id}`);
    if (m.saturation < 0 || m.saturation > 1) throw new EngineError(`invariant: saturation on ${id}`);
    if (m.hitRate !== null && (m.hitRate < 0 || m.hitRate > 1)) throw new EngineError(`invariant: hitRate on ${id}`);
    if (!(m.p50 >= 0 && m.p50 <= m.p99 && m.p99 <= 30000)) throw new EngineError(`invariant: latency on ${id}`);
    const p = st.params[id];
    const cap = p.maxDepth !== undefined ? p.maxDepth : p.backlogMax;
    if (cap !== undefined && !(m.queue >= 0 && m.queue <= cap)) throw new EngineError(`invariant: queue on ${id}`);
  }
  if (!Number.isInteger(st.budgetLeft) || st.budgetLeft < 0 || st.budgetLeft > st.scenario.budget) throw new EngineError('invariant: budgetLeft on run');
  if (st.tick > C.maxTicks + GRACE_TICKS) throw new EngineError('invariant: tick on run');
}

// ---------------------------------------------------------------- reads
export function statusOf(state, nodeId) {
  const C = compile(state);
  const m = state.m[nodeId];
  if (!m) return 'ok';
  const raw = rawStatus(C, nodeId, m, state.params[nodeId]);
  if (raw !== 'ok') return raw;
  return C.T.type[nodeId] !== 'client' && state.tick - state.hot[nodeId] <= RECOVER_TICKS ? 'recovering' : 'ok';
}

export function edgeRps(state, from, to) {
  const v = state.edgeFlow[`${from}>${to}`];
  return v === undefined ? 0 : Math.round(v);
}

export function firingAlerts(state) {
  const out = [];
  state.scenario.alerts.forEach((rule, i) => {
    const a = state.alerts[rule.id];
    if (a && a.firing) out.push({ id: rule.id, severity: rule.severity, text: rule.text, since: a.since, order: i });
  });
  out.sort((x, y) => x.severity - y.severity || x.order - y.order);
  return out.map(({ order, ...rest }) => rest);
}

export function firstNonOk(state) {
  const C = compile(state);
  let best = null;
  let bestTick = Infinity;
  for (const id of C.T.ids) {
    const t = state.leftOk[id];
    if (t !== null && t < bestTick) { best = id; bestTick = t; }
  }
  return best;
}

export function result(state) {
  const harmful = state.pendingClass.filter((p) => p.effect === 'harmful' && (state.tick >= p.revealAt || state.status !== 'running')).length;
  return {
    result: state.status,
    timeToMitigate: state.status === 'resolved' ? state.resolvedTick : null,
    budgetLeft: state.budgetLeft,
    harmful,
    peakError: state.peakError,
    onsetTick: state.onsetTick,
    firstPageTick: state.firstPageTick,
    resolvedTick: state.resolvedTick,
  };
}
