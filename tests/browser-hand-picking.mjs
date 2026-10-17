import { chromium } from '@playwright/test';
import { existsSync, mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';

const executablePath = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const browser = await chromium.launch({ executablePath, headless:true,
  args:['--enable-webgl','--enable-unsafe-swiftshader'] });
mkdirSync('tmp/qa',{recursive:true});
try {
  const page = await browser.newPage({viewport:{width:1440,height:900}}), errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:5173/');
  await page.evaluate(async()=>{
    const loaded = path => performance.getEntriesByType('resource').find(e=>new URL(e.name).pathname===path)?.name||path;
    const [{Universe},{CanvasModel},{HandController},{handPoints}] = await Promise.all([
      import(loaded('/src/scene/Universe.js')),import(loaded('/src/interaction/CanvasModel.js')),
      import(loaded('/src/interaction/HandController.js')),import('/tests/fixtures/vr-hands.js')]);
    const sync=Universe.prototype.syncDrawing,changed=CanvasModel.prototype.changed,tick=HandController.prototype.tick;
    Universe.prototype.syncDrawing=function(...a){window.pickScene=this;return sync.apply(this,a);};
    CanvasModel.prototype.changed=function(...a){window.pickModel=this;return changed.apply(this,a);};
    HandController.prototype.tick=function(...a){window.pickHand=this;return tick.apply(this,a);};
    window.pickFixture=(x,y,gesture='pinch')=>{
      const points=handPoints(gesture,{x:0,y:0,z:0});
      const anchor=gesture==='fist'?points[9]:{x:(points[4].x+points[8].x)/2,y:(points[4].y+points[8].y)/2};
      return points.map(p=>({x:1-x+p.x-anchor.x,y:y-p.y+anchor.y,z:0}));
    };
    window.pickFrame=async(x,y,gesture='pinch')=>{
      const now=performance.now();window.pickHand.process([window.pickFixture(x,y,gesture)],now,now);
      await new Promise(r=>setTimeout(r,45));
    };
    window.pickReset=(zoom=1,stars=[{id:'target',x:.74,y:.35}])=>{
      const h=window.pickHand,s=window.pickScene;
      h.releaseAll();h.active=true;h.busy=true;h.gate=null;
      window.pickModel.replace(stars);
      s.zoom=s.zoomTarget=zoom;s.camera.position.z=s.baseCameraZ*zoom;
      s.camera.updateMatrixWorld();
    };
  });
  await page.getByRole('button',{name:'마우스로 먼저 둘러보기'}).click();
  await page.getByRole('button',{name:'새로운 우주',exact:true}).click();
  await page.waitForFunction(()=>window.pickHand&&window.pickScene&&window.pickModel);
  for(const zoom of [1,1.8,3.5]) {
    for(const offset of [69,52,30,18,0]) {
      const result=await page.evaluate(async({zoom,offset})=>{
        window.pickReset(zoom);
        const star=window.pickModel.stars[0],p=window.pickScene.toScreen(star);
        p.x-=offset/innerWidth;
        await window.pickFrame(p.x,p.y);await window.pickFrame(p.x,p.y);
        return {held:window.pickModel.draggers.has(star.id),count:window.pickModel.stars.length};
      },{zoom,offset});
      assert.equal(result.held,offset===0,`zoom ${zoom}, ${offset}px cursor separation`);
      assert.equal(result.count,1);
      if(zoom===1&&offset===69)await page.screenshot({path:'tmp/qa/hand-pick-separated.png'});
    }
    const drag=await page.evaluate(async()=>{
      const h=window.pickHand,s=window.pickScene,m=window.pickModel,star=m.stars[0];
      const initial=s.toScreen(star),target={x:initial.x+.015,y:initial.y+.008};
      for(let i=0;i<4;i++)await window.pickFrame(target.x,target.y);
      s.zoomTarget=1.2;
      for(let i=0;i<4;i++)await window.pickFrame(target.x,target.y);
      const slot=h.slots.find(slot=>slot.held),p=s.toScreen(star);
      return {error:slot?Math.hypot((p.x-slot.x-slot.grabOffset.x)*innerWidth,
        (p.y-slot.y-slot.grabOffset.y)*innerHeight):Infinity,count:m.stars.length};
    });
    assert.ok(drag.error<.75,`star/cursor stay aligned during zoom: ${drag.error}px`);
    assert.equal(drag.count,1);
  }
  // Mouse picking, dragging and undo use the same projection, retaining 25px tolerance.
  const point=await page.evaluate(()=>{
    window.pickReset(2);window.pickHand.stop();return window.pickScene.toScreen(window.pickModel.stars[0]);
  });
  await page.mouse.move(point.x*1440,point.y*900);await page.mouse.down();
  assert.equal(await page.evaluate(()=>window.pickModel.dragging),true);
  await page.mouse.move(point.x*1440+20,point.y*900+10,{steps:4});await page.mouse.up();
  assert.equal(await page.evaluate(()=>window.pickModel.stars.length),1);
  await page.keyboard.press('Control+z');
  assert.ok(await page.evaluate(()=>Math.abs(window.pickModel.stars[0].x-.74)<1e-9));
  // Fists still create at the displayed pointer location, with the existing hold time.
  const created=await page.evaluate(async()=>{
    window.pickReset(2,[]);
    const h=window.pickHand,s=window.pickScene,burst=h.callbacks.burst;
    let placed;
    h.callbacks.burst=(p,...args)=>{
      const slot=h.slots.find(slot=>slot.gesture==='fist');
      placed={screen:s.toScreen(p),cursor:{x:slot.x,y:slot.y}};burst(p,...args);
    };
    for(let i=0;i<28;i++)await window.pickFrame(.42,.48,'fist');
    h.callbacks.burst=burst;
    return {count:window.pickModel.stars.length,...placed};
  });
  assert.equal(created.count,1);
  assert.ok(Math.hypot(created.screen.x-created.cursor.x,created.screen.y-created.cursor.y)<.001,JSON.stringify(created));
  assert.deepEqual(errors,[]);
  console.log('PASS: separated cursor cannot grab; real screen picking at 1–3.5x zoom, continuous drag through zoom, mouse/undo and fist placement.');
} finally {await browser.close();}
