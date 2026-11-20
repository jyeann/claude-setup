'use strict';
// Journeys J1..J10 from docs/product/packing-list/ux.md. Each test starts its own server and browser.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const S = require('./support');

const T = { timeout: S.TEST_TIMEOUT };
const SHARE_NOTE = 'Anyone with this link can edit.';

test('J1: start the app, see the home page, no sign-in or prompts', T, () => S.withApp(async (app) => {
  assert.match(app.server.stdout, new RegExp(`^Packing list running at http://localhost:${app.port}\\s*$`, 'm'));
  const page = await app.newPage();
  await page.goto(app.url + '/');
  assert.equal(await page.getByRole('heading', { level: 1, name: 'Packing list', exact: true }).count(), 1);
  await page.getByText('Make a list, share the link, tick things off together.', { exact: true }).waitFor();
  const form = page.getByRole('form', { name: 'New packing list' });
  await form.waitFor();
  await form.getByRole('textbox', { name: 'Trip name' }).waitFor();
  await form.getByRole('button', { name: 'Create list', exact: true }).waitFor();
  assert.equal(await page.getByRole('textbox').count(), 1, 'only the Trip name field, no name prompt');
  assert.equal(await page.locator('input[type=password]').count(), 0);
  assert.equal(await page.getByRole('dialog').count(), 0, 'no banner dialog');
  const body = await page.locator('body').innerText();
  assert.doesNotMatch(body, /sign in|log in|account|cookie|your name/i);
  assert.deepEqual(await page.context().cookies(), []);
}));

test('J2: create a list and land on its page with the share link', T, () => S.withApp(async (app) => {
  const page = await app.newPage();
  await page.goto(app.url + '/');
  const field = page.getByRole('textbox', { name: 'Trip name' });
  await field.fill('Lisbon weekend');
  await field.press('Enter');
  await page.waitForURL(/\/l\/[^/]+$/);
  assert.equal(await page.getByRole('heading', { level: 1 }).innerText(), 'Lisbon weekend');
  await page.getByText('No items yet', { exact: true }).waitFor();
  await S.expectProgress(page, '0 of 0 packed');
  const share = page.getByRole('textbox', { name: 'Share link' });
  await S.eventually(async () => assert.equal(await share.inputValue(), page.url()), 3000, 'share link value');
  assert.match(await share.inputValue(), /^https?:\/\//);
  assert.equal(await share.evaluate((el) => el.readOnly), true);
  await page.getByText(SHARE_NOTE, { exact: true }).waitFor();
  await S.eventually(async () => assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.tagName), 'H1'), 3000, 'focus on h1');
  assert.equal(await page.evaluate(() => document.activeElement.getAttribute('tabindex')), '-1');
  const copy = page.getByRole('button', { name: 'Copy', exact: true });
  await copy.click();
  await page.getByRole('button', { name: 'Copied', exact: true }).waitFor({ timeout: 2000 });
  await S.eventually(async () => assert.match(await page.locator('#status').innerText(), /Link copied/), 2000, 'Link copied');
  await page.getByRole('button', { name: 'Copy', exact: true }).waitFor({ timeout: 4000 });
}));

test('J3: refuse an empty, blank or too long trip name', T, () => S.withApp(async (app) => {
  const page = await app.newPage();
  await page.goto(app.url + '/');
  const field = page.getByRole('textbox', { name: 'Trip name' });
  const create = page.getByRole('button', { name: 'Create list', exact: true });
  const err = page.locator('#trip-name-error');
  const home = app.url + '/';
  // empty
  await create.click();
  await err.waitFor();
  assert.equal((await err.innerText()).trim(), 'Enter a trip name.');
  assert.equal(await err.getAttribute('role'), 'alert');
  assert.equal(page.url(), home);
  assert.equal(await S.activeId(page), 'trip-name');
  assert.equal(await field.getAttribute('aria-invalid'), 'true');
  assert.match(await field.getAttribute('aria-describedby'), /trip-name-error/);
  // only spaces
  await field.fill('     ');
  await create.click();
  await S.eventually(async () => assert.equal((await err.innerText()).trim(), 'Enter a trip name.'), 3000, 'blank error');
  assert.equal(page.url(), home);
  assert.equal(await S.activeId(page), 'trip-name');
  // 81 characters
  const long = 'a'.repeat(81);
  await field.fill(long);
  await create.click();
  await S.eventually(async () => assert.equal((await err.innerText()).trim(), 'Trip name is too long (81 characters). The limit is 80.'), 3000, 'long error');
  assert.equal(await err.getAttribute('role'), 'alert');
  assert.equal(page.url(), home);
  assert.equal(await field.inputValue(), long);
  assert.equal(await S.activeId(page), 'trip-name');
}));

