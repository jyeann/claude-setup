import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openVault } from '../src/vault.js';
import { Index } from '../src/index.js';
import { loadStatic } from '../src/http.js';
import { createHandler, matchApi, titleFromSegment, allowedHosts, MAX_BODY_BYTES } from '../src/router.js';
import { renameNote } from '../src/rename.js';
import { StorageError, WikiError } from '../src/errors.js';

const PUBLIC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

async function withApp(fn, setup = () => {}) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-rt-')));
  const vault = openVault(path.join(base, 'v'));
  setup(vault.root);
  const index = new Index(vault, () => {});
  index.scan();
  const ctx = { index, vault };
  let port = 0;
  const logs = [];
  const handler = createHandler({ ctx, statics: loadStatic(PUBLIC), getPort: () => port, log: (m) => logs.push(m) });
  const server = http.createServer({ requireHostHeader: false }, handler);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
  const call = (method, url, body, headers = {}) => new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body);
    const h = { host: `localhost:${port}`, ...(payload !== undefined ? { 'content-type': 'application/json' } : {}), ...headers };
    for (const k of Object.keys(h)) if (h[k] === null) delete h[k];
    const req = http.request({ port, host: '127.0.0.1', method, path: url, headers: h, setHost: false, agent: false }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString();
        let json = null;
        try { json = JSON.parse(text); } catch { /* not json */ }
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    req.on('error', reject);
    req.end(payload);
  });
  try {
    return await fn({ call, ctx, logs, root: vault.root, port });
  } finally {
    await new Promise((r) => { server.close(r); server.closeAllConnections(); });
    fs.rmSync(base, { recursive: true, force: true });
  }
}
const code = (res) => res.json && res.json.error && res.json.error.code;

test('matchApi picks routes by segment count and shape', () => {
  assert.equal(matchApi(['notes']).name, 'notes');
  assert.equal(matchApi(['search']).name, 'search');
  assert.deepEqual(matchApi(['notes', 'A']), { name: 'note', raw: 'A' });
  assert.deepEqual(matchApi(['notes', 'A', 'rename']), { name: 'rename', raw: 'A' });
  assert.equal(matchApi(['notes', 'A', 'backlinks']).name, 'backlinks');
  for (const segs of [[], [''], ['nope'], ['constructor'], ['notes', 'A', 'x'], ['notes', 'A', 'rename', 'x'], ['search', 'x'], ['graph', 'x']]) {
    assert.equal(matchApi(segs).name, null, JSON.stringify(segs));
  }
});

test('titleFromSegment decodes once and validates', () => {
  assert.deepEqual(titleFromSegment('Caf%C3%A9'), { title: 'Café', key: 'café' });
  for (const bad of [undefined, '', '..', '%2e%2e%2fsecret', 'a%2Fb', '%E0%A4%A', 'a%00b', '.hidden', 'CON']) assert.equal(titleFromSegment(bad), null, String(bad));
  assert.equal(titleFromSegment('%252e').title, '%2e');
  assert.deepEqual([...allowedHosts(80)], ['localhost:80', '127.0.0.1:80', '[::1]:80']);
  assert.equal(MAX_BODY_BYTES, 2098176);
});

test('Host is checked first, and a missing Host is 403 bad_host', () => withApp(async ({ call }) => {
  for (const host of [null, 'evil.example', 'localhost']) {
    const res = await call('GET', '/api/nope', undefined, { host });
    assert.equal(res.status, 403);
    assert.equal(code(res), 'bad_host');
  }
  assert.equal((await call('GET', '/api/notes')).status, 200);
}));

test('routing: unknown API 404, wrong method 405 with Allow, static fallback', () => withApp(async ({ call }) => {
  assert.equal(code(await call('GET', '/api/nope')), 'not_found');
  assert.equal(code(await call('GET', '/api')), 'not_found');
  const m = await call('PATCH', '/api/notes/x');
  assert.equal(m.status, 405);
  assert.equal(m.headers.allow, 'GET, PUT, DELETE');
  assert.equal((await call('POST', '/')).headers.allow, 'GET');
  const shell = await call('GET', '/n/%2e%2e%2fsecret');
  assert.equal(shell.status, 200);
  assert.match(shell.text, /<html/);
  const js = await call('GET', '/js/titles.js');
  assert.equal(js.headers['content-type'], 'text/javascript; charset=utf-8');
  assert.equal(js.text, fs.readFileSync(path.join(PUBLIC, 'js', 'titles.js'), 'utf8'));
  assert.equal(js.headers['x-content-type-options'], 'nosniff');
}));

