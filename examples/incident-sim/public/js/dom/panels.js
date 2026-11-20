// Play panels: pages, inspector, actions, mission bar, toolbar, sparklines, toasts. Each factory returns { el, update(...) }
// and only paints what core/viewmodel.js hands it.
import {
  h, s, icon, setText, setAttr, setAttrs, setIcon, setHidden,
} from './shell.js';
import {
  alertRows, nodeVm, inspectMetrics, logsFor, logLineVm, STATUS_LABEL, STATUS_ICON, actionRows, historyRows, nodeLabel, costOf, costText, EFFECT_TEXT,
  lamps, pagerText, pagerLabel, sparkVms, sparkPath, sparkArea, sparkY,
} from '../core/viewmodel.js';
import { ACTIONS } from '../engine/catalogue.js';
import { clock, mmss } from '../core/format.js';

// ---------------------------------------------------------------- panel-alerts
// Pages panel. Rows are buttons that select the affected node. When several pages clear at once they flip one by one, 300 ms apart.

export const STAGGER_MS = 300;

export function createAlertsPanel({ onPick, reduced }) {
  const count = h('span', { class: 'panel-count', 'data-status': 'ok', text: '0' });
  const list = h('ul', { class: 'alert-list' });
  const emptyLine = h('p', { class: 'empty-line', testid: 'alerts-empty', 'data-kicker': 'Pages', text: 'No pages. Enjoy it while it lasts.' });
  const head = h('div', { class: 'panel-head' }, [h('h2', { id: 'h-pages', text: 'Pages' }), count]);
  const panel = h('section', { class: 'panel pages', testid: 'alerts-panel', 'aria-labelledby': 'h-pages', 'data-tab-active': 'true' }, [head, list, emptyLine]);
  const rows = new Map();
  const timers = new Set();
  let order = '';

  function build(r) {
    const sevIcon = icon('ic-crit');
    const sev = h('span', { class: 'alert-sev sev', 'data-sev': String(r.severity) }, [sevIcon, h('span', { class: 'sev-text' })]);
    const text = h('span', { class: 'alert-text', text: r.text });
    const meta = h('span', { class: 'alert-meta' });
    const btn = h('button', { type: 'button', class: 'alert-row', testid: 'alert-item', 'data-alert-id': r.id, 'data-severity': String(r.severity), 'data-state': 'firing' }, [sev, ' ', text, ' ', meta]);
    const li = h('li', null, btn);
    const row = { li, btn, sev, sevIcon, sevText: sev.querySelector('.sev-text'), meta, node: r.node, shown: null };
    btn.addEventListener('click', () => { if (row.node) onPick(row.node); });
    rows.set(r.id, row);
    return row;
  }

  function show(row, r, state) {
    row.shown = state;
    row.node = r.node;
    setAttr(row.btn, 'data-state', state);
    if (state === 'firing') {
      setIcon(row.sevIcon, r.severity <= 2 ? 'ic-crit' : 'ic-warn');
      setText(row.sevText, `SEV${r.severity}:`);
      setText(row.meta, r.meta.startsWith('since') ? r.meta : `since ${r.meta}`);
    } else {
      setIcon(row.sevIcon, 'ic-recv');
      setText(row.sevText, 'Cleared:');
      setText(row.meta, `SEV${r.severity} · ${r.meta.split(' · ').pop()}`);
    }
  }

  return {
    el: panel,
    setTabActive(active) { setAttr(panel, 'data-tab-active', String(active)); },
    update(state) {
      const data = alertRows(state);
      const firing = data.filter((r) => r.state === 'firing').length;
      setText(count, String(firing));
      setAttr(count, 'data-status', firing > 0 ? 'crit' : 'ok');
      setHidden(emptyLine, data.length > 0);
      const sig = data.map((r) => r.id).join('|');
      let flips = 0;
      for (const r of data) {
        const row = rows.get(r.id) || build(r);
        if (row.shown === null || r.state === 'firing' || row.shown === r.state) {
          show(row, r, r.state);
        } else if (reduced() || flips === 0) {
          show(row, r, r.state);
          flips += 1;
        } else {
          const t = setTimeout(() => { timers.delete(t); show(row, r, r.state); }, flips * STAGGER_MS);
          timers.add(t);
          flips += 1;
        }
      }
      if (sig !== order) {
        order = sig;
        for (const r of data) list.append(rows.get(r.id).li);
      }
    },
    destroy() { for (const t of timers) clearTimeout(t); timers.clear(); },
  };
}

