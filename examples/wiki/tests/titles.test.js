import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTitle, titleKey, validateTitle, TITLE_MESSAGES, MAX_TITLE_LENGTH, MAX_TITLE_BYTES } from '../public/js/titles.js';

const code = (input) => {
  const r = validateTitle(input);
  assert.equal(r.ok, false, JSON.stringify(input));
  return r.code;
};

test('normalizeTitle composes to NFC, trims and stringifies', () => {
  assert.equal(normalizeTitle('  Café  '), 'Café');
  assert.equal(normalizeTitle(12), '12');
  assert.equal(normalizeTitle('\n x \t'), 'x');
});

test('titleKey is the lower-cased normalised title', () => {
  assert.equal(titleKey(' ABC '), 'abc');
  assert.equal(titleKey('É'), 'é');
  assert.equal(titleKey('CAFÉ'), titleKey('café'));
});

test('limits are exported', () => {
  assert.equal(MAX_TITLE_LENGTH, 200);
  assert.equal(MAX_TITLE_BYTES, 240);
});

test('validateTitle accepts good titles and returns the normalised one', () => {
  assert.deepEqual(validateTitle(' Hello world '), { ok: true, title: 'Hello world' });
  assert.deepEqual(validateTitle('a'.repeat(200)), { ok: true, title: 'a'.repeat(200) });
  assert.equal(validateTitle('€'.repeat(80)).ok, true);
  assert.equal(validateTitle('€'.repeat(81)).code, 'title_too_long_bytes');
  assert.equal(validateTitle('a'.repeat(201)).code, 'title_too_long');
  for (const ok of ['COM0', 'CONSOLE', 'v1.2', 'a.con', 'x-y_z']) assert.equal(validateTitle(ok).ok, true, ok);
});

test('validateTitle treats non-strings as empty', () => {
  for (const v of [undefined, null, 5, {}, []]) assert.equal(code(v), 'title_empty');
  assert.equal(code('   '), 'title_empty');
});

test('every rule has its own code and message', () => {
  const cases = {
    title_too_long: ['a'.repeat(201), 'Keep the title to 200 characters or fewer. It is 201 now.'],
    title_too_long_bytes: ['é'.repeat(121), TITLE_MESSAGES.title_too_long_bytes],
    title_control: ['a\u0000b', TITLE_MESSAGES.title_control],
    title_separator: ['a/b', TITLE_MESSAGES.title_separator],
    title_dotdot: ['a..b', TITLE_MESSAGES.title_dotdot],
    title_leading_dot: ['.a', TITLE_MESSAGES.title_leading_dot],
    title_char: ['a:b', TITLE_MESSAGES.title_char],
    title_trailing_dot: ['a.', TITLE_MESSAGES.title_trailing_dot],
    title_reserved: ['Aux.txt', '"Aux" is a reserved name. Choose another title.'],
  };
  for (const [c, [input, message]] of Object.entries(cases)) {
    const r = validateTitle(input);
    assert.equal(r.code, c);
    assert.equal(r.message, message);
  }
});

test('the first failing rule wins', () => {
  assert.equal(code('a'.repeat(201) + '/'), 'title_too_long');
  assert.equal(code('€'.repeat(81) + '\u0001'), 'title_too_long_bytes');
  assert.equal(code('\u0001/'), 'title_control');
  assert.equal(code('../x'), 'title_separator');
  assert.equal(code('..:'), 'title_dotdot');
  assert.equal(code('.a:'), 'title_leading_dot');
  assert.equal(code('a:.'), 'title_char');
  assert.equal(code('CON.'), 'title_trailing_dot');
});

test('control characters, forbidden characters and reserved names are all caught', () => {
  for (const c of ['\u0000', '\u001F', '\u007F', '\u0080', '\u009F', ' ', ' ']) assert.equal(code(`a${c}b`), 'title_control');
  for (const c of ':*?"<>|[]#') assert.equal(code(`a${c}b`), 'title_char');
  for (const n of ['con', 'PRN', 'aux', 'NUL', 'com1', 'COM9', 'lpt1', 'LPT9']) assert.equal(code(n), 'title_reserved');
});

test('lengths count code points after normalisation', () => {
  assert.equal(validateTitle('\u{1F600}'.repeat(60)).ok, true);
  assert.equal(code('\u{1F600}'.repeat(61)), 'title_too_long_bytes');
  assert.equal(validateTitle('é'.repeat(120)).ok, true);
});

test('TITLE_MESSAGES is frozen', () => {
  assert.equal(Object.isFrozen(TITLE_MESSAGES), true);
  assert.equal(Object.keys(TITLE_MESSAGES).length, 11);
  assert.match(TITLE_MESSAGES.title_exists, /\{existing\}/);
});

test('validateTitle rejects lone surrogates with title_control and the same message', () => {
  for (const t of ['a\uD800b', '\uDC00', 'x\uDBFF', 'a\uDFFFb', '\uD83D', 'ok \uDE00']) {
    const r = validateTitle(t);
    assert.equal(r.ok, false, JSON.stringify(t));
    assert.equal(r.code, 'title_control', JSON.stringify(t));
    assert.equal(r.message, TITLE_MESSAGES.title_control);
  }
  assert.equal(validateTitle('smile \u{1F600}').ok, true);
  assert.equal(validateTitle('😀😀').ok, true);
});
