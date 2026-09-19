/* Gyro Strike - main game: scene, player, checkpoints, missions, HUD. */

import * as THREE from './lib/three.min.js';
import {
  buildLevel, CELL, WALL_H, cellToWorld, worldToCell, isSolid, inRect,
  moveWithCollision, lineOfSight, rayWallDistance, computeFlowField,
} from './level.js';
import { SensorSource } from './sensors.js';
import { Input, DEFAULT_SETTINGS } from './input.js';
import { storage } from './save.js';
import { GameAudio } from './audio.js';
import {
  Enemy, ENEMY_DEFS, Projectile, makePickupMesh, makeCheckpointMesh, makeBeaconMesh,
  makeGateMesh, makeWeapon, Particles,
} from './entities.js';

const $ = (id) => document.getElementById(id);
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const SAVE_VERSION = 1;
const PLAYER = { radius: 0.45, eye: 1.6, speed: 6.5, maxHealth: 100, maxAmmo: 200, dmg: 12, fireInterval: 0.17 };

class Game {
  constructor() {
    this.phase = 'title';
    this.settings = Object.assign({}, DEFAULT_SETTINGS, storage.get(storage.KEYS.settings) || {});
    this.testMode = /\btest=1\b/.test(location.search);

    // ---- rendering --------------------------------------------------
    this.canvas = $('game');
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0e1626);
    this.scene.fog = new THREE.Fog(0x0e1626, 18, 80);
    this.camera = new THREE.PerspectiveCamera(75, 1, 0.05, 200);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);
    this.scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x3a4a3a, 2.2));
    const sun = new THREE.DirectionalLight(0xfff2dd, 2.0);
    sun.position.set(0.6, 1, 0.35);
    this.scene.add(sun);
    this.levelGroup = new THREE.Group();
    this.scene.add(this.levelGroup);
    this.weapon = makeWeapon();
    this.camera.add(this.weapon);
    this.particles = new Particles(this.scene);
    this.tracers = [];

    // ---- systems ----------------------------------------------------
    this.sensors = new SensorSource(window);
    this.audio = new GameAudio();
    this.audio.enabled = this.settings.sound !== false;
    this.input = new Input(this.sensors, this.settings, { surface: $('surface'), fireButton: $('fire'), stick: $('stick') });

    this.level = null;
    this.state = null;
    this.lastSave = null;
    this.player = { x: 0, z: 0, yaw: 0, pitch: 0, bob: 0 };
    this.enemies = [];
    this.projectiles = [];
    this.pickups = [];
    this.checkpoints = [];
    this.gates = [];
    this.flow = null;
    this.flowTimer = 0;
    this.fireCooldown = 0;
    this.emptyClick = false;
    this.recoil = 0;
    this.flashTimer = 0;
    this.hurtFlash = 0;
    this.hitMark = 0;
    this.toastTimer = 0;
    this.zoneId = 0;
    this.spawnedZones = new Set();
    this.activeMission = null;
    this.pendingMission = null;
    this.beaconOnline = false;
    this.lastTime = performance.now();
    this.runTime = 0;
    this.stats = { shots: 0, hits: 0 };

    this._bindUI();
    this._resize();
    window.addEventListener('resize', () => this._resize());
    if (window.screen && screen.orientation) screen.orientation.addEventListener('change', () => this._resize());
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.phase === 'playing') this.pause(); });
    this.sensors.start();
    this._updateSensorStatus();
    if (!window.AndroidBridge && ('ontouchstart' in window)) $('rotate').classList.add('enforce');
    this._refreshTitle();
    requestAnimationFrame((t) => this._frame(t));
  }

  // ---- UI wiring ----------------------------------------------------------
  _bindUI() {
    const click = (id, fn) => $(id).addEventListener('click', (e) => { e.preventDefault(); this.audio.init(); this.audio.play('click'); fn(); });
    click('btn-new', () => this._startGesture(() => this.newGame()));
    click('btn-continue', () => this._startGesture(() => this.continueGame()));
    click('btn-howto', () => this._show('screen-howto'));
    click('btn-howto-back', () => this._show(this.phase === 'title' ? 'screen-title' : 'screen-pause'));
    click('btn-settings', () => this.openSettings('screen-title'));
    click('btn-pause-settings', () => this.openSettings('screen-pause'));
    click('btn-settings-back', () => { this._applySettingsForm(); this._show(this.settingsReturn); });
    click('btn-resume', () => this.resume());
    click('btn-pause-recenter', () => { this.input.recenter(); this.resume(); });
    click('btn-quit', () => this.quitToTitle());
    click('btn-dead-quit', () => this.quitToTitle());
    click('btn-failed-quit', () => this.quitToTitle());
    click('btn-win-title', () => this.quitToTitle());
    click('btn-respawn', () => this.restoreCheckpoint());
    click('btn-retry', () => this.restoreCheckpoint());
    click('btn-again', () => this.newGame());
    click('btn-mission-go', () => this._launchMission());
    click('btn-pause', () => this.pause());
    click('btn-recenter', () => { this.input.recenter(); this.toast('Tilt recentred', 'info', 0.9); });
    $('btn-pause').addEventListener('pointerdown', (e) => e.stopPropagation());
    $('btn-recenter').addEventListener('pointerdown', (e) => e.stopPropagation());
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' || e.code === 'KeyP') { if (this.phase === 'playing') this.pause(); else if (this.phase === 'paused') this.resume(); }
      if (e.code === 'KeyR' && this.phase === 'playing') this.input.recenter();
    });
    // Desktop: click the view to lock the mouse for look control.
    $('surface').addEventListener('click', () => {
      if (this.phase === 'playing' && !('ontouchstart' in window) && !document.pointerLockElement && this.canvas.requestPointerLock) {
        this.canvas.requestPointerLock();
      }
    });
    for (const id of ['set-turn', 'set-tilt', 'set-look']) {
      $(id).addEventListener('input', () => { $(id + '-val').textContent = $(id).value; });
    }
    $('set-scheme').addEventListener('change', () => this._applySettingsForm());
  }

  /* Start buttons: request sensor permission (iOS) and go fullscreen +
   * landscape where the browser allows it. */
  _startGesture(fn) {
    this.audio.init();
    const finish = () => fn();
    if (!window.AndroidBridge && 'ontouchstart' in window) {
      const el = document.documentElement;
      try { if (el.requestFullscreen) el.requestFullscreen().catch(() => {}); } catch (e) { /* ignore */ }
      try { if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {}); } catch (e) { /* ignore */ }
    }
    this.sensors.requestPermission().then(finish, finish);
  }

  _show(id) {
    for (const s of document.querySelectorAll('.screen')) s.classList.toggle('visible', s.id === id);
    $('hud').classList.toggle('visible', id === null && this.level != null);
    if (id !== null && document.exitPointerLock && document.pointerLockElement) document.exitPointerLock();
  }

  _refreshTitle() {
    const save = storage.get(storage.KEYS.save);
    const ok = !!(save && save.v === SAVE_VERSION);
    $('btn-continue').disabled = !ok;
    $('btn-continue').textContent = ok ? `Continue (checkpoint ${save.checkpoint})` : 'Continue';
    const best = storage.get(storage.KEYS.best);
    $('best').textContent = best ? `Best run: ${best.score} points, ${best.kills} kills, ${Math.round(best.time)} s` : '';
  }

  _updateSensorStatus() {
    const el = $('sensor-status');
    const s = this.sensors;
    const set = (text, cls) => { el.textContent = text; el.className = cls; };
    if (s.mode === 'android') {
      if (s.yawOk) set('Motion sensors ready.', 'ok');
      else set('No gyroscope found: turning uses touch. Tilt still works.', 'warn');
      return;
    }
    if (s.mode === 'browser') {
      // Give the browser a moment to deliver the first event.
      set('Checking motion sensors...', '');
      setTimeout(() => {
        if (s.available) set('Motion sensors active.', 'ok');
        else set('No motion sensors yet. On iPhone tap New game to allow motion access; on a desktop use the keyboard.', 'warn');
      }, 1500);
      return;
    }
    set('No motion sensors on this device: use the Touch sticks scheme in Settings.', 'warn');
  }

  openSettings(returnTo) {
    this.settingsReturn = returnTo;
    const s = this.settings;
    $('set-scheme').value = s.scheme;
    $('set-turn').value = s.turnSens; $('set-turn-val').textContent = s.turnSens;
    $('set-tilt').value = s.tiltRange; $('set-tilt-val').textContent = s.tiltRange;
    $('set-look').value = s.lookSens; $('set-look-val').textContent = s.lookSens;
    $('set-invpitch').checked = !!s.invertPitch;
    $('set-invstrafe').checked = !!s.invertStrafe;
    $('set-sound').checked = s.sound !== false;
    $('set-vibrate').checked = s.vibrate !== false;
    this._show('screen-settings');
  }

  _applySettingsForm() {
    const s = this.settings;
    s.scheme = $('set-scheme').value;
    s.turnSens = parseFloat($('set-turn').value);
    s.tiltRange = parseFloat($('set-tilt').value);
    s.lookSens = parseFloat($('set-look').value);
    s.invertPitch = $('set-invpitch').checked;
    s.invertStrafe = $('set-invstrafe').checked;
    s.sound = $('set-sound').checked;
    s.vibrate = $('set-vibrate').checked;
    this.audio.enabled = s.sound;
    this.input.setSettings(s);
    storage.set(storage.KEYS.settings, s);
    this._updateHint();
  }

  setScheme(scheme) { this.settings.scheme = scheme; this.input.setSettings(this.settings); this._updateHint(); }

  _updateHint() {
    const s = this.settings.scheme;
    $('hint').textContent = s === 'tilt' ? 'Turn the phone to aim - tilt forward to walk - tilt sideways to strafe'
      : s === 'gyro' ? 'Turn / tilt the phone to aim - hold the left side to walk - tilt sideways to strafe'
      : 'Left: move stick - right: drag to look';
    $('btn-recenter').style.display = s === 'touch' ? 'none' : '';
  }

  _resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.fov = w >= h ? 75 : 95;
    this.camera.updateProjectionMatrix();
  }

  // ---- level / run lifecycle ----------------------------------------------
  _freshState() {
    return {
      checkpoint: 0, health: PLAYER.maxHealth, ammo: 60, score: 0, kills: 0,
      clearedZones: new Set(), collected: new Set(), missionsDone: new Set(), gatesOpen: new Set(), time: 0, yaw: null,
    };
  }

  _serialize() {
    const s = this.state;
    return {
      v: SAVE_VERSION, checkpoint: s.checkpoint, health: s.health, ammo: s.ammo, score: s.score, kills: s.kills,
      clearedZones: [...s.clearedZones], collected: [...s.collected], missionsDone: [...s.missionsDone], gatesOpen: [...s.gatesOpen],
      time: this.runTime, yaw: this.player.yaw, savedAt: Date.now(),
    };
  }

  _deserialize(d) {
    const s = this._freshState();
    s.checkpoint = d.checkpoint || 0; s.health = d.health; s.ammo = d.ammo; s.score = d.score || 0; s.kills = d.kills || 0;
    s.clearedZones = new Set(d.clearedZones || []); s.collected = new Set(d.collected || []);
    s.missionsDone = new Set(d.missionsDone || []); s.gatesOpen = new Set(d.gatesOpen || []);
    s.time = d.time || 0; s.yaw = typeof d.yaw === 'number' ? d.yaw : null;
    return s;
  }

  newGame() {
    storage.remove(storage.KEYS.save);
    this.stats = { shots: 0, hits: 0 };
    const fresh = this._freshState();
    this.lastSave = { v: SAVE_VERSION, checkpoint: 0, health: fresh.health, ammo: fresh.ammo, score: 0, kills: 0, clearedZones: [], collected: [], missionsDone: [], gatesOpen: [], time: 0, yaw: null };
    this._startFrom(this.lastSave);
    this.toast('Reach the extraction pad', 'info', 2.5, 'Follow the arrow at the top of the screen');
  }

  continueGame() {
    const save = storage.get(storage.KEYS.save);
    if (!save || save.v !== SAVE_VERSION) { this.newGame(); return; }
    this.lastSave = save;
    this._startFrom(save);
    this.toast(`Resumed at checkpoint ${save.checkpoint}`, 'info', 2);
  }

  restoreCheckpoint() {
    this._startFrom(this.lastSave);
    this.toast(this.lastSave.checkpoint ? `Back at checkpoint ${this.lastSave.checkpoint}` : 'Back at the start', 'info', 2);
  }

  _startFrom(save) {
    this.state = this._deserialize(save);
    this.runTime = this.state.time;
    this._buildLevel();
    // Place the player at the checkpoint (or the start).
    const cp = this.level.checkpoints.find((c) => c.id === this.state.checkpoint);
    const cell = cp || this.level.start;
    const w = cellToWorld(cell.x, cell.y);
    this.player.x = w.x; this.player.z = w.z;
    this.player.yaw = this.state.yaw != null ? this.state.yaw : this.level.start.yaw;
    this.player.pitch = 0;
    for (const c of this.checkpoints) { c.active = c.def.id <= this.state.checkpoint; c.mesh.setActive(c.active); }
    this.zoneId = 0;
    this.activeMission = null;
    this.pendingMission = null;
    this.beaconOnline = this.state.missionsDone.has('holdout');
    if (this.beaconOnline) this.beacon.setColor(0x5cff8a);
    this.input.recenter();
    this.input.clearHeld();
    this.input.enabled = true;
    this.phase = 'playing';
    this._show(null);
    this._updateHint();
    this._updateMissionPanel();
    this._enterZoneCheck(true);
  }

  _buildLevel() {
    // Dispose the previous level.
    while (this.levelGroup.children.length) {
      const c = this.levelGroup.children.pop();
      c.traverse((o) => { if (o.geometry && o.userData.ownGeo) o.geometry.dispose(); });
    }
    for (const e of this.enemies) this.scene.remove(e.mesh);
    for (const p of this.projectiles) this.scene.remove(p.mesh);
    for (const t of this.tracers) this.scene.remove(t.line);
    this.enemies = []; this.projectiles = []; this.pickups = []; this.checkpoints = []; this.gates = []; this.tracers = [];
    this.spawnedZones = new Set();

    const level = buildLevel();
    this.level = level;
    for (const g of level.gates) if (this.state.gatesOpen.has(g.id)) for (const [x, y] of g.cells) level.solid[y * level.w + x] = 0;

    // Walls: one instanced box per wall cell that touches open floor.
    if (!this.wallMat) {
      this.wallMat = new THREE.MeshLambertMaterial({ map: makeWallTexture() });
      this.floorMat = new THREE.MeshLambertMaterial({ map: makeFloorTexture(level.w, level.h) });
      this.boxGeo = new THREE.BoxGeometry(CELL, WALL_H, CELL);
    }
    const cells = [];
    for (let y = 0; y < level.h; y++) for (let x = 0; x < level.w; x++) {
      if (!isSolid(level, x, y)) continue;
      const isGate = level.gates.some((g) => g.cells.some(([gx, gy]) => gx === x && gy === y));
      if (isGate) continue;
      let exposed = false;
      for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (!isSolid(level, x + ox, y + oy)) { exposed = true; break; }
      if (exposed) cells.push([x, y]);
    }
    const walls = new THREE.InstancedMesh(this.boxGeo, this.wallMat, cells.length);
    const m = new THREE.Matrix4();
    cells.forEach(([x, y], i) => { const w = cellToWorld(x, y); m.makeTranslation(w.x, WALL_H / 2, w.z); walls.setMatrixAt(i, m); });
    walls.instanceMatrix.needsUpdate = true;
    this.levelGroup.add(walls);

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(level.w * CELL, level.h * CELL), this.floorMat);
    floor.userData.ownGeo = true;
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(level.w * CELL / 2, 0, level.h * CELL / 2);
    this.levelGroup.add(floor);

    // Gates.
    for (const g of level.gates) {
      const mesh = makeGateMesh(g.cells);
      const open = this.state.gatesOpen.has(g.id);
      if (open) mesh.visible = false;
      this.levelGroup.add(mesh);
      this.gates.push({ def: g, mesh, open, t: open ? 1 : 0 });
    }
    // Checkpoints.
    for (const c of level.checkpoints) {
      const mesh = makeCheckpointMesh();
      const w = cellToWorld(c.x, c.y);
      mesh.position.set(w.x, 0, w.z);
      this.levelGroup.add(mesh);
      this.checkpoints.push({ def: c, mesh, active: false, x: w.x, z: w.z });
    }
    // Pickups.
    for (const p of level.pickups) {
      if (this.state.collected.has(p.id)) continue;
      const mesh = makePickupMesh(p.kind);
      const w = cellToWorld(p.x, p.y);
      mesh.position.set(w.x, 0.8, w.z);
      this.levelGroup.add(mesh);
      this.pickups.push({ def: p, mesh, x: w.x, z: w.z, phase: Math.random() * 6 });
    }
    // Relay + extraction beacons.
    const rw = cellToWorld(level.relay.x, level.relay.y);
    this.relayMesh = makeBeaconMesh(0xffc14f);
    this.relayMesh.position.set(rw.x, 0, rw.z);
    this.levelGroup.add(this.relayMesh);
    const ew = cellToWorld(level.extraction.x, level.extraction.y);
    this.beacon = makeBeaconMesh(0xff5c5c);
    this.beacon.position.set(ew.x, 0, ew.z);
    this.levelGroup.add(this.beacon);

    this.flow = computeFlowField(level, level.start.x, level.start.y);
  }

  _spawnZone(zone) {
    if (this.spawnedZones.has(zone.id)) return;
    this.spawnedZones.add(zone.id);
    if (this.state.clearedZones.has(zone.id)) return;
    for (const e of this.level.enemies) {
      if (e.zone !== zone.id) continue;
      this._spawnEnemy(e.type, e.x, e.y, zone.id);
    }
  }

  _spawnEnemy(type, cx, cy, zone) {
    const w = cellToWorld(cx, cy);
    const en = new Enemy(type, w.x, w.z, zone);
    this.scene.add(en.mesh);
    this.enemies.push(en);
    return en;
  }

  // ---- screens ------------------------------------------------------------
  pause() {
    if (this.phase !== 'playing') return;
    this.phase = 'paused';
    this.input.enabled = false;
    this.input.clearHeld();
    $('pause-stats').textContent = `Score ${this.state.score} - ${this.state.kills} kills - checkpoint ${this.state.checkpoint}`;
    this._show('screen-pause');
  }

  resume() {
    if (this.phase !== 'paused') return;
    this.phase = 'playing';
    this.input.clearHeld();
    this.input.enabled = true;
    this.lastTime = performance.now();
    this._show(null);
  }

  quitToTitle() {
    this.phase = 'title';
    this.input.enabled = false;
    this.input.clearHeld();
    this._refreshTitle();
    this._show('screen-title');
  }

  die() {
    if (this.phase !== 'playing') return;
    this.phase = 'dead';
    this.input.enabled = false;
    this.audio.play('death');
    this._vibrate(300);
    $('dead-stats').textContent = `Score ${this.state.score} - ${this.state.kills} kills`;
    setTimeout(() => { if (this.phase === 'dead') this._show('screen-dead'); }, 900);
  }

  win() {
    this.phase = 'win';
    this.input.enabled = false;
    this.audio.play('win');
    this.state.score += 2000;
    const best = storage.get(storage.KEYS.best);
    if (!best || best.score < this.state.score) storage.set(storage.KEYS.best, { score: this.state.score, kills: this.state.kills, time: this.runTime });
    storage.remove(storage.KEYS.save);
    $('win-stats').textContent = `Score ${this.state.score} - ${this.state.kills} kills - ${Math.round(this.runTime)} s - accuracy ${this.stats.shots ? Math.round(100 * this.stats.hits / this.stats.shots) : 0}%`;
    setTimeout(() => this._show('screen-win'), 800);
  }

  toast(text, kind = 'info', seconds = 2, sub = '') {
    const el = $('toast');
    el.innerHTML = '';
    el.appendChild(document.createTextNode(text));
    if (sub) { const s = document.createElement('span'); s.className = 'sub'; s.textContent = sub; el.appendChild(s); }
    el.className = `show ${kind}`;
    this.toastTimer = seconds;
  }

  _vibrate(ms) {
    if (this.settings.vibrate === false) return;
    try {
      if (window.AndroidBridge && AndroidBridge.vibrate) AndroidBridge.vibrate(ms);
      else if (navigator.vibrate) navigator.vibrate(ms);
    } catch (e) { /* ignore */ }
  }

  // ---- missions -----------------------------------------------------------
  _enterZoneCheck(silent) {
    const c = worldToCell(this.player.x, this.player.z);
    const zone = this.level.zones.find((z) => inRect(z.rect, c.cx, c.cy));
    if (zone && zone.id !== this.zoneId) {
      this.zoneId = zone.id;
      $('zone').textContent = zone.name;
      if (!silent) this.toast(zone.name, 'info', 1.5);
      this._spawnZone(zone);
    }
    if (!this.activeMission && !this.pendingMission) {
      for (const m of this.level.missions) {
        if (this.state.missionsDone.has(m.id)) continue;
        if (inRect(m.trigger, c.cx, c.cy)) { this._offerMission(m); break; }
      }
    }
  }

  _offerMission(m) {
    this.pendingMission = m;
    this.phase = 'mission';
    this.input.enabled = false;
    this.input.clearHeld();
    this.audio.play('missionStart');
    $('mission-title').textContent = `Mission: ${m.title}`;
    $('mission-brief').textContent = m.brief;
    this._show('screen-mission');
  }

  _launchMission() {
    const m = this.pendingMission;
    if (!m) return;
    this.pendingMission = null;
    this.activeMission = { def: m, time: 0, timeLeft: m.timeLimit || 0, progress: 0, waveTimer: 0, killsAtStart: this.state.kills };
    this.phase = 'playing';
    this.input.clearHeld();
    this.input.enabled = true;
    this.lastTime = performance.now();
    this._show(null);
    this._updateMissionPanel();
    this.toast(m.title.toUpperCase(), 'info', 2);
  }

  _missionProgress() {
    const am = this.activeMission;
    if (!am) return { text: '', done: false };
    const m = am.def;
    if (m.type === 'eliminate') {
      const alive = this.enemies.filter((e) => e.zone === m.zone && e.alive).length;
      const total = this.level.enemies.filter((e) => e.zone === m.zone).length;
      return { text: `Hostiles remaining: ${alive}`, done: this.spawnedZones.has(m.zone) && alive === 0, value: total - alive, total };
    }
    if (m.type === 'collect') {
      const have = this.level.pickups.filter((p) => p.kind === m.item && this.state.collected.has(p.id)).length;
      return { text: `Data cores: ${have} / ${m.count}`, done: have >= m.count };
    }
    if (m.type === 'reach') {
      const c = worldToCell(this.player.x, this.player.z);
      const d = Math.hypot(c.cx - m.target.x, c.cy - m.target.y);
      return { text: 'Reach the relay', done: d < 1.5 };
    }
    if (m.type === 'survive') {
      const left = Math.max(0, m.duration - am.time);
      return { text: `Hold out: ${Math.ceil(left)} s`, done: am.time >= m.duration };
    }
    return { text: '', done: false };
  }

  _updateMission(dt) {
    const am = this.activeMission;
    if (!am) return;
    const m = am.def;
    am.time += dt;
    if (m.timeLimit) {
      am.timeLeft = m.timeLimit - am.time;
      if (am.timeLeft <= 5 && Math.floor(am.timeLeft) !== Math.floor(am.timeLeft + dt)) this.audio.play('tick');
      if (am.timeLeft <= 0) { this._failMission('Time ran out.'); return; }
    }
    if (m.type === 'survive') {
      am.waveTimer -= dt;
      if (am.waveTimer <= 0) {
        am.waveTimer = m.waveEvery;
        const pts = m.spawnPoints.slice().sort(() => Math.random() - 0.5).slice(0, 2 + Math.floor(am.time / 15));
        for (const [x, y] of pts) this._spawnEnemy(Math.random() < 0.6 ? 'crawler' : 'drone', x, y, 8);
        this.toast('Incoming!', 'bad', 1);
      }
    }
    const p = this._missionProgress();
    if (p.done) this._completeMission();
    this._updateMissionPanel();
  }

  _completeMission() {
    const m = this.activeMission.def;
    this.activeMission = null;
    this.state.missionsDone.add(m.id);
    this.state.score += m.reward;
    this.audio.play('missionDone');
    this._vibrate(120);
    let sub = `+${m.reward} points`;
    const gate = this.level.gates.find((g) => g.mission === m.id);
    if (gate) { this._openGate(gate.id); sub += ' - gate opened'; }
    if (m.id === 'holdout') { this.beaconOnline = true; this.beacon.setColor(0x5cff8a); sub = 'Extraction beacon online: get to the pad!'; }
    this.toast('MISSION COMPLETE', 'good', 3, sub);
    this._updateMissionPanel();
  }

  _failMission(reason) {
    const m = this.activeMission.def;
    this.activeMission = null;
    this.phase = 'failed';
    this.input.enabled = false;
    this.audio.play('missionFail');
    $('failed-reason').textContent = `${m.title}: ${reason} You are sent back to your last checkpoint.`;
    this._show('screen-failed');
  }

  _openGate(id) {
    const g = this.gates.find((x) => x.def.id === id);
    if (!g || g.open) return;
    g.open = true;
    g.t = 0;
    this.state.gatesOpen.add(id);
    this.audio.play('gate');
  }

  _updateMissionPanel() {
    const el = $('mission');
    const am = this.activeMission;
    if (!am) { el.classList.remove('visible'); return; }
    el.classList.add('visible');
    const p = this._missionProgress();
    el.querySelector('.title').textContent = am.def.title;
    let txt = p.text;
    if (am.def.timeLimit) txt += ` - ${Math.max(0, Math.ceil(am.timeLeft))} s`;
    const prog = el.querySelector('.progress');
    prog.textContent = txt;
    prog.classList.toggle('urgent', !!am.def.timeLimit && am.timeLeft < 10);
  }

  // ---- combat -------------------------------------------------------------
  _shoot() {
    const s = this.state, p = this.player;
    s.ammo--;
    this.stats.shots++;
    this.fireCooldown = PLAYER.fireInterval;
    this.recoil = 1;
    this.flashTimer = 0.05;
    this.weapon.flash.visible = true;
    this.audio.play('shoot');
    const cp = Math.cos(p.pitch), sp = Math.sin(p.pitch);
    const fx = -Math.sin(p.yaw) * cp, fz = -Math.cos(p.yaw) * cp;
    const hx = -Math.sin(p.yaw), hz = -Math.cos(p.yaw); // horizontal unit
    const wallD = rayWallDistance(this.level, p.x, p.z, hx, hz, 60);
    let best = null, bestT = wallD;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const tx = e.x - p.x, tz = e.z - p.z;
      const t = tx * hx + tz * hz;
      if (t < 0.2 || t > bestT) continue;
      const perp = Math.abs(hx * tz - hz * tx);
      if (perp > e.radius + 0.25) continue;
      // The tilt scheme has no vertical look, so it aims up/down for you;
      // the other schemes must be pointed roughly at the target's height.
      if (this.settings.scheme !== 'tilt') {
        const aimY = PLAYER.eye + (sp / Math.max(0.05, cp)) * t;
        if (Math.abs(aimY - e.centerY) > e.height / 2 + 0.8) continue;
      }
      best = e; bestT = t;
    }
    let endX, endY, endZ;
    if (best) {
      this.stats.hits++;
      endX = best.x; endY = best.centerY; endZ = best.z;
      const killed = best.hit(PLAYER.dmg);
      this.particles.burst(best.x, best.centerY, best.z, killed ? 0xffa040 : 0xffffff, killed ? 30 : 8, killed ? 6 : 3);
      this.hitMark = 0.12;
      if (killed) {
        s.kills++;
        s.score += best.def.score;
        this.audio.play('kill');
        this._vibrate(40);
      } else {
        this.audio.play('hit');
      }
    } else {
      endX = p.x + hx * wallD; endZ = p.z + hz * wallD;
      endY = clamp(PLAYER.eye + (sp / Math.max(0.05, cp)) * wallD, 0.05, WALL_H);
      this.particles.burst(endX - hx * 0.1, endY, endZ - hz * 0.1, 0xffe0a0, 5, 2);
    }
    // Tracer line from the muzzle.
    const muzzle = new THREE.Vector3();
    this.weapon.flash.getWorldPosition(muzzle);
    const geo = new THREE.BufferGeometry().setFromPoints([muzzle, new THREE.Vector3(endX, endY, endZ)]);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x9ff4ff, transparent: true, opacity: 0.8 }));
    this.scene.add(line);
    this.tracers.push({ line, life: 0.06 });
  }

  _checkZoneCleared(zoneId) {
    if (!zoneId || this.state.clearedZones.has(zoneId)) return;
    if (this.enemies.some((e) => e.zone === zoneId && e.alive)) return;
    this.state.clearedZones.add(zoneId);
    const zone = this.level.zones.find((z) => z.id === zoneId);
    if (zone && !(this.activeMission && this.activeMission.def.zone === zoneId)) this.toast(`${zone.name} clear`, 'good', 1.5);
  }

  hurt(dmg) {
    if (this.phase !== 'playing' || this.godMode) return;
    this.state.health -= dmg;
    this.hurtFlash = 1;
    this.audio.play('hurt');
    this._vibrate(60);
    if (this.state.health <= 0) { this.state.health = 0; this.die(); }
  }

  // ---- main loop ----------------------------------------------------------
  _frame(t) {
    requestAnimationFrame((tt) => this._frame(tt));
    const dt = Math.min(0.05, Math.max(0, (t - this.lastTime) / 1000));
    this.lastTime = t;
    this.sensors.poll();
    if (this.phase === 'playing') this._update(dt);
    else this.input.update(dt);
    this._animate(dt);
    if (this.level) {
      this.camera.position.set(this.player.x, PLAYER.eye + Math.sin(this.player.bob) * 0.04, this.player.z);
      this.camera.rotation.y = this.player.yaw;
      this.camera.rotation.x = this.player.pitch;
      this.renderer.render(this.scene, this.camera);
      this._updateHud(dt);
    }
  }

  _update(dt) {
    const p = this.player, s = this.state, ctl = this.input.update(dt);
    this.runTime += dt;

    // Look.
    p.yaw += ctl.yawDelta;
    if (ctl.pitchAbs != null) p.pitch = ctl.pitchAbs;
    else p.pitch = clamp(p.pitch + ctl.pitchDelta, -1.3, 1.3);

    // Move.
    const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
    const rx = Math.cos(p.yaw), rz = -Math.sin(p.yaw);
    let mx = fx * ctl.moveZ + rx * ctl.moveX, mz = fz * ctl.moveZ + rz * ctl.moveX;
    const ml = Math.hypot(mx, mz);
    if (ml > 1) { mx /= ml; mz /= ml; }
    if (ml > 0.01) {
      const r = moveWithCollision(this.level, p.x, p.z, mx * PLAYER.speed * dt, mz * PLAYER.speed * dt, PLAYER.radius);
      p.x = r.x; p.z = r.z;
      p.bob += dt * 9 * Math.min(1, ml);
    }

    // Fire.
    this.fireCooldown -= dt;
    if (ctl.fire) {
      if (s.ammo > 0) { if (this.fireCooldown <= 0) this._shoot(); }
      else if (!this.emptyClick) { this.emptyClick = true; this.audio.play('empty'); this.toast('Out of ammo - find yellow pickups', 'bad', 1.5); }
    } else this.emptyClick = false;

    // Flow field for the enemies (throttled).
    this.flowTimer -= dt;
    if (this.flowTimer <= 0) {
      this.flowTimer = 0.25;
      const c = worldToCell(p.x, p.z);
      computeFlowField(this.level, c.cx, c.cy, this.flow);
    }

    // Enemies.
    const ctx = {
      player: p, level: this.level, flow: this.flow, enemies: this.enemies,
      lineOfSight: (x0, z0, x1, z1) => lineOfSight(this.level, x0, z0, x1, z1),
      fireProjectile: (x, y, z, dx, dy, dz, speed, dmg, color) => {
        const pr = new Projectile(x, y, z, dx, dy, dz, speed, dmg, color);
        this.scene.add(pr.mesh);
        this.projectiles.push(pr);
        this.audio.play('enemyShot');
      },
      meleePlayer: (dmg) => this.hurt(dmg),
    };
    for (const e of this.enemies) e.update(dt, ctx);
    for (const e of this.enemies) if (!e.alive && !e.counted) { e.counted = true; this._checkZoneCleared(e.zone); }
    this.enemies = this.enemies.filter((e) => { if (e.removed) { this.scene.remove(e.mesh); return false; } return true; });

    // Projectiles.
    for (const pr of this.projectiles) {
      pr.update(dt);
      if (pr.dead) continue;
      const c = worldToCell(pr.x, pr.z);
      if (isSolid(this.level, c.cx, c.cy)) { pr.dead = true; this.particles.burst(pr.x, pr.y, pr.z, 0xff8060, 5, 2); continue; }
      const dx = pr.x - p.x, dz = pr.z - p.z;
      if (dx * dx + dz * dz < 0.55 * 0.55 && pr.y > 0 && pr.y < 2.1) { pr.dead = true; this.hurt(pr.dmg); }
    }
    this.projectiles = this.projectiles.filter((pr) => { if (pr.dead) { this.scene.remove(pr.mesh); return false; } return true; });
    if (this.phase !== 'playing') return; // died this frame

    // Pickups.
    for (const pk of this.pickups) {
      if (pk.taken) continue;
      const dx = pk.x - p.x, dz = pk.z - p.z;
      if (dx * dx + dz * dz > 1.1 * 1.1) continue;
      const kind = pk.def.kind;
      if (kind === 'ammo') { if (s.ammo >= PLAYER.maxAmmo) continue; s.ammo = Math.min(PLAYER.maxAmmo, s.ammo + 25); this.toast('+25 ammo', 'good', 0.8); }
      else if (kind === 'health') { if (s.health >= PLAYER.maxHealth) continue; s.health = Math.min(PLAYER.maxHealth, s.health + 40); this.toast('+40 health', 'good', 0.8); }
      else { s.score += 150; this.toast('Data core recovered', 'good', 1.2); }
      pk.taken = true;
      s.collected.add(pk.def.id);
      this.levelGroup.remove(pk.mesh);
      this.audio.play(kind === 'core' ? 'core' : 'pickup');
      this.particles.burst(pk.x, 0.8, pk.z, kind === 'ammo' ? 0xffc14f : kind === 'health' ? 0x5cff8a : 0x4fe3ff, 10, 3);
    }
    this.pickups = this.pickups.filter((pk) => !pk.taken);

    // Checkpoints.
    for (const c of this.checkpoints) {
      if (c.active) continue;
      const dx = c.x - p.x, dz = c.z - p.z;
      if (dx * dx + dz * dz > 1.5 * 1.5) continue;
      c.active = true;
      c.mesh.setActive(true);
      s.checkpoint = Math.max(s.checkpoint, c.def.id);
      s.score += 100;
      this.lastSave = this._serialize();
      const ok = storage.set(storage.KEYS.save, this.lastSave);
      this.audio.play('checkpoint');
      this._vibrate(50);
      this.toast(`CHECKPOINT ${c.def.id}`, 'good', 2, ok ? 'Progress saved' : 'Could not save progress on this device');
    }

    // Zones and mission triggers.
    this._enterZoneCheck(false);
    if (this.phase !== 'playing') return;
    this._updateMission(dt);
    if (this.phase !== 'playing') return;

    // Extraction.
    if (this.beaconOnline) {
      const ew = cellToWorld(this.level.extraction.x, this.level.extraction.y);
      if (Math.hypot(ew.x - p.x, ew.z - p.z) < 1.8) this.win();
    }
  }

  _animate(dt) {
    // Weapon recoil, muzzle flash, tracers, pickups, gates, checkpoint pulse.
    this.recoil = Math.max(0, this.recoil - dt * 9);
    this.weapon.position.z = -0.55 + this.recoil * 0.08;
    this.weapon.position.y = -0.27 + Math.sin(this.player.bob * 0.5) * 0.008 + this.recoil * 0.02;
    this.flashTimer -= dt;
    if (this.flashTimer <= 0) this.weapon.flash.visible = false;
    for (const t of this.tracers) { t.life -= dt; if (t.life <= 0) { this.scene.remove(t.line); t.line.geometry.dispose(); } }
    this.tracers = this.tracers.filter((t) => t.life > 0);
    this.particles.update(dt);
    const now = performance.now() / 1000;
    for (const pk of this.pickups) { pk.mesh.rotation.y = now * 1.5 + pk.phase; pk.mesh.position.y = 0.8 + Math.sin(now * 2 + pk.phase) * 0.12; }
    for (const c of this.checkpoints) { c.mesh.children[1].scale.x = c.mesh.children[1].scale.z = 1 + Math.sin(now * 2) * 0.06; }
    for (const g of this.gates) {
      if (!g.open || g.t >= 1) continue;
      g.t = Math.min(1, g.t + dt / 1.5);
      g.mesh.position.y = -WALL_H * g.t;
      if (g.t >= 0.5) for (const [x, y] of g.def.cells) this.level.solid[y * this.level.w + x] = 0;
      if (g.t >= 1) g.mesh.visible = false;
    }
    if (this.relayMesh) this.relayMesh.rotation.y = now;
    if (this.beacon) this.beacon.rotation.y = -now;
  }

  _objective() {
    const am = this.activeMission, s = this.state;
    if (am) {
      const m = am.def;
      if (m.type === 'reach') return cellToWorld(m.target.x, m.target.y);
      if (m.type === 'collect') {
        let best = null, bd = Infinity;
        for (const pk of this.pickups) if (pk.def.kind === m.item) { const d = Math.hypot(pk.x - this.player.x, pk.z - this.player.z); if (d < bd) { bd = d; best = pk; } }
        return best;
      }
      if (m.type === 'eliminate') {
        let best = null, bd = Infinity;
        for (const e of this.enemies) if (e.alive && e.zone === m.zone) { const d = Math.hypot(e.x - this.player.x, e.z - this.player.z); if (d < bd) { bd = d; best = e; } }
        return best;
      }
      return null;
    }
    if (this.beaconOnline) return cellToWorld(this.level.extraction.x, this.level.extraction.y);
    const next = this.checkpoints.find((c) => !c.active);
    if (next) return next;
    return cellToWorld(this.level.extraction.x, this.level.extraction.y);
  }

  _updateHud(dt) {
    const s = this.state;
    if (!s) return;
    const hb = $('health');
    hb.firstElementChild.style.width = `${clamp(s.health / PLAYER.maxHealth * 100, 0, 100)}%`;
    hb.classList.toggle('low', s.health <= 30);
    const ammo = $('ammo');
    ammo.textContent = s.ammo;
    ammo.classList.toggle('low', s.ammo <= 10);
    $('score').textContent = s.score;
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 2.5);
    $('vignette').style.opacity = Math.max(this.hurtFlash, s.health <= 25 ? 0.35 + Math.sin(performance.now() / 200) * 0.1 : 0);
    this.hitMark -= dt;
    $('crosshair').classList.toggle('hit', this.hitMark > 0);
    if (this.toastTimer > 0) { this.toastTimer -= dt; if (this.toastTimer <= 0) $('toast').classList.remove('show'); }
    const o = this._objective();
    const compass = $('compass');
    if (o) {
      const dx = o.x - this.player.x, dz = o.z - this.player.z;
      const fx = -Math.sin(this.player.yaw), fz = -Math.cos(this.player.yaw);
      const rx = Math.cos(this.player.yaw), rz = -Math.sin(this.player.yaw);
      const ang = Math.atan2(dx * rx + dz * rz, dx * fx + dz * fz) * 180 / Math.PI;
      compass.style.visibility = 'visible';
      compass.firstElementChild.style.transform = `rotate(${ang.toFixed(1)}deg)`;
    } else compass.style.visibility = 'hidden';
  }

  // ---- Android hooks ------------------------------------------------------
  onBackButton() {
    if (this.phase === 'playing') { this.pause(); return true; }
    if (this.phase === 'paused') { this.resume(); return true; }
    if (this.phase === 'title') return false;
    if (this.phase === 'mission') return true;
    return true;
  }

  onAppPause() { if (this.phase === 'playing') this.pause(); }
}

function makeWallTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#5c6b80'; g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 300; i++) { g.fillStyle = `rgba(0,0,0,${Math.random() * 0.12})`; g.fillRect(Math.random() * 128, Math.random() * 128, 3, 3); }
  g.strokeStyle = '#2b3542'; g.lineWidth = 3;
  g.strokeRect(4, 4, 120, 120);
  g.strokeRect(16, 16, 96, 96);
  g.fillStyle = '#75879e'; g.fillRect(20, 20, 88, 10);
  g.fillStyle = '#3ad0ff'; g.fillRect(24, 100, 40, 4);
  g.fillStyle = '#ff9a3a'; g.fillRect(70, 100, 12, 4);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  return t;
}

function makeFloorTexture(w, h) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#39424f'; g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 400; i++) { g.fillStyle = `rgba(255,255,255,${Math.random() * 0.05})`; g.fillRect(Math.random() * 128, Math.random() * 128, 2, 2); }
  g.strokeStyle = '#1c222c'; g.lineWidth = 4; g.strokeRect(0, 0, 128, 128);
  g.strokeStyle = '#343e4d'; g.lineWidth = 1; g.beginPath(); g.moveTo(64, 0); g.lineTo(64, 128); g.moveTo(0, 64); g.lineTo(128, 64); g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(w, h);
  return t;
}

window.GyroStrike = new Game();
