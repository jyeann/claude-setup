// Graph screen: fetches /api/graph, runs layout.js, draws SVG nodes and edges, and the text alternative list.
import { h, plural } from './dom.js';
import { createLayout, runFor, fitToBox, truncateLabel, hitRadii, separate } from './layout.js';
import { backLink } from './notes.js';
import { noteUrl } from './router.js';
import { focusEl } from './live.js';
import { titleKey } from './titles.js';

export const READY_ITERATIONS = 60;
export const READY_MS = 1000;
export const LABEL_LIMIT = 200;
const REDUCED_CAP_MS = 1500;
const RAF_BUDGET_MS = 8;

export const graphSummary = (nodes, edges) => `${plural(nodes, 'note', 'notes')}, ${plural(edges, 'link', 'links')}`;

// Index-based adjacency from the API payload. Unknown titles in edges are skipped.
export function prepareGraph(data) {
  const index = new Map(data.nodes.map((n, i) => [n.title, i]));
  const edges = [];
  const neighbors = data.nodes.map(() => []);
  for (const [a, b] of data.edges) {
    const i = index.get(a);
    const j = index.get(b);
    if (i === undefined || j === undefined || i === j) continue;
    edges.push([i, j]);
    neighbors[i].push(j);
    neighbors[j].push(i);
  }
  for (const list of neighbors) list.sort((p, q) => p - q);
  return { index, edges, neighbors };
}

export function linksText(titles) {
  return titles.length === 0 ? 'No links' : `Links to ${titles.join(', ')}`;
}

export function buildGraphList(doc, nodes, neighbors) {
  return h(doc, 'ul', { testid: 'graph-list', class: 'graph-list' }, nodes.map((n, i) => h(doc, 'li', { testid: 'graph-list-item', 'data-title': n.title, class: 'graph-list-item' }, [
    h(doc, 'a', { href: noteUrl(n.title), text: n.title }),
    h(doc, 'span', { class: 'graph-links', text: linksText(neighbors[i].map((j) => nodes[j].title)) }),
  ])));
}

