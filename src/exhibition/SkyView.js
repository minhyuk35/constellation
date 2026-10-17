import * as THREE from 'three';
import { SKY_RADIUS_DEG } from './sky-layout.js';
import { deviceQuaternion } from './sky-orientation.js';
import { skyIllustration } from './sky-art.js';
import { SkyArtwork } from './SkyArtwork.js';

const rad = Math.PI / 180;
const direction = ({ yaw, pitch }) =>
  new THREE.Vector3(
    Math.sin(yaw * rad) * Math.cos(pitch * rad),
    Math.sin(pitch * rad),
    -Math.cos(yaw * rad) * Math.cos(pitch * rad),
  );
export class SkyView {
  constructor(stage, onFocus, onGuide = () => {}) {
    this.stage = stage;
    this.onFocus = onFocus;
    this.onGuide = onGuide;
    this.works = new Map();
    this.artwork = new SkyArtwork();
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(innerWidth < 760 ? 48 : 65, innerWidth / innerHeight, 0.1, 100);
    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(innerWidth, innerHeight);
    stage.append(this.renderer.domElement);
    this.yaw = Math.random() * 360;
    this.pitch = 28;
    this.aim();
    this.forward = new THREE.Vector3();
    const texture = document.createElement('canvas');
    texture.width = texture.height = 64;
    const ctx = texture.getContext('2d'),
      gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, '#fff');
    gradient.addColorStop(0.09, '#fff');
    gradient.addColorStop(0.2, '#bce4f8b0');
    gradient.addColorStop(1, '#a5d9ff00');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);
    this.texture = new THREE.CanvasTexture(texture);
    let drag;
    stage.addEventListener('pointerdown', (e) => {
      if (!this.motion) {
        drag = { x: e.clientX, y: e.clientY, yaw: this.yaw, pitch: this.pitch };
        stage.setPointerCapture(e.pointerId);
      }
    });
    stage.addEventListener('pointermove', (e) => {
      if (!drag || this.motion) return;
      this.yaw = drag.yaw - (e.clientX - drag.x) * 0.15;
      this.pitch = THREE.MathUtils.clamp(drag.pitch + (e.clientY - drag.y) * 0.15, -30, 89);
      this.aim();
    });
    const release = () => {
      drag = null;
    };
    stage.addEventListener('pointerup', release);
    stage.addEventListener('pointercancel', release);
    this.resize = () => {
      this.camera.aspect = innerWidth / innerHeight;
      this.camera.fov = innerWidth < 760 ? 48 : 65;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(innerWidth, innerHeight);
    };
    window.addEventListener('resize', this.resize);
    this.orientation = (event) => {
      if (!this.motion) return;
      const q = deviceQuaternion(event, screen.orientation?.angle ?? window.orientation ?? 0);
      if (!q) return;
      this.lastMotion = performance.now();
      this.camera.quaternion.copy(q);
    };
    window.addEventListener('deviceorientation', this.orientation);
    this.renderer.setAnimationLoop(() => {
      if (document.hidden) return;
      this.camera.getWorldDirection(this.forward);
      let nearest = null,
        score = Math.cos(9 * rad);
      const previous = this.works.get(this.focusId);
      if (previous && this.forward.dot(previous.direction) > Math.cos(12 * rad)) {
        nearest = previous;
        score = this.forward.dot(previous.direction);
      }
      for (const work of this.works.values()) {
        const candidate = this.forward.dot(work.direction);
        if (candidate > score) {
          nearest = work;
          score = candidate;
        }
      }
      const id = nearest?.data.id || null;
      if (id !== this.focusId) {
        if (previous) { previous.line.material.opacity = 0.8; previous.focused = false; }
        if (nearest) { nearest.line.material.opacity = 1; nearest.focused = true; }
        this.focusId = id;
        this.onFocus(nearest?.data || null);
      }
      // A direction cue keeps sparse exhibitions discoverable by moving the
      // phone. It never turns the camera or requires choosing a list item.
      let guide = '';
      if (!nearest && this.works.size) {
        let closest, best = -Infinity;
        for (const entry of this.works.values()) {
          const dot = this.forward.dot(entry.direction);
          if (dot > best) { best = dot; closest = entry; }
        }
        const local = closest.direction.clone().applyQuaternion(this.camera.quaternion.clone().invert());
        const horizontal = Math.abs(local.x) > 0.12 ? (local.x > 0 ? '오른쪽' : '왼쪽') : '';
        const vertical = Math.abs(local.y) > 0.12 ? (local.y > 0 ? '위' : '아래') : '';
        const arrow = horizontal && vertical
          ? (local.x > 0 ? (local.y > 0 ? '↗' : '↘') : (local.y > 0 ? '↖' : '↙'))
          : horizontal ? (local.x > 0 ? '→' : '←') : vertical ? (local.y > 0 ? '↑' : '↓') : '↶';
        guide = `${arrow} ${horizontal || vertical ? `${horizontal}${horizontal && vertical ? ' ' : ''}${vertical}에` : '뒤쪽에'} 별자리가 있어요`;
        // When the camera faces the floor, upper-sky targets are behind it;
        // their screen projection can misleadingly point farther downward.
        if (this.forward.y < -0.25) guide = '↑ 휴대폰을 들어 하늘을 둘러보세요';
      }
      if (guide !== this.guide) { this.guide = guide; this.onGuide(guide); }
      this.artwork.update(this.works, this.camera, this.forward, performance.now() / 1000);
      this.renderer.render(this.scene, this.camera);
    });
  }
  aim() {
    this.camera.lookAt(direction({ yaw: this.yaw, pitch: this.pitch }));
  }
  setMotion(value) {
    this.motion = value;
    if (!value) {
      const f = this.camera.getWorldDirection(new THREE.Vector3());
      this.yaw = Math.atan2(f.x, -f.z) / rad;
      this.pitch = Math.asin(f.y) / rad;
    }
  }
  setWorks(items) {
    for (const data of items) {
      if (this.works.has(data.id)) {
        this.works.get(data.id).data = data;
        continue;
      }
      const center = direction(data.direction),
        group = new THREE.Group();
      group.position.copy(center).multiplyScalar(20);
      group.lookAt(0, 0, 0);
      const scale = 20 * Math.tan(SKY_RADIUS_DEG * rad);
      const positions = data.drawing.stars.flatMap((p) => [p.x * scale, p.y * scale, 0]);
      const stars = new THREE.Points(
        new THREE.BufferGeometry().setAttribute(
          'position',
          new THREE.Float32BufferAttribute(positions, 3),
        ),
        new THREE.PointsMaterial({
          size: 0.42,
          map: this.texture,
          transparent: true,
          depthWrite: false,
          color: '#d4eaf7',
          blending: THREE.AdditiveBlending,
        }),
      );
      const segments = data.drawing.edges.flatMap(([a, b]) => [
        ...positions.slice(a * 3, a * 3 + 3),
        ...positions.slice(b * 3, b * 3 + 3),
      ]);
      const line = new THREE.LineSegments(
        new THREE.BufferGeometry().setAttribute(
          'position',
          new THREE.Float32BufferAttribute(segments, 3),
        ),
        new THREE.LineBasicMaterial({ color: '#e4f4ff', opacity: 0.8, transparent: true }),
      );
      line.renderOrder = 1;
      stars.renderOrder = 2;
      group.add(line, stars);
      this.scene.add(group);
      this.works.set(data.id, { data, direction: center, group, line, scale, illustration: skyIllustration(data) });
    }
    const ids = new Set(items.map((w) => w.id));
    for (const [id, entry] of this.works)
      if (!ids.has(id)) {
        this.artwork.release(entry);
        entry.group.traverse((o) => {
          o.geometry?.dispose();
          o.material?.dispose();
        });
        this.scene.remove(entry.group);
        this.works.delete(id);
      }
  }
  async capture(video) {
    await this.artwork.ready();
    const canvas = document.createElement('canvas');
    canvas.width = this.renderer.domElement.width;
    canvas.height = this.renderer.domElement.height;
    const ctx = canvas.getContext('2d'),
      w = canvas.width,
      h = canvas.height;
    ctx.fillStyle = '#070e18';
    ctx.fillRect(0, 0, w, h);
    if (video.srcObject && video.readyState >= 2) {
      const scale = Math.max(w / video.videoWidth, h / video.videoHeight);
      ctx.drawImage(
        video,
        (w - video.videoWidth * scale) / 2,
        (h - video.videoHeight * scale) / 2,
        video.videoWidth * scale,
        video.videoHeight * scale,
      );
    }
    this.renderer.render(this.scene, this.camera);
    ctx.drawImage(this.renderer.domElement, 0, 0);
    ctx.fillStyle = '#d1e4ec';
    ctx.font = `${Math.max(14, w * 0.025)}px sans-serif`;
    ctx.fillText('CONSTELLATION · 우리가 남긴 하늘', w * 0.05, h * 0.95);
    const hasLicensedArt = [...this.works.values()].some(entry => entry.artMesh && entry.illustration.art.credit === 'meuris');
    if (hasLicensedArt) {
      ctx.font = `${Math.max(10, w * 0.017)}px sans-serif`;
      ctx.fillText('Art: Johan Meuris / Stellarium · Free Art License 1.3', w * 0.05, h * 0.975, w * 0.9);
    }
    return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  }
  dispose() {
    this.renderer.setAnimationLoop(null);
    this.setWorks([]);
    this.texture.dispose();
    this.renderer.dispose();
    window.removeEventListener('resize', this.resize);
    window.removeEventListener('deviceorientation', this.orientation);
  }
}
