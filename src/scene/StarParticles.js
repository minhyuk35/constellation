import * as THREE from 'three';

// A bounded pool of smooth wave fronts, shared by web and WebXR. Each event
// uses only a few wave fronts; no dust, shards or flying sprite showers.
export class StarParticles {
  constructor(scene,{capacity=128,reducedMotion=false,spatial=false}={}) {
    this.capacity=capacity;this.cursor=0;this.emitted=0;this.reducedMotion=reducedMotion;this.spatial=spatial;
    this.variants={create:0,delete:0,wave:0,place:0};
    // VR uses actual world-space shells, so both eyes see the correct depth
    // and the wave expands in X, Y and Z independently of the viewer's pose.
    const surface=spatial?new THREE.SphereGeometry(1,48,24):new THREE.PlaneGeometry(1,1);
    this.geometry=new THREE.InstancedBufferGeometry().copy(surface);surface.dispose();this.geometry.instanceCount=spatial?0:capacity;
    for(const [name,size] of [['aCenter',3],['aFlight',4],['aLife',4],['aTint',3],['aStyle',1]]) {
      const a=new THREE.InstancedBufferAttribute(new Float32Array(capacity*size),size);a.setUsage(THREE.DynamicDrawUsage);this.geometry.setAttribute(name,a);
    }
    for(let i=0;i<capacity;i++)this.geometry.attributes.aLife.setXYZW(i,-100,1,0,0);
    this.material=new THREE.ShaderMaterial({transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,
      side:spatial?THREE.DoubleSide:THREE.FrontSide,forceSinglePass:true,
      uniforms:{uTime:{value:performance.now()/1000}},vertexShader:spatial?/*glsl*/`
       attribute vec3 aCenter,aTint;attribute vec4 aLife;attribute float aStyle;uniform float uTime;
       varying vec3 vTint,vNormal,vView;varying float vAge,vMode,vLayer;
       void main(){float age=(uTime-aLife.x)/aLife.y;vAge=clamp(age,0.,1.);vMode=aLife.w;vLayer=aStyle;vTint=aTint;
        if(age<0.||age>=1.){gl_Position=vec4(2.,2.,2.,1.);return;}
        float t=vAge,ease=1.-pow(1.-t,3.);
        float deleting=step(.5,vMode)*(1.-step(1.5,vMode));
        float radius=aLife.z*mix(.06+.8*ease,.8*pow(1.-t,1.8)+.025,deleting);
        vec4 p=modelViewMatrix*vec4(aCenter+position*radius,1.);
        vNormal=normalMatrix*normal;vView=-p.xyz;
        gl_Position=projectionMatrix*p;}`:/*glsl*/`
       attribute vec3 aCenter,aTint;attribute vec4 aLife,aFlight;attribute float aStyle;uniform float uTime;
       varying vec2 vUv;varying vec3 vTint;varying float vAge,vMode,vLayer;
       void main(){float age=(uTime-aLife.x)/aLife.y;vAge=clamp(age,0.,1.);vMode=aLife.w;vLayer=aStyle;vTint=aTint;vUv=uv;
        if(age<0.||age>=1.){gl_Position=vec4(2.,2.,2.,1.);return;}
        vec4 p=modelViewMatrix*vec4(aCenter,1.);p.xy+=position.xy*aLife.z;gl_Position=projectionMatrix*p;}`,
      fragmentShader:spatial?/*glsl*/`
       varying vec3 vTint,vNormal,vView;varying float vAge,vMode,vLayer;
       void main(){float t=vAge;
        float facing=abs(dot(normalize(vNormal),normalize(vView)));
        float rim=pow(1.-facing,5.),halo=pow(1.-facing,2.);
        float placement=step(2.5,vMode),wave=step(1.5,vMode)*(1.-placement);
        float envelope=smoothstep(0.,.09,t)*pow(1.-t,1.35);
        // Transparent interiors keep the workspace readable, including when a
        // shell passes an eye. Only its grazing edge carries a soft wave of light.
        float opacity=(rim*(.22+placement*.025)+halo*.025)*envelope*mix(1.,.7,wave);
        if(opacity<.002)discard;
        gl_FragColor=vec4(mix(vTint,vec3(.95,.98,1.),rim*.15),opacity);
        #include <colorspace_fragment>
       }`:/*glsl*/`
       varying vec2 vUv;varying vec3 vTint;varying float vAge,vMode,vLayer;
       void main(){vec2 p=vUv*2.-1.;float r=length(p),t=vAge;
        float ease=1.-pow(1.-t,3.);float deleting=step(.5,vMode)*(1.-step(1.5,vMode));
        float placement=step(2.5,vMode);float wave=step(1.5,vMode)*(1.-placement);
        float radius=mix(.08+.78*ease,.78*pow(1.-t,1.8)+.025,deleting);
        float aa=max(fwidth(r)*.8,.0015),width=max(aa,mix(.006,.003,t)+placement*.003);
        float edge=exp(-pow((r-radius)/width,2.));
        float veil=exp(-pow((r-radius)/(.037+placement*.025),2.))*.075;
        float envelope=smoothstep(0.,.09,t)*pow(1.-t,1.35);
        float angle=atan(p.y,p.x);float iridescence=.88+.12*cos(angle*2.+vLayer*.9);
        float center=exp(-r*r*100.)*pow(1.-t,4.)*.16*(1.-wave)*(1.-deleting);
        float opacity=(edge*.22+veil+center)*envelope*iridescence;
        opacity*=mix(1.,.7,wave);if(opacity<.002)discard;
        vec3 c=mix(vTint,vec3(.95,.98,1.),edge*.15);
        gl_FragColor=vec4(c,opacity);
        #include <colorspace_fragment>
       }`});
    this.mesh=new THREE.Mesh(this.geometry,this.material);this.mesh.frustumCulled=false;this.mesh.renderOrder=5;this.mesh.visible=false;scene.add(this.mesh);
  }
  emit(center,{kind='create',radius=.18,now=performance.now()/1000}={}) {
    if(this.reducedMotion||![center?.x,center?.y,center?.z??0,radius,now].every(Number.isFinite)||radius<=0)return;
    if(!(kind in this.variants))kind='create';
    // Reuse the start of the pool after an idle gap: ordinary two-shell births
    // draw two spheres, rather than submitting the entire spatial capacity.
    if(this.spatial&&now>=(this.until||0)){this.cursor=0;this.geometry.instanceCount=0;}
    const mode={create:0,delete:1,wave:2,place:3}[kind],count={create:2,delete:2,wave:2,place:3}[kind];
    const variant=this.variants[kind]++%3;this.lastEffect={kind,variant};
    const colors={create:[.24,.62,1],delete:[.55,.25,.86],wave:[.32,.75,.82],place:[1,.65,.25]},tint=colors[kind];
    const a=this.geometry.attributes;
    // Attribute update ranges are consumed by the renderer. Bound queued ranges
    // too if many synthetic events arrive before a draw.
    for(const attr of Object.values(a))if(attr.isInstancedBufferAttribute&&attr.updateRanges.length>this.capacity){attr.clearUpdateRanges();attr.addUpdateRange(0,attr.array.length);}
    for(let n=0;n<count;n++) {
      const i=this.cursor++%this.capacity,life=kind==='place'?1.65:kind==='delete'?.72:1.05,delay=n*(kind==='place'?.19:.11);
      a.aCenter.setXYZ(i,center.x,center.y,center.z||0);a.aFlight.setXYZW(i,0,0,0,mode);
      a.aLife.setXYZW(i,now+delay,life,radius*(kind==='place'?2.6+n*.45:kind==='delete'?1.5:1.45+n*.32),mode);
      a.aTint.setXYZ(i,...tint);a.aStyle.setX(i,n+variant*.16);
      for(const attr of Object.values(a))if(attr.isInstancedBufferAttribute)attr.addUpdateRange(i*attr.itemSize,attr.itemSize);
      this.until=Math.max(this.until||0,now+delay+life);
    }
    if(this.spatial)this.geometry.instanceCount=Math.min(this.capacity,Math.max(this.geometry.instanceCount,this.cursor));
    this.emitted+=count;for(const attr of Object.values(a))if(attr.isInstancedBufferAttribute)attr.needsUpdate=true;this.mesh.visible=true;
  }
  update(now=performance.now()/1000){this.material.uniforms.uTime.value=now;this.mesh.visible=!this.reducedMotion&&now<(this.until||0);}
  dispose(){this.mesh.removeFromParent();this.geometry.dispose();this.material.dispose();}
}
