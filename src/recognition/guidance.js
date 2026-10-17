import { transformPoint, matchShapes } from './matcher.js';

const d2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
// Unique assignments keep a suggested star from standing in for two real stars.
function assign(points, targets) {
  const pairs = points.flatMap((p, i) => targets.map((q, j) => ({ i, j, d: d2(p, q) }))).sort((a, b) => a.d - b.d);
  const used = new Set(), mapped = new Map();
  for (const pair of pairs) if (!mapped.has(pair.i) && !used.has(pair.j)) {
    mapped.set(pair.i, pair); used.add(pair.j);
  }
  return { mapped, used };
}
export function guidanceComplete(points, guide, tolerance = .028) {
  if (!guide || points.length !== guide.targets.length) return false;
  const { mapped } = assign(points, guide.targets);
  return mapped.size === points.length && [...mapped.values()].every(p => p.d <= tolerance ** 2);
}

// Bounded partial-template search, only inside the existing recognition worker.
// Every suggestion is a real catalogue shape achievable with one or two edits.
export function findGuidance(points, shapes, bounds, random = Math.random) {
  const n = points.length;
  if (!n || n > 48 || points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return null;
  const { left = .08, right = 1.7, bottom = -.86, top = -.15 } = bounds || {};
  const inside = p => p.x >= left && p.x <= right && p.y >= bottom && p.y <= top;
  const fixed = .023, maxMove = .22, candidates = [];
  let evaluations = 0;
  const inputPairs = points.flatMap((p, i) => points.slice(i + 1).map((q, k) => ({ a: i, b: i + 1 + k, d: d2(p, q) })))
    .filter(p => p.d > .0025).sort((a, b) => b.d - a.d).slice(0, 3);
  function consider(shape, transform) {
    if (++evaluations > 4096) return;
    const targets = shape.points.map(p => transformPoint(p, transform));
    if (!targets.every(inside)) return;
    const mayMove = 2 - (shape.points.length - n);
    if (points.filter(p => targets.every(q => d2(p, q) > fixed ** 2)).length > mayMove) return;
    const { mapped, used } = assign(points, targets);
    if (mapped.size !== n) return;
    const actions = [];
    let error = 0;
    for (const { i, j, d } of mapped.values()) {
      if (d > maxMove ** 2) return;
      error += d;
      if (d > fixed ** 2) actions.push({ type: 'move', index: i, target: targets[j] });
    }
    for (let j = 0; j < targets.length; j++) if (!used.has(j)) actions.push({ type: 'add', target: targets[j] });
    if (actions.length < 1 || actions.length > 2) return;
    candidates.push({ shapeId: shape.id, name: shape.name, targets, actions, score: actions.length * .025 + error });
  }
  for (const shape of shapes) {
    if (shape.points.length < Math.max(2, n) || shape.points.length > n + 2) continue;
    // With two or more stars prefer shapes the normal four-star recognizer can identify.
    if (n >= 2 && shape.points.length < 4) continue;
    if (n === 1) {
      for (const angle of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
        const origin = shape.points[0];
        consider(shape, { center: points[0], origin, scale: .13, angle, mirror: 1 });
      }
      continue;
    }
    let templatePairs = shape.points.flatMap((p, a) => shape.points.slice(a + 1).map((q, i) => ({ a, b: a + 1 + i, d: d2(p, q) })))
      .sort((a, b) => b.d - a.d);
    if (templatePairs.length > 28) templatePairs = [...templatePairs.slice(0, 16),
      ...Array.from({ length: 8 }, (_, i) => templatePairs[Math.floor(i * templatePairs.length / 8)])];
    for (const input of inputPairs) for (const { a, b } of templatePairs) {
      const p = shape.points[a], q = shape.points[b], length = Math.sqrt(d2(p, q));
      if (length < .1) continue;
      const scale = Math.sqrt(input.d) / length;
      if (scale < .05 || scale > .4) continue;
      for (const mirror of [1, -1]) for (const reverse of [false, true]) {
        const origin = reverse ? q : p, end = reverse ? p : q;
        const angle = Math.atan2(points[input.b].y - points[input.a].y, points[input.b].x - points[input.a].x)
          - Math.atan2(end.y - origin.y, (end.x - origin.x) * mirror);
        consider(shape, { center: points[input.a], origin, scale, angle, mirror });
      }
    }
  }
  candidates.sort((a, b) => a.score - b.score);
  // Pick among comparably useful alternatives once per idle edit, never every frame.
  const choices = candidates.filter((c, i, all) => c.score <= all[0].score + .008 &&
    all.findIndex(other => other.shapeId === c.shapeId) === i).slice(0, 8);
  if (!choices.length) return null;
  const start = Math.min(choices.length - 1, Math.floor(random() * choices.length));
  for (let offset = 0; offset < choices.length; offset++) {
    const { score, ...guide } = choices[(start + offset) % choices.length];
    const proposed = points.map(p => ({ ...p }));
    for (const action of guide.actions) {
      if (action.type === 'move') proposed[action.index] = action.target;
      else proposed.push(action.target);
    }
    const minGap = bounds?.minGap ?? .055;
    // A suggested creation must clear the existing fist-spawn exclusion radius.
    // Check the proposed drawing (including unmoved real points), not only the template.
    const additions = guide.actions.filter(a => a.type === 'add');
    const addStart = proposed.length - additions.length;
    if (additions.some((a, i) => proposed.some((p, j) => j !== addStart + i && d2(p, a.target) < minGap ** 2))) continue;
    const shape = shapes.find(s => s.id === guide.shapeId);
    if (matchShapes(proposed, [shape])[0]?.similarity >= 80) return guide;
  }
  return null;
}

export function guidanceText(guide) {
  const adds = guide.actions.filter(a => a.type === 'add').length, moves = guide.actions.length - adds;
  if (!moves) return `옅게 빛나는 ${adds === 1 ? '곳에 별 하나' : '두 곳에 별을 하나씩'} 더 두면 ‘${guide.name}’가 나타날 것 같아요!`;
  if (!adds) return `빛나는 ${moves === 1 ? '별을 옅은 자리로' : '별 두 개를 옅은 자리로 하나씩'} 옮기면 ‘${guide.name}’가 나타날 것 같아요!`;
  return `빛나는 별을 옮기고 옅은 자리에 별 하나를 더 두면 ‘${guide.name}’를 만들 수 있어요!`;
}
