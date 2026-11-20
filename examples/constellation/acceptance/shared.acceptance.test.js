// The shared client/server modules, imported directly (SC2 labels, SC4 rewriting, SC5 title rules).
// Ported unchanged from the wiki, plus the byte-for-byte copy rule of spec.md "Constraints".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as titles from '../public/js/titles.js';
import * as wikilink from '../public/js/wikilink.js';
import { normalizeTitle, titleKey, validateTitle, TITLE_MESSAGES, MAX_TITLE_LENGTH, MAX_TITLE_BYTES } from '../public/js/titles.js';
import { scanCode, parseWikilinks, rewriteWikilinks } from '../public/js/wikilink.js';

const targets = (text) => parseWikilinks(text).map((l) => l.target);
const bad = (input) => {
  const r = validateTitle(input);
  assert.equal(r.ok, false, JSON.stringify(input));
  return r;
};

// ------------------------------------------------------------ titles.js
test('titles.js exports the agreed names and constants', () => {
  for (const name of ['normalizeTitle', 'titleKey', 'validateTitle']) assert.equal(typeof titles[name], 'function', name);
  assert.equal(MAX_TITLE_LENGTH, 200);
  assert.equal(MAX_TITLE_BYTES, 240);
  assert.equal(typeof TITLE_MESSAGES, 'object');
});

