// The flight recorder panel: status ribbon, p99 trace (you solid, optimal dashed), two lanes with lettered marks, a shared time
// axis, the scrubber, a static replay map and the narration. Scrubbing only reads the snapshots computed by core/debrief-model.js.
import {
  h, s, icon, setText, setAttr,
} from './shell.js';
import { computeLayout } from '../core/layout.js';
import { nodeLabel, STATUS_LABEL } from '../core/viewmodel.js';
import { narrate, ribbonLabel, actionName } from '../core/debrief-model.js';
import { mmss, int } from '../core/format.js';
import { buildMapSvg, applyNode, applyEdge, fitNames, REPLAY_TESTIDS } from './map-svg.js';
import { compact, edgeKey } from './map-model.js';

const PLAY_RATE = 6; // simulated seconds per real second
const TICK_STEPS = [10, 15, 30, 60, 120];
const MARK_ICON = { D: 'ic-mark-d', F: 'ic-mark-f', x: 'ic-mark-x', '.': 'ic-mark-dot' };
const TRACE_H = 72;
const TRACE_TOP = 16;
const P99_MAX = 3000;
const UNAVAILABLE_TEXT = 'This run cannot be replayed because the scenario file changed since you played it. Your score is still saved.';

export function chooseAxis(end) {
  const step = TICK_STEPS.find((t) => Math.ceil(end / t) <= 6) || 240;
  const axisEnd = Math.max(step, Math.ceil(end / step) * step);
  const ticks = [];
  for (let t = 0; t <= axisEnd; t += step) ticks.push(t);
  return { step, axisEnd, ticks };
}

