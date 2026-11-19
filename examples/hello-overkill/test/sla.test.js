'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createSla, routeLabel, percentile, withSla, LABELS } = require('../src/sla');

test('routeLabel maps known routes to fixed labels', () => {
  const cases = [
    ['POST', '/hello', 'POST /hello'], ['GET', '/hello', 'GET /hello'], ['GET', '/', 'GET /'],
    ['GET', '/healthz', 'GET /healthz'], ['GET', '/api/catalogue', 'GET /api/catalogue'],
    ['GET', '/api/certificates/0123456789abcdef', 'GET /api/certificates/:id'],
    ['POST', '/api/verify', 'POST /api/verify'], ['GET', '/api/battle', 'GET /api/battle'],
    ['POST', '/api/battle/vote', 'POST /api/battle/vote'], ['GET', '/api/leaderboard', 'GET /api/leaderboard'],
    ['GET', '/api/weather?place=x', 'GET /api/weather'], ['GET', '/api/stream', 'GET /api/stream'],
    ['GET', '/api/sla', 'GET /api/sla'], ['GET', '/api/time-machine', 'GET /api/time-machine'],
    ['POST', '/api/haiku', 'POST /api/haiku'], ['GET', '/api/federation', 'GET /api/federation'],
    ['GET', '/api/federation/hello?name=a', 'GET /api/federation/hello'], ['post', '/hello', 'POST /hello'],
  ];
  for (const [m, p, want] of cases) assert.equal(routeLabel(m, p), want, `${m} ${p}`);
});

test('routeLabel strips one trailing slash so /hello/, /api/stream/ and /api/sla/ keep their labels', () => {
  const cases = [['POST', '/hello/', 'POST /hello'], ['GET', '/hello/', 'GET /hello'], ['GET', '/api/stream/', 'GET /api/stream'],
    ['GET', '/api/sla/', 'GET /api/sla'], ['GET', '/api/sla/?x=1', 'GET /api/sla'], ['GET', '/', 'GET /'],
    ['GET', '/api/certificates/0123456789abcdef/', 'GET /api/certificates/:id'], ['GET', '/hello//', 'other']];
  for (const [m, p, want] of cases) assert.equal(routeLabel(m, p), want, `${m} ${p}`);
});

test('routeLabel sends unknown paths, methods and bad input to other', () => {
  for (const [m, p] of [['GET', '/nope'], ['DELETE', '/hello'], ['GET', '/api/certificates/'], ['GET', '/api/certificates/a/b'],
    ['GET', '/nope/'], [undefined, '/hello'], ['GET', undefined], ['GET', '/other'], ['GET', 'other']]) {
    assert.equal(routeLabel(m, p), 'other', `${m} ${p}`);
  }
});

test('label set is fixed and bounded', () => {
  assert.ok(LABELS.length <= 20);
  const seen = new Set();
  for (let i = 0; i < 500; i++) seen.add(routeLabel('GET', `/api/certificates/${i}`)).add(routeLabel('GET', `/x${i}?q=${i}`));
  assert.deepEqual([...seen].sort(), ['GET /api/certificates/:id', 'other']);
});

test('percentile is nearest rank', () => {
  assert.equal(percentile([], 50), null);
  assert.equal(percentile(undefined, 50), null);
  const s = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  assert.equal(percentile(s, 50), 5);
  assert.equal(percentile(s, 95), 10);
  assert.equal(percentile(s, 90), 9);
  assert.equal(percentile(s, 99), 10);
  assert.equal(percentile(s, 0), 1);
  assert.equal(percentile(s, 100), 10);
  assert.equal(percentile([7], 50), 7);
});

test('empty snapshot has nulls and zeros', () => {
  let t = Date.parse('2026-11-18T09:00:00.000Z');
  const sla = createSla({ now: () => t });
  t += 4312 * 1000;
  assert.deepEqual(sla.snapshot(), {
    startedAt: '2026-11-18T09:00:00.000Z', uptimeSeconds: 4312, windowSeconds: 300,
    total: { count: 0, errorRate: 0, clientErrorRate: 0, p50: null, p95: null, p99: null },
    helloPerMinute: 0, streamsOpen: 0, routes: [],
  });
});

test('snapshot aggregates counts, error classes and percentiles', () => {
  let t = 1000000;
  const sla = createSla({ now: () => t });
  for (let i = 1; i <= 10; i++) sla.record({ route: 'POST /hello', status: 200, ms: i + 0.04 });
  sla.record({ route: 'POST /hello', status: 429, ms: 1 });
  sla.record({ route: 'POST /hello', status: 418, ms: 1 });
  sla.record({ route: 'GET /healthz', status: 500, ms: 2 });
  sla.record({ route: 'GET /healthz', status: 200, ms: 3 });
  const s = sla.snapshot({ streamsOpen: 2 });
  assert.equal(s.streamsOpen, 2);
  assert.equal(s.total.count, 14);
  assert.equal(s.total.errorRate, 0.0714);
  assert.equal(s.total.clientErrorRate, 0.1429);
  const hello = s.routes[0];
  assert.equal(hello.route, 'POST /hello');
  assert.equal(hello.count, 12);
  assert.equal(hello.errors5xx, 0);
  assert.equal(hello.errors4xx, 2);
  assert.equal(hello.errorRate, 0);
  assert.equal(hello.p50, 4);
  assert.equal(hello.p95, 10);
  assert.equal(hello.p99, 10);
  assert.equal('clientErrorRate' in hello, false);
  assert.equal(s.routes[1].route, 'GET /healthz');
  assert.equal(s.routes[1].errors5xx, 1);
  assert.equal(s.routes[1].errorRate, 0.5);
  assert.equal(s.helloPerMinute, 2);
});

