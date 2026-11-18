// End-to-end UI tests: the real modules run on a fake DOM and talk to an in-process copy of the real server.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { start } from '../public/js/app.js';
import { makeWindow, waitFor, byId, allById, key, Event, sleep } from './fake-dom.js';
import { withBackend, INDEX_HTML } from './backend.js';

async function boot(backend, { url = '/', fetchFn, clipboard, reduced = false, width = 1280 } = {}) {
  const { win, doc } = makeWindow({ html: INDEX_HTML, url, fetchFn: fetchFn || backend.fetchFn, clipboard, reduced, width });
  const app = start(win);
  const t = (id) => byId(doc, id);
  const all = (id) => allById(doc, id);
  const text = (id) => (t(id) ? t(id).textContent : null);
  const typeInto = (el, value) => { el.value = value; el.dispatchEvent(new Event('input')); };
  const press = (k, init = {}) => doc.activeElement.dispatchEvent(key('keydown', { key: k, ...init }));
  const save = () => (t('editor') || doc.body).dispatchEvent(key('keydown', { key: 's', ctrlKey: true }));
  const path = () => win.location.pathname + win.location.search;
  return { win, doc, app, t, all, text, typeInto, press, save, path, focused: () => doc.activeElement && doc.activeElement.getAttribute('data-testid') };
}

const settle = async (u) => { await waitFor(() => u.t('note-view') || u.t('no-selection') || u.t('empty-vault') || u.t('not-found') || u.t('graph-view') || u.t('app-error')); };

test('first use: empty vault, create a note, type, save with Ctrl+S, text is on disk', async () => {
  await withBackend(async (b) => {
    const u = await boot(b);
    await waitFor(() => u.t('empty-vault'));
    assert.equal(u.text('note-list-empty'), 'No notes yet.');
    assert.match(u.text('empty-vault'), /Your vault is empty/);
    assert.equal(u.t('list-loading'), null);
    u.t('empty-create').click();
    assert.equal(u.t('new-note-dialog').open, true);
    assert.equal(u.focused(), 'new-note-input');
    u.typeInto(u.t('new-note-input'), 'Welcome');
    u.t('new-note-input').closest('form').submit();
    await waitFor(() => u.t('note-view'));
    assert.equal(u.path(), '/n/Welcome');
    assert.equal(u.text('note-title'), 'Welcome');
    assert.equal(u.focused(), 'editor');
    assert.equal(u.t('editor').value, '');
    assert.equal(u.t('new-note-dialog').open, false);
    assert.equal(b.read('Welcome.md'), '');
    assert.equal(u.text('preview'), 'Nothing to preview yet.');
    u.typeInto(u.t('editor'), 'Hello from Welcome.\n\nSee [[Ideas]] and [[Ideas|my ideas]].');
    assert.equal(u.text('save-status'), 'Unsaved changes');
    assert.equal(u.doc.title, '* Welcome - Wiki');
    assert.equal(u.t('note-view').getAttribute('data-state'), 'dirty');
    assert.equal(u.t('save-button').disabled, false);
    u.save();
    await waitFor(() => u.text('save-status') === 'Saved');
    assert.equal(b.read('Welcome.md'), 'Hello from Welcome.\n\nSee [[Ideas]] and [[Ideas|my ideas]].');
    assert.equal(u.doc.title, 'Welcome - Wiki');
    assert.equal(u.t('save-button').disabled, true);
    await waitFor(() => u.text('status-live') === 'Saved');
    await waitFor(() => u.all('wikilink').length === 2);
    assert.deepEqual(u.all('wikilink').map((a) => a.getAttribute('data-state')), ['missing', 'missing']);
    assert.deepEqual(u.all('wikilink').map((a) => a.textContent), ['Ideas', 'my ideas']);
  });
});

