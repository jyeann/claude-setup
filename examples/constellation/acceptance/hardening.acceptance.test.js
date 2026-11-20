// Hardening row of the acceptance table, plus the SC5 traversal checks and the SC6 static-content rules.
// The wiki hardening suite ported with the spec.md "Interface" and "Request checks" changes: product name, lock names,
// the HTML permission page for a bad Host on non-API paths, the new routes, and the ux.md data-testid contract.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import {
  withServer, runToExit, sandbox, mk, getNote, listVault, snapshot, sha32, sleep, PUBLIC_DIR, READY_RE, LOCK_NAME, UX_MD, uxTestIds,
} from './helpers.js';

const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'";
const err = (res, status, code) => {
  assert.equal(res.status, status, res.text);
  assert.equal(res.body && res.body.error && res.body.error.code, code, res.text);
  assert.equal(typeof res.body.error.message, 'string');
};
const secure = (res, label) => {
  assert.equal(res.headers['content-security-policy'], CSP, `${label}: CSP`);
  assert.equal(res.headers['x-content-type-options'], 'nosniff', `${label}: nosniff`);
  assert.equal(res.headers['referrer-policy'], 'no-referrer', `${label}: referrer`);
  assert.equal(res.headers['x-frame-options'], 'DENY', `${label}: frame`);
  assert.equal(res.headers['cross-origin-opener-policy'], 'same-origin', `${label}: coop`);
  assert.equal(res.headers['cross-origin-resource-policy'], 'same-origin', `${label}: corp`);
  assert.deepEqual(Object.keys(res.headers).filter((h) => h.startsWith('access-control-')), [], `${label}: no CORS headers`);
};
const BAD_ORIGIN_MESSAGE = 'This request did not come from the Constellation page.';
const jsonHeaders = { 'content-type': 'application/json' };
const rawJson = (s, method, url, raw, extra = {}) => s.call(method, url, undefined, { raw, headers: { ...jsonHeaders, ...extra } });

// ---------------------------------------------------------------- Host
test('Host must be exactly localhost:<port>, 127.0.0.1:<port> or [::1]:<port>: /api gets 403 bad_host JSON, any other path the HTML permission page', () => withServer(async (s) => {
  const hosts = [null, 'evil.example', `evil.example:${s.port}`, 'localhost', `localhost:${s.port + 1}`, `127.0.0.1.evil.example:${s.port}`,
    `localhost.evil.example:${s.port}`, `[::2]:${s.port}`, '127.0.0.1', `0.0.0.0:${s.port}`];
  for (const host of hosts) {
    for (const [method, url, body] of [['GET', '/api/notes', undefined], ['POST', '/api/notes', { title: 'x' }], ['GET', '/api/sky', undefined],
      ['GET', '/api/unlit', undefined], ['DELETE', '/api/samples', undefined], ['GET', '/api', undefined], ['GET', '/api/', undefined]]) {
      const res = await s.call(method, url, body, { headers: { host } });
      err(res, 403, 'bad_host');
    }
    for (const [method, url] of [['GET', '/'], ['GET', '/app.css'], ['GET', '/n/Doc'], ['GET', '/js/titles.js'], ['GET', '/list'], ['POST', '/'], ['DELETE', '/x']]) {
      const res = await s.call(method, url, undefined, { headers: { host } });
      assert.equal(res.status, 403, `${host} ${method} ${url}`);
      assert.equal(res.headers['content-type'], 'text/html; charset=utf-8', `${host} ${method} ${url}`);
      assert.match(res.text, /data-testid="forbidden-page"/);
    }
  }
  assert.deepEqual(listVault(s.vault), []);
  for (const host of [`localhost:${s.port}`, `127.0.0.1:${s.port}`, `[::1]:${s.port}`]) {
    const res = await s.call('GET', '/api/notes', undefined, { headers: { host } });
    assert.equal(res.status, 200, host);
    assert.equal((await s.call('GET', '/', undefined, { headers: { host } })).status, 200, host);
  }
}));

test('check 57: the permission page for a bad Host is HTML with every security header, never echoes the request, and is built once', () => withServer(async (s) => {
  await mk(s, 'Secret plans', 'TOPSECRET note text');
  const evil = 'evil.example:1234';
  const pages = [];
  for (const [method, url] of [['GET', '/'], ['GET', '/n/Secret%20plans'], ['GET', '/app.css'], ['GET', '/js/titles.js'], ['POST', '/'], ['PUT', '/app.css'], ['DELETE', '/n/x'], ['OPTIONS', '/'], ['PATCH', '/list'], ['GET', '/anything?q=Secret%20plans']]) {
    const res = await s.call(method, url, undefined, { headers: { host: evil, origin: 'http://evil.example' } });
    assert.equal(res.status, 403, `${method} ${url}`);
    assert.equal(res.headers['content-type'], 'text/html; charset=utf-8', `${method} ${url}`);
    assert.equal(res.headers['cache-control'], 'no-store', `${method} ${url}`);
    secure(res, `${method} ${url}`);
    pages.push(res.text);
  }
  const html = pages[0];
  assert.ok(pages.every((p) => p === html), 'the page is the same bytes for every path, method and Host');
  assert.match(html, /<html lang="en">/);
  assert.match(html, /<main data-testid="forbidden-page">/);
  assert.match(html, /<h1[^>]*>\s*This address is not allowed\.?\s*<\/h1>/);
  assert.ok(html.includes('Constellation only answers at localhost on this computer.'));
  assert.ok(html.includes(`<a href="http://localhost:${s.port}">`), 'links to the working address with the actual port');
  assert.match(html, /<meta name="color-scheme" content="dark light">/);
  assert.doesNotMatch(html, /<script/i);
  assert.doesNotMatch(html, /<style/i);
  assert.doesNotMatch(html, /\sstyle\s*=/i);
  assert.doesNotMatch(html, /<link\b/i);
  for (const leak of ['evil.example', '1234', 'TOPSECRET', 'Secret plans', 'Secret%20plans']) assert.ok(!html.includes(leak), `leaks ${leak}`);
  const head = await s.call('HEAD', '/', undefined, { headers: { host: evil } });
  assert.equal(head.status, 403);
  assert.equal(head.text, '');
  const noHost = await s.call('GET', '/', undefined, { headers: { host: null } });
  assert.equal(noHost.status, 403);
  assert.equal(noHost.text, html);
  const api = await s.call('GET', '/api/sky', undefined, { headers: { host: evil } });
  err(api, 403, 'bad_host');
  assert.ok(!api.text.includes('evil.example'));
}));

