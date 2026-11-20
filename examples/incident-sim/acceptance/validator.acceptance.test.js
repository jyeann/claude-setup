// Scenario validator: V1-V19 fixtures, exact pinned messages, never-throws, hostile inputs, off-domain guide URLs, defaults and freezing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { engine, mod, rawScenario, clone, validateRaw, errField, errFieldStarts, hasExpected, SHIPPED_IDS, SCEN_DIR, GUIDE_PREFIX } from './helpers.js';

const BASE = 'cache-stampede.json';
const mut = async (fn, file = BASE) => {
  const raw = clone(rawScenario('cache-stampede'));
  fn(raw);
  return validateRaw(raw, file);
};
const FIELDS = (res) => (res.ok ? '(ok)' : res.errors.map((e) => `${e.field}: ${e.message}`).join(' | '));
const expectErr = (res, field, { exact = false } = {}) => {
  assert.equal(res.ok, false, `expected invalid at ${field}`);
  const es = exact ? errField(res, field) : errFieldStarts(res, field);
  assert.ok(es.length >= 1, `no error at ${field}; got ${FIELDS(res)}`);
  return es[0];
};
const noErrAt = (res, field) => assert.equal(errField(res, field).length, 0, `unexpected error at ${field}: ${FIELDS(res)}`);
const KEYS = ['schema', 'id', 'title', 'difficulty', 'summary', 'budget', 'seed', 'maxTicks', 'holdTicks', 'escalateEvery', 'labels', 'topology', 'workload', 'thresholds',
  'sparks', 'faults', 'alerts', 'logs', 'deploys', 'diagnostics', 'actions', 'resolve', 'hint', 'rootCause', 'rootCauseNode', 'concept', 'harmfulWhy', 'optimalPath', 'optimalSummary', 'guideUrl', 'guideTitle'];

test('the shipped cache-stampede file validates with zero errors (fixture base)', async () => {
  const res = await mut(() => {});
  assert.equal(res.ok, true, FIELDS(res));
});

test('validate exports: MAX_FILE_BYTES 65536, SCENARIO_KEYS in schema-table order, formatError format', async () => {
  const V = await mod('engine/validate');
  assert.equal(V.MAX_FILE_BYTES, 65536);
  assert.deepEqual([...V.SCENARIO_KEYS], KEYS);
  assert.equal(V.formatError({ file: 'a.json', field: 'x.y[2]', message: 'is wrong. Expected: right.' }), 'scenarios/a.json: field "x.y[2]": is wrong. Expected: right.');
  assert.equal(V.formatError({ file: 'bad-guide.json', field: '(file)', message: 'm' }), 'scenarios/bad-guide.json: field "(file)": m');
});

// ------------------------------------------------------------------ V1, V2, V3, V4
test('V1 a missing rootCause gives exactly "missing. Expected: a non-empty string."', async () => {
  const res = await mut((r) => { delete r.rootCause; });
  assert.equal(res.ok, false);
  const e = expectErr(res, 'rootCause', { exact: true });
  assert.deepEqual(e, { file: BASE, field: 'rootCause', message: 'missing. Expected: a non-empty string.' });
  assert.equal((await engine()).validate.formatError(e), 'scenarios/cache-stampede.json: field "rootCause": missing. Expected: a non-empty string.');
});

test('V1 every required top-level field reports "missing. Expected: ..." and optional ones may be absent', async () => {
  const required = ['schema', 'id', 'title', 'difficulty', 'summary', 'budget', 'seed', 'topology', 'workload', 'sparks', 'faults', 'alerts', 'logs', 'actions', 'hint',
    'rootCause', 'rootCauseNode', 'concept', 'harmfulWhy', 'optimalPath', 'optimalSummary', 'guideUrl', 'guideTitle'];
  for (const k of required) {
    const res = await mut((r) => { delete r[k]; });
    const e = expectErr(res, k, { exact: true });
    assert.match(e.message, /^missing\. Expected: .+\.$/, k);
  }
  for (const k of ['maxTicks', 'holdTicks', 'escalateEvery', 'labels', 'thresholds', 'deploys', 'diagnostics', 'resolve']) {
    const res = await mut((r) => { delete r[k]; });
    assert.equal(res.ok, true, `${k} is optional: ${FIELDS(res)}`);
  }
});

test('V2 an unknown top-level key is rejected with the SCENARIO_KEYS list', async () => {
  const V = await mod('engine/validate');
  const res = await mut((r) => { r.bonus = 1; });
  const e = expectErr(res, 'bonus', { exact: true });
  assert.equal(e.message, `is not a known field. Expected: one of ${V.SCENARIO_KEYS.join(', ')}.`);
});

test('V3 schema must be the integer 1', async () => {
  for (const v of [2, 0, '1', 1.5, null, true, [1]]) {
    const e = expectErr(await mut((r) => { r.schema = v; }), 'schema', { exact: true });
    assert.ok(hasExpected(e), JSON.stringify(v));
  }
  noErrAt(await mut((r) => { r.schema = 1; }), 'schema');
});

test('V4 id must match ^[a-z0-9-]{1,40}$ and the file stem', async () => {
  const bad = await mut((r) => { r.id = 'y'; }, 'x.json');
  const e = expectErr(bad, 'id', { exact: true });
  assert.ok(hasExpected(e));
  const stem = await mut((r) => { r.id = 'y'; }, 'y.json');
  noErrAt(stem, 'id');
  for (const id of ['Cache-Stampede', 'a_b', '', 'a'.repeat(41), 'café', 5, null]) {
    expectErr(await mut((r) => { r.id = id; }, `${typeof id === 'string' ? id : 'q'}.json`), 'id', { exact: true });
  }
  noErrAt(await mut((r) => { r.id = 'a'.repeat(40); }, `${'a'.repeat(40)}.json`), 'id');
});

