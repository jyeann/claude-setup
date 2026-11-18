'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { withServer, sseOpen, withStream, hello, sleep, parseSse } = require('./helpers-v2');

const MILESTONES = [null, 'first-visit', 'visit-10', 'visit-100', 'streak-7', 'streak-30', 'streak-100'];
const NAME = 'Zebulon Quixote';

test('stream: 200 text/event-stream with the documented headers and no content-length', () => withServer(async (s) => {
  await withStream(s, {}, async (st) => {
    assert.equal(st.status, 200);
    assert.equal(st.headers['content-type'], 'text/event-stream; charset=utf-8');
    assert.equal(st.headers['cache-control'], 'no-cache, no-store');
    assert.equal(st.headers.connection, 'keep-alive');
    assert.equal(st.headers['x-accel-buffering'], 'no');
    assert.equal(st.headers['content-length'], undefined);
    assert.equal(st.headers['x-content-type-options'], 'nosniff');
    assert.equal(st.headers['access-control-allow-origin'], undefined);
  });
}));

test('stream: first bytes are "retry: 3000" then ": connected"', () => withServer(async (s) => {
  await withStream(s, {}, async (st) => {
    await st.waitFor((x) => x.text().includes(': connected\n\n'));
    assert.ok(st.text().startsWith('retry: 3000\n\n: connected\n\n'), JSON.stringify(st.text()));
  });
}));

test('stream: POST is 405 with allow GET', () => withServer(async (s) => {
  const r = await s.call('POST', '/api/stream', {});
  assert.equal(r.status, 405);
  assert.match(r.headers.get('allow'), /GET/);
}));

test('stream: a named hello arrives as id/event/data with the documented payload', () => withServer(async (s) => {
  await withStream(s, {}, async (st) => {
    await st.waitFor((x) => x.text().includes(': connected'));
    assert.equal((await hello(s, { name: NAME, language: 'es', tone: 'pirate' })).status, 200);
    await st.waitFor((x) => x.events().length >= 1);
    const raw = st.text();
    assert.match(raw, /id: 1\nevent: hello\ndata: \{[^\n]*\}\n\n/);
    const ev = st.events()[0];
    assert.equal(ev.id, '1');
    assert.equal(ev.data.id, 1);
    assert.deepEqual(Object.keys(ev.data).sort(), ['id', 'language', 'milestone', 'tone', 'ts']);
    assert.equal(ev.data.language, 'es');
    assert.equal(ev.data.tone, 'pirate');
    assert.equal(ev.data.milestone, 'first-visit');
    assert.match(ev.data.ts, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z$/);
  });
}));

test('stream: the name, greeting and certificate never appear in any event', () => withServer(async (s) => {
  await withStream(s, {}, async (st) => {
    await st.waitFor((x) => x.text().includes(': connected'));
    const names = [NAME, 'ada', 'Mary-Jane O’Neil', 'Дмитрий'];
    const bodies = [];
    for (const n of names) bodies.push((await hello(s, { name: n })).body);
    await st.waitFor((x) => x.events().length >= names.length);
    const raw = st.text().toLowerCase();
    for (const [i, n] of names.entries()) {
      assert.ok(!raw.includes(n.toLowerCase()), `name leaked: ${n}`);
      assert.ok(!raw.includes(bodies[i].certificate.id), 'certificate id leaked');
      assert.ok(!raw.includes(bodies[i].certificate.signature), 'signature leaked');
      assert.ok(!raw.includes(bodies[i].greeting.toLowerCase()), 'greeting leaked');
    }
    assert.ok(!/127\.0\.0\.1|user-agent|node/i.test(raw.replace(/: connected/g, '')), 'no ip or user agent');
  });
}));

test('stream: a core hello publishes the en/formal core event', () => withServer(async (s) => {
  await withStream(s, {}, async (st) => {
    await st.waitFor((x) => x.text().includes(': connected'));
    assert.equal((await s.call('POST', '/hello', {})).status, 200);
    await st.waitFor((x) => x.events().length >= 1);
    const d = st.events()[0].data;
    assert.equal(d.kind, 'core');
    assert.equal(d.language, 'en');
    assert.equal(d.tone, 'formal');
    assert.equal(d.milestone, null);
  });
}));

