// Deterministic auto-layout of any scenario topology (pure; no DOM, no randomness, no Date).
//
// computeLayout(topologyOrScenario, { width, height, mode }) -> Layout
//   Layout = { mode, width, height, nodeW, nodeH, nodes:{id:{id,type,x,y,w,h,cx,cy,col,row}}, order:[id], edges:[Edge], cols }
//   Edge   = { key, from, to, pts:[{x,y}] (rounded path sampled to a polyline), cum:[number] (cumulative length), len, d (SVG path),
//              segs:[{x1,y1,x2,y2}], label:{x,y,anchor,box}|null, mid:{x,y}, kind:'straight'|'elbow'|'stack'|'loop'|'long' }
// nearest(layout, fromId, dir) -> id|null  (dir: left|right|up|down; 90 degree cone, angle weighted distance)
//
// Wide template (container >= 720): columns by tier. A tier is the longest path depth from the clients with two merges:
// client>lb and db>db (replication) are stacked in one column so the pair reads as one unit with a short vertical edge.
// Tall template (container < 720): two columns, one tier per row band, edges routed down and across.
import { NODE_TYPES } from '../engine/catalogue.js';

export const WIDE_MIN = 720;
export const CORNER = 8;
const NODE_W_MAX = 144;
const NODE_W_MIN = 118;
const GAP_WANT = 72; // wanted gap between wide columns (room for an edge label)
const PAD_X = 16;
const PAD_TOP_WIDE = 52;
const PAD_BOTTOM_WIDE = 32;
const V_GAP = 52; // min vertical gap between nodes of one wide column
const STACK_GAP = 48; // gap between stacked nodes (clients over lb, primary over replica)
const NODE_H_WIDE = 64;
const NODE_H_TALL = 56;
const ROW_GAP = 44; // tall: min gap between rows (edge label room)
const ROW_GAP_MAX = 110; // tall: rows spread up to this far apart to fill a taller container
const PAD_TOP_TALL = 32;
const PAD_BOTTOM_TALL = 24;
const LABEL_W = 70; // worst-case "12.5k rps" at 13px mono
const LABEL_W_SHORT = 40; // compact label (number only) used when the gap is tight
const LABEL_H = 15;
const MIN_NODE_W_TALL = 136;

const typeOf = (id) => NODE_TYPES[id] ?? 'service';
const isStack = (e) => (typeOf(e.from) === 'client' && typeOf(e.to) === 'lb') || (typeOf(e.from) === 'db' && typeOf(e.to) === 'db');

// ---------------------------------------------------------------- analysis (shared by both templates)
function analyse(top) {
  const ids = Object.keys(top.nodes);
  const edges = top.edges.map((e) => ({ from: e.from, to: e.to, key: `${e.from}>${e.to}` })).filter((e) => ids.includes(e.from) && ids.includes(e.to));
  const stackParent = {};
  const stackKids = {};
  for (const e of edges) {
    if (isStack(e) && stackParent[e.to] === undefined && e.from !== e.to) {
      stackParent[e.to] = e.from;
      (stackKids[e.from] = stackKids[e.from] || []).push(e.to);
    }
  }
  // Guard against stack cycles (validated scenarios are DAGs; this keeps hostile input from looping).
  const headOf = {};
  const groups = [];
  const collect = (id, seen) => {
    if (seen.has(id)) return [];
    seen.add(id);
    const out = [id];
    for (const k of stackKids[id] || []) out.push(...collect(k, seen));
    return out;
  };
  const seen = new Set();
  for (const id of ids) {
    if (stackParent[id] !== undefined) continue;
    const members = collect(id, seen);
    const g = { head: id, members, level: 0, index: groups.length };
    groups.push(g);
    for (const m of members) headOf[m] = g;
  }
  for (const id of ids) {
    if (!headOf[id]) { // part of a stack cycle: its own group
      const g = { head: id, members: [id], level: 0, index: groups.length };
      groups.push(g);
      headOf[id] = g;
    }
  }
  // Longest-path levels over the contracted graph (bounded relaxation).
  for (let pass = 0; pass <= ids.length + 1; pass++) {
    let changed = false;
    for (const e of edges) {
      const a = headOf[e.from];
      const b = headOf[e.to];
      if (a === b) continue;
      if (b.level < a.level + 1 && b.level <= ids.length) { b.level = a.level + 1; changed = true; }
    }
    if (!changed) break;
  }
  const nLevels = groups.reduce((m, g) => Math.max(m, g.level), 0) + 1;
  const columns = Array.from({ length: nLevels }, () => []);
  for (const g of groups) columns[g.level].push(g);
  const preds = {};
  const succs = {};
  for (const id of ids) { preds[id] = []; succs[id] = []; }
  for (const e of edges) { preds[e.to].push(e.from); succs[e.from].push(e.to); }
  orderColumns(columns, headOf, preds, succs);
  return { ids, edges, groups, headOf, columns, preds, succs, stackParent };
}