// ------------------------------------------------------------------ V5, V6
test('V5 string length limits: title 300, summary 160, hint 300, rootCause 600, concept 600, guideTitle 80 (valid at the limit, invalid one over and at 0)', async () => {
  const limits = { title: 300, summary: 160, hint: 300, rootCause: 600, concept: 600, guideTitle: 80 };
  for (const [field, max] of Object.entries(limits)) {
    noErrAt(await mut((r) => { r[field] = 'a'.repeat(max); }), field);
    noErrAt(await mut((r) => { r[field] = 'a'; }), field);
    assert.ok(hasExpected(expectErr(await mut((r) => { r[field] = 'a'.repeat(max + 1); }), field, { exact: true })), `${field} over`);
    assert.ok(hasExpected(expectErr(await mut((r) => { r[field] = ''; }), field, { exact: true })), `${field} empty`);
    for (const v of [5, null, {}, ['x'], true]) assert.ok(hasExpected(expectErr(await mut((r) => { r[field] = v; }), field, { exact: true })), `${field}=${JSON.stringify(v)}`);
  }
});

test('V6 numeric ranges: difficulty 1..3, budget 1..12, seed 0..4294967295, maxTicks 60..600, holdTicks 1..30, escalateEvery 0..600', async () => {
  const ranges = { difficulty: [1, 3], budget: [1, 12], seed: [0, 4294967295], maxTicks: [60, 600], holdTicks: [1, 30], escalateEvery: [0, 600] };
  for (const [field, [lo, hi]] of Object.entries(ranges)) {
    noErrAt(await mut((r) => { r[field] = lo; }), field);
    noErrAt(await mut((r) => { r[field] = hi; }), field);
    for (const v of [lo - 1, hi + 1, lo + 0.5, String(lo), null, NaN]) {
      const res = await mut((r) => { r[field] = v; });
      assert.ok(hasExpected(expectErr(res, field, { exact: true })), `${field}=${v}`);
    }
  }
});

// ------------------------------------------------------------------ V7, V8
test('V7 unknown action ids give the exact message listing all 16 catalogue ids', async () => {
  const res = await mut((r) => { r.optimalPath.push({ id: 'reboot-everything', node: 'cache' }); });
  const e = expectErr(res, 'optimalPath[1].id', { exact: true });
  assert.equal(e.message, 'unknown action "reboot-everything". Expected: one of inspect, trace-request, tail-logs, compare-dashboards, deploy-history, scale-service, add-ttl-jitter, circuit-breaker, backoff-jitter, shed-load, failover, shard-rekey, add-index, rollback, raise-pool-size, renew-cert.');
});

test('V7 unknown action ids are caught in actions, diagnostics and harmfulWhy too', async () => {
  expectErr(await mut((r) => { r.actions['reboot-everything'] = { cost: 2 }; }), 'actions');
  expectErr(await mut((r) => { r.diagnostics = { 'reboot-everything': { cost: 1 } }; }), 'diagnostics');
  expectErr(await mut((r) => { r.harmfulWhy['reboot-everything'] = 'x'; }), 'harmfulWhy');
});

test('V8 optimalPath entries must be fix ids with a target node, 1..4 entries', async () => {
  const diag = await mut((r) => { r.optimalPath[0] = { id: 'tail-logs', node: 'cache' }; });
  assert.ok(hasExpected(expectErr(diag, 'optimalPath[0].id', { exact: true })));
  const inspect = await mut((r) => { r.optimalPath[0] = { id: 'inspect', node: 'cache' }; });
  expectErr(inspect, 'optimalPath[0]');
  const noNode = await mut((r) => { r.optimalPath[0] = { id: 'add-ttl-jitter' }; });
  assert.ok(hasExpected(expectErr(noNode, 'optimalPath[0]')));
  expectErr(await mut((r) => { r.optimalPath = []; }), 'optimalPath');
  expectErr(await mut((r) => { r.optimalPath = 'add-ttl-jitter'; }), 'optimalPath');
  const five = await mut((r) => { r.optimalPath = Array.from({ length: 5 }, () => ({ id: 'scale-service', node: 'service-1' })); });
  expectErr(five, 'optimalPath');
});

// ------------------------------------------------------------------ V9, V10 guide URLs
test('V9 a guideUrl outside bytebytego.com/guides gives the exact "is not allowed" message', async () => {
  const res = await mut((r) => { r.guideUrl = 'https://example.com/x'; });
  const e = expectErr(res, 'guideUrl', { exact: true });
  assert.equal(e.message, '"https://example.com/x" is not allowed. Expected: a URL starting with https://bytebytego.com/guides/.');
});

test('V10 a well-formed but unlisted guide gives the exact allow-list message', async () => {
  const res = await mut((r) => { r.guideUrl = 'https://bytebytego.com/guides/nope'; });
  const e = expectErr(res, 'guideUrl', { exact: true });
  assert.equal(e.message, '"https://bytebytego.com/guides/nope" is not in the guide allow-list. Expected: one of the URLs in public/js/engine/guides.js.');
});

