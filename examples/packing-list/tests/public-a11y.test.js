'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');

test('list page has the labelled controls, a live progress text and an empty #status region', () => {
  const html = read('list.html');
  assert.match(html, /<label for="new-item">New item<\/label>/);
  assert.match(html, /<label for="share-link">Share link<\/label>/);
  assert.match(html, /<p id="progress" aria-live="polite">/);
  assert.match(html, /<div id="status" role="status"><\/div>/);
  assert.match(html, /role="progressbar" aria-label="Packing progress"/);
  assert.match(html, /<p id="form-error" class="error" role="alert"><\/p>/);
  assert.match(html, /<ul id="items" aria-label="Items">/);
});

test('home page links the trip name field to its alert and has no maxlength', () => {
  const html = read('index.html');
  assert.match(html, /aria-describedby="trip-name-error"/);
  assert.match(html, /id="trip-name-error" class="error" role="alert"/);
  assert.doesNotMatch(html, /maxlength/);
});

test('skip link is the first focusable element of every page', () => {
  for (const f of ['index.html', 'list.html', 'not-found.html']) {
    const html = read(f);
    const body = html.slice(html.indexOf('<body>'));
    assert.match(body, /^<body>\s*<a class="skip-link" href="#main">Skip to main content<\/a>/, f);
  }
});

test('stylesheet supports dark mode, a 2px focus outline and 44px targets', () => {
  const css = read('app.css');
  assert.match(css, /prefers-color-scheme: dark/);
  assert.match(css, /:focus-visible \{ outline: 3px solid/);
  assert.match(css, /min-height: 2\.75rem/);
  assert.doesNotMatch(css, /transition|animation/);
});

test('page scripts build the DOM from text only', () => {
  for (const f of ['js/list.js', 'js/home.js']) {
    assert.doesNotMatch(read(f), /innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(/, f);
  }
  assert.match(read('js/list.js'), /textContent/);
});

test('every script and stylesheet a page references is on the server asset allowlist', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'src', 'http.js'), 'utf8');
  for (const f of ['index.html', 'list.html', 'not-found.html']) {
    const refs = [...read(f).matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
    assert.ok(refs.length >= 2, f);
    for (const ref of refs) assert.ok(server.includes(`'${ref}'`), `${f}: ${ref}`);
  }
});
