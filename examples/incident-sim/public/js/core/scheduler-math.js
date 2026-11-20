// Tick scheduling arithmetic. Speed changes how often ticks are asked for, never what a tick computes.
export const MAX_TICKS_PER_CALL = 64;

// floor(elapsedMs * speed / 1000) - ticksRun, never below 0, at most min(speed, 64) per call.
export function dueTicks({ elapsedMs, speed, ticksRun }) {
  if (!Number.isFinite(elapsedMs) || !Number.isFinite(speed) || !Number.isFinite(ticksRun)) return 0;
  if (speed < 1 || elapsedMs < 0) return 0;
  const due = Math.floor((elapsedMs * speed) / 1000) - ticksRun;
  if (due <= 0) return 0;
  return Math.min(due, Math.min(speed, MAX_TICKS_PER_CALL));
}
