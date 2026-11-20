// Builds public/design-specimen.html: every component and state, in dark and light, from the real tokens.css and app.css.
// Run: node tests/tools/build-specimen.js   (the output is committed; tests/css-specimen.test.js checks it is in sync with sprite.svg)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'public');
const sprite = fs.readFileSync(path.join(PUBLIC, 'sprite.svg'), 'utf8').trim();

// ---------------------------------------------------------------- small helpers
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const ICON = { ok: 'ic-ok', warn: 'ic-warn', crit: 'ic-crit', recovering: 'ic-recv', recv: 'ic-recv' };
const LABEL = { ok: 'OK', warn: 'WARN', crit: 'CRIT', recovering: 'RECV', recv: 'RECV' };
const use = (id, cls = 'icon-sm') => `<svg class="${cls}" aria-hidden="true"><use href="#${id}"/></svg>`;
const badge = (st, extra = '') => `<span class="badge ${extra}" data-status="${st}">${use(ICON[st])}${LABEL[st]}</span>`;
const GLYPH = { clients: 'ic-clients', lb: 'ic-lb', 'service-1': 'ic-service', 'service-2': 'ic-service', cache: 'ic-cache', queue: 'ic-queue', 'db-primary': 'ic-db', 'db-replica': 'ic-replica' };
const NAME = { clients: 'Clients', lb: 'Load balancer', 'service-1': 'Service 1', 'service-2': 'Service 2', cache: 'Cache', queue: 'Queue', 'db-primary': 'DB primary', 'db-replica': 'DB replica' };
const SHORT = { lb: 'LB', 'db-primary': 'DB primary' };
const xs = new Set(); // positions used by lane marks (specimen-only CSS, see <style> below)
const f1 = (n) => Math.round(n * 10) / 10;

// ---------------------------------------------------------------- map generator (a stand-in for core/layout.js: same node anatomy as design-direction section 7)
const NODES = [
  // id, a (stage), b (lane), status, metric text, saturation (0..1), extra flags
  ['clients', 0, 0, 'ok', '8.4k/s', 0.22], ['lb', 0, 1, 'ok', '8.4k/s', 0.31],
  ['service-1', 1, 0, 'warn', '74%', 0.74], ['service-2', 1, 1, 'warn', '71%', 0.71],
  ['cache', 2, 0, 'crit', '31%', 0.9, { selected: true, isNew: true, justCrit: true }], ['queue', 2, 1, 'recovering', '38%', 0.38, { justRecv: true }],
  ['db-primary', 3, 0, 'crit', '97%', 0.97, { focus: true }], ['db-replica', 3, 1, 'warn', '78%', 0.78],
];
const EDGES = [
  ['clients', 'lb', 'normal', '8.4k rps', 8], ['lb', 'service-1', 'loaded', '4.2k rps', 26], ['lb', 'service-2', 'normal', '4.2k rps', 14],
  ['service-1', 'cache', 'loaded', '3.8k rps', 30], ['service-2', 'cache', 'loaded', '3.4k rps', 28], ['service-2', 'queue', 'normal', '0.4k rps', 8],
  ['cache', 'db-primary', 'failing', 'err 6%', 12], ['db-primary', 'db-replica', 'normal', '0.9k rps', 6],
];

