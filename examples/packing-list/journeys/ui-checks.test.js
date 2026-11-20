'use strict';
// UI acceptance checks UC1..UC15 from docs/product/packing-list/ux.md.
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./support');

const T = { timeout: S.TEST_TIMEOUT };
const NARROW = { viewport: { width: 320, height: 640 } };

test('UC1: home has no password field or Sign in, and has the create form', T, () => S.withApp(async (app) => {
  const page = await app.newPage();
  await page.goto(app.url + '/');
  await page.getByRole('form').first().waitFor();
  assert.equal(await page.locator('input[type=password]').count(), 0);
  assert.equal(await page.getByRole('link', { name: /sign in/i }).count(), 0);
  assert.equal(await page.getByRole('button', { name: /sign in/i }).count(), 0);
  const form = page.getByRole('form', { name: 'New packing list' });
  await form.getByRole('textbox', { name: 'Trip name' }).waitFor();
  await form.getByRole('button', { name: 'Create list', exact: true }).waitFor();
}));

test('UC2: at 320px a 120-character unbroken item causes no horizontal scroll', T, () => S.withApp(async (app) => {
  const page = await app.newPage(NARROW);
  await S.createList(page, app.url, 'Narrow');
  const long = 'W'.repeat(120);
  await S.addItem(page, long);
  const overflow = () => page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  let m = await overflow();
  assert.ok(m.sw <= m.cw, `after add: scrollWidth ${m.sw} > clientWidth ${m.cw}`);
  await page.reload();
  await S.checkbox(page, long).waitFor();
  m = await overflow();
  assert.ok(m.sw <= m.cw, `after load: scrollWidth ${m.sw} > clientWidth ${m.cw}`);
}));

test('UC3: the list page textbox is named "New item"', T, () => S.withApp(async (app) => {
  const page = await app.newPage();
  await S.createList(page, app.url, 'Lisbon weekend');
  await page.getByRole('textbox', { name: 'New item' }).waitFor();
  assert.equal(await page.getByRole('textbox', { name: 'New item' }).count(), 1);
}));

test('UC4: an empty trip name shows the error in an alert and stays on /', T, () => S.withApp(async (app) => {
  const page = await app.newPage();
  await page.goto(app.url + '/');
  await page.getByRole('button', { name: 'Create list', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Enter a trip name.' }).waitFor();
  assert.equal(new URL(page.url()).pathname, '/');
}));

test('UC5: after Add with a valid item the focus is in #new-item', T, () => S.withApp(async (app) => {
  const page = await app.newPage();
  await S.createList(page, app.url, 'Lisbon weekend');
  await page.getByRole('textbox', { name: 'New item' }).fill('Passport');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await S.checkbox(page, 'Passport').waitFor();
  await S.eventually(async () => assert.equal(await page.evaluate(() => document.activeElement === document.querySelector('#new-item')), true), 3000, 'focus in #new-item');
}));

test('UC6: list URL has an id of 22+ URL-safe characters and equals the share link', T, () => S.withApp(async (app) => {
  const page = await app.newPage();
  await S.createList(page, app.url, 'Lisbon weekend');
  assert.match(page.url(), /\/l\/[A-Za-z0-9_-]{22,}$/);
  const share = page.getByRole('textbox', { name: 'Share link' });
  await S.eventually(async () => assert.equal(await share.inputValue(), page.url()), 3000, 'share link value');
}));

test('UC7: /l/nope is a 404 with the not-found page', T, () => S.withApp(async (app) => {
  const page = await app.newPage();
  const res = await page.goto(app.url + '/l/nope');
  assert.equal(res.status(), 404);
  await page.getByRole('heading', { name: 'List not found', exact: true }).waitFor();
  assert.equal(await page.getByRole('link', { name: 'Create a new list', exact: true }).getAttribute('href'), '/');
}));

test('UC8: with 200 items Add shows the full message in an alert and the count stays 200', T, () => S.withApp(async (app) => {
  const page = await app.newPage();
  await S.createList(page, app.url, 'Big list');
  // All 200 items are added through the UI.
  await S.fillToCount(page, 200);
  await page.getByRole('textbox', { name: 'New item' }).fill('One too many');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'This list is full (200 items)' }).waitFor({ timeout: 3000 });
  assert.equal(await S.itemCount(page), 200);
}));

test('UC9: the progressbar reads 1 of 2 after ticking one of two items', T, () => S.withApp(async (app) => {
  const page = await app.newPage();
  await S.createList(page, app.url, 'Lisbon weekend');
  await S.addItem(page, 'Passport');
  await S.addItem(page, 'Charger');
  await S.tick(page, 'Passport');
  const bar = page.getByRole('progressbar', { name: 'Packing progress' });
  await S.eventually(async () => {
    assert.equal(await bar.getAttribute('aria-valuenow'), '1');
    assert.equal(await bar.getAttribute('aria-valuemax'), '2');
  }, 3000, 'progressbar values');
  await page.getByText('1 of 2 packed', { exact: true }).waitFor({ state: 'visible' });
}));

