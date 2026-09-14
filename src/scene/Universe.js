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
import { artwork } from '../data/art.js';

// How much larger the illustration is than the star shape's own spread, and
// the constant on-screen size (in CSS pixels) it holds to once the camera
// starts easing back to compensate for a wide placement. See positionArt().
const ART_SIZE_MULTIPLIER = 2.5;
const ART_TARGET_PX = 430;
// Segments drawn per second during the connection reveal — a constant pace
// regardless of how many segments a shape has, so a simple shape doesn't
// linger and a complex one doesn't rush past as one blur.
const SEGMENT_REVEAL_RATE = 5.5;

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
    this.lineOpacity = 1;
    this.lineFadeTarget = 1;
    this.zoom = 1;
    this.zoomTarget = 1;
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
    this.lineBaseOpacity = 0.52;
    this.lines = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({
        color: 0xc0d6ea,
        transparent: true,
        opacity: this.lineBaseOpacity,
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
    this.artTextures = new Map();
    this.artPending = new Map();
    this.artRequest = 0;
    this.artMaterial = new THREE.ShaderMaterial({
      vertexShader: artVertex,
      fragmentShader: artFragment,
      uniforms: {
        uAtlas: { value: null },
        uTile: { value: new THREE.Vector2(0, 3) },
        uGrid: { value: 4 },
        uRect: { value: new THREE.Vector4(0, 0.75, 0.25, 0.25) },
        uExposure: { value: 1 },
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
    this.baseCameraZ = this.height / (2 * Math.tan((25 * Math.PI) / 180));
    this.camera.position.z = this.baseCameraZ * this.zoom;
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
    // On a fresh reveal, trace the connections outward from the star the
    // visitor last placed or moved, one continuous direction at a time,
    // instead of drawing them in whatever order the shape data happens to
    // list them.
    this.edgeData = reveal ? this.traceFrom(edges, selected) : edges;
    this.selected = selected;
    if (reveal) {
      this.reveal = this.reducedMotion ? 1 : 0;
      this.lineFadeTarget = 1;
      this.lineOpacity = 1;
    }
    this.syncDrawing();
  }
  // A depth-first walk of the star graph starting at `anchorId` (falling back
  // to the first star): it fully follows one branch before backtracking to
  // the next, so a closed shape traces all the way around in a single
  // direction and a branching one (e.g. Orion) completes one limb before
  // moving to another, rather than several unrelated segments growing at
  // once. Any edge the walk can't reach (a separate, disconnected cluster of
  // stars) is appended at the end so nothing goes undrawn.
  traceFrom(edges, anchorId) {
    if (edges.length < 2) return edges;
    const knownStars = new Set(this.starData.map((s) => s.id));
    const anchor = anchorId && knownStars.has(anchorId) ? anchorId : edges[0][0];
    const adjacency = new Map();
    edges.forEach(([a, b], index) => {
      for (const id of [a, b]) {
        if (!adjacency.has(id)) adjacency.set(id, []);
        adjacency.get(id).push(index);
      }
    });
    const visitedEdges = new Set();
    const visitedNodes = new Set([anchor]);
    const ordered = [];
    const stack = [anchor];
    while (stack.length) {
      const node = stack.pop();
      for (const index of adjacency.get(node) || []) {
        if (visitedEdges.has(index)) continue;
        visitedEdges.add(index);
        const [a, b] = edges[index];
        const next = a === node ? b : a;
        // Normalized to [from, to] in walk order, not however the shape data
        // happened to list the pair — so the growing-line animation always
        // draws outward from the star just visited, never backward.
        ordered.push([node, next]);
        if (!visitedNodes.has(next)) {
          visitedNodes.add(next);
          stack.push(next);
        }
      }
    }
    edges.forEach((edge, index) => {
      if (!visitedEdges.has(index)) ordered.push(edge);
    });
    return ordered;
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
    const byId = new Map(this.starData.map((p) => [p.id, p]));
    this.lineSegments = [];
    for (const [a, b] of this.edgeData) {
      if (!byId.has(a) || !byId.has(b)) continue;
      this.lineSegments.push({ p: this.toWorld(byId.get(a)), q: this.toWorld(byId.get(b)) });
    }
    this.lines.geometry.dispose();
    this.lines.geometry = new THREE.BufferGeometry();
    this.lines.geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(this.lineSegments.length * 6), 3),
    );
    this.lines.geometry.setDrawRange(0, this.lineSegments.length * 2);
    this.applyLineReveal();
    const selected = byId.get(this.selected);
    this.selection.visible = !!selected;
    if (selected) {
      const p = this.toWorld(selected);
      this.selection.position.set(p.x, p.y, 4);
    }
  }
  // Draws each segment growing from its start star to its end star — a pen
  // tracing the shape — rather than whole segments blinking in one at a
  // time. `this.reveal` (0..1) is spread across every segment in order, so
  // only the current one is ever mid-growth; finished segments hold their
  // full length and untouched ones stay collapsed to a point (invisible).
  applyLineReveal() {
    const attr = this.lines.geometry.attributes.position;
    if (!attr || !this.lineSegments) return;
    const progress = this.reveal * this.lineSegments.length;
    this.lineSegments.forEach(({ p, q }, i) => {
      const t = Math.max(0, Math.min(1, progress - i));
      attr.setXYZ(i * 2, p.x, p.y, 1);
      attr.setXYZ(i * 2 + 1, p.x + (q.x - p.x) * t, p.y + (q.y - p.y) * t, 1);
    });
    attr.needsUpdate = true;
  }

  showArt(match, coordinateSpace = 'normalized') {
    this.artMatch = structuredClone(match);
    this.artCoordinateSpace = coordinateSpace;
    const art = artwork(match.shape);
    const request = ++this.artRequest;
    this.artFade = 0;
    this.artTarget = 0;
    this.artMaterial.uniforms.uOpacity.value = 0;
    this.artReady = this.loadArtTexture(art.src)
      .then((texture) => {
        if (this.disposed || request !== this.artRequest) return;
        this.artMaterial.uniforms.uAtlas.value = texture;
        this.artMaterial.uniforms.uGrid.value = art.grid;
        const { x, y, w, h } = art.rect;
        this.artMaterial.uniforms.uRect.value.set(x, 1 - y - h, w, h);
        this.artMaterial.uniforms.uExposure.value = art.credit === 'meuris' ? 2.1 : 1;
        this.artMaterial.uniforms.uTile.value.set(
          art.tile % art.grid,
          art.grid - 1 - Math.floor(art.tile / art.grid),
        );
        this.artTarget = 1;
        // Only retain a small working set as visitors browse all 88 figures.
        this.pruneArtTextures(texture);
      })
      .catch(() => {
        if (request === this.artRequest && !this.disposed)
          this.onError('삽화를 불러오지 못했어요. 도감에서 다시 선택해 주세요.');
      });
    this.positionArt();
  }
  loadArtTexture(src) {
    if (this.artTextures.has(src)) {
      const texture = this.artTextures.get(src);
      this.artTextures.delete(src);
      this.artTextures.set(src, texture);
      return Promise.resolve(texture);
    }
    if (this.artPending.has(src)) return this.artPending.get(src);
    const promise = new THREE.TextureLoader()
      .loadAsync(asset(src))
      .then((texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
        if (this.disposed) texture.dispose();
        else {
          this.artTextures.set(src, texture);
          this.pruneArtTextures(texture);
        }
        return texture;
      })
      .finally(() => this.artPending.delete(src));
    this.artPending.set(src, promise);
    return promise;
  }
  positionArt() {
    // Keep figures proportional even when their atlas rectangles are not square.
    const t = this.artMatch.transform;
    const center = transformPoint({ x: 0, y: 0 }, t);
    // Match coordinates are normalized in height units (x also divided by H).
    const unit = this.artCoordinateSpace === 'normalized' ? this.height : 1;
    const x = center.x * unit - this.width / 2;
    const y = center.y * unit + this.height / 2;
    // The illustration is meant to read as larger than the star shape it
    // belongs to, for both constellations and imagined shapes. Rather than
    // shrinking the art when a widely-spread placement would push it off
    // screen (which would also make it look soft on a big display), the
    // camera eases back instead — the art's on-screen size stays constant
    // (ART_TARGET_PX) while the stars around it appear correspondingly
    // smaller, like a dolly pulling back to keep a subject framed.
    const artScale = this.artMatch.shape.artScale ?? 1;
    const size = t.scale * ART_SIZE_MULTIPLIER * unit * artScale;
    this.zoomTarget = Math.min(4, Math.max(1, size / ART_TARGET_PX));
    this.art.position.set(x, y, -3);
    const { w, h } = artwork(this.artMatch.shape).rect;
    this.art.scale.set(size * t.mirror * Math.min(1, w / h), size * Math.min(1, h / w), 1);
    this.art.rotation.z = t.angle;
    this.orbits.position.set(x, y, -4);
    this.orbits.scale.setScalar(size * 1.06);
  }
  hideArt() {
    this.artRequest++;
    this.artTarget = 0;
    this.artMatch = null;
    this.zoomTarget = 1;
  }
  pruneArtTextures(protect) {
    for (const [key, texture] of this.artTextures) {
      if (this.artTextures.size <= 12) break;
      if (texture === protect || texture === this.artMaterial.uniforms.uAtlas.value) continue;
      texture.dispose();
      this.artTextures.delete(key);
    }
  }
  // Fades every currently-drawn connecting line out, used whenever an edit
  // (moving, adding, or removing a star) breaks whatever pattern was being
  // shown — the lines dissolve rather than staying pinned to a dragged star.
  dissolveLines() {
    this.lineFadeTarget = 0;
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
      // A camera dolly, not a resize: everything at world z≈0 (stars, lines)
      // shrinks toward the frame's center as the camera eases back, while the
      // art's own scale already compensates so it holds a constant size.
      this.zoom += (this.zoomTarget - this.zoom) * (this.reducedMotion ? 1 : Math.min(1, dt * 1.6));
      this.camera.position.z = this.baseCameraZ * this.zoom;
      for (const obj of [this.backgroundStars, this.drawingStars])
        obj.material.uniforms.uDepth.value = this.camera.position.z;
      this.lineOpacity +=
        (this.lineFadeTarget - this.lineOpacity) * (this.reducedMotion ? 1 : Math.min(1, dt * 3.5));
      this.lines.material.opacity = this.lineBaseOpacity * this.lineOpacity;
      // A slow fade — the illustration should settle in gently, well after the
      // connecting lines finish drawing, not pop in with them.
      this.artFade +=
        (this.artTarget - this.artFade) * (this.reducedMotion ? 1 : Math.min(1, dt * 0.45));
      this.artMaterial.uniforms.uOpacity.value = this.artOpacity * this.artFade;
      this.artMaterial.uniforms.uTime.value = this.clock;
      this.orbits.visible = this.artFade > 0.05;
      if (this.reveal < 1) {
        const segments = this.lineSegments?.length || 1;
        this.reveal = this.reducedMotion
          ? 1
          : Math.min(1, this.reveal + (dt * SEGMENT_REVEAL_RATE) / segments);
        this.applyLineReveal();
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
    this.bridgeLines.geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(positions, 3),
    );
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
    this.silhouette = {
      points: points.slice(0, count),
      slots,
      until: this.clock + CONFIG.poseSilhouetteDuration,
    };
  }
  // "정각마다 초신성처럼 폭발 후 재배열되는 이벤트": a handful of scattered bursts,
  // independent of any camera or visitor — a small surprise for an idle
  // screen, per the exhibition brief's photo-op ideas. No screen flash (this
  // runs in VR too, where a sudden full-white frame is uncomfortable).
  supernova() {
    if (this.reducedMotion) return;
    const count = 5 + Math.floor(Math.random() * 3);
    for (let i = 0; i < count; i++)
      this.burst(
        { x: 0.15 + Math.random() * 0.7, y: 0.15 + Math.random() * 0.7 },
        1.4 + Math.random(),
      );
  }
  tickPresence(dt) {
    if (!this.presenceStars) return;
    const attr = this.presenceStars.geometry.attributes;
    const n = attr.position.count;
    if (this.silhouette) {
      const t =
        1 - Math.max(0, (this.silhouette.until - this.clock) / CONFIG.poseSilhouetteDuration);
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
    await this.artReady;
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
      this.artMatch && artwork(this.artMatch.shape).credit === 'meuris'
        ? 'Sky: ESO/S. Brunier · Art: Johan Meuris / Stellarium · Free Art License 1.3 · artlibre.org'
        : 'Sky: ESO/S. Brunier · Celestial art: AI generated',
      28 * ratio,
      canvas.height - 22 * ratio,
      canvas.width - 56 * ratio,
    );
    return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  }
  dispose() {
    this.disposed = true;
    this.artRequest++;
    for (const texture of this.artTextures.values()) texture.dispose();
    this.artTextures.clear();
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
