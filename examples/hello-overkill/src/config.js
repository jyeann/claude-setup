'use strict';
const { randomBytes } = require('node:crypto');

const SECRET_WARNING = 'WARNING: HELLO_SIGNING_SECRET not set; using a random per-process dev secret. Certificates will read as Forged after restart.';

// Parses env into a config object. Throws Error('invalid PORT') for a bad port, or when NODE_ENV=production without a >= 32 char secret; warns via `warn` otherwise.
function loadConfig(env = process.env, warn = (m) => process.stderr.write(`${m}\n`)) {
  let port = 3000;
  if (env.PORT !== undefined && env.PORT !== '') {
    if (!/^\d{1,5}$/.test(env.PORT) || Number(env.PORT) > 65535) throw new Error('invalid PORT');
    port = Number(env.PORT);
  }
  const dataFile = env.DATA_FILE ? env.DATA_FILE : './data/hello.json';
  let rateLimit = 10;
  if (env.HELLO_RATE_LIMIT !== undefined) {
    const raw = env.HELLO_RATE_LIMIT;
    if (/^\d+$/.test(raw) && Number(raw) >= 1 && Number(raw) <= 100000) rateLimit = Number(raw);
    else warn('invalid HELLO_RATE_LIMIT, using 10');
  }
  let signingSecret = env.HELLO_SIGNING_SECRET;
  let secretIsDev = false;
  if (env.NODE_ENV === 'production' && (typeof signingSecret !== 'string' || signingSecret.length < 32)) {
    throw new Error('HELLO_SIGNING_SECRET must be at least 32 characters when NODE_ENV=production');
  }
  if (!signingSecret) {
    signingSecret = randomBytes(32).toString('hex');
    secretIsDev = true;
    warn(SECRET_WARNING);
  }
  return { port, dataFile, rateLimit, signingSecret, secretIsDev };
}

module.exports = { loadConfig, SECRET_WARNING };
