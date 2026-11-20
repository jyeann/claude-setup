// Scenario validator V1-V19 on a hand-made fixture (shipped files come later).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validate, formatError, MAX_FILE_BYTES, SCENARIO_KEYS } from '../public/js/engine/validate.js';
import { ACTION_IDS } from '../public/js/engine/catalogue.js';
import { GUIDES } from '../public/js/engine/guides.js';
import { rawFixture } from './fixtures/load.js';

const FILE = 'stampede.json';
const mut = (fn, file = FILE) => { const r = rawFixture(); fn(r); return validate(r, file); };
const errs = (res) => (res.ok ? [] : res.errors);
const at = (res, field) => errs(res).filter((e) => e.field === field);
const under = (res, prefix) => errs(res).filter((e) => e.field === prefix || e.field.startsWith(prefix));
const expected = (e) => /Expected: .+\.$/.test(e.message);
const show = (res) => errs(res).map((e) => `${e.field}: ${e.message}`).join(' | ');
const bad = (res, field) => { assert.ok(under(res, field).length >= 1, `no error under ${field}; got ${show(res)}`); assert.ok(under(res, field).every(expected), show(res)); };
const good = (res, field) => assert.equal(under(res, field).length, 0, `unexpected under ${field}: ${show(res)}`);

test('the fixture validates and the result is deep-frozen with defaults filled', () => {
  const res = mut(() => {});
  assert.equal(res.ok, true, show(res));
  const sc = res.scenario;
  assert.equal(sc.maxTicks, 600);
  assert.equal(sc.holdTicks, 5);
  assert.equal(sc.escalateEvery, 90);
  assert.deepEqual(sc.thresholds, {});
  assert.deepEqual(sc.diagnostics, {});
  assert.deepEqual(sc.resolve, { require: [] });
  assert.ok(sc.alerts.every((a) => a.forTicks === 2));
  assert.ok(sc.logs.every((l) => l.every >= 1));
  assert.equal(sc.logs[1].every, 3, 'explicit values are kept');
  assert.equal(sc.topology.nodes.lb.instances, 1);
  assert.equal(sc.topology.nodes.lb.shed, 0);
  assert.equal(sc.topology.nodes['db-primary'].hotShare, 1);
  assert.equal(sc.topology.nodes['db-primary'].shards, 1);
  assert.equal(sc.topology.nodes.cache.hitRate, 0.95);
  const e = sc.topology.edges.find((x) => x.from === 'cache');
  assert.deepEqual({ ...e }, { from: 'cache', to: 'db-primary', calls: 1, share: 1, retries: 0, backoff: false, breaker: false, fallback: true, missOnly: true });
  assert.equal(sc.topology.edges.find((x) => x.from === 'lb' && x.to === 'service-1').missOnly, false);
  const walk = (v, p) => { if (v && typeof v === 'object') { assert.ok(Object.isFrozen(v), p); for (const k of Object.keys(v)) walk(v[k], `${p}.${k}`); } };
  walk(sc, 'scenario');
  assert.throws(() => { 'use strict'; sc.title = 'x'; }, TypeError);
});

test('hotShare defaults to 1 / shards', () => {
  const res = mut((r) => { r.topology.nodes['db-primary'].shards = 4; });
  assert.equal(res.scenario.topology.nodes['db-primary'].hotShare, 0.25);
});

test('exports and formatError', () => {
  assert.equal(MAX_FILE_BYTES, 65536);
  assert.equal(SCENARIO_KEYS[0], 'schema');
  assert.equal(SCENARIO_KEYS.at(-1), 'guideTitle');
  assert.equal(SCENARIO_KEYS.length, 31);
  assert.equal(formatError({ file: 'a.json', field: 'x[1]', message: 'm. Expected: n.' }), 'scenarios/a.json: field "x[1]": m. Expected: n.');
});

test('V1 missing fields: exact message for rootCause, "missing. Expected:" for every required field, optional ones may be absent', () => {
  assert.deepEqual(errs(mut((r) => { delete r.rootCause; })), [{ file: FILE, field: 'rootCause', message: 'missing. Expected: a non-empty string.' }]);
  for (const k of ['schema', 'id', 'title', 'difficulty', 'summary', 'budget', 'seed', 'topology', 'workload', 'sparks', 'faults', 'alerts', 'logs', 'actions', 'hint', 'rootCause', 'rootCauseNode', 'concept', 'harmfulWhy', 'optimalPath', 'optimalSummary', 'guideUrl', 'guideTitle']) {
    const e = at(mut((r) => { delete r[k]; }), k);
    assert.equal(e.length, 1, k);
    assert.match(e[0].message, /^missing\. Expected: .+\.$/, k);
  }
  for (const k of ['maxTicks', 'holdTicks', 'escalateEvery', 'labels', 'thresholds', 'deploys', 'diagnostics', 'resolve']) assert.equal(mut((r) => { delete r[k]; }).ok, true, k);
});

test('V2 unknown top-level key lists SCENARIO_KEYS', () => {
  assert.deepEqual(errs(mut((r) => { r.bonus = 1; })), [{ file: FILE, field: 'bonus', message: `is not a known field. Expected: one of ${SCENARIO_KEYS.join(', ')}.` }]);
});

