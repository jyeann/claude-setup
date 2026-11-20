// Test-mode query parameters. Honoured only when the server said test mode is on; never persisted.
export const SPEEDS = ['1', '2', '4', '8', '16', '32', '64'];
export const MAX_SECOND = 600;
const DEFAULTS = () => ({ active: false, speed: 1, paused: false, pauseAt: null, failAt: null });

function queryMap(search) {
  const out = new Map();
  if (typeof search !== 'string') return out;
  const q = search.startsWith('?') ? search.slice(1) : search;
  for (const part of q.split('&')) {
    if (part === '') continue;
    const i = part.indexOf('=');
    const k = i < 0 ? part : part.slice(0, i);
    if (!out.has(k)) out.set(k, i < 0 ? '' : part.slice(i + 1));
  }
  return out;
}

const second = (v) => (v !== undefined && /^\d{1,3}$/.test(v) && Number(v) <= MAX_SECOND ? Number(v) : null);

export function parse(flag, search) {
  if (flag !== true) return DEFAULTS();
  const q = queryMap(search);
  const rawSpeed = q.get('speed');
  const speedOk = rawSpeed !== undefined && SPEEDS.includes(rawSpeed);
  const speed = speedOk ? Number(rawSpeed) : 1;
  const paused = q.get('paused') === '1';
  const pauseAt = second(q.get('pause-at'));
  const failAt = second(q.get('fail-at'));
  return { active: speedOk || paused || pauseAt !== null || failAt !== null, speed, paused, pauseAt, failAt };
}

// Text of the persistent test banner, or "" when no test parameter is active.
export function bannerText(tm) {
  if (!tm || !tm.active) return '';
  let t = `Test mode: speed ${tm.speed}x`;
  if (tm.paused) t += ', paused';
  if (tm.pauseAt !== null) t += `, pause at ${tm.pauseAt} s`;
  return `${t}.`;
}
