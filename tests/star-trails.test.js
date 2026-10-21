import test from 'node:test';
import assert from 'node:assert/strict';
import {Scene} from 'three';
import {StarTrails} from '../src/scene/StarTrails.js';
const p=(x,y=0,z=-.7)=>({x,y,z});

test('a held still star and sub-threshold jitter never build a glowing trail',()=>{
  const fx=new StarTrails(new Scene());
  for(let i=0;i<100;i++){fx.move('still',p(0),p(0),i/90);fx.move('noise',p(0),p(.001*Math.sin(i)),i/90);}
  assert.equal(fx.emitted,0);assert.equal(fx.geometry.instanceCount,0);fx.dispose();
});
test('small intentional moves accumulate, two hands remain independent and endpoints are never altered',()=>{
  const fx=new StarTrails(new Scene()),from=p(0),to=p(.001);
  fx.move('right',from,to,10);assert.equal(fx.emitted,0);
  for(let i=2;i<=6;i++)fx.move('right',p((i-1)*.001),p(i*.001),10+i*.01);
  assert.equal(fx.emitted,1);assert.deepEqual(from,p(0));assert.deepEqual(to,p(.001));
  fx.move('left',p(-1),p(-.95),10.08);
  assert.notEqual(fx.tracks.get('right').slot,fx.tracks.get('left').slot);
  const before=fx.emitted;
  for(let i=0;i<48;i++)fx.move('unmoved-'+i,p(i),p(i),10.09);
  assert.equal(fx.emitted,before);assert.equal(fx.tracks.size,2);
  fx.move('right',p(.006),p(.02),10.1);assert.equal(fx.tracks.size,2);
  fx.dispose();
});
test('short lifetime, hard length limit, teleport rejection and GPU pool stay bounded',()=>{
  const fx=new StarTrails(new Scene(),{capacity:16});
  fx.move('right',p(0),p(.4),10);
  const a=fx.geometry.attributes;
  assert.ok(Math.abs(a.aEnd.getX(0)-a.aStart.getX(0)-.18)<1e-6);
  const versions=[a.aStart.version,a.aEnd.version,a.aTrail.version];
  for(let i=0;i<100;i++)fx.update(10+i*.001);
  assert.deepEqual([a.aStart.version,a.aEnd.version,a.aTrail.version],versions);
  fx.move('right',p(.4),p(2),10.1);assert.equal(fx.emitted,1,'teleport does not streak');
  for(let i=0;i<80;i++)fx.move('id-'+i,p(0),p(.01),10.11+i*.001);
  assert.equal(fx.geometry.instanceCount,16);assert.equal(fx.tracks.size,4);
  assert.ok([...a.aTrail.array,...a.aStart.array,...a.aEnd.array].every(Number.isFinite));
  for(const attr of [a.aTrail,a.aStart,a.aEnd])assert.ok(attr.updateRanges.length<=18);
  fx.update(11);assert.equal(fx.mesh.visible,false);
  fx.move('new',p(0),p(.01),12);assert.equal(fx.geometry.instanceCount,1);
  fx.reducedMotion=true;fx.update(12);assert.equal(fx.mesh.visible,false);assert.equal(fx.geometry.instanceCount,0);
  const emitted=fx.emitted;fx.move('new',p(.01),p(.02),12.1);assert.equal(fx.emitted,emitted);
  fx.dispose();
});