test('the Host check comes first: before routing, method checks and the Origin check', () => withServer(async (s) => {
  const bad = { host: 'evil.example' };
  err(await s.call('GET', '/api/nope', undefined, { headers: bad }), 403, 'bad_host');
  err(await s.call('OPTIONS', '/api/notes', undefined, { headers: bad }), 403, 'bad_host');
  err(await s.call('DELETE', '/api/notes/a%2Fb', undefined, { headers: { ...bad, origin: 'http://evil.example' } }), 403, 'bad_host');
}));

// ---------------------------------------------------------------- routing
test('unknown /api paths and wrong segment counts are 404 not_found for every method', () => withServer(async (s) => {
  for (const method of ['GET', 'POST', 'PUT', 'DELETE', 'PATCH']) {
    for (const url of ['/api/nope', '/api/notes/A/nope', '/api/notes/A/rename/x', '/api/notes/A/backlinks/x', '/api/search/x', '/api/graph/x', '/api/nope/deeper/still',
      '/api/sky/x', '/api/sky/', '/api/unlit/', '/api/unlit/x', '/api/samples/x', '/api/samples/']) {
      const res = await s.call(method, url, method === 'GET' ? undefined : {});
      err(res, 404, 'not_found');
    }
  }
}));

test('a known route with the wrong method is 405 method_not_allowed with the right Allow header, also for OPTIONS and HEAD', () => withServer(async (s) => {
  await mk(s, 'Doc', 'x');
  const cases = [
    ['PUT', '/api/notes', 'GET, POST'], ['DELETE', '/api/notes', 'GET, POST'], ['PATCH', '/api/notes', 'GET, POST'], ['OPTIONS', '/api/notes', 'GET, POST'],
    ['POST', '/api/notes/Doc', 'GET, PUT, DELETE'], ['PATCH', '/api/notes/Doc', 'GET, PUT, DELETE'], ['OPTIONS', '/api/notes/Doc', 'GET, PUT, DELETE'],
    ['GET', '/api/notes/Doc/rename', 'POST'], ['PUT', '/api/notes/Doc/rename', 'POST'],
    ['POST', '/api/notes/Doc/backlinks', 'GET'], ['DELETE', '/api/notes/Doc/backlinks', 'GET'],
    ['POST', '/api/search', 'GET'], ['PUT', '/api/search', 'GET'], ['POST', '/api/graph', 'GET'], ['DELETE', '/api/graph', 'GET'], ['OPTIONS', '/api/graph', 'GET'],
    ['PATCH', '/api/notes/..', 'GET, PUT, DELETE'],
    ['POST', '/api/sky', 'GET'], ['PUT', '/api/sky', 'GET'], ['DELETE', '/api/sky', 'GET'], ['OPTIONS', '/api/sky', 'GET'], ['PATCH', '/api/sky', 'GET'],
    ['POST', '/api/unlit', 'GET'], ['DELETE', '/api/unlit', 'GET'], ['OPTIONS', '/api/unlit', 'GET'],
    ['GET', '/api/samples', 'DELETE'], ['POST', '/api/samples', 'DELETE'], ['PUT', '/api/samples', 'DELETE'], ['OPTIONS', '/api/samples', 'DELETE'],
  ];
  for (const [method, url, allow] of cases) {
    const res = await s.call(method, url, method === 'POST' || method === 'PUT' ? {} : undefined);
    assert.equal(res.status, 405, `${method} ${url}`);
    assert.equal(res.headers.allow, allow, `${method} ${url}`);
    assert.equal(res.body.error.code, 'method_not_allowed', `${method} ${url}`);
  }
  for (const [method, url] of [['POST', '/'], ['PUT', '/app.css'], ['DELETE', '/n/Doc'], ['OPTIONS', '/'], ['HEAD', '/'], ['HEAD', '/api/notes'], ['HEAD', '/api/sky'], ['PATCH', '/js/titles.js']]) {
    const res = await s.call(method, url, method === 'POST' || method === 'PUT' ? {} : undefined);
    assert.equal(res.status, 405, `${method} ${url}`);
    assert.equal(res.headers.allow, url === '/api/notes' ? 'GET, POST' : 'GET', `${method} ${url}`);
  }
  assert.equal(s.read('Doc.md').toString(), 'x');
}));

// ---------------------------------------------------------------- traversal (SC5)
const plantSecrets = (v, sb) => {
  for (const name of ['secret.md', 'secret', 'secret.txt', 'TOPSECRET.md', 'a.md']) fs.writeFileSync(path.join(sb.base, name), `TOPSECRET in ${name}`);
};

