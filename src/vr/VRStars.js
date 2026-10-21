import * as THREE from 'three';
import { VR_MAX_STARS } from './VRModel.js';

// Shared faceted geometry, two bounded draw calls per constellation. The solid
// core has stereo depth; its corona is a per-eye billboard, not a screen sprite.
export class VRStars {
  constructor() {
    this.time={value:0};
    const vertices=[];
    const edge=Array.from({length:8},(_,i)=>{const a=i*Math.PI/4,r=i%2 ? .31 : 1;return new THREE.Vector3(Math.cos(a)*r,Math.sin(a)*r,0);});
    for(let i=0;i<8;i++)for(const side of [1,-1]) {
      const a=edge[i],b=edge[(i+1)%8];
      vertices.push(0,0,.42*side,...(side>0?a:b).toArray(),...(side>0?b:a).toArray());
    }
    this.geometry=new THREE.BufferGeometry();this.geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));this.geometry.computeVertexNormals();
    this.geometry.setAttribute('aIndex',new THREE.InstancedBufferAttribute(Float32Array.from({length:VR_MAX_STARS},(_,i)=>i),1));
    this.matrix=new THREE.Matrix4();this.position=new THREE.Vector3();this.scale=new THREE.Vector3();this.quaternion=new THREE.Quaternion();
  }
  create(group,color) {
    const shared={uTime:this.time,uCoreScale:{value:1},uColor:{value:new THREE.Color(color)},uSelected:{value:-1},uHeld:{value:0},uSecondary:{value:-1},uSecondaryHeld:{value:0}};
    const material=new THREE.ShaderMaterial({uniforms:shared,
      vertexShader:/*glsl*/`attribute float aIndex;uniform float uCoreScale;varying vec3 vNormal,vView;varying float vIndex;
       void main(){vec4 p=modelViewMatrix*instanceMatrix*vec4(position*uCoreScale,1.);vNormal=normalize(normalMatrix*mat3(instanceMatrix)*normal);
        vView=-p.xyz;vIndex=aIndex;gl_Position=projectionMatrix*p;}`,
      fragmentShader:/*glsl*/`uniform vec3 uColor;uniform float uTime,uSelected,uHeld,uSecondary,uSecondaryHeld;varying vec3 vNormal,vView;varying float vIndex;
       void main(){vec3 n=normalize(vNormal);float rim=pow(1.-max(0.,dot(n,normalize(vView))),2.);
        float facet=.5+.5*dot(n,normalize(vec3(-.5,.8,1.)));
        float primary=1.-step(.2,abs(vIndex-uSelected)),secondary=1.-step(.2,abs(vIndex-uSecondary));
        float selected=max(primary,secondary),held=max(primary*uHeld,secondary*uSecondaryHeld);
        vec3 tint=mix(uColor,vec3(1.,.72,.3),selected*.5+held*.5);
        vec3 light=normalize(vec3(-.5,.8,1.));
        float glint=pow(max(0.,dot(reflect(-light,n),normalize(vView))),28.);
        vec3 c=mix(tint,vec3(1.,.83,.51),.32)*(.18+facet*.44)+tint*rim*.22+vec3(1.,.96,.85)*glint*.72;
        gl_FragColor=vec4(c,1.);
        #include <colorspace_fragment>
       }`});
    const mesh=new THREE.InstancedMesh(this.geometry,material,VR_MAX_STARS);mesh.count=0;mesh.frustumCulled=false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);mesh.name='Touchable faceted star cores';mesh.userData.sharedStarGeometry=true;
    const geometry=new THREE.InstancedBufferGeometry().copy(new THREE.PlaneGeometry(1,1));
    geometry.instanceCount=0;geometry.setAttribute('aCenter',new THREE.InstancedBufferAttribute(new Float32Array(VR_MAX_STARS*3),3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('aIndex',new THREE.InstancedBufferAttribute(Float32Array.from({length:VR_MAX_STARS},(_,i)=>i),1));
    const haloMaterial=new THREE.ShaderMaterial({transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,
      uniforms:{...shared,uSize:{value:.15}},vertexShader:/*glsl*/`
       attribute vec3 aCenter;attribute float aIndex;uniform float uSize,uSelected,uSecondary,uTime;
       varying vec2 vUv;varying float vIndex;
       void main(){vec4 p=modelViewMatrix*vec4(aCenter,1.);float selected=max(1.-step(.2,abs(aIndex-uSelected)),1.-step(.2,abs(aIndex-uSecondary)));
        p.xy+=position.xy*uSize*(1.+selected*.18);vUv=uv;vIndex=aIndex;gl_Position=projectionMatrix*p;}`,
      fragmentShader:/*glsl*/`uniform vec3 uColor;uniform float uTime,uSelected,uHeld,uSecondary,uSecondaryHeld;varying vec2 vUv;varying float vIndex;
       void main(){vec2 p=vUv*2.-1.;float r=length(p);
        float primary=1.-step(.2,abs(vIndex-uSelected)),secondary=1.-step(.2,abs(vIndex-uSecondary));
        float selected=max(primary,secondary),held=max(primary*uHeld,secondary*uSecondaryHeld);
        float pulse=.91+.09*sin(uTime*1.5+vIndex*2.4);
        float glow=exp(-r*r*6.)*.13+exp(-r*r*36.)*.45;
        float rays=pow(max(0.,1.-abs(p.x)),34.)*pow(max(0.,1.-abs(p.y)),4.);
        rays+=pow(max(0.,1.-abs(p.y)),34.)*pow(max(0.,1.-abs(p.x)),4.);
        float ring=exp(-pow((r-.64)*40.,2.))*selected*(.18+.12*sin(uTime*3.));
        float a=(glow+rays*.60+ring)*pulse;if(a<.004)discard;
        vec3 c=mix(uColor,vec3(1.,.72,.32),selected*.5+held*.5);gl_FragColor=vec4(c,a);
        #include <colorspace_fragment>
       }`});
    const halo=new THREE.Mesh(geometry,haloMaterial);halo.frustumCulled=false;halo.renderOrder=3;halo.name='Star diffraction corona';
    group.add(mesh,halo);return {mesh,halo,uniforms:shared,geometry,haloMaterial};
  }
  sync(cluster,entity,isDraft) {
    const radius=isDraft ? .021 : .037;
    this.scale.setScalar(radius/entity.scale);
    entity.stars.forEach((star,i)=>{
      this.position.copy(star);this.matrix.compose(this.position,this.quaternion,this.scale);cluster.mesh.setMatrixAt(i,this.matrix);
      cluster.geometry.attributes.aCenter.setXYZ(i,star.x,star.y,star.z);
    });
    cluster.mesh.count=cluster.geometry.instanceCount=entity.stars.length;
    cluster.mesh.instanceMatrix.needsUpdate=true;cluster.geometry.attributes.aCenter.needsUpdate=true;
    cluster.haloMaterial.uniforms.uSize.value=isDraft ? .15 : .24;
    cluster.uniforms.uSelected.value=-1;cluster.uniforms.uHeld.value=0;
    cluster.uniforms.uSecondary.value=-1;cluster.uniforms.uSecondaryHeld.value=0;
  }
  update(now) {this.time.value=now;}
  release(cluster) {
    cluster.mesh.removeFromParent();cluster.halo.removeFromParent();
    cluster.mesh.dispose();cluster.mesh.material.dispose();cluster.geometry.dispose();cluster.haloMaterial.dispose();
  }
  dispose(){this.geometry.dispose();}
}
