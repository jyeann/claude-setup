// Boot, app object and the hash router.
import { parseSafe } from '../core/safe-json.js';
import { validate } from '../engine/validate.js';
import { resolve } from '../core/keys.js';
import { parseRoute } from '../core/routes.js';
import { parse as parseTestMode, bannerText } from '../core/testmode.js';
import { loadSettings, saveSettings } from '../core/settings.js';
import { daily } from '../core/daily.js';
import {
  loadProgress, saveProgress, clearProgress,
} from '../core/store.js';
import {
  addRun, emptyProgress, lastRun,
} from '../core/progress.js';
import { fingerprint } from '../engine/fingerprint.js';
import {
  h, focusEl, clear, createShell, appErrorBanner,
} from './shell.js';
import { store } from './storage.js';
import { createLive } from './live.js';
import { openKeysDialog } from './dialogs.js';
import { mountBoard, mountNotFound } from './board.js';
import { mountAbout } from './about.js';
import { mountData } from './data-page.js';
import { mountPlay } from './play.js';
import { createDebrief } from './debrief.js';

// ---------------------------------------------------------------- scenarios (fetch and client re-validation)
// Fetch and re-validate scenarios. The server already validated them; the client checks again with the same shared validator.

export const LOAD_TIMEOUT_MS = 8000;

