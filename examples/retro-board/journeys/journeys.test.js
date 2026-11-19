'use strict';
// Browser walkthrough of the journeys J1 to J13 in docs/product/retro-board/ux.md, one test per journey.
// Run by verify.js as the "journeys" check. Everything goes through the real page: click, type, read.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { harness, t, POLL, createBoard, addCard, card, cardTexts, text, activeTestId, expectText, eventually, recordAnnouncements } = require('./helpers');

const run = harness(test);
const HINTS = { 'went-well': 'Nothing here yet. What went well this sprint?', 'to-improve': 'Nothing here yet. What should we do better?', actions: 'Nothing here yet. What will we do about it?' };

test('J1: start the app with the documented command and see the home page, no sign-in', () => run(async ({ app, open }) => {
  assert.match(app.stdout(), new RegExp(`Retro board running at http://localhost:${app.port}`));
  const page = await open(app.url);
  assert.equal(await text(page.locator('h1')), 'Retro board');
  assert.ok((await text(page.locator('#home-intro'))).length > 0, 'one-line explainer');
  assert.equal(await page.getByLabel('Title').getAttribute('id'), 'title-input');
  assert.equal(await text(page.getByRole('button', { name: 'Create retro' })), 'Create retro');
  assert.equal(await page.locator('input[type=password]').count(), 0);
  for (const word of ['Sign in', 'Log in', 'cookie', 'Your name']) assert.equal(await page.getByText(word).count(), 0, `no "${word}" anywhere`);
}));

test('J2: create a retro with Enter, land on the facilitator view; an empty title is refused', () => run(async ({ app, open, context }) => {
  // Empty title first: inline error, focus on the field, no board, URL stays "/".
  const page = await open(app.url);
  await page.locator(t('create-submit')).click();
  await expectText(page.locator(t('title-error')), 'Give your retro a title, for example Sprint 12.');
  assert.equal(await activeTestId(page), 'title-input');
  assert.equal(new URL(page.url()).pathname, '/');

  // Slow the create call down so the "Creating..." state can be read.
  await page.route('**/api/**', async (route) => { await new Promise((r) => setTimeout(r, 400)); await route.continue(); });
  await page.locator(t('title-input')).fill('Sprint 12');
  await page.locator(t('title-input')).press('Enter');
  await expectText(page.locator(t('create-submit')), 'Creating...', { timeout: 2000 });
  assert.equal(await page.locator(t('create-submit')).isDisabled(), true);
  await page.waitForURL(/\/b\/[^/]+\/f\/[^/]+$/);
  await page.unroute('**/api/**');
  await page.locator(t('columns')).waitFor();
  assert.equal(await text(page.locator(t('board-title'))), 'Sprint 12');
  assert.equal(await activeTestId(page), 'board-title', 'focus lands on the h1');
  assert.equal(await page.locator(t('share-panel')).isVisible(), true);
  assert.match(await page.locator(t('participant-link')).inputValue(), /^http:\/\/localhost:\d+\/b\/[^/]+$/);
  assert.match(await text(page.locator(t('facilitator-link-block'))), /Private/);
  for (const [key, hint] of Object.entries(HINTS)) assert.equal(await text(page.locator(t(`empty-${key}`))), hint);
  assert.equal(await text(page.locator(t('votes-left'))), '3 votes left');
  assert.equal(await page.locator(t('close-retro')).isVisible(), true);
  assert.equal(await page.locator(t('export-link')).isVisible(), true);
  void context;
}));

