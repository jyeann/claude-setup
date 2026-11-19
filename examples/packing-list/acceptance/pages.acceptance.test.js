'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { withServer, createList } = require('./helpers');

const T = { timeout: 30000 };

// Fetch a page plus every same-origin script and stylesheet it references.
async function collect(s, pagePath) {
  const page = await s.call('GET', pagePath);
  const urls = [];
  for (const m of page.text.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)) urls.push(m[1]);
  for (const m of page.text.matchAll(/<link\b[^>]*>/gi)) {
    const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(m[0]);
    if (/stylesheet/i.test(m[0]) && href) urls.push(href[1]);
  }
  const assets = {};
  for (const u of urls) if (u.startsWith('/')) assets[u] = await s.call('GET', u);
  return { page, assets };
}

const listPage = async (s) => { const { id } = await createList(s, 'Pages'); return `/l/${id}`; };

test('GET / returns 200 text/html (R4)', T, () => withServer(async (s) => {
  const res = await s.call('GET', '/');
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /^text\/html; charset=utf-8$/i);
}));

test('the home page has h1 "Packing list", the explainer and the New packing list form (J1, UC1)', T, () => withServer(async (s) => {
  const { text } = await s.call('GET', '/');
  assert.match(text, /<h1[^>]*>\s*Packing list\s*<\/h1>/);
  assert.ok(text.includes('Make a list, share the link, tick things off together.'));
  assert.ok(text.includes('New packing list'));
  assert.match(text, /<form\b/i);
  assert.match(text, /<button[^>]*>\s*Create list\s*<\/button>/);
}));

