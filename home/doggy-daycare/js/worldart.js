'use strict';
/* ==========================================================================================================
   Paws & Play - outdoor world art: ground, scenery, fences, street.          (private names are prefixed WA_)
   Needs js/data.js (TILE, W, H, MAP, PLOTS) to be loaded first. Lettering uses the "Jersey 25" font.

   drawWorldGround(c, env)
       Paints all static outdoor ground of the whole world (world px). Meant to be cached by the engine.
       env = { owned(tx, ty) -> bool, pending(tx, ty) -> bool,
               rect: { x, y, w, h } (optional, world px): repaint only this part, e.g. a plot whose ownership changed }
   buildWorldProps(env) -> [ prop, ... ]   (already sorted by sortY)
       prop = { x, y, w, h (bounding box, world px), sortY, draw(c, t, state), kind (string) }
       state = { night: 0..1, wind: -1..1 }. Rebuild when ownership changes. "FOR SALE" signs also carry
       { plot: plot id, signX, signY (top centre of the board) } so the engine can put a price label above them.
   worldLights(env)    -> [ { x, y, r, color } ]       street lamps, park lamps, the bus shelter
   worldAmbientSpots() -> { butterflies: [{x,y,w,h}], birds: [{x,y}], fireflies: [{x,y,w,h}], leaves: [{x,y}] }
   worldArtPrewarm(scale, budgetMs) -> number of sprites still to bake
       Optional. Every prop is drawn from bitmaps baked at the exact on-screen scale (read from c.getTransform().a) and
       blitted 1:1 on whole device pixels. Baking happens lazily; call this during loading (until it returns 0) to have
       everything ready before the first frame.
   ========================================================================================================== */

var WA_OUT = '#3b2a20';                       // warm dark outline
var WA_SHADOW = 'rgba(40,26,12,0.22)';        // ground contact shadow
var WA_FONT = '"Jersey 25", sans-serif';
var WA_CACHE_SCALE = 2;                       // offscreen sprite resolution (x world px)
var WA_TAU = Math.PI * 2;

// ---------- deterministic randomness ----------
function WA_h2(x, y) {
  var h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function WA_rng(seed) {
  var a = (seed | 0) || 1;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function WA_smooth(t) { return t * t * (3 - 2 * t); }
// smooth value noise, period-free, ~0..1
function WA_noise(x, y) {
  var xi = Math.floor(x), yi = Math.floor(y), xf = WA_smooth(x - xi), yf = WA_smooth(y - yi);
  var a = WA_h2(xi, yi), b = WA_h2(xi + 1, yi), d = WA_h2(xi, yi + 1), e = WA_h2(xi + 1, yi + 1);
  return a + (b - a) * xf + (d - a) * yf + (a - b - d + e) * xf * yf;
}
function WA_fbm(x, y) { return WA_noise(x, y) * 0.6 + WA_noise(x * 2.1 + 17, y * 2.1 + 5) * 0.28 + WA_noise(x * 4.3 + 3, y * 4.3 + 31) * 0.12; }
function WA_clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

// ---------- shape helpers ----------
function WA_ell(c, x, y, rx, ry) { c.beginPath(); c.ellipse(x, y, Math.max(0.01, rx), Math.max(0.01, ry), 0, 0, WA_TAU); }
function WA_shadow(c, x, y, rx, ry) { c.fillStyle = WA_SHADOW; WA_ell(c, x, y, rx, ry); c.fill(); }
function WA_rr(c, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  c.beginPath();
  c.moveTo(x + r, y); c.lineTo(x + w - r, y); c.quadraticCurveTo(x + w, y, x + w, y + r);
  c.lineTo(x + w, y + h - r); c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  c.lineTo(x + r, y + h); c.quadraticCurveTo(x, y + h, x, y + h - r);
  c.lineTo(x, y + r); c.quadraticCurveTo(x, y, x + r, y); c.closePath();
}
// irregular smooth closed blob (adds a sub-path; caller does beginPath / fill / stroke)
function WA_blobAdd(c, cx, cy, rx, ry, seed, amp, n) {
  n = n || 9; amp = amp == null ? 0.18 : amp;
  var pts = [], i, a, k;
  for (i = 0; i < n; i++) {
    a = i / n * WA_TAU;
    k = 1 + (WA_h2(seed + i * 7, seed * 3 + i) - 0.5) * 2 * amp;
    pts.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]);
  }
  var mx = (pts[n - 1][0] + pts[0][0]) / 2, my = (pts[n - 1][1] + pts[0][1]) / 2;
  c.moveTo(mx, my);
  for (i = 0; i < n; i++) {
    var p = pts[i], q = pts[(i + 1) % n];
    c.quadraticCurveTo(p[0], p[1], (p[0] + q[0]) / 2, (p[1] + q[1]) / 2);
  }
  c.closePath();
}
function WA_blob(c, cx, cy, rx, ry, seed, amp, n) { c.beginPath(); WA_blobAdd(c, cx, cy, rx, ry, seed, amp, n); }
// Catmull-Rom spline through points -> dense polyline [[x,y],...]
function WA_spline(pts, step) {
  var out = [], i, j, n = pts.length;
  step = step || 8;
  for (i = 0; i < n - 1; i++) {
    var p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(n - 1, i + 2)];
    var len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]), m = Math.max(2, Math.ceil(len / step));
    for (j = 0; j < m; j++) {
      var t = j / m, t2 = t * t, t3 = t2 * t;
      out.push([
        0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)]);
    }
  }
  out.push(pts[n - 1].slice());
  return out;
}
function WA_polyline(c, pl) { c.beginPath(); c.moveTo(pl[0][0], pl[0][1]); for (var i = 1; i < pl.length; i++) c.lineTo(pl[i][0], pl[i][1]); }
function WA_line(c, x0, y0, x1, y1) { c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke(); }
function WA_fillStroke(c, fill, lw, stroke) {
  c.fillStyle = fill; c.fill();
  if (lw !== 0) { c.lineWidth = lw || 1.8; c.strokeStyle = stroke || WA_OUT; c.stroke(); }
}

// ---------- offscreen sprite cache ----------
// Everything that is drawn per frame comes from bitmaps baked at EXACTLY the on-screen scale (camera zoom x devicePixelRatio)
// and is blitted 1:1 on whole device pixels - the only thing that is fast without a GPU. The engine hands us a context whose
// transform is translate + uniform scale. When the scale changes and then holds still (~120 ms) sprites are re-baked a few
// per frame; until then the old bitmap is drawn stretched. The previous scale's bitmap is kept so that zooming back is free.
var WA_SPR = { scale: 0, want: 0, since: 0, winStart: 0, spent: 0, bytes: 0, tick: 0, t0: 0, minScale: 0.25, maxScale: 4, budget: 3.5, maxBytes: 56e6 };
var WA_sprites = {};
function WA_now() { return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now(); }
function WA_canDOM() { return typeof document !== 'undefined' && !!document.createElement; }
// fn(g) draws in local coords where (0,0) is the anchor; the box is x: -ox..w-ox, y: -oy..h-oy (world px)
function WA_sprite(key, w, h, ox, oy, fn) {
  return WA_sprites[key] || (WA_sprites[key] = { key: key, w: w, h: h, ox: ox, oy: oy, fn: fn, bm: null, old: null, use: 0, bad: false });
}
// lettering: remembers that the sprite being baked contains text, so it can be re-baked if the web font arrives later
var WA_textUsed = false, WA_fontHooked = false;
function WA_setFont(g, px) { g.font = px + 'px ' + WA_FONT; WA_textUsed = true; }
function WA_fontReady() {
  try { return typeof document === 'undefined' || !document.fonts || document.fonts.check('12px "Jersey 25"'); } catch (e) { return true; }
}
function WA_onFonts() {
  Object.keys(WA_sprites).forEach(function (k) {
    var s = WA_sprites[k];
    if (!s.fontWait || !WA_fontReady()) return;
    s.fontWait = false;
    if (s.bm) { WA_SPR.bytes -= s.bm.bytes; s.bm = null; }
    if (s.old) { WA_SPR.bytes -= s.old.bytes; s.old = null; }
  });
}
function WA_bake(s, scale) {
  var cv = document.createElement('canvas'), oxd = Math.round(s.ox * scale) + 1, oyd = Math.round(s.oy * scale) + 1;
  cv.width = Math.max(1, Math.ceil(s.w * scale) + 2); cv.height = Math.max(1, Math.ceil(s.h * scale) + 2);
  var g = cv.getContext('2d');
  g.setTransform(scale, 0, 0, scale, oxd, oyd);
  g.lineJoin = 'round'; g.lineCap = 'round';
  WA_textUsed = false;
  s.fn(g);
  if (WA_textUsed && !WA_fontReady()) {
    s.fontWait = true;
    if (!WA_fontHooked) {
      WA_fontHooked = true;
      try { document.fonts.ready.then(WA_onFonts); document.fonts.addEventListener('loadingdone', WA_onFonts); document.fonts.load('12px "Jersey 25"').then(WA_onFonts, function () {}); } catch (e) { /* no font API */ }
    }
  }
  return { cv: cv, scale: scale, oxd: oxd, oyd: oyd, bytes: cv.width * cv.height * 4 };
}
function WA_evict() {
  var R = WA_SPR, keys = Object.keys(WA_sprites), i, s;
  for (i = 0; i < keys.length && R.bytes > R.maxBytes; i++) { s = WA_sprites[keys[i]]; if (s.old) { R.bytes -= s.old.bytes; s.old = null; } }
  if (R.bytes <= R.maxBytes) return;
  keys.sort(function (a, b) { return WA_sprites[a].use - WA_sprites[b].use; });
  for (i = 0; i < keys.length && R.bytes > R.maxBytes * 0.85; i++) { s = WA_sprites[keys[i]]; if (s.bm && s.use < R.tick - 2) { R.bytes -= s.bm.bytes; s.bm = null; } }
}
// make sure s.bm is a bitmap for the current target scale; may leave a stale one (or none) when over this frame's budget
function WA_ensure(s, force) {
  var R = WA_SPR;
  if (s.old && s.old.scale === R.scale) { var o = s.old; s.old = s.bm; s.bm = o; return; }
  if (s.bad) return;
  if (!WA_canDOM()) { s.bad = true; return; }
  var now = WA_now();
  if (!R.t0) R.t0 = now;
  if (now - R.winStart > 12) { R.winStart = now; R.spent = 0; R.tick++; }
  // over this frame's budget: keep the stale bitmap (or nothing yet) and try again next frame.
  // Exception: the very first moments after start-up, so that the opening frame is complete.
  if (!force && R.spent >= (s.bm ? R.budget : R.budget * 2) && (s.bm || now - R.t0 > 300)) return;
  try {
    var bm = WA_bake(s, R.scale);
    if (s.old) R.bytes -= s.old.bytes;
    s.old = s.bm; s.bm = bm; R.bytes += bm.bytes;
    if (R.bytes > R.maxBytes) WA_evict();
  } catch (e) { s.bad = !s.bm; }
  R.spent += WA_now() - now;
}
function WA_noteScale(sc) {
  var R = WA_SPR;
  sc = WA_clamp(sc, R.minScale, R.maxScale);
  if (!R.scale) { R.scale = R.want = sc; return; }
  if (sc === R.scale) { R.want = sc; return; }
  var now = WA_now();
  if (sc !== R.want) { R.want = sc; R.since = now; return; }
  if (now - R.since > 120) R.scale = sc;
}
function WA_put(c, s, x, y) {
  if (!s || !(x === x) || !(y === y)) return;
  var m = c.getTransform ? c.getTransform() : null, R = WA_SPR;
  if (!m || m.b !== 0 || m.c !== 0 || Math.abs(m.a - m.d) > 1e-6 || !(m.a > 0)) {      // unusual transform: no pixel snapping
    if (!R.scale) R.scale = WA_CACHE_SCALE;
    if (!s.bm) WA_ensure(s, true);
    if (s.bm) c.drawImage(s.bm.cv, x - s.bm.oxd / s.bm.scale, y - s.bm.oyd / s.bm.scale, s.bm.cv.width / s.bm.scale, s.bm.cv.height / s.bm.scale);
    else { c.save(); c.translate(x, y); c.lineJoin = 'round'; c.lineCap = 'round'; s.fn(c); c.restore(); }
    return;
  }
  WA_noteScale(m.a);
  if (!s.bm || s.bm.scale !== R.scale) WA_ensure(s, false);
  var bm = s.bm;
  s.use = R.tick;
  if (!bm) {
    if (s.bad) { c.save(); c.translate(x, y); c.lineJoin = 'round'; c.lineCap = 'round'; s.fn(c); c.restore(); }
    return;                                                   // not baked yet: it appears within a few frames
  }
  if (bm.scale === m.a) {
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.drawImage(bm.cv, Math.round(m.a * x + m.e) - bm.oxd, Math.round(m.d * y + m.f) - bm.oyd);
    c.setTransform(m.a, 0, 0, m.d, m.e, m.f);
  } else c.drawImage(bm.cv, x - bm.oxd / bm.scale, y - bm.oyd / bm.scale, bm.cv.width / bm.scale, bm.cv.height / bm.scale);
}
// Optional: call during a loading screen (repeatedly, until it returns 0) to bake every registered sprite for the given
// on-screen scale ahead of time, so nothing has to pop in during the first frames. Returns how many are still missing.
function worldArtPrewarm(scale, budgetMs) {
  var R = WA_SPR, t0 = WA_now(), left = 0, keys = Object.keys(WA_sprites), i, s;
  if (scale > 0) R.scale = R.want = WA_clamp(scale, R.minScale, R.maxScale);
  if (!R.scale) R.scale = WA_CACHE_SCALE;
  for (i = 0; i < keys.length; i++) {
    s = WA_sprites[keys[i]];
    if (s.bad || s.bm && s.bm.scale === R.scale) continue;
    if (WA_now() - t0 < (budgetMs || 8)) { WA_ensure(s, true); s.use = R.tick; }
    if (!s.bm || s.bm.scale !== R.scale) left++;
  }
  return left;
}
// Crisp stamps into a static layer (the cached ground): baked at that layer's own scale, blitted 1:1. The temporary bitmaps
// live only while the ground is being painted.
var WA_stampCache = null;
function WA_stamp(c, s, x, y) {
  var m = c.getTransform ? c.getTransform() : null;
  if (!m || !(m.a > 0) || !WA_canDOM() || m.b !== 0 || m.c !== 0 || Math.abs(m.a - m.d) > 1e-6) { c.save(); c.translate(x, y); c.lineJoin = 'round'; c.lineCap = 'round'; s.fn(c); c.restore(); return; }
  var sc = Math.min(m.a, 4);
  if (!WA_stampCache || WA_stampCache.scale !== sc) WA_stampCache = { scale: sc, map: {} };
  var bm = WA_stampCache.map[s.key] || (WA_stampCache.map[s.key] = WA_bake(s, sc));
  if (sc === m.a) {
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.drawImage(bm.cv, Math.round(m.a * x + m.e) - bm.oxd, Math.round(m.d * y + m.f) - bm.oyd);
    c.setTransform(m.a, 0, 0, m.d, m.e, m.f);
  } else c.drawImage(bm.cv, x - bm.oxd / sc, y - bm.oyd / sc, bm.cv.width / sc, bm.cv.height / sc);
}
var WA_decals = {};
// small repeated ground detail (flower, pebble, tuft ...): vector-drawn once per variant, then stamped
function WA_decal(c, key, w, h, ox, oy, x, y, fn) {
  WA_stamp(c, WA_decals[key] || (WA_decals[key] = { key: 'd:' + key, w: w, h: h, ox: ox, oy: oy, fn: fn }), x, y);
}
function WA_vi(seed, n) { return ((Math.floor(seed) % n) + n) % n; }

// ==========================================================================================================
// GROUND
// ==========================================================================================================
var WA_WW = W * TILE, WA_WH = H * TILE;
var WA_YX0 = MAP.yard.x0 * TILE, WA_YY0 = MAP.yard.y0 * TILE, WA_YX1 = (MAP.yard.x1 + 1) * TILE, WA_YY1 = (MAP.yard.y1 + 1) * TILE;
var WA_SX0 = MAP.shop.x0 * TILE, WA_SX1 = (MAP.shop.x1 + 1) * TILE, WA_SY0 = (MAP.shop.y0 - 3) * TILE, WA_SY1 = (MAP.shop.y1 + 1) * TILE;
var WA_SWY = MAP.sidewalkY * TILE, WA_RY = MAP.roadY0 * TILE;
var WA_DOORX0 = MAP.shop.streetDoor.x0 * TILE, WA_DOORX1 = (MAP.shop.streetDoor.x1 + 1) * TILE;

// park geometry (world px)
var WA_POND = { x: 330, y: 392, rx: 168, ry: 92, seed: 41 };
var WA_LAKE = { x: WA_WW + 26, y: 880, rx: 132, ry: 290, seed: 77 };
var WA_MEADOW = { x: 712, y: 560, rx: 132, ry: 112 };
var WA_PICNIC = { x: 742, y: 318 };

function WA_env(env) {
  env = env || {};
  var o = typeof env.owned === 'function' ? env.owned : function () { return false; };
  var p = typeof env.pending === 'function' ? env.pending : function () { return false; };
  function inYard(tx, ty) { return tx >= MAP.yard.x0 && tx <= MAP.yard.x1 && ty >= MAP.yard.y0 && ty <= MAP.yard.y1; }
  var r = env.rect, R = { x0: 0, y0: 0, x1: WA_WW, y1: WA_WH, full: true };
  if (r && r.w > 0 && r.h > 0) R = { x0: Math.max(0, r.x), y0: Math.max(0, r.y), x1: Math.min(WA_WW, r.x + r.w), y1: Math.min(WA_WH, r.y + r.h), full: false };
  return {
    owned: function (tx, ty) { return inYard(tx, ty) && !!o(tx, ty); },
    pending: function (tx, ty) { return inYard(tx, ty) && !o(tx, ty) && !!p(tx, ty); },
    inYard: inYard,
    rect: R,                                                  // part of the world being (re)painted
    hit: function (x0, y0, x1, y1) { return x1 > R.x0 && x0 < R.x1 && y1 > R.y0 && y0 < R.y1; }
  };
}
// Path2D of the union of yard tiles matching fn (row runs, so there are no inner seams)
function WA_tilePath(fn) {
  var p = new Path2D(), any = false, tx, ty, x0;
  for (ty = MAP.yard.y0; ty <= MAP.yard.y1; ty++) {
    x0 = -1;
    for (tx = MAP.yard.x0; tx <= MAP.yard.x1 + 1; tx++) {
      var on = tx <= MAP.yard.x1 && fn(tx, ty);
      if (on && x0 < 0) x0 = tx;
      if (!on && x0 >= 0) { p.rect(x0 * TILE, ty * TILE, (tx - x0) * TILE, TILE); any = true; x0 = -1; }
    }
  }
  return any ? p : null;
}

// soft mottling: irregular translucent blobs on a jittered grid
function WA_mottle(c, x0, y0, x1, y1, cell, cols, alpha, rMin, rMax, seed, pick, R) {
  if (R) { x0 = Math.max(x0, R.x0 - rMax); y0 = Math.max(y0, R.y0 - rMax); x1 = Math.min(x1, R.x1 + rMax); y1 = Math.min(y1, R.y1 + rMax); if (x0 >= x1 || y0 >= y1) return; }
  var gx0 = Math.floor(x0 / cell) - 1, gx1 = Math.ceil(x1 / cell) + 1, gy0 = Math.floor(y0 / cell) - 1, gy1 = Math.ceil(y1 / cell) + 1;
  for (var gy = gy0; gy <= gy1; gy++) for (var gx = gx0; gx <= gx1; gx++) {
    var h = WA_h2(gx * 3 + seed, gy * 5 - seed), h2 = WA_h2(gx + seed * 7, gy - seed * 3), h3 = WA_h2(gx * 11 - seed, gy * 13 + seed);
    var x = (gx + h) * cell, y = (gy + h2) * cell, r = rMin + (rMax - rMin) * h3;
    var ci = pick ? pick(x, y, h3) : Math.floor(WA_h2(gx * 17 + seed, gy * 19) * cols.length);
    if (ci < 0 || ci >= cols.length) continue;
    c.globalAlpha = alpha * (0.6 + 0.4 * WA_h2(gx - seed, gy * 7 + seed));
    c.fillStyle = cols[ci];
    WA_blob(c, x, y, r, r * (0.55 + 0.3 * h), gx * 31 + gy * 57 + seed, 0.22, 8);
    c.fill();
  }
  c.globalAlpha = 1;
}

// ---- small ground details -------------------------------------------------------------------------------
function WA_tuftAdd(c, x, y, n, len, spread, seed) {
  for (var i = 0; i < n; i++) {
    var f = n > 1 ? i / (n - 1) - 0.5 : 0;
    var a = -Math.PI / 2 + f * spread + (WA_h2(seed + i, seed * 3 - i) - 0.5) * 0.35;
    var l = len * (0.65 + 0.35 * WA_h2(seed * 5 + i, i * 9 + seed));
    var bx = x + f * n * 1.1;
    c.moveTo(bx, y);
    c.lineTo(bx + Math.cos(a) * l * 0.38, y - l * 0.55); c.lineTo(bx + Math.cos(a) * l, y + Math.sin(a) * l);
  }
}
var WA_FLOWER_COLS = ['#fdfaf0', '#f2c14e', '#d9574a', '#a58bd6', '#f2a0b5', '#6f93dc', '#fdfaf0', '#f08a4b'];
// tiny wildflower. kind: 0 daisy, 1 buttercup, 2 poppy, 3 lavender, 4 pink clover, 5 cornflower, 6 cow parsley, 7 orange hawkweed
function WA_wildflower(c, x, y, kind, s, seed) {
  var v = WA_vi(seed, 4), b = s < 2.35 ? 0 : s < 2.9 ? 1 : 2, sz = [2.1, 2.6, 3.2][b];
  WA_decal(c, 'wf' + kind + v + b, 20, 28, 10, 22, x, y, function (g) { WA_wildflowerRaw(g, 0, 0, kind, sz, v * 13 + 1); });
}
function WA_wildflowerRaw(c, x, y, kind, s, seed) {
  var h = WA_h2(seed, seed * 7 + 3), stalk = 3 + h * 4, i;
  c.strokeStyle = '#3f7d3a'; c.lineWidth = 1;
  if (kind === 3) {
    stalk = 8 + h * 4;
    WA_line(c, x, y, x + (h - 0.5) * 2, y - stalk);
    for (i = 0; i < 4; i++) {
      c.fillStyle = i % 2 ? '#a58bd6' : '#8f74c4';
      WA_ell(c, x + (h - 0.5) * 2 * (1 - i * 0.1) + (i % 2 ? 0.8 : -0.8), y - stalk + i * 1.9 - 1, 1.5 * s / 2.6, 1.5 * s / 2.6); c.fill();
    }
    return;
  }
  if (kind === 6) {
    stalk = 9 + h * 4;
    c.beginPath(); c.moveTo(x, y); c.lineTo(x, y - stalk * 0.6); c.lineTo(x - 3, y - stalk); c.moveTo(x, y - stalk * 0.6); c.lineTo(x + 3, y - stalk + 1);
    c.moveTo(x, y - stalk * 0.6); c.lineTo(x, y - stalk - 1); c.stroke();
    c.fillStyle = '#fdfaf0';
    WA_ell(c, x - 3, y - stalk, 2, 1.4); c.fill(); WA_ell(c, x + 3, y - stalk + 1, 2, 1.4); c.fill(); WA_ell(c, x, y - stalk - 1.5, 2.2, 1.5); c.fill();
    return;
  }
  WA_line(c, x, y, x, y - stalk);
  var fy = y - stalk;
  if (kind === 0) {
    c.fillStyle = '#fdfaf0';
    c.beginPath();
    for (i = 0; i < 5; i++) { var a = i / 5 * WA_TAU + h * 3; c.moveTo(x + Math.cos(a) * s * 0.62 + s * 0.48, fy + Math.sin(a) * s * 0.62); c.arc(x + Math.cos(a) * s * 0.62, fy + Math.sin(a) * s * 0.62, s * 0.48, 0, WA_TAU); }
    c.fill();
    c.fillStyle = '#f2c14e'; WA_ell(c, x, fy, s * 0.42, s * 0.42); c.fill();
  } else if (kind === 2) {
    c.fillStyle = '#d9574a'; WA_blob(c, x, fy, s * 1.05, s * 0.95, seed, 0.2, 6); c.fill();
    c.fillStyle = '#b8402f'; WA_ell(c, x + s * 0.25, fy + s * 0.3, s * 0.55, s * 0.4); c.fill();
    c.fillStyle = '#3b2a20'; WA_ell(c, x, fy, s * 0.3, s * 0.3); c.fill();
  } else {
    var col = WA_FLOWER_COLS[kind] || '#fdfaf0';
    c.fillStyle = col; WA_ell(c, x, fy, s * 0.8, s * 0.75); c.fill();
    c.fillStyle = kind === 1 ? '#fbe08a' : kind === 4 ? '#fbd0dc' : kind === 5 ? '#b9cdf6' : '#fbd08a';
    WA_ell(c, x - s * 0.2, fy - s * 0.2, s * 0.35, s * 0.32); c.fill();
  }
}
function WA_pebble(c, x, y, r, seed, mossy) {
  var rq = Math.round(r * 2) / 2, v = WA_vi(seed, 3);
  WA_decal(c, 'pb' + rq + v + (mossy ? 'm' : ''), rq * 2.4 + 6, rq * 1.9 + 6, rq * 1.2 + 3, rq * 0.95 + 3, x, y, function (g) { WA_pebbleRaw(g, 0, 0, rq, v * 7 + 2, mossy); });
}
function WA_pebbleRaw(c, x, y, r, seed, mossy) {
  var h = WA_h2(seed, seed + 11);
  c.fillStyle = 'rgba(40,26,12,0.2)'; WA_ell(c, x + 1, y + r * 0.45, r * 1.05, r * 0.4); c.fill();
  WA_blob(c, x, y, r, r * 0.7, seed, 0.16, 7);
  WA_fillStroke(c, h < 0.5 ? '#bdb7aa' : '#aaa396', 0);
  c.save(); WA_blob(c, x, y, r, r * 0.7, seed, 0.16, 7); c.clip();
  c.fillStyle = '#918b80'; WA_ell(c, x + r * 0.35, y + r * 0.45, r, r * 0.5); c.fill();
  c.fillStyle = mossy ? '#6aa852' : '#dcd7cb'; WA_ell(c, x - r * 0.3, y - r * 0.35, r * 0.5, r * 0.22); c.fill();
  c.restore();
  WA_blob(c, x, y, r, r * 0.7, seed, 0.16, 7); c.strokeStyle = WA_OUT; c.lineWidth = Math.min(1.5, 0.6 + r * 0.12); c.stroke();
}
function WA_leafLitter(c, x, y, seed) {
  var cols = ['#c98f3f', '#a8743f', '#d9a24e', '#8a5a2e', '#b55f3a'];
  for (var i = 0; i < 3; i++) {
    var h = WA_h2(seed + i * 5, seed - i), a = h * WA_TAU, px = x + (WA_h2(seed - i, i * 3) - 0.5) * 18, py = y + (WA_h2(i * 7, seed + i) - 0.5) * 14;
    c.fillStyle = cols[Math.floor(WA_h2(seed * 3 + i, i) * cols.length)];
    c.beginPath(); c.ellipse(px, py, 2.6, 1.3, a, 0, WA_TAU); c.fill();
  }
}
function WA_fern(c, x, y, s, seed) {
  var n = 5, i;
  for (i = 0; i < n; i++) {
    var f = i / (n - 1) - 0.5, a = -Math.PI / 2 + f * 2.3, l = s * (1 - Math.abs(f) * 0.5);
    var ex = x + Math.cos(a) * l, ey = y + Math.sin(a) * l * 0.8;
    c.strokeStyle = i % 2 ? '#4f9a4a' : '#3f8440'; c.lineWidth = 3.2; c.lineCap = 'round';
    c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x + Math.cos(a) * l * 0.5, y + Math.sin(a) * l * 0.9 - 2, ex, ey); c.stroke();
    c.strokeStyle = '#2f6a35'; c.lineWidth = 0.8;
    c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x + Math.cos(a) * l * 0.5, y + Math.sin(a) * l * 0.9 - 2, ex, ey); c.stroke();
  }
}
function WA_mushroom(c, x, y, s, red) {
  c.fillStyle = '#f3ead2'; c.strokeStyle = WA_OUT; c.lineWidth = 1;
  c.beginPath(); c.rect(x - s * 0.28, y - s, s * 0.56, s); c.fill(); c.stroke();
  c.beginPath(); c.moveTo(x - s, y - s * 0.9); c.quadraticCurveTo(x - s * 0.9, y - s * 2.1, x, y - s * 2.1); c.quadraticCurveTo(x + s * 0.9, y - s * 2.1, x + s, y - s * 0.9); c.closePath();
  c.fillStyle = red ? '#d9574a' : '#c9935a'; c.fill(); c.stroke();
  c.fillStyle = '#fdfaf0';
  WA_ell(c, x - s * 0.4, y - s * 1.45, s * 0.2, s * 0.17); c.fill(); WA_ell(c, x + s * 0.3, y - s * 1.6, s * 0.18, s * 0.15); c.fill(); WA_ell(c, x + s * 0.1, y - s * 1.15, s * 0.14, s * 0.12); c.fill();
}
function WA_dock(c, x, y, s, seed) {   // broad-leaf weed rosette
  for (var i = 0; i < 5; i++) {
    var a = -Math.PI / 2 + (i / 4 - 0.5) * 2.6, l = s * (0.75 + 0.25 * WA_h2(seed + i, seed));
    var ex = x + Math.cos(a) * l, ey = y + Math.sin(a) * l * 0.75, nx = -Math.sin(a) * s * 0.28, ny = Math.cos(a) * s * 0.2;
    c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo((x + ex) / 2 + nx, (y + ey) / 2 + ny, ex, ey); c.quadraticCurveTo((x + ex) / 2 - nx, (y + ey) / 2 - ny, x, y);
    c.fillStyle = i % 2 ? '#5a9f49' : '#4c8f42'; c.fill();
    c.strokeStyle = '#3a7436'; c.lineWidth = 0.8; c.stroke();
  }
}
function WA_twig(c, x, y, seed) {
  var a = WA_h2(seed, 4) * Math.PI, l = 7 + WA_h2(seed, 9) * 6, dx = Math.cos(a) * l, dy = Math.sin(a) * l * 0.5;
  c.strokeStyle = '#6b4526'; c.lineWidth = 1.8; c.beginPath(); c.moveTo(x - dx, y - dy); c.lineTo(x + dx, y + dy);
  c.moveTo(x + dx * 0.2, y + dy * 0.2); c.lineTo(x + dx * 0.5 - dy * 0.6, y + dy * 0.5 - 3); c.stroke();
  c.strokeStyle = '#a8743f'; c.lineWidth = 0.7; c.beginPath(); c.moveTo(x - dx, y - dy - 0.5); c.lineTo(x + dx * 0.6, y + dy * 0.6 - 0.5); c.stroke();
}

// classification of wild land for the detail scatter: 'meadow' | 'forest' | 'park' | null
function WA_forestness(x, y) {
  var n = WA_noise(x / 170, 3.7) * 50;
  var line = x < WA_YX0 - 60 ? 150 : x < WA_YX0 + 60 ? 150 + (x - WA_YX0 + 60) / 120 * 110 : 260;
  var f = WA_clamp((line + n - y) / 120, 0, 1);
  var e = WA_clamp((x - (WA_YX1 - 30) - WA_noise(3.1, y / 150) * 40) / 110, 0, 1);
  return Math.max(f, e);
}

