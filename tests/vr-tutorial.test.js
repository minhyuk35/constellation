import test from 'node:test';
import assert from 'node:assert/strict';
import {PerspectiveCamera,Vector3,Quaternion} from 'three';
import {VRCreationIntent} from '../src/vr/VRCreationIntent.js';
import {VRTutorial} from '../src/vr/VRTutorial.js';
import {VRModel} from '../src/vr/VRModel.js';
import {SHAPES} from '../src/data/shapes.js';
import {cleanGuide} from '../src/monitor/protocol.js';

test('resting/raised existing fists never arm creation; an open hand in the visible workspace arms exactly once',()=>{
  const head=new Vector3(0,1.6,0),q=new Quaternion(),intent=new VRCreationIntent();
  for(const p of [new Vector3(0,.7,-.2),new Vector3(0,1.4,-.55)])for(let t=0;t<4000;t+=40)
    assert.equal(intent.update('fist',intent.workspace(p,head,q),t),false);
  assert.equal(intent.update('open',true,4100),false);assert.equal(intent.update('open',true,4300),true);
  assert.equal(intent.update('fist',true,4340),true);intent.consume();assert.equal(intent.update('fist',true,6000),false);
  intent.update('open',true,6100);intent.update('open',true,6340);assert.equal(intent.update('fist',false,6380),false);
  assert.equal(intent.update('fist',true,6420),false,'lowering the hand requires a deliberate new open gesture');
});
test('creation workspace follows 360 degree heading and excludes behind-head, waist and offscreen near-face hands',()=>{
  const intent=new VRCreationIntent(),head=new Vector3(3,1.75,-2);
  for(let i=0;i<24;i++) {
    const q=new Quaternion().setFromAxisAngle(new Vector3(0,1,0),i*Math.PI/12);
    for(const [p,allowed] of [[new Vector3(.15,-.2,-.55),true],[new Vector3(0,-.8,-.4),false],[new Vector3(0,-.2,.5),false],[new Vector3(.8,-.2,-.15),false]])
      assert.equal(intent.workspace(p.applyQuaternion(q).add(head),head,q),allowed);
  }
});
function fixture() {
  const model=new VRModel();model.loadPreset(SHAPES[0]);model.finish();model.loadPreset(SHAPES[1]);
  const input={slots:[],erase:true,releaseAll(){}},camera=new PerspectiveCamera();camera.position.set(0,1.6,0);
  const tutorial=new VRTutorial(model,input),saved={draft:model.draft,works:model.works,history:model.history,anchor:model.anchor},before=JSON.stringify(saved);
  return {model,input,camera,tutorial,saved,before};
}
test('tutorial gates every action, progresses only with the practice star and restores original works and undo references',()=>{
  const {model,input,camera,tutorial:t,saved,before}=fixture();t.start(camera,100);
  assert.equal(model.draft.stars.length,0);assert.equal(model.works.length,0);assert.equal(input.erase,false);
  for(const action of ['finish','undo','erase','library','preset:aries'])assert.equal(t.allows('action',action),false);
  assert.equal(t.allows('create'),false);const hand={};t.observe(hand,{gesture:'open'},true,200);t.observe(hand,{gesture:'open'},true,550);
  assert.equal(t.step,'create');assert.equal(t.allows('create'),true);
  const target=model.add(new Vector3(0,1.4,-.55));t.created(target);assert.equal(t.step,'grab');assert.equal(t.allows('create'),false);
  assert.equal(t.allows('move',target),false);assert.equal(t.allows('grab',{star:{id:'other'}}),false);
  t.grabbed(target);assert.equal(t.step,'move');assert.equal(t.allows('delete',target),false);
  t.released(target);assert.equal(t.step,'move','release outside the target cannot skip a step');
  model.move(target,t.target);t.released(target);assert.equal(t.step,'delete');
  model.remove(target);t.deleted(target);assert.equal(t.step,'done');t.tick(t.since+2500);assert.equal(t.active,false);
  for(const key of ['draft','works','history','anchor'])assert.equal(model[key],saved[key]);
  assert.equal(JSON.stringify(saved),before);assert.equal(input.erase,true);
  assert.equal(model.undo(),true,'the original undo stack still works');
});
test('operator cancellation/restart and XR exit restore user work without keeping practice stars',()=>{
  const {model,camera,tutorial:t,saved,before}=fixture();
  for(let i=0;i<5;i++) {
    t.start(camera);t.desktopReady();t.created(model.add(new Vector3(.2,1.3,-.6)));assert.equal(t.active,true);
    assert.doesNotThrow(()=>cleanGuide(t.state()));t.stop();
    assert.equal(model.draft,saved.draft);assert.equal(model.works,saved.works);assert.equal(JSON.stringify(saved),before);
  }
  t.start(camera);t.start(camera);t.stop();assert.equal(JSON.stringify(saved),before);
});
