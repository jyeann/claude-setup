import { describe, expect, it } from 'vitest';
import { isLong, MAX_SLUG_LENGTH, slugify } from '../src/Slug';

describe('slugify', () => {
  it('lower-cases and joins words with single hyphens', () => {
    expect(slugify('Hello World')).toBe('hello-world');
    expect(slugify('a--b__c  d')).toBe('a-b-c-d');
  });

  it('removes accents', () => {
    expect(slugify('Crème Brûlée')).toBe('creme-brulee');
  });

  it('drops hyphens at both ends', () => {
    expect(slugify('  !Hello!  ')).toBe('hello');
    expect(slugify('--a--')).toBe('a');
  });

  it('returns an empty string when nothing alphanumeric is left', () => {
    expect(slugify('!!!')).toBe('');
  });
});

describe('isLong', () => {
  it('is true only above the limit', () => {
    expect(isLong('abc', 3)).toBe(false);
    expect(isLong('abcd', 3)).toBe(true);
  });

  it('defaults to MAX_SLUG_LENGTH', () => {
    expect(MAX_SLUG_LENGTH).toBe(40);
    expect(isLong('a'.repeat(40))).toBe(false);
    expect(isLong('a'.repeat(41))).toBe(true);
  });
});
