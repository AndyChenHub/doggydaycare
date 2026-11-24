'use strict';
// =====================================================================================================================
// Paws & Play — sound.js : audio plumbing + every sound effect, all synthesised with the Web Audio API (no audio files).
//
// Public API (globals):
//   audioInit()                 call from any user gesture; creates / resumes the AudioContext and starts the music engine
//   sfx(name, dog)              play a one-shot effect (never throws; silent until audioInit() has run)
//   setVolumes({sfx,music,ambience})   0..1 each, applied smoothly (defaults 0.8 / 0.5 / 0.5)
//   AC, master                  the AudioContext and the master input node (null until audioInit())
//   AU_SFX_NAMES                array of every effect name
// Everything else is private and prefixed AU_.  music.js builds on the helpers in this file.
//
// Signal flow:   voices -> per-effect group -> bus (sfx | music | ambience) -+-> master -> high-pass -> gentle compressor
//                                                   \-> shared room reverb -/            -> make-up trim -> soft clip -> out
// =====================================================================================================================
var AC = null, master = null;
var AU_S = null;                                        // live state: graph nodes, buses, caches (null until set up)
var AU_VOL = { sfx: 0.8, music: 0.5, ambience: 0.5 };   // current volume settings (0..1)
var AU_BUS_K = { sfx: 1.6, music: 2.1, ambience: 1.0 }; // per-bus calibration so the defaults sit at the intended loudness
var AU_COMP_TRIM = 0.715;                                 // undoes the automatic make-up gain of the browser's compressor
var AU_AUTOSTART = true;                                // audioInit() starts Music once

function AU_clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function AU_hz(m) { return 440 * Math.pow(2, (m - 69) / 12); }
function AU_taper(v) { v = AU_clamp(+v || 0, 0, 1); return Math.pow(v, 1.5); }
function AU_rnd(a, b) { return a + Math.random() * (b - a); }
function AU_pick(arr) { return arr[(Math.random() * arr.length) | 0]; }

// ---------------------------------------------------------------------------------------------------------------------
// Graph set-up. Works with any BaseAudioContext (the game uses a live AudioContext; tests use an OfflineAudioContext).
// ---------------------------------------------------------------------------------------------------------------------
function AU_clipCurve() {
  var n = 4097, c = new Float32Array(n), knee = 0.72, top = 0.9;
  for (var i = 0; i < n; i++) {
    var x = i / (n - 1) * 2 - 1, a = Math.abs(x);
    var y = a <= knee ? a : knee + (top - knee) * Math.tanh((a - knee) / (top - knee));
    c[i] = x < 0 ? -y : y;
  }
  return c;
}
function AU_makeNoise(ctx, secs, pink) {
  var n = Math.floor(ctx.sampleRate * secs), b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
  var b0 = 0, b1 = 0, b2 = 0, i, w;
  for (i = 0; i < n; i++) {
    w = Math.random() * 2 - 1;
    if (pink) { b0 = 0.99765 * b0 + w * 0.0990460; b1 = 0.96300 * b1 + w * 0.2965164; b2 = 0.57000 * b2 + w * 1.0526913; d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.22; }
    else d[i] = w;
  }
  if (pink) { var f = Math.floor(ctx.sampleRate * 0.05); for (i = 0; i < f; i++) { var k = i / f; d[i] = d[i] * k + d[n - f + i] * (1 - k); } } // loop-friendly
  return b;
}
// Small warm room: a few early reflections, then a diffuse tail that gets darker as it decays.
function AU_makeIR(ctx, secs, t60) {
  var sr = ctx.sampleRate, n = Math.floor(sr * secs), b = ctx.createBuffer(2, n, sr);
  for (var ch = 0; ch < 2; ch++) {
    var d = b.getChannelData(ch), lp = 0, pre = Math.floor(sr * 0.011), i;
    for (i = pre; i < n; i++) {
      var tt = (i - pre) / sr, env = Math.pow(10, -3 * tt / t60) * Math.min(1, tt / 0.012);
      var a = 0.55 * Math.exp(-tt * 2.6) + 0.10;            // one-pole low-pass that closes over time
      lp += a * ((Math.random() * 2 - 1) - lp);
      d[i] = lp * env;
    }
    var taps = ch ? [0.0137, 0.0229, 0.0371, 0.0533] : [0.0113, 0.0251, 0.0319, 0.0477];
    for (var k = 0; k < taps.length; k++) d[Math.floor(taps[k] * sr)] += (k % 2 ? -0.5 : 0.6) * Math.pow(0.72, k);
    var f = Math.floor(sr * 0.08); for (i = 0; i < f; i++) d[n - 1 - i] *= i / f;
  }
  return b;
}
function AU_setup(ctx, dest) {
  var S = { ctx: ctx, sr: ctx.sampleRate, last: {}, ks: {}, ksOrder: [], keyTr: 0, voices: 0, liveVoices: [], bus: {}, woke: 0 };
  S.out = ctx.createGain(); S.out.gain.value = 1;
  S.hp = ctx.createBiquadFilter(); S.hp.type = 'highpass'; S.hp.frequency.value = 34; S.hp.Q.value = 0.707;
  S.comp = ctx.createDynamicsCompressor();
  S.comp.threshold.value = -12; S.comp.knee.value = 10; S.comp.ratio.value = 3; S.comp.attack.value = 0.006; S.comp.release.value = 0.22;
  S.post = ctx.createGain(); S.post.gain.value = AU_COMP_TRIM;
  S.clip = ctx.createWaveShaper(); S.clip.curve = AU_clipCurve();
  S.out.connect(S.hp); S.hp.connect(S.comp); S.comp.connect(S.post); S.post.connect(S.clip); S.clip.connect(dest || ctx.destination);
  S.rev = ctx.createConvolver(); S.rev.buffer = AU_makeIR(ctx, 1.25, 1.25);
  S.revRet = ctx.createGain(); S.revRet.gain.value = 1.0;
  S.rev.connect(S.revRet); S.revRet.connect(S.out);
  ['sfx', 'music', 'ambience'].forEach(function (k) {
    var g = AU_taper(AU_VOL[k]) * AU_BUS_K[k];
    var dry = ctx.createGain(), wet = ctx.createGain();
    dry.gain.value = g; wet.gain.value = g; dry.connect(S.out); wet.connect(S.rev);
    S.bus[k] = { dry: dry, wet: wet };
  });
  S.noise = AU_makeNoise(ctx, 2.0, false);
  S.pink = AU_makeNoise(ctx, 4.0, true);
  AU_S = S;
  return S;
}

function audioInit() {
  try {
    if (!AC) {
      var Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return;
      AC = new Ctor({ latencyHint: 'interactive' });
      AU_setup(AC, AC.destination);
      master = AU_S.out; AU_S.woke = Date.now();
      AC.onstatechange = function () {
        if (AC && (AC.state === 'suspended' || AC.state === 'interrupted') && typeof document !== 'undefined' && !document.hidden) {
          AU_S.unlocked = false;
        }
      };
    }
    if (AC.state === 'suspended' || AC.state === 'interrupted') {
      AU_S.woke = Date.now();
      var p = AC.resume(); if (p && p.catch) p.catch(function () {});
    }
    if (!AU_S.unlocked && AC) {
      var b = AC.createBuffer(1, 1, 22050), src = AC.createBufferSource();
      src.buffer = b; src.connect(AC.destination);
      if (src.start) src.start(0); else if (src.noteOn) src.noteOn(0);
      if (AC.state === 'running') AU_S.unlocked = true;
    }
    if (AU_AUTOSTART && typeof Music !== 'undefined' && Music && Music.start) { AU_AUTOSTART = false; Music.start(); }
  } catch (e) { /* audio is optional: never break the game */ }
}

