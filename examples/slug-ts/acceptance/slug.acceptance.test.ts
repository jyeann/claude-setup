import test from 'node:test';
import assert from 'node:assert/strict';
import { slugify, isSlug, uniqueSlug } from '../src/slug.ts';

test('slugify lower-cases and joins words with single hyphens', () => {
  assert.equal(slugify('Hello World'), 'hello-world');
  assert.equal(slugify('  Many   spaces & symbols!! '), 'many-spaces-symbols');
  assert.equal(slugify('a--b__c'), 'a-b-c');
});

test('slugify removes accents', () => {
  assert.equal(slugify('Crème Brûlée'), 'creme-brulee');
});

test('slugify returns an empty string when nothing alphanumeric is left', () => {
  assert.equal(slugify('!!!'), '');
  assert.equal(slugify(''), '');
});

test('slugify cuts to maxLength and never ends with a hyphen', () => {
  assert.equal(slugify('hello world', { maxLength: 5 }), 'hello');
  assert.equal(slugify('hello world', { maxLength: 6 }), 'hello');
  assert.equal(slugify('hello world', { maxLength: 7 }), 'hello-w');
  assert.equal(slugify('abc', { maxLength: 3 }), 'abc');
});

test('slugify rejects bad input with the documented error types', () => {
  assert.throws(() => slugify(42 as unknown as string), TypeError);
  assert.throws(() => slugify('x', { maxLength: 0 }), RangeError);
  assert.throws(() => slugify('x', { maxLength: 1.5 }), RangeError);
  assert.throws(() => slugify('x', { maxLength: -3 }), RangeError);
});

test('isSlug accepts only canonical slugs', () => {
  assert.equal(isSlug('hello-world-2'), true);
  assert.equal(isSlug('a'), true);
  assert.equal(isSlug(''), false);
  assert.equal(isSlug('Hello'), false);
  assert.equal(isSlug('-a'), false);
  assert.equal(isSlug('a-'), false);
  assert.equal(isSlug('a--b'), false);
  assert.equal(isSlug('a_b'), false);
});

test('uniqueSlug appends the first free counter starting at 2', () => {
  assert.equal(uniqueSlug('Hello', new Set()), 'hello');
  assert.equal(uniqueSlug('Hello', new Set(['hello'])), 'hello-2');
  assert.equal(uniqueSlug('Hello', new Set(['hello', 'hello-2', 'hello-4'])), 'hello-3');
});

test('uniqueSlug names an empty slug untitled and still de-duplicates it', () => {
  assert.equal(uniqueSlug('???', new Set()), 'untitled');
  assert.equal(uniqueSlug('???', new Set(['untitled'])), 'untitled-2');
});