test('create on click, backlinks, rename with link rewriting, delete', async () => {
  await withBackend(async (b) => {
    const u = await boot(b, { url: '/n/Welcome' });
    await waitFor(() => u.t('note-view') && u.all('wikilink').length === 2);
    assert.equal(u.doc.title, 'Welcome - Wiki');
    u.all('wikilink')[0].click();
    await waitFor(() => u.path() === '/n/Ideas' && u.t('note-view') && u.text('note-title') === 'Ideas');
    assert.equal(u.focused(), 'editor');
    assert.equal(b.read('Ideas.md'), '');
    await waitFor(() => u.text('status-live') === 'Created Ideas');
    await waitFor(() => u.t('backlinks').textContent.includes('Backlinks (1)'));
    assert.equal(u.all('backlink-item')[0].getAttribute('data-title'), 'Welcome');
    assert.equal(u.text('backlink-snippet'), 'See [[Ideas]] and [[Ideas|my ideas]].');
    assert.equal(u.t('note-list').querySelector('li[aria-current="page"]').getAttribute('data-title'), 'Ideas');

    u.t('rename-button').click();
    assert.equal(u.t('rename-input').value, 'Ideas');
    assert.equal(u.t('rename-input').selected, true);
    u.typeInto(u.t('rename-input'), 'welcome');
    u.t('rename-input').closest('form').submit();
    await waitFor(() => u.text('rename-error') !== '');
    assert.equal(u.text('rename-error'), 'A note called "Welcome" already exists. Choose another title.');
    assert.equal(u.focused(), 'rename-input');
    assert.equal(u.t('rename-input').getAttribute('aria-invalid'), 'true');
    assert.equal(u.t('rename-dialog').open, true);

    u.typeInto(u.t('rename-input'), 'Project ideas');
    u.t('rename-input').closest('form').submit();
    await waitFor(() => u.path() === '/n/Project%20ideas' && u.text('note-title') === 'Project ideas');
    assert.equal(u.focused(), 'note-title');
    await waitFor(() => u.text('status-live') === 'Renamed to Project ideas. Updated links in 1 note.');
    assert.equal(b.read('Welcome.md'), 'Hello from Welcome.\n\nSee [[Project ideas]] and [[Project ideas|my ideas]].');
    assert.equal(fs.existsSync(path.join(b.root, 'Ideas.md')), false);

    u.all('note-list-item').find((li) => li.getAttribute('data-title') === 'Welcome').querySelector('a').click();
    await waitFor(() => u.t('note-view') && u.text('note-title') === 'Welcome' && u.all('wikilink').length === 2);
    assert.deepEqual(u.all('wikilink').map((a) => a.getAttribute('data-state')), ['exists', 'exists']);
    assert.equal(u.focused(), 'note-title');

    u.all('wikilink')[1].click();
    await waitFor(() => u.path() === '/n/Project%20ideas' && u.text('note-title') === 'Project ideas');
    u.t('delete-button').click();
    assert.equal(u.focused(), 'delete-cancel');
    assert.match(u.text('delete-dialog'), /Delete "Project ideas"\?/);
    assert.match(u.text('delete-dialog'), /Project ideas\.md/);
    u.t('delete-cancel').click();
    assert.equal(u.t('delete-dialog').open, false);
    await waitFor(() => u.focused() === 'delete-button');
    assert.equal(fs.existsSync(path.join(b.root, 'Project ideas.md')), true);
    u.t('delete-button').click();
    u.t('delete-confirm').closest('form').submit();
    await waitFor(() => u.path() === '/' && u.t('no-selection'));
    await waitFor(() => u.text('status-live') === 'Deleted "Project ideas"');
    assert.equal(fs.existsSync(path.join(b.root, 'Project ideas.md')), false);
    assert.equal(fs.existsSync(path.join(b.root, 'Welcome.md')), true);
    await waitFor(() => u.focused() === null && u.doc.activeElement.localName === 'a');
    assert.equal(u.all('note-list-item').length, 1);
  }, { 'Welcome.md': 'Hello from Welcome.\n\nSee [[Ideas]] and [[Ideas|my ideas]].' });
});

test('invalid titles show the shared message, keep the dialog open and create nothing', async () => {
  await withBackend(async (b) => {
    const u = await boot(b);
    await settle(u);
    u.t('new-note-button').click();
    assert.equal(u.t('new-note-input').closest('form').hasAttribute('novalidate'), true, 'our own messages, not the browser bubbles');
    assert.equal(u.t('new-note-dialog').getAttribute('aria-labelledby'), 'dlg-new-title');
    const cases = [['../escape', 'A title cannot contain / or \\.'], ['a/b', 'A title cannot contain / or \\.'], ['.hidden', 'A title cannot start with a dot.'], ['', 'Give the note a title.'], ['   ', 'Give the note a title.'], ['x'.repeat(201), 'Keep the title to 200 characters or fewer. It is 201 now.']];
    for (const [value, message] of cases) {
      u.typeInto(u.t('new-note-input'), value);
      u.t('new-note-input').closest('form').submit();
      await waitFor(() => u.text('new-note-error') === message);
      assert.equal(u.t('new-note-dialog').open, true);
      assert.equal(u.focused(), 'new-note-input');
      assert.equal(u.t('new-note-input').getAttribute('aria-invalid'), 'true');
    }
    assert.deepEqual(fs.readdirSync(b.root).filter((n) => !n.startsWith('.')), []);
    // server side rejection of an existing title shows the server's text
    fs.writeFileSync(path.join(b.root, 'Ideas.md'), '');
    u.typeInto(u.t('new-note-input'), 'ideas');
    u.t('new-note-input').closest('form').submit();
    await waitFor(() => /already exists/.test(u.text('new-note-error')));
    assert.equal(u.t('new-note-submit').disabled, false);
    u.t('new-note-cancel').click();
    assert.equal(u.t('new-note-dialog').open, false);
    await waitFor(() => u.focused() === 'new-note-button');
  });
});

