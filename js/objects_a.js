'use strict';
/* ==========================================================================================================
   Paws & Play - objects_a.js
   Art for the care stations and play equipment, construction sites, carried items and poop.
   Everything is drawn with canvas paths in "48 px per tile" art units; private names start with OA_.

   EXPORTS
     OBJECT_ART.<type> = { draw(c, o, t, env), box: [x0, y0, x1, y1], ... }   for these buildables:
         solid:  kennel, foodbin, toybox, trash, tub, treatjar, waterbowl, autofeeder
         floor:  playzone, sandpit, pool, napmat, agility
       o   = { type, x, y, w, h (tiles), id, occupied, useT, label }      env = { night: 0..1, wind: -1..1 }
       box = bounds of the art in px relative to the footprint's top-left corner (used for icons)
       Extra members:
         kennel.anchor / tub.anchor = { headX, headY, headR }  where the engine draws the occupant's face
         kennel.drawFront / tub.drawFront(c, o, t, env)        draw AFTER the occupant (cushion roll / tub front + suds)
         kennel.light / autofeeder.light(o, env) -> { x, y, r, color }   world-space glow for the night pass
     drawConstruction(c, o, t, progress)     building site covering o's footprint, progress 0..1
     drawCarryItem(c, kind, x, y, t)         'food' | 'ball' | 'treat' | 'poop' (anything else: a parcel)
     drawPoop(c, x, y, age, t, seed)         whiffy (stink lines + flies) once age > 30 s
     drawObjectIcon(c, type, x, y, size)     any registered object fitted into a size x size box
     warmObjectArt(scale)                    optional: pre-render the bitmaps for a device scale (zoom * dpr)

   SPEED
     Canvas path drawing is slow on a software-rendered browser, so the unchanging part of every object is
     rasterised once at exactly the scale it is shown at and then blitted 1:1 on whole device pixels; the
     moving bits are tiny cached sprites and flip-books.  The caller's globalAlpha is respected, so a ghost
     preview can be drawn by setting c.globalAlpha before calling draw().
   ========================================================================================================== */
var OBJECT_ART = window.OBJECT_ART || (window.OBJECT_ART = {});

// ---------- palette ----------
var OA_OUT = '#3b2a20';                 // warm dark outline
var OA_WL = '#c9935a', OA_WM = '#a8743f', OA_WD = '#7a4e2a', OA_WH = '#e2b57e';   // woods
var OA_CREAM = '#fbf1d8';
var OA_SH = 'rgba(40,26,12,0.22)';      // ground shadow
var OA_TAU = 6.2832;
var OA_ENV0 = { night: 0, wind: 0 };

// ---------- small path helpers ----------
function OA_tile() { return (typeof TILE === 'number' && TILE > 0) ? TILE : 48; }
function OA_rr(c, x, y, w, h, r) {
  if (r > w / 2) r = w / 2; if (r > h / 2) r = h / 2;
  c.beginPath();
  c.moveTo(x + r, y); c.lineTo(x + w - r, y); c.quadraticCurveTo(x + w, y, x + w, y + r);
  c.lineTo(x + w, y + h - r); c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  c.lineTo(x + r, y + h); c.quadraticCurveTo(x, y + h, x, y + h - r);
  c.lineTo(x, y + r); c.quadraticCurveTo(x, y, x + r, y); c.closePath();
}
function OA_el(c, x, y, rx, ry, rot) { c.beginPath(); c.ellipse(x, y, rx, ry, rot || 0, 0, OA_TAU); }
function OA_pl(c, p, open) {
  c.beginPath(); c.moveTo(p[0], p[1]);
  for (var i = 2; i < p.length; i += 2) c.lineTo(p[i], p[i + 1]);
  if (!open) c.closePath();
}
function OA_f(c, col) { c.fillStyle = col; c.fill(); }
function OA_s(c, col, lw) { c.strokeStyle = col; c.lineWidth = lw; c.stroke(); }
// fill + centred outline
function OA_fo(c, col, lw) { c.fillStyle = col; c.fill(); c.strokeStyle = OA_OUT; c.lineWidth = lw || 1.8; c.stroke(); }
// outline first, then fill: a clean outer outline for compound (multi-subpath) shapes
function OA_of(c, col, lw, ocol) { c.strokeStyle = ocol || OA_OUT; c.lineWidth = (lw || 1.8) * 2; c.stroke(); c.fillStyle = col; c.fill(); }
function OA_ln(c, x0, y0, x1, y1, col, lw) { c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.strokeStyle = col; c.lineWidth = lw; c.stroke(); }
function OA_shadow(c, x, y, rx, ry) { OA_el(c, x, y, rx, ry); OA_f(c, OA_SH); }
function OA_h(n) { var s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }
function OA_cl(v, a, b) { return v < a ? a : v > b ? b : v; }
function OA_num(v, d) { return (typeof v === 'number' && isFinite(v)) ? v : d; }
// phase 0..1 of the "just used" reaction, or -1 when idle
function OA_usePh(o) { var u = o ? o.useT : null; return (typeof u === 'number' && u >= 0 && u < 0.6) ? u / 0.6 : -1; }
// squash & stretch around a pivot on the ground
function OA_squash(c, ph, px, py, amt) {
  if (ph < 0) return;
  var b = Math.sin(ph * Math.PI * 3) * (1 - ph) * (amt || 0.09);
  c.translate(px, py); c.scale(1 + b, 1 - b); c.translate(-px, -py);
}
function OA_begin(c, o) {
  var T = OA_tile();
  c.save(); c.translate(OA_num(o.x, 0) * T, OA_num(o.y, 0) * T);
  if (T !== 48) c.scale(T / 48, T / 48);
  c.lineJoin = 'round'; c.lineCap = 'round'; c.setLineDash([]);   // the caller's globalAlpha is respected (ghost previews)
}
function OA_var(o, n) { var id = Math.floor(Math.abs(OA_num(o.id, 0))); return id % n; }

// ---------- static-layer cache ----------
// The unchanging part of every object is rasterised once, at exactly the scale it is being shown at, and
// then blitted 1:1 on whole device pixels (the cheapest thing a canvas can do). While the zoom is changing
// the previous bitmap is stretched for a moment instead of re-rendering every frame.
var OA_CACHE_ON = true, OA_cache = {}, OA_cacheRec = {}, OA_cacheN = 0, OA_vector = 0;
function OA_cacheBuild(k, q, bx, by, bw, bh, fn) {
  if (OA_cacheN > 520) { OA_cache = {}; OA_cacheRec = {}; OA_cacheN = 0; }
  // the bitmap starts on a whole device pixel relative to the object's origin, so that all the layers of
  // one object stay locked together whatever the zoom is
  var ox = Math.floor(bx * q), oy = Math.floor(by * q), cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.ceil((bx + bw) * q) - ox); cv.height = Math.max(1, Math.ceil((by + bh) * q) - oy);
  var g = cv.getContext('2d');
  g.setTransform(q, 0, 0, q, -ox, -oy); g.lineJoin = 'round'; g.lineCap = 'round';
  fn(g);
  cv.oaX = ox; cv.oaY = oy; cv.oaQ = q;
  OA_cache[k] = cv; OA_cacheN++;
  return cv;
}
// soft = true: keep sub-pixel placement instead of snapping to whole device pixels
function OA_static(c, key, bx, by, bw, bh, fn, soft) {
  if (!OA_CACHE_ON || OA_vector || !c.getTransform || typeof document === 'undefined') { fn(c); return; }
  var m = c.getTransform();
  if (Math.abs(m.b) > 1e-4 || Math.abs(m.c) > 1e-4 || !(m.a > 0.55) || !(m.d > 0.55) || m.a > 6.5 || m.d > 6.5) { fn(c); return; }
  var even = Math.abs(m.a - m.d) < 0.002;
  var q = Math.round((even ? m.a : Math.sqrt(m.a * m.d)) * 500) / 500;
  var rec = OA_cacheRec[key] || (OA_cacheRec[key] = { qs: [], want: 0, t0: 0 });
  var cv = OA_cache[key + '@' + q], fq;
  if (!cv) {
    if (rec.qs.length) {
      // another scale is cached: stretch it while squashing, and until the new zoom has settled
      var now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(), wait = !even;
      if (even) { if (rec.want !== q) { rec.want = q; rec.t0 = now; } wait = now - rec.t0 < 130; }
      if (wait) {
        fq = rec.qs[rec.qs.length - 1]; cv = OA_cache[key + '@' + fq];
        if (cv && Math.abs(q / fq - 1) < 0.3) { c.drawImage(cv, cv.oaX / fq, cv.oaY / fq, cv.width / fq, cv.height / fq); return; }
        cv = null;
      }
    }
    cv = OA_cacheBuild(key + '@' + q, q, bx, by, bw, bh, fn);
    rec.qs.push(q);
    if (rec.qs.length > 2) { delete OA_cache[key + '@' + rec.qs.shift()]; OA_cacheN--; }
  }
  if (even && !soft) {
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.drawImage(cv, Math.round(m.e) + cv.oaX, Math.round(m.f) + cv.oaY);
    c.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
  } else {
    c.drawImage(cv, cv.oaX / q, cv.oaY / q, cv.width / q, cv.height / q);
  }
}

// ---------- tiny shared sprites ----------
// bone outline as one path (all sub-paths wind the same way)
function OA_bonePath(c, x, y, len, th, rot) {
  var cs = Math.cos(rot || 0), sn = Math.sin(rot || 0), r = th * 0.62, hl = len / 2 - r;
  var hx = hl * cs, hy = hl * sn, nx = -sn * th / 2, ny = cs * th / 2, e, q, kx, ky;
  c.beginPath();
  c.moveTo(x - hx - nx, y - hy - ny); c.lineTo(x + hx - nx, y + hy - ny);
  c.lineTo(x + hx + nx, y + hy + ny); c.lineTo(x - hx + nx, y - hy + ny); c.closePath();
  for (e = -1; e <= 1; e += 2) for (q = -1; q <= 1; q += 2) {
    kx = x + e * hx - q * sn * r * 0.78; ky = y + e * hy + q * cs * r * 0.78;
    c.moveTo(kx + r, ky); c.arc(kx, ky, r, 0, OA_TAU);
  }
}
function OA_bone(c, x, y, len, th, rot, col, lw, ocol) {
  OA_bonePath(c, x, y, len, th, rot); OA_of(c, col, lw || 1.4, ocol);
}
function OA_paw(c, x, y, s, col, rot) {
  c.save(); c.translate(x, y); if (rot) c.rotate(rot); c.scale(s, s); c.fillStyle = col;
  c.beginPath(); c.ellipse(0, 1.3, 2.7, 2.1, 0, 0, OA_TAU);
  c.moveTo(-1.8, -1.2); c.arc(-2.9, -1.2, 1.1, 0, OA_TAU);
  c.moveTo(0.1, -2.9); c.arc(-1.05, -2.9, 1.15, 0, OA_TAU);
  c.moveTo(2.2, -2.9); c.arc(1.05, -2.9, 1.15, 0, OA_TAU);
  c.moveTo(4, -1.2); c.arc(2.9, -1.2, 1.1, 0, OA_TAU);
  c.fill(); c.restore();
}
// lower-right shade crescent for round things
function OA_crescent(c, x, y, r, col) {
  c.beginPath(); c.arc(x, y, r, -0.75, 2.3); c.arc(x - r * 0.36, y - r * 0.36, r * 1.02, 1.95, -0.4, true); c.closePath();
  c.fillStyle = col; c.fill();
}
function OA_ball(c, x, y, r, rot, col, shade) {
  OA_el(c, x, y, r, r); OA_fo(c, col || '#d6de52', 1.6);
  OA_crescent(c, x, y, r - 0.8, shade || '#b3bd3a');
  var a = rot || 0, cx = Math.cos(a), sy = Math.sin(a);
  c.strokeStyle = '#fbfbe6'; c.lineWidth = Math.max(0.9, r * 0.17);
  c.beginPath(); c.arc(x - cx * r * 1.15, y - sy * r * 1.15, r * 0.95, a - 0.72, a + 0.72); c.stroke();
  c.beginPath(); c.arc(x + cx * r * 1.15, y + sy * r * 1.15, r * 0.95, a + Math.PI - 0.72, a + Math.PI + 0.72); c.stroke();
  OA_el(c, x - r * 0.38, y - r * 0.42, r * 0.22, r * 0.15, -0.6); OA_f(c, 'rgba(255,255,255,0.75)');
}
// rubber duck; (x, y) is the middle of its base / waterline, about 15 px wide at s = 1
function OA_duck(c, x, y, s, dir) {
  c.save(); c.translate(x, y); c.scale(s * (dir || 1), s);
  c.beginPath();
  c.moveTo(-7.4, -6); c.quadraticCurveTo(-4.2, -3.6, -0.5, -4.2); c.quadraticCurveTo(4, -5, 6.6, -2.4);
  c.quadraticCurveTo(7.6, 2.6, 2.2, 3); c.lineTo(-2.4, 3); c.quadraticCurveTo(-7.6, 2.6, -7.4, -6); c.closePath();
  c.moveTo(7.3, -7.6); c.arc(3.4, -7.6, 3.9, 0, OA_TAU);
  OA_of(c, '#f7cf3d', 1.5);
  // belly shade + wing
  c.beginPath(); c.moveTo(-6.6, 0.4); c.quadraticCurveTo(-1, 4.2, 6.6, 0); c.quadraticCurveTo(6.4, 2.8, 2.2, 3); c.lineTo(-2.4, 3); c.quadraticCurveTo(-6, 2.8, -6.6, 0.4); OA_f(c, '#e2ae2a');
  c.beginPath(); c.moveTo(-3.8, -1.8); c.quadraticCurveTo(-1.4, 1.4, 1.8, -1.4); OA_s(c, '#c28f1c', 1.1);
  // beak, eye, shine
  c.beginPath(); c.moveTo(6.6, -8.4); c.quadraticCurveTo(10.6, -8, 10.2, -6.4); c.quadraticCurveTo(8.4, -5.6, 6.8, -6); c.closePath(); OA_fo(c, '#f08a3c', 1.1);
  OA_el(c, 4.5, -8.5, 0.95, 1.05); OA_f(c, OA_OUT);
  OA_el(c, 1.9, -9.6, 1.1, 0.7, -0.5); OA_f(c, 'rgba(255,255,255,0.8)');
  c.restore();
}
function OA_tuft(c, x, y, s, col) {
  c.strokeStyle = col || '#4d8f3f'; c.lineWidth = 1.7; c.beginPath();
  c.moveTo(x, y); c.quadraticCurveTo(x - 1.5 * s, y - 3 * s, x - 3.6 * s, y - 4.6 * s);
  c.moveTo(x + 0.6 * s, y); c.quadraticCurveTo(x + 0.6 * s, y - 4 * s, x + 0.2 * s, y - 6.4 * s);
  c.moveTo(x + 1.2 * s, y); c.quadraticCurveTo(x + 2.6 * s, y - 2.6 * s, x + 4.4 * s, y - 3.8 * s);
  c.stroke();
}
function OA_sparkle(c, x, y, r, a, col) {
  if (a <= 0.02) return;
  var pa = c.globalAlpha;
  c.globalAlpha = pa * (a > 1 ? 1 : a); c.fillStyle = col || '#ffffff'; c.beginPath();
  c.moveTo(x, y - r); c.quadraticCurveTo(x, y, x + r, y); c.quadraticCurveTo(x, y, x, y + r);
  c.quadraticCurveTo(x, y, x - r, y); c.quadraticCurveTo(x, y, x, y - r); c.fill(); c.globalAlpha = pa;
}
// a heap of kibble nuggets filling a dome (cx, base y, half width, height)
function OA_kibble(c, cx, by, hw, hh, seed, n) {
  var i, a, rr2, px, py;
  for (i = 0; i < n; i++) {
    a = OA_h(seed + i * 1.7) * Math.PI; rr2 = Math.sqrt(OA_h(seed + i * 3.1 + 5));
    px = cx + Math.cos(a) * hw * rr2 * 0.9; py = by - Math.sin(a) * hh * rr2 * 0.85 - 0.6;
    OA_el(c, px, py, 1.7, 1.35, OA_h(seed + i) * 3);
    c.fillStyle = (i % 3 === 0) ? '#d3a066' : (i % 3 === 1) ? '#96602f' : '#b9814a'; c.fill();
  }
}
// water droplets thrown up and falling back (ph 0..1)
function OA_splash(c, x, y, ph, n, spread, height, seed) {
  if (ph < 0) return;
  var i, a, px, py, r;
  for (i = 0; i < n; i++) {
    a = (i + 0.5) / n * 2 - 1 + (OA_h(seed + i) - 0.5) * 0.3;
    px = x + a * spread * (0.25 + ph * 0.9);
    py = y - height * (0.55 + 0.45 * OA_h(seed + i * 7)) * Math.sin(Math.min(1, ph * 1.05) * Math.PI);
    r = (1.7 + OA_h(seed + i * 3) * 1.1) * (1 - ph * 0.5);
    c.beginPath(); c.moveTo(px, py - r * 1.7); c.quadraticCurveTo(px + r * 1.3, py + r * 0.4, px, py + r); c.quadraticCurveTo(px - r * 1.3, py + r * 0.4, px, py - r * 1.7);
    c.fillStyle = '#bfe9f7'; c.fill(); c.strokeStyle = '#3f8fc4'; c.lineWidth = 0.9; c.stroke();
  }
}
// a clump of soap suds (white bubbles with a soft blue rim)
function OA_suds(c, x, y, s, seed, wob) {
  var i, n = 4, a, r;
  c.beginPath();
  for (i = 0; i < n; i++) {
    a = i / n * OA_TAU + seed; r = (2.6 + OA_h(seed + i) * 1.6) * s;
    var px = x + Math.cos(a) * 2.8 * s, py = y + Math.sin(a) * 1.6 * s + (wob || 0) * Math.sin(seed * 3 + i);
    c.moveTo(px + r, py); c.arc(px, py, r, 0, OA_TAU);
  }
  OA_of(c, '#ffffff', 0.7, '#86b4c9');
  OA_el(c, x + 1.6 * s, y + 1.4 * s, 2.2 * s, 1.3 * s); OA_f(c, '#dcf0f8');
  OA_el(c, x - 1.6 * s, y - 1.3 * s, 0.9 * s, 0.6 * s); OA_f(c, '#ffffff');
}
function OA_bubble(c, x, y, r, a) {
  var pa = c.globalAlpha;
  c.globalAlpha = pa * a; OA_el(c, x, y, r, r); c.fillStyle = 'rgba(255,255,255,0.35)'; c.fill();
  c.strokeStyle = '#eafaff'; c.lineWidth = 0.9; c.stroke();
  OA_el(c, x - r * 0.35, y - r * 0.35, r * 0.28, r * 0.2); c.fillStyle = '#ffffff'; c.fill(); c.globalAlpha = pa;
}

// ---------- cached mini-sprites for the animated bits ----------
// placed on whole device pixels unless soft = true (sub-pixel placement, a little dearer)
function OA_sprite(c, key, x, y, bx, by, bw, bh, fn, soft) {
  c.translate(x, y); OA_static(c, key, bx, by, bw, bh, fn, soft); c.translate(-x, -y);
}
function OA_sDuck(c, x, y, dir) {
  OA_sprite(c, dir < 0 ? 'duckL' : 'duckR', x, y, -13, -14, 26, 20, function (g) { OA_duck(g, 0, 0, 1, dir < 0 ? -1 : 1); });
}
function OA_sBall(c, x, y) {
  OA_sprite(c, 'tball', x, y, -8, -8, 16, 16, function (g) { OA_ball(g, 0, 0, 6, 0.5); });
}
function OA_sSuds(c, x, y, v) {
  v = ((v | 0) % 3 + 3) % 3;
  OA_sprite(c, 'suds' + v, x, y, -10, -8, 20, 16, function (g) { OA_suds(g, 0, 0, 1 + v * 0.12, v * 2.3 + 1, 0.4); });
}
function OA_sBubble(c, x, y, big, a) {
  if (a <= 0.03) return;
  var pa = c.globalAlpha;
  c.globalAlpha = pa * (a > 1 ? 1 : a);
  OA_sprite(c, big ? 'bubB' : 'bubS', x, y, -5, -5, 10, 10, function (g) { OA_bubble(g, 0, 0, big ? 3 : 1.9, 1); });
  c.globalAlpha = pa;
}
// expanding, fading ripple ring as a 10-frame flip-book (ph 0..1)
function OA_sRipple(c, x, y, ph, big) {
  var f = Math.floor(OA_cl(ph, 0, 0.999) * 10), s = big ? 1 : 0.62;
  OA_sprite(c, (big ? 'ripB' : 'ripS') + f, x, y, -14 * s - 1, -6 * s - 1, 28 * s + 2, 12 * s + 2, function (g) {
    var p = (f + 0.5) / 10, ga = g.globalAlpha; g.globalAlpha = ga * (1 - p) * 0.85; OA_el(g, 0, 0, (2 + p * 10.5) * s, (0.8 + p * 4) * s); OA_s(g, '#ffffff', 1.05); g.globalAlpha = ga;
  });
}
// a little pennant on a stick as an 8-frame flip-book; (x, y) = foot of the stick
function OA_sFlag(c, key, x, y, t, dir, h, col) {
  var f = ((Math.floor(t * 9) % 8) + 8) % 8; dir = dir < 0 ? -1 : 1;
  OA_sprite(c, key + f + (dir < 0 ? 'L' : 'R'), x, y, -11, -h - 8, 22, h + 10, function (g) {
    var a = f / 8 * OA_TAU, fw = Math.sin(a) * 1.2, ty = -h;
    OA_ln(g, 0, 0, 0, ty, OA_OUT, 1.5);
    g.beginPath(); g.moveTo(0, ty + 0.2); g.quadraticCurveTo(dir * 4, ty - 1 + fw, dir * 7.6, ty + 2 + fw * 0.6); g.quadraticCurveTo(dir * 4, ty + 3.6 - fw * 0.5, 0, ty + 5); g.closePath(); OA_fo(g, col, 1.2);
  });
}
// single-slot cache for layers that change now and then (the growing timber frame)
var OA_dynCache = {}, OA_dynN = 0, OA_dynAux = null;
function OA_dyn(c, slot, ver, bx, by, bw, bh, fn) {
  var m = (OA_CACHE_ON && !OA_vector && c.getTransform && typeof document !== 'undefined') ? c.getTransform() : null;
  if (!m || Math.abs(m.b) > 1e-4 || Math.abs(m.c) > 1e-4 || Math.abs(m.a - m.d) > 0.002 || !(m.a > 0.55) || m.a > 6.5) { fn(c); return; }
  var q = Math.round(m.a * 500) / 500, e = OA_dynCache[slot], ox = Math.floor(bx * q), oy = Math.floor(by * q), g;
  var W2 = Math.max(1, Math.ceil((bx + bw) * q) - ox), H2 = Math.max(1, Math.ceil((by + bh) * q) - oy);
  if (!e) { if (OA_dynN > 40) { OA_dynCache = {}; OA_dynN = 0; } e = OA_dynCache[slot] = { ver: null, q: 0, cv: document.createElement('canvas'), aux: null }; OA_dynN++; }
  if (e.ver !== ver || e.q !== q || e.cv.width !== W2 || e.cv.height !== H2) {
    e.cv.width = W2; e.cv.height = H2; g = e.cv.getContext('2d');
    g.setTransform(q, 0, 0, q, -ox, -oy); g.lineJoin = 'round'; g.lineCap = 'round';
    fn(g); e.ver = ver; e.q = q; e.aux = OA_dynAux;
  }
  OA_dynAux = e.aux;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.drawImage(e.cv, Math.round(m.e) + ox, Math.round(m.f) + oy);
  c.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
}
// name plates are only cached once the sign font has arrived (or after a few seconds, whatever happens)
var OA_fontOK = false, OA_fontT0 = 0;
function OA_fontReady() {
  if (OA_fontOK) return true;
  try {
    var now = Date.now(); if (!OA_fontT0) OA_fontT0 = now;
    OA_fontOK = !(typeof document !== 'undefined' && document.fonts && document.fonts.check) || document.fonts.check('11.5px "Jersey 25"') || now - OA_fontT0 > 6000;
  } catch (e) { OA_fontOK = true; }
  return OA_fontOK;
}

