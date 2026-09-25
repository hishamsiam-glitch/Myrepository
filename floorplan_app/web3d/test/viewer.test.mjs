// End-to-end check of the bundled viewer in headless Chromium (WebGL via
// SwiftShader). Run with: npm test (or node --test)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const here = path.dirname(fileURLToPath(import.meta.url));
const htmlPath = path.resolve(here, '..', '..', 'assets', 'web', 'viewer.html');
const shotDir = process.env.SHOT_DIR || path.resolve(here, '..', 'shots');

const sampleScene = {
  walls: [
    { id: 'w1', ax: 0, ay: 0, bx: 5, by: 0, height: 2.7, thickness: 0.15,
      openings: [{ type: 'window', offset: 1.2, width: 1.4, height: 1.2, sill: 0.9 }],
      skin: { kind: 'pattern', pattern: 'brick', color: '#b0563a', scale: 1.0 } },
    { id: 'w2', ax: 5, ay: 0, bx: 5, by: 4, height: 2.7, thickness: 0.15,
      openings: [{ type: 'door', offset: 1.5, width: 0.9, height: 2.1, sill: 0 }],
      skin: { kind: 'color', color: '#e8e4dc', scale: 1 } },
    { id: 'w3', ax: 5, ay: 4, bx: 0, by: 4, height: 2.7, thickness: 0.15, openings: [],
      skin: { kind: 'pattern', pattern: 'tile', color: '#7fb3c9', scale: 0.6 } },
    { id: 'w4', ax: 0, ay: 4, bx: 0, by: 0, height: 2.7, thickness: 0.15,
      openings: [{ type: 'opening', offset: 1.0, width: 1.2, height: 2.1, sill: 0 }],
      skin: { kind: 'pattern', pattern: 'stripes', color: '#c9a46b', scale: 1 } },
  ],
  floors: [[[0, 0], [5, 0], [5, 4], [0, 4]]],
  floorSkin: { kind: 'pattern', pattern: 'wood', color: '#c9a46b', scale: 1.2 },
  selected: null,
};

