/* Tiny WebAudio rotor hum + pickup / crash sounds. Everything is
 * synthesised, so there are no asset files to load. */
(function (global) {
  'use strict';

  function createAudio() {
    let ctx = null;
    let rotorGain = null;
    let rotorOsc = null;
    let lfo = null;
    let lfoGain = null;
    let filter = null;
    let muted = false;
    let started = false;

    function ensure() {
      if (ctx) return true;
      const AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();

      rotorOsc = ctx.createOscillator();
      rotorOsc.type = 'sawtooth';
      rotorOsc.frequency.value = 46;

      filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 220;

      // Blade "chop": amplitude modulation at ~13 Hz.
      lfo = ctx.createOscillator();
      lfo.type = 'square';
      lfo.frequency.value = 13;
      lfoGain = ctx.createGain();
      lfoGain.gain.value = 0.5;
      const chop = ctx.createGain();
      chop.gain.value = 0.5;
      lfo.connect(lfoGain).connect(chop.gain);

      rotorGain = ctx.createGain();
      rotorGain.gain.value = 0;

      rotorOsc.connect(filter).connect(chop).connect(rotorGain).connect(ctx.destination);
      rotorOsc.start();
      lfo.start();
      started = true;
      return true;
    }

    function resume() {
      if (!ensure()) return;
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    }

    // throttle 0..1, speed 0..1
    function setRotor(throttle, speed) {
      if (!started) return;
      const target = muted ? 0 : 0.05 + throttle * 0.09;
      const now = ctx.currentTime;
      rotorGain.gain.setTargetAtTime(target, now, 0.15);
      rotorOsc.frequency.setTargetAtTime(44 + speed * 18, now, 0.2);
      lfo.frequency.setTargetAtTime(11 + speed * 6 + throttle * 2, now, 0.2);
      filter.frequency.setTargetAtTime(200 + speed * 260, now, 0.2);
    }

    function blip(freq, dur, type, vol) {
      if (!started || muted) return;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = type || 'sine';
      o.frequency.value = freq;
      g.gain.value = vol || 0.15;
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
      o.connect(g).connect(ctx.destination);
      o.start();
      o.stop(ctx.currentTime + dur);
    }

    function pickup() {
      blip(660, 0.12, 'triangle', 0.12);
      setTimeout(() => blip(990, 0.18, 'triangle', 0.12), 80);
    }

    function ring() {
      blip(520, 0.1, 'square', 0.06);
      setTimeout(() => blip(780, 0.1, 'square', 0.06), 60);
      setTimeout(() => blip(1040, 0.16, 'square', 0.06), 120);
    }

    function warning() { blip(880, 0.08, 'square', 0.05); }

    function crash() {
      if (!started || muted) return;
      const len = 1.2;
      const buf = ctx.createBuffer(1, ctx.sampleRate * len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 600;
      const g = ctx.createGain();
      g.gain.value = 0.5;
      src.connect(f).connect(g).connect(ctx.destination);
      src.start();
      rotorGain.gain.setTargetAtTime(0, ctx.currentTime, 0.3);
    }

    function setMuted(m) {
      muted = m;
      if (rotorGain) rotorGain.gain.setTargetAtTime(m ? 0 : 0.05, ctx.currentTime, 0.1);
    }

    return { resume, setRotor, pickup, ring, warning, crash, setMuted, isMuted: () => muted };
  }

  global.createAudio = createAudio;
})(typeof window !== 'undefined' ? window : globalThis);
