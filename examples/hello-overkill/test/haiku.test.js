'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { countSyllables, lineSyllables, makeHaiku, BANKS } = require('../src/haiku');
const { mulberry32 } = require('../src/weather');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const THEMES = Object.keys(BANKS.themes);

test('BANKS: themes are exactly morning, ocean, city, night', () => {
  assert.deepEqual(THEMES.sort(), ['city', 'morning', 'night', 'ocean']);
});

test('BANKS: every fragment scans as declared and name templates fill their line', () => {
  let seen = 0;
  for (const [n, list] of Object.entries(BANKS.nameLine1)) for (const [c, t] of list) { assert.equal(lineSyllables(t.replace('{name}', '')), c, t); assert.equal(c + Number(n), 5, t); seen += 1; }
  for (const [n, list] of Object.entries(BANKS.nameLine2)) for (const [c, t] of list) { assert.equal(lineSyllables(t.replace('{name}', '')), c, t); assert.equal(c + Number(n), 7, t); seen += 1; }
  for (const th of Object.values(BANKS.themes)) {
    for (const [c, t] of th.five) { assert.equal(lineSyllables(t), 5, t); assert.equal(c, 5); seen += 1; }
    for (const [c, t] of th.seven) { assert.equal(lineSyllables(t), 7, t); assert.equal(c, 7); seen += 1; }
  }
  assert.ok(seen > 60);
  assert.deepEqual(Object.keys(BANKS.nameLine1), ['1', '2', '3', '4']);
  assert.deepEqual(Object.keys(BANKS.nameLine2), ['1', '2', '3', '4', '5', '6']);
});

test('countSyllables: specific rules', () => {
  const t = { table: 2, make: 1, makes: 1, named: 1, wanted: 2, tree: 1, eye: 1, radio: 3, the: 1, fire: 1, every: 2, people: 2, poem: 2, quiet: 2, nation: 2, special: 2, Ada: 2, 'O\'Brien': 2, hello: 2 };
  for (const [w, n] of Object.entries(t)) assert.equal(countSyllables(w), n, w);
});

test('countSyllables: no letters counts 0, any letters count at least 1', () => {
  for (const w of ['', '日本', '!!!', '123', '   ', '😀']) assert.equal(countSyllables(w), 0, JSON.stringify(w));
  for (const w of ['b', 'x', 'mm', 'Mr', 'e']) assert.ok(countSyllables(w) >= 1, w);
});

test('countSyllables: at least 90% on a fixed 200-word list of common English words', () => {
  const list = {
    1: 'fast bright shade glass plate spoon fork knife chair desk plan grass crown brown dream night book hand foot heart cat dog run jump time light dark night day sun moon star tree rain wind snow fire stone road house street town hill sea sand wave gold blue green red white black cold warm soft loud quick slow strong sweet small large fresh clear deep wide thin thick words bread milk bird fish frog horse goat sheep cloud storm mouse'.split(' '),
    2: 'kitchen cousin pocket ticket jacket carpet mirror ladder anchor sister brother mother father doctor teacher student friend music basket window candle button pillow rabbit tiger zebra water morning evening garden window summer winter simple purple yellow orange silver finger flower mountain river sunset market happy little middle table able never over under open often paper person letter monkey pretty city lucky early window follow hello below again about around before behind begin between'.split(' '),
    3: 'banana together tomorrow november chocolate bicycle dinosaur gorilla vanilla spaghetti beautiful family animal tomato banana potato elephant yesterday remember together another umbrella important dangerous wonderful memory history energy library celebrate adventure exercise hospital holiday camera magazine seventeen delicious'.split(' '),
    4: 'information education television dictionary'.split(' '),
    5: 'university vocabulary imagination possibility organization'.split(' '),
  };
  let total = 0; let ok = 0;
  for (const [n, words] of Object.entries(list)) for (const w of words) { total += 1; if (countSyllables(w) === Number(n)) ok += 1; }
  assert.ok(total >= 200, `list size ${total}`);
  assert.ok(ok / total >= 0.9, `accuracy ${ok}/${total}`);
});

