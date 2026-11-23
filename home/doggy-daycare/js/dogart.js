'use strict';
// ============================================================================================
// dogart.js - side-view dog sprites for Paws & Play (every breed in breeds.js, every coat, all poses + emotes).
//
// PUBLIC API (globals)
//   drawDog(c, d, x, y, s, t, opt)
//       (x, y) = ground point between the feet, s = extra scale (1 = true size), t = seconds.
//       d   = { breed: id in BREEDS, coat: index, seed, face: 1 | -1, moving, speed (px/s), state, happy 0..100,
//               needs: { clean 0..100 }, anim: null | one of DOG_ANIMS, animT: seconds, collar: css colour | null, wet: 0..1,
//               walkDist: total world px walked (keeps growing), id }
//             every field is optional. moving -> walk (4-beat) or rotary gallop (speed > 110 or state 'play').
//             The gait phase comes from walkDist / stride, so paws on the ground stay planted at any speed
//             (without walkDist it falls back to t * speed). A small per-dog memory (keyed by d.id, else breed + seed)
//             starts each walk on the same foot and shows a half-way picture when setting off / stopping.
//             state 'eat' / 'nap' / 'kennel' -> eating / asleep; otherwise idle, or the emote in d.anim.
//             happy buckets: < 15 miserable (shivers), < 30 sad, <= 70 content, > 70 happy (pants, fast wag).
//             needs.clean < 40 / < 20 -> mud.   wet > 0.3 -> dark wet coat + drips.
//       opt = { noShadow, pose: force 'stand' | 'walk' | 'run' | 'nap' | 'eat' | any DOG_ANIMS name, frame: force a frame index,
//               live: true = always draw vectors (no sprite cache) }
//   dogMetrics(d) -> { w, h, headX, headY, topY }   standing bounds in world px at s = 1, facing right, relative to the feet
//   DOG_ANIMS, DOG_ANIM_DUR                          emote names / one-shot lengths in seconds (0 = loops)
//   DA_cacheStats(), DA_cacheClear(), DA_BUDGET_MS, DA_CAP_BYTES, DA_FORCE_MAX, DA_CACHE_ON   sprite-cache profiling + tuning
//
// HOW IT WORKS
//   A parametric skeleton renderer: every breed is one row of real-anatomy proportions (body length, chest depth, leg
//   length, head / muzzle / ear / tail type, coat type) + a named marking pattern, and all breeds share one pose system
//   (IK legs, chest + rump frames, neck / head / jaw / ears / tail chains). Cross-breeds start from a blend of their
//   parents' rows (DA_CROSS); a breed with no row of its own falls back to its parents (breed.cross) or a generic mutt.
//   Front leg: shoulder -> elbow (points back) -> wrist -> pastern -> paw; hind leg: hip -> stifle (forward) -> hock (back).
//   Animation is quantised into short looping frame cycles (idle 6 frames, walk 8, run 6, emotes 3-6 at 8 fps), and each
//   (breed, coat, collar, mood, clip, frame) picture is baked once into a small canvas at the exact device scale, then
//   blitted 1:1 on whole device pixels. Mud is a separate overlay sprite shared by every coat of the breed; the wet look
//   is a tinted copy of the normal sprite. Everyday clips keep a mirrored copy for left-facing dogs, rarer ones are blitted
//   flipped. A dog is never left undrawn: while a sprite is missing the nearest frame / other zoom / last picture is shown.
//   For the cache the context transform must be translate + uniform scale; give every dog the same t within a frame
//   (a change of t marks a new frame for the per-frame bake budget). Anything else falls back to live vectors.
//
// All private names are prefixed DA_.
// Units inside the renderer: 1.0 = height of the withers (top of the shoulder). +x = nose, +y = down.
// ============================================================================================

var DOG_ANIMS = ['sit', 'bark', 'beg', 'shake', 'wiggle', 'scratch', 'sniff', 'howl', 'playbow', 'dig', 'jump', 'sad', 'roll', 'poop', 'drink', 'pounce', 'wrestle'];
// suggested seconds for each emote (0 = open-ended). Every emote is a short loop, so any duration works:
// it eases in over its first frames of d.animT and, if d.animDur is set, eases back out at the end.
var DOG_ANIM_DUR = { sit: 0, bark: 0.625, beg: 0, shake: 1.1, wiggle: 1.4, scratch: 1.8, sniff: 2.2, howl: 2.6, playbow: 1.6, dig: 1.8, jump: 0.75, sad: 0, roll: 2.8, poop: 2.4, drink: 0, pounce: 0.9, wrestle: 0 };
// poop: sniffs until ~0.7 s, squats from ~0.8 s, relief + kick-back from ~1.9 s (spawn the poop behind the dog then).
// drink loops every 1.125 s (3 laps), wrestle every 1.25 s; pounce is one hop (crouch, spring, land, bounce).

var DA_TAU = Math.PI * 2, DA_HPI = Math.PI / 2, DA_RAD = Math.PI / 180;
var DA_OUT = '#3b2a20';

function DA_clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function DA_ss(t) { t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); }
function DA_frac(x) { return x - Math.floor(x); }
function DA_rnd(n) { var x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }

// ---------- colour helpers (used only when a palette is built, never per frame) ----------
function DA_rgb(h) {
  if (typeof h !== 'string') return [128, 128, 128];
  if (h.charAt(0) === '#') {
    if (h.length === 4) return [parseInt(h[1] + h[1], 16), parseInt(h[2] + h[2], 16), parseInt(h[3] + h[3], 16)];
    return [parseInt(h.substr(1, 2), 16), parseInt(h.substr(3, 2), 16), parseInt(h.substr(5, 2), 16)];
  }
  var m = /(\d+)[^\d]+(\d+)[^\d]+(\d+)/.exec(h);
  return m ? [+m[1], +m[2], +m[3]] : [128, 128, 128];
}
function DA_mix(a, b, t) {
  var x = DA_rgb(a), y = DA_rgb(b);
  function ch(i) { var v = Math.round(x[i] + (y[i] - x[i]) * t); v = v < 0 ? 0 : v > 255 ? 255 : v; return (v < 16 ? '0' : '') + v.toString(16); }
  return '#' + ch(0) + ch(1) + ch(2);
}
function DA_lum(col) { var r = DA_rgb(col); return r[0] * 0.3 + r[1] * 0.59 + r[2] * 0.11; }
function DA_lineOn(col) { return DA_lum(col) < 80 ? DA_mix(col, '#e6d6cc', 0.42) : DA_OUT; }
function DA_far(col) { return DA_mix(col, '#35241c', 0.26); }

// ---------- palettes: one per breed / coat / wetness bucket, built lazily ----------
var DA_PALS = {};
function DA_palette(b, ci, wetB) {
  var key = b.id + '|' + ci + '|' + wetB, Q = DA_PALS[key];
  if (Q) return Q;
  var co = (b.coats && (b.coats[ci] || b.coats[0])) || { base: '#c9935a', shade: '#a8743f', light: '#fbf1d8', pattern: 'solid' };
  var wet = wetB / 3, wc = '#2b3440';
  function W(col) { return wet > 0 ? DA_mix(col, wc, 0.2 * wet) : col; }
  var base = W(co.base), shade = W(co.shade || DA_mix(co.base, '#3b2a20', 0.25)), light = W(co.light || DA_mix(co.base, '#ffffff', 0.4));
  var mark = W(co.mark || shade), pat = co.pattern || 'solid';
  Q = { pat: pat, base: base, shade: shade, light: light, mark: mark,
    nose: co.nose || '#2a211e', eye: co.eye || null, eyeDark: '#2a1c15',
    line: DA_mix(shade, DA_OUT, 0.5), tongue: '#ee8596', tongueD: '#c9586c', mouth: '#6e2a2c', earPink: DA_mix('#e8a3a0', base, 0.35) };
  // colour slots. body / neck, f=front leg (U upper, L lower), h=hind leg (U thigh, M shank, L foot), tail, head parts.
  var S = { body: base, fU: base, fM: base, fL: base, hU: base, hM: base, hL: base, tail: base, tip: null, tailUnder: null,
    skull: base, muz: base, jaw: base, ear: shade, earTip: null, earIn: Q.earPink, beard: light, brow: null, top: base };
  switch (pat) {
    case 'solid': S.ear = DA_mix(base, shade, 0.85); S.jaw = DA_mix(base, shade, 0.35); break;
    case 'saddle-mask': S.fL = light; S.hL = light; S.tail = DA_mix(base, mark, 0.55); S.tip = mark; S.muz = mark; S.jaw = mark; S.ear = base; S.earTip = mark; break;
    case 'husky-mask': S.fM = light; S.fL = light; S.hM = light; S.hL = light; S.tip = light; S.tailUnder = light; S.muz = light; S.jaw = light; S.ear = base; break;
    case 'collie-blaze': S.fM = light; S.fL = light; S.hL = light; S.tip = light; S.muz = light; S.jaw = light; S.ear = base; break;
    case 'spots': S.ear = mark; S.jaw = base; break;
    case 'bernese-tricolor': S.fM = mark; S.fL = mark; S.hL = mark; S.tip = light; S.muz = light; S.jaw = light; S.ear = base; S.paw = light; break;
    case 'beagle-tricolor': S.fM = light; S.fL = light; S.hM = light; S.hL = light; S.tail = mark; S.tip = light; S.muz = light; S.jaw = light; S.ear = shade; break;
    case 'lemon-white': S.body = light; S.fU = light; S.fM = light; S.fL = light; S.hU = light; S.hM = light; S.hL = light; S.tail = base; S.tip = light; S.muz = light; S.jaw = light; S.ear = shade; break;
    case 'corgi': S.fM = light; S.fL = light; S.hM = light; S.hL = light; S.muz = light; S.jaw = light; S.ear = base; S.earTip = co.mark ? mark : null; break;
    case 'urajiro': S.fL = co.mark ? mark : DA_mix(base, light, 0.6); S.hL = S.fL; S.jaw = light; S.ear = base; S.tailUnder = light; S.paw = co.mark ? light : null; break;
    case 'tan-points': S.fL = mark; S.hL = mark; S.jaw = mark; S.ear = base; break;
    case 'pug-mask': S.muz = b.id === 'greatdane' ? DA_mix(mark, base, 0.18) : mark; S.jaw = S.muz; S.ear = b.id === 'pug' ? mark : DA_mix(shade, mark, 0.25); break;
    case 'brindle': S.ear = shade; S.muz = DA_mix(base, shade, 0.6); S.jaw = S.muz; break;
    case 'pied': S.ear = mark; S.jaw = base; break;
    case 'schnauzer': S.fM = light; S.fL = light; S.hM = light; S.hL = light; S.jaw = light; S.beard = light; S.brow = light; S.ear = shade; break;
    case 'yorkie': S.body = mark; S.tail = mark; S.hU = mark; S.ear = shade; S.beard = light; S.top = light; S.jaw = base; break;
    case 'parti': S.body = light; S.fU = light; S.fM = light; S.fL = light; S.hU = light; S.hM = light; S.hL = light; S.tip = light; S.muz = light; S.jaw = light; S.ear = co.mark ? mark : base; S.beard = light; break;
    // chestnut (or black) patches on white, white muzzle + blaze, coloured ears
    case 'blenheim': S.ear = mark; S.muz = light; S.jaw = light; S.beard = light; S.tip = light; S.fL = light; S.hL = light; break;
    // fawn / brindle with a black mask, white chest and socks
    case 'boxer': S.muz = DA_mix(mark, base, 0.12); S.jaw = mark; S.ear = DA_mix(base, mark, 0.45); S.fL = light; S.hL = light; S.paw = light; S.tip = DA_mix(base, mark, 0.3); break;
    // diluted marbled base with dark patches, white collar / legs / blaze, copper trim
    case 'merle': S.ear = mark; S.fM = light; S.fL = light; S.hL = light; S.muz = light; S.jaw = light; S.tip = light; S.beard = light; break;
    // Jack Russell: white dog with a coloured head (white muzzle + blaze) and a patch by the tail
    case 'jrt': S.skull = mark; S.ear = co.mark && DA_lum(co.mark) < 80 ? mark : DA_mix(mark, '#5a3420', 0.25); S.muz = light; S.jaw = light; break;
    // Great Dane harlequin: torn black patches on white
    case 'harlequin': S.ear = mark; S.jaw = base; break;
    // Boston tuxedo: black with white muzzle, blaze, chest, collar and feet
    case 'boston': S.muz = light; S.jaw = light; S.fL = light; S.hL = light; S.fM = DA_mix(base, light, 0.0); S.paw = light; S.ear = base; break;
    // Alfie: white body/legs/tail, warm brown head with white blaze & muzzle, dark-tipped erect ears
    case 'alfie':
      S.skull = mark; S.ear = mark; S.earTip = '#2f1e14'; S.muz = light; S.jaw = light;
      S.body = light; S.fU = light; S.fM = light; S.fL = light; S.hU = light; S.hM = light; S.hL = light; S.tail = light;
      break;
    // Teddy: curly silver-white body with dark grey head, floppy grey ears, white beard/muzzle, dark back patch
    case 'teddy':
      S.skull = mark; S.ear = '#35383e'; S.muz = light; S.jaw = light; S.beard = light; S.brow = '#b4b8be'; S.top = mark;
      S.body = base; S.fU = base; S.fM = light; S.fL = light; S.hU = base; S.hM = light; S.hL = light; S.tail = light;
      break;
  }
  // a pied coat whose base colour is not pale (e.g. fawn & white bulldog): white dog, patches in the base colour
  if (pat === 'pied' && DA_lum(co.base) < DA_lum(co.light || '#fff') - 45) {
    Q.piedInv = true; S.body = light; S.fU = light; S.fM = light; S.fL = light; S.hU = light; S.hM = light; S.hL = light; S.tail = light; S.muz = light; S.jaw = light; S.ear = base; S.skull = light;
  }
  // legL: lower legs and feet a shade paler than the coat (fluffy spitz), so little legs read under the fur skirt
  if (b.legL) { S.fL = DA_mix(S.fL, light, b.legL); S.hL = DA_mix(S.hL, light, b.legL); S.fM = DA_mix(S.fM, light, b.legL * 0.5); S.hM = DA_mix(S.hM, light, b.legL * 0.5); }
  if (!S.paw) S.paw = S.fL;
  Q.tan = co.tan || (pat === 'merle' && b.id !== 'aussiedoodle' ? '#c07a3e' : pat === 'jrt' && co.mark && DA_lum(co.mark) < 80 ? '#c47a3e' : null);
  // on very dark heads the ear gets a slightly lifted tone so it still reads
  if (DA_lum(S.ear) < 75 && DA_lum(S.skull) < 75) S.ear = DA_mix(S.ear, '#ffffff', 0.13);
  Q.L = { muz: DA_lineOn(S.muz), skull: DA_lineOn(S.skull), ear: DA_lineOn(S.ear), tail: DA_lineOn(S.tail), body: DA_lineOn(S.body) };
  Q.darkHead = DA_lum(S.skull) < 80;
  Q.S = S;
  Q.F = { fU: DA_far(S.fU), fM: DA_far(S.fM), fL: DA_far(S.fL), hU: DA_far(S.hU), hM: DA_far(S.hM), hL: DA_far(S.hL), paw: DA_far(S.paw), ear: DA_far(S.ear), earIn: DA_far(Q.earPink), tail: DA_far(S.tail) };
  Q.dark = (DA_rgb(base)[0] + DA_rgb(base)[1] + DA_rgb(base)[2]) < 200;   // very dark coat -> lighter interior lines
  Q.lineIn = Q.dark ? DA_mix(base, '#a99', 0.35) : DA_mix(shade, DA_OUT, 0.45);
  DA_PALS[key] = Q;
  return Q;
}

// ============================================================================================
// Breed anatomy table. Lengths are in withers-heights (1.0 = floor to top of shoulder).
//  len   body length, forechest to buttock        chest  depth of chest (1 - chest = ground clearance)
//  tuck  belly tuck-up behind the ribs            croup  height of the rump relative to the withers
//  hip   rump size relative to the chest          fore   forechest prominence      dip  sway(+) / roach(-) of the back
//  bone  leg thickness   ang  hind angulation     neckL / neckA / neckW  neck length, carriage angle (deg), thickness
//  hr    skull radius; head shape in skull radii: sl, sh skull half length / height, dome, ml muzzle length,
//        mt / mtip height of the muzzle top at the stop / nose (negative = higher), lip / lipT lip line at root / tip,
//        flew hanging lips, jd jaw depth, nose, ex / ey / es eye position and size
//  ear   { k: erect | bat | tipped | drop | button, len, w, x, y (set-on point), tilt }
//  tail  { k: otter | whip | brush | plume | pom | nub | dock, len, w, a carriage (deg, 0 = straight back, 90 = up), curl (deg) }
//  fur   edge style 0 smooth, 1 tufts (double coat / feathering), 2 curls, 3 silky strands; famp / fsp tuft size / spacing;
//        fBack / fChest / fBelly / fRump how strongly each zone is furred; legFur 1 feathers, 2 curly, 3 fluffy
// ============================================================================================
var DA_DEFAULT = { under: 0, droop: 0, stride: 1, gal: 1, len: 1.08, chest: 0.47, tuck: 0.09, croup: 0.97, hip: 0.82, fore: 0.12, dip: 0, bone: 0.075, ang: 1, neckL: 0.34, neckA: 50, neckW: 0.17,
  hr: 0.19, sl: 1, sh: 0.95, dome: 0, ml: 1, mt: -0.2, mtip: 0.02, lip: 0.5, lipT: 0.42, flew: 0, jd: 0.26, nose: 0.2, ex: 0.42, ey: -0.2, es: 0.18,
  fur: 0, famp: 0, fsp: 0.1, fBack: 0, fChest: 0, fBelly: 0, fRump: 0, legFur: 0, cheek: 0, beard: 0, brows: 0, topknot: 0, bow: 0, wrinkle: 0, fringe: 0, skirt: 0, legL: 0, nap: 'sphinx' };