test('rename: identical title closes without a request, a dirty note is refused, case-only goes to the server', async () => {
  await withBackend(async (b) => {
    const u = await boot(b, { url: '/n/Ideas' });
    await waitFor(() => u.t('note-view'));
    u.t('rename-button').click();
    const before = b.calls.length;
    u.t('rename-input').closest('form').submit();
    await sleep(20);
    assert.equal(u.t('rename-dialog').open, false);
    assert.equal(b.calls.length, before);
    assert.equal(u.focused(), 'rename-button');

    u.typeInto(u.t('editor'), 'edited');
    u.t('rename-button').click();
    u.typeInto(u.t('rename-input'), 'Other');
    u.t('rename-input').closest('form').submit();
    await waitFor(() => u.text('rename-error') !== '');
    assert.equal(u.text('rename-error'), 'Save or discard your unsaved changes before renaming.');
    u.t('rename-cancel').click();
    u.save();
    await waitFor(() => u.text('save-status') === 'Saved');

    u.t('rename-button').click();
    u.typeInto(u.t('rename-input'), 'IDEAS');
    u.t('rename-input').closest('form').submit();
    await waitFor(() => u.path() === '/n/IDEAS' && u.text('note-title') === 'IDEAS');
    assert.equal(fs.existsSync(path.join(b.root, 'IDEAS.md')), true);
    await waitFor(() => u.text('status-live') === 'Renamed to IDEAS.');
  }, { 'Ideas.md': '' });
});

test('partial rename failures are announced as an alert too', async () => {
  await withBackend(async (b) => {
    const u = await boot(b, { url: '/n/Ideas' });
    await waitFor(() => u.t('note-view'));
    const real = u.app.api.renameNote;
    u.app.api.renameNote = async (...a) => ({ ...(await real(...a)), updated: [], failed: [{ title: 'A', reason: 'write_failed' }, { title: 'B', reason: 'write_failed' }] });
    u.t('rename-button').click();
    u.typeInto(u.t('rename-input'), 'Renamed');
    u.t('rename-input').closest('form').submit();
    const msg = 'Renamed, but 2 notes could not be updated: A, B. Fix those links by hand.';
    await waitFor(() => u.text('status-live') === msg);
    await waitFor(() => u.text('alert-live') === msg);
  }, { 'Ideas.md': '' });
});

test('save conflict: banner, disabled Save, copy my text, reload note', async () => {
  await withBackend(async (b) => {
    const copied = [];
    const u = await boot(b, { url: '/n/Welcome', clipboard: { writeText: async (s) => { copied.push(s); } } });
    await waitFor(() => u.t('note-view'));
    fs.appendFileSync(path.join(b.root, 'Welcome.md'), '\nexternal');
    u.typeInto(u.t('editor'), 'Hello B-edit');
    u.t('editor').focus();
    u.save();
    await waitFor(() => u.t('conflict-banner'));
    assert.equal(u.t('conflict-banner').querySelector('p').getAttribute('role'), 'alert');
    assert.equal(u.t('conflict-banner').getAttribute('role'), null);
    assert.match(u.text('conflict-banner'), /^This note changed since you opened it\. Your edit was not saved/);
    assert.equal(u.text('save-status'), 'Not saved');
    assert.equal(u.t('save-button').disabled, true);
    assert.equal(u.t('note-view').getAttribute('data-state'), 'conflict');
    assert.equal(u.t('editor').value, 'Hello B-edit');
    assert.equal(u.focused(), 'editor');
    assert.equal(b.read('Welcome.md'), 'Hello\nexternal');
    u.typeInto(u.t('editor'), 'Hello B-edit more');
    assert.equal(u.t('note-view').getAttribute('data-state'), 'conflict');
    u.t('conflict-copy').click();
    await waitFor(() => u.text('conflict-copy') === 'Copied');
    assert.deepEqual(copied, ['Hello B-edit more']);
    u.t('conflict-reload').click();
    await waitFor(() => u.t('conflict-banner') === null);
    assert.equal(u.t('editor').value, 'Hello\nexternal');
    assert.equal(u.text('save-status'), 'Saved');
    assert.equal(u.focused(), 'note-title');
    assert.equal(u.t('tab-edit').getAttribute('aria-selected'), 'true');
    await waitFor(() => u.text('status-live') === 'Note reloaded');
    assert.equal(u.t('note-view').getAttribute('data-state'), 'clean');
  }, { 'Welcome.md': 'Hello' });
});