test('V3 schema must be the integer 1', () => {
  for (const v of [2, 0, '1', 1.5, null, true, [1]]) assert.ok(expected(at(mut((r) => { r.schema = v; }), 'schema')[0]), JSON.stringify(v));
  good(mut((r) => { r.schema = 1; }), 'schema');
});

test('V4 id pattern and file stem', () => {
  bad(mut((r) => { r.id = 'y'; }, 'x.json'), 'id');
  good(mut((r) => { r.id = 'y'; }, 'y.json'), 'id');
  for (const id of ['Cache', 'a_b', '', 'a'.repeat(41), 'café', 5, null]) bad(mut((r) => { r.id = id; }, 'q.json'), 'id');
  good(mut((r) => { r.id = 'a'.repeat(40); }, `${'a'.repeat(40)}.json`), 'id');
  assert.equal(validate(rawFixture(), undefined).ok, false, 'a missing file name cannot match the id');
});

test('V5 string limits: valid at the limit, invalid one over, at zero and for other types', () => {
  const lim = { title: 300, summary: 160, hint: 300, rootCause: 600, concept: 600, guideTitle: 80 };
  for (const [f, max] of Object.entries(lim)) {
    good(mut((r) => { r[f] = 'a'.repeat(max); }), f);
    good(mut((r) => { r[f] = 'a'; }), f);
    bad(mut((r) => { r[f] = 'a'.repeat(max + 1); }), f);
    bad(mut((r) => { r[f] = ''; }), f);
    for (const v of [5, null, {}, ['x'], true]) bad(mut((r) => { r[f] = v; }), f);
  }
});

test('V6 numeric ranges at and beyond each boundary', () => {
  const ranges = { difficulty: [1, 3], budget: [1, 12], seed: [0, 4294967295], maxTicks: [60, 600], holdTicks: [1, 30], escalateEvery: [0, 600] };
  for (const [f, [lo, hi]] of Object.entries(ranges)) {
    good(mut((r) => { r[f] = lo; }), f);
    good(mut((r) => { r[f] = hi; }), f);
    for (const v of [lo - 1, hi + 1, lo + 0.5, String(lo), null, NaN]) bad(mut((r) => { r[f] = v; }), f);
  }
});

test('V7 unknown action ids: exact message with all 16 ids, in optimalPath, actions, diagnostics and harmfulWhy', () => {
  const e = at(mut((r) => { r.optimalPath.push({ id: 'reboot-everything', node: 'cache' }); }), 'optimalPath[1].id');
  assert.equal(e[0].message, `unknown action "reboot-everything". Expected: one of ${ACTION_IDS.join(', ')}.`);
  assert.match(e[0].message, /one of inspect, trace-request, tail-logs, compare-dashboards, deploy-history, scale-service, add-ttl-jitter, circuit-breaker, backoff-jitter, shed-load, failover, shard-rekey, add-index, rollback, raise-pool-size, renew-cert\.$/);
  bad(mut((r) => { r.actions['reboot-everything'] = { cost: 2 }; }), 'actions.reboot-everything');
  bad(mut((r) => { r.diagnostics = { 'reboot-everything': { cost: 1 } }; }), 'diagnostics.reboot-everything');
  bad(mut((r) => { r.harmfulWhy['reboot-everything'] = 'x'; }), 'harmfulWhy.reboot-everything');
  assert.match(at(mut((r) => { r.optimalPath[0].id = 7; }), 'optimalPath[0].id')[0].message, /^unknown action value\./);
});

test('V8 optimalPath: fix ids with a node of an allowed type, 1 to 4 steps', () => {
  bad(mut((r) => { r.optimalPath[0] = { id: 'tail-logs', node: 'cache' }; }), 'optimalPath[0].id');
  bad(mut((r) => { r.optimalPath[0] = { id: 'inspect', node: 'cache' }; }), 'optimalPath[0].id');
  bad(mut((r) => { r.optimalPath[0] = { id: 'add-ttl-jitter' }; }), 'optimalPath[0].node');
  bad(mut((r) => { r.optimalPath[0] = { node: 'cache' }; }), 'optimalPath[0].id');
  bad(mut((r) => { r.optimalPath[0] = { id: 'add-ttl-jitter', node: 'lb' }; }), 'optimalPath[0].node');
  bad(mut((r) => { r.optimalPath[0].extra = 1; }), 'optimalPath[0].extra');
  bad(mut((r) => { r.optimalPath = []; }), 'optimalPath');
  bad(mut((r) => { r.optimalPath = 'x'; }), 'optimalPath');
  bad(mut((r) => { r.optimalPath = [5]; }), 'optimalPath[0]');
  bad(mut((r) => { r.optimalPath = Array.from({ length: 5 }, () => ({ id: 'scale-service', node: 'service-1' })); r.budget = 12; }), 'optimalPath');
  good(mut((r) => { r.optimalPath = Array.from({ length: 4 }, (_, i) => ({ id: 'scale-service', node: i % 2 ? 'service-1' : 'service-2' })); r.budget = 12; }), 'optimalPath');
});