var DA_B = {
  lab: { jd: 0.3, mtip: -0.1, len: 1.14, chest: 0.5, tuck: 0.06, hip: 0.86, bone: 0.08, neckL: 0.33, neckA: 48, neckW: 0.19, hr: 0.18, sl: 1.02, ml: 1, mt: -0.32, lip: 0.56, lipT: 0.48, flew: 0.1,
    ear: { k: 'drop', len: 1.15, w: 0.62, x: -0.3, y: -0.42 }, tail: { k: 'otter', len: 0.6, w: 0.085, a: 5, curl: 18 } },
  golden: { jd: 0.28, mtip: -0.1, len: 1.15, chest: 0.52, tuck: 0.06, hip: 0.86, bone: 0.08, neckL: 0.33, neckA: 50, neckW: 0.19, hr: 0.18, ml: 1.05, mt: -0.32, lip: 0.54, lipT: 0.46, flew: 0.06,
    ear: { k: 'drop', len: 1.22, w: 0.68, x: -0.3, y: -0.4, fur: 3 }, tail: { k: 'plume', len: 0.7, w: 0.07, a: 2, curl: 22, fu: 1, fo: 0 },
    fur: 1, famp: 0.045, fsp: 0.075, fChest: 1, fBelly: 1, fRump: 0.9, legFur: 1 },
  shepherd: { jd: 0.26, len: 1.24, chest: 0.48, tuck: 0.13, croup: 0.88, ang: 1.45, neckL: 0.38, neckA: 46, hr: 0.175, sh: 0.9, ml: 1.3, mt: -0.36, mtip: -0.12, lip: 0.44, lipT: 0.36,
    ear: { k: 'erect', len: 1.5, w: 0.8, x: -0.25, y: -0.7, tilt: 6 }, tail: { k: 'brush', len: 0.8, w: 0.075, a: -60, curl: 40 },
    fur: 1, famp: 0.04, fChest: 0.7, fBelly: 0.3, fRump: 0.8, cheek: 0.4 },
  husky: { jd: 0.26, mtip: -0.1, len: 1.1, chest: 0.48, tuck: 0.1, neckL: 0.33, neckA: 55, neckW: 0.2, hr: 0.18, ml: 1.0, mt: -0.32, lip: 0.46, lipT: 0.36,
    ear: { k: 'erect', len: 1.2, w: 0.75, x: -0.2, y: -0.72, tilt: 2 }, tail: { k: 'brush', len: 0.62, w: 0.11, a: 75, curl: 130 },
    fur: 1, famp: 0.045, fChest: 1, fBelly: 0.5, fRump: 0.9, cheek: 1, nap: 'curl' },
  collie: { fsp: 0.075, jd: 0.24, mtip: -0.08, len: 1.13, chest: 0.47, tuck: 0.12, bone: 0.068, neckL: 0.34, neckA: 42, hr: 0.17, ml: 1.1, mt: -0.3, lip: 0.42, lipT: 0.32,
    ear: { k: 'tipped', len: 1.1, w: 0.7, x: -0.25, y: -0.7, tilt: 8 }, tail: { k: 'plume', len: 0.74, w: 0.07, a: -52, curl: 62, fu: 1, fo: 0 },
    fur: 1, famp: 0.05, fChest: 1.2, fBelly: 0.9, fRump: 1, legFur: 1, cheek: 0.6 },
  dalmatian: { jd: 0.26, mtip: -0.1, len: 1.06, chest: 0.45, tuck: 0.16, bone: 0.062, neckL: 0.4, neckA: 56, neckW: 0.15, hr: 0.165, sh: 0.92, ml: 1.15, mt: -0.3, lip: 0.48, lipT: 0.42, flew: 0.05,
    ear: { k: 'drop', len: 1.0, w: 0.58, x: -0.3, y: -0.5 }, tail: { k: 'whip', len: 0.68, w: 0.05, a: 8, curl: 30 } },
  bernese: { fsp: 0.08, jd: 0.3, mtip: -0.1, len: 1.15, chest: 0.53, tuck: 0.04, hip: 0.9, bone: 0.105, neckL: 0.3, neckA: 46, neckW: 0.23, hr: 0.195, sl: 1.05, sh: 1, ml: 0.95, mt: -0.3, lip: 0.6, lipT: 0.52, flew: 0.14,
    ear: { k: 'drop', len: 1.05, w: 0.7, x: -0.32, y: -0.5 }, tail: { k: 'plume', len: 0.74, w: 0.1, a: -38, curl: 28, fu: 1, fo: 0.3 },
    fur: 1, famp: 0.05, fChest: 1, fBelly: 0.7, fRump: 1, fBack: 0.15, legFur: 1 },
  poodle: { jd: 0.22, len: 1.0, chest: 0.44, tuck: 0.17, bone: 0.06, neckL: 0.42, neckA: 64, neckW: 0.15, hr: 0.16, sl: 0.95, sh: 0.9, ml: 1.3, mt: -0.34, mtip: -0.16, lip: 0.36, lipT: 0.3,
    ear: { k: 'drop', len: 1.45, w: 0.75, x: -0.3, y: -0.35, fur: 2 }, tail: { k: 'pom', len: 0.34, w: 0.04, a: 72, curl: 0 },
    fur: 2, famp: 0.045, fsp: 0.085, fBack: 1, fChest: 1, fBelly: 1, fRump: 1, legFur: 2, topknot: 1 },
  beagle: { jd: 0.28, mtip: -0.08, len: 1.14, chest: 0.52, tuck: 0.06, bone: 0.08, neckL: 0.3, neckA: 50, neckW: 0.2, hr: 0.215, sh: 0.98, dome: 0.04, ml: 0.9, mt: -0.28, lip: 0.56, lipT: 0.5, flew: 0.1,
    ear: { k: 'drop', len: 1.55, w: 0.7, x: -0.35, y: -0.25 }, tail: { k: 'whip', len: 0.55, w: 0.065, a: 78, curl: 10 } },
  corgi: { jd: 0.24, mtip: -0.1, len: 1.8, chest: 0.64, tuck: 0.02, hip: 0.92, fore: 0.2, bone: 0.095, neckL: 0.36, neckA: 52, neckW: 0.26, hr: 0.27, sh: 0.92, ml: 1, mt: -0.34, lip: 0.38, lipT: 0.3,
    ear: { k: 'erect', len: 1.35, w: 0.85, x: -0.2, y: -0.68, tilt: 14, round: 0.4 }, tail: { k: 'nub', len: 0.12, w: 0.09, a: 20 },
    fur: 1, famp: 0.05, fChest: 0.8, fBelly: 0.3, fRump: 1, cheek: 0.5, nap: 'sploot' },
  shiba: { jd: 0.24, mtip: -0.1, len: 1.1, chest: 0.48, tuck: 0.1, bone: 0.072, neckL: 0.3, neckA: 56, neckW: 0.22, hr: 0.215, ml: 0.8, mt: -0.32, lip: 0.4, lipT: 0.32,
    ear: { k: 'erect', len: 0.95, w: 0.72, x: -0.15, y: -0.75, tilt: -8 }, tail: { k: 'brush', len: 0.62, w: 0.11, a: 100, curl: 195 },
    fur: 1, famp: 0.045, fChest: 0.8, fBelly: 0.3, fRump: 0.7, cheek: 1, nap: 'curl' },
  dachshund: { jd: 0.24, len: 2.25, chest: 0.64, tuck: 0.05, hip: 0.8, fore: 0.3, bone: 0.1, neckL: 0.42, neckA: 42, neckW: 0.22, hr: 0.26, sh: 0.85, ml: 1.45, mt: -0.3, mtip: -0.05, lip: 0.38, lipT: 0.3,
    ear: { k: 'drop', len: 1.5, w: 0.75, x: -0.35, y: -0.35 }, tail: { k: 'whip', len: 0.95, w: 0.075, a: 5, curl: 18 }, nap: 'curl' },
  pug: { len: 1.02, chest: 0.58, tuck: 0.03, hip: 0.9, bone: 0.09, neckL: 0.22, neckA: 50, neckW: 0.28, hr: 0.31, sh: 1, ml: 0.2, mt: -0.1, mtip: -0.02, lip: 0.6, lipT: 0.58, flew: 0.16, jd: 0.32,
    ex: 0.5, ey: -0.12, es: 0.2, wrinkle: 1,
    ear: { k: 'button', len: 0.56, w: 0.46, x: -0.4, y: -0.56 }, tail: { k: 'whip', len: 0.5, w: 0.06, a: 120, curl: 320 } },
  frenchie: { mtip: -0.05, len: 1.12, chest: 0.58, tuck: 0.1, hip: 0.74, dip: -0.12, bone: 0.1, neckL: 0.22, neckA: 48, neckW: 0.3, hr: 0.32, sh: 0.98, ml: 0.26, mt: -0.12, lip: 0.62, lipT: 0.6, flew: 0.18, jd: 0.34,
    ex: 0.5, ey: -0.14, es: 0.18, wrinkle: 1,
    ear: { k: 'bat', len: 1.25, w: 0.85, x: -0.05, y: -0.75, tilt: 4 }, tail: { k: 'nub', len: 0.07, w: 0.07, a: -10 }, nap: 'sploot' },
  chihuahua: { jd: 0.22, mtip: 0, len: 1.15, chest: 0.46, tuck: 0.12, bone: 0.05, neckL: 0.3, neckA: 56, neckW: 0.14, hr: 0.31, sl: 0.98, sh: 1, dome: 0.1, ml: 0.58, mt: -0.14, lip: 0.36, lipT: 0.3,
    ex: 0.48, ey: -0.12, es: 0.2,
    ear: { k: 'erect', len: 1.5, w: 0.9, x: -0.3, y: -0.6, tilt: 30 }, tail: { k: 'whip', len: 0.62, w: 0.045, a: 65, curl: 75 }, nap: 'curl' },
  schnauzer: { jd: 0.26, len: 1.0, chest: 0.5, tuck: 0.1, bone: 0.065, neckL: 0.36, neckA: 60, neckW: 0.17, hr: 0.2, sh: 0.88, ml: 1.2, mt: -0.45, mtip: -0.36, lip: 0.4, lipT: 0.36,
    ear: { k: 'button', len: 0.85, w: 0.62, x: -0.2, y: -0.8 }, tail: { k: 'dock', len: 0.26, w: 0.06, a: 78 },
    legFur: 3, beard: 1, brows: 1 },
  pomeranian: { jd: 0.2, mtip: -0.04, len: 0.98, chest: 0.57, tuck: 0, hip: 0.95, fore: 0.25, bone: 0.06, neckL: 0.2, neckA: 55, neckW: 0.3, hr: 0.29, sl: 0.95, ml: 0.55, mt: -0.18, lip: 0.3, lipT: 0.24,
    ear: { k: 'erect', len: 0.8, w: 0.62, x: -0.2, y: -0.78, tilt: 5 }, tail: { k: 'plume', len: 0.7, w: 0.15, a: 118, curl: 75, fu: 1, fo: 0.7 },
    fur: 4, famp: 0.075, fsp: 0.15, fBack: 0.8, fChest: 1.2, fBelly: 0.4, fRump: 1.1, cheek: 1.1, legFur: 1, legL: 0.55, nap: 'curl' },
  yorkie: { jd: 0.2, mtip: -0.04, len: 1.15, chest: 0.62, tuck: 0, bone: 0.06, neckL: 0.28, neckA: 56, neckW: 0.2, hr: 0.29, sl: 0.95, ml: 0.58, mt: -0.16, lip: 0.32, lipT: 0.28,
    ear: { k: 'erect', len: 0.8, w: 0.55, x: -0.25, y: -0.78, tilt: 10 }, tail: { k: 'plume', len: 0.5, w: 0.06, a: 62, curl: 20, fu: 1, fo: 0 },
    fur: 3, famp: 0.06, fBelly: 1.3, fChest: 0.8, fRump: 0.8, beard: 1, bow: 1, legFur: 3, skirt: 1 },
  labradoodle: { ex: 0.46, bone: 0.07, jd: 0.28, mtip: -0.1, len: 1.04, chest: 0.43, tuck: 0.1, neckL: 0.33, neckA: 54, neckW: 0.19, hr: 0.178, ml: 1, mt: -0.3, lip: 0.5, lipT: 0.44,
    ear: { k: 'drop', len: 1.35, w: 0.66, x: -0.45, y: -0.38, fur: 2 }, tail: { k: 'plume', len: 0.6, w: 0.075, a: 22, curl: 40, fu: 0.8, fo: 0.4 },
    fur: 2, famp: 0.028, fsp: 0.1, fBack: 1, fChest: 1, fBelly: 1, fRump: 1, legFur: 2, beard: 0.7, fringe: 1 },
  cockapoo: { jd: 0.26, mtip: -0.04, len: 1.1, chest: 0.52, tuck: 0.06, neckL: 0.28, neckA: 54, neckW: 0.22, hr: 0.235, sl: 0.98, sh: 0.98, dome: 0.03, ml: 0.7, mt: -0.2, lip: 0.46, lipT: 0.4,
    ear: { k: 'drop', len: 1.5, w: 0.85, x: -0.42, y: -0.25, fur: 2 }, tail: { k: 'plume', len: 0.5, w: 0.07, a: 35, curl: 30, fu: 0.9, fo: 0.3 },
    fur: 2, famp: 0.036, fsp: 0.09, fBack: 1, fChest: 1, fBelly: 1, fRump: 1, legFur: 2, beard: 0.6, topknot: 0.5 },
  puggle: { jd: 0.3, mtip: -0.04, len: 1.1, chest: 0.53, tuck: 0.06, bone: 0.08, neckL: 0.27, neckA: 50, neckW: 0.23, hr: 0.24, sh: 0.98, ml: 0.5, mt: -0.16, lip: 0.56, lipT: 0.5, flew: 0.12,
    ex: 0.46, es: 0.17, wrinkle: 0.6,
    ear: { k: 'drop', len: 1.15, w: 0.7, x: -0.3, y: -0.35 }, tail: { k: 'whip', len: 0.55, w: 0.055, a: 88, curl: 150 } },
  pomsky: { jd: 0.24, mtip: -0.1, len: 1.06, chest: 0.54, tuck: 0.04, bone: 0.07, neckL: 0.28, neckA: 56, neckW: 0.24, hr: 0.225, ml: 0.78, mt: -0.3, lip: 0.42, lipT: 0.32,
    ear: { k: 'erect', len: 1.0, w: 0.72, x: -0.2, y: -0.74, tilt: 3 }, tail: { k: 'brush', len: 0.62, w: 0.12, a: 105, curl: 140 },
    fur: 4, famp: 0.055, fsp: 0.12, fBack: 0.25, fChest: 1.2, fBelly: 0.8, fRump: 1.1, cheek: 1.1, legFur: 3, nap: 'curl' },
  // ---- added breeds ----
  // Cavalier King Charles: small silky spaniel, domed head, short muzzle, big round eyes, long feathered ears
  cavalier: { len: 1.1, chest: 0.52, tuck: 0.07, bone: 0.068, neckL: 0.3, neckA: 54, neckW: 0.19, hr: 0.24, sl: 0.98, sh: 0.98, dome: 0.1, ml: 0.58, mt: -0.16, mtip: -0.04, lip: 0.42, lipT: 0.36, jd: 0.24,
    ex: 0.46, ey: -0.16, es: 0.22,
    ear: { k: 'drop', len: 1.7, w: 0.85, x: -0.4, y: -0.5, fur: 3, lobe: 0.5 }, tail: { k: 'plume', len: 0.62, w: 0.06, a: 18, curl: 25, fu: 1, fo: 0.2 },
    fur: 3, famp: 0.05, fsp: 0.09, fChest: 1, fBelly: 1.2, fRump: 0.8, legFur: 1, skirt: 0.5, nap: 'curl' },
  // Boxer: square, deep-chested athlete; short blunt upturned muzzle with an underbite
  boxer: { len: 1.0, chest: 0.5, tuck: 0.15, hip: 0.84, fore: 0.16, bone: 0.082, neckL: 0.38, neckA: 56, neckW: 0.19, hr: 0.19, sl: 0.95, sh: 0.95, dome: 0.12, ml: 0.55, mt: -0.4, mtip: -0.34, lip: 0.66, lipT: 0.6, flew: 0.14, jd: 0.36, under: 0.08,
    ex: 0.5, ey: -0.28, es: 0.17, wrinkle: 0.6,
    ear: { k: 'drop', len: 0.85, w: 0.62, x: -0.25, y: -0.62 }, tail: { k: 'whip', len: 0.42, w: 0.065, a: 30, curl: 18 } },
  // Australian Shepherd: medium, a bit longer than tall, feathered double coat, tipped ears, bobbed tail
  aussie: { len: 1.12, chest: 0.5, tuck: 0.1, bone: 0.072, neckL: 0.34, neckA: 48, neckW: 0.19, hr: 0.18, ml: 1.0, mt: -0.3, mtip: -0.08, lip: 0.44, lipT: 0.34, jd: 0.25,
    ear: { k: 'tipped', len: 1.05, w: 0.72, x: -0.25, y: -0.7, tilt: 16 }, tail: { k: 'nub', len: 0.16, w: 0.1, a: 15 },
    fur: 1, famp: 0.05, fsp: 0.08, fChest: 1.2, fBelly: 0.9, fRump: 1.1, legFur: 1, cheek: 0.6 },
  // English Bulldog: wide, low, heavy-boned; roach back, narrow rear, huge head, pushed-in undershot face
  bulldog: { len: 1.22, chest: 0.66, tuck: 0.14, hip: 0.72, croup: 1.06, fore: 0.36, dip: -0.16, bone: 0.125, ang: 0.5, neckL: 0.12, neckA: 38, neckW: 0.38, hr: 0.39, sl: 1.05, sh: 0.86, ml: 0.15, mt: -0.06, mtip: 0.0, lip: 0.74, lipT: 0.7, flew: 0.36, jd: 0.46, under: 0.2,
    ex: 0.55, ey: -0.22, es: 0.15, wrinkle: 1, droop: 0.35,
    ear: { k: 'rose', len: 0.46, w: 0.38, x: -0.42, y: -0.65 }, tail: { k: 'nub', len: 0.1, w: 0.08, a: -35 }, nap: 'sploot' },
  // Greyhound: built for speed - deep chest, dramatic tuck-up, arched loin, long legs, long narrow head, rose ears
  greyhound: { len: 1.06, chest: 0.5, tuck: 0.34, hip: 0.72, croup: 0.96, fore: 0.1, dip: -0.12, bone: 0.05, ang: 1.4, neckL: 0.5, neckA: 42, neckW: 0.13, hr: 0.14, sl: 1.08, sh: 0.78, ml: 1.55, mt: -0.22, mtip: -0.06, lip: 0.4, lipT: 0.34, jd: 0.2,
    ex: 0.44, ey: -0.22, es: 0.16, gal: 1.3,
    ear: { k: 'rose', len: 0.7, w: 0.5, x: -0.55, y: -0.55 }, tail: { k: 'whip', len: 1.0, w: 0.042, a: -62, curl: 55 } },
  // Jack Russell: compact, sturdy little terrier, button ears, straight upright tail
  jackrussell: { len: 1.06, chest: 0.5, tuck: 0.1, bone: 0.072, neckL: 0.3, neckA: 56, neckW: 0.19, hr: 0.22, sl: 0.98, sh: 0.92, ml: 0.82, mt: -0.3, mtip: -0.08, lip: 0.42, lipT: 0.34, jd: 0.25,
    ear: { k: 'button', len: 0.78, w: 0.6, x: -0.2, y: -0.72 }, tail: { k: 'dock', len: 0.36, w: 0.07, a: 82 }, fur: 1, famp: 0.02, fsp: 0.07, fChest: 0.5, fBelly: 0.3 },
  // Samoyed: big white fluffy spitz, smiling face, erect rounded ears, plume tail curled over the back
  samoyed: { len: 1.06, chest: 0.52, tuck: 0.06, bone: 0.08, neckL: 0.3, neckA: 56, neckW: 0.24, hr: 0.19, ml: 0.85, mt: -0.3, mtip: -0.08, lip: 0.42, lipT: 0.3, jd: 0.24,
    ear: { k: 'erect', len: 0.95, w: 0.78, x: -0.2, y: -0.74, tilt: 4, round: 0.35 }, tail: { k: 'plume', len: 0.75, w: 0.15, a: 112, curl: 120, fu: 1, fo: 0.7 },
    fur: 4, famp: 0.075, fsp: 0.13, fBack: 0.6, fChest: 1.3, fBelly: 1, fRump: 1.2, cheek: 1.3, legFur: 3, nap: 'curl' },
  // Great Dane: giant and square, long arched neck, long rectangular head with a deep stop, natural drop ears
  greatdane: { len: 1.0, chest: 0.48, tuck: 0.17, hip: 0.82, bone: 0.078, ang: 1.1, neckL: 0.52, neckA: 58, neckW: 0.16, hr: 0.155, sl: 1.12, sh: 0.95, ml: 1.28, mt: -0.52, mtip: -0.46, lip: 0.68, lipT: 0.62, flew: 0.14, jd: 0.3,
    ex: 0.52, ey: -0.3, es: 0.15,
    ear: { k: 'drop', len: 0.95, w: 0.6, x: -0.28, y: -0.66 }, tail: { k: 'whip', len: 0.85, w: 0.055, a: -45, curl: 25 } },
  // Cocker Spaniel: compact, domed head, long low-set silky ears, feathered skirt and legs, docked tail
  cocker: { len: 1.04, chest: 0.54, tuck: 0.06, croup: 0.95, bone: 0.072, neckL: 0.32, neckA: 56, neckW: 0.19, hr: 0.22, sl: 0.98, sh: 1.0, dome: 0.12, ml: 0.78, mt: -0.2, mtip: -0.02, lip: 0.52, lipT: 0.46, flew: 0.1, jd: 0.26,
    ex: 0.44, ey: -0.18, es: 0.19,
    ear: { k: 'drop', len: 1.95, w: 0.9, x: -0.38, y: -0.3, fur: 3, lobe: 0.6 }, tail: { k: 'dock', len: 0.3, w: 0.07, a: 30 },
    fur: 3, famp: 0.06, fsp: 0.09, fChest: 1, fBelly: 1.4, fRump: 0.8, legFur: 1, skirt: 1, nap: 'curl' },
  // Boston Terrier: small, square, short-backed; big square head, huge round eyes, bat ears, screw tail
  boston: { len: 0.96, chest: 0.5, tuck: 0.13, hip: 0.82, bone: 0.068, neckL: 0.28, neckA: 58, neckW: 0.2, hr: 0.3, sl: 0.95, sh: 0.98, dome: 0.04, ml: 0.28, mt: -0.12, mtip: -0.06, lip: 0.52, lipT: 0.5, flew: 0.08, jd: 0.28,
    ex: 0.5, ey: -0.14, es: 0.22,
    ear: { k: 'bat', len: 1.2, w: 0.78, x: -0.1, y: -0.74, tilt: 12 }, tail: { k: 'nub', len: 0.1, w: 0.07, a: -5 }, nap: 'sploot' },
  // Rottweiler: powerful, a little longer than tall, broad head with a marked stop, small triangular drop ears
  rottweiler: { len: 1.12, chest: 0.52, tuck: 0.07, hip: 0.88, bone: 0.1, neckL: 0.3, neckA: 48, neckW: 0.24, hr: 0.205, sl: 1.06, sh: 0.98, ml: 0.82, mt: -0.4, mtip: -0.2, lip: 0.56, lipT: 0.5, flew: 0.1, jd: 0.3,
    ex: 0.46, ey: -0.26, es: 0.15,
    ear: { k: 'drop', len: 0.78, w: 0.66, x: -0.3, y: -0.62 }, tail: { k: 'otter', len: 0.55, w: 0.075, a: 20, curl: 25 } },
  // Bichon Frise: small white powder puff, rounded head of hair, dark round eyes, plumed tail over the back
  bichon: { len: 1.02, chest: 0.54, tuck: 0.05, bone: 0.062, neckL: 0.3, neckA: 60, neckW: 0.2, hr: 0.25, sl: 0.95, sh: 0.98, ml: 0.55, mt: -0.2, mtip: -0.06, lip: 0.4, lipT: 0.34, jd: 0.22,
    ex: 0.42, ey: -0.16, es: 0.19,
    ear: { k: 'drop', len: 1.25, w: 0.85, x: -0.35, y: -0.45, fur: 2 }, tail: { k: 'plume', len: 0.55, w: 0.1, a: 95, curl: 100, fu: 1, fo: 1 },
    fur: 2, famp: 0.06, fsp: 0.1, fBack: 1, fChest: 1.2, fBelly: 1.1, fRump: 1.1, legFur: 2, topknot: 1.2, beard: 0.6, cheek: 0.8, nap: 'curl' },
  // Basset Hound: very long and very low, heavy bone, long droopy head, huge ears, loose flews, sad eyes, white-tipped sabre tail
  basset: { len: 2.05, chest: 0.66, tuck: 0.02, hip: 0.92, croup: 1.0, fore: 0.32, bone: 0.12, ang: 0.8, neckL: 0.4, neckA: 36, neckW: 0.26, hr: 0.29, sl: 1.12, sh: 0.88, dome: 0.05, ml: 1.25, mt: -0.3, mtip: -0.06, lip: 0.7, lipT: 0.62, flew: 0.34, jd: 0.3,
    ex: 0.4, ey: -0.18, es: 0.17, droop: 0.55, wrinkle: 0.6,
    ear: { k: 'drop', len: 2.5, w: 0.9, x: -0.35, y: -0.2, lobe: 0.5 }, tail: { k: 'whip', len: 0.85, w: 0.085, a: 62, curl: 25 }, nap: 'sploot' },
  // West Highland White Terrier: compact white terrier, round furnished head, small pricked ears, carrot tail
  westie: { len: 1.04, chest: 0.54, tuck: 0.05, bone: 0.07, neckL: 0.26, neckA: 58, neckW: 0.22, hr: 0.26, sl: 0.95, sh: 0.95, ml: 0.6, mt: -0.24, mtip: -0.08, lip: 0.4, lipT: 0.34, jd: 0.24,
    ex: 0.44, es: 0.16,
    ear: { k: 'erect', len: 0.75, w: 0.6, x: -0.18, y: -0.8, tilt: 6 }, tail: { k: 'brush', len: 0.42, w: 0.1, a: 82, curl: 10, fu: 0.6, fo: 0.6 },
    fur: 1, famp: 0.06, fsp: 0.07, fBack: 0.6, fChest: 1.2, fBelly: 1.2, fRump: 1, cheek: 1.3, legFur: 3, beard: 0.35 },
  // ---- crosses (see DA_CROSS below: they start from a blend of the parents) ----
  chiweenie: { len: 1.6, chest: 0.56, fore: 0.2, ear: { k: 'erect', len: 1.35, w: 0.88, x: -0.3, y: -0.6, tilt: 32 }, tail: { k: 'whip', len: 0.8, w: 0.055, a: 25, curl: 35 }, nap: 'curl' },
  mutt: { len: 1.12, chest: 0.5, tuck: 0.1, bone: 0.075, neckL: 0.33, neckA: 50, neckW: 0.19, hr: 0.19, ml: 0.95, mt: -0.3, mtip: -0.08, lip: 0.48, lipT: 0.4, flew: 0.04, jd: 0.26,
    ear: { k: 'drop', len: 0.95, w: 0.66, x: -0.25, y: -0.62, lobe: 0.3 }, tail: { k: 'brush', len: 0.62, w: 0.075, a: 55, curl: 70, fu: 0.6, fo: 0.3 },
    fur: 1, famp: 0.03, fsp: 0.08, fChest: 0.8, fBelly: 0.5, fRump: 0.6 },
  alfie_terrier: { len: 1.08, chest: 0.48, tuck: 0.12, bone: 0.064, neckL: 0.34, neckA: 56, neckW: 0.18, hr: 0.22, sl: 0.98, sh: 0.94, ml: 0.82, mt: -0.28, mtip: -0.06, lip: 0.42, lipT: 0.34, jd: 0.24,
    ex: 0.44, ey: -0.18, es: 0.19,
    ear: { k: 'erect', len: 1.44, w: 0.82, x: -0.22, y: -0.68, tilt: 12 }, tail: { k: 'brush', len: 0.62, w: 0.085, a: 55, curl: 65, fu: 0.8, fo: 0.3 },
    fur: 1, famp: 0.022, fsp: 0.075, fChest: 0.55, fBelly: 0.35, fRump: 0.45 },
  teddy_terrier: { len: 1.06, chest: 0.5, tuck: 0.09, bone: 0.068, neckL: 0.34, neckA: 58, neckW: 0.19, hr: 0.215, sl: 0.96, sh: 0.94, ml: 0.88, mt: -0.32, mtip: -0.16, lip: 0.42, lipT: 0.36, jd: 0.25,
    ex: 0.44, ey: -0.18, es: 0.18,
    ear: { k: 'button', len: 0.92, w: 0.66, x: -0.22, y: -0.76 }, tail: { k: 'plume', len: 0.48, w: 0.08, a: 45, curl: 35, fu: 0.9, fo: 0.5 },
    fur: 2, famp: 0.036, fsp: 0.09, fBack: 1, fChest: 1, fBelly: 1, fRump: 1, legFur: 2, beard: 0.85, brows: 0.8, topknot: 0.35 }
};
// crosses: [parent A, parent B, weight of B, overrides]. Numbers are blended; ears / tails come from the parent named
// in the overrides (or A). The result is then hand-tuned by the overrides so the mix reads as its own dog.
var DA_CROSS = {
  cavapoo: ['cavalier', 'poodle', 0.35, { fur: 2, famp: 0.04, fsp: 0.085, fBack: 1, fChest: 1, fBelly: 1, fRump: 1, legFur: 2, skirt: 0, topknot: 0.4, beard: 0.45, ml: 0.68, len: 1.06,
    ear: { k: 'drop', len: 1.55, w: 0.85, x: -0.4, y: -0.42, fur: 2 }, tail: { k: 'plume', len: 0.55, w: 0.07, a: 40, curl: 40, fu: 0.9, fo: 0.4 }, nap: 'curl' }],
  goldendoodle: ['golden', 'poodle', 0.45, { fur: 2, famp: 0.038, fsp: 0.095, fBack: 1, fChest: 1, fBelly: 1, fRump: 1, legFur: 2, beard: 0.8, fringe: 1, topknot: 0.3,
    ear: { k: 'drop', len: 1.35, w: 0.7, x: -0.42, y: -0.38, fur: 2 }, tail: { k: 'plume', len: 0.66, w: 0.08, a: 24, curl: 40, fu: 1, fo: 0.5 } }],
  maltipoo: ['poodle', 'poodle', 0, { len: 1.04, chest: 0.56, tuck: 0.05, bone: 0.062, neckL: 0.26, neckA: 60, neckW: 0.2, hr: 0.26, sl: 0.95, sh: 0.98, dome: 0.06, ml: 0.52, mt: -0.18, mtip: -0.05, lip: 0.38, lipT: 0.32, jd: 0.22,
    ex: 0.44, ey: -0.16, es: 0.2, fur: 2, famp: 0.05, fsp: 0.095, legFur: 2, topknot: 0.8, beard: 0.6,
    ear: { k: 'drop', len: 1.4, w: 0.85, x: -0.38, y: -0.42, fur: 2 }, tail: { k: 'plume', len: 0.5, w: 0.08, a: 82, curl: 70, fu: 1, fo: 0.8 }, nap: 'curl' }],
  bernedoodle: ['bernese', 'poodle', 0.35, { fur: 2, famp: 0.04, fsp: 0.1, fBack: 1, fChest: 1, fBelly: 1, fRump: 1, legFur: 2, beard: 0.55, topknot: 0.25,
    ear: { k: 'drop', len: 1.25, w: 0.72, x: -0.38, y: -0.45, fur: 2 }, tail: { k: 'plume', len: 0.7, w: 0.085, a: 8, curl: 35, fu: 1, fo: 0.5 } }],
  sheepadoodle: ['poodle', 'bernese', 0.45, { fur: 2, famp: 0.05, fsp: 0.1, fBack: 1, fChest: 1.1, fBelly: 1.1, fRump: 1.1, legFur: 2, beard: 0.9, fringe: 1.3, topknot: 0.5, cheek: 0.8, bone: 0.085, ml: 0.85,
    ear: { k: 'drop', len: 1.3, w: 0.8, x: -0.4, y: -0.42, fur: 2 }, tail: { k: 'plume', len: 0.6, w: 0.1, a: 10, curl: 30, fu: 1, fo: 0.6 } }],
  chiweenie: ['chihuahua', 'dachshund', 0.45, {}],
  aussiedoodle: ['aussie', 'poodle', 0.4, { fur: 2, famp: 0.036, fsp: 0.09, fBack: 1, fChest: 1, fBelly: 1, fRump: 1, legFur: 2, beard: 0.6, topknot: 0.3,
    ear: { k: 'drop', len: 1.25, w: 0.7, x: -0.38, y: -0.48, fur: 2 }, tail: { k: 'plume', len: 0.55, w: 0.075, a: 45, curl: 45, fu: 1, fo: 0.5 } }]
};
// parameter row for a breed id: its own row, a cross of its parents, or (unknown breed) a cross of whatever parents
// breeds.js names, or the Labrador-ish default
function DA_params(br) {
  var id = br.id, own = DA_B[id], X = DA_CROSS[id], k;
  if (!X && !own && br.cross && br.cross.length >= 2 && DA_B[br.cross[0]] && DA_B[br.cross[1]]) X = [br.cross[0], br.cross[1], 0.5, {}];
  if (!X) return own || DA_B.mutt;
  var a = DA_B[X[0]] || DA_B.lab, c = DA_B[X[1]] || DA_B.lab, w = X[2], o = {};
  for (k in DA_DEFAULT) {
    var va = a[k] !== undefined ? a[k] : DA_DEFAULT[k], vc = c[k] !== undefined ? c[k] : DA_DEFAULT[k];
    o[k] = typeof va === 'number' && typeof vc === 'number' ? va + (vc - va) * w : va;
  }
  o.ear = a.ear; o.tail = a.tail;
  if (own) for (k in own) o[k] = own[k];
  for (k in X[3]) o[k] = X[3][k];
  return o;
}

// ---------- derived standing geometry, built once per breed ----------
var DA_G = {}, DA_HEADK = 1.12, DA_BONEK = 1.04;
var DA_WBETA = 0.6;                                // walk: fraction of the cycle each foot is on the ground
var DA_WN = 8, DA_RN = 6;                          // frames per walk / gallop cycle
var DA_RUNV = 110;                                 // px/s above which a moving dog gallops
function DA_geom(id) {
  var G = DA_G[id];
  if (G) return G;
  var br = (typeof BREED_BY_ID !== 'undefined' && BREED_BY_ID[id]) || null;
  if (!br && typeof BREEDS !== 'undefined') { br = BREEDS[id] || BREEDS[0]; }
  if (!br) br = { id: 'lab', cm: 57, coats: [] };
  var src = DA_params(br), b = {}, k;
  for (k in DA_DEFAULT) b[k] = DA_DEFAULT[k];
  for (k in src) b[k] = src[k];
  b.hr *= DA_HEADK; b.bone *= DA_BONEK;
  var H = (typeof breedShoulderPx === 'function') ? breedShoulderPx(br) : 11 + ((br.cm || 50) - 20) * 0.42;
  G = { b: b, breed: br, H: H };
  var cr = b.chest / 2, rr = cr * b.hip;
  G.cr = cr; G.rr = rr;
  G.yc = -1 + cr; G.yr = -b.croup + rr;
  var xc = b.len / 2 - cr * (1 + b.fore), xr = -b.len / 2 + rr;
  G.pfx = cr * 0.15; G.pfy = cr * 0.4;            // front leg pivot (chest frame)
  G.phx = rr * 0.05; G.phy = rr * 0.2;            // hip pivot (rump frame)
  G.Lf = -(G.yc + G.pfy); G.hh = -(G.yr + G.phy);
  G.pawH = b.bone * 0.8; G.pawL = b.bone * 2.3;
  var ffx = xc + G.pfx, hfx = xr + G.phx - G.hh * 0.24 * b.ang, sh = -(ffx + hfx) / 2;
  G.xc = xc + sh; G.xr = xr + sh; G.ffx = ffx + sh; G.hfx = hfx + sh;
  G.D = G.xc - G.xr;
  G.farOff = b.bone * 0.9 + 0.035;
  G.thigh = G.hh * 0.4; G.shank = G.hh * 0.36; G.meta = G.hh * 0.27; G.ma = 0.15 * b.ang;
  G.fu = (G.Lf - G.pawH) * 0.75; G.fl = (G.Lf - G.pawH) * 0.26;
  G.groin = (-(1 - b.chest) - b.tuck) - G.yr;     // belly height at the loin, rump-frame y
  G.nbx = cr * 0.4; G.nby = -cr * 0.5;            // neck base (chest frame)
  G.neckA = b.neckA * DA_RAD;
  G.tbx = -rr * 0.78; G.tby = -rr * 0.55;         // tail base (rump frame)
  G.LL = 1 - b.chest;                              // ground clearance (visible leg)
  // front leg: shoulder pivot -> elbow (upper arm, hidden in the chest) -> wrist (forearm) -> ankle (pastern) -> paw
  var pvY = G.yc + G.pfy;
  G.ua = cr * 0.62; G.uaA = 0.42;
  var elY = pvY + G.ua * Math.cos(G.uaA), below = -G.pawH - elY;
  G.th0 = -0.22;                                   // resting pastern slope (paw a little ahead of the wrist)
  G.pl = DA_clamp(below * 0.24, 0.05, 0.14);
  G.fa = below - G.pl * Math.cos(G.th0);
  G.slide = 0.07;                                  // how far a shoulder / hip may give to let a foot reach the ground
  // gait. The cycle phase is driven by the distance walked, so planted feet stay put at any speed:
  // stride (withers heights per cycle) = foot sweep during stance / stance fraction.
  // small dogs take relatively longer strides (and spend less of the cycle on each foot) so their legs don't blur
  var small = DA_clamp((22 - H) / 11, 0, 1);
  G.wBeta = DA_WBETA - 0.08 * small;
  G.walkA = Math.min(0.1 + 0.36 * G.LL, 0.1 + 0.45 * G.fa) * (1 + 0.4 * small) * (b.stride || 1);
  G.wStride = 2 * G.walkA / G.wBeta;
  G.rStride = (1.55 + 1.0 * G.LL) * (1 + 0.3 * small) * (b.gal || 1);
  G.idx = br.index == null ? 0 : br.index;
  var outPx = DA_clamp(0.68 + H * 0.021, 0.9, 1.3);
  G.ow = outPx / H;                                // visible outline width
  G.dl = G.ow * 0.55;                              // interior detail line width
  // standing head centre + bounds for dogMetrics
  var hx = G.xc + G.nbx + Math.cos(G.neckA) * b.neckL, hy = G.yc + G.nby - Math.sin(G.neckA) * b.neckL;
  var top = hy - b.hr * b.sh * (1 + b.dome), E = b.ear;
  if (E && (E.k === 'erect' || E.k === 'bat' || E.k === 'tipped')) top = hy + b.hr * (E.y - E.len * 0.92);
  if (b.topknot || b.bow) top -= b.hr * 0.35;
  var front = hx + b.hr * (b.sl * 0.8 + b.ml + 0.1), back = G.xr - rr - ((b.tail && b.tail.a < 60) ? b.tail.len * 0.6 : 0.05);
  G.met = { w: (front - back) * H, h: -Math.min(top, -1) * H, headX: (hx + b.hr * 0.25) * H, headY: hy * H, topY: Math.min(top, -1) * H };
  DA_G[id] = G;
  return G;
}

// ============================================================================================
// Scratch state shared by the shape builders (no per-frame allocation).
// ============================================================================================
var DA_PX = new Float64Array(96), DA_PY = new Float64Array(96), DA_PW = new Float64Array(96), DA_PT = new Float64Array(96), DA_n = 0;
var DA_g = null, DA_P = null, DA_Q = null;          // current geometry, pose, palette
var DA_Cx = 0, DA_Cy = 0, DA_Cc = 1, DA_Cs = 0, DA_cr = 0.25;   // chest frame
var DA_Rx = 0, DA_Ry = 0, DA_Rc = 1, DA_Rs = 0, DA_rr = 0.2, DA_D = 0.6;   // rump frame
var DA_Hx = 0, DA_Hy = 0, DA_Hc = 1, DA_Hs = 0, DA_Hf = 1, DA_hr = 0.2, DA_Ha = 0;   // head frame
var DA_NBx = 0, DA_NBy = 0;
var DA_lx = -0.35, DA_ly = 0.45;                    // fur lean (back and down)
var DA_L = new Float64Array(48);                    // 4 legs x [px,py, jx,jy, hx,hy, ax,ay, rot, -, -, -]
var DA_FT = new Float64Array(16);
var DA_jx = 0, DA_jy = 0, DA_ex = 0, DA_ey = 0;
var DA_TXs = new Float64Array(12), DA_TYs = new Float64Array(12), DA_TAs = new Float64Array(12), DA_TWs = new Float64Array(12);
var DA_wph = 0;                                     // tail wag phase