test('stream: ids increase monotonically from 1 and milestones come from the fixed set', () => withServer(async (s) => {
  await withStream(s, {}, async (st) => {
    await st.waitFor((x) => x.text().includes(': connected'));
    for (let i = 0; i < 10; i += 1) await hello(s, { name: 'Ten Timer' });
    await st.waitFor((x) => x.events().length >= 10);
    const evs = st.events();
    assert.deepEqual(evs.map((e) => e.data.id), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    for (const e of evs) assert.ok(MILESTONES.includes(e.data.milestone), String(e.data.milestone));
    assert.equal(evs[0].data.milestone, 'first-visit');
    assert.equal(evs[1].data.milestone, null);
    assert.equal(evs[9].data.milestone, 'visit-10');
  });
}));

test('stream: a failed hello (400) publishes nothing', () => withServer(async (s) => {
  await withStream(s, {}, async (st) => {
    await st.waitFor((x) => x.text().includes(': connected'));
    assert.equal((await hello(s, { name: '' })).status, 400);
    await sleep(300);
    assert.equal(st.events().length, 0);
  });
}));

test('stream: a new client replays the ring (all events when no Last-Event-ID)', () => withServer(async (s) => {
  for (let i = 0; i < 3; i += 1) await hello(s, { name: `Replay ${i}` });
  await withStream(s, {}, async (st) => {
    await st.waitFor((x) => x.events().length >= 3);
    assert.deepEqual(st.events().map((e) => e.data.id), [1, 2, 3]);
  });
}));

test('stream: Last-Event-ID replays only newer events', () => withServer(async (s) => {
  for (let i = 0; i < 4; i += 1) await hello(s, { name: `Replay ${i}` });
  await withStream(s, { headers: { 'last-event-id': '2' } }, async (st) => {
    await st.waitFor((x) => x.events().length >= 2);
    await sleep(200);
    assert.deepEqual(st.events().map((e) => e.data.id), [3, 4]);
  });
}));

test('stream: a non-numeric or negative Last-Event-ID replays everything', () => withServer(async (s) => {
  for (let i = 0; i < 3; i += 1) await hello(s, { name: `Replay ${i}` });
  for (const v of ['abc', '-1', '1.5', '']) {
    await withStream(s, { headers: { 'last-event-id': v } }, async (st) => {
      await st.waitFor((x) => x.events().length >= 3);
      assert.deepEqual(st.events().map((e) => e.data.id), [1, 2, 3], JSON.stringify(v));
    });
  }
}));

test('stream: the ring keeps only the last 20 events', () => withServer(async (s) => {
  for (let i = 0; i < 25; i += 1) await hello(s, { name: `Ring ${i}` });
  await withStream(s, {}, async (st) => {
    await st.waitFor((x) => x.events().length >= 20);
    await sleep(200);
    const ids = st.events().map((e) => e.data.id);
    assert.equal(ids.length, 20);
    assert.equal(ids[0], 6);
    assert.equal(ids[19], 25);
  });
}));

test('stream: every connected client receives each live event', () => withServer(async (s) => {
  const a = await sseOpen(s);
  const b = await sseOpen(s);
  try {
    await a.waitFor((x) => x.text().includes(': connected'));
    await b.waitFor((x) => x.text().includes(': connected'));
    await hello(s, { name: 'Fan Out' });
    await a.waitFor((x) => x.events().length >= 1);
    await b.waitFor((x) => x.events().length >= 1);
    assert.equal(a.events()[0].data.id, b.events()[0].data.id);
  } finally { a.close(); b.close(); }
}));

test('stream: data is a single line of JSON', () => withServer(async (s) => {
  await withStream(s, {}, async (st) => {
    await st.waitFor((x) => x.text().includes(': connected'));
    await hello(s, { name: 'Line Break' });
    await st.waitFor((x) => x.events().length >= 1);
    for (const block of parseSse(st.text()).filter((e) => e.event === 'hello')) {
      assert.equal(block.raw.split('\n').filter((l) => l.startsWith('data:')).length, 1);
      assert.notEqual(block.data, undefined);
    }
  });
}));

test('stream: a sixth stream from one client is refused with 503', () => withServer(async (s) => {
  const open = [];
  try {
    for (let i = 0; i < 5; i += 1) { const st = await sseOpen(s); assert.equal(st.status, 200, `stream ${i}`); open.push(st); }
    const sixth = await sseOpen(s);
    assert.equal(sixth.status, 503);
    sixth.close();
    open.pop().close();
    await sleep(300);
    const again = await sseOpen(s);
    assert.equal(again.status, 200);
    open.push(again);
  } finally { for (const st of open) st.close(); }
}));

test('stream: the 51st concurrent stream is 503 "too many streams" (or the per-client cap of 5 when extra loopback addresses are unavailable)', () => withServer(async (s) => {
  const open = [];
  try {
    const probe = await sseOpen(s, { localAddress: '127.0.0.2' }).catch((e) => e);
    if (probe instanceof Error) {
      // Only 127.0.0.1 is usable: the per-client cap of 5 is what can be observed.
      for (let i = 0; i < 5; i += 1) { const st = await sseOpen(s); assert.equal(st.status, 200, `stream ${i}`); open.push(st); }
      const sixth = await sseOpen(s);
      assert.equal(sixth.status, 503);
      sixth.close();
      return;
    }
    open.push(probe);
    for (let i = 0; i < 49; i += 1) {
      const ip = `127.0.0.${2 + Math.floor((i + 1) / 5)}`;
      const st = await sseOpen(s, { localAddress: ip });
      assert.equal(st.status, 200, `stream ${i + 1} from ${ip}`);
      open.push(st);
    }
    assert.equal(open.length, 50);
    const over = await sseOpen(s, { localAddress: '127.0.1.9' });
    assert.equal(over.status, 503);
    assert.equal(over.headers['retry-after'], '5');
    await over.waitFor((x) => x.ended());
    assert.deepEqual(JSON.parse(over.text()), { error: 'too many streams' });
  } finally { for (const st of open) st.close(); }
}));

test('stream: closing a client frees its slot (sla streamsOpen tracks open streams)', () => withServer(async (s) => {
  const streamsOpen = async () => (await s.call('GET', '/api/sla')).body.streamsOpen;
  const a = await sseOpen(s);
  const b = await sseOpen(s);
  await a.waitFor((x) => x.text().includes(': connected'));
  assert.equal(await streamsOpen(), 2);
  a.close();
  let n;
  for (let i = 0; i < 40; i += 1) { n = await streamsOpen(); if (n === 1) break; await sleep(50); }
  assert.equal(n, 1);
  b.close();
  for (let i = 0; i < 40; i += 1) { n = await streamsOpen(); if (n === 0) break; await sleep(50); }
  assert.equal(n, 0);
}, { env: { HELLO_READ_LIMIT: '10000' } }));

test('stream: closing a client does not break later hellos or other clients', () => withServer(async (s) => {
  const a = await sseOpen(s);
  const b = await sseOpen(s);
  try {
    await b.waitFor((x) => x.text().includes(': connected'));
    a.close();
    await sleep(100);
    const r = await hello(s, { name: 'After Close' });
    assert.equal(r.status, 200);
    await b.waitFor((x) => x.events().length >= 1);
  } finally { a.close(); b.close(); }
}));

test('stream: SIGTERM ends open streams and the server exits promptly', async () => {
  await withServer(async (s) => {
    const st = await sseOpen(s);
    await st.waitFor((x) => x.text().includes(': connected'));
    const started = Date.now();
    const res = await s.stop();
    assert.ok(Date.now() - started < 4000, 'shutdown took too long');
    assert.equal(res.code, 0);
    await st.waitFor((x) => x.ended(), 3000);
  });
});

test('stream: a heartbeat comment ": hb" arrives with HELLO_STREAM_HEARTBEAT_MS=100', () => withServer(async (s) => {
  await withStream(s, {}, async (st) => {
    await st.waitFor((x) => x.text().includes(': hb\n\n'), 1500);
    assert.ok(st.text().startsWith('retry: 3000\n\n: connected\n\n'));
    assert.equal(st.events().length, 0, 'heartbeats are comments, not hello events');
  });
}, { env: { HELLO_STREAM_HEARTBEAT_MS: '100' } }));