// ---- stamped versions of the scatter details (a handful of variants each) ---------------------------------
function WA_clumpRaw(c, x, y, s) {                       // chunky tall-grass clump
  var n = 5 + Math.floor(WA_h2(s, 1) * 3), bl = 11 + WA_h2(s, 2) * 7, i;
  for (i = 0; i < n; i++) {
    var f = i / (n - 1) - 0.5, a = -Math.PI / 2 + f * 1.5, l = bl * (1 - Math.abs(f) * 0.5);
    var ex = x + f * 9 + Math.cos(a) * l * 0.6, ey = y + Math.sin(a) * l;
    c.beginPath(); c.moveTo(x + f * 9 - 1.6, y); c.quadraticCurveTo(x + f * 10, y - l * 0.6, ex, ey); c.quadraticCurveTo(x + f * 10 + 2, y - l * 0.5, x + f * 9 + 1.6, y); c.closePath();
    c.fillStyle = i % 3 === 0 ? '#6fae52' : i % 3 === 1 ? '#4f9243' : '#5d9f49'; c.fill();
    c.strokeStyle = '#356f35'; c.lineWidth = 0.8; c.stroke();
  }
}
function WA_seedheadRaw(c, x, y, s) {
  c.strokeStyle = '#8aa85a'; c.lineWidth = 1;
  for (var i = 0; i < 3; i++) {
    var sx = x + (i - 1) * 3.5, top = y - 13 - WA_h2(s, i) * 6, lean = (WA_h2(s + i, 3) - 0.5) * 6;
    c.beginPath(); c.moveTo(sx, y); c.quadraticCurveTo(sx, y - 8, sx + lean, top); c.stroke();
    c.fillStyle = i % 2 ? '#dcc67c' : '#c9ae62';
    c.beginPath(); c.ellipse(sx + lean, top - 1.5, 1.5, 3.2, lean * 0.08, 0, WA_TAU); c.fill();
  }
}
function WA_dandelionRaw(c, x, y) {
  c.strokeStyle = '#4f8a40'; c.lineWidth = 1; WA_line(c, x, y, x + 1, y - 9);
  c.fillStyle = 'rgba(255,255,250,0.85)'; WA_ell(c, x + 1, y - 11, 3.2, 3.2); c.fill();
  c.fillStyle = '#e9e6d8'; WA_ell(c, x + 1.6, y - 10.4, 1.4, 1.4); c.fill();
}
function WA_hummockRaw(c, x, y, s) {
  c.fillStyle = '#4c8a3e'; WA_blob(c, x, y + 1, 10 + WA_h2(s, 16) * 5, 5 + WA_h2(s, 17) * 2, s, 0.22, 8); c.fill();
  c.fillStyle = '#79b556'; WA_blob(c, x - 1, y - 1, 7, 2.8, s + 3, 0.25, 7); c.fill();
}
function WA_cloverRaw(c, x, y, s) {
  var i;
  c.fillStyle = '#5cab4e';
  for (i = 0; i < 6; i++) {
    var cx = x + (WA_h2(s + i, 9) - 0.5) * 20, cy = y + (WA_h2(s * 9, i) - 0.5) * 13;
    c.beginPath(); c.arc(cx - 1.3, cy, 1.5, 0, WA_TAU); c.arc(cx + 1.3, cy, 1.5, 0, WA_TAU); c.arc(cx, cy - 1.6, 1.5, 0, WA_TAU); c.fill();
  }
  c.fillStyle = '#f4f6e4';
  for (i = 0; i < 2; i++) { WA_ell(c, x + (WA_h2(s + i * 3, 5) - 0.5) * 16, y + (WA_h2(s * 5, i * 3) - 0.5) * 10, 1.5, 1.4); c.fill(); }
}
function WA_dClump(c, x, y, s) { var v = WA_vi(s, 6); WA_decal(c, 'clump' + v, 34, 30, 17, 25, x, y, function (g) { WA_clumpRaw(g, 0, 0, v * 17 + 3); }); }
function WA_dSeedhead(c, x, y, s) { var v = WA_vi(s, 4); WA_decal(c, 'seedh' + v, 24, 30, 12, 26, x, y, function (g) { WA_seedheadRaw(g, 0, 0, v * 11 + 2); }); }
function WA_dDock(c, x, y, size, s) { var v = WA_vi(s, 3), b = size < 10 ? 8.5 : 11; WA_decal(c, 'dock' + v + b, 32, 22, 16, 16, x, y, function (g) { WA_dock(g, 0, 0, b, v * 5 + 1); }); }
function WA_dDandelion(c, x, y) { WA_decal(c, 'dandelion', 14, 22, 6, 18, x, y, function (g) { WA_dandelionRaw(g, 0, 0); }); }
function WA_dTwig(c, x, y, s) { var v = WA_vi(s, 5); WA_decal(c, 'twig' + v, 34, 22, 17, 12, x, y, function (g) { WA_twig(g, 0, 0, v * 23 + 4); }); }
function WA_dHummock(c, x, y, s) { var v = WA_vi(s, 3); WA_decal(c, 'hummock' + v, 40, 22, 20, 11, x, y, function (g) { WA_hummockRaw(g, 0, 0, v * 9 + 1); }); }
function WA_dLitter(c, x, y, s) { var v = WA_vi(s, 6); WA_decal(c, 'litter' + v, 32, 26, 16, 13, x, y, function (g) { WA_leafLitter(g, 0, 0, v * 37 + 5); }); }
function WA_dFern(c, x, y, size, s) { var b = size < 12 ? 10 : 14, v = WA_vi(s, 2); WA_decal(c, 'fern' + b + v, 36, 26, 18, 20, x, y, function (g) { WA_fern(g, 0, 0, b, v); }); }
function WA_dMushroom(c, x, y, size, red) { var b = size < 2.5 ? 2 : size < 3.3 ? 2.8 : 3.6; WA_decal(c, 'mush' + b + (red ? 'r' : 'b'), 14, 14, 7, 11, x, y, function (g) { WA_mushroom(g, 0, 0, b, red); }); }
function WA_dClover(c, x, y, s) { var v = WA_vi(s, 4); WA_decal(c, 'clover' + v, 30, 22, 15, 12, x, y, function (g) { WA_cloverRaw(g, 0, 0, v * 13 + 7); }); }

// seamless 384 px tile of thin grass blades (three tones), stamped across the wild land
var WA_BLADE_T = 384;
function WA_bladeTileArt(kind) {
  return WA_decals['blades' + kind] || (WA_decals['blades' + kind] = { key: 'd:blades' + kind, w: WA_BLADE_T, h: WA_BLADE_T, ox: 0, oy: 0, fn: function (g) {
    var T = WA_BLADE_T, cell = 24, n = T / cell, passes = kind === 'forest' ? [['#2f6636', 1.5, 0.45], ['#44813a', 1.5, 0.4], ['#5a9c46', 1.4, 0.25]] : [['#44813a', 1.5, 0.55], ['#5a9c46', 1.4, 0.55], ['#7fb85c', 1.2, 0.5]];
    g.lineCap = 'butt'; g.lineJoin = 'bevel';
    g.beginPath(); g.rect(0, 0, T, T); g.clip();
    for (var p = 0; p < passes.length; p++) {
      g.strokeStyle = passes[p][0]; g.lineWidth = passes[p][1]; g.beginPath();
      for (var gy = 0; gy < n; gy++) for (var gx = 0; gx < n; gx++) {
        var h = WA_h2(gx * 7 + p * 101, gy * 11 + p * 37);
        if (h > passes[p][2]) continue;
        var x = (gx + WA_h2(gx + p * 13, gy * 3)) * cell, y = (gy + WA_h2(gx * 3, gy + p * 17)) * cell, hh = h / passes[p][2];
        var nb = kind === 'forest' ? 3 : 3 + Math.floor(hh * 3), len = kind === 'forest' ? 5 + hh * 5 : 7 + hh * 7, sd = gx * 131 + gy * 17 + p;
        for (var ox = -T; ox <= T; ox += T) for (var oy = -T; oy <= T; oy += T) {       // wrap around the tile edges
          if (x + ox < -18 || x + ox > T + 18 || y + oy < -2 || y + oy > T + 20) continue;
          WA_tuftAdd(g, x + ox, y + oy, nb, len, kind === 'forest' ? 1.2 : 1.1, sd);
        }
      }
      g.stroke();
    }
  } });
}

// ---- base layers -----------------------------------------------------------------------------------------
function WA_gBase(c, E) {
  var i, x, y;
  c.fillStyle = '#5d9d49'; c.fillRect(0, 0, WA_WW, WA_WH);
  // broad zones of lusher / drier wild grass
  var R = E.rect;
  WA_mottle(c, 0, 0, WA_WW, WA_SWY, 160, ['#548f42', '#68a850', '#4e8a40', '#7dab50'], 0.55, 62, 128, 11, function (x, y, h) {
    var n = WA_fbm(x / 430, y / 430);
    return n < 0.4 ? (h < 0.5 ? 0 : 2) : n > 0.6 ? (h < 0.6 ? 3 : 1) : Math.floor(h * 4);
  }, R);
  WA_mottle(c, 0, 0, WA_WW, WA_SWY, 72, ['#578f44', '#64a34d', '#6fa64d'], 0.35, 18, 42, 23, null, R);

  // park lawn (tended, lighter) - west part of the map, also under the building
  c.fillStyle = '#73b95b';
  c.beginPath(); c.moveTo(0, 104);
  for (x = 0; x <= WA_YX0; x += 24) c.lineTo(x, 104 + WA_noise(x / 60, 9.3) * 26);
  c.lineTo(WA_YX0, WA_SWY); c.lineTo(0, WA_SWY); c.closePath(); c.fill();
  c.save(); c.beginPath(); c.rect(0, 100, WA_YX0, WA_SWY - 100); c.clip();
  WA_mottle(c, 0, 100, WA_YX0, WA_SWY, 130, ['#7cc260', '#6bb155', '#80c566', '#6fb556'], 0.5, 50, 104, 5, null, R);
  WA_mottle(c, 0, 100, WA_YX0, WA_SWY, 50, ['#79bf5e', '#6db557'], 0.3, 14, 30, 8, null, R);
  c.restore();
  // ragged edge where the park lawn meets wild land east of it
  for (y = 110; y < WA_SY0; y += 13) {
    var ty = Math.floor(y / TILE);
    if (ty >= MAP.yard.y0 && E.owned(MAP.yard.x0, ty)) continue;
    var h = WA_h2(y, 77);
    c.fillStyle = h < 0.4 ? '#5d9d49' : h < 0.7 ? '#578f44' : '#64a34d';
    WA_blob(c, WA_YX0 + 6 - h * 14, y + WA_h2(y, 3) * 8, 13 + WA_h2(y, 5) * 13, 10 + h * 8, y * 3, 0.25, 7); c.fill();
  }

  // forest: darker floor towards the north edge and the east edge
  var cell = 62;
  for (var gy = -1; gy * cell < WA_YY1 + 60; gy++) for (var gx = -1; gx * cell < WA_WW + 60; gx++) {
    x = (gx + WA_h2(gx, gy * 3 + 1)) * cell; y = (gy + WA_h2(gx * 5, gy + 2)) * cell;
    if (y > 400 && x < WA_YX1 - 80) continue;
    if (!E.hit(x - 80, y - 60, x + 80, y + 60)) continue;
    var f = WA_forestness(x, y);
    if (f <= 0.02) continue;
    c.globalAlpha = Math.min(0.62, f * 0.62);
    c.fillStyle = WA_h2(gx * 9, gy * 7) < 0.5 ? '#2f6a3a' : '#38733b';
    WA_blob(c, x, y, 52 + WA_h2(gx, gy) * 28, 38 + WA_h2(gy, gx) * 22, gx * 13 + gy * 29, 0.2, 8); c.fill();
  }
  c.globalAlpha = 1;
  // the deep wood along the very top
  var g = c.createLinearGradient(0, 0, 0, 150);
  g.addColorStop(0, 'rgba(24,58,40,0.95)'); g.addColorStop(0.55, 'rgba(30,70,44,0.55)'); g.addColorStop(1, 'rgba(30,70,44,0)');
  c.fillStyle = g; c.fillRect(0, 0, WA_WW, 150);
  // dappled light spots on the forest floor
  for (i = 0; i < 150; i++) {
    x = WA_h2(i, 901) * WA_WW; y = 120 + WA_h2(i, 902) * 190;
    if (WA_forestness(x, y) < 0.35) continue;
    c.globalAlpha = 0.16; c.fillStyle = '#cfe58a';
    WA_blob(c, x, y, 8 + WA_h2(i, 903) * 12, 4 + WA_h2(i, 904) * 5, i, 0.25, 7); c.fill();
  }
  c.globalAlpha = 1;
}

// ---- the owned, mowed lawn -------------------------------------------------------------------------------
function WA_gLawn(c, E, ownedPath) {
  var tx, ty, i, x, y, h, R = E.rect;
  if (!E.hit(WA_YX0 - 8, WA_YY0 - 8, WA_YX1 + 8, WA_YY1 + 8)) return;
  // only the tiles inside the area being painted
  var Y = { x0: Math.max(MAP.yard.x0, Math.floor(R.x0 / TILE) - 1), x1: Math.min(MAP.yard.x1, Math.floor(R.x1 / TILE) + 1), y0: Math.max(MAP.yard.y0, Math.floor(R.y0 / TILE) - 1), y1: Math.min(MAP.yard.y1, Math.floor(R.y1 / TILE) + 1) };
  c.save(); c.clip(ownedPath);
  c.fillStyle = '#7cc260'; c.fillRect(WA_YX0, WA_YY0, WA_YX1 - WA_YX0, WA_YY1 - WA_YY0);
  // mowing stripes: tile-wide bands both ways (a soft tartan)
  c.fillStyle = 'rgba(98,172,80,0.42)';
  for (tx = MAP.yard.x0; tx <= MAP.yard.x1; tx += 2) c.fillRect(tx * TILE, WA_YY0, TILE, WA_YY1 - WA_YY0);
  c.fillStyle = 'rgba(70,150,70,0.10)';
  for (ty = MAP.yard.y0; ty <= MAP.yard.y1; ty += 2) c.fillRect(WA_YX0, ty * TILE, WA_YX1 - WA_YX0, TILE);
  WA_mottle(c, WA_YX0, WA_YY0, WA_YX1, WA_YY1, 150, ['#8acb6a', '#6fb556', '#84c864'], 0.2, 50, 120, 31, null, R);
  // mower nap: faint short strokes following the stripes
  for (var pass = 0; pass < 2; pass++) {
    c.strokeStyle = pass ? 'rgba(160,220,120,0.55)' : 'rgba(84,156,70,0.5)'; c.lineWidth = 1.2;
    c.beginPath();
    for (ty = Y.y0; ty <= Y.y1; ty++) for (tx = Y.x0; tx <= Y.x1; tx++) {
      if (!E.owned(tx, ty)) continue;
      for (i = 0; i < 3; i++) {
        h = WA_h2(tx * 7 + i + pass * 50, ty * 13 + i * 3);
        x = (tx + h) * TILE; y = (ty + WA_h2(tx + i * 9, ty * 5 + pass)) * TILE;
        var l = 3 + WA_h2(tx * 3 + i, ty + pass * 9) * 4;
        c.moveTo(x, y); c.lineTo(x + (h - 0.5) * 1.5, y - l);
      }
    }
    c.stroke();
  }
  // small tufts
  c.strokeStyle = '#59a548'; c.lineWidth = 1.3; c.beginPath();
  for (ty = Y.y0; ty <= Y.y1; ty++) for (tx = Y.x0; tx <= Y.x1; tx++) {
    if (!E.owned(tx, ty)) continue;
    for (i = 0; i < 2; i++) {
      if (WA_h2(tx * 5 + i, ty * 3 + 40) < 0.35) continue;
      WA_tuftAdd(c, (tx + 0.1 + 0.8 * WA_h2(tx + i * 31, ty * 7)) * TILE, (ty + 0.15 + 0.8 * WA_h2(tx * 11, ty + i * 17)) * TILE, 3, 5.5, 1.2, tx * 37 + ty * 91 + i);
    }
  }
  c.stroke();
  c.strokeStyle = '#a4dc80'; c.lineWidth = 1.1; c.beginPath();
  for (ty = Y.y0; ty <= Y.y1; ty++) for (tx = Y.x0; tx <= Y.x1; tx++) {
    if (!E.owned(tx, ty) || WA_h2(tx * 3, ty * 17 + 5) < 0.45) continue;
    WA_tuftAdd(c, (tx + 0.1 + 0.8 * WA_h2(tx * 13, ty * 7 + 1)) * TILE, (ty + 0.15 + 0.8 * WA_h2(tx * 11 + 3, ty)) * TILE, 2, 4.5, 0.9, tx * 41 + ty * 17);
  }
  c.stroke();
  // clover patches, daisies, buttercups (drifts follow a low-frequency noise so they do not look tiled)
  for (ty = Y.y0; ty <= Y.y1; ty++) for (tx = Y.x0; tx <= Y.x1; tx++) {
    if (!E.owned(tx, ty)) continue;
    h = WA_h2(tx * 29 + 7, ty * 31 + 3);
    var drift = WA_fbm(tx / 5.5 + 3, ty / 5.5 + 8);
    x = (tx + 0.2 + 0.6 * WA_h2(tx, ty * 3 + 9)) * TILE; y = (ty + 0.25 + 0.6 * WA_h2(tx * 3 + 9, ty)) * TILE;
    if (h < 0.1 + (drift > 0.58 ? 0.16 : 0)) {
      WA_dClover(c, x, y, tx * 7 + ty * 3);
    } else if (h < 0.2 + (drift < 0.4 ? 0.14 : 0)) {
      var n = 1 + Math.floor(WA_h2(tx * 3, ty * 3) * 3);
      for (i = 0; i < n; i++) WA_wildflower(c, x + (WA_h2(tx + i * 7, ty) - 0.5) * 22, y + (WA_h2(tx, ty + i * 7) - 0.5) * 16, 0, 2.1, tx * 100 + ty + i);
    } else if (h < 0.25) {
      WA_wildflower(c, x, y, 1, 2, tx * 100 + ty);
      if (h < 0.225) WA_wildflower(c, x + 7, y + 4, 1, 1.8, tx * 100 + ty + 1);
    }
  }
  c.restore();
  // trim: slightly longer, darker grass along every outer edge of the lawn (sits under the fence)
  for (ty = Y.y0; ty <= Y.y1; ty++) for (tx = Y.x0; tx <= Y.x1; tx++) {
    if (!E.owned(tx, ty)) continue;
    x = tx * TILE; y = ty * TILE;
    c.fillStyle = 'rgba(72,140,62,0.55)';
    if (!E.owned(tx, ty - 1)) c.fillRect(x, y, TILE, 5);
    if (!E.owned(tx, ty + 1)) c.fillRect(x, y + TILE - 4, TILE, 4);
    if (!E.owned(tx - 1, ty) && !(tx === MAP.shop.yardDoor.x + 1 && ty >= MAP.shop.yardDoor.y0 && ty <= MAP.shop.yardDoor.y1)) c.fillRect(x, y, 4, TILE);
    if (!E.owned(tx + 1, ty)) c.fillRect(x + TILE - 4, y, 4, TILE);
  }
}

// ---- wild land: meadow and forest floor detail scatter ---------------------------------------------------
function WA_plotAt(tx, ty) {
  for (var i = 0; i < PLOTS.length; i++) { var p = PLOTS[i]; if (tx >= p.x && tx < p.x + p.w && ty >= p.y && ty < p.y + p.h) return i; }
  return -1;
}
function WA_wildKind(x, y, E) {
  if (y >= WA_YY1 || x < 0 || y < 0 || x >= WA_WW) return null;
  var tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
  if (E.inYard(tx, ty)) return E.owned(tx, ty) ? null : (WA_forestness(x, y) > 0.55 ? 'forest' : 'meadow');
  var f = WA_forestness(x, y);
  if (x < WA_YX0) return f > 0.3 ? 'forest' : null;
  return f > 0.35 ? 'forest' : 'meadow';
}
function WA_inWater(x, y) {
  var L = WA_LAKE, P = WA_POND;
  var a = (x - L.x) / (L.rx + 14), b = (y - L.y) / (L.ry + 14);
  if (a * a + b * b < 1.08) return true;
  a = (x - P.x) / (P.rx + 14); b = (y - P.y) / (P.ry + 12);
  return a * a + b * b < 1.1;
}
function WA_gWild(c, E) {
  var cell = 24, gx, gy, x, y, k, h, i, s, R = E.rect;
  // (no clip against the lawn needed: the lawn is painted afterwards and covers anything that strays onto owned tiles)
  var nx = Math.ceil(WA_WW / cell), ny = Math.ceil(WA_YY1 / cell);
  var gx0 = Math.max(0, Math.floor((R.x0 - 30) / cell)), gx1 = Math.min(nx, Math.ceil((R.x1 + 30) / cell));
  var gy0 = Math.max(0, Math.floor((R.y0 - 10) / cell)), gy1 = Math.min(ny, Math.ceil((R.y1 + 34) / cell));
  if (gx0 >= gx1 || gy0 >= gy1) return;
  var kinds0 = new Array(nx * ny);
  for (gy = gy0; gy < gy1; gy++) for (gx = gx0; gx < gx1; gx++) {
    x = (gx + 0.5) * cell; y = (gy + 0.5) * cell;
    kinds0[gy * nx + gx] = WA_inWater(x, y) ? null : WA_wildKind(x, y, E);
  }
  // pass 1: thin grass blades - a seamless tile stamped through a mask of the cells of each kind
  ['meadow', 'forest'].forEach(function (kind) {
    var path = new Path2D(), any = false, x0;
    for (gy = gy0; gy < gy1; gy++) {
      x0 = -1;
      for (gx = gx0; gx <= gx1; gx++) {
        var on = gx < gx1 && kinds0[gy * nx + gx] === kind;
        if (on && x0 < 0) x0 = gx;
        if (!on && x0 >= 0) { path.rect(x0 * cell, gy * cell - 0.3, (gx - x0) * cell, cell + 0.6); any = true; x0 = -1; }
      }
    }
    if (!any) return;
    var T = WA_BLADE_T, tile = WA_bladeTileArt(kind);
    c.save(); c.clip(path);
    for (var ty = Math.floor(gy0 * cell / T); ty * T < gy1 * cell; ty++) for (var tx = Math.floor(gx0 * cell / T); tx * T < gx1 * cell; tx++) WA_stamp(c, tile, tx * T, ty * T);
    c.restore();
  });
  // pass 2: features
  for (gy = gy0; gy < gy1; gy++) for (gx = gx0; gx < gx1; gx++) {
    k = kinds0[gy * nx + gx];
    if (!k) continue;
    h = WA_h2(gx * 19 + 5, gy * 23 + 9);
    x = (gx + 0.1 + 0.8 * WA_h2(gx * 3 + 1, gy * 7 + 2)) * cell; y = (gy + 0.1 + 0.8 * WA_h2(gx * 5 + 4, gy * 3 + 8)) * cell;
    s = gx * 977 + gy * 131;
    if (k === 'meadow') {
      if (h < 0.11) { WA_dClump(c, x, y, s); continue; }
      if (h < 0.18) { WA_dSeedhead(c, x, y, s); continue; }
      if (h >= 0.68) {
        if (h < 0.76) { /* plain */ }
        else if (h < 0.80) WA_dDock(c, x, y, 8 + WA_h2(s, 11) * 4, s);
        else if (h < 0.825) WA_dDandelion(c, x, y);
        else if (h < 0.852) { WA_pebble(c, x, y, 3.5 + WA_h2(s, 12) * 5, s, WA_h2(s, 13) < 0.4); if (WA_h2(s, 14) < 0.5) WA_pebble(c, x + 9, y + 3, 2.5 + WA_h2(s, 15) * 2, s + 1, false); }
        else if (h < 0.865) WA_dTwig(c, x, y, s);
        else if (h < 0.875) WA_dHummock(c, x, y, s);
        continue;
      }
      var plot = WA_plotAt(Math.floor(x / TILE), Math.floor(y / TILE));
      var drift = WA_fbm(x / 230 + plot * 7.3, y / 230 + 2.1), thresh = plot === 2 ? 0.44 : 0.52;
      if (h < 0.18 + (drift > thresh ? 0.5 : 0.06)) {       // wildflowers in drifts
        var kinds = plot === 2 ? [2, 0, 5, 1, 4, 3] : plot === 1 ? [0, 1, 6, 3] : plot === 3 ? [4, 0, 6, 1] : plot === 4 ? [3, 5, 1, 0, 7] : [0, 1, 6];
        var dom = kinds[Math.floor(WA_noise(x / 300 + 40, y / 300 + plot * 3) * kinds.length) % kinds.length];
        var n2 = drift > thresh ? 1 + Math.floor(WA_h2(s, 5) * 3) : 1;
        for (i = 0; i < n2; i++) {
          var kk = WA_h2(s + i, 6) < 0.72 ? dom : kinds[Math.floor(WA_h2(s, 7 + i) * kinds.length)];
          WA_wildflower(c, x + (WA_h2(s + i, 8) - 0.5) * 20, y + (WA_h2(s, 9 + i) - 0.5) * 16, kk, 2.3 + WA_h2(s, 10 + i) * 1.1, s + i * 3 + Math.floor(h * 1000));
        }
      }
    } else {
      if (h < 0.34) WA_dLitter(c, x, y, s);
      else if (h < 0.43) WA_dFern(c, x, y, 9 + WA_h2(s, 1) * 6, s);
      else if (h < 0.465) { WA_dMushroom(c, x, y, 2.6 + WA_h2(s, 2) * 1.4, WA_h2(s, 3) < 0.6); if (WA_h2(s, 4) < 0.5) WA_dMushroom(c, x + 7, y + 2, 2, WA_h2(s, 3) < 0.6); }
      else if (h < 0.50) WA_pebble(c, x, y, 4 + WA_h2(s, 5) * 5, s, true);
      else if (h < 0.54) WA_dTwig(c, x, y, s);
      else if (h < 0.60 && WA_fbm(x / 200, y / 200 + 5) > 0.5) { WA_wildflower(c, x, y, 5, 2.2, s); WA_wildflower(c, x + 6, y + 3, 5, 2, s + 1); WA_wildflower(c, x - 5, y + 4, 3, 2.4, s + 2); }
    }
  }
}

// ---- land that was just bought and is being cleared ------------------------------------------------------
function WA_gPending(c, E, pendPath) {
  var tx, ty, x, y, i, h, R = E.rect;
  var Y = { x0: Math.max(MAP.yard.x0, Math.floor(R.x0 / TILE) - 1), x1: Math.min(MAP.yard.x1, Math.floor(R.x1 / TILE) + 1), y0: Math.max(MAP.yard.y0, Math.floor(R.y0 / TILE) - 1), y1: Math.min(MAP.yard.y1, Math.floor(R.y1 / TILE) + 1) };
  c.save(); c.clip(pendPath);
  for (ty = Y.y0; ty <= Y.y1; ty++) {
    if (ty % 2) continue;
    // one freshly mown swath per other tile row, with a ragged edge (batched: a few fills per row)
    var any = false;
    c.fillStyle = '#86c768'; c.beginPath();
    for (tx = Y.x0; tx <= Y.x1; tx++) {
      if (!E.pending(tx, ty)) continue;
      any = true; x = tx * TILE; y = ty * TILE;
      c.rect(x, y + 5, TILE, TILE - 10);
      for (i = 0; i < 5; i++) {
        c.moveTo(x + i * 10 + 11, y + 5); c.ellipse(x + i * 10 + 4, y + 5, 7, 2 + WA_h2(tx * 5 + i, ty) * 3, 0, 0, WA_TAU);
        c.moveTo(x + i * 10 + 13, y + TILE - 5); c.ellipse(x + i * 10 + 6, y + TILE - 5, 7, 2 + WA_h2(tx * 5 + i, ty + 9) * 3, 0, 0, WA_TAU);
      }
    }
    if (!any) continue;
    c.fill('nonzero');
    c.strokeStyle = 'rgba(255,255,220,0.35)'; c.lineWidth = 1.2; c.beginPath();
    for (tx = Y.x0; tx <= Y.x1; tx++) { if (!E.pending(tx, ty)) continue; x = tx * TILE; y = ty * TILE; c.moveTo(x, y + 15); c.lineTo(x + TILE, y + 15); c.moveTo(x, y + 33); c.lineTo(x + TILE, y + 33); }
    c.stroke();
    c.strokeStyle = '#b9d274'; c.lineWidth = 1.4; c.beginPath();
    for (tx = Y.x0; tx <= Y.x1; tx++) {
      if (!E.pending(tx, ty)) continue; x = tx * TILE; y = ty * TILE;
      for (i = 0; i < 5; i++) { var qx = x + WA_h2(tx * 9 + i, ty * 3) * TILE, qy = y + 8 + WA_h2(tx, ty * 9 + i) * 32; c.moveTo(qx, qy); c.lineTo(qx + 4, qy + (WA_h2(tx + i, ty + i) - 0.5) * 3); }
    }
    c.stroke();
  }
  for (ty = Y.y0; ty <= Y.y1; ty++) for (tx = Y.x0; tx <= Y.x1; tx++) {
    if (!E.pending(tx, ty)) continue;
    h = WA_h2(tx * 7 + 3, ty * 5 + 11);
    x = (tx + 0.5) * TILE; y = (ty + 0.5) * TILE;
    if (h < 0.09) {               // turned soil
      c.fillStyle = '#6e4a2d'; WA_blob(c, x, y + 1.5, 19, 10, tx * 31 + ty, 0.22, 9); c.fill();
      c.fillStyle = '#8a5f3c'; WA_blob(c, x, y, 18, 9, tx * 31 + ty, 0.22, 9); c.fill();
      c.strokeStyle = '#a27850'; c.lineWidth = 1.6;
      for (i = -1; i <= 1; i++) { c.beginPath(); c.moveTo(x - 13 + Math.abs(i) * 3, y + i * 4.4); c.quadraticCurveTo(x, y + i * 4.4 - 1.6, x + 13 - Math.abs(i) * 3, y + i * 4.4); c.stroke(); }
    } else if (h < 0.16) {        // heap of cut grass
      c.fillStyle = 'rgba(40,26,12,0.18)'; WA_ell(c, x + 1, y + 5, 13, 4); c.fill();
      c.beginPath(); c.moveTo(x - 12, y + 5); c.quadraticCurveTo(x - 9, y - 7, x, y - 8); c.quadraticCurveTo(x + 10, y - 7, x + 12, y + 5); c.closePath();
      WA_fillStroke(c, '#a9c765', 1.4);
      c.strokeStyle = '#86a84c'; c.lineWidth = 1; c.beginPath();
      for (i = 0; i < 5; i++) { c.moveTo(x - 8 + i * 4, y + 3); c.lineTo(x - 6 + i * 3.4, y - 4 + Math.abs(i - 2) * 1.5); }
      c.stroke();
    }
  }
  c.restore();
  // surveyor's stakes and string around the plot being cleared
  function edge(x0, y0, x1, y1) {
    c.strokeStyle = 'rgba(252,244,220,0.9)'; c.lineWidth = 1.3; WA_line(c, x0, y0 - 9, x1, y1 - 9);
    c.strokeStyle = 'rgba(60,40,20,0.25)'; c.lineWidth = 1; WA_line(c, x0, y0, x1, y1);
  }
  var stakes = {};
  for (ty = Y.y0; ty <= Y.y1; ty++) for (tx = Y.x0; tx <= Y.x1; tx++) {
    if (!E.pending(tx, ty)) continue;
    x = tx * TILE; y = ty * TILE;
    var n = !E.pending(tx, ty - 1), s = !E.pending(tx, ty + 1), w = !E.pending(tx - 1, ty), e = !E.pending(tx + 1, ty);
    if (n) edge(x, y + 6, x + TILE, y + 6);
    if (s) edge(x, y + TILE - 5, x + TILE, y + TILE - 5);
    if (w) edge(x + 6, y, x + 6, y + TILE);
    if (e) edge(x + TILE - 6, y, x + TILE - 6, y + TILE);
    if ((n || s) && (tx % 3 === 0 || w || e)) stakes[(x + (e && !w ? TILE - 6 : 6)) + ',' + (n ? y + 6 : y + TILE - 5)] = 1;
    if ((w || e) && (ty % 3 === 0)) stakes[(w ? x + 6 : x + TILE - 6) + ',' + (y + 6)] = 1;
  }
  Object.keys(stakes).forEach(function (k) {
    var q = k.split(','), sx = +q[0], sy = +q[1];
    c.fillStyle = 'rgba(40,26,12,0.2)'; WA_ell(c, sx + 1, sy + 1, 4, 1.6); c.fill();
    c.beginPath(); c.rect(sx - 1.8, sy - 13, 3.6, 13); WA_fillStroke(c, '#c9935a', 1.2);
    c.beginPath(); c.moveTo(sx + 1.5, sy - 13); c.lineTo(sx + 9, sy - 10.5); c.lineTo(sx + 1.5, sy - 8); c.closePath(); WA_fillStroke(c, '#d9574a', 1);
  });
}