// a little bluebird (about 10 px), feet at (0, 0), facing right.  pose 0 perched, 1 pecking, 2 wings up
function OA_birdArt(c, pose) {
  c.save();
  if (pose === 1) { c.translate(0.6, 0.4); c.rotate(0.55); }
  OA_ln(c, -1.1, 0, -1.1, -1.4, OA_OUT, 1); OA_ln(c, 1.3, 0, 1.3, -1.4, OA_OUT, 1);
  OA_pl(c, [-3.6, -4.4, -8.6, -6.6, -8.2, -3, -3.6, -2]); OA_fo(c, '#3f8fc4', 1.2);
  OA_el(c, 0.2, -4.8, 4.7, 4.1); OA_fo(c, '#66bde3', 1.4);
  c.beginPath(); c.ellipse(1, -4, 3.3, 2.9, 0, 0.1, Math.PI - 0.3); c.closePath(); OA_f(c, OA_CREAM);
  if (pose === 2) { OA_pl(c, [-2.6, -6.4, -4.6, -13, 1.6, -7.4]); OA_fo(c, '#3f8fc4', 1.2); }
  else { OA_el(c, -1.4, -4.9, 2.7, 1.9, 0.45); OA_f(c, '#3f8fc4'); }
  OA_pl(c, [4.2, -6.6, 7.2, -5.6, 4.3, -4.6]); OA_fo(c, '#f08a3c', 1);
  OA_el(c, 2.5, -6.3, 0.85, 0.85); OA_f(c, OA_OUT);
  c.restore();
}
// now and then a bird drops in, hops about and pecks, then flies off again. (x, y) = where it perches
function OA_birdVisit(c, x, y, t, seed) {
  var ph = ((t + seed * 7.3) % 23 + 23) % 23, A0 = c.globalAlpha, pose = 0, bx = x, by = y, k;
  if (ph >= 7.1) return;
  if (ph < 0.5) { k = ph / 0.5; bx = x + 20 * (1 - k); by = y - 24 * (1 - k) * (1 - k); pose = (Math.floor(t * 12) % 2) ? 2 : 0; c.globalAlpha = A0 * k; }
  else if (ph < 6.5) {
    var s = ph - 0.5, hops = [0, 0, 4, 4, -3, -3, 1], i = Math.floor(s), fr = s - i, from = hops[i], to = hops[Math.min(6, i + 1)];
    if (from !== to && fr > 0.7) { k = (fr - 0.7) / 0.3; bx = x + from + (to - from) * k; by = y - Math.sin(k * Math.PI) * 3.4; }
    else { bx = x + from; pose = (fr > 0.2 && fr < 0.34) || (fr > 0.44 && fr < 0.58) ? 1 : 0; }
  } else { k = (ph - 6.5) / 0.6; bx = x + 1 - 24 * k; by = y - 30 * k * k - 4 * k; pose = (Math.floor(t * 12) % 2) ? 2 : 0; c.globalAlpha = A0 * (1 - k); }
  OA_sprite(c, 'bird' + pose, bx, by, -11, -15, 20, 17, function (g) { OA_birdArt(g, pose); });
  c.globalAlpha = A0;
}
// a sparkle that blinks once every period seconds
function OA_twinkle(c, x, y, r, t, period, seed) {
  var ph = ((t + OA_h(seed) * period) % period + period) % period;
  if (ph < 0.5) OA_sparkle(c, x, y, r * (0.6 + 0.4 * Math.sin(ph / 0.5 * Math.PI)), Math.sin(ph / 0.5 * Math.PI));
}

// =====================================================================================================
//  SOLID STATIONS
// =====================================================================================================

// ---------------------------------------------------------------- kennel (2x2)
var OA_ROOFS = [
  { a: '#c9694a', d: '#a04c36', h: '#e28d6b', s: '#b65a40' },   // terracotta
  { a: '#43a093', d: '#2c7268', h: '#6cc4b5', s: '#378a7f' },   // teal
  { a: '#6a8fbd', d: '#456893', h: '#93b4da', s: '#587ca9' },   // slate blue
  { a: '#dcaa45', d: '#a97a28', h: '#f1cb72', s: '#c6933a' }    // mustard
];
function OA_roofSlab(c, base, alt, line) {
  // left roof plane: front edge (-2,50)->(48,9), back edge 17 px higher
  var k, j, x, y, n = 6, D = 17, x2, y2;
  OA_pl(c, [-2, 50, 48, 9, 48, -8, -2, 33]); OA_f(c, base);
  c.fillStyle = alt;
  for (k = 0; k < n; k += 2) {
    x = -2 + 50 * k / n; y = 50 - 41 * k / n; x2 = -2 + 50 * (k + 1) / n; y2 = 50 - 41 * (k + 1) / n;
    OA_pl(c, [x, y, x2, y2, x2, y2 - D, x, y - D]); c.fill();
  }
  c.strokeStyle = line; c.lineWidth = 1.15; c.beginPath();
  for (k = 1; k < n; k++) {
    x = -2 + 50 * k / n; y = 50 - 41 * k / n;
    var st = (k % 2) ? [0, 0.5, 1.5, 2.5, 3] : [0, 1, 2, 3];
    for (j = 0; j < st.length - 1; j++) {
      var ya = y - st[j] * D / 3, yb = y - st[j + 1] * D / 3;
      c.moveTo(x, ya); c.quadraticCurveTo(x - 3.6, (ya + yb) / 2 + 2.4, x, yb);
    }
  }
  c.stroke();
}
function OA_kennelStatic(c, v) {
  var R = OA_ROOFS[v] || OA_ROOFS[0], i, y;
  OA_shadow(c, 48, 90.5, 48, 7.5);
  var wall = [9, 91, 9, 46, 48, 14, 87, 46, 87, 91];
  // ---- front wall
  OA_pl(c, wall); OA_f(c, OA_WL);
  c.save(); OA_pl(c, wall); c.clip();
  c.fillStyle = '#d4a26a'; for (i = 0; i < 8; i += 2) c.fillRect(9, 22 + i * 9, 78, 9);
  c.fillStyle = 'rgba(122,78,42,0.26)'; c.fillRect(78, 14, 9, 77);                 // right side in shade
  OA_pl(c, [4, 51, 48, 15, 92, 51, 92, 60, 48, 24, 4, 60]); OA_f(c, 'rgba(110,66,34,0.36)');   // shade under the eaves
  c.strokeStyle = OA_WM; c.lineWidth = 1.1; c.beginPath();
  for (i = 0; i < 9; i++) { y = 22 + i * 9; c.moveTo(9, y); c.lineTo(87, y); }
  // butt joints
  c.moveTo(22, 58); c.lineTo(22, 67); c.moveTo(72, 49); c.lineTo(72, 58); c.moveTo(18, 76); c.lineTo(18, 85);
  c.moveTo(76, 67); c.lineTo(76, 76); c.moveTo(57, 31); c.lineTo(57, 40); c.stroke();
  // nails
  c.fillStyle = OA_WD;
  [[12, 62.5], [12, 80.5], [84, 53.5], [84, 71.5], [24.5, 62.5], [69.5, 53.5], [20.5, 80.5], [73.5, 71.5]].forEach(function (p) { c.fillRect(p[0] - 0.7, p[1] - 0.7, 1.4, 1.4); });
  // highlights on the sunny left edge
  c.fillStyle = 'rgba(255,236,200,0.35)'; c.fillRect(9.9, 47, 2, 38);
  // skirting board
  c.fillStyle = OA_WM; c.fillRect(9, 85, 78, 6);
  c.fillStyle = OA_WD; c.fillRect(9, 84.4, 78, 1.1);
  c.restore();
  OA_pl(c, wall); OA_s(c, OA_OUT, 1.8);
  // ---- painted paw on the left of the door
  OA_paw(c, 20.5, 71, 1.25, 'rgba(251,241,216,0.85)', -0.25);
  // ---- doorway
  c.beginPath(); c.moveTo(32, 91); c.lineTo(32, 74); c.arc(48, 74, 16, Math.PI, 0); c.lineTo(64, 91); c.closePath(); OA_f(c, '#2a1b15');
  c.save(); c.clip();
  c.fillStyle = '#3a261c'; c.fillRect(32, 84, 32, 8);                                   // a bit of floor
  OA_el(c, 48, 66, 11, 7); OA_f(c, 'rgba(255,214,150,0.05)');
  c.strokeStyle = 'rgba(0,0,0,0.25)'; c.lineWidth = 1; c.beginPath(); c.moveTo(40, 58); c.lineTo(40, 84); c.moveTo(56, 58); c.lineTo(56, 84); c.stroke();
  c.restore();
  c.beginPath(); c.moveTo(32, 91); c.lineTo(32, 74); c.arc(48, 74, 16, Math.PI, 0); c.lineTo(64, 91);
  OA_s(c, OA_OUT, 6.4); OA_s(c, OA_WD, 3.1);
  c.beginPath(); c.arc(48, 74, 16.6, Math.PI * 1.08, Math.PI * 1.6); OA_s(c, '#a06a3c', 1);
  // cushion
  OA_kennelCushion(c);
  // ---- little lantern on the right
  c.strokeStyle = OA_OUT; c.lineWidth = 1.5; c.beginPath(); c.moveTo(80.5, 56); c.lineTo(76.5, 56); c.lineTo(76.5, 59.5); c.stroke();
  OA_pl(c, [72.6, 62, 76.5, 58.6, 80.4, 62]); OA_fo(c, '#5a524b', 1.4);
  OA_rr(c, 73.4, 62, 6.2, 8.4, 1.2); OA_fo(c, '#f4d36b', 1.4);
  c.fillStyle = '#fff3c4'; c.fillRect(74.6, 63.4, 1.6, 5.4);
  OA_ln(c, 76.5, 62, 76.5, 70.4, '#5a524b', 0.9);
  c.fillStyle = '#5a524b'; c.fillRect(72.9, 69.9, 7.2, 1.6);
  // ---- roof: two shingled planes, ridge cap, fascia
  OA_roofSlab(c, R.a, R.h, R.d);
  c.save(); c.translate(96, 0); c.scale(-1, 1); OA_roofSlab(c, R.s, R.a, R.d); c.restore();
  OA_pl(c, [-2, 50, 48, 9, 98, 50, 98, 33, 48, -8, -2, 33]); OA_s(c, OA_OUT, 1.8);
  OA_pl(c, [-2, 50, 48, 9, 98, 50, 98, 55.5, 48, 15, -2, 55.5]); OA_fo(c, R.d, 1.8);       // roof edge
  c.strokeStyle = R.a; c.lineWidth = 1.1; c.beginPath(); c.moveTo(0.5, 50.6); c.lineTo(48, 11.7); c.lineTo(95.5, 50.6); c.stroke();
  OA_rr(c, 45, -10.5, 6, 22, 2.5); OA_fo(c, R.h, 1.7);                                   // ridge cap
  c.fillStyle = R.a; c.fillRect(48.6, -8.4, 1.6, 17.5);
  OA_el(c, 48, 13.4, 3.3, 3.3); OA_fo(c, OA_WD, 1.6);
  OA_el(c, 47.3, 12.6, 1.1, 1.1); OA_f(c, '#a8743f');
  // ---- grass tufts hugging the base
  OA_tuft(c, 11, 93, 1, '#4d8f3f'); OA_tuft(c, 83, 93.5, 0.9, '#4d8f3f'); OA_tuft(c, 69, 94, 0.7, '#5d9d49');
}
function OA_kennelCushion(c) {
  OA_rr(c, 33.2, 85.2, 29.6, 6.6, 3.2); OA_fo(c, '#d9574a', 1.5);
  c.fillStyle = '#b9443a'; c.fillRect(35.5, 89.2, 25, 1.5);
  c.strokeStyle = '#f08f7f'; c.lineWidth = 1.1; c.beginPath(); c.moveTo(36.5, 87); c.lineTo(52, 87); c.stroke();
  c.fillStyle = OA_CREAM; c.fillRect(43.5, 87.6, 1.4, 1.4); c.fillRect(51.5, 87.6, 1.4, 1.4);
}
function OA_kennelPlate(c, label) {
  // a tiny chain and a cream plaque
  c.strokeStyle = OA_OUT; c.lineWidth = 1.1; c.beginPath(); c.moveTo(33, 33); c.lineTo(33, 38.5); c.moveTo(63, 33); c.lineTo(63, 38.5); c.stroke();
  OA_rr(c, 27, 37.5, 42, 12.5, 3); OA_fo(c, OA_CREAM, 1.6);
  c.fillStyle = '#e6d6b0'; c.fillRect(29.5, 47.1, 37, 1.6);
  c.fillStyle = OA_WM; c.fillRect(29.6, 43, 1.5, 1.5); c.fillRect(64.9, 43, 1.5, 1.5);
  if (label !== null && label !== undefined && label !== '') {
    label = String(label); if (label.length > 12) label = label.slice(0, 11) + '.';
    c.font = '11.5px "Jersey 25", sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = '#5a3a22';
    c.fillText(label, 48, 44, 32);
  } else {
    OA_bonePath(c, 48, 43.7, 15, 3.2, 0); OA_f(c, '#c9935a');
  }
}
OBJECT_ART.kennel = {
  anchor: { headX: 48, headY: 76, headR: 13 },
  box: [-4, -12, 100, 97],
  draw: function (c, o, t, env) {
    o = o || {}; env = env || OA_ENV0; t = OA_num(t, 0);
    var v = OA_var(o, 4), night = OA_cl(OA_num(env.night, 0), 0, 1);
    OA_begin(c, o);
    OA_squash(c, OA_usePh(o), 48, 91, 0.045);
    OA_static(c, 'kennel' + v, -6, -14, 108, 114, function (g) { OA_kennelStatic(g, v); });
    var lab = (o.label === null || o.label === undefined) ? '' : String(o.label);
    if (lab === '' || OA_fontReady()) OA_static(c, 'kplate:' + lab, 24, 30, 48, 24, function (g) { OA_kennelPlate(g, lab); });
    else OA_kennelPlate(c, lab);
    if (night < 0.5) OA_birdVisit(c, 48, -10.4, t, OA_num(o.id, 0));
    if (night > 0.02) {
      // the lantern glows and flickers after dark
      var fl = 0.85 + 0.15 * Math.sin(t * 9 + OA_num(o.id, 0)) * Math.sin(t * 5.3), A0 = c.globalAlpha;
      c.globalAlpha = A0 * night * fl;
      OA_static(c, 'kglow', 54, 44, 45, 45, function (g) {
        var gr = g.createRadialGradient(76.5, 66, 1, 76.5, 66, 22);
        gr.addColorStop(0, 'rgba(255,220,130,0.62)'); gr.addColorStop(1, 'rgba(255,200,110,0)');
        g.fillStyle = gr; g.fillRect(54, 44, 45, 45);
        OA_rr(g, 74.2, 62.8, 4.6, 6.8, 1); OA_f(g, 'rgba(255,250,215,0.8)');
      });
      c.globalAlpha = A0;
    }
    c.restore();
  },
  // the cushion's front roll, so the sleeper's chin tucks in behind it
  drawFront: function (c, o, t, env) {
    o = o || {};
    OA_begin(c, o); OA_squash(c, OA_usePh(o), 48, 91, 0.045); OA_static(c, 'kcush', 30, 82, 36, 12, OA_kennelCushion); c.restore();
  },
  light: function (o, env) {
    var T = OA_tile(), k = T / 48; o = o || {};
    return { x: OA_num(o.x, 0) * T + 76.5 * k, y: OA_num(o.y, 0) * T + 66 * k, r: 46 * k, color: '#ffd78a' };
  }
};

// ---------------------------------------------------------------- food bin (1x1)
function OA_bowl(c, x, y, hw, col, rim, inner) {
  c.beginPath(); c.moveTo(x - hw, y); c.quadraticCurveTo(x - hw + 1, y + 6.2, x - hw + 3.6, y + 6.2);
  c.lineTo(x + hw - 3.6, y + 6.2); c.quadraticCurveTo(x + hw - 1, y + 6.2, x + hw, y); c.closePath(); OA_fo(c, col, 1.6);
  OA_el(c, x, y, hw, 2.5); OA_fo(c, rim, 1.5);
  if (inner) { OA_el(c, x, y + 0.3, hw - 2.2, 1.4); OA_f(c, inner); }
}
function OA_foodbinStatic(c, withScoop) {
  var i;
  OA_shadow(c, 25, 43.5, 23, 5);
  // leaning lid (behind)
  OA_el(c, 10.5, 5.5, 9.3, 9.8, -0.25); OA_fo(c, OA_WM, 1.8);
  OA_el(c, 10.1, 5.1, 6.9, 7.4, -0.25); OA_f(c, OA_WL);
  c.strokeStyle = OA_WM; c.lineWidth = 1; c.beginPath(); c.moveTo(7, -1); c.lineTo(6.2, 11.5); c.moveTo(12.6, -2); c.lineTo(12.4, 12.4); c.stroke();
  OA_el(c, 10.2, 4.6, 2, 2); OA_fo(c, '#918b80', 1.2);
  // paper kibble sack (back right)
  c.beginPath(); c.moveTo(29, 37); c.lineTo(28.6, 9.5); c.quadraticCurveTo(28.6, 6, 32.5, 6.3); c.lineTo(43, 5.4); c.quadraticCurveTo(46.6, 5.4, 46.2, 10); c.lineTo(46.8, 37); c.closePath(); OA_fo(c, '#dfc193', 1.8);
  OA_pl(c, [42.2, 6.6, 45.4, 9, 45.9, 36.2, 41.8, 36.2]); OA_f(c, '#c8a676');
  c.fillStyle = '#d9574a'; c.fillRect(29.6, 12.4, 16.1, 3.2);
  c.fillStyle = '#b9443a'; c.fillRect(42, 12.4, 3.7, 3.2);
  OA_paw(c, 38, 23, 1.15, '#a8743f', 0.15);
  c.strokeStyle = '#c8a676'; c.lineWidth = 1; c.beginPath(); c.moveTo(33, 18); c.lineTo(33.2, 30); c.stroke();
  OA_rr(c, 28.6, 2.4, 17.8, 5.4, 2.4); OA_fo(c, '#ecd3aa', 1.6);
  OA_ln(c, 31, 5.2, 44, 4.6, '#c8a676', 1);
  // barrel body
  c.beginPath(); c.moveTo(3.6, 15); c.quadraticCurveTo(1.6, 28, 5.4, 40.5); c.ellipse(18, 40.5, 12.6, 3.8, 0, Math.PI, 0, true);
  c.quadraticCurveTo(34.4, 28, 32.4, 15); c.closePath(); OA_f(c, OA_WL);
  c.save(); c.clip();
  c.fillStyle = '#d6a66e'; c.fillRect(6, 10, 6.5, 36);
  c.fillStyle = 'rgba(122,78,42,0.3)'; c.fillRect(25.5, 10, 9, 36);
  c.strokeStyle = OA_WM; c.lineWidth = 1.05; c.beginPath();
  for (i = 0; i < 5; i++) { var sx = 7 + i * 5.5; c.moveTo(sx, 14); c.quadraticCurveTo(sx + (i - 2) * 0.9, 28, sx + (i - 2) * -0.2 + (2 - i) * 0.4, 45); }
  c.stroke();
  // iron hoops
  [[20.5, 16.4, 4.3], [36, 15, 3.9]].forEach(function (hp) {
    c.beginPath(); c.ellipse(18, hp[0], hp[1], hp[2], 0, -0.2, Math.PI + 0.2);
    OA_s(c, OA_OUT, 4.4); OA_s(c, '#8e887d', 2.5);
    c.beginPath(); c.ellipse(18, hp[0] - 0.5, hp[1] - 1.6, hp[2], 0, 1.9, Math.PI - 0.3); OA_s(c, '#c4beb2', 0.9);
    c.beginPath(); c.ellipse(18, hp[0], hp[1] - 1.4, hp[2], 0, 0.05, 0.5); OA_s(c, '#6f6a62', 2.5);
  });
  c.restore();
  c.beginPath(); c.moveTo(3.6, 15); c.quadraticCurveTo(1.6, 28, 5.4, 40.5); c.ellipse(18, 40.5, 12.6, 3.8, 0, Math.PI, 0, true);
  c.quadraticCurveTo(34.4, 28, 32.4, 15); OA_s(c, OA_OUT, 1.8);
  // label
  OA_rr(c, 9.5, 25.2, 15, 8.6, 2); OA_fo(c, OA_CREAM, 1.3);
  OA_bonePath(c, 17, 29.5, 10, 2.6, -0.12); OA_f(c, '#b9814a');
  // opening + kibble heap
  OA_el(c, 18, 15, 14.4, 4.4); OA_fo(c, '#5a3a22', 1.8);
  c.beginPath(); c.moveTo(5.6, 15.6); c.bezierCurveTo(8, 4.6, 27, 3.6, 30.4, 15.6); c.ellipse(18, 15.3, 12.4, 3.3, 0, 0, Math.PI); c.closePath(); OA_fo(c, '#a7713d', 1.6);
  OA_kibble(c, 18, 16.6, 11.6, 9.6, 3, 26);
  // bowls stacked in front
  OA_bowl(c, 38.6, 39, 7.6, '#d9574a', '#ec7a6c');
  OA_bowl(c, 38.2, 35.6, 7.6, '#3aa89a', '#63c3b5');
  OA_bowl(c, 38.7, 32.2, 7.6, '#f2c14e', '#f8d987', '#c99a2e');
  OA_tuft(c, 4.5, 45.5, 0.8); OA_tuft(c, 28, 46.5, 0.7, '#5d9d49');
  if (withScoop) { c.save(); c.translate(22.5, 9.5); OA_scoop(c); c.restore(); }
}
function OA_scoop(c) {   // drawn around (0,0) = where it digs into the kibble, pointing up-right
  OA_ln(c, 3, -4, 9.5, -10.5, OA_OUT, 4.6); OA_ln(c, 3, -4, 9.5, -10.5, OA_WM, 2.4);
  OA_el(c, 9.8, -10.8, 1.9, 1.9); OA_fo(c, OA_WM, 1.3);
  c.beginPath(); c.moveTo(-4.6, -0.6); c.lineTo(1.2, 4.4); c.lineTo(6, -1.2); c.quadraticCurveTo(4.6, -6, -0.4, -5.6); c.closePath(); OA_fo(c, '#d9574a', 1.6);
  c.beginPath(); c.moveTo(-2.6, -0.8); c.lineTo(1, 2.2); c.lineTo(3.6, -1); OA_s(c, '#b9443a', 1.1);
  c.beginPath(); c.moveTo(0, -4.4); c.quadraticCurveTo(2.8, -4.2, 4.2, -2.2); OA_s(c, '#f08f7f', 1);
}
OBJECT_ART.foodbin = {
  box: [-1, -7, 49, 48],
  draw: function (c, o, t, env) {
    o = o || {}; t = OA_num(t, 0);
    var ph = OA_usePh(o), i;
    OA_begin(c, o);
    if (ph < 0) {
      OA_static(c, 'foodbin', -3, -9, 54, 58, function (g) { OA_foodbinStatic(g, true); });
      OA_twinkle(c, 27.4, 6.4, 3.2, t, 5.5, OA_num(o.id, 0)); c.restore(); return;
    }
    OA_squash(c, ph, 24, 45, 0.08);
    OA_static(c, 'foodbinU', -3, -9, 54, 58, function (g) { OA_foodbinStatic(g, false); });
    c.save(); c.translate(22.5, 9.5); c.rotate(Math.sin(ph * Math.PI * 4) * 0.35 * (1 - ph)); OA_scoop(c); c.restore();
    for (i = 0; i < 5; i++) {
      var a = (i - 2) * 4.2, up = Math.sin(ph * Math.PI) * (10 + i % 3 * 4);
      OA_el(c, 17 + a * (0.4 + ph), 8 - up, 1.8, 1.4, ph * 5 + i); OA_fo(c, i % 2 ? '#b9814a' : '#d3a066', 0.9);
    }
    c.restore();
  }
};

