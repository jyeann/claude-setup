'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { LIGHT, DARK, PAIRS, luminance, contrast, toCss } = require('../src/page/tokens');

const REQUIRED = ['paper', 'surface', 'sunken', 'ink', 'ink-2', 'line', 'control', 'accent', 'accent-hover', 'accent-ink', 'teal', 'ok', 'bad', 'warn', 'focus', 'wash-morning', 'wash-ocean'];
const HEX = /^#[0-9A-Fa-f]{6}$/;
const THEMES = { light: LIGHT, dark: DARK };

// [fg, bg, minimum ratio] pairs asserted directly, independent of PAIRS.
const TEXT_PAIRS = [
  ['ink', 'paper'], ['ink', 'surface'], ['ink', 'sunken'],
  ['ink-2', 'paper'], ['ink-2', 'surface'], ['ink-2', 'sunken'],
  ['accent-ink', 'accent'], ['accent', 'paper'], ['accent', 'surface'],
  ['teal', 'surface'], ['ok', 'surface'], ['bad', 'surface'], ['warn', 'surface'],
];
const UI_PAIRS = [['control', 'surface'], ['control', 'paper'], ['focus', 'paper']];

test('light and dark themes define the same key set', () => {
  assert.deepEqual(Object.keys(LIGHT).sort(), Object.keys(DARK).sort());
});

test('both themes define every token named in the task interface', () => {
  for (const [name, theme] of Object.entries(THEMES)) {
    assert.deepEqual(REQUIRED.filter((k) => !(k in theme)), [], name);
  }
});

test('every colour token is a #RRGGBB hex string in both themes', () => {
  for (const [name, theme] of Object.entries(THEMES)) {
    for (const k of REQUIRED) assert.match(theme[k], HEX, `${name}.${k}`);
  }
});

test('page background tokens match the values the browser checks expect', () => {
  assert.equal(LIGHT.paper.toUpperCase(), '#F4EEE2');
  assert.equal(DARK.paper.toUpperCase(), '#12161C');
});

test('luminance of black is 0 and of white is 1', () => {
  assert.equal(luminance('#000000'), 0);
  assert.equal(luminance('#FFFFFF'), 1);
});

test('luminance is monotonic from black through grey to white', () => {
  const g = luminance('#808080');
  assert.ok(g > 0 && g < 1);
  assert.ok(luminance('#404040') < g);
  assert.ok(g < luminance('#C0C0C0'));
});

test('contrast of black on white is 21 in either order', () => {
  assert.ok(Math.abs(contrast('#000000', '#FFFFFF') - 21) < 1e-9);
  assert.ok(Math.abs(contrast('#FFFFFF', '#000000') - 21) < 1e-9);
});

test('contrast is symmetric and at least 1 for any pair', () => {
  for (const [a, b] of [['#F4EEE2', '#1C1A17'], ['#B3301B', '#FBF8F1'], ['#123456', '#123456']]) {
    assert.equal(contrast(a, b), contrast(b, a));
    assert.ok(contrast(a, b) >= 1);
  }
  assert.equal(contrast('#123456', '#123456'), 1);
});

test('contrast matches the hand-computed ratios from the spec table', () => {
  const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 0.02, `${actual} vs ${expected}`);
  near(contrast(LIGHT.ink, LIGHT.paper), 15.03);
  near(contrast(DARK.ink, DARK.paper), 14.58);
  near(contrast(LIGHT['accent-ink'], LIGHT.accent), 5.9);
  near(contrast(LIGHT.control, LIGHT.paper), 4.21);
});

test('PAIRS is a non-empty list of [fg, bg, min] triples naming real tokens', () => {
  assert.ok(Array.isArray(PAIRS) && PAIRS.length > 0);
  for (const p of PAIRS) {
    assert.equal(p.length, 3);
    const [fg, bg, min] = p;
    assert.ok(fg in LIGHT && fg in DARK, `fg ${fg}`);
    assert.ok(bg in LIGHT && bg in DARK, `bg ${bg}`);
    assert.equal(typeof min, 'number');
    assert.ok(min >= 3, `min ${min}`);
  }
});

for (const [name, theme] of Object.entries(THEMES)) {
  test(`every PAIRS entry meets its minimum contrast in the ${name} theme`, () => {
    for (const [fg, bg, min] of PAIRS) {
      const ratio = contrast(theme[fg], theme[bg]);
      assert.ok(ratio >= min, `${name}: ${fg} on ${bg} is ${ratio.toFixed(2)}, needs ${min}`);
    }
  });

  test(`text pairs reach 4.5:1 in the ${name} theme`, () => {
    for (const [fg, bg] of TEXT_PAIRS) {
      const ratio = contrast(theme[fg], theme[bg]);
      assert.ok(ratio >= 4.5, `${name}: ${fg} on ${bg} is ${ratio.toFixed(2)}`);
    }
  });

  test(`UI pairs (control borders, focus ring) reach 3:1 in the ${name} theme`, () => {
    for (const [fg, bg] of UI_PAIRS) {
      const ratio = contrast(theme[fg], theme[bg]);
      assert.ok(ratio >= 3, `${name}: ${fg} on ${bg} is ${ratio.toFixed(2)}`);
    }
  });
}

test('toCss emits a custom property declaration for every key', () => {
  for (const theme of [LIGHT, DARK]) {
    const css = toCss(theme);
    assert.equal(typeof css, 'string');
    assert.ok(css.includes('--paper:'));
    for (const k of Object.keys(theme)) {
      assert.ok(css.includes(`--${k}:`), `missing --${k}`);
      assert.ok(css.includes(`--${k}:${theme[k]};`), `value for --${k}`);
    }
  }
});

test('toCss returns an empty string for an empty object', () => {
  assert.equal(toCss({}), '');
});
