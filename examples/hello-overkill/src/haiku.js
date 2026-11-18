'use strict';
const { fnv1a, mulberry32 } = require('./weather');

const EXCEPTIONS = {
  the: 1, fire: 1, every: 2, people: 2, poem: 2, quiet: 2, hour: 1, our: 1, queue: 1, area: 3, being: 2, create: 2,
  idea: 3, real: 1, really: 2, science: 2, violet: 3, lion: 2, giant: 2, poet: 2, diet: 2, duet: 2, ocean: 2, somewhere: 2,
  business: 2, different: 3, evening: 2, family: 3, favorite: 3, chocolate: 3, comfortable: 3, beautiful: 3, once: 1, one: 1,
  anyone: 3, everyone: 3, hello: 2, you: 1, your: 1, are: 1, were: 1, there: 1, here: 1, where: 1, what: 1,
};

// Heuristic English syllable count; 0 means the word has no foldable letters.
function countSyllables(word) {
  const accentedE = /\u00e9$/i.test(String(word).normalize('NFC')); // "José": a final accented e is pronounced
  const w = String(word).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 0;
  if (Object.prototype.hasOwnProperty.call(EXCEPTIONS, w)) return EXCEPTIONS[w];
  let n = (w.match(/[aeiouy]+/g) || []).length;
  if (/e$/.test(w) && !accentedE && !/(le|ee|ye)$/.test(w)) n -= 1;
  else if (/[^aeiouytd](es|ed)$/.test(w)) n -= 1;
  n += (w.match(/(?<![tscgq])(ia|io|ua|eo)/g) || []).length;
  return Math.max(1, n);
}

// Sum over words; whitespace and hyphens separate words.
const lineSyllables = (text) => String(text).split(/[\s-]+/).reduce((s, w) => s + countSyllables(w), 0);

// Each fragment is [declaredSyllables, text]. Name templates are keyed by name syllables and declare the count WITHOUT the name.
const BANKS = {
  nameLine1: {
    1: [[4, 'Hello there, {name}, hi'], [4, 'Good day to you, {name}'], [4, 'Welcome, dear friend {name}']],
    2: [[3, 'Hello, {name}, hi'], [3, 'Well met, kind {name}'], [3, 'Greetings to {name}']],
    3: [[2, 'Hello, {name}'], [2, 'Hail to {name}'], [2, 'Welcome, {name}']],
    4: [[1, 'Hi {name}'], [1, 'Hey {name}'], [1, 'Hail {name}']],
  },
  nameLine2: {
    1: [[6, 'the morning welcomes you, {name}'], [6, 'we gladly greet you now, {name}'], [6, 'a warm hello to you, {name}']],
    2: [[5, 'we gladly greet you, {name}'], [5, 'a warm hello for {name}'], [5, 'good cheer to you all, {name}']],
    3: [[4, 'we greet you all, {name}'], [4, 'a hello for {name}'], [4, 'good cheer to you, {name}']],
    4: [[3, 'we greet you, {name}'], [3, 'cheer for you, {name}'], [3, 'the day greets {name}']],
    5: [[2, 'hello, {name}'], [2, 'we greet {name}'], [2, 'good day, {name}']],
    6: [[1, 'hi {name}'], [1, 'hey {name}'], [1, 'hail {name}']],
  },
  themes: {
    morning: {
      five: [[5, 'soft light on the street'], [5, 'the sun climbs the hill'], [5, 'birds wake in the trees'], [5, 'welcome back to you']],
      seven: [[7, 'soft light on the waking street'], [7, 'morning wakes the sleepy town'], [7, 'golden rays spill on the roofs'], [7, 'a new day begins to glow']],
    },
    ocean: {
      five: [[5, 'waves fold on the sand'], [5, 'gulls cry over foam'], [5, 'the tide drifts to shore'], [5, 'salt wind on the bay']],
      seven: [[7, 'slow waves roll across the bay'], [7, 'the tide whispers to the rocks'], [7, 'a white sail leans on the wind'], [7, 'deep blue water holds the sky']],
    },
    city: {
      five: [[5, 'lamps glow down the road'], [5, 'trains hum through the night'], [5, 'a busy street breathes'], [5, 'doors open and close']],
      seven: [[7, 'taxis hum along the street'], [7, 'windows shine above the square'], [7, 'a thousand steps cross the bridge'], [7, 'the crowd moves like a river']],
    },
    night: {
      five: [[5, 'stars hang in the dark'], [5, 'the moon spills silver'], [5, 'crickets sing at dusk'], [5, 'quiet falls on all']],
      seven: [[7, 'the moon climbs over the roofs'], [7, 'a cool wind moves through the trees'], [7, 'far lights blink across the hills'], [7, 'the dark wraps the sleeping world']],
    },
  },
};