// ---------------------------------------------------------------- toy box (1x1)
function OA_star(c, x, y, r, col) {
  c.beginPath();
  for (var i = 0; i < 10; i++) { var a = -Math.PI / 2 + i * Math.PI / 5, rr2 = i % 2 ? r * 0.46 : r; c.lineTo(x + Math.cos(a) * rr2, y + Math.sin(a) * rr2); }
  c.closePath(); c.fillStyle = col; c.fill();
}
function OA_toyboxBack(c) {
  // open lid, seen from the inside
  c.beginPath(); c.moveTo(6.5, 16); c.lineTo(4.6, -3); c.quadraticCurveTo(4.4, -6.6, 8, -6.8); c.lineTo(40, -6.8); c.quadraticCurveTo(43.6, -6.6, 43.4, -3); c.lineTo(41.5, 16); c.closePath(); OA_fo(c, '#2f8a7f', 1.8);
  OA_pl(c, [9.6, 16, 8.2, -3.2, 39.8, -3.2, 38.4, 16]); OA_f(c, OA_WM);
  c.strokeStyle = OA_WD; c.lineWidth = 1; c.beginPath(); c.moveTo(8.6, 2.6); c.lineTo(39.4, 2.6); c.moveTo(9, 8.6); c.lineTo(39, 8.6); c.stroke();
  c.strokeStyle = '#256f66'; c.lineWidth = 1.1; c.beginPath(); c.moveTo(9.6, 16); c.lineTo(8.2, -3.2); c.lineTo(39.8, -3.2); c.lineTo(38.4, 16); c.stroke();
  c.fillStyle = '#4fb8aa'; c.fillRect(8, -5.8, 32, 1.3);
  // dark inside of the chest
  OA_pl(c, [6.5, 16, 41.5, 16, 43, 23, 5, 23]); OA_fo(c, '#3a2a20', 1.6);
}
function OA_toyboxFront(c) {
  OA_rr(c, 4.4, 21.4, 39.2, 22.6, 3); OA_fo(c, '#3aa89a', 1.8);
  c.save(); OA_rr(c, 4.4, 21.4, 39.2, 22.6, 3); c.clip();
  c.fillStyle = '#2f8a7f'; c.fillRect(4, 38.6, 40, 6); c.fillRect(36.5, 21, 8, 23);
  c.fillStyle = '#58beb0'; c.fillRect(5.4, 22.6, 37, 1.7);
  OA_ln(c, 4, 32.2, 44, 32.2, '#2b7d73', 1.1);
  c.restore();
  // wooden corner straps
  OA_rr(c, 3.6, 20.6, 6.4, 24, 1.6); OA_fo(c, OA_WL, 1.6);
  OA_rr(c, 38, 20.6, 6.4, 24, 1.6); OA_fo(c, OA_WM, 1.6);
  c.fillStyle = OA_WD; [[6.8, 24.4], [6.8, 40.6], [41.2, 24.4], [41.2, 40.6]].forEach(function (p) { c.beginPath(); c.arc(p[0], p[1], 0.95, 0, OA_TAU); c.fill(); });
  c.fillStyle = '#e0b27c'; c.fillRect(4.8, 22.6, 1.2, 18);
  // star badge + latch
  OA_el(c, 24, 33.8, 6.6, 6.6); OA_fo(c, OA_CREAM, 1.4);
  OA_star(c, 24, 34, 4.9, '#f2c14e');
  OA_rr(c, 21.6, 19.8, 4.8, 5.6, 1.2); OA_fo(c, '#f2c14e', 1.4);
  c.fillStyle = OA_OUT; c.fillRect(23.4, 22, 1.2, 1.9);
  // rope tug toy flopping over the rim
  c.beginPath(); c.moveTo(29.5, 17.5); c.quadraticCurveTo(35.6, 14.4, 36.2, 22.2); c.quadraticCurveTo(36.4, 27.4, 34.8, 31);
  OA_s(c, OA_OUT, 5.6); OA_s(c, '#f3e4c2', 3.2);
  c.strokeStyle = '#66a7d8'; c.lineWidth = 1.2; c.beginPath();
  c.moveTo(31, 15.6); c.lineTo(32.6, 18.4); c.moveTo(34.2, 15.4); c.lineTo(35.8, 18); c.moveTo(34.8, 20.6); c.lineTo(37.6, 21.6); c.moveTo(34.8, 24.6); c.lineTo(37.6, 25.6); c.moveTo(34.2, 28.2); c.lineTo(36.8, 29.4); c.stroke();
  OA_el(c, 34.6, 31.6, 3.1, 2.9); OA_fo(c, '#f3e4c2', 1.5);
  OA_ln(c, 33, 30.8, 36.2, 32.4, '#66a7d8', 1.1);
  c.strokeStyle = OA_OUT; c.lineWidth = 1.1; c.beginPath(); c.moveTo(33.2, 34); c.lineTo(32.4, 37); c.moveTo(34.6, 34.4); c.lineTo(34.8, 37.6); c.moveTo(36, 34); c.lineTo(37, 36.8); c.stroke();
  OA_tuft(c, 2.5, 46, 0.75); OA_tuft(c, 44.5, 46.5, 0.7, '#5d9d49');
}
OBJECT_ART.toybox = {
  box: [-1, -9, 49, 48],
  draw: function (c, o, t, env) {
    o = o || {}; t = OA_num(t, 0);
    var ph = OA_usePh(o), hop = ph >= 0 ? Math.sin(ph * Math.PI) : 0, id = OA_num(o.id, 0);
    OA_begin(c, o);
    if (ph < 0) {
      OA_static(c, 'toybox', -1, -10, 50, 60, function (g) { OA_shadow(g, 24, 44, 23, 5); OA_toyboxBack(g); OA_toyboxToys(g, 0, 0, 0, 0, 0); OA_toyboxFront(g); });
      OA_twinkle(c, 27.6, 30.6, 3.4, t, 4.6, id); OA_twinkle(c, 22.6, 10.6, 2.8, t + 2.3, 6.2, id + 5); c.restore(); return;
    }
    OA_shadow(c, 24, 44, 23, 5);
    OA_squash(c, ph, 24, 45, 0.08);
    OA_static(c, 'toyboxB', -1, -10, 50, 36, OA_toyboxBack);
    // the toys hop when the box is used
    OA_toyboxToys(c, -hop * 7, -Math.sin(OA_cl(ph * 1.25, 0, 1) * Math.PI) * 10, -hop * 5, hop, 0);
    OA_static(c, 'toyboxF', 0, 12, 48, 36, OA_toyboxFront);
    c.restore();
  }
};
function OA_toyboxToys(c, b1, b2, b3, hop, bob) {
  c.beginPath(); c.arc(12.6, 9.6 + b3, 5.6, 0, OA_TAU); OA_s(c, OA_OUT, 6); OA_s(c, '#f2a0b5', 3.2);           // pink ring
  c.beginPath(); c.arc(12.6, 9.6 + b3, 5.6, 3.4, 4.6); OA_s(c, '#fbd0da', 1);
  OA_duck(c, 33, 13.6 + b1 + bob, 0.98, -1);
  OA_el(c, 25.8, 14.6 + b2, 6.6, 6.6); OA_fo(c, '#d9574a', 1.6);                                                  // red ball
  OA_crescent(c, 25.8, 14.6 + b2, 5.8, '#b9443a');
  c.beginPath(); c.arc(25.8, 22.6 + b2, 9.6, 4.12, 5.3); OA_s(c, 'rgba(251,241,216,0.92)', 1.7);
  OA_el(c, 23.2, 11 + b2, 1.5, 1, -0.6); OA_f(c, 'rgba(255,255,255,0.8)');
  OA_ball(c, 15.4, 17 + b1 * 0.8, 5.6, 0.6 + hop * 2);
}

// ---------------------------------------------------------------- poop bin (1x1)
function OA_trashBody(c) {
  c.moveTo(11, 14.5); c.quadraticCurveTo(11.4, 32, 13.6, 42); c.ellipse(24, 42, 10.4, 3, 0, Math.PI, 0, true); c.quadraticCurveTo(36.6, 32, 37, 14.5);
}
function OA_trashLid(c) {
  c.beginPath(); c.moveTo(9.4, 14.6); c.bezierCurveTo(10, 3.6, 38, 3.6, 38.6, 14.6); c.ellipse(24, 14.6, 14.6, 4.2, 0, 0, Math.PI); c.closePath(); OA_fo(c, '#37804a', 1.8);
  c.beginPath(); c.moveTo(12.6, 12.6); c.bezierCurveTo(14, 7.6, 20, 6.4, 24, 6.3); OA_s(c, '#74c084', 1.5);
  c.beginPath(); c.ellipse(24, 14.4, 13.2, 3.3, 0, 0.25, Math.PI - 0.25); OA_s(c, '#2a6238', 1.1);
  OA_rr(c, 20.4, 2.4, 7.2, 4.2, 2); OA_fo(c, '#2a6238', 1.5);
}
function OA_trashStatic(c, withLid) {
  OA_shadow(c, 24, 44, 20, 4.6);
  // pooper-scooper leaning on the left
  OA_ln(c, 4.4, 4.5, 8, 40, OA_OUT, 4.2); OA_ln(c, 4.4, 4.5, 8, 40, OA_WL, 2.2);
  OA_rr(c, 2.4, 1, 4.6, 8, 2); OA_fo(c, '#d9574a', 1.4);
  OA_pl(c, [4.2, 38, 11.4, 37, 12.6, 44.4, 3.6, 45.4]); OA_fo(c, '#918b80', 1.5);
  c.strokeStyle = '#6f6a62'; c.lineWidth = 1; c.beginPath(); c.moveTo(6.2, 40); c.lineTo(6.6, 44.6); c.moveTo(8.6, 39.6); c.lineTo(9.2, 44.4); c.stroke();
  // bin body
  c.beginPath(); OA_trashBody(c); c.closePath(); OA_f(c, '#4a9c5c');
  c.save(); c.clip();
  c.fillStyle = '#37804a'; c.fillRect(29.5, 12, 9, 34);
  c.fillStyle = '#2f6e41'; c.fillRect(10, 39.6, 28, 6);
  c.fillStyle = '#7cc98a'; c.fillRect(13.4, 16, 2.6, 21);
  c.strokeStyle = '#2f6e41'; c.lineWidth = 1.1; c.beginPath();
  c.ellipse(24, 18.2, 13.4, 3.2, 0, 0.1, Math.PI - 0.1); c.moveTo(36, 37.4); c.ellipse(24, 37.4, 12, 3, 0, 0, Math.PI); c.stroke();
  c.restore();
  c.beginPath(); OA_trashBody(c); OA_s(c, OA_OUT, 1.8);
  // paw label
  OA_el(c, 23.4, 28.4, 7.2, 7.4); OA_fo(c, OA_CREAM, 1.4);
  OA_paw(c, 23.4, 28.6, 1.3, '#2f6e41');
  // pedal
  OA_rr(c, 19.4, 43.4, 9.2, 3, 1.2); OA_fo(c, '#918b80', 1.3);
  // bag dispenser on the right
  OA_rr(c, 35.4, 18, 10.4, 11.4, 2); OA_fo(c, '#f2c14e', 1.6);
  c.fillStyle = '#d7a236'; c.fillRect(42.2, 19, 2.6, 9.4);
  OA_rr(c, 37.2, 20.4, 5.4, 4.4, 1.6); OA_fo(c, '#a9d98a', 1.1);
  c.fillStyle = OA_OUT; c.fillRect(37, 27, 6.6, 1.3);
  OA_tuft(c, 14, 46.4, 0.7); OA_tuft(c, 34, 46.6, 0.75, '#5d9d49');
  OA_el(c, 24, 14.5, 13.6, 3.8); OA_fo(c, '#2f4a2c', 1.7);
  if (withLid) OA_trashLid(c);
}
OBJECT_ART.trash = {
  box: [0, -6, 48, 48],
  draw: function (c, o, t, env) {
    o = o || {}; env = env || OA_ENV0; t = OA_num(t, 0);
    var ph = OA_usePh(o), wl = Math.round(OA_cl(OA_num(env.wind, 0), -1, 1)), id = OA_num(o.id, 0);
    OA_begin(c, o);
    if (ph >= 0) OA_squash(c, ph, 24, 45, 0.07);
    OA_static(c, ph < 0 ? 'trash' : 'trashU', -1, -4, 50, 54, function (g) { OA_trashStatic(g, ph < 0); });
    // green bag tail fluttering from the dispenser (8-frame flip-book per wind strength)
    var f = ((Math.floor(t * 8 + id * 3) % 8) + 8) % 8;
    OA_static(c, 'ttail' + f + 'w' + wl, 33, 26, 16, 15, function (g) {
      var sw = Math.sin(f / 8 * OA_TAU) * 1.2 + wl * 2.2;
      g.beginPath(); g.moveTo(37.8, 28.2); g.lineTo(42.6, 28.2); g.quadraticCurveTo(43.4 + sw * 0.5, 33, 43 + sw, 38.4); g.lineTo(40.6 + sw, 36.8); g.lineTo(38.2 + sw, 38.8); g.quadraticCurveTo(38 + sw * 0.5, 33, 37.8, 28.2); g.closePath();
      OA_fo(g, '#a9d98a', 1.3);
      OA_ln(g, 40.2, 29.4, 40.4 + sw * 0.6, 35, '#86bd68', 1);
    });
    if (ph >= 0) {
      // lid hinged at the back, flips up when something is dropped in
      var open = Math.sin(Math.min(1, ph * 1.15) * Math.PI);
      c.translate(36.4, 13.4); c.rotate(open * 0.95); c.translate(-36.4, -13.4);
      OA_trashLid(c);
    }
    c.restore();
  }
};

// ---------------------------------------------------------------- bath tub (2x1)
function OA_tubFoot(c, x, y, col, dk) {
  c.beginPath(); c.moveTo(x - 4.6, y); c.quadraticCurveTo(x - 6.8, y + 6, x - 5.2, y + 9.6); c.quadraticCurveTo(x, y + 12.6, x + 5.2, y + 9.6); c.quadraticCurveTo(x + 6.4, y + 5, x + 4.2, y); c.closePath(); OA_fo(c, col, 1.6);
  c.strokeStyle = dk; c.lineWidth = 1; c.beginPath(); c.moveTo(x - 1.8, y + 8); c.lineTo(x - 1.8, y + 10.6); c.moveTo(x + 1.8, y + 8); c.lineTo(x + 1.8, y + 10.6); c.stroke();
}
function OA_tubBack(c) {
  OA_shadow(c, 44, 44, 44, 5.4);
  OA_tubFoot(c, 30, 29, '#b8862c', '#8c6420'); OA_tubFoot(c, 52, 29, '#b8862c', '#8c6420');
  // ---- stool with shampoo and brush
  c.strokeStyle = OA_OUT; c.lineWidth = 4.4; c.beginPath(); c.moveTo(84.4, 28); c.lineTo(83, 44); c.moveTo(92.6, 28); c.lineTo(94, 44); c.stroke();
  c.strokeStyle = OA_WM; c.lineWidth = 2.3; c.beginPath(); c.moveTo(84.4, 28); c.lineTo(83, 44); c.moveTo(92.6, 28); c.lineTo(94, 44); c.stroke();
  OA_ln(c, 83.8, 37.4, 93.2, 37.4, OA_OUT, 3.4); OA_ln(c, 83.8, 37.4, 93.2, 37.4, OA_WD, 1.5);
  OA_rr(c, 80.6, 25, 15.6, 5.6, 2.6); OA_fo(c, OA_WM, 1.6);
  OA_el(c, 88.4, 25.6, 7.8, 2.9); OA_fo(c, OA_WL, 1.5);
  // shampoo bottle
  OA_rr(c, 82.6, 10.4, 8.4, 15, 2.6); OA_fo(c, '#a58bd6', 1.6);
  c.fillStyle = '#8a70bd'; c.fillRect(88, 11.6, 2.2, 12.6);
  c.fillStyle = '#c7b4ea'; c.fillRect(83.8, 12.4, 1.3, 8);
  OA_rr(c, 83.8, 15, 5.6, 6.4, 1.6); OA_f(c, OA_CREAM);
  c.beginPath(); c.moveTo(86.6, 16); c.quadraticCurveTo(88.6, 19, 86.6, 20.2); c.quadraticCurveTo(84.6, 19, 86.6, 16); OA_f(c, '#66bde3');
  OA_rr(c, 85.3, 7.2, 3, 3.6, 0.8); OA_fo(c, OA_CREAM, 1.3);
  OA_rr(c, 83, 4.6, 7, 2.8, 1.2); OA_fo(c, OA_CREAM, 1.3);
  // scrubbing brush lying on the stool
  c.strokeStyle = '#f3e4c2'; c.lineWidth = 1.2; c.beginPath();
  for (var i = 0; i < 4; i++) { c.moveTo(90.6 + i * 1.5, 24.6); c.lineTo(90.4 + i * 1.6, 27.4); }
  c.stroke();
  OA_rr(c, 89.4, 22.4, 6.8, 3, 1.4); OA_fo(c, OA_WL, 1.3);
  // ---- back of the rim, inside wall and water
  OA_el(c, 41, 12, 38, 9.5); OA_fo(c, '#fffaf0', 1.8);
  OA_el(c, 41, 12.3, 33.5, 6.6); OA_fo(c, '#d3c7b3', 1.4);
  c.save(); OA_el(c, 41, 12.3, 33.5, 6.6); c.clip();
  OA_el(c, 41, 15.4, 33.5, 6.6); OA_f(c, '#8fd5ee');
  OA_el(c, 36, 17, 20, 3); OA_f(c, '#a9e1f4');
  c.restore();
  // ---- brass tap with a red wheel
  OA_el(c, 11, 9.2, 4, 1.8); OA_fo(c, '#b8862c', 1.4);
  c.beginPath(); c.moveTo(11, 9); c.lineTo(11, -6); c.quadraticCurveTo(11, -11.6, 16.6, -11.6); c.lineTo(18.6, -11.6); c.quadraticCurveTo(24, -11.6, 24, -6.4); c.lineTo(24, -4.6);
  OA_s(c, OA_OUT, 6.2); OA_s(c, '#d9a441', 3.4);
  c.beginPath(); c.moveTo(10.2, 7); c.lineTo(10.2, -6); c.quadraticCurveTo(10.4, -10.6, 16, -10.8); OA_s(c, '#f5d98a', 1);
  OA_rr(c, 21.4, -5.4, 5.2, 3, 1); OA_fo(c, '#b8862c', 1.4);
  OA_ln(c, 11, -1, 5.6, -1, OA_OUT, 4.4); OA_ln(c, 11, -1, 5.6, -1, '#d9a441', 2);
  OA_el(c, 4.6, -1, 3.3, 3.3); OA_fo(c, '#d9574a', 1.5);
  c.strokeStyle = '#b9443a'; c.lineWidth = 1; c.beginPath(); c.moveTo(2.4, -1); c.lineTo(6.8, -1); c.moveTo(4.6, -3.2); c.lineTo(4.6, 1.2); c.stroke();
  OA_el(c, 4.6, -1, 0.9, 0.9); OA_f(c, OA_CREAM);
}
function OA_tubBodyPath(c) {
  c.beginPath(); c.moveTo(3, 12); c.bezierCurveTo(3, 29, 10, 37, 22, 37); c.lineTo(60, 37); c.bezierCurveTo(72, 37, 79, 29, 79, 12);
  c.ellipse(41, 12, 38, 9.5, 0, 0, Math.PI); c.closePath();
}
function OA_tubFrontStatic(c) {
  OA_tubFoot(c, 15, 32.6, '#d9a441', '#a87624'); OA_tubFoot(c, 67, 32.6, '#d9a441', '#a87624');
  OA_tubBodyPath(c); OA_f(c, '#f7f0e4');
  c.save(); c.clip();
  c.beginPath(); c.moveTo(0, 27); c.quadraticCurveTo(41, 36, 82, 24); c.lineTo(82, 40); c.lineTo(0, 40); c.closePath(); OA_f(c, '#dcd0bd');
  c.beginPath(); c.moveTo(70, 12); c.quadraticCurveTo(72, 26, 62, 38); c.lineTo(82, 38); c.lineTo(82, 12); c.closePath(); OA_f(c, '#dcd0bd');
  c.beginPath(); c.moveTo(4, 22); c.quadraticCurveTo(41, 32.6, 78, 22); OA_s(c, '#3aa89a', 1.5);
  c.beginPath(); c.moveTo(7.6, 19); c.quadraticCurveTo(8.4, 26, 12.6, 30.4); OA_s(c, '#ffffff', 2);
  c.restore();
  OA_tubBodyPath(c); OA_s(c, OA_OUT, 1.8);
  // rolled rim, front half
  c.beginPath(); c.ellipse(41, 12, 38, 9.5, 0, 0, Math.PI); c.ellipse(41, 12.3, 33.5, 6.6, 0, Math.PI, 0, true); c.closePath(); OA_f(c, '#fffaf0');
  c.beginPath(); c.ellipse(41, 12, 38, 9.5, 0, 0, Math.PI); OA_s(c, OA_OUT, 1.8);
  c.beginPath(); c.ellipse(41, 12.3, 33.5, 6.6, 0, 0, Math.PI); OA_s(c, OA_OUT, 1.4);
  c.beginPath(); c.ellipse(41, 12.2, 35.8, 8.1, 0, 1.75, 2.9); OA_s(c, '#ffffff', 1.3);
  // towel over the rim
  c.beginPath(); c.moveTo(52.4, 17.6); c.quadraticCurveTo(60, 16.4, 67.6, 14.8); c.lineTo(69, 31.6); c.quadraticCurveTo(65, 33.6, 61, 31.8); c.quadraticCurveTo(57, 30.2, 53.4, 32.6); c.closePath(); OA_fo(c, '#f2a0b5', 1.6);
  c.strokeStyle = OA_CREAM; c.lineWidth = 1.6; c.beginPath(); c.moveTo(53.4, 26.6); c.quadraticCurveTo(57.2, 24.6, 61, 26); c.quadraticCurveTo(65, 27.6, 68.4, 25.8); c.stroke();
  c.strokeStyle = '#d97f97'; c.lineWidth = 1; c.beginPath(); c.moveTo(57.6, 18.6); c.lineTo(57.8, 23.4); c.moveTo(63.4, 17.6); c.lineTo(63.8, 24); c.stroke();
  c.strokeStyle = OA_OUT; c.lineWidth = 1; c.beginPath(); c.moveTo(55.4, 32.4); c.lineTo(55.2, 34.4); c.moveTo(59, 31.6); c.lineTo(59, 33.8); c.moveTo(63, 32.8); c.lineTo(63.2, 35); c.moveTo(66.8, 32.6); c.lineTo(67.2, 34.6); c.stroke();
  OA_tuft(c, 5, 46, 0.7); OA_tuft(c, 76, 46.4, 0.7, '#5d9d49');
}
function OA_tubFrontAnim(c, o, t) {
  var id = OA_num(o.id, 0), i, ph = OA_usePh(o);
  if (o.occupied) {
    // heaps of suds on the front rim and bubbles drifting up
    for (i = 0; i < 5; i++) {
      var sx = 12 + i * 10.5 + (i > 3 ? 17 : 0), ry = 12 + 8.2 * Math.sqrt(Math.max(0, 1 - Math.pow((sx - 41) / 38, 2)));
      OA_sSuds(c, sx, ry - 1.6 + Math.sin(t * 2.4 + i * 1.7) * 0.5, i);
    }
    for (i = 0; i < 4; i++) {
      var bp = ((t * 0.32 + i * 0.26 + OA_h(id + i)) % 1 + 1) % 1;
      OA_sBubble(c, 18 + OA_h(i * 3.3 + 1) * 46 + Math.sin(t * 1.7 + i * 2) * 2.5, 8 - bp * 26, i % 2, bp < 0.85 ? Math.min(1, bp * 6) * 0.9 : (1 - bp) * 6);
    }
  }
  OA_splash(c, 41, 8, ph, 7, 30, 20, id + 3);
}
OBJECT_ART.tub = {
  anchor: { headX: 41, headY: 6, headR: 13 },
  box: [-1, -16, 97, 48],
  draw: function (c, o, t, env) {
    o = o || {}; t = OA_num(t, 0);
    var ph = OA_usePh(o), id = OA_num(o.id, 0), occ = !!o.occupied;
    OA_begin(c, o);
    OA_squash(c, ph, 41, 45, 0.05);
    OA_static(c, 'tubB', -2, -17, 100, 68, OA_tubBack);
    // drip from the tap
    var dp = ((t * 0.7 + OA_h(id)) % 1 + 1) % 1;
    if (dp < 0.45) {
      var dy = -3 + 17 * (dp / 0.45) * (dp / 0.45);
      OA_sprite(c, 'drip', 24, dy, -3, -4, 6, 7, function (g) { g.beginPath(); g.moveTo(0, -2.6); g.quadraticCurveTo(2, 0.6, 0, 1.4); g.quadraticCurveTo(-2, 0.6, 0, -2.6); OA_f(g, '#bfe9f7'); OA_s(g, '#3f8fc4', 0.8); });
    } else if (dp < 0.9) OA_sRipple(c, 24, 15, (dp - 0.45) / 0.45, false);
    if (!occ) {
      OA_sSuds(c, 26, 14.2 + Math.sin(t * 1.6) * 0.4, 0);
      OA_sDuck(c, 44 + Math.sin(t * 0.9 + id) * 2.5, 15.4 + Math.sin(t * 2.2 + id) * 0.6, Math.cos(t * 0.9 + id) > 0 ? 1 : -1);
    } else {
      OA_sSuds(c, 20, 11.5 + Math.sin(t * 2) * 0.4, 1); OA_sSuds(c, 62, 10.5 + Math.cos(t * 2.2) * 0.4, 2);
    }
    OA_static(c, 'tubF', -2, 10, 86, 40, OA_tubFrontStatic);
    if (!occ) OA_tubFrontAnim(c, o, t);
    c.restore();
  },
  // front wall, rim and suds again, over the bather
  drawFront: function (c, o, t, env) {
    o = o || {}; t = OA_num(t, 0);
    OA_begin(c, o);
    OA_squash(c, OA_usePh(o), 41, 45, 0.05);
    OA_static(c, 'tubF', -2, 10, 86, 40, OA_tubFrontStatic);
    OA_tubFrontAnim(c, o, t);
    c.restore();
  }
};

