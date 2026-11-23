'use strict';
/* =====================================================================================================
   Paws & Play — decoration art (the yard decor players build)

   Registers into the shared OBJECT_ART registry (one entry per CATALOG id):
       floor :  path, flowers
       solid :  hydrant, bush, bench, lamp, tree, birdbath, topiary, picnic, statue, pond, fountain, gazebo

   OBJECT_ART[type] = {
     draw(c, o, t, env)   c: 2D context with the camera transform applied
                          o: { type, x, y, w, h (tiles), id }   t: seconds   env: { night 0..1, wind -1..1 }
     bounds               { x0, y0, x1, y1 }: everything the art can ever cover (animated visitors, glows and
                          falling leaves included), in px relative to the footprint's top-left corner at 48px
                          tiles — handy for culling.  iconBounds (optional) is the tight box of the object itself.
     light(o, env)        lamp, gazebo, statue only -> { x, y, r, color } in world px
   }
   drawDecorIcon(c, type, x, y, size)   any registered object fitted into a size x size box at (x, y)

   How it draws: art is authored as vector paths for 48px tiles, with the footprint's top-left corner as
   the local origin.  Nothing heavy is drawn per frame — each object is a few bitmap layers baked on first
   use at the exact scale of the context (see "baked layer cache" below) and blitted on whole device pixels;
   animation comes from pre-baked frames, small sprite swaps, whole-pixel layer offsets and a handful of
   tiny live strokes.  All private names are prefixed OB_.
   ===================================================================================================== */
var OBJECT_ART = window.OBJECT_ART || (window.OBJECT_ART = {});

var OB_OUT = '#3b2a20';                 // warm dark outline
var OB_SHADOW = 'rgba(40,26,12,0.22)';  // ground contact shadow
var OB_TAU = Math.PI * 2;
var OB_NOCACHE = false;                 // set true to force live vector drawing (debugging)

function OB_tile() { return (typeof TILE === 'number' && TILE > 0) ? TILE : 48; }
function OB_clamp(v, a, b) { v = +v; if (!(v === v)) return a; return v < a ? a : v > b ? b : v; }
function OB_lerp(a, b, u) { return a + (b - a) * u; }
function OB_ease(u) { u = u < 0 ? 0 : u > 1 ? 1 : u; return u * u * (3 - 2 * u); }
function OB_fract(v) { return v - Math.floor(v); }

// deterministic hashes / random streams
function OB_h(a, b, k) {
  var n = Math.sin((a | 0) * 127.1 + (b | 0) * 311.7 + (k | 0) * 74.7) * 43758.5453;
  return n - Math.floor(n);
}
function OB_rng(seed) {
  var s = (seed | 0) + 0x6D2B79F5 | 0;
  return function () {
    s = s + 0x6D2B79F5 | 0;
    var q = Math.imul(s ^ s >>> 15, 1 | s);
    q = q + Math.imul(q ^ q >>> 7, 61 | q) ^ q;
    return ((q ^ q >>> 14) >>> 0) / 4294967296;
  };
}

// ---- tiny path helpers -------------------------------------------------------------------------------
function OB_ell(c, x, y, rx, ry, rot) { c.beginPath(); c.ellipse(x, y, Math.max(0.01, rx), Math.max(0.01, ry), rot || 0, 0, OB_TAU); }
function OB_rr(c, x, y, w, h, r) {
  r = Math.min(r || 0, w / 2, h / 2);
  c.beginPath();
  c.moveTo(x + r, y); c.lineTo(x + w - r, y); c.quadraticCurveTo(x + w, y, x + w, y + r);
  c.lineTo(x + w, y + h - r); c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  c.lineTo(x + r, y + h); c.quadraticCurveTo(x, y + h, x, y + h - r);
  c.lineTo(x, y + r); c.quadraticCurveTo(x, y, x + r, y); c.closePath();
}
function OB_poly(c, pts, open) {
  c.beginPath(); c.moveTo(pts[0], pts[1]);
  for (var i = 2; i < pts.length; i += 2) c.lineTo(pts[i], pts[i + 1]);
  if (!open) c.closePath();
}
function OB_f(c, col) { c.fillStyle = col; c.fill(); }
function OB_s(c, col, w) { c.strokeStyle = col || OB_OUT; c.lineWidth = w || 1.8; c.stroke(); }
function OB_fo(c, col, w) { c.fillStyle = col; c.fill(); c.strokeStyle = OB_OUT; c.lineWidth = w || 1.8; c.stroke(); }
function OB_line(c, x1, y1, x2, y2, col, w) { c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.strokeStyle = col; c.lineWidth = w || 1; c.stroke(); }
function OB_dot(c, x, y, r, col) { c.beginPath(); c.arc(x, y, r, 0, OB_TAU); c.fillStyle = col; c.fill(); }
function OB_shadow(c, x, y, rx, ry) { OB_ell(c, x, y, rx, ry); c.fillStyle = OB_SHADOW; c.fill(); }

// smooth closed pebble / blob outline through jittered points
function OB_blob(c, cx, cy, rx, ry, seed, n, jit) {
  var r = OB_rng(seed), pts = [], i, a, k;
  n = n || 7; jit = jit == null ? 0.16 : jit;
  var a0 = r() * OB_TAU;
  for (i = 0; i < n; i++) {
    a = a0 + (i + (r() - 0.5) * 0.5) / n * OB_TAU; k = 1 - jit + r() * jit * 2;
    pts.push(cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k);
  }
  OB_smooth(c, pts);
}
function OB_smooth(c, pts) {       // closed quadratic spline through the midpoints of pts
  var n = pts.length / 2, i, x0, y0, x1, y1;
  c.beginPath();
  c.moveTo((pts[n * 2 - 2] + pts[0]) / 2, (pts[n * 2 - 1] + pts[1]) / 2);
  for (i = 0; i < n; i++) {
    x0 = pts[i * 2]; y0 = pts[i * 2 + 1]; x1 = pts[(i + 1) % n * 2]; y1 = pts[(i + 1) % n * 2 + 1];
    c.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
  }
  c.closePath();
}
// filled + shaded + outlined shape: pathFn(c) builds the path; shadeFn draws tones clipped inside it
function OB_shape(c, pathFn, fill, shadeFn, ow, oc) {
  pathFn(c); c.fillStyle = fill; c.fill();
  if (shadeFn) { c.save(); c.clip(); shadeFn(c); c.restore(); pathFn(c); }
  if (ow !== 0) { c.strokeStyle = oc || OB_OUT; c.lineWidth = ow || 1.8; c.stroke(); }
}
// clip to the current path, run fn, un-clip (note: fn may replace the current path)
function OB_in(c, fn) { c.save(); c.clip(); fn(); c.restore(); }

// union-of-ellipses silhouette (foliage, hedges): outline stroked once around the union, flat fill inside
// parts: [x, y, rx, ry?, rot?] ...
function OB_unionPath(c, parts) {
  c.beginPath();
  for (var i = 0; i < parts.length; i++) {
    var p = parts[i], rx = p[2], ry = p[3] == null ? p[2] : p[3];
    c.moveTo(p[0] + rx * Math.cos(p[4] || 0), p[1] + rx * Math.sin(p[4] || 0));
    c.ellipse(p[0], p[1], rx, ry, p[4] || 0, 0, OB_TAU);
  }
}
function OB_union(c, parts, fill, ow, oc) {
  OB_unionPath(c, parts);
  c.strokeStyle = oc || OB_OUT; c.lineWidth = (ow || 1.8) * 2; c.stroke();
  c.fillStyle = fill; c.fill();
}
// foliage volume: dark lower-right crescent, lit top-left cap per lump, leafy tick marks
function OB_foliage(c, parts, cols, seed, opt) {
  opt = opt || {};
  var r = OB_rng(seed), i, p, rx, ry;
  OB_union(c, parts, cols[1], opt.ow, opt.oc);
  OB_unionPath(c, parts);
  OB_in(c, function () {
    // lower-right shade per lump
    c.fillStyle = cols[0];
    for (i = 0; i < parts.length; i++) {
      p = parts[i]; rx = p[2]; ry = p[3] == null ? p[2] : p[3];
      c.beginPath(); c.ellipse(p[0], p[1], rx, ry, p[4] || 0, 0, OB_TAU);
      c.ellipse(p[0] - rx * 0.22, p[1] - ry * 0.3, rx * 1.02, ry * 1.02, p[4] || 0, 0, OB_TAU, true);
      c.fill('evenodd');
    }
    // lit caps
    c.fillStyle = cols[2];
    for (i = 0; i < parts.length; i++) {
      p = parts[i]; rx = p[2]; ry = p[3] == null ? p[2] : p[3];
      if (rx < (opt.minLit || 5)) continue;
      OB_ell(c, p[0] - rx * 0.3, p[1] - ry * 0.36, rx * 0.5, ry * 0.42, (p[4] || 0) - 0.5); c.fill();
    }
    // leafy scallops
    c.lineWidth = opt.tick || 1.1;
    for (i = 0; i < parts.length; i++) {
      p = parts[i]; rx = p[2]; ry = p[3] == null ? p[2] : p[3];
      var n = Math.max(2, Math.round(rx * ry / (opt.density || 26)));
      for (var k = 0; k < n; k++) {
        var a = r() * OB_TAU, d = Math.sqrt(r()) * 0.85, x = p[0] + Math.cos(a) * rx * d, y = p[1] + Math.sin(a) * ry * d;
        var lit = (Math.cos(a) + Math.sin(a)) * d < -0.2;
        c.strokeStyle = lit ? cols[3] : cols[0];
        var sz = (opt.leaf || 2.6) * (0.8 + r() * 0.5);
        c.beginPath(); c.arc(x, y, sz, 0.15 * Math.PI, 0.85 * Math.PI); c.stroke();
      }
    }
  });
}

// four-point sparkle
function OB_sparkle(c, x, y, r, col, alpha) {
  if (r <= 0.05 || alpha <= 0.01) return;
  var k = r * 0.22, ga = c.globalAlpha;
  c.globalAlpha = ga * Math.min(1, alpha);
  c.beginPath();
  c.moveTo(x, y - r); c.quadraticCurveTo(x + k, y - k, x + r, y); c.quadraticCurveTo(x + k, y + k, x, y + r);
  c.quadraticCurveTo(x - k, y + k, x - r, y); c.quadraticCurveTo(x - k, y - k, x, y - r);
  c.fillStyle = col || '#fffbe6'; c.fill();
  c.globalAlpha = ga;
}

// ---- baked layer cache --------------------------------------------------------------------------------
// Canvas in this game is usually rasterised in software, where a cached sprite is ~20x cheaper to blit when it
// lands 1:1 on whole device pixels than at a fractional offset or scale.  So every layer is baked at the exact
// scale of the context it is drawn into (zoom x devicePixelRatio) and blitted pixel-snapped.  When the scale
// changes, layers are re-baked once the new scale has settled (spaced out, about one per frame); until then the
// old bitmap is drawn scaled.  Rotated / skewed / non-uniform contexts fall back to ordinary scaled blits.
var OB_cache = {};                       // key -> [ { s, cv, key }, ... ]  (at most 2 scales kept per layer)
var OB_cur = { fast: false, s: 2, a: 2, ox: 0, oy: 0, stable: true };
var OB_direct = 0;                       // > 0: draw vector art live (icon baking)
var OB_PAD = 2;
var OB_scaleSeen = {}, OB_scaleSeenN = 0, OB_bakeEnd = -1e9, OB_bakeDur = 0, OB_bakeWant = -1e9, OB_wantArea = 0, OB_wantAt = -1e9;
var OB_BAKE_GAP_MS = 10, OB_SETTLE_MS = 120;   // re-bakes are spaced out: at most ~1 per frame, <= 1/3 of the time

function OB_now() { return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(); }
function OB_makeCanvas(w, h) {
  try {
    if (typeof document !== 'undefined' && document.createElement) {
      var cv = document.createElement('canvas'); cv.width = w; cv.height = h; return cv;
    }
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  } catch (e) { /* fall through */ }
  return null;
}
// look at the context transform once per object; snap the object to whole device pixels when possible
function OB_setup(c) {
  var cur = OB_cur, m = null;
  try { m = c.getTransform(); } catch (e) { m = null; }
  if (m && m.b === 0 && m.c === 0 && m.a > 0.05 && Math.abs(m.a - m.d) < 1e-6) {
    var s = Math.round(m.a * 1024) / 1024, now = OB_now(), rec = OB_scaleSeen[s];
    if (!rec || now - rec.last > 500) {
      if (++OB_scaleSeenN > 200) { OB_scaleSeen = {}; OB_scaleSeenN = 1; }
      rec = OB_scaleSeen[s] = { first: now, last: now };
    } else rec.last = now;
    cur.fast = true; cur.s = s; cur.a = m.a; cur.stable = now - rec.first >= OB_SETTLE_MS;
    cur.ox = Math.round(m.e); cur.oy = Math.round(m.f);
    c.setTransform(m.a, 0, 0, m.a, cur.ox, cur.oy);
  } else {
    cur.fast = false; cur.a = 0; cur.stable = false;
    cur.s = m ? Math.min(4, Math.max(1, Math.ceil(Math.sqrt(m.a * m.a + m.b * m.b) * 2) / 2)) : 2;
  }
}
function OB_find(key, s) {
  var list = OB_cache[key];
  if (list) for (var i = 0; i < list.length; i++) if (list[i].s === s) return list[i];
  return null;
}
function OB_bake(key, s, x0, y0, x1, y1, fn) {
  var cv = OB_makeCanvas(Math.ceil((x1 - x0) * s) + OB_PAD * 2, Math.ceil((y1 - y0) * s) + OB_PAD * 2);
  var g = cv && cv.getContext && cv.getContext('2d');
  if (!g) return null;
  var t0 = OB_now(), saved = OB_cur;
  OB_cur = { fast: false, s: s, a: 0, ox: 0, oy: 0, stable: false };
  OB_direct++;
  try {
    g.setTransform(s, 0, 0, s, OB_PAD - Math.round(x0 * s), OB_PAD - Math.round(y0 * s));
    g.lineJoin = 'round'; g.lineCap = 'round';
    fn(g);
    g.getImageData(0, 0, 1, 1);          // rasterise now, so the time is counted against the bake budget
  } catch (e) { cv = null; }
  OB_direct--; OB_cur = saved;
  OB_bakeEnd = OB_now(); OB_bakeDur = OB_bakeEnd - t0;
  if (!cv) return null;
  var ent = { s: s, cv: cv, key: key }, list = OB_cache[key] || (OB_cache[key] = []);
  list.unshift(ent); if (list.length > 2) list.length = 2;
  return ent;
}
// Draw the vector layer fn(ctx) (covering the local box x0,y0..x1,y1) shifted by (dx, dy), through the cache.
// alt: key of a sibling layer with the same box (e.g. the previous animation frame) that may stand in while
// this one waits for its turn to be baked.  Returns the key that was actually shown.
function OB_layer(c, key, x0, y0, x1, y1, fn, dx, dy, alt) {
  dx = dx || 0; dy = dy || 0;
  if (OB_direct || OB_NOCACHE) {
    if (dx || dy) { c.save(); c.translate(dx, dy); fn(c); c.restore(); } else fn(c);
    return key;
  }
  var cur = OB_cur, s = cur.s, ent = OB_find(key, s);
  if (!ent) {
    var list = OB_cache[key], fb = (alt && OB_find(alt, s)) || (list && list[0]) || null;
    if (!fb && alt && OB_cache[alt]) fb = OB_cache[alt][0] || null;
    var go = !fb;
    if (!go && (cur.stable || !cur.fast)) {
      var now = OB_now(), free = now - OB_bakeEnd >= Math.max(OB_BAKE_GAP_MS, OB_bakeDur * 2);
      if (fb.s === s) go = free && now - OB_bakeWant > 80;      // a sharp stand-in exists: let blurrier layers go first
      else {                                                    // otherwise the biggest waiting layer gets the next slot
        var area = (x1 - x0) * (y1 - y0);
        if (now - OB_wantAt > 200) OB_wantArea = 0;
        if (free && area >= OB_wantArea * 0.6) { go = true; OB_wantArea = 0; }
        else { OB_bakeWant = now; if (area >= OB_wantArea) { OB_wantArea = area; OB_wantAt = now; } }
      }
    }
    ent = (go && OB_bake(key, s, x0, y0, x1, y1, fn)) || fb;
    if (!ent) { if (dx || dy) { c.save(); c.translate(dx, dy); fn(c); c.restore(); } else fn(c); return key; }
  }
  if (cur.fast && ent.s === s) {
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.drawImage(ent.cv, cur.ox + Math.round((x0 + dx) * s) - OB_PAD, cur.oy + Math.round((y0 + dy) * s) - OB_PAD);
    c.setTransform(cur.a, 0, 0, cur.a, cur.ox, cur.oy);
  } else {
    var es = ent.s;
    c.drawImage(ent.cv, x0 + dx - OB_PAD / es + (Math.round(x0 * es) - x0 * es) / es, y0 + dy - OB_PAD / es + (Math.round(y0 * es) - y0 * es) / es, ent.cv.width / es, ent.cv.height / es);
  }
  return ent.key;
}
// same, but for a context whose transform the caller has just changed (squash, mirror ...): plain scaled blit
function OB_layerX(c, key, x0, y0, x1, y1, fn) {
  var f = OB_cur.fast; OB_cur.fast = false;
  OB_layer(c, key, x0, y0, x1, y1, fn, 0, 0);
  OB_cur.fast = f;
}

// register an entry. drawLocal(c, o, t, env, id) draws in 48px-tile local coordinates.
function OB_def(type, bounds, drawLocal, extra) {
  var e = {
    bounds: { x0: bounds[0], y0: bounds[1], x1: bounds[2], y1: bounds[3] },
    draw: function (c, o, t, env) {
      if (!c || !o) return;
      var T = OB_tile(), k = T / 48;
      var tt = +t; if (!(tt === tt) || !isFinite(tt)) tt = 0;
      var ev = { night: OB_clamp(env && env.night, 0, 1), wind: OB_clamp(env && env.wind, -1, 1) };
      var id = Math.abs(Math.floor(+o.id || 0)) % 100000;
      var ga = c.globalAlpha;
      c.save();
      try {
        c.translate((+o.x || 0) * T, (+o.y || 0) * T);
        if (k !== 1) c.scale(k, k);
        c.lineJoin = 'round'; c.lineCap = 'round';
        if (!OB_direct) OB_setup(c);
        drawLocal(c, o, tt, ev, id, ga);
      } catch (err) {            // never let art break the frame
        if (!e._warned) { e._warned = true; if (typeof console !== 'undefined') console.warn('objects_b: ' + type, err); }
      }
      c.restore();
    }
  };
  if (extra) for (var key in extra) e[key] = extra[key];
  OBJECT_ART[type] = e;
  return e;
}

// ---- tiny shared critters (baked sprites) ------------------------------------------------------------
var OB_BFLY = [['#fbf1d8', '#f2c14e'], ['#f2c14e', '#e8903a'], ['#f2a0b5', '#d9708f'], ['#8fd3f0', '#3f8fc4']];
function OB_butterflyArt(c, col, col2, f) {
  c.lineWidth = 0.9; c.strokeStyle = OB_OUT;
  for (var s = -1; s <= 1; s += 2) {
    c.beginPath(); c.ellipse(s * 2.4 * f, -1.2, 2.6 * f, 2.6, s * 0.5, 0, OB_TAU); c.fillStyle = col; c.fill(); c.stroke();
    c.beginPath(); c.ellipse(s * 1.8 * f, 1.6, 1.8 * f, 1.7, s * -0.4, 0, OB_TAU); c.fillStyle = col2; c.fill(); c.stroke();
  }
  OB_line(c, 0, -2.2, 0, 2.4, OB_OUT, 1.3);
}
// butterfly at (x, y); pal 0..3; still = wings held open
function OB_butterfly(c, x, y, t, pal, still) {
  var fi = still ? 0 : (Math.floor(t * 14) % 4), f = [1, 0.6, 0.2, 0.6][fi], p = OB_BFLY[pal % 4];
  OB_layer(c, 'bfly' + (pal % 4) + fi, -6, -5, 6, 5, function (g) { OB_butterflyArt(g, p[0], p[1], f); }, x, y);
}

