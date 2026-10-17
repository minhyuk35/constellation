import test from 'node:test';
import assert from 'node:assert/strict';
import { HandController } from '../src/interaction/HandController.js';
import { CanvasModel } from '../src/interaction/CanvasModel.js';

function hand(x = 0.5, y = 0.5, gesture = 'pinch') {
  const points = Array.from({ length: 21 }, () => ({ x: 0, y: 0.6, z: 0 }));
  points[0] = { x: 0, y: 0.85 };
  points[9] = { x: 0, y: 0.55 };
  points[5] = { x: -0.1, y: 0.55 };
  points[17] = { x: 0.2, y: 0.57 };
  for (const [i, tip] of [8, 12, 16, 20].entries()) {
    points[tip - 2] = { x: (i - 1) * 0.1, y: 0.38 };
    points[tip] = { x: (i - 1) * 0.1, y: gesture === 'fist' ? 0.6 : 0.12 };
  }
  points[4] = { ...points[8], x: points[8].x + (gesture === 'open' ? 0.3 : 0.02) };
  const anchor = gesture === 'fist' ? points[9] : {
    x: (points[4].x + points[8].x) / 2, y: (points[4].y + points[8].y) / 2,
  };
  return points.map((p) => ({ x: p.x + 1 - x - anchor.x, y: p.y + y - anchor.y }));
}

function setup(exclusive = false) {
  const layer = { children: [], append(el) { this.children.push(el); } };
  globalThis.window = { addEventListener() {} };
  globalThis.document = {
    hidden: false, dialog: false,
    addEventListener() {}, getElementById: () => layer,
    querySelector() { return this.dialog ? {} : null; },
    createElement: () => ({ style: { setProperty() {} } }),
  };
  const model = new CanvasModel();
  const controller = new HandController(
    { readyState: 0, pause() {} }, { clientWidth: 1000, clientHeight: 1000 }, model,
    { burst() {}, chime() {}, toast() {}, hands() {}, status() {} },
    { exclusive },
  );
  controller.active = true;
  function frame(landmarks, time) {
    controller.process(landmarks, time);
    controller.tick(time + 25);
  }
  return { controller, model, frame, layer };
}

test('exclusive control prevents unarmed fists and passers from editing the canvas', () => {
  const { controller, model, frame } = setup(true);
  for (let t = 0; t < 1600; t += 100) frame([hand(.5, .4, 'fist')], t);
  assert.equal(model.stars.length, 0);
  for (let t = 1700; t <= 2800; t += 100) frame([hand(.5, .2, 'open')], t);
  assert.equal(controller.gate.state.phase, 'active');
  for (let t = 2900; t <= 4200; t += 100) frame([hand(.5, .2, 'open'), hand(.9, .8, 'fist')], t);
  assert.equal(model.stars.length, 0);
  assert.equal(controller.slots.filter((s) => s.gesture !== 'lost').length, 1);
});

test('pinch/fist glitches do not repeatedly release/regrab or create undo entries', () => {
  const { controller, model, frame } = setup();
  const star = model.add(0.5, 0.5);
  frame([hand()], 100);
  assert.equal(model.dragging, false, 'one sample is not a confirmed grab');
  frame([hand()], 140);
  assert.ok(model.draggers.has(star.id));
  const history = model.history.length;
  for (const [i, gesture] of ['fist', 'pinch', 'open', 'pinch', 'fist', 'pinch'].entries())
    frame([hand(0.5, 0.5, gesture)], 180 + i * 40);
  assert.ok(model.draggers.has(star.id));
  assert.equal(model.history.length, history);
  frame([hand(0.5, 0.5, 'open')], 450);
  assert.equal(model.dragging, true);
  frame([hand(0.5, 0.5, 'open')], 490);
  assert.equal(model.dragging, false);
  assert.equal(controller.slots.find((s) => s.seen).gesture, 'open');
  assert.equal(model.undo(), true);
  assert.equal(model.stars[0].x, 0.5);
});

test('render frames move the star while inference is busy; shake sees only camera samples', () => {
  const { controller, model, frame, layer } = setup();
  const star = model.add(0.5, 0.5);
  frame([hand()], 100);
  frame([hand()], 140);
  controller.process([hand(0.51)], 180);
  controller.busy = true;
  const samples = model.shakeTracking.get(star.id).length;
  controller.tick(184);
  const middle = star.x;
  controller.tick(205);
  assert.ok(middle > 0.5 && star.x > middle);
  assert.equal(model.shakeTracking.get(star.id).length, samples);
  assert.equal(layer.children[0].style.transform, `translate3d(${star.x * 100}vw, ${star.y * 100}vh, 0) translate(-50%, -50%)`);
});

test('hand picking reaches 76 CSS pixels and chooses the nearest star', () => {
  const { controller, model, frame } = setup();
  const farther = model.add(.5, .5), closer = model.add(.55, .5);
  frame([hand(.62)], 100);
  frame([hand(.62)], 140);
  assert.ok(model.draggers.has(closer.id), '70px away is reachable without precise fingertip placement');
  assert.equal(model.draggers.has(farther.id), false);
  controller.releaseAll();
  const other = setup();
  other.model.add(.5, .5);
  other.frame([hand(.578)], 100);
  other.frame([hand(.578)], 140);
  assert.equal(other.model.dragging, false, '78px is outside the new radius');
  assert.equal(other.model.nearest(.56, .5, 1000, 1000), null, 'default mouse picking stays narrow');
});