// ---------------------------------------------------------------- treat jar (1x1)
function OA_jarPath(c) {
  c.beginPath(); c.moveTo(16, 6.6); c.bezierCurveTo(8.6, 9.6, 8, 20, 9, 27); c.quadraticCurveTo(9.6, 33.6, 14, 33.8); c.lineTo(34, 33.8);
  c.quadraticCurveTo(38.4, 33.6, 39, 27); c.bezierCurveTo(40, 20, 39.4, 9.6, 32, 6.6); c.closePath();
}
function OA_treatLid(c) {
  OA_el(c, 0, -7.6, 3, 2.7); OA_fo(c, '#f2c14e', 1.5);
  OA_el(c, -0.9, -8.4, 0.9, 0.7); OA_f(c, '#fbe7a6');
  OA_rr(c, -10.6, -5.6, 21.2, 6.6, 2.8); OA_fo(c, '#d9574a', 1.7);
  c.fillStyle = '#b9443a'; c.fillRect(-8.6, -1.5, 17.2, 1.5);
  c.fillStyle = '#f08f7f'; c.fillRect(-7.6, -4.1, 8, 1.2);
}
function OA_treatjarStatic(c, withLid) {
  var i;
  OA_shadow(c, 24, 44.6, 18, 4.2);
  // little round stool
  c.strokeStyle = OA_OUT; c.lineWidth = 4.6; c.beginPath(); c.moveTo(13, 37); c.lineTo(10.6, 44.4); c.moveTo(35, 37); c.lineTo(37.4, 44.4); c.moveTo(24, 38); c.lineTo(24, 45.4); c.stroke();
  c.strokeStyle = OA_WD; c.lineWidth = 2.5; c.beginPath(); c.moveTo(13, 37); c.lineTo(10.6, 44.4); c.moveTo(35, 37); c.lineTo(37.4, 44.4); c.moveTo(24, 38); c.lineTo(24, 45.4); c.stroke();
  OA_rr(c, 7.4, 33.6, 33.2, 6.6, 3.2); OA_fo(c, OA_WM, 1.7);
  OA_el(c, 24, 34.4, 16.6, 4); OA_fo(c, OA_WL, 1.6);
  c.beginPath(); c.ellipse(24, 34.4, 13.4, 2.5, 0, 2.4, 4.2); OA_s(c, OA_WH, 1.1);
  // gingham doily
  OA_el(c, 24, 34.2, 12.6, 2.7); OA_fo(c, OA_CREAM, 1.1);
  c.strokeStyle = '#e98f86'; c.lineWidth = 0.9; c.beginPath(); for (i = 0; i < 6; i++) { c.moveTo(14.5 + i * 3.8, 32.6); c.lineTo(14.2 + i * 3.9, 35.9); } c.stroke();
  // jar: back glass, biscuits, front glass
  OA_jarPath(c); OA_f(c, 'rgba(208,234,238,0.78)');
  c.save(); OA_jarPath(c); c.clip();
  c.fillStyle = 'rgba(168,116,63,0.35)'; c.fillRect(6, 26, 36, 9);
  c.fillStyle = 'rgba(122,78,42,0.4)'; c.fillRect(6, 12, 36, 23);
  var B = [[29.4, 14.6, -0.3], [19.4, 15.6, 0.4], [34.2, 22.2, 1.05], [13.8, 22.4, 1.2], [24, 23, -0.55], [29.8, 29.8, -0.12], [16.8, 30.2, 0.12]];
  for (i = 0; i < B.length; i++) {
    OA_bone(c, B[i][0], B[i][1], 11.6, 3.5, B[i][2], i % 2 ? '#d9a962' : '#f0cf94', 1.15, '#6d4424');
    OA_el(c, B[i][0] - Math.cos(B[i][2]) * 1.4, B[i][1] - Math.sin(B[i][2]) * 1.4, 0.55, 0.55); OA_f(c, '#8a5a2c');
    OA_el(c, B[i][0] + Math.cos(B[i][2]) * 1.4, B[i][1] + Math.sin(B[i][2]) * 1.4, 0.55, 0.55); OA_f(c, '#8a5a2c');
  }
  c.fillStyle = 'rgba(190,228,236,0.22)'; c.fillRect(6, 4, 36, 32);
  c.fillStyle = 'rgba(120,170,190,0.28)'; c.fillRect(34.4, 6, 6, 28);
  c.restore();
  OA_jarPath(c); OA_s(c, OA_OUT, 1.8);
  c.beginPath(); c.moveTo(13.4, 11.6); c.quadraticCurveTo(10.6, 17, 11.6, 26); OA_s(c, 'rgba(255,255,255,0.9)', 2);
  c.beginPath(); c.moveTo(12.6, 29.4); c.lineTo(13, 30.4); OA_s(c, 'rgba(255,255,255,0.9)', 2);
  c.beginPath(); c.moveTo(35.8, 13); c.quadraticCurveTo(37, 17, 36.6, 21); OA_s(c, 'rgba(255,255,255,0.55)', 1.2);
  // glass neck ring + twine + tag
  OA_rr(c, 14.4, 3.4, 19.2, 4.6, 2.2); OA_fo(c, '#cfe9ee', 1.6);
  OA_ln(c, 15.4, 8.6, 32.6, 8.6, '#b9814a', 1.5);
  c.save(); c.translate(30.6, 9); c.rotate(0.32);
  OA_ln(c, 0, 0, 0.4, 3.4, '#b9814a', 1.1);
  OA_pl(c, [-3.6, 4.6, -1.6, 2.6, 2.4, 2.6, 4.4, 4.6, 4.4, 11.6, -3.6, 11.6]); OA_fo(c, OA_CREAM, 1.3);
  c.beginPath(); c.moveTo(0.4, 10); c.bezierCurveTo(-3.4, 7.6, -1.2, 5, 0.4, 6.8); c.bezierCurveTo(2, 5, 4.2, 7.6, 0.4, 10); OA_f(c, '#d9574a');
  c.restore();
  OA_tuft(c, 6, 46.4, 0.7); OA_tuft(c, 42, 46.6, 0.7, '#5d9d49');
  if (withLid) { c.save(); c.translate(24, 3.4); OA_treatLid(c); c.restore(); }
}
OBJECT_ART.treatjar = {
  box: [2, -9, 46, 48],
  draw: function (c, o, t, env) {
    o = o || {}; t = OA_num(t, 0);
    var ph = OA_usePh(o), id = OA_num(o.id, 0), hop = ph >= 0 ? Math.sin(Math.min(1, ph * 1.2) * Math.PI) : 0;
    OA_begin(c, o);
    if (ph >= 0) OA_squash(c, ph, 24, 45, 0.07);
    OA_static(c, ph < 0 ? 'treatjar' : 'treatjarU', 0, -14, 48, 64, function (g) { OA_treatjarStatic(g, ph < 0); });
    if (ph >= 0) {
      // the lid pops up and a biscuit hops out
      if (hop > 0.05) OA_bone(c, 24, 3 - hop * 11, 10.4, 3.3, ph * 7, '#e3b877', 1.2);
      c.save(); c.translate(24, 3.4 - hop * 9); c.rotate(hop * 0.5); c.translate(hop * 7, 0); OA_treatLid(c); c.restore();
    }
    // twinkle on the glass
    var tw = ((t * 0.35 + OA_h(id) * 3) % 1 + 1) % 1;
    if (tw < 0.25) OA_sparkle(c, 13.6, 14 + tw * 20, 3.4, Math.sin(tw / 0.25 * Math.PI));
    c.restore();
  }
};

// ---------------------------------------------------------------- water station (1x1)
function OA_bottlePath(c) {
  c.beginPath(); c.moveTo(20.4, 17); c.lineTo(20.4, 13.4); c.quadraticCurveTo(12.6, 11.4, 12.6, 5); c.lineTo(12.6, -5);
  c.quadraticCurveTo(12.6, -12.4, 20, -12.4); c.lineTo(28, -12.4); c.quadraticCurveTo(35.4, -12.4, 35.4, -5); c.lineTo(35.4, 5);
  c.quadraticCurveTo(35.4, 11.4, 27.6, 13.4); c.lineTo(27.6, 17); c.closePath();
}
function OA_waterStatic(c) {
  OA_shadow(c, 24, 44.6, 23, 4.6);
  // tower behind the bowl
  OA_rr(c, 14.6, 15, 18.8, 20, 3); OA_fo(c, '#2f8a7f', 1.7);
  c.fillStyle = '#256f66'; c.fillRect(28.4, 16, 4, 16);
  OA_rr(c, 13.4, 13.6, 21.2, 5, 2.2); OA_fo(c, '#3aa89a', 1.6);
  // upturned bottle
  OA_bottlePath(c); OA_f(c, 'rgba(196,232,244,0.85)');
  c.save(); OA_bottlePath(c); c.clip();
  c.fillStyle = '#8fd5ee'; c.fillRect(10, -6.4, 28, 26);
  c.fillStyle = '#6fc3e3'; c.fillRect(30.6, -6.4, 6, 26);
  c.fillStyle = '#c9edf8'; c.fillRect(10, -6.4, 28, 1.3);
  c.restore();
  OA_bottlePath(c); OA_s(c, OA_OUT, 1.8);
  c.strokeStyle = 'rgba(63,143,196,0.55)'; c.lineWidth = 1; c.beginPath(); c.moveTo(13.6, -1.6); c.lineTo(34.4, -1.6); c.moveTo(13.6, 3.6); c.lineTo(34.4, 3.6); c.stroke();
  c.beginPath(); c.moveTo(16, -8.4); c.lineTo(16, 5.4); OA_s(c, 'rgba(255,255,255,0.9)', 2);
  c.beginPath(); c.moveTo(19.4, -9.4); c.lineTo(19.4, -7.4); OA_s(c, 'rgba(255,255,255,0.9)', 1.4);
  // paw sticker
  OA_el(c, 26.4, 8.4, 3.6, 3.4); OA_f(c, 'rgba(251,241,216,0.92)'); OA_paw(c, 26.4, 8.6, 0.62, '#3f8fc4');
  // bowl
  c.beginPath(); c.moveTo(3.4, 33); c.quadraticCurveTo(3.6, 45.2, 12, 45.2); c.lineTo(36, 45.2); c.quadraticCurveTo(44.4, 45.2, 44.6, 33); c.closePath(); OA_f(c, '#3aa89a');
  c.save(); c.clip();
  c.fillStyle = '#2f8a7f'; c.fillRect(2, 41.6, 44, 5); c.fillRect(36, 30, 10, 16);
  c.fillStyle = '#63c3b5'; c.fillRect(6.2, 37, 2, 5);
  c.restore();
  c.beginPath(); c.moveTo(3.4, 33); c.quadraticCurveTo(3.6, 45.2, 12, 45.2); c.lineTo(36, 45.2); c.quadraticCurveTo(44.4, 45.2, 44.6, 33); OA_s(c, OA_OUT, 1.8);
  OA_el(c, 24, 33, 20.6, 6.4); OA_fo(c, '#5cc0b2', 1.8);
  OA_el(c, 24, 33.3, 17, 4.6); OA_fo(c, '#4aa0cd', 1.3);
  c.save(); OA_el(c, 24, 33.3, 17, 4.6); c.clip(); OA_el(c, 24, 35.2, 17, 4.6); OA_f(c, '#8fd5ee'); OA_el(c, 20, 36, 9, 1.6); OA_f(c, '#b4e6f5'); c.restore();
  c.beginPath(); c.ellipse(24, 33, 19, 5.4, 0, 2.2, 3.6); OA_s(c, '#9addd0', 1.2);
  // drop emblem
  c.beginPath(); c.moveTo(24, 39.4); c.quadraticCurveTo(26.8, 43, 24, 44); c.quadraticCurveTo(21.2, 43, 24, 39.4); OA_f(c, OA_CREAM);
  OA_tuft(c, 3, 46.6, 0.7); OA_tuft(c, 44.6, 46.8, 0.7, '#5d9d49');
}
OBJECT_ART.waterbowl = {
  box: [0, -15, 48, 48],
  draw: function (c, o, t, env) {
    o = o || {}; t = OA_num(t, 0);
    var ph = OA_usePh(o), id = OA_num(o.id, 0), i;
    OA_begin(c, o);
    OA_squash(c, ph, 24, 45, 0.07);
    OA_static(c, 'water', -1, -15, 50, 64, OA_waterStatic);
    // glug-glug bubbles in the bottle
    for (i = 0; i < 3; i++) {
      var bp = ((t * 0.45 + i * 0.37 + OA_h(id + i)) % 1 + 1) % 1;
      OA_sBubble(c, 22 + i * 2.6 + Math.sin(t * 3 + i * 2) * 1.2, 11 - bp * 16, 0, bp > 0.85 ? (1 - bp) * 6 : 0.95);
    }
    // ripples in the bowl
    for (i = 0; i < 2; i++) OA_sRipple(c, 24 + (i ? 5 : -4), 35.5, ((t * 0.5 + i * 0.5 + OA_h(id)) % 1 + 1) % 1, false);
    OA_splash(c, 24, 33, ph, 6, 16, 15, id + 1);
    c.restore();
  }
};

