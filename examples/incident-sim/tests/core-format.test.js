// core/format.js and core/scheduler-math.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mmss, clock, int, percent, percentNumber, ms, rate } from '../public/js/core/format.js';
import { dueTicks, MAX_TICKS_PER_CALL } from '../public/js/core/scheduler-math.js';

test('mmss pads minutes and seconds and rolls over at 60', () => {
  assert.equal(mmss(0), '00:00');
  assert.equal(mmss(9), '00:09');
  assert.equal(mmss(59), '00:59');
  assert.equal(mmss(60), '01:00');
  assert.equal(mmss(610), '10:10');
  assert.equal(mmss(3599), '59:59');
  assert.equal(mmss(6000), '100:00');
});

test('mmss and clock treat negative, fractional and non-finite input as whole seconds from 0', () => {
  assert.equal(mmss(-5), '00:00');
  assert.equal(mmss(NaN), '00:00');
  assert.equal(mmss(Infinity), '00:00');
  assert.equal(mmss(undefined), '00:00');
  assert.equal(mmss(41.9), '00:41');
  assert.equal(clock(161), 'T+02:41');
  assert.equal(clock(0), 'T+00:00');
});

test('int groups thousands with commas and rounds', () => {
  assert.equal(int(1842), '1,842');
  assert.equal(int(999), '999');
  assert.equal(int(1000), '1,000');
  assert.equal(int(1234567), '1,234,567');
  assert.equal(int(-1234), '-1,234');
  assert.equal(int(2.6), '3');
  assert.equal(int(NaN), '0');
});

test('percent and percentNumber show one decimal', () => {
  assert.equal(percent(0.062), '6.2%');
  assert.equal(percent(0), '0.0%');
  assert.equal(percent(1), '100.0%');
  assert.equal(percent(0.8), '80.0%');
  assert.equal(percent(0.0005), '0.1%');
  assert.equal(percent(0.00049), '0.0%');
  assert.equal(percent(-0.062), '-6.2%');
  assert.equal(percentNumber(0.7012), '70.1');
  assert.equal(percentNumber(NaN), '0.0');
});

test('ms and rate append their units to grouped integers', () => {
  assert.equal(ms(2100), '2,100 ms');
  assert.equal(ms(12), '12 ms');
  assert.equal(rate(1842), '1,842 req/s');
  assert.equal(rate(0), '0 req/s');
});

test('dueTicks is floor(elapsed*speed/1000) minus ticks run, never below 0', () => {
  assert.equal(dueTicks({ elapsedMs: 999, speed: 1, ticksRun: 0 }), 0);
  assert.equal(dueTicks({ elapsedMs: 1000, speed: 1, ticksRun: 0 }), 1);
  assert.equal(dueTicks({ elapsedMs: 999, speed: 2, ticksRun: 0 }), 1);
  assert.equal(dueTicks({ elapsedMs: 1000, speed: 4, ticksRun: 3 }), 1);
  assert.equal(dueTicks({ elapsedMs: 1000, speed: 4, ticksRun: 4 }), 0);
  assert.equal(dueTicks({ elapsedMs: 100, speed: 4, ticksRun: 9 }), 0);
});

test('dueTicks caps each call at min(speed, 64)', () => {
  assert.equal(dueTicks({ elapsedMs: 60000, speed: 4, ticksRun: 0 }), 4);
  assert.equal(dueTicks({ elapsedMs: 2500, speed: 1, ticksRun: 0 }), 1);
  assert.equal(dueTicks({ elapsedMs: 600000, speed: 64, ticksRun: 0 }), 64);
  assert.equal(dueTicks({ elapsedMs: 600000, speed: 128, ticksRun: 0 }), MAX_TICKS_PER_CALL);
  assert.equal(dueTicks({ elapsedMs: 1000, speed: 64, ticksRun: 0 }), 64);
  assert.equal(dueTicks({ elapsedMs: 1000, speed: 32, ticksRun: 0 }), 32);
});

test('dueTicks returns 0 for invalid input', () => {
  assert.equal(dueTicks({ elapsedMs: NaN, speed: 1, ticksRun: 0 }), 0);
  assert.equal(dueTicks({ elapsedMs: 5000, speed: NaN, ticksRun: 0 }), 0);
  assert.equal(dueTicks({ elapsedMs: 5000, speed: 1, ticksRun: NaN }), 0);
  assert.equal(dueTicks({ elapsedMs: -1000, speed: 1, ticksRun: -5 }), 0);
  assert.equal(dueTicks({ elapsedMs: 5000, speed: 0, ticksRun: 0 }), 0);
  assert.equal(dueTicks({ elapsedMs: 5000, speed: 0.5, ticksRun: 0 }), 0);
});

test('a fake 16 ms clock reaches the same tick count at every speed (speed independence of the arithmetic)', () => {
  const totals = [1, 2, 4, 8, 16, 32, 64].map((speed) => {
    let ran = 0;
    for (let t = 0; ran < 60 && t < 400000; t += 16) {
      let due = dueTicks({ elapsedMs: t, speed, ticksRun: ran });
      while (due-- > 0 && ran < 60) ran++;
    }
    return ran;
  });
  assert.deepEqual(totals, [60, 60, 60, 60, 60, 60, 60]);
});
