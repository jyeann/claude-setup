// SC1-SC9 over HTTP (the wiki api suite, ported with CONSTELLATION_SAMPLES=off). Acceptance tests are read-only for builders.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  withServer, mk, enc, getNote, putNote, listVault, snapshot, touch, sleep, sha32, READY_RE,
} from './helpers.js';

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const err = (res, status, code) => {
  assert.equal(res.status, status, res.text);
  assert.equal(res.body.error.code, code, res.text);
  assert.equal(typeof res.body.error.message, 'string');
};

// ---------------------------------------------------------------- SC1
test('SC1 starts with one ready line, creates the vault with no notes and serves the HTML shell', () => withServer(async (s) => {
  assert.ok(fs.statSync(s.vault).isDirectory());
  assert.deepEqual(listVault(s.vault), []);
  await sleep(150);
  const lines = s.logs().stdout.split('\n').filter((l) => l !== '');
  assert.equal(lines.length, 1, s.logs().stdout);
  assert.match(lines[0], READY_RE);
  assert.equal(Number(READY_RE.exec(lines[0])[1]), s.port);
  const shell = await s.call('GET', '/');
  assert.equal(shell.status, 200);
  assert.equal(shell.headers['content-type'], 'text/html; charset=utf-8');
  assert.match(shell.text, /<html/i);
  const list = await s.call('GET', '/api/notes');
  assert.equal(list.status, 200);
  assert.deepEqual(list.body, { notes: [] });
}, { create: false }));

test('SC1 creates Welcome, saves text, reads it back and the file holds exactly those bytes', () => withServer(async (s) => {
  const created = await s.call('POST', '/api/notes', { title: 'Welcome' });
  assert.equal(created.status, 201);
  assert.equal(created.body.title, 'Welcome');
  assert.match(created.body.revision, /^[0-9a-f]{32}$/);
  assert.match(created.body.modified, ISO);
  assert.equal(created.headers.location, '/api/notes/Welcome');
  assert.equal(fs.statSync(s.file('Welcome.md')).size, 0, 'default content is 0 bytes');
  assert.equal(created.body.revision, sha32(Buffer.alloc(0)));

  const text = 'Hello sky\n\n[[Ideas]] \u00E9 \u{1F600}\n';
  const put = await putNote(s, 'Welcome', text, created.body.revision);
  assert.equal(put.status, 200);
  assert.equal(put.body.title, 'Welcome');
  assert.equal(put.headers.etag, `"${put.body.revision}"`);
  assert.match(put.body.modified, ISO);

  const got = await getNote(s, 'Welcome');
  assert.equal(got.status, 200);
  assert.equal(got.body.content, text);
  assert.equal(got.body.title, 'Welcome');
  assert.equal(got.headers.etag, `"${got.body.revision}"`);
  assert.equal(got.body.revision, put.body.revision);
  assert.deepEqual(s.read('Welcome.md'), Buffer.from(text, 'utf8'));
  assert.deepEqual(listVault(s.vault), ['Welcome.md']);
}));

test('SC1 create stores the normalised title and exact content, and Location is URI encoded', () => withServer(async (s) => {
  const res = await s.call('POST', '/api/notes', { title: '  Cafe\u0301 & co  ', content: 'line1\r\nline2' });
  assert.equal(res.status, 201);
  assert.equal(res.body.title, 'Caf\u00E9 & co');
  assert.equal(res.headers.location, `/api/notes/${encodeURIComponent('Caf\u00E9 & co')}`);
  assert.deepEqual(listVault(s.vault), ['Caf\u00E9 & co.md']);
  assert.deepEqual(s.read('Caf\u00E9 & co.md'), Buffer.from('line1\r\nline2'));
  assert.equal(res.body.revision, sha32(Buffer.from('line1\r\nline2')));
}));

