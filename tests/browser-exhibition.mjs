import { chromium } from '@playwright/test';
import { existsSync, mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
const base = process.env.TEST_URL || 'http://127.0.0.1:5173';
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname))
  throw new Error('This test writes fixtures only to a local exhibition.');
const chromePath =
  process.env.CHROME_PATH ||
  [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ].find(existsSync);
const browser = await chromium.launch({
  ...(chromePath ? { executablePath: chromePath } : {}),
  headless: true,
  args: ['--enable-webgl', '--enable-unsafe-swiftshader'],
});
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
  acceptDownloads: true,
});
// Headless Windows cannot show a native share sheet; exercise the download fallback.
await context.addInitScript(() => {
  DeviceOrientationEvent.requestPermission = async () => 'granted';
  Object.defineProperty(navigator, 'canShare', { value: () => false, configurable: true });
});
const page = await context.newPage(),
  errors = [];
page.on('pageerror', (e) => errors.push(e.message));
mkdirSync('tmp/qa', { recursive: true });
try {
  await page.goto(base);
  await page.getByRole('button', { name: '전시 연결', exact: true }).click();
  await page.getByLabel('운영자 키', { exact: true }).fill('wrong-key');
  await page.getByRole('button', { name: '연결 확인', exact: true }).click();
  await page.getByText('운영자 키가 올바르지 않습니다. 전시 연결에서 다시 입력해 주세요.', { exact: true }).waitFor();
  assert.equal(await page.locator('#exhibition-dialog').isVisible(), true);
  assert.equal(await page.evaluate(() => localStorage.getItem('constellation-kiosk-key')), null);
  await page.getByLabel('운영자 키', { exact: true }).fill('local-exhibition-only');
  await page.getByRole('button', { name: '연결 확인', exact: true }).click();
  await page.locator('#exhibition-dialog').waitFor({ state: 'hidden' });
  assert.equal(await page.evaluate(() => localStorage.getItem('constellation-kiosk-key')), 'local-exhibition-only');
  const claimToken = 'a'.repeat(64);
  const response = await fetch(`${base}/api/constellations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer local-exhibition-only' },
    body: JSON.stringify({
      requestId: crypto.randomUUID(),
      claimToken,
      title: `테스트 · 작은 산책 ${crypto.randomUUID().slice(0,8)}`,
      drawing: {
        stars: [
          { x: -0.8, y: -0.3 },
          { x: -0.25, y: 0.4 },
          { x: 0.2, y: -0.1 },
          { x: 0.7, y: 0.55 },
        ],
        edges: [
          [0, 1],
          [1, 2],
          [2, 3],
        ],
      },
    }),
  });
  assert.equal(response.status, 201);
  const { id } = await response.json();
  const creatorUrl = `${base}/create.html?id=${id}#claim=${claimToken}`;
  await page.goto(creatorUrl);
  await page.locator('#creator-form').waitFor({ state: 'visible' });
  assert.equal(new URL(page.url()).hash, '', 'claim token removed from address bar');
  await page.getByLabel('남기고 싶은 이름').fill('저녁의 산책자');
  await page
    .getByLabel('별에 담은 이야기')
    .fill('돌아오는 길에 발견한 작은 빛.\n오늘도 반가웠어요.');
  await page.getByRole('button', { name: '우리의 하늘에 띄우기' }).click();
  await page.waitForURL('**/sky.html');
  const published = await (await fetch(`${base}/api/constellations`)).json();
  const direction = published.items.find(work => work.id === id).direction;
  const turnToWork = async target => {
    await target.locator('#motion-button').click();
    await target.evaluate(({ yaw, pitch }) => {
      dispatchEvent(new DeviceOrientationEvent('deviceorientation', { alpha: (360 - yaw) % 360, beta: 90 + pitch, gamma: 0 }));
    }, direction);
    await target.waitForFunction(() => document.getElementById('focus-label').textContent.includes('저녁의 산책자'));
  };
  await page.getByRole('button', { name: '화면으로 먼저 둘러보기' }).click();
  await turnToWork(page);
  assert.ok((await page.locator('#focus-label').innerText()).includes('저녁의 산책자'));
  await page.screenshot({ path: 'tmp/qa/exhibition-sky.png' });
  await page.getByRole('button', { name: '중앙 별자리의 이야기 보기' }).click();
  await page.waitForFunction(() => !document.getElementById('like-button').disabled);
  assert.equal(await page.locator('#story-author').innerText(), '저녁의 산책자');
  await page.locator('#like-button').click();
  await page.waitForFunction(() => document.getElementById('like-count').textContent === '1');
  await page.getByLabel('익명으로 한마디').fill('<img src=x onerror=alert(1)> 정말 예뻐요');
  await page.getByRole('button', { name: '남기기', exact: true }).click();
  await page.getByText('<img src=x onerror=alert(1)> 정말 예뻐요', { exact: true }).waitFor();
  assert.equal(await page.locator('#comments img').count(), 0, 'comment text never becomes HTML');
  await page.screenshot({ path: 'tmp/qa/exhibition-story.png' });
  await page.locator('#story-dialog .close-sheet').click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '사진 저장', exact: true }).click();
  const download = await downloadPromise;
  assert.equal(download.suggestedFilename(), 'our-constellation.png');
  await download.saveAs('tmp/qa/exhibition-capture.png');
  const second = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await second.addInitScript(() => { DeviceOrientationEvent.requestPermission = async () => 'granted'; });
  const viewer = await second.newPage();
  await viewer.goto(`${base}/sky.html`);
  await viewer.getByRole('button', { name: '화면으로 먼저 둘러보기' }).click();
  await turnToWork(viewer);
  await viewer.locator('#inspect-button').click();
  await viewer.waitForFunction(() => !document.getElementById('like-button').disabled);
  assert.equal(await viewer.locator('#like-button').getAttribute('aria-pressed'), 'false');
  await viewer.locator('#like-button').click();
  await viewer.waitForFunction(() => document.getElementById('like-count').textContent === '2');
  await viewer.goto(creatorUrl);
  await viewer.locator('#view-sky').waitFor({ state: 'visible' });
  assert.equal(await viewer.locator('#view-sky').getAttribute('href'), 'sky.html', 'returning creator uses the ordinary sky');
  assert.equal(
    await viewer.locator('#creator-form').isVisible(),
    false,
    'another visitor cannot replace authorship',
  );
  await page.goto(`${base}/entrance.html`);
  await page.waitForFunction(() => document.getElementById('entrance-qr').naturalWidth > 0);
  assert.equal(await page.locator('#entrance-url').getAttribute('href'), `${base}/sky.html`);
  assert.ok((await page.locator('#entrance-status').innerText()).includes('HTTPS'));
  await page.screenshot({ path: 'tmp/qa/exhibition-entry.png' });
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    'no horizontal overflow',
  );
  assert.deepEqual(errors, []);
  console.log(
    'PASS: creator QR → publish → separate anonymous viewer → like/comment → capture; safe text; one-time claim; entry QR.',
  );
} finally {
  await browser.close();
}