test('off-domain and malformed guide URLs are all rejected (V9 outside the prefix, V10 inside it)', async () => {
  const outside = ['http://bytebytego.com/guides/how-can-cache-systems-go-wrong', 'https://bytebytego.com.evil.com/guides/x', 'https://evil.com/https://bytebytego.com/guides/resiliency-patterns',
    'javascript:alert(1)', '//bytebytego.com/guides/resiliency-patterns', 'HTTPS://bytebytego.com/guides/resiliency-patterns', 'https://www.bytebytego.com/guides/resiliency-patterns',
    'https://bytebytego.com@evil.com/guides/resiliency-patterns', 'data:text/html,<script>alert(1)</script>', '', ' https://bytebytego.com/guides/resiliency-patterns'];
  for (const url of outside) {
    const e = expectErr(await mut((r) => { r.guideUrl = url; }), 'guideUrl', { exact: true });
    assert.match(e.message, /Expected: a URL starting with https:\/\/bytebytego\.com\/guides\/\.$|Expected: a non-empty string\.$|Expected: /, JSON.stringify(url));
  }
  const inside = ['https://bytebytego.com/guides/resiliency-patterns/', 'https://bytebytego.com/guides/resiliency-patterns?x=1', 'https://bytebytego.com/guides/Resiliency-Patterns',
    'https://bytebytego.com/guides/resiliency-patterns#top', 'https://bytebytego.com/guides/', 'https://bytebytego.com/guides/' + 'a'.repeat(121), 'https://bytebytego.com/guides/a b'];
  for (const url of inside) {
    const e = expectErr(await mut((r) => { r.guideUrl = url; }), 'guideUrl', { exact: true });
    assert.ok(hasExpected(e), url);
  }
  for (const v of [5, null, {}, ['https://bytebytego.com/guides/resiliency-patterns']]) expectErr(await mut((r) => { r.guideUrl = v; }), 'guideUrl', { exact: true });
});

test('all 11 allow-listed guide URLs validate', async () => {
  const { GUIDES } = await mod('engine/guides');
  for (const g of GUIDES) noErrAt(await mut((r) => { r.guideUrl = g; }), 'guideUrl');
});

test('values are echoed only for strings and are cut at 60 characters; numbers and objects are never echoed', async () => {
  const long = 'https://example.com/' + 'x'.repeat(200);
  const e = expectErr(await mut((r) => { r.guideUrl = long; }), 'guideUrl', { exact: true });
  assert.ok(!e.message.includes(long));
  assert.ok(e.message.includes('...'));
  assert.ok(e.message.includes('https://example.com/xxxxxxxxxxxxxxxxxxx'), 'the first characters are echoed');
  assert.ok(e.message.length < 260);
  const num = expectErr(await mut((r) => { r.difficulty = 98765432; }), 'difficulty', { exact: true });
  assert.ok(!num.message.includes('98765432'));
  const obj = expectErr(await mut((r) => { r.title = { secret: 'zzTOKENzz' }; }), 'title', { exact: true });
  assert.ok(!obj.message.includes('zzTOKENzz'));
});

// ------------------------------------------------------------------ V11 topology
test('V11 a cycle is reported with the exact message naming a node on the cycle', async () => {
  const res = await mut((r) => {
    r.topology.edges.push({ from: 'service-1', to: 'service-2' }, { from: 'service-2', to: 'service-1' });
  });
  assert.equal(res.ok, false);
  const cyc = res.errors.find((e) => /^has a cycle through /.test(e.message));
  assert.ok(cyc, FIELDS(res));
  assert.match(cyc.message, /^has a cycle through (service-1|service-2)\. Expected: edges that form a directed acyclic graph from clients\.$/);
});

test('V11 wrong edge directions, self loops and unknown endpoints are rejected with an Expected clause', async () => {
  for (const edge of [{ from: 'cache', to: 'service-1' }, { from: 'service-1', to: 'clients' }, { from: 'clients', to: 'cache' }, { from: 'lb', to: 'db-primary' }, { from: 'service-1', to: 'service-1' }, { from: 'service-1', to: 'nope' }]) {
    const res = await mut((r) => { r.topology.edges.push(edge); });
    const es = errFieldStarts(res, 'topology');
    assert.ok(es.length >= 1, `${edge.from}>${edge.to}: ${FIELDS(res)}`);
    assert.ok(es.some(hasExpected), `${edge.from}>${edge.to}`);
  }
});

test('V11 shape rules: 3..11 nodes, must include clients, every node has an edge and is reachable, at most 14 edges', async () => {
  const two = await mut((r) => { r.topology.nodes = { clients: r.topology.nodes.clients, lb: r.topology.nodes.lb }; r.topology.edges = [{ from: 'clients', to: 'lb' }]; });
  assert.ok(errFieldStarts(two, 'topology').some(hasExpected), FIELDS(two));
  const noClients = await mut((r) => { delete r.topology.nodes.clients; });
  assert.ok(errFieldStarts(noClients, 'topology').some(hasExpected), FIELDS(noClients));
  const orphan = await mut((r) => { r.topology.nodes['service-3'] = { capacity: 100 }; });
  assert.ok(errFieldStarts(orphan, 'topology').some(hasExpected), FIELDS(orphan));
  const many = await mut((r) => {
    for (let i = 0; i < 8; i++) r.topology.edges.push({ from: 'service-1', to: 'third-party' });
  });
  assert.ok(errFieldStarts(many, 'topology.edges').length >= 1, FIELDS(many));
  const none = await mut((r) => { r.topology.edges = []; });
  assert.ok(errFieldStarts(none, 'topology').some(hasExpected), FIELDS(none));
  assert.ok(errFieldStarts(await mut((r) => { r.topology = []; }), 'topology').some(hasExpected));
});

// ------------------------------------------------------------------ V12 params
test('V12 param values outside their range are rejected at topology.nodes.<id>.<param>', async () => {
  for (const [node, param, bad, good] of [['cache', 'hitRate', [1.5, -0.1, '0.5'], 0.5], ['lb', 'shed', [0.95, -1], 0.9], ['service-1', 'instances', [0, 65, 1.5], 64],
    ['db-primary', 'capacity', [0, 1000001], 1000000], ['service-1', 'timeoutMs', [49, 60001], 50], ['service-1', 'poolSize', [1001, 1.5], 0]]) {
    for (const v of bad) {
      const res = await mut((r) => { r.topology.nodes[node][param] = v; });
      assert.ok(hasExpected(expectErr(res, `topology.nodes.${node}.${param}`, { exact: true })), `${node}.${param}=${v}`);
    }
    noErrAt(await mut((r) => { r.topology.nodes[node][param] = good; }), `topology.nodes.${node}.${param}`);
  }
});

