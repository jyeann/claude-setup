// core/keys.js: the ux.md keyboard table, row by row.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, nearest, readingOrder } from '../public/js/core/keys.js';

const play = (over = {}) => ({ view: 'play', paused: false, text: false, over: false, ...over });
const k = (key, extra = {}) => resolve({ key, targetKind: 'other', context: play(), shortcutsOn: true, ...extra });

test('single keys on the play view map to commands', () => {
  assert.equal(k('i'), 'inspect');
  assert.equal(k('I'), 'inspect');
  assert.equal(k('a'), 'focus-actions');
  assert.equal(k('l'), 'focus-log');
  assert.equal(k('s'), 'say-status');
  assert.equal(k('['), 'alert-prev');
  assert.equal(k(']'), 'alert-next');
  assert.equal(k('t'), 'toggle-text');
  assert.equal(k('h'), 'hint');
  assert.equal(k('?'), 'help');
  assert.equal(k('Escape'), 'escape');
  assert.equal(k('x'), null);
});

test('Space pauses only from the body or a map node, never from a button or action', () => {
  assert.equal(k(' '), 'pause-toggle');
  assert.equal(k(' ', { targetKind: 'map-node' }), 'pause-toggle');
  assert.equal(k(' ', { targetKind: 'button' }), null);
  assert.equal(k(' ', { targetKind: 'action' }), null);
});

test('step keys need a paused clock or text mode', () => {
  assert.equal(k('.'), null);
  assert.equal(k('>'), null);
  assert.equal(k('.', { context: play({ paused: true }) }), 'step-1');
  assert.equal(k('>', { context: play({ paused: true }) }), 'step-5');
  assert.equal(k('.', { context: play({ text: true }) }), 'step-1');
  assert.equal(k('>', { context: play({ text: true }) }), 'step-5');
});

test('d opens the debrief only when the incident is over', () => {
  assert.equal(k('d'), null);
  assert.equal(k('d', { context: play({ over: true }) }), 'debrief');
});

test('text fields and dialogs swallow every key; modifiers cancel shortcuts', () => {
  for (const targetKind of ['text', 'dialog']) {
    for (const key of ['i', 'a', ' ', '?', 'Escape', 'ArrowLeft']) assert.equal(k(key, { targetKind }), null, `${targetKind} ${key}`);
  }
  for (const mod of ['ctrl', 'alt', 'meta']) assert.equal(k('i', { [mod]: true }), null, mod);
});

test('the Shortcuts switch turns off character keys but not arrows, Enter or Escape', () => {
  const off = { shortcutsOn: false };
  for (const key of ['i', 'a', 'l', 's', 't', 'h', '?', ' ', '[', ']']) assert.equal(k(key, off), null, key);
  assert.equal(k('.', { ...off, context: play({ paused: true }) }), null);
  assert.equal(k('ArrowRight', { ...off, targetKind: 'map-node' }), 'move-right');
  assert.equal(k('Enter', { ...off, targetKind: 'map-node' }), 'inspect');
  assert.equal(k('Escape', off), 'escape');
  assert.equal(k('ArrowDown', { ...off, targetKind: 'action' }), 'action-next');
});

test('map nodes: arrows move, Home and End jump, Enter inspects', () => {
  const n = { targetKind: 'map-node' };
  assert.equal(k('ArrowLeft', n), 'move-left');
  assert.equal(k('ArrowRight', n), 'move-right');
  assert.equal(k('ArrowUp', n), 'move-up');
  assert.equal(k('ArrowDown', n), 'move-down');
  assert.equal(k('Home', n), 'map-first');
  assert.equal(k('End', n), 'map-last');
  assert.equal(k('Enter', n), 'inspect');
  assert.equal(k('ArrowLeft'), null, 'arrows do nothing off the map');
});

test('action rows: Up and Down move, Enter applies, 1 to 9 jump', () => {
  const a = { targetKind: 'action' };
  assert.equal(k('ArrowUp', a), 'action-prev');
  assert.equal(k('ArrowDown', a), 'action-next');
  assert.equal(k('Enter', a), 'action-apply');
  assert.equal(k('1', a), 'jump-1');
  assert.equal(k('9', a), 'jump-9');
  assert.equal(k('0', a), null);
  assert.equal(k('1'), null, 'digits only work while the action list has focus');
  assert.equal(k('3', { ...a, shortcutsOn: false }), null);
});

test('debrief keys: c r b copy, retry, back; brackets step the replay marks', () => {
  const d = (key, extra) => resolve({ key, targetKind: 'other', context: { view: 'debrief' }, shortcutsOn: true, ...extra });
  assert.equal(d('c'), 'copy');
  assert.equal(d('r'), 'retry');
  assert.equal(d('b'), 'back');
  assert.equal(d('['), 'mark-prev');
  assert.equal(d(']'), 'mark-next');
  assert.equal(d('?'), 'help');
  assert.equal(d('i'), null);
  assert.equal(d('c', { shortcutsOn: false }), null);
  assert.equal(d(']', { targetKind: 'slider' }), 'mark-next');
});

test('other screens only know the keys dialog', () => {
  const o = (key) => resolve({ key, targetKind: 'other', context: { view: 'other' }, shortcutsOn: true });
  assert.equal(o('?'), 'help');
  assert.equal(o('i'), null);
  assert.equal(resolve({ key: 5 }), null);
  assert.equal(resolve(null), null);
});

const pts = [
  { id: 'clients', x: 0, y: 100 }, { id: 'lb', x: 100, y: 100 }, { id: 's1', x: 200, y: 40 },
  { id: 's2', x: 200, y: 160 }, { id: 'cache', x: 300, y: 40 }, { id: 'db', x: 400, y: 100 },
];

test('nearest picks the closest point inside the 90 degree cone', () => {
  assert.equal(nearest(pts, 'clients', 'right'), 'lb');
  assert.equal(nearest(pts, 'lb', 'left'), 'clients');
  assert.equal(nearest(pts, 'lb', 'right'), 's1', 'tie in distance goes to the lower id');
  assert.equal(nearest(pts, 's1', 'down'), 's2');
  assert.equal(nearest(pts, 's2', 'up'), 's1');
  assert.equal(nearest(pts, 's1', 'right'), 'cache');
});

test('nearest falls back to the nearest point on that side and returns null at the edge', () => {
  assert.equal(nearest(pts, 'db', 'up'), 'cache', 'nothing straight above, cache is up and to the left');
  assert.equal(nearest(pts, 'clients', 'left'), null);
  assert.equal(nearest(pts, 'nope', 'left'), null);
  assert.equal(nearest(pts, 'lb', 'sideways'), null);
});

test('readingOrder walks rows top to bottom, left to right', () => {
  assert.deepEqual(readingOrder(pts), ['s1', 'cache', 'clients', 'lb', 'db', 's2']);
  assert.deepEqual(readingOrder([]), []);
  assert.deepEqual(readingOrder([{ id: 'a', x: 5, y: 10 }, { id: 'b', x: 1, y: 20 }]), ['b', 'a'], 'close rows count as one row');
  assert.deepEqual(readingOrder([{ id: 'a', x: 5, y: 10 }, { id: 'b', x: 1, y: 90 }]), ['a', 'b']);
});
