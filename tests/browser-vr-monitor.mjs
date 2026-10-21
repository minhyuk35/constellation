import { chromium } from '@playwright/test';
import { existsSync, mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
const executablePath=['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const browser=await chromium.launch({executablePath,headless:true,args:['--enable-webgl','--enable-unsafe-swiftshader']});
mkdirSync('tmp/qa',{recursive:true});
try {
  const contexts=await Promise.all([browser.newContext(),browser.newContext(),browser.newContext()]);
  const [operator,device,other]=await Promise.all(contexts.map(c=>c.newPage())),errors=[];
  for(const page of [operator,device,other])page.on('pageerror',e=>errors.push(e.message));
  await operator.setViewportSize({width:1440,height:960});
  await operator.goto('http://127.0.0.1:5173/monitor.html');
  await operator.waitForLoadState('networkidle');
  await operator.locator('#monitor-key').fill('incorrect');await operator.locator('#monitor-connect').click();
  await operator.waitForFunction(()=>document.querySelector('#monitor-status').textContent.includes('올바르지'));
  assert.equal(await operator.locator('#device-count').textContent(),'—');
  await operator.evaluate(async()=>{
    const url=performance.getEntriesByType('resource').find(e=>new URL(e.name).pathname==='/src/monitor/MonitorView.js').name;
    const {MonitorView}=await import(url),snapshot=MonitorView.prototype.snapshot;
    MonitorView.prototype.snapshot=function(data){window.observed=this;return snapshot.call(this,data);};
  });
  await operator.locator('#monitor-key').fill('local-exhibition-only');await operator.locator('#monitor-connect').click();
  await operator.waitForFunction(()=>document.querySelector('#device-count').textContent==='0');
  await device.goto('http://127.0.0.1:5173/vr.html');await device.waitForSelector('#vr-stage canvas');
  await device.waitForTimeout(300);
  assert.equal(await operator.locator('#device-count').textContent(),'0','desktop preview is not counted');
  await device.evaluate(async()=>{
    const loaded=path=>performance.getEntriesByType('resource').find(e=>new URL(e.name).pathname===path)?.name || path;
    const {app}=await import(loaded('/src/vr/main.js'));
    const THREE=await import(performance.getEntriesByType('resource').find(e=>new URL(e.name).pathname.endsWith('/three.js')).name);
    const {XR_LANDMARKS}=await import(loaded('/src/vr/VRGestures.js'));
    window.source=app;window.THREE=THREE;
    app.world.renderer.xr.getCamera=()=>app.world.camera;
    app.action('preset:imagined-rocket');app.action('finish');app.action('preset:heart');
    app.world.anchorUI(app.world.camera);
    const slot=app.input.slots[0];slot.source={hand:{},handedness:'left'};slot.hand.visible=true;
    for(const [i,name] of XR_LANDMARKS.entries()) {
      const joint=slot.hand.joints[name]=new THREE.Object3D();joint.visible=true;
      slot.points[i].set(-.2+i*.004,1.4,-.5);
    }
    slot.controller.visible=true;slot.controller.position.set(-.2,1.4,-.5);slot.gestures.state.gesture='pinch';
    app.monitor.sent=[];const send=app.monitor.connection.send.bind(app.monitor.connection);
    app.monitor.connection.send=data=>{const sent=send(data);if(sent)app.monitor.sent.push(data.type);return sent;};
    // Drive the real sampling class using synthetic XR poses; no physical headset is emulated.
    app.monitor.start('QA Quest 01');window.monitorTimer=setInterval(()=>app.monitor.tick(performance.now()),20);
  });
  await operator.waitForFunction(()=>document.querySelector('#device-count').textContent==='1');
  await device.waitForTimeout(350);
  assert.equal(await device.evaluate(()=>source.monitor.sent.some(t=>['snapshot','frame'].includes(t))),false,'unwatched devices send no scene/pose');
  await other.goto('http://127.0.0.1:5173/entrance.html');
  await other.evaluate(async()=>{
    const {MonitorConnection}=await import('/src/monitor/connection.js');
    const {VRModel}=await import('/src/vr/VRModel.js');const {SHAPES}=await import('/src/data/shapes.js');
    const {cleanSnapshot}=await import('/src/monitor/protocol.js');
    const model=window.model=new VRModel();model.loadPreset(SHAPES.find(s=>s.id==='aries'));
    const frame={head:{position:[0,1.6,0],quaternion:[0,0,0,1],fov:90},
      ui:{position:[0,1.6,0],quaternion:[0,0,0,1],library:false,filter:'zodiac',page:0},hands:[],effects:[]};
    const conn=window.conn=new MonitorConnection('device',{heartbeat:()=>({paused:false,works:0,stars:model.draft.stars.length,hands:0}),
      message:data=>{if(data.type==='watchers' && data.count>0) {
        conn.send({type:'snapshot',state:cleanSnapshot(model)});conn.send({type:'frame',frame});
      }}});
    conn.start({name:'QA Quest 02',platform:'WebXR fixture'});
    window.frame=frame;window.tick=setInterval(()=>conn.send({type:'frame',frame}),150);
  });
  await operator.waitForFunction(()=>document.querySelector('#device-count').textContent==='2');
  await operator.getByRole('button',{name:/QA Quest 01/}).click();
  await operator.waitForFunction(()=>document.querySelector('#view-state').textContent==='LIVE');
  const first=await operator.evaluate(()=>({works:observed.model.works.length,draft:observed.model.draft.shapeId,
    head:observed.target.head.position,hands:observed.target.hands.length,joints:observed.hands[0].joints.count,
    entities:observed.world.entries.size,aspect:observed.world.camera.aspect,
    width:document.querySelector('#monitor-stage').clientWidth/ document.querySelector('#monitor-stage').clientHeight,
    stars:observed.model.draft.stars.length}));
  assert.equal(first.works,1);assert.equal(first.draft,'heart');assert.equal(first.hands,1);assert.equal(first.joints,21);
  assert.equal(first.entities,2);assert.ok(Math.abs(first.aspect-first.width)<.01);
  await device.evaluate(()=>{source.world.camera.position.x=.42;source.model.add(new THREE.Vector3(.12,1.55,-.7));});
  await operator.waitForFunction(count=>observed.target.head.position[0]===.42 && observed.model.draft.stars.length===count,first.stars+1);
  const srcStar=await device.evaluate(()=>source.model.draft.stars.at(-1));
  const copy=await operator.evaluate(()=>observed.model.draft.stars.at(-1));
  assert.equal(copy.id,srcStar.id);for(const axis of ['x','y','z'])assert.ok(Math.abs(copy[axis]-srcStar[axis])<.0001);
  await device.evaluate(()=>{const m=source.model;m.remove({entity:m.draft,star:m.draft.stars.at(-1)});source.world.library.visible=true;source.world.library.action('filter:object');});
  await operator.waitForFunction(count=>observed.model.draft.stars.length===count && observed.world.library.visible && observed.world.library.filter==='object',first.stars);
  const scroll=await device.evaluate(()=>{source.world.library.scrollBy(4.375);return source.world.library.scrollRatio;});
  await operator.waitForFunction(scroll=>Math.abs(observed.world.library.scrollRatio-scroll)<.0002,scroll);
  await operator.locator('[data-view="space"]').click();await operator.waitForFunction(()=>observed.headMarker.visible);
  await operator.screenshot({path:'tmp/qa/vr-monitor-space.png'});
  await operator.locator('[data-view="head"]').click();
  await operator.getByRole('button',{name:/QA Quest 02/}).click();
  await operator.waitForFunction(()=>document.querySelector('#view-state').textContent==='LIVE' && observed.model.draft.shapeId==='aries');
  assert.equal(await operator.evaluate(()=>observed.model.works.length),0);assert.equal(await operator.evaluate(()=>observed.target.hands.length),0);
  await device.waitForFunction(()=>!source.monitor.watched);
  const before=await device.evaluate(()=>source.monitor.sent.filter(t=>t==='frame').length);
  await device.waitForTimeout(350);
  assert.equal(await device.evaluate(()=>source.monitor.sent.filter(t=>t==='frame').length),before,'unselected device stops streaming');
  await operator.screenshot({path:'tmp/qa/vr-monitor-live.png'});
  await other.evaluate(()=>{clearInterval(tick);conn.stop();});
  await operator.waitForFunction(()=>document.querySelector('#device-count').textContent==='1');
  await operator.waitForFunction(()=>document.querySelector('#viewer-message').textContent.includes('종료'));
  await operator.getByRole('button',{name:/QA Quest 01/}).click();
  await operator.waitForFunction(()=>document.querySelector('#view-state').textContent==='LIVE');
  await device.evaluate(()=>{source.monitor.paused=true;source.monitor.connection.beat();});
  await operator.waitForFunction(()=>document.querySelector('#view-state').textContent==='일시정지');
  await device.evaluate(()=>{source.monitor.paused=false;source.monitor.connection.socket.close();});
  await operator.waitForFunction(()=>document.querySelector('#view-state').textContent==='LIVE',{timeout:15000});
  await operator.setViewportSize({width:390,height:844});
  assert.equal(await operator.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await operator.screenshot({path:'tmp/qa/vr-monitor-mobile.png',fullPage:true});
  await device.evaluate(()=>{clearInterval(monitorTimer);source.monitor.stop();});
  await operator.waitForFunction(()=>document.querySelector('#device-count').textContent==='0');
  await operator.locator('#monitor-disconnect').click();
  assert.equal(await operator.locator('#device-count').textContent(),'—');
  assert.deepEqual(errors,[]);
  console.log('PASS: protected login, desktop excluded, two devices, real VR sampler, selected-only stream, scene edits, hand joints, viewpoint/overview, catalogue, pause/reconnect/exit, responsive UI. Synthetic poses; physical headset not tested.');
}finally{await browser.close();}
