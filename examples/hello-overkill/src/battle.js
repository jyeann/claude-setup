'use strict';
const { CATALOGUE, render } = require('./greetings');

const POOL = [...CATALOGUE.values()].map((e) => ({ id: e.id, greeting: render(e.language, e.tone, 'World') }));

// Picks two entries with distinct ids and distinct texts. Returns { a:{id,greeting}, b:{id,greeting} }.
function pickPair(random = Math.random) {
  const pick = () => POOL[Math.min(POOL.length - 1, Math.floor(random() * POOL.length))];
  const a = pick();
  let b = pick();
  for (let i = 0; i < 100 && (b.id === a.id || b.greeting === a.greeting); i += 1) b = pick();
  if (b.id === a.id || b.greeting === a.greeting) b = POOL.find((e) => e.id !== a.id && e.greeting !== a.greeting);
  return { a: { ...a }, b: { ...b } };
}

// votes: Map id -> count. Top 10, votes desc then id asc, zero votes omitted.
function leaderboard(votes) {
  return [...votes.entries()]
    .filter(([id, n]) => n > 0 && CATALOGUE.has(id))
    .sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0))
    .slice(0, 10)
    .map(([id, n], i) => ({ rank: i + 1, id, greeting: POOL.find((e) => e.id === id).greeting, votes: n }));
}

module.exports = { pickPair, leaderboard };
