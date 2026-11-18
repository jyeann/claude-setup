'use strict';

// Fixed window per key. Keys are socket addresses, never forwarded headers.
function createLimiter({ limit, windowMs = 60000, now = Date.now, maxKeys = 10000 }) {
  const hits = new Map();
  return {
    hit(key) {
      const t = now();
      if (hits.size > maxKeys) {
        for (const [k, v] of hits) if (v.reset <= t) hits.delete(k);
      }
      let e = hits.get(key);
      if (!e || e.reset <= t) {
        e = { count: 0, reset: t + windowMs };
        hits.set(key, e);
      }
      e.count += 1;
      if (e.count > limit) return { ok: false, retryAfter: Math.max(1, Math.ceil((e.reset - t) / 1000)) };
      return { ok: true, retryAfter: 0 };
    },
    size: () => hits.size,
  };
}

module.exports = { createLimiter };
