'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const v = require('../src/validation');

const code = (fn) => { try { fn(); } catch (e) { return `${e.code}:${e.status}`; } return 'none'; };

test('normalizeTitle trims, collapses whitespace and applies NFC', () => {
  assert.equal(v.normalizeTitle('  Sprint \n\t 12  '), 'Sprint 12');
  assert.equal(v.normalizeTitle('é'), 'é');
  assert.equal(v.normalizeTitle('<b>x</b>'), '<b>x</b>');
});

test('normalizeTitle rejects empty, non-string and control characters', () => {
  for (const bad of ['', '   ', undefined, null, 5, {}]) assert.equal(code(() => v.normalizeTitle(bad)), 'title_empty:400');
  assert.equal(code(() => v.normalizeTitle('a\u0007b')), 'title_invalid:400');
});

test('normalizeTitle counts code points, so 100 emoji pass and 101 fail', () => {
  assert.equal(v.normalizeTitle('\u{1F600}'.repeat(100)).length, 200);
  assert.equal(code(() => v.normalizeTitle('\u{1F600}'.repeat(101))), 'title_too_long:400');
});

test('normalizeText keeps newlines and tabs inside and trims the ends', () => {
  assert.equal(v.normalizeText('  a\n\tb \r\n c  '), 'a\n\tb \n c');
  assert.equal(code(() => v.normalizeText(' \n ')), 'text_empty:400');
  assert.equal(code(() => v.normalizeText(null)), 'text_empty:400');
});

test('normalizeText rejects control characters and more than 500 code points', () => {
  assert.equal(code(() => v.normalizeText('a\u0000b')), 'text_invalid:400');
  assert.equal(code(() => v.normalizeText('a\u0085b')), 'text_invalid:400');
  assert.equal(code(() => v.normalizeText('x'.repeat(500))), 'none');
  assert.equal(code(() => v.normalizeText('x'.repeat(501))), 'text_too_long:400');
  assert.equal(code(() => v.normalizeText('\u{1F600}'.repeat(500))), 'none');
});

test('checkColumn accepts the three keys and rejects everything else', () => {
  for (const c of v.COLUMNS) assert.equal(v.checkColumn(c), c);
  for (const bad of ['', 'Went well', undefined, 3, null]) assert.equal(code(() => v.checkColumn(bad)), 'bad_column:400');
});
