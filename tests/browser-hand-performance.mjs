import { chromium } from '@playwright/test';
import { existsSync } from 'node:fs';
import assert from 'node:assert/strict';

const executablePath = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const browser = await chromium.launch({ executablePath, headless: true, args: ['--enable-webgl', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:5173');
  await page.evaluate(async () => {
    const loaded = path => performance.getEntriesByType('resource').find(entry => new URL(entry.name).pathname === path)?.name || path;
    const [{ Universe }, { CanvasModel }, { HandController }] = await Promise.all([
      import(loaded('/src/scene/Universe.js')), import(loaded('/src/interaction/CanvasModel.js')), import(loaded('/src/interaction/HandController.js')),
    ]);
    const sync = Universe.prototype.syncDrawing, changed = CanvasModel.prototype.changed, tick = HandController.prototype.tick;
    Universe.prototype.syncDrawing = function(...args) { window.testScene = this; return sync.apply(this, args); };
    CanvasModel.prototype.changed = function(...args) { window.testModel = this; return changed.apply(this, args); };
    HandController.prototype.tick = function(...args) { window.testHand = this; return tick.apply(this, args); };
  });
  await page.getByRole('button', { name: '마우스로 먼저 둘러보기' }).click();
  await page.getByRole('button', { name: '새로운 우주', exact: true }).click();
  await page.waitForFunction(() => window.testHand && window.testScene && window.testModel);
  const result = await page.evaluate(async () => {
    const model = window.testModel, scene = window.testScene, hand = window.testHand;
    const stars = Array.from({ length: 48 }, (_, i) => ({ id: `s${i}`, x: .2 + i % 8 * .08, y: .2 + Math.floor(i / 8) * .1 }));
    const edges = stars.slice(1).map((star, i) => [stars[i].id, star.id]);
    model.replace(stars, edges);
    const geometry = scene.lines.geometry, position = geometry.attributes.position;
    let disposals = 0, textChanges = 0;
    geometry.addEventListener('dispose', () => disposals++);
    const observer = new MutationObserver(records => { textChanges += records.length; });
    for (const id of ['star-count', 'scene-status', 'drawing-hint'])
      observer.observe(document.getElementById(id), { subtree:true, childList:true, characterData:true });
    hand.active = true;
    hand.busy = true; // This fixture exercises render interpolation, without requesting a camera.
    hand.gate = null;
    const fixture = (x, y) => {
      const points = Array.from({ length:21 }, () => ({x:0,y:.6}));
      points[0]={x:0,y:.85}; points[9]={x:0,y:.55}; points[5]={x:-.1,y:.55}; points[17]={x:.2,y:.57};
      for (const [i,tip] of [8,12,16,20].entries()) {points[tip-2]={x:(i-1)*.1,y:.38}; points[tip]={x:(i-1)*.1,y:.12};}
      points[4]={...points[8],x:points[8].x+.02};
      const mx=(points[4].x+points[8].x)/2, my=(points[4].y+points[8].y)/2;
      return points.map(p=>({x:p.x+1-x-mx,y:p.y+y-my}));
    };
    const began = performance.now();
    await new Promise(resolve => {
      const timer = setInterval(() => {
        const now=performance.now(), elapsed=now-began;
        const x=.2+(elapsed<100?0:(1-Math.cos((elapsed-100)/700))*.035);
        hand.process([fixture(x,.2)],now,now);
        if(elapsed>1800){clearInterval(timer);resolve();}
      },34);
    });
    await new Promise(requestAnimationFrame);
    const slot=hand.slots.find(s=>s.held), box=document.querySelector('.hand-cursor').getBoundingClientRect();
    const cursorError=slot?Math.hypot(box.x+box.width/2-slot.x*innerWidth,box.y+box.height/2-slot.y*innerHeight):Infinity;
    const selected=model.stars.find(s=>s.id===slot?.held), point=selected&&scene.toWorld(selected);
    const starIndex=model.stars.indexOf(selected);
    const drawing=scene.drawingStars.geometry.attributes.position;
    const drawingError=point?Math.hypot(drawing.getX(starIndex)-point.x,drawing.getY(starIndex)-point.y):Infinity;
    observer.disconnect();
    hand.stop();
    // Maximum-density graph, partial reveal, reset, and resized coordinates
    // all need to reuse the same storage without truncating or leaving ghosts.
    const allEdges=stars.flatMap((a,i)=>stars.slice(i+1).map(b=>[a.id,b.id]));
    scene.setDrawing(model.stars,allEdges,null,true);
    scene.reveal=.5; scene.applyLineReveal();
    const denseCount=geometry.drawRange.count;
    scene.reveal=1; scene.applyLineReveal();
    const last=scene.toWorld(model.stars.find(star=>star.id===scene.edgeData.at(-1)[1]));
    const lastVertex=denseCount-1;
    const finalError=Math.hypot(position.getX(lastVertex)-last.x,position.getY(lastVertex)-last.y);
    scene.setDrawing([],[]);
    const cleared=geometry.drawRange.count;
    scene.setDrawing(model.stars,edges);
    scene.width=720; scene.height=450; scene.syncDrawing();
    const resized=scene.toWorld(model.stars[0]);
    const resizeError=Math.hypot(position.getX(0)-resized.x,position.getY(0)-resized.y);
    return {disposals,textChanges,cursorError,drawingError,denseCount,finalError,cleared,resizeError,
      stable:geometry===scene.lines.geometry&&position===scene.lines.geometry.attributes.position,
      stars:model.stars.length,edges:model.edges.length,moved:model.stars[0].x>.22};
  });
  assert.equal(result.disposals,0,'dragging/revealing/resizing never churns GPU geometry');
  assert.equal(result.stable,true);
  assert.equal(result.textChanges,0,'unchanged counts and guidance do not rebuild text during dragging');
  assert.ok(result.cursorError<1,'CSS transform keeps the cursor centered on the filtered hand');
  assert.ok(result.drawingError<.001,'rendered star follows the hand position');
  assert.equal(result.denseCount,48*47);
  assert.ok(result.finalError<.001&&result.resizeError<.001);
  assert.equal(result.cleared,0);
  assert.equal(result.stars,48); assert.equal(result.edges,47); assert.equal(result.moved,true);
  assert.deepEqual(errors,[]);
  console.log('PASS: continuous hand drag, stable GPU buffers, unchanged text, cursor alignment, all 1,128 connections, reveal/clear/resize.');
} finally { await browser.close(); }
