import { SHAPES } from '../data/shapes.js';
import { artwork } from '../data/art.js';
import { matchShapes, transformPoint } from '../recognition/matcher.js';

const byName = new Map(SHAPES.map(shape => [shape.name, shape]));

// Existing published works already store the unique catalogue name. Resolve
// locally so old QR codes gain their illustrations without rewriting the DB.
export function skyIllustration(work) {
  const shape = byName.get(work.title);
  return shape ? { shape, art: artwork(shape) } : null;
}

export function skyArtLayout(work, illustration) {
  const match = matchShapes(work.drawing.stars, [illustration.shape])[0];
  if (!match) return null;
  const t = match.transform, center = transformPoint({ x: 0, y: 0 }, t);
  const { w, h } = illustration.art.rect;
  const size = t.scale * 2.5 * (illustration.shape.artScale ?? 1);
  const width = size * Math.min(1, w / h), height = size * Math.min(1, h / w);
  // Keep every corner inside the work's reserved circle, even after rotation
  // and reflection. Illustrations must not overlap neighboring sky cells.
  const fit = Math.min(1, 1 / (Math.hypot(center.x, center.y) + Math.hypot(width, height) / 2));
  return {
    x: center.x * fit, y: center.y * fit,
    width: width * fit, height: height * fit,
    angle: t.angle, mirror: t.mirror,
  };
}