function setVolumes(v) {
  try {
    if (!v) return;
    ['sfx', 'music', 'ambience'].forEach(function (k) {
      if (typeof v[k] !== 'number' || !isFinite(v[k])) return;
      AU_VOL[k] = AU_clamp(v[k], 0, 1);
      var S = AU_S; if (!S) return;
      var g = AU_taper(AU_VOL[k]) * AU_BUS_K[k], now = S.ctx.currentTime;
      S.bus[k].dry.gain.setTargetAtTime(g, now, 0.06);
      S.bus[k].wet.gain.setTargetAtTime(g, now, 0.06);
    });
  } catch (e) {}
}

// ---------------------------------------------------------------------------------------------------------------------
// Voice bookkeeping. A "group" is the output of one effect (or one music layer): voices connect to G.node and are
// disconnected again when their source ends, so nothing is left hanging in the graph.
// ---------------------------------------------------------------------------------------------------------------------
function AU_group(S, bus, vol, wet, pan) {
  var ctx = S.ctx, g = ctx.createGain(); g.gain.value = vol;
  var G = { node: g, n: 0, sealed: false, extra: [] }, last = g;
  if (pan) { var p = ctx.createStereoPanner(); p.pan.value = AU_clamp(pan, -1, 1); g.connect(p); last = p; G.extra.push(p); }
  var B = typeof bus === 'string' ? S.bus[bus] : bus;
  last.connect(B.dry);
  if (wet > 0 && B.wet) { var w = ctx.createGain(); w.gain.value = wet; last.connect(w); w.connect(B.wet); G.extra.push(w); }
  return G;
}
function AU_free(G) {
  try { G.node.disconnect(); } catch (e) {}
  for (var i = 0; i < G.extra.length; i++) { try { G.extra[i].disconnect(); } catch (e) {} }
}
function AU_cleanupVoiceEntry(S, entry) {
  if (!entry || entry.done) return;
  entry.done = true;
  try { if (entry.endNode) entry.endNode.disconnect(); } catch (e) {}
  if (entry.extra) {
    for (var i = 0; i < entry.extra.length; i++) {
      try { if (entry.extra[i]) entry.extra[i].disconnect(); } catch (e) {}
    }
  }
  entry.src = null;
  if (entry.G && --entry.G.n <= 0 && entry.G.sealed) AU_free(entry.G);
}
function AU_sweepVoices(S) {
  if (!S || !S.liveVoices) return;
  var now = S.ctx ? S.ctx.currentTime : 0, lv = S.liveVoices;
  for (var i = lv.length - 1; i >= 0; i--) {
    var v = lv[i];
    if (v.done || (v.endT && now > v.endT + 0.25)) {
      if (!v.done) AU_cleanupVoiceEntry(S, v);
      lv.splice(i, 1);
    }
  }
  S.voices = lv.length;
}
function AU_track(S, src, G, endNode, endT, extraNodes) {
  G.n++;
  var entry = {
    src: src,
    G: G,
    endNode: endNode,
    extra: extraNodes || null,
    endT: endT || ((S.ctx ? S.ctx.currentTime : 0) + 3.5),
    done: false
  };
  if (S.liveVoices) {
    S.liveVoices.push(entry);
    S.voices = S.liveVoices.length;
  } else {
    S.voices++;
  }
  src.onended = function () {
    if (entry.done) return;
    AU_cleanupVoiceEntry(S, entry);
    if (S.liveVoices) {
      var idx = S.liveVoices.indexOf(entry);
      if (idx >= 0) S.liveVoices.splice(idx, 1);
      S.voices = S.liveVoices.length;
    } else {
      S.voices = Math.max(0, S.voices - 1);
    }
  };
}

// Envelope: linear attack to o.vol, optional hold, then an exponential fall that reaches -60 dB at t + dur
// (o.k changes the end ratio, o.lin gives a straight line instead).
function AU_env(p, t, o) {
  var a = o.a == null ? 0.004 : o.a, v = Math.max(o.vol, 1e-5), h = o.hold || 0, end = t + Math.max(o.dur, a + h + 0.005);
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(v, t + a);
  if (h > 0) p.setValueAtTime(v, t + a + h);
  if (o.lin) p.linearRampToValueAtTime(0, end);
  else { p.exponentialRampToValueAtTime(Math.max(v * (o.k || 0.001), 1e-6), end); p.linearRampToValueAtTime(0, end + 0.015); }
}
function AU_filter(S, spec, t, dur) {
  var f = S.ctx.createBiquadFilter();
  f.type = spec.type || 'bandpass'; f.Q.value = spec.q == null ? 1 : spec.q;
  f.frequency.setValueAtTime(Math.max(20, spec.f), t);
  if (spec.fp) for (var i = 0; i < spec.fp.length; i++) f.frequency.exponentialRampToValueAtTime(Math.max(20, spec.fp[i][1]), t + spec.fp[i][0]);
  else if (spec.f2) f.frequency.exponentialRampToValueAtTime(Math.max(20, spec.f2), t + (spec.ft || dur));
  return f;
}
// Oscillator voice. o: { t, f, dur, vol, type|wave, a, hold, k, lin, f2, ft, fp:[[dt,f]..], det, vib:{rate,depth,delay}, flt:{...} }
function AU_tone(S, G, o) {
  var ctx = S.ctx, t = o.t, dur = o.dur, osc = ctx.createOscillator(), g = ctx.createGain(), i;
  if (o.wave) osc.setPeriodicWave(o.wave); else osc.type = o.type || 'sine';
  osc.frequency.setValueAtTime(o.f, t);
  if (o.fp) for (i = 0; i < o.fp.length; i++) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.fp[i][1]), t + o.fp[i][0]);
  else if (o.f2) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f2), t + (o.ft || dur));
  if (o.det) osc.detune.value = o.det;
  var lfo = null, extra = null;
  if (o.vib) {
    lfo = ctx.createOscillator(); var lg = ctx.createGain();
    lfo.frequency.value = o.vib.rate; lg.gain.setValueAtTime(0, t);
    lg.gain.setValueAtTime(0, t + (o.vib.delay || 0)); lg.gain.linearRampToValueAtTime(o.vib.depth, t + (o.vib.delay || 0) + (o.vib.ramp || 0.15));
    lfo.connect(lg); lg.connect(osc.detune); lfo.start(t); lfo.stop(t + dur + 0.05);
    extra = [lfo, lg];
  }
  AU_env(g.gain, t, o);
  if (o.flt) { var fl = AU_filter(S, o.flt, t, dur); osc.connect(fl); fl.connect(g); (extra || (extra = [])).push(fl); } else osc.connect(g);
  g.connect(o.to || G.node);
  var stopT = t + dur + 0.04;
  osc.start(t); osc.stop(stopT);
  AU_track(S, osc, G, g, stopT, extra);
  return osc;
}
// Filtered-noise voice. o: { t, dur, vol, a, hold, k, lin, type, f, f2, ft, fp, q, hp, am:{rate,rate2,depth} }
function AU_noise(S, G, o) {
  var ctx = S.ctx, t = o.t, dur = o.dur, src = ctx.createBufferSource(), g = ctx.createGain();
  src.buffer = o.pink ? S.pink : S.noise; src.loop = true;
  var fl = AU_filter(S, o, t, dur), last = fl, extra = [fl];
  src.connect(fl);
  if (o.hp) { var h = ctx.createBiquadFilter(); h.type = 'highpass'; h.frequency.value = o.hp; h.Q.value = 0.6; last.connect(h); last = h; extra.push(h); }
  if (o.lp) { var l = ctx.createBiquadFilter(); l.type = 'lowpass'; l.frequency.value = o.lp; l.Q.value = 0.6; last.connect(l); last = l; extra.push(l); }
  if (o.am) {
    var m = ctx.createGain(), lfo = ctx.createOscillator(), lg = ctx.createGain(), d = AU_clamp(o.am.depth, 0, 1);
    m.gain.value = 1 - d / 2; lg.gain.value = d / 2; lfo.type = o.am.type || 'sine';
    lfo.frequency.setValueAtTime(o.am.rate, t); if (o.am.rate2) lfo.frequency.linearRampToValueAtTime(o.am.rate2, t + dur);
    lfo.connect(lg); lg.connect(m.gain); last.connect(m); last = m; lfo.start(t); lfo.stop(t + dur + 0.05);
    extra.push(m, lfo, lg);
  }
  last.connect(g);
  AU_env(g.gain, t, o);
  g.connect(o.to || G.node);
  var stopT = t + dur + 0.04;
  src.start(t, Math.random() * 1.5); src.stop(stopT);
  AU_track(S, src, G, g, stopT, extra);
  return src;
}

