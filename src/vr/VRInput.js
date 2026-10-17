import * as THREE from 'three';

export class PinchLatch {
  constructor() {
    this.reset();
  }
  reset() {
    this.closed = false;
    this.ready = false;
    this.since = null;
  }
  update(distance, now) {
    if (!Number.isFinite(distance)) {
      this.reset();
      return false;
    }
    if (distance > 0.032) {
      this.ready = true;
      this.closed = false;
      this.since = null;
    } else if (distance < 0.022 && this.ready && !this.closed) {
      if (this.since === null) this.since = now;
      else if (now - this.since >= 35) this.closed = true;
    } else if (!this.closed) this.since = null;
    return this.closed;
  }
}

export class VRInput {
  constructor(world, model, action, status) {
    this.world = world;
    this.model = model;
    this.action = action;
    this.status = status;
    this.erase = false;
    this.slots = [];
    const jointGeometry = new THREE.SphereGeometry(1, 8, 6),
      jointMaterial = new THREE.MeshBasicMaterial({
        color: '#a8d5e3',
        transparent: true,
        opacity: 0.75,
      });
    for (let i = 0; i < 2; i++) {
      const hand = world.renderer.xr.getHand(i),
        controller = world.renderer.xr.getController(i);
      // Native joints as little points of light: no remote hand-model assets
      // or extra model loaders in the existing exhibition bundle.
      const handMesh = new THREE.InstancedMesh(jointGeometry, jointMaterial, 25);
      handMesh.count = 0;
      handMesh.frustumCulled = false;
      handMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      hand.add(handMesh);
      world.scene.add(hand, controller);
      const ray = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(),
          new THREE.Vector3(0, 0, -1),
        ]),
        new THREE.LineBasicMaterial({ color: '#8bbad1', transparent: true, opacity: 0.35 }),
      );
      ray.scale.z = 1.4;
      controller.add(ray);
      const slot = {
        hand,
        handMesh,
        controller,
        ray,
        latch: new PinchLatch(),
        holding: null,
        source: null,
        pressed: false,
      };
      this.slots.push(slot);
      controller.addEventListener('connected', (e) => {
        slot.source = e.data;
        slot.latch.reset();
      });
      controller.addEventListener('disconnected', () => {
        this.release(slot);
        slot.source = null;
        slot.latch.reset();
      });
      controller.addEventListener('selectstart', () => {
        if (!slot.source?.hand) {
          slot.pressed = true;
          const pose = this.pose(slot);
          if (pose) this.begin(slot, pose);
        }
      });
      controller.addEventListener('selectend', () => {
        slot.pressed = false;
        if (!slot.source?.hand) this.release(slot);
      });
    }
  }
  pose(slot) {
    slot.controller.updateWorldMatrix(true, false);
    const origin = slot.controller.getWorldPosition(new THREE.Vector3()),
      direction = new THREE.Vector3(0, 0, -1)
        .applyQuaternion(slot.controller.getWorldQuaternion(new THREE.Quaternion()))
        .normalize();
    return { origin, direction, point: origin.clone().addScaledVector(direction, 0.55) };
  }
  begin(slot, pose) {
    const action = this.world.actionAt(pose.origin, pose.direction);
    if (action) {
      this.action(action);
      return;
    }
    let target = this.model.nearest(pose.point),
      far = false;
    if (!target) {
      target = this.model.pickRay(pose.origin, pose.direction);
      far = !!target;
    }
    if (
      target &&
      this.slots.some((other) => other !== slot && other.holding?.star.id === target.star.id)
    )
      return;
    if (this.erase) {
      if (target) this.model.remove(target);
      return;
    }
    if (target) this.model.remember();
    else {
      target = this.model.add(pose.point);
      if (!target) {
        this.status('별은 한 별자리당 48개까지 놓을 수 있어요. 완성해서 띄워보세요.');
        return;
      }
    }
    slot.holding = target;
    slot.far = far;
    slot.distance = target.distance || 0.55;
    const anchor = far
      ? pose.origin.clone().addScaledVector(pose.direction, slot.distance)
      : pose.point;
    slot.offset = this.model.world(target.entity, target.star).sub(anchor);
    slot.source?.gamepad?.hapticActuators?.[0]?.pulse?.(0.2, 30)?.catch(() => {});
  }
  release(slot) {
    if (slot.holding) this.model.endMove(slot.holding);
    slot.holding = null;
  }
  releaseAll() {
    for (const slot of this.slots) {
      this.release(slot);
      slot.latch.reset();
      slot.pressed = false;
    }
  }
  update(now) {
    for (const slot of this.slots) {
      if (!slot.source) {
        slot.ray.visible = false;
        continue;
      }
      let pose = this.pose(slot),
        down = slot.pressed;
      if (slot.source.hand) {
        const a = slot.hand.joints['thumb-tip'],
          b = slot.hand.joints['index-finger-tip'];
        if (!slot.hand.visible || !a?.visible || !b?.visible) {
          this.release(slot);
          slot.latch.reset();
          slot.ray.visible = false;
          continue;
        }
        const thumb = a.getWorldPosition(new THREE.Vector3()),
          index = b.getWorldPosition(new THREE.Vector3());
        let count = 0;
        const matrix = new THREE.Matrix4(),
          scale = new THREE.Vector3();
        for (const joint of Object.values(slot.hand.joints))
          if (joint.visible && count < 25) {
            scale.setScalar(joint.jointRadius || 0.008);
            matrix.compose(joint.position, joint.quaternion, scale);
            slot.handMesh.setMatrixAt(count++, matrix);
          }
        slot.handMesh.count = count;
        slot.handMesh.instanceMatrix.needsUpdate = true;
        const before = slot.latch.closed;
        down = slot.latch.update(thumb.distanceTo(index), now);
        pose.point = thumb.clone().add(index).multiplyScalar(0.5);
        if (down && !before) this.begin(slot, pose);
        if (!down && before) this.release(slot);
      } else if (!slot.controller.visible) {
        this.release(slot);
        continue;
      }
      slot.ray.visible = slot.controller.visible;
      if (down && slot.holding) {
        const point = slot.far
          ? pose.origin.clone().addScaledVector(pose.direction, slot.distance)
          : pose.point.clone();
        point.add(slot.offset);
        if (this.model.world(slot.holding.entity, slot.holding.star).distanceTo(point) > 0.0008)
          this.model.move(slot.holding, point);
      }
    }
  }
}
