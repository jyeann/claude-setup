// View model: engine state in, plain display data out. Every data-* value and aria name of ux.md is made here, so the DOM glue
// only copies strings. Pure: no DOM, no clock, no storage. Values are strings where they land in attributes.
import {
  metric, statusOf, firingAlerts, result, canApply, THRESHOLDS,
} from '../engine/engine.js';
import { historyEffects } from '../engine/classify.js';
import { stateHash } from '../engine/fingerprint.js';
import { ACTIONS, DEFAULT_COST } from '../engine/catalogue.js';
import {
  clock, mmss, int, percent, percentNumber,
} from './format.js';

export const DEFAULT_LABELS = Object.freeze({
  clients: 'Clients', lb: 'Load balancer', 'service-1': 'Service 1', 'service-2': 'Service 2', 'service-3': 'Service 3', cache: 'Cache',
  'db-primary': 'DB primary', 'db-replica': 'DB replica', queue: 'Queue', consumer: 'Consumer', 'third-party': 'Partner API',
});
export const STATUS_LABEL = Object.freeze({ ok: 'OK', warn: 'WARN', crit: 'CRIT', recovering: 'RECV' });
export const STATUS_ICON = Object.freeze({ ok: '#ic-ok', warn: '#ic-warn', crit: '#ic-crit', recovering: '#ic-recv' });
export const TITLE_PREFIX = Object.freeze({ ok: 'OK', warn: 'WARN', crit: 'CRIT', recovering: 'RECV' });
const RANK = { ok: 0, recovering: 1, warn: 2, crit: 3 };

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

export const nodeLabel = (scenario, id) => (scenario.labels && scenario.labels[id]) || DEFAULT_LABELS[id] || id;

// pile of waiting dots at a node: min(24, round(24 * max(clamp((saturation - 0.7) / 0.3, 0, 1), queueRatio)))
export function pileOf(saturation, queueRatio) {
  const s = clamp((saturation - 0.7) / 0.3, 0, 1);
  return Math.min(24, Math.round(24 * Math.max(s, queueRatio)));
}

// dots per second on an edge, relative to that edge's own healthy load
export function dotRateOf(rps, baselineRps) {
  if (!(baselineRps > 0)) return 8;
  return clamp((rps / baselineRps) * 8, 0.5, 40);
}

export function queueRatio(state, id) {
  const p = state.params[id] || {};
  const cap = p.maxDepth !== undefined ? p.maxDepth : p.backlogMax;
  return cap > 0 ? clamp((metric(state, id, 'queue') || 0) / cap, 0, 1) : 0;
}

export function thresholdsOf(scenario) {
  return { ...THRESHOLDS, ...(scenario.thresholds || {}) };
}

export function nodeAriaName(vm) {
  return `${vm.label}. ${STATUS_LABEL[vm.status]}. Saturation ${Math.round(vm.saturation * 100)} percent. p99 ${vm.p99} milliseconds. `
    + `Errors ${percentNumber(vm.errorRate)} percent. Press I to inspect, A for actions.`;
}

export function nodeVm(state, scenario, id) {
  const m = (k) => metric(state, id, k);
  const vm = {
    id,
    label: nodeLabel(scenario, id),
    status: statusOf(state, id),
    p50: m('p50'), p99: m('p99'), errorRate: m('errorRate'), saturation: m('saturation'), queue: m('queue'), hitRate: m('hitRate'), rps: m('rps'),
  };
  vm.pile = pileOf(vm.saturation, queueRatio(state, id));
  vm.attrs = {
    'data-node': id,
    'data-status': vm.status,
    'data-saturation': percentNumber(vm.saturation),
    'data-p50': String(vm.p50),
    'data-p99': String(vm.p99),
    'data-error-rate': percentNumber(vm.errorRate),
    'data-queue': String(vm.queue),
    'data-hit-rate': vm.hitRate === null ? '' : percentNumber(vm.hitRate),
    'data-pile': String(vm.pile),
  };
  vm.aria = nodeAriaName(vm);
  return vm;
}

export const nodeIds = (state) => Object.keys(state.m);

export function worstStatus(state) {
  let worst = 'ok';
  for (const id of nodeIds(state)) {
    const s = statusOf(state, id);
    if (RANK[s] > RANK[worst]) worst = s;
  }
  return worst;
}

// "[CRIT] Incident title - incident-sim". A resolved run reads [OK] even while nodes still show RECV.
export function documentTitle(state, scenario) {
  const status = state.status === 'resolved' ? 'ok' : worstStatus(state);
  return `[${TITLE_PREFIX[status]}] ${scenario.title} - incident-sim`;
}

