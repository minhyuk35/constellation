import test from 'node:test';
import assert from 'node:assert/strict';
import { SHAPES } from '../src/data/shapes.js';
import { matchShapes, buildConnections } from '../src/recognition/matcher.js';

test('all 16 shapes survive scale, rotation, translation, reflection, and insertion-order changes', () => {
  for (const shape of SHAPES) {
    for (const mirror of [1, -1]) {
      const a = 0.73;
      const transformed = shape.points
        .map((p) => ({
          x: 42 + 190 * (p.x * mirror * Math.cos(a) - p.y * Math.sin(a)),
          y: -79 + 190 * (p.x * mirror * Math.sin(a) + p.y * Math.cos(a)),
        }))
        .reverse();
      const [best] = matchShapes(transformed, SHAPES);
      assert.equal(best.shape.id, shape.id, `${shape.id}, mirror=${mirror}`);
      assert.ok(best.similarity > 98);
    }
  }
});
test('moderate placement noise still identifies Aries, chrysanthemum, and playful everyday objects', () => {
  for (const id of ['aries', 'flower', 'poop', 'car', 'butterfly']) {
    const shape = SHAPES.find((s) => s.id === id);
    const points = shape.points.map((p, i) => ({
      x: p.x + Math.sin(i * 2.1) * 0.022,
      y: p.y + Math.cos(i * 1.3) * 0.022,
    }));
    assert.equal(matchShapes(points, SHAPES)[0].shape.id, id);
  }
});
test('connecting a noisy placement preserves every actual point and includes every star', () => {
  const shape = SHAPES.find((s) => s.id === 'house');
  const points = [
    ...shape.points.map((p) => ({ ...p })),
    { x: -0.62, y: -0.3 },
    { x: 0.3, y: 0.5 },
  ];
  const snapshot = structuredClone(points);
  const match = matchShapes(points, [shape])[0];
  const edges = buildConnections(points, match);
  assert.deepEqual(points, snapshot);
  assert.equal(new Set(edges.flat()).size, points.length);
  assert.ok(edges.every(([a, b]) => a !== b && a >= 0 && b < points.length));
  const reached = new Set([0]);
  for (let i = 0; i < points.length; i++)
    for (const [a, b] of edges)
      if (reached.has(a) || reached.has(b)) {
        reached.add(a);
        reached.add(b);
      }
  assert.equal(reached.size, points.length);
});
test('empty, underspecified, nonfinite, coincident, and oversized input is rejected', () => {
  for (const p of [
    [],
    [{ x: 0, y: 0 }],
    Array(4).fill({ x: 1, y: 1 }),
    Array(4).fill({ x: NaN, y: 0 }),
    Array(49).fill({ x: 1, y: 2 }),
  ])
    assert.deepEqual(matchShapes(p, SHAPES), []);
});