async function fetchText(url, signal) {
  const res = await fetch(url, { signal, cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

export async function loadIndex(signal) {
  const text = await fetchText('/scenarios/index.json', signal);
  const parsed = parseSafe(text, { maxBytes: 262144, maxDepth: 12 });
  if (!parsed.ok) throw new Error(parsed.reason);
  const v = parsed.value;
  const valid = Array.isArray(v.valid) ? v.valid.filter((x) => typeof x === 'string') : [];
  const errors = Array.isArray(v.errors)
    ? v.errors.filter((e) => e && typeof e === 'object').map((e) => ({ file: String(e.file), field: String(e.field), message: String(e.message) }))
    : [];
  return { valid, errors };
}

export async function loadScenario(id, signal) {
  const file = `${id}.json`;
  try {
    const text = await fetchText(`/scenarios/${id}.json`, signal);
    const parsed = parseSafe(text, { maxBytes: 65536, maxDepth: 12 });
    if (!parsed.ok) return { ok: false, errors: [{ file, field: '(file)', message: `${parsed.reason} Expected: a valid scenario file.` }] };
    const res = validate(parsed.value, file);
    return res.ok ? { ok: true, scenario: res.scenario } : { ok: false, errors: res.errors };
  } catch (err) {
    if (err && err.name === 'AbortError') throw err;
    return { ok: false, errors: [{ file, field: '(file)', message: 'could not be loaded. Expected: a readable scenario file.' }] };
  }
}

// -> { scenarios: Map(id -> scenario), errors: [{file, field, message}] }. Throws when the index cannot be read.
export async function loadAll() {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), LOAD_TIMEOUT_MS);
  try {
    const index = await loadIndex(ctl.signal);
    const results = await Promise.all(index.valid.map((id) => loadScenario(id, ctl.signal)));
    const scenarios = new Map();
    const errors = [...index.errors];
    results.forEach((r, i) => {
      if (r.ok) scenarios.set(index.valid[i], r.scenario);
      else errors.push(...r.errors);
    });
    return { scenarios, errors };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------- keyboard
// One document-level keydown listener. core/keys.js decides what a key means; this file only describes the target and dispatches.

export function targetKindOf(target) {
  if (!(target instanceof Element)) return 'other';
  if (target.closest('dialog')) return 'dialog';
  if (target.matches('input[type="range"]')) return 'slider';
  if (target.matches('input, textarea, select, [contenteditable="true"]')) return 'text';
  if (target.closest('[data-testid="map-node"]')) return 'map-node';
  if (target.closest('[data-testid="action-item"]')) return 'action';
  if (target.closest('button, a[href], summary')) return 'button';
  return 'other';
}

// getContext() -> { view, paused, text, over }. handle(command, event, targetKind) -> true when it did something.
export function attachKeys({ getContext, shortcutsOn, handle }) {
  const onKey = (e) => {
    if (e.defaultPrevented || e.isComposing) return;
    const targetKind = targetKindOf(e.target);
    const cmd = resolve({
      key: e.key, ctrl: e.ctrlKey, alt: e.altKey, meta: e.metaKey, targetKind, context: getContext(), shortcutsOn: shortcutsOn(),
    });
    if (!cmd) return;
    if (handle(cmd, e, targetKind)) e.preventDefault();
  };
  document.addEventListener('keydown', onKey);
  return () => document.removeEventListener('keydown', onKey);
}

const STORAGE_WARNING = 'This browser is blocking storage, so progress will not be saved. You can still play and use Export on the Your data page.';
const CORRUPT_NOTICE = 'Saved progress could not be read; new results will replace it.';

function localDate() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function reducedMotion() {
  const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
  return {
    get value() { return mq.matches; },
    subscribe(fn) {
      const on = () => fn(mq.matches);
      mq.addEventListener('change', on);
      return () => mq.removeEventListener('change', on);
    },
  };
}

async function readTestFlag() {
  try {
    const res = await fetch('/test-mode.json', { cache: 'no-store' });
    if (!res.ok) return false;
    const body = await res.json();
    return body !== null && typeof body === 'object' && body.testMode === true;
  } catch {
    return false;
  }
}

async function main() {
  const shell = createShell();
  const live = createLive();
  const main = shell.main;

  // ---- loading skeleton after 300 ms
  const skeleton = h('div', { class: 'page' }, [
    h('h1', { class: 'sr-only', text: 'Incident Simulator' }),
    h('div', { class: 'skeleton', role: 'status', testid: 'boot-loading' }, [h('span', { class: 'sk-node' }), h('span', { class: 'sk-node' }), h('span', { class: 'sk-node' }), h('p', { text: 'Plugging in the pager...' })]),
  ]);
  const skeletonTimer = setTimeout(() => { clear(main); main.append(skeleton); }, 300);

  const flag = await readTestFlag();
  const tm = parseTestMode(flag, window.location.search);
  const settings = loadSettings(store);
  const storageOk = store.probe();
  const loaded = loadProgress(store);

  const app = {
    shell, live, tm, settings, scenarios: new Map(), errors: [], progress: loaded.progress, progressStatus: loaded.status,
    testBannerText: bannerText(tm), reduced: reducedMotion(),
  };
  app.daily = () => {
    try { return daily(localDate(), Array.from(app.scenarios.keys())); } catch { return null; }
  };
  app.go = (hash, { replace = false } = {}) => {
    if (replace) { history.replaceState(null, '', `${location.pathname}${location.search}${hash}`); render(); } else location.hash = hash;
  };
  app.setShortcuts = (on) => {
    app.settings = { ...app.settings, shortcuts: on };
    saveSettings(store, app.settings);
    live.polite(on ? 'Shortcuts on.' : 'Shortcuts off.');
  };
  const warn = () => {
    if (!storageOk || app.progressStatus === 'blocked') shell.setNotice('storage', { testid: 'storage-warning', text: STORAGE_WARNING, kicker: 'Note' });
    else if (app.progressStatus === 'corrupt') shell.setNotice('storage', { testid: 'storage-warning', text: CORRUPT_NOTICE, kicker: 'Note' });
    else shell.setNotice('storage', null);
  };
  app.saveRun = (record) => {
    app.progress = addRun(app.progress, record);
    const r = saveProgress(store, app.progress);
    if (r.ok && app.progressStatus === 'corrupt') app.progressStatus = 'ok';
    if (!r.ok) app.progressStatus = 'blocked';
    warn();
    return r.ok;
  };
  app.replaceProgress = (progress) => {
    app.progress = progress;
    const r = saveProgress(store, progress);
    if (r.ok) app.progressStatus = 'ok';
    else app.progressStatus = 'blocked';
    warn();
    return r.ok;
  };
  app.clearProgress = () => {
    app.progress = emptyProgress();
    clearProgress(store);
    app.progressStatus = 'empty';
    warn();
  };
  warn();

  // ---- scenarios, with the error state and retry
  async function loadScenarios() {
    try {
      const { scenarios, errors } = await loadAll();
      app.scenarios = scenarios;
      app.errors = errors;
      return true;
    } catch {
      return false;
    }
  }

  function showLoadError() {
    clearTimeout(skeletonTimer);
    clear(main);
    const banner = appErrorBanner({
      text: 'Could not load the incidents. Check that the server is still running (node src/server.js), then try again.',
      buttonLabel: 'Try again', buttonTestid: 'app-retry',
      onClick: async () => {
        clear(main);
        main.append(skeleton);
        if (await loadScenarios()) { start(); } else showLoadError();
      },
    });
    main.append(h('div', { class: 'page' }, [h('h1', { text: 'Incident Simulator' }), banner]));
    focusEl(banner);
    shell.setTitle('Error - incident-sim');
  }

  // ---- router
  let screen = null;
  let routeKey = '';
  let firstRender = true;

  function render({ autostart = false } = {}) {
    const route = parseRoute(location.hash);
    if (screen && screen.destroy) screen.destroy();
    screen = null;
    shell.setMission(null);
    shell.setNotice('test', tm.active ? { banner: true, testid: 'test-banner', text: app.testBannerText } : null);
    const root = shell.reset();
    shell.setNav(route.name === 'board' || route.name === 'first' ? 'board' : route.name === 'data' ? 'data' : route.name === 'about' ? 'about' : '');
    const focus = !autostart && !firstRender;
    firstRender = false;

    if (route.name === 'first') {
      const hasRuns = app.progress.runs.length > 0 || app.progressStatus === 'ok' || app.progressStatus === 'corrupt';
      if (!hasRuns && app.scenarios.has('cache-stampede')) {
        const d = app.daily();
        const seed = d ? d.seed : app.scenarios.get('cache-stampede').seed;
        history.replaceState(null, '', `${location.pathname}${location.search}#/play/cache-stampede?seed=${seed}`);
        render({ autostart: true });
        return;
      }
      history.replaceState(null, '', `${location.pathname}${location.search}#/incidents`);
      render({ autostart: !focus });
      return;
    }
    if (route.name === 'board') {
      screen = mountBoard(root, app);
    } else if (route.name === 'data') {
      screen = mountData(root, app);
    } else if (route.name === 'about') {
      screen = mountAbout(root, app);
    } else if (route.name === 'play') {
      const sc = app.scenarios.get(route.id);
      if (route.seedError) {
        history.replaceState(null, '', `${location.pathname}${location.search}#/incidents`);
        clear(root);
        screen = mountBoard(root, app, { seedError: route.seedError });
      } else if (!sc) {
        screen = mountNotFound(root, app);
      } else {
        screen = mountPlay(root, app, { scenario: sc, seed: route.seed === undefined ? sc.seed : route.seed });
      }
    } else if (route.name === 'debrief') {
      const sc = app.scenarios.get(route.id);
      const run = sc ? lastRun(app.progress, route.id) : null;
      if (!sc || !run) {
        screen = mountNotFound(root, app);
      } else {
        screen = mountDebriefScreen(root, sc, run);
      }
    } else {
      screen = mountNotFound(root, app);
    }
    if (focus && shell.hasHeading()) shell.focusHeading();
    routeKey = location.hash;
  }

  function mountDebriefScreen(root, sc, run) {
    const d = app.daily();
    const isDaily = d !== null && d.scenarioId === sc.id && d.seed === run.seed;
    const full = { ...run, fingerprint: fingerprint({ scenarioId: sc.id, scenarioHash: run.scenarioHash, seed: run.seed, actionLog: run.actions, hintUsed: run.hintUsed }) };
    app.shell.setTitle(`Debrief - incident-sim`);
    const inner = createDebrief(root, {
      scenario: sc, run: full, daily: isDaily ? d.number : null,
      onRetry: () => app.go(`#/play/${sc.id}?seed=${run.seed}`),
      onNext: () => app.go('#/incidents'),
      onBoard: () => app.go('#/incidents'),
    });
    return { destroy() { inner.destroy(); }, handleKey: () => false, context: () => ({ view: 'debrief' }) };
  }

  function start() {
    clearTimeout(skeletonTimer);
    window.addEventListener('hashchange', () => { if (location.hash !== routeKey) render(); });
    render();
  }

  // ---- keys
  attachKeys({
    getContext: () => (screen && screen.context ? screen.context() : { view: 'other' }),
    shortcutsOn: () => app.settings.shortcuts,
    handle(cmd, e) {
      if (cmd === 'help') { openKeysDialog(document.activeElement); return true; }
      return screen && screen.handleKey ? Boolean(screen.handleKey(cmd, e)) : false;
    },
  });

  if (await loadScenarios()) start();
  else showLoadError();
}

main();
