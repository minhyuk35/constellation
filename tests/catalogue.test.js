import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SHAPES, CONSTELLATIONS, ZODIAC_SHAPES } from '../src/data/shapes.js';
import { artwork } from '../src/data/art.js';
import { buildConnections, matchShapes } from '../src/recognition/matcher.js';
import { saveArchive, readArchive } from '../src/data/archive.js';
import { encodeShare, decodeShare } from '../src/data/share.js';

test('the catalogue contains all 88 unique IAU entries and the complete zodiac first', () => {
  assert.equal(CONSTELLATIONS.length, 88);
  assert.equal(new Set(CONSTELLATIONS.map((s) => s.abbr)).size, 88);
  assert.equal(new Set(SHAPES.map((s) => s.id)).size, 100);
  assert.equal(SHAPES.filter((s) => s.category === 'object').length, 12);
  assert.deepEqual(
    ZODIAC_SHAPES.map((s) => s.abbr),
    ['Ari', 'Tau', 'Gem', 'Cnc', 'Leo', 'Vir', 'Lib', 'Sco', 'Sgr', 'Cap', 'Aqr', 'Psc'],
  );
  assert.deepEqual(SHAPES.slice(0, 12), ZODIAC_SHAPES);
  assert.equal(CONSTELLATIONS.filter((s) => s.abbr === 'Ser').length, 1);
  assert.ok(ZODIAC_SHAPES.every((s) => s.zodiac.dates && s.description));
});

test('every constellation has valid unique edges, visible stars, and a real local illustration', () => {
  for (const shape of CONSTELLATIONS) {
    assert.ok(shape.points.length >= 2 && shape.points.length <= 48, shape.id);
    assert.equal(
      new Set(shape.edges.map((e) => [...e].sort((a, b) => a - b).join(':'))).size,
      shape.edges.length,
      shape.id,
    );
    assert.equal(new Set(shape.edges.flat()).size, shape.points.length, shape.id);
    assert.ok(
      shape.edges.every(
        ([a, b]) =>
          a !== b && a >= 0 && b >= 0 && a < shape.points.length && b < shape.points.length,
      ),
      shape.id,
    );
    for (let i = 0; i < shape.points.length; i++)
      for (let j = i + 1; j < shape.points.length; j++) {
        const a = shape.points[i],
          b = shape.points[j];
        // Four pre-existing, hand-aligned illustrations keep their original map.
        const min = ['aries', 'orion', 'cassiopeia', 'ursa-major'].includes(shape.id)
          ? 0.15
          : 0.1849;
        assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= min, `${shape.id}: ${i}/${j} overlap`);
      }
    const art = artwork(shape);
    const png = readFileSync(new URL('../public/' + art.src, import.meta.url));
    assert.equal(png.subarray(1, 4).toString(), 'PNG', shape.id);
    assert.ok(art.tile >= 0 && art.tile < art.grid ** 2, shape.id);
    assert.ok(shape.description.length > 25, shape.id);
  }
});

test('Serpens retains separate head and tail without an invented bridging star line', () => {
  const shape = CONSTELLATIONS.find((s) => s.abbr === 'Ser');
  const match = matchShapes(shape.points, [shape])[0];
  const edges = buildConnections(shape.points, match);
  assert.equal(edges.length, shape.edges.length);
  const withExtra = [...shape.points, { x: 0, y: 0 }];
  const extraEdges = buildConnections(withExtra, match);
  assert.equal(
    extraEdges.length,
    shape.edges.length + 1,
    'an extra star attaches to just one side',
  );
  assert.equal(new Set(extraEdges.flat()).size, withExtra.length);
});

test('small constellation presets survive archive and QR round trips', () => {
  const data = new Map();
  globalThis.localStorage = {
    getItem: (key) => data.get(key) || null,
    setItem: (key, value) => data.set(key, value),
  };
  for (const shape of CONSTELLATIONS.filter((s) => s.points.length < 4)) {
    const stars = shape.points.map((p, i) => ({
      id: String(i),
      x: 0.5 + p.x * 0.2,
      y: 0.5 - p.y * 0.2,
    }));
    const edges = shape.edges.map(([a, b]) => [String(a), String(b)]);
    assert.equal(saveArchive(shape, { stars, edges, manualEdges: [] }, 1), true);
    assert.equal(readArchive()[0].shapeId, shape.id);
    const restored = decodeShare(encodeShare({ stars, edges, shapeId: shape.id }));
    assert.equal(restored.shapeId, shape.id);
    assert.equal(restored.stars.length, stars.length);
    assert.deepEqual(restored.edges, shape.edges);
  }
  delete globalThis.localStorage;
});
