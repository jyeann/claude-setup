'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DomainError } = require('./lists');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

// The only files that can ever be served. Keys are what the router looks up.
const PAGE_FILES = { 'index.html': 'index.html', 'list.html': 'list.html', 'not-found.html': 'not-found.html' };
const ASSET_FILES = {
  '/assets/app.css': 'app.css',
  '/assets/js/api.js': 'js/api.js',
  '/assets/js/logic.js': 'js/logic.js',
  '/assets/js/home.js': 'js/home.js',
  '/assets/js/list.js': 'js/list.js',
};
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };

const pages = new Map();
const assets = new Map();

function readEntry(dir, rel) {
  return { body: fs.readFileSync(path.join(dir, rel)), type: TYPES[path.extname(rel)] };
}

// Read every allowlisted file once. Called at boot.
function loadPublic(dir = PUBLIC_DIR) {
  pages.clear();
  assets.clear();
  for (const [name, rel] of Object.entries(PAGE_FILES)) pages.set(name, readEntry(dir, rel));
  for (const [url, rel] of Object.entries(ASSET_FILES)) assets.set(url, readEntry(dir, rel));
}

const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";

function securityHeaders() {
  return {
    'Content-Security-Policy': CSP,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Cache-Control': 'no-store',
  };
}

function applySecurityHeaders(res) {
  for (const [k, v] of Object.entries(securityHeaders())) res.setHeader(k, v);
}

function send(res, status, type, body, extra) {
  applySecurityHeaders(res);
  res.statusCode = status;
  res.setHeader('Content-Type', type);
  res.setHeader('Content-Length', body.length);
  if (extra) for (const [k, v] of Object.entries(extra)) res.setHeader(k, v);
  res.end(body);
}

function sendJson(res, status, body, extra) {
  send(res, status, 'application/json; charset=utf-8', Buffer.from(JSON.stringify(body)), extra);
}

function sendError(res, status, code, message, extra) {
  sendJson(res, status, { error: { code, message } }, extra);
}

function sendPage(res, status, name) {
  const page = pages.get(name);
  send(res, status, page.type, page.body);
}

// Returns false when `name` is not allowlisted.
function sendAsset(res, name) {
  const asset = assets.get(name);
  if (!asset) return false;
  send(res, 200, asset.type, asset.body);
  return true;
}

function hasAsset(name) {
  return assets.has(name);
}

const fail = (code, status, message) => new DomainError(code, status, message);

function isJsonType(header) {
  if (typeof header !== 'string') return false;
  return header.split(';')[0].trim().toLowerCase() === 'application/json';
}

// Resolves with a parsed JSON object. The size is counted while streaming; once over the cap the
// rest of the body is discarded without being kept.
function readJsonBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    if (!isJsonType(req.headers['content-type'])) {
      req.resume();
      return reject(fail('bad_content_type', 415, 'Content-Type must be application/json.'));
    }
    const declared = Number(req.headers['content-length']);
    const tooLarge = () => fail('body_too_large', 413, 'Request body is too large.');
    if (Number.isFinite(declared) && declared > maxBytes) {
      req.resume();
      return reject(tooLarge());
    }
    const chunks = [];
    let size = 0;
    let done = false;
    req.on('data', (chunk) => {
      if (done) return;
      size += chunk.length;
      if (size > maxBytes) {
        done = true;
        chunks.length = 0;
        reject(tooLarge());
        return;
      }
      chunks.push(chunk);
    });
    req.on('error', (err) => { if (!done) { done = true; reject(err); } });
    req.on('end', () => {
      if (done) return;
      done = true;
      let value;
      try {
        value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        return reject(fail('bad_json', 400, 'Request body is not valid JSON.'));
      }
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return reject(fail('invalid_body', 400, 'Request body is not valid.'));
      }
      resolve(value);
    });
  });
}

module.exports = {
  PUBLIC_DIR, securityHeaders, applySecurityHeaders, sendJson, sendError, sendPage, sendAsset, hasAsset,
  readJsonBody, loadPublic, isJsonType,
};
