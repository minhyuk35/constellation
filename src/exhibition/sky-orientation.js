import { Euler, Quaternion, Vector3 } from 'three';

const rad = Math.PI / 180;
// Device axes -> rear-camera axes, including portrait/landscape screen rotation.
export function deviceQuaternion({ alpha, beta, gamma }, screenAngle = 0) {
  if (![alpha, beta, gamma, screenAngle].every(Number.isFinite)) return null;
  return new Quaternion()
    .setFromEuler(new Euler(beta * rad, alpha * rad, -gamma * rad, 'YXZ'))
    .multiply(new Quaternion(-Math.SQRT1_2, 0, 0, Math.SQRT1_2))
    .multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -screenAngle * rad));
}

// Use this gravity-referenced pose directly. Aligning pitch to a selected work
// would move the entire upper sky onto the floor when entering with a phone down.
