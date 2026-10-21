import { chromium } from '@playwright/test';
import { existsSync, mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
const executablePath = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const browser = await chromium.launch({ executablePath, headless: true,
  args: ['--enable-webgl', '--enable-unsafe-swiftshader'] });
mkdirSync('tmp/qa', { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } }), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('http://127.0.0.1:5173/');
  await page.evaluate(async () => {
    const loaded = path => performance.getEntriesByType('resource').find(e => new URL(e.name).pathname === path)?.name || path;
    const { Universe } = await import(loaded('/src/scene/Universe.js'));
    const { CanvasModel } = await import(loaded('/src/interaction/CanvasModel.js'));
    const sync = Universe.prototype.syncDrawing, changed = CanvasModel.prototype.changed;
    Universe.prototype.syncDrawing = function(...args) { window.fxScene = this; return sync.apply(this, args); };
    CanvasModel.prototype.changed = function(...args) { window.fxModel = this; return changed.apply(this, args); };
  });
  await page.getByRole('button', { name: '마우스로 먼저 둘러보기' }).click();
  await page.getByRole('button', { name: '새로운 우주', exact: true }).click();
  await page.mouse.click(720, 410);
  await page.waitForTimeout(110);
  assert.equal(await page.evaluate(() => window.fxScene.starParticles.emitted), 2);
  await page.screenshot({ path: 'tmp/qa/web-star-create.png' });
  const shaken = await page.evaluate(() => {
    const model = window.fxModel, id = model.stars[0].id, now = performance.now();
    model.beginDrag(id);
    for (const [i, x] of [.5, .6, .4, .6, .4].entries()) {
      model.move(id, x, .46, { trackShake: false }); model.trackShake(id, x, now + i * 50);
    }
    return { count: model.stars.length, emitted: window.fxScene.starParticles.emitted };
  });
  assert.equal(shaken.count, 0); assert.equal(shaken.emitted, 4);
  await page.waitForTimeout(90);
  await page.screenshot({ path: 'tmp/qa/web-star-delete.png' });
  await page.keyboard.press('Control+z');
  assert.equal(await page.locator('#star-count').innerText(), '01 STARS');
  await page.mouse.click(1000, 450);
  await page.keyboard.press('Delete');
  assert.equal(await page.locator('#star-count').innerText(), '01 STARS');
  assert.equal(await page.evaluate(() => window.fxScene.starParticles.emitted), 8);
  await page.goto('http://127.0.0.1:5173/vr.html');
  await page.waitForSelector('#vr-stage canvas');
  await page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').find(e => new URL(e.name).pathname === '/src/vr/main.js').name;
    const { app } = await import(url); window.fxVR = app;
    app.input.prepareDraft(); app.model.add({ x: 0, y: 1.6, z: -.7 });
  });
  assert.equal(await page.locator('#vr-stage canvas').count(), 1);
  await page.waitForTimeout(110);
  await page.screenshot({ path: 'tmp/qa/vr-star-create.png' });
  await page.evaluate(() => window.fxVR.model.remove({ entity: window.fxVR.model.draft, star: window.fxVR.model.draft.stars[0] }));
  await page.waitForTimeout(90);
  await page.screenshot({ path: 'tmp/qa/vr-star-delete.png' });
  assert.equal(await page.evaluate(() => window.fxVR.world.particles.emitted), 4);
  assert.deepEqual(errors, []);
  console.log('PASS: real WebGL creation/shake-deletion/keyboard-deletion particles and undo on website, same GPU effects in VR; no shader errors.');
} finally { await browser.close(); }
