'use strict';
const http = require('node:http');
const { loadConfig } = require('./config');
const { createStore } = require('./store');
const { createRateLimiter } = require('./rate-limiter');
const { createSigner } = require('./certificates');
const { createRouter } = require('./router');
const { createHub } = require('./stream');
const { createSla } = require('./sla');
const { createFederation, parsePeers, defaultFetchPeer } = require('./federation');
const { mulberry32 } = require('./weather');

// A closed pipe (`node src/server.js | head`) must not take the server down.
for (const stream of [process.stdout, process.stderr]) {
  stream.on('error', (e) => { if (e.code !== 'EPIPE') throw e; });
}

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

const warn = (m) => process.stderr.write(`${m}\n`);
const peers = parsePeers(config.peers, { allowPrivate: config.allowPrivatePeers, warn });
const hub = createHub({ heartbeatMs: config.streamHeartbeatMs });
const sla = createSla();
const federation = createFederation({ peers, fetchPeer: defaultFetchPeer({ allowPrivate: config.allowPrivatePeers }) });

const handler = createRouter({
  hub,
  sla,
  federation,
  readLimiter: createRateLimiter({ limit: config.readLimit, windowMs: 60000 }),
  fedLimiter: createRateLimiter({ limit: config.fedLimit, windowMs: 60000 }),
  fedGlobalLimiter: createRateLimiter({ limit: config.fedGlobalLimit, windowMs: 60000 }),
  slaToken: config.slaToken,
  production: config.production,
  timeMachineStreaks: config.timeMachineStreaks,
  ...(config.chaosSeed === undefined ? {} : { random: mulberry32(config.chaosSeed) }),
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
  hub.closeAll();
  server.closeAllConnections();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
