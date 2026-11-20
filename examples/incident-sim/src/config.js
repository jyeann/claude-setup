// Environment parsing. Pure apart from the SCENARIOS_DIR stat. Throws ConfigError with the exact fatal text.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);

export class ConfigError extends Error {}

export function readConfig(env, appRoot = APP_ROOT) {
  let port = 3000;
  if (env.PORT !== undefined && env.PORT !== '') {
    port = /^\d+$/.test(env.PORT) ? Number(env.PORT) : NaN;
    if (!Number.isInteger(port) || port > 65535) throw new ConfigError('PORT must be an integer from 0 to 65535');
  }
  const host = env.HOST ?? '127.0.0.1';
  if (!LOOPBACK.has(host)) throw new ConfigError('HOST must be a loopback address; exposing incident-sim needs a security review');
  const requested = env.SCENARIOS_DIR === undefined || env.SCENARIOS_DIR === '' ? path.join(appRoot, 'scenarios') : env.SCENARIOS_DIR;
  let scenariosDir;
  try {
    scenariosDir = fs.realpathSync(requested);
    if (!fs.statSync(scenariosDir).isDirectory()) throw new Error('not a directory');
  } catch {
    throw new ConfigError(`Cannot read SCENARIOS_DIR ${requested}`);
  }
  return { port, host, bindHost: host === 'localhost' ? '127.0.0.1' : host, testMode: env.INCIDENT_SIM_TEST === '1', scenariosDir };
}
