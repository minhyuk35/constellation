import { CONFIG } from '../config.js';

export class CanvasModel extends EventTarget {
  constructor() {
    super();
    this.stars = [];
    this.edges = [];
    this.history = [];
    this.selected = null;
    this.revision = 0;
    this.draggers = new Set();
    this.lastEdit = 0;
  }
  get dragging() {
    return this.draggers.size > 0;
  }
  snapshot() {
    return structuredClone({ stars: this.stars, edges: this.edges });
  }
  remember() {
    this.history.push(this.snapshot());
    if (this.history.length > CONFIG.maxHistory) this.history.shift();
  }
  changed(edited = true) {
    if (edited) {
      this.revision++;
      this.lastEdit = performance.now();
    }
    this.dispatchEvent(new CustomEvent('change', { detail: { edited } }));
  }
  add(x, y) {
    if (this.stars.length >= CONFIG.maxStars) return null;
    this.remember();
    const star = {
      id: crypto.randomUUID(),
      x: Math.max(0.025, Math.min(0.975, x)),
      y: Math.max(0.025, Math.min(0.975, y)),
    };
    this.stars.push(star);
    this.selected = star.id;
    this.changed();
    return star;
  }
  select(id) {
    this.selected = id;
    this.changed(false);
  }
  beginDrag(id) {
    if (this.draggers.has(id)) return false;
    this.remember();
    this.draggers.add(id);
    this.select(id);
    if (!this.shakeTracking) this.shakeTracking = new Map();
    this.shakeTracking.set(id, []);
    return true;
  }
  endDrag(id) {
    this.draggers.delete(id);
    this.shakeTracking?.delete(id);
    this.lastEdit = performance.now();
    this.changed(false);
  }
  move(id, x, y) {
    const star = this.stars.find((s) => s.id === id);
    if (!star) return;
    const nx = Math.max(0.02, Math.min(0.98, x)),
      ny = Math.max(0.025, Math.min(0.975, y));
    if (Math.hypot(star.x - nx, star.y - ny) < 0.0003) return;
    star.x = nx;
    star.y = ny;
    this.changed();
    this.trackShake(id, nx);
  }
  // Two hands can each hold their own star and shake it independently, so
  // tracking is per-star rather than a single shared buffer. A shake is
  // several quick left-right reversals covering real horizontal distance in
  // well under half a second — deliberately more than ordinary hand jitter
  // while moving a star, so it doesn't trigger by accident.
  trackShake(id, x) {
    const samples = this.shakeTracking?.get(id);
    if (!samples) return;
    const now = performance.now();
    samples.push({ x, t: now });
    while (samples.length && now - samples[0].t > 380) samples.shift();
    if (samples.length < 5) return;
    let reversals = 0,
      path = 0,
      lastDir = 0;
    for (let i = 1; i < samples.length; i++) {
      const dx = samples[i].x - samples[i - 1].x;
      path += Math.abs(dx);
      if (Math.abs(dx) < 0.006) continue;
      const dir = Math.sign(dx);
      if (lastDir && dir !== lastDir) reversals++;
      lastDir = dir;
    }
    if (reversals >= 3 && path > 0.11) {
      this.shakeTracking.delete(id);
      this.deleteShaken(id);
    }
  }
  // Shaking a held star out is the only way to delete one while hand-tracking
  // (there is no Delete key mid-gesture). Relies on beginDrag()'s remember()
  // for undo, so "grab, shake, gone" is one undoable step, same as a drag.
  deleteShaken(id) {
    const star = this.stars.find((s) => s.id === id);
    if (!star) return;
    this.draggers.delete(id);
    this.stars = this.stars.filter((s) => s.id !== id);
    this.edges = this.edges.filter((e) => !e.includes(id));
    if (this.selected === id) this.selected = null;
    this.changed();
    this.dispatchEvent(new CustomEvent('shake-delete', { detail: { star } }));
  }
  removeSelected() {
    if (!this.selected || this.dragging) return;
    this.remember();
    this.stars = this.stars.filter((s) => s.id !== this.selected);
    this.edges = this.edges.filter((e) => !e.includes(this.selected));
    this.selected = null;
    this.changed();
  }
  connect(a, b) {
    if (a === b || !this.stars.some((s) => s.id === a) || !this.stars.some((s) => s.id === b))
      return;
    this.remember();
    const index = this.edges.findIndex((e) => e.includes(a) && e.includes(b));
    if (index < 0) this.edges.push([a, b]);
    else this.edges.splice(index, 1);
    this.changed();
  }
  nearest(x, y, width, height, radius = 28) {
    let found = null,
      best = radius;
    for (const star of this.stars) {
      const d = Math.hypot((star.x - x) * width, (star.y - y) * height);
      if (d < best) {
        best = d;
        found = star;
      }
    }
    return found;
  }
  replace(stars, edges = [], remember = true) {
    if (remember) this.remember();
    this.stars = structuredClone(stars);
    this.edges = structuredClone(edges);
    this.selected = null;
    this.draggers.clear();
    this.changed();
  }
  clear() {
    this.replace([]);
  }
  undo() {
    if (!this.history.length || this.dragging) return false;
    const old = this.history.pop();
    this.stars = old.stars;
    this.edges = old.edges;
    this.selected = null;
    this.changed();
    return true;
  }
}
