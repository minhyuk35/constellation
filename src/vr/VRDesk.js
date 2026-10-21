import * as THREE from 'three';

export function rounded(width,height,radius) {
  const x=-width/2,y=-height/2,s=new THREE.Shape();
  s.moveTo(x+radius,y);s.lineTo(x+width-radius,y);s.quadraticCurveTo(x+width,y,x+width,y+radius);
  s.lineTo(x+width,y+height-radius);s.quadraticCurveTo(x+width,y+height,x+width-radius,y+height);
  s.lineTo(x+radius,y+height);s.quadraticCurveTo(x,y+height,x,y+height-radius);
  s.lineTo(x,y+radius);s.quadraticCurveTo(x,y,x+radius,y);return s;
}
export const solid=(shape,depth,bevel=.008)=>new THREE.ExtrudeGeometry(shape,{depth,bevelEnabled:true,bevelThickness:bevel,bevelSize:bevel,bevelSegments:3,steps:1,curveSegments:12});
const finish=new THREE.MeshStandardMaterial({color:'#192b3c',metalness:.42,roughness:.37});
export class VRDesk {
  constructor(anchor,label,textTexture) {
    this.label=label;this.textTexture=textTexture;this.hovered=new Set();
    this.panel=new THREE.Group();this.panel.name='First-time visitor constellation desk';
    this.panel.position.set(0,-.72,-1.05);this.panel.rotation.x=-Math.PI/3;this.panel.visible=false;anchor.add(this.panel);
    const outline=rounded(1.54,.72,.075),body=new THREE.Mesh(solid(outline,.045,.014),finish.clone());
    body.position.z=-.065;this.panel.add(body);
    const face=new THREE.Mesh(new THREE.ShapeGeometry(rounded(1.50,.68,.06)),new THREE.MeshStandardMaterial({color:'#0b1827',metalness:.24,roughness:.4}));
    face.position.z=-.004;this.panel.add(face);
    const rim=new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(outline.getPoints(96).map(p=>new THREE.Vector3(p.x,p.y,-.006)),true),160,.0025,5,true),
      new THREE.MeshBasicMaterial({color:'#a79978'}));this.panel.add(rim);
    const heading=label('나의 우주',1.34,.078);heading.position.set(0,.268,.012);this.panel.add(heading);
    this.title=label('',1.32,.055);this.title.position.set(0,.184,.012);this.panel.add(this.title);
    this.buttons=[];
    const specs=[['finish','↑','우주에 띄우기','#e6c490'],['undo','↶','되돌리기','#c8dce7'],
      ['tutorial','?','사용법','#a9dce1'],['exit','↗','나가기','#aab9c9']];
    const geometry=solid(rounded(.323,.222,.025),.014,.004);
    for(const [i,[id,icon,title,color]] of specs.entries()) {
      const material=new THREE.MeshStandardMaterial({color:'#183346',metalness:.3,roughness:.4,emissive:color,emissiveIntensity:.025});
      const button=new THREE.Mesh(geometry,material);button.position.set((i-1.5)*.365,-.018,.002);
      button.userData.action=id;button.userData.tint=new THREE.Color(color);this.panel.add(button);this.buttons.push(button);
      const symbol=label(icon,.14,.087);symbol.position.set(0,.044,.022);symbol.material.color.set(color);button.add(symbol);
      const caption=label(title,.296,.050);caption.position.set(0,-.050,.022);button.add(caption);
      button.userData.caption=caption;button.userData.captionText=title;
      const underline=new THREE.Mesh(new THREE.BoxGeometry(.08,.002,.002),new THREE.MeshBasicMaterial({color}));
      underline.position.set(0,-.09,.022);button.add(underline);
    }
    this.note=label('처음이라면 사용법을 눌러보세요',1.32,.055);
    this.note.position.set(0,-.235,.012);this.panel.add(this.note);
    this.stand=new THREE.Group();this.stand.name='Console pedestal';anchor.add(this.stand);
    const base=new THREE.Mesh(new THREE.CylinderGeometry(.34,.4,.08,64),finish.clone());base.position.set(0,.045,-1.05);this.stand.add(base);
    this.column=new THREE.Mesh(new THREE.CylinderGeometry(.12,.21,1,6),finish.clone());this.column.position.z=-1.05;this.stand.add(this.column);
    this.columnLight=new THREE.Mesh(new THREE.BoxGeometry(.012,1,.013),new THREE.MeshBasicMaterial({color:'#8fc5ce'}));
    this.columnLight.position.z=-.90;this.stand.add(this.columnLight);
    const footLight=new THREE.Mesh(new THREE.TorusGeometry(.345,.003,5,96),new THREE.MeshBasicMaterial({color:'#688e99'}));
    footLight.rotation.x=Math.PI/2;footLight.position.set(0,.087,-1.05);this.stand.add(footLight);
    const contact=new THREE.Mesh(new THREE.PlaneGeometry(1.2,.8),new THREE.ShaderMaterial({
      transparent:true,depthWrite:false,vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader:'varying vec2 vUv;void main(){vec2 p=vUv*2.-1.;float a=exp(-dot(p,p)*4.)*.55;gl_FragColor=vec4(0.,0.,0.,a);}'
    }));contact.rotation.x=-Math.PI/2;contact.position.set(0,.001,-1.05);this.stand.add(contact);
    this.anchor(1.6);
  }
  anchor(height) {
    this.stand.position.y=-height;
    const h=Math.max(.15,height-.72-.20);
    this.column.scale.y=h;this.column.position.y=.08+h/2;
    this.columnLight.scale.y=h*.74;this.columnLight.position.y=.08+h/2;
  }
  update(model) {
    const count=model.draft.stars.length;
    const text=this.guiding?'연습 공간':model.draft.shapeId?model.draft.title:`별 ${count}개 · 별자리 ${model.works.length}개`;
    if(text===this.text)return;
    this.title.material.map.dispose();this.title.material.map=this.textTexture(text,2048,128);this.text=text;
  }
  clearHover(){this.hovered.clear();}
  hover(action){if(action)this.hovered.add(action);}
  frame(visible) {
    this.stand.visible=visible;
    const note=this.guiding?'한 단계씩 따라 해보세요':'처음이라면 사용법을 눌러보세요';
    if(note!==this.noteText){this.note.material.map.dispose();this.note.material.map=this.textTexture(note,2048,128);this.noteText=note;}
    for(const button of this.buttons) {
      if(button.userData.action==='tutorial') {
        const text=this.guiding?'안내 종료':'사용법';
        if(button.userData.captionText!==text){const caption=button.userData.caption;caption.material.map.dispose();caption.material.map=this.textTexture(text,1024,128);button.userData.captionText=text;}
      }
      const disabled=this.guiding&&!['tutorial','exit'].includes(button.userData.action),on=!disabled&&this.hovered.has(button.userData.action);
      if(on === button.userData.highlighted&&disabled===button.userData.disabled)continue;
      button.userData.disabled=disabled;
      button.traverse(o=>{if(o.material?.map)o.material.opacity=disabled?.28:1;});
      button.userData.highlighted=on;
      button.material.color.set(disabled?'#0d1d29':on?'#31536a':'#183346');button.material.emissiveIntensity=on ? .29 : disabled?0:.025;
    }
  }
}