// ---------------------------------------------------------------------------------------------------------------------
// Instruments shared by effects and music
// ---------------------------------------------------------------------------------------------------------------------
// Struck bars / tines: a few (mostly inharmonic) sine partials, each with its own decay, plus a tiny mallet click.
// h: [ratio, level, decay seconds at A4]; ds: how much higher notes ring shorter.
var AU_MAL = {
  kalimba:  { h: [[1, 1, 1.25], [2, 0.10, 0.6], [3, 0.04, 0.3], [6.27, 0.16, 0.10]], click: 0.10, cf: 2600, a: 0.003, ds: 0.45 },
  marimba:  { h: [[1, 1, 0.75], [4, 0.22, 0.16], [9.2, 0.05, 0.05]], click: 0.06, cf: 1400, a: 0.004, ds: 0.5 },
  glock:    { h: [[1, 1, 1.5], [2.756, 0.30, 0.55], [5.404, 0.10, 0.16]], click: 0.05, cf: 5200, a: 0.002, ds: 0.3 },
  musicbox: { h: [[1, 1, 1.7], [2, 0.16, 0.9], [6.27, 0.22, 0.22], [12.2, 0.03, 0.05]], click: 0.05, cf: 4200, a: 0.002, ds: 0.4 },
  bell:     { h: [[1, 1, 1.7], [1.004, 0.5, 1.5], [2.62, 0.7, 0.9], [4.91, 0.36, 0.4], [7.7, 0.12, 0.16]], click: 0.18, cf: 5200, a: 0.0015, ds: 0.2 },
  chime:    { h: [[1, 1, 0.9], [2.41, 0.45, 0.5], [3.9, 0.2, 0.22]], click: 0.08, cf: 4800, a: 0.002, ds: 0.25 },
  wood:     { h: [[1, 1, 0.09], [2.7, 0.35, 0.05], [5.2, 0.12, 0.025]], click: 0.30, cf: 1800, a: 0.002, ds: 0.2 },
  coin:     { h: [[1, 1, 0.55], [2.32, 0.45, 0.30], [3.86, 0.28, 0.16], [5.9, 0.12, 0.07]], click: 0.14, cf: 6000, a: 0.0015, ds: 0.2 }
};
function AU_mallet(S, G, t, f, vel, preset, len, to) {
  var p = typeof preset === 'string' ? AU_MAL[preset] : preset;
  var dk = AU_clamp(Math.pow(440 / f, p.ds || 0.35), 0.3, 2.2) * (len || 1);
  for (var i = 0; i < p.h.length; i++) {
    var fr = f * p.h[i][0]; if (fr > 15000) continue;
    AU_tone(S, G, { t: t, f: fr, vol: vel * p.h[i][1], a: p.a || 0.003, dur: Math.max(0.03, p.h[i][2] * dk), to: to });
  }
  if (p.click) AU_noise(S, G, { t: t, dur: 0.018, vol: vel * p.click, f: p.cf || 2500, q: 0.9, a: 0.001, to: to });
}

// Plucked string (Karplus-Strong), rendered once per semitone into a buffer and cached; exact pitch via playbackRate.
var AU_KS = {
  guitar: { t60: 2.6, s: 0.5, exc: 0.22, pick: 0.18, max: 2.6 },   // nylon string: mellow
  harp:   { t60: 3.4, s: 0.42, exc: 0.32, pick: 0.38, max: 3.0 },   // rounder, longer
  uke:    { t60: 1.4, s: 0.5, exc: 0.42, pick: 0.22, max: 1.5 }    // short and perky (jingles)
};
function AU_ksGet(S, m, name) {
  var key = name + m, e = S.ks[key];
  if (e) return e;
  var p = AU_KS[name], sr = S.sr, f = AU_hz(m);
  var s = p.s * Math.min(1, Math.sqrt(330 / f));                  // less averaging for high notes so they keep some sustain
  var N = Math.max(2, Math.round(sr / f - s)), trueF = sr / (N + s);
  var t60 = AU_clamp(p.t60 * Math.pow(196 / f, 0.45), 0.5, p.max + 0.6);
  var secs = Math.min(p.max, t60 * 1.1), len = Math.floor(secs * sr);
  var rho = Math.pow(10, -3 / (trueF * t60));
  var line = new Float32Array(N), i, lp = 0, mean = 0;
  for (i = 0; i < N; i++) { lp += p.exc * ((Math.random() * 2 - 1) - lp); line[i] = lp; mean += lp; }
  mean /= N;
  var pk = Math.max(1, Math.round(p.pick * N)), ex = new Float32Array(N);
  for (i = 0; i < N; i++) ex[i] = (line[i] - mean) - (line[(i + N - pk) % N] - mean);     // pick-position comb
  for (i = 0; i < N; i++) line[i] = ex[i];
  var buf = S.ctx.createBuffer(1, len, sr), d = buf.getChannelData(0), idx = 0, peak = 0;
  for (i = 0; i < len; i++) {
    var cur = line[idx], nx = line[idx + 1 < N ? idx + 1 : 0];
    d[i] = cur; if (cur > peak) peak = cur; else if (-cur > peak) peak = -cur;
    line[idx] = rho * ((1 - s) * cur + s * nx);
    idx = idx + 1 < N ? idx + 1 : 0;
  }
  // level by the body of the note (20-120 ms), and round off the pick transient so plucks are not all peak
  var r0 = Math.floor(sr * 0.02), r1 = Math.min(len, Math.floor(sr * 0.12)), sq = 0;
  for (i = r0; i < r1; i++) sq += d[i] * d[i];
  var body = Math.sqrt(sq / Math.max(1, r1 - r0)), g = body > 1e-6 ? 0.25 / body : (peak > 0 ? 1 / peak : 1), att = Math.floor(sr * 0.0015), fade = Math.floor(sr * 0.05);
  for (i = 0; i < len; i++) d[i] = 0.8 * Math.tanh(d[i] * g / 0.8);
  for (i = 0; i < att; i++) d[i] *= i / att;
  for (i = 0; i < fade; i++) d[len - 1 - i] *= i / fade;
  e = { b: buf, f: trueF };
  S.ks[key] = e; S.ksOrder.push(key);
  if (S.ksOrder.length > 96) delete S.ks[S.ksOrder.shift()];      // bound the cache
  return e;
}
function AU_pluck(S, G, t, midi, vel, dur, name, to) {
  var ctx = S.ctx, e = AU_ksGet(S, Math.round(midi), name || 'guitar');
  var src = ctx.createBufferSource(), g = ctx.createGain(), lp = ctx.createBiquadFilter();
  src.buffer = e.b; src.playbackRate.value = AU_hz(midi) / e.f;
  lp.type = 'lowpass'; lp.Q.value = 0.5; lp.frequency.value = 800 + 4200 * AU_clamp(vel, 0, 1) + AU_hz(midi) * 1.2;
  g.gain.setValueAtTime(vel, t);
  var end = t + e.b.duration;
  if (dur && t + dur + 0.4 < end) { g.gain.setValueAtTime(vel, t + dur); g.gain.setTargetAtTime(0, t + dur, 0.07); end = t + dur + 0.45; }
  src.connect(lp); lp.connect(g); g.connect(to || G.node);
  src.start(t); src.stop(end);
  AU_track(S, src, G, g, end, [lp]);
}

