// SVG structure of the system map: edges, edge labels, nodes. Built once per layout; afterwards only attributes and text change,
// and only when the formatted value changed. Used by the live map (interactive) and the debrief replay map (static).
import { s, icon, setText, setAttr, setAttrs } from './shell.js';
import { pointAt } from '../core/layout.js';
import { STATUS_ICON } from '../core/viewmodel.js';

const BAR_PAD = 10;
const ICON_BY_TYPE = {
  client: 'ic-clients', lb: 'ic-lb', service: 'ic-service', cache: 'ic-cache', db: 'ic-db', queue: 'ic-queue', consumer: 'ic-consumer', 'third-party': 'ic-partner',
};
export const glyphOf = (id, type) => (id === 'db-replica' ? 'ic-replica' : ICON_BY_TYPE[type] || 'ic-service');

export const MAP_TESTIDS = { node: 'map-node', badge: 'map-node-badge', ring: 'map-node-ring', edge: 'map-edge', label: 'edge-label' };
export const REPLAY_TESTIDS = { node: 'replay-node', badge: null, ring: null, edge: null, label: null };

function buildNode(n, name, interactive, ids) {
  const { w, h } = n;
  const bw = w - 2 * BAR_PAD;
  const barY = h - 10;
  const rowY = h - 19;
  const inner = s('g', { class: 'node-inner' }, [
    s('rect', { class: 'node-pulse', x: 0, y: 0, width: w, height: h, rx: 4 }),
    s('rect', { class: 'node-recv-ring', x: 0, y: 0, width: w, height: h, rx: 4 }),
    s('rect', { class: 'node-body', x: 0, y: 0, width: w, height: h, rx: 4 }),
    s('rect', { class: 'node-hatch', x: 1, y: 1, width: w - 2, height: h - 2, rx: 3 }),
    s('svg', { class: 'node-glyph', x: 10, y: 9, width: 16, height: 16, 'aria-hidden': 'true' }, s('use', { href: `#${glyphOf(n.id, n.type)}` })),
    s('text', { class: 'node-name', x: 32, y: 21, text: name }),
    s('g', { class: 'node-badge', 'data-testid': ids.badge || null }, [
      s('use', { class: 'badge-use', href: '#ic-ok', x: 10, y: rowY - 10, width: 12, height: 12 }),
      s('text', { class: 'badge-text', x: 26, y: rowY, text: 'OK' }),
    ]),
    s('text', { class: 'node-metric', x: w - 10, y: rowY, text: '' }),
    s('rect', { class: 'bar-track', x: BAR_PAD, y: barY, width: bw, height: 4 }),
    s('rect', { class: 'bar-zone', x: BAR_PAD + bw * 0.9, y: barY, width: bw * 0.1, height: 4 }),
    s('rect', { class: 'bar-fill', x: BAR_PAD, y: barY, width: 0, height: 4 }),
    s('path', { class: 'bar-tick', d: `M${BAR_PAD + bw * 0.7} ${barY - 2} V${barY + 6}` }),
    s('path', { class: 'bar-tick', d: `M${BAR_PAD + bw * 0.9} ${barY - 2} V${barY + 6}` }),
    s('text', { class: 'node-tag', x: 0, y: -9, text: 'NEW PAGE' }),
  ]);
  const ring = s('rect', { class: 'node-ring', x: -6, y: -6, width: w + 12, height: h + 12, rx: 8, 'data-testid': ids.ring || null });
  const node = s('g', {
    class: 'node',
    'data-node': n.id,
    'data-status': 'ok',
    'data-selected': 'false',
    'data-testid': ids.node,
    role: interactive ? 'button' : 'img',
    tabindex: interactive ? '-1' : null,
  }, [s('circle', { class: 'node-glow', cx: w / 2, cy: h / 2, r: Math.round(w * 0.62) }), inner, ring]);
  const outer = s('g', { transform: `translate(${n.x} ${n.y})` }, node);
  return {
    id: n.id,
    w: n.w,
    outer,
    node,
    name: inner.querySelector('.node-name'),
    badgeUse: inner.querySelector('.badge-use'),
    badgeText: inner.querySelector('.badge-text'),
    metric: inner.querySelector('.node-metric'),
    barFill: inner.querySelector('.bar-fill'),
    barWidth: bw,
    last: {},
  };
}