// ---------------------------------------------------------------- panel-inspect
// Inspector: node title and status, six metrics, diagnostic output and the log list (pinned to the newest line).

export const MAX_LOG_DOM = 200;

export function createInspectPanel({ scenario }) {
  const title = h('h2', { id: 'h-inspect', testid: 'inspect-title', tabindex: '-1', text: 'Inspector' });
  const badgeIcon = icon('ic-ok');
  const badgeText = h('span', { text: 'OK' });
  const badge = h('span', { class: 'badge badge-tint', testid: 'inspect-status', 'data-status': 'ok', hidden: true }, [badgeIcon, badgeText]);
  const head = h('div', { class: 'panel-head' }, [title, badge]);
  const empty = h('p', { class: 'empty-line', testid: 'inspect-empty', 'data-kicker': 'Inspect', text: 'Select a node to inspect it. Press I, or click one.' });

  const dds = new Map();
  const metrics = h('dl', { class: 'metrics', testid: 'inspect-metrics' });
  for (const key of ['p50', 'p99', 'errors', 'saturation', 'queue', 'cache-hit']) {
    const dd = h('dd', { testid: 'metric-value', 'data-metric': key, 'data-value': '' });
    dds.set(key, dd);
    const label = { p50: 'p50', p99: 'p99', errors: 'Errors', saturation: 'Saturation', queue: 'Queue', 'cache-hit': 'Hit rate' }[key];
    metrics.append(h('div', null, [h('dt', { text: label }), dd]));
  }
  const diag = h('div', { class: 'diag-result', testid: 'diag-result', hidden: true });
  const log = h('ul', { class: 'log', testid: 'log-list', tabindex: '0' });
  const logEmpty = h('p', { class: 'empty-line', testid: 'log-empty', 'data-kicker': 'Log' });
  const latest = h('button', { type: 'button', class: 'btn btn-primary log-latest', testid: 'log-latest', text: 'Jump to latest', hidden: true });
  const body = h('div', { class: 'inspect-body', hidden: true }, [metrics, diag, log, logEmpty, latest]);
  const panel = h('section', { class: 'panel', testid: 'inspect-panel', 'data-node': '', 'aria-labelledby': 'h-inspect' }, [head, empty, body]);

  let node = null;
  let pinned = true;
  let diagKey = '';
  let lastTick = -1;

  const addLine = (l) => {
    const v = logLineVm(l);
    log.append(h('li', { class: 'log-line', testid: 'log-line', 'data-time': String(l.t), 'data-level': v.level, 'data-kind': v.kind }, [
      h('span', { class: 't', text: v.time }), ' ', h('span', { class: 'lvl', text: v.levelWord }), ' ', h('span', { text: v.text }),
    ]));
  };
  const trim = () => { while (log.children.length > MAX_LOG_DOM) log.firstElementChild.remove(); };
  const stick = () => { if (pinned) log.scrollTop = log.scrollHeight; };
  log.addEventListener('scroll', () => {
    pinned = log.scrollHeight - log.scrollTop - log.clientHeight < 8;
    if (pinned) latest.hidden = true;
  });
  latest.addEventListener('click', () => { pinned = true; latest.hidden = true; log.scrollTop = log.scrollHeight; log.focus(); });

  function rebuildLogs(state) {
    while (log.firstChild) log.firstChild.remove();
    for (const l of logsFor(state, node).slice(-MAX_LOG_DOM)) addLine(l);
    pinned = true;
    latest.hidden = true;
    lastTick = state.tick;
    stick();
  }

  function paintMetrics(state) {
    const vm = nodeVm(state, scenario, node);
    setText(title, vm.label);
    setAttr(badge, 'data-status', vm.status);
    setIcon(badgeIcon, STATUS_ICON[vm.status].slice(1));
    setText(badgeText, STATUS_LABEL[vm.status]);
    for (const m of inspectMetrics(vm)) {
      const dd = dds.get(m.key);
      setText(dd, m.text);
      setAttr(dd, 'data-value', m.value);
    }
    setAttr(log, 'aria-label', `Logs for ${vm.label}`);
    setText(logEmpty, `Quiet. Nothing logged for ${vm.label} yet. Logs fill in as traffic flows.`);
  }

  function paintDiag(state) {
    const d = state.diag;
    const key = d ? `${d.id}@${d.t}` : '';
    if (key === diagKey) return;
    diagKey = key;
    setHidden(diag, !d);
    diag.textContent = d ? d.lines.join('\n') : '';
  }

  return {
    el: panel,
    title,
    log,
    setTabActive(active) { setAttr(panel, 'data-tab-active', String(active)); },
    // Called every painted tick. `selectionChanged` rebuilds the log list.
    update(state, selected, { selectionChanged = false } = {}) {
      if (selected !== node) { node = selected; selectionChanged = true; }
      setAttr(panel, 'data-node', node || '');
      setHidden(empty, node !== null);
      setHidden(body, node === null);
      setHidden(badge, node === null);
      if (node === null) { setText(title, 'Inspector'); return; }
      paintMetrics(state);
      paintDiag(state);
      if (selectionChanged) rebuildLogs(state);
      else {
        const fresh = [];
        for (let i = state.logs.length - 1; i >= 0 && state.logs[i].t > lastTick; i--) {
          if (state.logs[i].node === node || state.logs[i].node === null) fresh.unshift(state.logs[i]);
        }
        lastTick = state.tick;
        for (const l of fresh) addLine(l);
        if (fresh.length) {
          trim();
          if (pinned) stick(); else latest.hidden = false;
        }
      }
      setHidden(logEmpty, log.children.length > 0);
    },
  };
}

