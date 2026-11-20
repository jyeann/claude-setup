// dom/map-model.js: the map story (pile at the cache, flooded db edge, retry storm), edge states, dimming and display strings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRun, step } from '../public/js/engine/engine.js';
import { validate } from '../public/js/engine/validate.js';
import {
  compact, rateText, edgeBaselines, downstreamOfCrit, nodeView, edgeView, buildMapView, edgeKey,
} from '../public/js/dom/map-model.js';

const DIR = path.join(import.meta.dirname, '..', 'scenarios');
const load = (id) => {
  const r = validate(JSON.parse(fs.readFileSync(path.join(DIR, `${id}.json`), 'utf8')), `${id}.json`);
  assert.ok(r.ok, `${id} validates`);
  return r.scenario;
};
const advance = (state, n) => { let s = state; for (let i = 0; i < n; i++) s = step(s, []); return s; };

test('compact formats rates the way edge labels show them', () => {
  assert.equal(compact(0), '0');
  assert.equal(compact(820), '820');
  assert.equal(compact(999.4), '999');
  assert.equal(compact(1000), '1k');
  assert.equal(compact(1842), '1.8k');
  assert.equal(compact(9949), '9.9k');
  assert.equal(compact(12500), '13k');
  assert.equal(compact(2400000), '2.4M');
  assert.equal(compact(NaN), '0');
  assert.equal(compact(-5), '0');
  assert.equal(rateText(1842), '1.8k rps');
});

test('at tick 0 every node is ok, every edge calm at 8 dots per second, nothing piles', () => {
  const sc = load('cache-stampede');
  const s = createRun(sc, sc.seed);
  const view = buildMapView(sc, s, edgeBaselines(sc, s));
  for (const n of Object.values(view.nodes)) { assert.equal(n.status, 'ok'); assert.equal(n.pile, 0); }
  for (const e of Object.values(view.edges)) { assert.equal(e.dotRate, 8, e.key); assert.equal(e.state, 'normal'); assert.equal(e.attrs['data-dot-rate'], '8'); }
  assert.equal(view.edges['clients>lb'].attrs['data-from'], 'clients');
});

test('cache-stampede: the cache piles up to at least 12 and the db edge fills to the density ceiling', () => {
  const sc = load('cache-stampede');
  let s = createRun(sc, sc.seed);
  const base = edgeBaselines(sc, s);
  s = advance(s, 20);
  const view = buildMapView(sc, s, base);
  assert.ok(view.nodes.cache.pile >= 12, `pile ${view.nodes.cache.pile}`);
  assert.equal(view.nodes.cache.attrs['data-pile'], String(view.nodes.cache.pile));
  const db = view.edges['cache>db-primary'];
  assert.ok(db.dotRate >= 3 * 8, `dot rate ${db.dotRate} is at least 3x the calm 8`);
  assert.ok(db.rps >= 4 * base['cache>db-primary']);
  assert.equal(view.nodes.cache.status, 'crit');
});

test('retry-storm: the service to third-party edge reaches at least 3x its calm density', () => {
  const sc = load('retry-storm');
  let s = createRun(sc, sc.seed);
  const base = edgeBaselines(sc, s);
  let best = 0;
  for (let i = 0; i < 60; i++) { s = step(s, []); best = Math.max(best, buildMapView(sc, s, base).edges['service-1>third-party'].dotRate); }
  assert.ok(best >= 24, `peak dot rate ${best}`);
});

test('edgeBaselines reads tick 0 even from a later state and matches the engine flow', () => {
  const sc = load('retry-storm');
  const s0 = createRun(sc, sc.seed);
  const later = advance(s0, 15);
  assert.deepEqual(edgeBaselines(sc, later), edgeBaselines(sc, s0));
  assert.ok(edgeBaselines(sc, s0)['service-1>third-party'] > 0);
});

