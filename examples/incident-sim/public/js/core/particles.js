// Request-dot field for the system map. Pure: no DOM, no clock, no Math.random.
//
// The field is a fixed-step simulation (1/60 s) driven by its own mulberry32 stream seeded with seed ^ 0xA5A5A5A5, so the same
// seed and the same sequence of inputs always give the same dots, whatever the frame timing; a paused map simply stops stepping and
// stays stable. It never feeds anything back into the engine.
//
//   density   dots per second per edge = dotRateOf(rps, baselineRps) = clamp(rps / baseline * 8, 0.5, 40)
//   cap       live dots never exceed `cap` (500); when the expected population is higher every spawn rate is scaled down uniformly
//   pile-up   dots slow down in the last 24 px before a node above 70% saturation (speed * (1 - saturation)) and are absorbed by a
//             pile of at most 24 dots (3 per row) standing at the node entrance; the pile size is pileOf(saturation, queueRatio)
//   errors    hollow rings flying backwards at 1.3x; retries are request dots with a 10 px tail
import { next } from '../engine/prng.js';

export const DOT_RATE_BASE = 8;
export const DOT_RATE_MIN = 0.5;
export const DOT_RATE_MAX = 40;
export const DOT_CAP = 500;
export const PILE_MAX = 24;
export const DOT_SPEED = 140; // px per second
export const ERROR_SPEED_FACTOR = 1.3;
export const SLOW_ZONE = 24; // px before a saturated node where dots slow down
export const SLOW_FROM = 0.7; // saturation where slowing starts
export const DIM_ALPHA = 0.45;
export const KIND_REQUEST = 0;
export const KIND_RETRY = 1;
export const KIND_ERROR = 2;
export const STRIDE = 6; // floats per dot written by fill(): x, y, kind, alpha, tx, ty
const STEP = 1 / 60;
const MAX_CATCHUP = 0.25; // seconds of simulated time per step() call at most
const PILE_ROW = 5; // px between pile rows
const PILE_COLS = 3;
const MIN_SLOW = 0.08;

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

// min(24, round(24 * max(clamp((saturation - 0.7) / 0.3, 0, 1), queueRatio)))
export function pileOf(saturation, queueRatio = 0) {
  const s = Number.isFinite(saturation) ? saturation : 0;
  const q = Number.isFinite(queueRatio) ? queueRatio : 0;
  return Math.min(PILE_MAX, Math.round(PILE_MAX * Math.max(clamp((s - 0.7) / 0.3, 0, 1), q)));
}

// clamp(rps / baselineRps * 8, 0.5, 40). A zero baseline (an edge that was idle when calm) reads as the maximum once traffic shows up.
export function dotRateOf(rps, baselineRps) {
  const r = Number.isFinite(rps) && rps > 0 ? rps : 0;
  const b = Number.isFinite(baselineRps) && baselineRps > 0 ? baselineRps : 0;
  if (b === 0) return r > 0 ? DOT_RATE_MAX : DOT_RATE_MIN;
  return clamp((r / b) * DOT_RATE_BASE, DOT_RATE_MIN, DOT_RATE_MAX);
}

