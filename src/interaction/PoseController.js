import { CONFIG, asset } from '../config.js';

// Runs MoveNet MultiPose in a dedicated Worker (CPU backend) against the same
// shared <video> HandController already owns — no second camera request, no
// second permission prompt, and critically no competition with Three.js's own
// WebGL rendering (a GPU-backend model running on the main thread was
// visibly stalling the render loop). Multiple visitors are tracked at once;
// each becomes a soft point of gravity for the ambient star field and a
// possible bridge to another visitor, echoing the exhibition brief's "다인원
// 관계성 분석" (multi-visitor relationship analysis) beyond single-hand input.
export class PoseController {
  constructor(video, callbacks = {}) {
    this.video = video;
    this.callbacks = callbacks;
    this.active = false;
    this.loading = false;
    this.busy = false;
    this.generation = 0;
    this.lastFrame = 0;
    this.lastVideo = -1;
    this.lastTick = 0;
    this.clockSeconds = 0;
    this.people = new Map();
  }
  async start() {
    if (this.active || this.loading) return;
    this.loading = true;
    const generation = ++this.generation;
    try {
      const worker = new Worker(new URL('./pose.worker.js', import.meta.url), { type: 'module' });
      this.worker = worker;
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error('Pose tracking model preparation timed out.')),
          25000,
        );
        worker.onmessage = ({ data }) => {
          if (data.type === 'ready') {
            clearTimeout(timeout);
            resolve();
          }
          if (data.type === 'error') {
            clearTimeout(timeout);
            reject(new Error(data.message));
          }
        };
        worker.onerror = (event) => {
          clearTimeout(timeout);
          reject(new Error(event.message || 'Pose tracking failed to start.'));
        };
        worker.postMessage({
          type: 'init',
          modelUrl: new URL(asset('models/movenet-multipose/model.json'), location.href).href,
        });
      });
      if (generation !== this.generation) {
        worker.terminate();
        return;
      }
      worker.onmessage = ({ data }) => {
        this.busy = false;
        if (data.type === 'result') this.integrate(data.poses, this.pendingDt ?? 0.1);
      };
      worker.onerror = () => {
        this.stop();
      };
      this.active = true;
      this.lastTick = 0;
    } catch (error) {
      this.worker?.terminate();
      this.worker = null;
      throw error;
    } finally {
      this.loading = false;
    }
  }
  stop() {
    this.generation++;
    this.active = false;
    this.busy = false;
    this.worker?.terminate();
    this.worker = null;
    this.people.clear();
    this.callbacks.presence?.([]);
    this.callbacks.bridges?.([]);
    this.callbacks.count?.(0);
  }
  // Called every render frame; internally throttled so a frame is only handed
  // to the worker a handful of times a second, and never while it's still
  // busy with the previous one — independent of the render loop's frame rate.
  tick(now) {
    if (!this.active || this.busy || document.hidden) return;
    if (now - this.lastFrame < CONFIG.poseDetectInterval) return;
    if (this.video.readyState < 2 || this.lastVideo === this.video.currentTime) return;
    this.busy = true;
    this.lastFrame = now;
    this.lastVideo = this.video.currentTime;
    this.pendingDt = Math.min(0.4, (now - (this.lastTick || now)) / 1000);
    this.lastTick = now;
    this.clockSeconds += this.pendingDt;
    const generation = this.generation;
    createImageBitmap(this.video)
      .then((bitmap) => {
        if (!this.active || generation !== this.generation) {
          bitmap.close();
          this.busy = false;
          return;
        }
        this.worker.postMessage({ type: 'frame', bitmap }, [bitmap]);
      })
      .catch(() => {
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