/* ===================================== FLOOR: stone path ============================================ */
var OB_STONE_COLS = ['#c6c0b2', '#bdb7aa', '#b4ad9f', '#cbc2ae', '#b9b4ac'];
function OB_pathStone(c, cx, cy, rx, ry, seed) {
  var r = OB_rng(seed), col = OB_STONE_COLS[(r() * OB_STONE_COLS.length) | 0], big = rx > 14 || ry > 14, n = big ? 11 : 7, J = big ? 0.07 : 0.12;
  // thickness / contact shade
  OB_blob(c, cx + 0.6, cy + 2.2, rx, ry, seed, n, J); c.fillStyle = 'rgba(70,50,30,0.35)'; c.fill();
  OB_blob(c, cx, cy, rx, ry, seed, n, J); c.fillStyle = col; c.fill();
  OB_in(c, function () {
    // lower-right tone + top-left light
    OB_blob(c, cx - rx * 0.18, cy - ry * 0.28, rx, ry, seed, n, J);
    c.rect(cx - rx - 4, cy - ry - 4, rx * 2 + 8, ry * 2 + 8); c.fillStyle = 'rgba(120,108,94,0.45)'; c.fill('evenodd');
    OB_ell(c, cx - rx * 0.3, cy - ry * 0.38, rx * 0.42, ry * 0.26, -0.3); c.fillStyle = 'rgba(255,250,235,0.45)'; c.fill();
    // speckles and a hairline crack
    c.fillStyle = 'rgba(110,98,86,0.55)';
    for (var i = 0; i < 3; i++) { c.beginPath(); c.arc(cx + (r() - 0.5) * rx * 1.3, cy + (r() - 0.5) * ry * 1.2, 0.55 + r() * 0.4, 0, OB_TAU); c.fill(); }
    if (r() < 0.45) {
      var a = r() * OB_TAU, x = cx + Math.cos(a) * rx, y = cy + Math.sin(a) * ry;
      c.beginPath(); c.moveTo(x, y); c.lineTo(OB_lerp(x, cx, 0.35) + (r() - 0.5) * 3, OB_lerp(y, cy, 0.35) + (r() - 0.5) * 3);
      c.lineTo(OB_lerp(x, cx, 0.6) + (r() - 0.5) * 4, OB_lerp(y, cy, 0.6) + (r() - 0.5) * 4);
      c.strokeStyle = 'rgba(90,76,62,0.7)'; c.lineWidth = 0.8; c.stroke();
    }
  });
  OB_blob(c, cx, cy, rx, ry, seed, n, J); c.strokeStyle = 'rgba(59,42,32,0.88)'; c.lineWidth = 1.3; c.stroke();
}
function OB_pathArt(c, tx, ty) {
  var i, j, gx, gy, k;
  // packed-earth bed: neighbouring tiles overlap into one continuous strip
  var bed = [], n = 16, r = OB_rng(tx * 7919 + ty * 104729);
  for (i = 0; i < n; i++) {
    var u = i / n * 4, side = u | 0, f = u - side, w = 0.8 + r() * 1.2, x, y;
    if (side === 0) { x = f * 48; y = -w; } else if (side === 1) { x = 48 + w; y = f * 48; }
    else if (side === 2) { x = 48 - f * 48; y = 48 + w; } else { x = -w; y = 48 - f * 48; }
    bed.push(x, y);
  }
  OB_smooth(c, bed); c.fillStyle = '#c2a878'; c.fill(); c.fillRect(-0.5, -0.5, 49, 49);
  for (i = 0; i < 9; i++) {
    var px = r() * 46 + 1, py = r() * 46 + 1;
    OB_dot(c, px, py, 0.6 + r() * 0.7, r() < 0.5 ? 'rgba(132,104,66,0.55)' : 'rgba(236,220,180,0.7)');
  }
  // stones on a jittered grid (2 x 2 per tile); some pairs fuse into one long flagstone
  var m = OB_h(tx, ty, 3), fuse = m < 0.22 ? 'h0' : m < 0.44 ? 'h1' : m < 0.58 ? 'v0' : m < 0.72 ? 'v1' : '';
  var used = {};
  if (fuse) {
    var fi = +fuse[1], seed = tx * 131 + ty * 977 + 5;
    if (fuse[0] === 'h') { OB_pathStone(c, 24 + (OB_h(tx, ty, 8) - 0.5) * 2, fi * 24 + 12 + (OB_h(tx, ty, 9) - 0.5) * 2, 20, 9.4, seed); used['0' + fi] = used['1' + fi] = 1; }
    else { OB_pathStone(c, fi * 24 + 12 + (OB_h(tx, ty, 8) - 0.5) * 2, 24 + (OB_h(tx, ty, 9) - 0.5) * 2, 9.6, 19.6, seed); used[fi + '0'] = used[fi + '1'] = 1; }
  }
  for (j = 0; j < 2; j++) for (i = 0; i < 2; i++) {
    if (used['' + i + j]) continue;
    gx = tx * 2 + i; gy = ty * 2 + j;
    OB_pathStone(c, i * 24 + 12 + (OB_h(gx, gy, 1) - 0.5) * 2.4, j * 24 + 12.4 + (OB_h(gx, gy, 2) - 0.5) * 2.4,
      8.6 + OB_h(gx, gy, 4) * 1.2, 8 + OB_h(gx, gy, 5) * 1.2, gx * 31 + gy * 17 + 1);
  }
  // a tuft of grass or a clover peeking between stones
  k = OB_h(tx, ty, 11);
  if (k < 0.6) {
    var qx = 24 + (OB_h(tx, ty, 12) - 0.5) * 4, qy = 25 + (OB_h(tx, ty, 13) - 0.5) * 4;
    if (fuse && fuse[0] === 'h') { qx = 24; qy = fuse === 'h0' ? 36.5 : 12.5; }
    if (fuse && fuse[0] === 'v') { qy = 24; qx = fuse === 'v0' ? 36.5 : 12.5; }
    c.strokeStyle = '#5d9d49'; c.lineWidth = 1.3;
    c.beginPath(); c.moveTo(qx, qy + 2); c.lineTo(qx - 2.2, qy - 2); c.moveTo(qx, qy + 2); c.lineTo(qx + 0.3, qy - 3.2);
    c.moveTo(qx, qy + 2); c.lineTo(qx + 2.4, qy - 1.6); c.stroke();
    if (k < 0.22) { OB_dot(c, qx + 0.3, qy - 3.6, 1.2, '#fbf1d8'); OB_dot(c, qx + 0.3, qy - 3.6, 0.5, '#f2c14e'); }
  }
}
// the hand-laid pattern repeats every 5 x 4 tiles, which the eye does not pick up
OB_def('path', [-3, -3, 51, 51], function (c, o, t, env, id) {
  var tx = ((Math.floor(+o.x || 0) % 5) + 5) % 5, ty = ((Math.floor(+o.y || 0) % 4) + 4) % 4;
  OB_layer(c, 'path' + tx + ty, -3, -3, 51, 51, function (g) { OB_pathArt(g, tx + 20, ty + 10); });
});

/* ===================================== FLOOR: flower bed =========================================== */
function OB_flowerBedBase(c) {
  // low soil mound with a hand-laid pebble border
  OB_shadow(c, 24, 33, 22, 13);
  OB_blob(c, 24, 30, 21, 13.5, 77, 10, 0.06); OB_fo(c, '#7a5536', 1.6);
  OB_in(c, function () {
    OB_ell(c, 22, 27, 19, 10); c.fillStyle = '#8c6440'; c.fill();
    var r = OB_rng(5);
    for (var i = 0; i < 16; i++) OB_dot(c, 6 + r() * 36, 20 + r() * 20, 0.7 + r() * 0.6, r() < 0.5 ? '#5f3f27' : '#a07850');
  });
  var r2 = OB_rng(9), n = 15, i, a, x, y;
  for (i = 0; i < n; i++) {                       // front half of the rim: pebbles
    a = Math.PI * (0.02 + 0.96 * i / (n - 1));
    x = 24 + Math.cos(a) * 21; y = 31 + Math.sin(a) * 13;
    OB_blob(c, x, y + 0.3, 3.1 + r2() * 0.9, 2.5 + r2() * 0.6, i * 13 + 3, 6, 0.1);
    OB_fo(c, OB_STONE_COLS[i % 5], 1.2);
    OB_ell(c, x - 0.8, y - 0.8, 1.2, 0.6, -0.4); c.fillStyle = 'rgba(255,252,240,0.6)'; c.fill();
  }
}
function OB_tulipPath(c) {
  c.beginPath(); c.moveTo(-3.4, -4.6); c.quadraticCurveTo(-1.9, -3.2, -1.4, -5.4); c.quadraticCurveTo(0, -3.4, 1.4, -5.4);
  c.quadraticCurveTo(1.9, -3.2, 3.4, -4.6); c.quadraticCurveTo(4.6, 1.6, 0, 2.2); c.quadraticCurveTo(-4.6, 1.6, -3.4, -4.6); c.closePath();
}
// one flower: kind, base x/y, height, sway angle, colour index
function OB_flower(c, kind, x, y, h, sw, ci, t) {
  var hx = x + sw * h, hy = y - h, i, a;
  var stem = '#3f7d3a', leaf = '#5d9d49';
  c.lineWidth = 1.5; c.strokeStyle = stem;
  c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x + sw * h * 0.25, y - h * 0.6, hx, hy); c.stroke();
  if (kind === 'tulip') {
    var cols = [['#d9574a', '#b8403a', '#ee8273'], ['#f2a0b5', '#d97a95', '#fbc8d6'], ['#f2c14e', '#d9a030', '#fbe08a'], ['#e07a9e', '#bd5880', '#f5a9c3']][ci % 4];
    c.fillStyle = leaf; c.strokeStyle = stem; c.lineWidth = 0.9;
    c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x - 5.5, y - 4, x - 4 + sw * 6, y - h * 0.7); c.quadraticCurveTo(x - 1.5, y - 4, x, y); c.fill(); c.stroke();
    c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x + 5.5, y - 3, x + 4.4 + sw * 6, y - h * 0.58); c.quadraticCurveTo(x + 1.5, y - 3, x, y); c.fill(); c.stroke();
    c.save(); c.translate(hx, hy); c.rotate(sw * 1.2); c.scale(1.22, 1.22);
    OB_shape(c, OB_tulipPath, cols[0], function () { OB_ell(c, 2.6, 0, 2.4, 4.6); c.fillStyle = cols[1]; c.fill(); OB_ell(c, -1.6, -1.6, 0.9, 2, 0.2); c.fillStyle = cols[2]; c.fill(); }, 0.95);
    c.restore();
  } else if (kind === 'daisy' || kind === 'cosmos') {
    var pc = kind === 'daisy' ? ['#fffdf4', '#fffdf4', '#fbf1d8'][ci % 3] : ['#f2a0b5', '#a58bd6', '#fffdf4', '#66bde3', '#f7c6d4'][ci % 5];
    c.fillStyle = leaf; c.beginPath(); c.ellipse(x - 2.4, y - 3.2, 3, 1.4, 0.7, 0, OB_TAU); c.ellipse(x + 2.6, y - 4.6, 3, 1.3, -0.7, 0, OB_TAU); c.fill();
    c.save(); c.translate(hx, hy); c.rotate(sw * 1.5 + ci); c.scale(1, 0.82);
    c.beginPath();
    for (i = 0; i < 7; i++) { a = i / 7 * OB_TAU; c.moveTo(Math.cos(a) * 3 + 2.1, Math.sin(a) * 3); c.arc(Math.cos(a) * 3, Math.sin(a) * 3, 2.1, 0, OB_TAU); }
    c.strokeStyle = OB_OUT; c.lineWidth = 1.8; c.stroke(); c.fillStyle = pc; c.fill();
    c.beginPath(); c.arc(0, 0, 2, 0, OB_TAU); c.fillStyle = '#f2c14e'; c.fill(); c.strokeStyle = '#c28a2a'; c.lineWidth = 0.8; c.stroke();
    c.restore();
  } else if (kind === 'lavender') {
    var lc = ['#a58bd6', '#8e74c4', '#b9a3e6'][ci % 3];
    for (i = -1; i <= 1; i++) {
      var bx = x + i * 2.2, tx2 = hx + i * 4.6 + sw * 2, ty2 = hy + Math.abs(i) * 2.4;
      c.strokeStyle = '#5d9d49'; c.lineWidth = 1.1;
      c.beginPath(); c.moveTo(bx, y); c.quadraticCurveTo(bx + i * 1.5, y - h * 0.5, tx2, ty2 + 6); c.stroke();
      c.beginPath();
      for (var k = 0; k < 5; k++) { var yy = ty2 + 6 - k * 2.1, xx = tx2 + ((k & 1) ? 0.9 : -0.9) * (1 - k * 0.12); c.moveTo(xx + 1.6, yy); c.ellipse(xx, yy, 1.6 - k * 0.12, 1.5, 0, 0, OB_TAU); }
      c.strokeStyle = OB_OUT; c.lineWidth = 1.4; c.stroke(); c.fillStyle = lc; c.fill();
      OB_dot(c, tx2 - 0.6, ty2 + 1.4, 0.6, '#d9ccf5');
    }
  } else if (kind === 'sunflower') {
    c.fillStyle = leaf; c.strokeStyle = stem; c.lineWidth = 0.9;
    c.beginPath(); c.ellipse(x - 3.6 + sw * 3, y - h * 0.42, 4.2, 2.2, 0.5, 0, OB_TAU); c.fill(); c.stroke();
    c.beginPath(); c.ellipse(x + 3.8 + sw * 4, y - h * 0.6, 4, 2, -0.5, 0, OB_TAU); c.fill(); c.stroke();
    c.save(); c.translate(hx, hy); c.rotate(sw * 1.2 + ci * 0.4); c.scale(1, 0.88);
    c.beginPath();
    for (i = 0; i < 11; i++) { a = i / 11 * OB_TAU; c.moveTo(Math.cos(a) * 5.2 + Math.cos(a) * 3.4, Math.sin(a) * 5.2 + Math.sin(a) * 3.4); c.ellipse(Math.cos(a) * 5.2, Math.sin(a) * 5.2, 3.4, 1.9, a, 0, OB_TAU); }
    c.strokeStyle = OB_OUT; c.lineWidth = 2; c.stroke(); c.fillStyle = ci % 2 ? '#f2c14e' : '#f7cf4a'; c.fill();
    c.beginPath(); c.arc(0, 0, 5.6, 0, OB_TAU); c.fillStyle = '#e0a52e'; c.fill();
    c.beginPath(); c.arc(0, 0, 3.9, 0, OB_TAU); c.fillStyle = '#7a4e2a'; c.fill(); c.strokeStyle = '#4e2f18'; c.lineWidth = 0.9; c.stroke();
    OB_dot(c, -1.1, -1.1, 1.3, '#a8743f');
    c.restore();
  } else if (kind === 'poppy') {
    var pcs = [['#e8703a', '#c4552a'], ['#d9574a', '#b23e36'], ['#f29a4e', '#d97a30']][ci % 3];
    c.fillStyle = leaf; c.beginPath(); c.ellipse(x - 2.6, y - 2.6, 3.4, 1.5, 0.5, 0, OB_TAU); c.ellipse(x + 2.8, y - 3.6, 3.2, 1.4, -0.6, 0, OB_TAU); c.fill();
    c.save(); c.translate(hx, hy); c.rotate(sw * 1.4); c.scale(1, 0.8);
    c.beginPath();
    for (i = 0; i < 4; i++) { a = i / 4 * OB_TAU + 0.4; c.moveTo(Math.cos(a) * 2.6 + 3.3, Math.sin(a) * 2.6); c.arc(Math.cos(a) * 2.6, Math.sin(a) * 2.6, 3.3, 0, OB_TAU); }
    c.strokeStyle = OB_OUT; c.lineWidth = 1.8; c.stroke(); c.fillStyle = pcs[0]; c.fill();
    OB_ell(c, 1.6, 1.8, 3.6, 2.6); c.fillStyle = pcs[1]; c.fill();
    OB_dot(c, 0, 0, 1.7, '#3b2a20'); OB_dot(c, -0.4, -0.5, 0.6, '#f2c14e');
    c.restore();
  }
}
var OB_FLOWER_KINDS = ['tulip', 'daisy', 'lavender', 'sunflower', 'poppy', 'cosmos'];
// flower spots inside the bed: [x, y] back row first
var OB_FLOWER_SPOTS = [[12, 24], [24, 22.5], [36, 24], [7.5, 30], [18, 29.5], [30, 29.5], [40.5, 30], [12.5, 36.5], [24, 37.5], [35.5, 36.5]];
var OB_FL_FRAMES = 16, OB_FL_LOOP = 3.6, OB_flLast = {};
// one frame (k of OB_FL_FRAMES) of a flower bed swaying; kind 0..5, v = colour variant 0..1
function OB_flowerBedArt(c, ki, v, k) {
  OB_flowerBedBase(c);
  var kind = OB_FLOWER_KINDS[ki], r = OB_rng(ki * 53 + v * 977 + 11), i, p, ph0 = k / OB_FL_FRAMES * OB_TAU;
  var hBase = kind === 'sunflower' ? 18 : kind === 'lavender' ? 15 : kind === 'tulip' ? 13.5 : 11;
  // little filler leaves so the bed reads as lush
  c.fillStyle = '#4f8f42';
  for (i = 0; i < 6; i++) { OB_ell(c, 8 + i * 6.4 + (r() - 0.5) * 2, 27 + (i & 1) * 7 + r() * 2, 3.2, 1.5, (r() - 0.5) * 1.6); c.fill(); }
  for (i = 0; i < OB_FLOWER_SPOTS.length; i++) {
    p = OB_FLOWER_SPOTS[i];
    if (kind === 'sunflower' && (i === 0 || i === 2 || i === 4 || i === 5 || i === 8)) continue;   // fewer, bigger heads
    var jx = (r() - 0.5) * 3, jy = (r() - 0.5) * 1.6, hh = hBase * (0.85 + r() * 0.3), ph = r() * 6.28, ph2 = r() * 6.28;
    var sw = Math.sin(ph0 + ph + p[0] * 0.13) * 0.075 + Math.sin(ph0 * 2 + ph2) * 0.03;
    var ci = (v * 2 + i + ((r() * 3) | 0));
    var k2 = kind;
    if (kind === 'cosmos' && i % 4 === 3) k2 = 'daisy';
    OB_flower(c, k2, p[0] + jx, p[1] + jy, hh, sw, ci, 0);
  }
}
OB_def('flowers', [-2, -2, 50, 48], function (c, o, t, env, id) {
  var ki = id % 6, v = ((id / 6) | 0) % 2, F = OB_FL_FRAMES, slot = ki * 2 + v;
  var k = Math.floor(OB_fract(t / OB_FL_LOOP + id * 0.137) * F) % F;
  if (OB_cur.s > 2.6) k &= ~1;          // very high-dpi: half the frames, to keep the bitmap cache modest
  OB_flLast[slot] = OB_layer(c, 'fl' + slot + '_' + k, -2, -2, 50, 48, function (g) { OB_flowerBedArt(g, ki, v, k); }, 0, 0, OB_flLast[slot]);
});

/* ===================================== hydrant ===================================================== */
function OB_hydrantArt(c) {
  var R = '#d9574a', RD = '#b23e36', RL = '#ee8273', BR = '#f2c14e', BRD = '#c9922f';
  OB_shadow(c, 24, 43, 16, 5);
  // little puddle under the dripping nozzle
  OB_ell(c, 8.5, 44.5, 5.2, 1.7); c.fillStyle = 'rgba(102,189,227,0.75)'; c.fill(); OB_ell(c, 7.6, 44.2, 2, 0.6); c.fillStyle = 'rgba(255,255,255,0.7)'; c.fill();
  // base flange
  OB_rr(c, 12.5, 38, 23, 6, 2.2); OB_fo(c, RD);
  OB_rr(c, 14, 35.2, 20, 4.4, 1.8); OB_fo(c, R);
  // side nozzles
  OB_rr(c, 9.6, 20.4, 8, 8.4, 1.6); OB_fo(c, R); OB_rr(c, 30.4, 20.4, 8, 8.4, 1.6); OB_fo(c, RD);
  OB_rr(c, 7.2, 19.4, 4, 10.4, 1.6); OB_fo(c, BR); OB_rr(c, 36.8, 19.4, 4, 10.4, 1.6); OB_fo(c, BRD);
  OB_line(c, 8.4, 21.4, 8.4, 27.6, '#fff1b0', 1);
  // barrel
  OB_rr(c, 15.5, 14, 17, 22.5, 2); c.fillStyle = R; c.fill();
  OB_in(c, function () {
    c.fillStyle = RD; c.fillRect(27.2, 12, 8, 26); c.fillStyle = 'rgba(120,30,30,0.25)'; c.fillRect(14, 14, 20, 3.4);
    c.fillStyle = RL; c.fillRect(17.6, 17, 2.2, 17);
  });
  OB_s(c);
  // waist band
  OB_rr(c, 14.3, 30.2, 19.4, 3.4, 1.5); OB_fo(c, R, 1.5); OB_line(c, 16.4, 31.2, 22, 31.2, RL, 1);
  // front nozzle cap with pentagon nut
  OB_ell(c, 24, 23.6, 5.4, 5.4); OB_fo(c, R, 1.6);
  c.beginPath(); c.arc(24, 23.6, 5.4, 0.1, 1.9); c.strokeStyle = RD; c.lineWidth = 1.6; c.stroke();
  OB_ell(c, 24, 23.6, 5.4, 5.4); OB_s(c, OB_OUT, 1.6);
  c.beginPath(); for (var i = 0; i < 5; i++) { var a = -Math.PI / 2 + i / 5 * OB_TAU; c.lineTo(24 + Math.cos(a) * 2.8, 23.6 + Math.sin(a) * 2.8); } c.closePath(); OB_fo(c, BR, 1.1);
  OB_dot(c, 23.3, 22.8, 0.7, '#fff1b0');
  // chain from cap to barrel
  c.beginPath(); c.moveTo(27.4, 27.8); c.quadraticCurveTo(29.6, 32.4, 31.2, 28.6); OB_s(c, '#7a2a26', 1.1);
  OB_dot(c, 28.2, 29.5, 0.75, '#f2c14e'); OB_dot(c, 29.6, 30.3, 0.75, '#f2c14e'); OB_dot(c, 30.8, 29.3, 0.75, '#f2c14e');
  // bonnet
  OB_shape(c, function () { c.beginPath(); c.moveTo(14.6, 15.2); c.quadraticCurveTo(14.6, 5.2, 24, 5.2); c.quadraticCurveTo(33.4, 5.2, 33.4, 15.2); c.closePath(); }, R,
    function () { OB_ell(c, 32, 13, 5, 9); c.fillStyle = RD; c.fill(); OB_ell(c, 19.2, 9.6, 1.8, 3, 0.5); c.fillStyle = RL; c.fill(); });
  OB_rr(c, 13.2, 13.6, 21.6, 3.8, 1.7); OB_fo(c, R, 1.6);
  OB_in(c, function () { c.fillStyle = RD; c.fillRect(27, 13, 9, 5); });
  OB_rr(c, 13.2, 13.6, 21.6, 3.8, 1.7); OB_s(c, OB_OUT, 1.6);
  OB_dot(c, 17, 15.5, 0.8, BRD); OB_dot(c, 24, 15.5, 0.8, BRD); OB_dot(c, 31, 15.5, 0.8, '#8a2e28');
  // top nut
  OB_rr(c, 21.2, 1.4, 5.6, 5, 1.2); OB_fo(c, BR, 1.5); OB_line(c, 22.4, 2.8, 22.4, 5, '#fff1b0', 1);
  // base bolts
  OB_dot(c, 16.5, 41, 0.9, '#8a2e28'); OB_dot(c, 24, 41.4, 0.9, '#8a2e28'); OB_dot(c, 31.5, 41, 0.9, '#8a2e28');
}
OB_def('hydrant', [0, 0, 48, 48], function (c, o, t, env, id, ga) {
  OB_layer(c, 'hydrant', 0, 0, 48, 48, OB_hydrantArt);
  // a slow drip from the left nozzle
  var u = OB_fract(t / 3.4 + id * 0.37);
  if (u < 0.16) { var s = u / 0.16; OB_ell(c, 9, 30.6, 1 + s * 0.5, 1 + s * 1.1); c.fillStyle = '#8fd3f0'; c.fill(); OB_s(c, '#3f8fc4', 0.7); }
  else if (u < 0.34) { var f = (u - 0.16) / 0.18, y = 31 + f * f * 12.5; c.beginPath(); c.moveTo(9, y - 2.6); c.quadraticCurveTo(11, y + 1.6, 9, y + 1.6); c.quadraticCurveTo(7, y + 1.6, 9, y - 2.6); c.fillStyle = '#8fd3f0'; c.fill(); OB_s(c, '#3f8fc4', 0.7); }
  else if (u < 0.5) { var g = (u - 0.34) / 0.16; c.globalAlpha = ga * (1 - g); OB_ell(c, 8.8, 44.4, 2 + g * 4.5, 0.7 + g * 1.4); OB_s(c, '#ffffff', 0.9); c.globalAlpha = ga; }
  // glint on the brass
  var gl = OB_fract(t / 5.3 + id * 0.61); if (gl < 0.12) OB_sparkle(c, 22.6, 2.6, 3.2 * Math.sin(gl / 0.12 * Math.PI), '#fffbe6', 1);
});

