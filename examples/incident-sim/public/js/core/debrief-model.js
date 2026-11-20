// Debrief data: replays the saved run and the optimal path from the same seed, and derives everything the flight recorder shows.
// Pure: no DOM, no clock. Scrubbing reads the snapshots, so it is instant.
import { replay } from '../engine/replay.js';
import { result as engineResult } from '../engine/engine.js';
import { historyEffects } from '../engine/classify.js';
import { score as scoreFn } from '../engine/score.js';
import { firstPageTick, schedule } from '../engine/solver.js';
import { ACTIONS } from '../engine/catalogue.js';
import { nodeLabel } from './viewmodel.js';
import { clock, mmss, int } from './format.js';

export const ACTION_NAME = Object.freeze(Object.fromEntries(ACTIONS.map((a) => [a.id, a.name])));
const PAST = {
  'trace-request': () => 'traced a request',
  'tail-logs': () => 'tailed the logs',
  'compare-dashboards': () => 'compared the dashboards',
  'deploy-history': () => 'read the deploy history',
  'scale-service': (n) => `scaled ${n}`,
  'add-ttl-jitter': (n) => `added TTL jitter to ${n}`,
  'circuit-breaker': (n) => `put a circuit breaker on ${n}`,
  'backoff-jitter': (n) => `added backoff with jitter to ${n}`,
  'shed-load': (n) => `shed load at ${n}`,
  failover: (n) => `failed over ${n}`,
  'shard-rekey': (n) => `rekeyed the shards on ${n}`,
  'add-index': (n) => `added an index on ${n}`,
  rollback: (n) => `rolled back ${n}`,
  'raise-pool-size': (n) => `raised the pool size on ${n}`,
  'renew-cert': (n) => `renewed the certificate on ${n}`,
};
export const KIND_OF_EFFECT = Object.freeze({ diagnostic: 'D', helpful: 'F', harmful: 'x', none: '.' });
const RANK = { ok: 0, recovering: 1, warn: 2, crit: 3 };
const SPARK_LABEL = { p99: 'p99', errors: 'errors', saturation: 'saturation', queue: 'queue', 'cache-hit': 'hit rate' };
const SPARK_KEY = { p99: 'p99', errors: 'errorRate', saturation: 'saturation', queue: 'queue', 'cache-hit': 'hitRate' };

export const actionName = (id) => ACTION_NAME[id] || id;
export function pastTense(scenario, a) {
  const f = PAST[a.id];
  return f ? f(a.node ? nodeLabel(scenario, a.node) : 'the system') : `ran ${actionName(a.id)}`;
}

function fmtSpark(key, v) {
  if (v === null || v === undefined) return '-';
  if (key === 'p99') return `${int(v)} ms`;
  if (key === 'queue') return int(v);
  return `${Math.round(v * 100)}%`;
}

// Biggest relative move among the five key signals between tick t and t+5.
export function biggestMove(scenario, snaps, t) {
  const a = snaps[Math.min(t, snaps.length - 1)];
  const b = snaps[Math.min(t + 5, snaps.length - 1)];
  if (!a || !b) return null;
  let best = null;
  for (const [spark, node] of Object.entries(scenario.sparks)) {
    if (!node || !a.m[node] || !b.m[node]) continue;
    const key = SPARK_KEY[spark];
    const x = a.m[node][key];
    const y = b.m[node][key];
    if (x === null || y === null || x === undefined || y === undefined) continue;
    const scale = spark === 'p99' ? 3000 : spark === 'queue' ? Math.max(1, x, y) : 1;
    const delta = Math.abs(y - x) / scale;
    if (!best || delta > best.delta + 1e-9) best = { spark, node, from: x, to: y, delta };
  }
  if (!best || best.delta < 0.005) return null;
  return `${nodeLabel(scenario, best.node)} ${SPARK_LABEL[best.spark]} ${fmtSpark(best.spark, best.from)} to ${fmtSpark(best.spark, best.to)}`;
}

function lane(scenario, seed, log) {
  const rp = replay(scenario, seed, log);
  const final = rp.final;
  const he = historyEffects(final);
  const marks = he.map((h, i) => ({
    index: i, t: h.t, id: h.id, node: h.node, name: actionName(h.id), effect: h.effect || 'none', kind: KIND_OF_EFFECT[h.effect || 'none'],
    phrase: pastTense(scenario, h),
  }));
  return { snaps: rp.snapshots, final, res: engineResult(final), marks, dropped: rp.dropped };
}

const p99Of = (scenario, snaps) => {
  const node = scenario.sparks.p99;
  return snaps.map((s) => (node && s.m[node] ? s.m[node].p99 : 0));
};
const worstOf = (snap) => {
  let w = 'ok';
  for (const st of Object.values(snap.statuses)) if (RANK[st] > RANK[w]) w = st;
  return w;
};

