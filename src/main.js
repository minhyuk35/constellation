import { Universe } from './scene/Universe.js';
import { CanvasModel } from './interaction/CanvasModel.js';
import { PointerController } from './interaction/PointerController.js';
import { HandController } from './interaction/HandController.js';
import { PoseController } from './interaction/PoseController.js';
import { Soundscape } from './audio/Soundscape.js';
import { Interface, $ } from './ui/Interface.js';
import { SHAPES, SHAPE_MAP } from './data/shapes.js';
import { matchShapes, normalize } from './recognition/matcher.js';
import { saveArchive } from './data/archive.js';
import { encodeShare } from './data/share.js';
import { CONFIG } from './config.js';
import QRCode from 'qrcode';

const model = new CanvasModel();
const sound = new Soundscape();
let universe, pointer, hand, pose, ui, recognition;
let active = false,
  autoRecognize = true,
  currentMatch = null,
  previewIndex = 0;
let requestedRevision = -1,
  recognizedRevision = -1,
  recognizing = false;
let lastHandCount = -1,
  presetChange = false;
let inferredEdges = [];

function start() {
  if (active) return;
  active = true;
  ui.setActive();
  // The intro constellation becomes editable; it is never silently discarded.
  ui.labels({ labels: [] }, []);
  $('next-preview').hidden = true;
  $('drawing-hint').textContent = '별을 옮기거나, 빈 공간을 눌러 나만의 이야기를 더해보세요.';
}
function worldPoints() {
  return model.stars.map((s) => ({ x: (s.x * universe.width) / universe.height, y: -s.y }));
}
function visibleEdges() {
  const keys = new Set();
  return [...model.edges, ...inferredEdges].filter((edge) => {
    const key = [...edge].sort().join(':');
    if (keys.has(key)) return false;
    keys.add(key);
    return true;
  });
}
function updateDrawing(reveal = false) {
  universe.setDrawing(model.stars, visibleEdges(), model.selected, reveal);
  ui.updateCount(model);
}
function applyResult(match, { example = false, save = true } = {}) {
  currentMatch = match;
  recognizedRevision = model.revision;
  universe.showArt(match);
  ui.showResult(match, example);
  updateDrawing(true);
  if (
    save &&
    !saveArchive(
      match.shape,
      { ...model.snapshot(), edges: visibleEdges(), manualEdges: structuredClone(model.edges) },
      universe.width / universe.height,
    )
  )
    ui.toast('기록 저장 공간이 부족해요. ‘순간 저장’으로 이미지를 보관해 주세요.');
}
function loadPreset(shape, intro = false) {
  if (!intro) start();
  hand?.releaseAll();
  pointer?.release();
  inferredEdges = [];
  const aspect = universe.width / universe.height;
  const mobile = universe.width < 760;
  const cx = intro ? (mobile ? 0.74 : 0.64) : 0.5;
  const cy = intro ? (mobile ? 0.46 : 0.425) : 0.46;
  const scale = intro
    ? mobile
      ? Math.min(0.19, aspect * 0.4)
      : Math.min(0.265, aspect * 0.18)
    : Math.min(0.235, aspect * 0.34);
  const stars = shape.points.map((p) => ({
    id: crypto.randomUUID(),
    x: cx + (p.x * scale) / aspect,
    y: cy - p.y * scale,
  }));
  const edges = shape.edges.map(([a, b]) => [stars[a].id, stars[b].id]);
  presetChange = true;
  model.replace(stars, edges, !intro);
  presetChange = false;
  const origin = normalize(shape.points).center;
  const match = {
    shape,
    similarity: 100,
    transform: {
      center: { x: cx * aspect + origin.x * scale, y: -cy + origin.y * scale },
      scale,
      angle: 0,
      mirror: 1,
      origin,
    },
  };
  applyResult(match, { example: intro, save: !intro });
  if (intro) ui.labels(shape, model.stars);
  else {
    ui.clearResult();
    ui.showResult(match);
    sound.reveal();
  }
}
async function toggleCamera() {
  if (hand.active) {
    hand.stop();
    pose.stop();
    return;
  }
  ui.cameraStatus('loading');
  try {
    await hand.start();
    start();
    ui.toast('손을 보여주세요. 엄지와 검지를 맞대면 별을 잡을 수 있어요.');
    // Multi-visitor pose tracking is a bonus layer on the same camera feed;
    // its failure (e.g. no WebGL) must never block hand tracking from working.
    pose.start().catch((error) => console.warn('Pose tracking unavailable:', error));
  } catch (error) {
    ui.cameraStatus('off');
    ui.toast(error.message);
  }
}
function recognize(manual = false) {
  if (!active) start();
  if (model.dragging) return;
  if (model.stars.length < CONFIG.minStars) {
    if (manual) ui.toast('별을 4개 이상 놓으면 닮은 모양을 찾아드릴게요.');
    return;
  }
  if (!recognition) {
    ui.toast('형태 인식을 준비하지 못했습니다. 새로고침해 주세요.');
    return;
  }
  if (recognizing && requestedRevision === model.revision) return;
  requestedRevision = model.revision;
  recognizing = true;
  $('scene-status').textContent = '별 사이의 모양을 찾는 중';
  $('auto-hint').textContent = '별 사이에 숨은 이야기를 찾고 있어요';
  recognition.postMessage({ points: worldPoints(), revision: model.revision });
}
async function saveImage() {
  try {
    const blob = await universe.capture(currentMatch?.shape.name || '나의 우주');
    if (!blob) throw new Error('capture');
    const url = URL.createObjectURL(blob),
      a = document.createElement('a');
    a.href = url;
    a.download = `constellation-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    ui.toast('지금의 우주를 이미지로 저장했습니다.');
  } catch {
    ui.toast('이미지를 저장하지 못했어요. 잠시 후 다시 시도해 주세요.');
  }
}
async function showQrCode() {
  if (model.stars.length < CONFIG.minStars) {
    ui.toast('별을 4개 이상 놓으면 QR로 공유할 수 있어요.');
    return;
  }
  const payload = encodeShare({
    stars: model.stars,
    edges: visibleEdges(),
    shapeId: currentMatch?.shape.id || null,
  });
  if (!payload) {
    ui.toast('QR 코드를 만들지 못했어요.');
    return;
  }
  const shareUrl = new URL(`share.html#d=${payload}`, location.href).toString();
  try {
    const dataUrl = await QRCode.toDataURL(shareUrl, {
      margin: 1,
      width: 480,
      color: { dark: '#0d0b1aff', light: '#f5f3ffff' },
    });
    ui.showQR(dataUrl, shareUrl);
  } catch {
    ui.toast('QR 코드를 만들지 못했어요.');
  }
}
function restore(entry) {
  start();
  hand.releaseAll();
  pointer.release();
  let stars = structuredClone(entry.stars);
  const aspect = universe.width / universe.height;
  if (Number.isFinite(entry.aspect) && entry.aspect > 0) {
    const center = stars.reduce(
      (s, p) => ({ x: s.x + p.x / stars.length, y: s.y + p.y / stars.length }),
      { x: 0, y: 0 },
    );
    const factor = Math.min(1, aspect / entry.aspect);
    stars = stars.map((s) => ({
      ...s,
      x: 0.5 + (((s.x - center.x) * entry.aspect) / aspect) * factor,
      y: 0.46 + (s.y - center.y) * factor,
    }));
  }
  model.replace(stars, entry.manualEdges || entry.edges);
  inferredEdges = entry.edges;
  const match = matchShapes(worldPoints(), [SHAPE_MAP.get(entry.shapeId)])[0];
  if (match) applyResult(match, { save: false });
}

try {
  ui = new Interface({
    start,
    camera: toggleCamera,
    sound: async () => {
      try {
        ui.sound(await sound.toggle());
      } catch {
        ui.toast('이 브라우저에서 소리를 시작하지 못했어요.');
      }
    },
    undo: () => {
      start();
      pointer.release();
      hand.releaseAll();
      if (!model.undo()) ui.toast('되돌릴 작업이 없어요.');
    },
    newCanvas: () => {
      start();
      pointer.release();
      hand.releaseAll();
      model.clear();
      ui.toast('새로운 밤하늘을 열었습니다. 되돌리기로 이전 배치를 복원할 수 있어요.');
    },
    interpret: () => recognize(true),
    next: () => {
      previewIndex = (previewIndex + 1) % 4;
      loadPreset(SHAPES[previewIndex], !active);
    },
    save: saveImage,
    qr: showQrCode,
    preset: (shape) => loadPreset(shape),
    restore,
    mode: (mode) => pointer.setMode(mode),
    remove: () => {
      start();
      model.removeSelected();
    },
    opacity: (value) => {
      universe.artOpacity = value;
    },
    brightness: (value) => {
      universe.skyMaterial.uniforms.uBrightness.value = value;
    },
    auto: (value) => {
      autoRecognize = value;
      model.lastEdit = performance.now();
      $('auto-hint').textContent = value
        ? '잠시 멈추면 닮은 모양을 찾아요'
        : '형태 발견하기를 눌러 모양을 찾아요';
    },
    motion: (value) => {
      universe.reducedMotion = value;
    },
    quality: (value) => {
      universe.quality = value;
      universe.resize();
    },
  });
  universe = new Universe($('stage'), (message) => {
    if (message) ui.toast(message);
    else $('render-error').hidden = false;
  });
  $('reduced-motion').checked = universe.reducedMotion;
  const callbacks = {
    activate: start,
    toast: (message) => ui.toast(message),
    burst: (p, strength) => universe.burst(p, strength),
    chime: () => sound.chime(model.stars.length),
  };
  pointer = new PointerController($('stage'), model, callbacks);
  hand = new HandController($('camera-video'), $('stage'), model, {
    ...callbacks,
    status: (status) => {
      if (status === 'active' || status === 'off') {
        ui.cameraStatus(status);
        lastHandCount = -1;
        if (status === 'off')
          $('gesture-hint').textContent = '별을 끌어 움직이거나 빈 곳을 눌러보세요';
      } else ui.toast(status);
    },
    hands: (count) => {
      if (lastHandCount === count) return;
      lastHandCount = count;
      $('input-status').textContent = count
        ? `${count} HAND${count > 1 ? 'S' : ''} DETECTED`
        : 'SHOW YOUR HANDS';
      $('gesture-hint').textContent = count
        ? '집기 · 이동 / 주먹 1초 · 별 생성 / 손 펼치기 · 빛 확산'
        : '손 전체가 카메라에 보이도록 해주세요';
    },
  });
  pose = new PoseController($('camera-video'), {
    presence: (people) => universe.setPresence(people),
    bridges: (pairs) => universe.setBridges(pairs),
    trail: (point) => universe.spawnTrail(point),
    silhouette: (points) => universe.revealSilhouette(points),
  });
  recognition = new Worker(new URL('./recognition/recognition.worker.js', import.meta.url), {
    type: 'module',
  });
  recognition.onmessage = ({ data }) => {
    if (data.revision !== requestedRevision) return;
    recognizing = false;
    if (data.revision !== model.revision || model.dragging) {
      requestedRevision = -1;
      return;
    }
    if (data.error) {
      ui.toast('형태를 비교하지 못했습니다. 별을 조금 옮겨 다시 시도해 주세요.');
      return;
    }
    const best = data.candidates[0];
    if (!best || best.similarity < 48) {
      recognizedRevision = model.revision;
      ui.clearResult();
      universe.hideArt();
      currentMatch = null;
      $('scene-status').textContent = '당신만의 새로운 모양';
      $('auto-hint').textContent = '별을 조금 옮기거나 도감의 모양을 참고해보세요';
      ui.toast('아직 뚜렷이 닮은 모양이 없어요. 자유로운 별 배치는 그대로 남겨둘게요.');
      return;
    }
    // Inferred lines remain separate from explicit user connections so each
    // recognition replaces its own graph instead of accumulating old shapes.
    inferredEdges = data.edges.map(([a, b]) => [model.stars[a].id, model.stars[b].id]);
    applyResult(best);
    sound.reveal();
    $('auto-hint').textContent = '별을 움직이면 새로운 이야기를 발견할 수 있어요';
    const next = data.candidates[1];
    if (next && best.similarity - next.similarity < 5)
      ui.toast(`${best.shape.name}와 가장 닮았어요. ${next.shape.name}의 모습도 조금 보이네요.`);
  };
  recognition.onerror = () => {
    recognizing = false;
    ui.toast('형태 인식이 중단되었습니다. 새로고침해 주세요.');
    recognition?.terminate();
    recognition = null;
  };
  model.addEventListener('change', ({ detail }) => {
    if (detail.edited && !presetChange) {
      inferredEdges = [];
      currentMatch = null;
      universe.hideArt();
      ui.clearResult();
      $('scene-status').textContent = model.stars.length
        ? '당신의 이야기를 그리는 중'
        : '별을 기다리는 중';
      $('drawing-hint').textContent =
        model.stars.length < 4
          ? `별 ${Math.max(0, 4 - model.stars.length)}개를 더 놓아보세요. 빈 공간을 누르면 별이 생겨요.`
          : '잠시 손을 멈추면 닮은 모양이 드러납니다.';
    }
    updateDrawing();
  });
  loadPreset(SHAPES[0], true);
  let lastHint = '';
  universe.start((dt, now) => {
    hand.tick(now);
    pose.tick(now);
    if (
      active &&
      autoRecognize &&
      !document.querySelector('dialog[open]') &&
      !model.dragging &&
      model.stars.length >= 4 &&
      model.revision !== recognizedRevision &&
      model.revision !== requestedRevision
    ) {
      const remaining = CONFIG.recognizeDelay - (now - model.lastEdit);
      if (remaining <= 0) recognize();
      else {
        const hint = `${Math.ceil(remaining / 1000)}초 뒤, 별 사이의 이야기가 드러납니다`;
        if (lastHint !== hint) {
          $('auto-hint').textContent = hint;
          lastHint = hint;
        }
      }
    }
  });
  let resizeTimer;
  let previousWidth = universe.width,
    previousHeight = universe.height;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      universe.resize();
      if (!active) loadPreset(SHAPES[previewIndex], true);
      else {
        pointer.release();
        hand.releaseAll();
        const width = universe.width,
          height = universe.height;
        const factor = Math.min(width / previousWidth, height / previousHeight);
        const oldShape = currentMatch?.shape;
        const previousInferredEdges = inferredEdges;
        model.stars = model.stars.map((s) => ({
          ...s,
          x: 0.5 + ((s.x - 0.5) * previousWidth * factor) / width,
          y: 0.5 + ((s.y - 0.5) * previousHeight * factor) / height,
        }));
        model.changed();
        inferredEdges = previousInferredEdges;
        if (oldShape) {
          const match = matchShapes(worldPoints(), [oldShape])[0];
          if (match) applyResult(match, { save: false });
        }
      }
      previousWidth = universe.width;
      previousHeight = universe.height;
    }, 180);
  });
  window.addEventListener('pagehide', () => {
    universe.dispose();
    recognition?.terminate();
    sound.dispose();
    pose.stop();
  });
} catch (error) {
  console.error('Constellation initialization failed:', error);
  $('render-error').hidden = false;
}
