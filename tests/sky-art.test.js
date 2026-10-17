import test from 'node:test';
import assert from 'node:assert/strict';
import { SHAPES } from '../src/data/shapes.js';
import { skyIllustration, skyArtLayout } from '../src/exhibition/sky-art.js';
import { artwork } from '../src/data/art.js';

test('opaque zodiac and Stellarium mattes are keyed without changing transparent generated art', () => {
  for (const shape of SHAPES) {
    const art = artwork(shape);
    assert.equal(art.blackMatte,art.src==='art/zodiac-atlas.png'||art.credit==='meuris',shape.id);
  }
});

test('all existing catalogue titles resolve artwork, including rotated/reflected drawings', () => {
  for (const shape of SHAPES) {
    const radius = Math.max(...shape.points.map(p => Math.hypot(p.x, p.y)));
    const work = { title: shape.name, drawing: {
      stars: shape.points.map(p => ({ x: -p.y / radius, y: -p.x / radius })), edges: shape.edges,
    } };
    const illustration = skyIllustration(work);
    assert.equal(illustration.shape.id, shape.id);
    const layout = skyArtLayout(work, illustration);
    assert.ok(layout && layout.width > 0 && layout.height > 0, shape.id);
    assert.ok(Number.isFinite(layout.angle), shape.id);
    assert.ok(Math.hypot(layout.x, layout.y) + Math.hypot(layout.width, layout.height) / 2 <= 1.000001,
      `${shape.id}: rotated artwork stays inside the reserved sky circle`);
  }
});

test('freeform and degenerate drawings keep their stars without fabricated artwork', () => {
  assert.equal(skyIllustration({ title: '이름 없는 별자리' }), null);
  const illustration = skyIllustration({ title: SHAPES[0].name });
  assert.equal(skyArtLayout({ drawing: { stars: [{ x: 0, y: 0 }, { x: 0, y: 0 }] } }, illustration), null);
});
