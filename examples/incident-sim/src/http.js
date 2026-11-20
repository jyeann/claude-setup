// Security headers, response helpers and the boot-time allow-list (exact-key Map; request input is never joined to a path).
import fs from 'node:fs';
import path from 'node:path';

export const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; font-src 'none'; manifest-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'";
export const SECURITY_HEADERS = Object.freeze({
  'Content-Security-Policy': CSP,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), clipboard-read=()',
});

const TYPES = {
  html: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8',
  svg: 'image/svg+xml',
  text: 'text/plain; charset=utf-8',
};
const JS_NAME_RE = /^[a-z0-9-]+\.js$/;

// Send bytes with every security header. HEAD gets the same headers (including Content-Length) and no body.
export function send(req, res, status, type, bytes, cache = 'no-store', extra = {}) {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
  res.setHeader('Content-Type', type);
  res.setHeader('Content-Length', bytes.length);
  res.setHeader('Cache-Control', cache);
  for (const [k, v] of Object.entries(extra)) res.setHeader(k, v);
  res.writeHead(status);
  res.end(req.method === 'HEAD' ? undefined : bytes);
}

export const sendText = (req, res, status, text, extra) => send(req, res, status, TYPES.text, Buffer.from(text), 'no-store', extra);

function readRegular(file) {
  try {
    if (!fs.lstatSync(file).isFile()) return null;
    return fs.readFileSync(file);
  } catch { return null; }
}

// URL path -> {type, bytes, cache}. Files that are missing at boot are simply not served.
export function buildRoutes({ publicDir, scenarios = [], index = { valid: [], errors: [] }, testMode = false }) {
  const routes = new Map();
  const add = (url, bytes, type, cache = 'no-cache') => { if (bytes) routes.set(url, { bytes, type, cache }); };
  const shell = readRegular(path.join(publicDir, 'index.html'));
  add('/', shell, TYPES.html);
  add('/index.html', shell, TYPES.html);
  add('/app.css', readRegular(path.join(publicDir, 'app.css')), TYPES.css);
  add('/tokens.css', readRegular(path.join(publicDir, 'tokens.css')), TYPES.css);
  add('/favicon.svg', readRegular(path.join(publicDir, 'favicon.svg')), TYPES.svg);
  for (const dir of ['engine', 'core', 'dom']) {
    let names = [];
    try { names = fs.readdirSync(path.join(publicDir, 'js', dir)).sort(); } catch { /* folder not there yet */ }
    for (const name of names) if (JS_NAME_RE.test(name)) add(`/js/${dir}/${name}`, readRegular(path.join(publicDir, 'js', dir, name)), TYPES.js);
  }
  for (const s of scenarios) add(`/scenarios/${s.id}.json`, s.bytes, TYPES.json);
  add('/scenarios/index.json', Buffer.from(JSON.stringify(index)), TYPES.json, 'no-store');
  if (testMode) add('/test-mode.json', Buffer.from('{"testMode":true}'), TYPES.json, 'no-store');
  return routes;
}
