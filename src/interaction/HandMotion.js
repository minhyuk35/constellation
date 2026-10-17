import { CONFIG } from '../config.js';

const alpha = (cutoff, dt) => 1 / (1 + 1 / (2 * Math.PI * cutoff * dt));

// One Euro filter, followed by a soft radial dead zone and a short render lerp.
// Algorithm: https://gery.casiez.net/publications/CHI2012-casiez.pdf (Appendix A).
// Each hand owns its state; mouse/touch coordinates never pass through here.
export class HandMotion {
  constructor(options = CONFIG.handMotion) {
    this.options = options;
    this.reset();
  }
  reset() {
    this.timestamp = null;
    this.speed = 0;
    this.duration = 0;
    this.target = null;
  }
  update(x, y, timestamp, width, height, receivedAt = timestamp) {
    if (![x, y, timestamp, width, height, receivedAt].every(Number.isFinite)) return;
    if (width <= 0 || height <= 0) return;
    if (this.timestamp !== null && timestamp <= this.timestamp) return;
    const point = { x: x * width, y: y * height };
    if (
      this.timestamp === null || timestamp - this.timestamp > CONFIG.handLostAfter ||
      width !== this.width || height !== this.height
    ) {
      this.width = width;
      this.height = height;
      this.filtered = { ...point };
      this.velocity = { x: 0, y: 0 };
      this.speed = 0;
      this.target = point;
      this.from = point;
      this.duration = 0;
      this.transitionAt = receivedAt;
      this.timestamp = timestamp;
      return;
    }
    // Use capture timestamps, not worker delivery times or render frame rate.
    const dt = (timestamp - this.timestamp) / 1000;
    this.timestamp = timestamp;
    const o = this.options;
    const derivativeAlpha = alpha(o.derivativeCutoff, dt);
    for (const axis of ['x', 'y']) {
      const derivative = (point[axis] - this.filtered[axis]) / dt;
      this.velocity[axis] += derivativeAlpha * (derivative - this.velocity[axis]);
    }
    this.speed = Math.hypot(this.velocity.x, this.velocity.y);
    const positionAlpha = alpha(o.minCutoff + o.beta * this.speed, dt);
    for (const axis of ['x', 'y'])
      this.filtered[axis] += positionAlpha * (point[axis] - this.filtered[axis]);

    const response = Math.min(1, this.speed / o.responsiveSpeed);
    const radius = o.deadZone + (o.movingDeadZone - o.deadZone) * response;
    const dx = this.filtered.x - this.target.x, dy = this.filtered.y - this.target.y;
    const distance = Math.hypot(dx, dy);
    if (distance <= radius) return;
    // Compare with the last accepted output, so sub-pixel intentional steps
    // accumulate. Subtract the radius to avoid a jump when leaving the zone.
    this.from = this.positionPixels(receivedAt);
    this.target = {
      x: this.target.x + dx * (1 - radius / distance),
      y: this.target.y + dy * (1 - radius / distance),
    };
    this.transitionAt = receivedAt;
    // The old 8–24 ms lerp finished well before the next 65–90 ms inference,
    // leaving the pointer motionless between samples. Bridge more of the actual
    // capture interval, capped at 55 ms and shortened for fast movements.
    const bridge = Math.min(o.maxInterpolationMs ?? 55, Math.max(o.interpolationMs, dt * 750));
    this.duration = bridge * (1 - response * 2 / 3);
  }
  positionPixels(now) {
    const t = this.duration ? Math.max(0, Math.min(1, (now - this.transitionAt) / this.duration)) : 1;
    return {
      x: this.from.x + (this.target.x - this.from.x) * t,
      y: this.from.y + (this.target.y - this.from.y) * t,
    };
  }
  position(now) {
    if (!this.target) return null;
    const p = this.positionPixels(now);
    return { x: p.x / this.width, y: p.y / this.height };
  }
}
