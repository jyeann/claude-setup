// HTTP behaviour of `node src/server.js` (spec.md "Interface: server"): ready lines, request pipeline, headers, static allow-list, test mode.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  APP_DIR, PUBLIC_DIR, JS_DIR, SCEN_DIR, SHIPPED_IDS, SECURITY_HEADERS, TESTIDS, startServer, runToExit, rawExchange, walkFiles,
} from './helpers.js';

let plain; let testMode;
const getPlain = () => (plain ??= startServer());
const getTest = () => (testMode ??= startServer({ test: true }));
after(async () => { for (const p of [plain, testMode]) if (p) await (await p.catch(() => null))?.stop(); });

const NOT_FOUND = 'Not found.';
const TEXT = 'text/plain; charset=utf-8';

function assertSecurityHeaders(res, label) {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) assert.equal(res.headers[k], v, `${label}: ${k}`);
  assert.ok(!Object.keys(res.headers).some((h) => h.startsWith('access-control-')), `${label}: no CORS headers`);
}
const jsFiles = () => ['engine', 'core', 'dom'].flatMap((d) => fs.readdirSync(path.join(JS_DIR, d)).filter((f) => /^[a-z0-9-]+\.js$/.test(f)).map((f) => `/js/${d}/${f}`));

// ------------------------------------------------------------------ startup
test('startup prints the ready line with the actual port, then "Loaded 10 scenarios.", with nothing on stderr', async () => {
  const s = await getPlain();
  const { stdout, stderr } = s.logs();
  assert.match(stdout, /^Incident Simulator running at http:\/\/localhost:\d+$/m);
  assert.ok(s.port > 0 && s.port < 65536);
  assert.match(stdout, /^Loaded 10 scenarios\.$/m);
  assert.ok(stdout.indexOf('running at') < stdout.indexOf('Loaded 10'), 'ready line before the Loaded line');
  assert.ok(!stdout.includes('scenario error:'));
  assert.equal(stderr, '');
});