// ---------------------------------------------------------------- SC2
test('SC2 create Ideas, then a duplicate in any case or padding is 409 title_exists naming the existing title', () => withServer(async (s) => {
  const first = await s.call('POST', '/api/notes', { title: 'Ideas' });
  assert.equal(first.status, 201);
  for (const dup of ['Ideas', 'ideas', 'IDEAS', '  iDeAs  ']) {
    const res = await s.call('POST', '/api/notes', { title: dup, content: 'must not overwrite' });
    err(res, 409, 'title_exists');
    assert.equal(res.body.error.existing, 'Ideas');
    assert.equal(res.body.error.message, 'A note called "Ideas" already exists. Choose another title.');
  }
  assert.deepEqual(listVault(s.vault), ['Ideas.md']);
  assert.equal(s.read('Ideas.md').length, 0);
  const lookup = await getNote(s, 'ideas');
  assert.equal(lookup.status, 200);
  assert.equal(lookup.body.title, 'Ideas', 'stored casing is returned');
}));

// ---------------------------------------------------------------- SC3
test('SC3 backlinks list sources sorted by key with the first matching line as snippet, self excluded, code ignored', () => withServer(async (s) => {
  await mk(s, 'Ideas', 'self link [[Ideas]]');
  await mk(s, 'Zed', 'intro\n  See [[ideas]] here and [[Ideas|my ideas]]  \n[[IDEAS]] later');
  await mk(s, 'alpha', 'x\n[[IDEAS]] first\n[[Ideas]] second');
  await mk(s, 'Coded', '```\n[[Ideas]]\n```\n`[[Ideas]]`');
  await mk(s, 'Other', 'links [[Elsewhere]] and [[../Ideas]] and [[Ideas/x]]');
  const res = await s.call('GET', '/api/notes/ideas/backlinks');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, {
    backlinks: [
      { title: 'alpha', snippet: '[[IDEAS]] first' },
      { title: 'Zed', snippet: 'See [[ideas]] here and [[Ideas|my ideas]]' },
    ],
  });
}));

test('SC3 a backlink disappears after the source note stops linking, and a missing note is 404', () => withServer(async (s) => {
  await mk(s, 'Ideas');
  const a = await mk(s, 'A', 'to [[Ideas]]');
  await mk(s, 'B', 'to [[ideas]]');
  const before = await s.call('GET', '/api/notes/Ideas/backlinks');
  assert.deepEqual(before.body.backlinks.map((b) => b.title), ['A', 'B']);
  assert.equal((await putNote(s, 'A', 'no link now', a.revision)).status, 200);
  const after = await s.call('GET', '/api/notes/Ideas/backlinks');
  assert.deepEqual(after.body.backlinks.map((b) => b.title), ['B']);
  const missing = await s.call('GET', '/api/notes/Nope/backlinks');
  err(missing, 404, 'note_not_found');
  assert.equal(missing.body.error.message, 'Note not found.');
}));

// ---------------------------------------------------------------- SC4
const RENAME_A = 'A [[Ideas]] and [[ideas]] and [[IDEAS|my ideas]] and [[ Ideas | spaced label ]] [[Ideas|]] [[Other]]\n'
  + '```\n[[Ideas]]\n```\n`[[Ideas]]` and [[Ideas]]\nkeep   trailing  \r\n';

test('SC4 rename moves the file and rewrites every case variant and label, but never code', () => withServer(async (s) => {
  await mk(s, 'Ideas', 'self [[ideas]] and [[Ideas|me]]');
  await mk(s, 'A', RENAME_A);
  await mk(s, 'B', 'nothing to see\r\n');
  await mk(s, 'C', '```\n[[Ideas]]\n```\n');
  const bBefore = s.read('B.md');
  const cBefore = s.read('C.md');
  const res = await s.call('POST', '/api/notes/Ideas/rename', { title: 'Thoughts' });
  assert.equal(res.status, 200, res.text);
  assert.equal(res.body.title, 'Thoughts');
  assert.deepEqual(res.body.updated, ['A']);
  assert.deepEqual(res.body.failed, []);
  assert.deepEqual(listVault(s.vault), ['A.md', 'B.md', 'C.md', 'Thoughts.md']);
  assert.equal(s.read('Thoughts.md').toString(), 'self [[Thoughts]] and [[Thoughts|me]]');
  assert.equal(res.body.revision, sha32(s.read('Thoughts.md')), 'revision is of the note after its self-link rewrite');
  assert.equal(
    s.read('A.md').toString(),
    'A [[Thoughts]] and [[Thoughts]] and [[Thoughts|my ideas]] and [[Thoughts| spaced label ]] [[Thoughts|]] [[Other]]\n'
    + '```\n[[Ideas]]\n```\n`[[Ideas]]` and [[Thoughts]]\nkeep   trailing  \r\n',
  );
  assert.deepEqual(s.read('B.md'), bBefore);
  assert.deepEqual(s.read('C.md'), cBefore);
  assert.equal((await getNote(s, 'Ideas')).status, 404);
  assert.equal((await getNote(s, 'thoughts')).body.title, 'Thoughts');
  const back = await s.call('GET', '/api/notes/Thoughts/backlinks');
  assert.deepEqual(back.body.backlinks.map((b) => b.title), ['A']);
}));

