'use strict';
// =====================================================================================================================
// Paws & Play — music.js : generative cozy soundtrack + outdoor / indoor ambience (Web Audio, no audio files).
// Needs sound.js (loaded first) for the audio graph and the instrument helpers.
//
// Public API (global):
//   Music.start()            start soundtrack + ambience (audioInit() does this automatically on the first gesture)
//   Music.stop()             fade out and silence everything that belongs to the music and ambience
//   Music.setScene(scene)    scene = { mode: 'title'|'play'|'build'|'summary', dayFrac: 0..1, indoors: bool, tension: 0..1 }
//                            call as often as you like; every change is smoothed over seconds
//   Music.isPlaying()        true between start() and stop()
//   Music.info()             { theme, section, bar, state, bpm } for debugging
//
// How it works: five written themes (title, morning, midday, evening, summary), each with its own key, tempo, chord
// progressions and tunes.  A small "conductor" strings the sections of a theme together in a different order every time,
// swaps lead instruments, adds harmony lines / echoes / improvised variations, then ends the piece with a slow final
// chord and leaves 20-40 seconds of birdsong before the next one.  A look-ahead scheduler (100 ms timer, notes placed on
// the audio clock) keeps the timing exact.
// =====================================================================================================================
var AU_M = {
  on: false, timer: null, manual: false, seq: 0, errs: 0,
  scene: { mode: 'title', dayFrac: 0, indoors: false, tension: 0 },
  piece: null, old: [], gapUntil: 0, pieces: 0, lastTheme: '', tens: 0, build: 0, buildApplied: -1, lastNow: 0,
  rate: 0, fracAt: null, rng: Math.random, log: null, amb: null, root: null, rootWet: null, ambRoot: null, ambWet: null
};
// mix levels of the instruments (before the music bus)
var AU_LV = { guitar: 0.57, harp: 0.57, kalimba: 0.25, marimba: 0.36, musicbox: 0.19, glock: 0.10, flute: 0.25, pad: 0.085, bass: 0.225,
  shaker: 0.25, brush: 0.24, kick: 0.26, wood: 0.16, conga: 0.20 };
var AU_LAYERS = { lead: [0.14, 0.30], wind: [0.26, 0.36], acc: [-0.22, 0.20], pad: [0, 0.32], bass: [0, 0.03], perc: [0.08, 0.12], plan: [-0.1, 0.26] };  // [pan, reverb]
var AU_INS_LAYER = { guitar: 'acc', harp: 'acc', kalimba: 'lead', marimba: 'lead', musicbox: 'lead', glock: 'lead', flute: 'wind', pad: 'pad', bass: 'bass',
  shaker: 'perc', brush: 'perc', kick: 'perc', wood: 'perc', conga: 'perc' };
var AU_LEAD_OCT = { kalimba: 0, musicbox: 0, marimba: 0, flute: 0, guitar: -12, harp: -12, glock: 12 };

