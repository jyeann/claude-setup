'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createHub, anonymise } = require('../src/stream');

function fakeRes() {
  const res = new EventEmitter();
  res.chunks = [];
  res.writableLength = 0;
  res.writableEnded = false;
  res.destroyed = false;
  res.headersSent = false;
  res.writeHead = (status, headers) => { res.status = status; res.headers = headers; res.headersSent = true; };
  res.write = (c) => { res.chunks.push(c); return true; };
  res.end = () => { res.writableEnded = true; res.emit('close'); };
  res.destroy = () => { res.destroyed = true; res.emit('close'); };
  res.text = () => res.chunks.join('');
  return res;
}

function fakeTimers() {
  const t = { set: [], cleared: [], unref: 0 };
  t.setInterval = (fn, ms) => { const h = { fn, ms, unref() { t.unref++; return h; } }; t.set.push(h); return h; };
  t.clearInterval = (h) => t.cleared.push(h);
  return t;
}

function mk(opts = {}) {
  const timers = fakeTimers();
  const hub = createHub({ now: () => Date.parse('2026-11-18T10:15:30.789Z'), setInterval: timers.setInterval, clearInterval: timers.clearInterval, ...opts });
  return { hub, timers };
}

test('anonymise maps visit and streak to the highest milestone', () => {
  assert.equal(anonymise({ language: 'es', tone: 'pirate', visit: 1, streak: 1 }).milestone, 'first-visit');
  assert.equal(anonymise({ visit: 10 }).milestone, 'visit-10');
  assert.equal(anonymise({ visit: 100 }).milestone, 'visit-100');
  assert.equal(anonymise({ streak: 7 }).milestone, 'streak-7');
  assert.equal(anonymise({ streak: 30 }).milestone, 'streak-30');
  assert.equal(anonymise({ streak: 100, visit: 100 }).milestone, 'streak-100');
  assert.equal(anonymise({ visit: 10, streak: 7 }).milestone, 'visit-10');
  assert.equal(anonymise({ visit: 5, streak: 3 }).milestone, null);
});

test('anonymise returns exactly the payload fields and ignores extras', () => {
  const out = anonymise({ language: 'es', tone: 'pirate', visit: 2, streak: 2, name: 'Ada', greeting: 'Hola Ada', id: 'abc', ip: '1.2.3.4' });
  assert.deepEqual(out, { language: 'es', tone: 'pirate', milestone: null });
});

test('anonymise falls back to defaults for bad language and tone and handles non-objects', () => {
  assert.deepEqual(anonymise({ language: '<x>', tone: 5 }), { language: 'en', tone: 'formal', milestone: null });
  assert.deepEqual(anonymise(null), { language: 'en', tone: 'formal', milestone: null });
  assert.deepEqual(anonymise(undefined), { language: 'en', tone: 'formal', milestone: null });
  assert.deepEqual(anonymise({ visit: '10', streak: -7 }), { language: 'en', tone: 'formal', milestone: null });
});

test('anonymise marks core hellos', () => {
  assert.deepEqual(anonymise({ kind: 'core', name: 'x', language: 'es' }), { language: 'en', tone: 'formal', milestone: null, kind: 'core' });
});

test('serialised events never contain the name', () => {
  const { hub } = mk();
  const res = fakeRes();
  hub.subscribe(res, { ip: 'a' });
  const names = ['Ada Lovelace', 'Zoë', '<script>', '日本', 'O\'Brien'];
  for (const name of names) hub.publish({ name, greeting: `Hello ${name}`, language: 'en', tone: 'formal', visit: 1, streak: 1 });
  const text = res.text();
  for (const name of names) assert.ok(!text.includes(name), name);
  assert.ok(!JSON.stringify(hub.history()).includes('Ada'));
});

test('publish assigns increasing ids and second-truncated ISO timestamps in SSE format', () => {
  const { hub } = mk();
  const res = fakeRes();
  assert.equal(hub.subscribe(res, { ip: 'a' }), 'ok');
  hub.publish({ language: 'es', tone: 'pirate', visit: 1, streak: 7 });
  hub.publish({ kind: 'core' });
  const text = res.text();
  assert.ok(text.startsWith('retry: 3000\n\n: connected\n\n'));
  assert.ok(text.includes('id: 1\nevent: hello\ndata: {"id":1,"ts":"2026-11-18T10:15:30.000Z","language":"es","tone":"pirate","milestone":"streak-7"}\n\n'));
  assert.ok(text.includes('id: 2\nevent: hello\ndata: {"id":2,"ts":"2026-11-18T10:15:30.000Z","language":"en","tone":"formal","milestone":null,"kind":"core"}\n\n'));
});