function DA_cX(lx, ly) { return DA_Cx + lx * DA_Cc - ly * DA_Cs; }
function DA_cY(lx, ly) { return DA_Cy + lx * DA_Cs + ly * DA_Cc; }
function DA_rX(lx, ly) { return DA_Rx + lx * DA_Rc - ly * DA_Rs; }
function DA_rY(lx, ly) { return DA_Ry + lx * DA_Rs + ly * DA_Rc; }
function DA_hX(lx, ly) { return DA_Hx + lx * DA_hr * DA_Hf * DA_Hc - ly * DA_hr * DA_Hs; }
function DA_hY(lx, ly) { return DA_Hy + lx * DA_hr * DA_Hf * DA_Hs + ly * DA_hr * DA_Hc; }
// torso space: u 0 (rump centre) .. 1 (chest centre), v -1 (topline) .. +1 (underline)
function DA_tX(u, v) {
  var w = u < 0 ? 0 : u > 1 ? 1 : u * u * (3 - 2 * u);
  var rx = DA_Rx + u * DA_D * DA_Rc - v * DA_rr * DA_Rs, cx = DA_Cx + (u - 1) * DA_D * DA_Cc - v * DA_cr * DA_Cs;
  return rx + (cx - rx) * w;
}
function DA_tY(u, v) {
  var w = u < 0 ? 0 : u > 1 ? 1 : u * u * (3 - 2 * u);
  var ry = DA_Ry + u * DA_D * DA_Rs + v * DA_rr * DA_Rc, cy = DA_Cy + (u - 1) * DA_D * DA_Cs + v * DA_cr * DA_Cc;
  return ry + (cy - ry) * w - DA_P.arch * (1 - (2 * u - 1) * (2 * u - 1) > 0 ? 1 - (2 * u - 1) * (2 * u - 1) : 0);
}
function DA_pt(x, y, w, t) { var n = DA_n; DA_PX[n] = x; DA_PY[n] = y; DA_PW[n] = w || 0; DA_PT[n] = t === undefined ? 1 : t; DA_n = n + 1; }
function DA_pc(lx, ly, w, t) { DA_pt(DA_cX(lx, ly), DA_cY(lx, ly), w, t); }
function DA_pr(lx, ly, w, t) { DA_pt(DA_rX(lx, ly), DA_rY(lx, ly), w, t); }
function DA_ph(lx, ly, w, t) { DA_pt(DA_hX(lx, ly), DA_hY(lx, ly), w, t); }
function DA_pu(u, v, w, t) { DA_pt(DA_tX(u, v), DA_tY(u, v), w, t); }

// Emit the current control points as a smooth closed (or open) Catmull-Rom outline. Points must run clockwise on screen.
// fur: 0 smooth, 1 tufts, 2 curls (scallops), 3 silky strands. Per-point weight (DA_PW) scales the fur locally.
function DA_emit(c, fur, amp, sp, open) {
  var n = DA_n, X = DA_PX, Y = DA_PY, W = DA_PW, T = DA_PT, last = open ? n - 1 : n, i, j, ar = 0;
  for (i = 0, j = n - 1; i < n; j = i++) ar += X[j] * Y[i] - X[i] * Y[j];
  if (ar < 0) DA_rev();                                   // keep every outline clockwise (fur points outwards, fills union)
  c.moveTo(X[0], Y[0]);
  for (i = 0; i < last; i++) {
    var i0 = i - 1, i2 = i + 1, i3 = i + 2;
    if (open) { if (i0 < 0) i0 = 0; if (i3 > n - 1) i3 = n - 1; }
    else { if (i0 < 0) i0 += n; if (i2 >= n) i2 -= n; if (i3 >= n) i3 -= n; }
    var x1 = X[i], y1 = Y[i], x2 = X[i2], y2 = Y[i2], t1 = T[i] / 6, t2 = T[i2] / 6;
    var ax = x1 + (x2 - X[i0]) * t1, ay = y1 + (y2 - Y[i0]) * t1, bx = x2 - (X[i3] - x1) * t2, by = y2 - (Y[i3] - y1) * t2;
    var w1 = W[i], w2 = W[i2];
    if (!fur || (w1 < 0.02 && w2 < 0.02)) { c.bezierCurveTo(ax, ay, bx, by, x2, y2); continue; }
    var L = Math.abs(x2 - x1) + Math.abs(y2 - y1), k = Math.round(L * 0.8 / sp);
    if (k < 1) k = 1; if (k > 9) k = 9;
    var px = x1, py = y1;
    for (j = 1; j <= k; j++) {
      var u = j / k, v = 1 - u;
      var qx = v * v * v * x1 + 3 * v * v * u * ax + 3 * v * u * u * bx + u * u * u * x2;
      var qy = v * v * v * y1 + 3 * v * v * u * ay + 3 * v * u * u * by + u * u * u * y2;
      var tx = qx - px, ty = qy - py, tl = Math.sqrt(tx * tx + ty * ty) || 1e-6, nx = ty / tl, ny = -tx / tl;
      var a = amp * (w1 + (w2 - w1) * (u - 0.5 / k)), mx = (px + qx) / 2, my = (py + qy) / 2;
      if (fur === 2) c.quadraticCurveTo(mx + nx * a * 1.8, my + ny * a * 1.8, qx, qy);
      else if (fur === 4) {
        a *= 0.85 + 0.3 * (((i * 3 + j * 5) % 4) / 3);
        c.bezierCurveTo(px + nx * a * 1.5 + tx * 0.1, py + ny * a * 1.5 + ty * 0.1, qx + nx * a * 1.9 + DA_lx * a + tx * 0.15, qy + ny * a * 1.9 + DA_ly * a + ty * 0.15, qx, qy);
      }
      else if (fur === 1) {
        a *= 0.8 + 0.4 * (((i * 3 + j * 5) % 4) / 3);
        var kx = mx + nx * a + DA_lx * a * 0.7 + tx * 0.25, ky = my + ny * a + DA_ly * a * 0.7 + ty * 0.25;
        c.quadraticCurveTo(px + nx * a * 0.85 + tx * 0.2, py + ny * a * 0.85 + ty * 0.2, kx, ky);
        c.quadraticCurveTo(qx + nx * a * 0.25, qy + ny * a * 0.25, qx, qy);
      } else {
        a *= 0.8 + 0.4 * (((i * 3 + j * 5) % 3) / 2);
        c.quadraticCurveTo(px + nx * a * 0.5, py + ny * a * 0.5 + a * 0.5, mx + nx * a * 0.5 + DA_lx * a * 0.5, my + ny * a * 0.5 + a);
        c.lineTo(qx, qy);
      }
      px = qx; py = qy;
    }
  }
  if (!open) c.closePath();
}
// tapered capsule (clockwise)
function DA_cap(c, ax, ay, ra, bx, by, rb) {
  var th = Math.atan2(by - ay, bx - ax);
  c.moveTo(ax + Math.cos(th + DA_HPI) * ra, ay + Math.sin(th + DA_HPI) * ra);
  c.arc(ax, ay, ra, th + DA_HPI, th + 3 * DA_HPI);
  c.arc(bx, by, rb, th - DA_HPI, th + DA_HPI);
  c.closePath();
}
function DA_dot(c, x, y, r) { c.moveTo(x + r, y); c.arc(x, y, r, 0, DA_TAU); }
// row of fur tufts along a->b pointing towards (sx, sy); closed, clockwise
function DA_fringe(c, ax, ay, bx, by, sx, sy, n, amp) {
  var t;
  if ((bx - ax) * sy - (by - ay) * sx > 0) { t = ax; ax = bx; bx = t; t = ay; ay = by; by = t; }
  c.moveTo(ax, ay);
  var px = ax, py = ay;
  for (var j = 1; j <= n; j++) {
    var qx = ax + (bx - ax) * j / n, qy = ay + (by - ay) * j / n, a = amp * (0.75 + 0.25 * ((j * 7) % 3) / 2);
    c.quadraticCurveTo(px + sx * a * 0.85 + (qx - px) * 0.2, py + sy * a * 0.85 + (qy - py) * 0.2, (px + qx) / 2 + sx * a + (qx - px) * 0.3, (py + qy) / 2 + sy * a + (qy - py) * 0.3);
    c.quadraticCurveTo(qx + sx * a * 0.25, qy + sy * a * 0.25, qx, qy); px = qx; py = qy;
  }
  c.closePath();
}
// two-bone IK; sgn -1 bends the joint towards +x for a leg that points down
function DA_ik(px, py, tx, ty, l1, l2, sgn) {
  var dx = tx - px, dy = ty - py, d = Math.sqrt(dx * dx + dy * dy) || 1e-6;
  var mx = l1 + l2 - 1e-4, mn = Math.abs(l1 - l2) + 1e-4, dd = d > mx ? mx : d < mn ? mn : d;
  var ca = (l1 * l1 + dd * dd - l2 * l2) / (2 * l1 * dd);
  ca = ca > 1 ? 1 : ca < -1 ? -1 : ca;
  var b = Math.atan2(dy, dx) + sgn * Math.acos(ca);
  DA_jx = px + Math.cos(b) * l1; DA_jy = py + Math.sin(b) * l1;
  DA_ex = px + dx / d * dd; DA_ey = py + dy / d * dd;
}

// ---------- skeleton solve: pose -> frames + leg joints ----------
function DA_solve(G, P) {
  var b = G.b, a, i;
  DA_g = G; DA_P = P;
  DA_cr = G.cr * (1 + 0.035 * P.breath); DA_rr = G.rr; DA_D = G.D; DA_hr = b.hr;
  DA_Cx = G.xc + P.cdx; DA_Cy = G.yc + P.cdy - 0.012 * P.breath; a = P.crot; DA_Cc = Math.cos(a); DA_Cs = Math.sin(a);
  DA_Rx = G.xr + P.rdx; DA_Ry = G.yr + P.rdy; a = P.rrot; DA_Rc = Math.cos(a); DA_Rs = Math.sin(a);
  DA_NBx = DA_cX(G.nbx, G.nby); DA_NBy = DA_cY(G.nbx, G.nby);
  var na = G.neckA + P.neck, nl = b.neckL * P.neckS;
  DA_Hx = DA_NBx + Math.cos(na) * nl; DA_Hy = DA_NBy - Math.sin(na) * nl;
  if (P.hk > 0) { DA_Hx += (P.hx - DA_Hx) * P.hk; DA_Hy += (P.hy - DA_Hy) * P.hk; }
  DA_Hf = P.headFlip > 0.5 ? -1 : 1;
  DA_Ha = -P.head * DA_Hf; DA_Hc = Math.cos(DA_Ha); DA_Hs = Math.sin(DA_Ha);
  var F = DA_FT, L = DA_L, up = P.flip > 0.3;
  F[0] = P.f0x; F[1] = P.f0y; F[2] = P.f0p; F[3] = P.f0q; F[4] = P.f1x; F[5] = P.f1y; F[6] = P.f1p; F[7] = P.f1q;
  F[8] = P.f2x; F[9] = P.f2y; F[10] = P.f2p; F[11] = P.f2q; F[12] = P.f3x; F[13] = P.f3y; F[14] = P.f3p; F[15] = P.f3q;
  for (i = 0; i < 4; i++) {
    var front = i < 2, off = (i & 1) ? G.farOff : 0, o = i * 12, f = i * 4, px, py, nx;
    if (front) { px = DA_cX(G.pfx, G.pfy) + off; py = DA_cY(G.pfx, G.pfy); nx = G.ffx + off; }
    else { px = DA_rX(G.phx, G.phy) + off; py = DA_rY(G.phx, G.phy); nx = G.hfx + off; }
    var p = F[f + 2], q = F[f + 3];
    var tx = nx + (px - nx) * p + F[f], ty = -G.pawH + (py + G.pawH) * q - F[f + 1];
    if (!up && ty > -G.pawH) ty = -G.pawH;
    var wx, wy, dx, dy, dd, mx, sl;
    if (front) {
      // wrist = paw + pastern; the pastern folds back (th grows) when the paw is lifted
      var th = G.th0 + (i === 0 ? P.f0a + P.f0r * 1.6 : P.f1a + P.f1r * 1.6);
      wx = tx + Math.sin(th) * G.pl; wy = ty - Math.cos(th) * G.pl;
      dx = wx - px; dy = wy - py; dd = Math.sqrt(dx * dx + dy * dy) || 1e-6; mx = (G.ua + G.fa) * 0.995;
      if (dd > mx) { sl = Math.min(dd - mx, G.slide); px += dx / dd * sl; py += dy / dd * sl; }   // the shoulder gives a little
      DA_ik(px, py, wx, wy, G.ua, G.fa, 1);                                                      // elbow points back
      L[o + 2] = DA_ex; L[o + 3] = DA_ey; L[o + 4] = DA_jx; L[o + 5] = DA_jy;
      L[o + 6] = DA_ex - Math.sin(th) * G.pl; L[o + 7] = DA_ey + Math.cos(th) * G.pl;
      L[o + 8] = DA_clamp((th - G.th0) * 0.85, -0.4, 2.3);
    } else {
      var ma = P.ga > 0.25 ? G.ma + (i === 2 ? P.hm2 : P.hm3) : G.ma + (1 - p) * 0.9 * (tx - nx) / G.hh + (i === 2 ? P.hm2 : P.hm3);
      ma = ma < -0.9 ? -0.9 : (ma > 1.5 && q < 0.5) ? 1.5 : ma;
      var mxv = -Math.sin(ma) * G.meta, myv = -Math.cos(ma) * G.meta, hkx = tx + mxv, hky = ty + myv;
      if (!up && hky > -b.bone) hky = -b.bone;
      dx = hkx - px; dy = hky - py; dd = Math.sqrt(dx * dx + dy * dy) || 1e-6; mx = (G.thigh + G.shank) * 0.995;
      if (dd > mx) { sl = Math.min(dd - mx, G.slide); px += dx / dd * sl; py += dy / dd * sl; }   // the hip gives a little
      DA_ik(px, py, hkx, hky, G.thigh, G.shank, -1);                                             // stifle forward, hock back
      L[o + 2] = DA_jx; L[o + 3] = DA_jy; L[o + 4] = DA_ex; L[o + 5] = DA_ey;
      L[o + 6] = DA_ex + (tx - hkx); L[o + 7] = DA_ey + (ty - hky);
      var lift = -G.pawH - L[o + 7];
      L[o + 8] = DA_clamp(lift / (G.LL * 0.35 + 0.03), 0, 1) * 0.65 * (1 - q);
    }
    L[o] = px; L[o + 1] = py;
  }
}

// ---------- body parts (each emits sub-paths into the current path) ----------
function DA_torso(c) {
  var G = DA_g, b = G.b, cr = DA_cr, rr = DA_rr, P = DA_P;
  DA_n = 0;
  DA_pr(-rr * 0.93, -rr * 0.28, b.fRump);                       // upper buttock
  DA_pr(-rr * 0.42, -rr * 0.99, b.fBack);                       // croup
  DA_pu(0.42, -1 + b.dip - P.arch * 0.3, b.fBack);              // loin / mid back
  DA_pc(-cr * 0.28, -cr * 1.0, b.fBack);                        // withers
  DA_pc(cr * 0.5, -cr * 0.86, b.fBack * 0.5);                   // base of neck
  DA_pc(cr * (1 + b.fore), -cr * 0.18, b.fChest);               // forechest
  DA_pc(cr * 0.82, cr * 0.62, b.fChest);                        // lower chest
  DA_pc(cr * 0.1, cr * 1.0, b.fBelly);                          // brisket
  DA_pc(-cr * 0.85, cr * 0.95, b.fBelly);                       // back of ribs
  DA_pr(rr * 0.75, G.groin, b.fBelly);                          // groin (tuck-up)
  DA_pr(-rr * 0.5, rr * 0.9, b.fRump * 0.6);                    // under the rump
  DA_pr(-rr * 1.0, rr * 0.3, b.fRump);                          // buttock
  DA_emit(c, b.fur, b.famp, b.fsp, false);
}
function DA_neck(c) {
  var G = DA_g, b = G.b, cr = DA_cr;
  var mx = (DA_NBx + DA_Hx) / 2, my = (DA_NBy + DA_Hy) / 2, dx = DA_Hx - DA_NBx, dy = DA_Hy - DA_NBy, l = Math.sqrt(dx * dx + dy * dy) || 1e-6;
  var nx = dy / l, ny = -dx / l, w = b.neckW;
  DA_n = 0;
  DA_pc(-cr * 0.45, -cr * 0.78, 0);
  DA_pt(mx + nx * w, my + ny * w, b.fBack * 0.7);
  DA_ph(-b.sl * 0.6, -b.sh * 0.45, 0);
  DA_ph(0.12, b.sh * 0.5, 0);
  DA_pt(mx - nx * w * 0.85, my - ny * w * 0.85, b.fChest);
  DA_pc(cr * (0.92 + b.fore * 0.6), cr * 0.05, b.fChest);
  DA_pc(0, cr * 0.1, 0);
  DA_emit(c, b.fur, b.famp, b.fsp, false);
}
// part: 0 = everything (outline pass), 1 = shoulder (inside the chest), 2 = forearm, 3 = pastern, 4 = paw
function DA_legFront(c, i, part) {
  var G = DA_g, b = G.b, L = DA_L, o = i * 12, bn = b.bone, k = b.legFur === 3 ? 1.3 : b.legFur === 2 ? 1.15 : 1;
  var px = L[o], py = L[o + 1], jx = L[o + 2], jy = L[o + 3], ex = L[o + 4], ey = L[o + 5], ax = L[o + 6], ay = L[o + 7];
  var rt = Math.min(DA_cr * 0.6, bn * 1.7) * k, rj = bn * 1.0 * k, ra = bn * 0.92 * k, re = rt * 0.55 + rj * 0.5;
  if (part === 0 || part === 1) DA_cap(c, px, py, rt, ex, ey, re);
  if (part === 0 || part === 2) {
    DA_cap(c, ex, ey, re, jx, jy, rj);
    if (b.legFur === 2) { DA_dot(c, (ex + jx) / 2 - bn * 0.25, (ey + jy) / 2, rj * 1.22); DA_dot(c, jx - bn * 0.15, jy, rj * 1.2); }
    else if (b.legFur === 1) DA_fringe(c, ex - re * 0.8, ey, jx - rj * 0.7, jy - rj * 0.5, -1, 0.3, 3, bn * 0.95);
    else if (b.legFur === 3) DA_fringe(c, ex - re * 0.7, ey, jx - rj * 0.6, jy, -1, 0.3, 3, bn * 0.9);
  }
  if (part === 0 || part === 3) {
    DA_cap(c, jx, jy, rj, ax, ay, ra);
    if (b.legFur === 2) { DA_dot(c, (ax + jx) / 2, (ay + jy) / 2, rj * 1.2); DA_dot(c, ax - bn * 0.1, ay - bn * 0.2, rj * 1.15); }
  }
  if (part === 0 || part === 4) DA_paw(c, ax, ay, L[o + 8]);
}
function DA_legHind(c, i, part) {
  var G = DA_g, b = G.b, L = DA_L, o = i * 12, bn = b.bone, k = b.legFur === 3 ? 1.3 : b.legFur === 2 ? 1.15 : 1;
  var px = L[o], py = L[o + 1], jx = L[o + 2], jy = L[o + 3], hx = L[o + 4], hy = L[o + 5], ax = L[o + 6], ay = L[o + 7];
  var rt = DA_rr * 0.8, rj = bn * 1.6 * k, rh = bn * 1.05 * k, ra = bn * 0.92 * k;
  if (part === 0 || part === 1) {
    DA_cap(c, px, py, rt, jx, jy, rj);
    if (b.legFur === 1) DA_fringe(c, px - rt * 0.75, py - rt * 0.2, hx - rh * 0.3, hy - rh, -0.9, 0.45, 4, bn * 1.15);
    else if (b.legFur === 3 || b.fRump > 0.5) DA_fringe(c, px - rt * 0.8, py, (jx + hx) / 2 - rj, (jy + hy) / 2, -0.9, 0.45, 3, bn * 1.2);
    if (b.legFur === 2) { DA_dot(c, jx + bn * 0.1, jy, rj * 1.15); DA_dot(c, (px + jx) / 2 - rt * 0.5, (py + jy) / 2 + rt * 0.3, rt * 0.55); }
  }
  if (part === 0 || part === 2) {
    DA_cap(c, jx, jy, rj, hx, hy, rh);
    if (b.legFur === 2) DA_dot(c, (jx + hx) / 2, (jy + hy) / 2, rj * 1.05);
  }
  if (part === 0 || part === 3) {
    DA_cap(c, hx, hy, rh, ax, ay, ra);
    if (b.legFur === 2) { DA_dot(c, hx - bn * 0.2, hy, rh * 1.3); DA_dot(c, (ax + hx) / 2, (ay + hy) / 2, rh * 1.25); DA_dot(c, ax, ay - bn * 0.25, rh * 1.25); }
    else if (b.legFur === 3) DA_fringe(c, hx - rh * 0.7, hy, ax - ra * 0.5, ay + G.pawH * 0.3, -1, 0.3, 2, bn * 0.9);
  }
  if (part === 0 || part === 4) DA_paw(c, ax, ay, L[o + 8]);
}
function DA_paw(c, ax, ay, rot) {
  var G = DA_g, h = G.pawH, l = G.pawL, co = Math.cos(rot), si = Math.sin(rot);
  // heel slightly behind the ankle, toes forward; rotates about the ankle
  var hx = -l * 0.12, hy = 0, tx = l * 0.52, ty = h * 0.08;
  DA_cap(c, ax + hx * co - hy * si, ay + hx * si + hy * co, h, ax + tx * co - ty * si, ay + tx * si + ty * co, h * 0.92);
}
// ---------- tail ----------
// builds the chain; returns the number of joints
function DA_tailChain() {
  var G = DA_g, b = G.b, T = b.tail, P = DA_P, N = 8, i;
  var a0 = T.a * DA_RAD + P.tailA, curl = (T.curl || 0) * DA_RAD * P.tailC;
  if (P.tailO > 0) { a0 += (P.tailOa - a0) * P.tailO; curl += (P.tailOc - curl) * P.tailO; }
  var seg = T.len / N, x = DA_rX(G.tbx, G.tby), y = DA_rY(G.tbx, G.tby), X = DA_TXs, Y = DA_TYs, A = DA_TAs, W = DA_TWs, k = T.k;
  var stiff = (curl > 3 || curl < -3) ? 0.35 : 1;
  for (i = 0; i <= N; i++) {
    var u = i / N, an = a0 + curl * Math.pow(u, 1.15) + P.tailW * stiff * Math.sin(DA_wph - i * 0.42) * (0.35 + 0.65 * u);
    var w = T.w;
    if (k === 'otter') w *= 1 - 0.66 * u;
    else if (k === 'whip') w *= 1 - 0.74 * u;
    else if (k === 'brush') w *= 0.62 + 0.62 * Math.sin(Math.PI * Math.pow(u, 0.8)) - 0.12 * u;
    else if (k === 'plume') w *= 1 - 0.45 * u;
    else if (k === 'pom') w *= 1;
    W[i] = w; A[i] = an; X[i] = x; Y[i] = y;
    if (y > -w * 0.9 && P.flip < 0.3) Y[i] = -w * 0.9;
    x -= Math.cos(an) * seg; y -= Math.sin(an) * seg;
    if (y > -w * 0.9 && P.flip < 0.3) y = -w * 0.9;
    if (P.flip > 0.7 && y < -1 + w) y = -1 + w;            // on its back: the ground is "above" the tail
  }
  return N;
}
// emit the tail outline from joint i0 to the tip (i0 = 0 whole tail, larger = just the tip for a coloured tip)
function DA_tail(c, i0, open, half) {
  var G = DA_g, b = G.b, T = b.tail, k = T.k, N = 8, X = DA_TXs, Y = DA_TYs, A = DA_TAs, W = DA_TWs, i;
  if (k === 'nub' || k === 'dock') {
    var a = T.a * DA_RAD + DA_P.tailA + DA_P.tailW * 0.6 * Math.sin(DA_wph), bx = DA_rX(G.tbx * 0.9, G.tby), by = DA_rY(G.tbx * 0.9, G.tby);
    DA_cap(c, bx, by, T.w * 1.1, bx - Math.cos(a) * T.len, by - Math.sin(a) * T.len, T.w * (k === 'nub' ? 0.9 : 0.7));
    return;
  }
  var fu = T.fu || 0, fo = T.fo || 0, fur = b.fur || (fu ? 1 : 0), amp = T.w * 0.5, sp = T.w * 1.3;
  if (k === 'plume') { amp = T.w * (fur === 2 ? 0.55 : fur === 4 ? 0.5 : 1.25); sp = T.w * (fur === 2 ? 1.2 : fur === 4 ? 1.0 : 1.35); }
  if (k === 'brush' && !fu) { fu = 0.7; fo = 0.5; fur = fur || 1; }
  if (k === 'pom') { fu = 1; fo = 1; }
  DA_n = 0;
  for (i = i0; i <= N; i += (i === i0 || i >= N - 2 ? 1 : 2)) {            // lower / outer side, base -> tip
    DA_pt(X[i] - Math.sin(A[i]) * W[i], Y[i] + Math.cos(A[i]) * W[i], i === i0 ? 0 : fu * (k === 'pom' ? 0 : 1));
  }
  DA_pt(X[N] - Math.cos(A[N]) * W[N] * 1.1, Y[N] - Math.sin(A[N]) * W[N] * 1.1, fu * 0.6);   // tip
  for (i = N; i >= i0; i -= (i === N || i <= i0 + 2 ? 1 : 2)) {             // upper / inner side, tip -> base
    if (half) DA_pt(X[i] - Math.sin(A[i]) * W[i] * 0.15, Y[i] + Math.cos(A[i]) * W[i] * 0.15, 0);
    else DA_pt(X[i] + Math.sin(A[i]) * W[i], Y[i] - Math.cos(A[i]) * W[i], i === i0 ? 0 : fo * (k === 'pom' ? 0 : 1));
  }
  DA_emit(c, open ? 0 : fur, amp, sp, open);
  if (k === 'pom' && !open) {
    var r = T.len * 0.42, cx = X[N] - Math.cos(A[N]) * r * 0.3, cy = Y[N] - Math.sin(A[N]) * r * 0.3;
    for (i = 0; i < 6; i++) DA_dot(c, cx + Math.cos(i * 1.047) * r * 0.55, cy + Math.sin(i * 1.047) * r * 0.55, r * 0.52);
    DA_dot(c, cx, cy, r * 0.7);
  }
}

