'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { rosette, sealPath, sineBand, guilloche, ringGlyphs } = require('../src/page/geometry');

const NUM = /-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi;
const numbers = (d) => (d.match(NUM) || []).map(Number);
const points = (d) => {
  const n = numbers(d);
  assert.equal(n.length % 2, 0, 'path has an even count of coordinates');
  const out = [];
  for (let i = 0; i < n.length; i += 2) out.push([n[i], n[i + 1]]);
  return out;
};
const maxDecimals = (d) => (d.match(/\d+\.\d+/g) || []).every((s) => s.split('.')[1].length <= 2);
const noExponent = (d) => !/\d[eE][+-]?\d/.test(d);

test('rosette starts with M and ends with Z', () => {
  const d = rosette(36, 36, 15, 2.5, 4);
  assert.equal(typeof d, 'string');
  assert.ok(d.startsWith('M'));
  assert.ok(d.trimEnd().endsWith('Z'));
});

test('rosette is deterministic for the same arguments', () => {
  assert.equal(rosette(36, 36, 15, 2.5, 4), rosette(36, 36, 15, 2.5, 4));
  assert.equal(rosette(283, 400, 90, 15, 18, 120), rosette(283, 400, 90, 15, 18, 120));
});

test('rosette differs when its inputs differ', () => {
  assert.notEqual(rosette(36, 36, 15, 2.5, 4), rosette(530, 36, 15, 2.5, 4));
  assert.notEqual(rosette(36, 36, 15, 2.5, 4), rosette(36, 36, 15, 2.5, 5));
});

test('rosette rounds every number to at most 2 decimals and avoids exponents', () => {
  const d = rosette(36.123456, 36.987654, 15, 2.5, 4);
  assert.ok(maxDecimals(d));
  assert.ok(noExponent(d));
});

test('rosette keeps every point within R + r + d of its centre', () => {
  const [cx, cy, R, r, d] = [100, 200, 15, 2.5, 4];
  for (const [x, y] of points(rosette(cx, cy, R, r, d))) {
    assert.ok(Math.hypot(x - cx, y - cy) <= R + r + d + 0.02);
  }
});

test('rosette emits at least one point per step', () => {
  assert.ok(points(rosette(0, 0, 15, 2.5, 4, 36)).length >= 36);
  assert.ok(points(rosette(0, 0, 15, 2.5, 4, 3)).length >= 3);
});

test('rosette throws RangeError when steps is below 3', () => {
  assert.throws(() => rosette(0, 0, 15, 2.5, 4, 2), RangeError);
  assert.throws(() => rosette(0, 0, 15, 2.5, 4, 0), RangeError);
});

test('rosette throws RangeError when r is zero or negative', () => {
  assert.throws(() => rosette(0, 0, 15, 0, 4), RangeError);
  assert.throws(() => rosette(0, 0, 15, -1, 4), RangeError);
});

test('sealPath starts with M, ends with Z and is deterministic', () => {
  const d = sealPath(60, 60, 52, 4, 28);
  assert.ok(d.startsWith('M'));
  assert.ok(d.trimEnd().endsWith('Z'));
  assert.equal(d, sealPath(60, 60, 52, 4, 28));
});

test('sealPath keeps every point between base - amp and base + amp from the centre', () => {
  for (const [cx, cy] of [[60, 60], [0, 0], [-15.5, 220.25]]) {
    const pts = points(sealPath(cx, cy, 52, 4, 28));
    assert.ok(pts.length >= 3);
    for (const [x, y] of pts) {
      const dist = Math.hypot(x - cx, y - cy);
      assert.ok(dist >= 52 - 4 - 0.01 && dist <= 52 + 4 + 0.01, `distance ${dist}`);
    }
  }
});

test('sealPath with zero amplitude is a circle of radius base', () => {
  for (const [x, y] of points(sealPath(60, 60, 50, 0, 10, 72))) {
    assert.ok(Math.abs(Math.hypot(x - 60, y - 60) - 50) <= 0.01);
  }
});

test('sealPath rounds every number to at most 2 decimals', () => {
  const d = sealPath(60.333, 60.777, 52, 4, 28);
  assert.ok(maxDecimals(d));
  assert.ok(noExponent(d));
});