// ---------------------------------------------------------------- auto-feeder (1x1)
function OA_domePath(c) { c.beginPath(); c.arc(24, 1.6, 13.2, Math.PI - 0.93, 0.93); c.closePath(); }
function OA_feederStatic(c) {
  OA_shadow(c, 24, 45, 19, 4.4);
  // glass hopper full of kibble
  OA_domePath(c); OA_f(c, 'rgba(214,236,240,0.8)');
  c.save(); OA_domePath(c); c.clip();
  c.beginPath(); c.moveTo(8, 14); c.lineTo(8, 1); c.quadraticCurveTo(17, -4.6, 25, -1.6); c.quadraticCurveTo(33, 1, 40, -2); c.lineTo(40, 14); c.closePath(); OA_f(c, '#a7713d');
  OA_kibble(c, 24, 13.4, 14, 16.5, 7, 40);
  c.fillStyle = 'rgba(120,170,190,0.25)'; c.fillRect(32, -12, 8, 26);
  c.restore();
  OA_domePath(c); OA_s(c, OA_OUT, 1.8);
  c.beginPath(); c.arc(24, 1.6, 10.4, 3.35, 4.25); OA_s(c, 'rgba(255,255,255,0.9)', 2);
  c.beginPath(); c.arc(24, 1.6, 10.4, 4.5, 4.65); OA_s(c, 'rgba(255,255,255,0.9)', 2);
  // cap
  OA_rr(c, 18.4, -14.6, 11.2, 4.4, 2); OA_fo(c, '#d9574a', 1.6);
  OA_el(c, 24, -15.4, 2.2, 1.8); OA_fo(c, '#f2c14e', 1.3);
  // body
  OA_rr(c, 8.6, 14.6, 30.8, 27.4, 5.4); OA_fo(c, OA_CREAM, 1.8);
  c.save(); OA_rr(c, 8.6, 14.6, 30.8, 27.4, 5.4); c.clip();
  c.fillStyle = '#e6d6b2'; c.fillRect(33.4, 14, 7, 29);
  c.fillStyle = '#d9574a'; c.fillRect(8, 36.6, 32, 6);
  c.fillStyle = '#b9443a'; c.fillRect(33.4, 36.6, 7, 6); c.fillRect(8, 40.8, 32, 2);
  c.fillStyle = OA_OUT; c.fillRect(8, 36, 32, 1.1);
  c.restore();
  OA_rr(c, 8.6, 14.6, 30.8, 27.4, 5.4); OA_s(c, OA_OUT, 1.8);
  OA_rr(c, 9.6, 11.6, 28.8, 5.6, 2.6); OA_fo(c, '#d9574a', 1.7);
  c.fillStyle = '#f08f7f'; c.fillRect(12, 13, 11, 1.2);
  // dial
  OA_el(c, 17.4, 25.4, 5.4, 5.4); OA_fo(c, '#ffffff', 1.5);
  c.strokeStyle = '#918b80'; c.lineWidth = 0.9; c.beginPath();
  for (var i = 0; i < 8; i++) { var a = i * Math.PI / 4; c.moveTo(17.4 + Math.cos(a) * 3.5, 25.4 + Math.sin(a) * 3.5); c.lineTo(17.4 + Math.cos(a) * 4.5, 25.4 + Math.sin(a) * 4.5); }
  c.stroke();
  OA_el(c, 17.4, 25.4, 1, 1); OA_f(c, OA_OUT);
  // knob, speaker slots, rivets
  OA_el(c, 31, 27.6, 3.5, 3.5); OA_fo(c, '#f2c14e', 1.5); OA_ln(c, 31, 27.6, 31, 24.9, OA_OUT, 1.3);
  c.strokeStyle = '#c9b68c'; c.lineWidth = 1.1; c.beginPath(); c.moveTo(26, 21); c.lineTo(29, 21); c.stroke();
  c.fillStyle = '#c9b68c'; c.fillRect(10.9, 18.4, 1.4, 1.4); c.fillRect(35.6, 18.4, 1.4, 1.4);
  // chute
  OA_rr(c, 17.4, 32.4, 13.2, 7, 2.4); OA_fo(c, '#4a3022', 1.5);
  OA_ln(c, 18.6, 34, 29.4, 34, '#918b80', 1.2);
  OA_el(c, 31, 20.4, 1.9, 1.9); OA_fo(c, '#2f6e41', 1.1);
  // little feet
  OA_rr(c, 10, 41.6, 5, 3.4, 1.2); OA_fo(c, '#5a524b', 1.3); OA_rr(c, 33, 41.6, 5, 3.4, 1.2); OA_fo(c, '#5a524b', 1.3);
  // bowl with kibble
  OA_el(c, 24, 40.4, 12.6, 2.6); OA_fo(c, '#c99a2e', 1.6);
  c.beginPath(); c.moveTo(13.6, 40.6); c.bezierCurveTo(15, 36.8, 33, 36.8, 34.4, 40.6); c.ellipse(24, 40.6, 10.4, 2, 0, 0, Math.PI); c.closePath(); OA_fo(c, '#a7713d', 1.3);
  OA_kibble(c, 24, 41, 9, 3.4, 11, 10);
  c.beginPath(); c.moveTo(11.4, 40.4); c.quadraticCurveTo(12.6, 46.8, 16.4, 46.8); c.lineTo(31.6, 46.8); c.quadraticCurveTo(35.4, 46.8, 36.6, 40.4); c.ellipse(24, 40.4, 12.6, 2.6, 0, 0, Math.PI); c.closePath(); OA_fo(c, '#f2c14e', 1.7);
  c.fillStyle = '#d7a236'; c.fillRect(15, 45, 18, 1.3);
  OA_bonePath(c, 24, 43.6, 7.4, 1.8, 0); OA_f(c, OA_CREAM);
  OA_tuft(c, 5, 46.6, 0.7); OA_tuft(c, 43.4, 46.8, 0.7, '#5d9d49');
}
OBJECT_ART.autofeeder = {
  box: [2, -18, 46, 48],
  draw: function (c, o, t, env) {
    o = o || {}; env = env || OA_ENV0; t = OA_num(t, 0);
    var ph = OA_usePh(o), id = OA_num(o.id, 0), night = OA_cl(OA_num(env.night, 0), 0, 1), i;
    OA_begin(c, o);
    OA_squash(c, ph, 24, 46, 0.08);
    OA_static(c, 'feeder', 0, -19, 48, 68, OA_feederStatic);
    // timer hand (ticks round once every few seconds)
    var a = Math.floor(t * 2 + id) * 0.5236;
    OA_ln(c, 17.4, 25.4, 17.4 + Math.cos(a) * 3.6, 25.4 + Math.sin(a) * 3.6, '#d9574a', 1.4);
    // status light
    var on = Math.sin(t * 3.2 + id) > -0.2;
    if (night > 0.05 && on) { OA_el(c, 31, 20.4, 5.5, 5.5); OA_f(c, 'rgba(140,240,130,' + (0.3 * night).toFixed(3) + ')'); }
    if (on) { OA_el(c, 31, 20.4, 1.3, 1.3); OA_f(c, '#8cf07a'); }
    // kibble rattling out of the chute
    if (ph >= 0) for (i = 0; i < 4; i++) {
      var kp = OA_cl(ph * 1.6 - i * 0.15, 0, 1);
      if (kp > 0 && kp < 1) { OA_el(c, 21 + i * 2, 35 + kp * kp * 6, 1.6, 1.3, kp * 6 + i); OA_fo(c, i % 2 ? '#b9814a' : '#d3a066', 0.9); }
    }
    c.restore();
  },
  light: function (o, env) {
    var T = OA_tile(), k = T / 48; o = o || {};
    return { x: OA_num(o.x, 0) * T + 31 * k, y: OA_num(o.y, 0) * T + 20.4 * k, r: 14 * k, color: '#8cf082' };
  }
};

// =====================================================================================================
//  FLOOR PIECES (flat: dogs and people walk on top of them)
// =====================================================================================================

// small traffic cone; (x, y) = middle of its base
function OA_cone(c, x, y, s) {
  c.save(); c.translate(x, y); c.scale(s, s);
  OA_el(c, 1, 0.6, 8, 2.6); OA_f(c, OA_SH);
  OA_rr(c, -6.6, -2.8, 13.2, 5, 1.6); OA_fo(c, '#d9702e', 1.5);
  c.beginPath(); c.moveTo(-4.6, -1.4); c.lineTo(-1.4, -13.6); c.quadraticCurveTo(0, -15.2, 1.4, -13.6); c.lineTo(4.6, -1.4); c.quadraticCurveTo(0, 0.6, -4.6, -1.4); c.closePath(); OA_fo(c, '#f08a3c', 1.5);
  OA_pl(c, [-3.5, -5.6, 3.5, -5.6, 2.6, -9, -2.6, -9]); OA_f(c, OA_CREAM);
  OA_pl(c, [0.8, -13.4, 1.5, -13, 4, -1.9, 2, -1.2]); OA_f(c, 'rgba(140,60,20,0.32)');
  c.restore();
}

// ---------------------------------------------------------------- play zone (3x3)
function OA_playStatic(c) {
  var A = '#62bcae', B = '#f1cd88', i, j, k, x, y, col, TW = 46, TH = 44, X0 = 3, Y0 = 4;
  OA_rr(c, 2, 8, 140, 134, 10); OA_f(c, 'rgba(40,26,12,0.16)');
  OA_rr(c, 3, 8, 138, 132, 9); OA_fo(c, '#2f776d', 1.8);
  OA_rr(c, 3, 4, 138, 132, 9); OA_f(c, A);
  c.save(); OA_rr(c, 3, 4, 138, 132, 9); c.clip();
  for (j = 0; j < 3; j++) for (i = 0; i < 3; i++) if ((i + j) % 2) { c.fillStyle = B; c.fillRect(X0 + i * TW, Y0 + j * TH, TW, TH); }
  // grippy dots
  for (j = 0; j < 3; j++) for (i = 0; i < 3; i++) {
    c.fillStyle = (i + j) % 2 ? 'rgba(200,150,60,0.3)' : 'rgba(30,90,85,0.22)';
    for (k = 0; k < 16; k++) { c.fillRect(X0 + i * TW + 7.5 + (k % 4) * 10.2, Y0 + j * TH + 7 + Math.floor(k / 4) * 9.8, 1.5, 1.5); }
  }
  // seams
  c.strokeStyle = 'rgba(59,42,32,0.42)'; c.lineWidth = 1.1; c.beginPath();
  for (i = 1; i < 3; i++) { c.moveTo(X0 + i * TW, Y0); c.lineTo(X0 + i * TW, Y0 + 3 * TH); c.moveTo(X0, Y0 + i * TH); c.lineTo(X0 + 3 * TW, Y0 + i * TH); }
  c.stroke();
  // jigsaw knobs
  for (j = 0; j < 3; j++) for (i = 1; i < 3; i++) for (k = 0; k < 2; k++) {
    var dir = k ? -1 : 1; x = X0 + i * TW + dir * 2.2; y = Y0 + j * TH + (k ? 30 : 14);
    col = ((i - (dir > 0 ? 1 : 0) + j) % 2) ? B : A;
    OA_el(c, x, y, 3.5, 3.5); OA_f(c, col);
    c.beginPath(); if (dir > 0) c.arc(x, y, 3.5, -2.25, 2.25); else c.arc(x, y, 3.5, Math.PI - 2.25, Math.PI + 2.25); OA_s(c, 'rgba(59,42,32,0.42)', 1.1);
  }
  for (j = 1; j < 3; j++) for (i = 0; i < 3; i++) for (k = 0; k < 2; k++) {
    var dr = k ? -1 : 1; x = X0 + i * TW + (k ? 31 : 15); y = Y0 + j * TH + dr * 2.2;
    col = ((i + j - (dr > 0 ? 1 : 0)) % 2) ? B : A;
    OA_el(c, x, y, 3.5, 3.5); OA_f(c, col);
    c.beginPath(); if (dr > 0) c.arc(x, y, 3.5, Math.PI / 2 - 2.25, Math.PI / 2 + 2.25); else c.arc(x, y, 3.5, -Math.PI / 2 - 2.25, -Math.PI / 2 + 2.25); OA_s(c, 'rgba(59,42,32,0.42)', 1.1);
  }
  // big painted paw in the middle
  OA_paw(c, 72, 70, 4.2, 'rgba(255,255,255,0.42)', -0.2);
  // soft light from the top-left
  c.strokeStyle = 'rgba(255,255,255,0.45)'; c.lineWidth = 1.6; c.beginPath(); c.moveTo(6, 120); c.lineTo(6, 12); c.quadraticCurveTo(6, 7, 11, 7); c.lineTo(126, 7); c.stroke();
  c.restore();
  OA_rr(c, 3, 4, 138, 132, 9); OA_s(c, OA_OUT, 1.8);

  // ---- low A-frame ramp (top right): up one side, down the other
  OA_el(c, 110, 49, 28, 4.4); OA_f(c, OA_SH);
  OA_pl(c, [82, 48, 107, 38, 132, 48]); OA_fo(c, OA_WD, 1.7);
  OA_pl(c, [82, 21, 107, 11, 107, 38, 82, 48]); OA_fo(c, OA_WL, 1.8);
  OA_pl(c, [107, 11, 132, 21, 132, 48, 107, 38]); OA_fo(c, OA_WM, 1.8);
  c.strokeStyle = OA_WM; c.lineWidth = 1; c.beginPath(); c.moveTo(82, 30); c.lineTo(107, 20); c.moveTo(82, 39); c.lineTo(107, 29); c.stroke();
  c.strokeStyle = OA_WD; c.beginPath(); c.moveTo(107, 20); c.lineTo(132, 30); c.moveTo(107, 29); c.lineTo(132, 39); c.stroke();
  for (i = 0; i < 2; i++) {
    x = 89 + i * 8.6; y = 21 - (x - 82) * 0.4; OA_pl(c, [x, y, x + 2.6, y - 1.04, x + 2.6, y + 25.96, x, y + 27]); OA_f(c, OA_WH); OA_s(c, OA_WD, 0.9);
    x = 113.6 + i * 8.6; y = 11 + (x - 107) * 0.4; OA_pl(c, [x, y, x + 2.6, y + 1.04, x + 2.6, y + 28.04, x, y + 27]); OA_f(c, '#be8b53'); OA_s(c, OA_WD, 0.9);
  }
  OA_ln(c, 107, 11, 107, 38, OA_OUT, 4.6); OA_ln(c, 107, 11.4, 107, 37.6, '#f2c14e', 2.4);
  OA_paw(c, 107, 44.6, 0.7, 'rgba(251,241,216,0.8)');

  // ---- tyre lying flat (bottom left)
  OA_el(c, 38, 112, 27, 17); OA_f(c, OA_SH);
  OA_el(c, 37, 107.6, 25, 17); OA_fo(c, '#3b3633', 1.8);
  c.strokeStyle = '#211d1b'; c.lineWidth = 1.2; c.beginPath();
  for (i = 0; i < 11; i++) { var a = 0.25 + i * 0.265; x = 37 + Math.cos(a) * 25; y = 102 + Math.sin(a) * 17; c.moveTo(x, y + 0.6); c.lineTo(x, y + 5.4); }
  c.stroke();
  OA_el(c, 37, 102, 25, 17); OA_fo(c, '#5a544f', 1.8);
  c.beginPath(); c.ellipse(37, 102, 21, 13.6, 0, 2.9, 4.6); OA_s(c, '#8a837b', 1.6);
  c.beginPath(); c.ellipse(37, 102, 18, 11.4, 0, 0.2, 1.5); OA_s(c, '#46413d', 1.4);
  OA_el(c, 37, 101.4, 12.6, 8); OA_fo(c, '#2b2624', 1.6);
  c.save(); OA_el(c, 37, 101.4, 12.6, 8); c.clip(); OA_el(c, 37, 105.6, 12.6, 7); OA_f(c, A); OA_el(c, 33, 107, 4, 2); OA_f(c, 'rgba(255,255,255,0.2)'); c.restore();

  // ---- cones, rope tug, chew bone, frisbee
  OA_cone(c, 101, 86, 0.95); OA_cone(c, 122, 104, 0.95); OA_cone(c, 100, 124, 0.95);
  OA_el(c, 25, 34.6, 12, 3); OA_f(c, OA_SH);
  c.beginPath(); c.moveTo(13, 37); c.quadraticCurveTo(24, 25, 36, 28.6); OA_s(c, OA_OUT, 6); OA_s(c, '#f3e4c2', 3.4);
  c.strokeStyle = '#d9574a'; c.lineWidth = 1.2; c.beginPath(); for (i = 0; i < 5; i++) { x = 17.4 + i * 3.7; y = 33 - i * 1.5 + (i > 2 ? (i - 2) * 1.1 : 0); c.moveTo(x - 0.6, y - 2); c.lineTo(x + 1.2, y + 1.6); } c.stroke();
  OA_el(c, 13, 37.2, 3.5, 3.3); OA_fo(c, '#f3e4c2', 1.5); OA_el(c, 36.4, 28.8, 3.5, 3.3); OA_fo(c, '#f3e4c2', 1.5);
  OA_ln(c, 11.6, 36, 14.4, 38.4, '#d9574a', 1.1); OA_ln(c, 35, 27.8, 37.8, 30, '#d9574a', 1.1);
  OA_el(c, 72, 126.4, 9, 2.4); OA_f(c, OA_SH);
  OA_bone(c, 71, 123.4, 17, 4.6, 0.25, '#66bde3', 1.5);
  OA_bonePath(c, 71.6, 124.4, 14, 2, 0.25); OA_f(c, 'rgba(40,110,160,0.28)');
  OA_el(c, 113, 62.6, 9.4, 4); OA_f(c, OA_SH);
  OA_el(c, 112, 60.4, 9, 4.6); OA_fo(c, '#f2a0b5', 1.6);
  OA_el(c, 112, 60, 5.6, 2.6); OA_s(c, '#d47a93', 1.1);
  c.beginPath(); c.ellipse(112, 60.4, 7.4, 3.4, 0, 3.3, 4.4); OA_s(c, '#fbd0da', 1.2);
}
OBJECT_ART.playzone = {
  box: [0, 0, 144, 144],
  draw: function (c, o, t, env) {
    o = o || {}; t = OA_num(t, 0);
    var id = OA_num(o.id, 0), ph = OA_usePh(o);
    OA_begin(c, o);
    OA_static(c, 'play', 0, 0, 144, 144, OA_playStatic);
    // a tennis ball that never quite sits still
    var roll = Math.sin(t * 0.9 + id) * 4, hop = Math.abs(Math.sin(t * 1.8 + id)) * 1.2 + (ph >= 0 ? Math.sin(ph * Math.PI) * 9 : 0);
    OA_sprite(c, 'bshadow', 60 + roll, 37.4, -7, -3, 14, 6, function (g) { OA_el(g, 0, 0, 6, 2.2); OA_f(g, OA_SH); });
    OA_sBall(c, 60 + roll, 31 - hop);
    c.restore();
  }
};

// ---------------------------------------------------------------- sand pit (2x2)
function OA_sandStatic(c) {
  var S = '#eed9a2', SD = '#d9c184', SH = '#f9edc6', i, x, y;
  OA_rr(c, 1.5, 84, 93, 11.5, 4); OA_f(c, OA_SH);
  // timber frame: block, top faces, inner pit
  OA_rr(c, 3, 6, 90, 86.4, 2.5); OA_fo(c, OA_WM, 1.8);
  c.fillStyle = OA_WL; c.fillRect(3.9, 6.9, 88.2, 78);
  c.fillStyle = '#d6a66e'; c.fillRect(4, 7, 88, 2.2); c.fillRect(4, 7, 2.4, 77);
  c.fillStyle = OA_WD; c.fillRect(3.9, 84.6, 88.2, 1.2);
  c.strokeStyle = OA_WM; c.lineWidth = 1; c.beginPath();
  c.moveTo(20, 10.6); c.lineTo(52, 10.6); c.moveTo(60, 9.4); c.lineTo(80, 9.4); c.moveTo(7.4, 24); c.lineTo(7.4, 52); c.moveTo(88.6, 30); c.lineTo(88.6, 66);
  c.moveTo(18, 81.4); c.lineTo(44, 81.4); c.moveTo(54, 80.2); c.lineTo(78, 80.2); c.stroke();
  c.strokeStyle = OA_WD; c.lineWidth = 1; c.beginPath(); c.moveTo(16, 88.6); c.lineTo(40, 88.6); c.moveTo(50, 89.6); c.lineTo(70, 89.6); c.moveTo(48, 85.6); c.lineTo(48, 92); c.stroke();
  c.fillStyle = OA_SD_NAIL; [[30, 88], [66, 88], [46, 9], [7, 46], [89, 46]].forEach(function (p) { c.fillRect(p[0], p[1], 1.4, 1.4); });
  // sand
  c.fillStyle = '#8f6234'; c.fillRect(11, 14, 74, 5);
  c.fillStyle = S; c.fillRect(11, 18.4, 74, 59);
  c.fillStyle = SD; c.fillRect(11, 18.4, 74, 2.6); c.fillRect(11, 18.4, 2.4, 59);
  c.save(); c.beginPath(); c.rect(11, 18.4, 74, 59); c.clip();
  c.fillStyle = SH; OA_el(c, 58, 40, 16, 7, -0.2); c.fill(); OA_el(c, 30, 66, 13, 5, 0.15); c.fill(); OA_el(c, 70, 70, 9, 3.4, 0); c.fill();
  c.strokeStyle = SD; c.lineWidth = 1.2; c.beginPath();
  c.moveTo(16, 52); c.quadraticCurveTo(24, 47, 32, 51); c.quadraticCurveTo(38, 54, 44, 50);
  c.moveTo(56, 58); c.quadraticCurveTo(64, 54, 72, 58); c.moveTo(44, 26); c.quadraticCurveTo(50, 23.4, 57, 26.4);
  c.moveTo(64, 30); c.quadraticCurveTo(70, 27, 80, 31); c.stroke();
  for (i = 0; i < 46; i++) { x = 13 + OA_h(i * 2.3) * 70; y = 21 + OA_h(i * 5.1 + 2) * 54; c.fillStyle = i % 3 ? SD : '#fffaf0'; c.fillRect(x, y, 1.3, 1.3); }
  // paw prints pottering across
  OA_paw(c, 47, 62, 0.9, SD, 0.5); OA_paw(c, 54, 55.4, 0.9, SD, 0.6); OA_paw(c, 58.4, 65, 0.9, SD, 0.5); OA_paw(c, 65.4, 48.6, 0.9, SD, 0.7);
  c.restore();
  c.beginPath(); c.rect(11, 14, 74, 63.4); OA_s(c, OA_OUT, 1.6);
  // ---- sand castle (top left)
  OA_el(c, 28, 41.6, 14.5, 4.6); OA_f(c, SD);
  c.beginPath(); c.moveTo(15, 40); c.quadraticCurveTo(16, 33, 21, 32.6); c.lineTo(35, 32.6); c.quadraticCurveTo(40, 33, 41, 40); c.quadraticCurveTo(28, 45, 15, 40); c.closePath(); OA_f(c, '#e6cf93'); OA_s(c, '#9a7d45', 1.3);
  OA_pl(c, [18, 35, 18, 25.4, 20, 25.4, 20, 27, 22, 27, 22, 25.4, 24.4, 25.4, 24.4, 27, 26.4, 27, 26.4, 25.4, 28.4, 25.4, 28.4, 35]); OA_fo(c, S, 1.5);
  OA_pl(c, [29.6, 36, 29.6, 28.4, 31.4, 28.4, 31.4, 30, 33.2, 30, 33.2, 28.4, 35.2, 28.4, 35.2, 30, 37, 30, 37, 28.4, 38.8, 28.4, 38.8, 36]); OA_fo(c, '#e6cf93', 1.5);
  c.fillStyle = SD; c.fillRect(25.4, 28, 2.2, 6.4); c.fillRect(36.6, 31, 1.6, 4.4);
  OA_rr(c, 21.4, 30.6, 3.2, 4.6, 1.5); OA_f(c, '#b89a5e'); OA_rr(c, 32.8, 32.6, 2.6, 3.6, 1.2); OA_f(c, '#b89a5e');
  // ---- bucket + spade (top right)
  OA_el(c, 72.6, 40.4, 9.4, 3); OA_f(c, SD);
  c.beginPath(); c.arc(71.6, 25.4, 8.4, Math.PI * 1.06, Math.PI * 1.94); OA_s(c, OA_OUT, 3.4); OA_s(c, '#c4beb2', 1.5);
  c.beginPath(); c.moveTo(63.4, 25.4); c.lineTo(65.4, 38.6); c.quadraticCurveTo(71.6, 41.6, 77.8, 38.6); c.lineTo(79.8, 25.4); c.closePath(); OA_fo(c, '#d9574a', 1.7);
  OA_pl(c, [75.4, 27, 79, 26, 77.2, 38.6, 74, 39.6]); OA_f(c, '#b9443a');
  c.fillStyle = '#f08f7f'; c.fillRect(65.8, 28.6, 1.5, 7);
  OA_star(c, 71.4, 33.6, 3.4, '#f2c14e');
  OA_el(c, 71.6, 25.4, 8.3, 2.7); OA_fo(c, '#ec7a6c', 1.6);
  c.beginPath(); c.moveTo(65, 25.2); c.quadraticCurveTo(68, 20.6, 71.6, 21.6); c.quadraticCurveTo(76, 20.4, 78.2, 25.2); c.ellipse(71.6, 25.4, 6.6, 1.7, 0, 0, Math.PI); c.closePath(); OA_fo(c, S, 1.3);
  OA_ln(c, 55.4, 23.6, 58.6, 36, OA_OUT, 4.2); OA_ln(c, 55.4, 23.6, 58.6, 36, '#f2c14e', 2.1);
  OA_rr(c, 52.6, 20.6, 5.4, 3.6, 1.6); OA_fo(c, '#f2c14e', 1.4);
  c.beginPath(); c.moveTo(55.4, 34.6); c.lineTo(62.4, 33); c.quadraticCurveTo(63.6, 40.6, 60, 43.6); c.quadraticCurveTo(56.6, 41, 55.4, 34.6); c.closePath(); OA_fo(c, '#66bde3', 1.5);
  OA_ln(c, 58.2, 36.6, 59.6, 41, '#3f8fc4', 1);
  OA_el(c, 60, 43.4, 5.4, 1.9); OA_f(c, S);
  // ---- buried bone and a freshly dug hole (bottom)
  OA_el(c, 36.4, 68.4, 11.4, 5); OA_f(c, '#c7ab6c'); OA_s(c, '#9a7d45', 1.2);
  OA_el(c, 36.4, 69.4, 9, 3.4); OA_f(c, '#a98a50');
  OA_bone(c, 34.6, 62, 17, 5, -1.05, OA_CREAM, 1.5);
  OA_ln(c, 33.4, 60.6, 36, 56.4, '#e0d2ae', 1.1);
  c.beginPath(); c.moveTo(25.4, 68.6); c.quadraticCurveTo(31, 63.4, 37, 66.4); c.quadraticCurveTo(43, 64.4, 47.6, 68.6); c.quadraticCurveTo(36, 75.4, 25.4, 68.6); c.closePath(); OA_f(c, S); OA_s(c, '#9a7d45', 1.2);
  c.fillStyle = SD; c.fillRect(30, 69, 1.4, 1.4); c.fillRect(39, 68.4, 1.4, 1.4); c.fillRect(35, 70.6, 1.4, 1.4);
  OA_el(c, 20.4, 72.4, 4.4, 2.4); OA_f(c, '#e6cf93'); OA_s(c, '#b89a5e', 1); OA_el(c, 51.4, 72.6, 3.4, 2); OA_f(c, '#e6cf93'); OA_s(c, '#b89a5e', 1);
  // ---- shell
  c.beginPath(); c.moveTo(73, 69.4); c.quadraticCurveTo(66.4, 66, 68.4, 61.4); c.quadraticCurveTo(73, 57.4, 77.6, 61.4); c.quadraticCurveTo(79.6, 66, 73, 69.4); c.closePath(); OA_fo(c, '#f8c3cf', 1.3);
  c.strokeStyle = '#e08fa4'; c.lineWidth = 0.9; c.beginPath(); c.moveTo(73, 68.6); c.lineTo(70.2, 62); c.moveTo(73, 68.6); c.lineTo(73, 60.4); c.moveTo(73, 68.6); c.lineTo(75.8, 62); c.stroke();
  // ---- corner posts
  [[1.5, 4.5, 0], [83.5, 4.5, 0], [1.5, 75.6, 1], [83.5, 75.6, 1]].forEach(function (p) {
    OA_rr(c, p[0], p[1], 11, p[2] ? 18.4 : 14, 2); OA_fo(c, OA_WM, 1.7);
    OA_rr(c, p[0], p[1], 11, 10.6, 2); OA_fo(c, OA_WH, 1.6);
    c.fillStyle = OA_WL; c.fillRect(p[0] + 6.6, p[1] + 1.6, 3, 7.6);
    OA_el(c, p[0] + 5.5, p[1] + 5.3, 1.2, 1.2); OA_f(c, OA_WD);
  });
  // sand kicked over the edge
  OA_el(c, 62, 82.6, 7, 1.9); OA_f(c, S); c.fillStyle = S; c.fillRect(70.6, 81.4, 1.6, 1.4); c.fillRect(53, 83.4, 1.5, 1.3);
  OA_el(c, 22, 94.2, 5, 1.3); OA_f(c, S); c.fillRect(29, 93.6, 1.5, 1.3);
}
var OA_SD_NAIL = '#7a4e2a';
OBJECT_ART.sandpit = {
  box: [0, 0, 96, 96],
  draw: function (c, o, t, env) {
    o = o || {}; env = env || OA_ENV0; t = OA_num(t, 0);
    var id = OA_num(o.id, 0), wind = OA_num(env.wind, 0), ph = OA_usePh(o), i;
    OA_begin(c, o);
    OA_static(c, 'sand', 0, 0, 96, 97, OA_sandStatic);
    // little flag on the castle
    OA_sFlag(c, 'sflag', 23.2, 25.4, t + id * 0.3, wind < -0.15 ? -1 : 1, 10, '#d9574a');
    // glints in the sand
    for (i = 0; i < 3; i++) {
      var tw = ((t * 0.3 + i * 0.37 + OA_h(id + i)) % 1 + 1) % 1;
      if (tw < 0.2) OA_sparkle(c, 20 + OA_h(i * 3 + 1) * 58, 46 + OA_h(i * 7 + 2) * 26, 2.6, Math.sin(tw / 0.2 * Math.PI) * 0.9);
    }
    // sand flying when a dog digs
    if (ph >= 0) for (i = 0; i < 6; i++) {
      var a = -1.9 + i * 0.28, d = ph * 16;
      c.fillStyle = '#eed9a2'; c.strokeStyle = '#b89a5e'; c.lineWidth = 0.8;
      OA_el(c, 36 + Math.cos(a) * d * 1.2, 62 + Math.sin(a) * d * 1.4 + ph * ph * 12, 1.5, 1.3); c.fill(); c.stroke();
    }
    c.restore();
  }
};

