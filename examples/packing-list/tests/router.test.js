'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../src/server');
const { hostAllowed, hostnameOf } = require('../src/router');

let dir;
let app;
let port;

function call(method, url, body, headers = {}, opts = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : Buffer.from(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
    const h = { ...(payload ? { 'content-type': 'application/json', 'content-length': payload.length } : {}), ...headers };
    const req = http.request({ host: '127.0.0.1', port: opts.port || port, method, path: url, headers: h, agent: false }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch { /* html */ }
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    req.on('error', reject);
    req.end(payload || undefined);
  });
}

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'router-'));
  app = createApp({ dataFile: path.join(dir, 'lists.json'), host: '127.0.0.1' });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  port = app.server.address().port;
});
after(async () => {
  await new Promise((r) => { app.server.close(r); app.server.closeAllConnections(); });
  fs.rmSync(dir, { recursive: true, force: true });
});

const make = async (name = 'Trip') => (await call('POST', '/api/lists', { name })).json;
const errorOf = (res) => `${res.status} ${res.json && res.json.error && res.json.error.code}`;

test('hostnameOf strips ports and keeps bracketed IPv6', () => {
  assert.equal(hostnameOf('LocalHost:3000'), 'localhost');
  assert.equal(hostnameOf('127.0.0.1'), '127.0.0.1');
  assert.equal(hostnameOf('[::1]:8080'), '[::1]');
  assert.equal(hostnameOf('[::1'), '[::1');
});

test('hostAllowed: loopback hosts pass, others and a missing Host fail on loopback', () => {
  const ok = (host, origin) => hostAllowed({ headers: { host, origin } }, true);
  assert.equal(ok('localhost:1'), true);
  assert.equal(ok('127.0.0.1:1'), true);
  assert.equal(ok('[::1]:1'), true);
  assert.equal(ok('evil.example:1'), false);
  assert.equal(ok('localhost.evil.example'), false);
  assert.equal(ok(undefined), false);
  assert.equal(hostAllowed({ headers: { host: 'evil.example' } }, false), true);
});

test('hostAllowed: an Origin must have the same host as Host', () => {
  const ok = (host, origin) => hostAllowed({ headers: { host, origin } }, true);
  assert.equal(ok('localhost:3000', 'http://localhost:3000'), true);
  assert.equal(ok('localhost:3000', 'http://LOCALHOST:3000'), true);
  assert.equal(ok('localhost:3000', 'http://localhost:3001'), false);
  assert.equal(ok('localhost:3000', 'http://evil.example'), false);
  assert.equal(ok('localhost:3000', 'null'), false);
  assert.equal(hostAllowed({ headers: { host: 'lan:1', origin: 'http://lan:1' } }, false), true);
  assert.equal(hostAllowed({ headers: { host: 'lan:1', origin: 'http://other:1' } }, false), false);
});

test('a wrong Host header gets 403 forbidden JSON with security headers on pages and API', async () => {
  for (const p of ['/', '/api/lists/x', '/nothing']) {
    const res = await call('GET', p, undefined, { host: 'evil.example' });
    assert.equal(res.status, 403, p);
    assert.deepEqual(res.json, { error: { code: 'forbidden', message: 'Forbidden.' } });
    assert.equal(res.headers['cache-control'], 'no-store');
    assert.equal(res.headers['x-frame-options'], 'DENY');
  }
});

test('a cross-site Origin gets 403 and the list is not created', async () => {
  const before = app.store.size();
  const res = await call('POST', '/api/lists', { name: 'Evil' }, { origin: 'http://evil.example' });
  assert.equal(errorOf(res), '403 forbidden');
  assert.equal(app.store.size(), before);
  const same = await call('POST', '/api/lists', { name: 'Fine' }, { origin: `http://127.0.0.1:${port}` });
  assert.equal(same.status, 201);
});

test('a matching Origin with a loopback Host name is accepted', async () => {
  const res = await call('GET', '/', undefined, { host: `localhost:${port}`, origin: `http://localhost:${port}` });
  assert.equal(res.status, 200);
});

test('POST creates, GET reads, and an unknown or malformed id gives the same 404', async () => {
  const list = await make('Lisbon');
  assert.deepEqual((await call('GET', `/api/lists/${list.id}`)).json, { id: list.id, name: 'Lisbon', items: [] });
  const unknown = await call('GET', `/api/lists/${'Q'.repeat(22)}`);
  const malformed = await call('GET', '/api/lists/not-an-id');
  const encoded = await call('GET', '/api/lists/%2e%2e');
  assert.equal(errorOf(unknown), '404 list_not_found');
  assert.deepEqual(malformed.json, unknown.json);
  assert.deepEqual(encoded.json, unknown.json);
});