test('a smooth fast drag is not mistaken for a shake when rendered positions lag', () => {
  const { model, frame } = setup();
  const star = model.add(0.2, 0.5);
  frame([hand(0.2)], 100);
  frame([hand(0.2)], 140);
  for (let i = 1; i <= 20; i++) frame([hand(0.2 + i * 0.025)], 140 + i * 33);
  assert.equal(model.stars.length, 1);
  assert.ok(star.x > 0.68);
  assert.equal(model.dragging, true);
});

test('deliberate hand shaking still deletes once and undo restores star and connections', () => {
  const { controller, model, frame } = setup();
  const a = model.add(0.5, 0.5), b = model.add(0.8, 0.8);
  model.connect(a.id, b.id);
  const before = model.snapshot();
  let deletions = 0;
  model.addEventListener('shake-delete', () => deletions++);
  frame([hand()], 100);
  frame([hand()], 140);
  for (const [i, x] of [0.55, 0.45, 0.55, 0.45, 0.55, 0.45].entries())
    frame([hand(x)], 180 + i * 40);
  assert.equal(deletions, 1);
  assert.equal(model.stars.length, 1);
  assert.equal(controller.slots.some((s) => s.held), false);
  assert.equal(model.undo(), true);
  assert.deepEqual(model.snapshot(), before);
});

test('each hand retains its star and filter when detection order changes', () => {
  const { controller, model, frame } = setup();
  const a = model.add(0.25, 0.5), b = model.add(0.75, 0.5);
  frame([hand(0.25), hand(0.75)], 100);
  frame([hand(0.75), hand(0.25)], 140);
  const owners = controller.slots.map((s) => s.held);
  for (let i = 1; i <= 6; i++) {
    const hands = [hand(0.25 + i * 0.01), hand(0.75 - i * 0.01)];
    frame(i % 2 ? hands.reverse() : hands, 140 + i * 40);
    assert.deepEqual(controller.slots.map((s) => s.held), owners);
  }
  assert.ok(a.x > 0.29 && b.x < 0.71);
});

test('holding a fist creates once despite a single-frame gesture glitch', () => {
  const { model, frame } = setup();
  for (let i = 0; i < 65; i++)
    frame([hand(0.5, 0.5, i === 35 ? 'open' : 'fist')], 100 + i * 40);
  assert.equal(model.stars.length, 1);
  assert.ok(Math.abs(model.stars[0].x - 0.5) < 0.002);
});

test('loss and camera stop release dragging; reacquisition starts without old filter inertia', () => {
  const { controller, model, frame } = setup();
  model.add(0.5, 0.5);
  frame([hand()], 100);
  frame([hand()], 140);
  frame([], 450);
  assert.equal(model.dragging, false);
  assert.equal(controller.slots.every((s) => s.motion.position(450) === null), true);
  frame([hand(0.8)], 500);
  const slot = controller.slots.find((s) => s.seen);
  assert.ok(Math.abs(slot.x - 0.8) < 1e-10);
  controller.stop();
  frame([hand()], 550);
  assert.equal(controller.slots.every((s) => s.gesture === 'lost'), true);
});

test('hidden tabs, dialogs and stale results cannot continue moving a held star', () => {
  for (const condition of ['hidden', 'dialog', 'stale']) {
    const { controller, model, frame } = setup();
    model.add(0.5, 0.5);
    frame([hand()], 100);
    frame([hand()], 140);
    if (condition === 'stale') controller.process([hand(0.8)], 600, 180);
    else {
      document[condition] = true;
      controller.tick(180);
    }
    assert.equal(model.dragging, false);
  }
});

test('duplicate/out-of-order results do not alter motion or confirm a gesture', () => {
  const { controller, model, frame } = setup();
  model.add(0.5, 0.5);
  frame([hand()], 100);
  controller.process([hand(0.8)], 150, 100);
  controller.process([hand(0.8)], 180, 90);
  assert.equal(model.dragging, false);
  assert.ok(Math.abs(controller.slots[0].x - 0.5) < 1e-10);
  frame([hand()], 200);
  assert.equal(model.dragging, true);
});

test('slow continuous inference does not double-count latency as a lost hand', () => {
  const { controller, model } = setup();
  const star = model.add(0.5, 0.5);
  for (let i = 0; i < 10; i++) {
    const captured = 100 + i * 125, received = captured + 130;
    controller.process([hand()], received, captured);
    controller.tick(received + 25);
    if (i > 0) assert.ok(model.draggers.has(star.id));
  }
  assert.equal(model.history.length, 2, 'only add and one grab, without repeated regrabs');
});

test('capture cadence uses fresh video frames, a 33 ms minimum and no inference backlog', async (t) => {
  const { controller } = setup();
  const original = globalThis.createImageBitmap;
  t.after(() => {
    if (original) globalThis.createImageBitmap = original;
    else delete globalThis.createImageBitmap;
  });
  let captures = 0;
  const timestamps = [];
  globalThis.createImageBitmap = async () => {
    captures++;
    return { close() {} };
  };
  controller.video.readyState = 2;
  controller.video.currentTime = 0;
  controller.worker = { postMessage: (data) => timestamps.push(data.timestamp) };
  controller.tick(100);
  controller.tick(134);
  assert.equal(captures, 1, 'bitmap capture also counts as busy');
  await Promise.resolve();
  controller.tick(168);
  assert.equal(captures, 1, 'do not queue frames behind inference');
  controller.busy = false;
  controller.tick(200);
  assert.equal(captures, 1, 'same decoded video frame is not reprocessed');
  controller.video.currentTime = 1 / 30;
  controller.tick(210);
  await Promise.resolve();
  controller.busy = false;
  controller.video.currentTime = 2 / 30;
  controller.tick(225);
  assert.equal(captures, 2, 'requests remain capped even with a fresh frame');
  controller.tick(244);
  await Promise.resolve();
  assert.deepEqual(timestamps, [100, 210, 244]);
});