/* ===================================== berry bush ================================================== */
var OB_BUSH_PARTS = [[8, 37, 6.5], [40.5, 37.5, 6.5], [12.5, 31, 10], [35.5, 31, 10], [24, 34, 11.5], [17, 22, 9.5], [31, 21.5, 10], [24, 15.5, 8.5]];
var OB_BERRY = [['#d9574a', '#a8352f', '#f6a091'], ['#5f74d8', '#3d4da6', '#aab8f5'], ['#c2559a', '#8f3570', '#eea3cf']];
function OB_bushArt(c, v) {
  OB_foliage(c, OB_BUSH_PARTS, ['#3f7d3a', '#4f9a45', '#6db555', '#8fd06c'], 31 + v, { density: 20 });
  // berry clusters
  var r = OB_rng(400 + v * 7), col = OB_BERRY[v % 3];
  var spots = [[13, 30], [22, 24], [33, 28], [27, 36], [16, 39], [37, 36], [25, 14], [31, 18], [9, 36]];
  for (var i = 0; i < spots.length; i++) {
    var n = 1 + ((r() * 2.6) | 0), x = spots[i][0] + (r() - 0.5) * 3, y = spots[i][1] + (r() - 0.5) * 3;
    for (var k = 0; k < n; k++) {
      var bx = x + [0, 3.4, 1.4][k], by = y + [0, 1.2, 3.4][k];
      OB_ell(c, bx, by, 2.3, 2.3); OB_fo(c, col[0], 1.1);
      c.beginPath(); c.arc(bx, by, 1.5, 0.2, 2.2); c.strokeStyle = col[1]; c.lineWidth = 0.9; c.stroke();
      OB_dot(c, bx - 0.7, by - 0.8, 0.65, col[2]);
    }
  }
}
function OB_bushFull(c, v) { OB_shadow(c, 24, 43, 21, 5.5); OB_bushArt(c, v); }
OB_def('bush', [-2, -5, 50, 49], function (c, o, t, env, id, ga) {
  var v = id % 3;
  // mostly still; now and then it rustles, as if something small lives inside
  var ru = OB_fract(t / 6.7 + id * 0.29);
  if (ru < 0.085) {
    var q = ru / 0.085, w = Math.sin(q * OB_TAU * 3) * (1 - q);
    OB_shadow(c, 24, 43, 21, 5.5);
    c.save(); c.translate(24, 44); c.scale(1 + w * 0.035, 1 - w * 0.045); c.translate(-24, -44);
    OB_layerX(c, 'bushb' + v, 0, 4, 48, 48, function (g) { OB_bushArt(g, v); });
    c.restore();
    // a leaf shaken loose
    var lx = 30 + q * 10, ly = 12 + q * q * 26;
    c.save(); c.translate(lx, ly); c.rotate(q * 5); c.beginPath(); c.moveTo(-2.6, 0); c.quadraticCurveTo(0, -2.2, 2.6, 0); c.quadraticCurveTo(0, 2.2, -2.6, 0); c.fillStyle = '#6db555'; c.fill(); OB_s(c, '#3f7d3a', 0.7); c.restore();
  } else {
    OB_layer(c, 'bush' + v, -1, 4, 49, 49, function (g) { OB_bushFull(g, v); });
  }
  // berries catch the light
  var gl = OB_fract(t / 4.1 + id * 0.47); if (gl < 0.14) { var sp = [[13, 30], [22, 24], [33, 28], [27, 36]][(Math.floor(t / 4.1 + id * 0.47) + id) % 4]; OB_sparkle(c, sp[0] - 0.6, sp[1] - 0.8, 3 * Math.sin(gl / 0.14 * Math.PI), '#ffffff', 1); }
  // visiting butterfly
  var bu = OB_fract(t / 13 + id * 0.41);
  if (bu < 0.5 && !o.icon) {
    var a = bu / 0.5, bx = 24 + Math.sin(a * 7 + id) * 17, by = 10 + Math.sin(a * 11) * 6 - Math.sin(a * Math.PI) * 4;
    c.globalAlpha = ga * Math.min(1, a * 8, (1 - a) * 8);
    OB_butterfly(c, bx, by, t + id, id);
    c.globalAlpha = ga;
  }
}, { iconBounds: { x0: -1, y0: 2, x1: 49, y1: 48 } });

/* ===================================== garden bench ================================================ */
function OB_plank(c, x, y, w, h, col, dark, lite, seed) {
  var r = OB_rng(seed);
  OB_rr(c, x, y, w, h, 1.6); c.fillStyle = col; c.fill();
  OB_in(c, function () {
    c.fillStyle = dark; c.fillRect(x, y + h - 1.8, w, 2);
    c.fillStyle = lite; c.fillRect(x, y + 0.5, w, 1.1);
    c.strokeStyle = dark; c.lineWidth = 0.7;
    for (var i = 0; i < 3; i++) { var gx = x + 6 + r() * (w - 22), gy = y + 2.6 + r() * (h - 4.6), gl = 6 + r() * 12; c.beginPath(); c.moveTo(gx, gy); c.quadraticCurveTo(gx + gl / 2, gy + (r() - 0.5) * 1.2, gx + gl, gy); c.stroke(); }
  });
  OB_rr(c, x, y, w, h, 1.6); OB_s(c, OB_OUT, 1.5);
}
function OB_benchArt(c, v) {
  var IR = '#4d4843', IRL = '#7d766c', W = '#c9935a', WD = '#a8743f', WL = '#e3b47c', i, x;
  OB_shadow(c, 48, 43.5, 45, 5);
  // back legs (iron) + under-seat darkness
  c.fillStyle = 'rgba(40,26,12,0.3)'; c.fillRect(12, 28, 72, 10);
  OB_rr(c, 10, 22, 4, 19, 1); OB_fo(c, '#3a3632', 1.4); OB_rr(c, 82, 22, 4, 19, 1); OB_fo(c, '#3a3632', 1.4);
  // back uprights (iron) behind the slats
  for (i = 0; i < 3; i++) { x = [10.5, 46, 81.5][i]; OB_rr(c, x, -7, 4, 24, 1); OB_fo(c, IR, 1.4); }
  // back slats
  OB_plank(c, 7, -9.5, 82, 7.4, W, WD, WL, 11);
  OB_plank(c, 7, -0.8, 82, 7, W, WD, WL, 12);
  OB_plank(c, 7, 7.6, 82, 6.6, '#c08a52', WD, '#d9a86e', 13);
  // carved heart on the top slat
  c.beginPath(); c.moveTo(48, -3.8); c.bezierCurveTo(44.6, -6.4, 45.2, -8.6, 46.6, -8.6); c.bezierCurveTo(47.4, -8.6, 48, -7.8, 48, -7.4);
  c.bezierCurveTo(48, -7.8, 48.6, -8.6, 49.4, -8.6); c.bezierCurveTo(50.8, -8.6, 51.4, -6.4, 48, -3.8); c.fillStyle = '#8a5a30'; c.fill();
  for (i = 0; i < 2; i++) { x = i ? 83.5 : 12.5; OB_dot(c, x, -5.8, 1, '#5a4a3c'); OB_dot(c, x, 2.7, 1, '#5a4a3c'); OB_dot(c, x, 10.9, 1, '#5a4a3c'); }
  // seat: three planks seen from above + front edge
  OB_rr(c, 6, 15.6, 84, 12.6, 1.6); c.fillStyle = WL; c.fill();
  OB_in(c, function () {
    c.fillStyle = '#d6a468'; c.fillRect(6, 15.6, 84, 3);
    c.strokeStyle = WD; c.lineWidth = 1; c.beginPath(); c.moveTo(6, 19.8); c.lineTo(90, 19.8); c.moveTo(6, 24); c.lineTo(90, 24); c.stroke();
    c.strokeStyle = 'rgba(168,116,63,0.6)'; c.lineWidth = 0.7;
    var r = OB_rng(77); for (var k = 0; k < 9; k++) { var gx = 10 + r() * 64, gy = 17 + ((r() * 3) | 0) * 4.2 + r() * 1.4; c.beginPath(); c.moveTo(gx, gy); c.lineTo(gx + 6 + r() * 10, gy + 0.3); c.stroke(); }
  });
  OB_rr(c, 6, 15.6, 84, 12.6, 1.6); OB_s(c, OB_OUT, 1.6);
  OB_rr(c, 6, 27.2, 84, 4.6, 1.4); c.fillStyle = WD; c.fill(); OB_in(c, function () { c.fillStyle = '#8f5f33'; c.fillRect(6, 30, 84, 2); }); OB_rr(c, 6, 27.2, 84, 4.6, 1.4); OB_s(c, OB_OUT, 1.6);
  // iron arms: front legs with scrolled arm-rests
  for (i = 0; i < 2; i++) {
    c.save(); if (i) { c.translate(96, 0); c.scale(-1, 1); }
    OB_rr(c, 4.6, 22, 4.6, 21, 1.4); OB_fo(c, IR, 1.5); OB_line(c, 6, 24, 6, 41, i ? '#5e5952' : IRL, 1);
    OB_rr(c, 3, 41, 8, 3, 1.3); OB_fo(c, IR, 1.4);
    // arm-rest running back to the back-rest
    c.beginPath(); c.moveTo(3.2, 21.6); c.quadraticCurveTo(2.2, 8.6, 6.2, 3.2); c.lineTo(11.4, 3.2); c.quadraticCurveTo(8.8, 10, 10, 21.6); c.closePath(); OB_fo(c, IR, 1.5);
    c.beginPath(); c.moveTo(5, 19); c.quadraticCurveTo(4.4, 10, 7.2, 5.4); OB_s(c, i ? '#5e5952' : IRL, 1);
    // scroll
    OB_ell(c, 6.6, 22.4, 4.4, 4.2); OB_fo(c, IR, 1.5); OB_ell(c, 6.6, 22.4, 1.7, 1.6); c.fillStyle = WD; c.fill(); OB_s(c, OB_OUT, 1);
    c.beginPath(); c.arc(6.6, 22.4, 3, Math.PI * 1.05, Math.PI * 1.6); OB_s(c, i ? '#5e5952' : IRL, 0.9);
    c.restore();
  }
  // cosy extras by variant
  if (v === 1) {            // gingham cushion
    OB_rr(c, 17, 14.4, 22, 10.6, 3.4); c.fillStyle = '#f2a0b5'; c.fill();
    OB_in(c, function () { c.fillStyle = 'rgba(255,255,255,0.45)'; for (var k = 0; k < 5; k++) { c.fillRect(19 + k * 4.6, 12, 2.2, 16); } for (k = 0; k < 3; k++) c.fillRect(15, 16 + k * 3.6, 26, 1.7); c.fillStyle = 'rgba(180,80,110,0.35)'; c.fillRect(15, 22.4, 26, 4); });
    OB_rr(c, 17, 14.4, 22, 10.6, 3.4); OB_s(c, OB_OUT, 1.5);
  } else if (v === 2) {     // a forgotten tennis ball
    OB_shadow(c, 66.5, 23.6, 4.6, 1.6); OB_ell(c, 66, 20, 4, 4); OB_fo(c, '#cfe05a', 1.4);
    c.beginPath(); c.arc(63, 17.4, 3.6, 0.1, 1.5); OB_s(c, '#fbfbe0', 1); c.beginPath(); c.arc(69.4, 22.6, 3.4, 3.2, 4.7); OB_s(c, '#fbfbe0', 1);
  }
}
function OB_ladybirdArt(c, dir) {
  OB_ell(c, 0, 0, 2.1, 1.6); OB_fo(c, '#d9574a', 0.9); OB_dot(c, dir * 1.9, 0.2, 0.95, OB_OUT); OB_dot(c, -dir * 0.4, -0.3, 0.45, OB_OUT); OB_dot(c, dir * 0.7, 0.4, 0.4, OB_OUT);
}
OB_def('bench', [0, -15, 96, 49], function (c, o, t, env, id) {
  var v = id % 3;
  OB_layer(c, 'bench' + v, 0, -12, 96, 49, function (g) { OB_benchArt(g, v); });
  // a ladybird strolling along the top slat
  var p = OB_fract(t / 26 + id * 0.37), dir = p < 0.5 ? 1 : -1, u = p < 0.5 ? p * 2 : 2 - p * 2;
  OB_layer(c, 'lady' + dir, -4, -3, 4, 3, function (g) { OB_ladybirdArt(g, dir); }, 16 + u * 64, -10.2 - Math.abs(Math.sin(t * 9)) * 0.3);
});

/* ===================================== bird bath =================================================== */
var OB_BIRDS = [['#5b9bd6', '#3f78b0', '#f4caa0'], ['#9a7352', '#6f4e34', '#e0703c'], ['#f2c14e', '#4d4843', '#fbe9a6'], ['#d9574a', '#a8352f', '#5a4a3c']];
function OB_birdbathArt(c) {
  var S = '#c4beb0', SD = '#948e82', SL = '#dcd7ca';
  OB_shadow(c, 24, 43.4, 16, 5);
  // stepped base
  OB_rr(c, 11.5, 38, 25, 6, 2.4); c.fillStyle = S; c.fill(); OB_in(c, function () { c.fillStyle = SD; c.fillRect(28, 36, 10, 10); c.fillRect(10, 42.2, 28, 3); }); OB_rr(c, 11.5, 38, 25, 6, 2.4); OB_s(c);
  OB_rr(c, 15, 34.2, 18, 4.8, 2); c.fillStyle = S; c.fill(); OB_in(c, function () { c.fillStyle = SD; c.fillRect(27, 33, 8, 8); }); OB_rr(c, 15, 34.2, 18, 4.8, 2); OB_s(c, OB_OUT, 1.6);
  // baluster column
  c.beginPath(); c.moveTo(19.6, 34.6); c.quadraticCurveTo(16.4, 28.5, 20.6, 24.4); c.quadraticCurveTo(21.8, 22, 20.4, 18); c.lineTo(27.6, 18);
  c.quadraticCurveTo(26.2, 22, 27.4, 24.4); c.quadraticCurveTo(31.6, 28.5, 28.4, 34.6); c.closePath(); c.fillStyle = S; c.fill();
  OB_in(c, function () { c.fillStyle = SD; c.fillRect(25.4, 16, 8, 20); c.fillStyle = SL; c.fillRect(19.4, 19, 1.8, 15); c.fillStyle = 'rgba(80,70,60,0.28)'; c.fillRect(16, 17, 16, 3.2); });
  OB_s(c);
  OB_rr(c, 18.6, 23, 10.8, 2.6, 1.2); OB_fo(c, S, 1.3);
  // bowl underside
  OB_shape(c, function () { c.beginPath(); c.moveTo(5.4, 11); c.quadraticCurveTo(8.6, 20.6, 24, 21); c.quadraticCurveTo(39.4, 20.6, 42.6, 11); c.closePath(); }, S,
    function () { OB_ell(c, 33, 19, 14, 8); c.fillStyle = SD; c.fill(); OB_ell(c, 14, 15.4, 4, 1.6, 0.5); c.fillStyle = SL; c.fill(); });
  // rim + water
  OB_ell(c, 24, 10.6, 19.2, 6.4); OB_fo(c, SL);
  c.beginPath(); c.ellipse(24, 10.6, 19.2, 6.4, 0, 0.1, 1.7); OB_s(c, SD, 1.2);
  OB_ell(c, 24, 10.6, 19.2, 6.4); OB_s(c);
  OB_shape(c, function () { OB_ell(c, 24, 10.9, 15.4, 4.4); }, '#3f8fc4', function () { OB_ell(c, 24, 12.6, 15.4, 4.4); c.fillStyle = '#66bde3'; c.fill(); OB_ell(c, 20, 13.6, 8, 1.6); c.fillStyle = '#8fd3f0'; c.fill(); }, 1.3);
  // moss + crack
  OB_ell(c, 14.6, 40.4, 3, 1.5); c.fillStyle = '#6fb556'; c.fill(); OB_ell(c, 17.6, 41.6, 1.6, 1); c.fill(); OB_ell(c, 8.6, 14.6, 2, 1.1, 0.7); c.fill();
  c.beginPath(); c.moveTo(33, 38.4); c.lineTo(31.6, 40.6); c.lineTo(32.8, 42.4); OB_s(c, '#7d766b', 0.8);
}
// a small songbird; pose: 0 perched, 1 dipping to drink, 2 flying (wing flap w)
function OB_bird(c, x, y, dir, col, pose, w) {
  c.save(); c.translate(x, y); c.scale(dir, 1);
  if (pose === 1) c.rotate(0.5);
  c.lineWidth = 1.1; c.strokeStyle = OB_OUT;
  if (pose !== 2) { OB_line(c, -0.6, 3, -0.9, 5.6, '#8a5a30', 0.9); OB_line(c, 1.2, 3, 1.3, 5.6, '#8a5a30', 0.9); }
  c.lineWidth = 1.1; c.strokeStyle = OB_OUT;
  // tail
  c.beginPath(); c.moveTo(-3.4, -0.4); c.lineTo(-8.6, -2.6 + (pose === 2 ? 1.6 : 0)); c.lineTo(-7.8, 0.8 + (pose === 2 ? 1 : 0)); c.lineTo(-3, 2); c.closePath(); c.fillStyle = col[1]; c.fill(); c.stroke();
  // body + breast
  OB_ell(c, 0, 0, 4.9, 3.9, -0.15); c.fillStyle = col[0]; c.fill();
  OB_in(c, function () { OB_ell(c, 1.6, 2.2, 4, 2.8); c.fillStyle = col[2]; c.fill(); });
  OB_ell(c, 0, 0, 4.9, 3.9, -0.15); c.stroke();
  // head
  OB_ell(c, 3.9, -3.4, 3.1, 3); c.fillStyle = col[0]; c.fill(); c.stroke();
  c.beginPath(); c.moveTo(6.6, -4.2); c.lineTo(9.4, -3.2); c.lineTo(6.6, -2.2); c.closePath(); c.fillStyle = '#f2a33a'; c.fill(); c.lineWidth = 0.8; c.stroke();
  OB_dot(c, 4.8, -3.9, 0.75, '#1e1510'); OB_dot(c, 5, -4.1, 0.25, '#fff');
  // wing
  c.lineWidth = 1;
  if (pose === 2) { c.save(); c.translate(-0.4, -1.4); c.rotate(-0.5 + w * 1.5); c.beginPath(); c.moveTo(-1.8, 0); c.quadraticCurveTo(-1, -8, 2.6, -8.4); c.quadraticCurveTo(3.2, -3, 2, 0); c.closePath(); c.fillStyle = col[1]; c.fill(); c.stroke(); c.restore(); }
  else { c.save(); c.translate(-0.6, -0.4); c.rotate(-w * 1.1); c.beginPath(); c.ellipse(-0.8, 0.2, 3.5, 2.2, 0.25, 0, OB_TAU); c.fillStyle = col[1]; c.fill(); c.stroke(); c.restore(); }
  c.restore();
}
function OB_birdSprite(c, x, y, dir, ci, pose, w) {
  var wi = pose === 1 ? 0 : Math.round(OB_clamp(w, 0, 1) * 2);
  OB_layer(c, 'bird' + ci + pose + wi + (dir < 0 ? 'l' : 'r'), -12, -14, 12, 8, function (g) { OB_bird(g, 0, 0, dir, OB_BIRDS[ci], pose, wi / 2); }, x, y);
}
OB_def('birdbath', [-58, -60, 106, 49], function (c, o, t, env, id, ga) {
  OB_layer(c, 'birdbath', 0, 2, 48, 49, OB_birdbathArt);
  var P = 17, u = OB_fract(t / P + id * 0.618), ci = id % 4, dir = (id & 1) ? -1 : 1, n = Math.floor(t / P + id * 0.618);
  if ((n + id) % 3 === 2) dir = -dir;
  var px = 24 + dir * 12.5, py = 3.4, i;          // perch point on the rim
  // water shimmer
  var sh = OB_fract(t * 0.25 + id * 0.3);
  c.strokeStyle = 'rgba(255,255,255,0.75)'; c.lineWidth = 1;
  c.beginPath(); c.moveTo(14 + sh * 5, 10.2); c.lineTo(19 + sh * 5, 10.2); c.moveTo(27 - sh * 4, 12.6); c.lineTo(31 - sh * 4, 12.6); c.stroke();
  if (u < 0.1) {                       // fly in
    var a = OB_ease(u / 0.1), fx = OB_lerp(px + dir * 44, px, a), fy = OB_lerp(py - 34, py, a) - Math.sin(a * Math.PI) * 8;
    c.globalAlpha = ga * Math.min(1, u / 0.008); OB_birdSprite(c, fx, fy, -dir, ci, 2, Math.sin(t * 32) * 0.5 + 0.5); c.globalAlpha = ga;
  } else if (u < 0.6) {
    var q = (u - 0.1) / 0.5, hop = 0, pose = 0, w = 0, bx = px, tt = q * 8.5;   // ~8.5 s on the rim
    var face = -dir;
    if (tt < 1) { hop = Math.abs(Math.sin(tt * Math.PI * 2)) * 1.6 * (1 - tt); }
    else if (tt > 1.6 && tt < 3.4) { pose = Math.sin((tt - 1.6) / 1.8 * Math.PI * 3) > 0.2 ? 1 : 0; }
    else if (tt > 4 && tt < 6.4) {    // splash bath: hop into the water and flutter
      var sq = (tt - 4) / 2.4; bx = px - dir * 7 * Math.min(1, sq * 5, (1 - sq) * 5); hop = -3.2 * Math.min(1, sq * 5, (1 - sq) * 5);
      w = Math.sin(t * 38) * 0.5 + 0.5;
      c.strokeStyle = 'rgba(255,255,255,0.85)'; c.lineWidth = 1;
      for (i = 0; i < 2; i++) { var rp = OB_fract(t * 1.6 + i * 0.5); c.globalAlpha = ga * (1 - rp); OB_ell(c, 24 + dir * 5.5, 10.8, 3 + rp * 8, 1 + rp * 2.6); c.stroke(); }
      c.globalAlpha = ga; c.fillStyle = '#d6f0fb';
      for (i = 0; i < 4; i++) { var dp = OB_fract(t * 2.3 + i * 0.26), da = -0.5 - i * 0.7; OB_ell(c, 24 + dir * 5.5 + Math.cos(da) * dp * 11, 7 + Math.sin(da) * dp * 9 + dp * dp * 8, 1.1, 1.3); c.fill(); }
    }
    else if (tt > 6.8 && tt < 7.6) { w = Math.sin(t * 30) * 0.5 + 0.5; hop = 0.6; }   // shake dry
    else if (tt > 7.9) { face = dir; }
    OB_birdSprite(c, bx, py - hop, face, ci, pose, w);
  } else if (u < 0.7) {                // fly off
    var b = OB_ease((u - 0.6) / 0.1), gx = OB_lerp(px, px - dir * 50, b * b), gy = OB_lerp(py, py - 46, b);
    c.globalAlpha = ga * Math.min(1, (0.7 - u) / 0.008); OB_birdSprite(c, gx, gy, -dir, ci, 2, Math.sin(t * 32) * 0.5 + 0.5); c.globalAlpha = ga;
  }
}, { iconBounds: { x0: 0, y0: -12, x1: 48, y1: 48 } });

