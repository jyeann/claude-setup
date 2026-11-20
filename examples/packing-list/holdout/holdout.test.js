'use strict';
// Hidden acceptance tests. HTTP-level, black-box. Every expected value cites its source line.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { startServer, withServer, tmpDataDir, freePort, createList, addItem, setTicked, removeItem, getList } = require('./helpers');

const T = { timeout: 90000 };
const EMOJI = '\u{1F600}';
const ERR = (code, message) => ({ error: { code, message } });
const allow = (res) => String(res.headers.allow || '').split(',').map((x) => x.trim()).filter(Boolean).sort();
const SIX_HEADERS = {
  'x-content-type-options': 'nosniff', // design.md:69
  'x-frame-options': 'DENY', // design.md:69
  'referrer-policy': 'no-referrer', // design.md:69
  'cache-control': 'no-store', // design.md:69
};

test('trip name: 80 characters accepted, 81 refused, surrounding whitespace trimmed and inner spaces kept', T, () => withServer(async (s) => {
  const ok = await s.call('POST', '/api/lists', { name: 'a'.repeat(80) });
  assert.equal(ok.status, 201); // design.md:105
  const padded = await s.call('POST', '/api/lists', { name: `   ${'b'.repeat(80)}   ` });
  assert.equal(padded.status, 201); // design.md:24 (length is counted after trim)
  assert.equal(padded.body.name, 'b'.repeat(80)); // design.md:24 (stored value is the trimmed string)
  const over = await s.call('POST', '/api/lists', { name: `  ${'c'.repeat(81)}  ` });
  assert.equal(over.status, 400); // design.md:105
  assert.deepEqual(over.body, ERR('name_too_long', 'Trip name is too long (81 characters). The limit is 80.')); // design.md:39 (N counted after trim)
  const inner = await s.call('POST', '/api/lists', { name: '  Ski  trip  ' });
  assert.equal(inner.body.name, 'Ski  trip'); // design.md:24 (whitespace inside is kept as typed)
}));

test('trip name: emoji count as one character each (80 accepted, 81 refused with N=81)', T, () => withServer(async (s) => {
  const ok = await s.call('POST', '/api/lists', { name: EMOJI.repeat(80) });
  assert.equal(ok.status, 201); // design.md:24 (length in code points, 80 allowed)
  assert.equal([...ok.body.name].length, 80); // design.md:24
  assert.equal((await getList(s, ok.body.id)).body.name, EMOJI.repeat(80)); // design.md:24 (stored as typed)
  const over = await s.call('POST', '/api/lists', { name: EMOJI.repeat(81) });
  assert.equal(over.status, 400); // design.md:105
  assert.deepEqual(over.body, ERR('name_too_long', 'Trip name is too long (81 characters). The limit is 80.')); // design.md:39
}));

test('trip name: control characters U+0000-U+001F and U+007F-U+009F are refused with name_invalid', T, () => withServer(async (s) => {
  const bad = ['\u0000', '\u0001', '\t', '\n', '\u001f', '\u007f', '\u0080', '\u0085', '\u009f'];
  for (const c of bad) {
    const res = await s.call('POST', '/api/lists', { name: `a${c}b` });
    assert.equal(res.status, 400, JSON.stringify(c)); // design.md:106
    assert.deepEqual(res.body, ERR('name_invalid', 'Trip name contains characters that are not allowed.'), JSON.stringify(c)); // design.md:41
  }
  const edge = await s.call('POST', '/api/lists', { name: 'a b¡' });
  assert.equal(edge.status, 201); // design.md:24 (range ends at U+009F, so U+00A0 and U+00A1 inside are fine)
}));

test('item text: emoji count as one character each (120 accepted, 121 refused with N=121)', T, () => withServer(async (s) => {
  const { id } = await createList(s);
  const ok = await addItem(s, id, EMOJI.repeat(120));
  assert.equal(ok.status, 201); // design.md:113 (120 accepted, counted in code points)
  assert.equal([...ok.item.text].length, 120); // design.md:24
  const over = await addItem(s, id, `  ${EMOJI.repeat(121)}  `);
  assert.equal(over.status, 400); // design.md:113
  assert.deepEqual(over.body, ERR('item_too_long', 'Item is too long (121 characters). The limit is 120.')); // design.md:40 (N counted after trim)
  assert.equal((await getList(s, id)).body.items.length, 1); // design.md:113 (refused item is not added)
}));

