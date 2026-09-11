import * as THREE from 'three';
import { CONFIG, asset } from '../config.js';
import {
  skyVertex,
  skyFragment,
  starVertex,
  starFragment,
  artVertex,
  artFragment,
} from './shaders.js';
import { transformPoint } from '../recognition/matcher.js';

export class Universe {
  constructor(container, onError) {
    this.container = container;
    this.onError = onError;
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setClearColor(0x070b13);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.append(this.renderer.domElement);
    this.renderer.domElement.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.renderer.setAnimationLoop(null);
      onError();
    });
    this.renderer.domElement.addEventListener('webglcontextrestored', () => location.reload());
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 8000);
    this.clock = 0;
    this.lastTime = 0;
    this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.artOpacity = 0.32;
    this.artFade = 0;
    this.artTarget = 0;
    this.quality = 'auto';
    this.starData = [];
    this.edgeData = [];
    this.reveal = 1;
    this.bursts = [];
    this.resize();
    this.makeSky();
    this.makeStars();
    this.makeDrawing();
    this.makeArt();
    this.makePresence();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
  }

  makeSky() {
    const uniforms = {
      uSky: { value: null },
      uTime: { value: 0 },
      uAspect: { value: this.width / this.height },
      uBrightness: { value: 0.65 },
    };
    this.skyMaterial = new THREE.ShaderMaterial({
      vertexShader: skyVertex,
      fragmentShader: skyFragment,
      uniforms,
      depthTest: false,
      depthWrite: false,
    });
    const sky = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.skyMaterial);
    sky.frustumCulled = false;
    sky.renderOrder = -100;
    this.scene.add(sky);
    new THREE.TextureLoader().load(
      asset('art/milky-way.jpg'),
      (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        this.skyMaterial.uniforms.uSky.value = texture;
      },
      undefined,
      () => this.onError('은하수 사진을 불러오지 못해 별빛 배경으로 표시합니다.'),
    );
  }

  pointMaterial(sparkle = 0, opacity = 1) {
    return new THREE.ShaderMaterial({
      vertexShader: starVertex,
      fragmentShader: starFragment,
      uniforms: {
        uTime: { value: 0 },
        uPixelRatio: { value: this.renderer.getPixelRatio() },
        uDepth: { value: this.camera.position.z },
        uOpacity: { value: opacity },
        uSparkle: { value: sparkle },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
  }

  makeStars() {
    const n = CONFIG.particleCount;
    const positions = new Float32Array(n * 3),
      sizes = new Float32Array(n),
      phases = new Float32Array(n),
      colors = new Float32Array(n * 3);
    let seed = 41287;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let i = 0; i < n; i++) {
      const x = (random() - 0.5) * 6500;
      const y =
        i < n * 0.48
          ? x * 0.25 + (random() + random() + random() - 1.5) * 480
          : (random() - 0.5) * 3900;
      positions.set([x, y, -random() * 2400 - 20], i * 3);
      sizes[i] = random() < 0.985 ? 2 + random() * 5 : 13 + random() * 15;
      phases[i] = random() * Math.PI * 2;
      const c = random();
      colors.set(c > 0.9 ? [1, 0.79, 0.55] : c > 0.55 ? [0.73, 0.85, 1] : [0.9, 0.95, 1], i * 3);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
    geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    this.backgroundStars = new THREE.Points(geometry, this.pointMaterial(0.6, 0.85));
    this.backgroundStars.frustumCulled = false;
    this.scene.add(this.backgroundStars);
  }

  makeDrawing() {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(CONFIG.maxStars * 3), 3),
    );
    geometry.setAttribute(
      'aSize',
      new THREE.BufferAttribute(new Float32Array(CONFIG.maxStars).fill(55), 1),
    );
    geometry.setAttribute(
      'aPhase',
      new THREE.BufferAttribute(
        Float32Array.from({ length: CONFIG.maxStars }, (_, i) => i * 1.83),
        1,
      ),
    );
    geometry.setAttribute(
      'aColor',
      new THREE.BufferAttribute(new Float32Array(CONFIG.maxStars * 3).fill(1), 3),
    );
    geometry.setDrawRange(0, 0);
    this.drawingStars = new THREE.Points(geometry, this.pointMaterial(1, 1));
    this.drawingStars.frustumCulled = false;
    this.drawingStars.renderOrder = 3;
    this.scene.add(this.drawingStars);
    this.lines = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({
        color: 0xc0d6ea,
        transparent: true,
        opacity: 0.52,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 2;
    this.scene.add(this.lines);
    const ring = new THREE.RingGeometry(15, 15.7, 64);
    this.selection = new THREE.Mesh(
      ring,
      new THREE.MeshBasicMaterial({
        color: 0xc6e6ed,
        transparent: true,
        opacity: 0.6,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    this.selection.visible = false;
    this.selection.position.z = 4;
    this.scene.add(this.selection);
    this.ringGeometry = new THREE.RingGeometry(1, 1.013, 96);
  }

  makeArt() {
    this.artMaterial = new THREE.ShaderMaterial({
      vertexShader: artVertex,
      fragmentShader: artFragment,
      uniforms: {
        uAtlas: { value: null },
        uTile: { value: new THREE.Vector2(0, 3) },
        uOpacity: { value: 0 },
        uTime: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.art = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.artMaterial);
    this.art.position.z = -3;
    this.art.renderOrder = 0;
    this.art.frustumCulled = false;
    this.scene.add(this.art);
    new THREE.TextureLoader().load(
      asset('art/celestial-atlas.png'),
      (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
        this.artMaterial.uniforms.uAtlas.value = texture;
      },
      undefined,
      () => this.onError('삽화를 불러오지 못했습니다. 새로고침해 주세요.'),
    );
    this.orbits = new THREE.Group();
    const orbitMaterial = new THREE.LineDashedMaterial({
      color: 0x779eae,
      transparent: true,
      opacity: 0.1,
      dashSize: 0.002,
      gapSize: 0.014,
      depthWrite: false,
    });
    for (const r of [0.5, 0.57]) {
      const points = Array.from(
        { length: 181 },
        (_, i) =>
          new THREE.Vector3(
            Math.cos((i / 180) * Math.PI * 2) * r,
            Math.sin((i / 180) * Math.PI * 2) * r,
            0,
          ),
      );
      const ring = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), orbitMaterial);
      ring.computeLineDistances();
      this.orbits.add(ring);
    }
    this.scene.add(this.orbits);
  }

  resize() {
    this.width = this.container.clientWidth;
    this.height = this.container.clientHeight;
    this.camera.aspect = this.width / this.height;
    this.camera.position.z = this.height / (2 * Math.tan((25 * Math.PI) / 180));
    this.camera.updateProjectionMatrix();
    const cap =
      this.quality === 'low' ? 1 : this.quality === 'high' ? 2 : this.width < 760 ? 1.25 : 1.5;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, cap));
    this.renderer.setSize(this.width, this.height);
    if (this.skyMaterial) this.skyMaterial.uniforms.uAspect.value = this.width / this.height;
    for (const obj of [this.backgroundStars, this.drawingStars])
      if (obj) {
        obj.material.uniforms.uPixelRatio.value = this.renderer.getPixelRatio();
        obj.material.uniforms.uDepth.value = this.camera.position.z;
      }
    if (this.backgroundStars)
      this.backgroundStars.geometry.setDrawRange(
        0,
        this.quality === 'low' ? 4000 : CONFIG.particleCount,
      );
    if (this.drawingStars) this.syncDrawing();
    if (this.artMatch) this.positionArt();
  }

  // The drawing is stored in viewport-normalized coordinates for resizing.
  toWorld(p) {
    return { x: (p.x - 0.5) * this.width, y: (0.5 - p.y) * this.height };
  }
  setDrawing(stars, edges, selected = null, reveal = false) {
    this.starData = stars;
    this.edgeData = edges;
    this.selected = selected;
    if (reveal) this.reveal = this.reducedMotion ? 1 : 0;
    this.syncDrawing();
  }
  syncDrawing() {
    const attr = this.drawingStars.geometry.attributes;
    this.starData.forEach((p, i) => {
      const w = this.toWorld(p);
      attr.position.setXYZ(i, w.x, w.y, 0);
      attr.aSize.setX(i, p.id === this.selected ? 70 : 53 + (i % 3) * 7);
      attr.aColor.setXYZ(i, 0.9, 0.96, 1);
    });
    attr.position.needsUpdate = true;
    attr.aSize.needsUpdate = true;
    attr.aColor.needsUpdate = true;
    this.drawingStars.geometry.setDrawRange(0, this.starData.length);
    const coords = [];
    const byId = new Map(this.starData.map((p) => [p.id, p]));
    for (const [a, b] of this.edgeData) {
      if (!byId.has(a) || !byId.has(b)) continue;
      const p = this.toWorld(byId.get(a)),
        q = this.toWorld(byId.get(b));
      coords.push(p.x, p.y, 1, q.x, q.y, 1);
    }
    this.lines.geometry.dispose();
    this.lines.geometry = new THREE.BufferGeometry();
    this.lines.geometry.setAttribute('position', new THREE.Float32BufferAttribute(coords, 3));
    this.lines.geometry.setDrawRange(0, Math.floor(this.edgeData.length * this.reveal) * 2);
    const selected = byId.get(this.selected);
    this.selection.visible = !!selected;
    if (selected) {
      const p = this.toWorld(selected);
      this.selection.position.set(p.x, p.y, 4);
    }
  }

  showArt(match, coordinateSpace = 'normalized') {
    this.artMatch = structuredClone(match);
    this.artCoordinateSpace = coordinateSpace;
    this.artMaterial.uniforms.uTile.value.set(
      match.shape.tile % 4,
      3 - Math.floor(match.shape.tile / 4),
    );
    this.artFade = 0;
    this.artTarget = 1;
    this.positionArt();
  }
  positionArt() {
    const t = this.artMatch.transform;
    const center = transformPoint({ x: 0, y: 0 }, t);
    // Match coordinates are normalized in height units (x also divided by H).
    const unit = this.artCoordinateSpace === 'normalized' ? this.height : 1;
    const x = center.x * unit - this.width / 2;
    const y = center.y * unit + this.height / 2;
    const size = t.scale * 2.25 * unit;
    this.art.position.set(x, y, -3);
    this.art.scale.set(size * t.mirror, size, 1);
    this.art.rotation.z = t.angle;
    this.orbits.position.set(x, y, -4);
    this.orbits.scale.setScalar(size * 1.06);
  }
  hideArt() {
    this.artTarget = 0;
    this.artMatch = null;
  }
  burst(point, strength = 1) {
    if (this.reducedMotion || this.bursts.length > 10) return;
    const material = new THREE.MeshBasicMaterial({
      color: 0xb8ddea,
      transparent: true,
      opacity: 0.3,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(this.ringGeometry, material);
    const p = this.toWorld(point);
    mesh.position.set(p.x, p.y, 3);
    this.scene.add(mesh);
    this.bursts.push({ mesh, age: 0, strength });
  }
  start(onFrame) {
    this.renderer.setAnimationLoop((now) => {
      const dt = Math.min(0.05, (now - (this.lastTime || now)) / 1000);
      this.lastTime = now;
      if (document.hidden) return;
      if (!this.reducedMotion) this.clock += dt;
      onFrame?.(dt, now);
      this.tickPresence(dt);
      this.skyMaterial.uniforms.uTime.value = this.clock;
      for (const obj of [this.backgroundStars, this.drawingStars])
        obj.material.uniforms.uTime.value = this.clock;
      this.backgroundStars.rotation.z = Math.sin(this.clock * 0.008) * 0.006;
      this.artFade +=
        (this.artTarget - this.artFade) * (this.reducedMotion ? 1 : Math.min(1, dt * 1.3));
      this.artMaterial.uniforms.uOpacity.value = this.artOpacity * this.artFade;
      this.artMaterial.uniforms.uTime.value = this.clock;
      this.orbits.visible = this.artFade > 0.05;
      if (this.reveal < 1) {
        this.reveal = Math.min(1, this.reveal + dt * 0.65);
        this.lines.geometry.setDrawRange(0, Math.floor(this.edgeData.length * this.reveal) * 2);
      }
      for (let i = this.bursts.length - 1; i >= 0; i--) {
        const b = this.bursts[i];
        b.age += dt;
        b.mesh.scale.setScalar(8 + b.age * 150 * b.strength);
        b.mesh.material.opacity = 0.2 * (1 - b.age / 1.8);
        if (b.age >= 1.8) {
          this.scene.remove(b.mesh);
          b.mesh.material.dispose();
          this.bursts.splice(i, 1);
        }
      }
      this.renderer.render(this.scene, this.camera);
    });
  }
  // A small, separate layer of ambient particles that visitors never edit
  // directly. It gently gathers toward people the pose tracker detects
  // (PRESENCE_FREE), permanently marks a footpath of stars for anyone who
  // simply walked through the space without gesturing (PRESENCE_TRAIL), and
  // briefly borrows a batch of its particles to trace a held pose
  // (PRESENCE_SILHOUETTE). Kept deliberately small (see CONFIG.presenceCount)
  // so multi-visitor tracking never competes with the interactive star budget.
  makePresence() {
    const n = CONFIG.presenceCount;
    const positions = new Float32Array(n * 3),
      sizes = new Float32Array(n),
      phases = new Float32Array(n),
      colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      positions.set(
        [(Math.random() - 0.5) * this.width, (Math.random() - 0.5) * this.height, -80 - i * 0.4],
        i * 3,
      );
      sizes[i] = 3;
      phases[i] = Math.random() * Math.PI * 2;
      colors.set([0.78, 0.86, 1], i * 3);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
    geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    this.presenceStars = new THREE.Points(geometry, this.pointMaterial(0.5, 0.7));
    this.presenceStars.frustumCulled = false;
    this.scene.add(this.presenceStars);
    this.presenceVelocity = new Float32Array(n * 2);
    // 0 = free-drifting, 1 = a passer-by's permanent footstep, 2 = briefly on loan to a silhouette.
    this.presenceState = new Uint8Array(n);
    this.presenceCursor = 0;
    this.presencePeople = [];
    this.bridgeLines = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({
        color: 0x9fc7ff,
        transparent: true,
        opacity: 0.4,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.bridgeLines.frustumCulled = false;
    this.scene.add(this.bridgeLines);
    this.flashLayer = document.createElement('div');
    this.flashLayer.className = 'universe-flash';
    this.container.append(this.flashLayer);
  }
  // Presence updates arrive at the pose tracker's cadence (a handful of times a
  // second); the drift itself is interpolated every rendered frame so it stays smooth.
  setPresence(people) {
    this.presencePeople = people;
  }
  setBridges(pairs) {
    if (!this.bridgeLines) return;
    if (!pairs.length) {
      this.bridgeLines.geometry.setDrawRange(0, 0);
      return;
    }
    const positions = new Float32Array(pairs.length * 6);
    pairs.forEach(({ a, b }, i) => {
      const pa = this.toWorld(a),
        pb = this.toWorld(b);
      positions.set([pa.x, pa.y, 0, pb.x, pb.y, 0], i * 6);
    });
    this.bridgeLines.geometry.dispose();
    this.bridgeLines.geometry = new THREE.BufferGeometry();
    this.bridgeLines.geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    this.bridgeLines.geometry.setDrawRange(0, pairs.length * 2);
  }
  // Recycles the oldest presence slot into a permanent, gently glowing footstep.
  spawnTrail(point) {
    if (!this.presenceStars) return;
    const attr = this.presenceStars.geometry.attributes;
    const i = this.presenceCursor;
    this.presenceCursor = (this.presenceCursor + 1) % attr.position.count;
    const w = this.toWorld(point);
    attr.position.setXYZ(i, w.x, w.y, -30);
    attr.aSize.setX(i, 5);
    attr.aColor.setXYZ(i, 0.9, 0.95, 1);
    this.presenceState[i] = 1;
    attr.position.needsUpdate = true;
    attr.aSize.needsUpdate = true;
    attr.aColor.needsUpdate = true;
  }
  // Borrows a batch of presence slots to trace a held pose's keypoints, then
  // releases them back to free drift once CONFIG.poseSilhouetteDuration elapses.
  revealSilhouette(points) {
    if (!this.presenceStars || !points?.length || this.reducedMotion) return;
    const n = this.presenceStars.geometry.attributes.position.count;
    const count = Math.min(points.length, n);
    const slots = [];
    for (let i = 0; i < count; i++) {
      const slot = (this.presenceCursor + i) % n;
      slots.push(slot);
      this.presenceState[slot] = 2;
    }
    this.presenceCursor = (this.presenceCursor + count) % n;
    this.silhouette = { points: points.slice(0, count), slots, until: this.clock + CONFIG.poseSilhouetteDuration };
    this.flashLayer.classList.remove('flash-active');
    void this.flashLayer.offsetWidth;
    this.flashLayer.classList.add('flash-active');
  }
  tickPresence(dt) {
    if (!this.presenceStars) return;
    const attr = this.presenceStars.geometry.attributes;
    const n = attr.position.count;
    if (this.silhouette) {
      const t = 1 - Math.max(0, (this.silhouette.until - this.clock) / CONFIG.poseSilhouetteDuration);
      this.silhouette.slots.forEach((slot, i) => {
        const target = this.toWorld(this.silhouette.points[i]);
        const x = attr.position.getX(slot),
          y = attr.position.getY(slot);
        const ease = Math.min(1, dt * 4);
        attr.position.setXYZ(slot, x + (target.x - x) * ease, y + (target.y - y) * ease, 6);
        attr.aSize.setX(slot, 7);
        attr.aColor.setXYZ(slot, 1, 1, 1);
      });
      if (this.clock >= this.silhouette.until) {
        for (const slot of this.silhouette.slots) this.presenceState[slot] = 0;
        this.silhouette = null;
      }
    }
    for (let i = 0; i < n; i++) {
      if (this.presenceState[i]) continue;
      let x = attr.position.getX(i),
        y = attr.position.getY(i);
      let vx = this.presenceVelocity[i * 2],
        vy = this.presenceVelocity[i * 2 + 1];
      let fx = (Math.random() - 0.5) * 4,
        fy = (Math.random() - 0.5) * 4;
      for (const person of this.presencePeople) {
        const w = this.toWorld(person);
        const dx = w.x - x,
          dy = w.y - y;
        const d = Math.hypot(dx, dy) + 60;
        const pull = (person.quiet ? 900 : 220) / d;
        fx += (dx / d) * pull;
        fy += (dy / d) * pull;
      }
      vx = vx * 0.9 + fx * dt;
      vy = vy * 0.9 + fy * dt;
      x += vx * dt;
      y += vy * dt;
      const halfW = this.width / 2 + 60,
        halfH = this.height / 2 + 60;
      if (x < -halfW) x = halfW;
      if (x > halfW) x = -halfW;
      if (y < -halfH) y = halfH;
      if (y > halfH) y = -halfH;
      this.presenceVelocity[i * 2] = vx;
      this.presenceVelocity[i * 2 + 1] = vy;
      attr.position.setXYZ(i, x, y, -80 - (i % 40) * 0.4);
      attr.aSize.setX(i, 3);
      attr.aColor.setXYZ(i, 0.78, 0.86, 1);
    }
    attr.position.needsUpdate = true;
    attr.aSize.needsUpdate = true;
    attr.aColor.needsUpdate = true;
  }
  async capture(title) {
    this.renderer.render(this.scene, this.camera);
    const source = this.renderer.domElement;
    const canvas = document.createElement('canvas');
    canvas.width = source.width;
    canvas.height = source.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(source, 0, 0);
    const ratio = this.renderer.getPixelRatio();
    ctx.fillStyle = '#c7d9e4';
    ctx.font = `${18 * ratio}px Georgia`;
    ctx.fillText('constellation. / ' + title, 28 * ratio, canvas.height - 42 * ratio);
    ctx.fillStyle = '#8ea2b3';
    ctx.font = `${9 * ratio}px sans-serif`;
    ctx.fillText(
      'Sky: ESO/S. Brunier · Celestial art: AI generated',
      28 * ratio,
      canvas.height - 22 * ratio,
    );
    return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  }
  dispose() {
    this.renderer.setAnimationLoop(null);
    this.resizeObserver.disconnect();
    this.scene.traverse((obj) => {
      obj.geometry?.dispose();
      if (obj.material) {
        for (const u of Object.values(obj.material.uniforms || {}))
          if (u.value?.isTexture) u.value.dispose();
        obj.material.dispose();
      }
    });
    this.renderer.dispose();
  }
}
