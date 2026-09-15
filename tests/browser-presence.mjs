import { chromium } from '@playwright/test';
import { existsSync, mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';

const executablePath = process.env.CHROME_PATH || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find(existsSync);
const browser = await chromium.launch({
  ...(executablePath ? { executablePath } : {}),
  headless: true,
  args: ['--enable-webgl', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
mkdirSync('tmp/qa', { recursive: true });
try {
  await page.goto(process.env.TEST_URL || 'http://127.0.0.1:5173/');
  await page.waitForSelector('#stage canvas');
  // Capture the real application's controllers without a camera permission
  // request. Synthetic detector results still use the production callbacks.
  await page.evaluate(async () => {
    const loadedModule = (path) => performance.getEntriesByType('resource')
      .find((entry) => new URL(entry.name).pathname === path)?.name || path;
    const { Universe } = await import(loadedModule('/src/scene/Universe.js'));
    const { PoseController } = await import(loadedModule('/src/interaction/PoseController.js'));
    const show = Universe.prototype.showArt;
    Universe.prototype.showArt = function (...args) {
      window.presenceTestScene = this;
      return show.apply(this, args);
    };
    const tick = PoseController.prototype.tick;
    PoseController.prototype.tick = function (...args) {
      window.presenceTestController = this;
      return tick.apply(this, args);
    };
  });
  await page.locator('#nav-library').click();
  await page.locator('[data-shape="aries"]').click();
  await page.waitForFunction(() => window.presenceTestController && window.presenceTestScene?.reveal === 1);
  await page.keyboard.press('h');
  await page.waitForTimeout(400);
  const result = await page.evaluate(async () => {
    const scene = window.presenceTestScene;
    const controller = window.presenceTestController;
    await scene.artReady;
    // Six detections repeatedly assigned new tracking IDs previously formed
    // a dense web, because old IDs stay cached for the tracking timeout.
    controller.video = { videoWidth: 640, videoHeight: 480 };
    controller.active = true;
    const originalEdges = JSON.stringify(scene.edgeData);
    for (let frame = 0; frame < 5; frame++) {
      controller.clockSeconds += 0.1;
      controller.integrate(Array.from({ length: 6 }, (_, i) => {
        const x = (0.3 + i * 0.06 + frame * 0.009) * 640;
        const y = (0.66 + Math.sin(i + frame) * 0.03) * 480;
        return { id: `${frame}-${i}`, score: 0.9, keypoints: [
          { x, y: y - 80, score: 0.9 },
          { x: x - 35, y: y + 80, score: 0.9 },
          { x: x + 35, y: y + 80, score: 0.9 },
        ] };
      }), 0.1);
    }
    controller.active = false;
    scene.renderer.render(scene.scene, scene.camera);
    const extraLines = [];
    scene.scene.traverse((object) => {
      if (object.isLineSegments && object !== scene.lines && object.visible &&
          object.geometry.drawRange.count > 0) extraLines.push(object.geometry.drawRange.count / 2);
    });
    return {
      extraLines,
      presenceCount: scene.presencePeople.length,
      starCount: scene.drawingStars.geometry.drawRange.count,
      edgesUnchanged: JSON.stringify(scene.edgeData) === originalEdges,
    };
  });
  await page.screenshot({ path: `tmp/qa/presence-${result.extraLines.length ? 'before' : 'after'}.png` });
  assert.ok(result.presenceCount >= 6, 'multi-person particle interaction remains active');
  assert.equal(result.starCount, 4, 'Aries stars remain visible');
  assert.equal(result.edgesUnchanged, true, 'camera detections must not alter constellation connections');
  assert.deepEqual(result.extraLines, [], 'camera detections must not draw an unrelated line web');
  await page.evaluate(() => window.presenceTestController.stop());
  assert.equal(await page.evaluate(() => window.presenceTestScene.presencePeople.length), 0);
  assert.deepEqual(errors, []);
  console.log('PASS: repeated multi-person detections create no stray lines; Aries connections, presence particles, and camera-stop cleanup remain intact.');
} finally {
  await browser.close();
}