async function launch() {
  const browser = await chromium.launch({
    // CHROMIUM_PATH lets a machine reuse an already installed browser.
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript(() => { window.__messages = []; });
  await page.goto(pathToFileURL(htmlPath).href);
  await page.waitForFunction(() => window.__messages && window.__messages.some((m) => m.type === 'ready'));
  return { browser, page, errors };
}

test('viewer loads, builds walls with openings and a floor, and renders', async () => {
  const { browser, page, errors } = await launch();
  try {
    await page.evaluate((s) => window.setScene(s), sampleScene);
    await page.waitForTimeout(300);
    const stats = await page.evaluate(() => ({
      walls: window.__viewer.wallCount,
      meshes: window.__viewer.meshCount,
      floors: window.__viewer.floorCount,
    }));
    assert.equal(stats.walls, 4);
    assert.equal(stats.floors, 1);
    assert.ok(stats.meshes > 12, `expected many meshes, got ${stats.meshes}`);

    // The canvas must not be blank: sample a few pixels of the rendered image.
    const nonBackground = await page.evaluate(() => {
      const c = document.querySelector('canvas');
      const probe = document.createElement('canvas');
      probe.width = c.width; probe.height = c.height;
      const ctx = probe.getContext('2d');
      ctx.drawImage(c, 0, 0);
      const d = ctx.getImageData(0, 0, probe.width, probe.height).data;
      let diff = 0;
      for (let i = 0; i < d.length; i += 4 * 97) {
        if (Math.abs(d[i] - 0xdf) > 12 || Math.abs(d[i + 1] - 0xe7) > 12 || Math.abs(d[i + 2] - 0xee) > 12) diff++;
      }
      return diff;
    });
    assert.ok(nonBackground > 50, `rendered image looks blank (${nonBackground} differing samples)`);

    await page.screenshot({ path: path.join(shotDir, 'perspective.png') });
    await page.evaluate(() => window.viewPreset('top'));
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(shotDir, 'top.png') });
    await page.evaluate(() => window.viewPreset('inside'));
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(shotDir, 'inside.png') });
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

test('tapping a wall selects it and reports it to Flutter; re-setting keeps selection', async () => {
  const { browser, page, errors } = await launch();
  try {
    await page.evaluate((s) => window.setScene(s), sampleScene);
    await page.evaluate(() => window.viewPreset('top'));
    await page.waitForTimeout(200);
    // In top view the wall w1 (y=0 edge) is at the top of the room. Project
    // its midpoint to find where to tap.
    const pt = await page.evaluate(() => {
      const cam = window.__viewer.camera();
      const v = new (Object.getPrototypeOf(cam.position).constructor)(2.5, 2.7, 0);
      v.project(cam);
      return { x: (v.x + 1) / 2 * window.innerWidth, y: (1 - v.y) / 2 * window.innerHeight };
    });
    await page.mouse.click(pt.x, pt.y);
    await page.waitForTimeout(100);
    const msgs = await page.evaluate(() => window.__messages);
    const sel = msgs.find((m) => m.type === 'select');
    assert.ok(sel, 'no select message');
    assert.equal(sel.wallId, 'w1');
    assert.equal(await page.evaluate(() => window.__viewer.selectedId), 'w1');

    // Tap the floor centre.
    const fp = await page.evaluate(() => {
      const cam = window.__viewer.camera();
      const v = new (Object.getPrototypeOf(cam.position).constructor)(2.5, 0, 2);
      v.project(cam);
      return { x: (v.x + 1) / 2 * window.innerWidth, y: (1 - v.y) / 2 * window.innerHeight };
    });
    await page.mouse.click(fp.x, fp.y);
    await page.waitForTimeout(100);
    const msgs2 = await page.evaluate(() => window.__messages);
    assert.ok(msgs2.some((m) => m.type === 'select' && m.floor === true), 'floor tap not reported');

    // Flutter re-sends the scene with `selected` while a sheet is open.
    await page.evaluate((s) => window.setScene({ ...s, selected: 'w3' }), sampleScene);
    assert.equal(await page.evaluate(() => window.__viewer.selectedId), 'w3');

    // Snapshot produces a PNG data URL.
    await page.evaluate(() => window.snapshot());
    const snap = await page.evaluate(() => window.__messages.find((m) => m.type === 'snapshot'));
    assert.ok(snap && snap.data.startsWith('data:image/png;base64,'));
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

test('image skins and every pattern build without errors', async () => {
  const { browser, page, errors } = await launch();
  try {
    const patterns = ['brick', 'tile', 'wood', 'parquet', 'stripes', 'plaster', 'concrete', 'marble', 'hex', 'checker', 'stone', 'wallpaper'];
    // A small red/white PNG generated in the page (a real image the loader accepts).
    const png = await page.evaluate(() => {
      const c = document.createElement('canvas');
      c.width = 64; c.height = 64;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 64, 64);
      ctx.fillStyle = '#d62828'; ctx.fillRect(0, 0, 32, 32); ctx.fillRect(32, 32, 32, 32);
      return c.toDataURL('image/png');
    });
    const walls = patterns.map((p, i) => ({
      id: 'p' + i, ax: i, ay: 0, bx: i + 1, by: 0, height: 2.5, thickness: 0.1, openings: [],
      skin: { kind: 'pattern', pattern: p, color: '#a0522d', scale: 0.5 },
    }));
    walls.push({ id: 'img', ax: 0, ay: 2, bx: 4, by: 2, height: 2.5, thickness: 0.1, openings: [],
      skin: { kind: 'image', image: png, color: '#ffffff', scale: 0.5 } });
    await page.evaluate((s) => window.setScene(s), { walls, floors: [], floorSkin: { kind: 'color', color: '#888888', scale: 1 } });
    await page.waitForTimeout(600);
    assert.equal(await page.evaluate(() => window.__viewer.wallCount), walls.length);
    await page.evaluate(() => { const c = window.__viewer.camera(); c.position.set(2, 2.5, 6); c.lookAt(2, 1.2, 1); });
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(shotDir, 'patterns.png') });
    // The image wall must show the red checks, not a black (unloaded) texture.
    const red = await page.evaluate(() => {
      const c = document.querySelector('canvas');
      const probe = document.createElement('canvas');
      probe.width = c.width; probe.height = c.height;
      const ctx = probe.getContext('2d');
      ctx.drawImage(c, 0, 0);
      const d = ctx.getImageData(0, 0, probe.width, probe.height).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] > 90 && d[i] > d[i + 1] * 2.2 && d[i] > d[i + 2] * 2.2) n++;
      return n;
    });
    assert.ok(red > 200, `expected red texture pixels, found ${red}`);
    assert.deepEqual(errors, []);

    // A broken image falls back to the colour instead of leaving a black wall.
    await page.evaluate((s) => window.setScene(s), { walls: [{ id: 'bad', ax: 0, ay: 0, bx: 3, by: 0, height: 2.5, thickness: 0.1, openings: [],
      skin: { kind: 'image', image: 'data:image/png;base64,AAAA', color: '#00ff00', scale: 1 } }], floors: [], floorSkin: { kind: 'color', color: '#888888', scale: 1 } });
    await page.waitForTimeout(500);
    const msgs = await page.evaluate(() => window.__messages);
    assert.ok(msgs.some((m) => m.type === 'error'), 'broken image should be reported');
    assert.equal(await page.evaluate(() => window.__viewer.wallCount), 1);
  } finally {
    await browser.close();
  }
});