// ---- paths -----------------------------------------------------------------------------------------------
var WA_PATHS = null;
function WA_paths() {
  if (WA_PATHS) return WA_PATHS;
  var P = WA_POND, ring = [], i, n = 26;
  for (i = 0; i < n; i++) {
    var a = i / n * WA_TAU, k = 1 + (WA_h2(i, 55) - 0.5) * 0.1;
    ring.push([P.x + Math.cos(a) * 236 * k, P.y + 6 + Math.sin(a) * 152 * k]);
  }
  var loopPts = [ring[n - 1]].concat(ring).concat([ring[0], ring[1]]);
  WA_PATHS = {
    loop: WA_spline(loopPts, 7),
    entry: WA_spline([[70, WA_SWY + 6], [66, 1500], [80, 1360], [62, 1200], [78, 1040], [64, 900], [72, 790], [86, 700], [112, 612], [146, 536], [168, 500]], 7),
    exit: WA_spline([[508, 300], [556, 252], [604, 196], [598, 126], [626, 56], [618, -20]], 7),
    spur: WA_spline([[330, 552], [331, 525], [330, 496]], 7)
  };
  return WA_PATHS;
}
function WA_gGravel(c, lines, w) {
  var i, j, pl;
  c.lineJoin = 'round'; c.lineCap = 'round';
  c.strokeStyle = '#9d8a5e'; c.lineWidth = w + 3.4;
  for (i = 0; i < lines.length; i++) { WA_polyline(c, lines[i]); c.stroke(); }
  c.strokeStyle = '#dccba2'; c.lineWidth = w;
  for (i = 0; i < lines.length; i++) { WA_polyline(c, lines[i]); c.stroke(); }
  c.strokeStyle = '#e6d8b4'; c.lineWidth = w * 0.45;
  for (i = 0; i < lines.length; i++) { WA_polyline(c, lines[i]); c.stroke(); }
  // pebbles
  var cols = ['#c2ae80', '#f1e6c6', '#b29d70', '#cfc09a', '#a9a08c'], ci, k, dx, dy, d, nx, ny;
  for (ci = 0; ci < cols.length; ci++) {                 // one fill per colour
    c.fillStyle = cols[ci]; c.beginPath();
    for (i = 0; i < lines.length; i++) {
      pl = lines[i];
      for (j = 1; j < pl.length; j++) {
        dx = pl[j][0] - pl[j - 1][0]; dy = pl[j][1] - pl[j - 1][1]; d = Math.hypot(dx, dy) || 1; nx = -dy / d; ny = dx / d;
        for (k = 0; k < 3; k++) {
          if (Math.floor(WA_h2(j * 7 + k, i + 3) * cols.length) !== ci) continue;
          var h = WA_h2(i * 1000 + j, k * 7 + 1), off = (h - 0.5) * (w - 4), al = WA_h2(j + k * 31, i + 5);
          var px = pl[j - 1][0] + dx * al + nx * off, py = pl[j - 1][1] + dy * al + ny * off, r = 0.8 + WA_h2(j * 3 + k, i * 9) * 1.3;
          c.moveTo(px + r * 1.25, py); c.ellipse(px, py, r * 1.25, r * 0.85, 0, 0, WA_TAU);
        }
      }
    }
    c.fill();
  }
  // grass creeping over the edge now and then
  for (var pass = 0; pass < 2; pass++) {
    c.strokeStyle = pass ? '#5da84a' : '#4f9443'; c.lineWidth = 1.3; c.beginPath();
    for (i = 0; i < lines.length; i++) {
      pl = lines[i];
      for (j = 1; j < pl.length; j++) {
        var g = WA_h2(j * 13 + i, 77);
        if (g >= 0.16 || (g < 0.04) !== !!pass) continue;
        dx = pl[j][0] - pl[j - 1][0]; dy = pl[j][1] - pl[j - 1][1]; d = Math.hypot(dx, dy) || 1; nx = -dy / d; ny = dx / d;
        var side = g < 0.08 ? 1 : -1;
        WA_tuftAdd(c, pl[j][0] + nx * side * (w / 2 + 1), pl[j][1] + ny * side * (w / 2 + 1) + 2, 3, 6, 1.3, j * 17 + i);
      }
    }
    c.stroke();
  }
}

// ---- water -----------------------------------------------------------------------------------------------
function WA_gWater(c, P, n, amp) {
  var i;
  c.fillStyle = 'rgba(63,125,58,0.55)'; WA_blob(c, P.x, P.y + 2, P.rx + 19, P.ry + 15, P.seed, amp, n); c.fill();
  WA_blob(c, P.x, P.y, P.rx + 12, P.ry + 9, P.seed, amp, n); WA_fillStroke(c, '#d3bc84', 1.2, '#9a8450');
  c.fillStyle = '#b9a068'; WA_blob(c, P.x, P.y + 1, P.rx + 5, P.ry + 4, P.seed, amp, n); c.fill();
  var g = c.createRadialGradient(P.x - P.rx * 0.15, P.y - P.ry * 0.1, P.ry * 0.15, P.x, P.y, Math.max(P.rx, P.ry));
  g.addColorStop(0, '#4a9bd0'); g.addColorStop(0.7, '#62b8e2'); g.addColorStop(1, '#74c6e8');
  WA_blob(c, P.x, P.y, P.rx, P.ry, P.seed, amp, n); c.fillStyle = g; c.fill();
  c.save(); c.clip();
  c.strokeStyle = 'rgba(196,238,246,0.75)'; c.lineWidth = 7; WA_blob(c, P.x, P.y, P.rx - 1, P.ry - 1, P.seed, amp, n); c.stroke();
  c.strokeStyle = 'rgba(40,80,120,0.28)'; c.lineWidth = 5; WA_blob(c, P.x + 1, P.y - 4.5, P.rx, P.ry, P.seed, amp, n); c.stroke();   // shade under the far bank
  c.setLineDash([10, 8, 4, 9]); c.strokeStyle = 'rgba(255,255,255,0.8)'; c.lineWidth = 1.4;
  WA_blob(c, P.x, P.y + 1, P.rx - 7, P.ry - 6, P.seed, amp, n); c.stroke(); c.setLineDash([]);
  c.globalAlpha = 0.4; c.fillStyle = '#3f8fc4'; WA_blob(c, P.x + P.rx * 0.08, P.y + P.ry * 0.08, P.rx * 0.6, P.ry * 0.55, P.seed + 5, 0.2, 9); c.fill();
  c.globalAlpha = 0.3; c.fillStyle = '#377fb4'; WA_blob(c, P.x + P.rx * 0.12, P.y + P.ry * 0.12, P.rx * 0.33, P.ry * 0.3, P.seed + 9, 0.2, 8); c.fill();
  c.globalAlpha = 1;
  c.strokeStyle = 'rgba(255,255,255,0.55)'; c.lineWidth = 1.2;
  for (i = 0; i < Math.round(P.rx * P.ry / 900); i++) {
    var a = WA_h2(i, P.seed) * WA_TAU, r = Math.sqrt(WA_h2(i, P.seed + 1)) * 0.82;
    var x = P.x + Math.cos(a) * P.rx * r, y = P.y + Math.sin(a) * P.ry * r, l = 4 + WA_h2(i, P.seed + 2) * 7;
    c.beginPath(); c.moveTo(x - l, y); c.quadraticCurveTo(x, y - 2.2, x + l, y); c.stroke();
    if (i % 3 === 0) { c.beginPath(); c.moveTo(x - l * 0.5 + 3, y + 4); c.quadraticCurveTo(x + 3, y + 2.4, x + l * 0.5 + 3, y + 4); c.stroke(); }
  }
  c.restore();
  WA_blob(c, P.x, P.y, P.rx, P.ry, P.seed, amp, n); c.strokeStyle = WA_OUT; c.lineWidth = 1.7; c.stroke();
}
function WA_lilyPad(c, x, y, r, rot, flower) {
  c.fillStyle = 'rgba(30,70,110,0.25)'; WA_ell(c, x + 1, y + 1.8, r, r * 0.62); c.fill();
  c.beginPath(); c.ellipse(x, y, r, r * 0.62, 0, rot + 0.35, rot + WA_TAU - 0.35); c.lineTo(x, y); c.closePath();
  WA_fillStroke(c, '#5fae52', 1.1, '#2f6a3a');
  c.strokeStyle = '#8ccf6e'; c.lineWidth = 1; c.beginPath(); c.ellipse(x, y, r * 0.6, r * 0.36, 0, Math.PI * 1.05, Math.PI * 1.6); c.stroke();
  if (flower) {
    for (var i = 0; i < 5; i++) {
      var a = -Math.PI / 2 + (i - 2) * 0.55;
      c.beginPath(); c.ellipse(x + Math.cos(a) * 2.6, y - 2 + Math.sin(a) * 2.2, 3.1, 1.7, a, 0, WA_TAU);
      WA_fillStroke(c, flower === 2 ? '#fdfaf0' : i % 2 ? '#f2a0b5' : '#f7bccb', 0.8, '#b8607a');
    }
    c.fillStyle = '#f2c14e'; WA_ell(c, x, y - 2, 1.5, 1.2); c.fill();
  }
}

// ---- garden flowers (bigger, for beds) -------------------------------------------------------------------
// kind: 0 tulip, 1 big daisy, 2 lavender, 3 marigold, 4 daffodil, 5 pansy, 6 rose
function WA_bedFlower(c, x, y, kind, col, s, seed) {
  var v = WA_vi(seed, 3);
  WA_decal(c, 'bf' + kind + col + v, 22, 32, 11, 27, x, y, function (g) { WA_bedFlowerRaw(g, 0, 0, kind, col, 0.95, v * 29 + 3); });
}
function WA_bedFlowerRaw(c, x, y, kind, col, s, seed) {
  var h = WA_h2(seed, 21), lean = (h - 0.5) * 3, st = (kind === 2 ? 11 : kind === 5 ? 5 : 9) * s + h * 3, fx = x + lean, fy = y - st, i, a;
  // leaves + stem
  c.strokeStyle = '#2f6a3a'; c.lineWidth = 1.3; c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x, y - st * 0.5, fx, fy); c.stroke();
  c.fillStyle = h < 0.5 ? '#4f9a45' : '#5aa84e';
  c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x - 5 * s, y - 3 * s, x - 4.5 * s, y - 7 * s); c.quadraticCurveTo(x - 1.5 * s, y - 4 * s, x, y); c.fill();
  c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x + 5 * s, y - 2 * s, x + 5 * s, y - 6 * s); c.quadraticCurveTo(x + 1.5 * s, y - 3.5 * s, x, y); c.fill();
  c.lineWidth = 0.9; c.strokeStyle = WA_OUT;
  if (kind === 0) {
    c.beginPath(); c.moveTo(fx - 3 * s, fy - 4.5 * s); c.lineTo(fx - 1.3 * s, fy - 3 * s); c.lineTo(fx, fy - 5.2 * s); c.lineTo(fx + 1.3 * s, fy - 3 * s); c.lineTo(fx + 3 * s, fy - 4.5 * s);
    c.quadraticCurveTo(fx + 3.6 * s, fy + 1.2 * s, fx, fy + 1.4 * s); c.quadraticCurveTo(fx - 3.6 * s, fy + 1.2 * s, fx - 3 * s, fy - 4.5 * s); c.closePath();
    c.fillStyle = col; c.fill(); c.stroke();
    c.fillStyle = 'rgba(255,255,255,0.35)'; WA_ell(c, fx - 1.2 * s, fy - 1.5 * s, 0.8 * s, 1.8 * s); c.fill();
  } else if (kind === 1 || kind === 4) {
    c.fillStyle = col; c.beginPath();
    var np = kind === 1 ? 7 : 6;
    for (i = 0; i < np; i++) { a = i / np * WA_TAU + h; c.moveTo(fx + Math.cos(a) * 2.6 * s + 1.9 * s, fy - 2 * s + Math.sin(a) * 2.4 * s); c.ellipse(fx + Math.cos(a) * 2.6 * s, fy - 2 * s + Math.sin(a) * 2.4 * s, 1.9 * s, 1.5 * s, a, 0, WA_TAU); }
    c.fill(); c.stroke(); c.fill();
    c.beginPath(); c.arc(fx, fy - 2 * s, 1.7 * s, 0, WA_TAU); c.fillStyle = kind === 1 ? '#f2c14e' : '#f08a4b'; c.fill(); c.lineWidth = 0.7; c.stroke();
  } else if (kind === 2) {
    for (i = 0; i < 3; i++) {
      var lx = x + (i - 1) * 3.2 * s, top = y - st - (i === 1 ? 2 : 0);
      c.strokeStyle = '#4c8a4a'; c.lineWidth = 1; WA_line(c, x, y, lx, top + 4);
      c.beginPath(); c.ellipse(lx, top, 1.9 * s, 4.4 * s, (i - 1) * 0.2, 0, WA_TAU);
      c.fillStyle = i === 1 ? col : '#8f74c4'; c.fill(); c.strokeStyle = '#5d4791'; c.lineWidth = 0.8; c.stroke();
    }
  } else if (kind === 3 || kind === 6) {
    c.beginPath(); WA_blobAdd(c, fx, fy - 2 * s, 3.7 * s, 3.3 * s, seed, 0.14, 8); c.fillStyle = col; c.fill(); c.stroke();
    c.strokeStyle = 'rgba(90,30,20,0.5)'; c.lineWidth = 0.8;
    c.beginPath(); c.arc(fx, fy - 2 * s, 1.9 * s, 0.4, 3.8); c.stroke(); c.beginPath(); c.arc(fx + 0.3, fy - 1.8 * s, 0.8 * s, 2.5, 6.2); c.stroke();
    c.fillStyle = 'rgba(255,255,255,0.3)'; WA_ell(c, fx - 1.3 * s, fy - 3.3 * s, 1.2 * s, 0.8 * s); c.fill();
  } else {
    c.fillStyle = col; c.beginPath();
    c.ellipse(fx - 2 * s, fy - 2.6 * s, 2.3 * s, 2 * s, 0, 0, WA_TAU); c.moveTo(fx + 4.3 * s, fy - 2.6 * s); c.ellipse(fx + 2 * s, fy - 2.6 * s, 2.3 * s, 2 * s, 0, 0, WA_TAU);
    c.moveTo(fx + 2.6 * s, fy); c.ellipse(fx, fy - 0.2 * s, 2.6 * s, 2.2 * s, 0, 0, WA_TAU);
    c.fill(); c.stroke(); c.fill();
    c.fillStyle = '#f2c14e'; WA_ell(c, fx, fy - 1.2 * s, 1.2 * s, 1.1 * s); c.fill();
    c.fillStyle = '#3b2a20'; WA_ell(c, fx, fy - 1.2 * s, 0.5 * s, 0.5 * s); c.fill();
  }
}
var WA_BED_COLS = [['#d9574a', '#f2c14e', '#f2a0b5', '#fdfaf0', '#e8743b'], ['#fdfaf0', '#fbe08a'], ['#a58bd6', '#b79be0'], ['#f08a4b', '#f2c14e', '#e8743b'], ['#f7d774', '#fdf3c0'], ['#8f74c4', '#f2c14e', '#6f93dc', '#fdfaf0'], ['#f2a0b5', '#e07f9c', '#d9574a', '#fbd0dc']];
function WA_soil(c, path, b) {
  c.save(); path(); c.fillStyle = '#7b5234'; c.fill(); c.clip();
  WA_mottle(c, b[0], b[1], b[2], b[3], 16, ['#6a452b', '#8a5f3c', '#70492e'], 0.6, 4, 9, 3);
  c.fillStyle = '#a07850';
  for (var i = 0; i < (b[2] - b[0]) * (b[3] - b[1]) / 90; i++) { c.fillRect(b[0] + WA_h2(i, b[0]) * (b[2] - b[0]), b[1] + WA_h2(b[1], i) * (b[3] - b[1]), 1.6, 1.1); }
  c.fillStyle = 'rgba(40,20,8,0.28)'; c.fillRect(b[0], b[1], b[2] - b[0], 3.5);      // shade under the northern edge
  c.restore();
}
// oval flower bed edged with stones
function WA_gRoundBed(c, cx, cy, rx, ry, seed, kinds) {
  var i, n = Math.round((rx + ry) * 0.42), fl = [];
  WA_soil(c, function () { WA_ell(c, cx, cy, rx, ry); }, [cx - rx, cy - ry, cx + rx, cy + ry]);
  WA_ell(c, cx, cy, rx, ry); c.strokeStyle = '#4a2f1c'; c.lineWidth = 1.2; c.stroke();
  for (i = 0; i < n; i++) {
    var a = i / n * WA_TAU + 0.2;
    if (Math.sin(a) < -0.2) WA_pebble(c, cx + Math.cos(a) * (rx + 1), cy + Math.sin(a) * (ry + 1), 4 + WA_h2(i, seed) * 1.6, seed + i, WA_h2(i, seed + 1) < 0.2);
  }
  var count = Math.round(rx * ry / 26);
  for (i = 0; i < count; i++) {
    var a2 = WA_h2(i, seed + 2) * WA_TAU, r = Math.sqrt(WA_h2(i, seed + 3)) * 0.8;
    fl.push([cx + Math.cos(a2) * rx * r, cy + Math.sin(a2) * ry * r * 0.85 + 3, i]);
  }
  fl.sort(function (p, q) { return p[1] - q[1]; });
  fl.forEach(function (f) {
    var ring = Math.hypot((f[0] - cx) / rx, (f[1] - cy) / ry) > 0.5 ? 0 : 1, k = kinds[ring % kinds.length], cols = WA_BED_COLS[k];
    WA_bedFlower(c, f[0], f[1], k, cols[Math.floor(WA_h2(f[2], seed + 4) * (ring ? cols.length : Math.min(2, cols.length)))], 0.95, seed * 31 + f[2]);
  });
  for (i = 0; i < n; i++) {
    var a3 = i / n * WA_TAU + 0.2;
    if (Math.sin(a3) >= -0.2) WA_pebble(c, cx + Math.cos(a3) * (rx + 1), cy + Math.sin(a3) * (ry + 1), 4 + WA_h2(i, seed) * 1.6, seed + i, WA_h2(i, seed + 1) < 0.2);
  }
}

// ---- the park, the pond, the west garden -----------------------------------------------------------------
function WA_gPark(c, E) {
  var gx, gy, x, y, h, i, cell = 30, P = WA_POND, paths = WA_paths(), R = E.rect;
  if (!E.hit(0, 90, WA_YX0 + 10, WA_SWY)) return;
  var gyA = Math.max(3, Math.floor((R.y0 - 20) / cell)), gyB = Math.min(Math.ceil(WA_SWY / cell), Math.ceil((R.y1 + 20) / cell));
  var gxA = Math.max(0, Math.floor((R.x0 - 20) / cell)), gxB = Math.min(Math.ceil(WA_YX0 / cell), Math.ceil((R.x1 + 20) / cell));
  // lawn details
  for (var pass = 0; pass < 2; pass++) {
    c.strokeStyle = pass ? '#9ad678' : '#58a548'; c.lineWidth = 1.3; c.beginPath();
    for (gy = gyA; gy < gyB; gy++) for (gx = gxA; gx < gxB; gx++) {
      x = (gx + WA_h2(gx + pass * 7, gy * 3)) * cell; y = (gy + WA_h2(gx * 3, gy + pass * 5)) * cell;
      if (WA_forestness(x, y) > 0.3 || y > WA_SWY - 4 || x > WA_YX0 - 4) continue;
      if (x > WA_SX0 - 2 && y > WA_SY0 - 2) continue;
      if (WA_h2(gx * 11 + pass, gy * 7) < (pass ? 0.6 : 0.3)) continue;
      WA_tuftAdd(c, x, y, 3, pass ? 5 : 6.5, 1.2, gx * 57 + gy * 131 + pass);
    }
    c.stroke();
  }
  for (gy = gyA; gy < gyB; gy++) for (gx = gxA; gx < gxB; gx++) {
    x = (gx + WA_h2(gx * 5 + 2, gy * 3)) * cell; y = (gy + WA_h2(gx * 3, gy * 7 + 5)) * cell;
    if (WA_forestness(x, y) > 0.3 || y > WA_SWY - 6 || x > WA_YX0 - 6) continue;
    if (x > WA_SX0 - 4 && y > WA_SY0 - 4) continue;
    h = WA_h2(gx * 13 + 1, gy * 17 + 3);
    var drift = WA_fbm(x / 190 + 5, y / 190 + 1), s = gx * 313 + gy * 71;
    if (h < (drift > 0.56 ? 0.45 : 0.05)) WA_wildflower(c, x, y, 0, 2.2, s);
    else if (h < (drift < 0.42 ? 0.5 : 0.09)) WA_wildflower(c, x, y, 1, 2.1, s);
    else if (h < 0.56 && drift > 0.47 && drift < 0.53) WA_wildflower(c, x, y, 4, 2.3, s);
    else if (h > 0.985) WA_pebble(c, x, y, 3 + WA_h2(s, 1) * 3, s, false);
    else if (h > 0.95) WA_dClover(c, x, y, s);
  }
  if (!E.hit(0, 90, WA_YX0 + 10, WA_SY0 + 10) && !E.hit(0, WA_SY0, WA_SX0 + 4, WA_SWY)) return;

  // the wildflower meadow
  var M = WA_MEADOW, fl = [];
  if (E.hit(M.x - M.rx - 30, M.y - M.ry - 30, M.x + M.rx + 30, M.y + M.ry + 30)) {
  c.globalAlpha = 0.5; c.fillStyle = '#69ae53'; WA_blob(c, M.x, M.y, M.rx + 8, M.ry + 6, 9, 0.16, 12); c.fill(); c.globalAlpha = 1;
  for (i = 0; i < 760; i++) {
    var a = WA_h2(i, 301) * WA_TAU, r = Math.pow(WA_h2(i, 302), 0.62);
    x = M.x + Math.cos(a) * M.rx * r * (1 + (WA_noise(a * 2, 3) - 0.5) * 0.3); y = M.y + Math.sin(a) * M.ry * r;
    if (x > WA_YX0 - 8 || y > WA_SY0 - 6) continue;
    fl.push([x, y, i]);
  }
  fl.sort(function (p, q) { return p[1] - q[1]; });
  c.strokeStyle = '#4f9443'; c.lineWidth = 1.4; c.beginPath();
  for (i = 0; i < fl.length; i += 2) WA_tuftAdd(c, fl[i][0] + 4, fl[i][1] + 2, 3, 9, 1.1, fl[i][2]);
  c.stroke();
  var mk = [2, 0, 3, 1, 5, 4, 7, 6];
  fl.forEach(function (f) {
    var zone = Math.floor(WA_noise(f[0] / 70 + 3, f[1] / 70) * mk.length) % mk.length;
    var k = WA_h2(f[2], 303) < 0.62 ? mk[zone] : mk[Math.floor(WA_h2(f[2], 304) * mk.length)];
    WA_wildflower(c, f[0], f[1], k, 2.5 + WA_h2(f[2], 305) * 1.2, f[2] * 7);
  });
  }
  if (!E.hit(0, 0, 680, WA_SWY + 10) && !E.hit(680, 180, 800, 380)) return;     // nothing else of the park is near the repainted area

  // gravel paths
  WA_gGravel(c, [paths.loop, paths.entry, paths.exit, paths.spur], 25);

  // duck pond
  WA_gWater(c, P, 14, 0.12);
  // jetty
  var jx = 330, jy0 = 432, jy1 = 500, jw = 34;
  c.fillStyle = 'rgba(30,60,100,0.3)'; c.fillRect(jx - jw / 2 + 3, jy0 + 4, jw, jy1 - jy0 - 14);
  for (i = 0; i < Math.floor((jy1 - jy0) / 8.5); i++) {
    y = jy0 + i * 8.5;
    c.beginPath(); c.rect(jx - jw / 2 + (WA_h2(i, 71) - 0.5) * 2, y, jw, 8.5);
    WA_fillStroke(c, i % 3 === 1 ? '#b9854d' : i % 3 ? '#c9935a' : '#d3a068', 1.1, '#6b4526');
    c.strokeStyle = 'rgba(122,78,42,0.5)'; c.lineWidth = 0.8; WA_line(c, jx - jw / 2 + 4 + WA_h2(i, 72) * 8, y + 4.5, jx + 2 + WA_h2(i, 73) * 10, y + 4.5);
    c.fillStyle = '#6b4526'; c.fillRect(jx - jw / 2 + 3, y + 3.5, 1.6, 1.6); c.fillRect(jx + jw / 2 - 4.5, y + 3.5, 1.6, 1.6);
  }
  c.strokeStyle = WA_OUT; c.lineWidth = 1.6; c.strokeRect(jx - jw / 2, jy0, jw, jy1 - jy0);
  // lily pads
  var pads = [[-96, -30, 11, 1], [-74, -14, 8, 0], [-108, 4, 7, 0], [70, 34, 11, 2], [92, 22, 8, 0], [58, 52, 7, 0], [84, -44, 9, 1], [110, -20, 7, 0], [-46, 50, 8, 0], [-20, -58, 7, 0], [22, -50, 9, 0]];
  pads.forEach(function (q, k) { WA_lilyPad(c, P.x + q[0], P.y + q[1], q[2], WA_h2(k, 91) * 6, q[3]); });
  // stones on the bank
  [[-160, 44], [-171, -18], [-120, -74], [150, -52], [170, 26], [112, 78], [-70, 90], [44, -96], [60, 94]].forEach(function (q, k) {
    WA_pebble(c, P.x + q[0], P.y + q[1], 6 + WA_h2(k, 93) * 4, 500 + k, k % 3 === 0);
    if (k % 2) WA_pebble(c, P.x + q[0] + 10, P.y + q[1] + 4, 3.5, 520 + k, false);
  });

  // picnic blanket
  c.save(); c.translate(WA_PICNIC.x, WA_PICNIC.y); c.rotate(-0.1);
  c.fillStyle = 'rgba(40,26,12,0.18)'; WA_rr(c, -38, -23, 80, 52, 4); c.fill();
  WA_rr(c, -40, -26, 80, 52, 3); c.fillStyle = '#f7efe0'; c.fill();
  c.save(); c.clip();
  c.fillStyle = 'rgba(217,87,74,0.55)';
  for (i = 0; i < 8; i++) c.fillRect(-40 + i * 10.2 + 1, -26, 5.1, 52);
  for (i = 0; i < 6; i++) c.fillRect(-40, -26 + i * 10.2 - 1, 80, 5.1);
  c.restore();
  WA_rr(c, -40, -26, 80, 52, 3); c.strokeStyle = WA_OUT; c.lineWidth = 1.7; c.stroke();
  c.beginPath(); c.moveTo(40, 14); c.lineTo(28, 26); c.lineTo(40, 26); c.closePath(); WA_fillStroke(c, '#e9c9c0', 1.2);
  // plates, sandwich, apple, cups
  WA_ell(c, -18, 6, 9, 6); WA_fillStroke(c, '#fdfaf0', 1.1); WA_ell(c, -18, 6, 6, 3.8); c.strokeStyle = '#d9d2c2'; c.lineWidth = 0.8; c.stroke();
  c.beginPath(); c.moveTo(-23, 7); c.lineTo(-13, 7); c.lineTo(-18, 0.5); c.closePath(); WA_fillStroke(c, '#e8c88a', 1);
  c.strokeStyle = '#6fae52'; c.lineWidth = 1.2; WA_line(c, -21.5, 5.2, -14.5, 5.2);
  WA_ell(c, 4, 12, 8, 5.4); WA_fillStroke(c, '#fdfaf0', 1.1);
  WA_ell(c, 2, 10.5, 3, 2.8); WA_fillStroke(c, '#d9574a', 0.9); WA_ell(c, 7, 12, 2.6, 2.4); WA_fillStroke(c, '#8fc46a', 0.9);
  c.beginPath(); c.rect(-4, -12, 5, 7); WA_fillStroke(c, '#66bde3', 1); c.beginPath(); c.rect(-27, -14, 5, 7); WA_fillStroke(c, '#f2c14e', 1);
  c.restore();

  // ornamental beds in the park
  WA_gRoundBed(c, 214, 648, 40, 20, 7, [3, 0]);
  WA_gRoundBed(c, 470, 642, 46, 22, 19, [1, 6]);
  WA_gRoundBed(c, 668, 236, 30, 16, 23, [2, 4]);

  // west garden: a long bed against the building's side wall
  var bx0 = WA_SX0 - 34, bx1 = WA_SX0 - 3, by0 = 884, by1 = 1604;
  WA_soil(c, function () { WA_rr(c, bx0, by0, bx1 - bx0, by1 - by0, 9); }, [bx0, by0, bx1, by1]);
  WA_rr(c, bx0, by0, bx1 - bx0, by1 - by0, 9); c.strokeStyle = '#4a2f1c'; c.lineWidth = 1.2; c.stroke();
  for (y = by0 + 6; y < by1 - 2; y += 9.5) WA_pebble(c, bx0 - 1 + WA_h2(y, 5) * 2, y, 4.6 + WA_h2(y, 6) * 1.4, Math.round(y), WA_h2(y, 7) < 0.15);
  var grp = [[0, 0], [2, 2], [3, 0], [1, 1], [6, 0], [4, 0], [5, 0], [0, 2], [2, 1], [6, 3]];
  for (y = by0 + 12; y < by1 - 3; y += 8) {
    var g = grp[Math.floor((y - by0) / 74) % grp.length], cols = WA_BED_COLS[g[0]];
    if (Math.floor((y - by0) / 74) % 4 === 1 && WA_h2(y, 9) < 0.9) continue;   // gaps where bushes (props) stand
    x = bx0 + 9 + WA_h2(y, 8) * (bx1 - bx0 - 15);
    WA_bedFlower(c, x, y, g[0], cols[(g[1] + Math.floor(WA_h2(y, 10) * 2)) % cols.length], 0.95, Math.round(y) * 3);
  }
}

