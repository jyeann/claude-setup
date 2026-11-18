// Sidebar list (notes or search results) and the simple main-pane screens.
import { h, clear } from './dom.js';
import { noteUrl } from './router.js';
import { focusEl } from './live.js';

const pad = (n) => String(n).padStart(2, '0');

// "2026-11-18 14:05" in local time. Bad input gives an empty string rather than "NaN".
export function formatModified(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function truncateQuery(q, max = 40) {
  const chars = [...q];
  return chars.length > max ? `${chars.slice(0, max).join('')}...` : q;
}

// Owns the sidebar list region. Modes: loading, notes, results, message.
export function createListView(doc, region) {
  let notes = [];
  let current = null;
  let mode = 'loading';

  const itemLink = (title) => h(doc, 'a', { href: noteUrl(title), title, text: title });

  function renderNotes() {
    clear(region);
    mode = 'notes';
    if (notes.length === 0) {
      region.appendChild(h(doc, 'p', { testid: 'note-list-empty', class: 'list-empty', text: 'No notes yet.' }));
      return;
    }
    const ul = h(doc, 'ul', { testid: 'note-list', class: 'note-list' });
    for (const n of notes) {
      const li = h(doc, 'li', { testid: 'note-list-item', 'data-title': n.title, class: 'note-item' }, [
        itemLink(n.title),
        h(doc, 'span', { class: 'note-meta', text: `Modified ${formatModified(n.modified)}` }),
      ]);
      if (current !== null && n.title === current) li.setAttribute('aria-current', 'page');
      ul.appendChild(li);
    }
    region.appendChild(ul);
  }

  return {
    get mode() { return mode; },
    loading() {
      clear(region);
      mode = 'loading';
      region.appendChild(h(doc, 'p', { testid: 'list-loading', role: 'status', class: 'list-empty', text: 'Loading notes...' }));
    },
    showNotes(next, currentTitle) {
      if (next) notes = next;
      if (currentTitle !== undefined) current = currentTitle;
      renderNotes();
    },
    // Remember the data without touching what is on screen (a search may be showing).
    setData(next) {
      notes = next;
    },
    setCurrent(title) {
      current = title;
      if (mode !== 'notes') return;
      for (const li of region.querySelectorAll('[data-testid="note-list-item"]')) {
        if (title !== null && li.getAttribute('data-title') === title) li.setAttribute('aria-current', 'page');
        else li.removeAttribute('aria-current');
      }
    },
    // items: [{title, snippetNode}]
    showResults(items) {
      clear(region);
      mode = 'results';
      const ul = h(doc, 'ul', { testid: 'search-results', class: 'note-list' });
      for (const it of items) {
        ul.appendChild(h(doc, 'li', { testid: 'search-result', 'data-title': it.title, class: 'note-item' }, [
          itemLink(it.title),
          h(doc, 'p', { testid: 'search-snippet', class: 'snippet' }, it.snippet),
        ]));
      }
      region.appendChild(ul);
    },
    showMessage(testid, text) {
      clear(region);
      mode = 'message';
      region.appendChild(h(doc, 'p', { testid, class: 'list-empty', text }));
    },
    firstLink: () => region.querySelector('a'),
    linkFor(title) {
      const li = [...region.querySelectorAll('[data-testid="note-list-item"]')].find((el) => el.getAttribute('data-title') === title);
      return li ? li.querySelector('a') : null;
    },
    get notes() { return notes; },
  };
}

export function backLink(doc) {
  return h(doc, 'a', { href: '/', testid: 'back-to-list', class: 'back-link', text: 'Notes' });
}

export function buildHome(doc, { empty, onCreate }) {
  if (empty) {
    return h(doc, 'section', { testid: 'empty-vault', class: 'screen' }, [
      h(doc, 'h1', { tabindex: '-1', text: 'Your vault is empty' }),
      h(doc, 'p', { text: 'Notes are plain .md files in the vault folder.' }),
      h(doc, 'button', { type: 'button', testid: 'empty-create', class: 'btn btn-primary', text: 'Create your first note', on: { click: (ev) => onCreate(ev.currentTarget) } }),
    ]);
  }
  return h(doc, 'section', { testid: 'no-selection', class: 'screen' }, [
    h(doc, 'h1', { tabindex: '-1', text: 'Wiki' }),
    h(doc, 'p', { text: 'Choose a note from the list, or create a new one.' }),
  ]);
}

export function buildNotFound(doc) {
  return h(doc, 'section', { testid: 'not-found', class: 'screen' }, [
    h(doc, 'h1', { testid: 'not-found-title', tabindex: '-1', text: 'Note not found' }),
    h(doc, 'p', { text: 'There is no note at this address. It may have been renamed or deleted.' }),
    h(doc, 'a', { href: '/', testid: 'not-found-back', class: 'btn', text: 'Back to all notes' }),
  ]);
}

export function buildAppError(doc, onRetry) {
  const message = h(doc, 'p', { tabindex: '-1', class: 'app-error-text', text: 'Could not reach the wiki server. Check that it is still running, then try again.' });
  const el = h(doc, 'div', { testid: 'app-error', class: 'screen' }, [
    message,
    h(doc, 'button', { type: 'button', testid: 'app-retry', class: 'btn btn-primary', text: 'Try again', on: { click: onRetry } }),
  ]);
  return { el, focus: () => focusEl(message) };
}

export function buildLoading(doc) {
  return h(doc, 'p', { role: 'status', class: 'loading', text: 'Loading...' });
}