test('SC4 rename to an existing title in any case is 409 and every file keeps its bytes', () => withServer(async (s) => {
  await mk(s, 'Ideas', 'self [[Ideas]]');
  await mk(s, 'Other', 'x');
  await mk(s, 'A', RENAME_A);
  const before = snapshot(s.vault);
  for (const target of ['Other', 'other', 'OTHER', ' oTHER ']) {
    const res = await s.call('POST', '/api/notes/Ideas/rename', { title: target });
    err(res, 409, 'title_exists');
    assert.equal(res.body.error.existing, 'Other');
  }
  assert.deepEqual(snapshot(s.vault), before);
  assert.equal((await getNote(s, 'Ideas')).status, 200);
}));

test('SC4 a case-only rename is allowed and rewrites links to the new casing', () => withServer(async (s) => {
  await mk(s, 'Ideas', 'self [[ideas]]');
  await mk(s, 'A', 'see [[Ideas]] and [[ideas|x]]');
  const res = await s.call('POST', '/api/notes/Ideas/rename', { title: 'IDEAS' });
  assert.equal(res.status, 200, res.text);
  assert.equal(res.body.title, 'IDEAS');
  assert.deepEqual(res.body.updated, ['A']);
  assert.deepEqual(listVault(s.vault), ['A.md', 'IDEAS.md']);
  assert.equal(s.read('A.md').toString(), 'see [[IDEAS]] and [[IDEAS|x]]');
  assert.equal(s.read('IDEAS.md').toString(), 'self [[IDEAS]]');
  assert.equal((await s.call('GET', '/api/notes')).body.notes.find((n) => n.title.toLowerCase() === 'ideas').title, 'IDEAS');
}));

test('SC4 renaming to the identical title is a no-op that touches nothing', () => withServer(async (s) => {
  await mk(s, 'Ideas', 'self [[ideas]]');
  await mk(s, 'A', 'see [[ideas]]');
  const before = snapshot(s.vault);
  const mtimes = ['Ideas.md', 'A.md'].map((n) => fs.statSync(s.file(n)).mtimeMs);
  await sleep(30);
  const res = await s.call('POST', '/api/notes/ideas/rename', { title: 'Ideas' });
  assert.equal(res.status, 200, res.text);
  assert.equal(res.body.title, 'Ideas');
  assert.deepEqual(res.body.updated, []);
  assert.deepEqual(snapshot(s.vault), before);
  assert.deepEqual(['Ideas.md', 'A.md'].map((n) => fs.statSync(s.file(n)).mtimeMs), mtimes);
}));

test('SC4 rename checks the source first (404) and then the new title (400)', () => withServer(async (s) => {
  await mk(s, 'Src', 'x');
  err(await s.call('POST', '/api/notes/Missing/rename', { title: 'a/b' }), 404, 'note_not_found');
  err(await s.call('POST', '/api/notes/Src/rename', { title: 'a/b' }), 400, 'title_separator');
  err(await s.call('POST', '/api/notes/Src/rename', { title: '   ' }), 400, 'title_empty');
  assert.deepEqual(listVault(s.vault), ['Src.md']);
}));

