'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const L = require('../public/js/logic.js');

test('progressText reads N of M packed', () => {
  assert.equal(L.progressText(1, 2), '1 of 2 packed');
  assert.equal(L.progressText(0, 0), '0 of 0 packed');
});

test('percent is 0 for an empty list and rounds otherwise', () => {
  assert.equal(L.percent(0, 0), 0);
  assert.equal(L.percent(1, 3), 33);
  assert.equal(L.percent(2, 2), 100);
});

test('checkName trims and returns the value', () => {
  assert.deepEqual(L.checkName('  Lisbon  '), { ok: true, value: 'Lisbon' });
});

test('checkName refuses empty, blank and non-string input with the server message', () => {
  assert.deepEqual(L.checkName(''), { ok: false, message: 'Enter a trip name.' });
  assert.deepEqual(L.checkName('   '), { ok: false, message: 'Enter a trip name.' });
  assert.deepEqual(L.checkName(undefined), { ok: false, message: 'Enter a trip name.' });
});

test('checkName accepts 80 code points and refuses 81 counting code points', () => {
  assert.equal(L.checkName('a'.repeat(80)).ok, true);
  assert.equal(L.checkName('\u{1F600}'.repeat(80)).ok, true);
  assert.equal(L.checkName('a'.repeat(81)).message, 'Trip name is too long (81 characters). The limit is 80.');
  assert.equal(L.checkName('\u{1F600}'.repeat(81)).message, 'Trip name is too long (81 characters). The limit is 80.');
});

test('checkName refuses control characters', () => {
  assert.equal(L.checkName('a\tb').message, 'Trip name contains characters that are not allowed.');
  assert.equal(L.checkName('a\u0085b').ok, false);
});

test('checkItem applies empty, length, control and full checks in that order', () => {
  assert.equal(L.checkItem(' ', 0).message, 'Enter an item to add.');
  assert.equal(L.checkItem('b'.repeat(121), 0).message, 'Item is too long (121 characters). The limit is 120.');
  assert.equal(L.checkItem('b'.repeat(120), 0).ok, true);
  assert.equal(L.checkItem('a\nb', 0).message, 'Item contains characters that are not allowed.');
  assert.equal(L.checkItem('ok', 200).message, 'This list is full (200 items)');
  assert.equal(L.checkItem('ok', 199).ok, true);
  assert.equal(L.checkItem('b'.repeat(121), 200).message, 'Item is too long (121 characters). The limit is 120.');
});

const item = (id, text, ticked = false) => ({ id, text, ticked });

test('mergeItems adds new items, updates changed ones and removes missing ones', () => {
  const plan = L.mergeItems(
    [item('1', 'A'), item('2', 'B'), item('3', 'C')],
    [item('1', 'A', true), item('3', 'C'), item('4', 'D')],
    new Map(),
  );
  assert.deepEqual(plan.remove, ['2']);
  assert.deepEqual(plan.upsert, [item('1', 'A', true), item('4', 'D')]);
  assert.deepEqual(plan.order, ['1', '3', '4']);
});

test('mergeItems reports nothing to do when views match', () => {
  const plan = L.mergeItems([item('1', 'A')], [item('1', 'A')], new Map());
  assert.deepEqual(plan, { remove: [], upsert: [], order: ['1'] });
});

test('mergeItems keeps the local tick state of an item with a tick in flight', () => {
  const plan = L.mergeItems([item('1', 'A', true)], [item('1', 'A', false)], new Map([['1', 'tick']]));
  assert.deepEqual(plan.upsert, []);
  const text = L.mergeItems([item('1', 'A', true)], [item('1', 'A2', false)], new Map([['1', 'tick']]));
  assert.deepEqual(text.upsert, [item('1', 'A2', true)]);
});

test('mergeItems does not bring back an item with a remove in flight', () => {
  const plan = L.mergeItems([], [item('1', 'A'), item('2', 'B')], new Map([['1', 'remove']]));
  assert.deepEqual(plan.order, ['2']);
  assert.deepEqual(plan.upsert, [item('2', 'B')]);
});

test('mergeItems keeps rows with a write in flight that the server does not list yet', () => {
  const plan = L.mergeItems([item('1', 'A'), item('tmp-1', 'New')], [item('1', 'A'), item('2', 'Other')], new Map([['tmp-1', 'add']]));
  assert.deepEqual(plan.remove, []);
  assert.deepEqual(plan.order, ['1', 'tmp-1']); // items not on screen wait for the add response
  const gone = L.mergeItems([item('tmp-1', 'New')], [], new Map());
  assert.deepEqual(gone.remove, ['tmp-1']);
});

test('client checks give the same message as the server validation for the same input', () => {
  const V = require('../src/validation.js');
  const message = (fn, input) => { try { fn(input); return null; } catch (err) { return err.message; } };
  for (const input of ['', '   ', 'a'.repeat(81), 'a\tb', 'ok']) {
    assert.equal(L.checkName(input).message || null, message(V.validateName, input), JSON.stringify(input));
  }
  for (const input of ['', 'b'.repeat(121), 'a\nb', 'ok']) {
    assert.equal(L.checkItem(input, 0).message || null, message(V.validateItemText, input), JSON.stringify(input));
  }
  assert.equal(L.codePointLength('\u{1F600}a'), V.codePointLength('\u{1F600}a'));
});

test('mergeItems does not insert an incoming item while an add is pending, so no duplicate row appears', () => {
  const current = [{ id: '1', text: 'Socks', ticked: false }, { id: 'tmp-1', text: 'Hat', ticked: false }];
  const incoming = [{ id: '1', text: 'Socks', ticked: false }, { id: '2', text: 'Hat', ticked: false }];
  const plan = L.mergeItems(current, incoming, new Map([['tmp-1', 'add']]));
  assert.deepEqual(plan.upsert, []);
  assert.deepEqual(plan.order, ['1', 'tmp-1']);
  assert.deepEqual(plan.remove, []);
  const after = L.mergeItems([current[0]], incoming, new Map());
  assert.deepEqual(after.upsert, [{ id: '2', text: 'Hat', ticked: false }]);
});

test('settlePending clears only its own kind, so a tick settling does not undo a remove', () => {
  const pending = new Map([['1', 'remove']]);
  L.settlePending(pending, '1', 'tick');
  assert.equal(pending.get('1'), 'remove');
  assert.deepEqual(L.mergeItems([], [{ id: '1', text: 'a', ticked: true }], pending).upsert, []);
  L.settlePending(pending, '1', 'remove');
  assert.equal(pending.has('1'), false);
});
