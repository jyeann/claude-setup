'use strict';
// The 15 "UI acceptance checks" of docs/testbench/retro-board/ux.md, one test per check (UC1 to UC15, the ids
// the numbered table carries). A = facilitator context, B = participant context, as the table says.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { harness, t, POLL, createBoard, addCard, card, cardTexts, text, activeTestId, expectText, eventually, recordAnnouncements, votesSaved } = require('./helpers');

const run = harness(test);
const COLUMNS = ['went-well', 'to-improve', 'actions'];
const vote = (page, c) => card(page, c).locator(t('vote-btn'));
const votes = async (page, c) => Number.parseInt(await text(card(page, c).locator(t('vote-count'))), 10);

async function pair(open, app) {
  const a = await open(app.url);
  const link = await createBoard(a, app.url);
  const b = await open(link);
  await b.locator(t('columns')).waitFor();
  return { a, b, link };
}

test('UC1: the documented command prints a localhost address and the home page has the create form and no sign-in', () => run(async ({ app, open }) => {
  assert.match(app.stdout(), /http:\/\/localhost:\d+/);
  const a = await open(app.url);
  assert.equal(await text(a.locator('h1')), 'Retro board');
  assert.equal(await a.locator(`form#create-form ${t('title-input')}`).count(), 1);
  assert.equal(await text(a.locator(`form#create-form ${t('create-submit')}`)), 'Create retro');
  assert.equal(await a.locator('input[type=password]').count(), 0);
  assert.equal(await a.getByText(/Sign in|Log in/).count(), 0);
}));

