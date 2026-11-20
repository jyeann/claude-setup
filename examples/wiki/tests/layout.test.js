import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLayout, runFor, fitToBox, truncateLabel, MAX_ITERATIONS } from '../public/js/layout.js';

const snapshot = (l) => [...l.x, ...l.y].map((v) => v.toFixed(6)).join(',');

test('the same graph always gives the same positions', () => {
  const edges = [[0, 1], [1, 2], [2, 3], [3, 0]];
  const a = createLayout(5, edges);
  const b = createLayout(5, edges);
  runFor(a, {});
  runFor(b, {});
  assert.equal(snapshot(a), snapshot(b));
  assert.ok(a.done);
});

test('the initial seed is a sunflower spiral around the origin', () => {
  const l = createLayout(3, []);
  assert.equal(l.x[0], 0);
  assert.equal(l.y[0], 0);
  assert.ok(Math.abs(Math.hypot(l.x[1], l.y[1]) - 30) < 1e-9);
  assert.ok(Math.abs(Math.hypot(l.x[2], l.y[2]) - 30 * Math.sqrt(2)) < 1e-9);
});

test('iterations stop at the cap of 300', () => {
  const edges = Array.from({ length: 49 }, (_, i) => [i, i + 1]);
  const l = createLayout(50, edges, { maxIterations: 300 });
  const ran = runFor(l, {});
  assert.ok(ran <= MAX_ITERATIONS);
  assert.equal(l.iteration, ran);
  assert.ok(l.done);
  assert.equal(l.step(), 0);
  assert.equal(l.iteration, ran);
});

test('runFor honours the iteration limit and the time budget', () => {
  const l = createLayout(30, []);
  assert.equal(runFor(l, { iterations: 5 }), 5);
  assert.equal(l.iteration, 5);
  let t = 0;
  const ran = runFor(l, { budgetMs: 10, now: () => (t += 4) });
  assert.ok(ran >= 1 && ran <= 3, `ran ${ran}`);
});

test('an empty graph is done at once and a single node stays put', () => {
  assert.equal(createLayout(0, []).done, true);
  const one = createLayout(1, []);
  runFor(one, {});
  assert.ok(one.done);
  assert.equal(one.x[0], 0);
});

test('connected nodes end up closer than unconnected ones', () => {
  const l = createLayout(4, [[0, 1]]);
  runFor(l, {});
  const d = (i, j) => Math.hypot(l.x[i] - l.x[j], l.y[i] - l.y[j]);
  assert.ok(d(0, 1) < d(0, 3));
});

test('nodes repel: no two nodes end up on the same spot', () => {
  const l = createLayout(40, []);
  runFor(l, {});
  let min = Infinity;
  for (let i = 0; i < 40; i += 1) for (let j = i + 1; j < 40; j += 1) min = Math.min(min, Math.hypot(l.x[i] - l.x[j], l.y[i] - l.y[j]));
  assert.ok(min > 5, `closest pair ${min}`);
});

test('1,000 nodes lay out well inside the time budget', () => {
  const edges = [];
  for (let i = 0; i < 1000; i += 1) edges.push([i, (i * 7 + 13) % 1000], [i, (i * 31 + 5) % 1000]);
  const l = createLayout(1000, edges.filter(([a, b]) => a !== b));
  const t0 = performance.now();
  runFor(l, { iterations: 60 });
  assert.ok(performance.now() - t0 < 1500, 'first 60 iterations under 1.5 s');
  assert.equal(l.iteration, 60);
});

test('fitToBox keeps every point inside the box with padding', () => {
  const l = createLayout(10, []);
  runFor(l, {});
  const fit = fitToBox(l, 10, 400, 300, { pad: 40 });
  for (let i = 0; i < 10; i += 1) {
    const px = l.x[i] * fit.scale + fit.offsetX;
    const py = l.y[i] * fit.scale + fit.offsetY;
    assert.ok(px >= 39.999 && px <= 360.001, `x ${px}`);
    assert.ok(py >= 39.999 && py <= 260.001, `y ${py}`);
  }
  assert.ok(fit.scale <= 1.5);
});