test('J3: copy the participant link; a teammate opening it gets no facilitator controls', () => run(async ({ app, open }) => {
  const a = await open(app.url);
  const link = await createBoard(a, app.url);
  const said = await recordAnnouncements(a);
  await a.locator(t('copy-participant')).click();
  await expectText(a.locator(t('copy-participant')), 'Copied', { timeout: 1000 });
  await said.heard('Participant link copied');
  assert.equal(await a.evaluate(() => navigator.clipboard.readText()), link);
  await expectText(a.locator(t('copy-participant')), 'Copy', { timeout: 4000 }); // back after 2 seconds
  const priv = await text(a.locator(t('facilitator-link-block')));
  assert.match(priv, /Private/);
  assert.match(priv, /Keep this private/);
  assert.match(priv, /bookmark it/);
  await addCard(a, 'went-well', 'From the facilitator');

  const b = await open(link);
  await card(b, 'From the facilitator').waitFor(POLL);
  assert.equal(await text(b.locator(t('board-title'))), 'Sprint 12');
  for (const id of ['close-retro', 'reopen-retro', 'export-link', 'facilitator-link', 'share-panel']) assert.equal(await b.locator(t(id)).count(), 0, `${id} must not be in the participant DOM`);
  assert.equal(await b.locator(t('delete-btn')).count(), 0, 'no Delete on other people\'s cards');
}));

test('J4: add a card with the button and with Ctrl+Enter; it reaches the facilitator; bad text is refused', () => run(async ({ app, open }) => {
  const a = await open(app.url);
  const link = await createBoard(a, app.url);
  const b = await open(link);
  const said = await recordAnnouncements(b);
  const box = b.locator(t('new-to-improve'));

  await box.fill('Slow builds');
  await b.locator(t('add-to-improve')).click();
  await card(b, 'Slow builds').waitFor({ timeout: 500 });
  assert.equal(await box.inputValue(), '');
  assert.equal(await activeTestId(b), 'new-to-improve', 'focus stays in the box');
  await said.heard('Card added to To improve');
  await card(a, 'Slow builds').waitFor(POLL); // facilitator window, no reload

  await box.fill('Flaky tests');
  await box.press('Control+Enter');
  await card(b, 'Flaky tests').waitFor(POLL);
  assert.deepEqual(await cardTexts(b, 'to-improve'), ['Slow builds', 'Flaky tests'], 'new cards go to the bottom');

  for (const blank of ['', '   ']) {
    await box.fill(blank);
    await b.locator(t('add-to-improve')).click();
    await expectText(b.locator(t('error-to-improve')), 'Write something before adding the card.');
  }
  const long = 'x'.repeat(512);
  await box.fill(long);
  await b.locator(t('add-to-improve')).click();
  await expectText(b.locator(t('error-to-improve')), 'That card is 512 characters. The limit is 500. Shorten it by 12.');
  assert.equal(await box.inputValue(), long, 'text is kept');
  assert.equal(await activeTestId(b), 'new-to-improve');
  assert.equal(await b.locator(`${t('cards-to-improve')} ${t('card')}`).count(), 2);

  await addCard(b, 'to-improve', '<b>hi</b>');
  assert.equal(await card(b, '<b>hi</b>').locator(t('card-text')).textContent(), '<b>hi</b>');
  assert.equal(await b.locator('.card-text b').count(), 0);
}));

test('J5: three votes per browser, taken back and kept over a reload; a second browser has its own three', () => run(async ({ app, open }) => {
  const a = await open(app.url);
  const link = await createBoard(a, app.url);
  const b = await open(link);
  for (const c of ['One', 'Two', 'Three', 'Four']) await addCard(b, 'went-well', c);
  const vote = (page, c) => card(page, c).locator(t('vote-btn'));
  const count = async (page, c) => Number.parseInt(await text(card(page, c).locator(t('vote-count'))), 10);

  assert.equal(await text(b.locator(t('votes-left'))), '3 votes left');
  await vote(b, 'One').click();
  await expectText(b.locator(t('votes-left')), '2 votes left');
  assert.equal(await count(b, 'One'), 1);
  assert.equal(await text(vote(b, 'One')), 'Remove vote');
  assert.equal(await vote(b, 'One').getAttribute('aria-pressed'), 'true');
  assert.equal(await vote(b, 'One').evaluate((el) => el === document.activeElement), true, 'focus stays on the vote button');

  await vote(b, 'Two').click();
  await expectText(b.locator(t('votes-left')), '1 vote left');
  await vote(b, 'Three').click();
  await expectText(b.locator(t('votes-left')), 'No votes left');
  assert.equal(await vote(b, 'Four').isDisabled(), true);
  assert.equal(await vote(b, 'Four').getAttribute('aria-disabled'), 'true');
  await expectText(b.locator('#votes-hint'), 'Remove a vote to vote on another card.');
  assert.equal(await vote(b, 'One').isDisabled(), false, 'voted cards can still take the vote back');

  await vote(b, 'Three').click();
  await expectText(b.locator(t('votes-left')), '1 vote left');
  assert.equal(await count(b, 'Three'), 0);
  assert.equal(await vote(b, 'Four').isDisabled(), false);

  await b.reload();
  await card(b, 'One').waitFor(POLL);
  assert.equal(await text(b.locator(t('votes-left'))), '1 vote left');
  assert.deepEqual([await count(b, 'One'), await count(b, 'Two'), await count(b, 'Three')], [1, 1, 0]);
  assert.equal(await vote(b, 'One').getAttribute('aria-pressed'), 'true');

  await card(a, 'One').waitFor(POLL);
  assert.equal(await text(a.locator(t('votes-left'))), '3 votes left', 'the second browser has its own 3 votes');
  await vote(a, 'One').click();
  await expectText(card(a, 'One').locator(t('vote-count')), /^2/);
  await expectText(card(b, 'One').locator(t('vote-count')), /^2/);
}));

