import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyHand } from '../src/interaction/gestures.js';

function landmarks(open = true) {
  const points = Array.from({ length: 21 }, () => ({ x: 0, y: 0.6, z: 0 }));
  points[0] = { x: 0, y: 0.85 };
  points[9] = { x: 0, y: 0.55 };
  points[5] = { x: -0.1, y: 0.55 };
  points[17] = { x: 0.2, y: 0.57 };
  for (const [i, tip] of [8, 12, 16, 20].entries()) {
    points[tip - 2] = { x: (i - 1) * 0.1, y: 0.38 };
    points[tip] = { x: (i - 1) * 0.1, y: open ? 0.12 : 0.6 };
  }
  points[4] = { x: -0.3, y: 0.45 };
  return points;
}
test('open palm and closed fist classification is invariant to hand rotation and scale', () => {
  for (const open of [true, false]) {
    const original = landmarks(open);
    for (const scale of [0.6, 1.5]) {
      const angle = 0.9;
      const transformed = original.map((p) => ({
        x: (p.x * Math.cos(angle) - p.y * Math.sin(angle)) * scale,
        y: (p.x * Math.sin(angle) + p.y * Math.cos(angle)) * scale,
      }));
      assert.equal(classifyHand(transformed).gesture, open ? 'open' : 'fist');
    }
  }
});
test('pinch hysteresis holds a grabbed star through small fingertip jitter', () => {
  const points = landmarks();
  points[4] = { ...points[8], x: points[8].x + 0.12 };
  assert.notEqual(classifyHand(points).gesture, 'pinch');
  assert.equal(classifyHand(points, 'pinch').gesture, 'pinch');
  points[4].x += 0.12;
  assert.notEqual(classifyHand(points, 'pinch').gesture, 'pinch');
});
test('missing landmarks release tracking and a fist cannot accidentally become a pinch', () => {
  assert.equal(classifyHand([]).gesture, 'lost');
  const points = landmarks(false);
  points[4] = { ...points[8] };
  assert.equal(classifyHand(points, 'pinch').gesture, 'fist');
});
