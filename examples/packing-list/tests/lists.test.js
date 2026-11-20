'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const L = require('../src/lists');

const fresh = () => L.createList('A'.repeat(22), 'Trip', Date.UTC(2026, 0, 2));

test('constants match the spec', () => {
  assert.equal(L.MAX_ITEMS, 200);
  assert.equal(L.MAX_NAME, 80);
  assert.equal(L.MAX_ITEM, 120);
});

test('createList starts empty with item ids from 1', () => {
  const list = fresh();
  assert.deepEqual(list, { id: 'A'.repeat(22), name: 'Trip', createdAt: '2026-01-02T00:00:00.000Z', nextItemId: 1, items: [] });
});

test('addItem appends unticked items with increasing string ids', () => {
  const list = fresh();
  const a = L.addItem(list, 'Socks');
  const b = L.addItem(list, 'Socks');
  assert.deepEqual(a, { id: '1', text: 'Socks', ticked: false });
  assert.equal(b.id, '2');
  assert.deepEqual(list.items.map((i) => i.id), ['1', '2']);
  assert.equal(list.nextItemId, 3);
});

test('item ids are not reused after removal', () => {
  const list = fresh();
  L.addItem(list, 'a');
  const b = L.addItem(list, 'b');
  L.removeItem(list, b.id);
  assert.equal(L.addItem(list, 'c').id, '3');
});

test('the 200th item is accepted and the 201st gives list_full 409', () => {
  const list = fresh();
  for (let i = 0; i < 199; i += 1) L.addItem(list, `i${i}`);
  L.addItem(list, 'last');
  assert.equal(list.items.length, 200);
  assert.throws(() => L.addItem(list, 'one more'), (e) => e instanceof L.DomainError && e.code === 'list_full' && e.status === 409 && e.message === 'This list is full (200 items)');
  assert.equal(list.items.length, 200);
  assert.equal(list.nextItemId, 201);
});

test('setTicked sets and repeats values without reordering', () => {
  const list = fresh();
  for (const t of ['a', 'b', 'c']) L.addItem(list, t);
  L.setTicked(list, '1', true);
  L.setTicked(list, '1', true);
  assert.equal(list.items[0].ticked, true);
  L.setTicked(list, '1', false);
  assert.equal(list.items[0].ticked, false);
  assert.deepEqual(list.items.map((i) => i.text), ['a', 'b', 'c']);
});

test('setTicked and removeItem on an unknown item give item_not_found 404', () => {
  const list = fresh();
  L.addItem(list, 'a');
  for (const fn of [() => L.setTicked(list, '9', true), () => L.removeItem(list, '9')]) {
    assert.throws(fn, (e) => e.code === 'item_not_found' && e.status === 404 && e.message === 'That item was removed.');
  }
});

test('removeItem keeps the order of the others and a second removal fails', () => {
  const list = fresh();
  for (const t of ['a', 'b', 'c']) L.addItem(list, t);
  const removed = L.removeItem(list, '2');
  assert.equal(removed.text, 'b');
  assert.deepEqual(list.items.map((i) => i.text), ['a', 'c']);
  assert.throws(() => L.removeItem(list, '2'), (e) => e.code === 'item_not_found');
});

test('toView exposes id, name and items only, as copies', () => {
  const list = fresh();
  L.addItem(list, 'a');
  const view = L.toView(list);
  assert.deepEqual(view, { id: list.id, name: 'Trip', items: [{ id: '1', text: 'a', ticked: false }] });
  view.items[0].ticked = true;
  assert.equal(list.items[0].ticked, false);
});
