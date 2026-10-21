export const CONFIG = Object.freeze({
  maxStars: 48,
  recognizeDelay: 3200,
  minStars: 4,
  maxHistory: 50,
  maxArchive: 16,
  fistHold: 1050,
  handLostAfter: 250,
  handDetectInterval: 33,
  handGrabRadius: 14, // CSS px from the visible star to the cursor centre, not its outer ring.
  vrRecognizeDelay: 2000,
  guidanceDelay: 1200,
  handControl: Object.freeze({
    enabled: true,
    armMs: 1000,
    releaseMs: 2200,
    sampleGapMs: 300,
    matchRadius: 0.20,
    ambiguityRadius: 0.10,
    centerMargin: 0.25,
  }),
  handMotion: Object.freeze({
    // Screen CSS pixels and seconds; independent of camera resolution / DPR.
    minCutoff: 1.5,
    beta: 0.025,
    derivativeCutoff: 1,
    deadZone: 1.25,
    movingDeadZone: 0.25,
    responsiveSpeed: 350,
    interpolationMs: 24,
    maxInterpolationMs: 55,
  }),
  handGestures: Object.freeze({
    pinchEnter: 0.40, pinchExit: 0.56, confirmMs: 30,
    // A bent index can oppose the thumb while the other three fingers stay folded.
    oppositionReach: 0.32, oppositionReachHold: 0.26,
    oppositionAdvance: 0.20, oppositionAdvanceHold: 0.12,
    // Compact side/depth pinches need separation from the folded middle finger,
    // even when the index does not advance along the wrist-to-knuckle axis.
    oppositionSpread: 0.16, oppositionSpreadHold: 0.10,
  }),
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
