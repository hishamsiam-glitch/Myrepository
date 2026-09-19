/* Input: phone tilt (DeviceOrientation) for steering, a held finger for
 * throttle, plus keyboard / drag fallbacks for devices without sensors.
 *
 * Outputs (read each frame via `state`):
 *   steer   -1..1   roll tilt  -> turn left / right
 *   climb   -1..1   pitch tilt -> descend / climb
 *   throttle 0/1    finger (or mouse button / space) held anywhere
 *   sensors  bool   true once real orientation events have arrived */
(function (global) {
  'use strict';

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  function createInput(target, options) {
    const opts = Object.assign({
      steerRange: 22,   // degrees of roll for full turn
      climbRange: 18,   // degrees of pitch for full climb
      deadzone: 1.5,    // degrees
      invertPitch: false,
      smoothing: 0.18,  // 0..1, higher = snappier
    }, options || {});

    const state = {
      steer: 0, climb: 0, throttle: 0, sensors: false,
      rawRoll: 0, rawPitch: 0, roll: 0, pitch: 0, calibrated: false,
      mode: 'sensor', // 'sensor' | 'touch' | 'keyboard'
    };

    let neutralRoll = 0;
    let neutralPitch = 0;
    let wantCalibrate = true;
    let lastEventTime = 0;
    let targetSteer = 0;
    let targetClimb = 0;
    const pointers = new Map();
    const keys = new Set();

    // Map beta/gamma into roll/pitch relative to the current screen rotation,
    // so the game plays the same in portrait and landscape.
    function screenAngle() {
      if (global.screen && global.screen.orientation && typeof global.screen.orientation.angle === 'number') {
        return global.screen.orientation.angle;
      }
      if (typeof global.orientation === 'number') return global.orientation;
      return 0;
    }

    function onOrientation(ev) {
      if (ev.beta == null || ev.gamma == null) return;
      const beta = ev.beta;
      const gamma = ev.gamma;
      let roll;
      let pitch;
      switch (((screenAngle() % 360) + 360) % 360) {
        case 90: roll = beta; pitch = -gamma; break;
        case 180: roll = -gamma; pitch = -beta; break;
        case 270: roll = -beta; pitch = gamma; break;
        default: roll = gamma; pitch = beta; break;
      }
      state.rawRoll = roll;
      state.rawPitch = pitch;
      lastEventTime = performance.now();
      if (!state.sensors) {
        state.sensors = true;
        state.mode = 'sensor';
      }
      if (wantCalibrate) {
        neutralRoll = roll;
        neutralPitch = pitch;
        wantCalibrate = false;
        state.calibrated = true;
      }
      state.roll = roll - neutralRoll;
      state.pitch = pitch - neutralPitch;
      // Keep small angles clean and clamp wrap-around jumps.
      state.roll = clamp(state.roll, -90, 90);
      state.pitch = clamp(state.pitch, -90, 90);
      targetSteer = axis(state.roll, opts.steerRange);
      targetClimb = axis(state.pitch, opts.climbRange) * (opts.invertPitch ? -1 : 1);
    }

    function axis(deg, range) {
      const a = Math.abs(deg);
      if (a < opts.deadzone) return 0;
      const v = (a - opts.deadzone) / (range - opts.deadzone);
      return clamp(v, 0, 1) * Math.sign(deg);
    }

    // On iOS 13+ orientation events require an explicit permission prompt,
    // which must be triggered from a user gesture (the Start button).
    async function requestSensors() {
      const DOE = global.DeviceOrientationEvent;
      if (DOE && typeof DOE.requestPermission === 'function') {
        try {
          const res = await DOE.requestPermission();
          if (res !== 'granted') return false;
        } catch (e) {
          return false;
        }
      }
      global.addEventListener('deviceorientation', onOrientation, true);
      return true;
    }

    function calibrate() {
      wantCalibrate = true;
      state.calibrated = false;
    }

    // ---- Pointer: any held pointer = throttle. Without sensors, the drag
    // offset from the touch-down point becomes a virtual joystick.
    function onPointerDown(ev) {
      if (ev.button != null && ev.button !== 0 && ev.pointerType === 'mouse') return;
      pointers.set(ev.pointerId, { x0: ev.clientX, y0: ev.clientY, x: ev.clientX, y: ev.clientY });
      try { target.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
      ev.preventDefault();
    }
    function onPointerMove(ev) {
      const p = pointers.get(ev.pointerId);
      if (!p) return;
      p.x = ev.clientX;
      p.y = ev.clientY;
      ev.preventDefault();
    }
    function onPointerUp(ev) {
      pointers.delete(ev.pointerId);
      ev.preventDefault();
    }

    target.addEventListener('pointerdown', onPointerDown);
    target.addEventListener('pointermove', onPointerMove);
    target.addEventListener('pointerup', onPointerUp);
    target.addEventListener('pointercancel', onPointerUp);
    target.addEventListener('lostpointercapture', onPointerUp);
    target.addEventListener('contextmenu', (e) => e.preventDefault());

    global.addEventListener('keydown', (e) => {
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' ', 'a', 'd', 'w', 's', 'A', 'D', 'W', 'S'].includes(e.key)) {
        keys.add(e.key.toLowerCase());
        e.preventDefault();
      }
    });
    global.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
    global.addEventListener('blur', () => { keys.clear(); pointers.clear(); });

    function update(dt) {
      const held = pointers.size > 0;
      let steer = targetSteer;
      let climb = targetClimb;
      let throttle = held ? 1 : 0;

      const kLeft = keys.has('arrowleft') || keys.has('a');
      const kRight = keys.has('arrowright') || keys.has('d');
      const kUp = keys.has('arrowup') || keys.has('w');
      const kDown = keys.has('arrowdown') || keys.has('s');
      if (kLeft || kRight || kUp || kDown || keys.has(' ')) {
        state.mode = 'keyboard';
        steer = (kRight ? 1 : 0) - (kLeft ? 1 : 0);
        climb = (kUp ? 1 : 0) - (kDown ? 1 : 0);
        if (keys.has(' ')) throttle = 1;
      } else if (!state.sensors && held) {
        // Virtual joystick from the first pointer's drag.
        state.mode = 'touch';
        const p = pointers.values().next().value;
        steer = clamp((p.x - p.x0) / 90, -1, 1);
        climb = clamp((p.y0 - p.y) / 90, -1, 1);
      } else if (!state.sensors) {
        steer = 0;
        climb = 0;
      }

      const k = 1 - Math.pow(1 - opts.smoothing, dt * 60);
      state.steer += (steer - state.steer) * k;
      state.climb += (climb - state.climb) * k;
      state.throttle = throttle;
      state.sensorsStale = state.sensors && performance.now() - lastEventTime > 2000;
    }

    function setOptions(o) { Object.assign(opts, o); }

    // Test hook: feed orientation values without a real sensor.
    function injectOrientation(beta, gamma) { onOrientation({ beta, gamma }); }

    return { state, update, requestSensors, calibrate, setOptions, injectOrientation, opts };
  }

  global.createInput = createInput;
})(typeof window !== 'undefined' ? window : globalThis);
