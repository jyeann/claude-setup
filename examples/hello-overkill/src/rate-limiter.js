'use strict';

// Sliding-window limiter: at most `limit` hits per `windowMs` per key.
function createRateLimiter({ limit = 30, windowMs = 60000, maxKeys = 10000, now = Date.now } = {}) {
  const hits = new Map();
  let lastSweep = -Infinity;
  // Amortised: expired keys are dropped at most once per window; if still full, the oldest 10% are evicted in one batch.
  function sweep(t) {
    if (t - lastSweep >= windowMs) {
      lastSweep = t;
      for (const [key, list] of hits) if (list.every((h) => t - h >= windowMs)) hits.delete(key);
    }
    if (hits.size >= maxKeys) {
      let n = Math.max(1, Math.ceil(maxKeys * 0.1), hits.size - maxKeys + 1);
      for (const key of hits.keys()) { if (n-- <= 0) break; hits.delete(key); }
    }
  }
  return {
    size: () => hits.size,
    // Returns { allowed: true } or { allowed: false, retryAfter: seconds }.
    check(key) {
      const t = now();
      if (hits.size >= maxKeys && !hits.has(key)) sweep(t);
      const recent = (hits.get(key) || []).filter((h) => t - h < windowMs);
      if (recent.length >= limit) {
        hits.set(key, recent);
        return { allowed: false, retryAfter: Math.max(1, Math.ceil((recent[0] + windowMs - t) / 1000)) };
      }
      recent.push(t);
      hits.set(key, recent);
      return { allowed: true };
    },
  };
}

module.exports = { createRateLimiter };