// ---- the lake on the east edge ---------------------------------------------------------------------------
function WA_gLake(c, E) {
  var L = WA_LAKE, i;
  if (!E.hit(WA_YX1 - 4, L.y - L.ry - 30, WA_WW, L.y + L.ry + 30)) return;
  c.save(); c.beginPath(); c.rect(WA_YX1, 0, WA_WW - WA_YX1, WA_YY1); c.clip();
  WA_gWater(c, L, 18, 0.07);
  [[-118, -150, 9, 1], [-104, -118, 7, 0], [-96, 60, 10, 2], [-112, 96, 7, 0], [-80, 180, 9, 0], [-70, -220, 8, 1], [-60, 226, 7, 0]].forEach(function (q, k) { WA_lilyPad(c, L.x + q[0], L.y + q[1], q[2], WA_h2(k, 95) * 6, q[3]); });
  [[-134, -60], [-138, 130], [-112, -216], [-100, 232], [-140, 20]].forEach(function (q, k) { WA_pebble(c, L.x + q[0], L.y + q[1], 6 + WA_h2(k, 97) * 4, 600 + k, k % 2 === 0); });
  c.restore();
}

// ---- street layout shared by ground and props ------------------------------------------------------------
var WA_ST = {
  lamps: [312, 648, 1032, 1416, 1800, 2184, 2568],     // x of street lamps (they stand on the kerb)
  bus: { x0: 1958, x1: 2098 },                         // paved pad of the bus shelter (verge)
  bike: { x0: 874, x1: 1004 },                         // paved pad of the bike rack (verge)
  bays: [[676, 868], [1150, 1342], [1342, 1534], [2290, 2482], [2482, 2674]],   // parking bays (x ranges)
  busBay: [1930, 2126],
  bedY0: 1594, bedY1: 1626, hedgeY: 1587
};

// paving slabs (running bond), used for the sidewalk and the little paved pads
function WA_gSlabs(c, x0, y0, x1, y1, rows, seed) {
  var rh = (y1 - y0) / rows, r, x, w, i;
  c.save(); c.beginPath(); c.rect(x0, y0, x1 - x0, y1 - y0); c.clip();
  c.fillStyle = '#d8c8a6'; c.fillRect(x0, y0, x1 - x0, y1 - y0);
  for (r = 0; r < rows; r++) {
    var y = y0 + r * rh;
    x = Math.floor(x0 / 600) * 600 - (r % 2 ? 30 : 0) - 60; i = Math.floor(x0 / 600) * 40;
    while (x < x1) {
      w = 46 + Math.floor(WA_h2(i + seed, r * 7 + 1) * 4) * 7;
      if (x + w > x0) {
        var h = WA_h2(i * 3 + seed, r + 5), tone = WA_fbm(x / 300 + seed, r * 0.7);
        c.fillStyle = h < 0.22 ? '#cfbe9a' : h < 0.4 ? '#e2d4b3' : h < 0.5 ? '#d6c0a2' : tone > 0.55 ? '#dccdab' : '#d5c5a2';
        c.fillRect(x, y, w, rh);
        c.fillStyle = 'rgba(255,250,232,0.5)'; c.fillRect(x + 1.2, y + 1.2, w - 2.4, 1.3); c.fillRect(x + 1.2, y + 1.2, 1.3, rh - 2.4);   // bevel light
        c.fillStyle = 'rgba(120,96,60,0.16)'; c.fillRect(x + 1.2, y + rh - 2.6, w - 2.4, 1.6);
        // speckle
        c.fillStyle = 'rgba(120,100,70,0.22)';
        for (var k = 0; k < 5; k++) c.fillRect(x + 3 + WA_h2(i + k, r * 3 + seed) * (w - 6), y + 3 + WA_h2(i, k + r * 11 + seed) * (rh - 6), 1.3, 1.1);
        if (h > 0.9) {          // crack
          c.strokeStyle = 'rgba(110,90,60,0.75)'; c.lineWidth = 0.9; c.beginPath();
          var cx = x + w * (0.25 + WA_h2(i, 9) * 0.5); c.moveTo(cx, y + 1);
          c.lineTo(cx + 3, y + rh * 0.3); c.lineTo(cx - 2, y + rh * 0.55); c.lineTo(cx + 4, y + rh * 0.8); c.lineTo(cx + 2, y + rh - 1); c.stroke();
          c.beginPath(); c.moveTo(cx - 2, y + rh * 0.55); c.lineTo(cx - 8, y + rh * 0.7); c.stroke();
        }
        c.fillStyle = '#a39370'; c.fillRect(x + w - 0.8, y, 1.6, rh);
      }
      x += w; i++;
    }
    c.fillStyle = '#a39370'; c.fillRect(x0, y + rh - 0.8, x1 - x0, 1.6);
  }
  c.restore();
}
function WA_chalkLine(c, pts, seed) {
  c.beginPath();
  for (var i = 0; i < pts.length; i++) {
    var x = pts[i][0] + (WA_h2(seed + i, 3) - 0.5) * 1.1, y = pts[i][1] + (WA_h2(seed, i + 5) - 0.5) * 1.1;
    if (i) c.lineTo(x, y); else c.moveTo(x, y);
  }
  c.stroke();
}
function WA_pawPrint(c, x, y, s, rot) {
  c.save(); c.translate(x, y); c.rotate(rot);
  WA_ell(c, 0, 0, 2.4 * s, 2 * s); c.fill();
  for (var i = 0; i < 4; i++) { WA_ell(c, (i - 1.5) * 1.8 * s, -3 * s + Math.abs(i - 1.5) * 0.9 * s, 0.95 * s, 1.2 * s); c.fill(); }
  c.restore();
}

// ---- the verge between yard and sidewalk: lawn strip, hedge line (props) and a long flower border ----------
function WA_gBorder(c, E) {
  var x0 = WA_YX0, y0 = WA_YY1, y1 = WA_SWY, x, y, i, S = WA_ST;
  if (!E.hit(x0 - 30, y0 - 24, WA_WW, y1 + 8)) return;
  c.fillStyle = '#73b95b'; c.fillRect(x0, y0, WA_WW - x0, y1 - y0);
  c.save(); c.beginPath(); c.rect(x0, y0, WA_WW - x0, y1 - y0); c.clip();
  WA_mottle(c, x0, y0, WA_WW, y1, 90, ['#7cc260', '#6bb155', '#80c566'], 0.5, 30, 70, 61);
  c.restore();
  // ragged top edge where the land behind is still wild
  for (x = x0; x < WA_WW; x += 12) {
    var tx = Math.floor(x / TILE);
    if (E.owned(tx, MAP.yard.y1)) continue;
    var h = WA_h2(x, 171);
    c.fillStyle = h < 0.4 ? '#5d9d49' : h < 0.7 ? '#578f44' : '#64a34d';
    WA_blob(c, x + h * 8, y0 + 1 + h * 5, 11 + WA_h2(x, 5) * 8, 6 + h * 6, x * 3, 0.25, 7); c.fill();
  }
  c.strokeStyle = '#4c8a3e'; c.lineWidth = 1.4; c.beginPath();
  for (x = x0; x < WA_WW; x += 9) { if (!E.owned(Math.floor(x / TILE), MAP.yard.y1) && WA_h2(x, 173) < 0.6) WA_tuftAdd(c, x, y0 + 6 + WA_h2(x, 174) * 7, 4, 10, 1.1, Math.round(x)); }
  c.stroke();
  c.strokeStyle = '#58a548'; c.lineWidth = 1.3; c.beginPath();
  for (x = x0 + 5; x < WA_WW; x += 17) WA_tuftAdd(c, x + WA_h2(x, 175) * 10, y0 + 16 + WA_h2(x, 176) * 30, 3, 6, 1.2, Math.round(x) + 9);
  c.stroke();
  for (x = x0 + 20; x < WA_WW; x += 31) { if (WA_h2(x, 177) < 0.45) WA_wildflower(c, x + WA_h2(x, 178) * 12, y0 + 14 + WA_h2(x, 179) * 8, WA_h2(x, 180) < 0.6 ? 0 : 1, 2.1, Math.round(x)); }

  // paved pads
  WA_gSlabs(c, S.bike.x0, 1590, S.bike.x1, y1, 2, 3);
  c.strokeStyle = '#8f8163'; c.lineWidth = 1.4; c.strokeRect(S.bike.x0, 1590, S.bike.x1 - S.bike.x0, y1 - 1590 + 2);
  WA_gSlabs(c, S.bus.x0, 1572, S.bus.x1, y1, 3, 5);
  c.strokeStyle = '#8f8163'; c.lineWidth = 1.4; c.strokeRect(S.bus.x0, 1572, S.bus.x1 - S.bus.x0, y1 - 1572 + 2);

  // flower border: soil bed with a brick edge towards the sidewalk
  var segs = [[x0 + 8, S.bike.x0 - 6], [S.bike.x1 + 6, S.bus.x0 - 6], [S.bus.x1 + 6, WA_WW + 20]].filter(function (s) { return s[1] - s[0] > 10; });
  segs.forEach(function (s) {
    WA_soil(c, function () { WA_rr(c, s[0], S.bedY0, s[1] - s[0], S.bedY1 - S.bedY0 + 4, 8); }, [s[0], S.bedY0, s[1], S.bedY1 + 4]);
    WA_rr(c, s[0], S.bedY0, s[1] - s[0], S.bedY1 - S.bedY0 + 4, 8); c.strokeStyle = '#4a2f1c'; c.lineWidth = 1.2; c.stroke();
  });
  var fl = [], RX0 = E.rect.x0 - 30, RX1 = E.rect.x1 + 30;
  segs.forEach(function (s) {
    for (x = s[0] + 8; x < Math.min(s[1], WA_WW) - 6; x += 7.5) {
      if (x < RX0 || x > RX1) continue;
      var row = Math.round(x / 7.5) % 2;
      fl.push([x + (WA_h2(x, 181) - 0.5) * 4, (row ? 1611 : 1621) + (WA_h2(x, 182) - 0.5) * 4, Math.round(x)]);
    }
  });
  fl.sort(function (p, q) { return p[1] - q[1]; });
  var plan = [[0, 0, 1], [2, 0, 1], [3, 0, 2], [1, 0, 1], [6, 0, 3], [4, 0, 1], [0, 2, 4], [5, 0, 3], [2, 1, 1], [3, 1, 2], [0, 3, 4], [6, 2, 3]];
  fl.forEach(function (f) {
    // drifts ~3 tiles long, boundaries wobble so neighbouring drifts mingle
    var gi = Math.floor((f[0] + WA_noise(f[0] / 40, 7) * 60) / 150), g = plan[((gi % plan.length) + plan.length) % plan.length], cols = WA_BED_COLS[g[0]];
    var col = cols[(g[1] + Math.floor(WA_h2(f[2], 183) * g[2])) % cols.length];
    if (WA_h2(f[2], 184) < 0.1) return;
    WA_bedFlower(c, f[0], f[1], g[0], col, 0.95, f[2] * 5);
  });
  // brick edging
  segs.forEach(function (s) {
    for (x = s[0] + 2; x < Math.min(s[1], WA_WW) - 2; x += 13) {
      var w = Math.min(12.4, s[1] - 2 - x);
      if (w < 5) break;
      if (x < RX0 || x > RX1) continue;
      if (w > 12) { var bv = WA_h2(x, 185) < 0.3 ? 0 : WA_h2(x, 185) < 0.6 ? 1 : 2; WA_decal(c, 'brick' + bv, 16, 11, 2, 2, x, S.bedY1 - 1, (function (bv) { return function (g) { WA_rr(g, 0, 0, 12.4, 7, 1.5); WA_fillStroke(g, ['#bf5f42', '#d27a58', '#c9694a'][bv], 1, '#5e3322'); g.fillStyle = 'rgba(255,220,190,0.45)'; g.fillRect(1.5, 1, 9.4, 1.2); }; })(bv)); continue; }
      WA_rr(c, x, S.bedY1 - 1, w, 7, 1.5); WA_fillStroke(c, WA_h2(x, 185) < 0.3 ? '#bf5f42' : WA_h2(x, 185) < 0.6 ? '#d27a58' : '#c9694a', 1, '#5e3322');
      c.fillStyle = 'rgba(255,220,190,0.45)'; c.fillRect(x + 1.5, S.bedY1, w - 3, 1.2);
    }
  });
}

// ---- sidewalk --------------------------------------------------------------------------------------------
function WA_gSidewalk(c, E) {
  var y0 = WA_SWY, y1 = WA_RY, i, x, y, dcx = (WA_DOORX0 + WA_DOORX1) / 2;
  if (!E.hit(0, y0 - 4, WA_WW, y1 + 2)) return;
  WA_gSlabs(c, 0, y0, WA_WW, y1, 2, 1);
  // soft shade along the top (hedges / building)
  var g = c.createLinearGradient(0, y0, 0, y0 + 8); g.addColorStop(0, 'rgba(60,40,20,0.28)'); g.addColorStop(1, 'rgba(60,40,20,0)');
  c.fillStyle = g; c.fillRect(0, y0, WA_WW, 8);

  // brick fan in front of the shop door
  c.save(); c.beginPath(); c.rect(dcx - 80, y0, 160, y1 - y0 - 9); c.clip();
  var rings = [[0, 13], [13, 26], [26, 39]];
  WA_ell(c, dcx, y0, 41, 39); c.fillStyle = '#8f4a34'; c.fill();
  rings.forEach(function (r, ri) {
    var n = 3 + ri * 3;
    for (i = 0; i < n; i++) {
      var a0 = i / n * Math.PI + 0.03, a1 = (i + 1) / n * Math.PI - 0.03;
      c.beginPath(); c.ellipse(dcx, y0, r[1] - 1, r[1] - 1.6, 0, a0, a1); c.ellipse(dcx, y0, r[0] + 0.6, Math.max(0.1, r[0] + 0.2), 0, a1, a0, true); c.closePath();
      c.fillStyle = WA_h2(i + ri * 9, 191) < 0.35 ? '#c9694a' : WA_h2(i + ri * 9, 191) < 0.7 ? '#d58262' : '#bf5f42'; c.fill();
    }
  });
  c.strokeStyle = 'rgba(255,225,200,0.4)'; c.lineWidth = 1;
  c.beginPath(); c.ellipse(dcx, y0, 37, 35.5, 0, Math.PI * 0.55, Math.PI * 0.95); c.stroke();
  c.restore();
  WA_ell(c, dcx, y0, 41, 39); c.save(); c.beginPath(); c.rect(dcx - 50, y0, 100, 44); c.clip(); WA_ell(c, dcx, y0, 41, 39); c.strokeStyle = '#5e3322'; c.lineWidth = 1.4; c.stroke(); c.restore();

  // tactile strip at the crossing
  c.fillStyle = '#e6c45c'; c.fillRect(WA_DOORX0 - 6, y1 - 9, WA_DOORX1 - WA_DOORX0 + 12, 9);
  c.strokeStyle = '#a8863a'; c.lineWidth = 1; c.strokeRect(WA_DOORX0 - 6, y1 - 9, WA_DOORX1 - WA_DOORX0 + 12, 9.5);
  c.fillStyle = '#c9a23e';
  for (x = WA_DOORX0 - 2; x < WA_DOORX1 + 6; x += 6) { WA_ell(c, x, y1 - 6.3, 1.3, 1.1); c.fill(); WA_ell(c, x + 3, y1 - 2.8, 1.3, 1.1); c.fill(); }

  // muddy paw prints trotting towards the door
  c.fillStyle = 'rgba(110,80,50,0.33)';
  var pp = [[640, 1668, -1.35], [627, 1661, -1.3], [612, 1665, -1.2], [599, 1657, -1.2], [584, 1661, -1.1], [571, 1652, -1.0], [557, 1655, -0.9], [545, 1646, -0.8], [533, 1648, -0.7], [523, 1639, -0.6]];
  pp.forEach(function (p, k) { WA_pawPrint(c, p[0], p[1], 1.05 - k * 0.015, p[2]); });

  // chalk hopscotch
  c.save(); c.lineWidth = 1.6; c.lineCap = 'round';
  var hx = 1118, hy = 1656, sq = 15, cells = [[0, 0], [1, 0], [2, 0], [3, -0.5], [3, 0.5], [4, 0], [5, -0.5], [5, 0.5], [6, 0]];
  var chalk = ['rgba(253,250,240,0.82)', 'rgba(246,170,190,0.85)', 'rgba(150,205,235,0.85)', 'rgba(250,225,130,0.85)'];
  cells.forEach(function (q, k) {
    var px = hx + q[0] * sq, py = hy + q[1] * sq - sq / 2;
    c.strokeStyle = chalk[k % 3];
    WA_chalkLine(c, [[px, py], [px + sq, py], [px + sq, py + sq], [px, py + sq], [px, py]], k * 7);
    c.fillStyle = chalk[(k + 1) % 3]; c.font = '11px ' + WA_FONT; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(String(k + 1), px + sq / 2, py + sq / 2 + 0.5);
  });
  c.strokeStyle = chalk[3]; c.beginPath(); c.arc(hx + 7 * sq, hy, sq * 0.75, -Math.PI / 2, Math.PI / 2); c.closePath(); c.stroke();
  // chalk doodles: sun, heart, bone, flower
  var dx = 1560;
  c.strokeStyle = chalk[3]; c.beginPath(); c.arc(dx, hy, 6, 0, WA_TAU); c.stroke();
  for (i = 0; i < 8; i++) { var a = i / 8 * WA_TAU; WA_line(c, dx + Math.cos(a) * 8.5, hy + Math.sin(a) * 8.5, dx + Math.cos(a) * 12, hy + Math.sin(a) * 12); }
  c.strokeStyle = chalk[1]; c.beginPath(); c.moveTo(dx + 34, hy + 8); c.bezierCurveTo(dx + 20, hy - 2, dx + 27, hy - 12, dx + 34, hy - 4); c.bezierCurveTo(dx + 41, hy - 12, dx + 48, hy - 2, dx + 34, hy + 8); c.stroke();
  c.strokeStyle = chalk[0]; c.lineWidth = 4.5; WA_line(c, dx + 62, hy + 4, dx + 80, hy - 4);
  c.fillStyle = chalk[0]; [[60, 2], [63, 7], [79, -7], [82, -2]].forEach(function (q) { WA_ell(c, dx + q[0], hy + q[1], 3, 3); c.fill(); });
  c.lineWidth = 1.6; c.strokeStyle = chalk[2];
  for (i = 0; i < 5; i++) { var b = i / 5 * WA_TAU; c.beginPath(); c.arc(dx + 106 + Math.cos(b) * 5, hy - 2 + Math.sin(b) * 5, 3.4, 0, WA_TAU); c.stroke(); }
  c.strokeStyle = 'rgba(170,220,150,0.85)'; WA_line(c, dx + 106, hy + 6, dx + 104, hy + 16);
  c.restore();

  // grass and moss in the joints, a few fallen leaves
  for (i = 0; i < 70; i++) {
    x = WA_h2(i, 201) * WA_WW; y = y0 + (WA_h2(i, 202) < 0.5 ? 24 : WA_h2(i, 203) < 0.5 ? 1 : 47.5);
    if (Math.abs(x - dcx) < 90) continue;
    if (i % 3 === 0) { c.fillStyle = 'rgba(106,168,82,0.7)'; for (var k = 0; k < 4; k++) { WA_ell(c, x + k * 3.2 + WA_h2(i, k) * 2, y + (WA_h2(k, i) - 0.5) * 1.6, 2, 1.1); c.fill(); } }
    else { c.strokeStyle = i % 3 === 1 ? '#5da84a' : '#4f9443'; c.lineWidth = 1.3; c.beginPath(); WA_tuftAdd(c, x, y + 1, 3, 5.5, 1.3, i * 31); c.stroke(); }
  }
  for (i = 0; i < 26; i++) {
    x = WA_h2(i, 211) * WA_WW; y = y0 + 5 + WA_h2(i, 212) * 36;
    if (Math.abs(x - dcx) < 70) continue;
    c.fillStyle = ['#d9a24e', '#c9694a', '#b9c45a', '#c98f3f'][i % 4];
    c.beginPath(); c.ellipse(x, y, 3.2, 1.7, WA_h2(i, 213) * 3, 0, WA_TAU); c.fill();
    c.strokeStyle = 'rgba(90,50,20,0.6)'; c.lineWidth = 0.7; c.stroke();
  }
}

// ---- road ------------------------------------------------------------------------------------------------
function WA_gRoad(c, E) {
  var y0 = WA_RY, y1 = WA_WH, i, x, y, S = WA_ST;
  if (!E.hit(0, y0 - 2, WA_WW, y1)) return;
  c.fillStyle = '#6f6a70'; c.fillRect(0, y0, WA_WW, y1 - y0);
  c.save(); c.beginPath(); c.rect(0, y0, WA_WW, y1 - y0); c.clip();
  WA_mottle(c, 0, y0, WA_WW, y1, 120, ['#67626a', '#767177', '#6a656b'], 0.5, 50, 110, 88);
  // tyre-worn lanes
  c.fillStyle = 'rgba(50,44,52,0.12)'; c.fillRect(0, y0 + 64, WA_WW, 18); c.fillRect(0, y0 + 112, WA_WW, 18);
  // speckle
  for (i = 0; i < 2600; i++) {
    c.fillStyle = i % 2 ? 'rgba(255,248,230,0.16)' : 'rgba(30,22,26,0.2)';
    c.fillRect(WA_h2(i, 221) * WA_WW, y0 + 10 + WA_h2(i, 222) * (y1 - y0 - 10), 1 + WA_h2(i, 223) * 1.4, 1 + WA_h2(i, 224));
  }
  // repair patches and cracks
  [[900, 1790, 70, 26], [1700, 1716, 54, 30], [2560, 1786, 90, 28], [240, 1740, 60, 34]].forEach(function (p, k) {
    WA_rr(c, p[0], p[1], p[2], p[3], 4); c.fillStyle = 'rgba(84,78,86,0.55)'; c.fill(); c.strokeStyle = 'rgba(60,54,62,0.45)'; c.lineWidth = 1.2; c.stroke();
  });
  c.strokeStyle = 'rgba(48,42,50,0.7)'; c.lineWidth = 1;
  for (i = 0; i < 12; i++) {
    x = WA_h2(i, 231) * WA_WW; y = y0 + 20 + WA_h2(i, 232) * 110;
    c.beginPath(); c.moveTo(x, y);
    for (var k = 1; k < 6; k++) c.lineTo(x + k * 9 + (WA_h2(i, k) - 0.5) * 6, y + (WA_h2(k, i + 40) - 0.5) * 14);
    c.stroke();
  }
  c.restore();

  // markings
  var paint = 'rgba(244,238,222,0.9)';
  c.fillStyle = 'rgba(240,214,120,0.92)';
  for (x = 14; x < WA_WW; x += 76) { if (x + 44 > WA_DOORX0 - 30 && x < WA_DOORX1 + 30) continue; WA_rr(c, x, y0 + 93, 44, 5, 1.5); c.fill(); }
  c.fillStyle = paint;
  S.bays.forEach(function (b) {
    c.fillRect(b[0], y0 + 60, b[1] - b[0], 3);
    c.fillRect(b[0] - 1.5, y0 + 16, 3, 47); c.fillRect(b[1] - 1.5, y0 + 16, 3, 47);
  });
  // bus bay
  c.strokeStyle = 'rgba(240,214,120,0.92)'; c.lineWidth = 3; c.setLineDash([14, 9]);
  c.beginPath(); c.moveTo(S.busBay[0], y0 + 16); c.lineTo(S.busBay[0] + 14, y0 + 62); c.lineTo(S.busBay[1] - 14, y0 + 62); c.lineTo(S.busBay[1], y0 + 16); c.stroke(); c.setLineDash([]);
  c.save(); c.translate((S.busBay[0] + S.busBay[1]) / 2, y0 + 40); c.scale(1.5, 0.8);
  c.fillStyle = 'rgba(240,214,120,0.92)'; c.font = '38px ' + WA_FONT; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('BUS', 0, 1);
  c.restore();
  // zebra crossing
  var zx0 = WA_DOORX0 - 10, zx1 = WA_DOORX1 + 10;
  c.fillStyle = paint;
  for (y = y0 + 17; y + 10 < y1 + 6; y += 19) { WA_rr(c, zx0, y, zx1 - zx0, 10.5, 1.5); c.fill(); }
  c.fillRect(zx0 - 22, y0 + 96, 4, y1 - y0 - 96); c.fillRect(zx1 + 18, y0 + 14, 4, 79);     // stop lines
  // wear on the paint
  c.fillStyle = '#6f6a70';
  for (i = 0; i < 500; i++) {
    x = WA_h2(i, 241) * WA_WW; y = y0 + 14 + WA_h2(i, 242) * (y1 - y0 - 14);
    c.globalAlpha = 0.5 + WA_h2(i, 244) * 0.4; c.fillRect(x, y, 1.5 + WA_h2(i, 243) * 3.5, 1 + WA_h2(i, 245) * 1.6);
  }
  for (i = 0; i < 90; i++) {
    x = zx0 + WA_h2(i, 246) * (zx1 - zx0); y = y0 + 16 + WA_h2(i, 247) * (y1 - y0 - 16);
    c.globalAlpha = 0.6; c.fillRect(x, y, 1.5 + WA_h2(i, 248) * 4, 1 + WA_h2(i, 249) * 1.5);
  }
  c.globalAlpha = 1;

  // manhole
  var mx = 1610, my = y0 + 116;
  WA_ell(c, mx, my, 19, 11.5); WA_fillStroke(c, '#56525a', 1.6);
  WA_ell(c, mx, my, 15.5, 9); c.fillStyle = '#7a757c'; c.fill(); c.strokeStyle = '#45414a'; c.lineWidth = 1; c.stroke();
  c.save(); WA_ell(c, mx, my, 15.5, 9); c.clip(); c.strokeStyle = '#5d5860'; c.lineWidth = 1.5;
  for (i = -4; i <= 4; i++) { WA_line(c, mx + i * 5 - 8, my + 10, mx + i * 5 + 8, my - 10); WA_line(c, mx + i * 5 - 8, my - 10, mx + i * 5 + 8, my + 10); }
  c.restore();
  c.strokeStyle = 'rgba(255,255,255,0.25)'; c.lineWidth = 1; c.beginPath(); c.ellipse(mx, my, 17.5, 10.2, 0, Math.PI * 1.05, Math.PI * 1.6); c.stroke();

  // puddles
  [[2226, y0 + 30, 44, 10, 3], [1034, y0 + 122, 36, 9, 8]].forEach(function (p) {
    WA_blob(c, p[0], p[1], p[2], p[3], p[4], 0.2, 10); c.fillStyle = 'rgba(60,54,66,0.55)'; c.fill();
    WA_blob(c, p[0], p[1] - 0.8, p[2] - 2, p[3] - 1.4, p[4], 0.2, 10);
    var g = c.createLinearGradient(0, p[1] - p[3], 0, p[1] + p[3]); g.addColorStop(0, 'rgba(150,200,232,0.9)'); g.addColorStop(1, 'rgba(102,170,214,0.9)');
    c.fillStyle = g; c.fill();
    c.strokeStyle = 'rgba(255,255,255,0.7)'; c.lineWidth = 1.3;
    c.beginPath(); c.moveTo(p[0] - p[2] * 0.5, p[1] - 2); c.quadraticCurveTo(p[0] - p[2] * 0.2, p[1] - 4, p[0] + p[2] * 0.1, p[1] - 2.6); c.stroke();
    c.beginPath(); c.moveTo(p[0] + p[2] * 0.25, p[1] + 2); c.lineTo(p[0] + p[2] * 0.5, p[1] + 1.4); c.stroke();
  });

  // kerb
  var top = '#cfc8b8', face = '#989286';
  c.fillStyle = 'rgba(30,22,26,0.25)'; c.fillRect(0, y0 + 11, WA_WW, 4);
  c.fillStyle = face; c.fillRect(0, y0 + 6, WA_WW, 6);
  c.fillStyle = top; c.fillRect(0, y0, WA_WW, 6.5);
  c.fillStyle = '#e6e0d2'; c.fillRect(0, y0, WA_WW, 1.4);
  c.fillStyle = '#7b756c';
  for (x = 30; x < WA_WW; x += 60) c.fillRect(x, y0 + 0.5, 1.3, 11);
  c.fillStyle = 'rgba(59,42,32,0.75)'; c.fillRect(0, y0 + 11.4, WA_WW, 1.5);
  // dropped kerb at the crossing
  c.fillStyle = top; c.fillRect(zx0 + 6, y0, zx1 - zx0 - 12, 10);
  c.beginPath(); c.moveTo(zx0 - 4, y0 + 6.5); c.lineTo(zx0 + 6, y0 + 10); c.lineTo(zx0 + 6, y0 + 6.5); c.closePath(); c.fill();
  c.beginPath(); c.moveTo(zx1 + 4, y0 + 6.5); c.lineTo(zx1 - 6, y0 + 10); c.lineTo(zx1 - 6, y0 + 6.5); c.closePath(); c.fill();
  // drains
  [590, 1506, 2700, 96].forEach(function (dx) {
    WA_rr(c, dx, y0 + 13, 26, 8, 1.5); WA_fillStroke(c, '#4a464e', 1.3);
    c.fillStyle = '#8b868e'; for (i = 0; i < 5; i++) c.fillRect(dx + 3 + i * 4.6, y0 + 14.6, 1.6, 4.8);
  });
  // leaves gathered in the gutter
  for (i = 0; i < 60; i++) {
    x = WA_h2(i, 251) * WA_WW; y = y0 + 14 + WA_h2(i, 252) * 5;
    if (x > zx0 - 10 && x < zx1 + 10) continue;
    c.fillStyle = ['#d9a24e', '#c9694a', '#a8b24e', '#c98f3f'][i % 4];
    c.beginPath(); c.ellipse(x, y, 2.6, 1.4, WA_h2(i, 253) * 3, 0, WA_TAU); c.fill();
  }
}

// ==========================================================================================================
// env.rect (optional) = { x, y, w, h } in world px: repaint only that part (e.g. the plot whose ownership changed, plus a
// tile of margin) - everything outside it is left untouched. Without it the whole world is painted.
function drawWorldGround(c, env) {
  var E = WA_env(env), R = E.rect;
  c.save();
  c.globalAlpha = 1; c.globalCompositeOperation = 'source-over'; c.setLineDash([]); c.lineJoin = 'round'; c.lineCap = 'round';
  if (!R.full) { c.beginPath(); c.rect(R.x0, R.y0, R.x1 - R.x0, R.y1 - R.y0); c.clip(); }
  var ownedPath = WA_tilePath(E.owned), pendPath = WA_tilePath(E.pending);
  try {
    WA_gBase(c, E);
    WA_gWild(c, E);
    if (pendPath) WA_gPending(c, E, pendPath);
    if (ownedPath) WA_gLawn(c, E, ownedPath);
    WA_gBakedTrees(c, E);
    WA_gPark(c, E);
    WA_gLake(c, E);
    WA_gBorder(c, E);
    WA_gSidewalk(c, E);
    WA_gRoad(c, E);
  } finally {
    // the ground-resolution stamps are kept (a few MB), so that repainting a plot later does not have to bake them again;
    // only at very high resolutions the big tree stamps are dropped
    if (WA_stampCache && WA_stampCache.scale > 2.5) Object.keys(WA_stampCache.map).forEach(function (k) { if (k.slice(0, 5) === 'tree-') delete WA_stampCache.map[k]; });
    c.restore();
  }
}

// ==========================================================================================================
// PROPS - sprites
// ==========================================================================================================
function WA_prop(kind, x, y, w, h, sortY, draw, footX) { return { kind: kind, x: x, y: y, w: w, h: h, sortY: sortY, draw: draw, footX: footX }; }
function WA_wind(state) { var w = state ? +state.wind : 0; return w === w ? WA_clamp(w, -1.5, 1.5) : 0; }
function WA_night(state) { var n = state ? +state.night : 0; return n === n ? WA_clamp(n, 0, 1) : 0; }