test('fitToBox handles no nodes and a single node', () => {
  assert.deepEqual(fitToBox({ x: [], y: [] }, 0, 200, 100), { scale: 1, offsetX: 100, offsetY: 50 });
  const one = fitToBox({ x: [5], y: [7] }, 1, 200, 100);
  assert.ok(Math.abs(5 * one.scale + one.offsetX - 100) < 1e-9);
  assert.ok(Math.abs(7 * one.scale + one.offsetY - 50) < 1e-9);
});

test('truncateLabel cuts at 24 characters and counts code points', () => {
  assert.equal(truncateLabel('short'), 'short');
  assert.equal(truncateLabel('x'.repeat(24)), 'x'.repeat(24));
  const cut = truncateLabel('y'.repeat(30));
  assert.equal([...cut].length, 24);
  assert.ok(cut.endsWith('…'));
  assert.equal([...truncateLabel('\u{1F600}'.repeat(30))].length, 24);
});

import { hitRadii } from '../public/js/layout.js';

test('hit circles keep the full radius for isolated nodes and shrink in dense clusters', () => {
  const sparse = hitRadii([0, 500], [0, 0], 2, 28, 11);
  assert.deepEqual([...sparse], [28, 28]);
  const dense = hitRadii([0, 20, 200], [0, 0, 0], 3, 28, 11);
  assert.equal(dense[0], 11);
  assert.equal(dense[1], 11);
  assert.equal(dense[2], 28);
  const pair = hitRadii([0, 40], [0, 0], 2, 28, 11);
  assert.equal(pair[0], 19);
});

test('no hit circle covers another node centre once radii are shrunk', () => {
  const px = new Float64Array(200);
  const py = new Float64Array(200);
  for (let i = 0; i < 200; i += 1) { px[i] = (i % 20) * 23 + (i % 7); py[i] = Math.floor(i / 20) * 29 + (i % 5); }
  const r = hitRadii(px, py, 200, 28, 11);
  for (let i = 0; i < 200; i += 1) for (let j = 0; j < 200; j += 1) {
    if (i === j) continue;
    const d = Math.hypot(px[i] - px[j], py[i] - py[j]);
    if (d > 2 * 11 + 2) assert.ok(d > r[i], `circle ${i} reaches centre ${j}`);
  }
});

import { separate } from '../public/js/layout.js';

test('separate pushes stacked nodes apart to the minimum distance and is deterministic', () => {
  const make = () => ({ x: new Float64Array([0, 0.5, 1, 100]), y: new Float64Array([0, 0, 0.2, 0]) });
  const a = make();
  const b = make();
  separate(a, 4, 20, 30);
  separate(b, 4, 20, 30);
  assert.deepEqual([...a.x], [...b.x]);
  for (let i = 0; i < 3; i += 1) for (let j = i + 1; j < 3; j += 1) {
    assert.ok(Math.hypot(a.x[i] - a.x[j], a.y[i] - a.y[j]) > 18, `pair ${i}-${j}`);
  }
  assert.equal(a.x[3], 100);
});

test('separate handles identical positions and leaves spread nodes alone', () => {
  const same = { x: new Float64Array([5, 5]), y: new Float64Array([5, 5]) };
  separate(same, 2, 10);
  assert.ok(Math.hypot(same.x[0] - same.x[1], same.y[0] - same.y[1]) >= 9.9);
  const far = { x: new Float64Array([0, 50]), y: new Float64Array([0, 0]) };
  separate(far, 2, 10);
  assert.deepEqual([...far.x], [0, 50]);
});

test('fitToBox grows a small layout to fill the box when maxScale allows it, and stays inside the padding', () => {
  const l = { x: [0, 10, 5], y: [0, 4, 8] };
  const small = fitToBox(l, 3, 800, 600, { pad: 60 });
  const big = fitToBox(l, 3, 800, 600, { pad: 60, maxScale: 5 });
  assert.equal(small.scale, 1.5);
  assert.ok(big.scale > small.scale);
  const ys = l.y.map((y) => y * big.scale + big.offsetY);
  const xs = l.x.map((x) => x * big.scale + big.offsetX);
  assert.ok(Math.min(...xs) >= 59.999 && Math.max(...xs) <= 740.001);
  assert.ok(Math.min(...ys) >= 59.999 && Math.max(...ys) <= 540.001);
  assert.ok(Math.abs((Math.min(...ys) + Math.max(...ys)) / 2 - 300) < 1e-9, 'centred');
});
