'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const b = require('../src/board');

const fresh = () => b.createBoard('T', 'fachash', new Date('2026-01-01T00:00:00Z'));
const code = (fn) => { try { fn(); } catch (e) { return `${e.code}:${e.status}`; } return 'none'; };
const view = (bd, voter = 'v') => b.toView(bd, { role: 'participant', voter });

test('createBoard starts open and empty with version 1', () => {
  const bd = fresh();
  assert.equal(bd.closed, false);
  assert.deepEqual(bd.cards, []);
  assert.equal(bd.version, 1);
  assert.equal(bd.createdAt, '2026-01-01T00:00:00.000Z');
});

test('addCard gives increasing string ids that are never reused after delete', () => {
  const bd = fresh();
  b.addCard(bd, 'went-well', 'a', 'me');
  b.addCard(bd, 'actions', 'b', 'me');
  b.deleteCard(bd, '2', { voter: 'me', facilitator: false });
  b.addCard(bd, 'actions', 'c', 'me');
  assert.deepEqual(bd.cards.map((c) => c.id), ['1', '3']);
});

test('addCard validates column and text and refuses on a closed board', () => {
  const bd = fresh();
  assert.equal(code(() => b.addCard(bd, 'nope', 'x', 'me')), 'bad_column:400');
  assert.equal(code(() => b.addCard(bd, 'actions', ' ', 'me')), 'text_empty:400');
  b.setClosed(bd, true);
  assert.equal(code(() => b.addCard(bd, 'actions', 'x', 'me')), 'board_closed:409');
});

test('addCard refuses the 201st card with board_full', () => {
  const bd = fresh();
  for (let i = 0; i < b.MAX_CARDS; i++) b.addCard(bd, 'actions', `c${i}`, 'me');
  assert.equal(code(() => b.addCard(bd, 'actions', 'one more', 'me')), 'board_full:409');
  assert.equal(bd.cards.length, 200);
});

test('vote allows 3 cards per voter, is idempotent and refuses the 4th', () => {
  const bd = fresh();
  for (let i = 0; i < 4; i++) b.addCard(bd, 'actions', `c${i}`, 'me');
  assert.equal(b.vote(bd, '1', 'v'), true);
  assert.equal(b.vote(bd, '1', 'v'), false);
  b.vote(bd, '2', 'v');
  b.vote(bd, '3', 'v');
  assert.equal(code(() => b.vote(bd, '4', 'v')), 'no_votes_left:409');
  assert.equal(view(bd).votesLeft, 0);
  assert.equal(view(bd).cards[0].votes, 1);
});

test('unvote refunds, is idempotent and a missing card is 404', () => {
  const bd = fresh();
  b.addCard(bd, 'actions', 'x', 'me');
  b.vote(bd, '1', 'v');
  assert.equal(b.unvote(bd, '1', 'v'), true);
  assert.equal(b.unvote(bd, '1', 'v'), false);
  assert.equal(view(bd).votesLeft, 3);
  assert.equal(code(() => b.vote(bd, '9', 'v')), 'card_not_found:404');
  assert.equal(code(() => b.vote(bd, 'abc', 'v')), 'card_not_found:404');
});

test('voting and unvoting are refused on a closed board', () => {
  const bd = fresh();
  b.addCard(bd, 'actions', 'x', 'me');
  b.setClosed(bd, true);
  assert.equal(code(() => b.vote(bd, '1', 'v')), 'board_closed:409');
  assert.equal(code(() => b.unvote(bd, '1', 'v')), 'board_closed:409');
});

test('vote refuses a new voter when 500 distinct voters already voted', () => {
  const bd = fresh();
  for (let i = 0; i < 200; i++) b.addCard(bd, 'actions', `c${i}`, 'me');
  for (let i = 0; i < b.MAX_VOTERS; i++) b.vote(bd, String((i % 200) + 1), `voter${i}`);
  assert.equal(code(() => b.vote(bd, '1', 'newcomer')), 'board_full:409');
  assert.equal(b.vote(bd, '2', 'voter0'), true);
});

test('deleteCard refunds voters and enforces author, closed and facilitator rules', () => {
  const bd = fresh();
  b.addCard(bd, 'actions', 'x', 'author');
  b.vote(bd, '1', 'v');
  assert.equal(code(() => b.deleteCard(bd, '1', { voter: 'other', facilitator: false })), 'not_author:403');
  b.setClosed(bd, true);
  assert.equal(code(() => b.deleteCard(bd, '1', { voter: 'author', facilitator: false })), 'board_closed:409');
  b.deleteCard(bd, '1', { voter: 'x', facilitator: true });
  assert.equal(view(bd).votesLeft, 3);
  assert.equal(bd.cards.length, 0);
});

test('setClosed reports changes, is idempotent and needs a boolean', () => {
  const bd = fresh();
  assert.equal(b.setClosed(bd, true), true);
  assert.equal(b.setClosed(bd, true), false);
  assert.equal(code(() => b.setClosed(bd, 'yes')), 'bad_request:400');
  assert.equal(bd.closed, true);
});

test('toView marks own cards and never leaks hashes, authors or voters', () => {
  const bd = fresh();
  b.addCard(bd, 'went-well', 'x', 'authorhash');
  b.vote(bd, '1', 'voterhash');
  const json = JSON.stringify(b.toView(bd, { role: 'facilitator', voter: 'authorhash' }));
  assert.ok(!json.includes('authorhash') && !json.includes('voterhash') && !json.includes('fachash'));
  assert.equal(b.toView(bd, { role: 'facilitator', voter: 'authorhash' }).cards[0].own, true);
  assert.equal(b.toView(bd, { role: 'bogus', voter: 'z' }).role, 'participant');
  assert.equal(view(bd, 'voterhash').cards[0].voted, true);
});
