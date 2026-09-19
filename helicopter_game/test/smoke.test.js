/* End-to-end smoke test: serves the game, drives it in headless Chromium
 * with synthetic tilt / touch input and checks the core mechanics.
 * Run with: npm test (needs the `playwright` package; see README). */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { chromium, devices } = require('playwright');

const ROOT = path.join(__dirname, '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = req.url.split('?')[0];
      const file = path.join(ROOT, url === '/' ? 'index.html' : url);
      fs.readFile(file, (err, data) => {
        if (err) { res.writeHead(404); res.end('not found'); return; }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
        res.end(data);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

async function main() {
  const { server, port } = await serve();
  const browser = await chromium.launch();
  const context = await browser.newContext({ ...devices['Pixel 5'], deviceScaleFactor: 2 });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto(`http://127.0.0.1:${port}/?seed=42`);
  await page.waitForFunction(() => window.HeliGame && window.HeliGame.phase === 'menu');
  await page.click('#btn-start');
  await page.waitForFunction(() => window.HeliGame.phase === 'playing');
  console.log('started, spawn', await page.evaluate(() => ({ x: HeliGame.heli.x, y: HeliGame.heli.y })));

  // Hovering: no finger -> no forward motion.
  await page.waitForTimeout(600);
  const dist0 = await page.evaluate(() => HeliGame.stats.distance);
  assert.strictEqual(dist0, 0, 'helicopter should hover while no finger is held');

  // Level tilt as neutral, then hold a finger: should move forward.
  await page.evaluate(() => HeliGame.input.injectOrientation(45, 0));
  await page.evaluate(() => {
    const c = document.getElementById('game');
    c.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, pointerType: 'touch', clientX: 200, clientY: 500, bubbles: true, isPrimary: true }));
  });
  await page.waitForTimeout(1500);
  const heading0 = await page.evaluate(() => HeliGame.heli.heading);
  const dist1 = await page.evaluate(() => HeliGame.stats.distance);
  assert.ok(dist1 > 50, `helicopter should move forward while finger is held (moved ${dist1})`);
  assert.ok(Math.abs(heading0) < 0.01, 'heading should stay straight with no roll tilt');

  // Roll the phone right by 20 degrees: heading should increase (turn right).
  await page.evaluate(() => HeliGame.input.injectOrientation(45, 20));
  await page.waitForTimeout(800);
  const heading1 = await page.evaluate(() => HeliGame.heli.heading);
  assert.ok(heading1 > 0.3, `roll tilt should turn the helicopter (heading ${heading1})`);

  // Pull the top of the phone towards you: climb.
  const alt0 = await page.evaluate(() => HeliGame.heli.alt);
  await page.evaluate(() => HeliGame.input.injectOrientation(65, 0));
  await page.waitForTimeout(800);
  const alt1 = await page.evaluate(() => HeliGame.heli.alt);
  assert.ok(alt1 > alt0 + 10, `pitch tilt should climb (alt ${alt0} -> ${alt1})`);

  // Fuel drains while flying.
  const fuel = await page.evaluate(() => HeliGame.heli.fuel);
  assert.ok(fuel < 100, 'fuel should be consumed');

  // Lift the finger: helicopter slows down to a hover.
  await page.evaluate(() => {
    const c = document.getElementById('game');
    c.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, pointerType: 'touch', bubbles: true }));
  });
  await page.waitForTimeout(3500);
  const speed = await page.evaluate(() => HeliGame.heli.speed);
  assert.ok(speed < 40, `helicopter should slow to a hover after lifting the finger (speed ${speed})`);

  await page.screenshot({ path: path.join(__dirname, 'screenshot-playing.png') });

  // Terrain collision: put the helicopter at ground level over a mountain.
  await page.evaluate(() => {
    const w = HeliGame.world;
    let best = null;
    for (let y = -6000; y < 6000 && !best; y += 64) {
      for (let x = -6000; x < 6000; x += 64) {
        if (w.groundAt(x, y) > 50) { best = { x, y }; break; }
      }
    }
    HeliGame.heli.x = best.x;
    HeliGame.heli.y = best.y;
    HeliGame.heli.alt = 10;
  });
  await page.waitForFunction(() => HeliGame.phase === 'over', null, { timeout: 5000 });
  const reason = await page.$eval('#over-reason', (el) => el.textContent);
  assert.strictEqual(reason, 'Crashed into the terrain');
  await page.screenshot({ path: path.join(__dirname, 'screenshot-over.png') });

  // Restart works.
  await page.click('#btn-restart');
  await page.waitForFunction(() => HeliGame.phase === 'playing');

  // Gravity-vector input with the phone held upright in portrait: the
  // orientation-angle path would be unstable here, the motion path is not.
  await page.evaluate(() => HeliGame.input.calibrate());
  await page.evaluate(() => HeliGame.input.injectMotion(0, 9.8, 0)); // upright = neutral
  await page.evaluate(() => {
    const c = document.getElementById('game');
    c.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 2, pointerType: 'touch', clientX: 200, clientY: 500, bubbles: true, isPrimary: true }));
  });
  await page.waitForTimeout(400);
  const hA = await page.evaluate(() => HeliGame.heli.heading);
  await page.evaluate(() => HeliGame.input.injectMotion(-3.4, 9.2, 0)); // right edge down ~20 deg
  await page.waitForTimeout(800);
  const hB = await page.evaluate(() => HeliGame.heli.heading);
  assert.ok(hB - hA > 0.3, `upright roll should turn right via the motion sensor (${hA} -> ${hB})`);
  const steerRoll = await page.evaluate(() => HeliGame.input.state.rawRoll);
  assert.ok(Math.abs(steerRoll - 20.3) < 1, `roll angle from gravity should be ~20 deg (got ${steerRoll})`);

  // Once motion events flow, orientation-angle events are ignored.
  await page.evaluate(() => HeliGame.input.injectOrientation(45, -80));
  const stillRoll = await page.evaluate(() => HeliGame.input.state.rawRoll);
  assert.ok(Math.abs(stillRoll - steerRoll) < 0.001, 'orientation events must not override motion input');

  // Tipping the top of the phone away (towards flat) descends.
  await page.evaluate(() => HeliGame.input.injectMotion(0, 8, 5.7));
  const altA = await page.evaluate(() => HeliGame.heli.alt);
  await page.waitForTimeout(800);
  const altB = await page.evaluate(() => HeliGame.heli.alt);
  assert.ok(altB < altA - 8, `tipping the phone away should descend (${altA} -> ${altB})`);
  await page.evaluate(() => {
    const c = document.getElementById('game');
    c.dispatchEvent(new PointerEvent('pointerup', { pointerId: 2, pointerType: 'touch', bubbles: true }));
  });

  // The terrain generator produces every biome within a few km of spawn.
  const biomes = await page.evaluate(() => {
    const w = HeliGame.world;
    const seen = new Set();
    for (let y = -8000; y < 8000; y += 80) for (let x = -8000; x < 8000; x += 80) seen.add(w.biomeAt(x, y));
    return [...seen].sort();
  });
  assert.strictEqual(biomes.length, 10, `expected all 10 biomes near spawn, got ${biomes}`);

  assert.deepStrictEqual(errors, [], 'no page errors expected');
  await browser.close();
  server.close();
  console.log('All checks passed');
}

main().catch((e) => { console.error(e); process.exit(1); });
