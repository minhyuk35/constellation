import * as tf from '@tensorflow/tfjs-core';
import '@tensorflow/tfjs-backend-cpu';
import * as poseDetection from '@tensorflow-models/pose-detection';

// CPU backend, not WebGL: MoveNet runs alongside Three.js's own WebGL
// renderer on the main thread, so a GPU backend here would queue its work
// behind (and compete for the same driver/GPU resources as) the render loop.
// Running in a worker at all keeps the inference off the main thread
// entirely, so even a slow frame here never stalls rendering or hand tracking.
let detector;
self.onmessage = async ({ data }) => {
  if (data.type === 'init') {
    try {
      await tf.setBackend('cpu');
      await tf.ready();
      detector = await poseDetection.createDetector(poseDetection.SupportedModels.MoveNet, {
        modelType: poseDetection.movenet.modelType.MULTIPOSE_LIGHTNING,
        modelUrl: data.modelUrl,
        enableTracking: true,
        trackerType: poseDetection.TrackerType.BoundingBox,
      });
      self.postMessage({ type: 'ready' });
    } catch (error) {
      self.postMessage({ type: 'error', message: error.message });
    }
    return;
  }
  if (data.type === 'frame') {
    try {
      const poses = await detector.estimatePoses(data.bitmap, { maxPoses: 6 });
      self.postMessage({ type: 'result', poses });
    } catch (error) {
      self.postMessage({ type: 'error', message: error.message });
    } finally {
      data.bitmap.close();
    }
  }
};
