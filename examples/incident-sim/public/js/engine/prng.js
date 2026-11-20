// mulberry32, functional. State is one uint32.
import { fnv1a32 } from './hash.js';

export function next(state) {
  const s = (state + 0x6d2b79f5) >>> 0;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [s, ((t ^ (t >>> 14)) >>> 0) / 4294967296];
}

export function initial(scenarioId, seed) {
  return fnv1a32(`${scenarioId}:${seed >>> 0}`) || 0x9e3779b9;
}
