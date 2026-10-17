import { CONFIG } from '../config.js';

// Use the website's existing worker and matching thresholds. Waiting for stillness
// and checking revisions keeps comparisons off the render thread and rejects stale results.
export class VRRecognition {
  constructor(model, busy = () => false, onResult = () => {}) {
    this.model = model; this.busy = busy; this.pending = null;
    this.worker = new Worker(new URL('../recognition/recognition.worker.js', import.meta.url), { type: 'module' });
    this.worker.onmessage = ({ data }) => {
      if (data.revision !== this.pending?.token) return;
      const { id, revision, original } = this.pending;
      this.pending = null;
      const entity = model.entities.find(e => e.id === id);
      if (!entity || entity !== original || entity.revision !== revision || entity.editing || this.busy()) return;
      if (data.error) { entity.recognizedRevision = revision; return; }
      model.identify(entity, data);
      onResult(entity);
    };
    this.worker.onerror = () => {
      this.worker.terminate(); this.worker = null; this.pending = null;
    };
  }
  update(now) {
    if (!this.worker || this.pending || this.busy()) return;
    const entity = this.model.entities.find(e => !e.editing && e.stars.length >= CONFIG.minStars &&
      e.recognizedRevision !== e.revision && now - e.lastEdit >= CONFIG.vrRecognizeDelay);
    if (!entity) return;
    const token = `${entity.id}:${entity.revision}`;
    this.pending = { id: entity.id, revision: entity.revision, token, original: entity };
    this.worker.postMessage({ points: entity.stars.map(s => ({ x: s.x, y: s.y })), revision: token });
  }
  dispose() { this.worker?.terminate(); }
}
