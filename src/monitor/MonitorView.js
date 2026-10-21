import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { VRWorld } from '../vr/VRWorld.js';
import { VRModel } from '../vr/VRModel.js';
import { cleanSnapshot, cleanPatch, cleanFrame } from './protocol.js';

export class MonitorView {
  constructor(stage) {
    this.model=new VRModel();
    this.world=new VRWorld(stage,this.model,()=>{},{spectator:true});
    this.controls=new OrbitControls(this.world.camera,this.world.renderer.domElement);
    this.controls.enableDamping=true;this.controls.enabled=false;
    this.controls.minDistance=.2;this.controls.maxDistance=20;
    this.mode='head';this.hands=[];
    this.matrix=new THREE.Matrix4();this.scale=new THREE.Vector3(.008,.008,.008);
    this.point=new THREE.Vector3();this.targetQuaternion=new THREE.Quaternion();
    this.identity=new THREE.Quaternion();this.forward=new THREE.Vector3(0,0,-1);
    const geometry=new THREE.SphereGeometry(1,8,6);
    for(const color of ['#a8d5e3','#ead5ac']) {
      const joints=new THREE.InstancedMesh(geometry,new THREE.MeshBasicMaterial({color}),21);
      joints.count=0;joints.frustumCulled=false;
      joints.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      const ray=new THREE.Line(new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(),new THREE.Vector3(0,0,-1.4)]),
      new THREE.LineBasicMaterial({color,transparent:true,opacity:.35}));
      ray.visible=false;this.world.scene.add(joints,ray);this.hands.push({joints,ray});
    }
    this.headMarker=new THREE.Group();
    const marker=new THREE.Mesh(new THREE.SphereGeometry(.065,12,8),
      new THREE.MeshBasicMaterial({color:'#a8d5e3',wireframe:true,transparent:true,opacity:.6}));
    this.headMarker.add(marker,new THREE.ArrowHelper(new THREE.Vector3(0,0,-1),new THREE.Vector3(),.5,0x8ac5d8,.08,.04));
    this.world.scene.add(this.headMarker);
    this.observer=new ResizeObserver(()=>this.world.resize());this.observer.observe(stage);
    this.world.renderer.setAnimationLoop(now=>this.render(now));
  }
  reset() {
    this.ready=false;this.target=null;this.first=true;
    const empty=new VRModel();this.model.draft=empty.draft;this.model.works=[];
    this.model.changed();this.world.library.visible=false;
    this.world.guide.setState({step:'idle'});
    this.world.particles.until=0;this.world.particles.mesh.visible=false;
    this.world.starTrails.clear();
    const life=this.world.particles.geometry.attributes.aLife;
    for(let i=0;i<life.count;i++)life.setXYZW(i,-100,1,0,0);
    life.needsUpdate=true;
    for(const hand of this.hands){hand.joints.count=0;hand.ray.visible=false;}
  }
  snapshot(data) {
    Object.assign(this.model,cleanSnapshot(data));this.model.changed();this.world.updatePanel();this.ready=true;
  }
  patch(data) {
    for(const entity of cleanPatch(data)) {
      if(this.model.draft.id === entity.id)this.model.draft=entity;
      else {
        const index=this.model.works.findIndex(e=>e.id === entity.id);
        if(index < 0)throw new Error('Snapshot required');
        this.model.works[index]=entity;
      }
      this.model.changed(entity.id);
    }
    this.world.updatePanel();
  }
  frame(data) {
    const firstFrame=!this.target;
    this.target=cleanFrame(data);
    if(firstFrame && this.mode === 'space')this.setMode('space');
    const {ui,effects}=this.target,{world}=this;
    world.uiAnchor.position.fromArray(ui.position);world.uiAnchor.quaternion.fromArray(ui.quaternion).normalize();
    world.uiAnchorPending=false;
    world.environment.anchor(world.uiAnchor.position);world.desk.anchor(world.uiAnchor.position.y);
    world.library.anchor(world.uiAnchor.position.y);world.library.setState(ui);
    world.guide.setState(ui.guide||{step:'idle'});world.desk.guiding=!!ui.guide&&ui.guide.step!=='idle';
    world.updatePanel();
    for(const effect of effects)world.particles.emit(new THREE.Vector3().fromArray(effect.point),{kind:effect.kind});
    if(this.mode === 'head' && Math.abs(world.camera.fov-this.target.head.fov) > .1) {
      world.camera.fov=this.target.head.fov;world.camera.updateProjectionMatrix();
    }
  }
  setMode(mode) {
    this.mode=mode;this.controls.enabled=mode === 'space';
    if(mode === 'space' && this.target) {
      const p=new THREE.Vector3().fromArray(this.target.head.position);
      this.world.camera.position.copy(p).add(new THREE.Vector3(1.8,1.1,2));
      this.controls.target.copy(p).add(new THREE.Vector3(0,0,-.5));
      this.world.camera.fov=65;this.world.camera.updateProjectionMatrix();this.controls.update();
    }
    this.first=true;
  }
  render(now) {
    if(!this.ready || !this.target || document.hidden)return;
    const dt=Math.min(.05,(now-(this.lastTime || now))/1000);this.lastTime=now;
    const alpha=this.first?1:1-Math.exp(-24*dt),{head,hands}=this.target,{world}=this;
    this.point.fromArray(head.position);this.targetQuaternion.fromArray(head.quaternion).normalize();
    if(this.mode === 'head') {
      world.camera.position.lerp(this.point,alpha);world.camera.quaternion.slerp(this.targetQuaternion,alpha);
    } else this.controls.update();
    this.headMarker.visible=this.mode === 'space';this.headMarker.position.copy(this.point);
    this.headMarker.quaternion.copy(this.targetQuaternion);
    for(const [i,hand] of this.hands.entries()) {
      const data=hands[i];
      if(!data){hand.joints.count=0;hand.ray.visible=false;continue;}
      hand.joints.count=data.points.length;
      for(const [j,p] of data.points.entries()) {
        this.point.fromArray(p);this.matrix.compose(this.point,this.identity,this.scale);
        hand.joints.setMatrixAt(j,this.matrix);
      }
      hand.joints.instanceMatrix.needsUpdate=true;hand.ray.visible=true;
      hand.ray.position.fromArray(data.origin);
      hand.ray.quaternion.setFromUnitVectors(this.forward,this.point.fromArray(data.direction).normalize());
    }
    this.first=false;world.frame(now);world.renderer.render(world.scene,world.camera);
  }
  dispose() {
    this.observer.disconnect();this.controls.dispose();this.world.dispose();
    this.world.renderer.forceContextLoss();this.world.renderer.domElement.remove();
  }
}