// ============================================================================================
// Head. Head-local units are skull radii: +x to the nose, +y down, origin at the centre of the skull.
// ============================================================================================
var DA_Jx0 = 0, DA_Jy0 = 0, DA_Jc = 1, DA_Js = 0, DA_JL = 1, DA_xt = 1.8;
function DA_headSetup() {
  var b = DA_g.b, ph = DA_P.jaw * 0.62;
  DA_xt = b.sl * 0.8 + b.ml;
  DA_Jx0 = 0; DA_Jy0 = b.lip - 0.08; DA_Jc = Math.cos(ph); DA_Js = Math.sin(ph);
  DA_JL = DA_xt * 0.93 - 0.08 + b.under;
}
function DA_pj(lx, ly, w, t) {
  var x = DA_Jx0 + lx * DA_Jc - ly * DA_Js, y = DA_Jy0 + lx * DA_Js + ly * DA_Jc;
  DA_pt(DA_hX(x, y), DA_hY(x, y), w, t);
}
function DA_skull(c) {
  var b = DA_g.b, sl = b.sl, sh = b.sh, top = b.fur === 2 ? 0.8 : b.fur === 1 && b.famp > 0.1 ? 0.45 : 0, ck = b.cheek;
  var fur = b.fur || (ck ? 1 : 0);
  DA_n = 0;
  DA_ph(-sl, 0.05, top * 0.8 + ck * 0.5);
  DA_ph(-sl * 0.68, -sh * 0.76, top);
  DA_ph(0, -sh * (1 + b.dome), top);
  DA_ph(sl * 0.62, -sh * (0.66 + b.dome * 0.8), top * 0.5);
  DA_ph(sl * 0.95, -0.02, 0);
  DA_ph(sl * 0.55, sh * 0.72, ck * 0.3);
  DA_ph(-0.1, sh * 0.96, ck);
  DA_ph(-sl * 0.72, sh * 0.62, ck);
  if (DA_Hf < 0) DA_rev();
  DA_emit(c, fur === 3 ? 0 : fur, (b.famp || 0.05) * 0.85, b.fsp * 0.9, false);
}
// reverse the current control points (keeps outlines clockwise when the head is mirrored)
function DA_rev() {
  var n = DA_n, X = DA_PX, Y = DA_PY, W = DA_PW, T = DA_PT, i, j, t;
  for (i = 0, j = n - 1; i < j; i++, j--) {
    t = X[i]; X[i] = X[j]; X[j] = t; t = Y[i]; Y[i] = Y[j]; Y[j] = t; t = W[i]; W[i] = W[j]; W[j] = t; t = T[i]; T[i] = T[j]; T[j] = t;
  }
}
function DA_muzzle(c) {
  var b = DA_g.b, sl = b.sl, xt = DA_xt, mt = b.mt, mtip = b.mtip;
  DA_n = 0;
  DA_ph(-0.1, mt + 0.1);
  DA_ph(sl * 0.72, mt);
  DA_ph(sl * 0.8 + b.ml * 0.55, mt + (mtip - mt) * 0.55);
  DA_ph(xt - 0.12, mtip);
  DA_ph(xt + 0.03, mtip + b.nose * 0.95);
  DA_ph(xt - 0.1, b.lipT);
  DA_ph(sl * 0.8 + b.ml * 0.42, (b.lip + b.lipT) / 2 + b.flew);
  DA_ph(sl * 0.3, b.lip + b.flew * 0.5);
  DA_ph(-0.15, b.lip - 0.15);
  if (DA_Hf < 0) DA_rev();
  DA_emit(c, 0, 0, 0.1, false);
}
function DA_jawShape(c) {
  var b = DA_g.b, JL = DA_JL, jd = b.jd;
  DA_n = 0;
  DA_pj(-0.25, -0.05);
  DA_pj(JL * 0.55, 0);
  DA_pj(JL, 0.03);
  DA_pj(JL * 0.98, jd * 0.7);
  DA_pj(JL * 0.55, jd);
  DA_pj(0, jd * 1.1);
  DA_pj(-0.35, jd * 0.7);
  if (DA_Hf < 0) DA_rev();
  DA_emit(c, 0, 0, 0.1, false);
}
// beard hangs from the lower jaw (moves with it); moustache sits on the upper lip
function DA_beard(c) {
  var b = DA_g.b, JL = DA_JL, jd = b.jd, k = b.beard, fur = b.fur === 2 ? 2 : 1;
  DA_n = 0;
  DA_pj(JL * 0.12, -0.05);
  DA_pj(JL * 1.02, -0.06);
  DA_pj(JL * 1.1, jd * 0.7, 0.6);
  DA_pj(JL * 0.95, jd + 0.62 * k, 1);
  DA_pj(JL * 0.45, jd + 0.7 * k, 1);
  DA_pj(JL * 0.08, jd + 0.25 * k, 0.7);
  if (DA_Hf < 0) DA_rev();
  DA_emit(c, fur, DA_hr * 0.2, DA_hr * 0.3, false);
}
function DA_stache(c) {
  var b = DA_g.b, xt = DA_xt, k = b.beard, fur = b.fur === 2 ? 2 : 1;
  DA_n = 0;
  DA_ph(xt - b.ml * 0.8, b.lip - 0.42);
  DA_ph(xt - 0.05, b.mtip + b.nose * 1.1);
  DA_ph(xt + 0.1 * k, b.lipT + 0.02, 0.7);
  DA_ph(xt - 0.1, b.lipT + 0.4 * k, 1);
  DA_ph(xt - b.ml * 0.5, b.lip + 0.45 * k, 1);
  DA_ph(xt - b.ml * 0.9, b.lip + 0.12 * k, 0.5);
  if (DA_Hf < 0) DA_rev();
  DA_emit(c, fur, DA_hr * 0.2, DA_hr * 0.3, false);
}
function DA_topknot(c) {
  var b = DA_g.b, k = b.topknot, sh = b.sh, r = 0.4 * (0.7 + 0.3 * k);
  DA_hdot(c, -0.55, -sh * 0.78, r); DA_hdot(c, -0.18, -sh * 1.0 - 0.12 * k, r * 1.1); DA_hdot(c, 0.25, -sh * 0.98 - 0.1 * k, r * 1.05); DA_hdot(c, 0.58, -sh * 0.72, r * 0.85);
  if (k >= 1) { DA_hdot(c, -0.05, -sh * 1.28, r); DA_hdot(c, -0.85, -sh * 0.4, r * 0.9); }
}
function DA_hdot(c, lx, ly, r) { DA_dot(c, DA_hX(lx, ly), DA_hY(lx, ly), r * DA_hr); }

// erect / bat / tipped ear. far = the ear on the far side of the head (offset forward, drawn behind the skull)
function DA_earErect(c, far, inner) {
  var b = DA_g.b, E = b.ear, P = DA_P;
  var tilt = (E.tilt || 0) * DA_RAD + P.earB * 0.62 + P.earF + (far ? -0.16 : 0) + P.earUp * 1.25;
  var len = E.len * (E.k === 'tipped' ? 0.8 : 1) * (1 - 0.12 * Math.max(0, P.earB)) * (1 - 0.25 * P.earUp), bw = E.w / 2, rd = E.round || (E.k === 'bat' ? 0.3 : 0);
  var axx = -Math.sin(tilt), axy = -Math.cos(tilt), pxx = Math.cos(tilt), pxy = -Math.sin(tilt);
  var bx = E.x + (far ? E.w * 0.42 : 0) + P.earB * 0.12 * -1, by = E.y + (far ? 0.04 : 0) + Math.max(0, P.earB) * 0.18;
  if (inner) { bw *= 0.5; len *= 0.74; bx += pxx * E.w * 0.12; by += pxy * E.w * 0.12 - 0.05; }
  DA_n = 0;
  DA_ph(bx - pxx * bw - axx * 0.2, by - pxy * bw - axy * 0.2);
  DA_ph(bx - pxx * bw * (0.7 + rd) + axx * len * 0.5, by - pxy * bw * (0.7 + rd) + axy * len * 0.5);
  if (rd > 0.25) {
    DA_ph(bx - pxx * bw * 0.45 + axx * len * 0.95, by - pxy * bw * 0.45 + axy * len * 0.95);
    DA_ph(bx + pxx * bw * 0.4 + axx * len * 0.97, by + pxy * bw * 0.4 + axy * len * 0.97);
  } else DA_ph(bx + axx * len, by + axy * len, 0, 0.35 + rd * 1.5);
  DA_ph(bx + pxx * bw * (0.6 + rd) + axx * len * 0.5, by + pxy * bw * (0.6 + rd) + axy * len * 0.5);
  DA_ph(bx + pxx * bw - axx * 0.2, by + pxy * bw - axy * 0.2);
  if (!inner) DA_ph(bx - axx * 0.45, by - axy * 0.45);
  if (DA_Hf < 0) DA_rev();
  DA_emit(c, 0, 0, 0.1, false);
}
// folded tip of a semi-erect (collie) ear
function DA_earTipFold(c) {
  var b = DA_g.b, E = b.ear, P = DA_P;
  var tilt = (E.tilt || 0) * DA_RAD + P.earB * 0.62 + P.earF + P.earUp * 1.25, len = E.len * 0.8 * (1 - 0.12 * Math.max(0, P.earB)) * (1 - 0.25 * P.earUp), bw = E.w / 2;
  var axx = -Math.sin(tilt), axy = -Math.cos(tilt), pxx = Math.cos(tilt), pxy = -Math.sin(tilt);
  var bx = E.x - P.earB * 0.12, by = E.y + Math.max(0, P.earB) * 0.18;
  var tx = bx + axx * len, ty = by + axy * len, f = 0.42 + 0.1 * Math.sin(P.earF * 6);
  DA_n = 0;
  DA_ph(tx - pxx * bw * 0.42 - axx * len * 0.24, ty - pxy * bw * 0.42 - axy * len * 0.24);
  DA_ph(tx + axx * 0.02, ty + axy * 0.02, 0, 0.6);
  DA_ph(tx + pxx * bw * 1.15 - axx * len * f * 0.6, ty + pxy * bw * 1.15 - axy * len * f * 0.6 + 0.08, 0, 0.5);
  DA_ph(tx + pxx * bw * 0.3 - axx * len * 0.3, ty + pxy * bw * 0.3 - axy * len * 0.3);
  if (DA_Hf < 0) DA_rev();
  DA_emit(c, 0, 0, 0.1, false);
}
// hanging ear (drop) or small forward-folding ear (button)
function DA_earDrop(c) {
  var b = DA_g.b, E = b.ear, P = DA_P, rose = E.k === 'rose', btn = E.k === 'button' || rose;
  // rose ear: a small thin flap folded back along the top/back of the skull (axis points backwards, about level);
  // alert lifts it a little, it never stands up
  var al = rose ? 1.72 + DA_clamp(P.earUp * 0.3 + P.earF * 0.15 - P.earB * 0.2, -0.3, 0.38)
    : (btn ? -1.05 + P.earB * 0.5 : 0.12 + P.earB * 0.3 + DA_clamp(-DA_Ha * DA_Hf * 0.85, -1.3, 1.3) * (1 - P.earUp)) + P.earF * (btn ? 0.5 : 1) + P.earUp * (btn ? 0.6 : 1.55), len = E.len, w = E.w;
  var axx = -Math.sin(al), axy = Math.cos(al), pxx = Math.cos(al), pxy = Math.sin(al);
  var bx = E.x, by = E.y - (P.earB < 0 ? -P.earB * 0.14 : -P.earB * 0.06);
  var fw = E.fur ? 1 : 0;
  DA_n = 0;
  DA_ph(bx - pxx * w * 0.45 - axx * 0.08, by - pxy * w * 0.45 - axy * 0.08);
  DA_ph(bx + pxx * w * 0.5 + axx * 0.02, by + pxy * w * 0.5 + axy * 0.02);
  var lb = E.lobe || 0;
  DA_ph(bx + pxx * w * (btn ? 0.5 : 0.56 + 0.1 * lb) + axx * len * 0.45, by + pxy * w * (btn ? 0.5 : 0.56 + 0.1 * lb) + axy * len * 0.45, fw);
  if (btn) DA_ph(bx + pxx * w * 0.15 + axx * len, by + pxy * w * 0.15 + axy * len, 0, 0.5);
  else {
    DA_ph(bx + pxx * w * (0.22 + 0.2 * lb) + axx * len * 0.96, by + pxy * w * (0.22 + 0.2 * lb) + axy * len * 0.96, fw);
    DA_ph(bx - pxx * w * (0.08 + 0.3 * lb) + axx * len * 0.93, by - pxy * w * (0.08 + 0.3 * lb) + axy * len * 0.93, fw);
  }
  DA_ph(bx - pxx * w * (btn ? 0.35 : 0.42 + 0.16 * lb) + axx * len * 0.45, by - pxy * w * (btn ? 0.35 : 0.42 + 0.16 * lb) + axy * len * 0.45, fw * 0.8);
  if (DA_Hf < 0) DA_rev();
  DA_emit(c, E.fur || 0, DA_hr * 0.16, DA_hr * 0.3, false);
  if (rose) { DA_rose[0] = bx; DA_rose[1] = by; DA_rose[2] = axx; DA_rose[3] = axy; DA_rose[4] = pxx; DA_rose[5] = pxy; }
}
var DA_rose = [0, 0, 0, 0, 0, 0];
// the fold of a rose ear: a short crease from the set-on towards the tip, so it reads as a folded-back flap
function DA_roseFold(c) {
  var E = DA_g.b.ear, R = DA_rose, bx = R[0], by = R[1], ax = R[2], ay = R[3], px = R[4], py = R[5], len = E.len, w = E.w;
  var x0 = bx + px * w * 0.3 + ax * len * 0.12, y0 = by + py * w * 0.3 + ay * len * 0.12;
  var x1 = bx + px * w * 0.05 + ax * len * 0.5, y1 = by + py * w * 0.05 + ay * len * 0.5;
  var x2 = bx - px * w * 0.02 + ax * len * 0.78, y2 = by - py * w * 0.02 + ay * len * 0.78;
  c.beginPath();
  c.moveTo(DA_hX(x0, y0), DA_hY(x0, y0));
  c.quadraticCurveTo(DA_hX(x1, y1), DA_hY(x1, y1), DA_hX(x2, y2), DA_hY(x2, y2));
  c.stroke();
}
function DA_isErect(E) { return E.k === 'erect' || E.k === 'bat' || E.k === 'tipped'; }

// all head shapes that share the silhouette outline
function DA_headShapes(c) {
  var b = DA_g.b;
  DA_jawShape(c);
  if (b.beard) DA_beard(c);
  DA_muzzle(c);
  DA_skull(c);
  if (b.beard) DA_stache(c);
  if (b.topknot) DA_topknot(c);
  if (DA_isErect(b.ear)) DA_earErect(c, false, false);
}

// lolling tongue, drawn in the lower-jaw frame. dir 1 = hangs down past the chin, -1 = flops the other way
function DA_tongue(c, dir) {
  var G = DA_g, P = DA_P, Q = DA_Q, hr = DA_hr, tg = P.tongue, JL = DA_JL;
  if (!(tg > 0.06 && P.jaw > 0.06)) return;
  c.save();
  c.translate(DA_Hx, DA_Hy); c.rotate(DA_Ha); c.scale(hr * DA_Hf, hr);
  c.translate(DA_Jx0, DA_Jy0); c.rotate(P.jaw * 0.62);
  c.beginPath(); c.moveTo(JL * 0.3, -0.04); c.lineTo(JL * 0.88, -0.06);
  if (dir > 0) c.quadraticCurveTo(JL * 1.02 + 0.05 * tg, -0.02, JL * 1.0 + 0.06 * tg, 0.12 + 0.42 * tg);
  else c.quadraticCurveTo(JL * 1.0 + 0.1 * tg, -0.1, JL * 1.0 + 0.16 * tg, -0.2 - 0.4 * tg);
  c.lineCap = 'round';
  c.lineWidth = 0.3 + G.ow / hr; c.strokeStyle = DA_OUT; c.stroke();
  c.lineWidth = 0.3 - G.ow / hr * 0.4; c.strokeStyle = Q.tongue; c.stroke();
  c.restore();
}
// fills + face details. The outline of the head shapes must already have been stroked.
function DA_headFill(c) {
  var G = DA_g, b = G.b, P = DA_P, Q = DA_Q, S = Q.S, E = b.ear, sl = b.sl, sh = b.sh, xt = DA_xt, hr = DA_hr;
  // lower jaw, mouth, tongue
  if (b.beard) { c.fillStyle = S.beard; c.beginPath(); DA_beard(c); c.fill(); }
  c.fillStyle = S.jaw; c.beginPath(); DA_jawShape(c); c.fill();
  if (P.jaw > 0.06) {
    c.fillStyle = Q.mouth; c.beginPath();
    c.moveTo(DA_hX(DA_Jx0 + 0.1, DA_Jy0), DA_hY(DA_Jx0 + 0.1, DA_Jy0));
    c.lineTo(DA_hX(xt - 0.15, b.lipT - 0.05), DA_hY(xt - 0.15, b.lipT - 0.05));
    var jx = DA_Jx0 + DA_JL * 0.96 * DA_Jc - 0.06 * DA_Js, jy = DA_Jy0 + DA_JL * 0.96 * DA_Js + 0.06 * DA_Jc;
    c.lineTo(DA_hX(jx, jy), DA_hY(jx, jy)); c.closePath(); c.fill();
  }
  var up = P.flip > 0.5;
  if (!up) DA_tongue(c, 1);
  // muzzle, skull, beard, topknot, erect ear
  c.fillStyle = S.muz; c.beginPath(); DA_muzzle(c); c.fill();
  c.fillStyle = S.skull; c.beginPath(); DA_skull(c); c.fill();
  if (b.topknot) { c.fillStyle = S.top; c.beginPath(); DA_topknot(c); c.fill(); }
  // markings + shading, clipped to skull + muzzle
  c.save();
  c.beginPath(); DA_muzzle(c); DA_skull(c); c.clip();
  c.translate(DA_Hx, DA_Hy); c.rotate(DA_Ha); c.scale(hr * DA_Hf, hr);
  DA_headMarks(c);
  c.fillStyle = 'rgba(50,30,18,0.16)';
  c.beginPath(); c.moveTo(-1.4, sh * 0.5); c.quadraticCurveTo(0, sh * 0.95, xt * 0.6, b.lip + 0.1); c.lineTo(xt + 0.3, b.lipT + 0.05); c.lineTo(xt + 0.3, 2); c.lineTo(-1.4, 2); c.closePath(); c.fill();
  c.fillStyle = 'rgba(255,255,255,0.14)';
  c.beginPath(); c.ellipse(-0.05, -sh * 0.78, 0.62, 0.26, -0.15, 0, DA_TAU); c.fill();
  c.restore();
  if (b.beard) { c.fillStyle = S.beard; c.beginPath(); DA_stache(c); c.fill(); }
  if (up) DA_tongue(c, -1);                      // belly-up: the tongue flops over the upper lip towards the ground
  if (DA_isErect(E)) {
    c.fillStyle = S.ear; c.beginPath(); DA_earErect(c, false, false); c.fill();
    if (S.earTip) { c.save(); c.beginPath(); DA_earErect(c, false, false); c.clip(); c.fillStyle = S.earTip; c.beginPath(); var et = (E.tilt || 0) * DA_RAD + P.earB * 0.62 + P.earUp * 1.25; DA_hdot(c, E.x - Math.sin(et) * E.len * 1.05, E.y - Math.cos(et) * E.len * 1.05, E.len * 0.62); c.fill(); c.restore(); }
  }
  // ---- face details in head space ----
  c.save();
  c.translate(DA_Hx, DA_Hy); c.rotate(DA_Ha); c.scale(hr * DA_Hf, hr);
  var lw = G.dl / hr;
  c.lineCap = 'round'; c.lineJoin = 'round';
  // nose
  c.fillStyle = Q.nose; c.beginPath(); c.ellipse(xt - b.nose * 0.3, b.mtip + b.nose * 0.55, b.nose, b.nose * 0.82, 0.15, 0, DA_TAU); c.fill();
  c.fillStyle = 'rgba(255,255,255,0.35)'; c.beginPath(); c.ellipse(xt - b.nose * 0.5, b.mtip + b.nose * 0.25, b.nose * 0.38, b.nose * 0.2, 0.1, 0, DA_TAU); c.fill();
  // mouth line / smile
  if (P.jaw <= 0.06) {
    var sm = P.smile;
    c.strokeStyle = Q.L.muz; c.lineWidth = lw; c.beginPath();
    c.moveTo(xt - 0.1, b.lipT + 0.02);
    c.quadraticCurveTo(sl * 0.8 + b.ml * 0.42, (b.lip + b.lipT) / 2 + b.flew + 0.06, sl * 0.42, b.lip + b.flew * 0.5 - sm * 0.04);
    c.quadraticCurveTo(sl * 0.22, b.lip + b.flew * 0.4 - sm * 0.1, sl * 0.18, b.lip - 0.05 - sm * 0.22);
    c.stroke();
  }
  if (b.wrinkle) {
    c.strokeStyle = Q.lineIn; c.lineWidth = lw; c.beginPath();
    c.moveTo(sl * 0.62, b.mt - 0.42); c.quadraticCurveTo(sl * 0.82, b.mt - 0.28, sl * 0.72, b.mt - 0.06);
    if (b.wrinkle >= 1) { c.moveTo(sl * 0.3, -sh * 0.72); c.quadraticCurveTo(sl * 0.5, -sh * 0.6, sl * 0.6, -sh * 0.72); }
    c.moveTo(sl * 0.5, b.lip + 0.05); c.quadraticCurveTo(sl * 0.3, b.lip + 0.2, sl * 0.38, b.lip + 0.45);
    c.stroke();
  }
  DA_eye(c, lw);
  if (b.brows || b.fringe) {
    var ex = b.ex, ey = b.ey - b.es - (b.brows ? 0 : 0.1), kk = b.brows ? 1 : 0.62;
    c.fillStyle = S.brow || S.skull; c.strokeStyle = b.brows ? DA_OUT : Q.lineIn; c.lineWidth = lw * (b.brows ? 1 : 0.9);
    c.beginPath();
    c.moveTo(ex - 0.42, ey - 0.12);
    c.quadraticCurveTo(ex + 0.1, ey - 0.5 * kk, ex + 0.55 * kk, ey + 0.16);
    c.lineTo(ex + 0.28, ey + 0.02); c.lineTo(ex + 0.22, ey + 0.26 * kk); c.lineTo(ex + 0.02, ey + 0.04); c.lineTo(ex - 0.1, ey + 0.2 * kk);
    c.closePath(); c.fill(); c.stroke();
  }
  if (b.bow) {
    var bxx = -0.12, byy = -sh - 0.28;
    c.fillStyle = S.top; c.strokeStyle = DA_OUT; c.lineWidth = lw;
    c.beginPath(); c.moveTo(-0.45, -sh * 0.8); c.quadraticCurveTo(-0.3, -sh - 0.2, bxx, byy); c.quadraticCurveTo(0.1, -sh - 0.15, 0.35, -sh * 0.8); c.closePath(); c.fill(); c.stroke();
    c.beginPath(); c.moveTo(bxx, byy); c.quadraticCurveTo(-0.25, byy - 0.5, -0.5, byy - 0.42); c.quadraticCurveTo(-0.35, byy - 0.2, bxx, byy); c.fill(); c.stroke();
    c.fillStyle = '#d9574a';
    c.beginPath(); c.moveTo(bxx, byy); c.lineTo(bxx - 0.42, byy - 0.26); c.lineTo(bxx - 0.4, byy + 0.24); c.closePath();
    c.moveTo(bxx, byy); c.lineTo(bxx + 0.42, byy - 0.26); c.lineTo(bxx + 0.4, byy + 0.24); c.closePath(); c.fill(); c.stroke();
    c.fillStyle = '#f07a6c'; c.beginPath(); c.arc(bxx, byy, 0.11, 0, DA_TAU); c.fill(); c.stroke();
  }
  c.restore();
  // ears that sit on top of the head side
  c.lineWidth = G.ow * 2; c.strokeStyle = DA_OUT;
  if (E.k === 'drop' || E.k === 'button' || E.k === 'rose') {
    c.beginPath(); DA_earDrop(c); c.stroke(); c.fillStyle = S.ear; c.fill();
    if (E.k === 'rose') { c.save(); c.lineWidth = G.ow; c.lineCap = 'round'; c.strokeStyle = Q.L.ear; DA_roseFold(c); c.restore(); }
    if (Q.pat === 'spots') { c.fillStyle = S.skull; c.beginPath(); DA_hdot(c, E.x + 0.15, E.y + E.len * 0.3, 0.16); DA_hdot(c, E.x - 0.1, E.y + E.len * 0.72, 0.12); c.fill(); }
  } else {
    c.fillStyle = Q.earPink;
    if (E.k !== 'tipped') { c.beginPath(); DA_earErect(c, false, true); c.fill(); }
    else { c.beginPath(); DA_earTipFold(c); c.stroke(); c.fillStyle = Q.darkHead ? DA_mix(S.ear, '#ffffff', 0.1) : DA_far(S.ear); c.fill(); }
  }
}
function DA_eye(c, lw) {
  var b = DA_g.b, P = DA_P, Q = DA_Q, ex = b.ex, ey = b.ey, r = b.es * (1 + 0.28 * P.eyeW), o = P.eyeO, q = P.eyeQ, dr = Math.max(P.eyeD, b.droop);
  c.lineWidth = lw * 1.15; c.strokeStyle = DA_OUT;
  if (o < 0.4) {
    c.beginPath();
    if (q > 0.5) { c.moveTo(ex - r * 1.1, ey + r * 0.35); c.quadraticCurveTo(ex, ey - r * 1.0, ex + r * 1.1, ey + r * 0.35); }
    else { c.moveTo(ex - r * 1.1, ey - r * 0.1); c.quadraticCurveTo(ex, ey + r * 0.9, ex + r * 1.1, ey - r * 0.1); }
    c.stroke();
    return;
  }
  if (q > 0.5) {   // happy squint: an upward arc
    c.beginPath(); c.moveTo(ex - r * 1.1, ey + r * 0.45); c.quadraticCurveTo(ex, ey - r * 1.15, ex + r * 1.1, ey + r * 0.45); c.stroke();
    return;
  }
  var ry = r * (0.55 + 0.5 * o) * (1 - 0.25 * q), rx = r * 0.92;
  if (P.eyeW > 0.3 || Q.eye) {
    c.fillStyle = '#fffaf2'; c.beginPath(); c.ellipse(ex, ey, rx * 1.28, ry * 1.22, 0, 0, DA_TAU); c.fill(); c.stroke();
    c.fillStyle = Q.eye || Q.eyeDark; c.beginPath(); c.ellipse(ex + rx * 0.12, ey, rx * 0.95, ry * 0.98, 0, 0, DA_TAU); c.fill();
    if (Q.eye) { c.fillStyle = Q.eyeDark; c.beginPath(); c.ellipse(ex + rx * 0.15, ey, rx * 0.45, ry * 0.5, 0, 0, DA_TAU); c.fill(); }
  } else if (Q.darkHead) {
    c.fillStyle = '#b07a3c'; c.beginPath(); c.ellipse(ex, ey, rx * 1.18, ry * 1.15, 0, 0, DA_TAU); c.fill();
    c.fillStyle = '#1c120e'; c.beginPath(); c.ellipse(ex + rx * 0.08, ey, rx * 0.78, ry * 0.8, 0, 0, DA_TAU); c.fill();
  } else {
    c.fillStyle = Q.eyeDark; c.beginPath(); c.ellipse(ex, ey, rx, ry, 0, 0, DA_TAU); c.fill();
  }
  c.fillStyle = '#ffffff'; c.beginPath(); c.arc(ex - rx * 0.28, ey - ry * 0.35, r * 0.34, 0, DA_TAU); c.fill();
  if (dr > 0.15) {   // droopy upper lid
    c.fillStyle = Q.S.skull; c.beginPath();
    c.moveTo(ex - r * 1.5, ey - r * 1.5); c.lineTo(ex + r * 1.5, ey - r * 1.5); c.lineTo(ex + r * 1.5, ey - r * (0.75 - 0.2 * dr)); c.lineTo(ex - r * 1.5, ey - r * (0.75 - 0.85 * dr)); c.closePath(); c.fill();
    c.beginPath(); c.moveTo(ex + r * 1.3, ey - r * (0.75 - 0.2 * dr)); c.lineTo(ex - r * 1.3, ey - r * (0.75 - 0.85 * dr)); c.stroke();
  }
  var br = P.brow;
  if (br < -0.25 || br > 0.25 || P.eyeW > 0.4) {
    c.strokeStyle = Q.lineIn; c.lineWidth = lw * 1.2; c.beginPath();
    var yb = ey - r * 1.55 - P.eyeW * 0.08;
    c.moveTo(ex - r * 1.1, yb - br * 0.13); c.lineTo(ex + r * 1.1, yb + br * 0.13); c.stroke();
  }
}

// ============================================================================================
// Coat patterns. Body marks are drawn in torso space (u along the spine, v across) inside a clip of the torso + neck;
// head marks are drawn in head space inside a clip of the skull + muzzle.
// ============================================================================================
var DA_M_UNDER = [1.05, 0.35, 0.55, 0.6, 0.1, 0.64, -0.3, 0.5, -0.95, 0.55, -0.95, 2.4, 1.1, 2.4];
var DA_M_UNDER_LOW = [1.05, 0.6, 0.5, 0.72, 0.0, 0.74, -0.3, 0.62, -0.95, 0.7, -0.95, 2.4, 1.1, 2.4];
var DA_M_SADDLE = [-0.78, -1.9, -0.66, -0.1, -0.2, 0.3, 0.4, 0.25, 0.88, -0.05, 1.12, -0.7, 1.18, -1.9];
var DA_M_SADDLE_BIG = [-0.85, -1.9, -0.74, 0.25, -0.1, 0.55, 0.5, 0.5, 0.95, 0.15, 1.12, -0.7, 1.15, -1.9];
var DA_M_SADDLE_SM = [-0.7, -1.9, -0.55, -0.45, -0.1, -0.05, 0.4, -0.1, 0.8, -0.4, 1.0, -0.9, 1.05, -1.9];
// chest space (units of chest radius, origin = chest centre, forechest at x ~ 1.1, brisket at y = 1)
var DA_C_BIB = [1.7, -1.0, 0.8, -0.8, 0.55, -0.1, 0.6, 0.7, 0.9, 1.5, 2.2, 1.5, 2.2, -1.0];
var DA_C_BIB_RIM = [1.7, -1.25, 0.5, -1.0, 0.15, -0.1, 0.2, 0.8, 0.6, 1.7, 2.2, 1.7, 2.2, -1.25];
var DA_C_UNDER = [2.2, -0.9, 0.7, -0.6, 0.1, 0.1, -0.5, 0.45, -1.3, 0.6, -1.3, 2.4, 2.2, 2.4];
var DA_C_UNDER_LOW = [2.2, -0.1, 0.8, 0.1, 0.2, 0.5, -0.5, 0.7, -1.3, 0.75, -1.3, 2.4, 2.2, 2.4];
var DA_C_FRONT = [0.5, -2.4, 0.15, -0.4, -0.05, 0.5, 0.3, 2.4, 2.6, 2.4, 2.6, -2.4];
function DA_cpoly(c, a) {
  DA_n = 0;
  for (var i = 0; i < a.length; i += 2) DA_pc(a[i] * DA_cr, a[i + 1] * DA_cr);
  DA_emit(c, 0, 0, 0.1, false);
}
var DA_N_THROAT = [-0.35, -0.4, 0.5, -0.3, 1.25, -0.2, 1.25, -1.3, -0.35, -1.3];
var DA_N_COLLAR = [0.02, 1.3, 0.1, 0.5, 0.0, -1.3, 0.72, -1.3, 0.6, 0, 0.66, 1.3];
var DA_N_ALL = [0.1, 1.3, 0.1, -1.3, 1.4, -1.3, 1.4, 1.3];
var DA_N_TOP = [0.55, 1.3, 0.55, -0.2, 1.4, -0.4, 1.4, 1.3];

