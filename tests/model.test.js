import test from 'node:test';
import assert from 'node:assert/strict';
import { CanvasModel } from '../src/interaction/CanvasModel.js';

test('a complete drag is one undoable transaction and keeps user edges', () => {
  const model = new CanvasModel();
  const a = model.add(0.3, 0.3),
    b = model.add(0.6, 0.6);
  model.connect(a.id, b.id);
  const before = model.snapshot();
  model.beginDrag(a.id);
  model.move(a.id, 0.4, 0.4);
  model.move(a.id, 0.5, 0.5);
  model.endDrag(a.id);
  assert.deepEqual(model.edges, before.edges);
  assert.equal(model.undo(), true);
  assert.deepEqual(model.snapshot(), before);
});
test('two hands cannot claim the same star, but can move separate stars', () => {
  const model = new CanvasModel();
  const a = model.add(0.2, 0.2),
    b = model.add(0.8, 0.8);
  assert.equal(model.beginDrag(a.id), true);
  assert.equal(model.beginDrag(a.id), false);
  assert.equal(model.beginDrag(b.id), true);
  model.endDrag(a.id);
  assert.equal(model.dragging, true);
  model.endDrag(b.id);
  assert.equal(model.dragging, false);
});
test('deleting a selected star removes only its edges; undo restores it', () => {
  const model = new CanvasModel();
  const a = model.add(0.2, 0.2),
    b = model.add(0.4, 0.4),
    c = model.add(0.6, 0.6);
  model.connect(a.id, b.id);
  model.connect(b.id, c.id);
  model.select(a.id);
  const before = model.snapshot();
  model.removeSelected();
  assert.equal(model.stars.length, 2);
  assert.deepEqual(model.edges, [[b.id, c.id]]);
  model.undo();
  assert.deepEqual(model.snapshot(), before);
});
test('shaking a held star left and right deletes it as one undoable step', () => {
  const model = new CanvasModel();
  const a = model.add(0.2, 0.2),
    b = model.add(0.8, 0.8);
  model.connect(a.id, b.id);
  const before = model.snapshot();
  let deleted = null;
  model.addEventListener('shake-delete', ({ detail }) => (deleted = detail.star));
  model.beginDrag(a.id);
  // Several quick, real left-right reversals covering real distance.
  for (const x of [0.2, 0.45, 0.15, 0.45, 0.15, 0.45]) model.move(a.id, x, 0.2);
  assert.ok(deleted, 'shake-delete should have fired');
  assert.equal(deleted.id, a.id);
  assert.equal(model.stars.length, 1);
  assert.equal(model.edges.length, 0, 'edges touching the deleted star are gone too');
  assert.equal(model.dragging, false, 'the shaken star is released from dragging');
  assert.equal(model.undo(), true);
  assert.deepEqual(model.snapshot(), before);
});
test('smoothly dragging in one direction never triggers a shake-delete', () => {
  const model = new CanvasModel();
  const a = model.add(0.1, 0.1);
  let deleted = false;
  model.addEventListener('shake-delete', () => (deleted = true));
  model.beginDrag(a.id);
  for (let i = 1; i <= 10; i++) model.move(a.id, 0.1 + i * 0.03, 0.1 + i * 0.03);
  assert.equal(deleted, false);
  assert.equal(model.stars.length, 1);
});
test('small jitter while dragging does not count as a shake', () => {
  const model = new CanvasModel();
  const a = model.add(0.5, 0.5);
  let deleted = false;
  model.addEventListener('shake-delete', () => (deleted = true));
  model.beginDrag(a.id);
  for (const x of [0.5, 0.502, 0.499, 0.501, 0.4985, 0.5005]) model.move(a.id, x, 0.5);
  assert.equal(deleted, false);
});
test('two hands can shake their own stars independently', () => {
  const model = new CanvasModel();
  const a = model.add(0.2, 0.2),
    b = model.add(0.8, 0.8);
  const deleted = [];
  model.addEventListener('shake-delete', ({ detail }) => deleted.push(detail.star.id));
  model.beginDrag(a.id);
  model.beginDrag(b.id);
  // Only shake star a; star b just drifts smoothly.
  for (const x of [0.2, 0.45, 0.15, 0.45, 0.15, 0.45]) model.move(a.id, x, 0.2);
  model.move(b.id, 0.82, 0.82);
  assert.deepEqual(deleted, [a.id]);
  assert.equal(model.stars.length, 1);
  assert.equal(model.dragging, true, 'star b is still mid-drag');
});
test('clear can be undone; star limits and viewport boundaries are respected', () => {
  const model = new CanvasModel();
  for (let i = 0; i < 48; i++) assert.ok(model.add(i / 50, i / 50));
  assert.equal(model.add(0.5, 0.5), null);
  const before = model.snapshot();
  model.clear();
  assert.equal(model.stars.length, 0);
  model.undo();
  assert.deepEqual(model.snapshot(), before);
  assert.ok(model.stars.every((s) => s.x >= 0 && s.x <= 1 && s.y >= 0 && s.y <= 1));
});
