import { SHAPES } from '../data/shapes.js';
import { matchShapes, buildConnections } from './matcher.js';
self.onmessage = ({ data }) => {
  try {
    const candidates = matchShapes(data.points, SHAPES);
    const best = candidates[0];
    self.postMessage({
      revision: data.revision,
      candidates: candidates.slice(0, 3),
      edges: best ? buildConnections(data.points, best) : [],
    });
  } catch (error) {
    self.postMessage({ revision: data.revision, error: error.message });
  }
};
