// Engine API shapes and gameplay rules on cache-stampede and derived scenarios (spec.md "Interface: engine", "Gameplay rules").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mod, engine, scenario, rawScenario, clone, validateRaw, drive, noAction, firstPage, GUIDE_PREFIX,
} from './helpers.js';

const subset = (actual, expected, where = '') => {
  for (const [k, v] of Object.entries(expected)) {
    assert.ok(actual && k in actual, `${where}.${k} is missing`);
    if (v && typeof v === 'object') subset(actual[k], v, `${where}.${k}`); else assert.equal(actual[k], v, `${where}.${k}`);
  }
};
async function derived(mutate, fileName = 'cache-stampede.json') {
  const raw = clone(rawScenario('cache-stampede'));
  mutate(raw);
  const r = await validateRaw(raw, fileName);
  assert.ok(r.ok, `derived scenario must validate: ${r.ok ? '' : r.errors.map((e) => `${e.field}: ${e.message}`).join(' | ')}`);
  return r.scenario;
}

// ------------------------------------------------------------------ catalogue and guides
test('catalogue pins node ids, node types and the 16 actions in order', async () => {
  const C = await mod('engine/catalogue');
  assert.deepEqual([...C.NODE_IDS], ['clients', 'lb', 'service-1', 'service-2', 'service-3', 'cache', 'db-primary', 'db-replica', 'queue', 'consumer', 'third-party']);
  assert.deepEqual(C.NODE_IDS.map((n) => C.NODE_TYPES[n]), ['client', 'lb', 'service', 'service', 'service', 'cache', 'db', 'db', 'queue', 'consumer', 'third-party']);
  assert.deepEqual(C.ACTIONS.map((a) => [a.id, a.kind, a.once]), [
    ['inspect', 'diagnostic', false], ['trace-request', 'diagnostic', false], ['tail-logs', 'diagnostic', false],
    ['compare-dashboards', 'diagnostic', false], ['deploy-history', 'diagnostic', false],
    ['scale-service', 'fix', false], ['add-ttl-jitter', 'fix', true], ['circuit-breaker', 'fix', true], ['backoff-jitter', 'fix', true],
    ['shed-load', 'fix', true], ['failover', 'fix', true], ['shard-rekey', 'fix', true], ['add-index', 'fix', true],
    ['rollback', 'fix', true], ['raise-pool-size', 'fix', true], ['renew-cert', 'fix', true],
  ]);
  const applies = Object.fromEntries(C.ACTIONS.map((a) => [a.id, [...a.appliesTo]]));
  for (const d of ['trace-request', 'tail-logs', 'compare-dashboards', 'deploy-history']) assert.deepEqual(applies[d], [], d);
  assert.deepEqual(applies['scale-service'], ['service', 'consumer']);
  assert.deepEqual(applies['add-ttl-jitter'], ['cache']);
  assert.deepEqual(applies['circuit-breaker'], ['service', 'consumer']);
  assert.deepEqual(applies['backoff-jitter'], ['client', 'service']);
  assert.deepEqual(applies['shed-load'], ['lb']);
  for (const d of ['failover', 'shard-rekey', 'add-index']) assert.deepEqual(applies[d], ['db'], d);
  assert.deepEqual(applies.rollback, ['service', 'consumer']);
  assert.deepEqual(applies['raise-pool-size'], ['service', 'consumer']);
  assert.deepEqual(applies['renew-cert'], ['lb', 'service', 'third-party']);
});

test('catalogue derives ACTION_IDS (16), FIX_IDS (11), DIAGNOSTIC_IDS (5, inspect included) and DEFAULT_COST, all frozen', async () => {
  const C = await mod('engine/catalogue');
  assert.equal(C.ACTION_IDS.length, 16);
  assert.equal(C.FIX_IDS.length, 11);
  assert.equal(C.DIAGNOSTIC_IDS.length, 5);
  assert.ok(C.DIAGNOSTIC_IDS.includes('inspect'));
  assert.deepEqual([...C.FIX_IDS], C.ACTIONS.filter((a) => a.kind === 'fix').map((a) => a.id));
  assert.deepEqual({ ...C.DEFAULT_COST }, { diagnostic: 1, fix: 2 });
  for (const v of [C.NODE_IDS, C.NODE_TYPES, C.ACTIONS, C.ACTION_IDS, C.FIX_IDS, C.DIAGNOSTIC_IDS]) assert.ok(Object.isFrozen(v));
});

test('catalogue PARAMS whitelist per type with ranges, defaults and required flags (design 3.1)', async () => {
  const { PARAMS, EDGE_PARAMS, EDGE_RULES } = await mod('engine/catalogue');
  assert.deepEqual(Object.keys(PARAMS).sort(), ['cache', 'client', 'consumer', 'db', 'lb', 'queue', 'service', 'third-party']);
  subset(PARAMS.client.rps, { min: 1, max: 100000, required: true });
  assert.equal(PARAMS.client.capacity, undefined);
  subset(PARAMS.service.capacity, { min: 1, max: 1000000, required: true });
  subset(PARAMS.service.instances, { min: 1, max: 64, int: true, default: 1 });
  subset(PARAMS.service.capFactor, { min: 0, max: 10, default: 1 });
  subset(PARAMS.service.baseMs, { min: 0, max: 10000, default: 5 });
  subset(PARAMS.service.timeoutMs, { min: 50, max: 60000, default: 3000 });
  subset(PARAMS.cache.hitRate, { min: 0, max: 1, default: 0.95 });
  assert.equal(PARAMS.lb.hitRate, undefined);
  subset(PARAMS.lb.shed, { min: 0, max: 0.9, default: 0 });
  subset(PARAMS.queue.maxDepth, { min: 1, max: 10000000, int: true, required: true });
  subset(PARAMS.db.shards, { min: 1, max: 64, int: true, default: 1 });
  subset(PARAMS.db.writers, { min: 1, max: 2, int: true, default: 1 });
  subset(PARAMS.db.maxConnections, { min: 1, max: 100000, int: true, default: 100000 });
  subset(PARAMS.service.poolSize, { min: 0, max: 1000, int: true, default: 0 });
  assert.equal(PARAMS.cache.timeoutMs, undefined);
  subset(EDGE_PARAMS.calls, { min: 0, max: 100, default: 1 });
  subset(EDGE_PARAMS.share, { min: 0, max: 1, default: 1 });
  subset(EDGE_PARAMS.retries, { min: 0, max: 5, int: true, default: 0 });
  subset(EDGE_PARAMS.backoff, { bool: true, default: false });
  subset(EDGE_PARAMS.breaker, { bool: true, default: false });
  subset(EDGE_PARAMS.fallback, { bool: true, default: true });
  assert.ok(EDGE_RULES && typeof EDGE_RULES === 'object');
});