function roundedPath(pts, r = 8) {
  let d = `M${f1(pts[0][0])} ${f1(pts[0][1])}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i - 1]; const [cx, cy] = pts[i]; const [nx, ny] = pts[i + 1];
    const l1 = Math.hypot(cx - px, cy - py); const l2 = Math.hypot(nx - cx, ny - cy); const rr = Math.min(r, l1 / 2, l2 / 2);
    const ax = cx - ((cx - px) / l1) * rr; const ay = cy - ((cy - py) / l1) * rr;
    const bx = cx + ((nx - cx) / l2) * rr; const by = cy + ((ny - cy) / l2) * rr;
    d += ` L${f1(ax)} ${f1(ay)} Q${f1(cx)} ${f1(cy)} ${f1(bx)} ${f1(by)}`;
  }
  const last = pts[pts.length - 1];
  return `${d} L${f1(last[0])} ${f1(last[1])}`;
}
function along(pts, spacing, offset = 0) {
  const out = []; let carry = offset;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x1, y1] = pts[i]; const [x2, y2] = pts[i + 1]; const len = Math.hypot(x2 - x1, y2 - y1);
    for (let s = carry; s < len; s += spacing) out.push([x1 + ((x2 - x1) * s) / len, y1 + ((y2 - y1) * s) / len, (x2 - x1) / len, (y2 - y1) / len]);
    carry = (carry - len) % spacing; if (carry < 0) carry += spacing;
  }
  return out;
}
function lcg(seed) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }

function nodeSvg(n, x, y, w, h, opts) {
  const [id, , , st, metric, sat, flags = {}] = n;
  const bw = w - 20; const by = h - 10;
  const attrs = `data-node="${id}" data-status="${st}" data-selected="${flags.selected ? 'true' : 'false'}"${flags.focus ? ' data-focus="true"' : ''}${flags.isNew && !opts.replay ? ' data-new="true"' : ''}${flags.justCrit && !opts.replay ? ' data-just-crit="true"' : ''}${flags.justRecv && !opts.replay ? ' data-just-recv="true"' : ''}`;
  const label = `${NAME[id]}. ${LABEL[st]}. Saturation ${Math.round(sat * 100)} percent.`;
  const tick = (p) => `<path class="bar-tick" d="M${f1(10 + bw * p)} ${by - 2} V${by + 6}"/>`;
  return `<g transform="translate(${f1(x)} ${f1(y)})"><g class="node" role="button" tabindex="-1" aria-label="${label}" ${attrs}>
    <circle class="node-glow" cx="${w / 2}" cy="${h / 2}" r="${Math.round(w * 0.62)}"/>
    <g class="node-inner">
      <rect class="node-pulse" x="0" y="0" width="${w}" height="${h}" rx="4"/><rect class="node-recv-ring" x="0" y="0" width="${w}" height="${h}" rx="4"/>
      <rect class="node-body" x="0" y="0" width="${w}" height="${h}" rx="4"/><rect class="node-hatch" x="1" y="1" width="${w - 2}" height="${h - 2}" rx="3"/>
      <svg class="node-glyph" x="10" y="9" width="16" height="16" aria-hidden="true"><use href="#${GLYPH[id]}"/></svg>
      <text class="node-name" x="32" y="21">${w < 130 ? (SHORT[id] || NAME[id]) : NAME[id]}</text>
      <g class="node-badge" data-testid="map-node-badge"><use href="#${ICON[st]}" x="10" y="${by - 19}" width="12" height="12"/><text class="badge-text" x="26" y="${by - 9}">${LABEL[st]}</text></g>
      <text class="node-metric" x="${w - 10}" y="${by - 9}">${metric}</text>
      <rect class="bar-track" x="10" y="${by}" width="${bw}" height="4"/><rect class="bar-zone" x="${f1(10 + bw * 0.9)}" y="${by}" width="${f1(bw * 0.1)}" height="4"/>
      <rect class="bar-fill" x="10" y="${by}" width="${f1(bw * Math.min(sat, 1))}" height="4"/>${tick(0.7)}${tick(0.9)}
      <text class="node-tag" x="0" y="-9">NEW PAGE</text>
    </g>
    <rect class="node-ring" x="-6" y="-6" width="${w + 12}" height="${h + 12}" rx="8"/>
  </g></g>`;
}

export function mapSvg({ orient = 'wide', W = 872, H = 560, nodeW = 144, nodeH = 64, dots = true, labels = true, replay = false, statusOverride = null, ariaLabel = 'System map' } = {}) {
  const wide = orient === 'wide';
  const du = wide ? nodeW : nodeH; const dv = wide ? nodeH : nodeW;
  const gapU = wide ? (W - 32 - 4 * du) / 3 : 44; const marginU = wide ? 16 : 84;
  const vPos = wide ? [Math.round(H * 0.24), Math.round(H * 0.62)] : [8, 8 + dv + 8];
  const pos = {};
  for (const n of NODES) {
    const u = marginU + n[1] * (du + gapU); const v = vPos[n[2]];
    pos[n[0]] = { u, v, x: wide ? u : v, y: wide ? v : u, a: n[1], b: n[2] };
  }
  const P = (u, v) => (wide ? [u, v] : [v, u]);
  const nodes = statusOverride ? NODES.map((n) => [...n]).map((n) => { const s = statusOverride[n[0]]; if (s) { n[3] = s[0]; n[4] = s[1]; n[5] = s[2]; } return n; }) : NODES;
  const status = Object.fromEntries(nodes.map((n) => [n[0], n[3]]));
  let edgesSvg = ''; let labelsSvg = ''; let dotsSvg = ''; let piles = '';
  const rnd = lcg(7);
  for (const [from, to, state, text, rate] of EDGES) {
    const A = pos[from]; const B = pos[to]; let pts;
    if (A.a === B.a) { pts = [P(A.u + du / 2, A.v + dv), P(B.u + du / 2, B.v)]; }
    else if (A.b === B.b) { pts = [P(A.u + du, A.v + dv / 2), P(B.u, B.v + dv / 2)]; }
    else { const mu = (A.u + du + B.u) / 2; pts = [P(A.u + du, A.v + dv / 2), P(mu, A.v + dv / 2), P(mu, B.v + dv / 2), P(B.u, B.v + dv / 2)]; }
    const dim = status[from] === 'crit' && state !== 'loaded' ? ' data-dim="true"' : '';
    const load = state === 'loaded' ? ' data-load="high"' : '';
    edgesSvg += `<path class="edge" data-from="${from}" data-to="${to}" data-state="${state}"${load}${dim} data-dot-rate="${rate}" d="${roundedPath(pts)}"/>`;
    if (labels && !(pts.length === 2 && Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]) < 30)) {
      const seg = pts.length === 4 ? [pts[1], pts[2]] : [pts[0], pts[pts.length - 1]];
      const horiz = Math.abs(seg[0][1] - seg[1][1]) < 1; const straightV = pts.length === 2 && !horiz;
      const lx = (seg[0][0] + seg[1][0]) / 2; const ly = (seg[0][1] + seg[1][1]) / 2;
      labelsSvg += straightV ? `<text class="edge-label edge-label-start" data-state="${state}" x="${f1(lx + 10)}" y="${f1(ly + 4)}">${text}</text>` : `<text class="edge-label" data-state="${state}" x="${f1(lx)}" y="${f1(horiz && pts.length === 2 ? ly - 8 : ly + 4)}">${text}</text>`;
    }
    if (dots) {
      const spacing = Math.max(140 / rate, 6) * (state === 'failing' ? 1.3 : 1);
      const dimc = dim ? ' data-dim="true"' : '';
      for (const [px, py, dx, dy] of along(pts, spacing, rnd() * spacing)) {
        if (state === 'failing' && rnd() < 0.55) dotsSvg += `<circle class="dot-error" cx="${f1(px)}" cy="${f1(py)}" r="3.5"/>`;
        else if (state === 'loaded' && rnd() < 0.18) dotsSvg += `<g><path class="dot-tail" d="M${f1(px - dx * 10)} ${f1(py - dy * 10)} L${f1(px)} ${f1(py)}"/><circle class="dot" cx="${f1(px)}" cy="${f1(py)}" r="2.5"/></g>`;
        else dotsSvg += `<circle class="dot"${dimc} cx="${f1(px)}" cy="${f1(py)}" r="2.5"/>`;
      }
    }
  }
  if (dots) { // pile-up at the cache entrance (the memorable detail: dots stack where the queue forms)
    const c = pos.cache;
    for (let i = 0; i < 16; i++) { const [px, py] = wide ? [c.x - 12 - (i % 3) * 4.2 - rnd() * 1.5, c.y + 32 - 10 + Math.floor(i / 3) * 3.4 + (i % 2) * 1.2] : [c.x + 10 + (i % 5) * 5, c.y - 12 - Math.floor(i / 5) * 3.2]; piles += `<circle class="pile-dot" cx="${f1(px)}" cy="${f1(py)}" r="2.5"/>`; }
  }
  const nodesSvg = nodes.map((n) => nodeSvg(n, pos[n[0]].x, pos[n[0]].y, nodeW, nodeH, { replay })).join('');
  return `<svg class="map-svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="group" aria-label="${ariaLabel}" data-layout="${orient}">${edgesSvg}${dotsSvg}${piles}${labelsSvg}${nodesSvg}</svg>`;
}

