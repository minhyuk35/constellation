import test from 'node:test';
import assert from 'node:assert/strict';
import { PerspectiveCamera, Vector3 } from 'three';
import { Universe } from '../src/scene/Universe.js';

function view(width, height, zoom) {
  const scene = Object.create(Universe.prototype);
  Object.assign(scene, { width, height, baseCameraZ:height/(2*Math.tan(25*Math.PI/180)) });
  scene.camera = new PerspectiveCamera(50,width/height,.1,8000);
  scene.camera.position.z = scene.baseCameraZ*zoom;
  scene.camera.updateMatrixWorld();
  return scene;
}

test('screen picking agrees with the actual Three.js projection at every art zoom and viewport', () => {
  for (const [width,height] of [[1440,900],[900,1440],[720,450]]) {
    for (const zoom of [1,1.37,2.5,4]) {
      const scene = view(width,height,zoom);
      const star = { id:'visible',x:.8,y:.24 };
      const world = scene.toWorld(star);
      const projected = new Vector3(world.x,world.y,0).project(scene.camera);
      const screen = { x:(projected.x+1)/2,y:(1-projected.y)/2 };
      const actual = scene.toScreen(star);
      assert.ok(Math.hypot(screen.x-actual.x,screen.y-actual.y)<1e-10);
      assert.equal(scene.pickStar([star],screen,14),star);
      assert.equal(scene.pickStar([star],{x:screen.x+18/width,y:screen.y},14),null);
      const restored = scene.fromScreen(screen);
      assert.ok(Math.hypot(restored.x-star.x,restored.y-star.y)<1e-10);
    }
  }
});

test('picking selects the nearest displayed star and keeps mouse/touch radii separate', () => {
  const scene = view(1000,1000,2);
  const a = {id:'a',x:.7,y:.5}, b = {id:'b',x:.74,y:.5};
  assert.equal(scene.pickStar([a,b],{x:.612,y:.5},14),b);
  const point = {x:.64,y:.5};
  assert.equal(scene.pickStar([b],point,14),null,'hand misses at 20px');
  assert.equal(scene.pickStar([b],point,25),b,'mouse retains 25px');
  assert.equal(scene.pickStar([b],{x:.655,y:.5},38),b,'touch retains 38px');
});