export function createParticles({ seed = 1, cap = DOT_CAP, speed = DOT_SPEED } = {}) {
  let rng = ((seed >>> 0) ^ 0xA5A5A5A5) >>> 0 || 1;
  const rand = () => { const [s, u] = next(rng); rng = s; return u; };
  const hardMax = Math.max(1, Math.floor(cap));
  let capNow = hardMax;
  let enabled = true;
  let edges = []; // geometry + per-edge load
  let byKey = new Map();
  const nodes = new Map(); // id -> {saturation, pileTarget, pileShown, edge}
  const ei = new Uint16Array(hardMax);
  const ds = new Float32Array(hardMax);
  const dk = new Uint8Array(hardMax);
  let n = 0;
  let scale = 1;
  let acc = 0;

  const node = (id) => {
    let o = nodes.get(id);
    if (!o) { o = { saturation: 0, pileTarget: 0, pileShown: 0, edge: -1 }; nodes.set(id, o); }
    return o;
  };

  const pileDepth = (o) => (o && o.pileShown >= 0.5 ? Math.ceil(Math.round(o.pileShown) / PILE_COLS) * PILE_ROW + 2 : 0);

  function recomputeScale() {
    let expected = 0;
    for (const e of edges) expected += e.rate * (1 + e.errFrac) * (e.len / speed + 0.2);
    scale = expected > capNow ? capNow / expected : 1;
  }

  function choosePileEdges() {
    for (const o of nodes.values()) o.edge = -1;
    const best = new Map();
    edges.forEach((e, i) => {
      const cur = best.get(e.to);
      if (cur === undefined || e.rate > edges[cur].rate) best.set(e.to, i);
    });
    for (const [id, i] of best) node(id).edge = i;
  }

  function spawn(i, kind, atEnd) {
    if (n >= capNow || n >= hardMax) return;
    ei[n] = i;
    ds[n] = atEnd ? edges[i].len : 0;
    dk[n] = kind;
    n++;
  }

  function killAt(k) {
    n--;
    ei[k] = ei[n];
    ds[k] = ds[n];
    dk[k] = dk[n];
  }

  function sim(dt) {
    // per-edge easing of the dim alpha
    for (const e of edges) e.alpha += (e.dimTarget - e.alpha) * Math.min(1, dt / 0.2);
    for (const o of nodes.values()) {
      const d = o.pileTarget - o.pileShown;
      o.pileShown += d > 0 ? Math.min(d, 36 * dt) : Math.max(d, -18 * dt);
    }
    if (enabled) {
      for (let i = 0; i < edges.length; i++) {
        const e = edges[i];
        if (e.cut) continue;
        const r = e.rate * scale;
        if (r > 0) {
          e.acc += r * dt;
          while (e.acc >= e.nextAt) {
            e.acc -= e.nextAt;
            e.nextAt = 0.5 + rand();
            spawn(i, rand() < e.retryFrac ? KIND_RETRY : KIND_REQUEST, false);
          }
        }
        if (e.errFrac > 0) {
          e.accErr += r * e.errFrac * dt;
          while (e.accErr >= e.nextErr) {
            e.accErr -= e.nextErr;
            e.nextErr = 0.5 + rand();
            spawn(i, KIND_ERROR, true);
          }
        }
      }
    }
    for (let k = n - 1; k >= 0; k--) {
      const e = edges[ei[k]];
      if (dk[k] === KIND_ERROR) {
        ds[k] -= speed * ERROR_SPEED_FACTOR * dt;
        if (ds[k] <= 0) killAt(k);
        continue;
      }
      const o = nodes.get(e.to);
      const end = e.len - pileDepth(o);
      let mul = 1;
      if (o && o.saturation > SLOW_FROM && ds[k] > end - SLOW_ZONE) mul = Math.max(MIN_SLOW, 1 - o.saturation);
      ds[k] += speed * mul * dt;
      if (ds[k] >= end) killAt(k);
    }
  }

  const api = {
    // edges: [{key, from, to, pts, cum, len}] from core/layout.js
    setGeometry(list) {
      edges = list.map((g) => ({
        key: g.key, from: g.from, to: g.to, pts: g.pts, cum: g.cum, len: g.len,
        rate: 0, errFrac: 0, retryFrac: 0, dimTarget: 1, alpha: 1, cut: false, acc: 0, nextAt: 0.5 + rand(), accErr: 0, nextErr: 0.5 + rand(),
      }));
      for (const e of edges) { e.acc = rand() * e.nextAt; e.accErr = rand() * e.nextErr; }
      byKey = new Map(edges.map((e, i) => [e.key, i]));
      n = 0;
      choosePileEdges();
      recomputeScale();
    },
    // load: {rate (dots/s), errFrac 0..1, retryFrac 0..1, dim (bool), cut (bool)}
    setEdgeLoad(key, load) {
      const i = byKey.get(key);
      if (i === undefined) return;
      const e = edges[i];
      e.rate = clamp(Number.isFinite(load.rate) ? load.rate : 0, 0, DOT_RATE_MAX);
      e.errFrac = clamp(load.errFrac || 0, 0, 1);
      e.retryFrac = clamp(load.retryFrac || 0, 0, 1);
      e.dimTarget = load.dim ? DIM_ALPHA : 1;
      e.cut = !!load.cut;
    },
    setNodeLoad(id, { saturation = 0, pile = 0 }) {
      const o = node(id);
      o.saturation = clamp(saturation, 0, 1);
      o.pileTarget = clamp(Math.round(pile), 0, PILE_MAX);
    },
    // Call once after a batch of setEdgeLoad / setNodeLoad calls.
    commit() { choosePileEdges(); recomputeScale(); },
    setEnabled(on) { enabled = !!on; if (!enabled) { n = 0; for (const o of nodes.values()) o.pileShown = 0; } },
    setCap(c) { capNow = clamp(Math.floor(c), 1, hardMax); recomputeScale(); },
    get cap() { return capNow; },
    get enabled() { return enabled; },
    step(dt) {
      acc += clamp(dt, 0, MAX_CATCHUP);
      while (acc >= STEP) { acc -= STEP; sim(STEP); }
    },
    // Run `seconds` of simulated time at once (used to fill a map that has just been created).
    warm(seconds) { for (let t = 0; t < seconds; t += STEP) sim(STEP); },
    reset() { n = 0; acc = 0; for (const o of nodes.values()) o.pileShown = 0; },
    count() {
      let p = 0;
      if (enabled) for (const o of nodes.values()) p += Math.round(o.pileShown);
      return n + p;
    },
    inFlight() { return n; },
    // Write every dot as STRIDE floats into buf (x, y, kind, alpha, tx, ty). Returns the number of dots written.
    fill(buf) {
      let w = 0;
      const max = Math.floor(buf.length / STRIDE);
      const tmp = { x: 0, y: 0, tx: 1, ty: 0 };
      for (let k = 0; k < n && w < max; k++) {
        const e = edges[ei[k]];
        locate(e, ds[k], tmp);
        const o = w * STRIDE;
        const flip = dk[k] === KIND_ERROR ? -1 : 1;
        buf[o] = tmp.x; buf[o + 1] = tmp.y; buf[o + 2] = dk[k]; buf[o + 3] = e.alpha; buf[o + 4] = tmp.tx * flip; buf[o + 5] = tmp.ty * flip;
        w++;
      }
      if (enabled) {
        for (const [id, o] of nodes) {
          const count = Math.round(o.pileShown);
          if (count <= 0 || o.edge < 0) continue;
          const e = edges[o.edge];
          if (e.to !== id) continue;
          for (let j = 0; j < count && w < max; j++) {
            const row = Math.floor(j / PILE_COLS);
            const col = j % PILE_COLS;
            const jitter = (((j * 2654435761) >>> 0) % 7) / 7 - 0.5; // deterministic, no PRNG use
            locate(e, e.len - 4 - row * PILE_ROW + jitter, tmp);
            const side = (col - 1) * 6 + (row % 2 ? 3 : 0) - 1.5;
            const q = w * STRIDE;
            buf[q] = tmp.x - tmp.ty * side; buf[q + 1] = tmp.y + tmp.tx * side; buf[q + 2] = KIND_REQUEST; buf[q + 3] = e.alpha; buf[q + 4] = 0; buf[q + 5] = 0;
            w++;
          }
        }
      }
      return w;
    },
    pileShown(id) { const o = nodes.get(id); return o ? Math.round(o.pileShown) : 0; },
    edgeRate(key) { const i = byKey.get(key); return i === undefined ? 0 : edges[i].rate; },
  };
  return api;
}

function locate(e, s, out) {
  const { pts, cum, len } = e;
  const d = clamp(s, 0, len);
  let i = 1;
  while (i < pts.length - 1 && cum[i] < d) i++;
  const a = pts[i - 1];
  const b = pts[i];
  const seg = Math.max(1e-9, cum[i] - cum[i - 1]);
  const f = (d - cum[i - 1]) / seg;
  out.x = a.x + (b.x - a.x) * f;
  out.y = a.y + (b.y - a.y) * f;
  out.tx = (b.x - a.x) / seg;
  out.ty = (b.y - a.y) / seg;
  return out;
}