test('item text: control characters, whitespace-only and non-string values are refused', T, () => withServer(async (s) => {
  const { id } = await createList(s);
  for (const c of ['\u0000', '\u001f', '\t', '\r', '\u007f', '\u0085', '\u009f']) {
    const res = await addItem(s, id, `x${c}y`);
    assert.equal(res.status, 400, JSON.stringify(c)); // design.md:106
    assert.deepEqual(res.body, ERR('item_invalid', 'Item contains characters that are not allowed.'), JSON.stringify(c)); // design.md:41
  }
  const blank = await addItem(s, id, ' \t\n\r  ');
  assert.equal(blank.status, 400); // design.md:25 (trim happens before the empty check)
  assert.deepEqual(blank.body, ERR('item_empty', 'Enter an item to add.')); // design.md:40
  for (const text of [123, null, true, ['a']]) {
    const res = await s.call('POST', `/api/lists/${id}/items`, { text });
    assert.equal(res.status, 400, JSON.stringify(text)); // design.md:28 (field of the wrong type)
    assert.deepEqual(res.body, ERR('invalid_body', 'Request body is not valid.'), JSON.stringify(text)); // design.md:43
  }
  assert.equal((await getList(s, id)).body.items.length, 0); // design.md:109 R24 (nothing was added)
}));

test('validation order: length is checked before control characters', T, () => withServer(async (s) => {
  const name = await s.call('POST', '/api/lists', { name: `${'a'.repeat(80)}\u0001` });
  assert.equal(name.status, 400); // design.md:25
  assert.deepEqual(name.body, ERR('name_too_long', 'Trip name is too long (81 characters). The limit is 80.')); // design.md:25 (length -> control chars), design.md:39
  const { id } = await createList(s);
  const item = await addItem(s, id, `${'a'.repeat(120)}\u0001`);
  assert.deepEqual(item.body, ERR('item_too_long', 'Item is too long (121 characters). The limit is 120.')); // design.md:25, design.md:40
}));

test('a list takes 200 items and refuses the 201st with list_full; list_full is checked last', T, () => withServer(async (s) => {
  const { id } = await createList(s);
  for (let i = 1; i <= 200; i += 1) {
    const res = await addItem(s, id, `item ${i}`);
    assert.equal(res.status, 201, `item ${i}`); // design.md:114 (up to 200 allowed)
  }
  const full = await addItem(s, id, 'one too many');
  assert.equal(full.status, 409); // design.md:34
  assert.deepEqual(full.body, ERR('list_full', 'This list is full (200 items)')); // design.md:40
  assert.equal((await getList(s, id)).body.items.length, 200); // design.md:114 (count stays 200)
  const empty = await addItem(s, id, '  ');
  assert.equal(empty.body.error.code, 'item_empty'); // design.md:25 (list full is checked last)
  const ctrl = await addItem(s, id, 'x\u0001');
  assert.equal(ctrl.body.error.code, 'item_invalid'); // design.md:25
  const view = (await getList(s, id)).body;
  const gone = await removeItem(s, id, view.items[0].id);
  assert.equal(gone.status, 200); // design.md:119
  const again = await addItem(s, id, 'fits now');
  assert.equal(again.status, 201); // design.md:114 (only a full list refuses)
  assert.equal(again.item.id, '201'); // design.md:21 (nextItemId counts every add, never reused)
}));

test('item ids are never reused after removal, even for the last item', T, () => withServer(async (s) => {
  const { id } = await createList(s);
  const a = await addItem(s, id, 'a');
  const b = await addItem(s, id, 'b');
  assert.equal(a.item.id, '1'); // design.md:21 (starts at "1")
  assert.equal(b.item.id, '2'); // design.md:21
  await removeItem(s, id, b.item.id);
  const c = await addItem(s, id, 'c');
  assert.equal(c.item.id, '3'); // design.md:21 (never reused within a list)
  await removeItem(s, id, a.item.id);
  const d = await addItem(s, id, 'd');
  assert.equal(d.item.id, '4'); // design.md:21
}));

