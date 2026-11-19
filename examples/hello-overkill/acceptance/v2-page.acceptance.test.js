'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { withServer, CORE_BODY } = require('./helpers-v2');

const V1_TESTIDS = ['nav-hello', 'nav-battle', 'nav-verify', 'status', 'name-input', 'language-select', 'tone-select', 'chaos-toggle', 'say-hello', 'name-error', 'result-empty', 'result-loading', 'greeting-text', 'visit-count', 'streak-count', 'cert-link', 'error-message', 'retry-btn', 'rate-limit-message', 'cert-name', 'cert-greeting', 'cert-date', 'cert-signature', 'cert-text', 'cert-copy', 'cert-verify-link', 'verify-input', 'verify-btn', 'verify-result', 'verify-verdict', 'battle-option-a', 'battle-option-b', 'battle-next', 'leaderboard', 'leaderboard-row', 'lb-greeting', 'lb-votes', 'view-title'];

const V2 = {
  weather: ['nav-weather', 'weather-place-input', 'weather-date-input', 'weather-name-input', 'weather-go', 'weather-forecast', 'weather-greeting', 'weather-chance', 'weather-error'],
  wall: ['nav-wall', 'wall-list', 'wall-item', 'wall-status', 'wall-count', 'wall-empty'],
  sla: ['nav-sla', 'sla-uptime', 'sla-total-count', 'sla-error-rate', 'sla-p50', 'sla-p95', 'sla-p99', 'sla-hello-rate', 'sla-table', 'sla-row', 'sla-route', 'sla-count', 'sla-row-p95', 'sla-error'],
  'time-machine': ['nav-time-machine', 'tm-date-input', 'tm-name-input', 'tm-go', 'tm-era', 'tm-greeting', 'tm-streak', 'tm-error'],
  haiku: ['nav-haiku', 'haiku-name-input', 'haiku-theme-select', 'haiku-syllables-input', 'haiku-go', 'haiku-line', 'haiku-counts', 'haiku-error'],
  federation: ['nav-federation', 'fed-notice', 'fed-health-btn', 'fed-summary', 'fed-peer-row', 'fed-peer-origin', 'fed-peer-status', 'fed-name-input', 'fed-hello-btn', 'fed-result', 'fed-result-greeting', 'fed-result-error', 'fed-empty'],
};
const ALL_V2 = Object.values(V2).flat();
const getPage = (s) => s.call('GET', '/');
const hasTestId = (text, id) => new RegExp(`data-testid\\s*=\\s*["']${id}["']|['"\`]${id}['"\`]`).test(text);

test('page v2: the v2 testid list has the expected size and no duplicates', () => {
  assert.equal(ALL_V2.length, new Set(ALL_V2).size);
  assert.equal(ALL_V2.length, 9 + 6 + 14 + 8 + 8 + 13);
});

for (const [view, ids] of Object.entries(V2)) {
  test(`page v2: every ${view} data-testid is present`, () => withServer(async (s) => {
    const { text } = await getPage(s);
    assert.deepEqual(ids.filter((id) => !hasTestId(text, id)), []);
  }));
}

test('page v2: the 38 v1 data-testids are still present', () => withServer(async (s) => {
  const { text } = await getPage(s);
  assert.equal(new Set(V1_TESTIDS).size, 38);
  assert.deepEqual(V1_TESTIDS.filter((id) => !hasTestId(text, id)), []);
}));

test('page v2: the six new hash routes are present next to the v1 routes', () => withServer(async (s) => {
  const { text } = await getPage(s);
  for (const route of ['#/hello', '#/battle', '#/verify', '#/certificate/', '#/weather', '#/wall', '#/sla', '#/time-machine', '#/haiku', '#/federation']) assert.ok(text.includes(route), route);
}));

test('page v2: nav links for the new views exist and point at their hash routes', () => withServer(async (s) => {
  const { text } = await getPage(s);
  for (const key of ['weather', 'wall', 'sla', 'time-machine', 'haiku', 'federation']) {
    const link = new RegExp(`<a\\b[^>]*data-testid\\s*=\\s*["']nav-${key}["'][^>]*>|<a\\b[^>]*href\\s*=\\s*["']#/${key}["'][^>]*>`);
    assert.match(text, link, `nav link for ${key}`);
    assert.ok(text.includes(`#/${key}`), key);
  }
}));

test('page v2: view titles and fixed copy from the spec are present', () => withServer(async (s) => {
  const { text } = await getPage(s);
  for (const copy of ['Hello Weather', "Pick a place to see today's greeting forecast.", 'Connected', 'Reconnecting...', 'Wall is full, try later', 'Your name is sent to the listed peers.', 'No peers configured. Set HELLO_PEERS.', '5-7-5 verified']) assert.ok(text.includes(copy), copy);
}));