// ------------------------------------------------------------------ static allow-list
test('GET / and /index.html serve the shell as text/html with <html lang="en">', async () => {
  const s = await getPlain();
  const a = await s.call('GET', '/');
  const b = await s.call('GET', '/index.html');
  for (const r of [a, b]) {
    assert.equal(r.status, 200);
    assert.equal(r.headers['content-type'], 'text/html; charset=utf-8');
    assert.match(r.text, /<html lang="en"/);
    assert.equal(r.headers['cache-control'], 'no-cache');
  }
  assert.equal(a.text, b.text);
  assert.ok(a.buffer.equals(fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'))));
});

test('css and svg are served with their content types and the exact file bytes', async () => {
  const s = await getPlain();
  for (const [url, file, type] of [['/app.css', 'app.css', 'text/css; charset=utf-8'], ['/tokens.css', 'tokens.css', 'text/css; charset=utf-8'], ['/favicon.svg', 'favicon.svg', 'image/svg+xml']]) {
    const r = await s.call('GET', url);
    assert.equal(r.status, 200, url);
    assert.equal(r.headers['content-type'], type, url);
    assert.equal(r.headers['cache-control'], 'no-cache', url);
    assert.ok(r.buffer.equals(fs.readFileSync(path.join(PUBLIC_DIR, file))), url);
    assertSecurityHeaders(r, url);
  }
});

test('every engine, core and dom module is served as text/javascript with its exact bytes', async () => {
  const s = await getPlain();
  const urls = jsFiles();
  assert.ok(urls.length >= 40, `${urls.length} modules found`);
  for (const d of ['engine', 'core', 'dom']) assert.ok(urls.some((u) => u.startsWith(`/js/${d}/`)));
  for (const url of urls) {
    const r = await s.call('GET', url);
    assert.equal(r.status, 200, url);
    assert.equal(r.headers['content-type'], 'text/javascript; charset=utf-8', url);
    assert.equal(r.headers['cache-control'], 'no-cache', url);
    assert.ok(r.buffer.equals(fs.readFileSync(path.join(APP_DIR, 'public', url))), url);
  }
});

test('scenario files are served byte for byte as application/json with Cache-Control no-cache', async () => {
  const s = await getPlain();
  for (const id of SHIPPED_IDS) {
    const r = await s.call('GET', `/scenarios/${id}.json`);
    assert.equal(r.status, 200, id);
    assert.equal(r.headers['content-type'], 'application/json; charset=utf-8');
    assert.equal(r.headers['cache-control'], 'no-cache');
    assert.ok(r.buffer.equals(fs.readFileSync(path.join(SCEN_DIR, `${id}.json`))), id);
    assertSecurityHeaders(r, id);
  }
});

test('/scenarios/index.json lists the 10 valid ids sorted, no errors, as JSON with Cache-Control no-store', async () => {
  const s = await getPlain();
  const r = await s.call('GET', '/scenarios/index.json');
  assert.equal(r.status, 200);
  assert.equal(r.headers['content-type'], 'application/json; charset=utf-8');
  assert.equal(r.headers['cache-control'], 'no-store');
  assert.deepEqual(r.body, { valid: [...SHIPPED_IDS].sort(), errors: [] });
  assert.deepEqual(Object.keys(r.body), ['valid', 'errors']);
});

// ------------------------------------------------------------------ 404 and no SPA fallback
const NOT_FOUND_PATHS = ['/js/../src/server.js', '/scenarios/../package.json', '/%2e%2e/', '/js/engine/%70rng.js', '/js/engine/', '/APP.CSS', '/scenarios/invalid-id.json',
  '/test-mode.json', '/src/server.js', '/package.json', '/spec.md', '/index.json', '/scenarios', '/scenarios/', '/js', '/js/', '/js/engine', '/js/engine/missing.js', '/js//engine/hash.js',
  '//', '/index.html/', '/favicon.ico', '/.git/config', '/js/engine/hash.js/', '/js/engine/hash.js%00', '/scenarios/cache-stampede.json/', '/scenarios/CACHE-STAMPEDE.json',
  '/js/engine/../core/safe-json.js', '/incidents', '/play/cache-stampede', '/README.md', '/verify.config.json', '/acceptance/helpers.js', '/tests/.gitkeep', '/scenarios/.json',
  '/js/engine/hash.JS', '/js/core/', '/js/dom/main', '/public/index.html', '/%2e%2e/%2e%2e/etc/passwd', '/..%2fpackage.json', '/js/engine/hash.js%3Fx', '/scenarios/index.json/', '/app.css/', '/tokens.css%00'];

test('everything outside the allow-list is 404 "Not found." as text/plain, with all security headers and no SPA fallback', async () => {
  const s = await getPlain();
  for (const p of NOT_FOUND_PATHS) {
    const r = await s.call('GET', p);
    assert.equal(r.status, 404, p);
    assert.equal(r.headers['content-type'], TEXT, p);
    assert.equal(r.text, NOT_FOUND, p);
    assertSecurityHeaders(r, p);
  }
});

test('files of the project folder are never served and no served byte comes from outside the allow-list', async () => {
  const s = await getPlain();
  const root = fs.readdirSync(APP_DIR);
  for (const name of root) {
    const r = await s.call('GET', `/${name}`);
    if (['app.css', 'tokens.css', 'favicon.svg', 'index.html'].includes(name)) continue;
    assert.equal(r.status, 404, `/${name}`);
  }
  for (const url of ['/src/router.js', '/src/http.js', '/src/config.js', '/src/scenarios-load.js', '/public/js/engine/hash.js']) assert.equal((await s.call('GET', url)).status, 404, url);
});

test('a query string never changes the response: /?speed=16 is the shell, unknown paths stay 404', async () => {
  const s = await getPlain();
  const shell = await s.call('GET', '/');
  for (const q of ['/?speed=16', '/?', '/?a=1&b=2', '/index.html?x=%00', '/?speed=16#/play/x']) {
    const r = q.includes('#') ? await s.call('GET', q.split('#')[0]) : await s.call('GET', q);
    assert.equal(r.status, 200, q);
    assert.equal(r.text, shell.text, q);
  }
  const css = await s.call('GET', '/app.css');
  assert.equal((await s.call('GET', '/app.css?v=123')).text, css.text);
  const idx = await s.call('GET', '/scenarios/index.json?x=1');
  assert.equal(idx.status, 200);
  assert.equal((await s.call('GET', '/nope?x=1')).status, 404);
  assert.equal((await s.call('GET', '/test-mode.json?x=1')).status, 404);
  assert.equal((await s.call('GET', '/js/engine/hash.js?x=1')).status, 200);
});

// ------------------------------------------------------------------ test mode gating
test('/test-mode.json is 404 without INCIDENT_SIM_TEST=1', async () => {
  const s = await getPlain();
  const r = await s.call('GET', '/test-mode.json');
  assert.equal(r.status, 404);
  assert.equal(r.text, NOT_FOUND);
});

test('/test-mode.json is 404 for INCIDENT_SIM_TEST values other than exactly 1', async () => {
  for (const v of ['0', 'true', 'yes', '', '01', ' 1', '1 ', 'on']) {
    const s = await startServer({ env: { INCIDENT_SIM_TEST: v } });
    try { assert.equal((await s.call('GET', '/test-mode.json')).status, 404, JSON.stringify(v)); } finally { await s.stop(); }
  }
});

test('/test-mode.json with INCIDENT_SIM_TEST=1 is 200 {"testMode":true} as no-store JSON, with all headers', async () => {
  const s = await getTest();
  const r = await s.call('GET', '/test-mode.json');
  assert.equal(r.status, 200);
  assert.equal(r.headers['content-type'], 'application/json; charset=utf-8');
  assert.equal(r.headers['cache-control'], 'no-store');
  assert.deepEqual(r.body, { testMode: true });
  assertSecurityHeaders(r, 'test-mode');
  assert.equal((await s.call('GET', '/test-mode.json?x=1')).status, 200);
  const head = await s.call('HEAD', '/test-mode.json');
  assert.equal(head.status, 200);
  assert.equal(head.text, '');
  assert.equal(head.headers['content-type'], 'application/json; charset=utf-8');
  assert.equal((await s.call('POST', '/test-mode.json')).status, 405);
  assert.equal((await s.call('GET', '/test-mode.json/')).status, 404);
  assert.equal((await s.call('GET', '/test-mode.json', { host: 'evil.test' })).status, 403);
});

test('test mode does not widen the allow-list: other files stay 404', async () => {
  const s = await getTest();
  for (const p of ['/package.json', '/src/server.js', '/spec.md', '/scenarios/../package.json']) assert.equal((await s.call('GET', p)).status, 404, p);
  assert.equal((await s.call('GET', '/')).status, 200);
});

// ------------------------------------------------------------------ Host
test('a Host header other than localhost:<port>, 127.0.0.1:<port> or [::1]:<port> is 403 "This host name is not allowed."', async () => {
  const s = await getPlain();
  const p = s.port;
  const bad = ['evil.com', `evil.com:${p}`, 'localhost', '127.0.0.1', `localhost:${p + 1}`, `127.0.0.1:${p + 1}`, `0.0.0.0:${p}`, `LOCALHOST:${p}`, `localhost:${p}.evil.com`, `localhost.evil.com:${p}`,
    `[::1]`, `[::2]:${p}`, `user@localhost:${p}`, `::1:${p}`, `localhost:`, `127.0.0.1.nip.io:${p}`, ''];
  for (const host of bad) {
    const r = await s.call('GET', '/', { host });
    assert.equal(r.status, 403, JSON.stringify(host));
    assert.equal(r.headers['content-type'], TEXT, host);
    assert.equal(r.text, 'This host name is not allowed.', host);
    assertSecurityHeaders(r, `host ${host}`);
  }
});

test('a missing Host header is 403 too (requireHostHeader is false)', async () => {
  const s = await getPlain();
  const r = await s.call('GET', '/', { host: null });
  assert.equal(r.status, 403);
  assert.equal(r.text, 'This host name is not allowed.');
  const raw = await rawExchange(s, 'GET / HTTP/1.1\r\nConnection: close\r\n\r\n');
  assert.match(raw, /^HTTP\/1\.1 403 /);
  assert.ok(raw.includes('This host name is not allowed.'));
});

test('the three loopback Host forms are accepted', async () => {
  const s = await getPlain();
  for (const host of [`localhost:${s.port}`, `127.0.0.1:${s.port}`, `[::1]:${s.port}`]) {
    const r = await s.call('GET', '/', { host });
    assert.equal(r.status, 200, host);
  }
});

test('the Host check comes first: bad Host beats a bad method and a cross-site request', async () => {
  const s = await getPlain();
  for (const method of ['POST', 'OPTIONS', 'DELETE', 'GET', 'HEAD']) {
    const r = await s.call(method, '/nope', { host: 'evil.com', headers: { 'sec-fetch-site': 'cross-site' } });
    assert.equal(r.status, 403, method);
    if (method !== 'HEAD') assert.equal(r.text, 'This host name is not allowed.', method);
  }
});

// ------------------------------------------------------------------ method and Sec-Fetch-Site
test('methods other than GET and HEAD are 405 with "Allow: GET, HEAD" on every path', async () => {
  const s = await getPlain();
  for (const method of ['OPTIONS', 'POST', 'PUT', 'DELETE', 'PATCH']) {
    for (const p of ['/', '/app.css', '/scenarios/index.json', '/nope', '/js/engine/hash.js', '/test-mode.json']) {
      const r = await s.call(method, p);
      assert.equal(r.status, 405, `${method} ${p}`);
      assert.equal(r.headers.allow, 'GET, HEAD', `${method} ${p}`);
      assertSecurityHeaders(r, `${method} ${p}`);
    }
  }
});

test('a request body is never read: POST with a body still gets 405 and the server keeps serving', async () => {
  const s = await getPlain();
  const r = await s.call('POST', '/', { body: 'x'.repeat(100000), headers: { 'content-type': 'application/json' } });
  assert.equal(r.status, 405);
  const g = await s.call('GET', '/', { body: 'unexpected body' });
  assert.equal(g.status, 200);
  assert.equal((await s.call('GET', '/')).status, 200);
});

test('Sec-Fetch-Site cross-site is 403 "This request is not allowed."; same-origin, same-site, none and absent are fine; Origin is ignored', async () => {
  const s = await getPlain();
  const cross = await s.call('GET', '/', { headers: { 'sec-fetch-site': 'cross-site' } });
  assert.equal(cross.status, 403);
  assert.equal(cross.headers['content-type'], TEXT);
  assert.equal(cross.text, 'This request is not allowed.');
  assertSecurityHeaders(cross, 'cross-site');
  assert.equal((await s.call('GET', '/scenarios/index.json', { headers: { 'sec-fetch-site': 'cross-site' } })).status, 403);
  assert.equal((await s.call('GET', '/nope', { headers: { 'sec-fetch-site': 'cross-site' } })).status, 403, 'checked before the path lookup');
  assert.equal((await s.call('HEAD', '/', { headers: { 'sec-fetch-site': 'cross-site' } })).status, 403);
  for (const v of ['same-origin', 'same-site', 'none']) assert.equal((await s.call('GET', '/', { headers: { 'sec-fetch-site': v } })).status, 200, v);
  assert.equal((await s.call('GET', '/', { headers: { origin: 'https://evil.example' } })).status, 200);
  assert.equal((await s.call('GET', '/', { headers: { origin: 'null', 'sec-fetch-site': 'same-origin' } })).status, 200);
});

test('the method check comes before Sec-Fetch-Site: a cross-site POST is 405', async () => {
  const s = await getPlain();
  const r = await s.call('POST', '/', { headers: { 'sec-fetch-site': 'cross-site' } });
  assert.equal(r.status, 405);
  assert.equal(r.headers.allow, 'GET, HEAD');
});

// ------------------------------------------------------------------ HEAD
test('HEAD returns the GET status and headers with an empty body', async () => {
  const s = await getPlain();
  const paths = ['/', '/index.html', '/app.css', '/favicon.svg', '/js/engine/hash.js', '/js/core/safe-json.js', '/scenarios/index.json', '/scenarios/cache-stampede.json', '/nope', '/js/engine/'];
  const skip = new Set(['date', 'connection', 'keep-alive', 'content-length', 'transfer-encoding']);
  for (const p of paths) {
    const g = await s.call('GET', p);
    const h = await s.call('HEAD', p);
    assert.equal(h.status, g.status, p);
    assert.equal(h.text, '', p);
    const strip = (x) => Object.fromEntries(Object.entries(x.headers).filter(([k]) => !skip.has(k)));
    assert.deepEqual(strip(h), strip(g), p);
    if ('content-length' in h.headers) assert.equal(h.headers['content-length'], String(g.buffer.length), `${p} content-length`);
  }
  const bad = await s.call('HEAD', '/', { host: 'evil.com' });
  assert.equal(bad.status, 403);
  assert.equal(bad.text, '');
});

// ------------------------------------------------------------------ headers
test('every response has the exact CSP and security headers: 200, 403, 404 and 405', async () => {
  const s = await getPlain();
  const cases = [['GET', '/', {}], ['GET', '/nope', {}], ['GET', '/', { host: 'evil.com' }], ['POST', '/', {}], ['GET', '/', { headers: { 'sec-fetch-site': 'cross-site' } }],
    ['HEAD', '/', {}], ['GET', '/scenarios/index.json', {}], ['GET', '/js/engine/hash.js', {}]];
  for (const [m, p, o] of cases) {
    const r = await s.call(m, p, o);
    assertSecurityHeaders(r, `${m} ${p} ${r.status}`);
  }
});

test('Cache-Control: no-cache for static and scenario files, no-store for index.json and test-mode.json', async () => {
  const s = await getPlain();
  for (const p of ['/', '/app.css', '/tokens.css', '/favicon.svg', '/js/engine/hash.js', '/js/core/progress.js', '/scenarios/cache-stampede.json']) assert.equal((await s.call('GET', p)).headers['cache-control'], 'no-cache', p);
  assert.equal((await s.call('GET', '/scenarios/index.json')).headers['cache-control'], 'no-store');
});

// ------------------------------------------------------------------ served-file hygiene
test('index.html: lang en, one main#main, no inline script or style, no event-handler attributes, skip-link first, live regions present', async () => {
  const s = await getPlain();
  const html = (await s.call('GET', '/')).text;
  assert.match(html, /<html lang="en"/);
  assert.equal((html.match(/<main\b/g) ?? []).length, 1);
  assert.match(html, /<main[^>]*\bid="main"/);
  const scripts = html.match(/<script\b[^>]*>/gi) ?? [];
  assert.ok(scripts.length >= 1);
  for (const tag of scripts) assert.match(tag, /\bsrc=/, tag);
  assert.ok(!/<script\b[^>]*>\s*[^<\s]/i.test(html.replace(/<script\b[^>]*\bsrc=[^>]*>\s*<\/script>/gi, '')), 'no inline script body');
  assert.ok(!/<style\b/i.test(html), 'no <style>');
  assert.ok(!/\sstyle\s*=/i.test(html), 'no style attribute');
  assert.ok(!/\son[a-z]+\s*=/i.test(html), 'no on* attribute');
  const focusable = /<(?:a\s[^>]*href|button|input|select|textarea)\b[^>]*>|<[a-z]+[^>]*\btabindex="(?:0|[1-9]\d*)"[^>]*>/i.exec(html);
  assert.ok(focusable, 'a focusable element exists');
  assert.match(focusable[0], /data-testid="skip-link"/, 'skip-link is the first focusable element');
  assert.match(html, /<[^>]*data-testid="status-live"[^>]*aria-live="polite"|<[^>]*aria-live="polite"[^>]*data-testid="status-live"/);
  assert.match(html, /<[^>]*data-testid="alert-live"[^>]*role="alert"|<[^>]*role="alert"[^>]*data-testid="alert-live"/);
});

test('served HTML and JS contain every data-testid of the ux.md table as a literal string', async () => {
  const s = await getPlain();
  let all = (await s.call('GET', '/')).text;
  for (const url of jsFiles()) all += `\n${(await s.call('GET', url)).text}`;
  assert.ok(TESTIDS.length >= 130);
  const missing = TESTIDS.filter((id) => !all.includes(id));
  assert.deepEqual(missing, []);
});

test('served files reference no external origin except the three allowed ones (XML namespace identifiers are not requests)', async () => {
  const s = await getPlain();
  const urls = ['/', '/app.css', '/tokens.css', '/favicon.svg', ...jsFiles()];
  const allowed = [/^https:\/\/bytebytego\.com\/guides\/[a-z0-9-]*$/, /^https:\/\/github\.com\/ByteByteGoHq\/system-design-101$/, /^https:\/\/creativecommons\.org\/licenses\/by-nc-nd\/4\.0\/$/,
    /^http:\/\/www\.w3\.org\/(2000\/svg|1999\/xlink)$/];
  const bad = [];
  for (const url of urls) {
    const text = (await s.call('GET', url)).text;
    for (const m of text.matchAll(/(?:https?:)?\/\/[^\s"'`)<>\\]+/g)) {
      const u = m[0].split('${')[0];
      if (!/^https?:/.test(u) && !/^\/\/[a-z0-9.-]+\.[a-z]{2,}/i.test(u)) continue; // comments and regexes
      if (!allowed.some((re) => re.test(u.replace(/[.,;]+$/, '')))) bad.push(`${url}: ${u}`);
    }
  }
  assert.deepEqual(bad, []);
});

test('CSS hygiene: no @import, no external url(), no @font-face and no hex colour in app.css', async () => {
  const s = await getPlain();
  for (const p of ['/app.css', '/tokens.css']) {
    const css = (await s.call('GET', p)).text;
    assert.ok(css.length > 200, `${p} has content`);
    assert.ok(!/@import/i.test(css), `${p}: @import`);
    for (const m of css.matchAll(/url\(\s*['"]?([^)'"]*)/gi)) assert.ok(!/^(?:https?:|\/\/|data:)/i.test(m[1].trim()), `${p}: url(${m[1]})`);
  }
  const app = (await s.call('GET', '/app.css')).text;
  assert.ok(!/@font-face/i.test(app));
  assert.ok(!/#[0-9a-f]{3,8}\b(?![-\w])/i.test(app.replace(/url\(#[^)]*\)/g, '')), 'no hex colour in app.css');
  const html = (await s.call('GET', '/')).text;
  for (const m of html.matchAll(/(?:href|src)="([^"]+)"/g)) assert.ok(!/^(?:https?:|\/\/)/.test(m[1]) || /^https:\/\/(?:bytebytego\.com|github\.com|creativecommons\.org)\//.test(m[1]), `index.html links ${m[1]}`);
});

// ------------------------------------------------------------------ robustness
test('malformed requests do not crash the server', async () => {
  const s = await getPlain();
  await rawExchange(s, 'GARBAGE\r\n\r\n', 500);
  await rawExchange(s, Buffer.from([0xff, 0xfe, 0x00, 0x01, 0x02]), 500);
  await rawExchange(s, 'GET / HTTP/1.1\r\nHost: localhost\r\nX: ' + 'a'.repeat(100000) + '\r\n\r\n', 500);
  await rawExchange(s, `GET /${'a'.repeat(20000)} HTTP/1.1\r\nHost: localhost:${s.port}\r\n\r\n`, 500);
  const r = await s.call('GET', '/');
  assert.equal(r.status, 200);
  assert.equal(s.exited(), null, 'still running');
});

test('50 concurrent requests all get the same answer', async () => {
  const s = await getPlain();
  const results = await Promise.all(Array.from({ length: 50 }, (_, i) => s.call('GET', i % 2 ? '/' : '/scenarios/index.json')));
  assert.ok(results.every((r) => r.status === 200));
  assert.equal(new Set(results.filter((_, i) => i % 2).map((r) => r.text)).size, 1);
});