test('guides: exactly the 11 allowed URLs, frozen, with the pinned pattern', async () => {
  const { GUIDES, GUIDE_PATTERN } = await mod('engine/guides');
  const slugs = ['how-can-cache-systems-go-wrong', 'things-to-consider-when-using-cache', 'how-do-we-retry-on-failures', 'resiliency-patterns',
    'a-crash-course-in-database-sharding', 'consistent-hashing', 'types-of-message-queue', '7-must-know-strategies-to-scale-your-database',
    'how-does-https-work', 'cap-theorem-one-of-the-most-misunderstood-terms', 'how-to-deploy-services'];
  assert.deepEqual([...GUIDES], slugs.map((s) => GUIDE_PREFIX + s));
  assert.ok(Object.isFrozen(GUIDES));
  assert.equal(GUIDE_PATTERN.source, '^https:\\/\\/bytebytego\\.com\\/guides\\/[a-z0-9-]{1,120}$');
  for (const g of GUIDES) assert.ok(GUIDE_PATTERN.test(g), g);
});

test('isAllowedGuide accepts only the 11 exact URLs and rejects lookalikes and non-strings', async () => {
  const { GUIDES, isAllowedGuide } = await mod('engine/guides');
  for (const g of GUIDES) assert.equal(isAllowedGuide(g), true, g);
  const g0 = GUIDES[0];
  const bad = [
    g0 + '/', g0 + '?x=1', g0 + '#a', g0 + '\n', ' ' + g0, g0.replace('https', 'http'), g0.replace('https', 'HTTPS'), g0.replace('bytebytego.com', 'www.bytebytego.com'),
    g0.replace('bytebytego.com', 'bytebytego.com.evil.com'), g0.replace('how-can', 'HOW-can'), GUIDE_PREFIXED('nope'), GUIDE_PREFIXED('a'.repeat(121)),
    GUIDE_PREFIXED(''), 'https://example.com/x', 'javascript:alert(1)', '', 'bytebytego.com/guides/resiliency-patterns',
  ];
  for (const b of bad) assert.equal(isAllowedGuide(b), false, JSON.stringify(b));
  for (const v of [undefined, null, 5, {}, [g0], true]) assert.equal(isAllowedGuide(v), false);
});
const GUIDE_PREFIXED = (slug) => GUIDE_PREFIX + slug;

// ------------------------------------------------------------------ model.retryAmplification
test('retryAmplification follows A = sum eps^i with eps capped at 0.95 and the backoff mix', async () => {
  const { retryAmplification: ra } = await mod('engine/model');
  assert.equal(ra(0.5, 2, false), 1.75);
  assert.equal(ra(0.5, 2, true), 1.1875);
  assert.equal(ra(0, 3, false), 1);
  assert.equal(ra(0.99, 1, false), 1.95);
  assert.equal(ra(1, 1, false), 1.95, 'error rate above 0.95 is capped');
  assert.equal(ra(0.5, 0, false), 1, 'no retries means no amplification');
  assert.equal(ra(0.5, 0, true), 1);
  assert.equal(ra(0, 3, true), 1);
  assert.equal(ra(0.5, 5, false), 1.96875);
  assert.equal(ra(0.5, 1, false), 1.5);
});

// ------------------------------------------------------------------ createRun / state shape
test('createRun returns a tick-0 state with every pinned field and all nodes ok', async () => {
  const E = await engine();
  const sc = await scenario('cache-stampede');
  const s = E.eng.createRun(sc, 7);
  for (const k of ['v', 'scenarioId', 'scenarioHash', 'seed', 'tick', 'status', 'budgetLeft', 'graceLeft', 'onsetTick', 'firstPageTick', 'resolvedTick',
    'peakError', 'hash', 'params', 'edgeParams', 'm', 'alerts', 'logs', 'series', 'actionLog', 'applied', 'diag', 'faultsFired']) assert.ok(k in s, k);
  assert.equal(s.v, 1);
  assert.equal(s.scenarioId, 'cache-stampede');
  assert.equal(s.scenarioHash, E.fingerprint.scenarioHash(sc));
  assert.equal(s.seed, 7);
  assert.equal(s.tick, 0);
  assert.equal(s.status, 'running');
  assert.equal(s.budgetLeft, sc.budget);
  assert.equal(s.resolvedTick, null);
  assert.equal(s.diag, null);
  assert.deepEqual(s.actionLog, []);
  assert.deepEqual(s.faultsFired, []);
  for (const n of Object.keys(sc.topology.nodes)) assert.equal(E.eng.statusOf(s, n), 'ok', n);
  assert.deepEqual(E.eng.firingAlerts(s), []);
  assert.equal(E.eng.firstNonOk(s), null);
  assert.equal(s.series.p99.length, 1);
  assert.equal(E.eng.createRun(sc, 4294967296 + 5).seed, 5, 'seed is taken >>> 0');
});

test('the state hash chain starts at hash_0 = fnv1a32("") and stateHash is hex8 of it', async () => {
  const E = await engine();
  const sc = await scenario('cache-stampede');
  const s = E.eng.createRun(sc, 1);
  assert.equal(s.hash, E.hash.fnv1a32(''));
  assert.equal(E.fingerprint.stateHash(s), '811c9dc5');
  const s1 = E.eng.step(s, []);
  assert.notEqual(s1.hash, s.hash);
  assert.equal(E.fingerprint.stateHash(s1), E.hash.hex8(s1.hash));
  assert.match(E.fingerprint.stateHash(s1), /^[0-9a-f]{8}$/);
});

