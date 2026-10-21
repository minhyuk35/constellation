import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--enable-webgl','--enable-unsafe-swiftshader']});mkdirSync('tmp/qa',{recursive:true});
try {
  const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto('http://127.0.0.1:5173/vr.html');await page.waitForLoadState('networkidle');
  const flight=await page.evaluate(async()=>{
    const resources=performance.getEntriesByType('resource'),loaded=p=>resources.find(e=>new URL(e.name).pathname===p).name;
    const {app}=await import(loaded('/src/vr/main.js')),THREE=await import(resources.find(e=>new URL(e.name).pathname.endsWith('/three.js')).name);
    window.fx={app,THREE};const {world,model}=app;world.renderer.setAnimationLoop(null);document.body.classList.add('in-vr');
    world.camera.position.set(0,1.6,0);world.camera.quaternion.identity();
    app.action('preset:heart');const before=model.draft.stars.map(s=>model.world(model.draft,s));app.action('finish');
    const entity=model.works.at(-1),entry=world.entries.get(entity.id),f=entry.flight,original=JSON.stringify(entity);
    world.frame(f.start);entry.group.updateWorldMatrix(true,false);
    const start=entity.stars.every((s,i)=>new THREE.Vector3(s.x,s.y,s.z).applyMatrix4(entry.group.matrixWorld).distanceTo(before[i])<.00001);
    world.frame(f.start+1400);entry.group.updateWorldMatrix(true,false);
    const halfway=entry.group.position.distanceTo(entity.position)>.1&&entry.group.position.distanceTo(f.from)>.1&&entry.group.position.distanceTo(f.head)>.25&&entry.group.matrixWorld.elements.every(Number.isFinite);
    world.renderer.render(world.scene,world.camera);
    window.arrival=f.start+2800;return {start,halfway,unchanged:JSON.stringify(entity)===original};
  });
  assert.equal(flight.start,true);assert.equal(flight.halfway,true);assert.equal(flight.unchanged,true);
  await page.screenshot({path:'tmp/qa/vr-flight-midway.png'});
  const arrived=await page.evaluate(()=>{
    const {world,model}=fx.app,entity=model.works.at(-1),entry=world.entries.get(entity.id);world.frame(arrival);world.frame(arrival+550);world.renderer.render(world.scene,world.camera);
    return {landed:!entry.flight&&entry.group.position.distanceTo(entity.position)<.000001,kind:world.particles.lastEffect.kind,count:world.particles.emitted,core:entry.cluster.uniforms.uCoreScale.value};
  });assert.equal(arrived.landed,true);assert.equal(arrived.kind,'place');assert.equal(arrived.count,3);assert.equal(arrived.core,1);
  await page.screenshot({path:'tmp/qa/vr-placement-wave.png'});
  const undo=await page.evaluate(()=>{const {app,THREE}=fx;app.action('preset:aries');app.action('finish');const entry=app.world.entries.get(app.model.works.at(-1).id);const moving=!!entry.flight;app.action('undo');app.world.frame(performance.now());return moving&&!entry.flight&&entry.group.matrixWorld.elements.every(Number.isFinite);});assert.equal(undo,true);
  const directions=await page.evaluate(()=>{
    const {app}=fx,{world,model}=app;
    for(let i=0;i<8;i++) {
      app.action('preset:aries');app.action('finish');const entry=world.entries.get(model.works.at(-1).id),f=entry.flight;
      for(let n=0;n<=20;n++){world.frame(f.start+n/20*f.duration);if(!entry.group.matrixWorld.elements.every(Number.isFinite)||entry.group.position.distanceTo(f.head)<.25-1e-6)return false;}
    }return true;
  });assert.equal(directions,true,'all 360 degree placement directions stay finite and outside the head');
  for(const kind of ['create','delete','place']) {
    await page.evaluate(kind=>{
      const {world}=fx.app,a=world.particles.geometry.attributes.aLife;for(let i=0;i<a.count;i++)a.setXYZW(i,-100,1,0,0);a.needsUpdate=true;
      world.particles.until=0;world.particles.emit({x:0,y:1.65,z:-1},{kind,radius:.25,now:10});world.frame(10320);world.renderer.render(world.scene,world.camera);
    },kind);await page.screenshot({path:`tmp/qa/vr-${kind}-wave.png`});
  }
  const still=await browser.newPage({reducedMotion:'reduce'});await still.goto('http://127.0.0.1:5173/vr.html');await still.waitForLoadState('networkidle');
  assert.equal(await still.evaluate(async()=>{const r=performance.getEntriesByType('resource');const {app}=await import(r.find(e=>new URL(e.name).pathname==='/src/vr/main.js').name);app.action('preset:heart');app.action('finish');return !app.world.entries.get(app.model.works.at(-1).id).flight&&app.world.particles.emitted===0;}),true);
  assert.deepEqual(errors,[]);console.log('PASS: exact shape continuity at launch, gradual finite head-safe flight, untouched model coordinates, one placement wave after landing, undo during flight, distinct wave renders and reduced-motion handling.');
}finally{await browser.close();}
