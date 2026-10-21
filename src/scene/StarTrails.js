import * as THREE from 'three';

// Short, stationary ribbons along the actual drag path. No splines, noise,
// extrapolation or input smoothing: this layer never moves the held star.
export class StarTrails {
  constructor(scene,{capacity=96,lifetime=.24,maxLength=.18,width=.006,minDistance=.004,maxJump=.45,reducedMotion=false}={}) {
    Object.assign(this,{capacity,lifetime,maxLength,width,minDistance,maxJump,reducedMotion});
    this.cursor=0;this.emitted=0;this.until=0;this.epoch=0;this.tracks=new Map();
    this.heads=Array.from({length:4},()=>new THREE.Vector2(0,-1));
    const surface=new THREE.PlaneGeometry(1,1);
    this.geometry=new THREE.InstancedBufferGeometry().copy(surface);surface.dispose();this.geometry.instanceCount=0;
    for(const [key,size] of [['aStart',3],['aEnd',3],['aTrail',4]]) {
      this.geometry.setAttribute(key,new THREE.InstancedBufferAttribute(new Float32Array(capacity*size),size).setUsage(THREE.DynamicDrawUsage));
    }
    this.material=new THREE.ShaderMaterial({transparent:true,depthWrite:false,side:THREE.DoubleSide,forceSinglePass:true,blending:THREE.AdditiveBlending,
      uniforms:{uTime:{value:0},uLifetime:{value:lifetime},uMaxLength:{value:maxLength},uWidth:{value:width},uHeads:{value:this.heads}},
      vertexShader:/*glsl*/`
       attribute vec3 aStart,aEnd;attribute vec4 aTrail;
       uniform float uTime,uLifetime,uWidth;uniform vec2 uHeads[4];
       varying vec2 vUv;varying float vAge,vBehind,vLength;
       void main(){float age=(uTime-aTrail.x)/uLifetime;vec2 head=uHeads[int(aTrail.z)];
        if(age<0.||age>=1.||abs(head.y-aTrail.w)>.1){gl_Position=vec4(2.,2.,2.,1.);return;}
        vec3 a=(modelViewMatrix*vec4(aStart,1.)).xyz,b=(modelViewMatrix*vec4(aEnd,1.)).xyz;
        if(a.z>-.015||b.z>-.015){gl_Position=vec4(2.,2.,2.,1.);return;}
        vec3 delta=b-a;float len=length(delta);vec3 tangent=delta/max(len,.00001);
        vec3 side=cross(tangent,normalize(-(a+b)*.5));float sideLength=length(side);
        side=sideLength>.0001?side/sideLength:vec3(1.,0.,0.);
        float along=(position.x+.5)*(len+uWidth)-uWidth*.5;
        vec3 p=a+tangent*along+side*position.y*uWidth;
        vUv=vec2(along,position.y*2.);vAge=age;vLength=len;
        vBehind=head.x-(aTrail.y+along);gl_Position=projectionMatrix*vec4(p,1.);
       }`,
      fragmentShader:/*glsl*/`
       uniform float uWidth,uMaxLength;varying vec2 vUv;varying float vAge,vBehind,vLength;
       void main(){float cap=max(max(-vUv.x,vUv.x-vLength),0.)/(uWidth*.5);
        float soft=exp(-4.*(vUv.y*vUv.y+cap*cap));
        float lengthFade=pow(clamp(1.-max(vBehind,0.)/uMaxLength,0.,1.),1.5);
        float alpha=soft*.19*pow(1.-vAge,1.6)*lengthFade;
        if(alpha<.002)discard;
        gl_FragColor=vec4(mix(vec3(.4,.7,.9),vec3(.83,.93,1.),soft*.4),alpha);
        #include <colorspace_fragment>
       }`});
    this.mesh=new THREE.Mesh(this.geometry,this.material);this.mesh.frustumCulled=false;this.mesh.renderOrder=2;this.mesh.visible=false;scene.add(this.mesh);
  }
  move(id,from,to,now=performance.now()/1000) {
    if(this.reducedMotion||!id||![from?.x,from?.y,from?.z,to?.x,to?.y,to?.z,now].every(Number.isFinite))return;
    const jump=Math.hypot(to.x-from.x,to.y-from.y,to.z-from.z);
    if(jump<1e-9)return;
    if(jump>this.maxJump){this.tracks.delete(id);return;}
    let track=this.tracks.get(id);
    if(track&&now<track.time)return;
    if(!track||now-track.time>this.lifetime) {
      const used=new Set([...this.tracks.values()].map(t=>t.slot));let slot=this.heads.findIndex((_,i)=>!used.has(i));
      if(track){slot=track.slot;this.tracks.delete(id);}
      else if(slot<0){const oldest=[...this.tracks].sort((a,b)=>a[1].time-b[1].time)[0];slot=oldest[1].slot;this.tracks.delete(oldest[0]);}
      track={slot,epoch:++this.epoch,x:from.x,y:from.y,z:from.z,distance:0,time:now};this.tracks.set(id,track);
      this.heads[slot].set(0,track.epoch);
    }
    track.time=now;
    const dx=to.x-track.x,dy=to.y-track.y,dz=to.z-track.z,distance=Math.hypot(dx,dy,dz);
    if(distance<this.minDistance)return;
    // Cap a fast sample to the last visible part of its straight path. Skipped
    // frames and discontinuities cannot draw long streaks across the room.
    const length=Math.min(distance,this.maxLength),fraction=length/distance;
    const start={x:to.x-dx*fraction,y:to.y-dy*fraction,z:to.z-dz*fraction};
    if(now>=this.until){this.cursor=0;this.geometry.instanceCount=0;}
    const i=this.cursor++%this.capacity,a=this.geometry.attributes;
    a.aStart.setXYZ(i,start.x,start.y,start.z);a.aEnd.setXYZ(i,to.x,to.y,to.z);
    a.aTrail.setXYZW(i,now,track.distance+distance-length,track.slot,track.epoch);
    track.distance+=distance;track.x=to.x;track.y=to.y;track.z=to.z;this.heads[track.slot].x=track.distance;
    for(const attr of [a.aStart,a.aEnd,a.aTrail]) {
      if(attr.updateRanges.length>this.capacity){attr.clearUpdateRanges();attr.addUpdateRange(0,attr.array.length);}
      attr.addUpdateRange(i*attr.itemSize,attr.itemSize);attr.needsUpdate=true;
    }
    this.geometry.instanceCount=Math.min(this.capacity,Math.max(this.geometry.instanceCount,this.cursor));
    this.until=Math.max(this.until,now+this.lifetime);this.emitted++;this.mesh.visible=true;
  }
  update(now=performance.now()/1000) {
    if(this.reducedMotion){if(this.until)this.clear();return;}
    this.material.uniforms.uTime.value=now;this.mesh.visible=now<this.until;
  }
  clear(){this.tracks.clear();for(const head of this.heads)head.set(0,-1);this.until=0;this.cursor=0;this.geometry.instanceCount=0;this.mesh.visible=false;}
  dispose(){this.clear();this.mesh.removeFromParent();this.geometry.dispose();this.material.dispose();}
}
