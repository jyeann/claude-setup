'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const http = require('../src/http');

const fakeRes = () => {
  const r = { headers: {}, status: 0, body: undefined };
  r.writeHead = (s, h) => { r.status = s; r.headers = h; };
  r.end = (b) => { r.body = b; };
  return r;
};

test('sendJson sets security headers, JSON type and length', () => {
  const res = fakeRes();
  http.sendJson(res, 201, { a: 1 }, { ETag: '"1"' });
  assert.equal(res.status, 201);
  assert.equal(res.headers['X-Content-Type-Options'], 'nosniff');
  assert.equal(res.headers['Cache-Control'], 'no-store');
  assert.match(res.headers['Content-Type'], /application\/json/);
  assert.equal(res.headers.ETag, '"1"');
  assert.equal(res.headers['Content-Length'], res.body.length);
});

test('the CSP forbids framing and non-self scripts', () => {
  assert.match(http.CSP, /default-src 'none'/);
  assert.match(http.CSP, /script-src 'self'/);
  assert.match(http.CSP, /frame-ancestors 'none'/);
  assert.equal(http.SECURITY_HEADERS['Referrer-Policy'], 'no-referrer');
  assert.equal(http.SECURITY_HEADERS['X-Frame-Options'], 'DENY');
});

test('sendPage sends html and sendNotModified sends no body', () => {
  const page = fakeRes();
  http.sendPage(page, 404, Buffer.from('<p>x</p>'));
  assert.match(page.headers['Content-Type'], /text\/html/);
  assert.equal(page.status, 404);
  const nm = fakeRes();
  http.sendNotModified(nm, { ETag: '"2"' });
  assert.equal(nm.status, 304);
  assert.equal(nm.body, undefined);
});

test('loadAssets reads pages once and allowlists only css and js files by exact url', () => {
  const { pages, assets } = http.loadAssets(path.join(__dirname, '..', 'public'));
  assert.ok(pages.index.length > 0 && pages.notFound.length > 0);
  assert.match(assets.get('/assets/app.css').type, /text\/css/);
  assert.match(assets.get('/assets/js/board.js').type, /javascript/);
  assert.equal(assets.has('/assets/../src/server.js'), false);
  assert.equal(assets.has('/index.html'), false);
  const res = fakeRes();
  http.sendAsset(res, assets.get('/assets/app.css'));
  assert.equal(res.status, 200);
});
