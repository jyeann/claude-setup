// Client routes: pure URL matching plus a small history router with the unsaved-changes guard.
import { normalizeTitle, validateTitle } from './titles.js';

export const noteUrl = (title) => `/n/${encodeURIComponent(title)}`;
export const graphUrl = (note) => (note ? `/graph?note=${encodeURIComponent(note)}` : '/graph');

const NOT_FOUND = Object.freeze({ name: 'notfound' });

// Decode the title once; anything unsafe, malformed or with extra segments is "not found".
export function parseLocation(pathname, search = '') {
  if (pathname === '/') return { name: 'home' };
  if (pathname === '/graph') {
    const raw = new URLSearchParams(search).get('note');
    const v = raw === null ? null : validateTitle(raw);
    return { name: 'graph', note: v && v.ok ? v.title : null };
  }
  if (pathname.startsWith('/n/')) {
    const segment = pathname.slice(3);
    if (segment === '' || segment.includes('/')) return NOT_FOUND;
    let decoded;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      return NOT_FOUND;
    }
    const v = validateTitle(decoded);
    return v.ok ? { name: 'note', title: normalizeTitle(decoded) } : NOT_FOUND;
  }
  return NOT_FOUND;
}

export function splitUrl(url) {
  const q = url.indexOf('?');
  return q === -1 ? { pathname: url, search: '' } : { pathname: url.slice(0, q), search: url.slice(q) };
}

// Is this href one the router should handle (same-origin absolute path)?
export function isInternalHref(href) {
  return typeof href === 'string' && href.startsWith('/') && !href.startsWith('//');
}

export function documentTitle(route, noteTitle) {
  if (route.name === 'note') return `${noteTitle ?? route.title} - Wiki`;
  if (route.name === 'graph') return 'Graph - Wiki';
  if (route.name === 'notfound') return 'Note not found - Wiki';
  return 'Wiki';
}

export function createRouter({ win, doc, onRoute, isDirty = () => false, confirmLeave = async () => true }) {
  const here = () => win.location.pathname + win.location.search;
  let current = '';

  async function dispatch(url, meta) {
    current = url;
    const { pathname, search } = splitUrl(url);
    await onRoute(parseLocation(pathname, search), meta);
  }

  async function navigate(url, { replace = false, force = false, meta = {} } = {}) {
    const same = url === here();
    if (!force && isDirty()) {
      if (same) return false;
      if (!(await confirmLeave())) return false;
    }
    if (replace || same) win.history.replaceState({}, '', url);
    else win.history.pushState({}, '', url);
    await dispatch(url, meta);
    return true;
  }

  function onClick(ev) {
    if (ev.defaultPrevented || ev.button > 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
    const a = ev.target && ev.target.closest ? ev.target.closest('a') : null;
    if (!a || a.getAttribute('target')) return;
    const href = a.getAttribute('href');
    if (!isInternalHref(href)) return;
    ev.preventDefault();
    navigate(href);
  }

  async function onPopState() {
    const target = here();
    if (target === current) return;
    if (isDirty()) {
      win.history.pushState({}, '', current);
      if (!(await confirmLeave())) return;
      win.history.replaceState({}, '', target);
    }
    await dispatch(target, {});
  }

  function onBeforeUnload(ev) {
    if (!isDirty()) return undefined;
    ev.preventDefault();
    ev.returnValue = '';
    return '';
  }

  function start() {
    doc.addEventListener('click', onClick);
    win.addEventListener('popstate', onPopState);
    win.addEventListener('beforeunload', onBeforeUnload);
    return dispatch(here(), { initial: true });
  }

  return { start, navigate, here, parse: () => parseLocation(win.location.pathname, win.location.search) };
}
