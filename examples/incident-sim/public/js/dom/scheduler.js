// Real-time driver for the play loop. It only decides WHEN a tick is asked for (core/scheduler-math dueTicks);
// what a tick computes never depends on it. requestAnimationFrame while visible, a timer while hidden.
import { dueTicks } from '../core/scheduler-math.js';

export function createScheduler({ onTicks, getSpeed, now = () => performance.now() }) {
  let running = false;
  let base = 0;
  let ticksRun = 0;
  let raf = 0;
  let timer = 0;

  const pump = () => {
    if (!running) return;
    const n = dueTicks({ elapsedMs: now() - base, speed: getSpeed(), ticksRun });
    if (n > 0) {
      ticksRun += n;
      onTicks(n);
    }
  };
  const frame = () => { raf = 0; pump(); schedule(); };
  const schedule = () => {
    if (!running || raf || timer) return;
    if (document.hidden) timer = setTimeout(() => { timer = 0; pump(); schedule(); }, 250);
    else raf = requestAnimationFrame(frame);
  };
  const onVisibility = () => {
    cancelAnimationFrame(raf); clearTimeout(timer); raf = 0; timer = 0;
    schedule();
  };
  document.addEventListener('visibilitychange', onVisibility);

  return {
    // Starts (or restarts) real time from now: elapsed time before a pause is never owed.
    start() {
      base = now();
      ticksRun = 0;
      running = true;
      schedule();
    },
    stop() {
      running = false;
      cancelAnimationFrame(raf); clearTimeout(timer); raf = 0; timer = 0;
    },
    // A tick the player's own action already ran counts against the time owed.
    credit(n = 1) { ticksRun += n; },
    isRunning: () => running,
    destroy() {
      this.stop();
      document.removeEventListener('visibilitychange', onVisibility);
    },
  };
}
