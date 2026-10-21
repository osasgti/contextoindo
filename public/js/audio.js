// Sound engine, adapted from tiktok-game (public/js/audio.js): same bus layout, same URL
// options and the same mute/volume behaviour, so both games feel alike on stream.
// Everything is synthesised with the Web Audio API: no audio files, nothing to license.
//
//   music    ambient loop at 64 BPM: soft pad, low pluck, faint shaker. It builds with the round:
//            a bell arpeggio joins at 3:00, a low pulse at 5:00, the filter opens in the last
//            minute, and a heartbeat sits under the last 30 seconds.
//   effects  tile flips, guess ticks, hot/cold chimes, a chord for a new best guess, close-call and
//            hot-streak stings, per-gift chimes, a win fanfare that grows with the streak, the
//            countdown, the reveal and break sweeps, chat-command pops.
//
// Every effect can be muted on its own (setMuted), and music ducks under text-to-speech.
// URL options: ?sound=0 (mute all), ?music=0 (mute music only), ?volume=0..1 (master).
// Peaks are held under -3 dBFS by a limiter and a soft clipper; at most 6 effects at once.
// In OBS tick "Control audio via OBS" on the browser source.

const VOICE_CAP = 6;
const PEAK = 0.7; // -3.1 dBFS
const BPM = 64;
const num = (v, d) => (v == null || v === '' || Number.isNaN(Number(v)) ? d : Math.max(0, Math.min(1, Number(v))));
const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
const clamp01 = (v) => Math.max(0, Math.min(1, Number(v) || 0));

// A minor pentatonic: every gift chime, flip and chord lands in the same key as the music.
const PENTA = [0, 3, 5, 7, 10];
const penta = (base, deg) => base + 12 * Math.floor(deg / 5) + PENTA[((deg % 5) + 5) % 5];

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

// A minor colour: Am9, Fmaj7, Cadd9, G6. Two bars each, 8 bars = 30 s at 64 BPM.
const CHORDS = [
  { root: 45, pad: [57, 60, 64, 67, 71] },
  { root: 41, pad: [53, 57, 60, 64] },
  { root: 48, pad: [55, 60, 62, 64] },
  { root: 43, pad: [55, 59, 62, 64] },
];

export class Sound {
  /**
   * music: false keeps the music off (control page previews).
   * context / forceOk: tests render the effects into an OfflineAudioContext.
   */
  constructor({ music = true, context = null, forceOk = false } = {}) {
    const q = new URLSearchParams(location.search);
    this.urlMuted = q.get('sound') === '0';
    this.urlMusicOff = q.get('music') === '0';
    this.masterVol = num(q.get('volume'), 1);
    this.musicVol = 0.25;
    this.sfxVol = 0.6;
    this.soundOn = true;
    this.wantMusic = music;
    this.injected = context;
    this.forceOk = forceOk;
    this.ctx = null;
    this.live = 0;
    this.last = {};
    this.mutedFx = new Set();
    this.scene = 'idle';
    this.step = 0;
    this.nextAt = 0;
    this.tn = null; // round progress from the overlay: { playing, elapsed, left, at }
    this.l2On = false;
    this.l3On = false;
    this.hbSec = null;
    this.heat = 0;
    this.ttsHold = false;
    this.sweep = null;
    this._lvl = 0;
    this.listeners = new Set();
    if (this.urlMuted) return;
    if (!context) {
      const unlock = () => this._init();
      window.addEventListener('pointerdown', unlock);
      window.addEventListener('keydown', unlock);
    }
    this._init();
  }

  /** 'off' (muted), 'blocked' (browser wants a click), 'running'. */
  get state() {
    if (this.urlMuted || !this.soundOn) return 'off';
    if (!this.ctx) return 'blocked';
    return this.forceOk || this.ctx.state === 'running' ? 'running' : 'blocked';
  }

  onState(fn) {
    this.listeners.add(fn);
    fn(this.state);
  }

  _emitState() {
    for (const fn of this.listeners) fn(this.state);
  }

  get ok() {
    return !this.urlMuted && this.soundOn && !!this.ctx && (this.forceOk || this.ctx.state === 'running');
  }

  /** Effects the streamer switched off one by one on the control page. */
  setMuted(list = []) {
    this.mutedFx = new Set(Array.isArray(list) ? list : []);
  }

  _fx(name) {
    return this.ok && !this.mutedFx.has(name);
  }

