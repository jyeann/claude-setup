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

// Start the product exactly as the README says and wait until it tells us where it listens.
//
// Port contract: never pick a port yourself and then start the server. Between "this port is free" and the
// server binding it, another test (or another process) can take it, and the run fails with "Port N is in use".
// Instead the test asks for port 0 (PORT=0) and the OS gives the server a free one. The server must therefore:
//   1. listen on process.env.PORT, and treat PORT=0 as "any free port" (server.listen(0) does this), and
//   2. print the port it really bound, on stdout, in a line containing http://127.0.0.1:<port> or
//      "port <n>" / "listening on <n>" (use server.address().port, not the PORT variable, which is still 0).
// If your product prints something else, change PORT_LINE below; do not fall back to a random port.
const PORT_LINE = /https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\]|0\.0\.0\.0):(\d+)|(?:port|listening on)\s+(\d+)/i;

async function startServer() {
  const proc = spawn('node', ['src/server.js'], { cwd: ROOT, env: { ...process.env, PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  let exited = false;
  proc.once('exit', () => { exited = true; });
  proc.stderr.on('data', (d) => { log += d; });
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server did not print its port within 10 s. Output: ${log}`)), 10000);
    proc.stdout.on('data', (d) => {
      log += d;
      const m = PORT_LINE.exec(log);
      if (m) { clearTimeout(timer); resolve(Number(m[1] ?? m[2])); }
    });
    proc.once('exit', (code) => { clearTimeout(timer); reject(new Error(`server exited with code ${code} before it printed its port. Output: ${log}`)); });
  });
  if (exited) throw new Error(`server exited right after printing its port. Output: ${log}`);
  return { proc, baseUrl: `http://127.0.0.1:${port}` };
}

test.before(async () => {
  ({ proc: server, baseUrl } = await startServer());
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
