'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { startServer, withServer, createList, addItem, setTicked, removeItem, getList } = require('./helpers');

const T = { timeout: 30000 };
const LIST_ID = /^[A-Za-z0-9_-]{22}$/;
const ITEM_ID = /^[1-9][0-9]{0,9}$/;

test('prints the startup line with the real port (R1)', T, () => withServer(async (s) => {
  assert.ok(s.logs().stdout.includes(`Packing list running at http://localhost:${s.port}`));
}));

test('exits with code 0 on SIGTERM (R3)', T, async () => {
  const s = await startServer();
  const info = await s.stop();
  assert.equal(info.code, 0);
});

test('creates a list and returns 201 with id, name and no items (R11)', T, () => withServer(async (s) => {
  const { res } = await createList(s, 'Lisbon weekend');
  assert.equal(res.status, 201);
  assert.equal(res.body.name, 'Lisbon weekend');
  assert.deepEqual(res.body.items, []);
  assert.match(res.body.id, LIST_ID);
}));

test('two creates never return the same id (R12)', T, () => withServer(async (s) => {
  const a = await createList(s, 'Same');
  const b = await createList(s, 'Same');
  assert.match(a.id, LIST_ID);
  assert.match(b.id, LIST_ID);
  assert.notEqual(a.id, b.id);
}));

test('trims the trip name before storing it (R13)', T, () => withServer(async (s) => {
  const { res, id } = await createList(s, '   Camping   ');
  assert.equal(res.status, 201);
  assert.equal(res.body.name, 'Camping');
  assert.equal((await getList(s, id)).body.name, 'Camping');
}));

test('refuses an empty trip name with name_empty (R14)', T, () => withServer(async (s) => {
  const res = await s.call('POST', '/api/lists', { name: '' });
  assert.equal(res.status, 400);
  assert.deepEqual(res.body, { error: { code: 'name_empty', message: 'Enter a trip name.' } });
}));

test('refuses a whitespace-only trip name with name_empty (R14)', T, () => withServer(async (s) => {
  const res = await s.call('POST', '/api/lists', { name: '    ' });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'name_empty');
}));

test('refuses an 81 character trip name with the exact message (R16)', T, () => withServer(async (s) => {
  const res = await s.call('POST', '/api/lists', { name: 'n'.repeat(81) });
  assert.equal(res.status, 400);
  assert.deepEqual(res.body, { error: { code: 'name_too_long', message: 'Trip name is too long (81 characters). The limit is 80.' } });
}));

test('refuses a missing or non-string name or a non-object body with invalid_body (R18)', T, () => withServer(async (s) => {
  for (const body of [{}, { name: 42 }, { name: null }, ['Trip'], 'Trip']) {
    const res = await s.call('POST', '/api/lists', body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.equal(res.body.error.code, 'invalid_body', JSON.stringify(body));
  }
}));

test('refuses invalid JSON with bad_json (R19)', T, () => withServer(async (s) => {
  const res = await s.call('POST', '/api/lists', undefined, { raw: '{"name": ' });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'bad_json');
}));

test('returns the list view for an existing id (R21)', T, () => withServer(async (s) => {
  const { id } = await createList(s, 'Beach');
  const res = await getList(s, id);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { id, name: 'Beach', items: [] });
}));

test('returns 404 list_not_found with the exact message for an unknown id (R21)', T, () => withServer(async (s) => {
  const res = await getList(s, 'A'.repeat(22));
  assert.equal(res.status, 404);
  assert.deepEqual(res.body, { error: { code: 'list_not_found', message: 'That link does not match any list. Check it for typos.' } });
}));

test('adds an item: 201, new item last, unticked, id in the allowed shape (R22)', T, () => withServer(async (s) => {
  const { id } = await createList(s);
  await addItem(s, id, 'Socks');
  const res = await addItem(s, id, 'Passport');
  assert.equal(res.status, 201);
  assert.equal(res.body.items.length, 2);
  assert.equal(res.item.text, 'Passport');
  assert.equal(res.item.ticked, false);
  assert.match(res.item.id, ITEM_ID);
}));

test('trims item text (R13)', T, () => withServer(async (s) => {
  const { id } = await createList(s);
  const res = await addItem(s, id, '  Charger  ');
  assert.equal(res.status, 201);
  assert.equal(res.item.text, 'Charger');
}));

test('refuses an empty item with item_empty (R24)', T, () => withServer(async (s) => {
  const { id } = await createList(s);
  const res = await addItem(s, id, '   ');
  assert.equal(res.status, 400);
  assert.deepEqual(res.body, { error: { code: 'item_empty', message: 'Enter an item to add.' } });
  assert.equal((await getList(s, id)).body.items.length, 0);
}));

test('refuses a 121 character item with the exact message and adds nothing (R24)', T, () => withServer(async (s) => {
  const { id } = await createList(s);
  const res = await addItem(s, id, 'i'.repeat(121));
  assert.equal(res.status, 400);
  assert.deepEqual(res.body, { error: { code: 'item_too_long', message: 'Item is too long (121 characters). The limit is 120.' } });
  assert.equal((await getList(s, id)).body.items.length, 0);
}));

test('refuses a missing or non-string item text with invalid_body (R18)', T, () => withServer(async (s) => {
  const { id } = await createList(s);
  const res = await s.call('POST', `/api/lists/${id}/items`, { label: 'Socks' });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'invalid_body');
}));

