'use strict';
const { randomBytes } = require('node:crypto');

const SECRET_WARNING = 'WARNING: HELLO_SIGNING_SECRET not set; using a random per-process dev secret. Certificates will read as Forged after restart.';

// Parses env into a config object. Throws Error('invalid PORT') for a bad port, a HELLO_SLA_TOKEN shorter than 16 chars in production, or when NODE_ENV=production without a >= 32 char secret; warns via `warn` otherwise.
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
  const limitEnv = (name, fallback) => {
    if (env[name] === undefined) return fallback;
    const raw = env[name];
    if (/^\d+$/.test(raw) && Number(raw) >= 1 && Number(raw) <= 100000) return Number(raw);
    warn(`invalid ${name}, using ${fallback}`);
    return fallback;
  };
  const readLimit = limitEnv('HELLO_READ_LIMIT', 120);
  const fedLimit = limitEnv('HELLO_FED_LIMIT', 10);
  const fedGlobalLimit = limitEnv('HELLO_FED_GLOBAL_LIMIT', 30);
  const peers = typeof env.HELLO_PEERS === 'string' ? env.HELLO_PEERS : '';
  const allowPrivatePeers = env.HELLO_PEERS_ALLOW_PRIVATE === '1';
  const slaToken = env.HELLO_SLA_TOKEN ? env.HELLO_SLA_TOKEN : undefined;
  const production = env.NODE_ENV === 'production';
  if (slaToken !== undefined && slaToken.length < 16) {
    if (production) throw new Error('HELLO_SLA_TOKEN must be at least 16 characters');
    warn('HELLO_SLA_TOKEN is shorter than 16 characters; production requires at least 16');
  }
  const timeMachineStreaks = env.HELLO_TIME_MACHINE_STREAKS !== '0';
  let streamHeartbeatMs = 15000;
  if (env.HELLO_STREAM_HEARTBEAT_MS !== undefined) {
    const raw = env.HELLO_STREAM_HEARTBEAT_MS;
    if (/^\d+$/.test(raw) && Number(raw) >= 50 && Number(raw) <= 60000) streamHeartbeatMs = Number(raw);
    else warn('invalid HELLO_STREAM_HEARTBEAT_MS, using 15000');
  }
  let chaosSeed;
  if (env.HELLO_CHAOS_SEED !== undefined && env.HELLO_CHAOS_SEED !== '') {
    if (/^\d{1,10}$/.test(env.HELLO_CHAOS_SEED)) chaosSeed = Number(env.HELLO_CHAOS_SEED);
    else warn('invalid HELLO_CHAOS_SEED, ignoring');
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
  return { port, dataFile, rateLimit, signingSecret, secretIsDev, peers, allowPrivatePeers, readLimit, fedLimit, fedGlobalLimit, slaToken, production, timeMachineStreaks, chaosSeed, streamHeartbeatMs };
}

module.exports = { loadConfig, SECRET_WARNING };
