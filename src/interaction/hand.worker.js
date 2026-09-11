import { HandLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
let detector;
self.onmessage = async ({ data }) => {
  if (data.type === 'init') {
    try {
      const vision = await FilesetResolver.forVisionTasks(data.wasmUrl);
      const loaderUrl = vision.wasmLoaderPath.replace(/\.js$/, '.mjs');
      const { default: factory } = await import(/* @vite-ignore */ loaderUrl);
      self.ModuleFactory = factory;
      vision.wasmLoaderPath = undefined;
      // CPU delegate inside the worker avoids competing with the Three.js GPU.
      detector = await HandLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: data.modelUrl, delegate: 'CPU' },
        runningMode: 'VIDEO',
        numHands: 2,
        minHandDetectionConfidence: 0.6,
        minHandPresenceConfidence: 0.6,
        minTrackingConfidence: 0.6,
      });
      self.postMessage({ type: 'ready' });
    } catch (error) {
      self.postMessage({ type: 'error', message: error.message });
    }
    return;
  }
  if (data.type === 'frame') {
    try {
      const result = detector.detectForVideo(data.bitmap, data.timestamp);
      self.postMessage({
        type: 'result',
        landmarks: result.landmarks,
        handedness: result.handedness,
      });
    } catch (error) {
      self.postMessage({ type: 'error', message: error.message });
    } finally {
      data.bitmap.close();
    }
  }
};
