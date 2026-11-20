import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, mapError, createApi, noteApiPath } from '../public/js/api.js';

const json = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body });

function fakeFetch(handler) {
  const calls = [];
  const fn = async (url, init) => { calls.push({ url, init }); return handler(url, init); };
  fn.calls = calls;
  return fn;
}

test('mapError reads code, message and extra params from the error body', () => {
  const e = mapError(409, { error: { code: 'title_exists', message: 'A note called "X" already exists.', existing: 'X' } });
  assert.ok(e instanceof ApiError);
  assert.equal(e.status, 409);
  assert.equal(e.code, 'title_exists');
  assert.equal(e.params.existing, 'X');
  assert.equal(e.message, 'A note called "X" already exists.');
  assert.equal(e.network, false);
});

test('mapError copes with missing or odd bodies', () => {
  assert.equal(mapError(500, null).code, 'http_error');
  assert.equal(mapError(500, 'text').code, 'http_error');
  assert.equal(mapError(502, { error: 'nope' }).code, 'http_error');
  assert.equal(mapError(400, { error: { code: 7, message: 3 } }).message, 'The request failed.');
});

test('note paths encode the title once', () => {
  assert.equal(noteApiPath('Project ideas'), '/api/notes/Project%20ideas');
  assert.equal(noteApiPath('100% sure'), '/api/notes/100%25%20sure');
});

test('saveNote sends If-Match with quoted revision and the content as JSON', async () => {
  const f = fakeFetch(async () => json(200, { title: 'A', revision: 'r2' }));
  const res = await createApi(f).saveNote('A b', 'text', 'r1');
  assert.equal(res.revision, 'r2');
  const { url, init } = f.calls[0];
  assert.equal(url, '/api/notes/A%20b');
  assert.equal(init.method, 'PUT');
  assert.equal(init.headers['If-Match'], '"r1"');
  assert.equal(init.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(init.body), { content: 'text' });
});

test('GET requests send no body and no content type', async () => {
  const f = fakeFetch(async () => json(200, { notes: [{ title: 'A' }] }));
  assert.deepEqual(await createApi(f).listNotes(), [{ title: 'A' }]);
  assert.equal(f.calls[0].init.body, undefined);
  assert.equal(f.calls[0].init.headers['Content-Type'], undefined);
});

test('deleteNote returns null for 204 and errors map to ApiError', async () => {
  const ok = createApi(fakeFetch(async () => ({ status: 204, ok: true })));
  assert.equal(await ok.deleteNote('A'), null);
  const bad = createApi(fakeFetch(async () => json(404, { error: { code: 'note_not_found', message: 'Note not found.' } })));
  await assert.rejects(bad.deleteNote('A'), (e) => e.status === 404 && e.code === 'note_not_found');
});

test('a failing fetch becomes a network ApiError, an abort stays an AbortError', async () => {
  const down = createApi(fakeFetch(async () => { throw new TypeError('Failed to fetch'); }));
  await assert.rejects(down.graph(), (e) => e instanceof ApiError && e.network === true && e.status === 0);
  const aborted = createApi(fakeFetch(async () => { const e = new Error('x'); e.name = 'AbortError'; throw e; }));
  await assert.rejects(aborted.search('q'), (e) => e.name === 'AbortError' && !(e instanceof ApiError));
});

test('a body that is not JSON still gives a status based error', async () => {
  const f = fakeFetch(async () => ({ status: 500, ok: false, json: async () => { throw new Error('bad json'); } }));
  await assert.rejects(createApi(f).getNote('A'), (e) => e.status === 500 && e.code === 'http_error');
});

test('search, rename, backlinks and create use the right URLs and payloads', async () => {
  const f = fakeFetch(async (url) => (url.includes('backlinks') ? json(200, { backlinks: [1] }) : json(200, {})));
  const api = createApi(f);
  await api.search('a&b', 'SIGNAL');
  await api.renameNote('Old', 'New');
  assert.deepEqual(await api.backlinks('X'), [1]);
  await api.createNote('T');
  assert.equal(f.calls[0].url, '/api/search?q=a%26b');
  assert.equal(f.calls[0].init.signal, 'SIGNAL');
  assert.equal(f.calls[1].url, '/api/notes/Old/rename');
  assert.deepEqual(JSON.parse(f.calls[1].init.body), { title: 'New' });
  assert.equal(f.calls[2].url, '/api/notes/X/backlinks');
  assert.deepEqual(JSON.parse(f.calls[3].init.body), { title: 'T', content: '' });
});