test('check order: title segment, then Origin, then media type, then size, then JSON', () => withApp(async ({ call }) => {
  const evil = { origin: 'http://evil.example' };
  assert.equal(code(await call('DELETE', '/api/notes/a%2Fb', undefined, evil)), 'note_not_found');
  assert.equal(code(await call('POST', '/api/notes', '{}', { ...evil, 'content-type': 'text/plain' })), 'bad_origin');
  assert.equal(code(await call('POST', '/api/notes', '{}', { 'content-type': 'text/plain' })), 'unsupported_media_type');
  assert.equal(code(await call('POST', '/api/notes', '{}', { 'sec-fetch-site': 'cross-site' })), 'bad_origin');
  assert.equal(code(await call('POST', '/api/notes', '{', { 'content-length': '3000000' })), 'too_large');
  assert.equal(code(await call('POST', '/api/notes', '{')), 'bad_request');
  assert.equal(code(await call('PUT', '/api/notes/..', '{', { 'if-match': '"x"' })), 'note_not_found');
  assert.equal(code(await call('POST', '/api/notes/Missing/rename', '{')), 'bad_request');
  assert.equal(code(await call('POST', '/api/notes/Missing/rename', { title: 'N' })), 'note_not_found');
  assert.equal((await call('POST', '/api/notes', { title: 'ok' }, { origin: 'http://localhost' })).status, 403);
}));

test('body shape: flat objects only, unknown keys ignored, wrong types 400', () => withApp(async ({ call }) => {
  for (const raw of ['[]', 'null', '{"title":5}', '{"title":"a","x":{"y":1}}', '{"title":"a","x":[1]}', '{"title":"a","content":null}', '{}']) {
    assert.equal(code(await call('POST', '/api/notes', raw)), 'bad_request', raw);
  }
  assert.equal((await call('POST', '/api/notes', '{"title":"a","x":null,"y":1,"z":true}')).status, 201);
  assert.equal(code(await call('PUT', '/api/notes/a', '{"content":1}', { 'if-match': '"x"' })), 'bad_request');
}));

test('a streamed body over the limit is 413 too_large', () => withApp(async ({ call }) => {
  const big = `{"title":"x","content":"${'a'.repeat(MAX_BODY_BYTES)}"}`;
  let res;
  try { res = await call('POST', '/api/notes', big); } catch (e) { res = await call('POST', '/api/notes', big); }
  assert.equal(res.status, 413);
  assert.equal(code(res), 'too_large');
  assert.equal((await call('GET', '/api/notes')).status, 200);
}));

test('CRUD round trip with revisions, conflicts and fixed messages', () => withApp(async ({ call, root }) => {
  const made = await call('POST', '/api/notes', { title: ' Ideas ', content: 'v1' });
  assert.equal(made.status, 201);
  assert.equal(made.headers.location, '/api/notes/Ideas');
  const dup = await call('POST', '/api/notes', { title: 'IDEAS' });
  assert.deepEqual(dup.json.error, { code: 'title_exists', message: 'A note called "Ideas" already exists. Choose another title.', existing: 'Ideas' });
  const got = await call('GET', '/api/notes/ideas');
  assert.equal(got.json.title, 'Ideas');
  assert.equal(got.headers.etag, `"${got.json.revision}"`);
  assert.equal(code(await call('PUT', '/api/notes/Ideas', { content: 'x' })), 'revision_required');
  const ok = await call('PUT', '/api/notes/Ideas', { content: 'v2' }, { 'if-match': `"${got.json.revision}"` });
  assert.equal(ok.status, 200);
  const stale = await call('PUT', '/api/notes/Ideas', { content: 'v3' }, { 'if-match': `"${got.json.revision}"` });
  assert.equal(stale.status, 412);
  assert.equal(stale.json.error.currentRevision, ok.json.revision);
  assert.equal(stale.json.error.message, 'This note changed since you opened it.');
  assert.equal(fs.readFileSync(path.join(root, 'Ideas.md'), 'utf8'), 'v2');
  assert.equal((await call('DELETE', '/api/notes/Ideas', undefined, { 'if-match': '*' })).status, 412);
  const del = await call('DELETE', '/api/notes/Ideas');
  assert.equal(del.status, 204);
  assert.equal(del.text, '');
  assert.equal(code(await call('GET', '/api/notes/Ideas')), 'note_not_found');
  assert.equal(code(await call('DELETE', '/api/notes/Ideas')), 'note_not_found');
}));