test('metric() quantises: integers for ms, rps, queue and connections, 4 decimals for rates, hitRate null off the cache', async () => {
  const { states } = await noAction('cache-stampede', 1);
  const E = await engine();
  const s = states[12];
  for (const n of ['lb', 'cache', 'db-primary']) {
    for (const name of ['p50', 'p99', 'queue', 'rps', 'missRps', 'connections']) assert.ok(Number.isInteger(E.eng.metric(s, n, name)), `${n}.${name}`);
    for (const name of ['errorRate', 'saturation']) {
      const v = E.eng.metric(s, n, name);
      assert.equal(Math.round(v * 10000) / 10000, v, `${n}.${name}`);
    }
  }
  assert.equal(E.eng.metric(s, 'lb', 'hitRate'), null);
  const hr = E.eng.metric(s, 'cache', 'hitRate');
  assert.ok(hr >= 0 && hr <= 1 && Math.round(hr * 10000) / 10000 === hr);
  assert.ok(E.eng.metric(s, 'lb', 'p99') >= E.eng.metric(s, 'lb', 'p50'));
});

test('series arrays are quantised metrics of the spark nodes, one entry per tick including tick 0', async () => {
  const { E, sc, states, final } = await noAction('cache-stampede', 1);
  assert.deepEqual(Object.keys(final.series).sort(), ['cache-hit', 'errors', 'p99', 'queue', 'saturation']);
  for (const k of Object.keys(final.series)) assert.equal(final.series[k].length, final.tick + 1, k);
  for (const k of [0, 5, 12, 40]) {
    assert.equal(final.series.p99[k], E.eng.metric(states[k], sc.sparks.p99, 'p99'), `p99 at ${k}`);
    assert.equal(final.series['cache-hit'][k], E.eng.metric(states[k], sc.sparks['cache-hit'], 'hitRate'), `cache-hit at ${k}`);
  }
});

test('cache-stampede: the SEV2 page "checkout p99 > 2 s" is firing by tick 9 for 50 seeds and firstNonOk is the cache', async () => {
  const E = await engine();
  const sc = await scenario('cache-stampede');
  for (let seed = 0; seed < 50; seed++) {
    const s = drive(E, sc, seed, [], { stopTick: 9 });
    const page = E.eng.firingAlerts(s).find((a) => a.severity === 2 && a.text === 'checkout p99 > 2 s');
    assert.ok(page, `seed ${seed} has the SEV2 page at tick 9`);
  }
  const s12 = drive(E, sc, 1, [], { stopTick: 12 });
  assert.equal(E.eng.firstNonOk(s12), 'cache');
});

test('onset and calm: no node leaves ok and no alert fires up to and including onsetTick; the fault shows from onsetTick + 1', async () => {
  const E = await engine();
  const sc = await scenario('cache-stampede');
  const nodes = Object.keys(sc.topology.nodes);
  const s = drive(E, sc, 3, [], { stopTick: 12 });
  const onset = s.onsetTick;
  assert.ok(onset >= 4 && onset <= 6, `onset ${onset}`);
  let r = E.eng.createRun(sc, 3);
  for (let t = 0; t <= onset; t++) {
    for (const n of nodes) assert.equal(E.eng.statusOf(r, n), 'ok', `tick ${r.tick} ${n}`);
    assert.deepEqual(E.eng.firingAlerts(r), [], `tick ${r.tick}`);
    r = E.eng.step(r, []);
  }
  assert.ok(E.eng.metric(s, 'cache', 'hitRate') < 0.5 || E.eng.statusOf(s, 'cache') !== 'ok');
});

// ------------------------------------------------------------------ step rules
test('step drops inspect, unknown ids and illegal actions silently: no log line, no cost, no actionLog entry', async () => {
  const E = await engine();
  const sc = await scenario('cache-stampede');
  const s0 = E.eng.createRun(sc, 1);
  const s1 = E.eng.step(s0, [
    { id: 'inspect', node: 'cache' }, { id: 'reboot-everything', node: 'cache' }, { id: 'scale-service', node: null }, { id: 'add-ttl-jitter', node: 'lb' },
  ]);
  assert.equal(s1.tick, 1);
  assert.equal(s1.budgetLeft, sc.budget);
  assert.deepEqual(s1.actionLog, []);
  assert.equal(s1.logs.filter((l) => l.kind === 'action').length, 0);
  assert.deepEqual(s1.applied, {});
});

test('legal actions apply in array order, each spends its cost and logs an action line before the tick template lines', async () => {
  const E = await engine();
  const sc = await scenario('cache-stampede');
  let s = E.eng.createRun(sc, 1);
  for (let i = 0; i < 5; i++) s = E.eng.step(s, []);
  const out = E.eng.step(s, [{ id: 'trace-request', node: null }, { id: 'add-ttl-jitter', node: 'cache' }, { id: 'scale-service', node: 'service-1' }]);
  assert.deepEqual(out.actionLog.map((a) => `${a.t}:${a.id}@${a.node}`), ['5:trace-request@null', '5:add-ttl-jitter@cache', '5:scale-service@service-1']);
  assert.equal(out.budgetLeft, s.budgetLeft - 1 - 1 - 2);
  const fresh = out.logs.slice(s.logs.length);
  const actionLines = fresh.filter((l) => l.kind === 'action');
  assert.deepEqual(actionLines.map((l) => l.text), ['Ran: Trace request', 'Applied: Add TTL jitter', 'Applied: Scale service']);
  assert.deepEqual(actionLines.map((l) => [l.node, l.level]), [[null, 'info'], ['cache', 'info'], ['service-1', 'info']]);
  const lastAction = fresh.map((l) => l.kind).lastIndexOf('action');
  const firstTemplate = fresh.findIndex((l) => l.kind === 'log');
  if (firstTemplate !== -1) assert.ok(lastAction < firstTemplate, 'action lines come before that tick\'s template lines');
  assert.deepEqual(out.applied['add-ttl-jitter@cache'], true);
});

