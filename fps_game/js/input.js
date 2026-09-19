/* Control schemes. Each frame `update(dt)` turns sensor readings, touches
 * and keys into one `state` object the game consumes:
 *
 *   moveX     -1..1  strafe (right positive)
 *   moveZ     -1..1  walk (forward positive)
 *   yawDelta  radians to add to the camera yaw this frame (+ = turn left)
 *   pitchDelta radians to add to the camera pitch this frame (touch/mouse)
 *   pitchAbs  absolute camera pitch in radians, or null when the scheme
 *             does not control pitch
 *   fire      true while a fire input is held
 *
 * Schemes:
 *   tilt   Turn by rotating the phone. Walk by tilting it forward/back,
 *          strafe by tilting it left/right. Tap anywhere to fire. No
 *          vertical look (enemies are engaged at eye level).
 *   gyro   Turn AND look up/down by rotating the phone. Hold the left half
 *          of the screen to walk (slide down to back up), tilt left/right
 *          to strafe, tap the right half to fire.
 *   touch  Classic twin-stick: left-half virtual stick moves, dragging on
 *          the right half looks, fire button shoots. No sensors needed. */

import { wrapAngle, DEG } from './sensors.js';

export const SCHEMES = {
  tilt: 'Tilt to move',
  gyro: 'Gyro look',
  touch: 'Touch sticks',
};

export const DEFAULT_SETTINGS = {
  scheme: 'tilt',
  turnSens: 1.5,      // camera yaw per phone yaw
  tiltRange: 20,      // degrees of tilt for full speed
  deadzone: 3.5,      // degrees
  invertPitch: false,
  invertStrafe: false,
  lookSens: 1.0,      // touch look
  sound: true,
  vibrate: true,
};

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

function axis(deg, deadzone, range) {
  const a = Math.abs(deg);
  if (a < deadzone) return 0;
  const v = Math.min(1, (a - deadzone) / Math.max(1, range - deadzone));
  return deg < 0 ? -v : v;
}

