/* End-to-end smoke test: serves the game, drives it in headless Chromium
 * with a mocked Android sensor bridge and checks the core mechanics: sensor
 * steering, shooting, checkpoints + persistence, missions, gates, death and
 * extraction. Run with: npm test (needs `playwright`; see README). */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { matrixFromEuler } from '../js/sensors.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = decodeURIComponent(req.url.split('?')[0]);
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

// --- rotation helpers (world-from-device matrices, row major) -------------
const mul = (A, B) => { const C = new Array(9).fill(0); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) C[i * 3 + j] += A[i * 3 + k] * B[k * 3 + j]; return C; };
const rad = (d) => d * Math.PI / 180;
const Rz = (d) => { const c = Math.cos(rad(d)), s = Math.sin(rad(d)); return [c, -s, 0, s, c, 0, 0, 0, 1]; };
const Ry = (d) => { const c = Math.cos(rad(d)), s = Math.sin(rad(d)); return [c, 0, s, 0, 1, 0, -s, 0, c]; };
const UPRIGHT = matrixFromEuler(0, 90, 0);           // portrait, screen facing the user
const LANDSCAPE = mul(UPRIGHT, Rz(90));              // top of the phone to the left (rotation 90)
const pose = ({ turn = 0, tiltFwd = 0, rollRight = 0 } = {}) =>
  // turn: degrees to the right; tiltFwd: top edge away from the user; rollRight: right edge down.
  mul(mul(Rz(-turn), mul(UPRIGHT, Rz(90 - rollRight))), Ry(tiltFwd));