export const playStatus = (state, ui) => (state.status !== 'running' ? state.status : ui.paused ? 'paused' : 'running');
export const isGrace = (state) => state.status === 'running' && state.budgetLeft === 0;

export function playAttrs(state, ui) {
  const r = result(state);
  return {
    'data-scenario': state.scenarioId,
    'data-seed': String(state.seed),
    'data-sim-time': String(state.tick),
    'data-status': playStatus(state, ui),
    'data-grace': String(isGrace(state)),
    'data-mode': ui.text ? 'text' : 'map',
    'data-reduced-motion': String(Boolean(ui.reduced)),
    'data-budget-left': String(state.budgetLeft),
    'data-budget-total': String(state.scenario.budget),
    'data-selected-node': ui.selected || '',
    'data-alert-count': String(firingAlerts(state).length),
    'data-actions-taken': String(state.actionLog.length),
    'data-harmful-count': String(r.harmful),
    'data-hint-used': String(Boolean(ui.hintUsed)),
    'data-updated-at': String(ui.updatedAt === undefined ? state.tick : ui.updatedAt),
    'data-speed': String(ui.speed || 1),
    'data-state-hash': stateHash(state),
  };
}

// ---------------------------------------------------------------- pager lamps
// total lamps, `left` lit. `previewCost` ghost-dims that many of the lit lamps from the right.
export function lamps(total, left, previewCost = 0) {
  const out = [];
  for (let i = 0; i < total; i++) {
    const on = i < left;
    out.push({ state: on ? 'on' : 'spent', preview: on && previewCost > 0 && i >= left - previewCost });
  }
  return out;
}
export const pagerText = (left, total) => `Pager ${left} / ${total}`;
export const pagerLabel = (left, total) => `Pager budget: ${left} of ${total} left`;

// ---------------------------------------------------------------- alerts
export function conditionNode(cond) {
  if (cond === null || typeof cond !== 'object') return null;
  if (typeof cond.node === 'string') return cond.node;
  for (const key of ['all', 'any']) {
    if (Array.isArray(cond[key])) {
      for (const c of cond[key]) {
        const n = conditionNode(c);
        if (n) return n;
      }
    }
  }
  return cond.not ? conditionNode(cond.not) : null;
}

// Firing rows first (severity, then file order), then cleared rows in file order.
export function alertRows(state) {
  const rows = [];
  state.scenario.alerts.forEach((rule, i) => {
    const a = state.alerts[rule.id];
    if (!a) return;
    const base = { id: rule.id, severity: rule.severity, text: rule.text, node: conditionNode(rule.when), order: i };
    if (a.firing) rows.push({ ...base, state: 'firing', since: a.since, meta: `since ${clock(a.since)}` });
    else if (a.clearedAt !== null) rows.push({ ...base, state: 'resolved', clearedAt: a.clearedAt, meta: `SEV${rule.severity} · ${clock(a.clearedAt)}` });
  });
  const firing = rows.filter((r) => r.state === 'firing').sort((x, y) => x.severity - y.severity || x.order - y.order);
  const cleared = rows.filter((r) => r.state === 'resolved').sort((x, y) => x.order - y.order);
  return [...firing, ...cleared];
}

// ---------------------------------------------------------------- actions
export const EFFECT_TEXT = Object.freeze({
  inspect: "Read this node's metrics and recent logs.",
  'trace-request': 'Follow one slow request through the system and see where it waits.',
  'tail-logs': 'Stream the last 30 seconds of logs from every node, not just this one.',
  'compare-dashboards': "Line up every node's metrics against five minutes ago.",
  'deploy-history': 'See what shipped recently and when.',
  'scale-service': 'Add instances behind the load balancer.',
  'add-ttl-jitter': 'Spread cache expiry times so keys stop expiring together, and coalesce duplicate reloads.',
  'circuit-breaker': 'Stop calling a failing dependency and fail fast instead.',
  'backoff-jitter': 'Make clients wait longer, and randomly, between retries.',
  'shed-load': 'Reject a slice of low-priority requests at the edge.',
  failover: 'Promote the replica to primary.',
  'shard-rekey': 'Split a hot key across partitions.',
  'add-index': 'Add a database index for the slow query.',
  rollback: 'Return the service to the previous release.',
  'raise-pool-size': 'Allow more connections per service instance.',
  'renew-cert': 'Issue a new TLS certificate and reload it.',
});

