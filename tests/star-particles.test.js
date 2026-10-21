import test from 'node:test';
import assert from 'node:assert/strict';
import { Scene } from 'three';
import { StarParticles } from '../src/scene/StarParticles.js';

test('birth/deletion wave fronts recycle a bounded GPU pool without per-frame geometry uploads', () => {
  const scene = new Scene(), fx = new StarParticles(scene, { capacity: 256 });
  const geometry = fx.geometry, attrs = geometry.attributes;
  for (let i = 0; i < 80; i++) fx.emit({ x: i, y: 1.4, z: -.5 }, { kind: i % 2 ? 'create' : 'delete', now: i });
  assert.equal(geometry.instanceCount, 256);
  assert.equal(attrs.aCenter.count, 256);
  assert.equal(fx.emitted, 160);
  const versions = ['aCenter', 'aFlight', 'aLife', 'aTint'].map(k => attrs[k].version);
  for (let i = 0; i < 1000; i++) fx.update(79 + i / 1000);
  assert.deepEqual(['aCenter', 'aFlight', 'aLife', 'aTint'].map(k => attrs[k].version), versions);
  assert.equal(fx.geometry, geometry);
  assert.ok([...attrs.aFlight.array, ...attrs.aLife.array].every(Number.isFinite));
  fx.update(90); assert.equal(fx.mesh.visible, false);
  let disposed = 0;
  geometry.addEventListener('dispose', () => disposed++);
  fx.dispose(); assert.equal(disposed, 1); assert.equal(scene.children.length, 0);
});

test('reduced-motion skips particles without changing the star interaction', () => {
  const fx = new StarParticles(new Scene(), { reducedMotion: true });
  fx.emit({ x: 0, y: 0, z: 0 }); fx.update(0);
  assert.equal(fx.emitted, 0); assert.equal(fx.mesh.visible, false);
  fx.dispose();
});

test('creation, inward deletion, open-palm waves and placement use distinct bounded wave modes', () => {
  const fx=new StarParticles(new Scene());
  fx.emit({x:0,y:0,z:0},{kind:'create',now:0});
  const first=fx.lastEffect.variant;
  fx.emit({x:0,y:0,z:0},{kind:'create',now:1});
  assert.notEqual(fx.lastEffect.variant,first);
  const before=fx.cursor;
  fx.emit({x:0,y:0,z:0},{kind:'delete',now:2});
  const a=fx.geometry.attributes;
  assert.equal(fx.cursor-before,2);assert.equal(a.aLife.getW(before),1);
  assert.ok(a.aFlight.array.every(Number.isFinite));
  const wave=fx.cursor;
  fx.emit({x:0,y:0,z:0},{kind:'wave',now:3});
  assert.equal(fx.cursor-wave,2); assert.equal(a.aLife.getW(wave),2);
  const place=fx.cursor;fx.emit({x:0,y:0,z:0},{kind:'place',now:4});
  assert.equal(fx.cursor-place,3);assert.equal(a.aLife.getW(place),3);
  assert.ok(a.aLife.getY(place)>a.aLife.getY(before),'placement has a slower, broader wave');
  fx.dispose();
});

test('VR waves are world-space spherical shells with a bounded, demand-sized draw pool', () => {
  const fx=new StarParticles(new Scene(),{spatial:true,capacity:8}),a=fx.geometry.attributes;
  assert.equal(fx.geometry.instanceCount,0);
  for(let axis=0;axis<3;axis++) {
    const values=Array.from({length:a.position.count},(_,i)=>a.position.array[i*3+axis]);
    assert.ok(Math.min(...values)<-.999&&Math.max(...values)>.999,'shell extends in every spatial axis');
  }
  for(let i=0;i<a.position.count;i++)assert.ok(Math.abs(Math.hypot(a.position.getX(i),a.position.getY(i),a.position.getZ(i))-1)<1e-6);
  assert.match(fx.material.vertexShader,/aCenter\+position\*radius/);
  assert.doesNotMatch(fx.material.vertexShader,/p\.xy\+=/);
  assert.equal(fx.material.forceSinglePass,true);
  fx.emit({x:1,y:2,z:3},{now:10});assert.equal(fx.geometry.instanceCount,2);
  assert.deepEqual([a.aCenter.getX(0),a.aCenter.getY(0),a.aCenter.getZ(0)],[1,2,3]);
  const versions=[a.aLife.version,a.aCenter.version];
  for(let i=0;i<50;i++)fx.update(10+i/100);
  assert.deepEqual([a.aLife.version,a.aCenter.version],versions);
  for(let i=0;i<10;i++)fx.emit({x:i,y:2,z:3},{now:10.5});
  assert.equal(fx.geometry.instanceCount,8);assert.equal(a.aCenter.count,8);
  fx.update(13);assert.equal(fx.mesh.visible,false);
  fx.emit({x:0,y:0,z:0},{now:14});assert.equal(fx.geometry.instanceCount,2);assert.equal(fx.cursor,2);
  fx.dispose();
  const web=new StarParticles(new Scene());assert.ok(web.geometry.attributes.position.array.every((v,i)=>i%3!==2||v===0));web.dispose();
  const reduced=new StarParticles(new Scene(),{spatial:true,reducedMotion:true});
  reduced.emit({x:0,y:0,z:0});assert.equal(reduced.geometry.instanceCount,0);reduced.dispose();
});
