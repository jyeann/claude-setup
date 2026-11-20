'use strict';
const http = require('node:http');
const path = require('node:path');
const { createStore } = require('./store');
const { handle } = require('./router');
const { loadPublic, securityHeaders } = require('./http');

const APP_DIR = path.join(__dirname, '..');
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

function createApp({ dataFile, host = '127.0.0.1', maxLists } = {}) {
  loadPublic();
  const store = createStore(dataFile, maxLists === undefined ? {} : { maxLists });
  store.load();
  const ctx = { store, loopback: LOOPBACK.has(host) };
  const server = http.createServer({ connectionsCheckingInterval: 1000 }, (req, res) => { handle(req, res, ctx); });
  server.maxConnections = 1000;
  server.headersTimeout = 5000;
  server.requestTimeout = 10000;
  // Close idle keep-alive sockets before the 5 s headers timer can fire on them.
  server.keepAliveTimeout = 3000;
  server.on('clientError', (err, socket) => {
    // Timeouts and resets are not answers to any request: close without writing a byte.
    // Only a genuine parse error (HPE_*) gets a 400.
    const parseError = typeof err.code === 'string' && err.code.startsWith('HPE_');
    if (!parseError || !socket.writable) { socket.destroy(); return; }
    const body = JSON.stringify({ error: { code: 'invalid_body', message: 'Request body is not valid.' } });
    const lines = ['HTTP/1.1 400 Bad Request', 'Content-Type: application/json; charset=utf-8',
      `Content-Length: ${Buffer.byteLength(body)}`, 'Connection: close'];
    for (const [k, v] of Object.entries(securityHeaders())) lines.push(`${k}: ${v}`);
    socket.end(`${lines.join('\r\n')}\r\n\r\n${body}`);
  });
  return { server, store, ctx };
}

function main(env = process.env) {
  const port = env.PORT === undefined || env.PORT === '' ? 3000 : Number(env.PORT);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    process.stderr.write(`Invalid PORT: ${env.PORT}\n`);
    process.exit(1);
  }
  const host = env.HOST || '127.0.0.1';
  const dataFile = env.DATA_FILE ? path.resolve(process.cwd(), env.DATA_FILE) : path.join(APP_DIR, 'data', 'lists.json');
  const { server } = createApp({ dataFile, host });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') process.stderr.write(`Port ${port} is in use, set PORT\n`);
    else process.stderr.write(`Could not start: ${err.message}\n`);
    process.exit(1);
  });
  server.listen(port, host, () => {
    const actual = server.address().port;
    const loopback = LOOPBACK.has(host);
    const shown = loopback ? 'localhost' : (host.includes(':') ? `[${host}]` : host);
    if (!loopback) process.stderr.write('Warning: listening beyond this machine. Anyone on your network with a list link can edit that list.\n');
    process.stdout.write(`Packing list running at http://${shown}:${actual}\n`);
  });

  const stop = () => {
    setTimeout(() => process.exit(0), 2000).unref();
    server.close(() => process.exit(0));
    server.closeIdleConnections();
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  return server;
}

if (require.main === module) main();

module.exports = { createApp, main };
