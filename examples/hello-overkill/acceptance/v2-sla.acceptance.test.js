'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { withServer, hello, tmpDir, sseOpen, READ_ENV } = require('./helpers-v2');

const SLA = (s, headers) => s.call('GET', '/api/sla', undefined, undefined, headers);
const routeOf = (body, label) => body.routes.find((r) => r.route === label);
const LABEL = /^(?:(?:GET|POST) \/[A-Za-z\/:-]*|other)$/;

test('sla: 200 with the documented top-level shape', () => withServer(async (s) => {
  await hello(s, { name: 'Ada' });
  const r = await SLA(s);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /^application\/json; charset=utf-8$/);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  for (const k of ['startedAt', 'uptimeSeconds', 'windowSeconds', 'total', 'helloPerMinute', 'streamsOpen', 'routes']) assert.ok(k in r.body, k);
  assert.ok(!Number.isNaN(Date.parse(r.body.startedAt)));
  assert.ok(Number.isInteger(r.body.uptimeSeconds) && r.body.uptimeSeconds >= 0 && r.body.uptimeSeconds < 60);
  assert.equal(r.body.windowSeconds, 300);
  assert.equal(r.body.streamsOpen, 0);
  for (const k of ['count', 'errorRate', 'clientErrorRate', 'p50', 'p95', 'p99']) assert.ok(k in r.body.total, k);
  assert.ok(Array.isArray(r.body.routes));
}, READ_ENV()));

test('sla: route rows have the documented fields and consistent percentiles', () => withServer(async (s) => {
  for (let i = 0; i < 5; i += 1) await hello(s, { name: `User ${i}` });
  const row = routeOf((await SLA(s)).body, 'POST /hello');
  assert.ok(row, 'POST /hello row');
  assert.deepEqual(Object.keys(row).sort(), ['count', 'errorRate', 'errors4xx', 'errors5xx', 'p50', 'p95', 'p99', 'route']);
  assert.equal(row.count, 5);
  assert.equal(row.errors5xx, 0);
  assert.equal(row.errors4xx, 0);
  assert.equal(row.errorRate, 0);
  for (const k of ['p50', 'p95', 'p99']) assert.equal(typeof row[k], 'number');
  assert.ok(row.p50 <= row.p95 && row.p95 <= row.p99);
  assert.equal(Math.round(row.p95 * 10) / 10, row.p95, 'rounded to 0.1 ms');
}, READ_ENV()));

test('sla: helloPerMinute counts POST /hello 2xx over the 5 minute window', () => withServer(async (s) => {
  for (let i = 0; i < 6; i += 1) await hello(s, { name: `User ${i}` });
  await hello(s, { name: '' });
  const r = (await SLA(s)).body;
  assert.ok(Math.abs(r.helloPerMinute - 6 / 5) < 0.11, String(r.helloPerMinute));
}, READ_ENV()));

test('sla: 4xx responses are client errors, not outages', () => withServer(async (s) => {
  for (let i = 0; i < 3; i += 1) assert.equal((await s.call('GET', `/api/certificates/${crypto.randomBytes(8).toString('hex')}`)).status, 404);
  const body = (await SLA(s)).body;
  const row = routeOf(body, 'GET /api/certificates/:id');
  assert.ok(row, 'certificate route label');
  assert.equal(row.count, 3);
  assert.equal(row.errors4xx, 3);
  assert.equal(row.errors5xx, 0);
  assert.equal(row.errorRate, 0);
  assert.ok(body.total.clientErrorRate > 0);
  assert.equal(body.total.errorRate, 0);
}, READ_ENV()));

test('sla: 429 responses are counted as 4xx', () => withServer(async (s) => {
  for (let i = 0; i < 5; i += 1) await s.call('POST', '/hello', { name: `U${i}` });
  const row = routeOf((await SLA(s)).body, 'POST /hello');
  assert.ok(row.errors4xx >= 2, JSON.stringify(row));
  assert.equal(row.errors5xx, 0);
  assert.equal(row.errorRate, 0);
}, { env: { HELLO_RATE_LIMIT: '3', HELLO_READ_LIMIT: '10000' } }));

test('sla: 5xx responses count as errors (persist failure gives a 500)', async () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'blocker'), 'x');
  await withServer(async (s) => {
    assert.equal((await hello(s, { name: 'Ada' })).status, 500);
    assert.equal((await hello(s, { name: 'Bob' })).status, 500);
    await hello(s, undefined);
    const body = (await SLA(s)).body;
    const row = routeOf(body, 'POST /hello');
    assert.equal(row.errors5xx, 2);
    assert.equal(row.count, 3);
    assert.ok(Math.abs(row.errorRate - 2 / 3) < 0.01, String(row.errorRate));
    assert.ok(body.total.errorRate > 0);
  }, { file: path.join(dir, 'blocker', 'hello.json'), ...READ_ENV() });
});

