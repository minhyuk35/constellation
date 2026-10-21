import * as THREE from 'three';
import { filterShapes } from '../ui/Catalogue.js';
import { SkyArtwork } from '../exhibition/SkyArtwork.js';
import { skyIllustration } from '../exhibition/sky-art.js';
import { rounded, solid } from './VRDesk.js';

export const VR_LIBRARY_PAGE_SIZE = 6;
const TOP=.28,BOTTOM=-.35,ROW=.315;
const metal=()=>new THREE.MeshStandardMaterial({color:'#192b3c',metalness:.42,roughness:.37});
export class VRLibrary {
  constructor(anchor,starTexture,label) {
    this.group=new THREE.Group();this.group.name='Desk-side celestial catalogue monitor';
    this.group.position.set(1.22,-.70,-1.06);this.group.rotation.set(-Math.PI/3,-.10,0);this.group.scale.setScalar(.62);anchor.add(this.group);
    this.starTexture=starTexture;this.label=label;this.filter='zodiac';this.page=0;this.rows=0;this.open=true;
    this.artwork=new SkyArtwork();this.entries=new Map();this.cards=new Map();this.buttons=[];this.fixedButtons=[];this.hovered=new Set();
    this.content=new THREE.Group();this.list=new THREE.Group();this.group.add(this.content);this.content.add(this.list);
    const body=new THREE.Mesh(solid(rounded(1.28,1.36,.065),.045,.012),metal());
    body.position.z=-.075;this.group.add(body);
    const face=new THREE.Mesh(new THREE.ShapeGeometry(rounded(1.24,1.32,.05)),new THREE.MeshBasicMaterial({color:'#081522'}));
    face.position.z=-.005;this.group.add(face);
    const outline=rounded(1.255,1.335,.055);
    const rim=new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(outline.getPoints(96).map(p=>new THREE.Vector3(p.x,p.y,-.006)),true),160,.0025,5,true),new THREE.MeshBasicMaterial({color:'#a79978'}));
    this.group.add(rim);
    const led=new THREE.Mesh(new THREE.BoxGeometry(.11,.003,.002),new THREE.MeshBasicMaterial({color:'#a9dce1'}));
    led.position.set(0,-.648,.015);this.group.add(led);
    // Opaque bezel masks clip even the existing artwork shader through normal
    // depth testing. No global clipping or additional render pass is needed.
    for(const [y,h] of [[.445,.33],[-.505,.31]]) {
      const mask=new THREE.Mesh(new THREE.PlaneGeometry(1.21,h),new THREE.MeshBasicMaterial({color:'#081522'}));
      mask.position.set(0,y,.045);this.group.add(mask);
    }
    this.stand=new THREE.Group();anchor.add(this.stand);
    const base=new THREE.Mesh(new THREE.CylinderGeometry(.23,.29,.065,48),metal());
    base.position.set(1.22,.038,-1.06);this.stand.add(base);
    this.column=new THREE.Mesh(new THREE.CylinderGeometry(.055,.11,1,8),metal());this.column.position.set(1.22,0,-1.06);this.stand.add(this.column);
    this.standLight=new THREE.Mesh(new THREE.BoxGeometry(.008,1,.01),new THREE.MeshBasicMaterial({color:'#729ca9'}));
    this.standLight.position.set(1.22,0,-.95);this.stand.add(this.standLight);
    this.mount=new THREE.Mesh(new THREE.BoxGeometry(.14,.13,.14),metal());this.mount.position.set(1.22,0,-1.06);this.stand.add(this.mount);
    this.anchor(1.6);this.render();
  }
  get visible(){return this.open;}
  set visible(value){ /* The catalogue stays open, including after a selection. */ }
  get shapes(){
    if(this.shapeFilter!==this.filter){this.shapeFilter=this.filter;this.filteredShapes=filterShapes(this.filter);}
    return this.filteredShapes;
  }
  get maxRows(){return Math.max(0,Math.ceil(this.shapes.length/3)-2);}
  get scrollRatio(){return this.maxRows?this.rows/this.maxRows:0;}
  anchor(height) {
    this.stand.position.y=-height;const h=Math.max(.16,height-.85);
    this.column.scale.y=h;this.column.position.y=.07+h/2;
    this.standLight.scale.y=h*.7;this.standLight.position.y=.07+h/2;
    this.mount.position.y=height-.79;
  }
  action(id) {
    if(id.startsWith('filter:')){this.filter=id.slice(7);this.rows=0;this.page=0;this.render();}
    else if(id==='library-next'||id==='library-prev')this.scrollBy(id.endsWith('next')?1:-1);
  }
  setState(ui) {
    const changed=this.filter!==ui.filter;
    this.filter=ui.filter;
    const rows=ui.scroll===undefined?ui.page*2:ui.scroll*this.maxRows;
    if(changed){this.rows=THREE.MathUtils.clamp(rows,0,this.maxRows);this.page=ui.page;this.render();}
    else this.setRows(rows);
  }
  scrollBy(rows){if(this.open)this.setRows(this.rows+rows);}
  clearHover(){this.hovered.clear();}
  hover(action){if(action)this.hovered.add(action);}
  setRows(rows) {
    const value=THREE.MathUtils.clamp(rows,0,this.maxRows);if(Math.abs(value-this.rows)<.00001)return;
    this.rows=value;this.page=Math.floor(value/2);this.updateList();
  }
  localHit(origin,direction) {
    this.group.updateWorldMatrix(true,false);const localOrigin=this.group.worldToLocal(origin.clone());
    const localDirection=direction.clone().transformDirection(this.group.matrixWorld.clone().invert());
    if(Math.abs(localDirection.z)<1e-6)return null;
    const t=(.025-localOrigin.z)/localDirection.z;if(t<0)return null;return localOrigin.addScaledVector(localDirection,t);
  }
  scrollFromRay(origin,direction) {
    const hit=this.localHit(origin,direction);if(!hit)return;
    const half=this.handleHeight/2,travel=TOP-BOTTOM-this.handleHeight;
    if(travel>0)this.setRows((TOP-half-hit.y)/travel*this.maxRows);
  }
  containsRay(origin,direction) {
    if(!this.open||!this.group.visible)return false;
    const p=this.localHit(origin,direction);return !!p&&Math.abs(p.x)<.64&&Math.abs(p.y)<.69;
  }
  acceptsHit(hit) {
    if(!hit.object.userData.listItem)return true;
    const p=this.group.worldToLocal(hit.point.clone());return p.y<=TOP&&p.y>=BOTTOM;
  }
  disposeObject(object) {
    object.traverse(o=>{o.geometry?.dispose();if(o.material){if(o.material.map&&o.material.map!==this.starTexture)o.material.map.dispose();o.material.dispose();}});
    object.removeFromParent();
  }
  releaseCard(id) {
    const entry=this.entries.get(id);if(entry)this.artwork.release(entry);
    this.entries.delete(id);const card=this.cards.get(id);if(card)this.disposeObject(card);this.cards.delete(id);
  }
  clear() {
    for(const id of [...this.cards.keys()])this.releaseCard(id);
    for(const child of [...this.content.children])if(child!==this.list)this.disposeObject(child);
    this.fixedButtons=[];this.buttons=[];this.counterText=null;
  }
  text(text,x,y,width,height,action=null) {
    const mesh=this.label(text,width,height);mesh.position.set(x,y,.055);this.content.add(mesh);
    if(action){mesh.userData.action=action;this.fixedButtons.push(mesh);}return mesh;
  }
  render() {
    this.clear();this.text('별자리 도감',0,.449,.72,.085);
    for(const [i,[filter,title]] of [['zodiac','황도 12궁'],['constellation','공식 별자리'],['object','상상의 모양'],['all','전체 200']].entries()) {
      const tab=this.text(title,(i-1.5)*.285,.355,.265,.065,`filter:${filter}`);tab.material.color.set(filter===this.filter?'#f6d89c':'#829cad');
    }
    this.text('↑',-.47,-.445,.15,.075,'library-prev');this.counter=this.text('',0,-.443,.72,.055);
    this.text('↓',.47,-.445,.15,.075,'library-next');
    const track=new THREE.Mesh(new THREE.PlaneGeometry(.058,TOP-BOTTOM),new THREE.MeshBasicMaterial({color:'#192e3f'}));
    track.position.set(.568,(TOP+BOTTOM)/2,.025);track.userData.action='library-scroll';this.content.add(track);this.fixedButtons.push(track);
    this.handleHeight=Math.max(.07,(TOP-BOTTOM)*2/Math.max(2,Math.ceil(this.shapes.length/3)));
    this.handle=new THREE.Mesh(new THREE.PlaneGeometry(.023,this.handleHeight),new THREE.MeshBasicMaterial({color:'#92c3cd'}));
    this.handle.position.set(.568,0,.03);this.content.add(this.handle);this.rows=THREE.MathUtils.clamp(this.rows,0,this.maxRows);this.updateList();
  }
  makeCard(shape) {
    const card=new THREE.Group();this.list.add(card);this.cards.set(shape.id,card);
    const hit=new THREE.Mesh(new THREE.PlaneGeometry(.335,.295),new THREE.MeshBasicMaterial({color:'#102335'}));
    hit.userData.action=`preset:${shape.id}`;hit.userData.listItem=true;card.add(hit);card.userData.hit=hit;
    const visual=new THREE.Group();visual.position.set(0,.025,.008);visual.scale.setScalar(.100);card.add(visual);
    const points=shape.points.map(p=>new THREE.Vector3(p.x,p.y,.015));
    visual.add(new THREE.Points(new THREE.BufferGeometry().setFromPoints(points),new THREE.PointsMaterial({color:'#eef7ff',size:.006,map:this.starTexture,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending})));
    visual.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(shape.edges.flatMap(([a,b])=>[points[a],points[b]])),new THREE.LineBasicMaterial({color:'#bacfe1',transparent:true,opacity:.55})));
    const name=this.label(shape.name,.305,.047);name.position.set(0,-.100,.01);card.add(name);
    const entry={group:visual,scale:1,direction:new THREE.Vector3(),illustration:skyIllustration({title:shape.name}),data:{title:shape.name,drawing:{stars:shape.points,edges:shape.edges}}};
    this.entries.set(shape.id,entry);this.artwork.attach(entry);return card;
  }
  updateList() {
    if(!this.open)return;
    const shapes=this.shapes,start=Math.floor(this.rows)*3,end=Math.min(shapes.length,start+(this.rows%1<.0001?6:9)),ids=new Set();
    // Retain common cards and atlas users; only 6–9 cards are resident.
    for(let i=start;i<end;i++) {
      const shape=shapes[i];ids.add(shape.id);const card=this.cards.get(shape.id)||this.makeCard(shape);
      card.position.set((i%3-1)*.36,.122-(Math.floor(i/3)-this.rows)*ROW,.006);
    }
    for(const id of [...this.cards.keys()])if(!ids.has(id))this.releaseCard(id);
    this.buttons=[...this.fixedButtons,...[...this.cards.values()].map(c=>c.userData.hit)];
    this.handle.position.y=TOP-this.handleHeight/2-this.scrollRatio*(TOP-BOTTOM-this.handleHeight);
    const text=`${Math.min(start+1,shapes.length)}–${Math.min(start+6,shapes.length)} / ${shapes.length}`;
    if(this.counterText!==text) {
      const next=this.label(text,.72,.055);this.counter.material.map.dispose();this.counter.material.map=next.material.map;
      next.geometry.dispose();next.material.dispose();this.counterText=text;
    }
  }
  update(now,forward) {
    if(!this.open)return;
    for(const card of this.cards.values()) {
      const hit=card.userData.hit,on=!this.guiding&&this.hovered.has(hit.userData.action);
      if(hit.userData.highlighted!==on){hit.material.color.set(on?'#244255':'#102335');hit.userData.highlighted=on;}
      if(card.userData.dimmed!==!!this.guiding) {
        card.traverse(o=>{if(o.material?.transparent)o.material.opacity=this.guiding?.25:1;});card.userData.dimmed=!!this.guiding;
      }
    }
    this.handle.material.color.set(this.hovered.has('library-scroll')?'#d6eaf0':'#92c3cd');
    for(const entry of this.entries.values())entry.direction.copy(forward);
    this.artwork.update(this.entries,{fov:100,aspect:1},forward,now);
    if(this.guiding)for(const entry of this.entries.values())if(entry.artMesh)entry.artMesh.material.uniforms.uOpacity.value=.18;
  }
  dispose(){this.clear();this.disposeObject(this.group);this.disposeObject(this.stand);}
}