// ---------------------------------------------------------------- panel-actions
// Action panel: costs shown before use, disabled rows keep their reason, feedback line, your actions, the hint once taken.

export function createActionsPanel({
  scenario, onAction, onPreview,
}) {
  const aside = h('span', { class: 'panel-aside', hidden: true });
  const head = h('div', { class: 'panel-head' }, [h('h2', { id: 'h-actions', text: 'Actions' }), aside]);
  const diagnose = h('ul', { class: 'action-group' });
  const fix = h('ul', { class: 'action-group' });
  const feedback = h('p', { class: 'action-feedback', role: 'status', testid: 'action-feedback' });
  const hintText = h('p', { class: 'hint-text', testid: 'hint-text', hidden: true });
  const historyHead = h('span', { class: 'stencil', text: 'Your actions' });
  const history = h('ol', { class: 'history', testid: 'history-list', 'aria-label': 'Your actions' });
  const historyEmpty = h('p', { class: 'hint', text: 'Nothing yet. Every action here costs pager unless it says Free.' });
  const panel = h('section', { class: 'panel actions', testid: 'action-panel', 'data-node': '', 'aria-labelledby': 'h-actions', 'data-tab-active': 'false' }, [
    head,
    h('div', { class: 'action-group' }, [h('span', { class: 'stencil', text: 'Diagnose' }), diagnose]),
    h('div', { class: 'action-group' }, [h('span', { class: 'stencil', text: 'Fix' }), fix]),
    feedback, hintText,
    h('div', { class: 'action-group' }, [historyHead, history, historyEmpty]),
  ]);

  const rows = new Map();
  const historyItems = [];
  let current = { cost: 0 };

  for (const a of ACTIONS) {
    const r = { id: a.id, name: a.name, kind: a.kind, cost: costOf(scenario, a.id), effect: EFFECT_TEXT[a.id] || '' };
    const reason = h('span', { class: 'reason', id: `act-reason-${r.id}`, testid: 'action-reason', hidden: true });
    const desc = h('span', { class: 'sr-only', id: `act-desc-${r.id}` });
    const cost = h('span', { class: 'action-cost', testid: 'action-cost', text: costText(r.cost) });
    const btn = h('button', {
      type: 'button', class: 'action-row', testid: 'action-item', 'data-action-id': r.id, 'data-kind': r.kind, 'data-cost': String(r.cost), 'data-state': 'enabled',
    }, [h('span', { class: 'action-name', text: r.name }), ' ', cost, ' ', h('span', { class: 'action-effect', text: r.effect }), ' ', reason, desc]);
    btn.addEventListener('click', () => onAction(r.id));
    btn.addEventListener('focus', () => { if (current.rows && current.rows.get(r.id) === 'enabled') onPreview(r.cost); });
    btn.addEventListener('mouseenter', () => { if (current.rows && current.rows.get(r.id) === 'enabled') onPreview(r.cost); });
    btn.addEventListener('blur', () => onPreview(0));
    btn.addEventListener('mouseleave', () => { if (document.activeElement !== btn) onPreview(0); });
    (r.kind === 'fix' ? fix : diagnose).append(h('li', null, btn));
    rows.set(r.id, { btn, cost, reason, desc });
  }

  return {
    el: panel,
    rows: () => Array.from(panel.querySelectorAll('[data-testid="action-item"]')),
    setTabActive(active) { setAttr(panel, 'data-tab-active', String(active)); },
    setFeedback(text) { setText(feedback, text); },
    showHint(text) { setText(hintText, `Hint: ${text}`); setHidden(hintText, false); },
    update(state, selected) {
      setAttr(panel, 'data-node', selected || '');
      setText(aside, selected ? `Target: ${nodeLabel(scenario, selected)}` : '');
      setHidden(aside, !selected);
      const data = actionRows(state, scenario, selected);
      current = { rows: new Map(data.map((r) => [r.id, r.state])) };
      for (const r of data) {
        const n = rows.get(r.id);
        setAttr(n.btn, 'data-state', r.state);
        setAttr(n.btn, 'aria-disabled', r.state === 'enabled' ? null : 'true');
        setText(n.cost, r.costText);
        setText(n.desc, r.description);
        setText(n.reason, r.reason);
        setHidden(n.reason, r.reason === '');
        setAttr(n.btn, 'aria-describedby', r.reason ? `${n.desc.id} ${n.reason.id}` : n.desc.id);
      }
      const hist = historyRows(state, scenario);
      setHidden(historyEmpty, hist.length > 0);
      hist.forEach((hr, i) => {
        let item = historyItems[i];
        if (!item) {
          const mark = h('span', { class: 'effect-mark' });
          const li = h('li', { testid: 'history-item', 'data-action-id': hr.id, 'data-time': String(hr.time), 'data-effect': '' }, [
            h('span', { class: 't', text: hr.timeText }), ' ',
            h('span', { class: 'history-name' }, [hr.name, hr.target ? h('span', { class: 'muted', text: ` · ${hr.target}` }) : null]), ' ', mark,
          ]);
          history.append(li);
          item = { li, mark, effect: undefined };
          historyItems[i] = item;
        }
        if (item.effect !== hr.effect) {
          item.effect = hr.effect;
          setAttr(item.li, 'data-effect', hr.effect || '');
          item.mark.textContent = '';
          if (hr.effect === 'harmful') item.mark.append(h('span', { class: 'badge badge-harmful', testid: 'harmful-badge' }, [icon('ic-mark-x'), 'Harmful']));
          else item.mark.append(hr.effectWord);
        }
      });
    },
  };
}

