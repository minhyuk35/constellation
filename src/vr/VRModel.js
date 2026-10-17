import { Vector3, Quaternion, Matrix4 } from 'three';
import { SHAPES } from '../data/shapes.js';
import { matchShapes, buildConnections } from '../recognition/matcher.js';

export const VR_MAX_STARS = 48,
  VR_MAX_WORKS = 24;
const vec = (p) => new Vector3(p.x, p.y, p.z);
const point = (v) => ({ x: v.x, y: v.y, z: v.z });
const quat = (q) => new Quaternion(q.x, q.y, q.z, q.w);
const finite = (p) => p && [p.x, p.y, p.z].every(Number.isFinite);
const draft = () => ({
  id: crypto.randomUUID(),
  title: '만들고 있는 별자리',
  stars: [],
  edges: [],
  position: { x: 0, y: 0, z: 0 },
  quaternion: { x: 0, y: 0, z: 0, w: 1 },
  scale: 1,
  revision: 0,
  recognizedRevision: -1,
  lastEdit: 0,
});
// A separate, meter-based VR model. The exhibition's 2D model, QR and DB are
// deliberately not dependencies of this sandbox.
export class VRModel extends EventTarget {
  constructor() {
    super();
    this.draft = draft();
    this.works = [];
    this.history = [];
    this.anchor = null;
  }
  get entities() {
    return [this.draft, ...this.works];
  }
  changed(entity = null) {
    this.dispatchEvent(new CustomEvent('change', { detail: { entity } }));
  }
  remember() {
    this.history.push(
      structuredClone({ draft: this.draft, works: this.works, anchor: this.anchor }),
    );
    if (this.history.length > 24) this.history.shift();
  }
  undo() {
    const state = this.history.pop();
    if (!state) return false;
    Object.assign(this, state);
    for (const entity of this.entities) {
      delete entity.editing;
      entity.lastEdit = performance.now();
    }
    this.changed();
    return true;
  }
  world(entity, star) {
    return vec(star)
      .multiplyScalar(entity.scale)
      .applyQuaternion(quat(entity.quaternion))
      .add(vec(entity.position));
  }
  local(entity, p) {
    return vec(p)
      .sub(vec(entity.position))
      .applyQuaternion(quat(entity.quaternion).invert())
      .divideScalar(entity.scale);
  }
  prepareDraft(headPosition, headQuaternion) {
    if (this.draft.stars.length || this.draft.framed) return;
    this.draft.position = point(headPosition);
    this.draft.quaternion = { x: headQuaternion.x, y: headQuaternion.y, z: headQuaternion.z, w: headQuaternion.w };
    this.draft.framed = true;
  }
  invalidate(entity) {
    entity.revision++;
    entity.lastEdit = performance.now();
    entity.shapeId = null;
    entity.title = '나의 별자리';
    entity.edges = [];
  }
  loadPreset(shape, headPosition = new Vector3(0, 1.6, 0), headQuaternion = new Quaternion()) {
    this.remember();
    this.draft = draft();
    this.draft.position = point(headPosition.clone().add(new Vector3(0, 0, -.7).applyQuaternion(headQuaternion)));
    this.draft.quaternion = { x: headQuaternion.x, y: headQuaternion.y, z: headQuaternion.z, w: headQuaternion.w };
    this.draft.scale = .32;
    this.draft.framed = true;
    this.draft.stars = shape.points.map(p => ({ id: crypto.randomUUID(), x: p.x, y: p.y, z: 0 }));
    this.draft.edges = structuredClone(shape.edges);
    this.draft.shapeId = shape.id;
    this.draft.title = shape.name;
    this.draft.recognizedRevision = this.draft.revision;
    this.changed();
  }
  add(p) {
    if (!finite(p) || this.draft.stars.length >= VR_MAX_STARS) return null;
    this.remember();
    const star = { id: crypto.randomUUID(), ...point(this.local(this.draft, p)) };
    this.draft.stars.push(star);
    this.invalidate(this.draft);
    this.changed(this.draft.id);
    this.dispatchEvent(new CustomEvent('star-effect', { detail: { kind: 'create', point: point(p) } }));
    return { entity: this.draft, star };
  }
  nearest(p, radius = 0.14) {
    let nearest = null,
      best = radius;
    for (const entity of this.entities)
      for (const star of entity.stars) {
        const d = this.world(entity, star).distanceTo(p);
        if (d < best) {
          best = d;
          nearest = { entity, star, distance: d };
        }
      }
    return nearest;
  }
  pickRay(origin, direction) {
    let nearest = null,
      best = Infinity;
    for (const entity of this.entities)
      for (const star of entity.stars) {
        const delta = this.world(entity, star).sub(origin),
          distance = delta.dot(direction);
        if (distance < 0.05 || distance > 14 || distance >= best) continue;
        const off = delta.addScaledVector(direction, -distance).length();
        if (off < 0.07 + distance * 0.018) {
          best = distance;
          nearest = { entity, star, distance };
        }
      }
    return nearest;
  }
  move(target, p) {
    if (!target || !finite(p) || Math.hypot(p.x, p.y, p.z) > 30) return;
    Object.assign(target.star, point(this.local(target.entity, p)));
    target.entity.editing = true;
    this.invalidate(target.entity);
    this.changed(target.entity.id);
  }
  remove(target, { remember = true } = {}) {
    if (!target) return;
    if (remember) this.remember();
    const at = this.world(target.entity, target.star);
    this.dispatchEvent(new CustomEvent('star-effect', { detail: { kind: 'delete', point: point(at) } }));
    target.entity.stars = target.entity.stars.filter((s) => s.id !== target.star.id);
    if (target.entity !== this.draft && !target.entity.stars.length) {
      this.works = this.works.filter((work) => work.id !== target.entity.id);
      this.changed();
      return;
    }
    this.invalidate(target.entity);
    delete target.entity.editing;
    this.changed(target.entity.id);
  }
  identify(entity, result = null) {
    const points = entity.stars.map((s) => ({ x: s.x, y: s.y })),
      best = result ? result.candidates[0] : matchShapes(points, SHAPES)[0];
    entity.shapeId = best?.similarity >= 48 ? best.shape.id : null;
    entity.title = entity.shapeId ? best.shape.name : '나의 별자리';
    entity.edges = entity.shapeId ? (result ? result.edges : buildConnections(points, best)) : [];
    entity.recognizedRevision = entity.revision;
    this.changed(entity.id);
  }
  endMove(target) {
    if (!target?.entity.editing) return;
    delete target.entity.editing;
    target.entity.lastEdit = performance.now();
    this.changed(target.entity.id);
  }
  finish(headPosition = new Vector3(0, 1.6, 0), headQuaternion = new Quaternion()) {
    if (this.draft.stars.length < 2 || this.works.length >= VR_MAX_WORKS) return null;
    const center = this.draft.stars
      .reduce((sum, s) => sum.add(vec(s)), new Vector3())
      .divideScalar(this.draft.stars.length);
    const radius = Math.max(...this.draft.stars.map((s) => vec(s).distanceTo(center)));
    if (radius < 0.025) return null;
    this.remember();
    const entity = this.draft;
    entity.stars = entity.stars.map((s) => ({
      id: s.id,
      ...point(vec(s).sub(center).divideScalar(radius)),
    }));
    const forward = new Vector3(0, 0, -1).applyQuaternion(headQuaternion);
    this.anchor ||= { position: point(headPosition), yaw: Math.atan2(forward.x, -forward.z) };
    const occupied = new Set(this.works.map((work) => work.cell));
    let i = 0;
    while (occupied.has(i)) i++;
    entity.cell = i;
    const ring = Math.floor(i / 8),
      origin = this.anchor.position;
    const yaw = this.anchor.yaw + ((i % 8) * Math.PI) / 4 + ((ring % 2) * Math.PI) / 8;
    entity.position = {
      x: origin.x + Math.sin(yaw) * (3.6 + ring * 2.4),
      y: Math.max(1, origin.y + (i % 2 ? 0.65 : -0.1) + ring * 0.25),
      z: origin.z - Math.cos(yaw) * (3.6 + ring * 2.4),
    };
    entity.quaternion = new Quaternion().setFromRotationMatrix(
      new Matrix4().lookAt(vec(origin), vec(entity.position), new Vector3(0, 1, 0)),
    );
    entity.quaternion = {
      x: entity.quaternion.x,
      y: entity.quaternion.y,
      z: entity.quaternion.z,
      w: entity.quaternion.w,
    };
    entity.scale = 0.55 + ring * 0.12;
    this.works.push(entity);
    this.draft = draft();
    this.changed();
    return entity;
  }
}
