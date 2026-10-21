import { Vector3, Quaternion, MathUtils } from 'three';
import { MonitorConnection } from './connection.js';
import { cleanEntity, cleanSnapshot, vector, rotation, MONITOR_INTERVAL } from './protocol.js';
import { XR_LANDMARKS } from '../vr/VRGestures.js';

// Uses the existing XR render tick. Sampling is capped at 10 Hz, only when an
// operator selects this device. Unwatched devices send a 5-second heartbeat.
export class VRMonitorDevice {
  constructor(world,model,input,onStatus=()=>{}) {
    Object.assign(this,{world,model,input,onStatus,paused:false,watched:false});
    this.position=new Vector3();this.quaternion=new Quaternion();
    this.dirty=new Set();this.effects=[];
    this.recentCommands=new Map();this.onCommand=()=>false;
    this.connection=new MonitorConnection('device',{
      state:(state,error)=>{if(state !== 'connected')this.watched=false;onStatus(state,error);},
      heartbeat:()=>this.status(),
      message:data=>{
        if(data.type==='command'&&['tutorial-start','tutorial-stop'].includes(data.action)&&typeof data.requestId==='string') {
          let status=this.recentCommands.get(data.requestId);
          if(!status) {
            try{status=this.onCommand(data.action)?'applied':'unavailable';}catch{status='unavailable';}
            this.recentCommands.set(data.requestId,status);
            if(this.recentCommands.size>16)this.recentCommands.delete(this.recentCommands.keys().next().value);
          }
          this.connection.send({type:'command-result',requestId:data.requestId,action:data.action,status});return;
        }
        if(data.type === 'watchers') {
          this.watched=data.count > 0;
          if(data.refresh)this.full=true;
        }
      },
    });
    this.change=({detail})=>{
      if(detail.entity)this.dirty.add(detail.entity);else this.full=true;
    };
    this.effect=({detail})=>{if(this.watched && this.effects.length < 8)this.effects.push({kind:detail.kind,point:vector(detail.point)});};
    model.addEventListener('change',this.change);model.addEventListener('star-effect',this.effect);
  }
  start(name) {
    this.full=true;this.lastSent=-Infinity;this.paused=false;
    this.connection.start({name,platform:/OculusBrowser|Quest/i.test(navigator.userAgent)?'Meta Quest':'WebXR'});
  }
  status() {
    return {paused:this.paused || document.hidden,works:this.model.works.length,
      stars:this.model.entities.reduce((n,e)=>n+e.stars.length,0),
      hands:this.input.slots.filter(s=>s.source && (s.source.hand?s.hand.visible:s.controller.visible)).length};
  }
  tick(now) {
    if(!this.watched || now-this.lastSent < MONITOR_INTERVAL || !this.connection.active)return;
    if(this.connection.socket?.bufferedAmount > 131072)return;
    try {
      if(this.full) {
        if(!this.connection.send({type:'snapshot',state:cleanSnapshot(this.model)}))return;
        this.full=false;this.dirty.clear();
      } else if(this.dirty.size) {
        const entities=this.model.entities.filter(e=>this.dirty.has(e.id)).map(cleanEntity);
        if(entities.length && !this.connection.send({type:'patch',entities}))return;
        this.dirty.clear();
      }
      const {world,input}=this, camera=world.renderer.xr.getCamera();
      const eye=camera.cameras?.[0] || camera;
      const fov=MathUtils.clamp(MathUtils.radToDeg(2*Math.atan(1/(eye.projectionMatrix?.elements[5] || 1))),30,140);
      const hands=[];
      for(const slot of input.slots) {
        if(!slot.source)continue;
        const native=!!slot.source.hand;
        const valid=native?slot.hand.visible && XR_LANDMARKS.every(n=>slot.hand.joints[n]?.visible):slot.controller.visible;
        if(!valid)continue;
        const pose=input.pose(slot);
        hands.push({source:native?'hand':'controller',side:slot.source.handedness || 'none',
          gesture:native?slot.gestures.state.gesture:slot.pressed?'pinch':'open',held:!!slot.holding,
          points:native?slot.points.map(vector):[],origin:vector(pose.origin),direction:vector(pose.direction)});
      }
      const anchor=world.uiAnchor;
      if(!this.connection.send({type:'frame',frame:{
        head:{position:vector(camera.getWorldPosition(this.position)),quaternion:rotation(camera.getWorldQuaternion(this.quaternion)),fov},
        hands,effects:this.effects,
        ui:{position:vector(anchor.position),quaternion:rotation(anchor.quaternion),
          library:world.library.visible,filter:world.library.filter,page:world.library.page,scroll:world.library.scrollRatio,
          guide:input.tutorial?.state() || {step:'idle',mode:'hand',position:[0,0,0],quaternion:[0,0,0,1],target:null}},
      }}))return;
      this.effects=[];this.lastSent=now;
    } catch { this.full=true; }
  }
  stop() {this.watched=false;this.effects=[];this.connection.stop();}
  dispose() {
    this.stop();this.model.removeEventListener('change',this.change);this.model.removeEventListener('star-effect',this.effect);
  }
}
