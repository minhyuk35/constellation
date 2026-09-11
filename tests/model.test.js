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
