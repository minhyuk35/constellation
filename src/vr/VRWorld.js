import * as THREE from 'three';
import { SkyArtwork } from '../exhibition/SkyArtwork.js';
import { skyIllustration } from '../exhibition/sky-art.js';
import { VR_MAX_STARS } from './VRModel.js';
import { StarParticles } from '../scene/StarParticles.js';
import { StarTrails } from '../scene/StarTrails.js';
import { VRLibrary } from './VRLibrary.js';
import { VREnvironment } from './VREnvironment.js';
import { VRStars } from './VRStars.js';
import { VRDesk } from './VRDesk.js';
import { VRGuideVisuals } from './VRGuideVisuals.js';

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
  constructor(container, model, action, { spectator = false } = {}) {
    this.container = container;
    this.model = model;
    this.action = action;
    this.spectator = spectator;
    this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.entries = new Map();
    this.artwork = new SkyArtwork({ opacity: 0.76, focusedOpacity: 0.76 });
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#040913');
    this.camera = new THREE.PerspectiveCamera(65, container.clientWidth / container.clientHeight, 0.03, 90);
    this.camera.position.set(0, 1.6, 0);
    this.scene.add(this.camera);
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.xr.enabled = true;
    this.renderer.xr.setReferenceSpaceType('local-floor');
    this.renderer.xr.setFoveation(1);
    container.append(this.renderer.domElement);
    this.scene.add(new THREE.HemisphereLight('#d5eaff', '#273044', 2));
    const key=new THREE.DirectionalLight('#c7e4ff',2.6);key.position.set(-3,6,3);this.scene.add(key);
    const rim=new THREE.DirectionalLight('#e4bc82',1.6);rim.position.set(4,3,-5);this.scene.add(rim);
    this.starTexture = this.makeStarTexture();
    this.starFields = new VRStars();
    this.makeEnvironment();
    this.makePanel();
    this.library = new VRLibrary(this.uiAnchor, this.starTexture, label);
    this.anchorUI(this.camera);
    this.guide=new VRGuideVisuals(this,label,textTexture);
    this.particles = new StarParticles(this.scene, { reducedMotion: this.reducedMotion, spatial: true });
    this.starTrails=new StarTrails(this.scene,{reducedMotion:this.reducedMotion});this.trailPoint=new THREE.Vector3();
    this.effect = e => this.particles.emit(e.detail.point, { kind: e.detail.kind });
    model.addEventListener('star-effect', this.effect);
    this.resize = () => {
      this.camera.aspect = container.clientWidth / container.clientHeight;
      this.camera.updateProjectionMatrix();
      if (!this.renderer.xr.isPresenting) this.renderer.setSize(container.clientWidth, container.clientHeight);
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
    this.environment=new VREnvironment(this.scene,{reducedMotion:this.reducedMotion});
  }
  makePanel() {
    this.uiAnchor=new THREE.Group();this.scene.add(this.uiAnchor);
    this.desk=new VRDesk(this.uiAnchor,label,textTexture);
    this.panel=this.desk.panel;this.panelTitle=this.desk.title;
    this.panelNote=this.desk.note;this.buttons=this.desk.buttons;
    this.raycaster=new THREE.Raycaster();
  }
  anchorUI(camera) {
    this.setUIAnchor(camera.getWorldPosition(new THREE.Vector3()),camera.getWorldQuaternion(new THREE.Quaternion()));
  }
  setUIAnchor(position,quaternion) {
    this.uiAnchor.position.copy(position);
    // Ignore pitch and roll so looking down at entry never tilts the desk or
    // puts it behind the visitor. YXZ retains the heading of the head pose.
    const angles = new THREE.Euler().setFromQuaternion(quaternion, 'YXZ');
    this.uiAnchor.rotation.set(0, angles.y, 0);
    this.uiAnchor.updateWorldMatrix(true, true);
    this.environment?.anchor(this.uiAnchor.position);
    this.desk?.anchor(this.uiAnchor.position.y);
    this.library?.anchor(this.uiAnchor.position.y);
    this.uiAnchorPending = false;
  }
  queueUIAnchor() {
    this.uiAnchorPending = true;
    this.panel.visible = false;
    if(this.library)this.library.group.visible = false;
  }
  updateUIAnchor(frame) {
    if (!this.uiAnchorPending || !this.renderer.xr.isPresenting) return;
    // setSession can resolve before tracking delivers a pose. Never use the
    // preview camera or an empty XR pose as the desk's permanent origin.
    if (!frame?.getViewerPose(this.renderer.xr.getReferenceSpace())) return;
    this.anchorUI(this.renderer.xr.getCamera());
  }
  actionAt(origin, direction) {
    if(this.uiAnchorPending)return null;
    this.uiAnchor.updateWorldMatrix(true, true);
    this.raycaster.set(origin, direction);
    const buttons=[...(this.panel.visible?this.buttons:[]),...(this.library.group.visible?this.library.buttons:[])];
    return this.raycaster.intersectObjects(buttons,false).find(hit=>this.library.acceptsHit(hit))?.object.userData.action || null;
  }
  updatePanel() {this.desk.update(this.model);}
  clearHighlights() {
    this.desk.clearHover();
    this.library.clearHover();
    for(const e of this.entries.values()) {
      e.cluster.uniforms.uSelected.value=-1;e.cluster.uniforms.uHeld.value=0;
      e.cluster.uniforms.uSecondary.value=-1;e.cluster.uniforms.uSecondaryHeld.value=0;
    }
  }
  hoverUI(origin,direction) {
    const action=this.actionAt(origin,direction);this.desk.hover(action);this.library.hover(action);return action;
  }
  highlight(target,held=false) {
    if(!target)return;const entry=this.entries.get(target.entity.id);if(!entry)return;
    const u=entry.cluster.uniforms,primary=u.uSelected.value === -1;
    u[primary?'uSelected':'uSecondary'].value=target.entity.stars.findIndex(s=>s.id===target.star.id);
    u[primary?'uHeld':'uSecondaryHeld'].value=held?1:0;
  }
  hoverStar(point,origin,direction) {
    let near=null,far=null,nearDistance=.14,farDistance=Infinity;
    for(const entry of this.entries.values()) {
      if(entry.flight)continue;
      for(let i=0;i<entry.worldStars.length;i++) {
      const p=entry.worldStars[i],dx=p.x-point.x,dy=p.y-point.y,dz=p.z-point.z;
      const d=Math.hypot(dx,dy,dz);
      if(d<nearDistance){nearDistance=d;near={entity:entry.entity,star:entry.entity.stars[i],distance:d};}
      const x=p.x-origin.x,y=p.y-origin.y,z=p.z-origin.z,t=x*direction.x+y*direction.y+z*direction.z;
      if(t<.05||t>14||t>=farDistance)continue;
      const off=Math.hypot(x-t*direction.x,y-t*direction.y,z-t*direction.z);
      if(off<.07+t*.018){farDistance=t;far={entity:entry.entity,star:entry.entity.stars[i],distance:t};}
      }
    }
    return near || far;
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
      if(entry?.isDraft && entity!==this.model.draft && !this.reducedMotion) {
        const from=entry.center.clone().applyMatrix4(entry.group.matrixWorld);
        const radius=Math.max(.025,...entry.worldStars.map(p=>p.distanceTo(from)));
        const head=(this.renderer.xr.isPresenting?this.renderer.xr.getCamera():this.camera).getWorldPosition(new THREE.Vector3());
        const direction=from.clone().sub(head),end=new THREE.Vector3().copy(entity.position).sub(head);
        entry.flight={start:performance.now(),duration:2800,from,head,radius,fromQuaternion:entry.group.quaternion.clone(),
          direction:direction.clone().normalize(),turn:new THREE.Quaternion().setFromUnitVectors(direction.clone().normalize(),end.clone().normalize()),
          near:Math.max(.25,direction.length()),far:end.length(),toQuaternion:new THREE.Quaternion().copy(entity.quaternion),turnNow:new THREE.Quaternion()};
      }
      if(entry && entity===this.model.draft){entry.flight=null;entry.cluster.uniforms.uCoreScale.value=1;}
      if (!entry) {
        const group = new THREE.Group();
        const color = palette[this.model.works.indexOf(entity) % palette.length] || palette[0];
        const cluster=this.starFields.create(group,color),stars=cluster.mesh;
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
        group.add(line);
        this.scene.add(group);
        entry = { group, stars, cluster, line, scale: 1, direction: new THREE.Vector3() };
        this.entries.set(entity.id, entry);
      }
      entry.group.position.copy(entity.position);
      entry.group.quaternion.copy(entity.quaternion);
      entry.group.scale.setScalar(entity.scale);
      entry.entity=entity;entry.worldStars ||= [];
      entry.group.updateWorldMatrix(true,false);
      entity.stars.forEach((s,i)=>{
        entry.worldStars[i] ||= new THREE.Vector3();
        this.trailPoint.copy(s).applyMatrix4(entry.group.matrixWorld);
        if(entity.editing&&!entry.flight&&entry.starIds?.[i]===s.id)this.starTrails.move(s.id,entry.worldStars[i],this.trailPoint);
        entry.worldStars[i].copy(this.trailPoint);
      });
      entry.starIds=entity.stars.map(s=>s.id);
      entry.worldStars.length=entity.stars.length;
      this.starFields.sync(entry.cluster,entity,entity === this.model.draft);
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
    this.panel.visible = !this.uiAnchorPending;
    this.desk.frame(this.panel.visible);
    this.library.group.visible=this.panel.visible;
    this.library.stand.visible=this.panel.visible;
    this.environment.update(now/1000);
    this.starFields.update(this.reducedMotion?0:now/1000);
    const camera = xr ? this.renderer.xr.getCamera() : this.camera,
      head = camera.getWorldPosition(new THREE.Vector3()),
      forward = camera.getWorldDirection(new THREE.Vector3());
    this.particles.update(now / 1000);
    this.starTrails.reducedMotion=this.reducedMotion;this.starTrails.update(now/1000);
    this.library.guiding=this.guide.state.step!=='idle';
    this.library.update(now / 1000, forward);
    for (const entry of this.entries.values()) {
      const f=entry.flight;
      if(f) {
        const t=THREE.MathUtils.clamp((now-f.start)/f.duration,0,1),s=t*t*t*(t*(t*6-15)+10),entity=entry.entity;
        const turn=f.turnNow.identity().slerp(f.turn,s);
        entry.group.position.copy(f.direction).applyQuaternion(turn).multiplyScalar(THREE.MathUtils.lerp(f.near,f.far,s)).add(f.head);
        entry.group.position.y+=Math.sin(s*Math.PI)*.12;
        entry.group.quaternion.copy(f.fromQuaternion).slerp(f.toQuaternion,s);
        const scale=THREE.MathUtils.lerp(f.radius,entity.scale,s);entry.group.scale.setScalar(scale);
        entry.cluster.uniforms.uCoreScale.value=THREE.MathUtils.lerp(.021,.037,s)/(.037*scale/entity.scale);
        entry.cluster.haloMaterial.uniforms.uSize.value=THREE.MathUtils.lerp(.15,.24,s);
        if(t===1) {
          entry.group.position.copy(entity.position);entry.group.quaternion.copy(entity.quaternion);entry.group.scale.setScalar(entity.scale);
          entry.cluster.uniforms.uCoreScale.value=1;entry.flight=null;
          this.particles.emit(entity.position,{kind:'place',radius:entity.scale*1.35,now:now/1000});
        }
      }
      if(entry.label)entry.label.visible=!entry.flight;
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
    this.guide.update(now/1000);
  }
  disposeEntry(entry) {
    this.artwork.release(entry);
    this.starFields.release(entry.cluster);
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
    this.guide.dispose();
    this.particles.dispose();
    this.starTrails.dispose();
    window.removeEventListener('resize', this.resize);
    for (const entry of this.entries.values()) this.disposeEntry(entry);
    this.entries.clear();
    this.starFields.dispose();
    this.scene.traverse((o) => {
      if(o.isInstancedMesh)o.dispose();
      o.geometry?.dispose();
      if (o.material) {
        o.material.map?.dispose();
        o.material.dispose();
      }
    });
    this.renderer.dispose();
  }
}