  _init() {
    if (this.urlMuted) return;
    if (this.ctx) {
      if (this.ctx.state === 'suspended' && !this.injected) this.ctx.resume().then(() => this._emitState(), () => {});
      return;
    }
    let c;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      c = this.ctx = this.injected || new AC();
    } catch {
      return;
    }
    c.onstatechange = () => this._emitState();
    // bus: sfx -> master; music -> scene -> duck -> master; master -> limiter -> clipper -> out
    const limiter = c.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.15;
    const clip = c.createWaveShaper();
    const curve = new Float32Array(2048);
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      curve[i] = PEAK * Math.tanh((x * 1.2) / PEAK) / Math.tanh(1.2 / PEAK);
    }
    clip.curve = curve;
    limiter.connect(clip).connect(c.destination);
    // the level meter listens after the clipper; it feeds the calm, audio-reactive background
    this.analyser = c.createAnalyser();
    this.analyser.fftSize = 256;
    this.levelBuf = new Uint8Array(this.analyser.fftSize);
    clip.connect(this.analyser);
    this.master = c.createGain();
    this.master.connect(limiter);
    this.sfx = c.createGain();
    this.sfx.connect(this.master);
    this.duckNode = c.createGain();
    this.duckNode.connect(this.master);
    this.sceneNode = c.createGain();
    this.sceneNode.gain.value = 0.85;
    this.sceneNode.connect(this.duckNode);
    this.music = c.createGain();
    this.music.connect(this.sceneNode);
    this.padFilter = c.createBiquadFilter();
    this.padFilter.type = 'lowpass';
    this.padFilter.frequency.value = 800;
    this.padFilter.Q.value = 0.4;
    this.padFilter.connect(this.music);
    // a little air: feedback delay on the music
    const dl = c.createDelay(1.5);
    dl.delayTime.value = (60 / BPM) * 0.75;
    const fb = c.createGain();
    fb.gain.value = 0.3;
    const wet = c.createGain();
    wet.gain.value = 0.28;
    const tone = c.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 2200;
    this.musicIn = c.createGain();
    this.musicIn.connect(this.music);
    this.musicIn.connect(dl);
    dl.connect(tone).connect(fb).connect(dl);
    tone.connect(wet).connect(this.music);

    // round-progress layers: a bell arpeggio from 3:00, a low pulse from 5:00
    this.l2 = c.createGain();
    this.l2.gain.value = 0;
    this.l2.connect(this.musicIn);
    this.l3 = c.createGain();
    this.l3.gain.value = 0;
    this.l3.connect(this.music);

    // the warmth drone: a soft tone whose pitch follows the closest guess
    this.droneGain = c.createGain();
    this.droneGain.gain.value = 0;
    this.droneGain.connect(this.padFilter);
    this.drone = [c.createOscillator(), c.createOscillator()];
    this.drone[0].type = 'sine';
    this.drone[1].type = 'triangle';
    this.drone[1].detune.value = 7;
    for (const o of this.drone) {
      o.frequency.value = midi(45);
      o.connect(this.droneGain);
      o.start();
    }

    const len = c.sampleRate * 2;
    this.noise = c.createBuffer(1, len, c.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    this._applyVolumes();
    if (!this.injected) {
      this.scheduler = setInterval(() => this._schedule(), 100);
      if (c.state === 'suspended') c.resume().catch(() => {});
    }
    this._emitState();
  }

  /** Live settings from the control page. URL options always win. */
  setVolumes({ music, sfx, sound } = {}) {
    if (music != null) this.musicVol = num(music, this.musicVol);
    if (sfx != null) this.sfxVol = num(sfx, this.sfxVol);
    if (sound != null) this.soundOn = !!sound;
    this._applyVolumes();
    this._emitState();
  }

  _applyVolumes() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const on = this.soundOn ? 1 : 0;
    this.master.gain.setTargetAtTime(this.masterVol * on, t, 0.05);
    this.sfx.gain.setTargetAtTime(this.sfxVol, t, 0.05);
    this.music.gain.setTargetAtTime(this.wantMusic && !this.urlMusicOff ? this.musicVol : 0, t, 0.3);
  }

  /** 'idle' | 'playing' | 'break'. Music sits lower in a round and swells through the break. */
  setScene(scene, breakMs = 15000) {
    if (scene === this.scene) return;
    this.scene = scene;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const g = this.sceneNode.gain;
    const f = this.padFilter.frequency;
    g.cancelScheduledValues(t);
    f.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    f.setValueAtTime(f.value, t);
    this.lastFilt = null;
    if (scene === 'playing') {
      g.linearRampToValueAtTime(0.6, t + 2.5);
      f.linearRampToValueAtTime(760, t + 2.5);
    } else if (scene === 'break') {
      g.linearRampToValueAtTime(1, t + breakMs / 1000);
      f.linearRampToValueAtTime(1500, t + breakMs / 1000);
    } else {
      g.linearRampToValueAtTime(0.85, t + 2);
      f.linearRampToValueAtTime(900, t + 2);
    }
    if (scene !== 'playing') this.setHeat(0, false);
  }

  /**
   * Round progress, a few times a second: playing, ms since the start, ms left. It drives the
   * layers (3:00 and 5:00), the filter opening in the last minute and the heartbeat.
   */
  setTension(playing, elapsedMs = 0, leftMs = 0) {
    this.tn = { playing: !!playing, elapsed: elapsedMs, left: leftMs, at: performance.now() };
    if (!this.ctx || !playing || this.scene !== 'playing') return;
    if (leftMs < 60000 && this.ok) {
      const k = clamp01(1 - leftMs / 60000);
      const target = 760 + k * 1700;
      if (this.lastFilt == null || Math.abs(target - this.lastFilt) > 40) {
        this.lastFilt = target;
        const t = this.ctx.currentTime;
        this.padFilter.frequency.setTargetAtTime(target, t, 0.8);
        this.sceneNode.gain.setTargetAtTime(0.6 + k * 0.25, t, 0.8);
      }
    }
  }

  /** The closest guess so far (0..1): the drone glides to its pitch and swells with it. */
  setHeat(h, playing = true) {
    this.heat = clamp01(h);
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const on = playing && this._fx('best') && this.heat > 0.02;
    const note = penta(45, Math.round(this.heat * 9));
    for (const o of this.drone) o.frequency.setTargetAtTime(midi(note), t, 0.5);
    this.droneGain.gain.setTargetAtTime(on ? 0.01 + 0.035 * this.heat : 0, t, 0.6);
  }

  /** Smoothed loudness 0..1, for the background glow. */
  level() {
    if (!this.ok || !this.analyser) return 0;
    this.analyser.getByteTimeDomainData(this.levelBuf);
    let s = 0;
    for (let i = 0; i < this.levelBuf.length; i++) {
      const x = (this.levelBuf[i] - 128) / 128;
      s += x * x;
    }
    const rms = Math.sqrt(s / this.levelBuf.length);
    this._lvl += (Math.min(1, rms * 3.2) - this._lvl) * 0.35;
    return this._lvl;
  }

  // ------------------------------------------------------------ building blocks
  _env(g, t, a, peak, decay) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + decay);
  }

  _throttle(name, ms) {
    const now = performance.now();
    if (now - (this.last[name] || 0) < ms) return false;
    this.last[name] = now;
    return true;
  }

  /** Claim one of the 6 effect voices for `sec` seconds. False when full: the effect is skipped. */
  _claim(sec) {
    if (!this.ok || this.live >= VOICE_CAP) return false;
    this.live++;
    setTimeout(() => {
      this.live = Math.max(0, this.live - 1);
    }, sec * 1000 + 40);
    return true;
  }

  _tone(freq, dur, type = 'sine', peak = 0.2, when = 0, slide = 0, out = this.sfx, attack = 0.006) {
    const c = this.ctx;
    const t = c.currentTime + when;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + dur);
    this._env(g, t, attack, peak, dur);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + attack + dur + 0.05);
  }

  _noise(dur, freq, q = 1, peak = 0.2, type = 'bandpass', when = 0, sweepTo = 0, out = this.sfx, attack = 0.01) {
    const c = this.ctx;
    const t = c.currentTime + when;
    const s = c.createBufferSource();
    s.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    f.Q.value = q;
    const g = c.createGain();
    this._env(g, t, attack, peak, dur);
    s.connect(f).connect(g).connect(out);
    s.start(t, Math.random());
    s.stop(t + attack + dur + 0.1);
  }

  /** Bell: fundamental plus inharmonic partials (from the tiktok-game metallophone). */
  _bell(freq, t, peak, decay = 1.4, out = this.sfx) {
    const c = this.ctx;
    for (const [ratio, amp, dk] of [[1, 1, 1], [2.76, 0.3, 0.5], [5.4, 0.1, 0.25]]) {
      const o = c.createOscillator();
      const g = c.createGain();
      o.frequency.value = freq * ratio;
      this._env(g, t, 0.004, peak * amp, decay * dk);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + decay * dk + 0.1);
    }
  }

  _kick(when, amp = 1) {
    this._tone(150, 0.22, 'sine', 0.42 * amp, when, 0.3);
    this._noise(0.03, 3000, 0.8, 0.07 * amp, 'highpass', when, 0, this.sfx, 0.002);
  }

  _snare(when, amp = 1) {
    this._noise(0.17, 1800, 0.7, 0.14 * amp, 'bandpass', when);
    this._tone(190, 0.1, 'triangle', 0.08 * amp, when);
  }

  /** A choir-like pad: detuned saws through two vowel (formant) filters. */
  _choir(when, dur, notes, peak = 0.05) {
    const c = this.ctx;
    const t = c.currentTime + when;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.35);
    g.gain.setValueAtTime(peak, t + dur * 0.6);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    g.connect(this.sfx);
    const f1 = c.createBiquadFilter();
    const f2 = c.createBiquadFilter();
    f1.type = f2.type = 'bandpass';
    f1.frequency.value = 650;
    f1.Q.value = 5;
    f2.frequency.value = 1150;
    f2.Q.value = 6;
    f1.connect(g);
    f2.connect(g);
    for (const n of notes) {
      for (const det of [-9, 9]) {
        const o = c.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = midi(n);
        o.detune.value = det;
        o.connect(f1);
        o.connect(f2);
        o.start(t);
        o.stop(t + dur + 0.05);
      }
    }
  }

  // ------------------------------------------------------------ music
  _pad(notes, t, dur) {
    const c = this.ctx;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.045, t + dur * 0.3);
    g.gain.setValueAtTime(0.045, t + dur * 0.7);
    g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.6);
    g.connect(this.padFilter);
    for (const n of notes) {
      for (const det of [-7, 7]) {
        const o = c.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = midi(n);
        o.detune.value = det;
        const og = c.createGain();
        og.gain.value = 0.35;
        o.connect(og).connect(g);
        o.start(t);
        o.stop(t + dur + 0.7);
      }
    }
  }

  _pluck(note, t, peak = 0.16, out = this.musicIn, tail = 0.75) {
    const c = this.ctx;
    const o = c.createOscillator();
    const o2 = c.createOscillator();
    const f = c.createBiquadFilter();
    const g = c.createGain();
    o.type = 'triangle';
    o2.type = 'sine';
    o.frequency.value = midi(note);
    o2.frequency.value = midi(note - 12);
    f.type = 'lowpass';
    f.frequency.setValueAtTime(1400, t);
    f.frequency.exponentialRampToValueAtTime(220, t + 0.5);
    this._env(g, t, 0.005, peak, tail);
    o.connect(f);
    o2.connect(f);
    f.connect(g).connect(out);
    o.start(t);
    o2.start(t);
    o.stop(t + tail + 0.15);
    o2.stop(t + tail + 0.15);
  }

  _shaker(t, peak, out = this.musicIn) {
    const c = this.ctx;
    const s = c.createBufferSource();
    s.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 6500;
    const g = c.createGain();
    this._env(g, t, 0.012, peak, 0.06);
    s.connect(f).connect(g).connect(out);
    s.start(t, Math.random());
    s.stop(t + 0.12);
  }

  /** Bell-like arpeggio note for the 3:00 layer. */
  _arp(note, t, peak = 0.045) {
    const c = this.ctx;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = 'sine';
    o.frequency.value = midi(note);
    this._env(g, t, 0.004, peak, 0.5);
    o.connect(g).connect(this.l2);
    o.start(t);
    o.stop(t + 0.6);
  }

  /** Soft low pulse for the 5:00 layer. */
  _thump(t, peak = 0.1) {
    const c = this.ctx;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(90, t);
    o.frequency.exponentialRampToValueAtTime(48, t + 0.18);
    this._env(g, t, 0.006, peak, 0.2);
    o.connect(g).connect(this.l3);
    o.start(t);
    o.stop(t + 0.3);
  }

  /** Round progress "now", extrapolated from the last update. Null when the update is stale. */
  _progress() {
    const tn = this.tn;
    if (!tn || !tn.playing) return null;
    const age = performance.now() - tn.at;
    if (age > 2500) return null;
    return { elapsed: tn.elapsed + age, left: tn.left - age };
  }

  _schedule() {
    this._heartbeat();
    if (!this.ok || !this.wantMusic || this.urlMusicOff || this.musicVol <= 0) return;
    const c = this.ctx;
    const eighth = 30 / BPM;
    const ahead = c.currentTime + 0.4;
    if (this.nextAt < c.currentTime) this.nextAt = c.currentTime + 0.05;
    const prog = this._progress();
    const want2 = !!prog && prog.elapsed >= 180000;
    const want3 = !!prog && prog.elapsed >= 300000;
    if (want2 !== this.l2On) {
      this.l2On = want2;
      this.l2.gain.setTargetAtTime(want2 ? 1 : 0, c.currentTime, 1.6);
    }
    if (want3 !== this.l3On) {
      this.l3On = want3;
      this.l3.gain.setTargetAtTime(want3 ? 1 : 0, c.currentTime, 1.6);
    }
    while (this.nextAt < ahead) {
      const t = this.nextAt;
      const i = this.step % 64; // 8 bars of eighths
      const chord = CHORDS[Math.floor(i / 16)];
      const j = i % 16;
      if (j === 0) this._pad(chord.pad, t, eighth * 16);
      // low pluck: root on 1, fifth on the "and" of 2, root again on 3 (sometimes)
      if (j === 0 || j === 8) this._pluck(chord.root, t, 0.15);
      if (j === 3) this._pluck(chord.root + 7, t, 0.09);
      if (j === 11 && Math.random() < 0.5) this._pluck(chord.root + 12, t, 0.07);
      // faint shaker on eighths, accent on the off-beats
      this._shaker(t, j % 2 ? 0.03 : 0.016);
      // 3:00 layer: a bell arpeggio through the chord, an octave up
      if (this.l2On) this._arp(chord.pad[(j >> 1) % chord.pad.length] + 12, t, j % 4 === 0 ? 0.055 : 0.04);
      // 5:00 layer: a low pulse on the quarter notes and a quicker shaker
      if (this.l3On) {
        if (j % 2 === 0) this._thump(t, j % 4 === 0 ? 0.12 : 0.07);
        this._shaker(t + eighth / 2, 0.02, this.l3);
      }
      this.nextAt += eighth;
      this.step++;
    }
  }

  /** The last 30 seconds: a lub-dub on every timer second, getting stronger. */
  _heartbeat() {
    if (!this._fx('heartbeat')) return;
    const p = this._progress();
    if (!p || p.left > 30000 || p.left <= 400) {
      if (!p) this.hbSec = null;
      return;
    }
    const k = Math.floor(p.left / 1000);
    if (k === this.hbSec) return;
    const delay = (p.left - k * 1000) / 1000; // until the timer shows k
    if (delay > 0.45) return;
    this.hbSec = k;
    this._beat(delay, 1 - p.left / 30000);
  }

  _beat(when, strength = 0.5) {
    if (!this._claim(when + 0.6)) return;
    const peak = 0.16 + 0.2 * clamp01(strength);
    this._tone(62, 0.14, 'sine', peak, when, 0.6);
    this._tone(124, 0.05, 'triangle', peak * 0.3, when);
    this._tone(54, 0.16, 'sine', peak * 0.75, when + 0.17, 0.6);
    this._noise(0.05, 160, 0.8, peak * 0.25, 'lowpass', when);
  }

  /** Drop the music under a big moment, then bring it back. While a voice is speaking it stays down. */
  duck(seconds = 2, depth = 0.3) {
    if (!this.ok) return;
    const g = this.duckNode.gain;
    const t = this.ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setTargetAtTime(depth, t, 0.05);
    if (!this.ttsHold) g.setTargetAtTime(1, t + seconds, 0.6);
  }

  /** Text-to-speech starts: music down about 10 dB until duckEnd(). */
  duckStart(depth = 0.3) {
    this.ttsHold = true;
    if (!this.ok) return;
    const g = this.duckNode.gain;
    const t = this.ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setTargetAtTime(depth, t, 0.06);
  }

  /** Text-to-speech is done: music back over about 400 ms. */
  duckEnd() {
    this.ttsHold = false;
    if (!this.ctx) return;
    const g = this.duckNode.gain;
    const t = this.ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setTargetAtTime(1, t, 0.13);
  }

  // ------------------------------------------------------------ effects
  /** A guess lands: soft tick. In letter-hint mode the pitch rises with warmth (0..1). */
  tick(warmth = 0) {
    if (!this._fx('tick') || !this._throttle('tick', 90) || !this._claim(0.12)) return;
    const f = 520 + clamp01(warmth) * 760;
    this._tone(f, 0.07, 'triangle', 0.11);
    this._tone(f * 2, 0.03, 'sine', 0.03);
  }

  /** Hot guess: warm rising two-note chime. */
  hot() {
    if (!this._fx('hot') || !this._throttle('hot', 500) || !this._claim(0.8)) return;
    this._tone(midi(76), 0.32, 'triangle', 0.12);
    this._tone(midi(81), 0.5, 'triangle', 0.12, 0.11);
    this._tone(midi(88), 0.4, 'sine', 0.03, 0.11);
  }

  /** Cold guess: low short thud. */
  cold() {
    if (!this._fx('cold') || !this._throttle('cold', 300) || !this._claim(0.25)) return;
    this._tone(130, 0.16, 'sine', 0.28, 0, 0.45);
    this._noise(0.08, 400, 0.8, 0.06, 'lowpass');
  }

  /** Tiles turning over: a short click per letter, rising in pitch from the first to the last. */
  flipWord(n = 5, { delay = 0, spacing = 0.07, peak = 0.07 } = {}) {
    const count = Math.max(1, Math.min(14, n | 0));
    if (!this._fx('flip') || !this._throttle('flip', 120) || !this._claim(delay + count * spacing + 0.2)) return;
    for (let i = 0; i < count; i++) {
      const when = delay + i * spacing;
      const f = midi(penta(69, Math.round((count > 1 ? i / (count - 1) : 0.5) * 7)));
      this._tone(f, 0.06, 'triangle', peak, when);
      this._noise(0.025, 4200, 1.2, peak * 0.6, 'highpass', when, 0, this.sfx, 0.002);
    }
  }

  /** A new closest guess: a soft open chord on the pitch of its heat (0..1). */
  best(heat = 0.5) {
    if (!this._fx('best') || !this._throttle('best', 600) || !this._claim(1.2)) return;
    const root = penta(57, Math.round(clamp01(heat) * 7));
    [0, 7, 12].forEach((iv, k) => this._tone(midi(root + iv), 0.9, k === 0 ? 'triangle' : 'sine', 0.05, k * 0.03));
  }

  /** The first near-miss of a round: a quick rising figure and a bell. */
  close() {
    if (!this._fx('close') || !this._claim(1.8)) return;
    this.duck(1.4, 0.55);
    [74, 77, 81].forEach((n, k) => this._tone(midi(n), 0.2, 'triangle', 0.1, k * 0.07));
    this._bell(midi(88), this.ctx.currentTime + 0.24, 0.1, 1.2);
    this._noise(0.5, 3000, 0.7, 0.03, 'highpass', 0.1, 0, this.sfx, 0.1);
  }

  /** The chat is on fire: a riser into a stacked-fifths pulse. */
  hotstreak() {
    if (!this._fx('hotstreak') || !this._claim(1.6)) return;
    this._noise(0.7, 300, 1.4, 0.07, 'bandpass', 0, 6000, this.sfx, 0.45);
    [69, 76, 81, 88, 93].forEach((n, k) => this._tone(midi(n), 0.18, 'triangle', 0.085, 0.1 + k * 0.055));
    this._bell(midi(93), this.ctx.currentTime + 0.45, 0.08, 1.1);
  }

  /** Win: bright four-note fanfare. It grows with the streak: drums and choir at 3, a sub drop at 5. */
  fanfare(streak = 1) {
    if (!this._fx('fanfare') || !this._claim(3.4)) return;
    const s = Math.max(1, streak | 0);
    this.duck(3, 0.25);
    if (s >= 5) {
      // riser into the drop
      this._noise(0.39, 800, 1, 0.06, 'bandpass', 0, 7000, this.sfx, 0.3);
    }
    [72, 76, 79, 84].forEach((n, k) => {
      const last = k === 3;
      this._tone(midi(n), last ? 1.1 : 0.22, 'triangle', 0.16, k * 0.13);
      this._tone(midi(n) * 2, last ? 0.8 : 0.16, 'sine', 0.04, k * 0.13);
      if (last) this._tone(midi(n - 12), 1.1, 'sawtooth', 0.025, k * 0.13);
    });
    this._noise(0.9, 5000, 0.4, 0.035, 'highpass', 0.39);
    if (s === 2) this._bell(midi(96), this.ctx.currentTime + 0.42, 0.06, 1.6);
    if (s >= 3) {
      this._kick(0, 0.9);
      this._snare(0.26, 0.6);
      this._kick(0.39, 1);
      this._snare(0.39, 0.8);
      this._choir(0.39, 1.9, [57, 64, 69, 76]);
    }
    if (s >= 5) {
      this._tone(96, 1.3, 'sine', 0.38, 0.39, 0.3);
      this._noise(1.6, 6000, 0.5, 0.05, 'highpass', 0.39, 0, this.sfx, 0.01);
    }
  }

  /** Last 10 seconds of a round: quiet tick each second. */
  countdown(secondsLeft) {
    if (!this._fx('countdown') || !this._claim(0.06)) return;
    this._tone(secondsLeft <= 3 ? 1320 : 990, 0.04, 'square', secondsLeft <= 3 ? 0.09 : 0.06);
  }

  /** First-letter hint (and the free !hint letter): soft bell. */
  bell() {
    if (!this._fx('bell') || !this._claim(1.5)) return;
    const t = this.ctx.currentTime + 0.02;
    this._bell(midi(81), t, 0.13, 1.6);
  }

  /** The hint gift opens a letter: the same bell, answered a fourth higher. */
  giftBell() {
    if (!this._fx('gift') || !this._throttle('gift', 600) || !this._claim(1.6)) return;
    const t = this.ctx.currentTime + 0.02;
    this._bell(midi(84), t, 0.1, 1.2);
    this._bell(midi(89), t + 0.14, 0.09, 1.4);
  }

  /**
   * Any other gift: its own short chime, always in the music's key. The note and the timbre come
   * from the gift's name, so a Galaxy always sounds like a Galaxy. No name gives a neutral bell.
   * More gifts at once add rising notes and a shimmer.
   */
  giftChime(name = '', count = 1) {
    if (!this._fx('gift') || !this._throttle('giftChime', 450) || !this._claim(1.8)) return;
    const c = this.ctx;
    const t0 = c.currentTime + 0.02;
    const key = String(name || '').trim().toLowerCase();
    if (!key) {
      this._bell(midi(81), t0, 0.09, 1.2);
      return;
    }
    const h = hash(key);
    const deg = 5 + (h % 5);
    const kind = (h >>> 3) % 3;
    const n = Math.max(1, Math.min(30, count | 0));
    const notes = [penta(69, deg)];
    if (n >= 3) notes.push(penta(69, deg + 2));
    if (n >= 6) notes.push(penta(69, deg + 4));
    notes.forEach((note, k) => {
      const t = t0 + k * 0.085;
      if (kind === 0) this._bell(midi(note), t, 0.09, 1.2);
      else if (kind === 1) {
        this._tone(midi(note), 0.7, 'sine', 0.09, t - c.currentTime);
        this._tone(midi(note + 12), 0.5, 'sine', 0.035, t - c.currentTime);
      } else this._tone(midi(note), 0.45, 'triangle', 0.1, t - c.currentTime, 1.03);
    });
    if (n >= 10) this._noise(0.7, 5500, 0.5, 0.03, 'highpass', 0.1, 0, this.sfx, 0.15);
  }

  /** Reveal: a falling sweep, a beat of silence, then a low hit as the letters flip open. */
  revealFall() {
    if (!this._fx('reveal') || !this._claim(2.3)) return;
    this.duck(2.4, 0.35);
    this._tone(660, 0.7, 'triangle', 0.12, 0, 0.18);
    this._noise(0.7, 2200, 1, 0.05, 'bandpass', 0, 200);
    this._tone(98, 0.9, 'sine', 0.3, 1.0, 0.6);
    this._tone(196, 0.5, 'triangle', 0.08, 1.0);
  }

  /**
   * Break: one slow rise across the whole break that lands on A and E, the first and last notes
   * of the round-start chime. `sec` is how long until the next round.
   */
  breakSweep(sec = 2) {
    if (!this._fx('breakSweep')) return;
    this.stopSweep(0.05);
    const c = this.ctx;
    const t = c.currentTime;
    const d = Math.max(1.2, Math.min(Number(sec) || 2, 30));
    const out = c.createGain();
    out.gain.setValueAtTime(0.0001, t);
    out.gain.exponentialRampToValueAtTime(1, t + d * 0.92);
    out.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.3);
    out.connect(this.sfx);
    const stop = t + d + 0.45;
    const s = c.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 2.2;
    f.frequency.setValueAtTime(250, t);
    f.frequency.exponentialRampToValueAtTime(3200, t + d);
    const ng = c.createGain();
    ng.gain.value = 0.06;
    s.connect(f).connect(ng).connect(out);
    s.start(t);
    s.stop(stop);
    const nodes = [s];
    for (const [from, to, peak] of [[110, 440, 0.05], [165, 659, 0.025]]) {
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(from, t);
      o.frequency.exponentialRampToValueAtTime(to, t + d);
      g.gain.value = peak;
      o.connect(g).connect(out);
      o.start(t);
      o.stop(stop);
      nodes.push(o);
    }
    this.sweep = { out };
  }

  /** Fade the break sweep out quickly, e.g. when a skipped round starts early. */
  stopSweep(fade = 0.15) {
    const sw = this.sweep;
    this.sweep = null;
    if (!sw || !this.ctx) return;
    const t = this.ctx.currentTime;
    sw.out.gain.cancelScheduledValues(t);
    sw.out.gain.setTargetAtTime(0.0001, t, Math.max(0.01, fade / 3));
  }

  /** Round start: a short lift into the new word. */
  roundStart() {
    this.stopSweep(0.2);
    if (!this._fx('roundStart') || !this._claim(1.2)) return;
    [69, 72, 76].forEach((n, k) => this._tone(midi(n), 0.4, 'triangle', 0.08, k * 0.08));
  }

  /** A chat command answered on screen: a soft two-note pop. */
  command() {
    if (!this._fx('command') || !this._throttle('command', 300) || !this._claim(0.3)) return;
    this._tone(784, 0.06, 'sine', 0.07);
    this._tone(1175, 0.08, 'sine', 0.06, 0.06);
  }

  /** Control page previews: the layers and heartbeat for a few seconds, as in minute five. */
  previewTension() {
    this._init();
    this.hbSec = null;
    this.wantMusic = true;
    this._applyVolumes();
    this.setTension(true, 305000, 25000);
    clearInterval(this._tnTimer);
    let n = 0;
    this._tnTimer = setInterval(() => {
      n++;
      const base = 305000 + n * 500;
      this.setTension(true, base, 25000 - n * 500);
      if (n >= 16) {
        clearInterval(this._tnTimer);
        this.tn = null;
      }
    }, 500);
  }

  /** Named effects for the control page preview buttons. */
  preview(name) {
    this._init();
    const run = {
      tickCold: () => this.tick(0.1),
      tickHot: () => this.tick(0.9),
      hot: () => this.hot(),
      cold: () => this.cold(),
      flip: () => this.flipWord(6, { spacing: 0.08 }),
      best: () => this.best(0.7),
      close: () => this.close(),
      hotstreak: () => this.hotstreak(),
      giftHint: () => this.giftBell(),
      giftChime: () => this.giftChime('Galaxy', 4),
      bell: () => this.bell(),
      fanfare1: () => this.fanfare(1),
      fanfare3: () => this.fanfare(3),
      fanfare5: () => this.fanfare(5),
      countdown: () => this.countdown(5),
      heartbeat: () => [0, 0.9, 1.8].forEach((w, k) => this._beat(w, 0.3 + k * 0.3)),
      tension: () => this.previewTension(),
      revealFall: () => {
        this.revealFall();
        this.flipWord(5, { delay: 1.02, spacing: 0.07 });
      },
      breakSweep: () => this.breakSweep(5),
      roundStart: () => this.roundStart(),
      command: () => this.command(),
    }[name];
    if (!run) return false;
    // previews skip the throttles and mutes so each click is heard
    this.last = {};
    const muted = this.mutedFx;
    this.mutedFx = new Set();
    try {
      run();
    } finally {
      this.mutedFx = muted;
    }
    return true;
  }
}

