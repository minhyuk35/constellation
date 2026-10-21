import * as THREE from 'three';

// Everything is built in world space. No panorama, sky photograph or camera-
// facing scenery. Shader detail and instancing avoid full-screen bloom/shadow passes.
const noise=/*glsl*/`
float hash(vec3 p){p=fract(p*.3183099+vec3(.13,.37,.53));p*=17.;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}
float noise3(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
 return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
 mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);}
float cloud(vec3 p){return noise3(p)*.56+noise3(p*2.07+8.2)*.29+noise3(p*4.1+17.)*.15;}
`;
const vertex=/*glsl*/`varying vec3 vLocal;void main(){vLocal=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
const metal=(color,roughness=.42)=>new THREE.MeshStandardMaterial({color,metalness:.45,roughness});
function ring(radius,width,color,y=0) {
  const mesh=new THREE.Mesh(new THREE.RingGeometry(radius,radius+width,192),
    new THREE.MeshBasicMaterial({color,side:THREE.DoubleSide}));
  mesh.rotation.x=-Math.PI/2;mesh.position.y=y;return mesh;
}
export class VREnvironment {
  constructor(scene,{reducedMotion=false}={}) {
    this.time={value:0};this.reducedMotion=reducedMotion;
    this.group=new THREE.Group();this.group.name='Procedural celestial observatory';scene.add(this.group);
    const sky=new THREE.Mesh(new THREE.SphereGeometry(82,80,40),new THREE.ShaderMaterial({
      side:THREE.BackSide,depthWrite:false,vertexShader:vertex,uniforms:{uTime:this.time},
      fragmentShader:/*glsl*/`${noise}
       varying vec3 vLocal;uniform float uTime;
       void main(){vec3 d=normalize(vLocal);float lane=dot(d,normalize(vec3(.25,.83,.49)));
        float n=cloud(d*7.+vec3(.0,.0,uTime*.002));
        float band=exp(-pow((lane+(n-.5)*.20)*4.8,2.));
        float structure=cloud(d*38.+21.);float filaments=pow(max(0.,structure-.22),1.8);
        float rift=pow(smoothstep(.17,.72,n),1.3)*(.35+.65*structure);
        vec3 ink=vec3(.003,.006,.015);
        vec3 violet=mix(vec3(.055,.027,.105),vec3(.015,.065,.085),smoothstep(-.5,.6,d.x));
        vec3 c=ink+violet*band*rift*1.8+vec3(.14,.105,.15)*filaments*band*.55;
        c+=vec3(.009,.018,.031)*pow(max(0.,d.y),.6);
        gl_FragColor=vec4(c,1.);
        #include <colorspace_fragment>
       }`,
    }));sky.name='Seamless procedural nebula dome';sky.renderOrder=-100;this.group.add(sky);
    this.makeStars();this.makePlanet();this.makeFloor();
  }
  makeStars() {
    let seed=4821;const random=()=>((seed=(seed*1664525+1013904223)>>>0)/4294967296);
    const pos=[],colors=[],sizes=[],phases=[];
    for(let i=0;i<6200;i++) {
      const y=random()*2-1,a=random()*Math.PI*2,r=27+random()*47,s=Math.sqrt(1-y*y);
      pos.push(Math.cos(a)*s*r,y*r+5,Math.sin(a)*s*r);
      const color=new THREE.Color(['#c9ddff','#f4dfb2','#b5bdf3','#dcf4f5'][i%4]);
      colors.push(color.r,color.g,color.b);sizes.push(i%101===0?3.5: .7+random()*1.5);phases.push(random()*6.28);
    }
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
    g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));g.setAttribute('aSize',new THREE.Float32BufferAttribute(sizes,1));
    g.setAttribute('aPhase',new THREE.Float32BufferAttribute(phases,1));
    const material=new THREE.ShaderMaterial({transparent:true,depthWrite:false,vertexColors:true,blending:THREE.AdditiveBlending,
      uniforms:{uTime:this.time},vertexShader:/*glsl*/`
       attribute float aSize,aPhase;uniform float uTime;varying vec3 vColor;varying float vLight;
       void main(){vec4 p=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*p;
        gl_PointSize=aSize;vColor=color;vLight=.76+.24*sin(aPhase+uTime*.38);}`,
      fragmentShader:/*glsl*/`varying vec3 vColor;varying float vLight;void main(){float r=length(gl_PointCoord-.5)*2.;
       float a=exp(-r*r*4.)*vLight;if(a<.035)discard;gl_FragColor=vec4(vColor,a);
       #include <colorspace_fragment>
      }`});
    const field=new THREE.Points(g,material);field.name='6200 stars at different world depths';field.frustumCulled=false;this.group.add(field);
  }
  makePlanet() {
    const system=new THREE.Group();system.position.set(35,24,-53);system.rotation.set(.28,0,-.31);this.group.add(system);
    const material=new THREE.ShaderMaterial({vertexShader:/*glsl*/`
      varying vec3 vLocal,vNormal;void main(){vLocal=position;vNormal=normalize(normalMatrix*normal);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
      fragmentShader:/*glsl*/`${noise} varying vec3 vLocal,vNormal;
       void main(){vec3 n=normalize(vLocal);float latitude=n.y*19.+cloud(n*5.)*.65;
        float bands=smoothstep(.18,.82,noise3(vec3(latitude,3.7,2.1)));
        float detail=cloud(n*29.+4.8);
        vec3 c=mix(vec3(.12,.16,.19),vec3(.47,.37,.25),bands)*(.6+.4*detail);
        float lit=pow(max(0.,dot(n,normalize(vec3(-1.,.35,.5)))),.7);
        float limb=pow(1.-abs(normalize(vNormal).z),3.);
        gl_FragColor=vec4(c*(.025+lit*.9)+vec3(.12,.28,.36)*limb*.24,1.);
        #include <colorspace_fragment>
       }`});
    const planet=new THREE.Mesh(new THREE.SphereGeometry(5.4,64,40),material);planet.name='Physical ringed planet';system.add(planet);
    const rings=new THREE.Mesh(new THREE.RingGeometry(7,11.8,160,1),new THREE.ShaderMaterial({
      side:THREE.DoubleSide,transparent:true,depthWrite:false,vertexShader:vertex,
      fragmentShader:/*glsl*/`varying vec3 vLocal;void main(){float r=length(vLocal.xy);
       float band=.6+.4*sin(r*23.)/(1.+fwidth(r)*23.);float edge=smoothstep(7.,7.3,r)*(1.-smoothstep(11.2,11.8,r));
       float gap=1.-.75*exp(-pow((r-9.4)*8.,2.));
       gl_FragColor=vec4(mix(vec3(.14,.2,.26),vec3(.44,.37,.28),band),edge*gap*.62);
       #include <colorspace_fragment>
      }`}));rings.rotation.x=-Math.PI/2+.20;system.add(rings);
  }
  makeFloor() {
    this.floor=new THREE.Group();this.floor.name='Anchored physical observatory floor';this.group.add(this.floor);
    const plinth=new THREE.Mesh(new THREE.CylinderGeometry(11.5,11.65,.22,160),metal('#101c2a'));
    plinth.position.y=-.13;this.floor.add(plinth);
    const surface=new THREE.Mesh(new THREE.CircleGeometry(11.5,160),new THREE.ShaderMaterial({
      // Opaque frosted glass: broad sky radiance, no transparent void, moving
      // ripples, tiled lines or extra reflection-camera render in either eye.
      vertexShader:/*glsl*/`varying vec3 vLocal,vView,vNormal;
       void main(){vLocal=position;vec4 p=modelViewMatrix*vec4(position,1.);
        vView=p.xyz;vNormal=normalMatrix*normal;gl_Position=projectionMatrix*p;}`,
      fragmentShader:/*glsl*/`${noise}
       varying vec3 vLocal,vView,vNormal;
       void main(){vec2 p=vLocal.xy;float r=length(p);
        vec3 v=normalize(-vView),n=normalize(vNormal);
        vec3 d=normalize((vec4(reflect(-v,n),0.)*viewMatrix).xyz);
        float haze=noise3(d*3.4+9.)*.7+noise3(d*6.1+21.)*.3;
        float lane=dot(d,normalize(vec3(.25,.83,.49)));
        float band=exp(-pow((lane+(haze-.5)*.24)*2.5,2.));
        vec3 reflected=mix(vec3(.18,.065,.32),vec3(.025,.22,.28),smoothstep(-.6,.65,d.x));
        reflected*=band*(.36+.64*haze);
        float fresnel=pow(1.-max(0.,dot(v,n)),3.);
        float softLight=exp(-dot((p-vec2(-2.,-3.))/4.5,(p-vec2(-2.,-3.))/4.5));
        float violet=exp(-dot((p-vec2(4.,1.))/5.,(p-vec2(4.,1.))/5.));
        vec3 c=vec3(.018,.034,.052)+reflected*(.60+.65*fresnel);
        float sheen=pow(max(0.,dot(d,normalize(vec3(-.4,.7,.5)))),14.);
        float planetLight=pow(max(0.,dot(d,normalize(vec3(35.,24.,-53.)))),28.);
        c+=vec3(.09,.15,.19)*sheen+vec3(.12,.105,.075)*planetLight;
        c+=vec3(.012,.031,.039)*softLight+vec3(.022,.011,.035)*violet;
        c+=vec3(.022,.032,.042)*fresnel;
        c*=1.-.32*smoothstep(9.8,11.5,r);
        gl_FragColor=vec4(c,1.);
        #include <colorspace_fragment>
       }`}));surface.rotation.x=-Math.PI/2;surface.position.y=-.012;this.floor.add(surface);
    surface.name='Opaque frosted glass with soft celestial radiance';
    this.floor.add(ring(11.43,.025,'#65858f',.004));
    const pedestal=new THREE.Mesh(new THREE.CylinderGeometry(.85,.93,.06,96),metal('#14232f'));
    pedestal.position.y=-.055;this.floor.add(pedestal);
    const guards=new THREE.InstancedMesh(new THREE.BoxGeometry(.1,.5,.16),metal('#304552'),24),matrix=new THREE.Matrix4();
    const light=new THREE.InstancedMesh(new THREE.BoxGeometry(.018,.32,.025),new THREE.MeshBasicMaterial({color:'#70b4bd'}),24);
    for(let i=0;i<24;i++){const a=i*Math.PI/12,p=new THREE.Vector3(Math.sin(a)*11.35,.23,Math.cos(a)*11.35),q=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),a);
      matrix.compose(p,q,new THREE.Vector3(1,1,1));guards.setMatrixAt(i,matrix);
      p.add(new THREE.Vector3(-Math.sin(a)*.09,0,-Math.cos(a)*.09));matrix.compose(p,q,new THREE.Vector3(1,1,1));light.setMatrixAt(i,matrix);}
    this.floor.add(guards,light);
    const pillars=new THREE.InstancedMesh(new THREE.CylinderGeometry(.07,.12,3.05,8),metal('#2c4150',.34),8);
    for(let i=0;i<8;i++) {
      const a=(i+.5)*Math.PI/4;
      matrix.makeTranslation(Math.sin(a)*11.35,1.50,Math.cos(a)*11.35);pillars.setMatrixAt(i,matrix);
    }
    this.floor.add(pillars);
    const cornice=new THREE.Mesh(new THREE.TorusGeometry(11.35,.035,8,192),metal('#8e7d5d',.35));
    cornice.rotation.x=Math.PI/2;cornice.position.y=3.025;this.floor.add(cornice);
    for(const [i,r] of [15.5,16.2].entries()) {
      const orbit=new THREE.Mesh(new THREE.TorusGeometry(r,.022,6,240),metal(i?'#91784f':'#385c70',.32));
      orbit.position.y=6.5;orbit.rotation.set(.8+i*.7,.4,-.55+i*.8);this.floor.add(orbit);
    }
  }
  anchor(position) {this.floor.position.set(position.x,0,position.z);}
  update(now) {this.time.value=this.reducedMotion?0:now;}
}
