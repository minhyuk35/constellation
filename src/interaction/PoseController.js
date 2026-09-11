import { CONFIG, asset } from '../config.js';

// Runs MoveNet MultiPose on the main thread against the same shared <video>
// HandController already owns — no second camera request, no second permission
// prompt. Multiple visitors are tracked at once; each becomes a soft point of
// gravity for the ambient star field and a possible bridge to another visitor,
// echoing the exhibition brief's "다인원 관계성 분석" (multi-visitor relationship
// analysis) beyond the single-hand interaction path.
export class PoseController {
  constructor(video, callbacks = {}) {
    this.video = video;
    this.callbacks = callbacks;
    this.active = false;
    this.loading = false;
    this.busy = false;
    this.lastDetect = 0;
    this.lastTick = 0;
    this.clockSeconds = 0;
    this.people = new Map();
  }
  async start() {
    if (this.active || this.loading) return;
    this.loading = true;
    try {
      // tfjs + pose-detection are a few hundred KB; loaded on demand so a
      // visitor who never turns on the camera never pays for them.
      const [tf, poseDetection] = await Promise.all([
        import('@tensorflow/tfjs-core'),
        import('@tensorflow/tfjs-backend-webgl').then(() => import('@tensorflow-models/pose-detection')),
      ]);
      await tf.setBackend('webgl');
      await tf.ready();
      this.detector = await poseDetection.createDetector(poseDetection.SupportedModels.MoveNet, {
        modelType: poseDetection.movenet.modelType.MULTIPOSE_LIGHTNING,
        modelUrl: asset('models/movenet-multipose/model.json'),
        enableTracking: true,
        trackerType: poseDetection.TrackerType.BoundingBox,
      });
      this.active = true;
      this.lastTick = 0;
    } finally {
      this.loading = false;
    }
  }
  stop() {
    this.active = false;
    this.people.clear();
    this.detector?.dispose();
    this.detector = null;
    this.callbacks.presence?.([]);
    this.callbacks.bridges?.([]);
    this.callbacks.count?.(0);
  }
  // Called every render frame; internally throttled so MoveNet only runs a
  // handful of times a second, independent of the render loop's frame rate.
  tick(now) {
    if (!this.active || this.busy || document.hidden) return;
    if (now - this.lastDetect < CONFIG.poseDetectInterval) return;
    if (this.video.readyState < 2) return;
    this.busy = true;
    this.lastDetect = now;
    const dt = Math.min(0.4, (now - (this.lastTick || now)) / 1000);
    this.lastTick = now;
    this.clockSeconds += dt;
    this.detector
      .estimatePoses(this.video, { maxPoses: 6 })
      .then((poses) => this.integrate(poses, dt))
      .catch(() => {
        /* A frame dropped during model warm-up or a resize is not fatal. */
      })
      .finally(() => {
        this.busy = false;
      });
  }
  integrate(poses, dt) {
    if (!this.active) return;
    const vw = this.video.videoWidth,
      vh = this.video.videoHeight;
    if (!vw || !vh) return;
    const seen = new Set();
    let interacting = false;
    for (let index = 0; index < poses.length; index++) {
      const pose = poses[index];
      if (pose.score !== undefined && pose.score < CONFIG.poseMinScore) continue;
      const id = pose.id ?? `p${index}`;
      seen.add(id);
      let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;
      const points = [];
      for (const k of pose.keypoints) {
        if (k.score < CONFIG.poseKeypointMinScore) continue;
        minX = Math.min(minX, k.x);
        maxX = Math.max(maxX, k.x);
        minY = Math.min(minY, k.y);
        maxY = Math.max(maxY, k.y);
        // Mirrored so the visitor sees themselves as in a mirror, matching the
        // hand-tracking cursor convention already used across the app.
        points.push({ x: 1 - k.x / vw, y: k.y / vh });
      }
      if (!Number.isFinite(minX)) continue;
      const boxRatio = (maxY - minY) / vh;
      const x = 1 - (minX + maxX) / 2 / vw;
      const y = (minY + maxY) / 2 / vh;
      let person = this.people.get(id);
      if (!person) {
        person = { x, y, stillT: 0, revealed: false, lastSpawn: { x, y } };
        this.people.set(id, person);
      }
      const speed = Math.hypot(x - person.x, y - person.y);
      person.x = x;
      person.y = y;
      person.keypoints = points;
      person.lastSeen = this.clockSeconds;
      const near = boxRatio > CONFIG.poseInteractBoxRatio;
      if (near) interacting = true;
      if (near && speed < CONFIG.poseStillness) person.stillT = Math.min(4, person.stillT + dt);
      else person.stillT = Math.max(0, person.stillT - dt * 1.5);
      person.quiet = person.stillT > CONFIG.poseStillHold;
      if (person.quiet && person.stillT > CONFIG.poseSilhouetteHold && !person.revealed) {
        person.revealed = true;
        this.callbacks.silhouette?.(person.keypoints);
      } else if (!person.quiet) {
        person.revealed = false;
      }
      // Simply walking through the space (no hand gestures needed) still
      // leaves a trace, echoing "당신의 움직임은 사라지지 않는다".
      if (Math.hypot(x - person.lastSpawn.x, y - person.lastSpawn.y) > CONFIG.poseTrailDistance) {
        this.callbacks.trail?.({ x, y });
        person.lastSpawn = { x, y };
      }
    }
    for (const [id, person] of this.people)
      if (!seen.has(id) && this.clockSeconds - person.lastSeen > CONFIG.poseTimeout)
        this.people.delete(id);
    const active = [...this.people.values()];
    this.callbacks.presence?.(active.map((p) => ({ x: p.x, y: p.y, quiet: p.quiet })));
    this.callbacks.bridges?.(this.findBridges(active));
    this.callbacks.state?.(poses.length === 0 ? 'idle' : interacting ? 'interact' : 'approach');
    this.callbacks.count?.(active.length);
  }
  findBridges(people) {
    const pairs = [];
    for (let i = 0; i < people.length; i++)
      for (let j = i + 1; j < people.length; j++) {
        const a = people[i],
          b = people[j];
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        if (distance > CONFIG.poseBridgeMaxDistance) continue;
        pairs.push({ a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y } });
      }
    return pairs;
  }
}
