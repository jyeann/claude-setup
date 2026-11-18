'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { withServer, CORE_BODY, LANGS, TONES, hello } = require('./helpers');

const coreVariants = [
  ['no body', undefined],
  ['empty string body', ''],
  ['non-JSON garbage', 'garbage'],
  ['JSON array', '[]'],
  ['JSON null', 'null'],
  ['object without name', '{"foo":1}'],
  ['object with only language', '{"language":"es"}'],
  ['object with own __proto__ key and no name', '{"__proto__":{"name":"Eve"}}'],
  ['JSON string', '"Ada"'],
];

for (const [label, raw] of coreVariants) {
  test(`POST /hello returns the byte-exact core body for ${label}`, () => withServer(async (s) => {
    const r = await s.call('POST', '/hello', undefined, raw);
    assert.equal(r.status, 200);
    assert.equal(r.text, CORE_BODY);
    assert.match(r.headers.get('content-type'), /^application\/json/);
  }));
}

test('POST /hello core body ignores the request content-type', () => withServer(async (s) => {
  const r = await s.rawRequest('POST', '/hello', { headers: { 'content-type': 'text/plain' }, body: 'hi there' });
  assert.equal(r.status, 200);
  assert.equal(r.text, CORE_BODY);
}));

test('GET, PUT, PATCH and DELETE on /hello return the core body, even with chaos and a trailing slash', () => withServer(async (s) => {
  for (const m of ['GET', 'PUT', 'PATCH', 'DELETE']) {
    for (const url of ['/hello', '/hello/', '/hello?chaos=418']) {
      const r = await s.call(m, url);
      assert.equal(r.status, 200, `${m} ${url}`);
      assert.equal(r.text, CORE_BODY, `${m} ${url}`);
    }
  }
}));

test('personalised response has the documented shape, defaults and a UTC date', () => withServer(async (s) => {
  const before = new Date().toISOString().slice(0, 10);
  const r = await hello(s, { name: 'Ada' });
  const after = new Date().toISOString().slice(0, 10);
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.body).sort(), ['certificate', 'greeting', 'language', 'message', 'name', 'streak', 'tone', 'visit']);
  assert.equal(r.body.message, 'Hello World! Welcome to the API.');
  assert.equal(r.body.name, 'Ada');
  assert.equal(r.body.language, 'en');
  assert.equal(r.body.tone, 'formal');
  assert.equal(typeof r.body.greeting, 'string');
  assert.ok(r.body.greeting.includes('Ada'));
  assert.equal(r.body.visit, 1);
  assert.equal(r.body.streak, 1);
  const c = r.body.certificate;
  assert.deepEqual(Object.keys(c).sort(), ['date', 'id', 'signature', 'text']);
  assert.match(c.id, /^[a-f0-9]{16}$/);
  assert.match(c.signature, /^[a-f0-9]{64}$/);
  assert.match(c.date, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok([before, after].includes(c.date));
  assert.equal(typeof c.text, 'string');
}));

test('personalised name is trimmed, NFC-normalised and extra keys are ignored', () => withServer(async (s) => {
  const r = await hello(s, { name: '  José  ', language: 'fr', tone: 'pirate', extra: { a: 1 }, certificate: 'x' });
  assert.equal(r.status, 200);
  assert.equal(r.body.name, 'José');
  assert.equal(r.body.language, 'fr');
  assert.equal(r.body.tone, 'pirate');
  assert.ok(r.body.greeting.includes('José'));
}));