/* ===================================== dog topiary ================================================= */
// a sitting dog (facing right) clipped out of box hedge, in a terracotta pot
var OB_TOPIARY_PARTS = [
  [8.6, 10, 3.2, 8.6, -0.55],      // tail, curling up
  [18.5, 16.5, 11, 11.5],          // haunch
  [26, 6, 9.2, 14, 0.22],          // chest
  [32.6, 17, 4.6, 10.5],           // front leg
  [35.4, 26, 5.2, 3.4],            // front paw
  [21, 26, 7, 3.6],                // hind paw
  [29.6, -6.5, 6.4, 8],            // neck
  [31, -14, 9.2, 8.8],             // head
  [40.2, -11.4, 6, 4.6, 0.08],     // muzzle
  [25.4, -21.4, 3.6, 6.6, -0.3],   // ear (back)
  [30.6, -22.6, 3.4, 6.4, 0.12]    // ear (front)
];
function OB_topiaryArt(c) {
  var P = '#c9694a', PD = '#a64f38', PL = '#e38e6e';
  OB_shadow(c, 24, 43.6, 17, 5);
  // hedge dog
  OB_foliage(c, OB_TOPIARY_PARTS, ['#3a7436', '#4c9444', '#68b052', '#8bcc68'], 71, { density: 15, leaf: 2.1, minLit: 4.4 });
  // clipped-in face: eye, nose, smile
  OB_dot(c, 34.4, -15.4, 1.25, '#2c4f2a'); OB_dot(c, 34.8, -15.8, 0.4, '#bfe8a6');
  OB_ell(c, 45.4, -12.6, 1.7, 1.4); c.fillStyle = '#2c4f2a'; c.fill();
  c.beginPath(); c.moveTo(44.6, -9.2); c.quadraticCurveTo(41.6, -7.4, 39, -8.8); OB_s(c, '#2c4f2a', 1);
  // red bow collar
  c.beginPath(); c.moveTo(24.4, -3.6); c.quadraticCurveTo(30, 0.2, 35.6, -2.8); OB_s(c, OB_OUT, 4.6); c.beginPath(); c.moveTo(24.4, -3.6); c.quadraticCurveTo(30, 0.2, 35.6, -2.8); OB_s(c, '#d9574a', 2.6);
  c.beginPath(); c.moveTo(33.6, -1.6); c.lineTo(38.6, -4.6); c.lineTo(38.8, 1.6); c.closePath(); OB_fo(c, '#d9574a', 1.2);
  c.beginPath(); c.moveTo(33.6, -1.6); c.lineTo(29.4, 2.8); c.lineTo(34.6, 3.8); c.closePath(); OB_fo(c, '#c2453b', 1.2);
  OB_ell(c, 33.6, -1.4, 1.7, 1.7); OB_fo(c, '#ee8273', 1.1);
  // terracotta pot
  OB_shape(c, function () { OB_poly(c, [12.6, 32, 35.4, 32, 33, 43.6, 15, 43.6]); }, P, function () { c.fillStyle = PD; c.fillRect(28.6, 30, 8, 15); c.fillStyle = 'rgba(120,50,30,0.3)'; c.fillRect(10, 32, 28, 3); c.fillStyle = PL; c.fillRect(16, 35.6, 1.8, 6.4); });
  OB_shape(c, function () { OB_rr(c, 10.4, 27.4, 27.2, 5.4, 2); }, P, function () { c.fillStyle = PD; c.fillRect(30.6, 26, 8, 8); c.fillStyle = PL; c.fillRect(13, 28.6, 9, 1.2); });
  // soil line + a little paw stamp on the pot
  OB_dot(c, 24, 38.6, 1.7, PD); OB_dot(c, 21.6, 36.2, 0.8, PD); OB_dot(c, 24, 35.4, 0.8, PD); OB_dot(c, 26.4, 36.2, 0.8, PD);
}
OB_def('topiary', [-3, -40, 52, 49], function (c, o, t, env, id, ga) {
  OB_layer(c, 'topiary', 0, -32, 50, 49, OB_topiaryArt);
  // a butterfly that likes to land on the nose
  var u = OB_fract(t / 15 + id * 0.53);
  if (u < 0.62) {
    var a = u / 0.62, land = OB_ease(Math.min(1, a * 3.2)) * OB_ease(Math.min(1, (1 - a) * 3.2));
    var bx = OB_lerp(24 + Math.sin(t * 0.9 + id) * 20, 45.6, land), by = OB_lerp(-26 + Math.sin(t * 1.7) * 6, -16.4, land);
    c.globalAlpha = ga * Math.min(1, a * 10, (1 - a) * 10);
    OB_butterfly(c, bx, by, t, id + 2, land > 0.97 && OB_fract(t * 0.6) < 0.8);
    c.globalAlpha = ga;
  }
  // the odd leaf the gardener missed
  var lu = OB_fract(t / 9.7 + id * 0.31);
  if (lu < 0.3) { var q = lu / 0.3, lx = 14 + Math.sin(q * 8 + id) * 4 + env.wind * q * 10, ly = OB_lerp(2, 42, q * q); c.globalAlpha = ga * Math.min(1, q * 6, (1 - q) * 4); c.beginPath(); c.ellipse(lx, ly, 2.2, 1.1, q * 6, 0, OB_TAU); c.fillStyle = '#68b052'; c.fill(); c.globalAlpha = ga; }
}, { iconBounds: { x0: 0, y0: -32, x1: 50, y1: 48 } });

/* ===================================== golden bone statue ========================================== */
function OB_bonePath(c) {          // bone along the x axis, centred on 0,0 (length ~36)
  c.beginPath();
  c.moveTo(-11, -3.4); c.lineTo(11, -3.4);
  c.bezierCurveTo(11.4, -9.6, 19.8, -9, 18.2, -3.2); c.bezierCurveTo(20.4, -2, 20.4, 2, 18.2, 3.2);
  c.bezierCurveTo(19.8, 9, 11.4, 9.6, 11, 3.4); c.lineTo(-11, 3.4);
  c.bezierCurveTo(-11.4, 9.6, -19.8, 9, -18.2, 3.2); c.bezierCurveTo(-20.4, 2, -20.4, -2, -18.2, -3.2);
  c.bezierCurveTo(-19.8, -9, -11.4, -9.6, -11, -3.4); c.closePath();
}
var OB_BONE_X = 24, OB_BONE_Y = -6, OB_BONE_ROT = -0.62;
function OB_statueArt(c) {
  var S = '#c4beb0', SD = '#948e82', SL = '#dedacd', G = '#f2c14e', GD = '#c98f2c', GL = '#fff0ae';
  OB_shadow(c, 24, 43.6, 20, 5.4);
  // plinth: base step, shaft, cap
  OB_shape(c, function () { OB_rr(c, 6.4, 37, 35.2, 7.4, 2.2); }, S, function () { c.fillStyle = SD; c.fillRect(32, 36, 11, 10); c.fillRect(5, 42.4, 38, 3); c.fillStyle = SL; c.fillRect(8.6, 38.2, 18, 1.2); });
  OB_shape(c, function () { OB_rr(c, 10, 19.6, 28, 18.4, 1.4); }, S, function () { c.fillStyle = SD; c.fillRect(31.4, 18, 8, 22); c.fillStyle = 'rgba(80,70,60,0.28)'; c.fillRect(9, 19, 30, 3.6); c.fillStyle = SL; c.fillRect(11.8, 23.4, 1.6, 12.6); });
  OB_shape(c, function () { OB_rr(c, 7.4, 14, 33.2, 6.4, 2.2); }, SL, function () { c.fillStyle = S; c.fillRect(6, 17.4, 36, 4); c.fillStyle = SD; c.fillRect(33.6, 13, 8, 8); });
  // brass plaque with a paw
  OB_rr(c, 15.6, 24.6, 16.8, 10, 1.6); OB_fo(c, '#e0aa3c', 1.3); OB_line(c, 17.4, 26.2, 26, 26.2, GL, 0.9);
  OB_dot(c, 24, 31.2, 1.9, '#9a6a1e'); OB_dot(c, 21.2, 28.8, 0.9, '#9a6a1e'); OB_dot(c, 24, 27.8, 0.9, '#9a6a1e'); OB_dot(c, 26.8, 28.8, 0.9, '#9a6a1e');
  // moss + chip
  OB_ell(c, 11, 42.2, 3.2, 1.4); c.fillStyle = '#6fb556'; c.fill(); OB_ell(c, 36.6, 37.4, 2.2, 1); c.fill();
  // golden mount
  OB_shape(c, function () { OB_rr(c, 17, 10.4, 14, 4.4, 1.6); }, G, function () { c.fillStyle = GD; c.fillRect(26, 9, 6, 7); });
  OB_shape(c, function () { OB_poly(c, [20.6, 10.6, 27.4, 10.6, 25.8, -3, 22.2, -3]); }, G, function () { c.fillStyle = GD; c.fillRect(24.6, -4, 4, 16); c.fillStyle = GL; c.fillRect(22.4, 1, 0.9, 8); }, 1.5);
  // the bone
  c.save(); c.translate(OB_BONE_X, OB_BONE_Y); c.rotate(OB_BONE_ROT);
  OB_shape(c, OB_bonePath, G, function () {
    c.fillStyle = GD; c.fillRect(-22, 0.8, 44, 10); OB_ell(c, 15.6, 5.6, 5, 3.6); c.fill(); OB_ell(c, -14, 6, 5, 3.4); c.fill();
    c.fillStyle = GL; OB_rr(c, -10.6, -2.4, 17, 1.6, 0.8); c.fill(); OB_ell(c, -15.4, -5.2, 2.2, 1.3, -0.4); c.fill(); OB_ell(c, 13.6, -5.6, 2.2, 1.3, 0.2); c.fill();
  }, 1.9);
  c.restore();
}
function OB_statueGlowArt(c) {
  var g = c.createRadialGradient(24, -6, 2, 24, -6, 30); g.addColorStop(0, 'rgba(255,232,150,0.9)'); g.addColorStop(1, 'rgba(255,232,150,0)');
  c.fillStyle = g; c.fillRect(-8, -40, 64, 64);
}
OB_def('statue', [-8, -40, 56, 49], function (c, o, t, env, id, ga) {
  OB_layer(c, 'statue', 0, -34, 48, 49, OB_statueArt);
  // sheen sweeping across the gold
  var u = OB_fract(t / 4.2 + id * 0.37);
  if (u < 0.3) {
    var a = u / 0.3;
    c.save(); c.translate(OB_BONE_X, OB_BONE_Y); c.rotate(OB_BONE_ROT); OB_bonePath(c); c.clip();
    c.globalAlpha = ga * 0.75 * Math.sin(a * Math.PI); c.fillStyle = '#fffbe6';
    var sx = -26 + a * 52; OB_poly(c, [sx - 3, -11, sx + 3, -11, sx - 2, 11, sx - 8, 11]); c.fill();
    c.restore();
  }
  // twinkles
  var pts = OB_STATUE_TW;
  for (var i = 0; i < 4; i++) {
    var k = OB_fract((t + pts[i][2] + id * 0.7) / 4.2);
    if (k < 0.28) OB_sparkle(c, pts[i][0], pts[i][1], (i === 0 ? 6.4 : 4.2) * Math.sin(k / 0.28 * Math.PI), '#fffbe6', 1);
  }
  if (env.night > 0.05) {          // it keeps a soft glimmer after dark
    c.globalAlpha = ga * env.night * (0.32 + 0.08 * Math.sin(t * 2.1 + id));
    OB_layer(c, 'statueglow', -8, -40, 56, 24, OB_statueGlowArt);
    c.globalAlpha = ga;
  }
}, {
  iconBounds: { x0: 2, y0: -26, x1: 46, y1: 48 },
  light: function (o, env) { var T = OB_tile(); return { x: ((+o.x || 0) + 0.5) * T, y: ((+o.y || 0) - 0.18) * T, r: T * 1.3, color: '#ffe7a0' }; }
});
var OB_STATUE_TW = [[36, -18.6, 0], [11, 5.4, 1.4], [30, -3.6, 2.7], [15, -13.6, 3.6]];

/* ===================================== lamp post =================================================== */
function OB_lanternGlassPath(c) { OB_poly(c, [17.2, -53.4, 30.8, -53.4, 28.6, -36.6, 19.4, -36.6]); }
function OB_lampArt(c, flip) {
  var I = '#4d4843', ID = '#37332f', IL = '#7f786e', S = '#c4beb0', SD = '#948e82';
  OB_shadow(c, 24, 43.8, 14, 4.6);
  // stone footing
  OB_shape(c, function () { OB_rr(c, 13.4, 38, 21.2, 6.2, 2); }, S, function () { c.fillStyle = SD; c.fillRect(28, 37, 8, 8); c.fillRect(12, 42.6, 24, 2); });
  // iron base (stepped, fluted)
  OB_shape(c, function () { OB_poly(c, [16.6, 38.4, 31.4, 38.4, 29.4, 31.4, 18.6, 31.4]); }, I, function () { c.fillStyle = ID; c.fillRect(26.6, 30, 6, 10); c.fillStyle = IL; c.fillRect(19.6, 32.6, 1.3, 5); }, 1.6);
  OB_shape(c, function () { OB_poly(c, [19.4, 31.6, 28.6, 31.6, 27, 22, 21, 22]); }, I, function () { c.fillStyle = ID; c.fillRect(25.4, 21, 5, 12); c.fillStyle = IL; c.fillRect(21.6, 23.4, 1.1, 7.4); }, 1.6);
  // post
  OB_shape(c, function () { OB_rr(c, 21.6, -34, 4.8, 57, 1); }, I, function () { c.fillStyle = ID; c.fillRect(24.6, -36, 3, 60); c.fillStyle = IL; c.fillRect(22.5, -32, 0.9, 54); }, 1.6);
  // collars
  var ys = [20.4, 0, -20];
  for (var i = 0; i < 3; i++) { OB_rr(c, 20.2, ys[i], 7.6, 3.2, 1.4); OB_fo(c, I, 1.4); OB_line(c, 21.6, ys[i] + 1, 23.6, ys[i] + 1, IL, 0.9); }
  // ladder bar with ball ends + a curly bracket
  OB_rr(c, 9.4, -25.6, 29.2, 2.8, 1.3); OB_fo(c, I, 1.4);
  OB_ell(c, 9, -24.2, 2.2, 2.2); OB_fo(c, I, 1.3); OB_ell(c, 39, -24.2, 2.2, 2.2); OB_fo(c, I, 1.3);
  var bs = flip ? -1 : 1;          // the curly bracket sits on the side away from the flower basket
  c.beginPath(); c.moveTo(24 + bs * 2.6, -12); c.quadraticCurveTo(24 + bs * 12.6, -13, 24 + bs * 11.4, -22.6); OB_s(c, OB_OUT, 3.4); OB_s(c, I, 1.5);
  // lantern cradle
  OB_shape(c, function () { OB_poly(c, [20.4, -33.4, 27.6, -33.4, 29.6, -37, 18.4, -37]); }, I, null, 1.5);
  // glass (day look) + mullions
  OB_shape(c, OB_lanternGlassPath, '#e4ecdc', function () { c.fillStyle = '#c9d6c6'; c.fillRect(24, -55, 8, 20); c.fillStyle = 'rgba(255,255,255,0.8)'; OB_poly(c, [18.6, -51, 20.6, -51, 20, -40, 19.6, -40]); c.fill(); }, 1.6);
  // unlit mantle
  OB_ell(c, 24, -43.4, 2.2, 3.4); c.fillStyle = '#f7e7b0'; c.fill(); OB_s(c, '#c9a960', 0.8);
  OB_line(c, 24, -53, 24, -36.8, OB_OUT, 1.2);
  // roof cap + finial
  OB_shape(c, function () { c.beginPath(); c.moveTo(14.4, -52.8); c.quadraticCurveTo(20.6, -55.4, 21.6, -60.6); c.lineTo(26.4, -60.6); c.quadraticCurveTo(27.4, -55.4, 33.6, -52.8); c.closePath(); }, I,
    function () { c.fillStyle = ID; c.fillRect(25, -62, 10, 10); c.fillStyle = IL; c.beginPath(); c.moveTo(17.6, -54); c.quadraticCurveTo(21, -55.6, 22.2, -59); OB_s(c, IL, 1); }, 1.6);
  OB_ell(c, 24, -62.6, 2.2, 2.2); OB_fo(c, I, 1.4); OB_line(c, 24, -64.6, 24, -67.4, OB_OUT, 1.6);
  OB_dot(c, 23.4, -63.2, 0.6, IL);
}
function OB_lampArtR(c) { OB_lampArt(c, true); }
function OB_lampBasketArt(c) {     // hanging flower basket (chains are drawn live so it can swing); rim centre at (0, 9)
  // trailing greens
  c.beginPath(); c.moveTo(-4.6, 11); c.quadraticCurveTo(-8.4, 14, -6.6, 19.6); c.moveTo(4.4, 11.4); c.quadraticCurveTo(8, 15, 6, 18); OB_s(c, '#3f7d3a', 1.5);
  OB_ell(c, -6.8, 17, 1.5, 1); c.fillStyle = '#5d9d49'; c.fill(); OB_ell(c, 6.4, 16, 1.4, 1); c.fill();
  OB_shape(c, function () { c.beginPath(); c.moveTo(-6, 10); c.quadraticCurveTo(-5, 17, 0, 17); c.quadraticCurveTo(5, 17, 6, 10); c.closePath(); }, '#a8743f',
    function () { c.fillStyle = '#7a4e2a'; c.fillRect(2, 9, 6, 10); OB_line(c, -5, 12.4, 5, 12.4, '#7a4e2a', 0.7); OB_line(c, -4, 14.6, 4, 14.6, '#7a4e2a', 0.7); }, 1.3);
  OB_union(c, [[-4.4, 8.4, 3], [0, 7, 3.4], [4.4, 8.6, 3]], '#4f9a45', 1.2);
  var f = [[-4.6, 7.4, '#f2a0b5'], [0.4, 5.6, '#fbf1d8'], [4.6, 7.8, '#f2a0b5'], [-1.6, 9.4, '#d9574a'], [2.6, 9.8, '#fbf1d8']];
  for (var i = 0; i < f.length; i++) { OB_ell(c, f[i][0], f[i][1], 1.7, 1.7); OB_fo(c, f[i][2], 0.8); OB_dot(c, f[i][0], f[i][1], 0.55, '#f2c14e'); }
}
function OB_lampGlowArt(c) {       // everything that switches on at night, drawn with alpha = night
  var g = c.createRadialGradient(24, -45, 2, 24, -45, 36); g.addColorStop(0, 'rgba(255,226,140,0.7)'); g.addColorStop(0.35, 'rgba(255,214,120,0.28)'); g.addColorStop(1, 'rgba(255,205,110,0)');
  c.fillStyle = g; c.fillRect(-14, -83, 76, 76);
  OB_lanternGlassPath(c); c.fillStyle = '#ffe9a0'; c.fill();
  OB_ell(c, 24, -44, 4.4, 6); c.fillStyle = '#fff6cf'; c.fill();
  OB_ell(c, 24, -43.4, 2, 3.2); c.fillStyle = '#ffffff'; c.fill();
  OB_lanternGlassPath(c); OB_s(c, OB_OUT, 1.6); OB_line(c, 24, -53, 24, -48.6, OB_OUT, 1.2); OB_line(c, 24, -39.4, 24, -36.8, OB_OUT, 1.2);
}
function OB_mothArt(c, fw) {
  c.fillStyle = 'rgba(255,247,220,0.9)'; OB_poly(c, [0, 0, -1.7, -fw * 1.3, -1.8, fw * 0.7]); c.fill(); OB_poly(c, [0, 0, 1.7, -fw * 1.3, 1.8, fw * 0.7]); c.fill(); OB_dot(c, 0, 0, 0.45, '#8a7a66');
}
OB_def('lamp', [-14, -83, 62, 52], function (c, o, t, env, id, ga) {
  var n = env.night, i;
  if (n > 0.02) { c.globalAlpha = ga * n * 0.2; OB_ell(c, 24, 43, 27, 8.6); c.fillStyle = '#ffe29a'; c.fill(); c.globalAlpha = ga; }
  OB_layer(c, (id & 1) ? 'lampR' : 'lampL', 2, -70, 46, 49, (id & 1) ? OB_lampArtR : OB_lampArt);
  // the flower basket swings from the end of the ladder bar
  var px = (id & 1) ? 39 : 9, py = -22.4, sw = Math.sin(t * 1.4 + id) * 1.1 + env.wind * 2.2;
  c.beginPath(); c.moveTo(px, py); c.lineTo(px + sw - 4.4, py + 9.4); c.moveTo(px, py); c.lineTo(px + sw, py + 9); c.moveTo(px, py); c.lineTo(px + sw + 4.4, py + 9.4); OB_s(c, '#5a4a3c', 0.9);
  OB_layer(c, 'lampbasket', -10, 3, 10, 21, OB_lampBasketArt, px + sw, py);
  if (n > 0.02) {
    var fl = 1 + Math.sin(t * 9.1 + id * 3) * 0.04 + Math.sin(t * 23.3 + id) * 0.025;
    c.globalAlpha = ga * Math.min(1, n * fl);
    OB_layer(c, 'lampglow', -14, -83, 62, -7, OB_lampGlowArt);
    // moths
    c.globalAlpha = ga * n;
    for (i = 0; i < 2; i++) {
      var a = t * (2.3 + i * 0.9) + i * 2.4 + id, mx = 24 + Math.cos(a) * (11 + i * 4) + Math.sin(t * 5.1 + i) * 2, my = -45 + Math.sin(a * 1.3) * 9, fi = Math.floor(t * 16 + i) & 1;
      OB_layer(c, 'moth' + fi, -3, -3, 3, 2, fi ? OB_mothArt1 : OB_mothArt0, mx, my);
    }
    c.globalAlpha = ga;
  }
}, {
  iconBounds: { x0: 0, y0: -69, x1: 48, y1: 48 },
  light: function (o, env) { var T = OB_tile(); return { x: ((+o.x || 0) + 0.5) * T, y: ((+o.y || 0) - 0.94) * T, r: T * 3.6, color: '#ffd98a' }; }
});
function OB_mothArt0(c) { OB_mothArt(c, 1.2); }
function OB_mothArt1(c) { OB_mothArt(c, 0.35); }