test('cost comes from actions.<id>.cost, else diagnostics.<id>.cost, else the default (diagnostic 1, fix 2)', async () => {
  const E = await engine();
  const sc = await derived((raw) => {
    raw.diagnostics = { 'tail-logs': { cost: 3 }, 'compare-dashboards': { cost: 3 } };
    raw.actions['compare-dashboards'] = { cost: 2 };
  });
  const cost = (id, node = null) => {
    const s0 = E.eng.createRun(sc, 1);
    return s0.budgetLeft - E.eng.step(s0, [{ id, node }]).budgetLeft;
  };
  assert.equal(cost('tail-logs'), 3);
  assert.equal(cost('compare-dashboards'), 2, 'actions.<id>.cost wins over diagnostics.<id>.cost');
  assert.equal(cost('trace-request'), 1);
  assert.equal(cost('deploy-history'), 1);
  assert.equal(cost('scale-service', 'service-1'), 2);
  assert.equal(cost('add-ttl-jitter', 'cache'), 1);
});

test('a finished run is returned unchanged by step', async () => {
  const { E, sc, final } = await noAction('cache-stampede', 1);
  const again = E.eng.step(final, [{ id: 'trace-request', node: null }]);
  assert.equal(E.hash.canonicalJson(again), E.hash.canonicalJson(final));
  assert.equal(again.tick, final.tick);
  assert.ok(sc);
});

test('failAtTick makes step throw EngineError("deliberate failure") when the new tick equals it', async () => {
  const E = await engine();
  const sc = await scenario('cache-stampede');
  let s = E.eng.createRun(sc, 1, { failAtTick: 3 });
  s = E.eng.step(s, []);
  s = E.eng.step(s, []);
  assert.throws(() => E.eng.step(s, []), (e) => e instanceof E.eng.EngineError && e.message === 'deliberate failure');
  const ok = E.eng.step(E.eng.createRun(sc, 1), []);
  assert.equal(ok.tick, 1);
});

// ------------------------------------------------------------------ canApply
const stampedeState = async (ticks = 0) => {
  const E = await engine();
  const sc = await scenario('cache-stampede');
  return { E, sc, s: drive(E, sc, 1, [], { stopTick: ticks }) };
};

test('canApply resolves targets: selected node, the only node of the type, or null for global diagnostics', async () => {
  const { E, s } = await stampedeState(3);
  assert.deepEqual(E.eng.canApply(s, 'add-ttl-jitter', 'cache'), { ok: true, target: 'cache' });
  assert.deepEqual(E.eng.canApply(s, 'add-ttl-jitter'), { ok: true, target: 'cache' });
  assert.deepEqual(E.eng.canApply(s, 'add-ttl-jitter', null), { ok: true, target: 'cache' });
  assert.deepEqual(E.eng.canApply(s, 'shed-load', undefined), { ok: true, target: 'lb' });
  assert.deepEqual(E.eng.canApply(s, 'scale-service', 'service-2'), { ok: true, target: 'service-2' });
  assert.deepEqual(E.eng.canApply(s, 'trace-request', null), { ok: true, target: null });
  assert.deepEqual(E.eng.canApply(s, 'deploy-history', 'cache'), { ok: true, target: null });
  assert.equal(E.eng.canApply(s, 'no-such-action', 'cache').ok, false);
});

test('canApply inspect is free: {ok:true, target, free:true}, even with budget 0', async () => {
  const { E, sc, s } = await stampedeState(3);
  assert.deepEqual(E.eng.canApply(s, 'inspect', 'cache'), { ok: true, target: 'cache', free: true });
  assert.deepEqual(E.eng.canApply(s, 'inspect', null), { ok: true, target: null, free: true });
  const broke = E.eng.step(s, Array.from({ length: sc.budget }, () => ({ id: 'trace-request', node: null })));
  assert.equal(broke.budgetLeft, 0);
  assert.equal(E.eng.canApply(broke, 'inspect', 'lb').ok, true);
});

test('canApply target errors use "Works on a <types>. Select one first." with types joined by " or "', async () => {
  const { E, s } = await stampedeState(3);
  const reason = (id, node) => { const r = E.eng.canApply(s, id, node); assert.equal(r.ok, false); return r.reason; };
  assert.equal(reason('scale-service', null), 'Works on a service or consumer. Select one first.');
  assert.equal(reason('scale-service', 'cache'), 'Works on a service or consumer. Select one first.');
  assert.equal(reason('failover', null), 'Works on a db. Select one first.');
  assert.equal(reason('add-ttl-jitter', 'lb'), 'Works on a cache. Select one first.');
  assert.equal(reason('backoff-jitter', 'db-primary'), 'Works on a client or service. Select one first.');
  assert.equal(reason('renew-cert', 'cache'), 'Works on a lb or service or third-party. Select one first.');
  assert.equal(reason('rollback', 'db-primary'), 'Works on a service or consumer. Select one first.');
});

test('canApply reports "Already on." for once fixes but lets scale-service repeat', async () => {
  const { E, s } = await stampedeState(3);
  let t = E.eng.step(s, [{ id: 'add-ttl-jitter', node: 'cache' }, { id: 'scale-service', node: 'service-1' }]);
  assert.deepEqual(E.eng.canApply(t, 'add-ttl-jitter', 'cache'), { ok: false, reason: 'Already on.' });
  assert.equal(E.eng.canApply(t, 'scale-service', 'service-1').ok, true);
  const again = E.eng.step(t, [{ id: 'add-ttl-jitter', node: 'cache' }]);
  assert.equal(again.actionLog.filter((a) => a.id === 'add-ttl-jitter').length, 1, 'the repeat is dropped');
  assert.equal(E.eng.canApply(t, 'failover', 'db-primary').ok, true, 'once is per target: other fixes unaffected');
  t = E.eng.step(t, [{ id: 'scale-service', node: 'service-1' }]);
  assert.equal(t.actionLog.filter((a) => a.id === 'scale-service').length, 2);
});