// Draws the SVG once and returns place(fit) to move everything after the layout changes.
export function drawGraph(doc, svg, data, prep, { currentKey, hitRadius, open, width }) {
  const { nodes } = data;
  const labelsAlways = nodes.length <= LABEL_LIMIT;
  const edgeLayer = h(doc, 'g', { svg: true, class: 'graph-edges' });
  const nodeLayer = h(doc, 'g', { svg: true, class: 'graph-nodes' });
  const labelLayer = h(doc, 'g', { svg: true, class: 'graph-labels', 'aria-hidden': 'true' });
  const labelEls = new Map();
  const lines = prep.edges.map(([i, j]) => {
    const line = h(doc, 'line', { svg: true, testid: 'graph-edge', 'data-from': nodes[i].title, 'data-to': nodes[j].title, class: 'graph-edge' });
    edgeLayer.appendChild(line);
    return line;
  });
  const side = new Array(nodes.length).fill('start');

  const pos = nodes.map(() => [0, 0]);
  const labelFor = (i) => {
    const t = h(doc, 'text', { svg: true, class: 'graph-label', 'text-anchor': side[i], text: truncateLabel(nodes[i].title) });
    return t;
  };
  const moveLabel = (i) => {
    const t = labelEls.get(i);
    if (!t) return;
    t.setAttribute('x', (pos[i][0] + (side[i] === 'start' ? 14 : -14)).toFixed(1));
    t.setAttribute('y', (pos[i][1] + 4).toFixed(1));
    t.setAttribute('text-anchor', side[i]);
  };
  const els = nodes.map((node, i) => {
    const current = currentKey !== null && titleKey(node.title) === currentKey;
    const g = h(doc, 'g', {
      svg: true,
      testid: 'graph-node',
      'data-title': node.title,
      'data-current': current ? 'true' : 'false',
      'data-orphan': node.orphan ? 'true' : 'false',
      tabindex: '0',
      role: 'link',
      'aria-label': `Open note ${node.title}`,
      class: 'graph-node',
    }, [
      h(doc, 'title', { svg: true, text: node.title }),
      h(doc, 'circle', { svg: true, class: 'graph-hit', r: String(hitRadius) }),
      h(doc, 'circle', { svg: true, class: 'graph-focus', r: String(current ? 17 : 14) }),
      h(doc, 'circle', { svg: true, class: 'graph-dot', r: String(current ? 10 : 7) }),
    ]);
    g.addEventListener('click', () => open(node.title));
    g.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        open(node.title);
      }
    });
    nodeLayer.appendChild(g);
    return g;
  });

  // Labels: always on for small graphs; otherwise the current note, and hovered or focused notes with their neighbours.
  const shown = new Set();
  const setLabel = (i, on) => {
    const existing = labelEls.get(i);
    if (on && !existing) {
      labelEls.set(i, labelFor(i));
      labelLayer.appendChild(labelEls.get(i));
      moveLabel(i);
    } else if (!on && existing) {
      labelLayer.removeChild(existing);
      labelEls.delete(i);
    }
  };
  const highlight = (i, on) => {
    for (const k of [i, ...prep.neighbors[i]]) {
      if (on) shown.add(k);
      else if (!(nodes[k] && titleKey(nodes[k].title) === currentKey)) shown.delete(k);
      setLabel(k, on || shown.has(k));
    }
  };
  if (!labelsAlways) {
    els.forEach((g, i) => {
      g.addEventListener('mouseenter', () => highlight(i, true));
      g.addEventListener('mouseleave', () => highlight(i, false));
      g.addEventListener('focus', () => highlight(i, true));
      g.addEventListener('blur', () => highlight(i, false));
    });
  }
  svg.appendChild(edgeLayer);
  svg.appendChild(nodeLayer);
  svg.appendChild(labelLayer);

  const hits = els.map((g) => g.querySelector('.graph-hit'));
  const hitR = new Array(els.length).fill(hitRadius);
  function place(layout, fit) {
    const n = els.length;
    const px = new Float64Array(n);
    const py = new Float64Array(n);
    for (let i = 0; i < n; i += 1) {
      px[i] = layout.x[i] * fit.scale + fit.offsetX;
      py[i] = layout.y[i] * fit.scale + fit.offsetY;
      els[i].setAttribute('transform', `translate(${px[i].toFixed(1)} ${py[i].toFixed(1)})`);
      pos[i][0] = px[i];
      pos[i][1] = py[i];
      side[i] = px[i] > width * 0.6 ? 'end' : 'start';
      moveLabel(i);
    }
    const radii = hitRadii(px, py, n, hitRadius, 8);
    for (let i = 0; i < n; i += 1) {
      const r = Math.round(radii[i] * 10) / 10;
      if (r !== hitR[i]) {
        hitR[i] = r;
        hits[i].setAttribute('r', String(r));
      }
    }
    prep.edges.forEach(([i, j], k) => {
      lines[k].setAttribute('x1', px[i].toFixed(1));
      lines[k].setAttribute('y1', py[i].toFixed(1));
      lines[k].setAttribute('x2', px[j].toFixed(1));
      lines[k].setAttribute('y2', py[j].toFixed(1));
    });
  }
  els.forEach((g, i) => {
    if (labelsAlways || g.getAttribute('data-current') === 'true') {
      setLabel(i, true);
      shown.add(i);
    }
  });
  return { place, nodeEls: els };
}