/* ===================================== apple tree ================================================== */
var OB_CANOPY = [[24, -46, 31, 29], [1, -38, 20, 19], [47, -38, 20, 19], [8, -62, 20, 18], [40, -62, 20, 18], [24, -72, 17, 15],
  [6, -20, 15, 13], [42, -20, 15, 13], [24, -15, 15, 12], [-12, -42, 12, 13], [60, -42, 12, 13], [-7, -25, 10, 9.4], [55, -25, 10, 9.4]];
var OB_APPLES = [['#d9574a', '#a8352f', '#f6a091'], ['#e0604a', '#a8352f', '#f6a091'], ['#c8d45a', '#93a234', '#eef2a6']];
function OB_apple(c, x, y, col, s) {
  s = s || 1;
  OB_line(c, x + 0.4 * s, y - 3 * s, x + 1.4 * s, y - 5.6 * s, '#5a3a1e', 1.1);
  OB_shape(c, function () { c.beginPath(); c.moveTo(x, y - 2.8 * s); c.bezierCurveTo(x + 5.4 * s, y - 5 * s, x + 5.2 * s, y + 4.4 * s, x, y + 3.4 * s); c.bezierCurveTo(x - 5.2 * s, y + 4.4 * s, x - 5.4 * s, y - 5 * s, x, y - 2.8 * s); c.closePath(); }, col[0],
    function () { OB_ell(c, x + 2.4 * s, y + 1.8 * s, 3.2 * s, 3.4 * s); c.fillStyle = col[1]; c.fill(); OB_ell(c, x - 1.7 * s, y - 1 * s, 1 * s, 1.5 * s, 0.5); c.fillStyle = col[2]; c.fill(); }, 1.2);
}
function OB_treeTrunkArt(c, v) {
  var B = '#94603a', BD = '#6d4427', BL = '#b47c4c';
  OB_shadow(c, 24, 43.4, 36, 8.6);
  OB_shape(c, function () {
    c.beginPath(); c.moveTo(9.4, 45); c.quadraticCurveTo(16.4, 42.4, 17, 30); c.quadraticCurveTo(17.6, 12, 13, -6); c.lineTo(9, -16); c.lineTo(17, -16); c.lineTo(22, -4);
    c.lineTo(27.4, -18); c.lineTo(36.6, -18); c.lineTo(32, -4); c.quadraticCurveTo(30, 14, 31, 30); c.quadraticCurveTo(31.6, 42.4, 39, 45);
    c.quadraticCurveTo(34, 46.6, 29.6, 44.6); c.quadraticCurveTo(24, 47.4, 19.4, 44.6); c.quadraticCurveTo(14.6, 46.6, 9.4, 45); c.closePath();
  }, B, function () {
    c.fillStyle = BD; c.beginPath(); c.moveTo(27, -20); c.quadraticCurveTo(24.6, 20, 27.6, 46); c.lineTo(42, 48); c.lineTo(40, -20); c.closePath(); c.fill();
    c.fillStyle = 'rgba(50,30,14,0.35)'; c.fillRect(6, -20, 36, 17);
    c.fillStyle = BL; OB_rr(c, 18.6, 4, 1.8, 22, 0.9); c.fill(); OB_rr(c, 21.4, 14, 1.3, 12, 0.6); c.fill();
    c.strokeStyle = '#55331c'; c.lineWidth = 0.9;
    c.beginPath(); c.moveTo(24.6, 2); c.quadraticCurveTo(23.6, 14, 24.8, 24); c.moveTo(28.2, 20); c.quadraticCurveTo(27.6, 30, 28.8, 38); c.moveTo(20.4, 30); c.quadraticCurveTo(20, 36, 18.6, 41); c.stroke();
  }, 1.9);
  // knot hole
  OB_ell(c, 23.6, 8.6, 2.3, 3); c.fillStyle = '#55331c'; c.fill(); OB_s(c, OB_OUT, 1); c.beginPath(); c.arc(23.6, 8.6, 4, 0.4, 2.4); OB_s(c, '#55331c', 0.8);
  // tufts of grass at the roots
  c.strokeStyle = '#4f9a45'; c.lineWidth = 1.4;
  c.beginPath(); c.moveTo(11, 46); c.lineTo(9.4, 41.4); c.moveTo(11.6, 46); c.lineTo(12.6, 42); c.moveTo(36, 46.2); c.lineTo(36.6, 42); c.moveTo(37, 46.2); c.lineTo(39.4, 42.6); c.stroke();
  if (v !== 1) { OB_shadow(c, 41.4, 46.4, 4, 1.4); OB_apple(c, 41, 43.4, OB_APPLES[v], 0.82); }
  if (v === 2) { OB_shadow(c, 6.6, 45.4, 4, 1.4); OB_apple(c, 6, 42.4, OB_APPLES[v], 0.82); }
}
function OB_treeCanopyArt(c, v) {
  OB_foliage(c, OB_CANOPY, ['#367238', '#4a9543', '#66b052', '#8ed06a'], 900 + v * 17, { density: 34, leaf: 3.3, tick: 1.2, ow: 2 });
  // a few dappled light leaves
  var r = OB_rng(50 + v), i;
  c.fillStyle = '#8ed06a';
  for (i = 0; i < 12; i++) { var a = r() * OB_TAU, d = r() * 0.7; OB_ell(c, 18 + Math.cos(a) * 30 * d - 6, -52 + Math.sin(a) * 26 * d, 2.2, 1.1, r() * 3); c.fill(); }
  // apples
  var col = OB_APPLES[v], spots = [[-9, -38], [6, -21], [31, -20], [55, -36], [58, -52], [46, -73], [1, -72], [24, -81], [-15, -50], [57, -20], [-4, -16], [40, -10], [18, -10]];
  for (i = 0; i < spots.length; i++) {
    if (r() < 0.34) continue;
    var x = spots[i][0] + (r() - 0.5) * 4, y = spots[i][1] + (r() - 0.5) * 4;
    // leaf pair above the apple
    OB_ell(c, x - 2.6, y - 4.6, 3, 1.5, -0.5); c.fillStyle = '#367238'; c.fill(); OB_ell(c, x + 3.4, y - 4.8, 3, 1.5, 0.45); c.fillStyle = '#66b052'; c.fill();
    OB_apple(c, x, y, col, 1);
  }
}
var OB_TUFT = [[13, -50, 15, 13], [30, -57, 14, 12], [23, -42, 14, 11], [38, -45, 12, 10]];
function OB_treeTuftArt(c, v) {     // a clump of leaves in front of the main crown; it sways on its own beat
  OB_foliage(c, OB_TUFT, ['#3c7a3b', '#50a047', '#6fb858', '#97d672'], 300 + v * 5, { density: 30, leaf: 3.1, tick: 1.2, ow: 1.2, oc: '#2c5f30' });
  var col = OB_APPLES[v], sp = v === 1 ? [[16, -47], [34, -50]] : v === 2 ? [[28, -45], [12, -53]] : [[20, -52], [36, -42]];
  for (var i = 0; i < sp.length; i++) {
    OB_ell(c, sp[i][0] - 2.6, sp[i][1] - 4.6, 3, 1.5, -0.5); c.fillStyle = '#367238'; c.fill(); OB_ell(c, sp[i][0] + 3.4, sp[i][1] - 4.8, 3, 1.5, 0.45); c.fillStyle = '#6fb858'; c.fill();
    OB_apple(c, sp[i][0], sp[i][1], col, 1);
  }
}
OB_def('tree', [-38, -92, 96, 53], function (c, o, t, env, id, ga) {
  var v = id % 3, i, w = env.wind, aw = Math.abs(w);
  OB_layer(c, 'treetrunk' + v, -14, -20, 62, 53, function (g) { OB_treeTrunkArt(g, v); });
  // the crown leans and bobs with the breeze (whole-pixel steps, like a hand-animated sprite)
  var gust = 0.5 + 0.5 * Math.sin(t * 0.37 + id * 1.9), ph = t * 0.9 + id * 1.7;
  var dx = w * (1.2 + 0.9 * gust) + Math.sin(ph) * (0.8 + aw * 0.9), dy = Math.cos(t * 1.13 + id) * 0.45;
  OB_layer(c, 'treecanopy' + v, -30, -92, 78, 0, function (g) { OB_treeCanopyArt(g, v); }, dx, dy);
  OB_layer(c, 'treetuft' + v, -6, -74, 54, -28, function (g) { OB_treeTuftArt(g, v); }, w * (2 + 1.2 * gust) + Math.sin(ph + 0.9) * (1.5 + aw * 1.2), dy + Math.sin(t * 1.7 + id) * 0.5);
  // leaves drifting down now and then
  for (i = 0; i < 2; i++) {
    var P = 7.5 + i * 3.1, k = t / P + id * 0.37 + i * 0.5, u = OB_fract(k), n = Math.floor(k);
    if (u < 0.55) {
      var a = u / 0.55, x0 = -10 + OB_h(n, id, i) * 68, lx = x0 + Math.sin(a * 9 + n) * 7 + w * a * 26, ly = OB_lerp(-24, 43, a * (0.6 + 0.4 * a));
      c.globalAlpha = ga * Math.min(1, a * 6, (1 - a) * 5);
      c.beginPath(); c.ellipse(lx, ly, 3.2, 1.5, Math.sin(a * 9 + n) * 1.1 + n, 0, OB_TAU); c.fillStyle = (n & 1) ? '#8ed06a' : '#5aa84a'; c.fill();
      c.globalAlpha = ga;
    }
  }
}, { iconBounds: { x0: -30, y0: -92, x1: 78, y1: 50 } });

/* ===================================== picnic table ================================================ */
function OB_gingham(c, x, y, w, h, step, col) {           // call inside a clip
  c.fillStyle = col;
  for (var i = x; i < x + w; i += step * 2) c.fillRect(i, y, step, h);
  for (var j = y; j < y + h; j += step * 2) c.fillRect(x, j, w, step);
}
function OB_picnicArt(c, v) {
  var W = '#c9935a', WD = '#a8743f', WL = '#e0b078', WDD = '#7a4e2a', i, x;
  // ground shadows
  OB_shadow(c, 48, 89.4, 46, 6.4);
  c.fillStyle = 'rgba(40,26,12,0.26)'; OB_rr(c, 8, 16, 80, 72, 6); c.fill();
  // --- back bench
  for (i = 0; i < 2; i++) { x = i ? 75 : 16; OB_rr(c, x, 17, 5, 9, 1); OB_fo(c, WDD, 1.4); }
  OB_shape(c, function () { OB_rr(c, 8, 5.4, 80, 10.6, 1.6); }, WL, function () { c.strokeStyle = WD; c.lineWidth = 1; c.beginPath(); c.moveTo(8, 10.6); c.lineTo(88, 10.6); c.stroke(); c.fillStyle = 'rgba(255,240,210,0.5)'; c.fillRect(8, 6, 80, 1.2); }, 1.6);
  OB_shape(c, function () { OB_rr(c, 8, 15.6, 80, 3.8, 1.2); }, WD, null, 1.6);
  // --- table legs (behind the front bench)
  for (i = 0; i < 2; i++) { x = i ? 76 : 15; OB_rr(c, x, 60, 5, 22, 1); OB_fo(c, WDD, 1.4); OB_line(c, x + 1.4, 62, x + 1.4, 70, '#94633a', 0.9); }
  OB_rr(c, 14, 66, 68, 3.4, 1); OB_fo(c, '#8a5a30', 1.3);
  // --- table top: four planks + front edge
  OB_shape(c, function () { OB_rr(c, 4, 23, 88, 34.6, 2); }, WL, function () {
    c.fillStyle = '#d6a468'; c.fillRect(4, 23, 88, 4);
    c.strokeStyle = WD; c.lineWidth = 1.1; c.beginPath(); for (var k = 1; k < 4; k++) { c.moveTo(4, 23 + k * 8.65); c.lineTo(92, 23 + k * 8.65); } c.stroke();
    var r = OB_rng(3); c.strokeStyle = 'rgba(168,116,63,0.6)'; c.lineWidth = 0.7;
    for (k = 0; k < 16; k++) { var gx = 7 + r() * 70, gy = 25 + ((r() * 4) | 0) * 8.65 + r() * 4; c.beginPath(); c.moveTo(gx, gy); c.quadraticCurveTo(gx + 5, gy + (r() - 0.5), gx + 7 + r() * 9, gy); c.stroke(); }
    OB_ell(c, 84, 36, 1.8, 1.2); c.strokeStyle = WD; c.lineWidth = 0.8; c.stroke(); OB_ell(c, 12, 52, 1.4, 1); c.stroke();
  }, 1.7);
  OB_shape(c, function () { OB_rr(c, 4, 56.8, 88, 5.2, 1.5); }, WD, function () { c.fillStyle = '#8f5f33'; c.fillRect(4, 60, 88, 3); }, 1.7);
  OB_dot(c, 9, 59.4, 0.9, '#5a3a1e'); OB_dot(c, 87, 59.4, 0.9, '#5a3a1e');
  // --- gingham runner draped over the front
  var cr = v === 1 ? 'rgba(58,168,154,0.62)' : 'rgba(217,87,74,0.62)', crd = v === 1 ? '#2f8a7e' : '#b8403a';
  OB_shape(c, function () {
    c.beginPath(); c.moveTo(25, 22.4); c.lineTo(71, 22.4); c.lineTo(71, 69.6);
    for (var k = 0; k < 5; k++) { var sx = 71 - k * 9.2; c.quadraticCurveTo(sx - 2.3, 72.8, sx - 4.6, 70.2); c.quadraticCurveTo(sx - 6.9, 67.6, sx - 9.2, 69.6); }
    c.closePath();
  }, '#fbf1d8', function () {
    OB_gingham(c, 25.6, 22, 46, 52, 3.83, cr);
    c.fillStyle = 'rgba(90,50,40,0.2)'; c.fillRect(24, 57.2, 48, 18);          // the hanging part sits in shade
    c.fillStyle = 'rgba(255,255,255,0.35)'; c.fillRect(24, 56.4, 48, 1.1);
  }, 1.6);
  // --- plate with a slice of cherry pie
  OB_ell(c, 14.6, 41, 8.4, 4.8); OB_fo(c, '#fbf6ea', 1.4); OB_ell(c, 14.6, 40.8, 5.6, 2.9); OB_s(c, '#d9d0bd', 0.9);
  OB_shape(c, function () { OB_poly(c, [9.6, 41.4, 19.6, 37, 20.4, 41.8]); }, '#c2453b', null, 1.2);
  OB_shape(c, function () { OB_poly(c, [9.6, 40, 19.6, 35.4, 20.6, 37.4, 19.6, 37.2]); }, '#e8b860', null, 1.2);
  OB_line(c, 19.8, 35.6, 20.6, 41.6, OB_OUT, 1.2); OB_line(c, 20, 36.6, 20.4, 40.6, '#e8b860', 1.6);
  // --- wicker basket with a baguette and apples
  OB_shadow(c, 41.4, 50.6, 13, 3);
  c.beginPath(); c.moveTo(31.4, 36); c.quadraticCurveTo(41, 14, 50.6, 36); OB_s(c, OB_OUT, 4.6); c.beginPath(); c.moveTo(31.4, 36); c.quadraticCurveTo(41, 14, 50.6, 36); OB_s(c, '#a8743f', 2.4);
  c.beginPath(); c.moveTo(31.4, 36); c.quadraticCurveTo(41, 14, 50.6, 36); c.setLineDash([1.6, 2.6]); OB_s(c, '#7a4e2a', 0.9); c.setLineDash([]);
  c.save(); c.translate(46, 30); c.rotate(-0.9); OB_shape(c, function () { OB_rr(c, -10, -3, 20, 6, 3); }, '#e3b062', function () { c.strokeStyle = '#b87e34'; c.lineWidth = 1; c.beginPath(); for (var k = -6; k < 9; k += 4.4) { c.moveTo(k, -2.4); c.lineTo(k + 1.8, 2.4); } c.stroke(); }, 1.3); c.restore();
  OB_apple(c, 37, 33.6, OB_APPLES[0], 0.95);
  OB_shape(c, function () { OB_poly(c, [28.6, 36, 36, 31.6, 40, 37]); }, '#fbf1d8', function () { OB_gingham(c, 28, 30, 14, 8, 1.5, 'rgba(58,168,154,0.6)'); }, 1.1);
  OB_shape(c, function () { c.beginPath(); c.moveTo(29, 36.4); c.lineTo(53, 36.4); c.quadraticCurveTo(52.6, 49.6, 49.6, 49.6); c.lineTo(32.4, 49.6); c.quadraticCurveTo(29.4, 49.6, 29, 36.4); c.closePath(); }, '#cf9a58', function () {
    c.fillStyle = '#a8743f'; c.fillRect(46, 36, 8, 15);
    c.strokeStyle = '#8a5a30'; c.lineWidth = 0.9; c.beginPath();
    for (var j = 0; j < 3; j++) for (var k = 0; k < 6; k++) { var wx = 29.6 + k * 4.2 + (j & 1) * 2.1, wy = 39.6 + j * 3.6; c.moveTo(wx, wy); c.quadraticCurveTo(wx + 1.6, wy - 1.6, wx + 3.2, wy); }
    c.stroke();
    c.fillStyle = 'rgba(255,236,190,0.6)'; c.fillRect(30.6, 38, 1.4, 10);
  }, 1.6);
  OB_shape(c, function () { OB_rr(c, 27.8, 34.6, 26.4, 3.6, 1.6); }, '#b98247', null, 1.4);
  // --- lemonade pitcher
  OB_shadow(c, 62, 47.4, 7.4, 2.2);
  c.beginPath(); c.moveTo(66.4, 31.4); c.quadraticCurveTo(72.6, 32, 67.4, 41); OB_s(c, OB_OUT, 3.6); c.beginPath(); c.moveTo(66.4, 31.4); c.quadraticCurveTo(72.6, 32, 67.4, 41); OB_s(c, '#e6f3f2', 1.5);
  OB_shape(c, function () { c.beginPath(); c.moveTo(55, 26.4); c.lineTo(67.6, 27.4); c.quadraticCurveTo(69.4, 40, 66.6, 46.4); c.lineTo(57.6, 46.4); c.quadraticCurveTo(54.6, 40, 57, 29.4); c.closePath(); }, 'rgba(232,246,246,0.92)', function () {
    c.fillStyle = '#f7dc6a'; c.fillRect(52, 31.6, 20, 16); c.fillStyle = '#e8c244'; c.fillRect(64.4, 31.6, 6, 16);
    c.fillStyle = '#fdf2b0'; c.fillRect(52, 31.6, 20, 1.3);
    OB_ell(c, 61.4, 36.6, 3, 3); c.fillStyle = '#fdf2b0'; c.fill(); OB_s(c, '#e0b43a', 0.9); OB_line(c, 59, 36.6, 63.8, 36.6, '#e0b43a', 0.6); OB_line(c, 61.4, 34.2, 61.4, 39, '#e0b43a', 0.6);
    OB_rr(c, 58.4, 41, 3, 3, 0.6); c.fillStyle = 'rgba(255,255,255,0.7)'; c.fill(); OB_rr(c, 62.6, 42.4, 2.6, 2.6, 0.6); c.fill();
    c.fillStyle = 'rgba(255,255,255,0.75)'; c.fillRect(57.4, 30, 1.3, 13);
  }, 1.5);
  // --- two glasses with straws
  for (i = 0; i < 2; i++) {
    x = 75.6 + i * 8; var y = 41 + i * 5;
    OB_shadow(c, x + 0.4, y + 8.6, 4, 1.4);
    OB_line(c, x + 1, y + 1, x + 3.8, y - 6.6, OB_OUT, 2.6); OB_line(c, x + 1, y + 1, x + 3.8, y - 6.6, i ? '#d9574a' : '#3aa89a', 1.2);
    OB_shape(c, function () { OB_poly(c, [x - 3.4, y - 1.6, x + 3.4, y - 1.6, x + 2.6, y + 8, x - 2.6, y + 8]); }, 'rgba(232,246,246,0.92)', function () { c.fillStyle = '#f7dc6a'; c.fillRect(x - 4, y + 1, 8, 8); c.fillStyle = '#fdf2b0'; c.fillRect(x - 4, y + 1, 8, 1); c.fillStyle = 'rgba(255,255,255,0.75)'; c.fillRect(x - 2.2, y, 1, 7); }, 1.3);
  }
  // --- front bench
  for (i = 0; i < 2; i++) { x = i ? 76 : 15; OB_rr(c, x, 82, 5, 10.6, 1); OB_fo(c, WDD, 1.4); }
  OB_shape(c, function () { OB_rr(c, 8, 69.4, 80, 11.4, 1.6); }, WL, function () {
    c.fillStyle = '#d6a468'; c.fillRect(8, 69.4, 80, 2.6);
    c.strokeStyle = WD; c.lineWidth = 1; c.beginPath(); c.moveTo(8, 75.2); c.lineTo(88, 75.2); c.stroke();
    var r = OB_rng(8); c.strokeStyle = 'rgba(168,116,63,0.6)'; c.lineWidth = 0.7;
    for (var k = 0; k < 7; k++) { var gx = 11 + r() * 62, gy = 71.6 + ((r() * 2) | 0) * 5.6 + r() * 1.6; c.beginPath(); c.moveTo(gx, gy); c.lineTo(gx + 6 + r() * 9, gy + 0.3); c.stroke(); }
  }, 1.7);
  OB_shape(c, function () { OB_rr(c, 8, 80.2, 80, 4.4, 1.4); }, WD, function () { c.fillStyle = '#8f5f33'; c.fillRect(8, 82.8, 80, 2); }, 1.7);
}
function OB_beeArt(c, d, wf) {
  c.fillStyle = 'rgba(255,255,255,0.85)'; OB_ell(c, -0.8, -1.9, 1.5, 1 + wf * 0.9, -0.5); c.fill(); OB_ell(c, 0.9, -1.9, 1.5, 1 + wf * 0.9, 0.5); c.fill();
  OB_ell(c, 0, 0, 2.3, 1.7); OB_fo(c, '#f2c14e', 0.9); OB_line(c, -0.5 * d, -1.4, -0.5 * d, 1.4, OB_OUT, 0.8); OB_line(c, 0.7 * d, -1.2, 0.7 * d, 1.2, OB_OUT, 0.8);
  OB_dot(c, 1.7 * d, -0.2, 0.5, OB_OUT);
}
OB_def('picnic', [0, 0, 96, 97], function (c, o, t, env, id) {
  var v = id % 2;
  OB_layer(c, 'picnic' + v, 0, 0, 96, 97, function (g) { OB_picnicArt(g, v); });
  // glint on the pitcher + a bee that fancies the lemonade
  var gl = OB_fract(t / 3.7 + id * 0.3); if (gl < 0.2) OB_sparkle(c, 58.4, 31.4, 3.6 * Math.sin(gl / 0.2 * Math.PI), '#ffffff', 1);
  var a = t * 1.7 + id, bx = 62 + Math.cos(a) * 10 + Math.sin(t * 4.3) * 1.6, by = 20 + Math.sin(a * 1.4) * 5 + Math.cos(t * 5.1) * 1.2, d = Math.sin(a) > 0 ? -1 : 1, f = Math.floor(t * 18) & 1;
  OB_layer(c, 'bee' + d + f, -4, -5, 4, 3, function (g) { OB_beeArt(g, d, f); }, bx, by);
});

