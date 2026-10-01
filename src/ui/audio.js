/* Everything is synthesised with Web Audio, so there are no sound files to load. */
export class Sound {
  constructor() {
    this.ctx = null;
    this.on = true;
  }

  start() {
    if (this.ctx) return;
    const ctx = (this.ctx = new (window.AudioContext || window.webkitAudioContext)());
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(ctx.destination);

    // Surf: brown noise through a lowpass whose gain swells with the breath
    const len = ctx.sampleRate * 4;
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      let last = 0;
      for (let i = 0; i < len; i++) {
        last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
        d[i] = last * 3.5;
      }
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 900;
    this.swell = ctx.createGain();
    this.swell.gain.value = 0.5;
    src.connect(this.filter).connect(this.swell).connect(this.master);
    src.start();

    // Deep drone, faded in underwater
    this.drone = ctx.createGain();
    this.drone.gain.value = 0;
    this.drone.connect(this.master);
    [55, 82.4, 110.3].forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = i ? 'sine' : 'triangle';
      o.frequency.value = f;
      o.detune.value = (i - 1) * 6;
      const g = ctx.createGain();
      g.gain.value = 0.12 / (i + 1);
      o.connect(g).connect(this.drone);
      o.start();
    });

    this.master.gain.linearRampToValueAtTime(this.on ? 0.6 : 0, ctx.currentTime + 2);
  }

  setBreath(v) {
    if (!this.ctx) return;
    this.swell.gain.setTargetAtTime(0.35 + v * 0.45, this.ctx.currentTime, 0.3);
  }

  setDepth(d) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.filter.frequency.setTargetAtTime(900 - d * 720, t, 0.4);
    this.drone.gain.setTargetAtTime(d * 0.7, t, 0.6);
  }

  toggle() {
    this.on = !this.on;
    if (this.ctx) this.master.gain.setTargetAtTime(this.on ? 0.6 : 0, this.ctx.currentTime, 0.25);
    return this.on;
  }

  blip(freq = 1400, dur = 0.06, vol = 0.05) {
    if (!this.ctx || !this.on) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(freq * 0.6, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.ctx.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  hover() { this.blip(2200, 0.04, 0.02); }
  click() { this.blip(900, 0.12, 0.06); setTimeout(() => this.blip(1500, 0.08, 0.04), 60); }
}