async function main() {
  const { server, port } = await serve();
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const context = await browser.newContext({ viewport: { width: 960, height: 440 }, hasTouch: true, deviceScaleFactor: 1 });
  // Mock the Android bridge: sensors come from window.__pose, storage is
  // backed by localStorage so it survives a reload like SharedPreferences.
  await context.addInitScript(() => {
    window.__pose = { r: [1, 0, 0, 0, 1, 0, 0, 0, 1], rot: 90, ok: false };
    window.AndroidBridge = {
      getSensors: () => JSON.stringify({ ok: window.__pose.ok, yawOk: true, source: 'mock_rotation_vector', rot: window.__pose.rot, r: window.__pose.r }),
      hasRotationSensor: () => true,
      getItem: (k) => localStorage.getItem('mock.' + k),
      setItem: (k, v) => localStorage.setItem('mock.' + k, v),
      removeItem: (k) => localStorage.removeItem('mock.' + k),
      vibrate: () => {},
    };
  });
  const page = await context.newPage();
  if (process.env.SLOW) { // simulate a slow CI runner: SLOW=6 node test/smoke.test.js
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(process.env.SLOW) || 4 });
  }
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  const setPose = (p) => page.evaluate((r) => { window.__pose.r = r; window.__pose.ok = true; }, p);
  const G = (fn, arg) => page.evaluate(fn, arg);
  const teleport = (cx, cy, yaw) => G(([x, y, yw]) => { const g = GyroStrike; g.player.x = (x + 0.5) * 4; g.player.z = (y + 0.5) * 4; if (yw != null) g.player.yaw = yw; }, [cx, cy, yaw]);
  const phase = () => G(() => GyroStrike.phase);
  const waitPhase = (p, timeout = 5000) => page.waitForFunction((pp) => GyroStrike.phase === pp, p, { timeout });
  const shot = (name) => page.screenshot({ path: path.join(__dirname, `screenshot-${name}.png`) });
  // CI runners render slowly and the game clamps its time step, so checks
  // wait for a condition to become true rather than for a fixed delay.
  const waitFor = async (fn, arg, msg, timeout = 10000) => {
    try { await page.waitForFunction(fn, arg, { timeout }); }
    catch (e) { throw new assert.AssertionError({ message: `${msg} (timed out after ${timeout} ms)` }); }
  };

  await page.goto(`http://127.0.0.1:${port}/?test=1`);
  await page.waitForFunction(() => window.GyroStrike && GyroStrike.phase === 'title');
  await page.waitForTimeout(200);
  const status = await page.$eval('#sensor-status', (el) => el.textContent);
  assert.ok(/ready/i.test(status), `sensor status should report the bridge (got "${status}")`);
  assert.ok(await page.$eval('#btn-continue', (b) => b.disabled), 'Continue disabled with no save');
  await shot('title');

  // ---- new game, neutral pose -> no movement ---------------------------
  await setPose(pose());
  await page.click('#btn-new');
  await waitPhase('playing');
  await G(() => { GyroStrike.godMode = true; });
  await page.waitForTimeout(400);
  const p0 = await G(() => ({ x: GyroStrike.player.x, z: GyroStrike.player.z, yaw: GyroStrike.player.yaw }));
  assert.ok(Math.abs(p0.x - 3.5 * 4) < 0.01 && Math.abs(p0.z - 34.5 * 4) < 0.01, `player should start at the start cell (${p0.x},${p0.z})`);
  assert.strictEqual(await G(() => GyroStrike.enemies.length), 2, 'zone 1 spawns two crawlers');
  await page.waitForTimeout(300);
  const p1 = await G(() => ({ x: GyroStrike.player.x, z: GyroStrike.player.z }));
  assert.ok(Math.hypot(p1.x - p0.x, p1.z - p0.z) < 0.05, 'neutral pose must not move the player');

  // ---- tilt forward -> walk forward (start faces +x) -------------------
  await setPose(pose({ tiltFwd: 20 }));
  await waitFor((x0) => GyroStrike.player.x - x0 > 3, p1.x, 'tilting forward should walk forward along +x');
  const p2 = await G(() => ({ x: GyroStrike.player.x, z: GyroStrike.player.z, mz: GyroStrike.input.state.moveZ }));
  assert.ok(Math.abs(p2.z - p1.z) < 0.5, 'no sideways drift while walking forward');
  assert.ok(p2.mz > 0.8, `forward tilt of 20 deg should give (near) full speed (moveZ ${p2.mz.toFixed(2)})`);
  await shot('walking');

  // ---- tilt back -> walk backwards ------------------------------------
  await setPose(pose({ tiltFwd: -20 }));
  await waitFor((x2) => GyroStrike.player.x < x2 - 1, p2.x, 'tilting back should walk backwards');

  // ---- turn the phone right 30 deg -> camera turns right ----------------
  await setPose(pose());
  await waitFor(() => Math.abs(GyroStrike.input.state.moveZ) < 0.05, null, 'movement should stop in the neutral pose');
  const yaw0 = await G(() => GyroStrike.player.yaw);
  await setPose(pose({ turn: 30 }));
  const sens = await G(() => GyroStrike.settings.turnSens);
  await waitFor((y0) => Math.abs(GyroStrike.player.yaw - y0) > 0.1, yaw0, 'turning the phone should turn the camera');
  const yaw1 = await G(() => GyroStrike.player.yaw);
  assert.ok(Math.abs((yaw0 - yaw1) - rad(30) * sens) < 0.02, `turning the phone 30 deg right should turn the camera ${30 * sens} deg right (got ${((yaw0 - yaw1) * 180 / Math.PI).toFixed(1)})`);

  // ---- roll right edge down -> strafe right ------------------------------
  await setPose(pose({ turn: 30, rollRight: 15 }));
  await waitFor(() => GyroStrike.input.state.moveX > 0.4, null, 'rolling the right edge down should strafe right');
  await setPose(pose({ turn: 30 }));
  await waitFor(() => Math.abs(GyroStrike.input.state.moveX) < 0.05, null, 'strafe should stop when level again');

  // ---- gyro scheme: tilt controls pitch ----------------------------------
  await G(() => { GyroStrike.setScheme('gyro'); GyroStrike.input.recenter(); });
  await waitFor(() => !GyroStrike.input.wantRecenter, null, 'recenter should apply on the next sample');
  await setPose(pose({ turn: 30, tiltFwd: -20 }));
  await waitFor((target) => Math.abs(GyroStrike.player.pitch - target) < 0.03, rad(20), 'gyro scheme: tilting up should look up 20 deg');
  await setPose(pose({ turn: 30 }));
  await G(() => GyroStrike.setScheme('tilt'));

  // ---- shooting: face a crawler and hold fire ---------------------------
  await G(() => {
    // Put the player in the open, and park a crawler 6 m straight ahead.
    const g = GyroStrike; g.player.x = 3.5 * 4; g.player.z = 32.5 * 4; g.player.pitch = 0; g.player.yaw = -Math.PI / 2; // facing +x
    g.enemies.forEach((e, i) => { e.frozen = true; e.x = g.player.x + 6 + i * 3; e.z = g.player.z; });
  });
  const ammo0 = await G(() => GyroStrike.state.ammo);
  await page.keyboard.down('Space');
  await waitFor((a0) => GyroStrike.state.ammo <= a0 - 3, ammo0, 'holding fire should fire repeatedly');
  await page.keyboard.up('Space');
  await shot('shooting');
  const combat = await G(() => ({ ammo: GyroStrike.state.ammo, kills: GyroStrike.state.kills, score: GyroStrike.state.score, hits: GyroStrike.stats.hits, shots: GyroStrike.stats.shots }));
  assert.ok(combat.ammo < ammo0, 'firing consumes ammo');
  assert.ok(combat.hits > 0, `shots at a crawler in the open should hit (${combat.hits}/${combat.shots})`);
  assert.ok(combat.kills >= 1 && combat.score >= 75, `two hits kill a crawler (kills ${combat.kills}, score ${combat.score})`);

  // ---- checkpoint saves progress -----------------------------------------
  await teleport(18, 31);
  await waitFor(() => GyroStrike.state.checkpoint === 1, null, 'walking through checkpoint 1 records it');
  const cp = await G(() => ({ cp: GyroStrike.state.checkpoint, saved: JSON.parse(localStorage.getItem('mock.gs.save.v1') || 'null') }));
  assert.strictEqual(cp.cp, 1, 'walking through checkpoint 1 records it');
  assert.ok(cp.saved && cp.saved.checkpoint === 1 && cp.saved.kills >= 1, 'save written through the bridge');

  // ---- hangar mission: eliminate -> gate A opens -------------------------
  await teleport(40, 22, Math.PI / 2);
  await waitPhase('mission');
  const title = await page.$eval('#mission-title', (e) => e.textContent);
  assert.ok(/hangar/i.test(title), `hangar mission should trigger (got "${title}")`);
  await page.click('#btn-mission-go');
  await waitPhase('playing');
  await waitFor(() => document.getElementById('mission').classList.contains('visible'), null, 'mission panel visible');
  await shot('hangar');
  const z3 = await G(() => GyroStrike.enemies.filter((e) => e.zone === 3).length);
  assert.strictEqual(z3, 6, 'hangar spawns its six hostiles');
  assert.ok(await G(() => document.getElementById('mission').classList.contains('visible')), 'mission panel visible');
  await G(() => GyroStrike.enemies.filter((e) => e.zone === 3).forEach((e) => e.hit(9999)));
  await waitFor(() => GyroStrike.state.missionsDone.has('hangar'), null, 'hangar mission completes when all hostiles die');
  const afterHangar = await G(() => ({ done: [...GyroStrike.state.missionsDone], gates: [...GyroStrike.state.gatesOpen], mission: !!GyroStrike.activeMission, cleared: [...GyroStrike.state.clearedZones] }));
  assert.deepStrictEqual(afterHangar.done, ['hangar'], 'hangar mission completes when all hostiles die');
  assert.deepStrictEqual(afterHangar.gates, ['A'], 'gate A opens');
  assert.ok(!afterHangar.mission, 'mission panel closes');
  assert.ok(afterHangar.cleared.includes(3), 'zone 3 marked cleared');
  await waitFor(() => !GyroStrike.level.solid[22 * GyroStrike.level.w + 23], null, 'gate A cells become walkable');

  // ---- storage mission: collect 3 cores within the time limit -------------
  await teleport(10, 14, 0);
  await waitPhase('mission');
  await page.click('#btn-mission-go');
  await waitPhase('playing');
  for (const [x, y] of [[10, 16], [21, 10], [14, 12]]) {
    await teleport(x, y);
    await waitFor(([cx, cy]) => GyroStrike.state.collected.has(GyroStrike.level.pickups.find((p) => p.x === cx && p.y === cy).id), [x, y], `core at (${x},${y}) collected`);
  }
  const afterCores = await G(() => ({ done: [...GyroStrike.state.missionsDone], gates: [...GyroStrike.state.gatesOpen], collected: [...GyroStrike.state.collected] }));
  assert.ok(afterCores.done.includes('cores'), 'collecting all cores completes the mission');
  assert.ok(afterCores.gates.includes('B'), 'gate B opens');
  assert.strictEqual(afterCores.collected.filter((c) => c.startsWith('c')).length, 3);

  // ---- race mission fails on timeout -> retry from checkpoint -------------
  await teleport(26, 13); // checkpoint 6 (saves the two completed missions)
  await waitFor(() => GyroStrike.state.checkpoint === 6, null, 'checkpoint 6 records');
  await teleport(32, 13, 0);
  await waitPhase('mission');
  await page.click('#btn-mission-go');
  await waitPhase('playing');
  await G(() => { GyroStrike.activeMission.time = 1000; });
  await waitPhase('failed');
  await shot('failed');
  await page.click('#btn-retry');
  await waitPhase('playing');
  await G(() => { GyroStrike.godMode = true; });
  const afterRetry = await G(() => ({ cp: GyroStrike.state.checkpoint, x: GyroStrike.player.x, z: GyroStrike.player.z, done: [...GyroStrike.state.missionsDone], gates: [...GyroStrike.state.gatesOpen] }));
  assert.strictEqual(afterRetry.cp, 6, 'retry restores the last checkpoint');
  assert.ok(Math.abs(afterRetry.x - 26.5 * 4) < 0.01 && Math.abs(afterRetry.z - 13.5 * 4) < 0.01, 'player respawns on the checkpoint');
  assert.deepStrictEqual(afterRetry.done.sort(), ['cores', 'hangar'], 'missions completed before the checkpoint stay done');
  assert.deepStrictEqual(afterRetry.gates.sort(), ['A', 'B']);

  // ---- persistence across a reload (the app being closed) ------------------
  await page.reload();
  await page.waitForFunction(() => window.GyroStrike && GyroStrike.phase === 'title');
  const contLabel = await page.$eval('#btn-continue', (b) => ({ disabled: b.disabled, text: b.textContent }));
  assert.ok(!contLabel.disabled && /checkpoint 6/.test(contLabel.text), `Continue should offer checkpoint 6 (got "${contLabel.text}")`);
  await setPose(pose());
  await page.click('#btn-continue');
  await waitPhase('playing');
  await G(() => { GyroStrike.godMode = true; });
  const resumed = await G(() => ({ cp: GyroStrike.state.checkpoint, gates: [...GyroStrike.state.gatesOpen].sort(), kills: GyroStrike.state.kills }));
  assert.strictEqual(resumed.cp, 6);
  assert.deepStrictEqual(resumed.gates, ['A', 'B']);
  assert.ok(resumed.kills >= 1);

  // ---- race mission completes at the relay -------------------------------
  await teleport(32, 13, 0);
  await waitPhase('mission');
  await page.click('#btn-mission-go');
  await waitPhase('playing');
  await teleport(27, 4);
  await waitFor(() => GyroStrike.state.missionsDone.has('relay'), null, 'reaching the relay completes the race');

  // ---- death and respawn -----------------------------------------------
  await G(() => { GyroStrike.godMode = false; GyroStrike.hurt(500); });
  await waitPhase('dead');
  await page.waitForSelector('#screen-dead.visible', { timeout: 3000 });
  await shot('dead');
  await page.click('#btn-respawn');
  await waitPhase('playing');
  await G(() => { GyroStrike.godMode = true; });
  assert.strictEqual(await G(() => GyroStrike.state.health), 100, 'respawn restores the checkpoint health');

  // ---- hold-out mission spawns waves, then extraction wins ----------------
  await teleport(10, 4, 0);
  await waitPhase('mission');
  await page.click('#btn-mission-go');
  await waitPhase('playing');
  await waitFor(() => GyroStrike.enemies.some((e) => e.zone === 8), null, 'hold-out spawns a wave immediately');
  await G(() => { GyroStrike.activeMission.time = 44.9; });
  await waitFor(() => GyroStrike.beaconOnline, null, 'surviving brings the beacon online');
  await teleport(3, 4);
  await waitPhase('win');
  await page.waitForSelector('#screen-win.visible', { timeout: 3000 });
  await shot('win');
  assert.strictEqual(await G(() => localStorage.getItem('mock.gs.save.v1')), null, 'finishing clears the save');
  assert.ok(await G(() => JSON.parse(localStorage.getItem('mock.gs.best.v1')).score > 0), 'best score recorded');

  // ---- pause via the Android back button ---------------------------------
  await page.click('#btn-again');
  await waitPhase('playing');
  assert.strictEqual(await G(() => GyroStrike.onBackButton()), true);
  assert.strictEqual(await phase(), 'paused');
  await page.click('#btn-resume');
  await waitPhase('playing');

  assert.deepStrictEqual(errors, [], 'no page errors expected');
  await browser.close();
  server.close();
  console.log('All checks passed');
}

main().catch((e) => { console.error(e); process.exit(1); });