test('adding to an unknown list returns 404 list_not_found (R31)', T, () => withServer(async (s) => {
  const res = await addItem(s, 'B'.repeat(22), 'Socks');
  assert.equal(res.status, 404);
  assert.equal(res.body.error.code, 'list_not_found');
}));

test('allows duplicate item texts as separate items with different ids (R26)', T, () => withServer(async (s) => {
  const { id } = await createList(s);
  const a = await addItem(s, id, 'Socks');
  const b = await addItem(s, id, 'Socks');
  assert.equal(b.body.items.length, 2);
  assert.notEqual(a.item.id, b.item.id);
}));

test('allows two lists with the same trip name (R26)', T, () => withServer(async (s) => {
  const a = await createList(s, 'Trip');
  const b = await createList(s, 'Trip');
  assert.equal(a.res.status, 201);
  assert.equal(b.res.status, 201);
}));

test('returns <b>hi</b> unchanged for names and items (R34)', T, () => withServer(async (s) => {
  const { id, res } = await createList(s, '<b>hi</b>');
  assert.equal(res.body.name, '<b>hi</b>');
  const added = await addItem(s, id, '<b>hi</b>');
  assert.equal(added.item.text, '<b>hi</b>');
  assert.equal((await getList(s, id)).body.items[0].text, '<b>hi</b>');
}));

test('ticks and unticks an item with explicit values (R28)', T, () => withServer(async (s) => {
  const { id } = await createList(s);
  const { item } = await addItem(s, id, 'Passport');
  const on = await setTicked(s, id, item.id, true);
  assert.equal(on.status, 200);
  assert.equal(on.body.items[0].ticked, true);
  assert.equal((await getList(s, id)).body.items[0].ticked, true);
  const off = await setTicked(s, id, item.id, false);
  assert.equal(off.status, 200);
  assert.equal(off.body.items[0].ticked, false);
}));

test('ticking does not reorder items (R27)', T, () => withServer(async (s) => {
  const { id } = await createList(s);
  const a = await addItem(s, id, 'A');
  await addItem(s, id, 'B');
  await addItem(s, id, 'C');
  const res = await setTicked(s, id, a.item.id, true);
  assert.deepEqual(res.body.items.map((i) => i.text), ['A', 'B', 'C']);
}));

test('ticking an unknown item returns 404 item_not_found, an unknown list 404 list_not_found (R31)', T, () => withServer(async (s) => {
  const { id } = await createList(s);
  const item = await setTicked(s, id, '99', true);
  assert.equal(item.status, 404);
  assert.deepEqual(item.body, { error: { code: 'item_not_found', message: 'That item was removed.' } });
  const list = await setTicked(s, 'C'.repeat(22), '1', true);
  assert.equal(list.status, 404);
  assert.equal(list.body.error.code, 'list_not_found');
}));

test('removes an item and returns the view without it (R30)', T, () => withServer(async (s) => {
  const { id } = await createList(s);
  const a = await addItem(s, id, 'Keep');
  const b = await addItem(s, id, 'Drop');
  const res = await removeItem(s, id, b.item.id);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.items.map((i) => i.text), ['Keep']);
  assert.equal(res.body.items[0].id, a.item.id);
}));

test('removing the same item twice gives 404 item_not_found the second time (R31)', T, () => withServer(async (s) => {
  const { id } = await createList(s);
  const { item } = await addItem(s, id, 'Once');
  assert.equal((await removeItem(s, id, item.id)).status, 200);
  const again = await removeItem(s, id, item.id);
  assert.equal(again.status, 404);
  assert.equal(again.body.error.code, 'item_not_found');
}));

test('API responses are JSON with the security headers (R9, R10)', T, () => withServer(async (s) => {
  const ok = await createList(s);
  const bad = await getList(s, 'D'.repeat(22));
  for (const res of [ok.res, bad]) {
    assert.match(res.headers['content-type'], /^application\/json; charset=utf-8$/i);
    assert.equal(res.headers['content-security-policy'], "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.equal(res.headers['referrer-policy'], 'no-referrer');
    assert.equal(res.headers['x-frame-options'], 'DENY');
    assert.equal(res.headers['cross-origin-opener-policy'], 'same-origin');
    assert.equal(res.headers['cross-origin-resource-policy'], 'same-origin');
    assert.equal(res.headers['cache-control'], 'no-store');
  }
}));

test('lists, items, order and tick states survive a restart (R36)', T, () => withServer(async (s, ctx) => {
  const { id } = await createList(s, 'Lisbon weekend');
  const a = await addItem(s, id, 'Passport');
  await addItem(s, id, 'Charger');
  await setTicked(s, id, a.item.id, true);
  const before = (await getList(s, id)).body;
  const s2 = await ctx.restart();
  const after = await getList(s2, id);
  assert.equal(after.status, 200);
  assert.deepEqual(after.body, before);
  assert.deepEqual(after.body.items.map((i) => [i.text, i.ticked]), [['Passport', true], ['Charger', false]]);
}));

test('the data file is valid JSON with schema 1 once a list was saved (R35, R37)', T, () => withServer(async (s) => {
  const { id } = await createList(s, 'On disk');
  await addItem(s, id, 'Hat');
  const data = JSON.parse(fs.readFileSync(s.dataFile, 'utf8'));
  assert.equal(data.schema, 1);
  assert.equal(data.lists[id].name, 'On disk');
  assert.equal(data.lists[id].items[0].text, 'Hat');
}));
