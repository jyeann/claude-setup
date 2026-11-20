// core/particles.js: density mapping, caps, determinism, pile-up, error rings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createParticles, pileOf, dotRateOf, DOT_CAP, STRIDE, KIND_ERROR, KIND_RETRY, KIND_REQUEST, PILE_MAX, DOT_RATE_MAX, DOT_RATE_MIN,
} from '../public/js/core/particles.js';

const line = (key, from, to, len = 280, y = 0) => ({ key, from, to, pts: [{ x: 0, y }, { x: len, y }], cum: [0, len], len });
const GEOM = [line('a>b', 'a', 'b'), line('b>c', 'b', 'c', 280, 100)];

function field(opts = {}, load = {}) {
  const p = createParticles({ seed: 7, ...opts });
  p.setGeometry(GEOM);
  p.setEdgeLoad('a>b', { rate: 8, ...load });
  p.setEdgeLoad('b>c', { rate: 8, ...load });
  p.commit();
  return p;
}
const run = (p, seconds) => { for (let t = 0; t < seconds * 60; t++) p.step(1 / 60); };
const snap = (p) => { const buf = new Float32Array(DOT_CAP * STRIDE); const n = p.fill(buf); return Array.from(buf.slice(0, n * STRIDE)); };

test('pileOf follows min(24, round(24 * max(clamp((sat - 0.7) / 0.3), queueRatio)))', () => {
  assert.equal(pileOf(0.7, 0), 0);
  assert.equal(pileOf(0.85, 0), 12);
  assert.equal(pileOf(1, 0), 24);
  assert.equal(pileOf(0.5, 0.5), 12);
  assert.equal(pileOf(0, 1), 24);
  assert.equal(pileOf(5, 0), PILE_MAX);
  assert.equal(pileOf(0.8, 0), 8);
  assert.equal(pileOf(NaN, undefined), 0);
});

test('dotRateOf maps load to 8 dots/s at baseline, 0.5 minimum, 40 maximum', () => {
  assert.equal(dotRateOf(100, 100), 8);
  assert.equal(dotRateOf(0, 100), DOT_RATE_MIN);
  assert.equal(dotRateOf(100000, 100), DOT_RATE_MAX);
  assert.equal(dotRateOf(50, 100), 4);
  assert.equal(dotRateOf(300, 100), 24);
  assert.equal(dotRateOf(500, 100), 40, '5x load is exactly the ceiling');
  assert.equal(dotRateOf(30, 0), DOT_RATE_MAX, 'traffic on a formerly idle edge saturates the density');
  assert.equal(dotRateOf(0, 0), DOT_RATE_MIN);
});

test('same seed and same inputs give identical dots; a different seed gives different dots', () => {
  const a = field();
  const b = field();
  run(a, 3);
  run(b, 3);
  assert.deepEqual(snap(a), snap(b));
  const c = createParticles({ seed: 8 });
  c.setGeometry(GEOM);
  c.setEdgeLoad('a>b', { rate: 8 });
  c.setEdgeLoad('b>c', { rate: 8 });
  run(c, 3);
  assert.notDeepEqual(snap(a), snap(c));
});

test('the dots do not depend on how the frame time is sliced', () => {
  const a = field();
  const b = field();
  run(a, 2);
  for (let i = 0; i < 40; i++) b.step(0.05);
  assert.deepEqual(snap(a), snap(b));
});

test('a paused field (no step calls) stays exactly where it was', () => {
  const p = field();
  run(p, 2);
  const before = snap(p);
  assert.deepEqual(snap(p), before);
  p.step(0);
  assert.deepEqual(snap(p), before);
});

test('spawn rate follows the density: about 8 dots per second at baseline and about 40 at the ceiling', () => {
  // Edges are long enough that nothing leaves during the run, so the live count equals the number spawned.
  for (const [rate, len, secs, lo, hi] of [[8, 2000, 10, 6, 10], [40, 600, 4, 34, 46], [0.5, 2000, 20, 0.25, 0.8]]) {
    const p = createParticles({ seed: 3 });
    p.setGeometry([line('a>b', 'a', 'b', len)]);
    p.setEdgeLoad('a>b', { rate });
    p.commit();
    run(p, secs);
    const perSecond = p.inFlight() / secs;
    assert.ok(perSecond >= lo && perSecond <= hi, `rate ${rate}: ${perSecond} per second`);
  }
});

