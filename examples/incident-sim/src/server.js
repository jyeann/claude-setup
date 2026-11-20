// Entry point: config, scenario load, HTTP server, signals.
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readConfig, ConfigError } from './config.js';
import { loadScenarios, formatScenarioError } from './scenarios-load.js';
import { buildRoutes } from './http.js';
import { createHandler } from './router.js';

const PUBLIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

async function main() {
  let config;
  try { config = readConfig(process.env); } catch (e) {
    if (e instanceof ConfigError) fail(e.message);
    throw e;
  }
  process.on('uncaughtException', (e) => fail(`uncaught exception: ${e && e.stack ? e.stack : e}`));
  const { scenarios, errors, index } = await loadScenarios(config.scenariosDir);
  for (const e of errors) process.stdout.write(`scenario error: ${formatScenarioError(e)}\n`);
  const routes = buildRoutes({ publicDir: PUBLIC_DIR, scenarios, index, testMode: config.testMode });
  let port = config.port;
  const server = http.createServer({ requireHostHeader: false }, createHandler({ routes, getPort: () => port }));
  server.headersTimeout = 5000;
  server.requestTimeout = 15000;
  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') fail(`Port ${config.port} is in use`);
    fail(`Cannot listen: ${e.message}`);
  });
  const stop = () => { server.close(); server.closeAllConnections(); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  server.listen(config.port, config.bindHost, () => {
    port = server.address().port;
    process.stdout.write(`Incident Simulator running at http://localhost:${port}\n`);
    process.stdout.write(`Loaded ${scenarios.length} ${scenarios.length === 1 ? 'scenario' : 'scenarios'}.\n`);
  });
}

main().catch((e) => fail(`uncaught exception: ${e && e.stack ? e.stack : e}`));