function buildEdge(e, ids) {
  const path = s('path', { class: 'edge', d: e.d, 'data-testid': ids.edge || null, 'data-state': 'normal', 'data-from': e.from, 'data-to': e.to });
  const lb = e.label;
  const label = s('text', {
    class: `edge-label${lb && lb.anchor === 'start' ? ' edge-label-start' : lb && lb.anchor === 'end' ? ' edge-label-end' : ''}`,
    x: lb ? lb.x : e.mid.x,
    y: lb ? lb.y : e.mid.y,
    'data-testid': ids.label || null,
    'data-from': e.from,
    'data-to': e.to,
    hidden: lb ? null : '',
    text: '',
  });
  // open circuit breaker: a perpendicular bar at the midpoint and the tag
  const p = pointAt(e, e.len / 2);
  const bar = s('path', { class: 'edge-breaker', d: `M${round(e.mid.x - p.ty * 5)} ${round(e.mid.y + p.tx * 5)} L${round(e.mid.x + p.ty * 5)} ${round(e.mid.y - p.tx * 5)}` });
  const horizontal = Math.abs(p.tx) >= Math.abs(p.ty);
  const tag = s('text', {
    class: 'edge-tag',
    x: horizontal ? e.mid.x : e.mid.x + 10,
    y: horizontal ? e.mid.y - 12 : e.mid.y + 4,
    text: 'BREAKER OPEN',
  });
  if (!horizontal) tag.setAttribute('class', 'edge-tag edge-tag-start');
  const breaker = s('g', { class: 'edge-cut', hidden: '' }, [bar, tag]);
  return { key: e.key, path, label, breaker, tag, horizontal, geom: e, last: {} };
}

const round = (n) => Math.round(n * 10) / 10;

// layout -> { svg, nodes: Map, edges: Map }
export function buildMapSvg(layout, scenario, { interactive = true, testids = MAP_TESTIDS, nameOf } = {}) {
  const svg = s('svg', {
    class: 'map-svg',
    viewBox: `0 0 ${layout.width} ${layout.height}`,
    width: layout.width,
    height: layout.height,
    'data-layout': layout.mode,
    focusable: 'false',
  });
  const edges = new Map();
  const edgeLayer = s('g', { class: 'map-edges' });
  const labelLayer = s('g', { class: 'map-edge-labels' });
  const nodeLayer = s('g', { class: 'map-nodes' });
  for (const e of layout.edges) {
    const ref = buildEdge(e, testids);
    edges.set(e.key, ref);
    edgeLayer.append(ref.path, ref.breaker);
    labelLayer.append(ref.label);
  }
  const nodes = new Map();
  for (const id of layout.order) {
    const ref = buildNode(layout.nodes[id], nameOf(id), interactive, testids);
    nodes.set(id, ref);
    nodeLayer.append(ref.outer);
  }
  svg.append(edgeLayer, labelLayer, nodeLayer);
  return { svg, nodes, edges };
}

// Shorten a node name until it fits its row (measured once the svg is in the document).
export function fitNames(nodes, nameOf) {
  for (const ref of nodes.values()) {
    const full = nameOf(ref.id);
    const max = ref.w - 32 - 8;
    ref.name.textContent = full;
    let len = 0;
    try { len = ref.name.getComputedTextLength(); } catch { return; }
    if (!len || len <= max) continue;
    let k = full.length;
    while (k > 1 && ref.name.getComputedTextLength() > max) { k--; ref.name.textContent = `${full.slice(0, k).trimEnd()}…`; }
  }
}

// Per-update writes. Every call compares against the last written value first.
export function applyNode(ref, view) {
  const l = ref.last;
  const a = view.attrs;
  for (const k of Object.keys(a)) setAttr(ref.node, k, a[k]);
  setAttr(ref.node, 'aria-label', view.aria);
  if (l.status !== view.status) {
    ref.badgeUse.setAttribute('href', STATUS_ICON[view.status]);
    l.status = view.status;
  }
  setText(ref.badgeText, view.statusLabel);
  setText(ref.metric, view.metricText);
  const bw = Math.round(view.bar * ref.barWidth * 10) / 10;
  if (l.bar !== bw) { ref.barFill.setAttribute('width', bw); l.bar = bw; }
}

export function applyEdge(ref, view, { showLabels = true } = {}) {
  setAttrs(ref.path, view.attrs);
  setAttr(ref.path, 'data-load', view.load);
  setAttr(ref.path, 'data-dim', view.dim ? 'true' : null);
  const has = ref.geom.label !== null;
  if (has) {
    const short = ref.geom.label.short;
    setText(ref.label, short ? view.short : view.text);
    setAttr(ref.label, 'data-state', view.state);
    setAttr(ref.label, 'data-rps', view.rps);
  }
  setAttr(ref.label, 'hidden', !has || !showLabels || view.cut ? true : null);
  setAttr(ref.breaker, 'hidden', view.cut ? null : true);
}

export { icon };
