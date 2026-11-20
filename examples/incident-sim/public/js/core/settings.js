// Settings: { shortcuts: boolean }. Stored under a private key, never exported.
import { parseSafe } from './safe-json.js';

const KEY = 'incident-sim:settings';

export function parseSettings(text) {
  const r = typeof text === 'string' ? parseSafe(text, { maxBytes: 4096 }) : { ok: false };
  if (r.ok && r.value !== null && typeof r.value === 'object' && !Array.isArray(r.value) && typeof r.value.shortcuts === 'boolean') {
    return { shortcuts: r.value.shortcuts };
  }
  return { shortcuts: true };
}

export function serialiseSettings(settings) {
  return JSON.stringify({ shortcuts: !(settings && settings.shortcuts === false) });
}

// store is a core/store.js store.
export function loadSettings(store) {
  const r = store.read(KEY);
  return parseSettings(r.ok ? r.value : null);
}

export function saveSettings(store, settings) {
  return store.write(KEY, serialiseSettings(settings)).ok;
}
