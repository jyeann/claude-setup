'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { withServer, tmpFile, countSyllables, READ_ENV } = require('./helpers-v2');

const H = (s, body) => s.call('POST', '/api/haiku', body);
const THEMES = ['morning', 'ocean', 'city', 'night'];
// Names whose syllable count is unambiguous under the documented heuristic.
const NAMES = ['Ada', 'Bob', 'Linus', 'Tomas', 'Alexander', 'Benjamin', 'Grace', 'Ben', 'Tim', 'Sam', 'Ruth', 'Jordan', 'Marcus', 'Oliver', 'Elizabeth', 'Christopher', 'Rebecca', 'Ada Lovelace', 'Tim Ben', 'Grace Hopper'];

test('haiku: 200 with the documented shape for a simple name', () => withServer(async (s) => {
  const r = await H(s, { name: 'Ada' });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /^application\/json; charset=utf-8$/);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.deepEqual(Object.keys(r.body).sort(), ['haiku', 'limit', 'name', 'nameSyllables', 'syllables', 'theme', 'verified']);
  assert.equal(r.body.name, 'Ada');
  assert.equal(r.body.theme, 'morning');
  assert.deepEqual(r.body.syllables, [5, 7, 5]);
  assert.equal(r.body.verified, true);
  assert.equal(r.body.nameSyllables, 2);
  assert.equal(typeof r.body.limit, 'string');
  assert.ok(r.body.limit.length > 10);
}, READ_ENV()));

test('haiku: every name in the list gives exactly 3 non-empty lines that scan 5-7-5', () => withServer(async (s) => {
  let lines = 0;
  let matching = 0;
  for (const name of NAMES) {
    for (const theme of THEMES) {
      const r = await H(s, { name, theme });
      assert.equal(r.status, 200, `${name}/${theme}: ${r.text}`);
      assert.equal(r.body.haiku.length, 3, `${name}/${theme}`);
      for (const l of r.body.haiku) { assert.equal(typeof l, 'string'); assert.ok(l.trim().length > 0); assert.ok(!l.includes('\n')); }
      assert.deepEqual(r.body.syllables, [5, 7, 5]);
      assert.equal(r.body.verified, true);
      assert.equal(r.body.nameSyllables, countSyllables(name), `nameSyllables ${name}`);
      assert.ok(r.body.haiku.some((l) => l.includes(name)), `${name} appears in the haiku`);
      [5, 7, 5].forEach((want, i) => { lines += 1; if (countSyllables(r.body.haiku[i]) === want) matching += 1; });
    }
  }
  // The heuristic is documented as at least 90% accurate on common English words, so allow a few outliers across 240 lines.
  assert.ok(matching / lines >= 0.9, `only ${matching}/${lines} lines scan 5-7-5 under the documented heuristic`);
}, READ_ENV()));

test('haiku: the name goes on line 1 when it fits in 4 syllables, otherwise on line 2', () => withServer(async (s) => {
  const short = (await H(s, { name: 'Ada' })).body;
  assert.ok(short.haiku[0].includes('Ada'));
  const long = (await H(s, { name: 'Ada Lovelace' })).body;
  assert.equal(long.nameSyllables, 5);
  assert.ok(long.haiku[1].includes('Ada Lovelace'));
  assert.ok(!long.haiku[0].includes('Ada Lovelace'));
}, READ_ENV()));

test('haiku: output is deterministic for (name, theme, syllables)', () => withServer(async (s) => {
  const a = (await H(s, { name: 'Grace', theme: 'ocean' })).body;
  const b = (await H(s, { name: 'Grace', theme: 'ocean' })).body;
  assert.deepEqual(a, b);
}, READ_ENV()));

test('haiku: themes are honoured, default is morning, unknown is 400', () => withServer(async (s) => {
  const seen = new Set();
  for (const theme of THEMES) { const r = await H(s, { name: 'Ada', theme }); assert.equal(r.body.theme, theme); seen.add(r.body.haiku.join('|')); }
  assert.ok(seen.size >= 2, 'themes produce different poems');
  assert.equal((await H(s, { name: 'Ada' })).body.theme, 'morning');
  const bad = await H(s, { name: 'Ada', theme: 'volcano' });
  assert.equal(bad.status, 400);
  assert.deepEqual(bad.body, { error: 'unknown theme' });
}, READ_ENV()));

test('haiku: the syllables override fixes mis-scanned names and changes placement', () => withServer(async (s) => {
  const sio = await H(s, { name: 'Siobhan', syllables: 2 });
  assert.equal(sio.status, 200);
  assert.equal(sio.body.nameSyllables, 2);
  assert.deepEqual(sio.body.syllables, [5, 7, 5]);
  const one = await H(s, { name: 'Ada', syllables: 1 });
  const six = await H(s, { name: 'Ada', syllables: 6 });
  assert.equal(one.body.nameSyllables, 1);
  assert.equal(six.body.nameSyllables, 6);
  assert.ok(one.body.haiku[0].includes('Ada'));
  assert.ok(six.body.haiku[1].includes('Ada'));
  assert.ok(!six.body.haiku[0].includes('Ada'));
  assert.notDeepEqual(one.body.haiku, six.body.haiku);
  assert.equal(six.body.verified, true);
}, READ_ENV()));