test('query strings are ignored for routing', async () => {
  const list = await make();
  assert.equal((await call('GET', `/api/lists/${list.id}?x=1`)).status, 200);
  assert.equal((await call('GET', `/l/${list.id}?x=1#top`)).status, 200);
});

test('item flow: add, tick, remove keep order and ids', async () => {
  const list = await make();
  const base = `/api/lists/${list.id}`;
  await call('POST', `${base}/items`, { text: 'A' });
  await call('POST', `${base}/items`, { text: 'B' });
  const c = await call('POST', `${base}/items`, { text: 'C' });
  assert.equal(c.status, 201);
  assert.deepEqual(c.json.items.map((i) => i.id), ['1', '2', '3']);
  const ticked = await call('PUT', `${base}/items/2/ticked`, { ticked: true });
  assert.deepEqual(ticked.json.items.map((i) => i.ticked), [false, true, false]);
  const removed = await call('DELETE', `${base}/items/1`);
  assert.deepEqual(removed.json.items.map((i) => i.text), ['B', 'C']);
  const next = await call('POST', `${base}/items`, { text: 'D' });
  assert.equal(next.json.items[2].id, '4');
});

test('adding the 201st item gives 409 list_full and the count stays 200', async () => {
  const list = await make();
  const base = `/api/lists/${list.id}`;
  let last;
  for (let i = 0; i < 200; i += 1) last = await call('POST', `${base}/items`, { text: `i${i}` });
  assert.equal(last.json.items.length, 200);
  const res = await call('POST', `${base}/items`, { text: 'more' });
  assert.equal(res.status, 409);
  assert.deepEqual(res.json, { error: { code: 'list_full', message: 'This list is full (200 items)' } });
  assert.equal((await call('GET', base)).json.items.length, 200);
});

test('item validation messages come back over HTTP, and a control character is item_invalid', async () => {
  const list = await make();
  const url = `/api/lists/${list.id}/items`;
  assert.equal(errorOf(await call('POST', url, { text: 'a\tb' })), '400 item_invalid');
  assert.equal(errorOf(await call('POST', url, { text: '' })), '400 item_empty');
  assert.equal(errorOf(await call('POST', url, { text: 7 })), '400 invalid_body');
  assert.equal((await call('POST', url, { text: '\u{1F600}'.repeat(120) })).status, 201);
  assert.equal(errorOf(await call('POST', url, { text: '\u{1F600}'.repeat(121) })), '400 item_too_long');
  assert.equal(errorOf(await call('POST', '/api/lists', { name: 'a\u0000b' })), '400 name_invalid');
  assert.equal((await call('POST', '/api/lists', { name: '\u{1F600}'.repeat(80) })).status, 201);
  assert.equal(errorOf(await call('POST', '/api/lists', { name: '\u{1F600}'.repeat(81) })), '400 name_too_long');
});

test('tick validation: non-boolean is invalid_body, unknown or malformed ids are 404', async () => {
  const list = await make();
  const base = `/api/lists/${list.id}`;
  await call('POST', `${base}/items`, { text: 'A' });
  for (const v of ['true', 1, null, undefined]) {
    assert.equal(errorOf(await call('PUT', `${base}/items/1/ticked`, { ticked: v })), '400 invalid_body');
  }
  assert.equal(errorOf(await call('PUT', `${base}/items/9/ticked`, { ticked: true })), '404 item_not_found');
  assert.equal(errorOf(await call('PUT', `${base}/items/abc/ticked`, { ticked: true })), '404 item_not_found');
  assert.equal(errorOf(await call('PUT', `${base}/items/01/ticked`, { ticked: true })), '404 item_not_found');
  assert.equal(errorOf(await call('DELETE', `${base}/items/9`)), '404 item_not_found');
  assert.equal(errorOf(await call('DELETE', `/api/lists/${'Q'.repeat(22)}/items/1`)), '404 list_not_found');
  assert.equal(errorOf(await call('PUT', `/api/lists/zzz/items/1/ticked`, { ticked: true })), '404 list_not_found');
});

test('repeating a ticked value is a 200 no-op', async () => {
  const list = await make();
  const base = `/api/lists/${list.id}`;
  await call('POST', `${base}/items`, { text: 'A' });
  const a = await call('PUT', `${base}/items/1/ticked`, { ticked: true });
  const b = await call('PUT', `${base}/items/1/ticked`, { ticked: true });
  assert.equal(b.status, 200);
  assert.deepEqual(b.json, a.json);
});

