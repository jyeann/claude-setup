'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { codePointLength, validateName, validateItemText } = require('../src/validation');
const { DomainError } = require('../src/lists');

const fails = (fn, code, status = 400) => {
  assert.throws(fn, (err) => err instanceof DomainError && err.code === code && err.status === status);
};

test('codePointLength counts astral characters as one', () => {
  assert.equal(codePointLength('abc'), 3);
  assert.equal(codePointLength('\u{1F9F3}\u{1F9F3}'), 2);
  assert.equal(codePointLength(''), 0);
});

test('name of 80 code points is accepted, 81 gives name_too_long with the count', () => {
  assert.equal(validateName('n'.repeat(80)), 'n'.repeat(80));
  assert.throws(() => validateName('n'.repeat(81)), (e) => e.code === 'name_too_long' && e.message === 'Trip name is too long (81 characters). The limit is 80.');
});

test('name length counts code points, so 80 emoji pass and 81 emoji fail', () => {
  const emoji = '\u{1F9F3}';
  assert.equal(validateName(emoji.repeat(80)), emoji.repeat(80));
  assert.throws(() => validateName(emoji.repeat(81)), (e) => e.code === 'name_too_long' && /\(81 characters\)/.test(e.message));
});

test('item of 120 code points is accepted, 121 gives item_too_long with the count', () => {
  assert.equal(validateItemText('i'.repeat(120)).length, 120);
  assert.throws(() => validateItemText('i'.repeat(121)), (e) => e.code === 'item_too_long' && e.message === 'Item is too long (121 characters). The limit is 120.');
  const emoji = '\u{1F600}';
  assert.equal(validateItemText(emoji.repeat(120)), emoji.repeat(120));
  fails(() => validateItemText(emoji.repeat(121)), 'item_too_long');
});

test('length is measured after trim', () => {
  assert.equal(validateName(`  ${'n'.repeat(80)}  `), 'n'.repeat(80));
  assert.equal(validateItemText(`\t ${'i'.repeat(120)} \n`), 'i'.repeat(120));
});

test('empty and whitespace-only input give the empty codes and messages', () => {
  assert.throws(() => validateName(''), (e) => e.code === 'name_empty' && e.message === 'Enter a trip name.');
  assert.throws(() => validateName('  \n\t'), (e) => e.code === 'name_empty');
  assert.throws(() => validateItemText('   '), (e) => e.code === 'item_empty' && e.message === 'Enter an item to add.');
});

test('non-string input gives invalid_body', () => {
  for (const v of [undefined, null, 5, true, {}, ['a']]) {
    fails(() => validateName(v), 'invalid_body');
    fails(() => validateItemText(v), 'invalid_body');
  }
});

test('control characters inside the text are refused, at both ends of each range', () => {
  for (const cp of [0x00, 0x01, 0x09, 0x0a, 0x1f, 0x7f, 0x80, 0x9f]) {
    const text = `a${String.fromCodePoint(cp)}b`;
    assert.throws(() => validateName(text), (e) => e.code === 'name_invalid' && e.message === 'Trip name contains characters that are not allowed.', cp.toString(16));
    assert.throws(() => validateItemText(text), (e) => e.code === 'item_invalid' && e.message === 'Item contains characters that are not allowed.', cp.toString(16));
  }
  for (const cp of [0x20, 0x7e, 0xa0, 0xa1]) {
    const text = `a${String.fromCodePoint(cp)}b`;
    assert.equal(validateName(text), text);
  }
});

test('control characters at the edges are trimmed when trim removes them', () => {
  assert.equal(validateItemText('\tPassport\n'), 'Passport');
});

test('check order: too long wins over control characters, empty wins over everything', () => {
  fails(() => validateName(`${'n'.repeat(81)}\u0001`), 'name_too_long');
  fails(() => validateItemText(`${'i'.repeat(121)}\u0001`), 'item_too_long');
});

test('markup and inner whitespace are kept verbatim', () => {
  assert.equal(validateName('  <b>hi</b>  '), '<b>hi</b>');
  assert.equal(validateItemText('two  spaces'), 'two  spaces');
});