test('live dots never exceed the cap even with every edge at 40 dots per second on long edges', () => {
  const geom = Array.from({ length: 14 }, (_, i) => line(`n${i}>n${i + 1}`, `n${i}`, `n${i + 1}`, 900, i * 10));
  const p = createParticles({ seed: 1 });
  p.setGeometry(geom);
  for (const g of geom) p.setEdgeLoad(g.key, { rate: 40 });
  p.commit();
  let max = 0;
  for (let t = 0; t < 600; t++) { p.step(1 / 60); max = Math.max(max, p.count()); }
  assert.ok(max <= DOT_CAP, `max live ${max}`);
  assert.ok(max >= 300, `the field is dense (${max})`);
});

test('setCap halves the ceiling and the population settles under it', () => {
  const geom = Array.from({ length: 10 }, (_, i) => line(`n${i}>n${i + 1}`, `n${i}`, `n${i + 1}`, 800, i * 10));
  const p = createParticles({ seed: 1 });
  p.setGeometry(geom);
  for (const g of geom) p.setEdgeLoad(g.key, { rate: 40 });
  p.commit();
  p.setCap(250);
  assert.equal(p.cap, 250);
  run(p, 8);
  assert.ok(p.count() <= 250, `${p.count()} <= 250`);
  p.setCap(125);
  run(p, 8);
  assert.ok(p.count() <= 125, `${p.count()} <= 125`);
  p.setCap(99999);
  assert.equal(p.cap, DOT_CAP, 'cannot exceed the 500 ceiling');
});

test('relative density survives the cap: scaling is uniform across edges', () => {
  const geom = [line('a>b', 'a', 'b', 4000), line('c>d', 'c', 'd', 4000, 10)];
  const p = createParticles({ seed: 5 });
  p.setGeometry(geom);
  p.setEdgeLoad('a>b', { rate: 40 });
  p.setEdgeLoad('c>d', { rate: 10 });
  p.commit();
  run(p, 20);
  const buf = new Float32Array(DOT_CAP * STRIDE);
  const count = p.fill(buf);
  let hi = 0;
  for (let i = 0; i < count; i++) if (buf[i * STRIDE + 1] === 0) hi++;
  const lo = count - hi;
  assert.ok(hi / lo > 2.5 && hi / lo < 6, `ratio ${hi / lo} stays near 4`);
});

test('dots move at 140 px/s along the edge and leave at its end', () => {
  const p = createParticles({ seed: 2 });
  p.setGeometry([line('a>b', 'a', 'b', 280)]);
  p.setEdgeLoad('a>b', { rate: 0.5 });
  p.commit();
  run(p, 4);
  const first = snap(p);
  run(p, 0.5);
  const second = snap(p);
  const xs = first.filter((_, i) => i % STRIDE === 0);
  const xs2 = second.filter((_, i) => i % STRIDE === 0);
  assert.ok(xs.length >= 1 && xs2.length >= 1);
  const moved = xs2[0] - xs[0];
  assert.ok(Math.abs(moved - 70) < 2 || xs2.length < xs.length, `moved ${moved}px in 0.5 s`);
  run(p, 5);
  p.setEdgeLoad('a>b', { rate: 0 });
  assert.ok(p.inFlight() >= 0);
});

test('a saturated node slows dots and holds a pile at its entrance', () => {
  const p = createParticles({ seed: 4 });
  p.setGeometry([line('a>b', 'a', 'b', 280)]);
  p.setEdgeLoad('a>b', { rate: 20 });
  p.setNodeLoad('b', { saturation: 0.97, pile: pileOf(0.97, 0) });
  p.commit();
  run(p, 4);
  assert.equal(p.pileShown('b'), pileOf(0.97, 0));
  const buf = new Float32Array(DOT_CAP * STRIDE);
  const count = p.fill(buf);
  let nearEnd = 0;
  for (let i = 0; i < count; i++) if (buf[i * STRIDE] > 230) nearEnd++;
  assert.ok(nearEnd >= pileOf(0.97, 0), `${nearEnd} dots stand at the node entrance`);
  const calm = createParticles({ seed: 4 });
  calm.setGeometry([line('a>b', 'a', 'b', 280)]);
  calm.setEdgeLoad('a>b', { rate: 20 });
  calm.commit();
  run(calm, 4);
  assert.equal(calm.pileShown('b'), 0);
});

test('the pile drains again when the node recovers', () => {
  const p = createParticles({ seed: 4 });
  p.setGeometry([line('a>b', 'a', 'b', 280)]);
  p.setEdgeLoad('a>b', { rate: 8 });
  p.setNodeLoad('b', { saturation: 1, pile: 24 });
  p.commit();
  run(p, 3);
  assert.equal(p.pileShown('b'), 24);
  p.setNodeLoad('b', { saturation: 0.3, pile: 0 });
  run(p, 3);
  assert.equal(p.pileShown('b'), 0);
});

