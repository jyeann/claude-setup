// Engine state -> display data for the system map. Pure (no DOM, no clock); lives beside the map files so they share one source.
// Node data-* values and aria names come from core/viewmodel.js; this file adds the edge model and the node display strings.
import { createRun, edgeRps } from '../engine/engine.js';
import { nodeVm, dotRateOf, queueRatio, thresholdsOf, nodeLabel, STATUS_LABEL } from '../core/viewmodel.js';
import { percentNumber } from '../core/format.js';

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

// 1842 -> "1.8k", 820 -> "820", 12500 -> "13k", 2400000 -> "2.4M"
export function compact(n) {
  const v = Number.isFinite(n) ? Math.max(0, n) : 0;
  if (v < 1000) return String(Math.round(v));
  if (v < 9950) return `${Math.round(v / 100) / 10}k`;
  if (v < 999500) return `${Math.round(v / 1000)}k`;
  return `${Math.round(v / 100000) / 10}M`;
}

export const rateText = (rps) => `${compact(rps)} rps`;
export const edgeKey = (from, to) => `${from}>${to}`;

// Healthy flow per edge at tick 0 (the baseline of the density mapping).
export function edgeBaselines(scenario, state) {
  const run0 = state && state.tick === 0 ? state : createRun(scenario, state ? state.seed : scenario.seed);
  const out = {};
  for (const e of scenario.topology.edges) out[edgeKey(e.from, e.to)] = edgeRps(run0, e.from, e.to);
  return out;
}

// Crit nodes and everything downstream of them.
export function downstreamOfCrit(scenario, statuses) {
  const out = new Set();
  const stack = Object.keys(statuses).filter((id) => statuses[id] === 'crit');
  while (stack.length) {
    const id = stack.pop();
    if (out.has(id)) continue;
    out.add(id);
    for (const e of scenario.topology.edges) if (e.from === id) stack.push(e.to);
  }
  return out;
}

export function nodeView(state, scenario, id, { reduced = false } = {}) {
  const vm = nodeVm(state, scenario, id);
  const qr = queueRatio(state, id);
  const type = kindOf(id);
  let metricText;
  if (type === 'client') metricText = `${compact(vm.rps)}/s`;
  else if (type === 'cache' && vm.hitRate !== null) metricText = `hit ${Math.round(vm.hitRate * 100)}%`;
  else if (type === 'queue') metricText = `Q ${compact(vm.queue)}`;
  else if (reduced && vm.queue > 0) metricText = `Q ${compact(vm.queue)}`;
  else metricText = `${Math.round(vm.saturation * 100)}%`;
  return {
    ...vm,
    type,
    queueRatio: qr,
    name: nodeLabel(scenario, id),
    statusLabel: STATUS_LABEL[vm.status],
    metricText,
    bar: clamp(Math.max(vm.saturation, type === 'queue' ? qr : 0, reduced ? qr : 0), 0, 1),
  };
}

const TYPE_OF = {
  clients: 'client', lb: 'lb', 'service-1': 'service', 'service-2': 'service', 'service-3': 'service', cache: 'cache', 'db-primary': 'db',
  'db-replica': 'db', queue: 'queue', consumer: 'consumer', 'third-party': 'third-party',
};
const kindOf = (id) => TYPE_OF[id] || 'service';

function capacityOf(state, id) {
  const p = state.params[id];
  if (!p || !(p.capacity > 0)) return 0;
  return p.capacity * (p.instances || 1) * (p.capFactor === undefined ? 1 : p.capFactor);
}

// One edge: engine flow in, display state and particle inputs out.
export function edgeView(state, scenario, edge, baseline, target, dim, { reduced = false } = {}) {
  const key = edgeKey(edge.from, edge.to);
  const rps = edgeRps(state, edge.from, edge.to);
  const th = thresholdsOf(scenario);
  const errCrit = th.errorRate ? th.errorRate.crit : 0.05;
  const breaker = state.breakers && state.breakers[key];
  const cut = !!breaker && breaker.state === 'open';
  const err = target.errorRate;
  const failing = !cut && err >= errCrit;
  const cap = capacityOf(state, edge.to);
  const util = cap > 0 ? rps / cap : 0;
  const ep = state.edgeParams[key] || {};
  const retries = ep.retries || 0;
  const dotRate = cut ? 0 : dotRateOf(rps, baseline);
  const st = cut ? 'cut' : failing ? 'failing' : util > 0.8 ? 'loaded' : 'normal';
  let text = rateText(rps);
  let short = compact(rps);
  if (reduced && failing) { const e = `err ${Math.round(err * 100)}%`; text = `${text} ${e}`; short = `${short} ${e}`; }
  return {
    key,
    from: edge.from,
    to: edge.to,
    rps,
    dotRate,
    state: st,
    load: util > 0.8 ? 'high' : util >= 0.4 ? 'mid' : 'low',
    dim,
    cut,
    text,
    short,
    errFrac: err >= 0.005 ? clamp(err, 0, 1) : 0,
    retryFrac: retries > 0 && err > 0.01 ? clamp(err * 2, 0, 0.7) : 0,
    attrs: {
      'data-from': edge.from,
      'data-to': edge.to,
      'data-state': st,
      'data-rps': String(rps),
      'data-dot-rate': String(Math.round(dotRate * 10) / 10),
    },
  };
}

export function buildMapView(scenario, state, baselines, opts = {}) {
  const nodes = {};
  const statuses = {};
  for (const id of Object.keys(scenario.topology.nodes)) {
    nodes[id] = nodeView(state, scenario, id, opts);
    statuses[id] = nodes[id].status;
  }
  const dimmed = downstreamOfCrit(scenario, statuses);
  const edges = {};
  for (const e of scenario.topology.edges) {
    const key = edgeKey(e.from, e.to);
    edges[key] = edgeView(state, scenario, e, baselines[key] || 0, nodes[e.to], dimmed.has(e.from), opts);
  }
  return { tick: state.tick, nodes, edges };
}

// Percent with one decimal for data attributes where the view model has no helper.
export const pct1 = percentNumber;
