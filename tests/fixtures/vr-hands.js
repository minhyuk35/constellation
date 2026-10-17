// Meter-scale full hand poses, shared by unit tests and the native-joint browser harness.
export function handPoints(gesture, anchor = { x: 0, y: 1.4, z: -.55 }) {
  const points = Array.from({ length: 21 }, () => ({ x: 0, y: .06, z: 0 }));
  points[0] = { x: 0, y: 0, z: 0 };
  points[9] = { x: 0, y: .085, z: 0 };
  points[5] = { x: -.025, y: .075, z: 0 };
  points[17] = { x: .045, y: .065, z: 0 };
  for (const [i, tip] of [8, 12, 16, 20].entries()) {
    points[tip - 2] = { x: (i - 1) * .025, y: .115, z: 0 };
    points[tip] = { x: (i - 1) * .025, y: gesture === 'fist' ? .045 : .17, z: 0 };
  }
  points[4] = gesture === 'pinch' ? { ...points[8], x: points[8].x + .008 } : { x: -.075, y: .065, z: 0 };
  const origin = gesture === 'fist' ? points[9] : {
    x: (points[4].x + points[8].x) / 2, y: (points[4].y + points[8].y) / 2, z: 0,
  };
  return points.map(p => ({ x: p.x - origin.x + anchor.x, y: p.y - origin.y + anchor.y, z: p.z + anchor.z }));
}
