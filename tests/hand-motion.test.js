import test from 'node:test';
import assert from 'node:assert/strict';
import { HandMotion } from '../src/interaction/HandMotion.js';
import { CONFIG } from '../src/config.js';

const rms = (values) => Math.sqrt(values.reduce((sum, n) => sum + n * n, 0) / values.length);

test('stationary camera noise is reduced beyond the previous fixed 0.42 lerp', (t) => {
  const motion = new HandMotion();
  const rawErrors = [], oldErrors = [], errors = [];
  let old = 500, seed = 42;
  for (let i = 0; i < 300; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const x = 500 + (seed / 2 ** 32 - 0.5) * 10;
    const now = i * 1000 / 30;
    old += (x - old) * 0.42;
    motion.update(x / 1000, 0.5, now, 1000, 1000);
    if (i > 30) {
      rawErrors.push(x - 500);
      oldErrors.push(old - 500);
      errors.push(motion.position(now + 30).x * 1000 - 500);
    }
  }
  assert.ok(rms(errors) < rms(oldErrors) * 0.65);
  t.diagnostic(`Stationary RMS (CSS px): raw=${rms(rawErrors).toFixed(2)}, old=${rms(oldErrors).toFixed(2)}, new=${rms(errors).toFixed(2)}`);
});

test('tiny intentional steps accumulate and escape the dead zone at different viewport sizes', () => {
  for (const [width, height] of [[390, 844], [1920, 1080]]) {
    const motion = new HandMotion();
    motion.update(0.5, 0.5, 0, width, height);
    for (let i = 1; i <= 120; i++)
      motion.update(0.5 + i * 0.05 / width, 0.5, i * 1000 / 30, width, height);
    const pixelsMoved = (motion.position(4025).x - 0.5) * width;
    assert.ok(pixelsMoved > 4 && pixelsMoved <= 6, `slow 6 px move should survive: ${pixelsMoved}`);
  }
});

test('fast movement responds more quickly than fixed smoothing at 8, 15, 24 and 30 Hz', (t) => {
  for (const hz of [8, 15, 24, 30]) {
    const motion = new HandMotion();
    let old = 500;
    const errors = [], oldErrors = [];
    for (let i = 0; i < hz; i++) {
      const now = i * 1000 / hz, x = 500 + 800 * now / 1000;
      old += (x - old) * 0.42;
      motion.update(x / 2000, 0.5, now, 2000, 1000);
      if (i > hz / 3) {
        errors.push(x - motion.position(now + 25).x * 2000);
        oldErrors.push(x - old);
      }
    }
    assert.ok(rms(errors) < 8);
    assert.ok(rms(errors) < rms(oldErrors) * 0.3);
    t.diagnostic(`${hz} Hz, 800 px/s sample-target error: old=${rms(oldErrors).toFixed(2)} px, new=${rms(errors).toFixed(2)} px (excludes camera/inference latency)`);
  }
});

test('render interpolation advances between samples, stops at target and never extrapolates', () => {
  const motion = new HandMotion();
  motion.update(0.5, 0.5, 0, 1000, 1000);
  motion.update(0.51, 0.5, 50, 1000, 1000, 70);
  const start = motion.position(70).x;
  const middle = motion.position(70 + motion.duration / 2).x;
  const end = motion.position(70 + motion.duration).x;
  assert.ok(start < middle && middle < end && end < 0.51);
  assert.deepEqual(motion.position(500), motion.position(1000));
  assert.ok(motion.duration <= CONFIG.handMotion.maxInterpolationMs);
});

test('normal movement bridges more of a slow inference cadence without lengthening fast-motion response', () => {
  const steady = new HandMotion(), fast = new HandMotion();
  steady.update(.5,.5,0,1000,1000);
  fast.update(.5,.5,0,1000,1000);
  steady.update(.508,.5,80,1000,1000,150);
  fast.update(.58,.5,80,1000,1000,150);
  assert.ok(steady.duration>30 && steady.duration<=55);
  assert.ok(fast.duration<25);
  assert.ok(steady.position(180).x<steady.position(195).x);
});

test('capture timing, not delivery jitter or render frequency, controls filtering', () => {
  const a = new HandMotion(), b = new HandMotion();
  let now = 0;
  for (let i = 0; i < 100; i++) {
    now += [33, 51, 40, 67][i % 4];
    a.update(0.4 + i * 0.002, 0.5, now, 1000, 1000, now + 10);
    b.update(0.4 + i * 0.002, 0.5, now, 1000, 1000, now + [5, 25, 15][i % 3]);
    for (let frame = 0; frame < 4; frame++) b.position(now + frame * 8);
    assert.deepEqual(a.target, b.target);
  }
  const before = a.position(now + 100);
  a.update(0.9, 0.9, now - 1, 1000, 1000);
  a.update(NaN, 0.9, now + 1, 1000, 1000);
  assert.deepEqual(a.position(now + 100), before);
});

test('loss, explicit reset and resizing clear velocity and old position', () => {
  const motion = new HandMotion();
  motion.update(0.2, 0.2, 0, 1000, 1000);
  motion.update(0.8, 0.8, 50, 1000, 1000);
  motion.update(0.1, 0.1, 400, 1000, 1000);
  assert.deepEqual(motion.position(400), { x: 0.1, y: 0.1 });
  assert.equal(motion.speed, 0);
  motion.update(0.3, 0.3, 450, 400, 800);
  assert.deepEqual(motion.position(450), { x: 0.3, y: 0.3 });
  motion.reset();
  assert.equal(motion.position(500), null);
  motion.update(0.7, 0.7, 500, 400, 800);
  assert.deepEqual(motion.position(500), { x: 0.7, y: 0.7 });
});