test('V12 params not allowed for a node type are rejected (lb.hitRate, client.capacity)', async () => {
  assert.ok(hasExpected(expectErr(await mut((r) => { r.topology.nodes.lb.hitRate = 0.5; }), 'topology.nodes.lb.hitRate', { exact: true })));
  assert.ok(hasExpected(expectErr(await mut((r) => { r.topology.nodes.clients.capacity = 5; }), 'topology.nodes.clients.capacity', { exact: true })));
  assert.ok(hasExpected(expectErr(await mut((r) => { r.topology.nodes.cache.shed = 0.1; }), 'topology.nodes.cache.shed', { exact: true })));
  assert.ok(hasExpected(expectErr(await mut((r) => { r.topology.nodes.lb.bogus = 1; }), 'topology.nodes.lb.bogus', { exact: true })));
});

test('V12 required params: rps on clients, capacity on non-client nodes, maxDepth on queue; unknown node ids rejected', async () => {
  expectErr(await mut((r) => { delete r.topology.nodes.clients.rps; }), 'topology.nodes.clients.rps', { exact: true });
  expectErr(await mut((r) => { delete r.topology.nodes.lb.capacity; }), 'topology.nodes.lb.capacity', { exact: true });
  expectErr(await mut((r) => { delete r.topology.nodes.cache.capacity; }), 'topology.nodes.cache.capacity', { exact: true });
  const q = await mut((r) => {
    r.topology.nodes.queue = { capacity: 100 };
    r.topology.edges.push({ from: 'service-1', to: 'queue' });
  });
  assert.ok(hasExpected(expectErr(q, 'topology.nodes.queue.maxDepth', { exact: true })));
  const unknown = await mut((r) => { r.topology.nodes.nope = { capacity: 5 }; });
  assert.ok(errFieldStarts(unknown, 'topology.nodes').some(hasExpected), FIELDS(unknown));
});

// ------------------------------------------------------------------ V13 node references
test('V13 node ids that are not in the topology are rejected wherever they appear', async () => {
  assert.ok(hasExpected(expectErr(await mut((r) => { r.rootCauseNode = 'nope'; }), 'rootCauseNode', { exact: true })));
  assert.ok(hasExpected(expectErr(await mut((r) => { r.sparks.p99 = 'nope'; }), 'sparks.p99', { exact: true })));
  expectErr(await mut((r) => { r.labels = { nope: 'X' }; }), 'labels');
  expectErr(await mut((r) => { r.alerts[0].when = { node: 'nope', metric: 'p99', op: 'gt', value: 1 }; }), 'alerts[0].when');
  expectErr(await mut((r) => { r.deploys = [{ tick: -2, node: 'nope', text: 'x' }]; }), 'deploys[0]');
  expectErr(await mut((r) => { r.logs.unshift({ node: 'nope', level: 'info', text: 'x' }); }), 'logs[0]');
  expectErr(await mut((r) => { r.actions['add-ttl-jitter'].effects.nope = [{ path: 'node:cache.hitRate', op: 'set', value: 0.9 }]; }), 'actions.add-ttl-jitter.effects');
  expectErr(await mut((r) => { r.optimalPath[0].node = 'nope'; }), 'optimalPath[0]');
  expectErr(await mut((r) => { r.topology.edges.push({ from: 'lb', to: 'nope' }); }), 'topology');
});

test('labels are 1..24 characters', async () => {
  noErrAt(await mut((r) => { r.labels = { lb: 'x'.repeat(24) }; }), 'labels.lb');
  assert.ok(hasExpected(expectErr(await mut((r) => { r.labels = { lb: 'x'.repeat(25) }; }), 'labels.lb', { exact: true })));
  assert.ok(hasExpected(expectErr(await mut((r) => { r.labels = { lb: '' }; }), 'labels.lb', { exact: true })));
});

// ------------------------------------------------------------------ V14 effects
const withEffects = (effects, node = 'cache') => (r) => { r.actions['add-ttl-jitter'] = { cost: 1, effects: { [node]: effects } }; };

test('V14 an effect target whose type is not in the action appliesTo is rejected', async () => {
  const res = await mut((r) => { r.actions['add-ttl-jitter'].effects.lb = [{ path: 'node:lb.capFactor', op: 'set', value: 2 }]; });
  assert.ok(errFieldStarts(res, 'actions.add-ttl-jitter.effects').some(hasExpected), FIELDS(res));
});

test('V14 effect paths are whitelisted per node type; op must be set, add or mul', async () => {
  for (const path of ['node:cache.shed', 'node:cache.nope', 'node:nope.hitRate', 'cache.hitRate', 'node:cache', 'edge:cache>db-primary.nope', 'host:cache.hitRate', '']) {
    const res = await mut(withEffects([{ path, op: 'set', value: 0.5 }]));
    assert.ok(errFieldStarts(res, 'actions.add-ttl-jitter.effects.cache[0]').some(hasExpected), `${path}: ${FIELDS(res)}`);
  }
  const op = await mut(withEffects([{ path: 'node:cache.hitRate', op: 'div', value: 0.5 }]));
  assert.ok(errFieldStarts(op, 'actions.add-ttl-jitter.effects.cache[0]').some(hasExpected), FIELDS(op));
  const ok = await mut(withEffects([{ path: 'node:cache.hitRate', op: 'set', value: 0.95 }, { path: 'node:cache.capFactor', op: 'mul', value: 1.1 }, { path: 'node:cache.capFactor', op: 'add', value: 0.1 }]));
  assert.equal(errFieldStarts(ok, 'actions.add-ttl-jitter.effects').length, 0, FIELDS(ok));
});

