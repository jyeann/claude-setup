'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  withServer, newClientId, createBoard, addCard, vote, unvote, getBoard, getFacBoard, setClosed,
} = require('./helpers');

const TOKEN = /^[A-Za-z0-9_-]{22,}$/;
const unknownToken = () => newClientId(); // 22 URL-safe chars, but no such board
const localDate = () => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

// ---- create (SC1-3) --------------------------------------------------------

test('creates a board with two distinct URL-safe tokens and an empty open board', () => withServer(async (s) => {
  const res = await s.call('POST', '/api/boards', { title: 'Sprint 12' });
  assert.equal(res.status, 201);
  const { participantToken: p, facilitatorToken: f, board } = res.body;
  assert.match(p, TOKEN);
  assert.match(f, TOKEN);
  assert.notEqual(p, f);
  assert.equal(board.title, 'Sprint 12');
  assert.equal(board.closed, false);
  assert.deepEqual(board.cards, []);
  assert.equal(board.maxVotes, 3);
  assert.equal(board.votesLeft, 3);
  assert.equal(typeof board.version, 'number');
}));

test('two created boards never share tokens', () => withServer(async (s) => {
  const a = await createBoard(s, 'A');
  const b = await createBoard(s, 'B');
  assert.notEqual(a.p, b.p);
  assert.notEqual(a.f, b.f);
}));

test('trims the title and returns markup in it unchanged', () => withServer(async (s) => {
  const a = await s.call('POST', '/api/boards', { title: '  Sprint 12  ' });
  assert.equal(a.body.board.title, 'Sprint 12');
  const b = await s.call('POST', '/api/boards', { title: '<b>x</b>' });
  assert.equal(b.status, 201);
  assert.equal(b.body.board.title, '<b>x</b>');
}));

test('rejects an empty, blank or missing title with 400 title_empty', () => withServer(async (s) => {
  for (const body of [{ title: '' }, { title: '   ' }, {}]) {
    const res = await s.call('POST', '/api/boards', body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.equal(res.body.error.code, 'title_empty');
    assert.equal(typeof res.body.error.message, 'string');
  }
}));

test('accepts a 100-character title and rejects 101 with title_too_long', () => withServer(async (s) => {
  const ok = await s.call('POST', '/api/boards', { title: 'a'.repeat(100) });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.board.title.length, 100);
  const bad = await s.call('POST', '/api/boards', { title: 'a'.repeat(101) });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error.code, 'title_too_long');
}));

// ---- roles (SC4, SC14) -----------------------------------------------------

test('participant link gives role participant, facilitator link gives role facilitator', () => withServer(async (s) => {
  const { p, f } = await createBoard(s);
  const part = await getBoard(s, p);
  const fac = await getFacBoard(s, p, f);
  assert.equal(part.status, 200);
  assert.equal(part.body.role, 'participant');
  assert.equal(part.body.title, 'Sprint 12');
  assert.equal(fac.status, 200);
  assert.equal(fac.body.role, 'facilitator');
}));

test('a wrong or truncated facilitator token falls back to the participant view', () => withServer(async (s) => {
  const { p, f } = await createBoard(s);
  for (const bad of [unknownToken(), f.slice(0, -1), f.slice(0, 5)]) {
    const res = await getFacBoard(s, p, bad);
    assert.equal(res.status, 200, bad);
    assert.equal(res.body.role, 'participant');
  }
}));

test('an unknown or malformed board token gives 404 board_not_found', () => withServer(async (s) => {
  for (const p of [unknownToken(), 'not-a-real-token', 'x']) {
    const res = await getBoard(s, p);
    assert.equal(res.status, 404, p);
    assert.equal(res.body.error.code, 'board_not_found');
  }
}));

// ---- add card (SC5, SC6) ---------------------------------------------------

