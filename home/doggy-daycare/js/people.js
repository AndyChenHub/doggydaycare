'use strict';
/* ============================================================================================
   people.js - detailed human sprites for Paws & Play (the player and the dog owners).

   Exports (globals):
     drawPerson(c, p, t, look)        draw one person with the feet at (p.x, p.y); includes the ground shadow
         p = { x, y, dir: 'down'|'up'|'left'|'right', moving, walkDist, walkT, carry: null|'item'|'leash',
               emote: null|'wave'|'happy'|'angry'|'impatient'|'talk'|'pet'|'scoop'|'ring'|'sit'|'handover'|'receive',
               emoteT, id, scale }
         walkDist = world px walked so far (keeps growing); the walk cycle follows it so planted feet do not slide
         (one cycle = two steps = PA_STRIDE * look height * p.scale px, 46 px for an average adult). Without walkDist
         the cycle falls back to walkT. id should be stable per person: it keys the small start / stop smoothing.
         'handover' / 'receive': lean in with one arm held out low (handover: right hand in front view, near hand
         in side view; receive: the other hand); plays once over 0.8 s and then holds.
     randomLook(rnd)                  random owner look (plain JSON object); rnd = optional () => 0..1
     PLAYER_LOOKS / PLAYER_LOOK       four daycare attendants in uniform (each has a .name)
     personAnchor(p, look, t)         { handX, handY, headTopY, leashX, leashY } offsets from (p.x, p.y); t optional
                                      (during 'handover' / 'receive' both hand points are the outstretched hand)
     personPortraitURL(look, size, bg)  cached PNG data URL of a front-facing bust; bg = optional round backdrop colour
     prewarmPerson(look, deviceScale, maxMs)   optional: bake standing + walking sprites ahead of time
     peopleCacheStats() / peopleCacheClear()   optional: inspect / empty the sprite cache

   How it draws: the art is vector (canvas paths), but drawPerson serves it from cached bitmaps. Animation is
   quantised into repeatable frames; each (look, direction, frame) is baked once at the exact device scale of the
   context and then blitted 1:1 on whole device pixels. Looks are treated as immutable values (an equal look
   object built again later reuses the same sprites). Everything private is prefixed PA_. No assets, no DOM.
   ============================================================================================ */

var PA_OUT = '#3b2a20';          // warm dark outline
var PA_OL = 1.7;                 // outline width at scale 1
var PA_TAU = Math.PI * 2;
var PA_fx = 1;                   // +1 normally, -1 while drawing mirrored (keeps the shade side on screen-right)

// Rig proportions at scale 1 (feet at y = 0, y grows downward).
var PA_R = { rx: 10.6, ry: 10.2, TL: 21.5, hipY: -24.5, armU: 8.9, armL: 8.6, legU: 11.5, legL: 10.5, ankle: 2.5 };

// ---------- colour helpers ----------
var PA_mixCache = Object.create(null);
function PA_hex2(n) { var s = Math.max(0, Math.min(255, Math.round(n))).toString(16); return s.length < 2 ? '0' + s : s; }
function PA_rgb(h) {
  if (typeof h !== 'string' || h.charAt(0) !== '#') return [200, 160, 130];
  if (h.length === 4) h = '#' + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2) + h.charAt(3) + h.charAt(3);
  var n = parseInt(h.slice(1, 7), 16);
  if (isNaN(n)) return [200, 160, 130];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function PA_mix(a, b, f) {
  var k = a + b + f, v = PA_mixCache[k];
  if (v) return v;
  var A = PA_rgb(a), B = PA_rgb(b);
  v = '#' + PA_hex2(A[0] + (B[0] - A[0]) * f) + PA_hex2(A[1] + (B[1] - A[1]) * f) + PA_hex2(A[2] + (B[2] - A[2]) * f);
  PA_mixCache[k] = v;
  return v;
}
function PA_sh(col, f) { return PA_mix(col, '#4a2638', f === undefined ? 0.26 : f); }   // one darker, warmer tone
function PA_li(col, f) { return PA_mix(col, '#fff6dc', f === undefined ? 0.32 : f); }   // highlight tone
function PA_lum(col) { var r = PA_rgb(col); return (r[0] * 0.3 + r[1] * 0.59 + r[2] * 0.11) / 255; }
function PA_isCol(v) { return typeof v === 'string' && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v); }
function PA_col(v, d) { return PA_isCol(v) ? v : d; }
function PA_ease(x) { x = x < 0 ? 0 : x > 1 ? 1 : x; return x * x * (3 - 2 * x); }
function PA_clamp(x, a, b) { return x < a ? a : x > b ? b : x; }

// ---------- hair style table ----------
// vt / vs / vb = hair volume above, beside and behind the skull; drop = how far the side locks fall below the
// middle of the head; fringe = forehead shape; the flags add buns, tails, braids, etc.
var PA_HAIR = {
  bald:     { none: true },
  balding:  { none: true, tufts: true },
  buzz:     { vt: 0.7, vs: 0.45, vb: 0.6, drop: -0.5, fringe: 'arc', thin: true },
  short:    { vt: 2.5, vs: 1.2, vb: 1.5, drop: 0.4, fringe: 'tuft' },
  sidepart: { vt: 2.7, vs: 1.4, vb: 1.6, drop: 0.9, fringe: 'side' },
  quiff:    { vt: 4.4, vs: 1.0, vb: 1.2, drop: 0.2, fringe: 'swoop' },
  undercut: { vt: 3.6, vs: 0.9, vb: 0.9, drop: -3.6, fringe: 'side', under: true },
  bob:      { vt: 2.5, vs: 2.3, vb: 2.3, drop: 8.2, fringe: 'bangs', back: 'bob' },
  long:     { vt: 2.4, vs: 1.9, vb: 1.9, drop: 7.0, fringe: 'center', back: 'long' },
  wavy:     { vt: 2.8, vs: 2.4, vb: 2.3, drop: 7.4, fringe: 'side', back: 'wavy' },
  ponytail: { vt: 2.1, vs: 1.0, vb: 1.2, drop: 0.7, fringe: 'side', pony: true },
  bun:      { vt: 1.9, vs: 1.0, vb: 1.1, drop: 0.7, fringe: 'arc', bun: true },
  afro:     { vt: 6.0, vs: 5.0, vb: 5.2, drop: 2.4, fringe: 'curly', scallop: 13 },
  curls:    { vt: 3.4, vs: 3.0, vb: 3.0, drop: 5.2, fringe: 'curly', scallop: 9 },
  tousled:  { vt: 3.5, vs: 2.3, vb: 2.3, drop: 3.2, fringe: 'tousled', scallop: 11 },
  longwavy: { vt: 2.6, vs: 2.3, vb: 2.3, drop: 8.0, fringe: 'center', back: 'wavy' },
  braids:   { vt: 2.1, vs: 1.2, vb: 1.3, drop: 0.7, fringe: 'center', braids: true }
};

// ---------- look normalisation ----------
var PA_DEF = {
  skin: '#f1c7a3', hair: '#5a3a1e', hairStyle: 'short', age: 0, build: 'regular', height: 1, body: 0, lashes: false,
  beard: null, eye: '#33231b',
  top: 'tee', topColor: '#3aa89a', topColor2: '#fbf1d8', motif: 'plain', sleeves: null,
  bottom: 'trousers', bottomColor: '#4f6d9a', shoes: 'sneakers', shoeColor: '#d9574a',
  hat: null, hatColor: '#d9574a', glasses: null, scarf: null, bag: null, bagColor: '#a8743f',
  headphones: null, earrings: null
};
var PA_TOPS = { tee: 1, hoodie: 1, jacket: 1, shirt: 1, dress: 1, overalls: 1, cardigan: 1, raincoat: 1, sweater: 1, uniform: 1 };
var PA_normCache = (typeof WeakMap !== 'undefined') ? new WeakMap() : null;
var PA_normByJSON = Object.create(null), PA_uidNext = 1;

// Looks are treated as immutable values: the normalised form is cached per object and per JSON text, so the
// engine may keep one look object per person or rebuild an equal object every frame - both hit the same caches.
function PA_norm(look) {
  var isObj = look && typeof look === 'object', js = '';
  if (isObj && PA_normCache) { var hit = PA_normCache.get(look); if (hit) return hit; }
  if (isObj) { try { js = JSON.stringify(look); } catch (e) { js = null; } }
  if (js !== null && PA_normByJSON[js]) { if (isObj && PA_normCache) PA_normCache.set(look, PA_normByJSON[js]); return PA_normByJSON[js]; }
  var s = isObj ? look : {}, D = PA_DEF, L = {};
  L.uid = PA_uidNext++;
  L.spr = new Map();            // frame key + scale -> cached sprite
  L.frames = new Map();         // frame key -> most recent sprite at any scale
  L.lastDir = [null, null, null, null]; L.lastAny = null;
  if (js !== null) PA_normByJSON[js] = L;
  L.skin = PA_col(s.skin, D.skin);
  L.hair = PA_col(s.hair, D.hair);
  L.hairStyle = PA_HAIR[s.hairStyle] ? s.hairStyle : (typeof s.hairStyle === 'number' ? ['short', 'long', 'ponytail', 'bald'][s.hairStyle | 0] || 'short' : D.hairStyle);
  L.hs = PA_HAIR[L.hairStyle];
  L.age = s.age === 1 || s.age === 2 ? s.age : 0;
  L.build = s.build === 'slim' || s.build === 'broad' ? s.build : 'regular';
  L.height = PA_clamp(+s.height || 1, 0.8, 1.2);
  L.body = s.body ? 1 : 0;
  L.lashes = !!s.lashes;
  L.beard = (s.beard === 'stubble' || s.beard === 'moustache' || s.beard === 'beard' || s.beard === 'goatee') ? s.beard : null;
  L.eye = PA_col(s.eye, D.eye);
  L.top = PA_TOPS[s.top] ? s.top : (s.apron ? 'uniform' : D.top);
  L.topColor = PA_col(s.topColor, PA_col(s.shirt, D.topColor));
  L.topColor2 = PA_col(s.topColor2, D.topColor2);
  L.apronColor = PA_col(s.apronColor, PA_col(s.apron, '#3aa89a'));
  L.motif = typeof s.motif === 'string' ? s.motif : D.motif;
  L.bottom = (s.bottom === 'jeans' || s.bottom === 'shorts' || s.bottom === 'skirt' || s.bottom === 'leggings' || s.bottom === 'longskirt') ? s.bottom : 'trousers';
  L.bottomColor = PA_col(s.bottomColor, PA_col(s.pants, D.bottomColor));
  L.shoes = (s.shoes === 'boots' || s.shoes === 'loafers' || s.shoes === 'wellies' || s.shoes === 'sandals') ? s.shoes : 'sneakers';
  L.shoeColor = PA_col(s.shoeColor, D.shoeColor);
  L.hat = (s.hat === 'cap' || s.hat === 'beanie' || s.hat === 'sunhat') ? s.hat : (s.cap === true ? 'cap' : null);
  L.hatColor = PA_col(s.hatColor, D.hatColor);
  L.hatColor2 = PA_col(s.hatColor2, '#fbf1d8');
  L.glasses = (s.glasses === 'glasses' || s.glasses === 'sunglasses') ? s.glasses : null;
  L.glassesColor = PA_col(s.glassesColor, '#4a3a3a');
  L.scarf = PA_isCol(s.scarf) ? s.scarf : null;
  L.bag = (s.bag === 'handbag' || s.bag === 'backpack') ? s.bag : null;
  L.bagColor = PA_col(s.bagColor, D.bagColor);
  L.headphones = PA_isCol(s.headphones) ? s.headphones : (s.headphones ? '#5b6472' : null);
  L.earrings = PA_isCol(s.earrings) ? s.earrings : (s.earrings ? '#f2c14e' : null);

  // sleeves: default depends on the top
  var sl = s.sleeves;
  if (sl !== 'short' && sl !== 'long' && sl !== 'rolled' && sl !== 'none') {
    sl = (L.top === 'tee' || L.top === 'dress' || L.top === 'overalls') ? 'short' : (L.top === 'uniform' ? 'rolled' : 'long');
  }
  L.sleeves = sl;
  L.sleeveF = sl === 'none' ? 0 : sl === 'short' ? 0.33 : sl === 'rolled' ? 0.54 : 0.9;

  // derived geometry
  var bw = L.build === 'slim' ? -1 : L.build === 'broad' ? 1 : 0;
  L.SH = 8.3 + bw * 1.0 - (L.body ? 0.5 : 0);     // shoulder half width
  L.HW = 7.0 + bw * 0.9 + (L.body ? 0.3 : 0);     // hem half width
  L.WW = L.HW - (L.body ? 1.0 : 0.3) + (bw > 0 ? 0.5 : 0);   // waist half width
  L.D = 6.9 + bw * 0.8;                           // half depth in side view
  L.belly = bw > 0 ? 1.1 : 0.2;
  L.armW = 4.2 + bw * 0.5;
  L.legW = 5.9 + bw * 0.55;
  L.scale = L.height;

  // derived colours
  L.skinSh = PA_mix(L.skin, '#8a3a2a', 0.24);
  L.skinLi = PA_li(L.skin, 0.35);
  L.blush = PA_mix(L.skin, '#e8604f', 0.42);
  L.lip = PA_mix(L.skin, '#7a2a22', 0.62);
  L.hairSh = PA_sh(L.hair, 0.32);
  L.hairLi = PA_li(L.hair, PA_lum(L.hair) < 0.25 ? 0.3 : 0.42);
  L.hairDt = PA_lum(L.hair) < 0.2 ? PA_li(L.hair, 0.17) : L.hairSh;       // strand / curl lines
  L.brow = PA_lum(L.hair) > 0.5 ? PA_mix(L.hair, '#3b2a20', 0.58) : PA_sh(L.hair, 0.2);
  if (L.hs.none && !L.hs.tufts) L.brow = PA_mix(L.skin, '#3b2a20', 0.7);
  L.topSh = PA_sh(L.topColor); L.topLi = PA_li(L.topColor, 0.28);
  L.top2Sh = PA_sh(L.topColor2); 
  L.botSh = PA_sh(L.bottomColor); L.botLi = PA_li(L.bottomColor, 0.3);
  L.shoeSh = PA_sh(L.shoeColor, 0.3); L.shoeLi = PA_li(L.shoeColor, 0.4);
  L.apronSh = PA_sh(L.apronColor, 0.28); L.apronLi = PA_li(L.apronColor, 0.3);
  L.hatSh = PA_sh(L.hatColor); L.hatLi = PA_li(L.hatColor, 0.3);
  L.bagSh = PA_sh(L.bagColor); L.bagLi = PA_li(L.bagColor, 0.35);

  // what the sleeves / legs are made of
  var shirtLike = (L.top === 'overalls');
  L.sleeveCol = shirtLike ? L.topColor2 : L.topColor;
  if (L.top === 'uniform') L.sleeveCol = L.topColor;
  L.sleeveSh = PA_sh(L.sleeveCol);
  L.sleeveLi = PA_li(L.sleeveCol, 0.5);
  var skirted = L.bottom === 'skirt' || L.bottom === 'longskirt' || L.top === 'dress';
  L.skirt = skirted ? (L.bottom === 'longskirt' ? 15 : 9.5) : 0;
  L.skirtCol = L.top === 'dress' ? L.topColor : L.bottomColor;
  L.skirtSh = PA_sh(L.skirtCol); L.skirtLi = PA_li(L.skirtCol, 0.3);
  L.pelvisCol = L.top === 'overalls' ? L.topColor : (skirted ? L.skirtCol : L.bottomColor);
  L.legCol = L.skin; L.legSh = L.skinSh;
  L.pantF = 0; L.pantCol = L.top === 'overalls' ? L.topColor : L.bottomColor; L.pantSh = PA_sh(L.pantCol); L.pantLi = PA_li(L.pantCol, 0.32);
  if (!skirted) {
    L.pantF = L.bottom === 'shorts' ? 0.42 : 0.97;
    if (L.bottom === 'leggings') { L.pantF = 0; L.legCol = L.bottomColor; L.legSh = L.botSh; }
  } else if (PA_isCol(s.tights)) { L.legCol = s.tights; L.legSh = PA_sh(s.tights); }
  L.sock = PA_isCol(s.socks) ? s.socks : ((L.pantF < 0.9 && L.legCol === L.skin && L.shoes !== 'sandals' && L.shoes !== 'loafers') ? '#f7f1e3' : null);
  L.hemTop = L.top === 'raincoat' ? 8.5 : L.top === 'hoodie' ? 3.2 : L.top === 'shirt' ? 0.8 : 2.2;
  // how far the head art reaches from the centre of the head (used to size cached sprites)
  var hs = L.hs, Rx = PA_R.rx, Ry = PA_R.ry, vt = L.hat ? Math.min(hs.vt || 0, 1.2) : (hs.vt || 0), vs = hs.vs || 0, vb = hs.vb || 0, sc2 = hs.scallop && !L.hat ? 2.8 : 0;
  var bxF = Rx + Math.max(3.4, vs + 1.8 + sc2), bxB = Rx + vb + 1.8 + sc2, bxS = 13.2, byT = Ry + vt + 1.8 + sc2;
  if (hs.back === 'wavy') { bxF = Math.max(bxF, Rx + vs + 4.6); bxB = Math.max(bxB, Rx + vb + 6.6); }
  if (hs.back === 'long') { bxF = Math.max(bxF, Rx + vs + 3.4); bxB = Math.max(bxB, Rx + vb + 5.4); }
  if (hs.pony) { bxF = Math.max(bxF, 19.5); bxB = Math.max(bxB, Rx + vb + 13); }
  if (hs.braids) bxF = Math.max(bxF, Rx + 5.4);
  if (hs.bun && !L.hat) { byT = Ry + vt + 8.6; bxB = Math.max(bxB, Rx + vb + 4.2); }
  if (sc2) bxS = Math.max(bxS, Rx + vb + 1.6);
  if (L.hat === 'beanie') { bxF = Math.max(bxF, Rx + 3.2); bxB = Math.max(bxB, Rx + 4.2); bxS = Math.max(bxS, Rx + 3.4); byT = Math.max(byT, Ry + 9.4); }
  else if (L.hat === 'cap') { bxB = Math.max(bxB, Rx + 3.6); bxS = Math.max(bxS, 19.6); byT = Math.max(byT, Ry + 6.6); }
  else if (L.hat === 'sunhat') { bxF = Math.max(bxF, Rx + 8.8); bxB = Math.max(bxB, Rx + 9.6); bxS = Math.max(bxS, Rx + 8.8); byT = Math.max(byT, Ry + 6.8); }
  if (L.headphones) { bxF = Math.max(bxF, Rx + 4.8); byT = Math.max(byT, Ry + vt + 6.2); bxB = Math.max(bxB, Rx + 2); }
  L.bxF = bxF + 1.2; L.bxB = bxB + 1.2; L.bxS = bxS + 1.2; L.byT = byT + 1.2;
  if (isObj && PA_normCache) PA_normCache.set(look, L);
  return L;
}

