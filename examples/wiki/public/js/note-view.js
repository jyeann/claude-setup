// The open note: header, editor, live preview, banners, backlinks. Save logic is driven by note-model.js.
import { h, clear } from './dom.js';
import { createNoteModel, saveErrorMessage, CONFLICT_MESSAGE } from './note-model.js';
import { renderMarkdown } from './markdown.js';
import { backLink } from './notes.js';
import { noteUrl } from './router.js';
import { focusEl, isSaveShortcut } from './live.js';

const COPY_FAILED = 'Could not copy. Select the text in the editor and copy it by hand.';
const BACKLINKS_FAILED = 'Could not load backlinks.';

export function backlinksHeading(count) {
  return `Backlinks (${count})`;
}

export function buildBacklinkItems(doc, backlinks) {
  return backlinks.map((b) => h(doc, 'li', { testid: 'backlink-item', 'data-title': b.title, class: 'backlink' }, [
    h(doc, 'a', { href: noteUrl(b.title), text: b.title }),
    h(doc, 'p', { testid: 'backlink-snippet', class: 'snippet', text: b.snippet }),
  ]));
}

// ctx: {doc, win, api, live, dialogs, router, resolve, setTitle, onSaved, onRenamed, onDeleted, onCreatedByLink}
export function buildNoteView(ctx, data, meta = {}) {
  const { doc, win, api, live, dialogs } = ctx;
  let title = data.title;
  const model = createNoteModel(data.content, data.revision);
  let previewTimer = null;
  let copyTimer = null;
  let destroyed = false;

  const titleEl = h(doc, 'h1', { testid: 'note-title', tabindex: '-1', text: title });
  const statusEl = h(doc, 'span', { testid: 'save-status', class: 'save-status' });
  const saveBtn = h(doc, 'button', { type: 'button', testid: 'save-button', class: 'btn btn-primary', text: 'Save' });
  const renameBtn = h(doc, 'button', { type: 'button', testid: 'rename-button', class: 'btn', text: 'Rename' });
  const deleteBtn = h(doc, 'button', { type: 'button', testid: 'delete-button', class: 'btn', text: 'Delete' });
  const banners = h(doc, 'div', { class: 'banners' });
  const editor = h(doc, 'textarea', { id: 'note-editor', testid: 'editor', class: 'editor', spellcheck: 'true', autocomplete: 'off' });
  editor.value = data.content;
  const preview = h(doc, 'div', { testid: 'preview', class: 'preview', role: 'region', 'aria-label': 'Preview', tabindex: '0' });
  const backlinks = h(doc, 'section', { testid: 'backlinks', class: 'backlinks', 'aria-labelledby': 'backlinks-heading' });

  const tabEdit = h(doc, 'button', { type: 'button', role: 'tab', id: 'tab-edit', testid: 'tab-edit', class: 'tab', 'aria-controls': 'panel-edit', text: 'Edit' });
  const tabPreview = h(doc, 'button', { type: 'button', role: 'tab', id: 'tab-preview', testid: 'tab-preview', class: 'tab', 'aria-controls': 'panel-preview', text: 'Preview' });
  const tabs = h(doc, 'div', { role: 'tablist', 'aria-label': 'Note view', class: 'tabs' }, [tabEdit, tabPreview]);
  const panelEdit = h(doc, 'div', { id: 'panel-edit', role: 'tabpanel', 'aria-labelledby': 'tab-edit', class: 'panel panel-edit' }, [
    h(doc, 'label', { for: 'note-editor', class: 'pane-label', text: 'Note text' }),
    editor,
  ]);
  const panelPreview = h(doc, 'div', { id: 'panel-preview', role: 'tabpanel', 'aria-labelledby': 'tab-preview', class: 'panel panel-preview' }, [
    h(doc, 'p', { class: 'pane-label', 'aria-hidden': 'true', text: 'Preview' }),
    preview,
  ]);

  const article = h(doc, 'article', { testid: 'note-view', class: 'note-view', 'data-title': title, 'data-state': 'clean' }, [
    h(doc, 'header', { class: 'note-head' }, [
      backLink(doc),
      titleEl,
      h(doc, 'div', { class: 'note-actions' }, [statusEl, saveBtn, renameBtn, deleteBtn]),
    ]),
    banners,
    tabs,
    h(doc, 'div', { class: 'panes' }, [panelEdit, panelPreview]),
    backlinks,
  ]);

  // ---- tabs (phone) ----
  function setTab(name, focus = false) {
    article.setAttribute('data-tab', name);
    for (const [tab, panel, key] of [[tabEdit, panelEdit, 'edit'], [tabPreview, panelPreview, 'preview']]) {
      const on = key === name;
      tab.setAttribute('aria-selected', on ? 'true' : 'false');
      tab.setAttribute('tabindex', on ? '0' : '-1');
      panel.setAttribute('data-active', on ? 'true' : 'false');
    }
    if (focus) focusEl(name === 'edit' ? tabEdit : tabPreview);
  }
  tabEdit.addEventListener('click', () => setTab('edit'));
  tabPreview.addEventListener('click', () => setTab('preview'));
  tabs.addEventListener('keydown', (ev) => {
    const order = ['edit', 'preview'];
    const now = article.getAttribute('data-tab');
    const idx = order.indexOf(now);
    let next = null;
    if (ev.key === 'ArrowRight') next = order[(idx + 1) % 2];
    else if (ev.key === 'ArrowLeft') next = order[(idx + 1) % 2];
    else if (ev.key === 'Home') next = 'edit';
    else if (ev.key === 'End') next = 'preview';
    if (next) {
      ev.preventDefault();
      setTab(next, true);
    }
  });
  setTab(meta.created || data.content.trim() === '' ? 'edit' : 'preview');

  // ---- preview ----
  function renderPreview() {
    clear(preview);
    if (model.text.trim() === '') {
      preview.appendChild(h(doc, 'p', { class: 'muted', text: 'Nothing to preview yet.' }));
      return;
    }
    try {
      preview.appendChild(renderMarkdown(doc, model.text, { resolve: ctx.resolve }));
    } catch {
      // A pathological note must not stop the page from mounting: show the raw text instead.
      clear(preview);
      preview.appendChild(h(doc, 'p', { class: 'preview-plain', text: model.text }));
    }
  }
  function schedulePreview() {
    if (previewTimer !== null) win.clearTimeout(previewTimer);
    previewTimer = win.setTimeout(() => {
      previewTimer = null;
      renderPreview();
    }, 100);
  }

  // ---- state to DOM ----
  function bannerBox(testid, role, children) {
    return h(doc, 'div', { testid, role, class: testid === 'conflict-banner' ? 'banner banner-conflict' : 'banner banner-error' }, children);
  }
  let conflictEl = null;
  let errorEl = null;
  let copyBtn = null;
  let copyNote = null;

  function showConflict(on) {
    if (on && !conflictEl) {
      copyBtn = h(doc, 'button', { type: 'button', testid: 'conflict-copy', class: 'btn', text: 'Copy my text', on: { click: copyText } });
      copyNote = h(doc, 'p', { class: 'banner-note' });
      // Only the message is an alert; Copy feedback inside the banner must not be re-announced as one.
      conflictEl = bannerBox('conflict-banner', null, [
        h(doc, 'p', { role: 'alert', text: CONFLICT_MESSAGE }),
        h(doc, 'div', { class: 'banner-actions' }, [
          h(doc, 'button', { type: 'button', testid: 'conflict-reload', class: 'btn', text: 'Reload note', on: { click: reloadNote } }),
          copyBtn,
        ]),
        copyNote,
      ]);
      banners.appendChild(conflictEl);
    } else if (!on && conflictEl) {
      banners.removeChild(conflictEl);
      conflictEl = null;
    }
  }
  function showError(message) {
    if (message && !errorEl) {
      errorEl = bannerBox('save-error', 'alert', [h(doc, 'p', { text: message })]);
      banners.appendChild(errorEl);
    } else if (message) {
      errorEl.querySelector('p').textContent = message;
    } else if (errorEl) {
      banners.removeChild(errorEl);
      errorEl = null;
    }
  }

  // While saving, or while the button holds focus, use aria-disabled so focus is not thrown to the page.
  function syncSaveButton(state) {
    if (model.canSave()) {
      saveBtn.removeAttribute('disabled');
      saveBtn.removeAttribute('aria-disabled');
    } else if (state === 'saving' || doc.activeElement === saveBtn) {
      saveBtn.removeAttribute('disabled');
      saveBtn.setAttribute('aria-disabled', 'true');
    } else {
      saveBtn.setAttribute('disabled', '');
      saveBtn.removeAttribute('aria-disabled');
    }
  }

  function sync() {
    const state = model.state;
    article.setAttribute('data-state', state);
    statusEl.textContent = model.statusText();
    syncSaveButton(state);
    showConflict(state === 'conflict');
    showError(saveErrorMessage(state));
    ctx.setTitle(`${title} - Wiki`, model.isDirty());
  }

  // ---- actions ----
  async function save() {
    if (!model.canSave()) return;
    const { content, revision } = model.startSave();
    sync();
    try {
      const res = await api.saveNote(title, content, revision);
      model.saveOk(res.revision);
      live.announce('Saved');
      ctx.onSaved();
    } catch (e) {
      if (e.status === 412) model.saveConflict();
      else if (e.status === 404) model.saveGone();
      else model.saveFailed();
    }
    if (!destroyed) sync();
  }

  async function reloadNote() {
    try {
      const fresh = await api.getNote(title);
      model.reloaded(fresh.content, fresh.revision);
      editor.value = fresh.content;
      sync();
      renderPreview();
      setTab('edit');
      live.announce('Note reloaded');
      focusEl(titleEl);
    } catch (e) {
      live.alert(e.status === 404 ? 'This note no longer exists. Copy your text before you leave.' : 'Could not reload the note. Try again.');
    }
  }

  async function copyText() {
    if (copyTimer !== null) win.clearTimeout(copyTimer);
    try {
      await win.navigator.clipboard.writeText(editor.value);
      copyBtn.textContent = 'Copied';
      copyNote.textContent = '';
      live.announce('Copied');
      copyTimer = win.setTimeout(() => { copyBtn.textContent = 'Copy my text'; copyTimer = null; }, 2000);
    } catch {
      copyNote.textContent = COPY_FAILED;
      live.announce(COPY_FAILED);
    }
  }

  async function createFromLink(target) {
    if (model.isDirty() && !(await confirmLeave())) return;
    try {
      const created = await api.createNote(target);
      live.announce(`Created ${created.title}`);
      await ctx.router.navigate(noteUrl(created.title), { force: true, meta: { focusEditor: true, created: true } });
    } catch (e) {
      if (e.status === 409 && e.code === 'title_exists' && e.params.existing) {
        await ctx.router.navigate(noteUrl(e.params.existing), { force: true });
      } else {
        live.alert(`Could not create "${target}". Try again.`);
      }
    }
  }

  function confirmLeave() {
    return dialogs.leave({ title, returnTo: editor });
  }

  // ---- events ----
  editor.addEventListener('input', () => {
    model.edit(editor.value);
    sync();
    schedulePreview();
  });
  saveBtn.addEventListener('click', save);
  renameBtn.addEventListener('click', async () => {
    const result = await dialogs.rename({ opener: renameBtn, title, dirty: model.isDirty() });
    if (result) ctx.onRenamed(result);
  });
  deleteBtn.addEventListener('click', async () => {
    const removed = await dialogs.remove({ opener: deleteBtn, title });
    if (removed) ctx.onDeleted(title, removed === 'gone');
  });
  preview.addEventListener('click', (ev) => {
    const a = ev.target && ev.target.closest ? ev.target.closest('a') : null;
    if (a && a.getAttribute('data-testid') === 'wikilink' && a.getAttribute('data-state') === 'missing') {
      ev.preventDefault();
      createFromLink(a.getAttribute('data-target'));
    }
  });
  const onKey = (ev) => {
    if (isSaveShortcut(ev)) {
      ev.preventDefault();
      save();
    }
  };
  doc.addEventListener('keydown', onKey);

  // ---- backlinks ----
  async function loadBacklinks() {
    clear(backlinks);
    backlinks.appendChild(h(doc, 'h2', { id: 'backlinks-heading', text: 'Backlinks' }));
    backlinks.appendChild(h(doc, 'p', { role: 'status', class: 'muted', text: 'Loading backlinks...' }));
    let list;
    try {
      list = await api.backlinks(title);
    } catch {
      if (destroyed) return;
      backlinks.lastChild.textContent = BACKLINKS_FAILED;
      return;
    }
    if (destroyed) return;
    clear(backlinks);
    backlinks.appendChild(h(doc, 'h2', { id: 'backlinks-heading', text: backlinksHeading(list.length) }));
    if (list.length === 0) {
      backlinks.appendChild(h(doc, 'p', { testid: 'backlinks-empty', class: 'muted', text: 'No notes link here yet.' }));
    } else {
      backlinks.appendChild(h(doc, 'ul', { class: 'backlink-list' }, buildBacklinkItems(doc, list)));
    }
  }

  renderPreview();
  sync();

  return {
    el: article,
    heading: titleEl,
    editor,
    title: () => title,
    isDirty: () => model.isDirty(),
    confirmLeave,
    loadBacklinks,
    focusEditor: () => focusEl(editor),
    destroy() {
      destroyed = true;
      doc.removeEventListener('keydown', onKey);
      if (previewTimer !== null) win.clearTimeout(previewTimer);
      if (copyTimer !== null) win.clearTimeout(copyTimer);
    },
  };
}