export class Input {
  constructor(sensors, settings, els) {
    this.sensors = sensors;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, settings || {});
    this.els = els || {};
    this.state = { moveX: 0, moveZ: 0, yawDelta: 0, pitchDelta: 0, pitchAbs: null, fire: false, sensorsLive: false };
    this.enabled = false;
    this.neutralPitch = 0;
    this.neutralRoll = 0;
    this.wantRecenter = true;
    this.prevHeading = null;
    this.smoothX = 0;
    this.smoothZ = 0;
    this.pointers = new Map();
    this.keys = new Set();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.mouseFire = false;
    this.lookDX = 0;
    this.lookDY = 0;
    this.lastSensorSample = -1;
    this._bind();
  }

  setSettings(s) { Object.assign(this.settings, s); }

  recenter() { this.wantRecenter = true; }

  /* Ignore every held input (used when a menu opens). */
  clearHeld() {
    this.pointers.clear();
    this.keys.clear();
    this.mouseFire = false;
    this.prevHeading = null;
  }

  _bind() {
    const surface = this.els.surface;
    if (surface) {
      const opts = { passive: false };
      surface.addEventListener('pointerdown', (e) => this._pointerDown(e), opts);
      surface.addEventListener('pointermove', (e) => this._pointerMove(e), opts);
      const up = (e) => this._pointerUp(e);
      surface.addEventListener('pointerup', up, opts);
      surface.addEventListener('pointercancel', up, opts);
      surface.addEventListener('lostpointercapture', up, opts);
      surface.addEventListener('contextmenu', (e) => e.preventDefault());
    }
    const fire = this.els.fireButton;
    if (fire) {
      fire.addEventListener('pointerdown', (e) => { e.preventDefault(); fire.setPointerCapture(e.pointerId); this.pointers.set(e.pointerId, { role: 'fire' }); fire.classList.add('held'); }, { passive: false });
      const rel = (e) => { this.pointers.delete(e.pointerId); fire.classList.remove('held'); };
      fire.addEventListener('pointerup', rel);
      fire.addEventListener('pointercancel', rel);
      fire.addEventListener('lostpointercapture', rel);
      fire.addEventListener('contextmenu', (e) => e.preventDefault());
    }
    const g = typeof window !== 'undefined' ? window : null;
    if (g) {
      g.addEventListener('keydown', (e) => { if (!e.repeat) this.keys.add(e.code); if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault(); });
      g.addEventListener('keyup', (e) => this.keys.delete(e.code));
      g.addEventListener('blur', () => this.clearHeld());
      g.addEventListener('mousemove', (e) => {
        if (document.pointerLockElement) { this.mouseDX += e.movementX; this.mouseDY += e.movementY; }
      });
      g.addEventListener('mousedown', (e) => { if (document.pointerLockElement && e.button === 0) this.mouseFire = true; });
      g.addEventListener('mouseup', (e) => { if (e.button === 0) this.mouseFire = false; });
    }
  }

  _role(e) {
    const surface = this.els.surface;
    const w = surface ? surface.clientWidth : (typeof window !== 'undefined' ? window.innerWidth : 1000);
    const left = e.clientX < w / 2;
    const scheme = this.settings.scheme;
    if (scheme === 'touch') return left ? 'stick' : 'look';
    if (scheme === 'gyro') return left ? 'walk' : 'fire';
    return 'fire';
  }

  _pointerDown(e) {
    if (!this.enabled) return;
    if (e.pointerType === 'mouse' && document.pointerLockElement) return;
    e.preventDefault();
    const role = this._role(e);
    this.pointers.set(e.pointerId, { role, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY });
    try { this.els.surface.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    this._updateStickUI();
  }

  _pointerMove(e) {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    e.preventDefault();
    if (p.role === 'look') {
      this.lookDX += e.clientX - p.x;
      this.lookDY += e.clientY - p.y;
    }
    p.x = e.clientX;
    p.y = e.clientY;
    this._updateStickUI();
  }

  _pointerUp(e) {
    if (this.pointers.delete(e.pointerId)) this._updateStickUI();
  }

  _updateStickUI() {
    const stick = this.els.stick;
    if (!stick) return;
    let p = null;
    for (const v of this.pointers.values()) if (v.role === 'stick' || v.role === 'walk') { p = v; break; }
    if (!p) { stick.classList.remove('active'); return; }
    stick.classList.add('active');
    stick.style.left = `${p.x0}px`;
    stick.style.top = `${p.y0}px`;
    const knob = stick.firstElementChild;
    if (knob) {
      const r = 60;
      let dx = p.x - p.x0, dy = p.y - p.y0;
      if (p.role === 'walk') dx = 0;
      const len = Math.hypot(dx, dy);
      if (len > r) { dx = dx / len * r; dy = dy / len * r; }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
    }
  }

  update(dt) {
    const s = this.state;
    const cfg = this.settings;
    const sensors = this.sensors;
    s.moveX = 0; s.moveZ = 0; s.yawDelta = 0; s.pitchDelta = 0; s.pitchAbs = null; s.fire = false;
    if (!this.enabled) { this.lookDX = this.lookDY = this.mouseDX = this.mouseDY = 0; return s; }

    // ---- sensors -------------------------------------------------------
    const useSensors = cfg.scheme !== 'touch' && sensors && sensors.available;
    s.sensorsLive = !!useSensors;
    let tx = 0, tz = 0; // target (unsmoothed) tilt axes
    if (useSensors) {
      if (this.wantRecenter) {
        this.neutralPitch = sensors.pitch;
        this.neutralRoll = sensors.roll;
        this.wantRecenter = false;
        this.prevHeading = sensors.heading;
      }
      if (sensors.yawOk) {
        if (this.prevHeading == null) this.prevHeading = sensors.heading;
        const d = wrapAngle(sensors.heading - this.prevHeading);
        this.prevHeading = sensors.heading;
        if (Math.abs(d) < 1.2) s.yawDelta -= d * cfg.turnSens; // phone turns right -> camera turns right
      }
      const pitchRel = wrapAngle(sensors.pitch - this.neutralPitch);
      const rollRel = wrapAngle(sensors.roll - this.neutralRoll);
      // Right edge down -> roll negative -> strafe right.
      tx = axis(-rollRel / DEG, cfg.deadzone, cfg.tiltRange) * (cfg.invertStrafe ? -1 : 1);
      if (cfg.scheme === 'tilt') {
        // Top edge away (phone looks further down) -> walk forward.
        tz = axis(-pitchRel / DEG, cfg.deadzone, cfg.tiltRange);
      } else if (cfg.scheme === 'gyro') {
        s.pitchAbs = clamp(pitchRel * (cfg.invertPitch ? -1 : 1), -80 * DEG, 80 * DEG);
      }
    }

    // ---- touches -------------------------------------------------------
    for (const p of this.pointers.values()) {
      if (p.role === 'fire') s.fire = true;
      else if (p.role === 'walk') {
        // Forward as soon as the finger lands; slide down to back up.
        tz = clamp(1 - Math.max(0, p.y - p.y0) / 60, -1, 1);
      } else if (p.role === 'stick') {
        const r = 60;
        tx = clamp((p.x - p.x0) / r, -1, 1);
        tz = clamp(-(p.y - p.y0) / r, -1, 1);
        const len = Math.hypot(tx, tz);
        if (len > 1) { tx /= len; tz /= len; }
      }
    }
    if (this.lookDX || this.lookDY) {
      const k = 0.0045 * cfg.lookSens;
      s.yawDelta -= this.lookDX * k;
      s.pitchDelta -= this.lookDY * k * (cfg.invertPitch ? -1 : 1);
      this.lookDX = this.lookDY = 0;
    }

    // ---- keyboard / mouse (desktop testing) -----------------------------
    const k = this.keys;
    if (k.has('KeyW') || k.has('ArrowUp')) tz = 1;
    if (k.has('KeyS') || k.has('ArrowDown')) tz = -1;
    if (k.has('KeyA')) tx = -1;
    if (k.has('KeyD')) tx = 1;
    if (k.has('ArrowLeft')) s.yawDelta += 2.2 * dt;
    if (k.has('ArrowRight')) s.yawDelta -= 2.2 * dt;
    if (k.has('KeyQ')) s.pitchDelta += 1.5 * dt;
    if (k.has('KeyE')) s.pitchDelta -= 1.5 * dt;
    if (k.has('Space') || this.mouseFire) s.fire = true;
    if (this.mouseDX || this.mouseDY) {
      s.yawDelta -= this.mouseDX * 0.0025;
      s.pitchDelta -= this.mouseDY * 0.0025 * (cfg.invertPitch ? -1 : 1);
      this.mouseDX = this.mouseDY = 0;
    }

    // Smooth the movement axes so sensor noise does not make the player
    // jitter, but keep them responsive.
    const a = 1 - Math.exp(-dt * 14);
    this.smoothX += (tx - this.smoothX) * a;
    this.smoothZ += (tz - this.smoothZ) * a;
    s.moveX = Math.abs(this.smoothX) < 0.02 ? 0 : this.smoothX;
    s.moveZ = Math.abs(this.smoothZ) < 0.02 ? 0 : this.smoothZ;
    return s;
  }
}
