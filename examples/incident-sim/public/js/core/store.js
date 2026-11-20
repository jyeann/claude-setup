// Storage wrapper. Takes a function returning a Storage-like object (so import never touches window).
// Every call is wrapped: a blocked, full or missing store gives { ok:false } and never throws.
import { parseProgress, serialiseProgress, emptyProgress } from './progress.js';

export const PROGRESS_KEY = 'incident-sim:v1';
const PROBE_KEY = 'incident-sim:probe';

export function createStore(getStorage) {
  const run = (fn) => {
    try {
      const s = getStorage();
      if (!s) return { ok: false, reason: 'unavailable' };
      return { ok: true, value: fn(s) };
    } catch {
      return { ok: false, reason: 'blocked' };
    }
  };
  return {
    read: (key) => run((s) => s.getItem(key)),
    write: (key, value) => run((s) => { s.setItem(key, value); }),
    remove: (key) => run((s) => { s.removeItem(key); }),
    // true when a write and a read-back both work.
    probe() {
      const w = run((s) => { s.setItem(PROBE_KEY, '1'); return s.getItem(PROBE_KEY); });
      run((s) => { s.removeItem(PROBE_KEY); });
      return w.ok && w.value === '1';
    },
  };
}

// status: "ok" | "empty" | "corrupt" | "blocked". Never writes, so a corrupt value stays until the next successful save.
export function loadProgress(store) {
  const r = store.read(PROGRESS_KEY);
  if (!r.ok) return { status: 'blocked', progress: emptyProgress() };
  if (r.value === null || r.value === undefined) return { status: 'empty', progress: emptyProgress() };
  const p = parseProgress(r.value);
  return p.ok ? { status: 'ok', progress: p.progress } : { status: 'corrupt', progress: emptyProgress(), reason: p.reason };
}

// Writes, reads back and re-validates. { ok:true } or { ok:false, reason }.
export function saveProgress(store, progress) {
  const text = serialiseProgress(progress);
  const w = store.write(PROGRESS_KEY, text);
  if (!w.ok) return { ok: false, reason: 'the browser would not save progress.' };
  const back = store.read(PROGRESS_KEY);
  if (!back.ok || back.value !== text || !parseProgress(back.value).ok) return { ok: false, reason: 'saved progress could not be read back.' };
  return { ok: true };
}

export function clearProgress(store) {
  return store.remove(PROGRESS_KEY).ok;
}
