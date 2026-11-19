'use strict';
// Holdout tests: rules stated in the design that a builder could miss. Black-box over HTTP.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const CORE = '{"message":"Hello World! Welcome to the API."}';
const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'hello-holdout-'));

function request(port, method, target, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body));
    const h = { ...headers };
    if (payload !== undefined) { h['content-length'] = Buffer.byteLength(payload); if (!h['content-type']) h['content-type'] = 'application/json'; }
    const req = http.request({ host: '127.0.0.1', port, method, path: target, headers: h, agent: false }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json; try { json = JSON.parse(text); } catch { json = undefined; }
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    req.on('error', reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

async function startServer(env = {}, file = path.join(tmpDir(), 'hello.json')) {
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: ROOT,
    env: { PATH: process.env.PATH, PORT: '0', DATA_FILE: file, HELLO_SIGNING_SECRET: 'test', HELLO_RATE_LIMIT: '100000', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = ''; let err = '';
  child.stderr.on('data', (d) => { err += d; });
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server did not start; stderr: ' + err)), 5000);
    child.stdout.on('data', (d) => {
      out += d;
      const m = /listening on (\d+)/.exec(out);
      if (m) { clearTimeout(timer); resolve(Number(m[1])); }
    });
    child.on('exit', (code) => { clearTimeout(timer); reject(new Error('server exited early ' + code + ': ' + err)); });
  });
  const exited = new Promise((r) => child.once('exit', r));
  return {
    port, file, stderr: () => err,
    call: (method, target, body, headers) => request(port, method, target, body, headers),
    hello: (body) => request(port, 'POST', '/hello', body),
    stop: async () => { if (child.exitCode === null) { child.kill('SIGTERM'); const t = setTimeout(() => child.kill('SIGKILL'), 3000); await exited; clearTimeout(t); } },
  };
}

const withServer = async (fn, env, file) => { const s = await startServer(env, file); try { await fn(s); } finally { await s.stop(); } };

test('names with control or format characters are rejected with name has invalid characters', () => withServer(async (s) => {
  for (const name of ['\u0000', 'Ad\u0000a', 'Ad​a', '‮ada', 'ada\u0007', 'a\u0085b', 'a﻿b']) {
    const r = await s.hello({ name });
    assert.equal(r.status, 400, JSON.stringify(name));
    assert.deepEqual(r.json, { error: 'name has invalid characters' }, JSON.stringify(name));
  }
}));

test('name length counts code points: 40 emoji accepted, 41 rejected', () => withServer(async (s) => {
  const ok = await s.hello({ name: '\u{1F600}'.repeat(40) });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.name, '\u{1F600}'.repeat(40));
  const bad = await s.hello({ name: '\u{1F600}'.repeat(41) });
  assert.equal(bad.status, 400);
  assert.deepEqual(bad.json, { error: 'name too long (max 40)' });
  assert.equal((await s.hello({ name: 'x'.repeat(40) })).status, 200);
  assert.equal((await s.hello({ name: 'x'.repeat(41) })).status, 400);
}));

test('name is trimmed before length check and empty-after-trim is required error', () => withServer(async (s) => {
  const padded = await s.hello({ name: '   ' + 'x'.repeat(40) + '  ' });
  assert.equal(padded.status, 200);
  assert.equal(padded.json.name, 'x'.repeat(40));
  const blank = await s.hello({ name: '   ' });
  assert.equal(blank.status, 400);
  assert.deepEqual(blank.json, { error: 'name is required' });
  const num = await s.hello({ name: 42 });
  assert.equal(num.status, 400);
  assert.deepEqual(num.json, { error: 'name must be a string' });
}));

test('names are NFC-normalised and decomposed and composed forms are the same visitor', () => withServer(async (s) => {
  const first = await s.hello({ name: 'Café' });
  assert.equal(first.status, 200);
  assert.equal(first.json.name, 'Café');
  assert.equal(first.json.visit, 1);
  const second = await s.hello({ name: 'CAFÉ' });
  assert.equal(second.json.visit, 2);
  assert.equal(JSON.parse(second.json.certificate.text).name, 'CAFÉ');
}));