test('V9 and V10 guide URLs: exact messages, truncated echo, all 11 allowed', () => {
  assert.equal(at(mut((r) => { r.guideUrl = 'https://example.com/x'; }), 'guideUrl')[0].message, '"https://example.com/x" is not allowed. Expected: a URL starting with https://bytebytego.com/guides/.');
  assert.equal(at(mut((r) => { r.guideUrl = 'https://bytebytego.com/guides/nope'; }), 'guideUrl')[0].message, '"https://bytebytego.com/guides/nope" is not in the guide allow-list. Expected: one of the URLs in public/js/engine/guides.js.');
  for (const u of ['http://bytebytego.com/guides/resiliency-patterns', 'https://bytebytego.com.evil.com/guides/x', '', ' https://bytebytego.com/guides/resiliency-patterns', 'HTTPS://bytebytego.com/guides/resiliency-patterns', 'https://bytebytego.com@evil.com/guides/x']) {
    assert.match(at(mut((r) => { r.guideUrl = u; }), 'guideUrl')[0].message, /Expected: a URL starting with https:\/\/bytebytego\.com\/guides\/\.$/, u);
  }
  for (const u of ['https://bytebytego.com/guides/resiliency-patterns/', 'https://bytebytego.com/guides/', 'https://bytebytego.com/guides/a b']) assert.match(at(mut((r) => { r.guideUrl = u; }), 'guideUrl')[0].message, /is not in the guide allow-list/);
  for (const v of [5, null, {}, ['https://bytebytego.com/guides/resiliency-patterns']]) bad(mut((r) => { r.guideUrl = v; }), 'guideUrl');
  for (const g of GUIDES) good(mut((r) => { r.guideUrl = g; }), 'guideUrl');
  const long = `https://example.com/${'x'.repeat(200)}`;
  const m = at(mut((r) => { r.guideUrl = long; }), 'guideUrl')[0].message;
  assert.ok(m.includes('...') && !m.includes(long) && m.includes('https://example.com/xxxxxxxxxxxxxxxxxxx') && m.length < 260);
  const sixty = 'https://bytebytego.com/guides/' + 'a'.repeat(30);
  assert.ok(!at(mut((r) => { r.guideUrl = sixty; }), 'guideUrl')[0].message.includes('...'), 'exactly 60 characters is not truncated');
  assert.ok(!at(mut((r) => { r.difficulty = 98765432; }), 'difficulty')[0].message.includes('98765432'));
  assert.ok(!at(mut((r) => { r.title = { secret: 'zzTOKENzz' }; }), 'title')[0].message.includes('zzTOKENzz'));
});

test('V11 topology: cycle message, directions, self loops, duplicates, counts, orphans, reachability', () => {
  const cyc = errs(mut((r) => { r.topology.edges.push({ from: 'service-1', to: 'service-2' }, { from: 'service-2', to: 'service-1' }); })).find((e) => /cycle/.test(e.message));
  assert.match(cyc.message, /^has a cycle through (service-1|service-2)\. Expected: edges that form a directed acyclic graph from clients\.$/);
  assert.equal(cyc.field, 'topology.edges');
  for (const edge of [{ from: 'cache', to: 'service-1' }, { from: 'service-1', to: 'clients' }, { from: 'clients', to: 'cache' }, { from: 'lb', to: 'db-primary' }, { from: 'third-party', to: 'db-primary' }]) {
    bad(mut((r) => { r.topology.edges.push(edge); }), 'topology.edges[7]');
  }
  bad(mut((r) => { r.topology.edges.push({ from: 'service-1', to: 'service-1' }); }), 'topology.edges[7]');
  bad(mut((r) => { r.topology.edges.push({ from: 'service-1', to: 'nope' }); }), 'topology.edges[7].to');
  bad(mut((r) => { r.topology.edges.push({ to: 'cache' }); }), 'topology.edges[7].from');
  bad(mut((r) => { r.topology.edges.push({ from: 'service-1', to: 'cache' }); }), 'topology.edges[7]');
  bad(mut((r) => { r.topology.edges.push({ from: 'db-replica', to: 'db-primary' }); }), 'topology.edges[7]');
  good(mut((r) => { r.topology.edges.push({ from: 'service-2', to: 'cache' }); }), 'topology.edges[7]');
  bad(mut((r) => { r.topology.nodes = { clients: r.topology.nodes.clients, lb: r.topology.nodes.lb }; r.topology.edges = [{ from: 'clients', to: 'lb' }]; }), 'topology.nodes');
  bad(mut((r) => { delete r.topology.nodes.clients; }), 'topology.nodes');
  bad(mut((r) => { r.topology.nodes['service-3'] = { capacity: 100 }; }), 'topology.nodes.service-3');
  assert.match(at(mut((r) => { r.topology.nodes['service-3'] = { capacity: 100 }; }), 'topology.nodes.service-3')[0].message, /^has no edges/);
  const unreachable = mut((r) => { r.topology.nodes['service-3'] = { capacity: 100 }; r.topology.nodes.queue = { capacity: 10, maxDepth: 5 }; r.topology.edges.push({ from: 'service-3', to: 'queue' }); });
  assert.match(at(unreachable, 'topology.nodes.service-3')[0].message, /^is not reachable from clients/);
  bad(mut((r) => { for (let i = 0; i < 8; i++) r.topology.edges.push({ from: 'service-1', to: 'third-party' }); }), 'topology.edges');
  bad(mut((r) => { r.topology.edges = []; }), 'topology.edges');
  bad(mut((r) => { r.topology = []; }), 'topology');
  bad(mut((r) => { r.topology.extra = 1; }), 'topology.extra');
  bad(mut((r) => { r.topology.nodes = []; }), 'topology.nodes');
  bad(mut((r) => { r.topology.edges = {}; }), 'topology.edges');
  bad(mut((r) => { r.topology.edges = [5]; }), 'topology.edges[0]');
  bad(mut((r) => { delete r.topology.edges; }), 'topology.edges');
  bad(mut((r) => { delete r.topology; }), 'topology');
  const fourteen = mut((r) => {
    r.topology.nodes['service-3'] = { capacity: 100 };
    r.topology.edges = [{ from: 'clients', to: 'lb' }, { from: 'lb', to: 'service-1' }, { from: 'lb', to: 'service-2' }, { from: 'lb', to: 'service-3' }, { from: 'service-1', to: 'cache' }, { from: 'service-2', to: 'cache' }, { from: 'service-3', to: 'cache' },
      { from: 'service-1', to: 'db-primary' }, { from: 'service-2', to: 'db-primary' }, { from: 'service-3', to: 'db-primary' }, { from: 'cache', to: 'db-primary' }, { from: 'service-1', to: 'third-party' }, { from: 'service-2', to: 'third-party' }, { from: 'db-primary', to: 'db-replica' }];
  });
  assert.equal(fourteen.ok, true, show(fourteen));
  assert.ok(at(mut((r) => { r.topology.edges.push({ from: 'service-3', to: 'third-party' }); r.topology.nodes['service-3'] = { capacity: 1 }; r.topology.edges.push(...Array.from({ length: 8 }, () => ({ from: 'lb', to: 'service-3' }))); }), 'topology.edges').length >= 1);
});