// ctx: {doc, win, api, router}. Returns the section and the controls the app needs.
export function createGraphView(ctx, route) {
  const { doc, win, api, router } = ctx;
  const loading = h(doc, 'p', { testid: 'graph-loading', role: 'status', class: 'muted', text: 'Loading graph...' });
  const heading = h(doc, 'h1', { tabindex: '-1', text: 'Graph' });
  const section = h(doc, 'section', { testid: 'graph-view', class: 'graph-view' }, [backLink(doc), heading, loading]);
  let stopped = false;
  const timers = [];
  const later = (fn, ms = 0) => { timers.push(win.setTimeout(fn, ms)); };

  // Drop everything after the heading. The heading itself never leaves the DOM, so it keeps focus.
  function resetBody() {
    while (section.lastChild && section.lastChild !== heading) section.removeChild(section.lastChild);
  }

  function retry() {
    load();
    focusEl(heading);
  }

  function failure() {
    resetBody();
    section.appendChild(h(doc, 'p', { role: 'alert', text: 'Could not load the graph. Try again.' }));
    section.appendChild(h(doc, 'button', { type: 'button', testid: 'graph-retry', class: 'btn', text: 'Try again', on: { click: retry } }));
  }

  function startLayout(svg, data, prep) {
    const phone = win.innerWidth < 720;
    const rect = svg.getBoundingClientRect();
    const width = Math.max(Math.round(rect.width) || 800, 200);
    const height = Math.max(Math.round(rect.height) || 600, 200);
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    const currentKey = route.note ? titleKey(route.note) : null;
    const layout = createLayout(data.nodes.length, prep.edges);
    const now = () => win.performance.now();
    const reduced = win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const fit = () => fitToBox(layout, data.nodes.length, width, height, { pad: 60 });
    let drawn = null;

    // Spread out dots that ended up on top of each other: about 16 px apart, less when the graph is large.
    const gap = Math.min(16, Math.max(10, 0.6 * Math.sqrt((width * height) / data.nodes.length)));
    const respace = () => {
      for (let round = 0; round < 3; round += 1) separate(layout, data.nodes.length, gap / fit().scale, 100);
    };
    const draw = () => {
      respace();
      drawn = drawGraph(doc, svg, data, prep, { currentKey, hitRadius: phone ? 28 : 16, open: (t) => router.navigate(noteUrl(t)), width });
      drawn.place(layout, fit());
      loading.setAttribute('hidden', '');
      svg.setAttribute('data-ready', 'true');
    };
    const t0 = now();
    if (reduced) {
      runFor(layout, { budgetMs: REDUCED_CAP_MS, now });
      draw();
      return;
    }
    const settle = () => {
      if (stopped || layout.done) return;
      runFor(layout, { budgetMs: RAF_BUDGET_MS, iterations: 4, now });
      if (layout.done) respace();
      drawn.place(layout, fit());
      win.requestAnimationFrame(settle);
    };
    const tick = () => {
      if (stopped) return;
      runFor(layout, { budgetMs: 12, now });
      if (layout.iteration >= READY_ITERATIONS || layout.done || now() - t0 >= READY_MS) {
        draw();
        win.requestAnimationFrame(settle);
      } else later(tick);
    };
    tick();
  }

  async function load() {
    resetBody();
    section.appendChild(loading);
    loading.removeAttribute('hidden');
    let data;
    try {
      data = await api.graph();
    } catch {
      if (!stopped) failure();
      return;
    }
    if (stopped) return;
    if (data.nodes.length === 0) {
      loading.setAttribute('hidden', '');
      section.appendChild(h(doc, 'p', { testid: 'graph-empty', text: 'No notes to graph yet.' }));
      return;
    }
    const prep = prepareGraph(data);
    section.appendChild(h(doc, 'p', { testid: 'graph-summary', class: 'graph-summary', text: graphSummary(data.nodes.length, prep.edges.length) }));
    const svg = h(doc, 'svg', {
      svg: true,
      testid: 'graph-svg',
      class: 'graph-svg',
      role: 'group',
      'aria-label': 'Graph of notes and links',
      'data-node-count': String(data.nodes.length),
      'data-edge-count': String(prep.edges.length),
    });
    section.appendChild(svg);
    section.appendChild(h(doc, 'h2', { class: 'graph-list-heading', text: 'All notes and their links' }));
    section.appendChild(buildGraphList(doc, data.nodes, prep.neighbors));
    startLayout(svg, data, prep);
  }

  return {
    el: section,
    heading,
    load,
    destroy() {
      stopped = true;
      for (const id of timers) win.clearTimeout(id);
    },
  };
}