test('UC10: a 121-character item shows the error in an alert and adds nothing', T, () => S.withApp(async (app) => {
  const page = await app.newPage();
  await S.createList(page, app.url, 'Lisbon weekend');
  await S.addItem(page, 'Passport');
  await page.getByRole('textbox', { name: 'New item' }).fill('c'.repeat(121));
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Item is too long (121 characters). The limit is 120.' }).waitFor({ timeout: 3000 });
  assert.equal(await S.itemCount(page), 1);
}));

test('UC11: every item has a named checkbox and Remove button, and Remove works', T, () => S.withApp(async (app) => {
  const page = await app.newPage();
  await S.createList(page, app.url, 'Lisbon weekend');
  await S.addItem(page, 'Passport');
  await S.addItem(page, 'Charger');
  for (const it of ['Passport', 'Charger']) {
    assert.equal(await S.checkbox(page, it).count(), 1);
    assert.equal(await S.removeButton(page, it).count(), 1);
  }
  assert.equal(await page.locator('ul#items > li').count(), 2);
  await S.removeButton(page, 'Charger').click();
  await S.checkbox(page, 'Charger').waitFor({ state: 'detached', timeout: 3000 });
  assert.equal(await page.locator('ul#items').getByText('Charger').count(), 0);
  assert.equal(await S.itemCount(page), 1);
}));

test('UC12: the item <b>hi</b> renders as literal text', T, () => S.withApp(async (app) => {
  const page = await app.newPage();
  await S.createList(page, app.url, 'Lisbon weekend');
  await S.addItem(page, '<b>hi</b>');
  const text = page.locator('ul#items').getByText('<b>hi</b>', { exact: true });
  await text.first().waitFor();
  assert.equal(await text.first().textContent(), '<b>hi</b>');
  assert.equal(await page.locator('ul#items b').count(), 0);
}));

test('UC13: Copy shows "Copied" then "Copy" again and the status says "Link copied"', T, () => S.withApp(async (app) => {
  const page = await app.newPage();
  await S.createList(page, app.url, 'Lisbon weekend');
  await page.getByRole('button', { name: 'Copy', exact: true }).click();
  await page.getByRole('button', { name: 'Copied', exact: true }).waitFor({ timeout: 2000 });
  await S.eventually(async () => assert.match(await page.locator('#status').innerText(), /Link copied/), 2000, '#status Link copied');
  await page.getByRole('button', { name: 'Copy', exact: true }).waitFor({ timeout: 3000 });
}));

test('UC14: every page has lang en and #status on a list page has role status', T, () => S.withApp(async (app) => {
  const page = await app.newPage();
  const lang = () => page.evaluate(() => document.documentElement.lang);
  await page.goto(app.url + '/');
  assert.equal(await lang(), 'en');
  await S.createList(page, app.url, 'Lisbon weekend');
  assert.equal(await lang(), 'en');
  assert.equal(await page.locator('#status').getAttribute('role'), 'status');
  const res = await page.goto(app.url + '/l/nope');
  assert.equal(res.status(), 404);
  assert.equal(await lang(), 'en');
}));

test('UC15: at 320px targets are at least 44x44 and the first Tab stop is the skip link', T, () => S.withApp(async (app) => {
  const page = await app.newPage(NARROW);
  await S.createList(page, app.url, 'Lisbon weekend');
  await S.addItem(page, 'Passport');
  // Open the share link in a fresh page, as a person arriving from a shared link does.
  const fresh = await app.newPage(NARROW);
  await fresh.goto(page.url());
  await S.checkbox(fresh, 'Passport').waitFor();
  await page.close();
  const boxes = await fresh.evaluate(() => {
    const out = [];
    // For a checkbox the hit area may come from its label row (ux.md), so accept the label's box.
    for (const el of document.querySelectorAll('button, [role=button], input[type=checkbox], [role=checkbox]')) {
      const r = el.getBoundingClientRect();
      const label = el.closest('label');
      const lr = label ? label.getBoundingClientRect() : null;
      const isBox = el.matches('input[type=checkbox], [role=checkbox]');
      const w = isBox && lr ? Math.max(r.width, lr.width) : r.width;
      const h = isBox && lr ? Math.max(r.height, lr.height) : r.height;
      const style = getComputedStyle(el);
      if (r.width === 0 && r.height === 0 && style.display === 'none') continue;
      out.push({ name: el.getAttribute('aria-label') || el.textContent.trim() || el.id || el.type, w, h });
    }
    return out;
  });
  assert.ok(boxes.length >= 3, `expected Copy, Add, checkbox and Remove, got ${boxes.length}`);
  for (const b of boxes) assert.ok(b.w >= 44 && b.h >= 44, `"${b.name}" is ${b.w}x${b.h}, needs 44x44`);
  await fresh.keyboard.press('Tab');
  const skip = fresh.getByRole('link', { name: 'Skip to main content', exact: true });
  assert.equal(await skip.evaluate((el) => el === document.activeElement), true, 'skip link is the first Tab stop');
}));
