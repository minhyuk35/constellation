import test from 'node:test';
import assert from 'node:assert/strict';
import {Vector3,Quaternion,Euler} from 'three';
import {classifyHand,HandGestureState} from '../src/interaction/gestures.js';
import {VRGestures} from '../src/vr/VRGestures.js';
import {HandController} from '../src/interaction/HandController.js';
import {CanvasModel} from '../src/interaction/CanvasModel.js';
import {handPoints} from './fixtures/vr-hands.js';

test('a bent thumb/index pinch with three folded fingers is distinct from a fist in any 3D orientation',()=>{
  let seed=928;const rand=()=>((seed=(seed*1664525+1013904223)>>>0)/4294967296);
  for(let i=0;i<180;i++) {
    const q=new Quaternion().setFromEuler(new Euler(rand()*6.28,rand()*6.28,rand()*6.28));
    const scale=.65+rand()*1.3;
    for(const gesture of ['precision','compact-side','compact-depth','fist']) {
      const points=handPoints(gesture,{x:0,y:0,z:0});
      if(gesture==='fist')points[4]={...points[8]};
      const transformed=points.map(p=>new Vector3(p.x+(rand()-.5)*.001,p.y+(rand()-.5)*.001,p.z+(rand()-.5)*.001)
        .multiplyScalar(scale).applyQuaternion(q).add(new Vector3(1,1.4,-.5)));
      const result=classifyHand(transformed);
      assert.equal(result.extended,0);assert.equal(result.gesture,gesture==='fist'?'fist':'pinch');
      assert.equal(result.opposition,gesture!=='fist');
    }
  }
});
test('precision pinch keeps distance/time hysteresis and releases when thumb/index separate',()=>{
  const points=handPoints('precision'),state=new HandGestureState();
  assert.notEqual(state.update(points,0),'pinch');assert.equal(state.update(points,40),'pinch');
  points[4].x=points[8].x+.04;
  assert.equal(classifyHand(points).gesture,'point');assert.equal(classifyHand(points,'pinch').gesture,'pinch');
  assert.equal(state.update(points,80),'pinch');
  points[4].x=points[8].x+.065;
  assert.equal(state.update(points,120),'pinch');assert.equal(state.update(points,160),'point');
  assert.equal(classifyHand(points.map((p,i)=>i===8?{...p,x:NaN}:p)).gesture,'lost');
});
test('opening a fist into precision pinch cancels creation before its hold deadline and grabs once',()=>{
  const state=new VRGestures(),fist=handPoints('fist'),pinch=handPoints('precision');
  state.update(fist,0);state.update(fist,40);assert.equal(state.update(fist,1040).spawn,false);
  const pending=state.update(pinch,1090);assert.equal(pending.spawn,false);
  assert.equal(state.update(pinch,1130).grab,true);
  for(let t=1170;t<3400;t+=40){const r=state.update(pinch,t);assert.equal(r.spawn,false);assert.equal(r.grab,false);}
  state.update(fist,3500);assert.equal(state.update(fist,3540).release,true);
  assert.equal(state.update(fist,4600).spawn,true);assert.equal(state.update(fist,6000).spawn,false);
});
test('web controller grabs, moves and releases a real star with the folded-three-finger pinch without creating extras',()=>{
  const layer={children:[],append(el){this.children.push(el);}};
  globalThis.window={addEventListener(){}};
  globalThis.document={hidden:false,addEventListener(){},getElementById:()=>layer,querySelector:()=>null,
    createElement:()=>({style:{setProperty(){}}})};
  const model=new CanvasModel(),star=model.add(.5,.5);
  const controller=new HandController({readyState:0,pause(){}},{clientWidth:1000,clientHeight:1000},model,
    {burst(){},chime(){},toast(){},hands(){},status(){}},{exclusive:false});controller.active=true;
  const pose=(gesture,x=.5)=>handPoints(gesture,{x:0,y:0,z:0}).map(p=>({x:1-x+p.x,y:.5-p.y,z:p.z}));
  const frame=(gesture,time,x=.5)=>{controller.process([pose(gesture,x)],time,time);controller.tick(time+50);};
  frame('precision',1000);frame('precision',1040);assert.equal(model.draggers.has(star.id),true);
  for(let t=1080;t<3000;t+=40)frame('precision',t,.5+(t-1080)/1920*.06);
  assert.equal(model.stars.length,1);assert.ok(model.stars[0].x>.55);
  frame('fist',3040,.56);frame('fist',3080,.56);assert.equal(model.draggers.size,0);
});
test('compact side/depth pinches cancel the web creation countdown immediately and still grab without adding stars',()=>{
  for(const gesture of ['compact-side','compact-depth']) {
    const layer={children:[],append(el){this.children.push(el);}};
    globalThis.window={addEventListener(){}};
    globalThis.document={hidden:false,addEventListener(){},getElementById:()=>layer,querySelector:()=>null,createElement:()=>({style:{setProperty(){}}})};
    const model=new CanvasModel();
    const controller=new HandController({readyState:0,pause(){}},{clientWidth:1000,clientHeight:1000},model,{burst(){},chime(){},toast(){},hands(){},status(){}},{exclusive:false});
    controller.active=true;
    const frame=(name,t,x=.5)=>{const points=handPoints(name,{x:0,y:0,z:0}).map(p=>({x:1-x+p.x,y:.5-p.y,z:p.z}));controller.process([points],t,t);controller.tick(t+50);};
    frame('fist',100);frame('fist',140);assert.equal(controller.slots[0].fistStart,140);
    for(let t=180;t<1170;t+=40)frame('fist',t);
    frame(gesture,1170);assert.equal(controller.slots[0].fistStart,0,'raw pinch cancels before gesture confirmation');
    frame(gesture,1210);for(let t=1250;t<3400;t+=40)frame(gesture,t);
    assert.equal(model.stars.length,0,'empty-space pinch never starts creation');
    // The fixture recentres each pose on its own anatomical anchor. Start a
    // fresh tracking session for exact on-star targeting, not a synthetic palm jump.
    controller.releaseAll();const star=model.add(.5,.5);frame(gesture,3600);frame(gesture,3640);
    assert.equal(model.draggers.has(star.id),true);
    for(let t=3680;t<4900;t+=40)frame(gesture,t,.5+(t-3680)*.00003);
    assert.equal(model.stars.length,1);assert.ok(star.x>.52);
    frame('fist',5000);frame('fist',5040);assert.equal(model.dragging,false);
  }
});
