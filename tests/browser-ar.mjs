import { chromium } from '@playwright/test';
import { existsSync, mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { SHAPE_MAP } from '../src/data/shapes.js';

const base = process.env.TEST_URL || 'http://127.0.0.1:5173';
const entryState = value => JSON.stringify(value);
const executablePath = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find(existsSync);
const browser = await chromium.launch({
  ...(executablePath ? { executablePath } : {}), headless: true,
  args: ['--enable-webgl', '--enable-unsafe-swiftshader', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
});
const work = (id, shapeId, yaw, pitch) => {
  const shape = SHAPE_MAP.get(shapeId), radius = Math.max(...shape.points.map(p => Math.hypot(p.x, p.y)));
  return { id, title: shape.name, nickname: id, message: '하늘에 남긴 이야기', direction: { yaw, pitch },
    drawing: { stars: shape.points.map(p => ({ x: p.x / radius, y: p.y / radius })), edges: shape.edges } };
};
mkdirSync('tmp/qa', { recursive: true });
try {
  for (const delayed of [false, true]) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await context.addInitScript(() => {
      DeviceOrientationEvent.requestPermission = async () => 'granted';
      window.testPose = { alpha: 147, beta: 0, gamma: 0 };
      setInterval(() => dispatchEvent(new DeviceOrientationEvent('deviceorientation', window.testPose)), 80);
      Object.defineProperty(navigator, 'canShare', { value: () => false, configurable: true });
    });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const own = work('내 작품', 'imagined-rocket', 245, 78);
    let items = [own, work('다른 관람객', 'cygnus', 0, 36)], reads = 0;
    await page.route('**/api/constellations', async route => {
      reads++;
      if (delayed) await gate;
      await route.fulfill({ json: { items } });
    });
    await page.route('**/api/constellations/*', route => route.fulfill({ json: { ...items[1], likes: 0, liked: false, comments: [] } }));
    await page.route('**/api/constellations/*/comments*', route => route.fulfill({ json: { items: [], next: null } }));
    await page.route('**/api/session', route => route.fulfill({ json: { token: `test.${Date.now() + 600000}.local` } }));
    const images = new Set();
    page.on('response', response => {
      if (response.ok() && response.url().includes('/art/')) images.add(new URL(response.url()).pathname);
    });
    // Legacy creator bookmarks must also stop aiming at their own work.
    await page.goto(`${base}/sky.html${delayed ? `?focus=${encodeURIComponent(own.id)}` : ''}`);
    await page.locator('#enter-ar').click();
    await page.waitForFunction(() => document.body.classList.contains('camera-on')).catch(async error => {
      throw new Error(`${error.message}; ${entryState(await page.evaluate(() => ({ status: document.getElementById('sky-status').textContent, motion: document.getElementById('motion-button').textContent, hidden: document.hidden })))}`);
    });
    await page.waitForTimeout(400);
    if (delayed) release();
    await page.waitForFunction(() => document.getElementById('sky-count').textContent === '2');
    assert.equal(await page.locator('#inspect-button').isDisabled(), true, 'upper sky stays off the floor');
    await page.locator('#sky-guide').waitFor({ state: 'visible' });
    assert.ok((await page.locator('#sky-guide').innerText()).includes('휴대폰을 들어'), 'floor entry asks the viewer to lift the phone');
    assert.equal(await page.locator('#motion-button').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('#sky-list-button').count(), 0);
    const entry = delayed ? 'creator' : 'visitor';
    await page.screenshot({ path: `tmp/qa/ar-floor-${entry}.png` });
    await page.evaluate(() => { window.testPose = { alpha: 0, beta: 126, gamma: 0 }; });
    await page.waitForFunction(() => document.getElementById('focus-label').textContent.includes('다른 관람객'));
    for (let attempt = 0; attempt < 50 && !images.has('/art/constellations/cygnus.png'); attempt++) await page.waitForTimeout(100);
    assert.ok(images.has('/art/constellations/cygnus.png'), 'existing constellation illustration loads');
    await page.waitForTimeout(400);
    await page.screenshot({ path: `tmp/qa/ar-illustration-${entry}.png` });
    await page.locator('#inspect-button').click();
    await page.locator('#story-art-credit').waitFor({ state: 'visible' });
    assert.ok((await page.locator('#story-art-credit').innerText()).includes('Meuris'));
    await page.locator('#story-dialog .close-sheet').click();
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: '사진 저장', exact: true }).click();
    await (await downloadPromise).saveAs(`tmp/qa/ar-illustration-capture-${entry}.png`);
    await page.evaluate(() => { window.testPose = { alpha: 115, beta: 168, gamma: 0 }; });
    await page.waitForFunction(() => document.getElementById('focus-label').textContent.includes('내 작품'));
    for (let attempt = 0; attempt < 50 && !images.has('/art/imagined/atlas-01.png'); attempt++) await page.waitForTimeout(100);
    assert.ok(images.has('/art/imagined/atlas-01.png'), 'new catalogue illustration loads');
    await page.waitForTimeout(400);
    await page.screenshot({ path: `tmp/qa/ar-rocket-${entry}.png` });
    items = [...items, work('새 작품', 'heart', 65, 8)];
    await page.waitForFunction(() => document.getElementById('sky-count').textContent === '3', null, { timeout: 14000 });
    assert.ok((await page.locator('#focus-label').innerText()).includes('내 작품'), 'new publications do not turn the view');
    assert.ok(reads >= 2);
    await page.evaluate(() => { window.testPose.beta = 0; });
    await page.waitForFunction(() => document.getElementById('inspect-button').disabled);
    assert.deepEqual(errors, []);
    await context.close();
  }
  const crowded = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const crowdedPage = await crowded.newPage();
  await crowdedPage.route('**/api/constellations', route => route.fulfill({ json: { items: Array.from({ length: 200 }, (_,i) => work(`visitor-${i}`, 'heart', i * 137.5 % 360, 8 + i % 6 * 14)) } }));
  await crowdedPage.goto(`${base}/sky.html`);
  await crowdedPage.waitForFunction(() => document.getElementById('sky-count').textContent === '30');
  await crowded.close();
  console.log('PASS: creator/visitor share fixed sky; floor stays empty, lifting/turning finds works; old/new illustrations and capture; late API data/new publications never aim the camera; 200 public works display only 30.');
} finally { await browser.close(); }
