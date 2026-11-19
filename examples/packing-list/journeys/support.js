'use strict';
// Shared helpers for the journey tests (not a test file: the name does not match *.test.js).
// Rules: drive the real page like a person; never call the API or import from src/.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const SERVER_FILE = path.join(ROOT, 'src', 'server.js');
const TEST_TIMEOUT = 90000;

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

// Start the product as documented: node src/server.js with PORT and DATA_FILE. Fails fast, never hangs.
async function startServer({ port, dataFile }) {
  if (!fs.existsSync(SERVER_FILE)) {
    throw new Error(`Product missing: ${SERVER_FILE} does not exist, cannot start the server`);
  }
  const proc = spawn(process.execPath, ['src/server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), DATA_FILE: dataFile },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const srv = { proc, port, dataFile, url: `http://127.0.0.1:${port}`, stdout: '', stderr: '', exited: false, exitCode: null };
  srv.exitPromise = new Promise((resolve) => {
    proc.once('exit', (code, signal) => {
      srv.exited = true;
      srv.exitCode = code;
      srv.signal = signal;
      resolve({ code, signal });
    });
    proc.once('error', (err) => {
      srv.exited = true;
      srv.stderr += String(err);
      resolve({ code: null, signal: null });
    });
  });
  proc.stdout.on('data', (d) => { srv.stdout += d; });
  proc.stderr.on('data', (d) => { srv.stderr += d; });
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (srv.exited) {
      throw new Error(`Server exited before it was ready (code ${srv.exitCode}). stdout: ${srv.stdout} stderr: ${srv.stderr}`);
    }
    if (/Packing list running at http:\/\/\S+/.test(srv.stdout)) {
      try {
        const r = await fetch(srv.url + '/');
        if (r.status) return srv;
      } catch { /* not listening yet */ }
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  proc.kill('SIGTERM');
  throw new Error(`Server not ready within 10 s. stdout: ${srv.stdout} stderr: ${srv.stderr}`);
}

// SIGTERM only (never SIGKILL); waits for exit. Returns the exit code.
async function stopServer(srv) {
  if (!srv || srv.exited) return srv ? srv.exitCode : null;
  srv.proc.kill('SIGTERM');
  const res = await Promise.race([
    srv.exitPromise,
    new Promise((resolve) => setTimeout(() => resolve('timeout'), 8000)),
  ]);
  if (res === 'timeout') throw new Error('Server did not exit within 8 s after SIGTERM');
  return srv.exitCode;
}

// Run fn with a fresh server, temp DATA_FILE and a Chromium browser; always cleans up.
async function withApp(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'packing-journey-'));
  const dataFile = path.join(dir, 'lists.json');
  const port = await freePort();
  const app = { dir, dataFile, port, url: `http://127.0.0.1:${port}`, contexts: [] };
  let browser;
  try {
    app.server = await startServer({ port, dataFile });
    browser = await chromium.launch();
    app.browser = browser;
    app.newContext = async (opts = {}) => {
      const ctx = await browser.newContext({
        permissions: ['clipboard-read', 'clipboard-write'],
        ...opts,
      });
      ctx.setDefaultTimeout(8000);
      app.contexts.push(ctx);
      return ctx;
    };
    app.newPage = async (opts = {}) => (await app.newContext(opts)).newPage();
    return await fn(app);
  } finally {
    try { await browser?.close(); } catch { /* ignore */ }
    try { await stopServer(app.server); } catch { /* ignore */ }
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// Poll an assertion function until it passes or the timeout (default 5 s) runs out.
async function eventually(fn, timeout = 5000, label = 'condition') {
  const end = Date.now() + timeout;
  let last;
  for (;;) {
    try { return await fn(); } catch (e) { last = e; }
    if (Date.now() > end) throw new Error(`Not met within ${timeout} ms (${label}): ${last && last.message}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

const itemCount = (page) => page.locator('ul#items > li').count();
const checkbox = (page, text) => page.getByRole('checkbox', { name: text, exact: true });
const removeButton = (page, text) => page.getByRole('button', { name: `Remove ${text}`, exact: true });
const progressText = (page) => page.locator('#progress');

async function createList(page, baseUrl, name) {
  await page.goto(baseUrl + '/');
  await page.getByRole('textbox', { name: 'Trip name' }).fill(name);
  await page.getByRole('button', { name: 'Create list' }).click();
  await page.waitForURL(/\/l\/[^/]+$/);
  await page.locator('#list-title').waitFor();
}

async function addItem(page, text) {
  const before = await itemCount(page);
  await page.getByRole('textbox', { name: 'New item' }).fill(text);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await eventually(async () => assert.equal(await itemCount(page), before + 1), 5000, `item "${text.slice(0, 20)}" added`);
}

async function tick(page, text) { await checkbox(page, text).check(); }
async function untick(page, text) { await checkbox(page, text).uncheck(); }

async function expectProgress(page, text, timeout = 5000) {
  await eventually(async () => assert.equal((await progressText(page).innerText()).trim(), text), timeout, `progress "${text}"`);
}

async function activeId(page) {
  return page.evaluate(() => (document.activeElement ? document.activeElement.id : null));
}

// Fill the list to n items through the UI (the real way a person would add them).
async function fillToCount(page, n) {
  const input = page.getByRole('textbox', { name: 'New item' });
  const add = page.getByRole('button', { name: 'Add', exact: true });
  for (let i = (await itemCount(page)) + 1; i <= n; i += 1) {
    await input.fill(`Item ${i}`);
    await add.click();
    await eventually(async () => assert.equal(await itemCount(page), i), 5000, `item ${i}`);
  }
}

module.exports = {
  ROOT, TEST_TIMEOUT, freePort, startServer, stopServer, withApp, eventually, itemCount, checkbox,
  removeButton, progressText, createList, addItem, tick, untick, expectProgress, activeId, fillToCount,
};
