// The play screen: owns the engine state, the scheduler and every panel. Panels only paint what the view model hands them.
import {
  createRun, step, canApply, firingAlerts, firstNonOk, result,
} from '../engine/engine.js';
import { ACTIONS } from '../engine/catalogue.js';
import { score } from '../engine/score.js';
import { createAnnouncer, statusSummary } from '../core/announcer.js';
import { nearest, readingOrder } from '../core/keys.js';
import {
  playAttrs, documentTitle, isGrace, nodeIds, summaryNodes, alertRows, actionFeedback,
  resolvedText, resolvedAnnouncement, GRACE_TEXT, OVER_TEXT, graceCountdown,
} from '../core/viewmodel.js';
import {
  h, icon, setAttrs, setAttr, setText, clear, focusEl,
  appErrorBanner,
} from './shell.js';
import { createMap } from './map.js';
import { createScheduler } from './scheduler.js';
import {
  createToasts, createSparks, createAlertsPanel, createInspectPanel, createActionsPanel, createMission, createToolbar,
} from './panels.js';
import { createTextView } from './text-view.js';
import { openDialog, openKeysDialog } from './dialogs.js';

const TABS = [['alerts', 'Pages'], ['inspect', 'Inspect'], ['actions', 'Actions'], ['metrics', 'Metrics']];