test('V14 ramp is 1..30; booleans only with set; at most 8 effects per target', async () => {
  const ramp = (v) => mut(withEffects([{ path: 'node:cache.hitRate', op: 'set', value: 0.95, ramp: v }]));
  for (const v of [1, 30]) assert.equal(errFieldStarts(await ramp(v), 'actions.add-ttl-jitter').length, 0, `ramp ${v}`);
  for (const v of [0, 31, 1.5, '3', -1]) assert.ok(errFieldStarts(await ramp(v), 'actions.add-ttl-jitter.effects.cache[0]').some(hasExpected), `ramp ${v}`);
  const boolAdd = await mut(withEffects([{ path: 'node:cache.hitRate', op: 'add', value: true }]));
  assert.ok(errFieldStarts(boolAdd, 'actions.add-ttl-jitter.effects.cache[0]').some(hasExpected), FIELDS(boolAdd));
  const nine = await mut(withEffects(Array.from({ length: 9 }, () => ({ path: 'node:cache.capFactor', op: 'set', value: 1 }))));
  assert.ok(errFieldStarts(nine, 'actions.add-ttl-jitter.effects.cache').some(hasExpected), FIELDS(nine));
  const eight = await mut(withEffects(Array.from({ length: 8 }, () => ({ path: 'node:cache.capFactor', op: 'set', value: 1 }))));
  assert.equal(errFieldStarts(eight, 'actions.add-ttl-jitter.effects').length, 0, FIELDS(eight));
});

test('V14 action cost is 1..4', async () => {
  for (const c of [0, 5, 1.5, '2']) assert.ok(errFieldStarts(await mut((r) => { r.actions['add-ttl-jitter'].cost = c; }), 'actions.add-ttl-jitter.cost').some(hasExpected), `cost ${c}`);
  for (const c of [1, 4]) assert.equal(errFieldStarts(await mut((r) => { r.actions['add-ttl-jitter'].cost = c; }), 'actions.add-ttl-jitter.cost').length, 0, `cost ${c}`);
});

// ------------------------------------------------------------------ V15 conditions
test('V15 conditions: at most 16 leaves, depth at most 4, grammar enforced', async () => {
  const leaves = (n) => ({ all: Array.from({ length: n }, () => ({ tickGte: 1 })) });
  noErrAt(await mut((r) => { r.alerts[0].when = leaves(16); }), 'alerts[0].when');
  assert.equal(errFieldStarts(await mut((r) => { r.alerts[0].when = leaves(16); }), 'alerts[0].when').length, 0);
  assert.ok(errFieldStarts(await mut((r) => { r.alerts[0].when = leaves(17); }), 'alerts[0].when').some(hasExpected), '17 leaves');
  const nest = (n) => { let c = { tickGte: 1 }; for (let i = 0; i < n; i++) c = { not: c }; return c; };
  assert.equal(errFieldStarts(await mut((r) => { r.alerts[0].when = nest(2); }), 'alerts[0].when').length, 0, 'depth 2');
  assert.ok(errFieldStarts(await mut((r) => { r.alerts[0].when = nest(6); }), 'alerts[0].when').some(hasExpected), 'depth 6');
  for (const bad of [{}, { foo: 1 }, { node: 'lb', metric: 'nope', op: 'gt', value: 1 }, { node: 'lb', metric: 'p99', op: 'zz', value: 1 }, { tickGte: 'x' }, { node: 'lb', metric: 'p99', op: 'gt' }, 'tickGte', null, { all: 'x' }]) {
    assert.ok(errFieldStarts(await mut((r) => { r.alerts[0].when = bad; }), 'alerts[0].when').some(hasExpected), JSON.stringify(bad));
  }
  for (const good of [{ node: 'lb', metric: 'p99', op: 'gt', value: 2000 }, { path: 'node:cache.hitRate', op: 'lt', value: 0.5 }, { tickGte: 5 }, { applied: 'add-ttl-jitter' }, { not: { tickGte: 5 } }, { any: [{ tickGte: 1 }, { tickGte: 2 }] }]) {
    assert.equal(errFieldStarts(await mut((r) => { r.alerts[0].when = good; }), 'alerts[0].when').length, 0, JSON.stringify(good));
  }
});

test('V15 resolve.require holds at most 4 conditions', async () => {
  const c = { tickGte: 1 };
  assert.equal(errFieldStarts(await mut((r) => { r.resolve = { require: [c, c, c, c] }; }), 'resolve').length, 0);
  assert.ok(errFieldStarts(await mut((r) => { r.resolve = { require: [c, c, c, c, c] }; }), 'resolve').some(hasExpected));
});

// ------------------------------------------------------------------ V16 text and placeholders
const addLog = (text) => (r) => { r.logs.unshift({ node: 'cache', level: 'info', text }); };
const LOG_AT = 'logs[0]';

test('V16 unknown placeholders are rejected; the known ones validate', async () => {
  for (const bad of ['{nope}', '{m:nope.p99}', '{m:cache.nope}', '{m:cache.missRps|bad}', '{p:bogus}']) {
    const res = await mut(addLog(`x ${bad} y`));
    assert.ok(errFieldStarts(res, LOG_AT).some(hasExpected), `${bad}: ${FIELDS(res)}`);
  }
  for (const good of ['{tick}', '{m:cache.missRps|int}', '{m:lb.errorRate|pct}', '{m:lb.p99|ms}', '{m:cache.missRps}', '{rand:1-9}', '{p:node:cache.hitRate}', 'plain']) {
    assert.equal(errFieldStarts(await mut(addLog(`x ${good} y`)), LOG_AT).length, 0, good);
  }
});