test('copy failure explains how to copy by hand', async () => {
  await withBackend(async (b) => {
    const u = await boot(b, { url: '/n/Welcome', clipboard: { writeText: async () => { throw new Error('denied'); } } });
    await waitFor(() => u.t('note-view'));
    fs.appendFileSync(path.join(b.root, 'Welcome.md'), 'x');
    u.typeInto(u.t('editor'), 'y');
    u.save();
    await waitFor(() => u.t('conflict-copy'));
    u.t('conflict-copy').click();
    await waitFor(() => /Could not copy/.test(u.text('conflict-banner')));
  }, { 'Welcome.md': 'Hello' });
});

test('save failure keeps the text and Save enabled, a later save clears the error', async () => {
  await withBackend(async (b) => {
    let down = false;
    const fetchFn = (url, init) => (down && init && init.method === 'PUT' ? Promise.reject(new TypeError('offline')) : b.fetchFn(url, init));
    const u = await boot(b, { url: '/n/Welcome', fetchFn });
    await waitFor(() => u.t('note-view'));
    down = true;
    u.typeInto(u.t('editor'), 'changed');
    u.save();
    await waitFor(() => u.t('save-error'));
    assert.match(u.text('save-error'), /^Could not save\. Your text is still here\./);
    assert.equal(u.t('save-error').getAttribute('role'), 'alert');
    assert.equal(u.text('save-status'), 'Not saved');
    assert.equal(u.t('save-button').disabled, false);
    assert.equal(u.t('editor').value, 'changed');
    down = false;
    u.save();
    await waitFor(() => u.text('save-status') === 'Saved');
    assert.equal(u.t('save-error'), null);
    assert.equal(b.read('Welcome.md'), 'changed');
  }, { 'Welcome.md': 'Hello' });
});

test('a note deleted elsewhere: saving says it is gone and disables Save', async () => {
  await withBackend(async (b) => {
    const u = await boot(b, { url: '/n/Welcome' });
    await waitFor(() => u.t('note-view'));
    fs.unlinkSync(path.join(b.root, 'Welcome.md'));
    u.typeInto(u.t('editor'), 'z');
    u.save();
    await waitFor(() => u.t('save-error'));
    assert.equal(u.text('save-error'), 'This note no longer exists. Copy your text before you leave.');
    assert.equal(u.t('save-button').disabled, true);
    assert.equal(u.t('note-view').getAttribute('data-state'), 'gone');
  }, { 'Welcome.md': 'Hello' });
});

test('leave guard: keep editing restores the editor, discard moves on and loses the edit', async () => {
  await withBackend(async (b) => {
    const u = await boot(b, { url: '/n/Welcome' });
    await waitFor(() => u.t('note-view'));
    u.typeInto(u.t('editor'), 'x');
    const other = () => u.all('note-list-item').find((li) => li.getAttribute('data-title') === 'Other').querySelector('a');
    other().click();
    await waitFor(() => u.t('leave-dialog').open);
    assert.equal(u.focused(), 'leave-stay');
    assert.equal(u.path(), '/n/Welcome');
    assert.match(u.text('leave-dialog'), /Leave without saving\?/);
    assert.match(u.text('leave-dialog'), /You have unsaved changes in "Welcome"\. They will be lost\./);
    u.t('leave-stay').click();
    await waitFor(() => u.focused() === 'editor');
    assert.equal(u.t('editor').value, 'x');
    assert.equal(u.t('leave-dialog').open, false);
    other().click();
    await waitFor(() => u.t('leave-dialog').open);
    u.t('leave-discard').click();
    await waitFor(() => u.path() === '/n/Other' && u.text('note-title') === 'Other');
    assert.equal(b.read('Welcome.md'), 'Hello');
    assert.equal(u.doc.title, 'Other - Wiki');
  }, { 'Welcome.md': 'Hello', 'Other.md': 'o' });
});

test('clicking a missing link on a dirty note asks first; an existing-title race opens the existing note', async () => {
  await withBackend(async (b) => {
    const u = await boot(b, { url: '/n/Welcome' });
    await waitFor(() => u.t('note-view') && u.all('wikilink').length === 1);
    u.typeInto(u.t('editor'), 'See [[Ideas]] now');
    await waitFor(() => u.all('wikilink').length === 1 && u.t('preview').textContent.includes('now'));
    u.all('wikilink')[0].click();
    await waitFor(() => u.t('leave-dialog').open);
    fs.writeFileSync(path.join(b.root, 'ideas.md'), '');
    u.t('leave-discard').click();
    await waitFor(() => u.path() === '/n/ideas' || u.path() === '/n/Ideas');
    assert.equal(fs.existsSync(path.join(b.root, 'Ideas.md')), false);
  }, { 'Welcome.md': 'See [[Ideas]]' });
});

