'use strict';

// TypeScript: `assert.deepStrictEqual<T>(...)` carries a type argument before the paren, and a literal can wear a cast
// (`assert.ok(true as boolean)`); both must still be seen, or real tests are miscounted and placeholders slip through.
const TYPE_ARGS = String.raw`(?:<[^<>()]*>)?`;
const ASSERTION = new RegExp(String.raw`\bassert(?:\.\w+)?${TYPE_ARGS}\s*\(|\bexpect${TYPE_ARGS}\s*\(`, 'g');
const LITERAL = String.raw`(true|\d+|'[^']*'|"[^"]*")(?:\s+(?:as|satisfies)\s+[\w.]+)?`;
const TAUTOLOGY = new RegExp(String.raw`\bassert(?:\.\w+)?${TYPE_ARGS}\(\s*${LITERAL}\s*(?:,\s*${LITERAL}\s*)?[,)]`, 'g');
// Vitest/Jest: expect(true).toBe(true), expect('a').toBe('a'), expect(1).toBeTruthy()
const EXPECT_TAUTOLOGY = new RegExp(String.raw`\bexpect${TYPE_ARGS}\(\s*(true|\d+|'[^']*'|"[^"]*")\s*\)\s*\.\w+\(\s*(?:\1)?\s*\)`);
const SKIPPED = /\b(?:test|it|describe)\.(?:skip|todo)\b|\bx(?:it|describe)\(|\{\s*(?:skip|todo)\s*:\s*true/;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function hasTautology(text) {
  for (const m of text.matchAll(TAUTOLOGY)) {
    if (m[1] === 'true' && m[2] === undefined) return true;
    if (m[2] !== undefined && m[1] === m[2]) return true;
  }
  return EXPECT_TAUTOLOGY.test(text);
}

function referencesSrc(text, srcDirs, srcAliases = []) {
  if (srcAliases.some((a) => new RegExp(String.raw`['"\`]${escapeRe(a)}`).test(text))) return true;
  return srcDirs.some((dir) => {
    const d = escapeRe(dir);
    return new RegExp(String.raw`(?:^|[^\w])${d}[/\\'"\`]|['"\`]${d}['"\`]`).test(text);
  });
}

// Static checks that catch placeholder tests: they must touch the source, assert something real, and not be skipped.
const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

// srcAliases: import prefixes that point into the source dirs (`@/`, `~/`), for projects that use path aliases.
function analyzeTestFile(rawText, { srcDirs = ['src'], minAssertions = 3, srcAliases = [] } = {}) {
  const text = stripComments(rawText);
  const assertions = (text.match(ASSERTION) ?? []).length;
  const issues = [];
  if (hasTautology(text)) issues.push('contains a tautological assertion (e.g. assert.ok(true), assert.equal(1, 1))');
  if (SKIPPED.test(text)) issues.push('contains skipped or todo tests');
  if (!referencesSrc(text, srcDirs, srcAliases)) issues.push(`never references the source (${srcDirs.join(', ')}); it cannot test it`);
  if (assertions < minAssertions) issues.push(`only ${assertions} assertion(s); at least ${minAssertions} required`);
  return { assertions, issues };
}

module.exports = { analyzeTestFile };
