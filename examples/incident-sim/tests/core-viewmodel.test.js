// core/viewmodel.js: pure view model over real engine states of cache-stampede.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { validate } from '../public/js/engine/validate.js';
import { createRun, step, canApply, firingAlerts } from '../public/js/engine/engine.js';
import { stateHash } from '../public/js/engine/fingerprint.js';
import * as V from '../public/js/core/viewmodel.js';

const raw = JSON.parse(fs.readFileSync(new URL('../scenarios/cache-stampede.json', import.meta.url), 'utf8'));
const scenario = validate(raw, 'cache-stampede.json').scenario;
const run = (n, acts = {}) => {
  let s = createRun(scenario, 1);
  for (let i = 0; i < n; i++) s = step(s, acts[i] || []);
  return s;
};
const ui = (over = {}) => ({ paused: false, text: false, reduced: false, selected: null, hintUsed: false, speed: 1, ...over });

test('pileOf and dotRateOf follow the pinned formulas', () => {
  assert.equal(V.pileOf(0.7, 0), 0);
  assert.equal(V.pileOf(0.85, 0), 12);
  assert.equal(V.pileOf(0, 1), 24);
  assert.equal(V.pileOf(9, 0), 24);
  assert.equal(V.dotRateOf(100, 100), 8);
  assert.equal(V.dotRateOf(0, 100), 0.5);
  assert.equal(V.dotRateOf(1e6, 100), 40);
  assert.equal(V.dotRateOf(50, 0), 8, 'a zero baseline reads as normal load');
});

test('nodeLabel prefers the scenario label, then the catalogue name, then the id', () => {
  assert.equal(V.nodeLabel(scenario, 'cache'), 'Product cache');
  assert.equal(V.nodeLabel(scenario, 'clients'), 'Clients');
  assert.equal(V.nodeLabel({ labels: {} }, 'db-primary'), 'DB primary');
  assert.equal(V.nodeLabel({}, 'mystery'), 'mystery');
});

test('nodeVm makes percent attributes with one decimal and an aria name with a status word', () => {
  const s = run(12);
  const vm = V.nodeVm(s, scenario, 'cache');
  assert.equal(vm.status, 'crit');
  assert.equal(vm.attrs['data-status'], 'crit');
  assert.match(vm.attrs['data-saturation'], /^\d+\.\d$/);
  assert.match(vm.attrs['data-error-rate'], /^\d+\.\d$/);
  assert.match(vm.attrs['data-hit-rate'], /^\d+\.\d$/);
  assert.match(vm.aria, /^Product cache\. CRIT\. Saturation \d+ percent\. p99 \d+ milliseconds\. Errors \d+\.\d percent\. Press I to inspect, A for actions\.$/);
  assert.equal(V.nodeVm(s, scenario, 'lb').attrs['data-hit-rate'], '', 'non-cache nodes have no hit rate');
  assert.equal(Number(vm.attrs['data-pile']), vm.pile);
});

test('playAttrs carries every data-* name of the contract', () => {
  const s = run(3);
  const a = V.playAttrs(s, ui({ selected: 'cache', hintUsed: true, speed: 4 }));
  assert.deepEqual(Object.keys(a).sort(), [
    'data-actions-taken', 'data-alert-count', 'data-budget-left', 'data-budget-total', 'data-grace', 'data-harmful-count', 'data-hint-used',
    'data-mode', 'data-reduced-motion', 'data-scenario', 'data-seed', 'data-selected-node', 'data-sim-time', 'data-speed', 'data-state-hash',
    'data-status', 'data-updated-at',
  ]);
  assert.equal(a['data-scenario'], 'cache-stampede');
  assert.equal(a['data-seed'], '1');
  assert.equal(a['data-sim-time'], '3');
  assert.equal(a['data-selected-node'], 'cache');
  assert.equal(a['data-hint-used'], 'true');
  assert.equal(a['data-speed'], '4');
  assert.equal(a['data-state-hash'], stateHash(s));
  assert.equal(a['data-updated-at'], '3');
  assert.equal(V.playAttrs(s, ui({ updatedAt: 2 }))['data-updated-at'], '2');
});

test('data-status is running, paused, or the engine status; grace is budget zero while running', () => {
  const s = run(2);
  assert.equal(V.playStatus(s, ui()), 'running');
  assert.equal(V.playStatus(s, ui({ paused: true })), 'paused');
  assert.equal(V.playStatus({ ...s, status: 'resolved' }, ui({ paused: true })), 'resolved');
  assert.equal(V.isGrace({ ...s, budgetLeft: 0 }), true);
  assert.equal(V.isGrace({ ...s, budgetLeft: 0, status: 'out-of-budget' }), false);
  assert.equal(V.isGrace(s), false);
  assert.equal(V.playAttrs(s, ui({ text: true, reduced: true }))['data-mode'], 'text');
  assert.equal(V.playAttrs(s, ui({ reduced: true }))['data-reduced-motion'], 'true');
});