test('a failed link creation alerts and stays on the note', async () => {
  await withBackend(async (b) => {
    const fetchFn = (url, init) => (init && init.method === 'POST' ? Promise.reject(new TypeError('offline')) : b.fetchFn(url, init));
    const u = await boot(b, { url: '/n/Welcome', fetchFn });
    await waitFor(() => u.all('wikilink').length === 1);
    u.all('wikilink')[0].click();
    await waitFor(() => u.text('alert-live') === 'Could not create "Ideas". Try again.');
    assert.equal(u.path(), '/n/Welcome');
  }, { 'Welcome.md': '[[Ideas]]' });
});

test('hostile content is shown literally and unsafe links are plain text', async () => {
  const body = '<script>alert(1)</script>\n<img src=x onerror=alert(1)>\n<b>bold?</b>\n[link](javascript:alert(1))\n[ok](https://example.com)';
  await withBackend(async (b) => {
    const u = await boot(b, { url: '/n/Hostile' });
    await waitFor(() => u.t('note-view') && u.all('unsafe-link').length === 1);
    const preview = u.t('preview');
    assert.equal(preview.querySelectorAll('script').length + preview.querySelectorAll('img').length + preview.querySelectorAll('b').length, 0);
    assert.match(preview.textContent, /<script>alert\(1\)<\/script>/);
    assert.equal(u.all('unsafe-link')[0].textContent, 'link');
    assert.equal(u.doc.querySelectorAll('a[href]').filter((a) => /^javascript/i.test(a.getAttribute('href'))).length, 0);
    assert.equal(preview.querySelector('a[target]').getAttribute('rel'), 'noopener noreferrer');
  }, { 'Hostile.md': body });
});

test('search: debounce, marks from ranges, count, Escape and clear restore the list, Ctrl+K focuses', async () => {
  await withBackend(async (b) => {
    const u = await boot(b);
    await waitFor(() => u.t('note-list'));
    const input = u.t('search-input');
    assert.equal(u.t('search-clear'), null);
    u.typeInto(input, 'quarterly');
    assert.ok(u.t('search-clear'));
    assert.equal(u.t('search-results'), null, 'nothing is sent before the debounce');
    await waitFor(() => u.t('search-results'));
    assert.equal(u.all('search-result').length, 2);
    assert.deepEqual(u.all('search-result').map((li) => li.getAttribute('data-title')), ['Quarterly plan', 'Review']);
    const marks = u.all('search-snippet').flatMap((p) => p.querySelectorAll('mark'));
    assert.deepEqual(marks.map((m) => m.textContent.toLowerCase()), ['quarterly']);
    assert.equal(u.text('search-status'), '2 notes match');
    assert.equal(u.t('search-status').getAttribute('class'), 'sr-only');
    assert.equal(u.t('note-list'), null);
    assert.equal(u.text('status-live'), '');

    input.focus();
    u.press('Escape');
    assert.equal(input.value, '');
    assert.ok(u.t('note-list'));
    assert.equal(u.all('note-list-item').length, 3);
    assert.equal(u.t('search-clear'), null);

    u.typeInto(input, 'zzqx');
    await waitFor(() => u.t('search-empty'));
    assert.equal(u.text('search-empty'), 'No notes match "zzqx"');
    u.t('search-clear').click();
    assert.equal(u.focused(), 'search-input');
    assert.ok(u.t('note-list'));

    u.doc.body.dispatchEvent(key('keydown', { key: 'k', ctrlKey: true }));
    assert.equal(u.focused(), 'search-input');
    u.typeInto(input, 'one');
    await waitFor(() => u.text('search-status') === '1 note matches');
  }, { 'Quarterly plan.md': 'Goals.', 'Review.md': 'The QUARTERLY review is due.', 'Other.md': 'one thing' });
});

test('search: a slow request shows Searching..., an older request is aborted and ignored, errors are explained', async () => {
  await withBackend(async (b) => {
    let release;
    const gate = new Promise((r) => { release = r; });
    const aborted = [];
    let mode = 'slow';
    const fetchFn = async (url, init) => {
      if (url.startsWith('/api/search')) {
        if (mode === 'fail') throw new TypeError('offline');
        if (mode === 'slow' && url.endsWith('=one')) {
          init.signal.addEventListener('abort', () => aborted.push(url));
          await gate;
          return { status: 200, ok: true, json: async () => ({ query: 'one', total: 1, results: [{ title: 'Other', titleMatch: false, modified: '', snippet: 'one thing', ranges: [[0, 3]] }] }) };
        }
      }
      return b.fetchFn(url, init);
    };
    const u = await boot(b, { fetchFn });
    await waitFor(() => u.t('note-list'));
    u.typeInto(u.t('search-input'), 'one');
    await waitFor(() => u.text('search-status') === 'Searching...', { timeout: 1500 });
    assert.equal(u.t('search-status').getAttribute('class'), null);
    mode = 'fast';
    u.typeInto(u.t('search-input'), 'thing');
    await waitFor(() => u.t('search-results'));
    assert.deepEqual(aborted, ['/api/search?q=one']);
    release();
    await sleep(30);
    assert.equal(u.all('search-result')[0].getAttribute('data-title'), 'Other');
    assert.equal(u.text('search-status'), '1 note matches');
    mode = 'fail';
    u.typeInto(u.t('search-input'), 'again');
    await waitFor(() => /Search failed/.test(u.text('search-empty') || ''));
    assert.equal(u.text('search-empty'), 'Search failed. Check that the server is running, then try again.');
  }, { 'Other.md': 'one thing' });
});

