'use strict';
// Pure SVG geometry for the certificate artifact. Computed once in Node and inlined into the page as static
// path data, so the browser draws the guilloche and seal on first paint and the CSP-hashed script stays small.
// Every coordinate is rounded to at most 2 decimals so the output (and therefore the page hash) is stable.

const TAU = Math.PI * 2;
const r2 = (n) => {
  const v = Math.round(n * 100) / 100;
  return Object.is(v, -0) ? 0 : v;
};
// Implicit lineto: coordinate pairs after the first M are straight segments, which keeps the inlined page small.
const pathOf = (pts, close) => `M${pts.map(([x, y]) => `${r2(x)} ${r2(y)}`).join(' ')}${close ? 'Z' : ''}`;

// Epitrochoid: a point at distance d from the centre of a circle of radius r rolling around one of radius R.
function rosette(cx, cy, R, r, d, steps = 360) {
  if (!(steps >= 3)) throw new RangeError('steps must be at least 3');
  if (!(r > 0)) throw new RangeError('r must be positive');
  const k = (R + r) / r;
  const pts = [];
  for (let i = 0; i < steps; i += 1) {
    const t = (TAU * i) / steps;
    pts.push([cx + (R + r) * Math.cos(t) - d * Math.cos(k * t), cy + (R + r) * Math.sin(t) - d * Math.sin(k * t)]);
  }
  return pathOf(pts, true);
}

// Scalloped wax-seal edge: radius base + amp * cos(teeth * t).
function sealPath(cx, cy, base, amp, teeth, steps = 360) {
  if (!(teeth >= 1)) throw new RangeError('teeth must be at least 1');
  if (!(steps >= 3)) throw new RangeError('steps must be at least 3');
  const pts = [];
  for (let i = 0; i < steps; i += 1) {
    const t = (TAU * i) / steps;
    const rad = base + amp * Math.cos(teeth * t);
    pts.push([cx + rad * Math.cos(t), cy + rad * Math.sin(t)]);
  }
  return pathOf(pts, true);
}

const SHEET = { w: 566, h: 800, inset: 28, start: 36, amp: 6, period: 38, step: 4 };

// One sine band along an edge of the 566 x 800 sheet; k (0..2) shifts the phase by k * 2pi/3.
function sineBand(edge, k, opts) {
  const o = { ...SHEET, ...(opts || {}) };
  const horizontal = edge === 'top' || edge === 'bottom';
  if (!horizontal && edge !== 'left' && edge !== 'right') throw new RangeError(`unknown edge: ${edge}`);
  const centre = { top: o.inset, bottom: o.h - o.inset, left: o.inset, right: o.w - o.inset }[edge];
  const end = horizontal ? o.w - o.start : o.h - o.start;
  const phase = (k * TAU) / 3;
  const pts = [];
  for (let s = o.start; s <= end; s += o.step) {
    const off = centre + o.amp * Math.sin((TAU * (s - o.start)) / o.period + phase);
    pts.push(horizontal ? [s, off] : [off, s]);
  }
  return pathOf(pts, false);
}

const rect = (x, y, w, h) => pathOf([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], true);

// All border paths in drawing order: outer rule, inner rule, 12 bands, 4 corner rosettes, watermark.
function guilloche(opts) {
  const o = { ...SHEET, ...(opts || {}) };
  const out = [rect(10, 10, o.w - 20, o.h - 20), rect(18, 18, o.w - 36, o.h - 36)];
  for (const edge of ['top', 'bottom', 'left', 'right']) for (let k = 0; k < 3; k += 1) out.push(sineBand(edge, k, o));
  const c = o.start;
  for (const [x, y] of [[c, c], [o.w - c, c], [c, o.h - c], [o.w - c, o.h - c]]) out.push(rosette(x, y, 15, 2.5, 4, 180));
  out.push(rosette(o.w / 2, o.h / 2, 75, 15, 18, 240));
  // Decorative border art: one decimal is below a device pixel at any print or screen size.
  return out.map((d) => d.replace(/-?\d+\.\d+/g, (n) => String(r2(Math.round(Number(n) * 10) / 10))));
}

// Per-glyph placement for ring text (no textPath): glyph i sits at angle i * 360 / n, measured from 12 o'clock.
function ringGlyphs(text, r, cx, cy) {
  const chars = Array.from(String(text));
  const n = chars.length;
  return chars.map((ch, i) => {
    const rot = (i * 360) / n;
    const a = (rot * Math.PI) / 180;
    return { ch, x: r2(cx + r * Math.sin(a)), y: r2(cy - r * Math.cos(a)), rot: r2(rot) };
  });
}

module.exports = { rosette, sealPath, sineBand, guilloche, ringGlyphs };
