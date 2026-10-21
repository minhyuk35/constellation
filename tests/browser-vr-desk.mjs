import {chromium} from '@playwright/test';
import {existsSync,mkdirSync} from 'node:fs';
import assert from 'node:assert/strict';
const executablePath=['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const browser=await chromium.launch({executablePath,headless:true,args:['--enable-webgl','--enable-unsafe-swiftshader']});
mkdirSync('tmp/qa',{recursive:true});
try {
  const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[],api=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  page.on('request',r=>{if(r.url().includes('/api/'))api.push(r.url());});
  await page.goto('http://127.0.0.1:5173/vr.html');
  await page.waitForSelector('#vr-stage canvas');
  await page.evaluate(async()=>{
    const resources=performance.getEntriesByType('resource');
    const {app}=await import(resources.find(e=>new URL(e.name).pathname==='/src/vr/main.js').name);
    const THREE=await import(resources.find(e=>new URL(e.name).pathname.endsWith('/three.js')).name);
    window.deskTest={app,THREE};app.action('preset:imagined-rocket');
  });
  await page.waitForFunction(()=>{
    const {model,world}=window.deskTest.app;return !!world.entries.get(model.draft.id)?.artMesh;
  });
  const result=await page.evaluate(()=>{
    const {app,THREE}=window.deskTest,{world,input}=app,{Vector3,Euler,PerspectiveCamera}=THREE;
    world.renderer.setAnimationLoop(null);
    const opacity=world.entries.get(app.model.draft.id).artMesh.material.uniforms.uOpacity.value;
    const head=new PerspectiveCamera();head.position.set(0,1.6,0);
    world.renderer.xr.getCamera=()=>head;world.renderer.xr.getReferenceSpace=()=>({});
    world.renderer.xr.isPresenting=true;
    const tracked={getViewerPose:()=>({})};
    world.queueUIAnchor();world.updateUIAnchor({getViewerPose:()=>null});
    const waiting=world.uiAnchorPending&&!world.panel.visible;
    world.updateUIAnchor(tracked);world.frame(performance.now());
    const center=world.panel.getWorldPosition(new Vector3()),normal=new Vector3(0,0,1)
      .applyQuaternion(world.panel.getWorldQuaternion(new THREE.Quaternion()));
    const root=world.uiAnchor.matrixWorld.clone();
    head.position.set(.3,1.5,.2);head.quaternion.setFromEuler(new Euler(.5,1.2,.2,'YXZ'));
    world.updateUIAnchor(tracked);world.frame(performance.now());
    world.uiAnchor.updateWorldMatrix(true,true);
    const fixed=world.uiAnchor.matrixWorld.equals(root);
    head.position.set(0,1.6,0);head.quaternion.identity();
    const hit=button=>{
      const origin=head.position.clone(),p=button.getWorldPosition(new Vector3());
      return {origin,direction:p.sub(origin).normalize(),point:button.getWorldPosition(new Vector3())};
    };
    const actions=world.buttons.map(b=>world.actionAt(hit(b).origin,hit(b).direction));
    const libraryButton=world.buttons.find(b=>b.userData.action==='tutorial');
    input.begin(input.slots[0],hit(libraryButton));world.frame(performance.now());
    const opened=app.tutorial.active&&world.library.visible;
    const bookRoot=world.library.group.matrixWorld.clone();
    head.quaternion.setFromEuler(new Euler(.4,-1.3,.1,'YXZ'));
    world.updateUIAnchor(tracked);world.frame(performance.now());
    world.library.group.updateWorldMatrix(true,true);
    const bookFixed=world.library.group.matrixWorld.equals(bookRoot);
    head.quaternion.identity();
    input.begin(input.slots[0],hit(libraryButton));world.frame(performance.now());
    const closed=!app.tutorial.active&&world.library.visible&&world.panel.visible;
    // Rendering below is a desktop view of the real scene, not an emulated stereo session.
    world.renderer.xr.isPresenting=false;
    world.camera.position.set(0,1.6,0);world.camera.lookAt(0,1.18,-1);
    world.renderer.render(world.scene,world.camera);
    document.body.classList.add('in-vr');
    return {waiting,fixed,bookFixed,opened,closed,actions,opacity,
      parent:world.uiAnchor.parent===world.scene&&world.panel.parent===world.uiAnchor&&world.library.group.parent===world.uiAnchor,
      drop:1.6-center.y,forward:-center.z,tilt:normal.y};
  });
  assert.equal(result.waiting,true);assert.equal(result.fixed,true);assert.equal(result.bookFixed,true);
  assert.equal(result.parent,true);assert.equal(result.opened,true);assert.equal(result.closed,true);
  assert.deepEqual(result.actions,['finish','undo','tutorial','exit']);
  assert.ok(result.drop>.65&&result.forward>1&&result.tilt>.8,'desk is low, in front and tilted upward');
  assert.equal(result.opacity,.76);
  assert.deepEqual(api,[]);assert.deepEqual(errors,[]);
  await page.screenshot({path:'tmp/qa/vr-fixed-desk.png'});
  console.log('PASS: first tracked-pose anchoring, low tilted desk, fixed panel/library under head movement, all ray targets, actual input opening/closing catalogue, VR-only 76% artwork.');
}finally{await browser.close();}