// ---------------------------------------------------------------- SC5
const TITLE_CASES = [
  ['', 'title_empty', 'Give the note a title.'],
  ['   \t ', 'title_empty', 'Give the note a title.'],
  ['a'.repeat(201), 'title_too_long', 'Keep the title to 200 characters or fewer. It is 201 now.'],
  ['\u00E9'.repeat(201), 'title_too_long', 'Keep the title to 200 characters or fewer. It is 201 now.'],
  ['\u20AC'.repeat(81), 'title_too_long_bytes', 'This title is too long for a file name. Shorten it.'],
  ['\u00E9'.repeat(121), 'title_too_long_bytes', 'This title is too long for a file name. Shorten it.'],
  ['a\u0001b', 'title_control', 'A title cannot contain control characters.'],
  ['a\u007fb', 'title_control', 'A title cannot contain control characters.'],
  ['a\u0085b', 'title_control', 'A title cannot contain control characters.'],
  ['a\u2028b', 'title_control', 'A title cannot contain control characters.'],
  ['a\u2029b', 'title_control', 'A title cannot contain control characters.'],
  ['a\nb', 'title_control', 'A title cannot contain control characters.'],
  ['../escape', 'title_separator', 'A title cannot contain / or \\.'],
  ['a/b', 'title_separator', 'A title cannot contain / or \\.'],
  ['a\\b', 'title_separator', 'A title cannot contain / or \\.'],
  ['a..b', 'title_dotdot', 'A title cannot contain "..".'],
  ['..', 'title_dotdot', 'A title cannot contain "..".'],
  ['.hidden', 'title_leading_dot', 'A title cannot start with a dot.'],
  ['.', 'title_leading_dot', 'A title cannot start with a dot.'],
  ['.a:', 'title_leading_dot', 'A title cannot start with a dot.'],
  ...[':', '*', '?', '"', '<', '>', '|', '[', ']', '#'].map((c) => [`a${c}b`, 'title_char', 'A title cannot contain : * ? " < > | [ ] or #.']),
  ['what?.', 'title_char', 'A title cannot contain : * ? " < > | [ ] or #.'],
  ['trailing.', 'title_trailing_dot', 'A title cannot end with a dot.'],
  ['CON', 'title_reserved', '"CON" is a reserved name. Choose another title.'],
  ['con.txt', 'title_reserved', '"con" is a reserved name. Choose another title.'],
  ['Nul.a.b', 'title_reserved', '"Nul" is a reserved name. Choose another title.'],
  ['PRN', 'title_reserved', '"PRN" is a reserved name. Choose another title.'],
  ['aux', 'title_reserved', '"aux" is a reserved name. Choose another title.'],
  ['com1', 'title_reserved', '"com1" is a reserved name. Choose another title.'],
  ['LPT9.x', 'title_reserved', '"LPT9" is a reserved name. Choose another title.'],
  [' con ', 'title_reserved', '"con" is a reserved name. Choose another title.'],
];

test('SC5 every title rule gives its code and message when creating a note, and creates no file', () => withServer(async (s) => {
  for (const [title, code, message] of TITLE_CASES) {
    const res = await s.call('POST', '/api/notes', { title });
    assert.equal(res.status, 400, JSON.stringify(title));
    assert.equal(res.body.error.code, code, JSON.stringify(title));
    assert.equal(res.body.error.message, message, JSON.stringify(title));
  }
  assert.deepEqual(listVault(s.vault), []);
  assert.deepEqual(fs.readdirSync(s.base).sort(), ['vault']);
}));

test('SC5 every title rule gives the same code and message when renaming, and the note stays', () => withServer(async (s) => {
  await mk(s, 'Src', 'body');
  for (const [title, code, message] of TITLE_CASES) {
    const res = await s.call('POST', '/api/notes/Src/rename', { title });
    assert.equal(res.status, 400, JSON.stringify(title));
    assert.equal(res.body.error.code, code, JSON.stringify(title));
    assert.equal(res.body.error.message, message, JSON.stringify(title));
  }
  assert.deepEqual(listVault(s.vault), ['Src.md']);
  assert.equal(s.read('Src.md').toString(), 'body');
}));

test('SC5 titles at the limits are accepted: 200 characters, 240 bytes, COM0, CONSOLE, inner dots', () => withServer(async (s) => {
  for (const title of ['a'.repeat(200), '\u20AC'.repeat(80), 'COM0', 'CONSOLE', 'v1.2 notes', 'a-b_c (d) & e!', '\u65E5\u672C\u8A9E']) {
    const res = await s.call('POST', '/api/notes', { title });
    assert.equal(res.status, 201, `${title.slice(0, 20)}: ${res.text}`);
    assert.equal(res.body.title, title);
    assert.ok(fs.existsSync(s.file(`${title}.md`)));
  }
}));