test('DELETE ignores its body and does not need a content type', async () => {
  const list = await make();
  const base = `/api/lists/${list.id}`;
  await call('POST', `${base}/items`, { text: 'A' });
  const res = await call('DELETE', `${base}/items/1`, 'garbage', { 'content-type': 'text/plain' });
  assert.equal(res.status, 200);
});

test('body errors: 415, 400 bad_json, 400 invalid_body, 413 and nothing is created', async () => {
  const before = app.store.size();
  assert.equal(errorOf(await call('POST', '/api/lists', '{"name":"x"}', { 'content-type': 'text/plain' })), '415 bad_content_type');
  assert.equal((await call('POST', '/api/lists', '{"name":"x"}', { 'content-type': 'application/json; charset=utf-8' })).status, 201);
  assert.equal(errorOf(await call('POST', '/api/lists', '{bad')), '400 bad_json');
  assert.equal(errorOf(await call('POST', '/api/lists', '[]')), '400 invalid_body');
  const big = await call('POST', '/api/lists', JSON.stringify({ name: 'x', pad: 'p'.repeat(5000) }));
  assert.deepEqual(big.json, { error: { code: 'body_too_large', message: 'Request body is too large.' } });
  assert.equal(big.status, 413);
  assert.equal(app.store.size(), before + 1);
});

test('a body of exactly 4096 bytes is read, 4097 is refused', async () => {
  const mk = (n) => { const base = JSON.stringify({ name: 'x', pad: '' }); return JSON.stringify({ name: 'x', pad: 'p'.repeat(n - Buffer.byteLength(base)) }); };
  assert.equal(Buffer.byteLength(mk(4096)), 4096);
  assert.equal((await call('POST', '/api/lists', mk(4096))).status, 201);
  assert.equal((await call('POST', '/api/lists', mk(4097))).status, 413);
});

test('unsupported methods give 405 with the Allow header; OPTIONS too', async () => {
  const list = await make();
  const cases = [
    ['GET', '/api/lists', 'POST'], ['PUT', `/api/lists/${list.id}`, 'GET'], ['DELETE', `/api/lists/${list.id}`, 'GET'],
    ['GET', `/api/lists/${list.id}/items`, 'POST'], ['POST', `/api/lists/${list.id}/items/1/ticked`, 'PUT'],
    ['POST', `/api/lists/${list.id}/items/1`, 'DELETE'], ['OPTIONS', '/api/lists', 'POST'], ['HEAD', `/api/lists/${list.id}`, 'GET'],
    ['POST', '/', 'GET, HEAD'], ['PUT', `/l/${list.id}`, 'GET, HEAD'], ['DELETE', '/assets/app.css', 'GET, HEAD'],
    ['POST', '/assets/nothing.js', 'GET, HEAD'], ['OPTIONS', '/', 'GET, HEAD'],
  ];
  for (const [method, url, allow] of cases) {
    const res = await call(method, url);
    assert.equal(res.status, 405, `${method} ${url}`);
    assert.equal(res.headers.allow, allow, `${method} ${url}`);
    if (method !== 'HEAD') assert.deepEqual(res.json, { error: { code: 'method_not_allowed', message: 'Method not allowed.' } });
  }
});

test('unknown /api paths give JSON 404 not_found, even with a trailing slash', async () => {
  for (const p of ['/api', '/api/', '/api/nope', '/api/lists/', '/api/lists/x/y']) {
    const res = await call('GET', p);
    assert.deepEqual(res.json, { error: { code: 'not_found', message: 'Not found.' } }, p);
    assert.equal(res.status, 404, p);
  }
});

test('page routes: list page is 200 only for an existing id, HEAD has no body', async () => {
  const list = await make();
  assert.equal((await call('GET', `/l/${list.id}`)).status, 200);
  const head = await call('HEAD', `/l/${list.id}`);
  assert.equal(head.status, 200);
  assert.equal(head.text, '');
  assert.equal((await call('GET', `/l/${'Q'.repeat(22)}`)).status, 404);
  assert.equal((await call('GET', `/l/${list.id}/`)).status, 404);
  assert.equal((await call('GET', '/l/')).status, 404);
  assert.equal((await call('HEAD', '/nothing')).status, 404);
});

test('POST to an unknown non-API path is a JSON 404', async () => {
  const res = await call('POST', '/nothing', {});
  assert.equal(errorOf(res), '404 not_found');
});

test('assets: allowlisted files are served with a type, traversal attempts and unknown names are 404', async () => {
  const css = await call('GET', '/assets/app.css');
  assert.equal(css.status, 200);
  assert.equal(css.headers['content-type'], 'text/css; charset=utf-8');
  const js = await call('GET', '/assets/js/list.js');
  assert.equal(js.headers['content-type'], 'text/javascript; charset=utf-8');
  for (const p of ['/assets/../src/server.js', '/assets/%2e%2e/package.json', '/assets/js%2flist.js', '/assets/js/', '/assets/', '/assets', '/assets/js/nope.js', '/../package.json']) {
    const res = await call('GET', p);
    assert.equal(res.status, 404, p);
    assert.match(res.headers['content-type'], /^text\/html/, p);
    assert.ok(!res.text.includes('"engines"'), p);
  }
});