// ---------------------------------------------------------------- splash pool (3x2)
// point at fraction u (0..1, clockwise from the top-left) of a rounded rectangle's edge
function OA_rrPt(x, y, w, h, r, u) {
  var sw = w - 2 * r, sh = h - 2 * r, q = Math.PI * r / 2, L = 2 * sw + 2 * sh + 4 * q, d = ((u % 1) + 1) % 1 * L, a;
  if (d < sw) return [x + r + d, y]; d -= sw;
  if (d < q) { a = -Math.PI / 2 + d / r; return [x + w - r + Math.cos(a) * r, y + r + Math.sin(a) * r]; } d -= q;
  if (d < sh) return [x + w, y + r + d]; d -= sh;
  if (d < q) { a = d / r; return [x + w - r + Math.cos(a) * r, y + h - r + Math.sin(a) * r]; } d -= q;
  if (d < sw) return [x + w - r - d, y + h]; d -= sw;
  if (d < q) { a = Math.PI / 2 + d / r; return [x + r + Math.cos(a) * r, y + h - r + Math.sin(a) * r]; } d -= q;
  if (d < sh) return [x, y + h - r - d]; d -= sh;
  a = Math.PI + d / r; return [x + r + Math.cos(a) * r, y + r + Math.sin(a) * r];
}
function OA_fish(c, x, y, s, dir, col) {
  c.save(); c.translate(x, y); c.scale(s * dir, s); c.fillStyle = col;
  c.beginPath(); c.ellipse(0, 0, 5, 2.6, 0, 0, OA_TAU); c.moveTo(-4, 0); c.lineTo(-8, -2.8); c.lineTo(-8, 2.8); c.closePath(); c.fill(); c.restore();
}
function OA_poolStatic(c) {
  var N = 20, i, k, p, q, OX = 3, OY = 5, OW2 = 138, OH = 80, OR = 36, IX = 15, IY = 15, IW = 114, IH = 60, IR = 27;
  OA_rr(c, 1, 12, 142, 83, 36); OA_f(c, OA_SH);
  // outer wall (side seen from the front)
  OA_rr(c, OX, OY + 6, OW2, OH, OR); OA_fo(c, '#3f8fc4', 1.8);
  c.strokeStyle = '#2f6f9c'; c.lineWidth = 1.1; c.beginPath();
  for (i = 0; i < N; i++) { p = OA_rrPt(OX, OY, OW2, OH, OR, i / N); if (p[1] > 62) { c.moveTo(p[0], p[1] + 1.4); c.lineTo(p[0], p[1] + 5.6); } }
  c.stroke();
  // inflated ring, alternating panels
  OA_rr(c, OX, OY, OW2, OH, OR); OA_f(c, '#6cc1e6');
  c.fillStyle = '#eef8fc';
  for (i = 0; i < N; i += 2) {
    c.beginPath();
    for (k = 0; k <= 4; k++) { p = OA_rrPt(OX, OY, OW2, OH, OR, (i + k / 4) / N); if (k) c.lineTo(p[0], p[1]); else c.moveTo(p[0], p[1]); }
    for (k = 4; k >= 0; k--) { q = OA_rrPt(IX, IY, IW, IH, IR, (i + k / 4) / N); c.lineTo(q[0], q[1]); }
    c.closePath(); c.fill();
  }
  // shade on the lower right of the ring, gloss on the upper left
  c.save(); OA_rr(c, OX, OY, OW2, OH, OR); c.clip();
  c.lineWidth = 4.4; c.strokeStyle = 'rgba(40,100,150,0.22)'; OA_rr(c, OX + 3, OY + 3.4, OW2 - 3.4, OH - 3.4, OR - 2); c.stroke();
  c.restore();
  c.strokeStyle = 'rgba(63,143,196,0.55)'; c.lineWidth = 1; c.beginPath();
  for (i = 0; i < N; i++) { p = OA_rrPt(OX, OY, OW2, OH, OR, i / N); q = OA_rrPt(IX, IY, IW, IH, IR, i / N); c.moveTo(p[0], p[1]); c.lineTo(q[0], q[1]); }
  c.stroke();
  c.save(); c.setLineDash([9, 12.4]); c.lineCap = 'round'; c.strokeStyle = 'rgba(255,255,255,0.9)'; c.lineWidth = 1.8;
  c.beginPath(); p = OA_rrPt(9, 10, 126, 70, 31, 0.62); c.moveTo(p[0], p[1]);
  for (i = 1; i <= 40; i++) { p = OA_rrPt(9, 10, 126, 70, 31, 0.62 + i / 40 * 0.5); c.lineTo(p[0], p[1]); }
  c.stroke(); c.restore();
  OA_rr(c, OX, OY, OW2, OH, OR); OA_s(c, OA_OUT, 1.8);
  // water
  OA_rr(c, IX, IY, IW, IH, IR); OA_f(c, '#4c9fc9');
  c.save(); OA_rr(c, IX, IY, IW, IH, IR); c.clip();
  OA_rr(c, IX, IY + 5, IW, IH, IR); OA_f(c, '#86d6ee');
  OA_rr(c, IX + 12, IY + 15, IW - 30, IH - 22, 16); OA_f(c, '#9fe0f3');
  OA_fish(c, 52, 34, 1.15, 1, 'rgba(76,170,214,0.5)'); OA_fish(c, 92, 60, 1.3, -1, 'rgba(76,170,214,0.5)'); OA_fish(c, 72, 48, 0.9, 1, 'rgba(76,170,214,0.4)');
  OA_star(c, 110, 46, 4.6, 'rgba(76,170,214,0.45)'); OA_star(c, 36, 58, 3.6, 'rgba(76,170,214,0.45)');
  c.restore();
  OA_rr(c, IX, IY, IW, IH, IR); OA_s(c, OA_OUT, 1.6);
  // air valve
  OA_rr(c, 127, 80, 6, 5, 1.6); OA_fo(c, '#eef8fc', 1.3);
}
function OA_beachBall(c, x, y, r, rot) {
  var i, cols = ['#d9574a', '#f2c14e', '#3aa89a'];
  OA_el(c, x, y, r, r); OA_fo(c, '#fffaf0', 1.6);
  for (i = 0; i < 3; i++) {
    c.beginPath(); c.moveTo(x, y); c.arc(x, y, r - 0.8, rot + i * 2.094, rot + i * 2.094 + 1.05); c.closePath(); c.fillStyle = cols[i]; c.fill();
  }
  OA_el(c, x, y, 1.5, 1.5); OA_f(c, '#fffaf0');
  OA_el(c, x - r * 0.4, y - r * 0.45, r * 0.24, r * 0.16, -0.6); OA_f(c, 'rgba(255,255,255,0.85)');
}
OBJECT_ART.pool = {
  box: [0, 0, 144, 96],
  draw: function (c, o, t, env) {
    o = o || {}; t = OA_num(t, 0);
    var id = OA_num(o.id, 0), ph = OA_usePh(o), i, x, y, a;
    OA_begin(c, o);
    OA_static(c, 'pool', 0, 0, 144, 97, OA_poolStatic);
    // drifting wavelets
    var A0 = c.globalAlpha;
    for (i = 0; i < 6; i++) {
      var f = ((t * 0.09 + i * 0.173 + OA_h(id + i)) % 1 + 1) % 1;
      c.globalAlpha = A0 * Math.sin(f * Math.PI) * 0.85;
      OA_sprite(c, 'wavelet', 30 + ((i * 29) % 70) + f * 14, 27 + i * 7.4, -1, -3.4, 14, 6.8, function (g) {
        g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(3, -2.2, 6, 0); g.quadraticCurveTo(9, 2.2, 12, 0); OA_s(g, '#ffffff', 1.2);
      });
    }
    c.globalAlpha = A0;
    // rings
    for (i = 0; i < 2; i++) {
      var rt = t * 0.4 + i * 0.5 + OA_h(id + 3), rc = Math.floor(rt);
      OA_sRipple(c, 34 + OA_h(rc * 3.7 + i) * 76, 30 + OA_h(rc * 1.3 + i * 5) * 36, rt - rc, true);
    }
    // beach ball and rubber duck bobbing about, each with a little wake
    OA_sprite(c, 'pball', 38 + Math.sin(t * 0.27 + 2 + id) * 7, 57 + Math.cos(t * 0.35 + id) * 4 + Math.sin(t * 2.1) * 0.5, -11, -9, 22, 19, function (g) {
      var ga = g.globalAlpha; g.globalAlpha = ga * 0.7; OA_el(g, 0, 5.4, 8.6, 2.8); OA_s(g, '#ffffff', 1.1); g.globalAlpha = ga;
      OA_el(g, 0, 4.4, 6.4, 2.4); OA_f(g, 'rgba(40,100,150,0.28)');
      OA_beachBall(g, 0, 0, 6.6, 0.4);
    });
    var dd = Math.cos(t * 0.4 + id) >= 0 ? 1 : -1;
    OA_sprite(c, dd > 0 ? 'pduckR' : 'pduckL', 104 + Math.sin(t * 0.4 + id) * 9, 33 + Math.cos(t * 0.31 + id) * 5 + Math.sin(t * 2.4) * 0.6, -13, -14, 26, 20, function (g) {
      var ga = g.globalAlpha; g.globalAlpha = ga * 0.7; OA_el(g, 0, 1.4, 10.4, 3); OA_s(g, '#ffffff', 1.1); g.globalAlpha = ga;
      OA_el(g, 0, 2.2, 7.4, 2.2); OA_f(g, 'rgba(40,100,150,0.28)');
      OA_duck(g, 0, 0, 1, dd);
    });
    // sparkles
    for (i = 0; i < 3; i++) {
      var tw = ((t * 0.45 + i * 0.33 + OA_h(id + i * 2)) % 1 + 1) % 1;
      if (tw < 0.3) OA_sparkle(c, 30 + OA_h(i * 5 + 1) * 84, 24 + OA_h(i * 2 + 7) * 12, 3, Math.sin(tw / 0.3 * Math.PI));
    }
    OA_splash(c, 72, 42, ph, 9, 40, 24, id + 5);
    c.restore();
  }
};

// ---------------------------------------------------------------- nap mat (2x1)
var OA_MATS = [
  { a: '#a58bd6', d: '#7f66b6', h: '#c4b1ec', p: '#f2a0b5', b: '#f2c14e', bd: '#d7a236' },
  { a: '#5cb8a9', d: '#37897e', h: '#8fd6c9', p: '#f2c14e', b: '#f2a0b5', bd: '#d47a93' },
  { a: '#f2a0b5', d: '#cf7690', h: '#fbc9d5', p: '#3aa89a', b: '#66bde3', bd: '#3f8fc4' }
];
function OA_napStatic(c, v) {
  var M = OA_MATS[v] || OA_MATS[0], i;
  OA_rr(c, 2, 11, 92, 36, 10); OA_f(c, OA_SH);
  OA_rr(c, 3, 10, 90, 35, 9); OA_fo(c, M.d, 1.8);
  OA_rr(c, 3, 6.6, 90, 35, 9); OA_f(c, M.a);
  // quilting
  c.save(); OA_rr(c, 3, 6.6, 90, 35, 9); c.clip();
  OA_rr(c, 7, 10.2, 82, 27.8, 6); OA_f(c, M.h);
  var ga = c.globalAlpha; c.globalAlpha = ga * 0.5; OA_rr(c, 7, 23, 82, 15, 6); OA_f(c, M.a); c.globalAlpha = ga;
  c.strokeStyle = M.d; c.lineWidth = 1; c.setLineDash([2.4, 2.2]); c.beginPath();
  for (i = -3; i < 9; i++) { c.moveTo(i * 13, 6); c.lineTo(i * 13 + 36, 42); c.moveTo(i * 13 + 36, 6); c.lineTo(i * 13, 42); }
  c.stroke(); c.setLineDash([]);
  c.fillStyle = M.d; for (i = -1; i < 8; i++) { c.beginPath(); c.arc(i * 13 + 18, 24, 1.2, 0, OA_TAU); c.fill(); c.beginPath(); c.arc(i * 13 + 11.5, 11, 1.1, 0, OA_TAU); c.fill(); c.beginPath(); c.arc(i * 13 + 11.5, 37, 1.1, 0, OA_TAU); c.fill(); }
  c.restore();
  OA_rr(c, 5.6, 9, 84.8, 30.2, 7); OA_s(c, M.d, 1.1);
  OA_rr(c, 3, 6.6, 90, 35, 9); OA_s(c, OA_OUT, 1.8);
  // folded blanket (right)
  c.save(); c.translate(75.5, 30); c.rotate(0.07);
  OA_rr(c, -14.5, -9.5, 29, 20.5, 3); OA_fo(c, M.bd, 1.7);
  OA_rr(c, -14.5, -11.5, 29, 19, 3); OA_fo(c, M.b, 1.7);
  c.strokeStyle = 'rgba(255,250,235,0.8)'; c.lineWidth = 1.3; c.beginPath(); c.moveTo(-13.6, -6); c.lineTo(13.6, -6); c.moveTo(-13.6, 1.4); c.lineTo(13.6, 1.4); c.moveTo(-6, -10.6); c.lineTo(-6, 6.6); c.moveTo(5, -10.6); c.lineTo(5, 6.6); c.stroke();
  c.strokeStyle = M.bd; c.lineWidth = 1; c.beginPath(); c.moveTo(-13.6, -3.6); c.lineTo(13.6, -3.6); c.moveTo(-13.6, 3.8); c.lineTo(13.6, 3.8); c.moveTo(-3.6, -10.6); c.lineTo(-3.6, 6.6); c.moveTo(7.4, -10.6); c.lineTo(7.4, 6.6); c.stroke();
  c.strokeStyle = OA_OUT; c.lineWidth = 1; c.beginPath(); for (i = 0; i < 6; i++) { c.moveTo(15, -8.6 + i * 3.4); c.lineTo(17.4, -8.4 + i * 3.4); } c.stroke();
  c.restore();
  // plump pillow (left)
  c.save(); c.translate(21.5, 23.4); c.rotate(-0.09);
  OA_rr(c, -11.4, -10.4, 25.6, 27.4, 6); OA_f(c, 'rgba(40,26,12,0.2)');
  c.beginPath(); c.moveTo(-7.6, -13.4); c.quadraticCurveTo(0, -14.8, 7.6, -13.4); c.quadraticCurveTo(12.2, -13.2, 12.4, -8.6); c.quadraticCurveTo(13.6, 0, 12.4, 8.6); c.quadraticCurveTo(12.2, 13.2, 7.6, 13.4);
  c.quadraticCurveTo(0, 14.8, -7.6, 13.4); c.quadraticCurveTo(-12.2, 13.2, -12.4, 8.6); c.quadraticCurveTo(-13.6, 0, -12.4, -8.6); c.quadraticCurveTo(-12.2, -13.2, -7.6, -13.4); c.closePath(); OA_fo(c, OA_CREAM, 1.8);
  c.save(); c.clip();
  c.fillStyle = '#eadbb8'; c.beginPath(); c.moveTo(-14, 9); c.quadraticCurveTo(4, 13, 9, -16); c.lineTo(16, -16); c.lineTo(16, 18); c.lineTo(-14, 18); c.closePath(); c.fill();
  c.fillStyle = M.p; c.fillRect(-8.4, -17, 3.4, 34); c.fillRect(-2.6, -17, 1.5, 34);
  c.restore();
  OA_bonePath(c, 4.6, 0, 10.5, 3, 1.2); OA_f(c, '#d9b98a');
  c.strokeStyle = '#cdbb92'; c.lineWidth = 1; c.beginPath(); c.moveTo(-9.8, -10.8); c.lineTo(-8, -9); c.moveTo(9.8, -10.8); c.lineTo(8, -9); c.moveTo(-9.8, 10.8); c.lineTo(-8, 9); c.moveTo(9.8, 10.8); c.lineTo(8, 9); c.stroke();
  c.restore();
}
OBJECT_ART.napmat = {
  box: [0, 0, 96, 48],
  draw: function (c, o, t, env) {
    o = o || {}; t = OA_num(t, 0);
    var v = OA_var(o, 3), id = OA_num(o.id, 0), i;
    OA_begin(c, o);
    OA_squash(c, OA_usePh(o), 48, 44, 0.05);
    OA_static(c, 'nap' + v, 0, 0, 96, 49, function (g) {
      OA_napStatic(g, v);
      // embroidered moon and stars
      g.beginPath(); g.arc(48.6, 17.6, 5.2, 0.7, 5.2); g.arc(51.4, 16.4, 4.2, 4.75, 1.05, true); g.closePath(); OA_f(g, '#fff3c4');
      for (var k = 0; k < 3; k++) OA_sparkle(g, 42 + k * 8.4 + (k === 1 ? 2 : 0), k === 1 ? 29.4 : 12 + k * 1.6, 2.3, 0.6, '#fff3c4');
    });
    // one star at a time twinkles brighter
    i = ((Math.floor(t * 0.8 + id) % 3) + 3) % 3;
    var tw = ((t * 0.8 + id) % 1 + 1) % 1;
    OA_sparkle(c, 42 + i * 8.4 + (i === 1 ? 2 : 0), i === 1 ? 29.4 : 12 + i * 1.6, 2.3 + Math.sin(tw * Math.PI) * 1.2, Math.sin(tw * Math.PI) * 0.9, '#fffbe6');
    c.restore();
  }
};