test('V12 parameter ranges, whitelist per type, required parameters and unknown node ids', () => {
  for (const [n, p, badV, goodV] of [['cache', 'hitRate', [1.5, -0.1, '0.5'], 0.5], ['lb', 'shed', [0.95, -1], 0.9], ['service-1', 'instances', [0, 65, 1.5], 64], ['db-primary', 'capacity', [0, 1000001], 1000000],
    ['service-1', 'timeoutMs', [49, 60001], 50], ['service-1', 'poolSize', [1001, 1.5], 0]]) {
    for (const v of badV) bad(mut((r) => { r.topology.nodes[n][p] = v; }), `topology.nodes.${n}.${p}`);
    good(mut((r) => { r.topology.nodes[n][p] = goodV; }), `topology.nodes.${n}.${p}`);
  }
  for (const [n, p] of [['lb', 'hitRate'], ['clients', 'capacity'], ['cache', 'shed'], ['lb', 'bogus'], ['cache', 'timeoutMs']]) bad(mut((r) => { r.topology.nodes[n][p] = 1; }), `topology.nodes.${n}.${p}`);
  for (const [n, p] of [['clients', 'rps'], ['lb', 'capacity'], ['cache', 'capacity']]) assert.match(at(mut((r) => { delete r.topology.nodes[n][p]; }), `topology.nodes.${n}.${p}`)[0].message, /^missing\. Expected: /);
  assert.match(at(mut((r) => { r.topology.nodes.queue = { capacity: 100 }; r.topology.edges.push({ from: 'service-1', to: 'queue' }); }), 'topology.nodes.queue.maxDepth')[0].message, /^missing\. Expected: an integer from 1 to 10000000\.$/);
  bad(mut((r) => { r.topology.nodes.nope = { capacity: 5 }; }), 'topology.nodes.nope');
  bad(mut((r) => { r.topology.nodes.lb = 5; }), 'topology.nodes.lb');
  bad(mut((r) => { r.topology.edges[1].retries = 6; }), 'topology.edges[1].retries');
  bad(mut((r) => { r.topology.edges[1].backoff = 'yes'; }), 'topology.edges[1].backoff');
  bad(mut((r) => { r.topology.edges[1].bogus = 1; }), 'topology.edges[1].bogus');
  good(mut((r) => { r.topology.edges[1].retries = 5; r.topology.edges[1].missOnly = false; }), 'topology.edges[1]');
  const proto = JSON.parse('{"capacity":10,"__proto__":{"hitRate":2}}');
  bad(mut((r) => { r.topology.nodes.cache = proto; }), 'topology.nodes.cache.__proto__');
});

test('V13 node ids must exist wherever they appear', () => {
  bad(mut((r) => { r.rootCauseNode = 'nope'; }), 'rootCauseNode');
  bad(mut((r) => { r.sparks.p99 = 'nope'; }), 'sparks.p99');
  bad(mut((r) => { r.labels = { nope: 'X' }; }), 'labels.nope');
  bad(mut((r) => { r.alerts[0].when = { node: 'nope', metric: 'p99', op: 'gt', value: 1 }; }), 'alerts[0].when.node');
  bad(mut((r) => { r.deploys = [{ tick: -2, node: 'nope', text: 'x' }]; }), 'deploys[0].node');
  bad(mut((r) => { r.logs.unshift({ node: 'nope', level: 'info', text: 'x' }); }), 'logs[0].node');
  bad(mut((r) => { r.actions['add-ttl-jitter'].effects.nope = [{ path: 'node:cache.hitRate', op: 'set', value: 0.9 }]; }), 'actions.add-ttl-jitter.effects.nope');
  bad(mut((r) => { r.optimalPath[0].node = 'nope'; }), 'optimalPath[0].node');
  bad(mut((r) => { delete r.rootCauseNode; r.rootCauseNode = 5; }), 'rootCauseNode');
});