test('canApply budget reasons: not enough pager, then out of pager budget, with the exact texts', async () => {
  const { E, sc, s } = await stampedeState(0);
  const low = E.eng.step(s, Array.from({ length: sc.budget - 1 }, () => ({ id: 'trace-request', node: null })));
  assert.equal(low.budgetLeft, 1);
  assert.deepEqual(E.eng.canApply(low, 'scale-service', 'service-1'), { ok: false, reason: 'Not enough pager. It costs 2 and you have 1.' });
  assert.equal(E.eng.canApply(low, 'trace-request', null).ok, true);
  assert.deepEqual(E.eng.canApply(low, 'scale-service', null), { ok: false, reason: 'Not enough pager. It costs 2 and you have 1.' }, 'budget is checked before the target');
  const zero = E.eng.step(low, [{ id: 'trace-request', node: null }]);
  assert.equal(zero.budgetLeft, 0);
  assert.deepEqual(E.eng.canApply(zero, 'trace-request', null), { ok: false, reason: 'Out of pager budget.' });
  assert.deepEqual(E.eng.canApply(zero, 'scale-service', null), { ok: false, reason: 'Out of pager budget.' });
  assert.deepEqual(E.eng.canApply(zero, 'add-ttl-jitter', 'cache'), { ok: false, reason: 'Out of pager budget.' });
});

test('canApply says "The incident is over." on a finished run, before any other check', async () => {
  const { E, final } = await noAction('cache-stampede', 1).then(({ E, final }) => ({ E, final }));
  assert.deepEqual(E.eng.canApply(final, 'trace-request', null), { ok: false, reason: 'The incident is over.' });
  assert.deepEqual(E.eng.canApply(final, 'scale-service', null), { ok: false, reason: 'The incident is over.' });
  assert.equal(final.budgetLeft === 0 || final.status === 'out-of-budget', true);
});

// ------------------------------------------------------------------ diagnostics
test('trace-request lists the critical path with ms per hop and costs one lamp', async () => {
  const { E, s } = await stampedeState(12);
  const out = E.eng.step(s, [{ id: 'trace-request', node: null }]);
  assert.equal(out.diag.id, 'trace-request');
  assert.ok(Array.isArray(out.diag.lines) && out.diag.lines.length >= 1);
  const text = out.diag.lines.join('\n');
  assert.match(text, /lb/);
  assert.match(text, /service-1/);
  assert.match(text, /\d+ ms/);
  assert.equal(typeof out.diag.t, 'number');
  assert.equal(out.budgetLeft, s.budgetLeft - 1);
});

test('tail-logs shows recent log text, compare-dashboards names every node, deploy-history lists the scenario deploys', async () => {
  const { E, sc, s } = await stampedeState(12);
  const lastLog = [...s.logs].reverse().find((l) => l.kind === 'log');
  assert.ok(lastLog, 'the stampede has log lines by tick 12');
  const tail = E.eng.step(s, [{ id: 'tail-logs', node: null }]);
  assert.equal(tail.diag.id, 'tail-logs');
  assert.ok(tail.diag.lines.some((l) => l.includes(lastLog.text.replace(/\d[\d,]*/g, '').trim().slice(0, 12))), 'recent log text appears');
  const cmp = E.eng.step(s, [{ id: 'compare-dashboards', node: null }]);
  assert.equal(cmp.diag.id, 'compare-dashboards');
  const text = cmp.diag.lines.join('\n');
  for (const n of Object.keys(sc.topology.nodes)) assert.ok(text.includes(n), `compare-dashboards mentions ${n}`);
  const q = await scenario('queue-backlog');
  const sq = drive(E, q, 1, [], { stopTick: 6 });
  const dep = E.eng.step(sq, [{ id: 'deploy-history', node: null }]);
  assert.equal(dep.diag.id, 'deploy-history');
  assert.ok(q.deploys.length >= 1, 'queue-backlog has a deploy (consumer, 2 s before T+0)');
  for (const d of q.deploys.filter((x) => x.tick < 0)) {
    const mm = String(Math.floor(-d.tick / 60)).padStart(2, '0'); const ss = String(-d.tick % 60).padStart(2, '0');
    assert.ok(dep.diag.lines.some((l) => l.startsWith(`T-${mm}:${ss} ${d.node}`)), `line for ${d.node} at T-${mm}:${ss}`);
  }
});

test('scenario diagnostics.<id>.lines templates are appended after the default lines; diagnostics change no system state and draw nothing', async () => {
  const E = await engine();
  const sc = await derived((raw) => { raw.diagnostics = { 'trace-request': { lines: ['probe at tick {tick}'] } }; });
  const base = await scenario('cache-stampede');
  let a = E.eng.createRun(sc, 9);
  let b = E.eng.createRun(base, 9);
  for (let i = 0; i < 6; i++) { a = E.eng.step(a, []); b = E.eng.step(b, []); }
  a = E.eng.step(a, [{ id: 'trace-request', node: null }]);
  b = E.eng.step(b, []);
  assert.match(a.diag.lines.at(-1), /^probe at tick \d+$/);
  assert.ok(a.diag.lines.length >= 2, 'default body comes first');
  for (let i = 0; i < 25; i++) { a = E.eng.step(a, []); b = E.eng.step(b, []); }
  assert.equal(E.hash.canonicalJson(a.m), E.hash.canonicalJson(b.m), 'metrics identical with and without the diagnostic');
  assert.deepEqual(a.series, b.series);
});

// ------------------------------------------------------------------ draws and logs
test('only {rand} log templates draw from the PRNG: a plain template leaves metrics untouched, a rand template shifts them', async () => {
  const E = await engine();
  const base = await scenario('cache-stampede');
  const plain = await derived((raw) => { raw.logs.push({ node: 'lb', level: 'info', text: 'plain probe' }); });
  const rnd = await derived((raw) => { raw.logs.push({ node: 'lb', level: 'info', text: 'rand probe {rand:1-9}' }); });
  const at30 = (sc) => drive(E, sc, 11, [], { stopTick: 30 });
  const b = at30(base); const p = at30(plain); const r = at30(rnd);
  assert.equal(E.hash.canonicalJson(p.m), E.hash.canonicalJson(b.m), 'no extra draw');
  assert.notEqual(E.hash.canonicalJson(r.m), E.hash.canonicalJson(b.m), 'an extra draw per tick shifts the workload noise');
  const lines = r.logs.filter((l) => l.text.startsWith('rand probe '));
  assert.ok(lines.length >= 20);
  for (const l of lines) assert.match(l.text, /^rand probe [1-9]$/);
});