// Barycentre ordering inside each column, a few alternating sweeps. Stable: ties keep document order.
function orderColumns(columns, headOf, preds, succs) {
  const rank = new Map();
  const refresh = () => {
    for (const col of columns) col.forEach((g, i) => rank.set(g, (i + 0.5) / col.length));
  };
  refresh();
  const keyOf = (g, nbrs) => {
    let sum = 0;
    let n = 0;
    for (const m of g.members) for (const o of nbrs[m]) { const og = headOf[o]; if (og !== g) { sum += rank.get(og); n++; } }
    return n ? sum / n : rank.get(g);
  };
  for (let sweep = 0; sweep < 4; sweep++) {
    const forward = sweep % 2 === 0;
    const range = forward ? columns.map((_, i) => i) : columns.map((_, i) => columns.length - 1 - i);
    for (const ci of range) {
      const col = columns[ci];
      const keyed = col.map((g) => ({ g, k: keyOf(g, forward ? preds : succs), i: g.index }));
      keyed.sort((a, b) => a.k - b.k || a.i - b.i);
      columns[ci] = keyed.map((x) => x.g);
      columns[ci].forEach((g, i) => rank.set(g, (i + 0.5) / columns[ci].length));
    }
  }
}

// ---------------------------------------------------------------- geometry helpers
const round1 = (n) => Math.round(n * 10) / 10;

// Vertices -> rounded SVG path and a sampled polyline of the same curve (dots follow the path exactly).
function buildPath(vertsIn) {
  const verts = [];
  for (const v of vertsIn) {
    const last = verts[verts.length - 1];
    if (!last || last.x !== v.x || last.y !== v.y) verts.push({ x: round1(v.x), y: round1(v.y) });
  }
  // drop collinear interior vertices
  const vs = [verts[0]];
  for (let i = 1; i < verts.length - 1; i++) {
    const a = vs[vs.length - 1];
    const b = verts[i];
    const c = verts[i + 1];
    if ((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x) !== 0) vs.push(b);
  }
  if (verts.length > 1) vs.push(verts[verts.length - 1]);
  let d = `M${vs[0].x} ${vs[0].y}`;
  const pts = [{ x: vs[0].x, y: vs[0].y }];
  for (let i = 1; i < vs.length; i++) {
    const p = vs[i - 1];
    const v = vs[i];
    if (i === vs.length - 1) { d += ` L${v.x} ${v.y}`; pts.push({ x: v.x, y: v.y }); continue; }
    const n = vs[i + 1];
    const lin = Math.hypot(v.x - p.x, v.y - p.y);
    const lout = Math.hypot(n.x - v.x, n.y - v.y);
    const r = Math.min(CORNER, lin / 2, lout / 2);
    const a = { x: round1(v.x - ((v.x - p.x) / lin) * r), y: round1(v.y - ((v.y - p.y) / lin) * r) };
    const b = { x: round1(v.x + ((n.x - v.x) / lout) * r), y: round1(v.y + ((n.y - v.y) / lout) * r) };
    d += ` L${a.x} ${a.y} Q${v.x} ${v.y} ${b.x} ${b.y}`;
    pts.push(a);
    for (const t of [0.25, 0.5, 0.75]) {
      const u = 1 - t;
      pts.push({ x: u * u * a.x + 2 * u * t * v.x + t * t * b.x, y: u * u * a.y + 2 * u * t * v.y + t * t * b.y });
    }
    pts.push(b);
  }
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  return { d, pts, cum, len: cum[cum.length - 1], verts: vs };
}