// ============================================================================================
// FRAMES + POSE
// Animation is quantised into a small set of repeatable frames so that finished sprites can be cached:
//   PA_frame(p, t)  ->  frame descriptor F (direction, walk frame, emote frame, breath, blink ...) with F.key
//   PA_pose(F, L)   ->  joint positions for that frame (pure; used by the renderer and by personAnchor)
// All pose coordinates are in body space: origin at the feet point, scale 1, facing +x for side views.
// ============================================================================================
function PA_ik(sx, sy, tx, ty, l1, l2, bend) {
  var dx = tx - sx, dy = ty - sy, d = Math.sqrt(dx * dx + dy * dy) || 0.001, m = l1 + l2 - 0.06;
  if (d > m) { dx *= m / d; dy *= m / d; d = m; }
  var mn = Math.abs(l1 - l2) + 1.5;
  if (d < mn) { dx *= mn / d; dy *= mn / d; d = mn; }
  var a = (l1 * l1 - l2 * l2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  var ux = dx / d, uy = dy / d;
  return [sx, sy, sx + ux * a - uy * h * bend, sy + uy * a + ux * h * bend, sx + dx, sy + dy];
}
// a1 = upper segment angle, a2 = lower segment angle; 0 = straight down, positive swings toward +x
function PA_fk(sx, sy, a1, a2, l1, l2) {
  var ex = sx + l1 * Math.sin(a1), ey = sy + l1 * Math.cos(a1);
  return [sx, sy, ex, ey, ex + l2 * Math.sin(a2), ey + l2 * Math.cos(a2)];
}
function PA_lerpPts(a, b, f) {
  if (f <= 0) return a;
  if (f >= 1) return b;
  var o = [], i;
  for (i = 0; i < a.length; i++) o.push(a[i] + (b[i] - a[i]) * f);
  return o;
}

var PA_WALK_N = 8;            // frames per walk cycle (two steps)
var PA_STEP_D = 11.5;         // how far each foot reaches in front of / behind its hip (body units)
var PA_STRIDE = 4 * PA_STEP_D; // body units travelled per walk cycle: a planted foot moves back 2 * PA_STEP_D per step
var PA_WALK_PXS = 100;        // world px per second of walkT, only used when the engine gives no walkDist
var PA_DEPTH_K = 0.45;       // front / back views: how much of a step shows as up / down movement of the feet
var PA_JOG_D = 10.5;          // jog: foot reach either side of the hip
var PA_JOG_SIG = 0.32;        // jog: part of the cycle each foot is on the ground (the rest is swing; both feet are up twice per cycle)
var PA_JOG_STRIDE = 2 * PA_JOG_D / PA_JOG_SIG;   // 65.6 body units per jog cycle
var PA_JOG_ON = 172, PA_JOG_OFF = 150;           // px/s (per unit of look height) to start / stop jogging
var PA_WALK_START = 0.7;      // cycle phase a walk starts at (just before the passing pose: feet together, one lifting)
var PA_SETTLE_S = 0.12;       // after stopping mid-stride, a half-stride 'settle' frame is shown this long
// emote loops: [loop length in seconds, frames per loop, one-shot (plays once, then holds the last frame)]
var PA_EMOTES = { wave: [0.56, 6], happy: [0.84, 8], angry: [0.56, 6], impatient: [0.7, 6], talk: [1.0, 10], pet: [0.9, 8], scoop: [1.25, 8], ring: [0.4, 5], sit: [1, 1],
  handover: [0.8, 6, 1], receive: [0.8, 6, 1] };
var PA_TALK = [0.2, 0.85, 0.45, 1.0, 0.3, 0.7, 0.15, 0.9, 0.5, 0.0];
var PA_DIRS = { down: 0, up: 1, left: 2, right: 3 };

// Walk state per person (keyed by id + look), so that a walk starts from the passing pose and a stop mid-stride
// settles through a half step instead of popping. Private to this file; the engine's objects are never touched.
var PA_gait = new Map();
function PA_gaitOf(p, L, make) {
  var k = (p.id === undefined ? 'u' : String(p.id)) + ':' + L.uid, g = PA_gait.get(k);
  if (!g && make) {
    if (PA_gait.size > 400) PA_gait.clear();
    g = { mv: false, off: 0, t: -1e9, wf: 0, stopT: -1e9, v: 0, d: 0, jog: false };
    PA_gait.set(k, g);
  }
  return g;
}

// ro = read only (personAnchor): looks at the walk state without advancing it.
function PA_frame(p, t, L, ro) {
  var dir = p.dir || p.face, di = PA_DIRS[dir];
  if (di === undefined) di = 0;
  var id = +p.id || 0, moving = !!p.moving, wt = +p.walkT || 0;
  var em = (typeof p.emote === 'string' && PA_EMOTES[p.emote]) ? p.emote : null, et = Math.max(0, +p.emoteT || 0);
  var carry = p.carry ? (p.carry === 'leash' ? 2 : 1) : 0;
  var F = { di: di, view: di === 0 ? 'front' : di === 1 ? 'back' : 'side', flip: di === 2 ? -1 : 1, moving: moving, carry: carry,
    em: em, faceOnly: false, wf: 0, jog: false, settle: false, ef: 0, en: 1, ek: 1, wk: 0, br: 0, blink: 0, gaze: 0, key: '' };
  var key = '' + di, x, g = L ? PA_gaitOf(p, L, !ro) : null;
  if (moving) {
    // the cycle is driven by distance walked, so planted feet stay put on the ground at any speed
    var sc = (L ? L.scale : 1) * (p.scale > 0 ? +p.scale : 1), wd = +p.walkDist, dist = isFinite(wd) ? wd : wt * PA_WALK_PXS;
    var fresh = !g || !g.mv || t - g.t > 0.4 || t < g.t, jog = g ? g.jog : false, off = g ? g.off : id * 0.33, cyc;
    if (g && !ro) {
      // speed from the distance walked since the last frame (smoothed): a bouncy jog above PA_JOG_ON px/s
      var dt = t - g.t;
      if (fresh) { g.v = 0; jog = false; }
      else if (dt > 0.001) { var v = (dist - g.d) / dt; if (v >= 0 && v < 3000) g.v = g.v * 0.6 + v * 0.4; }
      var vs = g.v / sc, nj = vs > PA_JOG_ON ? true : vs < PA_JOG_OFF ? false : jog;
      if (fresh) { off = PA_WALK_START - dist / (PA_STRIDE * sc); }
      else if (nj !== jog) {   // switch gait at the same point of the cycle
        off = g.off + dist / ((jog ? PA_JOG_STRIDE : PA_STRIDE) * sc) - dist / ((nj ? PA_JOG_STRIDE : PA_STRIDE) * sc);
      }
      jog = nj; off -= Math.floor(off); g.off = off; g.jog = jog; g.d = dist;
    }
    cyc = dist / ((jog ? PA_JOG_STRIDE : PA_STRIDE) * sc);
    x = cyc + off; x -= Math.floor(x);
    F.wf = Math.round(x * PA_WALK_N) % PA_WALK_N;      // frame k shows phase k / N exactly (error at most 1/16 stride)
    F.jog = jog;
    if (g && !ro) { g.mv = true; g.t = t; g.wf = F.wf; }
    key += (jog ? 'j' : 'w') + F.wf;
    if (em) { F.faceOnly = true; key += em; }
  } else {
    if (g && g.mv) { if (!ro) { g.mv = false; g.jog = false; g.stopT = t - g.t < 0.4 && t >= g.t ? t : -1e9; } }
    // stopping with the legs apart: one half-stride frame, then stand
    if (g && !em && t >= g.stopT && t - g.stopT < PA_SETTLE_S && g.wf % 4 !== 2) {
      F.settle = true; F.moving = false; F.wf = g.wf;
      F.key = key + 'z' + g.wf + 'c' + carry;
      return F;
    }
    if (!em || em === 'sit') {
      var s = Math.sin(t * 2.1 + id * 1.7);
      F.br = s > 0.5 ? 1 : s < -0.5 ? -1 : 0;
      if (di !== 1) {
        if ((t + id * 1.37) % (3.3 + (id % 5) * 0.55) < 0.13) F.blink = 1;
        else if (di === 0 && !em) { var gz = Math.sin(t * 0.37 + id * 2.3); F.gaze = gz > 0.86 ? 1 : gz < -0.9 ? -1 : 0; }
      }
      key += 'i' + (F.br + 1) + F.blink + (F.gaze + 1);
    }
    if (em) {
      var E = PA_EMOTES[em], n = E[1];
      F.en = n;
      if (E[2]) {
        // one-shot: n frames over E[0] seconds, then hold the last one
        F.ef = Math.min(n - 1, Math.floor(et / E[0] * n));
        F.ek = PA_ease((F.ef + 1) / n);
        key += em + F.ef;
      } else if (et < 0.07) { F.ek = 0.5; key += em + 'h'; }
      else {
        x = (et + (id % 7) * 0.173) / E[0]; x -= Math.floor(x);
        F.ef = Math.min(n - 1, Math.floor(x * n));
        if (em === 'impatient') {
          var cyc2 = et % 4.2, wk = PA_ease(cyc2 * 4) * (1 - PA_ease((cyc2 - 2.0) * 4));
          F.wk = wk < 0.25 ? 0 : wk < 0.75 ? 0.5 : 1;
          key += em + F.ef + 'k' + (F.wk * 2);
        } else key += em + F.ef;
      }
    }
  }
  F.key = key + 'c' + carry;
  return F;
}

// One foot over the walk cycle. q = 0: heel strikes in front; 0..0.5: planted, sliding back at a constant rate
// (exactly matching the ground); 0.5..1: swing forward. Returns [x ahead of the hip, lift, shoe tilt (+ = heel up)].
// Jog: each foot is down for PA_JOG_SIG of the cycle (planted, moving back at ground speed), then the heel kicks up
// behind and the knee drives forward; both feet are off the ground between steps.
function PA_jogFoot(q) {
  var D = PA_JOG_D, s = PA_JOG_SIG;
  q -= Math.floor(q);
  if (q < s) return [D * (1 - 2 * q / s), 0, q < 0.05 ? -0.15 * (1 - q / 0.05) : q > s - 0.08 ? 0.55 * (q - s + 0.08) / 0.08 : 0];
  var u = (q - s) / (1 - s), e = u - Math.sin(PA_TAU * u) / PA_TAU;
  return [-D + 2 * D * e, 7.2 * Math.pow(Math.sin(Math.PI * Math.pow(u, 0.72)), 1.5), 0.75 * (1 - u) * (1 - u) - 0.15 * u * u];
}
// jog hip height over the ankle: dips while a foot is down, floats up between steps
function PA_jogHip(s) {
  var q = s - Math.floor(s * 2) / 2, S = PA_JOG_SIG;
  return q < S ? 19.2 - 1.5 * Math.sin(Math.PI * q / S) : 19.2 + 1.3 * Math.sin(Math.PI * (q - S) / (0.5 - S));
}
function PA_foot(q, D) {
  q -= Math.floor(q);
  if (q < 0.5) {
    var r = q < 0.07 ? -0.22 * (1 - q / 0.07) : q > 0.36 ? 0.5 * (q - 0.36) / 0.14 : 0;
    return [D * (1 - 4 * q), q > 0.36 ? 0.9 * (q - 0.36) / 0.14 : 0, r];
  }
  var u = (q - 0.5) * 2, e = u - Math.sin(PA_TAU * u) / PA_TAU;
  return [-D + 2 * D * e, 4.4 * Math.pow(Math.sin(Math.PI * Math.pow(u, 0.8)), 1.2), 0.55 * (1 - u) * (1 - u) - 0.22 * u * u];
}

function PA_pose(F, L) {
  var R = PA_R, view = F.view, em = F.em, ek = em ? F.ek : 0, u = F.ef / F.en, U = u * PA_TAU;
  var amp = F.moving ? 1 : F.settle ? 0.42 : 0, ph = F.wf / PA_WALK_N * PA_TAU, br = F.br * 0.87;
  var carry = F.carry === 1 ? 'item' : F.carry === 2 ? 'leash' : null;
  var aU = R.armU, aL = R.armL, lU = R.legU, lL = R.legL;
  var P = { view: view, flip: F.flip, amp: amp, ph: ph, em: em, carry: carry,
    hop: 0, bend: 0, lean: 0, headRot: 0, tapB: 0, sit: 0, watch: 0, armsBehind: false, armBBehind: false,
    eyes: F.blink ? 'closed' : 'open', brows: 0, mouth: 'smile', mouthOpen: 0, gaze: F.gaze * 0.55, blushK: 1 };

  // ---- emote parameters ----
  var bend = 0, sit = 0, hop = 0, lean = 0, headRot = 0, headDy = 0, headDx = 0, tap = 0, wk = 0, body = em && !F.faceOnly;
  if (em === 'wave') { P.mouth = 'open'; P.mouthOpen = 0.7; P.brows = 2; if (body) headRot += 0.06 * ek; }
  else if (em === 'happy') { P.eyes = 'happy'; P.mouth = 'open'; P.mouthOpen = 1; P.brows = 2; P.blushK = 1.5; if (body) hop = Math.abs(Math.sin(U)) * 4.6 * ek; }
  else if (em === 'angry') { P.brows = 1; P.mouth = 'frown'; P.blushK = 1.8; if (P.eyes === 'open') P.eyes = 'glare'; if (body) { tap = Math.max(0, Math.sin(U)); headDx = 0.4 * Math.sin(2 * U + 0.5) * ek; lean = 0.05 * ek; } }
  else if (em === 'impatient') {
    P.brows = 3; P.mouth = 'flat'; if (P.eyes === 'open') P.eyes = 'half';
    if (body) { wk = F.wk; tap = Math.max(0, Math.sin(U)) * (1 - wk * 0.7); headDy = 0.9 * wk; headRot += 0.07 * wk; }
  }
  else if (em === 'talk') { P.mouth = 'open'; P.brows = 2; P.mouthOpen = body ? (ek < 1 ? 0.4 : PA_TALK[F.ef % PA_TALK.length]) : PA_TALK[F.wf % PA_TALK.length]; if (body) headDy = 0.45 * Math.sin(2 * U) * ek; }
  else if (body && em === 'pet') { bend = 0.72 * ek; P.eyes = 'happy'; P.mouth = 'open'; P.mouthOpen = 0.5; }
  else if (body && em === 'scoop') { bend = 1.0 * ek; P.mouth = 'flat'; }
  else if (body && em === 'ring') { lean = 0.1 * ek; P.brows = 2; }
  else if (body && em === 'sit') { sit = ek; }
  else if (body && (em === 'handover' || em === 'receive')) { lean = 0.22 * ek; if (view !== 'side') bend = 0.14 * ek; P.brows = 2; headDy = 0.6 * ek; if (em === 'receive') P.hand = 'A'; }
  var waveWalk = em === 'wave' && !body;
  if (!body) em = null;
  if (waveWalk) { em = 'wave'; ek = 1; U = 2 * F.wf / PA_WALK_N * PA_TAU; }
  P.bend = bend; P.sit = sit; P.hop = hop; P.tapB = tap * ek; P.watch = wk * ek;

  // ---- walk cycle: leg B (screen right / near leg) strikes at phase 0, leg A half a cycle later ----
  var jog = !!F.jog && amp > 0, sB = Math.sin(ph), cB = Math.cos(ph), D = (jog ? PA_JOG_D : PA_STEP_D) * amp;
  var gB = jog ? PA_jogFoot(ph / PA_TAU) : PA_foot(ph / PA_TAU, D), gA = jog ? PA_jogFoot(ph / PA_TAU + 0.5) : PA_foot(ph / PA_TAU + 0.5, D);
  P.jog = jog;
  if (amp < 1) { gB[1] *= amp; gA[1] *= amp; gB[2] *= amp; gA[2] *= amp; }
  var stX = (ph / PA_TAU) % 1 < 0.5 ? gB[0] : gA[0], bobK = D > 0 ? (stX / D) * (stX / D) : 0;
  // hip height over the ankles: highest when the feet pass each other, lowest when both feet are down
  var hipH = amp > 0 ? 22 - 0.5 * amp - 3.0 * bobK * amp * amp : 22;
  var swB = -amp * Math.cos(ph - 0.25), swA = -swB;
  if (jog) { hipH = PA_jogHip(ph / PA_TAU); bobK = (20.5 - hipH) / 2.8; swB = -PA_clamp(gB[0] / D, -1, 1); swA = -swB; }    // arm swing (+ = forward), opposite to the leg on the same side
  if (view !== 'side') {
    // ================= FRONT / BACK =================
    var TL = R.TL * (1 - 0.3 * bend) + 0.5 * br * (1 - amp);
    var hipY = -R.ankle - hipH + bend * 4.2 + sit * 8.6 - hop;
    var shY = hipY - TL;
    var bx = amp * 0.55 * sB + headDx * 0.3;
    var SHj = L.SH - 1.0, sY = shY + 2.2;
    P.TL = TL; P.hipX = bx; P.hipY = hipY; P.shY = shY;
    P.headX = bx * 1.25 + headDx; P.headY = shY - (R.ry + 0.7) + bend * (view === 'front' ? 5.5 : 2.5) + headDy + (jog ? 0.5 * bobK : amp * 0.4 * Math.cos(2 * ph - 0.7));
    P.headRot = headRot + amp * 0.02 * sB;
    // legs
    // feet: a step forward shows as the foot moving toward the viewer (down-screen in front view, up-screen in back view)
    var kd = view === 'front' ? PA_DEPTH_K : -PA_DEPTH_K, liftB = gB[1], liftA = gA[1];
    var fAy = -R.ankle + kd * gA[0] - liftA - hop, fBy = -R.ankle + kd * gB[0] - liftB - hop;
    var sp = bend * 1.4;    // feet spread when bending
    var hjA = bx * 0.6 - 3.7, hjB = bx * 0.6 + 3.7, fAx = -3.9 - sp - 0.25 * liftA, fBx = 3.9 + sp + 0.25 * liftB;
    var legA = [hjA, hipY + 1, (hjA + fAx) * 0.5 - 0.2 * liftA - sp * 0.2, (hipY + 1 + fAy) * 0.5 + 0.3 * liftA * (view === 'front' ? 1 : -0.3), fAx, fAy];
    var legB = [hjB, hipY + 1, (hjB + fBx) * 0.5 + 0.2 * liftB + sp * 0.2, (hipY + 1 + fBy) * 0.5 + 0.3 * liftB * (view === 'front' ? 1 : -0.3), fBx, fBy];
    P.legBFirst = (fBy + liftB) < (fAy + liftA) === (view === 'front');   // the leg nearer the viewer is drawn last
    if (sit > 0) {
      legA = PA_lerpPts(legA, [-3.7, hipY + 1, -4.7, hipY + 3.6, -4.5, -R.ankle], sit);
      legB = PA_lerpPts(legB, [3.7, hipY + 1, 4.7, hipY + 3.6, 4.5, -R.ankle], sit);
    }
    P.legA = legA; P.legB = legB; P.footRotA = 0; P.footRotB = 0;
    // arms (A = screen left, B = screen right); f > 0 swings the arm forward
    // arms: the forward arm comes toward the viewer (hand in, bent elbow), the back arm swings out and up a little
    var fB = swB, fA = swA, brk = 0.25 * br * (1 - amp), tw = view === 'front' ? 1 : -1;
    var sAx = bx - SHj, sBx = bx + SHj;
    var armA = PA_ik(sAx, sY, sAx - 1.0 + (fA > 0 ? 2.4 * fA : 1.3 * fA), sY + 17.3 - (fA > 0 ? 1.4 - 0.9 * tw : 1.9) * Math.abs(fA) - brk, aU, aL, 1);
    var armB = PA_ik(sBx, sY, sBx + 1.0 - (fB > 0 ? 2.4 * fB : 1.3 * fB), sY + 17.3 - (fB > 0 ? 1.4 - 0.9 * tw : 1.9) * Math.abs(fB) - brk, aU, aL, -1);
    if (jog) {   // jogging: elbows bent, hands pumping at the waist
      armA = PA_ik(sAx, sY, sAx - 0.4 + (fA > 0 ? 3.4 * fA : 1.6 * fA), sY + 17.0 - (fA > 0 ? 2.4 - 1.2 * tw : 2.4) * Math.abs(fA), aU, aL, 1);
      armB = PA_ik(sBx, sY, sBx + 0.4 - (fB > 0 ? 3.4 * fB : 1.6 * fB), sY + 17.0 - (fB > 0 ? 2.4 - 1.2 * tw : 2.4) * Math.abs(fB), aU, aL, -1);
    }
    var eA = null, eB = null, cw = -0.5 * bobK * amp;
    if (carry === 'item') {
      armA = PA_ik(sAx, sY, bx - 3.6, shY + 13.6 + cw, aU, aL, 1);
      armB = PA_ik(sBx, sY, bx + 3.6, shY + 13.6 + cw, aU, aL, -1);
      if (view === 'back') P.armsBehind = true;
    } else if (carry === 'leash') {
      armB = PA_ik(sBx, sY, sBx + 4.6 + 0.5 * fB, sY + 14.2 + 0.6 * Math.abs(fB), aU, aL, -1);
    }
    if (em === 'wave') eB = PA_fk(sBx, sY, 2.15, 2.95 + 0.42 * Math.sin(U), aU, aL);
    else if (em === 'happy') {
      var hw = 0.16 * Math.sin(U + 0.5);
      eA = PA_fk(sAx, sY, -2.45, -2.78 - hw, aU, aL); eB = PA_fk(sBx, sY, 2.45, 2.78 + hw, aU, aL);
    } else if (em === 'angry') {
      eA = PA_ik(sAx, sY, bx - L.HW - 0.2, hipY - 6.2, aU, aL, 1); eB = PA_ik(sBx, sY, bx + L.HW + 0.2, hipY - 6.2, aU, aL, -1);
    } else if (em === 'impatient') {
      eA = PA_lerpPts(PA_ik(sAx, sY, bx - L.HW - 0.2, hipY - 6.2, aU, aL, 1), PA_ik(sAx, sY, bx + 0.8, shY + 9.5, aU, aL, 1), wk);
      eB = PA_ik(sBx, sY, bx + L.HW + 0.2, hipY - 6.2, aU, aL, -1);
    } else if (em === 'talk') {
      eB = PA_fk(sBx, sY, 0.42, 2.05 + 0.28 * Math.sin(U), aU, aL);
    } else if (em === 'pet' || em === 'scoop') {
      var st = em === 'pet' ? 1.6 * Math.sin(U) : 0.8 * Math.sin(U);
      eA = PA_ik(sAx, sY, bx - 3.4 + st, hipY + 6 + bend * 6, aU, aL, 1); eB = PA_ik(sBx, sY, bx + 3.4 + st, hipY + 6 + bend * 6, aU, aL, -1);
    } else if (em === 'ring') {
      var tp = Math.pow(Math.max(0, Math.sin(U)), 2) * 2.2;
      if (view === 'front') eB = PA_ik(sBx, sY, bx + 2.6, shY + 16.5 - tp, aU, aL, -1);
      else { eB = PA_ik(sBx, sY, sBx + 3.2, sY - 3.4 - tp, aU, aL, -1); P.armBBehind = true; }
    } else if (em === 'sit') {
      eA = PA_ik(sAx, sY, bx - 4.2, hipY - 1.2, aU, aL, 1); eB = PA_ik(sBx, sY, bx + 4.2, hipY - 1.2, aU, aL, -1);
    } else if (em === 'handover') {
      eB = view === 'front' ? PA_ik(sBx, sY, bx + 2.2, sY + 18.6, aU, aL, -1) : PA_ik(sBx, sY, sBx + 2.6, sY + 14.2, aU, aL, -1);
    } else if (em === 'receive') {
      eA = view === 'front' ? PA_ik(sAx, sY, bx - 2.2, sY + 18.6, aU, aL, 1) : PA_ik(sAx, sY, sAx - 2.6, sY + 14.2, aU, aL, 1);
    }
    if (eA) armA = PA_lerpPts(armA, eA, ek);
    if (eB) armB = PA_lerpPts(armB, eB, ek);
    P.armA = armA; P.armB = armB;
    P.sway = -amp * (jog ? 1.5 : 1.1) * Math.sin(ph + 0.9) + 0.3 * F.br * (1 - amp);
  } else {
    // ================= SIDE (facing +x) =================
    var hY = -R.ankle - hipH;
    var hX = 0, lgB, lgA;
    if (amp > 0) {
      // walking legs by IK from the foot paths (knees always bend forward)
      lgB = PA_ik(-1.3, hY, -1.3 + gB[0], -R.ankle - gB[1], lU, lL, -1);
      lgA = PA_ik(1.5, hY, 1.5 + gA[0], -R.ankle - gA[1], lU, lL, -1);
    } else {
      lgB = [-1.3, hY, -1.3, hY + lU, -1.3, hY + lU + lL]; lgA = [1.5, hY, 1.5, hY + lU, 1.5, hY + lU + lL];
    }
    P.footRotB = gB[2]; P.footRotA = gA[2];
    P.spread = 0.22 * Math.abs(gB[0] - gA[0]);
    if (bend > 0 || sit > 0) {
      var hx2, hy2, tA, tB;
      if (sit > 0) { hx2 = -3.2; hy2 = -R.ankle - lL - 1.2; tA = [hx2 + lU - 1.4, -R.ankle]; tB = [hx2 + lU - 0.2, -R.ankle]; }
      else { hx2 = -2.6 * bend; hy2 = R.hipY + 5.2 * bend; tA = [-3.2, -R.ankle]; tB = [2.8, -R.ankle]; }
      var nB = PA_ik(hx2 - 1.3, hy2, tB[0], tB[1], lU, lL, -1), nA = PA_ik(hx2 + 1.5, hy2, tA[0], tA[1], lU, lL, -1);
      var qq = sit > 0 ? sit : Math.min(1, bend * 1.4);
      lgB = PA_lerpPts(lgB, nB, qq); lgA = PA_lerpPts(lgA, nA, qq);
      hX += hx2 * qq; hY += (hy2 - hY) * qq;
      P.footRotA *= 1 - qq; P.footRotB *= 1 - qq;
    }
    if (hop) { hY -= hop; lgA[1] -= hop; lgA[3] -= hop; lgA[5] -= hop; lgB[1] -= hop; lgB[3] -= hop; lgB[5] -= hop; P.footRotA = 0.25 * ek; P.footRotB = 0.3 * ek; }
    P.legA = lgA; P.legB = lgB;
    lean += (jog ? 0.13 : 0.05) * amp + (em === 'pet' ? 0.62 * ek : em === 'scoop' ? 0.92 * ek : em === 'sit' ? -0.04 * ek : em === 'wave' ? -0.03 * ek : 0);
    var TLs = R.TL + 0.5 * br * (1 - amp);
    var sl = Math.sin(lean), cl = Math.cos(lean);
    var shX = hX + TLs * sl, shYs = hY - TLs * cl;
    var hl = lean * 0.6 + headRot;
    P.TL = TLs; P.hipX = hX; P.hipY = hY; P.lean = lean; P.shX = shX; P.shY = shYs;
    P.headX = shX + (R.ry + 0.7) * Math.sin(hl) + 0.6 + headDx; P.headY = shYs - (R.ry + 0.7) * Math.cos(hl) + headDy + (jog ? 0.5 * bobK : amp * 0.4 * Math.cos(2 * ph - 0.7));
    P.headRot = lean * 0.42 + headRot + (em === 'scoop' ? 0.12 * ek : 0);
    var sXs = hX + (TLs - 2.0) * sl, sYs = hY - (TLs - 2.0) * cl;
    // arms swing opposite to the leg on the same side; the elbow bends more on the forward swing
    var sw = 0.52 * swB, hang = 0.05, nx = sXs - 0.4, fx = sXs + 0.6;
    var armBs = PA_fk(nx, sYs, hang + sw, hang + sw + 0.16 + amp * 0.1 + 0.55 * Math.max(0, swB), aU, aL);
    var armAs = PA_fk(fx, sYs, hang - sw, hang - sw + 0.16 + amp * 0.1 + 0.55 * Math.max(0, swA), aU, aL);
    if (jog) {   // jogging: elbows bent about 80 degrees, bigger pumping swing
      armBs = PA_fk(nx, sYs, 0.1 + 0.62 * swB, 0.1 + 0.62 * swB + 1.25 + 0.25 * Math.max(0, swB), aU, aL);
      armAs = PA_fk(fx, sYs, 0.1 + 0.62 * swA, 0.1 + 0.62 * swA + 1.25 + 0.25 * Math.max(0, swA), aU, aL);
    }
    var eAs = null, eBs = null, cws = -0.5 * bobK * amp;
    if (carry === 'item') {
      armBs = PA_ik(nx, sYs, sXs + 8.6, sYs + 11.4 + cws, aU, aL, 1);
      armAs = PA_ik(fx, sYs, sXs + 9.4, sYs + 10.8 + cws, aU, aL, 1);
    } else if (carry === 'leash') {
      armBs = PA_fk(nx, sYs, 0.46 + sw * 0.25, 0.92 + sw * 0.3, aU, aL);
    }
    if (em === 'wave') eBs = PA_fk(nx, sYs, 1.85, 2.05 + 0.36 * Math.sin(U), aU, aL);
    else if (em === 'happy') {
      var hws = 0.16 * Math.sin(U + 0.5);
      eBs = PA_fk(nx, sYs, 1.75, 2.35 + hws, aU, aL); eAs = PA_fk(fx, sYs, 2.1, 2.65 - hws, aU, aL);
    } else if (em === 'angry') {
      eBs = PA_ik(nx, sYs, hX + 1.2, hY - 6.4, aU, aL, 1); eAs = PA_ik(fx, sYs, hX - 0.2, hY - 6.0, aU, aL, 1);
    } else if (em === 'impatient') {
      eBs = PA_lerpPts(PA_ik(nx, sYs, hX + 1.2, hY - 6.4, aU, aL, 1), PA_ik(nx, sYs, sXs + 7.2, sYs + 5.6, aU, aL, 1), wk);
      eAs = PA_ik(fx, sYs, hX - 0.2, hY - 6.0, aU, aL, 1);
    } else if (em === 'talk') {
      eBs = PA_fk(nx, sYs, 0.35, 1.95 + 0.28 * Math.sin(U), aU, aL);
    } else if (em === 'pet') {
      eBs = PA_ik(nx, sYs, 15.5 + 1.9 * Math.sin(U), -17.5 + 0.9 * Math.cos(U), aU, aL, 1);
      eAs = PA_fk(fx, sYs, 0.25, 0.5, aU, aL);
    } else if (em === 'scoop') {
      var sc = Math.sin(U);
      eBs = PA_ik(nx, sYs, 14.5 + 1.6 * sc, -8.5 - 0.8 * sc, aU, aL, 1); eAs = PA_ik(fx, sYs, 12.5 + 1.6 * sc, -11.5 - 0.8 * sc, aU, aL, 1);
    } else if (em === 'ring') {
      var tps = Math.pow(Math.max(0, Math.sin(U)), 2) * 2.4;
      eBs = PA_ik(nx, sYs, sXs + 14.2, sYs + 12.4 - tps, aU, aL, 1);
    } else if (em === 'sit') {
      eBs = PA_ik(nx, sYs, hX + 7.4, hY - 3.0, aU, aL, 1); eAs = PA_ik(fx, sYs, hX + 6.4, hY - 3.0, aU, aL, 1);
    } else if (em === 'handover') {
      eBs = PA_ik(nx, sYs, sXs + 10.6, sYs + 14.6, aU, aL, 1);
    } else if (em === 'receive') {
      eAs = PA_ik(fx, sYs, sXs + 11.2, sYs + 14.2, aU, aL, 1);
    }
    if (eAs) armAs = PA_lerpPts(armAs, eAs, ek);
    if (eBs) armBs = PA_lerpPts(armBs, eBs, ek);
    P.armA = armAs; P.armB = armBs;
    P.sway = -amp * (jog ? 3.2 : 2.2) - amp * 0.9 * Math.sin(2 * ph + 0.6) + 0.3 * F.br * (1 - amp);
  }
  return P;
}

// ============================================================================================
// DRAWING PRIMITIVES
// ============================================================================================
var PA_depth = 0;
function PA_save(c) { PA_depth++; c.save(); }
function PA_restore(c) { if (PA_depth > 0) { PA_depth--; c.restore(); } }
function PA_path(c, pts) {
  c.beginPath(); c.moveTo(pts[0], pts[1]);
  for (var i = 2; i < pts.length; i += 2) c.lineTo(pts[i], pts[i + 1]);
}
function PA_dot(c, x, y, r, col) { c.fillStyle = col; c.beginPath(); c.arc(x, y, r, 0, PA_TAU); c.fill(); }
function PA_line(c, x1, y1, x2, y2) { c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke(); }
function PA_ell(c, x, y, rx, ry) { c.beginPath(); c.ellipse(x, y, Math.max(0.01, rx), Math.max(0.01, ry), 0, 0, PA_TAU); }
function PA_rr(c, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  c.beginPath(); c.moveTo(x + r, y); c.lineTo(x + w - r, y); c.quadraticCurveTo(x + w, y, x + w, y + r);
  c.lineTo(x + w, y + h - r); c.quadraticCurveTo(x + w, y + h, x + w - r, y + h); c.lineTo(x + r, y + h);
  c.quadraticCurveTo(x, y + h, x, y + h - r); c.lineTo(x, y + r); c.quadraticCurveTo(x, y, x + r, y); c.closePath();
}
function PA_fs(c, fill, stroke, lw) { c.fillStyle = fill; c.fill(); if (stroke) { c.strokeStyle = stroke; c.lineWidth = lw || PA_OL; c.stroke(); } }
// part of a 3-point limb between two length fractions
function PA_sub(pts, f0, f1) {
  var ax = pts[0], ay = pts[1], bx = pts[2], by = pts[3], cx = pts[4], cy = pts[5];
  var l1 = Math.sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay)), l2 = Math.sqrt((cx - bx) * (cx - bx) + (cy - by) * (cy - by));
  var T = l1 + l2 || 1, d0 = Math.max(0, f0) * T, d1 = Math.min(1, f1) * T, out = [], k;
  if (d0 <= l1) { k = l1 ? d0 / l1 : 0; out.push(ax + (bx - ax) * k, ay + (by - ay) * k); }
  else { k = l2 ? (d0 - l1) / l2 : 0; out.push(bx + (cx - bx) * k, by + (cy - by) * k); }
  if (d0 < l1 - 0.01 && d1 > l1 + 0.01) out.push(bx, by);
  if (d1 <= l1) { k = l1 ? d1 / l1 : 0; out.push(ax + (bx - ax) * k, ay + (by - ay) * k); }
  else { k = l2 ? (d1 - l1) / l2 : 0; out.push(bx + (cx - bx) * k, by + (cy - by) * k); }
  return out;
}
// darker strip along the lower-right edge of a capsule limb
function PA_stripe(c, pts, w, col) {
  var off = w * 0.3, i, dx, dy, l, nx, ny;
  c.lineWidth = w * 0.36; c.strokeStyle = col; c.lineCap = 'round';
  c.beginPath();
  for (i = 0; i + 3 < pts.length; i += 2) {
    dx = pts[i + 2] - pts[i]; dy = pts[i + 3] - pts[i + 1]; l = Math.sqrt(dx * dx + dy * dy);
    if (l < 0.6) continue;
    nx = dy / l; ny = -dx / l;
    if (nx * PA_fx * 0.85 + ny * 0.5 < 0) { nx = -nx; ny = -ny; }
    c.moveTo(pts[i] + nx * off, pts[i + 1] + ny * off); c.lineTo(pts[i + 2] + nx * off, pts[i + 3] + ny * off);
  }
  c.stroke();
}

// ---------- arm (shoulder, elbow, hand) ----------
function PA_arm(c, L, a, watch) {
  var w = L.armW, OL = PA_OL, sl = L.sleeveF, ws = w + (sl > 0.8 ? 1.0 : 0.8), hr = w * 0.5 + 0.4;
  c.lineJoin = 'round'; c.lineCap = 'round';
  c.strokeStyle = PA_OUT; c.lineWidth = w + OL * 2; PA_path(c, a); c.stroke();
  PA_dot(c, a[4], a[5], hr + OL, PA_OUT);
  c.strokeStyle = L.skin; c.lineWidth = w; PA_path(c, a); c.stroke();
  PA_stripe(c, a, w, L.skinSh);
  PA_dot(c, a[4], a[5], hr, L.skin);
  c.fillStyle = L.skinSh; c.beginPath(); c.arc(a[4], a[5], hr, 0.15 - (PA_fx < 0 ? -1.3 : 0), 1.9 - (PA_fx < 0 ? -1.3 : 0)); c.arc(a[4] - 0.9 * PA_fx, a[5] - 0.9, hr, 1.6 - (PA_fx < 0 ? -1.3 : 0), 0.4 - (PA_fx < 0 ? -1.3 : 0), true); c.fill();
  if (watch > 0.02) {
    c.lineCap = 'butt'; c.strokeStyle = '#4a3a3a'; c.lineWidth = w + 0.7; PA_path(c, PA_sub(a, 0.8, 0.9)); c.stroke();
    var wp = PA_sub(a, 0.85, 0.85); PA_dot(c, wp[0], wp[1], 1.7, '#f2c14e'); PA_dot(c, wp[0], wp[1], 1.0, '#fbf1d8');
  }
  if (sl > 0) {
    c.lineCap = 'butt';
    c.strokeStyle = PA_OUT; c.lineWidth = ws + OL * 2; PA_path(c, PA_sub(a, 0, sl + 0.05)); c.stroke();
    PA_dot(c, a[0], a[1], ws / 2 + OL, PA_OUT);
    c.strokeStyle = L.sleeveCol; c.lineWidth = ws; PA_path(c, PA_sub(a, 0, sl)); c.stroke();
    PA_dot(c, a[0], a[1], ws / 2, L.sleeveCol);
    c.lineCap = 'butt';
    PA_stripe(c, PA_sub(a, 0.02, sl - 0.05), ws, L.sleeveSh);
    c.lineCap = 'butt';
    if (L.sleeves === 'rolled') {
      c.strokeStyle = L.sleeveLi; c.lineWidth = ws + 0.9; PA_path(c, PA_sub(a, sl - 0.1, sl)); c.stroke();
      c.strokeStyle = L.sleeveSh; c.lineWidth = ws + 0.9; PA_path(c, PA_sub(a, sl - 0.115, sl - 0.09)); c.stroke();
    } else if (L.sleeves === 'long') {
      c.strokeStyle = L.sleeveSh; c.lineWidth = ws; PA_path(c, PA_sub(a, sl - 0.075, sl - 0.045)); c.stroke();
    } else {
      c.strokeStyle = L.sleeveSh; c.lineWidth = ws; PA_path(c, PA_sub(a, sl - 0.05, sl - 0.025)); c.stroke();
    }
  }
}

// ---------- leg (hip, knee, ankle) ----------
function PA_leg(c, L, g) {
  var w = L.legW, OL = PA_OL, pf = L.pantF, wp = w + 0.9, full = pf > 0.9;
  c.lineJoin = 'round'; c.lineCap = 'butt';
  c.strokeStyle = PA_OUT; c.lineWidth = (full ? wp : w) + OL * 2; PA_path(c, g); c.stroke();
  PA_dot(c, g[0], g[1], (full ? wp : w) / 2 + OL, PA_OUT);
  if (!full) {
    c.strokeStyle = L.legCol; c.lineWidth = w; PA_path(c, g); c.stroke();
    PA_dot(c, g[0], g[1], w / 2, L.legCol);
    PA_stripe(c, PA_sub(g, 0, 0.9), w, L.legSh);
    if (L.sock) {
      c.lineCap = 'butt'; c.strokeStyle = L.sock; c.lineWidth = w + 0.3; PA_path(c, PA_sub(g, 0.8, 1)); c.stroke();
      c.strokeStyle = PA_sh(L.sock, 0.3); c.lineWidth = w + 0.3; PA_path(c, PA_sub(g, 0.79, 0.82)); c.stroke();
    }
  }
  if (pf > 0) {
    c.lineCap = 'butt';
    if (full) {
      c.strokeStyle = L.pantCol; c.lineWidth = wp; PA_path(c, g); c.stroke();
      PA_dot(c, g[0], g[1], wp / 2, L.pantCol);
      PA_stripe(c, PA_sub(g, 0, 0.9), wp, L.pantSh);
      c.lineCap = 'butt';
      if (L.bottom === 'jeans') {
        c.strokeStyle = L.pantLi; c.lineWidth = wp; PA_path(c, PA_sub(g, 0.82, 1)); c.stroke();
        c.strokeStyle = L.pantSh; c.lineWidth = wp; PA_path(c, PA_sub(g, 0.8, 0.83)); c.stroke();
      }
    } else {
      var ws = wp + 1.2;
      c.strokeStyle = PA_OUT; c.lineWidth = ws + OL * 2; PA_path(c, PA_sub(g, 0, pf + 0.06)); c.stroke();
      PA_dot(c, g[0], g[1], ws / 2 + OL, PA_OUT);
      c.strokeStyle = L.pantCol; c.lineWidth = ws; PA_path(c, PA_sub(g, 0, pf)); c.stroke();
      PA_dot(c, g[0], g[1], ws / 2, L.pantCol);
      PA_stripe(c, PA_sub(g, 0, pf - 0.05), ws, L.pantSh);
      c.lineCap = 'butt'; c.strokeStyle = L.pantLi; c.lineWidth = ws; PA_path(c, PA_sub(g, pf - 0.085, pf - 0.03)); c.stroke();
    }
  }
}

