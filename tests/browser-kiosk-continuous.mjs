import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

const base = 'http://127.0.0.1:5173';
const executablePath = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find(existsSync);
const browser = await chromium.launch({ executablePath, headless: true, args: ['--enable-webgl', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [], saved = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', r => { if (r.method() === 'POST' && r.url().endsWith('/api/constellations')) saved.push(r.postDataJSON()); });
  await page.goto(base);
  // Retain the actual app model in this isolated development test only. Drive
  // CanvasModel.move, exactly the path used by hand movement, without resetting
  // the canvas, loading another preset, or starting a new participant session.
  await page.evaluate(async () => {
    const path = '/src/interaction/CanvasModel.js';
    const loaded = performance.getEntriesByType('resource').find(entry => new URL(entry.name).pathname === path)?.name || path;
    const { CanvasModel } = await import(loaded);
    const changed = CanvasModel.prototype.changed;
    CanvasModel.prototype.changed = function (...args) {
      window.continuousTestModel = this;
      return changed.apply(this, args);
    };
  });
  await page.locator('#nav-library').click();
  await page.locator('[data-filter="all"]').click();
  await page.locator('[data-shape="heart"]').click();
  const qr = async title => {
    await page.waitForFunction(title => !document.getElementById('creation-ticket').hidden && document.getElementById('ticket-title').textContent === title, title);
    const url = await page.locator('#ticket-link').getAttribute('href');
    assert.equal(await page.locator('#result-name').innerText(), title);
    return url;
  };
  const moveTo = async id => page.evaluate(async id => {
    const { SHAPE_MAP } = await import('/src/data/shapes.js');
    const points = SHAPE_MAP.get(id).points, model = window.continuousTestModel;
    if (points.length !== model.stars.length) throw new Error('Fixture must reuse existing stars');
    points.forEach((p, i) => model.move(model.stars[i].id,
      0.5 + p.x * 0.235 / (innerWidth / innerHeight), 0.46 - p.y * 0.235,
      { trackShake: false }));
  }, id);
  const first = await qr('마음');
  const firstBody = structuredClone(saved[0]);
  await moveTo('butterfly');
  assert.equal(await page.locator('#creation-ticket').isVisible(), false, 'old QR hides at the first edit');
  // Let the normal idle recognition timer finish, rather than requesting a QR.
  const second = await qr('나비');
  assert.notEqual(second, first, 'continuous hand edits automatically replace the QR');
  assert.notEqual(saved[1].requestId, firstBody.requestId);
  assert.notEqual(saved[1].claimToken, firstBody.claimToken);
  await page.locator('#qr-button').click();
  assert.equal(await qr('나비'), second);
  assert.equal(saved.length, 2, 'same completion does not create another draft');
  await page.evaluate(() => {
    const model = window.continuousTestModel, p = model.stars[0];
    model.move(p.id, p.x + 0.001, p.y, { trackShake: false });
  });
  assert.equal(await qr('나비'), second, 'tiny settling keeps the QR after re-recognition');
  assert.equal(saved.length, 2);

  // Confirm the original QR still opens the original saved work.
  const original = await page.evaluate(async url => {
    const { api } = await import('/src/exhibition/api.js');
    const link = new URL(url);
    return api(`/constellations/${link.searchParams.get('id')}/preview`, {
      method: 'POST', body: { claimToken: new URLSearchParams(link.hash.slice(1)).get('claim') },
    });
  }, first);
  assert.equal(original.title, '마음');
  assert.deepEqual(original.drawing, firstBody.drawing);

  let release;
  const blocked = new Promise(resolve => { release = resolve; });
  let intercepted = false;
  await page.route('**/api/constellations', async route => {
    if (route.request().method() === 'POST' && !intercepted) {
      intercepted = true;
      await blocked;
    }
    await route.continue();
  });
  await moveTo('heart');
  await page.getByRole('button', { name: '형태 발견하기', exact: true }).click();
  await page.waitForFunction(() => document.getElementById('result-name').textContent === '마음');
  const pendingStart = saved.length;
  await moveTo('butterfly');
  await page.getByRole('button', { name: '형태 발견하기', exact: true }).click();
  await page.waitForFunction(() => document.getElementById('result-name').textContent === '나비');
  // Edit again while the latest recognition is queued behind the old save.
  await moveTo('heart');
  release();
  await page.waitForTimeout(600);
  assert.equal(await page.locator('#creation-ticket').isVisible(), false, 'late response never revives a QR while editing');
  assert.equal(saved.length, pendingStart, 'an edited-again queued completion is discarded');
  await page.getByRole('button', { name: '형태 발견하기', exact: true }).click();
  const third = await qr('마음');
  assert.notEqual(third, second);
  assert.equal(saved.at(-1).title, '마음');
  await page.unroute('**/api/constellations');
  assert.deepEqual(errors, []);
  console.log('PASS: continuous hand-model edits heart → butterfly → heart; fresh matching QR; hide while editing; repeat/jitter reuse; immutable previous QR; late-save and canceled-queue guards.');
} finally { await browser.close(); }
