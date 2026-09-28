// Fully synthesized audio: gunshots, footsteps, reloads, bomb, explosions, radio voice.

const SR = 44100;

function mk(ctx, dur, fn, channels = 1) {
  const len = Math.floor(SR * dur);
  const buf = ctx.createBuffer(channels, len, SR);
  for (let ch = 0; ch < channels; ch++) {
    const d = buf.getChannelData(ch);
    fn(d, len, ch);
  }
  return buf;
}

function gunBuffer(ctx, p) {
  return mk(ctx, p.len, (d, len) => {
    let lp = 0, lp2 = 0, lpTail = 0;
    for (let i = 0; i < len; i++) {
      const t = i / SR;
      const n = Math.random() * 2 - 1;
      const fc = p.fc0 * Math.exp(-t / p.fcDecay) + p.fc1;
      const a = Math.exp(-2 * Math.PI * fc / SR);
      lp = lp * a + n * (1 - a);
      lp2 = lp2 * 0.5 + lp * 0.5;
      const aT = Math.exp(-2 * Math.PI * p.tailFc / SR);
      lpTail = lpTail * aT + n * (1 - aT);
      const body = lp2 * Math.exp(-t / p.decay) * p.bright * 2.2;
      const thump = Math.sin(2 * Math.PI * p.thump * t * (1 - t * 3)) * Math.exp(-t / p.thumpDecay) * p.thumpGain;
      const crack = t < 0.004 ? n * (1 - t / 0.004) * p.crack : 0;
      const tail = lpTail * Math.exp(-t / p.tail) * p.tailGain * 3;
      const attack = Math.min(1, t / 0.0008);
      d[i] = Math.tanh((body + thump + crack + tail) * attack * p.gain * 1.4) * 0.9;
    }
  });
}

const GUNS = {
  pistol: { len: 0.6, fc0: 7000, fc1: 900, fcDecay: 0.03, decay: 0.05, bright: 0.9, thump: 140, thumpDecay: 0.03, thumpGain: 0.5, crack: 0.8, tail: 0.18, tailFc: 500, tailGain: 0.25, gain: 1 },
  usp: { len: 0.6, fc0: 6000, fc1: 800, fcDecay: 0.03, decay: 0.055, bright: 0.95, thump: 120, thumpDecay: 0.035, thumpGain: 0.6, crack: 0.8, tail: 0.2, tailFc: 450, tailGain: 0.28, gain: 1 },
  deagle: { len: 0.9, fc0: 5500, fc1: 600, fcDecay: 0.05, decay: 0.08, bright: 1.1, thump: 85, thumpDecay: 0.06, thumpGain: 0.9, crack: 1, tail: 0.35, tailFc: 380, tailGain: 0.4, gain: 1.2 },
  smg: { len: 0.45, fc0: 6500, fc1: 1000, fcDecay: 0.025, decay: 0.04, bright: 0.85, thump: 150, thumpDecay: 0.025, thumpGain: 0.45, crack: 0.6, tail: 0.14, tailFc: 600, tailGain: 0.2, gain: 0.9 },
  ak: { len: 0.8, fc0: 5000, fc1: 700, fcDecay: 0.04, decay: 0.07, bright: 1.0, thump: 95, thumpDecay: 0.05, thumpGain: 0.85, crack: 1, tail: 0.3, tailFc: 420, tailGain: 0.35, gain: 1.15 },
  m4: { len: 0.7, fc0: 6500, fc1: 900, fcDecay: 0.035, decay: 0.06, bright: 1.0, thump: 110, thumpDecay: 0.04, thumpGain: 0.7, crack: 1, tail: 0.26, tailFc: 480, tailGain: 0.3, gain: 1.05 },
  shotgun: { len: 1.0, fc0: 4200, fc1: 500, fcDecay: 0.06, decay: 0.1, bright: 1.2, thump: 70, thumpDecay: 0.08, thumpGain: 1.0, crack: 1, tail: 0.4, tailFc: 350, tailGain: 0.45, gain: 1.2 },
  awp: { len: 1.6, fc0: 6000, fc1: 500, fcDecay: 0.06, decay: 0.12, bright: 1.25, thump: 60, thumpDecay: 0.1, thumpGain: 1.1, crack: 1.3, tail: 0.7, tailFc: 300, tailGain: 0.55, gain: 1.35 },
};

