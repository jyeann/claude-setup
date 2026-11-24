'use strict';
const fs = require('node:fs');
const path = require('node:path');

const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";

const SECURITY_HEADERS = {
  'Content-Security-Policy': CSP,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Cache-Control': 'no-store',
};

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};

function send(res, status, body, headers) {
  res.writeHead(status, { ...SECURITY_HEADERS, ...headers });
  res.end(body);
}

function sendJson(res, status, value, headers = {}) {
  const body = Buffer.from(JSON.stringify(value));
  send(res, status, body, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': body.length, ...headers });
}

function sendPage(res, status, page) {
  send(res, status, page, { 'Content-Type': TYPES['.html'], 'Content-Length': page.length });
}

function sendNotModified(res, headers) {
  send(res, 304, undefined, headers);
}

const PAGE_FILES = { index: 'index.html', board: 'board.html', export: 'export.html', notFound: 'not-found.html' };

// Read everything once at boot. Requests only ever look up exact keys; no path is built from input.
function loadAssets(publicDir) {
  const pages = {};
  for (const [key, file] of Object.entries(PAGE_FILES)) pages[key] = fs.readFileSync(path.join(publicDir, file));
  const assets = new Map();
  const add = (urlPath, file) => {
    const type = TYPES[path.extname(file)];
    if (type) assets.set(urlPath, { body: fs.readFileSync(file), type });
  };
  const css = path.join(publicDir, 'app.css');
  if (fs.existsSync(css)) add('/assets/app.css', css);
  const jsDir = path.join(publicDir, 'js');
  if (fs.existsSync(jsDir)) {
    for (const name of fs.readdirSync(jsDir)) {
      if (/^[A-Za-z0-9._-]+\.js$/.test(name)) add(`/assets/js/${name}`, path.join(jsDir, name));
    }
  }
  return { pages, assets };
}

function sendAsset(res, asset) {
  send(res, 200, asset.body, { 'Content-Type': asset.type, 'Content-Length': asset.body.length });
}

module.exports = { CSP, SECURITY_HEADERS, send, sendJson, sendPage, sendNotModified, loadAssets, sendAsset };
