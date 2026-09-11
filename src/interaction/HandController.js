import { CONFIG, asset } from '../config.js';
import { classifyHand } from './gestures.js';

export class HandController {
  constructor(video, stage, model, callbacks) {
    this.video = video;
    this.stage = stage;
    this.model = model;
    this.callbacks = callbacks;
    this.slots = [this.makeSlot(), this.makeSlot()];
    this.active = false;
    this.loading = false;
    this.generation = 0;
    this.cursorLayer = document.getElementById('hand-cursors');
    this.lastFrame = 0;
    this.lastVideo = -1;
    window.addEventListener('pagehide', () => this.stop());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.releaseAll();
    });
  }
  makeSlot() {
    return {
      x: 0.5,
      y: 0.5,
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
          frameRate: { ideal: 24, max: 30 },
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
        this.busy = false;
        if (data.type === 'result') this.process(data.landmarks, performance.now());
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
    if (!this.active || document.hidden) return;
    for (const slot of this.slots)
      if (slot.seen && now - slot.seen > CONFIG.handLostAfter) this.release(slot);
    if (
      this.busy ||
      now - this.lastFrame < 55 ||
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
        this.busy = false;
      });
  }
  process(landmarks, now) {
    if (!this.active) return;
    if (document.hidden || document.querySelector('dialog[open]')) {
      this.releaseAll();
      return;
    }
    const detections = landmarks.map((lm) => ({
      lm,
      x: 1 - (lm[4].x + lm[8].x) / 2,
      y: (lm[4].y + lm[8].y) / 2,
    }));
    const available = new Set(detections.map((_, i) => i));
    // Stable nearest-neighbour slots prevent MediaPipe's result ordering from
    // swapping which hand holds which star between frames.
    const assignments = new Map();
    const pairs = this.slots
      .flatMap((slot, s) =>
        detections.map((d, i) => ({ s, i, d: Math.hypot(slot.x - d.x, slot.y - d.y) })),
      )
      .sort((a, b) => a.d - b.d);
    for (const pair of pairs)
      if (!assignments.has(pair.s) && available.has(pair.i)) {
        assignments.set(pair.s, pair.i);
        available.delete(pair.i);
      }
    let visibleHands = 0;
    this.slots.forEach((slot, i) => {
      const d = detections[assignments.get(i)];
      if (!d) {
        if (now - slot.seen > CONFIG.handLostAfter) this.release(slot);
        return;
      }
      visibleHands++;
      const previous = slot.gesture;
      const { gesture } = classifyHand(d.lm, previous);
      const fresh = previous === 'lost';
      // Use palm center for fist placement, pinch midpoint for manipulation.
      const dx = gesture === 'fist' ? 1 - d.lm[9].x : d.x;
      const dy = gesture === 'fist' ? d.lm[9].y : d.y;
      slot.x = fresh ? dx : slot.x + (dx - slot.x) * 0.42;
      slot.y = fresh ? dy : slot.y + (dy - slot.y) * 0.42;
      slot.seen = now;
      slot.gesture = gesture;
      if (gesture === 'pinch') {
        if (previous !== 'pinch') {
          const star = this.model.nearest(
            slot.x,
            slot.y,
            this.stage.clientWidth,
            this.stage.clientHeight,
            52,
          );
          if (star && this.model.beginDrag(star.id)) slot.held = star.id;
        }
        if (slot.held) {
          this.model.move(slot.held, slot.x, slot.y);
          // Shake detection runs on the raw (pre-smoothing) fingertip
          // position, not the eased cursor — the 0.42 lerp above exists to
          // keep normal dragging smooth, but it also damps out the fast
          // back-and-forth a deliberate shake needs to be recognized.
          this.model.trackShake(slot.held, dx);
        }
      } else if (slot.held) {
        this.model.endDrag(slot.held);
        slot.held = null;
      }
      if (gesture === 'fist') {
        if (previous !== 'fist') {
          slot.fistStart = now;
          slot.spawned = false;
        }
        if (!slot.spawned && now - slot.fistStart > CONFIG.fistHold) {
          slot.spawned = true;
          if (
            !this.model.nearest(slot.x, slot.y, this.stage.clientWidth, this.stage.clientHeight, 45)
          ) {
            const star = this.model.add(slot.x, slot.y);
            if (star) {
              this.callbacks.burst(slot);
              this.callbacks.chime();
            } else this.callbacks.toast('한 하늘에 별은 48개까지 놓을 수 있어요.');
          }
        }
      } else slot.fistStart = 0;
      if (gesture === 'open' && previous !== 'open' && now - slot.openAt > 1200) {
        this.callbacks.burst(slot, 1.7);
        slot.openAt = now;
      }
      this.renderCursor(slot, i, now);
    });
    this.callbacks.hands(visibleHands);
  }
  renderCursor(slot, i, now) {
    let el = this.cursorLayer.children[i];
    if (!el) {
      el = document.createElement('div');
      this.cursorLayer.append(el);
    }
    el.className = `hand-cursor ${slot.gesture}`;
    el.hidden = false;
    el.style.left = `${slot.x * 100}%`;
    el.style.top = `${slot.y * 100}%`;
    el.style.setProperty(
      '--hold',
      `${slot.fistStart ? Math.min(1, (now - slot.fistStart) / CONFIG.fistHold) * 360 : 0}deg`,
    );
  }
  release(slot) {
    if (slot.held) this.model.endDrag(slot.held);
    slot.held = null;
    slot.gesture = 'lost';
    slot.fistStart = 0;
    slot.seen = 0;
    const index = this.slots.indexOf(slot);
    if (this.cursorLayer.children[index]) this.cursorLayer.children[index].hidden = true;
  }
  releaseAll() {
    this.slots.forEach((s) => this.release(s));
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
    this.callbacks.status('off');
  }
}
