import test from 'node:test';
import assert from 'node:assert/strict';
import { PoseController } from '../src/interaction/PoseController.js';
import { CONFIG } from '../src/config.js';

function fakeVideo(width = 640, height = 480) {
  return { videoWidth: width, videoHeight: height };
}
// integrate() guards on this.active (set by the real start()) so a result that
// arrives after stop() is ignored; tests drive integrate() directly, so flip it.
function makeController(video, callbacks) {
  const controller = new PoseController(video, callbacks);
  controller.active = true;
  return controller;
}
// A pose centered at normalized (cx, cy) in a 640x480 frame, tall enough to
// count as "in the interaction zone" (boxRatio > CONFIG.poseInteractBoxRatio).
function poseAt(cx, cy, { width = 640, height = 480, tall = true } = {}) {
  const halfW = width * 0.08,
    halfH = height * (tall ? 0.2 : 0.05);
  const x = cx * width,
    y = cy * height;
  return {
    score: 0.9,
    keypoints: [
      { x, y: y - halfH, score: 0.9, name: 'nose' },
      { x: x - halfW, y: y + halfH, score: 0.9, name: 'left_ankle' },
      { x: x + halfW, y: y + halfH, score: 0.9, name: 'right_ankle' },
    ],
  };
}

test('a tracked person is mirrored into normalized, screen-facing coordinates', () => {
  const controller = makeController(fakeVideo(), {});
  const pose = poseAt(0.2, 0.5);
  pose.id = 'a';
  controller.integrate([pose], 0.1);
  const person = controller.people.get('a');
  // Mirrored: someone at normalized x=0.2 in the raw frame appears at 1-0.2 to the visitor.
  assert.ok(Math.abs(person.x - 0.8) < 0.02);
  assert.ok(Math.abs(person.y - 0.5) < 0.02);
});

test('holding still in the interaction zone eventually reveals a silhouette exactly once', () => {
  let silhouettes = 0;
  const controller = makeController(fakeVideo(), { silhouette: () => silhouettes++ });
  const pose = poseAt(0.5, 0.5);
  pose.id = 'a';
  // Feed enough still frames to cross both the "quiet" and "silhouette" hold times.
  const steps = Math.ceil((CONFIG.poseSilhouetteHold + 1) / 0.2);
  for (let i = 0; i < steps; i++) controller.integrate([pose], 0.2);
  assert.equal(silhouettes, 1, 'should reveal once after holding still long enough');
  for (let i = 0; i < 5; i++) controller.integrate([pose], 0.2);
  assert.equal(silhouettes, 1, 'should not re-trigger while still holding the same pose');
});

test('moving resets stillness so a later hold can reveal a silhouette again', () => {
  let silhouettes = 0;
  const controller = makeController(fakeVideo(), { silhouette: () => silhouettes++ });
  const id = 'a';
  const steps = Math.ceil((CONFIG.poseSilhouetteHold + 1) / 0.2);
  for (let i = 0; i < steps; i++) {
    const pose = poseAt(0.5, 0.5);
    pose.id = id;
    controller.integrate([pose], 0.2);
  }
  assert.equal(silhouettes, 1);
  // Walk away long enough for stillT to decay back below the "quiet" hold,
  // not just long enough to stop the silhouette from re-triggering.
  for (let i = 0; i < 20; i++) {
    const pose = poseAt(0.5 + i * 0.05, 0.5);
    pose.id = id;
    controller.integrate([pose], 0.2);
  }
  assert.equal(controller.people.get(id).quiet, false, 'walking away should clear "quiet"');
  for (let i = 0; i < steps; i++) {
    const pose = poseAt(0.75, 0.5);
    pose.id = id;
    controller.integrate([pose], 0.2);
  }
  assert.equal(silhouettes, 2, 'a fresh hold after moving away should reveal again');
});

test('a person outside the interaction zone never counts as quiet', () => {
  const controller = makeController(fakeVideo(), {});
  const pose = poseAt(0.5, 0.5, { tall: false });
  pose.id = 'a';
  for (let i = 0; i < 20; i++) controller.integrate([pose], 0.2);
  assert.equal(controller.people.get('a').quiet, false);
});

test('multiple visitors still drive ambient presence and stopping clears them', () => {
  let people = [];
  const controller = makeController(fakeVideo(), { presence: (value) => { people = value; } });
  controller.integrate([
    { ...poseAt(0.3, 0.5), id: 'left' },
    { ...poseAt(0.6, 0.5), id: 'right' },
  ], 0.1);
  assert.equal(people.length, 2);
  assert.ok(people[0].x > people[1].x, 'both visitors retain mirrored positions');
  controller.stop();
  assert.deepEqual(people, []);
});

test('walking a visible distance leaves a trail; standing still does not', () => {
  let trails = 0;
  const controller = makeController(fakeVideo(), { trail: () => trails++ });
  const id = 'a';
  const first = poseAt(0.2, 0.5);
  first.id = id;
  controller.integrate([first], 0.1);
  const still = poseAt(0.201, 0.5);
  still.id = id;
  controller.integrate([still], 0.1);
  assert.equal(trails, 0);
  const walked = poseAt(0.2 + CONFIG.poseTrailDistance + 0.02, 0.5);
  walked.id = id;
  controller.integrate([walked], 0.1);
  assert.equal(trails, 1);
});

test('a person who disappears is forgotten after the timeout, not before', () => {
  const controller = makeController(fakeVideo(), {});
  const pose = poseAt(0.5, 0.5);
  pose.id = 'a';
  controller.integrate([pose], 0.1);
  controller.clockSeconds += CONFIG.poseTimeout - 0.5;
  controller.integrate([], 0.1);
  assert.ok(controller.people.has('a'), 'should not be evicted before the timeout');
  controller.clockSeconds += CONFIG.poseTimeout + 0.5;
  controller.integrate([], 0.1);
  assert.ok(!controller.people.has('a'), 'should be evicted after the timeout');
});