test('titles.js and wikilink.js touch no document, window or Node built-ins at import time', () => {
  const dir = path.resolve(import.meta.dirname, '..', 'public', 'js');
  for (const file of ['titles.js', 'wikilink.js']) {
    const src = fs.readFileSync(path.join(dir, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.doesNotMatch(src, /from\s+['"]node:/, file);
    assert.doesNotMatch(src, /\brequire\s*\(/, file);
    assert.doesNotMatch(src, /\b(document|window|process)\./, file);
    assert.doesNotMatch(src, /\binnerHTML\b|\bouterHTML\b|insertAdjacentHTML|document\.write/, file);
  }
});

test('normalizeTitle applies NFC and trims; titleKey adds lower-casing', () => {
  assert.equal(normalizeTitle('  Cafe\u0301 \n'), 'Caf\u00E9');
  assert.equal(normalizeTitle(42), '42');
  assert.equal(normalizeTitle(null), 'null');
  assert.equal(normalizeTitle('\u00A0x\u00A0'), 'x', 'trim removes no-break spaces too');
  assert.equal(titleKey('  IdEaS '), 'ideas');
  assert.equal(titleKey('CAFE\u0301'), 'caf\u00E9');
  assert.equal(titleKey('\u00C9COLE'), '\u00E9cole');
});

test('validateTitle returns the normalised title when valid and {ok:false, code, message} otherwise', () => {
  assert.deepEqual(validateTitle('  Cafe\u0301 '), { ok: true, title: 'Caf\u00E9' });
  for (const t of ['Ideas', 'a.b', 'v1.2 notes', '\u65E5\u672C\u8A9E', 'COM0', 'LPT0', 'CONSOLE', 'a.con', 'x y (z) & !', 'a'.repeat(200), '\u20AC'.repeat(80), '\u{1F600}'.repeat(60)]) {
    assert.equal(validateTitle(t).ok, true, t.slice(0, 10));
    assert.equal(validateTitle(t).title, t.normalize('NFC'));
  }
  const r = bad('a/b');
  assert.equal(r.code, 'title_separator');
  assert.equal(typeof r.message, 'string');
});

test('validateTitle treats non-string input as empty', () => {
  for (const v of [undefined, null, 42, {}, [], true, Symbol.iterator]) {
    const r = bad(v);
    assert.equal(r.code, 'title_empty');
    assert.equal(r.message, 'Give the note a title.');
  }
});

test('TITLE_MESSAGES is frozen and holds every code plus title_exists with placeholders', () => {
  assert.equal(Object.isFrozen(TITLE_MESSAGES), true);
  assert.deepEqual({ ...TITLE_MESSAGES }, {
    title_empty: 'Give the note a title.',
    title_too_long: 'Keep the title to 200 characters or fewer. It is {n} now.',
    title_too_long_bytes: 'This title is too long for a file name. Shorten it.',
    title_control: 'A title cannot contain control characters.',
    title_separator: 'A title cannot contain / or \\.',
    title_dotdot: 'A title cannot contain "..".',
    title_leading_dot: 'A title cannot start with a dot.',
    title_char: 'A title cannot contain : * ? " < > | [ ] or #.',
    title_trailing_dot: 'A title cannot end with a dot.',
    title_reserved: '"{name}" is a reserved name. Choose another title.',
    title_exists: 'A note called "{existing}" already exists. Choose another title.',
  });
  assert.throws(() => { TITLE_MESSAGES.title_empty = 'changed'; });
});

test('validateTitle messages: counts are in code points, names are as typed', () => {
  const long = bad('a'.repeat(250));
  assert.equal(long.code, 'title_too_long');
  assert.equal(long.message, 'Keep the title to 200 characters or fewer. It is 250 now.');
  const emoji = bad('\u{1F600}'.repeat(201));
  assert.equal(emoji.code, 'title_too_long');
  assert.equal(emoji.message, 'Keep the title to 200 characters or fewer. It is 201 now.');
  assert.equal(bad('\u00E9'.repeat(121)).code, 'title_too_long_bytes');
  assert.equal(bad('\u{1F600}'.repeat(61)).code, 'title_too_long_bytes');
  assert.equal(bad('Lpt3.backup').message, '"Lpt3" is a reserved name. Choose another title.');
  assert.equal(bad('  nUl  ').message, '"nUl" is a reserved name. Choose another title.');
  assert.equal(bad('a\\b').message, 'A title cannot contain / or \\.');
});

test('validateTitle normalises before counting: 120 decomposed e-acute is 120 characters and 240 bytes', () => {
  assert.equal(validateTitle('e\u0301'.repeat(120)).ok, true);
  assert.equal(validateTitle('e\u0301'.repeat(121)).code, 'title_too_long_bytes');
  assert.equal(validateTitle('e\u0301'.repeat(201)).code, 'title_too_long');
});

test('validateTitle reports the first failing rule in the documented order', () => {
  const cases = [
    ['a'.repeat(201) + '/', 'title_too_long'],
    ['\u20AC'.repeat(81) + '\u0001', 'title_too_long_bytes'],
    ['a\u0001/..', 'title_control'],
    ['\u007f.', 'title_control'],
    ['../x', 'title_separator'],
    ['.\\x', 'title_separator'],
    ['..:', 'title_dotdot'],
    ['..', 'title_dotdot'],
    ['.x:.', 'title_leading_dot'],
    ['a:b.', 'title_char'],
    ['con?', 'title_char'],
    ['CON.', 'title_trailing_dot'],
    ['PRN', 'title_reserved'],
  ];
  for (const [input, code] of cases) assert.equal(bad(input).code, code, JSON.stringify(input));
  for (const c of ':*?"<>|[]#') assert.equal(bad(`a${c}b`).code, 'title_char', c);
  for (const c of ['\u0000', '\u001f', '\u0080', '\u009f', '\u2028', '\u2029']) assert.equal(bad(`a${c}b`).code, 'title_control');
  for (const n of ['COM1', 'com9', 'LPT1', 'lpt9', 'AUX', 'NUL', 'CON', 'PRN']) assert.equal(bad(n).code, 'title_reserved', n);
});

// ------------------------------------------------------------ wikilink.js: scanCode
test('wikilink.js exports scanCode, parseWikilinks and rewriteWikilinks', () => {
  for (const name of ['scanCode', 'parseWikilinks', 'rewriteWikilinks']) assert.equal(typeof wikilink[name], 'function', name);
});

test('scanCode finds nothing in plain text and returns half-open UTF-16 ranges for inline code', () => {
  assert.deepEqual(scanCode(''), []);
  assert.deepEqual(scanCode('plain [[A]] text'), []);
  assert.deepEqual(scanCode('a `x` b'), [{ start: 2, end: 5 }]);
  assert.deepEqual(scanCode('\u{1F600} `x`'), [{ start: 3, end: 6 }]);
  assert.deepEqual(scanCode('a `x` b `y`'), [{ start: 2, end: 5 }, { start: 8, end: 11 }]);
});

test('scanCode closes an inline run only with a run of exactly the same length on the same line', () => {
  const t1 = 'a ``x ` y`` b';
  const r1 = scanCode(t1);
  assert.equal(r1.length, 1);
  assert.equal(t1.slice(r1[0].start, r1[0].end), '``x ` y``');
  const t2 = '`a``b`';
  assert.deepEqual(scanCode(t2), [{ start: 0, end: 6 }]);
  const t3 = '``a` b``';
  assert.deepEqual(scanCode(t3), [{ start: 0, end: 8 }]);
  assert.deepEqual(scanCode('a ` b'), [], 'no closing run: backticks are literal');
  assert.deepEqual(scanCode('`a\nb`'), [], 'the closing run must be on the same line');
  assert.deepEqual(scanCode('``a` b'), []);
});

test('scanCode treats fenced blocks as one range from the opening line to the closing fence line', () => {
  const text = 'a\n```js\ncode [[A]]\n```\nb [[B]]';
  const r = scanCode(text);
  assert.equal(r.length, 1);
  assert.equal(r[0].start, 2);
  assert.equal(text.slice(r[0].start, r[0].end).replace(/\n$/, ''), '```js\ncode [[A]]\n```');
  assert.ok(r[0].end <= text.indexOf('b [['));
  assert.equal(scanCode('```\n`x`\n```').length, 1, 'inline code inside a fence is not a second range');
});

test('scanCode fences: same character, at least the same count, only whitespace after the closing run', () => {
  assert.deepEqual(targets('~~~\n[[A]]\n~~~\n[[B]]'), ['B']);
  assert.deepEqual(targets('```\n[[A]]\n~~~\n[[B]]\n```\n[[C]]'), ['C'], 'a tilde line does not close a backtick fence');
  assert.deepEqual(targets('````\n[[A]]\n```\n[[B]]\n````\n[[C]]'), ['C'], 'a shorter run does not close');
  assert.deepEqual(targets('```\n[[A]]\n`````\n[[B]]'), ['B'], 'a longer run closes');
  assert.deepEqual(targets('```\n[[A]]\n``` x\n[[B]]\n```\n[[C]]'), ['C'], 'text after the run keeps the fence open');
  assert.deepEqual(targets('```\n[[A]]\n```   \n[[B]]'), ['B'], 'trailing whitespace is fine');
  assert.deepEqual(targets('   ```\n[[A]]\n   ```\n[[B]]'), ['B'], '0-3 spaces of indent still fence');
});

test('scanCode: an unclosed fence runs to the end, and indented code blocks are not code', () => {
  const text = 'x [[X]]\n```\n[[A]]\nmore [[B]]';
  const r = scanCode(text);
  assert.equal(r.length, 1);
  assert.equal(r[0].end, text.length);
  assert.deepEqual(targets(text), ['X']);
  assert.deepEqual(targets('    [[A]]\n\n    ```\n[[B]]'), ['A', 'B']);
  assert.deepEqual(scanCode('    code line'), []);
});

test('scanCode returns sorted, non-overlapping, non-empty ranges for a mixed document', () => {
  const text = 'a `x` b\n```\nfence `y`\n```\nc ``d`e`` f `g`\n~~~\nopen';
  const r = scanCode(text);
  assert.ok(r.length >= 4);
  let prev = 0;
  for (const { start, end } of r) {
    assert.ok(start >= prev && end > start && end <= text.length, `${start},${end}`);
    prev = end;
  }
});

// ------------------------------------------------------------ wikilink.js: parseWikilinks
test('parseWikilinks gives target, label (null, "" or text), offsets and the source line', () => {
  const text = '[[A]] [[B|label]] [[C|]] [[ D | x y ]] [[E|   ]]';
  const links = parseWikilinks(text);
  assert.deepEqual(links.map((l) => l.target), ['A', 'B', 'C', 'D', 'E']);
  assert.deepEqual(links.map((l) => l.label), [null, 'label', '', 'x y', '']);
  assert.deepEqual(links.map((l) => text.slice(l.start, l.end)), ['[[A]]', '[[B|label]]', '[[C|]]', '[[ D | x y ]]', '[[E|   ]]']);
  for (const l of links) assert.equal(l.line, text);
});

test('parseWikilinks normalises targets, drops empty ones and keeps invalid ones', () => {
  assert.deepEqual(targets('[[Cafe\u0301]]'), ['Caf\u00E9']);
  assert.deepEqual(targets('[[   ]] [[|x]] [[]] [[A]]'), ['A']);
  assert.deepEqual(targets('[[../x]] [[a/b]] [[a:b]]'), ['../x', 'a/b', 'a:b']);
  assert.equal(parseWikilinks('[[A|B|C]]')[0].label, 'B|C');
  assert.equal(parseWikilinks('[[A|  x y  ]]')[0].label, 'x y');
});

test('parseWikilinks matches per line only and handles nested brackets', () => {
  assert.deepEqual(targets('[[A\nB]]'), []);
  assert.deepEqual(targets('[[A]]\n[[B]]'), ['A', 'B']);
  const nested = parseWikilinks('[[[A]]]');
  assert.deepEqual(nested.map((l) => [l.target, l.start, l.end]), [['A', 1, 6]]);
  assert.deepEqual(targets('[A] [[B] [[C]'), []);
});

test('parseWikilinks skips links in inline and fenced code but not in indented text', () => {
  assert.deepEqual(targets('`[[A]]` [[B]] ``[[C]]``\n```\n[[D]]\n```\n[[E]]'), ['B', 'E']);
  assert.deepEqual(targets('a ` [[A]]'), ['A'], 'an unclosed backtick is literal');
});

test('parseWikilinks line is the trimmed source line cut to 160 code points', () => {
  assert.equal(parseWikilinks('first\n   [[A]] tail  \r\nlast')[0].line, '[[A]] tail');
  assert.equal(parseWikilinks(`[[A]] ${'x'.repeat(300)}`)[0].line, `[[A]] ${'x'.repeat(154)}`);
  const emoji = parseWikilinks(`[[A]]${'\u{1F600}'.repeat(200)}`)[0].line;
  assert.equal([...emoji].length, 160);
  assert.equal(emoji, `[[A]]${'\u{1F600}'.repeat(155)}`);
  const two = parseWikilinks('see [[A]] and [[B]]');
  assert.equal(two[0].line, two[1].line);
});

// ------------------------------------------------------------ wikilink.js: rewriteWikilinks
test('rewriteWikilinks rewrites every case variant, keeps labels untrimmed, and counts', () => {
  const input = 'See [[Ideas]] [[ideas]] [[ IDEAS ]] [[Ideas|my ideas]] [[ Ideas | x y ]] [[Ideas|]] [[Ideas|a|b]] [[Other]]';
  const out = rewriteWikilinks(input, 'ideas', 'Thoughts');
  assert.equal(out.text, 'See [[Thoughts]] [[Thoughts]] [[Thoughts]] [[Thoughts|my ideas]] [[Thoughts| x y ]] [[Thoughts|]] [[Thoughts|a|b]] [[Other]]');
  assert.equal(out.count, 7);
});

test('rewriteWikilinks never touches code and keeps all other bytes identical', () => {
  const input = 'a\r\n`[[Ideas]]` ``[[Ideas]]`` [[Ideas]]\r\n```\r\n[[Ideas]]\r\n```\r\n~~~\n[[Ideas]]\n~~~\n\ttab  [[Ideas]]  \u{1F600}\n```\n[[Ideas]] unclosed';
  const out = rewriteWikilinks(input, 'ideas', 'New');
  assert.equal(out.count, 2);
  assert.equal(out.text, input.replace('``[[Ideas]]`` [[Ideas]]', '``[[Ideas]]`` [[New]]').replace('\ttab  [[Ideas]]', '\ttab  [[New]]'));
});

test('rewriteWikilinks returns the text unchanged with count 0 when nothing matches, and skips invalid targets', () => {
  const t = 'x [[Other]] [[../x]] `[[Ideas]]` y';
  assert.deepEqual(rewriteWikilinks(t, 'ideas', 'New'), { text: t, count: 0 });
  assert.deepEqual(rewriteWikilinks('[[../x]] [[a:b]]', '../x', 'New'), { text: '[[../x]] [[a:b]]', count: 0 });
  assert.deepEqual(rewriteWikilinks('[[a:b]]', 'a:b', 'New'), { text: '[[a:b]]', count: 0 });
});

test('rewriteWikilinks matches normalised targets and inserts the new title literally', () => {
  assert.deepEqual(rewriteWikilinks('[[Cafe\u0301]] [[CAF\u00C9|x]]', 'caf\u00E9', 'Na\u00EFve'), { text: '[[Na\u00EFve]] [[Na\u00EFve|x]]', count: 2 });
  assert.equal(rewriteWikilinks('[[A]] [[a|b]]', 'a', 'Cost $& $1 $$ $`').text, '[[Cost $& $1 $$ $`]] [[Cost $& $1 $$ $`|b]]');
});

// ------------------------------------------------------------ copy rule (spec.md Constraints)
test('the shared and core modules are byte-for-byte copies of the wiki files', (t) => {
  const here = path.resolve(import.meta.dirname, '..');
  const wiki = path.resolve(here, '..', 'wiki');
  if (!fs.existsSync(path.join(wiki, 'src', 'index.js'))) { t.skip('examples/wiki is not next to this app'); return; }
  const files = ['public/js/titles.js', 'public/js/wikilink.js', 'src/search.js', 'src/revision.js', 'src/errors.js', 'src/index.js'];
  for (const f of files) {
    assert.deepEqual(fs.readFileSync(path.join(here, f)), fs.readFileSync(path.join(wiki, f)), `${f} differs from the wiki copy`);
  }
});