// ---------------------------------------------------------------- SC6 (API side)
test('SC6 hostile content is stored and returned byte for byte as JSON data', () => withServer(async (s) => {
  const hostile = [
    '<script>alert(1)</script><img src=x onerror=alert(1)>',
    '"><svg/onload=alert(1)> javascript:alert(1) [x](javascript:alert(1))',
    '</textarea><iframe src="//evil"></iframe>\u0000\u0007 \u2028 \u{1F600} \u202E RTL',
    '{"__proto__":{"x":1}} \\u003cscript\\u003e ${process.exit()} `; DROP TABLE notes; --',
  ];
  const created = await mk(s, "O'Brien & Sons");
  let revision = created.revision;
  for (const content of hostile) {
    const put = await putNote(s, "O'Brien & Sons", content, revision);
    assert.equal(put.status, 200, put.text);
    revision = put.body.revision;
    const got = await getNote(s, "O'Brien & Sons");
    assert.equal(got.headers['content-type'], 'application/json; charset=utf-8');
    assert.equal(got.body.content, content);
    assert.equal(got.body.title, "O'Brien & Sons");
    assert.deepEqual(s.read("O'Brien & Sons.md"), Buffer.from(content, 'utf8'));
    assert.equal(got.body.revision, sha32(Buffer.from(content, 'utf8')));
  }
  const hostileTitle = await s.call('POST', '/api/notes', { title: '<img src=x onerror=alert(1)>' });
  err(hostileTitle, 400, 'title_char');
  const listed = await s.call('GET', '/api/notes');
  assert.deepEqual(listed.body.notes.map((n) => n.title), ["O'Brien & Sons"]);
}));

// ---------------------------------------------------------------- SC7
test('SC7 PUT without If-Match is 428 and changes nothing', () => withServer(async (s) => {
  await mk(s, 'Doc', 'v1');
  const res = await s.call('PUT', '/api/notes/Doc', { content: 'v2' });
  err(res, 428, 'revision_required');
  assert.equal(s.read('Doc.md').toString(), 'v1');
}));

test('SC7 a second writer holding a stale revision gets 412 with currentRevision and the file is untouched', () => withServer(async (s) => {
  await mk(s, 'Doc', 'v1');
  const r1 = (await getNote(s, 'Doc')).body.revision;
  const a = await putNote(s, 'Doc', 'from A', r1);
  assert.equal(a.status, 200);
  const b = await putNote(s, 'Doc', 'from B', r1);
  err(b, 412, 'conflict');
  assert.equal(b.body.error.message, 'This note changed since you opened it.');
  assert.equal(b.body.error.currentRevision, a.body.revision);
  assert.equal(s.read('Doc.md').toString(), 'from A');
  const again = await putNote(s, 'Doc', 'from B', b.body.error.currentRevision);
  assert.equal(again.status, 200);
  assert.equal(s.read('Doc.md').toString(), 'from B');
}));

test('SC7 an outside edit after the GET makes the next PUT a 412 and the outside bytes stay', () => withServer(async (s) => {
  await mk(s, 'Doc', 'v1');
  const r1 = (await getNote(s, 'Doc')).body.revision;
  fs.appendFileSync(s.file('Doc.md'), ' edited elsewhere');
  const outside = s.read('Doc.md');
  const res = await putNote(s, 'Doc', 'my text', r1);
  err(res, 412, 'conflict');
  assert.equal(res.body.error.currentRevision, sha32(outside));
  assert.deepEqual(s.read('Doc.md'), outside);
  const fresh = await getNote(s, 'Doc');
  assert.equal(fresh.body.content, 'v1 edited elsewhere');
}));

