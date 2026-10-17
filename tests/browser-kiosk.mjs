import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { SHAPES } from '../src/data/shapes.js';

// Run a production build against the local Worker: DEV's convenience key would
// otherwise conceal the missing-key / connect-after-discovery regression.
const base = process.env.TEST_URL || 'http://127.0.0.1:4173';
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname))
  throw new Error('This test creates drafts only in a local exhibition.');
const executablePath = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find(existsSync);
const browser = await chromium.launch({ executablePath, headless: true, args: ['--enable-webgl', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [], created = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', r => { if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/constellations') created.push(r.postDataJSON()); });
  const select = async id => {
    await page.locator('#nav-library').click();
    await page.locator('[data-filter="all"]').click();
    await page.locator(`#library-grid [data-shape="${id}"]`).click();
  };
  const connect = async () => {
    await page.locator('#exhibition-settings').click();
    await page.getByLabel('운영자 키', { exact: true }).fill('local-exhibition-only');
    await page.locator('#connect-exhibition').click();
    await page.locator('#exhibition-dialog').waitFor({ state: 'hidden' });
  };
  const qr = async title => {
    await page.locator('#creation-ticket').waitFor({ state: 'visible' });
    await page.waitForFunction(title => document.getElementById('ticket-title').textContent === title, title);
    const link = new URL(await page.locator('#ticket-link').getAttribute('href'));
    assert.equal(link.pathname, '/create.html');
    assert.ok(link.hash.startsWith('#claim='));
    return link.searchParams.get('id');
  };
  await page.goto(base);
  await page.waitForSelector('#stage canvas');
  assert.equal(await page.locator('#creation-ticket').isVisible(), false);
  assert.equal(created.length, 0, 'intro never publishes');
  await select('heart');
  assert.equal(await page.locator('#creation-ticket').isVisible(), false);
  assert.equal(created.length, 0, 'missing operator key never publishes');
  await connect();
  const first = await qr('마음');
  assert.equal(created.length, 1, 'late connection publishes existing discovery');
  await connect();
  assert.equal(await qr('마음'), first);
  assert.equal(created.length, 1, 'reconnecting keeps the same draft');
  await select('imagined-rocket');
  const second = await qr('로켓');
  assert.notEqual(second, first, 'new preset gets its own QR');

  let release;
  const blocked = new Promise(resolve => { release = resolve; });
  await page.route('**/api/constellations', async route => {
    if (route.request().method() === 'POST' && route.request().postDataJSON().title === '기타') await blocked;
    await route.continue();
  });
  const sending = page.waitForRequest(r => r.method() === 'POST' && r.url().endsWith('/api/constellations') && r.postDataJSON().title === '기타');
  await select('imagined-guitar');
  await sending;
  await select('imagined-camera');
  release();
  assert.notEqual(await qr('사진기'), second, 'rapid selection eventually shows newest QR');
  assert.equal(created.at(-1).title, '사진기');
  await page.unroute('**/api/constellations');

  await page.evaluate(() => localStorage.removeItem('constellation-kiosk-key'));
  await page.reload();
  await page.getByRole('button', { name: '마우스로 먼저 둘러보기' }).click();
  await page.getByRole('button', { name: '새로운 우주', exact: true }).click();
  for (const p of SHAPES.find(s => s.id === 'heart').points) await page.mouse.click(720 + p.x * 220, 430 - p.y * 220);
  await page.getByRole('button', { name: '형태 발견하기', exact: true }).click();
  await page.waitForFunction(() => document.getElementById('result-name').textContent === '마음');
  const before = created.length;
  await connect();
  await qr('마음');
  assert.equal(created.length, before + 1, 'late connection also publishes a manually drawn match');
  assert.deepEqual(errors, []);
  console.log('PASS: no intro draft; late key connection after preset/manual discovery; automatic preset QR; reconnect idempotency; rapid switching retains newest QR.');
} finally {
  await browser.close();
}
