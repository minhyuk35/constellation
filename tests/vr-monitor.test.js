import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { Vector3, Quaternion } from 'three';
import { VRModel } from '../src/vr/VRModel.js';
import { SHAPES } from '../src/data/shapes.js';
import { cleanSnapshot, cleanEntity, cleanFrame, cleanPatch, MAX_MONITOR_MESSAGE } from '../src/monitor/protocol.js';
import { VRMonitorRoom } from '../worker/vr-monitor.js';
import worker from '../worker/index.js';

const frame=()=>({head:{position:[0,1.6,0],quaternion:[0,0,0,1],fov:90},
  ui:{position:[0,1.6,0],quaternion:[0,0,0,1],library:false,filter:'zodiac',page:0},
  hands:[{source:'hand',side:'left',gesture:'pinch',held:true,
    points:Array.from({length:21},()=>[.1,1.2,-.5]),origin:[.1,1.2,-.5],direction:[0,0,-1]}],
  effects:[{kind:'create',point:[.1,1.2,-.5]}]});
const status={paused:false,stars:4,works:0,hands:1};
test('monitor preserves fractional catalogue scrolling and rejects nonfinite/out-of-range positions',()=>{
  const data=frame();data.ui.scroll=.48372;assert.equal(cleanFrame(data).ui.scroll,.4837);
  for(const value of [-.001,1.001,NaN,Infinity,'0.5']) {
    data.ui.scroll=value;assert.throws(()=>cleanFrame(data));
  }
  delete data.ui.scroll;assert.equal(cleanFrame(data).ui.scroll,undefined,'older clients remain valid');
});
function socket(meta) {
  return {readyState:1,meta:structuredClone(meta),out:[],
    serializeAttachment(m){this.meta=structuredClone(m);},deserializeAttachment(){return structuredClone(this.meta);},
    send(s){this.out.push(JSON.parse(s));},close(code){this.code=code;this.readyState=3;}};
}
function relay() {
  const id=crypto.randomUUID(),other=crypto.randomUUID(),now=Date.now();
  const device=socket({role:'device',id,name:'Quest 01',platform:'Meta Quest',seenAt:now,connectedAt:now,status}),
    second=socket({role:'device',id:other,name:'Quest 02',platform:'Meta Quest',seenAt:now,connectedAt:now,status}),
    operator=socket({role:'operator',id:crypto.randomUUID(),seenAt:now,watch:id}),
    spectator=socket({role:'operator',id:crypto.randomUUID(),seenAt:now,watch:other});
  const ctx={getWebSockets:()=>[device,second,operator,spectator]},room=new VRMonitorRoom(ctx);
  const send=(ws,data)=>room.webSocketMessage(ws,JSON.stringify(data));
  return {id,other,device,second,operator,spectator,room,ctx,send};
}
test('monitor roundtrips all 200 catalogue shapes, full capacity and original 3D positions without mutating the VR model',()=>{
  const model=new VRModel();
  for(const shape of SHAPES) {
    model.loadPreset(shape);const before=JSON.stringify(model.draft),copy=cleanSnapshot(model);
    assert.equal(copy.draft.shapeId,shape.id);assert.equal(copy.draft.stars.length,shape.points.length);
    assert.deepEqual(copy.draft.edges,shape.edges);assert.equal(JSON.stringify(model.draft),before);
    assert.ok(!('history' in copy));assert.ok(!('revision' in copy.draft));
  }
  for(let i=0;i<24;i++){model.loadPreset(SHAPES[i]);assert.ok(model.finish(new Vector3(0,1.6,0),new Quaternion()));}
  model.add(new Vector3(.1,1.1,-.6));const copy=cleanSnapshot(model);
  assert.equal(copy.works.length,24);assert.ok(copy.works.some(e=>e.position.z>0));
  assert.ok(JSON.stringify({type:'snapshot',state:copy}).length<MAX_MONITOR_MESSAGE);
  assert.equal(copy.draft.stars[0].z,-.6);
});
test('monitor rejects malformed IDs, nonfinite positions, invalid edges and duplicate entities',()=>{
  const entity=new VRModel().draft;
  for(const id of [undefined,null,42,'','<script>'])assert.throws(()=>cleanEntity({...entity,id}));
  for(const position of [{x:NaN,y:0,z:0},{x:0,y:0,z:101}])assert.throws(()=>cleanEntity({...entity,position}));
  assert.throws(()=>cleanEntity({...entity,stars:[{x:0,y:0,z:0}]}));
  assert.throws(()=>cleanEntity({...entity,stars:[{id:'a',x:0,y:0,z:0}],edges:[[0,1]]}));
  assert.throws(()=>cleanSnapshot({draft:entity,works:[entity]}));
  assert.throws(()=>cleanPatch([entity,entity]));
  assert.throws(()=>cleanEntity({...entity,quaternion:{x:0,y:0,z:0,w:0}}));
  const valid=frame();assert.equal(cleanFrame(valid).hands[0].points.length,21);
  valid.hands[0].direction=[0,0,0];assert.throws(()=>cleanFrame(valid));
  valid.hands=[];valid.head.quaternion=[0,0,0,0];assert.throws(()=>cleanFrame(valid));
});
test('hibernated relay restores device presence and forwards state only to operators watching that device',()=>{
  const {device,second,operator,spectator,room,ctx,send,id,other}=relay();
  assert.equal(new VRMonitorRoom(ctx).devices().length,2);
  send(device,{type:'snapshot',state:cleanSnapshot(new VRModel())});send(device,{type:'frame',frame:frame()});
  assert.deepEqual(operator.out.map(m=>m.type),['snapshot','frame']);assert.equal(spectator.out.length,0);
  assert.equal(device.out.length,0);assert.equal(second.out.length,0);
  send(operator,{type:'watch',id:other});
  assert.equal(device.out.at(-1).count,0);assert.equal(second.out.at(-1).count,2);
  assert.equal(second.out.at(-1).refresh,true);
  const received=operator.out.length;send(device,{type:'frame',frame:frame()});assert.equal(operator.out.length,received);
  send(second,{type:'frame',frame:frame()});assert.equal(operator.out.at(-1).id,other);
  send(device,{type:'heartbeat',status});assert.equal(device.out.at(-1).type,'pong');
  assert.deepEqual(operator.out.at(-1).devices.map(d=>d.id),[id,other]);
  assert.ok(!JSON.stringify(operator.out.at(-1)).includes('watch'));
});
test('only the selected headset receives bounded tutorial commands and acknowledges them to its watchers',()=>{
  const r=relay(),requestId=crypto.randomUUID();
  r.send(r.operator,{type:'command',id:r.id,requestId,action:'tutorial-start'});
  assert.equal(r.device.out.at(-1).type,'command');assert.equal(r.second.out.length,0);
  r.send(r.device,{type:'command-result',requestId,action:'tutorial-start',status:'applied'});
  assert.equal(r.operator.out.at(-1).status,'applied');assert.equal(r.spectator.out.length,0);
  for(const data of [{id:r.other,requestId,action:'tutorial-start'},{id:r.id,requestId,action:'delete-all'}]) {
    const x=relay();x.send(x.operator,{type:'command',...data,id:data.action==='delete-all'?x.id:x.other});assert.equal(x.operator.code,1008);
  }
  const x=relay();x.device.readyState=2;x.send(x.operator,{type:'command',id:x.id,requestId,action:'tutorial-start'});
  assert.equal(x.operator.out.at(-1).status,'offline');
});
test('relay rejects operator writes and malformed watched state, prunes stale sockets and updates watcher counts',()=>{
  let r=relay();r.send(r.operator,{type:'frame',frame:frame()});assert.equal(r.operator.code,1008);
  r=relay();r.send(r.device,{type:'frame',frame:{...frame(),hands:[{}]}});assert.equal(r.device.code,1008);
  r=relay();r.room.webSocketMessage(r.device,'x'.repeat(MAX_MONITOR_MESSAGE+1));assert.equal(r.device.code,1008);
  r=relay();r.operator.meta.seenAt=Date.now()-31000;
  r.send(r.second,{type:'heartbeat',status});assert.equal(r.operator.code,4000);
  assert.equal(r.device.out.at(-1).count,0);
  r.device.readyState=2;r.room.webSocketClose(r.device);
  assert.equal(r.device.readyState,3);assert.equal(r.spectator.out.at(-1).devices.length,1);
});
test('relay rate bounds incoming commands without recording workspace history',()=>{
  const r=relay();r.device.meta.window=Math.floor(Date.now()/1000);r.device.meta.messages=45;
  r.send(r.device,{type:'frame',frame:frame()});assert.equal(r.device.code,1008);
  const restored=new VRMonitorRoom(r.ctx);assert.equal(restored.devices().length,1);
  assert.equal(Object.keys(restored).join(','),'ctx');
});
test('monitor tickets require operator/visitor credentials, reject expired or forged tickets and never access exhibition DB',async()=>{
  let forwarded;
  const env={KIOSK_KEY:'test-key',SESSION_SECRET:'test-secret',PUBLIC_ORIGIN:'https://exhibit.test',
    DB:{prepare(){throw new Error('Monitor must not access D1');}},
    VR_MONITOR:{idFromName:n=>n,get:()=>({fetch:async request=>{
      forwarded=JSON.parse(decodeURIComponent(request.headers.get('X-Monitor-Claims')));return Response.json({ok:true});
    }})}};
  const mac=p=>createHmac('sha256',env.SESSION_SECRET).update(p).digest('hex');
  const request=(path,{data,key,token,upgrade,origin='https://exhibit.test'}={})=>worker.fetch(new Request(`https://api.test/api/vr-monitor/${path}`,{
    method:data?'POST':'GET',headers:{Origin:origin,...(data?{'Content-Type':'application/json'}:{}),
      ...(key?{Authorization:`Bearer ${key}`}:{}) ,...(token?{'X-Visitor-Token':token}:{}),...(upgrade?{Upgrade:'websocket'}:{})},
    ...(data?{body:JSON.stringify(data)}:{})}),env);
  for(const key of [undefined,'wrong'])assert.equal((await request('ticket',{data:{role:'operator'},key})).status,403);
  const operator=await (await request('ticket',{data:{role:'operator'},key:'test-key'})).json();
  assert.ok(operator.ticket);assert.equal((await request(`socket?ticket=${operator.ticket}`)).status,426);
  assert.equal((await request(`socket?ticket=${operator.ticket}`,{upgrade:true})).status,200);assert.equal(forwarded.role,'operator');
  assert.equal((await request('ticket',{data:{role:'device',name:'Quest01',platform:'Meta Quest'}})).status,401);
  const visitorId=crypto.randomUUID(),payload=`${visitorId}.${Date.now()+86400000}`,token=`${payload}.${mac(payload)}`;
  const device=await (await request('ticket',{data:{role:'device',name:'퀘스트 01',platform:'Meta Quest'},token})).json();
  await request(`socket?ticket=${device.ticket}`,{upgrade:true});assert.equal(forwarded.id,visitorId);assert.equal(forwarded.name,'퀘스트 01');
  const expired=Buffer.from(JSON.stringify({...forwarded,expires:Date.now()-1000})).toString('base64url');
  assert.equal((await request(`socket?ticket=${expired}.${mac(expired)}`,{upgrade:true})).status,403);
  assert.equal((await request(`socket?ticket=${expired}.forged`,{upgrade:true})).status,403);
  assert.equal((await request(`socket?ticket=${device.ticket}`,{upgrade:true,origin:'https://evil.test'})).status,403);
});
