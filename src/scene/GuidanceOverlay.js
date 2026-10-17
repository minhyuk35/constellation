import * as THREE from 'three';

// Four decorative sprites at most: two source stars and two destination ghosts.
// This layer never changes the drawing, camera, selection or grab hit testing.
export class GuidanceOverlay {
  constructor(scene) {
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('aKind', new THREE.BufferAttribute(new Float32Array(4), 1));
    this.geometry.setDrawRange(0, 0);
    this.material = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, depthTest: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uRatio: { value: 1 }, uDepth: { value: 1 }, uMotion: { value: 1 } },
      vertexShader: `attribute float aKind; varying float vKind;
        uniform float uTime, uRatio, uDepth, uMotion;
        void main() {
          vKind=aKind; vec4 p=modelViewMatrix*vec4(position,1.);
          float pulse=1.+.10*sin(uTime*3.8)*uMotion;
          gl_PointSize=(aKind<.5?78.:64.)*pulse*uRatio*uDepth/max(.1,-p.z);
          gl_Position=projectionMatrix*p;
        }`,
      fragmentShader: `varying float vKind; uniform float uTime, uMotion;
        void main() {
          vec2 p=gl_PointCoord*2.-1.; float r=length(p);
          float pulse=.70+.22*sin(uTime*3.8)*uMotion;
          float ring=exp(-pow((r-.64)*24.,2.));
          float haze=exp(-r*r*5.)*.16;
          float star=exp(-r*r*55.)*.45;
          float rays=pow(max(0.,1.-abs(p.x)),22.)*pow(max(0.,1.-abs(p.y)),4.)
            +pow(max(0.,1.-abs(p.y)),22.)*pow(max(0.,1.-abs(p.x)),4.);
          float a=(vKind<.5?ring*.65+haze:ring*.18+haze+star+rays*.18)*pulse;
          if(a<.003)discard;
          gl_FragColor=vec4(vKind<.5?vec3(1.,.83,.5):vec3(.54,.77,1.),a);
        }`,
    });
    this.mesh = new THREE.Points(this.geometry, this.material);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 4; this.mesh.visible = false;
    scene.add(this.mesh);
  }
  set(guide, stars, toWorld, width, height) {
    let count = 0;
    const attr = this.geometry.attributes;
    if (guide) for (const action of guide.actions) {
      const source = action.starId && stars.find(s => s.id === action.starId);
      const target = action.target;
      const occupied = stars.some(s => Math.hypot((s.x-target.x)*width, (s.y-target.y)*height) < 23);
      if (occupied) continue;
      if (source) {
        const p = toWorld(source); attr.position.setXYZ(count,p.x,p.y,4); attr.aKind.setX(count++,0);
      }
      const p = toWorld(target); attr.position.setXYZ(count,p.x,p.y,4); attr.aKind.setX(count++,1);
    }
    this.geometry.setDrawRange(0, count); this.mesh.visible = count > 0;
    attr.position.needsUpdate = true; attr.aKind.needsUpdate = true;
  }
  update(now, camera, ratio, reducedMotion) {
    const u = this.material.uniforms;
    u.uTime.value = now; u.uDepth.value = camera.position.z; u.uRatio.value = ratio;
    u.uMotion.value = reducedMotion ? 0 : 1;
  }
  dispose() { this.mesh.removeFromParent(); this.geometry.dispose(); this.material.dispose(); }
}