test('J6: delete own card with an inline confirm; it disappears for everyone; the facilitator can delete any card', () => run(async ({ app, open }) => {
  const a = await open(app.url);
  const link = await createBoard(a, app.url);
  const b = await open(link);
  await addCard(a, 'actions', 'Facilitator card');
  await addCard(b, 'actions', 'Mine');
  await card(b, 'Facilitator card').waitFor(POLL);
  await card(a, 'Mine').waitFor(POLL);
  assert.equal(await card(b, 'Mine').locator(t('delete-btn')).count(), 1);
  assert.equal(await card(b, 'Facilitator card').locator(t('delete-btn')).count(), 0);
  assert.equal(await card(a, 'Mine').locator(t('delete-btn')).count(), 1, 'facilitator sees Delete on every card');
  assert.equal(await card(a, 'Facilitator card').locator(t('delete-btn')).count(), 1);

  const said = await recordAnnouncements(b);
  await card(b, 'Mine').locator(t('delete-btn')).click();
  const confirm = card(b, 'Mine').locator(t('delete-confirm'));
  assert.match(await text(confirm), /Delete this card\?/);
  assert.equal(await text(confirm.locator(t('delete-confirm-yes'))), 'Delete');
  assert.equal(await text(confirm.locator(t('delete-confirm-no'))), 'Cancel');
  await confirm.locator(t('delete-confirm-no')).click();
  assert.equal(await card(b, 'Mine').count(), 1, 'Cancel keeps the card');
  await card(b, 'Mine').locator(t('delete-btn')).click();
  await card(b, 'Mine').locator(t('delete-confirm-yes')).click();
  await card(b, 'Mine').waitFor({ state: 'detached', timeout: 2000 });
  assert.equal(await activeTestId(b), 'new-actions', 'focus moves to the column card box');
  await said.heard('Card deleted');
  await card(a, 'Mine').waitFor({ state: 'detached', ...POLL });

  await card(a, 'Facilitator card').locator(t('delete-btn')).click();
  assert.match(await text(card(a, 'Facilitator card').locator(t('delete-confirm'))), /Delete this card\?/);
}));

