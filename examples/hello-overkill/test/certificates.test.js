'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSigner } = require('../src/certificates');

const fields = { id: '0123456789abcdef', name: 'Ada', greeting: 'Hello Ada', date: '2026-01-02' };
const make = (secret = 's') => {
  const s = createSigner(secret);
  const signature = s.sign(fields);
  return { s, signature, text: s.toText({ ...fields, signature }) };
};

test('sign returns 64 hex and is deterministic per secret', () => {
  const { s, signature } = make();
  assert.match(signature, /^[0-9a-f]{64}$/);
  assert.equal(s.sign(fields), signature);
  assert.notEqual(createSigner('other').sign(fields), signature);
});

test('toText is compact JSON in fixed key order', () => {
  const { text, signature } = make();
  assert.equal(text, JSON.stringify({ id: fields.id, name: 'Ada', greeting: 'Hello Ada', date: '2026-01-02', signature }));
  assert.deepEqual(Object.keys(JSON.parse(text)), ['id', 'name', 'greeting', 'date', 'signature']);
});

test('verifyText accepts its own text', () => {
  const { s, text } = make();
  assert.deepEqual(s.verifyText(text), { verdict: 'Authentic' });
});

test('every single-character edit is Forged', () => {
  const { s, text } = make();
  for (let i = 0; i < text.length; i += 1) {
    const edited = text.slice(0, i) + (text[i] === 'x' ? 'y' : 'x') + text.slice(i + 1);
    assert.equal(s.verifyText(edited).verdict, 'Forged', `index ${i}`);
  }
});

test('different secret gives mismatch', () => {
  const { text } = make('s');
  assert.deepEqual(createSigner('t').verifyText(text), { verdict: 'Forged', reason: 'mismatch' });
});

test('unreadable inputs report unreadable', () => {
  const { s, signature } = make();
  const un = { verdict: 'Forged', reason: 'unreadable' };
  for (const t of ['', 'garbage', '[]', 'null', '5', '{}', JSON.stringify({ ...fields, signature: 'zz' }), JSON.stringify({ ...fields, signature, id: 'XYZ' }), JSON.stringify({ ...fields, signature, date: 'today' }), JSON.stringify({ ...fields, signature, name: 5 })]) {
    assert.deepEqual(s.verifyText(t), un, t);
  }
});

test('extra keys or whitespace are not Authentic', () => {
  const { s, signature, text } = make();
  assert.equal(s.verifyText(`${text} `).verdict, 'Forged');
  assert.equal(s.verifyText(JSON.stringify({ ...fields, signature, extra: 1 })).verdict, 'Forged');
});