// ---- foliage made of shaded leaf clumps -------------------------------------------------------------------
// clumps: [{x, y, r}], lit from the top-left. R = overall radius used for the global light falloff.
function WA_clumpLight(q, cx, cy, R) { return WA_clamp(0.5 - ((q.x - cx) * 0.55 + (q.y - cy) * 0.8) / (R * 1.5), 0, 1); }
function WA_foliageBack(g, clumps, cols, cx, cy, R, lw) {
  var i, q, L;
  clumps = clumps.slice().sort(function (a, b) { return a.y - b.y; });
  g.beginPath();
  for (i = 0; i < clumps.length; i++) { q = clumps[i]; g.moveTo(q.x + q.r, q.y); g.arc(q.x, q.y, q.r, 0, WA_TAU); }
  g.strokeStyle = WA_OUT; g.lineWidth = (lw || 1.9) * 2; g.stroke();
  g.fillStyle = cols[0]; g.fill();
  for (i = 0; i < clumps.length; i++) {
    q = clumps[i]; L = WA_clumpLight(q, cx, cy, R);
    g.fillStyle = cols[0]; WA_ell(g, q.x, q.y, q.r, q.r); g.fill();
    var mr = q.r * (0.68 + 0.2 * L);
    g.fillStyle = cols[1]; WA_ell(g, q.x - (q.r - mr) * 0.62, q.y - (q.r - mr) * 0.74, mr, mr); g.fill();
  }
}
function WA_foliageFront(g, clumps, cols, cx, cy, R, seed) {
  var i, q, L, k;
  clumps = clumps.slice().sort(function (a, b) { return a.y - b.y; });
  for (i = 0; i < clumps.length; i++) {
    q = clumps[i]; L = WA_clumpLight(q, cx, cy, R);
    if (L < 0.2 || q.r < 7) continue;
    var lr = q.r * (0.22 + 0.42 * L), ox = q.x - (q.r - lr) * 0.5, oy = q.y - (q.r - lr) * 0.6;
    g.fillStyle = cols[2]; WA_blob(g, ox, oy, lr, lr * 0.9, seed + i, 0.16, 8); g.fill();
    if (L > 0.55 && q.r > 12) { g.fillStyle = cols[3]; WA_blob(g, ox - lr * 0.25, oy - lr * 0.3, lr * 0.42, lr * 0.32, seed + i * 3, 0.2, 7); g.fill(); }
  }
  // leafy scallops
  g.lineWidth = 1.2; g.lineCap = 'round';
  for (i = 0; i < clumps.length; i++) {
    q = clumps[i]; if (q.r < 11) continue;
    L = WA_clumpLight(q, cx, cy, R);
    for (k = 0; k < 3; k++) {
      var a = WA_h2(seed + i * 7, k) * WA_TAU, d = q.r * (0.25 + 0.5 * WA_h2(seed + k, i * 5)), sx = q.x + Math.cos(a) * d, sy = q.y + Math.sin(a) * d * 0.9;
      g.strokeStyle = (sx - q.x) + (sy - q.y) > q.r * 0.35 ? cols[4] : L > 0.5 ? cols[1] : cols[0];
      g.beginPath(); g.arc(sx, sy - 2.5, 4.2, 0.25 * Math.PI, 0.8 * Math.PI); g.stroke();
    }
  }
}
// build a cloud of clumps: big ones + small bumps along the outside so the silhouette is scalloped
function WA_cloud(rnd, mains, cx, cy, bumpR) {
  var out = [], i, j;
  for (i = 0; i < mains.length; i++) {
    var m = mains[i], q = { x: m[0] + (rnd() - 0.5) * 4, y: m[1] + (rnd() - 0.5) * 4, r: m[2] * (0.94 + rnd() * 0.12) };
    out.push(q);
    var base = Math.atan2(q.y - cy, q.x - cx), n = 4;
    for (j = 0; j < n; j++) {
      var a = base + (j / (n - 1) - 0.5) * 2.0 + (rnd() - 0.5) * 0.3, br = bumpR * (0.8 + rnd() * 0.5);
      out.push({ x: q.x + Math.cos(a) * (q.r - br * 0.35), y: q.y + Math.sin(a) * (q.r - br * 0.35), r: br });
    }
  }
  return out;
}
function WA_trunk(g, w, th, col, shade, hi, lean) {
  lean = lean || 0;
  function path() {
    g.beginPath();
    g.moveTo(-w * 1.05, 1); g.quadraticCurveTo(-w * 0.5, -4, -w * 0.46 + lean * 0.4, -th * 0.5);
    g.lineTo(-w * 0.42 + lean, -th); g.lineTo(w * 0.42 + lean, -th); g.lineTo(w * 0.46 + lean * 0.4, -th * 0.5);
    g.quadraticCurveTo(w * 0.5, -4, w * 1.05, 1); g.quadraticCurveTo(w * 0.5, 3.5, 0, 2); g.quadraticCurveTo(-w * 0.5, 3.5, -w * 1.05, 1); g.closePath();
  }
  path(); g.fillStyle = col; g.fill();
  g.save(); g.clip();
  g.fillStyle = shade; g.fillRect(w * 0.08 + lean * 0.5, -th - 2, w * 1.2, th + 8);
  g.fillStyle = hi; g.fillRect(-w * 0.36 + lean * 0.5, -th - 2, w * 0.16, th * 0.9);
  g.fillStyle = 'rgba(30,18,8,0.35)'; g.fillRect(-w * 1.2, -th - 2, w * 2.4 + Math.abs(lean), 9);         // shade under the canopy
  g.restore();
  path(); g.strokeStyle = WA_OUT; g.lineWidth = 1.9; g.stroke();
}
var WA_TREE_COLS = {
  oak:     ['#3f7d3a', '#4f9a45', '#6cb85a', '#8fd072', '#2f6633'],
  birch:   ['#5a9e45', '#79bb54', '#9ad468', '#bfe88a', '#47853c'],
  blossom: ['#d9789a', '#f2a0b5', '#fbcbd8', '#fff0f3', '#c05e83'],
  apple:   ['#4a8f40', '#62ab4e', '#86c866', '#a6dc82', '#37763a'],
  round:   ['#3d8248', '#4fa058', '#72bf6c', '#9ad88a', '#2f6a3c'],
  pine:    ['#2c6847', '#3b8457', '#58a36d', '#7cc08a', '#214f38']
};
var WA_TREE_ART = {};
// returns { trunk, back, front (sprites anchored at the base), pivot, w, h, top }
function WA_treeArt(species, variant) {
  var key = species + variant;
  if (WA_TREE_ART[key]) return WA_TREE_ART[key];
  var rnd = WA_rng(variant * 7919 + species.length * 131 + species.charCodeAt(0)), cols = WA_TREE_COLS[species] || WA_TREE_COLS.oak;
  var A = { species: species }, s, clumps, cx = 0, cy, R, drawTrunk, extras = null, w, h;
  if (species === 'pine') {
    s = [1.0, 1.2, 0.82][variant % 3];
    var th = 20 * s, tiers = variant % 3 === 1 ? 5 : 4, tw = 84 * s, tierH = 40 * s, stepY = 27 * s;
    w = tw + 24; h = th + stepY * (tiers - 1) + tierH + 26;
    A.pivot = th * 0.6; A.w = w; A.h = h; A.top = th + stepY * (tiers - 1) + tierH * 0.6;
    var tsw = Math.ceil(tw * 0.42) * 2 + 6;
    A.trunk = WA_sprite('tree-trunk-' + key, tsw, 30 * s + 20, tsw / 2, 30 * s + 6, function (g) {
      WA_shadow(g, 0, 1, tw * 0.42, 8 * s);
      WA_trunk(g, 9 * s, th + 8 * s, '#6a4430', '#523322', '#8a5c40', 0);
    });
    A.canopy = WA_sprite('tree-canopy-' + key, w, h - th - 2, w / 2, h - 12, function (g) {
      var rnd = WA_rng(variant * 613 + 29);
      for (var i = 0; i < tiers; i++) {
        var f = i / (tiers - 1), yb = -th - i * stepY, wd = tw * (1 - f * 0.62) / 2, ht = tierH * (1 - f * 0.12), n = 5, j;
        var pts = [];
        for (j = 0; j <= n; j++) pts.push([-wd + (2 * wd) * j / n + (rnd() - 0.5) * 3, yb + (j % 2 ? -5 * s : 3 * s) - Math.abs(j - n / 2) * 1.6 * s + (rnd() - 0.5) * 3]);
        var path = function () {
          g.beginPath(); g.moveTo(0, yb - ht);
          g.quadraticCurveTo(-wd * 0.35, yb - ht * 0.55, pts[0][0], pts[0][1]);
          for (var k = 1; k <= n; k++) g.quadraticCurveTo((pts[k - 1][0] + pts[k][0]) / 2, Math.max(pts[k - 1][1], pts[k][1]) + 4 * s, pts[k][0], pts[k][1]);
          g.quadraticCurveTo(wd * 0.35, yb - ht * 0.55, 0, yb - ht); g.closePath();
        };
        path(); g.fillStyle = cols[1]; g.fill();
        g.save(); g.clip();
        g.fillStyle = cols[0]; g.beginPath(); g.moveTo(wd * 0.1, yb - ht); g.lineTo(wd * 1.3, yb - ht); g.lineTo(wd * 1.3, yb + 12); g.lineTo(-wd * 0.25, yb + 12); g.closePath(); g.fill();
        g.fillStyle = cols[0]; g.fillRect(-wd - 4, yb - 7 * s, wd * 2 + 8, 20);
        if (i < tiers - 1) { g.fillStyle = 'rgba(20,50,40,0.0)'; }
        g.strokeStyle = cols[2]; g.lineWidth = 2.4 * s; g.lineCap = 'round';
        g.beginPath(); g.moveTo(-wd * 0.12, yb - ht * 0.78); g.quadraticCurveTo(-wd * 0.4, yb - ht * 0.45, -wd * 0.72, yb - ht * 0.16); g.stroke();
        g.beginPath(); g.moveTo(-wd * 0.02, yb - ht * 0.5); g.quadraticCurveTo(-wd * 0.2, yb - ht * 0.3, -wd * 0.4, yb - ht * 0.12); g.stroke();
        g.strokeStyle = cols[4]; g.lineWidth = 1.2;
        for (j = 0; j < 4; j++) { var lx = -wd * 0.5 + j * wd * 0.42 + (rnd() - 0.5) * 4, ly = yb - ht * (0.22 + rnd() * 0.2); g.beginPath(); g.moveTo(lx, ly); g.lineTo(lx + (lx < 0 ? -3 : 3) * s, ly + 6 * s); g.stroke(); }
        g.restore();
        path(); g.strokeStyle = WA_OUT; g.lineWidth = 1.9; g.stroke();
      }
    });
    return (WA_TREE_ART[key] = A);
  }
  var tw2, th2, lean = 0;
  if (species === 'oak') {
    s = [1.0, 1.18, 0.86][variant % 3]; tw2 = 15 * s; th2 = 50 * s; cy = -th2 - 44 * s; R = 62 * s;
    clumps = WA_cloud(rnd, [[-36 * s, cy + 14 * s, 25 * s], [36 * s, cy + 16 * s, 25 * s], [0, cy + 22 * s, 27 * s], [-22 * s, cy - 14 * s, 28 * s], [24 * s, cy - 12 * s, 27 * s], [0, cy - 34 * s, 24 * s], [-50 * s, cy - 2 * s, 17 * s], [50 * s, cy, 17 * s]], 0, cy, 9 * s);
  } else if (species === 'apple') {
    s = [0.8, 0.9, 0.72][variant % 3]; tw2 = 13 * s; th2 = 40 * s; cy = -th2 - 36 * s; R = 52 * s;
    clumps = WA_cloud(rnd, [[-28 * s, cy + 10 * s, 24 * s], [28 * s, cy + 12 * s, 24 * s], [0, cy + 16 * s, 25 * s], [-14 * s, cy - 16 * s, 26 * s], [18 * s, cy - 14 * s, 25 * s], [0, cy - 28 * s, 20 * s]], 0, cy, 9 * s);
    extras = function (g) {
      var rnd = WA_rng(variant * 811 + 5);
      for (var i = 0; i < 11; i++) {
        var a = rnd() * WA_TAU, d = Math.sqrt(rnd()) * 0.85, ax = Math.cos(a) * 46 * s * d, ay = cy + 4 * s + Math.sin(a) * 34 * s * d;
        WA_ell(g, ax, ay, 3.6, 3.5); WA_fillStroke(g, i % 4 === 0 ? '#e8743b' : '#d9574a', 1.1);
        g.fillStyle = 'rgba(255,255,255,0.6)'; WA_ell(g, ax - 1.1, ay - 1.2, 1, 0.9); g.fill();
      }
    };
  } else if (species === 'birch') {
    s = [1.0, 1.15, 0.85][variant % 3]; tw2 = 7.5 * s; th2 = 74 * s; cy = -th2 - 34 * s; R = 56 * s; lean = (variant % 2 ? 5 : -4) * s;
    clumps = WA_cloud(rnd, [[-20 * s + lean, cy + 26 * s, 17 * s], [20 * s + lean, cy + 22 * s, 18 * s], [lean, cy + 6 * s, 21 * s], [-24 * s + lean, cy - 8 * s, 17 * s], [24 * s + lean, cy - 12 * s, 17 * s], [lean - 4 * s, cy - 30 * s, 19 * s], [lean + 8 * s, cy - 48 * s, 14 * s], [-30 * s + lean, cy + 42 * s, 11 * s], [32 * s + lean, cy + 40 * s, 11 * s]], lean, cy, 7 * s);
  } else if (species === 'blossom') {
    s = [0.92, 1.05, 0.8][variant % 3]; tw2 = 12 * s; th2 = 40 * s; cy = -th2 - 38 * s; R = 56 * s; lean = (variant % 2 ? -3 : 3) * s;
    clumps = WA_cloud(rnd, [[-34 * s, cy + 12 * s, 22 * s], [34 * s, cy + 8 * s, 23 * s], [0, cy + 18 * s, 23 * s], [-18 * s, cy - 12 * s, 25 * s], [22 * s, cy - 16 * s, 23 * s], [2 * s, cy - 32 * s, 20 * s], [-48 * s, cy - 4 * s, 14 * s], [50 * s, cy - 8 * s, 13 * s]], 0, cy, 8 * s);
    extras = function (g) {
      var rnd = WA_rng(variant * 911 + 7);
      for (var i = 0; i < 26; i++) {
        var a = rnd() * WA_TAU, d = Math.sqrt(rnd()) * 0.9, ax = Math.cos(a) * 52 * s * d, ay = cy + Math.sin(a) * 40 * s * d;
        g.fillStyle = i % 5 === 0 ? '#8fca6a' : i % 2 ? '#fff6f8' : '#f7b7c8';
        if (i % 5 === 0) { g.beginPath(); g.ellipse(ax, ay, 3, 1.6, rnd() * 3, 0, WA_TAU); g.fill(); }
        else { for (var k = 0; k < 5; k++) { WA_ell(g, ax + Math.cos(k * 1.257) * 1.7, ay + Math.sin(k * 1.257) * 1.7, 1.25, 1.25); g.fill(); } g.fillStyle = '#f2c14e'; WA_ell(g, ax, ay, 0.8, 0.8); g.fill(); }
      }
    };
  } else {   // 'round': small standard (lollipop) tree for the street border
    // (kept low on purpose: it stands just south of the yard and must not hide the dogs behind it)
    s = [1.0, 1.06, 0.92][variant % 3]; tw2 = 7 * s; th2 = 31 * s; cy = -th2 - 16 * s; R = 26 * s;
    clumps = WA_cloud(rnd, [[-10 * s, cy + 4 * s, 14.5 * s], [10 * s, cy + 4 * s, 14.5 * s], [0, cy - 7 * s, 15 * s], [0, cy + 8 * s, 14 * s]], 0, cy, 6 * s);
  }
  var minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9, i;
  for (i = 0; i < clumps.length; i++) { minX = Math.min(minX, clumps[i].x - clumps[i].r); maxX = Math.max(maxX, clumps[i].x + clumps[i].r); minY = Math.min(minY, clumps[i].y - clumps[i].r); maxY = Math.max(maxY, clumps[i].y + clumps[i].r); }
  var half = Math.ceil(Math.max(-minX, maxX)) + 8;
  w = half * 2; h = Math.ceil(-minY) + 20;
  A.pivot = th2 * 0.75; A.w = w; A.h = h; A.top = -cy + R * 0.3;
  var tsw2 = Math.ceil(Math.max(half * 0.7, tw2 * 1.8 + 4)) * 2 + 6, ch2 = Math.ceil(maxY - minY) + 10;
  A.trunk = WA_sprite('tree-trunk-' + key, tsw2, th2 + 34 * s + 14, tsw2 / 2, th2 + 24 * s + 2, function (g) {
    var rnd = WA_rng(variant * 311 + species.length * 17 + 3);
    WA_shadow(g, 0, 1.5, half * 0.7, 9 * s + 2);
    if (species === 'birch') {
      WA_trunk(g, tw2, th2 + 14 * s, '#f1ebdd', '#d2c9b4', '#ffffff', lean);
      g.strokeStyle = '#4a4038'; g.lineCap = 'round';
      for (var i = 0; i < 9; i++) {
        var f = (i + 0.5) / 9, by = -f * th2, bx = lean * f * 0.9 + (i % 2 ? -1 : 1) * tw2 * 0.2, bl = tw2 * (0.22 + rnd() * 0.3);
        g.lineWidth = 1.3 + rnd() * 1.2; g.beginPath(); g.moveTo(bx - bl, by); g.lineTo(bx + bl, by + (rnd() - 0.5) * 2); g.stroke();
      }
    } else {
      var dark = species === 'blossom';
      WA_trunk(g, tw2, th2 + 14 * s, dark ? '#6a4430' : '#7a4e2a', dark ? '#523322' : '#5f3a1f', dark ? '#8a5c40' : '#96653a', lean);
      // forks reaching into the canopy
      g.lineCap = 'round'; g.strokeStyle = WA_OUT; g.lineWidth = tw2 * 0.5 + 3.4;
      g.beginPath(); g.moveTo(lean * 0.8 - tw2 * 0.1, -th2 * 0.86); g.quadraticCurveTo(-tw2 * 0.8, -th2 - 8 * s, -tw2 * 1.6, -th2 - 20 * s); g.moveTo(lean * 0.8 + tw2 * 0.1, -th2 * 0.9); g.quadraticCurveTo(tw2 * 0.7, -th2 - 8 * s, tw2 * 1.5, -th2 - 18 * s); g.stroke();
      g.strokeStyle = dark ? '#6a4430' : '#7a4e2a'; g.lineWidth = tw2 * 0.5;
      g.beginPath(); g.moveTo(lean * 0.8 - tw2 * 0.1, -th2 * 0.86); g.quadraticCurveTo(-tw2 * 0.8, -th2 - 8 * s, -tw2 * 1.6, -th2 - 20 * s); g.moveTo(lean * 0.8 + tw2 * 0.1, -th2 * 0.9); g.quadraticCurveTo(tw2 * 0.7, -th2 - 8 * s, tw2 * 1.5, -th2 - 18 * s); g.stroke();
      // bark
      g.strokeStyle = dark ? '#3f271a' : '#4f3019'; g.lineWidth = 1.1;
      for (var j = 0; j < 5; j++) { var bx2 = (rnd() - 0.5) * tw2 * 0.6, by2 = -th2 * (0.12 + rnd() * 0.6); g.beginPath(); g.moveTo(bx2, by2); g.quadraticCurveTo(bx2 + 1.5, by2 - 4, bx2 - 0.5, by2 - 8 - rnd() * 4); g.stroke(); }
      if (variant % 3 === 1 && species === 'oak') {   // knot hole
        WA_ell(g, 0.5, -th2 * 0.42, 3.3, 4.2); WA_fillStroke(g, '#3b2416', 1.2);
      }
    }
  });
  A.canopy = WA_sprite('tree-canopy-' + key, w, ch2, w / 2, Math.ceil(-minY) + 5, function (g) {
    WA_foliageBack(g, clumps, cols, cx, cy, R); WA_foliageFront(g, clumps, cols, cx, cy, R, variant * 31 + 7); if (extras) extras(g);
  });
  return (WA_TREE_ART[key] = A);
}
// Sway is a plain sideways drift of the canopy over its trunk (axis-aligned blits stay fast without a GPU).
function WA_mkTree(x, y, species, variant, phase) {
  var A = WA_treeArt(species, variant), ph = phase == null ? WA_h2(x, y) * 6.28 : phase, amp = species === 'pine' ? 0.55 : 1;
  var p = WA_prop('tree', x - A.w / 2 - 6, y - A.h, A.w + 12, A.h + 12, y, function (c, t, state) {
    var wd = WA_wind(state), sw = (wd * 2.2 + Math.sin(t * 1.15 + ph) * (0.8 + Math.abs(wd) * 1.1)) * amp;
    WA_put(c, A.trunk, x, y);
    WA_put(c, A.canopy, x + sw, y);
  }, x);
  p.species = species; p.topX = x; p.topY = y - A.top;
  return p;
}
function WA_drawTreeStatic(c, x, y, species, variant) { var A = WA_treeArt(species, variant); WA_stamp(c, A.trunk, x, y); WA_stamp(c, A.canopy, x, y); }

// ---- bushes, hedges, rocks, reeds, stumps ---------------------------------------------------------------
var WA_BUSH_COLS = [['#3f7d3a', '#4f9a45', '#6cb85a', '#8fd072', '#2f6633'], ['#37763a', '#4a8f40', '#64ab50', '#86c866', '#2b5f33'], ['#4a8f40', '#62ab4e', '#86c866', '#a6dc82', '#37763a'], ['#3d8248', '#4fa058', '#72bf6c', '#9ad88a', '#2f6a3c']];
// kind: 0 plain, 1 berries, 2 white blossom, 3 hydrangea (blue/pink), 4 small tuft bush
function WA_bushArt(kind, variant) {
  var key = 'bush' + kind + '-' + variant, s = [1, 1.2, 0.85][variant % 3] * (kind === 4 ? 0.7 : 1);
  var cols = WA_BUSH_COLS[kind % 4];
  var clumps = WA_cloud(WA_rng(kind * 977 + variant * 131 + 5), [[-13 * s, -11 * s, 12 * s], [13 * s, -11 * s, 12 * s], [0, -19 * s, 13 * s], [0, -9 * s, 12 * s], [-22 * s, -6 * s, 8 * s], [22 * s, -6 * s, 8 * s]], 0, -10 * s, 5.5 * s);
  clumps.forEach(function (q) { if (q.y + q.r > -1) q.y = -1 - q.r; });
  var w = Math.ceil(86 * s), h = Math.ceil(46 * s) + 8;
  return WA_sprite(key, w, h, w / 2, h - 7, function (g) {
    var rnd = WA_rng(kind * 577 + variant * 31 + 9);
    WA_shadow(g, 0, 0, 29 * s, 6 * s);
    WA_foliageBack(g, clumps, cols, 0, -12 * s, 28 * s, 1.8); WA_foliageFront(g, clumps, cols, 0, -12 * s, 28 * s, kind * 13 + variant);
    var i, a, d, x, y;
    if (kind === 1) for (i = 0; i < 9; i++) {
      a = rnd() * WA_TAU; d = Math.sqrt(rnd()); x = Math.cos(a) * 22 * s * d; y = -13 * s + Math.sin(a) * 12 * s * d;
      WA_ell(g, x, y, 2.3, 2.3); WA_fillStroke(g, '#d9574a', 0.9); g.fillStyle = '#ffd9d0'; WA_ell(g, x - 0.7, y - 0.7, 0.7, 0.7); g.fill();
    }
    if (kind === 2) for (i = 0; i < 10; i++) {
      a = rnd() * WA_TAU; d = Math.sqrt(rnd()); x = Math.cos(a) * 23 * s * d; y = -14 * s + Math.sin(a) * 12 * s * d;
      g.fillStyle = '#fdfaf0'; for (var k = 0; k < 5; k++) { WA_ell(g, x + Math.cos(k * 1.257) * 1.9, y + Math.sin(k * 1.257) * 1.9, 1.4, 1.4); g.fill(); }
      g.fillStyle = '#f2c14e'; WA_ell(g, x, y, 1, 1); g.fill();
    }
    if (kind === 3) for (i = 0; i < 6; i++) {
      a = rnd() * WA_TAU; d = Math.sqrt(rnd()) * 0.85; x = Math.cos(a) * 22 * s * d; y = -15 * s + Math.sin(a) * 11 * s * d;
      var hc = variant % 2 ? ['#e07f9c', '#f2a0b5', '#fbd0dc'] : ['#6f86d6', '#8fa6ea', '#c3d0f7'];
      g.beginPath(); WA_blobAdd(g, x, y, 5.4, 4.8, i + variant, 0.16, 8); WA_fillStroke(g, hc[0], 1, '#3b2a20');
      g.fillStyle = hc[1]; WA_ell(g, x - 0.8, y - 0.8, 3.6, 3.1); g.fill();
      g.fillStyle = hc[2]; WA_ell(g, x - 1.6, y - 1.6, 1.6, 1.3); g.fill();
    }
  });
}
function WA_mkBush(x, y, kind, variant) {
  var A = WA_bushArt(kind, variant), ph = WA_h2(x, y) * 6.28;
  return WA_prop('bush', x - A.w / 2, y - A.h + 7, A.w, A.h, y, function (c, t, state) {
    var wd = WA_wind(state);
    WA_put(c, A, x + wd * 0.6 + Math.sin(t * 1.4 + ph) * 0.45 * (0.4 + Math.abs(wd)), y);
  }, x);
}

// clipped hedge, len px long (multiple of 24 works best). topiary = taller ball on the run.
function WA_hedgeArt(len, variant) {
  var key = 'hedge' + len + '-' + variant, H = 31, w = len + 16, h = H + 22;
  return WA_sprite(key, w, h, w / 2, h - 8, function (g) {
    var rnd = WA_rng(len * 13 + variant * 71 + 3), x0 = -len / 2, i, x, bumps = [];
    g.fillStyle = WA_SHADOW; WA_rr(g, x0 - 2, -5, len + 6, 10, 5); g.fill();
    for (x = x0 + 6; x <= x0 + len - 6; x += 9 + rnd() * 3) bumps.push([x, -H + 3 + rnd() * 2, 6 + rnd() * 2.4]);
    for (i = 0; i < 3; i++) { bumps.push([x0 + 3, -8 - i * 8, 5 + rnd() * 2]); bumps.push([x0 + len - 3, -8 - i * 8, 5 + rnd() * 2]); }
    function path() {
      g.beginPath(); WA_rr(g, x0, -H + 2, len, H - 2, 8);
      for (var j = 0; j < bumps.length; j++) { g.moveTo(bumps[j][0] + bumps[j][2], bumps[j][1]); g.arc(bumps[j][0], bumps[j][1], bumps[j][2], 0, WA_TAU); }
    }
    path(); g.strokeStyle = WA_OUT; g.lineWidth = 3.7; g.stroke();
    g.fillStyle = '#3f7d3a'; g.fill();
    g.save(); g.clip();
    g.fillStyle = '#4f9a45'; g.fillRect(x0 - 10, -H - 8, len + 20, 19);                 // top face
    for (i = 0; i < bumps.length; i++) { if (bumps[i][1] < -H + 8) { g.fillStyle = '#4f9a45'; WA_ell(g, bumps[i][0], bumps[i][1] + 5, bumps[i][2] + 1, 6); g.fill(); } }
    g.fillStyle = '#6cb85a';
    for (x = x0 + 4; x < x0 + len - 4; x += 8 + rnd() * 7) { WA_blob(g, x, -H + 3 + rnd() * 4, 4 + rnd() * 3, 2.4 + rnd(), Math.floor(x + 500), 0.2, 7); g.fill(); }
    g.fillStyle = '#8fd072';
    for (x = x0 + 8; x < x0 + len - 8; x += 19 + rnd() * 13) { WA_ell(g, x, -H + 2.5 + rnd() * 2, 2.6, 1.3); g.fill(); }
    g.fillStyle = 'rgba(28,60,36,0.45)'; g.fillRect(x0 - 10, -6, len + 20, 8);          // dark foot
    g.fillStyle = '#357035'; g.fillRect(x0 + len - 7, -H, 9, H);                        // shaded east end
    g.lineWidth = 1.2; g.lineCap = 'round';
    for (x = x0 + 5; x < x0 + len - 4; x += 5 + rnd() * 5) {
      var y = -H + 15 + rnd() * (H - 21);
      g.strokeStyle = rnd() < 0.55 ? '#2f6633' : '#4f9a45';
      g.beginPath(); g.arc(x, y - 2.5, 3.8, 0.2 * Math.PI, 0.8 * Math.PI); g.stroke();
    }
    g.restore();
    if (variant % 3 === 1) for (x = x0 + 10; x < x0 + len - 8; x += 17 + rnd() * 16) {   // a few blossoms
      var fy = -H + 12 + rnd() * 13;
      g.fillStyle = '#fdfaf0'; for (var k = 0; k < 5; k++) { WA_ell(g, x + Math.cos(k * 1.257) * 1.7, fy + Math.sin(k * 1.257) * 1.7, 1.25, 1.25); g.fill(); }
      g.fillStyle = '#f2a0b5'; WA_ell(g, x, fy, 0.9, 0.9); g.fill();
    }
  });
}
function WA_mkHedge(x0, y, len, variant) {
  var A = WA_hedgeArt(len, variant), cx = x0 + len / 2;
  return WA_prop('hedge', x0 - 8, y - A.h + 8, A.w, A.h, y, function (c) { WA_put(c, A, cx, y); }, cx);
}

function WA_rockArt(variant) {
  var s = [1, 1.35, 0.7][variant % 3], w = Math.ceil(52 * s), h = Math.ceil(34 * s) + 6;
  return WA_sprite('rock' + variant, w, h, w / 2, h - 6, function (g) {
    var rx = 19 * s, ry = 13 * s, seed = variant * 17 + 3;
    WA_shadow(g, 1, 0, rx * 1.05, 5 * s);
    function path() {
      g.beginPath();
      var n = 9, i;
      for (i = 0; i < n; i++) {
        var a = Math.PI + i / (n - 1) * Math.PI, k = 1 + (WA_h2(seed, i) - 0.5) * 0.3, px = Math.cos(a) * rx * k, py = -1 + Math.sin(a) * ry * 2 * k * 0.82;
        if (i) g.lineTo(px, py); else g.moveTo(px, py);
      }
      g.quadraticCurveTo(rx * 0.6, 3, 0, 2); g.quadraticCurveTo(-rx * 0.6, 3, -rx * (1 + (WA_h2(seed, 0) - 0.5) * 0.3), -1); g.closePath();
    }
    path(); g.fillStyle = '#bdb7aa'; g.fill();
    g.save(); g.clip();
    g.fillStyle = '#918b80'; g.beginPath(); g.moveTo(rx * 0.15, -ry * 2.2); g.lineTo(rx * 0.45, -ry * 0.9); g.lineTo(-rx * 0.2, 4); g.lineTo(rx * 1.5, 4); g.lineTo(rx * 1.5, -ry * 2.2); g.closePath(); g.fill();
    g.fillStyle = '#dcd7cb'; g.beginPath(); g.moveTo(-rx * 0.75, -ry * 0.9); g.lineTo(-rx * 0.35, -ry * 1.7); g.lineTo(rx * 0.05, -ry * 1.75); g.lineTo(-rx * 0.3, -ry * 1.05); g.closePath(); g.fill();
    if (variant % 2 === 0) { g.fillStyle = '#6aa852'; WA_blob(g, -rx * 0.1, -ry * 1.7, rx * 0.55, ry * 0.42, seed, 0.25, 8); g.fill(); g.fillStyle = '#8fd072'; WA_ell(g, -rx * 0.25, -ry * 1.8, rx * 0.2, ry * 0.14); g.fill(); }
    g.strokeStyle = '#7b756c'; g.lineWidth = 1.1; g.beginPath(); g.moveTo(rx * 0.45, -ry * 0.9); g.lineTo(rx * 0.2, -ry * 0.35); g.lineTo(rx * 0.4, 0); g.stroke();
    g.restore();
    path(); g.strokeStyle = WA_OUT; g.lineWidth = 1.8; g.stroke();
    g.strokeStyle = '#4f9443'; g.lineWidth = 1.3; g.beginPath(); WA_tuftAdd(g, -rx * 0.9, 2, 3, 6, 1.2, seed); WA_tuftAdd(g, rx * 0.8, 2.5, 3, 5, 1.2, seed + 4); g.stroke();
  });
}
function WA_mkRock(x, y, variant) { var A = WA_rockArt(variant); return WA_prop('rock', x - A.w / 2, y - A.h + 6, A.w, A.h, y, function (c) { WA_put(c, A, x, y); }, x); }

