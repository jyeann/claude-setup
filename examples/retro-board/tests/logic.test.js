'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

let L;
before(async () => {
  L = await import(pathToFileURL(path.join(__dirname, '..', 'public', 'js', 'logic.js')).href);
});

test('votes left label is singular for one and says No votes left at zero', () => {
  assert.equal(L.votesLeftLabel(3), '3 votes left');
  assert.equal(L.votesLeftLabel(1), '1 vote left');
  assert.equal(L.votesLeftLabel(0), 'No votes left');
});

test('counter shows used characters and switches to Over by N past 500', () => {
  assert.equal(L.counterText(0), '0 / 500');
  assert.equal(L.counterText(500), '500 / 500');
  assert.equal(L.counterText(512), 'Over by 12');
});

test('card validation returns the exact ux copy for empty and too long text', () => {
  assert.equal(L.validateCardText('   '), 'Write something before adding the card.');
  assert.equal(L.validateCardText('a'.repeat(512)), 'That card is 512 characters. The limit is 500. Shorten it by 12.');
  assert.equal(L.validateCardText('a'.repeat(500)), '');
  assert.equal(L.validateCardText('<b>hi</b>'), '');
});

test('card length counts code points, so an emoji is one character', () => {
  assert.equal(L.validateCardText('\u{1F600}'.repeat(500)), '');
  assert.match(L.validateCardText('\u{1F600}'.repeat(501)), /501 characters/);
});

test('title validation refuses blank and over-100 titles', () => {
  assert.equal(L.validateTitle(' \t '), 'Give your retro a title, for example Sprint 12.');
  assert.equal(L.validateTitle('x'.repeat(101)), 'Keep the title to 100 characters or fewer.');
  assert.equal(L.validateTitle('Sprint 12'), '');
});

test('sort puts higher votes first and keeps the older card first on ties', () => {
  const cards = [
    { id: '1', votes: 0 }, { id: '2', votes: 3 }, { id: '3', votes: 3 }, { id: '10', votes: 1 }, { id: '4', votes: 1 },
  ];
  assert.deepEqual(L.sortCards(cards, true).map((c) => c.id), ['2', '3', '4', '10', '1']);
  assert.deepEqual(L.sortCards(cards.slice().reverse(), false).map((c) => c.id), ['1', '2', '3', '4', '10']);
  assert.equal(cards[0].id, '1', 'input is not mutated');
});

test('poll announcements count new cards from others, removals and closing, never own cards', () => {
  const prev = { closed: false, cards: [{ id: '1', own: false }, { id: '2', own: false }] };
  const next = { closed: true, cards: [{ id: '2', own: false }, { id: '3', own: false }, { id: '4', own: true }, { id: '5', own: false }] };
  assert.deepEqual(L.pollAnnouncements(prev, next), ['2 new cards from others', '1 card removed', 'This retro is closed.']);
  assert.deepEqual(L.pollAnnouncements({ closed: true, cards: [] }, { closed: false, cards: [{ id: '1', own: false }] }),
    ['1 new card from others', 'The retro is open again.']);
  assert.deepEqual(L.pollAnnouncements(prev, prev), []);
});

test('poll delay is 3 s when healthy and backs off 3, 6, 10 s after failures', () => {
  assert.equal(L.nextDelay(0), 3000);
  assert.equal(L.nextDelay(1), 3000);
  assert.equal(L.nextDelay(2), 6000);
  assert.equal(L.nextDelay(3), 10000);
  assert.equal(L.nextDelay(40), 10000);
  assert.equal(L.nextDelay(1, 20), 20000, 'Retry-After raises the delay');
});

test('vote button label names the card and trims to 40 characters', () => {
  assert.equal(L.voteButtonLabel(false, 'Pair more'), 'Vote for: Pair more');
  assert.equal(L.voteButtonLabel(true, 'a'.repeat(60)), `Remove vote from: ${'a'.repeat(40)}`);
});

test('board paths parse participant, facilitator and export routes and reject others', () => {
  assert.deepEqual(L.parseBoardPath('/b/abc_DEF-123'), { p: 'abc_DEF-123', f: null, isExport: false });
  assert.deepEqual(L.parseBoardPath('/b/abc/f/xyz'), { p: 'abc', f: 'xyz', isExport: false });
  assert.deepEqual(L.parseBoardPath('/b/abc/f/xyz/export'), { p: 'abc', f: 'xyz', isExport: true });
  assert.equal(L.parseBoardPath('/nope'), null);
});