// ---------------------------------------------------------------------------------------------------------------------
// Dog voices
// ---------------------------------------------------------------------------------------------------------------------
function AU_dogSize(dog) {            // 0 = tiny (20 cm at the shoulder) ... 1 = giant (66 cm)
  var cm = 42;
  try {
    if (dog) {
      if (typeof dog.cm === 'number') cm = dog.cm;
      else if (typeof BREED_BY_ID !== 'undefined' && BREED_BY_ID[dog.breed] && BREED_BY_ID[dog.breed].cm) cm = BREED_BY_ID[dog.breed].cm;
    }
  } catch (e) {}
  return AU_clamp((cm - 20) / 46, 0, 1);
}
function AU_dogVoice(dog) {           // each dog keeps its own slightly higher / lower voice (stable per id or name)
  var key = dog ? (dog.id != null ? dog.id : dog.name) : null;
  if (key == null) return 1;
  var s = String(key), h = 7;
  for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 9973;
  return 0.93 + (h % 100) / 100 * 0.14;
}
// One bark: a buzzy source with a fast rise-and-fall in pitch, shaped by two "mouth" resonances, plus a little breath.
function AU_bark1(S, G, t, s, vol, pm, lm) {
  var ctx = S.ctx;
  var f0 = 760 * Math.pow(0.24, s) * pm;                 // about 760 Hz (toy breeds) down to about 180 Hz (giants)
  var dur = (0.075 + 0.125 * s) * (lm || 1);
  var F1 = 1900 * Math.pow(0.37, s), F2 = F1 * 2.3;
  var env = ctx.createGain(), at = 0.007 + 0.008 * s;
  env.gain.setValueAtTime(0, t); env.gain.linearRampToValueAtTime(vol, t + at);
  env.gain.setValueAtTime(vol, t + dur * 0.38); env.gain.exponentialRampToValueAtTime(vol * 0.012, t + dur); env.gain.linearRampToValueAtTime(0, t + dur + 0.02);
  var o1 = ctx.createOscillator(), o2 = ctx.createOscillator(), g2 = ctx.createGain(), mix = ctx.createGain();
  o1.type = 'sawtooth'; o2.type = 'square';
  [[o1, 1], [o2, 0.5]].forEach(function (p) {
    var fr = p[0].frequency, f = f0 * p[1];
    fr.setValueAtTime(f * 0.74, t); fr.exponentialRampToValueAtTime(f * 1.12, t + dur * 0.2); fr.exponentialRampToValueAtTime(f * 0.58, t + dur);
  });
  g2.gain.value = 0.10 + 0.14 * s; mix.gain.value = 1;
  o1.connect(mix); o2.connect(g2); g2.connect(mix);
  var b1 = ctx.createBiquadFilter(), b2 = ctx.createBiquadFilter(), lp = ctx.createBiquadFilter(), gb2 = ctx.createGain(), glp = ctx.createGain();
  b1.type = 'bandpass'; b1.frequency.setValueAtTime(F1 * 0.8, t); b1.frequency.linearRampToValueAtTime(F1 * 1.15, t + dur * 0.3); b1.frequency.linearRampToValueAtTime(F1 * 0.75, t + dur); b1.Q.value = 2.4;
  b2.type = 'bandpass'; b2.frequency.value = F2; b2.Q.value = 3.2; gb2.gain.value = 0.5;
  lp.type = 'lowpass'; lp.frequency.value = Math.max(320, f0 * 2.4); lp.Q.value = 0.7; glp.gain.value = 0.16 + 0.08 * s;
  mix.connect(b1); mix.connect(b2); mix.connect(lp); b1.connect(env); b2.connect(gb2); gb2.connect(env); lp.connect(glp); glp.connect(env);
  env.connect(G.node);
  var stopT = t + dur + 0.04;
  o1.start(t); o2.start(t); o1.stop(stopT); o2.stop(stopT);
  AU_track(S, o1, G, env, stopT, [o2, g2, mix, b1, b2, lp, gb2, glp]);
  AU_noise(S, G, { t: t, dur: dur * 0.85, vol: vol * (0.30 + 0.25 * s), f: F1 * 1.35, q: 0.8, a: 0.004, lp: 5200 });
}
// Round water "bloop".
function AU_bloop(S, G, t, f, vol, dur) {
  AU_tone(S, G, { t: t, f: f, f2: f * AU_rnd(1.5, 1.9), ft: (dur || 0.07) * 0.8, dur: dur || 0.07, vol: vol, a: 0.004 });
}
// Tiny glittery tail used by the happy jingles.
function AU_glitter(S, G, t, n, vol, spread) {
  var notes = [88, 91, 93, 96, 98, 100, 103];
  for (var i = 0; i < n; i++) AU_mallet(S, G, t + i * (spread || 0.05) + AU_rnd(0, 0.012), AU_hz(AU_pick(notes) + S.keyTr), vol * AU_rnd(0.6, 1), 'glock', 0.5);
}
function AU_thud(S, G, t, f, vol, dur) {     // soft wooden / felt thump
  AU_tone(S, G, { t: t, f: f * 1.5, f2: f, ft: 0.04, dur: dur || 0.1, vol: vol, a: 0.003 });
  AU_noise(S, G, { t: t, dur: 0.035, vol: vol * 0.5, type: 'lowpass', f: f * 5, q: 0.7, a: 0.002 });
}
function AU_strum(S, G, t, midis, vel, gap, name) {
  for (var i = 0; i < midis.length; i++) AU_pluck(S, G, t + i * gap, midis[i] + S.keyTr, vel * (0.85 + 0.15 * i / midis.length), 0, name || 'guitar');
}