test('removal keeps the other items in their order, new items go last, ticking moves nothing', T, () => withServer(async (s) => {
  const { id } = await createList(s);
  const items = [];
  for (const t of ['one', 'two', 'three', 'four']) items.push((await addItem(s, id, t)).item);
  await setTicked(s, id, items[3].id, true);
  const removed = await removeItem(s, id, items[1].id);
  assert.deepEqual(removed.body.items.map((i) => i.text), ['one', 'three', 'four']); // design.md:22
  await addItem(s, id, 'five');
  await setTicked(s, id, items[0].id, true);
  assert.deepEqual((await getList(s, id)).body.items.map((i) => i.text), ['one', 'three', 'four', 'five']); // design.md:22
}));

test('ticked must be a JSON boolean: strings, numbers, null, missing and non-objects give invalid_body', T, () => withServer(async (s) => {
  const { id } = await createList(s);
  const { item } = await addItem(s, id, 'Passport');
  const url = `/api/lists/${id}/items/${item.id}/ticked`;
  for (const body of [{ ticked: 'true' }, { ticked: 'false' }, { ticked: 1 }, { ticked: 0 }, { ticked: null }, {}, { ticked: [] }, [true]]) {
    const res = await s.call('PUT', url, body);
    assert.equal(res.status, 400, JSON.stringify(body)); // design.md:35
    assert.deepEqual(res.body, ERR('invalid_body', 'Request body is not valid.'), JSON.stringify(body)); // design.md:43
  }
  assert.equal((await getList(s, id)).body.items[0].ticked, false); // design.md:118 R29 (no change on refusal)
}));

test('setting ticked to its current value is a 200 no-op, repeated or not', T, () => withServer(async (s) => {
  const { id } = await createList(s);
  const a = await addItem(s, id, 'A');
  await addItem(s, id, 'B');
  const first = await setTicked(s, id, a.item.id, true);
  const second = await setTicked(s, id, a.item.id, true);
  assert.equal(first.status, 200); // design.md:47
  assert.equal(second.status, 200); // design.md:47
  assert.deepEqual(second.body, first.body); // design.md:47 (no change)
  const off = await setTicked(s, id, a.item.id, false);
  const offAgain = await setTicked(s, id, a.item.id, false);
  assert.equal(offAgain.status, 200); // design.md:47
  assert.deepEqual(offAgain.body, off.body); // design.md:47
  assert.deepEqual(offAgain.body.items.map((i) => i.ticked), [false, false]); // design.md:117 R28
}));

test('unsupported methods give 405 method_not_allowed with the route Allow header, OPTIONS included', T, () => withServer(async (s) => {
  const { id } = await createList(s);
  const { item } = await addItem(s, id, 'x');
  const cases = [
    ['GET', '/api/lists', ['POST']],
    ['PUT', '/api/lists', ['POST']],
    ['OPTIONS', '/api/lists', ['POST']],
    ['DELETE', `/api/lists/${id}`, ['GET']],
    ['POST', `/api/lists/${id}`, ['GET']],
    ['GET', `/api/lists/${id}/items`, ['POST']],
    ['GET', `/api/lists/${id}/items/${item.id}/ticked`, ['PUT']],
    ['POST', `/api/lists/${id}/items/${item.id}/ticked`, ['PUT']],
    ['GET', `/api/lists/${id}/items/${item.id}`, ['DELETE']],
    ['POST', '/', ['GET', 'HEAD']],
    ['DELETE', `/l/${id}`, ['GET', 'HEAD']],
    ['POST', '/assets/app.css', ['GET', 'HEAD']],
  ];
  for (const [method, p, expected] of cases) {
    const res = await s.call(method, p);
    assert.equal(res.status, 405, `${method} ${p}`); // design.md:52
    assert.deepEqual(allow(res), expected.sort(), `${method} ${p}`); // design.md:52
    assert.deepEqual(res.body, ERR('method_not_allowed', 'Method not allowed.'), `${method} ${p}`); // design.md:44
  }
}));