// ---------- shoes. (x, y) is the ankle; the ground is PA_R.ankle below it ----------
function PA_shoe(c, L, x, y, view, rot, tap) {
  var kind = L.shoes, col = L.shoeColor, sh = L.shoeSh, li = L.shoeLi, lw = L.legW;
  var sole = kind === 'sneakers' ? '#f7f1e3' : kind === 'sandals' ? '#7a4e2a' : PA_sh(col, 0.55);
  var shaft = kind === 'boots' ? 5.2 : kind === 'wellies' ? 8.2 : 0, hw = lw / 2 + 0.7;
  PA_save(c);
  c.translate(x, y);
  c.lineJoin = 'round'; c.lineCap = 'round';
  if (view === 'side') {
    if (rot) c.rotate(rot);
    if (tap) { c.translate(-2.5, 2.5); c.rotate(-0.34 * tap); c.translate(2.5, -2.5); }
    c.beginPath();
    if (shaft) { c.moveTo(-hw, -shaft - 1.6); c.lineTo(hw - 0.6, -shaft - 1.6); c.lineTo(hw - 0.2, -1.8); }
    else { c.moveTo(-hw + 0.3, -2.1); c.lineTo(hw - 1.4, -2.1); }
    c.bezierCurveTo(3.2, -0.9, 7.0, -0.7, 7.2, 1.5);
    c.quadraticCurveTo(7.2, 2.6, 6.0, 2.6); c.lineTo(-2.7, 2.6); c.quadraticCurveTo(-3.8, 2.6, -3.7, 1.3);
    c.closePath();
    c.fillStyle = kind === 'sandals' ? L.skin : col; c.fill();
    // shade at the heel side
    c.strokeStyle = sole; c.lineWidth = 1.3; PA_line(c, -3.0, 2.0, 6.3, 2.0);
    if (kind === 'sneakers') {
      c.strokeStyle = '#f7f1e3'; c.lineWidth = 1.2; c.beginPath(); c.moveTo(4.4, 1.3); c.quadraticCurveTo(4.0, -0.2, 5.4, -0.4); c.stroke();
      c.lineWidth = 0.9; PA_line(c, 1.2, -1.3, 2.4, -0.2); 
      c.strokeStyle = sh; c.lineWidth = 1; PA_line(c, -2.6, -0.3, -2.9, 1.0);
    } else if (kind === 'boots') {
      c.strokeStyle = li; c.lineWidth = 1.4; PA_line(c, -hw + 0.7, -shaft - 0.6, hw - 1.2, -shaft - 0.6);
      c.strokeStyle = sh; c.lineWidth = 0.9; PA_line(c, 1.2, -3.6, 2.3, -3.2); PA_line(c, 1.4, -2.0, 2.6, -1.5);
    } else if (kind === 'wellies') {
      c.strokeStyle = li; c.lineWidth = 1.3; PA_line(c, -hw + 0.7, -shaft - 0.4, hw - 1.2, -shaft - 0.4);
      c.lineWidth = 1; PA_line(c, -1.6, -shaft + 1.6, -1.6, -2.5);
    } else if (kind === 'loafers') {
      c.strokeStyle = li; c.lineWidth = 1.1; c.beginPath(); c.moveTo(1.6, -1.3); c.quadraticCurveTo(3.0, -1.3, 4.0, -0.2); c.stroke();
    } else if (kind === 'sandals') {
      c.strokeStyle = col; c.lineWidth = 1.5; PA_line(c, 3.2, -0.4, 4.4, 1.4); PA_line(c, -2.2, -1.6, 0.6, -1.2);
    }
    c.beginPath();
    if (shaft) { c.moveTo(-hw, -shaft - 1.6); c.lineTo(hw - 0.6, -shaft - 1.6); c.lineTo(hw - 0.2, -1.8); }
    else { c.moveTo(-hw + 0.3, -2.1); c.lineTo(hw - 1.4, -2.1); }
    c.bezierCurveTo(3.2, -0.9, 7.0, -0.7, 7.2, 1.5);
    c.quadraticCurveTo(7.2, 2.6, 6.0, 2.6); c.lineTo(-2.7, 2.6); c.quadraticCurveTo(-3.8, 2.6, -3.7, 1.3);
    c.closePath(); c.strokeStyle = PA_OUT; c.lineWidth = PA_OL; c.stroke();
  } else {
    var back = view === 'back', k = back ? 0.9 : 1, ty = tap ? -1.3 * tap : 0;
    var top = shaft ? -shaft - 1.4 : -1.6;
    var blob = function () {
      c.beginPath();
      c.moveTo(-hw * k, top);
      if (shaft) c.lineTo(-hw * k, -1.2);
      c.bezierCurveTo(-3.9 * k, 1.0 + ty * 0.3, -3.5 * k, 3.1 + ty, 0, 3.1 + ty);
      c.bezierCurveTo(3.5 * k, 3.1 + ty, 3.9 * k, 1.0 + ty * 0.3, hw * k, shaft ? -1.2 : top);
      if (shaft) c.lineTo(hw * k, top);
      if (shaft) c.lineTo(-hw * k, top); else c.quadraticCurveTo(0, top - 1.0, -hw * k, top);
      c.closePath();
    };
    blob();
    c.fillStyle = kind === 'sandals' ? L.skin : col; c.fill();
    c.strokeStyle = sole; c.lineWidth = 1.3; c.beginPath(); c.moveTo(-2.9 * k, 2.0 + ty * 0.8); c.quadraticCurveTo(0, 3.2 + ty, 2.9 * k, 2.0 + ty * 0.8); c.stroke();
    if (!back) {
      if (kind === 'sneakers') {
        c.strokeStyle = '#f7f1e3'; c.lineWidth = 1.2; c.beginPath(); c.moveTo(-2.3, 1.2 + ty); c.quadraticCurveTo(0, -0.4 + ty, 2.3, 1.2 + ty); c.stroke();
        c.lineWidth = 0.9; PA_line(c, -1.1, -0.9, 1.1, -0.9);
      } else if (kind === 'boots') {
        c.strokeStyle = li; c.lineWidth = 1.4; PA_line(c, -hw + 0.8, top + 1.0, hw - 0.8, top + 1.0);
        c.strokeStyle = sh; c.lineWidth = 0.9; PA_line(c, -1.1, -3.4, 1.1, -3.4); PA_line(c, -1.1, -1.8, 1.1, -1.8);
        c.strokeStyle = sh; c.lineWidth = 1; c.beginPath(); c.moveTo(-2.4, 0.9 + ty); c.quadraticCurveTo(0, -0.4 + ty, 2.4, 0.9 + ty); c.stroke();
      } else if (kind === 'wellies') {
        c.strokeStyle = li; c.lineWidth = 1.3; PA_line(c, -hw + 0.8, top + 1.1, hw - 0.8, top + 1.1);
        c.lineWidth = 1; PA_line(c, -1.5, top + 3, -1.5, -1.5);
      } else if (kind === 'loafers') {
        PA_ell(c, 0, -1.5, 2.0, 1.1); c.fillStyle = L.legCol; c.fill();
        c.strokeStyle = li; c.lineWidth = 1.1; PA_line(c, -1.8, 0.3, 1.8, 0.3);
      } else if (kind === 'sandals') {
        c.strokeStyle = col; c.lineWidth = 1.5; PA_line(c, -3.0, -0.6, 3.0, -0.6); PA_line(c, -2.6, 1.2 + ty, 2.6, 1.2 + ty);
      }
    } else {
      c.strokeStyle = kind === 'sandals' ? col : sh; c.lineWidth = 1.1; PA_line(c, 0, top + 0.8, 0, 1.2);
      if (shaft) { c.strokeStyle = li; c.lineWidth = 1.3; PA_line(c, -hw * k + 0.8, top + 1.0, hw * k - 0.8, top + 1.0); }
    }
    blob(); c.strokeStyle = PA_OUT; c.lineWidth = PA_OL; c.stroke();
  }
  PA_restore(c);
}

// ---------- small motifs ----------
function PA_heart(c, x, y, s) {
  c.beginPath(); c.moveTo(x, y + s * 0.95);
  c.bezierCurveTo(x - s * 1.5, y - s * 0.1, x - s * 0.55, y - s * 1.1, x, y - s * 0.3);
  c.bezierCurveTo(x + s * 0.55, y - s * 1.1, x + s * 1.5, y - s * 0.1, x, y + s * 0.95); c.closePath();
}
function PA_star(c, x, y, s) {
  c.beginPath();
  for (var i = 0; i < 10; i++) { var a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? s * 0.46 : s; if (i) c.lineTo(x + r * Math.cos(a), y + r * Math.sin(a)); else c.moveTo(x + r * Math.cos(a), y + r * Math.sin(a)); }
  c.closePath();
}
function PA_paw(c, x, y, s, col) {
  c.fillStyle = col;
  PA_ell(c, x, y + s * 0.45, s * 0.95, s * 0.78); c.fill();
  PA_ell(c, x - s * 1.05, y - s * 0.35, s * 0.4, s * 0.5); c.fill();
  PA_ell(c, x - s * 0.38, y - s * 0.95, s * 0.4, s * 0.52); c.fill();
  PA_ell(c, x + s * 0.38, y - s * 0.95, s * 0.4, s * 0.52); c.fill();
  PA_ell(c, x + s * 1.05, y - s * 0.35, s * 0.4, s * 0.5); c.fill();
}

// ============================================================================================
// TORSO, front and back views. Local origin = hip centre, shoulders at y = -TL.
// ============================================================================================
function PA_torsoPathF(c, L, TL, hem, flare) {
  var SH = L.SH, HW = L.HW + flare, WW = L.WW + flare * 0.4, y0 = -TL;
  c.beginPath();
  c.moveTo(-3.2, y0 - 1.7); c.lineTo(3.2, y0 - 1.7);
  c.quadraticCurveTo(SH - 0.6, y0 - 1.5, SH, y0 + 2.4);
  c.bezierCurveTo(SH + 0.2, y0 + 8, WW, -TL * 0.5, WW, -TL * 0.32);
  c.bezierCurveTo(WW, -TL * 0.16, HW, -4, HW, hem - 1.6);
  c.quadraticCurveTo(HW, hem, HW - 1.6, hem);
  c.lineTo(-HW + 1.6, hem);
  c.quadraticCurveTo(-HW, hem, -HW, hem - 1.6);
  c.bezierCurveTo(-HW, -4, -WW, -TL * 0.16, -WW, -TL * 0.32);
  c.bezierCurveTo(-WW, -TL * 0.5, -SH - 0.2, y0 + 8, -SH, y0 + 2.4);
  c.quadraticCurveTo(-SH + 0.6, y0 - 1.5, -3.2, y0 - 1.7);
  c.closePath();
}

function PA_pelvisFB(c, L, back) {
  var w = L.HW - 0.1;
  PA_rr(c, -w, -4, w * 2, 8.2, 3.2); PA_fs(c, L.pelvisCol, PA_OUT, PA_OL);
  if (L.pantF > 0) {
    c.strokeStyle = L.pantSh; c.lineWidth = 1; c.lineCap = 'round';
    PA_line(c, 0, back ? -1 : 0.5, 0, 3.6);
    if (back && L.pantF > 0) { c.lineWidth = 0.9; PA_rr(c, -w + 1.6, -1.4, 3.2, 3.2, 0.8); c.stroke(); PA_rr(c, w - 4.8, -1.4, 3.2, 3.2, 0.8); c.stroke(); }
  }
}

function PA_skirtFB(c, L, len, sway) {
  var HW = L.HW, bw = HW + 2.2 + len * 0.16, s = sway * 0.7;
  var path = function () {
    c.beginPath(); c.moveTo(-HW - 0.1, -4.2); c.lineTo(HW + 0.1, -4.2);
    c.bezierCurveTo(HW + 1.2, 0, bw + s, len - 3, bw + s, len);
    c.quadraticCurveTo(bw * 0.5 + s, len + 1.9, s, len + 0.7);
    c.quadraticCurveTo(-bw * 0.5 + s, len + 1.9, -bw + s, len);
    c.bezierCurveTo(-bw + s, len - 3, -HW - 1.2, 0, -HW - 0.1, -4.2); c.closePath();
  };
  PA_save(c);
  path(); c.fillStyle = L.skirtCol; c.fill(); c.clip();
  c.fillStyle = L.skirtSh; c.beginPath(); c.moveTo(HW - 2.4, -5); c.quadraticCurveTo(HW - 0.6, len * 0.5, bw - 3.4 + s, len + 3); c.lineTo(bw + 4, len + 3); c.lineTo(bw + 4, -5); c.closePath(); c.fill();
  c.fillStyle = L.skirtSh; c.beginPath(); c.moveTo(-bw - 2, len - 1.2); c.quadraticCurveTo(s, len + 0.4, bw + 2, len - 1.2); c.lineTo(bw + 2, len + 4); c.lineTo(-bw - 2, len + 4); c.closePath(); c.globalAlpha = 0.55; c.fill(); c.globalAlpha = 1;
  c.strokeStyle = L.skirtSh; c.lineWidth = 1; c.lineCap = 'round';
  c.beginPath(); c.moveTo(-2.6, -1); c.quadraticCurveTo(-3.4, len * 0.5, -bw * 0.48 + s, len + 0.6); c.moveTo(2.6, -1); c.quadraticCurveTo(3.4, len * 0.5, bw * 0.48 + s, len + 0.6); c.stroke();
  c.strokeStyle = L.skirtLi; c.lineWidth = 1.1; c.beginPath(); c.moveTo(-HW + 1.2, -1.5); c.quadraticCurveTo(-HW + 0.2, len * 0.4, -bw + 2.4 + s, len - 2.5); c.stroke();
  PA_restore(c);
  path(); c.strokeStyle = PA_OUT; c.lineWidth = PA_OL; c.lineJoin = 'round'; c.stroke();
}

function PA_torsoFB(c, L, P, back) {
  var TL = P.TL, y0 = -TL, hem = L.hemTop, SH = L.SH, HW = L.HW, WW = L.WW, top = L.top;
  var col = L.topColor, sh = L.topSh, li = L.topLi, c2 = L.topColor2, flare = top === 'raincoat' ? 1.3 : 0;
  var wy = -TL * 0.33, i, base = top === 'overalls' ? c2 : col, baseSh = top === 'overalls' ? L.top2Sh : sh;
  c.lineJoin = 'round'; c.lineCap = 'round';
  PA_save(c);
  PA_torsoPathF(c, L, TL, hem, flare);
  c.fillStyle = base; c.fill(); c.clip();
  // pattern layers that sit under the shading
  if ((top === 'tee' || top === 'sweater' || top === 'dress') && L.motif === 'stripes') {
    c.fillStyle = c2;
    for (i = 0; i < 4; i++) c.fillRect(-SH - 2, y0 + 3.4 + i * 5.2 * (TL / 23.5), SH * 2 + 4, 2.3);
  }
  if (top === 'sweater' && L.motif !== 'stripes') {
    c.fillStyle = c2; c.fillRect(-SH - 2, y0 + 6.2, SH * 2 + 4, 4.6);
    c.strokeStyle = col; c.lineWidth = 1.1; c.beginPath();
    for (i = -5; i <= 5; i++) { if (i === -5) c.moveTo(i * 2.2, y0 + 9.6); else c.lineTo(i * 2.2, y0 + (i % 2 ? 7.4 : 9.6)); }
    c.stroke();
  }
  if (top === 'overalls') {
    c.fillStyle = col; c.fillRect(-SH - 2, wy - 0.5, SH * 2 + 4, 30);
    if (!back) { PA_rr(c, -5.0, y0 + 6.4, 10, wy - y0 - 4, 1.6); c.fill(); }
    else { c.beginPath(); c.moveTo(-3.4, wy); c.lineTo(0, y0 + 8); c.lineTo(3.4, wy); c.closePath(); c.fill(); }
  }
  if ((top === 'jacket' || top === 'cardigan') && !back) {
    c.fillStyle = c2; c.beginPath();
    if (top === 'jacket') { c.moveTo(-3.3, y0 - 2); c.lineTo(3.3, y0 - 2); c.lineTo(2.0, hem + 1); c.lineTo(-2.0, hem + 1); }
    else { c.moveTo(-3.6, y0 - 2); c.lineTo(3.6, y0 - 2); c.lineTo(0.5, wy - 2.5); c.lineTo(-0.5, wy - 2.5); }
    c.closePath(); c.fill();
    if (top === 'jacket' && L.motif === 'pinstripe') {
      c.strokeStyle = '#3d4854'; c.lineWidth = 0.65;
      PA_line(c, -1.6, y0 - 1, -1.3, hem); PA_line(c, 0, y0 - 1, 0, hem); PA_line(c, 1.6, y0 - 1, 1.3, hem);
    }
  }
  // shading: right side and under the chin
  c.fillStyle = baseSh;
  c.beginPath(); c.moveTo(SH + 3, y0 - 3); c.lineTo(SH - 3.0, y0 + 3.5); c.quadraticCurveTo(WW - 3.2, -TL * 0.4, HW + flare - 2.6, hem + 1); c.lineTo(SH + 5, hem + 1); c.closePath();
  c.globalAlpha = top === 'overalls' ? 0.5 : 1; c.fill(); c.globalAlpha = 1;
  if (!back) { c.globalAlpha = 0.32; PA_ell(c, 0.5, y0 - 1.0, 4.6, 2.6); c.fill(); c.globalAlpha = 1; }
  c.lineCap = 'round';
  // per-outfit detail
  if (top === 'tee') {
    if (!back) {
      if (L.motif === 'heart') { PA_heart(c, 0, y0 + 9.5, 2.6); c.fillStyle = c2; c.fill(); }
      else if (L.motif === 'star') { PA_star(c, 0, y0 + 9.8, 3.2); c.fillStyle = c2; c.fill(); }
      else if (L.motif === 'paw') { PA_paw(c, 0, y0 + 9.6, 2.0, c2); }
      else if (L.motif === 'pocket') { c.strokeStyle = sh; c.lineWidth = 1; PA_rr(c, 1.6, y0 + 6.2, 3.6, 3.8, 0.9); c.stroke(); }
      else if (L.motif === 'band') { c.fillStyle = c2; c.fillRect(-SH - 2, y0 + 7.2, SH * 2 + 4, 3.4); }
    }
    c.strokeStyle = sh; c.lineWidth = 1; PA_line(c, -HW + 1, hem - 1.9, HW - 1, hem - 1.9);
  } else if (top === 'hoodie') {
    c.strokeStyle = sh; c.lineWidth = 1.1;
    if (!back) {
      c.beginPath(); c.moveTo(-4.6, -3.2); c.lineTo(-3.4, -9.2); c.lineTo(3.4, -9.2); c.lineTo(4.6, -3.2); c.stroke();
      c.fillStyle = li; c.globalAlpha = 0.35; c.beginPath(); c.moveTo(-4.6, -3.2); c.lineTo(-3.4, -9.2); c.lineTo(3.4, -9.2); c.lineTo(4.6, -3.2); c.closePath(); c.fill(); c.globalAlpha = 1;
    }
    c.strokeStyle = sh; PA_line(c, -HW - 1, hem - 2.6, HW + 1, hem - 2.6);
    for (i = -2; i <= 2; i++) PA_line(c, i * 2.6, hem - 2.2, i * 2.6, hem);
  } else if (top === 'jacket') {
    c.strokeStyle = sh; c.lineWidth = 1.1;
    if (!back) {
      PA_line(c, -2.7, y0 + 6, -2.0, hem); PA_line(c, 2.7, y0 + 6, 2.0, hem);
      // lapels
      c.fillStyle = li; c.strokeStyle = PA_sh(col, 0.5); c.lineWidth = 1;
      c.beginPath(); c.moveTo(-3.3, y0 - 1.9); c.lineTo(-6.0, y0 + 1.8); c.lineTo(-2.5, y0 + 7.2); c.lineTo(-1.6, y0 + 2.4); c.closePath(); c.fill(); c.stroke();
      c.beginPath(); c.moveTo(3.3, y0 - 1.9); c.lineTo(6.0, y0 + 1.8); c.lineTo(2.5, y0 + 7.2); c.lineTo(1.6, y0 + 2.4); c.closePath(); c.fill(); c.stroke();
      c.strokeStyle = sh; c.lineWidth = 1.1; PA_line(c, -HW + 1.2, -5.4, -HW + 4.2, -5.0); PA_line(c, HW - 1.2, -5.4, HW - 4.2, -5.0);
      c.fillStyle = PA_sh(c2, 0.2); c.strokeStyle = L.top2Sh; c.lineWidth = 0.9; PA_line(c, 0, y0 + 7, 0, hem);
    } else {
      PA_line(c, 0, y0 + 3, 0, hem); c.beginPath(); c.moveTo(-SH, y0 + 5.5); c.quadraticCurveTo(0, y0 + 7.5, SH, y0 + 5.5); c.stroke();
    }
    PA_line(c, -HW - 1, hem - 2.2, HW + 1, hem - 2.2);
  } else if (top === 'shirt') {
    c.strokeStyle = sh; c.lineWidth = 1;
    if (!back) {
      PA_line(c, 0, y0 + 2, 0, hem);
      // tie
      c.fillStyle = c2; c.strokeStyle = L.top2Sh; c.lineWidth = 0.9;
      c.beginPath(); c.moveTo(-0.9, y0 + 2.6); c.lineTo(0.9, y0 + 2.6); c.lineTo(1.9, -8.0); c.lineTo(0, -5.6); c.lineTo(-1.9, -8.0); c.closePath(); c.fill(); c.stroke();
      c.strokeStyle = sh; c.lineWidth = 1; PA_rr(c, 2.6, y0 + 6.6, 3.2, 3.2, 0.8); c.stroke();
    } else { c.beginPath(); c.moveTo(-SH, y0 + 5); c.quadraticCurveTo(0, y0 + 7, SH, y0 + 5); c.stroke(); PA_line(c, 0, y0 + 6.4, 0, y0 + 11); }
    // belt
    c.fillStyle = '#6b4327'; c.fillRect(-HW - 1, hem - 2.4, HW * 2 + 2, 2.6);
    if (!back) { c.fillStyle = '#f2c14e'; c.fillRect(-1.3, hem - 2.5, 2.6, 2.6); c.fillStyle = '#6b4327'; c.fillRect(-0.5, hem - 1.7, 1, 1); }
  } else if (top === 'dress') {
    if (!back && L.motif === 'heart') { PA_heart(c, 0, y0 + 8.8, 2.2); c.fillStyle = c2; c.fill(); }
    c.fillStyle = c2; c.fillRect(-HW - 2, wy - 1.2, HW * 2 + 4, 2.6);
    c.fillStyle = L.top2Sh; c.fillRect(WW - 2.6, wy - 1.2, 6, 2.6);
    if (back) { c.strokeStyle = sh; c.lineWidth = 1; PA_line(c, 0, y0 + 1, 0, wy - 1.5); }
  } else if (top === 'overalls') {
    var dsh = sh;
    c.strokeStyle = dsh; c.lineWidth = 1;
    if (!back) {
      PA_rr(c, -5.0, y0 + 6.4, 10, wy - y0 - 4, 1.6); c.stroke();
      PA_rr(c, -2.5, y0 + 9.2, 5, 3.6, 0.8); c.stroke();
      // straps
      c.strokeStyle = PA_sh(col, 0.5); c.lineWidth = 3.4; PA_line(c, -4.0, y0 + 7, -4.9, y0 - 2); PA_line(c, 4.0, y0 + 7, 4.9, y0 - 2);
      c.strokeStyle = col; c.lineWidth = 2.2; PA_line(c, -4.0, y0 + 7, -4.9, y0 - 2); PA_line(c, 4.0, y0 + 7, 4.9, y0 - 2);
      PA_dot(c, -3.9, y0 + 7.6, 1.15, '#f2c14e'); PA_dot(c, 3.9, y0 + 7.6, 1.15, '#f2c14e');
    } else {
      c.strokeStyle = PA_sh(col, 0.5); c.lineWidth = 3.4; PA_line(c, -5.0, y0 - 2, 1.2, wy - 2); PA_line(c, 5.0, y0 - 2, -1.2, wy - 2);
      c.strokeStyle = col; c.lineWidth = 2.2; PA_line(c, -5.0, y0 - 2, 1.2, wy - 2); PA_line(c, 5.0, y0 - 2, -1.2, wy - 2);
    }
    c.strokeStyle = dsh; c.lineWidth = 1; PA_line(c, -HW - 1, wy - 0.4, -5, wy - 0.4); PA_line(c, 5, wy - 0.4, HW + 1, wy - 0.4);
    c.fillStyle = sh; c.globalAlpha = 0.55; c.fillRect(WW - 2.4, wy - 0.5, 8, 30); c.globalAlpha = 1;
  } else if (top === 'cardigan') {
    if (!back) {
      c.strokeStyle = li; c.lineWidth = 1.5; c.beginPath(); c.moveTo(-3.8, y0 - 1.6); c.lineTo(-0.6, wy - 2.2); c.lineTo(-0.6, hem); c.moveTo(3.8, y0 - 1.6); c.lineTo(0.6, wy - 2.2); c.lineTo(0.6, hem); c.stroke();
      c.strokeStyle = sh; c.lineWidth = 0.9; PA_line(c, 0, wy - 2.4, 0, hem);
      for (i = 0; i < 3; i++) PA_dot(c, 1.9, wy - 0.6 + i * 3.4, 0.85, c2);
      c.strokeStyle = sh; c.lineWidth = 1; PA_rr(c, -HW + 1.4, -5.2, 3.4, 3.0, 0.7); c.stroke(); PA_rr(c, HW - 4.8, -5.2, 3.4, 3.0, 0.7); c.stroke();
    }
    c.strokeStyle = sh; c.lineWidth = 1; PA_line(c, -HW - 1, hem - 2.2, HW + 1, hem - 2.2);
    for (i = -2; i <= 2; i++) if (back || i) PA_line(c, i * 2.6 + (back ? 0 : 0.0), hem - 1.9, i * 2.6, hem);
  } else if (top === 'raincoat') {
    c.strokeStyle = sh; c.lineWidth = 1.1;
    if (!back) {
      PA_line(c, -0.6, y0 + 1, -0.6, hem);
      for (i = 0; i < 3; i++) { PA_dot(c, 1.7, y0 + 6.5 + i * 6.4, 1.15, PA_sh(col, 0.55)); }
      c.strokeStyle = sh; c.beginPath(); c.moveTo(-HW + 0.6, -1.6); c.lineTo(-HW + 4.6, -1.2); c.moveTo(HW - 0.6, -1.6); c.lineTo(HW - 4.6, -1.2); c.stroke();
    } else { PA_line(c, 0, y0 + 8, 0, hem); }
    c.strokeStyle = li; c.lineWidth = 1.2; PA_line(c, -SH + 2.0, y0 + 4, -WW + 1.4, wy);
  } else if (top === 'sweater') {
    c.strokeStyle = sh; c.lineWidth = 1; PA_line(c, -HW - 1, hem - 2.4, HW + 1, hem - 2.4);
    for (i = -2; i <= 2; i++) PA_line(c, i * 2.6, hem - 2.1, i * 2.6, hem);
  } else if (top === 'uniform') {
    var ap = L.apronColor, aps = L.apronSh;
    if (!back) {
      c.strokeStyle = sh; c.lineWidth = 1; PA_line(c, 0, y0 + 1.5, 0, y0 + 7);
      // neck strap
      c.strokeStyle = aps; c.lineWidth = 3.0; PA_line(c, -3.9, y0 + 7, -4.2, y0 - 2); PA_line(c, 3.9, y0 + 7, 4.2, y0 - 2);
      c.strokeStyle = ap; c.lineWidth = 1.8; PA_line(c, -3.9, y0 + 7, -4.2, y0 - 2); PA_line(c, 3.9, y0 + 7, 4.2, y0 - 2);
      // bib
      c.beginPath(); c.moveTo(-4.6, y0 + 6.2); c.lineTo(4.6, y0 + 6.2); c.lineTo(5.6, wy + 1); c.lineTo(HW + 2, wy + 1); c.lineTo(HW + 2, hem + 2); c.lineTo(-HW - 2, hem + 2); c.lineTo(-HW - 2, wy + 1); c.lineTo(-5.6, wy + 1); c.closePath();
      c.fillStyle = ap; c.fill();
      c.fillStyle = aps; c.beginPath(); c.moveTo(2.8, y0 + 6.2); c.lineTo(4.6, y0 + 6.2); c.lineTo(5.6, wy + 1); c.lineTo(HW + 2, wy + 1); c.lineTo(HW + 2, hem + 2); c.lineTo(HW - 2.8, hem + 2); c.quadraticCurveTo(WW - 3, wy, 3.4, wy - 2); c.closePath(); c.fill();
      c.strokeStyle = PA_sh(ap, 0.5); c.lineWidth = 1.1;
      c.beginPath(); c.moveTo(-5.6, wy + 1); c.lineTo(-4.6, y0 + 6.2); c.lineTo(4.6, y0 + 6.2); c.lineTo(5.6, wy + 1); c.stroke();
      c.strokeStyle = L.apronLi; c.lineWidth = 0.9; PA_line(c, -3.6, y0 + 7.5, 3.6, y0 + 7.5);
      PA_paw(c, 0, y0 + 6.2 + (wy - y0 - 6.2) * 0.52, 1.75, '#fbf1d8');
      c.strokeStyle = PA_sh(ap, 0.5); c.lineWidth = 1.1; PA_line(c, -HW - 1, wy + 1.2, HW + 1, wy + 1.2);
    } else {
      c.strokeStyle = sh; c.lineWidth = 1; c.beginPath(); c.moveTo(-SH, y0 + 5); c.quadraticCurveTo(0, y0 + 7, SH, y0 + 5); c.stroke();
      // apron ties across the back
      c.strokeStyle = aps; c.lineWidth = 3.0; PA_line(c, -HW - 1, wy + 1, HW + 1, wy + 1);
      c.strokeStyle = ap; c.lineWidth = 1.8; PA_line(c, -HW - 1, wy + 1, HW + 1, wy + 1);
      c.strokeStyle = aps; c.lineWidth = 2.8; c.beginPath(); c.moveTo(-3.4, y0 - 2); c.quadraticCurveTo(0, y0 + 2.6, 3.4, y0 - 2); c.stroke();
      c.strokeStyle = ap; c.lineWidth = 1.6; c.beginPath(); c.moveTo(-3.4, y0 - 2); c.quadraticCurveTo(0, y0 + 2.6, 3.4, y0 - 2); c.stroke();
    }
  }
  PA_restore(c);
  PA_torsoPathF(c, L, TL, hem, flare); c.strokeStyle = PA_OUT; c.lineWidth = PA_OL; c.lineJoin = 'round'; c.stroke();
  // parts that hang outside the torso silhouette
  if (top === 'uniform') {
    var ap2 = L.apronColor, he = 8.0;
    if (!back) {
      var skirt = function () {
        c.beginPath(); c.moveTo(-HW - 0.9, wy + 1.2); c.lineTo(HW + 0.9, wy + 1.2); c.lineTo(HW + 1.9, he - 2.2);
        c.quadraticCurveTo(HW + 1.9, he, HW - 0.4, he); c.lineTo(-HW + 0.4, he); c.quadraticCurveTo(-HW - 1.9, he, -HW - 1.9, he - 2.2); c.closePath();
      };
      PA_save(c); skirt(); c.fillStyle = ap2; c.fill(); c.clip();
      c.fillStyle = L.apronSh; c.beginPath(); c.moveTo(HW - 2.2, wy); c.lineTo(HW - 1.6, he + 1); c.lineTo(HW + 4, he + 1); c.lineTo(HW + 4, wy); c.closePath(); c.fill();
      c.fillRect(-HW - 3, he - 1.5, HW * 2 + 6, 3);
      PA_restore(c);
      c.lineCap = 'round'; c.lineJoin = 'round';
      PA_rr(c, -4.0, wy + 4.4, 8.0, 5.6, 1.4); c.fillStyle = L.apronLi; c.globalAlpha = 0.45; c.fill(); c.globalAlpha = 1; c.strokeStyle = PA_sh(ap2, 0.5); c.lineWidth = 1.1; c.stroke();
      c.lineWidth = 0.9; PA_line(c, 0, wy + 4.6, 0, wy + 9.8);
      c.strokeStyle = L.apronLi; c.lineWidth = 1; PA_line(c, -HW + 0.2, wy + 2.6, HW - 1.6, wy + 2.6);
      skirt(); c.strokeStyle = PA_OUT; c.lineWidth = PA_OL; c.stroke();
    } else {
      // bow
      c.fillStyle = ap2; c.strokeStyle = PA_OUT; c.lineWidth = 1.2;
      c.beginPath(); c.moveTo(0, wy + 1); c.quadraticCurveTo(-5.2, wy - 3, -4.6, wy + 1.4); c.quadraticCurveTo(-3.6, wy + 3.6, 0, wy + 1); c.closePath(); c.fill(); c.stroke();
      c.beginPath(); c.moveTo(0, wy + 1); c.quadraticCurveTo(5.2, wy - 3, 4.6, wy + 1.4); c.quadraticCurveTo(3.6, wy + 3.6, 0, wy + 1); c.closePath(); c.fill(); c.stroke();
      c.strokeStyle = PA_OUT; c.lineWidth = 3.4; c.beginPath(); c.moveTo(-0.3, wy + 1.5); c.quadraticCurveTo(-1.4, wy + 5, -2.2 + P.sway * 0.5, wy + 8); c.moveTo(0.3, wy + 1.5); c.quadraticCurveTo(1.4, wy + 5, 2.4 + P.sway * 0.5, wy + 7.2); c.stroke();
      c.strokeStyle = ap2; c.lineWidth = 1.7; c.beginPath(); c.moveTo(-0.3, wy + 1.5); c.quadraticCurveTo(-1.4, wy + 5, -2.2 + P.sway * 0.5, wy + 8); c.moveTo(0.3, wy + 1.5); c.quadraticCurveTo(1.4, wy + 5, 2.4 + P.sway * 0.5, wy + 7.2); c.stroke();
      PA_dot(c, 0, wy + 1, 1.9, PA_OUT); PA_dot(c, 0, wy + 1, 1.1, L.apronSh);
      // the apron edges peeking round the sides
      c.fillStyle = ap2; c.strokeStyle = PA_OUT; c.lineWidth = 1.3;
      c.beginPath(); c.moveTo(-HW - 0.6, wy + 2); c.lineTo(-HW - 1.7, he - 2); c.quadraticCurveTo(-HW - 1.6, he, -HW + 0.6, he); c.lineTo(-HW + 1.2, wy + 2.6); c.closePath(); c.fill(); c.stroke();
      c.fillStyle = L.apronSh;
      c.beginPath(); c.moveTo(HW + 0.6, wy + 2); c.lineTo(HW + 1.7, he - 2); c.quadraticCurveTo(HW + 1.6, he, HW - 0.6, he); c.lineTo(HW - 1.2, wy + 2.6); c.closePath(); c.fill(); c.stroke();
    }
  }
  if (L.bag === 'handbag') {
    // cross-body strap
    var sx = back ? 1 : -1;
    c.lineCap = 'round';
    c.strokeStyle = PA_OUT; c.lineWidth = 3.0; PA_line(c, sx * (SH - 2.6), y0 - 1, -sx * (HW - 0.4), -3.5);
    c.strokeStyle = L.bagSh; c.lineWidth = 1.5; PA_line(c, sx * (SH - 2.6), y0 - 1, -sx * (HW - 0.4), -3.5);
  } else if (L.bag === 'backpack' && !back) {
    c.lineCap = 'round';
    c.strokeStyle = PA_OUT; c.lineWidth = 3.6; PA_line(c, -SH + 2.2, y0 - 0.6, -SH + 1.6, y0 + 9.5); PA_line(c, SH - 2.2, y0 - 0.6, SH - 1.6, y0 + 9.5);
    c.strokeStyle = L.bagColor; c.lineWidth = 2.0; PA_line(c, -SH + 2.2, y0 - 0.6, -SH + 1.6, y0 + 9.5);
    c.strokeStyle = L.bagSh; PA_line(c, SH - 2.2, y0 - 0.6, SH - 1.6, y0 + 9.5);
  }
}