test('search results open the note and long queries are truncated in the empty message', async () => {
  await withBackend(async (b) => {
    const u = await boot(b);
    await waitFor(() => u.t('note-list'));
    u.typeInto(u.t('search-input'), 'Review');
    await waitFor(() => u.t('search-results'));
    u.all('search-result')[0].querySelector('a').click();
    await waitFor(() => u.t('note-view') && u.path() === '/n/Review');
    assert.equal(u.focused(), 'note-title');
    u.typeInto(u.t('search-input'), 'q'.repeat(60));
    await waitFor(() => u.t('search-empty'));
    assert.equal(u.text('search-empty'), `No notes match "${'q'.repeat(40)}..."`);
  }, { 'Review.md': 'x' });
});

test('graph: summary, nodes, edges, current and orphan flags, list alternative, keyboard open', async () => {
  await withBackend(async (b) => {
    const u = await boot(b, { url: '/graph?note=A' });
    await waitFor(() => u.t('graph-svg') && u.t('graph-svg').getAttribute('data-ready') === 'true');
    assert.equal(u.text('graph-summary'), '4 notes, 2 links');
    assert.equal(u.t('graph-svg').getAttribute('role'), 'group');
    assert.ok(u.t('graph-svg').getAttribute('aria-label'));
    assert.equal(u.t('graph-svg').getAttribute('data-node-count'), '4');
    assert.equal(u.t('graph-svg').getAttribute('data-edge-count'), '2');
    assert.equal(u.all('graph-node').length, 4);
    assert.equal(u.all('graph-edge').length, 2);
    assert.deepEqual(u.all('graph-edge').map((e) => `${e.getAttribute('data-from')}-${e.getAttribute('data-to')}`), ['A-B', 'A-C']);
    const node = (title) => u.all('graph-node').find((g) => g.getAttribute('data-title') === title);
    assert.equal(node('A').getAttribute('data-current'), 'true');
    assert.equal(node('B').getAttribute('data-current'), 'false');
    assert.equal(node('D').getAttribute('data-orphan'), 'true');
    assert.equal(node('A').getAttribute('data-orphan'), 'false');
    assert.equal(node('C').getAttribute('role'), 'link');
    assert.equal(node('C').getAttribute('tabindex'), '0');
    assert.equal(node('C').getAttribute('aria-label'), 'Open note C');
    assert.equal(u.doc.title, 'Graph - Wiki');
    assert.equal(u.t('graph-link').getAttribute('href'), '/graph?note=A');
    const items = u.all('graph-list-item');
    assert.equal(items.length, 4);
    assert.match(items[0].textContent, /A.*Links to B, C/);
    assert.match(items[3].textContent, /D.*No links/);
    assert.equal(items[2].querySelector('a').getAttribute('href'), '/n/C');
    assert.equal(u.t('graph-loading').getAttribute('hidden'), '');
    for (const g of u.all('graph-node')) assert.ok(g.getAttribute('transform').startsWith('translate('));
    node('C').click();
    await waitFor(() => u.path() === '/n/C');
    await waitFor(() => u.t('note-view'));
    u.t('graph-link').click();
    await waitFor(() => u.path() === '/graph?note=C');
    await waitFor(() => u.t('graph-svg') && u.t('graph-svg').getAttribute('data-ready') === 'true');
    const b2 = u.all('graph-node').find((g) => g.getAttribute('data-title') === 'B');
    b2.dispatchEvent(key('keydown', { key: 'Enter' }));
    await waitFor(() => u.path() === '/n/B');
    await waitFor(() => u.t('graph-view') === null);
  }, { 'A.md': '[[B]] [[C]] [[A]]', 'B.md': '[[a]]', 'C.md': 'leaf', 'D.md': 'alone' });
});