// ---------------------------------------------------------------- agility course (4x2)
function OA_pole(c, x, y, h, colA, lean) {
  // a striped pole standing at (x, y)
  var tx = x + lean * h, ty = y - h, i;
  OA_el(c, x + 1.5, y + 0.4, 4.4, 1.7); OA_f(c, OA_SH);
  OA_ln(c, x, y, tx, ty, OA_OUT, 5.2); OA_ln(c, x, y, tx, ty, '#fffaf0', 3);
  c.save(); c.lineCap = 'butt'; c.strokeStyle = colA; c.lineWidth = 3; c.beginPath();
  for (i = 0; i < 3; i++) { var f0 = 0.12 + i * 0.3, f1 = f0 + 0.15; c.moveTo(x + (tx - x) * f0, y + (ty - y) * f0); c.lineTo(x + (tx - x) * f1, y + (ty - y) * f1); }
  c.stroke(); c.restore();
  OA_el(c, tx, ty - 0.6, 2.5, 2.5); OA_fo(c, '#f2c14e', 1.4);
}
function OA_agilityStatic(c) {
  var i, x, y;
  // ---- turf pad with chalk lines
  OA_rr(c, 2, 3, 188, 90, 11); OA_f(c, '#93d176'); OA_s(c, '#5d9d49', 1.3);
  c.save(); OA_rr(c, 2, 3, 188, 90, 11); c.clip();
  c.fillStyle = '#87c96b'; for (i = -2; i < 12; i += 2) { OA_pl(c, [i * 20, 3, i * 20 + 20, 3, i * 20 + 50, 93, i * 20 + 30, 93]); c.fill(); }
  c.restore();
  OA_rr(c, 6, 7, 180, 82, 8); OA_s(c, 'rgba(255,255,255,0.85)', 1.5);
  // chalk arrows showing the way round
  c.save(); c.strokeStyle = 'rgba(255,255,255,0.8)'; c.fillStyle = 'rgba(255,255,255,0.85)'; c.lineWidth = 1.5; c.setLineDash([3.2, 3.4]);
  c.beginPath(); c.moveTo(58, 30); c.quadraticCurveTo(64, 25, 70, 27); c.stroke();
  c.beginPath(); c.moveTo(178, 40); c.quadraticCurveTo(184, 52, 176, 62); c.stroke();
  c.beginPath(); c.moveTo(146, 76); c.quadraticCurveTo(138, 82, 130, 78); c.stroke();
  c.beginPath(); c.moveTo(56, 78); c.quadraticCurveTo(51, 80, 48, 76); c.stroke();
  c.setLineDash([]);
  OA_pl(c, [74, 28.4, 69, 24.4, 68.6, 30.6]); c.fill(); OA_pl(c, [173, 66, 173.6, 59.6, 179.4, 62.6]); c.fill(); OA_pl(c, [126, 76, 131.6, 74.6, 130, 81]); c.fill();
  c.restore();
  // ---- chequered finish strip (bottom right)
  for (i = 0; i < 10; i++) { c.fillStyle = (i + Math.floor(i / 2)) % 2 ? 'rgba(255,255,255,0.9)' : 'rgba(59,42,32,0.55)'; c.fillRect(150 + (i % 2) * 5, 60 + Math.floor(i / 2) * 5, 5, 5); }
  c.strokeStyle = 'rgba(59,42,32,0.55)'; c.lineWidth = 1; c.strokeRect(150, 60, 10, 25);
  // ---- pause table (bottom left)
  OA_el(c, 29, 86, 21, 4.6); OA_f(c, OA_SH);
  OA_rr(c, 11, 79.6, 4.4, 7.4, 1.2); OA_fo(c, OA_WD, 1.4); OA_rr(c, 41.6, 79.6, 4.4, 7.4, 1.2); OA_fo(c, OA_WD, 1.4);
  OA_rr(c, 8, 56, 42, 26.4, 3); OA_fo(c, '#c99a2e', 1.8);
  OA_rr(c, 8, 56, 42, 21.6, 3); OA_fo(c, '#f2c14e', 1.7);
  OA_rr(c, 11, 58.6, 36, 16.4, 2); OA_s(c, '#d9574a', 1.5);
  OA_paw(c, 29, 66.8, 1.7, '#fffaf0');
  c.fillStyle = '#f8d987'; c.fillRect(9.4, 57.2, 39, 1.2);
  // ---- low jump (top left)
  OA_el(c, 34, 39.6, 24, 2.6); OA_f(c, OA_SH);
  [13, 53].forEach(function (px) {
    OA_rr(c, px - 6.5, 36.6, 13, 3.6, 1.6); OA_fo(c, '#3f8fc4', 1.4);
    OA_ln(c, px, 37, px, 13, OA_OUT, 5.6); OA_ln(c, px, 37, px, 13, '#fffaf0', 3.3);
    c.fillStyle = '#3f8fc4'; c.fillRect(px - 1.65, 15.4, 3.3, 3.6); c.fillRect(px - 1.65, 30, 3.3, 3.6);
    OA_el(c, px, 11.4, 3, 3); OA_fo(c, '#f2c14e', 1.5);
  });
  OA_ln(c, 13, 24, 53, 24, OA_OUT, 5.8); OA_ln(c, 13, 24, 53, 24, '#fffaf0', 3.4);
  c.save(); c.lineCap = 'butt'; c.setLineDash([5.2, 5.2]); OA_ln(c, 15.6, 24, 51, 24, '#d9574a', 3.4); c.restore();
  OA_ln(c, 15, 22.9, 51, 22.9, 'rgba(255,255,255,0.55)', 0.9);
  OA_rr(c, 10.4, 22, 5.2, 4.2, 1.2); OA_fo(c, '#3f8fc4', 1.3); OA_rr(c, 50.4, 22, 5.2, 4.2, 1.2); OA_fo(c, '#3f8fc4', 1.3);
  // ---- play tunnel (bottom middle): a ribbed tube curving away to the right
  var P0 = [66, 70], P1 = [106, 80], P2 = [126, 52], hw = 11.4;
  OA_el(c, 98, 82.6, 36, 6); OA_f(c, OA_SH);
  c.save(); c.lineCap = 'butt';
  OA_el(c, P2[0], P2[1], 5.4, hw + 0.9, -0.95); OA_fo(c, '#2f6f9c', 1.8);
  c.beginPath(); c.moveTo(P0[0], P0[1]); c.quadraticCurveTo(P1[0], P1[1], P2[0], P2[1]); OA_s(c, OA_OUT, hw * 2 + 3.6); OA_s(c, '#3f8fc4', hw * 2);
  c.beginPath(); c.moveTo(P0[0], P0[1] - 5.2); c.quadraticCurveTo(P1[0] - 2, P1[1] - 6.4, P2[0] - 4.6, P2[1] - 3.4); OA_s(c, '#66aee0', 6);
  c.beginPath(); c.moveTo(P0[0], P0[1] + 7.4); c.quadraticCurveTo(P1[0] + 3, P1[1] + 8.4, P2[0] + 6, P2[1] + 4.4); OA_s(c, '#2f6f9c', 5);
  c.restore();
  c.strokeStyle = '#235a82'; c.lineWidth = 1.3; c.beginPath();
  for (i = 1; i < 8; i++) {
    var s = i / 8 + 0.03, ms = 1 - s, bx = ms * ms * P0[0] + 2 * ms * s * P1[0] + s * s * P2[0], by = ms * ms * P0[1] + 2 * ms * s * P1[1] + s * s * P2[1];
    var tx = 2 * ms * (P1[0] - P0[0]) + 2 * s * (P2[0] - P1[0]), ty = 2 * ms * (P1[1] - P0[1]) + 2 * s * (P2[1] - P1[1]), tl = Math.sqrt(tx * tx + ty * ty); tx /= tl; ty /= tl;
    c.moveTo(bx + ty * hw, by - tx * hw); c.quadraticCurveTo(bx + tx * 4.4, by + ty * 4.4, bx - ty * hw, by + tx * hw);
  }
  c.stroke();
  OA_el(c, P0[0], P0[1], 6.4, hw + 1.2, 0.19); OA_fo(c, '#2a1b15', 1.6);
  c.save(); OA_el(c, P0[0], P0[1], 6.4, hw + 1.2, 0.19); c.clip(); OA_el(c, P0[0] + 4.4, P0[1] + 1.4, 5.4, hw - 1.6, 0.19); OA_f(c, '#4a3022'); c.restore();
  OA_el(c, P0[0], P0[1], 6.4, hw + 1.2, 0.19); OA_s(c, OA_OUT, 5.6); OA_s(c, '#f2c14e', 2.8);
  // ---- weave poles (top right)
  OA_ln(c, 76, 33.6, 180, 33.6, OA_OUT, 4.6); OA_ln(c, 76, 33.6, 180, 33.6, '#a9a398', 2.4);
  for (i = 0; i < 6; i++) OA_pole(c, 80 + i * 19.2, 33.2, 21.5, i % 2 ? '#3f8fc4' : '#d9574a', (i % 2 ? 1 : -1) * 0.07);
  // ---- a cone by the finish
  OA_cone(c, 140, 66, 0.9);
}
function OA_finishFlag(c, fx, fy, a, dir) {
  var w1 = Math.sin(a) * 1.6, w2 = Math.cos(a) * 1.4, i;
  OA_el(c, fx + 1, fy + 0.4, 4, 1.6); OA_f(c, OA_SH);
  OA_ln(c, fx, fy, fx, fy - 27, OA_OUT, 3.6); OA_ln(c, fx, fy, fx, fy - 27, OA_WL, 1.7);
  function edge(u) { return fy - 26.4 + 2 * u * (1 - u) * (w1 - 2) + u * u * (w2 + 1); }      // top edge of the cloth at u = 0..1
  c.beginPath(); c.moveTo(fx, edge(0));
  for (i = 1; i <= 6; i++) c.lineTo(fx + dir * 13 * i / 6, edge(i / 6));
  for (i = 6; i >= 0; i--) c.lineTo(fx + dir * 13 * i / 6, edge(i / 6) + 10);
  c.closePath(); OA_fo(c, '#fffaf0', 1.4);
  c.fillStyle = OA_OUT;
  for (i = 0; i < 6; i++) {
    var cx0 = i % 3, cy0 = Math.floor(i / 3); if ((cx0 + cy0) % 2) continue;
    var xa = fx + dir * 13 * cx0 / 3, xb = fx + dir * 13 * (cx0 + 1) / 3, xm = (xa + xb) / 2;
    var ya = edge(cx0 / 3) + cy0 * 5, ym = edge((cx0 + 0.5) / 3) + cy0 * 5, yb = edge((cx0 + 1) / 3) + cy0 * 5;
    OA_pl(c, [xa, ya, xm, ym, xb, yb, xb, yb + 5, xm, ym + 5, xa, ya + 5]); c.fill();
  }
  OA_el(c, fx, fy - 28, 1.8, 1.8); OA_fo(c, '#f2c14e', 1.2);
}
OBJECT_ART.agility = {
  box: [0, 0, 192, 96],
  draw: function (c, o, t, env) {
    o = o || {}; env = env || OA_ENV0; t = OA_num(t, 0);
    var id = OA_num(o.id, 0), wind = OA_num(env.wind, 0), i;
    OA_begin(c, o);
    OA_static(c, 'agility', 0, 0, 192, 96, OA_agilityStatic);
    // chequered finish flag rippling in the breeze (8-frame flip-book)
    var f = ((Math.floor(t * 9 + id) % 8) + 8) % 8, dir = wind < -0.15 ? -1 : 1;
    OA_static(c, 'aflag' + f + (dir < 0 ? 'L' : 'R'), 153, 52, 36, 38, function (g) { OA_finishFlag(g, 171, 86, f / 8 * OA_TAU, dir); });
    c.restore();
  }
};

// =====================================================================================================
//  CONSTRUCTION SITE
// =====================================================================================================
function OA_dirtStatic(c, Wp, Hp, seed) {
  var n = Math.max(14, Math.round((Wp + Hp) / 9)), i, pts = [], p, cx = Wp / 2, cy = Hp / 2 + 1, j, x, y, r;
  for (i = 0; i < n; i++) {
    p = OA_rrPt(2, 4, Wp - 4, Hp - 6, Math.min(12, Hp / 3), i / n); j = OA_h(seed * 3.1 + i * 1.9) * 3.4;
    var dx = cx - p[0], dy = cy - p[1], dl = Math.sqrt(dx * dx + dy * dy) || 1;
    pts.push([p[0] + dx / dl * j, p[1] + dy / dl * j]);
  }
  c.beginPath(); c.moveTo((pts[0][0] + pts[n - 1][0]) / 2, (pts[0][1] + pts[n - 1][1]) / 2);
  for (i = 0; i < n; i++) { var a = pts[i], b = pts[(i + 1) % n]; c.quadraticCurveTo(a[0], a[1], (a[0] + b[0]) / 2, (a[1] + b[1]) / 2); }
  c.closePath(); c.fillStyle = '#bb8f63'; c.fill(); c.strokeStyle = '#8a6240'; c.lineWidth = 1.5; c.stroke();
  c.save(); c.clip();
  var area = Wp * Hp / 2304, m = Math.round(5 + area * 5);
  for (i = 0; i < m; i++) {           // darker churned patches
    x = 6 + OA_h(seed + i * 4.7) * (Wp - 12); y = 7 + OA_h(seed + i * 2.9 + 1) * (Hp - 13);
    OA_el(c, x, y, 5 + OA_h(i + seed) * 7, 2.4 + OA_h(i * 3 + seed) * 2.6, OA_h(i) - 0.5); OA_f(c, i % 2 ? '#a87c52' : '#cfa577');
  }
  c.strokeStyle = '#94693f'; c.lineWidth = 1.1; c.beginPath();
  for (i = 0; i < m; i++) {           // spade cuts
    x = 7 + OA_h(seed + i * 7.3 + 2) * (Wp - 16); y = 8 + OA_h(seed + i * 1.3 + 4) * (Hp - 14);
    c.moveTo(x, y); c.quadraticCurveTo(x + 3, y - 2, x + 6, y);
  }
  c.stroke();
  for (i = 0; i < Math.round(2 + area * 1.6); i++) {   // clods and pebbles
    x = 7 + OA_h(seed + i * 5.9 + 7) * (Wp - 14); y = 9 + OA_h(seed + i * 3.3 + 9) * (Hp - 15); r = 1.6 + OA_h(i + 3 + seed) * 1.4;
    OA_el(c, x + 0.6, y + 0.9, r + 0.4, r * 0.7); OA_f(c, 'rgba(70,44,22,0.35)');
    OA_el(c, x, y, r, r * 0.75); c.fillStyle = i % 3 === 0 ? '#bdb7aa' : '#8f6844'; c.fill(); c.strokeStyle = i % 3 === 0 ? '#7d776c' : '#6d4a2c'; c.lineWidth = 0.9; c.stroke();
  }
  c.restore();
}
function OA_stake(c, x, y) {   // stake top at y-9, driven in at (x, y)
  OA_pl(c, [x - 1.7, y, x - 1.7, y - 8.6, x + 1.7, y - 9.6, x + 1.7, y]); OA_fo(c, OA_WH, 1.4);
  OA_el(c, x, y + 0.3, 2.8, 1); OA_f(c, '#8a6240');
}
function OA_string(c, x0, y0, x1, y1, sag) {
  c.beginPath(); c.moveTo(x0, y0); c.quadraticCurveTo((x0 + x1) / 2, (y0 + y1) / 2 + sag, x1, y1);
  c.strokeStyle = 'rgba(59,42,32,0.55)'; c.lineWidth = 1.9; c.stroke(); c.strokeStyle = '#fbf1d8'; c.lineWidth = 1; c.stroke();
}
function OA_beams(c, segs, col, hi, wo, wi) {
  var i;
  c.lineCap = 'square';
  c.beginPath(); for (i = 0; i < segs.length; i += 4) { c.moveTo(segs[i], segs[i + 1]); c.lineTo(segs[i + 2], segs[i + 3]); }
  c.strokeStyle = OA_OUT; c.lineWidth = wo || 5.4; c.stroke(); c.strokeStyle = col; c.lineWidth = wi || 3.1; c.stroke();
  if (hi) { c.beginPath(); for (i = 0; i < segs.length; i += 4) { c.moveTo(segs[i] - 0.7, segs[i + 1] - 0.7); c.lineTo(segs[i + 2] - 0.7, segs[i + 3] - 0.7); } c.strokeStyle = hi; c.lineWidth = 0.9; c.stroke(); }
  c.lineCap = 'round';
}
function OA_hammer(c, x, y, ang) {   // (x, y) = the spot being hit; hand is up to the right
  c.save(); c.translate(x + 11.5, y - 2.5); c.rotate(ang);
  OA_ln(c, 0, 0, -10.4, 0, OA_OUT, 4.4); OA_ln(c, 0, 0, -10.4, 0, OA_WM, 2.2);
  OA_rr(c, -14.6, -4.4, 5.4, 9.4, 1.3); OA_fo(c, '#8e887d', 1.5);
  c.fillStyle = '#c4beb2'; c.fillRect(-13.6, -3.4, 1.4, 7.4);
  c.restore();
}
// geometry shared by the layers of a site of Wp x Hp art px
function OA_conGeo(Wp, Hp) {
  var DX = 4 + Hp * 0.03, DY = -Math.max(7, Hp * 0.2 - 2), fx0 = 12, fx1 = Wp - 12 - DX;
  var G = { DX: DX, DY: DY, fx0: fx0, fx1: fx1, fb: Hp >= 96 ? Hp - 21 : Hp - 12, FH: Math.min(52, 14 + Hp * 0.26) };
  G.n = Math.max(2, Math.round((fx1 - fx0) / 36) + 1); G.mid = (fx0 + fx1) / 2; G.RH = Math.min(15, (fx1 - fx0) * 0.2 + 3); G.top = G.fb - G.FH;
  return G;
}
// the timber frame at progress p (a slightly darker twin stands just behind it for depth);
// leaves the spot the hammer should be working on in OA_dynAux
function OA_conFrame(c, Wp, Hp, p) {
  var G = OA_conGeo(Wp, Hp), DX = G.DX, DY = G.DY, fx0 = G.fx0, fx1 = G.fx1, fb = G.fb, FH = G.FH, n = G.n, mid = G.mid, RH = G.RH, top = G.top;
  var hx = fx0 + 3, hy = fb - 2, back = [], front = [], px, hf, g, i;
  function grow(a, b) { return OA_cl((p - a) / (b - a), 0, 1); }
  function tip(gv, x, y) { if (gv > 0 && gv < 1) { hx = x; hy = y; } }
  var gSill = grow(0.03, 0.14), gTop = grow(0.5, 0.64), gBrace = grow(0.62, 0.76), gRaf = grow(0.74, 0.92), gBoard = grow(0.86, 1);
  if (gSill > 0) {                       // footing: back sill and the two side sills
    var bs = OA_cl(gSill * 2, 0, 1), bs2 = OA_cl(gSill * 2 - 1, 0, 1);
    back.push(fx0, fb, fx0 + DX * bs, fb + DY * bs, fx1, fb, fx1 + DX * bs, fb + DY * bs);
    if (bs2 > 0) back.push(fx0 + DX, fb + DY, fx0 + DX + (fx1 - fx0) * bs2, fb + DY);
  }
  for (i = 0; i < n; i++) {
    px = fx0 + (fx1 - fx0) * i / (n - 1); hf = grow(0.1 + i * 0.03, 0.44 + i * 0.03);
    if (hf > 0) back.push(px + DX, fb + DY, px + DX, fb + DY - FH * hf);
  }
  if (gTop > 0) back.push(fx0 + DX, top + DY, fx0 + DX + (fx1 - fx0) * gTop, top + DY);
  if (gRaf > 0) back.push(fx0 + DX, top + DY, fx0 + DX + (mid - fx0) * gRaf, top + DY - RH * gRaf, fx1 + DX, top + DY, fx1 + DX + (mid - fx1) * gRaf, top + DY - RH * gRaf);
  if (back.length) OA_beams(c, back, '#b88a56', null, 5.2, 3);
  if (gTop > 0) {                        // short ties between the two frames
    var ties = [fx0, top, fx0 + DX, top + DY];
    if (gTop >= 1) ties.push(fx1, top, fx1 + DX, top + DY);
    if (gRaf >= 1) ties.push(mid, top - RH, mid + DX, top - RH + DY);
    OA_beams(c, ties, '#cf9f66', null, 5.2, 3);
  }
  if (gSill > 0) { front.push(fx0 - 2, fb, fx0 - 2 + (fx1 - fx0 + 4) * gSill, fb); tip(gSill, fx0 - 2 + (fx1 - fx0 + 4) * gSill, fb - 2); }
  for (i = 0; i < n; i++) {
    px = fx0 + (fx1 - fx0) * i / (n - 1); hf = grow(0.08 + i * 0.03, 0.42 + i * 0.03);
    if (hf > 0) front.push(px, fb, px, fb - FH * hf);
    tip(hf, px, fb - FH * hf);
  }
  if (gTop > 0) { front.push(fx0 - 2, top, fx0 - 2 + (fx1 - fx0 + 4) * gTop, top); tip(gTop, fx0 - 2 + (fx1 - fx0 + 4) * gTop, top - 2); }
  if (gBrace > 0) for (i = 0; i < n - 1; i++) {
    var xa = fx0 + (fx1 - fx0) * i / (n - 1), xb = fx0 + (fx1 - fx0) * (i + 1) / (n - 1);
    if (i % 2) front.push(xb, fb, xb + (xa - xb) * gBrace, fb - FH * gBrace); else front.push(xa, fb, xa + (xb - xa) * gBrace, fb - FH * gBrace);
    if (i === 0) tip(gBrace, xa + (xb - xa) * gBrace, fb - FH * gBrace);
  }
  if (gRaf > 0) {
    front.push(fx0 - 2, top, fx0 - 2 + (mid - fx0 + 2) * gRaf, top - RH * gRaf, fx1 + 2, top, fx1 + 2 + (mid - fx1 - 2) * gRaf, top - RH * gRaf);
    if (gRaf > 0.6) front.push(mid, top, mid, top - RH * (gRaf - 0.6) / 0.4);
    tip(gRaf, fx0 - 2 + (mid - fx0 + 2) * gRaf, top - RH * gRaf - 1);
  }
  if (front.length) OA_beams(c, front, '#e8c088', '#f9e0b4', 6.4, 4);
  if (gBoard > 0) {                      // the first boards go on
    var rows = Math.max(1, Math.min(3, Math.floor(FH * 0.5 / 6.4))), bseg = [];
    for (i = 0; i < rows; i++) { g = OA_cl(gBoard * rows - i, 0, 1); if (g > 0) { bseg.push(fx0 - 1, fb - 6.6 - i * 6.4, fx0 - 1 + (fx1 - fx0 + 2) * g, fb - 6.6 - i * 6.4); tip(g, fx0 + (fx1 - fx0) * g, fb - 9 - i * 6.4); } }
    OA_beams(c, bseg, '#d9ab72', '#ecc794', 6.8, 4.6);
  }
  // nail heads at the joints
  c.fillStyle = OA_WD;
  for (i = 0; i < n; i++) {
    px = fx0 + (fx1 - fx0) * i / (n - 1);
    if (gSill > 0 && px <= fx0 + (fx1 - fx0) * gSill + 0.1 && gBoard <= 0) c.fillRect(px - 0.75, fb - 0.75, 1.5, 1.5);
    if (gTop > 0 && px <= fx0 + (fx1 - fx0) * gTop + 0.1) c.fillRect(px - 0.75, top - 0.75, 1.5, 1.5);
  }
  OA_dynAux = [hx, hy];
}
function OA_conBack(c, Wp, Hp, seed) {
  var sx0 = 5.5, sx1 = Wp - 5.5, sy0 = 9.5, sy1 = Hp - 4.5;
  OA_dirtStatic(c, Wp, Hp, seed + 1);
  OA_stake(c, sx0, sy0); OA_stake(c, sx1, sy0);
  OA_string(c, sx0, sy0 - 8, sx1, sy0 - 8, 1.6); OA_string(c, sx0, sy0 - 8, sx0, sy1 - 8, 0); OA_string(c, sx1, sy0 - 8, sx1, sy1 - 8, 0);
}
function OA_conFront(c, Wp, Hp, wt) {
  var sx0 = 5.5, sx1 = Wp - 5.5, sy1 = Hp - 4.5, i;
  // plank stack (front left) and sawhorse (front right)
  if (Wp >= 96) {
    var plx = 13, ply = Hp - 3.5;
    OA_el(c, plx + 13, ply + 0.6, 15, 2.2); OA_f(c, OA_SH);
    for (i = 0; i < 3; i++) {
      var pw = 26 - i * 2, pxx = plx + (i === 1 ? 2.4 : i === 2 ? 0.6 : 0), pyy = ply - 3.6 - i * 3.4;
      OA_rr(c, pxx, pyy, pw, 3.6, 0.8); OA_fo(c, i % 2 ? '#d9ab72' : '#e6bd85', 1.3);
      c.fillStyle = OA_WM; c.fillRect(pxx + pw - 2.4, pyy + 0.9, 1.5, 1.8);
    }
  }
  if (Wp >= 96 && Hp >= 96) {
    var hx0 = Wp - 40, hy0 = Hp - 5;
    OA_el(c, hx0 + 13, hy0 + 0.4, 16, 2.4); OA_f(c, OA_SH);
    OA_beams(c, [hx0 + 4, hy0 - 11, hx0, hy0, hx0 + 6, hy0 - 11, hx0 + 9, hy0, hx0 + 20, hy0 - 11, hx0 + 17, hy0, hx0 + 22, hy0 - 11, hx0 + 26, hy0, hx0 + 1, hy0 - 12, hx0 + 25, hy0 - 12], OA_WL, null);
    OA_rr(c, hx0 - 4, hy0 - 17.6, 30, 3.6, 0.8); OA_fo(c, '#e6bd85', 1.3);
    // hand saw resting in the cut
    OA_pl(c, [hx0 + 12, hy0 - 27, hx0 + 15.4, hy0 - 27.6, hx0 + 19.4, hy0 - 15, hx0 + 17.4, hy0 - 14.6]); OA_fo(c, '#c4beb2', 1.2);
    OA_rr(c, hx0 + 10.4, hy0 - 32, 6.4, 6, 2); OA_fo(c, '#d9574a', 1.3);
  }
  // front stakes + string with little flags
  OA_stake(c, sx0, sy1); OA_stake(c, sx1, sy1);
  OA_string(c, sx0, sy1 - 8, sx1, sy1 - 8, 2.2);
  var nf = Math.max(1, wt * 2 - 1);
  for (i = 0; i < nf; i++) {
    var ff = (i + 1) / (nf + 1), fxx = sx0 + (sx1 - sx0) * ff, fyy = sy1 - 8 + 2.2 * 2 * ff * (1 - ff) + 0.4;
    OA_pl(c, [fxx - 2.2, fyy, fxx + 2.2, fyy, fxx + (i % 2 ? 0.7 : -0.7), fyy + 5]); OA_fo(c, i % 2 ? '#f2c14e' : '#d9574a', 1);
  }
}
function drawConstruction(c, o, t, progress) {
  o = o || {}; t = OA_num(t, 0);
  var p = OA_cl(OA_num(progress, 0), 0, 1), wt = OA_cl(Math.round(OA_num(o.w, 1)), 1, 8), ht = OA_cl(Math.round(OA_num(o.h, 1)), 1, 8);
  var Wp = wt * 48, Hp = ht * 48, id = OA_num(o.id, 0), seed = Math.floor(Math.abs(id * 3 + OA_num(o.x, 0) * 7 + OA_num(o.y, 0) * 13)) % 4, i;
  var G = OA_conGeo(Wp, Hp), size = wt + 'x' + ht, topY = Math.floor(Math.min(-4, G.top + G.DY - G.RH - 8));
  OA_begin(c, o);
  OA_static(c, 'conB' + size + '_' + seed, -2, -4, Wp + 4, Hp + 6, function (g) { OA_conBack(g, Wp, Hp, seed); });
  // the frame is re-rendered only when it has visibly grown
  OA_dynAux = [G.fx0 + 3, G.fb - 2];
  if (p > 0.03) OA_dyn(c, 'conF' + size + ':' + (Math.floor(Math.abs(id)) % 12), Math.floor(p * 150), -3, topY, Wp + 6, Hp - topY, function (g) { OA_conFrame(g, Wp, Hp, p); });
  var hx = OA_dynAux ? OA_dynAux[0] : G.fx0, hy = OA_dynAux ? OA_dynAux[1] : G.fb;
  OA_static(c, 'conA' + size, -2, Hp - 42, Wp + 4, 46, function (g) { OA_conFront(g, Wp, Hp, wt); });
  // topping-out pennant
  if (p > 0.94) OA_sFlag(c, 'cflag', G.mid, G.top - G.RH, t, 1, 10 * OA_cl((p - 0.94) / 0.03, 0.3, 1) > 9 ? 10 : 6, '#d9574a');
  // ---- hammer tapping away (6-pose flip-book) + spark
  if (p < 0.995) {
    var cyc = ((t * 2.3 + id * 0.37) % 1 + 1) % 1, sw = cyc < 0.45 ? Math.pow(cyc / 0.45, 2) : 1 - (cyc - 0.45) / 0.55, pose = Math.round((1 - sw) * 5);
    OA_sprite(c, 'ham' + pose, hx, hy - 3.4, -8, -22, 34, 36, function (g) { OA_hammer(g, 0, 0, 0.95 * pose / 5 + 0.12); });
    if (cyc > 0.4 && cyc < 0.62) {
      var sp = (cyc - 0.4) / 0.22;
      OA_sparkle(c, hx - 2, hy - 4.6, 2.4 + sp * 3.4, 1 - sp, '#fff3c4');
    }
  }
  // ---- dust puffs
  var A0 = c.globalAlpha;
  for (i = 0; i < 3; i++) {
    var dc = t * 0.75 + i * 0.37 + id * 0.11, dp = ((dc % 1) + 1) % 1, dk = Math.floor(dc), ds = dp < 0.33 ? 0 : dp < 0.66 ? 1 : 2;
    c.globalAlpha = A0 * Math.sin(dp * Math.PI) * 0.75;
    OA_sprite(c, 'dust' + ds, G.fx0 + OA_h(dk * 3.3 + i * 1.7) * (G.fx1 - G.fx0), G.fb + 2 - dp * 11, -11, -7, 22, 14, function (g) {
      var dr = 2.6 + ds * 1.4; g.fillStyle = '#f1dfc0';
      g.beginPath(); g.arc(0, 0, dr, 0, OA_TAU); g.arc(dr * 0.9, 0.8, dr * 0.7, 0, OA_TAU); g.arc(-dr * 0.8, 1, dr * 0.6, 0, OA_TAU); g.fill();
    });
  }
  c.globalAlpha = A0;
  c.restore();
}