// handbag body at the hip (front/back views), local origin = hip centre
function PA_bagFB(c, L, P, back) {
  var sx = back ? -1 : 1, x = sx * (L.HW + 0.6), y = -4.2 + 0.5 * Math.sin(P.ph * 2) * P.amp;
  PA_rr(c, x - 4.2, y, 8.4, 7.2, 2.2); PA_fs(c, L.bagColor, PA_OUT, PA_OL);
  c.fillStyle = L.bagSh; PA_rr(c, x + 1.4, y + 0.8, 2.2, 5.6, 1); c.fill();
  c.beginPath(); c.moveTo(x - 4.2, y + 1.4); c.quadraticCurveTo(x, y + 5.2, x + 4.2, y + 1.4); c.strokeStyle = PA_sh(L.bagColor, 0.5); c.lineWidth = 1.1; c.stroke();
  PA_dot(c, x, y + 3.5, 1.0, '#f2c14e');
}
function PA_backpackBack(c, L, P) {
  var y0 = -P.TL, b = 0.4 * Math.sin(P.ph * 2 + 1) * P.amp;
  PA_rr(c, -6.8, y0 + 1.2 + b, 13.6, 15.6, 4.2); PA_fs(c, L.bagColor, PA_OUT, PA_OL);
  c.fillStyle = L.bagSh; c.beginPath(); c.moveTo(3.6, y0 + 2 + b); c.quadraticCurveTo(6.2, y0 + 3, 6.0, y0 + 8 + b); c.lineTo(6.0, y0 + 13 + b); c.quadraticCurveTo(5.6, y0 + 16 + b, 3.0, y0 + 16 + b); c.quadraticCurveTo(4.6, y0 + 9 + b, 3.6, y0 + 2 + b); c.fill();
  PA_rr(c, -4.4, y0 + 8.4 + b, 8.8, 6.2, 1.8); c.fillStyle = L.bagLi; c.fill(); c.strokeStyle = PA_sh(L.bagColor, 0.5); c.lineWidth = 1.1; c.stroke();
  c.strokeStyle = PA_sh(L.bagColor, 0.5); c.lineWidth = 1.1; c.beginPath(); c.moveTo(-5.4, y0 + 5.6 + b); c.quadraticCurveTo(0, y0 + 3.6 + b, 5.4, y0 + 5.6 + b); c.stroke();
  PA_dot(c, 0, y0 + 4.7 + b, 0.9, '#f2c14e');
  c.strokeStyle = PA_OUT; c.lineWidth = 1.3; c.beginPath(); c.moveTo(-1.8, y0 + 1.4 + b); c.quadraticCurveTo(0, y0 - 1.4 + b, 1.8, y0 + 1.4 + b); c.stroke();
}

// ============================================================================================
// TORSO, side view (facing +x). Local origin = hip centre, rotated by the lean.
// ============================================================================================
function PA_torsoPathS(c, L, TL, hem, flare) {
  var D = L.D, y0 = -TL, be = L.belly;
  c.beginPath();
  c.moveTo(-2.9, y0 - 1.7); c.lineTo(2.4, y0 - 1.7);
  c.quadraticCurveTo(D - 0.4, y0 - 1.2, D + 0.2, y0 + 3.4);
  c.bezierCurveTo(D + 0.9 + be * 0.3, -TL * 0.62, D + be, -TL * 0.3, D + flare * 0.6, -2.5);
  c.lineTo(D + flare, hem - 1.6);
  c.quadraticCurveTo(D + flare, hem, D + flare - 1.6, hem);
  c.lineTo(-D - flare + 1.6, hem);
  c.quadraticCurveTo(-D - flare, hem, -D - flare, hem - 1.6);
  c.lineTo(-D - flare * 0.6, -2.5);
  c.bezierCurveTo(-D - 0.1, -TL * 0.4, -D - 0.6, -TL * 0.75, -D + 0.3, y0 + 2.8);
  c.quadraticCurveTo(-D + 0.9, y0 - 1.2, -2.9, y0 - 1.7);
  c.closePath();
}
function PA_pelvisS(c, L) {
  var D = L.D - 0.1;
  PA_rr(c, -D, -4, D * 2, 8, 3.2); PA_fs(c, L.pelvisCol, PA_OUT, PA_OL);
}
function PA_skirtS(c, L, len, sway, spread) {
  // spread: how far apart the legs are mid-stride; the hem flares out over them (more for longer skirts)
  var D = L.D, bw = D + 1.6 + len * 0.12, s = sway * 0.55, sp = (spread || 0) * len / 15, fw = bw + sp, bk = bw + sp * 0.8;
  var path = function () {
    c.beginPath(); c.moveTo(-D - 0.1, -4.2); c.lineTo(D + 0.1, -4.2);
    c.bezierCurveTo(D + 1.0, 0, fw + s * 0.4, len - 3, fw + s * 0.5, len);
    c.quadraticCurveTo(s, len + 1.8, -bk + s, len + 0.2);
    c.bezierCurveTo(-bk + s * 0.8, len - 3, -D - 1.0, 0, -D - 0.1, -4.2); c.closePath();
  };
  PA_save(c);
  path(); c.fillStyle = L.skirtCol; c.fill(); c.clip();
  c.fillStyle = L.skirtSh;
  if (PA_fx > 0) c.fillRect(D - 2.2, -5, 12, len + 10); else c.fillRect(-D - 10, -5, 12.2 - 2.2 + 2.2, len + 10);
  c.globalAlpha = 0.55; c.fillRect(-bw - 4, len - 1.2, bw * 2 + 8, 5); c.globalAlpha = 1;
  c.strokeStyle = L.skirtSh; c.lineWidth = 1; c.lineCap = 'round';
  c.beginPath(); c.moveTo(-0.6, -1); c.quadraticCurveTo(-1, len * 0.5, -bw * 0.3 + s * 0.8, len + 1); c.stroke();
  PA_restore(c);
  path(); c.strokeStyle = PA_OUT; c.lineWidth = PA_OL; c.lineJoin = 'round'; c.stroke();
}

function PA_torsoS(c, L, P) {
  var TL = P.TL, y0 = -TL, hem = L.hemTop, D = L.D, top = L.top, col = L.topColor, sh = L.topSh, li = L.topLi, c2 = L.topColor2;
  var flare = top === 'raincoat' ? 1.2 : 0, wy = -TL * 0.33, i, sx = PA_fx;
  var base = top === 'overalls' ? c2 : col, baseSh = top === 'overalls' ? L.top2Sh : sh;
  c.lineJoin = 'round'; c.lineCap = 'round';
  PA_save(c);
  PA_torsoPathS(c, L, TL, hem, flare);
  c.fillStyle = base; c.fill(); c.clip();
  if ((top === 'tee' || top === 'sweater' || top === 'dress') && L.motif === 'stripes') {
    c.fillStyle = c2;
    for (i = 0; i < 4; i++) c.fillRect(-D - 3, y0 + 3.4 + i * 5.2, D * 2 + 6, 2.3);
  }
  if (top === 'tee' && L.motif === 'band') { c.fillStyle = c2; c.fillRect(-D - 3, y0 + 7.2, D * 2 + 6, 3.4); }
  if (top === 'sweater' && L.motif !== 'stripes') {
    c.fillStyle = c2; c.fillRect(-D - 3, y0 + 6.2, D * 2 + 6, 4.6);
    c.strokeStyle = col; c.lineWidth = 1.1; c.beginPath();
    for (i = -4; i <= 4; i++) { if (i === -4) c.moveTo(i * 2.2, y0 + 9.6); else c.lineTo(i * 2.2, y0 + (i % 2 ? 7.4 : 9.6)); }
    c.stroke();
  }
  if (top === 'overalls') {
    c.fillStyle = col; c.fillRect(-D - 3, wy - 0.5, D * 2 + 6, 30);
    c.fillRect(D - 3.2, y0 + 6.4, 8, wy - y0);
  }
  if (top === 'jacket') { c.fillStyle = c2; c.fillRect(D - 1.5, y0 - 3, 6, TL + 10); }
  if (top === 'cardigan') { c.fillStyle = c2; c.beginPath(); c.moveTo(1.5, y0 - 3); c.lineTo(D + 3, y0 - 3); c.lineTo(D + 3, wy); c.lineTo(D - 0.6, wy - 1); c.closePath(); c.fill(); }
  // shading on the side away from the light
  c.fillStyle = baseSh; c.globalAlpha = top === 'overalls' ? 0.5 : 1;
  c.beginPath(); c.moveTo(sx * (D - 3.0), y0 - 3); c.quadraticCurveTo(sx * (D - 1.6), -TL * 0.5, sx * (D - 3.2), hem + 1); c.lineTo(sx * (D + 6), hem + 1); c.lineTo(sx * (D + 6), y0 - 3); c.closePath(); c.fill();
  c.globalAlpha = 1;
  if (top === 'tee') {
    c.strokeStyle = sh; c.lineWidth = 1; PA_line(c, -D - 1, hem - 1.9, D + 1, hem - 1.9);
  } else if (top === 'hoodie') {
    c.strokeStyle = sh; c.lineWidth = 1.1;
    c.beginPath(); c.moveTo(D + 1, -9.2); c.quadraticCurveTo(D - 3.8, -9.0, D - 3.2, -3.2); c.lineTo(D + 1, -3.2); c.stroke();
    PA_line(c, -D - 2, hem - 2.6, D + 2, hem - 2.6);
    for (i = -2; i <= 2; i++) PA_line(c, i * 2.4, hem - 2.2, i * 2.4, hem);
  } else if (top === 'jacket') {
    c.strokeStyle = PA_sh(col, 0.5); c.lineWidth = 1; PA_line(c, D - 1.5, y0 + 5, D - 1.5, hem);
    c.fillStyle = li; c.beginPath(); c.moveTo(2.2, y0 - 2); c.lineTo(D + 0.6, y0 + 1.8); c.lineTo(D - 1.4, y0 + 7.4); c.lineTo(0.8, y0 + 2.4); c.closePath(); c.fill(); c.stroke();
    c.strokeStyle = sh; c.lineWidth = 1.1; PA_line(c, -1.6, -5.2, 1.8, -5.0);
    PA_line(c, -D - 2, hem - 2.2, D + 2, hem - 2.2);
  } else if (top === 'shirt') {
    c.fillStyle = c2; c.beginPath(); c.moveTo(D - 1.0, y0 + 2.4); c.lineTo(D + 3, y0 + 2.4); c.lineTo(D + 3, -7.6); c.lineTo(D - 1.6, -7.0); c.closePath(); c.fill();
    c.strokeStyle = L.top2Sh; c.lineWidth = 0.9; c.beginPath(); c.moveTo(D - 1.0, y0 + 2.4); c.lineTo(D - 1.6, -7.0); c.lineTo(D + 3, -7.6); c.stroke();
    c.fillStyle = '#6b4327'; c.fillRect(-D - 2, hem - 2.4, D * 2 + 4, 2.6);
    c.fillStyle = '#f2c14e'; c.fillRect(D - 1.4, hem - 2.5, 3, 2.6);
  } else if (top === 'dress') {
    c.fillStyle = c2; c.fillRect(-D - 2, wy - 1.2, D * 2 + 4, 2.6);
  } else if (top === 'overalls') {
    c.strokeStyle = sh; c.lineWidth = 1; PA_line(c, D - 3.2, y0 + 6.4, D - 3.2, wy - 0.5); PA_line(c, D - 3.2, y0 + 6.4, D + 2, y0 + 6.4);
    PA_line(c, -D - 2, wy - 0.4, D - 3.2, wy - 0.4);
    c.strokeStyle = PA_sh(col, 0.5); c.lineWidth = 3.4; c.beginPath(); c.moveTo(D - 2.4, y0 + 7.2); c.quadraticCurveTo(0, y0 - 9.5, -D + 1.4, y0 + 7.4); c.stroke();
    c.strokeStyle = col; c.lineWidth = 2.2; c.beginPath(); c.moveTo(D - 2.4, y0 + 7.2); c.quadraticCurveTo(0, y0 - 9.5, -D + 1.4, y0 + 7.4); c.stroke();
    c.lineWidth = 2.2; PA_line(c, -D + 1.4, y0 + 7.4, -D + 0.6, wy);
    PA_dot(c, D - 2.2, y0 + 7.8, 1.15, '#f2c14e');
    c.fillStyle = sh; c.globalAlpha = 0.5; if (sx > 0) c.fillRect(D - 2.4, wy - 0.5, 8, 30); else c.fillRect(-D - 6, wy - 0.5, 8.4, 30); c.globalAlpha = 1;
  } else if (top === 'cardigan') {
    c.strokeStyle = li; c.lineWidth = 1.5; c.beginPath(); c.moveTo(1.5, y0 - 2); c.lineTo(D - 0.8, wy - 1); c.lineTo(D - 0.9, hem); c.stroke();
    PA_dot(c, D - 2.6, wy + 1.4, 0.85, c2); PA_dot(c, D - 2.6, wy + 4.8, 0.85, c2);
    c.strokeStyle = sh; c.lineWidth = 1; PA_line(c, -D - 2, hem - 2.2, D + 2, hem - 2.2);
    for (i = -2; i <= 1; i++) PA_line(c, i * 2.4, hem - 1.9, i * 2.4, hem);
    PA_rr(c, -1.8, -5.2, 3.4, 3.0, 0.7); c.stroke();
  } else if (top === 'raincoat') {
    c.strokeStyle = sh; c.lineWidth = 1.1; PA_line(c, D - 1.8, y0 + 2, D - 1.2 + flare, hem);
    PA_dot(c, D - 3.4, y0 + 8, 1.1, PA_sh(col, 0.55)); PA_dot(c, D - 3.2, y0 + 14.4, 1.1, PA_sh(col, 0.55));
    PA_line(c, -2, -1.6, 2, -1.2);
  } else if (top === 'sweater') {
    c.strokeStyle = sh; c.lineWidth = 1; PA_line(c, -D - 2, hem - 2.4, D + 2, hem - 2.4);
    for (i = -2; i <= 2; i++) PA_line(c, i * 2.4, hem - 2.1, i * 2.4, hem);
  } else if (top === 'uniform') {
    var ap = L.apronColor, aps = L.apronSh;
    c.strokeStyle = aps; c.lineWidth = 3.0; PA_line(c, D - 1.8, y0 + 7, 1.4, y0 - 2.5);
    c.strokeStyle = ap; c.lineWidth = 1.8; PA_line(c, D - 1.8, y0 + 7, 1.4, y0 - 2.5);
    c.fillStyle = ap; c.beginPath(); c.moveTo(D - 3.0, y0 + 6.2); c.lineTo(D + 3, y0 + 6.2); c.lineTo(D + 3, hem + 2); c.lineTo(-D - 3, hem + 2); c.lineTo(-D - 3, wy + 3); c.lineTo(-0.6, wy + 1); c.lineTo(D - 3.4, wy + 1); c.closePath(); c.fill();
    c.fillStyle = ap; c.fillRect(-D - 3, wy, D * 2 + 6, 2.0);
    if (sx > 0) { c.fillStyle = aps; c.fillRect(D - 1.8, y0 + 6.2, 6, TL + 10); }
    c.strokeStyle = PA_sh(ap, 0.5); c.lineWidth = 1.1; c.beginPath(); c.moveTo(D + 2, y0 + 6.2); c.lineTo(D - 3.0, y0 + 6.2); c.lineTo(D - 3.4, wy + 1); c.stroke();
    PA_line(c, -D - 2, wy + 2.0, -0.4, wy + 2.0); PA_line(c, -D - 2, wy, D - 3.4, wy);
  }
  PA_restore(c);
  PA_torsoPathS(c, L, TL, hem, flare); c.strokeStyle = PA_OUT; c.lineWidth = PA_OL; c.lineJoin = 'round'; c.stroke();
  if (top === 'uniform') {
    var ap2 = L.apronColor, he = 8.0;
    // bow at the back
    c.fillStyle = ap2; c.strokeStyle = PA_OUT; c.lineWidth = 1.2;
    c.beginPath(); c.moveTo(-D + 0.3, wy + 1); c.quadraticCurveTo(-D - 4.6, wy - 3.2, -D - 4.2, wy + 0.6); c.quadraticCurveTo(-D - 3.6, wy + 2.8, -D + 0.3, wy + 1); c.closePath(); c.fill(); c.stroke();
    c.strokeStyle = PA_OUT; c.lineWidth = 3.3; c.beginPath(); c.moveTo(-D, wy + 1.4); c.quadraticCurveTo(-D - 1.6, wy + 4.5, -D - 2.4 + P.sway * 0.6, wy + 7.6); c.stroke();
    c.strokeStyle = ap2; c.lineWidth = 1.7; c.beginPath(); c.moveTo(-D, wy + 1.4); c.quadraticCurveTo(-D - 1.6, wy + 4.5, -D - 2.4 + P.sway * 0.6, wy + 7.6); c.stroke();
    // the apron skirt wrapping the front half
    var skirt = function () {
      c.beginPath(); c.moveTo(-1.2, wy + 1.2); c.lineTo(D + 0.8, wy + 1.2); c.lineTo(D + 1.7, he - 2.2);
      c.quadraticCurveTo(D + 1.7, he, D - 0.4, he); c.lineTo(0.2, he); c.quadraticCurveTo(-1.0, he, -1.0, he - 2); c.closePath();
    };
    skirt(); c.fillStyle = ap2; c.fill();
    c.fillStyle = L.apronSh; if (sx > 0) { c.beginPath(); c.moveTo(D - 1.6, wy + 1.2); c.lineTo(D + 0.8, wy + 1.2); c.lineTo(D + 1.7, he - 2.2); c.quadraticCurveTo(D + 1.7, he, D - 0.4, he); c.lineTo(D - 1.2, he); c.closePath(); c.fill(); }
    c.strokeStyle = PA_sh(ap2, 0.5); c.lineWidth = 1.1; c.beginPath(); c.moveTo(D + 1.2, wy + 4.6); c.lineTo(1.6, wy + 4.6); c.lineTo(1.6, wy + 9.4); c.quadraticCurveTo(1.8, wy + 10, 2.6, wy + 10); c.lineTo(D + 1.4, wy + 10); c.stroke();
    skirt(); c.strokeStyle = PA_OUT; c.lineWidth = PA_OL; c.stroke();
  }
}

function PA_bagS(c, L, P) {
  var sx = P.shX - P.hipX, sy = P.shY - P.hipY, b = 0.5 * Math.sin(P.ph * 2) * P.amp, x = -1.2 + sx * 0.75, y = -4.6 + b + (sy + P.TL) * 0.8;
  c.lineCap = 'round';
  c.strokeStyle = PA_OUT; c.lineWidth = 3.0; PA_line(c, sx + 0.6, sy - 0.4, x + 0.5, y + 1);
  c.strokeStyle = L.bagSh; c.lineWidth = 1.5; PA_line(c, sx + 0.6, sy - 0.4, x + 0.5, y + 1);
  PA_rr(c, x - 4.4, y, 8.8, 7.2, 2.2); PA_fs(c, L.bagColor, PA_OUT, PA_OL);
  c.beginPath(); c.moveTo(x - 4.4, y + 1.4); c.quadraticCurveTo(x, y + 5.2, x + 4.4, y + 1.4); c.strokeStyle = PA_sh(L.bagColor, 0.5); c.lineWidth = 1.1; c.stroke();
  PA_dot(c, x, y + 3.5, 1.0, '#f2c14e');
}
function PA_backpackS(c, L, P, strap) {
  var y0 = -P.TL, D = L.D, b = 0.4 * Math.sin(P.ph * 2 + 1) * P.amp;
  if (!strap) {
    PA_rr(c, -D - 6.4, y0 + 1.4 + b, 8.4, 15.4, 3.6); PA_fs(c, L.bagColor, PA_OUT, PA_OL);
    c.fillStyle = PA_fx > 0 ? L.bagLi : L.bagSh; PA_rr(c, -D - 5.6, y0 + 3 + b, 2.0, 11.6, 1); c.fill();
    c.strokeStyle = PA_sh(L.bagColor, 0.5); c.lineWidth = 1.1; PA_line(c, -D - 6.2, y0 + 8.2 + b, -D - 1, y0 + 8.2 + b);
  } else {
    c.lineCap = 'round';
    c.strokeStyle = PA_OUT; c.lineWidth = 3.6; c.beginPath(); c.moveTo(-D + 0.6, y0 + 1.2); c.quadraticCurveTo(2.2, y0 - 2.2, 2.4, y0 + 4.5); c.quadraticCurveTo(2.2, y0 + 9, -D + 0.8, y0 + 11); c.stroke();
    c.strokeStyle = L.bagColor; c.lineWidth = 2.0; c.beginPath(); c.moveTo(-D + 0.6, y0 + 1.2); c.quadraticCurveTo(2.2, y0 - 2.2, 2.4, y0 + 4.5); c.quadraticCurveTo(2.2, y0 + 9, -D + 0.8, y0 + 11); c.stroke();
  }
}