test('SC5 traversal and malformed title segments are 404 note_not_found on every note route and leak nothing', () => withServer(async (s) => {
  const outside = fs.readdirSync(s.base).sort();
  const segs = ['..', '%2e%2e%2fsecret', '..%2Fsecret', '%2e%2e%5csecret', '..%5Csecret', 'a%2Fb', '%E0%A4%A', '%2e%2e', '%2E%2E%2Fsecret',
    'a%5Cb', '.hidden', 'CON', 'a%00b', '%2e%2e%2fsecret.md', 'x%2F..%2F..%2Fsecret', '%252e%252e%252fsecret', '%ZZ', 'a%3Ab'];
  const check = (res, label, strict = true) => {
    assert.equal(res.status, 404, `${label}: ${res.text}`);
    if (strict) assert.equal(res.body.error.code, 'note_not_found', label);
    assert.ok(!res.text.includes('TOPSECRET'), `${label} leaked`);
  };
  for (const seg of segs) {
    check(await s.call('GET', `/api/notes/${seg}`), `GET ${seg}`);
    check(await s.call('PUT', `/api/notes/${seg}`, { content: 'pwned' }, { headers: { 'if-match': `"${'0'.repeat(32)}"` } }), `PUT ${seg}`);
    check(await s.call('DELETE', `/api/notes/${seg}`), `DELETE ${seg}`);
    check(await s.call('GET', `/api/notes/${seg}/backlinks`), `backlinks ${seg}`);
    check(await s.call('POST', `/api/notes/${seg}/rename`, { title: 'Moved' }), `rename ${seg}`);
  }
  check(await s.call('GET', '/api/notes/'), 'GET /api/notes/');
  check(await s.call('PUT', '/api/notes/', { content: 'x' }, { headers: { 'if-match': '"x"' } }), 'PUT /api/notes/');
  check(await s.call('DELETE', '/api/notes/'), 'DELETE /api/notes/');
  check(await s.call('GET', '/api/notes//backlinks'), 'backlinks of empty', false);
  check(await s.call('POST', '/api/notes//rename', { title: 'Moved' }), 'rename of empty', false);
  // rename target is validated as a title, never joined to a path
  await mk(s, 'Src', 'x');
  for (const t of ['../secret', '..\\secret', '/etc/passwd', 'a/../../secret']) {
    const res = await s.call('POST', '/api/notes/Src/rename', { title: t });
    assert.equal(res.status, 400, t);
    assert.ok(res.body.error.code.startsWith('title_'), t);
  }
  assert.deepEqual(fs.readdirSync(s.base).sort(), outside, 'nothing appeared outside the vault');
  assert.deepEqual(listVault(s.vault), ['Src.md']);
  for (const f of ['secret.md', 'secret', 'secret.txt', 'TOPSECRET.md', 'a.md']) assert.equal(fs.readFileSync(path.join(s.base, f), 'utf8'), `TOPSECRET in ${f}`);
}, { setup: plantSecrets }));

test('SC5 static traversal URLs get the HTML shell and never any bytes from outside public/', () => withServer(async (s) => {
  const index = await s.call('GET', '/');
  assert.equal(index.status, 200);
  assert.deepEqual(index.buffer, fs.readFileSync(path.join(PUBLIC_DIR, 'index.html')));
  const urls = ['/n/%2e%2e%2fsecret', '/js/../src/server.js', '/js/..%2f..%2fsrc%2fserver.js', '/js/%2e%2e/src/server.js', '/graph', '/graph?note=A',
    '/src/server.js', '/package.json', '/vault/secret.md', '/../secret.md', '/%2e%2e/secret.md', '/..%2fsecret.md', '/app.css/../../secret.md',
    '/js/', '/js/missing.js', '/js/.hidden.js', '/.wiki.lock', '/.constellation.lock', '/.constellation-sky.json', '/js/graph.js', '/js/layout.js', '/list', '/list/n/Welcome', '/n/Welcome', '/some/deep/path', '/spec.md', '/acceptance/helpers.js', '/%00', '/js/titles.js%00.png'];
  for (const url of urls) {
    const res = await s.call('GET', url);
    assert.equal(res.status, 200, url);
    assert.equal(res.headers['content-type'], 'text/html; charset=utf-8', url);
    assert.deepEqual(res.buffer, index.buffer, url);
    assert.ok(!res.text.includes('TOPSECRET'), url);
  }
}, { setup: plantSecrets }));

// ---------------------------------------------------------------- Origin
test('POST, PUT and DELETE with a foreign Origin or Sec-Fetch-Site cross-site are 403 bad_origin and change nothing', () => withServer(async (s) => {
  const doc = await mk(s, 'Doc', 'v1');
  const before = snapshot(s.vault);
  const evil = [
    { origin: 'http://evil.example' }, { origin: 'null' }, { origin: `https://localhost:${s.port}` }, { origin: `http://127.0.0.1:${s.port}` },
    { origin: `http://localhost:${s.port + 1}` }, { 'sec-fetch-site': 'cross-site' }, { origin: `http://localhost:${s.port}`, 'sec-fetch-site': 'cross-site' },
  ];
  for (const h of evil) {
    const label = JSON.stringify(h);
    err(await s.call('POST', '/api/notes', { title: 'New' }, { headers: h }), 403, 'bad_origin');
    err(await s.call('PUT', '/api/notes/Doc', { content: 'x' }, { headers: { ...h, 'if-match': `"${doc.revision}"` } }), 403, 'bad_origin');
    err(await s.call('DELETE', '/api/notes/Doc', undefined, { headers: h }), 403, 'bad_origin');
    err(await s.call('POST', '/api/notes/Doc/rename', { title: 'Moved' }, { headers: h }), 403, 'bad_origin');
    const samples = await s.call('DELETE', '/api/samples', undefined, { headers: h });
    err(samples, 403, 'bad_origin');
    assert.equal(samples.body.error.message, BAD_ORIGIN_MESSAGE);
    assert.deepEqual(snapshot(s.vault), before, label);
  }
  // precedence: unknown route, wrong method and bad title segment all come before the Origin check; Origin comes before media type
  const origin = { origin: 'http://evil.example' };
  err(await s.call('POST', '/api/nope', {}, { headers: origin }), 404, 'not_found');
  assert.equal((await s.call('DELETE', '/api/notes', undefined, { headers: origin })).status, 405);
  err(await s.call('DELETE', '/api/notes/a%2Fb', undefined, { headers: origin }), 404, 'note_not_found');
  err(await s.call('POST', '/api/notes', undefined, { raw: '{"title":"x"}', headers: { ...origin, 'content-type': 'text/plain' } }), 403, 'bad_origin');
  err(await s.call('DELETE', '/api/samples/x', undefined, { headers: origin }), 404, 'not_found');
  assert.equal((await s.call('GET', '/api/samples', undefined, { headers: origin })).status, 405);
  err(await s.call('POST', '/api/notes', { title: 'x' }, { headers: origin }), 403, 'bad_origin');
}));