test('graph: space opens a node, other keys do not, reduced motion lays out before drawing', async () => {
  await withBackend(async (b) => {
    const u = await boot(b, { url: '/graph', reduced: true });
    await waitFor(() => u.t('graph-svg') && u.t('graph-svg').getAttribute('data-ready') === 'true');
    const before = u.all('graph-node').map((g) => g.getAttribute('transform')).join('|');
    await sleep(80);
    assert.equal(u.all('graph-node').map((g) => g.getAttribute('transform')).join('|'), before, 'positions are frozen');
    const a = u.all('graph-node')[0];
    a.dispatchEvent(key('keydown', { key: 'x' }));
    await sleep(20);
    assert.equal(u.path(), '/graph');
    a.dispatchEvent(key('keydown', { key: ' ' }));
    await waitFor(() => u.path() === '/n/A');
  }, { 'A.md': '[[B]]', 'B.md': 'b' });
});

test('graph: empty vault and server failure', async () => {
  await withBackend(async (b) => {
    const u = await boot(b, { url: '/graph' });
    await waitFor(() => u.t('graph-empty'));
    assert.equal(u.text('graph-empty'), 'No notes to graph yet.');
    assert.equal(u.t('graph-svg'), null);
  });
  await withBackend(async (b) => {
    let fail = true;
    const fetchFn = (url, init) => (fail && url === '/api/graph' ? Promise.reject(new TypeError('offline')) : b.fetchFn(url, init));
    const u = await boot(b, { url: '/graph', fetchFn });
    await waitFor(() => u.t('graph-retry'));
    assert.match(u.text('graph-view'), /Could not load the graph\. Try again\./);
    fail = false;
    u.t('graph-retry').click();
    await waitFor(() => u.t('graph-svg'));
  }, { 'A.md': 'x' });
});

test('large graphs only label the current note until a node is hovered or focused', async () => {
  const files = {};
  for (let i = 0; i < 205; i += 1) files[`N${String(i).padStart(3, '0')}.md`] = i > 0 ? '[[N000]]' : '';
  await withBackend(async (b) => {
    const u = await boot(b, { url: '/graph?note=N000' });
    await waitFor(() => u.t('graph-svg') && u.t('graph-svg').getAttribute('data-ready') === 'true');
    const labelled = () => u.doc.querySelectorAll('.graph-label').length;
    assert.equal(labelled(), 1);
    const leaf = u.all('graph-node').find((g) => g.getAttribute('data-title') === 'N007');
    leaf.dispatchEvent(new Event('focus', { bubbles: false }));
    assert.equal(labelled(), 2);
    assert.ok(u.doc.querySelectorAll('.graph-label').some((t) => t.textContent === 'N007'));
    leaf.dispatchEvent(new Event('blur', { bubbles: false }));
    assert.equal(labelled(), 1);
    leaf.dispatchEvent(new Event('mouseenter', { bubbles: false }));
    assert.equal(labelled(), 2);
    leaf.dispatchEvent(new Event('mouseleave', { bubbles: false }));
    assert.equal(labelled(), 1);
  }, files);
});

test('small graphs label every node', async () => {
  await withBackend(async (b) => {
    const u = await boot(b, { url: '/graph' });
    await waitFor(() => u.t('graph-svg') && u.t('graph-svg').getAttribute('data-ready') === 'true');
    assert.equal(u.doc.querySelectorAll('.graph-label').length, 3);
    assert.equal(u.all('graph-node').filter((g) => g.querySelector('text')).length, 0, 'labels sit outside the node groups so a node box stays centred on its dot');
  }, { 'A.md': '', 'B.md': '', 'C.md': '' });
});

test('unknown notes and unsafe addresses show Note not found without leaking files', async () => {
  await withBackend(async (b) => {
    for (const url of ['/n/Does%20not%20exist', '/n/..%2Fsecret', '/n/%2e%2e%2fsecret', '/n/..', '/nope']) {
      const u = await boot(b, { url });
      await waitFor(() => u.t('not-found'));
      assert.equal(u.text('not-found-title'), 'Note not found');
      assert.equal(u.doc.title, 'Note not found - Wiki');
      assert.doesNotMatch(u.doc.body.textContent, /TOPSECRET/);
      assert.equal(u.t('not-found-back').getAttribute('href'), '/');
      u.t('not-found-back').click();
      await waitFor(() => u.path() === '/' && u.t('no-selection'));
      assert.equal(u.text('no-selection').includes('Choose a note from the list, or create a new one.'), true);
    }
  }, { 'Real.md': 'x' });
});

test('server unreachable: app-error with retry, then the list appears', async () => {
  await withBackend(async (b) => {
    let down = true;
    const fetchFn = (url, init) => (down && url === '/api/notes' ? Promise.reject(new TypeError('offline')) : b.fetchFn(url, init));
    const u = await boot(b, { fetchFn });
    await waitFor(() => u.t('app-error'));
    assert.equal(u.text('app-error').includes('Could not reach the wiki server. Check that it is still running, then try again.'), true);
    assert.equal(u.t('note-list'), null);
    assert.equal(u.t('empty-vault'), null);
    await waitFor(() => u.text('alert-live').startsWith('Could not reach'));
    assert.equal(u.doc.activeElement.getAttribute('class'), 'app-error-text');
    down = false;
    u.t('app-retry').click();
    await waitFor(() => u.t('note-list'));
    assert.equal(u.t('app-error'), null);
    assert.ok(u.t('no-selection'));
  }, { 'A.md': 'x' });
});