function DA_upoly(c, a) {
  DA_n = 0;
  for (var i = 0; i < a.length; i += 2) DA_pu(a[i], a[i + 1]);
  DA_emit(c, 0, 0, 0.1, false);
}
// neck space: s 0 (base) .. 1 (head), o across in neck half-widths (+ = nape side)
function DA_npoly(c, a) {
  var dx = DA_Hx - DA_NBx, dy = DA_Hy - DA_NBy, l = Math.sqrt(dx * dx + dy * dy) || 1e-6, w = DA_g.b.neckW, nx = dy / l * w, ny = -dx / l * w;
  if (a === DA_N_THROAT && -dy / l < 0.2) return;        // head down: the pale throat faces the ground, don't show it
  DA_n = 0;
  for (var i = 0; i < a.length; i += 2) DA_pt(DA_NBx + dx * a[i] + nx * a[i + 1], DA_NBy + dy * a[i] + ny * a[i + 1], 0, 0.5);
  DA_emit(c, 0, 0, 0.1, false);
}
var DA_N_TOP_SM = [0.7, 1.3, 0.7, 0.2, 1.4, 0.0, 1.4, 1.3];
// brindle stripes across the torso
function DA_stripes(c, col, seed) {
  c.strokeStyle = col; c.lineWidth = 0.03; c.beginPath();
  for (var i = 0; i < 11; i++) {
    var uu = -0.45 + i * 0.19 + DA_rnd(seed + i) * 0.06, top = -1.1 + DA_rnd(seed * 2 + i) * 0.5, bot = 0.2 + DA_rnd(seed * 3 + i) * 0.7;
    c.moveTo(DA_tX(uu, top), DA_tY(uu, top)); c.quadraticCurveTo(DA_tX(uu - 0.1, (top + bot) / 2), DA_tY(uu - 0.1, (top + bot) / 2), DA_tX(uu - 0.04, bot), DA_tY(uu - 0.04, bot));
  }
  c.stroke();
}
// soft irregular blobs over the torso (merle marbling): each blob = 2-3 overlapping ellipses
function DA_blobs(c, col, seed, n, r0, r1) {
  c.fillStyle = col; c.beginPath();
  for (var i = 0; i < n; i++) {
    var u = -0.4 + DA_frac(i * 0.618 + DA_rnd(seed + i) * 0.3) * 1.75, v = -1.0 + DA_rnd(seed * 1.3 + i * 2.7) * 1.3, r = r0 + (r1 - r0) * DA_rnd(seed * 0.7 + i * 5.3);
    DA_uell(c, u, v, r, r * 2.2);
    DA_uell(c, u + r * 0.7, v + r * 1.2, r * 0.6, r * 1.4);
    if (i & 1) DA_uell(c, u - r * 0.6, v - r * 0.9, r * 0.55, r * 1.1);
  }
  c.fill();
}
// torn, jagged patches (harlequin)
function DA_torn(c, col, seed) {
  c.fillStyle = col; c.beginPath();
  for (var i = 0; i < 9; i++) {
    var u = -0.4 + DA_frac(i * 0.618 + DA_rnd(seed + i * 3) * 0.25) * 1.65, v = -1.0 + DA_rnd(seed * 2.1 + i * 1.7) * 1.5, r = 0.12 + 0.16 * DA_rnd(seed + i * 7.7);
    for (var j = 0; j < 9; j++) {
      var a = j / 9 * DA_TAU, rr = r * (0.55 + 0.75 * DA_rnd(seed * 3 + i * 11 + j * 1.3)), x = DA_tX(u + Math.cos(a) * rr, v + Math.sin(a) * rr * 2.1), y = DA_tY(u + Math.cos(a) * rr, v + Math.sin(a) * rr * 2.1);
      if (j === 0) c.moveTo(x, y); else c.lineTo(x, y);
    }
    c.closePath();
  }
  c.fill();
}
function DA_udot(c, u, v, r) { DA_dot(c, DA_tX(u, v), DA_tY(u, v), r); }
function DA_uell(c, u, v, ru, rv) {
  var x = DA_tX(u, v), y = DA_tY(u, v);
  c.moveTo(x + ru * DA_D, y); c.ellipse(x, y, ru * DA_D, rv * DA_cr, 0, 0, DA_TAU);
}

function DA_bodyMarks(c) {
  var Q = DA_Q, S = Q.S, G = DA_g, b = G.b, pat = Q.pat, seed = DA_seed, i, n;
  var co = G.breed.coats && (G.breed.coats[DA_coatI] || G.breed.coats[0]) || {};
  switch (pat) {
    case 'saddle-mask':
      c.fillStyle = Q.light; c.beginPath(); DA_upoly(c, DA_M_UNDER_LOW); DA_cpoly(c, DA_C_UNDER_LOW); c.fill();
      c.fillStyle = Q.mark; c.beginPath(); DA_upoly(c, DA_M_SADDLE); c.fill(); break;
    case 'husky-mask':
      c.fillStyle = Q.light; c.beginPath(); DA_upoly(c, DA_M_UNDER); DA_cpoly(c, DA_C_UNDER); DA_npoly(c, DA_N_THROAT); c.fill(); break;
    case 'collie-blaze':
      c.fillStyle = Q.light; c.beginPath(); DA_cpoly(c, DA_C_BIB_RIM); DA_npoly(c, DA_N_COLLAR); DA_upoly(c, DA_M_UNDER_LOW); DA_cpoly(c, DA_C_UNDER_LOW); c.fill(); break;
    case 'spots':
      c.fillStyle = Q.mark; c.beginPath();
      for (i = 0; i < 20; i++) {
        var ru = DA_rnd(seed * 3.1 + i * 7.7), rv = DA_rnd(seed * 1.7 + i * 3.3), rs = DA_rnd(seed + i * 11.1);
        DA_udot(c, -0.45 + ((i * 0.618 + ru * 0.35) % 1) * 2.0, -0.95 + ((i * 0.38 + rv * 0.4) % 1) * 1.9, DA_cr * (0.09 + rs * 0.12));
      }
      c.fill(); break;
    case 'bernese-tricolor':
      c.fillStyle = Q.mark; c.beginPath(); DA_cpoly(c, DA_C_BIB_RIM); c.fill();
      c.fillStyle = Q.light; c.beginPath(); DA_cpoly(c, DA_C_BIB); DA_npoly(c, DA_N_THROAT); c.fill(); break;
    case 'beagle-tricolor':
      c.fillStyle = Q.mark; c.beginPath(); DA_upoly(c, DA_M_SADDLE_BIG); c.fill();
      c.fillStyle = Q.light; c.beginPath(); DA_upoly(c, DA_M_UNDER); DA_cpoly(c, DA_C_UNDER); DA_npoly(c, DA_N_THROAT); c.fill(); break;
    case 'lemon-white':
      c.fillStyle = Q.base; c.beginPath(); DA_uell(c, 0.5 + DA_rnd(seed) * 0.15, -0.55, 0.34, 0.8); DA_uell(c, -0.3, -0.35, 0.3, 0.75); DA_uell(c, 1.1, -0.9, 0.2, 0.45); c.fill(); break;
    case 'corgi':
      if (co.mark) { c.fillStyle = Q.mark; c.beginPath(); DA_upoly(c, DA_M_SADDLE_SM); c.fill(); }
      c.fillStyle = Q.light; c.beginPath(); DA_upoly(c, DA_M_UNDER); DA_cpoly(c, DA_C_UNDER); DA_npoly(c, DA_N_THROAT); c.fill(); break;
    case 'urajiro':
      if (co.mark) { c.fillStyle = Q.mark; c.beginPath(); DA_cpoly(c, DA_C_BIB_RIM); DA_upoly(c, DA_M_UNDER_LOW); DA_cpoly(c, DA_C_UNDER_LOW); c.fill(); c.fillStyle = Q.light; c.beginPath(); DA_cpoly(c, DA_C_BIB); DA_npoly(c, DA_N_THROAT); c.fill(); }
      else { c.fillStyle = Q.light; c.beginPath(); DA_cpoly(c, DA_C_BIB_RIM); DA_upoly(c, DA_M_UNDER_LOW); DA_cpoly(c, DA_C_UNDER_LOW); DA_npoly(c, DA_N_THROAT); c.fill(); }
      break;
    case 'tan-points':
      c.fillStyle = Q.mark; c.beginPath(); DA_cpoly(c, DA_C_BIB); c.fill(); break;
    case 'brindle':
      c.strokeStyle = Q.mark; c.lineWidth = 0.03; c.beginPath();
      for (i = 0; i < 11; i++) {
        var uu = -0.45 + i * 0.19 + DA_rnd(seed + i) * 0.06, top = -1.1 + DA_rnd(seed * 2 + i) * 0.5, bot = 0.2 + DA_rnd(seed * 3 + i) * 0.7;
        c.moveTo(DA_tX(uu, top), DA_tY(uu, top)); c.quadraticCurveTo(DA_tX(uu - 0.1, (top + bot) / 2), DA_tY(uu - 0.1, (top + bot) / 2), DA_tX(uu - 0.04, bot), DA_tY(uu - 0.04, bot));
      }
      c.stroke(); break;
    case 'pied':
      c.fillStyle = Q.piedInv ? Q.base : Q.mark; c.beginPath(); DA_uell(c, 0.35 + DA_rnd(seed) * 0.3, -0.5 + DA_rnd(seed * 2) * 0.4, 0.3, 0.7); DA_uell(c, -0.35, -0.6, 0.22, 0.6); c.fill(); break;
    case 'schnauzer':
      c.fillStyle = Q.light; c.beginPath(); DA_cpoly(c, DA_C_BIB); DA_upoly(c, DA_M_UNDER_LOW); DA_cpoly(c, DA_C_UNDER_LOW); c.fill(); break;
    case 'yorkie':
      c.fillStyle = Q.base; c.beginPath(); DA_cpoly(c, DA_C_FRONT); DA_npoly(c, DA_N_ALL); c.fill();
      c.fillStyle = Q.light; c.beginPath(); DA_cpoly(c, DA_C_BIB); c.fill(); break;
    case 'blenheim':
      c.fillStyle = Q.mark; c.beginPath();
      DA_uell(c, 0.42 + DA_rnd(seed + 1) * 0.14, -0.62, 0.3, 0.62); DA_uell(c, -0.12, -0.55, 0.2, 0.5); DA_npoly(c, DA_N_TOP); c.fill(); break;
    case 'boxer':
      if (/brindle/i.test(co.name || '')) DA_stripes(c, Q.mark, seed);
      c.fillStyle = Q.light; c.beginPath(); DA_cpoly(c, DA_C_BIB); DA_npoly(c, DA_N_THROAT); c.fill(); break;
    case 'merle':
      DA_blobs(c, DA_mix(Q.base, Q.mark, 0.45), seed + 17, 6, 0.1, 0.17);
      DA_blobs(c, Q.mark, seed, 9, 0.08, 0.19);
      c.fillStyle = Q.light; c.beginPath(); DA_cpoly(c, DA_C_BIB); DA_npoly(c, DA_N_THROAT); c.fill();
      if (Q.tan) { c.fillStyle = Q.tan; c.beginPath(); DA_udot(c, 1.02, 0.62, DA_cr * 0.22); c.fill(); }
      break;
    case 'jrt':
      c.fillStyle = Q.mark; c.beginPath(); DA_uell(c, -0.16, -0.72, 0.22, 0.45); c.fill();
      c.fillStyle = DA_mix(Q.mark, Q.light, 0.2); c.beginPath(); DA_npoly(c, DA_N_TOP_SM); c.fill(); break;
    case 'harlequin':
      DA_torn(c, Q.mark, seed); break;
    case 'boston':
      c.fillStyle = Q.light; c.beginPath(); DA_cpoly(c, DA_C_BIB_RIM); DA_npoly(c, DA_N_COLLAR); c.fill(); break;
    case 'parti':
      c.fillStyle = co.mark ? Q.mark : Q.base; c.beginPath(); DA_uell(c, 0.45 + DA_rnd(seed) * 0.2, -0.6, 0.36, 0.95); DA_uell(c, -0.35, -0.3, 0.3, 0.9); DA_npoly(c, DA_N_TOP); c.fill(); break;
    case 'alfie':
      c.fillStyle = Q.mark; c.beginPath();
      DA_uell(c, 0.1, -0.52, 0.36, 0.72);
      DA_uell(c, -0.34, -0.46, 0.22, 0.54);
      c.fill(); break;
    case 'teddy':
      DA_blobs(c, 'rgba(95,100,108,0.22)', seed + 11, 7, 0.09, 0.15);
      c.fillStyle = Q.mark; c.beginPath();
      DA_uell(c, -0.06, -0.52, 0.34, 0.68);
      DA_uell(c, -0.35, -0.4, 0.24, 0.58);
      c.fill(); break;
  }
  // skirt strands for long silky coats
  if (b.skirt) {
    c.strokeStyle = Q.dark ? Q.lineIn : DA_mix(S.body, DA_OUT, 0.3); c.lineWidth = G.dl; c.beginPath();
    for (i = 0; i < 6; i++) { var us = -0.2 + i * 0.22; c.moveTo(DA_tX(us + 0.05, -0.2), DA_tY(us + 0.05, -0.2)); c.quadraticCurveTo(DA_tX(us - 0.02, 0.4), DA_tY(us - 0.02, 0.4), DA_tX(us - 0.04, 0.95), DA_tY(us - 0.04, 0.95)); }
    c.stroke();
  }
  // curl marks for woolly coats
  if (b.fur === 2) {
    c.strokeStyle = Q.dark ? Q.lineIn : DA_mix(S.body, Q.shade, 0.9); c.lineWidth = G.dl; c.beginPath();
    for (i = 0; i < 9; i++) {
      var cu = -0.25 + (i * 0.618 % 1) * 1.55, cv = -0.6 + (i * 0.38 % 1) * 1.1, cx = DA_tX(cu, cv), cy = DA_tY(cu, cv), r = 0.04;
      c.moveTo(cx + r, cy); c.arc(cx, cy, r, 0, 3.6);
    }
    c.stroke();
  }
  // one soft shade tone underneath, a small highlight along the back
  c.fillStyle = 'rgba(50,30,18,0.17)'; c.beginPath(); DA_upoly(c, DA_M_SHADE); c.fill();
  c.fillStyle = 'rgba(255,255,255,0.13)'; c.beginPath(); DA_upoly(c, DA_M_HI); c.fill();
}
// mud splotches on the body; level 1 = a bit grubby, 2 = filthy. Drawn inside a clip of the torso.
function DA_mud(c, level) {
  var seed = DA_seed, i, m = level >= 2 ? 0.875 : 0.325, n = 2 + Math.round(m * 7);
  c.fillStyle = '#7d5b3c'; c.beginPath();
  for (i = 0; i < n; i++) {
    var mu = -0.35 + DA_frac(i * 0.618 + seed * 0.37) * 1.75, mv = 0.85 - DA_rnd(seed * 2.9 + i * 5.1) * (0.5 + m * 1.1);
    DA_udot(c, mu, mv, DA_cr * (0.16 + 0.22 * m) * (0.6 + 0.6 * DA_rnd(i + seed)));
    DA_udot(c, mu + 0.09, mv + 0.15, DA_cr * (0.1 + 0.1 * m));
  }
  c.fill();
  c.fillStyle = '#5f4229'; c.beginPath();
  for (i = 0; i < n; i += 2) { var mu2 = -0.35 + DA_frac(i * 0.618 + seed * 0.37) * 1.75, mv2 = 0.85 - DA_rnd(seed * 2.9 + i * 5.1) * (0.5 + m * 1.1); DA_udot(c, mu2 + 0.03, mv2 + 0.05, DA_cr * 0.07); }
  c.fill();
}
// muddy paws (level 2)
function DA_pawMud(c) {
  var G = DA_g, L = DA_L, bn = G.b.bone, i;
  c.fillStyle = '#7d5b3c'; c.beginPath();
  for (i = 0; i < 4; i += 2) { var o2 = i * 12; DA_dot(c, L[o2 + 6] + bn * 0.3, L[o2 + 7] + G.pawH * 0.1, G.pawH * 0.95); DA_dot(c, L[o2 + 6] - bn * 0.1, L[o2 + 7] - bn * 0.9, bn * 0.7); }
  c.fill();
}
var DA_M_SHADE = [-1.2, 0.5, -0.3, 0.42, 0.4, 0.52, 1.0, 0.5, 1.5, 0.2, 2.2, 0.1, 2.2, 2.6, -1.2, 2.6];
var DA_M_HI = [-0.55, -1.5, -0.5, -0.8, 0.3, -0.78, 0.95, -0.82, 1.05, -1.5];

function DA_headMarks(c) {
  var Q = DA_Q, S = Q.S, G = DA_g, b = G.b, pat = Q.pat, sl = b.sl, sh = b.sh, xt = DA_xt, ex = b.ex, ey = b.ey, seed = DA_seed, i;
  var co = G.breed.coats && (G.breed.coats[DA_coatI] || G.breed.coats[0]) || {};
  function blaze(w) {   // light strip up the front of the face
    c.beginPath(); c.moveTo(xt + 0.5, -2); c.lineTo(0.18 - w, -2); c.quadraticCurveTo(0.5 - w, -sh * 0.8, sl * 0.66 - w * 0.6, -sh * 0.42); c.lineTo(sl * 0.8 - w * 0.3, b.mt + 0.12); c.lineTo(xt + 0.5, b.mt + 0.3); c.closePath(); c.fill();
  }
  switch (pat) {
    case 'saddle-mask':
      c.fillStyle = DA_mix(Q.base, Q.mark, 0.5); c.beginPath(); c.ellipse(-0.05, -sh * 1.0, 0.85, 0.42, 0, 0, DA_TAU); c.fill();
      c.fillStyle = Q.mark; c.beginPath(); c.ellipse(sl * 0.95, b.mt + 0.3, 0.34, 0.4, 0, 0, DA_TAU); c.fill(); break;
    case 'husky-mask':
      c.fillStyle = Q.light; c.beginPath();
      c.moveTo(-1.3, 0.62); c.quadraticCurveTo(-0.5, 0.3, 0.05, 0.02); c.quadraticCurveTo(0.3, -0.05, 0.5, ey + 0.02);
      c.quadraticCurveTo(0.72, ey - 0.3, 0.6, -sh * 0.78); c.lineTo(xt + 0.5, -1.2); c.lineTo(xt + 0.5, 2); c.lineTo(-1.3, 2); c.closePath(); c.fill();
      c.beginPath(); c.ellipse(ex - 0.06, ey - b.es - 0.2, 0.15, 0.1, -0.3, 0, DA_TAU); c.fill(); break;
    case 'collie-blaze': c.fillStyle = Q.light; blaze(0.1); break;
    case 'spots':
      c.fillStyle = Q.mark; c.beginPath();
      for (i = 0; i < 6; i++) { var sx = -0.8 + DA_rnd(seed * 2.3 + i * 5.1) * 2.6, sy = -0.8 + DA_rnd(seed * 4.1 + i * 2.9) * 1.3; if (sx > sl * 0.7 && sy < b.mt) sy = b.mt + 0.25; c.moveTo(sx + 0.1, sy); c.arc(sx, sy, 0.08 + DA_rnd(i + seed) * 0.07, 0, DA_TAU); }
      c.fill(); break;
    case 'bernese-tricolor':
      c.fillStyle = Q.mark; c.beginPath(); c.ellipse(sl * 0.62, b.lip * 0.7, 0.5, 0.4, -0.3, 0, DA_TAU);
      c.moveTo(ex + 0.2, ey - b.es - 0.2); c.ellipse(ex + 0.04, ey - b.es - 0.2, 0.15, 0.11, -0.2, 0, DA_TAU); c.fill();
      c.fillStyle = Q.light; blaze(-0.02); break;
    case 'beagle-tricolor': case 'lemon-white': case 'parti': c.fillStyle = Q.light; blaze(0); break;
    case 'corgi':
      c.fillStyle = Q.light; blaze(-0.04);
      c.beginPath(); c.ellipse(0.35, sh * 0.95, 0.75, 0.42, -0.15, 0, DA_TAU); c.fill(); break;
    case 'urajiro':
      if (co.mark) { c.fillStyle = Q.mark; c.beginPath(); c.ellipse(0.32, 0.5, 1.0, 0.62, -0.2, 0, DA_TAU); c.rect(sl * 0.6, b.mt + 0.22, xt, 2); c.fill(); }
      c.fillStyle = Q.light; c.beginPath(); c.ellipse(0.25, 0.66, 0.95, 0.52, -0.2, 0, DA_TAU); c.rect(sl * 0.7, b.mt + (co.mark ? 0.4 : 0.3), xt, 2); c.fill();
      c.fillStyle = co.mark ? Q.mark : Q.light; c.beginPath(); c.ellipse(ex + 0.02, ey - b.es - 0.2, 0.14, 0.1, -0.2, 0, DA_TAU); c.fill(); break;
    case 'tan-points':
      c.fillStyle = Q.mark; c.beginPath(); c.rect(sl * 0.62, b.mt + 0.3, xt, 2); c.ellipse(sl * 0.55, b.lip * 0.75, 0.42, 0.34, -0.2, 0, DA_TAU);
      c.moveTo(ex + 0.2, ey - b.es - 0.2); c.ellipse(ex + 0.04, ey - b.es - 0.2, 0.14, 0.1, -0.2, 0, DA_TAU); c.fill(); break;
    case 'pug-mask':
      if (b.ml > 0.8) {      // long-muzzled breed (Great Dane): black mask on the muzzle, darker round the eyes
        c.fillStyle = DA_mix(Q.base, Q.mark, 0.55); c.beginPath(); c.ellipse(ex + 0.02, ey + 0.02, b.es * 1.9, b.es * 1.6, 0, 0, DA_TAU); c.fill();
        break;
      }
      var k = b.wrinkle >= 1 && b.ml < 0.25 ? 1 : 0.7;
      c.fillStyle = DA_mix(Q.base, Q.mark, 0.45); c.beginPath(); c.ellipse(ex + 0.32, ey + 0.3, 0.62 * k, 0.7 * k, 0, 0, DA_TAU); c.fill();
      c.fillStyle = Q.mark; c.beginPath(); c.ellipse(ex + 0.42, ey + 0.38, 0.46 * k, 0.56 * k, 0, 0, DA_TAU); c.fill(); break;
    case 'brindle':
      c.strokeStyle = Q.mark; c.lineWidth = 0.09; c.beginPath();
      for (i = 0; i < 4; i++) { c.moveTo(-0.75 + i * 0.36, -sh * 0.95); c.quadraticCurveTo(-0.9 + i * 0.36, -0.3, -0.7 + i * 0.36, 0.25); }
      c.stroke(); break;
    case 'pied':
      c.fillStyle = Q.piedInv ? Q.base : Q.mark; c.beginPath();
      if (DA_rnd(seed * 1.9) > 0.4) c.ellipse(0.0, -0.4, 0.72, 0.75, 0, 0, DA_TAU); else c.ellipse(-0.6, -0.3, 0.6, 0.9, 0, 0, DA_TAU);
      c.fill(); break;
    case 'schnauzer':
      c.fillStyle = Q.light; c.beginPath(); c.ellipse(sl * 0.5, b.lip + 0.1, 0.45, 0.3, 0, 0, DA_TAU); c.fill(); break;
    case 'yorkie':
      c.fillStyle = Q.light; c.beginPath(); c.ellipse(-0.1, -sh * 0.85, 0.7, 0.4, 0, 0, DA_TAU); c.fill(); break;
    case 'blenheim':
      c.fillStyle = Q.mark; c.beginPath(); c.ellipse(-0.25, -0.12, 1.02, 1.08, 0, 0, DA_TAU); c.ellipse(ex, ey, b.es * 2.3, b.es * 2.1, 0, 0, DA_TAU); c.fill();
      c.fillStyle = Q.light; blaze(0.1); break;
    case 'boxer':
      c.fillStyle = Q.mark; c.beginPath(); c.ellipse(sl * 0.98, b.mt + 0.3, 0.3, 0.36, -0.3, 0, DA_TAU); c.fill();
      if (DA_rnd(seed * 0.37 + 2) > 0.45) { c.fillStyle = Q.light; blaze(-0.05); }
      break;
    case 'merle':
      c.fillStyle = Q.mark; c.beginPath(); c.ellipse(-0.3, -0.35, 0.75, 0.8, 0.3, 0, DA_TAU); c.ellipse(ex, ey, b.es * 2.2, b.es * 2.0, 0, 0, DA_TAU);
      c.moveTo(0.5, 0.45); c.ellipse(0.35, 0.45, 0.18, 0.14, 0, 0, DA_TAU); c.fill();
      c.fillStyle = Q.light; blaze(0.04);
      if (Q.tan) { c.fillStyle = Q.tan; c.beginPath(); c.ellipse(sl * 0.55, b.lip * 0.7, 0.34, 0.26, -0.2, 0, DA_TAU); c.moveTo(ex + 0.18, ey - b.es - 0.18); c.ellipse(ex + 0.04, ey - b.es - 0.18, 0.13, 0.09, -0.2, 0, DA_TAU); c.fill(); }
      break;
    case 'jrt':
      c.fillStyle = Q.light; blaze(0.02);
      if (Q.tan) { c.fillStyle = Q.tan; c.beginPath(); c.ellipse(sl * 0.5, b.lip * 0.65, 0.34, 0.28, -0.2, 0, DA_TAU); c.moveTo(ex + 0.18, ey - b.es - 0.2); c.ellipse(ex + 0.04, ey - b.es - 0.2, 0.13, 0.09, -0.2, 0, DA_TAU); c.fill(); }
      break;
    case 'harlequin':
      c.fillStyle = Q.mark; c.beginPath(); c.ellipse(-0.55, -0.35, 0.55, 0.7, 0.2, 0, DA_TAU);
      c.moveTo(0.35, -0.55); for (i = 0; i < 7; i++) { var ha = i / 7 * DA_TAU, hr2 = 0.22 * (0.6 + 0.7 * DA_rnd(seed + i)); c.lineTo(0.15 + Math.cos(ha) * hr2, 0.1 + Math.sin(ha) * hr2 * 1.3); } c.closePath();
      c.fill(); break;
    case 'boston':
      c.fillStyle = Q.light; blaze(0.06); break;
    case 'alfie':
      c.fillStyle = '#332016'; c.beginPath(); c.ellipse(ex + 0.02, ey + 0.02, b.es * 1.9, b.es * 1.65, -0.1, 0, DA_TAU); c.fill();
      c.fillStyle = Q.light; blaze(0.06);
      c.beginPath(); c.ellipse(0.28, sh * 0.88, 0.82, 0.42, -0.1, 0, DA_TAU); c.fill();
      break;
    case 'teddy':
      c.fillStyle = 'rgba(245,244,240,0.42)'; blaze(-0.04);
      c.fillStyle = Q.light; c.beginPath(); c.ellipse(sl * 0.55, b.lip + 0.08, 0.5, 0.34, 0, 0, DA_TAU); c.fill();
      break;
  }
}
// small extra marks on the near legs (spots, muddy paws)
function DA_legMarks(c) {
  var Q = DA_Q, G = DA_g, L = DA_L, bn = G.b.bone, i, seed = DA_seed;
  if (Q.pat === 'spots') {
    c.fillStyle = Q.mark; c.beginPath();
    for (i = 0; i < 2; i++) {
      var o = i * 24, f = 0.25 + DA_rnd(seed + i) * 0.4;
      DA_dot(c, L[o] + (L[o + 2] - L[o]) * f, L[o + 1] + (L[o + 3] - L[o + 1]) * f, bn * 0.5);
      DA_dot(c, L[o + 2] + (L[o + 6] - L[o + 2]) * 0.5, L[o + 3] + (L[o + 7] - L[o + 3]) * 0.5, bn * 0.4);
      if (i === 1) { DA_dot(c, L[o] - DA_rr * 0.3, L[o + 1] - DA_rr * 0.1, bn * 0.6); DA_dot(c, L[o] + DA_rr * 0.25, L[o + 1] + DA_rr * 0.35, bn * 0.5); }
    }
    c.fill();
  }
}

