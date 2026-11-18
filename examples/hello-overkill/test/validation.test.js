'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateName, validateHelloBody, validateVerifyBody, validateVote, isPersonalised, normalizeName } = require('../src/validation');

test('accepts a valid name with defaults and with language/tone', () => {
  assert.equal(validateHelloBody({ name: 'Ada' }), null);
  assert.equal(validateHelloBody({ name: 'José', language: 'ja', tone: 'pirate' }), null);
  assert.equal(validateHelloBody({ name: 'x'.repeat(40) }), null);
  assert.equal(validateHelloBody({ name: '😀'.repeat(40) }), null);
});

test('rejects bad names with the specified messages', () => {
  assert.equal(validateHelloBody({ name: '' }), 'name is required');
  assert.equal(validateHelloBody({ name: '   ' }), 'name is required');
  assert.equal(validateHelloBody({ name: 5 }), 'name must be a string');
  assert.equal(validateHelloBody({ name: null }), 'name must be a string');
  assert.equal(validateHelloBody({ name: 'x'.repeat(41) }), 'name too long (max 40)');
  assert.equal(validateHelloBody({ name: '😀'.repeat(41) }), 'name too long (max 40)');
  assert.equal(validateHelloBody({ name: 'a\nb' }), 'name has invalid characters');
  assert.equal(validateHelloBody({ name: 'a​b' }), 'name has invalid characters');
});

test('rejects unknown language and tone, ignores other keys', () => {
  assert.equal(validateHelloBody({ name: 'A', language: 'xx' }), 'unknown language');
  assert.equal(validateHelloBody({ name: 'A', language: 5 }), 'unknown language');
  assert.equal(validateHelloBody({ name: 'A', tone: 'rude' }), 'unknown tone');
  assert.equal(validateHelloBody({ name: 'A', extra: 1 }), null);
  assert.equal(validateHelloBody(null), 'name is required');
});

test('isPersonalised needs an own name on a plain object', () => {
  assert.equal(isPersonalised({ name: 1 }), true);
  assert.equal(isPersonalised({ language: 'es' }), false);
  assert.equal(isPersonalised([]), false);
  assert.equal(isPersonalised(null), false);
  assert.equal(isPersonalised(JSON.parse('{"__proto__":{"name":"x"}}')), false);
  assert.equal(isPersonalised(Object.create({ name: 'x' })), false);
});

test('normalizeName trims and applies NFC', () => {
  assert.equal(normalizeName('  é '), 'é');
});

test('validateVerifyBody checks text type and length', () => {
  assert.equal(validateVerifyBody({ text: 'x' }), null);
  assert.equal(validateVerifyBody({ text: 'x'.repeat(10000) }), null);
  assert.equal(validateVerifyBody({ text: 'x'.repeat(10001) }), 'too long');
  assert.equal(validateVerifyBody({}), 'text is required');
  assert.equal(validateVerifyBody({ text: 3 }), 'text is required');
  assert.equal(validateVerifyBody(null), 'text is required');
});

test('validateVote accepts only catalogue ids', () => {
  assert.equal(validateVote({ choice: 'es.pirate' }), null);
  assert.equal(validateVote({ choice: 'xx.pirate' }), 'unknown choice');
  assert.equal(validateVote({ choice: '__proto__' }), 'unknown choice');
  assert.equal(validateVote({}), 'choice is required');
  assert.equal(validateVote({ choice: 1 }), 'choice is required');
});

test('validateName: returns null for good names and the v1 messages for bad ones', () => {
  assert.equal(validateName('Ada'), null);
  assert.equal(validateName('  José  '), null);
  assert.equal(validateName('😀'.repeat(40)), null);
  assert.equal(validateName(undefined), 'name is required');
  assert.equal(validateName('   '), 'name is required');
  assert.equal(validateName(''), 'name is required');
  for (const bad of [null, 5, {}, [], true]) assert.equal(validateName(bad), 'name must be a string');
  assert.equal(validateName('x'.repeat(41)), 'name too long (max 40)');
  assert.equal(validateName('a\u0000b'), 'name has invalid characters');
  assert.equal(validateName('a\u200Bb'), 'name has invalid characters');
});

test('validateName agrees with validateHelloBody on the name rules', () => {
  for (const name of ['Ada', '', 'x'.repeat(41), 'a\nb', null, 7, ' ']) {
    assert.equal(validateHelloBody({ name }), validateName(name));
  }
});