test('adds a card of 1 and of 500 characters and refuses 501 with text_too_long', () => withServer(async (s) => {
  const { p } = await createBoard(s);
  const one = await addCard(s, p, 'went-well', 'x');
  assert.equal(one.status, 201);
  const max = await addCard(s, p, 'went-well', 'y'.repeat(500));
  assert.equal(max.status, 201);
  assert.equal(max.card.text.length, 500);
  const over = await addCard(s, p, 'went-well', 'z'.repeat(501));
  assert.equal(over.status, 400);
  assert.equal(over.body.error.code, 'text_too_long');
  assert.equal((await getBoard(s, p)).body.cards.length, 2);
}));

test('refuses an empty, whitespace-only or missing card text with text_empty', () => withServer(async (s) => {
  const { p } = await createBoard(s);
  for (const text of ['', '   ', '\n\t ']) {
    const res = await addCard(s, p, 'to-improve', text);
    assert.equal(res.status, 400, JSON.stringify(text));
    assert.equal(res.body.error.code, 'text_empty');
  }
  const missing = await s.call('POST', `/api/boards/${p}/cards`, { column: 'to-improve' });
  assert.equal(missing.status, 400);
  assert.equal((await getBoard(s, p)).body.cards.length, 0);
}));

test('refuses an unknown or missing column with bad_column', () => withServer(async (s) => {
  const { p } = await createBoard(s);
  for (const column of ['nope', 'Went well', '', undefined]) {
    const res = await s.call('POST', `/api/boards/${p}/cards`, { column, text: 'hi' });
    assert.equal(res.status, 400, String(column));
    assert.equal(res.body.error.code, 'bad_column');
  }
}));

test('returns <b>hi</b> unchanged and describes the new card', () => withServer(async (s) => {
  const { p } = await createBoard(s);
  const res = await addCard(s, p, 'went-well', '<b>hi</b>');
  assert.equal(res.status, 201);
  assert.equal(res.card.text, '<b>hi</b>');
  assert.equal(res.card.column, 'went-well');
  assert.equal(res.card.votes, 0);
  assert.equal(res.card.voted, false);
  assert.equal(res.card.own, true);
  assert.equal(typeof res.card.id, 'string');
  const again = await getBoard(s, p);
  assert.equal(again.body.cards[0].text, '<b>hi</b>');
}));

test('lists cards in creation order and marks only the author own', () => withServer(async (s) => {
  const { p } = await createBoard(s);
  const alice = newClientId();
  const bob = newClientId();
  await addCard(s, p, 'actions', 'first', alice);
  await addCard(s, p, 'went-well', 'second', bob);
  await addCard(s, p, 'to-improve', 'third', alice);
  const forAlice = (await getBoard(s, p, alice)).body.cards;
  const forBob = (await getBoard(s, p, bob)).body.cards;
  assert.deepEqual(forAlice.map((c) => c.text), ['first', 'second', 'third']);
  assert.deepEqual(forAlice.map((c) => c.own), [true, false, true]);
  assert.deepEqual(forBob.map((c) => c.own), [false, true, false]);
}));

// ---- votes (SC7, SC8) ------------------------------------------------------

test('voting raises the count by 1 and lowers votesLeft from 3 to 2', () => withServer(async (s) => {
  const { p } = await createBoard(s);
  const { card } = await addCard(s, p, 'went-well', 'Pair more');
  const res = await vote(s, p, card.id);
  assert.equal(res.status, 200);
  const c = res.body.cards[0];
  assert.equal(c.votes, 1);
  assert.equal(c.voted, true);
  assert.equal(res.body.votesLeft, 2);
}));

test('the 4th vote by one client gets 409 no_votes_left with a fresh board view', () => withServer(async (s) => {
  const { p } = await createBoard(s);
  const ids = [];
  for (let i = 0; i < 4; i++) ids.push((await addCard(s, p, ['went-well', 'to-improve', 'actions'][i % 3], `c${i}`)).card.id);
  for (let i = 0; i < 3; i++) assert.equal((await vote(s, p, ids[i])).status, 200);
  const res = await vote(s, p, ids[3]);
  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, 'no_votes_left');
  assert.equal(res.body.board.votesLeft, 0);
  assert.equal(res.body.board.cards.find((c) => c.id === ids[3]).votes, 0);
}));