// ============================================================================================
// Poses. A pose is a flat bag of numbers (offsets from the breed's standing skeleton) so any two can be blended.
//  cdx/cdy/crot, rdx/rdy/rrot  chest / rump frame offset + pitch      arch  spine arch
//  neck (angle offset), neckS (stretch), head (absolute pitch, + = nose up), hk/hx/hy optional absolute head position
//  fNx/fNy foot N target (0 near front, 1 far front, 2 near hind, 3 far hind); fNp/fNq = 1 makes x / y relative to the
//  leg's pivot instead of the neutral ground spot; hm2/hm3 extra hock angle; f0r/f1r paw droop
//  tailA/tailW carriage offset, wag amplitude; tailO + tailOa/tailOc absolute override; DA_wph = wag phase
//  oy hop height, rot body pitch, sqx/sqy squash, flip belly-up
// Animation is quantised into a few frames per cycle (so sprites can be cached and shared): every pose function takes
// a frame index i and only uses whole-number harmonics of its cycle, so each cycle loops exactly.
// ============================================================================================
function DA_newPose() {
  return { cdx: 0, cdy: 0, crot: 0, rdx: 0, rdy: 0, rrot: 0, arch: 0, neck: 0, neckS: 1, head: 0, hk: 0, hx: 0, hy: 0,
    jaw: 0, tongue: 0, smile: 0, earB: 0, earF: 0, earUp: 0, eyeO: 1, eyeQ: 0, eyeW: 0, eyeD: 0, brow: 0,
    tailA: 0, tailW: 0, tailC: 1, tailO: 0, tailOa: 0, tailOc: 0, tailFront: 0,
    f0x: 0, f0y: 0, f0p: 0, f0q: 0, f0r: 0, f1x: 0, f1y: 0, f1p: 0, f1q: 0, f1r: 0,
    f2x: 0, f2y: 0, f2p: 0, f2q: 0, f3x: 0, f3y: 0, f3p: 0, f3q: 0, hm2: 0, hm3: 0, f0a: 0, f1a: 0, ga: 0,
    hindFront: 0, legSep: 0, oy: 0, rot: 0, sqx: 1, sqy: 1, flip: 0, breath: 0, headFlip: 0, sep: 0, fx: 0, fxT: 0, wph: 0 };
}
var DA_P0 = DA_newPose(), DA_PA = DA_newPose(), DA_PB = DA_newPose(), DA_KEYS = Object.keys(DA_P0);
function DA_reset(P) { for (var i = 0; i < DA_KEYS.length; i++) P[DA_KEYS[i]] = DA_P0[DA_KEYS[i]]; }
function DA_blend(A, B, w) {
  var i, k;
  if (w >= 0.999) { for (i = 0; i < DA_KEYS.length; i++) A[DA_KEYS[i]] = B[DA_KEYS[i]]; return; }
  if (w <= 0.001) return;
  var fx = w > 0.5 ? B.fx : A.fx, wph = w > 0.5 ? B.wph : A.wph;
  for (i = 0; i < DA_KEYS.length; i++) { k = DA_KEYS[i]; A[k] += (B[k] - A[k]) * w; }
  A.fx = fx; A.fxT = B.fxT; A.wph = wph;
}
var DA_seed = 0, DA_clean = 100, DA_coatI = 0, DA_napCurl = false;
var DA_HAPPY = [8, 22, 55, 90];          // representative happiness of the four mood buckets

// point the neck so the centre of the skull sits at height hy (negative = above ground)
function DA_aimHead(P, G, hy, maxS) {
  var cs = Math.cos(P.crot), sn = Math.sin(P.crot);
  var nby = G.yc + P.cdy + G.nbx * sn + G.nby * cs, need = nby - hy, nl = G.b.neckL * P.neckS, r = need / nl;
  if (r < -0.96 && maxS > 1) { P.neckS = Math.min(maxS, -need / 0.96 / G.b.neckL); r = need / (G.b.neckL * P.neckS); }
  r = r < -0.97 ? -0.97 : r > 0.97 ? 0.97 : r;
  P.neck = Math.asin(r) - G.neckA;
}
// mood (bucket hb 0..3): tail, ears, eyes, head carriage. Static - no animation in here.
function DA_mood(P, hb) {
  var sd = hb === 0 ? 1 : hb === 1 ? 0.65 : 0, joy = hb === 3 ? 0.85 : hb === 2 ? 0.15 : 0;
  P.tailW = hb >= 2 ? 0.12 + 0.5 * joy : 0;
  P.tailA = 0.28 * joy;
  P.tailO = sd > 0 ? 1 : 0; P.tailOa = -1.75 - 0.2 * sd; P.tailOc = -0.9;
  P.neck = -0.55 * sd + 0.05 * joy; P.head = -0.36 * sd;
  P.smile = 0.3 + joy;
  P.earB = 0.9 * sd - 0.12 * joy;
  P.eyeD = sd; P.brow = -sd;
  return joy;
}
function DA_pant(P, i, k) {
  var s = (i & 1) ? 1 : -1;
  P.jaw = 0.5 + 0.07 * s; P.tongue = (0.82 - 0.14 * s) * (k || 1);
}
// standing idle: 6 frames (8 fps). flags: 1 blink, 2 ear twitch
function DA_poseIdle(P, G, hb, i, flags) {
  var a = DA_TAU * i / 6, pant = hb === 3;
  DA_mood(P, hb);
  P.breath = pant ? ((i & 1) ? 0.7 : -0.7) : Math.sin(a);
  P.neck += 0.03 * Math.sin(a); P.head += 0.04 * Math.sin(a + 1);
  if (pant) DA_pant(P, i, 1);
  P.cdx = 0.01 * Math.sin(a); P.rdx = 0.007 * Math.sin(a + 1);
  P.wph = DA_TAU * i / (pant ? 3 : 6);
  if (flags & 1) P.eyeO = 0;
  if (flags & 2) P.earF = 0.24;
}
// excited standing (state 'play' while not moving): 4 frames of little front-paw bounces
function DA_poseExcite(P, G, hb, i) {
  var bb = Math.abs(Math.sin(Math.PI * i / 4));
  DA_mood(P, 3);
  P.oy = 0.05 * bb; P.f0y = 0.06 * bb; P.f1y = 0.045 * bb; P.crot = -0.07 * bb; P.tailW = 0.7; P.tailA = 0.3; P.wph = DA_TAU * i / 4;
  P.breath = Math.sin(DA_TAU * i / 4); DA_pant(P, i, 1); P.eyeW = 0.3; P.earB = -0.3; P.earF = 0.1 * Math.sin(DA_TAU * i / 4);
}
// ---------- gaits ----------
// Each foot cycles: stance (on the ground, sweeping back at exactly the body's ground speed, so it stays planted)
// then swing (lifted and carried forward). Front feet: the pastern folds back while lifted (the wrist flexes),
// hind feet: the hock flexes and the paw droops. x / y are relative to the foot's neutral ground spot.
function DA_setFoot(P, k, x, y, a) {
  if (k === 0) { P.f0x = x; P.f0y = y; P.f0a = a; } else if (k === 1) { P.f1x = x; P.f1y = y; P.f1a = a; }
  else if (k === 2) { P.f2x = x; P.f2y = y; P.hm2 = a; } else { P.f3x = x; P.f3y = y; P.hm3 = a; }
}
function DA_bump(u) { return u <= 0 || u >= 1 ? 0 : Math.sin(Math.PI * u); }
// one foot of the walk. f = this foot's phase (0 = touchdown), A = half the sweep, lift = swing height
function DA_walkFoot(P, G, k, f, A, lift) {
  var beta = G.wBeta, x, y = 0, a, s, u, km = 0.6 / G.hh;
  f -= Math.floor(f);
  if (f < beta) {
    s = f / beta; x = A * (1 - 2 * s);
    a = k < 2 ? (s > 0.55 ? 0.45 * (s - 0.55) / 0.45 : 0) : km * x;          // heel lifts late in the stance / hock angle follows the foot
  } else {
    u = (f - beta) / (1 - beta);
    x = -A + 2 * A * DA_ss(u);
    y = lift * Math.pow(DA_bump(Math.pow(u, 0.8)), 0.9);
    if (k < 2) a = 0.45 * (1 - u) + 1.75 * Math.pow(DA_bump(u / 0.8), 0.75) - 0.2 * DA_bump((u - 0.8) / 0.2);
    else a = km * (-A + 2 * A * DA_ss(u)) + 0.85 * DA_bump(u);
  }
  if (k >= 2) x += A * 0.25;                                                     // hind feet work a little further forward
  DA_setFoot(P, k, x, y, a);
}
// 4-beat walk (lateral sequence: near hind, near front, far hind, far front)
function DA_poseWalk(P, G, hb, i, n) {
  var LL = G.LL, A = G.walkA, ph = i / n, lf = 0.05 + 0.22 * LL, lh = 0.04 + 0.16 * LL, w2 = ph * 2 * DA_TAU;
  DA_mood(P, hb); P.ga = 1;
  DA_walkFoot(P, G, 2, ph, A, lh); DA_walkFoot(P, G, 0, ph - 0.25, A, lf);
  DA_walkFoot(P, G, 3, ph - 0.5, A, lh); DA_walkFoot(P, G, 1, ph - 0.75, A, lf);
  // the withers dip as each front foot takes the weight, the croup as each hind one does; a little roll of the shoulders / hips
  var kb = 0.01 + 0.02 * LL;
  P.cdy = kb * Math.cos(w2 - DA_TAU * 0.5 - 0.9); P.rdy = kb * Math.cos(w2 - 0.9);
  P.cdx = 0.012 * Math.sin(w2 - 1.6); P.rdx = 0.01 * Math.sin(w2 + 0.2);
  P.crot = (P.cdy - P.rdy) / G.D * 0.6; P.rrot = P.crot;
  P.neck += 0.05 * Math.cos(w2 - DA_TAU * 0.5 - 0.5); P.head += 0.035 * Math.cos(w2 - 0.2);
  P.earF += 0.1 * Math.sin(w2 + 2.2);
  P.tailA += 0.06 * Math.sin(w2 * 0.5);
  P.breath = Math.sin(w2 * 0.5);
  P.wph = DA_TAU * ph * 2;
}
// one foot of the gallop. td = touchdown phase, beta = stance fraction, ex = sweep, c = centre of the sweep
function DA_runFoot(P, G, k, f, td, beta, ex, c, lift) {
  var x, y = 0, a, s, u, km = 0.55 / G.hh;
  f -= td; f -= Math.floor(f);
  if (f < beta) {
    s = f / beta; x = c + ex * (0.5 - s);
    a = k < 2 ? (s > 0.45 ? 0.8 * (s - 0.45) / 0.55 : -0.1 * DA_bump(s / 0.45)) : km * (x - c) - 0.25 * s * s;
  } else {
    u = (f - beta) / (1 - beta);
    x = c - ex * 0.5 + ex * DA_ss(u);
    if (k < 2) {
      x += ex * 0.22 * DA_bump((u - 0.45) / 0.55);                              // front paws reach out before landing
      y = lift * Math.pow(DA_bump(Math.pow(u, 0.75)), 0.8);
      a = 0.8 * (1 - u) + 2.0 * Math.pow(DA_bump(u / 0.72), 0.7) - 0.3 * DA_bump((u - 0.72) / 0.28);
    } else {
      x -= ex * 0.12 * DA_bump(u / 0.4);                                        // hind paws flick back before swinging through
      y = lift * Math.pow(DA_bump(Math.pow(u, 0.9)), 0.9);
      a = km * (-ex * 0.5 + ex * DA_ss(u)) - 0.25 * (1 - u) + 1.05 * DA_bump(u);
    }
  }
  DA_setFoot(P, k, x, y, a);
}
// rotary gallop: hind pair lands, pushes the body forward-up (extended), front pair lands, then a gathered suspension
function DA_poseRun(P, G, hb, i, n) {
  var LL = G.LL, T = G.b.tail, ph = i / n, sU = G.rStride, bh = 0.3, bf = 0.26, k = 0.55 + LL;
  DA_mood(P, 3); P.ga = 1;
  var lh = 0.08 + 0.3 * LL, lf = 0.1 + 0.36 * LL;
  DA_runFoot(P, G, 2, ph, 0.0, bh, sU * bh, 0.06, lh); DA_runFoot(P, G, 3, ph, 0.08, bh, sU * bh, 0.06, lh);
  DA_runFoot(P, G, 1, ph, 0.38, bf, sU * bf, 0.08, lf); DA_runFoot(P, G, 0, ph, 0.46, bf, sU * bf, 0.08, lf);
  var flex = Math.cos(DA_TAU * (ph - 0.86)), susp = Math.max(0, Math.cos(DA_TAU * (ph - 0.9)));
  P.rdx = 0.075 * flex * G.D; P.cdx = -0.035 * flex * G.D;
  P.arch = 0.055 * Math.max(0, flex) - 0.02 * Math.max(0, -flex);
  P.cdy = k * (0.05 * Math.cos(DA_TAU * (ph - 0.56)) - 0.035 * susp * susp);
  P.rdy = k * (0.045 * Math.cos(DA_TAU * (ph - 0.14)) - 0.035 * susp * susp);
  P.crot = Math.atan2(P.cdy - P.rdy, G.D) * 0.8; P.rrot = P.crot * 1.2 - 0.1 * flex;
  P.neck = -0.32 + 0.09 * Math.cos(DA_TAU * (ph - 0.1)); P.neckS = 1.08; P.head = 0.12 + 0.06 * Math.cos(DA_TAU * (ph - 0.3));
  P.earB = 0.75; P.earF = 0.16 * Math.sin(DA_TAU * 2 * ph + 1);
  var over = (T.a + (T.curl || 0)) > 180;
  P.tailO = over ? 0 : 0.7; P.tailOa = 0.35 + 0.15 * flex; P.tailOc = 0.25; P.tailA = over ? -0.2 : 0; P.tailW = 0.12; P.wph = DA_TAU * ph;
  P.jaw = 0.5 + 0.1 * Math.sin(DA_TAU * 2 * ph); P.tongue = 0.9 + 0.1 * Math.sin(DA_TAU * 2 * ph + 1);
  P.eyeD = 0; P.brow = 0; P.eyeW = 0.25;
  P.breath = Math.sin(DA_TAU * 2 * ph);
}
// stride lengths in world px per cycle at s = 1 (for tests / callers that want to sync something to the feet)
function DA_walkStride(G) { return G.wStride * G.H; }
function DA_runStride(G) { return G.rStride * G.H; }
// rump on the ground, front legs straight. upr 0 = normal sit, 1 = sitting pretty (beg)
function DA_applySit(P, G, upr) {
  var rr = G.rr, T = G.b.tail, yrs = -rr * 0.86, ycs = G.yc + 0.03, Dp = G.D * 0.95;
  var th = Math.asin(Math.min(0.9, Math.max(0.1, (yrs - ycs) / Dp)));
  var xr = G.xc - Dp * Math.cos(th) - 0.02;
  P.rdx = xr - G.xr; P.rdy = yrs - G.yr; P.rrot = -th;
  P.cdx = 0; P.cdy = 0.03; P.crot = -th * 0.6;
  if (upr > 0) {
    var th2 = th + ((G.D > 0.85 ? 0.8 : 1.22) - th) * upr;
    P.rdx -= 0.1 * upr * G.D; xr = G.xr + P.rdx;
    P.cdx = xr + Dp * Math.cos(th2) - G.xc; P.cdy = yrs - Dp * Math.sin(th2) - G.yc; P.crot = -th2 * 0.85; P.rrot = -th - (th2 - th) * 0.5;
    P.f0p = P.f0q = P.f1p = P.f1q = upr;
    P.f0x = G.Lf * 0.42; P.f0y = -G.Lf * 0.5; P.f1x = G.Lf * 0.42; P.f1y = -G.Lf * 0.42; P.f0r = 0.9 * upr; P.f1r = 0.9 * upr;
  }
  P.f2p = 1; P.f3p = 1; P.f2x = G.hh * 0.56; P.f3x = G.hh * 0.5; P.hm2 = 1.25; P.hm3 = 1.25; P.hindFront = 1;
  if (T.a < 45 && T.a + (T.curl || 0) <= 180) { P.tailO = 1; P.tailOa = 0.05; P.tailOc = 0.2; }
}
// lying on the belly; sploot = hind legs straight out behind
function DA_applyLie(P, G, sploot) {
  var cr = G.cr, rr = G.rr;
  P.cdy = -cr * 0.98 - G.yc; P.rdy = -rr * 0.92 - G.yr; P.rdx = 0.03; P.crot = 0.03;
  P.f0p = 1; P.f1p = 1; P.f0x = G.Lf * 0.9 + 0.08; P.f1x = G.Lf * 0.9 + 0.02; P.f0r = -0.1; P.f1r = -0.1;
  P.f2p = 1; P.f3p = 1;
  if (sploot) { P.f2x = -G.hh * 0.95; P.f3x = -G.hh * 0.8; P.hm2 = -1.2; P.hm3 = -1.2; P.rdy += rr * 0.06; }
  else { P.f2x = G.hh * 0.5; P.f3x = G.hh * 0.5; P.hm2 = 1.3; P.hm3 = 1.3; }
  if (G.b.tail.a + (G.b.tail.curl || 0) <= 180) { P.tailO = 1; P.tailOa = 0.0; P.tailOc = 0.25; }
  P.tailW = 0;
}
// asleep: slow breathing (in, rest, out). style by breed (+ per-dog variant): sphinx, sploot or curled up
function DA_poseNap(P, G, hb, i) {
  var b = G.b, style = b.nap;
  if (style === 'sphinx' && DA_napCurl) style = 'curl';
  P.breath = 1.6 * Math.sin(DA_TAU * i / 4);
  P.eyeO = 0; P.earB = 0.35; P.smile = 0.4;
  if (style === 'curl') {
    DA_applyLie(P, G, 0);
    P.rdx = G.D * 0.16; P.arch = 0.07; P.crot = 0.2; P.rrot = -0.16;
    P.f0x = G.Lf * 0.45; P.f1x = G.Lf * 0.55;
    P.hk = 1; P.hx = G.xr + P.rdx + G.D * 0.42; P.hy = -b.hr * (b.lip + b.jd + 0.1) - 0.02 + 0.004 * P.breath; P.headFlip = 1; P.head = -0.12; P.sep = 1;
    P.tailO = 1; P.tailOa = -1.75; P.tailOc = -1.5; P.tailFront = 1;
  } else {
    DA_applyLie(P, G, style === 'sploot' ? 1 : 0);
    P.head = -0.08; P.neckS = 1.1;
    DA_aimHead(P, G, -b.hr * (b.lip + b.jd + 0.12) - G.pawH * 1.4 + 0.004 * P.breath, 1.5);
  }
}
// head down in the bowl, chewing: 4 frames
function DA_poseEat(P, G, hb, i) {
  var b = G.b, ch = Math.sin(DA_TAU * i / 4), ha = -0.85;
  P.cdy = 0.14 * G.Lf; P.crot = 0.15; P.f0x = 0.04; P.f1x = 0.06;
  P.head = ha + 0.07 * ch; P.neckS = 1.15;
  DA_aimHead(P, G, -0.1 - Math.sin(-ha) * (b.sl * 0.8 + b.ml) * b.hr * 0.9 - b.hr * 0.2 + 0.012 * ch, 1.45);
  P.jaw = ch > 0 ? ch * 0.5 : 0; P.eyeQ = 0.35; P.earB = 0.2; P.earF = 0.06 * ch;
  P.tailW = 0.3; P.tailA = 0.1; P.breath = ch; P.wph = DA_TAU * i / 4;
}

// ---------- emotes (d.anim). Each is a short loop of n frames at 8 fps, plus a few shared ease-in / ease-out frames ----------
var DA_FPS = 8;
//              [loop frames, intro frames]
var DA_EMO = { sit: [6, 2], beg: [4, 2], sad: [4, 2], bark: [5, 0], jump: [6, 0], shake: [3, 1], wiggle: [4, 1], scratch: [3, 2],
  sniff: [6, 2], howl: [4, 2], playbow: [4, 2], dig: [4, 2], roll: [4, 3], poop: [16, 2, 1], drink: [9, 2], pounce: [6, 1, 1], wrestle: [10, 2] };   // [.., 1] = a sequence: eases out of its last frame
