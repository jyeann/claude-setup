'use strict';
// Template for the browser walkthrough that verify.js runs as its "journeys" check.
// Copy to <product>/journeys/, one test per journey (J1, J2, ...) and UI acceptance check (UC1, ...) in ux.md.
// Rules the gate enforces: every id in ux.md needs a PASSING test whose name contains that id; no skips.
// Rules it cannot enforce, so follow them: drive the real page the way a person would (click, type, read
// what is on screen); never call the API directly or import from src/ to get a result.
//
// verify.config.json:
//   "journeys": { "command": "node --test \"journeys/*.test.js\"", "uxFile": "../../docs/product/<slug>/ux.md", "minTests": <count> }
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
let server;
let browser;
let baseUrl;

// Start the product exactly as the README says, on a free port, and wait until it answers.
test.before(async () => {
  const port = 20000 + Math.floor(Math.random() * 20000);
  baseUrl = `http://127.0.0.1:${port}`;
  server = spawn('node', ['src/server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
  for (let i = 0; i < 50; i += 1) {
    try { await fetch(baseUrl); break; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  browser = await chromium.launch();
});

// SIGTERM, not SIGKILL: a killed server writes no coverage.
test.after(async () => {
  await browser?.close();
  server?.kill('SIGTERM');
});

test('J1: a visitor opens the home page and sees the main heading', async () => {
  const page = await browser.newPage();
  await page.goto(baseUrl);
  assert.equal(await page.getByRole('heading', { level: 1 }).isVisible(), true);
  await page.close();
});