test('labels are 1 to 24 characters', () => {
  good(mut((r) => { r.labels = { lb: 'x'.repeat(24) }; }), 'labels');
  bad(mut((r) => { r.labels = { lb: 'x'.repeat(25) }; }), 'labels.lb');
  bad(mut((r) => { r.labels = { lb: '' }; }), 'labels.lb');
  bad(mut((r) => { r.labels = []; }), 'labels');
});

const withEffects = (effects, node = 'cache') => (r) => { r.actions['add-ttl-jitter'] = { cost: 1, effects: { [node]: effects } }; };
const E = (o = {}) => ({ path: 'node:cache.hitRate', op: 'set', value: 0.95, ...o });

test('V14 effects: target type, whitelisted paths, ops, ramp 1..30, booleans only with set, at most 8 per target, cost 1..4', () => {
  bad(mut((r) => { r.actions['add-ttl-jitter'].effects.lb = [E({ path: 'node:lb.capFactor', value: 2 })]; }), 'actions.add-ttl-jitter.effects.lb');
  assert.match(at(mut((r) => { r.actions.failover = { effects: { cache: [E()] } }; }), 'actions.failover.effects.cache')[0].message, /Expected: a node of type db\.$/);
  assert.match(at(mut((r) => { r.actions['trace-request'] = { effects: { cache: [E()] } }; }), 'actions.trace-request.effects.cache')[0].message, /none \(this action has no target\)/);
  for (const path of ['node:cache.shed', 'node:cache.nope', 'node:nope.hitRate', 'cache.hitRate', 'node:cache', 'edge:cache>db-primary.nope', 'edge:cache>lb.retries', 'host:cache.hitRate', '', 5]) bad(mut(withEffects([E({ path })])), 'actions.add-ttl-jitter.effects.cache[0].path');
  bad(mut(withEffects([E({ op: 'div' })])), 'actions.add-ttl-jitter.effects.cache[0].op');
  bad(mut(withEffects([E({ extra: 1 })])), 'actions.add-ttl-jitter.effects.cache[0].extra');
  bad(mut(withEffects([5])), 'actions.add-ttl-jitter.effects.cache');
  good(mut(withEffects([E(), E({ path: 'node:cache.capFactor', op: 'mul', value: 1.1 }), E({ path: 'node:cache.capFactor', op: 'add', value: 0.1 }), E({ path: 'edge:cache>db-primary.retries', value: 2 })])), 'actions');
  for (const v of [1, 30]) good(mut(withEffects([E({ ramp: v })])), 'actions');
  for (const v of [0, 31, 1.5, '3', -1]) bad(mut(withEffects([E({ ramp: v })])), 'actions.add-ttl-jitter.effects.cache[0].ramp');
  bad(mut(withEffects([E({ op: 'add', value: true })])), 'actions.add-ttl-jitter.effects.cache[0].value');
  bad(mut(withEffects([E({ value: true })])), 'actions.add-ttl-jitter.effects.cache[0].value');
  bad(mut(withEffects([E({ value: 'x' })])), 'actions.add-ttl-jitter.effects.cache[0].value');
  bad(mut(withEffects([E({ value: NaN })])), 'actions.add-ttl-jitter.effects.cache[0].value');
  bad(mut(withEffects([{ path: 'edge:cache>db-primary.breaker', op: 'set', value: 1 }])), 'actions.add-ttl-jitter.effects.cache[0].value');
  bad(mut(withEffects([{ path: 'edge:cache>db-primary.breaker', op: 'set', value: true, ramp: 2 }])), 'actions.add-ttl-jitter.effects.cache[0].ramp');
  good(mut(withEffects([{ path: 'edge:cache>db-primary.breaker', op: 'set', value: true }])), 'actions');
  bad(mut(withEffects([E({ if: { tickGte: 'x' } })])), 'actions.add-ttl-jitter.effects.cache[0].if.tickGte');
  bad(mut(withEffects(Array.from({ length: 9 }, () => E()))), 'actions.add-ttl-jitter.effects.cache');
  good(mut(withEffects(Array.from({ length: 8 }, () => E()))), 'actions');
  bad(mut(withEffects([])), 'actions.add-ttl-jitter.effects.cache');
  for (const c of [0, 5, 1.5, '2']) bad(mut((r) => { r.actions['add-ttl-jitter'].cost = c; }), 'actions.add-ttl-jitter.cost');
  for (const c of [1, 4]) good(mut((r) => { r.actions['add-ttl-jitter'].cost = c; }), 'actions.add-ttl-jitter.cost');
  bad(mut((r) => { r.actions['scale-service'] = null; }), 'actions.scale-service');
  bad(mut((r) => { r.actions['scale-service'].extra = 1; }), 'actions.scale-service.extra');
  bad(mut((r) => { r.actions['scale-service'].effects = []; }), 'actions.scale-service.effects');
  bad(mut((r) => { r.actions = []; }), 'actions');
});

