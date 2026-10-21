import { CONFIG, asset } from '../config.js';
import { HandGestureState, classifyHand } from './gestures.js';
import { HandAnchor } from './HandAnchor.js';
import { HandMotion } from './HandMotion.js';
import { HandControlGate } from './HandControlGate.js';

export class HandController {
  constructor(video, stage, model, callbacks, { exclusive = CONFIG.handControl.enabled } = {}) {
    this.video = video;
    this.stage = stage;
    this.model = model;
    this.callbacks = callbacks;
    this.gate = exclusive ? new HandControlGate() : null;
    this.slots = [this.makeSlot(), this.makeSlot()];
    this.active = false;
    this.loading = false;
    this.generation = 0;
    this.cursorLayer = document.getElementById('hand-cursors');
    this.lastFrame = 0;
    this.lastVideo = -1;
    this.lastSample = -Infinity;
    this.detectedHands = 0;
    window.addEventListener('pagehide', () => this.stop());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.releaseAll();
    });
  }
  makeSlot() {
    return {
      x: 0.5,
      y: 0.5,
      rawX: 0.5,
      rawY: 0.5,
      motion: new HandMotion(),
      anchor: new HandAnchor(),
      gestures: new HandGestureState(),
      seen: 0,
      gesture: 'lost',
      held: null,
      fistStart: 0,
      spawned: false,
      openAt: 0,
    };
  }
  async start() {
    if (this.active || this.loading) return;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia)
      throw new Error('카메라는 localhost 또는 HTTPS 주소에서 사용할 수 있어요.');
    this.loading = true;
    const generation = ++this.generation;
    let pendingStream;
    try {
      pendingStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 30, max: 30 },
        },
        audio: false,
      });
      if (generation !== this.generation) {
        pendingStream.getTracks().forEach((t) => t.stop());
        return;
      }
      this.stream = pendingStream;
      this.video.srcObject = pendingStream;
      await this.video.play();
      for (const track of this.stream.getTracks())
        track.addEventListener('ended', () => {
          if (this.active) {
            this.stop();
            this.callbacks.status('카메라 연결이 종료되었습니다.');
          }
        });
      const worker = new Worker(new URL('./hand.worker.js', import.meta.url), { type: 'module' });
      this.worker = worker;
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error('손 인식 모델 준비가 지연되고 있어요. 다시 연결해 주세요.')),
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
        worker.onerror = (e) => {
          clearTimeout(timeout);
          reject(new Error(e.message || '손 인식 기능을 준비하지 못했습니다.'));
        };
        worker.postMessage({
          type: 'init',
          wasmUrl: new URL(asset('wasm'), location.href).href,
          modelUrl: new URL(asset('models/hand_landmarker.task'), location.href).href,
        });
      });
      if (generation !== this.generation) return;
      worker.onmessage = ({ data }) => {
        if (generation !== this.generation || !this.active) return;
        this.busy = false;
        if (data.type === 'result')
          this.process(data.landmarks, performance.now(), data.timestamp, data.handedness);
        else if (data.type === 'error') {
          this.stop();
          this.callbacks.status('손 인식이 중단되었습니다. 카메라를 다시 연결해 주세요.');
        }
      };
      worker.onerror = () => {
        this.stop();
        this.callbacks.status('손 인식이 중단되었습니다. 카메라를 다시 연결해 주세요.');
      };
      this.active = true;
      this.lastFrame = 0;
      this.lastVideo = -1;
      this.lastSample = -Infinity;
      this.busy = false;
      this.loading = false;
      this.callbacks.status('active');
    } catch (error) {
      pendingStream?.getTracks().forEach((t) => t.stop());
      this.stop();
      const messages = {
        NotAllowedError: '카메라 권한이 허용되지 않았어요. 주소창의 카메라 권한을 확인해 주세요.',
        NotFoundError: '연결된 카메라를 찾지 못했어요. 마우스로도 이용할 수 있습니다.',
        NotReadableError:
          '다른 앱에서 카메라를 사용 중일 수 있어요. 카메라를 사용 중인 앱을 닫아주세요.',
      };
      throw new Error(messages[error.name] || error.message || '카메라를 시작하지 못했어요.');
    } finally {
      this.loading = false;
    }
  }
  tick(now) {
    if (!this.active) return;
    if (this.detectedHands && now - this.trackingSeen > CONFIG.handLostAfter) this.tracking(0);
    if (document.hidden || document.querySelector('dialog[open]')) {
      this.releaseAll();
      if (this.gate?.owner) this.gate.needsRearm = true;
      return;
    }
    // Runs on every Three.js render frame, even while inference is busy.
    this.slots.forEach((slot, i) => {
      if (slot.gesture === 'lost') return;
      if (now - slot.seen > CONFIG.handLostAfter) {
        this.release(slot);
        return;
      }
      Object.assign(slot, slot.motion.position(now));
      if (slot.held) {
        if (this.model.draggers.has(slot.held)) {
          const p = this.drawingPoint({ x: slot.x + slot.grabOffset.x, y: slot.y + slot.grabOffset.y });
          this.model.move(slot.held, p.x, p.y, { trackShake: false });
        } else slot.held = null;
      }
      this.renderCursor(slot, i, now);
    });
    if (
      this.busy ||
      now - this.lastFrame < CONFIG.handDetectInterval ||
      this.video.readyState < 2 ||
      this.lastVideo === this.video.currentTime
    )
      return;
    this.busy = true;
    this.lastFrame = now;
    this.lastVideo = this.video.currentTime;
    const generation = this.generation;
    createImageBitmap(this.video)
      .then((bitmap) => {
        if (!this.active || generation !== this.generation) {
          bitmap.close();
          return;
        }
        this.worker.postMessage({ type: 'frame', bitmap, timestamp: now }, [bitmap]);
      })
      .catch(() => {
        if (generation === this.generation) this.busy = false;
      });
  }
  process(landmarks, now, timestamp = now, handedness = []) {
    if (!this.active) return;
    if (document.hidden || document.querySelector('dialog[open]')) {
      this.releaseAll();
      return;
    }
    if (!Number.isFinite(timestamp) || timestamp <= this.lastSample) return;
    this.lastSample = timestamp;
    if (now - timestamp > CONFIG.handLostAfter) {
      this.releaseAll();
      return;
    }
    for (const slot of this.slots)
      if (slot.gesture !== 'lost' && now - slot.seen > CONFIG.handLostAfter) this.release(slot);
    let detections = landmarks
      .map((lm, i) => ({
        lm,
        side: handedness[i]?.[0]?.score > 0.7 ? handedness[i][0].categoryName : '',
      }))
      .filter(
        ({ lm }) =>
          lm?.length >= 21 && lm.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)),
      )
      .map(({ lm, side }) => ({
        lm,
        side,
        x: 1 - (lm[4].x + lm[8].x) / 2,
        y: (lm[4].y + lm[8].y) / 2,
      }));
    this.trackingSeen = now;
    this.tracking(detections.length);
    if (this.gate) {
      detections = this.gate.update(detections, now);
      // Never let a held star continue interpolating through an ambiguous frame.
      if (!detections.length) this.releaseAll();
    }
    const available = new Set(detections.map((_, i) => i));
    // Stable nearest-neighbour slots prevent MediaPipe's result ordering from
    // swapping which hand holds which star between frames. Match against the
    // last raw midpoint, not a lagging cursor or the fist's different anchor.
    const assignments = new Map();
    const pairs = this.slots
      .flatMap((slot, s) =>
        detections.map((d, i) => ({
          s,
          i,
          fresh: slot.gesture === 'lost',
          d: Math.hypot(slot.rawX - d.x, slot.rawY - d.y),
        })),
      )
      .sort((a, b) => Number(a.fresh) - Number(b.fresh) || a.d - b.d);
    for (const pair of pairs)
      if (!assignments.has(pair.s) && available.has(pair.i)) {
        assignments.set(pair.s, pair.i);
        available.delete(pair.i);
      }
    let visibleHands = 0;
    // Read layout once, before moving cursors or updating any status text.
    const width = this.stage.clientWidth, height = this.stage.clientHeight;
    this.slots.forEach((slot, i) => {
      const d = detections[assignments.get(i)];
      if (!d) {
        slot.gestures.pending = null;
        if (now - slot.seen > CONFIG.handLostAfter) this.release(slot);
        return;
      }
      visibleHands++;
      const previous = slot.gesture;
      const gesture = slot.gestures.update(d.lm, timestamp);
      // While a possible release is being confirmed, keep the held position.
      // Opening/folding the fingers changes the midpoint even without a drag.
      const pendingRelease = slot.held && gesture === 'pinch' && slot.gestures.pending;
      const raw = classifyHand(d.lm, gesture).gesture;
      const { x: dx, y: dy } = slot.anchor.update(
        { x: d.x, y: d.y }, { x: 1 - d.lm[9].x, y: d.lm[9].y },
        gesture !== 'pinch' || !!slot.gestures.pending, raw === 'fist',
      );
      if (!pendingRelease)
        slot.motion.update(dx, dy, timestamp, width, height, now);
      Object.assign(slot, slot.motion.position(now));
      slot.rawX = d.x;
      slot.rawY = d.y;
      // Presence is measured since the last delivered observation. Counting
      // inference latency again would release a continuously visible hand on
      // slower CPUs. The filter and gestures still use capture timestamps.
      slot.seen = now;
      slot.gesture = gesture;
      if (gesture === 'pinch') {
        if (previous !== 'pinch') {
          const star = this.pick(slot, width, height, CONFIG.handGrabRadius);
          if (star && this.model.beginDrag(star.id)) {
            slot.held = star.id;
            const p = this.callbacks.toScreen?.(star) || star;
            slot.grabOffset = { x: p.x - slot.x, y: p.y - slot.y };
          }
        }
        if (slot.held && !pendingRelease) {
          // Feed exactly one raw sample per camera result. Mixing raw and
          // rendered coordinates creates artificial direction reversals.
          this.model.trackShake(slot.held, dx, timestamp);
          if (!this.model.draggers.has(slot.held)) slot.held = null;
        }
      } else if (slot.held) {
        this.model.endDrag(slot.held);
        slot.held = null;
      }
      if (gesture === 'fist' && raw === 'fist' && !slot.gestures.pending) {
        if (!slot.fistStart) {
          slot.fistStart = timestamp;
          slot.spawned = false;
        }
        if (!slot.spawned && raw === 'fist' && !slot.gestures.pending && timestamp - slot.fistStart > CONFIG.fistHold) {
          slot.spawned = true;
          if (!this.pick(slot, width, height, 45)) {
            const p = this.drawingPoint(slot);
            const star = this.model.add(p.x, p.y);
            if (star) {
              this.callbacks.burst(star);
              this.callbacks.chime();
            } else this.callbacks.toast('한 하늘에 별은 48개까지 놓을 수 있어요.');
          }
        }
      } else if (gesture !== 'fist' || raw === 'pinch') slot.fistStart = 0;
      if (gesture === 'open' && previous !== 'open' && now - slot.openAt > 1200) {
        this.callbacks.burst(this.drawingPoint(slot), 1.7, 'wave');
        slot.openAt = now;
      }
    });
    this.callbacks.hands(visibleHands);
    if (this.gate)
      this.callbacks.control?.({ ...this.gate.state, session: this.gate.session || 0 });
  }
  pick(point, width, height, radius) {
    return this.callbacks.pick
      ? this.callbacks.pick(point, radius)
      : this.model.nearest(point.x, point.y, width, height, radius);
  }
  drawingPoint(point) {
    return this.callbacks.toDrawing?.(point) || point;
  }
  renderCursor(slot, i, now) {
    let el = this.cursorLayer.children[i];
    if (!el) {
      el = document.createElement('div');
      this.cursorLayer.append(el);
    }
    const className = `hand-cursor ${slot.gesture}`;
    if (el.className !== className) el.className = className;
    if (el.hidden) el.hidden = false;
    // Fixed-position cursors use viewport coordinates as before, but transform
    // movement can be composited without laying out the page on every frame.
    const transform = `translate3d(${slot.x * 100}vw, ${slot.y * 100}vh, 0) translate(-50%, -50%)`;
    if (el.cursorTransform !== transform) {
      el.style.transform = transform;
      el.cursorTransform = transform;
    }
    const hold = slot.fistStart ? Math.round(Math.min(1, (now - slot.fistStart) / CONFIG.fistHold) * 180) * 2 : 0;
    if (el.holdProgress !== hold) {
      el.style.setProperty('--hold', `${hold}deg`);
      el.holdProgress = hold;
    }
  }
  release(slot) {
    if (slot.held) this.model.endDrag(slot.held);
    slot.held = null;
    slot.gesture = 'lost';
    slot.fistStart = 0;
    slot.spawned = false;
    slot.seen = 0;
    slot.motion.reset();
    slot.anchor.reset();
    slot.gestures.reset();
    const index = this.slots.indexOf(slot);
    const cursor = this.cursorLayer.children[index];
    if (cursor && !cursor.hidden) cursor.hidden = true;
  }
  releaseAll() {
    this.slots.forEach((s) => this.release(s));
  }
  tracking(count) {
    if (this.detectedHands === count) return;
    this.detectedHands = count;
    this.callbacks.tracking?.(count);
  }
  stop() {
    this.generation++;
    this.active = false;
    this.loading = false;
    this.busy = false;
    this.worker?.terminate();
    this.worker = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.video.pause();
    this.video.srcObject = null;
    this.releaseAll();
    this.tracking(0);
    this.gate?.reset();
    this.callbacks.status('off');
  }
}
