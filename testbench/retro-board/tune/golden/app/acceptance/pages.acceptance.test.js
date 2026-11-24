'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { withServer, newClientId, createBoard } = require('./helpers');

const KEYS = ['went-well', 'to-improve', 'actions'];
const unknownToken = () => newClientId();

// Fetch a page plus every same-origin script (and the modules those import) and stylesheet it references.
async function collect(s, pagePath) {
  const page = await s.call('GET', pagePath);
  const sources = { html: page.text, scripts: {}, css: {}, status: page.status, headers: page.headers };
  const queue = [];
  for (const m of page.text.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)) queue.push(m[1]);
  const styles = [...page.text.matchAll(/<link\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/gi)]
    .filter((m) => /stylesheet/i.test(m[0])).map((m) => m[1]);
  const seen = new Set();
  while (queue.length) {
    const url = queue.shift();
    if (seen.has(url) || !url.startsWith('/')) continue;
    seen.add(url);
    const res = await s.call('GET', url);
    sources.scripts[url] = res;
    for (const m of res.text.matchAll(/(?:from\s*|import\s*\(?\s*)["']([^"']+)["']/g)) {
      if (m[1].startsWith('.') || m[1].startsWith('/')) queue.push(new URL(m[1], `http://x${url}`).pathname);
    }
  }
  for (const url of styles) if (url.startsWith('/')) sources.css[url] = await s.call('GET', url);
  sources.all = [sources.html, ...Object.values(sources.scripts).map((r) => r.text), ...Object.values(sources.css).map((r) => r.text)].join('\n');
  return sources;
}

// A testid counts as present when its literal value is in the HTML or served JS, or (per-column ids)
// when the prefix and the column key are both there so it can be built as `prefix + key`.
function hasTestId(all, id) {
  if (all.includes(id)) return true;
  const key = KEYS.find((k) => id.endsWith(`-${k}`));
  if (!key) return false;
  const prefix = id.slice(0, -key.length);
  return all.includes(prefix) && all.includes(key);
}
const missing = (all, ids) => ids.filter((id) => !hasTestId(all, id));

const COLUMN_IDS = ['count', 'cards', 'empty', 'new', 'add', 'error'].flatMap((p) => KEYS.map((k) => `${p}-${k}`));
const BOARD_IDS = [
  'board-title', 'role-badge', 'status-region', 'votes-left', 'sort-toggle', 'columns', 'close-retro', 'reopen-retro',
  'export-link', 'share-panel', 'participant-link', 'facilitator-link', 'copy-participant', 'copy-facilitator',
  'participant-link-block', 'facilitator-link-block', 'loading', 'offline-banner', 'closed-banner', 'draft-rescue',
  'card', 'card-text', 'vote-count', 'vote-btn', 'delete-btn', 'delete-confirm', 'delete-confirm-yes', 'delete-confirm-no',
  ...COLUMN_IDS,
];

// ---- home (SC1) ------------------------------------------------------------

