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
    return true;
  }
  endDrag(id) {
    this.draggers.delete(id);
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