var WA_REED_FRAMES = 5, WA_REED_RANGE = 0.17;
function WA_reedArt(variant, frame) {
  var w = 66, h = 64, shear = (frame / (WA_REED_FRAMES - 1) - 0.5) * 2 * WA_REED_RANGE;
  return WA_sprite('reed' + variant + '-' + frame, w, h, w / 2, h - 5, function (g) {
    var rnd = WA_rng(variant * 53 + 9), i;
    g.transform(1, 0, -shear, 1, 0, 0);
    for (i = 0; i < 8; i++) {
      var bx = (i - 3.5) * 3 + (rnd() - 0.5) * 2, lean = (i - 3.5) * 2.6 + (rnd() - 0.5) * 5, l = 26 + rnd() * 18;
      g.beginPath(); g.moveTo(bx - 1.7, 0); g.quadraticCurveTo(bx + lean * 0.3, -l * 0.6, bx + lean, -l); g.quadraticCurveTo(bx + lean * 0.4 + 1.5, -l * 0.5, bx + 1.7, 0); g.closePath();
      g.fillStyle = ['#5a9f49', '#4c8f42', '#6fae52'][i % 3]; g.fill(); g.strokeStyle = '#2f6a3a'; g.lineWidth = 0.9; g.stroke();
    }
    var heads = variant % 3 === 2 ? 1 : variant % 3 + 2;
    for (i = 0; i < heads; i++) {
      var sx = (i - (heads - 1) / 2) * 7 + (rnd() - 0.5) * 3, top = -40 - rnd() * 10, ln = (rnd() - 0.5) * 5;
      g.strokeStyle = '#5a8a3e'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(sx, 0); g.quadraticCurveTo(sx, top * 0.5, sx + ln, top - 4); g.stroke();
      WA_rr(g, sx + ln - 2.4, top, 4.8, 12, 2.4); WA_fillStroke(g, '#7a4e2a', 1.1);
      g.fillStyle = '#a8743f'; g.fillRect(sx + ln - 1.3, top + 1.6, 1.2, 8);
    }
  });
}
function WA_mkReed(x, y, variant) {
  var F = [], i, ph = WA_h2(x, y) * 6.28;
  for (i = 0; i < WA_REED_FRAMES; i++) F.push(WA_reedArt(variant, i));
  return WA_prop('reed', x - 33, y - 59, 66, 64, y, function (c, t, state) {
    var wd = WA_wind(state), sw = wd * 0.1 + Math.sin(t * 1.6 + ph) * 0.05 * (0.7 + Math.abs(wd));
    WA_put(c, F[WA_clamp(Math.round((sw / WA_REED_RANGE * 0.5 + 0.5) * (WA_REED_FRAMES - 1)), 0, WA_REED_FRAMES - 1) | 0], x, y);
  }, x);
}

function WA_stumpArt(variant) {
  return WA_sprite('stump' + variant, 48, 40, 24, 32, function (g) {
    WA_shadow(g, 1, 0, 18, 5.5);
    g.beginPath(); g.moveTo(-15, 0); g.quadraticCurveTo(-11, -3, -11, -15); g.lineTo(11, -15); g.quadraticCurveTo(11, -3, 16, 0); g.quadraticCurveTo(8, 3, 0, 2); g.quadraticCurveTo(-8, 3, -15, 0); g.closePath();
    g.fillStyle = '#7a4e2a'; g.fill(); g.save(); g.clip(); g.fillStyle = '#5f3a1f'; g.fillRect(2, -20, 20, 26); g.restore(); g.strokeStyle = WA_OUT; g.lineWidth = 1.8; g.stroke();
    g.strokeStyle = '#4f3019'; g.lineWidth = 1; WA_line(g, -6, -12, -7, -3); WA_line(g, 4, -11, 5, -4);
    WA_ell(g, 0, -15, 11.5, 5.2); WA_fillStroke(g, '#dcb37a', 1.6);
    g.strokeStyle = '#b98248'; g.lineWidth = 1; WA_ell(g, 0.5, -15, 7.5, 3.3); g.stroke(); WA_ell(g, 1, -15, 3.6, 1.6); g.stroke();
    if (variant % 2) { WA_mushroom(g, 13, 0, 2.6, true); WA_mushroom(g, -14, 1, 2, true); }
    else { g.fillStyle = '#6aa852'; WA_blob(g, -5, -17, 5, 2.2, 3, 0.25, 7); g.fill(); g.strokeStyle = '#4f9443'; g.lineWidth = 1.3; g.beginPath(); WA_tuftAdd(g, 14, 2, 3, 6, 1.2, 5); g.stroke(); }
  });
}
function WA_logArt(variant) {
  return WA_sprite('log' + variant, 86, 40, 43, 30, function (g) {
    WA_shadow(g, 2, 1, 36, 6);
    WA_rr(g, -30, -17, 64, 17, 8); g.fillStyle = '#7a4e2a'; g.fill();
    g.save(); g.clip(); g.fillStyle = '#5f3a1f'; g.fillRect(-32, -8, 70, 10); g.fillStyle = '#96653a'; g.fillRect(-30, -16, 64, 2.4);
    g.fillStyle = '#6aa852'; WA_blob(g, 6, -17, 14, 4, 11, 0.25, 9); g.fill(); g.fillStyle = '#8fd072'; WA_ell(g, 2, -18, 5, 1.5); g.fill(); g.restore();
    WA_rr(g, -30, -17, 64, 17, 8); g.strokeStyle = WA_OUT; g.lineWidth = 1.8; g.stroke();
    g.strokeStyle = '#4f3019'; g.lineWidth = 1; WA_line(g, -12, -10, 0, -10); WA_line(g, 10, -6, 22, -6); WA_line(g, -4, -4, 4, -4);
    WA_ell(g, -30, -8.5, 5.4, 8.5); WA_fillStroke(g, '#dcb37a', 1.6);
    g.strokeStyle = '#b98248'; g.lineWidth = 1; WA_ell(g, -30, -8.5, 3.2, 5.4); g.stroke(); WA_ell(g, -30, -8.5, 1.2, 2.2); g.stroke();
    if (variant % 2 === 0) { WA_mushroom(g, 18, -16, 2.6, false); WA_mushroom(g, 24, -15, 2, false); }
    g.strokeStyle = '#4f9443'; g.lineWidth = 1.3; g.beginPath(); WA_tuftAdd(g, 30, 1, 3, 6, 1.2, 7); WA_tuftAdd(g, -18, 2, 3, 5, 1.2, 8); g.stroke();
  });
}
function WA_mkStump(x, y, variant) { var A = WA_stumpArt(variant); return WA_prop('stump', x - 24, y - 32, 48, 40, y, function (c) { WA_put(c, A, x, y); }, x); }
function WA_mkLog(x, y, variant) { var A = WA_logArt(variant); return WA_prop('log', x - 43, y - 30, 86, 40, y, function (c) { WA_put(c, A, x, y); }, x); }

// ---- park furniture --------------------------------------------------------------------------------------
function WA_benchArt() {
  return WA_sprite('bench', 96, 62, 48, 52, function (g) {
    WA_shadow(g, 0, 1, 40, 6);
    var i, iron = '#3f3d45';
    // legs + arm rests (iron)
    [-31, 31].forEach(function (x) {
      g.strokeStyle = WA_OUT; g.lineWidth = 5.6; g.lineCap = 'round';
      g.beginPath(); g.moveTo(x, -1); g.lineTo(x, -38); g.moveTo(x - 5, 0); g.lineTo(x + 5, 0); g.stroke();
      g.strokeStyle = iron; g.lineWidth = 3; g.beginPath(); g.moveTo(x, -1); g.lineTo(x, -38); g.moveTo(x - 5, 0); g.lineTo(x + 5, 0); g.stroke();
      g.strokeStyle = '#6a6872'; g.lineWidth = 1; WA_line(g, x - 0.8, -3, x - 0.8, -36);
    });
    // back slats
    for (i = 0; i < 3; i++) {
      WA_rr(g, -36, -43 + i * 8, 72, 6.4, 2); WA_fillStroke(g, '#c9935a', 1.5);
      g.fillStyle = '#e3b57e'; g.fillRect(-34, -42.2 + i * 8, 68, 1.3); g.fillStyle = '#a8743f'; g.fillRect(-34, -38.6 + i * 8, 68, 1.3);
    }
    // seat
    g.beginPath(); g.moveTo(-37, -19); g.lineTo(37, -19); g.lineTo(40, -12); g.lineTo(-40, -12); g.closePath(); WA_fillStroke(g, '#d3a068', 1.6);
    g.strokeStyle = '#a8743f'; g.lineWidth = 1; WA_line(g, -38, -15.6, 38, -15.6);
    WA_rr(g, -40, -12, 80, 4.6, 1.5); WA_fillStroke(g, '#b98248', 1.5);
    // arm rests
    [-1, 1].forEach(function (sd) {
      g.strokeStyle = WA_OUT; g.lineWidth = 5.4; g.beginPath(); g.moveTo(sd * 33, -27); g.quadraticCurveTo(sd * 41, -29, sd * 41, -22); g.lineTo(sd * 40, -12); g.stroke();
      g.strokeStyle = iron; g.lineWidth = 2.8; g.beginPath(); g.moveTo(sd * 33, -27); g.quadraticCurveTo(sd * 41, -29, sd * 41, -22); g.lineTo(sd * 40, -12); g.stroke();
    });
    // front legs
    [-37, 37].forEach(function (x) { g.strokeStyle = WA_OUT; g.lineWidth = 5.4; WA_line(g, x, -8, x, 2); g.strokeStyle = iron; g.lineWidth = 2.8; WA_line(g, x, -8, x, 2); });
  });
}
function WA_mkBench(x, y) { var A = WA_benchArt(); return WA_prop('bench', x - 48, y - 52, 96, 62, y, function (c) { WA_put(c, A, x, y); }, x); }

function WA_basketArt() {
  return WA_sprite('basket', 44, 40, 22, 32, function (g) {
    WA_shadow(g, 0, 0, 16, 4.5);
    g.strokeStyle = WA_OUT; g.lineWidth = 4.4; g.beginPath(); g.arc(0, -14, 11, Math.PI, 0); g.stroke();
    g.strokeStyle = '#b98248'; g.lineWidth = 2.2; g.beginPath(); g.arc(0, -14, 11, Math.PI, 0); g.stroke();
    // baguette + bottle sticking out
    g.save(); g.translate(6, -16); g.rotate(0.5); WA_rr(g, -2.6, -12, 5.2, 16, 2.6); WA_fillStroke(g, '#e3b57e', 1.2); g.strokeStyle = '#b98248'; g.lineWidth = 0.9; WA_line(g, -1.5, -8, 1.5, -6.5); WA_line(g, -1.5, -4, 1.5, -2.5); g.restore();
    WA_rr(g, -9, -27, 5, 13, 1.5); WA_fillStroke(g, '#3aa89a', 1.2); g.fillStyle = '#fbf1d8'; g.fillRect(-8.2, -21, 3.4, 4);
    g.beginPath(); g.moveTo(-14, -14); g.lineTo(14, -14); g.lineTo(12, 0); g.quadraticCurveTo(0, 2.5, -12, 0); g.closePath(); WA_fillStroke(g, '#c9935a', 1.7);
    g.strokeStyle = '#a8743f'; g.lineWidth = 1;
    for (var i = 0; i < 3; i++) WA_line(g, -13 + i * 0.6, -10.5 + i * 3.6, 13 - i * 0.6, -10.5 + i * 3.6);
    for (i = -2; i <= 2; i++) WA_line(g, i * 5, -13, i * 4.6, 0);
    g.beginPath(); g.moveTo(-14.5, -14.5); g.lineTo(14.5, -14.5); g.lineTo(9, -9.5); g.lineTo(3, -12); g.lineTo(-4, -9); g.lineTo(-10, -11.5); g.closePath(); WA_fillStroke(g, '#fbf1d8', 1.2);
    g.fillStyle = '#d9574a'; g.fillRect(-8, -13.6, 2.2, 2); g.fillRect(-1, -13.6, 2.2, 2); g.fillRect(6, -13.6, 2.2, 2);
  });
}

// ---- ducks (drawn live: they paddle about) ---------------------------------------------------------------
function WA_duck(c, x, y, s, dir, kind, bob) {
  c.save(); c.translate(x, y + bob); c.scale(dir * s, s);
  c.strokeStyle = 'rgba(255,255,255,0.6)'; c.lineWidth = 1.1 / s;
  c.beginPath(); c.ellipse(0, 2.5, 11.5, 3.6, 0, 0.1, Math.PI - 0.1); c.stroke();
  c.beginPath(); c.ellipse(-9, 3, 8, 2.4, 0, 0.4, Math.PI - 0.3); c.stroke();
  var body = kind === 1 ? '#b08a62' : kind === 2 ? '#f7dc6a' : '#fdfaf0', shade = kind === 1 ? '#8a6846' : kind === 2 ? '#e0bb45' : '#dcd7cb';
  c.beginPath(); c.moveTo(-9, -1); c.quadraticCurveTo(-12, -6.5, -7, -5.5); c.quadraticCurveTo(0, -7.5, 6, -4); c.quadraticCurveTo(9, 0, 5, 2.6); c.quadraticCurveTo(-2, 4.2, -8, 2); c.closePath();
  c.fillStyle = body; c.fill(); c.strokeStyle = WA_OUT; c.lineWidth = 1.4 / s; c.stroke();
  c.strokeStyle = shade; c.lineWidth = 1.1 / s; c.beginPath(); c.moveTo(-5, -2); c.quadraticCurveTo(-1, 1.2, 3, -1.4); c.stroke();
  WA_ell(c, 6.4, -7.4, 3.7, 3.5); c.fillStyle = kind === 1 ? '#2f7d5a' : body; c.fill(); c.strokeStyle = WA_OUT; c.lineWidth = 1.4 / s; c.stroke();
  if (kind === 1) { c.strokeStyle = '#fdfaf0'; c.lineWidth = 1 / s; c.beginPath(); c.moveTo(3.6, -4.6); c.lineTo(8, -4.2); c.stroke(); }
  c.beginPath(); c.moveTo(9.4, -8.2); c.lineTo(13.4, -6.8); c.lineTo(9.6, -5.6); c.closePath(); c.fillStyle = '#f08a4b'; c.fill(); c.strokeStyle = WA_OUT; c.lineWidth = 1 / s; c.stroke();
  c.fillStyle = WA_OUT; WA_ell(c, 7.3, -8.1, 0.8, 0.8); c.fill();
  c.restore();
}
function WA_duckArt(kind, dir, s) {
  return WA_sprite('duck' + kind + (dir > 0 ? 'r' : 'l') + s, 44 * s + 4, 26 * s + 4, 22 * s + 2, 17 * s + 2, function (g) { WA_duck(g, 0, 0, s, dir, kind, 0); });
}
function WA_mkDuck(cx, cy, ax, ay, speed, phase, kind, s) {
  var R = WA_duckArt(kind, 1, s), Lf = WA_duckArt(kind, -1, s);
  return WA_prop('duck', cx - ax - 26, cy - ay - 22, ax * 2 + 52, ay * 2 + 34, cy + ay, function (c, t) {
    var a = t * speed + phase, x = cx + Math.cos(a) * ax + Math.sin(a * 2.3 + phase) * 3, y = cy + Math.sin(a) * ay;
    WA_put(c, -Math.sin(a) * speed >= 0 ? R : Lf, x, y + Math.sin(t * 2.4 + phase * 3) * 0.7);
  }, cx);
}
// soft glints on open water
function WA_mkShimmer(P, n) {
  return WA_prop('shimmer', P.x - P.rx, P.y - P.ry, P.rx * 2, P.ry * 2, P.y - P.ry + 1, function (c, t) {
    var pa = c.globalAlpha;
    c.fillStyle = '#ffffff';
    for (var i = 0; i < n; i++) {
      var a = WA_h2(i, P.seed + 7) * WA_TAU, r = Math.sqrt(WA_h2(i, P.seed + 8)) * 0.72, ph = WA_h2(i, P.seed + 9) * 6.28;
      var k = Math.sin(t * 1.3 + ph); if (k <= 0.15) continue;
      var x = P.x + Math.cos(a) * P.rx * r + Math.sin(t * 0.4 + ph) * 3, y = P.y + Math.sin(a) * P.ry * r, l = 3 + 5 * k;
      if (x > WA_WW - 10) continue;
      c.globalAlpha = 0.55 * k;
      c.fillRect(x - l, y, l * 2, 1.4);
    }
    c.globalAlpha = pa;
  }, P.x);
}
function WA_boatArt() {
  return WA_sprite('boat', 92, 52, 46, 34, function (g) {
    g.fillStyle = 'rgba(30,60,100,0.28)'; WA_ell(g, 1, 5, 38, 9); g.fill();
    g.beginPath(); g.moveTo(-38, -8); g.quadraticCurveTo(-30, 8, -14, 9); g.lineTo(16, 9); g.quadraticCurveTo(32, 8, 40, -8); g.quadraticCurveTo(0, -3, -38, -8); g.closePath();
    WA_fillStroke(g, '#a8743f', 1.8);
    g.strokeStyle = '#7a4e2a'; g.lineWidth = 1; g.beginPath(); g.moveTo(-33, -1.5); g.quadraticCurveTo(0, 4.5, 35, -1.5); g.moveTo(-25, 4.4); g.quadraticCurveTo(0, 8, 27, 4.4); g.stroke();
    g.beginPath(); g.moveTo(-38, -8); g.quadraticCurveTo(0, -17, 40, -8); g.quadraticCurveTo(0, -2, -38, -8); g.closePath(); WA_fillStroke(g, '#6b4526', 1.6);
    g.beginPath(); g.moveTo(-33, -8.2); g.quadraticCurveTo(0, -14.5, 35, -8.2); g.quadraticCurveTo(0, -4.5, -33, -8.2); g.closePath(); g.fillStyle = '#c9935a'; g.fill();
    WA_rr(g, -13, -12.2, 7, 6.4, 1); WA_fillStroke(g, '#dcb37a', 1.1); WA_rr(g, 9, -12.2, 7, 6.4, 1); WA_fillStroke(g, '#dcb37a', 1.1);
    g.strokeStyle = WA_OUT; g.lineWidth = 3.8; WA_line(g, -24, -13, 12, -8); g.strokeStyle = '#e3b57e'; g.lineWidth = 1.8; WA_line(g, -24, -13, 12, -8);
    g.beginPath(); g.ellipse(-27, -14, 5, 2.4, 0.25, 0, WA_TAU); WA_fillStroke(g, '#e3b57e', 1.2);
    g.fillStyle = '#d9574a'; g.fillRect(-36, -6.6, 74, 1.6);
  });
}
function WA_mkBoat(x, y) {
  var A = WA_boatArt();
  return WA_prop('boat', x - 50, y - 38, 100, 56, y, function (c, t) {
    WA_put(c, A, x + Math.sin(t * 0.5) * 0.8, y + Math.sin(t * 1.1) * 1.1);
  }, x);
}

// ---- street furniture ------------------------------------------------------------------------------------
function WA_thick(g, path, col, lw) {       // outlined stroke: dark pass then colour pass
  g.lineCap = 'round'; g.lineJoin = 'round';
  g.strokeStyle = WA_OUT; g.lineWidth = lw + 2.8; path(); g.stroke();
  g.strokeStyle = col; g.lineWidth = lw; path(); g.stroke();
}
function WA_lampArt(lit, side) {
  return WA_sprite('lamp' + (lit ? 1 : 0) + side, 60, 134, 30, 126, function (g) {
    var iron = '#2f4f4a', hi = '#57897d', dk = '#223a37';
    WA_shadow(g, 1, 0.5, 10, 3.4);
    // scroll bracket for the flower basket
    WA_thick(g, function () { g.beginPath(); g.moveTo(0, -66); g.quadraticCurveTo(side * 6, -78, side * 15, -74); g.quadraticCurveTo(side * 19, -71, side * 15, -69); }, iron, 2);
    WA_thick(g, function () { g.beginPath(); g.moveTo(0, -58); g.quadraticCurveTo(side * 8, -60, side * 12, -70); }, iron, 1.6);
    // plinth
    g.beginPath(); g.moveTo(-7.5, 0); g.lineTo(-6.5, -5); g.lineTo(-4.2, -8); g.lineTo(-3.6, -17); g.lineTo(3.6, -17); g.lineTo(4.2, -8); g.lineTo(6.5, -5); g.lineTo(7.5, 0); g.closePath();
    WA_fillStroke(g, iron, 1.8); g.fillStyle = dk; g.fillRect(1, -16, 2.4, 11); g.fillStyle = hi; g.fillRect(-2.6, -16, 1.2, 9);
    g.fillStyle = dk; g.fillRect(-6.4, -4.6, 12.8, 1.4);
    // post
    g.beginPath(); g.rect(-2.4, -90, 4.8, 73); WA_fillStroke(g, iron, 1.8);
    g.fillStyle = hi; g.fillRect(-1.4, -88, 1.1, 70); g.fillStyle = dk; g.fillRect(0.8, -88, 1.2, 70);
    [[-20, 4], [-57, 3.6], [-90, 4.4]].forEach(function (q) { WA_rr(g, -q[1], q[0], q[1] * 2, 3.4, 1.4); WA_fillStroke(g, iron, 1.5); g.fillStyle = hi; g.fillRect(-q[1] + 1.2, q[0] + 0.8, 2, 1); });
    // lantern
    g.beginPath(); g.moveTo(-3.4, -90); g.lineTo(-6, -95); g.lineTo(6, -95); g.lineTo(3.4, -90); g.closePath(); WA_fillStroke(g, iron, 1.6);
    g.beginPath(); g.moveTo(-5.4, -95); g.lineTo(-8, -111); g.lineTo(8, -111); g.lineTo(5.4, -95); g.closePath();
    g.fillStyle = lit ? '#ffe9a6' : '#e6f1ec'; g.fill();
    g.save(); g.clip();
    if (lit) { g.fillStyle = '#fff9dc'; WA_ell(g, 0, -102, 4.2, 5.6); g.fill(); g.fillStyle = '#ffd36a'; g.fillRect(-8, -97.5, 16, 2.5); }
    else { g.fillStyle = '#cbdcd5'; g.fillRect(1, -112, 8, 18); g.fillStyle = '#ffffff'; g.fillRect(-5.6, -109, 1.6, 9); g.fillStyle = '#f2c14e'; WA_ell(g, 0, -100, 1.6, 2.6); g.fill(); }
    g.restore();
    g.strokeStyle = WA_OUT; g.lineWidth = 1.6; g.stroke();
    g.strokeStyle = iron; g.lineWidth = 1.3; WA_line(g, 0, -95.5, 0, -110.5);
    g.beginPath(); g.moveTo(-10.5, -110.5); g.lineTo(-6, -118); g.lineTo(6, -118); g.lineTo(10.5, -110.5); g.closePath(); WA_fillStroke(g, iron, 1.7);
    g.fillStyle = hi; g.beginPath(); g.moveTo(-8, -111.6); g.lineTo(-5, -116.6); g.lineTo(-2.6, -116.6); g.lineTo(-5, -111.6); g.closePath(); g.fill();
    WA_ell(g, 0, -120.6, 2.3, 2.3); WA_fillStroke(g, iron, 1.5);
  });
}
var WA_SWING_FRAMES = 5, WA_SWING_RANGE = 0.11;
function WA_swingFrame(v) { return WA_clamp(Math.round((v / WA_SWING_RANGE * 0.5 + 0.5) * (WA_SWING_FRAMES - 1)), 0, WA_SWING_FRAMES - 1) | 0; }
function WA_hangBasketArt(variant, frame) {
  var rot = (frame / (WA_SWING_FRAMES - 1) - 0.5) * 2 * WA_SWING_RANGE;
  return WA_sprite('hbasket' + variant + '-' + frame, 48, 46, 24, 6, function (g) {
    var rnd = WA_rng(variant * 19 + 3), i;
    g.rotate(rot);
    g.strokeStyle = WA_OUT; g.lineWidth = 1; WA_line(g, 0, 0, -8, 12); WA_line(g, 0, 0, 8, 12); WA_line(g, 0, 0, 0, 11);
    g.beginPath(); g.moveTo(-10, 12); g.quadraticCurveTo(-9, 23, 0, 23.5); g.quadraticCurveTo(9, 23, 10, 12); g.closePath(); WA_fillStroke(g, '#8a5a34', 1.6);
    g.strokeStyle = '#6b4526'; g.lineWidth = 0.9; g.beginPath(); g.moveTo(-8.6, 16); g.quadraticCurveTo(0, 18.5, 8.6, 16); g.moveTo(-6.5, 20); g.quadraticCurveTo(0, 22, 6.5, 20); g.stroke();
    // trailing vines
    g.strokeStyle = '#3f7d3a'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(-9, 13); g.quadraticCurveTo(-14, 18, -12, 27); g.moveTo(9, 13); g.quadraticCurveTo(14, 19, 11, 30); g.stroke();
    g.fillStyle = '#5aa84e'; [[-12.6, 21], [-12, 27], [12.6, 22], [11.2, 30]].forEach(function (q) { g.beginPath(); g.ellipse(q[0], q[1], 2.6, 1.5, 0.8, 0, WA_TAU); g.fill(); });
    var cl = [];
    for (i = 0; i < 6; i++) cl.push({ x: -10 + i * 4, y: 9.5 - Math.sin(i / 5 * Math.PI) * 4 + rnd() * 1.5, r: 4.6 + rnd() * 1.5 });
    WA_foliageBack(g, cl, ['#3f7d3a', '#4f9a45', '#6cb85a', '#8fd072', '#2f6633'], 0, 8, 12, 1.5);
    var cols = variant % 2 ? ['#f2a0b5', '#fdfaf0', '#d9574a'] : ['#f2c14e', '#d9574a', '#f08a4b'];
    for (i = 0; i < 7; i++) {
      var x = -11 + i * 3.7 + (rnd() - 0.5) * 2, y = 7.5 - Math.sin(i / 6 * Math.PI) * 4.5 + (rnd() - 0.5) * 3;
      WA_ell(g, x, y, 2.3, 2.2); WA_fillStroke(g, cols[i % 3], 0.8); g.fillStyle = 'rgba(255,255,255,0.55)'; WA_ell(g, x - 0.6, y - 0.6, 0.8, 0.7); g.fill();
    }
  });
}
function WA_lampGlowArt() {
  return WA_sprite('lampglow', 72, 72, 36, 36, function (g) {
    var gr = g.createRadialGradient(0, 0, 2, 0, 0, 35);
    gr.addColorStop(0, 'rgba(255,232,150,0.55)'); gr.addColorStop(0.4, 'rgba(255,214,120,0.22)'); gr.addColorStop(1, 'rgba(255,214,120,0)');
    g.fillStyle = gr; g.fillRect(-36, -36, 72, 72);
  });
}
function WA_mkLamp(x, y, side, withBasket) {
  var A0 = WA_lampArt(false, side), A1 = WA_lampArt(true, side), G = WA_lampGlowArt(), B = null, ph = WA_h2(x, 5) * 6.28, i;
  if (withBasket) { B = []; for (i = 0; i < WA_SWING_FRAMES; i++) B.push(WA_hangBasketArt(Math.abs(Math.round(x / 100)) % 2, i)); }
  var p = WA_prop('lamp', x - 44, y - 150, 88, 158, y, function (c, t, state) {
    var n = WA_night(state), k = WA_clamp((n - 0.3) / 0.12, 0, 1), wd = WA_wind(state), pa = c.globalAlpha;
    if (k < 1) WA_put(c, A0, x, y);
    if (k > 0) {
      c.globalAlpha = pa * k; WA_put(c, A1, x, y);
      c.globalAlpha = pa * k * (0.9 + 0.1 * Math.sin(t * 7 + ph)); WA_put(c, G, x, y - 103);
      c.globalAlpha = pa;
    }
    if (B) WA_put(c, B[WA_swingFrame(wd * 0.07 + Math.sin(t * 1.5 + ph) * 0.04 * (0.6 + Math.abs(wd)))], x + side * 15.5, y - 69.5);
  }, x);
  p.lightX = x; p.lightY = y - 103;
  return p;
}