test('voting twice on the same card is a no-op and costs one vote', () => withServer(async (s) => {
  const { p } = await createBoard(s);
  const { card } = await addCard(s, p, 'went-well', 'x');
  await vote(s, p, card.id);
  const second = await vote(s, p, card.id);
  assert.equal(second.status, 200);
  assert.equal(second.body.cards[0].votes, 1);
  assert.equal(second.body.votesLeft, 2);
}));

test('taking a vote back refunds it, and taking back again is harmless', () => withServer(async (s) => {
  const { p } = await createBoard(s);
  const { card } = await addCard(s, p, 'went-well', 'x');
  await vote(s, p, card.id);
  const back = await unvote(s, p, card.id);
  assert.equal(back.status, 200);
  assert.equal(back.body.cards[0].votes, 0);
  assert.equal(back.body.cards[0].voted, false);
  assert.equal(back.body.votesLeft, 3);
  const twice = await unvote(s, p, card.id);
  assert.equal(twice.status, 200);
  assert.equal(twice.body.votesLeft, 3);
}));

test('two clients have independent budgets and their votes add up on a card', () => withServer(async (s) => {
  const { p } = await createBoard(s);
  const a = newClientId();
  const b = newClientId();
  const { card } = await addCard(s, p, 'to-improve', 'Slow builds', a);
  await vote(s, p, card.id, a);
  const res = await vote(s, p, card.id, b);
  assert.equal(res.body.cards[0].votes, 2);
  assert.equal(res.body.votesLeft, 2);
  assert.equal((await getBoard(s, p, a)).body.votesLeft, 2);
  const fresh = await getBoard(s, p, newClientId());
  assert.equal(fresh.body.votesLeft, 3);
  assert.equal(fresh.body.cards[0].voted, false);
  assert.equal(fresh.body.cards[0].votes, 2);
}));

test('deleting a voted card refunds the vote to its voter', () => withServer(async (s) => {
  const { p } = await createBoard(s);
  const author = newClientId();
  const voter = newClientId();
  const { card } = await addCard(s, p, 'went-well', 'doomed', author);
  await vote(s, p, card.id, voter);
  assert.equal((await getBoard(s, p, voter)).body.votesLeft, 2);
  const del = await s.call('DELETE', `/api/boards/${p}/cards/${card.id}`, undefined, { clientId: author });
  assert.equal(del.status, 200);
  const after = await getBoard(s, p, voter);
  assert.equal(after.body.votesLeft, 3);
  assert.equal(after.body.cards.length, 0);
}));

test('voting on a card that does not exist gives 404 card_not_found', () => withServer(async (s) => {
  const { p } = await createBoard(s);
  const res = await vote(s, p, '999');
  assert.equal(res.status, 404);
  assert.equal(res.body.error.code, 'card_not_found');
}));

// ---- delete authorisation (SC9) -------------------------------------------

test('the author can delete their own card, another participant gets 403 not_author', () => withServer(async (s) => {
  const { p } = await createBoard(s);
  const author = newClientId();
  const other = newClientId();
  const { card } = await addCard(s, p, 'went-well', 'mine', author);
  const denied = await s.call('DELETE', `/api/boards/${p}/cards/${card.id}`, undefined, { clientId: other });
  assert.equal(denied.status, 403);
  assert.equal(denied.body.error.code, 'not_author');
  assert.equal((await getBoard(s, p)).body.cards.length, 1);
  const ok = await s.call('DELETE', `/api/boards/${p}/cards/${card.id}`, undefined, { clientId: author });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body.cards, []);
}));

test('the facilitator can delete anyone\'s card, a wrong facilitator token gets 403', () => withServer(async (s) => {
  const { p, f } = await createBoard(s);
  const { card } = await addCard(s, p, 'went-well', 'theirs', newClientId());
  const wrong = await s.call('DELETE', `/api/boards/${p}/f/${unknownToken()}/cards/${card.id}`);
  assert.equal(wrong.status, 403);
  assert.equal(wrong.body.error.code, 'forbidden');
  assert.equal((await getBoard(s, p)).body.cards.length, 1);
  const ok = await s.call('DELETE', `/api/boards/${p}/f/${f}/cards/${card.id}`);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.cards.length, 0);
}));

