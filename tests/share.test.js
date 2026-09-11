import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeShare, decodeShare } from '../src/data/share.js';
import { CONFIG } from '../src/config.js';

function star(x, y) {
  return { id: crypto.randomUUID(), x, y };
}

test('a shared constellation round-trips through the URL-safe payload', () => {
  const stars = [star(0.1, 0.2), star(0.5, 0.5), star(0.9, 0.8)];
  const edges = [
    [stars[0].id, stars[1].id],
    [stars[1].id, stars[2].id],
  ];
  const payload = encodeShare({ stars, edges, shapeId: 'aries' });
  assert.ok(typeof payload === 'string' && payload.length > 0);
  assert.doesNotMatch(payload, /[+/=]/, 'payload must be URL-safe base64');
  const decoded = decodeShare(payload);
  assert.equal(decoded.shapeId, 'aries');
  assert.equal(decoded.stars.length, 3);
  assert.deepEqual(decoded.edges, [
    [0, 1],
    [1, 2],
  ]);
  decoded.stars.forEach((s, i) => {
    assert.ok(Math.abs(s.x - stars[i].x) < 0.01);
    assert.ok(Math.abs(s.y - stars[i].y) < 0.01);
  });
});

test('a free-form constellation with no matched shape omits the shape id', () => {
  const stars = [star(0.2, 0.2), star(0.4, 0.6), star(0.8, 0.3), star(0.6, 0.9)];
  const payload = encodeShare({ stars, edges: [], shapeId: null });
  const decoded = decodeShare(payload);
  assert.equal(decoded.shapeId, null);
  assert.equal(decoded.edges.length, 0);
  assert.equal(decoded.stars.length, 4);
});

test('edges pointing at an unknown or self star are dropped before encoding', () => {
  const stars = [star(0.1, 0.1), star(0.9, 0.9)];
  const payload = encodeShare({
    stars,
    edges: [
      [stars[0].id, stars[1].id],
      [stars[0].id, stars[0].id],
      [stars[0].id, 'ghost'],
    ],
    shapeId: null,
  });
  const decoded = decodeShare(payload);
  assert.deepEqual(decoded.edges, [[0, 1]]);
});

test('malformed, truncated, or hostile share text is rejected without throwing', () => {
  assert.equal(encodeShare({ stars: [] }), null);
  assert.equal(encodeShare({ stars: Array.from({ length: CONFIG.maxStars + 1 }, () => star(0, 0)) }), null);
  for (const bad of [null, undefined, '', 'not-base64!!!', 'AA', '%%%%', 'a'.repeat(500)])
    assert.equal(decodeShare(bad), null);
});

test('a full 48-star canvas still fits the compact byte encoding', () => {
  const stars = Array.from({ length: CONFIG.maxStars }, (_, i) => star(i / 48, (47 - i) / 48));
  const edges = stars.slice(1).map((s, i) => [stars[i].id, s.id]);
  const payload = encodeShare({ stars, edges, shapeId: 'ursa-major' });
  const decoded = decodeShare(payload);
  assert.equal(decoded.stars.length, CONFIG.maxStars);
  assert.equal(decoded.edges.length, CONFIG.maxStars - 1);
});
