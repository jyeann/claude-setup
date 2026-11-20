// Entry point: wires the shell in index.html to the router, the list, search, dialogs and the screens.
import { createApi } from './api.js';
import { createRouter, noteUrl, graphUrl, documentTitle } from './router.js';
import { createLive, focusEl, shortcutLabel } from './live.js';
import { createDialogs } from './dialogs.js';
import { createListView, buildHome, buildNotFound, buildAppError, buildLoading } from './notes.js';
import { buildNoteView } from './note-view.js';
import { createSearch } from './search.js';
import { createGraphView } from './graph.js';
import { clear, plural } from './dom.js';
import { titleKey } from './titles.js';

export function renamedMessage(result) {
  const failed = result.failed || [];
  if (failed.length > 0) {
    return `Renamed, but ${plural(failed.length, 'note', 'notes')} could not be updated: ${failed.map((f) => f.title).join(', ')}. Fix those links by hand.`;
  }
  const n = result.updated.length;
  return n === 0 ? `Renamed to ${result.title}.` : `Renamed to ${result.title}. Updated links in ${plural(n, 'note', 'notes')}.`;
}

export function start(win) {
  const doc = win.document;
  const q = (id) => doc.querySelector(`[data-testid="${id}"]`);
  const mainEl = doc.querySelector('#main');
  const appEl = doc.querySelector('.app');
  const graphLink = q('graph-link');
  const searchInput = q('search-input');

  const api = createApi((...args) => win.fetch(...args));
  const live = createLive({
    statusEl: q('status-live'),
    alertEl: q('alert-live'),
    setTimer: (fn, ms) => win.setTimeout(fn, ms),
    clearTimer: (id) => win.clearTimeout(id),
  });
  const dialogs = createDialogs({ doc, api });
  const list = createListView(doc, doc.querySelector('#list-region'));
  const state = { notes: [], keys: new Map(), view: null, seq: 0, lastOpen: null };
  let router = null;

  searchInput.setAttribute('placeholder', `Search notes (${shortcutLabel(win.navigator && win.navigator.platform)})`);

  const resolve = (target) => state.keys.get(titleKey(target)) || null;
  const setTitle = (base, dirty) => { doc.title = dirty ? `* ${base}` : base; };
  const mount = (el) => { clear(mainEl); mainEl.appendChild(el); };
  const sideHeading = doc.querySelector('[data-testid="sidebar-heading"]');
  // On a phone the home route hides <main>; focus and errors then have to live in the sidebar.
  const mainHidden = () => {
    try {
      return win.getComputedStyle(mainEl).display === 'none';
    } catch {
      return false;
    }
  };
  const shouldFocus = (meta) => !meta.initial || Boolean(meta.retry);

  async function loadList() {
    state.notes = await api.listNotes();
    state.keys = new Map(state.notes.map((n) => [titleKey(n.title), n.title]));
    list.setData(state.notes);
  }

  const search = createSearch({ doc, win, api, list, input: searchInput, box: doc.querySelector('.search-box'), statusEl: q('search-status') });

  async function refreshList() {
    try {
      await loadList();
    } catch {
      return;
    }
    if (search.active()) search.refresh();
    else list.showNotes();
  }

  function disposeView() {
    if (!state.view) return;
    if (state.view.title) state.lastOpen = state.view.title();
    state.view.destroy();
    state.view = null;
  }

  function showAppError(retry) {
    const err = buildAppError(doc, retry);
    mount(err.el);
    err.focus();
    live.alert('Could not reach the wiki server. Check that it is still running, then try again.');
  }

  async function openNewNote(opener) {
    const result = await dialogs.newNote({ opener });
    if (!result) return;
    live.announce(`Created ${result.title}`);
    await router.navigate(noteUrl(result.title), { meta: { focusEditor: true, created: true } });
  }

  async function onRenamed(result) {
    const message = renamedMessage(result);
    if ((result.failed || []).length > 0) live.alert(message);
    live.announce(message);
    await router.navigate(noteUrl(result.title), { replace: true, force: true });
  }

  async function onDeleted(title, gone = false) {
    live.announce(gone ? `"${title}" was already deleted` : `Deleted "${title}"`);
    await router.navigate('/', { force: true, meta: { focus: 'list-first' } });
  }

  const noteCtx = {
    doc, win, api, live, dialogs,
    get router() { return router; },
    resolve,
    setTitle,
    onSaved: refreshList,
    onRenamed,
    onDeleted,
  };

  async function showNote(route, meta, seq) {
    setTitle(documentTitle(route), false);
    mount(buildLoading(doc));
    let data;
    try {
      data = await api.getNote(route.title);
    } catch (e) {
      if (seq !== state.seq) return;
      if (e.status === 404) {
        showNotFound(meta);
        return;
      }
      showAppError(() => router.navigate(noteUrl(route.title), { force: true, replace: true }));
      return;
    }
    if (seq !== state.seq) return;
    const view = buildNoteView(noteCtx, data, meta);
    state.view = view;
    mount(view.el);
    if (data.title !== route.title) win.history.replaceState({}, '', noteUrl(data.title));
    graphLink.setAttribute('href', graphUrl(data.title));
    list.setCurrent(data.title);
    if (!search.active()) list.showNotes();
    view.loadBacklinks();
    if (meta.focusEditor) view.focusEditor();
    else if (shouldFocus(meta)) focusEl(view.heading);
  }

  function showNotFound(meta) {
    setTitle(documentTitle({ name: 'notfound' }), false);
    const el = buildNotFound(doc);
    mount(el);
    list.setCurrent(null);
    if (shouldFocus(meta)) focusEl(el.querySelector('h1'));
  }

  function showHome(meta) {
    setTitle('Wiki', false);
    const empty = state.notes.length === 0;
    const el = buildHome(doc, { empty, onCreate: openNewNote });
    mount(el);
    list.setCurrent(null);
    if (!search.active()) list.showNotes();
    if (!shouldFocus(meta)) return;
    const hidden = mainHidden();
    if (meta.focus === 'list-first') {
      focusEl(empty && !hidden ? q('empty-create') : list.firstLink() || sideHeading);
    } else if (state.lastOpen && list.linkFor(state.lastOpen)) {
      focusEl(list.linkFor(state.lastOpen));
    } else {
      focusEl(hidden ? sideHeading : el.querySelector('h1'));
    }
    state.lastOpen = null;
  }

  function showGraph(route, meta) {
    setTitle(documentTitle(route), false);
    const gv = createGraphView({ doc, win, api, router }, route);
    state.view = { destroy: gv.destroy, isDirty: () => false, confirmLeave: async () => true };
    mount(gv.el);
    list.setCurrent(null);
    if (!search.active()) list.showNotes();
    if (shouldFocus(meta)) focusEl(gv.heading);
    gv.load();
  }

  async function onRoute(route, meta = {}) {
    state.seq += 1;
    const seq = state.seq;
    disposeView();
    appEl.setAttribute('data-route', route.name);
    graphLink.setAttribute('href', graphUrl(route.name === 'graph' ? route.note : null));
    if (meta.initial) {
      list.loading();
      clear(mainEl);
    }
    try {
      await loadList();
    } catch {
      if (seq !== state.seq) return;
      const retry = () => router.navigate(win.location.pathname + win.location.search, { force: true, replace: true, meta: { initial: meta.initial, retry: true } });
      if (mainHidden()) {
        const err = buildAppError(doc, retry);
        list.showElement(err.el);
        err.focus();
        live.alert('Could not reach the wiki server. Check that it is still running, then try again.');
      } else {
        list.showMessage('list-error', 'The list could not be loaded.');
        showAppError(retry);
      }
      return;
    }
    if (seq !== state.seq) return;
    list.setData(state.notes);
    if (route.name === 'home') showHome(meta);
    else if (route.name === 'graph') showGraph(route, meta);
    else if (route.name === 'note') await showNote(route, meta, seq);
    else showNotFound(meta);
    if (seq === state.seq && search.active()) search.refresh();
  }

  router = createRouter({
    win,
    doc,
    onRoute,
    isDirty: () => !!state.view && state.view.isDirty(),
    confirmLeave: () => (state.view && state.view.confirmLeave ? state.view.confirmLeave() : Promise.resolve(true)),
  });

  q('new-note-button').addEventListener('click', (ev) => openNewNote(ev.currentTarget));
  q('skip-link').addEventListener('click', (ev) => {
    ev.preventDefault();
    focusEl(mainEl);
  });

  router.start();
  return { router, state, api, list, search, dialogs };
}

// In a browser the module starts itself; in Node (unit tests) importing it does nothing.
if (typeof document !== 'undefined' && typeof window !== 'undefined') start(window);
