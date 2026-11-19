// Entry point: config, vault, lock, index, HTTP server, signals.
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openVault, VaultError } from './vault.js';
import { Index } from './index.js';
import { loadStatic } from './http.js';
import { createHandler } from './router.js';

const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);
const PUBLIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

export function readConfig(env) {
  const host = env.HOST ?? '127.0.0.1';
  if (!LOOPBACK.has(host)) {
    fail('HOST must be a loopback address; exposing the wiki needs a security review');
  }
  const port = env.PORT === undefined || env.PORT === '' ? 3000 : Number(env.PORT);
  if (!Number.isInteger(port) || port < 0 || port > 65535) fail(`PORT must be a number from 0 to 65535, got ${env.PORT}`);
  return { host, port, vaultDir: path.resolve(env.VAULT_DIR || './vault') };
}

function main() {
  const config = readConfig(process.env);
  let vault;
  try {
    vault = openVault(config.vaultDir);
    vault.acquireLock();
  } catch (e) {
    if (e instanceof VaultError) fail(e.message);
    throw e;
  }
  const shutdown = (code) => {
    vault.releaseLock();
    process.exit(code);
  };
  process.on('uncaughtException', (e) => {
    process.stderr.write(`uncaught exception: ${e && e.stack ? e.stack : e}\n`);
    shutdown(1);
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => shutdown(0));

  vault.removeStaleTmp();
  const index = new Index(vault);
  index.scan();

  const statics = loadStatic(PUBLIC_DIR);
  let port = config.port;
  const handle = createHandler({ ctx: { index, vault }, statics, getPort: () => port });
  const server = http.createServer({ requireHostHeader: false }, handle);
  server.headersTimeout = 5000;
  server.requestTimeout = 15000;
  server.on('error', (e) => {
    vault.releaseLock();
    if (e.code === 'EADDRINUSE') fail(`Port ${config.port} is in use, set PORT`);
    fail(`Cannot listen: ${e.message}`);
  });
  const bindHost = config.host === 'localhost' ? '127.0.0.1' : config.host;
  server.listen(config.port, bindHost, () => {
    port = server.address().port;
    process.stdout.write(`Wiki running at http://localhost:${port}\n`);
  });
}

main();
