import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--enable-webgl','--enable-unsafe-swiftshader']});
mkdirSync('tmp/qa',{recursive:true});
try {
  const operator=await browser.newPage({viewport:{width:1440,height:1000}}),device=await browser.newPage(),other=await browser.newPage(),errors=[];
  for(const p of [operator,device,other]){p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')errors.push(m.text()+' '+m.location().url);});}
  await operator.goto('http://127.0.0.1:5173/monitor.html');await operator.locator('#monitor-key').fill('local-exhibition-only');await operator.locator('#monitor-connect').click();
  await operator.waitForFunction(()=>document.querySelector('#device-count').textContent==='0');
  await device.goto('http://127.0.0.1:5173/vr.html');await device.waitForLoadState('networkidle');
  const rest=await device.evaluate(async()=>{
    const resources=performance.getEntriesByType('resource'),loaded=p=>resources.find(e=>new URL(e.name).pathname===p)?.name||p;
    const {app}=await import(loaded('/src/vr/main.js')),THREE=await import(resources.find(e=>new URL(e.name).pathname.endsWith('/three.js')).name);
    const {XR_LANDMARKS}=await import(loaded('/src/vr/VRGestures.js')),{handPoints}=await import('/tests/fixtures/vr-hands.js');
    window.source=app;const {world,input,model}=app;world.renderer.setAnimationLoop(null);
    const head=new THREE.PerspectiveCamera();head.position.set(0,1.6,0);world.renderer.xr.getCamera=()=>head;world.renderer.xr.getReferenceSpace=()=>({});world.renderer.xr.isPresenting=true;
    world.queueUIAnchor();world.updateUIAnchor({getViewerPose:()=>({})});
    const slot=input.slots[0];slot.source={hand:{},handedness:'right'};slot.hand.visible=true;slot.controller.visible=true;
    for(const name of XR_LANDMARKS){const joint=new THREE.Object3D();slot.hand.joints[name]=joint;slot.hand.add(joint);}
    window.native=(gesture,t,anchor={x:0,y:1.4,z:-.55})=>{
      const points=handPoints(gesture,anchor);XR_LANDMARKS.forEach((name,i)=>slot.hand.joints[name].position.copy(points[i]));
      slot.controller.position.copy(head.position);slot.controller.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,-1),new THREE.Vector3(anchor.x,anchor.y,anchor.z).sub(head.position).normalize());slot.controller.updateMatrix();input.update(t);
    };
    app.action('preset:heart');app.action('finish');
    for(const t of [100,140,1400])native('fist',t,{x:0,y:.7,z:-.2});
    native('fist',1500);native('fist',2600);const noRest=model.draft.stars.length===0;
    for(const t of [2700,2740,2940])native('open',t);native('fist',3000);native('fist',3040);native('fist',4200);
    const deliberate=model.draft.stars.length===1;
    window.original=JSON.stringify({draft:model.draft,works:model.works,history:model.history,anchor:model.anchor});
    app.monitor.start('QA Guide 01');window.beat=setInterval(()=>app.monitor.tick(performance.now()),20);
    return {noRest,deliberate};
  });assert.equal(rest.noRest,true);assert.equal(rest.deliberate,true);
  await other.route('**/favicon.ico',route=>route.fulfill({status:204,body:''}));
  await other.goto('http://127.0.0.1:5173/entrance.html');
  await other.evaluate(async()=>{const {MonitorConnection}=await import('/src/monitor/connection.js');window.commands=[];window.conn=new MonitorConnection('device',{heartbeat:()=>({paused:false,works:0,stars:0,hands:0}),message:m=>{if(m.type==='command')commands.push(m);}});conn.start({name:'QA Guide 02',platform:'QA'});});
  await operator.getByRole('button',{name:/QA Guide 01/}).click();await operator.waitForFunction(()=>document.querySelector('#view-state').textContent==='LIVE');
  await operator.locator('#tutorial-start').click();await device.waitForFunction(()=>source.tutorial.step==='ready');
  await operator.waitForFunction(()=>document.querySelector('#tutorial-phase').textContent.includes('손 펴기'));
  const blocked=await device.evaluate(()=>{
    const {tutorial,model,input,monitor}=source,id=model.draft.id;source.action('preset:aries');source.action('finish');source.action('undo');input.create({x:0,y:1.5,z:-.5});
    const requestId=[...monitor.recentCommands.keys()].at(-1);monitor.connection.onMessage({type:'command',requestId,action:'tutorial-start'});
    return {blocked:tutorial.step==='ready'&&model.draft.stars.length===0&&model.works.length===0,duplicate:model.draft.id===id};
  });assert.equal(blocked.blocked,true);assert.equal(blocked.duplicate,true);
  await operator.screenshot({path:'tmp/qa/vr-tutorial-dashboard.png'});
  await device.evaluate(()=>{native('open',5000);native('open',5040);native('open',5400);});
  await operator.waitForFunction(()=>document.querySelector('#tutorial-phase').textContent.includes('별 생성'));
  await device.evaluate(()=>{native('fist',5500);native('fist',5540);native('fist',6700);native('fist',7100);});
  await operator.waitForFunction(()=>document.querySelector('#tutorial-phase').textContent.includes('별 집기'));
  assert.equal(await device.evaluate(()=>source.model.draft.stars.length),1);
  await device.evaluate(()=>{native('compact-side',7200);native('compact-side',7240);});
  await operator.waitForFunction(()=>document.querySelector('#tutorial-phase').textContent.includes('별 옮기기'));
  await device.evaluate(()=>{const p=source.tutorial.target;native('compact-side',7300,{x:p.x,y:p.y,z:p.z});native('compact-side',7340,{x:p.x,y:p.y,z:p.z});native('open',7400,{x:p.x,y:p.y,z:p.z});native('open',7440,{x:p.x,y:p.y,z:p.z});});
  await operator.waitForFunction(()=>document.querySelector('#tutorial-phase').textContent.includes('흔들어'));
  await device.evaluate(()=>{
    const {model,tutorial}=source,p=model.world(tutorial.practice.entity,tutorial.practice.star);
    native('compact-side',7500,p);native('compact-side',7540,p);
    for(const [x,t] of [[.4,7600],[.08,7660],[.4,7720],[.08,7780]])native('compact-side',t,{x,y:p.y,z:p.z});
  });
  await operator.waitForFunction(()=>document.querySelector('#tutorial-phase').textContent.includes('준비 완료'));
  await device.evaluate(()=>source.tutorial.tick(source.tutorial.since+2500));
  await operator.waitForFunction(()=>document.querySelector('#tutorial-phase').textContent==='자유 체험');
  assert.equal(await device.evaluate(()=>{const m=source.model;return JSON.stringify({draft:m.draft,works:m.works,history:m.history,anchor:m.anchor})===original;}),true);
  await operator.locator('#tutorial-start').click();await device.waitForFunction(()=>source.tutorial.active);
  await operator.waitForFunction(()=>!document.querySelector('#tutorial-stop').disabled);await operator.locator('#tutorial-stop').click();
  await device.waitForFunction(()=>!source.tutorial.active);
  assert.equal(await device.evaluate(()=>{const m=source.model;return JSON.stringify({draft:m.draft,works:m.works,history:m.history,anchor:m.anchor})===original;}),true);
  assert.equal(await other.evaluate(()=>commands.length),0,'commands never reach another device');
  await device.evaluate(()=>{clearInterval(beat);source.monitor.stop();source.world.renderer.xr.isPresenting=false;});await other.evaluate(()=>conn.stop());
  assert.deepEqual(errors,[]);
  console.log('PASS: dashboard-controlled native tutorial, step gating and progress, resting-fist rejection, deliberate creation, real compact pinch/move/release/shake, duplicate command idempotency, per-device isolation, cancellation and exact work/undo restoration.');
}finally{await browser.close();}
