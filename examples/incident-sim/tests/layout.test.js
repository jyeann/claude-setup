// core/layout.js: deterministic auto-layout invariants over every shipped scenario, both templates.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { computeLayout, nearest, pointAt, clearLayoutCache, WIDE_MIN } from '../public/js/core/layout.js';

const DIR = path.join(import.meta.dirname, '..', 'scenarios');
const SCENARIOS = fs.readdirSync(DIR).filter((f) => f.endsWith('.json')).sort().map((f) => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')));
const SIZES = [
  { width: 872, height: 480, mode: 'wide' }, { width: 1100, height: 520, mode: 'wide' }, { width: 730, height: 400, mode: 'wide' },
  { width: 358, height: 500, mode: 'tall' }, { width: 296, height: 500, mode: 'tall' },
];
const overlap = (a, b, pad = 0) => a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;

test('there are scenarios to lay out', () => {
  assert.ok(SCENARIOS.length >= 6);
});

for (const sc of SCENARIOS) {
  for (const size of SIZES) {
    test(`${sc.id} ${size.width}px ${size.mode}: no two nodes overlap, all inside the box, every node placed once`, () => {
      const L = computeLayout(sc, size);
      assert.equal(L.mode, size.mode);
      const ids = Object.keys(sc.topology.nodes);
      assert.deepEqual([...L.order].sort(), [...ids].sort());
      assert.deepEqual(Object.keys(L.nodes).sort(), [...ids].sort());
      const ns = Object.values(L.nodes);
      for (const n of ns) {
        assert.ok(n.x >= 0 && n.y >= 0 && n.x + n.w <= L.width + 0.5 && n.y + n.h <= L.height + 0.5, `${n.id} inside ${L.width}x${L.height}`);
        assert.equal(n.cx, Math.round((n.x + n.w / 2) * 10) / 10);
      }
      for (let i = 0; i < ns.length; i++) for (let j = i + 1; j < ns.length; j++) assert.ok(!overlap(ns[i], ns[j], 8), `${ns[i].id} overlaps ${ns[j].id}`);
    });

    test(`${sc.id} ${size.width}px ${size.mode}: edges start and end on node borders and labels never cover a node or each other`, () => {
      const L = computeLayout(sc, size);
      assert.equal(L.edges.length, sc.topology.edges.length);
      const boxes = [];
      for (const e of L.edges) {
        const a = L.nodes[e.from];
        const b = L.nodes[e.to];
        const p0 = e.pts[0];
        const p1 = e.pts[e.pts.length - 1];
        const onBorder = (n, p) => p.x >= n.x - 0.6 && p.x <= n.x + n.w + 0.6 && p.y >= n.y - 0.6 && p.y <= n.y + n.h + 0.6
          && (Math.abs(p.x - n.x) < 0.6 || Math.abs(p.x - n.x - n.w) < 0.6 || Math.abs(p.y - n.y) < 0.6 || Math.abs(p.y - n.y - n.h) < 0.6);
        assert.ok(onBorder(a, p0), `${e.key} starts on ${e.from}`);
        assert.ok(onBorder(b, p1), `${e.key} ends on ${e.to}`);
        assert.ok(e.len > 0 && e.d.startsWith('M'));
        assert.equal(e.cum.length, e.pts.length);
        assert.ok(Math.abs(e.cum[e.cum.length - 1] - e.len) < 1e-6);
        if (e.label) {
          for (const n of Object.values(L.nodes)) assert.ok(!(e.label.box.x1 < n.x + n.w && n.x < e.label.box.x2 && e.label.box.y1 < n.y + n.h && n.y < e.label.box.y2), `${e.key} label covers ${n.id}`);
          for (const o of boxes) assert.ok(!(e.label.box.x1 < o.x2 && o.x1 < e.label.box.x2 && e.label.box.y1 < o.y2 && o.y1 < e.label.box.y2), `${e.key} label overlaps another label`);
          boxes.push(e.label.box);
        }
      }
    });
  }
}

test('wide layouts of every shipped scenario give every edge a label at 872px', () => {
  for (const sc of SCENARIOS) {
    const L = computeLayout(sc, { width: 872, height: 480 });
    for (const e of L.edges) assert.ok(e.label, `${sc.id} ${e.key} has a label spot`);
  }
});

test('layout is deterministic and independent of object identity', () => {
  const sc = SCENARIOS.find((s) => s.id === 'cache-stampede');
  const a = computeLayout(sc, { width: 872, height: 480 });
  clearLayoutCache();
  const b = computeLayout(JSON.parse(JSON.stringify(sc)), { width: 872, height: 480 });
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test('layout is memoised per size and topology, and differs between sizes', () => {
  const sc = SCENARIOS[0];
  const a = computeLayout(sc, { width: 872, height: 480 });
  assert.equal(computeLayout(sc, { width: 872, height: 480 }), a);
  assert.notEqual(computeLayout(sc, { width: 900, height: 480 }), a);
  assert.equal(computeLayout(sc.topology, { width: 872, height: 480 }), a, 'a bare topology gives the same result as the scenario');
});

test('the template follows the container width: wide from 720px, tall below', () => {
  const sc = SCENARIOS[0];
  assert.equal(computeLayout(sc, { width: WIDE_MIN, height: 400 }).mode, 'wide');
  assert.equal(computeLayout(sc, { width: WIDE_MIN - 1, height: 400 }).mode, 'tall');
});

test('cache-stampede: tiers are columns (clients over lb, services, cache and third party, db over replica)', () => {
  const sc = SCENARIOS.find((s) => s.id === 'cache-stampede');
  const L = computeLayout(sc, { width: 872, height: 480 });
  const N = L.nodes;
  assert.equal(N.clients.x, N.lb.x);
  assert.ok(N.clients.y < N.lb.y, 'clients sit above the lb');
  assert.equal(N['service-1'].x, N['service-2'].x);
  assert.equal(N.cache.x, N['third-party'].x);
  assert.equal(N['db-primary'].x, N['db-replica'].x);
  assert.ok(N['db-primary'].y < N['db-replica'].y);
  assert.ok(N.lb.x < N['service-1'].x && N['service-1'].x < N.cache.x && N.cache.x < N['db-primary'].x);
  assert.equal(L.nodeW, 144);
});

test('tall layout: two columns, tier rows, node width at least 136 at phone widths', () => {
  const sc = SCENARIOS.find((s) => s.id === 'cache-stampede');
  for (const width of [358, 296]) {
    const L = computeLayout(sc, { width, height: 500 });
    assert.equal(L.mode, 'tall');
    assert.ok(L.nodeW >= 136, `width ${width}: nodeW ${L.nodeW}`);
    assert.ok(new Set(Object.values(L.nodes).map((n) => n.x)).size <= 2);
    assert.ok(L.width >= Math.max(...Object.values(L.nodes).map((n) => n.x + n.w)));
    assert.equal(L.nodes.clients.y, L.nodes.lb.y, 'clients and lb share the first tier row');
    assert.ok(L.nodes['service-1'].y > L.nodes.lb.y);
  }
});

test('long edges that skip a column route around the nodes in between', () => {
  const top = {
    nodes: { clients: { rps: 1 }, lb: { capacity: 1 }, 'service-1': { capacity: 1 }, 'service-2': { capacity: 1 }, 'db-primary': { capacity: 1 } },
    edges: [{ from: 'clients', to: 'lb' }, { from: 'lb', to: 'service-1' }, { from: 'service-1', to: 'service-2' }, { from: 'service-2', to: 'db-primary' }, { from: 'service-1', to: 'db-primary' }, { from: 'lb', to: 'db-primary' }],
  };
  const L = computeLayout(top, { width: 1000, height: 500 });
  const long = L.edges.find((e) => e.key === 'lb>db-primary');
  assert.equal(long.kind, 'long');
  const between = ['service-1', 'service-2'].map((id) => L.nodes[id]);
  for (const p of long.pts) for (const n of between) assert.ok(!(p.x > n.x && p.x < n.x + n.w && p.y > n.y && p.y < n.y + n.h), 'path passes through a node');
});

test('nearest moves spatially inside a 90 degree cone and returns null when nothing lies that way', () => {
  const sc = SCENARIOS.find((s) => s.id === 'cache-stampede');
  const L = computeLayout(sc, { width: 872, height: 480 });
  assert.equal(nearest(L, 'lb', 'right'), 'service-1');
  assert.equal(nearest(L, 'service-1', 'left'), 'lb');
  assert.equal(nearest(L, 'clients', 'down'), 'lb');
  assert.equal(nearest(L, 'lb', 'up'), 'clients');
  assert.equal(nearest(L, 'service-1', 'down'), 'service-2');
  assert.equal(nearest(L, 'clients', 'left'), null);
  assert.equal(nearest(L, 'db-replica', 'right'), null);
  assert.equal(nearest(L, 'nope', 'right'), null);
  assert.equal(nearest(L, 'lb', 'sideways'), null);
});

test('nearest prefers the straighter neighbour (angle weighted)', () => {
  const L = { nodes: {
    a: { cx: 0, cy: 0 }, near: { cx: 100, cy: 90 }, straight: { cx: 150, cy: 0 },
  }, order: ['a', 'near', 'straight'] };
  assert.equal(nearest(L, 'a', 'right'), 'straight');
});

test('pointAt walks the polyline and clamps at both ends', () => {
  const e = { pts: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], cum: [0, 10, 20], len: 20 };
  assert.deepEqual({ x: pointAt(e, 5).x, y: pointAt(e, 5).y }, { x: 5, y: 0 });
  assert.deepEqual({ x: pointAt(e, 15).x, y: pointAt(e, 15).y }, { x: 10, y: 5 });
  assert.equal(pointAt(e, -3).x, 0);
  assert.equal(pointAt(e, 99).y, 10);
  assert.equal(pointAt(e, 15).ty, 1);
});

test('computeLayout rejects input that is not a topology', () => {
  assert.throws(() => computeLayout(null), TypeError);
  assert.throws(() => computeLayout({ nodes: {} }), TypeError);
});