test('visitor identity is case-insensitive, displayName follows the latest spelling, visits increment and same-day streak stays 1', () => withServer(async (s) => {
  const a = await s.hello({ name: 'ada' });
  assert.equal(a.json.visit, 1); assert.equal(a.json.streak, 1);
  const b = await s.hello({ name: 'ADA' });
  assert.equal(b.json.visit, 2); assert.equal(b.json.streak, 1); assert.equal(b.json.name, 'ADA');
  const c = await s.hello({ name: '  Ada ' });
  assert.equal(c.json.visit, 3); assert.equal(c.json.streak, 1); assert.equal(c.json.name, 'Ada');
  const other = await s.hello({ name: 'Grace' });
  assert.equal(other.json.visit, 1);
}));

test('visit counts and displayName survive a restart on the same data file', async () => {
  const file = path.join(tmpDir(), 'hello.json');
  await withServer(async (s) => { await s.hello({ name: 'ada' }); await s.hello({ name: 'ADA' }); }, {}, file);
  await withServer(async (s) => {
    const r = await s.hello({ name: 'Ada' });
    assert.equal(r.json.visit, 3);
    assert.equal(r.json.streak, 1);
  }, {}, file);
});

test('certificate with quotes, backslashes and unicode in the name round-trips as Authentic and via permalink', () => withServer(async (s) => {
  const name = 'Zoë "Q" \\ O\'Neil \u{1F600} <b>';
  const r = await s.hello({ name, language: 'ja', tone: 'shakespearean' });
  assert.equal(r.status, 200);
  const cert = r.json.certificate;
  assert.match(cert.id, /^[a-f0-9]{16}$/);
  assert.match(cert.signature, /^[0-9a-f]{64}$/);
  assert.match(cert.date, /^\d{4}-\d{2}-\d{2}$/);
  const parsed = JSON.parse(cert.text);
  assert.deepEqual(Object.keys(parsed), ['id', 'name', 'greeting', 'date', 'signature']);
  assert.equal(parsed.name, name);
  const v = await s.call('POST', '/api/verify', { text: cert.text });
  assert.equal(v.status, 200);
  assert.deepEqual(v.json, { verdict: 'Authentic' });
  const perma = await s.call('GET', '/api/certificates/' + cert.id);
  assert.equal(perma.status, 200);
  assert.equal(perma.json.text, cert.text);
  assert.equal(perma.json.name, name);
  assert.equal(perma.json.signature, cert.signature);
}));

test('whitespace added outside the certificate JSON is Forged (any edit is Forged)', () => withServer(async (s) => {
  const r = await s.hello({ name: 'Ada' });
  const text = r.json.certificate.text;
  for (const wrapped of [' \n' + text + '\t\r\n', '\n\n' + text, text + '   ']) {
    const v = await s.call('POST', '/api/verify', { text: wrapped });
    assert.deepEqual(v.json, { verdict: 'Forged', reason: 'mismatch' }, JSON.stringify(wrapped.slice(0, 6)));
  }
}));

test('truncated or garbage certificate text is Forged/unreadable and an edited character is Forged/mismatch', () => withServer(async (s) => {
  const r = await s.hello({ name: 'Ada' });
  const text = r.json.certificate.text;
  for (const bad of [text.slice(0, -5), text.slice(0, 10), '', 'not json', '[]', 'null', '{}', '"' + text + '"']) {
    const v = await s.call('POST', '/api/verify', { text: bad });
    assert.equal(v.status, 200, JSON.stringify(bad.slice(0, 12)));
    assert.deepEqual(v.json, { verdict: 'Forged', reason: 'unreadable' }, JSON.stringify(bad.slice(0, 12)));
  }
  const edited = text.replace('"name":"Ada"', '"name":"Adb"');
  assert.notEqual(edited, text);
  assert.deepEqual((await s.call('POST', '/api/verify', { text: edited })).json, { verdict: 'Forged', reason: 'mismatch' });
  const sig = r.json.certificate.signature;
  const flipped = text.replace(sig, sig.slice(0, -1) + (sig.endsWith('0') ? '1' : '0'));
  assert.deepEqual((await s.call('POST', '/api/verify', { text: flipped })).json, { verdict: 'Forged', reason: 'mismatch' });
}));

test('certificate signed with another secret reads as Forged mismatch', async () => {
  let text;
  await withServer(async (s) => { text = (await s.hello({ name: 'Ada' })).json.certificate.text; }, { HELLO_SIGNING_SECRET: 'other-secret' });
  await withServer(async (s) => {
    assert.deepEqual((await s.call('POST', '/api/verify', { text })).json, { verdict: 'Forged', reason: 'mismatch' });
  });
});

