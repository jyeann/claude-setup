// Spoiler-free, two-line share text. No URL, name or emoji.
import { mmss } from './format.js';

export const MAX_LETTERS = 12;
const ID_RE = /^[a-z0-9-]{1,40}$/;
const HEX8_RE = /^[0-9a-f]{8}$/;
const LETTERS = ['D', 'F', 'x', '.'];
const EFFECT_LETTER = { diagnostic: 'D', helpful: 'F', harmful: 'x', none: '.' };

// historyEffects effect -> share letter. Unknown or undecided effects read as "no effect".
export function letterOf(effect) {
  return Object.hasOwn(EFFECT_LETTER, effect) ? EFFECT_LETTER[effect] : '.';
}

const uint = (n) => String(Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);

export function shareText({ daily, seed, scenarioId, letters, left, budget, timeToMitigate, score, optimalTime, harmful, fp }) {
  if (typeof scenarioId !== 'string' || !ID_RE.test(scenarioId)) throw new RangeError('scenarioId must use only lowercase letters, digits and hyphens');
  if (typeof fp !== 'string' || !HEX8_RE.test(fp)) throw new RangeError('fp must be 8 lowercase hex digits');
  const marks = (Array.isArray(letters) ? letters : []).filter((l) => LETTERS.includes(l)).slice(0, MAX_LETTERS);
  const who = Number.isInteger(daily) && daily >= 0 ? `#${daily}` : `seed:${uint(seed)}`;
  const time = timeToMitigate === null || timeToMitigate === undefined ? 'OUT' : mmss(timeToMitigate);
  const line1 = `incident-sim ${who} ${scenarioId}  [${marks.join(' ')}]  ${uint(left)}/${uint(budget)} pager  ${time}`;
  const line2 = `score ${uint(score)}  optimal ${mmss(optimalTime)}  harmful ${uint(harmful)}  fp ${fp}`;
  return `${line1}\n${line2}`;
}
