const distance2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
const normalizedTemplates = new WeakMap();
export function normalize(points) {
  if (!points.length) return null;
  const center = points.reduce(
    (s, p) => ({ x: s.x + p.x / points.length, y: s.y + p.y / points.length }),
    { x: 0, y: 0 },
  );
  const scale = Math.sqrt(points.reduce((s, p) => s + distance2(p, center), 0) / points.length);
  if (!Number.isFinite(scale) || scale < 1e-6) return null;
  return {
    center,
    scale,
    points: points.map((p) => ({ x: (p.x - center.x) / scale, y: (p.y - center.y) / scale })),
  };
}
function rotate(points, angle, mirror) {
  const c = Math.cos(angle),
    s = Math.sin(angle);
  return points.map((p) => ({ x: p.x * mirror * c - p.y * s, y: p.x * mirror * s + p.y * c }));
}
function chamfer(a, b) {
  let total = 0;
  for (const p of a) {
    let best = Infinity;
    for (const q of b) best = Math.min(best, distance2(p, q));
    total += best;
  }
  return total / a.length;
}
// Symmetric point-cloud distance + star-count penalty, searched over rotation
// and reflection, then refined. Independent of insertion order, unlike a
// polygon-area heuristic. Scores express template distance, not AI probability.
export function matchShapes(points, shapes) {
  if (
    points.length < (shapes.length === 1 ? 2 : 4) ||
    points.length > 48 ||
    points.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))
  )
    return [];
  const input = normalize(points);
  if (!input) return [];
  return shapes
    .filter((shape) => shapes.length === 1 || shape.points.length >= 4)
    .map((shape) => {
      let target = normalizedTemplates.get(shape);
      if (!target) {
        target = normalize(shape.points);
        normalizedTemplates.set(shape, target);
      }
      const seeds = [];
      const cost = (angle, mirror) => {
        const transformed = rotate(target.points, angle, mirror);
        return (chamfer(input.points, transformed) + chamfer(transformed, input.points)) / 2;
      };
      for (const mirror of [1, -1]) {
        for (let i = 0; i < 32; i++) {
          const angle = (i * Math.PI) / 16;
          const value = cost(angle, mirror);
          seeds.push({ cost: value, angle, mirror });
        }
      }
      // Near-symmetric quadrilaterals can favor the wrong reflection at coarse
      // resolution. Refine several candidates before committing to one.
      const refined = seeds
        .sort((a, b) => a.cost - b.cost)
        .slice(0, 4)
        .map((seed) => {
          let candidate = seed;
          for (let step = Math.PI / 32; step > 0.0005; step /= 2) {
            for (const angle of [candidate.angle - step, candidate.angle + step]) {
              const value = cost(angle, candidate.mirror);
              if (value < candidate.cost) candidate = { ...candidate, cost: value, angle };
            }
          }
          return candidate;
        });
      const best = refined.sort((a, b) => a.cost - b.cost)[0];
      const countCost = Math.abs(Math.log(points.length / shape.points.length)) * 0.085;
      const error = Math.sqrt(best.cost) + countCost;
      const similarity = Math.max(0, Math.round(100 * Math.exp(-error * 2.7)));
      return {
        shape,
        ...best,
        error,
        similarity,
        transform: {
          center: input.center,
          scale: input.scale / target.scale,
          angle: best.angle,
          mirror: best.mirror,
          origin: target.center,
        },
      };
    })
    .sort((a, b) => a.error - b.error);
}

export function transformPoint(point, transform) {
  const { center, scale, angle, mirror, origin } = transform;
  const x = (point.x - origin.x) * mirror,
    y = point.y - origin.y;
  return {
    x: center.x + scale * (x * Math.cos(angle) - y * Math.sin(angle)),
    y: center.y + scale * (x * Math.sin(angle) + y * Math.cos(angle)),
  };
}

// Connect the user's actual points. Never snap/move them to a template.
// Map template edges onto stars using a unique nearest assignment; include any
// extra stars through the shortest bridging edges, so none are discarded.
export function buildConnections(points, match) {
  if (!points.length) return [];
  const target = match.shape.points.map((p) => transformPoint(p, match.transform));
  const pairs = target
    .flatMap((p, t) => points.map((q, i) => ({ t, i, d: distance2(p, q) })))
    .sort((a, b) => a.d - b.d);
  const assignment = new Map(),
    used = new Set(),
    edges = [],
    keys = new Set();
  for (const { t, i } of pairs)
    if (!assignment.has(t) && !used.has(i)) {
      assignment.set(t, i);
      used.add(i);
    }
  for (let t = 0; t < target.length; t++) {
    if (!assignment.has(t))
      assignment.set(
        t,
        points.reduce(
          (best, p, i) => (distance2(p, target[t]) < distance2(points[best], target[t]) ? i : best),
          0,
        ),
      );
  }
  const parent = points.map((_, i) => i);
  const anchored = points.map((_, i) => used.has(i));
  const root = (i) => (parent[i] === i ? i : (parent[i] = root(parent[i])));
  const add = (a, b) => {
    const key = [a, b].sort((x, y) => x - y).join('-');
    if (a === b || keys.has(key)) return;
    keys.add(key);
    edges.push([a, b]);
    const ra = root(a),
      rb = root(b);
    anchored[rb] = anchored[ra] || anchored[rb];
    parent[ra] = rb;
  };
  for (const [a, b] of match.shape.edges) add(assignment.get(a), assignment.get(b));
  const bridges = points
    .flatMap((a, i) =>
      points.slice(i + 1).map((b, j) => ({ a: i, b: i + j + 1, d: distance2(a, b) })),
    )
    .sort((a, b) => a.d - b.d);
  for (const { a, b } of bridges)
    if (
      root(a) !== root(b) &&
      (!match.shape.disconnected || !anchored[root(a)] || !anchored[root(b)])
    )
      add(a, b);
  return edges;
}