// ============================================================================================
// NECK + COLLARS (drawn between torso and head)
// ============================================================================================
function PA_neckFront(c, L, P, hx, hy) {   // torso-local; hx, hy = head centre
  var y0 = -P.TL, top = L.top;
  var nd = top === 'dress' ? 4.4 : top === 'cardigan' || top === 'jacket' ? 3.6 : top === 'sweater' || top === 'raincoat' ? 2.2 : 3.0;
  c.beginPath(); c.moveTo(hx - 2.9, hy + 6); c.lineTo(-2.9, y0 - 1.4); c.quadraticCurveTo(-2.9, y0 - 1.7 + nd, 0, y0 - 1.7 + nd);
  c.quadraticCurveTo(2.9, y0 - 1.7 + nd, 2.9, y0 - 1.4); c.lineTo(hx + 2.9, hy + 6);
  c.fillStyle = L.skinSh; c.fill(); c.strokeStyle = PA_OUT; c.lineWidth = 1.25; c.lineJoin = 'round'; c.stroke();
}
function PA_neckLine(c, L, x1, y1, x2, y2) {   // simple neck for back / side views
  c.lineCap = 'butt'; c.strokeStyle = PA_OUT; c.lineWidth = 5.6 + PA_OL * 2; PA_line(c, x1, y1, x2, y2);
  c.strokeStyle = L.skinSh; c.lineWidth = 5.6; PA_line(c, x1, y1, x2, y2);
}
function PA_scarfFB(c, L, P, back) {
  var y0 = -P.TL, col = L.scarf, sh = PA_sh(col), li = PA_li(col, 0.45), sw = P.sway * 0.5, tx = back ? 2.2 : -5.6, i;
  c.lineJoin = 'round';
  // tail
  c.beginPath(); c.moveTo(tx, y0 + 1.0); c.lineTo(tx + 4.0, y0 + 1.0); c.lineTo(tx + 4.4 + sw, y0 + 11.6); c.lineTo(tx - 0.2 + sw, y0 + 11.6); c.closePath();
  PA_fs(c, col, PA_OUT, 1.4);
  c.strokeStyle = li; c.lineWidth = 1.3; PA_line(c, tx + 0.5 + sw * 0.7, y0 + 8.4, tx + 3.8 + sw * 0.7, y0 + 8.4);
  c.strokeStyle = PA_OUT; c.lineWidth = 0.9; for (i = 1; i < 3; i++) PA_line(c, tx + i * 1.45 + sw, y0 + 10.2, tx + i * 1.45 + sw, y0 + 11.6);
  // wrap
  c.beginPath(); c.moveTo(-6.9, y0 - 2.4); c.quadraticCurveTo(0, y0 - 4.8 + (back ? 0 : 1.8), 6.9, y0 - 2.4); c.quadraticCurveTo(8.5, y0 + 0.6, 6.4, y0 + 2.9);
  c.quadraticCurveTo(0, y0 + 5.9, -6.4, y0 + 2.9); c.quadraticCurveTo(-8.5, y0 + 0.6, -6.9, y0 - 2.4); c.closePath();
  PA_fs(c, col, PA_OUT, 1.5);
  c.strokeStyle = sh; c.lineWidth = 1; c.beginPath(); c.moveTo(3.0, y0 - 1.4); c.quadraticCurveTo(4.0, y0 + 1.2, 2.8, y0 + 3.9); c.moveTo(-2.4, y0 - 1.4); c.quadraticCurveTo(-1.6, y0 + 1.4, -2.8, y0 + 4.0); c.stroke();
  c.strokeStyle = li; c.lineWidth = 1.1; c.beginPath(); c.moveTo(-5.6, y0 + 0.6); c.quadraticCurveTo(-4.4, y0 + 2.4, -2.6, y0 + 3.0); c.stroke();
}
function PA_collarFB(c, L, P, back) {
  var y0 = -P.TL, top = L.top, col = L.topColor, li = L.topLi, sh = L.topSh;
  c.lineJoin = 'round'; c.lineCap = 'round';
  if (top === 'hoodie' || top === 'raincoat') {
    if (!back) {
      c.beginPath(); c.moveTo(-2.4, y0 - 0.8); c.bezierCurveTo(-4.2, y0 - 5.0, -9.2, y0 - 2.6, -7.0, y0 + 1.2); c.quadraticCurveTo(-4.6, y0 + 3.0, -1.6, y0 + 2.2); c.closePath(); PA_fs(c, col, PA_OUT, 1.4);
      c.beginPath(); c.moveTo(2.4, y0 - 0.8); c.bezierCurveTo(4.2, y0 - 5.0, 9.2, y0 - 2.6, 7.0, y0 + 1.2); c.quadraticCurveTo(4.6, y0 + 3.0, 1.6, y0 + 2.2); c.closePath(); PA_fs(c, sh, PA_OUT, 1.4);
      if (top === 'hoodie') {
        c.strokeStyle = PA_OUT; c.lineWidth = 2.0; PA_line(c, -1.6, y0 + 2.6, -1.9, y0 + 7.4); PA_line(c, 1.6, y0 + 2.6, 1.9, y0 + 6.6);
        c.strokeStyle = '#fbf1d8'; c.lineWidth = 0.9; PA_line(c, -1.6, y0 + 2.6, -1.9, y0 + 7.4); PA_line(c, 1.6, y0 + 2.6, 1.9, y0 + 6.6);
      }
    } else {
      c.beginPath(); c.moveTo(-6.6, y0 - 2.2); c.bezierCurveTo(-8.4, y0 + 9.5, 8.4, y0 + 9.5, 6.6, y0 - 2.2); c.quadraticCurveTo(0, y0 - 4.4, -6.6, y0 - 2.2); c.closePath(); PA_fs(c, col, PA_OUT, 1.5);
      c.fillStyle = sh; c.beginPath(); c.moveTo(4.0, y0 - 2.4); c.quadraticCurveTo(5.4, y0 + 4.4, 1.4, y0 + 6.7); c.quadraticCurveTo(7.6, y0 + 6.0, 6.2, y0 - 2.0); c.closePath(); c.fill();
      c.strokeStyle = PA_sh(col, 0.5); c.lineWidth = 1.1; c.beginPath(); c.moveTo(-3.6, y0 - 1.4); c.quadraticCurveTo(0, y0 + 4.6, 3.6, y0 - 1.4); c.stroke();
    }
  } else if (top === 'shirt' || top === 'uniform' || (top === 'dress' && L.motif === 'collar')) {
    var cc = top === 'dress' ? '#fbf1d8' : PA_mix(col, '#ffffff', 0.6), cs = PA_sh(col, 0.6);
    if (!back) {
      c.beginPath(); c.moveTo(-0.3, y0 + 1.2); c.lineTo(-3.2, y0 - 3.0); c.quadraticCurveTo(-5.6, y0 - 1.4, -4.8, y0 + 1.6); c.lineTo(-2.8, y0 + 4.0); c.closePath(); PA_fs(c, cc, cs, 1.1);
      c.beginPath(); c.moveTo(0.3, y0 + 1.2); c.lineTo(3.2, y0 - 3.0); c.quadraticCurveTo(5.6, y0 - 1.4, 4.8, y0 + 1.6); c.lineTo(2.8, y0 + 4.0); c.closePath(); PA_fs(c, cc, cs, 1.1);
      if (top === 'shirt') { c.beginPath(); c.moveTo(-1.2, y0 + 0.9); c.lineTo(1.2, y0 + 0.9); c.lineTo(0.9, y0 + 3.2); c.lineTo(-0.9, y0 + 3.2); c.closePath(); PA_fs(c, L.topColor2, L.top2Sh, 0.9); }
    } else {
      PA_rr(c, -4.8, y0 - 3.4, 9.6, 3.6, 1.4); PA_fs(c, cc, cs, 1.1);
    }
  } else if (top === 'jacket' && back) {
    PA_rr(c, -5.0, y0 - 3.2, 10, 3.6, 1.4); PA_fs(c, li, PA_sh(col, 0.5), 1.1);
  } else if (top === 'sweater' || top === 'tee' || top === 'cardigan' || top === 'overalls' || top === 'dress') {
    if (back) { c.strokeStyle = top === 'overalls' ? L.top2Sh : sh; c.lineWidth = 1.1; c.beginPath(); c.moveTo(-3.2, y0 - 1.2); c.quadraticCurveTo(0, y0 + 0.6, 3.2, y0 - 1.2); c.stroke(); }
  }
  if (L.scarf) PA_scarfFB(c, L, P, back);
}
function PA_collarS(c, L, P) {
  var y0 = -P.TL, top = L.top, col = L.topColor, li = L.topLi, sh = L.topSh, D = L.D;
  c.lineJoin = 'round'; c.lineCap = 'round';
  if (top === 'hoodie' || top === 'raincoat') {
    c.beginPath(); c.moveTo(-0.6, y0 - 3.2); c.bezierCurveTo(-4, y0 - 5.6, -D - 4.6, y0 - 2.6, -D - 2.4, y0 + 3.8); c.quadraticCurveTo(-D - 0.6, y0 + 6.4, -D + 1.6, y0 + 3.0);
    c.quadraticCurveTo(-1.6, y0 + 0.8, 2.2, y0 - 0.6); c.quadraticCurveTo(2.4, y0 - 2.6, -0.6, y0 - 3.2); c.closePath(); PA_fs(c, col, PA_OUT, 1.4);
    c.strokeStyle = PA_sh(col, 0.5); c.lineWidth = 1; c.beginPath(); c.moveTo(-1.2, y0 - 2.2); c.quadraticCurveTo(-4.6, y0 - 1, -D - 0.6, y0 + 3.2); c.stroke();
    if (top === 'hoodie') { c.strokeStyle = PA_OUT; c.lineWidth = 2.0; PA_line(c, D - 1.0, y0 + 1.2, D - 0.6, y0 + 6.4); c.strokeStyle = '#fbf1d8'; c.lineWidth = 0.9; PA_line(c, D - 1.0, y0 + 1.2, D - 0.6, y0 + 6.4); }
  } else if (top === 'shirt' || top === 'uniform' || top === 'jacket' || (top === 'dress' && L.motif === 'collar')) {
    var cc = top === 'dress' ? '#fbf1d8' : top === 'jacket' ? li : PA_li(col, 0.5), cs = PA_sh(col, 0.45);
    c.beginPath(); c.moveTo(-3.0, y0 - 3.2); c.lineTo(2.6, y0 - 3.4); c.lineTo(4.9, y0 + 1.2); c.lineTo(1.9, y0 + 0.2); c.lineTo(-3.2, y0 - 0.2); c.closePath(); PA_fs(c, cc, cs, 1.1);
    if (top === 'shirt') { c.beginPath(); c.moveTo(3.0, y0 - 0.4); c.lineTo(4.9, y0 + 0.6); c.lineTo(4.6, y0 + 2.8); c.lineTo(2.9, y0 + 2.2); c.closePath(); PA_fs(c, L.topColor2, L.top2Sh, 0.9); }
  }
  if (L.scarf) {
    var s = L.scarf, sw = P.sway;
    c.beginPath(); c.moveTo(-3.0, y0 - 3.0); c.lineTo(-0.4, y0 - 2.0); c.quadraticCurveTo(-3.4 + sw * 0.6, y0 + 3, -4.6 + sw * 1.2, y0 + 8.8); c.lineTo(-8.4 + sw * 1.3, y0 + 8.0); c.quadraticCurveTo(-6.4 + sw * 0.6, y0 + 2, -3.0, y0 - 3.0); c.closePath(); PA_fs(c, s, PA_OUT, 1.4);
    c.strokeStyle = PA_li(s, 0.45); c.lineWidth = 1.2; PA_line(c, -7.4 + sw * 1.1, y0 + 5.6, -4.6 + sw * 1.0, y0 + 6.2);
    PA_rr(c, -4.2, y0 - 5.0, 8.6, 5.4, 2.4); PA_fs(c, s, PA_OUT, 1.5);
    c.strokeStyle = PA_sh(s); c.lineWidth = 1; c.beginPath(); c.moveTo(0.4, y0 - 4.4); c.quadraticCurveTo(1.4, y0 - 2.4, 0.2, y0 - 0.2); c.stroke();
  }
}

// ============================================================================================
// HEAD. Local origin = centre of the head. Skull radii PA_R.rx / PA_R.ry.
// ============================================================================================
function PA_headPathF(c) {
  var Rx = PA_R.rx, Ry = PA_R.ry;
  c.beginPath(); c.moveTo(0, -Ry);
  c.bezierCurveTo(Rx * 0.64, -Ry, Rx, -Ry * 0.62, Rx, -0.6);
  c.bezierCurveTo(Rx, Ry * 0.56, Rx * 0.62, Ry, 0, Ry);
  c.bezierCurveTo(-Rx * 0.62, Ry, -Rx, Ry * 0.56, -Rx, -0.6);
  c.bezierCurveTo(-Rx, -Ry * 0.62, -Rx * 0.64, -Ry, 0, -Ry);
  c.closePath();
}
function PA_headPathS(c) {
  var Rx = PA_R.rx, Ry = PA_R.ry;
  c.beginPath(); c.moveTo(-1, -Ry);
  c.bezierCurveTo(4.6, -Ry, 8.7, -7.4, 9.3, -2.6);
  c.quadraticCurveTo(9.5, -0.6, 9.9, 1.3);
  c.quadraticCurveTo(11.9, 3.3, 10.2, 4.1);
  c.quadraticCurveTo(9.5, 4.7, 9.6, 5.7);
  c.quadraticCurveTo(9.6, 7.2, 8.7, 8.4);
  c.quadraticCurveTo(7.0, Ry + 0.2, 3.6, Ry);
  c.quadraticCurveTo(-1.2, Ry, -5.2, 7.4);
  c.bezierCurveTo(-9.6, 5.2, -Rx, 1.2, -Rx, -1.5);
  c.bezierCurveTo(-Rx, -7.2, -6.6, -Ry, -1, -Ry);
  c.closePath();
}
function PA_scallopArc(c, cx, cy, rx, ry, u0, u1, n, amp, move) {
  var x = cx + rx * Math.sin(u0), y = cy - ry * Math.cos(u0), i, u, um;
  if (move) c.moveTo(x, y); else c.lineTo(x, y);
  for (i = 1; i <= n; i++) {
    u = u0 + (u1 - u0) * i / n; um = u0 + (u1 - u0) * (i - 0.5) / n;
    c.quadraticCurveTo(cx + (rx + amp) * Math.sin(um), cy - (ry + amp) * Math.cos(um), cx + rx * Math.sin(u), cy - ry * Math.cos(u));
  }
}

// ---------- face, front ----------
function PA_eyeF(c, L, P, x, y, side) {
  var e = P.eyes, g = P.gaze;
  c.lineCap = 'round';
  if (e === 'closed') { c.strokeStyle = L.eye; c.lineWidth = 1.25; c.beginPath(); c.moveTo(x - 1.8, y + 0.3); c.quadraticCurveTo(x, y + 1.6, x + 1.8, y + 0.3); c.stroke(); return; }
  if (e === 'happy') { c.strokeStyle = L.eye; c.lineWidth = 1.4; c.beginPath(); c.moveTo(x - 2.0, y + 1.0); c.quadraticCurveTo(x, y - 2.4, x + 2.0, y + 1.0); c.stroke(); return; }
  PA_ell(c, x + g, y, 1.65, 2.4); c.fillStyle = L.eye; c.fill();
  PA_dot(c, x + g - 0.5, y - 1.0, 0.72, '#ffffff');
  var xi = x - side * 2.7, xo = x + side * 2.7;
  if (e === 'half') {
    c.fillStyle = L.skin; c.fillRect(x - 2.6, y - 3.0, 5.2, 2.3);
    c.strokeStyle = L.eye; c.lineWidth = 1.1; PA_line(c, x - 1.9, y - 0.7, x + 1.9, y - 0.7);
  } else if (e === 'glare') {
    c.fillStyle = L.skin; c.beginPath(); c.moveTo(xo, y - 3.3); c.lineTo(xi, y - 3.3); c.lineTo(xi, y - 0.2); c.lineTo(xo, y - 2.0); c.closePath(); c.fill();
    c.strokeStyle = L.eye; c.lineWidth = 1.1; PA_line(c, x - side * 1.9, y - 0.55, x + side * 1.9, y - 1.75);
  }
  if (L.lashes && e !== 'glare' && e !== 'half') { c.strokeStyle = L.eye; c.lineWidth = 1.05; c.beginPath(); c.moveTo(x - side * 1.2 + g, y - 2.3); c.quadraticCurveTo(x + side * 0.9 + g, y - 3.0, x + side * 2.5 + g, y - 1.2); c.stroke(); }
}
function PA_browsF(c, L, P) {
  var by = -3.1, k = P.brows, s, xo, xi;
  c.strokeStyle = L.brow; c.lineWidth = k === 1 ? 1.55 : 1.25; c.lineCap = 'round';
  c.beginPath();
  for (s = -1; s <= 1; s += 2) {
    xo = s * 6.1; xi = s * 2.7;
    if (k === 1) { c.moveTo(xo, by - 1.2); c.lineTo(xi, by + 1.1); }
    else if (k === 2) { c.moveTo(xo, by - 0.6); c.quadraticCurveTo((xo + xi) / 2, by - 2.6, xi, by - 1.2); }
    else if (k === 3) { c.moveTo(xo, by + 0.5); c.lineTo(xi, by - 1.2); }
    else { c.moveTo(xo, by + 0.2); c.quadraticCurveTo((xo + xi) / 2, by - 1.2, xi, by - 0.4); }
  }
  c.stroke();
}
function PA_mouthF(c, L, P, x, y) {
  var m = P.mouth, o = P.mouthOpen;
  c.lineCap = 'round'; c.lineJoin = 'round'; c.strokeStyle = L.lip; c.lineWidth = 1.15;
  if (m === 'open' && o > 0.12) {
    var h = 0.9 + 2.6 * o, w = 2.2 + 0.5 * o;
    c.beginPath(); c.moveTo(x - w, y - 0.5); c.quadraticCurveTo(x, y + 0.1, x + w, y - 0.5);
    c.bezierCurveTo(x + w * 0.95, y + h * 1.3, x - w * 0.95, y + h * 1.3, x - w, y - 0.5); c.closePath();
    c.fillStyle = '#7a2a2a'; c.fill();
    if (o > 0.45) { PA_ell(c, x, y + h * 0.72, w * 0.5, h * 0.24); c.fillStyle = '#ea8a80'; c.fill(); }
    c.beginPath(); c.moveTo(x - w, y - 0.5); c.quadraticCurveTo(x, y + 0.1, x + w, y - 0.5);
    c.bezierCurveTo(x + w * 0.95, y + h * 1.3, x - w * 0.95, y + h * 1.3, x - w, y - 0.5); c.closePath(); c.lineWidth = 0.9; c.stroke();
    return;
  }
  c.beginPath();
  if (m === 'frown') { c.moveTo(x - 2.1, y + 1.1); c.quadraticCurveTo(x, y - 0.9, x + 2.1, y + 1.1); }
  else if (m === 'flat') { c.moveTo(x - 1.8, y + 0.4); c.lineTo(x + 1.8, y + 0.4); }
  else { c.moveTo(x - 2.4, y - 0.4); c.quadraticCurveTo(x, y + 2.0, x + 2.4, y - 0.4); }
  c.stroke();
}
function PA_beardF(c, L, clipped) {
  var b = L.beard, Rx = PA_R.rx, Ry = PA_R.ry;
  if (!b) return;
  c.lineJoin = 'round';
  if ((b === 'stubble') === clipped && (b === 'beard' || b === 'stubble')) {
    var bp = function () {
      c.beginPath(); c.moveTo(-Rx - 0.3, 0.8); c.bezierCurveTo(-Rx + 0.9, 2.6, -Rx + 1.6, 5.6, -6.0, 6.6); c.bezierCurveTo(-4.6, 6.4, -4.2, 4.4, -2.4, 4.5); c.quadraticCurveTo(-1.0, 4.5, 0, 5.2);
      c.quadraticCurveTo(1.0, 4.5, 2.4, 4.5); c.bezierCurveTo(4.2, 4.4, 4.6, 6.4, 6.0, 6.6); c.bezierCurveTo(Rx - 1.6, 5.6, Rx - 0.9, 2.6, Rx + 0.3, 0.8);
      c.bezierCurveTo(Rx + 0.7, Ry * 0.72, Rx * 0.6, Ry + 2.2, 0, Ry + 2.2); c.bezierCurveTo(-Rx * 0.6, Ry + 2.2, -Rx - 0.7, Ry * 0.72, -Rx - 0.3, 0.8); c.closePath();
    };
    bp();
    if (b === 'stubble') { c.globalAlpha = 0.22; c.fillStyle = L.hair; c.fill(); c.globalAlpha = 1; }
    else {
      c.fillStyle = L.hair; c.fill();
      c.fillStyle = L.hairSh; c.beginPath(); c.moveTo(Rx + 0.3, 0.8); c.bezierCurveTo(Rx + 0.7, Ry * 0.72, Rx * 0.6, Ry + 2.2, 0.5, Ry + 2.2); c.quadraticCurveTo(7.4, Ry - 0.2, Rx - 1.4, 4.4); c.closePath(); c.fill();
      bp(); c.strokeStyle = L.hairDt; c.lineWidth = 1; c.stroke();
      c.beginPath(); c.moveTo(-Rx - 0.3, 0.8); c.bezierCurveTo(-Rx - 0.7, Ry * 0.72, -Rx * 0.6, Ry + 2.2, 0, Ry + 2.2); c.bezierCurveTo(Rx * 0.6, Ry + 2.2, Rx + 0.7, Ry * 0.72, Rx + 0.3, 0.8); c.strokeStyle = PA_OUT; c.lineWidth = 1.5; c.stroke();
      PA_ell(c, 0, 6.9, 2.7, 1.6); c.fillStyle = PA_mix(L.skin, L.hair, 0.12); c.fill();
    }
  }
  if (clipped) return;
  if (b === 'moustache' || b === 'goatee') {
    var k = b === 'goatee' ? 0.8 : 1;
    c.beginPath(); c.moveTo(0, 4.5); c.quadraticCurveTo(3.2 * k, 3.7, 4.7 * k, 6.0); c.quadraticCurveTo(2.2 * k, 6.0, 0, 5.5);
    c.quadraticCurveTo(-2.2 * k, 6.0, -4.7 * k, 6.0); c.quadraticCurveTo(-3.2 * k, 3.7, 0, 4.5); c.closePath(); PA_fs(c, L.hair, L.hairSh, 0.9);
    if (b === 'goatee') { PA_ell(c, 0, 9.0, 2.7, 1.9); PA_fs(c, L.hair, L.hairSh, 0.9); }
  }
}
function PA_faceF(c, L, P) {
  var ex = 4.35, ey = 1.7;
  if (L.age === 2) {
    c.strokeStyle = L.skinSh; c.lineWidth = 0.9; c.lineCap = 'round';
    c.beginPath(); c.moveTo(-7.4, 0.9); c.lineTo(-8.5, 0.4); c.moveTo(-7.4, 2.2); c.lineTo(-8.4, 2.8); c.moveTo(7.4, 0.9); c.lineTo(8.5, 0.4); c.moveTo(7.4, 2.2); c.lineTo(8.4, 2.8);
    c.moveTo(-3.9, 5.2); c.quadraticCurveTo(-4.5, 6.0, -4.2, 6.9); c.moveTo(3.9, 5.2); c.quadraticCurveTo(4.5, 6.0, 4.2, 6.9); c.stroke();
  } else if (L.age === 99) {
    c.strokeStyle = L.skinSh; c.lineWidth = 0.9; c.lineCap = 'round';
    c.beginPath(); c.moveTo(-3.7, 5.2); c.quadraticCurveTo(-4.2, 6.2, -3.9, 7.0); c.moveTo(3.7, 5.2); c.quadraticCurveTo(4.2, 6.2, 3.9, 7.0); c.stroke();
  }
  PA_eyeF(c, L, P, -ex, ey, -1); PA_eyeF(c, L, P, ex, ey, 1);
  // nose
  c.strokeStyle = L.skinSh; c.lineWidth = 1.1; c.lineCap = 'round';
  c.beginPath(); c.moveTo(-0.5, 3.9); c.quadraticCurveTo(0.7, 4.6, 1.1, 3.5); c.stroke();
  PA_beardF(c, L, false);
  if (L.beard !== 'moustache') PA_mouthF(c, L, P, 0, L.beard === 'beard' ? 6.6 : 6.3);
  else if (P.mouth === 'open' && P.mouthOpen > 0.12) PA_mouthF(c, L, P, 0, 6.6);
}

// ---------- fringe shapes, from the right temple (tx, -3) to the left temple (-tx, -3) ----------
function PA_fringe(c, type, tx) {
  if (type === 'bangs') { c.lineTo(tx - 0.6, -2.0); c.quadraticCurveTo(4.6, -1.2, 2.6, -2.3); c.quadraticCurveTo(0, -1.2, -2.6, -2.3); c.quadraticCurveTo(-4.6, -1.2, -tx + 0.6, -2.0); c.lineTo(-tx, -3); }
  else if (type === 'side') { c.quadraticCurveTo(7.6, -6.6, 4.6, -7.9); c.quadraticCurveTo(0.5, -2.7, -tx + 0.2, -1.9); c.lineTo(-tx, -3); }
  else if (type === 'center') { c.quadraticCurveTo(6.6, -7.6, 0.4, -8.6); c.lineTo(-0.4, -8.6); c.quadraticCurveTo(-6.6, -7.6, -tx, -3); }
  else if (type === 'tuft') { c.lineTo(6.2, -6.0); c.lineTo(3.9, -4.3); c.lineTo(1.6, -6.8); c.lineTo(-0.9, -4.8); c.lineTo(-3.6, -7.0); c.lineTo(-6.2, -5.1); c.lineTo(-tx, -3); }
  else if (type === 'curly') { c.quadraticCurveTo(7.6, -2.4, 5.4, -5.2); c.quadraticCurveTo(4.0, -2.6, 1.8, -5.7); c.quadraticCurveTo(0, -3.0, -1.8, -5.7); c.quadraticCurveTo(-4.0, -2.6, -5.4, -5.2); c.quadraticCurveTo(-7.6, -2.4, -tx, -3); }
  else if (type === 'tousled') { c.quadraticCurveTo(7.8, -1.6, 5.2, -4.6); c.quadraticCurveTo(3.6, -1.4, 1.4, -4.9); c.quadraticCurveTo(0, -1.2, -1.6, -4.8); c.quadraticCurveTo(-3.8, -1.4, -5.4, -4.6); c.quadraticCurveTo(-7.8, -1.6, -tx, -3); }
  else if (type === 'swoop') { c.quadraticCurveTo(8.0, -7.2, 4.6, -8.0); c.quadraticCurveTo(-3, -9.8, -7.6, -6.0); c.lineTo(-tx, -3); }
  else if (type === 'high') { c.quadraticCurveTo(0, -13.0, -tx, -3); }
  else { c.quadraticCurveTo(0, -10.9, -tx, -3); }
}
function PA_capF(c, vt, vs, drop, fringe, scallop) {
  var Rx = PA_R.rx, Ry = PA_R.ry, ox = Rx + vs, top = -Ry - vt, ix = Rx - 1.5, sx, sy;
  c.beginPath();
  if (scallop) {
    var cy0 = -1.2, ryT = Ry + vt + cy0, U = Math.PI / 2 + Math.asin(PA_clamp((drop - cy0) / ryT, -0.6, 0.75));
    sx = -ox * Math.sin(U); sy = cy0 - ryT * Math.cos(U);
    PA_scallopArc(c, 0, cy0, ox, ryT, -U, U, scallop, 2.6, true);
  } else {
    sx = -ox; sy = drop;
    c.moveTo(-ox, drop);
    c.bezierCurveTo(-ox - 0.3, -Ry * 0.72 - vt * 0.7, -Rx * 0.7, top, 0, top);
    c.bezierCurveTo(Rx * 0.7, top, ox + 0.3, -Ry * 0.72 - vt * 0.7, ox, drop);
  }
  c.quadraticCurveTo((ox + ix) / 2 + 0.2, drop + 1.7, ix, drop - 0.2);
  if (drop > -2.5) c.quadraticCurveTo(ix + 0.4, -1, ix - 0.7, -3); else c.lineTo(ix - 0.7, -3);
  PA_fringe(c, fringe, ix - 0.7);
  if (drop > -2.5) c.quadraticCurveTo(-ix - 0.4, -1, -ix, drop - 0.2); else c.lineTo(-ix, drop - 0.2);
  c.quadraticCurveTo(-(ox + ix) / 2 - 0.2, drop + 1.7, sx, sy);
  c.closePath();
}
function PA_braid(c, L, x, y, n, sw, down) {
  var i, yy, xx;
  for (i = n - 1; i >= 0; i--) {
    yy = y + i * 3.3; xx = x + sw * (i / n) + (i % 2 ? 0.5 : -0.5);
    if (i === n - 1) { c.beginPath(); c.moveTo(xx - 1.3, yy + 1.5); c.lineTo(xx + sw * 0.2, yy + 6.2); c.lineTo(xx + 1.3, yy + 1.5); c.closePath(); PA_fs(c, L.hair, PA_OUT, 1.3); }
    PA_ell(c, xx, yy, 2.4, 2.3); PA_fs(c, i % 2 ? L.hairSh : L.hair, PA_OUT, 1.3);
    if (i === n - 1) { c.strokeStyle = '#d9574a'; c.lineWidth = 1.7; c.lineCap = 'butt'; PA_line(c, xx - 1.9, yy + 2.2, xx + 1.9, yy + 2.2); }
  }
}
function PA_shine(c, L, x0, y0, x1, y1, x2, y2) {
  c.strokeStyle = L.hairLi; c.lineWidth = 1.5; c.lineCap = 'round'; c.globalAlpha = 0.8;
  c.beginPath(); c.moveTo(x0, y0); c.quadraticCurveTo(x1, y1, x2, y2); c.stroke(); c.globalAlpha = 1;
}

