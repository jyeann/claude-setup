'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { startServer, withServer, tmpFile, hello } = require('./helpers');

test('visit count rises on each greeting and the name is case-insensitive', () => withServer(async (s) => {
  assert.equal((await hello(s, { name: 'Ada' })).body.visit, 1);
  const second = await hello(s, { name: 'ada' });
  assert.equal(second.body.visit, 2);
  assert.equal(second.body.name, 'ada');
  assert.equal(second.body.streak, 1, 'same UTC day keeps the streak');
  assert.equal((await hello(s, { name: ' ADA ' })).body.visit, 3);
  assert.equal((await hello(s, { name: 'Bob' })).body.visit, 1);
}));

test('visits and streak persist across a SIGTERM restart on the same data file', async () => {
  const file = tmpFile();
  const first = await startServer(file);
  await hello(first, { name: 'Ada' });
  assert.equal((await hello(first, { name: 'ada' })).body.visit, 2);
  const exit = await first.stop();
  assert.equal(exit.code, 0);
  const second = await startServer(file);
  try {
    const r = await hello(second, { name: 'Ada' });
    assert.equal(r.body.visit, 3);
    assert.equal(r.body.streak, 1);
  } finally { await second.stop(); }
});

test('data file is written before the response, so a SIGKILL right after a greeting loses nothing', async () => {
  const file = tmpFile();
  const first = await startServer(file);
  await hello(first, { name: 'Ada' });
  first.child.kill('SIGKILL');
  await new Promise((r) => first.child.once('exit', r));
  const second = await startServer(file);
  try { assert.equal((await hello(second, { name: 'Ada' })).body.visit, 2); } finally { await second.stop(); }
});

test('a corrupt data file is moved aside and the server starts empty', async () => {
  const file = tmpFile();
  fs.writeFileSync(file, '{ this is not json');
  const s = await startServer(file);
  try {
    assert.equal((await hello(s, { name: 'Ada' })).body.visit, 1);
    const siblings = fs.readdirSync(require('node:path').dirname(file));
    assert.ok(siblings.some((f) => f.includes('.corrupt-')), siblings.join(','));
  } finally { await s.stop(); }
});

test('certificate and its permalink survive a restart', async () => {
  const file = tmpFile();
  const first = await startServer(file);
  const id = (await hello(first, { name: 'Ada', language: 'de' })).body.certificate.id;
  await first.stop();
  const second = await startServer(file);
  try {
    const r = await second.call('GET', `/api/certificates/${id}`);
    assert.equal(r.status, 200);
    assert.equal(r.body.id, id);
    assert.equal(r.body.language, 'de');
  } finally { await second.stop(); }
});

test('leaderboard votes persist across a SIGTERM restart', async () => {
  const file = tmpFile();
  const first = await startServer(file);
  assert.equal((await first.call('POST', '/api/battle/vote', { choice: 'es.pirate' })).status, 200);
  await first.stop();
  const second = await startServer(file);
  try {
    const r = await second.call('GET', '/api/leaderboard');
    assert.equal(r.body.leaderboard.length, 1);
    assert.equal(r.body.leaderboard[0].id, 'es.pirate');
    assert.equal(r.body.leaderboard[0].votes, 1);
    assert.equal((await second.call('POST', '/api/battle/vote', { choice: 'es.pirate' })).body.leaderboard[0].votes, 2);
  } finally { await second.stop(); }
});