// ---------------------------------------------------------------------------------------------------------------------
// The effects.  Each entry: v = level, wet = reverb send, min = shortest gap between repeats (s), duck = [music level, seconds]
// for jingles that should dip the soundtrack, fn(S, G, t, dog).
// Melodic jingles are written in C and follow the key of the music that is playing (S.keyTr, set by music.js).
// ---------------------------------------------------------------------------------------------------------------------
var AU_SFX = {
  // ---- money ----
  coin: { v: 0.30, wet: 0.22, fn: function (S, G, t) {
    var k = S.keyTr; AU_mallet(S, G, t, AU_hz(83 + k), 0.8, 'coin', 0.8); AU_mallet(S, G, t + 0.075, AU_hz(88 + k), 1, 'coin', 1.5);
    AU_mallet(S, G, t + 0.075, AU_hz(88 + k), 0.5, 'glock', 0.9);
  } },
  coin_big: { v: 0.30, wet: 0.28, duck: [0.65, 0.8], fn: function (S, G, t) {
    var k = S.keyTr, seq = [83, 88, 92, 95, 100];
    for (var i = 0; i < seq.length; i++) { AU_mallet(S, G, t + i * 0.07, AU_hz(seq[i] + k), 0.75 + i * 0.05, 'coin', 1 + i * 0.25); AU_mallet(S, G, t + i * 0.07, AU_hz(seq[i] + k), 0.4, 'glock', 0.8); }
    for (var j = 0; j < 7; j++) AU_mallet(S, G, t + 0.3 + j * 0.055 + AU_rnd(0, 0.03), AU_rnd(3200, 6200), AU_rnd(0.12, 0.25), 'coin', 0.35);
    AU_glitter(S, G, t + 0.38, 5, 0.22, 0.06);
  } },
  tick: { v: 0.16, wet: 0.15, min: 0.045, fn: function (S, G, t) {
    AU_mallet(S, G, t, AU_hz(AU_pick([84, 86, 88, 91, 93]) + S.keyTr), 1, 'kalimba', 0.25);
  } },
  register: { v: 0.34, wet: 0.2, duck: [0.7, 0.8], fn: function (S, G, t) {
    AU_thud(S, G, t, 210, 0.7, 0.06); AU_noise(S, G, { t: t, dur: 0.03, vol: 0.5, f: 1300, q: 1.2, a: 0.001 });
    AU_thud(S, G, t + 0.075, 180, 0.6, 0.06); AU_noise(S, G, { t: t + 0.075, dur: 0.03, vol: 0.45, f: 1700, q: 1.2, a: 0.001 });
    for (var r = 0; r < 4; r++) AU_noise(S, G, { t: t + 0.14 + r * 0.018, dur: 0.014, vol: 0.3, f: 2600, q: 2, a: 0.001 });   // ratchet
    var k = S.keyTr;
    AU_mallet(S, G, t + 0.22, AU_hz(96 + k), 0.75, 'bell', 0.7); AU_mallet(S, G, t + 0.225, AU_hz(100 + k), 0.5, 'bell', 0.6);   // cha-CHING
    AU_noise(S, G, { t: t + 0.30, dur: 0.2, vol: 0.32, f: 420, f2: 950, q: 1.1, a: 0.05, k: 0.05 });                            // drawer slides
    AU_thud(S, G, t + 0.47, 120, 0.9, 0.12);                                                                                    // drawer stops
    for (var j = 0; j < 6; j++) AU_mallet(S, G, t + 0.48 + j * 0.035 + AU_rnd(0, 0.02), AU_rnd(3000, 6000), AU_rnd(0.1, 0.22), 'coin', 0.3);
  } },
  buy: { v: 0.30, wet: 0.22, fn: function (S, G, t) {
    var k = S.keyTr; AU_thud(S, G, t, 170, 0.6, 0.09);
    AU_mallet(S, G, t + 0.04, AU_hz(79 + k), 0.7, 'kalimba', 0.6); AU_mallet(S, G, t + 0.12, AU_hz(84 + k), 0.8, 'kalimba', 0.8);
    AU_mallet(S, G, t + 0.20, AU_hz(88 + k), 0.9, 'coin', 1.3); AU_mallet(S, G, t + 0.20, AU_hz(88 + k), 0.5, 'glock', 1);
    AU_glitter(S, G, t + 0.27, 3, 0.18, 0.05);
  } },
  sell: { v: 0.30, wet: 0.22, fn: function (S, G, t) {
    var k = S.keyTr; AU_mallet(S, G, t, AU_hz(88 + k), 0.8, 'coin', 0.9); AU_mallet(S, G, t + 0.08, AU_hz(84 + k), 0.8, 'coin', 0.9);
    AU_mallet(S, G, t + 0.16, AU_hz(79 + k), 0.85, 'kalimba', 0.9); AU_thud(S, G, t + 0.24, 150, 0.55, 0.1);
    for (var j = 0; j < 4; j++) AU_mallet(S, G, t + 0.26 + j * 0.04, AU_rnd(3200, 5600), AU_rnd(0.1, 0.2), 'coin', 0.3);
  } },
  // ---- feedback jingles ----
  perfect: { v: 0.28, wet: 0.3, duck: [0.62, 0.8], fn: function (S, G, t) {
    var k = S.keyTr, seq = [79, 83, 86, 91];
    for (var i = 0; i < 4; i++) { AU_mallet(S, G, t + i * 0.065, AU_hz(seq[i] + k), 0.8, 'kalimba', 0.9); AU_pluck(S, G, t + i * 0.065, seq[i] - 12 + k, 0.5, 0, 'uke'); }
    AU_mallet(S, G, t + 0.26, AU_hz(95 + k), 0.55, 'glock', 1.1); AU_mallet(S, G, t + 0.26, AU_hz(91 + k), 0.5, 'glock', 1.1);
    AU_glitter(S, G, t + 0.3, 6, 0.25, 0.05);
  } },
  ding: { v: 0.27, wet: 0.3, fn: function (S, G, t) {
    var k = S.keyTr; AU_mallet(S, G, t, AU_hz(84 + k), 0.85, 'glock', 1); AU_mallet(S, G, t + 0.1, AU_hz(91 + k), 0.8, 'glock', 1.3);
    AU_mallet(S, G, t, AU_hz(72 + k), 0.4, 'kalimba', 1);
  } },
  goal: { v: 0.28, wet: 0.3, duck: [0.6, 0.9], fn: function (S, G, t) {
    var k = S.keyTr, seq = [79, 84, 88];
    for (var i = 0; i < 3; i++) { AU_mallet(S, G, t + i * 0.09, AU_hz(seq[i] + k), 0.8, 'kalimba', 0.8); AU_pluck(S, G, t + i * 0.09, seq[i] - 12 + k, 0.55, 0, 'uke'); }
    AU_mallet(S, G, t + 0.30, AU_hz(91 + k), 1, 'kalimba', 1.5); AU_mallet(S, G, t + 0.30, AU_hz(91 + k), 0.45, 'glock', 1.3);
    AU_pluck(S, G, t + 0.30, 72 + k, 0.55, 0, 'guitar'); AU_pluck(S, G, t + 0.30, 60 + k, 0.5, 0, 'guitar');
    AU_glitter(S, G, t + 0.4, 3, 0.18, 0.07);
  } },
  level: { v: 0.3, wet: 0.32, duck: [0.45, 1.6], fn: function (S, G, t) {
    var k = S.keyTr, seq = [67, 72, 76, 79, 84], i;
    for (i = 0; i < seq.length; i++) { AU_pluck(S, G, t + i * 0.075, seq[i] + k, 0.7, 0, 'guitar'); AU_mallet(S, G, t + i * 0.075, AU_hz(seq[i] + 12 + k), 0.55, 'kalimba', 0.8); }
    var t2 = t + 0.46;
    AU_strum(S, G, t2, [48, 55, 64, 72], 0.7, 0.018, 'guitar');
    [84, 88, 91].forEach(function (m, j) { AU_mallet(S, G, t2 + j * 0.02, AU_hz(m + k), 0.6, 'glock', 1.5); });
    [72, 76, 79].forEach(function (m) { AU_tone(S, G, { t: t2, f: AU_hz(m + k), vol: 0.16, a: 0.12, hold: 0.35, dur: 1.1, type: 'triangle' }); });
    AU_mallet(S, G, t2 + 0.22, AU_hz(96 + k), 0.5, 'glock', 1.6);
    AU_glitter(S, G, t2 + 0.1, 8, 0.24, 0.06);
  } },
  new_breed: { v: 0.31, wet: 0.34, duck: [0.45, 2.2], fn: function (S, G, t) {
    var k = S.keyTr, seq = [[72, 0], [76, 0.09], [79, 0.18], [84, 0.30], [83, 0.48], [84, 0.57], [88, 0.66], [91, 0.80]];
    seq.forEach(function (n) { AU_mallet(S, G, t + n[1], AU_hz(n[0] + k), 0.75, 'kalimba', 0.9); AU_pluck(S, G, t + n[1], n[0] - 12 + k, 0.55, 0, 'uke'); });
    var t2 = t + 0.98;
    AU_strum(S, G, t2, [48, 55, 60, 64, 72], 0.7, 0.022, 'harp');
    [84, 88, 91, 96].forEach(function (m, j) { AU_mallet(S, G, t2 + j * 0.03, AU_hz(m + k), 0.55, 'glock', 1.7); });
    [72, 76, 79].forEach(function (m) { AU_tone(S, G, { t: t2, f: AU_hz(m + k), vol: 0.15, a: 0.1, hold: 0.45, dur: 1.3, type: 'triangle' }); });
    AU_glitter(S, G, t2 + 0.08, 10, 0.24, 0.07);
  } },
  day_start: { v: 0.27, wet: 0.32, duck: [0.4, 1.9], fn: function (S, G, t) {
    var k = S.keyTr, mel = [[67, 0], [72, 0.17], [76, 0.34], [79, 0.51], [81, 0.68], [79, 1.02]];
    AU_strum(S, G, t, [48, 55, 60, 64], 0.7, 0.03, 'guitar');
    mel.forEach(function (n) { AU_mallet(S, G, t + n[1], AU_hz(n[0] + k), 0.8, 'kalimba', n[1] > 0.9 ? 1.6 : 0.9); });
    AU_strum(S, G, t + 0.68, [53, 60, 65, 69], 0.55, 0.03, 'guitar');
    AU_strum(S, G, t + 1.02, [48, 55, 64, 67, 72], 0.7, 0.035, 'guitar');
    AU_mallet(S, G, t + 1.02, AU_hz(91 + k), 0.4, 'glock', 1.4); AU_mallet(S, G, t + 1.19, AU_hz(96 + k), 0.35, 'glock', 1.4);
    AU_glitter(S, G, t + 1.3, 4, 0.15, 0.09);
  } },
  day_end: { v: 0.36, wet: 0.4, duck: [0.35, 3.2], fn: function (S, G, t) {
    var k = S.keyTr, mel = [[88, 0], [86, 0.36], [84, 0.72], [79, 1.08], [81, 1.44], [84, 1.8]];
    AU_strum(S, G, t, [53, 60, 65, 69], 0.5, 0.05, 'harp');
    mel.forEach(function (n) { AU_mallet(S, G, t + n[1], AU_hz(n[0] + k), 0.7, 'musicbox', n[1] > 1.7 ? 1.5 : 0.9); });
    AU_strum(S, G, t + 1.08, [55, 59, 62, 67], 0.45, 0.05, 'harp');
    AU_strum(S, G, t + 1.8, [48, 55, 60, 64, 67], 0.55, 0.07, 'harp');
    [60, 64, 67].forEach(function (m) { AU_tone(S, G, { t: t + 1.8, f: AU_hz(m + k), vol: 0.09, a: 0.3, hold: 0.6, dur: 2.0, type: 'triangle' }); });
  } },
  built: { v: 0.28, wet: 0.28, duck: [0.6, 1], fn: function (S, G, t) {
    var k = S.keyTr;
    AU_mallet(S, G, t, 520, 0.9, 'wood', 1); AU_thud(S, G, t, 160, 0.5, 0.07);
    AU_mallet(S, G, t + 0.1, 560, 0.8, 'wood', 1); AU_thud(S, G, t + 0.1, 170, 0.45, 0.07);
    [72, 76, 79, 84].forEach(function (m, i) { AU_mallet(S, G, t + 0.22 + i * 0.075, AU_hz(m + k), 0.8, 'marimba', 1.1); AU_mallet(S, G, t + 0.22 + i * 0.075, AU_hz(m + 12 + k), 0.4, 'kalimba', 0.8); });
    AU_mallet(S, G, t + 0.53, AU_hz(88 + k), 0.55, 'glock', 1.3); AU_mallet(S, G, t + 0.53, AU_hz(91 + k), 0.5, 'glock', 1.3);
    AU_glitter(S, G, t + 0.58, 5, 0.2, 0.06);
  } },
  bad: { v: 0.34, wet: 0.15, fn: function (S, G, t) {
    AU_mallet(S, G, t, AU_hz(65), 1, 'marimba', 0.8); AU_mallet(S, G, t + 0.15, AU_hz(59), 1, 'marimba', 1.1);
    AU_thud(S, G, t, 110, 0.35, 0.08); AU_thud(S, G, t + 0.15, 95, 0.4, 0.1);
  } },
  error: { v: 0.24, wet: 0.12, fn: function (S, G, t) {
    AU_mallet(S, G, t, AU_hz(62), 1, 'marimba', 0.45); AU_mallet(S, G, t + 0.11, AU_hz(62), 0.8, 'marimba', 0.5);
  } },
  complaint: { v: 0.42, wet: 0.2, duck: [0.6, 0.9], fn: function (S, G, t) {
    [[64, 0, 0.3], [60.0, 0.34, 0.62]].forEach(function (n, i) {
      var f = AU_hz(n[0]), tt = t + n[1], d = n[2];
      var flt = { type: 'bandpass', f: 420, fp: [[0.09, 1500], [d, 520]], q: 2.2 };
      AU_tone(S, G, { t: tt, f: f, fp: [[d * 0.35, f], [d, f * (i ? 0.89 : 0.97)]], type: 'sawtooth', vol: 0.9, a: 0.03, hold: d * 0.55, dur: d, k: 0.05, flt: flt, vib: i ? { rate: 5.5, depth: 28, delay: 0.2 } : null });
      AU_tone(S, G, { t: tt, f: f, fp: [[d * 0.35, f], [d, f * (i ? 0.89 : 0.97)]], type: 'triangle', vol: 0.22, a: 0.03, hold: d * 0.55, dur: d, k: 0.05 });
    });
  } },
  // ---- interface ----
  click: { v: 0.3, wet: 0.08, min: 0.03, fn: function (S, G, t) { AU_mallet(S, G, t, AU_rnd(880, 940), 1, 'wood', 0.8); } },
  ui_hover: { v: 0.07, wet: 0.05, min: 0.05, fn: function (S, G, t) { AU_tone(S, G, { t: t, f: 1250, f2: 1400, dur: 0.045, vol: 1, a: 0.004 }); } },
  ui_open: { v: 0.2, wet: 0.2, fn: function (S, G, t) {
    var k = S.keyTr; AU_mallet(S, G, t, AU_hz(74 + k), 0.8, 'kalimba', 0.5); AU_mallet(S, G, t + 0.07, AU_hz(81 + k), 0.9, 'kalimba', 0.7);
    AU_noise(S, G, { t: t, dur: 0.16, vol: 0.22, f: 1200, f2: 3200, q: 1, a: 0.06, k: 0.05 });
  } },
  ui_close: { v: 0.2, wet: 0.2, fn: function (S, G, t) {
    var k = S.keyTr; AU_mallet(S, G, t, AU_hz(81 + k), 0.8, 'kalimba', 0.5); AU_mallet(S, G, t + 0.07, AU_hz(74 + k), 0.85, 'kalimba', 0.6);
    AU_noise(S, G, { t: t, dur: 0.15, vol: 0.2, f: 3000, f2: 1100, q: 1, a: 0.03, k: 0.05 });
  } },
  page: { v: 0.4, wet: 0.12, fn: function (S, G, t) {
    AU_noise(S, G, { t: t, dur: 0.17, vol: 0.6, f: 900, fp: [[0.12, 3600], [0.17, 2400]], q: 0.8, a: 0.07, k: 0.08, hp: 500 });
    AU_noise(S, G, { t: t + 0.15, dur: 0.09, vol: 0.75, type: 'highpass', f: 2200, q: 0.5, a: 0.006, lp: 7000 });
    for (var i = 0; i < 5; i++) AU_noise(S, G, { t: t + AU_rnd(0.02, 0.2), dur: 0.012, vol: AU_rnd(0.2, 0.45), f: AU_rnd(2500, 5000), q: 2, a: 0.001 });
  } },
  pop: { v: 0.44, wet: 0.12, min: 0.04, fn: function (S, G, t) {
    var pf = AU_rnd(0.94, 1.07); AU_tone(S, G, { t: t, f: 360 * pf, f2: 900 * pf, ft: 0.055, dur: 0.1, vol: 1, a: 0.004 });
    AU_noise(S, G, { t: t, dur: 0.012, vol: 0.25, f: 3000, q: 1, a: 0.001 });
  } },
  sparkle: { v: 0.2, wet: 0.35, fn: function (S, G, t) { AU_glitter(S, G, t, 7, 0.8, 0.045); } },
  whoosh: { v: 0.5, wet: 0.15, fn: function (S, G, t) {
    AU_noise(S, G, { t: t, dur: 0.4, vol: 1, f: 380, fp: [[0.18, 2100], [0.4, 520]], q: 1.3, a: 0.16, k: 0.03 });
  } },
  place: { v: 0.36, wet: 0.14, fn: function (S, G, t) {
    AU_thud(S, G, t, 115, 1, 0.13); AU_mallet(S, G, t, 330, 0.6, 'wood', 1.2);
    AU_noise(S, G, { t: t + 0.01, dur: 0.16, vol: 0.18, type: 'lowpass', f: 1800, f2: 500, q: 0.5, a: 0.02 });
  } },
  // ---- the shop ----
  bell: { v: 0.3, wet: 0.35, fn: function (S, G, t) {
    AU_thud(S, G, t, 230, 0.3, 0.04);
    AU_mallet(S, G, t + 0.012, AU_hz(86.3), 1, 'bell', 1);
  } },
  door: { v: 0.26, wet: 0.3, fn: function (S, G, t) {
    AU_thud(S, G, t, 130, 0.55, 0.1);
    AU_noise(S, G, { t: t, dur: 0.12, vol: 0.12, f: 600, f2: 900, q: 3, a: 0.04, k: 0.05 });
    [[0.06, 1], [0.19, 0.6], [0.29, 0.42], [0.42, 0.22]].forEach(function (b, i) { AU_mallet(S, G, t + b[0], AU_hz(i % 2 ? 90.1 : 89.9), b[1], 'chime', 1.2); });
    AU_mallet(S, G, t + 0.075, AU_hz(94), 0.45, 'chime', 1.1);
  } },
  leash: { v: 0.28, wet: 0.12, fn: function (S, G, t) {
    AU_noise(S, G, { t: t, dur: 0.012, vol: 0.8, type: 'highpass', f: 2800, q: 0.7, a: 0.001 }); AU_mallet(S, G, t, 2350, 0.5, 'coin', 0.25);
    AU_noise(S, G, { t: t + 0.065, dur: 0.014, vol: 0.9, type: 'highpass', f: 2400, q: 0.7, a: 0.001 }); AU_mallet(S, G, t + 0.065, 3050, 0.6, 'coin', 0.35);
    AU_mallet(S, G, t + 0.12, 4100, 0.2, 'coin', 0.4);
  } },
  trash: { v: 0.38, wet: 0.15, fn: function (S, G, t) {
    AU_noise(S, G, { t: t, dur: 0.16, vol: 0.5, type: 'highpass', f: 2200, q: 0.5, a: 0.02, lp: 6500, am: { rate: 38, depth: 0.7, type: 'square' } });
    [[312, 1, 0.2], [538, 0.7, 0.16], [871, 0.5, 0.12], [1310, 0.3, 0.08]].forEach(function (p) { AU_tone(S, G, { t: t + 0.13, f: p[0], vol: 0.35 * p[1], dur: p[2], a: 0.002, type: 'triangle' }); });
    AU_thud(S, G, t + 0.13, 140, 0.6, 0.09);
  } },
  // ---- care ----
  pet: { v: 0.28, wet: 0.2, fn: function (S, G, t, dog) {
    var s = AU_dogSize(dog), m = Math.round(6 - 10 * s) + S.keyTr;
    AU_noise(S, G, { t: t, dur: 0.13, vol: 0.4, f: 1900, f2: 2700, q: 0.7, a: 0.05, k: 0.05 });
    AU_noise(S, G, { t: t + 0.15, dur: 0.13, vol: 0.35, f: 2300, f2: 1700, q: 0.7, a: 0.05, k: 0.05 });
    AU_mallet(S, G, t + 0.03, AU_hz(76 + m), 0.8, 'kalimba', 0.6); AU_mallet(S, G, t + 0.16, AU_hz(81 + m), 0.9, 'kalimba', 0.9);
  } },
  munch: { v: 0.6, wet: 0.08, fn: function (S, G, t) {
    var tt = t;
    for (var i = 0; i < 4; i++) {
      AU_noise(S, G, { t: tt, dur: 0.04, vol: AU_rnd(0.6, 0.9), f: AU_rnd(1100, 2300), q: 1.6, a: 0.002 });
      AU_noise(S, G, { t: tt + 0.012, dur: 0.03, vol: 0.4, f: AU_rnd(3000, 4200), q: 2, a: 0.001 });
      AU_tone(S, G, { t: tt, f: 170, f2: 95, dur: 0.05, vol: 0.35, a: 0.003 });
      tt += AU_rnd(0.1, 0.14);
    }
  } },
  scoop: { v: 0.4, wet: 0.1, fn: function (S, G, t) {
    AU_noise(S, G, { t: t, dur: 0.19, vol: 0.7, f: 650, f2: 1900, q: 1.4, a: 0.05, k: 0.06, am: { rate: 55, depth: 0.5 } });
    AU_thud(S, G, t + 0.2, 125, 0.8, 0.1);
    AU_noise(S, G, { t: t + 0.2, dur: 0.06, vol: 0.3, type: 'lowpass', f: 900, q: 0.6, a: 0.003 });
  } },
  squish: { v: 0.42, wet: 0.1, fn: function (S, G, t) {
    AU_noise(S, G, { t: t, dur: 0.24, vol: 0.8, type: 'lowpass', f: 1300, f2: 220, q: 2.5, a: 0.012 });
    AU_tone(S, G, { t: t, f: 190, f2: 62, dur: 0.22, vol: 0.6, a: 0.006 });
    AU_bloop(S, G, t + 0.06, 230, 0.45, 0.06); AU_bloop(S, G, t + 0.13, 300, 0.3, 0.05);
  } },
  splash: { v: 0.46, wet: 0.22, fn: function (S, G, t) {
    AU_noise(S, G, { t: t, dur: 0.65, vol: 0.9, type: 'lowpass', f: 4200, f2: 520, q: 0.8, a: 0.008, k: 0.01 });
    AU_noise(S, G, { t: t, dur: 0.22, vol: 0.45, type: 'highpass', f: 3000, q: 0.5, a: 0.004, lp: 8000 });
    AU_tone(S, G, { t: t, f: 130, f2: 70, dur: 0.16, vol: 0.5, a: 0.005 });
    for (var i = 0; i < 7; i++) AU_bloop(S, G, t + AU_rnd(0.08, 0.6), AU_rnd(320, 950), AU_rnd(0.15, 0.32), AU_rnd(0.05, 0.09));
  } },
  water: { v: 0.44, wet: 0.22, fn: function (S, G, t) {
    AU_noise(S, G, { t: t, dur: 0.32, vol: 0.5, f: 1500, f2: 650, q: 0.8, a: 0.02, k: 0.02 });
    for (var i = 0; i < 4; i++) AU_bloop(S, G, t + 0.03 + i * AU_rnd(0.06, 0.1), AU_rnd(450, 1200), AU_rnd(0.3, 0.5), AU_rnd(0.05, 0.08));
  } },
  // ---- footsteps (very soft; called about three times a second) ----
  step_grass: { v: 0.075, wet: 0.08, min: 0.09, fn: function (S, G, t) {
    AU_noise(S, G, { t: t, dur: 0.085, vol: 1, f: AU_rnd(1700, 2600), q: 0.6, a: 0.012, k: 0.03, lp: 5000 });
    AU_tone(S, G, { t: t, f: 105, f2: 70, dur: 0.06, vol: 0.7, a: 0.006 });
  } },
  step_wood: { v: 0.10, wet: 0.14, min: 0.09, fn: function (S, G, t) {
    var f = AU_rnd(120, 150);
    AU_tone(S, G, { t: t, f: f * 1.4, f2: f, ft: 0.03, dur: 0.075, vol: 1, a: 0.003 });
    AU_tone(S, G, { t: t, f: f * 2.9, dur: 0.03, vol: 0.25, a: 0.002 });
    AU_noise(S, G, { t: t, dur: 0.022, vol: 0.4, f: AU_rnd(800, 1100), q: 1.2, a: 0.001 });
  } },
  step_stone: { v: 0.11, wet: 0.12, min: 0.09, fn: function (S, G, t) {
    AU_noise(S, G, { t: t, dur: 0.03, vol: 1, f: AU_rnd(1900, 2600), q: 1.1, a: 0.0015 });
    AU_tone(S, G, { t: t, f: AU_rnd(290, 340), dur: 0.035, vol: 0.5, a: 0.002 });
    AU_noise(S, G, { t: t + 0.02, dur: 0.05, vol: 0.22, f: 3600, q: 0.7, a: 0.01 });
  } },
  // ---- dogs ----
  bark: { v: 0.8, wet: 0.2, min: 0.06, fn: function (S, G, t, dog) {
    var s = AU_dogSize(dog), pm = AU_dogVoice(dog) * AU_rnd(0.96, 1.05);
    var n = s < 0.3 ? (Math.random() < 0.5 ? 3 : 2) : (s < 0.7 ? 2 : (Math.random() < 0.45 ? 1 : 2));
    var gap = 0.12 + 0.17 * s, tt = t;
    for (var i = 0; i < n; i++) { AU_bark1(S, G, tt, s, i === 0 ? 1 : AU_rnd(0.7, 0.9), pm * (i === n - 1 && n > 1 ? 0.95 : 1) * AU_rnd(0.98, 1.03), i ? AU_rnd(0.9, 1.05) : 1); tt += gap * AU_rnd(0.92, 1.1); }
  } },
  whine: { v: 0.28, wet: 0.22, fn: function (S, G, t, dog) {
    var s = AU_dogSize(dog), f = 1180 * Math.pow(0.48, s) * AU_dogVoice(dog), d = 0.6;
    var o = { t: t, f: f * 0.84, fp: [[d * 0.4, f * 1.1], [d, f * 0.78]], dur: d, a: 0.06, hold: d * 0.45, k: 0.03, vib: { rate: 6.5, depth: 22, delay: 0.12 } };
    AU_tone(S, G, Object.assign({ vol: 0.75, type: 'triangle', flt: { type: 'bandpass', f: f * 1.6, q: 1.2 } }, o));
    AU_tone(S, G, Object.assign({ vol: 0.32, type: 'sawtooth', flt: { type: 'bandpass', f: f * 2.6, q: 1.6 } }, o));
    AU_noise(S, G, { t: t, dur: d, vol: 0.05, f: f * 2.2, q: 1.5, a: 0.08, k: 0.05 });
  } },
  howl: { v: 0.24, wet: 0.4, duck: [0.7, 1.4], fn: function (S, G, t, dog) {
    var s = AU_dogSize(dog), f = 640 * Math.pow(0.45, s) * AU_dogVoice(dog), d = 1.55;
    var o = { t: t, f: f * 0.58, fp: [[0.32, f * 0.98], [d * 0.7, f * 1.04], [d, f * 0.7]], dur: d, a: 0.12, hold: d * 0.6, k: 0.02, vib: { rate: 5.2, depth: 16, delay: 0.45, ramp: 0.4 } };
    AU_tone(S, G, Object.assign({ vol: 0.75, type: 'triangle', flt: { type: 'lowpass', f: f * 2.6, q: 0.8 } }, o));
    AU_tone(S, G, Object.assign({ vol: 0.2, type: 'sawtooth', flt: { type: 'bandpass', f: f * 2.05, q: 3.5 } }, o));
    AU_noise(S, G, { t: t, dur: d, vol: 0.04, f: f * 2, q: 1.2, a: 0.15, hold: d * 0.5, k: 0.05 });
  } },
  pant: { v: 0.24, wet: 0.08, fn: function (S, G, t, dog) {
    var s = AU_dogSize(dog), cyc = 0.17 + 0.1 * s, fq = 1900 - 600 * s;
    for (var i = 0; i < 5; i++) {
      AU_noise(S, G, { t: t + i * cyc, dur: cyc * 0.5, vol: 1, f: fq, q: 1.3, a: cyc * 0.14, k: 0.04, lp: 5000 });                 // out
      AU_noise(S, G, { t: t + i * cyc + cyc * 0.52, dur: cyc * 0.42, vol: 0.5, f: fq * 1.45, q: 1.6, a: cyc * 0.14, k: 0.05, lp: 5000 }); // in
    }
  } },
  snore: { v: 0.42, wet: 0.15, fn: function (S, G, t, dog) {
    var s = AU_dogSize(dog), f = 330 - 130 * s;
    AU_noise(S, G, { t: t, dur: 0.8, vol: 1, f: f, f2: f * 1.3, q: 2.2, a: 0.5, k: 0.05, am: { rate: 27 - 6 * s, depth: 0.85, type: 'triangle' }, pink: true });
    AU_noise(S, G, { t: t, dur: 0.8, vol: 0.25, f: f * 3.2, q: 1.5, a: 0.5, k: 0.05, am: { rate: 27 - 6 * s, depth: 0.8, type: 'triangle' } });
    AU_noise(S, G, { t: t + 0.95, dur: 0.7, vol: 0.22, f: 1100, f2: 700, q: 1.2, a: 0.18, k: 0.03 });
    AU_tone(S, G, { t: t + 0.98, f: 820 - 200 * s, f2: 560 - 140 * s, dur: 0.6, vol: 0.05, a: 0.15, k: 0.03 });
  } },
  shake: { v: 0.26, wet: 0.12, fn: function (S, G, t, dog) {
    var s = AU_dogSize(dog), r = 15 - 5 * s;
    AU_noise(S, G, { t: t, dur: 0.85, vol: 0.9, f: 1500 - 500 * s, f2: 1000 - 300 * s, q: 0.7, a: 0.12, hold: 0.35, k: 0.03, am: { rate: r, rate2: r * 0.55, depth: 0.95, type: 'triangle' } });
    AU_noise(S, G, { t: t, dur: 0.8, vol: 0.3, type: 'highpass', f: 3000, q: 0.5, a: 0.12, hold: 0.3, k: 0.03, lp: 7000, am: { rate: r, rate2: r * 0.55, depth: 0.95, type: 'triangle' } });
    for (var i = 0; i < 8; i++) AU_bloop(S, G, t + AU_rnd(0.1, 0.8), AU_rnd(900, 2400), AU_rnd(0.08, 0.2), 0.035);
    for (var j = 0; j < 4; j++) AU_mallet(S, G, t + 0.12 + j * 0.14 + AU_rnd(0, 0.04), AU_rnd(3600, 4400), AU_rnd(0.06, 0.12), 'coin', 0.4);     // collar tag
  } }
};
var AU_SFX_NAMES = Object.keys(AU_SFX);
// forgiving spellings, so a slightly different name from the game still makes the right sound
var AU_ALIAS = { step: 'step_grass', footstep: 'step_grass', cash: 'register', kaching: 'register', success: 'goal', task: 'goal', fail: 'error', deny: 'error',
  levelup: 'level', hover: 'ui_hover', open: 'ui_open', close: 'ui_close', woof: 'bark', yip: 'bark', chime: 'ding', drip: 'water', wash: 'splash',
  discover: 'new_breed', purchase: 'buy', morning: 'day_start', evening: 'day_end', deskbell: 'bell', turn: 'page' };