test('lineSyllables sums words, splitting on whitespace and hyphens', () => {
  assert.equal(lineSyllables('soft light on the waking street'), 7);
  assert.equal(lineSyllables('  hello   world  '), 3);
  assert.equal(lineSyllables('state-of-the-art'), 4);
  assert.equal(lineSyllables(''), 0);
});

test('makeHaiku shape for a known name', () => {
  const h = makeHaiku({ name: 'Ada', theme: 'morning' });
  assert.equal(h.name, 'Ada');
  assert.equal(h.theme, 'morning');
  assert.equal(h.haiku.length, 3);
  assert.deepEqual(h.syllables, [5, 7, 5]);
  assert.equal(h.verified, true);
  assert.equal(h.nameSyllables, 2);
  assert.ok(h.haiku.some((l) => l.includes('Ada')));
  assert.equal(typeof h.limit, 'string');
});

test('makeHaiku: 500 random valid names give 3 non-empty lines that scan 5-7-5 (injected random)', () => {
  const rnd = mulberry32(2026);
  const vowels = 'aeiou'; const cons = 'bcdfghjklmnprstvz';
  let made = 0;
  for (let i = 0; i < 500; i += 1) {
    let name = '';
    const parts = 1 + Math.floor(rnd() * 3);
    for (let p = 0; p < parts; p += 1) {
      let w = '';
      const syl = 1 + Math.floor(rnd() * 3);
      for (let s = 0; s < syl; s += 1) w += cons[Math.floor(rnd() * cons.length)] + vowels[Math.floor(rnd() * 5)];
      name += (p ? ' ' : '') + w[0].toUpperCase() + w.slice(1);
    }
    const theme = THEMES[i % THEMES.length];
    const h = makeHaiku({ name, theme, random: mulberry32(i) });
    const n = lineSyllables(name);
    if (n > 6) { assert.equal(h, null, name); continue; }
    made += 1;
    assert.equal(h.haiku.length, 3, name);
    for (const line of h.haiku) assert.ok(line.trim().length > 0);
    assert.deepEqual(h.syllables, [5, 7, 5], name);
    assert.equal(h.nameSyllables, n, name);
    assert.ok(h.haiku.join('\n').includes(name), name);
    // line scan: non-name lines by the heuristic, whole haiku by the same heuristic when no override is used
    assert.deepEqual(h.haiku.map(lineSyllables), [5, 7, 5], name);
    assert.equal(h.verified, true);
  }
  assert.ok(made > 400, `only ${made} scannable`);
});

test('makeHaiku scans 5-7-5 for names of every length 1..6 syllables via the override', () => {
  for (let n = 1; n <= 6; n += 1) {
    const h = makeHaiku({ name: 'Zed', syllables: n });
    assert.equal(h.nameSyllables, n);
    assert.deepEqual(h.syllables, [5, 7, 5]);
    assert.equal(h.haiku.filter((l) => l.includes('Zed')).length, 1);
  }
});

test('makeHaiku: override moves the name between lines 1 and 2', () => {
  assert.ok(makeHaiku({ name: 'Zed', syllables: 4 }).haiku[0].includes('Zed'));
  assert.ok(makeHaiku({ name: 'Zed', syllables: 5 }).haiku[1].includes('Zed'));
  assert.ok(!makeHaiku({ name: 'Zed', syllables: 5 }).haiku[0].includes('Zed'));
  const a = makeHaiku({ name: 'Siobhan' }); const b = makeHaiku({ name: 'Siobhan', syllables: 3 });
  assert.equal(a.nameSyllables, 2);
  assert.equal(b.nameSyllables, 3);
  assert.notDeepEqual(a.haiku, b.haiku);
});