test('sealPath throws RangeError when teeth is below 1 or steps is below 3', () => {
  assert.throws(() => sealPath(60, 60, 52, 4, 0), RangeError);
  assert.throws(() => sealPath(60, 60, 52, 4, 28, 2), RangeError);
});

for (const edge of ['top', 'bottom', 'left', 'right']) {
  test(`sineBand returns a deterministic M path for the ${edge} edge`, () => {
    const d = sineBand(edge, 0, {});
    assert.equal(typeof d, 'string');
    assert.ok(d.startsWith('M'));
    assert.equal(d, sineBand(edge, 0, {}));
    assert.ok(maxDecimals(d));
  });
}

test('sineBand keeps each edge band near its centreline inside the sheet', () => {
  const within = (d, axis, lo, hi, otherLo, otherHi) => {
    for (const p of points(d)) {
      const a = p[axis];
      const b = p[1 - axis];
      assert.ok(a >= lo - 0.01 && a <= hi + 0.01, `cross-axis ${a}`);
      assert.ok(b >= otherLo - 0.01 && b <= otherHi + 0.01, `along-axis ${b}`);
    }
  };
  within(sineBand('top', 0, {}), 1, 22, 34, 36, 530);
  within(sineBand('bottom', 0, {}), 1, 766, 778, 36, 530);
  within(sineBand('left', 0, {}), 0, 22, 34, 36, 764);
  within(sineBand('right', 0, {}), 0, 532, 544, 36, 764);
});

test('sineBand gives a different path for each phase k', () => {
  const ds = [0, 1, 2].map((k) => sineBand('top', k, {}));
  assert.equal(new Set(ds).size, 3);
});

test('sineBand gives a different path for each edge', () => {
  const ds = ['top', 'bottom', 'left', 'right'].map((e) => sineBand(e, 0, {}));
  assert.equal(new Set(ds).size, 4);
});

test('sineBand throws RangeError for an unknown edge', () => {
  assert.throws(() => sineBand('middle', 0, {}), RangeError);
  assert.throws(() => sineBand('', 0, {}), RangeError);
});

test('guilloche returns 19 border path strings that each start with M', () => {
  const g = guilloche();
  assert.ok(Array.isArray(g));
  assert.equal(g.length, 19);
  for (const d of g) {
    assert.equal(typeof d, 'string');
    assert.ok(d.startsWith('M'));
  }
});

test('guilloche paths are all distinct', () => {
  assert.equal(new Set(guilloche()).size, 19);
});

test('guilloche is deterministic and rounds to at most 2 decimals', () => {
  const a = guilloche();
  assert.deepEqual(a, guilloche());
  for (const d of a) {
    assert.ok(maxDecimals(d));
    assert.ok(noExponent(d));
  }
});

test('ringGlyphs returns one entry per character of the text', () => {
  const text = 'AUTHENTIC * GREETING OFFICE *';
  const g = ringGlyphs(text, 34, 60, 60);
  assert.equal(g.length, Array.from(text).length);
  assert.deepEqual(g.map((e) => e.ch), Array.from(text));
});

test('ringGlyphs sets rot to i * 360 / n for each glyph', () => {
  const text = 'AUTHENTIC * GREETING OFFICE *';
  const n = Array.from(text).length;
  ringGlyphs(text, 34, 60, 60).forEach((e, i) => {
    assert.ok(Math.abs(e.rot - (i * 360) / n) <= 0.01, `rot ${e.rot} at ${i}`);
  });
});

test('ringGlyphs places every glyph at distance r from the centre', () => {
  for (const [r, cx, cy] of [[34, 60, 60], [10, -5, 7.5]]) {
    for (const e of ringGlyphs('AUTHENTIC * GREETING OFFICE *', r, cx, cy)) {
      assert.ok(Math.abs(Math.hypot(e.x - cx, e.y - cy) - r) <= 0.01);
    }
  }
});

test('ringGlyphs rounds coordinates to at most 2 decimals', () => {
  for (const e of ringGlyphs('HELLO OVERKILL', 34, 60, 60)) {
    for (const v of [e.x, e.y, e.rot]) assert.ok(maxDecimals(String(v)), String(v));
  }
});

test('ringGlyphs returns an empty list for empty text', () => {
  assert.deepEqual(ringGlyphs('', 34, 60, 60), []);
});
