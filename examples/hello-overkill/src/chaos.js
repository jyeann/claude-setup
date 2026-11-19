'use strict';

// Interprets the `chaos` query value. Returns { kind: 'none'|'teapot'|'delay', ms }.
function decideChaos(value, random = Math.random) {
  const delay = () => ({ kind: 'delay', ms: 2000 + Math.floor(random() * 2001) });
  if (value === '418') return { kind: 'teapot', ms: 0 };
  if (value === 'delay') return delay();
  if (value === '1') {
    const r = random();
    if (r < 1 / 3) return { kind: 'teapot', ms: 0 };
    if (r < 2 / 3) return { kind: 'delay', ms: 2000 + Math.floor(random() * 2001) };
  }
  return { kind: 'none', ms: 0 };
}

module.exports = { decideChaos };
