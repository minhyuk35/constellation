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
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } }),
    errors = [],
    api = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`${m.text()} ${m.location().url}`);
  });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => {
    if (r.url().includes('/api/')) api.push(r.url());
  });
  await page.goto(`${base}/vr.html`);
  await page.waitForSelector('#vr-stage canvas');
  assert.equal(
    await page.locator('#vr-enter').isDisabled(),
    true,
    'normal desktop never claims to have entered VR',
  );
  for (const [x, y] of [
    [700, 330],
    [880, 400],
    [780, 570],
    [600, 460],
  ])
    await page.mouse.click(x, y);
  assert.ok((await page.locator('#vr-count').innerText()).includes('별 4개'));
  await page.locator('#vr-finish').click();
  assert.ok((await page.locator('#vr-count').innerText()).includes('1개의 별자리'));
  await page.locator('#vr-undo').click();
  assert.ok((await page.locator('#vr-count').innerText()).includes('별 4개'));
  await page.locator('#vr-finish').click();
  // Source-level harness drives exactly the native joint and controller path,
  // without pretending a desktop has a stereo headset/display runtime.
  if (new URL(base).port === '5173') {
    const result = await page.evaluate(async () => {
      const path = '/src/vr/main.js',
        url =
          performance.getEntriesByType('resource').find((e) => new URL(e.name).pathname === path)
            ?.name || path;
      const three = performance
        .getEntriesByType('resource')
        .find((e) => new URL(e.name).pathname.endsWith('/three.js')).name;
      const { app } = await import(url),
        { Object3D, Vector3 } = await import(three);
      const slot = app.input.slots[0];
      slot.source = { hand: true };
      slot.hand.visible = true;
      slot.controller.visible = true;
      slot.controller.position.set(0, 1.6, 0);
      const thumb = new Object3D(),
        index = new Object3D();
      slot.hand.joints['thumb-tip'] = thumb;
      slot.hand.joints['index-finger-tip'] = index;
      slot.hand.add(thumb, index);
      const pose = (x, distance, t) => {
        thumb.position.set(x - distance / 2, 1.4, -0.55);
        index.position.set(x + distance / 2, 1.4, -0.55);
        app.input.update(t);
      };
      pose(0.1, 0.05, 0);
      pose(0.1, 0.01, 50);
      pose(0.1, 0.01, 100);
      const created = app.model.draft.stars.length;
      pose(0.35, 0.01, 150);
      const moved = app.model.draft.stars[0].x;
      slot.hand.visible = false;
      app.input.update(200);
      const released = !slot.holding;
      slot.hand.visible = true;
      pose(0.6, 0.01, 300);
      pose(0.6, 0.01, 400);
      const beforeRearm = app.model.draft.stars.length;
      pose(0.6, 0.05, 450);
      pose(0.6, 0.01, 500);
      pose(0.6, 0.01, 550);
      pose(0.6, 0.05, 600);
      const afterRearm = app.model.draft.stars.length;
      app.input.releaseAll();
      slot.source = null;
      app.action('finish');
      const controller = app.input.slots[1];
      controller.source = { hand: null };
      controller.controller.visible = true;
      controller.controller.position.set(-0.4, 1.5, 0);
      controller.controller.dispatchEvent({ type: 'selectstart' });
      controller.controller.position.x = -0.2;
      app.input.update(800);
      controller.controller.dispatchEvent({ type: 'selectend' });
      const controllerMoved = app.model.draft.stars[0]?.x;
      app.input.releaseAll();
      controller.source = null;
      // Add one known catalogue drawing and a different depth plane.
      const { SHAPE_MAP } = await import('/src/data/shapes.js');
      for (const p of SHAPE_MAP.get('heart').points)
        app.model.add(new Vector3(p.x * 0.4, 1.6 + p.y * 0.4, -0.65));
      app.action('finish');
      return {
        created,
        moved,
        released,
        beforeRearm,
        afterRearm,
        controllerMoved,
        works: app.model.works.length,
        range: app.world.entries.size,
      };
    });
    assert.equal(result.created, 1);
    assert.ok(result.moved > 0.3);
    assert.equal(result.released, true);
    assert.equal(result.beforeRearm, 1);
    assert.equal(result.afterRearm, 2);
    assert.ok(result.controllerMoved > -0.3);
    assert.equal(result.works, 3);
  }
  await page.screenshot({ path: 'tmp/qa/vr-studio.png' });
  await page.mouse.move(1150, 420);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(500, 420, { steps: 10 });
  await page.mouse.up({ button: 'right' });
  await page.screenshot({ path: 'tmp/qa/vr-turn.png' });
  assert.deepEqual(errors, []);
  assert.deepEqual(api, [], 'VR never publishes exhibition drafts or requests QR/session APIs');
  console.log(
    new URL(base).port === '5173'
      ? 'PASS: independent 360 VR studio; native-joint pinch/drag/loss/rearm, controllers, multiple works/depth; no exhibition APIs. Physical stereo/tracking needs a Meta Quest.'
      : 'PASS: production VR bundle; mouse creation, completion, undo, turning; unavailable VR clearly disabled; no exhibition APIs.',
  );
} finally {
  await browser.close();
}
