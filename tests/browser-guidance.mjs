import { chromium } from '@playwright/test';
import { existsSync, mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
const executablePath=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const browser=await chromium.launch({executablePath,headless:true,args:['--enable-webgl','--enable-unsafe-swiftshader']});
mkdirSync('tmp/qa',{recursive:true});
try {
  const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.route('**/api/kiosk/availability*',r=>r.fulfill({json:{occupied:false}}));
  await page.route('**/api/constellations',r=>r.fulfill({status:201,json:{id:crypto.randomUUID()}}));
  await page.goto('http://127.0.0.1:5173/');
  await page.evaluate(async()=>{
    const loaded=path=>performance.getEntriesByType('resource').find(e=>new URL(e.name).pathname===path)?.name||path;
    const {Universe}=await import(loaded('/src/scene/Universe.js')),{CanvasModel}=await import(loaded('/src/interaction/CanvasModel.js')),
      {HandController}=await import(loaded('/src/interaction/HandController.js'));
    const sync=Universe.prototype.syncDrawing,change=CanvasModel.prototype.changed,tick=HandController.prototype.tick;
    Universe.prototype.syncDrawing=function(...a){window.guideScene=this;return sync.apply(this,a);};
    CanvasModel.prototype.changed=function(...a){window.guideModel=this;return change.apply(this,a);};
    HandController.prototype.tick=function(...a){window.guideHand=this;return tick.apply(this,a);};
  });
  await page.getByRole('button',{name:'마우스로 먼저 둘러보기'}).click();
  await page.getByRole('button',{name:'새로운 우주',exact:true}).click();
  await page.mouse.click(860,430);
  await page.locator('#constellation-guidance').waitFor({state:'visible'});
  const guide=await page.evaluate(()=>({actions:window.guideScene.guidance.actions,name:document.getElementById('constellation-guidance').textContent,
    stars:window.guideModel.stars.length,visible:window.guideScene.guidanceOverlay.mesh.visible}));
  assert.equal(guide.stars,1);assert.equal(guide.visible,true);assert.ok(guide.actions.length<=2);
  await page.screenshot({path:'tmp/qa/guide-create.png'});
  for(const a of guide.actions)await page.mouse.click(a.target.x*1440,a.target.y*900);
  await page.waitForFunction(()=>!document.getElementById('discovery').hidden);
  const name=await page.locator('#result-name').innerText();assert.ok(guide.name.includes(name));
  assert.equal(await page.locator('#constellation-guidance').isHidden(),true);
  const initial=[{x:1.022708740248345,y:-.5340815834933892},{x:.4205378160811961,y:-.566735950182192},{x:.433164299488999,y:-.56465469871182}];
  await page.evaluate(points=>window.guideModel.replace(points.map((p,i)=>({id:`guide-${i}`,x:p.x/(1440/900),y:-p.y}))),initial);
  await page.locator('#constellation-guidance').waitFor({state:'visible'});
  const move=await page.evaluate(()=>({actions:window.guideScene.guidance.actions,
    count:window.guideScene.guidanceOverlay.geometry.drawRange.count,stars:structuredClone(window.guideModel.stars)}));
  assert.ok(move.actions.some(a=>a.type==='move'));
  assert.ok(move.count>=3);assert.equal(move.stars.length,3);
  await page.screenshot({path:'tmp/qa/guide-move.png'});
  const moveCaption=await page.locator('#constellation-guidance').innerText();
  for(const action of move.actions) {
    if(action.type==='move') {
      const star=move.stars.find(s=>s.id===action.starId);
      await page.mouse.move(star.x*1440,star.y*900);await page.mouse.down();
      await page.mouse.move(action.target.x*1440,action.target.y*900,{steps:8});await page.mouse.up();
    } else await page.mouse.click(action.target.x*1440,action.target.y*900);
  }
  await page.waitForFunction(()=>!document.getElementById('discovery').hidden);
  assert.ok(moveCaption.includes(await page.locator('#result-name').innerText()));
  await page.getByRole('button',{name:'새로운 우주',exact:true}).click();
  assert.equal(await page.locator('#constellation-guidance').isHidden(),true);
  await page.evaluate(async()=>{
    const hand=window.guideHand,{handPoints}=await import('/tests/fixtures/vr-hands.js');
    hand.active=true;hand.busy=true;hand.gate=null;hand.callbacks.status('active');
    hand.process([handPoints('open',{x:.5,y:.4,z:0})],performance.now());
  });
  assert.equal(await page.locator('#stage canvas').evaluate(e=>getComputedStyle(e).cursor),'none');
  assert.equal(await page.locator('#hand-guide').isHidden(),true);
  await page.evaluate(()=>window.guideHand.process([],performance.now()+300));
  await page.locator('#hand-guide').waitFor({state:'visible'});
  assert.ok((await page.locator('#hand-guide').innerText()).includes('카메라 앞에서 손을 펼쳐주세요'));
  assert.equal(await page.locator('#stage canvas').evaluate(e=>getComputedStyle(e).cursor),'crosshair');
  const box=await page.locator('#hand-guide').boundingBox();assert.ok(box.x<200 && box.y<160);
  await page.screenshot({path:'tmp/qa/hand-guide-corner.png'});
  await page.evaluate(()=>window.guideHand.stop());
  assert.deepEqual(errors,[]);
  console.log('PASS: real worker proposes one/two edits, pulse/ghost overlay never edits the drawing, following hints recognizes the named shape; move-source highlight, reset, hand-only cursor and top-left loss guidance.');
}finally{await browser.close();}
