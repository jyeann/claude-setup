import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLive, focusEl, shortcutLabel, isSaveShortcut, isSearchShortcut, quoted } from '../public/js/live.js';

function fakeTimers() {
  const queue = [];
  let id = 0;
  return {
    setTimer: (fn, ms) => { id += 1; queue.push({ id, fn, ms }); return id; },
    clearTimer: (i) => { const k = queue.findIndex((q) => q.id === i); if (k !== -1) queue.splice(k, 1); },
    run: () => { for (const q of queue.splice(0)) q.fn(); },
    queue,
  };
}

test('announce clears the region first and sets the text 50 ms later', () => {
  const t = fakeTimers();
  const statusEl = { textContent: 'old' };
  const live = createLive({ statusEl, alertEl: { textContent: '' }, ...t });
  live.announce('Saved');
  assert.equal(statusEl.textContent, '');
  assert.equal(t.queue[0].ms, 50);
  t.run();
  assert.equal(statusEl.textContent, 'Saved');
});

test('a second message before the delay replaces the first', () => {
  const t = fakeTimers();
  const alertEl = { textContent: '' };
  const live = createLive({ statusEl: { textContent: '' }, alertEl, ...t });
  live.alert('one');
  live.alert('two');
  assert.equal(t.queue.length, 1);
  t.run();
  assert.equal(alertEl.textContent, 'two');
});

test('status and alert regions are independent', () => {
  const t = fakeTimers();
  const statusEl = { textContent: '' };
  const alertEl = { textContent: '' };
  const live = createLive({ statusEl, alertEl, ...t });
  live.announce('a');
  live.alert('b');
  t.run();
  assert.deepEqual([statusEl.textContent, alertEl.textContent], ['a', 'b']);
});

test('focusEl focuses elements and ignores null', () => {
  let focused = 0;
  assert.equal(focusEl(null), null);
  focusEl({ focus: () => { focused += 1; } });
  assert.equal(focused, 1);
});

test('shortcut helpers accept Ctrl or Cmd and nothing else', () => {
  assert.equal(isSaveShortcut({ ctrlKey: true, key: 's' }), true);
  assert.equal(isSaveShortcut({ metaKey: true, key: 'S' }), true);
  assert.equal(isSaveShortcut({ key: 's' }), false);
  assert.equal(isSaveShortcut({ ctrlKey: true, altKey: true, key: 's' }), false);
  assert.equal(isSearchShortcut({ ctrlKey: true, key: 'k' }), true);
  assert.equal(isSearchShortcut({ metaKey: true, key: 'K' }), true);
  assert.equal(isSearchShortcut({ key: 'k' }), false);
  assert.equal(isSearchShortcut({ ctrlKey: true, key: 's' }), false);
});

test('shortcut label follows the platform and quoted wraps titles', () => {
  assert.equal(shortcutLabel('MacIntel'), 'Cmd+K');
  assert.equal(shortcutLabel('Linux x86_64'), 'Ctrl+K');
  assert.equal(shortcutLabel(undefined), 'Ctrl+K');
  assert.equal(quoted('Ideas'), '"Ideas"');
});