test('downstreamOfCrit includes the crit nodes and everything they feed, nothing upstream', () => {
  const sc = load('cache-stampede');
  const set = downstreamOfCrit(sc, { cache: 'crit', clients: 'ok', lb: 'warn' });
  assert.deepEqual([...set].sort(), ['cache', 'db-primary', 'db-replica']);
  assert.equal(downstreamOfCrit(sc, { cache: 'warn' }).size, 0);
});

test('dimming: edges that leave a crit node or a node downstream of one are dimmed', () => {
  const sc = load('cache-stampede');
  const s = advance(createRun(sc, sc.seed), 20);
  const v = buildMapView(sc, s, edgeBaselines(sc, s));
  assert.equal(v.edges['cache>db-primary'].dim, true);
  assert.equal(v.edges['db-primary>db-replica'].dim, true);
  assert.equal(v.edges['clients>lb'].dim, false);
});

test('a failing target turns the edge failing, an open breaker cuts it, and a cut edge has no dots', () => {
  const sc = load('cache-stampede');
  let s = advance(createRun(sc, sc.seed), 40);
  const base = edgeBaselines(sc, s);
  const target = nodeView(s, sc, 'db-primary');
  assert.ok(target.errorRate >= 0.05);
  const e = sc.topology.edges.find((x) => x.to === 'db-primary');
  const failing = edgeView(s, sc, e, base[edgeKey(e.from, e.to)], target, false);
  assert.equal(failing.state, 'failing');
  assert.ok(failing.errFrac > 0.05);
  const withBreaker = { ...s, breakers: { [failing.key]: { state: 'open', left: 5 } } };
  const cut = edgeView(withBreaker, sc, e, base[failing.key], target, false);
  assert.equal(cut.state, 'cut');
  assert.equal(cut.dotRate, 0);
  assert.equal(cut.cut, true);
});

test('reduced motion puts the error rate in the edge label and the queue in the node metric', () => {
  const sc = load('cache-stampede');
  const s = advance(createRun(sc, sc.seed), 40);
  const base = edgeBaselines(sc, s);
  const v = buildMapView(sc, s, base, { reduced: true });
  assert.match(v.edges['cache>db-primary'].text, /rps err \d+%$/);
  const plain = buildMapView(sc, s, base);
  assert.doesNotMatch(plain.edges['cache>db-primary'].text, /err/);
});

test('node display: clients show a rate, caches show hit rate, queues show depth, others saturation', () => {
  const sc = load('queue-backlog');
  let s = createRun(sc, sc.seed);
  s = advance(s, 30);
  const v = buildMapView(sc, s, edgeBaselines(sc, s));
  assert.match(v.nodes.clients.metricText, /\/s$/);
  assert.match(v.nodes.queue.metricText, /^Q \d/);
  assert.match(v.nodes['db-primary'].metricText, /^\d+%$/);
  const cs = load('cache-stampede');
  const c = buildMapView(cs, createRun(cs, cs.seed), edgeBaselines(cs, createRun(cs, cs.seed)));
  assert.match(c.nodes.cache.metricText, /^hit \d+%$/);
  for (const n of Object.values(v.nodes)) { assert.ok(n.bar >= 0 && n.bar <= 1); assert.ok(n.aria.includes(n.name)); }
});

test('every scenario produces a complete view at tick 0 and at tick 30', () => {
  for (const f of fs.readdirSync(DIR).filter((x) => x.endsWith('.json'))) {
    const sc = load(f.replace('.json', ''));
    for (const n of [0, 30]) {
      const s = advance(createRun(sc, sc.seed), n);
      const v = buildMapView(sc, s, edgeBaselines(sc, s));
      assert.equal(Object.keys(v.nodes).length, Object.keys(sc.topology.nodes).length);
      assert.equal(Object.keys(v.edges).length, sc.topology.edges.length);
      for (const e of Object.values(v.edges)) assert.ok(e.dotRate >= 0 && e.dotRate <= 40 && Number.isFinite(e.rps), `${sc.id} ${e.key}`);
    }
  }
});
