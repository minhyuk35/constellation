import { chromium } from '@playwright/test';
import { existsSync, mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { SHAPE_MAP } from '../src/data/shapes.js';

const base = 'http://127.0.0.1:5173';
const executablePath = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const browser = await chromium.launch({ executablePath, headless: true, args: ['--enable-webgl', '--enable-unsafe-swiftshader'] });
const work = (id, yaw, pitch = 36) => {
  const shape = SHAPE_MAP.get(id), radius = Math.max(...shape.points.map(p => Math.hypot(p.x, p.y)));
  return { id, title: shape.name, direction: { yaw, pitch }, drawing: {
    stars: shape.points.map(p => ({ x: p.x / radius, y: p.y / radius })), edges: shape.edges,
  } };
};
mkdirSync('tmp/qa', { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 900 } }), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${base}/create.html`);
  await page.evaluate(async () => {
    const { SkyView } = await import('/src/exhibition/SkyView.js');
    document.body.replaceChildren();
    document.body.style.cssText = 'margin:0;background:#070e18';
    const stage = document.createElement('div');
    document.body.append(stage);
    window.testSky = new SkyView(stage, () => {});
    window.testSky.yaw = 0;
    window.testSky.pitch = 36;
    window.testSky.aim();
  });
  await page.evaluate(items => window.testSky.setWorks(items), [work('imagined-rocket', -8), work('imagined-satellite', 8), work('cygnus', 180)]);
  await page.waitForFunction(() => ['imagined-rocket', 'imagined-satellite'].every(id => window.testSky.works.get(id).artMesh));
  assert.equal(await page.evaluate(() => window.testSky.artwork.assets.size), 1, 'nearby works share one atlas texture');
  assert.equal(await page.evaluate(() => !!window.testSky.works.get('cygnus').artAsset), false, 'offscreen images are not loaded');
  assert.equal(await page.evaluate(() => {
    const a = window.testSky.works.get('imagined-rocket').artMesh.material.uniforms;
    const b = window.testSky.works.get('imagined-satellite').artMesh.material.uniforms;
    return a.uAtlas.value === b.uAtlas.value && !a.uRect.value.equals(b.uRect.value);
  }), true, 'shared texture has distinct subject rectangles');
  await page.screenshot({ path: 'tmp/qa/ar-shared-atlas.png' });
  await page.evaluate(() => {
    window.textureDisposals = 0;
    const asset = [...window.testSky.artwork.assets.values()][0];
    asset.texture.addEventListener('dispose', () => window.textureDisposals++);
    window.testSky.yaw = 180;
    window.testSky.aim();
  });
  await page.waitForFunction(() => window.testSky.works.get('cygnus').artMesh);
  assert.equal(await page.evaluate(() => window.textureDisposals), 1, 'leaving both works frees the shared GPU texture once');
  assert.equal(await page.evaluate(() => window.testSky.works.get('imagined-rocket').artMesh), null);
  assert.equal(await page.evaluate(() => window.testSky.artwork.assets.size), 1);

  // Inspect the composited framebuffer: black in an opaque legacy image must
  // not replace the camera/background with a dark square.
  const pixels = await page.evaluate(() => {
    const view = window.testSky, entry = view.works.get('cygnus');
    entry.line.visible = false;
    entry.group.children.filter(child => child.isPoints).forEach(child => { child.visible = false; });
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 900;
    const ctx = canvas.getContext('2d');
    view.renderer.render(view.scene, view.camera);
    ctx.drawImage(view.renderer.domElement, 0, 0);
    const after = ctx.getImageData(0, 0, 900, 900).data;
    let opaqueBlack = 0, illuminated = 0;
    for (let i = 0; i < after.length; i += 4) {
      const brightness = Math.max(after[i], after[i + 1], after[i + 2]);
      if (after[i + 3] > 64 && brightness <= 1) opaqueBlack++;
      if (after[i + 3] > 32 && brightness > 5) illuminated++;
    }
    return { opaqueBlack, illuminated };
  });
  assert.equal(pixels.opaqueBlack, 0, 'legacy black matte is transparent over the camera/background');
  assert.ok(pixels.illuminated > 20, 'the illustration is actually drawn, not just downloaded');
  await page.screenshot({ path: 'tmp/qa/ar-legacy-art.png' });

  let release, requested;
  const gate = new Promise(resolve => { release = resolve; });
  const requestSeen = new Promise(resolve => { requested = resolve; });
  const slowPath = SHAPE_MAP.get('imagined-paintbrush').art.src;
  await page.route(`**/${slowPath}`, async route => { requested(); await gate; await route.continue(); });
  await page.evaluate(items => window.testSky.setWorks(items), [work('imagined-paintbrush', 180)]);
  await Promise.race([requestSeen, new Promise((_, reject) => setTimeout(() => reject(new Error('Delayed artwork request missing')), 5000))]);
  await page.evaluate(() => {
    window.removedEntry = window.testSky.works.get('imagined-paintbrush');
    window.testSky.dispose();
  });
  const finished = page.waitForResponse(response => response.url().endsWith(slowPath));
  release();
  await finished;
  await page.waitForTimeout(250);
  assert.equal(await page.evaluate(() => window.testSky.artwork.assets.size), 0);
  assert.equal(await page.evaluate(() => !!window.removedEntry.artMesh), false, 'late artwork cannot resurrect a removed work');
  assert.deepEqual(errors, []);
  console.log('PASS: distinct atlas subjects, nearby-only loading, last-user texture disposal, late artwork after view disposal.');
} finally { await browser.close(); }