test('home page is HTML with the Create a retro form, a title field and no sign-in', () => withServer(async (s) => {
  const res = await s.call('GET', '/');
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /text\/html/);
  assert.match(res.text, /<html[^>]*\blang=["']en["']/i);
  assert.match(res.text, /<title>\s*Retro board\s*<\/title>/);
  assert.match(res.text, /<h1[^>]*>\s*Retro board\s*<\/h1>/);
  assert.match(res.text, /Create a retro/);
  assert.match(res.text, /Run a retro in three columns\. No sign-up, no names\./);
  assert.match(res.text, /id=["']create-form["']/);
  assert.match(res.text, /maxlength=["']100["']/i);
  assert.match(res.text, /<main[^>]*id=["']main["']/);
  assert.match(res.text, /id=["']skip-link["']/);
  assert.doesNotMatch(res.text, /type=["']password["']/i);
  assert.doesNotMatch(res.text, /\b(sign[ -]?in|log[ -]?in)\b/i);
}));

test('home page contains the testids ux.md names for it', () => withServer(async (s) => {
  const home = await collect(s, '/');
  const ids = ['title-input', 'create-submit', 'title-error'];
  assert.deepEqual(missing(home.all, ids), []);
  assert.match(home.html, /data-testid=["']title-input["']/);
  assert.match(home.html, /data-testid=["']create-submit["']/);
  assert.match(home.html, /Create retro/);
}));

// ---- board pages (SC2, SC4, SC14) ------------------------------------------

test('participant and facilitator links both serve the board page with 200', () => withServer(async (s) => {
  const { p, f } = await createBoard(s);
  const part = await s.call('GET', `/b/${p}`);
  const fac = await s.call('GET', `/b/${p}/f/${f}`);
  assert.equal(part.status, 200);
  assert.equal(fac.status, 200);
  assert.match(part.headers['content-type'], /text\/html/);
  assert.match(fac.text, /<h1/);
  assert.match(fac.text, /<main[^>]*id=["']main["']/);
  assert.match(fac.text, /id=["']skip-link["']/);
  assert.doesNotMatch(part.text, /Board not found/);
}));

test('a wrong or truncated facilitator token still serves the participant board with 200', () => withServer(async (s) => {
  const { p, f } = await createBoard(s);
  for (const tail of [`/f/${unknownToken()}`, `/f/${f.slice(0, 6)}`]) {
    const res = await s.call('GET', `/b/${p}${tail}`);
    assert.equal(res.status, 200, tail);
    assert.doesNotMatch(res.text, /Board not found/);
  }
}));

test('board page names every ux.md testid in its HTML or scripts (more than 15)', () => withServer(async (s) => {
  const { p, f } = await createBoard(s);
  const board = await collect(s, `/b/${p}/f/${f}`);
  assert.ok(BOARD_IDS.length > 15);
  assert.deepEqual(missing(board.all, BOARD_IDS), []);
  assert.match(board.all, /status-region|live-polite/);
  assert.ok(board.all.includes('live-polite') && board.all.includes('live-assertive'));
}));

test('board page scripts and styles it references are served with the right content type', () => withServer(async (s) => {
  const { p } = await createBoard(s);
  const board = await collect(s, `/b/${p}`);
  assert.ok(Object.keys(board.scripts).length >= 1, 'page references a script');
  assert.ok(Object.keys(board.css).length >= 1, 'page references a stylesheet');
  for (const [url, res] of Object.entries(board.scripts)) {
    assert.equal(res.status, 200, url);
    assert.match(res.headers['content-type'], /javascript/, url);
  }
  for (const [url, res] of Object.entries(board.css)) {
    assert.equal(res.status, 200, url);
    assert.match(res.headers['content-type'], /text\/css/, url);
  }
}));

test('served scripts never use innerHTML, outerHTML, insertAdjacentHTML or document.write', () => withServer(async (s) => {
  const { p } = await createBoard(s);
  for (const path of ['/', `/b/${p}`]) {
    const src = await collect(s, path);
    for (const [url, res] of Object.entries(src.scripts)) {
      assert.doesNotMatch(res.text, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/, url);
    }
  }
}));

// ---- export page -----------------------------------------------------------

test('export page needs the correct facilitator token and names its testids', () => withServer(async (s) => {
  const { p, f } = await createBoard(s);
  const ok = await collect(s, `/b/${p}/f/${f}/export`);
  assert.equal(ok.status, 200);
  assert.deepEqual(missing(ok.all, ['copy-markdown', 'download-markdown', 'export-preview']), []);
  assert.ok(ok.all.includes('back-to-board'));
  assert.match(ok.html, /id=["']skip-link["']/);
  for (const path of [`/b/${p}/f/${unknownToken()}/export`, `/b/${p}/export`, `/b/${unknownToken()}/f/${f}/export`]) {
    const res = await s.call('GET', path);
    assert.equal(res.status, 404, path);
    assert.match(res.text, /Board not found/);
  }
}));

// ---- not found (SC14) ------------------------------------------------------

test('a mistyped or unknown board link gives 404 with the Board not found page', () => withServer(async (s) => {
  const { p } = await createBoard(s);
  const mistyped = p.slice(0, -1) + (p.endsWith('a') ? 'b' : 'a');
  for (const path of ['/b/not-a-real-token', `/b/${unknownToken()}`, `/b/${mistyped}`, `/b/${mistyped}/f/${unknownToken()}`, '/nope', '/b/', '/b']) {
    const res = await s.call('GET', path);
    assert.equal(res.status, 404, path);
    assert.match(res.headers['content-type'], /text\/html/);
    assert.match(res.text, /Board not found/, path);
    assert.match(res.text, /<title>\s*Board not found - Retro board\s*<\/title>/);
    assert.match(res.text, /That link does not match any board/);
  }
}));

test('the Board not found page links to a new retro and gives no hint about partial matches', () => withServer(async (s) => {
  const { p } = await createBoard(s);
  const bad = await s.call('GET', `/b/${p.slice(0, -1)}x`);
  const nope = await collect(s, '/b/zzzzzzzzzzzzzzzzzzzzzz');
  assert.deepEqual(missing(nope.all, ['not-found-title', 'create-new-link']), []);
  assert.match(nope.html, /Create a new retro/);
  assert.match(nope.html, /href=["']\/["']/);
  assert.equal(bad.text, nope.html);
  assert.ok(!bad.text.includes(p));
}));

test('trailing segments, a bare /export and path tricks are 404, not pages or files', () => withServer(async (s) => {
  const { p, f } = await createBoard(s);
  for (const path of [`/b/${p}/extra`, `/b/${p}/f/${f}/extra`, `/b/${p}/f`, `/src/server.js`, '/assets/../src/server.js',
    '/assets/..%2fsrc%2fserver.js', '/assets/nope.js', '/package.json']) {
    const res = await s.call('GET', path);
    assert.equal(res.status, 404, path);
    assert.doesNotMatch(res.text, /require\(|createServer/, path);
  }
}));

// ---- security of the served pages -----------------------------------------

test('every page carries CSP, nosniff, no-referrer and X-Frame-Options', () => withServer(async (s) => {
  const { p, f } = await createBoard(s);
  for (const path of ['/', `/b/${p}`, `/b/${p}/f/${f}`, `/b/${p}/f/${f}/export`, '/nope']) {
    const res = await s.call('GET', path);
    const h = res.headers;
    assert.match(h['content-security-policy'], /default-src 'none'/, path);
    assert.match(h['content-security-policy'], /script-src 'self'/, path);
    assert.match(h['content-security-policy'], /frame-ancestors 'none'/, path);
    assert.equal(h['x-content-type-options'], 'nosniff', path);
    assert.equal(h['referrer-policy'], 'no-referrer', path);
    assert.equal(h['x-frame-options'], 'DENY', path);
  }
}));

test('no page has a style attribute, inline style, inline script or inline event handler', () => withServer(async (s) => {
  const { p, f } = await createBoard(s);
  for (const path of ['/', `/b/${p}`, `/b/${p}/f/${f}/export`, '/nope']) {
    const { html } = await collect(s, path);
    assert.doesNotMatch(html, /\sstyle\s*=/i, `${path} style attribute`);
    assert.doesNotMatch(html, /<style[\s>]/i, `${path} <style>`);
    assert.doesNotMatch(html, /<script(?![^>]*\ssrc\s*=)[^>]*>/i, `${path} inline script`);
    assert.doesNotMatch(html, /\son[a-z]+\s*=\s*["']/i, `${path} inline handler`);
    assert.doesNotMatch(html, /javascript:/i, `${path} javascript: url`);
  }
}));

test('served scripts and styles are free of inline-style helpers that the CSP would block', () => withServer(async (s) => {
  const { p } = await createBoard(s);
  const board = await collect(s, `/b/${p}`);
  for (const [url, res] of Object.entries(board.scripts)) {
    assert.doesNotMatch(res.text, /setAttribute\(\s*["']style["']|\.style\.cssText|eval\(|new Function\(/, url);
  }
}));

test('page responses are not cacheable', () => withServer(async (s) => {
  for (const path of ['/', '/nope']) {
    const res = await s.call('GET', path);
    assert.match(res.headers['cache-control'], /no-store/, path);
  }
}));
