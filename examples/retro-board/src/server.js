'use strict';
const http = require('node:http');
const path = require('node:path');
const { createStore, BootError } = require('./store');
const { loadAssets } = require('./http');
const { createRouter } = require('./router');

const isLoopback = (host) => /^(localhost|::1|\[::1\]|127(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3})$/i.test(String(host));

function readConfig(env = process.env) {
  const num = (v, d) => (Number.isInteger(Number(v)) && v !== undefined && v !== '' ? Number(v) : d);
  const appDir = path.join(__dirname, '..');
  return {
    port: num(env.PORT, 3000),
    host: env.HOST || '127.0.0.1',
    dataDir: env.DATA_DIR || path.join(appDir, 'data'),
    maxBoards: num(env.MAX_BOARDS, 1000),
    publicDir: path.join(appDir, 'public'),
  };
}

// Boots the store and the HTTP server. Resolves with {server, store, port, close}.
function start(config) {
  const store = createStore({ dir: config.dataDir, maxBoards: config.maxBoards });
  store.open();
  const { pages, assets } = loadAssets(config.publicDir);
  const ctx = { store, pages, assets, loopback: isLoopback(config.host), port: config.port };
  const server = http.createServer(createRouter(ctx));
  server.headersTimeout = 5000;
  server.requestTimeout = 10000;
  server.maxConnections = 1000;
  return new Promise((resolve, reject) => {
    server.once('error', (err) => { store.close(); reject(err); });
    server.listen(config.port, config.host, () => {
      ctx.port = server.address().port;
      resolve({
        server, store, port: ctx.port,
        close: () => new Promise((done) => {
          store.close();
          server.close(() => done());
          server.closeAllConnections();
        }),
      });
    });
  });
}

async function main() {
  const config = readConfig();
  let app;
  try {
    app = await start(config);
  } catch (err) {
    if (err && err.code === 'EADDRINUSE') process.stderr.write(`Port ${config.port} is in use, set PORT\n`);
    else if (err instanceof BootError) process.stderr.write(`${err.message}\n`);
    else process.stderr.write(`Cannot start: ${err && err.message}\n`);
    process.exit(1);
  }
  if (!isLoopback(config.host)) process.stderr.write(`Warning: listening on ${config.host}, anyone on the network can reach this board.\n`);
  process.stdout.write(`Retro board running at http://localhost:${app.port}\n`);
  const stop = () => { app.close().then(() => process.exit(0)); };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  process.on('uncaughtException', (err) => {
    process.stderr.write(`Uncaught: ${err && err.stack}\n`);
    process.exit(1);
  });
}

if (require.main === module) main();

module.exports = { start, readConfig, isLoopback };
