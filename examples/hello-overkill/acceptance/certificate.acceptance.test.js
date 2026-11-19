'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, withServer, tmpFile, hello } = require('./helpers');

const verify = (s, text) => s.call('POST', '/api/verify', { text });

test('certificate text is compact JSON with id, name, greeting, date, signature in that order', () => withServer(async (s) => {
  const r = await hello(s, { name: 'Ada', language: 'es', tone: 'pirate' });
  const c = r.body.certificate;
  const parsed = JSON.parse(c.text);
  assert.deepEqual(Object.keys(parsed), ['id', 'name', 'greeting', 'date', 'signature']);
  assert.equal(c.text, JSON.stringify(parsed), 'compact');
  assert.deepEqual(parsed, { id: c.id, name: 'Ada', greeting: r.body.greeting, date: c.date, signature: c.signature });
}));

test('a freshly issued certificate verifies as Authentic', () => withServer(async (s) => {
  const r = await hello(s, { name: 'Ada' });
  const v = await verify(s, r.body.certificate.text);
  assert.equal(v.status, 200);
  assert.deepEqual(v.body, { verdict: 'Authentic' });
}));

test('certificates with hostile names and unicode still verify as Authentic', () => withServer(async (s) => {
  for (const name of ['<img src=x onerror=alert(1)>', 'Zoë "quoted" \\ back', '\u{1F600}日本', "O'Brien; DROP TABLE x;--"]) {
    const r = await hello(s, { name, language: 'ja', tone: 'shakespearean' });
    assert.equal(r.status, 200, name);
    assert.equal(r.body.name, name);
    assert.deepEqual((await verify(s, r.body.certificate.text)).body, { verdict: 'Authentic' }, name);
  }
}));

test('every single-character edit of a certificate text is Forged', () => withServer(async (s) => {
  const text = (await hello(s, { name: 'Ada', language: 'fr', tone: 'corporate' })).body.certificate.text;
  for (let i = 0; i < text.length; i += 1) {
    const repl = text[i] === 'x' ? 'y' : 'x';
    const edited = text.slice(0, i) + repl + text.slice(i + 1);
    const v = await verify(s, edited);
    assert.equal(v.status, 200, `edit at ${i}`);
    assert.equal(v.body.verdict, 'Forged', `edit at ${i}`);
    assert.ok(['mismatch', 'unreadable'].includes(v.body.reason), `edit at ${i}`);
  }
}));

test('inserting or deleting one character is Forged', () => withServer(async (s) => {
  const text = (await hello(s, { name: 'Ada' })).body.certificate.text;
  const name = text.indexOf('Ada');
  for (const edited of [text.slice(0, name) + 'B' + text.slice(name + 1), text.slice(0, name) + text.slice(name + 1), text.slice(0, name) + 'Z' + text.slice(name), `${text} `, text.slice(0, -1)]) {
    assert.equal((await verify(s, edited)).body.verdict, 'Forged');
  }
}));

test('edited name or date with the same signature is Forged with reason mismatch', () => withServer(async (s) => {
  const c = (await hello(s, { name: 'Ada' })).body.certificate;
  const o = JSON.parse(c.text);
  for (const patch of [{ name: 'Eve' }, { date: '1999-01-01' }, { greeting: 'Hi' }, { id: '0'.repeat(16) }]) {
    const v = await verify(s, JSON.stringify({ ...o, ...patch }));
    assert.deepEqual(v.body, { verdict: 'Forged', reason: 'mismatch' }, JSON.stringify(patch));
  }
}));

test('unreadable text is Forged with reason unreadable', () => withServer(async (s) => {
  for (const text of ['not json', '[]', 'null', '42', '{}', '{"id":1}', '{"id":"x","name":"a","greeting":"b","date":"2020-01-01","signature":"zz"}', JSON.stringify({ id: 'a'.repeat(16), name: 'a', greeting: 'b', date: 'tomorrow', signature: 'a'.repeat(64) })]) {
    const v = await verify(s, text);
    assert.equal(v.status, 200, text);
    assert.deepEqual(v.body, { verdict: 'Forged', reason: 'unreadable' }, text);
  }
}));

test('POST /api/verify rejects missing or non-string text with 400', () => withServer(async (s) => {
  for (const body of [{}, { text: 5 }, { text: null }, { text: ['x'] }]) {
    const r = await s.call('POST', '/api/verify', body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.equal(typeof r.body.error, 'string');
  }
  assert.equal((await s.call('POST', '/api/verify', undefined, 'not json')).status, 400);
  assert.equal((await s.call('POST', '/api/verify')).status, 400);
}));

test('POST /api/verify rejects text over 10000 characters with 400 too long and accepts exactly 10000', () => withServer(async (s) => {
  const long = await verify(s, 'a'.repeat(10001));
  assert.equal(long.status, 400);
  assert.deepEqual(long.body, { error: 'too long' });
  const edge = await verify(s, 'a'.repeat(10000));
  assert.equal(edge.status, 200);
  assert.equal(edge.body.verdict, 'Forged');
}));

test('a certificate signed with a different secret is Forged with reason mismatch', async () => {
  const a = await startServer(tmpFile(), { env: { HELLO_SIGNING_SECRET: 'secret-one' } });
  const b = await startServer(tmpFile(), { env: { HELLO_SIGNING_SECRET: 'secret-two' } });
  try {
    const text = (await hello(a, { name: 'Ada' })).body.certificate.text;
    assert.equal((await verify(a, text)).body.verdict, 'Authentic');
    assert.deepEqual((await verify(b, text)).body, { verdict: 'Forged', reason: 'mismatch' });
  } finally { await a.stop(); await b.stop(); }
});

test('the signing secret never appears in any response', () => withServer(async (s) => {
  const r = await hello(s, { name: 'Ada' });
  const perma = await s.call('GET', `/api/certificates/${r.body.certificate.id}`);
  assert.ok(!r.text.includes('"test"') && !perma.text.includes('"test"'));
  assert.ok(!/secret/i.test(r.text + perma.text));
}, { env: { HELLO_SIGNING_SECRET: 'zq-very-unlikely-secret-9931' } })); // harness:allow-secret

test('GET /api/certificates/:id returns the stored certificate and its text verifies', () => withServer(async (s) => {
  const r = await hello(s, { name: 'Ada', language: 'sw', tone: 'corporate' });
  const c = r.body.certificate;
  const p = await s.call('GET', `/api/certificates/${c.id}`);
  assert.equal(p.status, 200);
  assert.deepEqual(p.body, { id: c.id, name: 'Ada', greeting: r.body.greeting, language: 'sw', date: c.date, signature: c.signature, text: c.text });
  assert.equal((await verify(s, p.body.text)).body.verdict, 'Authentic');
}));

test('GET /api/certificates/:id returns 404 for unknown and malformed ids', () => withServer(async (s) => {
  for (const id of ['0123456789abcdef', 'ABCDEF0123456789', 'short', '0123456789abcdef0', '__proto__', '..%2f..%2fetc', 'zzzzzzzzzzzzzzzz']) {
    const r = await s.call('GET', `/api/certificates/${id}`);
    assert.equal(r.status, 404, id);
    assert.deepEqual(r.body, { error: 'certificate not found' }, id);
  }
}));
