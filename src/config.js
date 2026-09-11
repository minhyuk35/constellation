export const CONFIG = Object.freeze({
  maxStars: 48,
  recognizeDelay: 3200,
  minStars: 4,
  maxHistory: 50,
  maxArchive: 16,
  fistHold: 1050,
  handLostAfter: 250,
  particleCount: 9500,
});

export const asset = (path) => `${import.meta.env.BASE_URL}${path}`;