test('page v2: the wall uses EventSource on /api/stream and closes it; the SLA view polls with a timer', () => withServer(async (s) => {
  const { text } = await getPage(s);
  assert.match(text, /new EventSource\(\s*['"]\/api\/stream['"]/);
  assert.match(text, /\.close\(\)/);
  assert.match(text, /pagehide/);
  assert.match(text, /\/api\/sla/);
  assert.match(text, /clearInterval|clearTimeout/);
  for (const p of ['/api/weather', '/api/time-machine', '/api/haiku', '/api/federation']) assert.ok(text.includes(p), p);
}));

test('page v2: the time machine date input has min 1900-01-01', () => withServer(async (s) => {
  const { text } = await getPage(s);
  assert.match(text, /min\s*=\s*["']1900-01-01["']/);
}));

test('page v2: still one inline script and one inline style, both hashed in the CSP', () => withServer(async (s) => {
  const r = await getPage(s);
  const csp = r.headers.get('content-security-policy');
  const scripts = [...r.text.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  const styles = [...r.text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]);
  assert.equal(scripts.length, 1);
  assert.equal(styles.length, 1);
  const hash = (b) => `'sha256-${crypto.createHash('sha256').update(b, 'utf8').digest('base64')}'`;
  assert.ok(csp.includes(hash(scripts[0])), 'script hash matches');
  assert.ok(csp.includes(hash(styles[0])), 'style hash matches');
  assert.ok(!/<script[^>]*\bsrc=/i.test(r.text), 'no external scripts');
  assert.ok(!/unsafe-inline|unsafe-eval/.test(csp));
  assert.ok(csp.includes("connect-src 'self'"));
}));

test('page v2: dynamic text uses textContent only and there are no inline handlers or style attributes', () => withServer(async (s) => {
  const { text } = await getPage(s);
  assert.ok(text.includes('textContent'));
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(/.test(text));
  assert.ok(!/<[^>]+\son\w+\s*=/i.test(text));
  assert.ok(!/\sstyle\s*=\s*["']/i.test(text));
  assert.ok(!/<(?:a|link|img)\b[^>]*\b(?:href|src)\s*=\s*["']https?:\/\//i.test(text), 'no external resources');
}));

test('page v2: federation peers and greetings are never rendered as links', () => withServer(async (s) => {
  const { text } = await getPage(s);
  assert.ok(!/setAttribute\(\s*['"]href['"]\s*,[ \t]*(?![ \t]|['"]#)/.test(text), 'href only set to hash routes');
}));

test('page v2: security headers are unchanged on the page', () => withServer(async (s) => {
  const r = await getPage(s);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(r.headers.get('access-control-allow-origin'), null);
}));

test('v1 contract: POST /hello with no body or {} is byte-exact', () => withServer(async (s) => {
  assert.equal((await s.call('POST', '/hello')).text, CORE_BODY);
  assert.equal((await s.call('POST', '/hello', {})).text, CORE_BODY);
  assert.equal((await s.call('GET', '/hello')).text, CORE_BODY);
}));

test('v1 contract: existing routes still behave (healthz, catalogue, 404, 405)', () => withServer(async (s) => {
  assert.equal((await s.call('GET', '/healthz')).text, '{"ok":true}');
  const cat = await s.call('GET', '/api/catalogue');
  assert.equal(cat.status, 200);
  assert.equal(cat.body.languages.length, 10);
  assert.equal((await s.call('GET', '/definitely/not/here')).status, 404);
  assert.equal((await s.call('POST', '/healthz', {})).status, 405);
}));

test('v1 contract: a named hello keeps its exact field set', () => withServer(async (s) => {
  const r = await s.call('POST', '/hello', { name: 'Ada' });
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.body).sort(), ['certificate', 'greeting', 'language', 'message', 'name', 'streak', 'tone', 'visit']);
}));

test('v2 routes exist: none of the new paths is a 404', () => withServer(async (s) => {
  for (const [m, p] of [['GET', '/api/weather'], ['GET', '/api/sla'], ['GET', '/api/time-machine?date=2001-01-01'], ['POST', '/api/haiku'], ['GET', '/api/federation'], ['GET', '/api/federation/hello?name=Ada']]) {
    const r = await s.call(m, p, m === 'POST' ? { name: 'Ada' } : undefined);
    assert.notEqual(r.status, 404, `${m} ${p}`);
  }
}, { env: { HELLO_READ_LIMIT: '10000' } }));
