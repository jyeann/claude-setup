// Force-directed graph layout. Pure and deterministic: no DOM, no randomness, no clock unless one is passed in.
export const K = 40;
export const MAX_ITERATIONS = 300;
export const MIN_MOVE = 0.5;
const GOLDEN_ANGLE = 2.39996;
const CELL_OFFSET = 1 << 15;

// edges: [[i, j]] index pairs. Repulsion k^2/d only between nodes in the same or adjacent grid cells (cell = 2k).
export function createLayout(count, edges, { k = K, maxIterations = MAX_ITERATIONS } = {}) {
  const x = new Float64Array(count);
  const y = new Float64Array(count);
  for (let i = 0; i < count; i += 1) {
    const r = 30 * Math.sqrt(i);
    x[i] = r * Math.cos(i * GOLDEN_ANGLE);
    y[i] = r * Math.sin(i * GOLDEN_ANGLE);
  }
  const dx = new Float64Array(count);
  const dy = new Float64Array(count);
  const cell = 2 * k;
  const layout = { x, y, iteration: 0, done: count === 0 };

  const push = (a, b, ddx, ddy, d, force) => {
    const fx = (ddx / d) * force;
    const fy = (ddy / d) * force;
    dx[a] += fx;
    dy[a] += fy;
    dx[b] -= fx;
    dy[b] -= fy;
  };

  function repel() {
    const grid = new Map();
    for (let n = 0; n < count; n += 1) {
      const key = (Math.floor(x[n] / cell) + CELL_OFFSET) * 65536 * 2 + (Math.floor(y[n] / cell) + CELL_OFFSET);
      const bucket = grid.get(key);
      if (bucket) bucket.push(n);
      else grid.set(key, [n]);
    }
    for (let n = 0; n < count; n += 1) {
      const cx = Math.floor(x[n] / cell) + CELL_OFFSET;
      const cy = Math.floor(y[n] / cell) + CELL_OFFSET;
      for (let ox = -1; ox <= 1; ox += 1) {
        for (let oy = -1; oy <= 1; oy += 1) {
          const bucket = grid.get((cx + ox) * 65536 * 2 + (cy + oy));
          if (!bucket) continue;
          for (const m of bucket) {
            if (m <= n) continue;
            let ddx = x[n] - x[m];
            let ddy = y[n] - y[m];
            let d = Math.hypot(ddx, ddy);
            if (d < 0.01) {
              ddx = 0.01 * (n - m);
              ddy = 0.01;
              d = Math.hypot(ddx, ddy);
            }
            push(n, m, ddx, ddy, d, (k * k) / d);
          }
        }
      }
    }
  }

  function attract() {
    for (const [a, b] of edges) {
      const ddx = x[a] - x[b];
      const ddy = y[a] - y[b];
      const d = Math.max(Math.hypot(ddx, ddy), 0.01);
      push(a, b, ddx, ddy, d, -(d * d) / k);
    }
  }

  // One iteration. Returns the largest move, 0 once finished.
  layout.step = function step() {
    if (layout.done) return 0;
    dx.fill(0);
    dy.fill(0);
    repel();
    attract();
    const temperature = 50 * (1 - layout.iteration / maxIterations);
    let biggest = 0;
    for (let n = 0; n < count; n += 1) {
      dx[n] -= 0.02 * x[n];
      dy[n] -= 0.02 * y[n];
      const len = Math.hypot(dx[n], dy[n]);
      if (len === 0) continue;
      const move = Math.min(len, temperature);
      x[n] += (dx[n] / len) * move;
      y[n] += (dy[n] / len) * move;
      if (move > biggest) biggest = move;
    }
    layout.iteration += 1;
    if (layout.iteration >= maxIterations || biggest < MIN_MOVE) layout.done = true;
    return biggest;
  };
  return layout;
}

// Run iterations until the time budget, the iteration limit or the end of the layout. Returns how many ran.
export function runFor(layout, { budgetMs = Infinity, iterations = Infinity, now = () => Date.now() } = {}) {
  const t0 = now();
  let ran = 0;
  while (!layout.done && ran < iterations && now() - t0 < budgetMs) {
    layout.step();
    ran += 1;
  }
  return ran;
}