test('the server asset loader serves logic.js as JavaScript so the browser can import it', () => {
  const { loadAssets } = require('../src/http');
  const { assets } = loadAssets(path.join(__dirname, '..', 'public'));
  const logic = assets.get('/assets/js/logic.js');
  assert.ok(logic, 'logic.js is in the allowlist');
  assert.match(logic.type, /javascript/);
  assert.match(logic.body.toString('utf8'), /export function votesLeftLabel/);
});

test('vote button names start with the visible text', () => {
  assert.equal(L.voteButtonLabel(false, 'Pair more'), 'Vote for: Pair more');
  assert.equal(L.voteButtonLabel(true, 'Pair more'), 'Remove vote from: Pair more');
});

test('a failed add with an empty textarea puts the text back and says it is still there', () => {
  const o = L.addFailureOutcome({ status: 0, code: 'network' }, 'my idea', '');
  assert.equal(o.restore, true);
  assert.equal(o.rescue, false);
  assert.match(o.message, /Your text is still here/);
});

test('a failed add never loses the text when the user already typed something new', () => {
  const o = L.addFailureOutcome({ status: 500, code: 'error' }, 'my idea', 'second thought');
  assert.equal(o.restore, false);
  assert.equal(o.rescue, true);
  assert.doesNotMatch(o.message, /still here/);
  assert.match(o.message, /kept|shown/i);
});

test('a whitespace-only textarea counts as empty for restoring', () => {
  assert.equal(L.addFailureOutcome({ status: 0, code: 'network' }, 'x', '  \n').restore, true);
});

test('409 board_full shows This board is full. and applies the board', () => {
  const board = { version: 3 };
  const o = L.addFailureOutcome({ status: 409, code: 'board_full', board }, 'idea', '');
  assert.equal(o.message, 'This board is full.');
  assert.equal(o.applyBoard, board);
  assert.equal(o.restore, true);
});

test('board_closed applies the board, shows no error and keeps the text', () => {
  const board = { closed: true };
  const o = L.addFailureOutcome({ status: 409, code: 'board_closed', board }, 'idea', 'typed');
  assert.equal(o.applyBoard, board);
  assert.equal(o.message, '');
  assert.equal(o.rescue, true);
});

test('a text_ validation failure from the server shows the local message or the server message', () => {
  assert.equal(L.addFailureOutcome({ status: 400, code: 'text_empty', message: 'Server says no' }, 'ok', '').message, 'Server says no');
  assert.match(L.addFailureOutcome({ status: 400, code: 'text_too_long', message: 'm' }, 'a'.repeat(501), '').message, /501 characters/);
});

test('poll failures: network and HTTP errors are offline, 404 board_not_found is a load error, anything else is a bug', () => {
  assert.equal(L.pollFailureKind({ status: 0, code: 'network' }), 'offline');
  assert.equal(L.pollFailureKind({ status: 503, code: 'error' }), 'offline');
  assert.equal(L.pollFailureKind({ status: 429, code: 'error' }), 'offline');
  assert.equal(L.pollFailureKind({ status: 404, code: 'board_not_found' }), 'not-found');
  assert.equal(L.pollFailureKind(new TypeError('x is undefined')), 'bug');
  assert.equal(L.pollFailureKind(null), 'bug');
});

test('the share panel starts collapsed on a phone for an existing board, expanded right after creation', () => {
  assert.equal(L.shareStartsOpen({ stored: null, narrow: true, justCreated: false }), false);
  assert.equal(L.shareStartsOpen({ stored: null, narrow: true, justCreated: true }), true);
  assert.equal(L.shareStartsOpen({ stored: null, narrow: false, justCreated: false }), true);
  assert.equal(L.shareStartsOpen({ stored: 'hidden', narrow: false, justCreated: false }), false);
  assert.equal(L.shareStartsOpen({ stored: 'shown', narrow: true, justCreated: false }), true);
});

test('a write response never changes the page role: the facilitator keeps facilitator after add or vote', () => {
  const fromWrite = { role: 'participant', version: 4, cards: [{ id: '1' }] };
  const kept = L.withPageRole(fromWrite, 'facilitator');
  assert.equal(kept.role, 'facilitator');
  assert.deepEqual(kept.cards, fromWrite.cards);
  assert.equal(fromWrite.role, 'participant', 'the response object is not mutated');
  assert.equal(L.withPageRole(fromWrite, 'participant'), fromWrite, 'unchanged when the roles already agree');
  assert.equal(L.withPageRole(fromWrite, undefined), fromWrite, 'unchanged before the page role is known');
  assert.equal(L.withPageRole(null, 'facilitator'), null);
});