// =====================================================================================================
//  CARRIED ITEMS
// =====================================================================================================
function drawCarryItem(c, kind, x, y, t) {
  t = OA_num(t, 0); x = OA_num(x, 0); y = OA_num(y, 0);
  if (kind !== 'food' && kind !== 'ball' && kind !== 'treat' && kind !== 'poop') kind = 'parcel';
  c.save(); c.lineJoin = 'round'; c.lineCap = 'round'; c.setLineDash([]);
  OA_sprite(c, 'carry:' + kind, x, y, -13, -13, 26, 26, function (g) { OA_carryArt(g, kind); }, true);
  if (kind === 'treat') { var tw = ((t * 0.9) % 1 + 1) % 1; if (tw < 0.45) OA_sparkle(c, x + 7.4, y - 6.4, 3, Math.sin(tw / 0.45 * Math.PI)); }
  c.restore();
}
function OA_carryArt(c, kind) {
  c.save();
  if (kind === 'food') {
    // bowl heaped with kibble
    OA_el(c, 0, -1.8, 9.6, 2.5); OA_fo(c, '#b9443a', 1.7);
    c.beginPath(); c.moveTo(-7.6, -1.6); c.bezierCurveTo(-6.2, -9.6, 6.2, -9.6, 7.6, -1.6); c.ellipse(0, -1.6, 7.6, 1.9, 0, 0, Math.PI); c.closePath(); OA_fo(c, '#a7713d', 1.4);
    OA_kibble(c, 0, -0.6, 6.8, 7.4, 5, 18);
    c.beginPath(); c.moveTo(-9.6, -1.8); c.quadraticCurveTo(-8.6, 7.6, -5, 7.6); c.lineTo(5, 7.6); c.quadraticCurveTo(8.6, 7.6, 9.6, -1.8); c.ellipse(0, -1.8, 9.6, 2.5, 0, 0, Math.PI); c.closePath(); OA_fo(c, '#d9574a', 1.7);
    c.beginPath(); c.moveTo(-7.6, 4); c.quadraticCurveTo(0, 8, 7.6, 4); c.quadraticCurveTo(7, 7.4, 5, 7.4); c.lineTo(-5, 7.4); c.quadraticCurveTo(-7, 7.4, -7.6, 4); OA_f(c, '#b9443a');
    c.beginPath(); c.ellipse(0, -1.6, 8.4, 2.1, 0, 0.5, 2.2); OA_s(c, '#f08f7f', 1.1);
    OA_bonePath(c, 0, 3.6, 7.6, 2, 0); OA_f(c, OA_CREAM);
  } else if (kind === 'ball') {
    OA_ball(c, 0, 0, 8.4, 0.5);
    c.strokeStyle = 'rgba(120,130,40,0.5)'; c.lineWidth = 0.8; c.beginPath(); c.moveTo(-3, 5.6); c.lineTo(-2.2, 6.6); c.moveTo(3.4, 4.6); c.lineTo(4.4, 5.4); c.moveTo(4.6, -4.6); c.lineTo(5.4, -4); c.stroke();
  } else if (kind === 'treat') {
    c.rotate(-0.45);
    OA_bone(c, 0, 0, 19, 5.8, 0, '#e3b877', 1.6);
    OA_bonePath(c, 0.4, 1.1, 16, 2.6, 0); OA_f(c, '#cf9a55');
    c.fillStyle = '#8a5a2c'; c.fillRect(-3.6, -1.4, 1.3, 1.3); c.fillRect(-0.6, -1.4, 1.3, 1.3); c.fillRect(2.4, -1.4, 1.3, 1.3);
    c.strokeStyle = '#f5dcae'; c.lineWidth = 1; c.beginPath(); c.moveTo(-5, -2.2); c.lineTo(4, -2.2); c.stroke();
  } else if (kind === 'poop') {
    // tied green bag
    c.beginPath(); c.moveTo(-1.4, -4.4); c.quadraticCurveTo(-5.6, -10.4, -7.4, -7.6); c.quadraticCurveTo(-5.4, -5, -1.4, -4.4); c.closePath();
    c.moveTo(1.4, -4.4); c.quadraticCurveTo(4.4, -11, 7, -8.6); c.quadraticCurveTo(5.4, -5.4, 1.4, -4.4); c.closePath();
    OA_fo(c, '#a9d98a', 1.5);
    c.beginPath(); c.moveTo(-2, -4.4); c.bezierCurveTo(-10.4, -2, -9.6, 9, 0, 9); c.bezierCurveTo(9.6, 9, 10.4, -2, 2, -4.4); c.closePath(); OA_fo(c, '#8fce7c', 1.7);
    c.beginPath(); c.moveTo(6.4, 0); c.bezierCurveTo(8, 4, 5, 8.4, 0, 8.4); c.bezierCurveTo(-3, 8.4, -5.6, 7, -6.6, 5); c.bezierCurveTo(-2, 7.4, 5, 6.4, 6.4, 0); OA_f(c, '#68ae5a');
    OA_rr(c, -2.4, -5.8, 4.8, 2.8, 1.2); OA_fo(c, '#68ae5a', 1.3);
    c.beginPath(); c.moveTo(-4.8, -0.6); c.quadraticCurveTo(-6, 2, -5, 4); OA_s(c, '#d2efbf', 1.3);
    OA_paw(c, 0.8, 2.2, 0.78, 'rgba(255,255,255,0.75)', 0.2);
  } else {
    // anything else: a little brown paper parcel tied with string
    OA_rr(c, -8, -6.4, 16, 13.4, 2); OA_fo(c, '#dfc193', 1.7);
    c.fillStyle = '#c8a676'; c.fillRect(3.4, -5.6, 3.8, 11.8);
    c.strokeStyle = '#d9574a'; c.lineWidth = 1.3; c.beginPath(); c.moveTo(-8, 0.2); c.lineTo(8, 0.2); c.moveTo(-0.6, -6.4); c.lineTo(-0.6, 7); c.stroke();
    c.beginPath(); c.moveTo(-0.6, -6.4); c.quadraticCurveTo(-5, -11, -3.6, -6.6); c.moveTo(-0.6, -6.4); c.quadraticCurveTo(4, -11, 2.6, -6.6); OA_s(c, '#d9574a', 1.3);
  }
  c.restore();
}

// =====================================================================================================
//  POOP  (a cheerful little swirl; it gets whiffy after 30 s)
// =====================================================================================================
function OA_poopArt(c, stinky) {
  var base = stinky ? '#7d5a30' : '#8f5e36', dk = stinky ? '#5f4322' : '#6f4526', hi = stinky ? '#a07c46' : '#b27d4e';
  // three tiers and a curl, drawn as one silhouette
  c.beginPath();
  c.moveTo(7, -2.6); c.ellipse(0, -2.6, 7, 3.1, 0, 0, OA_TAU);
  c.moveTo(5, -6); c.ellipse(0.2, -6, 4.8, 2.6, 0, 0, OA_TAU);
  c.moveTo(3, -8.8); c.ellipse(0.2, -8.8, 2.8, 2, 0, 0, OA_TAU);
  c.moveTo(-0.6, -10); c.quadraticCurveTo(0.4, -13.4, 3, -12.4); c.quadraticCurveTo(1.6, -11.4, 2, -9.4); c.closePath();
  OA_of(c, base, 1.5);
  // shade + tier lines + shine
  c.beginPath(); c.ellipse(0, -2.6, 7, 3.1, 0, -0.2, Math.PI * 0.75); c.quadraticCurveTo(1, -1.6, 6.8, -3.4); OA_f(c, dk);
  c.strokeStyle = dk; c.lineWidth = 1.1; c.beginPath(); c.ellipse(0.2, -5.6, 4.8, 2.4, 0, 0.25, Math.PI - 0.5); c.stroke();
  c.beginPath(); c.ellipse(0.2, -8.4, 2.8, 1.8, 0, 0.3, Math.PI - 0.6); c.stroke();
  c.strokeStyle = hi; c.lineWidth = 1.2; c.beginPath(); c.moveTo(-4.6, -3.4); c.quadraticCurveTo(-4, -4.8, -2, -5); c.moveTo(-2.6, -7); c.quadraticCurveTo(-2, -7.8, -1, -8); c.stroke();
}
function drawPoop(c, x, y, age, t, seed) {
  t = OA_num(t, 0); age = OA_num(age, 0); seed = OA_num(seed, 0); x = OA_num(x, 0); y = OA_num(y, 0);
  var flip = OA_h(seed * 1.7 + 3) < 0.5 ? -1 : 1, sv = Math.floor(OA_h(seed * 2.3) * 3), sc = 0.92 + sv * 0.09, stinky = age > 30, i;
  var A0 = c.globalAlpha;
  c.save(); c.translate(x, y); c.lineJoin = 'round'; c.lineCap = 'round'; c.setLineDash([]);
  if (age < 0.35) {
    // plop: squash in
    var pop = 0.5 + 0.5 * Math.sin(OA_cl(age / 0.35, 0, 1) * Math.PI * 0.5) + 0.25 * Math.sin(OA_cl(age / 0.35, 0, 1) * Math.PI);
    OA_el(c, 0.6, 0.4, 8.4 * sc, 2.6 * sc); OA_f(c, OA_SH);
    c.save(); c.scale(sc * flip * (2 - pop), sc * pop); OA_poopArt(c, false); c.restore();
  } else {
    OA_static(c, 'poop' + (stinky ? 'S' : 'F') + (flip < 0 ? 'L' : 'R') + sv, -11, -17, 22, 21, function (g) {
      OA_el(g, 0.6, 0.4, 8.4 * sc, 2.6 * sc); OA_f(g, OA_SH);
      g.save(); g.scale(sc * flip, sc); OA_poopArt(g, stinky); g.restore();
    });
  }
  if (!stinky && age < 6) {
    // fresh: a wisp of steam
    var st = ((t * 0.6 + seed) % 1 + 1) % 1;
    c.globalAlpha = A0 * Math.sin(st * Math.PI) * 0.6 * (1 - age / 6);
    OA_sprite(c, 'steam', 0, -14 - st * 4, -4, -9, 8, 10, function (g) { g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(2.4, -2, 0, -4); g.quadraticCurveTo(-2.4, -6, 0, -8); OA_s(g, '#fffaf0', 1.2); });
    c.globalAlpha = A0;
  }
  if (stinky) {
    // wavy stink lines (a 6-frame wiggle) drifting up and fading
    for (i = 0; i < 3; i++) {
      var sp = ((t * 0.5 + i * 0.33 + OA_h(seed + i)) % 1 + 1) % 1, wf = ((Math.floor(t * 7 + i * 2) % 6) + 6) % 6;
      c.globalAlpha = A0 * Math.sin(sp * Math.PI) * 0.85;
      OA_sprite(c, 'stink' + wf, (i - 1) * 5.2, -13 - sp * 9, -6, -4, 12, 12, function (g) {
        var wv = Math.sin(wf / 6 * OA_TAU) * 1.2;
        g.beginPath(); g.moveTo(0, 6); g.quadraticCurveTo(2.6 + wv, 4, 0, 2); g.quadraticCurveTo(-2.6 - wv, 0, 0, -2);
        OA_s(g, '#56752a', 2.6); OA_s(g, '#a8c94a', 1.3);
      });
    }
    c.globalAlpha = A0;
    // two flies
    for (i = 0; i < 2; i++) {
      var a = t * (3.1 + i * 0.9) + seed * 2 + i * 3, fx = Math.cos(a) * (8 + i * 2.4) + Math.sin(a * 2.7) * 1.6, fy = -10 - i * 3.4 + Math.sin(a * 1.7) * 3.6;
      var up = Math.sin(t * 46 + i) > 0;
      OA_sprite(c, up ? 'flyA' : 'flyB', fx, fy, -4, -4, 8, 7, function (g) {
        var wfl = up ? 1 : 0.45;
        OA_el(g, -1.3, -1.2, 1.5, 0.8 * wfl, -0.7); OA_f(g, 'rgba(226,240,248,0.85)'); OA_el(g, 1.3, -1.2, 1.5, 0.8 * wfl, 0.7); OA_f(g, 'rgba(226,240,248,0.85)');
        OA_el(g, 0, 0, 1.5, 1.25); OA_f(g, OA_OUT);
      });
    }
  }
  c.restore();
}

// =====================================================================================================
//  SHOP ICON: any registered object scaled to fit a size x size box at (x, y)
// =====================================================================================================
function drawObjectIcon(c, type, x, y, size) {
  var art = OBJECT_ART[type];
  if (!art || typeof art.draw !== 'function') return;
  x = OA_num(x, 0); y = OA_num(y, 0); size = OA_num(size, 32);
  var cat = (typeof CAT_BY_ID === 'object' && CAT_BY_ID && CAT_BY_ID[type]) || null, T = OA_tile();
  var w = cat ? cat.w : 1, h = cat ? cat.h : 1, b = art.box;
  if (!b) b = [0, (cat && cat.floor) ? 0 : -Math.min(48, 24 * w), w * 48, h * 48];
  var bw = b[2] - b[0], bh = b[3] - b[1], f = size / Math.max(bw, bh), g = f * 48 / T;
  var o = { type: type, x: -(b[0] + b[2]) / 2 / 48, y: -(b[1] + b[3]) / 2 / 48, w: w, h: h, id: 0, occupied: false, useT: 99, label: null };
  c.save();
  c.translate(x + size / 2, y + size / 2); c.scale(g, g);
  OA_vector++;
  try {
    art.draw(c, o, 0.6, OA_ENV0);
    if (typeof art.drawFront === 'function') art.drawFront(c, o, 0.6, OA_ENV0);
    if (typeof art.drawOver === 'function') art.drawOver(c, o, 0.6, OA_ENV0);
  } finally { OA_vector--; c.restore(); }
}

// Optional: build the cached bitmaps for one device scale (camera zoom * devicePixelRatio) ahead of time,
// so that the first frame showing a new kind of object does not hitch.
function warmObjectArt(scale) {
  if (typeof document === 'undefined') return;
  scale = OA_cl(OA_num(scale, 2), 0.6, 6.4);
  var cv = document.createElement('canvas'); cv.width = 8; cv.height = 8;
  var g = cv.getContext('2d'), T = OA_tile(), type, art, o;
  g.setTransform(scale, 0, 0, scale, 0, 0);
  for (type in OBJECT_ART) {
    art = OBJECT_ART[type];
    if (!art || typeof art.draw !== 'function' || !art.box) continue;      // only this file's entries
    o = { type: type, x: 0, y: 0, w: 1, h: 1, id: 0, occupied: false, useT: 99, label: null };
    try { for (o.id = 0; o.id < 4; o.id++) { art.draw(g, o, 0, OA_ENV0); if (art.drawFront) art.drawFront(g, o, 0, OA_ENV0); } } catch (e) { /* never let a warm-up break the game */ }
  }
  drawPoop(g, 0, 0, 10, 0, 1); drawPoop(g, 0, 0, 40, 0, 1);
  drawCarryItem(g, 'food', 0, 0, 0); drawCarryItem(g, 'ball', 0, 0, 0); drawCarryItem(g, 'treat', 0, 0, 0); drawCarryItem(g, 'poop', 0, 0, 0);
}
