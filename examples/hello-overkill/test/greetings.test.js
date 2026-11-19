'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { LANGUAGES, TONES, CATALOGUE, render, isLanguage, isTone } = require('../src/greetings');

test('exposes 10 languages and 4 tones with code and label', () => {
  assert.deepEqual(LANGUAGES.map((l) => l.code), ['en', 'es', 'fr', 'de', 'it', 'pt', 'nl', 'sv', 'ja', 'sw']);
  assert.equal(LANGUAGES[0].label, 'English');
  assert.equal(LANGUAGES[9].label, 'Swahili');
  assert.deepEqual(TONES.map((t) => t.code), ['formal', 'pirate', 'shakespearean', 'corporate']);
  assert.equal(TONES[2].label, 'Shakespearean');
});

test('catalogue has 40 entries keyed lang.tone', () => {
  assert.equal(CATALOGUE.size, 40);
  assert.equal(CATALOGUE.has('en.formal'), true);
  assert.equal(CATALOGUE.has('sw.corporate'), true);
  assert.equal(CATALOGUE.has('en.rude'), false);
});

test('every rendering includes the name and all 40 are distinct without it', () => {
  const seen = new Set();
  for (const l of LANGUAGES) for (const t of TONES) {
    const g = render(l.code, t.code, 'Ada');
    assert.ok(g.includes('Ada'), `${l.code}.${t.code}`);
    seen.add(g.replace('Ada', ''));
  }
  assert.equal(seen.size, 40);
});

test('render inserts the name verbatim including $ patterns and returns null for unknown ids', () => {
  assert.ok(render('en', 'formal', "$& $1 $'").includes("$& $1 $'"));
  assert.equal(render('xx', 'formal', 'A'), null);
  assert.equal(render('en', 'nope', 'A'), null);
  assert.equal(render('__proto__', 'formal', 'A'), null);
});

test('isLanguage and isTone are strict', () => {
  assert.equal(isLanguage('ja'), true);
  assert.equal(isLanguage('JA'), false);
  assert.equal(isLanguage(undefined), false);
  assert.equal(isTone('pirate'), true);
  assert.equal(isTone('toString'), false);
});

test('render returns null for unknown language or tone, including prototype keys', () => {
  assert.equal(render('xx', 'formal', 'Ada'), null);
  assert.equal(render('en', 'nope', 'Ada'), null);
  assert.equal(render('__proto__', 'formal', 'Ada'), null);
  assert.equal(render('en', '__proto__', 'Ada'), null);
  assert.equal(render('constructor', 'toString', 'Ada'), null);
  assert.equal(render(undefined, undefined, 'Ada'), null);
  assert.equal(render('en.formal', 'x', 'Ada'), null);
});

test('render inserts the name literally and exactly once', () => {
  for (const name of ['{name}', '$&', "$'", '$`', '{name}{name}']) {
    const out = render('en', 'formal', name);
    const plain = render('en', 'formal', 'Q');
    assert.equal(out, plain.replace('Q', () => name), name);
    assert.equal(out.split(name).length - 1 >= 1, true);
  }
  const out = render('en', 'formal', '{name}');
  assert.equal(out.split('{name}').length - 1, 1);
});

test('render returns null unless both language and tone are real strings, even when they coerce to a catalogue key', () => {
  const asLang = { toString: () => 'en' };
  const asTone = { toString: () => 'formal' };
  assert.equal(render(asLang, 'formal', 'A'), null);
  assert.equal(render('en', asTone, 'A'), null);
  assert.equal(render(['en'], 'formal', 'A'), null);
  assert.ok(render('en', 'formal', 'A'));
});
