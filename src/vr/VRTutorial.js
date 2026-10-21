import { Vector3, Quaternion, Euler } from 'three';
import { VRModel } from './VRModel.js';

export const GUIDE_STEPS=['idle','ready','create','grab','move','delete','done'];
export const GUIDE_TEXT={idle:'',ready:'손을 눈앞에 펴보세요',create:'주먹을 쥐고 빛을 모아보세요',
  grab:'엄지와 검지로 별을 집어보세요',move:'빛의 고리 안에 별을 놓아보세요',delete:'별을 집고 좌우로 흔들어보세요',done:'이제 나만의 우주를 만들어보세요'};

// Temporarily borrows the same model/renderer/input pipeline. Original object
// references and undo history are restored even on cancellation or XR exit.
export class VRTutorial {
  constructor(model,input,onChange=()=>{}){Object.assign(this,{model,input,onChange});this.step='idle';this.position=new Vector3();this.quaternion=new Quaternion();}
  get active(){return this.step!=='idle';}
  start(camera,now=performance.now()) {
    if(this.active)this.stop();
    this.input.releaseAll();
    const {model}=this;this.saved={draft:model.draft,works:model.works,history:model.history,anchor:model.anchor,erase:this.input.erase};
    const clean=new VRModel();model.draft=clean.draft;model.works=[];model.history=[];model.anchor=null;this.input.erase=false;
    this.position.copy(camera.getWorldPosition(new Vector3()));
    const angle=new Euler().setFromQuaternion(camera.getWorldQuaternion(new Quaternion()),'YXZ');this.quaternion.setFromEuler(new Euler(0,angle.y,0));
    this.mode=this.input.slots.some(s=>s.source?.hand)?'hand':this.input.slots.some(s=>s.source)?'controller':this.input.world?.renderer.xr.isPresenting?'hand':'mouse';
    this.target=null;this.practice=null;this.readyAt=null;this.readyHand=null;model.changed();this.setStep('ready',now);
  }
  setStep(step,now=performance.now()){this.step=step;this.since=now;this.onChange(this.state());}
  stop() {
    if(!this.active)return;
    this.input.releaseAll();const {draft,works,history,anchor,erase}=this.saved;
    Object.assign(this.model,{draft,works,history,anchor});this.input.erase=erase;this.saved=null;this.practice=null;this.target=null;
    this.step='idle';this.model.changed();this.onChange(this.state());
  }
  state(){return {step:this.step,mode:this.mode||'hand',position:this.position.toArray(),quaternion:this.quaternion.toArray(),target:this.target?.toArray()||null};}
  allows(kind,target=null) {
    if(!this.active)return true;
    if(kind==='action')return ['tutorial','exit'].includes(target);
    if(kind==='create')return this.step==='create'&&!this.practice;
    if(!target||target.star.id!==this.practice?.star.id)return false;
    return kind==='grab'?['grab','move','delete'].includes(this.step):kind==='move'?['move','delete'].includes(this.step):kind==='delete'&&this.step==='delete';
  }
  observe(slot,state,inside,now) {
    if(this.step!=='ready')return;
    if(state.gesture==='open'&&inside) {
      if(this.readyHand!==slot){this.readyHand=slot;this.readyAt=now;}
      if(now-this.readyAt>=300)this.setStep('create',now);
    } else if(this.readyHand===slot){this.readyHand=null;this.readyAt=null;}
  }
  desktopReady(){if(this.step==='ready')this.setStep('create');}
  created(target) {
    if(this.step!=='create')return;
    this.practice=target;
    const at=this.model.world(target.entity,target.star),right=new Vector3(.23,0,0).applyQuaternion(this.quaternion);
    this.target=at.add(right);this.setStep('grab');
  }
  grabbed(target){if(this.step==='grab'&&target.star.id===this.practice?.star.id)this.setStep('move');}
  released(target) {
    if(this.step==='move'&&target?.star.id===this.practice?.star.id&&this.model.world(target.entity,target.star).distanceTo(this.target)<.065)this.setStep('delete');
  }
  deleted(target){if(this.step==='delete'&&target.star.id===this.practice?.star.id)this.setStep('done');}
  tick(now){if(this.step==='done'&&now-this.since>2400)this.stop();}
}
