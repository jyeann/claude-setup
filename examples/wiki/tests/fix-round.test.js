// Fix round 1 (client): focus, announcements and stale-state behavior, driven through the real app wiring.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { start } from '../public/js/app.js';
import { makeWindow, waitFor, byId, Event, key } from './fake-dom.js';
import { withBackend, INDEX_HTML } from './backend.js';

async function boot(backend, { url = '/', fetchFn } = {}) {
  const { win, doc } = makeWindow({ html: INDEX_HTML, url, fetchFn: fetchFn || backend.fetchFn });
  start(win);
  const t = (id) => byId(doc, id);
  return {
    win, doc, t,
    text: (id) => (t(id) ? t(id).textContent : null),
    typeInto: (el, v) => { el.value = v; el.dispatchEvent(new Event('input')); },
    focused: () => doc.activeElement && doc.activeElement.getAttribute('data-testid'),
    path: () => win.location.pathname + win.location.search,
  };
}

test('graph route keeps focus on its heading while the data loads and after a retry', async () => {
  await withBackend(async (b) => {
    let fail = true;
    const fetchFn = (url, init) => (fail && url === '/api/graph' ? Promise.reject(new TypeError('offline')) : b.fetchFn(url, init));
    const u = await boot(b, { url: '/', fetchFn });
    await waitFor(() => u.t('note-list'));
    u.doc.querySelector('[data-testid="graph-link"]').click();
    await waitFor(() => u.t('graph-retry'));
    const h1 = u.t('graph-view').querySelector('h1');
    assert.equal(u.doc.activeElement, h1, 'heading still focused after the failure replaced the body');
    fail = false;
    u.t('graph-retry').click();
    assert.equal(u.doc.activeElement, h1, 'retry puts focus on the heading, not on the removed button');
    await waitFor(() => u.t('graph-svg'));
    assert.equal(u.doc.activeElement, h1);
  }, { 'A.md': 'x [[B]]', 'B.md': 'y' });
});

test('dialog errors are alerts', async () => {
  await withBackend(async (b) => {
    const u = await boot(b, { url: '/' });
    await waitFor(() => u.t('note-list'));
    assert.equal(u.t('new-note-error').getAttribute('role'), 'alert');
    assert.equal(u.t('rename-error').getAttribute('role'), 'alert');
    assert.equal(u.t('delete-dialog').querySelector('.dialog-error').getAttribute('role'), 'alert');
    assert.ok(u.t('delete-dialog').getAttribute('aria-describedby'));
    assert.ok(u.t('leave-dialog').getAttribute('aria-describedby'));
    for (const id of ['delete-dialog', 'leave-dialog']) {
      const target = u.t(id).getAttribute('aria-describedby');
      assert.ok(u.t(id).querySelector(`#${target}`), `${id} points at an element inside it`);
    }
  }, { 'A.md': 'x' });
});

test('conflict: only the message is an alert, Copy goes through the status region', async () => {
  await withBackend(async (b) => {
    const copied = [];
    const { win, doc } = makeWindow({ html: INDEX_HTML, url: '/n/Welcome', fetchFn: b.fetchFn, clipboard: { writeText: async (s) => { copied.push(s); } } });
    start(win);
    await waitFor(() => byId(doc, 'note-view'));
    fs.appendFileSync(path.join(b.root, 'Welcome.md'), '\nexternal');
    const editor = byId(doc, 'editor');
    editor.value = 'mine';
    editor.dispatchEvent(new Event('input'));
    editor.dispatchEvent(key('keydown', { key: 's', ctrlKey: true }));
    await waitFor(() => byId(doc, 'conflict-banner'));
    const banner = byId(doc, 'conflict-banner');
    assert.equal(banner.getAttribute('role'), null);
    assert.equal(banner.querySelectorAll('[role="alert"]').length, 1);
    byId(doc, 'conflict-copy').click();
    await waitFor(() => byId(doc, 'status-live').textContent === 'Copied');
    assert.equal(byId(doc, 'alert-live').textContent.includes('Copied'), false);
  }, { 'Welcome.md': 'Hello' });
});

test('Save keeps aria-disabled instead of disabled while saving, so focus is not dropped', async () => {
  await withBackend(async (b) => {
    let release;
    const gate = new Promise((r) => { release = r; });
    const fetchFn = async (url, init) => {
      if (init && init.method === 'PUT') await gate;
      return b.fetchFn(url, init);
    };
    const u = await boot(b, { url: '/n/Welcome', fetchFn });
    await waitFor(() => u.t('note-view'));
    u.typeInto(u.t('editor'), 'changed');
    u.t('save-button').focus();
    u.t('save-button').click();
    await waitFor(() => u.t('note-view').getAttribute('data-state') === 'saving');
    assert.equal(u.t('save-button').getAttribute('aria-disabled'), 'true');
    assert.equal(u.t('save-button').disabled, false);
    assert.equal(u.focused(), 'save-button');
    u.t('save-button').click(); // guarded: a second click must not start a second save
    release();
    await waitFor(() => u.text('save-status') === 'Saved');
    assert.equal(u.focused(), 'save-button', 'focus survives the save');
    assert.equal(u.t('save-button').getAttribute('aria-disabled'), 'true');
    assert.equal(b.read('Welcome.md'), 'changed');
  }, { 'Welcome.md': 'Hello' });
});