test('SC7 the revision is the first 32 hex of the sha256 of the bytes, also on a no-change save', () => withServer(async (s) => {
  const content = 'caf\u00E9 \u{1F600}\r\n';
  const created = await mk(s, 'Doc', content);
  assert.equal(created.revision, sha32(Buffer.from(content)));
  const put = await putNote(s, 'Doc', content, created.revision);
  assert.equal(put.status, 200);
  assert.equal(put.body.revision, created.revision);
  assert.equal(put.headers.etag, `"${created.revision}"`);
  const other = await putNote(s, 'Doc', 'different', created.revision);
  assert.equal(other.body.revision, sha32(Buffer.from('different')));
}));

test('SC7 If-Match forms other than the quoted revision count as a mismatch (412) and If-None-Match is ignored', () => withServer(async (s) => {
  const { revision } = await mk(s, 'Doc', 'v1');
  for (const value of ['*', `W/"${revision}"`, 'stale', `"${'0'.repeat(32)}"`]) {
    const res = await s.call('PUT', '/api/notes/Doc', { content: 'x' }, { headers: { 'if-match': value } });
    err(res, 412, 'conflict');
    assert.equal(res.body.error.currentRevision, revision, value);
  }
  assert.equal(s.read('Doc.md').toString(), 'v1');
  const ok = await s.call('PUT', '/api/notes/Doc', { content: 'v2' }, { headers: { 'if-match': `"${revision}"`, 'if-none-match': '*' } });
  assert.equal(ok.status, 200);
  const get = await s.call('GET', '/api/notes/Doc', undefined, { headers: { 'if-none-match': `"${ok.body.revision}"` } });
  assert.equal(get.status, 200, 'no conditional GET');
  assert.equal(get.body.content, 'v2');
}));

test('SC7 PUT on a missing note is 404 and PUT over 2 MiB of content is 413 note_too_large with the file intact', () => withServer(async (s) => {
  err(await putNote(s, 'Missing', 'x', '0'.repeat(32)), 404, 'note_not_found');
  const { revision } = await mk(s, 'Doc', 'v1');
  const big = await putNote(s, 'Doc', 'a'.repeat(2097152 + 1), revision);
  err(big, 413, 'note_too_large');
  assert.equal(s.read('Doc.md').toString(), 'v1');
  const edge = await putNote(s, 'Doc', 'a'.repeat(2097152), revision);
  assert.equal(edge.status, 200, 'exactly 2 MiB is allowed');
  assert.equal(s.read('Doc.md').length, 2097152);
  const createBig = await s.call('POST', '/api/notes', { title: 'Big', content: '\u20AC'.repeat(699051) });
  err(createBig, 413, 'note_too_large');
  assert.ok(!fs.existsSync(s.file('Big.md')));
}));

test('SC7 DELETE answers 204 with no body, removes only that file, and honours If-Match only when sent', () => withServer(async (s) => {
  const a = await mk(s, 'Doomed', 'bye');
  await mk(s, 'Keeper', 'stay');
  await mk(s, 'Second', 'stay too');
  err(await s.call('DELETE', '/api/notes/Doomed', undefined, { headers: { 'if-match': '"nope"' } }), 412, 'conflict');
  err(await s.call('DELETE', '/api/notes/Doomed', undefined, { headers: { 'if-match': '*' } }), 412, 'conflict');
  assert.ok(fs.existsSync(s.file('Doomed.md')));
  const ok = await s.call('DELETE', '/api/notes/doomed', undefined, { headers: { 'if-match': `"${a.revision}"` } });
  assert.equal(ok.status, 204);
  assert.equal(ok.text, '');
  assert.deepEqual(listVault(s.vault), ['Keeper.md', 'Second.md']);
  const plain = await s.call('DELETE', '/api/notes/Second');
  assert.equal(plain.status, 204);
  assert.deepEqual(listVault(s.vault), ['Keeper.md']);
  err(await s.call('DELETE', '/api/notes/Second'), 404, 'note_not_found');
  assert.equal(s.read('Keeper.md').toString(), 'stay');
}));