test('POST /hello rejects invalid names with 400 and the documented messages', () => withServer(async (s) => {
  const cases = [
    [{ name: '' }, 'name is required'],
    [{ name: '   ' }, 'name is required'],
    [{ name: 'x'.repeat(41) }, 'name too long (max 40)'],
    [{ name: '\u{1F600}'.repeat(41) }, 'name too long (max 40)'],
    [{ name: 123 }, 'name must be a string'],
    [{ name: ['Ada'] }, 'name must be a string'],
    [{ name: 'A\u0000b' }, 'name has invalid characters'],
    [{ name: 'A\nB' }, 'name has invalid characters'],
    [{ name: 'A​B' }, 'name has invalid characters'],
  ];
  for (const [body, error] of cases) {
    const r = await hello(s, body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.deepEqual(r.body, { error }, JSON.stringify(body));
  }
}));

test('POST /hello accepts names of exactly 40 code points including emoji', () => withServer(async (s) => {
  assert.equal((await hello(s, { name: 'x'.repeat(40) })).status, 200);
  const r = await hello(s, { name: '\u{1F600}'.repeat(40) });
  assert.equal(r.status, 200);
  assert.equal(Array.from(r.body.name).length, 40);
}));

test('POST /hello rejects unknown language and tone with 400', () => withServer(async (s) => {
  for (const language of ['xx', 'EN', '', 5, null]) {
    const r = await hello(s, { name: 'Ada', language });
    assert.equal(r.status, 400, String(language));
    assert.deepEqual(r.body, { error: 'unknown language' });
  }
  for (const tone of ['zzz', 'Pirate', '', 7, null]) {
    const r = await hello(s, { name: 'Ada', tone });
    assert.equal(r.status, 400, String(tone));
    assert.deepEqual(r.body, { error: 'unknown tone' });
  }
}));

test('a failed validation does not count as a visit', () => withServer(async (s) => {
  await hello(s, { name: 'Ada', language: 'xx' });
  assert.equal((await hello(s, { name: 'Ada' })).body.visit, 1);
}));

test('catalogue lists 10 languages, 4 tones and the defaults', () => withServer(async (s) => {
  const r = await s.call('GET', '/api/catalogue');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.languages.map((l) => l.code), LANGS);
  assert.deepEqual(r.body.languages.map((l) => l.label), ['English', 'Spanish', 'French', 'German', 'Italian', 'Portuguese', 'Dutch', 'Swedish', 'Japanese', 'Swahili']);
  assert.deepEqual(r.body.tones.map((t) => t.code), TONES);
  assert.deepEqual(r.body.tones.map((t) => t.label), ['Formal', 'Pirate', 'Shakespearean', 'Corporate']);
  assert.deepEqual(r.body.defaults, { language: 'en', tone: 'formal' });
}));

test('every catalogue language x tone combination returns a non-empty greeting containing the name', () => withServer(async (s) => {
  const cat = (await s.call('GET', '/api/catalogue')).body;
  let n = 0;
  const seen = new Set();
  for (const l of cat.languages) {
    for (const t of cat.tones) {
      const r = await hello(s, { name: `Ada${n}`, language: l.code, tone: t.code });
      assert.equal(r.status, 200, `${l.code}.${t.code}`);
      assert.equal(r.body.language, l.code);
      assert.equal(r.body.tone, t.code);
      assert.ok(r.body.greeting.trim().length > 0, `${l.code}.${t.code}`);
      assert.ok(r.body.greeting.includes(`Ada${n}`), `${l.code}.${t.code} includes name`);
      seen.add(r.body.greeting.replace(`Ada${n}`, ''));
      n += 1;
    }
  }
  assert.equal(n, 40);
  assert.equal(seen.size, 40, 'all 40 templates are distinct');
}));

test('names like __proto__, constructor and toString are ordinary visitors', () => withServer(async (s) => {
  for (const name of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
    const a = await hello(s, { name });
    assert.equal(a.status, 200, name);
    assert.equal(a.body.name, name);
    assert.equal(a.body.visit, 1, name);
    assert.equal((await hello(s, { name: name.toUpperCase() })).body.visit, 2, name);
  }
  assert.equal((await s.call('POST', '/hello')).text, CORE_BODY);
}));

test('extra body keys named __proto__ do not pollute later responses', () => withServer(async (s) => {
  const r = await s.call('POST', '/hello', undefined, '{"name":"Ada","__proto__":{"language":"es","polluted":true},"constructor":{"prototype":{"tone":"pirate"}}}');
  assert.equal(r.status, 200);
  assert.equal(r.body.language, 'en');
  assert.equal(r.body.tone, 'formal');
  assert.equal(({}).polluted, undefined);
  const again = await hello(s, { name: 'Bob' });
  assert.equal(again.body.language, 'en');
  assert.equal(again.body.tone, 'formal');
}));