test('J4: add items and hit the limits', T, () => S.withApp(async (app) => {
  const page = await app.newPage();
  await S.createList(page, app.url, 'Lisbon weekend');
  const input = page.getByRole('textbox', { name: 'New item' });
  const add = page.getByRole('button', { name: 'Add', exact: true });
  const err = page.locator('#form-error');
  await input.fill('Passport');
  await add.click();
  await S.checkbox(page, 'Passport').waitFor({ timeout: 1500 });
  assert.equal(await S.checkbox(page, 'Passport').isChecked(), false);
  await S.expectProgress(page, '0 of 1 packed');
  assert.equal(await input.inputValue(), '');
  assert.equal(await S.activeId(page), 'new-item');
  // empty and whitespace
  await add.click();
  await S.eventually(async () => assert.equal((await err.innerText()).trim(), 'Enter an item to add.'), 3000, 'empty error');
  await input.fill('   ');
  await add.click();
  await S.eventually(async () => assert.equal((await err.innerText()).trim(), 'Enter an item to add.'), 3000, 'blank error');
  assert.equal(await S.itemCount(page), 1);
  // 121 characters
  const long = 'b'.repeat(121);
  await input.fill(long);
  await add.click();
  await S.eventually(async () => assert.equal((await err.innerText()).trim(), 'Item is too long (121 characters). The limit is 120.'), 3000, 'long error');
  assert.equal(await S.itemCount(page), 1);
  assert.equal(await input.inputValue(), long);
  // full list: all 200 items are added through the UI
  await input.fill('');
  await S.fillToCount(page, 200);
  await input.fill('One too many');
  await add.click();
  await S.eventually(async () => assert.equal((await err.innerText()).trim(), 'This list is full (200 items)'), 3000, 'full error');
  assert.equal(await S.itemCount(page), 200);
}));

test('J5: tick, untick and keep the state after reload', T, () => S.withApp(async (app) => {
  const page = await app.newPage();
  await S.createList(page, app.url, 'Lisbon weekend');
  await S.addItem(page, 'Passport');
  const bar = page.getByRole('progressbar', { name: 'Packing progress' });
  await S.tick(page, 'Passport');
  assert.equal(await S.checkbox(page, 'Passport').isChecked(), true);
  await S.expectProgress(page, '1 of 1 packed');
  assert.equal(await bar.getAttribute('aria-valuenow'), '1');
  assert.equal(await bar.getAttribute('aria-valuemax'), '1');
  await S.untick(page, 'Passport');
  assert.equal(await S.checkbox(page, 'Passport').isChecked(), false);
  await S.expectProgress(page, '0 of 1 packed');
  await S.tick(page, 'Passport');
  await S.expectProgress(page, '1 of 1 packed');
  await page.reload();
  await S.checkbox(page, 'Passport').waitFor();
  assert.equal(await S.checkbox(page, 'Passport').isChecked(), true);
  await S.expectProgress(page, '1 of 1 packed');
}));

test('J6: two browsers stay in sync', T, () => S.withApp(async (app) => {
  const one = await app.newPage();
  await S.createList(one, app.url, 'Lisbon weekend');
  await S.addItem(one, 'Passport');
  await S.tick(one, 'Passport');
  const two = await app.newPage();
  await two.goto(one.url());
  assert.equal(await two.getByRole('heading', { level: 1 }).innerText(), 'Lisbon weekend');
  await S.checkbox(two, 'Passport').waitFor();
  assert.equal(await S.checkbox(two, 'Passport').isChecked(), true);
  await S.expectProgress(two, '1 of 1 packed');
  await S.addItem(one, 'Charger');
  await S.checkbox(two, 'Charger').waitFor({ timeout: 5000 });
  assert.equal(await S.checkbox(two, 'Charger').isChecked(), false);
  await S.expectProgress(two, '1 of 2 packed');
  await S.untick(one, 'Passport');
  await S.eventually(async () => assert.equal(await S.checkbox(two, 'Passport').isChecked(), false), 5000, 'second sees untick');
  await S.expectProgress(two, '0 of 2 packed');
  await S.tick(one, 'Passport');
  await S.eventually(async () => assert.equal(await S.checkbox(two, 'Passport').isChecked(), true), 5000, 'second sees tick');
  await S.expectProgress(two, '1 of 2 packed');
  await S.untick(one, 'Passport');
  await S.eventually(async () => assert.equal(await S.checkbox(two, 'Passport').isChecked(), false), 5000, 'second sees untick again');
}));