test('documentTitle follows the worst node and reads OK once resolved', () => {
  assert.match(V.documentTitle(run(2), scenario), /^\[OK\] .* - incident-sim$/);
  assert.match(V.documentTitle(run(12), scenario), /^\[CRIT\] /);
  assert.match(V.documentTitle({ ...run(12), status: 'resolved' }, scenario), /^\[OK\] /);
});

test('lamps count lit and spent lamps and ghost-dim the ones a cost would take', () => {
  assert.deepEqual(V.lamps(3, 2).map((l) => l.state), ['on', 'on', 'spent']);
  assert.deepEqual(V.lamps(4, 3, 2).map((l) => l.preview), [false, true, true, false]);
  assert.deepEqual(V.lamps(2, 0, 2).map((l) => l.preview), [false, false]);
  assert.equal(V.pagerText(4, 6), 'Pager 4 / 6');
  assert.equal(V.pagerLabel(4, 6), 'Pager budget: 4 of 6 left');
});

test('alertRows lists firing pages first, with the node named by the condition', () => {
  const s = run(12);
  const rows = V.alertRows(s);
  assert.ok(rows.length >= 1);
  assert.equal(rows[0].state, 'firing');
  assert.equal(rows[0].severity, 2);
  assert.equal(rows[0].text, 'checkout p99 > 2 s');
  assert.equal(rows[0].node, 'lb');
  assert.match(rows[0].meta, /^since T\+00:0\d$/);
  assert.equal(rows.filter((r) => r.state === 'firing').length, firingAlerts(s).length);
  assert.deepEqual(V.alertRows(run(1)), []);
});

test('conditionNode finds the first node inside all, any and not', () => {
  assert.equal(V.conditionNode({ node: 'a', metric: 'p99', op: 'gt', value: 1 }), 'a');
  assert.equal(V.conditionNode({ all: [{ tickGte: 3 }, { node: 'b' }] }), 'b');
  assert.equal(V.conditionNode({ any: [{ not: { node: 'c' } }] }), 'c');
  assert.equal(V.conditionNode({ not: { node: 'd' } }), 'd');
  assert.equal(V.conditionNode(null), null);
  assert.equal(V.conditionNode({ tickGte: 1 }), null);
});

test('costOf reads the scenario, then the defaults; inspect is free', () => {
  assert.equal(V.costOf(scenario, 'add-ttl-jitter'), 1);
  assert.equal(V.costOf(scenario, 'inspect'), 0);
  assert.equal(V.costOf(scenario, 'trace-request'), 1);
  assert.equal(V.costOf(scenario, 'scale-service'), 2);
  assert.equal(V.costOf({ actions: {}, diagnostics: {} }, 'rollback'), 2);
  assert.equal(V.costText(0), 'Free');
  assert.equal(V.costText(2), 'Cost 2');
  assert.equal(V.costDescription(2, 4), 'Costs 2 of your 4 remaining pager.');
});

test('actionRows mirror canApply: enabled, disabled with the exact reason, applied', () => {
  let s = run(8);
  let rows = V.actionRows(s, scenario, null);
  assert.equal(rows.length, 16);
  assert.equal(rows[0].id, 'inspect');
  assert.equal(rows[0].costText, 'Free');
  const by = (id) => rows.find((r) => r.id === id);
  assert.equal(by('trace-request').state, 'enabled');
  assert.equal(by('scale-service').state, 'disabled');
  assert.equal(by('scale-service').reason, 'Works on a service or consumer. Select one first.');
  assert.equal(by('add-ttl-jitter').state, 'enabled', 'a lone cache needs no selection');
  assert.equal(canApply(s, 'add-ttl-jitter', null).ok, true);
  s = step(s, [{ id: 'add-ttl-jitter', node: 'cache' }]);
  rows = V.actionRows(s, scenario, 'cache');
  assert.equal(rows.find((r) => r.id === 'add-ttl-jitter').state, 'applied');
  assert.equal(rows.find((r) => r.id === 'add-ttl-jitter').reason, 'Already on.');
  assert.equal(rows.find((r) => r.id === 'shed-load').reason, 'Works on a lb. Select one first.');
});

test('actionRows at budget zero disable every priced action and keep inspect open', () => {
  const s = { ...run(8), budgetLeft: 0 };
  const rows = V.actionRows(s, scenario, 'cache');
  for (const r of rows) {
    if (r.id === 'inspect') assert.equal(r.state, 'enabled');
    else { assert.equal(r.state, 'disabled', r.id); assert.equal(r.reason, 'Out of pager budget.'); }
  }
  const low = { ...run(8), budgetLeft: 1 };
  assert.equal(V.actionRows(low, scenario, 'service-1').find((r) => r.id === 'scale-service').reason, 'Not enough pager. It costs 2 and you have 1.');
});