test('every response kind carries the security headers', async () => {
  const list = await make();
  const responses = [
    await call('GET', '/'), await call('GET', '/assets/app.css'), await call('GET', '/nope'), await call('GET', `/api/lists/${list.id}`),
    await call('POST', '/api/lists', '{bad'), await call('DELETE', '/'), await call('GET', '/api/nope'),
  ];
  for (const res of responses) {
    for (const [k, v] of Object.entries(require('../src/http').securityHeaders())) assert.equal(res.headers[k.toLowerCase()], v, k);
  }
});

test('a malformed request line gets 400 with security headers', async () => {
  const res = await new Promise((resolve, reject) => {
    const net = require('node:net');
    const s = net.connect(port, '127.0.0.1', () => s.write('GARBAGE\r\n\r\n'));
    let data = '';
    s.on('data', (c) => { data += c; });
    s.on('close', () => resolve(data));
    s.on('error', reject);
  });
  assert.match(res, /^HTTP\/1\.1 400/);
  assert.match(res, /Cache-Control: no-store/i);
});

test('text round-trips unchanged and the data file holds it', async () => {
  const list = await make('<b>hi</b>');
  const added = await call('POST', `/api/lists/${list.id}/items`, { text: '<b>hi</b>' });
  assert.equal(added.json.items[0].text, '<b>hi</b>');
  const file = JSON.parse(fs.readFileSync(path.join(dir, 'lists.json'), 'utf8'));
  assert.equal(file.lists[list.id].name, '<b>hi</b>');
  assert.equal(file.lists[list.id].items[0].text, '<b>hi</b>');
});

test('a failing disk write gives 503 storage_error and the list is unchanged', async () => {
  const list = await make();
  const file = path.join(dir, 'lists.json');
  const onDisk = fs.readFileSync(file, 'utf8');
  const realRename = fs.renameSync;
  fs.renameSync = () => { throw new Error('read-only'); };
  let res;
  try { res = await call('POST', `/api/lists/${list.id}/items`, { text: 'X' }); } finally { fs.renameSync = realRename; }
  assert.deepEqual(res.json, { error: { code: 'storage_error', message: 'Could not save that change. Try again.' } });
  assert.equal(res.status, 503);
  assert.equal((await call('GET', `/api/lists/${list.id}`)).json.items.length, 0);
  assert.equal(fs.readFileSync(file, 'utf8'), onDisk);
});

test('an unexpected exception gives 500 internal_error and the server keeps going', async () => {
  const realGet = app.store.get;
  app.store.get = () => { throw new Error('surprise'); };
  let res;
  const realWrite = process.stderr.write;
  process.stderr.write = () => true;
  try { res = await call('GET', `/api/lists/${'Q'.repeat(22)}`); } finally { app.store.get = realGet; process.stderr.write = realWrite; }
  assert.deepEqual(res.json, { error: { code: 'internal_error', message: 'Something went wrong.' } });
  assert.equal(res.status, 500);
  assert.equal((await call('GET', '/')).status, 200);
});

test('storage_full is returned when the list limit is reached', async () => {
  const small = createApp({ dataFile: path.join(dir, 'small.json'), maxLists: 1 });
  await new Promise((r) => small.server.listen(0, '127.0.0.1', r));
  const p = small.server.address().port;
  try {
    assert.equal((await call('POST', '/api/lists', { name: 'one' }, {}, { port: p })).status, 201);
    const res = await call('POST', '/api/lists', { name: 'two' }, {}, { port: p });
    assert.deepEqual(res.json, { error: { code: 'storage_full', message: 'Too many lists are stored.' } });
    assert.equal(res.status, 503);
  } finally {
    await new Promise((r) => { small.server.close(r); small.server.closeAllConnections(); });
  }
});

test('on a non-loopback HOST any Host header is accepted', async () => {
  const lan = createApp({ dataFile: path.join(dir, 'lan.json'), host: '0.0.0.0' });
  await new Promise((r) => lan.server.listen(0, '127.0.0.1', r));
  const p = lan.server.address().port;
  try {
    const res = await call('GET', '/', undefined, { host: 'pack.lan:1' }, { port: p });
    assert.equal(res.status, 200);
  } finally {
    await new Promise((r) => { lan.server.close(r); lan.server.closeAllConnections(); });
  }
});