// i = frame of the loop, n = frames in the loop, fl = 0..1 "how far in" (only used by the roll-over)
function DA_poseAnim(P, G, hb, name, i, n, fl) {
  var b = G.b, LL = G.LL, a = DA_TAU * i / n, u = (i + 0.5) / n, alt = (i & 1) ? 1 : -1, e, w, s;
  switch (name) {
    case 'sit':
      DA_mood(P, hb); DA_applySit(P, G, 0);
      P.breath = hb === 3 ? 0.7 * alt : Math.sin(a); P.head += 0.04 * Math.sin(a + 1); P.wph = DA_TAU * i / (hb === 3 ? 3 : 6);
      if (hb === 3) DA_pant(P, i, 1);
      break;
    case 'beg':
      DA_applySit(P, G, 1);
      P.head = 0.22 + 0.04 * Math.sin(a); P.neck = 0.12; P.eyeW = 1; P.brow = -0.6; P.smile = 0.8; P.earB = -0.3;
      P.f0y += 0.035 * Math.sin(a); P.f1y += 0.035 * Math.sin(a + 1.6);
      P.tailW = 0.5; P.wph = a; P.breath = Math.sin(a);
      P.cdx += 0.012 * Math.sin(a);
      break;
    case 'sad':
      w = Math.sin(a);
      P.cdy = 0.05; P.rdy = 0.07; P.arch = 0.03; P.rdx = 0.03;
      P.neck = -0.62 + 0.02 * w; P.head = 0.22 + 0.05 * w; P.eyeW = 0.75; P.brow = -1; P.earB = 1; P.jaw = w > 0.6 ? 0.12 : 0;
      P.tailO = 1; P.tailOa = -1.9; P.tailOc = -0.9; P.breath = w;
      break;
    case 'bark':
      e = u < 0.22 ? -0.45 * Math.sin(Math.PI * u / 0.22) : Math.sin(Math.PI * Math.pow(DA_clamp((u - 0.22) / 0.6, 0, 1), 0.6));
      s = e > 0 ? e : 0;
      DA_mood(P, 2);
      P.cdy = -0.04 * e; P.cdx = 0.05 * e; P.crot = -0.1 * s; P.rdy = 0.02 * s;
      P.neck = 0.3 * e; P.head = 0.5 * e; P.neckS = 1 + 0.08 * s;
      P.jaw = s * 1.0; P.earB = 0.5 * s; P.earF = -0.25 * Math.sin(u * 9) * s; P.eyeW = 0.4 * s; P.brow = 0.7 * s;
      P.f0y = 0.08 * s * (0.4 + LL); P.f1y = 0.06 * s * (0.4 + LL);
      P.tailO = 0.6; P.tailOa = 1.0; P.tailOc = 0.3; P.tailW = 0.15; P.wph = i * 2.1;
      P.fx = s > 0.45 ? 1 : 0; P.fxT = u;
      break;
    case 'howl':
      DA_applySit(P, G, 0);
      w = Math.sin(a);
      P.head = 1.12 + 0.05 * w; P.neck = 0.36 + 0.03 * w; P.neckS = 1.08; P.jaw = 0.34 + 0.04 * alt; P.eyeO = 0; P.earB = 0.7; P.breath = w;
      P.fx = 4; P.fxT = i / n;
      break;
    case 'shake':
      e = 1; w = a;
      P.cdx = 0.06 * e * Math.sin(w); P.rdx = -0.06 * e * Math.sin(w - 1.3); P.crot = 0.09 * e * Math.sin(w + 0.5); P.rrot = 0.09 * e * Math.sin(w - 0.8);
      P.arch = 0.03 * e * Math.sin(w + 2);
      P.head = 0.42 * e * Math.sin(w + 0.9) - 0.12 * e; P.neck = -0.15 * e; P.earF = 0.9 * e * Math.sin(w + 1.7); P.eyeO = 0; P.eyeQ = 1; P.smile = 1;
      P.tailW = 1.0 * e; P.wph = w + 1; P.sqx = 1 + 0.05 * e * Math.sin(2 * w); P.sqy = 1 - 0.03 * e * Math.sin(2 * w); P.cdy = 0.04 * e; P.rdy = 0.04 * e;
      P.f0x = 0.03 * e; P.f1x = 0.04 * e; P.f2x = -0.03 * e; P.f3x = -0.04 * e;
      P.fx = 2; P.fxT = i / n;
      break;
    case 'wiggle':
      w = a;
      P.rdx = 0.075 * Math.sin(w); P.rrot = 0.15 * Math.sin(w); P.crot = -0.06 * Math.sin(w); P.cdx = -0.03 * Math.sin(w); P.rdy = 0.02 + 0.02 * Math.cos(2 * w);
      P.oy = 0.025 * (1 - Math.cos(2 * w));
      P.f0y = Math.max(0, Math.sin(w)) * 0.07 * (0.5 + LL); P.f1y = Math.max(0, -Math.sin(w)) * 0.07 * (0.5 + LL);
      P.f2x = 0.03 * Math.sin(w); P.f3x = -0.03 * Math.sin(w);
      P.neck = 0.12; P.head = 0.2 + 0.06 * Math.sin(w + 1); P.eyeQ = 1; P.earB = 0.3; P.earF = 0.15 * Math.sin(w + 1);
      P.tailW = 1.0; P.wph = DA_TAU * i / 2 + 0.8; P.tailA = 0.3; DA_pant(P, i, 1); P.jaw = 0.6; P.breath = Math.sin(w);
      break;
    case 'scratch':
      DA_applySit(P, G, 0);
      w = a;
      P.crot -= 0.1; P.cdy += 0.05;
      // the near hind paw comes up to the cheek; the head leans down and back to meet it
      var hipx = G.xr + P.rdx + G.phx, hipy = G.yr + P.rdy + G.phy, reach = (G.thigh + G.shank) * 0.9 + G.meta * 0.8;
      var tx = hipx + reach * 0.64, ty = hipy - reach * 0.77;
      var hx0 = G.xc + P.cdx + G.nbx + Math.cos(G.neckA) * b.neckL, hy0 = G.yc + P.cdy + G.nby - Math.sin(G.neckA) * b.neckL;
      var hx1 = tx + b.hr * 0.75, hy1 = ty - b.hr * 0.35, hd = Math.sqrt((hx1 - hx0) * (hx1 - hx0) + (hy1 - hy0) * (hy1 - hy0)) || 1e-6, hmax = b.neckL * 1.0 + 0.1;
      if (hd > hmax) { hx1 = hx0 + (hx1 - hx0) * hmax / hd; hy1 = hy0 + (hy1 - hy0) * hmax / hd; }
      P.hk = 1; P.hx = hx1; P.hy = hy1; P.head = -0.42 + 0.05 * Math.sin(w);
      tx = hx1 - b.hr * 0.75; ty = hy1 + b.hr * 0.35;
      P.f2p = 1; P.f2q = 1; P.f2x = (tx - hipx) + 0.03 * Math.sin(w); P.f2y = -(ty - hipy) - 0.06 * Math.cos(w); P.hm2 = 2.7; P.legSep = 1;
      P.eyeQ = 1; P.smile = 1; P.earB = 0.5; P.earF = 0.15 * Math.sin(w); P.tailW = 0.1;
      break;
    case 'sniff':
      w = a;
      P.cdy = 0.1 * G.Lf; P.crot = 0.12; P.cdx = 0.03 * Math.sin(w);
      P.head = -0.75 + 0.05 * alt; P.neckS = 1.2;
      DA_aimHead(P, G, -0.06 - Math.sin(0.75) * (b.sl * 0.8 + b.ml) * b.hr * 0.9 - b.hr * 0.25 + 0.01 * alt, 1.5);
      P.neck += 0.06 * Math.sin(w);
      P.earB = -0.2; P.earF = 0.05 * alt; P.tailO = 0.6; P.tailOa = 0.25; P.tailOc = 0.2; P.tailW = 0.2; P.wph = a;
      P.f0x = 0.03 * Math.sin(w); P.f1x = 0.04 * Math.sin(w + 1);
      break;
    case 'playbow':
      w = a;
      P.cdy = G.Lf * 0.66; P.crot = 0.34; P.cdx = 0.05; P.rdy = -0.02; P.rrot = 0.16; P.rdx = 0.035 * Math.sin(w);
      P.f0x = G.Lf * 0.5; P.f1x = G.Lf * 0.42; P.f0r = -0.15; P.f1r = -0.15;
      P.neck = 0.1; P.head = 0.3 + 0.06 * Math.sin(w + 1); P.eyeW = 0.5; P.earB = -0.3; P.earF = 0.1 * Math.sin(w);
      P.tailO = 0.8; P.tailOa = 1.35; P.tailOc = 0.5; P.tailW = 0.9; P.wph = DA_TAU * i / 2 + 0.8; DA_pant(P, i, 1); P.jaw = 0.65;
      break;
    case 'dig':
      w = a;
      P.cdy = 0.22 * G.Lf; P.crot = 0.2; P.rdy = -0.01; P.cdx = 0.015 * Math.sin(w);
      P.f0x = 0.1 + 0.11 * Math.sin(w); P.f0y = Math.max(0, Math.cos(w)) * 0.13 * (0.5 + LL); P.f1x = 0.1 - 0.11 * Math.sin(w); P.f1y = Math.max(0, -Math.cos(w)) * 0.13 * (0.5 + LL);
      P.head = -0.9; P.neckS = 1.1; DA_aimHead(P, G, -0.28 - Math.sin(0.9) * (b.sl * 0.8 + b.ml) * b.hr * 0.6, 1.3);
      P.earF = 0.12 * Math.sin(w); P.tailO = 0.7; P.tailOa = 1.1; P.tailOc = 0.3; P.tailW = 0.5; P.wph = a;
      P.fx = 3; P.fxT = i / n;
      break;
    case 'jump':
      var hj = 0.3 + 0.35 * LL;
      DA_mood(P, 3);
      if (u < 0.22) { e = Math.sin(Math.PI * u / 0.22 * 0.5); P.sqy = 1 - 0.14 * e; P.sqx = 1 + 0.08 * e; P.tailA = -0.2 * e; }
      else if (u < 0.78) {
        s = (u - 0.22) / 0.56; e = Math.sin(Math.PI * s);
        P.oy = hj * e; P.sqy = 1 + 0.07 * (1 - s) * (1 - s); P.rot = -0.22 * Math.cos(Math.PI * s);
        P.f0x = 0.1; P.f0y = 0.12 * e * (0.5 + LL); P.f1x = 0.12; P.f1y = 0.1 * e * (0.5 + LL); P.f2x = -0.1 * e; P.f3x = -0.12 * e; P.f2y = 0.05 * e; P.f3y = 0.04 * e;
        P.earB = -0.4 + 1.1 * s; P.earF = -0.3 * e;
      } else { e = Math.sin(Math.PI * (u - 0.78) / 0.22); P.sqy = 1 - 0.12 * e; P.sqx = 1 + 0.07 * e; }
      P.eyeQ = 1; P.jaw = 0.6; P.tongue = 0.7; P.tailW = 0.6; P.wph = a * 2; P.tailA += 0.3; P.head = 0.15;
      break;
    case 'roll':
      w = a;
      P.flip = fl;
      P.cdy = 0.02 * fl; P.rot = 0.07 * Math.sin(w) * fl; P.cdx = 0.03 * Math.sin(w) * fl; P.rdx = -0.03 * Math.sin(w) * fl;
      P.f0p = P.f0q = P.f1p = P.f1q = P.f2p = P.f2q = P.f3p = P.f3q = fl;
      P.f0x = (0.12 + 0.06 * Math.sin(w)) * fl; P.f0y = -G.Lf * 0.52 * fl; P.f1x = (0.1 - 0.06 * Math.sin(w)) * fl; P.f1y = -G.Lf * 0.45 * fl; P.f0r = 0.8 * fl; P.f1r = 0.8 * fl;
      P.f2x = (0.14 + 0.05 * Math.sin(w + 1)) * fl; P.f2y = -G.hh * 0.5 * fl; P.f3x = (0.1 - 0.05 * Math.sin(w + 1)) * fl; P.f3y = -G.hh * 0.45 * fl; P.hm2 = 0.5 * fl; P.hm3 = 0.5 * fl;
      if (fl > 0.5) { P.head = 0.1 + 0.08 * Math.sin(w); DA_aimHead(P, G, -1 + b.hr * (b.sh + 0.1), 1.2); P.eyeQ = 1; P.jaw = 0.6; P.tongue = 1; P.earUp = 1; }
      P.tailW = 0.35 * fl; P.wph = a; P.tailO = fl; P.tailOa = -0.12; P.tailOc = -0.35;
      break;
    case 'poop':
      // 0-3 sniff about and shuffle, 4-12 squat and strain (the game drops the poop behind the dog at ~1.9 s = frame 13),
      // 13-14 relief and a kick-back of the hind feet
      if (i < 4) {
        w = DA_TAU * i / 4;
        P.cdy = 0.08 * G.Lf; P.crot = 0.1; P.cdx = 0.03 * Math.sin(w); P.rdx = -0.015 * Math.sin(w);
        P.head = -0.7 + 0.06 * alt; P.neckS = 1.15;
        DA_aimHead(P, G, -0.07 - Math.sin(0.7) * (b.sl * 0.8 + b.ml) * b.hr * 0.9 - b.hr * 0.25, 1.5);
        P.neck += 0.05 * Math.sin(w);
        P.earB = -0.15; P.earF = 0.05 * alt; P.tailO = 0.7; P.tailOa = 0.5; P.tailOc = 0.25; P.tailW = 0.25; P.wph = w;
        if (i === 1) { P.f2y = 0.05 * (0.5 + LL); P.f2x = 0.04; P.hm2 = 0.5; }             // shuffling steps
        else if (i === 2) { P.f0y = 0.06 * (0.5 + LL); P.f0x = -0.03; P.f0a = 0.9; }
        else if (i === 3) { P.f3y = 0.05 * (0.5 + LL); P.f3x = 0.04; P.hm3 = 0.5; }
        if (i >= 2) {                                                                       // glances back over the shoulder (turning round)
          P.hk = 1; P.headFlip = 1; P.hx = G.xc + G.nbx - b.neckL * 0.55; P.hy = G.yc + G.nby - b.neckL * 0.95 - b.hr * 0.1; P.head = -0.15 + 0.05 * alt; P.neckS = 1; P.earB = 0.1; P.cdy = 0.02 * G.Lf; P.crot = 0.02;
        }
      } else if (i < 13) {
        s = DA_ss((i - 3) / 2);                                 // 4 = half-way down, 5.. = full squat
        e = (i - 5) / 7; e = e < 0 ? 0 : e;                    // strain builds
        P.rdy = s * G.hh * 0.42; P.rdx = s * G.D * 0.09; P.rrot = -0.3 * s;
        P.cdy = s * 0.03; P.crot = -0.14 * s; P.arch = 0.16 * s;
        P.f2x = G.hh * 0.5 * s; P.f3x = G.hh * 0.42 * s; P.hm2 = 1.2 * s; P.hm3 = 1.2 * s;
        P.f0x = 0.02 * s; P.f1x = 0.04 * s;
        P.neck = 0.02 + 0.1 * s; P.head = 0.08 * s + 0.03 * alt * e; P.neckS = 1 + 0.04 * s;
        P.cdx += 0.012 * alt * e; P.rdx += 0.008 * alt * e;     // trembling with effort
        P.eyeO = 1 - s; P.eyeQ = s; P.brow = 1.0 * s; P.jaw = 0.12 * s; P.earB = 0.7 * s; P.smile = 0;
        P.tailO = s; P.tailOa = 1.5; P.tailOc = 0.35; P.tailW = 0;
        if (i >= 8) { P.fx = 5; P.fxT = (i - 8) / 5; }
      } else {
        e = i - 13;                                             // 0 near hind kicks, 1 far hind kicks, 2 happy stand
        P.rdy = 0.04; P.rrot = -0.05; P.cdy = 0.01; P.arch = 0.02;
        P.neck = 0.12; P.head = 0.28; P.eyeQ = 1; P.smile = 1; P.jaw = 0.55; P.tongue = 0.7; P.earB = -0.2; P.brow = -0.3;
        if (e === 0) { P.f2x = -G.hh * 0.55; P.f2y = G.hh * 0.42; P.hm2 = -0.7; P.f3x = 0.03; }
        else if (e === 1) { P.f3x = -G.hh * 0.55; P.f3y = G.hh * 0.42; P.hm3 = -0.7; P.f2x = 0.03; }
        P.f0x = 0.02; P.f1x = 0.04;
        P.tailO = 0.8; P.tailOa = 1.2; P.tailOc = 0.4; P.tailW = 0.6; P.wph = 2.2 * e;
        if (e < 2) { P.fx = 6; P.fxT = e; } else { P.rdy = 0.01; P.rrot = 0; P.head = 0.2; P.neck = 0.08; P.tailO = 0.5; }
      }
      break;
    case 'drink':
      // head low at a bowl in front: lapping (tongue out on every 3rd frame), little head bobs, ears forward, gentle wag
      w = a; e = i % 3;                                       // 0 tongue out, 1 half-way in, 2 in
      s = e === 0 ? 1 : e === 1 ? 0.4 : 0;
      P.cdy = 0.13 * G.Lf; P.crot = 0.14; P.cdx = 0.01 * Math.sin(w); P.f0x = 0.05; P.f1x = 0.07;
      P.head = -0.82 + 0.07 * s; P.neckS = 1.2;
      DA_aimHead(P, G, -0.1 - Math.sin(0.82) * (b.sl * 0.8 + b.ml) * b.hr * 0.9 - b.hr * 0.2 - 0.012 * s, 1.5);
      P.jaw = 0.22 + 0.33 * s; P.tongue = 0.1 + 0.9 * s; P.eyeO = 0.75; P.smile = 0.5;
      P.earB = -0.3; P.earF = 0.08 + 0.06 * Math.sin(w);
      P.tailO = 0.6; P.tailOa = 0.35; P.tailOc = 0.25; P.tailW = 0.35; P.wph = DA_TAU * i * 2 / n; P.breath = Math.sin(w);
      break;
    case 'pounce':
      // one little hop forward: crouch, spring with the front paws up, land on the front feet, bounce
      var hp = 0.22 + 0.3 * LL;
      DA_mood(P, 3); P.eyeW = 0.6; P.earB = -0.4; P.jaw = 0.5; P.tongue = 0.5; P.tailW = 0.7; P.wph = a; P.tailA = 0.25;
      if (i === 0) {                                          // crouch, weight back
        P.sqy = 0.86; P.sqx = 1.06; P.rdy = 0.04; P.crot = 0.12; P.cdy = 0.05 * G.Lf; P.neck = -0.1; P.head = 0.05;
        P.f2x = G.hh * 0.15; P.f3x = G.hh * 0.12; P.hm2 = 0.4; P.hm3 = 0.4; P.earF = 0.15;
      } else if (i <= 3) {                                    // in the air, front paws raised and spread
        s = (i - 0.5) / 3; e = Math.sin(Math.PI * s);
        P.oy = hp * e; P.rot = -0.3 * Math.cos(Math.PI * s); P.sqy = 1 + 0.06 * (1 - s);
        P.cdx = 0.04 * e; P.rdx = -0.02 * e;
        P.f0p = P.f0q = P.f1p = P.f1q = 1;
        P.f0x = G.Lf * 0.55; P.f0y = -G.Lf * (0.45 - 0.1 * s); P.f1x = G.Lf * 0.3; P.f1y = -G.Lf * (0.55 - 0.1 * s); P.f0r = 0.7; P.f1r = 0.7;
        P.f2x = -G.hh * 0.35 * e; P.f3x = -G.hh * 0.3 * e; P.f2y = G.hh * 0.18 * e; P.f3y = G.hh * 0.15 * e; P.hm2 = -0.3; P.hm3 = -0.3;
        P.neck = 0.1; P.head = 0.15 - 0.2 * s; P.earF = -0.35 * e; P.earB = -0.4 + 0.5 * s;
      } else if (i === 4) {                                   // landing on the front feet, rump high
        P.cdy = G.Lf * 0.35; P.crot = 0.28; P.cdx = 0.05; P.rdy = -0.03; P.rrot = 0.12; P.sqy = 0.94; P.sqx = 1.04;
        P.f0x = G.Lf * 0.35; P.f1x = G.Lf * 0.25; P.f0r = -0.15; P.f1r = -0.15;
        P.f2x = G.hh * 0.12; P.f3x = G.hh * 0.1; P.hm2 = 0.3; P.hm3 = 0.3;
        P.neck = 0.05; P.head = 0.1; P.eyeQ = 1; P.earF = 0.2; P.tailA = 0.5;
      } else {                                                // bounce back up
        P.sqy = 1.03; P.sqx = 0.98; P.cdy = G.Lf * 0.1; P.crot = 0.08; P.f0x = G.Lf * 0.15; P.f1x = G.Lf * 0.1; P.head = 0.15; P.eyeQ = 1; P.earF = 0.1;
      }
      break;
    case 'wrestle':
      // rears up and bats with the front paws, then drops and shoves forward with the head low; tongue out all the way
      w = a; e = 0.5 + 0.5 * Math.cos(w);                      // 1 = reared up (frame 0), 0 = down and shoving (frame n/2)
      var th = 0.72 * e, rx, ry;
      P.rdy = G.hh * 0.24 * e; P.rdx = G.D * 0.05 * e + 0.05 * (1 - e); P.rrot = -0.35 * e;
      rx = G.xr + P.rdx; ry = G.yr + P.rdy;
      P.cdx = rx + G.D * Math.cos(th) - G.xc + 0.06 * (1 - e); P.cdy = ry - G.D * Math.sin(th) - G.yc + 0.06 * G.Lf * (1 - e); P.crot = -th * 0.85 + 0.18 * (1 - e);
      P.f2x = G.hh * 0.3 * e; P.f3x = G.hh * 0.25 * e; P.hm2 = 0.8 * e; P.hm3 = 0.8 * e;
      P.f0p = P.f0q = P.f1p = P.f1q = e;
      P.f0x = G.Lf * (0.45 + 0.12 * alt) * e + 0.04 * (1 - e); P.f0y = -G.Lf * (0.42 - 0.12 * alt) * e + 0.03 * Math.max(0, -alt) * (1 - e) * (0.5 + LL);
      P.f1x = G.Lf * (0.38 - 0.12 * alt) * e + 0.06 * (1 - e); P.f1y = -G.Lf * (0.52 + 0.12 * alt) * e + 0.03 * Math.max(0, alt) * (1 - e) * (0.5 + LL);
      P.f0r = 0.8 * e; P.f1r = 0.8 * e; P.f0a = 0.3 * (1 - e); P.f1a = 0.3 * (1 - e);
      P.neck = 0.15 * e - 0.35 * (1 - e); P.head = 0.2 * e - 0.15 * (1 - e) + 0.05 * alt; P.neckS = 1.05;
      P.jaw = 0.6 + 0.08 * alt; P.tongue = 0.9; P.eyeQ = 1; P.smile = 1; P.earB = -0.25; P.earF = 0.3 * Math.sin(2 * w) - 0.15 * e;
      P.tailO = 0.7; P.tailOa = 1.1; P.tailOc = 0.4; P.tailW = 1.0; P.wph = DA_TAU * i * 2 / n + 0.5;
      P.breath = Math.sin(w);
      break;
  }
}

// ---------- which picture to show: clip + frame + mood bucket (this is also the sprite cache key) ----------
var DA_R = { clip: 'idle', i: 0, n: 6, hb: 2, flags: 0, shiver: 0 };
// per-dog gait memory (not game state): where the current walk started, when the dog last stopped.
// Lets the stride start on a chosen foot and adds a half-way picture on starting / stopping, so nothing pops.
var DA_DS = new Map();
function DA_dstate(d) {
  var k = d.id != null ? d.id : (d.breed + '|' + d.seed), e = DA_DS.get(k);
  if (!e) { if (DA_DS.size > 400) DA_DS.clear(); e = { mv: false, run: false, d0: 0, t0: -9, tStop: -9, i: 0, lastT: -9 }; DA_DS.set(k, e); }
  return e;
}
function DA_resolve(G, d, t, opt, R, s) {
  var st = opt.pose || d.state || 'idle', anim = opt.pose ? null : d.anim, moving = opt.pose ? false : !!d.moving;
  var happy = d.happy == null ? 70 : +d.happy, hb = happy < 30 ? 1 : happy <= 70 ? 2 : 3;
  var seed = Math.abs(+d.seed || 0), sp = (seed * 0.618034) % 1, cyc, n, em, tt, k, ko;
  R.flags = 0; R.shiver = 0;
  if (opt.pose) {
    if (st === 'walk') moving = true;
    else if (st === 'run') { moving = true; st = 'play'; }
    else if (DA_EMO[st]) { anim = st; st = 'idle'; }
    else if (st === 'stand') st = 'idle';
  }
  var ds = opt.pose ? null : DA_dstate(d);
  if (ds && ds.lastT > t + 0.5) { ds.mv = false; ds.tStop = -9; }              // time went backwards (a different caller): forget
  if (moving) {
    var run = st === 'play' || d.speed > DA_RUNV, spd = d.speed > 0 ? +d.speed : run ? 160 : 75;
    var stride = (run ? G.rStride : G.wStride) * G.H * (s || 1), dist = d.walkDist != null && isFinite(d.walkDist) ? +d.walkDist : t * spd, ph;
    R.clip = run ? 'run' : 'walk'; R.n = run ? DA_RN : DA_WN; R.hb = run ? 3 : hb === 1 ? 1 : 2;
    if (ds) {
      if (!ds.mv || ds.run !== run || dist < ds.d0 || t - ds.lastT > 0.5) {         // (re)starting: first step with the near front foot
        if (!ds.mv || t - ds.lastT > 0.5) ds.t0 = t;
        ds.mv = true; ds.run = run; ds.d0 = dist;
      }
      ph = (run ? 0.5 : 0.3) + (dist - ds.d0) / stride;
    } else ph = dist / stride + sp;
    R.i = Math.floor(DA_frac(ph) * R.n + 0.5) % R.n;
    if (ds) {
      if (!run && t - ds.t0 < 0.09 && dist - ds.d0 < stride / R.n) R.clip = 'walk~';   // setting off: half-way from standing
      ds.i = R.i; ds.lastT = t;
    }
  } else if (ds && ds.mv && !ds.run && !anim && st !== 'nap' && st !== 'kennel' && st !== 'eat' && t - ds.lastT < 0.5) {
    ds.mv = false; ds.tStop = t; ds.lastT = t;
    R.clip = 'walk~'; R.n = DA_WN; R.hb = hb === 1 ? 1 : 2; R.i = ds.i;                 // coming to a stop: half-way to standing
  } else if (ds && !ds.mv && t - ds.tStop < 0.09 && t >= ds.tStop && !anim && st !== 'nap' && st !== 'kennel' && st !== 'eat') {
    ds.lastT = t; R.clip = 'walk~'; R.n = DA_WN; R.hb = hb === 1 ? 1 : 2; R.i = ds.i;
  } else if (st === 'nap' || st === 'kennel') {
    R.clip = (G.b.nap === 'sphinx' && Math.floor(seed) % 3 === 2) ? 'napc' : 'nap'; R.n = 4; R.hb = 2;
    R.i = Math.floor(DA_frac(t * 0.36 + sp) * 4); if (R.i === 2) R.i = 0;                 // breathe in, rest, breathe out, rest
  } else if (st === 'eat') { R.clip = 'eat'; R.n = 4; R.hb = 2; R.i = Math.floor(DA_frac(t * 2 + sp) * 4); }
  else if (anim && (em = DA_EMO[anim])) {
    n = em[0]; R.hb = (anim === 'sit' && hb === 3) ? 3 : 2;
    if (d.animT == null || opt.pose) { R.clip = anim; R.n = n; R.i = Math.floor(DA_frac(t * DA_FPS / n + sp) * n); }
    else {
      tt = +d.animT; if (!(tt >= 0)) tt = 0;
      k = Math.floor(tt * DA_FPS); ko = d.animDur > 0 ? Math.floor((d.animDur - tt) * DA_FPS) : 99;
      if (k < em[1]) { R.clip = anim + '>'; R.n = em[1]; R.i = k; }                          // easing in
      else if (ko < em[1]) { R.clip = anim + (em[2] ? '<' : '>'); R.n = em[1]; R.i = ko < 0 ? 0 : ko; }      // easing out (same frames, backwards)
      else { R.clip = anim; R.n = n; R.i = (k - em[1]) % n; }
    }
  } else if (st === 'play') { R.clip = 'excite'; R.n = 4; R.hb = 3; R.i = Math.floor(DA_frac(t * 2 + sp) * 4); }
  else {
    cyc = t * DA_FPS / 6 + sp; n = Math.floor(cyc);
    R.clip = 'idle'; R.n = 6; R.hb = hb; R.i = Math.floor((cyc - n) * 6);
    if (R.i === 3 && DA_rnd(n * 1.37 + seed) < 0.35) R.flags = 1;
    else if (R.i === 1 && DA_rnd(n * 2.11 + seed * 3.3) < 0.14) R.flags = 2;
    if (happy < 15) R.shiver = (Math.floor(t * 18) & 1) ? 1 : -1;
  }
  if (opt.frame != null) { R.i = ((opt.frame | 0) % R.n + R.n) % R.n; R.flags = 0; }
  return R;
}
// build the pose for a resolved clip frame into DA_PA
function DA_poseFor(G, R) {
  var P = DA_PA, clip = R.clip, i = R.i, hb = R.hb, B, em, w, tr;
  DA_reset(P);
  switch (clip) {
    case 'idle': DA_poseIdle(P, G, hb, i, R.flags); break;
    case 'excite': DA_poseExcite(P, G, hb, i); break;
    case 'walk': DA_poseWalk(P, G, hb, i, R.n); break;
    case 'run': DA_poseRun(P, G, hb, i, R.n); break;
    case 'walk~':          // half-way between standing and a walk frame (setting off / stopping)
      DA_poseIdle(P, G, hb, 0, 0);
      B = DA_PB; DA_reset(B); DA_poseWalk(B, G, hb, i, R.n); DA_blend(P, B, 0.5); P.ga = 1;
      break;
    case 'nap': DA_napCurl = false; DA_poseNap(P, G, hb, i); break;
    case 'napc': DA_napCurl = true; DA_poseNap(P, G, hb, i); break;
    case 'eat': DA_poseEat(P, G, hb, i); break;
    default:
      tr = clip.charAt(clip.length - 1) === '>'; var out = clip.charAt(clip.length - 1) === '<';   // '>' ease in from standing, '<' ease out of the last frame
      if (tr || out) clip = clip.substr(0, clip.length - 1);
      em = DA_EMO[clip];
      if (!em) { DA_poseIdle(P, G, hb, 0, 0); break; }
      if (!tr && !out) { DA_poseAnim(P, G, hb, clip, i, em[0], 1); break; }
      // ease-in frame: part-way between standing and the first (ease-out: the last) frame of the loop
      w = (i + 1) / (em[1] + 1);
      DA_poseIdle(P, G, hb, 0, 0);
      B = DA_PB; DA_reset(B);
      if (clip === 'roll') { DA_poseAnim(P, G, hb, clip, 0, em[0], 0.25 + 0.25 * i); break; }
      DA_poseAnim(B, G, hb, clip, out ? em[0] - 1 : 0, em[0], 1);
      DA_blend(P, B, w);
  }
  DA_wph = P.wph;
  return P;
}

// ============================================================================================
// Vector painter: draws the current pose (DA_PA, already solved) in dog space
// (origin = ground point between the feet, 1 unit = withers height, facing +x).
// ============================================================================================
function DA_fillTail(c, col, tipCol, underCol, T) {
  c.fillStyle = col; c.beginPath(); DA_tail(c, 0, false, 0); c.fill();
  if (T.k === 'nub' || T.k === 'dock') return;
  if (underCol) { c.fillStyle = underCol; c.beginPath(); DA_tail(c, 1, false, 1); c.fill(); }
  if (tipCol) {     // coloured tip, clipped to the (furry) tail outline
    var N = 8, r = T.len * 0.3;
    c.save(); c.beginPath(); DA_tail(c, 0, false, 0); c.clip();
    c.fillStyle = tipCol; c.beginPath(); DA_dot(c, DA_TXs[N] - Math.cos(DA_TAs[N]) * r * 0.35, DA_TYs[N] - Math.sin(DA_TAs[N]) * r * 0.35, r); c.fill();
    c.restore();
  }
}
function DA_fillLegF(c, i, cU, cM, cL, cP) {
  if (cU) { c.fillStyle = cU; c.beginPath(); DA_legFront(c, i, 1); c.fill(); }
  if (cM === cL && cL === cP) { c.fillStyle = cM; c.beginPath(); DA_legFront(c, i, 2); DA_legFront(c, i, 3); DA_legFront(c, i, 4); c.fill(); return; }
  c.fillStyle = cP; c.beginPath(); DA_legFront(c, i, 4); c.fill();
  c.fillStyle = cL; c.beginPath(); DA_legFront(c, i, 3); c.fill();
  c.fillStyle = cM; c.beginPath(); DA_legFront(c, i, 2); c.fill();
}
function DA_fillLegH(c, i, cU, cM, cL, cP) {
  if (cU === cM && cM === cL && cL === cP) { c.fillStyle = cU; c.beginPath(); DA_legHind(c, i, 0); c.fill(); return; }
  c.fillStyle = cP; c.beginPath(); DA_legHind(c, i, 4); c.fill();
  c.fillStyle = cL; c.beginPath(); DA_legHind(c, i, 3); c.fill();
  c.fillStyle = cM; c.beginPath(); DA_legHind(c, i, 2); c.fill();
  c.fillStyle = cU; c.beginPath(); DA_legHind(c, i, 1); c.fill();
}
// thin contour lines so the near legs read against a same-coloured body
function DA_contourH(c, S, Q, P) {
  var G = DA_g, b = G.b, L = DA_L, folded = P.f2p > 0.5;
  if (S.hU !== S.body && !folded) return;
  var rt = DA_rr * 0.8, kf = b.legFur === 3 ? 1.3 : b.legFur === 2 ? 1.15 : 1, rj = b.bone * 1.6 * kf, rh = b.bone * 1.05 * kf;
  var tdx = L[26] - L[24], tdy = L[27] - L[25], tl = Math.sqrt(tdx * tdx + tdy * tdy) || 1e-6, tnx = tdy / tl, tny = -tdx / tl, ta = Math.atan2(tny, tnx);
  c.strokeStyle = S.hU === S.body ? Q.lineIn : DA_lineOn(S.hU) === DA_OUT ? DA_mix(S.hU, DA_OUT, 0.55) : DA_lineOn(S.hU);
  c.lineWidth = G.dl; c.beginPath();
  c.moveTo(L[24] + tnx * rt * 0.92 + tdx * 0.12, L[25] + tny * rt * 0.92 + tdy * 0.12);
  c.lineTo(L[26] + tnx * rj, L[27] + tny * rj);
  if (folded) {       // sitting / lying: wrap round the knee and down the shin so the haunch reads
    var sdx = L[28] - L[26], sdy = L[29] - L[27], sl = Math.sqrt(sdx * sdx + sdy * sdy) || 1e-6, snx = sdy / sl, sny = -sdx / sl, sa = Math.atan2(sny, snx);
    while (sa < ta) sa += DA_TAU;
    if (sa - ta > 4.2) sa = ta + 1.1;
    c.arc(L[26], L[27], rj, ta, sa);
    c.lineTo(L[28] + snx * rh - sdx * 0.15, L[29] + sny * rh - sdy * 0.15);
  } else c.arc(L[26], L[27], rj, ta, ta + 1.1);
  c.stroke();
}
function DA_contourF(c, S, Q) {
  var G = DA_g, b = G.b, L = DA_L;
  if (S.fM !== S.body || b.legFur) return;
  var rf = Math.min(DA_cr * 0.6, b.bone * 1.7);
  c.strokeStyle = Q.lineIn; c.lineWidth = G.dl; c.beginPath();
  c.moveTo(L[0] - rf * 0.95, L[1] - rf * 0.3); c.quadraticCurveTo(L[0] - rf * 1.0, L[1] + rf * 0.5, L[4] - b.bone * 1.1, L[5] - b.bone * 0.2);
  c.stroke();
}
// whole-body transform of a pose: hop, squash and stretch, pitch, belly-up flip
function DA_bodyXform(c, P) {
  if (P.oy !== 0) c.translate(0, -P.oy);
  if (P.sqx !== 1 || P.sqy !== 1) c.scale(P.sqx, P.sqy);
  if (P.rot !== 0 || P.flip > 0) {
    c.translate(0, -0.5); c.rotate(P.rot);
    if (P.flip > 0) c.scale(1, P.flip < 0.5 ? 1 - 1.4 * P.flip : -(0.3 + 1.4 * (P.flip - 0.5)));
    c.translate(0, 0.5);
  }
}
// mud layer on its own (transparent elsewhere): body splotches clipped to the torso, muddy paws, nothing over the head
function DA_paintMud(c, G, P, level) {
  DA_solve(G, P); DA_headSetup();
  c.save();
  DA_bodyXform(c, P);
  c.save(); c.beginPath(); DA_torso(c); DA_neck(c); DA_legFront(c, 0, 1); c.clip();
  DA_mud(c, level);
  c.restore();
  if (level >= 2) DA_pawMud(c);
  c.globalCompositeOperation = 'destination-out'; c.fillStyle = '#000';
  c.beginPath(); DA_headShapes(c); if (!DA_isErect(G.b.ear)) DA_earDrop(c); c.fill();
  c.globalCompositeOperation = 'source-over';
  c.restore();
}
// drips under a wet dog (drawn over an already painted sprite)
function DA_paintDrips(c, G, P) {
  DA_solve(G, P);
  c.save(); DA_bodyXform(c, P); DA_drips(c, P.wph, 1); c.restore();
}
function DA_paint(c, G, Q, P, collar, wet, noShadow, mud) {
  var b = G.b, T = b.tail, E = b.ear, S = Q.S, F = Q.F, ow2 = G.ow * 2;
  DA_Q = Q;
  DA_solve(G, P); DA_headSetup(); DA_tailChain();
  c.save();
  c.lineJoin = 'round'; c.lineCap = 'round';
  if (!noShadow) {
    var sk = 1 - 0.35 * DA_clamp(P.oy * 2, 0, 1);
    c.fillStyle = 'rgba(40,26,12,0.22)'; c.beginPath(); c.ellipse(0.03, 0.01, (b.len * 0.5 + 0.12) * sk, (0.07 + b.chest * 0.12) * sk, 0, 0, DA_TAU); c.fill();
  }
  DA_bodyXform(c, P);
  var tailOver = P.tailFront > 0.5 || ((T.a + (T.curl || 0)) > 180 && T.k !== 'nub' && T.k !== 'dock');
  var sep = P.sep > 0.5, erect = DA_isErect(E);

  // ---- far side: far ear, far legs (one shade darker) ----
  c.strokeStyle = DA_OUT; c.lineWidth = ow2;
  c.beginPath();
  if (erect && !sep) DA_earErect(c, true, false);
  DA_legHind(c, 3, 0); DA_legFront(c, 1, 0);
  c.stroke();
  if (erect && !sep) { c.fillStyle = F.ear; c.beginPath(); DA_earErect(c, true, false); c.fill(); c.fillStyle = F.earIn; c.beginPath(); DA_earErect(c, true, true); c.fill(); }
  DA_fillLegH(c, 3, F.hU, F.hM, F.hL, F.paw);
  DA_fillLegF(c, 1, F.fU, F.fM, F.fL, F.paw);

  // ---- silhouette outline of everything on the near side ----
  c.beginPath();
  DA_tail(c, 0, false, 0);
  DA_torso(c); DA_neck(c);
  var legSep = P.legSep > 0.5;
  if (!legSep) DA_legHind(c, 2, 0);
  DA_legFront(c, 0, 0);
  if (!sep) DA_headShapes(c);
  c.stroke();

  // ---- fills ----
  if (!tailOver) DA_fillTail(c, S.tail, S.tip, S.tailUnder, T);
  // (the near shoulder is part of the body mass, so body markings run across it)
  c.fillStyle = S.body; c.beginPath(); DA_torso(c); DA_neck(c); DA_legFront(c, 0, 1); c.fill();
  c.save();
  c.beginPath(); DA_torso(c); DA_neck(c); DA_legFront(c, 0, 1); c.clip();
  DA_bodyMarks(c);
  if (mud) DA_mud(c, mud);
  c.restore();
  if (legSep) {       // a raised hind leg (scratching) gets its own outline on top of the body
    DA_fillLegF(c, 0, null, S.fM, S.fL, S.paw); DA_contourF(c, S, Q);
    c.strokeStyle = DA_OUT; c.lineWidth = ow2; c.beginPath(); DA_legHind(c, 2, 2); DA_legHind(c, 2, 3); DA_legHind(c, 2, 4); c.stroke();
    DA_fillLegH(c, 2, S.hU, S.hM, S.hL, S.paw); DA_contourH(c, S, Q, P);
  } else if (P.hindFront > 0.5) { DA_fillLegF(c, 0, null, S.fM, S.fL, S.paw); DA_contourF(c, S, Q); DA_fillLegH(c, 2, S.hU, S.hM, S.hL, S.paw); DA_contourH(c, S, Q, P); }
  else { DA_fillLegH(c, 2, S.hU, S.hM, S.hL, S.paw); DA_contourH(c, S, Q, P); DA_fillLegF(c, 0, null, S.fM, S.fL, S.paw); DA_contourF(c, S, Q); }
  DA_legMarks(c);
  if (mud >= 2) DA_pawMud(c);
  if (tailOver) {
    DA_fillTail(c, S.tail, S.tip, S.tailUnder, T);
    c.strokeStyle = Q.L.tail; c.lineWidth = G.dl * 1.5; c.beginPath(); DA_tail(c, 0, true, 0); c.stroke();
  }
  if (collar && !sep) DA_collar(c, collar);
  // ---- head ----
  if (sep) { c.strokeStyle = DA_OUT; c.lineWidth = ow2; c.beginPath(); DA_headShapes(c); c.stroke(); }
  DA_headFill(c);
  // ---- little effects ----
  if (P.fx > 0) DA_effects(c, P.fx, P.fxT);
  if (wet) DA_drips(c, P.wph, 1);
  c.restore();
}