// Load-time check: every fragment must scan exactly as declared (and name templates must total the line length).
(function checkBanks() {
  const check = (frag, expectTotal, n) => {
    const [declared, text] = frag;
    const filler = lineSyllables(text.replace('{name}', ''));
    const total = declared + (n || 0);
    if (filler !== declared || total !== expectTotal) throw new Error(`haiku bank mismatch: "${text}" declared ${declared}, counted ${filler}`);
    if (n !== undefined && text.split('{name}').length !== 2) throw new Error(`haiku template needs one {name}: "${text}"`);
  };
  for (const [n, list] of Object.entries(BANKS.nameLine1)) for (const f of list) check(f, 5, Number(n));
  for (const [n, list] of Object.entries(BANKS.nameLine2)) for (const f of list) check(f, 7, Number(n));
  for (const t of Object.values(BANKS.themes)) { for (const f of t.five) check(f, 5); for (const f of t.seven) check(f, 7); }
}());

const LIMIT = 'Syllables are counted by a simple English heuristic and may be off for names and rare words.';
const MAX_TRIES = 20;

// Builds a haiku around the name. Returns null when the name cannot be scanned (no letters, or too many syllables).
// `syllables` (1..6) overrides the heuristic count; `random` or `seed` replaces the name-derived seeded RNG.
function makeHaiku({ name, theme = 'morning', syllables, random, seed }) {
  const bank = Object.prototype.hasOwnProperty.call(BANKS.themes, theme) ? BANKS.themes[theme] : null;
  if (!bank) throw new TypeError('unknown theme');
  const display = String(name).normalize('NFC').trim();
  const n = syllables === undefined ? display.split(/[\s-]+/).reduce((s, w) => s + countSyllables(w), 0) : syllables;
  if (!Number.isInteger(n) || n < 1 || n > 6) return null;
  const rnd = typeof random === 'function' ? random : mulberry32(seed === undefined ? fnv1a(`${display.toLowerCase()}|${theme}`) : seed);
  const onLine1 = n <= 4;
  const templates = onLine1 ? BANKS.nameLine1[n] : BANKS.nameLine2[n];
  const total = onLine1 ? 5 : 7;
  const pick = (list) => Math.min(list.length - 1, Math.floor(rnd() * list.length));
  const start = pick(templates);
  const fiveStart = pick(bank.five);
  const sevenStart = pick(bank.seven);
  const lastStart = pick(bank.five);

  for (let i = 0; i < MAX_TRIES; i += 1) {
    const [, tpl] = templates[(start + i) % templates.length];
    const [pre, post] = tpl.split('{name}');
    const nameLine = pre + display + post;
    const lines = onLine1
      ? [nameLine, bank.seven[(sevenStart + i) % bank.seven.length][1], bank.five[(lastStart + i) % bank.five.length][1]]
      : [bank.five[(fiveStart + i) % bank.five.length][1], nameLine, bank.five[(lastStart + i) % bank.five.length][1]];
    // The name line is scanned with the (possibly overridden) name count; other lines by the heuristic.
    const counts = lines.map((l) => (l === nameLine ? lineSyllables(pre) + n + lineSyllables(post) : lineSyllables(l)));
    const whole = syllables === undefined ? lineSyllables(nameLine) === total : true;
    if (counts[0] === 5 && counts[1] === 7 && counts[2] === 5 && whole && lines.every((l) => l.length > 0)) {
      return { name: display, theme, haiku: lines, syllables: counts, verified: true, nameSyllables: n, limit: LIMIT };
    }
  }
  return null;
}

module.exports = { countSyllables, lineSyllables, makeHaiku, BANKS, LIMIT };
