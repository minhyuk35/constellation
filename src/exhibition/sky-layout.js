// Fixed cells retain their directions when another visitor publishes a work.
// Every drawing fits inside a 5.5 degree circle; cell centers are >= 14 degrees apart.
export const SKY_RADIUS_DEG = 5.5;
export const SKY_SLOTS = [8, 22, 36, 50, 64, 78].flatMap((elevation, row) => {
  const count = Math.floor((360 * Math.cos((elevation * Math.PI) / 180)) / 14.5);
  return Array.from({ length: count }, (_, i) => ({
    yaw: ((i + (row % 2) / 2) * 360) / count,
    pitch: elevation,
  }));
});

export function drawingPayload(stars, edges, aspect = 1) {
  const xs = stars.map((p) => p.x * aspect),
    ys = stars.map((p) => p.y);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const radius = Math.max(0.001, ...stars.map((_, i) => Math.hypot(xs[i] - cx, ys[i] - cy)));
  const ids = new Map(stars.map((p, i) => [p.id, i]));
  return {
    stars: stars.map((_, i) => ({ x: (xs[i] - cx) / radius, y: (cy - ys[i]) / radius })),
    edges: edges
      .filter(([a, b]) => ids.has(a) && ids.has(b) && a !== b)
      .slice(0, 128)
      .map(([a, b]) => [ids.get(a), ids.get(b)]),
  };
}
