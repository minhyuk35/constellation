import { CONFIG } from '../config.js';

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0));
// Normalize distances by palm size and use hysteresis to avoid pinch flicker.
export function classifyHand(landmarks, previous = 'point') {
  if (!landmarks || landmarks.length < 21 || !landmarks.slice(0,21).every(p => p &&
    Number.isFinite(p.x) && Number.isFinite(p.y) && (p.z === undefined || Number.isFinite(p.z))))
    return { gesture: 'lost', pinchRatio: 1 };
  const palm = Math.max(
    distance(landmarks[0], landmarks[9]),
    distance(landmarks[5], landmarks[17]),
    0.025,
  );
  const pinchRatio = distance(landmarks[4], landmarks[8]) / palm;
  let extended = 0;
  for (const [tip, pip] of [
    [8, 6],
    [12, 10],
    [16, 14],
    [20, 18],
  ]) {
    if (distance(landmarks[tip], landmarks[0]) > distance(landmarks[pip], landmarks[0]) * 1.17)
      extended++;
  }
  // Radial fingertip extension alone misses an OK-style pinch: a bent index
  // can point back toward its knuckle. Require reach from that knuckle AND
  // either forward advance or extra separation from the folded middle finger.
  // Subtract the knuckle span so the normal spacing of a fist is not a pinch.
  const axis={x:landmarks[9].x-landmarks[0].x,y:landmarks[9].y-landmarks[0].y,
    z:(landmarks[9].z || 0)-(landmarks[0].z || 0)};
  const axisLength=Math.max(Math.hypot(axis.x,axis.y,axis.z),1e-6);
  const folded=[12,16,20].reduce((p,i)=>({x:p.x+landmarks[i].x/3,
    y:p.y+landmarks[i].y/3,z:p.z+(landmarks[i].z || 0)/3}),{x:0,y:0,z:0});
  const indexAdvance=((landmarks[8].x-folded.x)*axis.x+(landmarks[8].y-folded.y)*axis.y+
    ((landmarks[8].z || 0)-folded.z)*axis.z)/(axisLength*palm);
  const indexReach=distance(landmarks[8],landmarks[5])/palm,holding=previous === 'pinch';
  const g=CONFIG.handGestures;
  const indexSpread=(distance(landmarks[8],landmarks[12])-distance(landmarks[5],landmarks[9]))/palm;
  const opposition=indexReach > (holding?g.oppositionReachHold:g.oppositionReach) &&
    (indexAdvance > (holding?g.oppositionAdvanceHold:g.oppositionAdvance) ||
      indexSpread > (holding?g.oppositionSpreadHold:g.oppositionSpread));
  const canPinch=extended > 0 || opposition;
  const gesture =
    !canPinch
      ? 'fist'
      : pinchRatio < (previous === 'pinch' ? CONFIG.handGestures.pinchExit : CONFIG.handGestures.pinchEnter)
        ? 'pinch'
        : extended >= 4
          ? 'open'
          : 'point';
  return { gesture, pinchRatio, extended, opposition, indexReach, indexAdvance, indexSpread };
}

// Distance hysteresis alone cannot reject a one-frame fist/open misclassification.
// Require the new state on consecutive inference samples spanning confirmMs.
export class HandGestureState {
  constructor() {
    this.reset();
  }
  reset() {
    this.gesture = 'point';
    this.pending = null;
    this.pendingSince = 0;
  }
  update(landmarks, timestamp) {
    const { gesture } = classifyHand(landmarks, this.gesture);
    if (gesture === this.gesture) this.pending = null;
    else if (gesture !== this.pending) {
      this.pending = gesture;
      this.pendingSince = timestamp;
    } else if (timestamp - this.pendingSince >= CONFIG.handGestures.confirmMs) {
      this.gesture = gesture;
      this.pending = null;
    }
    return this.gesture;
  }
}
