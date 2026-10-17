import test from 'node:test';
import assert from 'node:assert/strict';
import { findGuidance, guidanceComplete, guidanceText } from '../src/recognition/guidance.js';
import { SHAPES, SHAPE_MAP } from '../src/data/shapes.js';
import { matchShapes } from '../src/recognition/matcher.js';
const bounds = { left: .08, right: 1.6, bottom: -.88, top: -.16 };
const place = shape => shape.points.map(p => ({ x: .8 + p.x * .18, y: -.5 + p.y * .18 }));

test('a single star gets one or two visible creation targets from the existing catalogue', () => {
  const points = [{ x: .8, y: -.5 }], before = structuredClone(points);
  const guide = findGuidance(points, SHAPES, bounds, () => .3);
  assert.ok(guide); assert.ok(guide.actions.length <= 2);
  assert.ok(guide.actions.every(a => a.type === 'add'));
  assert.equal(guidanceComplete(points, guide), false);
  assert.equal(guidanceComplete(guide.targets, guide), true);
  assert.ok(SHAPE_MAP.has(guide.shapeId)); assert.ok(guidanceText(guide).includes(guide.name));
  assert.deepEqual(points, before, 'a hint never creates or moves the visitor’s actual stars');
});

test('two placed stars can become a real recognizable shape with at most two additions', () => {
  const guide = findGuidance([{ x: .6, y: -.42 }, { x: .95, y: -.6 }], SHAPES, bounds, () => .5);
  assert.ok(guide); assert.equal(guide.targets.length, 4);
  assert.equal(guide.actions.length, 2);
  const own = matchShapes(guide.targets, [SHAPE_MAP.get(guide.shapeId)])[0];
  assert.ok(own.similarity >= 99);
  assert.ok(guide.targets.every(p => p.x >= bounds.left && p.x <= bounds.right && p.y >= bounds.bottom && p.y <= bounds.top));
  for (const action of guide.actions.filter(a => a.type === 'add'))
    assert.ok(guide.targets.filter(p => p !== action.target).every(p => Math.hypot(p.x-action.target.x,p.y-action.target.y)>=.055));
});

test('one or two misplaced stars get a move suggestion rather than an automatic template replacement', () => {
  const shape = SHAPE_MAP.get('aries'), points = place(shape);
  points[2].x += .10;
  const guide = findGuidance(points, [shape], bounds, () => 0);
  assert.ok(guide); assert.ok(guide.actions.some(a => a.type === 'move'));
  assert.equal(guidanceComplete(points, guide), false);
  for (const action of guide.actions) if (action.type === 'move') points[action.index] = action.target;
  assert.equal(guidanceComplete(points, guide), true);
});

test('hint completion uses unique star assignments and rejects unrelated edits or offscreen targets', () => {
  const targets = [{ x: .6, y: -.4 }, { x: .9, y: -.6 }];
  assert.equal(guidanceComplete([targets[0], targets[0]], { targets }), false);
  assert.equal(findGuidance([], SHAPES, bounds), null);
  assert.equal(findGuidance([{ x: NaN, y: 0 }], SHAPES, bounds), null);
  assert.equal(findGuidance([{ x: 4, y: 4 }], SHAPES, bounds), null);
});