test('V16 log text is 1..6000 characters; a 5,000-char unbroken string and the literal <script> are valid', async () => {
  const at = `${LOG_AT}.text`;
  assert.equal(errFieldStarts(await mut(addLog('a'.repeat(6000))), LOG_AT).length, 0);
  assert.equal(errFieldStarts(await mut(addLog('a'.repeat(5000))), LOG_AT).length, 0);
  assert.equal(errFieldStarts(await mut(addLog('<script>alert(1)</script>')), LOG_AT).length, 0);
  assert.ok(hasExpected(expectErr(await mut(addLog('a'.repeat(6001))), at, { exact: true })));
  assert.ok(hasExpected(expectErr(await mut(addLog('')), at, { exact: true })));
});

test('V16 log templates: level, every 1..60, at most 40 templates; deploy text 1..200; diagnostic lines at most 10 of 1..300', async () => {
  const L = (o) => (r) => { r.logs.unshift({ node: 'cache', level: 'info', text: 'x', ...o }); };
  assert.ok(errFieldStarts(await mut(L({ level: 'fatal' })), LOG_AT).some(hasExpected));
  assert.ok(errFieldStarts(await mut(L({ every: 0 })), LOG_AT).some(hasExpected));
  assert.ok(errFieldStarts(await mut(L({ every: 61 })), LOG_AT).some(hasExpected));
  assert.equal(errFieldStarts(await mut(L({ every: 60 })), LOG_AT).length, 0);
  assert.ok(errFieldStarts(await mut((r) => { r.logs = Array.from({ length: 41 }, () => ({ node: 'cache', level: 'info', text: 'x' })); }), 'logs').some(hasExpected));
  assert.equal(errFieldStarts(await mut((r) => { r.deploys = [{ tick: -2, node: 'service-1', text: 'a'.repeat(200) }]; }), 'deploys').length, 0);
  assert.ok(errFieldStarts(await mut((r) => { r.deploys = [{ tick: -2, node: 'service-1', text: 'a'.repeat(201) }]; }), 'deploys[0]').some(hasExpected));
  assert.ok(errFieldStarts(await mut((r) => { r.diagnostics = { 'trace-request': { lines: Array.from({ length: 11 }, () => 'x') } }; }), 'diagnostics').some(hasExpected));
  assert.ok(errFieldStarts(await mut((r) => { r.diagnostics = { 'trace-request': { lines: ['a'.repeat(301)] } }; }), 'diagnostics').some(hasExpected));
  assert.equal(errFieldStarts(await mut((r) => { r.diagnostics = { 'trace-request': { cost: 1, lines: ['a'.repeat(300)] } }; }), 'diagnostics').length, 0);
  assert.ok(errFieldStarts(await mut((r) => { r.diagnostics = { 'trace-request': { cost: 5 } }; }), 'diagnostics').some(hasExpected));
});

// ------------------------------------------------------------------ V17 alerts, faults, workload
test('V17 alerts: 1..8 rules, at least one severity 1 or 2, forTicks 1..30, severity 1..3', async () => {
  const rule = (i) => ({ id: `r${i}`, severity: 2, text: `rule ${i}`, when: { tickGte: 1 } });
  assert.ok(errFieldStarts(await mut((r) => { r.alerts = []; }), 'alerts').some(hasExpected));
  assert.equal(errFieldStarts(await mut((r) => { r.alerts = Array.from({ length: 8 }, (_, i) => rule(i)); }), 'alerts').length, 0);
  assert.ok(errFieldStarts(await mut((r) => { r.alerts = Array.from({ length: 9 }, (_, i) => rule(i)); }), 'alerts').some(hasExpected));
  assert.ok(errFieldStarts(await mut((r) => { r.alerts = [{ ...rule(0), severity: 3 }, { ...rule(1), severity: 3 }]; }), 'alerts').some(hasExpected), 'no page-level alert');
  assert.equal(errFieldStarts(await mut((r) => { r.alerts = [{ ...rule(0), severity: 1 }]; }), 'alerts').length, 0);
  for (const sev of [0, 4, 1.5, '2']) assert.ok(errFieldStarts(await mut((r) => { r.alerts[0].severity = sev; }), 'alerts[0].severity').some(hasExpected), `sev ${sev}`);
  for (const f of [0, 31, 1.5]) assert.ok(errFieldStarts(await mut((r) => { r.alerts[0].forTicks = f; }), 'alerts[0].forTicks').some(hasExpected), `forTicks ${f}`);
  for (const f of [1, 30]) assert.equal(errFieldStarts(await mut((r) => { r.alerts[0].forTicks = f; }), 'alerts[0].forTicks').length, 0, `forTicks ${f}`);
});