// ---------------------------------------------------------------- SC8
const searchVault = (vault) => {
  const now = Date.now();
  const put = (name, body, ago) => {
    fs.writeFileSync(path.join(vault, `${name}.md`), body);
    const t = new Date(now - ago * 1000);
    fs.utimesSync(path.join(vault, `${name}.md`), t, t);
  };
  put('Quarterly Plan', 'nothing relevant', 500);
  put('Quarterly notes', 'z'.repeat(300), 100);
  put('Alpha', 'The QUARTERLY review and the quarterly numbers', 50);
  put('Gamma', `${'x'.repeat(200)}quarterly${'y'.repeat(200)}`, 400);
  put('Beta', 'a <b>bold</b> claim and abc', 10);
  put('Zeta', 'Quarterly tail', 400);
};

test('SC8 search is case-insensitive, orders title matches first, then modified desc, then key, and total equals the result count', () => withServer(async (s) => {
  const res = await s.call('GET', '/api/search?q=QuArTerLy');
  assert.equal(res.status, 200);
  assert.equal(res.body.query, 'QuArTerLy');
  assert.equal(res.body.total, res.body.results.length);
  assert.deepEqual(res.body.results.map((r) => r.title), ['Quarterly notes', 'Quarterly Plan', 'Alpha', 'Gamma', 'Zeta']);
  assert.deepEqual(res.body.results.map((r) => r.titleMatch), [true, true, false, false, false]);
  for (const r of res.body.results) {
    assert.match(r.modified, ISO);
    assert.equal(typeof r.snippet, 'string');
    assert.ok(Array.isArray(r.ranges));
  }
}, { setup: searchVault }));

test('SC8 snippets and ranges follow the window rule and every range is the query text', () => withServer(async (s) => {
  const res = await s.call('GET', '/api/search?q=quarterly');
  const by = Object.fromEntries(res.body.results.map((r) => [r.title, r]));
  // short body: the whole body, every non-overlapping match, no ellipsis
  const body = 'The QUARTERLY review and the quarterly numbers';
  const want = [];
  for (let i = body.toLowerCase().indexOf('quarterly'); i !== -1; i = body.toLowerCase().indexOf('quarterly', i + 9)) want.push([i, i + 9]);
  assert.equal(by.Alpha.snippet, body);
  assert.deepEqual(by.Alpha.ranges, want);
  // long body: 120 units around the first match, prefix and suffix, ranges index the snippet including the 3-char prefix
  const g = `${'x'.repeat(200)}quarterly${'y'.repeat(200)}`;
  assert.equal(by.Gamma.snippet, `...${g.slice(145, 265)}...`);
  assert.deepEqual(by.Gamma.ranges, [[58, 67]]);
  // match near the start has no prefix; near the end no suffix
  assert.equal(by.Zeta.snippet, 'Quarterly tail');
  assert.deepEqual(by.Zeta.ranges, [[0, 9]]);
  for (const r of res.body.results.filter((x) => !x.titleMatch)) {
    assert.ok(r.snippet.replace(/^\.\.\./, '').replace(/\.\.\.$/, '').length <= 120, r.title);
    let prevEnd = 0;
    assert.ok(r.ranges.length >= 1);
    for (const [st, en] of r.ranges) {
      assert.ok(st >= prevEnd && en > st && en <= r.snippet.length, `${r.title} ${st},${en}`);
      assert.equal(r.snippet.slice(st, en).toLowerCase(), 'quarterly');
      prevEnd = en;
    }
  }
  // title-only match: first 120 units of the body, plus ... when cut; no ranges
  assert.equal(by['Quarterly notes'].snippet, `${'z'.repeat(120)}...`);
  assert.deepEqual(by['Quarterly notes'].ranges, []);
  assert.equal(by['Quarterly Plan'].snippet, 'nothing relevant');
  assert.deepEqual(by['Quarterly Plan'].ranges, []);
}, { setup: searchVault }));

test('SC8 matching is literal: <b> comes back as text and regex syntax matches nothing special', () => withServer(async (s) => {
  const lit = await s.call('GET', `/api/search?q=${encodeURIComponent('<b>')}`);
  assert.equal(lit.status, 200);
  assert.deepEqual(lit.body.results.map((r) => r.title), ['Beta']);
  const r = lit.body.results[0];
  assert.equal(r.snippet, 'a <b>bold</b> claim and abc');
  assert.deepEqual(r.ranges, [[2, 5]]);
  for (const q of ['a.c', '.*', '(', '[a-z]+', '\\', 'a|b', '^a', '$']) {
    const res = await s.call('GET', `/api/search?q=${encodeURIComponent(q)}`);
    assert.equal(res.status, 200, q);
    assert.deepEqual(res.body.results, [], q);
    assert.equal(res.body.total, 0);
  }
}, { setup: searchVault }));