export function costOf(scenario, id) {
  if (id === 'inspect') return 0;
  const act = ACTIONS.find((a) => a.id === id);
  const fromAction = scenario.actions && scenario.actions[id] && scenario.actions[id].cost;
  const fromDiag = scenario.diagnostics && scenario.diagnostics[id] && scenario.diagnostics[id].cost;
  return fromAction ?? fromDiag ?? (act && act.kind === 'fix' ? DEFAULT_COST.fix : DEFAULT_COST.diagnostic);
}

export const costText = (cost) => (cost > 0 ? `Cost ${cost}` : 'Free');
export const costDescription = (cost, left) => (cost > 0 ? `Costs ${cost} of your ${left} remaining pager.` : 'Free. Reading a node never spends pager.');

export function actionRows(state, scenario, selected) {
  return ACTIONS.map((a) => {
    const cost = costOf(scenario, a.id);
    const row = {
      id: a.id, name: a.name, kind: a.kind, cost, costText: costText(cost), effect: EFFECT_TEXT[a.id] || '', state: 'enabled', reason: '',
      description: costDescription(cost, state.budgetLeft),
    };
    if (a.id !== 'inspect') {
      const r = canApply(state, a.id, selected || null);
      if (!r.ok) {
        row.state = r.reason === 'Already on.' ? 'applied' : 'disabled';
        row.reason = r.reason;
      }
    }
    return row;
  });
}

export function actionFeedback(kind, name, left, total) {
  return kind === 'fix'
    ? `Applied: ${name}. ${pagerText(left, total)}. Takes effect next tick.`
    : `Ran: ${name}. ${pagerText(left, total)}.`;
}

// ---------------------------------------------------------------- history
export const EFFECT_WORD = Object.freeze({ helpful: 'Helped', harmful: 'Harmful', diagnostic: 'Diagnostic', none: 'No effect' });

export function historyRows(state, scenario) {
  return historyEffects(state).map((h, i) => {
    const a = ACTIONS.find((x) => x.id === h.id);
    return {
      index: i, id: h.id, node: h.node, time: h.t, timeText: mmss(h.t), name: a ? a.name : h.id,
      target: h.node ? nodeLabel(scenario, h.node) : '', effect: h.effect, effectWord: h.effect ? EFFECT_WORD[h.effect] : 'Checking',
    };
  });
}

// ---------------------------------------------------------------- logs
export const LEVEL_WORD = Object.freeze({ info: 'INFO', warn: 'WARN', error: 'ERR' });

// Lines for one node plus the global ones (diagnostics ran, escalations).
export const logsFor = (state, nodeId) => state.logs.filter((l) => l.node === nodeId || l.node === null);
export const newLogs = (state) => {
  const out = [];
  for (let i = state.logs.length - 1; i >= 0 && state.logs[i].t === state.tick; i--) out.unshift(state.logs[i]);
  return out;
};
export const logLineVm = (l) => ({ time: mmss(l.t), level: l.level, levelWord: LEVEL_WORD[l.level] || 'INFO', kind: l.kind, text: l.text, node: l.node });

// ---------------------------------------------------------------- inspector metrics
export function inspectMetrics(vm) {
  const hasHit = vm.hitRate !== null;
  return [
    { key: 'p50', label: 'p50', value: String(vm.p50), text: `${int(vm.p50)} ms` },
    { key: 'p99', label: 'p99', value: String(vm.p99), text: `${int(vm.p99)} ms` },
    { key: 'errors', label: 'Errors', value: percentNumber(vm.errorRate), text: percent(vm.errorRate) },
    { key: 'saturation', label: 'Saturation', value: percentNumber(vm.saturation), text: percent(vm.saturation) },
    { key: 'queue', label: 'Queue', value: String(vm.queue), text: int(vm.queue) },
    { key: 'cache-hit', label: 'Hit rate', value: hasHit ? percentNumber(vm.hitRate) : '', text: hasHit ? percent(vm.hitRate) : '-' },
  ];
}

// ---------------------------------------------------------------- sparklines (fixed ranges, never auto-scaled)
export const SPARK_WINDOW = 60;
const SPARKS = [
  { key: 'p99', short: 'p99', series: 'p99', source: 'p99' },
  { key: 'errors', short: 'Errors', series: 'errors', source: 'errors' },
  { key: 'saturation', short: 'Saturation', series: 'saturation', source: 'saturation' },
  { key: 'queue', short: 'Queue', series: 'queue', source: 'queue' },
  { key: 'cache-hit', short: 'Hit rate', series: 'cache-hit', source: 'cache-hit' },
];