test('J7: sort by votes changes only this viewer, toggles back, and is remembered in the browser', () => run(async ({ app, open }) => {
  const a = await open(app.url);
  const link = await createBoard(a, app.url);
  const b = await open(link);
  for (const c of ['Old no votes', 'Old tie', 'Top', 'New tie']) await addCard(b, 'went-well', c);
  await card(a, 'New tie').waitFor(POLL);
  for (const c of ['Top', 'Old tie', 'New tie']) await card(b, c).locator(t('vote-btn')).click();
  await expectText(b.locator(t('votes-left')), 'No votes left');
  await card(a, 'Top').locator(t('vote-btn')).click(); // Top: 2, the ties: 1 each
  await expectText(card(b, 'Top').locator(t('vote-count')), /^2/);

  const added = ['Old no votes', 'Old tie', 'Top', 'New tie'];
  const sorted = ['Top', 'Old tie', 'New tie', 'Old no votes'];
  assert.equal(await text(b.locator(t('sort-toggle'))), 'Sort by votes');
  await b.locator(t('sort-toggle')).click();
  assert.equal(await b.locator(t('sort-toggle')).getAttribute('aria-pressed'), 'true');
  assert.equal(await text(b.locator(t('sort-toggle'))), 'Sorted by votes');
  assert.deepEqual(await cardTexts(b, 'went-well'), sorted, 'highest first, ties keep the older card first');
  assert.deepEqual(await cardTexts(a, 'went-well'), added, 'the other viewer is unchanged');

  await b.reload();
  await card(b, 'Top').waitFor(POLL);
  assert.equal(await b.locator(t('sort-toggle')).getAttribute('aria-pressed'), 'true', 'choice kept in this browser');
  assert.deepEqual(await cardTexts(b, 'went-well'), sorted);
  await b.locator(t('sort-toggle')).click();
  assert.equal(await b.locator(t('sort-toggle')).getAttribute('aria-pressed'), 'false');
  assert.deepEqual(await cardTexts(b, 'went-well'), added);
}));

test('J8: changes from others arrive by polling without touching focus or a draft; offline is shown', () => run(async ({ app, open, stopServer }) => {
  const a = await open(app.url);
  const link = await createBoard(a, app.url);
  const b = await open(link);
  const said = await recordAnnouncements(a);
  const draft = a.locator(t('new-went-well'));
  await draft.fill('half typed');
  await draft.focus();

  // Two cards inside one poll are announced as one batch. Polls are 3 s apart, so two quick adds can
  // straddle a poll; in that case add another pair rather than fail on timing.
  let batched = false;
  for (let round = 1; round <= 3 && !batched; round += 1) {
    await addCard(b, 'actions', `Other ${round}a`);
    await addCard(b, 'actions', `Other ${round}b`);
    await card(a, `Other ${round}b`).waitFor(POLL);
    batched = (await said.all()).some((m) => m.includes('2 new cards from others'));
  }
  assert.equal(batched, true, `expected "2 new cards from others", heard ${JSON.stringify(await said.all())}`);
  assert.equal(await draft.inputValue(), 'half typed', 'the draft is not cleared');
  assert.equal(await activeTestId(a), 'new-went-well', 'focus is not moved');

  await card(b, 'Other 1a').locator(t('delete-btn')).click();
  await card(b, 'Other 1a').locator(t('delete-confirm-yes')).click();
  await said.heard('1 card removed');
  assert.equal(await card(a, 'Other 1a').count(), 0);
  assert.equal(await draft.inputValue(), 'half typed');

  await stopServer();
  await expectText(a.locator(t('offline-banner')), 'You are offline or the server is not reachable. Showing the last version. Trying again...', { timeout: 10000 });
}));

test('J9: close and reopen: banner and controls change for everyone; only the facilitator can still delete', () => run(async ({ app, open }) => {
  const a = await open(app.url);
  const link = await createBoard(a, app.url);
  const b = await open(link);
  await addCard(b, 'went-well', 'Participant card');
  await card(a, 'Participant card').waitFor(POLL);
  await card(b, 'Participant card').locator(t('vote-btn')).click();
  const said = await recordAnnouncements(b);

  await a.locator(t('close-retro')).click();
  await expectText(a.locator(t('closed-banner')), 'This retro is closed. No more cards or votes.');
  for (const id of ['add-went-well', 'new-went-well', 'vote-btn', 'close-retro']) assert.equal(await a.locator(t(id)).count(), 0, `${id} removed for the facilitator`);
  assert.equal(await text(a.locator(t('reopen-retro'))), 'Reopen retro');
  assert.equal(await activeTestId(a), 'reopen-retro', 'focus stays on the button');
  assert.equal(await card(a, 'Participant card').locator(t('delete-btn')).count(), 1, 'facilitator can still delete');

  await expectText(b.locator(t('closed-banner')), 'This retro is closed. No more cards or votes.');
  await said.heard('This retro is closed.');
  for (const id of ['add-went-well', 'new-actions', 'vote-btn', 'delete-btn']) assert.equal(await b.locator(t(id)).count(), 0, `${id} removed for the participant`);
  assert.match(await text(card(b, 'Participant card').locator(t('vote-count'))), /^1/, 'counts remain');

  await a.locator(t('reopen-retro')).click();
  await a.locator(t('closed-banner')).waitFor({ state: 'detached', ...POLL });
  assert.equal(await a.locator(t('add-went-well')).count(), 1);
  await b.locator(t('closed-banner')).waitFor({ state: 'detached', ...POLL });
  await said.heard('The retro is open again.');
  assert.equal(await b.locator(t('add-went-well')).count(), 1);
  assert.equal(await card(b, 'Participant card').locator(t('vote-btn')).count(), 1);
}));