test('subscribe writes the SSE head with extra headers and no content-length', () => {
  const { hub } = mk();
  const res = fakeRes();
  hub.subscribe(res, { ip: 'a', headers: { 'x-content-type-options': 'nosniff' } });
  assert.equal(res.status, 200);
  assert.equal(res.headers['content-type'], 'text/event-stream; charset=utf-8');
  assert.equal(res.headers['cache-control'], 'no-cache, no-store');
  assert.equal(res.headers.connection, 'keep-alive');
  assert.equal(res.headers['x-accel-buffering'], 'no');
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
  assert.equal('content-length' in res.headers, false);
});

test('ring keeps the last ringSize events and replays all when Last-Event-ID is absent or invalid', () => {
  const { hub } = mk({ ringSize: 3 });
  for (let i = 0; i < 5; i++) hub.publish({});
  assert.deepEqual(hub.history().map((e) => e.id), [3, 4, 5]);
  for (const bad of [undefined, null, '', 'abc', '-1', '1.5', '1e3']) {
    const res = fakeRes();
    hub.subscribe(res, { ip: `i${String(bad)}`, lastEventId: bad });
    assert.equal((res.text().match(/^id: /gm) || []).length, 3, String(bad));
  }
});

test('replay sends only events after Last-Event-ID', () => {
  const { hub } = mk();
  for (let i = 0; i < 5; i++) hub.publish({});
  const res = fakeRes();
  hub.subscribe(res, { ip: 'a', lastEventId: '3' });
  assert.deepEqual([...res.text().matchAll(/^id: (\d+)$/gm)].map((m) => Number(m[1])), [4, 5]);
  const none = fakeRes();
  hub.subscribe(none, { ip: 'b', lastEventId: 5 });
  assert.equal(none.text().includes('id: '), false);
  const zero = fakeRes();
  hub.subscribe(zero, { ip: 'c', lastEventId: '0' });
  assert.equal((zero.text().match(/^id: /gm) || []).length, 5);
});

test('total cap returns full and per-ip cap returns ip-full', () => {
  const { hub } = mk({ maxClients: 3, maxPerIp: 2 });
  assert.equal(hub.subscribe(fakeRes(), { ip: 'a' }), 'ok');
  assert.equal(hub.subscribe(fakeRes(), { ip: 'a' }), 'ok');
  const refused = fakeRes();
  assert.equal(hub.subscribe(refused, { ip: 'a' }), 'ip-full');
  assert.equal(refused.chunks.length, 0);
  assert.equal(refused.headersSent, false);
  assert.equal(hub.subscribe(fakeRes(), { ip: 'b' }), 'ok');
  assert.equal(hub.subscribe(fakeRes(), { ip: 'c' }), 'full');
  assert.equal(hub.size(), 3);
});

test('close frees the slot for the ip and the total', () => {
  const { hub } = mk({ maxClients: 1, maxPerIp: 1 });
  const res = fakeRes();
  hub.subscribe(res, { ip: 'a' });
  assert.equal(hub.subscribe(fakeRes(), { ip: 'b' }), 'full');
  res.emit('close');
  assert.equal(hub.size(), 0);
  assert.equal(hub.subscribe(fakeRes(), { ip: 'a' }), 'ok');
});

test('error event also removes the client and later events are not written', () => {
  const { hub } = mk();
  const res = fakeRes();
  hub.subscribe(res, { ip: 'a' });
  res.emit('error', new Error('boom'));
  assert.equal(hub.size(), 0);
  const before = res.chunks.length;
  hub.publish({});
  assert.equal(res.chunks.length, before);
});

test('heartbeat timer starts with the first client, is unref d, shared, and cleared with the last', () => {
  const { hub, timers } = mk({ heartbeatMs: 1234 });
  const a = fakeRes();
  const b = fakeRes();
  hub.subscribe(a, { ip: 'a' });
  hub.subscribe(b, { ip: 'b' });
  assert.equal(timers.set.length, 1);
  assert.equal(timers.set[0].ms, 1234);
  assert.equal(timers.unref, 1);
  timers.set[0].fn();
  assert.ok(a.text().endsWith(': hb\n\n'));
  assert.ok(b.text().endsWith(': hb\n\n'));
  a.emit('close');
  assert.equal(timers.cleared.length, 0);
  b.emit('close');
  assert.deepEqual(timers.cleared, [timers.set[0]]);
  hub.subscribe(fakeRes(), { ip: 'c' });
  assert.equal(timers.set.length, 2);
});

