import { SHAPES } from '../data/shapes.js';
import { matchShapes, buildConnections } from './matcher.js';
import { findGuidance, guidanceComplete } from './guidance.js';
self.onmessage = ({ data }) => {
  try {
    const preferred = data.guide && guidanceComplete(data.points, data.guide) && SHAPES.find(s => s.id === data.guide.shapeId);
    let candidates = preferred ? matchShapes(data.points, [preferred]) : matchShapes(data.points, SHAPES);
    if (preferred && candidates[0]?.similarity < 75) candidates = matchShapes(data.points, SHAPES);
    const best = candidates[0];
    self.postMessage({
      revision: data.revision,
      candidates: candidates.slice(0, 3),
      edges: best ? buildConnections(data.points, best) : [],
      guidance: data.guidance && (!best || best.similarity < 48)
        ? findGuidance(data.points, SHAPES, data.bounds) : null,
    });
  } catch (error) {
    self.postMessage({ revision: data.revision, error: error.message });
  }
};