test('sla: route labels are a bounded fixed set (ids, queries and unknown paths never become labels)', () => withServer(async (s) => {
  const ids = [];
  for (let i = 0; i < 25; i += 1) { const id = crypto.randomBytes(8).toString('hex'); ids.push(id); await s.call('GET', `/api/certificates/${id}`); }
  for (let i = 0; i < 25; i += 1) await s.call('GET', `/no/such/path-${i}?x=${i}`);
  await s.call('GET', '/hello?foo=bar-secret');
  await s.call('GET', '/api/weather?place=secret-place');
  const r = await SLA(s);
  assert.ok(r.body.routes.length <= 25, `labels: ${r.body.routes.length}`);
  for (const row of r.body.routes) assert.match(row.route, LABEL, row.route);
  for (const id of ids) assert.ok(!r.text.includes(id));
  assert.ok(!r.text.includes('secret'));
  assert.ok(!r.text.includes('path-'));
  assert.equal(routeOf(r.body, 'GET /api/certificates/:id').count, 25);
  assert.equal(routeOf(r.body, 'other').count, 25);
  assert.ok(routeOf(r.body, 'GET /hello'));
}, READ_ENV()));

test('sla: routes are sorted by count desc then label asc and zero-sample routes are omitted', () => withServer(async (s) => {
  for (let i = 0; i < 4; i += 1) await s.call('GET', '/healthz');
  for (let i = 0; i < 2; i += 1) await s.call('GET', '/api/catalogue');
  const rows = (await SLA(s)).body.routes;
  for (let i = 1; i < rows.length; i += 1) {
    const a = rows[i - 1];
    const b = rows[i];
    assert.ok(a.count > b.count || (a.count === b.count && a.route < b.route), `${a.route}(${a.count}) before ${b.route}(${b.count})`);
  }
  assert.ok(rows.every((r) => r.count > 0));
  assert.equal(routeOf({ routes: rows }, 'POST /api/verify'), undefined);
  assert.equal(routeOf({ routes: rows }, 'GET /healthz').count, 4);
}, READ_ENV()));

test('sla: the stream is excluded from latency rows and counted as streamsOpen', () => withServer(async (s) => {
  const st = await sseOpen(s);
  try {
    await st.waitFor((x) => x.text().includes(': connected'));
    const r = (await SLA(s)).body;
    assert.equal(r.streamsOpen, 1);
    assert.ok(!r.routes.some((x) => x.route.includes('/api/stream')));
  } finally { st.close(); }
}, READ_ENV()));

test('sla: exposes no names, ips or addresses', () => withServer(async (s) => {
  await hello(s, { name: 'Confidential Carla' });
  const r = await SLA(s);
  assert.ok(!/Carla|127\.0\.0\.1|::1/i.test(r.text));
}, READ_ENV()));

test('sla: POST is 405 with allow GET', () => withServer(async (s) => {
  const r = await s.call('POST', '/api/sla', {});
  assert.equal(r.status, 405);
  assert.match(r.headers.get('allow'), /GET/);
}, READ_ENV()));

test('sla: the read limiter answers 429 with Retry-After', () => withServer(async (s) => {
  assert.equal((await SLA(s)).status, 200);
  assert.equal((await SLA(s)).status, 200);
  const r = await SLA(s);
  assert.equal(r.status, 429);
  assert.ok(r.headers.get('retry-after'));
  assert.equal(r.body.error, "You've been greeted enough.");
}, { env: { HELLO_READ_LIMIT: '2' } }));

test('sla: HELLO_SLA_TOKEN requires a matching bearer token (401 otherwise)', () => withServer(async (s) => {
  assert.equal((await SLA(s)).status, 401);
  assert.equal((await SLA(s, { authorization: 'Bearer wrong-token' })).status, 401);
  assert.equal((await SLA(s, { authorization: 's3cret-token' })).status, 401);
  assert.equal((await SLA(s, { authorization: 'Bearer s3cret-toke' })).status, 401);
  const ok = await SLA(s, { authorization: 'Bearer s3cret-token' });
  assert.equal(ok.status, 200);
  assert.ok(Array.isArray(ok.body.routes));
  assert.equal(typeof (await SLA(s)).body.error, 'string');
}, { env: { HELLO_SLA_TOKEN: 's3cret-token', HELLO_READ_LIMIT: '10000' } }));

test('sla: without a token the endpoint is open', () => withServer(async (s) => {
  assert.equal((await SLA(s)).status, 200);
}, { env: { HELLO_SLA_TOKEN: null, HELLO_READ_LIMIT: '10000' } }));

test('sla: v1 behaviour is untouched while it records (core hello byte-exact)', () => withServer(async (s) => {
  const r = await s.call('POST', '/hello', {});
  assert.equal(r.text, '{"message":"Hello World! Welcome to the API."}');
  assert.equal((await s.call('GET', '/healthz')).text, '{"ok":true}');
}));
