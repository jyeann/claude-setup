// An in-process copy of the real server for UI tests: real vault, index and router, plain HTTP on a free port.
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { openVault } from '../src/vault.js';
import { Index } from '../src/index.js';
import { loadStatic } from '../src/http.js';
import { createHandler } from '../src/router.js';

const PUBLIC = path.resolve(import.meta.dirname, '..', 'public');

export async function withBackend(fn, files = {}) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-ui-')));
  const vault = openVault(path.join(base, 'v'));
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(vault.root, name), content);
  const index = new Index(vault, () => {});
  index.scan();
  let port = 0;
  const handler = createHandler({ ctx: { index, vault }, statics: loadStatic(PUBLIC), getPort: () => port, log: () => {} });
  const server = http.createServer({ requireHostHeader: false }, handler);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
  const calls = [];
  const fetchFn = (url, init = {}) => {
    calls.push({ url, method: init.method || 'GET' });
    return fetch(`http://127.0.0.1:${port}${url}`, init);
  };
  try {
    return await fn({ fetchFn, calls, root: vault.root, port, read: (n) => fs.readFileSync(path.join(vault.root, n), 'utf8') });
  } finally {
    await new Promise((r) => { server.close(r); server.closeAllConnections(); });
    fs.rmSync(base, { recursive: true, force: true });
  }
}

export const INDEX_HTML = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
