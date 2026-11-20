// The system map: "the map is the instrument". createMap(rootEl, scenario) -> { update(state), setSelected(id|null), onSelect(fn),
// onActivate(fn), destroy() } plus a few extras (setPaused, focusNode, stats, layout, refreshTheme).
//
// Structure inside rootEl: a canvas (request dots only, aria-hidden) under one SVG (edges, edge labels, nodes, rings).
// The SVG is written once per layout; after that only attributes and text change, and only when the value changed.
import { computeLayout, nearest, WIDE_MIN } from '../core/layout.js';
import { nodeLabel } from '../core/viewmodel.js';
import { buildMapView, edgeBaselines } from './map-model.js';
import {
  buildMapSvg, applyNode, applyEdge, fitNames, MAP_TESTIDS,
} from './map-svg.js';
import { createDotLayer } from './map-canvas.js';
import { setAttr } from './shell.js';

const RESIZE_DEBOUNCE_MS = 100;
const CRIT_SHAKE_MS = 400;
const RECV_RING_MS = 3000;
const WARM_SECONDS = 3;
const NEW_TAG_MS = 8000;
const ARROWS = { ArrowRight: 'right', ArrowLeft: 'left', ArrowUp: 'up', ArrowDown: 'down' };

export function createMap(rootEl, scenario) {
  const nameOf = (id) => nodeLabel(scenario, id);
  const ids = Object.keys(scenario.topology.nodes);
  if (!rootEl.hasAttribute('data-testid')) rootEl.setAttribute('data-testid', 'system-map');
  if (!rootEl.hasAttribute('role')) rootEl.setAttribute('role', 'group');
  if (!rootEl.hasAttribute('aria-label')) rootEl.setAttribute('aria-label', 'System map');
  rootEl.classList.add('map', 'ticks');
  rootEl.setAttribute('data-ready', 'false');

  const layer = createDotLayer(rootEl, { seed: scenario.seed });
  const mqReduced = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  const mqDark = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
  let reduced = !!(mqReduced && mqReduced.matches);

  let layout = null;
  let layoutKey = '';
  let built = null; // {svg, nodes, edges}
  let lastState = null;
  let lastView = null;
  let baselines = null;
  let selected = null;
  let roving = null;
  let seeded = false;
  let destroyed = false;
  let paused = false;
  let selectFn = () => {};
  let activateFn = () => {};
  const prevStatus = new Map();
  const timers = new Set();

  // ------------------------------------------------------------ build
  function measure() {
    const r = rootEl.getBoundingClientRect();
    const cs = getComputedStyle(rootEl);
    const minH = parseFloat(cs.minHeight) || 0;
    // Wide: the container height is the layout height. Tall: the svg itself sets the container height, so only the CSS minimum counts.
    const tall = r.width > 0 && r.width < WIDE_MIN;
    return { w: Math.round(r.width) || 872, h: Math.round(tall ? minH : Math.max(r.height, minH)) || 480, real: r.width > 0 };
  }

  function build(force = false) {
    if (destroyed) return;
    const m = measure();
    const mode = m.w >= WIDE_MIN ? 'wide' : 'tall';
    const next = computeLayout(scenario, { width: m.w, height: m.h, mode });
    const key = `${next.mode}|${next.width}|${next.height}`;
    if (!force && built && key === layoutKey) return;
    layout = next;
    layoutKey = key;
    if (built) built.svg.remove();
    built = buildMapSvg(layout, scenario, { interactive: true, testids: MAP_TESTIDS, nameOf });
    rootEl.append(built.svg);
    rootEl.setAttribute('data-layout', layout.mode);
    rootEl.setAttribute('data-ready', m.real ? 'true' : 'false');
    built.svg.style.inlineSize = `${layout.width}px`;
    built.svg.style.blockSize = `${layout.height}px`;
    layer.canvas.style.inlineSize = `${layout.width}px`;
    layer.canvas.style.blockSize = `${layout.height}px`;
    layer.resize(layout.width, layout.height);
    layer.setGeometry(layout.edges);
    fitNames(built.nodes, nameOf);
    for (const [id, ref] of built.nodes) {
      ref.node.setAttribute('data-selected', String(id === selected));
      ref.node.setAttribute('tabindex', '-1');
    }
    if (!roving || !built.nodes.has(roving)) roving = selected && built.nodes.has(selected) ? selected : layout.order[0];
    setRoving(roving);
    if (lastView) paint(lastView, true);
    if (lastState) feedLayer(lastView);
  }

  function setRoving(id) {
    if (!built) return;
    roving = id;
    for (const [nid, ref] of built.nodes) setAttr(ref.node, 'tabindex', nid === id ? '0' : '-1');
  }

  // ------------------------------------------------------------ paint
  function later(fn, ms) {
    const t = setTimeout(() => { timers.delete(t); if (!destroyed) fn(); }, ms);
    timers.add(t);
  }

  function transition(id, ref, from, to) {
    const node = ref.node;
    const worse = (to === 'warn' || to === 'crit') && from !== to && !(from === 'crit' && to === 'warn');
    if (worse) {
      node.setAttribute('data-new', 'true'); // pulse x3, then the NEW PAGE tag until selected (reduced motion) or 8 s
      if (!reduced) later(() => { if (id !== selected) node.removeAttribute('data-new'); }, NEW_TAG_MS);
    }
    if (to === 'crit' && from !== 'crit') {
      node.removeAttribute('data-just-crit');
      void node.getBoundingClientRect(); // restart the one-shot shake
      node.setAttribute('data-just-crit', 'true');
      later(() => node.removeAttribute('data-just-crit'), CRIT_SHAKE_MS);
    }
    if (to === 'recovering' && from !== 'recovering') {
      node.removeAttribute('data-just-recv');
      void node.getBoundingClientRect();
      node.setAttribute('data-just-recv', 'true');
      later(() => node.removeAttribute('data-just-recv'), RECV_RING_MS);
    }
    if (to === 'ok' || to === 'recovering') node.removeAttribute('data-new');
    if (id === selected) node.removeAttribute('data-new');
  }

  function paint(view, quiet = false) {
    if (!built) return;
    for (const [id, ref] of built.nodes) {
      const nv = view.nodes[id];
      if (!nv) continue;
      applyNode(ref, nv);
      const prev = prevStatus.get(id);
      if (!quiet && prev !== undefined && prev !== nv.status) transition(id, ref, prev, nv.status);
      prevStatus.set(id, nv.status);
    }
    for (const [key, ref] of built.edges) {
      const ev = view.edges[key];
      if (ev) applyEdge(ref, ev);
    }
  }

  function feedLayer(view) {
    if (!view) return;
    layer.setLoads(view);
  }

  // ------------------------------------------------------------ public API
  function update(state) {
    if (destroyed) return;
    lastState = state;
    if (!baselines) baselines = edgeBaselines(scenario, state);
    // Under reduced motion the metrics repaint on even simulated seconds only (the final state always paints).
    if (reduced && state.status === 'running' && state.tick % 2 === 1 && lastView) return;
    const view = buildMapView(scenario, state, baselines, { reduced });
    lastView = view;
    paint(view);
    if (!seeded) {
      seeded = true;
      layer.reseed(state.seed);
      feedLayer(view);
      if (!reduced) layer.warm(WARM_SECONDS);
    } else feedLayer(view);
    if (!reduced) layer.touch(); // a tick arrived: the dots move; after the last tick they calm down and freeze by themselves
    setAttr(rootEl, 'data-updated-at', state.tick);
  }

  function select(id, activate) {
    if (!built || !built.nodes.has(id)) return;
    setSelected(id);
    setRoving(id);
    selectFn(id);
    if (activate) activateFn(id);
  }

  function setSelected(id) {
    selected = id && ids.includes(id) ? id : null;
    if (!built) return;
    for (const [nid, ref] of built.nodes) {
      const on = nid === selected;
      setAttr(ref.node, 'data-selected', on ? 'true' : 'false');
      if (on) ref.node.removeAttribute('data-new');
    }
    if (selected) setRoving(selected);
  }

  function focusNode(id) {
    const ref = built && built.nodes.get(id);
    if (!ref) return;
    setRoving(id);
    ref.node.focus({ preventScroll: true });
  }

  // ------------------------------------------------------------ events
  const nodeOf = (target) => {
    const g = target && target.closest ? target.closest('.node') : null;
    return g ? g.getAttribute('data-node') : null;
  };
  const onClick = (e) => {
    const id = nodeOf(e.target);
    if (!id) return;
    focusNode(id);
    select(id, true);
  };
  const onKeydown = (e) => {
    const id = nodeOf(e.target);
    if (!id || e.ctrlKey || e.metaKey || e.altKey) return;
    if (ARROWS[e.key]) {
      e.preventDefault();
      e.stopPropagation();
      const to = nearest(layout, id, ARROWS[e.key]);
      if (to) { focusNode(to); select(to, false); }
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      e.stopPropagation();
      const to = e.key === 'Home' ? layout.order[0] : layout.order[layout.order.length - 1];
      focusNode(to);
      select(to, false);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      select(id, true);
    }
  };
  const onFocusin = (e) => {
    const id = nodeOf(e.target);
    if (id && id !== roving) setRoving(id);
  };
  rootEl.addEventListener('click', onClick);
  rootEl.addEventListener('keydown', onKeydown);
  rootEl.addEventListener('focusin', onFocusin);

  let resizeTimer = 0;
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (!destroyed) build(); }, RESIZE_DEBOUNCE_MS);
  }) : null;
  if (ro) ro.observe(rootEl);

  const onReducedChange = () => {
    reduced = !!mqReduced.matches;
    rootEl.setAttribute('data-reduced-motion', String(reduced));
    layer.setEnabled(!reduced);
    if (lastState) { const keep = lastState; lastView = null; update(keep); }
  };
  const onThemeChange = () => layer.refreshTheme();
  if (mqReduced) mqReduced.addEventListener('change', onReducedChange);
  if (mqDark) mqDark.addEventListener('change', onThemeChange);
  rootEl.setAttribute('data-reduced-motion', String(reduced));
  layer.setEnabled(!reduced);

  build(true);

  return {
    update,
    setSelected,
    onSelect(fn) { selectFn = typeof fn === 'function' ? fn : () => {}; },
    onActivate(fn) { activateFn = typeof fn === 'function' ? fn : () => {}; },
    // extras
    setPaused(p) { paused = !!p; layer.setPaused(paused); },
    focusNode,
    refreshTheme: () => layer.refreshTheme(),
    resize: () => build(),
    stats: () => layer.stats(),
    resetStats: () => layer.resetStats(),
    get layout() { return layout; },
    get canvas() { return layer.canvas; },
    get dotLayer() { return layer; },
    destroy() {
      destroyed = true;
      clearTimeout(resizeTimer);
      for (const t of timers) clearTimeout(t);
      timers.clear();
      if (ro) ro.disconnect();
      if (mqReduced) mqReduced.removeEventListener('change', onReducedChange);
      if (mqDark) mqDark.removeEventListener('change', onThemeChange);
      rootEl.removeEventListener('click', onClick);
      rootEl.removeEventListener('keydown', onKeydown);
      rootEl.removeEventListener('focusin', onFocusin);
      layer.destroy();
      if (built) built.svg.remove();
      built = null;
    },
  };
}