test('UC2: creating "Sprint 12" opens the facilitator view with three empty columns and both links', () => run(async ({ app, open }) => {
  const a = await open(app.url);
  await a.locator(t('title-input')).fill('Sprint 12');
  await a.locator(t('create-submit')).click();
  await a.waitForURL(/\/b\/[A-Za-z0-9_-]{22,}\/f\/[A-Za-z0-9_-]{22,}$/);
  await a.locator(t('columns')).waitFor();
  assert.equal(await text(a.locator(t('board-title'))), 'Sprint 12');
  assert.equal(await text(a.locator(t('role-badge'))), 'Facilitator view');
  assert.deepEqual((await a.locator('section.column h2').allTextContents()).map((s) => s.replace(/\s*\d+\s*$/, '').trim()), ['Went well', 'To improve', 'Actions']);
  for (const key of COLUMNS) assert.equal(await a.locator(t(`empty-${key}`)).isVisible(), true);
  assert.equal(await a.locator(t('card')).count(), 0);
  const participant = await a.locator(t('participant-link')).inputValue();
  assert.match(participant, /^http:\/\/localhost:\d+\/b\/[A-Za-z0-9_-]{22,}$/);
  assert.equal(participant.includes('/f/'), false);
  assert.equal(await text(a.locator(t('copy-participant'))), 'Copy');
  assert.match(await a.locator(t('facilitator-link')).inputValue(), /\/f\//);
  assert.match(await text(a.locator('#facilitator-link-block')), /Keep this private/);
  const share = await text(a.locator('#participant-link-block'));
  assert.match(share, /Participant link/);
  assert.match(share, /Send this link to your team/);
  await a.locator(t('copy-participant')).click();
  await expectText(a.locator(t('copy-participant')), 'Copied', { timeout: 1000 });
}));

test('UC3: an empty or spaces-only title shows the error, keeps focus and the URL, and creates no board', () => run(async ({ app, open }) => {
  const a = await open(app.url);
  for (const title of ['', '   ']) {
    await a.locator(t('title-input')).fill(title);
    await a.locator(t('create-submit')).click();
    await expectText(a.locator(t('title-error')), 'Give your retro a title, for example Sprint 12.');
    assert.equal(await a.locator(t('title-error')).isVisible(), true);
    assert.equal(await activeTestId(a), 'title-input');
    assert.equal(new URL(a.url()).pathname, '/');
  }
  assert.deepEqual(fs.readdirSync(app.dataDir).filter((f) => f.endsWith('.json')), [], 'no board file in the data directory');
}));

test('UC4: the participant link shows the board without facilitator controls; Delete only where allowed', () => run(async ({ app, open }) => {
  const { a, b } = await pair(open, app);
  assert.equal(await text(b.locator(t('board-title'))), 'Sprint 12');
  assert.equal(await text(b.locator(t('role-badge'))), 'Participant view');
  assert.equal(await b.locator('section.column').count(), 3);
  for (const id of ['close-retro', 'reopen-retro', 'export-link', 'facilitator-link']) assert.equal(await b.locator(t(id)).count(), 0, id);
  assert.equal(await b.locator('#share-panel').count(), 0);
  await addCard(b, 'went-well', 'Card by B');
  await addCard(a, 'went-well', 'Card by A');
  await card(b, 'Card by A').waitFor(POLL);
  assert.equal(await card(b, 'Card by A').locator(t('delete-btn')).count(), 0);
  await card(a, 'Card by B').waitFor(POLL);
  assert.equal(await card(a, 'Card by B').locator(t('delete-btn')).count(), 1, 'the facilitator has Delete on B\'s card');
}));

test('UC5: a card added in B shows at once and reaches A within 5 s, announced, without touching A\'s focus or draft', () => run(async ({ app, open }) => {
  const { a, b } = await pair(open, app);
  const said = await recordAnnouncements(a);
  await a.locator(t('new-actions')).fill('draft in A');
  await a.locator(t('new-actions')).focus();
  await b.locator(t('new-to-improve')).fill('Slow builds');
  await b.locator(t('add-to-improve')).click();
  await b.locator(`${t('cards-to-improve')} li.card`).filter({ hasText: 'Slow builds' }).waitFor({ timeout: 500 });
  assert.equal(await b.locator(`${t('cards-to-improve')} li.card`).count(), 1);
  assert.equal(await b.locator(t('new-to-improve')).inputValue(), '');
  assert.equal(await b.locator(t('empty-to-improve')).isVisible(), false);
  await a.locator(t('cards-to-improve')).getByText('Slow builds').waitFor(POLL);
  await said.heard('1 new card from others');
  assert.equal(await activeTestId(a), 'new-actions');
  assert.equal(await a.locator(t('new-actions')).inputValue(), 'draft in A');
}));

test('UC6: empty, 501-character and markup cards are handled as written; 500 characters fit at 390px', () => run(async ({ app, open }) => {
  const a = await open(app.url);
  const link = await createBoard(a, app.url);
  const b = await open(link, { width: 390, height: 800 });
  const box = b.locator(t('new-went-well'));
  const cards = b.locator(`${t('cards-went-well')} ${t('card')}`);
  for (const blank of ['', '   ']) {
    await box.fill(blank);
    await b.locator(t('add-went-well')).click();
    await expectText(b.locator(t('error-went-well')), 'Write something before adding the card.');
    assert.equal(await box.getAttribute('aria-invalid'), 'true');
    assert.equal(await cards.count(), 0);
  }
  await box.fill('a'.repeat(501));
  await b.locator(t('add-went-well')).click();
  await expectText(b.locator(t('error-went-well')), 'That card is 501 characters. The limit is 500. Shorten it by 1.');
  assert.equal(await cards.count(), 0);
  assert.equal(await box.inputValue(), 'a'.repeat(501));

  await addCard(b, 'went-well', '<b>hi</b>');
  assert.equal(await card(b, '<b>hi</b>').locator(t('card-text')).textContent(), '<b>hi</b>');
  assert.equal(await b.locator('.card-text b').count(), 0);

  await addCard(b, 'went-well', 'a'.repeat(500));
  await addCard(b, 'went-well', 'Zx9'.repeat(166) + 'Zx');
  assert.equal(await card(b, 'a'.repeat(500)).locator(t('card-text')).textContent(), 'a'.repeat(500), 'shown in full');
  assert.equal(await b.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'no horizontal scroll at 390px');
}));

test('UC7: three votes, disabled at zero, a vote taken back, all unchanged after a reload', () => run(async ({ app, open }) => {
  const { b } = await pair(open, app);
  for (const c of ['One', 'Two', 'Three', 'Four']) await addCard(b, 'went-well', c);
  const said = await recordAnnouncements(b);
  assert.equal(await text(b.locator(t('votes-left'))), '3 votes left');
  await vote(b, 'One').click();
  await expectText(card(b, 'One').locator(t('vote-count')), /^1/);
  assert.equal(await vote(b, 'One').getAttribute('aria-pressed'), 'true');
  assert.equal(await text(vote(b, 'One')), 'Remove vote');
  await expectText(b.locator(t('votes-left')), '2 votes left');
  await said.heard('2 votes left');
  assert.equal(await vote(b, 'One').evaluate((el) => el === document.activeElement), true);
  await vote(b, 'Two').click();
  await expectText(b.locator(t('votes-left')), '1 vote left');
  await vote(b, 'Three').click();
  await expectText(b.locator(t('votes-left')), 'No votes left');
  assert.equal(await vote(b, 'Four').isDisabled(), true);
  await vote(b, 'Three').click();
  await expectText(b.locator(t('votes-left')), '1 vote left');
  assert.equal(await votes(b, 'Three'), 0);
  assert.equal(await vote(b, 'Four').isDisabled(), false);
  await vote(b, 'Three').click();
  await expectText(b.locator(t('votes-left')), 'No votes left');
  await votesSaved(b);
  const before = await Promise.all(['One', 'Two', 'Three', 'Four'].map(async (c) => [await votes(b, c), await vote(b, c).getAttribute('aria-pressed')]));
  await b.reload();
  await card(b, 'Four').waitFor(POLL);
  assert.equal(await text(b.locator(t('votes-left'))), 'No votes left');
  assert.deepEqual(await Promise.all(['One', 'Two', 'Three', 'Four'].map(async (c) => [await votes(b, c), await vote(b, c).getAttribute('aria-pressed')])), before);
  assert.deepEqual(before, [[1, 'true'], [1, 'true'], [1, 'true'], [0, 'false']]);
}));

test('UC8: a second browser has its own 3 votes and both votes add into the same count', () => run(async ({ app, open }) => {
  const { a, b } = await pair(open, app);
  await addCard(b, 'went-well', 'Shared');
  await vote(b, 'Shared').click();
  await expectText(b.locator(t('votes-left')), '2 votes left');
  await card(a, 'Shared').waitFor(POLL);
  assert.equal(await text(a.locator(t('votes-left'))), '3 votes left');
  await vote(a, 'Shared').click();
  await expectText(card(a, 'Shared').locator(t('vote-count')), /^2/);
  await expectText(card(b, 'Shared').locator(t('vote-count')), /^2/);
  assert.equal(await text(b.locator(t('votes-left'))), '2 votes left', 'B\'s own votes left are not affected');
}));

test('UC9: authors delete their own cards, the facilitator any card; deletions reach the other browser within 5 s', () => run(async ({ app, open }) => {
  const { a, b } = await pair(open, app);
  await addCard(a, 'went-well', 'From A');
  await addCard(b, 'went-well', 'Mine');
  await addCard(b, 'went-well', 'Also by B');
  await card(b, 'From A').waitFor(POLL);
  await card(a, 'Also by B').waitFor(POLL);
  assert.equal(await card(b, 'Mine').locator(t('delete-btn')).count(), 1);
  assert.equal(await card(b, 'From A').locator(t('delete-btn')).count(), 0);
  assert.equal(await a.locator(`${t('card')} ${t('delete-btn')}`).count(), 3, 'Delete on every card for the facilitator');

  await card(b, 'Mine').locator(t('delete-btn')).click();
  assert.match(await text(card(b, 'Mine').locator(t('delete-confirm'))), /Delete this card\?/);
  await card(b, 'Mine').locator(t('delete-confirm-yes')).click();
  await card(b, 'Mine').waitFor({ state: 'detached', timeout: 1000 });
  assert.equal(await activeTestId(b), 'new-went-well');
  await card(a, 'Mine').waitFor({ state: 'detached', ...POLL });

  await card(a, 'Also by B').locator(t('delete-btn')).click();
  await card(a, 'Also by B').locator(t('delete-confirm-yes')).click();
  await card(b, 'Also by B').waitFor({ state: 'detached', ...POLL });
}));

test('UC10: the sort toggle orders each column by votes for this viewer only and toggles back', () => run(async ({ app, open }) => {
  const { a, b } = await pair(open, app);
  for (const c of ['None', 'Two votes', 'One vote']) await addCard(b, 'to-improve', c);
  await card(a, 'One vote').waitFor(POLL);
  await vote(b, 'Two votes').click();
  await vote(b, 'One vote').click();
  await vote(a, 'Two votes').click();
  await expectText(card(b, 'Two votes').locator(t('vote-count')), /^2/);
  const original = await cardTexts(b, 'to-improve');
  await b.locator(t('sort-toggle')).click();
  assert.equal(await b.locator(t('sort-toggle')).getAttribute('aria-pressed'), 'true');
  assert.equal(await text(b.locator(t('sort-toggle'))), 'Sorted by votes');
  for (const key of COLUMNS) {
    const counts = await b.locator(`${t(`cards-${key}`)} ${t('card')}`).evaluateAll((els) => els.map((el) => Number(el.dataset.votes)));
    assert.deepEqual(counts, [...counts].sort((x, y) => y - x), `${key} is non-increasing`);
  }
  assert.deepEqual(await cardTexts(b, 'to-improve'), ['Two votes', 'One vote', 'None']);
  assert.deepEqual(await cardTexts(a, 'to-improve'), original, 'A is unchanged');
  await b.locator(t('sort-toggle')).click();
  assert.deepEqual(await cardTexts(b, 'to-improve'), original);
}));

test('UC11: closing removes add and vote controls for both browsers within 5 s; reopening brings them back', () => run(async ({ app, open }) => {
  const { a, b } = await pair(open, app);
  await addCard(b, 'went-well', 'A card');
  await card(a, 'A card').waitFor(POLL);
  const said = await recordAnnouncements(b);
  await a.locator(t('close-retro')).click();
  await expectText(a.locator(t('closed-banner')), 'This retro is closed. No more cards or votes.');
  assert.equal(await a.locator(t('add-went-well')).count(), 0);
  assert.equal(await a.locator(t('vote-btn')).count(), 0);
  assert.equal(await a.locator(t('reopen-retro')).count(), 1);
  await expectText(b.locator(t('closed-banner')), 'This retro is closed. No more cards or votes.');
  await said.heard('This retro is closed.');
  assert.equal(await b.locator('form.add-form').count(), 0);
  assert.equal(await b.locator(t('vote-btn')).count(), 0);
  assert.equal(await b.locator('body[data-state="closed"]').count(), 1);
  await a.locator(t('reopen-retro')).click();
  await a.locator(t('closed-banner')).waitFor({ state: 'detached', ...POLL });
  assert.equal(await a.locator(t('add-went-well')).count(), 1);
  assert.equal(await a.locator(t('vote-btn')).count(), 1);
  await b.locator(t('add-went-well')).waitFor(POLL);
  assert.equal(await b.locator(t('closed-banner')).count(), 0);
  assert.equal(await b.locator(t('vote-btn')).count(), 1);
}));

test('UC12: the export preview, clipboard copy and downloaded file hold the same markdown; no export without the facilitator part', () => run(async ({ app, open }) => {
  const { a, b, link } = await pair(open, app);
  await addCard(a, 'to-improve', 'Less voted');
  await addCard(a, 'to-improve', 'Voted twice');
  await addCard(a, 'actions', 'Do the thing');
  await addCard(a, 'went-well', '<b>hi</b>');
  await card(b, '<b>hi</b>').waitFor(POLL);
  await vote(a, 'Voted twice').click();
  await vote(b, 'Voted twice').click();
  await vote(b, 'Do the thing').click();
  await expectText(card(a, 'Voted twice').locator(t('vote-count')), /^2/);
  await expectText(card(a, 'Do the thing').locator(t('vote-count')), /^1/);
  const facilitatorUrl = a.url();

  await a.locator(t('export-link')).click();
  await a.waitForURL(/\/export$/);
  await expectText(a.locator(t('export-preview')), /# Sprint 12/);
  const md = await a.locator(t('export-preview')).textContent();
  assert.ok(md.startsWith('# Sprint 12'));
  assert.match(md, /^Date: \d{4}-\d{2}-\d{2}$/m);
  const at = ['## Went well', '## To improve', '- Voted twice (2 votes)', '- Less voted (0 votes)', '## Actions'].map((s) => md.indexOf(s));
  assert.ok(at.every((i) => i >= 0) && at.every((v, i) => i === 0 || v > at[i - 1]), `headings in order, cards by votes descending: ${at}`);
  const actions = md.slice(md.indexOf('## Actions')).split('\n').filter((l) => l.startsWith('-'));
  assert.ok(actions.length === 1 && actions.every((l) => l.startsWith('- [ ] ')), `every Actions line starts "- [ ] ": ${actions}`);
  assert.ok(md.includes('<b>hi</b>'));

  const said = await recordAnnouncements(a);
  await a.locator(t('copy-markdown')).click();
  await expectText(a.locator(t('copy-markdown')), 'Copied', { timeout: 1000 });
  await said.heard('Markdown copied to clipboard');
  assert.equal(await a.evaluate(() => navigator.clipboard.readText()), md);
  const [download] = await Promise.all([a.waitForEvent('download'), a.locator(t('download-markdown')).click()]);
  assert.equal(download.suggestedFilename(), 'sprint-12.md');
  const file = fs.readFileSync(await download.path(), 'utf8');
  assert.equal(file, md);
  assert.ok(file.includes('<b>hi</b>'));

  const noToken = await open(`${link}/export`);
  assert.equal(await text(noToken.locator(t('not-found-title'))), 'Board not found');
  assert.ok(facilitatorUrl.includes('/f/'));
}));

test('UC13: stopping the server shows the offline banner in both browsers; after a restart everything is as it was', () => run(async ({ app, open, stopServer, restartServer }) => {
  const { a, b } = await pair(open, app);
  await addCard(b, 'went-well', 'Kept');
  await addCard(b, 'actions', 'Kept too');
  await vote(b, 'Kept').click();
  await expectText(b.locator(t('votes-left')), '2 votes left');
  await votesSaved(b);
  await card(a, 'Kept too').waitFor(POLL);
  await a.locator(t('close-retro')).click();
  await b.locator(t('closed-banner')).waitFor(POLL);
  const snapshot = async (page) => ({
    title: await text(page.locator(t('board-title'))),
    cards: await page.locator(t('card')).evaluateAll((els) => els.map((el) => `${el.dataset.column}|${el.querySelector('[data-testid="card-text"]').textContent}|${el.dataset.votes}`)),
    closed: await page.locator(t('closed-banner')).count(),
  });
  const before = { a: await snapshot(a), b: await snapshot(b) };
  const said = await recordAnnouncements(b);

  await stopServer();
  await a.locator(t('offline-banner')).waitFor({ timeout: 10000 });
  await b.locator(t('offline-banner')).waitFor({ timeout: 10000 });
  await restartServer();
  await b.locator(t('offline-banner')).waitFor({ state: 'detached', timeout: 15000 }); // clears on its own, no reload
  await said.heard('Back online. Board updated.', 1000);

  for (const [name, page] of [['a', a], ['b', b]]) {
    await page.reload();
    await card(page, 'Kept too').waitFor(POLL);
    assert.deepEqual(await snapshot(page), before[name]);
    assert.equal(before[name].closed, 1);
  }
  // B's "votes left" is hidden while closed (ux.md, Closed state), so read it after reopening.
  await a.locator(t('reopen-retro')).click();
  await expectText(b.locator(t('votes-left')), '2 votes left');
}));

test('UC14: unknown links give Board not found (404); a wrong or missing facilitator part gives the participant view (200)', () => run(async ({ app, open, context }) => {
  const a = await open(app.url);
  const link = await createBoard(a, app.url);
  await addCard(a, 'went-well', 'By the facilitator');
  const facilitatorUrl = a.url();
  const changed = `${link.slice(0, -1)}${link.endsWith('A') ? 'B' : 'A'}`;
  const page = await (await context()).newPage();

  for (const url of [`${app.url}/b/not-a-real-token`, changed]) {
    const res = await page.goto(url);
    assert.equal(res.status(), 404);
    assert.equal(await text(page.locator(t('not-found-title'))), 'Board not found');
    assert.equal(await text(page.locator(t('create-new-link'))), 'Create a new retro');
  }
  await page.locator(t('create-new-link')).click();
  await page.locator('#create-form').waitFor();
  assert.equal(new URL(page.url()).pathname, '/');

  for (const url of [`${link}/f/${'w'.repeat(22)}`, facilitatorUrl.replace(/\/f\/.*$/, '')]) {
    const res = await page.goto(url);
    assert.equal(res.status(), 200);
    await card(page, 'By the facilitator').waitFor(POLL);
    assert.equal(await text(page.locator(t('role-badge'))), 'Participant view');
    for (const id of ['close-retro', 'export-link', 'delete-btn']) assert.equal(await page.locator(t(id)).count(), 0, id);
    assert.equal(await page.locator('#share-panel').count(), 0);
  }
  assert.equal((await page.goto(`${app.url}/no/such/path`)).status(), 404);
  assert.equal((await page.goto(facilitatorUrl)).status(), 200);
}));

test('UC15: the whole first-use flow in two browsers with no console errors, then the layout at 1100px and 390px', () => run(async ({ app, open }) => {
  const started = Date.now();
  const errors = [];
  const a = await open(app.url);
  a.on('console', (m) => { if (m.type() === 'error') errors.push(`A: ${m.text()}`); });
  a.on('pageerror', (e) => errors.push(`A: ${e.message}`));
  const link = await createBoard(a, app.url);
  const b = await open(link);
  b.on('console', (m) => { if (m.type() === 'error') errors.push(`B: ${m.text()}`); });
  b.on('pageerror', (e) => errors.push(`B: ${e.message}`));
  await b.locator(t('columns')).waitFor();
  for (const key of COLUMNS) { await addCard(a, key, `${key} A`); await addCard(b, key, `${key} B`); }
  await eventually(async () => (await a.locator(t('card')).count()) === 6 && (await b.locator(t('card')).count()) === 6, 'six cards in both browsers');
  for (const page of [a, b]) for (const key of COLUMNS) await vote(page, `${key} A`).click();
  await expectText(a.locator(t('votes-left')), 'No votes left');
  await expectText(b.locator(t('votes-left')), 'No votes left');
  for (const page of [a, b]) await votesSaved(page); // before the retro closes

  // Layout, while the controls are on screen.
  const boxes = (page) => page.locator('section.column').evaluateAll((els) => els.map((el) => { const r = el.getBoundingClientRect(); return { left: Math.round(r.left), top: Math.round(r.top) }; }));
  const wide = await boxes(a);
  assert.equal(new Set(wide.map((r) => r.left)).size, 3, 'three columns side by side at 1100px');
  assert.equal(new Set(wide.map((r) => r.top)).size, 1);
  await a.setViewportSize({ width: 390, height: 800 });
  const narrow = await boxes(a);
  assert.equal(new Set(narrow.map((r) => r.left)).size, 1, 'stacked at 390px');
  assert.ok(narrow[0].top < narrow[1].top && narrow[1].top < narrow[2].top);
  assert.equal(await a.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'no horizontal scroll');
  for (const sel of [t('add-went-well'), t('vote-btn'), t('close-retro'), t('copy-participant')]) {
    const heights = await a.locator(sel).evaluateAll((els) => els.filter((el) => el.offsetParent !== null).map((el) => el.getBoundingClientRect().height));
    assert.ok(heights.length > 0, `${sel} is on screen at 390px`);
    assert.ok(heights.every((h) => h >= 44), `${sel} is at least 44px tall: ${heights}`);
  }
  await a.setViewportSize({ width: 1100, height: 900 });

  await a.locator(t('close-retro')).click();
  await a.locator(t('closed-banner')).waitFor(POLL);
  await b.locator(t('closed-banner')).waitFor(POLL);
  await a.locator(t('export-link')).click();
  const [download] = await Promise.all([a.waitForEvent('download'), a.locator(t('download-markdown')).click()]);
  const md = fs.readFileSync(await download.path(), 'utf8');
  assert.ok(md.includes('# Sprint 12'));
  assert.equal(md.split('\n').filter((l) => /^- (\[ \] )?.+ \(\d votes?\)$/.test(l)).length, 6);
  assert.ok(Date.now() - started < 5 * 60 * 1000);
  assert.deepEqual(errors, [], 'no console errors');
}));
