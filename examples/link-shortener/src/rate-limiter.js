'use strict';

// Sliding-window limiter: at most `limit` hits per `windowMs` per key.
function createRateLimiter({ limit = 30, windowMs = 60000, now = Date.now } = {}) {
  const hits = new Map();
  return {
    // Returns { allowed: true } or { allowed: false, retryAfter: seconds }.
    check(key) {
      const t = now();
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