// Play an effect at time 'when' (context time). Used by sfx() and by the tests.
function AU_sfxAt(name, dog, when) {
  var S = AU_S, def = AU_SFX[name] || AU_SFX[AU_ALIAS[name]];
  if (!S || !def) return false;
  if (typeof dog === 'string') dog = { breed: dog };
  var G = AU_group(S, 'sfx', def.v, def.wet || 0, def.pan || 0);
  try { def.fn(S, G, when, dog); } finally { G.sealed = true; if (G.n <= 0) AU_free(G); }
  if (def.duck && typeof AU_duck === 'function') AU_duck(when, def.duck[0], def.duck[1]);      // music.js dips the soundtrack under big jingles
  return true;
}
function sfx(name, dog) {
  try {
    var S = AU_S;
    if (!S || !AC || S.ctx !== AC || AC.state === 'closed') return;
    var def = AU_SFX[name] || AU_SFX[AU_ALIAS[name]]; if (!def) return;
    if (AC.state === 'suspended' || AC.state === 'interrupted') {
      try { var pr = AC.resume(); if (pr && pr.catch) pr.catch(function () {}); } catch (e) {}
    }
    AU_sweepVoices(S);
    if (AC.state !== 'running' && Date.now() - S.woke > 600) return;   // asleep (no gesture yet / tab suspended): do not queue sounds up
    if (S.voices > 220) return;                                   // runaway guard
    var now = AC.currentTime, min = def.min || 0.03, last = S.last[name];
    if (last != null && now - last < min) return;                 // do not stack the same effect in the same instant
    S.last[name] = now;
    AU_sfxAt(name, dog, now + 0.004);
  } catch (e) { /* never let a sound break the game */ }
}
