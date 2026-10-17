import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3, Quaternion } from 'three';
import { VRModel } from '../src/vr/VRModel.js';
import { VRGestures, VRShake } from '../src/vr/VRGestures.js';
import { SHAPES, SHAPE_MAP } from '../src/data/shapes.js';
import { handPoints } from './fixtures/vr-hands.js';
const heart = SHAPE_MAP.get('heart');
const addHeart = (model) => {
  heart.points.forEach((p) => model.add(new Vector3(p.x * 0.4, 1.6 + p.y * 0.4, -0.65)));
  model.identify(model.draft);
};
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

test('VR shares webcam gestures: fist hold creates once, pinch grabs with confirmation, tracking loss rearms', () => {
  const gestures = new VRGestures(), fist = handPoints('fist'), pinch = handPoints('pinch'), open = handPoints('open');
  gestures.update(fist, 0);
  assert.equal(gestures.update(fist, 40).gesture, 'fist');
  assert.equal(gestures.update(fist, 1000).spawn, false);
  assert.equal(gestures.update(fist, 1100).spawn, true);
  assert.equal(gestures.update(fist, 3000).spawn, false);
  gestures.update(pinch, 3050);
  assert.equal(gestures.update(pinch, 3090).grab, true);
  assert.equal(gestures.update(pinch, 3130).grab, false);
  assert.equal(gestures.update(null, 3150).release, true);
  gestures.update(pinch, 3200);
  assert.equal(gestures.update(pinch, 3240).grab, false);
  gestures.update(open, 3300); gestures.update(open, 3340);
  gestures.update(pinch, 3400);
  assert.equal(gestures.update(pinch, 3440).grab, true);
});

test('all 200 VR presets preserve website points, edges, names and illustrations after completion', () => {
  for (const shape of SHAPES) {
    const model = new VRModel();
    model.loadPreset(shape, new Vector3(1, 1.6, 2), new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 1.4));
    assert.equal(model.draft.shapeId, shape.id);
    assert.deepEqual(model.draft.edges, shape.edges);
    assert.deepEqual(model.draft.stars.map(({ x, y }) => ({ x, y })), shape.points);
    const completed = model.finish();
    assert.equal(completed.shapeId, shape.id);
    assert.equal(completed.title, shape.name);
    assert.deepEqual(completed.edges, shape.edges);
  }
});

test('VR shake rejects tiny jitter and slow movement; quick horizontal reversals delete in one undo step', () => {
  const jitter = new VRShake(), slow = new VRShake();
  for (let t = 0; t < 1600; t += 11) {
    assert.equal(jitter.update(Math.sin(t) * .002, t), false);
    assert.equal(slow.update(t * .0001, t), false);
  }
  const shake = new VRShake();
  assert.equal(shake.update(0, 0), false);
  assert.equal(shake.update(.1, 60), false);
  assert.equal(shake.update(-.1, 120), false);
  assert.equal(shake.update(.1, 180), false);
  assert.equal(shake.update(-.1, 240), true);
  const model = new VRModel(), target = model.add(new Vector3(0, 1.4, -.5));
  model.remember(); model.move(target, new Vector3(.3, 1.4, -.5));
  model.remove(target, { remember: false });
  model.undo();
  assert.ok(model.world(model.draft, model.draft.stars[0]).distanceTo(new Vector3(0, 1.4, -.5)) < 1e-7);
});
