export const CONFIG = Object.freeze({
  maxStars: 48,
  recognizeDelay: 3200,
  minStars: 4,
  maxHistory: 50,
  maxArchive: 16,
  fistHold: 1050,
  handLostAfter: 250,
  particleCount: 9500,
  presenceCount: 360,
  poseDetectInterval: 110,
  poseMinScore: 0.25,
  poseKeypointMinScore: 0.2,
  poseInteractBoxRatio: 0.3,
  poseStillness: 0.006,
  poseStillHold: 0.6,
  poseSilhouetteHold: 2.4,
  poseSilhouetteDuration: 3.4,
  poseTrailDistance: 0.05,
  poseTimeout: 4,
});

export const asset = (path) => `${import.meta.env.BASE_URL}${path}`;