// hair that sits behind the head in the front view
function PA_hairBackF(c, L, P) {
  var hs = L.hs, Rx = PA_R.rx, Ry = PA_R.ry, ox = Rx + (hs.vs || 0), sw = P.sway, len;
  c.lineJoin = 'round';
  if (hs.back === 'long' || hs.back === 'wavy') {
    len = hs.back === 'long' ? 23.5 : 21.5;
    c.beginPath(); c.moveTo(-ox + 0.5, -3);
    if (hs.back === 'wavy') { c.bezierCurveTo(-ox - 1.6, 4, -ox + 1.2, 9, -ox - 0.6 + sw * 0.4, 14); c.bezierCurveTo(-ox - 1.6 + sw * 0.7, 18, -ox + 0.6 + sw, len, -ox + 4 + sw, len + 0.4); }
    else { c.lineTo(-ox - 0.5 + sw * 0.3, 12); c.quadraticCurveTo(-ox - 0.3 + sw * 0.8, len, -ox + 3.6 + sw, len + 0.5); }
    c.lineTo(-3.4 + sw, len - 1.0); c.lineTo(sw, len + 0.8); c.lineTo(3.4 + sw, len - 1.0);
    if (hs.back === 'wavy') { c.lineTo(ox - 4 + sw, len + 0.4); c.bezierCurveTo(ox - 0.6 + sw, len, ox + 1.6 + sw * 0.7, 18, ox + 0.6 + sw * 0.4, 14); c.bezierCurveTo(ox - 1.2, 9, ox + 1.6, 4, ox - 0.5, -3); }
    else { c.lineTo(ox - 3.6 + sw, len + 0.5); c.quadraticCurveTo(ox + 0.3 + sw * 0.8, len, ox + 0.5 + sw * 0.3, 12); c.lineTo(ox - 0.5, -3); }
    c.closePath(); PA_fs(c, L.hairSh, PA_OUT, PA_OL);
  } else if (hs.back === 'bob') {
    c.beginPath(); c.moveTo(-ox, -2); c.lineTo(-ox - 0.4, 8.4); c.quadraticCurveTo(-ox - 0.2, 12.8, -ox + 4.6, 12.6); c.lineTo(ox - 4.6, 12.6); c.quadraticCurveTo(ox + 0.2, 12.8, ox + 0.4, 8.4); c.lineTo(ox, -2); c.closePath();
    PA_fs(c, L.hairSh, PA_OUT, PA_OL);
  } else if (hs.scallop && hs.drop > 3) {
    c.beginPath(); PA_scallopArc(c, 0, 3.4, ox - 0.2, 8.6, 1.2, 5.08, 7, 2.4, true); c.closePath(); PA_fs(c, L.hairSh, PA_OUT, PA_OL);
  }
  if (hs.pony) {
    c.beginPath(); c.moveTo(5.5, 1.5); c.bezierCurveTo(11.5, 2.5, 15.2 + sw, 9, 13.0 + sw * 1.6, 19); c.quadraticCurveTo(11.2 + sw * 1.4, 15.5, 9.6 + sw, 14.4);
    c.bezierCurveTo(10.6, 9.5, 8.4, 7.5, 5.5, 7.5); c.closePath(); PA_fs(c, L.hairSh, PA_OUT, PA_OL);
  }
  if (hs.bun && !L.hat) {
    var by = -Ry - hs.vt - 2.4;
    PA_ell(c, 0, by, 5.2, 4.6); PA_fs(c, L.hair, PA_OUT, PA_OL);
    c.fillStyle = L.hairSh; c.beginPath(); c.arc(0.6, by + 0.4, 4.4, -0.5, 1.9); c.arc(-0.8, by - 0.6, 4.2, 1.7, -0.3, true); c.fill();
    PA_shine(c, L, -3.0, by - 1.0, -1.6, by - 3.0, 0.8, by - 2.8);
  }
}
function PA_hairFrontF(c, L, P) {
  var hs = L.hs, Rx = PA_R.rx, Ry = PA_R.ry, vt = hs.vt, hat = L.hat;
  c.lineJoin = 'round'; c.lineCap = 'round';
  if (hs.none) {
    if (hs.tufts) {
      c.beginPath(); c.moveTo(-Rx + 1.6, -6.0); c.bezierCurveTo(-Rx - 1.8, -5.2, -Rx - 2.4, -0.6, -Rx - 0.8, 1.4); c.quadraticCurveTo(-Rx + 1.2, 0.4, -Rx + 2.6, -2.6); c.closePath(); PA_fs(c, L.hair, PA_OUT, 1.4);
      c.beginPath(); c.moveTo(Rx - 1.6, -6.0); c.bezierCurveTo(Rx + 1.8, -5.2, Rx + 2.4, -0.6, Rx + 0.8, 1.4); c.quadraticCurveTo(Rx - 1.2, 0.4, Rx - 2.6, -2.6); c.closePath(); PA_fs(c, L.hairSh, PA_OUT, 1.4);
    }
    if (!hat) { c.strokeStyle = L.skinLi; c.lineWidth = 1.6; c.globalAlpha = 0.9; c.beginPath(); c.moveTo(-6.2, -5.6); c.quadraticCurveTo(-4.6, -8.0, -1.6, -8.4); c.stroke(); c.globalAlpha = 1; }
    return;
  }
  if (hat) vt = Math.min(vt, 1.2);
  if (hs.under) {
    PA_capF(c, 0.5, 0.35, 0.6, 'arc', 0); c.fillStyle = PA_mix(L.hair, L.skin, 0.38); c.fill(); c.strokeStyle = PA_OUT; c.lineWidth = 1.2; c.stroke();
  }
  PA_capF(c, vt, hs.vs, hs.drop, hs.fringe, hat ? 0 : hs.scallop);
  c.fillStyle = hs.thin ? PA_mix(L.hair, L.skin, 0.3) : L.hair; c.fill();
  if (!hs.thin) {
    // shade on the right-hand locks
    PA_save(c); c.clip();
    c.fillStyle = L.hairSh; c.beginPath(); c.moveTo(Rx + 8, -Ry - vt - 2); c.lineTo(Rx - 1.0, -Ry * 0.55 - vt); c.quadraticCurveTo(Rx - 2.6, -1, Rx - 2.4, 12); c.lineTo(Rx + 8, 12); c.closePath(); c.fill();
    PA_restore(c);
    PA_capF(c, vt, hs.vs, hs.drop, hs.fringe, hat ? 0 : hs.scallop);
  }
  c.strokeStyle = PA_OUT; c.lineWidth = hs.thin ? 1.2 : 1.5; c.stroke();
  if (!hs.thin && !hat) {
    var top = -Ry - vt;
    PA_shine(c, L, -6.9, top + 4.8, -4.4, top + 1.7, 0.2, top + 1.7);
    c.strokeStyle = L.hairDt; c.lineWidth = 1; 
    if (hs.fringe === 'side') { c.beginPath(); c.moveTo(4.6, -7.9); c.quadraticCurveTo(4.6, top + 3.4, 3.4, top + 2.2); c.stroke(); }
    else if (hs.fringe === 'center') { PA_line(c, 0, -8.6, 0, top + 0.6); }
    else if (hs.fringe === 'bangs') { c.beginPath(); c.moveTo(-2.6, -2.6); c.lineTo(-2.2, -5.4); c.moveTo(2.6, -2.6); c.lineTo(2.2, -5.4); c.stroke(); }
    else if (hs.scallop) { c.beginPath(); c.arc(-4.4, top + 5.0, 1.7, 0.4, 3.4); c.moveTo(5.9, top + 4.2); c.arc(4.2, top + 4.2, 1.7, 0, 3.0); c.moveTo(1.8, top + 2.0); c.arc(0.2, top + 2.4, 1.6, -0.3, 2.6); c.stroke(); }
    else if (hs.fringe === 'swoop') { c.beginPath(); c.moveTo(4.6, -8.0); c.quadraticCurveTo(0, top + 1, -4.6, top + 2.2); c.stroke(); }
  }
  if (hs.braids) { PA_braid(c, L, -Rx - 0.2, 5.4, 4, P.sway * 0.8); PA_braid(c, L, Rx + 0.2, 5.4, 4, P.sway * 0.8); }
}

// ---------- hats / glasses / headphones (shared by the three views) ----------
function PA_hat(c, L, view, P) {
  var hat = L.hat, Rx = PA_R.rx, Ry = PA_R.ry, col = L.hatColor, sh = L.hatSh, li = L.hatLi, i;
  if (!hat) return;
  c.lineJoin = 'round'; c.lineCap = 'round';
  PA_save(c);
  if (view === 'side') { c.translate(-0.5, 0); c.rotate(-0.1); }
  var shadeR = (view !== 'side' || PA_fx > 0) ? 1 : -1;
  if (hat === 'beanie') {
    var dome = function () { c.beginPath(); c.moveTo(-Rx - 1.3, -3.4); c.bezierCurveTo(-Rx - 1.9, -Ry - 6.4, Rx + 1.9, -Ry - 6.4, Rx + 1.3, -3.4); c.quadraticCurveTo(0, -2.2, -Rx - 1.3, -3.4); c.closePath(); };
    if (L.hatColor2 && view !== 'x') { PA_dot(c, 0, -Ry - 4.2, 3.2 + PA_OL * 0.5, PA_OUT); PA_dot(c, 0, -Ry - 4.2, 2.5, L.hatColor2); PA_dot(c, 0.7 * shadeR, -Ry - 3.7, 1.3, PA_sh(L.hatColor2, 0.2)); }
    dome(); c.fillStyle = col; c.fill();
    PA_save(c); c.clip(); c.fillStyle = sh; c.beginPath(); c.ellipse(shadeR * (Rx + 3), -Ry + 1, 7.6, 12, 0, 0, PA_TAU); c.fill(); PA_restore(c);
    dome(); c.strokeStyle = PA_OUT; c.lineWidth = 1.5; c.stroke();
    c.beginPath(); c.moveTo(-Rx - 1.7, -6.6); c.quadraticCurveTo(0, -8.4, Rx + 1.7, -6.6); c.lineTo(Rx + 1.6, -3.2); c.quadraticCurveTo(0, -1.7, -Rx - 1.6, -3.2); c.closePath();
    PA_fs(c, li, PA_OUT, 1.5);
    c.strokeStyle = PA_sh(col, 0.18); c.lineWidth = 1;
    for (i = -4; i <= 4; i++) PA_line(c, i * 2.5, -6.6 - (1 - Math.abs(i) / 4.5) * 0.6, i * 2.5, -3.4 + (1 - Math.abs(i) / 4.5) * 0.9);
  } else if (hat === 'cap') {
    var cd = function () { c.beginPath(); c.moveTo(-Rx - 1.0, -4.0); c.bezierCurveTo(-Rx - 1.4, -Ry - 5.2, Rx + 1.4, -Ry - 5.2, Rx + 1.0, -4.0); c.quadraticCurveTo(0, -5.4 + (view === 'back' ? 3.0 : 0), -Rx - 1.0, -4.0); c.closePath(); };
    if (view === 'side') { c.beginPath(); c.moveTo(5.0, -6.6); c.quadraticCurveTo(12, -6.4, 17.0, -3.4); c.quadraticCurveTo(17.8, -1.8, 15.8, -1.9); c.quadraticCurveTo(11, -3.2, 5.6, -3.6); c.closePath(); PA_fs(c, sh, PA_OUT, 1.5); }
    cd(); c.fillStyle = col; c.fill();
    PA_save(c); c.clip(); c.fillStyle = sh; c.beginPath(); c.ellipse(shadeR * (Rx + 3), -Ry + 1, 7.6, 12, 0, 0, PA_TAU); c.fill(); PA_restore(c);
    c.strokeStyle = PA_sh(col, 0.4); c.lineWidth = 1;
    if (view !== 'side') { c.beginPath(); c.moveTo(-4.4, -4.8); c.quadraticCurveTo(-4.4, -Ry - 1.0, 0, -Ry - 2.7); c.quadraticCurveTo(4.4, -Ry - 1.0, 4.4, -4.8); c.stroke(); }
    else { c.beginPath(); c.moveTo(1.5, -4.6); c.quadraticCurveTo(2.5, -Ry - 1.0, 0, -Ry - 2.7); c.stroke(); }
    cd(); c.strokeStyle = PA_OUT; c.lineWidth = 1.5; c.stroke();
    PA_dot(c, 0, -Ry - 2.9, 1.2, PA_OUT);
    if (view === 'front') {
      c.beginPath(); c.moveTo(-9.0, -4.6); c.quadraticCurveTo(0, -6.6, 9.0, -4.6); c.bezierCurveTo(9.4, -1.2, -9.4, -1.2, -9.0, -4.6); c.closePath(); PA_fs(c, sh, PA_OUT, 1.5);
      c.strokeStyle = li; c.lineWidth = 1; c.globalAlpha = 0.7; c.beginPath(); c.moveTo(-6.6, -4.2); c.quadraticCurveTo(0, -5.6, 6.6, -4.2); c.stroke(); c.globalAlpha = 1;
      PA_ell(c, 0, -8.6, 2.3, 1.9); c.fillStyle = L.hatColor2; c.fill();
    } else if (view === 'back') {
      c.beginPath(); c.arc(0, -3.0, 2.5, Math.PI, 0); c.closePath(); PA_fs(c, L.hs.none ? L.skin : L.hair, PA_OUT, 1.2);
      c.strokeStyle = PA_OUT; c.lineWidth = 2.4; PA_line(c, -2.6, -2.6, 2.6, -2.6); c.strokeStyle = li; c.lineWidth = 1.1; PA_line(c, -2.4, -2.6, 2.4, -2.6);
    }
  } else if (hat === 'sunhat') {
    var bw = Rx + 7.4;
    PA_ell(c, 0, -5.2, bw, 3.5); PA_fs(c, col, PA_OUT, 1.5);
    c.fillStyle = sh; c.beginPath(); c.ellipse(0, -5.2, bw - 0.8, 2.8, 0, shadeR > 0 ? -0.5 : 0.9, shadeR > 0 ? 2.2 : 3.6); c.fill();
    c.beginPath(); c.moveTo(-Rx + 1.6, -5.6); c.bezierCurveTo(-Rx + 0.6, -Ry - 6.0, Rx - 0.6, -Ry - 6.0, Rx - 1.6, -5.6); c.quadraticCurveTo(0, -3.6, -Rx + 1.6, -5.6); c.closePath(); PA_fs(c, col, PA_OUT, 1.5);
    c.beginPath(); c.moveTo(-Rx + 1.5, -7.8); c.quadraticCurveTo(0, -5.6, Rx - 1.5, -7.8); c.lineTo(Rx - 1.6, -5.6); c.quadraticCurveTo(0, -3.6, -Rx + 1.6, -5.6); c.closePath(); PA_fs(c, L.hatColor2, PA_OUT, 1.2);
    c.strokeStyle = li; c.lineWidth = 1.1; c.globalAlpha = 0.8; c.beginPath(); c.moveTo(-5.4, -Ry - 0.4); c.quadraticCurveTo(-3.6, -Ry - 3.0, -0.6, -Ry - 3.4); c.stroke(); c.globalAlpha = 1;
  }
  PA_restore(c);
}
function PA_glassesF(c, L) {
  var g = L.glasses, fc = L.glassesColor, s;
  c.lineJoin = 'round'; c.lineCap = 'round';
  for (s = -1; s <= 1; s += 2) {
    PA_rr(c, s * 4.35 - 3.0, -0.9, 6.0, 5.1, g === 'sunglasses' ? 2.2 : 1.8);
    if (g === 'sunglasses') { c.fillStyle = '#3a2f3d'; c.fill(); } else { c.fillStyle = 'rgba(255,255,255,0.28)'; c.fill(); }
    c.strokeStyle = fc; c.lineWidth = 1.25; c.stroke();
    if (g === 'sunglasses') { c.strokeStyle = 'rgba(255,255,255,0.55)'; c.lineWidth = 1; PA_line(c, s * 4.35 - 1.6, 0.5, s * 4.35 - 0.2, 0.3); }
    c.strokeStyle = fc; c.lineWidth = 1.2; PA_line(c, s * 7.4, 0.6, s * (PA_R.rx - 0.3), 0.2);
  }
  c.strokeStyle = fc; c.lineWidth = 1.2; c.beginPath(); c.moveTo(-1.35, 0.9); c.quadraticCurveTo(0, 0.1, 1.35, 0.9); c.stroke();
}
function PA_headphones(c, L, view) {
  var col = L.headphones, Rx = PA_R.rx, Ry = PA_R.ry, top = -Ry - (L.hs.vt || 0) - 1.2, s;
  c.lineCap = 'round'; c.lineJoin = 'round';
  if (view === 'side') {
    c.strokeStyle = PA_OUT; c.lineWidth = 4.6; c.beginPath(); c.moveTo(-2.8, 0); c.quadraticCurveTo(-3.4, top * 0.6, -1.4, top); c.stroke();
    c.strokeStyle = col; c.lineWidth = 2.4; c.beginPath(); c.moveTo(-2.8, 0); c.quadraticCurveTo(-3.4, top * 0.6, -1.4, top); c.stroke();
    PA_ell(c, -2.8, 2.6, 4.3, 4.7); PA_fs(c, col, PA_OUT, 1.5);
    PA_ell(c, -2.8, 2.6, 2.4, 2.8); PA_fs(c, PA_sh(col, 0.3), PA_sh(col, 0.5), 0.9);
    return;
  }
  c.beginPath(); c.moveTo(-Rx - 1.6, 0); c.bezierCurveTo(-Rx - 2.2, top - 3.6, Rx + 2.2, top - 3.6, Rx + 1.6, 0);
  c.strokeStyle = PA_OUT; c.lineWidth = 4.6; c.stroke(); c.strokeStyle = col; c.lineWidth = 2.4; c.stroke();
  for (s = -1; s <= 1; s += 2) {
    PA_rr(c, s * (Rx + 1.2) - 2.1, -2.0, 4.2, 8.4, 2.0); PA_fs(c, s > 0 ? PA_sh(col, 0.2) : col, PA_OUT, 1.5);
    c.strokeStyle = PA_li(col, 0.35); c.lineWidth = 1; PA_line(c, s * (Rx + 1.2) - 0.5, -0.2, s * (Rx + 1.2) - 0.5, 3.6);
  }
}

// ---------- front-facing head ----------
function PA_headF(c, L, P) {
  var Rx = PA_R.rx, Ry = PA_R.ry, hs = L.hs, s;
  var earsHidden = !hs.none && hs.drop > 3;
  if (!earsHidden) {
    for (s = -1; s <= 1; s += 2) {
      PA_ell(c, s * (Rx - 0.1), 1.7, 2.4, 2.8); PA_fs(c, s > 0 ? L.skinSh : L.skin, PA_OUT, 1.4);
    }
  }
  PA_headPathF(c); c.fillStyle = L.skin; c.fill();
  PA_save(c); c.clip();
  c.fillStyle = L.skinSh; c.fillRect(-Rx - 1, -Ry - 1, Rx * 2 + 2, Ry * 2 + 2);
  PA_ell(c, -1.5, -1.3, Rx + 0.1, Ry + 0.2); c.fillStyle = L.skin; c.fill();
  c.globalAlpha = Math.min(0.8, 0.42 * P.blushK); c.fillStyle = L.blush;
  PA_ell(c, -6.5, 4.6, 2.2, 1.45); c.fill(); PA_ell(c, 6.5, 4.6, 2.2, 1.45); c.fill(); c.globalAlpha = 1;
  PA_beardF(c, L, true);
  PA_restore(c);
  PA_headPathF(c); c.strokeStyle = PA_OUT; c.lineWidth = PA_OL; c.lineJoin = 'round'; c.stroke();
  if (L.earrings && !earsHidden) { for (s = -1; s <= 1; s += 2) { PA_dot(c, s * (Rx + 0.4), 5.0, 1.6, PA_OUT); PA_dot(c, s * (Rx + 0.4), 5.0, 0.95, L.earrings); } }
  PA_faceF(c, L, P);
  PA_hairFrontF(c, L, P);
  PA_browsF(c, L, P);
  if (L.glasses) PA_glassesF(c, L);
  PA_hat(c, L, 'front', P);
  if (L.headphones) PA_headphones(c, L, 'front');
}

// ---------- back of the head ----------
function PA_capB(c, hs, vt, sw, smooth) {
  var Rx = PA_R.rx, Ry = PA_R.ry, ox = Rx + hs.vs, top = -Ry - vt, len, bot;
  c.beginPath();
  if (hs.scallop && !smooth) {
    var yb = hs.drop > 3 ? 11.6 : Ry - 1.4, cy = (top + yb) / 2, ry = (yb - top) / 2;
    PA_scallopArc(c, 0, cy, ox, ry, 0, PA_TAU, hs.scallop * 2 - 4, 2.6, true); c.closePath(); return;
  }
  c.moveTo(-ox, -1);
  c.bezierCurveTo(-ox - 0.3, -Ry * 0.72 - vt * 0.7, -Rx * 0.7, top, 0, top);
  c.bezierCurveTo(Rx * 0.7, top, ox + 0.3, -Ry * 0.72 - vt * 0.7, ox, -1);
  if (hs.back === 'bob') {
    c.lineTo(ox + 0.4, 8.4); c.quadraticCurveTo(ox + 0.2, 12.8, ox - 4.6, 12.6); c.lineTo(-ox + 4.6, 12.6); c.quadraticCurveTo(-ox - 0.2, 12.8, -ox - 0.4, 8.4);
  } else if (hs.back === 'long') {
    len = 23.5;
    c.lineTo(ox + 0.5 + sw * 0.3, 12); c.quadraticCurveTo(ox + 0.3 + sw * 0.8, len, ox - 3.6 + sw, len + 0.5);
    c.lineTo(3.4 + sw, len - 1.0); c.lineTo(sw, len + 0.8); c.lineTo(-3.4 + sw, len - 1.0); c.lineTo(-ox + 3.6 + sw, len + 0.5);
    c.quadraticCurveTo(-ox - 0.3 + sw * 0.8, len, -ox - 0.5 + sw * 0.3, 12);
  } else if (hs.back === 'wavy') {
    len = 21.5;
    c.bezierCurveTo(ox + 1.6, 4, ox - 1.2, 9, ox + 0.6 + sw * 0.4, 14); c.bezierCurveTo(ox + 1.6 + sw * 0.7, 18, ox - 0.6 + sw, len, ox - 4 + sw, len + 0.4);
    c.lineTo(3.4 + sw, len - 1.0); c.lineTo(sw, len + 0.8); c.lineTo(-3.4 + sw, len - 1.0); c.lineTo(-ox + 4 + sw, len + 0.4);
    c.bezierCurveTo(-ox + 0.6 + sw, len, -ox - 1.6 + sw * 0.7, 18, -ox - 0.6 + sw * 0.4, 14); c.bezierCurveTo(-ox + 1.2, 9, -ox - 1.6, 4, -ox, -1);
  } else if (hs.drop > 3) {
    c.bezierCurveTo(ox + 0.6, 6, ox - 1, 11.6, 0, 11.6); c.bezierCurveTo(-ox + 1, 11.6, -ox - 0.6, 6, -ox, -1);
  } else {
    bot = Ry - 1.6;
    c.bezierCurveTo(ox, 5.5, 7.4, bot, 0, bot + 0.5); c.bezierCurveTo(-7.4, bot, -ox, 5.5, -ox, -1);
  }
  c.closePath();
}
function PA_headB(c, L, P) {
  var Rx = PA_R.rx, Ry = PA_R.ry, hs = L.hs, hat = L.hat, vt = hs.vt || 0, sw = P.sway, s, top, i;
  var earsHidden = !hs.none && hs.drop > 3;
  c.lineJoin = 'round'; c.lineCap = 'round';
  if (hat) vt = Math.min(vt, 1.2);
  top = -Ry - vt;
  if (!earsHidden) for (s = -1; s <= 1; s += 2) { PA_ell(c, s * (Rx - 0.1), 1.7, 2.4, 2.8); PA_fs(c, s > 0 ? L.skinSh : L.skin, PA_OUT, 1.4); }
  PA_headPathF(c); c.fillStyle = L.skin; c.fill();
  PA_save(c); c.clip();
  c.fillStyle = L.skinSh; c.fillRect(-Rx - 1, -Ry - 1, Rx * 2 + 2, Ry * 2 + 2);
  PA_ell(c, -1.5, -1.3, Rx + 0.1, Ry + 0.2); c.fillStyle = L.skin; c.fill();
  PA_restore(c);
  PA_headPathF(c); c.strokeStyle = PA_OUT; c.lineWidth = PA_OL; c.stroke();
  if (L.earrings && !earsHidden) for (s = -1; s <= 1; s += 2) { PA_dot(c, s * (Rx + 0.4), 5.0, 1.6, PA_OUT); PA_dot(c, s * (Rx + 0.4), 5.0, 0.95, L.earrings); }
  if (hs.none) {
    if (hs.tufts) {
      c.beginPath(); c.moveTo(-Rx - 1.0, -3.2); c.quadraticCurveTo(0, 0.6, Rx + 1.0, -3.2); c.bezierCurveTo(Rx + 1.4, 4, 6.4, 7.4, 0, 7.8); c.bezierCurveTo(-6.4, 7.4, -Rx - 1.4, 4, -Rx - 1.0, -3.2); c.closePath();
      PA_fs(c, L.hair, PA_OUT, 1.4);
    }
    if (!hat) { c.strokeStyle = L.skinLi; c.lineWidth = 1.6; c.globalAlpha = 0.9; c.beginPath(); c.moveTo(-6.2, -5.6); c.quadraticCurveTo(-4.6, -8.0, -1.6, -8.4); c.stroke(); c.globalAlpha = 1; }
    else PA_hat(c, L, 'back', P);
    if (L.headphones) PA_headphones(c, L, 'back');
    return;
  }
  if (hs.under) {
    PA_capB(c, PA_HAIR.buzz, 0.5, 0, true); c.fillStyle = PA_mix(L.hair, L.skin, 0.38); c.fill(); c.strokeStyle = PA_OUT; c.lineWidth = 1.2; c.stroke();
    c.beginPath(); c.moveTo(-Rx - hs.vs, -3.0);
    c.bezierCurveTo(-Rx - hs.vs - 0.3, -Ry * 0.72 - vt * 0.7, -Rx * 0.7, top, 0, top); c.bezierCurveTo(Rx * 0.7, top, Rx + hs.vs + 0.3, -Ry * 0.72 - vt * 0.7, Rx + hs.vs, -3.0);
    c.quadraticCurveTo(0, 0.6, -Rx - hs.vs, -3.0); c.closePath();
    PA_fs(c, L.hair, PA_OUT, 1.5);
  } else {
    PA_capB(c, hs, vt, sw, !!hat); c.fillStyle = hs.thin ? PA_mix(L.hair, L.skin, 0.3) : L.hair; c.fill();
    if (!hs.thin) {
      PA_save(c); c.clip();
      c.fillStyle = L.hairSh; c.beginPath(); c.moveTo(Rx + 9, top - 3); c.lineTo(Rx - 0.6, -Ry * 0.5 - vt); c.quadraticCurveTo(Rx - 3.4, 2, Rx - 2.6 + sw, 26); c.lineTo(Rx + 9, 26); c.closePath(); c.fill();
      if (hs.back) { c.globalAlpha = 0.6; c.fillRect(-Rx - 8, (hs.back === 'bob' ? 10.4 : 20.5), 40, 8); c.globalAlpha = 1; }
      // strands
      c.strokeStyle = L.hairDt; c.lineWidth = 1;
      if (hs.back === 'long' || hs.back === 'wavy') { c.beginPath(); c.moveTo(-4.2, 2); c.quadraticCurveTo(-5.2 + sw * 0.4, 12, -4.4 + sw, 21); c.moveTo(0.4, 4); c.quadraticCurveTo(0.8 + sw * 0.4, 13, 0.4 + sw, 20); c.moveTo(4.8, 3); c.quadraticCurveTo(5.6 + sw * 0.4, 12, 4.6 + sw, 21); c.stroke(); }
      else if (hs.back === 'bob') { c.beginPath(); c.moveTo(-4.4, 2); c.quadraticCurveTo(-5.0, 7, -4.6, 11); c.moveTo(4.4, 2); c.quadraticCurveTo(5.0, 7, 4.6, 11); c.stroke(); }
      else if (hs.scallop) { c.beginPath(); c.arc(-4.6, -4.0, 1.8, 0.4, 3.4); c.moveTo(6.4, -1); c.arc(4.6, -1, 1.8, 0, 3.0); c.moveTo(1.8, -7.0); c.arc(0.2, -6.6, 1.7, -0.3, 2.6); c.moveTo(0.6, 3.2); c.arc(-1.2, 3.2, 1.8, 0, 3.0); c.stroke(); }
      else { c.beginPath(); c.moveTo(-2.4, -5.6); c.quadraticCurveTo(-3.4, -1, -2.6, 3.4); c.moveTo(3.0, -4.6); c.quadraticCurveTo(4.0, -0.6, 3.2, 3.0); c.stroke(); }
      if (hs.fringe === 'center' || hs.braids) { PA_line(c, 0, top + 0.8, 0, -2); }
      PA_restore(c);
      PA_capB(c, hs, vt, sw, !!hat);
    }
    c.strokeStyle = PA_OUT; c.lineWidth = hs.thin ? 1.2 : 1.5; c.stroke();
  }
  if (!hs.thin && !hat) PA_shine(c, L, -6.9, top + 4.8, -4.4, top + 1.7, 0.2, top + 1.7);
  if (hs.pony) {
    c.beginPath(); c.moveTo(-2.8, -3.6); c.bezierCurveTo(-5.4, 3, -4.4 + sw, 11, -1.2 + sw * 1.6, 17.5); c.quadraticCurveTo(1.4 + sw * 1.6, 18, 2.2 + sw * 1.4, 14.6);
    c.bezierCurveTo(4.4 + sw, 9, 5.0, 2, 2.8, -3.6); c.closePath(); PA_fs(c, L.hair, PA_OUT, 1.5);
    c.strokeStyle = L.hairDt; c.lineWidth = 1; c.beginPath(); c.moveTo(1.2, 0); c.quadraticCurveTo(2.6 + sw * 0.5, 8, 1.0 + sw * 1.4, 14.5); c.stroke();
    PA_rr(c, -2.9, -5.0, 5.8, 2.8, 1.2); PA_fs(c, '#d9574a', PA_OUT, 1.2);
  }
  if (hs.bun && !hat) {
    var by = top + 0.2;
    PA_ell(c, 0, by, 5.4, 4.8); PA_fs(c, L.hair, PA_OUT, 1.5);
    c.strokeStyle = L.hairDt; c.lineWidth = 1; c.beginPath(); c.arc(0, by, 2.6, 0.5, 4.6); c.stroke();
    PA_shine(c, L, -3.2, by - 1.0, -1.8, by - 3.2, 0.8, by - 3.0);
  }
  if (hs.braids) { PA_braid(c, L, -4.8, 8.6, 4, sw * 0.8); PA_braid(c, L, 4.8, 8.6, 4, sw * 0.8); }
  PA_hat(c, L, 'back', P);
  if (L.headphones) PA_headphones(c, L, 'back');
}