export class GameAudio {
  constructor() { this.ctx = null; this.enabled = true; this.listener = { x: 0, y: 0, z: 0, yaw: 0 }; this.occlusion = null; }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { this.enabled = false; return; }
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain(); this.master.gain.value = 0.55;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.2;
    this.master.connect(comp); comp.connect(ctx.destination);
    // outdoor slap-back reverb
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = mk(ctx, 1.6, (d, len, ch) => {
      for (let i = 0; i < len; i++) {
        const t = i / SR;
        const early = (Math.abs(t - 0.045 - ch * 0.01) < 0.002 || Math.abs(t - 0.11 - ch * 0.02) < 0.003) ? 0.6 : 0;
        d[i] = ((Math.random() * 2 - 1) * Math.exp(-t / 0.35) * 0.35 + early * (Math.random() * 2 - 1)) * (t > 0.02 ? 1 : 0);
      }
    }, 2);
    this.revGain = ctx.createGain(); this.revGain.gain.value = 0.35;
    this.reverb.connect(this.revGain); this.revGain.connect(this.master);
    this.buffers = {};
    for (const k in GUNS) this.buffers['gun_' + k] = gunBuffer(ctx, GUNS[k]);
    this._make();
  }

  _make() {
    const ctx = this.ctx, B = this.buffers;
    const click = (f, dur, noiseAmt = 0.4, dec = 0.012) => mk(ctx, dur, (d, len) => {
      for (let i = 0; i < len; i++) { const t = i / SR; d[i] = (Math.sin(2 * Math.PI * f * t) * 0.6 + (Math.random() * 2 - 1) * noiseAmt) * Math.exp(-t / dec); }
    });
    for (let k = 0; k < 4; k++) {
      B['step' + k] = mk(ctx, 0.14, (d, len) => {
        let lp = 0; const f = 0.12 + k * 0.03;
        for (let i = 0; i < len; i++) {
          const t = i / SR, n = Math.random() * 2 - 1;
          lp = lp * (1 - f) + n * f;
          const grains = Math.random() < 0.02 ? (Math.random() * 2 - 1) * 0.6 : 0;
          d[i] = (lp * 1.8 + grains) * Math.exp(-t / 0.035) * (t < 0.005 ? t / 0.005 : 1);
        }
      });
    }
    B.clipout = click(1800, 0.12, 0.5, 0.02);
    B.clipin = mk(ctx, 0.18, (d, len) => { for (let i = 0; i < len; i++) { const t = i / SR; const hit = t < 0.05 ? 1 : (t > 0.08 ? 0.8 : 0); d[i] = (Math.sin(2 * Math.PI * 900 * t) * 0.5 + (Math.random() * 2 - 1) * 0.5) * Math.exp(-((t > 0.08 ? t - 0.08 : t)) / 0.015) * hit; } });
    B.bolt = mk(ctx, 0.35, (d, len) => { for (let i = 0; i < len; i++) { const t = i / SR; const e = Math.exp(-t / 0.02) + (t > 0.18 ? Math.exp(-(t - 0.18) / 0.02) : 0); const slide = t > 0.03 && t < 0.17 ? 0.15 : 0; d[i] = ((Math.random() * 2 - 1) * (0.6 * e + slide) + Math.sin(2 * Math.PI * 2400 * t) * 0.3 * e); } });
    B.empty = click(3000, 0.06, 0.3, 0.006);
    B.beep = mk(ctx, 0.14, (d, len) => { for (let i = 0; i < len; i++) { const t = i / SR; d[i] = Math.sin(2 * Math.PI * 1760 * t) * 0.45 * Math.min(1, t / 0.003) * Math.min(1, (0.14 - t) / 0.02); } });
    B.key = mk(ctx, 0.08, (d, len) => { for (let i = 0; i < len; i++) { const t = i / SR; d[i] = Math.sin(2 * Math.PI * 1200 * t) * 0.35 * Math.exp(-t / 0.03); } });
    B.explode = mk(ctx, 3.0, (d, len) => {
      let lp = 0, lp2 = 0;
      for (let i = 0; i < len; i++) {
        const t = i / SR, n = Math.random() * 2 - 1;
        const fc = 3000 * Math.exp(-t / 0.15) + 150;
        const a = Math.exp(-2 * Math.PI * fc / SR);
        lp = lp * a + n * (1 - a); lp2 = lp2 * 0.6 + lp * 0.4;
        const thump = Math.sin(2 * Math.PI * 42 * t * (1 - t * 0.3)) * Math.exp(-t / 0.3);
        d[i] = Math.tanh((lp2 * 3.5 * Math.exp(-t / 0.7) + thump * 1.2) * 1.5) * Math.min(1, t / 0.002);
      }
    });
    B.hs = mk(ctx, 0.35, (d, len) => { for (let i = 0; i < len; i++) { const t = i / SR; d[i] = (Math.sin(2 * Math.PI * 3200 * t) * 0.5 + Math.sin(2 * Math.PI * 5100 * t) * 0.3 + Math.sin(2 * Math.PI * 7900 * t) * 0.15) * Math.exp(-t / 0.07); } });
    B.hit = mk(ctx, 0.12, (d, len) => { let lp = 0; for (let i = 0; i < len; i++) { const t = i / SR; lp = lp * 0.85 + (Math.random() * 2 - 1) * 0.15; d[i] = (lp * 3 + Math.sin(2 * Math.PI * 180 * t) * 0.5) * Math.exp(-t / 0.025); } });
    B.knife = mk(ctx, 0.25, (d, len) => { let lp = 0; for (let i = 0; i < len; i++) { const t = i / SR; const f = 0.05 + 0.4 * Math.sin(Math.PI * t / 0.25); lp = lp * (1 - f) + (Math.random() * 2 - 1) * f; d[i] = lp * Math.sin(Math.PI * t / 0.25) * 0.8; } });
    B.knifehit = mk(ctx, 0.2, (d, len) => { for (let i = 0; i < len; i++) { const t = i / SR; d[i] = ((Math.random() * 2 - 1) * 0.6 + Math.sin(2 * Math.PI * 220 * t) * 0.5) * Math.exp(-t / 0.03); } });
    B.bounce = click(2600, 0.1, 0.2, 0.02);
    B.shell = mk(ctx, 0.15, (d, len) => { for (let i = 0; i < len; i++) { const t = i / SR; d[i] = (Math.sin(2 * Math.PI * 4200 * t) * 0.4 + Math.sin(2 * Math.PI * 6800 * t) * 0.25) * Math.exp(-t / 0.03); } });
    B.flashpop = mk(ctx, 0.9, (d, len) => { let lp = 0; for (let i = 0; i < len; i++) { const t = i / SR; lp = lp * 0.3 + (Math.random() * 2 - 1) * 0.7; d[i] = Math.tanh(lp * 2 * Math.exp(-t / 0.08) + Math.sin(2 * Math.PI * 90 * t) * Math.exp(-t / 0.05)); } });
    B.hiss = mk(ctx, 2.5, (d, len) => { let lp = 0; for (let i = 0; i < len; i++) { const t = i / SR; lp = lp * 0.7 + (Math.random() * 2 - 1) * 0.3; d[i] = lp * 0.6 * Math.min(1, t / 0.05) * Math.exp(-t / 1.2); } });
    B.land = mk(ctx, 0.15, (d, len) => { let lp = 0; for (let i = 0; i < len; i++) { const t = i / SR; lp = lp * 0.9 + (Math.random() * 2 - 1) * 0.1; d[i] = (lp * 4 + Math.sin(2 * Math.PI * 70 * t) * 0.6) * Math.exp(-t / 0.04); } });
    B.pickup = click(1400, 0.15, 0.3, 0.03);
    B.buy = mk(ctx, 0.2, (d, len) => { for (let i = 0; i < len; i++) { const t = i / SR; d[i] = ((Math.random() * 2 - 1) * 0.4 + Math.sin(2 * Math.PI * 800 * t) * 0.3) * (Math.exp(-t / 0.02) + (t > 0.08 ? Math.exp(-(t - 0.08) / 0.02) : 0)); } });
    B.squelch = mk(ctx, 0.12, (d, len) => { for (let i = 0; i < len; i++) { const t = i / SR; d[i] = (Math.random() * 2 - 1) * 0.25 * (1 - t / 0.12); } });
    B.defuse = mk(ctx, 0.25, (d, len) => { for (let i = 0; i < len; i++) { const t = i / SR; d[i] = (Math.random() * 2 - 1) * 0.3 * Math.exp(-t / 0.01) + Math.sin(2 * Math.PI * 600 * t) * 0.2 * Math.exp(-t / 0.05); } });
    B.whiz = mk(ctx, 0.25, (d, len) => { let lp = 0; for (let i = 0; i < len; i++) { const t = i / SR; lp = lp * 0.8 + (Math.random() * 2 - 1) * 0.2; d[i] = lp * 1.5 * Math.sin(Math.PI * t / 0.25) ** 2; } });
  }

  setListener(x, y, z, yaw) { const l = this.listener; l.x = x; l.y = y; l.z = z; l.yaw = yaw; }

  play(name, pos = null, vol = 1, rate = 1, opts = {}) {
    if (!this.ctx || !this.enabled) return;
    const buf = this.buffers[name]; if (!buf) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource(); src.buffer = buf; src.playbackRate.value = rate * (opts.noJitter ? 1 : (0.96 + Math.random() * 0.08));
    const g = ctx.createGain();
    let node = src;
    let revAmt = opts.reverb ?? 0.25;
    if (pos) {
      const l = this.listener;
      const dx = pos.x - l.x, dy = pos.y - l.y, dz = pos.z - l.z;
      const d = Math.hypot(dx, dy, dz);
      const range = opts.range ?? 30;
      let gain = 1 / (1 + (d / range) ** 1.6);
      if (d > (opts.max ?? 220)) return;
      let cutoff = 20000 * Math.exp(-d / 90);
      if (this.occlusion && d > 3 && this.occlusion(pos)) { gain *= 0.45; cutoff = Math.min(cutoff, 1400); revAmt *= 1.6; }
      g.gain.value = vol * gain;
      if (cutoff < 16000) {
        const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = Math.max(300, cutoff);
        node.connect(f); node = f;
      }
      if (ctx.createStereoPanner && d > 0.5) {
        const p = ctx.createStereoPanner();
        // listener right vector (yaw 0 looks -z; right = +x)
        const rx = Math.cos(l.yaw), rz = -Math.sin(l.yaw);
        p.pan.value = Math.max(-0.85, Math.min(0.85, (dx * rx + dz * rz) / Math.max(1, d)));
        node.connect(p); node = p;
      }
      revAmt *= 1 + Math.min(2, d / 40);
    } else g.gain.value = vol;
    node.connect(g); g.connect(this.master);
    if (revAmt > 0) { const s = ctx.createGain(); s.gain.value = revAmt * (pos ? g.gain.value : vol); node.connect(s); s.connect(this.reverb); }
    src.start();
    return src;
  }

  gun(kind, pos, own) {
    this.play('gun_' + kind, own ? null : pos, own ? 0.62 : 1.0, 1, { range: 38, max: 300, reverb: own ? 0.18 : 0.3 });
  }

  say(text) {
    this.play('squelch', null, 0.5);
    try {
      if (!window.speechSynthesis) return;
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.05; u.pitch = 0.7; u.volume = 0.8; u.lang = 'en-US';
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    } catch (e) { /* speech unavailable */ }
  }
}