/* ===================================== fountain ==================================================== */
var OB_FT_WATER = '#66bde3', OB_FT_DEEP = '#3f8fc4';
function OB_fountainArt(c) {
  var S = '#c9c3b5', SD = '#9a9488', SL = '#e2ddd0', i;
  OB_shadow(c, 48, 88, 47, 9);
  // --- basin wall (front face) and rim
  OB_shape(c, function () { c.beginPath(); c.moveTo(4, 64); c.lineTo(4, 73); c.ellipse(48, 73, 44, 21, 0, Math.PI, 0, true); c.lineTo(92, 64); c.closePath(); }, S, function () {
    OB_ell(c, 74, 84, 34, 18); c.fillStyle = SD; c.fill();
    c.fillStyle = 'rgba(80,70,60,0.25)'; c.beginPath(); c.ellipse(48, 67.4, 44, 21, 0, 0, Math.PI); c.lineTo(4, 60); c.lineTo(92, 60); c.fill();
    // block joints following the curve
    c.strokeStyle = '#857f73'; c.lineWidth = 0.9; c.beginPath();
    for (var k = 1; k < 10; k++) { var a = Math.PI * k / 10, x = 48 + Math.cos(a) * 44, y = 64 + Math.sin(a) * 21; c.moveTo(x, y + 1.6); c.lineTo(x, y + 8.6); }
    c.stroke();
    // carved paw medallion
    OB_ell(c, 48, 90, 5, 3.6); c.fillStyle = SL; c.fill(); OB_s(c, '#857f73', 0.9);
    OB_dot(c, 48, 90.8, 1.5, SD); OB_dot(c, 45.8, 88.8, 0.7, SD); OB_dot(c, 48, 88, 0.7, SD); OB_dot(c, 50.2, 88.8, 0.7, SD);
  });
  OB_shape(c, function () { OB_ell(c, 48, 64, 44, 21); }, SL, function () { c.beginPath(); c.ellipse(48, 64, 44, 21, 0, 0, OB_TAU); c.ellipse(44, 61, 44, 21, 0, 0, OB_TAU, true); c.fillStyle = S; c.fill('evenodd'); });
  // water in the basin
  OB_shape(c, function () { OB_ell(c, 48, 64.4, 38, 16.6); }, OB_FT_DEEP, function () {
    OB_ell(c, 48, 68.4, 38, 16.6); c.fillStyle = OB_FT_WATER; c.fill();
    OB_ell(c, 42, 74, 20, 5); c.fillStyle = 'rgba(143,211,240,0.55)'; c.fill();
    // coins someone wished on
    OB_ell(c, 24, 70, 1.5, 0.9); c.fillStyle = 'rgba(242,193,78,0.8)'; c.fill(); OB_ell(c, 66, 76, 1.5, 0.9); c.fill(); OB_ell(c, 35, 77, 1.3, 0.8); c.fill(); OB_ell(c, 74, 67, 1.3, 0.8); c.fill();
  }, 1.5);
  // --- lower pedestal
  OB_ell(c, 48, 66.6, 10.6, 4); c.fillStyle = 'rgba(40,90,130,0.35)'; c.fill();
  OB_shape(c, function () {
    c.beginPath(); c.moveTo(40.6, 66); c.quadraticCurveTo(41.4, 60.6, 44, 58.6); c.quadraticCurveTo(41.6, 50, 44.4, 41); c.lineTo(51.6, 41);
    c.quadraticCurveTo(54.4, 50, 52, 58.6); c.quadraticCurveTo(54.6, 60.6, 55.4, 66); c.quadraticCurveTo(48, 69, 40.6, 66); c.closePath();
  }, S, function () { c.fillStyle = SD; c.fillRect(49.6, 38, 8, 32); c.fillStyle = 'rgba(80,70,60,0.3)'; c.fillRect(40, 40, 16, 5); c.fillStyle = SL; c.fillRect(44.6, 46, 1.5, 12); });
  OB_shape(c, function () { OB_rr(c, 42.6, 57, 10.8, 2.6, 1.2); }, S, null, 1.3);
  // --- middle bowl
  OB_shape(c, function () { c.beginPath(); c.moveTo(24.6, 30); c.quadraticCurveTo(29, 41.6, 44, 42.6); c.lineTo(52, 42.6); c.quadraticCurveTo(67, 41.6, 71.4, 30); c.closePath(); }, S, function () {
    OB_ell(c, 62, 40, 16, 9); c.fillStyle = SD; c.fill(); c.fillStyle = 'rgba(80,70,60,0.22)'; c.fillRect(24, 30, 48, 4.4); OB_ell(c, 33, 34.6, 4, 1.5, 0.6); c.fillStyle = SL; c.fill();
    c.strokeStyle = '#857f73'; c.lineWidth = 0.9; c.beginPath(); c.moveTo(38, 35.4); c.quadraticCurveTo(40, 39.4, 43, 41.6); c.moveTo(58, 35.4); c.quadraticCurveTo(56, 39.4, 53, 41.6); c.moveTo(48, 36); c.lineTo(48, 42); c.stroke();
  });
  OB_shape(c, function () { OB_ell(c, 48, 30, 23.4, 7.4); }, SL, function () { c.beginPath(); c.ellipse(48, 30, 23.4, 7.4, 0, 0, OB_TAU); c.ellipse(45.6, 28.8, 23.4, 7.4, 0, 0, OB_TAU, true); c.fillStyle = S; c.fill('evenodd'); });
  OB_shape(c, function () { OB_ell(c, 48, 30.2, 19.6, 5.2); }, OB_FT_DEEP, function () { OB_ell(c, 48, 32, 19.6, 5.2); c.fillStyle = OB_FT_WATER; c.fill(); }, 1.3);
  // --- upper column
  OB_shape(c, function () { c.beginPath(); c.moveTo(43.6, 30.6); c.quadraticCurveTo(44.4, 27, 45.6, 25.6); c.quadraticCurveTo(44.4, 18, 45.8, 10.6); c.lineTo(50.2, 10.6); c.quadraticCurveTo(51.6, 18, 50.4, 25.6); c.quadraticCurveTo(51.6, 27, 52.4, 30.6); c.quadraticCurveTo(48, 32.6, 43.6, 30.6); c.closePath(); }, S,
    function () { c.fillStyle = SD; c.fillRect(48.8, 8, 6, 26); c.fillStyle = 'rgba(80,70,60,0.3)'; c.fillRect(43, 10, 10, 4); });
  // --- top bowl
  OB_shape(c, function () { c.beginPath(); c.moveTo(35.6, 4.6); c.quadraticCurveTo(38, 11.4, 45.6, 12); c.lineTo(50.4, 12); c.quadraticCurveTo(58, 11.4, 60.4, 4.6); c.closePath(); }, S, function () { OB_ell(c, 56, 11, 8, 6); c.fillStyle = SD; c.fill(); });
  OB_shape(c, function () { OB_ell(c, 48, 4.4, 12.6, 4.4); }, SL, null, 1.7);
  OB_shape(c, function () { OB_ell(c, 48, 4.6, 9.8, 2.9); }, OB_FT_DEEP, function () { OB_ell(c, 48, 5.8, 9.8, 2.9); c.fillStyle = OB_FT_WATER; c.fill(); }, 1.2);
  // --- finial (a stone bud)
  OB_shape(c, function () { c.beginPath(); c.moveTo(45.4, 4.6); c.quadraticCurveTo(43.4, -2.4, 48, -7); c.quadraticCurveTo(52.6, -2.4, 50.6, 4.6); c.quadraticCurveTo(48, 5.8, 45.4, 4.6); c.closePath(); }, SL, function () { c.fillStyle = SD; c.fillRect(48.6, -8, 5, 14); }, 1.5);
  // moss
  c.fillStyle = '#6fb556'; OB_ell(c, 12, 80, 3.4, 1.5, 0.5); c.fill(); OB_ell(c, 85, 76, 2.4, 1.2, -0.6); c.fill(); OB_ell(c, 30, 32.6, 2.4, 1, 0.4); c.fill();
}
// one falling stream (x0,y0 -> x1,y1) with sliding highlights and a splash where it lands; ph = loop phase 0..1
function OB_stream(c, x0, y0, x1, y1, w, ph, splash) {
  var cx = x0 + (x1 - x0) * 0.85, cy = y0 + (y1 - y0) * 0.2, k, u, a, b;
  c.beginPath(); c.moveTo(x0, y0); c.quadraticCurveTo(cx, cy, x1, y1);
  c.strokeStyle = 'rgba(63,143,196,0.55)'; c.lineWidth = w + 1.4; c.stroke();
  c.strokeStyle = 'rgba(190,232,250,0.95)'; c.lineWidth = w; c.stroke();
  c.strokeStyle = '#ffffff'; c.lineWidth = Math.max(0.8, w * 0.42);
  c.beginPath();
  for (k = 0; k < 3; k++) {
    u = OB_fract(ph + k / 3); a = u * u * 0.86; b = Math.min(1, a + 0.14);
    c.moveTo(OB_qb(x0, cx, x1, a), OB_qb(y0, cy, y1, a)); c.lineTo(OB_qb(x0, cx, x1, b), OB_qb(y0, cy, y1, b));
  }
  c.stroke();
  if (splash) {
    for (k = 0; k < 2; k++) { u = OB_fract(ph + k * 0.5); c.globalAlpha = (1 - u) * 0.9; OB_ell(c, x1, y1 + 0.6, 1.6 + u * splash * 5.4, 0.7 + u * splash * 2.2); c.strokeStyle = '#ffffff'; c.lineWidth = 1; c.stroke(); }
    c.globalAlpha = 1; c.fillStyle = '#e6f6fd';
    for (k = 0; k < 2; k++) { u = OB_fract(ph * 2 + k * 0.5); OB_ell(c, x1 + (k ? 1 : -1) * (1 + u * 3.4) * splash, y1 - Math.sin(u * Math.PI) * 4 * splash, 0.9, 0.9); c.fill(); }
  }
}
function OB_qb(a, b, d, u) { var v = 1 - u; return v * v * a + 2 * v * u * b + u * u * d; }
var OB_FT_FRAMES = 12, OB_FT_LOOP = 0.72, OB_ftLast = null;
// frame k of the looping fountain: stonework plus all the moving water
function OB_fountainFrame(c, k) {
  var i, a, p = k / OB_FT_FRAMES;
  OB_fountainArt(c);
  // bubbling crown on the finial
  var bw = Math.sin(p * OB_TAU * 2) * 0.6;
  OB_ell(c, 48, -8.6 + bw * 0.3, 3.4 + bw * 0.4, 2.8 - bw * 0.3); c.fillStyle = '#d8f1fb'; c.fill(); OB_s(c, '#3f8fc4', 0.9);
  OB_dot(c, 47, -9.4, 0.9, '#ffffff');
  c.fillStyle = '#e6f6fd';
  for (i = 0; i < 4; i++) { var du = OB_fract(p + i * 0.25), da = -1.57 + (i - 1.5) * 0.7; OB_ell(c, 48 + Math.cos(da) * du * 9, -9 + Math.sin(da) * du * 7 + du * du * 13, 1, 1.1); c.fill(); }
  // finial dribbles into the top bowl
  OB_stream(c, 46.4, -6.6, 44.4, 4, 1.3, p + 0.3, 0); OB_stream(c, 49.6, -6.6, 51.6, 4, 1.3, p + 0.7, 0);
  // top bowl -> middle bowl
  var xs = [-10.6, -4, 4, 10.6];
  for (i = 0; i < 4; i++) OB_stream(c, 48 + xs[i], 6.2 + (1 - Math.abs(xs[i]) / 12) * 2, 48 + xs[i] * 1.32, 30.2 + (1 - Math.abs(xs[i]) / 12) * 3, 1.9, p + i * 0.23, 0.55);
  // middle bowl -> basin
  for (i = 0; i < 6; i++) {
    a = Math.PI * (0.07 + 0.86 * i / 5);
    OB_stream(c, 48 + Math.cos(a) * 22.4, 30.6 + Math.sin(a) * 6.6, 48 + Math.cos(a) * 27, 65 + Math.sin(a) * 10.6, 2.5, p + i * 0.31, 1);
  }
}
OB_def('fountain', [0, -16, 96, 98], function (c, o, t, env, id, ga) {
  var F = OB_FT_FRAMES, k = Math.floor(OB_fract(t / OB_FT_LOOP + id * 0.37) * F) % F, i;
  OB_ftLast = OB_layer(c, 'fountain' + k, 0, -16, 96, 98, function (g) { OB_fountainFrame(g, k); }, 0, 0, OB_ftLast);
  // slow glints drifting on the basin, and a rainbow-ish sparkle in the spray now and then
  c.strokeStyle = 'rgba(255,255,255,0.7)'; c.lineWidth = 1; c.beginPath();
  for (i = 0; i < 4; i++) { var u = OB_fract(t * 0.22 + i * 0.25 + id * 0.37), sx = 14 + ((i * 37) % 56) + u * 6, sy = 72 + ((i * 23) % 8); c.moveTo(sx, sy); c.lineTo(sx + 4 + (i & 1) * 3, sy); }
  c.stroke();
  var sp = OB_fract(t / 2.9 + id * 0.4); if (sp < 0.22) { var n = Math.floor(t / 2.9 + id * 0.4); OB_sparkle(c, 24 + OB_h(n, id, 1) * 48, 4 + OB_h(n, id, 2) * 44, 4 * Math.sin(sp / 0.22 * Math.PI), '#ffffff', 0.95); }
});