// Scale and centre the points into a width x height box with padding. Never zooms in beyond maxScale.
export function fitToBox(layout, count, width, height, { pad = 40, maxScale = 1.5 } = {}) {
  if (count === 0) return { scale: 1, offsetX: width / 2, offsetY: height / 2 };
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < count; i += 1) {
    minX = Math.min(minX, layout.x[i]);
    maxX = Math.max(maxX, layout.x[i]);
    minY = Math.min(minY, layout.y[i]);
    maxY = Math.max(maxY, layout.y[i]);
  }
  const bw = Math.max(maxX - minX, 1);
  const bh = Math.max(maxY - minY, 1);
  const scale = Math.min((width - 2 * pad) / bw, (height - 2 * pad) / bh, maxScale);
  return {
    scale,
    offsetX: width / 2 - ((minX + maxX) / 2) * scale,
    offsetY: height / 2 - ((minY + maxY) / 2) * scale,
  };
}

export const truncateLabel = (title, max = 24) => {
  const chars = [...title];
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : title;
};

// Hit circle radius per node, shrunk so that no circle reaches another node's centre in dense graphs.
// px, py are screen coordinates. Radii stay between minR and base.
export function hitRadii(px, py, count, base, minR) {
  const cell = Math.max(2 * base, 8);
  const grid = new Map();
  const cellOf = (v) => Math.floor(v / cell) + CELL_OFFSET;
  for (let i = 0; i < count; i += 1) {
    const key = cellOf(px[i]) * 131072 + cellOf(py[i]);
    const bucket = grid.get(key);
    if (bucket) bucket.push(i);
    else grid.set(key, [i]);
  }
  const radii = new Float64Array(count);
  for (let i = 0; i < count; i += 1) {
    let nearest = Infinity;
    const cx = cellOf(px[i]);
    const cy = cellOf(py[i]);
    for (let ox = -1; ox <= 1; ox += 1) {
      for (let oy = -1; oy <= 1; oy += 1) {
        const bucket = grid.get((cx + ox) * 131072 + (cy + oy));
        if (!bucket) continue;
        for (const j of bucket) if (j !== i) nearest = Math.min(nearest, Math.hypot(px[i] - px[j], py[i] - py[j]));
      }
    }
    radii[i] = Math.max(minR, Math.min(base, nearest / 2 - 1));
  }
  return radii;
}

// Push apart nodes closer than minDist (layout units). A deterministic clean-up after the force iterations,
// so dense graphs do not leave dots stacked on each other.
export function separate(layout, count, minDist, passes = 12) {
  const { x, y } = layout;
  for (let pass = 0; pass < passes; pass += 1) {
    const grid = new Map();
    const cellOf = (v) => Math.floor(v / minDist) + CELL_OFFSET;
    for (let n = 0; n < count; n += 1) {
      const key = cellOf(x[n]) * 131072 + cellOf(y[n]);
      const bucket = grid.get(key);
      if (bucket) bucket.push(n);
      else grid.set(key, [n]);
    }
    let moved = false;
    for (let n = 0; n < count; n += 1) {
      const cx = cellOf(x[n]);
      const cy = cellOf(y[n]);
      for (let ox = -1; ox <= 1; ox += 1) {
        for (let oy = -1; oy <= 1; oy += 1) {
          const bucket = grid.get((cx + ox) * 131072 + (cy + oy));
          if (!bucket) continue;
          for (const m of bucket) {
            if (m <= n) continue;
            let ddx = x[n] - x[m];
            let ddy = y[n] - y[m];
            let d = Math.hypot(ddx, ddy);
            if (d >= minDist) continue;
            if (d < 1e-6) {
              ddx = n - m;
              ddy = 0.5;
              d = Math.hypot(ddx, ddy);
            }
            const push = (minDist - d) / 2;
            x[n] += (ddx / d) * push;
            y[n] += (ddy / d) * push;
            x[m] -= (ddx / d) * push;
            y[m] -= (ddy / d) * push;
            moved = true;
          }
        }
      }
    }
    if (!moved) break;
  }
}