test('at most 6 template log lines per tick, kept in file order', async () => {
  const E = await engine();
  const sc = await derived((raw) => {
    for (let i = 1; i <= 10; i++) raw.logs.push({ node: 'lb', level: 'info', text: `probe-${i}` });
  });
  const s = drive(E, sc, 1, [], { stopTick: 12 });
  const perTick = new Map();
  for (const l of s.logs.filter((x) => x.kind === 'log')) perTick.set(l.t, [...(perTick.get(l.t) ?? []), l.text]);
  for (let t = 1; t <= 12; t++) assert.equal(perTick.get(t)?.length, 6, `tick ${t} keeps exactly 6 of the 11 unconditional templates`);
  for (let t = 1; t <= 12; t++) {
    const probes = perTick.get(t).filter((x) => /^probe-\d+$/.test(x)).map((x) => Number(x.slice(6)));
    assert.deepEqual(probes, probes.map((_, i) => i + 1), `tick ${t}: probes kept in file order from the first`);
  }
});

test('log templates render placeholders: {m:...|int} groups with commas, {tick} and {rand:a-b} stay in range', async () => {
  const E = await engine();
  const sc = await derived((raw) => {
    raw.logs.push({ node: 'cache', level: 'warn', from: 8, text: 'T{tick} miss {m:cache.missRps|int} r{rand:68-72}' });
  });
  const s = drive(E, sc, 2, [], { stopTick: 14 });
  const lines = s.logs.filter((l) => /^T\d+ miss /.test(l.text));
  assert.ok(lines.length >= 5);
  for (const l of lines) {
    const m = /^T(\d+) miss (\d[\d,]*) r(\d+)$/.exec(l.text);
    assert.ok(m, l.text);
    assert.equal(Number(m[1]), l.t);
    assert.ok(Number(m[3]) >= 68 && Number(m[3]) <= 72);
    assert.ok(Number(m[1]) >= 8, 'from: 8 delays the template');
    assert.ok(/^\d{1,3}(,\d{3})*$/.test(m[2]));
  }
});

// ------------------------------------------------------------------ alerts
test('alerts fire after forTicks consecutive true ticks, clear after 3 false ticks and can fire again', async () => {
  const E = await engine();
  const sc = await derived((raw) => {
    raw.alerts.push({
      id: 'probe', severity: 3, text: 'probe alert', forTicks: 2,
      when: { any: [{ all: [{ tickGte: 10 }, { not: { tickGte: 15 } }] }, { tickGte: 30 }] },
    });
  });
  let s = E.eng.createRun(sc, 1);
  const firing = [];
  for (let i = 0; i < 40; i++) { s = E.eng.step(s, []); firing[s.tick] = E.eng.firingAlerts(s).some((a) => a.id === 'probe'); }
  assert.equal(firing[10], false, 'true for 1 tick is not enough for forTicks 2');
  assert.equal(firing[11], true);
  assert.equal(firing[16], true, 'false for 15 and 16: still firing');
  assert.equal(firing[17], false, 'cleared after 3 consecutive false ticks (15, 16, 17)');
  assert.equal(firing[29], false);
  assert.equal(firing[30], false);
  assert.equal(firing[31], true, 'fires again');
  assert.equal(s.alerts.probe.firing, true);
  assert.equal(s.alerts.probe.since, 31);
});

test('firingAlerts orders by severity then file order and carries id, severity, text and since', async () => {
  const E = await engine();
  const sc = await derived((raw) => {
    raw.alerts.push({ id: 'zz-b', severity: 3, text: 'b alert', when: { tickGte: 1 }, forTicks: 1 });
    raw.alerts.push({ id: 'zz-a', severity: 3, text: 'a alert', when: { tickGte: 1 }, forTicks: 1 });
    raw.alerts.push({ id: 'zz-top', severity: 1, text: 'top alert', when: { tickGte: 1 }, forTicks: 1 });
  });
  let s = E.eng.createRun(sc, 1);
  for (let i = 0; i < 3; i++) s = E.eng.step(s, []);
  const f = E.eng.firingAlerts(s);
  assert.equal(f[0].id, 'zz-top');
  assert.deepEqual(f.map((a) => a.severity), [...f.map((a) => a.severity)].sort((x, y) => x - y));
  const ids = f.map((a) => a.id);
  assert.ok(ids.indexOf('zz-b') < ids.indexOf('zz-a'), 'file order within a severity');
  for (const k of ['id', 'severity', 'text', 'since']) assert.ok(k in f[0], k);
  assert.equal(f[0].text, 'top alert');
  assert.equal(f[0].since, 1);
});

// ------------------------------------------------------------------ statuses
test('statusOf compares quantised values against thresholds with >=: scenario thresholds override per metric', async () => {
  const E = await engine();
  const base = await scenario('cache-stampede');
  const s = drive(E, base, 1, [], { stopTick: 12 });
  const v = E.eng.metric(s, 'lb', 'saturation');
  assert.ok(v > 0, 'lb carries traffic');
  const make = (warn, crit) => derived((raw) => {
    raw.thresholds = { saturation: { warn, crit }, errorRate: { warn: 0.9, crit: 0.95 }, p99: { warn: 100000, crit: 200000 } };
  });
  const status = async (warn, crit) => E.eng.statusOf(drive(E, await make(warn, crit), 1, [], { stopTick: 12 }), 'lb');
  assert.equal(await status(v, v + 0.5), 'warn');
  assert.ok(['ok', 'recovering'].includes(await status(v + 0.0001, v + 0.5)), 'just under warn is ok (or recovering after an earlier excursion)');
  assert.equal(await status(Math.max(0, v - 0.1), v), 'crit');
  assert.equal(await status(Math.max(0, v - 0.01), v + 0.0001), 'warn');
});

test('THRESHOLDS exports the default warn and crit levels', async () => {
  const { THRESHOLDS } = await mod('engine/engine');
  subset(THRESHOLDS, { saturation: { warn: 0.7, crit: 0.9 }, errorRate: { warn: 0.01, crit: 0.05 }, p99: { warn: 1000, crit: 2000 } }, 'THRESHOLDS');
});

