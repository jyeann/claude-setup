'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
// Resolved from the working directory so the gate grades the trial's own acceptance/helpers.js and code.
const H = path.join(process.cwd(), 'acceptance', 'helpers.js');
const {
  startServer, withServer, newClientId, createBoard, addCard, vote, unvote, getBoard, getFacBoard, setClosed,
} = require(H);

const unknown = () => newClientId();
const exportMd = async (s, p, f) => (await s.call('GET', `/api/boards/${p}/f/${f}/export`)).body.markdown;

test('Unicode and emoji in titles and cards are counted by code point and normalised to NFC', () => withServer(async (s) => {
  const ok = await s.call('POST', '/api/boards', { title: '\u{1F600}'.repeat(100) });
  assert.equal(ok.status, 201);
  assert.equal([...ok.body.board.title].length, 100);
  const bad = await s.call('POST', '/api/boards', { title: '\u{1F600}'.repeat(101) });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error.code, 'title_too_long');

  const { p } = await createBoard(s);
  const max = await addCard(s, p, 'went-well', '\u{1F680}'.repeat(500));
  assert.equal(max.status, 201);
  assert.equal([...max.card.text].length, 500);
  const over = await addCard(s, p, 'went-well', '\u{1F680}'.repeat(501));
  assert.equal(over.status, 400);
  assert.equal(over.body.error.code, 'text_too_long');

  const nfc = await addCard(s, p, 'actions', 'Café über');
  assert.equal(nfc.card.text, 'Café über');
  const cjk = await addCard(s, p, 'actions', '日本語 \u{1F468}‍\u{1F469}');
  assert.equal(cjk.status, 201);
}));

test('whitespace-only and control-character cards are refused, tabs and newlines kept, trim happens before counting', () => withServer(async (s) => {
  const { p } = await createBoard(s);
  for (const text of ['   \n\t  ', '   ', 'a\u0000b', 'a\u0007b', 'a\u001bb', 'a\u0085b', 'a\u009fb', '\u007f']) {
    const res = await addCard(s, p, 'to-improve', text);
    assert.equal(res.status, 400, JSON.stringify(text));
  }
  const multi = await addCard(s, p, 'to-improve', 'line1\nline2\tend');
  assert.equal(multi.status, 201);
  assert.equal(multi.card.text, 'line1\nline2\tend');
  const padded = await addCard(s, p, 'to-improve', `  ${'a'.repeat(500)}   \n`);
  assert.equal(padded.status, 201);
  assert.equal(padded.card.text, 'a'.repeat(500));
  const badTitle = await s.call('POST', '/api/boards', { title: 'Sprint\u0000 12' });
  assert.equal(badTitle.status, 400);
  const collapsed = await s.call('POST', '/api/boards', { title: '  Sprint    12  ' });
  assert.equal(collapsed.body.board.title, 'Sprint 12');
  assert.equal((await s.call('POST', `/api/boards/${p}/cards`, { column: 'actions', text: 12345 })).status, 400);
  assert.equal((await s.call('POST', `/api/boards/${p}/cards`, undefined, { raw: 'null' })).status, 400);
  assert.equal((await s.call('POST', `/api/boards/${p}/cards`, undefined, { raw: '[]' })).status, 400);
}));