// ---------------------------------------------------------------- sparklines
function series(kind) {
  const out = []; for (let i = 0; i < 60; i++) {
    const t = i / 59; const ramp = Math.max(0, (t - 0.18) / 0.3); const settle = t > 0.72 ? (t - 0.72) / 0.28 : 0;
    const wob = Math.sin(i * 1.7) * 0.015 + Math.cos(i * 0.6) * 0.01;
    out.push({
      p99: 0.08 + Math.min(ramp, 1) * 0.65 * (1 - settle * 0.1) + wob,
      errors: 0.005 + Math.min(ramp, 1) * 0.1 + wob * 0.3,
      sat: 0.3 + Math.min(ramp, 1) * 0.65 + wob,
      queue: 0.05 + Math.min(ramp * 1.2, 1) * 0.5 * (1 - settle * 0.85) + wob,
      hit: 0.95 - Math.min(ramp, 1) * 0.62 + wob,
    }[kind]);
  } return out;
}
function spark({ metric, name, status, value, unit, kind, thresh, threshLabel }) {
  const pts = series(kind).map((v, i) => [(i / 59) * 160 + 2, 52 - Math.max(0, Math.min(1, v)) * 46]);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${f1(p[0])} ${f1(p[1])}`).join(' ');
  const last = pts[pts.length - 1]; const ty = f1(52 - thresh * 46);
  return `<div class="spark" data-testid="spark" data-metric="${metric}" data-status="${status}"><div class="spark-head"><span class="spark-name">${name}</span><span class="badge" data-status="${status}" data-testid="spark-status">${use(ICON[status])}${LABEL[status]}</span></div>
    <div class="spark-value">${value}<span class="muted">${unit}</span></div>
    <svg viewBox="0 0 164 56" role="img" aria-label="${name}, last 60 seconds, now ${value}${unit}"><path class="spark-area" d="${line} L162 52 L2 52 Z"/><path class="spark-thresh" d="M2 ${ty} H162"/><text class="spark-thresh-label" x="162" y="${f1(+ty - 3)}" text-anchor="end">${threshLabel}</text><path class="spark-line" d="${line}"/><use class="spark-end" href="#${ICON[status]}" x="${f1(last[0] - 4)}" y="${f1(last[1] - 4)}" width="8" height="8"/></svg></div>`;
}
const SPARKS = [
  { metric: 'p99', name: 'Checkout p99', status: 'crit', value: '2,140', unit: ' ms', kind: 'p99', thresh: 2000 / 3000, threshLabel: '2000 ms' },
  { metric: 'errors', name: 'Error rate', status: 'crit', value: '6.2', unit: '%', kind: 'errors', thresh: 0.05 * 1, threshLabel: '5%' },
  { metric: 'saturation', name: 'DB saturation', status: 'crit', value: '97', unit: '%', kind: 'sat', thresh: 0.9, threshLabel: '90%' },
  { metric: 'queue', name: 'Queue depth', status: 'recovering', value: '1,240', unit: '', kind: 'queue', thresh: 0.5, threshLabel: '80% max' },
  { metric: 'cache-hit', name: 'Cache hit', status: 'crit', value: '31', unit: '%', kind: 'hit', thresh: 0.5, threshLabel: '50%' },
];
const sparkStrip = () => `<section class="metrics-strip" data-testid="metrics-strip" aria-label="Key signals">${SPARKS.map(spark).join('')}</section>`;

// ---------------------------------------------------------------- panels
const lamps = (on, total, preview = 0) => `<span class="lamps" data-testid="pager-lamps" role="group" aria-label="Pager budget: ${on} of ${total} left">${Array.from({ length: total }, (_, i) => `<span class="lamp" data-testid="pager-lamp" data-state="${i < on ? 'on' : 'spent'}"${i < on && i >= on - preview ? ' data-preview="true"' : ''}></span>`).join('')}</span>`;
const alertRow = (sev, text, since, state = 'firing', cleared = '') => `<li><button class="alert-row" type="button" data-testid="alert-item" data-state="${state}" data-severity="${sev}"><span class="alert-sev sev" data-sev="${sev}">${use(sev === 3 ? 'ic-warn' : state === 'resolved' ? 'ic-recv' : 'ic-crit')}${state === 'resolved' ? 'CLEARED' : `SEV${sev}`}</span><span class="alert-text">${text}</span><span class="alert-meta">${state === 'resolved' ? `SEV${sev} · ${cleared}` : `since ${since}`}</span></button></li>`;
const pagesPanel = (active = false, empty = false) => `<section class="panel pages" data-testid="alerts-panel"${active ? ' data-tab-active="true"' : ''} aria-labelledby="h-pages-{T}"><div class="panel-head"><h2 id="h-pages-{T}">Pages</h2><span class="panel-count" data-status="crit">${empty ? 0 : 3}</span></div>
  ${empty ? `<p class="empty-line" data-kicker="Pages" data-testid="alerts-empty">No pages. Enjoy it while it lasts.</p>` : `<ul class="alert-list">${alertRow(2, 'checkout p99 &gt; 2 s', 'T+00:06')}${alertRow(2, 'DB saturation &gt; 90%', 'T+00:09')}${alertRow(3, 'cache hit rate under 80%', 'T+00:05', 'firing')}${alertRow(2, 'error rate above 5%', 'T+00:08', 'resolved', 'T+00:31')}</ul>`}</section>`;
const metric = (k, v, st) => `<div><dt>${k}</dt><dd${st ? ` data-status="${st}"` : ''} data-testid="metric-value">${v}</dd></div>`;
const logLine = (t, lvl, txt, kind = 'log') => `<li class="log-line" data-testid="log-line" data-level="${lvl}" data-kind="${kind}"><span class="t">${t}</span><span class="lvl">${lvl === 'error' ? 'ERR' : lvl.toUpperCase()}</span><span>${txt}</span></li>`;
const inspectPanel = (active = false) => `<section class="panel" data-testid="inspect-panel" data-node="cache"${active ? ' data-tab-active="true"' : ''} aria-labelledby="h-inspect-{T}"><div class="panel-head"><h2 id="h-inspect-{T}" data-testid="inspect-title" tabindex="-1">Cache</h2>${badge('crit', 'badge-tint')}</div>
  <dl class="metrics" data-testid="inspect-metrics">${metric('p50', '41 ms')}${metric('p99', '2,140 ms', 'crit')}${metric('Errors', '6.2%', 'crit')}${metric('Saturation', '90%', 'crit')}${metric('Queue', '1,240', 'warn')}${metric('Hit rate', '31%', 'crit')}</dl>
  <ul class="log" data-testid="log-list" tabindex="0" aria-label="Logs for Cache">${logLine('00:05', 'info', 'GET product:42 hit 0.8 ms')}${logLine('00:07', 'warn', '1,842 misses for key product:42 in 1 s')}${logLine('00:08', 'error', 'origin fetch timeout after 1,000 ms (db-primary)')}${logLine('00:09', 'warn', 'evicted 311 keys; ttl expiry wave detected')}${logLine('00:11', 'info', 'Applied: Add TTL jitter', 'action')}${logLine('00:12', 'warn', '&lt;script&gt;alert(1)&lt;/script&gt; shown literally, as text')}</ul></section>`;
const actionRow = (name, effect, cost, state, reason = '') => `<li><button class="action-row" type="button" data-testid="action-item" data-state="${state}"${state === 'disabled' ? ' aria-disabled="true"' : ''}><span class="action-name">${name}</span><span class="action-cost" data-testid="action-cost">${cost}</span><span class="action-effect">${effect}</span>${reason ? `<span class="reason" data-testid="action-reason">${reason}</span>` : ''}</button></li>`;
const actionPanel = (active = false) => `<section class="panel actions" data-testid="action-panel"${active ? ' data-tab-active="true"' : ''} aria-labelledby="h-act-{T}"><div class="panel-head"><h2 id="h-act-{T}">Actions</h2><span class="panel-aside">Target: Cache</span></div>
  <div class="action-group"><span class="stencil">Diagnose</span><ul class="action-group">${actionRow('Inspect', 'Read-only look at one node.', 'Free', 'enabled')}${actionRow('Tail logs', 'Last 20 log lines, any level.', 'Cost 1', 'enabled')}</ul></div>
  <div class="action-group"><span class="stencil">Fix</span><ul class="action-group">${actionRow('Add TTL jitter', 'Spreads expiry so keys stop dying together.', 'Cost 1', 'enabled')}${actionRow('Scale service', 'Adds service capacity.', 'Cost 2', 'enabled')}${actionRow('Circuit breaker', 'Stops calls to a failing dependency.', 'Cost 2', 'applied', 'Already on.')}${actionRow('Fail over DB', 'Promote the replica to primary.', 'Cost 3', 'disabled', 'Not enough pager. It costs 3 and you have 2.')}</ul></div>
  <p class="action-feedback" role="status" data-testid="action-feedback">Applied: Add TTL jitter. Pager 5 / 6. Takes effect next tick.</p></section>`;
const historyPanel = () => `<section class="panel" aria-labelledby="h-hist-{T}"><div class="panel-head"><h2 id="h-hist-{T}">Your actions</h2><span class="panel-count">3</span></div><ol class="history" data-testid="history-list">
  <li data-testid="history-item" data-effect="diagnostic"><span class="t">00:07</span><span>Tail logs</span><span class="effect-mark">D</span></li>
  <li data-testid="history-item" data-effect="harmful"><span class="t">00:14</span><span>Scale service ${'<span class="badge badge-harmful" data-status="crit">' + use('ic-crit') + 'Harmful</span>'}</span><span class="effect-mark">x</span></li>
  <li data-testid="history-item" data-effect="helpful"><span class="t">00:21</span><span>Add TTL jitter</span><span class="effect-mark">F</span></li></ol></section>`;
const toast = (kind, kicker, text, icon) => `<div class="toast toast-static" data-testid="alert-toast" data-kind="${kind}"><div class="toast-body"><span class="toast-kicker">${use(icon)}${kicker}</span><span class="toast-text">${text}</span></div></div>`;

// ---------------------------------------------------------------- play view
const mission = () => `<div class="mission">
  <span class="clock" data-testid="mission-clock" data-seconds="161"><span class="clock-unit">T+</span>02:41</span>
  <span class="pager">${lamps(4, 6)}<span class="pager-text" data-testid="pager-text">Pager 4 / 6</span></span>
  <button class="btn btn-icon" type="button" data-testid="pause-button" aria-pressed="false">${use('ic-pause', 'icon')}<span class="btn-label">Pause</span></button></div>`;
const toolbar = () => `<div class="toolbar"><span class="chip" data-testid="seed-chip">Seed 48213</span><button class="btn" type="button" data-testid="hint-button">Hint</button><span class="chip chip-muted">Paused</span><span class="toolbar-end"><button class="switch" type="button" role="switch" aria-checked="false" data-testid="mode-toggle">Text mode</button><button class="switch" type="button" role="switch" aria-checked="true" data-testid="shortcuts-toggle">Shortcuts</button><button class="btn" type="button" data-testid="help-button">Keys</button></span></div>`;
const nav = (cur) => `<nav class="nav" aria-label="Main"><a href="#/incidents"${cur === 'inc' ? ' aria-current="page"' : ''}>Incidents</a><a href="#/data"${cur === 'data' ? ' aria-current="page"' : ''}>Your data</a><a href="#/about"${cur === 'about' ? ' aria-current="page"' : ''}>About</a></nav>`;
const header = (cur, withMission) => `<header class="app-header"><a class="wordmark" href="#/incidents">incident<span class="dash">-</span>sim</a>${nav(cur)}${withMission ? mission() : '<span class="header-spacer"></span>'}</header>`;
const legend = () => `<div class="map-legend" aria-hidden="true">${['ok', 'warn', 'crit', 'recovering'].map((s) => badge(s)).join('')}<span class="key-item">${'<svg class="icon-sm" aria-hidden="true" viewBox="0 0 12 12"><circle cx="6" cy="6" r="2.5" class="dot"/></svg>'}<span class="muted">request</span></span><span class="key-item"><svg class="icon-sm" aria-hidden="true" viewBox="0 0 12 12"><circle cx="6" cy="6" r="3.5" class="dot-error"/></svg><span class="muted">error back</span></span></div>`;
const playView = () => `<div class="spec-play"><div class="play-grid" data-testid="play-view" data-status="paused"><div class="play-main">
  <div class="map ticks" data-testid="system-map" data-layout="wide"><div class="map-caption"><span class="stencil">System map</span><span class="stencil">cache-stampede</span></div>
    <div class="toast-region" data-testid="toast-region" aria-hidden="true">${toast('page', 'PAGE', 'SEV2: checkout p99 &gt; 2 s', 'ic-crit')}</div>
    <div class="map-wide">${mapSvg({ orient: 'wide' })}</div><div class="map-tall">${mapSvg({ orient: 'tall', W: 358, H: 500, nodeW: 167, nodeH: 56 })}</div>${legend()}</div>
  ${toolbar()}${sparkStrip()}</div>
  <div class="tabs" role="tablist" data-testid="panel-tabs" aria-label="Panels"><button class="tab" role="tab" aria-selected="true">Pages<span class="panel-count" data-status="crit">3</span></button><button class="tab" role="tab" aria-selected="false">Inspect</button><button class="tab" role="tab" aria-selected="false">Actions</button><button class="tab" role="tab" aria-selected="false">Metrics</button></div>
  <div class="rail">${pagesPanel(true)}${inspectPanel()}${actionPanel()}</div></div></div>`;

// ---------------------------------------------------------------- other screens
const stateBanner = (kind, icon, kicker, text, btn = '', extra = '') => `<div class="banner" data-kind="${kind}" role="${kind === 'error' ? 'alert' : 'status'}">${use(icon, 'icon-sm')}<div class="banner-body"><span class="banner-kicker">${kicker}</span><p>${text}</p>${extra}</div>${btn}</div>`;
const boardRow = (title, concept, diff, st, best, btn) => `<li class="incident-row" data-testid="incident-row" data-state="${st}"><div class="incident-title-block"><span class="incident-title">${title}</span><span class="incident-concept">${concept}</span></div>
  <span class="diff" role="img" aria-label="Difficulty ${diff} of 3">${[1, 2, 3].map((i) => `<i data-on="${i <= diff}"></i>`).join('')}</span>
  <span class="state-chip"${st === 'resolved' ? ' data-status="recovering"' : st === 'out-of-budget' ? ' data-status="crit"' : ''}>${use(st === 'resolved' ? 'ic-recv' : st === 'out-of-budget' ? 'ic-crit' : 'ic-note')}${st === 'new' ? 'New' : st === 'resolved' ? 'Resolved' : 'Out of budget'}</span>
  <span class="best">${best}</span>${btn}</li>`;
const boardView = () => `<div class="page" data-testid="picker-view"><h1>Incident board</h1>
  <div class="board-grid"><section class="daily-card" data-testid="daily-card"><span class="stencil">Today · 2026-11-19 · #323</span><h2>Cache stampede</h2><div class="daily-meta"><span class="diff" role="img" aria-label="Difficulty 1 of 3"><i data-on="true"></i><i data-on="false"></i><i data-on="false"></i></span><span class="mono">Seed 48213</span></div><p class="muted">Same incident and seed for everyone on this date.</p><div class="btn-row"><button class="btn btn-primary" type="button" data-testid="daily-start">Start today's incident</button></div></section>
  <div class="field"><label for="seed-{T}">Seed (optional)</label><input class="input" id="seed-{T}" data-testid="seed-input" inputmode="numeric" value="4294967296" aria-invalid="true" aria-describedby="seed-err-{T} seed-hint-{T}"><p class="field-error" id="seed-err-{T}" data-testid="seed-error">${use('ic-crit')}Seed must be a whole number from 0 to 4294967295.</p><p class="hint" id="seed-hint-{T}">Leave blank for the standard seed. Share a number to replay the same incident with a team.</p></div></div>
  <ul class="incident-list" data-testid="incident-list" aria-label="All incidents">${boardRow('Cache stampede', 'Hot keys expire together and the database takes the hit.', 1, 'resolved', 'Best 00:41', '<a class="btn" href="#/play/cache-stampede" data-testid="incident-start">Start</a>')}${boardRow('Retry storm', 'Clients retry in lockstep and bury a third-party service.', 2, 'new', 'Not tried', '<a class="btn" href="#/play/retry-storm">Start</a>')}${boardRow('Connection pool exhaustion', 'The obvious fix moves the bottleneck somewhere worse.', 2, 'out-of-budget', 'Best not mitigated', '<a class="btn" href="#/play/pool">Start</a>')}${boardRow('Cascading failure that needs a very long title to test the ellipsis behaviour in a narrow row', 'No single fix works. Order matters.', 3, 'new', 'Not tried', '<a class="btn" href="#/play/cascade">Start</a>')}</ul>
  <details class="scenario-errors" data-testid="scenario-errors" open><summary>2 scenario files could not be loaded</summary><ul><li data-testid="scenario-error-item">scenarios/bad-guide.json: field "guideUrl": must start with https://bytebytego.com/guides/. Fix the file and restart the server.</li><li data-testid="scenario-error-item">scenarios/no-root-cause.json: field "rootCause": missing. Expected: a non-empty string.</li></ul></details></div>`;

function debriefView() {
  const T = 180; const x = (s) => Math.round((s / T) * 100); const mk = (lane, s, kind, txt) => { xs.add(x(s)); return `<button class="mark x-${x(s)}" type="button" data-testid="replay-mark" data-lane="${lane}" data-time="${s}" data-kind="${kind}"${kind === 'F' && lane === 'you' ? ' aria-current="true"' : ''} aria-label="${txt}">${use(kind === 'D' ? 'ic-mark-d' : kind === 'F' ? 'ic-mark-f' : kind === 'x' ? 'ic-mark-x' : 'ic-mark-dot', '')}<span>${kind}</span></button>`; };
  const line = (s, label) => { xs.add(x(s)); return `<span class="lane-line x-${x(s)}"></span><span class="lane-line-label${s > T * 0.6 ? ' lane-line-label-end' : ''} x-${x(s)}">${label}</span>`; };
  const ribbon = Array.from({ length: 60 }, (_, i) => { const t = i / 59; const s = t < 0.04 ? 'ok' : t < 0.07 ? 'warn' : t < 0.55 ? 'crit' : t < 0.7 ? 'warn' : t < 0.9 ? 'recovering' : 'ok'; return `<i data-status="${s}"></i>`; }).join('');
  const tr = (arr) => arr.map((v, i) => `${i ? 'L' : 'M'}${f1((i / (arr.length - 1)) * 592 + 4)} ${f1(68 - v * 60)}`).join(' ');
  const you = series('p99').map((v, i) => (i > 40 ? v * 0.9 : v)); const opt = series('p99').map((v, i) => (i < 20 ? v : Math.max(0.08, v * Math.max(0.1, 1 - (i - 20) / 14))));
  return `<div class="page" data-testid="debrief-view"><section class="result-card ticks" data-testid="result-card" data-status="recovering"><span class="result-kicker">Incident #323 · Cache stampede</span>
    <div class="result-head"><h1 class="result-title" data-testid="result-title" tabindex="-1">${use('ic-recv', 'icon-sm')}<span>Resolved</span></h1><div><span class="score"><span class="score-value" data-testid="score-value">87</span><span class="score-max">/ 100</span></span> <span class="tier" data-testid="result-tier">Solid</span></div></div>
    <div class="stats"><div class="stat" data-testid="score-time"><span class="stat-label">Time to mitigate</span><span class="stat-value">02:41</span><span class="stat-detail">Optimal 01:50</span></div>
      <div class="stat" data-testid="score-pager"><span class="stat-label">Pager left</span><span class="stat-value">4 / 6 ${lamps(4, 6)}</span><span class="stat-detail">2 spent</span></div>
      <div class="stat" data-testid="score-collateral"><span class="stat-label">Collateral</span><span class="stat-value">1 harmful step</span><span class="stat-detail">Peak errors 14%</span></div></div>
    <span class="fingerprint" data-testid="run-fingerprint">Run fingerprint <b>9c41ab07</b></span></section>
  <div class="debrief-grid"><section class="panel recorder" data-testid="replay" aria-labelledby="h-rep-{T}"><div class="panel-head"><h2 id="h-rep-{T}">Flight recorder</h2><span class="panel-aside">Same seed, same run, every time</span></div>
    <div class="ribbon" role="img" aria-label="Status by second: warn at 00:04, crit 00:07 to 01:39, recovering to 02:41">${ribbon}</div>
    <svg class="trace" viewBox="0 0 600 76" role="img" aria-label="p99 latency, your run against optimal"><path class="trace-thresh" d="M0 ${f1(68 - (2000 / 3000) * 60)} H600"/><text x="596" y="${f1(66 - (2000 / 3000) * 60 - 6)}" text-anchor="end">2000 ms</text><path class="trace-opt" d="${tr(opt)}"/><path class="trace-you" d="${tr(you)}"/></svg>
    <div class="lanes"><div class="lane" data-lane="you" data-testid="replay-lane-you"><span class="lane-label">You</span>${line(4, 'Onset')}${line(161, 'Mitigated 02:41')}${mk('you', 14, 'D', 'Tail logs at 00:14')}${mk('you', 42, 'x', 'Scale service at 00:42, harmful')}${mk('you', 71, 'F', 'Add TTL jitter at 01:11')}</div>
      <div class="lane" data-lane="optimal" data-testid="replay-lane-optimal"><span class="lane-label">Optimal</span>${mk('optimal', 12, 'D', 'Tail logs at 00:12')}${mk('optimal', 35, 'F', 'Add TTL jitter at 00:35')}</div></div>
    <div class="axis" aria-hidden="true"><span>00:00</span><span>00:30</span><span>01:00</span><span>01:30</span><span>02:00</span><span>02:30</span><span>03:00</span></div>
    <div class="scrubber-row"><button class="btn btn-icon" type="button" data-testid="replay-play">${use('ic-play', 'icon')}Play replay</button><label class="sr-only" for="scrub-{T}">Replay position</label><input class="scrubber" id="scrub-{T}" type="range" min="0" max="180" value="71" step="1" data-testid="replay-slider" aria-valuetext="01:11, 3 of 3 actions taken"><span class="chip">01:11</span></div>
    <div class="replay-map" data-testid="replay-map">${mapSvg({ orient: 'wide', W: 540, H: 230, nodeW: 118, nodeH: 60, dots: false, labels: false, replay: true, ariaLabel: 'System at 01:11' })}</div>
    <p class="narration" role="status" data-testid="replay-narration">T+01:11. You added TTL jitter. Cache hit rate 31% to 52%.</p></section>
  <div class="story"><section><span class="stencil">Root cause</span><p data-testid="root-cause">A popular key expired together with thousands of its siblings. Every request missed at once and the database took the full read load.</p></section>
    <section><span class="stencil">The concept</span><p data-testid="concept">Cache stampede: when many entries share one expiry, the cache stops absorbing traffic exactly when load is highest. Spread the expiry and the misses spread too.</p></section>
    <section><span class="stencil">Why that step hurt ${'<span class="badge badge-harmful" data-status="crit" data-testid="harmful-badge">' + use('ic-crit') + 'Harmful</span>'}</span><p data-testid="step-why">Scaling the service added more callers for the same cold cache. The extra misses went straight to the database.</p></section>
    <a class="btn btn-link" href="#guide" data-testid="guide-link">Read the guide: How can cache systems go wrong ${use('ic-external', 'icon')}<span class="ext">(opens in new tab)</span></a>
    <div class="btn-row"><button class="btn btn-primary" type="button" data-testid="copy-result">Copy result</button><button class="btn" type="button" data-testid="retry-seed">Retry this seed</button><a class="btn" href="#/incidents" data-testid="back-to-board">Back to incidents</a></div>
    <span class="chip chip-muted" role="status" data-testid="copy-status">Copied</span>
    <pre data-testid="share-text">incident-sim #323 cache-stampede  [D x F]  4/6 pager  02:41
score 87  optimal 01:50  harmful 1  fp 9c41ab07</pre></div></div>
  <section class="panel" aria-labelledby="h-steps-{T}"><div class="panel-head"><h2 id="h-steps-{T}">Steps, as a table</h2></div><div class="table-wrap"><table class="steps" data-testid="steps-table"><caption class="sr-only">You against optimal</caption><thead><tr><th>Step</th><th>You</th><th>Optimal</th><th>Effect</th></tr></thead><tbody>
    <tr data-testid="step-row" data-lane="you" data-effect="diagnostic"><td data-label="Step">1</td><td data-label="You">Tail logs 00:14</td><td data-label="Optimal">Tail logs 00:12</td><td data-label="Effect">Diagnostic</td></tr>
    <tr data-testid="step-row" data-lane="you" data-effect="harmful"><td data-label="Step">2</td><td data-label="You">Scale service 00:42</td><td data-label="Optimal">Add TTL jitter 00:35</td><td data-label="Effect">${'<span class="badge badge-harmful" data-status="crit">' + use('ic-crit') + 'Harmful</span>'} DB saturation 61% to 88%</td></tr>
    <tr data-testid="step-row" data-lane="you" data-effect="helpful"><td data-label="Step">3</td><td data-label="You">Add TTL jitter 01:11</td><td data-label="Optimal">-</td><td data-label="Effect">Helpful. Hit rate 31% to 52%</td></tr></tbody></table></div></section></div>`;
}

const textView = () => `<section class="panel" data-testid="text-view"><div class="panel-head"><h2>System status</h2><span class="panel-aside">Text mode: the clock runs only when you act or step.</span></div><div class="table-wrap"><table class="text-table"><thead><tr><th>Node</th><th>Status</th><th>p50</th><th>p99</th><th>Errors</th><th>Saturation</th><th>Queue</th><th>Hit rate</th></tr></thead><tbody>
  ${NODES.slice(2).map((n) => `<tr data-testid="text-row" data-node="${n[0]}" data-status="${n[3]}"><td><button class="btn btn-quiet" type="button">${NAME[n[0]]}</button></td><td>${badge(n[3])}</td><td>41 ms</td><td>${n[3] === 'crit' ? '2,140 ms' : '210 ms'}</td><td>${n[3] === 'crit' ? '6.2%' : '0.4%'}</td><td>${Math.round(n[5] * 100)}%</td><td>${n[0] === 'queue' ? '1,240' : '-'}</td><td>${n[0] === 'cache' ? '31%' : '-'}</td></tr>`).join('')}</tbody></table></div></section>`;

const dataView = () => `<div class="page" data-testid="data-view"><h1>Your data</h1><p class="page-lead">Progress lives in this browser only. Export it before clearing site data.</p>
  <section class="panel"><div class="panel-head"><h2>Saved runs</h2></div><p data-testid="data-summary">3 incidents resolved.</p><div data-testid="data-run-row" class="data-row"><span>Cache stampede</span><span class="mono">00:41</span><span class="mono">91</span></div><div class="data-row"><span>Retry storm</span><span class="mono">02:05</span><span class="mono">74</span></div><div class="data-row"><span>Hot partition</span><span class="mono">01:58</span><span class="mono">68</span></div>
  <div class="btn-row"><button class="btn btn-primary" type="button" data-testid="export-button">Export progress</button><button class="btn" type="button" data-testid="clear-button">Clear progress</button></div></section>
  <div class="field"><label for="imp-{T}">Import progress file</label><input class="input" id="imp-{T}" type="file" data-testid="import-input"><p class="hint">JSON file up to 256 KB, exported from this page.</p></div>
  ${stateBanner('error', 'ic-crit', 'Error', 'Import rejected: the file contains the key "__proto__", which is not allowed. Your saved progress was not changed.')}</div>`;
const aboutView = () => `<div class="page" data-testid="about-view"><h1>About</h1><div class="prose"><p data-testid="attribution-text">Incident Simulator teaches reliability patterns using the guides in ByteByteGo's system-design-101. We link to the guides and wrote every scenario, debrief and label ourselves; we copied no guide text or images. system-design-101 is licensed CC BY-NC-ND 4.0, so this project is for non-commercial use.</p>
  <div class="btn-row"><a class="btn btn-link" href="#attr" data-testid="attribution-link">ByteByteGo system-design-101 on GitHub ${use('ic-external', 'icon')}<span class="ext">(opens in new tab)</span></a><a class="btn btn-link" href="#lic" data-testid="license-link">CC BY-NC-ND 4.0 ${use('ic-external', 'icon')}<span class="ext">(opens in new tab)</span></a></div>
  <p data-testid="about-privacy">No accounts, no tracking, no network calls while you play. Progress stays in this browser.</p></div>
  <section data-testid="schema-docs" class="panel"><div class="panel-head"><h2>Scenario file format</h2></div><div class="table-wrap"><table class="schema"><thead><tr><th>Field</th><th>Rule</th><th>Shown as</th></tr></thead><tbody><tr><td>id</td><td>string, ^[a-z0-9-]{1,40}$, equals file name</td><td>Route</td></tr><tr><td>difficulty</td><td>integer 1 to 3</td><td>Difficulty 2 of 3</td></tr><tr><td>guideUrl</td><td>starts with https://bytebytego.com/guides/</td><td>Guide link</td></tr></tbody></table></div></section></div>`;

// ---------------------------------------------------------------- gallery sections
const palette = () => {
  const sw = (name, cls) => `<li class="sw"><span class="sw-chip ${cls}"></span><span class="mono">${name}</span></li>`;
  return `<ul class="swatches">${[['bg-0', 'bg0'], ['bg-1', 'bg1'], ['bg-2', 'bg2'], ['line-soft', 'ls'], ['line-ui', 'lu'], ['edge', 'ed'], ['text', 'tx'], ['text-muted', 'tm'], ['primary-bg', 'pb'], ['ok', 'ok'], ['warn', 'warn'], ['crit', 'crit'], ['recv', 'recv'], ['ok-tint', 'okt'], ['warn-tint', 'wt'], ['crit-tint', 'ct'], ['recv-tint', 'rt'], ['dot', 'dot']].map(([n, c]) => sw(`--c-${n}`, `sw-${c}`)).join('')}</ul>`;
};
const typeRamp = () => `<div class="panel"><div class="spec-type">
  <p class="stencil">Stencil label, mono 13 / 700 / 0.12em</p><h1>Incident board</h1><h2>Pages and actions</h2><h3>Inspector heading</h3>
  <p>Body is 16 px at 1.5, 400 weight. Prose in the debrief is capped at 72ch so lines stay readable: a popular key expired together with thousands of its siblings and the database took the full read load.</p>
  <p class="mono">00:07  WARN  1,842 misses for key product:42 in 1 s &nbsp; 0123456789 slashed zero tabular</p>
  <p><span class="clock">${'<span class="clock-unit">T+</span>02:41'}</span> &nbsp; <span class="score"><span class="score-value">87</span><span class="score-max">/ 100</span></span></p></div></div>`;
const buttons = () => `<div class="panel"><div class="btn-row"><button class="btn btn-primary" type="button">Primary lit</button><button class="btn" type="button">Secondary</button><button class="btn btn-quiet" type="button">Quiet</button><button class="btn" type="button" aria-pressed="true">Pressed</button><button class="btn" type="button" aria-disabled="true">Disabled</button><button class="btn spec-focus" type="button">Focus ring</button></div>
  <p class="reason">Disabled: Not enough pager. It costs 3 and you have 2.</p>
  <div class="btn-row spec-gap"><button class="switch" type="button" role="switch" aria-checked="false">Text mode off</button><button class="switch" type="button" role="switch" aria-checked="true">Shortcuts on</button><span class="chip">Seed 48213</span><span class="chip chip-muted">Paused</span></div>
  <div class="spec-gap"><span class="stencil">Pager lamps: full, partly spent, previewing a cost of 2</span><div class="spec-lamps">${lamps(6, 6)}${lamps(4, 6)}${lamps(4, 6, 2)}${lamps(0, 6)}</div></div></div>`;
const statusGallery = () => `<div class="panel"><div class="spec-status">${['ok', 'warn', 'crit', 'recovering'].map((s) => `<div class="spec-status-col">${badge(s)}${badge(s, 'badge-solid')}${badge(s, 'badge-tint')}<span class="state-chip" data-status="${s}">${use(ICON[s])}${LABEL[s]}</span></div>`).join('')}</div>
  <div class="spec-gap"><span class="sev" data-sev="1">${use('ic-crit')}SEV1</span> &nbsp; <span class="sev" data-sev="2">${use('ic-crit')}SEV2</span> &nbsp; <span class="sev" data-sev="3">${use('ic-warn')}SEV3</span></div></div>`;
const nodeGallery = () => {
  const mini = (id, st, metric, sat, flags, W = 172) => `<svg viewBox="-8 -8 ${W + 16} 80" width="${W + 16}" height="80" role="img" aria-label="${NAME[id]} ${LABEL[st]}">${nodeSvg([id, 0, 0, st, metric, sat, flags], 0, 0, 144, 64, {})}</svg>`;
  return `<div class="panel spec-nodes">${mini('service-1', 'ok', '41%', 0.41, {})}${mini('service-2', 'warn', '74%', 0.74, {})}${mini('cache', 'crit', '31%', 0.93, { justCrit: true })}${mini('queue', 'recovering', '38%', 0.38, {})}${mini('db-primary', 'warn', '78%', 0.78, { selected: true })}${mini('db-replica', 'ok', '12%', 0.12, { focus: true })}</div>
  <div class="panel"><span class="stencil">Edge states: normal, loaded (4 px), failing (dashed), cut by open breaker</span>
  <svg class="spec-edges spec-gap" viewBox="0 0 330 200" width="330" height="200" role="img" aria-label="Edge states">
    <text class="node-name" x="0" y="14">normal, 2 px</text><path class="edge" d="M0 30 H330"/><text class="edge-label" x="165" y="26">1.8k rps</text>
    <text class="node-name" x="0" y="64">loaded, 4 px</text><path class="edge" data-state="loaded" d="M0 80 H330"/><text class="edge-label" x="165" y="76">6.4k rps</text>
    <text class="node-name" x="0" y="114">failing, dashed</text><path class="edge" data-state="failing" d="M0 130 H330"/><text class="edge-label" data-state="failing" x="165" y="126">err 6%</text>
    <text class="node-name" x="0" y="164">cut, breaker</text><path class="edge" data-state="cut" d="M0 180 H135 M195 180 H330"/><path class="edge-breaker" d="M165 170 V190"/><text class="edge-tag" x="165" y="166">BREAKER OPEN</text></svg></div>`;
};
const formsAndFeedback = () => `<div class="spec-two"><div class="panel"><div class="field"><label for="f1-{T}">Seed (optional)</label><input class="input" id="f1-{T}" value="48213"><p class="hint">Leave blank for the standard seed.</p></div><div class="field spec-gap"><label for="f2-{T}">Seed (invalid)</label><input class="input" id="f2-{T}" value="abc" aria-invalid="true" aria-describedby="f2e-{T}"><p class="field-error" id="f2e-{T}">${use('ic-crit')}Seed must be a whole number from 0 to 4294967295.</p></div></div>
  <div class="panel"><span class="stencil">Toasts: page, warn, clear, note</span><div class="spec-toasts">${toast('page', 'PAGE', 'SEV2: checkout p99 &gt; 2 s', 'ic-crit')}${toast('warn', 'WARN', 'Cache hit rate under 80%', 'ic-warn')}${toast('clear', 'CLEARED', 'checkout p99 back under 2 s', 'ic-recv')}${toast('note', 'NOTE', 'Applied: Add TTL jitter', 'ic-note')}</div></div></div>
  <div class="spec-banners">${stateBanner('error', 'ic-crit', 'Error', 'Could not load the incidents. Check that the server is still running (node src/server.js), then try again.', '<button class="btn btn-primary" type="button">Try again</button>')}
  ${stateBanner('note', 'ic-warn', 'Note', 'This browser is blocking storage, so progress will not be saved. You can still play and use Export on the Your data page.')}
  ${stateBanner('empty', 'ic-note', 'Empty', 'No incidents resolved yet. Your first one is a click away.', '<a class="btn" href="#/incidents">Go to the incident board</a>')}
  ${stateBanner('success', 'ic-recv', 'Resolved', 'Resolved at T+02:41. The pager goes quiet.', '<button class="btn btn-primary" type="button" data-testid="open-debrief">Open debrief</button>')}
  ${stateBanner('error', 'ic-crit', 'Out of pager budget', 'Out of pager budget. Actions are off. Watching 10 s to see if your last fix lands.', '', '<span class="banner-countdown">00:07</span>')}</div>
  <div class="spec-two"><div class="skeleton" role="status" data-testid="boot-loading"><span class="sk-node"></span><span class="sk-node"></span><span class="sk-node"></span><p>Plugging in the pager...</p></div>
  <div class="panel"><span class="stencil">Dialog</span><div class="dialog dialog-static" role="group" aria-label="Dialog sample"><h2>Take one hint?</h2><p>It costs score, not pager.</p><div class="dialog-actions"><button class="btn" type="button">Cancel</button><button class="btn btn-primary" type="button">Take hint</button></div></div></div></div>`;

const section = (id, title, inner) => `<section class="spec-sec" aria-labelledby="s-${id}-{T}"><div class="spec-sec-head"><span class="stencil">${id}</span><h2 id="s-${id}-{T}">${title}</h2></div>${inner}</section>`;

function theme(name) {
  const body = `<div class="spec" data-theme="${name}"><div class="spec-banner"><span class="wordmark">incident<span class="dash">-</span>sim</span><span class="stencil">Design specimen · ${name === 'dark' ? 'Ops console (dark, default)' : 'Daylight (light)'}</span></div>
  ${section('01 Shell', 'Play view', header('inc', true) + playView())}
  ${section('02 Map', 'Nodes and edges', nodeGallery())}
  ${section('03 Status', 'Status language: shape plus label plus colour', statusGallery())}
  ${section('04 Tokens', 'Palette', palette())}
  ${section('05 Type', 'Typography', typeRamp())}
  ${section('06 Controls', 'Buttons, switches, lamps', buttons())}
  ${section('07 Panels', 'Pages, inspector, actions, history', `<div class="spec-two">${pagesPanel()}${pagesPanel(false, true)}</div><div class="spec-two">${inspectPanel()}${actionPanel()}</div>${historyPanel()}`)}
  ${section('08 Feedback', 'Forms, toasts, banners, dialog, loading', formsAndFeedback())}
  ${section('09 Text mode', 'Table twin of the map', textView())}
  ${section('10 Board', 'Incident board', header('inc', false) + boardView())}
  ${section('11 Debrief', 'Result card and flight recorder', header('inc', false) + debriefView())}
  ${section('12 Data', 'Your data', header('data', false) + dataView())}
  ${section('13 About', 'About', header('about', false) + aboutView())}</div>`;
  return body.replaceAll('{T}', name);
}

const darkHtml = theme('dark'); const lightHtml = theme('light');
const marksCss = [...xs].sort((a, b) => a - b).map((v) => `.x-${v}{left:${v}%}`).join('');
const specCss = `
.spec { padding: var(--sp-5) var(--sp-4) var(--sp-8); display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--sp-7); }
.spec-banner { display: flex; align-items: center; gap: var(--sp-4); border-bottom: var(--bw-2) solid var(--c-text); padding-bottom: var(--sp-3); }
.spec-sec { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--sp-3); min-width: 0; }
.spec-sec-head { display: flex; align-items: baseline; gap: var(--sp-3); }
.spec-sec-head h2 { font-size: var(--fs-h3); }
.spec-two { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--sp-4); }
.spec-gap { margin-top: var(--sp-4); }
.spec-lamps { display: flex; flex-wrap: wrap; gap: var(--sp-5); margin-top: var(--sp-2); }
.spec-status { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--sp-4); }
.spec-status-col { display: grid; gap: var(--sp-3); justify-items: start; }
.spec-nodes { display: flex; flex-wrap: wrap; gap: var(--sp-3); background: var(--c-bg-0); }
.spec-type { display: grid; gap: var(--sp-3); }
.spec-banners { display: grid; gap: var(--sp-3); }
.spec-toasts { display: grid; gap: var(--sp-3); margin-top: var(--sp-3); }
.spec-edges { max-width: 100%; height: auto; }
.spec-focus { outline: var(--focus-ring); outline-offset: var(--focus-offset); }
.spec-play .play-grid { block-size: 46rem; }
.spec-play .map { min-block-size: 0; }
.map-tall { display: none; position: absolute; inset: 0; }
.map-wide { position: absolute; inset: 0; }
.swatches { display: grid; grid-template-columns: repeat(auto-fill, minmax(11rem, 1fr)); gap: var(--sp-3); }
.sw { display: flex; align-items: center; gap: var(--sp-3); font-size: var(--fs-label); }
.sw-chip { inline-size: var(--sp-6); block-size: var(--sp-6); border-radius: var(--r-1); box-shadow: inset 0 0 0 var(--bw-1) var(--c-line-ui); flex: none; }
.sw-bg0 { background: var(--c-bg-0); } .sw-bg1 { background: var(--c-bg-1); } .sw-bg2 { background: var(--c-bg-2); } .sw-ls { background: var(--c-line-soft); } .sw-lu { background: var(--c-line-ui); } .sw-ed { background: var(--c-edge); }
.sw-tx { background: var(--c-text); } .sw-tm { background: var(--c-text-muted); } .sw-pb { background: var(--c-primary-bg); } .sw-ok { background: var(--c-ok); } .sw-warn { background: var(--c-warn); } .sw-crit { background: var(--c-crit); } .sw-recv { background: var(--c-recv); }
.sw-okt { background: var(--c-ok-tint); } .sw-wt { background: var(--c-warn-tint); } .sw-ct { background: var(--c-crit-tint); } .sw-rt { background: var(--c-recv-tint); } .sw-dot { background: var(--c-dot); }
.spec .page { padding-inline: 0; }
.spec .page > .result-card h1 { margin: 0; }
.spec .app-header { margin-bottom: 0; }
.spec .debrief-grid .recorder { min-width: 0; }
@media (max-width: 1023px) { .spec-play .play-grid { block-size: auto; } .spec-play .map { block-size: 26rem; } }
@media (max-width: 719px) {
  .spec { padding-inline: var(--sp-3); } .spec-two, .spec-status { grid-template-columns: minmax(0, 1fr); }
  .map-wide { display: none; } .map-tall { display: block; } .spec-nodes { justify-content: center; }
  .spec-play .map { block-size: 31.5rem; }
}
${marksCss}
`;

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Design specimen - incident-sim</title>
<link rel="stylesheet" href="tokens.css">
<link rel="stylesheet" href="app.css">
<style>${specCss}</style>
</head>
<body>
<!-- Generated by tests/tools/build-specimen.js. Dev-only page: it carries a <style> block for the lane-mark positions, which the real app sets with CSSOM (el.style.setProperty) to stay CSP-clean. -->
${sprite}
<main id="main">
<h1 class="sr-only">Design specimen</h1>
${darkHtml}
${lightHtml}
</main>
</body>
</html>
`;
fs.writeFileSync(path.join(PUBLIC, 'design-specimen.html'), html);
console.log(`design-specimen.html ${html.length} bytes`);
