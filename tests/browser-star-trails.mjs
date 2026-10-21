import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--enable-webgl','--enable-unsafe-swiftshader']});
mkdirSync('tmp/qa',{recursive:true});
try {
  const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto('http://127.0.0.1:5173/');
  await page.evaluate(async()=>{
    const loaded=p=>performance.getEntriesByType('resource').find(e=>new URL(e.name).pathname===p)?.name||p;
    const {Universe}=await import(loaded('/src/scene/Universe.js')),{CanvasModel}=await import(loaded('/src/interaction/CanvasModel.js'));
    const sync=Universe.prototype.syncDrawing,changed=CanvasModel.prototype.changed;
    Universe.prototype.syncDrawing=function(...a){window.trailScene=this;return sync.apply(this,a);};
    CanvasModel.prototype.changed=function(...a){window.trailModel=this;return changed.apply(this,a);};
  });
  await page.getByRole('button',{name:'마우스로 먼저 둘러보기'}).click();await page.getByRole('button',{name:'새로운 우주',exact:true}).click();
  await page.mouse.click(680,410);await page.waitForTimeout(1250);
  await page.mouse.move(680,410);await page.mouse.down();
  for(let i=1;i<=15;i++){await page.mouse.move(680+i*6,410-i*1.5);await page.waitForTimeout(12);}
  const web=await page.evaluate(()=>({emitted:trailScene.starTrails.emitted,held:trailModel.dragging,stars:trailModel.stars.length,visible:trailScene.starTrails.mesh.visible}));
  assert.ok(web.emitted>0);assert.equal(web.held,true);assert.equal(web.stars,1);assert.equal(web.visible,true);
  await page.screenshot({path:'tmp/qa/web-star-drag-trail.png'});
  await page.mouse.up();await page.waitForTimeout(350);
  assert.equal(await page.evaluate(()=>trailScene.starTrails.mesh.visible),false);
  await page.goto('http://127.0.0.1:5173/vr.html');await page.waitForLoadState('networkidle');
  const vr=await page.evaluate(async()=>{
    const r=performance.getEntriesByType('resource'),{app}=await import(r.find(e=>new URL(e.name).pathname==='/src/vr/main.js').name);
    const THREE=await import(r.find(e=>new URL(e.name).pathname.endsWith('/three.js')).name);
    const {world,model,input}=app;world.renderer.setAnimationLoop(null);world.camera.position.set(0,1.6,0);world.camera.quaternion.identity();world.camera.updateMatrixWorld(true);
    const target=model.add(new THREE.Vector3(-.12,1.6,-.7));
    // Other stars in the same editing constellation must not consume trail slots.
    for(let i=0;i<12;i++)model.add(new THREE.Vector3(.25+i*.01,1.9,-.7));
    const slot=input.slots[0],pose={origin:new THREE.Vector3(0,1.6,0),direction:new THREE.Vector3(0,0,-1),point:model.world(target.entity,target.star)};
    input.begin(slot,pose);
    window.trailVR={app,target,THREE};window.trailStart=performance.now();
    for(let i=0;i<20;i++){model.move(target,new THREE.Vector3(-.12+i*.008,1.6+i*.001,-.7));world.frame(trailStart+i*.01);}
    world.particles.mesh.visible=false;world.renderer.render(world.scene,world.camera);
    return {grabbed:slot.holding?.star.id===target.star.id,emitted:world.starTrails.emitted,tracks:world.starTrails.tracks.size,visible:world.starTrails.mesh.visible,stars:model.draft.stars.length,attributes:world.starTrails.geometry.attributes.aStart.count};
  });
  assert.equal(vr.grabbed,true);assert.ok(vr.emitted>10);assert.equal(vr.tracks,1);assert.equal(vr.visible,true);assert.equal(vr.stars,13);assert.equal(vr.attributes,96);
  await page.screenshot({path:'tmp/qa/vr-star-drag-trail.png'});
  const ended=await page.evaluate(()=>{
    const {app,target,THREE}=trailVR,{world,model,input}=app;
    input.releaseAll();const emitted=world.starTrails.emitted;
    world.frame(performance.now()+400);const faded=!world.starTrails.mesh.visible;
    app.action('undo');const noUndoStreak=world.starTrails.emitted===emitted;
    world.reducedMotion=true;model.move(target,new THREE.Vector3(.06,1.65,-.7));world.frame(performance.now());
    return {faded,noUndoStreak,reduced:!world.starTrails.mesh.visible};
  });
  assert.deepEqual(ended,{faded:true,noUndoStreak:true,reduced:true});
  assert.deepEqual(errors,[]);console.log('PASS: actual web pointer drag, VR grab/move path, one moving star among stationary stars, short fade after release, bounded GPU pool, undo and reduced motion.',JSON.stringify({web,vr}));
}finally{await browser.close();}
