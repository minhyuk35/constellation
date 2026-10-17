import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { deviceQuaternion } from '../src/exhibition/sky-orientation.js';

test('AR preserves gravity: looking down never puts the upper sky on the floor', () => {
  for (const screenAngle of [0, 90, -90, 180]) {
    for (const alpha of [0, 147, 359]) {
      const forward = beta => new Vector3(0, 0, -1).applyQuaternion(
        deviceQuaternion({ alpha, beta, gamma: 0 }, screenAngle),
      );
      assert.ok(forward(0).y < -0.999999, 'flat phone rear camera points down');
      assert.ok(Math.abs(forward(90).y) < 1e-7, 'upright phone points at the horizon');
      assert.ok(Math.abs(forward(135).y - Math.SQRT1_2) < 1e-7, 'raised phone sees the upper sky');
    }
  }
});

test('turning and lifting reaches a fixed server sky direction without target alignment', () => {
  for (const yaw of [0, 245, 359]) for (const pitch of [8, 36, 78]) {
    const rad = Math.PI / 180;
    const expected = new Vector3(Math.sin(yaw * rad) * Math.cos(pitch * rad), Math.sin(pitch * rad), -Math.cos(yaw * rad) * Math.cos(pitch * rad));
    const pose = deviceQuaternion({ alpha: (360 - yaw) % 360, beta: 90 + pitch, gamma: 0 });
    assert.ok(new Vector3(0, 0, -1).applyQuaternion(pose).distanceTo(expected) < 1e-7);
  }
});

test('missing or invalid sensor readings cannot rotate the view', () => {
  for (const value of [null, undefined, NaN, Infinity]) {
    assert.equal(deviceQuaternion({ alpha: value, beta: 90, gamma: 0 }), null);
    assert.equal(deviceQuaternion({ alpha: 0, beta: value, gamma: 0 }), null);
    assert.equal(deviceQuaternion({ alpha: 0, beta: 90, gamma: value }), null);
  }
});
