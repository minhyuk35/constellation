import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3, Quaternion } from 'three';
import { VRModel } from '../src/vr/VRModel.js';
import { PinchLatch } from '../src/vr/VRInput.js';
import { SHAPE_MAP } from '../src/data/shapes.js';
const heart = SHAPE_MAP.get('heart');
const addHeart = (model) =>
  heart.points.forEach((p) => model.add(new Vector3(p.x * 0.4, 1.6 + p.y * 0.4, -0.65)));
test('VR keeps depth, recognizes multiple independent works around the viewer, and undoes a completion', () => {
  const model = new VRModel();
  addHeart(model);
  const one = model.finish();
  assert.equal(one.shapeId, 'heart');
  assert.equal(model.draft.stars.length, 0);
  assert.equal(model.works.length, 1);
  const center = new Vector3(0, 1.6, 0);
  assert.ok(new Vector3().copy(one.position).distanceTo(center) > 3);
  for (let i = 1; i < 10; i++) {
    addHeart(model);
    assert.ok(model.finish());
  }
  assert.equal(model.works.length, 10);
  assert.ok(
    model.works.some((w) => w.position.z > 0),
    'some constellations are behind the viewer',
  );
  assert.ok(
    new Set(model.works.map((w) => Math.round(Math.hypot(w.position.x, w.position.z)))).size >= 2,
    'multiple distances create parallax',
  );
  assert.equal(model.undo(), true);
  assert.equal(model.works.length, 9);
  assert.equal(model.draft.stars.length, heart.points.length);
});
test('VR star movement uses full XYZ transforms; ray picking and deletion preserve other works', () => {
  const model = new VRModel();
  addHeart(model);
  const work = model.finish(
    new Vector3(1, 1.7, 2),
    new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.7),
  );
  const target = { entity: work, star: work.stars[0] },
    p = new Vector3(1.3, 2.1, -2.4);
  model.remember();
  model.move(target, p);
  assert.ok(model.world(work, target.star).distanceTo(p) < 1e-7);
  const head = new Vector3(0, 1.6, 0),
    hit = model.pickRay(head, p.clone().sub(head).normalize());
  assert.ok(hit);
  model.endMove(target);
  const count = work.stars.length;
  model.remove(target);
  assert.equal(work.stars.length, count - 1);
  assert.equal(model.undo(), true);
  assert.equal(model.works[0].stars.length, count);
});
test('VR sky remains anchored while the user turns, and deleting a work reuses only its empty place', () => {
  const model = new VRModel();
  addHeart(model);
  const first = model.finish();
  addHeart(model);
  const second = model.finish(
    new Vector3(2, 1.6, 1),
    new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), -Math.PI / 4),
  );
  assert.equal(second.cell, 1);
  assert.ok(new Vector3().copy(first.position).distanceTo(new Vector3().copy(second.position)) > 2);
  for (const star of [...first.stars]) model.remove({ entity: first, star });
  assert.equal(model.works.length, 1);
  const before = structuredClone(second.position);
  addHeart(model);
  const replacement = model.finish();
  assert.equal(replacement.cell, 0);
  assert.deepEqual(second.position, before);
  assert.ok(
    new Vector3().copy(replacement.position).distanceTo(new Vector3().copy(second.position)) > 2,
  );
});

test('VR pinch has hysteresis, confirms intent, and requires opening again after tracking loss', () => {
  const latch = new PinchLatch();
  assert.equal(latch.update(0.01, 0), false, 'closed hands on acquisition cannot create a star');
  latch.update(0.05, 10);
  assert.equal(latch.update(0.01, 20), false);
  assert.equal(latch.update(0.01, 40), false);
  assert.equal(latch.update(0.01, 60), true);
  assert.equal(latch.update(0.028, 80), true);
  assert.equal(latch.update(0.034, 100), false);
  latch.update(0.01, 120);
  assert.equal(latch.update(0.01, 160), true);
  latch.update(NaN, 180);
  assert.equal(latch.update(0.01, 240), false);
  assert.equal(latch.update(0.01, 300), false);
});
