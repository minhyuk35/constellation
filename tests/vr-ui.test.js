import test from 'node:test';
import assert from 'node:assert/strict';
import { Group, PerspectiveCamera, Euler, Vector3 } from 'three';
import { VRWorld } from '../src/vr/VRWorld.js';
import { SkyArtwork } from '../src/exhibition/SkyArtwork.js';

function fixture() {
  const world=Object.create(VRWorld.prototype),head=new PerspectiveCamera();
  world.uiAnchor=new Group();world.panel=new Group();world.uiAnchor.add(world.panel);
  world.renderer={xr:{isPresenting:true,getCamera:()=>head,getReferenceSpace:()=>({})}};
  head.position.set(2,1.65,-3);
  head.quaternion.setFromEuler(new Euler(-.8,1.1,.2,'YXZ'));
  return {world,head,frame:{getViewerPose:()=>({})}};
}

test('VR desk waits for a tracked pose and anchors to entry position/yaw without pitch or roll',()=>{
  const {world,head,frame}=fixture();world.queueUIAnchor();
  world.updateUIAnchor({getViewerPose:()=>null});
  assert.equal(world.uiAnchorPending,true);assert.equal(world.panel.visible,false);
  assert.equal(world.uiAnchor.position.length(),0,'an untracked preview pose cannot anchor the desk');
  world.updateUIAnchor(frame);
  assert.equal(world.uiAnchorPending,false);
  assert.ok(world.uiAnchor.position.distanceTo(head.position)<1e-9);
  assert.ok(Math.abs(world.uiAnchor.rotation.y-1.1)<1e-9);
  assert.equal(world.uiAnchor.rotation.x,0);assert.equal(world.uiAnchor.rotation.z,0);
});

test('looking around or walking never drags the desk; a new VR entry deliberately reanchors it',()=>{
  const {world,head,frame}=fixture();world.queueUIAnchor();world.updateUIAnchor(frame);
  const original=world.uiAnchor.matrixWorld.clone();
  head.position.set(-4,1.3,2);head.quaternion.setFromEuler(new Euler(.6,-1.9,-.3,'YXZ'));
  world.updateUIAnchor(frame);world.uiAnchor.updateMatrixWorld(true);
  assert.ok(world.uiAnchor.matrixWorld.equals(original));
  world.queueUIAnchor();world.updateUIAnchor({getViewerPose:()=>null});
  assert.ok(world.uiAnchor.matrixWorld.equals(original),'reentry also waits for real tracking');
  world.updateUIAnchor(frame);
  assert.ok(world.uiAnchor.position.distanceTo(head.position)<1e-9);
  assert.ok(Math.abs(world.uiAnchor.rotation.y+1.9)<1e-9);
});

test('VR artwork opacity is independent of AR and the catalogue, including after frame updates',()=>{
  const vr=new SkyArtwork({opacity:.76,focusedOpacity:.76}),ar=new SkyArtwork();
  for(const [art,expected] of [[vr,[.76,.76]],[ar,[.88,.96]]]) {
    const forward=new Vector3(0,0,-1),entry={illustration:{},artAsset:{},direction:forward,
      artMesh:{material:{uniforms:{uTime:{value:0},uOpacity:{value:0}}}}};
    for(const [i,focused] of [false,true].entries()) {
      entry.focused=focused;art.update(new Map([['work',entry]]),{fov:90,aspect:1},forward,1);
      assert.equal(entry.artMesh.material.uniforms.uOpacity.value,expected[i]);
    }
  }
});
