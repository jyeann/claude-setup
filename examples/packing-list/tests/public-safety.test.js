'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PUBLIC = path.join(__dirname, '..', 'public');
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}
const files = walk(PUBLIC);

test('public/ has the pages, the stylesheet and the four scripts', () => {
  const rel = files.map((f) => path.relative(PUBLIC, f)).sort();
  for (const want of ['index.html', 'list.html', 'not-found.html', 'app.css', 'js/api.js', 'js/logic.js', 'js/home.js', 'js/list.js']) assert.ok(rel.includes(want), want);
});

test('no file in public/ uses innerHTML, outerHTML, insertAdjacentHTML or document.write', () => {
  for (const f of files) {
    assert.doesNotMatch(fs.readFileSync(f, 'utf8'), /innerHTML|outerHTML|insertAdjacentHTML|document\.write/, f);
  }
});

test('HTML pages have no inline script, style element, style attribute or event handler', () => {
  for (const f of files.filter((x) => x.endsWith('.html'))) {
    const text = fs.readFileSync(f, 'utf8');
    for (const m of text.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      assert.match(m[1], /\bsrc=/, f);
      assert.equal(m[2].trim(), '', f);
    }
    assert.doesNotMatch(text, /<style\b/i, f);
    assert.doesNotMatch(text, /\sstyle\s*=/i, f);
    assert.doesNotMatch(text, /\son[a-z]+\s*=/i, f);
    assert.match(text, /<html lang="en">/, f);
    assert.match(text, /<main id="main"/, f);
    assert.equal((text.match(/<h1\b/g) || []).length, 1, f);
    assert.match(text, /Skip to main content/, f);
  }
});

test('package.json has no runtime dependencies and requires Node 22', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.engines.node, '>=22');
  assert.equal(pkg.scripts.start, 'node src/server.js');
});