// run: {seed, actions:[{t,id,node}], result:'resolved'|'out-of-budget', score:number, timeToMitigate?, budgetLeft?, scenarioHash?, hintUsed?}
export function buildDebrief({ scenario, run, daily = null }) {
  const you = lane(scenario, run.seed, run.actions);
  const fp = firstPageTick(scenario, run.seed);
  const optLog = schedule(fp, scenario.optimalPath);
  const opt = lane(scenario, run.seed, optLog);
  const hintUsed = !!run.hintUsed;
  const r = you.res;
  const sc = scoreFn({
    result: r.result, timeToMitigate: r.timeToMitigate, optimalTime: scenario.optimalSummary.timeToMitigate, budgetLeft: r.budgetLeft,
    budget: scenario.budget, optimalCost: scenario.optimalSummary.cost, harmful: r.harmful, hintUsed,
  });
  // The saved run must replay to the same outcome; otherwise the scenario file changed since it was played.
  let unavailable = null;
  if (run.scenarioHash && run.scenarioHash !== you.final.scenarioHash) unavailable = 'hash';
  else if (you.dropped > 0) unavailable = 'dropped';
  else if (run.result && run.result !== r.result) unavailable = 'result';
  else if (run.timeToMitigate !== undefined && run.timeToMitigate !== r.timeToMitigate) unavailable = 'time';
  else if (run.budgetLeft !== undefined && run.budgetLeft !== r.budgetLeft) unavailable = 'budget';
  else if (typeof run.score === 'number' && run.score !== sc.score) unavailable = 'score';
  const end = Math.max(you.snaps.length, opt.snaps.length) - 1;
  const model = {
    scenario, run, daily, you, opt, fp, end,
    result: r.result,
    resolved: r.result === 'resolved',
    score: typeof run.score === 'number' ? run.score : sc.score,
    tier: sc.tier,
    parts: sc.parts,
    optimalTime: opt.res.timeToMitigate,
    timeToMitigate: r.timeToMitigate,
    budget: scenario.budget,
    budgetLeft: r.budgetLeft,
    harmful: r.harmful,
    peakError: r.peakError,
    onsetTick: r.onsetTick,
    hintUsed,
    unavailable,
    p99You: p99Of(scenario, you.snaps),
    p99Opt: p99Of(scenario, opt.snaps),
    ribbon: you.snaps.map(worstOf),
  };
  model.letters = you.marks.map((m) => m.kind);
  model.steps = buildSteps(scenario, you, opt);
  model.divergence = divergence(you.marks, opt.marks);
  return model;
}

function buildSteps(scenario, you, opt) {
  const rows = [];
  const n = Math.max(you.marks.length, opt.marks.length);
  for (let i = 0; i < n; i++) {
    const y = you.marks[i] || null;
    const o = opt.marks[i] || null;
    rows.push({ index: i, lane: y ? 'you' : 'optimal', you: y, optimal: o, effect: y ? y.effect : o.effect, harmful: !!y && y.effect === 'harmful', why: y && y.effect === 'harmful' ? (scenario.harmfulWhy || {})[y.id] || null : null });
  }
  return rows;
}

// First index where your lane stops matching the optimal one (by action id and node).
export function divergence(youMarks, optMarks) {
  const fix = (m) => m.filter((x) => x.effect !== 'diagnostic');
  const a = fix(youMarks);
  const b = fix(optMarks);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (!a[i] || !b[i] || a[i].id !== b[i].id || a[i].node !== b[i].node) return { you: a[i] || null, optimal: b[i] || null };
  }
  return null;
}

export function worstNode(scenario, snap) {
  let best = null;
  for (const id of Object.keys(snap.statuses)) if (RANK[snap.statuses[id]] >= 2 && (!best || RANK[snap.statuses[id]] > RANK[snap.statuses[best]])) best = id;
  return best;
}

// Narration under the replay map for second t.
export function narrate(model, t) {
  const { scenario, you } = model;
  const tt = Math.max(0, Math.min(t, you.snaps.length - 1));
  const snap = you.snaps[tt];
  const head = `${clock(tt)}.`;
  const at = you.marks.filter((m) => m.t === tt);
  if (at.length) {
    const m = at[at.length - 1];
    const move = biggestMove(scenario, you.snaps, tt);
    return { text: `${head} You ${m.phrase}.${move ? ` ${move}.` : ''}`, harmful: m.effect === 'harmful', mark: m };
  }
  const prev = you.marks.filter((m) => m.t < tt).pop();
  const w = worstNode(scenario, snap);
  const done = model.resolved && model.timeToMitigate !== null && tt >= model.timeToMitigate;
  const state = done ? 'Mitigated. The pager goes quiet.' : w ? `${nodeLabel(scenario, w)} is ${snap.statuses[w] === 'crit' ? 'CRIT' : 'WARN'}.` : model.onsetTick !== null && tt <= model.onsetTick ? 'All quiet.' : 'Every node is back under its limits.';
  if (prev) return { text: `${head} ${state} Last step: you ${prev.phrase} at ${clock(prev.t)}.`, harmful: false, mark: null };
  return { text: `${head} ${state} No action taken yet.`, harmful: false, mark: null };
}

export function ribbonLabel(model) {
  const runs = [];
  let from = 0;
  const r = model.ribbon;
  for (let i = 1; i <= r.length; i++) {
    if (i === r.length || r[i] !== r[from]) { runs.push(`${r[from]} ${mmss(from)} to ${mmss(i - 1)}`); from = i; }
  }
  return `Status by second: ${runs.join(', ')}`;
}