test('SC8 empty or blank q returns an empty result, a missing q or a q over 200 characters is 400 bad_request', () => withServer(async (s) => {
  for (const q of ['', '%20%20', '%09']) {
    const res = await s.call('GET', `/api/search?q=${q}`);
    assert.equal(res.status, 200, q);
    assert.deepEqual(res.body, { query: '', total: 0, results: [] });
  }
  err(await s.call('GET', '/api/search'), 400, 'bad_request');
  err(await s.call('GET', '/api/search?other=1'), 400, 'bad_request');
  err(await s.call('GET', `/api/search?q=${'a'.repeat(201)}`), 400, 'bad_request');
  assert.equal((await s.call('GET', `/api/search?q=${'a'.repeat(200)}`)).status, 200);
  assert.equal((await s.call('GET', `/api/search?q=%20${'a'.repeat(200)}%20`)).status, 200, 'length is counted after trim');
  const echoed = await s.call('GET', '/api/search?q=%20Hello%20');
  assert.equal(echoed.body.query, 'Hello');
}, { setup: searchVault }));

test('SC8 search reflects notes created, edited and deleted through the API', () => withServer(async (s) => {
  assert.equal((await s.call('GET', '/api/search?q=needle')).body.total, 0);
  const n = await mk(s, 'Findme', 'a needle in text');
  const hit = await s.call('GET', '/api/search?q=NEEDLE');
  assert.deepEqual(hit.body.results.map((r) => r.title), ['Findme']);
  await putNote(s, 'Findme', 'gone', n.revision);
  assert.equal((await s.call('GET', '/api/search?q=needle')).body.total, 0);
  const byTitle = await s.call('GET', '/api/search?q=FINDME');
  assert.equal(byTitle.body.results[0].titleMatch, true);
  await s.call('DELETE', '/api/notes/Findme');
  assert.equal((await s.call('GET', '/api/search?q=findme')).body.total, 0);
}));

// ---------------------------------------------------------------- SC9
test('SC9 graph for the ux check-19 vault: 4 nodes, edges A-B and A-C only, D is the orphan', () => withServer(async (s) => {
  const res = await s.call('GET', '/api/graph');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, {
    nodes: [
      { title: 'A', orphan: false }, { title: 'B', orphan: false },
      { title: 'C', orphan: false }, { title: 'D', orphan: true },
    ],
    edges: [['A', 'B'], ['A', 'C']],
  });
}, { setup: (v) => {
  fs.writeFileSync(path.join(v, 'A.md'), '[[B]] [[C]] [[A]]');
  fs.writeFileSync(path.join(v, 'B.md'), '[[a]]');
  fs.writeFileSync(path.join(v, 'C.md'), 'leaf');
  fs.writeFileSync(path.join(v, 'D.md'), 'alone');
} }));

test('SC9 graph ignores missing, invalid and code links, uses stored casing and key order, and an empty vault is empty', () => withServer(async (s) => {
  assert.deepEqual((await s.call('GET', '/api/graph')).body, { nodes: [], edges: [] });
  await mk(s, 'beta', 'to [[Alpha]] and [[Ghost]] and [[../x]] and [[ ]]');
  await mk(s, 'Alpha', '`[[beta]]`');
  await mk(s, 'Zed', '```\n[[Alpha]]\n```');
  await mk(s, 'Solo', '[[solo]]');
  await mk(s, 'Mid', '[[ZED|label]]');
  const res = await s.call('GET', '/api/graph');
  assert.deepEqual(res.body.nodes, [
    { title: 'Alpha', orphan: false }, { title: 'beta', orphan: false }, { title: 'Mid', orphan: false },
    { title: 'Solo', orphan: true }, { title: 'Zed', orphan: false },
  ]);
  assert.deepEqual(res.body.edges, [['Alpha', 'beta'], ['Mid', 'Zed']]);
}));