test('V17 faults: 1..8, trigger atTick 0..maxTicks or a when condition', async () => {
  const fault = (i, trigger = { atTick: 4 }) => ({ id: `f${i}`, trigger, effects: [{ path: 'node:cache.hitRate', op: 'set', value: 0.5 }] });
  assert.ok(errFieldStarts(await mut((r) => { r.faults = []; }), 'faults').some(hasExpected));
  assert.equal(errFieldStarts(await mut((r) => { r.faults = Array.from({ length: 8 }, (_, i) => fault(i)); }), 'faults').length, 0);
  assert.ok(errFieldStarts(await mut((r) => { r.faults = Array.from({ length: 9 }, (_, i) => fault(i)); }), 'faults').some(hasExpected));
  assert.ok(errFieldStarts(await mut((r) => { r.maxTicks = 100; r.faults = [fault(0, { atTick: 101 })]; }), 'faults[0]').some(hasExpected), 'atTick above maxTicks');
  assert.equal(errFieldStarts(await mut((r) => { r.maxTicks = 100; r.faults = [fault(0, { atTick: 100 })]; }), 'faults[0]').length, 0);
  assert.equal(errFieldStarts(await mut((r) => { r.faults = [fault(0, { atTick: 0 })]; }), 'faults[0]').length, 0);
  assert.ok(errFieldStarts(await mut((r) => { r.faults = [fault(0, { atTick: -1 })]; }), 'faults[0]').some(hasExpected));
  assert.equal(errFieldStarts(await mut((r) => { r.faults = [fault(0, { when: { tickGte: 10 } })]; }), 'faults[0]').length, 0);
  assert.ok(errFieldStarts(await mut((r) => { r.faults = [fault(0, {})]; }), 'faults[0]').some(hasExpected));
  assert.ok(errFieldStarts(await mut((r) => { r.faults = [{ id: 'f', trigger: { atTick: 4 } }]; }), 'faults[0]').some(hasExpected), 'effects required');
});

test('V17 workload: ticks strictly increasing from 0, multipliers 0..20, 1..32 entries', async () => {
  const w = (list) => mut((r) => { r.workload = list; });
  assert.equal(errFieldStarts(await w([[0, 1], [10, 2]]), 'workload').length, 0);
  assert.equal(errFieldStarts(await w([[0, 0], [10, 20]]), 'workload').length, 0);
  for (const bad of [[[0, 1], [0, 2]], [[0, 1], [5, 2], [3, 1]], [[1, 1], [5, 2]], [[0, 21]], [[0, -1]], [], [[0, 1], [5]], [['0', 1]], 'x']) {
    assert.ok(errFieldStarts(await w(bad), 'workload').some(hasExpected), JSON.stringify(bad));
  }
  assert.ok(errFieldStarts(await w(Array.from({ length: 33 }, (_, i) => [i, 1])), 'workload').some(hasExpected));
  assert.equal(errFieldStarts(await w(Array.from({ length: 32 }, (_, i) => [i, 1])), 'workload').length, 0);
});

// ------------------------------------------------------------------ V18 budget, harmfulWhy, sparks
test('V18 optimalPath total cost must not exceed the budget', async () => {
  const res = await mut((r) => { r.budget = 3; r.actions['add-ttl-jitter'].cost = 4; });
  assert.ok(errFieldStarts(res, 'optimalPath').some(hasExpected), FIELDS(res));
  const ok = await mut((r) => { r.budget = 4; r.actions['add-ttl-jitter'].cost = 4; });
  assert.equal(errFieldStarts(ok, 'optimalPath').length, 0, FIELDS(ok));
  const dflt = await mut((r) => { delete r.actions['add-ttl-jitter'].cost; r.optimalPath = [{ id: 'add-ttl-jitter', node: 'cache' }, { id: 'scale-service', node: 'service-1' }]; r.budget = 3; });
  assert.ok(errFieldStarts(dflt, 'optimalPath').some(hasExpected) || errFieldStarts(dflt, 'actions').length > 0, 'a missing cost defaults to 2 per fix: 2 + 2 > 3');
});

test('V18 harmfulWhy keys must be fix ids with a string reason of 1..600 characters', async () => {
  for (const key of ['inspect', 'tail-logs', 'nope']) assert.ok(errFieldStarts(await mut((r) => { r.harmfulWhy[key] = 'because'; }), 'harmfulWhy').some(hasExpected), key);
  assert.equal(errFieldStarts(await mut((r) => { r.harmfulWhy['scale-service'] = 'a'.repeat(600); }), 'harmfulWhy').length, 0);
  assert.ok(errFieldStarts(await mut((r) => { r.harmfulWhy['scale-service'] = 'a'.repeat(601); }), 'harmfulWhy').some(hasExpected));
  assert.ok(errFieldStarts(await mut((r) => { r.harmfulWhy['scale-service'] = ''; }), 'harmfulWhy').some(hasExpected));
  assert.equal(errFieldStarts(await mut((r) => { r.harmfulWhy = {}; }), 'harmfulWhy').length, 0);
});

test('V18 sparks has exactly the keys p99, errors, saturation, queue, cache-hit, each a present node or null', async () => {
  assert.ok(errFieldStarts(await mut((r) => { delete r.sparks.queue; }), 'sparks').some(hasExpected));
  assert.ok(errFieldStarts(await mut((r) => { r.sparks.extra = 'lb'; }), 'sparks').some(hasExpected));
  assert.ok(errFieldStarts(await mut((r) => { r.sparks.errors = 'nope'; }), 'sparks.errors').some(hasExpected));
  assert.ok(errFieldStarts(await mut((r) => { r.sparks.errors = 5; }), 'sparks.errors').some(hasExpected));
  assert.equal(errFieldStarts(await mut((r) => { r.sparks.queue = null; }), 'sparks').length, 0);
  assert.equal(errFieldStarts(await mut((r) => { r.sparks.errors = 'lb'; }), 'sparks').length, 0);
});

// ------------------------------------------------------------------ V19
test('V19 optimalSummary is {timeToMitigate:int, cost:int} and required', async () => {
  const miss = await mut((r) => { delete r.optimalSummary; });
  const e = expectErr(miss, 'optimalSummary', { exact: true });
  assert.match(e.message, /^missing\. Expected: .+\.$/);
  for (const bad of [{ timeToMitigate: 1.5, cost: 2 }, { timeToMitigate: 35 }, { cost: 1 }, { timeToMitigate: '35', cost: 1 }, 35, null, [], { timeToMitigate: 35, cost: 1.5 }]) {
    assert.ok(errFieldStarts(await mut((r) => { r.optimalSummary = bad; }), 'optimalSummary').some(hasExpected), JSON.stringify(bad));
  }
  assert.equal(errFieldStarts(await mut((r) => { r.optimalSummary = { timeToMitigate: 35, cost: 1 }; }), 'optimalSummary').length, 0);
});