test('V15 conditions: grammar, depth and leaves are enforced everywhere a condition appears', () => {
  const leaves = (n) => ({ all: Array.from({ length: n }, () => ({ tickGte: 1 })) });
  good(mut((r) => { r.alerts[0].when = leaves(16); }), 'alerts[0].when');
  bad(mut((r) => { r.alerts[0].when = leaves(17); }), 'alerts[0].when');
  bad(mut((r) => { r.alerts[0].when = { not: { not: { not: { not: { tickGte: 1 } } } } }; }), 'alerts[0].when');
  bad(mut((r) => { r.alerts[0].when = { foo: 1 }; }), 'alerts[0].when');
  bad(mut((r) => { r.faults[0].trigger = { when: { fault: 'nope' } }; }), 'faults[0].trigger.when.fault');
  bad(mut((r) => { r.logs[0].when = { tickGte: -1 }; }), 'logs[0].when.tickGte');
  bad(mut((r) => { r.alerts[0].when = { path: 'node:cache.nope', op: 'gt', value: 1 }; }), 'alerts[0].when.path');
  const c = { tickGte: 1 };
  good(mut((r) => { r.resolve = { require: [c, c, c, c] }; }), 'resolve');
  bad(mut((r) => { r.resolve = { require: [c, c, c, c, c] }; }), 'resolve.require');
  bad(mut((r) => { r.resolve = { require: [{ x: 1 }] }; }), 'resolve.require[0]');
  bad(mut((r) => { r.resolve = { other: 1 }; }), 'resolve.other');
  bad(mut((r) => { r.resolve = 5; }), 'resolve');
});

test('V16 placeholders and text lengths', () => {
  const log = (text, extra = {}) => (r) => { r.logs.unshift({ node: 'cache', level: 'info', text, ...extra }); };
  for (const b of ['{nope}', '{m:nope.p99}', '{m:cache.nope}', '{m:cache.missRps|bad}', '{p:bogus}', '{rand:9-1}']) bad(mut(log(`x ${b} y`)), 'logs[0].text');
  for (const g of ['{tick}', '{m:cache.missRps|int}', '{m:lb.errorRate|pct}', '{m:lb.p99|ms}', '{m:cache.missRps}', '{rand:1-9}', '{p:node:cache.hitRate}', '<script>', 'plain']) good(mut(log(`x ${g} y`)), 'logs[0]');
  good(mut(log('a'.repeat(6000))), 'logs[0]');
  good(mut(log('a'.repeat(5000))), 'logs[0]');
  bad(mut(log('a'.repeat(6001))), 'logs[0].text');
  bad(mut(log('')), 'logs[0].text');
  bad(mut(log('x', { level: 'fatal' })), 'logs[0].level');
  bad(mut(log('x', { every: 0 })), 'logs[0].every');
  bad(mut(log('x', { every: 61 })), 'logs[0].every');
  good(mut(log('x', { every: 60, from: 5 })), 'logs[0]');
  bad(mut(log('x', { from: -1 })), 'logs[0].from');
  bad(mut(log('x', { extra: 1 })), 'logs[0].extra');
  bad(mut((r) => { r.logs.unshift(5); }), 'logs[0]');
  bad(mut((r) => { r.logs = Array.from({ length: 41 }, () => ({ node: 'cache', level: 'info', text: 'x' })); }), 'logs');
  good(mut((r) => { r.logs = Array.from({ length: 40 }, () => ({ node: 'cache', level: 'info', text: 'x' })); }), 'logs');
  good(mut((r) => { r.logs = []; }), 'logs');
  bad(mut((r) => { r.deploys = [{ tick: -2, node: 'service-1', text: 'a'.repeat(201) }]; }), 'deploys[0].text');
  good(mut((r) => { r.deploys = [{ tick: -2, node: 'service-1', text: 'a'.repeat(200) }]; }), 'deploys');
  bad(mut((r) => { r.deploys = Array.from({ length: 11 }, () => ({ tick: 0, node: 'lb', text: 'x' })); }), 'deploys');
  bad(mut((r) => { r.deploys = [{ node: 'lb', text: 'x' }]; }), 'deploys[0].tick');
  bad(mut((r) => { r.deploys = [{ tick: 1.5, node: 'lb', text: 'x' }]; }), 'deploys[0].tick');
  bad(mut((r) => { r.diagnostics = { 'trace-request': { lines: Array.from({ length: 11 }, () => 'x') } }; }), 'diagnostics.trace-request.lines');
  bad(mut((r) => { r.diagnostics = { 'trace-request': { lines: ['a'.repeat(301)] } }; }), 'diagnostics.trace-request.lines[0]');
  bad(mut((r) => { r.diagnostics = { 'trace-request': { lines: ['{nope}'] } }; }), 'diagnostics.trace-request.lines[0]');
  good(mut((r) => { r.diagnostics = { 'trace-request': { cost: 1, lines: ['a'.repeat(300), '{tick}'] } }; }), 'diagnostics');
  bad(mut((r) => { r.diagnostics = { 'trace-request': { cost: 5 } }; }), 'diagnostics.trace-request.cost');
  bad(mut((r) => { r.diagnostics = { inspect: { cost: 1 } }; }), 'diagnostics.inspect');
  bad(mut((r) => { r.diagnostics = { rollback: {} }; }), 'diagnostics.rollback');
  bad(mut((r) => { r.diagnostics = { 'trace-request': 5 }; }), 'diagnostics.trace-request');
  bad(mut((r) => { r.diagnostics = { 'trace-request': { other: 1 } }; }), 'diagnostics.trace-request.other');
});