test('deleting a note that is already gone counts as deleted; renaming one says it no longer exists', async () => {
  await withBackend(async (b) => {
    const u = await boot(b, { url: '/n/Gone' });
    await waitFor(() => u.t('note-view'));
    fs.unlinkSync(path.join(b.root, 'Gone.md'));
    u.t('rename-button').click();
    u.typeInto(u.t('rename-input'), 'Other');
    u.t('rename-input').closest('form').submit();
    await waitFor(() => u.text('rename-error') !== '');
    assert.equal(u.text('rename-error'), 'This note no longer exists.');
    u.t('rename-cancel').click();
    u.t('delete-button').click();
    u.t('delete-confirm').closest('form').submit();
    await waitFor(() => u.path() === '/' && u.t('no-selection'));
    await waitFor(() => u.text('status-live') === '"Gone" was already deleted');
    assert.equal(u.doc.querySelectorAll('[data-testid="note-list-item"]').length, 1);
  }, { 'Gone.md': 'x', 'Keep.md': 'y' });
});

test('search: failure is announced, over-long input has a hint, deleted notes leave the results, same count is not repeated', async () => {
  await withBackend(async (b) => {
    let mode = 'ok';
    const fetchFn = async (url, init) => {
      if (url.startsWith('/api/search') && mode === 'fail') throw new TypeError('offline');
      if (url.startsWith('/api/search') && mode === 'long') return { status: 400, ok: false, json: async () => ({ error: { code: 'query_too_long', message: 'x' } }) };
      return b.fetchFn(url, init);
    };
    const u = await boot(b, { url: '/n/Alpha', fetchFn });
    await waitFor(() => u.t('note-view'));
    assert.equal(u.t('search-input').getAttribute('maxlength'), '200');
    u.typeInto(u.t('search-input'), 'note');
    await waitFor(() => u.text('search-status') === '2 notes match');
    // Deleting the open note while searching removes it from the results.
    u.t('delete-button').click();
    u.t('delete-confirm').closest('form').submit();
    await waitFor(() => u.path() === '/');
    await waitFor(() => u.text('search-status') === '1 note matches');
    assert.deepEqual([...u.doc.querySelectorAll('[data-testid="search-result"]')].map((li) => li.getAttribute('data-title')), ['Beta']);
    mode = 'long';
    u.typeInto(u.t('search-input'), 'notes');
    await waitFor(() => /at most 200/.test(u.text('search-empty') || ''));
    assert.match(u.text('search-status'), /at most 200/);
    mode = 'fail';
    u.typeInto(u.t('search-input'), 'notes again');
    await waitFor(() => /Search failed/.test(u.text('search-status')));
  }, { 'Alpha.md': 'a note', 'Beta.md': 'b note' });
});

test('phone home: list error and retry live in the sidebar when main is hidden, with a heading to land on', async () => {
  await withBackend(async (b) => {
    let down = true;
    const fetchFn = (url, init) => (down && url === '/api/notes' ? Promise.reject(new TypeError('offline')) : b.fetchFn(url, init));
    const u = await boot(b, { fetchFn });
    u.win.getComputedStyle = () => ({ display: 'none' });
    await waitFor(() => u.doc.querySelector('#list-region [data-testid="app-error"]'));
    assert.equal(u.doc.querySelector('#main').children.length, 0);
    assert.equal(u.doc.activeElement.getAttribute('class'), 'app-error-text');
    down = false;
    u.t('app-retry').click();
    await waitFor(() => u.t('note-list'));
    assert.equal(u.doc.activeElement, u.t('sidebar-heading'));
  }, { 'A.md': 'x' });
});

test('a note whose preview cannot render still mounts, with the plain text', async () => {
  await withBackend(async (b) => {
    const u = await boot(b, { url: '/n/Odd' });
    await waitFor(() => u.t('note-view'));
    const orig = u.doc.createDocumentFragment;
    u.doc.createDocumentFragment = () => { throw new RangeError('boom'); };
    u.typeInto(u.t('editor'), '# hi *there*');
    await waitFor(() => u.t('preview').textContent === '# hi *there*');
    u.doc.createDocumentFragment = orig;
  }, { 'Odd.md': 'x' });
});