test('slow consumers are destroyed instead of written to', () => {
  const { hub } = mk();
  const res = fakeRes();
  hub.subscribe(res, { ip: 'a' });
  res.writableLength = 65537;
  const before = res.chunks.length;
  hub.publish({});
  assert.equal(res.destroyed, true);
  assert.equal(res.chunks.length, before);
  assert.equal(hub.size(), 0);
});

test('a write that throws drops only that client', () => {
  const { hub } = mk();
  const bad = fakeRes();
  const good = fakeRes();
  hub.subscribe(bad, { ip: 'a' });
  hub.subscribe(good, { ip: 'b' });
  bad.write = () => { throw new Error('EPIPE'); };
  assert.doesNotThrow(() => hub.publish({}));
  assert.equal(hub.size(), 1);
  assert.ok(good.text().includes('id: 1'));
});

test('ended responses are never written to', () => {
  const { hub } = mk();
  const res = fakeRes();
  hub.subscribe(res, { ip: 'a' });
  res.writableEnded = true;
  const before = res.chunks.length;
  hub.publish({});
  assert.equal(res.chunks.length, before);
  assert.equal(hub.size(), 0);
});

test('a client that aborts during replay is dropped without throwing', () => {
  const { hub, timers } = mk();
  hub.publish({});
  hub.publish({});
  const res = fakeRes();
  let n = 0;
  res.write = (c) => { res.chunks.push(c); if (++n === 3) { res.destroyed = true; res.emit('close'); } return true; };
  assert.equal(hub.subscribe(res, { ip: 'a' }), 'ok');
  assert.equal(hub.size(), 0);
  assert.equal(timers.set.length, 0);
});

test('closeAll ends every stream, empties the hub and clears the timer', () => {
  const { hub, timers } = mk();
  const a = fakeRes();
  const b = fakeRes();
  hub.subscribe(a, { ip: 'a' });
  hub.subscribe(b, { ip: 'b' });
  hub.closeAll();
  assert.equal(a.writableEnded, true);
  assert.equal(b.writableEnded, true);
  assert.equal(hub.size(), 0);
  assert.equal(timers.cleared.length, 1);
  assert.doesNotThrow(() => hub.closeAll());
});

test('history returns copies', () => {
  const { hub } = mk();
  hub.publish({ language: 'fr' });
  hub.history()[0].language = 'hacked';
  assert.equal(hub.history()[0].language, 'fr');
});

test('works with the real timers and defaults', () => {
  const hub = createHub();
  const res = fakeRes();
  hub.subscribe(res, {});
  assert.equal(hub.size(), 1);
  hub.closeAll();
  assert.equal(hub.size(), 0);
});

test('milestone priority is streak-100, visit-100, streak-30, visit-10, streak-7, first-visit', () => {
  const order = [
    [{ streak: 100, visit: 100 }, 'streak-100'], [{ streak: 30, visit: 100 }, 'visit-100'], [{ streak: 30, visit: 10 }, 'streak-30'],
    [{ streak: 7, visit: 10 }, 'visit-10'], [{ streak: 7, visit: 1 }, 'streak-7'], [{ streak: 1, visit: 1 }, 'first-visit'],
    [{ streak: 2, visit: 2 }, null],
  ];
  for (const [info, want] of order) assert.equal(anonymise(info).milestone, want, JSON.stringify(info));
  // Each milestone beats every one that follows it in the list.
  const hits = [{ streak: 100 }, { visit: 100 }, { streak: 30 }, { visit: 10 }, { streak: 7 }, { visit: 1 }];
  const names = ['streak-100', 'visit-100', 'streak-30', 'visit-10', 'streak-7', 'first-visit'];
  for (let i = 0; i < hits.length; i++) for (let j = i + 1; j < hits.length; j++) {
    assert.equal(anonymise({ ...hits[j], ...hits[i] }).milestone, names[i], `${names[i]} over ${names[j]}`);
  }
});
