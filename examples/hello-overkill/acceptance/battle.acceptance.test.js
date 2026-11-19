'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { withServer, startServer, tmpFile } = require('./helpers');

const vote = (s, choice) => s.call('POST', '/api/battle/vote', { choice });

test('GET /api/battle returns two options with distinct ids and distinct greeting texts every time', () => withServer(async (s) => {
  for (let i = 0; i < 60; i += 1) {
    const r = await s.call('GET', '/api/battle');
    assert.equal(r.status, 200);
    assert.deepEqual(Object.keys(r.body).sort(), ['a', 'b']);
    for (const k of ['a', 'b']) {
      assert.match(r.body[k].id, /^[a-z]{2}\.[a-z]+$/);
      assert.ok(r.body[k].greeting.length > 0);
    }
    assert.notEqual(r.body.a.id, r.body.b.id);
    assert.notEqual(r.body.a.greeting, r.body.b.greeting);
  }
}));

test('battle ids are catalogue ids and the pool varies between calls', () => withServer(async (s) => {
  const cat = (await s.call('GET', '/api/catalogue')).body;
  const valid = new Set(cat.languages.flatMap((l) => cat.tones.map((t) => `${l.code}.${t.code}`)));
  const seen = new Set();
  for (let i = 0; i < 40; i += 1) {
    const r = await s.call('GET', '/api/battle');
    for (const k of ['a', 'b']) { assert.ok(valid.has(r.body[k].id), r.body[k].id); seen.add(r.body[k].id); }
  }
  assert.ok(seen.size > 5, `only ${seen.size} distinct ids in 80 picks`);
}));

test('GET /api/leaderboard is empty before any vote', () => withServer(async (s) => {
  const r = await s.call('GET', '/api/leaderboard');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { leaderboard: [] });
}));

test('voting for a battle option returns the leaderboard with rank, id, greeting and votes', () => withServer(async (s) => {
  const b = (await s.call('GET', '/api/battle')).body;
  const r = await vote(s, b.a.id);
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.deepEqual(r.body.leaderboard, [{ rank: 1, id: b.a.id, greeting: b.a.greeting, votes: 1 }]);
  assert.deepEqual((await s.call('GET', '/api/leaderboard')).body.leaderboard, r.body.leaderboard);
}));

test('leaderboard sorts by votes descending then id ascending and omits zero-vote ids', () => withServer(async (s) => {
  for (const id of ['sv.formal', 'en.pirate', 'en.pirate', 'de.corporate', 'sv.formal', 'ja.formal']) await vote(s, id);
  const lb = (await s.call('GET', '/api/leaderboard')).body.leaderboard;
  assert.deepEqual(lb.map((e) => [e.rank, e.id, e.votes]), [[1, 'en.pirate', 2], [2, 'sv.formal', 2], [3, 'de.corporate', 1], [4, 'ja.formal', 1]]);
}));

test('leaderboard shows at most the top 10', () => withServer(async (s) => {
  const cat = (await s.call('GET', '/api/catalogue')).body;
  for (const l of cat.languages) await vote(s, `${l.code}.formal`);
  await vote(s, 'en.pirate');
  await vote(s, 'es.pirate');
  const lb = (await s.call('GET', '/api/leaderboard')).body.leaderboard;
  assert.equal(lb.length, 10);
  assert.deepEqual(lb.map((e) => e.rank), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
}));

test('voting rejects unknown, missing and prototype-ish choices with 400 and records nothing', () => withServer(async (s) => {
  for (const body of [{ choice: 'xx.formal' }, { choice: 'en.nope' }, { choice: '' }, { choice: 5 }, { choice: null }, { choice: '__proto__' }, { choice: 'constructor' }, {}, { choices: 'en.formal' }]) {
    const r = await s.call('POST', '/api/battle/vote', body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.equal(typeof r.body.error, 'string');
  }
  assert.equal((await s.call('POST', '/api/battle/vote', undefined, 'oops')).status, 400);
  assert.deepEqual((await s.call('GET', '/api/leaderboard')).body, { leaderboard: [] });
}));

test('votes are limited to 60 per minute with a 429 and retry-after', () => withServer(async (s) => {
  let limited = null;
  for (let i = 0; i < 70 && !limited; i += 1) {
    const r = await vote(s, 'en.formal');
    if (r.status === 429) limited = r;
    else assert.equal(r.status, 200);
  }
  assert.ok(limited, 'expected a 429 within 70 votes');
  assert.match(limited.headers.get('retry-after'), /^[1-9]\d*$/);
  const lb = (await s.call('GET', '/api/leaderboard')).body.leaderboard;
  assert.ok(lb[0].votes <= 60, 'at most 60 votes were counted');
}));

test('the vote limit is independent of the hello limit', () => withServer(async (s) => {
  for (let i = 0; i < 3; i += 1) await s.call('POST', '/hello');
  assert.equal((await s.call('POST', '/hello')).status, 429);
  assert.equal((await vote(s, 'en.formal')).status, 200);
}, { env: { HELLO_RATE_LIMIT: 3 } }));