test('a matching or absent Origin and same-origin or none Sec-Fetch-Site pass; GET is not subject to the Origin check', () => withServer(async (s) => {
  const ok = [
    {}, { origin: `http://localhost:${s.port}` }, { 'sec-fetch-site': 'same-origin' }, { 'sec-fetch-site': 'none' },
    { origin: `http://localhost:${s.port}`, 'sec-fetch-site': 'same-origin' },
  ];
  let i = 0;
  for (const h of ok) assert.equal((await s.call('POST', '/api/notes', { title: `ok ${i++}` }, { headers: h })).status, 201, JSON.stringify(h));
  const viaIp = await s.call('POST', '/api/notes', { title: 'via ip' }, { headers: { host: `127.0.0.1:${s.port}`, origin: `http://127.0.0.1:${s.port}` } });
  assert.equal(viaIp.status, 201);
  const get = await s.call('GET', '/api/notes', undefined, { headers: { origin: 'http://evil.example', 'sec-fetch-site': 'cross-site' } });
  assert.equal(get.status, 200);
  assert.equal((await s.call('GET', '/api/sky', undefined, { headers: { origin: 'http://evil.example', 'sec-fetch-site': 'cross-site' } })).status, 200);
  assert.equal((await s.call('DELETE', '/api/samples', undefined, { headers: { origin: `http://localhost:${s.port}` } })).status, 200);
  assert.equal((await s.call('DELETE', '/api/samples', undefined, { headers: { 'sec-fetch-site': 'same-origin', 'content-type': 'text/plain' } })).status, 200);
  assert.deepEqual(Object.keys(get.headers).filter((h) => h.startsWith('access-control-')), []);
}));

// ---------------------------------------------------------------- media type, size, body
test('POST and PUT need Content-Type application/json (a charset parameter is fine), else 415; DELETE needs none', () => withServer(async (s) => {
  const doc = await mk(s, 'Doc', 'v1');
  const body = '{"title":"New"}';
  for (const ct of ['text/plain', 'application/x-www-form-urlencoded', 'text/json', 'multipart/form-data; boundary=x', undefined]) {
    const headers = ct ? { 'content-type': ct } : {};
    err(await s.call('POST', '/api/notes', undefined, { raw: body, headers }), 415, 'unsupported_media_type');
    err(await s.call('PUT', '/api/notes/Doc', undefined, { raw: '{"content":"x"}', headers: { ...headers, 'if-match': `"${doc.revision}"` } }), 415, 'unsupported_media_type');
    err(await s.call('POST', '/api/notes/Doc/rename', undefined, { raw: '{"title":"Moved"}', headers }), 415, 'unsupported_media_type');
  }
  err(await s.call('POST', '/api/notes', undefined, { raw: 'not json', headers: { 'content-type': 'text/plain' } }), 415, 'unsupported_media_type');
  assert.deepEqual(listVault(s.vault), ['Doc.md']);
  assert.equal(s.read('Doc.md').toString(), 'v1');
  const withCharset = await rawJson(s, 'POST', '/api/notes', body, { 'content-type': 'application/json; charset=utf-8' });
  assert.equal(withCharset.status, 201);
  const del = await s.call('DELETE', '/api/notes/New', undefined, { headers: { 'content-type': 'text/plain' } });
  assert.equal(del.status, 204);
  assert.equal((await s.call('DELETE', '/api/notes/Doc')).status, 204);
}));

test('a body over 2,098,176 bytes is 413 too_large (Content-Length or streamed) and the server stays up', () => withServer(async (s) => {
  const LIMIT = 2098176;
  const big = Buffer.alloc(LIMIT + 1, 'a');
  // The server destroys the request after answering, which can reset a large upload; retry a reset that carried no response.
  const send = async (...args) => {
    for (let attempt = 0; ; attempt++) {
      try { return await s.call(...args); } catch (e) { if (attempt >= 2 || !['ECONNRESET', 'EPIPE'].includes(e.code)) throw e; }
    }
  };
  err(await send('POST', '/api/notes', undefined, { raw: big, headers: jsonHeaders }), 413, 'too_large');
  assert.equal((await s.call('GET', '/api/notes')).status, 200);
  err(await send('POST', '/api/notes', undefined, { raw: big, headers: jsonHeaders, chunked: true }), 413, 'too_large');
  assert.equal((await s.call('GET', '/api/notes')).status, 200);
  await mk(s, 'Doc', 'v1');
  err(await send('PUT', '/api/notes/Doc', undefined, { raw: big, headers: { ...jsonHeaders, 'if-match': `"${sha32('v1')}"` } }), 413, 'too_large');
  err(await s.call('POST', '/api/notes', undefined, { raw: '{', headers: { ...jsonHeaders, 'content-length': '3000000' } }), 413, 'too_large');
  assert.equal((await s.call('GET', '/api/notes')).status, 200);
  assert.deepEqual(listVault(s.vault), ['Doc.md']);
  assert.equal(s.read('Doc.md').toString(), 'v1');
}));