test('verify text of 10000 chars is accepted but 10001 gets 400 too long; missing or non-string text is 400', () => withServer(async (s) => {
  const ok = await s.call('POST', '/api/verify', { text: 'x'.repeat(10000) });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.verdict, 'Forged');
  const big = await s.call('POST', '/api/verify', { text: 'x'.repeat(10001) });
  assert.equal(big.status, 400);
  assert.deepEqual(big.json, { error: 'too long' });
  assert.equal((await s.call('POST', '/api/verify', {})).status, 400);
  assert.equal((await s.call('POST', '/api/verify', { text: 5 })).status, 400);
}));

test('a corrupt DATA_FILE is moved aside to .corrupt-* and the server still starts empty', async () => {
  const dir = tmpDir();
  const file = path.join(dir, 'hello.json');
  fs.writeFileSync(file, '{"version":1,"visitors":[ this is not json');
  await withServer(async (s) => {
    assert.equal((await s.call('GET', '/healthz')).status, 200);
    const r = await s.hello({ name: 'Ada' });
    assert.equal(r.status, 200);
    assert.equal(r.json.visit, 1);
  }, {}, file);
  const aside = fs.readdirSync(dir).filter((f) => f.startsWith('hello.json.corrupt-'));
  assert.equal(aside.length, 1, fs.readdirSync(dir).join(','));
  assert.equal(fs.readFileSync(path.join(dir, aside[0]), 'utf8'), '{"version":1,"visitors":[ this is not json');
});

test('a data file with an unknown version is also moved aside rather than trusted', async () => {
  const dir = tmpDir();
  const file = path.join(dir, 'hello.json');
  fs.writeFileSync(file, JSON.stringify({ version: 99, visitors: [{ key: 'ada', displayName: 'Ada', visits: 50, streak: 9, firstDay: '2020-01-01', lastDay: '2020-01-02' }] }));
  await withServer(async (s) => {
    assert.equal((await s.hello({ name: 'Ada' })).json.visit, 1);
  }, {}, file);
  assert.ok(fs.readdirSync(dir).some((f) => f.startsWith('hello.json.corrupt-')));
});

test('leaderboard is empty at first, omits zero votes, and ties order by id ascending', () => withServer(async (s) => {
  const empty = await s.call('GET', '/api/leaderboard');
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.json, { leaderboard: [] });
  for (const choice of ['es.pirate', 'en.formal', 'de.formal', 'en.formal']) {
    const v = await s.call('POST', '/api/battle/vote', { choice });
    assert.equal(v.status, 200);
    assert.equal(v.json.ok, true);
  }
  const lb = (await s.call('GET', '/api/leaderboard')).json.leaderboard;
  assert.deepEqual(lb.map((r) => [r.id, r.votes]), [['en.formal', 2], ['de.formal', 1], ['es.pirate', 1]]);
  assert.equal(lb[0].rank, 1);
  assert.ok(lb.every((r) => typeof r.greeting === 'string' && r.greeting.length > 0));
  assert.equal((await s.call('POST', '/api/battle/vote', { choice: 'xx.formal' })).status, 400);
  assert.equal((await s.call('POST', '/api/battle/vote', {})).status, 400);
  assert.equal((await s.call('POST', '/api/battle/vote', { choice: '__proto__' })).status, 400);
  assert.equal((await s.call('GET', '/api/leaderboard')).json.leaderboard.length, 3);
}));

test('leaderboard is capped at the top 10', () => withServer(async (s) => {
  const ids = [];
  for (const l of ['en', 'es', 'fr', 'de']) for (const t of ['formal', 'pirate', 'shakespearean']) ids.push(l + '.' + t);
  for (const choice of ids) await s.call('POST', '/api/battle/vote', { choice });
  const lb = (await s.call('GET', '/api/leaderboard')).json.leaderboard;
  assert.equal(lb.length, 10);
  assert.deepEqual(lb.map((r) => r.id), [...ids].sort().slice(0, 10));
}));

test('battle pairs always have distinct ids and distinct greeting texts', () => withServer(async (s) => {
  for (let i = 0; i < 60; i++) {
    const r = await s.call('GET', '/api/battle');
    assert.equal(r.status, 200);
    assert.notEqual(r.json.a.id, r.json.b.id);
    assert.notEqual(r.json.a.greeting, r.json.b.greeting);
  }
}));

test('POST /hello/ with a trailing slash behaves as /hello, and other methods get the core body', () => withServer(async (s) => {
  const r = await s.call('POST', '/hello/', '');
  assert.equal(r.status, 200);
  assert.equal(r.text, CORE);
  const p = await s.call('POST', '/hello/', { name: 'Ada' });
  assert.equal(p.json.name, 'Ada');
  const g = await s.call('GET', '/hello');
  assert.equal(g.status, 200);
  assert.equal(g.text, CORE);
  const g2 = await s.call('PUT', '/hello', { name: 'Ada' });
  assert.equal(g2.text, CORE);
}));