test('leading markdown characters in cards and the title are escaped and each card stays on one line', () => withServer(async (s) => {
  const { p, f } = await createBoard(s, '# Hi');
  const cases = { '# heading': '\\# heading', '- item': '\\- item', '* star': '\\* star', '> quote': '\\> quote', '[link](x)': '\\[link](x)', '+ plus': '\\+ plus' };
  for (const text of Object.keys(cases)) await addCard(s, p, 'went-well', text);
  await addCard(s, p, 'actions', '# act');
  await addCard(s, p, 'to-improve', 'a\nb\tc');
  const md = await exportMd(s, p, f);
  const lines = md.split('\n');
  assert.equal(lines[0], '# \\# Hi');
  for (const [text, escaped] of Object.entries(cases)) {
    assert.ok(lines.includes(`- ${escaped} (0 votes)`), `${text} -> ${lines.join(' | ')}`);
  }
  assert.ok(lines.includes('- [ ] \\# act (0 votes)'));
  assert.ok(lines.includes('- a b c (0 votes)'));
  assert.ok(!lines.some((l) => /^(#|>|\*|\+) /.test(l) && !/^#{1,2} /.test(l)));
}));

test('a board is capped at 200 cards, then 409 board_full with a fresh view; deleting frees a slot', () => withServer(async (s) => {
  const { p, f } = await createBoard(s);
  let last;
  for (let i = 0; i < 200; i++) {
    last = await addCard(s, p, ['went-well', 'to-improve', 'actions'][i % 3], `card ${i}`);
    assert.equal(last.status, 201, `card ${i}`);
  }
  const over = await addCard(s, p, 'went-well', 'one too many');
  assert.equal(over.status, 409);
  assert.equal(over.body.error.code, 'board_full');
  assert.equal(over.body.board.cards.length, 200);
  const del = await s.call('DELETE', `/api/boards/${p}/f/${f}/cards/${last.card.id}`);
  assert.equal(del.status, 200);
  assert.equal((await addCard(s, p, 'went-well', 'fits now')).status, 201);
}));

test('tokens, hashes and client ids never appear in any response after create', () => withServer(async (s) => {
  const me = newClientId();
  const { p, f } = await createBoard(s, 'Sprint 12', me);
  const sha = (x, enc) => crypto.createHash('sha256').update(x).digest(enc);
  const forbidden = [p, f, me, sha(p, 'hex'), sha(f, 'hex'), sha(me, 'base64url'), sha(me, 'hex'), sha(f, 'base64url'), 'facHash', 'voters'];
  const c = await addCard(s, p, 'went-well', 'one', me);
  const responses = [
    c,
    await vote(s, p, c.card.id, me),
    await getBoard(s, p, me),
    await getFacBoard(s, p, f, me),
    await getFacBoard(s, p, unknown(), me),
    await s.call('GET', `/api/boards/${p}/f/${f}/export`, undefined, { clientId: me }),
    await setClosed(s, p, f, true, me),
    await addCard(s, p, 'went-well', 'late', me), // 409
    await vote(s, p, '99', me), // 404
    await s.call('GET', `/api/boards/${unknown()}`, undefined, { clientId: me }),
    await s.call('GET', `/b/${p}/f/${f}`),
    await s.call('GET', `/b/${p}/f/${f}/export`),
    await s.call('GET', '/b/nope'),
  ];
  for (const r of responses) {
    for (const bad of forbidden) {
      assert.ok(!r.text.includes(bad), `response ${r.status} leaks ${bad.slice(0, 8)}...`);
      for (const v of Object.values(r.headers)) assert.ok(!String(v).includes(bad), 'header leaks a secret');
    }
  }
}));

test('a Host header that does not match localhost, 127.0.0.1 or [::1] gets 403; a matching Origin is fine, a foreign one is 403', () => withServer(async (s) => {
  for (const host of ['evil.example', `evil.example:${s.port}`, `127.0.0.1.evil.example:${s.port}`]) {
    for (const url of ['/', '/api/boards/' + unknown()]) {
      const res = await s.call('GET', url, undefined, { headers: { host } });
      assert.equal(res.status, 403, `${host} ${url}`);
    }
  }
  assert.equal((await s.call('GET', '/', undefined, { headers: { host: `localhost:${s.port}` } })).status, 200);
  assert.equal((await s.call('GET', '/', undefined, { headers: { host: `127.0.0.1:${s.port}` } })).status, 200);
  const foreign = await s.call('POST', '/api/boards', { title: 'x' }, { headers: { origin: 'http://evil.example' } });
  assert.equal(foreign.status, 403);
  const same = await s.call('POST', '/api/boards', { title: 'x' }, { headers: { origin: `http://127.0.0.1:${s.port}` } });
  assert.equal(same.status, 201);
}));

test('a malformed client id is refused with 400 bad_client_id on every board route', () => withServer(async (s) => {
  const { p, f } = await createBoard(s);
  const c = await addCard(s, p, 'went-well', 'x');
  const bad = ['short', 'a'.repeat(21), 'a'.repeat(23), `${'a'.repeat(21)}!`, `${'a'.repeat(21)}=`, ` ${'a'.repeat(21)}`, 'é'.repeat(22)];
  for (const clientId of bad) {
    let res;
    try { res = await s.call('GET', `/api/boards/${p}`, undefined, { clientId }); } catch { continue; } // header the HTTP client cannot even send
    assert.equal(res.status, 400, clientId);
    assert.equal(res.body.error.code, 'bad_client_id');
  }
  const id = 'not-valid';
  assert.equal((await s.call('POST', `/api/boards/${p}/cards`, { column: 'went-well', text: 'y' }, { clientId: id })).status, 400);
  assert.equal((await vote(s, p, c.card.id, id)).status, 400);
  assert.equal((await unvote(s, p, c.card.id, id)).status, 400);
  assert.equal((await s.call('DELETE', `/api/boards/${p}/cards/${c.card.id}`, undefined, { clientId: id })).status, 400);
  assert.equal((await getFacBoard(s, p, f, id)).status, 400);
  assert.equal((await getBoard(s, p)).body.cards.length, 1);
}));

test('a wrong participant token gives 404 on every API and page route, and mutates nothing', () => withServer(async (s) => {
  const real = await createBoard(s);
  const c = await addCard(s, real.p, 'went-well', 'keep');
  const p = unknown();
  const f = real.f;
  const cases = [
    ['GET', `/api/boards/${p}`], ['GET', `/api/boards/${p}/f/${f}`], ['POST', `/api/boards/${p}/cards`, { column: 'went-well', text: 'x' }],
    ['DELETE', `/api/boards/${p}/cards/${c.card.id}`], ['PUT', `/api/boards/${p}/cards/${c.card.id}/vote`],
    ['DELETE', `/api/boards/${p}/cards/${c.card.id}/vote`], ['DELETE', `/api/boards/${p}/f/${f}/cards/${c.card.id}`],
    ['PUT', `/api/boards/${p}/f/${f}/closed`, { closed: true }], ['GET', `/api/boards/${p}/f/${f}/export`],
  ];
  for (const [method, url, body] of cases) {
    const res = await s.call(method, url, body);
    assert.equal(res.status, 404, `${method} ${url}`);
    assert.equal(res.body.error.code, 'board_not_found', `${method} ${url}`);
  }
  for (const url of [`/b/${p}`, `/b/${p}/f/${f}`, `/b/${p}/f/${f}/export`]) assert.equal((await s.call('GET', url)).status, 404, url);
  const after = await getBoard(s, real.p);
  assert.equal(after.body.cards.length, 1);
  assert.equal(after.body.closed, false);
  assert.equal(after.body.cards[0].votes, 0);
}));

test('a wrong facilitator token cannot delete, close or export and changes nothing', () => withServer(async (s) => {
  const { p, f } = await createBoard(s);
  const c = await addCard(s, p, 'went-well', 'keep');
  const bad = [unknown(), f.slice(0, -1), f + 'x', 'short'];
  for (const wf of bad) {
    assert.equal((await s.call('DELETE', `/api/boards/${p}/f/${wf}/cards/${c.card.id}`)).status, 403, wf);
    assert.equal((await setClosed(s, p, wf, true)).status, 403, wf);
    assert.ok([403, 404].includes((await s.call('GET', `/api/boards/${p}/f/${wf}/export`)).status), wf);
  }
  const after = await getBoard(s, p);
  assert.equal(after.body.closed, false);
  assert.equal(after.body.cards.length, 1);
}));

test('a corrupt board file is moved aside on restart while other boards load and the app keeps running', () => withServer(async (s, ctx) => {
  const good = await createBoard(s, 'Good');
  const doomed = await createBoard(s, 'Doomed');
  await addCard(s, good.p, 'actions', 'safe');
  const boards = path.join(s.dataDir, 'boards');
  const hash = crypto.createHash('sha256').update(doomed.p).digest('hex');
  const file = path.join(boards, `${hash}.json`);
  assert.ok(fs.existsSync(file), 'board file is DATA_DIR/boards/<sha256(participantToken) hex>.json');
  await s.stop();
  fs.writeFileSync(file, '{"schema":1, "title": "trunc');
  fs.writeFileSync(path.join(boards, `${hash.slice(0, 8)}.json.tmp-99999`), 'leftover');
  const s2 = await ctx.restart();
  assert.equal((await getBoard(s2, doomed.p)).status, 404);
  assert.equal((await s2.call('GET', `/b/${doomed.p}`)).status, 404);
  const ok = await getBoard(s2, good.p);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.cards[0].text, 'safe');
  const names = fs.readdirSync(boards);
  assert.ok(names.some((n) => n.startsWith(`${hash}.json.corrupt-`)), names.join(','));
  assert.ok(!names.includes(`${hash}.json`));
  assert.ok(!names.some((n) => n.includes('.tmp-')), 'leftover tmp file removed');
  assert.equal((await s2.call('POST', '/api/boards', { title: 'still works' })).status, 201);
  assert.ok(s2.logs().stderr.length > 0, 'a line is written to stderr about the corrupt file');
}));

test('a live server holds a lock on DATA_DIR so a second one exits; a stale lock is taken over', () => withServer(async (s, ctx) => {
  await assert.rejects(startServer({ dataDir: s.dataDir }), /exited early/);
  assert.equal((await getBoard(s, (await createBoard(s)).p)).status, 200);
  await s.stop();
  fs.writeFileSync(path.join(s.dataDir, '.lock'), '2147483000');
  const s2 = await ctx.restart();
  assert.equal((await s2.call('GET', '/')).status, 200);
}));

test('ten parallel votes from one client on ten cards succeed exactly three times', () => withServer(async (s) => {
  const { p } = await createBoard(s);
  const me = newClientId();
  const ids = [];
  for (let i = 0; i < 10; i++) ids.push((await addCard(s, p, 'went-well', `c${i}`, me)).card.id);
  const results = await Promise.all(ids.map((id) => vote(s, p, id, me)));
  assert.equal(results.filter((r) => r.status === 200).length, 3);
  assert.equal(results.filter((r) => r.status === 409 && r.body.error.code === 'no_votes_left').length, 7);
  const board = (await getBoard(s, p, me)).body;
  assert.equal(board.votesLeft, 0);
  assert.equal(board.cards.reduce((n, c) => n + c.votes, 0), 3);
}));

test('the vote budget is per board and per client, and parallel adds all get distinct ids that are never reused', () => withServer(async (s) => {
  const a = await createBoard(s, 'A');
  const b = await createBoard(s, 'B');
  const me = newClientId();
  const ids = [];
  for (let i = 0; i < 3; i++) { const c = await addCard(s, a.p, 'actions', `a${i}`, me); await vote(s, a.p, c.card.id, me); ids.push(c.card.id); }
  assert.equal((await getBoard(s, a.p, me)).body.votesLeft, 0);
  assert.equal((await getBoard(s, b.p, me)).body.votesLeft, 3);
  const cb = await addCard(s, b.p, 'actions', 'b0', me);
  assert.equal((await vote(s, b.p, cb.card.id, me)).status, 200);

  const adds = await Promise.all(Array.from({ length: 30 }, (_, i) => addCard(s, b.p, 'went-well', `p${i}`)));
  assert.ok(adds.every((r) => r.status === 201));
  const all = (await getBoard(s, b.p)).body.cards.map((c) => c.id);
  assert.equal(new Set(all).size, 31);

  const last = all[all.length - 1];
  await s.call('DELETE', `/api/boards/${b.p}/f/${b.f}/cards/${last}`);
  const fresh = await addCard(s, b.p, 'went-well', 'after delete');
  assert.ok(!all.includes(fresh.card.id), 'card ids are never reused');
}));

test('body size is counted in bytes, so 9000 bytes of 3-byte characters is 413 not a title error', () => withServer(async (s) => {
  const res = await s.call('POST', '/api/boards', { title: '€'.repeat(3000) });
  assert.equal(res.status, 413);
  const ok = await s.call('POST', '/api/boards', { title: '€'.repeat(100) });
  assert.equal(ok.status, 201);
}));