test('action feedback strings match ux copy', () => {
  assert.equal(V.actionFeedback('fix', 'Add TTL jitter', 5, 6), 'Applied: Add TTL jitter. Pager 5 / 6. Takes effect next tick.');
  assert.equal(V.actionFeedback('diagnostic', 'Trace request', 4, 5), 'Ran: Trace request. Pager 4 / 5.');
});

test('historyRows leaves the effect unknown until it is revealed', () => {
  let s = run(8);
  s = step(s, [{ id: 'add-ttl-jitter', node: 'cache' }]);
  let rows = V.historyRows(s, scenario);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'Add TTL jitter');
  assert.equal(rows[0].target, 'Product cache');
  assert.equal(rows[0].effect, null);
  assert.equal(rows[0].effectWord, 'Checking');
  for (let i = 0; i < 6; i++) s = step(s, []);
  rows = V.historyRows(s, scenario);
  assert.equal(rows[0].effect, 'helpful');
  assert.equal(rows[0].effectWord, 'Helped');
});

test('logsFor keeps one node plus global lines; newLogs is the current tick only', () => {
  const s = run(14);
  const cacheLogs = V.logsFor(s, 'cache');
  assert.ok(cacheLogs.length > 0);
  assert.ok(cacheLogs.every((l) => l.node === 'cache' || l.node === null));
  assert.ok(V.newLogs(s).every((l) => l.t === s.tick));
  const vm = V.logLineVm({ t: 7, node: 'cache', level: 'error', kind: 'log', text: 'x' });
  assert.deepEqual([vm.time, vm.levelWord, vm.level, vm.kind], ['00:07', 'ERR', 'error', 'log']);
});

test('inspectMetrics shows six metrics and a dash for a missing hit rate', () => {
  const s = run(12);
  const cache = V.inspectMetrics(V.nodeVm(s, scenario, 'cache'));
  assert.deepEqual(cache.map((m) => m.key), ['p50', 'p99', 'errors', 'saturation', 'queue', 'cache-hit']);
  assert.match(cache[5].text, /%$/);
  const lb = V.inspectMetrics(V.nodeVm(s, scenario, 'lb'));
  assert.equal(lb[5].text, '-');
  assert.equal(lb[5].value, '');
});

test('sparkVms gives five tiles with fixed ranges and a status', () => {
  const s = run(12);
  const tiles = V.sparkVms(s, scenario);
  assert.deepEqual(tiles.map((t) => t.key), ['p99', 'errors', 'saturation', 'queue', 'cache-hit']);
  const p99 = tiles[0];
  assert.equal(p99.max, 3000);
  assert.equal(p99.thresholdText, '2000 ms');
  assert.equal(p99.status, 'crit');
  assert.equal(p99.series.length, 13);
  assert.equal(tiles[4].threshold, 0.8);
  assert.equal(tiles[4].status, 'crit');
  const calm = V.sparkVms(run(1), scenario);
  assert.ok(calm.every((t) => t.status === 'ok'));
});

test('sparkVms marks a tile without a source node as unavailable', () => {
  const sc = { ...scenario, sparks: { ...scenario.sparks, queue: null } };
  const t = V.sparkVms(run(3), sc).find((x) => x.key === 'queue');
  assert.equal(t.available, false);
  assert.equal(t.status, 'ok');
  assert.equal(t.valueText, '-');
});

test('sparkPath maps values into the fixed 164 x 56 box and skips nulls', () => {
  assert.equal(V.sparkY(0, 3000), 52);
  assert.equal(V.sparkY(3000, 3000), 6);
  assert.equal(V.sparkY(9999, 3000), 6, 'clamped, never auto-scaled');
  assert.equal(V.sparkPath([], 1), '');
  assert.equal(V.sparkPath([null, null], 1), '');
  const full = Array.from({ length: 60 }, (_, i) => i / 59);
  const d = V.sparkPath(full, 1);
  assert.ok(d.startsWith('M2 52'));
  assert.ok(d.endsWith('162 6'));
  assert.equal(V.sparkPath([0.5], 1).startsWith('M162 '), true, 'a short series hugs the right edge');
});

test('sparkArea closes the line down to the baseline', () => {
  assert.equal(V.sparkArea([], 1), '');
  const full = Array.from({ length: 60 }, () => 0.5);
  const a = V.sparkArea(full, 1);
  assert.ok(a.startsWith('M2 29'));
  assert.ok(a.endsWith('L162 52 L2 52 Z'));
  assert.deepEqual(V.sparkPoints([null, 0], 1).length, 1);
});

test('summaryNodes and banner copy', () => {
  const s = run(12);
  const nodes = V.summaryNodes(s, scenario);
  assert.equal(nodes.length, 8);
  assert.ok(nodes.some((n) => n.status === 'crit'));
  assert.equal(V.resolvedText(161), 'Resolved at T+02:41. The pager goes quiet.');
  assert.equal(V.resolvedAnnouncement(161), 'Resolved at T+02:41. Open the debrief.');
  assert.equal(V.graceCountdown(7), 'Watching: 7 s left');
  assert.equal(V.STATUS_LABEL.recovering, 'RECV');
});
