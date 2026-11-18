// Search box: 120 ms debounce, AbortController per request, marks built from server ranges as text nodes.
import { h } from './dom.js';
import { truncateQuery } from './notes.js';
import { isSearchShortcut } from './live.js';

export const DEBOUNCE_MS = 120;
export const SLOW_MS = 150;
export const SEARCH_TOO_LONG = 'Search text can be at most 200 characters.';
export const SEARCH_FAILED = 'Search failed. Check that the server is running, then try again.';

export const countText = (n) => (n === 0 ? 'No notes match' : n === 1 ? '1 note matches' : `${n} notes match`);

// Split a snippet into [{text, mark}] pieces. Ranges that are out of order, overlap or fall outside are skipped.
export function segmentSnippet(snippet, ranges) {
  const pieces = [];
  let at = 0;
  for (const range of ranges || []) {
    const [start, end] = Array.isArray(range) ? range : [];
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < at || end <= start || end > snippet.length) continue;
    if (start > at) pieces.push({ text: snippet.slice(at, start), mark: false });
    pieces.push({ text: snippet.slice(start, end), mark: true });
    at = end;
  }
  if (at < snippet.length) pieces.push({ text: snippet.slice(at), mark: false });
  return pieces;
}

export function snippetNodes(doc, snippet, ranges) {
  const out = [];
  for (const piece of segmentSnippet(snippet, ranges)) {
    if (piece.mark) out.push(h(doc, 'mark', { text: piece.text }));
    else out.push(doc.createTextNode(piece.text));
  }
  return out;
}

export function createSearch({ doc, win, api, list, input, box, statusEl, onClear = () => {} }) {
  let timer = null;
  let slowTimer = null;
  let controller = null;
  let seq = 0;
  let clearBtn = null;

  const query = () => input.value.trim();

  function setStatus(text, visible) {
    if (statusEl.textContent !== text) statusEl.textContent = text; // same text again is not re-announced
    if (visible) statusEl.removeAttribute('class');
    else statusEl.setAttribute('class', 'sr-only');
  }

  function updateClear() {
    const has = input.value !== '';
    if (has && !clearBtn) {
      clearBtn = h(doc, 'button', { type: 'button', testid: 'search-clear', class: 'search-clear', 'aria-label': 'Clear search', text: '×', on: { click: clear } });
      box.appendChild(clearBtn);
    } else if (!has && clearBtn) {
      box.removeChild(clearBtn);
      clearBtn = null;
    }
  }

  function cancel() {
    seq += 1;
    if (timer !== null) win.clearTimeout(timer);
    if (slowTimer !== null) win.clearTimeout(slowTimer);
    timer = null;
    slowTimer = null;
    if (controller) controller.abort();
    controller = null;
  }

  async function run(q, quiet = false) {
    cancel();
    const mine = seq;
    controller = new win.AbortController();
    if (!quiet) slowTimer = win.setTimeout(() => setStatus('Searching...', true), SLOW_MS);
    try {
      const res = await api.search(q, controller.signal);
      if (mine !== seq) return;
      win.clearTimeout(slowTimer);
      slowTimer = null;
      if (res.results.length === 0) {
        list.showMessage('search-empty', `No notes match "${truncateQuery(q)}"`);
      } else {
        list.showResults(res.results.map((r) => ({ title: r.title, snippet: snippetNodes(doc, r.snippet, r.ranges) })));
      }
      setStatus(countText(res.results.length), false);
    } catch (e) {
      if (mine !== seq || (e && e.name === 'AbortError')) return;
      win.clearTimeout(slowTimer);
      slowTimer = null;
      const message = e && e.status === 400 ? SEARCH_TOO_LONG : SEARCH_FAILED;
      list.showMessage('search-empty', message);
      setStatus(message, false);
    }
  }

  function showList() {
    cancel();
    setStatus('', false);
    list.showNotes();
    onClear();
  }

  function onInput() {
    updateClear();
    const q = query();
    if (q === '') {
      showList();
      return;
    }
    cancel();
    timer = win.setTimeout(() => run(q), DEBOUNCE_MS);
  }

  function clear() {
    input.value = '';
    updateClear();
    showList();
    input.focus();
  }

  input.addEventListener('input', onInput);
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && input.value !== '') {
      ev.preventDefault();
      clear();
    }
  });
  doc.addEventListener('keydown', (ev) => {
    if (!isSearchShortcut(ev) || doc.querySelector('dialog[open]')) return;
    ev.preventDefault();
    input.focus();
    if (input.select) input.select();
  });

  return {
    // Re-run after notes changed while a query is showing.
    refresh() {
      if (query() !== '') run(query(), true);
    },
    active: () => query() !== '',
    clear,
  };
}