test('J10: export markdown preview, copy and download, open or closed', () => run(async ({ app, open }) => {
  const a = await open(app.url);
  const link = await createBoard(a, app.url);
  const b = await open(link);
  await addCard(a, 'went-well', 'Pair less');
  await addCard(a, 'went-well', 'Pair more');
  await addCard(a, 'actions', 'Write the runbook');
  await card(b, 'Write the runbook').waitFor(POLL);
  for (const page of [a, b]) for (const c of ['Pair more', 'Write the runbook']) await card(page, c).locator(t('vote-btn')).click();
  await expectText(card(a, 'Pair more').locator(t('vote-count')), /^2/);
  await expectText(card(a, 'Write the runbook').locator(t('vote-count')), /^2/);

  await a.locator(t('export-link')).click();
  await a.waitForURL(/\/export$/);
  const preview = a.locator(t('export-preview'));
  await expectText(preview, /# Sprint 12/);
  const md = await preview.textContent();
  assert.match(md, /^# Sprint 12\n\nDate: \d{4}-\d{2}-\d{2}\n/);
  const order = ['## Went well', '- Pair more (2 votes)', '- Pair less (0 votes)', '## To improve', '_No cards._', '## Actions', '- [ ] Write the runbook (2 votes)'].map((s) => md.indexOf(s));
  assert.ok(order.every((i) => i >= 0), `all expected lines are present: ${order}`);
  assert.deepEqual([...order].sort((x, y) => x - y), order, 'sections in order, highest-voted card first');
  assert.equal(await text(a.locator('#back-to-board')), 'Back to board');

  const said = await recordAnnouncements(a);
  await a.locator(t('copy-markdown')).click();
  await expectText(a.locator(t('copy-markdown')), 'Copied', { timeout: 1000 });
  await said.heard('Markdown copied to clipboard');
  assert.equal(await a.evaluate(() => navigator.clipboard.readText()), md);

  const [download] = await Promise.all([a.waitForEvent('download'), a.locator(t('download-markdown')).click()]);
  assert.equal(download.suggestedFilename(), 'sprint-12.md');
  assert.equal(fs.readFileSync(await download.path(), 'utf8'), md);

  // Works when the retro is closed too.
  await a.locator('#back-to-board').click();
  await a.locator(t('close-retro')).click();
  await a.locator(t('closed-banner')).waitFor(POLL);
  await a.locator(t('export-link')).click();
  await expectText(a.locator(t('export-preview')), /# Sprint 12/);
}));

test('J11: after a restart both links show the same board; an open page goes offline and recovers by itself', () => run(async ({ app, open, stopServer, restartServer }) => {
  const a = await open(app.url);
  const link = await createBoard(a, app.url);
  const b = await open(link);
  await addCard(b, 'to-improve', 'Survives restart');
  await card(b, 'Survives restart').locator(t('vote-btn')).click();
  await expectText(b.locator(t('votes-left')), '2 votes left');
  await a.locator(t('close-retro')).click();
  await b.locator(t('closed-banner')).waitFor(POLL);
  const said = await recordAnnouncements(b);

  await stopServer();
  await b.locator(t('offline-banner')).waitFor({ timeout: 10000 });
  await restartServer();
  await b.locator(t('offline-banner')).waitFor({ state: 'detached', timeout: 15000 });
  await said.heard('Back online. Board updated.', 1000);

  for (const page of [a, b]) {
    await page.reload();
    await card(page, 'Survives restart').waitFor(POLL);
    assert.equal(await text(page.locator(t('board-title'))), 'Sprint 12');
    assert.match(await text(card(page, 'Survives restart').locator(t('vote-count'))), /^1/);
    assert.equal(await page.locator(t('closed-banner')).count(), 1, 'still closed');
  }
  assert.equal(await text(a.locator(t('role-badge'))), 'Facilitator view');
  assert.equal(await a.locator(t('reopen-retro')).count(), 1);
}));

test('J12: a mistyped link shows Board not found; a wrong facilitator part gives only the participant view', () => run(async ({ app, open }) => {
  const a = await open(app.url);
  const link = await createBoard(a, app.url);
  const bad = await open(`${link.slice(0, -1)}${link.endsWith('A') ? 'B' : 'A'}`);
  assert.equal(await text(bad.locator('h1')), 'Board not found');
  assert.equal(await text(bad.locator('#nf-text')), 'That link does not match any board. Check it for typos, or ask the person who shared it to send it again.');
  await bad.getByRole('link', { name: 'Create a new retro' }).click();
  await bad.locator('#create-form').waitFor();
  assert.equal(new URL(bad.url()).pathname, '/');

  const wrong = await open(`${link}/f/${'x'.repeat(22)}`);
  await wrong.locator(t('columns')).waitFor();
  assert.equal(await text(wrong.locator(t('role-badge'))), 'Participant view');
  for (const id of ['close-retro', 'reopen-retro', 'export-link', 'share-panel', 'facilitator-link']) assert.equal(await wrong.locator(t(id)).count(), 0, `${id} never shown`);
}));

test('J13: first use in two browsers, start to downloaded export, using only visible labelled controls', () => run(async ({ app, open }) => {
  const started = Date.now();
  const a = await open(app.url);
  await a.getByLabel('Title').fill('Sprint 12');
  await a.getByRole('button', { name: 'Create retro' }).click();
  await a.locator(t('columns')).waitFor();
  assert.equal(await text(a.locator(t('empty-went-well'))), HINTS['went-well'], 'the empty state says what to do');
  await a.getByRole('button', { name: 'Copy participant link' }).click();
  const b = await open(await a.evaluate(() => navigator.clipboard.readText()));
  await b.locator(t('columns')).waitFor();

  const add = async (page, label, value) => {
    const column = page.locator('section.column').filter({ has: page.getByRole('heading', { name: label }) });
    await column.getByLabel(`Add a card to ${label}`).fill(value);
    await column.getByRole('button', { name: 'Add card' }).click();
    await card(page, value).waitFor(POLL);
  };
  for (const label of ['Went well', 'To improve', 'Actions']) { await add(a, label, `${label} from A`); await add(b, label, `${label} from B`); }
  await eventually(async () => (await a.locator(t('card')).count()) === 6 && (await b.locator(t('card')).count()) === 6, 'both browsers show 6 cards');
  for (const page of [a, b]) {
    for (let i = 0; i < 3; i += 1) await page.locator('button').filter({ hasText: /^Vote$/ }).first().click(); // by its visible label
    await expectText(page.locator(t('votes-left')), 'No votes left');
  }
  await a.getByRole('button', { name: 'Close retro' }).click();
  await b.locator(t('closed-banner')).waitFor(POLL);
  await a.locator(t('closed-banner')).waitFor(POLL);
  await a.getByRole('link', { name: 'Export markdown' }).click();
  const [download] = await Promise.all([a.waitForEvent('download'), a.getByRole('link', { name: 'Download .md' }).click()]);
  const md = fs.readFileSync(await download.path(), 'utf8');
  assert.match(md, /^# Sprint 12/);
  assert.equal(md.split('\n').filter((l) => /^- (\[ \] )?.+ \(\d votes?\)$/.test(l)).length, 6);
  assert.ok(Date.now() - started < 5 * 60 * 1000, 'under 5 minutes');
}));