test('V17 alerts, faults, workload', () => {
  const rule = (i, o = {}) => ({ id: `r${i}`, severity: 2, text: `rule ${i}`, when: { tickGte: 1 }, ...o });
  bad(mut((r) => { r.alerts = []; }), 'alerts');
  good(mut((r) => { r.alerts = Array.from({ length: 8 }, (_, i) => rule(i)); }), 'alerts');
  bad(mut((r) => { r.alerts = Array.from({ length: 9 }, (_, i) => rule(i)); }), 'alerts');
  bad(mut((r) => { r.alerts = [rule(0, { severity: 3 }), rule(1, { severity: 3 })]; }), 'alerts');
  good(mut((r) => { r.alerts = [rule(0, { severity: 1 })]; }), 'alerts');
  bad(mut((r) => { r.alerts = [rule(0), rule(0)]; }), 'alerts[1].id');
  bad(mut((r) => { r.alerts[0].id = 'Bad Id'; }), 'alerts[0].id');
  bad(mut((r) => { delete r.alerts[0].when; }), 'alerts[0].when');
  bad(mut((r) => { r.alerts[0].extra = 1; }), 'alerts[0].extra');
  bad(mut((r) => { r.alerts[0].text = ''; }), 'alerts[0].text');
  bad(mut((r) => { r.alerts = ['x']; }), 'alerts[0]');
  for (const sev of [0, 4, 1.5, '2']) bad(mut((r) => { r.alerts[0].severity = sev; }), 'alerts[0].severity');
  for (const f of [0, 31, 1.5]) bad(mut((r) => { r.alerts[0].forTicks = f; }), 'alerts[0].forTicks');
  for (const f of [1, 30]) good(mut((r) => { r.alerts[0].forTicks = f; }), 'alerts[0].forTicks');
  const fault = (i, trigger = { atTick: 4 }) => ({ id: `f${i}`, trigger, effects: [E({ path: 'node:cache.hitRate', value: 0.5 })] });
  bad(mut((r) => { r.faults = []; }), 'faults');
  good(mut((r) => { r.faults = Array.from({ length: 8 }, (_, i) => fault(i)); }), 'faults');
  bad(mut((r) => { r.faults = Array.from({ length: 9 }, (_, i) => fault(i)); }), 'faults');
  bad(mut((r) => { r.maxTicks = 100; r.faults = [fault(0, { atTick: 101 })]; }), 'faults[0].trigger.atTick');
  good(mut((r) => { r.maxTicks = 100; r.faults = [fault(0, { atTick: 100 })]; }), 'faults[0]');
  good(mut((r) => { r.faults = [fault(0, { atTick: 0 })]; }), 'faults[0]');
  bad(mut((r) => { r.faults = [fault(0, { atTick: -1 })]; }), 'faults[0].trigger.atTick');
  good(mut((r) => { r.faults = [fault(0, { when: { tickGte: 10 } })]; }), 'faults[0]');
  for (const t of [{}, { atTick: 1, when: { tickGte: 1 } }, { atTick: 1, other: 1 }, 5]) bad(mut((r) => { r.faults = [fault(0, t)]; }), 'faults[0].trigger');
  bad(mut((r) => { r.faults = [{ id: 'f', trigger: { atTick: 4 } }]; }), 'faults[0].effects');
  bad(mut((r) => { r.faults = [fault(0), fault(0)]; }), 'faults[1].id');
  bad(mut((r) => { r.faults = [{ ...fault(0), id: '' }]; }), 'faults[0].id');
  bad(mut((r) => { r.faults = [{ ...fault(0), extra: 1 }]; }), 'faults[0].extra');
  bad(mut((r) => { r.faults = [5]; }), 'faults[0]');
  good(mut((r) => { r.faults = [{ id: 'a', trigger: { atTick: 1 }, effects: [E()] }, { id: 'b', trigger: { when: { fault: 'a' } }, effects: [E()] }]; }), 'faults');
  const w = (list) => mut((r) => { r.workload = list; });
  good(w([[0, 1], [10, 2]]), 'workload');
  good(w([[0, 0], [10, 20]]), 'workload');
  for (const b of [[[0, 1], [0, 2]], [[0, 1], [5, 2], [3, 1]], [[1, 1], [5, 2]], [[0, 21]], [[0, -1]], [], [[0, 1], [5]], [['0', 1]], 'x', [[0, 1.5, 3]], [[0.5, 1]]]) bad(w(b), 'workload');
  bad(w(Array.from({ length: 33 }, (_, i) => [i, 1])), 'workload');
  good(w(Array.from({ length: 32 }, (_, i) => [i, 1])), 'workload');
  good(mut((r) => { r.thresholds = { saturation: { warn: 0.5, crit: 0.8 }, hitRate: { warn: 0.8, crit: 0.5 } }; }), 'thresholds');
  for (const t of [{ saturation: { warn: 0.9, crit: 0.8 } }, { hitRate: { warn: 0.5, crit: 0.8 } }, { nope: { warn: 1, crit: 2 } }, { saturation: { warn: 1 } }, { saturation: { warn: 1, crit: 2, x: 3 } }, { saturation: 5 }, 5]) bad(mut((r) => { r.thresholds = t; }), 'thresholds');
});

