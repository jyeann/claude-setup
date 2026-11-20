// template.js and conditions.js: formatting, placeholders, rendering, evaluation and grammar checks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatInt, render, placeholders, hasRand, isKnownMetric } from '../public/js/engine/template.js';
import { evaluate, checkCondition, readPath, MAX_COND_DEPTH, MAX_COND_LEAVES, OPS } from '../public/js/engine/conditions.js';
import { createRun, step } from '../public/js/engine/engine.js';
import { fixture } from './fixtures/load.js';

const sc = fixture();
const at = (n) => { let s = createRun(sc, 1); for (let i = 0; i < n; i++) s = step(s, []); return s; };

test('formatInt groups thousands with commas and keeps the sign; rounds to an integer', () => {
  const cases = [[0, '0'], [7, '7'], [999, '999'], [1000, '1,000'], [1842, '1,842'], [12345, '12,345'], [100000, '100,000'], [1234567, '1,234,567'], [-1234, '-1,234'], [-999, '-999'], [1999.6, '2,000'], [-0.4, '0']];
  for (const [n, want] of cases) assert.equal(formatInt(n), want, String(n));
});

test('placeholders lists every brace group with a kind and marks unknown forms', () => {
  assert.deepEqual(placeholders('plain'), []);
  const ph = placeholders('{tick} {m:cache.missRps|int} {m:lb.p99} {p:node:cache.hitRate} {rand:3-9} {nope} {m:cache} {m:a.b|x} {rand:9-3} {rand:a-b} {p:} {m:a.b|int|int}');
  assert.deepEqual(ph.map((p) => p.kind), ['tick', 'm', 'm', 'p', 'rand', 'unknown', 'unknown', 'unknown', 'unknown', 'unknown', 'unknown', 'unknown']);
  assert.deepEqual({ node: ph[1].node, metric: ph[1].metric, format: ph[1].format }, { node: 'cache', metric: 'missRps', format: 'int' });
  assert.equal(ph[2].format, null);
  assert.equal(ph[3].path, 'node:cache.hitRate');
  assert.deepEqual({ min: ph[4].min, max: ph[4].max }, { min: 3, max: 9 });
  assert.equal(ph[5].raw, '{nope}');
  assert.equal(placeholders('{rand:5-5}')[0].kind, 'rand', 'a single value range is valid');
});

test('hasRand and isKnownMetric', () => {
  assert.equal(hasRand('x {rand:1-2}'), true);
  assert.equal(hasRand('x {tick}'), false);
  assert.equal(isKnownMetric('p99'), true);
  assert.equal(isKnownMetric('nope'), false);
});

test('render resolves tick, metrics with formats, params and rand draws', () => {
  const s = at(8);
  assert.equal(render('t{tick}', s, 0), 't8');
  assert.equal(render('{rand:10-12}', s, 0), '10');
  assert.equal(render('{rand:10-12}', s, 0.34), '11');
  assert.equal(render('{rand:10-12}', s, 0.999), '12');
  assert.equal(render('{rand:7-7}', s, 0.5), '7');
  assert.equal(render('{m:cache.missRps|int}', s, 0), formatInt(s.m.cache.missRps));
  assert.match(render('{m:lb.p99|ms}', s, 0), /^[\d,]+ ms$/);
  assert.match(render('{m:cache.hitRate|pct}', s, 0), /^\d+\.\d%$/);
  assert.equal(render('{m:cache.hitRate|pct}', { ...s, m: { cache: { ...s.m.cache, hitRate: 0.0812 } } }, 0), '8.1%');
  assert.equal(render('{m:lb.errorRate}', s, 0), String(Math.round(s.m.lb.errorRate * 10000) / 10000));
  assert.equal(render('{m:lb.hitRate}', s, 0), 'n/a');
  assert.equal(render('{m:nope.p99}', s, 0), 'n/a');
  assert.equal(render('{p:node:cache.hitRate}', s, 0), String(s.params.cache.hitRate));
  assert.equal(render('{p:node:cache.nope}', s, 0), 'n/a');
  assert.equal(render('{bogus} stays', s, 0), '{bogus} stays');
  assert.equal(render('a {tick} b {tick}', s, 0), 'a 8 b 8');
  assert.equal(render('{m:cache.missRps}', s, 0), formatInt(s.m.cache.missRps), 'default format for counts groups digits');
});

