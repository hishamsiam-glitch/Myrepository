// Tiny WebAudio synthesiser for arcade sound effects. No audio assets needed.

export class Sfx {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.master = null;
    this._ufo = null;
    this._marchStep = 0;
  }

  // Must be called from a user gesture at least once (autoplay policy).
  unlock() {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.35;
        this.master.connect(this.ctx.destination);
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
    } catch (e) { /* no audio */ }
  }

  get ready() { return this.enabled && this.ctx && this.ctx.state === 'running'; }

  _tone({ freq = 440, end = null, dur = 0.1, type = 'square', vol = 0.3, delay = 0 }) {
    if (!this.ready) return;
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (end != null) osc.frequency.exponentialRampToValueAtTime(Math.max(20, end), t0 + dur);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(g).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  _noise({ dur = 0.3, vol = 0.4, delay = 0, lowpass = 1200 }) {
    if (!this.ready) return;
    const t0 = this.ctx.currentTime + delay;
    const len = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filt = this.ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = lowpass;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(filt).connect(g).connect(this.master);
    src.start(t0);
  }

  shoot()      { this._tone({ freq: 900, end: 220, dur: 0.12, type: 'square', vol: 0.18 }); }
  enemyShoot() { this._tone({ freq: 240, end: 120, dur: 0.15, type: 'sawtooth', vol: 0.08 }); }
  hit()        { this._noise({ dur: 0.18, vol: 0.35, lowpass: 2500 }); this._tone({ freq: 160, end: 40, dur: 0.18, type: 'square', vol: 0.15 }); }
  armourHit()  { this._tone({ freq: 600, end: 500, dur: 0.06, type: 'triangle', vol: 0.2 }); }
  shieldHit()  { this._noise({ dur: 0.08, vol: 0.15, lowpass: 900 }); }
  playerDie()  { this._noise({ dur: 0.9, vol: 0.6, lowpass: 1500 }); this._tone({ freq: 220, end: 30, dur: 0.9, type: 'sawtooth', vol: 0.25 }); }
  bossHit()    { this._tone({ freq: 320, end: 200, dur: 0.1, type: 'square', vol: 0.15 }); }
  bossDie()    { for (let i = 0; i < 6; i++) this._noise({ dur: 0.5, vol: 0.5, delay: i * 0.12, lowpass: 1000 }); this._tone({ freq: 120, end: 25, dur: 1.4, type: 'sawtooth', vol: 0.3 }); }
  extraLife()  { [660, 880, 1100, 1320].forEach((f, i) => this._tone({ freq: f, dur: 0.12, type: 'square', vol: 0.2, delay: i * 0.09 })); }
  levelClear() { [523, 659, 784, 1047, 784, 1047].forEach((f, i) => this._tone({ freq: f, dur: 0.16, type: 'square', vol: 0.2, delay: i * 0.12 })); }
  gameOver()   { [392, 370, 349, 330, 311, 294].forEach((f, i) => this._tone({ freq: f, dur: 0.3, type: 'triangle', vol: 0.25, delay: i * 0.22 })); }
  blip()       { this._tone({ freq: 1200, dur: 0.05, type: 'square', vol: 0.12 }); }
  coin()       { this._tone({ freq: 988, dur: 0.08, type: 'square', vol: 0.2 }); this._tone({ freq: 1319, dur: 0.25, type: 'square', vol: 0.2, delay: 0.08 }); }

  // The classic four-note march; called once per formation "step".
  march() {
    const notes = [98, 92.5, 87.3, 82.4];
    this._tone({ freq: notes[this._marchStep % 4], dur: 0.14, type: 'square', vol: 0.22 });
    this._marchStep++;
  }

  ufoStart() {
    if (!this.ready || this._ufo) return;
    const osc = this.ctx.createOscillator();
    const lfo = this.ctx.createOscillator();
    const lfoGain = this.ctx.createGain();
    const g = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.value = 520;
    lfo.frequency.value = 9;
    lfoGain.gain.value = 180;
    lfo.connect(lfoGain).connect(osc.frequency);
    g.gain.value = 0.07;
    osc.connect(g).connect(this.master);
    osc.start();
    lfo.start();
    this._ufo = { osc, lfo };
  }

  ufoStop() {
    if (!this._ufo) return;
    try { this._ufo.osc.stop(); this._ufo.lfo.stop(); } catch (e) { /* ignore */ }
    this._ufo = null;
  }
}
