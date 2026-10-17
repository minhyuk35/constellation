import test from 'node:test';
import assert from 'node:assert/strict';
import { HandControlGate } from '../src/interaction/HandControlGate.js';

function hand(x = 0.5, y = 0.5, open = true, side = 'Right') {
  const lm = Array.from({ length: 21 }, () => ({ x: 1 - x, y, z: 0 }));
  lm[0].y += 0.12;
  lm[9].y -= 0.02;
  lm[5].x -= 0.06;
  lm[17].x += 0.06;
  for (const [i, tip] of [8, 12, 16, 20].entries()) {
    lm[tip] = { x: 1 - x + (i - 1.5) * 0.035, y: y + (open ? -0.2 : 0.04) };
    lm[tip - 2] = { x: lm[tip].x, y: y - 0.08 };
  }
  lm[4] = { x: 1 - x - 0.2, y: y - 0.05 };
  return { lm, side };
}
function arm(gate, detection = hand(), start = 0) {
  for (let t = start; t <= start + 1000; t += 100) gate.update([detection], t);
}
test('passers, fists and short open palms cannot acquire control', () => {
  const gate = new HandControlGate();
  for (let t = 0; t <= 1500; t += 100)
    assert.deepEqual(gate.update([hand(0.1), hand(0.5, 0.5, false)], t), []);
  for (let t = 1600; t < 2400; t += 100) assert.deepEqual(gate.update([hand()], t), []);
  assert.equal(gate.owner, null);
  gate.update([], 2400);
  assert.equal(gate.candidate, null);
});
test('central palm hold selects exactly one hand despite detection order and other gestures', () => {
  const gate = new HandControlGate();
  arm(gate);
  const owner = hand(0.52, 0.5, false),
    passer = hand(0.8);
  assert.deepEqual(gate.update([passer, owner], 1100), [owner]);
  assert.deepEqual(gate.update([owner, passer], 1200), [owner]);
  assert.equal(gate.session, 1);
});
test('two simultaneous requests do not select an arbitrary visitor', () => {
  const gate = new HandControlGate();
  for (let t = 0; t <= 2000; t += 100)
    assert.deepEqual(gate.update([hand(0.35), hand(0.65)], t), []);
  assert.equal(gate.owner, null);
});
test('crossing hands pause immediately and a new palm hold is required', () => {
  const gate = new HandControlGate();
  arm(gate);
  assert.deepEqual(gate.update([hand(), hand(0.54, 0.5, true, 'Left')], 1100), []);
  assert.equal(gate.state.phase, 'lost');
  assert.deepEqual(gate.update([hand(0.52, 0.5, false)], 1200), []);
  arm(gate, hand(0.52), 1300);
  assert.equal(gate.state.phase, 'active');
  assert.equal(gate.session, 1, 'a short interruption remains the same work session');
});
test('loss retains ownership temporarily then allows a deliberate next visitor', () => {
  const gate = new HandControlGate();
  arm(gate);
  const other = hand(0.6, 0.5, true, 'Left');
  for (let t = 1100; t <= 3100; t += 100) assert.deepEqual(gate.update([other], t), []);
  arm(gate, other, 3300);
  assert.equal(gate.state.phase, 'active');
  assert.equal(gate.session, 2);
});
test('an inference gap cannot instantly reattach an owner or finish an interrupted hold', () => {
  const gate = new HandControlGate();
  arm(gate);
  assert.deepEqual(gate.update([hand(0.52, 0.5, false)], 1500), []);
  assert.equal(gate.needsRearm, true);
  const fresh = new HandControlGate();
  fresh.update([hand()], 0);
  fresh.update([hand()], 1000);
  assert.equal(fresh.owner, null);
  assert.equal(fresh.state.progress, 0);
});