// ---------------------------------------------------------------- mission
// Mission bar in the header: T+ clock, pager lamps with cost preview, pause.

export function createMission({ total, onPause }) {
  const time = h('span', { class: 'clock-time', text: '00:00' });
  const clockEl = h('time', { class: 'clock', testid: 'mission-clock', 'data-seconds': '0', datetime: 'PT0S' }, [h('span', { class: 'clock-unit', text: 'T+' }), time]);
  const lampEls = Array.from({ length: total }, () => h('span', { class: 'lamp', testid: 'pager-lamp', 'data-state': 'on' }));
  const lampGroup = h('span', { class: 'lamps', testid: 'pager-lamps', role: 'group', 'aria-label': pagerLabel(total, total) }, lampEls);
  const text = h('span', { class: 'pager-text', testid: 'pager-text', text: pagerText(total, total) });
  const pauseIcon = icon('ic-pause', 'icon');
  const pauseLabel = h('span', { class: 'btn-label', text: 'Pause' });
  const pause = h('button', { type: 'button', class: 'btn btn-icon', testid: 'pause-button', 'aria-pressed': 'false', on: { click: onPause } }, [pauseIcon, pauseLabel]);
  const root = h('div', { class: 'mission' }, [clockEl, h('span', { class: 'pager' }, [lampGroup, text]), pause]);

  return {
    el: root,
    pause,
    update(state, { paused, over, previewCost, budgetLeft }) {
      setText(time, mmss(state.tick));
      setAttr(clockEl, 'data-seconds', String(state.tick));
      setAttr(clockEl, 'datetime', `PT${state.tick}S`);
      clockEl.setAttribute('aria-label', clock(state.tick));
      const left = budgetLeft;
      lamps(total, left, previewCost).forEach((l, i) => {
        setAttr(lampEls[i], 'data-state', l.state);
        setAttr(lampEls[i], 'data-preview', l.preview ? 'true' : null);
      });
      setAttr(lampGroup, 'aria-label', pagerLabel(left, total));
      setText(text, pagerText(left, total));
      setAttr(pause, 'aria-pressed', String(paused));
      setText(pauseLabel, paused ? 'Resume' : 'Pause');
      setIcon(pauseIcon, paused ? 'ic-play' : 'ic-pause');
      setHidden(pause, over);
    },
  };
}

