// Scenario hash, run fingerprint and state hash chain helpers.
import { fnv1a32, hex8, canonicalJson } from './hash.js';

const memo = new WeakMap();

export function scenarioHash(scenario) {
  if (scenario !== null && typeof scenario === 'object' && Object.isFrozen(scenario) && memo.has(scenario)) return memo.get(scenario);
  const h = hex8(fnv1a32(canonicalJson(scenario)));
  if (scenario !== null && typeof scenario === 'object' && Object.isFrozen(scenario)) memo.set(scenario, h);
  return h;
}

export function fingerprint({ scenarioId, scenarioHash: sh, seed, actionLog, hintUsed }) {
  const acts = actionLog.map((a) => `${a.t}:${a.id}@${a.node || '-'}`).join(';');
  return hex8(fnv1a32(`v1|${scenarioId}|${sh}|${seed}|${acts}|${hintUsed ? 'h' : ''}`));
}

export const stateHash = (state) => hex8(state.hash);

// One link of the chain: hash_k = fnv1a32(hex8(hash_{k-1}) + "|" + tickLine).
export const chain = (prevHash, tickLine) => fnv1a32(`${hex8(prevHash)}|${tickLine}`);
