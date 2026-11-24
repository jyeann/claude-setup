'use strict';
// Shared helpers for the browser walkthrough of docs/product/retro-board/ux.md.
// Every test starts its own server (own DATA_DIR, own port), so the per-address rate limit on creating
// boards never couples tests, and a test can stop or restart "its" server freely.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const POLL = { timeout: 5000 }; // ux.md: "Poll waits are at most 5 seconds"
const t = (id) => `[data-testid="${id}"]`;

const freePort = () => new Promise((resolve, reject) => {
  const srv = net.createServer();
  srv.on('error', reject);
  srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
});

// Start the product exactly as the README says (`node src/server.js`) and wait for the address line.
async function startApp(opts = {}) {
  // Picking a free port and binding it later can race with a parallel test; retry unless the port was asked for.
  for (let attempt = 1; ; attempt += 1) {
    try { return await startAppOnce(opts); } catch (err) {
      if (opts.port || attempt >= 5 || !/in use|EADDRINUSE/i.test(err.message)) throw err;
    }
  }
}

async function startAppOnce({ dataDir, port } = {}) {
  const dir = dataDir || fs.mkdtempSync(path.join(os.tmpdir(), 'retro-journey-'));
  const p = port || await freePort();
  const child = spawn(process.execPath, ['src/server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(p), DATA_DIR: dir }, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d; });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server not ready after 10 s. stderr: ${stderr}`)), 10000);
    child.stdout.on('data', (d) => { stdout += d; if (stdout.includes('http://localhost:')) { clearTimeout(timer); resolve(); } });
    child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`server exited (${code}) before it was ready. stderr: ${stderr}`)); });
  });
  // SIGTERM, not SIGKILL: a killed server writes no coverage.
  const stop = () => new Promise((resolve) => {
    if (child.exitCode !== null) return resolve();
    child.once('exit', () => resolve());
    child.kill('SIGTERM');
  });
  return { url: `http://localhost:${p}`, port: p, dataDir: dir, stdout: () => stdout, stop };
}

// One Chromium per test file; one server and fresh browser contexts per test.
function harness(test) {
  let browser;
  test.before(async () => { browser = await chromium.launch(); });
  test.after(async () => { await browser?.close(); });

  // run(async ({app, open, restart}) => ...): `open(url, {width})` returns a page in a NEW isolated context
  // (a separate person: own localStorage, so own client id and own 3 votes).
  return async function run(body) {
    let app = await startApp();
    const contexts = [];
    const ctl = {
      get app() { return app; },
      async context({ width = 1100, height = 900 } = {}) {
        const ctx = await browser.newContext({ viewport: { width, height }, acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write'] });
        contexts.push(ctx);
        return ctx;
      },
      async open(url, size) {
        const page = await (await ctl.context(size)).newPage();
        await page.goto(url);
        return page;
      },
      async stopServer() { await app.stop(); },
      async restartServer() { await app.stop(); app = await startApp({ dataDir: app.dataDir, port: app.port }); },
    };
    try { await body(ctl); } finally {
      for (const c of contexts) await c.close().catch(() => {});
      await app.stop();
    }
  };
}

// --- steps a person takes, through visible controls only ---

async function createBoard(page, baseUrl, title = 'Sprint 12') {
  if (new URL(page.url()).pathname !== '/') await page.goto(baseUrl);
  await page.locator(t('title-input')).fill(title);
  await page.locator(t('create-submit')).click();
  await page.waitForURL(/\/b\/[^/]+\/f\/[^/]+$/);
  await page.locator(t('columns')).waitFor();
  return page.locator(t('participant-link')).inputValue();
}

async function addCard(page, column, text) {
  await page.locator(t(`new-${column}`)).fill(text);
  await page.locator(t(`add-${column}`)).click();
  await card(page, text).and(page.locator('li.card:not(.is-saving)')).waitFor(POLL);
}

const card = (page, text) => page.locator(`li${t('card')}`).filter({ has: page.locator(t('card-text')).getByText(text, { exact: true }) });
const cardTexts = (page, column) => page.locator(`${t(`cards-${column}`)} ${t('card-text')}`).allTextContents();
const text = async (locator) => (await locator.textContent()).trim();
const activeTestId = (page) => page.evaluate(() => document.activeElement?.getAttribute('data-testid') || document.activeElement?.id || document.activeElement?.tagName);

async function expectText(locator, expected, opts = POLL) {
  await locator.filter({ hasText: expected }).first().waitFor(opts);
  if (typeof expected === 'string') assert.equal(await text(locator.first()), expected);
}

// A vote shows at once; the server confirms it a moment later, and until then #votes-left has aria-busy="true".
// Wait for that before anything that needs the server to have the vote: a reload, a restart, closing the retro.
async function votesSaved(page) {
  await page.locator(`${t('votes-left')}:not([aria-busy="true"])`).waitFor({ ...POLL, state: 'attached' });
}

// Wait until fn() resolves truthy, polling the page the way a person watches it; fails after `timeout`.
async function eventually(fn, message, timeout = 5000) {
  const end = Date.now() + timeout;
  let last;
  for (;;) {
    try { last = await fn(); if (last) return last; } catch (err) { last = err; }
    if (Date.now() > end) assert.fail(`${message} (last: ${last instanceof Error ? last.message : JSON.stringify(last)})`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

// Record every message written to #live-polite, because messages are replaced on later polls.
async function recordAnnouncements(page) {
  await page.evaluate(() => {
    window.__said = [];
    const el = document.getElementById('live-polite');
    new MutationObserver(() => { const s = el.textContent.trim(); if (s) window.__said.push(s); }).observe(el, { childList: true, characterData: true, subtree: true });
  });
  return { all: () => page.evaluate(() => window.__said), heard: (msg, timeout = 5000) => eventually(async () => (await page.evaluate(() => window.__said)).includes(msg), `#live-polite never said "${msg}"`, timeout) };
}

module.exports = { ROOT, POLL, t, startApp, harness, createBoard, addCard, card, cardTexts, text, activeTestId, expectText, eventually, recordAnnouncements, votesSaved };
