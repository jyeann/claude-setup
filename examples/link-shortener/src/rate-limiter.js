'use strict';

// Sliding-window limiter: at most `limit` hits per `windowMs` per key.
function createRateLimiter({ limit = 30, windowMs = 60000, maxKeys = 10000, now = Date.now } = {}) {
  const hits = new Map();
  // Drops keys with no hit inside the window, then the oldest keys until there is room for one more.
  function sweep(t) {
    for (const [key, list] of hits) if (list.every((h) => t - h >= windowMs)) hits.delete(key);
    while (hits.size >= maxKeys) hits.delete(hits.keys().next().value);
  }
  return {
    size: () => hits.size,
    // Returns { allowed: true } or { allowed: false, retryAfter: seconds }.
    check(key) {
      const t = now();
      if (hits.size >= maxKeys) sweep(t);
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
