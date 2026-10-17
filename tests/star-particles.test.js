import test from 'node:test';
import assert from 'node:assert/strict';
import { Scene } from 'three';
import { StarParticles } from '../src/scene/StarParticles.js';

test('birth/deletion particles recycle a bounded GPU pool without per-frame geometry uploads', () => {
  const scene = new Scene(), fx = new StarParticles(scene, { capacity: 256 });
  const geometry = fx.geometry, attrs = geometry.attributes;
  for (let i = 0; i < 80; i++) fx.emit({ x: i, y: 1.4, z: -.5 }, { kind: i % 2 ? 'create' : 'delete', now: i });
  assert.equal(geometry.instanceCount, 256);
  assert.equal(attrs.aCenter.count, 256);
  assert.equal(fx.emitted, 40 * (76 + 100));
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

test('birth variants, deletion shards and open-palm waves use different spatial patterns and sprite silhouettes', () => {
  const fx=new StarParticles(new Scene());
  fx.emit({x:0,y:0,z:0},{kind:'create',now:0});
  const first=fx.lastEffect.variant;
  fx.emit({x:0,y:0,z:0},{kind:'create',now:1});
  assert.notEqual(fx.lastEffect.variant,first);
  const before=fx.cursor;
  fx.emit({x:0,y:0,z:0},{kind:'delete',now:2});
  const a=fx.geometry.attributes;
  assert.ok(Array.from({length:100},(_,i)=>a.aFlight.getW(before+i)).every(k=>k!==2),'deletion has no creation halo');
  assert.ok(Array.from({length:100},(_,i)=>a.aFlight.getW(before+i)).some(k=>k===3),'fragment silhouettes differ from starlight');
  const wave=fx.cursor;
  fx.emit({x:0,y:0,z:0},{kind:'wave',now:3});
  assert.equal(fx.cursor-wave,24); assert.equal(a.aLife.getW(wave),2);
  fx.dispose();
});
