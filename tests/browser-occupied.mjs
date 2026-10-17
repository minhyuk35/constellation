import { chromium } from '@playwright/test';
import { existsSync, mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
const base = process.env.TEST_URL || 'http://127.0.0.1:5173';
const executablePath = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find(existsSync);
const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ['--enable-webgl', '--enable-unsafe-swiftshader'],
});
mkdirSync('tmp/qa', { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }),
    errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => localStorage.setItem('constellation-kiosk-key', 'test-operator'));
  let owned = false,
    creates = 0,
    holdPoll = false,
    release,
    started;
  const gate = new Promise((resolve) => {
      release = resolve;
    }),
    pollStarted = new Promise((resolve) => {
      started = resolve;
    });
  await page.route('**/api/kiosk/status', (r) => r.fulfill({ json: { ok: true } }));
  await page.route('**/api/kiosk/availability*', async (route) => {
    const title = new URL(route.request().url()).searchParams.get('title');
    if (title === '마음' && holdPoll) {
      started();
      await gate;
    }
    await route.fulfill({
      json:
        owned && title === '마음'
          ? { occupied: true, owner: { id: 'public-work', title, nickname: '먼저 온 별' } }
          : { occupied: false },
    });
  });
  await page.route('**/api/constellations', (route) => {
    if (route.request().method() === 'POST') {
      creates++;
      return route.fulfill({ json: { id: crypto.randomUUID() } });
    }
    return route.fulfill({ json: { items: [] } });
  });
  const select = async (id) => {
    await page.locator('#nav-library').click();
    await page.locator('[data-filter="all"]').click();
    await page.locator(`[data-shape="${id}"]`).click();
  };
  const qr = async (title) =>
    page.waitForFunction((title) => {
      const c = document.getElementById('creation-ticket');
      return (
        !c.hidden &&
        c.dataset.state === 'qr' &&
        document.getElementById('ticket-title').textContent === title
      );
    }, title);
  await page.goto(base);
  await page.locator('#exhibition-settings').click();
  await page.locator('#connect-exhibition').click();
  await page.locator('#exhibition-dialog').waitFor({ state: 'hidden' });
  await select('heart');
  await qr('마음');
  assert.equal(creates, 1);
  owned = true;
  await page.waitForFunction(
    () => document.getElementById('creation-ticket').dataset.state === 'occupied',
    null,
    { timeout: 6500 },
  );
  assert.equal(await page.locator('#ticket-link').isVisible(), false);
  assert.equal(await page.locator('#ticket-image').getAttribute('src'), null);
  assert.ok((await page.locator('#ticket-message').innerText()).includes('먼저 온 별'));
  await page.screenshot({ path: 'tmp/qa/occupied-constellation.png' });
  await select('butterfly');
  await qr('나비');
  const count = creates;
  await select('heart');
  await page.waitForFunction(
    () =>
      !document.getElementById('creation-ticket').hidden &&
      document.getElementById('creation-ticket').dataset.state === 'occupied',
  );
  assert.equal(creates, count, 'already claimed catalogue titles do not create drafts');
  owned = false;
  await select('heart');
  await qr('마음');
  holdPoll = true;
  owned = true;
  await pollStarted;
  await select('butterfly');
  await qr('나비');
  release();
  await page.waitForTimeout(400);
  assert.equal(await page.locator('#creation-ticket').getAttribute('data-state'), 'qr');
  assert.equal(
    await page.locator('#ticket-title').innerText(),
    '나비',
    'late ownership response cannot replace a newer QR',
  );
  assert.deepEqual(errors, []);
  console.log(
    'PASS: completed creator form changes displayed QR to owner notice; repeating claimed work creates no QR/draft; another shape restores QR; late ownership response ignored.',
  );
} finally {
  await browser.close();
}
