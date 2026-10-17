import * as THREE from 'three';
import { SkyArtwork } from '../exhibition/SkyArtwork.js';
import { skyIllustration } from '../exhibition/sky-art.js';
import { VR_MAX_STARS, VR_MAX_WORKS } from './VRModel.js';
import { StarParticles } from '../scene/StarParticles.js';
import { VRLibrary } from './VRLibrary.js';

const palette = ['#c6e8ff', '#e6cba0', '#d2c3f2', '#9ddbcf'];
function textTexture(text, width = 1024, height = 96) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#c5deeb';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${Math.floor(height * 0.42)}px sans-serif`;
  ctx.fillText(text, width / 2, height / 2, width * 0.94);
  texture.needsUpdate = true;
  return texture;
}
function label(text, width, height) {
  return new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    new THREE.MeshBasicMaterial({
      map: textTexture(text, Math.min(2048, Math.round(128 * width / height)), 128),
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
}

export class VRWorld {
  constructor(container, model, action) {
    this.container = container;
    this.model = model;
    this.action = action;
    this.entries = new Map();
    this.artwork = new SkyArtwork();
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#040913');
    this.camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.03, 90);
    this.camera.position.set(0, 1.6, 0);
    this.scene.add(this.camera);
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.xr.enabled = true;
    this.renderer.xr.setReferenceSpaceType('local-floor');
    this.renderer.xr.setFoveation(1);
    container.append(this.renderer.domElement);
    this.scene.add(new THREE.HemisphereLight('#d5eaff', '#273044', 2));
    this.starTexture = this.makeStarTexture();
    this.makeEnvironment();
    this.makePanel();
    this.library = new VRLibrary(this.camera, this.starTexture, label);
    this.particles = new StarParticles(this.scene, { reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches });
    this.effect = e => this.particles.emit(e.detail.point, { kind: e.detail.kind });
    model.addEventListener('star-effect', this.effect);
    this.resize = () => {
      this.camera.aspect = innerWidth / innerHeight;
      this.camera.updateProjectionMatrix();
      if (!this.renderer.xr.isPresenting) this.renderer.setSize(innerWidth, innerHeight);
    };
    window.addEventListener('resize', this.resize);
    this.change = (e) => this.sync(e.detail.entity);
    model.addEventListener('change', this.change);
    this.sync();
  }
  makeStarTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext('2d'),
      g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, '#fff');
    g.addColorStop(0.07, '#fff');
    g.addColorStop(0.2, '#b5dfffaa');
    g.addColorStop(1, '#b5dfff00');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(canvas);
  }
  makeEnvironment() {
    let seed = 4821;
    const random = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
    const positions = [],
      colors = [];
    for (let i = 0; i < 3200; i++) {
      const yaw = random() * Math.PI * 2,
        y = random() * 2 - 1,
        r = 18 + random() * 43,
        s = Math.sqrt(1 - y * y);
      positions.push(Math.cos(yaw) * s * r, y * r + 1.6, Math.sin(yaw) * s * r);
      const color = new THREE.Color(palette[i % 4]).multiplyScalar(0.5 + random() * 0.5);
      colors.push(color.r, color.g, color.b);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    this.scene.add(
      new THREE.Points(
        geometry,
        new THREE.PointsMaterial({
          size: 0.11,
          map: this.starTexture,
          vertexColors: true,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      ),
    );
    // Nearby dust and floor rings give head movement a visible depth reference.
    const dust = Float32Array.from({ length: 240 }, (_, i) =>
      i % 3 === 1 ? 0.25 + random() * 3 : (random() - 0.5) * 7,
    );
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.BufferAttribute(dust, 3));
    this.scene.add(
      new THREE.Points(
        dg,
        new THREE.PointsMaterial({
          size: 0.015,
          color: '#6b92b1',
          map: this.starTexture,
          transparent: true,
          opacity: 0.45,
          depthWrite: false,
        }),
      ),
    );
    for (const radius of [1.1, 2.2, 3.6, 6, 8.4]) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(radius, radius + 0.008, 128),
        new THREE.MeshBasicMaterial({
          color: '#41647f',
          transparent: true,
          opacity: radius > 3 ? 0.13 : 0.26,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.015;
      this.scene.add(ring);
    }
    const grid = new THREE.GridHelper(20, 40, '#233b53', '#0c1a2a');
    grid.material.transparent = true;
    grid.material.opacity = 0.24;
    this.scene.add(grid);
  }
  makePanel() {
    this.panel = new THREE.Group();
    this.panel.position.set(0, -0.39, -0.95);
    this.camera.add(this.panel);
    const background = new THREE.Mesh(
      new THREE.PlaneGeometry(1.02, 0.29),
      new THREE.MeshBasicMaterial({
        color: '#091725',
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
      }),
    );
    background.position.z = -0.004;
    this.panel.add(background);
    this.panelTitle = label('', 0.96, 0.09);
    this.panelTitle.position.y = 0.07;
    this.panel.add(this.panelTitle);
    this.buttons = [];
    for (const [i, [id, text]] of [
      ['finish', '완성해서 띄우기'],
      ['undo', '되돌리기'],
      ['library', '별자리 도감'],
      ['exit', 'VR 나가기'],
    ].entries()) {
      const mesh = label(text, 0.235, 0.08);
      mesh.position.set((i - 1.5) * 0.248, -0.045, 0);
      mesh.userData.action = id;
      this.panel.add(mesh);
      this.buttons.push(mesh);
    }
    this.panelNote = label('주먹 1초 · 생성  /  집어서 이동  /  좌우로 흔들어 삭제', 0.94, 0.065);
    this.panelNote.position.y = -0.105;
    this.panel.add(this.panelNote);
    this.raycaster = new THREE.Raycaster();
  }
  actionAt(origin, direction) {
    const group = this.library.visible ? this.library.group : this.panel;
    if (!group.visible) return null;
    group.updateWorldMatrix(true, true);
    this.raycaster.set(origin, direction);
    return this.raycaster.intersectObjects(this.library.visible ? this.library.buttons : this.buttons, false)[0]?.object.userData.action || null;
  }
  updatePanel() {
    const title = `${this.model.draft.shapeId ? `${this.model.draft.title} 발견` : 'VR 우주'}  ·  ${this.model.works.length}/${VR_MAX_WORKS} 별자리  ·  ${this.model.draft.stars.length}/${VR_MAX_STARS} 별`;
    if (title !== this.panelText) {
      this.panelTitle.material.map.dispose();
      this.panelTitle.material.map = textTexture(title);
      this.panelText = title;
    }
  }
  sync(changedId = null) {
    const entities = this.model.entities,
      ids = new Set(entities.map((e) => e.id));
    for (const [id, entry] of this.entries)
      if (!ids.has(id)) {
        this.disposeEntry(entry);
        this.entries.delete(id);
      }
    for (const entity of entities) {
      if (changedId && changedId !== entity.id) continue;
      let entry = this.entries.get(entity.id);
      if (!entry) {
        const group = new THREE.Group(),
          geometry = new THREE.BufferGeometry();
        geometry.setAttribute(
          'position',
          new THREE.BufferAttribute(new Float32Array(VR_MAX_STARS * 3), 3).setUsage(
            THREE.DynamicDrawUsage,
          ),
        );
        const color = palette[this.model.works.indexOf(entity) % palette.length] || palette[0];
        const stars = new THREE.Points(
          geometry,
          new THREE.PointsMaterial({
            size: entity === this.model.draft ? 0.035 : 0.09,
            color,
            map: this.starTexture,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
          }),
        );
        stars.frustumCulled = false;
        stars.renderOrder = 2;
        const lg = new THREE.BufferGeometry();
        lg.setAttribute(
          'position',
          new THREE.BufferAttribute(
            new Float32Array(VR_MAX_STARS * (VR_MAX_STARS - 1) * 3),
            3,
          ).setUsage(THREE.DynamicDrawUsage),
        );
        const line = new THREE.LineSegments(
          lg,
          new THREE.LineBasicMaterial({
            color,
            transparent: true,
            opacity: 0.45,
            depthWrite: false,
          }),
        );
        line.frustumCulled = false;
        line.renderOrder = 1;
        group.add(stars, line);
        this.scene.add(group);
        entry = { group, stars, line, scale: 1, direction: new THREE.Vector3() };
        this.entries.set(entity.id, entry);
      }
      entry.group.position.copy(entity.position);
      entry.group.quaternion.copy(entity.quaternion);
      entry.group.scale.setScalar(entity.scale);
      entry.stars.material.size = entity === this.model.draft ? 0.035 : 0.09;
      const attr = entry.stars.geometry.attributes.position;
      entity.stars.forEach((s, i) => attr.setXYZ(i, s.x, s.y, s.z));
      attr.needsUpdate = true;
      entry.stars.geometry.setDrawRange(0, entity.stars.length);
      const la = entry.line.geometry.attributes.position;
      entity.edges.forEach(([a, b], i) => {
        const p = entity.stars[a],
          q = entity.stars[b];
        if (p && q) {
          la.setXYZ(i * 2, p.x, p.y, p.z);
          la.setXYZ(i * 2 + 1, q.x, q.y, q.z);
        }
      });
      la.needsUpdate = true;
      entry.line.geometry.setDrawRange(0, entity.edges.length * 2);
      const title = entity !== this.model.draft || entity.shapeId ? entity.title : '';
      if (title !== entry.title || entry.isDraft !== (entity === this.model.draft)) {
        if (entry.label) {
          entry.group.remove(entry.label);
          entry.label.geometry.dispose();
          entry.label.material.map.dispose();
          entry.label.material.dispose();
        }
        entry.label = title ? label(title, entity === this.model.draft ? .8 : 1.65, entity === this.model.draft ? .11 : .23) : null;
        if (entry.label) {
          entry.label.position.y = -1.14;
          entry.group.add(entry.label);
        }
        entry.title = title;
        entry.isDraft = entity === this.model.draft;
      }
      if (entry.label && entity.stars.length) {
        const xs = entity.stars.map(s => s.x), ys = entity.stars.map(s => s.y);
        entry.label.position.set((Math.min(...xs) + Math.max(...xs)) / 2,
          entity === this.model.draft ? Math.max(...ys) + .14 : Math.min(...ys) - .18, 0);
      }
      entry.center = entity.stars.reduce((sum, s) => sum.add(new THREE.Vector3(s.x, s.y, s.z)), new THREE.Vector3())
        .divideScalar(entity.stars.length || 1);
      if (entry.label) entry.label.position.z = entry.center.z;
      const artTitle = entity.shapeId && !entity.editing ? entity.title : null;
      if (artTitle !== entry.artTitle) {
        this.artwork.release(entry);
        entry.artFailed = false;
        entry.artTitle = artTitle;
        entry.illustration = artTitle ? skyIllustration({ title: artTitle }) : null;
      }
      entry.data = {
        title: entity.title,
        drawing: { stars: entity.stars.map((s) => ({ x: s.x, y: s.y })), edges: entity.edges },
      };
    }
  }
  frame(now) {
    const xr = this.renderer.xr.isPresenting;
    this.panel.visible = xr && !this.library.visible;
    const camera = xr ? this.renderer.xr.getCamera() : this.camera,
      head = camera.getWorldPosition(new THREE.Vector3()),
      forward = camera.getWorldDirection(new THREE.Vector3());
    this.particles.update(now / 1000);
    this.library.update(now / 1000, forward);
    for (const entry of this.entries.values()) {
      entry.group.updateWorldMatrix(true, false);
      entry.direction.copy(entry.center).applyMatrix4(entry.group.matrixWorld).sub(head).normalize();
      if (entry.artMesh) entry.artMesh.position.z = entry.center.z - .02;
    }
    this.artwork.update(
      this.entries,
      { fov: xr ? 100 : this.camera.fov, aspect: this.camera.aspect },
      forward,
      now / 1000,
    );
  }
  disposeEntry(entry) {
    this.artwork.release(entry);
    this.scene.remove(entry.group);
    entry.group.traverse((o) => {
      o.geometry?.dispose();
      if (o.material) {
        o.material.map?.isTexture &&
          o.material.map !== this.starTexture &&
          o.material.map.dispose();
        o.material.dispose();
      }
    });
  }
  dispose() {
    this.renderer.setAnimationLoop(null);
    this.model.removeEventListener('change', this.change);
    this.model.removeEventListener('star-effect', this.effect);
    this.library.dispose();
    this.particles.dispose();
    window.removeEventListener('resize', this.resize);
    for (const entry of this.entries.values()) this.disposeEntry(entry);
    this.entries.clear();
    this.scene.traverse((o) => {
      o.geometry?.dispose();
      if (o.material) {
        o.material.map?.dispose();
        o.material.dispose();
      }
    });
    this.renderer.dispose();
  }
}