test('note size limit is 2 MiB of UTF-8 bytes on create and save', () => withApp(async ({ call, root }) => {
  const over = '€'.repeat(699051);
  assert.equal(code(await call('POST', '/api/notes', { title: 'Big', content: over })), 'note_too_large');
  assert.equal(fs.existsSync(path.join(root, 'Big.md')), false);
  const made = await call('POST', '/api/notes', { title: 'Edge', content: 'a'.repeat(2097152) });
  assert.equal(made.status, 201);
  const put = await call('PUT', '/api/notes/Edge', { content: `${'a'.repeat(2097152)}b` }, { 'if-match': `"${made.json.revision}"` });
  assert.equal(code(put), 'note_too_large');
}));

test('an unexpected exception is a generic 500 internal and is logged', () => withApp(async ({ call, ctx, logs }) => {
  ctx.index.scan = () => { throw new Error('boom secret'); };
  const res = await call('GET', '/api/notes');
  assert.equal(res.status, 500);
  assert.equal(code(res), 'internal');
  assert.doesNotMatch(res.text, /boom/);
  assert.match(logs[0], /boom secret/);
}));

test('search validates q and graph/backlinks work over HTTP', () => withApp(async ({ call }) => {
  assert.equal(code(await call('GET', '/api/search')), 'bad_request');
  assert.equal(code(await call('GET', `/api/search?q=${'a'.repeat(201)}`)), 'bad_request');
  assert.equal((await call('GET', `/api/search?q=${'a'.repeat(200)}`)).status, 200);
  assert.deepEqual((await call('GET', '/api/search?q=+')).json, { query: '', total: 0, results: [] });
  const hit = await call('GET', '/api/search?q=%3Cb%3E');
  assert.deepEqual(hit.json.results.map((r) => [r.title, r.ranges]), [['B', [[2, 5]]]]);
  assert.deepEqual((await call('GET', '/api/graph')).json.edges, [['A', 'B']]);
  assert.deepEqual((await call('GET', '/api/notes/B/backlinks')).json.backlinks, [{ title: 'A', snippet: 'to [[B]]' }]);
  assert.equal(code(await call('GET', '/api/notes/Zzz/backlinks')), 'note_not_found');
}, (root) => {
  fs.writeFileSync(path.join(root, 'A.md'), 'to [[B]]');
  fs.writeFileSync(path.join(root, 'B.md'), 'a <b>x</b>');
}));

test('rename rewrites links, reports failures and leaves unrelated notes alone', () => withApp(async ({ call, ctx, root }) => {
  const other = fs.readFileSync(path.join(root, 'Other.md'));
  const res = await call('POST', '/api/notes/Old/rename', { title: 'New' });
  assert.equal(res.status, 200);
  assert.deepEqual([res.json.title, res.json.updated, res.json.failed], ['New', ['A'], []]);
  assert.equal(fs.readFileSync(path.join(root, 'A.md'), 'utf8'), '[[New]] [[New|x]]');
  assert.equal(fs.readFileSync(path.join(root, 'New.md'), 'utf8'), 'self [[New]]');
  assert.deepEqual(fs.readFileSync(path.join(root, 'Other.md')), other);
  assert.equal((await call('POST', '/api/notes/New/rename', { title: 'new' })).status, 200);
  assert.equal((await call('POST', '/api/notes/new/rename', { title: 'Other' })).status, 409);
  // a write failure is listed in `failed` and the loop continues
  const real = ctx.vault.writeAtomic.bind(ctx.vault);
  ctx.vault.writeAtomic = (name, buf) => { if (name === 'A.md') throw new StorageError('disk'); return real(name, buf); };
  const part = renameNote(ctx, 'new', 'Newer');
  assert.deepEqual(part.failed, [{ title: 'A', reason: 'write_failed' }]);
  assert.deepEqual(part.updated, []);
  assert.equal(fs.readFileSync(path.join(root, 'A.md'), 'utf8'), '[[new]] [[new|x]]');
  assert.throws(() => renameNote(ctx, 'missing', 'Q'), (e) => e instanceof WikiError && e.status === 404);
}, (root) => {
  fs.writeFileSync(path.join(root, 'Old.md'), 'self [[old]]');
  fs.writeFileSync(path.join(root, 'A.md'), '[[Old]] [[OLD|x]]');
  fs.writeFileSync(path.join(root, 'Other.md'), 'nothing\r\n');
}));
