import test from 'node:test';
import assert from 'node:assert/strict';
import { sameWork, WORK_COORD_TOLERANCE } from '../src/exhibition/work-identity.js';
import { drawingPayload } from '../src/exhibition/sky-layout.js';

const drawing = () => ({
  stars: [{ x: -0.7, y: 0 }, { x: 0, y: 0.8 }, { x: 0.6, y: -0.2 }],
  edges: [[0, 1], [1, 2]],
});
const ticket = () => ({ title: '첫 별자리', drawing: drawing() });

test('a new name, changed star layout/count, or connection needs its own QR', () => {
  const first = ticket();
  assert.equal(sameWork(null, first.title, drawing()), false);
  assert.equal(sameWork(first, '다음 별자리', drawing()), false);
  const moved = drawing(); moved.stars[1].x += 0.1;
  assert.equal(sameWork(first, first.title, moved), false);
  const extra = drawing(); extra.stars.push({ x: 0.2, y: -0.4 });
  assert.equal(sameWork(first, first.title, extra), false);
  const connected = drawing(); connected.edges.push([0, 2]);
  assert.equal(sameWork(first, first.title, connected), false);
});

test('retries and tiny jitter reuse the saved QR, but accumulated movement cannot drift away from it', () => {
  const first = ticket();
  const next = drawing();
  next.edges = [[2, 1], [1, 0]];
  assert.equal(sameWork(first, first.title, next), true, 'edge order/direction is immaterial');
  next.stars[0].x += WORK_COORD_TOLERANCE * 0.5;
  assert.equal(sameWork(first, first.title, next), true);
  next.stars[0].x += WORK_COORD_TOLERANCE;
  assert.equal(sameWork(first, first.title, next), false, 'compare with saved snapshot, not the last noisy sample');
});

test('moving/resizing the whole canvas does not generate another QR for the same shape', () => {
  const stars = [{ id: 'a', x: 0.2, y: 0.3 }, { id: 'b', x: 0.4, y: 0.6 }, { id: 'c', x: 0.6, y: 0.4 }];
  const edges = [['a', 'b'], ['b', 'c']];
  const first = { title: '그대로인 별', drawing: drawingPayload(stars, edges, 1) };
  const shifted = stars.map(p => ({ ...p, x: 0.2 + p.x * 0.8, y: 0.1 + p.y * 0.8 }));
  assert.equal(sameWork(first, first.title, drawingPayload(shifted, edges, 1)), true);
});
