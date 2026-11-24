// HELD-OUT test: the agent never sees this file. It checks the spec's rules on inputs the visible tests do not
// use. It imports through the `@/` alias, so it runs from any directory: verify.config.json's holdout command
// points Vitest at "${HARNESS_HIDDEN_DIR:-hidden-tests}".
import { describe, expect, it } from 'vitest';
import { isLong, slugify } from '@/Slug';

describe('hidden: slugify', () => {
  it('keeps digits and collapses mixed separators', () => {
    expect(slugify('Top 10 -- Tips_&_Tricks')).toBe('top-10-tips-tricks');
  });

  it('removes accents from capitals', () => {
    expect(slugify('ÉCOLE Ångström')).toBe('ecole-angstrom');
  });

  it('a slug of exactly the limit is not long', () => {
    expect(isLong(slugify('x'.repeat(40)))).toBe(false);
  });
});
