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
  await page.locator('#vr-library').click();
  await page.locator('[data-filter="all"]').click();
  assert.equal(await page.locator('.library-card').count(), 200);
  await page.locator('#library-search').fill('로켓');
  assert.equal(await page.locator('.library-card').count(), 1);
  await page.locator('#library-dialog .close-dialog').click();
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
      const { XR_LANDMARKS } = await import('/src/vr/VRGestures.js');
      const { handPoints } = await import('/tests/fixtures/vr-hands.js');
      for (const name of XR_LANDMARKS) {
        const joint = new Object3D();
        slot.hand.joints[name] = joint; slot.hand.add(joint);
      }
      const pose = (gesture, x, t) => {
        const points = handPoints(gesture, { x, y: 1.4, z: -.55 });
        XR_LANDMARKS.forEach((name, i) => slot.hand.joints[name].position.copy(points[i]));
        slot.controller.position.set(x, 1.4, 0);
        app.input.update(t);
      };
      pose('pinch', 2, 0); pose('pinch', 2, 40);
      pose('open', 2, 100); pose('open', 2, 140);
      pose('pinch', 2, 200); pose('pinch', 2, 240);
      const emptyPinch = app.model.draft.stars.length;
      pose('open',.15,250);pose('open',.15,290);pose('open',.15,490);
      pose('fist', .15, 500); pose('fist', .15, 540);
      pose('fist', .15, 1600); pose('fist', .15, 2500);
      const created = app.model.draft.stars.length;
      pose('pinch', .15, 2600); pose('pinch', .15, 2640);
      pose('pinch', .4, 2700);
      const moved = app.model.world(app.model.draft, app.model.draft.stars[0]).x;
      slot.hand.visible = false; app.input.update(2750);
      const released = !slot.holding;
      slot.hand.visible = true;
      pose('pinch', .4, 2800); pose('pinch', .4, 2840);
      const beforeRearm = !!slot.holding;
      pose('open', .4, 2900); pose('open', .4, 2940);
      pose('pinch', .4, 3000); pose('pinch', .4, 3040);
      const afterRearm = !!slot.holding;
      for (const [x, t] of [[.5, 3100], [.2, 3160], [.5, 3220], [.2, 3280]]) pose('pinch', x, t);
      const shaken = app.model.draft.stars.length;
      app.input.releaseAll(); slot.source = null;
      app.action('undo');
      const undoShake = app.model.draft.stars.length;
      const particles = app.world.particles.emitted;
      app.model.add(new Vector3(-.3, 1.4, -.55));
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
        emptyPinch, created, shaken, undoShake, particles,
        moved,
        released,
        beforeRearm,
        afterRearm,
        controllerMoved,
        works: app.model.works.length,
        range: app.world.entries.size,
      };
    });
    assert.equal(result.emptyPinch, 0);
    assert.equal(result.created, 1);
    assert.equal(result.shaken, 0);
    assert.equal(result.undoShake, 1);
    assert.ok(result.particles >= 4,'creation and deletion emit distinct small wave sets');
    assert.ok(result.moved > 0.3);
    assert.equal(result.released, true);
    assert.equal(result.beforeRearm, false);
    assert.equal(result.afterRearm, true);
    assert.ok(result.controllerMoved > -0.3);
    assert.equal(result.works, 3);
    await page.evaluate(async () => {
      const url = performance.getEntriesByType('resource').find(e => new URL(e.name).pathname === '/src/vr/main.js').name;
      const { app } = await import(url), { SHAPE_MAP } = await import('/src/data/shapes.js');
      window.vrTestApp = app;
      app.input.prepareDraft();
      for (const p of SHAPE_MAP.get('heart').points) app.model.add({ x: p.x * .27, y: 1.6 + p.y * .27, z: -.65 });
    });
    await page.waitForFunction(() => window.vrTestApp.model.draft.shapeId === 'heart');
    await page.waitForFunction(() => !!window.vrTestApp.world.entries.get(window.vrTestApp.model.draft.id).artMesh);
    const plane = await page.evaluate(() => {
      const { model, world } = window.vrTestApp, entry = world.entries.get(model.draft.id);
      return { z: entry.artMesh.position.z, center: entry.center.z, edges: model.draft.edges.length };
    });
    assert.ok(Math.abs(plane.z - plane.center + .02) < .001, 'draft illustration appears on its drawing plane before completion');
    assert.ok(plane.edges > 0);
    await page.screenshot({ path: 'tmp/qa/vr-auto-heart.png' });
    const catalogue = await page.evaluate(async () => {
      const url = performance.getEntriesByType('resource').find(e => new URL(e.name).pathname === '/src/vr/main.js').name;
      const { app } = await import(url), { SHAPES } = await import('/src/data/shapes.js');
      app.action('preset:heart');
      const matches = app.model.draft.shapeId === 'heart' && JSON.stringify(app.model.draft.edges) === JSON.stringify(SHAPES.find(s => s.id === 'heart').edges);
      await new Promise(resolve => setTimeout(resolve, 350));
      app.action('finish');
      const library = app.world.library, visited = new Set();
      library.visible = true; library.action('filter:all');
      for (let i = 0; i < Math.ceil(SHAPES.length / 3); i++) {
        for (const id of library.entries.keys()) visited.add(id);
        library.action('library-next');
      }
      library.action('filter:zodiac');
      document.body.classList.add('in-vr');
      return { matches, visited: visited.size, completed: app.model.works.at(-1).shapeId };
    });
    assert.equal(catalogue.matches, true);
    assert.equal(catalogue.completed, 'heart');
    assert.equal(catalogue.visited, 200);
    await page.waitForTimeout(400);
    await page.screenshot({ path: 'tmp/qa/vr-library.png' });
    await page.evaluate(async () => {
      const url = performance.getEntriesByType('resource').find(e => new URL(e.name).pathname === '/src/vr/main.js').name;
      const { app } = await import(url);
      app.world.library.visible = false;
      document.body.classList.remove('in-vr');
    });
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
      ? 'PASS: independent 360 VR studio; native-joint fist/pinch/drag/shake/loss/rearm, controllers, multiple works/depth; no exhibition APIs. Physical stereo/tracking needs a Meta Quest.'
      : 'PASS: production VR bundle; mouse creation, completion, undo, turning; unavailable VR clearly disabled; no exhibition APIs.',
  );
} finally {
  await browser.close();
}
