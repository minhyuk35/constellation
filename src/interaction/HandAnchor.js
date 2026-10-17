// Switch anatomical anchors without moving the cursor just because fingers fold.
// Preserve palm translation at the transition; keep the resulting offset until
// the next gesture rather than snapping or slowly pulling toward a new anchor.
export class HandAnchor {
  constructor() { this.reset(); }
  reset() { this.output = null; this.palm = null; this.mode = null; this.offset = { x: 0, y: 0 }; }
  update(midpoint, palm, usePalm, firstFist = false) {
    const mode = usePalm ? 'palm' : 'tips', anchor = usePalm ? palm : midpoint;
    if (!this.output) {
      this.output = { ...(firstFist ? palm : midpoint) };
      this.offset = { x: this.output.x - anchor.x, y: this.output.y - anchor.y };
    } else if (mode !== this.mode) {
      this.offset = {
        x: this.output.x + palm.x - this.palm.x - anchor.x,
        y: this.output.y + palm.y - this.palm.y - anchor.y,
      };
    }
    this.output = { x: anchor.x + this.offset.x, y: anchor.y + this.offset.y };
    this.palm = { ...palm }; this.mode = mode;
    return this.output;
  }
}