test('a note that cannot be fetched because the server dropped shows the app error', async () => {
  await withBackend(async (b) => {
    const fetchFn = (url, init) => (url.startsWith('/api/notes/A') ? Promise.reject(new TypeError('offline')) : b.fetchFn(url, init));
    const u = await boot(b, { url: '/n/A', fetchFn });
    await waitFor(() => u.t('app-error'));
    assert.ok(u.t('app-retry'));
  }, { 'A.md': 'x' });
});

test('the list shows newest first with local modified times and highlights the open note', async () => {
  await withBackend(async (b) => {
    const old = new Date(Date.now() - 60000);
    fs.utimesSync(path.join(b.root, 'Old.md'), old, old);
    const u = await boot(b, { url: '/n/Old' });
    await waitFor(() => u.t('note-view'));
    assert.deepEqual(u.all('note-list-item').map((li) => li.getAttribute('data-title')), ['New', 'Old']);
    assert.match(u.all('note-list-item')[0].textContent, /Modified \d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
    assert.equal(u.all('note-list-item')[1].getAttribute('aria-current'), 'page');
    assert.equal(u.all('note-list-item')[0].getAttribute('aria-current'), null);
    assert.equal(u.all('note-list-item')[1].querySelector('a').getAttribute('title'), 'Old');
  }, { 'Old.md': 'o', 'New.md': 'n' });
});

test('the tab pattern: preview first for notes with text, arrows move between tabs, only the selected tab is tabbable', async () => {
  await withBackend(async (b) => {
    const u = await boot(b, { url: '/n/Full' });
    await waitFor(() => u.t('note-view'));
    assert.equal(u.t('note-view').getAttribute('data-tab'), 'preview');
    assert.equal(u.t('tab-preview').getAttribute('aria-selected'), 'true');
    assert.equal(u.t('tab-edit').getAttribute('tabindex'), '-1');
    u.t('tab-preview').focus();
    u.press('ArrowLeft');
    assert.equal(u.t('tab-edit').getAttribute('aria-selected'), 'true');
    assert.equal(u.focused(), 'tab-edit');
    u.press('ArrowRight');
    assert.equal(u.focused(), 'tab-preview');
    u.press('Home');
    assert.equal(u.focused(), 'tab-edit');
    u.press('End');
    assert.equal(u.focused(), 'tab-preview');
    u.press('a');
    assert.equal(u.focused(), 'tab-preview');
    u.t('tab-edit').click();
    assert.equal(u.t('note-view').getAttribute('data-tab'), 'edit');
    assert.equal(u.doc.querySelector('#panel-preview').getAttribute('data-active'), 'false');
  }, { 'Full.md': 'text', 'Empty.md': '' });
  await withBackend(async (b) => {
    const u = await boot(b, { url: '/n/Empty' });
    await waitFor(() => u.t('note-view'));
    assert.equal(u.t('note-view').getAttribute('data-tab'), 'edit');
  }, { 'Empty.md': '' });
});

test('the preview updates about 100 ms after typing and resolves links against the current list', async () => {
  await withBackend(async (b) => {
    const u = await boot(b, { url: '/n/Welcome' });
    await waitFor(() => u.t('note-view'));
    u.typeInto(u.t('editor'), '# Title\n\n[[Welcome]] and [[Missing]]');
    assert.equal(u.t('preview').querySelector('h2'), null, 'the preview waits for the debounce');
    await waitFor(() => u.t('preview').querySelector('h2'));
    assert.deepEqual(u.all('wikilink').map((a) => a.getAttribute('data-state')), ['exists', 'missing']);
  }, { 'Welcome.md': '' });
});

test('keyboard: Ctrl+K is ignored while a dialog is open and the skip link focuses main', async () => {
  await withBackend(async (b) => {
    const u = await boot(b);
    await settle(u);
    u.t('new-note-button').click();
    u.doc.body.dispatchEvent(key('keydown', { key: 'k', ctrlKey: true }));
    assert.notEqual(u.focused(), 'search-input');
    u.t('new-note-cancel').click();
    const ev = key('click', { button: 0 });
    u.t('skip-link').dispatchEvent(ev);
    assert.equal(ev.defaultPrevented, true);
    assert.equal(u.doc.activeElement.getAttribute('id'), 'main');
    assert.equal(u.t('search-input').getAttribute('placeholder'), 'Search notes (Ctrl+K)');
  }, { 'A.md': 'x' });
});
