'use strict';
const http = require('node:http');
const path = require('node:path');
const { createStore } = require('./store');
const { createRateLimiter } = require('./rate-limiter');
const { createRouter } = require('./router');

const port = Number(process.env.PORT) || 3000;
const file = process.env.DATA_FILE || path.join('.', 'data', 'links.json');

const route = createRouter({ store: createStore(file), limiter: createRateLimiter({ limit: 30, windowMs: 60000 }) });
const server = http.createServer((req, res) => {
  route(req, res).catch(() => {
    if (!res.headersSent) { res.writeHead(500, { 'content-type': 'application/json' }); }
    res.end('{"error":"internal error"}');
  });
});

server.headersTimeout = 5000;
server.requestTimeout = 10000;
server.maxConnections = 1000;
server.listen(port, () => console.log(`listening on ${port}`));

function shutdown() {
  server.close(() => process.exit(0));
  server.closeAllConnections();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