// ---------- side of the head (facing +x) ----------
function PA_capS(c, hs, vt, sw, smooth) {
  var Rx = PA_R.rx, Ry = PA_R.ry, vb = hs.vb, top = -Ry - vt, bx = -Rx - vb, fr = hs.fringe;
  if (smooth && fr === 'swoop') fr = 'arc';
  var over = fr === 'bangs' || fr === 'curly' || fr === 'tousled' || fr === 'tuft' || fr === 'side';
  var Fx = over ? 10.0 : fr === 'swoop' ? 8.8 : 8.3, Fy = over ? -4.9 : fr === 'high' ? -7.4 : -6.0;
  var cover = hs.drop > 3;
  c.beginPath();
  if (hs.scallop && !smooth) {
    var cx = -1.5, cy = -1.5, rx = Rx + vb - 1.5, ry = Ry + vt - 1.5, yb = cover ? 8.6 : 6.4;
    var u0 = 1.42, u1 = -(Math.PI / 2 + Math.asin(PA_clamp((yb - cy) / ry, -0.5, 0.85)));
    Fx = cx + rx * Math.sin(u0); Fy = cy - ry * Math.cos(u0);
    PA_scallopArc(c, cx, cy, rx, ry, u0, u1, hs.scallop, 2.6, true);
  } else {
    c.moveTo(Fx, Fy);
    if (fr === 'swoop') c.bezierCurveTo(Fx + 3.4, top - 2.4, 4, top - 1.4, -0.5, top);
    else if (over) c.bezierCurveTo(Fx + 1.0, -Ry * 0.8 - vt, 5, top, -0.5, top);
    else c.bezierCurveTo(Fx - 0.2, -Ry * 0.82 - vt * 0.9, 4.2, top, -0.5, top);
    if (hs.under) { c.bezierCurveTo(-Rx * 0.7, top, bx, -Ry * 0.7 - vt * 0.5, bx + 0.2, -3.8); c.lineTo(3.6, -3.9); c.quadraticCurveTo(6.6, -2.7, Fx - 0.2, Fy + 1.1); c.closePath(); return; }
    c.bezierCurveTo(-Rx * 0.7, top, bx, -Ry * 0.68 - vt * 0.5, bx, -1);
  }
  if (hs.back === 'bob') {
    c.lineTo(bx + 0.1, 8.6); c.quadraticCurveTo(bx + 0.4, 12.6, -7, 12.6); c.lineTo(-0.4, 12.0); c.quadraticCurveTo(2.8, 11.6, 2.6, 7); c.lineTo(2.8, -3.7);
  } else if (hs.back === 'long' || hs.back === 'wavy') {
    if (hs.back === 'wavy') { c.bezierCurveTo(bx - 2.4, 4, bx + 1.4, 9, bx - 1.4 + sw * 0.4, 14); c.bezierCurveTo(bx - 2.0 + sw * 0.7, 18, bx + 0.6 + sw, 21.6, -8.5 + sw, 22.0); }
    else { c.lineTo(bx - 0.3 + sw * 0.3, 12); c.quadraticCurveTo(bx + sw, 22.8, -8.6 + sw, 23.4); }
    c.lineTo(-6.2 + sw, 21.6); c.lineTo(-3.6 + sw * 0.9, 22.4); c.quadraticCurveTo(-1.4 + sw * 0.4, 16, -0.9, 11); c.lineTo(1.6, 10.6); c.quadraticCurveTo(2.9, 8, 2.7, 4); c.lineTo(2.8, -3.7);
  } else if (cover) {
    c.quadraticCurveTo(bx + 1.4, 9.6, -7, 10.4); c.lineTo(-1.2, 10.2); c.quadraticCurveTo(2.7, 9.6, 2.5, 6); c.lineTo(2.8, -3.7);
  } else {
    if (!(hs.scallop && !smooth)) c.bezierCurveTo(bx, 3.4, -Rx + 0.6, 6.4, -6.6, 7.6); else c.lineTo(-6.6, 7.6);
    c.lineTo(-5.6, 4.6); c.quadraticCurveTo(-6.0, -0.8, -3.0, -1.5); c.quadraticCurveTo(-0.4, -1.7, 0.2, 0.6); c.lineTo(0.5, 2.4); c.quadraticCurveTo(1.5, -2.0, 3.6, -3.8);
  }
  if (hs.scallop && !smooth) { c.quadraticCurveTo(5.4, -2.2, 7.0, -4.6); c.quadraticCurveTo(8.4, -2.4, Fx - 0.6, Fy + 1.6); c.quadraticCurveTo(Fx + 0.6, Fy + 1.2, Fx, Fy); }
  else if (over) { c.quadraticCurveTo(6.6, -2.7, Fx - 0.2, Fy + 1.1); }
  else c.quadraticCurveTo(6.6, -4.2, Fx, Fy);
  c.closePath();
}
function PA_eyeS(c, L, P) {
  var x = 6.1, y = 1.7, e = P.eyes;
  c.lineCap = 'round';
  if (e === 'closed') { c.strokeStyle = L.eye; c.lineWidth = 1.25; c.beginPath(); c.moveTo(x - 1.5, y + 0.3); c.quadraticCurveTo(x, y + 1.6, x + 1.5, y + 0.3); c.stroke(); return; }
  if (e === 'happy') { c.strokeStyle = L.eye; c.lineWidth = 1.4; c.beginPath(); c.moveTo(x - 1.7, y + 1.0); c.quadraticCurveTo(x, y - 2.4, x + 1.7, y + 1.0); c.stroke(); return; }
  PA_ell(c, x, y, 1.4, 2.4); c.fillStyle = L.eye; c.fill();
  PA_dot(c, x - 0.35 * PA_fx, y - 1.0, 0.68, '#ffffff');
  if (e === 'half') { c.fillStyle = L.skin; c.fillRect(x - 2.3, y - 3.0, 4.6, 2.3); c.strokeStyle = L.eye; c.lineWidth = 1.1; PA_line(c, x - 1.6, y - 0.7, x + 1.6, y - 0.7); }
  else if (e === 'glare') {
    c.fillStyle = L.skin; c.beginPath(); c.moveTo(x - 2.4, y - 3.3); c.lineTo(x + 2.4, y - 3.3); c.lineTo(x + 2.4, y - 0.2); c.lineTo(x - 2.4, y - 2.0); c.closePath(); c.fill();
    c.strokeStyle = L.eye; c.lineWidth = 1.1; PA_line(c, x + 1.6, y - 0.55, x - 1.6, y - 1.75);
  }
  if (L.lashes && e !== 'glare' && e !== 'half') { c.strokeStyle = L.eye; c.lineWidth = 1.05; c.beginPath(); c.moveTo(x + 1.0, y - 2.3); c.quadraticCurveTo(x - 0.8, y - 3.0, x - 2.3, y - 1.2); c.stroke(); }
}
function PA_faceS(c, L, P) {
  var k = P.brows, m = P.mouth, o = P.mouthOpen, b = L.beard;
  if (L.age === 2) { c.strokeStyle = L.skinSh; c.lineWidth = 0.9; c.lineCap = 'round'; c.beginPath(); c.moveTo(3.6, 0.9); c.lineTo(2.5, 0.4); c.moveTo(3.6, 2.2); c.lineTo(2.6, 2.8); c.moveTo(6.6, 4.8); c.quadraticCurveTo(5.9, 6.0, 6.3, 7.2); c.stroke(); }
  PA_eyeS(c, L, P);
  // beard
  c.lineJoin = 'round';
  if (b === 'beard') {
    c.beginPath(); c.moveTo(0.4, 1.6); c.bezierCurveTo(1.6, 4.6, 3.4, 7.0, 5.4, 6.6); c.bezierCurveTo(6.0, 5.0, 8.4, 4.6, 10.1, 4.9); c.quadraticCurveTo(10.9, 7.6, 9.6, 9.8); c.quadraticCurveTo(7.4, PA_R.ry + 2.8, 3.0, PA_R.ry + 2.0);
    c.quadraticCurveTo(-1.8, PA_R.ry + 0.8, -2.8, 6.2); c.quadraticCurveTo(-1.0, 4.6, 0.4, 1.6); c.closePath(); PA_fs(c, L.hair, L.hairSh, 1);
    c.beginPath(); c.moveTo(10.1, 4.9); c.quadraticCurveTo(10.9, 7.6, 9.6, 9.8); c.quadraticCurveTo(7.4, PA_R.ry + 2.8, 3.0, PA_R.ry + 2.0); c.quadraticCurveTo(-1.8, PA_R.ry + 0.8, -2.8, 6.2); c.strokeStyle = PA_OUT; c.lineWidth = 1.5; c.stroke();
    PA_ell(c, 8.2, 6.9, 1.6, 1.1); c.fillStyle = PA_mix(L.skin, L.hair, 0.12); c.fill();
  } else if (b === 'moustache' || b === 'goatee') {
    c.beginPath(); c.moveTo(10.1, 4.5); c.quadraticCurveTo(10.5, 6.3, 8.2, 6.5); c.quadraticCurveTo(6.3, 6.3, 6.1, 5.2); c.quadraticCurveTo(8.2, 5.1, 10.1, 4.5); c.closePath(); PA_fs(c, L.hair, L.hairSh, 0.9);
    if (b === 'goatee') { PA_ell(c, 7.6, 9.4, 2.3, 1.7); PA_fs(c, L.hair, L.hairSh, 0.9); }
  }
  // mouth
  c.lineCap = 'round'; c.strokeStyle = L.lip; c.lineWidth = 1.15;
  if (m === 'open' && o > 0.12) {
    var h = 0.8 + 2.2 * o;
    c.beginPath(); c.moveTo(9.5, 5.9); c.lineTo(6.9, 6.1); c.quadraticCurveTo(7.0, 6.3 + h, 9.2, 6.2 + h * 0.85); c.closePath(); c.fillStyle = '#7a2a2a'; c.fill(); c.lineWidth = 0.9; c.stroke();
  } else if (b !== 'moustache') {
    c.beginPath();
    if (m === 'frown') { c.moveTo(8.9, 6.5); c.quadraticCurveTo(7.7, 6.0, 6.8, 7.3); }
    else if (m === 'flat') { c.moveTo(8.9, 6.6); c.lineTo(7.0, 6.7); }
    else { c.moveTo(8.9, 6.7); c.quadraticCurveTo(7.7, 7.5, 6.6, 6.1); }
    c.stroke();
  }
}
function PA_browS(c, L, P) {
  var k = P.brows;
  c.strokeStyle = L.brow; c.lineWidth = k === 1 ? 1.55 : 1.25; c.lineCap = 'round'; c.beginPath();
  if (k === 1) { c.moveTo(3.9, -4.4); c.lineTo(7.9, -2.0); }
  else if (k === 2) { c.moveTo(3.9, -3.8); c.quadraticCurveTo(6.0, -5.6, 7.9, -4.0); }
  else if (k === 3) { c.moveTo(3.9, -2.7); c.lineTo(7.9, -4.2); }
  else { c.moveTo(3.9, -3.0); c.quadraticCurveTo(6.0, -4.4, 7.9, -3.2); }
  c.stroke();
}
function PA_headS(c, L, P) {
  var Rx = PA_R.rx, Ry = PA_R.ry, hs = L.hs, hat = L.hat, vt = hs.vt || 0, vb = hs.vb || 0, sw = P.sway, top, bx = -Rx - vb;
  var earsHidden = !hs.none && hs.drop > 3;
  c.lineJoin = 'round'; c.lineCap = 'round';
  if (hat) vt = Math.min(vt, 1.2);
  top = -Ry - vt;
  // tails and buns behind the skull
  if (hs.pony) {
    c.beginPath(); c.moveTo(bx + 1.4, -5.6); c.bezierCurveTo(bx - 5.6 + sw * 0.5, -7.0, bx - 8.0 + sw, 2, bx - 4.8 + sw * 1.8, 12);
    c.quadraticCurveTo(bx - 2.8 + sw * 1.5, 10, bx - 2.2 + sw, 7.4); c.bezierCurveTo(bx - 1.4, 3, bx - 0.2, 0.6, bx + 1.6, -0.4); c.closePath(); PA_fs(c, L.hair, PA_OUT, 1.5);
    c.strokeStyle = L.hairDt; c.lineWidth = 1; c.beginPath(); c.moveTo(bx - 2.4, -3.4); c.quadraticCurveTo(bx - 5.0 + sw, 2, bx - 3.8 + sw * 1.6, 9.4); c.stroke();
  }
  if (hs.bun && !hat) {
    PA_ell(c, bx + 2.6, top + 3.0, 5.0, 4.6); PA_fs(c, L.hair, PA_OUT, 1.5);
    c.strokeStyle = L.hairDt; c.lineWidth = 1; c.beginPath(); c.arc(bx + 2.6, top + 3.0, 2.5, 1.2, 5.0); c.stroke();
  }
  // skull + face
  PA_headPathS(c); c.fillStyle = L.skin; c.fill();
  PA_save(c); c.clip();
  c.fillStyle = L.skinSh; c.fillRect(-Rx - 1, -Ry - 1, Rx * 2 + 4, Ry * 2 + 2);
  PA_ell(c, -0.4 - 1.4 * PA_fx, -1.4, Rx + 0.4, Ry + 0.2); c.fillStyle = L.skin; c.fill();
  c.globalAlpha = Math.min(0.8, 0.42 * P.blushK); c.fillStyle = L.blush; PA_ell(c, 4.6, 4.8, 2.2, 1.45); c.fill(); c.globalAlpha = 1;
  if (L.beard === 'stubble') { c.globalAlpha = 0.2; c.fillStyle = L.hair; c.beginPath(); c.moveTo(1.4, 0.6); c.quadraticCurveTo(5.6, 4.9, 11, 4.7); c.lineTo(11, 12); c.lineTo(-3, 12); c.lineTo(-2.8, 6.2); c.quadraticCurveTo(-0.4, 4.6, 1.4, 0.6); c.fill(); c.globalAlpha = 1; }
  PA_restore(c);
  PA_headPathS(c); c.strokeStyle = PA_OUT; c.lineWidth = PA_OL; c.stroke();
  PA_faceS(c, L, P);
  if (!earsHidden) {
    c.beginPath(); c.moveTo(-1.2, 0.6); c.bezierCurveTo(-4.6, -1.2, -5.6, 3.6, -3.2, 5.0); c.quadraticCurveTo(-1.8, 5.4, -1.4, 4.0); c.closePath(); c.fillStyle = L.skin; c.fill();
    c.beginPath(); c.moveTo(-1.2, 0.6); c.bezierCurveTo(-4.6, -1.2, -5.6, 3.6, -3.2, 5.0); c.quadraticCurveTo(-1.8, 5.4, -1.4, 4.0); c.strokeStyle = PA_mix(L.skinSh, PA_OUT, 0.45); c.lineWidth = 1.1; c.stroke();
    c.strokeStyle = L.skinSh; c.lineWidth = 0.9; c.beginPath(); c.moveTo(-2.2, 1.8); c.quadraticCurveTo(-3.6, 2.4, -2.8, 3.8); c.stroke();
    if (L.earrings) { PA_dot(c, -2.8, 6.0, 1.6, PA_OUT); PA_dot(c, -2.8, 6.0, 0.95, L.earrings); }
  }
  // hair
  if (hs.none) {
    if (hs.tufts) {
      c.beginPath(); c.moveTo(0.6, -2.8); c.lineTo(0.7, 2.6); c.quadraticCurveTo(-0.2, -1.4, -3.0, -1.5); c.quadraticCurveTo(-6.0, -0.8, -5.6, 4.6); c.lineTo(-6.6, 7.6);
      c.bezierCurveTo(-Rx + 0.4, 6.4, -Rx - 0.9, 3.4, -Rx - 0.9, -1.0); c.quadraticCurveTo(-Rx - 0.6, -3.6, -7.4, -3.8); c.quadraticCurveTo(-3, -2.2, 1.3, -2.8); c.closePath(); PA_fs(c, L.hair, PA_OUT, 1.4);
    }
    if (!hat) { c.strokeStyle = L.skinLi; c.lineWidth = 1.6; c.globalAlpha = 0.9; c.beginPath(); c.moveTo(-6.6, -5.4); c.quadraticCurveTo(-5.0, -7.9, -2.0, -8.4); c.stroke(); c.globalAlpha = 1; }
  } else {
    if (hs.under) { PA_capS(c, PA_HAIR.buzz, 0.5, 0, true); c.fillStyle = PA_mix(L.hair, L.skin, 0.38); c.fill(); c.strokeStyle = PA_OUT; c.lineWidth = 1.2; c.stroke(); }
    PA_capS(c, hs, vt, sw, !!hat);
    c.fillStyle = hs.thin ? PA_mix(L.hair, L.skin, 0.3) : L.hair; c.fill();
    if (!hs.thin) {
      PA_save(c); c.clip();
      c.fillStyle = L.hairSh;
      if (PA_fx > 0) { if (hs.back || hs.drop > 3) { c.beginPath(); c.moveTo(-1.5, 6); c.lineTo(5, 6); c.lineTo(5, 26); c.lineTo(-5 + sw, 26); c.closePath(); c.fill(); } }
      else { c.beginPath(); c.moveTo(bx - 6, top - 3); c.lineTo(-Rx + 2.0, top + 1.5); c.quadraticCurveTo(bx + 3.4, 0, bx + 2.8 + sw, 26); c.lineTo(bx - 8, 26); c.closePath(); c.fill(); }
      if (hs.back) { c.globalAlpha = 0.6; c.fillRect(bx - 6, hs.back === 'bob' ? 10.4 : 20.4, 30, 8); c.globalAlpha = 1; }
      c.strokeStyle = L.hairDt; c.lineWidth = 1;
      if (hs.back === 'long' || hs.back === 'wavy') { c.beginPath(); c.moveTo(-5.4, 2); c.quadraticCurveTo(-6.6 + sw * 0.4, 12, -6.0 + sw, 20.5); c.stroke(); }
      else if (hs.scallop) { c.beginPath(); c.arc(-6.0, -5.0, 1.8, 0.4, 3.4); c.moveTo(1.4, -8.6); c.arc(-0.4, -8.6, 1.8, 0, 3.0); c.moveTo(-7.2, 1.6); c.arc(-8.8, 2.0, 1.7, -0.3, 2.6); c.stroke(); }
      else if (!hs.under) { c.beginPath(); c.moveTo(-Rx + 1.6, 1.6); c.quadraticCurveTo(-Rx + 1.0, 4, -7.2, 5.8); c.stroke(); }
      PA_restore(c);
      PA_capS(c, hs, vt, sw, !!hat);
    }
    c.strokeStyle = PA_OUT; c.lineWidth = hs.thin ? 1.2 : 1.5; c.stroke();
    if (!hs.thin && !hat) { if (PA_fx > 0) PA_shine(c, L, -8.0, top + 5.4, -6.0, top + 2.0, -1.6, top + 1.7); else PA_shine(c, L, 6.2, top + 4.6, 4.4, top + 1.9, 0.4, top + 1.7); }
    if (hs.pony) { PA_rr(c, bx - 0.6, -5.6, 2.8, 5.0, 1.2); PA_fs(c, '#d9574a', PA_OUT, 1.2); }
    if (hs.braids) PA_braid(c, L, -3.8, 7.6, 4, sw * 0.9);
  }
  PA_browS(c, L, P);
  if (L.glasses) {
    var fc = L.glassesColor, sun = L.glasses === 'sunglasses';
    PA_rr(c, 3.5, -0.9, 5.4, 5.1, sun ? 2.2 : 1.8); c.fillStyle = sun ? '#3a2f3d' : 'rgba(255,255,255,0.28)'; c.fill(); c.strokeStyle = fc; c.lineWidth = 1.25; c.stroke();
    c.lineWidth = 1.2; PA_line(c, 3.5, 0.7, earsHidden ? 3.0 : -2.0, 1.0);
  }
  PA_hat(c, L, 'side', P);
  if (L.headphones) PA_headphones(c, L, 'side');
}

// ============================================================================================
// ASSEMBLY (vector rendering of one pose, in body units)
// ============================================================================================
function PA_headXf(c, P) { c.translate(P.headX, P.headY); if (P.headRot) c.rotate(P.headRot); }

// both legs for the front / back views, the one nearer the viewer last
function PA_legsFB(c, L, P, view) {
  if (P.legBFirst) { PA_leg(c, L, P.legB); PA_shoe(c, L, P.legB[4], P.legB[5], view, 0, P.tapB); PA_leg(c, L, P.legA); PA_shoe(c, L, P.legA[4], P.legA[5], view, 0, 0); }
  else { PA_leg(c, L, P.legA); PA_shoe(c, L, P.legA[4], P.legA[5], view, 0, 0); PA_leg(c, L, P.legB); PA_shoe(c, L, P.legB[4], P.legB[5], view, 0, P.tapB); }
}
function PA_drawFront(c, L, P) {
  var hx = P.hipX, hy = P.hipY, legsLast = P.sit > 0.5 && !L.skirt;
  PA_save(c); PA_headXf(c, P); PA_hairBackF(c, L, P); PA_restore(c);
  if (!legsLast) PA_legsFB(c, L, P, 'front');
  PA_save(c); c.translate(hx, hy);
  PA_pelvisFB(c, L, false);
  if (L.skirt) PA_skirtFB(c, L, L.skirt, P.sway);
  PA_torsoFB(c, L, P, false);
  PA_neckFront(c, L, P, P.headX - hx, P.headY - hy);
  PA_collarFB(c, L, P, false);
  if (L.bag === 'handbag') PA_bagFB(c, L, P, false);
  PA_restore(c);
  if (legsLast) { PA_leg(c, L, P.legA); PA_leg(c, L, P.legB); PA_shoe(c, L, P.legA[4], P.legA[5], 'front', 0, 0); PA_shoe(c, L, P.legB[4], P.legB[5], 'front', 0, 0); }
  PA_arm(c, L, P.armA, P.watch); PA_arm(c, L, P.armB, 0);
  PA_save(c); PA_headXf(c, P); PA_headF(c, L, P); PA_restore(c);
}

function PA_drawBack(c, L, P) {
  var hx = P.hipX, hy = P.hipY;
  if (P.armsBehind) { PA_arm(c, L, P.armA, 0); PA_arm(c, L, P.armB, 0); }
  else if (P.armBBehind) PA_arm(c, L, P.armB, 0);
  PA_legsFB(c, L, P, 'back');
  PA_neckLine(c, L, hx, P.shY + 1, P.headX, P.headY + 6);
  PA_save(c); c.translate(hx, hy);
  PA_pelvisFB(c, L, true);
  if (L.skirt) PA_skirtFB(c, L, L.skirt, P.sway);
  PA_torsoFB(c, L, P, true);
  PA_collarFB(c, L, P, true);
  if (L.bag === 'handbag') PA_bagFB(c, L, P, true);
  PA_restore(c);
  if (!P.armsBehind) { PA_arm(c, L, P.armA, P.watch); if (!P.armBBehind) PA_arm(c, L, P.armB, 0); }
  if (L.bag === 'backpack') { PA_save(c); c.translate(hx, hy); PA_backpackBack(c, L, P); PA_restore(c); }
  PA_save(c); PA_headXf(c, P); PA_headB(c, L, P); PA_restore(c);
}

function PA_drawSide(c, L, P) {
  var hx = P.hipX, hy = P.hipY, nearLegLast = P.sit > 0.5 && !L.skirt;
  PA_arm(c, L, P.armA, 0);
  PA_leg(c, L, P.legA); PA_shoe(c, L, P.legA[4], P.legA[5], 'side', P.footRotA, 0);
  if (!nearLegLast) { PA_leg(c, L, P.legB); PA_shoe(c, L, P.legB[4], P.legB[5], 'side', P.footRotB, P.tapB); }
  if (L.bag === 'backpack') { PA_save(c); c.translate(hx, hy); c.rotate(P.lean); PA_backpackS(c, L, P, false); PA_restore(c); }
  PA_neckLine(c, L, P.shX - 0.2, P.shY + 1, P.headX - 0.8, P.headY + 6);
  PA_save(c); c.translate(hx, hy);
  PA_pelvisS(c, L);
  if (L.skirt) PA_skirtS(c, L, L.skirt, P.sway, P.spread);
  c.rotate(P.lean);
  PA_torsoS(c, L, P);
  PA_collarS(c, L, P);
  if (L.bag === 'backpack') PA_backpackS(c, L, P, true);
  PA_restore(c);
  if (nearLegLast) { PA_leg(c, L, P.legB); PA_shoe(c, L, P.legB[4], P.legB[5], 'side', P.footRotB, 0); }
  if (L.bag === 'handbag') { PA_save(c); c.translate(hx, hy); PA_bagS(c, L, P); PA_restore(c); }
  PA_save(c); PA_headXf(c, P); PA_headS(c, L, P); PA_restore(c);
  PA_arm(c, L, P.armB, P.watch);
}

// Draws pose P at the origin of c, in body units (the caller has already applied position and scale).
function PA_render(c, L, P, noShadow) {
  PA_save(c);
  c.globalAlpha = 1; c.setLineDash([]); c.globalCompositeOperation = 'source-over';
  if (!noShadow) {
    var k = 1 - Math.min(0.35, P.hop * 0.06) + (P.sit > 0 ? 0.1 * P.sit : 0);
    c.fillStyle = 'rgba(40,26,12,0.22)'; PA_ell(c, P.view === 'side' ? P.flip * 0.8 : 0, 0.6, 12.6 * k, 4.4 * k); c.fill();
  }
  if (P.flip < 0) c.scale(-1, 1);
  PA_fx = P.flip;
  c.lineJoin = 'round'; c.lineCap = 'round';
  if (P.view === 'front') PA_drawFront(c, L, P);
  else if (P.view === 'back') PA_drawBack(c, L, P);
  else PA_drawSide(c, L, P);
  PA_fx = 1;
  PA_restore(c);
}
// Uncached path: used when the context is rotated / skewed or caching is switched off.
function PA_live(c, p, L, F, ps) {
  var d0 = PA_depth;
  try {
    PA_save(c);
    c.translate(+p.x || 0, +p.y || 0); c.scale(L.scale * ps, L.scale * ps);
    PA_render(c, L, PA_pose(F, L), false);
    PA_restore(c);
  } catch (e) { while (PA_depth > d0) PA_restore(c); PA_fx = 1; PA_stats.errors++; PA_stats.lastError = String(e && e.stack || e); }
  PA_stats.live++;
}

// ============================================================================================
// SPRITE CACHE
// Every (look, frame, device scale) is baked once into an offscreen canvas and then blitted 1:1 on whole
// device pixels. New bakes are rationed per frame; while a bake is pending (or the zoom is still changing)
// the nearest cached bitmap is shown instead, stretched if needed.
// ============================================================================================
var PA_useCache = true;
var PA_CAP_BYTES = 48 * 1024 * 1024;      // memory cap for baked sprites (LRU)
var PA_BAKE_MS = 3.5;                     // bake budget per frame
var PA_MAX_BAKE_SCALE = 6;
var PA_all = new Set();                   // every live sprite
var PA_bytes = 0, PA_tick = 0;
var PA_stats = { bakes: 0, hits: 0, stretched: 0, live: 0, evicted: 0, bakeMs: 0, errors: 0, lastError: '' };
var PA_bud = { t: NaN, start: -1e9, spent: 0 };
var PA_HARD_MS = 7;                       // a brand-new person may exceed the budget up to this much, then waits a frame
var PA_scales = [];                       // recently seen device scales: { s, first, last }
var PA_SKIP = { skip: true };
var PA_DEBOUNCE_MS = 120;                 // wait this long after a zoom change before re-baking at the new scale

