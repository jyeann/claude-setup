'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHello, CORE_BODY } = require('../src/hello');
const { createStore } = require('../src/store');
const { createSigner } = require('../src/certificates');
const { render } = require('../src/greetings');

const T0 = Date.UTC(2026, 5, 1, 8);
function setup(file) {
  const f = file || path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'h-')), 'd.json');
  const store = createStore(f, () => T0, () => {});
  const signer = createSigner('k');
  let n = 0;
  const randomBytes = () => Buffer.from([0, 0, 0, 0, 0, 0, 0, ++n]);
  return { h: createHello({ store, signer, now: () => T0, randomBytes }), store, signer };
}

test('core contract: anything without an own name returns the exact constant', () => {
  const { h } = setup();
  assert.equal(CORE_BODY, '{"message":"Hello World! Welcome to the API."}');
  for (const b of [undefined, null, '', 'garbage', [], {}, { foo: 1 }, { language: 'es' }]) {
    assert.deepEqual(h.handle(b), { status: 200, text: CORE_BODY });
  }
});

test('personalised response has the specified shape and defaults', () => {
  const { h } = setup();
  const r = h.handle({ name: '  Ada ' });
  assert.equal(r.status, 200);
  const b = JSON.parse(r.text);
  assert.deepEqual(Object.keys(b), ['message', 'greeting', 'name', 'language', 'tone', 'visit', 'streak', 'certificate']);
  assert.equal(b.message, 'Hello World! Welcome to the API.');
  assert.equal(b.name, 'Ada');
  assert.equal(b.greeting, render('en', 'formal', 'Ada'));
  assert.deepEqual([b.language, b.tone, b.visit, b.streak], ['en', 'formal', 1, 1]);
  assert.equal(b.certificate.id, '0000000000000001');
  assert.equal(b.certificate.date, '2026-06-01');
});

test('certificate text verifies and is stored for lookup', () => {
  const { h, store, signer } = setup();
  const b = JSON.parse(h.handle({ name: 'José', language: 'es', tone: 'pirate' }).text);
  assert.deepEqual(signer.verifyText(b.certificate.text), { verdict: 'Authentic' });
  const rec = store.getCertificate(b.certificate.id);
  assert.equal(rec.greeting, b.greeting);
  assert.equal(rec.signature, b.certificate.signature);
  assert.equal(rec.language, 'es');
});

test('repeat visits increment visit count', () => {
  const { h } = setup();
  h.handle({ name: 'Ada' });
  const b = JSON.parse(h.handle({ name: 'ADA' }).text);
  assert.equal(b.visit, 2);
  assert.equal(b.name, 'ADA');
});

test('validation errors return 400 and leave the store untouched', () => {
  const { h, store } = setup();
  assert.deepEqual(h.handle({ name: '' }), { status: 400, text: '{"error":"name is required"}' });
  assert.equal(h.handle({ name: 'A', language: 'zz' }).text, '{"error":"unknown language"}');
  assert.equal(h.handle({ name: 3 }).status, 400);
  assert.deepEqual(store.stats(), { visitors: 0, certificates: 0 });
});

test('persist failure returns 500 could not save', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'h-'));
  fs.writeFileSync(path.join(d, 'f'), 'x');
  const { h, store } = setup(path.join(d, 'f', 'd.json'));
  assert.deepEqual(h.handle({ name: 'Ada' }), { status: 500, text: '{"error":"could not save"}' });
  assert.equal(store.stats().visitors, 0);
});

test('non-persist store errors are not reported as could not save', () => {
  const { createHello } = require('../src/hello');
  const { createSigner } = require('../src/certificates');
  const h = createHello({ store: { recordHello() { throw new TypeError('bug'); } }, signer: createSigner('s') });
  assert.throws(() => h.handle({ name: 'Ada' }), TypeError);
});
