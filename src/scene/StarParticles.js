import * as THREE from 'three';

// One fixed GPU pool shared by the canvas and WebXR. A burst uploads only its
// new instances; flight, spiral, glow and fading run in the vertex/fragment shaders.
// Billboards use each eye's model-view matrix, so they have real stereo depth.
export class StarParticles {
  constructor(scene, { capacity = 1536, reducedMotion = false } = {}) {
    this.capacity = capacity;
    this.cursor = 0;
    this.emitted = 0;
    this.variants = { create: 0, delete: 1, wave: 2 };
    this.reducedMotion = reducedMotion;
    this.geometry = new THREE.InstancedBufferGeometry().copy(new THREE.PlaneGeometry(1, 1));
    this.geometry.instanceCount = capacity;
    for (const [name, size] of [['aCenter', 3], ['aFlight', 4], ['aLife', 4], ['aTint', 3], ['aStyle', 1]]) {
      const attr = new THREE.InstancedBufferAttribute(new Float32Array(capacity * size), size);
      attr.setUsage(THREE.DynamicDrawUsage);
      this.geometry.setAttribute(name, attr);
    }
    for (let i = 0; i < capacity; i++) this.geometry.attributes.aLife.setXYZW(i, -100, 1, 0, 0);
    this.material = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: performance.now() / 1000 } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: `
        attribute vec3 aCenter, aTint;
        attribute vec4 aFlight, aLife;
        attribute float aStyle;
        uniform float uTime;
        varying vec2 vUv;
        varying vec3 vTint;
        varying float vAlpha, vKind, vMode, vStyle;
        void main() {
          float age = (uTime - aLife.x) / aLife.y;
          float t = clamp(age, 0., 1.);
          float live = step(0., age) * (1. - step(1., age));
          vUv = uv; vTint = aTint; vKind = aFlight.w; vAlpha = 0.;
          vMode = aLife.w; vStyle = aStyle;
          if (live < .5) { gl_Position = vec4(2., 2., 2., 1.); return; }
          float creation = 1. - step(.5, aLife.w);
          float wave = step(1.5, aLife.w);
          float travel = mix(1. - exp(-3.5 * t), pow(1. - t, 1.8), creation);
          vec3 drift = aFlight.xyz * travel;
          float spin = creation * (1. - t) * (aStyle < .5 ? 5. : aStyle < 1.5 ? -2.7 : 1.2);
          drift.xy = mat2(cos(spin), -sin(spin), sin(spin), cos(spin)) * drift.xy;
          if(aLife.w>.5 && aLife.w<1.5 && aStyle>1.5) drift.y+=length(aFlight.xyz)*t*t*.9;
          vec4 center = modelViewMatrix * vec4(aCenter + drift, 1.);
          float halo = aFlight.w>1.5 && aFlight.w<2.5 ? 1. : 0.;
          float size = aLife.z * mix(1., mix(1.3-t, .2+t*2.2, wave), halo);
          vec2 corner = position.xy;
          vec3 velocity = mat3(modelViewMatrix) * aFlight.xyz;
          float angle = atan(velocity.y, velocity.x);
          float streak = aFlight.w>3.5 ? mix(2.8,5.5,step(.5,aLife.w)) : 1.;
          corner.x *= streak;
          angle += aFlight.w>2.5 && aFlight.w<3.5 ? t*2.5 : 0.;
          corner = mat2(cos(angle), -sin(angle), sin(angle), cos(angle)) * corner;
          center.xy += corner * size;
          gl_Position = projectionMatrix * center;
          vUv = uv; vTint = aTint; vKind = aFlight.w;
          vAlpha = live * mix(pow(1.-t,1.7),sqrt(max(0.,sin(t*3.14159))),creation) * smoothstep(0.,.025,t);
          vAlpha *= mix(1.,.55,wave);
        }`,
      fragmentShader: `
        varying vec2 vUv;
        varying vec3 vTint;
        varying float vAlpha, vKind, vMode, vStyle;
        void main() {
          if (vAlpha < .003) discard;
          vec2 p = vUv * 2. - 1.;
          float r = length(p);
          float glow = exp(-r * r * 7.5) * .5;
          float core = exp(-r * r * 85.);
          float cross = pow(max(0., 1. - abs(p.x)), 24.) * pow(max(0., 1. - abs(p.y)), 3.);
          cross += pow(max(0., 1. - abs(p.y)), 24.) * pow(max(0., 1. - abs(p.x)), 3.);
          float halo = exp(-pow((r - .7) * 28., 2.)) * .48;
          float shard = pow(max(0.,1.-abs(p.x)-abs(p.y)),.5);
          float trail = exp(-p.y*p.y*85.)*pow(max(0.,1.-abs(p.x)),1.6);
          float light = vKind>3.5 ? trail : vKind>2.5 ? shard*.65 : vKind>1.5 ? halo : glow+core+cross*.45;
          if(vMode>.5 && vMode<1.5 && vStyle>1.5) light=glow*.5+core*.25;
          float alpha = light * vAlpha;
          if (alpha < .003) discard;
          gl_FragColor = vec4(mix(vTint, vec3(1.), core * .65), alpha);
        }`,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }
  emit(center, { kind = 'create', radius = 0.18, now = performance.now() / 1000 } = {}) {
    if (this.reducedMotion || ![center.x, center.y, center.z || 0].every(Number.isFinite)) return;
    if (!(kind in this.variants)) kind = 'create';
    const deleting = kind === 'delete', wave = kind === 'wave', count = wave ? 24 : deleting ? 100 : 76;
    const variant = this.variants[kind]++ % 3;
    this.lastEffect = { kind, variant };
    const themes = deleting ? [[1,.48,.35],[.8,.52,1],[.48,1,.88]] : [[.58,.83,1],[1,.82,.42],[.84,.64,1]];
    const tint = wave ? [.42,.88,1] : themes[variant];
    const axis = Math.random() * Math.PI * 2;
    const attr = this.geometry.attributes;
    // Clear upload ranges once per rendered frame, not once per simultaneous burst.
    for (let n = 0; n < count; n++) {
      const i = this.cursor++ % this.capacity;
      let yaw = Math.random() * Math.PI * 2, z = Math.random() * 2 - 1;
      if (!deleting && !wave) {
        yaw = variant === 0 ? n / count * Math.PI * 4 : variant === 1 ? axis + (n%2)*Math.PI + (Math.random()-.5)*1.1 : axis + (n%5)*Math.PI*2/5 + (Math.random()-.5)*.15;
        z *= .35;
      }
      const radial = Math.sqrt(1 - z * z), spread = radius * (.35 + Math.random() * (deleting ? 1.25 : .65));
      const halo = wave && n < 2, core = !wave && n === 1;
      const style = halo ? 2 : core ? 1 : deleting ? variant === 0 ? 4 : variant === 1 ? 3 : 0 : variant === 1 ? 4 : 0;
      attr.aCenter.setXYZ(i, center.x, center.y, center.z || 0);
      attr.aFlight.setXYZW(i, halo || core ? 0 : Math.cos(yaw) * radial * spread,
        halo || core ? 0 : Math.sin(yaw) * radial * spread,
        halo || core ? 0 : z * spread * .7, style);
      const life = wave ? .9 + n%2*.25 : core ? .28 : (deleting ? .65 : .55) + Math.random() * .55;
      const size = halo ? radius * (wave ? 1.3 + n*.5 : 1.1) : core ? radius * .28 : radius * (.025 + Math.random() * (style === 3 ? .10 : .055));
      const delay = core ? .02 : Math.random() * (wave ? .04 : .10);
      attr.aLife.setXYZW(i, now + delay, life, size, wave ? 2 : deleting ? 1 : 0);
      attr.aStyle.setX(i, variant);
      const white = n % 7 === 0;
      attr.aTint.setXYZ(i, white ? 1 : tint[0], white ? .96 : tint[1], white ? .9 : tint[2]);
      for (const a of Object.values(attr))
        if (a.isInstancedBufferAttribute) a.addUpdateRange(i * a.itemSize, a.itemSize);
      this.until = Math.max(this.until || 0, now + delay + life);
    }
    this.emitted += count;
    for (const a of Object.values(attr)) if (a.isInstancedBufferAttribute) a.needsUpdate = true;
    this.mesh.visible = true;
  }
  update(now = performance.now() / 1000) {
    this.material.uniforms.uTime.value = now;
    this.mesh.visible = !this.reducedMotion && now < (this.until || 0);
  }
  dispose() {
    this.mesh.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
  }
}