test('a body of exactly 2,098,176 bytes is read, and content over 2 MiB in it is note_too_large', () => withServer(async (s) => {
  const head = '{"title":"Big","content":"';
  const tail = '"}';
  const raw = head + 'a'.repeat(2098176 - head.length - tail.length) + tail;
  assert.equal(Buffer.byteLength(raw), 2098176);
  err(await rawJson(s, 'POST', '/api/notes', raw), 413, 'note_too_large');
  assert.deepEqual(listVault(s.vault), []);
}));

test('invalid JSON, non-objects, wrong field types, missing fields and nested values are 400 bad_request', () => withServer(async (s) => {
  const doc = await mk(s, 'Doc', 'v1');
  const badCreate = ['{', '', 'null', '[]', '"str"', '42', 'true', '{"title":5}', '{"title":null}', '{"title":["x"]}', '{"title":{"a":1}}', '{}',
    '{"content":"x"}', '{"title":"ok","content":5}', '{"title":"ok","extra":{"a":1}}', '{"title":"ok","extra":[1]}', '{"title":"ok",}', "{'title':'ok'}"];
  for (const raw of badCreate) err(await rawJson(s, 'POST', '/api/notes', raw), 400, 'bad_request');
  const badPut = ['{', '[]', 'null', '{}', '{"content":5}', '{"content":["a"]}', '{"content":{"a":1}}', '{"content":"x","extra":{"a":1}}', '{"title":"x"}'];
  for (const raw of badPut) err(await rawJson(s, 'PUT', '/api/notes/Doc', raw, { 'if-match': `"${doc.revision}"` }), 400, 'bad_request');
  const badRename = ['{', '[]', '{}', '{"title":1}', '{"title":{"a":1}}', '{"title":"New","extra":[1]}'];
  for (const raw of badRename) err(await rawJson(s, 'POST', '/api/notes/Doc/rename', raw), 400, 'bad_request');
  assert.deepEqual(listVault(s.vault), ['Doc.md']);
  assert.equal(s.read('Doc.md').toString(), 'v1');
  // unknown primitive keys are ignored
  const ignored = await rawJson(s, 'POST', '/api/notes', '{"title":"Ok","extra":1,"flag":true,"nothing":null,"s":"x"}');
  assert.equal(ignored.status, 201);
  // the title segment (step 3) is checked before the body (step 7); a missing source is a handler error after the body checks
  err(await rawJson(s, 'PUT', '/api/notes/..', '{', { 'if-match': '"x"' }), 404, 'note_not_found');
  err(await rawJson(s, 'POST', '/api/notes/Missing/rename', '{'), 400, 'bad_request');
  err(await rawJson(s, 'POST', '/api/notes/Missing/rename', '{"title":"New"}'), 404, 'note_not_found');
}));

test('every error is JSON {"error":{"code","message"}} with the fixed note_not_found and title_exists messages', () => withServer(async (s) => {
  await mk(s, 'Ideas');
  const nf = await getNote(s, 'Missing');
  assert.deepEqual(nf.body, { error: { code: 'note_not_found', message: 'Note not found.' } });
  const conflict = await s.call('PUT', '/api/notes/Ideas', { content: 'x' }, { headers: { 'if-match': '"stale"' } });
  assert.equal(conflict.body.error.message, 'This note changed since you opened it.');
  const exists = await s.call('POST', '/api/notes', { title: 'ideas' });
  assert.deepEqual(exists.body, { error: { code: 'title_exists', message: 'A note called "Ideas" already exists. Choose another title.', existing: 'Ideas' } });
  const origin = await s.call('POST', '/api/notes', { title: 'x' }, { headers: { origin: 'http://evil.example' } });
  assert.deepEqual(origin.body, { error: { code: 'bad_origin', message: BAD_ORIGIN_MESSAGE } });
  for (const res of [nf, conflict, exists, await s.call('GET', '/api/nope'), await s.call('PUT', '/api/notes', {})]) {
    assert.equal(res.headers['content-type'], 'application/json; charset=utf-8');
    assert.deepEqual(Object.keys(res.body), ['error']);
    assert.equal(typeof res.body.error.code, 'string');
    assert.equal(typeof res.body.error.message, 'string');
  }
}));

