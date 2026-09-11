const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0));
// Normalize distances by palm size and use hysteresis to avoid pinch flicker.
export function classifyHand(landmarks, previous = 'point') {
  if (!landmarks || landmarks.length < 21) return { gesture: 'lost', pinchRatio: 1 };
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
  // Folded fingertips remain a fist even when thumb and index happen to touch.
  const gesture =
    extended === 0
      ? 'fist'
      : pinchRatio < (previous === 'pinch' ? 0.48 : 0.32)
        ? 'pinch'
        : extended >= 4
          ? 'open'
          : 'point';
  return { gesture, pinchRatio, extended };
}
