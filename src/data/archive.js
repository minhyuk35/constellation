import { CONFIG } from '../config.js';
import { SHAPE_MAP } from './shapes.js';
const KEY = 'constellation.archive.v2';
export function readArchive() {
  try {
    const entries = JSON.parse(localStorage.getItem(KEY) || '[]');
    if (!Array.isArray(entries)) return [];
    return entries
      .filter((e) => {
        if (
          !e ||
          !SHAPE_MAP.has(e.shapeId) ||
          !Number.isFinite(e.createdAt) ||
          !Array.isArray(e.stars) ||
          !Array.isArray(e.edges)
        )
          return false;
        if (
          e.stars.length < 4 ||
          e.stars.length > CONFIG.maxStars ||
          e.edges.length > CONFIG.maxStars * CONFIG.maxStars
        )
          return false;
        const ids = new Set(e.stars.map((s) => s?.id));
        return (
          ids.size === e.stars.length &&
          e.stars.every(
            (s) =>
              typeof s?.id === 'string' &&
              Number.isFinite(s.x) &&
              Number.isFinite(s.y) &&
              s.x >= 0 &&
              s.x <= 1 &&
              s.y >= 0 &&
              s.y <= 1,
          ) &&
          [e.edges, e.manualEdges || []].every(
            (edges) =>
              Array.isArray(edges) &&
              edges.length <= CONFIG.maxStars * CONFIG.maxStars &&
              edges.every(
                (edge) =>
                  Array.isArray(edge) && edge.length === 2 && ids.has(edge[0]) && ids.has(edge[1]),
              ),
          )
        );
      })
      .slice(0, CONFIG.maxArchive);
  } catch {
    return [];
  }
}
export function saveArchive(shape, snapshot, aspect) {
  const entries = readArchive();
  const signature = JSON.stringify(
    snapshot.stars.map((s) => [Math.round(s.x * 500), Math.round(s.y * 500)]),
  );
  if (entries[0]?.signature === signature && entries[0]?.shapeId === shape.id) return true;
  const entry = {
    id: crypto.randomUUID(),
    shapeId: shape.id,
    createdAt: Date.now(),
    aspect,
    signature,
    ...snapshot,
  };
  try {
    localStorage.setItem(KEY, JSON.stringify([entry, ...entries].slice(0, CONFIG.maxArchive)));
    return true;
  } catch {
    return false;
  }
}