test('haiku: names that cannot be scanned are 422 with the documented body', () => withServer(async (s) => {
  const want = { error: 'name cannot be scanned into a haiku', hint: 'try the syllables field or a shorter name' };
  for (const name of ['日本', '!!!', '...', '12345', 'Alexandrovichevsky Konstantinopolitanov']) {
    const r = await H(s, { name });
    assert.equal(r.status, 422, JSON.stringify(name));
    assert.deepEqual(r.body, want, JSON.stringify(name));
  }
}, READ_ENV()));

test('haiku: a name that is too long for the heuristic scans once the override is used', () => withServer(async (s) => {
  const r = await H(s, { name: 'Alexandrovichevsky Konstantinopolitanov', syllables: 6 });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.syllables, [5, 7, 5]);
}, READ_ENV()));

test('haiku: invalid bodies are 400', () => withServer(async (s) => {
  const raws = ['{not json', '', '[]', '"Ada"', 'null', '42'];
  for (const raw of raws) {
    const r = await s.call('POST', '/api/haiku', undefined, raw);
    assert.equal(r.status, 400, JSON.stringify(raw));
    assert.equal(typeof r.body.error, 'string');
  }
}, READ_ENV()));

test('haiku: invalid names are 400', () => withServer(async (s) => {
  const bad = [undefined, null, 42, true, ['Ada'], { a: 1 }, '', '   ', 'a'.repeat(41), 'bad\u0007name', 'zero​width'];
  for (const name of bad) {
    const r = await H(s, name === undefined ? {} : { name });
    assert.equal(r.status, 400, JSON.stringify(name));
    assert.equal(typeof r.body.error, 'string');
  }
  assert.equal((await H(s, { name: 'a'.repeat(40) })).status !== 400, true, '40 characters is allowed by validation');
}, READ_ENV()));

test('haiku: invalid syllables are 400 and valid ones 1-6 are accepted', () => withServer(async (s) => {
  for (const syllables of [0, 7, -1, 2.5, '3', null, [], 'x']) {
    const r = await H(s, { name: 'Ada', syllables });
    assert.equal(r.status, 400, JSON.stringify(syllables));
    assert.deepEqual(r.body, { error: 'syllables must be an integer 1-6' });
  }
  for (const syllables of [1, 2, 3, 4, 5, 6]) assert.equal((await H(s, { name: 'Ada', syllables })).status, 200, String(syllables));
}, READ_ENV()));

test('haiku: bodies over 16 KB are 413', () => withServer(async (s) => {
  const big = JSON.stringify({ name: 'Ada', pad: 'x'.repeat(20000) });
  const r = await s.rawRequest('POST', '/api/haiku', { headers: { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(big)) }, body: big });
  assert.equal(r.status, 413);
  assert.deepEqual(r.body, { error: 'request body too large' });
  assert.equal((await H(s, { name: 'Ada' })).status, 200, 'server still healthy');
}, READ_ENV()));

test('haiku: GET is 405 with allow POST', () => withServer(async (s) => {
  const r = await s.call('GET', '/api/haiku');
  assert.equal(r.status, 405);
  assert.match(r.headers.get('allow'), /POST/);
}, READ_ENV()));

test('haiku: the read limiter answers 429 with Retry-After', () => withServer(async (s) => {
  assert.equal((await H(s, { name: 'Ada' })).status, 200);
  assert.equal((await H(s, { name: 'Ada' })).status, 200);
  const r = await H(s, { name: 'Ada' });
  assert.equal(r.status, 429);
  assert.ok(r.headers.get('retry-after'));
}, { env: { HELLO_READ_LIMIT: '2' } }));

test('haiku: names are not stored and a haiku is not a visit', () => {
  const file = tmpFile();
  return withServer(async (s) => {
    await H(s, { name: 'Private Person' });
    assert.equal(fs.existsSync(file), false);
    assert.equal((await s.call('POST', '/hello', { name: 'Private Person' })).body.visit, 1);
  }, { file, ...READ_ENV() });
});

test('haiku: special characters and emoji inside a name are returned as plain data', () => withServer(async (s) => {
  const r = await H(s, { name: 'Zoë <b>' });
  assert.ok([200, 422].includes(r.status));
  if (r.status === 200) assert.ok(r.body.haiku.join('\n').includes('<b>'), 'echoed as a string, not interpreted');
  assert.equal((await H(s, { name: '😀' })).status, 422);
}, READ_ENV()));