test('deleting an unknown card or on an unknown board gives 404', () => withServer(async (s) => {
  const { p, f } = await createBoard(s);
  const noCard = await s.call('DELETE', `/api/boards/${p}/cards/42`);
  assert.equal(noCard.status, 404);
  assert.equal(noCard.body.error.code, 'card_not_found');
  const facNoCard = await s.call('DELETE', `/api/boards/${p}/f/${f}/cards/42`);
  assert.equal(facNoCard.status, 404);
  const noBoard = await s.call('DELETE', `/api/boards/${unknownToken()}/cards/1`);
  assert.equal(noBoard.status, 404);
  assert.equal(noBoard.body.error.code, 'board_not_found');
}));

// ---- close and reopen (SC11) ----------------------------------------------

test('a closed board refuses cards and votes with 409 board_closed, reopening restores them', () => withServer(async (s) => {
  const { p, f } = await createBoard(s);
  const { card } = await addCard(s, p, 'went-well', 'before');
  const closed = await setClosed(s, p, f, true);
  assert.equal(closed.status, 200);
  assert.equal(closed.body.closed, true);
  assert.equal((await getBoard(s, p)).body.closed, true);

  const add = await addCard(s, p, 'went-well', 'late');
  assert.equal(add.status, 409);
  assert.equal(add.body.error.code, 'board_closed');
  assert.equal(add.body.board.closed, true);
  const v = await vote(s, p, card.id);
  assert.equal(v.status, 409);
  assert.equal(v.body.error.code, 'board_closed');

  const reopened = await setClosed(s, p, f, false);
  assert.equal(reopened.body.closed, false);
  assert.equal((await addCard(s, p, 'went-well', 'after')).status, 201);
  assert.equal((await vote(s, p, card.id)).status, 200);
}));

test('on a closed board the author gets 409 but the facilitator can still delete', () => withServer(async (s) => {
  const { p, f } = await createBoard(s);
  const author = newClientId();
  const a = await addCard(s, p, 'went-well', 'one', author);
  const b = await addCard(s, p, 'went-well', 'two', author);
  await setClosed(s, p, f, true);
  const denied = await s.call('DELETE', `/api/boards/${p}/cards/${a.card.id}`, undefined, { clientId: author });
  assert.equal(denied.status, 409);
  assert.equal(denied.body.error.code, 'board_closed');
  const ok = await s.call('DELETE', `/api/boards/${p}/f/${f}/cards/${b.card.id}`);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.cards.length, 1);
  assert.equal(ok.body.closed, true);
}));

test('closing is idempotent, needs a boolean and needs the right facilitator token', () => withServer(async (s) => {
  const { p, f } = await createBoard(s);
  assert.equal((await setClosed(s, p, f, true)).status, 200);
  assert.equal((await setClosed(s, p, f, true)).body.closed, true);
  const wrong = await setClosed(s, p, unknownToken(), false);
  assert.equal(wrong.status, 403);
  assert.equal((await getBoard(s, p)).body.closed, true);
  const bad = await s.call('PUT', `/api/boards/${p}/f/${f}/closed`, { closed: 'yes' });
  assert.equal(bad.status, 400);
}));

// ---- ETag and version ------------------------------------------------------

test('GET returns an ETag from the version and 304 for a matching If-None-Match', () => withServer(async (s) => {
  const { p } = await createBoard(s);
  const first = await getBoard(s, p);
  assert.equal(first.headers.etag, `"${first.body.version}"`);
  assert.match(first.headers['cache-control'], /no-cache/);
  assert.match(first.headers.vary.toLowerCase(), /x-client-id/);
  const cond = await s.call('GET', `/api/boards/${p}`, undefined, { headers: { 'if-none-match': first.headers.etag } });
  assert.equal(cond.status, 304);
  assert.equal(cond.text, '');
}));

