import { chromium } from '@playwright/test';
import { existsSync, mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { SHAPES } from '../src/data/shapes.js';

const chromePath =
  process.env.CHROME_PATH ||
  [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ].find(existsSync);
const browser = await chromium.launch({
  ...(chromePath ? { executablePath: chromePath } : {}),
  headless: true,
  args: [
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    '--enable-webgl',
    '--enable-unsafe-swiftshader',
  ],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  deviceScaleFactor: 1,
  acceptDownloads: true,
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error' && !m.text().startsWith('INFO: Created TensorFlow Lite'))
    errors.push(m.text());
});
mkdirSync('tmp/qa', { recursive: true });
try {
  await page.goto(process.env.TEST_URL || 'http://127.0.0.1:5173/');
  await page.waitForSelector('#stage canvas');
  await page.waitForTimeout(2000);
  assert.equal(await page.locator('#render-error').isVisible(), false);
  await page.screenshot({ path: 'tmp/qa/desktop.png' });
  assert.equal(await page.locator('#star-count').innerText(), '04 STARS');
  await page.getByRole('button', { name: '마우스로 먼저 둘러보기' }).click();
  await page.getByRole('button', { name: '새로운 우주', exact: true }).click();
  assert.equal(await page.locator('#star-count').innerText(), '00 STARS');
  const shape = SHAPES.find((s) => s.id === 'heart');
  for (const p of shape.points) await page.mouse.click(720 + p.x * 220, 430 - p.y * 220);
  assert.equal(await page.locator('#star-count').innerText(), '10 STARS');
  await page.getByRole('button', { name: '형태 발견하기', exact: true }).click();
  await page.waitForFunction(
    () =>
      document.getElementById('result-name').textContent === '마음' &&
      !document.getElementById('discovery').hidden,
  );
  await page.waitForTimeout(1800);
  await page.screenshot({ path: 'tmp/qa/heart.png' });
  await page.mouse.move(720, 617);
  await page.mouse.down();
  await page.mouse.move(680, 650, { steps: 7 });
  await page.mouse.up();
  assert.equal(await page.locator('#undo-button').isEnabled(), true);
  assert.equal(await page.locator('#interpret-button').isEnabled(), true);
  await page.keyboard.press('Control+z');
  assert.equal(await page.locator('#star-count').innerText(), '10 STARS');
  await page.getByRole('button', { name: '별자리 도감' }).click();
  assert.equal(await page.locator('.library-card').count(), 16);
  await page.getByRole('button', { name: '국화 불러오기', exact: true }).click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'tmp/qa/flower.png' });
  assert.equal(await page.locator('#result-name').innerText(), '국화');
  await page.getByRole('button', { name: '나의 기록', exact: true }).click();
  assert.ok((await page.locator('.archive-entry').count()) >= 2);
  await page.locator('.archive-entry').last().click();
  assert.equal(await page.locator('#result-name').innerText(), '마음');
  await page.getByRole('button', { name: '화면 설정', exact: true }).click();
  await page.getByRole('button', { name: '카메라 연결', exact: true }).click();
  await page.waitForFunction(
    () => document.getElementById('camera-toggle').textContent.includes('카메라 끄기'),
    { timeout: 30000 },
  );
  await page.getByRole('button', { name: '닫기', exact: true }).click();
  await page.waitForFunction(
    () => document.getElementById('input-status').textContent === 'SHOW YOUR HANDS',
  );
  await page.getByRole('button', { name: '화면 설정', exact: true }).click();
  await page.getByRole('button', { name: '카메라 끄기', exact: true }).click();
  await page.getByRole('button', { name: '닫기', exact: true }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '순간 저장', exact: true }).click();
  const download = await downloadPromise;
  assert.ok(download.suggestedFilename().endsWith('.png'));
  await download.saveAs('tmp/qa/export.png');
  await page.keyboard.press('h');
  assert.equal(await page.locator('#exit-immersive').isVisible(), true);
  await page.keyboard.press('h');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(process.env.TEST_URL || 'http://127.0.0.1:5173/');
  await page.waitForTimeout(1800);
  await page.screenshot({ path: 'tmp/qa/mobile.png' });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.getByRole('button', { name: '별자리 도감' }).click();
  await page.getByRole('button', { name: '나비 불러오기', exact: true }).click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: 'tmp/qa/mobile-drawing.png' });
  assert.deepEqual(errors, []);
  console.log(
    'PASS: render, create, recognize heart, drag/undo, 16-item library, archive, real hand model startup with a fake camera, camera stop, PNG export, immersive mode, mobile layout.',
  );
} catch (error) {
  console.error('Original failure:', error);
  console.error('Console errors:', errors);
  console.error('URL:', page.url());
  console.error(
    'Visible status:',
    await page
      .locator('#toast')
      .textContent({ timeout: 1500 })
      .catch(() => 'page unavailable'),
  );
  await page.screenshot({ path: 'tmp/qa/failure.png', timeout: 5000 }).catch(() => {});
  throw error;
} finally {
  await browser.close();
}