test('readPath reads node and edge parameters and returns undefined for anything else', () => {
  const s = at(1);
  assert.equal(readPath(s, 'node:cache.hitRate'), s.params.cache.hitRate);
  assert.equal(readPath(s, 'edge:lb>service-1.retries'), 0);
  assert.equal(readPath(s, 'node:cache.nope'), undefined);
  assert.equal(readPath(s, 'node:nope.hitRate'), undefined);
  assert.equal(readPath(s, 'edge:a>b.retries'), undefined);
  assert.equal(readPath(s, 'nodot'), undefined);
  assert.equal(readPath(s, 'host:cache.hitRate'), undefined);
});

test('evaluate: every operator on both sides of the boundary, all leaf forms and combinators', () => {
  const s = at(12);
  const v = Math.round(s.m.lb.p99);
  const c = (op, value) => evaluate({ node: 'lb', metric: 'p99', op, value }, s);
  assert.deepEqual([c('gt', v - 1), c('gt', v), c('gte', v), c('gte', v + 1), c('lt', v + 1), c('lt', v), c('lte', v), c('lte', v - 1), c('eq', v), c('eq', v + 1)],
    [true, false, true, false, true, false, true, false, true, false]);
  assert.equal(evaluate({ node: 'lb', metric: 'hitRate', op: 'gte', value: 0 }, s), false, 'a null metric never satisfies a comparison');
  assert.equal(evaluate({ tickGte: 12 }, s), true);
  assert.equal(evaluate({ tickGte: 13 }, s), false);
  assert.equal(evaluate({ path: 'node:cache.hitRate', op: 'eq', value: s.params.cache.hitRate }, s), true);
  assert.equal(evaluate({ path: 'node:cache.nope', op: 'eq', value: 1 }, s), false);
  assert.equal(evaluate({ path: 'edge:lb>service-1.breaker', op: 'eq', value: false }, s), true);
  assert.equal(evaluate({ applied: 'add-ttl-jitter' }, s), false);
  assert.equal(evaluate({ applied: 'add-ttl-jitter' }, step(s, [{ id: 'add-ttl-jitter', node: 'cache' }])), true);
  assert.equal(evaluate({ applied: 'add' }, step(s, [{ id: 'add-ttl-jitter', node: 'cache' }])), false, 'ids match exactly, not by prefix');
  assert.equal(evaluate({ fault: 'ttl-expiry' }, s), true);
  assert.equal(evaluate({ fault: 'ttl-expiry' }, at(2)), false);
  assert.equal(evaluate({ all: [{ tickGte: 1 }, { tickGte: 12 }] }, s), true);
  assert.equal(evaluate({ all: [{ tickGte: 1 }, { tickGte: 13 }] }, s), false);
  assert.equal(evaluate({ any: [{ tickGte: 99 }, { tickGte: 12 }] }, s), true);
  assert.equal(evaluate({ any: [{ tickGte: 99 }, { tickGte: 98 }] }, s), false);
  assert.equal(evaluate({ not: { tickGte: 99 } }, s), true);
  assert.equal(evaluate({ not: { tickGte: 1 } }, s), false);
  assert.deepEqual([...OPS], ['gt', 'gte', 'lt', 'lte', 'eq']);
  assert.equal(MAX_COND_DEPTH, 4);
  assert.equal(MAX_COND_LEAVES, 16);
});

