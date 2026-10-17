import { HandGestureState, classifyHand } from '../interaction/gestures.js';
import { CONFIG } from '../config.js';

// Map native WebXR joints to the same 21 landmarks used by the webcam.
export const XR_LANDMARKS = [
  'wrist', 'thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip',
  ...['index', 'middle', 'ring', 'pinky'].flatMap(f =>
    ['proximal', 'intermediate', 'distal', 'tip'].map(p =>
      p === 'tip' ? `${f}-finger-tip` : `${f}-finger-phalanx-${p}`)),
];
export class VRGestures {
  constructor() { this.state = new HandGestureState(); this.reset(); }
  reset() {
    this.state.reset(); this.ready = false; this.fistAt = null; this.spawned = false;
  }
  update(points, now) {
    if (!points || points.length !== 21) {
      this.reset(); return { gesture: 'lost', release: true };
    }
    const before = this.state.gesture, gesture = this.state.update(points, now);
    const raw = classifyHand(points, before).gesture;
    if (raw === 'open' || raw === 'point') this.ready = true;
    let spawn = false;
    if (gesture === 'fist') {
      if (this.fistAt === null) this.fistAt = now;
      if (!this.spawned && now - this.fistAt >= CONFIG.fistHold) {
        this.spawned = spawn = true;
        this.ready = true;
      }
    } else { this.fistAt = null; this.spawned = false; }
    return { gesture, spawn, grab: gesture === 'pinch' && before !== 'pinch' && this.ready,
      release: gesture !== 'pinch' && before === 'pinch' };
  }
}

export class VRShake {
  constructor() { this.samples = []; }
  update(x, now) {
    this.samples.push({ x, t: now });
    while (this.samples.length && now - this.samples[0].t > 450) this.samples.shift();
    let anchor = this.samples[0].x, path = 0, reversals = 0, lastDir = 0;
    for (const sample of this.samples) {
      const dx = sample.x - anchor;
      if (Math.abs(dx) < .012) continue;
      const dir = Math.sign(dx);
      path += Math.abs(dx);
      if (lastDir && dir !== lastDir) reversals++;
      lastDir = dir; anchor = sample.x;
    }
    return reversals >= 3 && path > .18;
  }
}