export function mountPlay(root, app, { scenario, seed }) {
  const tm = app.tm;
  const total = scenario.budget;
  const ui = {
    paused: tm.paused, text: false, selected: null, hintUsed: false, reduced: app.reduced.value, speed: tm.speed, updatedAt: 0, previewCost: 0, tab: 'alerts', pauseAtDone: false,
  };
  let state;
  try {
    state = createRun(scenario, seed, { failAtTick: tm.failAt });
  } catch (err) {
    return mountFailure(root, app, seed, err);
  }
  let shown = state;
  let finished = false;
  let failed = false;
  let lastTitle = '';
  let bannerKind = '';
  const announcer = createAnnouncer();

  // ------------------------------------------------------------------ parts
  const toasts = createToasts({ reduced: () => ui.reduced });
  const sparks = createSparks({ scenario });
  const alerts = createAlertsPanel({ onPick: (id) => select(id, { tab: true }), reduced: () => ui.reduced });
  const inspect = createInspectPanel({ scenario });
  const actions = createActionsPanel({
    scenario, onAction: (id) => doAction(id), onPreview: (c) => { ui.previewCost = c; paintHeader(); },
  });
  const mission = createMission({ total, onPause: () => togglePause() });
  const toolbar = createToolbar({
    seed: state.seed,
    onStep: (n) => stepMany(n),
    onRun: () => setPaused(false),
    onHint: () => openHint(),
    onMode: () => setMode(!ui.text),
    onShortcuts: () => { app.setShortcuts(!app.settings.shortcuts); paintToolbar(); },
    onHelp: () => withPause(() => openKeysDialog(toolbar.help)),
  });
  const title = h('h1', { class: 'play-title', text: scenario.title });
  const bannerSlot = h('div', { class: 'map-banner', hidden: true });
  const mapWrap = h('div', { class: 'map-wrap' });
  let mapHost = null;
  let map = null;
  let textView = null;

  const tabButtons = new Map();
  const tabCount = h('span', { class: 'panel-count', 'data-status': 'ok', text: '0' });
  const tabs = h('div', { class: 'tabs', role: 'tablist', testid: 'panel-tabs', 'aria-label': 'Panels' });
  const panelIds = { alerts: alerts.el, inspect: inspect.el, actions: actions.el, metrics: sparks.el };
  alerts.el.id = 'panel-alerts'; inspect.el.id = 'panel-inspect'; actions.el.id = 'panel-actions'; sparks.el.id = 'panel-metrics';
  for (const [key, label] of TABS) {
    const btn = h('button', {
      type: 'button', class: 'tab', role: 'tab', id: `tab-${key}`, testid: `tab-${key}`, 'aria-selected': 'false', 'aria-controls': `panel-${key}`, tabindex: '-1',
    }, key === 'alerts' ? [label, tabCount] : label);
    btn.addEventListener('click', () => setTab(key));
    btn.addEventListener('keydown', (e) => {
      const i = TABS.findIndex((t) => t[0] === key);
      const to = e.key === 'ArrowRight' ? (i + 1) % TABS.length : e.key === 'ArrowLeft' ? (i + TABS.length - 1) % TABS.length : e.key === 'Home' ? 0 : e.key === 'End' ? TABS.length - 1 : -1;
      if (to < 0) return;
      e.preventDefault();
      setTab(TABS[to][0]);
      tabButtons.get(TABS[to][0]).focus();
    });
    tabButtons.set(key, btn);
    tabs.append(btn);
  }

  const view = h('div', { class: 'play-grid', testid: 'play-view' }, [
    h('div', { class: 'play-main' }, [mapWrap, toolbar.el, sparks.el]),
    tabs,
    h('div', { class: 'rail' }, [alerts.el, inspect.el, actions.el]),
  ]);
  root.append(view);
  app.shell.setMission(mission.el);
  if (tm.active) app.shell.setNotice('test', { banner: true, testid: 'test-banner', text: app.testBannerText });

  let kbd = false;
  const onKbd = () => { kbd = true; };
  const onPtr = () => { kbd = false; };
  document.addEventListener('keydown', onKbd, true);
  document.addEventListener('pointerdown', onPtr, true);
  const scheduler = createScheduler({ onTicks: (n) => onTicks(n), getSpeed: () => ui.speed });

  // ------------------------------------------------------------------ map and text mode
  function nodeEl(id) { return mapWrap.querySelector(`[data-testid="map-node"][data-node="${id}"]`); }

  function mountMap() {
    mapHost = h('div', { class: 'map ticks' });
    mapWrap.prepend(mapHost);
    mapWrap.prepend(title);
    map = createMap(mapHost, scenario);
    if (!mapHost.matches('[data-testid="system-map"]') && !mapHost.querySelector('[data-testid="system-map"]')) {
      setAttrs(mapHost, { 'data-testid': 'system-map', role: 'group', 'aria-label': 'System map' });
    }
    map.onSelect((id) => select(id));
    map.onActivate((id) => { select(id, { tab: true }); if (kbd) focusEl(inspect.title); });
    map.setSelected(ui.selected);
    map.update(shown);
    if (map.setReducedMotion) map.setReducedMotion(ui.reduced);
    if (map.setPaused) map.setPaused(ui.paused || finished);
    mapWrap.append(toasts.el, bannerSlot);
  }

  function destroyMap() {
    if (map) map.destroy();
    map = null;
    if (mapHost) mapHost.remove();
    mapHost = null;
  }

  function mountText() {
    textView = createTextView({ scenario, state: shown, onSelect: (id) => select(id, { tab: true }) });
    mapWrap.prepend(textView.el);
    textView.el.prepend(title);
    textView.update(shown, ui.selected);
    mapWrap.append(toasts.el, bannerSlot);
  }

  function destroyText() {
    if (textView) textView.destroy();
    textView = null;
  }

  function setMode(text) {
    if (text === ui.text) return;
    ui.text = text;
    setAttr(mapWrap, 'data-mode', text ? 'text' : 'map');
    if (text) {
      ui.paused = true;
      scheduler.stop();
      destroyMap();
      mountText();
      app.live.polite('Text mode on. The clock runs only when you act or step.');
    } else {
      destroyText();
      mountMap();
      app.live.polite('Map mode on. The clock is paused; press Resume to continue.');
    }
    paint(true);
  }

  // ------------------------------------------------------------------ painting
  function paintHeader() {
    const over = state.status !== 'running';
    mission.update(state, { paused: ui.paused, over, previewCost: ui.previewCost, budgetLeft: state.budgetLeft });
  }

  function paintToolbar() {
    toolbar.update({ paused: ui.paused, text: ui.text, over: state.status !== 'running', hintUsed: ui.hintUsed, shortcutsOn: app.settings.shortcuts });
  }

  function paintBanner() {
    const kind = state.status === 'resolved' ? 'resolved' : state.status === 'out-of-budget' ? 'over' : isGrace(state) ? 'grace' : '';
    if (kind !== bannerKind) {
      bannerKind = kind;
      clear(bannerSlot);
      bannerSlot.hidden = kind === '';
      if (kind === 'resolved') {
        bannerSlot.append(h('div', { class: 'banner', 'data-kind': 'success', testid: 'resolved-banner' }, [
          icon('ic-recv'), h('div', { class: 'banner-body' }, [h('span', { class: 'banner-kicker', text: 'Resolved' }), h('p', { text: resolvedText(state.resolvedTick) })]),
          h('button', { type: 'button', class: 'btn btn-primary', testid: 'open-debrief', text: 'Open debrief', on: { click: () => openDebrief() } }),
        ]));
      } else if (kind === 'over') {
        bannerSlot.append(h('div', { class: 'banner', 'data-kind': 'error', testid: 'out-of-budget-banner' }, [
          icon('ic-crit'), h('div', { class: 'banner-body' }, [h('span', { class: 'banner-kicker', text: 'Escalated' }), h('p', { text: OVER_TEXT })]),
          h('button', { type: 'button', class: 'btn btn-primary', testid: 'open-debrief', text: 'Open debrief', on: { click: () => openDebrief() } }),
        ]));
      } else if (kind === 'grace') {
        bannerSlot.append(h('div', { class: 'banner', 'data-kind': 'error', testid: 'out-of-budget-banner' }, [
          icon('ic-crit'), h('div', { class: 'banner-body' }, [
            h('span', { class: 'banner-kicker', text: 'Pager budget' }), h('p', { text: GRACE_TEXT }), h('span', { class: 'banner-countdown', text: '' }),
          ]),
        ]));
      }
    }
    if (kind === 'grace') setText(bannerSlot.querySelector('.banner-countdown'), graceCountdown(state.graceLeft));
  }

  function paintMetrics() {
    shown = state;
    ui.updatedAt = ui.reduced ? state.tick - (state.tick % 2) : state.tick;
    sparks.update(shown);
    inspect.update(shown, ui.selected);
    if (textView) textView.update(shown, ui.selected);
    if (map) map.update(shown);
  }

  function paintTabs() {
    const firing = firingAlerts(state).length;
    setText(tabCount, String(firing));
    setAttr(tabCount, 'data-status', firing > 0 ? 'crit' : 'ok');
    for (const [key] of TABS) {
      const active = ui.tab === key;
      const b = tabButtons.get(key);
      setAttr(b, 'aria-selected', String(active));
      setAttr(b, 'tabindex', active ? '0' : '-1');
      setAttr(panelIds[key], 'data-tab-active', String(active));
    }
  }

  function paint(forceMetrics = false) {
    const over = state.status !== 'running';
    if (forceMetrics || !ui.reduced || state.tick % 2 === 0 || over) paintMetrics();
    setAttrs(view, playAttrs(state, ui));
    paintHeader();
    paintToolbar();
    alerts.update(state);
    actions.update(state, ui.selected);
    paintBanner();
    paintTabs();
    const t = documentTitle(state, scenario);
    if (t !== lastTitle) { lastTitle = t; app.shell.setTitle(t); }
    const out = announcer.drain(state.tick);
    if (out.assertive) app.live.assertive(out.assertive);
    if (out.polite) app.live.polite(out.polite);
  }

  // ------------------------------------------------------------------ stepping
  function fail(err) {
    if (failed) return;
    failed = true;
    scheduler.destroy();
    console.error(err);
    root.replaceChildren();
    app.shell.setMission(null);
    app.shell.setNotice('test', null);
    const banner = appErrorBanner({
      text: `The simulator hit an unexpected error. Your saved progress is safe. Reload to restart this incident; the seed is ${seed}.`,
      buttonLabel: 'Reload', buttonTestid: 'app-reload', onClick: () => location.reload(),
    });
    root.append(h('div', { class: 'page' }, [h('h1', { text: scenario.title }), banner]));
    focusEl(banner);
    app.shell.setTitle('Error - incident-sim');
  }

  function afterStep(prev, next) {
    const before = new Set(prev.scenario.alerts.filter((r) => prev.alerts[r.id].firing).map((r) => r.id));
    for (const row of alertRows(next)) {
      if (row.state === 'firing' && !before.has(row.id)) {
        toasts.show(row.severity <= 2 ? 'page' : 'warn', `SEV${row.severity}: ${row.text}`);
        announcer.page(next.tick, { severity: row.severity, text: row.text });
      }
    }
    for (const id of before) {
      const a = next.alerts[id];
      if (!a.firing) {
        const rule = next.scenario.alerts.find((r) => r.id === id);
        toasts.show('clear', `Cleared: ${rule.text}`);
        announcer.cleared(rule.text);
      }
    }
    if (next.budgetLeft < prev.budgetLeft && next.actionLog.length === prev.actionLog.length) {
      announcer.say(`Pager ${next.budgetLeft} of ${total} left.`);
    }
    if (next.status !== 'running') finish();
  }

  function doStep(acts) {
    if (failed || finished || state.status !== 'running') return false;
    const prev = state;
    try {
      state = step(state, acts);
    } catch (err) {
      fail(err);
      return false;
    }
    afterStep(prev, state);
    return true;
  }

  function onTicks(n) {
    for (let i = 0; i < n && !failed; i++) {
      if (ui.paused || state.status !== 'running') break;
      doStep([]);
      if (tm.pauseAt !== null && !ui.pauseAtDone && state.tick >= tm.pauseAt) {
        ui.pauseAtDone = true;
        ui.paused = true;
        scheduler.stop();
        break;
      }
    }
    if (!failed) paint();
  }

  function stepMany(n) {
    if (state.status !== 'running') return;
    for (let i = 0; i < n; i++) if (!doStep([])) break;
    if (!failed) paint();
  }

  function syncScheduler() {
    if (!ui.paused && state.status === 'running' && !failed) { if (!scheduler.isRunning()) scheduler.start(); } else scheduler.stop();
  }

  function setPaused(p, { quiet = false } = {}) {
    if (state.status !== 'running' || p === ui.paused) return;
    ui.paused = p;
    syncScheduler();
    if (map && map.setPaused) map.setPaused(p);
    if (!quiet) app.live.polite(p ? 'Paused.' : 'Running.');
    paint();
  }

  function togglePause() { setPaused(!ui.paused); }

  // Dialogs stop the clock while open so reading is never a race.
  async function withPause(open) {
    const was = ui.paused;
    if (!was) setPaused(true, { quiet: true });
    try { await open(); } finally { if (!was) setPaused(false, { quiet: true }); }
  }

  // ------------------------------------------------------------------ selection, tabs, inspect
  function setTab(key) {
    ui.tab = key;
    paintTabs();
  }

  function select(id, { tab = false } = {}) {
    if (id !== null && !Object.hasOwn(state.m, id)) return;
    ui.selected = id;
    if (map) map.setSelected(id);
    if (tab) setTab('inspect');
    inspect.update(shown, id);
    actions.update(state, id);
    setAttr(view, 'data-selected-node', id || '');
    if (textView) textView.update(shown, id);
  }

  function focusNode(id) {
    if (textView) textView.focusNode(id);
    else { const n = nodeEl(id); if (n) n.focus(); }
  }

  function doInspect() {
    const target = ui.selected || firstNonOk(state) || nodeIds(state)[0];
    select(target, { tab: true });
    focusEl(inspect.title);
  }

  function nodePoints() {
    return Array.from(mapWrap.querySelectorAll('[data-testid="map-node"]')).map((el) => {
      const r = el.getBoundingClientRect();
      return { id: el.getAttribute('data-node'), x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
  }

  function moveSelection(dir, from) {
    const next = nearest(nodePoints(), from, dir);
    if (!next) return;
    select(next);
    focusNode(next);
  }

  function pageNodes() {
    const out = [];
    for (const r of alertRows(state)) if (r.state === 'firing' && r.node && !out.includes(r.node)) out.push(r.node);
    return out;
  }

  function stepAlert(dir) {
    const nodes = pageNodes();
    if (nodes.length === 0) { app.live.polite('No pages.'); return; }
    const i = ui.selected ? nodes.indexOf(ui.selected) : -1;
    const next = nodes[i < 0 ? (dir > 0 ? 0 : nodes.length - 1) : (i + dir + nodes.length) % nodes.length];
    select(next, { tab: true });
    focusNode(next);
  }

  // ------------------------------------------------------------------ actions
  function doAction(id) {
    if (id === 'inspect') { doInspect(); return; }
    const row = actions.rows().find((b) => b.getAttribute('data-action-id') === id);
    if (!row) return;
    if (row.getAttribute('data-state') !== 'enabled') {
      const reason = row.querySelector('[data-testid="action-reason"]').textContent;
      actions.setFeedback(reason);
      app.live.polite(reason);
      return;
    }
    const act = ACTIONS.find((a) => a.id === id);
    if (!canApply(state, id, ui.selected).ok) return;
    if (!doStep([{ id, node: ui.selected }])) return;
    scheduler.credit(1);
    if (ui.text && state.status === 'running') {
      doStep([]);
      setPausedAfterTextAction();
    }
    const text = actionFeedback(act.kind, act.name, state.budgetLeft, total);
    actions.setFeedback(text);
    announcer.say(text);
    toasts.show('note', act.kind === 'fix' ? `Applied: ${act.name}` : `Ran: ${act.name}`);
    if (act.kind === 'diagnostic') ui.tab = ui.tab === 'actions' ? 'inspect' : ui.tab;
    if (act.kind === 'diagnostic' && !ui.selected) select(firstNonOk(state) || nodeIds(state)[0]);
    paint(true);
  }

  function setPausedAfterTextAction() {
    ui.paused = true;
    scheduler.stop();
  }

  // ------------------------------------------------------------------ hint
  async function openHint() {
    if (ui.hintUsed || state.status !== 'running') return;
    const choice = await withPause(() => openDialog({
      testid: 'hint-dialog', title: 'Take one hint?', opener: toolbar.hint, focus: 'hint-cancel',
      body: h('p', { text: 'It costs score, not pager.' }),
      buttons: [{ id: 'hint-cancel', label: 'Cancel', value: 'no' }, { id: 'hint-confirm', label: 'Take hint', value: 'yes', primary: true }],
    }));
    if (choice !== 'yes') return;
    ui.hintUsed = true;
    actions.showHint(scenario.hint);
    app.live.polite(`Hint used. ${scenario.hint}`);
    paint();
  }

  // ------------------------------------------------------------------ end of run
  function runRecord() {
    const r = result(state);
    const sum = scenario.optimalSummary;
    const sc = score({
      result: r.result, timeToMitigate: r.timeToMitigate, optimalTime: sum.timeToMitigate, budgetLeft: r.budgetLeft, budget: total, optimalCost: sum.cost, harmful: r.harmful, hintUsed: ui.hintUsed,
    });
    return {
      scenario: scenario.id, seed: state.seed, scenarioHash: state.scenarioHash, result: r.result, timeToMitigate: r.timeToMitigate, budgetLeft: r.budgetLeft,
      harmful: r.harmful, hintUsed: ui.hintUsed, score: sc.score, actions: state.actionLog.map((a) => ({ t: a.t, id: a.id, node: a.node })),
    };
  }

  function finish() {
    if (finished) return;
    finished = true;
    scheduler.stop();
    if (map && map.setPaused) map.setPaused(true);
    app.saveRun(runRecord());
    announcer.say(state.status === 'resolved' ? resolvedAnnouncement(state.resolvedTick) : `${OVER_TEXT} Open the debrief.`);
  }

  function openDebrief() { app.go(`#/debrief/${scenario.id}`); }

  // ------------------------------------------------------------------ keys
  function handleKey(cmd, e, kind) {
    const m = /^jump-(\d)$/.exec(cmd);
    if (m) {
      const rows = actions.rows();
      const row = rows[Number(m[1]) - 1];
      if (row) row.focus();
      return true;
    }
    switch (cmd) {
      case 'inspect': doInspect(); return true;
      case 'focus-actions': {
        setTab('actions');
        const rows = actions.rows();
        const first = rows.find((b) => b.getAttribute('data-state') === 'enabled') || rows[0];
        if (first) first.focus();
        return true;
      }
      case 'focus-log':
        if (!ui.selected) select(firstNonOk(state) || nodeIds(state)[0], { tab: true });
        setTab('inspect');
        inspect.log.focus();
        return true;
      case 'say-status': app.live.polite(statusSummary(summaryNodes(state, scenario))); return true;
      case 'alert-prev': stepAlert(-1); return true;
      case 'alert-next': stepAlert(1); return true;
      case 'pause-toggle': if (state.status === 'running') togglePause(); return true;
      case 'step-1': stepMany(1); return true;
      case 'step-5': stepMany(5); return true;
      case 'toggle-text': setMode(!ui.text); return true;
      case 'hint': openHint(); return true;
      case 'debrief': openDebrief(); return true;
      case 'escape':
        if (ui.selected && !(e.target.closest && e.target.closest('[data-testid="map-node"]'))) { focusNode(ui.selected); return true; }
        return false;
      case 'move-left': case 'move-right': case 'move-up': case 'move-down': {
        const from = e.target.closest('[data-testid="map-node"]').getAttribute('data-node');
        moveSelection(cmd.slice(5), from);
        return true;
      }
      case 'map-first': case 'map-last': {
        const order = readingOrder(nodePoints());
        const id = cmd === 'map-first' ? order[0] : order[order.length - 1];
        if (id) { select(id); focusNode(id); }
        return true;
      }
      case 'action-prev': case 'action-next': {
        const rows = actions.rows();
        const i = rows.indexOf(e.target.closest('[data-testid="action-item"]'));
        const to = rows[Math.max(0, Math.min(rows.length - 1, i + (cmd === 'action-next' ? 1 : -1)))];
        if (to) to.focus();
        return true;
      }
      default: return false;
    }
  }

  // Fits the grid under the header and any notice banner (desktop only; narrower layouts scroll).
  function fit() {
    if (window.innerWidth < 1024) { view.style.removeProperty('block-size'); return; }
    view.style.setProperty('block-size', `${Math.max(640, window.innerHeight - view.getBoundingClientRect().top - window.scrollY)}px`);
  }
  window.addEventListener('resize', fit);

  // ------------------------------------------------------------------ boot
  const offReduced = app.reduced.subscribe((v) => {
    ui.reduced = v;
    if (map && map.setReducedMotion) map.setReducedMotion(v);
    paint(true);
  });
  setAttr(mapWrap, 'data-mode', 'map');
  mountMap();
  setTab('alerts');
  paint(true);
  syncScheduler();
  fit();
  const screen = {
    handleKey,
    context: () => ({ view: 'play', paused: ui.paused, text: ui.text, over: state.status !== 'running' }),
    destroy() {
      scheduler.destroy();
      window.removeEventListener('resize', fit);
      document.removeEventListener('keydown', onKbd, true);
      document.removeEventListener('pointerdown', onPtr, true);
      offReduced();
      alerts.destroy();
      toasts.destroy();
      if (map) map.destroy();
      app.shell.setMission(null);
      app.shell.setNotice('test', null);
    },
  };
  return screen;
}

function mountFailure(root, app, seed, err) {
  console.error(err);
  const banner = appErrorBanner({
    text: `The simulator hit an unexpected error. Your saved progress is safe. Reload to restart this incident; the seed is ${seed}.`,
    buttonLabel: 'Reload', buttonTestid: 'app-reload', onClick: () => location.reload(),
  });
  root.append(h('div', { class: 'page' }, [h('h1', { text: 'Something broke' }), banner]));
  return { destroy() {}, handleKey: () => false, context: () => ({ view: 'other' }) };
}

