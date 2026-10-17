import { CONFIG } from '../config.js';
import { classifyHand } from './gestures.js';

// A continuity lock, not person identification. Ambiguous or interrupted
// tracking requires another deliberate open-palm hold before edits resume.
export class HandControlGate {
  constructor(options = CONFIG.handControl) {
    this.options = options;
    this.reset();
  }
  reset() {
    this.owner = null;
    this.candidate = null;
    this.needsRearm = false;
    this.state = { phase: 'waiting', progress: 0 };
  }
  describe(d) {
    const palm = [0, 5, 9, 13, 17].map((i) => d.lm[i]);
    return {
      detection: d,
      x: 1 - palm.reduce((sum, p) => sum + p.x, 0) / palm.length,
      y: palm.reduce((sum, p) => sum + p.y, 0) / palm.length,
      size: Math.hypot(d.lm[0].x - d.lm[9].x, d.lm[0].y - d.lm[9].y),
      side: d.side || '',
      open: classifyHand(d.lm).gesture === 'open',
    };
  }
  compatible(a, b) {
    return (
      (!a.side || !b.side || a.side === b.side) &&
      b.size / Math.max(a.size, 0.01) > 0.55 &&
      b.size / Math.max(a.size, 0.01) < 1.8
    );
  }
  update(detections, now) {
    const o = this.options;
    const hands = detections.map((d) => this.describe(d));
    if (this.owner && now - this.owner.seen > o.releaseMs) this.reset();
    let chosen;
    if (this.owner) {
      if (now - this.owner.seen > o.sampleGapMs) this.needsRearm = true;
      const matches = hands
        .filter((h) => this.compatible(this.owner, h))
        .map((h) => ({ h, distance: Math.hypot(h.x - this.owner.x, h.y - this.owner.y) }))
        .filter((p) => p.distance < o.matchRadius)
        .sort((a, b) => a.distance - b.distance);
      chosen = matches[0]?.h;
      // Even an opposite-handed hand crossing the owner makes the frame unsafe.
      if (
        chosen &&
        hands.some(
          (h) => h !== chosen && Math.hypot(h.x - chosen.x, h.y - chosen.y) < o.ambiguityRadius,
        )
      )
        chosen = null;
      if (!chosen) {
        this.needsRearm = true;
        this.candidate = null;
        this.state = { phase: 'lost', progress: 0 };
        return [];
      }
      if (!this.needsRearm) {
        this.owner = { ...chosen, seen: now };
        this.state = { phase: 'active', progress: 1 };
        return [chosen.detection];
      }
    } else {
      const eligible = hands.filter(
        (h) =>
          h.open && h.x > o.centerMargin && h.x < 1 - o.centerMargin && h.y > 0.15 && h.y < 0.85,
      );
      // Two people requesting simultaneously must separate before either wins.
      if (eligible.length === 1) chosen = eligible[0];
    }
    if (!chosen?.open) {
      this.candidate = null;
      this.state = { phase: this.owner ? 'lost' : 'waiting', progress: 0 };
      return [];
    }
    const c = this.candidate;
    if (
      !c ||
      now - c.seen > o.sampleGapMs ||
      !this.compatible(c, chosen) ||
      Math.hypot(chosen.x - c.x, chosen.y - c.y) > 0.09
    ) {
      this.candidate = { ...chosen, since: now, seen: now };
    } else this.candidate.seen = now;
    const progress = Math.min(1, (now - this.candidate.since) / o.armMs);
    this.state = { phase: 'arming', progress };
    if (progress < 1) return [];
    if (!this.owner) this.session = (this.session || 0) + 1;
    this.owner = { ...chosen, seen: now };
    this.needsRearm = false;
    this.candidate = null;
    this.state = { phase: 'active', progress: 1 };
    return [chosen.detection];
  }
}
