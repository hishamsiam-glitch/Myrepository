// Unified input for Space Invaders 3D.
//
//   * Phone sensors (DeviceOrientation): tilt left/right steers, tilt
//     forward/back moves the ship in depth. iOS 13+ needs an explicit
//     permission request that must come from a user gesture, so
//     enableSensors() is called from a button on the title screen.
//   * Touch: tap / hold anywhere on the play area to fire; horizontal drag
//     steers when sensors are not available.
//   * Keyboard: arrows or A/D steer, W/S move in depth, Space fires,
//     P pauses, Enter confirms.

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Degrees of tilt for full deflection, indexed by sensitivity 1..5.
const RANGE_BY_SENSITIVITY = [40, 30, 22, 16, 11];
const DEADZONE_DEG = 1.5;
const DEPTH_DEADZONE_DEG = 5;

export class Input {
  constructor(settings) {
    this.settings = settings;
    this.tilt = 0;        // -1 (left) .. +1 (right), smoothed
    this.depth = 0;       // -1 (back) .. +1 (forward), smoothed
    this.fireHeld = false;
    this._firePressed = false;
    this._pausePressed = false;
    this._confirmPressed = false;
    this.keys = new Set();

    this.sensorsSupported = typeof window !== 'undefined' && 'DeviceOrientationEvent' in window;
    this.sensorsActive = false;   // at least one usable reading received
    this.sensorsEnabled = false;  // listener attached
    this.raw = { lr: 0, fb: 0 };
    this.neutral = { lr: 0, fb: 45 };
    this._haveReading = false;
    this._needsCalibration = true;
    this._firstReadingResolve = null;

    this.dragActive = false;
    this._dragStartX = 0;
    this._dragTilt = 0;
    this._touchIds = new Map();

    this.hasTouch = typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0);
    this.lastSource = 'KEYS';