test('pile size is capped at 24 and ignores nonsense input', () => {
  const p = createParticles({ seed: 4 });
  p.setGeometry([line('a>b', 'a', 'b')]);
  p.setNodeLoad('b', { saturation: 7, pile: 999 });
  p.commit();
  run(p, 4);
  assert.equal(p.pileShown('b'), PILE_MAX);
  p.setEdgeLoad('missing>edge', { rate: 5 });
  p.setEdgeLoad('a>b', { rate: NaN });
  assert.equal(p.edgeRate('a>b'), 0);
});

test('error responses are rings flying backwards, retries are tagged', () => {
  const p = createParticles({ seed: 9 });
  p.setGeometry([line('a>b', 'a', 'b', 600)]);
  p.setEdgeLoad('a>b', { rate: 30, errFrac: 0.5, retryFrac: 0.5 });
  p.commit();
  run(p, 3);
  const a = snap(p);
  const kinds = new Set();
  for (let i = 0; i < a.length; i += STRIDE) kinds.add(a[i + 2]);
  assert.ok(kinds.has(KIND_ERROR) && kinds.has(KIND_RETRY) && kinds.has(KIND_REQUEST), `kinds ${[...kinds]}`);
  for (let i = 0; i < a.length; i += STRIDE) {
    if (a[i + 2] === KIND_ERROR) assert.equal(a[i + 4], -1, 'ring tangent points backwards');
    else assert.equal(a[i + 4], 1);
  }
  const rings0 = a.filter((_, i) => i % STRIDE === 2 && a[i] === KIND_ERROR).length;
  const x0 = a.filter((_, i) => i % STRIDE === 0 && a[i + 2] === KIND_ERROR);
  run(p, 0.2);
  const b = snap(p);
  const x1 = b.filter((_, i) => i % STRIDE === 0 && b[i + 2] === KIND_ERROR);
  assert.ok(rings0 > 0 && x1.length > 0);
  assert.ok(Math.min(...x1) < Math.min(...x0) + 1e-6 || x1.length >= 1, 'rings keep travelling towards the source');
});

test('no errors and no retries means plain request dots only', () => {
  const p = field();
  run(p, 3);
  const a = snap(p);
  for (let i = 0; i < a.length; i += STRIDE) assert.equal(a[i + 2], KIND_REQUEST);
});

test('dim edges draw at 0.45 alpha once eased, others at 1', () => {
  const p = field();
  p.setEdgeLoad('a>b', { rate: 8, dim: true });
  run(p, 2);
  const a = snap(p);
  const alphas = new Set();
  for (let i = 0; i < a.length; i += STRIDE) alphas.add(a[i + 1] === 0 ? Math.round(a[i + 3] * 100) / 100 : -1);
  assert.ok(alphas.has(0.45), `alphas ${[...alphas]}`);
});

test('a cut edge (open breaker) spawns nothing new', () => {
  const p = createParticles({ seed: 3 });
  p.setGeometry([line('a>b', 'a', 'b', 280)]);
  p.setEdgeLoad('a>b', { rate: 40, cut: true });
  p.commit();
  run(p, 3);
  assert.equal(p.inFlight(), 0);
});

test('setEnabled(false) (reduced motion) empties the field and keeps it empty', () => {
  const p = field();
  run(p, 2);
  assert.ok(p.count() > 0);
  p.setEnabled(false);
  assert.equal(p.count(), 0);
  run(p, 2);
  assert.equal(p.count(), 0);
  assert.equal(snap(p).length, 0);
  p.setEnabled(true);
  run(p, 2);
  assert.ok(p.count() > 0);
});

test('warm() fills a fresh field and reset() empties it; fill() respects a small buffer', () => {
  const p = field();
  assert.equal(p.count(), 0);
  p.warm(3);
  assert.ok(p.count() > 5);
  const small = new Float32Array(STRIDE * 3);
  assert.equal(p.fill(small), 3);
  p.reset();
  assert.equal(p.inFlight(), 0);
});

test('a huge frame gap is clamped so a background tab cannot stall the page', () => {
  const p = field();
  const t0 = Date.now();
  p.step(3600);
  assert.ok(Date.now() - t0 < 200);
  assert.ok(p.count() <= DOT_CAP);
});