const ctx = { nodes: new Set(['lb', 'cache']), faultIds: new Set(['f1']), checkPath: (p) => (p === 'node:cache.hitRate' ? null : 'is not a parameter path') };
const problems = (cond) => { const out = []; checkCondition(cond, 'when', ctx, (field, message) => out.push({ field, message })); return out; };

test('checkCondition accepts every leaf form', () => {
  for (const ok of [{ node: 'lb', metric: 'p99', op: 'gt', value: 1 }, { path: 'node:cache.hitRate', op: 'lt', value: 0.5 }, { path: 'node:cache.hitRate', op: 'eq', value: true },
    { tickGte: 0 }, { applied: 'rollback' }, { fault: 'f1' }, { not: { tickGte: 1 } }, { all: [{ tickGte: 1 }] }, { any: [{ tickGte: 1 }, { tickGte: 2 }] }]) {
    assert.deepEqual(problems(ok), [], JSON.stringify(ok));
  }
});

test('checkCondition: depth 4 is allowed and depth 5 is not; 16 leaves are allowed and 17 are not', () => {
  const nest = (n) => { let c = { tickGte: 1 }; for (let i = 0; i < n; i++) c = { not: c }; return c; };
  assert.deepEqual(problems(nest(3)), [], 'leaf plus three nots is four levels');
  assert.equal(problems(nest(4)).length, 1);
  assert.match(problems(nest(4))[0].message, /nested more than 4 levels\. Expected: /);
  const leaves = (n) => ({ all: Array.from({ length: n }, () => ({ tickGte: 1 })) });
  assert.deepEqual(problems(leaves(16)), []);
  assert.deepEqual(problems(leaves(17)).map((p) => p.field), ['when']);
  assert.match(problems(leaves(17))[0].message, /has 17 leaves\. Expected: at most 16 leaves\.$/);
});

test('checkCondition reports each bad shape at the right field with an Expected clause', () => {
  const bad = [
    [{}, 'when'], [null, 'when'], ['x', 'when'], [[], 'when'], [{ foo: 1 }, 'when'],
    [{ tickGte: 'x' }, 'when.tickGte'], [{ tickGte: -1 }, 'when.tickGte'], [{ tickGte: 1.5 }, 'when.tickGte'],
    [{ tickGte: 1, extra: 1 }, 'when.extra'],
    [{ applied: 'nope' }, 'when.applied'], [{ applied: 5 }, 'when.applied'], [{ fault: 'nope' }, 'when.fault'], [{ fault: 5 }, 'when.fault'],
    [{ node: 'x', metric: 'p99', op: 'gt', value: 1 }, 'when.node'], [{ node: 5, metric: 'p99', op: 'gt', value: 1 }, 'when.node'],
    [{ node: 'lb', metric: 'nope', op: 'gt', value: 1 }, 'when.metric'], [{ node: 'lb', metric: 'p99', op: 'zz', value: 1 }, 'when.op'],
    [{ node: 'lb', metric: 'p99', op: 'gt', value: '1' }, 'when.value'], [{ node: 'lb', metric: 'p99', op: 'gt' }, 'when.value'],
    [{ path: 'bogus', op: 'gt', value: 1 }, 'when.path'], [{ path: 5, op: 'gt', value: 1 }, 'when.path'], [{ path: 'node:cache.hitRate', op: 'gt', value: 'x' }, 'when.value'],
    [{ all: 'x' }, 'when.all'], [{ all: [] }, 'when.all'], [{ any: [{ nope: 1 }] }, 'when.any[0]'], [{ not: 5 }, 'when.not'],
  ];
  for (const [cond, field] of bad) {
    const ps = problems(cond);
    assert.ok(ps.some((p) => p.field === field), `${JSON.stringify(cond)} -> ${JSON.stringify(ps)}`);
    for (const p of ps) assert.match(p.message, /Expected: .+\.$/);
  }
  assert.equal(problems({ applied: 'x'.repeat(100) })[0].message.includes('x'.repeat(100)), false, 'long strings are truncated');
});