    this._onOrientation = this._onOrientation.bind(this);
    this._bindKeyboard();
  }

  // ---- sensors ----------------------------------------------------------

  async enableSensors() {
    if (!this.sensorsSupported) return false;
    const DOE = window.DeviceOrientationEvent;
    if (DOE && typeof DOE.requestPermission === 'function') {
      try {
        const res = await DOE.requestPermission();
        if (res !== 'granted') return false;
      } catch (e) {
        return false;
      }
    }
    if (!this.sensorsEnabled) {
      window.addEventListener('deviceorientation', this._onOrientation, true);
      this.sensorsEnabled = true;
    }
    if (this.sensorsActive) return true;
    // Wait briefly for a first reading; desktops fire nothing (or nulls).
    return new Promise((resolve) => {
      const timer = setTimeout(() => { this._firstReadingResolve = null; resolve(this.sensorsActive); }, 1500);
      this._firstReadingResolve = () => { clearTimeout(timer); this._firstReadingResolve = null; resolve(true); };
    });
  }

  _screenAngle() {
    if (screen.orientation && typeof screen.orientation.angle === 'number') return screen.orientation.angle;
    if (typeof window.orientation === 'number') return window.orientation;
    return 0;
  }

  _onOrientation(e) {
    if (e.gamma == null && e.beta == null) return;
    const gamma = e.gamma || 0;   // rotation around Y: left/right in portrait
    const beta = e.beta || 0;     // rotation around X: front/back in portrait
    let lr, fb;
    switch (this._screenAngle()) {
      case 90:  lr = beta;  fb = -gamma; break;
      case -90:
      case 270: lr = -beta; fb = gamma;  break;
      case 180: lr = -gamma; fb = -beta; break;
      default:  lr = gamma;  fb = beta;  break;
    }
    this.raw.lr = lr;
    this.raw.fb = fb;
    this._haveReading = true;
    if (this._needsCalibration) { this.calibrate(); }
    if (!this.sensorsActive) {
      this.sensorsActive = true;
      if (this._firstReadingResolve) this._firstReadingResolve();
    }
  }

  // Take the current phone attitude as "centre".
  calibrate() {
    if (!this._haveReading) { this._needsCalibration = true; return false; }
    this.neutral.lr = this.raw.lr;
    this.neutral.fb = this.raw.fb;
    this._needsCalibration = false;
    return true;
  }

  // ---- keyboard ---------------------------------------------------------

  _bindKeyboard() {
    if (typeof window === 'undefined') return;
    window.addEventListener('keydown', (e) => {
      if (e.repeat) { if (e.code === 'Space') e.preventDefault(); return; }
      this.keys.add(e.code);
      if (e.code === 'Space') { this._firePressed = true; this.fireHeld = true; this.lastSource = 'KEYS'; e.preventDefault(); }
      if (e.code === 'KeyP' || e.code === 'Escape') this._pausePressed = true;
      if (e.code === 'Enter') this._confirmPressed = true;
      if (e.code.startsWith('Arrow')) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      if (e.code === 'Space') this.fireHeld = false;
    });
    window.addEventListener('blur', () => { this.keys.clear(); this.fireHeld = false; });
  }

  // ---- touch / pointer on the play surface ----------------------------------

  attachTouch(el) {
    const onDown = (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      el.setPointerCapture && el.setPointerCapture(e.pointerId);
      this._touchIds.set(e.pointerId, { x: e.clientX, startX: e.clientX, moved: false });
      this._firePressed = true;
      this.fireHeld = true;
      if (!this.sensorsActive) {
        this.dragActive = true;
        this._dragStartX = e.clientX;
        this.lastSource = 'TOUCH';
      }
      e.preventDefault();
    };
    const onMove = (e) => {
      const t = this._touchIds.get(e.pointerId);
      if (!t) return;
      t.x = e.clientX;
      if (Math.abs(t.x - t.startX) > 8) t.moved = true;
      if (this.dragActive && !this.sensorsActive) {
        // Full deflection after dragging ~22% of the screen width.
        this._dragTilt = clamp((t.x - t.startX) / (el.clientWidth * 0.22), -1, 1);
      }
    };
    const onUp = (e) => {
      this._touchIds.delete(e.pointerId);
      if (this._touchIds.size === 0) {
        this.fireHeld = false;
        this.dragActive = false;
        this._dragTilt = 0;
      }
    };
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // ---- per-frame ------------------------------------------------------------

  update(dt) {
    let targetTilt = 0;
    let targetDepth = 0;
    const invert = this.settings.invert ? -1 : 1;

    if (this.sensorsActive) {
      const range = RANGE_BY_SENSITIVITY[clamp(Math.round(this.settings.sensitivity), 1, 5) - 1];
      let d = this.raw.lr - this.neutral.lr;
      if (d > 180) d -= 360; else if (d < -180) d += 360;
      if (Math.abs(d) < DEADZONE_DEG) d = 0;
      else d -= Math.sign(d) * DEADZONE_DEG;
      targetTilt = clamp(d / range, -1, 1) * invert;

      if (this.settings.forwardBack) {
        let f = this.raw.fb - this.neutral.fb;
        if (f > 180) f -= 360; else if (f < -180) f += 360;
        if (Math.abs(f) < DEPTH_DEADZONE_DEG) f = 0;
        else f -= Math.sign(f) * DEPTH_DEADZONE_DEG;
        // Tipping the top of the phone away from you (fb decreasing) pushes forward.
        targetDepth = clamp(-f / (range * 1.4), -1, 1);
      }
      this.lastSource = 'TILT';
    } else if (this.dragActive) {
      targetTilt = this._dragTilt;
    }

    // Keyboard always works, and overrides when pressed.
    let kx = 0, kz = 0;
    if (this.keys.has('ArrowLeft') || this.keys.has('KeyA')) kx -= 1;
    if (this.keys.has('ArrowRight') || this.keys.has('KeyD')) kx += 1;
    if (this.keys.has('ArrowUp') || this.keys.has('KeyW')) kz += 1;
    if (this.keys.has('ArrowDown') || this.keys.has('KeyS')) kz -= 1;
    if (kx !== 0) { targetTilt = kx; this.lastSource = 'KEYS'; }
    if (kz !== 0) { targetDepth = kz; }

    // Smooth so sensor jitter doesn't shake the ship.
    const k = 1 - Math.pow(0.001, dt);   // ~fast exponential smoothing
    this.tilt += (targetTilt - this.tilt) * k;
    this.depth += (targetDepth - this.depth) * k;
    if (Math.abs(this.tilt) < 0.002) this.tilt = 0;
    if (Math.abs(this.depth) < 0.002) this.depth = 0;
  }

  consumeFire() { const p = this._firePressed; this._firePressed = false; return p; }
  consumePause() { const p = this._pausePressed; this._pausePressed = false; return p; }
  consumeConfirm() { const p = this._confirmPressed; this._confirmPressed = false; return p; }
  clearEdges() { this._firePressed = false; this._pausePressed = false; this._confirmPressed = false; }

  get controlName() {
    if (this.sensorsActive) return 'TILT';
    return this.lastSource;
  }
}