// ---------------------------------------------------------------- toolbar
// Row under the map: seed chip, paused chip, step and run buttons, hint, text-mode and shortcuts switches, keys.

export function createToolbar({
  seed, onStep, onRun, onHint, onMode, onShortcuts, onHelp,
}) {
  const state = h('span', { class: 'chip chip-muted', hidden: true });
  const step1 = h('button', { type: 'button', class: 'btn', testid: 'step-button', hidden: true, on: { click: () => onStep(1) } }, [icon('ic-step', 'icon'), 'Step 1 s']);
  const step5 = h('button', { type: 'button', class: 'btn', testid: 'step-5-button', hidden: true, on: { click: () => onStep(5) } }, [icon('ic-step', 'icon'), 'Step 5 s']);
  const run = h('button', { type: 'button', class: 'btn btn-primary', testid: 'run-button', hidden: true, on: { click: onRun } }, [icon('ic-play', 'icon'), 'Run']);
  const hint = h('button', { type: 'button', class: 'btn', testid: 'hint-button', text: 'Hint', on: { click: onHint } });
  const mode = h('button', { type: 'button', class: 'switch', role: 'switch', 'aria-checked': 'false', testid: 'mode-toggle', text: 'Text mode', on: { click: onMode } });
  const shortcuts = h('button', { type: 'button', class: 'switch', role: 'switch', 'aria-checked': 'true', testid: 'shortcuts-toggle', text: 'Shortcuts', on: { click: onShortcuts } });
  const help = h('button', { type: 'button', class: 'btn', testid: 'help-button', text: 'Keys', on: { click: onHelp } });
  const el = h('div', { class: 'toolbar' }, [
    h('span', { class: 'chip', testid: 'seed-chip', text: `Seed ${seed}` }), state, step1, step5, run, hint,
    h('span', { class: 'toolbar-end' }, [mode, shortcuts, help]),
  ]);
  return {
    el,
    hint, mode, shortcuts, help,
    update({ paused, text, over, hintUsed, shortcutsOn }) {
      const stepping = (paused || text) && !over;
      setHidden(step1, !stepping);
      setHidden(step5, !stepping);
      setHidden(run, !(text && paused && !over));
      setText(state, paused && !over ? 'Paused' : '');
      setHidden(state, !(paused && !over));
      setText(hint, hintUsed ? 'Hint used' : 'Hint');
      setAttr(hint, 'aria-disabled', hintUsed ? 'true' : null);
      setAttr(mode, 'aria-checked', String(text));
      setAttr(shortcuts, 'aria-checked', String(shortcutsOn));
    },
  };
}

// ---------------------------------------------------------------- sparks
// Metrics strip: five sparklines with fixed ranges, a threshold line, the current value and a status label.

