import * as THREE from 'three';
import { GUIDE_TEXT, GUIDE_STEPS } from './VRTutorial.js';
import { rounded,solid } from './VRDesk.js';

// One sentence at a time, an animated hand diagram and a world-space target.
// All geometry is reused; there are no camera moves or flashing transitions.
export class VRGuideVisuals {
  constructor(world,label,textTexture) {
    this.world=world;this.label=label;this.textTexture=textTexture;
    this.group=new THREE.Group();this.group.visible=false;world.scene.add(this.group);
    this.title=label('',1.10,.105);this.title.position.set(0,.19,-1.02);this.group.add(this.title);
    this.dots=[];
    for(let i=0;i<5;i++) {
      const dot=new THREE.Mesh(new THREE.CircleGeometry(.005,20),new THREE.MeshBasicMaterial({color:'#4e7187'}));dot.position.set((i-2)*.028,.102,-1.02);this.group.add(dot);this.dots.push(dot);
    }
    this.hand=new THREE.Group();
    const handMaterial=new THREE.MeshBasicMaterial({color:'#a9d2e3',transparent:true,opacity:.34,depthWrite:false});
    this.bones=new THREE.InstancedMesh(new THREE.CylinderGeometry(.5,.5,1,8),handMaterial,15);
    this.joints=new THREE.InstancedMesh(new THREE.SphereGeometry(.5,8,6),handMaterial.clone(),20);
    this.bones.frustumCulled=this.joints.frustumCulled=false;this.hand.add(this.bones,this.joints);
    const palm=new THREE.Mesh(solid(rounded(.095,.10,.022),.016,.003),handMaterial.clone());palm.position.set(0,-.031,-.01);this.hand.add(palm);
    const wrist=new THREE.Mesh(solid(rounded(.050,.035,.008),.012,.003),handMaterial.clone());wrist.position.set(0,-.09,-.007);this.hand.add(wrist);
    this.matrix=new THREE.Matrix4();this.rotation=new THREE.Quaternion();this.up=new THREE.Vector3(0,1,0);this.scale=new THREE.Vector3();this.center=new THREE.Vector3();this.delta=new THREE.Vector3();
    this.hand.position.set(-.24,-.14,-.75);this.group.add(this.hand);
    this.ring=new THREE.Mesh(new THREE.TorusGeometry(.055,.002,6,80),new THREE.MeshBasicMaterial({color:'#dfc593',transparent:true,opacity:.65}));world.scene.add(this.ring);this.ring.visible=false;
    this.arrow=new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-.07,0,0),new THREE.Vector3(.07,0,0)]),new THREE.LineBasicMaterial({color:'#dfc593',transparent:true,opacity:.45}));this.ring.add(this.arrow);
    this.state={step:'idle'};
  }
  setState(state) {
    const step=state?.step||'idle';
    if(this.state.step!==step||this.state.mode!==state?.mode) {
      const pointer=state.mode!=='hand',controller=state.mode==='controller';
      const text=pointer?({ready:controller?'트리거를 눌러 시작해요':'빈 공간을 클릭해 시작해요',create:controller?'빈 공간에 트리거로 별을 만들어요':'클릭해 별을 만들어보세요',grab:controller?'별을 가리키고 트리거를 눌러요':'별을 클릭해서 잡아보세요'}[step]||GUIDE_TEXT[step]):GUIDE_TEXT[step];
      this.title.material.map.dispose();this.title.material.map=this.textTexture(text,2048,128);
      this.dots.forEach((d,i)=>d.material.color.set(i<GUIDE_STEPS.indexOf(step)?'#dbc28d':'#385468'));
    }
    this.state=state||{step:'idle'};this.group.visible=step!=='idle';
    this.hand.visible=state?.mode==='hand';
    if(state?.position)this.group.position.fromArray(state.position);if(state?.quaternion)this.group.quaternion.fromArray(state.quaternion);
    this.ring.visible=!!state?.target&&step==='move';
    if(state?.target)this.ring.position.fromArray(state.target);
    if(state?.quaternion)this.ring.quaternion.fromArray(state.quaternion);
  }
  update(now) {
    if(!this.group.visible)return;
    const {step}=this.state,t=this.world.reducedMotion?0:now,cycle=(Math.sin(t*1.7)+1)/2,phase=(t%3.2)/3.2;
    const folding=this.world.reducedMotion?1:THREE.MathUtils.smoothstep(phase,.12,.38)*(1-THREE.MathUtils.smoothstep(phase,.80,.98));
    const pinching=['grab','move','delete'].includes(step),fold=step==='ready'?0:step==='create'?folding:1;
    let bone=0,joint=0,indexTip;
    const segment=(a,b,width)=>{
      this.delta.copy(b).sub(a);this.rotation.setFromUnitVectors(this.up,this.delta.clone().normalize());
      this.center.copy(a).add(b).multiplyScalar(.5);this.scale.set(width,this.delta.length(),width);this.matrix.compose(this.center,this.rotation,this.scale);this.bones.setMatrixAt(bone++,this.matrix);
      this.scale.setScalar(width);this.matrix.compose(b,this.rotation,this.scale);this.joints.setMatrixAt(joint++,this.matrix);
    };
    for(let finger=0;finger<4;finger++) {
      let prior=new THREE.Vector3((finger-1.5)*.024,.017,0);const length=[.103,.115,.106,.085][finger]/3;
      const curl=pinching&&finger===0?.45+cycle*.28:fold;
      for(let k=0;k<3;k++) {
        const angle=curl*(k+1)*.91,next=prior.clone().add(new THREE.Vector3((finger-1.5)*.0015*(1-curl),Math.cos(angle)*length,Math.sin(angle)*length));
        segment(prior,next,finger===3?.014:.017);prior=next;
      }
      if(finger===0)indexTip=prior;
    }
    let prior=new THREE.Vector3(-.052,-.035,0);
    const tip=pinching?indexTip.clone().add(new THREE.Vector3(-.008-cycle*.012,0,0)):new THREE.Vector3(-.098+fold*.074,.024-fold*.025,fold*.052);
    for(let k=0;k<3;k++) {
      const next=new THREE.Vector3(-.052,-.035,0).lerp(tip,(k+1)/3);next.z+=Math.sin((k+1)/3*Math.PI)*.012;
      segment(prior,next,.019);prior=next;
    }
    this.bones.count=bone;this.joints.count=joint;this.bones.instanceMatrix.needsUpdate=true;this.joints.instanceMatrix.needsUpdate=true;
    this.hand.position.x=-.24+(step==='delete'?Math.sin(t*4)*.055:0);
    this.ring.scale.setScalar(1+(this.world.reducedMotion?0:Math.sin(t*2)*.035));
  }
  dispose(){this.group.removeFromParent();this.ring.removeFromParent();for(const root of [this.group,this.ring])root.traverse(o=>{if(o.isInstancedMesh)o.dispose();o.geometry?.dispose();o.material?.map?.dispose();o.material?.dispose();});}
}
