// Response helpers, security headers and the static-file allow-list.
import fs from 'node:fs';
import path from 'node:path';

export const SECURITY_HEADERS = Object.freeze({
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
});

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};

function setSecurity(res) {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);
}

export function sendJson(res, status, body, headers = {}) {
  setSecurity(res);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
  if (status === 204 || body === undefined) {
    res.writeHead(status);
    res.end();
    return;
  }
  const bytes = Buffer.from(JSON.stringify(body));
  res.setHeader('Content-Length', bytes.length);
  res.writeHead(status);
  res.end(bytes);
}

export function sendError(res, status, code, message, params = {}, headers = {}) {
  sendJson(res, status, { error: { code, message, ...params } }, headers);
}

// Static files, read once at boot: URL path -> {bytes, type}. Request input is only ever used as a Map key.
export function loadStatic(publicDir) {
  const files = new Map();
  const add = (url, file) => {
    files.set(url, { bytes: fs.readFileSync(file), type: TYPES[path.extname(file)] });
  };
  add('/app.css', path.join(publicDir, 'app.css'));
  const jsDir = path.join(publicDir, 'js');
  for (const name of fs.readdirSync(jsDir)) {
    if (/^[A-Za-z0-9_-][A-Za-z0-9._-]*\.js$/.test(name)) add(`/js/${name}`, path.join(jsDir, name));
  }
  const shell = { bytes: fs.readFileSync(path.join(publicDir, 'index.html')), type: TYPES['.html'] };
  return { files, shell };
}

export function sendStatic(res, statics, pathname) {
  const file = statics.files.get(pathname) ?? statics.shell;
  setSecurity(res);
  res.setHeader('Content-Type', file.type);
  res.setHeader('Content-Length', file.bytes.length);
  res.setHeader('Cache-Control', 'no-cache');
  res.writeHead(200);
  res.end(file.bytes);
}
