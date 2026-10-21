import {chromium} from '@playwright/test';
import {mkdirSync} from 'node:fs';
import assert from 'node:assert/strict';
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--enable-webgl','--enable-unsafe-swiftshader']});
mkdirSync('tmp/qa',{recursive:true});
try {
  const page=await browser.newPage({viewport:{width:1600,height:1000}}),errors=[],api=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  page.on('request',r=>{if(r.url().includes('/api/'))api.push(r.url());});
  await page.goto('http://127.0.0.1:5173/vr.html');await page.waitForLoadState('networkidle');
  await page.evaluate(async()=>{
    const resources=performance.getEntriesByType('resource'),loaded=p=>resources.find(e=>new URL(e.name).pathname===p).name;
    const {app}=await import(loaded('/src/vr/main.js')),THREE=await import(resources.find(e=>new URL(e.name).pathname.endsWith('/three.js')).name);
    window.workstation={app,THREE,initial:app.world.camera.quaternion.clone(),anchor:app.world.uiAnchor.matrixWorld.clone()};
    window.screenPoint=(object,local)=>{const v=local?object.localToWorld(new THREE.Vector3(...local)):object.getWorldPosition(new THREE.Vector3());v.project(app.world.camera);return {x:(v.x+1)*innerWidth/2,y:(1-v.y)*innerHeight/2};};
  });
  assert.equal(await page.evaluate(()=>workstation.app.world.panel.visible),true,'desk is present on the ordinary page');
  await page.locator('#vr-preview').click();
  assert.equal(await page.locator('#vr-preview').getAttribute('aria-pressed'),'true');
  await page.waitForFunction(()=>workstation.app.world.library.visible);
  assert.equal(await page.locator('#library-dialog').evaluate(d=>d.open),false,'preview uses the actual 3D monitor');
  assert.equal(await page.evaluate(()=>workstation.app.world.panel.visible),true,'desk stays usable with monitor open');
  await page.waitForFunction(()=>[...workstation.app.world.library.entries.values()].every(e=>e.artMesh||e.artFailed));
  await page.screenshot({path:'tmp/qa/vr-workstation-desktop.png'});
  const center=await page.evaluate(()=>screenPoint(workstation.app.world.library.group,[0,0,.025]));
  await page.mouse.move(center.x,center.y);await page.mouse.wheel(0,175);
  await page.waitForFunction(()=>workstation.app.world.library.rows>.4);
  const bounded=await page.evaluate(()=>{
    const {app}=workstation,book=app.world.library;book.action('filter:all');
    const visited=new Set(),anchor=app.world.uiAnchor.matrixWorld.clone();let max=0;
    for(let row=0;row<book.maxRows+1;row+=.25){book.setRows(row);for(const id of book.cards.keys())visited.add(id);max=Math.max(max,book.cards.size);}
    book.setRows(.2);const first=[...book.cards.values()];book.setRows(.3);
    const reused=first.every(c=>book.cards.get(c.userData.hit.userData.action.slice(7))===c);
    book.setRows(0);
    app.world.uiAnchor.updateWorldMatrix(true,true);
    const hidden=book.group.localToWorld(new workstation.THREE.Vector3(0,-.508,.006));
    const o=app.world.camera.position.clone(),action=app.world.actionAt(o,hidden.sub(o).normalize());
    const surface=app.world.environment.floor.children.find(o=>o.name.startsWith('Opaque frosted'));
    return {visited:visited.size,max,reused,clipped:!action?.startsWith('preset:'),fixed:app.world.uiAnchor.matrixWorld.equals(anchor),
      opaque:!surface.material.transparent&&surface.material.depthWrite,static:!surface.material.uniforms.uTime};
  });
  assert.equal(bounded.visited,200);assert.ok(bounded.max<=9);assert.equal(bounded.reused,true);
  assert.equal(bounded.clipped,true);
  assert.equal(bounded.fixed,true);assert.equal(bounded.opaque,true);assert.equal(bounded.static,true);
  const bar=await page.evaluate(()=>({top:screenPoint(workstation.app.world.library.group,[.568,.23,.025]),bottom:screenPoint(workstation.app.world.library.group,[.568,-.25,.025])}));
  await page.mouse.move(bar.top.x,bar.top.y);await page.mouse.down();await page.mouse.move(bar.bottom.x,bar.bottom.y,{steps:12});await page.mouse.up();
  assert.ok(await page.evaluate(()=>workstation.app.world.library.scrollRatio>.8),'real mouse drag scrolls the track');
  const native=await page.evaluate(()=>{
    const {app,THREE}=workstation,{world,input,model}=app,book=world.library,slot=input.slots[0],before=model.draft.stars.length;
    const origin=world.camera.position.clone();
    const point=y=>book.group.localToWorld(new THREE.Vector3(.568,y,.025));
    const ray=y=>({origin,direction:point(y).sub(origin).normalize()});
    const old=world.renderer.xr.getCamera;world.renderer.xr.getCamera=()=>world.camera;
    slot.source={hand:null};slot.controller.visible=true;slot.controller.position.copy(origin);slot.pressed=true;
    input.begin(slot,ray(.23));const scrolling=slot.scrolling;
    slot.controller.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,-1),ray(-.25).direction);slot.controller.updateMatrix();input.update(performance.now());
    const moved=book.scrollRatio>.8;input.release(slot);slot.source=null;slot.pressed=false;world.renderer.xr.getCamera=old;
    return {scrolling,moved,released:!slot.scrolling,noStars:model.draft.stars.length===before};
  });
  for(const [key,value] of Object.entries(native))assert.equal(value,true,key);
  const hands=await page.evaluate(async()=>{
    const {app,THREE}=workstation,{world,input,model}=app,slot=input.slots[0],book=world.library;
    const loaded=p=>performance.getEntriesByType('resource').find(e=>new URL(e.name).pathname===p)?.name||p;
    const {XR_LANDMARKS}=await import(loaded('/src/vr/VRGestures.js')),{handPoints}=await import('/tests/fixtures/vr-hands.js');
    const before=model.draft.stars.length;slot.source={hand:{},handedness:'right'};slot.hand.visible=true;slot.controller.visible=true;slot.gestures.reset();
    for(const name of XR_LANDMARKS){const joint=slot.hand.joints[name]||new THREE.Object3D();slot.hand.joints[name]=joint;if(!joint.parent)slot.hand.add(joint);}
    const frame=(gesture,t,y)=>{
      const points=handPoints(gesture,{x:1.24,y:1.4,z:-1.26});XR_LANDMARKS.forEach((name,i)=>slot.hand.joints[name].position.copy(points[i]));
      const origin=world.camera.position.clone(),target=book.group.localToWorld(new THREE.Vector3(.568,y,.025));
      slot.controller.position.copy(origin);slot.controller.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,-1),target.sub(origin).normalize());slot.controller.updateMatrix();input.update(t);
    };
    frame('open',100,.23);frame('open',140,.23);frame('compact-side',200,.23);frame('compact-side',240,.23);
    const grabbed=slot.scrolling;frame('compact-side',280,-.25);const moved=book.scrollRatio>.8;
    frame('open',320,-.25);frame('open',360,-.25);const released=!slot.scrolling;
    input.releaseAll();slot.source=null;
    return {grabbed,moved,released,noStars:model.draft.stars.length===before};
  });
  for(const [key,value] of Object.entries(hands))assert.equal(value,true,'native hand '+key);
  await page.evaluate(()=>{workstation.app.world.library.setRows(64);});
  const card=await page.evaluate(()=>{const b=workstation.app.world.library;const c=[...b.cards.values()][0];return {id:c.userData.hit.userData.action.slice(7),...screenPoint(c.userData.hit)};});
  await page.mouse.click(card.x,card.y);
  await page.waitForFunction(id=>workstation.app.model.draft.shapeId===id,card.id);
  assert.equal(await page.evaluate(()=>workstation.app.world.library.visible),true,'catalogue remains open after a selection');
  await page.locator('#vr-preview').click();
  assert.equal(await page.evaluate(()=>workstation.app.world.camera.quaternion.equals(workstation.initial)),true);
  assert.equal(await page.evaluate(()=>workstation.app.world.uiAnchor.matrixWorld.equals(workstation.anchor)),true);
  await page.setViewportSize({width:390,height:844});
  await page.locator('#vr-preview').click();
  assert.equal(await page.locator('#vr-preview').isVisible(),true);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.deepEqual(errors,[]);assert.deepEqual(api,[]);
  console.log('PASS: actual desktop desk/monitor preview, native catalogue hit targets, continuous wheel/drag and controller scrolling, 200 shared presets, bounded/reused cards, opaque static glass, fixed anchors and responsive controls.');
}finally{await browser.close();}