function PA_now() { return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(); }
function PA_newCanvas(w, h) {
  if (typeof document !== 'undefined' && document.createElement) { var cv = document.createElement('canvas'); cv.width = w; cv.height = h; return cv; }
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  return null;
}
function PA_budgetOk(t, now) {
  // a new frame = the engine's time argument moved on (or, failing that, a long pause)
  if ((t !== PA_bud.t && now - PA_bud.start >= 6) || now - PA_bud.start > 250 || now < PA_bud.start) { PA_bud.t = t; PA_bud.start = now; PA_bud.spent = 0; }
  return PA_bud.spent < PA_BAKE_MS;
}
// Called on every draw: remembers since when each device scale has been in continuous use, so that a zoom
// animation does not trigger a bake at every intermediate scale (re-bake ~120 ms after the zoom settles).
var PA_scaleCur = null;
function PA_scaleTouch(es, now) {
  var e = PA_scaleCur, i;
  if (!e || e.s !== es) {
    e = null;
    for (i = 0; i < PA_scales.length; i++) if (PA_scales[i].s === es) { e = PA_scales[i]; break; }
    if (!e) {
      e = { s: es, first: PA_all.size === 0 ? now - 1e6 : now, last: now };     // nothing cached yet: no reason to wait
      if (PA_scales.length >= 6) { var o = 0; for (i = 1; i < PA_scales.length; i++) if (PA_scales[i].last < PA_scales[o].last) o = i; PA_scales[o] = e; }
      else PA_scales.push(e);
    }
    PA_scaleCur = e;
  }
  if (now - e.last > 1500) e.first = now;      // back after a long absence
  e.last = now;
  return e;
}
function PA_evict() {
  var arr = Array.from(PA_all), i, s, L, j;
  arr.sort(function (a, b) { return a.used - b.used; });
  for (i = 0; i < arr.length && PA_bytes > PA_CAP_BYTES * 0.7; i++) {
    s = arr[i]; L = s.L;
    PA_all.delete(s); PA_bytes -= s.bytes; PA_stats.evicted++;
    if (L.spr.get(s.k1) === s) L.spr.delete(s.k1);
    if (L.frames.get(s.fk) === s) L.frames.delete(s.fk);
    for (j = 0; j < 4; j++) if (L.lastDir[j] === s) L.lastDir[j] = null;
    if (L.lastAny === s) L.lastAny = null;
    s.cv.width = s.cv.height = 0; s.cv = null;
  }
}
function PA_bake(L, F, sc) {
  var P = PA_pose(F, L), A = P.armA, B = P.armB, la = P.legA, lb = P.legB;
  // bounding box in body units (facing +x for side views; mirrored below)
  var side = P.view === 'side', hb = side ? L.bxB : L.bxF, hf = side ? L.bxS : L.bxF, ht = L.byT, bw = side ? 15.5 : L.HW + 7.5;
  if (Math.abs(P.headRot) > 0.12) { hb = hf = ht = Math.max(hb, hf, ht) + 1.5; }
  var x0 = Math.min(P.headX - hb, A[4] - 4.6, B[4] - 4.6, A[2] - 4.6, B[2] - 4.6, la[4] - 9, lb[4] - 9, la[2] - 6, lb[2] - 6, P.hipX - bw, -14.5);
  var x1 = Math.max(P.headX + hf, A[4] + 4.6, B[4] + 4.6, A[2] + 4.6, B[2] + 4.6, la[4] + 9.5, lb[4] + 9.5, la[2] + 6, lb[2] + 6, P.hipX + bw, 14.5);
  var y0 = Math.min(P.headY - ht, A[5] - 4.6, B[5] - 4.6), y1 = Math.max(6, la[5] + 5, lb[5] + 5);
  if (P.flip < 0) { var tmp = x0; x0 = -x1; x1 = -tmp; }
  var ox = Math.ceil(-x0 * sc) + 1, oy = Math.ceil(-y0 * sc) + 1, w = ox + Math.ceil(x1 * sc) + 1, h = oy + Math.ceil(y1 * sc) + 1;
  var cv = PA_newCanvas(w, h);
  if (!cv) return null;
  var g = cv.getContext('2d'), d0 = PA_depth;
  if (!g) return null;
  try { g.translate(ox, oy); g.scale(sc, sc); PA_render(g, L, P, false); }
  catch (e) { while (PA_depth > d0) PA_restore(g); PA_fx = 1; PA_stats.errors++; PA_stats.lastError = String(e && e.stack || e); }
  return { cv: cv, ox: ox, oy: oy, w: w, h: h, sc: sc, bytes: w * h * 4, used: PA_tick, L: L, fk: F.key, k1: '', di: F.di };
}
function PA_store(L, F, spr, k1) {
  spr.k1 = k1;
  L.spr.set(k1, spr); L.frames.set(F.key, spr); L.lastDir[F.di] = spr; L.lastAny = spr;
  PA_all.add(spr); PA_bytes += spr.bytes; PA_stats.bakes++;
  if (PA_bytes > PA_CAP_BYTES) PA_evict();
}
// Returns the sprite to show for this frame (possibly a stand-in at another scale or a neighbouring frame).
function PA_sprite(L, F, sc, es, t) {
  var now = PA_now(), se = PA_scaleTouch(es, now);
  var bs = sc > PA_MAX_BAKE_SCALE ? PA_MAX_BAKE_SCALE : sc;
  var k1 = F.key + '@' + Math.round(bs * 1024);
  var spr = L.spr.get(k1);
  PA_tick++;
  if (spr) { spr.used = PA_tick; L.lastDir[F.di] = spr; L.lastAny = spr; PA_stats.hits++; return spr; }
  var stable = now - se.first >= PA_DEBOUNCE_MS, ok = PA_budgetOk(t, now);
  if (!ok || !stable) {
    // stand-ins, best first: same frame at another scale, last frame shown in this direction, anything of this look
    var alt = L.frames.get(F.key) || L.lastDir[F.di] || L.lastAny;
    if (alt && alt.cv) { alt.used = PA_tick; PA_stats.stretched++; return alt; }
    if (PA_bud.spent >= PA_HARD_MS) return PA_SKIP;   // nothing to show yet and the frame is full: appear next frame
  }
  spr = PA_bake(L, F, bs);
  var took = PA_now() - now;
  PA_bud.spent += Math.max(3.5, took * 2.5);             // 'took' misses the deferred raster, so count every bake as a full 3.5 ms slot
  PA_stats.bakeMs += took;
  if (!spr) return null;
  PA_store(L, F, spr, k1);
  return spr;
}

// ============================================================================================
// PUBLIC API
// ============================================================================================
function drawPerson(c, p, t, look) {
  if (!c || !p) return;
  var L, F, ps, m = null;
  try {
    L = PA_norm(look); t = +t || 0; F = PA_frame(p, t, L, false); ps = p.scale > 0 ? +p.scale : 1;
    if (PA_useCache && c.getTransform) m = c.getTransform();
  } catch (e) { PA_stats.errors++; PA_stats.lastError = String(e && e.stack || e); return; }
  if (!m || m.b !== 0 || m.c !== 0 || m.a !== m.d || !(m.a > 0)) { PA_live(c, p, L, F, ps); return; }
  var sc = m.a * L.scale * ps, spr = null;
  try { spr = PA_sprite(L, F, sc, m.a, t); } catch (e2) { spr = null; PA_stats.errors++; PA_stats.lastError = String(e2 && e2.stack || e2); }
  if (spr === PA_SKIP) return;
  if (!spr || !spr.cv) { PA_live(c, p, L, F, ps); return; }
  var dx = Math.round(m.a * (+p.x || 0) + m.e), dy = Math.round(m.d * (+p.y || 0) + m.f);
  c.setTransform(1, 0, 0, 1, 0, 0);
  try {
    if (spr.sc === sc) c.drawImage(spr.cv, dx - spr.ox, dy - spr.oy);
    else { var k = sc / spr.sc; c.drawImage(spr.cv, dx - spr.ox * k, dy - spr.oy * k, spr.w * k, spr.h * k); }
  } catch (e3) { /* never break the frame */ }
  c.setTransform(m);
}

function PA_hairTop(L) {
  if (L.hat === 'beanie') return 6.6;
  if (L.hat === 'cap') return 4.4;
  if (L.hat === 'sunhat') return 5.2;
  if (L.hs.none) return 0.8;
  return (L.hs.vt || 0) + (L.hs.bun ? 6.2 : 0) + (L.hs.scallop ? 1.4 : 0) + 0.8;
}

// Offsets (world px, relative to p.x / p.y) of the useful attachment points for the current pose.
// Pass the same t as drawPerson to follow the idle breathing exactly (optional).
function personAnchor(p, look, t) {
  var L = PA_norm(look);
  p = p || {};
  var F = PA_frame(p, t === undefined ? 0 : +t || 0, L, true);
  if (t === undefined) F.br = 0;
  var P = PA_pose(F, L), s = L.scale * (p.scale > 0 ? +p.scale : 1), f = P.flip, A = P.armA, B = P.armB, hx, hy;
  if (P.carry === 'item') {
    hx = (A[4] + B[4]) / 2; hy = (A[5] + B[5]) / 2 - 0.5;
    if (P.view === 'side') hx += 2.2;
  } else if (P.hand === 'A') { hx = A[4]; hy = A[5]; B = A; }
  else { hx = B[4]; hy = B[5]; }
  return {
    handX: hx * f * s, handY: hy * s,
    headTopY: (P.headY - PA_R.ry - PA_hairTop(L)) * s,
    leashX: B[4] * f * s, leashY: (B[5] + 1.2) * s
  };
}

// Front-facing bust as a PNG data URL (cached). Optional bg = CSS colour for a soft round backdrop.
var PA_portraits = Object.create(null);
function personPortraitURL(look, size, bg) {
  size = Math.max(16, Math.min(512, Math.round(+size || 96)));
  var key = null;
  try { key = JSON.stringify(look) + '|' + size + '|' + (bg || ''); } catch (e) { key = null; }
  if (key && PA_portraits[key]) return PA_portraits[key];
  if (typeof document === 'undefined') return '';
  var url = '';
  try {
    var cv = document.createElement('canvas'); cv.width = cv.height = size;
    var c = cv.getContext('2d'), L = PA_norm(look), k = size / 42, d0 = PA_depth;
    if (typeof bg === 'string' && bg) { c.fillStyle = bg; c.beginPath(); c.arc(size / 2, size / 2, size / 2, 0, PA_TAU); c.fill(); c.beginPath(); c.arc(size / 2, size / 2, size / 2, 0, PA_TAU); c.clip(); }
    c.translate(size / 2, size * 0.5 + 54.6 * k); c.scale(k, k);
    var F = PA_frame({ dir: 'down', id: 0 }, 1);
    F.br = 0; F.blink = 0; F.gaze = 0;
    try { PA_render(c, L, PA_pose(F, L), true); }
    catch (e2) { while (PA_depth > d0) PA_restore(c); PA_fx = 1; PA_stats.errors++; PA_stats.lastError = String(e2 && e2.stack || e2); }
    url = cv.toDataURL('image/png');
  } catch (e3) { url = ''; }
  if (key && url) PA_portraits[key] = url;
  return url;
}

// Optional helpers for the engine -----------------------------------------------------------
// Bake the standing + walking frames of a look ahead of time (call on a loading / title screen, or a few ms per
// frame). deviceScale = the canvas transform scale the game will draw with. Returns true once everything is baked.
function prewarmPerson(look, deviceScale, maxMs) {
  var L = PA_norm(look), sc = Math.min(PA_MAX_BAKE_SCALE, (+deviceScale || 1) * L.scale), t0 = PA_now(), di, i, F, k1, spr;
  var dirs = ['down', 'up', 'left', 'right'];
  maxMs = maxMs === undefined ? 8 : +maxMs;
  for (i = -1; i < PA_WALK_N * 2; i++) {
    for (di = 0; di < 4; di++) {
      F = PA_frame({ dir: dirs[di], moving: false, id: 0 }, 0, null, true);
      F.br = 0; F.blink = 0; F.gaze = 0; F.key = di + 'i101c0';
      if (i >= PA_WALK_N) { F.moving = true; F.jog = true; F.wf = i - PA_WALK_N; F.key = di + 'j' + F.wf + 'c0'; }
      else if (i >= 0) { F.moving = true; F.wf = i; F.key = di + 'w' + i + 'c0'; }
      k1 = F.key + '@' + Math.round(sc * 1024);
      if (L.spr.has(k1)) continue;
      if (PA_now() - t0 > maxMs) return false;
      spr = PA_bake(L, F, sc);
      if (spr) PA_store(L, F, spr, k1);
    }
  }
  return true;
}
function peopleCacheStats() {
  return { sprites: PA_all.size, megabytes: Math.round(PA_bytes / 104857.6) / 10, bakes: PA_stats.bakes, hits: PA_stats.hits, standIns: PA_stats.stretched, live: PA_stats.live, evicted: PA_stats.evicted, bakeMs: Math.round(PA_stats.bakeMs), errors: PA_stats.errors, lastError: PA_stats.lastError };
}
function peopleCacheClear() {
  PA_all.forEach(function (s) { var L = s.L; L.spr.clear(); L.frames.clear(); L.lastDir = [null, null, null, null]; L.lastAny = null; if (s.cv) { s.cv.width = s.cv.height = 0; } s.cv = null; });
  PA_all.clear(); PA_bytes = 0;
}

// ============================================================================================
// LOOKS
// ============================================================================================
var PA_SKINS = ['#fde3cd', '#f8d3b2', '#f0c29c', '#e2ab7c', '#cc9163', '#ad7444', '#8c5834', '#6d4228'];
var PA_HAIR_NAT = ['#2a2225', '#3b2a22', '#4d3222', '#6b4426', '#8a5530', '#a8572e', '#c97a3a', '#d9a85a', '#ecd08a'];
var PA_HAIR_GREY = ['#8f8d8a', '#b3b0aa', '#d6d2ca', '#ece8e0'];
var PA_HAIR_FUN = ['#f2a0b5', '#3aa89a', '#a58bd6', '#66bde3'];
// main colour -> accents that sit well with it
var PA_TOPCOLS = [
  ['#d9574a', ['#fbf1d8', '#f2c14e', '#3d4a6b']], ['#c9694a', ['#fbf1d8', '#f2c14e', '#3aa89a']], ['#3aa89a', ['#fbf1d8', '#f2c14e', '#f2a0b5']],
  ['#f2c14e', ['#fbf1d8', '#d9574a', '#3f8fc4']], ['#66bde3', ['#fbf1d8', '#f2c14e', '#d9574a']], ['#3f8fc4', ['#fbf1d8', '#f2c14e', '#f2a0b5']],
  ['#f2a0b5', ['#fbf1d8', '#d9574a', '#a58bd6']], ['#a58bd6', ['#fbf1d8', '#f2c14e', '#f2a0b5']], ['#fbf1d8', ['#d9574a', '#3aa89a', '#3f8fc4']],
  ['#5d9d49', ['#fbf1d8', '#f2c14e', '#c9694a']], ['#3f7d3a', ['#fbf1d8', '#f2c14e', '#d9574a']], ['#3d4a6b', ['#fbf1d8', '#d9574a', '#f2c14e']],
  ['#7d4f7a', ['#fbf1d8', '#f2a0b5', '#f2c14e']], ['#d9a441', ['#fbf1d8', '#7a4e2a', '#3d4a6b']], ['#8a6a4a', ['#fbf1d8', '#f2c14e', '#3aa89a']],
  ['#e8e2d6', ['#d9574a', '#3aa89a', '#3d4a6b']], ['#5b6472', ['#fbf1d8', '#f2c14e', '#66bde3']], ['#e58a5a', ['#fbf1d8', '#3aa89a', '#3d4a6b']]
];
var PA_BOTCOLS = ['#4f6d9a', '#3d4f74', '#6f8fb8', '#c9b08a', '#6f7a4a', '#544d5c', '#7a4e2a', '#e6dac0', '#3f3846', '#8d7b6a'];
var PA_SKIRTCOLS = ['#d9574a', '#3aa89a', '#3d4a6b', '#f2c14e', '#a58bd6', '#c9694a', '#544d5c', '#f2a0b5', '#3f7d3a', '#e6dac0'];

function PA_pick(rnd, arr) { return arr[Math.min(arr.length - 1, Math.floor(rnd() * arr.length))]; }
function PA_wpick(rnd, pairs) {   // pairs = [value, weight, value, weight, ...]
  var tot = 0, i, r;
  for (i = 1; i < pairs.length; i += 2) tot += pairs[i];
  r = rnd() * tot;
  for (i = 0; i < pairs.length; i += 2) { r -= pairs[i + 1]; if (r <= 0) return pairs[i]; }
  return pairs[pairs.length - 2];
}

function randomLook(rnd) {
  if (typeof rnd !== 'function') rnd = Math.random;
  var L = {}, fem = rnd() < 0.5, age = PA_wpick(rnd, [0, 46, 1, 32, 2, 22]);
  L.body = fem ? 1 : 0; L.age = age;
  var si = Math.floor(rnd() * PA_SKINS.length); if (si >= PA_SKINS.length) si = PA_SKINS.length - 1;
  L.skin = PA_SKINS[si];
  L.build = PA_wpick(rnd, ['slim', 30, 'regular', 45, 'broad', 25]);
  L.height = Math.round((0.94 + rnd() * 0.13 - (fem ? 0.02 : 0) - (age === 2 ? 0.02 : 0)) * 100) / 100;
  L.lashes = fem ? rnd() < 0.85 : rnd() < 0.06;
  // hair
  if (age === 2) L.hair = PA_pick(rnd, PA_HAIR_GREY);
  else if (age === 1 && rnd() < 0.22) L.hair = PA_pick(rnd, PA_HAIR_GREY.slice(0, 2));
  else if (age === 0 && rnd() < 0.1) L.hair = PA_pick(rnd, PA_HAIR_FUN);
  else if (si >= 4 && rnd() < 0.85) L.hair = PA_pick(rnd, PA_HAIR_NAT.slice(0, 4));
  else L.hair = PA_pick(rnd, PA_HAIR_NAT);
  if (fem) {
    L.hairStyle = age === 2 ? PA_wpick(rnd, ['bun', 24, 'bob', 22, 'curls', 22, 'short', 14, 'wavy', 10, 'ponytail', 8])
      : PA_wpick(rnd, ['bob', 13, 'long', 14, 'wavy', 13, 'ponytail', 14, 'bun', 10, 'curls', 11, 'braids', 10, 'afro', si >= 4 ? 12 : 3, 'short', 6, 'undercut', 4, 'sidepart', 3]);
  } else {
    L.hairStyle = age === 2 ? PA_wpick(rnd, ['balding', 26, 'bald', 14, 'short', 22, 'sidepart', 22, 'buzz', 8, 'curls', 8])
      : PA_wpick(rnd, ['short', 18, 'sidepart', 15, 'quiff', 13, 'undercut', 11, 'buzz', 9, 'bald', age === 1 ? 8 : 3, 'balding', age === 1 ? 7 : 0, 'curls', 8, 'afro', si >= 4 ? 10 : 2, 'long', 4, 'ponytail', 3, 'bun', 3]);
    if (PA_HAIR_FUN.indexOf(L.hair) < 0 && rnd() < (age === 0 ? 0.32 : 0.52)) L.beard = PA_wpick(rnd, ['stubble', 30, 'beard', 30, 'moustache', 22, 'goatee', 18]);
  }
  // outfit
  var tc = PA_pick(rnd, PA_TOPCOLS);
  L.top = PA_wpick(rnd, ['tee', 18, 'hoodie', 12, 'jacket', 10, 'shirt', 8, 'dress', fem ? 16 : 0, 'overalls', 7, 'cardigan', age === 2 ? 18 : 8, 'raincoat', 6, 'sweater', 12]);
  L.topColor = tc[0]; L.topColor2 = PA_pick(rnd, tc[1]);
  if (L.top === 'raincoat') { L.topColor = PA_pick(rnd, ['#f2c14e', '#f2c14e', '#d9574a', '#3aa89a', '#66bde3']); L.topColor2 = '#fbf1d8'; }
  if (L.top === 'shirt') { L.topColor = PA_pick(rnd, ['#fbf1d8', '#f4f0e8', '#cfe3f0', '#f6d9de', '#dfe8cf']); L.topColor2 = PA_pick(rnd, ['#d9574a', '#3d4a6b', '#3aa89a', '#7d4f7a', '#d9a441']); }
  if (L.top === 'overalls') { L.topColor = PA_pick(rnd, ['#4f6d9a', '#6f8fb8', '#3d4f74', '#6f7a4a', '#c9694a', '#8a6a4a']); L.topColor2 = PA_pick(rnd, ['#fbf1d8', '#f2c14e', '#d9574a', '#f2a0b5', '#e8e2d6', '#66bde3']); }
  if (L.top === 'jacket' || L.top === 'cardigan') { if (L.topColor === '#fbf1d8' || L.topColor === '#e8e2d6') L.topColor2 = PA_pick(rnd, ['#d9574a', '#3aa89a', '#3f8fc4']); else L.topColor2 = rnd() < 0.7 ? '#fbf1d8' : L.topColor2; }
  if (L.top === 'tee') L.motif = PA_wpick(rnd, ['plain', 30, 'stripes', 22, 'heart', 8, 'star', 10, 'paw', 10, 'pocket', 10, 'band', 10]);
  else if (L.top === 'sweater') L.motif = PA_wpick(rnd, ['zigzag', 60, 'stripes', 40]);
  else if (L.top === 'dress') L.motif = PA_wpick(rnd, ['plain', 40, 'collar', 30, 'heart', 12, 'stripes', 18]);
  if (L.top === 'tee' || L.top === 'overalls' || L.top === 'dress') L.sleeves = L.top === 'dress' && rnd() < 0.25 ? 'none' : 'short';
  else if ((L.top === 'shirt' || L.top === 'sweater') && rnd() < 0.3) L.sleeves = 'rolled';
  // bottoms
  if (L.top === 'dress') { L.bottom = 'skirt'; L.bottomColor = L.topColor; if (rnd() < 0.25) L.tights = PA_pick(rnd, ['#544d5c', '#3f3846', '#fbf1d8']); }
  else if (L.top === 'overalls') { L.bottom = rnd() < 0.25 ? 'shorts' : 'trousers'; L.bottomColor = L.topColor; }
  else {
    L.bottom = fem ? PA_wpick(rnd, ['jeans', 24, 'trousers', 18, 'shorts', 12, 'skirt', 22, 'leggings', 14, 'longskirt', 10])
                   : PA_wpick(rnd, ['jeans', 38, 'trousers', 40, 'shorts', 22]);
    if (L.top === 'raincoat' && L.bottom === 'longskirt') L.bottom = 'jeans';
    if (L.bottom === 'skirt' || L.bottom === 'longskirt') { L.bottomColor = PA_pick(rnd, PA_SKIRTCOLS); if (L.bottomColor === L.topColor) L.bottomColor = '#544d5c'; }
    else if (L.bottom === 'jeans') L.bottomColor = PA_pick(rnd, ['#4f6d9a', '#3d4f74', '#6f8fb8', '#544d5c']);
    else if (L.bottom === 'leggings') L.bottomColor = PA_pick(rnd, ['#3f3846', '#544d5c', '#3d4a6b', '#7d4f7a']);
    else { L.bottomColor = PA_pick(rnd, PA_BOTCOLS); }
  }
  // shoes
  var bare = L.bottom === 'shorts' || L.bottom === 'skirt' || L.bottom === 'longskirt';
  if (L.top === 'raincoat') { L.shoes = 'wellies'; L.shoeColor = PA_pick(rnd, ['#d9574a', '#3aa89a', '#3f7d3a', '#3d4a6b', '#f2c14e']); if (L.shoeColor === L.topColor) L.shoeColor = '#3d4a6b'; }
  else {
    L.shoes = PA_wpick(rnd, ['sneakers', 44, 'boots', 22, 'loafers', L.top === 'shirt' ? 40 : 14, 'sandals', bare ? 18 : 0]);
    if (L.shoes === 'sneakers') L.shoeColor = PA_pick(rnd, ['#d9574a', '#f4efe4', '#3aa89a', '#3d4a6b', '#f2c14e', '#f2a0b5', '#5b6472']);
    else if (L.shoes === 'boots') L.shoeColor = PA_pick(rnd, ['#8a5a36', '#6b4327', '#4a3a3a', '#a8743f']);
    else if (L.shoes === 'loafers') L.shoeColor = PA_pick(rnd, ['#6b4327', '#4a3a3a', '#8a5a36', '#7d2f2a']);
    else L.shoeColor = PA_pick(rnd, ['#a8743f', '#d9574a', '#3aa89a', '#6b4327']);
  }
  // accessories
  var big = L.hairStyle === 'afro' || L.hairStyle === 'bun' || L.hairStyle === 'quiff';
  if (!big && rnd() < 0.3) {
    L.hat = PA_wpick(rnd, ['cap', fem ? 26 : 44, 'beanie', 34, 'sunhat', fem ? 40 : 14]);
    if (L.hairStyle === 'curls' && L.hat === 'cap') L.hat = 'beanie';
    if (L.hat === 'sunhat') { L.hatColor = PA_pick(rnd, ['#f0dca6', '#e9cf8e', '#fbf1d8', '#d9b877']); L.hatColor2 = PA_pick(rnd, ['#d9574a', '#3aa89a', '#f2a0b5', '#3d4a6b', '#a58bd6']); }
    else { L.hatColor = PA_pick(rnd, ['#d9574a', '#3aa89a', '#3d4a6b', '#f2c14e', '#a58bd6', '#c9694a', '#5d9d49', '#f2a0b5', '#5b6472']); L.hatColor2 = '#fbf1d8'; if (L.hatColor === L.topColor) L.hatColor = L.topColor2 === '#fbf1d8' ? '#3d4a6b' : L.topColor2; }
  }
  var gr = rnd();
  if (gr < (age === 2 ? 0.5 : 0.2)) { L.glasses = 'glasses'; L.glassesColor = PA_pick(rnd, ['#4a3a3a', '#7a4e2a', '#3d4a6b', '#d9574a', '#8d7b6a']); }
  else if (gr > 0.92 && age < 2) L.glasses = 'sunglasses';
  if (rnd() < ((L.top === 'jacket' || L.top === 'cardigan' || L.top === 'sweater') ? 0.24 : 0.06) && L.top !== 'hoodie' && L.top !== 'raincoat') {
    L.scarf = PA_pick(rnd, ['#d9574a', '#f2c14e', '#3aa89a', '#a58bd6', '#fbf1d8', '#3d4a6b', '#f2a0b5']);
    if (L.scarf === L.topColor) L.scarf = '#fbf1d8';
  }
  var br = rnd();
  if (br < 0.2) { L.bag = 'handbag'; L.bagColor = PA_pick(rnd, ['#a8743f', '#7a4e2a', '#d9574a', '#3d4a6b', '#f2c14e', '#7d4f7a']); }
  else if (br < (age === 0 ? 0.38 : 0.28)) { L.bag = 'backpack'; L.bagColor = PA_pick(rnd, ['#d9574a', '#3aa89a', '#3d4a6b', '#f2c14e', '#a8743f', '#a58bd6', '#5d9d49']); }
  if (L.bag && L.bagColor === L.topColor) L.bagColor = '#a8743f';
  if (!L.hat && age < 2 && rnd() < 0.09) L.headphones = PA_pick(rnd, ['#5b6472', '#d9574a', '#fbf1d8', '#3aa89a']);
  if (rnd() < (fem ? 0.34 : 0.05)) L.earrings = PA_pick(rnd, ['#f2c14e', '#f2c14e', '#fbf1d8', '#d9574a', '#3aa89a']);
  return L;
}

// The four selectable daycare attendants: teal apron with a cream paw print over a cream shirt, rolled sleeves, boots.
function PA_uniform(o) {
  var b = { top: 'uniform', topColor: '#fbf1d8', apronColor: '#3aa89a', sleeves: 'rolled', shoes: 'boots', shoeColor: '#8a5a36', build: 'regular', height: 1, age: 0 }, k;
  for (k in o) if (Object.prototype.hasOwnProperty.call(o, k)) b[k] = o[k];
  return b;
}
var PLAYER_LOOKS = [
  PA_uniform({ name: 'Sam', skin: '#f8d3b2', hair: '#a8572e', hairStyle: 'sidepart', body: 0, bottom: 'jeans', bottomColor: '#4f6d9a' }),
  PA_uniform({ name: 'Maya', skin: '#8c5834', hair: '#2a2225', hairStyle: 'curls', body: 1, lashes: true, bottom: 'trousers', bottomColor: '#544d5c', earrings: '#f2c14e', height: 0.98 }),
  PA_uniform({ name: 'Kai', skin: '#e2ab7c', hair: '#2a2225', hairStyle: 'undercut', body: 0, bottom: 'trousers', bottomColor: '#6f7a4a', glasses: 'glasses', shoeColor: '#6b4327' }),
  PA_uniform({ name: 'Lily', skin: '#fde3cd', hair: '#d9a85a', hairStyle: 'ponytail', body: 1, lashes: true, bottom: 'jeans', bottomColor: '#3d4f74', height: 0.98 })
];
var PLAYER_LOOK = PLAYER_LOOKS[0];

// Special named customer looks (Andrew & Annie)
var CUSTOMER_LOOKS = {
  andrew: {
    name: 'Andrew',
    skin: '#f2c5a0',
    hair: '#241a18',
    hairStyle: 'tousled',
    eye: '#241814',
    age: 0,
    body: 0,
    build: 'regular',
    height: 1.03,
    lashes: false,
    top: 'jacket',
    topColor: '#6a7279',
    topColor2: '#f6f6f4',
    motif: 'pinstripe',
    sleeves: 'long',
    bottom: 'trousers',
    bottomColor: '#373c44',
    shoes: 'sneakers',
    shoeColor: '#ebe6dc'
  },
  annie: {
    name: 'Annie',
    skin: '#f4c8a4',
    hair: '#1f1716',
    hairStyle: 'longwavy',
    eye: '#241814',
    age: 0,
    body: 1,
    build: 'slim',
    height: 0.96,
    lashes: true,
    top: 'tee',
    topColor: '#f7f6f2',
    topColor2: '#e2dcd3',
    motif: 'plain',
    sleeves: 'short',
    bottom: 'jeans',
    bottomColor: '#4f6d9a',
    shoes: 'sneakers',
    shoeColor: '#f4efe4'
  }
};