test('makeHaiku is deterministic for a given (name, theme, syllables)', () => {
  for (const theme of THEMES) {
    assert.deepEqual(makeHaiku({ name: 'Grace', theme }), makeHaiku({ name: 'Grace', theme }));
  }
  assert.deepEqual(makeHaiku({ name: 'Ada', syllables: 3 }), makeHaiku({ name: 'Ada', syllables: 3 }));
  assert.deepEqual(makeHaiku({ name: 'Ada', seed: 5 }), makeHaiku({ name: 'Ada', seed: 5 }));
});

test('makeHaiku: injected random selects fragments; extremes 0 and 0.999 differ and both scan', () => {
  const lo = makeHaiku({ name: 'Ada', random: () => 0 });
  const hi = makeHaiku({ name: 'Ada', random: () => 0.999999 });
  assert.notDeepEqual(lo.haiku, hi.haiku);
  assert.deepEqual(lo.syllables, [5, 7, 5]);
  assert.deepEqual(hi.syllables, [5, 7, 5]);
  assert.equal(makeHaiku({ name: 'Ada', random: () => 1 }).verified, true);
});

test('makeHaiku defaults the theme to morning and rejects unknown themes', () => {
  assert.equal(makeHaiku({ name: 'Ada' }).theme, 'morning');
  for (const bad of ['nope', '__proto__', 'constructor', 5, null]) assert.throws(() => makeHaiku({ name: 'Ada', theme: bad }), TypeError, String(bad));
});

test('makeHaiku is unscannable (null) for no-letter names, over-long names and out-of-range overrides', () => {
  assert.equal(makeHaiku({ name: '日本' }), null);
  assert.equal(makeHaiku({ name: '!!!' }), null);
  assert.equal(makeHaiku({ name: '😀' }), null);
  assert.equal(makeHaiku({ name: 'Maximilian Bartholomew Alexandria' }), null);
  assert.equal(makeHaiku({ name: 'Ada', syllables: 0 }), null);
  assert.equal(makeHaiku({ name: 'Ada', syllables: 7 }), null);
  assert.equal(makeHaiku({ name: 'Ada', syllables: 2.5 }), null);
});

test('makeHaiku inserts hostile names as plain text exactly once', () => {
  for (const name of ['<b>Ada</b>', '$& Ada', "Ada'; DROP TABLE x;--", '{name}']) {
    const h = makeHaiku({ name, syllables: 2 });
    assert.equal(h.haiku.join('\n').split(name).length - 1, 1, name);
    assert.equal(h.name, name);
  }
});

test('makeHaiku: Unicode names with diacritics and emoji remain scannable with an override', () => {
  assert.equal(makeHaiku({ name: 'José' }).nameSyllables, 2);
  assert.deepEqual(makeHaiku({ name: 'Zoë 😀' }).syllables, [5, 7, 5]);
  assert.deepEqual(makeHaiku({ name: '日本', syllables: 2 }).syllables, [5, 7, 5]);
});

// Replaces one bank entry for the duration of fn(), then restores it, so a test can feed makeHaiku a bad fragment.
function withBadFragment(list, index, fragment, fn) {
  const original = list[index];
  list[index] = fragment;
  try { return fn(); } finally { list[index] = original; }
}

const HAIKU_SRC = path.join(__dirname, '..', 'src', 'haiku.js');
// Loads src/haiku.js with its text edited, to exercise the load-time bank check.
function loadEdited(edit) {
  const m = new Module(HAIKU_SRC, module);
  m.filename = HAIKU_SRC;
  m.paths = Module._nodeModulePaths(path.dirname(HAIKU_SRC));
  m._compile(edit(fs.readFileSync(HAIKU_SRC, 'utf8')), HAIKU_SRC);
  return m.exports;
}

