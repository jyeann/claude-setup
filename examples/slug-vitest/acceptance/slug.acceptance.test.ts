import { it, expect } from 'vitest';
import { slugify, isSlug, uniqueSlug } from '../src/slug';

it('slugify lower-cases and joins words with single hyphens', () => {
  expect(slugify('Hello World')).toBe('hello-world');
  expect(slugify('  Many   spaces & symbols!! ')).toBe('many-spaces-symbols');
  expect(slugify('a--b__c')).toBe('a-b-c');
});

it('slugify removes accents', () => {
  expect(slugify('Crème Brûlée')).toBe('creme-brulee');
});

it('slugify returns an empty string when nothing alphanumeric is left', () => {
  expect(slugify('!!!')).toBe('');
  expect(slugify('')).toBe('');
});

it('slugify cuts to maxLength and never ends with a hyphen', () => {
  expect(slugify('hello world', { maxLength: 5 })).toBe('hello');
  expect(slugify('hello world', { maxLength: 6 })).toBe('hello');
  expect(slugify('hello world', { maxLength: 7 })).toBe('hello-w');
  expect(slugify('abc', { maxLength: 3 })).toBe('abc');
});

it('slugify rejects bad input with the documented error types', () => {
  expect(() => slugify(42 as unknown as string)).toThrow(TypeError);
  expect(() => slugify('x', { maxLength: 0 })).toThrow(RangeError);
  expect(() => slugify('x', { maxLength: 1.5 })).toThrow(RangeError);
  expect(() => slugify('x', { maxLength: -3 })).toThrow(RangeError);
});

it('isSlug accepts only canonical slugs', () => {
  expect(isSlug('hello-world-2')).toBe(true);
  expect(isSlug('a')).toBe(true);
  expect(isSlug('')).toBe(false);
  expect(isSlug('Hello')).toBe(false);
  expect(isSlug('-a')).toBe(false);
  expect(isSlug('a-')).toBe(false);
  expect(isSlug('a--b')).toBe(false);
  expect(isSlug('a_b')).toBe(false);
});

it('uniqueSlug appends the first free counter starting at 2', () => {
  expect(uniqueSlug('Hello', new Set())).toBe('hello');
  expect(uniqueSlug('Hello', new Set(['hello']))).toBe('hello-2');
  expect(uniqueSlug('Hello', new Set(['hello', 'hello-2', 'hello-4']))).toBe('hello-3');
});

it('uniqueSlug names an empty slug untitled and still de-duplicates it', () => {
  expect(uniqueSlug('???', new Set())).toBe('untitled');
  expect(uniqueSlug('???', new Set(['untitled']))).toBe('untitled-2');
});