const rectOf = (n, pad = 0) => ({ x1: n.x - pad, y1: n.y - pad, x2: n.x + n.w + pad, y2: n.y + n.h + pad });
const hit = (a, b) => a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2;

// Choose a label spot on the polyline that avoids nodes and earlier labels. Candidates: every segment, longest first.
function placeLabel(verts, obstacles, placed, bounds) {
  const segs = [];
  for (let i = 1; i < verts.length; i++) {
    const a = verts[i - 1];
    const b = verts[i];
    segs.push({ a, b, len: Math.hypot(b.x - a.x, b.y - a.y), horizontal: Math.abs(b.y - a.y) < Math.abs(b.x - a.x) });
  }
  segs.sort((s, t) => t.len - s.len);
  for (const [lw, short] of [[LABEL_W, false], [LABEL_W_SHORT, true]]) {
    for (const s of segs) {
      const mx = (s.a.x + s.b.x) / 2;
      const my = (s.a.y + s.b.y) / 2;
      const options = s.horizontal
        ? [{ x: mx, y: my - 7, anchor: 'middle' }, { x: mx, y: my + 17, anchor: 'middle' }]
        : [{ x: mx + 8, y: my + 4, anchor: 'start' }, { x: mx - 8, y: my + 4, anchor: 'end' }];
      for (const o of options) {
        if (s.horizontal && s.len < lw - 4) continue;
        if (!s.horizontal && s.len < LABEL_H) continue;
        const x1 = o.anchor === 'middle' ? o.x - lw / 2 : o.anchor === 'start' ? o.x : o.x - lw;
        const box = { x1, y1: o.y - 12, x2: x1 + lw, y2: o.y + 3 };
        if (box.x1 < bounds.x1 || box.x2 > bounds.x2 || box.y1 < bounds.y1 || box.y2 > bounds.y2) continue;
        if (obstacles.some((r) => hit(box, r))) continue;
        if (placed.some((r) => hit(box, r))) continue;
        return { x: round1(o.x), y: round1(o.y), anchor: o.anchor, short, box };
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------- wide template
// Minimise sum (y - desired)^2 subject to y[i+1] >= y[i] + h[i] + gap[i] (pool adjacent violators on shifted targets).
function packColumn(items, minTop, maxBottom) {
  const n = items.length;
  if (!n) return;
  const offs = [0];
  for (let i = 1; i < n; i++) offs.push(offs[i - 1] + items[i - 1].h + V_GAP);
  const blocks = [];
  for (let i = 0; i < n; i++) {
    blocks.push({ sum: items[i].want - offs[i], n: 1, from: i });
    while (blocks.length > 1) {
      const b = blocks[blocks.length - 1];
      const a = blocks[blocks.length - 2];
      if (a.sum / a.n <= b.sum / b.n) break;
      a.sum += b.sum;
      a.n += b.n;
      blocks.pop();
    }
  }
  for (const b of blocks) for (let i = b.from; i < b.from + b.n; i++) items[i].top = b.sum / b.n + offs[i];
  const last = items[n - 1];
  const bottom = last.top + last.h;
  if (items[0].top < minTop) { const dy = minTop - items[0].top; for (const it of items) it.top += dy; }
  else if (bottom > maxBottom) {
    const dy = Math.min(bottom - maxBottom, items[0].top - minTop);
    for (const it of items) it.top -= dy;
  }
}

function wideLayout(A, W, Hin) {
  const cols = A.columns.length;
  const avail = W - 2 * PAD_X;
  let nodeW = cols > 1 ? Math.floor((avail - (cols - 1) * GAP_WANT) / cols) : NODE_W_MAX;
  nodeW = Math.max(NODE_W_MIN, Math.min(NODE_W_MAX, nodeW));
  const gap = cols > 1 ? Math.max(0, (avail - cols * nodeW) / (cols - 1)) : 0;
  const colX = [];
  for (let c = 0; c < cols; c++) colX.push(round1(PAD_X + c * (nodeW + gap)));
  const H = NODE_H_WIDE;
  const nodes = {};
  const gHeight = (g) => g.members.length * H + (g.members.length - 1) * STACK_GAP;
  const colItems = A.columns.map((col, c) => col.map((g) => ({ g, h: gHeight(g), top: 0, want: 0, c })));
  const area0 = PAD_TOP_WIDE;
  const area1 = Math.max(Hin - PAD_BOTTOM_WIDE, area0 + 1);
  let maxBottom = area1;
  for (const items of colItems) {
    const total = items.reduce((s, it) => s + it.h, 0) + Math.max(0, items.length - 1) * V_GAP;
    maxBottom = Math.max(maxBottom, area0 + total);
  }
  // initial: even spacing centred in the area
  colItems.forEach((items) => {
    const total = items.reduce((s, it) => s + it.h, 0);
    const free = Math.max(0, maxBottom - area0 - total);
    const g = items.length ? free / (items.length + 1) : 0;
    let y = area0;
    for (const it of items) { y += g; it.top = y; y += it.h; }
  });
  const cy = (id) => { const it = findItem(colItems, A.headOf[id]); return it.top + H / 2 + A.headOf[id].members.indexOf(id) * (H + STACK_GAP); };
  const desiredTop = (it, nbrs) => {
    let sum = 0;
    let n = 0;
    it.g.members.forEach((m, k) => {
      for (const o of nbrs[m]) {
        if (A.headOf[o] === it.g) continue;
        sum += cy(o) - (k * (H + STACK_GAP) + H / 2);
        n++;
      }
    });
    return n ? sum / n : null; // desired top of the group
  };
  for (let pass = 0; pass < 6; pass++) {
    const forward = pass % 2 === 0;
    const order = colItems.map((_, i) => i);
    if (!forward) order.reverse();
    for (const ci of order) {
      const items = colItems[ci];
      for (const it of items) {
        const c = desiredTop(it, forward ? A.preds : A.succs);
        it.want = c === null ? it.top : c;
      }
      // keep the barycentre order
      packColumn(items, area0, maxBottom);
    }
  }
  // Spread the drawing vertically when the box is much taller than it needs: stretch distances about the middle (sizes stay).
  {
    let t0 = Infinity;
    let b0 = -Infinity;
    for (const items of colItems) for (const it of items) { t0 = Math.min(t0, it.top); b0 = Math.max(b0, it.top + it.h); }
    const used = b0 - t0;
    const room = Hin - PAD_TOP_WIDE - PAD_BOTTOM_WIDE;
    if (used > 0 && used < 0.68 * room) {
      const f = Math.min(2, (0.68 * room) / used);
      const mid = (t0 + b0) / 2;
      for (const items of colItems) for (const it of items) it.top = mid + (it.top + H / 2 - mid) * f - H / 2;
    }
  }
  // centre the whole drawing vertically
  let minT = Infinity;
  let maxB = -Infinity;
  for (const items of colItems) for (const it of items) { minT = Math.min(minT, it.top); maxB = Math.max(maxB, it.top + it.h); }
  const height = Math.max(Hin, Math.ceil(maxB - minT + area0 + PAD_BOTTOM_WIDE));
  const targetTop = area0 + Math.max(0, (height - PAD_BOTTOM_WIDE - area0 - (maxB - minT)) / 2);
  const shift = targetTop - minT;
  colItems.forEach((items, c) => {
    for (const it of items) {
      it.g.members.forEach((id, k) => {
        const y = round1(it.top + shift + k * (H + STACK_GAP));
        nodes[id] = { id, type: typeOf(id), x: colX[c], y, w: nodeW, h: H, cx: round1(colX[c] + nodeW / 2), cy: round1(y + H / 2), col: c, row: 0 };
      });
    }
  });
  const order = [];
  for (const items of colItems) for (const it of items) for (const id of it.g.members) order.push(id);
  const L = { mode: 'wide', width: W, height, nodeW, nodeH: H, nodes, order, cols, gap };
  L.edges = routeWide(A, L, colX, nodeW, gap);
  return L;
}

function findItem(colItems, g) {
  for (const items of colItems) for (const it of items) if (it.g === g) return it;
  throw new Error('layout: group not found');
}

function routeWide(A, L, colX, nodeW, gap) {
  const N = L.nodes;
  const plans = [];
  const requests = Array.from({ length: Math.max(1, L.cols) }, () => []); // vertical channels per gap
  for (const e of A.edges) {
    const s = N[e.from];
    const t = N[e.to];
    const plan = { e, s, t, kind: 'elbow', chans: [] };
    if (s.col === t.col) {
      const adjacent = A.stackParent[e.to] === e.from && Math.abs(t.y - (s.y + s.h + STACK_GAP)) < 1;
      plan.kind = adjacent ? 'stack' : 'loop';
    } else if (t.col === s.col + 1) {
      plan.kind = Math.abs(s.cy - t.cy) < 1 ? 'straight' : 'elbow';
      if (plan.kind === 'elbow') plan.chans.push({ gap: s.col, mid: (s.cy + t.cy) / 2 });
    } else {
      plan.kind = 'long';
      const between = Object.values(N).filter((n) => n.col > s.col && n.col < t.col);
      const clearAt = (y, x1, x2) => !between.some((n) => hit({ x1: Math.min(x1, x2), y1: y - 1, x2: Math.max(x1, x2), y2: y + 1 }, rectOf(n, 6)));
      const gapAfter = (c) => colX[c] + nodeW + gap / 2;
      if (clearAt(t.cy, gapAfter(s.col), t.x)) {
        plan.variant = 'A';
        plan.chans.push({ gap: s.col, mid: (s.cy + t.cy) / 2 });
      } else if (clearAt(s.cy, s.x + s.w, gapAfter(t.col - 1))) {
        plan.variant = 'B';
        plan.chans.push({ gap: t.col - 1, mid: (s.cy + t.cy) / 2 });
      } else {
        plan.variant = 'C';
        // corridor: a y free in every intermediate column, nearest to the average of the ends
        const spans = between.map((n) => ({ a: n.y - 10, b: n.y + n.h + 10 }));
        const cands = [PAD_TOP_WIDE - 24, L.height - PAD_BOTTOM_WIDE + 14];
        const ys = [...new Set(between.flatMap((n) => [n.y - 18, n.y + n.h + 18]))].concat(cands);
        const free = ys.filter((y) => y > 8 && y < L.height - 8 && !spans.some((sp) => y > sp.a && y < sp.b));
        free.sort((a, b) => Math.abs(a - (s.cy + t.cy) / 2) - Math.abs(b - (s.cy + t.cy) / 2) || a - b);
        plan.corridor = free.length ? free[0] : (s.cy + t.cy) / 2;
        plan.chans.push({ gap: s.col, mid: (s.cy + plan.corridor) / 2 }, { gap: t.col - 1, mid: (plan.corridor + t.cy) / 2 });
      }
    }
    for (const ch of plan.chans) requests[ch.gap].push({ plan, ch });
    plans.push(plan);
  }
  for (let g = 0; g < requests.length; g++) {
    const list = requests[g];
    list.sort((a, b) => a.ch.mid - b.ch.mid || a.plan.e.key.localeCompare(b.plan.e.key));
    const left = colX[g] + nodeW;
    // Channels hug the source side so the run into the target stays long enough for an edge label.
    list.forEach((r, i) => { r.ch.x = round1(left + gap * (0.15 + (0.2 * i) / list.length)); });
  }
  const obstacles = Object.values(N).map((n) => rectOf(n, 3));
  const bounds = { x1: 2, y1: 2, x2: L.width - 2, y2: L.height - 2 };
  const placed = [];
  const out = [];
  for (const p of plans) {
    const { e, s, t } = p;
    let v;
    if (p.kind === 'stack') v = [{ x: s.cx, y: s.y + s.h }, { x: t.cx, y: t.y }];
    else if (p.kind === 'loop') {
      const x = s.x + s.w + 14;
      v = [{ x: s.x + s.w, y: s.cy }, { x, y: s.cy }, { x, y: t.cy }, { x: t.x + t.w, y: t.cy }];
    } else if (p.kind === 'straight') v = [{ x: s.x + s.w, y: s.cy }, { x: t.x, y: t.cy }];
    else if (p.kind === 'elbow') {
      const cx = p.chans[0].x;
      v = [{ x: s.x + s.w, y: s.cy }, { x: cx, y: s.cy }, { x: cx, y: t.cy }, { x: t.x, y: t.cy }];
    } else if (p.variant === 'A') {
      const cx = p.chans[0].x;
      v = [{ x: s.x + s.w, y: s.cy }, { x: cx, y: s.cy }, { x: cx, y: t.cy }, { x: t.x, y: t.cy }];
    } else if (p.variant === 'B') {
      const cx = p.chans[0].x;
      v = [{ x: s.x + s.w, y: s.cy }, { x: cx, y: s.cy }, { x: cx, y: t.cy }, { x: t.x, y: t.cy }];
    } else {
      const [c1, c2] = p.chans;
      v = [{ x: s.x + s.w, y: s.cy }, { x: c1.x, y: s.cy }, { x: c1.x, y: p.corridor }, { x: c2.x, y: p.corridor }, { x: c2.x, y: t.cy }, { x: t.x, y: t.cy }];
    }
    out.push(finishEdge(e, p.kind, v, obstacles, placed, bounds));
  }
  return out;
}

function finishEdge(e, kind, verts, obstacles, placed, bounds) {
  const path = buildPath(verts);
  const label = placeLabel(path.verts, obstacles, placed, bounds);
  if (label) placed.push(label.box);
  const half = path.len / 2;
  let mid = path.pts[0];
  for (let i = 1; i < path.pts.length; i++) {
    if (path.cum[i] >= half) {
      const f = (half - path.cum[i - 1]) / Math.max(1e-9, path.cum[i] - path.cum[i - 1]);
      mid = { x: round1(path.pts[i - 1].x + f * (path.pts[i].x - path.pts[i - 1].x)), y: round1(path.pts[i - 1].y + f * (path.pts[i].y - path.pts[i - 1].y)) };
      break;
    }
  }
  const segs = [];
  for (let i = 1; i < path.verts.length; i++) segs.push({ x1: path.verts[i - 1].x, y1: path.verts[i - 1].y, x2: path.verts[i].x, y2: path.verts[i].y });
  return { key: e.key, from: e.from, to: e.to, kind, d: path.d, pts: path.pts, cum: path.cum, len: path.len, segs, label, mid };
}

// ---------------------------------------------------------------- tall template
function tallLayout(A, W, Hmin) {
  let pad = 8;
  let colGap = 12;
  let nodeW = Math.floor((W - 2 * pad - colGap) / 2);
  if (nodeW < MIN_NODE_W_TALL) { pad = 4; colGap = 8; nodeW = Math.floor((W - 2 * pad - colGap) / 2); }
  nodeW = Math.max(nodeW, 60);
  const H = NODE_H_TALL;
  const rows = [];
  A.columns.forEach((col) => {
    let row = [];
    const flush = () => { if (row.length) rows.push(row); row = []; };
    for (const g of col) {
      for (let i = 0; i < g.members.length; i++) {
        if (row.length === 2) flush();
        if (i === 0 && g.members.length === 2 && row.length === 1) flush(); // keep a stacked pair together
        row.push(g.members[i]);
      }
    }
    flush();
  });
  const spare = rows.length > 1 ? (Hmin - PAD_TOP_TALL - PAD_BOTTOM_TALL - rows.length * H) / (rows.length - 1) : ROW_GAP;
  const rowGap = Math.round(Math.max(ROW_GAP, Math.min(ROW_GAP_MAX, spare)));
  const nodes = {};
  const rowOf = {};
  const colOf = {};
  rows.forEach((row, r) => {
    row.forEach((id, k) => {
      let c = k;
      if (row.length === 1) {
        const ps = A.preds[id].filter((p) => colOf[p] !== undefined);
        const avg = ps.length ? ps.reduce((s, p) => s + colOf[p], 0) / ps.length : 0;
        c = avg > 0.5 ? 1 : 0;
      }
      rowOf[id] = r;
      colOf[id] = c;
    });
  });
  rows.forEach((row, r) => {
    for (const id of row) {
      const c = colOf[id];
      const x = round1(pad + c * (nodeW + colGap));
      const y = round1(PAD_TOP_TALL + r * (H + rowGap));
      nodes[id] = { id, type: typeOf(id), x, y, w: nodeW, h: H, cx: round1(x + nodeW / 2), cy: round1(y + H / 2), col: c, row: r };
    }
  });
  const order = rows.flat();
  const height = PAD_TOP_TALL + rows.length * H + Math.max(0, rows.length - 1) * rowGap + PAD_BOTTOM_TALL;
  const L = { mode: 'tall', width: W, height, nodeW, nodeH: H, nodes, order, cols: 2, gap: colGap };
  // channel requests per row gap
  const plans = [];
  const gapReq = Array.from({ length: Math.max(1, rows.length) }, () => []);
  const gutterReq = [];
  for (const e of A.edges) {
    const s = nodes[e.from];
    const t = nodes[e.to];
    const plan = { e, s, t, kind: 'elbow', ch: [] };
    if (t.row === s.row) plan.kind = 'straight';
    else if (t.row === s.row + 1) {
      plan.kind = s.cx === t.cx ? 'straight' : 'elbow';
      if (plan.kind === 'elbow') { const ch = { row: s.row }; plan.ch.push(ch); gapReq[s.row].push({ plan, ch }); }
    } else if (t.row > s.row + 1) {
      plan.kind = 'long';
      const c1 = { row: s.row };
      const c2 = { row: t.row - 1 };
      plan.ch.push(c1, c2);
      gapReq[s.row].push({ plan, ch: c1 });
      gapReq[t.row - 1].push({ plan, ch: c2 });
      gutterReq.push(plan);
    } else plan.kind = 'loop';
    plans.push(plan);
  }
  gapReq.forEach((list, r) => {
    list.sort((a, b) => a.plan.s.cx - b.plan.s.cx || a.plan.t.cx - b.plan.t.cx || a.plan.e.key.localeCompare(b.plan.e.key));
    const top = PAD_TOP_TALL + r * (H + rowGap) + H;
    list.forEach((q, i) => { q.ch.y = round1(top + (rowGap * (i + 1)) / (list.length + 1)); });
  });
  const gutterX = pad + nodeW + colGap / 2;
  gutterReq.forEach((plan, i) => { plan.gx = round1(gutterX + (i - (gutterReq.length - 1) / 2) * Math.min(3, colGap / Math.max(1, gutterReq.length))); });
  const obstacles = Object.values(nodes).map((n) => rectOf(n, 3));
  const bounds = { x1: 2, y1: 2, x2: W - 2, y2: height - 2 };
  const placed = [];
  L.edges = plans.map((p) => {
    const { e, s, t } = p;
    let v;
    if (p.kind === 'straight' && t.row === s.row) {
      v = s.x < t.x ? [{ x: s.x + s.w, y: s.cy }, { x: t.x, y: t.cy }] : [{ x: s.x, y: s.cy }, { x: t.x + t.w, y: t.cy }];
    } else if (p.kind === 'straight') v = [{ x: s.cx, y: s.y + s.h }, { x: t.cx, y: t.y }];
    else if (p.kind === 'elbow') v = [{ x: s.cx, y: s.y + s.h }, { x: s.cx, y: p.ch[0].y }, { x: t.cx, y: p.ch[0].y }, { x: t.cx, y: t.y }];
    else if (p.kind === 'long') {
      v = [{ x: s.cx, y: s.y + s.h }, { x: s.cx, y: p.ch[0].y }, { x: p.gx, y: p.ch[0].y }, { x: p.gx, y: p.ch[1].y }, { x: t.cx, y: p.ch[1].y }, { x: t.cx, y: t.y }];
    } else v = [{ x: s.cx, y: s.y }, { x: s.cx, y: s.y - 10 }, { x: t.cx, y: s.y - 10 }, { x: t.cx, y: t.y + t.h }]; // upward edge (not expected in a DAG)
    return finishEdge(e, p.kind, v, obstacles, placed, bounds);
  });
  return L;
}

// ---------------------------------------------------------------- public API
const cache = new Map();
const CACHE_MAX = 24;

function topologyOf(src) {
  const top = src && src.topology ? src.topology : src;
  if (!top || typeof top.nodes !== 'object' || !Array.isArray(top.edges)) throw new TypeError('computeLayout needs a scenario or a topology {nodes, edges}');
  return top;
}

export function layoutKey(top, width, height, mode) {
  const ids = Object.keys(top.nodes).join(',');
  const edges = top.edges.map((e) => `${e.from}>${e.to}`).join(',');
  return `${mode}|${width}|${height}|${ids}|${edges}`;
}

export function computeLayout(src, { width, height, mode } = {}) {
  const top = topologyOf(src);
  const W = Math.max(120, Math.round(Number.isFinite(width) ? width : 872));
  const Hin = Math.max(200, Math.round(Number.isFinite(height) ? height : 480));
  const m = mode === 'wide' || mode === 'tall' ? mode : W >= WIDE_MIN ? 'wide' : 'tall';
  const key = layoutKey(top, W, Hin, m);
  const hitCache = cache.get(key);
  if (hitCache) return hitCache;
  const A = analyse(top);
  const L = m === 'wide' ? wideLayout(A, W, Hin) : tallLayout(A, W, Hin);
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(key, L);
  return L;
}

export function clearLayoutCache() { cache.clear(); }

const DIRS = { right: [1, 0], left: [-1, 0], down: [0, 1], up: [0, -1] };

// Spatial neighbour for arrow keys: the node whose centre lies in the 90 degree cone around dir with the smallest
// angle-weighted distance. Returns null when nothing lies that way (focus stays).
export function nearest(layout, fromId, dir) {
  const from = layout.nodes[fromId];
  const d = DIRS[dir];
  if (!from || !d) return null;
  let best = null;
  let bestScore = Infinity;
  for (const id of layout.order) {
    if (id === fromId) continue;
    const n = layout.nodes[id];
    const dx = n.cx - from.cx;
    const dy = n.cy - from.cy;
    const along = dx * d[0] + dy * d[1];
    const perp = Math.abs(dx * d[1] - dy * d[0]);
    if (along <= 0 || perp > along) continue; // outside the 90 degree cone
    const angle = Math.atan2(perp, along); // 0..pi/4
    const score = Math.hypot(dx, dy) * (1 + (3 * angle) / (Math.PI / 4));
    if (score < bestScore - 1e-9) { best = id; bestScore = score; }
  }
  return best;
}

// Point and tangent at distance s along an edge polyline (shared by the particle layer and tests).
export function pointAt(edge, s) {
  const { pts, cum, len } = edge;
  const d = Math.max(0, Math.min(len, s));
  let i = 1;
  while (i < pts.length - 1 && cum[i] < d) i++;
  const a = pts[i - 1];
  const b = pts[i];
  const seg = Math.max(1e-9, cum[i] - cum[i - 1]);
  const f = (d - cum[i - 1]) / seg;
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, tx: (b.x - a.x) / seg, ty: (b.y - a.y) / seg };
}