function AU_seed(s) {
  var a = s >>> 0;
  AU_M.rng = function () { a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
function AU_r() { return AU_M.rng(); }
function AU_rr(a, b) { return a + AU_r() * (b - a); }
function AU_rp(arr) { return arr[Math.floor(AU_r() * arr.length) % arr.length]; }
function AU_ch(p) { return AU_r() < p; }

// ---------------------------------------------------------------------------------------------------------------------
// Notation
// ---------------------------------------------------------------------------------------------------------------------
var AU_PC = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
function AU_acc(x) { return x === '#' ? 1 : x === 'b' ? -1 : 0; }
function AU_noteNum(s) {
  var m = /^([a-g])(#|b)?(\d)$/.exec(s);
  return m ? 12 * (+m[3] + 1) + AU_PC[m[1]] + AU_acc(m[2]) : null;
}
function AU_mod(a, n) { return ((a % n) + n) % n; }
var AU_QUAL = { '': [0, 4, 7], m: [0, 3, 7], '7': [0, 4, 7, 10], maj7: [0, 4, 7, 11], m7: [0, 3, 7, 10], sus4: [0, 5, 7], sus2: [0, 2, 7], add9: [0, 4, 7, 14], '6': [0, 4, 7, 9] };
var AU_chordCache = {};
function AU_chord(sym) {
  var c = AU_chordCache[sym]; if (c) return c;
  var m = /^([A-G])(#|b)?(maj7|m7|m|7|sus4|sus2|add9|6)?(?:\/([A-G])(#|b)?)?$/.exec(sym) || /^([A-G])(#|b)?()(?:)$/.exec('C');
  var root = AU_mod(AU_PC[m[1].toLowerCase()] + AU_acc(m[2]), 12), iv = AU_QUAL[m[3] || ''];
  var bass = m[4] ? AU_mod(AU_PC[m[4].toLowerCase()] + AU_acc(m[5]), 12) : root;
  var r = 43 + AU_mod(root - 43, 12);                               // guitar root G2..F#3
  var mid = iv.length > 3 ? r + iv[3] : r + 12;
  var v = [r, r + 7, mid, r + 12 + iv[1], r + 19];
  if (iv[2] !== 7) v[1] = r + iv[2];
  if (bass !== root) v[0] = 40 + AU_mod(bass - 40, 12);
  var rb = 38 + AU_mod(root - 38, 12), bn = 38 + AU_mod(bass - 38, 12);   // bass D2..C#3: real low end, no sub rumble
  var pcs = iv.map(function (x) { return AU_mod(root + x, 12); });
  // pad voicing: close position around middle C; four-note chords drop the root (the bass has it) so no semitone rubs in the middle
  var pad = (pcs.length > 3 ? pcs.slice(1, 4) : pcs).map(function (pc) { return 55 + AU_mod(pc - 55, 12); }).sort(function (a, b) { return a - b; });
  c = { sym: sym, root: root, bass: bass, pcs: pcs, v: v, bassN: bn, alt: bass !== root ? rb : (rb + 7 > 51 ? rb - 5 : rb + 7), pad: pad };
  AU_chordCache[sym] = c;
  return c;
}
function AU_parseChords(str) {
  return str.split('|').map(function (b) { return b.trim().split(/\s+/).map(AU_chord); });
}
function AU_parseMel(str) {          // "f#5 a5:1.5 r:.5 | ..."  ->  per bar: [[beat, dur, midi], ...]
  return str.split('|').map(function (b) {
    var pos = 0, out = [];
    b.trim().split(/\s+/).forEach(function (tok) {
      if (!tok) return;
      var p = tok.split(':'), d = p[1] ? parseFloat(p[1]) : 1, n = AU_noteNum(p[0]);
      if (n != null) out.push([pos, d, n]);
      pos += d;
    });
    return out;
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// The score.  Chords: one bar between | |, two chords in a bar share it.  Tunes: note:beats, r = rest.
// ---------------------------------------------------------------------------------------------------------------------
var AU_THEMES = {
  // "Open Gate" — bright fingerpicked morning, D major
  morning: { key: 'D', bpm: 92, beats: 4, swing: 0, acc: 'guitar', perc: 'full',
    pats: [['q'], ['arp8', 'dyad'], ['travis', 'folk', 'arp8']],
    leads: { A: ['kalimba', 'marimba'], B: ['flute'], C: ['kalimba', 'guitar'] }, genLead: 'kalimba', echo: 'flute', endLead: 'kalimba',
    sec: {
      I: { ch: 'D | G | D | A', mel: ['r:4 | r:4 | r:4 | r:3 d5:.5 e5:.5'] },
      A: { ch: 'D | G | D/F# | A | Bm | G | Em7 A | D', mel: [
        'f#5 a5 b5:.5 a5:.5 f#5 | g5:1.5 f#5:.5 e5 d5 | f#5 a5 d6:1.5 b5:.5 | a5:2 r e5:.5 f#5:.5 | f#5:1.5 e5:.5 d5 f#5 | e5 d5:.5 b4:.5 d5:2 | e5 g5 a5:.5 g5:.5 e5 | d5:3 r',
        'f#5 a5 b5:.5 a5:.5 f#5 | g5:1.5 a5:.5 b5 d6 | a5:1.5 f#5:.5 a5 d6 | e6:2 c#6 a5 | b5:1.5 a5:.5 f#5 d5 | g5 b5 a5:.5 g5:.5 e5 | g5 e5 c#5:.5 e5:.5 a5 | f#5:.5 e5:.5 d5:2 r'] },
      B: { ch: 'G | A | F#m7 | Bm | G | D/F# | Em7 | Asus4 A', mel: [
        'b5:2 d6 b5 | a5:2 c#6:1.5 b5:.5 | a5:3 f#5 | b5:2 r f#5:.5 a5:.5 | b5:1.5 a5:.5 g5 b5 | a5:2 f#5 d5 | e5 g5 b5 g5 | a5:3 r',
        'd6:2 b5 g5 | e6:1.5 c#6:.5 a5:2 | c#6:2 a5 f#5 | d6:2 b5 r | g5 b5 d6:1.5 b5:.5 | a5:2 d6 a5 | g5:1.5 a5:.5 b5 e6 | e6:2 c#6 r'] },
      C: { ch: 'Bm | F#m | G | D | Bm | F#m | G | A', cr: true, mel: [
        'd5:.5 f#5:.5 b5 r:2 | c#5:.5 f#5:.5 a5 r:2 | b4:.5 d5:.5 g5 a5:.5 g5:.5 d5 | f#5:2 r:2 | d5:.5 f#5:.5 b5 a5:.5 f#5:.5 r | c#5:.5 f#5:.5 a5 f#5:.5 c#5:.5 r | d5:.5 g5:.5 b5 a5 g5 | e5 a5:2 r'] },
      O: { ch: 'G | A | D | D', mel: ['b5:2 g5:2 | a5:2 e5:2 | d5:4 | r:4'] }
    } },
  // "Lazy Afternoon" — swung, marimba and brushes, G major
  midday: { key: 'G', bpm: 80, beats: 4, swing: 0.11, acc: 'guitar', perc: 'brush',
    pats: [['q'], ['dyad', 'arp8'], ['travis', 'folk']],
    leads: { A: ['marimba', 'kalimba'], B: ['flute'], C: ['kalimba', 'marimba'] }, genLead: 'marimba', echo: 'glock', endLead: 'marimba',
    sec: {
      I: { ch: 'G | C | G | D', mel: ['r:4 | r:4 | r:4 | r:3 b4:.5 d5:.5'] },
      A: { ch: 'G | Bm7 | C | D | Em7 | C | Am7 D | G', mel: [
        'd5:1.5 e5:.5 g5 b5 | a5:2 f#5 d5 | e5:1.5 g5:.5 e5 c5 | d5:2 r d5:.5 e5:.5 | g5:1.5 a5:.5 b5 g5 | e5:2 g5 e5 | c5 e5 d5 f#5 | g5:3 r',
        'b5:1.5 a5:.5 g5 d5 | f#5 a5 d6:2 | c6:1.5 b5:.5 g5 e5 | f#5:.5 g5:.5 a5:2 r | b5 g5 e5 g5 | c6:1.5 b5:.5 g5:2 | a5 g5 f#5 a5 | g5:3 r'] },
      B: { ch: 'C | G/B | Am7 | D | C | Bm7 | Am7 | Dsus4 D', mel: [
        'e5:2 g5:2 | d5:3 b4:.5 d5:.5 | e5:1.5 d5:.5 c5 e5 | d5:3 r | g5:2 e5 g5 | a5:2 f#5:2 | g5 e5 c5 e5 | d5:2 a5:2',
        'g5:2 c6:2 | b5:2 g5 d5 | c6:1.5 b5:.5 a5 e5 | f#5:2 a5 r | e5 g5 c6:2 | d6:2 b5 f#5 | a5:1.5 g5:.5 e5 c5 | d5:3 r'] },
      C: { ch: 'C | D/C | G/B | Em7 | C | D | G | G', cr: true, mel: [
        'e5:.5 g5:.5 c6 b5:.5 g5:.5 r | f#5:.5 a5:.5 d6 c6:.5 a5:.5 r | d5:.5 g5:.5 b5 a5:.5 g5:.5 d5 | e5:2 r:2 | e5:.5 g5:.5 c6 b5:.5 g5:.5 e5 | f#5:.5 a5:.5 d6 a5 f#5 | g5 b5 d6:2 | g5:2 r:2'] },
      O: { ch: 'C | D | G | G', mel: ['e5:2 g5:2 | f#5:2 a5:2 | g5:4 | r:4'] }
    } },
  // "Golden Hour" — harp, flute and a warm pad, F major
  evening: { key: 'F', bpm: 76, beats: 4, swing: 0, acc: 'harp', perc: 'soft',
    pats: [['q'], ['roll', 'q'], ['roll', 'arp8']],
    leads: { A: ['flute', 'kalimba'], B: ['kalimba', 'musicbox'], C: ['musicbox', 'kalimba'] }, genLead: 'kalimba', echo: 'flute', endLead: 'kalimba',
    sec: {
      I: { ch: 'Fmaj7 | Bbmaj7 | Fmaj7 | C', mel: ['r:4 | r:4 | r:4 | r:4'] },
      A: { ch: 'Fmaj7 | Am7 | Bbmaj7 | C | Dm7 | Bbmaj7 | Gm7 C | F', mel: [
        'a5:2 c6:1.5 a5:.5 | g5:3 e5 | f5 g5 a5 f5 | g5:3 r | a5:2 f5 d5 | d5 f5 g5 f5 | bb5 g5 e5 g5 | f5:3 r',
        'c6:2 a5 f5 | e5 g5 c6:2 | d6:1.5 c6:.5 bb5 f5 | g5:2 r c6 | d6:2 c6 a5 | bb5:1.5 a5:.5 f5:2 | g5 d5 e5 g5 | f5:3 r'] },
      B: { ch: 'Bb | C | Am7 | Dm | Gm7 | C | Fmaj7 | C', mel: [
        'd5 f5 bb5:2 | c6 g5 e5:2 | c5 e5 a5:2 | a5:.5 g5:.5 f5 d5:2 | d5 g5 bb5 a5 | g5:2 e5 g5 | a5:2 c6:2 | g5:3 r'] },
      C: { ch: 'Dm7 | Bbmaj7 | F | C | Dm7 | Bbmaj7 | C | C', cr: true, mel: [
        'a5:.5 c6:.5 a5 f5 r | f5:.5 a5:.5 f5 d5 r | c5:.5 f5:.5 a5 g5:.5 f5:.5 c5 | e5:2 r:2 | a5:.5 c6:.5 d6 c6:.5 a5:.5 r | f5:.5 a5:.5 bb5 a5:.5 f5:.5 r | e5 g5 c6:1.5 g5:.5 | g5:2 r:2'] },
      O: { ch: 'Bbmaj7 | C | F | F', mel: ['d6:2 bb5:2 | c6:2 g5:2 | f5:4 | r:4'] }
    } },
  // "Paws & Play" — the title waltz: music box over harp, A major, 3/4
  title: { key: 'A', bpm: 92, beats: 3, swing: 0, acc: 'harp', perc: 'none',
    pats: [['lull'], ['arp6', 'arp6b'], ['arp6', 'arp6b']],
    leads: { A: ['musicbox', 'kalimba'], B: ['flute', 'musicbox'] }, genLead: 'musicbox', echo: null, endLead: 'musicbox',
    sec: {
      I: { ch: 'A | A | D | D', mel: ['r:3 | r:3 | r:3 | r:3'] },
      A: { ch: 'A | A | F#m7 | F#m7 | D | D | E | E | A | A/C# | D | Bm7 | A/E | E | A | A', mel: [
        'e5:2 a5 | c#6:3 | b5 a5 f#5 | a5:3 | f#5:2 a5 | d6:3 | c#6 b5 g#5 | b5:2 r | e5:2 a5 | c#6:2 e6 | d6 c#6 a5 | b5:2 d6 | c#6:2 a5 | b5 g#5 e5 | a5:3 | r:3'] },
      B: { ch: 'D | D | A/C# | A/C# | Bm7 | Bm7 | E | E | D | D | C#m7 | F#m7 | Bm7 | E | A | A', mel: [
        'f#5 a5 d6 | f#6:3 | e6 c#6 a5 | c#6:3 | d6 b5 f#5 | a5:3 | g#5 b5 e6 | b5:2 r | a5:2 f#5 | d5:2 f#5 | e5:2 g#5 | a5:2 c#6 | b5 a5 f#5 | g#5:2 b5 | a5:3 | r:3'] },
      O: { ch: 'D | E | A | A', mel: ['f#5:2 a5 | g#5:2 b5 | a5:3 | r:3'] }
    } },
  // "Closing Time" — end-of-day lullaby, B flat major
  summary: { key: 'Bb', bpm: 76, beats: 4, swing: 0, acc: 'harp', perc: 'none',
    pats: [['q'], ['roll', 'q'], ['roll']],
    leads: { A: ['musicbox', 'kalimba'], B: ['kalimba', 'flute'] }, genLead: 'musicbox', echo: null, endLead: 'musicbox',
    sec: {
      I: { ch: 'Ebmaj7 | Bb/D | Ebmaj7 | F', mel: ['r:4 | r:4 | r:4 | r:4'] },
      A: { ch: 'Ebmaj7 | Bb/D | Cm7 | Bb | Ebmaj7 | Bb/D | Cm7 F | Bb', mel: [
        'g5:2 bb5 g5 | f5:2 d5:2 | eb5 g5 bb5 g5 | f5:3 r | g5:2 bb5 d6 | c6 bb5 f5:2 | g5 eb5 f5 a5 | bb5:3 r'] },
      B: { ch: 'Gm7 | Ebmaj7 | Bb | F | Gm7 | Ebmaj7 | Cm7 | F', mel: [
        'd5 g5 bb5:2 | bb5 g5 eb5:2 | d5 f5 bb5 d6 | c6:3 r | d6 bb5 g5:2 | g5 bb5 g5 eb5 | eb5 g5 c6:2 | a5:2 f5:2'] },
      O: { ch: 'Ebmaj7 | F | Bb | Bb', mel: ['g5:2 bb5:2 | a5:2 c6:2 | bb5:4 | r:4'] }
    } }
};
// accompaniment figures: [sixteenth step, chord voice 0..4 (0 = bass string), loudness]
var AU_ACC = {
  q:      [[0, 0, 0.85], [4, 2, 0.55], [8, 3, 0.65], [12, 2, 0.5]],
  dyad:   [[0, 0, 0.85], [4, 3, 0.5], [4, 4, 0.45], [8, 1, 0.65], [12, 3, 0.5], [12, 4, 0.45]],
  arp8:   [[0, 0, 0.9], [2, 1, 0.55], [4, 2, 0.6], [6, 3, 0.65], [8, 4, 0.6], [10, 3, 0.55], [12, 2, 0.55], [14, 3, 0.5]],
  travis: [[0, 0, 0.9], [2, 3, 0.5], [4, 1, 0.65], [6, 2, 0.5], [8, 0, 0.8], [10, 4, 0.55], [12, 1, 0.6], [14, 3, 0.5]],
  folk:   [[0, 0, 0.9], [3, 2, 0.5], [4, 3, 0.6], [6, 1, 0.5], [8, 0, 0.75], [10, 2, 0.5], [11, 3, 0.45], [12, 4, 0.6], [14, 2, 0.5]],
  roll:   [[0, 0, 0.85], [2, 1, 0.5], [4, 2, 0.55], [6, 3, 0.6], [8, 4, 0.65], [10, 3, 0.5], [12, 2, 0.5], [14, 1, 0.45]],
  lull:   [[0, 0, 0.8], [4, 2, 0.5], [6, 3, 0.5], [8, 4, 0.5]],
  arp6:   [[0, 0, 0.85], [2, 1, 0.5], [4, 2, 0.55], [6, 3, 0.6], [8, 4, 0.55], [10, 3, 0.5]],
  arp6b:  [[0, 0, 0.85], [2, 2, 0.5], [4, 3, 0.55], [6, 4, 0.6], [8, 3, 0.5], [10, 2, 0.45]]
};
function AU_theme(name) {
  var th = AU_THEMES[name];
  if (!th.ready) {
    th.name = name; th.keyPc = AU_chord(th.key).root;
    for (var k in th.sec) { var s = th.sec[k]; s.bars = AU_parseChords(s.ch); s.tunes = s.mel.map(AU_parseMel); }
    th.ready = true;
  }
  return th;
}

// ---------------------------------------------------------------------------------------------------------------------
// Instruments that only the music uses
// ---------------------------------------------------------------------------------------------------------------------
function AU_waves(S) {
  if (S.waves) return S.waves;
  function pw(h) { var re = new Float32Array(h.length + 1), im = new Float32Array(h.length + 1); for (var i = 0; i < h.length; i++) im[i + 1] = h[i]; return S.ctx.createPeriodicWave(re, im); }
  S.waves = { flute: pw([1, 0.36, 0.10, 0.04, 0.015]), pad: pw([1, 0.5, 0.28, 0.16, 0.09, 0.05, 0.03]), bass: pw([1, 0.5, 0.2, 0.08, 0.03]) };
  return S.waves;
}
function AU_flute(S, G, t, midi, vel, dur) {
  var f = AU_hz(midi), d = Math.max(0.2, dur), a = Math.min(0.07, d * 0.3);
  AU_tone(S, G, { t: t, f: f * 0.987, fp: [[0.06, f]], wave: AU_waves(S).flute, vol: vel, a: a, hold: d - a, dur: d + 0.2,
    vib: d > 0.5 ? { rate: 4.8 + AU_r() * 0.6, depth: 11, delay: 0.2, ramp: 0.3 } : null });
  AU_noise(S, G, { t: t, dur: d + 0.12, vol: vel * 0.06, f: f * 2, q: 1.3, a: 0.04, hold: Math.max(0.01, d - 0.06), lp: 6000 });
  AU_noise(S, G, { t: t, dur: 0.06, vol: vel * 0.14, f: f * 2.6, q: 0.8, a: 0.004 });
}
function AU_padNote(S, G, t, midi, vel, dur, to) {
  var f = AU_hz(midi), w = AU_waves(S).pad;
  AU_tone(S, G, { t: t, f: f, det: -5, wave: w, vol: vel * 0.5, a: 0.6, hold: Math.max(0.05, dur - 0.55), dur: dur + 1.2, k: 0.01, to: to });
  AU_tone(S, G, { t: t, f: f, det: 6, wave: w, vol: vel * 0.5, a: 0.7, hold: Math.max(0.05, dur - 0.65), dur: dur + 1.2, k: 0.01, to: to });
}
function AU_bassNote(S, G, t, midi, vel, dur) {
  var f = AU_hz(midi), d = Math.max(0.22, dur);
  AU_tone(S, G, { t: t, f: f, wave: AU_waves(S).bass, vol: vel, a: 0.014, hold: d * 0.35, dur: d + 0.12, k: 0.02 });
  AU_pluck(S, G, t, midi, vel * 0.32, d, 'guitar');
}
function AU_percHit(S, G, t, kind, vel) {
  switch (kind) {
    case 'shaker': AU_noise(S, G, { t: t, dur: 0.075, vol: vel, f: 6200, q: 1.1, a: 0.012, hp: 3800, lp: 9500 }); break;
    case 'brush': AU_noise(S, G, { t: t, dur: 0.17, vol: vel, f: 1900, q: 0.6, a: 0.008, k: 0.02, hp: 700, lp: 6500 }); AU_tone(S, G, { t: t, f: 195, f2: 170, dur: 0.07, vol: vel * 0.25, a: 0.004 }); break;
    case 'kick': AU_tone(S, G, { t: t, f: 108, f2: 54, ft: 0.07, dur: 0.24, vol: vel, a: 0.005 }); AU_noise(S, G, { t: t, dur: 0.02, vol: vel * 0.12, type: 'lowpass', f: 700, q: 0.6, a: 0.002 }); break;
    case 'wood': AU_mallet(S, G, t, 760, vel, 'wood', 1); break;
    case 'conga': AU_tone(S, G, { t: t, f: 250, f2: 215, dur: 0.16, vol: vel, a: 0.003 }); AU_noise(S, G, { t: t, dur: 0.03, vol: vel * 0.3, f: 1100, q: 1, a: 0.002 }); break;
    case 'congaH': AU_tone(S, G, { t: t, f: 335, f2: 300, dur: 0.12, vol: vel, a: 0.003 }); AU_noise(S, G, { t: t, dur: 0.025, vol: vel * 0.3, f: 1500, q: 1, a: 0.002 }); break;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Building one section: every note of every part for the next 4-16 bars
// ---------------------------------------------------------------------------------------------------------------------
function AU_harmBelow(m, c) {
  for (var d = 3; d <= 9; d++) if (c.pcs.indexOf(AU_mod(m - d, 12)) >= 0) return m - d;
  return null;
}
// A fresh tune over the section's chords: chord notes on the strong beats, pentatonic steps between, a repeated
// rhythmic idea, and phrases that come to rest.
function AU_genMelody(P, def, segAt) {
  var th = P.theme, beats = th.beats, nb = def.bars.length, key = th.keyPc;
  var penta = [0, 2, 4, 7, 9].map(function (x) { return AU_mod(x + key, 12); });
  var lo = 69, hi = 86;
  var R = beats === 3 ? [[2, 1], [1, 1, 1], [1, 2], [1.5, 0.5, 1], [3]] :
    [[1, 1, 1, 1], [1.5, 0.5, 1, 1], [2, 1, 1], [1, 1, 2], [1.5, 0.5, 2], [0.5, 0.5, 1, 2], [2, 0.5, 0.5, 1], [1, 0.5, 0.5, 2], [0.5, 0.5, 1, 0.5, 0.5, 1]];
  var E = beats === 3 ? [[3], [2, -1]] : [[3, -1], [2, -2], [1, 2, -1], [1.5, 0.5, 2]];
  var unit = beats === 3 ? 4 : 2, rh = [], dirs = [], u, out = [];
  for (u = 0; u < unit; u++) rh.push(AU_rp(R));
  var prev = 76 + key % 5, dir = AU_ch(0.5) ? 1 : -1, same = 0;
  for (var b = 0; b < nb; b++) {
    var pos = b % unit, phraseEnd = (b % (unit * 2)) === unit * 2 - 1, reuse = !phraseEnd && AU_ch(0.75);
    var rhythm = phraseEnd ? AU_rp(E) : (reuse ? rh[pos] : AU_rp(R)), notes = [], beat = 0, memo = reuse && b >= unit ? dirs[pos] : null, myDirs = [];
    for (var i = 0; i < rhythm.length; i++) {
      var d = rhythm[i];
      if (d < 0) { beat += -d; continue; }
      var c = segAt(b, Math.round(beat * 4)).c, last = b === nb - 1 && (i === rhythm.length - 1 || rhythm[i + 1] < 0);
      var strong = beat === 0 || (beats === 4 && beat === 2) || d >= 1.5;
      if (memo && memo[i] != null && AU_ch(0.7)) dir = memo[i]; else if (AU_ch(0.3)) dir = -dir;
      if (prev >= hi - 2) dir = -1; else if (prev <= lo + 2) dir = 1;
      var cand = [], p;
      if (last) { for (p = lo; p <= hi; p++) { var pc = AU_mod(p, 12); if (pc === c.root || pc === c.pcs[1]) cand.push(p); } }
      else if (strong) { for (p = lo; p <= hi; p++) if (c.pcs.indexOf(AU_mod(p, 12)) >= 0) cand.push(p); }
      else { for (p = lo; p <= hi; p++) { var q = AU_mod(p, 12); if (penta.indexOf(q) >= 0 || c.pcs.indexOf(q) >= 0) cand.push(p); } }
      var best = prev, bestScore = 1e9, leap = strong && !last && AU_ch(0.12);
      for (var j = 0; j < cand.length; j++) {
        var dist = cand[j] - prev, ad = Math.abs(dist), sc;
        if (dist === 0) sc = same >= 1 ? 50 : 6;
        else if (leap) sc = Math.abs(ad - 7) + (dist * dir < 0 ? 1.5 : 0);
        else sc = ad + (dist * dir < 0 ? 2.5 : 0) + (ad > 5 ? 6 : 0);
        sc += AU_r() * 0.9;
        if (sc < bestScore) { bestScore = sc; best = cand[j]; }
      }
      same = best === prev ? same + 1 : 0;
      if (best !== prev) dir = best > prev ? 1 : -1;
      myDirs[i] = dir; prev = best;
      notes.push([beat, d, best]);
      beat += d;
    }
    if (b < unit) dirs[pos] = myDirs;
    out.push(notes);
  }
  return out;
}
function AU_buildSection(P, inst) {
  var th = P.theme, def = th.sec[inst.k], beats = th.beats, spb = beats * 4, nb = def.bars.length, e = inst.e;
  var ev = [], i, bar;
  for (i = 0; i < nb * spb; i++) ev.push(null);
  function add(b, st, o) { var idx = b * spb + st; if (idx < 0 || idx >= ev.length) return; (ev[idx] || (ev[idx] = [])).push(o); }
  var segs = def.bars.map(function (b) {
    if (b.length === 1) return [{ c: b[0], s0: 0, s1: spb }];
    var cut = beats === 3 ? 8 : spb / 2;
    return [{ c: b[0], s0: 0, s1: cut }, { c: b[1], s0: cut, s1: spb }];
  });
  function segAt(b, st) { var s = segs[b]; return s.length > 1 && st >= s[1].s0 ? s[1] : s[0]; }
  var isEnd = inst.k === 'O';

  // --- accompaniment (guitar / harp) ---
  var pats = th.pats[Math.min(e, th.pats.length - 1)], patA = AU_rp(pats), patB = AU_ch(0.5) ? AU_rp(pats) : patA;
  for (bar = 0; bar < nb; bar++) {
    if (isEnd && bar >= nb - 2) {
      if (bar === nb - 2) { var fc = segs[bar][0].c; for (i = 0; i < 5; i++) add(bar, 0, { i: th.acc, m: fc.v[i], v: 0.6 + i * 0.05, d: beats * 2, o: i * 0.075 }); add(bar, 0, { i: th.acc, m: fc.v[2] + 12, v: 0.55, d: beats * 2, o: 0.42 }); }
      continue;
    }
    var fill = inst.fill && bar === nb - 1 && beats === 4 && segs[bar].length === 1;
    var pat = AU_ACC[bar < nb / 2 ? patA : patB], used = {};
    for (i = 0; i < pat.length; i++) {
      var st = pat[i][0], vi = pat[i][1], vel = pat[i][2], sg = segAt(bar, st);
      if (fill && st >= 8) continue;
      if (st === sg.s0) { if (used[st]) continue; used[st] = 1; vi = 0; vel = Math.max(vel, 0.75); }
      else if (vi !== 0 && st % 4 !== 0 && AU_ch(0.08)) continue;                 // a little breathing
      add(bar, st, { i: th.acc, m: sg.c.v[vi], v: vel * AU_rr(0.92, 1.06), d: (sg.s1 - st) / 4 + 0.3 });
    }
    if (segs[bar].length > 1 && !used[segs[bar][1].s0]) add(bar, segs[bar][1].s0, { i: th.acc, m: segs[bar][1].c.v[0], v: 0.78, d: (spb - segs[bar][1].s0) / 4 + 0.3 });
    if (fill) { var fcv = segs[bar][0].c.v; [[8, 1], [10, 2], [12, 3], [14, 4]].forEach(function (f, j) { add(bar, f[0], { i: th.acc, m: fcv[f[1]], v: 0.5 + j * 0.07, d: (spb - f[0]) / 4 + 0.3 }); }); }
  }
  // --- bass ---
  if (inst.bass) for (bar = 0; bar < nb; bar++) {
    segs[bar].forEach(function (sg) {
      var len = (sg.s1 - sg.s0) / 4, fin = isEnd && bar >= nb - 2;
      if (isEnd && bar === nb - 1) return;
      add(bar, sg.s0, { i: 'bass', m: sg.c.bassN, v: fin ? 0.8 : 0.9, d: fin ? beats * 1.6 : Math.min(len, e >= 2 ? 1.5 : 2.5) });
    });
    if (isEnd && bar >= nb - 2) continue;
    var c0 = segs[bar][0].c;
    if (beats === 4 && segs[bar].length === 1) {
      if (e >= 2) {
        if (AU_ch(0.3)) add(bar, 6, { i: 'bass', m: c0.bassN, v: 0.5, d: 0.5 });
        add(bar, 8, { i: 'bass', m: AU_ch(0.6) ? c0.alt : c0.bassN, v: 0.72, d: 1.5 });
        if (bar < nb - 1 && AU_ch(0.45)) {
          var nx = segs[bar + 1][0].c.bassN, opts = [nx - 2, nx - 1, nx + 2, nx + 1], scale = [0, 2, 4, 5, 7, 9, 11];
          for (i = 0; i < opts.length; i++) if (scale.indexOf(AU_mod(opts[i] - th.keyPc, 12)) >= 0 && opts[i] >= 36) { add(bar, 14, { i: 'bass', m: opts[i], v: 0.55, d: 0.5 }); break; }
        }
      } else if (e >= 1 && AU_ch(0.5)) add(bar, 8, { i: 'bass', m: c0.bassN, v: 0.6, d: 1.5 });
    } else if (beats === 3 && e >= 2 && AU_ch(0.5)) add(bar, 8, { i: 'bass', m: c0.alt, v: 0.55, d: 1 });
  }
  // --- pad (merged over repeated chords) ---
  if (inst.pad) {
    var flat = [];
    for (bar = 0; bar < nb; bar++) segs[bar].forEach(function (sg) { flat.push({ c: sg.c, bar: bar, st: sg.s0, len: (sg.s1 - sg.s0) / 4 }); });
    for (i = 0; i < flat.length; i++) {
      var f0 = flat[i], len0 = f0.len;
      while (i + 1 < flat.length && flat[i + 1].c.sym === f0.c.sym && len0 < beats * 2) { len0 += flat[i + 1].len; i++; }
      f0.c.pad.forEach(function (m) { add(f0.bar, f0.st, { i: 'pad', m: m, v: inst.pad, d: len0 }); });
    }
  }
  // --- light percussion ---
  var pl = isEnd ? 0 : inst.perc, ps = th.perc;
  if (pl > 0 && ps !== 'none') for (bar = 0; bar < nb; bar++) {
    if (beats === 4) {
      if (ps === 'full') { var sv = [0.5, 0.32, 0.72, 0.32, 0.5, 0.32, 0.72, 0.4]; for (i = 0; i < 8; i++) add(bar, i * 2, { i: 'shaker', v: sv[i] * AU_rr(0.9, 1.1) }); }
      else if (ps === 'brush') { for (i = 0; i < 8; i++) add(bar, i * 2, { i: 'shaker', v: (i % 2 ? 0.5 : 0.28) * AU_rr(0.9, 1.1) }); }
      else { add(bar, 4, { i: 'shaker', v: 0.55 }); add(bar, 12, { i: 'shaker', v: 0.55 }); if (AU_ch(0.6)) add(bar, 14, { i: 'shaker', v: 0.3 }); if (AU_ch(0.4)) add(bar, 6, { i: 'shaker', v: 0.3 }); }
      if (pl >= 2) {
        add(bar, 0, { i: 'kick', v: ps === 'soft' ? 0.55 : 0.85 });
        if (ps !== 'soft') { add(bar, 10, { i: 'kick', v: 0.5 }); add(bar, 4, { i: 'brush', v: 0.6 }); add(bar, 12, { i: 'brush', v: 0.62 }); }
        else add(bar, 8, { i: 'brush', v: 0.35 });
        if (bar === nb - 1 && ps !== 'soft' && AU_ch(0.5)) { add(bar, 13, { i: 'brush', v: 0.3 }); add(bar, 14, { i: 'brush', v: 0.42 }); add(bar, 15, { i: 'brush', v: 0.55 }); }
      }
    } else { add(bar, 4, { i: 'shaker', v: 0.45 }); add(bar, 8, { i: 'shaker', v: 0.4 }); if (pl >= 2) add(bar, 0, { i: 'kick', v: 0.5 }); }
  }
  // --- the tune ---
  var tune = null, lead = inst.lead;
  if (lead) tune = inst.m === 'gen' ? AU_genMelody(P, def, segAt) : def.tunes[inst.m % def.tunes.length];
  if (tune) {
    var oct = AU_LEAD_OCT[lead] || 0;
    tune.forEach(function (notes, b) {
      var shape = 0.9 + 0.1 * Math.sin(Math.PI * ((b % 4) + 0.5) / 4);
      notes.forEach(function (n, j) {
        var st = Math.round(n[0] * 4), vel = (st % 8 === 0 ? 0.88 : 0.72) * shape * AU_rr(0.94, 1.05);
        var fin = isEnd && b >= nb - 2;
        add(b, st, { i: lead, m: n[2] + oct, v: vel, d: fin ? beats * 2 : n[1], mel: 1, o: fin ? 0.4 : 0 });
        if (inst.harm && n[1] >= 1 && !fin) { var h = AU_harmBelow(n[2] + oct, segAt(b, st).c); if (h != null) add(b, st, { i: lead, m: h, v: vel * 0.5, d: n[1] }); }
        if (lead === 'marimba' && !fin) add(b, st, { i: lead, m: n[2] + oct - 12, v: vel * 0.45, d: n[1] });        // octave doubling: warmer
        if (inst.spark && j === 0 && b % 4 === 0) add(b, st, { i: 'glock', m: n[2] + 12, v: 0.6, d: 2 });
      });
      if (inst.echo && notes.length >= 2) {                                    // call and response
        var ln = notes[notes.length - 1], end = ln[0] + ln[1], rest = beats - end;
        if (rest >= 1.5) {
          var take = notes.slice(-Math.min(3, notes.length, Math.floor(rest * 2))), eo = AU_LEAD_OCT[inst.echo] || 0, start = end + (rest - take.length * 0.5 >= 0.5 ? 0.5 : 0);
          take.forEach(function (n, j) { add(b, Math.round((start + j * 0.5) * 4), { i: inst.echo, m: n[2] + eo, v: 0.55, d: j === take.length - 1 ? 0.75 : 0.5, echo: 1 }); });
        }
      }
    });
  }
  var rit = null;
  if (isEnd) { rit = []; for (bar = 0; bar < nb; bar++) rit.push(bar === 0 ? [1, 0.96] : bar === 1 ? [0.96, 0.8] : [0.8, 0.8]); }
  return { k: inst.k, inst: inst, nbars: nb, spb: spb, ev: ev, segs: segs, rit: rit, e: e };
}

// ---------------------------------------------------------------------------------------------------------------------
// The conductor: which section comes next, and how it is dressed
// ---------------------------------------------------------------------------------------------------------------------
function AU_makeOrder(P) {
  var th = P.theme, L = th.leads, seen = { A: 0, B: 0, C: 0 }, tpl;
  if (th.sec.C) tpl = AU_rp([['A0', 'A1', 'B0', 'C0', 'Ag', 'B1', 'A1'], ['A0', 'B0', 'A1', 'C0', 'B1', 'Ag', 'A1'], ['A0', 'A1', 'C0', 'B0', 'Ag', 'C0', 'B1', 'A1'],
    ['A1', 'C0', 'A0', 'B0', 'Ag', 'B1', 'C0', 'A1'], ['B0', 'A0', 'A1', 'C0', 'Bg', 'A1', 'B1'], ['A0', 'Ag', 'B0', 'C0', 'A1', 'B1', 'A0']]);
  else tpl = AU_rp([['A0', 'B0', 'A0', 'Bg', 'A0'], ['A0', 'B0', 'Ag', 'B0', 'A0'], ['A0', 'A0', 'B0', 'A0', 'Bg'], ['A0', 'B0', 'A0', 'B0', 'Ag']]);
  var quiet = th.perc === 'none';
  return tpl.map(function (code, i) {
    var k = code[0], m = code[1] === 'g' ? 'gen' : +code[1], n = seen[k]++;
    var e = quiet ? (i === 0 ? 1 : 2) : (i === 0 || k === 'C' ? 1 : 2);
    var lead = m === 'gen' ? th.genLead : L[k][n % L[k].length];
    return { k: k, m: m, e: e, lead: lead, harm: (k === 'A' && n >= 1 && m !== 'gen') || (quiet && n >= 1 && lead !== 'flute'), echo: th.sec[k].cr ? th.echo : null,
      spark: n >= 1 && k === 'A', bass: quiet ? i > 0 : true, pad: quiet ? 1 : (e >= 2 ? 1 : 0.8), perc: quiet ? 0 : (i === 0 || k === 'C' ? 1 : 2), fill: !quiet };
  });
}
function AU_nextSection(P) {
  var idx = P.secIdx++, inst;
  if (idx === 0) inst = { k: 'I', m: 0, e: 0, lead: P.theme.endLead, pad: 0.7, bass: false, perc: 0 };
  else if (P.ending) { P.done = true; P.endT = P.nextT; return; }
  else if ((P.wrapUp && idx > 1) || (P.nextT - P.startT) >= P.target) { inst = { k: 'O', m: 0, e: 0, lead: P.theme.endLead, pad: 0.8, bass: true, perc: 0 }; P.ending = true; }
  else { var n = idx - 1, o = P.order; inst = o[n < o.length ? n : 1 + (n - 1) % (o.length - 1)]; }
  P.sec = AU_buildSection(P, inst); P.bar = 0; P.step = 0;
  if (AU_M.log) AU_M.log.push({ t: +P.nextT.toFixed(3), sec: inst.k, th: P.th, lead: inst.lead, m: inst.m, e: inst.e });
}
function AU_pieceGraph(S) {
  var ctx = S.ctx, M = AU_M, out = ctx.createGain(), wet = ctx.createGain(), B = { dry: out, wet: wet }, L = {}, k;
  out.connect(M.root); wet.connect(M.rootWet);
  for (k in AU_LAYERS) L[k] = AU_group(S, B, 1, AU_LAYERS[k][1], AU_LAYERS[k][0]);
  var padLP = ctx.createBiquadFilter(); padLP.type = 'lowpass'; padLP.frequency.value = 1500; padLP.Q.value = 0.5; padLP.connect(L.pad.node);
  var accEQ = ctx.createBiquadFilter(); accEQ.type = 'peaking'; accEQ.frequency.value = 190; accEQ.Q.value = 0.9; accEQ.gain.value = 3.5;
  var accLP = ctx.createBiquadFilter(); accLP.type = 'lowpass'; accLP.frequency.value = 5200; accLP.Q.value = 0.5;
  accEQ.connect(accLP); accLP.connect(L.acc.node);
  return { out: out, wet: wet, L: L, padLP: padLP, accIn: accEQ, extra: [padLP, accEQ, accLP] };
}
function AU_startPiece(name, at) {
  var S = AU_S, M = AU_M, th = AU_theme(name), g = AU_pieceGraph(S);
  var P = { th: name, theme: th, g: g, bpm: th.bpm * AU_rr(0.975, 1.025), secIdx: 0, sec: null, bar: 0, step: 0, nextT: at, startT: at, done: false, ending: false, wrapUp: false, endT: 0 };
  P.target = name === 'title' ? AU_rr(80, 115) : name === 'summary' ? AU_rr(70, 105) : AU_rr(100, 160);
  P.order = AU_makeOrder(P);
  S.keyTr = AU_mod(th.keyPc + 5, 12) - 5;                 // effects follow the key of the music
  M.piece = P; M.pieces++; M.lastTheme = name; M.buildApplied = -1;
  if (M.log) M.log.push({ t: +at.toFixed(3), piece: name, bpm: +P.bpm.toFixed(1), key: th.key });
  return P;
}
function AU_retirePiece(P, now, fade) {
  var g = P.g;
  try {
    if (fade > 0) { g.out.gain.setValueAtTime(1, now); g.out.gain.linearRampToValueAtTime(0, now + fade); g.wet.gain.setValueAtTime(1, now); g.wet.gain.linearRampToValueAtTime(0, now + fade); }
  } catch (e) {}
  AU_M.old.push({ g: g, kill: now + Math.max(fade, 0) + (fade > 0 ? 0.3 : 5.5) });
}
function AU_killGraph(g) {
  try { g.out.disconnect(); g.wet.disconnect(); } catch (e) {}
  for (var k in g.L) AU_free(g.L[k]);
  g.extra.forEach(function (n) { try { n.disconnect(); } catch (e) {} });
}
function AU_zone(f) { return f < 0.36 ? 'morning' : f < 0.70 ? 'midday' : 'evening'; }
function AU_themeFor(sc) {
  if (sc.mode === 'title') return 'title';
  if (sc.mode === 'summary') return 'summary';
  return AU_zone(AU_clamp(sc.dayFrac + AU_M.rate * 25, 0, 1));
}
function AU_themeGroup(n) { return n === 'title' || n === 'summary' ? n : 'day'; }

function AU_playEv(P, e, t, beatSec) {
  var S = AU_S, M = AU_M, ins = e.i, lv = AU_LV[ins] != null ? AU_LV[ins] : 0.2, v = e.v * lv, L = P.g.L, dur = (e.d || 0.25) * beatSec;
  if (e.o) t += e.o;
  if (v <= 0 || AU_VOL.music <= 0.001) return;              // muted: keep time, make no sound, spend no CPU
  if (S.voices > 150 && !e.mel) return;                        // CPU guard: keep the tune, drop the rest
  if (M.log && e.m != null) M.log.push({ t: +t.toFixed(3), i: ins, m: e.m, d: +(e.d || 0).toFixed(2), bar: P.bar, st: P.step, sec: P.sec.k, ch: P.curChord, mel: e.mel ? 1 : 0 });
  switch (ins) {
    case 'guitar': case 'harp': AU_pluck(S, L.acc, t, e.m, v, dur, ins, P.g.accIn); break;
    case 'kalimba': case 'marimba': case 'musicbox': case 'glock': AU_mallet(S, L.lead, t, AU_hz(e.m), v, ins, ins === 'marimba' ? 1.15 : 1); break;
    case 'flute': AU_flute(S, L.wind, t, e.m, v, dur); break;
    case 'pad': if (S.voices < 110) AU_padNote(S, L.pad, t, e.m, v, dur, P.g.padLP); break;
    case 'bass': AU_bassNote(S, L.bass, t, e.m, v, dur); break;
    default: if (S.voices < 110) AU_percHit(S, L.perc, t, ins, v);
  }
}
// One sixteenth-note step of the current piece.
function AU_step(P, silent) {
  var M = AU_M, S = AU_S, sec = P.sec;
  if (!sec || P.bar >= sec.nbars) { AU_nextSection(P); if (P.done) return; sec = P.sec; }
  var th = P.theme, spb = sec.spb, bpm = P.bpm * (1 + 0.03 * M.tens);
  if (sec.rit) { var r = sec.rit[P.bar]; bpm *= r[0] + (r[1] - r[0]) * P.step / spb; }
  var stepDur = 15 / bpm, beatSec = stepDur * 4, t = P.nextT;
  if (th.swing && P.step % 4 === 2) t += th.swing * stepDur * 2;
  if (!silent) {
    var list = sec.ev[P.bar * spb + P.step], sg = sec.segs[P.bar], seg = sg.length > 1 && P.step >= sg[1].s0 ? sg[1] : sg[0], i;
    P.curChord = seg.c.sym;
    var floor = S.ctx.currentTime + 0.004;
    if (list) for (i = 0; i < list.length; i++) {
      var e = list[i], jit = e.i === 'pad' ? 0 : (e.i === 'bass' || e.i === 'kick' ? 0.003 : 0.007) * (AU_r() * 2 - 1);
      AU_playEv(P, e, Math.max(floor, t + jit), beatSec);
    }
    // live layers that follow the game: a little extra rhythm when things get hectic, a soft "planning" figure in build mode
    if (sec.e >= 1 && !sec.rit && th.beats === 4) {
      if (M.tens > 0.18) {
        var tv = AU_clamp((M.tens - 0.18) / 0.6, 0, 1), cp = { 3: ['conga', 0.5], 6: ['congaH', 0.7], 11: ['conga', 0.5], 14: ['congaH', 0.65] }[P.step];
        if (P.step % 4 === 3) AU_percHit(S, P.g.L.perc, Math.max(floor, t), 'shaker', 0.3 * tv * AU_LV.shaker);
        if (cp && tv > 0.3) AU_percHit(S, P.g.L.perc, Math.max(floor, t), cp[0], cp[1] * tv * AU_LV.conga);
        if (P.step % 4 === 0 && P.step > 0 && tv > 0.6 && th.perc !== 'full') AU_percHit(S, P.g.L.perc, Math.max(floor, t), 'wood', 0.5 * tv * AU_LV.wood);
      }
    }
    if (M.build > 0.06 && sec.e >= 1 && !sec.rit && P.step % 2 === 0) {
      var seq = th.beats === 3 ? [0, 1, 2, 1, 2, 1] : [0, 2, 1, 2, 0, 1, 2, 1], pv = seg.c.pad, pm = pv[seq[(P.step / 2) % seq.length] % pv.length] + 12;
      if (M.log) M.log.push({ t: +t.toFixed(3), i: 'plan', m: pm, d: 0.5, bar: P.bar, st: P.step, sec: sec.k, ch: seg.c.sym, mel: 0 });
      AU_mallet(S, P.g.L.plan, Math.max(floor, t), AU_hz(pm), (P.step % 8 === 0 ? 0.34 : 0.24) * M.build, 'marimba', 0.9);
    }
  }
  P.nextT += stepDur;
  if (++P.step >= spb) { P.step = 0; P.bar++; }
}
function AU_applyBuild(P, now) {
  var M = AU_M, b = M.build < 0.015 ? 0 : M.build;
  if (Math.abs(b - M.buildApplied) < 0.015 && !(b === 0 && M.buildApplied !== 0)) return;
  M.buildApplied = b;
  var L = P.g.L, tc = 0.22;
  // Keep full, cheerful music playing during and after building (only a subtle 10% warm blend in build mode)
  L.lead.node.gain.setTargetAtTime(1 - 0.10 * b, now, tc); L.wind.node.gain.setTargetAtTime(1 - 0.10 * b, now, tc);
  L.perc.node.gain.setTargetAtTime(1 - 0.08 * b, now, tc); L.bass.node.gain.setTargetAtTime(1 - 0.05 * b, now, tc);
  L.acc.node.gain.setTargetAtTime(1 - 0.05 * b, now, tc); L.pad.node.gain.setTargetAtTime(1 + 0.10 * b, now, tc);
}
function AU_conduct(now, hz) {
  var M = AU_M, sc = M.scene, want = AU_themeFor(sc), P = M.piece;
  if (P) {
    if (AU_themeGroup(P.th) !== AU_themeGroup(want)) {                    // title <-> day <-> summary: quick crossfade into the new piece
      AU_retirePiece(P, now, 0.55); M.piece = P = null; M.gapUntil = now + 0.65;
    } else if (P.th !== want && !P.wrapUp) { P.wrapUp = true; }           // the day moved on: finish this section, then end
  } else if (AU_themeGroup(M.lastTheme) !== AU_themeGroup(want) && M.gapUntil > now + 0.8) M.gapUntil = now + 0.65;   // do not sit in a long pause after a scene change
  if (!P && now >= M.gapUntil) P = AU_startPiece(want, Math.max(now + 0.05, M.gapUntil));
  if (!P) return;
  AU_applyBuild(P, now);
  var guard = 0;
  if (P.nextT < now - 0.02) { while (!P.done && P.nextT < now + 0.03 && guard++ < 4000) AU_step(P, true); }   // fell behind (tab was asleep): skip, do not bunch up
  guard = 0;
  while (!P.done && P.nextT < hz && guard++ < 96) AU_step(P, false);
  if (P.done) {
    var g = AU_rr(1.2, 2.4);                                              // short natural breath between pieces so music never stops
    M.gapUntil = P.endT + g;
    if (M.log) M.log.push({ t: +P.endT.toFixed(3), end: P.th, gap: +g.toFixed(1) });
    AU_retirePiece(P, P.endT, 0); M.piece = null;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Ambience: birds, breeze, evening crickets outdoors; room tone and a wall clock indoors
// ---------------------------------------------------------------------------------------------------------------------
function AU_makeCricket(ctx) {
  var sr = ctx.sampleRate, n = Math.floor(sr * 4.2), b = ctx.createBuffer(1, n, sr), d = b.getChannelData(0), t = 0.05, f = 4350;
  while (t < 4.0) {
    var pulses = 3 + (Math.random() < 0.3 ? 1 : 0);
    for (var p = 0; p < pulses; p++) {
      var s0 = Math.floor((t + p * 0.019) * sr), len = Math.floor(0.011 * sr);
      for (var i = 0; i < len && s0 + i < n; i++) d[s0 + i] += Math.sin(2 * Math.PI * f * i / sr) * Math.pow(Math.sin(Math.PI * i / len), 2) * (0.7 + 0.3 * p / pulses);
    }
    t += 0.36 + Math.random() * 0.12 + (Math.random() < 0.12 ? 0.5 : 0);
  }
  return b;
}
var AU_BIRDS = {
  chirp: function (S, G, t) {
    var n = 2 + Math.floor(Math.random() * 4), f = AU_rnd(3100, 4300);
    for (var i = 0; i < n; i++) { var ff = f * AU_rnd(0.96, 1.04); AU_tone(S, G, { t: t, f: ff, fp: [[0.03, ff * 1.32], [0.075, ff * 0.82]], dur: 0.09, vol: 0.8, a: 0.008, k: 0.05 }); t += AU_rnd(0.11, 0.17); }
  },
  warble: function (S, G, t) {
    var n = 5 + Math.floor(Math.random() * 4);
    for (var i = 0; i < n; i++) {
      var f = AU_rnd(2100, 4000), d = AU_rnd(0.07, 0.15);
      AU_tone(S, G, { t: t, f: f, f2: f * AU_rnd(0.78, 1.3), dur: d, vol: 0.7, a: 0.012, k: 0.08, vib: (Math.random() < 0.4) ? { rate: AU_rnd(24, 34), depth: AU_rnd(60, 160), delay: 0, ramp: 0.02 } : null });
      t += d + AU_rnd(0.02, 0.07);
    }
  },
  feebee: function (S, G, t) {
    var f = AU_rnd(3500, 4000);
    AU_tone(S, G, { t: t, f: f, f2: f * 0.975, dur: 0.36, vol: 0.7, a: 0.04, hold: 0.2, k: 0.03 });
    AU_tone(S, G, { t: t + 0.43, f: f * 0.84, f2: f * 0.83, dur: 0.4, vol: 0.65, a: 0.04, hold: 0.22, k: 0.03 });
  },
  trill: function (S, G, t) {
    var f = AU_rnd(3600, 5000), d = AU_rnd(0.5, 0.9);
    AU_tone(S, G, { t: t, f: f, f2: f * AU_rnd(0.92, 1.06), dur: d, vol: 0.55, a: d * 0.4, k: 0.03, vib: { rate: AU_rnd(22, 30), depth: 240, delay: 0, ramp: 0.02 } });
  },
  teacher: function (S, G, t) {
    var f = AU_rnd(3900, 4500), n = 3 + Math.floor(Math.random() * 2);
    for (var i = 0; i < n; i++) { AU_tone(S, G, { t: t, f: f, dur: 0.085, vol: 0.7, a: 0.01, k: 0.05 }); AU_tone(S, G, { t: t + 0.1, f: f * 0.79, dur: 0.11, vol: 0.7, a: 0.01, k: 0.05 }); t += 0.27; }
  },
  dove: function (S, G, t) {
    var f = AU_rnd(440, 510);
    [[0, 0.26, 1, 0.6], [0.34, 0.5, 1.19, 1], [0.98, 0.3, 1, 0.7], [1.4, 0.3, 1, 0.65]].forEach(function (n) {
      AU_tone(S, G, { t: t + n[0], f: f * n[2] * 0.97, fp: [[n[1] * 0.4, f * n[2]], [n[1], f * n[2] * 0.96]], dur: n[1], vol: 1.1 * n[3], a: 0.06, hold: n[1] * 0.4, k: 0.03, type: 'triangle', flt: { type: 'lowpass', f: 900, q: 0.6 } });
    });
  }
};
function AU_ambStart(S) {
  var ctx = S.ctx, M = AU_M, A = { src: [], nextBird: 0, nextBreeze: 0, nextTick: 0, cur: {} };
  A.outLP = ctx.createBiquadFilter(); A.outLP.type = 'lowpass'; A.outLP.frequency.value = 16000; A.outLP.Q.value = 0.5;
  A.outG = ctx.createGain(); A.outG.gain.value = 1; A.outLP.connect(A.outG); A.outG.connect(M.ambRoot);
  A.birdWet = ctx.createGain(); A.birdWet.gain.value = 1; A.birdWet.connect(M.ambWet);
  A.birdBus = { dry: A.outLP, wet: A.birdWet };
  A.inG = ctx.createGain(); A.inG.gain.value = 0; A.inG.connect(M.ambRoot);
  A.inBus = { dry: A.inG, wet: null };
  function loop(buf, off, rate) { var s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; if (rate) s.playbackRate.value = rate; s.start(0, off % buf.duration); A.src.push(s); return s; }
  // breeze: two slow, dark noise beds left and right + a faint leafy rustle
  A.brG = []; A.brLP = [];
  [-0.55, 0.55].forEach(function (pan, i) {
    var s = loop(S.pink, i * 1.9 + 0.3), lp = ctx.createBiquadFilter(), g = ctx.createGain(), p = ctx.createStereoPanner();
    lp.type = 'lowpass'; lp.frequency.value = 420; lp.Q.value = 0.4; g.gain.value = 0; p.pan.value = pan;
    var hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 150; hp.Q.value = 0.5;
    s.connect(hp); hp.connect(lp); lp.connect(g); g.connect(p); p.connect(A.outLP); A.brG.push(g); A.brLP.push(lp);
  });
  var ls = loop(S.noise, 0.7), lb = ctx.createBiquadFilter(), lh = ctx.createBiquadFilter();
  lb.type = 'bandpass'; lb.frequency.value = 3400; lb.Q.value = 0.5; lh.type = 'highpass'; lh.frequency.value = 1800;
  A.leafG = ctx.createGain(); A.leafG.gain.value = 0; ls.connect(lb); lb.connect(lh); lh.connect(A.leafG); A.leafG.connect(A.outLP);
  // crickets and the indoor room tone are switched on only while they can be heard (see AU_ambLoops)
  A.crG = ctx.createGain(); A.crG.gain.value = 0; A.crG.connect(A.outLP);
  A.loop = loop; A.crSrc = null; A.roomSrc = null; A.crOff = 0; A.roomOff = 0;
  M.amb = A;
  return A;
}
function AU_ambLoops(A, S, now, crick, ind) {
  var ctx = S.ctx;
  function drop(list) { list.forEach(function (n) { try { if (n.stop) n.stop(); n.disconnect(); } catch (e) {} var i = A.src.indexOf(n); if (i >= 0) A.src.splice(i, 1); }); }
  if (crick > 0.005) {
    A.crOff = now + 6;
    if (!A.crSrc) {
      if (!A.crBuf) A.crBuf = AU_makeCricket(ctx);
      A.crSrc = [];
      [[1, 0.5, -0.5, 0], [0.93, 0.34, 0.35, 1.3], [1.07, 0.28, 0.75, 2.6]].forEach(function (c) {
        var s = A.loop(A.crBuf, c[3], c[0]), g = ctx.createGain(), p = ctx.createStereoPanner(); g.gain.value = c[1]; p.pan.value = c[2];
        s.connect(g); g.connect(p); p.connect(A.crG); A.crSrc.push(s, g, p);
      });
    }
  } else if (A.crSrc && now > A.crOff) { drop(A.crSrc); A.crSrc = null; }
  if (ind) {
    A.roomOff = now + 6;
    if (!A.roomSrc) {
      var rs = A.loop(S.pink, 2.2), rl = ctx.createBiquadFilter(), rg = ctx.createGain();
      rl.type = 'bandpass'; rl.frequency.value = 190; rl.Q.value = 0.45; rg.gain.value = 0.09; rs.connect(rl); rl.connect(rg); rg.connect(A.inG);
      A.roomSrc = [rs, rl, rg];
    }
  } else if (A.roomSrc && now > A.roomOff) { drop(A.roomSrc); A.roomSrc = null; }
}
function AU_setP(A, key, param, v, now, tc) {          // only touch a parameter when its target really changed
  if (A.cur[key] != null && Math.abs(A.cur[key] - v) < 0.004 * Math.max(1, Math.abs(v))) return;
  A.cur[key] = v; param.setTargetAtTime(v, now, tc);
}
function AU_ambTick(now, hz) {
  var M = AU_M, S = AU_S, A = M.amb, sc = M.scene; if (!A) return;
  var f = AU_clamp(sc.dayFrac, 0, 1), birds, crick, wind;
  if (sc.mode === 'title') { birds = 0.55; crick = 0; wind = 0.8; }
  else if (sc.mode === 'summary') { birds = 0; crick = 1; wind = 0.6; }
  else {
    birds = f < 0.5 ? 1 - 0.8 * f : f < 0.8 ? 0.6 - (f - 0.5) * 0.9 : Math.max(0.08, 0.33 - (f - 0.8) * 1.3);
    var x = AU_clamp((f - 0.72) / 0.25, 0, 1); crick = x * x * (3 - 2 * x); wind = 0.85;
  }
  var ind = sc.indoors && sc.mode !== 'title' && sc.mode !== 'summary' ? 1 : 0;
  AU_ambLoops(A, S, now, crick, ind);
  AU_setP(A, 'lp', A.outLP.frequency, ind ? 850 : 16000, now, 0.5);
  AU_setP(A, 'og', A.outG.gain, ind ? 0.4 : 1, now, 0.5);
  AU_setP(A, 'bw', A.birdWet.gain, ind ? 0.25 : 1, now, 0.5);
  AU_setP(A, 'ig', A.inG.gain, ind, now, 0.6);
  AU_setP(A, 'cr', A.crG.gain, crick * 0.14, now, 2.5);
  A.ind = ind;
  if (now >= A.nextBreeze) {                           // the breeze wanders
    A.nextBreeze = now + AU_rnd(2.2, 4.5);
    for (var i = 0; i < 2; i++) {
      A.brG[i].gain.setTargetAtTime(wind * AU_rnd(0.06, 0.2), now, AU_rnd(1.2, 2.4));
      A.brLP[i].frequency.setTargetAtTime(AU_rnd(280, 620), now, 1.8);
    }
    var gust = Math.pow(Math.random(), 2.2);
    A.leafG.gain.setTargetAtTime(wind * (0.004 + 0.02 * gust), now, AU_rnd(1, 2));
  }
  if (A.nextBird < now) A.nextBird = now + AU_rnd(0.4, 2.5);
  while (A.nextBird < hz) {
    if (birds > 0.04 && AU_VOL.ambience > 0.001) {
      var far = AU_rnd(0.25, 1), kind, r = Math.random();
      if (f > 0.6 && sc.mode !== 'title') kind = r < 0.3 ? 'dove' : r < 0.5 ? 'feebee' : r < 0.7 ? 'warble' : r < 0.85 ? 'chirp' : 'trill';
      else kind = r < 0.3 ? 'chirp' : r < 0.55 ? 'warble' : r < 0.7 ? 'feebee' : r < 0.82 ? 'teacher' : r < 0.93 ? 'trill' : 'dove';
      var G = AU_group(S, A.birdBus, 0.25 * (0.35 + 0.65 * far) * (0.6 + 0.4 * birds), 0.25 + 0.55 * (1 - far), AU_rnd(-0.85, 0.85));
      try { AU_BIRDS[kind](S, G, A.nextBird); } finally { G.sealed = true; if (G.n <= 0) AU_free(G); }
      if ((Math.random() < 0.25 * birds)) A.nextBird += AU_rnd(0.9, 1.8);          // sometimes a quick answer
      else A.nextBird += AU_rnd(2.2, 6) / (0.35 + birds * 0.9);
    } else A.nextBird += 2;
  }
  if (A.nextTick < now) A.nextTick = Math.ceil(now + 0.05);
  while (A.nextTick < hz) {                                            // wall clock, only heard indoors
    if (A.ind && AU_VOL.ambience > 0.001) {
      var tock = Math.round(A.nextTick) % 2, Gt = AU_group(S, A.inBus, 0.05, 0, 0.3);
      try {
        AU_noise(S, Gt, { t: A.nextTick, dur: 0.014, vol: 0.8, f: tock ? 2500 : 3300, q: 3, a: 0.001 });
        AU_tone(S, Gt, { t: A.nextTick, f: tock ? 1650 : 2100, dur: 0.03, vol: 0.35, a: 0.001 });
        AU_tone(S, Gt, { t: A.nextTick, f: tock ? 410 : 520, dur: 0.04, vol: 0.3, a: 0.002 });
      } finally { Gt.sealed = true; }
    }
    A.nextTick += 1;
  }
}

// Called by sfx(): let an important jingle speak by dipping the music for a moment.
function AU_duck(t, depth, dur) {
  var M = AU_M, S = AU_S;
  if (!M.on || !M.duck || !S) return;
  var now = S.ctx.currentTime, start = Math.max(now, t), end = start + Math.max(0.15, dur || 0.8);
  M.duckUntil = Math.max(M.duckUntil || 0, end + 0.4);
  [M.duck, M.duckWet].forEach(function (g) {
    try {
      var cur = g.gain.value;
      g.gain.cancelScheduledValues(now);
      g.gain.setValueAtTime(isFinite(cur) ? AU_clamp(cur, 0.25, 1) : 1, now);
      g.gain.setTargetAtTime(AU_clamp(depth, 0.3, 1), start, 0.05);
      g.gain.setTargetAtTime(1, end, 0.25);
    } catch (e) {}
  });
}
// ---------------------------------------------------------------------------------------------------------------------
// Scheduler and public object
// ---------------------------------------------------------------------------------------------------------------------
function AU_musicTick() {
  var M = AU_M, S = AU_S;
  if (!M.on || !S) return;
  try {
    var hidden = M.forceHidden || (typeof document !== 'undefined' && document.hidden && !M.manual);
    if (!hidden && S.ctx && (S.ctx.state === 'suspended' || S.ctx.state === 'interrupted') && S.ctx.resume) {
      try { var pr = S.ctx.resume(); if (pr && pr.catch) pr.catch(function () {}); } catch (e) {}
    }
    if (typeof AU_sweepVoices === 'function') AU_sweepVoices(S);
    var now = S.ctx.currentTime;
    if (M.duck && M.duckUntil && now > M.duckUntil + 0.8) {
      M.duckUntil = 0;
      [M.duck, M.duckWet].forEach(function (g) {
        try { g.gain.cancelScheduledValues(now); g.gain.setTargetAtTime(1, now, 0.15); } catch (e) {}
      });
    }
    var hz = now + (hidden ? 1.7 : 0.45), dt = Math.max(0, Math.min(2, now - M.lastNow));
    M.lastNow = now;
    var sc = M.scene, bt = sc.mode === 'build' ? 1 : 0, tt = sc.mode === 'play' ? AU_clamp(sc.tension, 0, 1) : 0;
    M.tens += (tt - M.tens) * (1 - Math.exp(-dt / 3));
    M.build += (bt - M.build) * (1 - Math.exp(-dt / 0.5));
    AU_conduct(now, hz);
    AU_ambTick(now, hz);
    for (var i = M.old.length - 1; i >= 0; i--) if (now > M.old[i].kill) { AU_killGraph(M.old[i].g); M.old.splice(i, 1); }
    M.errs = 0;
  } catch (e) {
    M.errs++;
    if (typeof console !== 'undefined' && M.errs === 1) console.warn('music:', e);
  }
}
var Music = {
  start: function (opts) {
    var M = AU_M, S = AU_S;
    opts = opts || {};
    if (!S) { AU_AUTOSTART = true; return; }                          // no audio yet: audioInit() will start us
    if (M.on) return;
    try {
      var ctx = S.ctx, now = ctx.currentTime;
      if (opts.seed != null) AU_seed(opts.seed); else AU_seed((Date.now() ^ (Math.random() * 0x7fffffff)) >>> 0);
      M.log = opts.log ? [] : null;
      M.root = ctx.createGain(); M.rootWet = ctx.createGain(); M.ambRoot = ctx.createGain(); M.ambWet = ctx.createGain();
      [M.root, M.rootWet, M.ambRoot, M.ambWet].forEach(function (g) { g.gain.setValueAtTime(0, now); g.gain.linearRampToValueAtTime(1, now + 0.6); });
      M.duck = ctx.createGain(); M.duckWet = ctx.createGain();              // big jingles gently duck the music (see AU_duck)
      M.root.connect(M.duck); M.duck.connect(S.bus.music.dry); M.rootWet.connect(M.duckWet); M.duckWet.connect(S.bus.music.wet);
      M.ambRoot.connect(S.bus.ambience.dry); M.ambWet.connect(S.bus.ambience.wet);
      M.piece = null; M.old = []; M.gapUntil = now + 0.35; M.lastNow = now; M.tens = 0; M.build = 0; M.errs = 0; M.lastTheme = ''; M.fracAt = null; M.rate = 0;
      AU_ambStart(S);
      M.on = true; M.manual = !!opts.manual; M.seq++;
      if (!M.manual) {
        M.timer = setInterval(AU_musicTick, 100);
        if (typeof document !== 'undefined' && !M.vis) { M.vis = true; document.addEventListener('visibilitychange', function () { AU_musicTick(); }); }
        AU_musicTick();
      }
    } catch (e) { M.on = false; }
  },
  stop: function () {
    var M = AU_M, S = AU_S;
    AU_AUTOSTART = false;
    if (!M.on) return;
    M.on = false;
    if (M.timer) { clearInterval(M.timer); M.timer = null; }
    try {
      var now = S.ctx.currentTime, nodes = [M.root, M.rootWet, M.ambRoot, M.ambWet], A = M.amb, olds = M.old.slice(), P = M.piece, dk = [M.duck, M.duckWet];
      nodes.forEach(function (g) { g.gain.cancelScheduledValues(now); g.gain.setTargetAtTime(0, now, 0.04); });
      var kill = function () {
        nodes.concat(dk).forEach(function (g) { try { g.disconnect(); } catch (e) {} });
        if (A) A.src.forEach(function (s) { try { s.stop(); s.disconnect(); } catch (e) {} });
        if (P) AU_killGraph(P.g);
        olds.forEach(function (o) { AU_killGraph(o.g); });
      };
      if (M.manual) kill(); else setTimeout(kill, 350);
      M.piece = null; M.old = []; M.amb = null;
    } catch (e) {}
  },
  setScene: function (sc) {
    var M = AU_M, cur = M.scene;
    if (!sc) return;
    if (sc.mode === 'title' || sc.mode === 'play' || sc.mode === 'build' || sc.mode === 'summary') cur.mode = sc.mode;
    if (typeof sc.indoors === 'boolean') cur.indoors = sc.indoors;
    if (typeof sc.tension === 'number' && isFinite(sc.tension)) cur.tension = AU_clamp(sc.tension, 0, 1);
    if (typeof sc.dayFrac === 'number' && isFinite(sc.dayFrac)) {
      var f = AU_clamp(sc.dayFrac, 0, 1);
      cur.dayFrac = f;
      if (AU_S && M.on) {                                                      // how fast does the day run? (to time the themes)
        var now = AU_S.ctx.currentTime, fa = M.fracAt;
        if (!fa || f < fa.f || now - fa.t > 6) M.fracAt = { f: f, t: now };      // new day, or the clock stood still (pause): start measuring again
        else if (f > fa.f && now > fa.t + 1.5) {
          var r = (f - fa.f) / (now - fa.t);
          if (r > 0 && r < 0.05) M.rate = M.rate ? M.rate * 0.7 + r * 0.3 : r;
          M.fracAt = { f: f, t: now };
        }
      }
    }
  },
  isPlaying: function () { return !!AU_M.on; },
  info: function () {
    var M = AU_M, P = M.piece;
    return { state: !M.on ? 'stopped' : P ? 'piece' : 'pause', theme: P ? P.th : null, section: P && P.sec ? P.sec.k : null, bar: P ? P.bar : 0, bpm: P ? Math.round(P.bpm) : 0, tension: +M.tens.toFixed(2), build: +M.build.toFixed(2) };
  }
};