test('core contract: any non-personalised body returns the exact constant', () => withServer(async (s) => {
  for (const body of [undefined, '', 'garbage', '[]', 'null', '{"foo":1}', '{"language":"es"}', '{"language":"es","tone":"pirate"}']) {
    const r = await s.call('POST', '/hello', body, { 'content-type': 'text/plain' });
    assert.equal(r.status, 200, String(body));
    assert.equal(r.text, CORE, String(body));
    assert.match(r.headers['content-type'], /^application\/json/);
  }
}));

test('a target starting with // is 404 JSON and unknown paths are 404 not found', () => withServer(async (s) => {
  for (const target of ['//x', '//hello', '//healthz']) {
    const r = await s.call('GET', target);
    assert.equal(r.status, 404, target);
    assert.deepEqual(r.json, { error: 'not found' }, target);
  }
  const u = await s.call('GET', '/nope');
  assert.equal(u.status, 404);
  assert.deepEqual(u.json, { error: 'not found' });
}));

test('invalid HELLO_RATE_LIMIT falls back to 10: the 11th hello is 429 with retry-after', async () => {
  for (const bad of ['abc', '0', '-5', '100001', '3.5']) {
    await withServer(async (s) => {
      for (let i = 1; i <= 10; i++) assert.equal((await s.call('POST', '/hello', '')).status, 200, bad + ' #' + i);
      const r = await s.call('POST', '/hello', '');
      assert.equal(r.status, 429, bad);
      assert.ok(Number(r.headers['retry-after']) >= 1);
      assert.equal(r.json.error, "You've been greeted enough.");
      assert.ok(Number.isInteger(r.json.retryAfter) && r.json.retryAfter >= 1);
      assert.match(s.stderr(), /invalid HELLO_RATE_LIMIT, using 10/, bad);
    }, { HELLO_RATE_LIMIT: bad });
  }
});

test('the rate limiter ignores X-Forwarded-For and applies to every method on /hello', () => withServer(async (s) => {
  for (let i = 0; i < 5; i++) assert.equal((await s.call('POST', '/hello', '', { 'x-forwarded-for': '10.0.0.' + i })).status, 200);
  for (let i = 5; i < 10; i++) assert.equal((await s.call('GET', '/hello', undefined, { 'x-forwarded-for': '10.0.0.' + i })).status, 200);
  const r = await s.call('POST', '/hello', '', { 'x-forwarded-for': '203.0.113.99' });
  assert.equal(r.status, 429);
  const g = await s.call('GET', '/hello', undefined, { 'x-forwarded-for': '198.51.100.7' });
  assert.equal(g.status, 429);
  assert.equal((await s.call('GET', '/healthz')).status, 200);
}, { HELLO_RATE_LIMIT: '10' }));

test('error responses never contain stack traces or file paths', () => withServer(async (s) => {
  const responses = [
    await s.call('GET', '/nope'),
    await s.call('GET', '//x'),
    await s.call('DELETE', '/healthz'),
    await s.call('POST', '/api/verify', '{bad json'),
    await s.call('POST', '/api/verify', { text: 'x'.repeat(10001) }),
    await s.call('POST', '/api/battle/vote', '{"choice":'),
    await s.call('POST', '/hello', { name: '\u0000' }),
    await s.call('POST', '/hello', 'x'.repeat(20000)),
    await s.call('GET', '/api/certificates/../../etc/passwd'),
    await s.call('GET', '/api/certificates/ZZZZZZZZZZZZZZZZ'),
    await s.call('GET', '/api/certificates/0123456789abcdef'),
  ];
  const statuses = responses.map((r) => r.status);
  assert.ok(statuses.includes(404) && statuses.includes(405) && statuses.includes(413) && statuses.includes(400), statuses.join(','));
  for (const r of responses) {
    assert.doesNotMatch(r.text, /\n\s+at |node:internal|\.js:\d+|node_modules|\/home\/|Error:/, r.text.slice(0, 200));
    assert.ok(r.json && typeof r.json.error === 'string', r.text.slice(0, 200));
  }
  assert.deepEqual((await s.call('GET', '/api/certificates/0123456789abcdef')).json, { error: 'certificate not found' });
}));
