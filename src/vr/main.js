import * as THREE from 'three';
import { VRModel } from './VRModel.js';
import { VRWorld } from './VRWorld.js';
import { VRInput } from './VRInput.js';
import { VRRecognition } from './VRRecognition.js';
import { Catalogue } from '../ui/Catalogue.js';
import { SHAPE_MAP } from '../data/shapes.js';

const $ = (id) => document.getElementById(id);
export const app = { model: new VRModel() };
const status = (text) => {
  $('vr-status').textContent = text;
};
let session,
  starting = false,
  disposed = false,
  previewPose;
try {
  const world = (app.world = new VRWorld($('vr-stage'), app.model, action));
  const input = (app.input = new VRInput(world, app.model, action, status)),
    desktop = { holding: null };
  const head = () =>
    world.renderer.xr.isPresenting ? world.renderer.xr.getCamera() : world.camera;
  const catalogue = new Catalogue({ preset: shape => loadPreset(shape) });
  catalogue.renderLibrary();
  for (const tab of document.querySelectorAll('[data-filter]')) tab.onclick = () => {
    for (const other of document.querySelectorAll('[data-filter]')) {
      other.classList.toggle('active', tab === other);
      other.setAttribute('aria-pressed', String(tab === other));
    }
    catalogue.libraryFilter = tab.dataset.filter; catalogue.renderLibrary();
  };
  $('library-search').oninput = () => catalogue.renderLibrary();
  $('library-season').onchange = () => catalogue.renderLibrary();
  $('library-dialog').querySelector('.close-dialog').onclick = () => $('library-dialog').close();
  function loadPreset(shape) {
    input.releaseAll(); input.release(desktop);
    world.library.visible = false;
    const camera = head();
    app.model.loadPreset(shape, camera.getWorldPosition(new THREE.Vector3()), camera.getWorldQuaternion(new THREE.Quaternion()));
    status(`${shape.name}를 불러왔어요. 별을 집어 옮기고 좌우로 흔들어 지워보세요.`);
  }
  const recognition = app.recognition = new VRRecognition(app.model, () => input.dragging || !!desktop.holding,
    entity => { if (entity.shapeId) status(`${entity.title} 발견! 별을 옮기면 새로운 모양을 찾을 수 있어요.`); });
  function action(id) {
    input.releaseAll();
    input.release(desktop);
    if (id === 'finish') {
      const camera = head(),
        work = app.model.finish(
          camera.getWorldPosition(new THREE.Vector3()),
          camera.getWorldQuaternion(new THREE.Quaternion()),
        );
      status(
        work
          ? `${work.title}를 우주에 남겼어요. 다음 별자리를 만들어보세요.`
          : app.model.works.length >= 24
            ? '24개의 별자리를 남겼어요. 기존 별도 집어서 움직일 수 있어요.'
            : '별을 두 개 이상, 조금 떨어뜨려 놓아주세요.',
      );
    } else if (id === 'undo') {
      if (!app.model.undo()) status('되돌릴 작업이 없어요.');
    } else if (id === 'erase') {
      input.erase = !input.erase;
      status(input.erase ? '지울 별을 집어주세요.' : '주먹을 1초 쥐면 별이 생겨요. 별을 집어서 움직여보세요.');
    } else if (id === 'library') {
      if (world.renderer.xr.isPresenting) world.library.visible = !world.library.visible;
      else $('library-dialog').showModal();
    } else if (id.startsWith('preset:')) {
      const shape = SHAPE_MAP.get(id.slice(7));
      if (shape) loadPreset(shape);
    } else if (id.startsWith('library-') || id.startsWith('filter:')) world.library.action(id);
    else if (id === 'exit') session?.end();
    updateUI();
  }
  app.action = action;
  function updateUI() {
    const count = `${app.model.works.length}개의 별자리 · 만들고 있는 별 ${app.model.draft.stars.length}개`;
    if ($('vr-count').textContent !== count) $('vr-count').textContent = count;
    if ($('vr-erase').getAttribute('aria-pressed') !== String(input.erase))
      $('vr-erase').setAttribute('aria-pressed', String(input.erase));
    world.updatePanel();
  }
  app.model.addEventListener('change', updateUI);
  updateUI();
  for (const id of ['finish', 'undo', 'erase', 'library']) $(`vr-${id}`).onclick = () => action(id);
  $('vr-enter').onclick = async () => {
    if (starting) return;
    if (session) {
      await session.end();
      return;
    }
    starting = true;
    $('vr-enter').disabled = true;
    try {
      previewPose = {
        position: world.camera.position.clone(),
        quaternion: world.camera.quaternion.clone(),
      };
      session = await navigator.xr.requestSession('immersive-vr', {
        requiredFeatures: ['local-floor'],
        optionalFeatures: ['hand-tracking'],
      });
      $('library-dialog').close();
      session.addEventListener('visibilitychange', () => {
        if (session?.visibilityState !== 'visible') input.releaseAll();
      });
      session.addEventListener(
        'end',
        () => {
          input.releaseAll();
          world.library.visible = false;
          session = null;
          if (disposed) return;
          world.camera.position.copy(previewPose.position);
          world.camera.quaternion.copy(previewPose.quaternion);
          document.body.classList.remove('in-vr');
          $('vr-enter').textContent = 'Meta Quest로 VR 시작';
          $('vr-enter').disabled = false;
          world.resize();
          status('VR에서 나왔어요. 만든 별자리는 이 페이지에 남아 있어요.');
        },
        { once: true },
      );
      await world.renderer.xr.setSession(session);
      document.body.classList.add('in-vr');
      $('vr-enter').textContent = 'VR 나가기';
      status('주먹을 1초 쥐면 별 생성 · 별을 집어서 이동 · 좌우로 흔들면 삭제됩니다.');
    } catch (error) {
      await session?.end().catch(() => {});
      session = null;
      status(
        error.name === 'NotAllowedError'
          ? 'VR 권한을 허용한 뒤 다시 시작해 주세요.'
          : 'VR을 시작하지 못했어요. Meta Quest Browser에서 다시 열어 주세요.',
      );
    } finally {
      starting = false;
      $('vr-enter').disabled = false;
    }
  };
  (async () => {
    const supported =
      !!navigator.xr && (await navigator.xr.isSessionSupported('immersive-vr').catch(() => false));
    if (disposed) return;
    $('vr-enter').disabled = !supported;
    status(
      supported
        ? '헤드셋에서 손 추적을 켠 뒤 VR을 시작하세요. 컨트롤러로도 조작할 수 있어요.'
        : 'Meta Quest Browser에서 이 주소를 열면 VR로 입장할 수 있어요. 여기서는 마우스로 미리 볼 수 있습니다.',
    );
  })();
  let rotating = null,
    drawing = false,
    depth = 0.7,
    yaw = 0,
    pitch = 0;
  const canvas = world.renderer.domElement,
    raycaster = new THREE.Raycaster();
  const pose = (e) => {
    raycaster.setFromCamera(
      new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, 1 - (e.clientY / innerHeight) * 2),
      world.camera,
    );
    const origin = raycaster.ray.origin.clone(),
      direction = raycaster.ray.direction.clone();
    return { origin, direction, point: origin.clone().addScaledVector(direction, depth) };
  };
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    if (world.renderer.xr.isPresenting) return;
    canvas.setPointerCapture(e.pointerId);
    if (e.button === 2) rotating = { x: e.clientX, y: e.clientY, yaw, pitch };
    else if (e.button === 0) {
      drawing = true;
      input.begin(desktop, pose(e), { allowCreate: true });
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (rotating) {
      yaw = rotating.yaw - (e.clientX - rotating.x) * 0.004;
      pitch = THREE.MathUtils.clamp(rotating.pitch - (e.clientY - rotating.y) * 0.004, -1.4, 1.4);
      world.camera.quaternion.setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'));
    }
    if (drawing && desktop.holding) {
      const p = pose(e);
      app.model.move(
        desktop.holding,
        (desktop.far ? p.origin.addScaledVector(p.direction, desktop.distance) : p.point).add(
          desktop.offset,
        ),
      );
    }
  });
  const release = () => {
    rotating = null;
    drawing = false;
    input.release(desktop);
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener(
    'wheel',
    (e) => {
      depth = THREE.MathUtils.clamp(depth + e.deltaY * 0.001, 0.35, 1.8);
    },
    { passive: true },
  );
  world.renderer.setAnimationLoop((now) => {
    if (document.hidden && !world.renderer.xr.isPresenting) return;
    if (world.renderer.xr.isPresenting) {
      world.renderer.xr.updateCamera(world.camera);
      input.update(now);
    }
    recognition.update(now);
    world.frame(now);
    world.renderer.render(world.scene, world.camera);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      input.releaseAll();
      release();
    }
  });
  window.addEventListener('pagehide', () => {
    disposed = true;
    input.releaseAll();
    session?.end();
    recognition.dispose();
    world.dispose();
  });
} catch (error) {
  console.error('VR initialization failed:', error);
  status('3D 화면을 준비하지 못했어요. 브라우저를 새로고침해 주세요.');
  $('vr-enter').disabled = true;
}