test('a node is "recovering" for 10 ticks after leaving warn or crit, never straight back to ok', async () => {
  const E = await engine();
  const sc = await scenario('cache-stampede');
  const fp = firstPage(E, sc, 1);
  const states = [];
  drive(E, sc, 1, [{ t: fp, id: 'add-ttl-jitter', node: 'cache' }], { each: (s) => states.push(s) });
  let sawRecovering = false;
  for (const n of Object.keys(sc.topology.nodes)) {
    const seq = states.map((s) => E.eng.statusOf(s, n));
    for (let i = 0; i < seq.length; i++) {
      const prior = seq.slice(Math.max(0, i - 10), i);
      const hot = prior.some((x) => x === 'warn' || x === 'crit');
      if (seq[i] === 'ok') assert.equal(hot, false, `${n} tick ${i}: ok right after warn/crit`);
      if (seq[i] === 'recovering') { sawRecovering = true; assert.ok(prior.some((x) => x === 'warn' || x === 'crit' || x === 'recovering'), `${n} tick ${i}`); }
    }
  }
  assert.ok(sawRecovering, 'some node recovers');
});

test('edgeRps is a quantised flow that rises on the cache-to-db edge during the stampede', async () => {
  const { E, states } = await noAction('cache-stampede', 1);
  const base = E.eng.edgeRps(states[0], 'cache', 'db-primary');
  assert.ok(Number.isInteger(base) && base > 0);
  assert.ok(Math.max(...states.slice(6, 41).map((s) => E.eng.edgeRps(s, 'cache', 'db-primary'))) > base * 2);
});

// ------------------------------------------------------------------ result, hold, resolution, classify
test('result() reports running state, then resolved with timeToMitigate equal to resolvedTick after the optimal fix', async () => {
  const E = await engine();
  const sc = await scenario('cache-stampede');
  const s5 = drive(E, sc, 1, [], { stopTick: 5 });
  const r5 = E.eng.result(s5);
  assert.equal(r5.result, 'running');
  assert.equal(r5.timeToMitigate, null);
  assert.equal(r5.budgetLeft, sc.budget);
  const fp = firstPage(E, sc, 1);
  const done = drive(E, sc, 1, [{ t: fp, id: 'add-ttl-jitter', node: 'cache' }]);
  const r = E.eng.result(done);
  assert.equal(r.result, 'resolved');
  assert.equal(done.status, 'resolved');
  assert.equal(r.timeToMitigate, done.resolvedTick);
  assert.equal(r.firstPageTick, fp);
  assert.equal(r.onsetTick, done.onsetTick);
  assert.equal(r.budgetLeft, sc.budget - 1);
  assert.equal(r.harmful, 0);
  assert.ok(r.peakError >= 0 && r.peakError <= 1);
  assert.ok(r.timeToMitigate > fp);
});

test('resolution needs holdTicks quiet ticks: the run stops exactly when the hold completes', async () => {
  const E = await engine();
  const sc = await scenario('cache-stampede');
  const fp = firstPage(E, sc, 1);
  const states = [];
  const done = drive(E, sc, 1, [{ t: fp, id: 'add-ttl-jitter', node: 'cache' }], { each: (s) => states.push(s) });
  const hold = sc.holdTicks;
  assert.equal(done.tick, done.resolvedTick, 'the run stops at the resolved tick');
  for (let k = done.resolvedTick - hold + 1; k <= done.resolvedTick; k++) assert.deepEqual(E.eng.firingAlerts(states[k]), [], `no alert at tick ${k}`);
  const lastFiring = [...states].reverse().find((s) => E.eng.firingAlerts(s).some((a) => a.severity <= 2) && s.tick >= fp);
  assert.ok(lastFiring.tick <= done.resolvedTick - hold, `last firing tick ${lastFiring.tick} is at least ${hold} before ${done.resolvedTick}`);
});

test('classify: diagnostics are "diagnostic", add-ttl-jitter is helpful, failover@db-primary harmful; classify never mutates the state', async () => {
  const E = await engine();
  const sc = await scenario('cache-stampede');
  const fp = firstPage(E, sc, 1);
  const s = drive(E, sc, 1, [], { stopTick: fp });
  const before = E.hash.canonicalJson(s);
  assert.equal(E.classify.classify(s, { id: 'trace-request', node: null }), 'diagnostic');
  assert.equal(E.classify.classify(s, { id: 'tail-logs', node: null }), 'diagnostic');
  assert.equal(E.classify.classify(s, { id: 'add-ttl-jitter', node: 'cache' }), 'helpful');
  assert.equal(E.classify.classify(s, { id: 'failover', node: 'db-primary' }), 'harmful');
  assert.equal(E.hash.canonicalJson(s), before);
});

test('badness = sum over nodes of (saturation + 5 errorRate) + 2 per firing alert, on quantised metrics', async () => {
  const E = await engine();
  const { states, sc } = await noAction('cache-stampede', 1);
  for (const k of [0, 12, 30]) {
    const s = states[k];
    let want = 0;
    for (const n of Object.keys(sc.topology.nodes)) want += E.eng.metric(s, n, 'saturation') + 5 * E.eng.metric(s, n, 'errorRate');
    want += 2 * E.eng.firingAlerts(s).length;
    assert.ok(Math.abs(E.classify.badness(s) - want) < 1e-9, `tick ${k}`);
  }
});

test('historyEffects reveals each fix effect at tick t+5 and result().harmful counts the harmful ones', async () => {
  const E = await engine();
  const sc = await scenario('cache-stampede');
  const fp = firstPage(E, sc, 1);
  const log = [{ t: fp, id: 'trace-request', node: null }, { t: fp + 1, id: 'failover', node: 'db-primary' }];
  const at = (tick) => drive(E, sc, 1, log, { stopTick: tick });
  const early = E.classify.historyEffects(at(fp + 5));
  assert.deepEqual(early.map((h) => [h.t, h.id, h.node]), [[fp, 'trace-request', null], [fp + 1, 'failover', 'db-primary']]);
  assert.equal(early[1].effect, null, 'not revealed before t+5');
  const late = E.classify.historyEffects(at(fp + 6));
  assert.equal(late[1].effect, 'harmful');
  assert.equal(late[0].effect, 'diagnostic');
  assert.equal(E.eng.result(at(fp + 6)).harmful, 1);
  assert.equal(E.classify.historyEffects(at(fp + 12))[1].effect, 'harmful', 'fixed once revealed');
});