function WA_mailboxArt() {
  return WA_sprite('mailbox', 52, 70, 24, 62, function (g) {
    WA_shadow(g, 1, 0.5, 11, 3.6);
    g.beginPath(); g.rect(-2.8, -32, 5.6, 32); WA_fillStroke(g, '#a8743f', 1.7);
    g.fillStyle = '#7a4e2a'; g.fillRect(0.6, -31, 1.6, 30); g.fillStyle = '#c9935a'; g.fillRect(-2, -31, 1, 30);
    WA_thick(g, function () { g.beginPath(); g.moveTo(0, -22); g.lineTo(9, -31); }, '#a8743f', 2.2);
    // flag
    WA_thick(g, function () { g.beginPath(); g.moveTo(6, -40); g.lineTo(6, -56); }, '#8b868e', 1.2);
    g.beginPath(); g.rect(6, -57, 8.5, 6); WA_fillStroke(g, '#f2c14e', 1.3);
    // box
    function box() { g.beginPath(); g.moveTo(-15, -31); g.lineTo(-15, -40); g.quadraticCurveTo(-15, -49, -6, -49); g.lineTo(9, -49); g.quadraticCurveTo(17, -49, 17, -40); g.lineTo(17, -31); g.closePath(); }
    box(); g.fillStyle = '#d9574a'; g.fill();
    g.save(); g.clip(); g.fillStyle = '#b8402f'; g.fillRect(-16, -36, 34, 6); g.fillStyle = '#ee8a7c'; g.fillRect(-10, -47.6, 22, 1.6); g.restore();
    box(); g.strokeStyle = WA_OUT; g.lineWidth = 1.8; g.stroke();
    g.strokeStyle = '#8f2f24'; g.lineWidth = 1.1; g.beginPath(); g.moveTo(-10.5, -31.5); g.lineTo(-10.5, -40); g.quadraticCurveTo(-10.5, -45.5, -6, -48); g.stroke();
    g.fillStyle = '#fbf1d8'; WA_pawPrint(g, 4.5, -38, 1.15, 0.1);
    g.fillStyle = '#fdfaf0'; g.strokeStyle = WA_OUT; g.lineWidth = 1; g.beginPath(); g.moveTo(-17.5, -42); g.lineTo(-12.6, -43.4); g.lineTo(-12.2, -38.6); g.lineTo(-17.2, -37.4); g.closePath(); g.fill(); g.stroke();
    g.strokeStyle = '#4f9443'; g.lineWidth = 1.3; g.beginPath(); WA_tuftAdd(g, -5, 1, 3, 6, 1.2, 3); WA_tuftAdd(g, 5, 1.5, 3, 5, 1.2, 4); g.stroke();
  });
}
function WA_bikeRackArt() {
  return WA_sprite('bikerack', 132, 66, 66, 58, function (g) {
    var i;
    WA_shadow(g, 0, 1, 56, 5);
    function hoop(x) { WA_thick(g, function () { g.beginPath(); g.moveTo(x - 7.5, 0); g.lineTo(x - 7.5, -15); g.arc(x, -15, 7.5, Math.PI, 0); g.lineTo(x + 7.5, 0); }, '#9aa5ad', 2.4); g.strokeStyle = '#dfe6ea'; g.lineWidth = 0.9; g.beginPath(); g.arc(x, -15, 7.5, Math.PI * 1.1, Math.PI * 1.6); g.stroke(); }
    hoop(-44); hoop(0);
    // bicycle (facing right), leaning on the middle hoop
    var A = [-34, -13], B = [-13, -13], Sd = [-19, -34], Hh = [6, -35], H2 = [8, -27], F = [13, -13], r = 12.5;
    [A, F].forEach(function (w) {
      WA_ell(g, w[0], w[1], r, r); g.strokeStyle = WA_OUT; g.lineWidth = 4.6; g.stroke(); g.strokeStyle = '#4a464e'; g.lineWidth = 2.4; g.stroke();
      g.strokeStyle = '#c3cbd0'; g.lineWidth = 0.8; WA_ell(g, w[0], w[1], r - 2.4, r - 2.4); g.stroke();
      g.beginPath(); for (i = 0; i < 7; i++) { var a = i / 7 * WA_TAU + 0.3; g.moveTo(w[0], w[1]); g.lineTo(w[0] + Math.cos(a) * (r - 2.4), w[1] + Math.sin(a) * (r - 2.4)); } g.stroke();
      WA_ell(g, w[0], w[1], 1.8, 1.8); WA_fillStroke(g, '#8b868e', 1);
    });
    WA_thick(g, function () { g.beginPath(); g.moveTo(A[0], A[1]); g.lineTo(B[0], B[1]); g.lineTo(Sd[0], Sd[1]); g.lineTo(A[0], A[1]); g.moveTo(Sd[0] + 1, Sd[1] + 3); g.lineTo(Hh[0] + 0.6, Hh[1] + 3); g.moveTo(B[0], B[1]); g.lineTo(H2[0], H2[1]); g.moveTo(Hh[0], Hh[1] - 3); g.lineTo(H2[0], H2[1]); g.lineTo(F[0], F[1]); }, '#3aa89a', 2.2);
    WA_thick(g, function () { g.beginPath(); g.moveTo(Sd[0], Sd[1]); g.lineTo(Sd[0] - 1.2, Sd[1] - 5); }, '#8b868e', 1.4);
    WA_rr(g, Sd[0] - 7.5, Sd[1] - 8.4, 11.5, 3.8, 1.8); WA_fillStroke(g, '#7a4e2a', 1.4);
    WA_thick(g, function () { g.beginPath(); g.moveTo(Hh[0], Hh[1] - 3); g.lineTo(Hh[0] - 0.6, Hh[1] - 8); g.quadraticCurveTo(Hh[0] - 1, Hh[1] - 11, Hh[0] - 7, Hh[1] - 10); }, '#4a464e', 1.6);
    WA_ell(g, B[0], B[1], 3, 3); WA_fillStroke(g, '#c3cbd0', 1.2); WA_thick(g, function () { g.beginPath(); g.moveTo(B[0], B[1]); g.lineTo(B[0] + 4, B[1] + 5); g.lineTo(B[0] + 7, B[1] + 5); }, '#4a464e', 1.3);
    // front basket with flowers
    g.beginPath(); g.moveTo(9, -43); g.lineTo(24, -43); g.lineTo(22, -32); g.lineTo(11, -32); g.closePath(); WA_fillStroke(g, '#c9935a', 1.5);
    g.strokeStyle = '#a8743f'; g.lineWidth = 0.9; WA_line(g, 10, -39.5, 23.4, -39.5); WA_line(g, 10.6, -36, 22.6, -36); WA_line(g, 14, -43, 14.6, -32); WA_line(g, 19, -43, 18.6, -32);
    [[11.5, -46, '#f2a0b5'], [16, -48, '#f2c14e'], [20.5, -46.5, '#fdfaf0'], [23, -44.5, '#d9574a']].forEach(function (q) { g.strokeStyle = '#3f7d3a'; g.lineWidth = 1; WA_line(g, q[0], q[1], q[0], -43); WA_ell(g, q[0], q[1], 2.3, 2.2); WA_fillStroke(g, q[2], 0.8); });
    hoop(44);
  });
}
function WA_boardArt() {
  return WA_sprite('aboard', 48, 62, 22, 55, function (g) {
    WA_shadow(g, 3, 0.5, 17, 4.2);
    g.beginPath(); g.moveTo(9, -42); g.lineTo(13, -42); g.lineTo(22, -2); g.lineTo(18, -2); g.closePath(); WA_fillStroke(g, '#7a4e2a', 1.6);
    g.beginPath(); g.moveTo(-15, 0); g.lineTo(-12.5, -44); g.lineTo(12.5, -44); g.lineTo(15, 0); g.lineTo(11, 0); g.lineTo(10.6, -5); g.lineTo(-10.6, -5); g.lineTo(-11, 0); g.closePath(); WA_fillStroke(g, '#c9935a', 1.8);
    g.fillStyle = '#e3b57e'; g.fillRect(-11.5, -43, 23, 1.3);
    g.beginPath(); g.moveTo(-10.6, -8.5); g.lineTo(-9.3, -40.5); g.lineTo(9.3, -40.5); g.lineTo(10.6, -8.5); g.closePath(); WA_fillStroke(g, '#3d4a44', 1.2);
    g.fillStyle = 'rgba(255,255,255,0.07)'; g.fillRect(-9, -30, 18, 6);
    g.fillStyle = '#fbf1d8'; WA_pawPrint(g, 0, -31.5, 1.35, 0);
    g.fillStyle = '#f7dc6a'; WA_setFont(g, 11); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('OPEN', 0, -19.5);
    g.strokeStyle = '#f6aabe'; g.lineWidth = 1.1; g.beginPath(); g.moveTo(-7, -12.5); g.quadraticCurveTo(0, -14.5, 7, -12.5); g.stroke();
  });
}
function WA_shelterArt(lit) {
  return WA_sprite('shelter' + (lit ? 1 : 0), 156, 124, 78, 112, function (g) {
    var teal = '#3aa89a', dk = '#2c7f75', i;
    g.fillStyle = WA_SHADOW; WA_rr(g, -62, -12, 124, 16, 7); g.fill();
    // glass back wall
    for (i = 0; i < 3; i++) {
      var px = -54 + i * 36;
      g.beginPath(); g.rect(px + 2, -78, 32, 54); g.fillStyle = 'rgba(206,236,240,0.55)'; g.fill(); g.strokeStyle = WA_OUT; g.lineWidth = 1.2; g.stroke();
      g.strokeStyle = 'rgba(255,255,255,0.75)'; g.lineWidth = 1.6; WA_line(g, px + 7, -50, px + 17, -72); WA_line(g, px + 12, -50, px + 18, -63);
      g.beginPath(); g.rect(px + 2, -24, 32, 14); WA_fillStroke(g, teal, 1.4); g.fillStyle = dk; g.fillRect(px + 3, -14.6, 30, 3.6);
    }
    // route map poster
    WA_rr(g, -12, -70, 24, 32, 1.5); WA_fillStroke(g, '#fbf1d8', 1.3);
    g.strokeStyle = '#d9574a'; g.lineWidth = 1.4; g.beginPath(); g.moveTo(-8, -46); g.lineTo(-3, -54); g.lineTo(3, -52); g.lineTo(8, -62); g.stroke();
    g.strokeStyle = '#3f8fc4'; g.beginPath(); g.moveTo(-8, -58); g.lineTo(0, -58); g.lineTo(7, -47); g.stroke();
    g.fillStyle = WA_OUT; [[-8, -46], [-3, -54], [3, -52], [8, -62], [-8, -58], [0, -58], [7, -47]].forEach(function (q) { WA_ell(g, q[0], q[1], 1.3, 1.3); g.fill(); });
    g.fillStyle = '#3b2a20'; g.fillRect(-8, -67, 16, 2);
    // posts
    [-54, -18, 18, 54].forEach(function (x) { g.beginPath(); g.rect(x - 2.4, -84, 4.8, 75); WA_fillStroke(g, dk, 1.6); g.fillStyle = '#57c2b3'; g.fillRect(x - 1.4, -82, 1, 71); });
    // bench
    [-34, 34].forEach(function (x) { g.beginPath(); g.rect(x - 2, -22, 4, 18); WA_fillStroke(g, '#4a464e', 1.4); });
    g.beginPath(); g.moveTo(-44, -31); g.lineTo(44, -31); g.lineTo(47, -24); g.lineTo(-47, -24); g.closePath(); WA_fillStroke(g, '#d3a068', 1.5);
    g.strokeStyle = '#a8743f'; g.lineWidth = 1; WA_line(g, -45, -27.6, 45, -27.6);
    WA_rr(g, -47, -24, 94, 4.4, 1.4); WA_fillStroke(g, '#b98248', 1.4);
    // roof: top face + fascia
    g.fillStyle = 'rgba(20,50,60,0.25)'; g.fillRect(-56, -78, 112, 5);
    g.beginPath(); g.moveTo(-66, -84); g.lineTo(66, -84); g.lineTo(59, -97); g.lineTo(-59, -97); g.closePath(); WA_fillStroke(g, teal, 1.8);
    g.strokeStyle = '#6fd0c2'; g.lineWidth = 1.4; WA_line(g, -57, -94, 57, -94);
    g.strokeStyle = dk; g.lineWidth = 1; for (i = -2; i <= 2; i++) WA_line(g, i * 22, -96.5, i * 24.5, -84.5);
    WA_rr(g, -66, -84.5, 132, 7.5, 2); WA_fillStroke(g, dk, 1.8); g.fillStyle = '#3f9c8f'; g.fillRect(-64, -83.4, 128, 1.6);
    // name plate
    WA_rr(g, -19, -107, 38, 13.5, 3); WA_fillStroke(g, '#fbf1d8', 1.6);
    g.fillStyle = '#2c7f75'; WA_setFont(g, 13); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('BUS', 0, -99.6);
    if (lit) {
      g.fillStyle = '#fff3c0'; g.fillRect(-50, -77.5, 100, 2.4);
      var gr = g.createLinearGradient(0, -76, 0, -20); gr.addColorStop(0, 'rgba(255,232,150,0.42)'); gr.addColorStop(1, 'rgba(255,232,150,0)');
      g.fillStyle = gr; g.beginPath(); g.moveTo(-50, -75); g.lineTo(50, -75); g.lineTo(58, -14); g.lineTo(-58, -14); g.closePath(); g.fill();
    }
  });
}
function WA_mkShelter(x, y) {
  var A = WA_shelterArt(false), A1 = WA_shelterArt(true);
  var p = WA_prop('shelter', x - 78, y - 112, 156, 124, y, function (c, t, state) {
    var n = WA_night(state), k = WA_clamp((n - 0.3) / 0.12, 0, 1), pa = c.globalAlpha;
    if (k < 1) WA_put(c, A, x, y);
    if (k > 0) { c.globalAlpha = pa * k; WA_put(c, A1, x, y); c.globalAlpha = pa; }
  }, x);
  p.lightX = x; p.lightY = y - 60;
  return p;
}
function WA_busSignArt() {
  return WA_sprite('bussign', 34, 92, 17, 86, function (g) {
    WA_shadow(g, 1, 0.5, 7, 2.6);
    g.beginPath(); g.rect(-1.7, -66, 3.4, 66); WA_fillStroke(g, '#9aa5ad', 1.5); g.fillStyle = '#dfe6ea'; g.fillRect(-1, -64, 0.9, 62);
    WA_rr(g, -5, -4, 10, 4, 1.5); WA_fillStroke(g, '#8b868e', 1.3);
    WA_rr(g, -7, -50, 14, 17, 1.5); WA_fillStroke(g, '#fbf1d8', 1.4);
    g.fillStyle = '#918b80'; for (var i = 0; i < 4; i++) g.fillRect(-5, -47 + i * 3.4, i % 2 ? 7 : 10, 1.2);
    WA_ell(g, 0, -68, 11, 11); WA_fillStroke(g, '#3f8fc4', 1.8);
    WA_ell(g, 0, -68, 8.6, 8.6); g.strokeStyle = '#fdfaf0'; g.lineWidth = 1.1; g.stroke();
    WA_rr(g, -6, -73, 12, 8.4, 2); g.fillStyle = '#fdfaf0'; g.fill();
    g.fillStyle = '#3f8fc4'; g.fillRect(-4.6, -71.6, 4, 3); g.fillRect(0.6, -71.6, 4, 3);
    g.fillStyle = '#fdfaf0'; WA_ell(g, -3.4, -63.6, 1.7, 1.7); g.fill(); WA_ell(g, 3.4, -63.6, 1.7, 1.7); g.fill();
  });
}

// ---- vehicles (side view). dir: 1 faces right, -1 faces left ----------------------------------------------
function WA_wheel(g, x, y, r) {
  WA_ell(g, x, y, r, r); WA_fillStroke(g, '#2f2b30', 1.8);
  g.strokeStyle = '#4a464e'; g.lineWidth = 1.2; WA_ell(g, x, y, r - 2.2, r - 2.2); g.stroke();
  WA_ell(g, x, y, r * 0.52, r * 0.52); WA_fillStroke(g, '#d5d8dc', 1.2);
  g.fillStyle = '#8b868e'; for (var i = 0; i < 5; i++) { var a = i / 5 * WA_TAU - 1.57; WA_ell(g, x + Math.cos(a) * r * 0.3, y + Math.sin(a) * r * 0.3, 0.9, 0.9); g.fill(); }
  g.fillStyle = 'rgba(255,255,255,0.75)'; WA_ell(g, x - r * 0.2, y - r * 0.22, r * 0.16, r * 0.13); g.fill();
}
function WA_carArt(type, col, shade, dir) {
  var key = 'car-' + type + col + dir;
  if (type === 'van') return WA_sprite(key, 196, 108, 98, 98, function (g) {
    function X(x) { return dir * x; }
    WA_shadow(g, 0, 1, 84, 8);
    function body() {
      g.beginPath(); g.moveTo(X(-80), -13); g.lineTo(X(-80), -70); g.quadraticCurveTo(X(-80), -76, X(-74), -76); g.lineTo(X(40), -76); g.quadraticCurveTo(X(52), -75, X(58), -66);
      g.lineTo(X(70), -46); g.quadraticCurveTo(X(82), -43, X(84), -36); g.lineTo(X(85), -16); g.quadraticCurveTo(X(85), -12, X(81), -12); g.lineTo(X(-76), -12); g.closePath();
    }
    body(); g.fillStyle = col; g.fill();
    g.save(); g.clip();
    g.fillStyle = shade; g.fillRect(-90, -24, 180, 14);
    g.fillStyle = '#3aa89a'; g.fillRect(-90, -36, 180, 6);
    g.fillStyle = 'rgba(255,255,255,0.5)'; g.fillRect(-90, -74.5, 180, 2.2);
    g.restore();
    body(); g.strokeStyle = WA_OUT; g.lineWidth = 1.9; g.stroke();
    // cab window + door
    g.beginPath(); g.moveTo(X(40), -70); g.lineTo(X(53), -69); g.lineTo(X(66), -47); g.lineTo(X(40), -47); g.closePath(); WA_fillStroke(g, '#bfe3ea', 1.4);
    g.strokeStyle = 'rgba(255,255,255,0.8)'; g.lineWidth = 1.5; WA_line(g, X(44), -52, X(50), -65);
    g.strokeStyle = shade; g.lineWidth = 1.1; g.beginPath(); g.moveTo(X(36), -74); g.lineTo(X(36), -14); g.moveTo(X(68), -44); g.lineTo(X(69), -14); g.stroke();
    g.fillStyle = WA_OUT; g.fillRect(Math.min(X(41), X(46)), -41.6, 5, 1.6);
    WA_rr(g, Math.min(X(66), X(70)), -52, 4, 5.6, 1.4); WA_fillStroke(g, '#4a464e', 1);
    // rear doors
    g.strokeStyle = shade; g.lineWidth = 1.1; WA_line(g, X(-74), -72, X(-74), -14);
    // lights + bumpers
    WA_rr(g, Math.min(X(79), X(84.5)), -36, 5.5, 6, 1.6); WA_fillStroke(g, '#fff3c4', 1.1);
    WA_rr(g, Math.min(X(-81), X(-77.5)), -38, 3.5, 8, 1); WA_fillStroke(g, '#d9574a', 1);
    WA_rr(g, Math.min(X(74), X(87)), -19, 13, 6, 2); WA_fillStroke(g, '#8b868e', 1.3);
    WA_rr(g, Math.min(X(-83), X(-74)), -19, 9, 6, 2); WA_fillStroke(g, '#8b868e', 1.3);
    // livery: bone + name
    var lx = X(-22);
    WA_rr(g, lx - 43, -69, 86, 28, 5); g.fillStyle = 'rgba(58,168,154,0.14)'; g.fill();
    g.save(); g.translate(lx - 26, -55); g.rotate(-0.35);
    g.strokeStyle = WA_OUT; g.lineWidth = 7.4; g.lineCap = 'round'; WA_line(g, -6.5, 0, 6.5, 0);
    g.fillStyle = WA_OUT; [[-8, -3.2], [-8, 3.2], [8, -3.2], [8, 3.2]].forEach(function (q) { WA_ell(g, q[0], q[1], 4.6, 4.6); g.fill(); });
    g.strokeStyle = '#fdfaf0'; g.lineWidth = 4.6; WA_line(g, -6.5, 0, 6.5, 0);
    g.fillStyle = '#fdfaf0'; [[-8, -3.2], [-8, 3.2], [8, -3.2], [8, 3.2]].forEach(function (q) { WA_ell(g, q[0], q[1], 3.2, 3.2); g.fill(); });
    g.restore();
    g.fillStyle = '#2c7f75'; WA_setFont(g, 15); g.textAlign = 'left'; g.textBaseline = 'middle';
    g.fillText('KIBBLE', lx - 10, -60); g.fillStyle = '#d9574a'; g.fillText('EXPRESS', lx - 10, -48.5);
    // wheels
    [X(-48), X(52)].forEach(function (wx) { g.fillStyle = '#2a262b'; g.beginPath(); g.arc(wx, -12, 15.5, Math.PI, 0); g.closePath(); g.fill(); WA_wheel(g, wx, -12, 12.5); });
  });
  var bug = type === 'bug';
  return WA_sprite(key, 140, 78, 70, 68, function (g) {
    function X(x) { return dir * x; }
    WA_shadow(g, 0, 1, 59, 7);
    function body() {
      g.beginPath();
      if (bug) {
        g.moveTo(X(-54), -11); g.quadraticCurveTo(X(-59), -20, X(-55), -29); g.quadraticCurveTo(X(-46), -37, X(-38), -42);
        g.bezierCurveTo(X(-28), -58, X(8), -60, X(20), -44); g.quadraticCurveTo(X(38), -39, X(50), -32); g.quadraticCurveTo(X(58), -26, X(56), -12); g.lineTo(X(52), -10); g.lineTo(X(-50), -10); g.closePath();
      } else {
        g.moveTo(X(-56), -11); g.lineTo(X(-58), -27); g.quadraticCurveTo(X(-57), -34, X(-51), -36); g.lineTo(X(-41), -51); g.quadraticCurveTo(X(-38), -55, X(-31), -55); g.lineTo(X(5), -55);
        g.quadraticCurveTo(X(13), -55, X(19), -49); g.lineTo(X(31), -37); g.quadraticCurveTo(X(49), -35, X(56), -30); g.quadraticCurveTo(X(60), -26, X(59), -14); g.lineTo(X(56), -10); g.lineTo(X(-53), -10); g.closePath();
      }
    }
    body(); g.fillStyle = col; g.fill();
    g.save(); g.clip();
    g.fillStyle = shade; g.fillRect(-70, -21, 140, 12);
    g.fillStyle = 'rgba(255,255,255,0.4)'; g.fillRect(-70, bug ? -34.5 : -33.5, 140, 1.8);
    g.restore();
    body(); g.strokeStyle = WA_OUT; g.lineWidth = 1.9; g.stroke();
    // glass
    g.beginPath();
    if (bug) { g.moveTo(X(-34), -38); g.bezierCurveTo(X(-26), -54, X(6), -55, X(15), -41); g.lineTo(X(15), -38); g.closePath(); }
    else { g.moveTo(X(-45), -37.5); g.lineTo(X(-37), -50.5); g.lineTo(X(5), -50.5); g.quadraticCurveTo(X(10), -50, X(14), -46.5); g.lineTo(X(23), -37.5); g.closePath(); }
    WA_fillStroke(g, '#bfe3ea', 1.4);
    g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 1.5; WA_line(g, X(-2), -40.5, X(4), -48); WA_line(g, X(-28), -40.5, X(-24), -46);
    g.strokeStyle = WA_OUT; g.lineWidth = 3.6; WA_line(g, X(-11), -37.5, X(-11), bug ? -51 : -50.5); g.strokeStyle = col; g.lineWidth = 1.6; WA_line(g, X(-11), -37.5, X(-11), bug ? -51 : -50.5);
    // doors, handle, mirror
    g.strokeStyle = shade; g.lineWidth = 1.1; g.beginPath(); g.moveTo(X(-11), -36.5); g.lineTo(X(-11), -13); g.moveTo(X(21), -36.5); g.quadraticCurveTo(X(23), -25, X(21), -13); g.stroke();
    g.fillStyle = WA_OUT; g.fillRect(Math.min(X(-7), X(-2)), -32.4, 5, 1.5);
    WA_rr(g, Math.min(X(21), X(25.4)), -41.6, 4.4, 4, 1.4); WA_fillStroke(g, col, 1.1);
    // lights, bumpers
    WA_ell(g, X(bug ? 51 : 55), bug ? -28 : -27.5, 3.2, 2.8); WA_fillStroke(g, '#fff3c4', 1.1);
    WA_rr(g, Math.min(X(-58.5), X(-55)), bug ? -29 : -31.5, 3.5, 6, 1); WA_fillStroke(g, '#b8402f', 1);
    WA_rr(g, Math.min(X(50), X(61)), -18, 11, 5.4, 2); WA_fillStroke(g, '#9a959c', 1.3);
    WA_rr(g, Math.min(X(-60.5), X(-51)), -18, 9.5, 5.4, 2); WA_fillStroke(g, '#9a959c', 1.3);
    [X(-35), X(37)].forEach(function (wx) { g.fillStyle = '#2a262b'; g.beginPath(); g.arc(wx, -11, 14, Math.PI, 0); g.closePath(); g.fill(); WA_wheel(g, wx, -11, 11); });
    if (!bug) { g.strokeStyle = WA_OUT; g.lineWidth = 1; WA_line(g, X(-30), -55, X(-36), -64); }
  });
}
function WA_mkSprite(kind, A, x, y) { return WA_prop(kind, x - A.ox, y - A.oy, A.w, A.h, y, function (c) { WA_put(c, A, x, y); }, x); }

// ---- "FOR SALE" sign --------------------------------------------------------------------------------------
function WA_signPostArt() {
  return WA_sprite('signpost', 56, 70, 14, 62, function (g) {
    WA_shadow(g, 8, 0.5, 17, 4);
    WA_thick(g, function () { g.beginPath(); g.moveTo(0, -42); g.lineTo(10, -51); }, '#a8743f', 2.2);
    g.beginPath(); g.rect(-3.2, -54, 6.4, 54); WA_fillStroke(g, '#b98248', 1.8); g.fillStyle = '#8a5a34'; g.fillRect(0.8, -53, 1.6, 52); g.fillStyle = '#dcb37a'; g.fillRect(-2.2, -53, 1, 52);
    WA_rr(g, -4.5, -57.5, 9, 4.5, 1.6); WA_fillStroke(g, '#a8743f', 1.5);
    WA_rr(g, -3.2, -52, 36, 5, 1.6); WA_fillStroke(g, '#b98248', 1.7); g.fillStyle = '#dcb37a'; g.fillRect(-2, -51.2, 33, 1);
    g.strokeStyle = '#4f9443'; g.lineWidth = 1.3; g.beginPath(); WA_tuftAdd(g, -6, 1, 3, 6.5, 1.2, 3); WA_tuftAdd(g, 5.5, 1.5, 3, 5.5, 1.2, 4); g.stroke();
  });
}
function WA_signBoardArt(sold, frame) {
  var rot = (frame / (WA_SWING_FRAMES - 1) - 0.5) * 2 * WA_SWING_RANGE;
  return WA_sprite('signboard' + (sold ? 1 : 0) + '-' + frame, 64, 46, 32, 4, function (g) {
    g.rotate(rot);
    g.strokeStyle = WA_OUT; g.lineWidth = 1.1; WA_line(g, -12, 0, -12, 6); WA_line(g, 12, 0, 12, 6);
    WA_rr(g, -22, 5, 44, 30, 3); WA_fillStroke(g, '#fbf1d8', 1.8);
    WA_rr(g, -19.5, 7.5, 39, 25, 2); g.strokeStyle = sold ? '#2c7f75' : '#d9574a'; g.lineWidth = 1.2; g.stroke();
    g.textAlign = 'center'; g.textBaseline = 'middle';
    if (sold) {
      g.save(); g.translate(0, 20); g.rotate(-0.12); WA_rr(g, -20, -7.5, 40, 15, 2); WA_fillStroke(g, '#3aa89a', 1.4);
      g.fillStyle = '#fdfaf0'; WA_setFont(g, 16); g.fillText('SOLD', 0, 0.6); g.restore();
    } else {
      g.fillStyle = '#7a4e2a'; WA_setFont(g, 11); g.fillText('FOR', 0, 13.4);
      g.fillStyle = '#d9574a'; WA_setFont(g, 16); g.fillText('SALE', 0, 24.6);
    }
  });
}
function WA_mkSaleSign(x, y, sold, plotId) {
  var P = WA_signPostArt(), B = [], ph = WA_h2(x, y) * 6.28, i;
  for (i = 0; i < WA_SWING_FRAMES; i++) B.push(WA_signBoardArt(sold, i));
  var p = WA_prop('sign', x - 18, y - 64, 66, 74, y, function (c, t, state) {
    var wd = WA_wind(state);
    WA_put(c, P, x, y);
    WA_put(c, B[WA_swingFrame(wd * 0.05 + Math.sin(t * 1.7 + ph) * 0.04 * (0.5 + Math.abs(wd)))], x + 15, y - 47.5);
  }, x);
  p.plot = plotId; p.signX = x + 15; p.signY = y - 66;
  return p;
}

// ---- tools left on a plot that is being cleared -----------------------------------------------------------
function WA_mowerArt() {
  return WA_sprite('mower', 64, 56, 36, 48, function (g) {
    WA_shadow(g, 4, 0.5, 18, 4);
    WA_thick(g, function () { g.beginPath(); g.moveTo(4, -10); g.lineTo(-24, -38); g.moveTo(-29, -35.5); g.lineTo(-20, -41.5); }, '#8b959c', 2.2);
    WA_thick(g, function () { g.beginPath(); g.moveTo(-29, -35.5); g.lineTo(-20, -41.5); }, '#3b3a40', 3);
    WA_rr(g, -6, -17, 26, 12, 4); WA_fillStroke(g, '#d9574a', 1.8);
    g.fillStyle = '#b8402f'; g.fillRect(-4, -9.5, 22, 3); g.fillStyle = '#ee8a7c'; g.fillRect(-2, -15.4, 14, 1.5);
    g.fillStyle = '#fbf1d8'; WA_ell(g, 4, -11.5, 2.6, 2.6); g.fill();
    WA_ell(g, 15, -7.5, 7.5, 7.5); WA_fillStroke(g, '#2f2b30', 1.7); WA_ell(g, 15, -7.5, 3.2, 3.2); WA_fillStroke(g, '#f2c14e', 1.1);
    WA_ell(g, -3, -4.5, 4.5, 4.5); WA_fillStroke(g, '#2f2b30', 1.5); WA_ell(g, -3, -4.5, 1.7, 1.7); g.fillStyle = '#c3cbd0'; g.fill();
    g.strokeStyle = '#9bd678'; g.lineWidth = 1.3; g.beginPath(); WA_tuftAdd(g, 24, 0, 3, 5, 1.4, 3); WA_tuftAdd(g, 27, -2, 2, 4, 1.2, 5); g.stroke();
  });
}
function WA_barrowArt() {
  return WA_sprite('barrow', 72, 52, 34, 44, function (g) {
    WA_shadow(g, 0, 0.5, 26, 4.5);
    WA_thick(g, function () { g.beginPath(); g.moveTo(-8, -14); g.lineTo(-30, -22); }, '#a8743f', 2.4);
    WA_thick(g, function () { g.beginPath(); g.moveTo(-12, -10); g.lineTo(-14, 0); g.moveTo(-2, -10); g.lineTo(0, 0); }, '#4a464e', 1.8);
    // heap of cuttings
    g.beginPath(); g.moveTo(-16, -24); g.quadraticCurveTo(-10, -38, 2, -36); g.quadraticCurveTo(14, -38, 20, -24); g.closePath(); WA_fillStroke(g, '#a9c765', 1.5);
    g.strokeStyle = '#86a84c'; g.lineWidth = 1; g.beginPath(); g.moveTo(-8, -27); g.lineTo(-5, -33); g.moveTo(1, -27); g.lineTo(2, -34); g.moveTo(9, -27); g.lineTo(7, -32); g.stroke();
    g.fillStyle = '#fdfaf0'; WA_ell(g, -2, -31, 1.4, 1.4); g.fill(); g.fillStyle = '#f2c14e'; WA_ell(g, 10, -29, 1.3, 1.3); g.fill();
    g.beginPath(); g.moveTo(-20, -25); g.lineTo(24, -25); g.lineTo(16, -9); g.lineTo(-12, -9); g.closePath(); WA_fillStroke(g, '#3aa89a', 1.8);
    g.fillStyle = '#2c7f75'; g.beginPath(); g.moveTo(-14.5, -13); g.lineTo(18, -13); g.lineTo(16, -9.8); g.lineTo(-12, -9.8); g.closePath(); g.fill();
    g.fillStyle = '#6fd0c2'; g.fillRect(-16, -23.6, 36, 1.4);
    WA_ell(g, 20, -7, 7, 7); WA_fillStroke(g, '#2f2b30', 1.7); WA_ell(g, 20, -7, 2.8, 2.8); WA_fillStroke(g, '#c3cbd0', 1);
  });
}

