// core/announcer.js: assertive merge window, polite queue, status summary.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAnnouncer, pageMessage, statusSummary, ASSERTIVE_GAP } from '../public/js/core/announcer.js';

test('one SEV2 page reads "Page. SEV2: text."', () => {
  const a = createAnnouncer();
  a.page(6, { severity: 2, text: 'checkout p99 > 2 s' });
  assert.deepEqual(a.drain(6), { assertive: 'Page. SEV2: checkout p99 > 2 s.', polite: null });
  assert.deepEqual(a.drain(7), { assertive: null, polite: null });
});

test('pages inside the 3 second window merge into one later update', () => {
  const a = createAnnouncer();
  a.page(6, { severity: 1, text: 'DB primary down' });
  assert.equal(a.drain(6).assertive, 'Page. SEV1: DB primary down.');
  a.page(7, { severity: 2, text: 'checkout p99 > 2 s' });
  a.page(8, { severity: 2, text: 'recommendations timeouts' });
  assert.equal(a.drain(8).assertive, null, 'only 2 s since the last update');
  assert.equal(a.drain(8 + ASSERTIVE_GAP - 2).assertive, '2 new pages. SEV2: checkout p99 > 2 s. SEV2: recommendations timeouts.');
});

test('the window is exactly 3 simulated seconds', () => {
  const a = createAnnouncer();
  a.page(10, { severity: 2, text: 'one' });
  a.drain(10);
  a.page(12, { severity: 2, text: 'two' });
  assert.equal(a.drain(12).assertive, null);
  assert.equal(a.drain(13).assertive, 'Page. SEV2: two.');
});

test('SEV3 and cleared alerts go to the polite region, never the assertive one', () => {
  const a = createAnnouncer();
  a.page(5, { severity: 3, text: 'Cache hit rate under 80%' });
  a.cleared('checkout p99 > 2 s');
  a.say('Paused.');
  const out = a.drain(5);
  assert.equal(out.assertive, null);
  assert.equal(out.polite, 'Warning. SEV3: Cache hit rate under 80%. Cleared: checkout p99 > 2 s. Paused.');
  assert.ok(!out.polite.includes('Page.'));
  assert.equal(a.pending(), 0);
});

test('trailing periods in alert text are not doubled; empty say is ignored', () => {
  assert.equal(pageMessage([{ severity: 2, text: 'timeouts.' }]), 'Page. SEV2: timeouts.');
  assert.equal(pageMessage([]), null);
  const a = createAnnouncer();
  a.say('');
  assert.equal(a.pending(), 0);
});

test('statusSummary names counts and the worst node', () => {
  const nodes = [
    { label: 'Cache', status: 'crit', saturation: 0.91 },
    { label: 'DB primary', status: 'crit', saturation: 0.95 },
    { label: 'Service 1', status: 'warn', saturation: 0.74 },
    { label: 'Queue', status: 'ok', saturation: 0.1 },
  ];
  assert.equal(statusSummary(nodes), '2 nodes failing, 1 warning. Worst: DB primary, saturation 95 percent.');
  assert.equal(statusSummary([{ label: 'Cache', status: 'crit', saturation: 0.91 }]), '1 node failing. Worst: Cache, saturation 91 percent.');
  assert.equal(statusSummary([{ label: 'Cache', status: 'ok', saturation: 0.2 }]), 'All nodes healthy.');
  assert.equal(statusSummary([]), 'All nodes healthy.');
  assert.equal(statusSummary([{ label: 'Q', status: 'recovering', saturation: 0.3 }, { label: 'W', status: 'warn', saturation: 0.2 }]), '1 warning, 1 recovering. Worst: W, saturation 20 percent.');
});
