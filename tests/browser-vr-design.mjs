import {chromium} from '@playwright/test';
import {mkdirSync} from 'node:fs';
import assert from 'node:assert/strict';
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,
  args:['--enable-webgl','--enable-unsafe-swiftshader']});
mkdirSync('tmp/qa',{recursive:true});
try {
  const page=await browser.newPage({viewport:{width:1600,height:1000}}),errors=[],requests=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  page.on('request',r=>{if(r.url().includes('/api/'))requests.push(r.url());});
  await page.goto('http://127.0.0.1:5173/vr.html');await page.waitForSelector('#vr-stage canvas');await page.waitForLoadState('networkidle');
  await page.evaluate(async()=>{
    const resources=performance.getEntriesByType('resource'),loaded=p=>resources.find(e=>new URL(e.name).pathname===p)?.name||p;
    const {app}=await import(loaded('/src/vr/main.js'));
    const THREE=await import(resources.find(e=>new URL(e.name).pathname.endsWith('/three.js')).name);
    window.design={app,THREE};const {world,model}=app;world.renderer.setAnimationLoop(null);
    world.spectator=true;document.body.classList.add('in-vr');
    for(const id of ['leo','imagined-rocket','cygnus']){app.action('preset:'+id);app.action('finish');}
    model.add(new THREE.Vector3(-.20,1.5,-.7));model.add(new THREE.Vector3(0,1.6,-.8));model.add(new THREE.Vector3(.22,1.44,-.72));
    world.camera.position.set(0,1.6,0);world.camera.quaternion.identity();world.anchorUI(world.camera);
    window.draw=(target)=>{if(target)world.camera.lookAt(...target);world.frame(performance.now());world.renderer.render(world.scene,world.camera);};
    draw();
  });
  await page.waitForFunction(()=>[...design.app.world.entries.values()].some(e=>e.artMesh));
  await page.evaluate(()=>draw([0,1.7,-5]));await page.screenshot({path:'tmp/qa/vr-observatory-wide.png'});
  await page.evaluate(()=>draw([1,3,-4]));await page.screenshot({path:'tmp/qa/vr-observatory-sky.png'});
  await page.evaluate(()=>draw([0,.85,-1.05]));await page.screenshot({path:'tmp/qa/vr-observatory-desk.png'});
  const interaction=await page.evaluate(async()=>{
    const {app,THREE}=design,{world,model,input}=app;
    const {XR_LANDMARKS}=await import('/src/vr/VRGestures.js'),{handPoints}=await import('/tests/fixtures/vr-hands.js');
    const head=new THREE.PerspectiveCamera();head.position.set(0,1.6,0);
    const old=world.renderer.xr.getCamera;world.renderer.xr.getCamera=()=>head;world.renderer.xr.isPresenting=true;
    const slot=input.slots[0];slot.source={hand:true,handedness:'right'};slot.hand.visible=true;slot.controller.visible=true;
    for(const name of XR_LANDMARKS){const joint=new THREE.Object3D();slot.hand.joints[name]=joint;slot.hand.add(joint);}
    const pose=(gesture,t,x=.72)=>{
      const points=handPoints(gesture,{x,y:1.4,z:-.55});
      XR_LANDMARKS.forEach((name,i)=>slot.hand.joints[name].position.copy(points[i]));
      slot.controller.position.set(x,1.4,0);input.update(t);
    };
    const initial=model.draft.stars.length;pose('open',-300);pose('open',-260);pose('open',-40);pose('fist',0);pose('fist',40);pose('fist',1100);
    const created=model.draft.stars.length===initial+1;
    pose('precision',1140);pose('precision',1180);const grabbed=!!slot.holding;
    const star=slot.holding?.star;pose('precision',1220,.86);
    const moved=!!star&&model.world(model.draft,star).x>.83;
    const focus=world.entries.get(model.draft.id).cluster.uniforms.uHeld.value;
    pose('fist',1260,.86);pose('fist',1300,.86);const released=!slot.holding;
    const left=input.slots[1];left.source={hand:true,handedness:'left'};left.hand.visible=true;left.controller.visible=true;
    for(const name of XR_LANDMARKS){const joint=new THREE.Object3D();left.hand.joints[name]=joint;left.hand.add(joint);}
    model.add(new THREE.Vector3(-.72,1.4,-.55));
    const pair=(gesture,t,offset=0)=>{
      for(const [s,x] of [[slot,.86+offset],[left,-.72-offset]]) {
        const points=handPoints(gesture,{x,y:1.4,z:-.55});XR_LANDMARKS.forEach((name,i)=>s.hand.joints[name].position.copy(points[i]));s.controller.position.set(x,1.4,0);
      }input.update(t);
    };
    pair('open',1400);pair('open',1440);pair('precision',1500);pair('precision',1540);pair('precision',1580,.05);
    const selected=world.entries.get(model.draft.id).cluster.uniforms;
    const both=!!slot.holding&&!!left.holding&&slot.holding.star.id!==left.holding.star.id&&selected.uSelected.value>=0&&selected.uSecondary.value>=0&&selected.uHeld.value===1&&selected.uSecondaryHeld.value===1;
    input.releaseAll();slot.source=null;left.source=null;world.renderer.xr.isPresenting=false;world.renderer.xr.getCamera=old;
    const b=world.buttons[2],origin=head.position.clone(),direction=b.getWorldPosition(new THREE.Vector3()).sub(origin).normalize();
    world.clearHighlights();world.hoverUI(origin,direction);world.frame(performance.now());
    const hovered=b.userData.highlighted&&b.material.emissiveIntensity>.2;
    const entry=world.entries.get(model.draft.id),matrix=entry.stars.instanceMatrix,version=matrix.version;
    for(let i=0;i<180;i++)world.frame(performance.now()+i*11);
    const noUploads=matrix===entry.stars.instanceMatrix && version===matrix.version;
    return {created,grabbed,moved,released,both,focus,hovered,noUploads,
      solid:entry.stars.isInstancedMesh,count:entry.stars.count,expected:model.draft.stars.length,
      shared:[...world.entries.values()].every(e=>e.stars.geometry===entry.stars.geometry),
      noPictures:[...world.environment.group.children].every(o=>!o.material?.map)};
  });
  for(const key of ['created','grabbed','moved','released','both','hovered','noUploads','solid','shared','noPictures'])assert.equal(interaction[key],true,key);
  assert.equal(interaction.focus,1);assert.equal(interaction.count,interaction.expected);
  await page.evaluate(()=>{design.app.world.camera.position.set(.10,1.48,-.15);draw([0,1.5,-.72]);});
  await page.screenshot({path:'tmp/qa/vr-observatory-stars.png'});
  const capacity=await page.evaluate(()=>{
    const {app,THREE}=design,{world,model}=app;const template=structuredClone(model.draft);
    template.shapeId=null;template.title='별자리';template.edges=[];
    template.stars=Array.from({length:48},(_,i)=>({id:crypto.randomUUID(),x:Math.cos(i*2.399)*(.3+i/90),y:Math.sin(i*2.399)*(.3+i/90),z:0}));
    model.works=Array.from({length:24},(_,i)=>({...structuredClone(template),id:crypto.randomUUID(),scale:.6,
      position:{x:Math.sin(i*Math.PI/4)*(3.6+Math.floor(i/8)*2.4),y:1.7,z:-Math.cos(i*Math.PI/4)*(3.6+Math.floor(i/8)*2.4)}}));
    model.draft={...structuredClone(template),id:crypto.randomUUID(),scale:.3,position:{x:0,y:1.6,z:-.7}};model.changed();
    world.camera.position.set(0,1.6,0);world.camera.lookAt(0,1.5,-4);draw();
    const before=world.renderer.info.memory.geometries;
    for(let i=0;i<60;i++){world.frame(performance.now()+i*11);world.renderer.render(world.scene,world.camera);}
    const info={calls:world.renderer.info.render.calls,triangles:world.renderer.info.render.triangles,
      geometryStable:before===world.renderer.info.memory.geometries,stars:[...world.entries.values()].reduce((s,e)=>s+e.stars.count,0)};
    // The hover cache follows the same unchanged model selection rules.
    const p=new THREE.Vector3(0,1.6,-.7),o=new THREE.Vector3(0,1.6,0),d=new THREE.Vector3(0,0,-1);
    const a=world.hoverStar(p,o,d),b=model.nearest(p)||model.pickRay(o,d);info.samePicking=a?.star.id===b?.star.id;
    return info;
  });
  assert.equal(capacity.stars,1200);assert.equal(capacity.geometryStable,true);assert.equal(capacity.samePicking,true);
  assert.ok(capacity.calls<220);assert.ok(capacity.triangles<160000);
  assert.deepEqual(requests,[]);assert.deepEqual(errors,[]);
  console.log('PASS: procedural room/floor/planet, physical desk and hover, solid instanced stars, native curled pinch create/grab/move/release, stable GPU buffers and 1,200-star capacity. '+JSON.stringify(capacity));
}finally{await browser.close();}
