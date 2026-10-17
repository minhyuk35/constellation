import test from 'node:test';
import assert from 'node:assert/strict';
import { VRModel } from '../src/vr/VRModel.js';
import { VRRecognition } from '../src/vr/VRRecognition.js';
import { SHAPE_MAP } from '../src/data/shapes.js';

test('VR automatically requests recognition after two still seconds and rejects a result after undo', t=>{
  const original=globalThis.Worker;
  t.after(()=>{ if(original)globalThis.Worker=original;else delete globalThis.Worker; });
  globalThis.Worker=class{constructor(){this.messages=[];}postMessage(data){this.messages.push(data);}terminate(){}};
  const model=new VRModel();
  for(const p of SHAPE_MAP.get('heart').points)model.add({x:p.x*.3,y:1.6+p.y*.3,z:-.6});
  let busy=false;
  const recognition=new VRRecognition(model,()=>busy),at=model.draft.lastEdit;
  recognition.update(at+1999);assert.equal(recognition.worker.messages.length,0);
  busy=true;recognition.update(at+2200);assert.equal(recognition.worker.messages.length,0);
  busy=false;recognition.update(at+2201);assert.equal(recognition.worker.messages.length,1);
  const token=recognition.worker.messages[0].revision;
  model.undo();
  recognition.worker.onmessage({data:{revision:token,candidates:[{shape:SHAPE_MAP.get('heart'),similarity:100}],edges:[]}});
  assert.equal(model.draft.shapeId,null);
  recognition.dispose();
});
