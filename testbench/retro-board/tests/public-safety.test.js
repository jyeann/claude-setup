'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PUBLIC = path.join(__dirname, '..', 'public');
const jsFiles = fs.readdirSync(path.join(PUBLIC, 'js')).filter((f) => f.endsWith('.js'));
const htmlFiles = fs.readdirSync(PUBLIC).filter((f) => f.endsWith('.html'));
const read = (...p) => fs.readFileSync(path.join(PUBLIC, ...p), 'utf8');

test('the front-end ships the six modules and four pages ux.md names', () => {
  for (const m of ['api', 'logic', 'live', 'home', 'board', 'export']) assert.ok(jsFiles.includes(`${m}.js`), m);
  for (const p of ['index', 'board', 'export', 'not-found']) assert.ok(htmlFiles.includes(`${p}.html`), p);
});

test('no script writes HTML from strings: innerHTML, outerHTML, insertAdjacentHTML, document.write', () => {
  for (const f of jsFiles) {
    assert.doesNotMatch(read('js', f), /innerHTML|outerHTML|insertAdjacentHTML|document\.write/, f);
  }
});

test('no script uses eval, new Function, inline style helpers or string timers', () => {
  for (const f of jsFiles) {
    assert.doesNotMatch(read('js', f), /\beval\(|new Function\(|setAttribute\(\s*['"]style|\.style\.cssText|setTimeout\(\s*['"]/, f);
  }
});

test('pages have no inline script, inline style, style attribute or event handler attribute', () => {
  for (const f of htmlFiles) {
    const html = read(f);
    assert.doesNotMatch(html, /<script(?![^>]*\ssrc=)[^>]*>/i, `${f} inline script`);
    assert.doesNotMatch(html, /<style[\s>]/i, `${f} style element`);
    assert.doesNotMatch(html, /\sstyle\s*=/i, `${f} style attribute`);
    assert.doesNotMatch(html, /\son[a-z]+\s*=/i, `${f} inline handler`);
  }
});

test('every page has one h1, a main with id main and the skip link first', () => {
  for (const f of htmlFiles) {
    const html = read(f);
    assert.equal((html.match(/<h1[\s>]/g) || []).length, 1, `${f} h1 count`);
    assert.match(html, /<main[^>]*id="main"/, f);
    assert.ok(html.indexOf('id="skip-link"') > 0 && html.indexOf('id="skip-link"') < html.indexOf('<main'), f);
  }
});

test('the server serves every public script and the stylesheet with the right content type', () => {
  const { loadAssets } = require('../src/http');
  const { assets } = loadAssets(PUBLIC);
  for (const f of jsFiles) assert.match(assets.get(`/assets/js/${f}`).type, /javascript/, f);
  assert.match(assets.get('/assets/app.css').type, /text\/css/);
});
