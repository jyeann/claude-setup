'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { start, readConfig } = require('../src/server');
const { matchRoute, hostAllowed, matchesEtag, ROUTES } = require('../src/router');
const { createLimiter } = require('../src/rate-limiter');

let app;
let dir;
let base;
const CID = 'A'.repeat(22);
const call = (method, p, body, headers = {}) => fetch(base + p, {
  method,
  headers: { 'x-client-id': CID, ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
  body: body === undefined ? undefined : JSON.stringify(body),
});

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'router-'));
  app = await start({ ...readConfig({ PORT: '0', DATA_DIR: dir }), port: 0 });
  base = `http://127.0.0.1:${app.port}`;
});
after(async () => { await app.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('matchRoute finds known routes, captures segments and returns null otherwise', () => {
  const m = matchRoute('/api/boards/p1/f/f1/closed');
  assert.deepEqual(m.params, ['p1', 'f1']);
  assert.equal(m.route.methods.PUT, 'close');
  assert.equal(matchRoute('/nope'), null);
  assert.equal(matchRoute('/b/p/extra'), null);
  assert.ok(ROUTES.every((r) => Object.keys(r.methods).length >= 1));
});

test('hostAllowed enforces loopback hosts with the right port and same-origin Origin', () => {
  const ctx = { loopback: true, port: 3000 };
  const ok = (host, origin) => hostAllowed(ctx, { headers: { host, origin } });
  assert.equal(ok('localhost:3000'), true);
  assert.equal(ok('127.0.0.1:3000', 'http://127.0.0.1:3000'), true);
  assert.equal(ok('[::1]:3000'), true);
  assert.equal(ok('evil.example:3000'), false);
  assert.equal(ok('localhost:4000'), false);
  assert.equal(ok('localhost:3000', 'http://evil.example'), false);
  assert.equal(ok('localhost:3000', 'null'), false);
  assert.equal(ok(undefined), false);
  assert.equal(hostAllowed({ loopback: false, port: 1 }, { headers: { host: 'lan.box:9' } }), true);
});

test('matchesEtag handles lists, weak tags, wildcard and missing headers', () => {
  assert.equal(matchesEtag('"3"', '"3"'), true);
  assert.equal(matchesEtag('"1", W/"3"', '"3"'), true);
  assert.equal(matchesEtag('*', '"3"'), true);
  assert.equal(matchesEtag('"2"', '"3"'), false);
  assert.equal(matchesEtag(undefined, '"3"'), false);
});

test('a foreign Host or Origin gets 403 and no CORS headers', async () => {
  const raw = (headers) => new Promise((resolve, reject) => {
    const r = require('node:http').request({ host: '127.0.0.1', port: app.port, path: '/', headers, agent: false }, (res) => {
      res.resume();
      res.on('end', () => resolve(res));
    });
    r.on('error', reject);
    r.end();
  });
  const badHost = await raw({ host: 'evil.example' });
  assert.equal(badHost.statusCode, 403);
  const badOrigin = await raw({ host: `127.0.0.1:${app.port}`, origin: 'http://evil.example' });
  assert.equal(badOrigin.statusCode, 403);
  assert.equal(badOrigin.headers['access-control-allow-origin'], undefined);
  assert.equal((await raw({ host: `localhost:${app.port}` })).statusCode, 200);
});

test('a missing or malformed X-Client-Id gets 400 bad_client_id', async () => {
  for (const id of [null, 'short', `${'a'.repeat(21)}!`]) {
    const res = await call('POST', '/api/boards', { title: 'x' }, { 'x-client-id': id === null ? undefined : id });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error.code, 'bad_client_id');
  }
});

test('writes with a non-object JSON body get 400 bad_json and wrong media type 415', async () => {
  for (const raw of ['[]', 'null', '"s"', '']) {
    const res = await fetch(`${base}/api/boards`, { method: 'POST', headers: { 'x-client-id': CID, 'content-type': 'application/json' }, body: raw });
    assert.equal(res.status, 400, raw);
    assert.equal((await res.json()).error.code, 'bad_json');
  }
  const res = await fetch(`${base}/api/boards`, { method: 'POST', headers: { 'x-client-id': CID, 'content-type': 'text/plain' }, body: '{}' });
  assert.equal(res.status, 415);
});

test('a body over 8192 bytes gets 413 and the server still answers afterwards', async () => {
  const big = await fetch(`${base}/api/boards`, { method: 'POST', headers: { 'x-client-id': CID, 'content-type': 'application/json' }, body: JSON.stringify({ title: 'a'.repeat(9000) }) });
  assert.equal(big.status, 413);
  assert.equal((await call('GET', '/')).status, 200);
});

test('a wrong method gets 405 with Allow listing the supported ones', async () => {
  const res = await call('PATCH', '/api/boards/x/cards/1/vote', {});
  assert.equal(res.status, 405);
  assert.equal(res.headers.get('allow'), 'PUT, DELETE');
  assert.equal((await call('OPTIONS', '/')).status, 405);
});

test('create, add, vote and export flow returns views without hashes and ETags per version', async () => {
  const created = await (await call('POST', '/api/boards', { title: 'Flow' })).json();
  const { participantToken: p, facilitatorToken: f } = created;
  assert.equal(created.board.role, 'facilitator');
  const add = await call('POST', `/api/boards/${p}/cards`, { column: 'actions', text: 'ship' });
  assert.equal(add.status, 201);
  assert.equal(add.headers.get('etag'), '"2"');
  await call('PUT', `/api/boards/${p}/cards/1/vote`);
  const noop = await call('PUT', `/api/boards/${p}/cards/1/vote`);
  assert.equal(noop.headers.get('etag'), '"3"');
  const exp = await (await call('GET', `/api/boards/${p}/f/${f}/export`)).json();
  assert.ok(exp.markdown.includes('- [ ] ship (1 vote)'));
  assert.equal(exp.filename, 'flow.md');
  const raw = JSON.stringify(await (await call('GET', `/api/boards/${p}/f/${f}`)).json());
  assert.ok(!raw.includes(p) && !raw.includes(f));
});

test('a 409 carries the fresh view with the facilitator role on facilitator routes', async () => {
  const { participantToken: p, facilitatorToken: f } = await (await call('POST', '/api/boards', { title: 'C' })).json();
  await call('PUT', `/api/boards/${p}/f/${f}/closed`, { closed: true });
  const res = await call('POST', `/api/boards/${p}/cards`, { column: 'actions', text: 'x' });
  assert.equal(res.status, 409);
  const body = await res.json();
  assert.equal(body.board.closed, true);
  assert.equal(body.board.role, 'participant');
  const wrong = await call('PUT', `/api/boards/${p}/f/${'z'.repeat(22)}/closed`, { closed: false });
  assert.equal(wrong.status, 403);
});

test('the limiter answers 429 with Retry-After when exceeded', async () => {
  const limited = createLimiter({ limit: 0 });
  const { createRouter } = require('../src/router');
  const handle = createRouter({
    store: app.store, pages: {}, assets: new Map(), loopback: true, port: app.port,
    limiters: { create: limited, write: limited, read: limited },
  });
  const res = { headersSent: false, writeHead(s, h) { this.status = s; this.h = h; }, end(b) { this.body = b; } };
  await handle({ url: '/', method: 'GET', headers: { host: `localhost:${app.port}` }, socket: { remoteAddress: '9.9.9.9' }, resume() {} }, res);
  assert.equal(res.status, 429);
  assert.equal(res.h['Retry-After'], 60);
  assert.equal(JSON.parse(res.body).error.code, 'rate_limited');
});

test('an unexpected handler error gives a generic 500 and the server keeps running', async () => {
  const { createRouter } = require('../src/router');
  const handle = createRouter({
    store: { get() { throw new Error('boom'); } }, pages: {}, assets: new Map(), loopback: false, port: 1,
  });
  const res = { headersSent: false, writeHead(s) { this.status = s; }, end(b) { this.body = b; } };
  await handle({ url: `/api/boards/${'a'.repeat(22)}`, method: 'GET', headers: { host: 'h', 'x-client-id': CID }, socket: {}, resume() {} }, res);
  assert.equal(res.status, 500);
  assert.equal(JSON.parse(res.body).error.code, 'internal_error');
  assert.equal((await call('GET', '/')).status, 200);
});