test('V18 optimalPath cost within budget; harmfulWhy keys are fix ids; sparks shape', () => {
  bad(mut((r) => { r.budget = 3; r.actions['add-ttl-jitter'].cost = 4; }), 'optimalPath');
  good(mut((r) => { r.budget = 4; r.actions['add-ttl-jitter'].cost = 4; }), 'optimalPath');
  bad(mut((r) => { delete r.actions['add-ttl-jitter'].cost; r.optimalPath = [{ id: 'add-ttl-jitter', node: 'cache' }, { id: 'scale-service', node: 'service-1' }]; r.budget = 3; delete r.actions['scale-service'].cost; }), 'optimalPath');
  good(mut((r) => { delete r.actions['add-ttl-jitter'].cost; r.optimalPath = [{ id: 'add-ttl-jitter', node: 'cache' }, { id: 'scale-service', node: 'service-1' }]; r.budget = 4; delete r.actions['scale-service'].cost; }), 'optimalPath');
  for (const key of ['inspect', 'tail-logs', 'nope']) bad(mut((r) => { r.harmfulWhy[key] = 'because'; }), `harmfulWhy.${key}`);
  good(mut((r) => { r.harmfulWhy['scale-service'] = 'a'.repeat(600); }), 'harmfulWhy');
  bad(mut((r) => { r.harmfulWhy['scale-service'] = 'a'.repeat(601); }), 'harmfulWhy.scale-service');
  bad(mut((r) => { r.harmfulWhy['scale-service'] = ''; }), 'harmfulWhy.scale-service');
  good(mut((r) => { r.harmfulWhy = {}; }), 'harmfulWhy');
  bad(mut((r) => { r.harmfulWhy = []; }), 'harmfulWhy');
  bad(mut((r) => { delete r.sparks.queue; }), 'sparks');
  bad(mut((r) => { r.sparks.extra = 'lb'; }), 'sparks');
  bad(mut((r) => { r.sparks.errors = 'nope'; }), 'sparks.errors');
  bad(mut((r) => { r.sparks.errors = 5; }), 'sparks.errors');
  bad(mut((r) => { r.sparks['cache-hit'] = 'lb'; }), 'sparks.cache-hit');
  bad(mut((r) => { r.sparks = []; }), 'sparks');
  good(mut((r) => { r.sparks.queue = null; r.sparks['cache-hit'] = null; }), 'sparks');
  good(mut((r) => { r.sparks.errors = 'lb'; }), 'sparks');
});

test('V19 optimalSummary shape', () => {
  assert.match(at(mut((r) => { delete r.optimalSummary; }), 'optimalSummary')[0].message, /^missing\. Expected: /);
  for (const b of [{ timeToMitigate: 1.5, cost: 2 }, { timeToMitigate: 35 }, { cost: 1 }, { timeToMitigate: '35', cost: 1 }, 35, null, [], { timeToMitigate: 35, cost: 1.5 }, { timeToMitigate: 0, cost: 1 }, { timeToMitigate: 611, cost: 1 }, { timeToMitigate: 5, cost: 1, x: 1 }]) bad(mut((r) => { r.optimalSummary = b; }), 'optimalSummary');
  good(mut((r) => { r.optimalSummary = { timeToMitigate: 35, cost: 1 }; }), 'optimalSummary');
  good(mut((r) => { r.optimalSummary = { timeToMitigate: 610, cost: 0 }; }), 'optimalSummary');
});

test('validate never throws, reports (file) for non-objects, collects at most 10 errors in schema order', () => {
  for (const v of [[], null, 5, 'text', true, undefined, 1.5, [{ id: 'x' }]]) {
    assert.deepEqual(validate(v, 'a.json'), { ok: false, errors: [{ file: 'a.json', field: '(file)', message: 'is not a JSON object. Expected: an object with the scenario fields.' }] });
  }
  const res = mut((r) => { r.difficulty = 9; r.budget = 99; r.seed = -1; r.maxTicks = 5; r.holdTicks = 99; r.escalateEvery = 999; r.title = ''; r.summary = ''; r.hint = ''; r.rootCause = ''; r.concept = ''; r.guideTitle = ''; r.bonus = 1; });
  assert.equal(res.errors.length, 10);
  assert.equal(res.errors[0].field, 'bonus', 'unknown keys come first');
  assert.deepEqual(res.errors.slice(1).map((e) => e.field), ['title', 'difficulty', 'summary', 'budget', 'seed', 'maxTicks', 'holdTicks', 'escalateEvery', 'hint']);
  const hostile = JSON.parse('{"__proto__":{"polluted":true},"constructor":{"prototype":{"x":1}},"id":"a"}');
  assert.equal(validate(hostile, 'a.json').ok, false);
  assert.equal(({}).polluted, undefined);
  for (const weird of [{ alerts: [null, 5, 'x', []] }, { faults: [{}], logs: [[]], workload: [null] }, { topology: { nodes: [], edges: {} } }, { actions: { 'scale-service': null } }, { sparks: null }, { thresholds: [] }]) {
    const r = rawFixture();
    Object.assign(r, weird);
    assert.equal(validate(r, FILE).ok, false, JSON.stringify(Object.keys(weird)));
  }
  const throwing = rawFixture();
  Object.defineProperty(throwing, 'title', { get() { throw new Error('boom'); }, enumerable: true });
  assert.deepEqual(validate(throwing, FILE).errors[0].field, '(file)');
});

test('a prototype-less object (as parseSafe returns) validates the same as a plain one', () => {
  const rebuild = (v) => (Array.isArray(v) ? v.map(rebuild) : v && typeof v === 'object' ? Object.assign(Object.create(null), Object.fromEntries(Object.entries(v).map(([k, x]) => [k, rebuild(x)]))) : v);
  const res = validate(rebuild(rawFixture()), FILE);
  assert.equal(res.ok, true, show(res));
});
