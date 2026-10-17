import * as THREE from 'three';
import { VRGestures, VRShake, XR_LANDMARKS } from './VRGestures.js';

export class VRInput {
  constructor(world, model, action, status) {
    Object.assign(this, { world, model, action, status, erase: false, slots: [] });
    const geometry = new THREE.SphereGeometry(1, 8, 6);
    const material = new THREE.MeshBasicMaterial({ color: '#a8d5e3', transparent: true, opacity: .75 });
    this.matrix = new THREE.Matrix4(); this.scale = new THREE.Vector3();
    for (let i = 0; i < 2; i++) {
      const hand = world.renderer.xr.getHand(i), controller = world.renderer.xr.getController(i);
      const handMesh = new THREE.InstancedMesh(geometry, material, 25);
      handMesh.count = 0; handMesh.frustumCulled = false;
      handMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      hand.add(handMesh); world.scene.add(hand, controller);
      const ray = new THREE.Line(new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(), new THREE.Vector3(0, 0, -1),
      ]), new THREE.LineBasicMaterial({ color: '#8bbad1', transparent: true, opacity: .35 }));
      ray.scale.z = 1.4; controller.add(ray);
      const slot = { hand, handMesh, controller, ray, gestures: new VRGestures(), holding: null,
        source: null, pressed: false, points: XR_LANDMARKS.map(() => new THREE.Vector3()) };
      this.slots.push(slot);
      controller.addEventListener('connected', e => { slot.source = e.data; slot.gestures.reset(); });
      controller.addEventListener('disconnected', () => {
        this.release(slot); slot.source = null; slot.gestures.reset();
      });
      controller.addEventListener('selectstart', () => {
        if (!slot.source?.hand) {
          slot.pressed = true;
          this.begin(slot, this.pose(slot), { allowCreate: true });
        }
      });
      controller.addEventListener('selectend', () => {
        slot.pressed = false;
        if (!slot.source?.hand) this.release(slot);
      });
    }
  }
  get dragging() { return this.slots.some(s => !!s.holding); }
  head() { return this.world.renderer.xr.isPresenting ? this.world.renderer.xr.getCamera() : this.world.camera; }
  prepareDraft() {
    const head = this.head();
    this.model.prepareDraft(head.getWorldPosition(new THREE.Vector3()), head.getWorldQuaternion(new THREE.Quaternion()));
  }
  pose(slot) {
    slot.controller.updateWorldMatrix(true, false);
    const origin = slot.controller.getWorldPosition(new THREE.Vector3());
    const direction = new THREE.Vector3(0, 0, -1)
      .applyQuaternion(slot.controller.getWorldQuaternion(new THREE.Quaternion())).normalize();
    return { origin, direction, point: origin.clone().addScaledVector(direction, .55) };
  }
  create(point) {
    if (this.world.library?.visible) return;
    this.prepareDraft();
    const target = this.model.add(point);
    if (!target) this.status('한 별자리에는 별을 48개까지 놓을 수 있어요. 완성해서 띄워보세요.');
    return target;
  }
  begin(slot, pose, { allowCreate = false } = {}) {
    const action = this.world.actionAt(pose.origin, pose.direction);
    if (action) { this.action(action); return; }
    if (this.world.library?.visible) return;
    let target = this.model.nearest(pose.point), far = false;
    if (!target) { target = this.model.pickRay(pose.origin, pose.direction); far = !!target; }
    if (target && this.slots.some(other => other !== slot && other.holding?.star.id === target.star.id)) return;
    if (this.erase) { if (target) this.model.remove(target); return; }
    if (target) this.model.remember();
    else if (allowCreate) target = this.create(pose.point);
    // Empty-space pinches never create stars. Native hands create only by fist hold.
    if (!target) return;
    slot.holding = target; slot.far = far; slot.distance = far ? target.distance : .55;
    const anchor = far ? pose.origin.clone().addScaledVector(pose.direction, slot.distance) : pose.point;
    slot.offset = this.model.world(target.entity, target.star).sub(anchor);
    slot.shake = new VRShake();
    slot.right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.head().getWorldQuaternion(new THREE.Quaternion()));
    slot.source?.gamepad?.hapticActuators?.[0]?.pulse?.(.2, 30)?.catch(() => {});
  }
  release(slot) {
    if (slot.holding) this.model.endMove(slot.holding);
    slot.holding = null; slot.shake = null;
  }
  releaseAll() {
    for (const slot of this.slots) { this.release(slot); slot.gestures.reset(); slot.pressed = false; }
  }
  update(now) {
    for (const slot of this.slots) {
      if (!slot.source) { slot.ray.visible = false; slot.handMesh.count = 0; continue; }
      let pose = this.pose(slot), down = slot.pressed;
      if (slot.source.hand) {
        const valid = slot.hand.visible && XR_LANDMARKS.every(name => slot.hand.joints[name]?.visible);
        if (!valid) {
          this.release(slot); slot.gestures.reset(); slot.ray.visible = false; slot.handMesh.count = 0; continue;
        }
        XR_LANDMARKS.forEach((name, i) => slot.hand.joints[name].getWorldPosition(slot.points[i]));
        let count = 0;
        for (const joint of Object.values(slot.hand.joints)) if (joint.visible && count < 25) {
          this.scale.setScalar(joint.jointRadius || .008);
          this.matrix.compose(joint.position, joint.quaternion, this.scale);
          slot.handMesh.setMatrixAt(count++, this.matrix);
        }
        slot.handMesh.count = count; slot.handMesh.instanceMatrix.needsUpdate = true;
        const state = slot.gestures.update(slot.points, now);
        pose.point = slot.points[4].clone().add(slot.points[8]).multiplyScalar(.5);
        if (state.release) this.release(slot);
        if (state.spawn && !this.model.nearest(slot.points[9], .09)) this.create(slot.points[9]);
        if (state.grab) this.begin(slot, pose);
        down = state.gesture === 'pinch';
        // Fixed viewer-right at grab time: shaking works at every heading in 360°,
        // and raw fingertip motion cannot be magnified by a distant ray target.
        if (down && slot.holding && slot.shake.update(pose.point.dot(slot.right), now)) {
          this.model.remove(slot.holding, { remember: false });
          slot.holding = null; slot.shake = null;
          this.status('별을 흔들어 지웠어요. 되돌리기로 복원할 수 있어요.');
        }
      } else if (!slot.controller.visible) { this.release(slot); continue; }
      slot.ray.visible = slot.controller.visible;
      if (down && slot.holding) {
        const point = slot.far ? pose.origin.clone().addScaledVector(pose.direction, slot.distance) : pose.point.clone();
        point.add(slot.offset);
        if (this.model.world(slot.holding.entity, slot.holding.star).distanceTo(point) > .0008)
          this.model.move(slot.holding, point);
      }
    }
  }
}
