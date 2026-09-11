// @tensorflow-models/pose-detection statically imports `Pose` from
// @mediapipe/pose for its BlazePose (MediaPipe-runtime) detector, even though
// this app only ever creates a MoveNet detector. The real @mediapipe/pose
// package is a classic <script>-global build with no ESM exports, so a
// production bundler's static export check fails on it. This stub is aliased
// in place of it (see vite.config.js) purely to satisfy that import; it is
// never constructed.
export class Pose {
  constructor() {
    throw new Error('BlazePose is not wired up in this app; only MoveNet MultiPose is used.');
  }
}
