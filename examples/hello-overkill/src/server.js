'use strict';
const http = require('node:http');
const { loadConfig } = require('./config');
const { createStore } = require('./store');
const { createRateLimiter } = require('./rate-limiter');
const { createSigner } = require('./certificates');
const { createRouter } = require('./router');

let config;
try {
  config = loadConfig(process.env);
} catch (e) {
  process.stderr.write(`${e.message}\n`);
  process.exit(1);
}

let store;
try {
  store = createStore(config.dataFile);
} catch (e) {
  process.stderr.write(`cannot read data file (${e.code || 'error'}); exiting\n`);
  process.exit(1);
}

const handler = createRouter({
  store,
  limiter: createRateLimiter({ limit: config.rateLimit, windowMs: 60000 }),
  voteLimiter: createRateLimiter({ limit: 60, windowMs: 60000 }),
  signer: createSigner(config.signingSecret),
});

const server = http.createServer({ connectionsCheckingInterval: 1000 }, handler);
server.headersTimeout = 5000;
server.requestTimeout = 10000;
server.maxConnections = 1000;

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') process.stderr.write(`port ${config.port} in use\n`);
  else process.stderr.write('server error\n');
  process.exit(1);
});

server.listen(config.port, () => {
  const { port } = server.address();
  process.stdout.write(`listening on ${port}\n`);
  process.stdout.write(`open http://localhost:${port}/\n`);
});

function shutdown() {
  server.close(() => process.exit(0));
  server.closeAllConnections();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