test('unknown /api paths give 404 not_found as JSON', T, () => withServer(async (s) => {
  const { id } = await createList(s);
  for (const [method, p] of [['GET', '/api/nothing'], ['POST', '/api/nothing'], ['GET', `/api/lists/${id}/nothing`], ['GET', '/api/v2/lists']]) {
    const res = await s.call(method, p, method === 'POST' ? {} : undefined);
    assert.equal(res.status, 404, `${method} ${p}`); // design.md:44
    assert.deepEqual(res.body, ERR('not_found', 'Not found.'), `${method} ${p}`); // design.md:44
    assert.match(res.headers['content-type'], /^application\/json/, `${method} ${p}`); // design.md:28
  }
}));

test('a body over 4096 bytes gives 413 body_too_large and changes nothing; exactly 4096 bytes is read', T, () => withServer(async (s) => {
  const { id } = await createList(s);
  const big = await s.call('POST', `/api/lists/${id}/items`, { text: 'a'.repeat(5000) });
  assert.equal(big.status, 413); // design.md:28
  assert.deepEqual(big.body, ERR('body_too_large', 'Request body is too large.')); // design.md:43
  const justOver = await s.call('POST', '/api/lists', undefined, { raw: `{"name":"${'n'.repeat(4097 - 11)}"}` });
  assert.equal(Buffer.byteLength(`{"name":"${'n'.repeat(4097 - 11)}"}`), 4097);
  assert.equal(justOver.status, 413); // design.md:28 (over 4096 gives 413)
  const exact = `{"text":"${'a'.repeat(4096 - 11)}"}`;
  assert.equal(Buffer.byteLength(exact), 4096);
  const atCap = await s.call('POST', `/api/lists/${id}/items`, undefined, { raw: exact });
  assert.equal(atCap.status, 400); // design.md:28 (4096 is not over the cap, so it is parsed and the text is too long)
  assert.equal(atCap.body.error.code, 'item_too_long'); // design.md:40 (4085 characters)
  assert.equal(atCap.body.error.message, 'Item is too long (4085 characters). The limit is 120.'); // design.md:40
  assert.equal((await getList(s, id)).body.items.length, 0); // design.md:109 R20 (nothing changed)
}));