test('every change bumps the version by one and invalidates the old ETag', () => withServer(async (s) => {
  const { p } = await createBoard(s);
  const first = await getBoard(s, p);
  const add = await addCard(s, p, 'went-well', 'x');
  assert.equal(add.body.version, first.body.version + 1);
  assert.equal(add.headers.etag, `"${add.body.version}"`);
  const stale = await s.call('GET', `/api/boards/${p}`, undefined, { headers: { 'if-none-match': first.headers.etag } });
  assert.equal(stale.status, 200);
  assert.equal(stale.body.version, first.body.version + 1);
}));

// ---- markdown export (SC12) -----------------------------------------------

test('export returns the exact markdown shape, a sprint-12.md filename and cards by votes', () => withServer(async (s) => {
  const { p, f } = await createBoard(s, 'Sprint 12');
  const [a, b, c] = [newClientId(), newClientId(), newClientId()];
  await addCard(s, p, 'went-well', 'Good pairing', a);
  const fast = await addCard(s, p, 'went-well', 'Fast deploys', a);
  const run = await addCard(s, p, 'actions', 'Write the runbook', a);
  for (const who of [a, b, c]) await vote(s, p, fast.card.id, who);
  for (const who of [a, b]) await vote(s, p, run.card.id, who);
  const res = await s.call('GET', `/api/boards/${p}/f/${f}/export`);
  assert.equal(res.status, 200);
  assert.equal(res.body.filename, 'sprint-12.md');
  const expected = [
    '# Sprint 12', '', `Date: ${localDate()}`, '',
    '## Went well', '', '- Fast deploys (3 votes)', '- Good pairing (0 votes)', '',
    '## To improve', '', '- _No cards._', '',
    '## Actions', '', '- [ ] Write the runbook (2 votes)',
  ].join('\n');
  assert.equal(res.body.markdown.trimEnd(), expected);
}));

test('export uses a singular "1 vote", keeps older-first on ties and shows empty columns', () => withServer(async (s) => {
  const { p, f } = await createBoard(s);
  const me = newClientId();
  await addCard(s, p, 'to-improve', 'tie one', me);
  await addCard(s, p, 'to-improve', 'tie two', me);
  const top = await addCard(s, p, 'to-improve', 'top', me);
  await vote(s, p, top.card.id, me);
  const md = (await s.call('GET', `/api/boards/${p}/f/${f}/export`)).body.markdown;
  const lines = md.split('\n');
  const start = lines.indexOf('## To improve');
  assert.deepEqual(lines.slice(start + 2, start + 5), ['- top (1 vote)', '- tie one (0 votes)', '- tie two (0 votes)']);
  assert.ok(lines.indexOf('## Went well') < start && start < lines.indexOf('## Actions'));
  assert.equal(md.split('- _No cards._').length - 1, 2);
}));

test('export keeps markup literal and only the right facilitator token may export', () => withServer(async (s) => {
  const { p, f } = await createBoard(s);
  await addCard(s, p, 'went-well', '<b>hi</b>');
  const ok = await s.call('GET', `/api/boards/${p}/f/${f}/export`);
  assert.ok(ok.body.markdown.includes('- <b>hi</b> (0 votes)'));
  const wrong = await s.call('GET', `/api/boards/${p}/f/${unknownToken()}/export`);
  assert.ok([403, 404].includes(wrong.status), String(wrong.status));
  assert.ok(!wrong.text.includes('<b>hi</b>'));
  assert.equal((await s.call('GET', `/api/boards/${unknownToken()}/f/${f}/export`)).status, 404);
}));

// ---- persistence (SC13) ----------------------------------------------------

test('cards, votes, authorship, closed state, version and facilitator rights survive a restart', () => withServer(async (s, ctx) => {
  const { p, f } = await createBoard(s, 'Sprint 12');
  const author = newClientId();
  const voter = newClientId();
  const { card } = await addCard(s, p, 'to-improve', 'Slow builds', author);
  await addCard(s, p, 'actions', 'Fix it', author);
  await vote(s, p, card.id, voter);
  await setClosed(s, p, f, true);
  const before = (await getBoard(s, p, voter)).headers.etag;

  const s2 = await ctx.restart();
  const asVoter = await getBoard(s2, p, voter);
  assert.equal(asVoter.status, 200);
  assert.equal(asVoter.body.title, 'Sprint 12');
  assert.equal(asVoter.body.closed, true);
  assert.deepEqual(asVoter.body.cards.map((c) => [c.text, c.votes, c.voted]), [['Slow builds', 1, true], ['Fix it', 0, false]]);
  assert.equal(asVoter.body.votesLeft, 2);
  assert.equal(asVoter.headers.etag, before);
  const asAuthor = await getBoard(s2, p, author);
  assert.deepEqual(asAuthor.body.cards.map((c) => c.own), [true, true]);
  assert.equal((await getFacBoard(s2, p, f)).body.role, 'facilitator');
  const cond = await s2.call('GET', `/api/boards/${p}`, undefined, { clientId: voter, headers: { 'if-none-match': before } });
  assert.equal(cond.status, 304);
}));