function sparkStatus(key, value, th, queueMax) {
  if (value === null) return 'ok';
  if (key === 'p99') return value >= th.p99.crit ? 'crit' : value >= th.p99.warn ? 'warn' : 'ok';
  if (key === 'errors') return value >= th.errorRate.crit ? 'crit' : value >= th.errorRate.warn ? 'warn' : 'ok';
  if (key === 'saturation') return value >= th.saturation.crit ? 'crit' : value >= th.saturation.warn ? 'warn' : 'ok';
  if (key === 'queue') {
    const r = queueMax > 0 ? value / queueMax : 0;
    return r >= th.queue.crit ? 'crit' : r >= th.queue.warn ? 'warn' : 'ok';
  }
  return value < th.hitRate.crit ? 'crit' : value < th.hitRate.warn ? 'warn' : 'ok';
}

export function sparkVms(state, scenario) {
  const th = thresholdsOf(scenario);
  return SPARKS.map((def) => {
    const node = scenario.sparks[def.source];
    const all = state.series[def.series] || [];
    const series = all.slice(-SPARK_WINDOW);
    const last = node && series.length ? series[series.length - 1] : null;
    const p = node ? state.params[node] || {} : {};
    const queueMax = def.key === 'queue' ? (p.maxDepth !== undefined ? p.maxDepth : p.backlogMax) || 0 : 0;
    let max = 1;
    let threshold = null;
    let valueText = '-';
    let value = '';
    if (def.key === 'p99') { max = 3000; threshold = th.p99.crit; }
    else if (def.key === 'errors') { max = 1; threshold = th.errorRate.crit; }
    else if (def.key === 'saturation') { max = 1; threshold = th.saturation.crit; }
    else if (def.key === 'queue') { max = Math.max(1, queueMax); threshold = queueMax > 0 ? Math.round(th.queue.crit * queueMax) : null; }
    else { max = 1; threshold = th.hitRate.warn; }
    if (last !== null) {
      if (def.key === 'p99') { value = String(last); valueText = int(last); }
      else if (def.key === 'queue') { value = String(last); valueText = int(last); }
      else { value = percentNumber(last); valueText = percent(last); }
    }
    const unit = def.key === 'p99' && last !== null ? ' ms' : '';
    const status = node ? sparkStatus(def.key, last, th, queueMax) : 'ok';
    const thresholdText = threshold === null ? '' : def.key === 'p99' ? `${threshold} ms` : def.key === 'queue' ? int(threshold) : percent(threshold);
    return {
      key: def.key, name: def.short, node, nodeLabel: node ? nodeLabel(scenario, node) : 'No source', status, value, valueText, unit,
      series, max, threshold, thresholdText, available: Boolean(node),
    };
  });
}

// Y coordinate (0..56 box) for a value inside the fixed range; 52 is the baseline, 6 is the ceiling.
export const sparkY = (v, max) => 52 - clamp(v / max, 0, 1) * 46;

const r1 = (n) => Math.round(n * 10) / 10;

// [x, y] points inside the 164 x 56 box; a short series hugs the right edge, nulls are skipped.
export function sparkPoints(series, max) {
  const n = SPARK_WINDOW;
  const offset = n - series.length;
  const pts = [];
  for (let i = 0; i < series.length; i++) {
    if (series[i] === null) continue;
    pts.push([r1(2 + ((i + offset) / (n - 1)) * 160), r1(sparkY(series[i], max))]);
  }
  return pts;
}

export function sparkPath(series, max) {
  const pts = sparkPoints(series, max);
  return pts.length ? `M${pts.map((p) => `${p[0]} ${p[1]}`).join(' L')}` : '';
}

// The same line closed down to the baseline, for the 12% area fill.
export function sparkArea(series, max) {
  const pts = sparkPoints(series, max);
  if (pts.length === 0) return '';
  return `${sparkPath(series, max)} L${pts[pts.length - 1][0]} 52 L${pts[0][0]} 52 Z`;
}

// ---------------------------------------------------------------- summary and banners
export function summaryNodes(state, scenario) {
  return nodeIds(state).map((id) => ({ label: nodeLabel(scenario, id), status: statusOf(state, id), saturation: metric(state, id, 'saturation') }));
}

export const resolvedText = (tick) => `Resolved at ${clock(tick)}. The pager goes quiet.`;
export const resolvedAnnouncement = (tick) => `Resolved at ${clock(tick)}. Open the debrief.`;
export const GRACE_TEXT = 'Out of pager budget. Actions are off. Watching 10 s to see if your last fix lands.';
export const OVER_TEXT = 'Out of pager budget.';
export const graceCountdown = (left) => `Watching: ${left} s left`;