test('the home page labels the Trip name field and has no sign-in (UC1)', T, () => withServer(async (s) => {
  const { text } = await s.call('GET', '/');
  assert.match(text, /<label[^>]*\bfor\s*=\s*["']trip-name["'][^>]*>\s*Trip name\s*<\/label>/);
  assert.match(text, /<input\b[^>]*\bid\s*=\s*["']trip-name["']/);
  assert.doesNotMatch(text, /type\s*=\s*["']password["']/i);
  assert.doesNotMatch(text, /sign in/i);
}));

test('the home page has title "Packing list" and lang="en" (UC14)', T, () => withServer(async (s) => {
  const { text } = await s.call('GET', '/');
  assert.match(text, /<html[^>]*\blang\s*=\s*["']en["']/i);
  assert.match(text, /<title>\s*Packing list\s*<\/title>/);
  assert.match(text, /<main[^>]*\bid\s*=\s*["']main["']/);
  assert.ok(text.includes('Skip to main content'));
}));

test('an existing list id returns 200 text/html (R5)', T, () => withServer(async (s) => {
  const res = await s.call('GET', await listPage(s));
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /^text\/html; charset=utf-8$/i);
}));

test('the list page shell has lang="en", the h1 and the controls from ux.md (UC3, UC14)', T, () => withServer(async (s) => {
  const { text } = await s.call('GET', await listPage(s));
  assert.match(text, /<html[^>]*\blang\s*=\s*["']en["']/i);
  assert.match(text, /<h1[^>]*\bid\s*=\s*["']list-title["']/);
  for (const id of ['share-link', 'progress', 'new-item', 'form-error', 'empty', 'status', 'items']) {
    assert.match(text, new RegExp(`\\bid\\s*=\\s*["']${id}["']`), `missing #${id}`);
  }
  assert.match(text, /<label[^>]*\bfor\s*=\s*["']new-item["'][^>]*>\s*New item\s*<\/label>/);
  assert.match(text, /\brole\s*=\s*["']status["']/);
  assert.ok(text.includes('Anyone with this link can edit.'));
  assert.ok(text.includes('No items yet'));
}));

test('an unknown list id returns 404 with the not-found page (R5, UC7)', T, () => withServer(async (s) => {
  const res = await s.call('GET', '/l/nope');
  assert.equal(res.status, 404);
  assert.match(res.headers['content-type'], /^text\/html; charset=utf-8$/i);
  assert.match(res.text, /<h1[^>]*>\s*List not found\s*<\/h1>/);
  assert.ok(res.text.includes('That link does not match any list. Check it for typos.'));
  assert.match(res.text, /<a\b[^>]*\bhref\s*=\s*["']\/["'][^>]*>\s*Create a new list\s*<\/a>/);
  assert.match(res.text, /<html[^>]*\blang\s*=\s*["']en["']/i);
}));

test('other paths return the not-found page with 404, including /l/ and trailing slashes (R6)', T, () => withServer(async (s) => {
  const { id } = await createList(s, 'Slash');
  for (const p of ['/l/', `/l/${id}/`, '/nothing-here', '/index.html', '/l']) {
    const res = await s.call('GET', p);
    assert.equal(res.status, 404, p);
    assert.match(res.headers['content-type'], /text\/html/i, p);
    assert.ok(res.text.includes('List not found'), p);
  }
}));

test('HEAD / returns 200 with no body (design.md section 3)', T, () => withServer(async (s) => {
  const res = await s.call('HEAD', '/');
  assert.equal(res.status, 200);
  assert.equal(res.text, '');
}));

test('a query string does not change page routing (design.md section 3)', T, () => withServer(async (s) => {
  const home = await s.call('GET', '/?ref=mail');
  assert.equal(home.status, 200);
  const list = await s.call('GET', `${await listPage(s)}?x=1`);
  assert.equal(list.status, 200);
}));

test('every page carries the exact security headers (R9)', T, () => withServer(async (s) => {
  const pages = [await s.call('GET', '/'), await s.call('GET', await listPage(s)), await s.call('GET', '/l/nope')];
  for (const res of pages) {
    assert.equal(res.headers['content-security-policy'], "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.equal(res.headers['referrer-policy'], 'no-referrer');
    assert.equal(res.headers['x-frame-options'], 'DENY');
    assert.equal(res.headers['cross-origin-opener-policy'], 'same-origin');
    assert.equal(res.headers['cross-origin-resource-policy'], 'same-origin');
    assert.equal(res.headers['cache-control'], 'no-store');
  }
}));

test('pages reference their scripts and stylesheet, and those assets are served with the right type (R7)', T, () => withServer(async (s) => {
  const targets = ['/', await listPage(s)];
  for (const p of targets) {
    const { assets } = await collect(s, p);
    const urls = Object.keys(assets);
    assert.ok(urls.some((u) => u.endsWith('.css')), `${p} links no stylesheet`);
    assert.ok(urls.some((u) => u.endsWith('.js')), `${p} loads no script`);
    for (const [u, res] of Object.entries(assets)) {
      assert.ok(u.startsWith('/assets/'), u);
      assert.equal(res.status, 200, u);
      assert.match(res.headers['content-type'], u.endsWith('.css') ? /^text\/css; charset=utf-8$/i : /^text\/javascript; charset=utf-8$/i, u);
    }
  }
}));

test('an unknown /assets/ path returns 404 (R7)', T, () => withServer(async (s) => {
  const res = await s.call('GET', '/assets/does-not-exist.js');
  assert.equal(res.status, 404);
  assert.ok(res.text.includes('List not found'));
}));

test('no page has inline script, style element, style attribute or inline handler (R43)', T, () => withServer(async (s) => {
  for (const p of ['/', await listPage(s), '/l/nope']) {
    const { text } = await s.call('GET', p);
    for (const m of text.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      assert.match(m[1], /\bsrc\s*=/i, `${p}: script without src`);
      assert.equal(m[2].trim(), '', `${p}: inline script content`);
    }
    assert.doesNotMatch(text, /<style\b/i, `${p}: <style>`);
    assert.doesNotMatch(text, /\sstyle\s*=/i, `${p}: style attribute`);
    assert.doesNotMatch(text, /\son[a-z]+\s*=\s*["']/i, `${p}: inline event handler`);
  }
}));

test('served scripts never use innerHTML, outerHTML, insertAdjacentHTML or document.write (R43)', T, () => withServer(async (s) => {
  const seen = new Set();
  for (const p of ['/', await listPage(s)]) {
    const { assets } = await collect(s, p);
    for (const [u, res] of Object.entries(assets)) {
      if (!u.endsWith('.js') || seen.has(u)) continue;
      seen.add(u);
      assert.doesNotMatch(res.text, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/, u);
    }
  }
  assert.ok(seen.size > 0, 'no scripts were served');
}));

test('the app has no runtime dependencies (R44)', T, () => {
  const pkg = require('../package.json');
  assert.ok(!pkg.dependencies || Object.keys(pkg.dependencies).length === 0);
});