/* ===================================== lily pond =================================================== */
var OB_POND_PTS = [6, 52, 14, 22, 44, 9, 78, 15, 108, 7, 137, 26, 139, 58, 120, 85, 88, 91, 52, 88, 20, 82];
var OB_POND_PADS = [[38, 37, 10.5, 5.6, 2.4], [57, 66, 9.4, 5, 0.6], [101, 35, 11, 5.8, 5.2], [114, 62, 9, 4.8, 3.6], [84, 74, 7, 3.8, 1.4], [27, 58, 6.6, 3.6, 4.4], [76, 27, 6.4, 3.4, 0.2]];
var OB_pondOutline = null;     // sampled outline, lazily built: [x, y, ...]
function OB_pondScaled(k, dx, dy) {
  var p = [], i, cx = 72, cy = 50;
  for (i = 0; i < OB_POND_PTS.length; i += 2) p.push(cx + (OB_POND_PTS[i] - cx) * k + (dx || 0), cy + (OB_POND_PTS[i + 1] - cy) * k + (dy || 0));
  return p;
}
function OB_pondSample() {
  if (OB_pondOutline) return OB_pondOutline;
  var P = OB_pondScaled(0.955), n = P.length / 2, out = [], i, s;
  for (i = 0; i < n; i++) {
    var x0 = P[i * 2], y0 = P[i * 2 + 1], xp = P[(i + n - 1) % n * 2], yp = P[(i + n - 1) % n * 2 + 1], x1 = P[(i + 1) % n * 2], y1 = P[(i + 1) % n * 2 + 1];
    var ax = (xp + x0) / 2, ay = (yp + y0) / 2, bx = (x0 + x1) / 2, by = (y0 + y1) / 2;
    for (s = 0; s < 12; s++) { var u = s / 12; out.push(OB_qb(ax, x0, bx, u), OB_qb(ay, y0, by, u)); }
  }
  // resample at even arc length
  var len = 0, L = [0], m = out.length / 2;
  for (i = 1; i <= m; i++) { len += Math.hypot(out[(i % m) * 2] - out[(i - 1) * 2], out[(i % m) * 2 + 1] - out[(i - 1) * 2 + 1]); L.push(len); }
  var cnt = Math.round(len / 10.4), res = [], j = 0;
  for (i = 0; i < cnt; i++) {
    var d = i / cnt * len; while (L[j + 1] < d) j++;
    var f = (d - L[j]) / (L[j + 1] - L[j] || 1), a = j % m, b = (j + 1) % m;
    res.push(OB_lerp(out[a * 2], out[b * 2], f), OB_lerp(out[a * 2 + 1], out[b * 2 + 1], f));
  }
  return (OB_pondOutline = res);
}
function OB_pondArt(c) {
  var i, r = OB_rng(12);
  // damp earth + darker grass collar
  OB_smooth(c, OB_pondScaled(1.0)); c.fillStyle = '#5d9d49'; c.fill(); c.strokeStyle = '#5d9d49'; c.lineWidth = 5; c.stroke();
  OB_smooth(c, OB_pondScaled(0.96)); c.fillStyle = '#7a5a3a'; c.fill();
  // water
  var W = OB_pondScaled(0.9);
  OB_smooth(c, W); c.fillStyle = '#5cb6dd'; c.fill();
  OB_in(c, function () {
    OB_smooth(c, OB_pondScaled(0.66, 2, 3)); c.fillStyle = '#4aa3d2'; c.fill();
    OB_smooth(c, OB_pondScaled(0.4, 6, 5)); c.fillStyle = '#3f93c6'; c.fill();
    // shade under the far rim, light on the near shallows
    OB_smooth(c, OB_pondScaled(0.9, 0, 7)); c.rect(-10, -10, 170, 120); c.fillStyle = 'rgba(30,80,120,0.45)'; c.fill('evenodd');
    OB_smooth(c, OB_pondScaled(0.9, 0, -5)); c.rect(-10, -10, 170, 120); c.fillStyle = 'rgba(170,228,245,0.55)'; c.fill('evenodd');
    // pebbles on the bottom
    for (var k = 0; k < 9; k++) { OB_ell(c, 24 + r() * 96, 26 + r() * 52, 1.6 + r() * 1.6, 1 + r() * 0.8); c.fillStyle = 'rgba(40,90,130,0.28)'; c.fill(); }
  });
  OB_smooth(c, W); OB_s(c, OB_OUT, 1.6);
  // rim stones, far ones first so near ones overlap
  var S = OB_pondSample(), order = [];
  for (i = 0; i < S.length / 2; i++) order.push(i);
  order.sort(function (a, b) { return S[a * 2 + 1] - S[b * 2 + 1]; });
  for (i = 0; i < order.length; i++) {
    var k2 = order[i], x = S[k2 * 2], y = S[k2 * 2 + 1], rr2 = OB_rng(k2 * 91 + 7), rx = 6.2 + rr2() * 1.8, ry = 4.6 + rr2() * 1.2, col = OB_STONE_COLS[(rr2() * 5) | 0];
    OB_blob(c, x, y + 2.4, rx, ry, k2 * 5 + 2, 7, 0.1); OB_fo(c, '#8a8478', 1.5);
    OB_shape(c, function () { OB_blob(c, x, y, rx, ry, k2 * 5 + 2, 7, 0.1); }, col, function () {
      OB_ell(c, x + rx * 0.5, y + ry * 0.6, rx * 0.8, ry * 0.6); c.fillStyle = 'rgba(120,108,94,0.5)'; c.fill();
      OB_ell(c, x - rx * 0.3, y - ry * 0.4, rx * 0.4, ry * 0.26, -0.3); c.fillStyle = 'rgba(255,252,240,0.6)'; c.fill();
    }, 1.5);
    if (rr2() < 0.22) { OB_ell(c, x + (rr2() - 0.5) * 6, y - ry * 0.4, 2.6, 1.3, rr2()); c.fillStyle = '#6fb556'; c.fill(); }
  }
  // grass tufts hugging the rim
  c.strokeStyle = '#4f9a45'; c.lineWidth = 1.5; c.beginPath();
  var tf = [[10, 74], [36, 93], [104, 94], [136, 76], [142, 44]];
  for (i = 0; i < tf.length; i++) { var tx = tf[i][0], ty = tf[i][1]; c.moveTo(tx, ty); c.lineTo(tx - 2.4, ty - 5); c.moveTo(tx, ty); c.lineTo(tx + 0.4, ty - 6.4); c.moveTo(tx, ty); c.lineTo(tx + 2.8, ty - 4.6); }
  c.stroke();
}
function OB_lilyPad(c, p, withFlower, pink) {
  var x = p[0], y = p[1], rx = p[2], ry = p[3], a0 = p[4];
  OB_ell(c, x + 1, y + 2, rx, ry); c.fillStyle = 'rgba(30,80,120,0.3)'; c.fill();
  OB_shape(c, function () { c.beginPath(); c.moveTo(x, y); c.ellipse(x, y, rx, ry, 0, a0 + 0.22, a0 + OB_TAU - 0.22); c.closePath(); }, '#5aa64c', function () {
    OB_ell(c, x + rx * 0.3, y + ry * 0.45, rx * 0.9, ry * 0.7); c.fillStyle = '#478c40'; c.fill();
    c.strokeStyle = '#3f7d3a'; c.lineWidth = 0.7; c.beginPath();
    for (var k = 1; k < 6; k++) { var a = a0 + k / 6 * OB_TAU; c.moveTo(x, y); c.lineTo(x + Math.cos(a) * rx * 0.82, y + Math.sin(a) * ry * 0.82); }
    c.stroke();
    OB_ell(c, x - rx * 0.35, y - ry * 0.45, rx * 0.3, ry * 0.2, -0.3); c.fillStyle = 'rgba(200,240,170,0.7)'; c.fill();
  }, 1.4);
  if (withFlower) {
    var fx = x + Math.cos(a0 + 3.4) * rx * 0.3, fy = y - 1.6, pc = pink ? ['#f2a0b5', '#e07a9a', '#fbd3de'] : ['#fffdf4', '#e6dcc8', '#ffffff'], i;
    for (i = 0; i < 5; i++) {            // outer petals
      var a = Math.PI * (1.08 + 0.84 * i / 4);
      c.save(); c.translate(fx, fy); c.rotate(a + Math.PI / 2);
      OB_shape(c, function () { c.beginPath(); c.moveTo(0, 0.6); c.quadraticCurveTo(-2.6, -2.6, 0, -6.6); c.quadraticCurveTo(2.6, -2.6, 0, 0.6); c.closePath(); }, i % 2 ? pc[0] : pc[1], null, 1);
      c.restore();
    }
    for (i = 0; i < 3; i++) {
      c.save(); c.translate(fx, fy + 0.6); c.rotate((i - 1) * 0.55);
      OB_shape(c, function () { c.beginPath(); c.moveTo(0, 0.8); c.quadraticCurveTo(-2.4, -2, 0, -5.4); c.quadraticCurveTo(2.4, -2, 0, 0.8); c.closePath(); }, i === 1 ? pc[2] : pc[0], null, 1);
      c.restore();
    }
    OB_dot(c, fx, fy - 0.2, 1.2, '#f2c14e');
  }
}
function OB_pondPadsArt(c) {
  for (var i = 0; i < OB_POND_PADS.length; i++) OB_lilyPad(c, OB_POND_PADS[i], i === 0 || i === 3 || i === 6, i !== 6);
}
function OB_reedsArt(c) {          // cattail clump; base at (0,0)
  var L = [[-7, -26, -0.5], [-2.4, -36, -0.12], [3, -30, 0.2], [7.4, -20, 0.55]], i;
  c.strokeStyle = OB_OUT; c.lineWidth = 3.2; c.beginPath();
  for (i = 0; i < L.length; i++) { c.moveTo(L[i][0] * 0.4, 0); c.quadraticCurveTo(L[i][0] * 0.5, L[i][1] * 0.6, L[i][0] + L[i][2] * 6, L[i][1]); }
  c.stroke(); c.strokeStyle = '#5d9d49'; c.lineWidth = 1.6; c.stroke();
  // blades
  for (i = 0; i < 3; i++) { var bx = [-9, 10, 1][i], by = [-15, -13, -17][i]; OB_shape(c, function () { c.beginPath(); c.moveTo(bx * 0.2 - 1.4, 0); c.quadraticCurveTo(bx * 0.5, by * 0.7, bx, by); c.quadraticCurveTo(bx * 0.7, by * 0.5, bx * 0.2 + 1.6, 0); c.closePath(); }, i === 1 ? '#4f9a45' : '#6fb556', null, 1.1); }
  // cattail heads
  for (i = 0; i < 3; i++) { var h = L[i]; c.save(); c.translate(h[0] + h[2] * 4.6, h[1] + 5); c.rotate(h[2] * 0.5); OB_shape(c, function () { OB_rr(c, -2.1, -5.4, 4.2, 10.4, 2.1); }, '#7a4e2a', function () { c.fillStyle = '#94633a'; c.fillRect(-1.5, -5, 1.2, 9); }, 1.2); c.restore(); }
}
function OB_koi(c, x, y, ang, wag, s, col, patch) {
  c.save(); c.translate(x, y); c.rotate(ang); c.scale(s, s);
  c.globalAlpha = 0.22; OB_ell(c, 1, 4, 9, 3, 0); c.fillStyle = '#1e4a6e'; c.fill();
  c.globalAlpha = 0.92;
  c.fillStyle = col;
  // pectoral fins
  c.beginPath(); c.moveTo(3.4, -2); c.lineTo(0.4, -6.4); c.lineTo(0.6, -2.4); c.moveTo(3.4, 2); c.lineTo(0.4, 6.4); c.lineTo(0.6, 2.4); c.fill();
  // tail
  c.save(); c.translate(-7.4, 0); c.rotate(wag); c.beginPath(); c.moveTo(1, 0); c.quadraticCurveTo(-3, -1, -7.4, -4.4); c.quadraticCurveTo(-5, 0, -7.4, 4.4); c.quadraticCurveTo(-3, 1, 1, 0); c.fill(); c.restore();
  // body
  c.beginPath(); c.moveTo(9.4, 0); c.bezierCurveTo(8, -4.6, -2, -4.2, -8.4, -0.6 + wag); c.lineTo(-8.4, 0.6 + wag); c.bezierCurveTo(-2, 4.2, 8, 4.6, 9.4, 0); c.closePath(); c.fill();
  c.save(); c.clip(); c.fillStyle = patch; OB_ell(c, 5.6, -0.6, 3, 2.6); c.fill(); OB_ell(c, -2.6, 1.4, 2.6, 2); c.fill(); c.restore();
  c.beginPath(); c.moveTo(9.4, 0); c.bezierCurveTo(8, -4.6, -2, -4.2, -8.4, -0.6 + wag); c.lineTo(-8.4, 0.6 + wag); c.bezierCurveTo(-2, 4.2, 8, 4.6, 9.4, 0); c.closePath();
  c.strokeStyle = 'rgba(110,50,16,0.55)'; c.lineWidth = 0.8; c.stroke();
  c.restore();
}
var OB_KOI = [[1.05, '#f08a3c', '#fff3e0'], [0.78, '#fbf1d8', '#e0603a']], OB_KOI_ANGLES = 32;
// koi of kind ki heading along ang, tail phase wp — picked from a small set of pre-drawn poses
function OB_koiSprite(c, x, y, ang, wp, ki) {
  var N = OB_KOI_ANGLES, ai = ((Math.round(ang / OB_TAU * N) % N) + N) % N, wi = Math.round(Math.sin(wp) * 1) + 1, K = OB_KOI[ki];
  OB_layer(c, 'koi' + ki + '_' + ai + '_' + wi, -17, -17, 17, 17, function (g) { OB_koi(g, 0, 0, ai / N * OB_TAU, (wi - 1) * 0.42, K[0], K[1], K[2]); }, x, y);
}
function OB_frog(c, x, y, dir, puff, blink, air) {
  c.save(); c.translate(x, y); c.scale(dir, 1);
  var G = '#7cc260', GD = '#4f9a45';
  if (!air) { OB_ell(c, 0, 1.6, 6, 2); c.fillStyle = 'rgba(30,60,30,0.3)'; c.fill(); }
  // hind legs
  if (air) { OB_shape(c, function () { c.beginPath(); c.moveTo(-3, -1); c.lineTo(-9.6, 3.4); c.lineTo(-8, 5); c.lineTo(-1.6, 1.4); c.closePath(); }, GD, null, 1.1); }
  else { OB_shape(c, function () { OB_ell(c, -3.2, -0.6, 3.4, 2.5, 0.3); }, GD, null, 1.1); OB_line(c, -5, 1.8, -1, 2.1, OB_OUT, 2.2); OB_line(c, -5, 1.8, -1, 2.1, G, 1); }
  // body
  OB_shape(c, function () { c.beginPath(); c.moveTo(-5, 0.8); c.quadraticCurveTo(-5, -5.4, 1.4, -5.6); c.quadraticCurveTo(6.4, -5.4, 6.4, -1.6); c.quadraticCurveTo(6, 1.4, 1, 1.6); c.quadraticCurveTo(-3, 1.8, -5, 0.8); c.closePath(); }, G, function () {
    OB_ell(c, 2.4, 0.6 + puff * 0.3, 3.6 + puff, 2 + puff * 0.8); c.fillStyle = '#e3f0b4'; c.fill(); OB_dot(c, -1.6, -3, 0.8, GD); OB_dot(c, -3.2, -1, 0.6, GD);
  }, 1.2);
  // front leg
  if (!air) { OB_line(c, 3, 0.6, 4, 2.6, OB_OUT, 2.4); OB_line(c, 3, 0.6, 4, 2.6, G, 1.2); }
  // eye
  OB_ell(c, 3.4, -5.4, 2.1, 2.1); OB_fo(c, G, 1.1);
  if (blink) OB_line(c, 2.2, -5.2, 4.6, -5.2, OB_OUT, 1); else { OB_dot(c, 3.7, -5.4, 1.15, '#1e1510'); OB_dot(c, 4, -5.8, 0.35, '#fff'); }
  c.beginPath(); c.moveTo(6.2, -2.2); c.quadraticCurveTo(4.4, -1.2, 2.4, -1.6); OB_s(c, '#2c5a2a', 0.8);
  c.restore();
}
function OB_reedsRArt(c) { c.scale(-0.85, 0.85); OB_reedsArt(c); }
function OB_dragonflyArt(c, dd, wv) {
  c.fillStyle = 'rgba(255,255,255,0.7)';
  OB_ell(c, -dd * 0.6, -1.6, 3.8, 1.1, 0.5 + wv); c.fill(); OB_ell(c, -dd * 0.6, -1.6, 3.8, 1.1, -0.5 - wv); c.fill();
  OB_line(c, -dd * 4.6, 0, dd * 2.2, 0, OB_OUT, 2.2); OB_line(c, -dd * 4.4, 0, dd * 2, 0, '#3aa89a', 1.1); OB_dot(c, dd * 2.4, 0, 1.1, '#3aa89a');
}
OB_def('pond', [0, -18, 146, 98], function (c, o, t, env, id, ga) {
  var i, u, n;
  OB_layer(c, 'pond', 0, 0, 146, 98, OB_pondArt);
  // koi gliding round under the lily pads
  var a = t * 0.42 + id * 1.3;
  OB_koiSprite(c, 72 + Math.cos(a) * 33, 51 + Math.sin(a) * 15 + Math.sin(a * 3) * 2, Math.atan2(Math.cos(a) * 15 + Math.cos(a * 3) * 6, -Math.sin(a) * 33), t * 6.2 + id, 0);
  var b = -t * 0.31 + id * 2.1 + 2;
  OB_koiSprite(c, 70 + Math.cos(b) * 21, 52 + Math.sin(b) * 8.5, Math.atan2(-Math.cos(b) * 8.5, Math.sin(b) * 21), t * 7.4 + 2 + id, 1);
  // drifting glints
  c.strokeStyle = 'rgba(255,255,255,0.7)'; c.lineWidth = 1; c.beginPath();
  for (i = 0; i < 5; i++) { u = OB_fract(t * 0.13 + i * 0.2 + id * 0.3); var sx = 26 + ((i * 41) % 84) + u * 8, sy = 32 + ((i * 29) % 42); c.moveTo(sx, sy); c.lineTo(sx + 4 + (i & 1) * 3, sy); }
  c.stroke();
  // rings where something touched the surface
  for (i = 0; i < 2; i++) {
    var k = t / (3.3 + i * 1.7) + id * 0.4 + i * 0.5; u = OB_fract(k); n = Math.floor(k);
    if (u < 0.6) { var q = u / 0.6, rx = 36 + OB_h(n, id, i + 3) * 72, ry = 34 + OB_h(n, id, i + 9) * 36; c.globalAlpha = ga * (1 - q) * 0.8; OB_ell(c, rx, ry, 2 + q * 9, 0.9 + q * 4); c.strokeStyle = '#ffffff'; c.lineWidth = 1; c.stroke(); }
  }
  c.globalAlpha = ga;
  // frog hop cycle: sits on one pad, leaps to the other
  var FP = 11, fk = t / FP + id * 0.43, fu = OB_fract(fk), fn = Math.floor(fk) + id, A = OB_POND_PADS[2], B = OB_POND_PADS[1];
  var from = (fn & 1) ? B : A, to = (fn & 1) ? A : B, hopT = 0.93, fx = from[0], fy = from[1] - 1.6, state = 0;
  if (fu < 0.09) { var lq = fu / 0.09; c.globalAlpha = ga * (1 - lq) * 0.9; OB_ell(c, from[0], from[1], from[2] + 1 + lq * 9, from[3] + 0.6 + lq * 4); c.strokeStyle = '#ffffff'; c.lineWidth = 1.1; c.stroke(); c.globalAlpha = ga; }
  // pads bob gently on top of the fish
  var bob = Math.sin(t * 1.3 + id) * 0.5;
  OB_layer(c, 'pondpads', 14, 14, 130, 82, OB_pondPadsArt, 0, bob);
  // reeds behind the far rim lean with the wind
  var rs = env.wind * 2 + Math.sin(t * 1.2 + id) * 0.8;
  OB_layer(c, 'pondreeds', -12, -40, 14, 2, OB_reedsArt, 22 + rs, 23);
  OB_layer(c, 'pondreedsR', -13, -35, 11, 2, OB_reedsRArt, 124 + rs * 0.8, 17);
  // the frog
  if (fu > hopT) { var h = (fu - hopT) / (1 - hopT); state = 3; fx = OB_lerp(from[0], to[0], OB_ease(h)); fy = OB_lerp(from[1], to[1], OB_ease(h)) - 1.6 - Math.sin(h * Math.PI) * 17; }
  else if (OB_fract(t / 2.9 + id * 0.2) < 0.05) state = 2;
  else if (fu > 0.3 && fu < 0.62 && Math.sin(t * 7) > 0.1) state = 1;
  var dir = (to[0] - from[0]) > 0 ? 1 : -1;
  OB_layer(c, 'frog' + dir + state, -11, -9, 11, 7, function (g) { OB_frog(g, 0, 0, dir, state === 1 ? 1 : 0, state === 2, state === 3); }, fx, fy + (state === 3 ? 0 : bob));
  // dragonfly patrolling
  var da = t * 0.8 + id, dx = 72 + Math.cos(da) * 40 + Math.sin(t * 2.7) * 6, dy = 30 + Math.sin(da * 2) * 16 - 8, dd = -Math.sin(da) > 0 ? 1 : -1, wf = Math.floor(t * 24) & 1;
  OB_layer(c, 'dfly' + dd + wf, -7, -5, 7, 3, function (g) { OB_dragonflyArt(g, dd, wf ? 0.35 : -0.3); }, dx, dy);
});