// ---------------------------------------------------------------- headers and static files
test('every response carries the security headers: API, errors, static files and the shell', () => withServer(async (s) => {
  const doc = await mk(s, 'Doc', 'x');
  const responses = {
    list: await s.call('GET', '/api/notes'),
    note: await getNote(s, 'Doc'),
    created: await s.call('POST', '/api/notes', { title: 'Other' }),
    notFound: await getNote(s, 'Missing'),
    unknown: await s.call('GET', '/api/nope'),
    method: await s.call('PATCH', '/api/notes', {}),
    badBody: await rawJson(s, 'POST', '/api/notes', '{'),
    media: await s.call('POST', '/api/notes', undefined, { raw: '{}', headers: { 'content-type': 'text/plain' } }),
    origin: await s.call('POST', '/api/notes', { title: 'x' }, { headers: { origin: 'http://evil.example' } }),
    host: await s.call('GET', '/api/notes', undefined, { headers: { host: 'evil.example' } }),
    hostShell: await s.call('GET', '/', undefined, { headers: { host: 'evil.example' } }),
    search: await s.call('GET', '/api/search?q=x'),
    searchBad: await s.call('GET', '/api/search'),
    graph: await s.call('GET', '/api/graph'),
    deleted: await s.call('DELETE', '/api/notes/Other'),
    shell: await s.call('GET', '/'),
    fallback: await s.call('GET', '/n/Doc'),
    css: await s.call('GET', '/app.css'),
    titlesJs: await s.call('GET', '/js/titles.js'),
    wikilinkJs: await s.call('GET', '/js/wikilink.js'),
    options: await s.call('OPTIONS', '/', undefined, { headers: { origin: 'http://evil.example' } }),
    sky: await s.call('GET', '/api/sky'),
    unlit: await s.call('GET', '/api/unlit'),
    samples: await s.call('DELETE', '/api/samples'),
    skyMethod: await s.call('POST', '/api/sky', {}),
    skyUnknown: await s.call('GET', '/api/sky/x'),
    forbiddenPage: await s.call('GET', '/n/Doc', undefined, { headers: { host: 'evil.example' } }),
    forbiddenCss: await s.call('GET', '/app.css', undefined, { headers: { host: 'evil.example' } }),
  };
  let etag = responses.sky.headers.etag;
  assert.match(etag, /^"[0-9a-f]{32}"$/);
  responses.sky304 = await s.call('GET', '/api/sky', undefined, { headers: { 'if-none-match': etag } });
  if (responses.sky304.status !== 304) {
    // the 10 minute `now` bucket rolled over between the two requests: take a fresh pair once
    const fresh = await s.call('GET', '/api/sky');
    responses.sky = fresh;
    responses.sky304 = await s.call('GET', '/api/sky', undefined, { headers: { 'if-none-match': fresh.headers.etag } });
  }
  assert.equal(responses.sky304.status, 304);
  for (const [label, res] of Object.entries(responses)) secure(res, label);
  for (const label of ['list', 'note', 'created', 'notFound', 'unknown', 'method', 'badBody', 'media', 'origin', 'host', 'search', 'searchBad', 'graph', 'sky', 'unlit', 'samples', 'skyMethod', 'skyUnknown']) {
    assert.equal(responses[label].headers['content-type'], 'application/json; charset=utf-8', label);
    assert.equal(responses[label].headers['cache-control'], 'no-store', label);
  }
  assert.equal(responses.deleted.status, 204);
  assert.equal(responses.deleted.headers['cache-control'], 'no-store');
  assert.equal(responses.sky304.headers['cache-control'], 'no-store');
  assert.equal(responses.sky304.headers.etag, responses.sky.headers.etag);
  assert.equal(responses.sky304.text, '');
  assert.equal(responses.sky304.headers['content-type'], undefined, 'the 304 has no content type');
  for (const label of ['forbiddenPage', 'forbiddenCss']) {
    assert.equal(responses[label].status, 403, label);
    assert.equal(responses[label].headers['content-type'], 'text/html; charset=utf-8', label);
    assert.equal(responses[label].headers['cache-control'], 'no-store', label);
  }
  assert.equal(responses.created.status, 201);
  assert.equal(doc.revision, responses.note.body.revision);
}));

test('static files come from an allow-list: /app.css and /js/*.js match public/, everything else is the shell', () => withServer(async (s) => {
  const css = await s.call('GET', '/app.css');
  assert.equal(css.status, 200);
  assert.equal(css.headers['content-type'], 'text/css; charset=utf-8');
  assert.deepEqual(css.buffer, fs.readFileSync(path.join(PUBLIC_DIR, 'app.css')));
  const names = fs.readdirSync(path.join(PUBLIC_DIR, 'js')).filter((n) => n.endsWith('.js'));
  assert.ok(names.includes('titles.js') && names.includes('wikilink.js'), names.join(','));
  for (const name of names) {
    const res = await s.call('GET', `/js/${name}`);
    assert.equal(res.status, 200, name);
    assert.equal(res.headers['content-type'], 'text/javascript; charset=utf-8', name);
    assert.deepEqual(res.buffer, fs.readFileSync(path.join(PUBLIC_DIR, 'js', name)), name);
  }
  const shell = await s.call('GET', '/');
  assert.equal(shell.headers['content-type'], 'text/html; charset=utf-8');
  for (const url of ['/js/nope.js', '/app.js', '/js/titles.js.map', '/favicon.ico', '/js/graph.js', '/js/layout.js', '/js/../src/server.js', '/n/%2e%2e%2fsecret', '/list', '/list/n/Doc', '/n/Doc']) {
    const res = await s.call('GET', url);
    assert.equal(res.status, 200, url);
    assert.deepEqual(res.buffer, shell.buffer, url);
  }
}));