test('J7: remove an item and the other browser follows', T, () => S.withApp(async (app) => {
  const one = await app.newPage();
  await S.createList(one, app.url, 'Lisbon weekend');
  await S.addItem(one, 'Passport');
  await S.addItem(one, 'Charger');
  await S.tick(one, 'Passport');
  const two = await app.newPage();
  await two.goto(one.url());
  await S.checkbox(two, 'Charger').waitFor();
  await S.expectProgress(two, '1 of 2 packed');
  await S.removeButton(one, 'Charger').click();
  await S.checkbox(one, 'Charger').waitFor({ state: 'detached', timeout: 1500 });
  await S.expectProgress(one, '1 of 1 packed', 1500);
  assert.equal(await S.activeId(one), 'new-item');
  await S.checkbox(two, 'Charger').waitFor({ state: 'detached', timeout: 5000 });
  await S.expectProgress(two, '1 of 1 packed');
}));

test('J8: markup shows literally', T, () => S.withApp(async (app) => {
  const markup = '<b>hi</b>';
  const one = await app.newPage();
  await S.createList(one, app.url, markup);
  const h1 = one.getByRole('heading', { level: 1 });
  assert.equal(await h1.textContent(), markup);
  assert.equal(await h1.locator('b').count(), 0);
  await S.addItem(one, markup);
  const checkItem = async (page) => {
    await page.locator('ul#items').getByText(markup, { exact: true }).waitFor();
    assert.equal(await page.locator('ul#items b').count(), 0);
    assert.equal(await S.checkbox(page, markup).count(), 1);
    assert.equal(await page.getByRole('heading', { level: 1 }).textContent(), markup);
    assert.equal(await page.getByRole('heading', { level: 1 }).locator('b').count(), 0);
  };
  await checkItem(one);
  const two = await app.newPage();
  await two.goto(one.url());
  await checkItem(two);
  await one.reload();
  await checkItem(one);
}));

test('J9: a list survives a server restart', T, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'packing-restart-'));
  const dataFile = path.join(dir, 'lists.json');
  let port;
  const { chromium } = require('playwright');
  let srv;
  let browser;
  try {
    srv = await S.startServer({ dataFile });
    port = srv.port;
    browser = await chromium.launch();
    const ctx = await browser.newContext();
    ctx.setDefaultTimeout(8000);
    const page = await ctx.newPage();
    await S.createList(page, srv.url, 'Lisbon weekend');
    const listUrl = page.url();
    await S.addItem(page, 'Passport');
    await S.addItem(page, 'Charger');
    await S.tick(page, 'Passport');
    await S.expectProgress(page, '1 of 2 packed');
    await page.close();
    assert.equal(await S.stopServer(srv), 0, 'SIGTERM exits 0');
    srv = await S.startServer({ port, dataFile });
    const again = await ctx.newPage();
    await again.goto(listUrl);
    assert.equal(await again.getByRole('heading', { level: 1 }).innerText(), 'Lisbon weekend');
    await S.checkbox(again, 'Passport').waitFor();
    assert.equal(await S.checkbox(again, 'Passport').isChecked(), true);
    assert.equal(await S.checkbox(again, 'Charger').isChecked(), false);
    await S.expectProgress(again, '1 of 2 packed');
  } finally {
    try { await browser?.close(); } catch { /* ignore */ }
    try { await S.stopServer(srv); } catch { /* ignore */ }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('J10: wrong link, and first use end to end', T, () => S.withApp(async (app) => {
  const page = await app.newPage();
  const res = await page.goto(app.url + '/l/' + 'x'.repeat(21) + 'Q');
  assert.equal(res.status(), 404);
  assert.equal(await page.getByRole('heading', { level: 1 }).innerText(), 'List not found');
  await page.getByText('That link does not match any list. Check it for typos.', { exact: true }).waitFor();
  const link = page.getByRole('link', { name: 'Create a new list', exact: true });
  assert.equal(await link.getAttribute('href'), '/');
  await link.click();
  await page.getByRole('form', { name: 'New packing list' }).waitFor();
  assert.equal(new URL(page.url()).pathname, '/');
  // first use end to end
  await S.createList(page, app.url, 'Lisbon weekend');
  const items = ['Passport', 'Charger', 'Socks', 'Sunscreen', 'Camera'];
  for (const it of items) await S.addItem(page, it);
  const two = await app.newPage();
  await two.goto(page.url());
  for (const it of items) await S.checkbox(two, it).waitFor();
  for (const it of items) await S.tick(page, it);
  await S.expectProgress(page, '5 of 5 packed');
  await S.expectProgress(two, '5 of 5 packed', 5000);
}));
