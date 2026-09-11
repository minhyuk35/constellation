export const skyVertex = `varying vec2 vUv;
void main(){vUv=uv;gl_Position=vec4(position.xy,0.999,1.0);}`;
export const skyFragment = `
uniform sampler2D uSky; uniform float uTime; uniform float uAspect; uniform float uBrightness;
varying vec2 vUv;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p), f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+1.),f.x),f.y);}
float fbm(vec2 p){float v=0.;float a=.5;for(int i=0;i<5;i++){v+=a*noise(p);p=mat2(.8,-.6,.6,.8)*p*2.06+3.;a*=.5;}return v;}
void main(){
 vec2 p=(vUv-.5)*vec2(uAspect,1.);
 float a=-.39; vec2 q=mat2(cos(a),-sin(a),sin(a),cos(a))*p;
 vec2 skyUv=q/vec2(2.8,1.4)+vec2(.49+sin(uTime*.006)*.012,.49);
 vec3 sky=texture2D(uSky,clamp(skyUv,.001,.999)).rgb;
 float lum=dot(sky,vec3(.2126,.7152,.0722));
 sky=mix(sky,vec3(lum)*vec3(.68,.83,1.15),.56);
 float cloud=fbm(q*3.+vec2(uTime*.007,0.));
 float band=exp(-pow((q.y+.09+cloud*.15)*3.2,2.));
 float dust=fbm(q*9.-cloud+uTime*.003);
 vec3 color=vec3(.012,.022,.041)+sky*uBrightness*.63;
 color+=mix(vec3(.04,.075,.13),vec3(.115,.063,.12),cloud)*band*dust*.4;
 color*=.72+.28*smoothstep(.85,.15,length(vUv-.5));
 gl_FragColor=vec4(color,1.);
}`;
export const starVertex = `
attribute float aSize; attribute float aPhase; attribute vec3 aColor;
uniform float uTime; uniform float uPixelRatio; uniform float uDepth; varying vec3 vColor; varying float vPulse;
void main(){vColor=aColor;vPulse=.76+.24*sin(uTime*.65+aPhase);
vec4 mv=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*mv;
gl_PointSize=aSize*uPixelRatio*clamp(uDepth/-mv.z,.25,1.8);}`;
export const starFragment = `
varying vec3 vColor; varying float vPulse; uniform float uOpacity; uniform float uSparkle;
void main(){vec2 p=gl_PointCoord-.5;float d=length(p);float glow=exp(-d*d*40.)*.45;
float core=exp(-d*d*440.);float rays=(exp(-abs(p.x)*150.)*exp(-abs(p.y)*10.)+exp(-abs(p.y)*150.)*exp(-abs(p.x)*10.))*.2*uSparkle;
float alpha=(glow+core+rays)*vPulse*uOpacity;if(alpha<.003)discard;gl_FragColor=vec4(vColor,alpha);}`;
export const artVertex = `varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
export const artFragment = `
uniform sampler2D uAtlas;uniform vec2 uTile;uniform float uOpacity;uniform float uTime;varying vec2 vUv;
void main(){vec2 uv=(vUv+uTile)/4.;vec4 tex=texture2D(uAtlas,uv);
 float edge=smoothstep(0.,.08,vUv.x)*smoothstep(0.,.08,vUv.y)*smoothstep(0.,.08,1.-vUv.x)*smoothstep(0.,.08,1.-vUv.y);
 float l=dot(tex.rgb,vec3(.2126,.7152,.0722));
 vec3 color=mix(tex.rgb,vec3(l)*vec3(.78,.98,1.19),.67);
 float mist=.96+.04*sin(vUv.y*8.+uTime*.35);
 gl_FragColor=vec4(color,tex.a*uOpacity*edge*mist);
}`;