// ------------------------------------------------------------------ fingerprint, hash, template, conditions
test('scenarioHash is hex8(fnv1a32(canonicalJson(scenario))) and ignores key order', async () => {
  const E = await engine();
  const sc = await scenario('cache-stampede');
  assert.equal(E.fingerprint.scenarioHash(sc), E.hash.hex8(E.hash.fnv1a32(E.hash.canonicalJson(sc))));
  const reordered = Object.fromEntries(Object.entries(clone(sc)).reverse());
  assert.equal(E.fingerprint.scenarioHash(reordered), E.fingerprint.scenarioHash(sc));
  const tuned = clone(sc); tuned.hint = tuned.hint + ' x';
  assert.notEqual(E.fingerprint.scenarioHash(tuned), E.fingerprint.scenarioHash(sc));
  assert.match(E.fingerprint.scenarioHash(sc), /^[0-9a-f]{8}$/);
});

test('fingerprint follows the pinned v1 formula and reacts to every input', async () => {
  const E = await engine();
  const base = {
    scenarioId: 'cache-stampede', scenarioHash: 'abcd1234', seed: 7, hintUsed: true,
    actionLog: [{ t: 12, id: 'trace-request', node: null }, { t: 14, id: 'add-ttl-jitter', node: 'cache' }],
  };
  const want = E.hash.hex8(E.hash.fnv1a32('v1|cache-stampede|abcd1234|7|12:trace-request@-;14:add-ttl-jitter@cache|h'));
  assert.equal(E.fingerprint.fingerprint(base), want);
  assert.equal(E.fingerprint.fingerprint({ ...base, hintUsed: false }), E.hash.hex8(E.hash.fnv1a32('v1|cache-stampede|abcd1234|7|12:trace-request@-;14:add-ttl-jitter@cache|')));
  assert.equal(E.fingerprint.fingerprint({ ...base, actionLog: [] }), E.hash.hex8(E.hash.fnv1a32('v1|cache-stampede|abcd1234|7||h')));
  const variants = [{ seed: 8 }, { scenarioHash: 'abcd1235' }, { scenarioId: 'retry-storm' }, { actionLog: [base.actionLog[1]] }];
  for (const v of variants) assert.notEqual(E.fingerprint.fingerprint({ ...base, ...v }), want);
});

test('formatInt groups thousands with commas without Intl', async () => {
  const { formatInt } = await mod('engine/template');
  assert.equal(formatInt(1842), '1,842');
  assert.equal(formatInt(999), '999');
  assert.equal(formatInt(-1234), '-1,234');
  assert.equal(formatInt(0), '0');
  assert.equal(formatInt(1000), '1,000');
  assert.equal(formatInt(1234567), '1,234,567');
  assert.equal(formatInt(-999), '-999');
  assert.equal(formatInt(100000), '100,000');
});

test('render resolves {tick}, {m:node.metric|int} and {rand:a-b} from the draw u, and placeholders lists them', async () => {
  const E = await engine();
  const { states } = await noAction('cache-stampede', 1);
  const s = states[12];
  const T = E.template;
  assert.equal(T.render('at {tick}', s, 0), `at ${s.tick}`);
  assert.equal(T.render('{m:cache.missRps|int}', s, 0), T.formatInt(E.eng.metric(s, 'cache', 'missRps')));
  assert.equal(T.render('{rand:10-12}', s, 0), '10');
  assert.equal(T.render('{rand:10-12}', s, 0.9999999), '12');
  for (const u of [0, 0.1, 0.33, 0.5, 0.66, 0.9, 0.999]) { const v = Number(T.render('{rand:68-72}', s, u)); assert.ok(Number.isInteger(v) && v >= 68 && v <= 72, `u=${u}`); }
  assert.equal(T.render('no placeholders', s, 0.5), 'no placeholders');
  assert.deepEqual(T.placeholders('plain text'), []);
  const ph = T.placeholders('a {m:cache.missRps|int} b {tick} c {rand:1-5} d {p:node:cache.hitRate}');
  assert.equal(ph.length, 4);
  assert.equal(new Set(ph.map((p) => p.kind)).size, 4);
});

test('evaluate implements the condition grammar and exports the depth and leaf caps', async () => {
  const E = await engine();
  const { states } = await noAction('cache-stampede', 1);
  const s = states[12];
  const ev = E.conditions.evaluate;
  const v = E.eng.metric(s, 'lb', 'p99');
  const c = (op, value) => ev({ node: 'lb', metric: 'p99', op, value }, s);
  assert.equal(c('gt', v - 1), true); assert.equal(c('gt', v), false);
  assert.equal(c('gte', v), true); assert.equal(c('gte', v + 1), false);
  assert.equal(c('lt', v + 1), true); assert.equal(c('lt', v), false);
  assert.equal(c('lte', v), true); assert.equal(c('lte', v - 1), false);
  assert.equal(c('eq', v), true); assert.equal(c('eq', v + 1), false);
  assert.equal(ev({ tickGte: 12 }, s), true);
  assert.equal(ev({ tickGte: 13 }, s), false);
  assert.equal(ev({ path: 'node:cache.hitRate', op: 'lt', value: 0.5 }, s), s.params.cache.hitRate < 0.5);
  assert.equal(ev({ applied: 'add-ttl-jitter' }, s), false);
  assert.equal(ev({ applied: 'add-ttl-jitter' }, E.eng.step(s, [{ id: 'add-ttl-jitter', node: 'cache' }])), true);
  assert.equal(ev({ fault: raw0Fault(s) }, s), true);
  assert.equal(ev({ fault: raw0Fault(s) }, states[0]), false);
  assert.equal(ev({ all: [{ tickGte: 1 }, { tickGte: 12 }] }, s), true);
  assert.equal(ev({ all: [{ tickGte: 1 }, { tickGte: 13 }] }, s), false);
  assert.equal(ev({ any: [{ tickGte: 99 }, { tickGte: 12 }] }, s), true);
  assert.equal(ev({ any: [{ tickGte: 99 }, { tickGte: 98 }] }, s), false);
  assert.equal(ev({ not: { tickGte: 99 } }, s), true);
  assert.equal(E.conditions.MAX_COND_DEPTH, 4);
  assert.equal(E.conditions.MAX_COND_LEAVES, 16);
});
const raw0Fault = (s) => s.faultsFired[0];
