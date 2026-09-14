import { chromium } from '@playwright/test';
import { existsSync, mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { CONSTELLATIONS } from '../src/data/shapes.js';
import { artwork } from '../src/data/art.js';
const executablePath =
  process.env.CHROME_PATH ||
  [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ].find(existsSync);
const browser = await chromium.launch({
  ...(executablePath ? { executablePath } : {}),
  headless: true,
  args: ['--enable-webgl', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({
  viewport: { width: 1440, height: 1000 },
  deviceScaleFactor: 1,
});
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
mkdirSync('tmp/qa', { recursive: true });
try {
  await page.goto(process.env.TEST_URL || 'http://127.0.0.1:5173/');
  await page.waitForSelector('#stage canvas');
  // In this isolated test page only, retain the scene to inspect actual GPU
  // texture state and projected stars after a real library-button interaction.
  await page.evaluate(async () => {
    const moduleUrl = performance
      .getEntriesByType('resource')
      .find((entry) => /\/src\/scene\/Universe\.js(?:\?|$)/.test(entry.name))?.name;
    const { Universe } = await import(moduleUrl || '/src/scene/Universe.js');
    const show = Universe.prototype.showArt;
    Universe.prototype.showArt = function (...args) {
      show.apply(this, args);
      window.catalogueTestScene = this;
    };
  });
  await page.locator('#nav-library').click();
  assert.equal(await page.locator('.library-card').count(), 12);
  assert.equal(await page.locator('.zodiac-badge').count(), 12);
  await page.screenshot({ path: 'tmp/qa/zodiac-library.png' });
  await page.locator('[data-filter="constellation"]').click();
  assert.equal(await page.locator('.library-card').count(), 88);
  await page.locator('#library-search').fill('북두칠성');
  assert.equal(await page.locator('.library-card').count(), 1);
  assert.equal(await page.locator('.library-card').getAttribute('data-shape'), 'ursa-major');
  await page.locator('#library-search').fill('없는별자리xyz');
  assert.equal(await page.locator('#library-empty').isVisible(), true);
  await page.locator('#library-search').fill('');
  await page.locator('#library-season').selectOption('summer');
  const summer = CONSTELLATIONS.filter((s) => s.season === 'summer').length;
  assert.equal(await page.locator('.library-card').count(), summer);
  await page.locator('#library-season').selectOption('');
  await page.screenshot({ path: 'tmp/qa/all-constellations.png' });
  for (const shape of CONSTELLATIONS) {
    if (!(await page.locator('#library-dialog').isVisible()))
      await page.locator('#nav-library').click();
    await page.locator(`[data-shape="${shape.id}"]`).click();
    assert.equal(await page.locator('#result-name').innerText(), shape.name);
    assert.equal(
      await page.locator('#star-count').innerText(),
      `${String(shape.points.length).padStart(2, '0')} STARS`,
    );
    const state = await page.evaluate(async () => {
      const scene = window.catalogueTestScene;
      await scene.artReady;
      const texture = scene.artMaterial.uniforms.uAtlas.value;
      return {
        src: texture.image.src,
        grid: scene.artMaterial.uniforms.uGrid.value,
        ready: scene.artTarget,
        stars: scene.starData.length,
        edges: scene.edgeData.length,
        cache: scene.artTextures.size,
      };
    });
    assert.equal(state.ready, 1, shape.id);
    assert.ok(state.src.endsWith(artwork(shape).src), `${shape.id}: wrong illustration`);
    assert.equal(state.grid, artwork(shape).grid, shape.id);
    assert.equal(state.edges, shape.edges.length, shape.id);
    assert.ok(state.cache <= 12, 'GPU texture cache limit');
    if (['Leo', 'Tau', 'Cyg', 'Ser'].includes(shape.abbr)) {
      await page.waitForTimeout(1800);
      await page.screenshot({ path: `tmp/qa/constellation-${shape.abbr}.png` });
    }
  }
  // Rapid switching must never apply a late image from the preceding shape.
  await page.evaluate(async () => {
    const scene = window.catalogueTestScene;
    const { SHAPE_MAP } = await import('/src/data/shapes.js');
    const transform = scene.artMatch.transform;
    for (const id of ['aries', 'cygnus', 'leo', 'aquila', 'taurus'])
      scene.showArt({ shape: SHAPE_MAP.get(id), transform });
    await scene.artReady;
  });
  assert.equal(await page.evaluate(() => window.catalogueTestScene.artMatch.shape.id), 'taurus');
  assert.ok(
    (
      await page.evaluate(
        () => window.catalogueTestScene.artMaterial.uniforms.uAtlas.value.image.src,
      )
    ).endsWith('zodiac-atlas.png'),
  );
  await page.locator('#nav-library').click();
  await page.locator('[data-shape="canis-minor"]').click();
  await page.locator('#qr-button').click();
  assert.equal(await page.locator('#qr-dialog').isVisible(), true);
  await page.locator('#qr-dialog .close-dialog').click();
  await page.locator('#nav-archive').click();
  await page.locator('.archive-entry').first().click();
  assert.equal(await page.locator('#result-name').innerText(), '작은개자리');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(600);
  assert.equal(await page.locator('#star-count').innerText(), '02 STARS');
  assert.equal(await page.locator('#discovery').isVisible(), true);
  await page.locator('#nav-library').click();
  await page.locator('[data-filter="zodiac"]').click();
  assert.equal(await page.locator('[data-filter="zodiac"]').getAttribute('aria-pressed'), 'true');
  await page.screenshot({ path: 'tmp/qa/zodiac-mobile.png' });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.locator('[data-shape="scorpius"]').click();
  assert.ok(!(await page.locator('#drawing-hint').innerText()).includes('2개'));
  await page.waitForTimeout(1800);
  await page.screenshot({ path: 'tmp/qa/scorpius-mobile.png' });
  const minGap = await page.evaluate(() => {
    const scene = window.catalogueTestScene;
    let min = Infinity;
    for (let i = 0; i < scene.starData.length; i++)
      for (let j = i + 1; j < scene.starData.length; j++) {
        const a = scene.starData[i],
          b = scene.starData[j];
        min = Math.min(
          min,
          Math.hypot((a.x - b.x) * scene.width, (a.y - b.y) * scene.height) / scene.zoom,
        );
      }
    return min;
  });
  assert.ok(minGap >= 20, `mobile stars too close: ${minGap}px`);
  assert.deepEqual(errors, []);
  console.log(
    'PASS: all 88 presets, all artwork textures, 12 zodiac dates, search, seasons, GPU cache, rapid switching, small-star QR/archive, mobile spacing.',
  );
} finally {
  await browser.close();
}