/** Preview buttons on the control page: id, and the effect (mute key) it belongs to. */
export const EFFECTS = [
  { id: 'tickCold', fx: 'tick' },
  { id: 'tickHot', fx: 'tick' },
  { id: 'hot', fx: 'hot' },
  { id: 'cold', fx: 'cold' },
  { id: 'flip', fx: 'flip' },
  { id: 'best', fx: 'best' },
  { id: 'close', fx: 'close' },
  { id: 'hotstreak', fx: 'hotstreak' },
  { id: 'giftHint', fx: 'gift' },
  { id: 'giftChime', fx: 'gift' },
  { id: 'bell', fx: 'bell' },
  { id: 'fanfare1', fx: 'fanfare' },
  { id: 'fanfare3', fx: 'fanfare' },
  { id: 'fanfare5', fx: 'fanfare' },
  { id: 'countdown', fx: 'countdown' },
  { id: 'heartbeat', fx: 'heartbeat' },
  { id: 'tension', fx: 'heartbeat' },
  { id: 'revealFall', fx: 'reveal' },
  { id: 'breakSweep', fx: 'breakSweep' },
  { id: 'roundStart', fx: 'roundStart' },
  { id: 'command', fx: 'command' },
];

/** The mute switches: one per effect, in the order they are heard in a round. */
export const FX_GROUPS = ['roundStart', 'tick', 'cold', 'hot', 'flip', 'best', 'close', 'hotstreak', 'command', 'gift', 'bell', 'countdown', 'heartbeat', 'fanfare', 'reveal', 'breakSweep'];