test('makeHaiku skips a seven-syllable line that does not scan and uses the next fragment', () => {
  const seven = BANKS.themes.morning.seven;
  withBadFragment(seven, 0, [7, 'one two'], () => {
    const h = makeHaiku({ name: 'Zed', theme: 'morning', random: () => 0 });
    assert.equal(h.haiku[1], seven[1][1]);
    assert.deepEqual(h.syllables, [5, 7, 5]);
  });
});

test('makeHaiku skips a five-syllable closing line that does not scan and uses the next fragment', () => {
  const five = BANKS.themes.morning.five;
  withBadFragment(five, 0, [5, 'one two'], () => {
    const h = makeHaiku({ name: 'Zed', theme: 'morning', random: () => 0 });
    assert.equal(h.haiku[2], five[1][1]);
    assert.deepEqual(h.syllables, [5, 7, 5]);
  });
});

test('makeHaiku skips a name template whose syllable total is wrong', () => {
  const list = BANKS.nameLine1[1];
  withBadFragment(list, 0, [4, '{name} x'], () => {
    const h = makeHaiku({ name: 'Zed', theme: 'morning', random: () => 0 });
    assert.equal(h.haiku[0], list[1][1].replace('{name}', 'Zed'));
    assert.deepEqual(h.syllables, [5, 7, 5]);
  });
});

test('makeHaiku skips a name template that scans differently once the name is joined to its neighbours', () => {
  const list = BANKS.nameLine1[1];
  // Parts count 1 + 4 = 5, but "Zede sky is soft" scans as 4 as a whole line.
  withBadFragment(list, 0, [4, '{name}e sky is soft'], () => {
    const h = makeHaiku({ name: 'Zed', theme: 'morning', random: () => 0 });
    assert.notEqual(h.haiku[0], 'Zede sky is soft');
    assert.equal(lineSyllables(h.haiku[0]), 5);
    assert.equal(h.haiku[0], list[1][1].replace('{name}', 'Zed'));
  });
});

test('makeHaiku returns null when no candidate scans', () => {
  const list = BANKS.nameLine1[1];
  const saved = list.slice();
  for (let i = 0; i < list.length; i += 1) list[i] = [4, '{name}e sky is soft'];
  try {
    assert.equal(makeHaiku({ name: 'Zed', theme: 'morning', random: () => 0 }), null);
  } finally { saved.forEach((f, i) => { list[i] = f; }); }
});

test('makeHaiku: an explicit seed drives the choice and the default seed comes from the name', () => {
  const seeds = new Set();
  for (let s = 1; s <= 30; s += 1) seeds.add(JSON.stringify(makeHaiku({ name: 'Zed', theme: 'ocean', seed: s }).haiku));
  assert.ok(seeds.size > 1, 'different seeds must produce different haiku');
  assert.deepEqual(makeHaiku({ name: 'Zed', seed: 7 }), makeHaiku({ name: 'Zed', seed: 7 }));
  const byName = new Set();
  for (const n of ['Zed', 'Bob', 'Tim', 'Sam', 'Max', 'Dan', 'Ann', 'Jim', 'Ron', 'Hal', 'Eve', 'Kay']) byName.add(JSON.stringify(makeHaiku({ name: n, theme: 'city' }).haiku.filter((l) => !l.includes(n))));
  assert.ok(byName.size > 1, 'unseeded output must depend on the name');
});

test('the load-time bank check rejects a fragment whose declared syllables are wrong', () => {
  // Declared 5 but really 2: the count disagrees while the declared total still matches the line.
  assert.throws(() => loadEdited((src) => src.replace("[5, 'soft light on the street']", "[5, 'soft light']")), /haiku bank mismatch/);
  // Declared 4 and really 4, but a five-syllable line needs 5: the count agrees while the total does not.
  assert.throws(() => loadEdited((src) => src.replace("[5, 'soft light on the street']", "[4, 'soft light on street']")), /haiku bank mismatch/);
  assert.doesNotThrow(() => loadEdited((src) => src));
});
