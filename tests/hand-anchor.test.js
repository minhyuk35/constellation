import test from 'node:test';
import assert from 'node:assert/strict';
import { HandAnchor } from '../src/interaction/HandAnchor.js';

test('closing and reopening fingers never jumps the pointer when the palm stays still', () => {
  const anchor = new HandAnchor(), palm = { x: .42, y: .6 }, initial = { x: .55, y: .35 };
  anchor.update(initial, palm, false);
  const folded = anchor.update({ x: .30, y: .59 }, palm, true);
  assert.deepEqual(folded, initial);
  assert.deepEqual(anchor.update({ x: .31, y: .59 }, palm, true), initial);
  assert.deepEqual(anchor.update({ x: .58, y: .32 }, palm, false), initial);
});

test('palm movement continues naturally during a fist and resets on hand loss', () => {
  const anchor = new HandAnchor();
  anchor.update({ x: .5, y: .4 }, { x: .4, y: .6 }, false);
  const p = anchor.update({ x: .3, y: .6 }, { x: .43, y: .62 }, true);
  assert.ok(Math.abs(p.x - .53) < 1e-9); assert.ok(Math.abs(p.y - .42) < 1e-9);
  anchor.reset();
  assert.deepEqual(anchor.update({ x: .8, y: .2 }, { x: .7, y: .4 }, false), { x: .8, y: .2 });
});