test('routes sort by count desc then label asc', () => {
  const sla = createSla({ now: () => 1 });
  sla.record({ route: 'GET /healthz', status: 200, ms: 1 });
  sla.record({ route: 'GET /', status: 200, ms: 1 });
  sla.record({ route: 'POST /hello', status: 200, ms: 1 });
  sla.record({ route: 'POST /hello', status: 200, ms: 1 });
  assert.deepEqual(sla.snapshot().routes.map((r) => r.route), ['POST /hello', 'GET /', 'GET /healthz']);
});

test('samples older than the window are ignored and empty routes omitted', () => {
  let t = 0;
  const sla = createSla({ now: () => t, windowMs: 1000 });
  sla.record({ route: 'GET /', status: 200, ms: 1 });
  t = 500;
  sla.record({ route: 'GET /healthz', status: 200, ms: 1 });
  t = 1000;
  let s = sla.snapshot();
  assert.deepEqual(s.routes.map((r) => r.route), ['GET /healthz']);
  assert.equal(s.windowSeconds, 1);
  t = 1500;
  s = sla.snapshot();
  assert.deepEqual(s.routes, []);
  assert.equal(s.total.count, 0);
});

test('memory is bounded per label by maxSamples', () => {
  const sla = createSla({ now: () => 1, maxSamples: 4 });
  for (let i = 1; i <= 10; i++) sla.record({ route: 'GET /', status: 200, ms: i });
  const r = sla.snapshot().routes[0];
  assert.equal(r.count, 4);
  assert.equal(r.p50, 8);
  assert.equal(r.p99, 10);
});

test('unknown labels collapse into other', () => {
  const sla = createSla({ now: () => 1 });
  for (let i = 0; i < 50; i++) sla.record({ route: `GET /id/${i}`, status: 200, ms: 1 });
  assert.deepEqual(sla.snapshot().routes.map((r) => [r.route, r.count]), [['other', 50]]);
});

test('stream requests are excluded from latency and only counted as opened', () => {
  const sla = createSla({ now: () => 1 });
  sla.record({ route: 'GET /api/stream', status: 200, ms: 99999 });
  sla.record({ route: 'GET /api/stream', status: 503, ms: 1 });
  assert.equal(sla.streamsOpened(), 1);
  const s = sla.snapshot();
  assert.equal(s.total.count, 0);
  assert.deepEqual(s.routes, []);
});

test('helloPerMinute counts only 2xx POST /hello', () => {
  const sla = createSla({ now: () => 1, windowMs: 120000 });
  for (let i = 0; i < 6; i++) sla.record({ route: 'POST /hello', status: 200, ms: 1 });
  sla.record({ route: 'POST /hello', status: 400, ms: 1 });
  sla.record({ route: 'GET /hello', status: 200, ms: 1 });
  assert.equal(sla.snapshot().helloPerMinute, 3);
});

function fakeRes() {
  const res = new EventEmitter();
  res.statusCode = 200;
  return res;
}

test('withSla records once with injected clock on finish and ignores the later close', async () => {
  const sla = createSla({ now: () => 1 });
  const ticks = [100, 107.25];
  const handler = async (req, res) => { res.statusCode = 201; res.emit('finish'); res.emit('close'); };
  await withSla(handler, sla, { clock: () => ticks.shift() })({ method: 'POST', url: '/hello' }, fakeRes());
  const s = sla.snapshot();
  assert.equal(s.routes.length, 1);
  assert.equal(s.routes[0].route, 'POST /hello');
  assert.equal(s.routes[0].count, 1);
  assert.equal(s.routes[0].p50, 7.3);
});

test('withSla records on close when the socket is destroyed', async () => {
  const sla = createSla({ now: () => 1 });
  const res = fakeRes();
  await withSla(async () => { res.emit('close'); }, sla, { clock: () => 0 })({ method: 'GET', url: '/healthz?x=1' }, res);
  assert.equal(sla.snapshot().routes[0].route, 'GET /healthz');
});

test('withSla swallows recording failures and passes the handler result through', async () => {
  const bad = { record() { throw new Error('boom'); }, clock: () => 0 };
  const res = fakeRes();
  const out = await withSla(async () => { setImmediate(() => res.emit('finish')); return 'done'; }, bad)({ method: 'GET', url: '/' }, res);
  assert.equal(out, 'done');
  await new Promise((r) => setImmediate(r));
});

test('withSla counts a stream open without waiting for it to end', async () => {
  const sla = createSla({ now: () => 1 });
  const res = fakeRes();
  await withSla(async () => {}, sla, { clock: () => 0 })({ method: 'GET', url: '/api/stream' }, res);
  assert.equal(sla.streamsOpened(), 1);
  assert.deepEqual(sla.snapshot().routes, []);
});

test('withSla defaults to the sla clock and performance.now', async () => {
  const sla = createSla({ now: () => 1, clock: () => 5 });
  const res = fakeRes();
  await withSla(async () => { res.emit('finish'); }, sla)({ method: 'GET', url: '/' }, res);
  assert.equal(sla.snapshot().routes[0].p50, 0);
  const plain = createSla({ now: () => 1 });
  const r2 = fakeRes();
  await withSla(async () => { res.emit('x'); r2.emit('finish'); }, plain)({ method: 'GET', url: '/' }, r2);
  assert.equal(plain.snapshot().routes[0].count, 1);
});
