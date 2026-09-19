/* Orientation sensing.
 *
 * Both sources (the Android bridge and the browser's DeviceOrientation
 * event) are reduced to the same thing: a 3x3 rotation matrix R that maps
 * device-frame vectors to world-frame vectors (X east, Y north, Z up), row
 * major, columns = device axes expressed in the world. From it we derive:
 *
 *   heading  rotation of the "look through the phone" direction (device -Z)
 *            about the vertical, clockwise from north, radians
 *   pitch    elevation of that direction (+ = phone facing up), radians
 *   roll     elevation of the screen's right edge (+ = right edge raised),
 *            radians, taking the current landscape rotation into account
 *
 * Deriving angles from the look vector instead of using Euler angles keeps
 * them continuous however the phone is held. */

export const DEG = Math.PI / 180;

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

/* Screen-right axis in device coordinates for the given screen rotation
 * angle (0/90/180/270). At 90 the top of the phone points left, so the
 * screen's right is the device's -Y (bottom) edge. */
function screenRightColumn(R, angle) {
  switch (((angle % 360) + 360) % 360) {
    case 90: return [-R[1], -R[4], -R[7]];
    case 180: return [-R[0], -R[3], -R[6]];
    case 270: return [R[1], R[4], R[7]];
    default: return [R[0], R[3], R[6]];
  }
}

export function orientationFromMatrix(R, angle) {
  // Look direction = device -Z axis (third column, negated).
  const fx = -R[2], fy = -R[5], fz = -R[8];
  const heading = Math.atan2(fx, fy);
  const pitch = Math.asin(clamp(fz, -1, 1));
  const right = screenRightColumn(R, angle);
  const roll = Math.asin(clamp(right[2], -1, 1));
  return { heading, pitch, roll };
}

/* W3C DeviceOrientation Euler angles (degrees, Z-X'-Y'') to the matrix. */
export function matrixFromEuler(alpha, beta, gamma) {
  const a = alpha * DEG, b = beta * DEG, g = gamma * DEG;
  const cA = Math.cos(a), sA = Math.sin(a);
  const cB = Math.cos(b), sB = Math.sin(b);
  const cG = Math.cos(g), sG = Math.sin(g);
  return [
    cA * cG - sA * sB * sG, -cB * sA, cA * sG + cG * sA * sB,
    cG * sA + cA * sB * sG, cA * cB, sA * sG - cA * cG * sB,
    -cB * sG, sB, cB * cG,
  ];
}

export function wrapAngle(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

export class SensorSource {
  constructor(global = typeof window !== 'undefined' ? window : {}) {
    this.global = global;
    this.mode = 'none';       // 'android' | 'browser' | 'none'
    this.source = 'none';     // description of the underlying sensor
    this.available = false;   // true once a real sample has arrived
    this.yawOk = false;       // false when only tilt (no gyro) is available
    this.heading = 0;
    this.pitch = 0;
    this.roll = 0;
    this.samples = 0;
    this.angleOverride = null;
    this._onOrientation = (ev) => {
      if (ev.alpha == null || ev.beta == null || ev.gamma == null) return;
      this.injectEuler(ev.alpha, ev.beta, ev.gamma);
    };
  }

  get bridge() {
    const b = this.global.AndroidBridge;
    return b && typeof b.getSensors === 'function' ? b : null;
  }

  screenAngle() {
    if (this.angleOverride != null) return this.angleOverride;
    const g = this.global;
    if (g.screen && g.screen.orientation && typeof g.screen.orientation.angle === 'number') return g.screen.orientation.angle;
    if (typeof g.orientation === 'number') return g.orientation;
    return 0;
  }

  start() {
    if (this.bridge) {
      this.mode = 'android';
      this.yawOk = !!this.bridge.hasRotationSensor();
      return;
    }
    if (this.global.DeviceOrientationEvent) {
      this.mode = 'browser';
      this.yawOk = true;
      this.global.addEventListener('deviceorientation', this._onOrientation, true);
    }
  }

  /* iOS needs an explicit permission request from a user gesture. */
  async requestPermission() {
    const D = this.global.DeviceOrientationEvent;
    if (D && typeof D.requestPermission === 'function') {
      try {
        const r = await D.requestPermission();
        return r === 'granted';
      } catch (e) {
        return false;
      }
    }
    return true;
  }

  /* Pull the latest sample from the Android bridge (once per frame). */
  poll() {
    if (this.mode !== 'android') return;
    let s;
    try { s = JSON.parse(this.bridge.getSensors()); } catch (e) { return; }
    if (!s || !s.ok) return;
    this.source = s.source || 'android';
    this.yawOk = !!s.yawOk;
    this.injectMatrix(s.r, typeof s.rot === 'number' ? s.rot : this.screenAngle());
  }

  injectMatrix(R, angle) {
    const o = orientationFromMatrix(R, angle == null ? this.screenAngle() : angle);
    this.heading = o.heading;
    this.pitch = o.pitch;
    this.roll = o.roll;
    this.available = true;
    this.samples++;
  }

  injectEuler(alpha, beta, gamma, angle) {
    if (this.mode === 'none') this.mode = 'browser';
    if (this.source === 'none') this.source = 'deviceorientation';
    this.injectMatrix(matrixFromEuler(alpha, beta, gamma), angle);
  }
}