// ---- the yard fence --------------------------------------------------------------------------------------
var WA_WOOD = { light: '#ecc794', base: '#d9a86c', shade: '#b98248', dark: '#8a5a34' };
function WA_picket(g, cx, top, w, bot, seed) {
  g.beginPath(); g.moveTo(cx - w / 2, bot); g.lineTo(cx - w / 2, top + 4.6); g.lineTo(cx, top); g.lineTo(cx + w / 2, top + 4.6); g.lineTo(cx + w / 2, bot); g.closePath();
  g.fillStyle = WA_WOOD.base; g.fill();
  g.fillStyle = WA_WOOD.shade; g.fillRect(cx + w / 2 - 2.5, top + 4.6, 2.5, bot - top - 4.6);
  g.fillStyle = WA_WOOD.light; g.fillRect(cx - w / 2 + 0.9, top + 5, 1.3, bot - top - 6);
  g.strokeStyle = WA_OUT; g.lineWidth = 1.5; g.stroke();
  g.strokeStyle = 'rgba(138,90,52,0.55)'; g.lineWidth = 0.8;
  var gy = top + 10 + WA_h2(seed, 3) * 8; g.beginPath(); g.moveTo(cx - 0.6, gy); g.lineTo(cx - 0.2, gy + 5 + WA_h2(seed, 4) * 4); g.stroke();
  g.fillStyle = '#6b4526'; g.fillRect(cx - 0.7, bot - 9.2, 1.4, 1.4); g.fillRect(cx - 0.7, bot - 19.8, 1.4, 1.4);
}
function WA_drawPost(g, kind) {
  var w = kind === 2 ? 10.5 : kind === 1 ? 9 : 7, h = kind === 2 ? 46 : kind === 1 ? 36 : 32.5;
  g.fillStyle = 'rgba(40,26,12,0.22)'; WA_ell(g, 0.5, 0, w * 0.85, 2.8); g.fill();
  g.beginPath(); g.rect(-w / 2, -h, w, h); g.fillStyle = '#c08a50'; g.fill();
  g.fillStyle = '#9a6a3a'; g.fillRect(w / 2 - 3, -h, 3, h); g.fillStyle = '#dcae74'; g.fillRect(-w / 2 + 1, -h + 1, 1.4, h - 2);
  g.strokeStyle = WA_OUT; g.lineWidth = 1.6; g.stroke();
  g.strokeStyle = 'rgba(110,70,38,0.6)'; g.lineWidth = 0.8; WA_line(g, -0.5, -h * 0.7, 0, -h * 0.45); WA_line(g, 0.8, -h * 0.3, 0.4, -h * 0.12);
  if (kind === 0) {
    g.beginPath(); g.moveTo(-w / 2 - 1.2, -h); g.lineTo(0, -h - 5); g.lineTo(w / 2 + 1.2, -h); g.closePath(); WA_fillStroke(g, '#b07c46', 1.5);
    g.fillStyle = '#dcae74'; g.beginPath(); g.moveTo(-w / 2 + 0.4, -h - 0.6); g.lineTo(0, -h - 3.8); g.lineTo(-0.2, -h - 0.6); g.closePath(); g.fill();
  } else {
    WA_rr(g, -w / 2 - 1.6, -h - 3.2, w + 3.2, 4.2, 1.2); WA_fillStroke(g, '#b07c46', 1.5);
    g.fillStyle = '#dcae74'; g.fillRect(-w / 2 - 0.4, -h - 2.4, w * 0.6, 1);
    var r = kind === 2 ? 4.6 : 3.6;
    WA_ell(g, 0, -h - 3 - r * 0.8, r, r); WA_fillStroke(g, '#c08a50', 1.5);
    g.fillStyle = '#ecc794'; WA_ell(g, -r * 0.3, -h - 3 - r * 1.1, r * 0.35, r * 0.28); g.fill();
    if (kind === 2) {
      WA_rr(g, -4, -h + 8, 8, 9, 2); WA_fillStroke(g, '#fbf1d8', 1.1);
      g.fillStyle = '#d9574a'; WA_pawPrint(g, 0, -h + 13.4, 0.82, 0);
      WA_rr(g, -w / 2 - 1, -5, w + 2, 5, 1); WA_fillStroke(g, '#b07c46', 1.4);
    }
  }
}
// one tile of pickets + rails, drawn from x0 (west end) in the current sprite
function WA_drawFenceTile(g, x0, seed) {
  var variant = Math.floor(WA_h2(seed, 91) * 3);
  g.fillStyle = 'rgba(40,26,12,0.2)'; WA_rr(g, x0, -2.5, 48, 5.5, 2.5); g.fill();
  [-21.5, -11].forEach(function (y) { g.beginPath(); g.rect(x0 - 1, y, 50, 3.8); WA_fillStroke(g, WA_WOOD.shade, 1.3); g.fillStyle = '#cf9c60'; g.fillRect(x0 - 1, y + 0.7, 50, 1); });
  for (var i = 0; i < 3; i++) {
    var j = WA_h2(seed * 7 + i, 31);
    WA_picket(g, x0 + 12 + i * 12, -28.5 - (variant === 2 && i === 1 ? -2.5 : j * 1.6), 8.4, -1.2 - j * 0.8, seed * 11 + i);
  }
  g.strokeStyle = '#4f9443'; g.lineWidth = 1.2; g.beginPath();
  if (variant === 1) WA_tuftAdd(g, x0 + 18, 0.5, 3, 5.5, 1.2, 3);
  if (variant === 0) WA_tuftAdd(g, x0 + 31, 0.5, 3, 5, 1.2, 5);
  g.stroke();
}
// a whole east-west run of n tiles in one bitmap (posts included); ends: 1 = big post, 0 = none
function WA_fenceRunArt(n, endW, endE) {
  return WA_sprite('fenceRun' + n + '-' + endW + endE, n * TILE + 20, 50, 10, 44, function (g) {
    var i;
    for (i = 0; i < n; i++) WA_drawFenceTile(g, i * TILE, n * 13 + i);
    for (i = 0; i <= n; i++) {
      var end = i === 0 ? endW : i === n ? endE : -1;
      if (end === 0) continue;
      g.save(); g.translate(i * TILE, 0); WA_drawPost(g, end === 1 ? 1 : 0); g.restore();
    }
  });
}
// kind: 0 line post, 1 corner / end post, 2 gate post
function WA_fencePostArt(kind) {
  return WA_sprite('fencePost' + kind, 18, kind === 2 ? 64 : kind === 1 ? 52 : 44, 9, kind === 2 ? 60 : kind === 1 ? 48 : 40, function (g) { WA_drawPost(g, kind); });
}
// picket seen edge-on (fence running north-south)
function WA_drawPicketEdge(g, y, seed) {
  var top = y - 23.5 - WA_h2(seed, 77) * 1.6, w = 5;
  g.fillStyle = 'rgba(40,26,12,0.2)'; WA_ell(g, 0.5, y, 4.2, 1.9); g.fill();
  g.beginPath(); g.moveTo(-w / 2, y - 0.8); g.lineTo(-w / 2, top + 3.4); g.lineTo(0, top); g.lineTo(w / 2, top + 3.4); g.lineTo(w / 2, y - 0.8); g.closePath();
  g.fillStyle = '#cf9c60'; g.fill();
  g.fillStyle = WA_WOOD.shade; g.fillRect(w / 2 - 1.9, top + 3.4, 1.9, y - top - 4.4); g.fillStyle = WA_WOOD.light; g.fillRect(-w / 2 + 0.7, top + 3.8, 1.1, y - top - 7);
  g.strokeStyle = WA_OUT; g.lineWidth = 1.4; g.stroke();
}
// one tile of a north-south run (4 pickets seen edge-on), optionally with the line post at its north end
function WA_fenceVArt(withPost, variant) {
  return WA_sprite('fenceV' + (withPost ? 'p' : '') + variant, 16, 90, 8, 40, function (g) {
    if (withPost) WA_drawPost(g, 0);
    for (var i = 0; i < 4; i++) WA_drawPicketEdge(g, 6 + i * 12, variant * 5 + i);
  });
}
function WA_gateArt() {
  return WA_sprite('gardengate', 60, 52, 6, 44, function (g) {
    g.fillStyle = 'rgba(40,26,12,0.2)'; WA_rr(g, 0, -2.5, 48, 5.5, 2.5); g.fill();
    g.beginPath(); g.rect(1, -21, 46, 3.6); WA_fillStroke(g, WA_WOOD.shade, 1.3); g.beginPath(); g.rect(1, -9.5, 46, 3.6); WA_fillStroke(g, WA_WOOD.shade, 1.3);
    for (var i = 0; i < 5; i++) WA_picket(g, 6.5 + i * 8.75, -27 - Math.sin((i + 0.5) / 5 * Math.PI) * 9, 7.4, -2.5, i + 40);
    WA_thick(g, function () { g.beginPath(); g.moveTo(4, -8); g.lineTo(44, -19.5); }, WA_WOOD.shade, 2.2);
    WA_ell(g, 37, -15, 2.6, 2.6); g.strokeStyle = WA_OUT; g.lineWidth = 2.6; g.stroke(); g.strokeStyle = '#c3cbd0'; g.lineWidth = 1.1; g.stroke();
    g.fillStyle = '#4a464e'; g.fillRect(0.4, -22.5, 4, 2); g.fillRect(0.4, -11, 4, 2);
  });
}

function WA_pFence(L, E) {
  var Y = MAP.yard, tx, ty, D = MAP.shop.yardDoor;
  var hE = {}, vE = {};   // "vx,vy" of the west / north end of each fenced tile edge
  function isDoorEdge(tx, ty) { return tx === D.x + 1 && ty >= D.y0 && ty <= D.y1; }
  for (ty = Y.y0; ty <= Y.y1; ty++) for (tx = Y.x0; tx <= Y.x1; tx++) {
    if (!E.owned(tx, ty)) continue;
    if (!E.owned(tx, ty - 1)) hE[tx + ',' + ty] = 'n';
    if (!E.owned(tx, ty + 1)) hE[tx + ',' + (ty + 1)] = 's';
    if (!E.owned(tx - 1, ty) && !isDoorEdge(tx, ty)) vE[tx + ',' + ty] = 'w';
    if (!E.owned(tx + 1, ty)) vE[(tx + 1) + ',' + ty] = 'e';
  }
  function hAt(vx, vy) { return hE[vx + ',' + vy] || hE[(vx - 1) + ',' + vy]; }          // an east-west edge touches this vertex
  function vAt(vx, vy) { return vE[vx + ',' + vy] || vE[vx + ',' + (vy - 1)]; }
  // east-west runs: one bitmap per run (same row, same side, contiguous)
  Object.keys(hE).forEach(function (k) {
    var q = k.split(','), ex = +q[0], ey = +q[1], side = hE[k];
    if (hE[(ex - 1) + ',' + ey] === side) return;                 // not the west end of its run
    var n = 1; while (hE[(ex + n) + ',' + ey] === side) n++;
    // a run ends with a big post; where another run of the other side continues straight on, that run draws the shared post
    var A = WA_fenceRunArt(n, 1, hE[(ex + n) + ',' + ey] ? 0 : 1), x = ex * TILE, y = ey * TILE;
    // north edge of the lawn: behind anyone standing in that tile; south edge: in front
    L.push(WA_prop('fence-run', x - 10, y - 44, n * TILE + 20, 50, side === 'n' ? y - 1 : y + 1.5, function (c) { WA_put(c, A, x, y); }));
  });
  // north-south runs: one small piece per tile so characters sort sensibly against them
  Object.keys(vE).forEach(function (k) {
    var q = k.split(','), ex = +q[0], ey = +q[1], x = ex * TILE, y = ey * TILE, v = (ex * 5 + ey * 3) % 3;
    var startsRun = !vE[ex + ',' + (ey - 1)], postHere = !startsRun && !hAt(ex, ey);
    var A = WA_fenceVArt(postHere, v);
    L.push(WA_prop('fence-v', x - 8, y - 40, 16, 90, y + 30, function (c) { WA_put(c, A, x, y); }));
    // posts at the two ends of a north-south run, unless an east-west run already put one there
    [[ey, startsRun], [ey + 1, !vE[ex + ',' + (ey + 1)]]].forEach(function (e) {
      if (!e[1] || hAt(ex, e[0])) return;
      var gate = ex === D.x + 1 && (e[0] === D.y0 || e[0] === D.y1 + 1), P = WA_fencePostArt(gate ? 2 : 1), py = e[0] * TILE;
      L.push(WA_prop(gate ? 'fence-gatepost' : 'fence-post', x - 9, py - 60, 18, 64, py + 0.5, function (c) { WA_put(c, P, x, py); }));
    });
  });
}

// ==========================================================================================================
// PROPS - placement
// ==========================================================================================================
function WA_exitPathX(y) {
  var pl = WA_paths().exit, best = pl[0][0], bd = 1e9;
  for (var i = 0; i < pl.length; i++) { var d = Math.abs(pl[i][1] - y); if (d < bd) { bd = d; best = pl[i][0]; } }
  return best;
}
var WA_FOREST = null;
// every tree of the woodland: { x, y, sp, v, baked } - baked ones are painted into the ground (they can never overlap a character)
function WA_forest() {
  if (WA_FOREST) return WA_FOREST;
  var out = [], rows = [38, 90, 144, 198, 252], r, gx, step = 58;
  function pick(x, y, h) {
    var n = WA_noise(x / 380, 1.7);
    if (n < 0.36) return h < 0.72 ? 'pine' : h < 0.88 ? 'oak' : 'birch';
    if (n < 0.62) return h < 0.58 ? 'oak' : h < 0.82 ? 'birch' : h < 0.93 ? 'pine' : 'blossom';
    return h < 0.5 ? 'birch' : h < 0.82 ? 'oak' : 'pine';
  }
  for (r = 0; r < rows.length; r++) for (gx = -1; gx * step < WA_WW + 60; gx++) {
    var x = gx * step + (r % 2 ? step / 2 : 0) + (WA_h2(gx * 3 + 1, r * 7) - 0.5) * 34, y = rows[r] + (WA_h2(gx * 5, r * 11 + 3) - 0.5) * (r === 4 ? 30 : 24);
    var inPark = x < WA_YX0 - 30;
    if (inPark && (r > 2 || WA_forestness(x, y) < (r === 2 ? 0.62 : 0.3))) continue;
    if (!inPark && x < WA_YX0 + 40 && r === 4) continue;
    if (Math.abs(x - WA_exitPathX(y)) < 44 && x < WA_YX0) continue;
    var h = WA_h2(gx * 13 + 7, r * 17 + 1);
    if (r === 4 && h < 0.3) continue;
    if (r === 3 && h < 0.12) continue;
    // only every third tree of the front row is a live (swaying) prop; the rest of the wood is part of the ground picture
    out.push({ x: Math.round(x), y: Math.round(y), sp: pick(x, y, WA_h2(gx * 7 + 2, r * 3 + 9)), v: Math.floor(WA_h2(gx + 40, r + 60) * 3), baked: r < 4 || gx % 3 !== 1 });
  }
  // east edge: two staggered columns, the outer one baked
  for (var k = 0; k < 2; k++) for (var gy = 0; gy < 20; gy++) {
    var ex = (k ? 2858 : 2812) + (WA_h2(gy, 31 + k) - 0.5) * (k ? 24 : 14), ey = 322 + gy * 62 + (k ? 30 : 0) + (WA_h2(gy * 3, 37 + k) - 0.5) * 26;
    if (ey > WA_YY1 - 10) continue;
    var L = WA_LAKE, a = (ex - L.x) / (L.rx + 46), b = (ey - L.y) / (L.ry + 50);
    if (a * a + b * b < 1) continue;
    var esp = pick(ex + 900, ey, WA_h2(gy * 7, 41 + k)), ev = Math.floor(WA_h2(gy, 43 + k) * 3);
    if (!k && esp === 'oak' && ev === 1) ev = 2;             // no extra-wide crowns right next to the yard
    out.push({ x: Math.round(ex), y: Math.round(ey), sp: esp, v: ev, baked: k === 1 });
  }
  out.sort(function (p, q) { return p.y - q.y; });
  return (WA_FOREST = out);
}
function WA_gBakedTrees(c, E) {
  var f = WA_forest(), i, B = [];
  for (i = 0; i < f.length; i++) if (f[i].baked && E.hit(f[i].x - 120, f[i].y - 250, f[i].x + 120, f[i].y + 16)) WA_drawTreeStatic(c, f[i].x, f[i].y, f[i].sp, f[i].v);
  // bushes, rocks, logs and stumps on the wild plots
  WA_pPlots(null, E, B);
  B.sort(function (a, b) { return a[2] - b[2]; });
  for (i = 0; i < B.length; i++) if (E.hit(B[i][1] - 50, B[i][2] - 64, B[i][1] + 50, B[i][2] + 12)) WA_stamp(c, B[i][0], B[i][1], B[i][2]);
}

var WA_PERM = null;
function WA_permanentProps() {
  if (WA_PERM) return WA_PERM;
  var L = [], i, x, y, S = WA_ST, P = WA_POND, K = WA_LAKE;
  // ---- woodland (front rows) ----
  WA_forest().forEach(function (f) { if (!f.baked) L.push(WA_mkTree(f.x, f.y, f.sp, f.v)); });
  [[1140, 262, 0], [1980, 270, 1], [2440, 258, 0], [1560, 266, 0]].forEach(function (q) { L.push(WA_mkLog(q[0], q[1], q[2])); });
  [[1700, 268, 1], [2250, 272, 0], [990, 270, 1]].forEach(function (q) { L.push(WA_mkStump(q[0], q[1], q[2])); });
  [[1330, 272, 0], [2600, 266, 1], [1840, 276, 2], [940, 262, 2]].forEach(function (q) { L.push(WA_mkRock(q[0], q[1], q[2])); });
  for (i = 0; i < 16; i++) { x = 900 + i * 118 + WA_h2(i, 401) * 60; L.push(WA_mkBush(x, 262 + WA_h2(i, 402) * 18, [0, 1, 4, 0, 2][i % 5], i % 3)); }

  // ---- park ----
  [[52, 236, 'birch', 0], [112, 204, 'birch', 2], [40, 650, 'oak', 1], [814, 268, 'blossom', 1], [350, 690, 'blossom', 0], [822, 708, 'birch', 2], [704, 192, 'pine', 0], [770, 176, 'pine', 2], [586, 706, 'round', 1]]
    .forEach(function (q) { L.push(WA_mkTree(q[0], q[1], q[2], q[3])); });
  L.push(WA_mkBench(330, 226));
  L.push(WA_mkLamp(396, 228, 1, false));
  L.push(WA_mkLamp(626, 276, -1, false));
  [-2.85, -2.45, -2.05, -1.25, -0.85, -0.3, 0.35, 2.55, 3.0, 1.15].forEach(function (a, k) {
    L.push(WA_mkReed(P.x + Math.cos(a) * (P.rx + 1) + (WA_h2(k, 411) - 0.5) * 8, P.y + Math.sin(a) * (P.ry + 2) + 3, k % 3));
    if (k % 2 === 0) L.push(WA_mkReed(P.x + Math.cos(a + 0.09) * (P.rx + 8), P.y + Math.sin(a + 0.09) * (P.ry + 7) + 4, (k + 1) % 3));
  });
  L.push(WA_mkShimmer(P, 16));
  L.push(WA_mkDuck(P.x - 24, P.y - 14, 74, 26, 0.22, 0.4, 0, 1));
  [0.34, 0.6, 0.84].forEach(function (lag, k) { L.push(WA_mkDuck(P.x - 24, P.y - 14 + (k % 2 ? 3 : -2), 74 - k * 2, 27, 0.22, 0.4 - lag, 2, 0.58)); });
  L.push(WA_mkDuck(P.x + 62, P.y + 12, 38, 15, -0.31, 2.2, 1, 1));
  L.push(WA_mkRock(P.x + 172, P.y - 74, 0)); L.push(WA_mkRock(P.x - 190, P.y + 60, 2));
  L.push(WA_mkSprite('basket', WA_basketArt(), WA_PICNIC.x + 26, WA_PICNIC.y - 8));
  [[150, 604, 2, 0], [556, 336, 3, 0], [792, 428, 1, 1], [640, 140, 0, 1], [24, 470, 0, 0], [128, 706, 3, 1], [430, 250, 4, 0], [540, 452, 2, 2], [812, 338, 0, 2], [270, 214, 1, 2], [608, 610, 4, 1], [18, 320, 2, 1]]
    .forEach(function (q) { L.push(WA_mkBush(q[0], q[1], q[2], q[3])); });

  // ---- west garden ----
  for (i = 0; i < 10; i++) { y = 770 + i * 88; L.push(WA_mkBush(20 + WA_h2(i, 421) * 8, y + WA_h2(i, 422) * 20, [0, 2, 1, 3, 0][i % 5], i % 3)); }
  [[26, 960, 'birch', 1], [22, 1310, 'blossom', 2], [112, 790, 'blossom', 0], [24, 1500, 'round', 0]].forEach(function (q) { L.push(WA_mkTree(q[0], q[1], q[2], q[3])); });
  [[126, 1002, 3, 0], [126, 1298, 3, 1], [126, 1584, 2, 2]].forEach(function (q) { L.push(WA_mkBush(q[0], q[1], q[2], q[3])); });
  // little garden gate + fence where the gravel path meets the sidewalk
  var gy = WA_SWY - 3, gateA = WA_gateArt();
  var gfA = WA_fenceRunArt(1, 0, 1), gfB = WA_fenceRunArt(1, 1, 0);
  L.push(WA_prop('gardenfence', -10, gy - 44, 68, 50, gy, function (c) { WA_put(c, gfA, 0, gy); }, 24));
  L.push(WA_prop('gardenfence', 86, gy - 44, 68, 50, gy, function (c) { WA_put(c, gfB, 96, gy); }, 120));
  L.push(WA_prop('gardengate', 42, gy - 44, 60, 52, gy - 0.5, function (c) { WA_put(c, gateA, 48, gy); }, 72));

  // ---- verge: hedge, little trees, bike rack, bus stop ----
  var trees = [1224, 1608, 2376, 2760], cuts = [WA_YX0 + 6];
  trees.forEach(function (t) { cuts.push(t - 15, t + 15); });
  cuts.push(S.bus.x0 - 4, S.bus.x1 + 4, WA_WW + 12);
  cuts.sort(function (a, b) { return a - b; });
  for (i = 0; i + 1 < cuts.length; i += 2) {
    x = cuts[i];
    while (cuts[i + 1] - x >= 40) {
      var left = cuts[i + 1] - x, len = left > 264 ? (WA_h2(Math.round(x), 431) < 0.5 ? 144 : 120) : left > 168 ? Math.round(left / 2 / 12) * 12 : left;
      len = Math.round(len);
      L.push(WA_mkHedge(x, S.hedgeY, len, Math.floor(WA_h2(Math.round(x), 433) * 3)));
      x += len;
    }
  }
  trees.forEach(function (t, k) { L.push(WA_mkTree(t, S.hedgeY + 1, 'round', k % 3)); });
  L.push(WA_mkSprite('bikerack', WA_bikeRackArt(), (S.bike.x0 + S.bike.x1) / 2, WA_SWY - 8));
  L.push(WA_mkShelter((S.bus.x0 + S.bus.x1) / 2, WA_SWY - 7));

  // ---- kerb-side: lamps, mailbox, sandwich board, bus stop sign ----
  S.lamps.forEach(function (lx, k) { L.push(WA_mkLamp(lx, WA_RY + 6, k % 2 ? 1 : -1, true)); });
  L.push(WA_mkSprite('mailbox', WA_mailboxArt(), WA_DOORX1 + 36, WA_RY + 8));
  L.push(WA_mkSprite('aboard', WA_boardArt(), WA_DOORX0 - 40, WA_RY + 9));
  L.push(WA_mkSprite('bussign', WA_busSignArt(), S.bus.x1 + 14, WA_RY + 7));

  // ---- parked vehicles (they face west: the near lane drives that way) ----
  L.push(WA_mkSprite('van', WA_carArt('van', '#fbf1d8', '#e3d3ae', -1), 774, WA_RY + 71));
  L.push(WA_mkSprite('car', WA_carArt('hatch', '#d9574a', '#b8402f', -1), 1246, WA_RY + 70));
  L.push(WA_mkSprite('car', WA_carArt('bug', '#f2c14e', '#d9a136', -1), 2388, WA_RY + 70));

  // ---- east edge: lake shore ----
  [-2.5, -2.75, -3.0, 3.05, 2.8, 2.55, -2.25, 2.3].forEach(function (a, k) {
    L.push(WA_mkReed(K.x + Math.cos(a) * (K.rx + 2), K.y + Math.sin(a) * (K.ry + 2), k % 3));
    if (k % 2) L.push(WA_mkReed(K.x + Math.cos(a + 0.03) * (K.rx + 10), K.y + Math.sin(a + 0.03) * (K.ry + 6) + 5, (k + 2) % 3));
  });
  L.push(WA_mkShimmer({ x: K.x - 50, y: K.y, rx: 74, ry: K.ry * 0.8, seed: 5 }, 12));
  L.push(WA_mkBoat(2826, 930));
  L.push(WA_mkDuck(2836, 760, 22, 30, 0.27, 1.1, 0, 1));
  [[2756, 612, 0, 0], [2752, 1166, 2, 1], [2760, 1240, 1, 0], [2758, 540, 4, 2]].forEach(function (q) { L.push(WA_mkBush(q[0], q[1], q[2], q[3])); });
  L.push(WA_mkRock(2764, 1100, 0));
  return (WA_PERM = L);
}

// scenery standing on land that is not owned yet (it disappears once the plot is cleared).
// L receives the live props (sign, trees, tools); B (optional) the small static things that are painted into the ground:
// [sprite, x, y]. The spacing rules guarantee a baked thing never has to be drawn in front of a live tree.
function WA_pPlots(L, E, B) {
  L = L || []; B = B || [];
  PLOTS.forEach(function (pl, pi) {
    var cx0 = pl.x * TILE, cy0 = pl.y * TILE, pw = pl.w * TILE, ph = pl.h * TILE, tcx = pl.x + Math.floor(pl.w / 2), tcy = pl.y + Math.floor(pl.h / 2);
    if (E.owned(tcx, tcy)) return;
    var pending = E.pending(tcx, tcy), rnd = WA_rng(pi * 7717 + 13), sx = cx0 + pw / 2, sy = cy0 + ph / 2 + 10, placed = [[sx + 10, sy - 10, 74]];
    L.push(WA_mkSaleSign(sx, sy, pending, pl.id));
    if (pending) {
      placed.push([sx - 96, sy + 44, 40], [sx + 84, sy - 52, 40]);
      L.push(WA_mkSprite('mower', WA_mowerArt(), sx - 96, sy + 44));
      L.push(WA_mkSprite('barrow', WA_barrowArt(), sx + 84, sy - 52));
    }
    // top: extra room kept free at the north side (tall things must not hang over a neighbouring plot, which may be owned)
    function spot(margin, rad, top) {
      for (var t = 0; t < 30; t++) {
        var x = cx0 + margin + rnd() * (pw - margin * 2), y = cy0 + margin + 14 + (top || 0) + rnd() * (ph - margin * 2 - 14 - (top || 0)), ok = true;
        if (WA_forestness(x, y) > 0.7) continue;
        for (var j = 0; j < placed.length; j++) if (Math.hypot(placed[j][0] - x, (placed[j][1] - y) * 1.4) < placed[j][2] + rad) { ok = false; break; }
        if (ok) { placed.push([x, y, rad]); return [Math.round(x), Math.round(y)]; }
      }
      return null;
    }
    var plan = pl.id === 'north' ? { birch: 3, oak: 1, bush: 8, rock: 4, stump: 3, log: 2 }
      : pl.id === 'east' ? { blossom: 2, birch: 1, bush: 8, rock: 3, stump: 1, log: 1 }
      : pl.id === 'northeast' ? { apple: 7, bush: 5, rock: 2, stump: 2, log: 1 }
      : pl.id === 'far' ? { oak: 2, birch: 2, pine: 1, bush: 11, rock: 6, stump: 2, log: 2, reed: 5 }
      : { bush: 6, rock: 3, stump: 1 };
    var keep = pending ? 0.45 : 1, q, n, k;
    ['apple', 'oak', 'birch', 'pine', 'blossom'].forEach(function (sp) {
      n = plan[sp] || 0;
      for (k = 0; k < n; k++) { q = spot(90, sp === 'apple' ? 60 : 70, pl.id === 'east' ? 130 : 0); var v = Math.floor(rnd() * 3); if (q && rnd() < keep) L.push(WA_mkTree(q[0], q[1], sp, sp === 'oak' ? (v === 1 ? 2 : v) : v)); }
    });
    for (k = 0; k < (plan.log || 0); k++) { q = spot(50, 44); if (q && rnd() < keep) B.push([WA_logArt(k % 2), q[0], q[1]]); }
    for (k = 0; k < (plan.rock || 0); k++) { q = spot(34, 30); if (q) B.push([WA_rockArt(Math.floor(rnd() * 3)), q[0], q[1]]); }
    for (k = 0; k < (plan.stump || 0); k++) { q = spot(34, 28); if (q) B.push([WA_stumpArt(k % 2), q[0], q[1]]); }
    for (k = 0; k < (plan.bush || 0); k++) { q = spot(40, 34); var bk = pl.id === 'east' ? [2, 3, 1, 0][k % 4] : [0, 1, 4, 2, 0][k % 5], bv = Math.floor(rnd() * 3); if (q && rnd() < keep) B.push([WA_bushArt(bk, bv), q[0], q[1]]); }
    for (k = 0; k < (plan.reed || 0); k++) { q = spot(30, 20); if (q && q[0] > cx0 + pw * 0.45 && rnd() < keep) B.push([WA_reedArt(k % 3, 2), q[0], q[1]]); }
  });
}

// ==========================================================================================================
// PUBLIC API
// ==========================================================================================================
function buildWorldProps(env) {
  var E = WA_env(env), L = WA_permanentProps().slice();
  WA_pPlots(L, E);
  WA_pFence(L, E);
  L.sort(function (a, b) { return a.sortY - b.sortY; });
  return L;
}
function worldLights(env) {
  var out = [];
  WA_permanentProps().forEach(function (p) {
    if (p.kind === 'lamp') out.push({ x: p.lightX, y: p.lightY, r: 190, color: '#ffd98a' });
    else if (p.kind === 'shelter') out.push({ x: p.lightX, y: p.lightY, r: 130, color: '#ffe6a8' });
  });
  return out;
}
function worldAmbientSpots() {
  var S = WA_ST, M = WA_MEADOW, P = WA_POND, K = WA_LAKE, birds = [], leaves = [];
  WA_permanentProps().forEach(function (p) {
    if (p.kind === 'tree') { leaves.push({ x: p.topX, y: p.topY }); if (p.species !== 'round' && WA_h2(p.topX, p.topY) < 0.3) birds.push({ x: p.topX, y: p.topY - 22 }); }
    else if (p.kind === 'lamp') birds.push({ x: p.lightX, y: p.lightY - 19 });
    else if (p.kind === 'bench') birds.push({ x: p.x + 30, y: p.y + 8 });
    else if (p.kind === 'shelter') birds.push({ x: p.x + 50, y: p.y + 14 });
    else if (p.kind === 'mailbox') birds.push({ x: p.x + 24, y: p.y + 12 });
    else if (p.kind === 'hedge' && WA_h2(p.x, 7) < 0.4) birds.push({ x: p.x + p.w * 0.4, y: p.y + 12 });
  });
  WA_forest().forEach(function (f) { if (f.baked && f.y > 120 && WA_h2(f.x, f.y) < 0.35) leaves.push({ x: f.x, y: f.y - 120 }); });
  var butterflies = [
    { x: M.x - M.rx, y: M.y - M.ry, w: M.rx * 2, h: M.ry * 2 },
    { x: WA_YX0 + 10, y: S.bedY0 - 28, w: WA_WW - WA_YX0 - 20, h: 52 },
    { x: WA_SX0 - 44, y: 880, w: 44, h: 720 },
    { x: 150, y: 600, w: 380, h: 90 }
  ];
  PLOTS.forEach(function (p) { if (p.id !== 'base') butterflies.push({ x: p.x * TILE + 30, y: p.y * TILE + 30, w: p.w * TILE - 60, h: p.h * TILE - 60, plot: p.id }); });
  return {
    butterflies: butterflies,
    birds: birds,
    fireflies: [
      { x: P.x - P.rx - 40, y: P.y - P.ry - 40, w: P.rx * 2 + 80, h: P.ry * 2 + 70 },
      { x: 0, y: 150, w: WA_WW, h: 130 },
      { x: WA_YX1, y: 560, w: WA_WW - WA_YX1, h: 640 },
      { x: M.x - M.rx, y: M.y - M.ry, w: M.rx * 2, h: M.ry * 2 }
    ],
    leaves: leaves
  };
}