test('POST and PUT need Content-Type application/json: other or missing types give 415', T, () => withServer(async (s) => {
  const { id } = await createList(s);
  const { item } = await addItem(s, id, 'x');
  const msg = ERR('bad_content_type', 'Content-Type must be application/json.'); // design.md:43
  const text = await s.call('POST', '/api/lists', { name: 'Trip' }, { headers: { 'content-type': 'text/plain' } });
  assert.equal(text.status, 415); // design.md:28
  assert.deepEqual(text.body, msg);
  const none = await s.call('POST', `/api/lists/${id}/items`, { text: 'y' }, { headers: { 'content-type': null } });
  assert.equal(none.status, 415); // design.md:28
  const form = await s.call('PUT', `/api/lists/${id}/items/${item.id}/ticked`, { ticked: true }, { headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  assert.equal(form.status, 415); // design.md:28
  assert.equal((await getList(s, id)).body.items.length, 1); // design.md:108 R19 (nothing changed)
  const charset = await s.call('POST', '/api/lists', { name: 'Trip' }, { headers: { 'content-type': 'application/json; charset=utf-8' } });
  assert.equal(charset.status, 201); // design.md:28 (parameters allowed)
}));

test('an Origin whose host differs from Host gives 403 forbidden; so does a foreign Host on loopback', T, () => withServer(async (s) => {
  const forbidden = ERR('forbidden', 'Forbidden.'); // design.md:44
  const evilOrigin = await s.call('POST', '/api/lists', { name: 'Trip' }, { headers: { origin: 'http://evil.example' } });
  assert.equal(evilOrigin.status, 403); // design.md:72
  assert.deepEqual(evilOrigin.body, forbidden);
  const evilHost = await s.call('GET', '/', undefined, { headers: { host: 'evil.example' } });
  assert.equal(evilHost.status, 403); // design.md:72 (DNS rebinding)
  const evilHostApi = await s.call('GET', `/api/lists/${'A'.repeat(22)}`, undefined, { headers: { host: `evil.example:${s.port}` } });
  assert.equal(evilHostApi.status, 403); // design.md:72
  const sameOrigin = await s.call('POST', '/api/lists', { name: 'Trip' }, { headers: { origin: `http://127.0.0.1:${s.port}` } });
  assert.equal(sameOrigin.status, 201); // design.md:72 (Origin host equals Host)
  for (const host of [`localhost:${s.port}`, `127.0.0.1:${s.port}`, `[::1]:${s.port}`, '127.0.0.1']) {
    const res = await s.call('GET', '/', undefined, { headers: { host } });
    assert.equal(res.status, 200, host); // design.md:72 (localhost, 127.0.0.1, [::1], any port)
  }
}));

test('path traversal attempts never return files outside the allowlist', T, () => withServer(async (s) => {
  const paths = [
    '/assets/../src/server.js', '/assets/%2e%2e/src/server.js', '/assets/..%2fsrc%2fserver.js', '/assets/%2e%2e%2fpackage.json',
    '/assets/js/../../package.json', '/assets/..%5csrc%5cserver.js', '/%2e%2e/package.json', '/src/server.js', '/package.json', '/assets//etc/passwd',
  ];
  for (const p of paths) {
    const res = await s.call('GET', p);
    assert.equal(res.status, 404, p); // design.md:97 R8
    assert.doesNotMatch(res.text, /require\(|createServer|"scripts"/, p); // design.md:97 (no file content outside the allowlist)
  }
}));

test('a malformed list id behaves exactly like an unknown one', T, () => withServer(async (s) => {
  const unknown = await getList(s, 'Z'.repeat(22));
  assert.equal(unknown.status, 404); // design.md:110 R21
  for (const bad of ['abc', 'A'.repeat(21), 'A'.repeat(23), `${'A'.repeat(21)}!`, '0', 'A'.repeat(64)]) {
    const get = await getList(s, bad);
    assert.equal(get.status, 404, bad); // design.md:110 R21
    assert.deepEqual(get.body, unknown.body, bad); // design.md:28 (malformed and unknown behave identically)
    const add = await addItem(s, bad, 'x');
    assert.equal(add.status, 404, bad); // design.md:28
    assert.equal(add.body.error.code, 'list_not_found', bad); // design.md:34
  }
}));

test('a malformed or unknown item id on PUT and DELETE gives 404 item_not_found', T, () => withServer(async (s) => {
  const { id } = await createList(s);
  await addItem(s, id, 'x');
  for (const bad of ['abc', '0', '01', '-1', '1.5', '12345678901', '2']) {
    const put = await setTicked(s, id, bad, true);
    assert.equal(put.status, 404, bad); // design.md:120 R31 (regex at design.md:21)
    assert.deepEqual(put.body, ERR('item_not_found', 'That item was removed.'), bad); // design.md:42
    const del = await removeItem(s, id, bad);
    assert.equal(del.status, 404, bad); // design.md:120 R31
    assert.equal(del.body.error.code, 'item_not_found', bad); // design.md:36
  }
  assert.equal((await getList(s, id)).body.items.length, 1); // design.md:120 (nothing removed)
}));

test('a corrupt or wrong-shaped data file is moved aside to <file>.corrupt-<epochms> and the app starts empty', T, async () => {
  for (const content of ['{ this is not json', '{"schema":2,"lists":{}}']) {
    const dir = tmpDataDir();
    const file = path.join(dir, 'lists.json');
    fs.writeFileSync(file, content);
    const s = await startServer({ dataDir: dir });
    try {
      const names = fs.readdirSync(dir).filter((n) => /^lists\.json\.corrupt-\d+$/.test(n));
      assert.equal(names.length, 1, content); // design.md:58
      assert.equal(fs.readFileSync(path.join(dir, names[0]), 'utf8'), content); // design.md:58 (never overwritten)
      const created = await createList(s, 'Fresh');
      assert.equal(created.res.status, 201); // design.md:58 (starts empty and works)
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      assert.equal(data.schema, 1); // design.md:55
      assert.deepEqual(Object.keys(data.lists), [created.id]); // design.md:58 (empty store plus the new list)
    } finally {
      await s.stop();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

test('a missing data file and missing directories are fine; leftover temp files are deleted at boot', T, async () => {
  const dir = tmpDataDir();
  const file = path.join(dir, 'deep', 'er', 'lists.json');
  const s = await startServer({ dataDir: dir, dataFile: file });
  try {
    assert.equal(fs.existsSync(file), false); // design.md:58 (file created on first write)
    const { res } = await createList(s);
    assert.equal(res.status, 201); // design.md:58
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).schema, 1); // design.md:57 (mkdir -p), design.md:55
  } finally {
    await s.stop();
  }
  const leftover = `${file}.tmp-4242`;
  fs.writeFileSync(leftover, 'half written');
  const s2 = await startServer({ dataDir: dir, dataFile: file });
  try {
    assert.equal(fs.existsSync(leftover), false); // design.md:58 (leftover tmp files deleted)
    assert.equal(fs.existsSync(file), true); // design.md:58 (the real file is kept)
  } finally {
    await s2.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('starting on a port that is in use prints "Port <N> is in use, set PORT" and exits 1', T, async () => {
  if (!fs.existsSync(path.join(process.cwd(), 'src', 'server.js'))) throw new Error('src/server.js not found');
  const blocker = net.createServer();
  await new Promise((resolve) => blocker.listen(0, '127.0.0.1', resolve));
  const port = blocker.address().port;
  const dir = tmpDataDir();
  try {
    const child = spawn(process.execPath, [path.join(process.cwd(), 'src', 'server.js')], {
      cwd: process.cwd(), env: { ...process.env, PORT: String(port), DATA_FILE: path.join(dir, 'lists.json') }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (c) => { stderr += c; });
    const killer = setTimeout(() => child.kill('SIGKILL'), 8000);
    const code = await new Promise((resolve) => child.once('exit', (c) => resolve(c)));
    clearTimeout(killer);
    assert.equal(code, 1); // design.md:7
    assert.ok(stderr.includes(`Port ${port} is in use, set PORT`), stderr); // design.md:7
  } finally {
    blocker.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the next item id survives a restart, so a removed id is still not reused', T, () => withServer(async (s, ctx) => {
  const { id } = await createList(s);
  await addItem(s, id, 'a');
  const b = await addItem(s, id, 'b');
  await removeItem(s, id, b.item.id);
  const s2 = await ctx.restart();
  const c = await addItem(s2, id, 'c');
  assert.equal(c.item.id, '3'); // design.md:55 (nextItemId is stored), design.md:21 (never reused)
  assert.deepEqual(c.body.items.map((i) => i.id), ['1', '3']); // design.md:22
}));

test('error responses (404, 405, 403, 413, 415) carry the security headers too', T, () => withServer(async (s) => {
  const { id } = await createList(s);
  const responses = [
    await s.call('GET', '/api/nothing'),
    await s.call('GET', '/api/lists'),
    await s.call('GET', '/', undefined, { headers: { host: 'evil.example' } }),
    await s.call('POST', `/api/lists/${id}/items`, { text: 'a'.repeat(5000) }),
    await s.call('POST', '/api/lists', { name: 'x' }, { headers: { 'content-type': 'text/plain' } }),
    await s.call('GET', '/assets/nope.js'),
  ];
  assert.deepEqual(responses.map((r) => r.status), [404, 405, 403, 413, 415, 404]); // design.md:44, 52, 72, 28
  for (const res of responses) {
    for (const [name, value] of Object.entries(SIX_HEADERS)) assert.equal(res.headers[name], value, name); // design.md:98 R9
    assert.match(res.headers['content-security-policy'], /^default-src 'none'; script-src 'self'/); // design.md:69
  }
}));

test('query strings are ignored for API routing', T, () => withServer(async (s) => {
  const created = await s.call('POST', '/api/lists?debug=1', { name: 'Q' });
  assert.equal(created.status, 201); // design.md:28
  const get = await s.call('GET', `/api/lists/${created.body.id}?x=1&y=2`);
  assert.equal(get.status, 200); // design.md:28
  assert.deepEqual(get.body, created.body); // design.md:28
  const item = await s.call('POST', `/api/lists/${created.body.id}/items?z=1`, { text: 'a' });
  assert.equal(item.status, 201); // design.md:28
}));