function DA_collar(c, col) {
  var G = DA_g, b = G.b, dx = DA_Hx - DA_NBx, dy = DA_Hy - DA_NBy, l = Math.sqrt(dx * dx + dy * dy) || 1e-6, w = b.neckW, nx = dy / l, ny = -dx / l;
  var f = 0.56, mx = DA_NBx + dx * f, my = DA_NBy + dy * f, cw = Math.max(0.05, 2.1 / G.H);
  var ax = mx + nx * w * 1.5, ay = my + ny * w * 1.5, bx = mx - nx * w * 1.4, by = my - ny * w * 1.4;
  c.save(); c.beginPath(); DA_neck(c); c.clip();
  c.lineCap = 'butt';
  c.beginPath(); c.moveTo(ax, ay); c.quadraticCurveTo(mx + dx / l * cw * 0.5, my + dy / l * cw * 0.5, bx, by);
  c.strokeStyle = DA_OUT; c.lineWidth = cw + G.ow * 1.5; c.stroke();
  c.strokeStyle = col; c.lineWidth = cw; c.stroke();
  c.restore();
  c.lineCap = 'round';
  bx = mx - nx * w * 0.86; by = my - ny * w * 0.86;
  var tr = cw * 0.5, tx = bx + dx / l * cw * 0.2 + 0.01, ty = by + tr * 1.2;
  c.fillStyle = '#f2c14e'; c.strokeStyle = DA_OUT; c.lineWidth = G.dl; c.beginPath(); c.arc(tx, ty, tr, 0, DA_TAU); c.fill(); c.stroke();
  c.fillStyle = '#fff3c4'; c.beginPath(); c.arc(tx - tr * 0.3, ty - tr * 0.3, tr * 0.35, 0, DA_TAU); c.fill();
}
function DA_effects(c, fx, tt) {
  var G = DA_g, b = G.b, i;
  if (fx === 1) {          // bark: three short "sound" ticks in front of the mouth
    var r0 = DA_xt + 0.55, r1 = r0 + 0.55;
    c.strokeStyle = DA_OUT; c.lineWidth = G.ow * 1.1; c.beginPath();
    for (i = -1; i <= 1; i++) { var a = i * 0.5 + 0.15; c.moveTo(DA_hX(Math.cos(a) * r0, Math.sin(a) * r0 + 0.2), DA_hY(Math.cos(a) * r0, Math.sin(a) * r0 + 0.2)); c.lineTo(DA_hX(Math.cos(a) * r1, Math.sin(a) * r1 + 0.2), DA_hY(Math.cos(a) * r1, Math.sin(a) * r1 + 0.2)); }
    c.stroke();
  } else if (fx === 2) {   // shake: droplets / fluff flying off
    c.fillStyle = '#bfe6f5'; c.strokeStyle = DA_OUT; c.lineWidth = G.dl; c.beginPath();
    for (i = 0; i < 7; i++) {
      var p = DA_frac(tt + i * 0.37), an = -0.3 - i * 0.42, rr = 0.35 + p * 0.75, cx = G.xc * 0.2 + Math.cos(an) * rr * (0.6 + b.len * 0.45), cy = -0.7 + Math.sin(an) * rr * 0.9 + p * p * 0.3;
      DA_dot(c, cx, cy, 0.04 * (1 - p * 0.6));
    }
    c.fill(); c.stroke();
  } else if (fx === 3) {   // dig: clods of dirt thrown back under the belly
    c.fillStyle = '#8a6240'; c.strokeStyle = DA_OUT; c.lineWidth = G.dl; c.beginPath();
    for (i = 0; i < 6; i++) {
      var q = DA_frac(tt + i * 0.29), vx = -(0.5 + 0.35 * DA_rnd(i * 3.3)) * (0.5 + b.len * 0.4), x0 = G.ffx + 0.05;
      DA_dot(c, x0 + vx * q, -0.05 - (0.55 * q - 0.75 * q * q) * (0.6 + DA_rnd(i) * 0.8), 0.03 + 0.025 * DA_rnd(i * 7));
    }
    c.fill(); c.stroke();
  } else if (fx === 4) {   // howl: two drifting sound arcs above the muzzle
    c.strokeStyle = DA_OUT; c.lineWidth = G.ow * 1.0; c.beginPath();
    for (i = 0; i < 2; i++) { var k = DA_frac(tt + i * 0.5), r = DA_xt + 0.5 + k * 0.9; c.moveTo(DA_hX(r, -0.35), DA_hY(r, -0.35)); c.quadraticCurveTo(DA_hX(r + 0.2, 0.1), DA_hY(r + 0.2, 0.1), DA_hX(r, 0.55), DA_hY(r, 0.55)); }
    c.globalAlpha = 0.7; c.stroke(); c.globalAlpha = 1;
  } else if (fx === 5) {   // strain: a sweat drop sliding off the back of the head + two little effort ticks
    var sx = DA_hX(-0.9, -0.95), sy = DA_hY(-0.9, -0.95), sr = Math.max(0.035, b.hr * 0.11), sp = DA_clamp(tt, 0, 1), sd = sp * sr * 3;
    c.fillStyle = '#9fd6ee'; c.strokeStyle = DA_OUT; c.lineWidth = G.dl; c.beginPath();
    c.moveTo(sx, sy + sd - sr * 2.1); c.quadraticCurveTo(sx + sr * 1.3, sy + sd, sx, sy + sd + sr); c.quadraticCurveTo(sx - sr * 1.3, sy + sd, sx, sy + sd - sr * 2.1);
    c.fill(); c.stroke();
    c.strokeStyle = DA_OUT; c.lineWidth = G.ow * 0.9; c.beginPath();
    c.moveTo(DA_hX(0.2, -1.45), DA_hY(0.2, -1.45)); c.lineTo(DA_hX(0.35, -1.9), DA_hY(0.35, -1.9));
    c.moveTo(DA_hX(0.75, -1.3), DA_hY(0.75, -1.3)); c.lineTo(DA_hX(1.05, -1.7), DA_hY(1.05, -1.7));
    c.stroke();
  } else if (fx === 6) {   // kick-back: puffs of dust behind the hind feet
    c.fillStyle = 'rgba(214,190,150,0.75)'; c.strokeStyle = 'rgba(59,42,32,0.55)'; c.lineWidth = G.dl; c.beginPath();
    for (i = 0; i < 5; i++) {
      var kx = G.hfx - 0.15 - i * 0.075 - tt * 0.1, ky = -G.pawH - 0.02 - (0.06 + 0.04 * DA_rnd(i * 2.1)) * (1 + tt * 0.6) * ((i & 1) ? 1.6 : 0.7);
      DA_dot(c, kx, ky, 0.035 + 0.02 * DA_rnd(i * 5.7) + 0.012 * tt);
    }
    c.fill(); c.stroke();
  }
}
function DA_drips(c, ph, wet) {
  var i;
  c.fillStyle = '#9fd6ee'; c.beginPath();
  for (i = 0; i < 4; i++) {
    var p = DA_frac(ph / DA_TAU + i * 0.31), u = -0.1 + i * 0.36, x0 = DA_tX(u, 1), y0 = DA_tY(u, 1), yy = y0 + p * p * (-y0), r = 0.03 * wet * (1 - p * 0.4);
    c.moveTo(x0, yy - r * 2.2); c.quadraticCurveTo(x0 + r * 1.3, yy, x0, yy + r); c.quadraticCurveTo(x0 - r * 1.3, yy, x0, yy - r * 2.2);
  }
  c.fill();
}

// ============================================================================================
// Sprite cache. Software canvases make live vector drawing far too slow for 60 fps, so every
// (breed, coat, collar, dirt / wet / mood bucket, clip, frame, facing) picture is baked once into a small
// canvas at the exact device scale and then blitted 1:1 on whole device pixels.
// Sprites are shared by every dog with the same look; the per-dog seed only shifts the animation phase
// (and picks one of 3 layouts for the patterns that are random: spots / patches).
// ============================================================================================
var DA_CACHE_ON = true;
var DA_BUDGET_MS = 3.5;                    // max time spent baking new sprites per frame (a frame may still finish one bake)
var DA_CAP_BYTES = 16e6;                   // sprite memory cap at device scale ~1.15 (grows with zoom^2, max x3.5); least recently used go first
var DA_FORCE_MAX = 6;                      // bakes allowed beyond the budget per frame for dogs that have nothing to show yet
var DA_C = { gens: [], bytes: 0, tick: 0, lastT: NaN, f0: 0, spent: 0, forced: 0, seen: {}, seenN: 0, scratch: null, sctx: null,
  ident: {}, identN: 0, hits: 0, bakes: 0, mirrors: 0, tints: 0, muds: 0, falls: 0, skips: 0, bakeMs: 0 };
var DA_VSEED = [0, 53, 131];              // pattern seeds for the 3 layout variants

function DA_now() { return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(); }
function DA_mkCanvas(w, h) {
  var cv;
  if (typeof document !== 'undefined' && document.createElement) { cv = document.createElement('canvas'); cv.width = w; cv.height = h; return cv; }
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  return null;
}
// one "generation" of sprites per device scale. Old scales are kept (zooming back is free) until memory runs short.
function DA_dropGen(idx) {
  var C = DA_C, gs = C.gens, g = gs[idx];
  C.bytes -= g.bytes; g.map.clear(); g.bytes = 0; gs.splice(idx, 1);
}
function DA_genFor(kdKey, kd, now) {
  var C = DA_C, gs = C.gens, i, g, best = null;
  for (i = 0; i < gs.length; i++) { if (gs[i].key === kdKey) { gs[i].last = C.tick; return gs[i]; } if (!best || gs[i].last > best.last) best = gs[i]; }
  var seen = C.seen[kdKey];
  if (seen === undefined) { if (++C.seenN > 40) { C.seen = {}; C.seenN = 1; } seen = C.seen[kdKey] = now; }
  if (best && now - seen < 120) return best;          // scale still changing (zoom animation): stretch the old sprites meanwhile
  g = { key: kdKey, kd: kd, map: new Map(), last: C.tick, bytes: 0 };
  gs.push(g);
  while (gs.length > 6) {                              // far too many scales: drop the least recently used one
    var lo = -1; for (i = 0; i < gs.length; i++) if (gs[i] !== g && (lo < 0 || gs[i].last < gs[lo].last)) lo = i;
    DA_dropGen(lo);
  }
  return g;
}
// over the memory cap: throw away the least recently drawn sprites, whatever scale they belong to
function DA_evict(kd) {
  var C = DA_C, gs = C.gens, i, age, lim = DA_CAP_BYTES * Math.max(1, Math.min(3.5, kd * kd / 1.3225)) * 0.85, g;
  function sweep(e, k) { if (e.tick < C.tick - age) { C.bytes -= e.bytes; g.bytes -= e.bytes; g.map.delete(k); } }
  for (age = 7200; age >= 2 && C.bytes > lim; age = Math.floor(age / 2)) {
    for (i = 0; i < gs.length && C.bytes > lim; i++) { g = gs[i]; g.map.forEach(sweep); }
  }
  for (i = gs.length - 1; i >= 0; i--) if (gs[i].map.size === 0 && gs[i].last < C.tick - 600) DA_dropGen(i);
}
// bake one sprite (facing right) for the current DA_R / palette; returns an entry { cv, ox, oy, w, h }
function DA_bake(G, Q, R, kd, collar, wet, noShadow) {
  var C = DA_C, b = G.b, S = G.H * kd, t0 = DA_now();
  var left = b.len * 0.5 + (b.tail.len || 0) + 0.55, right = b.len * 0.5 + b.neckL * 1.5 + b.hr * (b.sl + b.ml + 2.2) + 0.35, top = 2.75, bot = 0.5;
  var ox = Math.ceil(left * S) + 3, oy = Math.ceil(top * S) + 3, w = ox + Math.ceil(right * S) + 3, h = oy + Math.ceil(bot * S) + 3;
  if (!C.scratch || C.scratch.width < w || C.scratch.height < h) {
    C.scratch = DA_mkCanvas(Math.max(w, C.scratch ? C.scratch.width : 0), Math.max(h, C.scratch ? C.scratch.height : 0));
    C.sctx = C.scratch.getContext('2d', { willReadFrequently: true });
  }
  var g = C.sctx;
  g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, w, h);
  g.setTransform(S, 0, 0, S, ox, oy);
  DA_paint(g, G, Q, DA_poseFor(G, R), collar, wet, noShadow);
  g.setTransform(1, 0, 0, 1, 0, 0);
  var e = DA_crop(g, w, h, ox, oy, kd);
  if (e.clip && !DA_bake.warned) { DA_bake.warned = 1; if (typeof console !== 'undefined') console.warn('dogart: sprite touches bake bounds', G.breed.id, R.clip, R.i); }
  var dt = DA_now() - t0; C.spent += dt; C.bakeMs += dt; C.bakes++;
  return e;
}
// copy the painted part of the scratch canvas into its own tight canvas
function DA_crop(g, w, h, ox, oy, kd) {
  var C = DA_C, px = new Uint32Array(g.getImageData(0, 0, w, h).data.buffer), x0 = w, x1 = -1, y0 = -1, y1 = -1, x, y, row;
  for (y = 0; y < h && y0 < 0; y++) { row = y * w; for (x = 0; x < w; x++) if (px[row + x]) { y0 = y; break; } }
  if (y0 < 0) { y0 = 0; y1 = 0; x0 = 0; x1 = 0; }
  else {
    for (y = h - 1; y >= y0 && y1 < 0; y--) { row = y * w; for (x = 0; x < w; x++) if (px[row + x]) { y1 = y; break; } }
    for (y = y0; y <= y1; y++) {
      row = y * w;
      for (x = 0; x < x0; x++) if (px[row + x]) { x0 = x; break; }
      for (x = w - 1; x > x1; x--) if (px[row + x]) { x1 = x; break; }
    }
  }
  var sw = x1 - x0 + 1, sh = y1 - y0 + 1, cv = DA_mkCanvas(sw, sh);
  cv.getContext('2d').drawImage(C.scratch, x0, y0, sw, sh, 0, 0, sw, sh);
  return { cv: cv, ox: ox - x0, oy: oy - y0, w: sw, h: sh, bytes: sw * sh * 4, tick: C.tick, kd: kd, mir: false, clip: x0 === 0 || y0 === 0 || x1 === w - 1 || y1 === h - 1 };
}
function DA_mirror(e) {
  var t0 = DA_now(), cv = DA_mkCanvas(e.w, e.h), g = cv.getContext('2d');
  g.setTransform(-1, 0, 0, 1, e.w, 0); g.drawImage(e.cv, 0, 0);
  var dt = DA_now() - t0; DA_C.spent += dt; DA_C.bakeMs += dt; DA_C.mirrors++;
  return { cv: cv, ox: e.w - e.ox, oy: e.oy, w: e.w, h: e.h, bytes: e.bytes, tick: DA_C.tick, kd: e.kd, mir: true };
}
function DA_store(gen, key, e) { gen.map.set(key, e); gen.bytes += e.bytes; DA_C.bytes += e.bytes; }
function DA_setDog(coat, pv) { DA_coatI = coat; DA_seed = DA_VSEED[pv]; }
// make (and store) the sprite for frame R.i of the current clip. mir = also make the mirrored (left-facing) copy.
// pre = '' for the normal look, 'W' for the wet look (a tinted copy of the normal sprite + drips)
function DA_bakeFor(gen, G, R, coat, pv, collar, ns, pre, baseK, mir) {
  var keyR = baseK + R.i + 'R', e = gen.map.get(keyR), w;
  if (!e) {
    DA_setDog(coat, pv);
    e = DA_bake(G, DA_palette(G.breed, coat, 0), R, gen.kd, collar, 0, ns);
    DA_store(gen, keyR, e);
  }
  if (pre === 'W') {
    w = gen.map.get('W' + keyR);
    if (!w) { w = DA_wetCopy(G, R, e); DA_store(gen, 'W' + keyR, w); }
    e = w;
  }
  if (mir) { e = DA_mirror(e); DA_store(gen, pre + baseK + R.i + 'L', e); }
  return e;
}
function DA_wetCopy(G, R, e) {
  var t0 = DA_now(), cv = DA_mkCanvas(e.w, e.h), g = cv.getContext('2d'), S = G.H * e.kd;
  g.drawImage(e.cv, 0, 0);
  g.globalCompositeOperation = 'source-atop'; g.fillStyle = 'rgba(38,50,66,0.24)'; g.fillRect(0, 0, e.w, e.h);
  g.globalCompositeOperation = 'source-over';
  g.setTransform(S, 0, 0, S, e.ox, e.oy);
  DA_paintDrips(g, G, DA_poseFor(G, R));
  var dt = DA_now() - t0; DA_C.spent += dt; DA_C.bakeMs += dt; DA_C.tints++;
  return { cv: cv, ox: e.ox, oy: e.oy, w: e.w, h: e.h, bytes: e.bytes, tick: DA_C.tick, kd: e.kd, mir: false };
}
// mud overlay sprite for one frame (shared by every coat / collar of the breed)
function DA_bakeMud(gen, G, R, pv, db, mkey, mir) {
  var C = DA_C, keyR = mkey + 'R', e = gen.map.get(keyR);
  if (!e) {
    var b = G.b, S = G.H * gen.kd, t0 = DA_now();
    var left = b.len * 0.5 + 0.6, right = b.len * 0.5 + b.neckL * 1.5 + b.hr * 1.5 + 0.4, top = 2.75, bot = 0.5;
    var ox = Math.ceil(left * S) + 3, oy = Math.ceil(top * S) + 3, w = ox + Math.ceil(right * S) + 3, h = oy + Math.ceil(bot * S) + 3;
    if (!C.scratch || C.scratch.width < w || C.scratch.height < h) {
      C.scratch = DA_mkCanvas(Math.max(w, C.scratch ? C.scratch.width : 0), Math.max(h, C.scratch ? C.scratch.height : 0));
      C.sctx = C.scratch.getContext('2d', { willReadFrequently: true });
    }
    var g = C.sctx;
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, w, h);
    g.setTransform(S, 0, 0, S, ox, oy);
    DA_seed = DA_VSEED[pv];
    DA_paintMud(g, G, DA_poseFor(G, R), db);
    g.setTransform(1, 0, 0, 1, 0, 0);
    e = DA_crop(g, w, h, ox, oy, gen.kd);
    var dt = DA_now() - t0; C.spent += dt; C.bakeMs += dt; C.muds++;
    DA_store(gen, keyR, e);
  }
  if (mir) { e = DA_mirror(e); DA_store(gen, mkey + 'L', e); }
  return e;
}
// something to show while the wanted sprite is not baked yet (never leave a dog invisible).
// The entry may face the other way (e.mir tells) or belong to another zoom (e.kd) - the blit copes with both.
function DA_fallback(gen, base, R, ident, any) {
  var C = DA_C, gs = C.gens, i, k, e = null, g, j;
  for (i = 0; i < gs.length && !e; i++) { g = gs[i]; e = g.map.get(base + R.i + 'R') || g.map.get(base + R.i + 'L'); }             // this frame: other facing / another zoom
  for (i = 0; i < gs.length && !e; i++) {                                                                                           // nearest frame of this clip
    g = gs[i];
    for (k = 1; k < R.n && !e; k++) { j = (R.i + R.n - k) % R.n; e = g.map.get(base + j + 'R') || g.map.get(base + j + 'L'); if (!e) { j = (R.i + k) % R.n; e = g.map.get(base + j + 'R') || g.map.get(base + j + 'L'); } }
  }
  return e || C.ident[ident] || C.ident[any] || null;                                                                              // last picture of this dog / of this breed + coat
}
function DA_blit(c, e, dx, dy, kd, left) {
  var r = e.kd === kd ? 1 : kd / e.kd;
  if (left !== !!e.mir) {                    // sprite faces the other way: flipped blit (slower path, used for the rarer clips)
    c.setTransform(-r, 0, 0, r, dx + (e.mir ? e.w - e.ox : e.ox) * r, dy - e.oy * r); c.drawImage(e.cv, 0, 0); c.setTransform(1, 0, 0, 1, 0, 0);
  } else if (r === 1) c.drawImage(e.cv, dx - e.ox, dy - e.oy);
  else c.drawImage(e.cv, dx - e.ox * r, dy - e.oy * r, e.w * r, e.h * r);
}

// drawDog(c, d, x, y, s, t, opt)
//  d: { breed, coat, seed, face, moving, speed, state, happy, needs: { clean }, anim, animT, animDur, collar, wet }
//  opt: { noShadow, pose (force 'stand' | 'walk' | 'run' | 'nap' | 'eat' | any DOG_ANIMS name), frame (force a frame), live (skip the cache) }
function drawDog(c, d, x, y, s, t, opt) {
  if (!c) return;
  d = d || {}; opt = opt || {};
  s = +s || 1; t = +t || 0; x = +x || 0; y = +y || 0;
  var G = DA_geom(d.breed), R = DA_resolve(G, d, t, opt, DA_R, s);
  var coat = d.coat | 0; if (!G.breed.coats || !G.breed.coats[coat]) coat = 0;
  var clean = d.needs && d.needs.clean != null ? +d.needs.clean : 100, db = clean >= 40 ? 0 : clean >= 20 ? 1 : 2;
  var wb = (+d.wet || 0) > 0.3 ? 1 : 0, left = d.face < 0, ns = opt.noShadow ? 1 : 0;
  var pat = G.breed.coats && G.breed.coats[coat] ? G.breed.coats[coat].pattern : '';
  var pv = (pat === 'spots' || pat === 'pied' || pat === 'lemon-white' || pat === 'parti' || pat === 'merle' || pat === 'harlequin' || pat === 'blenheim' || pat === 'boxer') ? Math.floor(Math.abs(+d.seed || 0)) % 3 : 0;
  var collar = d.collar || null;
  var m = (DA_CACHE_ON && !opt.live && c.getTransform) ? c.getTransform() : null;
  if (m && (m.b !== 0 || m.c !== 0 || !(m.a > 0) || Math.abs(m.a - m.d) > 1e-6 * m.a)) m = null;

  if (!m) {                                  // live vector path (rotated / mirrored contexts, or cache disabled)
    DA_setDog(coat, pv);
    var K = G.H * s;
    c.save(); c.translate(x + R.shiver * 0.012 * K, y); c.scale(left ? -K : K, K);
    DA_paint(c, G, DA_palette(G.breed, coat, wb * 3), DA_poseFor(G, R), collar, wb, ns, db);
    c.restore();
    return;
  }
  var C = DA_C, now = DA_now(), kd = m.a * s, kdKey = Math.round(kd * 1000);
  // a new value of t = a new frame (fresh bake budget); the time test only covers a caller whose t never changes
  if (t !== C.lastT || now - C.f0 > 250) {
    C.lastT = t; C.f0 = now; C.spent = 0; C.forced = 0; C.tick++;
    if (C.bytes > DA_CAP_BYTES * Math.max(1, Math.min(3.5, kd * kd / 1.3225))) DA_evict(kd);
  }
  // the everyday clips keep a ready-mirrored copy for dogs facing left; rarer ones are blitted flipped instead (saves memory)
  var hot = R.clip === 'idle' || R.clip === 'walk' || R.clip === 'run', mir = left && hot, sfx = mir ? 'L' : 'R';
  var gen = DA_genFor(kdKey, kd, now), exact = gen.key === kdKey, pre = wb ? 'W' : '';
  var any = G.idx + '|' + coat + '|', ident = any + pv + '|' + (collar || '') + '|' + ns;
  var clipK = '|' + R.hb + R.clip + R.flags + '|', baseK = ident + clipK, key = pre + baseK + R.i + sfx;
  var e = gen.map.get(key), good = true;
  if (e) {
    C.hits++;
    if (exact && C.spent === 0 && R.n > 1) {           // idle budget: bake the next frame of this clip ahead of time
      var nxt = (R.i + 1) % R.n;
      if (!gen.map.has(pre + baseK + nxt + sfx)) { var keep = R.i; R.i = nxt; DA_bakeFor(gen, G, R, coat, pv, collar, ns, pre, baseK, mir); R.i = keep; }
    }
  } else if (exact && C.spent < DA_BUDGET_MS) e = DA_bakeFor(gen, G, R, coat, pv, collar, ns, pre, baseK, mir);
  else {
    good = false;
    e = DA_fallback(gen, pre + baseK, R, ident, any);
    if (e) C.falls++;
    else if (C.forced < DA_FORCE_MAX) { C.forced++; good = true; e = DA_bakeFor(gen, G, R, coat, pv, collar, ns, pre, baseK, mir); }   // nothing at all yet: bake now, budget or not
    else { C.skips++; return; }
  }
  e.tick = C.tick;
  if (C.identN > 600) { C.ident = {}; C.identN = 0; }
  if (C.ident[ident] === undefined) C.identN += 2;
  C.ident[ident] = e; C.ident[any] = e;
  var dx = Math.round(m.a * x + m.e) + R.shiver, dy = Math.round(m.d * y + m.f);
  c.setTransform(1, 0, 0, 1, 0, 0);
  DA_blit(c, e, dx, dy, kd, left);
  if (db && good) {                          // mud is a separate overlay sprite, shared across coats and collars
    var mkey = 'M' + G.idx + '|' + pv + db + clipK + R.i, me = gen.map.get(mkey + sfx);
    if (!me && exact && C.spent < DA_BUDGET_MS) me = DA_bakeMud(gen, G, R, pv, db, mkey, mir);
    if (me) { me.tick = C.tick; DA_blit(c, me, dx, dy, kd, left); }
  }
  c.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
}
// cache statistics for profiling
function DA_cacheStats() {
  var C = DA_C, n = 0, i;
  for (i = 0; i < C.gens.length; i++) n += C.gens[i].map.size;
  return { sprites: n, bytes: C.bytes, gens: C.gens.length, hits: C.hits, bakes: C.bakes, mirrors: C.mirrors, tints: C.tints, muds: C.muds, falls: C.falls, skips: C.skips, bakeMs: C.bakeMs };
}
function DA_cacheClear() { while (DA_C.gens.length) DA_dropGen(0); DA_C.bytes = 0; DA_C.seen = {}; DA_C.seenN = 0; DA_C.ident = {}; DA_C.identN = 0; }

// Standing bounds for name tags / bubbles, world px at s = 1 for a dog facing right, relative to the feet point:
// { w, h, headX, headY, topY }. The returned object is shared per breed - treat it as read-only.
function dogMetrics(d) {
  var G = DA_geom(d && d.breed);
  return G.met;
}