export function createSparks({ scenario }) {
  const strip = h('section', { class: 'metrics-strip', testid: 'metrics-strip', 'aria-label': 'Key signals' });
  const tiles = new Map();
  for (const t of sparkVms({ series: { p99: [], errors: [], saturation: [], queue: [], 'cache-hit': [] }, params: {}, scenario }, scenario)) {
    const badgeIcon = icon('ic-ok');
    const badgeText = h('span', { text: 'OK' });
    const badge = h('span', { class: 'badge', testid: 'spark-status', 'data-status': 'ok' }, [badgeIcon, badgeText]);
    const value = h('span', { class: 'spark-num' });
    const unit = h('span', { class: 'muted' });
    const sub = h('span', { class: 'muted spark-node', text: t.nodeLabel });
    const area = s('path', { class: 'spark-area' });
    const thresh = s('path', { class: 'spark-thresh' });
    const threshLabel = s('text', { class: 'spark-thresh-label', 'text-anchor': 'end', x: '162' });
    const line = s('path', { class: 'spark-line' });
    const end = s('use', { class: 'spark-end', href: '#ic-ok', width: '8', height: '8' });
    const svg = s('svg', { viewBox: '0 0 164 56', role: 'img' }, [area, thresh, threshLabel, line, end]);
    const root = h('div', { class: 'spark', testid: 'spark', 'data-metric': t.key, 'data-value': '', 'data-status': 'ok' }, [
      h('div', { class: 'spark-head' }, [h('span', { class: 'spark-name', text: t.name }), badge]),
      h('div', { class: 'spark-value' }, [value, unit, sub]),
      svg,
    ]);
    strip.append(root);
    tiles.set(t.key, { root, badge, badgeIcon, badgeText, value, unit, area, thresh, threshLabel, line, end, svg });
  }

  return {
    el: strip,
    update(state) {
      for (const t of sparkVms(state, scenario)) {
        const n = tiles.get(t.key);
        setAttr(n.root, 'data-value', t.value);
        setAttr(n.root, 'data-status', t.status);
        setAttr(n.badge, 'data-status', t.status);
        setIcon(n.badgeIcon, STATUS_ICON[t.status].slice(1));
        setText(n.badgeText, STATUS_LABEL[t.status]);
        setText(n.value, t.valueText);
        setText(n.unit, t.unit);
        const d = sparkPath(t.series, t.max);
        setAttr(n.line, 'd', d);
        setAttr(n.area, 'd', sparkArea(t.series, t.max));
        if (t.threshold === null) {
          setAttr(n.thresh, 'd', '');
          setText(n.threshLabel, '');
        } else {
          const y = Math.round(sparkY(t.threshold, t.max) * 10) / 10;
          setAttr(n.thresh, 'd', `M2 ${y} H162`);
          setAttr(n.threshLabel, 'y', String(Math.max(10, y - 3)));
          setText(n.threshLabel, t.thresholdText);
        }
        const last = t.series.length ? t.series[t.series.length - 1] : null;
        if (last === null || !t.available) setAttr(n.end, 'visibility', 'hidden');
        else {
          const y = sparkY(last, t.max);
          setAttr(n.end, 'visibility', null);
          setAttr(n.end, 'x', '158');
          setAttr(n.end, 'y', String(Math.round((y - 4) * 10) / 10));
          setIcon(n.end, STATUS_ICON[t.status].slice(1));
        }
        setAttr(n.svg, 'aria-label', `${t.nodeLabel} ${t.name}, last 60 seconds, now ${t.valueText}${t.unit}`);
      }
    },
  };
}

// ---------------------------------------------------------------- toasts
// Toasts over the top edge of the map: max 3, 8 s, no controls, aria-hidden (the alert list and live regions carry the content).

const KINDS = {
  page: { kicker: 'PAGE', icon: 'ic-crit' },
  warn: { kicker: 'WARN', icon: 'ic-warn' },
  clear: { kicker: 'CLEARED', icon: 'ic-recv' },
  note: { kicker: 'NOTE', icon: 'ic-note' },
};
export const TOAST_MS = 8000;
export const MAX_TOASTS = 3;

export function createToasts({ reduced }) {
  const region = h('div', { class: 'toast-region', testid: 'toast-region', 'aria-hidden': 'true' });
  const timers = new Set();

  function remove(toast) {
    if (!toast.isConnected) return;
    if (reduced()) { toast.remove(); return; }
    toast.setAttribute('data-state', 'out');
    const t = setTimeout(() => { timers.delete(t); toast.remove(); }, 150);
    timers.add(t);
  }

  return {
    el: region,
    show(kind, text) {
      const def = KINDS[kind] || KINDS.note;
      const toast = h('div', { class: 'toast', testid: 'alert-toast', 'data-kind': kind }, h('div', { class: 'toast-body' }, [
        h('span', { class: 'toast-kicker' }, [icon(def.icon), def.kicker]),
        h('span', { class: 'toast-text', text }),
      ]));
      region.append(toast);
      while (region.children.length > MAX_TOASTS) region.firstElementChild.remove();
      const t = setTimeout(() => { timers.delete(t); remove(toast); }, TOAST_MS);
      timers.add(t);
    },
    destroy() {
      for (const t of timers) clearTimeout(t);
      timers.clear();
      region.remove();
    },
  };
}