/* ===================================== gazebo ====================================================== */
var OB_GZ = {
  V: [[134, 110], [103, 130.8], [41, 130.8], [10, 110], [41, 89.2], [103, 89.2]],   // deck corners: right, front-right, front-left, left, back-left, back-right
  E: [[144, 33], [108, 57.2], [36, 57.2], [0, 33]],                                   // roof eave (front half): right, front-right, front-left, left
  apex: [72, -22], H: 74,
  roof: ['#7fb0c9', '#6a9cb8', '#527f9e', '#3f6683', '#9cc7da'],                     // lit panel, mid panel, shaded panel, line, highlight
  white: '#fbf6ea', wsh: '#d9d0bd', wdk: '#b9ae98'
};
var OB_GZ_BULB_COLS = ['#ffe08a', '#f7a7bb', '#8fd8cc', '#fff3c4'];
var OB_gzBulbs = null;
function OB_gzBulbList() {
  if (OB_gzBulbs) return OB_gzBulbs;
  var segs = [[10, 42.6, 41, 63.4, 5], [41, 63.4, 72, 63.4, 6], [72, 63.4, 103, 63.4, 6], [103, 63.4, 134, 42.6, 5]], out = [], s, i, n;
  for (s = 0; s < segs.length; s++) {
    var g = segs[s], len = Math.hypot(g[2] - g[0], g[3] - g[1]); n = Math.round(len / 7.4);
    for (i = 0; i <= n; i++) { if (i === 0 && s > 0) continue; var u = i / n; out.push([OB_lerp(g[0], g[2], u), OB_lerp(g[1], g[3], u) + Math.sin(u * Math.PI) * g[4] + 1.4]); }
  }
  return (OB_gzBulbs = { segs: segs, pts: out });
}
function OB_gzPost(c, x, y, h) {
  var G = OB_GZ;
  OB_shape(c, function () { OB_rr(c, x - 2.7, y - h, 5.4, h, 0.8); }, G.white, function () { c.fillStyle = G.wsh; c.fillRect(x + 0.7, y - h, 3, h); c.fillStyle = 'rgba(90,70,50,0.22)'; c.fillRect(x - 3, y - h, 6, 7); }, 1.5);
  OB_shape(c, function () { OB_rr(c, x - 3.9, y - 5.4, 7.8, 5.8, 1); }, G.white, function () { c.fillStyle = G.wsh; c.fillRect(x + 1, y - 6, 4, 7); }, 1.4);
}
function OB_gzRail(c, ax, ay, bx, by, h) {
  var G = OB_GZ, len = Math.hypot(bx - ax, by - ay), n = Math.max(2, Math.round(len / 5.6)), i, u;
  // balusters
  c.beginPath(); for (i = 1; i < n; i++) { u = i / n; c.moveTo(OB_lerp(ax, bx, u), OB_lerp(ay, by, u) - 2); c.lineTo(OB_lerp(ax, bx, u), OB_lerp(ay, by, u) - h); }
  OB_s(c, OB_OUT, 2.9); OB_s(c, G.white, 1.3);
  // bottom + top rail
  OB_line(c, ax, ay - 2.6, bx, by - 2.6, OB_OUT, 3.6); OB_line(c, ax, ay - 2.6, bx, by - 2.6, G.wsh, 1.8);
  OB_line(c, ax, ay - h, bx, by - h, OB_OUT, 5); OB_line(c, ax, ay - h, bx, by - h, G.white, 3); OB_line(c, ax, ay - h + 0.9, bx, by - h + 0.9, G.wsh, 1);
}
function OB_gzShingles(c, A, B, P, col, colAlt, line, seedRow) {
  var d = [(A[0] + B[0]) / 2 - P[0], (A[1] + B[1]) / 2 - P[1]], dl = Math.hypot(d[0], d[1]); d[0] /= dl; d[1] /= dl;
  var rows = 10, k, j;
  c.save();
  OB_poly(c, [A[0] + d[0] * 3.4, A[1] + d[1] * 3.4, B[0] + d[0] * 3.4, B[1] + d[1] * 3.4, P[0], P[1]]); c.clip();
  c.fillStyle = col; c.fillRect(-10, -40, 170, 110);
  // courses are painted from the eave upwards, so each one's scalloped edge laps over the course below
  for (k = 0; k < rows; k++) {
    var u0 = k / rows, u1 = (k + 1) / rows;
    var ax = OB_lerp(A[0], P[0], u0), ay = OB_lerp(A[1], P[1], u0), bx = OB_lerp(B[0], P[0], u0), by = OB_lerp(B[1], P[1], u0);
    var len = Math.hypot(bx - ax, by - ay), m = Math.max(1, Math.round(len / 9.6)), off = ((k + seedRow) & 1) ? 0.5 : 0, sx = (bx - ax) / m, sy = (by - ay) / m;
    c.beginPath(); c.moveTo(OB_lerp(A[0], P[0], u1 + 0.06), OB_lerp(A[1], P[1], u1 + 0.06)); c.lineTo(ax - sx, ay - sy);
    for (j = -1; j <= m; j++) {
      var x0 = ax + sx * (j - off), y0 = ay + sy * (j - off), x1 = x0 + sx, y1 = y0 + sy;
      c.quadraticCurveTo(x0 + sx * 0.08 + d[0] * 3.6, y0 + sy * 0.08 + d[1] * 3.6, (x0 + x1) / 2 + d[0] * 3.6, (y0 + y1) / 2 + d[1] * 3.6);
      c.quadraticCurveTo(x1 - sx * 0.08 + d[0] * 3.6, y1 - sy * 0.08 + d[1] * 3.6, x1, y1);
    }
    c.lineTo(OB_lerp(B[0], P[0], u1 + 0.06), OB_lerp(B[1], P[1], u1 + 0.06)); c.closePath();
    c.fillStyle = (k & 1) ? colAlt : col; c.fill(); c.strokeStyle = line; c.lineWidth = 1.1; c.stroke();
  }
  c.restore();
}
function OB_gazeboArt(c) {
  var G = OB_GZ, V = G.V, E = G.E, P = G.apex, H = G.H, i, x;
  OB_shadow(c, 72, 134, 72, 11);
  // ---- deck skirt (three front faces), white boards
  OB_shape(c, function () { OB_poly(c, [V[3][0], V[3][1], V[2][0], V[2][1], V[1][0], V[1][1], V[0][0], V[0][1], V[0][0], V[0][1] + 7.4, V[1][0], V[1][1] + 7.4, V[2][0], V[2][1] + 7.4, V[3][0], V[3][1] + 7.4]); }, G.wsh, function () {
    c.fillStyle = G.wdk; OB_poly(c, [V[1][0], V[1][1], V[0][0], V[0][1], V[0][0], V[0][1] + 8, V[1][0], V[1][1] + 8]); c.fill();
    c.fillStyle = G.white; OB_poly(c, [V[3][0], V[3][1], V[2][0], V[2][1], V[2][0], V[2][1] + 8, V[3][0], V[3][1] + 8]); c.fill();
    c.strokeStyle = 'rgba(120,100,80,0.55)'; c.lineWidth = 0.8; c.beginPath();
    for (var k = 14; k < 134; k += 6.2) { c.moveTo(k, 100); c.lineTo(k, 142); }
    c.stroke();
  }, 1.7);
  // ---- deck top
  OB_shape(c, function () { OB_poly(c, [V[0][0], V[0][1], V[1][0], V[1][1], V[2][0], V[2][1], V[3][0], V[3][1], V[4][0], V[4][1], V[5][0], V[5][1]]); }, '#d9ab76', function () {
    c.strokeStyle = '#b5834c'; c.lineWidth = 0.9; c.beginPath(); for (var k = 93.6; k < 131; k += 4.6) { c.moveTo(8, k); c.lineTo(136, k); } c.stroke();
    var r = OB_rng(21); c.strokeStyle = 'rgba(168,116,63,0.7)'; c.lineWidth = 0.8; c.beginPath();
    for (k = 0; k < 22; k++) { var px = 14 + r() * 116, py = 91.3 + ((r() * 8) | 0) * 4.6; c.moveTo(px, py); c.lineTo(px, py + 4.6); }
    c.stroke();
    // the roof's shade falls across the back of the floor
    OB_ell(c, 72, 92, 66, 17); c.fillStyle = 'rgba(70,44,30,0.26)'; c.fill();
    c.fillStyle = 'rgba(255,236,200,0.35)'; OB_poly(c, [V[3][0], V[3][1], V[2][0], V[2][1], V[2][0] + 4, V[2][1] - 1.6, V[3][0] + 6, V[3][1]]); c.fill();
  }, 1.7);
  // ---- step
  OB_shape(c, function () { OB_rr(c, 55, 131.4, 34, 6.4, 1.2); }, '#d9ab76', function () { c.fillStyle = '#e6bd8a'; c.fillRect(55, 131.4, 34, 1.6); }, 1.6);
  OB_shape(c, function () { OB_rr(c, 55, 137.4, 34, 5, 1.2); }, G.wsh, function () { c.fillStyle = G.wdk; c.fillRect(55, 140.6, 34, 2); }, 1.6);
  // ---- back railings + back posts
  OB_gzRail(c, V[3][0], V[3][1], V[4][0], V[4][1], 19); OB_gzRail(c, V[5][0], V[5][1], V[0][0], V[0][1], 19); OB_gzRail(c, V[4][0], V[4][1], V[5][0], V[5][1], 19);
  OB_gzPost(c, V[4][0], V[4][1], 40); OB_gzPost(c, V[5][0], V[5][1], 40);
  // ---- tea table
  OB_shadow(c, 72, 116.6, 15, 4.4);
  OB_shape(c, function () { OB_poly(c, [70, 104, 74, 104, 75, 114, 69, 114]); }, G.white, function () { c.fillStyle = G.wsh; c.fillRect(72.6, 103, 3, 12); }, 1.4);
  OB_shape(c, function () { OB_rr(c, 64.6, 113, 14.8, 3.6, 1.6); }, G.white, null, 1.4);
  OB_shape(c, function () { c.beginPath(); c.moveTo(57.6, 99); c.lineTo(86.4, 99); c.lineTo(86.4, 104.6); for (var k = 0; k < 6; k++) { var sx = 86.4 - k * 4.8; c.quadraticCurveTo(sx - 1.2, 107.4, sx - 2.4, 105.2); c.quadraticCurveTo(sx - 3.6, 103.4, sx - 4.8, 104.6); } c.closePath(); }, '#fbf1d8', function () { OB_gingham(c, 57, 99, 30, 9, 1.6, 'rgba(242,160,181,0.7)'); }, 1.3);
  OB_shape(c, function () { OB_ell(c, 72, 98.6, 14.6, 5); }, '#fbf1d8', function () { OB_gingham(c, 57, 93, 30, 11, 1.6, 'rgba(242,160,181,0.7)'); }, 1.5);
  // teapot, cups, plate of biscuits
  OB_line(c, 76.4, 95.4, 80.4, 93.2, OB_OUT, 3.2); OB_line(c, 76.4, 95.4, 80.4, 93.2, '#3aa89a', 1.5);
  c.beginPath(); c.arc(67, 94.6, 2.7, 1.2, 5); OB_s(c, OB_OUT, 3); c.beginPath(); c.arc(67, 94.6, 2.7, 1.2, 5); OB_s(c, '#3aa89a', 1.3);
  OB_shape(c, function () { OB_ell(c, 72, 95, 5, 4.2); }, '#3aa89a', function () { OB_ell(c, 74, 96.6, 4, 3); c.fillStyle = '#2f8a7e'; c.fill(); OB_dot(c, 70.2, 93.4, 1, '#8fd8cc'); }, 1.3);
  OB_shape(c, function () { OB_rr(c, 69.4, 89.8, 5.2, 2, 1); }, '#3aa89a', null, 1.1); OB_dot(c, 72, 89.2, 1.1, '#f2c14e');
  OB_shape(c, function () { OB_rr(c, 60.6, 97, 4.6, 3.6, 1.2); }, '#fffdf4', null, 1.1); OB_shape(c, function () { OB_rr(c, 80.6, 98, 4.6, 3.6, 1.2); }, '#fffdf4', null, 1.1);
  // ---- side posts, front-side railings, front posts
  OB_gzPost(c, V[3][0], V[3][1], H); OB_gzPost(c, V[0][0], V[0][1], H);
  OB_gzRail(c, V[3][0], V[3][1], V[2][0], V[2][1], 19); OB_gzRail(c, V[1][0], V[1][1], V[0][0], V[0][1], 19);
  // fretwork brackets under the beam
  var br = [[41, 1], [103, -1], [10, 1], [134, -1]];
  for (i = 0; i < 4; i++) {
    var bx = br[i][0], s = br[i][1], by = i < 2 ? 56.8 : 36;
    c.beginPath(); c.moveTo(bx + s * 2.6, by + 20); c.quadraticCurveTo(bx + s * 3.4, by + 8.4 + (i < 2 ? 0 : s * 0), bx + s * 14, by + 6.6 + (i < 2 ? 0 : 9.4)); OB_s(c, OB_OUT, 4); OB_s(c, G.white, 2);
    OB_ell(c, bx + s * 6.4, by + 10.4 + (i < 2 ? 0 : 4), 2, 2); OB_s(c, OB_OUT, 2.6); OB_s(c, G.white, 1.1);
  }
  OB_gzPost(c, V[2][0], V[2][1], H); OB_gzPost(c, V[1][0], V[1][1], H);
  // ---- beam / fascia
  OB_shape(c, function () { OB_poly(c, [10, 35, 41, 55.8, 103, 55.8, 134, 35, 134, 42, 103, 62.8, 41, 62.8, 10, 42]); }, G.white, function () {
    c.fillStyle = G.wsh; OB_poly(c, [103, 55, 134, 34, 134, 43, 103, 63.6]); c.fill(); c.fillRect(8, 61, 130, 3);
    c.strokeStyle = 'rgba(120,100,80,0.5)'; c.lineWidth = 0.8; c.beginPath(); c.moveTo(41, 56); c.lineTo(41, 63); c.moveTo(103, 56); c.lineTo(103, 63); c.stroke();
  }, 1.6);
  // ---- roof: three shingled faces
  var R = G.roof;
  OB_gzShingles(c, E[3], E[2], P, R[0], '#8cbad1', R[3], 0);
  OB_gzShingles(c, E[2], E[1], P, R[1], '#74a5c0', R[3], 1);
  OB_gzShingles(c, E[1], E[0], P, R[2], '#5a88a6', R[3], 0);
  // soft shade under the cap, outline, ridge caps
  c.save(); OB_poly(c, [E[3][0], E[3][1], E[2][0], E[2][1], E[1][0], E[1][1], E[0][0], E[0][1], P[0], P[1]]); c.clip();
  c.fillStyle = 'rgba(255,255,255,0.16)'; OB_poly(c, [E[3][0], E[3][1], E[2][0], E[2][1], P[0], P[1]]); c.fill(); c.restore();
  c.beginPath(); c.moveTo(E[3][0] - 0.6, E[3][1] + 2.6); c.lineTo(P[0], P[1]); c.lineTo(E[0][0] + 0.6, E[0][1] + 2.6); OB_s(c, OB_OUT, 1.9);
  for (i = 1; i < 3; i++) { OB_line(c, P[0], P[1], E[i][0], E[i][1] + 3, OB_OUT, 5); OB_line(c, P[0], P[1] + 2, E[i][0], E[i][1] + 2.4, i === 2 ? R[4] : R[1], 2.8); }
  // scalloped eave outline
  c.beginPath(); c.moveTo(E[3][0] - 0.6, E[3][1] + 2.6); c.lineTo(E[2][0], E[2][1] + 3.6); c.lineTo(E[1][0], E[1][1] + 3.6); c.lineTo(E[0][0] + 0.6, E[0][1] + 2.6); OB_s(c, OB_OUT, 1.7);
  // ---- cupola + finial
  c.save(); c.translate(0, P[1] + 27);
  OB_shape(c, function () { OB_poly(c, [64.4, -20, 79.6, -20, 76.4, -29, 67.6, -29]); }, G.white, function () { c.fillStyle = G.wsh; c.fillRect(73, -30, 8, 11); }, 1.6);
  OB_shape(c, function () { c.beginPath(); c.moveTo(63.6, -28.6); c.quadraticCurveTo(71, -31, 72, -38.4); c.quadraticCurveTo(73, -31, 80.4, -28.6); c.closePath(); }, R[1], function () { c.fillStyle = R[2]; c.fillRect(72.6, -40, 9, 12); }, 1.6);
  OB_line(c, 72, -38, 72, -47, OB_OUT, 1.8);
  OB_ell(c, 72, -39.6, 2.1, 2.1); OB_fo(c, '#f2c14e', 1.2);
  c.restore();
  // ---- potted geraniums by the step
  for (i = 0; i < 2; i++) {
    x = i ? 97 : 47;
    OB_shadow(c, x, 143.6, 7, 2);
    OB_union(c, [[x - 3.4, 131.4, 3.6], [x + 3.2, 131, 3.8], [x, 128.6, 3.8]], '#4f9a45', 1.3);
    OB_dot(c, x - 3.6, 130.4, 1.6, '#f2a0b5'); OB_dot(c, x + 3.2, 129.4, 1.6, '#d9574a'); OB_dot(c, x - 0.2, 127.4, 1.6, '#f2a0b5'); OB_dot(c, x + 0.6, 131.8, 1.3, '#fbf1d8');
    OB_shape(c, function () { OB_poly(c, [x - 5, 134, x + 5, 134, x + 3.8, 142.6, x - 3.8, 142.6]); }, '#c9694a', function () { c.fillStyle = '#a64f38'; c.fillRect(x + 1.4, 133, 5, 11); }, 1.4);
    OB_shape(c, function () { OB_rr(c, x - 5.8, 132.6, 11.6, 3, 1.2); }, '#d67a5a', null, 1.2);
  }
  // ---- string of lights (unlit look)
  var BL = OB_gzBulbList(), segs = BL.segs, pts = BL.pts;
  c.beginPath();
  for (i = 0; i < segs.length; i++) { var g = segs[i]; c.moveTo(g[0], g[1]); c.quadraticCurveTo((g[0] + g[2]) / 2, (g[1] + g[3]) / 2 + g[4] * 2, g[2], g[3]); }
  OB_s(c, '#4a3a2c', 1);
  for (i = 0; i < pts.length; i++) { OB_ell(c, pts[i][0], pts[i][1], 1.7, 2.1); c.fillStyle = OB_GZ_BULB_COLS[i % 4]; c.fill(); OB_s(c, OB_OUT, 0.9); }
}
function OB_gzGlowArt(c) {           // warm light inside + lit bulbs with halos (drawn with night alpha)
  var pts = OB_gzBulbList().pts, i, g;
  g = c.createRadialGradient(72, 84, 6, 72, 84, 70); g.addColorStop(0, 'rgba(255,224,150,0.3)'); g.addColorStop(1, 'rgba(255,214,130,0)');
  c.fillStyle = g; c.fillRect(2, 30, 140, 112);
  for (i = 0; i < pts.length; i++) {
    g = c.createRadialGradient(pts[i][0], pts[i][1], 0.5, pts[i][0], pts[i][1], 9);
    g.addColorStop(0, 'rgba(255,236,170,0.85)'); g.addColorStop(0.4, 'rgba(255,220,140,0.28)'); g.addColorStop(1, 'rgba(255,220,140,0)');
    c.fillStyle = g; c.fillRect(pts[i][0] - 9, pts[i][1] - 9, 18, 18);
    OB_ell(c, pts[i][0], pts[i][1], 1.9, 2.3); c.fillStyle = OB_GZ_BULB_COLS[i % 4]; c.fill();
    OB_ell(c, pts[i][0], pts[i][1], 1, 1.3); c.fillStyle = '#fffdf0'; c.fill();
  }
}
function OB_gazeboNightArt(c) { OB_gazeboArt(c); c.globalAlpha = 0.96; OB_gzGlowArt(c); c.globalAlpha = 1; }
function OB_gzVaneArt(c, vi) {       // golden bone weathervane, turned to one of 9 headings
  var turn = vi / 4 - 1, sx = Math.abs(turn) < 0.22 ? (turn < 0 ? -0.22 : 0.22) : turn;
  c.save(); c.scale(sx * 0.34, 0.34); OB_bonePath(c); c.restore(); c.fillStyle = sx < 0 ? '#e0aa3c' : '#f2c14e'; c.fill(); OB_s(c, OB_OUT, 1.2);
}
function OB_gzBasketArt(c) {         // hanging basket of petunias (chains are drawn live so it can swing); hook at (0,0)
  c.beginPath(); c.moveTo(-5.6, 12); c.quadraticCurveTo(-10, 16, -8, 24); c.moveTo(5.6, 12.4); c.quadraticCurveTo(9.6, 17, 7.4, 22); c.moveTo(-1, 14); c.quadraticCurveTo(-3, 20, -1.4, 25); OB_s(c, OB_OUT, 3); OB_s(c, '#4f9a45', 1.5);
  OB_dot(c, -8.4, 21, 1.5, '#f2a0b5'); OB_dot(c, 7.6, 19.6, 1.4, '#a58bd6'); OB_dot(c, -1.8, 22.6, 1.4, '#f2a0b5');
  OB_shape(c, function () { c.beginPath(); c.moveTo(-7.4, 11); c.quadraticCurveTo(-6.4, 19.6, 0, 19.6); c.quadraticCurveTo(6.4, 19.6, 7.4, 11); c.closePath(); }, '#a8743f',
    function () { c.fillStyle = '#7a4e2a'; c.fillRect(2.6, 10, 7, 11); OB_line(c, -6.4, 13.6, 6.4, 13.6, '#7a4e2a', 0.8); OB_line(c, -5, 16.4, 5, 16.4, '#7a4e2a', 0.8); }, 1.4);
  OB_union(c, [[-5.6, 9.4, 3.6], [0, 7.6, 4.2], [5.6, 9.6, 3.6]], '#4f9a45', 1.3);
  var f = [[-5.8, 8.4, '#f2a0b5'], [0.4, 6, '#a58bd6'], [5.8, 8.6, '#f2a0b5'], [-2.2, 10.6, '#fbf1d8'], [3, 11, '#a58bd6'], [-2.6, 5.4, '#fbf1d8']];
  for (var i = 0; i < f.length; i++) { OB_ell(c, f[i][0], f[i][1], 2, 2); OB_fo(c, f[i][2], 0.9); OB_dot(c, f[i][0], f[i][1], 0.65, '#f2c14e'); }
}
OB_def('gazebo', [-6, -50, 150, 147], function (c, o, t, env, id, ga) {
  var n = env.night, i;
  if (n > 0.02) { c.globalAlpha = ga * n * 0.2; OB_ell(c, 72, 122, 78, 24); c.fillStyle = '#ffe29a'; c.fill(); c.globalAlpha = ga; }
  var lit = n > 0.985;               // fully dark: one pre-lit bitmap instead of art + glow
  OB_layer(c, lit ? 'gazeboN' : 'gazebo', -2, -50, 146, 146, lit ? OB_gazeboNightArt : OB_gazeboArt);
  // hanging baskets swing on their chains
  for (i = 0; i < 2; i++) {
    var hx = i ? 93.4 : 50.6, hy = 62, sw = Math.sin(t * 1.3 + id + i * 1.9) * 0.9 + env.wind * 1.8;
    c.beginPath(); c.moveTo(hx, hy); c.lineTo(hx + sw - 5.4, hy + 10.6); c.moveTo(hx, hy); c.lineTo(hx + sw, hy + 9); c.moveTo(hx, hy); c.lineTo(hx + sw + 5.4, hy + 10.6); OB_s(c, '#5a4a3c', 0.9);
    OB_layer(c, 'gzbasket', -11, 2, 11, 27, OB_gzBasketArt, hx + sw, hy);
  }
  // weathervane: a golden bone that turns with the breeze
  var vi = Math.round((Math.cos(t * 0.5 + id + env.wind * 2.2) * 0.5 + 0.5) * 8);
  OB_layer(c, 'gzvane' + vi, -8, -5, 8, 5, function (g) { OB_gzVaneArt(g, vi); }, 72, OB_GZ.apex[1] - 20.4);
  // steam curling from the teapot spout
  c.fillStyle = '#ffffff';
  for (i = 0; i < 2; i++) { var u = OB_fract(t * 0.45 + i * 0.5 + id * 0.3); c.globalAlpha = ga * Math.sin(u * Math.PI) * 0.55 * (1 - n * 0.5); OB_ell(c, 81.4 + Math.sin(u * 5 + i) * 1.6, 91.6 - u * 9, 1.2 + u * 1.2, 1.2 + u * 1.2); c.fill(); }
  c.globalAlpha = ga;
  if (n > 0.02) {
    // the bulbs switch on as it gets dark
    if (!lit) { c.globalAlpha = ga * n * 0.96; OB_layer(c, 'gzglow', 0, 30, 144, 142, OB_gzGlowArt); c.globalAlpha = ga; }
    var pts = OB_gzBulbList().pts;
    for (i = 0; i < 2; i++) { var k = Math.floor(t * 1.3 + i * 0.5), p = pts[Math.floor(OB_h(k, id, i) * pts.length) % pts.length], tw = OB_fract(t * 1.3 + i * 0.5); OB_sparkle(c, p[0], p[1], 4.4 * Math.sin(tw * Math.PI), '#fffdf0', n); }
  }
}, {
  iconBounds: { x0: -2, y0: -50, x1: 146, y1: 146 },
  light: function (o, env) { var T = OB_tile(); return { x: ((+o.x || 0) + 1.5) * T, y: ((+o.y || 0) + 1.6) * T, r: T * 4.4, color: '#ffd98a' }; }
});

/* ===================================== shop icon =================================================== */
// Draws any registered object scaled to fit a size x size box whose top-left corner is (x, y).
// The icon is baked once per (type, size, scale) and then blitted, so it is cheap to call every frame.
var OB_iconCache = {}, OB_iconCount = 0;
function OB_iconPaint(c, e, type, size) {
  var T = OB_tile(), k = T / 48, w = 1, h = 1, i;
  if (typeof CATALOG !== 'undefined' && CATALOG && CATALOG.length) for (i = 0; i < CATALOG.length; i++) if (CATALOG[i] && CATALOG[i].id === type) { w = CATALOG[i].w || 1; h = CATALOG[i].h || 1; break; }
  var b = e.iconBounds || e.bounds || { x0: 0, y0: 0, x1: w * 48, y1: h * 48 };
  var bw = (b.x1 - b.x0) * k, bh = (b.y1 - b.y0) * k, s = Math.min(size / bw, size / bh);
  c.save();
  OB_direct++;
  try {
    c.translate((size - bw * s) / 2 - b.x0 * k * s, (size - bh * s) / 2 - b.y0 * k * s);
    c.scale(s, s);
    e.draw(c, { type: type, x: 0, y: 0, w: w, h: h, id: 0, icon: true }, 2.2, { night: 0, wind: 0 });
  } catch (err) { /* ignore */ }
  OB_direct--;
  c.restore();
}
function drawDecorIcon(c, type, x, y, size) {
  var e = OBJECT_ART[type];
  if (!c || !e || typeof e.draw !== 'function') return;
  size = +size || 32; x = +x || 0; y = +y || 0;
  var m = null;
  try { m = c.getTransform(); } catch (err) { m = null; }
  if (m && m.b === 0 && m.c === 0 && m.a > 0.05 && Math.abs(m.a - m.d) < 1e-6 && !OB_NOCACHE) {
    var s = Math.round(m.a * 1024) / 1024, key = type + '|' + size + '|' + s, cv = OB_iconCache[key];
    if (cv === undefined) {
      if (++OB_iconCount > 300) { OB_iconCache = {}; OB_iconCount = 1; }
      cv = OB_makeCanvas(Math.ceil(size * s) + 2, Math.ceil(size * s) + 2);
      var g = cv && cv.getContext && cv.getContext('2d');
      if (g) { g.setTransform(s, 0, 0, s, 1, 1); OB_iconPaint(g, e, type, size); } else cv = null;
      OB_iconCache[key] = cv;
    }
    if (cv) {
      c.save(); c.setTransform(1, 0, 0, 1, 0, 0);
      c.drawImage(cv, Math.round(m.e + x * m.a) - 1, Math.round(m.f + y * m.a) - 1);
      c.restore();
      return;
    }
  }
  c.save(); c.translate(x, y); OB_iconPaint(c, e, type, size); c.restore();
}