test('exits with code 0 on SIGTERM and prints the local address', () => withServer(async (s) => {
  assert.ok(s.logs().stdout.includes(`Retro board running at http://localhost:${s.port}`));
  const info = await s.stop();
  assert.equal(info.code, 0);
  assert.equal(await s.stopped, info);
}));

// ---- request rules ---------------------------------------------------------

test('rejects non-JSON writes with 415 and malformed JSON with 400 bad_json', () => withServer(async (s) => {
  const text = await s.call('POST', '/api/boards', undefined, { raw: '{"title":"x"}', headers: { 'content-type': 'text/plain' } });
  assert.equal(text.status, 415);
  const none = await s.call('POST', '/api/boards', undefined, { raw: '{"title":"x"}', headers: { 'content-type': null } });
  assert.equal(none.status, 415);
  const bad = await s.call('POST', '/api/boards', undefined, { raw: '{not json' });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error.code, 'bad_json');
  const charset = await s.call('POST', '/api/boards', undefined, { raw: '{"title":"x"}', headers: { 'content-type': 'application/json; charset=utf-8' } });
  assert.equal(charset.status, 201);
}));

test('a body of about 8 KB is read, one over 8 KB gets 413', () => withServer(async (s) => {
  const fits = JSON.stringify({ title: 'a'.repeat(7900) });
  const ok = await s.call('POST', '/api/boards', undefined, { raw: fits });
  assert.equal(ok.status, 400); // read fine, then rejected as too long
  assert.equal(ok.body.error.code, 'title_too_long');
  const big = await s.call('POST', '/api/boards', undefined, { raw: JSON.stringify({ title: 'a'.repeat(9000) }) });
  assert.equal(big.status, 413);
}));

test('known routes with the wrong method get 405 and an Allow header', () => withServer(async (s) => {
  const { p } = await createBoard(s);
  const list = await s.call('GET', '/api/boards');
  assert.equal(list.status, 405);
  assert.match(list.headers.allow, /POST/);
  const opts = await s.call('OPTIONS', '/api/boards');
  assert.equal(opts.status, 405);
  assert.equal((await s.call('POST', `/api/boards/${p}`, {})).status, 405);
  assert.equal((await s.call('PATCH', `/api/boards/${p}/cards/1`, {})).status, 405);
  assert.equal((await s.call('GET', `/api/boards/${p}/cards`)).status, 405);
  const home = await s.call('POST', '/', {});
  assert.equal(home.status, 405);
  assert.match(home.headers.allow, /GET/);
}));

test('an unknown API path gives 404', () => withServer(async (s) => {
  assert.equal((await s.call('GET', '/api/nothing')).status, 404);
  assert.equal((await s.call('POST', `/api/boards/${unknownToken()}/cards`, { column: 'went-well', text: 'x' })).status, 404);
}));

test('API responses carry the security headers and JSON content type', () => withServer(async (s) => {
  const res = await s.call('POST', '/api/boards', { title: 'x' });
  assert.match(res.headers['content-type'], /application\/json/);
  assert.match(res.headers['content-security-policy'], /default-src 'none'/);
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
  assert.equal(res.headers['referrer-policy'], 'no-referrer');
  assert.equal(res.headers['x-frame-options'], 'DENY');
  assert.match(res.headers['cache-control'], /no-store/);
  assert.equal(res.headers['access-control-allow-origin'], undefined);
}));
