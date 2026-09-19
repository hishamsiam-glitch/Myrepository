/* Synthesised sound effects (WebAudio) - no audio files needed. */

export class GameAudio {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.master = null;
  }

  /* Must be called from a user gesture the first time. */
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
    this.noiseBuf = this._noise(1.0);
  }

  _noise(seconds) {
    const n = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  _env(gainNode, t, attack, decay, peak = 1) {
    const g = gainNode.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(0.0001, t);
    g.linearRampToValueAtTime(peak, t + attack);
    g.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  _tone(type, f0, f1, dur, vol = 0.3, delay = 0) {
    const c = this.ctx, t = c.currentTime + delay;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    this._env(g, t, 0.005, dur, vol);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  _burst(dur, vol = 0.3, filterFreq = 2000, delay = 0) {
    const c = this.ctx, t = c.currentTime + delay;
    const s = c.createBufferSource();
    s.buffer = this.noiseBuf;
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(filterFreq, t);
    f.frequency.exponentialRampToValueAtTime(200, t + dur);
    const g = c.createGain();
    this._env(g, t, 0.003, dur, vol);
    s.connect(f).connect(g).connect(this.master);
    s.start(t);
    s.stop(t + dur + 0.05);
  }

  play(name) {
    if (!this.enabled || !this.ctx) return;
    if (this.ctx.state === 'suspended') this.ctx.resume();
    switch (name) {
      case 'shoot': this._tone('square', 900, 180, 0.09, 0.18); this._burst(0.08, 0.25, 3000); break;
      case 'empty': this._tone('square', 300, 200, 0.06, 0.12); break;
      case 'hit': this._tone('triangle', 500, 250, 0.06, 0.2); break;
      case 'kill': this._burst(0.35, 0.4, 1200); this._tone('sawtooth', 220, 40, 0.35, 0.25); break;
      case 'hurt': this._tone('sine', 140, 60, 0.25, 0.4); this._burst(0.15, 0.2, 500); break;
      case 'enemyShot': this._tone('sawtooth', 400, 700, 0.12, 0.12); break;
      case 'pickup': this._tone('sine', 660, 660, 0.08, 0.2); this._tone('sine', 990, 990, 0.12, 0.2, 0.08); break;
      case 'core': this._tone('sine', 523, 523, 0.1, 0.2); this._tone('sine', 659, 659, 0.1, 0.2, 0.1); this._tone('sine', 784, 784, 0.2, 0.2, 0.2); break;
      case 'checkpoint': this._tone('triangle', 523, 523, 0.12, 0.25); this._tone('triangle', 784, 784, 0.12, 0.25, 0.12); this._tone('triangle', 1046, 1046, 0.3, 0.25, 0.24); break;
      case 'missionStart': this._tone('square', 330, 330, 0.12, 0.15); this._tone('square', 330, 330, 0.12, 0.15, 0.18); this._tone('square', 440, 440, 0.3, 0.15, 0.36); break;
      case 'missionDone': [523, 659, 784, 1046].forEach((f, i) => this._tone('triangle', f, f, 0.18, 0.22, i * 0.12)); break;
      case 'missionFail': this._tone('sawtooth', 300, 80, 0.8, 0.25); break;
      case 'gate': this._burst(0.8, 0.3, 600); this._tone('sine', 80, 50, 0.8, 0.3); break;
      case 'death': this._tone('sawtooth', 200, 30, 1.2, 0.3); this._burst(0.6, 0.3, 800); break;
      case 'win': [523, 659, 784, 1046, 1318].forEach((f, i) => this._tone('triangle', f, f, 0.25, 0.22, i * 0.14)); break;
      case 'click': this._tone('square', 800, 800, 0.03, 0.08); break;
      case 'tick': this._tone('square', 1200, 1200, 0.03, 0.1); break;
      default: break;
    }
  }
}