test('SC6 the served HTML and JS never use HTML or code-string sinks, index.html has no inline script or style, and the CSP has no unsafe-inline or unsafe-eval', () => withServer(async (s) => {
  const shell = await s.call('GET', '/');
  const html = shell.text;
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  assert.ok(scripts.length >= 1, 'index.html loads at least one script');
  for (const [, attrs, inline] of scripts) {
    assert.match(attrs, /\bsrc\s*=/i, 'script has src');
    assert.equal(inline.trim(), '', 'no inline script body');
  }
  assert.doesNotMatch(html, /<style\b/i);
  assert.doesNotMatch(html, /\sstyle\s*=/i);
  assert.match(html, /<html[^>]*\blang="en"/i);
  assert.doesNotMatch(shell.headers['content-security-policy'], /unsafe-inline|unsafe-eval/);
  const names = fs.readdirSync(path.join(PUBLIC_DIR, 'js')).filter((n) => n.endsWith('.js'));
  assert.ok(names.length >= 2, names.join(','));
  for (const name of names) {
    const res = await s.call('GET', `/js/${name}`);
    assert.equal(res.status, 200, name);
    assert.equal(res.headers['content-security-policy'].includes('unsafe-'), false, name);
    const code = res.text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.doesNotMatch(code, /\binnerHTML\b|\bouterHTML\b|\binsertAdjacentHTML\b|document\s*\.\s*write\b/, `${name} uses an HTML sink`);
    assert.doesNotMatch(code, /\beval\s*\(|\bnew\s+Function\b|\bFunction\s*\(/, `${name} evaluates code from a string`);
    assert.doesNotMatch(code, /\b(setTimeout|setInterval)\s*\(\s*['"`]/, `${name} passes a string to a timer`);
  }
  const css = await s.call('GET', '/app.css');
  assert.equal(css.status, 200);
}));

test('SC6 every ux.md data-testid appears literally in index.html, a served /js/*.js file, or the permission page', async (t) => {
  if (!fs.existsSync(UX_MD)) { t.skip(`ux.md not found at ${UX_MD} (a mutation copy of the project has no docs/)`); return; }
  const TESTIDS = uxTestIds();
  assert.ok(TESTIDS.length >= 90, `the data-testid table gave only ${TESTIDS.length} ids`);
  for (const id of ['sky-canvas', 'star-card', 'forbidden-page', 'search-result', 'unlit-item', 'constellation-item', 'conflict-reload', 'conflict-copy', 'rename-cancel']) assert.ok(TESTIDS.includes(id), `table parse lost ${id}`);
  await withServer(async (s) => {
    let everything = (await s.call('GET', '/')).text;
    everything += (await s.call('GET', '/', undefined, { headers: { host: 'evil.example' } })).text;
    for (const name of fs.readdirSync(path.join(PUBLIC_DIR, 'js')).filter((n) => n.endsWith('.js'))) {
      const res = await s.call('GET', `/js/${name}`);
      assert.equal(res.status, 200, name);
      everything += res.text;
    }
    const missing = TESTIDS.filter((id) => !everything.includes(id));
    assert.deepEqual(missing, [], `data-testid values missing from the served HTML/JS: ${missing.join(', ')}`);
  });
});

test('the browser never runs a layout: public/js/graph.js and public/js/layout.js do not exist and fall back to the HTML shell', () => withServer(async (s) => {
  assert.equal(fs.existsSync(path.join(PUBLIC_DIR, 'js', 'graph.js')), false);
  assert.equal(fs.existsSync(path.join(PUBLIC_DIR, 'js', 'layout.js')), false);
  const shell = await s.call('GET', '/');
  for (const url of ['/js/graph.js', '/js/layout.js']) {
    const res = await s.call('GET', url);
    assert.equal(res.status, 200, url);
    assert.equal(res.headers['content-type'], 'text/html; charset=utf-8', url);
    assert.deepEqual(res.buffer, shell.buffer, url);
  }
}));

// ---------------------------------------------------------------- startup, lock, HOST, PORT, vault
test('HOST other than 127.0.0.1, ::1 or localhost exits 1 with the loopback message and prints no ready line', async () => {
  for (const HOST of ['0.0.0.0', '::', 'example.com', '192.168.1.20', '127.0.0.2']) {
    const r = await runToExit({ env: { HOST } });
    assert.equal(r.code, 1, `${HOST}: ${r.output}`);
    assert.ok(r.output.includes('HOST must be a loopback address; exposing Constellation needs a security review'), `${HOST}: ${r.output}`);
    assert.doesNotMatch(r.stdout, /Constellation running/);
  }
});

test('HOST 127.0.0.1 and localhost start and print the ready line with the actual port', async () => {
  for (const HOST of ['127.0.0.1', 'localhost']) {
    await withServer(async (s) => {
      assert.match(s.logs().stdout, READY_RE);
      assert.equal(Number(READY_RE.exec(s.logs().stdout)[1]), s.port);
      assert.notEqual(s.port, 0);
    }, { env: { HOST } });
  }
});

test('HOST ::1 listens on IPv6 loopback and still prints a localhost ready line', async (t) => {
  const hasV6 = (os.networkInterfaces().lo || []).some((a) => a.address === '::1');
  if (!hasV6) { t.skip('no IPv6 loopback on this machine'); return; }
  await withServer(async (s) => {
    assert.match(s.logs().stdout, READY_RE);
    const res = await s.call('GET', '/api/notes', undefined, { headers: { host: `[::1]:${s.port}` } });
    assert.equal(res.status, 200);
  }, { env: { HOST: '::1' } });
});

test('a taken port exits 1 with "Port <N> is in use, set PORT"', async () => {
  const blocker = net.createServer();
  await new Promise((resolve) => blocker.listen(0, '127.0.0.1', resolve));
  const { port } = blocker.address();
  try {
    const r = await runToExit({ env: { PORT: String(port), HOST: '127.0.0.1' } });
    assert.equal(r.code, 1, r.output);
    assert.ok(r.output.includes(`Port ${port} is in use, set PORT`), r.output);
    assert.doesNotMatch(r.stdout, /Constellation running/);
  } finally {
    await new Promise((resolve) => blocker.close(resolve));
  }
});

test('VAULT_DIR defaults to ./vault and is resolved against the working directory', async () => {
  for (const [env, dir] of [[{ VAULT_DIR: undefined }, 'vault'], [{ VAULT_DIR: 'rel/notes here' }, 'rel/notes here']]) {
    const sb = sandbox({ create: false });
    try {
      await withServer(async (s) => {
        assert.ok(fs.statSync(path.join(sb.base, dir)).isDirectory(), dir);
        const res = await s.call('POST', '/api/notes', { title: 'Where' });
        assert.equal(res.status, 201);
        assert.ok(fs.existsSync(path.join(sb.base, dir, 'Where.md')));
      }, { sandbox: sb, cwd: sb.base, env });
    } finally { sb.cleanup(); }
  }
});

test('a VAULT_DIR that cannot be used as a folder exits 1 with a message', async () => {
  const sb = sandbox({ create: false });
  try {
    fs.writeFileSync(path.join(sb.base, 'afile'), 'x');
    const r = await runToExit({ sandbox: sb, env: { VAULT_DIR: path.join(sb.base, 'afile', 'vault') } });
    assert.equal(r.code, 1, r.output);
    assert.ok(r.output.includes('Cannot write to VAULT_DIR'), r.output);
    assert.doesNotMatch(r.stdout, /Constellation running/);
  } finally { sb.cleanup(); }
});

test('a second server on the same vault exits 1 with "Another Constellation server is using <vault>" while the first keeps working', () => withServer(async (s) => {
  const lock = s.file(LOCK_NAME);
  assert.equal(fs.readFileSync(lock, 'utf8').trim(), String(s.child.pid), 'the lock holds the pid as decimal text');
  assert.match(fs.readFileSync(lock, 'utf8'), /^\d+\n?$/);
  const second = await runToExit({ sandbox: s.sb, env: { PORT: '0' } });
  assert.equal(second.code, 1, second.output);
  assert.ok(second.output.includes(`Another Constellation server is using ${fs.realpathSync(s.vault)}`), second.output);
  assert.doesNotMatch(second.stdout, /Constellation running/);
  assert.equal(fs.readFileSync(lock, 'utf8').trim(), String(s.child.pid), 'the live lock is untouched');
  assert.equal((await s.call('GET', '/api/notes')).status, 200);
}));

test('a lock held by a live process is respected, a lock with a stale pid is taken over', async () => {
  const live = await runToExit({ setup: (v) => fs.writeFileSync(path.join(v, LOCK_NAME), String(process.pid)) });
  assert.equal(live.code, 1, live.output);
  assert.ok(live.output.includes('Another Constellation server is using'), live.output);
  await withServer(async (s) => {
    assert.equal(fs.readFileSync(s.file(LOCK_NAME), 'utf8').trim(), String(s.child.pid), 'the lock now names the new server');
    assert.equal((await s.call('GET', '/api/notes')).status, 200);
  }, { setup: (v) => fs.writeFileSync(path.join(v, LOCK_NAME), '2147483000') });
});

test('a live .wiki.lock makes Constellation exit 1 with "A wiki server is using <vault>" and leaves the wiki lock alone', async () => {
  const sb = sandbox();
  try {
    fs.writeFileSync(path.join(sb.vault, '.wiki.lock'), String(process.pid));
    const r = await runToExit({ sandbox: sb });
    assert.equal(r.code, 1, r.output);
    assert.ok(r.output.includes(`A wiki server is using ${fs.realpathSync(sb.vault)}`), r.output);
    assert.doesNotMatch(r.stdout, /Constellation running/);
    assert.equal(fs.readFileSync(path.join(sb.vault, '.wiki.lock'), 'utf8'), String(process.pid), 'the wiki lock is not edited');
    assert.equal(fs.existsSync(path.join(sb.vault, LOCK_NAME)), false, 'no Constellation lock is taken when refusing');
  } finally { sb.cleanup(); }
});

test('a stale .wiki.lock is ignored, never edited or removed, and Constellation never creates one', async () => {
  const sb = sandbox();
  try {
    fs.writeFileSync(path.join(sb.vault, '.wiki.lock'), '2147483000');
    await withServer(async (s) => {
      assert.equal((await s.call('GET', '/api/notes')).status, 200);
      await mk(s, 'Doc', 'x');
      assert.equal(fs.readFileSync(s.file('.wiki.lock'), 'utf8'), '2147483000');
    }, { sandbox: sb });
    assert.equal(fs.readFileSync(path.join(sb.vault, '.wiki.lock'), 'utf8'), '2147483000', 'still there after SIGTERM');
    const fresh = sandbox();
    try {
      await withServer(async (s) => { await mk(s, 'Doc', 'x'); assert.equal(fs.existsSync(s.file('.wiki.lock')), false); }, { sandbox: fresh });
      assert.equal(fs.existsSync(path.join(fresh.vault, '.wiki.lock')), false);
    } finally { fresh.cleanup(); }
  } finally { sb.cleanup(); }
});

test('SIGTERM and SIGINT stop the server with exit 0 and remove .constellation.lock', async () => {
  for (const signal of ['SIGTERM', 'SIGINT']) {
    const sb = sandbox();
    try {
      await withServer(async (s) => {
        await mk(s, 'Doc', 'x');
        assert.ok(fs.existsSync(s.file(LOCK_NAME)));
        const info = await s.stop(signal);
        assert.deepEqual(info, { code: 0, signal: null }, signal);
        assert.equal(fs.existsSync(s.file(LOCK_NAME)), false, `${signal} removes the lock`);
        assert.deepEqual(listVault(s.vault), ['Doc.md']);
      }, { sandbox: sb });
    } finally { sb.cleanup(); }
  }
});

test('a vault left with a stale lock by a killed server can be reused', async () => {
  const sb = sandbox();
  try {
    const first = await withServer(async (s) => {
      await mk(s, 'Kept', 'bytes');
      await sleep(20);
      s.child.kill('SIGKILL');
      await s.stopped;
      return s.child.pid;
    }, { sandbox: sb });
    assert.ok(first > 0);
    assert.ok(fs.existsSync(path.join(sb.vault, LOCK_NAME)), 'SIGKILL leaves the lock behind');
    await withServer(async (s) => {
      assert.equal((await getNote(s, 'Kept')).body.content, 'bytes');
    }, { sandbox: sb });
  } finally { sb.cleanup(); }
});