export function createRecorder(model, { reduced = false } = {}) {
  const { scenario } = model;
  const root = h('section', { class: 'panel recorder', testid: 'replay', 'aria-labelledby': 'rec-title' }, [
    h('div', { class: 'panel-head' }, [
      h('h2', { id: 'rec-title', text: 'Flight recorder' }),
      h('span', { class: 'panel-aside', text: 'Same seed, same run, every time' }),
    ]),
  ]);
  if (model.unavailable) {
    root.append(h('p', { class: 'banner-body', testid: 'replay-unavailable', role: 'status', text: UNAVAILABLE_TEXT }));
    return { el: root, destroy() {}, setTime() {}, jump() {}, toggle() {} };
  }

  const end = model.you.snaps.length - 1;
  const axis = chooseAxis(Math.max(end, model.opt.snaps.length - 1));
  const marksYou = model.you.marks;
  const marksOpt = model.opt.marks;
  let time = 0;
  let timer = 0;
  let destroyed = false;

  // ---- ribbon
  const ribbon = h('div', { class: 'ribbon', role: 'img', 'aria-label': ribbonLabel(model) });
  for (let t = 0; t < axis.axisEnd; t++) {
    const st = t < model.ribbon.length ? model.ribbon[t] : null;
    ribbon.append(h('i', st ? { 'data-status': st } : null));
  }
  // ---- trace
  const trace = s('svg', { class: 'trace', role: 'img', 'aria-label': 'p99 latency, your run against the optimal run', height: TRACE_H + TRACE_TOP });
  // ---- lanes
  const laneYou = h('div', { class: 'lane', 'data-lane': 'you', testid: 'replay-lane-you' }, h('span', { class: 'lane-label', text: 'You' }));
  const laneOpt = h('div', { class: 'lane', 'data-lane': 'optimal', testid: 'replay-lane-optimal' }, h('span', { class: 'lane-label', text: 'Optimal' }));
  const pct = (t) => `${Math.round((t / axis.axisEnd) * 10000) / 100}%`;
  const addLine = (lane, t, label, endAlign) => {
    const line = h('span', { class: 'lane-line' });
    line.style.insetInlineStart = pct(t);
    const text = h('span', { class: `lane-line-label${endAlign ? ' lane-line-label-end' : ''}`, text: label });
    text.style.insetInlineStart = pct(t);
    lane.append(line, text);
  };
  if (model.onsetTick !== null && model.onsetTick !== undefined) addLine(laneYou, model.onsetTick, 'Onset', false);
  if (model.resolved) addLine(laneYou, model.timeToMitigate, `Mitigated ${mmss(model.timeToMitigate)}`, true);
  const markEls = [];
  const addMark = (lane, m, laneName) => {
    const harmfulText = m.effect === 'harmful' ? ', harmful' : '';
    const node = m.node ? ` on ${nodeLabel(scenario, m.node)}` : '';
    const b = h('button', {
      class: 'mark', type: 'button', testid: 'replay-mark', 'data-lane': laneName, 'data-action-id': m.id, 'data-time': m.t, 'data-kind': m.kind,
      'aria-label': `${laneName === 'you' ? 'You: ' : 'Optimal: '}${actionName(m.id)}${node} at ${mmss(m.t)}${harmfulText}`,
    }, [icon(MARK_ICON[m.kind], ''), h('span', { text: m.kind })]);
    b.style.insetInlineStart = pct(m.t);
    b.addEventListener('click', () => { setTime(m.t, true); });
    lane.append(b);
    markEls.push({ el: b, t: m.t, lane: laneName });
  };
  for (const m of marksYou) addMark(laneYou, m, 'you');
  for (const m of marksOpt) addMark(laneOpt, m, 'optimal');
  const link = s('svg', { class: 'lanes-link', 'aria-hidden': 'true', focusable: 'false' }, [s('line', { class: 'lanes-connector' }), s('line', { class: 'lanes-cursor' })]);
  const lanes = h('div', { class: 'lanes' }, [laneYou, laneOpt, link]);
  const axisEl = h('div', { class: 'axis', 'aria-hidden': 'true' }, axis.ticks.map((t) => h('span', { text: mmss(t) })));

  // ---- scrubber
  const slider = h('input', {
    class: 'scrubber', id: 'rec-slider', type: 'range', min: 0, max: end, step: 1, value: 0, testid: 'replay-slider',
  });
  const timeChip = h('span', { class: 'chip', text: '00:00' });
  const playBtn = h('button', { class: 'btn btn-icon', type: 'button', testid: 'replay-play' }, [icon('ic-play', 'icon'), h('span', { class: 'btn-label', text: 'Play replay' })]);
  const playReason = h('span', { class: 'reason', hidden: reduced ? null : '', text: 'Replay playback is off under reduced motion. Use the slider.' });
  const scrubRow = h('div', { class: 'scrubber-row' }, [playBtn, h('label', { class: 'sr-only', for: 'rec-slider', text: 'Replay position' }), slider, timeChip]);
  if (reduced) setAttr(playBtn, 'aria-disabled', 'true');

  // ---- replay map
  const mapBox = h('div', { class: 'replay-map', testid: 'replay-map' });
  let mapRef = null;
  let mapKey = '';
  const narration = h('p', { class: 'narration', testid: 'replay-narration', 'aria-live': 'off' });

  root.append(ribbon, trace, lanes, axisEl, scrubRow, playReason, mapBox, narration);

  // ---------------------------------------------------------------- map
  function viewAt(snap) {
    const nodes = {};
    for (const id of Object.keys(scenario.topology.nodes)) {
      const m = snap.m[id];
      const st = snap.statuses[id];
      const type = id === 'clients' ? 'client' : id === 'cache' ? 'cache' : id === 'queue' ? 'queue' : 'x';
      let metricText = `${Math.round(m.saturation * 100)}%`;
      if (type === 'client') metricText = `${compact(m.rps)}/s`;
      else if (type === 'cache' && m.hitRate !== null) metricText = `hit ${Math.round(m.hitRate * 100)}%`;
      else if (type === 'queue') metricText = `Q ${compact(m.queue)}`;
      nodes[id] = {
        attrs: { 'data-node': id, 'data-status': st, 'data-selected': 'false' },
        status: st,
        statusLabel: STATUS_LABEL[st],
        metricText,
        bar: Math.max(0, Math.min(1, m.saturation)),
        aria: `${nodeLabel(scenario, id)}. ${STATUS_LABEL[st]}. Saturation ${Math.round(m.saturation * 100)} percent.`,
      };
    }
    const edges = {};
    for (const e of scenario.topology.edges) {
      const to = snap.m[e.to];
      const failing = to.errorRate >= 0.05;
      edges[edgeKey(e.from, e.to)] = {
        attrs: { 'data-from': e.from, 'data-to': e.to, 'data-state': failing ? 'failing' : to.saturation > 0.8 ? 'loaded' : 'normal' },
        load: to.saturation > 0.8 ? 'high' : to.saturation >= 0.4 ? 'mid' : 'low',
        dim: false, cut: false, state: failing ? 'failing' : 'normal', text: '', short: '', rps: 0,
      };
    }
    return { nodes, edges };
  }

  function buildMap() {
    const w = Math.round(mapBox.getBoundingClientRect().width) || 540;
    const layout = computeLayout(scenario, { width: w, height: 260, mode: w >= 440 ? 'wide' : 'tall' });
    const key = `${layout.mode}|${layout.width}|${layout.height}`;
    if (key === mapKey) return;
    mapKey = key;
    if (mapRef) mapRef.svg.remove();
    mapRef = buildMapSvg(layout, scenario, { interactive: false, testids: REPLAY_TESTIDS, nameOf: (id) => nodeLabel(scenario, id) });
    mapRef.svg.setAttribute('role', 'group');
    mapBox.append(mapRef.svg);
    fitNames(mapRef.nodes, (id) => nodeLabel(scenario, id));
    paintMap();
  }

  function paintMap() {
    if (!mapRef) return;
    const snap = model.you.snaps[Math.min(time, end)];
    const v = viewAt(snap);
    for (const [id, ref] of mapRef.nodes) applyNode(ref, v.nodes[id]);
    for (const [k, ref] of mapRef.edges) applyEdge(ref, v.edges[k], { showLabels: false });
    setAttr(mapRef.svg, 'aria-label', `System at ${mmss(time)}`);
  }

  // ---------------------------------------------------------------- trace and lanes geometry
  function relayout() {
    if (destroyed) return;
    const lanesBox = lanes.getBoundingClientRect();
    const laneBox = laneYou.getBoundingClientRect();
    const trBox = trace.getBoundingClientRect();
    const rbBox = ribbon.getBoundingClientRect();
    if (!lanesBox.width) return;
    const inset = Math.max(0, Math.round(laneBox.left - rbBox.left));
    ribbon.style.marginInlineStart = `${inset}px`;
    ribbon.style.inlineSize = `calc(100% - ${inset}px)`;
    const W = Math.round(trBox.width) || 600;
    const x0 = Math.max(0, Math.round(laneBox.left - trBox.left));
    const pw = Math.max(40, Math.round(laneBox.width));
    trace.setAttribute('viewBox', `0 0 ${W} ${TRACE_H + TRACE_TOP}`);
    trace.setAttribute('width', W);
    trace.replaceChildren();
    const yOf = (v) => Math.round((TRACE_TOP + TRACE_H - 6 - (Math.min(v, P99_MAX) / P99_MAX) * (TRACE_H - 14)) * 10) / 10;
    const xOf = (t) => Math.round((x0 + (t / axis.axisEnd) * pw) * 10) / 10;
    const path = (arr) => arr.map((v, t) => `${t === 0 ? 'M' : 'L'}${xOf(t)} ${yOf(v)}`).join(' ');
    const crit = (scenario.thresholds && scenario.thresholds.p99 && scenario.thresholds.p99.crit) || 2000;
    trace.append(
      s('path', { class: 'trace-thresh', d: `M${x0} ${yOf(crit)} H${x0 + pw}` }),
      s('text', { x: x0 + pw - 2, y: yOf(crit) - 4, 'text-anchor': 'end', text: `${int(crit)} ms` }),
      s('path', { class: 'trace-opt', d: path(model.p99Opt) }),
      s('path', { class: 'trace-you', d: path(model.p99You) }),
      s('text', { x: x0 + 2, y: 12, text: 'p99: you solid, optimal dashed' }),
      s('line', { class: 'trace-cursor', x1: xOf(time), x2: xOf(time), y1: 0, y2: TRACE_H + TRACE_TOP }),
    );
    trace.dataset.x0 = String(x0);
    trace.dataset.pw = String(pw);
    // lanes overlay: divergence connector and cursor
    const ly = lanes.getBoundingClientRect();
    const a = laneYou.getBoundingClientRect();
    const b = laneOpt.getBoundingClientRect();
    link.setAttribute('width', Math.round(ly.width));
    link.setAttribute('height', Math.round(ly.height));
    link.setAttribute('viewBox', `0 0 ${Math.round(ly.width)} ${Math.round(ly.height)}`);
    link.dataset.x0 = String(Math.round(a.left - ly.left));
    link.dataset.pw = String(Math.round(a.width));
    const lx = (t) => Math.round(a.left - ly.left + (t / axis.axisEnd) * a.width);
    const cy = (r) => Math.round(r.top - ly.top + r.height / 2);
    const conn = link.querySelector('.lanes-connector');
    const div = model.divergence;
    if (div && div.you && div.optimal) {
      setAttr(conn, 'x1', lx(div.you.t)); setAttr(conn, 'y1', cy(a)); setAttr(conn, 'x2', lx(div.optimal.t)); setAttr(conn, 'y2', cy(b));
      conn.removeAttribute('hidden');
    } else conn.setAttribute('hidden', '');
    const cur = link.querySelector('.lanes-cursor');
    setAttr(cur, 'y1', 0); setAttr(cur, 'y2', Math.round(ly.height));
    moveCursors();
    buildMap();
  }

  function moveCursors() {
    const x0 = Number(trace.dataset.x0 || 0);
    const pw = Number(trace.dataset.pw || 1);
    const tc = trace.querySelector('.trace-cursor');
    if (tc) { const x = Math.round((x0 + (time / axis.axisEnd) * pw) * 10) / 10; setAttr(tc, 'x1', x); setAttr(tc, 'x2', x); }
    const lx0 = Number(link.dataset.x0 || 0);
    const lpw = Number(link.dataset.pw || 1);
    const lc = link.querySelector('.lanes-cursor');
    const x = Math.round(lx0 + (time / axis.axisEnd) * lpw);
    setAttr(lc, 'x1', x); setAttr(lc, 'x2', x);
  }

  // ---------------------------------------------------------------- time
  const actionsTaken = (t) => marksYou.filter((m) => m.t <= t).length;
  function setTime(t, fromUser = false) {
    time = Math.max(0, Math.min(end, Math.round(t)));
    if (Number(slider.value) !== time) slider.value = String(time);
    setAttr(slider, 'aria-valuetext', `${mmss(time)}, ${actionsTaken(time)} of ${marksYou.length} actions taken`);
    setText(timeChip, mmss(time));
    for (const m of markEls) setAttr(m.el, 'aria-current', m.lane === 'you' && m.t === time ? 'true' : null);
    moveCursors();
    paintMap();
    const n = narrate(model, time);
    narration.replaceChildren(n.text);
    if (n.harmful) narration.append(' ', h('span', { class: 'badge badge-harmful', text: 'Harmful' }));
    if (fromUser) stop();
  }

  function stop() {
    if (!timer) return;
    clearInterval(timer);
    timer = 0;
    playBtn.querySelector('.btn-label').textContent = 'Play replay';
    playBtn.querySelector('use').setAttribute('href', '#ic-play');
  }

  function toggle() {
    if (reduced) return;
    if (timer) { stop(); return; }
    if (time >= end) setTime(0);
    playBtn.querySelector('.btn-label').textContent = 'Pause replay';
    playBtn.querySelector('use').setAttribute('href', '#ic-pause');
    let carry = 0;
    timer = setInterval(() => {
      carry += PLAY_RATE / 10;
      const step = Math.floor(carry);
      if (step > 0) { carry -= step; setTime(time + step); }
      if (time >= end) stop();
    }, 100);
  }

  // jump to the previous or next action second on your lane
  function jump(dir) {
    const ts = [...new Set(marksYou.map((m) => m.t))].sort((a, b) => a - b);
    const target = dir > 0 ? ts.find((t) => t > time) : [...ts].reverse().find((t) => t < time);
    if (target !== undefined) setTime(target, true);
  }

  slider.addEventListener('input', () => setTime(Number(slider.value), true));
  slider.addEventListener('keydown', (e) => {
    if (e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      setTime(time + (e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -10 : 10), true);
    } else if (e.key === '[' || e.key === ']') {
      e.preventDefault();
      e.stopPropagation();
      jump(e.key === ']' ? 1 : -1);
    }
  });
  playBtn.addEventListener('click', toggle);

  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { relayout(); }) : null;
  if (ro) ro.observe(root);

  // initial position: your first harmful step, else your first step, else the first page
  const first = marksYou.find((m) => m.effect === 'harmful') || marksYou[0];
  const initial = first ? first.t : Math.min(end, model.fp);
  return {
    el: root,
    start() { relayout(); setTime(initial); },
    setTime,
    jump,
    toggle,
    get time() { return time; },
    destroy() { destroyed = true; stop(); if (ro) ro.disconnect(); },
  };
}