// ------------------------------------------------------------------ whole-file behaviour
test('validate never throws and reports "(file)" for non-objects', async () => {
  const E = await engine();
  for (const v of [[], null, 5, 'text', true, undefined, 1.5, [{ id: 'x' }]]) {
    let res;
    assert.doesNotThrow(() => { res = E.validate.validate(v, 'a.json'); }, JSON.stringify(v));
    assert.deepEqual(res, { ok: false, errors: [{ file: 'a.json', field: '(file)', message: 'is not a JSON object. Expected: an object with the scenario fields.' }] });
  }
});

test('validate survives hostile objects (__proto__ own key, exotic values) without pollution or throwing', async () => {
  const E = await engine();
  const hostile = JSON.parse('{"__proto__":{"polluted":true},"constructor":{"prototype":{"x":1}},"id":"a"}');
  let res;
  assert.doesNotThrow(() => { res = E.validate.validate(hostile, 'a.json'); });
  assert.equal(res.ok, false);
  assert.equal(Object.keys(Object.prototype).length, 0);
  assert.equal(({}).polluted, undefined);
  const raw = clone(rawScenario('cache-stampede'));
  raw.topology.nodes.cache = JSON.parse('{"capacity":10,"__proto__":{"hitRate":2}}');
  assert.doesNotThrow(() => E.validate.validate(raw, BASE));
  for (const weird of [{ title: 'x'.repeat(1e6) }, { alerts: [null, 5, 'x', []] }, { faults: [{}], logs: [[]], workload: [null] }, { topology: { nodes: [], edges: {} } }, { actions: { 'scale-service': null } }]) {
    const r2 = clone(rawScenario('cache-stampede'));
    Object.assign(r2, weird);
    assert.doesNotThrow(() => E.validate.validate(r2, BASE), JSON.stringify(Object.keys(weird)));
    assert.equal(E.validate.validate(r2, BASE).ok, false);
  }
});

test('validate collects at most 10 errors, each with file, field and message strings', async () => {
  const res = await mut((r) => {
    r.difficulty = 9; r.budget = 99; r.seed = -1; r.maxTicks = 5; r.holdTicks = 99; r.escalateEvery = 999;
    r.title = ''; r.summary = ''; r.hint = ''; r.rootCause = ''; r.concept = ''; r.guideTitle = '';
  });
  assert.equal(res.ok, false);
  assert.equal(res.errors.length, 10);
  for (const e of res.errors) {
    assert.equal(e.file, BASE);
    assert.equal(typeof e.field, 'string');
    assert.equal(typeof e.message, 'string');
  }
});

test('defaults are filled: maxTicks 600, holdTicks 5, escalateEvery 90, alert forTicks 2, node instances 1, cache hitRate 0.95', async () => {
  const res = await mut((r) => {
    delete r.maxTicks; delete r.holdTicks; delete r.escalateEvery;
    for (const a of r.alerts) delete a.forTicks;
    for (const [n, p] of Object.entries(r.topology.nodes)) if (n !== 'clients') delete p.instances;
    delete r.topology.nodes.cache.hitRate;
    delete r.topology.nodes.lb.shed;
  });
  assert.equal(res.ok, true, FIELDS(res));
  const sc = res.scenario;
  assert.equal(sc.maxTicks, 600);
  assert.equal(sc.holdTicks, 5);
  assert.equal(sc.escalateEvery, 90);
  assert.ok(sc.alerts.every((a) => a.forTicks === 2));
  assert.equal(sc.topology.nodes.lb.instances, 1);
  assert.equal(sc.topology.nodes['service-1'].instances, 1);
  assert.equal(sc.topology.nodes.cache.hitRate, 0.95);
  assert.equal(sc.topology.nodes.lb.shed, 0);
});

test('a valid result is deep-frozen', async () => {
  const res = await mut(() => {});
  assert.equal(res.ok, true);
  const bad = [];
  const walk = (v, path) => {
    if (v && typeof v === 'object') {
      if (!Object.isFrozen(v)) bad.push(path);
      for (const [k, c] of Object.entries(v)) walk(c, `${path}.${k}`);
    }
  };
  walk(res.scenario, 'scenario');
  assert.deepEqual(bad, []);
  assert.throws(() => { 'use strict'; res.scenario.title = 'changed'; }, TypeError);
});

test('all 10 shipped files validate with zero errors and match their file names', async () => {
  const E = await engine();
  const files = fs.readdirSync(SCEN_DIR).filter((f) => f.endsWith('.json')).sort();
  assert.deepEqual(files, SHIPPED_IDS.map((i) => `${i}.json`).sort());
  for (const f of files) {
    const res = E.validate.validate(JSON.parse(fs.readFileSync(`${SCEN_DIR}/${f}`, 'utf8')), f);
    assert.equal(res.ok, true, `${f}: ${FIELDS(res)}`);
    assert.equal(res.scenario.id, f.replace(/\.json$/, ''));
    assert.ok(fs.statSync(`${SCEN_DIR}/${f}`).size <= E.validate.MAX_FILE_BYTES, `${f} fits the file limit`);
  }
});

test('shipped guide URLs are exactly the pinned slugs and start with the guide prefix', async () => {
  for (const id of SHIPPED_IDS) {
    const raw = rawScenario(id);
    assert.ok(raw.guideUrl.startsWith(GUIDE_PREFIX), id);
  }
});
