'use strict';
/* ==========================================================================================
   shopart.js — Paws & Play: the shopfront building (floor, walls, roof, furniture, counter)
   Exports (globals):
     drawShopGround(c)          static floor-level art in world px (floor, rugs, decals, side wall tops)
     buildShopProps()           -> [{x, y, w, h, sortY, draw(c, t, state)}]   y-sorted with the characters
                                state = { night 0..1, dayFrac 0..1, bellT s, registerT s, open bool }
     shopLights()               -> [{x, y, r, color}]   warm light pools for dusk
     SHOP_POINTS                { register: {x, y}, bell: {x, y} }   where coins / "ding" particles spawn
     shopArtPrewarm(scale)      optional: bake all sprites for a device scale ahead of time
   Props draw from cached bitmaps (see SPRITE CACHE below); lettering uses the "Jersey 25" face.
   Everything else is private and prefixed SH_.
   ========================================================================================== */

var SH_OUT = '#3b2a20';
var SH_TL = (typeof TILE === 'number' && TILE > 0) ? TILE : 48;

// ---- geometry (world px), derived from MAP.shop when available ----
var SH_G = (function () {
  var s = (typeof MAP === 'object' && MAP && MAP.shop) ? MAP.shop : null;
  var T = SH_TL;
  var g = {
    x0: (s ? s.x0 : 3) * T,                 // outer left
    x1: ((s ? s.x1 : 17) + 1) * T,          // outer right
    yTop: (s ? s.y0 : 18) * T,              // top of wall tiles
    floorY0: ((s ? s.wallFaceY1 : 19) + 1) * T,   // where the floor starts (foot of the back wall)
    frontY0: (s ? s.y1 : 33) * T,           // top of the front wall tile row
    frontY1: ((s ? s.y1 : 33) + 1) * T,     // street side of the front wall
    doorX0: (s ? s.streetDoor.x0 : 9) * T,
    doorX1: ((s ? s.streetDoor.x1 : 10) + 1) * T,
    ydY0: (s ? s.yardDoor.y0 : 23) * T,
    ydY1: ((s ? s.yardDoor.y1 : 24) + 1) * T,
    ctrX0: (s ? s.counter.x0 : 4) * T,
    ctrX1: ((s ? s.counter.x1 : 11) + 1) * T,
    ctrY0: (s ? s.counter.y : 26) * T,
    ctrY1: ((s ? s.counter.y : 26) + 1) * T,
    regX: ((s ? s.counter.registerX : 5) + 0.5) * T,
    bellX: ((s ? s.counter.bellX : 8) + 0.5) * T
  };
  g.ix0 = g.x0 + T;                         // interior left
  g.ix1 = g.x1 - T;                         // interior right
  g.wallY0 = g.floorY0 - 140;               // top of the back wall face (it rises above its two tiles)
  g.eaveY = g.wallY0 - 12;                  // bottom edge of the roof strip
  g.roofY0 = g.eaveY - 64;                  // ridge of the roof strip
  g.shelfY = g.floorY0 + T;                 // base line of the row of furniture against the back wall
  g.cut = 26;                               // height at which side/front walls are cut away
  g.ctrH = 40;                              // counter height
  g.ctrTopY0 = g.ctrY0 - g.ctrH;            // screen y of the back edge of the countertop
  g.ctrTopY1 = g.ctrY1 - g.ctrH;            // screen y of the front edge of the countertop
  return g;
})();

// ---- tiny utilities ----
function SH_h(a, b) { var n = Math.sin(a * 127.1 + b * 311.7 + 17.3) * 43758.5453; return n - Math.floor(n); }
var SH_mixMemo = {};
function SH_rgb(h) {
  if (h.charAt(0) !== '#') return [128, 128, 128];
  h = h.slice(1);
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  var n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function SH_mix(a, b, t) {
  var k = a + b + t, m = SH_mixMemo[k];
  if (m) return m;
  var A = SH_rgb(a), B = SH_rgb(b);
  m = '#' + ((1 << 24) + (Math.round(A[0] + (B[0] - A[0]) * t) << 16) + (Math.round(A[1] + (B[1] - A[1]) * t) << 8) +
    Math.round(A[2] + (B[2] - A[2]) * t)).toString(16).slice(1);
  SH_mixMemo[k] = m;
  return m;
}
function SH_dk(a, t) { return SH_mix(a, '#3b2a20', t === undefined ? 0.25 : t); }
function SH_lt(a, t) { return SH_mix(a, '#fff8e6', t === undefined ? 0.3 : t); }
function SH_clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function SH_num(v, d) { return (typeof v === 'number' && isFinite(v)) ? v : d; }

function SH_begin(c) {
  c.save();
  c.lineJoin = 'round'; c.lineCap = 'round';
  c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
  if (c.setLineDash) c.setLineDash([]);
}
function SH_fs(c, fill, stroke, lw) {
  if (fill) { c.fillStyle = fill; c.fill(); }
  if (stroke !== null) { c.strokeStyle = stroke || SH_OUT; c.lineWidth = lw || 1.8; c.stroke(); }
}
function SH_rrPath(c, x, y, w, h, r) {
  r = Math.max(0, Math.min(r || 0, w / 2, h / 2));
  c.beginPath();
  c.moveTo(x + r, y); c.lineTo(x + w - r, y); c.quadraticCurveTo(x + w, y, x + w, y + r);
  c.lineTo(x + w, y + h - r); c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  c.lineTo(x + r, y + h); c.quadraticCurveTo(x, y + h, x, y + h - r);
  c.lineTo(x, y + r); c.quadraticCurveTo(x, y, x + r, y);
  c.closePath();
}
// rectangle: fill, outline (null = none, undefined = default outline), line width, corner radius
function SH_rect(c, x, y, w, h, fill, stroke, lw, r) {
  if (r) SH_rrPath(c, x, y, w, h, r); else { c.beginPath(); c.rect(x, y, w, h); }
  SH_fs(c, fill, stroke, lw);
}
function SH_fill(c, x, y, w, h, fill) { c.fillStyle = fill; c.fillRect(x, y, w, h); }
function SH_line(c, x1, y1, x2, y2, col, lw) {
  c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2);
  c.strokeStyle = col || SH_OUT; c.lineWidth = lw || 1.2; c.stroke();
}
function SH_ell(c, x, y, rx, ry, fill, stroke, lw, rot) {
  c.beginPath(); c.ellipse(x, y, Math.max(0.01, rx), Math.max(0.01, ry), rot || 0, 0, Math.PI * 2);
  SH_fs(c, fill, stroke, lw);
}
function SH_poly(c, pts, fill, stroke, lw, open) {
  c.beginPath(); c.moveTo(pts[0], pts[1]);
  for (var i = 2; i < pts.length; i += 2) c.lineTo(pts[i], pts[i + 1]);
  if (!open) c.closePath();
  SH_fs(c, fill, stroke, lw);
}
function SH_shadow(c, x, y, rx, ry, a) {
  c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  c.fillStyle = 'rgba(40,26,12,' + (a === undefined ? 0.22 : a) + ')'; c.fill();
}
// lettering in the game's display face
function SH_txt(c, s, x, y, size, fill, align, strokeCol, strokeW) {
  if (typeof SH_CACHE === 'object') SH_CACHE.usedText = true;
  c.font = size + 'px "Jersey 25", sans-serif';
  c.textAlign = align || 'center'; c.textBaseline = 'middle';
  if (strokeCol) { c.lineWidth = strokeW || 2; c.strokeStyle = strokeCol; c.strokeText(s, x, y); }
  c.fillStyle = fill; c.fillText(s, x, y);
}
// paw print centred on x,y; s = half size; pads point "up" (rot radians)
function SH_paw(c, x, y, s, col, rot, alpha) {
  c.save(); c.translate(x, y); if (rot) c.rotate(rot);
  if (alpha !== undefined) c.globalAlpha = alpha;
  c.fillStyle = col;
  c.beginPath();
  c.moveTo(0, -0.05 * s);
  c.bezierCurveTo(0.5 * s, -0.25 * s, 0.95 * s, 0.35 * s, 0.62 * s, 0.78 * s);
  c.bezierCurveTo(0.4 * s, 1.02 * s, 0.16 * s, 0.74 * s, 0, 0.78 * s);
  c.bezierCurveTo(-0.16 * s, 0.74 * s, -0.4 * s, 1.02 * s, -0.62 * s, 0.78 * s);
  c.bezierCurveTo(-0.95 * s, 0.35 * s, -0.5 * s, -0.25 * s, 0, -0.05 * s);
  c.fill();
  var toes = [[-0.78, -0.18, 0.24, 0.32, -0.45], [-0.3, -0.68, 0.25, 0.34, -0.12], [0.3, -0.68, 0.25, 0.34, 0.12], [0.78, -0.18, 0.24, 0.32, 0.45]];
  for (var i = 0; i < 4; i++) {
    var q = toes[i];
    c.beginPath(); c.ellipse(q[0] * s, q[1] * s, q[2] * s, q[3] * s, q[4], 0, Math.PI * 2); c.fill();
  }
  c.restore();
}
// dog bone, centred, total width w and height h
function SH_bonePath(c, x, y, w, h) {
  // union of a shaft and four knobs (nonzero fill; outline is made by stroking underneath)
  var r = h * 0.3, hx = w / 2 - r, sh = h * 0.2, i;
  c.beginPath();
  c.rect(x - hx, y - sh, hx * 2, sh * 2);
  for (i = 0; i < 4; i++) {
    var kx = x + (i < 2 ? -hx : hx), ky = y + (i % 2 ? 1 : -1) * h * 0.2;
    c.moveTo(kx + r, ky); c.arc(kx, ky, r, 0, Math.PI * 2);
  }
}
function SH_bone(c, x, y, w, h, fill, stroke, lw, rot) {
  c.save(); c.translate(x, y); if (rot) c.rotate(rot);
  if (stroke) { SH_bonePath(c, 0, 0, w, h); c.strokeStyle = stroke; c.lineWidth = (lw || 1.2) * 2; c.stroke(); }
  SH_bonePath(c, 0, 0, w, h); c.fillStyle = fill; c.fill();
  c.restore();
}
// a box seen in 3/4 view: front face (x, yb-h .. yb) and top face of depth d above it
function SH_block(c, x, yb, w, h, d, front, top, lw) {
  SH_rect(c, x, yb - h - d, w, d, top, undefined, lw);
  SH_rect(c, x, yb - h, w, h, front, undefined, lw);
}
// wood grain streaks inside a rectangle (deterministic)
function SH_grain(c, x, y, w, h, col, n, seed, vert) {
  c.strokeStyle = col; c.lineWidth = 1;
  for (var i = 0; i < n; i++) {
    var a = SH_h(i, seed), b = SH_h(i + 9, seed + 5), l = 0.25 + SH_h(i, seed + 2) * 0.4;
    c.beginPath();
    if (vert) { var gx = x + 2 + a * (w - 4), gy = y + b * h * (1 - l); c.moveTo(gx, gy); c.lineTo(gx, gy + h * l); }
    else { var hy = y + 2 + a * (h - 4), hx = x + b * w * (1 - l); c.moveTo(hx, hy); c.lineTo(hx + w * l, hy); }
    c.stroke();
  }
}
function SH_star(c, x, y, r, col) {
  c.beginPath();
  for (var i = 0; i < 10; i++) {
    var a = -Math.PI / 2 + i * Math.PI / 5, rr = (i % 2) ? r * 0.45 : r;
    c.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  c.closePath(); c.fillStyle = col; c.fill();
}

// =========================================================================================
// GROUND: floor, rugs, decals, side wall tops
// =========================================================================================
function SH_plankFloor(c, x0, y0, x1, y1) {
  var cols = ['#cd9d66', '#c6945d', '#d2a36c', '#c18d57', '#ca9961'];
  var bh = 12, r = 0, g;
  for (var y = y0; y < y1; y += bh, r++) {
    var hh = Math.min(bh, y1 - y);
    var x = x0 - SH_h(r, 3) * 90, k = 0;
    while (x < x1) {
      var len = 64 + SH_h(r * 7 + k, 11) * 90;
      var xa = Math.max(x, x0), xb = Math.min(x + len, x1), bw = xb - xa;
      SH_fill(c, xa, y, bw, hh, cols[Math.floor(SH_h(r * 13 + k, 29) * cols.length)]);
      c.strokeStyle = 'rgba(122,78,42,0.17)'; c.lineWidth = 1;
      for (g = 0; g < 2; g++) {
        var gy = y + 3 + g * 5 + SH_h(k + g, r) * 1.5, gx = xa + SH_h(g, r * 5 + k) * bw * 0.5, gl = bw * (0.2 + SH_h(g + 4, r + k) * 0.3);
        c.beginPath(); c.moveTo(gx, gy); c.lineTo(gx + gl, gy); c.stroke();
      }
      if (SH_h(r * 3 + k, 77) > 0.86 && bw > 34) {
        var kx = xa + 12 + SH_h(k, r + 50) * (bw - 24);
        SH_ell(c, kx, y + hh / 2, 3, 1.8, 'rgba(122,78,42,0.28)', null);
        SH_ell(c, kx, y + hh / 2, 1.2, 0.8, 'rgba(90,56,30,0.45)', null);
      }
      if (x > x0) {
        SH_fill(c, xa - 0.6, y, 1.2, hh, 'rgba(90,56,30,0.5)');
        SH_fill(c, xa + 2.5, y + 2.5, 1.2, 1.2, 'rgba(90,56,30,0.45)'); SH_fill(c, xa + 2.5, y + hh - 4.5, 1.2, 1.2, 'rgba(90,56,30,0.45)');
        SH_fill(c, xa - 4, y + 2.5, 1.2, 1.2, 'rgba(90,56,30,0.45)'); SH_fill(c, xa - 4, y + hh - 4.5, 1.2, 1.2, 'rgba(90,56,30,0.45)');
      }
      x += len; k++;
    }
    SH_fill(c, x0, y, x1 - x0, 1, 'rgba(255,238,205,0.22)');
    SH_fill(c, x0, y + hh - 1, x1 - x0, 1, 'rgba(90,56,30,0.38)');
  }
}
function SH_tileFloor(c, x0, y0, x1, y1) {
  var s = 24, iy = 0;
  for (var y = y0; y < y1; y += s, iy++) {
    var ix = 0;
    for (var x = x0; x < x1; x += s, ix++) {
      var a = (ix + iy) & 1, v = SH_h(ix, iy + 40);
      var col = a ? SH_mix('#e9cfa4', '#dcbd8d', v * 0.5) : SH_mix('#f8ecd2', '#efdfbd', v * 0.6);
      var w = Math.min(s, x1 - x), h = Math.min(s, y1 - y);
      SH_fill(c, x, y, w, h, col);
      SH_fill(c, x + 1, y + 1, w - 2, 1.2, 'rgba(255,252,240,0.45)');
      SH_fill(c, x + 1, y + 1, 1.2, h - 2, 'rgba(255,252,240,0.3)');
      if (v > 0.965) { // hairline crack / scuff
        c.strokeStyle = 'rgba(150,110,70,0.28)'; c.lineWidth = 0.8; c.beginPath();
        c.moveTo(x + 5, y + h - 6); c.lineTo(x + 10, y + h - 10); c.lineTo(x + 15, y + h - 9); c.stroke();
      }
    }
  }
  c.fillStyle = 'rgba(150,108,66,0.42)';
  for (var gx = x0; gx <= x1; gx += s) c.fillRect(gx - 0.5, y0, 1, y1 - y0);
  for (var gy = y0; gy <= y1; gy += s) c.fillRect(x0, gy - 0.5, x1 - x0, 1);
}
// top of a cut-away wall running north-south (x .. x+48): a heavy timber cap
function SH_wallTopV(c, x, ya, yb) {
  var T = SH_TL;
  SH_fill(c, x, ya, T, yb - ya, '#7a4e2a');
  SH_fill(c, x + 1.5, ya, 2.2, yb - ya, '#9c6a38');
  SH_fill(c, x + 8, ya, T - 16, yb - ya, '#a8743f');
  SH_fill(c, x + 9, ya, 2.4, yb - ya, '#c9935a');
  SH_fill(c, x + T - 15, ya, 7, yb - ya, '#96663a');
  c.save(); c.beginPath(); c.rect(x + 8, ya, T - 16, yb - ya); c.clip();
  var first = Math.floor(ya / 96) * 96;
  for (var ty = first; ty < yb + 96; ty += 96) {
    var jy = ty + 30 + SH_h(ty, x) * 30;
    SH_fill(c, x + 8, jy - 0.6, T - 16, 1.2, '#5e3c22'); SH_fill(c, x + 9, jy + 0.6, T - 18, 1, 'rgba(255,230,190,0.25)');
    SH_fill(c, x + 13, jy - 4.5, 1.6, 1.6, '#5e3c22'); SH_fill(c, x + T - 15, jy - 4.5, 1.6, 1.6, '#5e3c22');
    SH_fill(c, x + 13, jy + 3.5, 1.6, 1.6, '#5e3c22'); SH_fill(c, x + T - 15, jy + 3.5, 1.6, 1.6, '#5e3c22');
    c.strokeStyle = 'rgba(94,60,34,0.3)'; c.lineWidth = 1;
    for (var g = 0; g < 3; g++) { var gx = x + 14 + g * 8 + SH_h(g, ty) * 3, gy = ty + SH_h(g + 3, ty) * 50; c.beginPath(); c.moveTo(gx, gy); c.lineTo(gx, gy + 22 + SH_h(g, ty + 1) * 20); c.stroke(); }
  }
  c.restore();
  SH_line(c, x + 8, ya, x + 8, yb, '#5e3c22', 1.2);
  SH_line(c, x + T - 8, ya, x + T - 8, yb, '#5e3c22', 1.2);
  SH_line(c, x, ya, x, yb, SH_OUT, 2);
  SH_line(c, x + T, ya, x + T, yb, SH_OUT, 2);
}
// top of a cut-away wall running east-west (y .. y+48)
function SH_wallTopH(c, y, xa, xb) {
  var T = SH_TL;
  SH_fill(c, xa, y, xb - xa, T, '#7a4e2a');
  SH_fill(c, xa, y + 1.5, xb - xa, 2.2, '#9c6a38');
  SH_fill(c, xa, y + 8, xb - xa, T - 16, '#a8743f');
  SH_fill(c, xa, y + 9, xb - xa, 2.4, '#c9935a');
  SH_fill(c, xa, y + T - 15, xb - xa, 7, '#96663a');
  c.save(); c.beginPath(); c.rect(xa, y + 8, xb - xa, T - 16); c.clip();
  var first = Math.floor(xa / 96) * 96;
  for (var tx = first; tx < xb + 96; tx += 96) {
    var jx = tx + 30 + SH_h(tx, y) * 30;
    SH_fill(c, jx - 0.6, y + 8, 1.2, T - 16, '#5e3c22');
    SH_fill(c, jx - 4.5, y + 13, 1.6, 1.6, '#5e3c22'); SH_fill(c, jx + 3.5, y + 13, 1.6, 1.6, '#5e3c22');
    SH_fill(c, jx - 4.5, y + T - 15, 1.6, 1.6, '#5e3c22'); SH_fill(c, jx + 3.5, y + T - 15, 1.6, 1.6, '#5e3c22');
  }
  c.restore();
  SH_line(c, xa, y + 8, xb, y + 8, '#5e3c22', 1.2);
  SH_line(c, xa, y + T - 8, xb, y + T - 8, '#5e3c22', 1.2);
  SH_line(c, xa, y, xb, y, SH_OUT, 2);
  SH_line(c, xa, y + T, xb, y + T, SH_OUT, 2);
}
function SH_bristleMat(c, x, y, w, h) {                 // "wipe your paws" mat at the yard door
  SH_rect(c, x, y, w, h, '#6f8a5c', SH_OUT, 1.8, 4);
  SH_rect(c, x + 3.5, y + 3.5, w - 7, h - 7, '#86a26d', '#4f6a42', 1, 2.5);
  c.fillStyle = 'rgba(60,90,50,0.35)';
  for (var i = 0; i < 70; i++) c.fillRect(x + 5 + SH_h(i, 61) * (w - 11), y + 5 + SH_h(i, 67) * (h - 11), 1.2, 1.2);
  SH_paw(c, x + w / 2 - 6, y + h * 0.22, 4.6, '#f3e5c6', Math.PI / 2 + 0.15);
  SH_paw(c, x + w / 2 + 6, y + h * 0.42, 4.6, '#f3e5c6', Math.PI / 2 - 0.15);
  SH_paw(c, x + w / 2 - 6, y + h * 0.62, 4.6, '#f3e5c6', Math.PI / 2 + 0.15);
  SH_paw(c, x + w / 2 + 6, y + h * 0.82, 4.6, '#f3e5c6', Math.PI / 2 - 0.15);
}
function SH_rug(c, x, y, w, h) {
  var i, yy, xx;
  // fringe
  for (yy = y + 6; yy < y + h - 4; yy += 5) {
    SH_line(c, x - 8, yy + 0.5, x + 1, yy, SH_OUT, 3);
    SH_line(c, x + w - 1, yy, x + w + 8, yy + 0.5, SH_OUT, 3);
  }
  for (yy = y + 6; yy < y + h - 4; yy += 5) {
    SH_line(c, x - 8, yy + 0.5, x + 1, yy, '#f3e3bd', 1.6);
    SH_line(c, x + w - 1, yy, x + w + 8, yy + 0.5, '#f3e3bd', 1.6);
  }
  SH_rect(c, x, y, w, h, '#2f857a', SH_OUT, 2, 7);
  SH_rect(c, x + 6, y + 6, w - 12, h - 12, '#f6e7c3', '#2a6f66', 1, 5);
  // little red diamonds along the cream band
  c.fillStyle = '#d9574a';
  for (xx = x + 22; xx < x + w - 16; xx += 16) {
    for (i = 0; i < 2; i++) {
      yy = i ? y + h - 11 : y + 11;
      c.beginPath(); c.moveTo(xx, yy - 3); c.lineTo(xx + 3.5, yy); c.lineTo(xx, yy + 3); c.lineTo(xx - 3.5, yy); c.closePath(); c.fill();
    }
  }
  for (yy = y + 24; yy < y + h - 18; yy += 16) {
    for (i = 0; i < 2; i++) {
      xx = i ? x + w - 11 : x + 11;
      c.beginPath(); c.moveTo(xx, yy - 3.5); c.lineTo(xx + 3, yy); c.lineTo(xx, yy + 3.5); c.lineTo(xx - 3, yy); c.closePath(); c.fill();
    }
  }
  SH_rect(c, x + 16, y + 16, w - 32, h - 32, '#4fae9f', '#2a6f66', 1.2, 4);
  // woven texture
  c.strokeStyle = 'rgba(255,255,255,0.10)'; c.lineWidth = 1;
  for (yy = y + 20; yy < y + h - 18; yy += 4) { c.beginPath(); c.moveTo(x + 18, yy); c.lineTo(x + w - 18, yy); c.stroke(); }
  // shade lower/right inside field
  SH_fill(c, x + 17, y + h - 22, w - 34, 5, 'rgba(30,80,74,0.25)');
  // zig-zag inner border
  c.strokeStyle = '#f6e7c3'; c.lineWidth = 1.4; c.beginPath();
  for (xx = x + 24, i = 0; xx <= x + w - 24; xx += 8, i++) { var zy = y + 23 + (i % 2) * 4; if (i) c.lineTo(xx, zy); else c.moveTo(xx, zy); }
  c.stroke(); c.beginPath();
  for (xx = x + 24, i = 0; xx <= x + w - 24; xx += 8, i++) { var zy2 = y + h - 23 - (i % 2) * 4; if (i) c.lineTo(xx, zy2); else c.moveTo(xx, zy2); }
  c.stroke();
  // centre medallion with paw, bones either side
  var cx = x + w / 2, cy = y + h / 2;
  SH_ell(c, cx, cy, 42, 30, '#f6e7c3', '#2a6f66', 1.4);
  SH_ell(c, cx, cy, 36, 25, null, '#d9574a', 1.4);
  SH_paw(c, cx, cy - 1, 15, '#d9574a');
  SH_bone(c, cx - 92, cy, 44, 17, '#f6e7c3', '#2a6f66', 1.2, -0.12);
  SH_bone(c, cx + 92, cy, 44, 17, '#f6e7c3', '#2a6f66', 1.2, 0.12);
}
function SH_runner(c, x, y, w, h) { // striped woven runner behind the counter
  var xx;
  for (var yy = y + 4; yy < y + h - 2; yy += 4) {
    SH_line(c, x - 6, yy, x, yy, SH_OUT, 2.6); SH_line(c, x + w, yy, x + w + 6, yy, SH_OUT, 2.6);
    SH_line(c, x - 6, yy, x, yy, '#f3e3bd', 1.4); SH_line(c, x + w, yy, x + w + 6, yy, '#f3e3bd', 1.4);
  }
  SH_rect(c, x, y, w, h, '#c9694a', SH_OUT, 1.8, 3);
  SH_fill(c, x + 2, y + 5, w - 4, 4, '#f6e7c3'); SH_fill(c, x + 2, y + h - 9, w - 4, 4, '#f6e7c3');
  SH_fill(c, x + 2, y + 11, w - 4, 2, '#f2c14e'); SH_fill(c, x + 2, y + h - 13, w - 4, 2, '#f2c14e');
  c.fillStyle = '#b5553a';
  for (xx = x + 14; xx < x + w - 8; xx += 20) {
    c.beginPath(); c.moveTo(xx, y + h / 2 - 4); c.lineTo(xx + 5, y + h / 2); c.lineTo(xx, y + h / 2 + 4); c.lineTo(xx - 5, y + h / 2); c.closePath(); c.fill();
  }
  c.strokeStyle = 'rgba(255,255,255,0.10)'; c.lineWidth = 1;
  for (xx = x + 4; xx < x + w - 2; xx += 4) { c.beginPath(); c.moveTo(xx, y + 2); c.lineTo(xx, y + h - 2); c.stroke(); }
}
function SH_ovalRug(c, cx, cy, rx, ry) {
  SH_ell(c, cx, cy, rx, ry, '#d9a441', SH_OUT, 1.8);
  SH_ell(c, cx, cy, rx * 0.82, ry * 0.8, '#f6e7c3', '#a8743f', 1);
  SH_ell(c, cx, cy, rx * 0.64, ry * 0.6, '#d9574a', '#a8743f', 1);
  SH_ell(c, cx, cy, rx * 0.44, ry * 0.4, '#f6e7c3', '#a8743f', 1);
  SH_ell(c, cx, cy, rx * 0.22, ry * 0.2, '#d9a441', '#a8743f', 1);
  c.strokeStyle = 'rgba(122,78,42,0.25)'; c.lineWidth = 0.8;
  for (var i = 0; i < 28; i++) { var a = i / 28 * Math.PI * 2; c.beginPath(); c.moveTo(cx + Math.cos(a) * rx * 0.84, cy + Math.sin(a) * ry * 0.82); c.lineTo(cx + Math.cos(a) * rx * 0.97, cy + Math.sin(a) * ry * 0.97); c.stroke(); }
}
function SH_pawTrail(c, pts, col) {
  // walk along the polyline dropping alternating left/right prints
  var step = 21, carry = 10, n = 0;
  for (var i = 0; i + 3 < pts.length; i += 2) {
    var ax = pts[i], ay = pts[i + 1], bx = pts[i + 2], by = pts[i + 3];
    var dx = bx - ax, dy = by - ay, L = Math.sqrt(dx * dx + dy * dy) || 1, ux = dx / L, uy = dy / L;
    var d = carry;
    while (d < L) {
      var side = (n % 2) ? 6 : -6;
      var px = ax + ux * d - uy * side, py = ay + uy * d + ux * side;
      SH_paw(c, px, py, 5.2, col, Math.atan2(uy, ux) + Math.PI / 2 + (n % 2 ? 0.12 : -0.12));
      d += step; n++;
    }
    carry = d - L;
  }
}
function SH_floorScale(c, x, y) { // flat walk-on weighing scale, 76 x 50
  SH_rect(c, x + 20, y - 13, 36, 16, '#ece6da', SH_OUT, 1.8, 4);              // read-out head
  SH_rect(c, x + 25, y - 9.5, 26, 8, '#2f4a3c', '#3b2a20', 1, 2);
  c.fillStyle = '#9fe38c';                                                     // little LCD digits "0.0"
  var d = [[x + 30, y - 8], [x + 37, y - 8], [x + 45, y - 8]];
  for (var i = 0; i < 3; i++) { c.fillRect(d[i][0], d[i][1], 4, 1); c.fillRect(d[i][0], d[i][1] + 4, 4, 1); c.fillRect(d[i][0], d[i][1], 1, 5); c.fillRect(d[i][0] + 3, d[i][1], 1, 5); }
  c.fillRect(x + 42.5, y - 4, 1, 1);
  SH_rect(c, x, y, 76, 50, '#c9c3b6', SH_OUT, 1.8, 7);                         // steel platform
  SH_fill(c, x + 4, y + 44, 68, 3, '#a39d90');
  SH_rect(c, x + 5, y + 5, 66, 38, '#52737a', '#35525a', 1.2, 5);              // rubber mat
  c.strokeStyle = 'rgba(255,255,255,0.13)'; c.lineWidth = 1;
  for (var yy = y + 9; yy < y + 42; yy += 4) { c.beginPath(); c.moveTo(x + 8, yy); c.lineTo(x + 68, yy); c.stroke(); }
  SH_paw(c, x + 38, y + 23, 10, '#86aab0', 0);
  SH_fill(c, x + 8, y + 7, 26, 1.5, 'rgba(255,255,255,0.25)');
}
function SH_waterBowl(c, x, y) { // guests' water bowl on a little mat; x,y = centre
  SH_rect(c, x - 23, y - 11, 46, 24, '#7fc3b8', SH_OUT, 1.6, 5);
  SH_rect(c, x - 20, y - 8, 40, 18, null, '#f6e7c3', 1, 4);
  SH_bone(c, x + 13, y + 6, 9, 4, '#f6e7c3', null);
  SH_ell(c, x - 3, y + 2, 13.5, 8, '#b8463c', SH_OUT, 1.6);                    // bowl side
  SH_ell(c, x - 3, y - 0.5, 13, 7, '#d9574a', SH_OUT, 1.4);                    // rim
  SH_ell(c, x - 3, y, 10, 5, '#66bde3', '#3f8fc4', 1);                         // water
  SH_ell(c, x - 6, y - 1.5, 3.5, 1.3, 'rgba(255,255,255,0.75)', null);
  SH_ell(c, x + 12.5, y - 6.5, 1.6, 1, '#a9dcf0', null); SH_ell(c, x + 16, y - 3, 1, 0.7, '#a9dcf0', null);
}
function SH_sill(c, x, y, w, h, horiz) { // stone door sill
  SH_rect(c, x, y, w, h, '#c6c0b2', SH_OUT, 1.8);
  if (horiz) {
    SH_fill(c, x + 1, y + 1, w - 2, 2, '#e0dbcf'); SH_fill(c, x + 1, y + h - 5, w - 2, 4, '#a49e92');
    SH_line(c, x + w / 2, y + 1, x + w / 2, y + h - 1, '#918b80', 1.2);
    SH_line(c, x + 1, y + h * 0.45, x + w - 1, y + h * 0.45, 'rgba(145,139,128,0.5)', 1);
  } else {
    SH_fill(c, x + 1, y + 1, 2, h - 2, '#e0dbcf'); SH_fill(c, x + w - 5, y + 1, 4, h - 2, '#a49e92');
    SH_line(c, x + 1, y + h / 2, x + w - 1, y + h / 2, '#918b80', 1.2);
  }
  c.fillStyle = 'rgba(120,114,104,0.5)';
  for (var i = 0; i < 9; i++) c.fillRect(x + 4 + SH_h(i, x) * (w - 8), y + 4 + SH_h(i, y) * (h - 10), 1.4, 1.4);
}

function drawShopGround(c) {
  var G = SH_G, T = SH_TL;
  SH_begin(c);
  // foundation under everything (walls are props drawn on top)
  SH_fill(c, G.x0, G.eaveY, G.x1 - G.x0, G.frontY1 - G.eaveY, '#5e3c22');
  // floors
  SH_plankFloor(c, G.ix0, G.floorY0, G.ix1, G.ctrY1);
  SH_tileFloor(c, G.ix0, G.ctrY1, G.ix1, G.frontY0);
  // brass strip where planks meet tile, across the open passage
  SH_rect(c, G.ctrX1, G.ctrY1 - 2.5, G.ix1 - G.ctrX1, 5, '#d9a441', '#7a5a1e', 1);
  SH_fill(c, G.ctrX1 + 1, G.ctrY1 - 1.8, G.ix1 - G.ctrX1 - 2, 1.2, '#f6dc8c');
  for (var sx = G.ctrX1 + 12; sx < G.ix1; sx += 36) SH_ell(c, sx, G.ctrY1, 1, 1, '#7a5a1e', null);
  // soft contact shadows cast by furniture and walls
  SH_fill(c, G.ix0, G.shelfY, G.ix1 - G.ix0, 5, 'rgba(40,26,12,0.20)');
  SH_fill(c, G.ix0, G.shelfY + 5, G.ix1 - G.ix0, 5, 'rgba(40,26,12,0.09)');
  SH_fill(c, G.ix0, G.floorY0, 5, G.frontY0 - G.floorY0, 'rgba(40,26,12,0.16)');
  SH_fill(c, G.ix0 + 5, G.floorY0, 5, G.frontY0 - G.floorY0, 'rgba(40,26,12,0.07)');
  SH_fill(c, G.ctrX0, G.ctrY1, G.ctrX1 - G.ctrX0 + 6, 5, 'rgba(40,26,12,0.20)');
  SH_fill(c, G.ctrX0, G.ctrY1 + 5, G.ctrX1 - G.ctrX0 + 6, 5, 'rgba(40,26,12,0.09)');
  // staff side: runner behind the counter, braided rug at the desk
  SH_runner(c, G.ctrX0 + 26, G.ctrY0 - 96, G.ctrX1 - G.ctrX0 - 58, 36);
  SH_ovalRug(c, G.ix0 + 9.5 * T + 4, G.shelfY + 34, 44, 20);
  // customer side: big rug, paw trail from the door to the counter, scale, water bowl
  var mx = (G.doorX0 + G.doorX1) / 2;
  SH_rug(c, mx - 150, G.ctrY1 + 76, 300, 138);
  SH_pawTrail(c, [mx - 52, G.frontY0 - 20, mx - 110, G.frontY0 - 30, mx - 172, G.frontY0 - 40, mx - 200, G.frontY0 - 90, mx - 204, G.ctrY1 + 130,
    mx - 200, G.ctrY1 + 60, mx - 184, G.ctrY1 + 24], 'rgba(201,105,74,0.5)');
  SH_floorScale(c, G.ix1 - 2 * T - 84, G.ctrY1 + 132);
  SH_waterBowl(c, G.ix0 + T + 30, G.frontY0 - 40);
  SH_bristleMat(c, G.ix1 - 44, G.ydY0 + 10, 38, G.ydY1 - G.ydY0 - 20);
  // door sills
  SH_sill(c, G.doorX0, G.frontY0, G.doorX1 - G.doorX0, T, true);
  SH_sill(c, G.ix1, G.ydY0, T, G.ydY1 - G.ydY0, false);
  // side wall tops (walls are cut away at knee height; their tops are shifted up by that height)
  SH_wallTopV(c, G.x0, G.floorY0 - G.cut, G.frontY0);
  SH_wallTopV(c, G.ix1, G.floorY0 - G.cut, G.ydY0 - G.cut);
  SH_rect(c, G.ix1, G.ydY0 - G.cut, T, G.cut, '#7a4e2a', SH_OUT, 2);          // end face of the wall at the yard door
  SH_fill(c, G.ix1 + 2, G.ydY0 - G.cut + 2, 3, G.cut - 4, '#a8743f');
  SH_wallTopV(c, G.ix1, G.ydY1, G.frontY0);
  c.restore();
}

// =========================================================================================
// PET SUPPLIES and small things (all drawn standing on a base line yb)
// =========================================================================================
function SH_bag(c, x, yb, w, h, col, label) {           // kibble sack
  c.beginPath();
  c.moveTo(x + 0.5, yb); c.lineTo(x + w - 0.5, yb); c.quadraticCurveTo(x + w + 0.8, yb - h * 0.5, x + w - 1, yb - h + 3);
  c.lineTo(x + w - 1.5, yb - h); c.lineTo(x + 1.5, yb - h); c.lineTo(x + 1, yb - h + 3); c.quadraticCurveTo(x - 0.8, yb - h * 0.5, x + 0.5, yb); c.closePath();
  SH_fs(c, col, SH_OUT, 1.3);
  SH_fill(c, x + w * 0.7, yb - h + 4, w * 0.3 - 1.2, h - 5, SH_dk(col, 0.2));
  SH_fill(c, x + 1.8, yb - h + 4, 1.3, h - 7, SH_lt(col, 0.35));
  SH_fill(c, x + 1.8, yb - h + 0.8, w - 3.6, 2.6, SH_dk(col, 0.28));
  c.fillStyle = SH_lt(col, 0.5); for (var i = x + 3; i < x + w - 3; i += 3) c.fillRect(i, yb - h + 1.7, 1.4, 0.9);
  var cy = yb - h * 0.48, r = Math.min(w * 0.34, h * 0.24);
  SH_ell(c, x + w / 2, cy, r, r, '#fbf1d8', SH_dk(col, 0.35), 0.8);
  if (label === 'bone') SH_bone(c, x + w / 2, cy, r * 1.4, r * 0.62, col, null);
  else SH_paw(c, x + w / 2, cy - r * 0.08, r * 0.56, col);
  SH_fill(c, x + w * 0.22, yb - h * 0.2, w * 0.56, 1.4, '#fbf1d8');
}
function SH_can(c, x, yb, w, h, col) {                  // tinned food
  SH_rect(c, x, yb - h, w, h, '#cfc9bc', SH_OUT, 1, 1.2);
  SH_fill(c, x + 0.8, yb - h + 2, w - 1.6, h - 4, col);
  SH_fill(c, x + w * 0.68, yb - h + 2, w * 0.32 - 0.8, h - 4, SH_dk(col, 0.22));
  SH_ell(c, x + w * 0.45, yb - h / 2, w * 0.24, Math.min(h * 0.22, w * 0.24), '#fbf1d8', null);
  SH_fill(c, x + 1, yb - h + 0.7, w - 2, 0.9, '#f2efe8');
}
function SH_treatBox(c, x, yb, w, h, col) {
  SH_rect(c, x, yb - h, w, h, col, SH_OUT, 1.2, 1);
  SH_fill(c, x + w * 0.72, yb - h + 1, w * 0.28 - 0.8, h - 2, SH_dk(col, 0.2));
  SH_fill(c, x + 0.8, yb - h + 0.8, w - 1.6, 2.6, SH_lt(col, 0.4));
  SH_bone(c, x + w / 2, yb - h * 0.5, w * 0.72, w * 0.34, '#fbf1d8', SH_dk(col, 0.4), 0.5, -0.35);
  SH_fill(c, x + 2, yb - 4, w - 4, 1.2, SH_dk(col, 0.3));
}
function SH_ball(c, x, y, r, col) {                     // tennis / rubber ball
  SH_ell(c, x, y, r, r, col || '#cfe04f', SH_OUT, 1.1);
  c.beginPath(); c.arc(x - r * 1.1, y - r * 0.2, r * 1.05, -0.75, 0.85); c.strokeStyle = 'rgba(255,255,255,0.8)'; c.lineWidth = Math.max(0.7, r * 0.18); c.stroke();
  c.beginPath(); c.arc(x, y, r * 0.62, Math.PI * 1.1, Math.PI * 1.5); c.strokeStyle = 'rgba(255,255,255,0.5)'; c.lineWidth = 0.9; c.stroke();
  c.beginPath(); c.arc(x, y, r - 0.9, 0.1, 1.4); c.strokeStyle = 'rgba(60,40,20,0.22)'; c.lineWidth = 1.1; c.stroke();
}
function SH_ropeToy(c, x1, y1, x2, y2, c1, c2) {        // knotted tug rope
  var dx = x2 - x1, dy = y2 - y1, L = Math.sqrt(dx * dx + dy * dy) || 1, ux = dx / L, uy = dy / L;
  SH_line(c, x1, y1, x2, y2, SH_OUT, 5.4); SH_line(c, x1, y1, x2, y2, c1, 3);
  c.strokeStyle = c2; c.lineWidth = 1.2;
  for (var d = 3; d < L - 2; d += 3.4) { c.beginPath(); c.moveTo(x1 + ux * d - uy * 1.4 - ux, y1 + uy * d + ux * 1.4 - uy); c.lineTo(x1 + ux * d + uy * 1.4 + ux, y1 + uy * d - ux * 1.4 + uy); c.stroke(); }
  SH_ell(c, x1 + ux * 2.5, y1 + uy * 2.5, 3.1, 3.1, c1, SH_OUT, 1.1); SH_ell(c, x2 - ux * 2.5, y2 - uy * 2.5, 3.1, 3.1, c1, SH_OUT, 1.1);
  SH_line(c, x1, y1, x1 - ux * 3 - uy * 1.5, y1 - uy * 3 + ux * 1.5, c2, 1.2); SH_line(c, x1, y1, x1 - ux * 3 + uy * 1.5, y1 - uy * 3 - ux * 1.5, c2, 1.2);
  SH_line(c, x2, y2, x2 + ux * 3 - uy * 1.5, y2 + uy * 3 + ux * 1.5, c2, 1.2); SH_line(c, x2, y2, x2 + ux * 3 + uy * 1.5, y2 + uy * 3 - ux * 1.5, c2, 1.2);
}
function SH_plush(c, x, yb, s, kind) {                  // sitting soft toys; x = centre, s = head radius
  var ol = SH_OUT;
  if (kind === 'duck') {
    SH_ell(c, x, yb - s * 1.0, s * 1.25, s * 1.0, '#f6d24e', ol, 1.1);
    SH_ell(c, x - s * 0.5, yb - s * 0.85, s * 0.55, s * 0.4, '#e6b93a', null, 0, 0.2);
    SH_ell(c, x + s * 0.35, yb - s * 2.25, s * 0.85, s * 0.8, '#f6d24e', ol, 1.1);
    SH_poly(c, [x + s * 1.0, yb - s * 2.35, x + s * 1.75, yb - s * 2.1, x + s * 1.0, yb - s * 1.85], '#f08a3c', ol, 0.9);
    SH_ell(c, x + s * 0.45, yb - s * 2.4, s * 0.14, s * 0.14, ol, null);
    SH_poly(c, [x - s * 1.2, yb - s * 1.3, x - s * 1.75, yb - s * 1.9, x - s * 0.95, yb - s * 1.6], '#f6d24e', ol, 0.9);
  } else if (kind === 'bunny') {
    SH_ell(c, x - s * 0.4, yb - s * 3.5, s * 0.3, s * 0.85, '#f4c3cf', ol, 1.1, -0.15);
    SH_ell(c, x + s * 0.4, yb - s * 3.5, s * 0.3, s * 0.85, '#f4c3cf', ol, 1.1, 0.15);
    SH_ell(c, x, yb - s * 0.95, s * 1.0, s * 0.98, '#f4c3cf', ol, 1.1);
    SH_ell(c, x, yb - s * 0.8, s * 0.55, s * 0.6, '#fbe7ec', null);
    SH_ell(c, x, yb - s * 2.3, s * 0.9, s * 0.82, '#f4c3cf', ol, 1.1);
    SH_ell(c, x - s * 0.32, yb - s * 2.4, s * 0.12, s * 0.12, ol, null); SH_ell(c, x + s * 0.32, yb - s * 2.4, s * 0.12, s * 0.12, ol, null);
    SH_ell(c, x, yb - s * 2.12, s * 0.14, s * 0.1, '#d9574a', null);
  } else {                                              // teddy (kind = body colour)
    var col = (kind && kind.charAt && kind.charAt(0) === '#') ? kind : '#b98247', lt = SH_lt(col, 0.5);
    SH_ell(c, x - s * 0.72, yb - s * 3.0, s * 0.36, s * 0.36, col, ol, 1.1); SH_ell(c, x + s * 0.72, yb - s * 3.0, s * 0.36, s * 0.36, col, ol, 1.1);
    SH_ell(c, x - s * 0.95, yb - s * 0.35, s * 0.42, s * 0.36, col, ol, 1.1); SH_ell(c, x + s * 0.95, yb - s * 0.35, s * 0.42, s * 0.36, col, ol, 1.1);
    SH_ell(c, x, yb - s * 1.0, s * 1.0, s * 1.0, col, ol, 1.1);
    SH_ell(c, x, yb - s * 0.85, s * 0.55, s * 0.6, lt, null);
    SH_ell(c, x, yb - s * 2.3, s * 0.95, s * 0.85, col, ol, 1.1);
    SH_ell(c, x, yb - s * 2.1, s * 0.42, s * 0.34, lt, null);
    SH_ell(c, x, yb - s * 2.2, s * 0.14, s * 0.1, ol, null);
    SH_ell(c, x - s * 0.36, yb - s * 2.5, s * 0.11, s * 0.11, ol, null); SH_ell(c, x + s * 0.36, yb - s * 2.5, s * 0.11, s * 0.11, ol, null);
    SH_poly(c, [x - s * 0.5, yb - s * 1.62, x, yb - s * 1.45, x + s * 0.5, yb - s * 1.62, x + s * 0.5, yb - s * 1.3, x, yb - s * 1.45, x - s * 0.5, yb - s * 1.3], '#d9574a', ol, 0.7);
  }
}
function SH_frisbees(c, x, yb, w, cols) {               // a stack of discs
  for (var i = 0; i < cols.length; i++) {
    var y = yb - 2.4 - i * 3.4;
    SH_ell(c, x + w / 2, y, w / 2, 2.6, cols[i], SH_OUT, 1);
    SH_ell(c, x + w / 2, y - 0.8, w * 0.3, 1.1, SH_lt(cols[i], 0.4), null);
  }
}
function SH_bottle(c, x, yb, w, h, col, top) {          // shampoo & co. top: 'pump' | 'spray' | 'cap'
  var bh = h * 0.68, nx = x + w / 2;
  if (top === 'pump') {
    SH_rect(c, nx - 1, yb - h + 3, 2, h * 0.3, '#e8e2d4', SH_OUT, 0.8);
    SH_rect(c, nx - 4.5, yb - h, 6.5, 3, '#fbf1d8', SH_OUT, 0.9, 1);
    SH_rect(c, nx - 2.2, yb - bh - 3, 4.4, 3.4, '#fbf1d8', SH_OUT, 0.9);
  } else if (top === 'spray') {
    SH_rect(c, nx - 1.6, yb - bh - 4, 3.2, 5, '#e8e2d4', SH_OUT, 0.8);
    SH_poly(c, [nx - 3, yb - h, nx + 4.5, yb - h, nx + 4.5, yb - h + 3, nx + 1.5, yb - h + 4.5, nx + 1.5, yb - bh - 3, nx - 3, yb - bh - 3], '#fbf1d8', SH_OUT, 0.9);
    SH_line(c, nx + 2.4, yb - h + 4.5, nx + 4, yb - h + 8, SH_OUT, 1);
  } else {
    SH_rect(c, nx - w * 0.28, yb - bh - 4, w * 0.56, 4.6, SH_dk(col, 0.3), SH_OUT, 0.9, 1);
  }
  c.beginPath();
  c.moveTo(x, yb); c.lineTo(x, yb - bh + 3); c.quadraticCurveTo(x, yb - bh, x + w * 0.3, yb - bh); c.lineTo(x + w * 0.7, yb - bh);
  c.quadraticCurveTo(x + w, yb - bh, x + w, yb - bh + 3); c.lineTo(x + w, yb); c.closePath();
  SH_fs(c, col, SH_OUT, 1.1);
  SH_fill(c, x + w * 0.7, yb - bh + 2.5, w * 0.3 - 0.7, bh - 3.2, SH_dk(col, 0.2));
  SH_fill(c, x + 1.2, yb - bh + 3, 1.1, bh - 5, SH_lt(col, 0.45));
  SH_rect(c, x + 1, yb - bh * 0.68, w - 2, bh * 0.42, '#fbf1d8', null);
  SH_paw(c, x + w / 2, yb - bh * 0.47, Math.min(w * 0.2, 2.2), col);
}
function SH_towelStack(c, x, yb, w, cols) {             // folded towels, bottom first
  for (var i = 0; i < cols.length; i++) {
    var y = yb - (i + 1) * 5.2;
    SH_rect(c, x + (i % 2) * 0.8, y, w - (i % 2) * 1.6, 5.2, cols[i], SH_OUT, 1.1, 2.2);
    SH_line(c, x + 2.5, y + 2.7, x + w - 3.5, y + 2.7, SH_dk(cols[i], 0.25), 0.9);
    SH_fill(c, x + 2, y + 1, w - 6, 1, SH_lt(cols[i], 0.4));
  }
}
function SH_towelRoll(c, x, y, r, col) {
  SH_ell(c, x, y, r, r, col, SH_OUT, 1.1);
  c.beginPath(); c.arc(x, y, r * 0.6, 0.6, Math.PI * 2 + 0.2); c.arc(x + 0.3, y, r * 0.28, 0.2, Math.PI * 1.6);
  c.strokeStyle = SH_dk(col, 0.28); c.lineWidth = 0.9; c.stroke();
  c.beginPath(); c.arc(x, y, r - 1.1, Math.PI * 1.05, Math.PI * 1.5); c.strokeStyle = SH_lt(col, 0.5); c.lineWidth = 0.9; c.stroke();
}
function SH_basket(c, x, yb, w, h, col) {               // wicker basket (front view)
  col = col || '#d4a56d';
  SH_poly(c, [x, yb - h, x + w, yb - h, x + w - 2.5, yb, x + 2.5, yb], col, SH_OUT, 1.3);
  c.save(); c.beginPath(); c.rect(x, yb - h + 1, w, h - 1.5); c.clip();
  c.strokeStyle = SH_dk(col, 0.3); c.lineWidth = 0.9;
  for (var yy = yb - h + 4.2, r = 0; yy < yb; yy += 3.4, r++) {
    c.beginPath(); c.moveTo(x, yy); c.lineTo(x + w, yy); c.stroke();
    for (var xx = x + ((r % 2) ? 2 : 4.5); xx < x + w; xx += 5) { c.beginPath(); c.moveTo(xx, yy - 3.4); c.lineTo(xx, yy); c.stroke(); }
  }
  SH_fill(c, x + w * 0.72, yb - h, w * 0.28, h, 'rgba(90,56,30,0.18)');
  c.restore();
  SH_rect(c, x - 1.2, yb - h - 1.6, w + 2.4, 3.6, SH_lt(col, 0.2), SH_OUT, 1.2, 1.8);
}
function SH_wireBasket(c, x, yb, w, h) {                // wire bin
  c.strokeStyle = SH_OUT; c.lineWidth = 2.4;
  c.beginPath(); c.moveTo(x, yb - h); c.lineTo(x + 2, yb); c.lineTo(x + w - 2, yb); c.lineTo(x + w, yb - h); c.stroke();
  c.strokeStyle = '#cfc9bc'; c.lineWidth = 1; c.stroke();
  for (var xx = x + 4; xx < x + w - 2; xx += 4.5) SH_line(c, xx, yb - h + 1, xx, yb - 1, 'rgba(207,201,188,0.9)', 0.8);
  SH_line(c, x + 1, yb - h * 0.5, x + w - 1, yb - h * 0.5, 'rgba(207,201,188,0.9)', 0.8);
  SH_line(c, x - 1, yb - h, x + w + 1, yb - h, SH_OUT, 2.6); SH_line(c, x - 1, yb - h, x + w + 1, yb - h, '#e8e2d4', 1.2);
}
function SH_bowlStack(c, x, yb, w, cols) {
  for (var i = 0; i < cols.length; i++) {
    var y = yb - i * 3.6;
    SH_poly(c, [x + 1.5, y, x + w - 1.5, y, x + w, y - 5, x, y - 5], cols[i], SH_OUT, 1.1);
    SH_fill(c, x + 1.5, y - 4.3, w - 3, 1.1, SH_lt(cols[i], 0.45));
  }
}
function SH_priceTag(c, x, y, col) {
  SH_rect(c, x, y, 7, 3.6, col || '#fbf1d8', '#5e3c22', 0.7, 0.8);
  SH_fill(c, x + 1.4, y + 1.4, 4.2, 0.8, '#7a4e2a');
}
function SH_brush(c, x, yb, col) {                      // paddle brush leaning upright, handle down
  SH_rect(c, x + 2.6, yb - 9, 3, 9, col, SH_OUT, 1, 1.4);
  SH_rect(c, x, yb - 21, 8.2, 13, col, SH_OUT, 1.1, 3.4);
  SH_rect(c, x + 1.4, yb - 19.6, 5.4, 10, '#f4e4c4', SH_dk(col, 0.3), 0.6, 2.4);
  c.fillStyle = '#5e3c22';
  for (var i = 0; i < 3; i++) for (var j = 0; j < 5; j++) c.fillRect(x + 2.2 + i * 1.7, yb - 18.6 + j * 1.8, 0.8, 0.8);
}
function SH_pottedPlant(c, x, yb, s, sway, kind, potCol) { // x = centre of pot; s = scale (1 = 30 px wide pot); sway = px the tips lean
  var pw = 15 * s, ph = 20 * s, i;
  sway = sway || 0;
  potCol = potCol || '#c9694a';
  var top = yb - ph;
  function leaf(bx, by, tx, ty, wd, col) {
    var mx = (bx + tx) / 2, my = (by + ty) / 2, dx = tx - bx, dy = ty - by, L = Math.sqrt(dx * dx + dy * dy) || 1, nx = -dy / L * wd, ny = dx / L * wd;
    c.beginPath(); c.moveTo(bx, by); c.quadraticCurveTo(mx + nx, my + ny, tx, ty); c.quadraticCurveTo(mx - nx, my - ny, bx, by); c.closePath();
    SH_fs(c, col, SH_OUT, 1.3 * Math.min(1, s + 0.2));
    c.beginPath(); c.moveTo(bx, by); c.lineTo(bx + dx * 0.82, by + dy * 0.82); c.strokeStyle = 'rgba(30,70,40,0.45)'; c.lineWidth = 0.9; c.stroke();
  }
  if (kind === 'fern') {
    // arching fronds: outer ones droop over the rim
    var fr = [[-1.25, 34, 0], [1.25, 34, 1], [-0.95, 40, 1], [0.95, 40, 0], [-0.6, 44, 0], [0.6, 44, 1], [-0.28, 46, 1], [0.28, 46, 0], [0, 44, 1]];
    for (i = 0; i < fr.length; i++) {
      var fa = fr[i][0], fl2 = fr[i][1] * s, sw2 = sway * (0.5 + Math.abs(fa) * 0.5);
      var bx0 = x + fa * 4 * s, by0 = top + 3;
      var tx0 = bx0 + Math.sin(fa) * fl2 + sw2, ty0 = by0 - Math.cos(fa) * fl2 * 0.92 + Math.abs(fa) * 9 * s;
      var cxm = bx0 + Math.sin(fa) * fl2 * 0.55, cym = by0 - fl2 * 0.95;
      c.beginPath(); c.moveTo(bx0 - 2 * s, by0);
      c.quadraticCurveTo(cxm - 5 * s, cym, tx0, ty0);
      c.quadraticCurveTo(cxm + 6 * s, cym + 7 * s, bx0 + 2 * s, by0); c.closePath();
      SH_fs(c, fr[i][2] ? '#5d9d49' : '#3f7d3a', SH_OUT, 1.3);
      c.beginPath(); c.moveTo(bx0, by0); c.quadraticCurveTo(cxm, cym + 3 * s, tx0, ty0);
      c.strokeStyle = fr[i][2] ? '#8fce6c' : '#5d9d49'; c.lineWidth = 1; c.stroke();
    }
  } else if (kind === 'snake') {
    var hs = [30, 40, 34, 44, 28, 36], xs = [-9, -5, -1, 3, 7, 10], ln = [-0.25, -0.1, 0.02, 0.08, 0.2, 0.3];
    for (i = 0; i < 6; i++) {
      var bx = x + xs[i] * s, tx = bx + ln[i] * hs[i] * s + sway * 0.4, ty = top + 3 - hs[i] * s;
      c.beginPath(); c.moveTo(bx - 3 * s, top + 3); c.quadraticCurveTo(bx - 4 * s + (tx - bx) * 0.5, (top + ty) / 2, tx, ty);
      c.quadraticCurveTo(bx + 4 * s + (tx - bx) * 0.5, (top + ty) / 2, bx + 3 * s, top + 3); c.closePath();
      SH_fs(c, (i % 2) ? '#4e8f45' : '#3f7d3a', SH_OUT, 1.3);
      c.beginPath(); c.moveTo(bx, top + 2); c.quadraticCurveTo(bx + (tx - bx) * 0.5, (top + ty) / 2, tx, ty + 3 * s); c.strokeStyle = '#cfe08a'; c.lineWidth = 1; c.stroke();
    }
  } else {                                              // big-leafed fig
    c.beginPath(); c.moveTo(x, top + 2); c.quadraticCurveTo(x + 2 * s, top - 18 * s, x + sway * 0.4, top - 36 * s);
    c.strokeStyle = SH_OUT; c.lineWidth = 3.4 * s; c.stroke(); c.strokeStyle = '#7a4e2a'; c.lineWidth = 1.6 * s; c.stroke();
    var lv = [[-1, -5, -19, -6, 0], [1, -7, 20, -10, 1], [-1, -12, -20, -19, 1], [1, -15, 19, -24, 0], [0, -20, -17, -32, 0], [0, -24, 17, -37, 1],
      [0, -28, -11, -45, 1], [0, -31, 11, -49, 0], [0, -34, 0, -56, 1]];
    for (i = 0; i < lv.length; i++) {
      var q = lv[i], k = Math.abs(q[3]) / 50;
      leaf(x + q[0] * s + sway * k * 0.3, top + q[1] * s, x + q[2] * s + sway * k, top + q[3] * s, 8.5 * s, q[4] ? '#5d9d49' : '#3f7d3a');
    }
  }
  // pot
  SH_poly(c, [x - pw, top + 4 * s, x + pw, top + 4 * s, x + pw * 0.78, yb, x - pw * 0.78, yb], potCol, SH_OUT, 1.7);
  c.save(); c.beginPath(); c.rect(x + pw * 0.3, top + 5 * s, pw, ph); c.clip();
  SH_poly(c, [x - pw, top + 4 * s, x + pw - 1, top + 4 * s, x + pw * 0.78 - 1, yb - 1, x - pw * 0.78, yb - 1], SH_dk(potCol, 0.2), null);
  c.restore();
  SH_rect(c, x - pw - 1.5, top, pw * 2 + 3, 5.5 * s, SH_lt(potCol, 0.12), SH_OUT, 1.7, 2);
  SH_fill(c, x - pw + 1, top + 1.2, pw * 1.2, 1.3, SH_lt(potCol, 0.45));
  SH_paw(c, x - pw * 0.1, top + ph * 0.62, 3.6 * s, SH_lt(potCol, 0.5));
}

// =========================================================================================
// ROOF STRIP + SIGN
// =========================================================================================
// The roof is drawn in pieces so that it can be baked a little at a time.
function SH_roofShingles(c, xa, xb) {                    // shingle courses between xa and xb
  var G = SH_G, x0 = G.x0 - 8, x1 = G.x1 + 8, y0 = G.roofY0, y1 = G.eaveY, r, x, i;
  xa = Math.max(xa, x0); xb = Math.min(xb, x1);
  c.save(); c.beginPath(); c.rect(xa, y0, xb - xa, y1 - y0); c.clip();
  SH_fill(c, xa, y0, xb - xa, y1 - y0, '#b8563c');
  var cols = ['#c9694a', '#c46045', '#d07353', '#bd5a40', '#cc6d4e'];
  for (r = 3; r >= 0; r--) {
    var yy = y0 + r * 16 - 2, off = x0 - ((r % 2) ? 11 : 0);
    var i0 = Math.floor((xa - off) / 22) - 1, i1 = Math.ceil((xb - off) / 22) + 1;
    for (i = i0; i <= i1; i++) {
      x = off + i * 22;
      var hv = SH_h(i, r * 7 + 1), col = cols[Math.floor(hv * cols.length)];
      if (SH_h(i, r + 60) > 0.93) col = '#a8a05c';                // mossy shingle
      c.beginPath(); c.moveTo(x, yy); c.lineTo(x, yy + 10);
      c.quadraticCurveTo(x, yy + 20, x + 11, yy + 20); c.quadraticCurveTo(x + 22, yy + 20, x + 22, yy + 10); c.lineTo(x + 22, yy); c.closePath();
      SH_fs(c, col, '#7d3524', 1.2);
      c.beginPath(); c.moveTo(x + 4, yy + 6); c.lineTo(x + 4, yy + 12); c.strokeStyle = 'rgba(255,215,180,0.35)'; c.lineWidth = 1.4; c.stroke();
      c.beginPath(); c.moveTo(x + 18.5, yy + 5); c.quadraticCurveTo(x + 19, yy + 16, x + 12, yy + 18); c.strokeStyle = 'rgba(110,40,26,0.28)'; c.lineWidth = 1.6; c.stroke();
    }
    SH_fill(c, xa, yy, xb - xa, 3, 'rgba(80,30,20,0.22)');        // shadow under the row above
  }
  c.restore();
}
function SH_roofTrim(c) {                                // outline, barge boards, ridge cap
  var G = SH_G, x0 = G.x0 - 8, x1 = G.x1 + 8, y0 = G.roofY0, y1 = G.eaveY, x;
  SH_rect(c, x0, y0, x1 - x0, y1 - y0, null, SH_OUT, 2);
  SH_rect(c, x0 - 3, y0 - 2, 9, y1 - y0 + 6, '#8a5a33', SH_OUT, 1.8, 2);
  SH_rect(c, x1 - 6, y0 - 2, 9, y1 - y0 + 6, '#7a4e2a', SH_OUT, 1.8, 2);
  SH_fill(c, x0 - 1.5, y0, 1.5, y1 - y0, '#a8743f');
  SH_rect(c, x0 - 4, y0 - 7, x1 - x0 + 8, 11, '#7a4e2a', SH_OUT, 2, 4);
  SH_fill(c, x0 - 1, y0 - 5.5, x1 - x0 + 2, 2, '#a8743f');
  for (x = x0 + 30; x < x1 - 10; x += 60) SH_line(c, x, y0 - 6, x, y0 + 3, '#5e3c22', 1.1);
}
function SH_roofChimney(c) {                             // brick chimney rising out of the shingles
  var G = SH_G, y0 = G.roofY0, chx = G.x0 + 62, r, x;
  SH_rect(c, chx, y0 - 34, 34, 60, '#b8563c', SH_OUT, 2);
  SH_fill(c, chx + 23, y0 - 33, 10, 58, '#9c4530');
  c.strokeStyle = '#7d3524'; c.lineWidth = 1;
  for (r = 0; r < 8; r++) {
    var by = y0 - 34 + r * 7.5;
    c.beginPath(); c.moveTo(chx + 1, by); c.lineTo(chx + 33, by); c.stroke();
    for (x = chx + ((r % 2) ? 6 : 14); x < chx + 32; x += 16) { c.beginPath(); c.moveTo(x, by); c.lineTo(x, by + 7.5); c.stroke(); }
  }
  SH_fill(c, chx + 2, y0 - 32, 2, 56, 'rgba(255,220,190,0.3)');
  SH_rect(c, chx - 4, y0 - 42, 42, 9, '#bdb7aa', SH_OUT, 2, 2);
  SH_fill(c, chx - 2, y0 - 41, 38, 2, '#dedad0');
  SH_rect(c, chx + 6, y0 - 48, 22, 7, '#5e3c22', SH_OUT, 1.6, 2);
  SH_rect(c, chx - 4, y0 + 22, 42, 7, '#918b80', SH_OUT, 1.6, 2);
  SH_fill(c, chx - 2, y0 + 23, 38, 1.5, '#bdb7aa');
}
function SH_roofSign(c) {                                // the big shop sign with its lamps
  var G = SH_G, y0 = G.roofY0, i;
  // ---- the big sign ----
  var cx = (G.x0 + G.x1) / 2, sw = 308, sh = 54, sy = y0 - 2, sx = cx - sw / 2;
  // shadow on the shingles
  c.fillStyle = 'rgba(60,20,12,0.3)'; SH_rrPath(c, sx + 4, sy + 6, sw, sh, 8); c.fill();
  // iron brackets
  SH_rect(c, sx + 34, sy + sh - 2, 6, 10, '#4a3a30', SH_OUT, 1.2); SH_rect(c, sx + sw - 40, sy + sh - 2, 6, 10, '#4a3a30', SH_OUT, 1.2);
  // board with an arched crest
  function boardPath(inset) {
    var a = sx + inset, b = sx + sw - inset, t = sy + inset, bt = sy + sh - inset, rr = 8 - inset * 0.5, cr = 34 - inset;
    c.beginPath();
    c.moveTo(a + rr, t); c.lineTo(cx - cr - 6, t);
    c.quadraticCurveTo(cx - cr, t, cx - cr + 2, t - 6);
    c.bezierCurveTo(cx - cr * 0.7, t - 26 + inset * 0.4, cx + cr * 0.7, t - 26 + inset * 0.4, cx + cr - 2, t - 6);
    c.quadraticCurveTo(cx + cr, t, cx + cr + 6, t);
    c.lineTo(b - rr, t); c.quadraticCurveTo(b, t, b, t + rr);
    c.lineTo(b, bt - rr); c.quadraticCurveTo(b, bt, b - rr, bt);
    c.lineTo(a + rr, bt); c.quadraticCurveTo(a, bt, a, bt - rr);
    c.lineTo(a, t + rr); c.quadraticCurveTo(a, t, a + rr, t); c.closePath();
  }
  boardPath(0); SH_fs(c, '#7a4e2a', SH_OUT, 2.2);
  boardPath(5); SH_fs(c, '#fbf1d8', '#5e3c22', 1.2);
  c.save(); boardPath(5); c.clip();
  SH_fill(c, sx, sy + sh - 14, sw, 10, '#f0deb4');                 // shade band at the bottom of the panel
  c.strokeStyle = 'rgba(201,147,90,0.35)'; c.lineWidth = 1;
  for (i = 0; i < 4; i++) { c.beginPath(); c.moveTo(sx + 8, sy + 14 + i * 11); c.lineTo(sx + sw - 8, sy + 14 + i * 11); c.stroke(); }
  c.restore();
  boardPath(8.5); SH_fs(c, null, '#d9a441', 1.3);
  SH_fill(c, sx + 3, sy + 2.2, cx - 40 - sx - 6, 1.6, '#a8743f');
  // crest paw
  SH_paw(c, cx, sy - 4.5, 9.5, '#d9574a');
  // lettering
  SH_txt(c, 'PAWS', cx - 20, sy + sh / 2 + 1, 46, '#d9574a', 'right', SH_OUT, 4.5);
  SH_txt(c, 'PLAY', cx + 20, sy + sh / 2 + 1, 46, '#d9574a', 'left', SH_OUT, 4.5);
  SH_txt(c, '&', cx, sy + sh / 2 + 1, 38, '#3aa89a', 'center', SH_OUT, 4.5);
  c.save(); c.beginPath(); c.rect(sx, sy + 8, sw, sh / 2 - 8); c.clip();   // highlight on the upper half of the letters
  SH_txt(c, 'PAWS', cx - 20, sy + sh / 2 + 1, 46, '#ec7565', 'right');
  SH_txt(c, 'PLAY', cx + 20, sy + sh / 2 + 1, 46, '#ec7565', 'left');
  c.restore();
  SH_paw(c, sx + 24, sy + sh / 2, 9, '#3aa89a', -0.3);
  SH_paw(c, sx + sw - 24, sy + sh / 2, 9, '#3aa89a', 0.3);
  // bolts
  var bolts = [[sx + 9, sy + 9], [sx + sw - 9, sy + 9], [sx + 9, sy + sh - 9], [sx + sw - 9, sy + sh - 9]];
  for (i = 0; i < 4; i++) { SH_ell(c, bolts[i][0], bolts[i][1], 1.8, 1.8, '#d9a441', '#5e3c22', 0.8); }
  // goose-neck lamps over the sign
  for (i = 0; i < 2; i++) {
    var lx = cx + (i ? 104 : -104);
    c.beginPath(); c.moveTo(lx, sy + 2); c.quadraticCurveTo(lx, sy - 14, lx + (i ? -9 : 9), sy - 12);
    c.strokeStyle = SH_OUT; c.lineWidth = 3.4; c.stroke(); c.strokeStyle = '#5a4a40'; c.lineWidth = 1.6; c.stroke();
    SH_poly(c, [lx + (i ? -15 : 3), sy - 7, lx + (i ? -3 : 15), sy - 7, lx + (i ? -6 : 12), sy - 14, lx + (i ? -12 : 6), sy - 14], '#3aa89a', SH_OUT, 1.6);
    SH_ell(c, lx + (i ? -9 : 9), sy - 6.5, 3.2, 1.8, '#fbf1d8', SH_OUT, 1);
  }
}
function SH_roofVaneBase(c) {
  var G = SH_G, y0 = G.roofY0;
  // weather vane base
  var vx = G.x1 - 58;
  SH_line(c, vx, y0 - 6, vx, y0 - 40, SH_OUT, 3.6); SH_line(c, vx, y0 - 6, vx, y0 - 40, '#5a4a40', 1.6);
  SH_ell(c, vx, y0 - 8, 3.5, 2.5, '#5a4a40', SH_OUT, 1.4);
  SH_line(c, vx - 9, y0 - 20, vx + 9, y0 - 20, SH_OUT, 3); SH_line(c, vx - 9, y0 - 20, vx + 9, y0 - 20, '#5a4a40', 1.2);
  SH_ell(c, vx, y0 - 20, 2.4, 2.4, '#d9a441', SH_OUT, 1.2);
}
// bake units of the roof sprite: [fn, x, y, w, h]
function SH_roofUnits() {
  var G = SH_G, x0 = G.x0 - 14, x1 = G.x1 + 14, y0 = G.roofY0, y1 = G.eaveY, U = [], n = 6, i, cx = (G.x0 + G.x1) / 2;
  function sh(a, b) { return function (c) { SH_roofShingles(c, a - 2, b + 2); }; }   // overlap so unit seams stay opaque
  for (i = 0; i < n; i++) { var a = x0 + (x1 - x0) * i / n, b = x0 + (x1 - x0) * (i + 1) / n; U.push([sh(a, b), a, y0, b - a, y1 - y0]); }
  U.push([SH_roofTrim, x0, y0 - 9, x1 - x0, 16], [SH_roofTrim, x0, y0 + 7, 18, y1 - y0], [SH_roofTrim, x1 - 18, y0 + 7, 18, y1 - y0], [SH_roofTrim, x0, y1 - 3, x1 - x0, 8]);
  U.push([SH_roofChimney, G.x0 + 54, y0 - 52, 50, 86]);
  U.push([SH_roofSign, cx - 160, y0 - 32, 320, 98]);
  U.push([SH_roofVaneBase, G.x1 - 72, y0 - 44, 28, 44]);
  return U;
}
function SH_roofStatic(c) {                              // everything at once (plain vector path)
  var U = SH_roofUnits();
  for (var i = 0; i < 6; i++) U[i][0](c);
  SH_roofTrim(c); SH_roofChimney(c); SH_roofSign(c); SH_roofVaneBase(c);
}
// --- animated bits of the roof, each a small baked sprite ---
var SH_PUFF = [0, 1, 2].map(function (k) {
  return function (c) { var r = 5 + k * 3; SH_ell(c, 0, 0, r, r * 0.9, '#fbf1d8', null); SH_ell(c, r * 0.45, r * 0.3, r * 0.6, r * 0.5, '#efe3c8', null); };
});
function SH_vaneArt(c, sx) {                             // arrow + little dog, turned by squashing it sideways
  var G = SH_G, vx = G.x1 - 58, y0 = G.roofY0;
  c.save(); c.translate(vx, y0 - 40); c.scale(sx, 1);
  c.beginPath(); c.moveTo(-20, 0); c.lineTo(18, 0); c.strokeStyle = SH_OUT; c.lineWidth = 3; c.stroke(); c.lineWidth = 1.2; c.strokeStyle = '#5a4a40'; c.stroke();
  SH_poly(c, [17, -4.5, 25, 0, 17, 4.5], '#d9a441', SH_OUT, 1.2);
  SH_poly(c, [-21, 0, -26, -5, -19, -5, -15, 0, -19, 5, -26, 5], '#d9a441', SH_OUT, 1.2);
  c.beginPath();
  c.moveTo(-10, -1); c.lineTo(-10, -8); c.quadraticCurveTo(-14, -12, -12, -16); c.quadraticCurveTo(-9, -12, -7, -10.5);
  c.lineTo(3, -10.5); c.lineTo(5, -15); c.lineTo(7, -12.5); c.lineTo(12, -12); c.lineTo(12.5, -9.5); c.lineTo(8, -8.5); c.lineTo(7, -5);
  c.lineTo(7, -1); c.lineTo(4.5, -1); c.lineTo(4.5, -5.5); c.lineTo(-5.5, -5.5); c.lineTo(-6.5, -1); c.closePath();
  SH_fs(c, '#4a3a30', SH_OUT, 1);
  c.restore();
}
var SH_VANE = [-4, -3, -2, -1, 0, 1, 2, 3, 4].map(function (k) { return function (c) { SH_vaneArt(c, (k || 1) / 4); }; });
function SH_roofGlow(c) {                                // the two sign lamps switched on
  var G = SH_G, y0 = G.roofY0, cx = (G.x0 + G.x1) / 2;
  for (var i = 0; i < 2; i++) {
    var lx = cx + (i ? 95 : -95);
    SH_poly(c, [lx - 5, y0 - 7, lx + 5, y0 - 7, lx + 30, y0 + 44, lx - 30, y0 + 44], 'rgba(255,233,166,0.22)', null);
    SH_ell(c, lx, y0 - 8.5, 3.2, 1.8, '#ffe9a6', null);
  }
}
function SH_roofDynamic(c, t, state, m) {
  var G = SH_G, y0 = G.roofY0, i, chx = G.x0 + 79;
  // chimney smoke
  for (i = 0; i < 4; i++) {
    var p = ((t * 0.16 + i * 0.25) % 1 + 1) % 1, k = p < 0.3 ? 0 : p < 0.62 ? 1 : 2;
    c.globalAlpha = 0.6 * (1 - p) * Math.min(1, p * 6);
    SH_part(c, m, 'puff' + k, -14, -13, 30, 26, SH_PUFF[k], null, chx + Math.sin(p * 5 + i * 2.1) * 4 + p * 16, y0 - 50 - p * 44);
  }
  c.globalAlpha = 1;
  // weather vane wandering with the wind
  var ca = Math.cos(Math.sin(t * 0.3) * 2.5 + Math.sin(t * 1.3) * 0.15), v = Math.round(ca * 4);
  if (v === 0) v = ca < 0 ? -1 : 1;
  SH_part(c, m, 'vane' + v, G.x1 - 58 - 30, y0 - 60, 60, 28, SH_VANE[v + 4], 'vane4');
  // lamps glow when it gets dark
  var n = SH_num(state.night, 0);
  if (n > 0.25) {
    c.globalAlpha = SH_clamp((n - 0.25) / 0.3, 0, 1);
    SH_part(c, m, 'roofglow', (G.x0 + G.x1) / 2 - 128, y0 - 12, 256, 58, SH_roofGlow);
    c.globalAlpha = 1;
  }
}

// =========================================================================================
// BACK WALL FACE and its decor
// =========================================================================================
function SH_miniDog(c, cx, cy, s, o) {
  var coat = o.coat, ear = o.ear || SH_dk(coat, 0.3), muz = o.muzzle || SH_lt(coat, 0.55), ol = '#4a3426';
  SH_ell(c, cx, cy + 1.55 * s, 1.15 * s, 0.85 * s, coat, ol, 1);                                   // shoulders
  if (o.collar) { SH_fill(c, cx - 0.6 * s, cy + 0.82 * s, 1.2 * s, 0.24 * s, o.collar); }
  if (o.earType === 'point') {
    SH_poly(c, [cx - 0.95 * s, cy - 0.25 * s, cx - 0.75 * s, cy - 1.35 * s, cx - 0.2 * s, cy - 0.8 * s], ear, ol, 1);
    SH_poly(c, [cx + 0.95 * s, cy - 0.25 * s, cx + 0.75 * s, cy - 1.35 * s, cx + 0.2 * s, cy - 0.8 * s], ear, ol, 1);
  }
  SH_ell(c, cx, cy, s, 0.93 * s, coat, ol, 1);                                                     // head
  if (o.mask) { SH_ell(c, cx, cy + 0.25 * s, 0.72 * s, 0.62 * s, o.mask, null); SH_ell(c, cx, cy - 0.5 * s, 0.16 * s, 0.5 * s, o.mask, null); }
  if (o.earType !== 'point') {
    SH_ell(c, cx - 0.95 * s, cy + 0.05 * s, 0.36 * s, 0.75 * s, ear, ol, 1, 0.28);
    SH_ell(c, cx + 0.95 * s, cy + 0.05 * s, 0.36 * s, 0.75 * s, ear, ol, 1, -0.28);
  }
  SH_ell(c, cx, cy + 0.42 * s, 0.5 * s, 0.38 * s, muz, null);
  if (o.tongue) SH_ell(c, cx, cy + 0.72 * s, 0.17 * s, 0.22 * s, '#f2a0b5', '#b8566c', 0.7);
  c.beginPath(); c.moveTo(cx - 0.28 * s, cy + 0.5 * s); c.quadraticCurveTo(cx, cy + 0.7 * s, cx + 0.28 * s, cy + 0.5 * s);
  c.strokeStyle = ol; c.lineWidth = 0.8; c.stroke();
  SH_ell(c, cx, cy + 0.24 * s, 0.2 * s, 0.14 * s, '#3b2a20', null);
  SH_ell(c, cx - 0.4 * s, cy - 0.14 * s, 0.12 * s, 0.13 * s, '#3b2a20', null);
  SH_ell(c, cx + 0.4 * s, cy - 0.14 * s, 0.12 * s, 0.13 * s, '#3b2a20', null);
  SH_fill(c, cx - 0.44 * s, cy - 0.2 * s, 0.07 * s, 0.07 * s, '#fff');
  SH_fill(c, cx + 0.36 * s, cy - 0.2 * s, 0.07 * s, 0.07 * s, '#fff');
}
function SH_photoFrame(c, x, y, w, h, frame, bg, dog, oval) {
  if (oval) {
    SH_ell(c, x + w / 2, y + h / 2, w / 2, h / 2, frame, SH_OUT, 1.8);
    SH_ell(c, x + w / 2, y + h / 2, w / 2 - 4, h / 2 - 4, bg, SH_dk(frame, 0.35), 1);
    c.save(); c.beginPath(); c.ellipse(x + w / 2, y + h / 2, w / 2 - 4.5, h / 2 - 4.5, 0, 0, Math.PI * 2); c.clip();
  } else {
    SH_rect(c, x, y, w, h, frame, SH_OUT, 1.8, 2);
    SH_fill(c, x + 1.5, y + 1.5, w - 3, 1.5, SH_lt(frame, 0.35));
    SH_rect(c, x + 4, y + 4, w - 8, h - 8, bg, SH_dk(frame, 0.35), 1);
    c.save(); c.beginPath(); c.rect(x + 4.5, y + 4.5, w - 9, h - 9); c.clip();
  }
  SH_miniDog(c, x + w / 2, y + h * 0.5, Math.min(w, h) * 0.26, dog);
  c.restore();
  // nail + string
  SH_ell(c, x + w / 2, y - 3, 1.2, 1.2, '#5e3c22', null);
}
function SH_certificate(c, x, y, w, h) {
  SH_rect(c, x, y, w, h, '#3f7d6f', SH_OUT, 1.8, 2);
  SH_rect(c, x + 3.5, y + 3.5, w - 7, h - 7, '#fbf1d8', '#2a5a50', 1);
  SH_rect(c, x + 6, y + 6, w - 12, h - 12, null, '#d9a441', 0.8);
  SH_fill(c, x + w / 2 - 9, y + 9, 18, 2, '#7a4e2a');
  c.fillStyle = '#b9a784';
  c.fillRect(x + 10, y + 14, w - 20, 1); c.fillRect(x + 12, y + 17, w - 24, 1); c.fillRect(x + 10, y + 20, w - 26, 1);
  // ribbon seal
  SH_poly(c, [x + w - 13, y + h - 10, x + w - 15, y + h - 3, x + w - 11.5, y + h - 5, x + w - 8, y + h - 3, x + w - 10, y + h - 10], '#d9574a', null);
  SH_star(c, x + w - 11.5, y + h - 11, 4, '#d9a441');
  SH_ell(c, x + w - 11.5, y + h - 11, 1.6, 1.6, '#d9574a', null);
}
function SH_rosette(c, x, y, col, r) {
  r = r || 6;
  SH_poly(c, [x - 3.5, y + 2, x - 5, y + r * 2.3, x - 2, y + r * 1.9, x, y + r * 2.3, x + 0.5, y + 2], SH_dk(col, 0.15), SH_OUT, 1);
  SH_poly(c, [x + 3.5, y + 2, x + 5, y + r * 2.3, x + 2.5, y + r * 1.9, x + 0.5, y + r * 2.3, x - 0.5, y + 2], col, SH_OUT, 1);
  c.beginPath();
  for (var i = 0; i < 16; i++) { var a = i / 16 * Math.PI * 2, rr = (i % 2) ? r : r * 0.78; c.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
  c.closePath(); SH_fs(c, col, SH_OUT, 1.2);
  SH_ell(c, x, y, r * 0.52, r * 0.52, '#fbf1d8', SH_dk(col, 0.3), 0.8);
  SH_paw(c, x, y - 0.3, r * 0.3, col);
}
function SH_windowGlass(c, x, y, w, h, night, t, seed) {
  var gx = x + 5, gy = y + 5, gw = w - 10, gh = h - 10, i;
  c.save(); c.beginPath(); c.rect(gx, gy, gw, gh); c.clip();
  SH_fill(c, gx, gy, gw, gh, SH_mix('#bfe5f4', '#1d2750', night));
  SH_fill(c, gx, gy + gh * 0.55, gw, gh * 0.45, SH_mix('#dcf1f7', '#27356a', night));
  if (night < 0.6) {
    c.globalAlpha = 1 - night / 0.6;
    SH_ell(c, gx + gw * 0.3, gy + 11, 9, 3.6, '#ffffff', null); SH_ell(c, gx + gw * 0.42, gy + 8.5, 6, 3.4, '#ffffff', null);
    SH_ell(c, gx + gw * 0.8, gy + 20, 7, 2.6, '#ffffff', null);
    c.globalAlpha = 1;
  }
  if (night > 0.4) {
    c.globalAlpha = SH_clamp((night - 0.4) / 0.4, 0, 1);
    for (i = 0; i < 7; i++) {
      var tw = 0.6 + 0.4 * Math.sin(t * 2.2 + i * 1.9 + seed);
      SH_fill(c, gx + 3 + SH_h(i, seed) * (gw - 6), gy + 3 + SH_h(i, seed + 4) * gh * 0.6, 1.3 * tw, 1.3 * tw, '#fff6cf');
    }
    SH_ell(c, gx + gw * 0.74, gy + 10, 5, 5, '#fff3c4', null);
    SH_ell(c, gx + gw * 0.74 + 2.2, gy + 9, 4.2, 4.2, SH_mix('#bfe5f4', '#1d2750', night), null);
    c.globalAlpha = 1;
  }
  // tree tops outside
  var g1 = SH_mix('#5d9d49', '#1c3a3a', night), g2 = SH_mix('#7cc260', '#25494a', night);
  SH_ell(c, gx + gw * 0.18, gy + gh + 1, gw * 0.3, 13, g1, null); SH_ell(c, gx + gw * 0.86, gy + gh + 2, gw * 0.3, 16, g1, null);
  SH_ell(c, gx + gw * 0.52, gy + gh + 3, gw * 0.3, 11, g2, null);
  // glass shine
  c.strokeStyle = 'rgba(255,255,255,' + (0.5 - night * 0.3) + ')'; c.lineWidth = 3;
  c.beginPath(); c.moveTo(gx + 4, gy + gh * 0.5); c.lineTo(gx + gw * 0.45, gy + 2); c.stroke();
  c.lineWidth = 1.4; c.beginPath(); c.moveTo(gx + 10, gy + gh * 0.62); c.lineTo(gx + gw * 0.6, gy + 2); c.stroke();
  c.restore();
}
function SH_windowTrim(c, x, y, w, h, t, seed, col) {
  var gx = x + 5, gy = y + 5, gw = w - 10, gh = h - 10, i, s;
  SH_rect(c, gx, gy, gw, gh, null, '#5e3c22', 1.2);
  SH_rect(c, x + w / 2 - 1.8, gy, 3.6, gh, '#8a5a33', '#5e3c22', 1);
  SH_rect(c, gx, gy + gh * 0.45 - 1.6, gw, 3.2, '#8a5a33', '#5e3c22', 1);
  // curtains (a slow, tiny sway)
  var sw = Math.sin(t * 0.9 + seed) * 0.8, dkc = SH_dk(col, 0.28);
  for (s = -1; s <= 1; s += 2) {
    var ex = s < 0 ? x - 2 : x + w + 2;         // outer edge
    var tb = y + h * 0.66;                      // tie-back height
    c.beginPath();
    c.moveTo(ex, y - 1); c.lineTo(ex - s * 20, y - 1);
    c.quadraticCurveTo(ex - s * (19 + sw), y + h * 0.38, ex - s * 8, tb);
    c.quadraticCurveTo(ex - s * (12 + sw), tb + 8, ex - s * 11, y + h + 1);
    c.lineTo(ex, y + h + 1); c.closePath();
    SH_fs(c, col, SH_OUT, 1.6);
    c.strokeStyle = dkc; c.lineWidth = 1.1;
    c.beginPath(); c.moveTo(ex - s * 5, y + 3); c.quadraticCurveTo(ex - s * 5.5, y + h * 0.4, ex - s * 4, tb - 2); c.stroke();
    c.beginPath(); c.moveTo(ex - s * 11, y + 3); c.quadraticCurveTo(ex - s * 12, y + h * 0.36, ex - s * 6.5, tb - 2); c.stroke();
    c.fillStyle = '#fbf1d8';
    for (i = 0; i < 4; i++) c.fillRect(ex - s * (3 + (i % 2) * 5) - 0.8, y + 8 + i * 8, 1.6, 1.6);
    SH_rect(c, s < 0 ? ex - 1 : ex - 9, tb - 2, 10, 3.6, '#f2c14e', SH_OUT, 1, 1.5);            // tie-back
  }
  // valance
  c.beginPath(); c.moveTo(x - 5, y - 6); c.lineTo(x + w + 5, y - 6); c.lineTo(x + w + 5, y + 5);
  var n = 6, vw = (w + 10) / n;
  for (i = n - 1; i >= 0; i--) c.quadraticCurveTo(x - 5 + vw * (i + 0.5), y + 12, x - 5 + vw * i, y + 5);
  c.closePath(); SH_fs(c, col, SH_OUT, 1.6);
  SH_fill(c, x - 4, y - 5, w + 8, 2, SH_lt(col, 0.35));
  c.strokeStyle = '#fbf1d8'; c.lineWidth = 1.2; c.beginPath(); c.moveTo(x - 3, y + 3.5);
  for (i = 0; i < n; i++) c.quadraticCurveTo(x - 5 + vw * (i + 0.5), y + 9.5, x - 5 + vw * (i + 1), y + 3.5);
  c.stroke();
  // rod
  SH_line(c, x - 9, y - 7, x + w + 9, y - 7, SH_OUT, 3.6); SH_line(c, x - 9, y - 7, x + w + 9, y - 7, '#d9a441', 1.6);
  SH_ell(c, x - 10, y - 7, 2.4, 2.4, '#d9a441', SH_OUT, 1.2); SH_ell(c, x + w + 10, y - 7, 2.4, 2.4, '#d9a441', SH_OUT, 1.2);
}
function SH_windowFrame(c, x, y, w, h) {
  SH_rect(c, x, y, w, h, '#8a5a33', SH_OUT, 1.8, 2);
  SH_fill(c, x + 1.5, y + 1.5, w - 3, 1.5, '#b98247');
  SH_rect(c, x - 5, y + h - 1, w + 10, 6, '#a8743f', SH_OUT, 1.6, 2);
  SH_fill(c, x - 3.5, y + h, w + 7, 1.4, '#d4a56d');
  SH_fill(c, x - 2, y + h + 6, w + 4, 3, 'rgba(40,26,12,0.16)');
}
function SH_clockBody(c, cx, cy, r) {
  // a dog-faced wall clock (its pendulum, a wagging bone, and the hands are drawn live)
  SH_ell(c, cx - r * 0.98, cy - r * 0.2, r * 0.36, r * 0.72, '#7a4e2a', SH_OUT, 1.6, 0.35);
  SH_ell(c, cx + r * 0.98, cy - r * 0.2, r * 0.36, r * 0.72, '#7a4e2a', SH_OUT, 1.6, -0.35);
  SH_ell(c, cx, cy, r, r, '#a8743f', SH_OUT, 1.8);
  SH_ell(c, cx, cy, r - 2.6, r - 2.6, '#fbf1d8', '#5e3c22', 1);
  c.strokeStyle = '#7a4e2a'; c.lineWidth = 1;
  c.beginPath();
  for (var i = 0; i < 12; i++) {
    var a = i / 12 * Math.PI * 2, r1 = r - 4.2, r2 = r - ((i % 3) ? 5.4 : 6.6);
    c.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); c.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2);
  }
  c.stroke();
  c.beginPath(); c.arc(cx, cy, r - 1.2, Math.PI * 1.05, Math.PI * 1.55); c.strokeStyle = 'rgba(255,240,210,0.55)'; c.lineWidth = 1.2; c.stroke();
}
function SH_chalkboard(c, x, y, w, h) {
  SH_rect(c, x, y, w, h, '#a8743f', SH_OUT, 1.8, 2);
  SH_fill(c, x + 1.5, y + 1.5, w - 3, 1.5, '#d4a56d');
  SH_rect(c, x + 4, y + 4, w - 8, h - 8, '#3d5a4c', '#5e3c22', 1.2);
  SH_fill(c, x + 5, y + h - 10, w - 10, 5, '#35503f');
  SH_ell(c, x + 52, y + 29, 14, 5, 'rgba(255,255,255,0.05)', null, 0, -0.15); SH_ell(c, x + w - 24, y + h - 17, 12, 5, 'rgba(255,255,255,0.05)', null, 0, 0.2);   // wiped smudges
  SH_txt(c, 'PRICES', x + w / 2 - 4, y + 12, 14, '#fbf1d8', 'center');
  c.strokeStyle = '#f2c14e'; c.lineWidth = 1.1; c.beginPath(); c.moveTo(x + 14, y + 19); c.quadraticCurveTo(x + w / 2, y + 21, x + w - 14, y + 19); c.stroke();
  var rows = [['DAY', '#fbf1d8', 1], ['BATH', '#a9dcf0', 1], ['NIGHT', '#f2a0b5', 2]];
  for (var i = 0; i < 3; i++) {
    var ry = y + 28 + i * 9.5;
    SH_txt(c, rows[i][0], x + 9, ry, 10.5, rows[i][1], 'left');
    c.fillStyle = 'rgba(251,241,216,0.6)';
    for (var dx = x + 38; dx < x + w - 24; dx += 4) c.fillRect(dx, ry + 1.5, 1.2, 1.2);
    for (var k = 0; k < rows[i][2]; k++) SH_txt(c, '$', x + w - 12 - k * 6, ry, 10.5, '#f2c14e', 'center');
  }
  SH_paw(c, x + w - 13, y + 12, 3.4, 'rgba(251,241,216,0.8)', 0.3);
  // chalk tray
  SH_rect(c, x + 6, y + h - 2, w - 12, 4, '#8a5a33', SH_OUT, 1.2, 1);
  SH_rect(c, x + 14, y + h - 4.5, 8, 2.6, '#fbf1d8', '#8a7a62', 0.7, 1);
  SH_rect(c, x + 25, y + h - 4.5, 6, 2.6, '#f2a0b5', '#8a7a62', 0.7, 1);
  SH_rect(c, x + w - 30, y + h - 6, 13, 4, '#5a4a40', SH_OUT, 0.9, 1);
}
function SH_corkboard(c, x, y, w, h) {
  SH_rect(c, x, y, w, h, '#8a5a33', SH_OUT, 1.8, 2);
  SH_fill(c, x + 1.5, y + 1.5, w - 3, 1.5, '#b98247');
  SH_rect(c, x + 4, y + 4, w - 8, h - 8, '#d3a265', '#5e3c22', 1.2);
  c.fillStyle = 'rgba(122,78,42,0.3)';
  for (var i = 0; i < 60; i++) c.fillRect(x + 6 + SH_h(i, 5) * (w - 13), y + 6 + SH_h(i, 9) * (h - 13), 1.2, 1.2);
  // banner
  c.save(); c.translate(x + w / 2, y + 12.5); c.rotate(-0.02);
  SH_rect(c, -33, -6, 66, 12, '#fbf1d8', '#7a4e2a', 1, 1.5);
  SH_txt(c, 'PUP OF THE DAY', 0, 0.2, 10.5, '#d9574a', 'center');
  c.restore();
  // polaroid of today's star
  c.save(); c.translate(x + 25, y + 39); c.rotate(-0.09);
  SH_fill(c, -12, -16, 26, 33, 'rgba(40,26,12,0.2)');
  SH_rect(c, -13.5, -17.5, 27, 33, '#ffffff', '#7a6a55', 1, 1);
  SH_rect(c, -11, -15, 22, 21, '#a9dcf0', '#7a6a55', 0.8);
  c.save(); c.beginPath(); c.rect(-11, -15, 22, 21); c.clip();
  SH_miniDog(c, 0, -5, 6.6, { coat: '#e0a85a', ear: '#b9762f', tongue: true, collar: '#d9574a' });
  c.restore();
  SH_fill(c, -8, 9.5, 16, 1.4, '#c9b79a'); SH_fill(c, -5, 12, 10, 1.2, '#c9b79a');
  c.restore();
  SH_ell(c, x + 24, y + 22.5, 2.2, 2.2, '#d9574a', SH_OUT, 0.9); SH_fill(c, x + 23, y + 21.5, 1, 1, '#ffc0b8');
  // star sticker + gold rosette
  SH_star(c, x + 12, y + 30, 4.5, '#f2c14e');
  SH_rosette(c, x + 49, y + 27, '#3aa89a', 5.5);
  // notes
  c.save(); c.translate(x + 62, y + 30); c.rotate(0.07);
  SH_rect(c, -8, -8, 17, 16, '#f7e08a', '#a8904a', 0.9);
  c.fillStyle = '#a8904a'; c.fillRect(-5, -3, 11, 1); c.fillRect(-5, 0, 9, 1); c.fillRect(-5, 3, 10, 1);
  c.restore();
  SH_ell(c, x + 62, y + 23.5, 1.8, 1.8, '#3f8fc4', SH_OUT, 0.8);
  c.save(); c.translate(x + 58, y + 49); c.rotate(-0.05);
  SH_rect(c, -14, -5.5, 30, 11, '#f9c9d4', '#b8788a', 0.9);
  SH_paw(c, -9, 0.3, 2.6, '#d9574a'); c.fillStyle = '#b8788a'; c.fillRect(-4, -2, 16, 1); c.fillRect(-4, 1.5, 12, 1);
  c.restore();
  SH_ell(c, x + 45, y + 44.5, 1.8, 1.8, '#f2c14e', SH_OUT, 0.8);
}
// The wall face is drawn in pieces so that it can be baked a little at a time.
function SH_wallBase(c, xa, xb) {                        // wallpaper + wainscot between xa and xb
  var G = SH_G, T = SH_TL, X0 = G.ix0, X1 = G.ix1, Y0 = G.wallY0, Y1 = G.floorY0, x, i;
  var wy = Y1 - 50;                                              // top of the wainscot
  xa = Math.max(xa, X0); xb = Math.min(xb, X1);
  if (xb <= xa) return;
  c.save(); c.beginPath(); c.rect(xa, Y0, xb - xa, Y1 - Y0); c.clip();
  SH_fill(c, xa, Y0, xb - xa, wy - Y0, '#f8edd3');
  var i0 = Math.max(0, Math.floor((xa - X0) / 24) - 1), i1 = Math.ceil((xb - X0) / 24);
  for (i = i0; i <= i1; i++) {
    x = X0 + i * 24;
    SH_fill(c, x, Y0, 12, wy - Y0, '#f3e3c0');
    for (var py = Y0 + 22 + (i % 2) * 16; py < wy - 6; py += 32) SH_paw(c, x + 18, py, 2.8, '#ecd6a8', (i % 3 - 1) * 0.3);
  }
  SH_fill(c, xa, Y0, xb - xa, 16, 'rgba(60,36,16,0.12)'); SH_fill(c, xa, Y0 + 16, xb - xa, 5, 'rgba(60,36,16,0.05)');
  SH_fill(c, xa, wy, xb - xa, Y1 - wy, '#b98247');
  for (x = X0 + Math.floor((xa - X0) / T) * T; x < xb; x += T) {
    SH_rect(c, x + 5, wy + 9, T - 10, Y1 - wy - 20, '#c48f52', '#8a5a33', 1.2, 1.5);
    SH_fill(c, x + 6.2, wy + 10.2, T - 12.4, 1.4, '#dcae70'); SH_fill(c, x + 6.2, wy + 10.2, 1.4, Y1 - wy - 22.4, '#dcae70');
    SH_fill(c, x + 6.2, Y1 - 14, T - 12.4, 2, '#ab7840');
  }
  SH_rect(c, X0 - 2, wy - 3, X1 - X0 + 4, 7, '#8a5a33', '#5e3c22', 1.2); SH_fill(c, xa, wy - 2.2, xb - xa, 1.5, '#b98247');
  SH_rect(c, X0 - 2, Y1 - 9, X1 - X0 + 4, 9, '#8a5a33', '#5e3c22', 1.2); SH_fill(c, xa, Y1 - 8.2, xb - xa, 1.5, '#b98247');
  c.restore();
}
function SH_wallDecorA(c) {                              // left: happy customers, certificate, ribbons, window, first-aid box
  var G = SH_G, T = SH_TL, X0 = G.ix0, dy = G.wallY0 + 20;
  SH_photoFrame(c, X0 + 9, dy + 2, 34, 42, '#a8743f', '#a9dcf0', { coat: '#e6b062', ear: '#bf7f35', tongue: true, collar: '#d9574a' });
  SH_certificate(c, X0 + 51, dy, 44, 32);
  SH_rosette(c, X0 + 62, dy + 42, '#d9574a', 6); SH_rosette(c, X0 + 82, dy + 43, '#3f8fc4', 5.5);
  SH_photoFrame(c, X0 + 102, dy - 1, 36, 46, '#d9a441', '#f9c9d4', { coat: '#9aa3ad', muzzle: '#ffffff', mask: '#ffffff', ear: '#6f7882', earType: 'point', collar: '#3aa89a' }, true);
  var w1x = X0 + 3.5 * T + 16;
  SH_windowFrame(c, w1x, dy + 2, 64, 58);
  SH_windowGlass(c, w1x, dy + 2, 64, 58, 0, 0, 1);
  SH_windowTrim(c, w1x, dy + 2, 64, 58, 0, 1, '#5fb3a6');
  var fx = X0 + 5 * T + 5;
  SH_rect(c, fx, dy + 4, 24, 20, '#fbf1d8', SH_OUT, 1.6, 3);
  SH_fill(c, fx + 2, dy + 19, 20, 3, '#e6d6b4');
  SH_fill(c, fx + 10, dy + 8, 4, 12, '#d9574a'); SH_fill(c, fx + 6, dy + 12, 12, 4, '#d9574a');
  SH_rect(c, fx + 8, dy + 1.5, 8, 3, '#918b80', SH_OUT, 1, 1);
}
function SH_wallDecorB(c) {                              // middle: clock, key hooks, chalk price board
  var G = SH_G, T = SH_TL, X0 = G.ix0, dy = G.wallY0 + 20, i;
  SH_clockBody(c, SH_CLOCK.x, SH_CLOCK.y, SH_CLOCK.r);
  var kx = X0 + 5 * T + 64;
  SH_rect(c, kx, dy + 6, 26, 6, '#a8743f', SH_OUT, 1.4, 2);
  var kc = ['#d9574a', '#f2c14e', '#3aa89a'];
  for (i = 0; i < 3; i++) {
    SH_line(c, kx + 5 + i * 8, dy + 10, kx + 5 + i * 8, dy + 15, '#5a4a40', 1.4);
    SH_ell(c, kx + 5 + i * 8, dy + 17.5, 2.6, 2.6, null, '#918b80', 1.3);
    SH_rect(c, kx + 3.4 + i * 8, dy + 19.5, 3.2, 5.5, kc[i], SH_OUT, 0.8, 1);
  }
  SH_chalkboard(c, X0 + 7 * T + 9, dy, 78, 62);
}
function SH_wallDecorC(c) {                              // right: window over the desk, Pup of the Day board
  var G = SH_G, T = SH_TL, X0 = G.ix0, dy = G.wallY0 + 20;
  var w2x = X0 + 9 * T + 16;
  SH_windowFrame(c, w2x, dy + 2, 64, 58);
  SH_windowGlass(c, w2x, dy + 2, 64, 58, 0, 0, 2);
  SH_windowTrim(c, w2x, dy + 2, 64, 58, 0, 2, '#5fb3a6');
  SH_corkboard(c, X0 + 11 * T + 7, dy, 82, 64);
}
function SH_wallFrame(c) {                               // corner posts, top plate, scalloped valance
  var G = SH_G, T = SH_TL, X0 = G.ix0, X1 = G.ix1, Y1 = G.floorY0, i;
  for (i = 0; i < 2; i++) {
    var px = i ? X1 : G.x0;
    SH_rect(c, px, G.eaveY, T, Y1 - G.eaveY, '#8a5a33', SH_OUT, 2);
    SH_fill(c, px + 2, G.eaveY + 2, 3, Y1 - G.eaveY - 4, '#a8743f');
    SH_fill(c, px + T - 12, G.eaveY + 2, 10, Y1 - G.eaveY - 4, '#7a4e2a');
    SH_grain(c, px + 6, G.eaveY + 16, T - 20, Y1 - G.eaveY - 24, 'rgba(59,42,32,0.22)', 7, 31 + i, true);
    SH_rect(c, px - 2, Y1 - 12, T + 4, 12, '#7a4e2a', SH_OUT, 1.8, 2);
    SH_fill(c, px, Y1 - 10.5, T, 1.6, '#a8743f');
  }
  SH_rect(c, G.x0 - 4, G.eaveY - 2, G.x1 - G.x0 + 8, 13, '#7a4e2a', SH_OUT, 2, 2);
  SH_fill(c, G.x0 - 2, G.eaveY - 0.5, G.x1 - G.x0 + 4, 2, '#a8743f');
  var n = 30, vw = (G.x1 - G.x0) / n;
  for (i = 0; i < n; i++) {
    var ax = G.x0 + i * vw, ay = G.eaveY + 10;
    c.beginPath(); c.moveTo(ax, ay); c.lineTo(ax + vw, ay); c.lineTo(ax + vw, ay + 6); c.quadraticCurveTo(ax + vw, ay + 14, ax + vw / 2, ay + 14); c.quadraticCurveTo(ax, ay + 14, ax, ay + 6); c.closePath();
    SH_fs(c, (i % 2) ? '#fbf1d8' : '#d9574a', SH_OUT, 1.5);
    SH_fill(c, ax + 2, ay + 1, vw - 4, 1.5, (i % 2) ? '#ffffff' : '#ec7565');
  }
  SH_line(c, X0, Y1, X1, Y1, SH_OUT, 2);
}
// bake units of the wall: [fn, x, y, w, h]
function SH_wallUnits() {
  var G = SH_G, T = SH_TL, X0 = G.ix0, X1 = G.ix1, Y0 = G.wallY0, Y1 = G.floorY0, dy = Y0 + 20, U = [], i;
  function base(a, b) { return function (c) { SH_wallBase(c, a - 2, b + 2); }; }      // overlap so unit seams stay opaque
  var cuts = [0, 3, 6, 9, 13];
  for (i = 0; i < 4; i++) { var a = X0 + cuts[i] * T, b = X0 + cuts[i + 1] * T; U.push([base(a, b), a, Y0, b - a, Y1 - Y0]); }
  U.push([SH_wallDecorA, X0, dy - 14, 5 * T + 31, 86], [SH_wallDecorB, X0 + 5 * T + 26, dy - 14, 4 * T - 32, 86], [SH_wallDecorC, X0 + 9 * T - 6, dy - 14, 4 * T + 6, 86]);
  U.push([SH_wallFrame, G.x0 - 6, G.eaveY - 4, T + 8, Y1 - G.eaveY + 6], [SH_wallFrame, X1 - 2, G.eaveY - 4, T + 8, Y1 - G.eaveY + 6]);
  U.push([SH_wallFrame, G.x0 + T, G.eaveY - 4, G.x1 - G.x0 - 2 * T, 32], [SH_wallFrame, X0, Y1 - 2, X1 - X0, 4]);
  return U;
}
function SH_wallStatic(c) {                              // everything at once (plain vector path)
  var G = SH_G;
  SH_wallBase(c, G.ix0, G.ix1); SH_wallDecorA(c); SH_wallDecorB(c); SH_wallDecorC(c); SH_wallFrame(c);
}
// --- animated bits of the wall ---
var SH_WINFN = [0, 1, 2, 3, 4, 5, 6, 7, 8].map(function (L) {      // both windows at dusk level L/8
  return function (c) {
    var G = SH_G, T = SH_TL, X0 = G.ix0, dy = G.wallY0 + 20, w1x = X0 + 3.5 * T + 16, w2x = X0 + 9 * T + 16;
    SH_windowGlass(c, w1x, dy + 2, 64, 58, L / 8, 0, 1); SH_windowTrim(c, w1x, dy + 2, 64, 58, 0, 1, '#5fb3a6');
    SH_windowGlass(c, w2x, dy + 2, 64, 58, L / 8, 0, 2); SH_windowTrim(c, w2x, dy + 2, 64, 58, 0, 2, '#5fb3a6');
  };
});
var SH_CLOCK = { x: SH_G.ix0 + 6 * SH_TL, y: SH_G.wallY0 + 34, r: 13 };
var SH_PEND = [-4, -3, -2, -1, 0, 1, 2, 3, 4].map(function (k) {   // the clock's wagging bone pendulum
  return function (c) {
    c.save(); c.translate(SH_CLOCK.x, SH_CLOCK.y + SH_CLOCK.r + 0.6); c.rotate(k * 0.0875);
    SH_line(c, 0, 0, 0, 5.5, SH_OUT, 2.6); SH_line(c, 0, 0.5, 0, 5.5, '#d9a441', 1.1);
    SH_bone(c, 0, 7.5, 11, 5, '#fbf1d8', SH_OUT, 1, 0);
    c.restore();
  };
});
function SH_wallDynamic(c, t, state, m) {                // blits only; the live clock hands are drawn by SH_backDynamic
  var G = SH_G, T = SH_TL, X0 = G.ix0, dy = G.wallY0 + 20;
  var L = Math.round(SH_clamp(SH_num(state.night, 0), 0, 1) * 8);
  if (L > 0) {
    SH_part(c, m, 'win1_' + L, X0 + 3.5 * T + 10, dy - 9, 76, 80, SH_WINFN[L]);
    SH_part(c, m, 'win2_' + L, X0 + 9 * T + 10, dy - 9, 76, 80, SH_WINFN[L]);
  }
  var k = Math.round(Math.sin(t * 3.2) * 4);
  SH_part(c, m, 'pend' + k, SH_CLOCK.x - 13, SH_CLOCK.y + SH_CLOCK.r - 1, 26, 21, SH_PEND[k + 4], 'pend0');
}
function SH_clockHandsLive(c, dayFrac) {
  var cx = SH_CLOCK.x, cy = SH_CLOCK.y, r = SH_CLOCK.r;
  var hrs = 8 + SH_clamp(SH_num(dayFrac, 0.3), 0, 1.4) * 10;
  var ha = (hrs % 12) / 12 * Math.PI * 2 - Math.PI / 2, ma = (hrs % 1) * Math.PI * 2 - Math.PI / 2;
  SH_line(c, cx, cy, cx + Math.cos(ha) * (r - 7.5), cy + Math.sin(ha) * (r - 7.5), SH_OUT, 2);
  SH_line(c, cx, cy, cx + Math.cos(ma) * (r - 5), cy + Math.sin(ma) * (r - 5), '#d9574a', 1.3);
  SH_fill(c, cx - 1.2, cy - 1.2, 2.4, 2.4, SH_OUT);
}

// =========================================================================================
// FURNITURE AGAINST THE BACK WALL (tile row 20)
// =========================================================================================
// open shelving unit: bays = [{w, shelves:[top y of each board, relative to the unit's top]}]
function SH_shelfUnit(c, x0, x1, yb, h, bays, wood) {
  var wd = wood || '#8a5a33', lt = SH_lt(wd, 0.25), dk = SH_dk(wd, 0.3), top = yb - h, w = x1 - x0, i, j;
  SH_rect(c, x0 + 1, top - 8, w - 2, 8, SH_lt(wd, 0.18), SH_OUT, 1.8, 1.5);         // top surface
  SH_fill(c, x0 + 3, top - 6.5, w - 6, 1.5, SH_lt(wd, 0.45));
  SH_rect(c, x0 + 1, top, w - 2, h, '#5a3a22', SH_OUT, 1.8);                          // dark interior
  SH_fill(c, x0 + 2, top + 4, w - 4, 5, 'rgba(30,18,8,0.3)');
  var bx = x0 + 1;
  for (i = 0; i < bays.length; i++) {
    var b = bays[i];
    for (j = 0; j < b.shelves.length; j++) {
      var sy = top + b.shelves[j];
      SH_fill(c, bx + 2, sy + 4, b.w - 4, 4, 'rgba(30,18,8,0.3)');                   // shadow under the board
    }
    bx += b.w;
  }
  return { top: top, wood: wd, lt: lt, dk: dk };
}
function SH_shelfFront(c, x0, x1, yb, h, bays, wood) {  // boards, posts, kick (drawn after the products)
  var wd = wood || '#8a5a33', top = yb - h, w = x1 - x0, i, j, bx = x0 + 1;
  for (i = 0; i < bays.length; i++) {
    var b = bays[i], bw = (i === bays.length - 1) ? (x1 - 1 - bx) : b.w;
    for (j = 0; j < b.shelves.length; j++) {
      var sy = top + b.shelves[j];
      SH_rect(c, bx, sy, bw, 4, SH_lt(wd, 0.2), '#4a2f1c', 1.1);
      SH_fill(c, bx + 1, sy + 0.7, bw - 2, 1.1, SH_lt(wd, 0.5));
    }
    if (i > 0) { SH_rect(c, bx - 2.5, top, 5, h - 5, wd, '#4a2f1c', 1.1); SH_fill(c, bx - 1.6, top + 1, 1.1, h - 7, SH_lt(wd, 0.3)); }
    bx += b.w;
  }
  SH_rect(c, x0 + 1, top, 5, h, wd, SH_OUT, 1.4); SH_fill(c, x0 + 2.2, top + 1, 1.2, h - 2, SH_lt(wd, 0.3));
  SH_rect(c, x1 - 6, top, 5, h, SH_dk(wd, 0.12), SH_OUT, 1.4);
  SH_rect(c, x0 + 1, top, w - 2, 5, wd, SH_OUT, 1.4); SH_fill(c, x0 + 2.5, top + 1, w - 5, 1.2, SH_lt(wd, 0.35));
  SH_rect(c, x0 + 1, yb - 6, w - 2, 6, SH_dk(wd, 0.25), SH_OUT, 1.4);
  SH_rect(c, x0 + 1, top, w - 2, h, null, SH_OUT, 1.8);
}
var SH_SHELF_H = 92;

function SH_shelfFood(c) {
  var G = SH_G, T = SH_TL, x0 = G.ix0, x1 = x0 + 3 * T, yb = G.shelfY, h = SH_SHELF_H, top = yb - h;
  var bays = [{ w: 48, shelves: [42, 86] }, { w: 47, shelves: [28, 57, 86] }, { w: 47, shelves: [28, 57, 86] }];
  SH_shelfUnit(c, x0, x1, yb, h, bays);
  var a = x0 + 7, s1, s2, s3;
  // bay 1: big kibble sacks
  s1 = top + 42; s2 = top + 86;
  SH_bag(c, a, s1, 17, 33, '#d9574a'); SH_bag(c, a + 18.5, s1, 17, 31, '#3aa89a', 'bone');
  SH_bag(c, a + 0.5, s2, 18, 36, '#f2c14e'); SH_bag(c, a + 19, s2, 17, 34, '#7fb069', 'bone');
  // bay 2: tins, treat boxes, jars
  a = x0 + 52; s1 = top + 28; s2 = top + 57; s3 = top + 86;
  var cc = ['#d9574a', '#3f8fc4', '#f2c14e', '#7fb069', '#a58bd6'], i;
  for (i = 0; i < 5; i++) SH_can(c, a + 1 + i * 8, s1, 7.4, 9, cc[i]);
  for (i = 0; i < 4; i++) SH_can(c, a + 5 + i * 8, s1 - 9, 7.4, 9, cc[(i + 2) % 5]);
  SH_treatBox(c, a + 1, s2, 12, 20, '#3aa89a'); SH_treatBox(c, a + 14, s2, 12, 22, '#d9574a'); SH_treatBox(c, a + 27, s2, 12, 19, '#a58bd6');
  SH_bag(c, a + 1, s3, 14, 23, '#f2a0b5'); SH_bag(c, a + 16, s3, 14, 24, '#66bde3', 'bone');
  for (i = 0; i < 2; i++) SH_can(c, a + 32, s3 - i * 9, 8, 9, cc[i + 3]);
  // bay 3: more bags, chews in a jar, bowls
  a = x0 + 99; 
  SH_treatBox(c, a + 1, s1, 11, 21, '#f2c14e'); SH_treatBox(c, a + 13, s1, 11, 19, '#3f8fc4');
  // glass jar of bone biscuits
  SH_rect(c, a + 26.5, s1 - 19, 13, 19, 'rgba(210,235,240,0.55)', SH_OUT, 1.1, 2.5);
  SH_bone(c, a + 33, s1 - 5, 9, 4, '#d9a05a', '#7a4e2a', 0.5, 0.3); SH_bone(c, a + 33, s1 - 10, 9, 4, '#c98c48', '#7a4e2a', 0.5, -0.4); SH_bone(c, a + 33, s1 - 14, 8, 3.6, '#d9a05a', '#7a4e2a', 0.5, 0.1);
  SH_rect(c, a + 27.5, s1 - 22, 11, 3.6, '#d9574a', SH_OUT, 1, 1.2);
  SH_fill(c, a + 28.2, s1 - 17, 1.2, 12, 'rgba(255,255,255,0.7)');
  SH_bag(c, a + 1, s2, 13, 22, '#7fb069'); SH_bag(c, a + 14.5, s2, 13, 23, '#d9574a', 'bone'); SH_bag(c, a + 28, s2, 12.5, 21, '#f2c14e');
  SH_bowlStack(c, a + 1, s3, 17, ['#d9574a', '#3f8fc4', '#f2c14e', '#cfc9bc']);
  SH_bag(c, a + 21, s3, 19, 25, '#a58bd6');
  SH_shelfFront(c, x0, x1, yb, h, bays);
  SH_priceTag(c, x0 + 20, top + 42.2); SH_priceTag(c, x0 + 68, top + 28.2, '#f7e08a'); SH_priceTag(c, x0 + 114, top + 57.2); SH_priceTag(c, x0 + 66, top + 86.2); SH_priceTag(c, x0 + 22, top + 86.2, '#f7e08a');
}
function SH_shelfToys(c) {
  var G = SH_G, T = SH_TL, x0 = G.ix0 + 3 * T, x1 = x0 + 2 * T, yb = G.shelfY, h = SH_SHELF_H, top = yb - h;
  var bays = [{ w: 95, shelves: [30, 57, 86] }], wood = '#9a6a3c';
  SH_shelfUnit(c, x0, x1, yb, h, bays, wood);
  var s1 = top + 30, s2 = top + 57, s3 = top + 86;
  // top: soft toys
  SH_plush(c, x0 + 17, s1, 5.6, '#b98247'); SH_plush(c, x0 + 36, s1, 5.2, 'duck'); SH_plush(c, x0 + 56, s1, 5.2, 'bunny'); SH_plush(c, x0 + 76, s1, 5.6, '#e9dcc0');
  SH_ball(c, x0 + 88, s1 - 4, 3.8, '#d9574a');
  // middle: frisbees, ropes, squeaky bone, rubber ring
  SH_frisbees(c, x0 + 8, s2, 22, ['#d9574a', '#f2c14e', '#3aa89a', '#a58bd6']);
  SH_ropeToy(c, x0 + 36, s2 - 4, x0 + 58, s2 - 4, '#fbf1d8', '#3f8fc4');
  SH_ropeToy(c, x0 + 38, s2 - 10.5, x0 + 56, s2 - 10.5, '#fbf1d8', '#d9574a');
  SH_bone(c, x0 + 73, s2 - 5, 20, 8, '#66bde3', SH_OUT, 1, 0);
  SH_ell(c, x0 + 74, s2 - 15, 6.5, 5.5, null, SH_OUT, 5); SH_ell(c, x0 + 74, s2 - 15, 6.5, 5.5, null, '#f2a0b5', 2.8);
  // bottom: wire bin of tennis balls, basket of chew toys
  var bx = x0 + 8, i;
  var bp = [[4, -6], [12, -5], [20, -6], [28, -5], [8, -12], [16, -11.5], [24, -12], [12, -18], [20, -17.5], [4, -17.5], [28, -17]];
  for (i = 0; i < bp.length; i++) SH_ball(c, bx + 2 + bp[i][0], s3 + bp[i][1] + 1, 4.2, (i % 4 === 3) ? '#f2a0b5' : (i % 5 === 2) ? '#66bde3' : '#cfe04f');
  SH_wireBasket(c, bx, s3, 36, 17);
  SH_ropeToy(c, x0 + 58, s3 - 12, x0 + 66, s3 - 25, '#f2c14e', '#d9574a');
  SH_bone(c, x0 + 76, s3 - 18, 18, 7, '#fbf1d8', SH_OUT, 1, -0.9);
  SH_ball(c, x0 + 84, s3 - 17, 4.4, '#a58bd6');
  SH_basket(c, x0 + 52, s3, 38, 15);
  SH_shelfFront(c, x0, x1, yb, h, bays, wood);
  // bunting along the top edge
  var cols = ['#d9574a', '#f2c14e', '#3aa89a', '#a58bd6', '#f2a0b5', '#66bde3'];
  c.beginPath(); c.moveTo(x0 + 6, top + 5); c.quadraticCurveTo(x0 + 48, top + 10, x1 - 6, top + 5); c.strokeStyle = '#5e3c22'; c.lineWidth = 1; c.stroke();
  for (i = 0; i < 9; i++) {
    var u = (i + 0.5) / 9, px = x0 + 6 + u * 84, py = top + 5 + Math.sin(u * Math.PI) * 2.6;
    SH_poly(c, [px - 3.6, py, px + 3.6, py, px, py + 6.5], cols[i % 6], SH_OUT, 0.9);
  }
  SH_priceTag(c, x0 + 30, top + 57.2, '#f7e08a'); SH_priceTag(c, x0 + 60, top + 30.2);
}
function SH_leash(c, x, y, len, col, sw) {              // a leash looped over a peg, clip at the bottom
  c.beginPath(); c.moveTo(x - 2.2, y); c.quadraticCurveTo(x - 4.5 + sw * 0.5, y + len * 0.55, x - 0.6 + sw, y + len);
  c.moveTo(x + 2.2, y); c.quadraticCurveTo(x + 4.5 + sw * 0.5, y + len * 0.55, x + 0.6 + sw, y + len);
  c.strokeStyle = SH_OUT; c.lineWidth = 3.4; c.stroke(); c.strokeStyle = col; c.lineWidth = 1.8; c.stroke();
  c.beginPath(); c.arc(x, y, 2.3, Math.PI, 0); c.strokeStyle = SH_OUT; c.lineWidth = 3.4; c.stroke(); c.strokeStyle = col; c.lineWidth = 1.8; c.stroke();
  SH_rect(c, x - 1.6 + sw, y + len - 0.5, 3.2, 5.5, '#cfc9bc', SH_OUT, 0.9, 1.4);
  SH_ell(c, x + sw, y + len + 6.2, 1.7, 1.7, null, '#918b80', 1.1);
  SH_ell(c, x, y - 1.2, 1.5, 1.5, '#d9a441', SH_OUT, 0.8);
}
function SH_collar(c, x, y, col) {
  SH_ell(c, x, y - 1.2, 1.5, 1.5, '#d9a441', SH_OUT, 0.8);
  SH_ell(c, x, y + 5, 5, 5.6, null, SH_OUT, 3.4); SH_ell(c, x, y + 5, 5, 5.6, null, col, 1.9);
  SH_rect(c, x - 2, y + 9, 4, 3, '#cfc9bc', SH_OUT, 0.8, 0.8);
  SH_ell(c, x, y + 14.4, 2, 2, '#f2c14e', SH_OUT, 0.8);
}
function SH_rackLeashes(c) {
  var G = SH_G, T = SH_TL, x0 = G.ix0 + 5 * T, x1 = x0 + 2 * T, yb = G.shelfY, i;
  // pegboard on the wall
  var py0 = yb - 128, py1 = yb - 56;
  SH_rect(c, x0 + 5, py0, 86, py1 - py0, '#a8743f', SH_OUT, 1.8, 2);
  SH_rect(c, x0 + 8.5, py0 + 3.5, 79, py1 - py0 - 7, '#efe0bd', '#5e3c22', 1);
  c.fillStyle = '#cdb98d';
  for (var gy = py0 + 8; gy < py1 - 5; gy += 5) for (var gx = x0 + 13; gx < x0 + 86; gx += 5) c.fillRect(gx, gy, 1.1, 1.1);
  SH_fill(c, x0 + 9, py0 + 4, 78, 3, 'rgba(60,36,16,0.10)');
  // hanging leashes, harness, collars
  var lc = ['#d9574a', '#3aa89a', '#f2c14e', '#a58bd6'];
  for (i = 0; i < 4; i++) SH_leash(c, x0 + 16 + i * 10.5, py0 + 10, 38 + (i % 2) * 6, lc[i], (i - 1.5) * 0.5);
  // harness
  var hx = x0 + 66, hy = py0 + 10;
  SH_ell(c, hx, hy - 1.2, 1.5, 1.5, '#d9a441', SH_OUT, 0.8);
  SH_line(c, hx, hy, hx, hy + 4, SH_OUT, 3.4); SH_line(c, hx, hy, hx, hy + 4, '#3f8fc4', 1.8);
  SH_ell(c, hx, hy + 8, 4.2, 4.2, null, SH_OUT, 3.6); SH_ell(c, hx, hy + 8, 4.2, 4.2, null, '#3f8fc4', 2);          // neck loop
  SH_ell(c, hx, hy + 20.5, 7, 6.2, null, SH_OUT, 3.6); SH_ell(c, hx, hy + 20.5, 7, 6.2, null, '#3f8fc4', 2);        // chest loop
  SH_rect(c, hx - 3.2, hy + 11, 6.4, 6.5, '#3f8fc4', SH_OUT, 1, 1.5); SH_paw(c, hx, hy + 14.4, 1.9, '#fbf1d8');     // back plate
  SH_rect(c, hx - 2, hy + 25.2, 4, 3, '#cfc9bc', SH_OUT, 0.8, 0.8);
  SH_collar(c, x0 + 82, py0 + 10, '#d9574a');
  SH_collar(c, x0 + 83, py0 + 38, '#7fb069');
  // poop-bag rolls on a little peg shelf
  // low cabinet with towel cubbies
  var h = 42, top = yb - h;
  SH_rect(c, x0 + 1, top - 11, 94, 11, '#b98247', SH_OUT, 1.8, 1.5); SH_fill(c, x0 + 3, top - 9.5, 90, 1.6, '#dcae70');
  SH_rect(c, x0 + 1, top, 94, h, '#8a5a33', SH_OUT, 1.8);
  SH_rect(c, x0 + 6, top + 6, 40, h - 14, '#5a3a22', '#4a2f1c', 1.1); SH_rect(c, x0 + 50, top + 6, 40, h - 14, '#5a3a22', '#4a2f1c', 1.1);
  SH_fill(c, x0 + 7, top + 7, 38, 4, 'rgba(30,18,8,0.3)'); SH_fill(c, x0 + 51, top + 7, 38, 4, 'rgba(30,18,8,0.3)');
  SH_towelStack(c, x0 + 9, top + h - 8, 34, ['#66bde3', '#fbf1d8', '#f2a0b5', '#66bde3']);
  SH_towelStack(c, x0 + 53, top + h - 8, 34, ['#f2c14e', '#3aa89a', '#fbf1d8']);
  SH_fill(c, x0 + 2.5, top + 1.2, 91, 1.5, '#a8743f');
  SH_rect(c, x0 + 1, yb - 6, 94, 6, '#6b4426', SH_OUT, 1.4);
  // on top: folded towels and a roll dispenser
  SH_towelStack(c, x0 + 8, top - 3, 30, ['#a58bd6', '#fbf1d8', '#3aa89a']);
  SH_rect(c, x0 + 60, top - 17, 24, 13, '#fbf1d8', SH_OUT, 1.3, 2);
  SH_fill(c, x0 + 78, top - 16, 5, 11, '#e6d6b4');
  SH_paw(c, x0 + 69, top - 10.5, 3, '#3aa89a'); 
  SH_rect(c, x0 + 66, top - 5.5, 12, 2.2, '#3b2a20', null, 0, 1);
  SH_poly(c, [x0 + 68, top - 4.5, x0 + 76, top - 4.5, x0 + 75, top - 0.5, x0 + 69, top - 0.5], '#7fb069', SH_OUT, 0.8);
}
function SH_shelfGrooming(c) {
  var G = SH_G, T = SH_TL, x0 = G.ix0 + 7 * T, x1 = x0 + 2 * T, yb = G.shelfY, h = SH_SHELF_H, top = yb - h, i;
  var bays = [{ w: 47, shelves: [30, 57, 86] }, { w: 48, shelves: [30, 57, 86] }];
  SH_shelfUnit(c, x0, x1, yb, h, bays);
  var s1 = top + 30, s2 = top + 57, s3 = top + 86;
  // top: shampoos and sprays
  SH_bottle(c, x0 + 9, s1, 9, 23, '#3aa89a', 'pump'); SH_bottle(c, x0 + 21, s1, 9, 21, '#f2a0b5', 'pump'); SH_bottle(c, x0 + 33, s1, 9, 22, '#a58bd6', 'cap');
  SH_bottle(c, x0 + 54, s1, 9, 23, '#66bde3', 'spray'); SH_bottle(c, x0 + 67, s1, 10, 19, '#f2c14e', 'cap'); SH_bottle(c, x0 + 79.5, s1, 9, 23, '#7fb069', 'pump');
  // middle: brushes, comb, clippers, cotton jar, rubber duck
  SH_brush(c, x0 + 8, s2, '#c9935a'); SH_brush(c, x0 + 19, s2, '#d9574a');
  // comb
  SH_rect(c, x0 + 30, s2 - 18, 4, 18, '#3f8fc4', SH_OUT, 1, 1); c.fillStyle = SH_OUT; for (i = 0; i < 7; i++) c.fillRect(x0 + 34, s2 - 16.5 + i * 2.2, 3.4, 0.8);
  // nail clippers
  c.beginPath(); c.moveTo(x0 + 53, s2 - 1); c.lineTo(x0 + 59, s2 - 16); c.moveTo(x0 + 59, s2 - 1); c.lineTo(x0 + 53, s2 - 16);
  c.strokeStyle = SH_OUT; c.lineWidth = 3.4; c.stroke(); c.strokeStyle = '#cfc9bc'; c.lineWidth = 1.6; c.stroke();
  SH_line(c, x0 + 53, s2 - 1, x0 + 55, s2 - 6, '#d9574a', 2.2); SH_line(c, x0 + 59, s2 - 1, x0 + 57, s2 - 6, '#d9574a', 2.2);
  // jar of cotton balls
  SH_rect(c, x0 + 63, s2 - 17, 13, 17, 'rgba(210,235,240,0.55)', SH_OUT, 1.1, 2.5);
  for (i = 0; i < 6; i++) SH_ell(c, x0 + 66.5 + (i % 2) * 5.5, s2 - 3.5 - Math.floor(i / 2) * 4.4, 2.8, 2.6, '#ffffff', '#b9b2a4', 0.6);
  SH_rect(c, x0 + 62, s2 - 20, 15, 3.6, '#cfc9bc', SH_OUT, 1, 1.2);
  SH_plush(c, x0 + 83, s2, 3.4, 'duck');
  // bottom: rolled towels, bucket with sponge
  var tc = ['#66bde3', '#fbf1d8', '#f2a0b5', '#fbf1d8', '#3aa89a', '#f2c14e'];
  for (i = 0; i < 4; i++) SH_towelRoll(c, x0 + 11.5 + i * 9.4, s3 - 5, 4.8, tc[i]);
  for (i = 0; i < 3; i++) SH_towelRoll(c, x0 + 16.2 + i * 9.4, s3 - 13.2, 4.8, tc[i + 3]);
  SH_poly(c, [x0 + 58, s3 - 17, x0 + 82, s3 - 17, x0 + 79.5, s3, x0 + 60.5, s3], '#3f8fc4', SH_OUT, 1.3);
  SH_fill(c, x0 + 74, s3 - 16, 6, 15, '#3577a8');
  SH_rect(c, x0 + 62, s3 - 23, 11, 7, '#f2c14e', SH_OUT, 1, 2); c.fillStyle = '#c99a2e'; c.fillRect(x0 + 64, s3 - 21, 1.4, 1.4); c.fillRect(x0 + 68, s3 - 20, 1.4, 1.4); c.fillRect(x0 + 66, s3 - 18.5, 1.2, 1.2);
  SH_ell(c, x0 + 77, s3 - 19.5, 3, 3, 'rgba(255,255,255,0.75)', '#8fb8cc', 0.7); SH_ell(c, x0 + 73.6, s3 - 17.6, 2, 2, 'rgba(255,255,255,0.75)', '#8fb8cc', 0.7);
  SH_rect(c, x0 + 56.5, s3 - 18.6, 27, 3.2, '#66bde3', SH_OUT, 1.1, 1.5);
  SH_shelfFront(c, x0, x1, yb, h, bays);
  SH_priceTag(c, x0 + 16, top + 30.2); SH_priceTag(c, x0 + 62, top + 30.2, '#f7e08a'); SH_priceTag(c, x0 + 24, top + 86.2);
}
function SH_deskStatic(c) {
  var G = SH_G, T = SH_TL, x0 = G.ix0 + 9 * T, x1 = x0 + 2 * T, yb = G.shelfY, h = 34, top = yb - h, ty0 = top - 44, i;
  // stool tucked in the knee hole
  // desk body
  SH_rect(c, x0 + 2, top, 92, h, '#a8743f', SH_OUT, 1.8);
  SH_rect(c, x0 + 40, top + 5, 50, h - 5, '#5a3a22', '#4a2f1c', 1.2);                // knee hole
  SH_fill(c, x0 + 41, top + 6, 48, 6, 'rgba(30,18,8,0.35)');
  // stool
  SH_rect(c, x0 + 55, yb - 15, 3, 15, '#7a4e2a', SH_OUT, 1); SH_rect(c, x0 + 73, yb - 15, 3, 15, '#7a4e2a', SH_OUT, 1);
  SH_line(c, x0 + 57, yb - 6, x0 + 74, yb - 6, '#7a4e2a', 2);
  SH_ell(c, x0 + 65.5, yb - 17, 14, 5.5, '#d9574a', SH_OUT, 1.5); SH_ell(c, x0 + 63, yb - 18.5, 8, 2, '#ec7565', null);
  // drawers
  for (i = 0; i < 2; i++) {
    SH_rect(c, x0 + 6, top + 5 + i * 14, 30, 11.5, '#b98247', '#5e3c22', 1.2, 1.5);
    SH_fill(c, x0 + 7.2, top + 6.2 + i * 14, 27.6, 1.3, '#dcae70');
    SH_ell(c, x0 + 21, top + 11 + i * 14, 2.2, 2.2, '#d9a441', SH_OUT, 0.9);
  }
  SH_rect(c, x0 + 2, yb - 4, 36, 4, '#7a4e2a', SH_OUT, 1.2);
  // desktop
  SH_rect(c, x0, ty0, 96, 44, '#c9935a', SH_OUT, 1.8, 2);
  SH_grain(c, x0 + 4, ty0 + 4, 88, 34, 'rgba(122,78,42,0.22)', 9, 17);
  SH_fill(c, x0 + 2, ty0 + 1.5, 92, 1.8, '#e2b77a');
  SH_rect(c, x0, top - 3, 96, 5, '#8a5a33', SH_OUT, 1.6, 1.5);
  // blotter + keyboard + mouse
  SH_rect(c, x0 + 26, ty0 + 24, 44, 16, '#3f7d6f', '#2a5a50', 1, 2);
  SH_rect(c, x0 + 31, ty0 + 27, 30, 9, '#ece6da', SH_OUT, 1.1, 1.5);
  c.fillStyle = '#9a9488'; for (i = 0; i < 3; i++) for (var j = 0; j < 9; j++) c.fillRect(x0 + 33 + j * 3, ty0 + 28.6 + i * 2.4, 1.8, 1.3);
  SH_ell(c, x0 + 66, ty0 + 32, 2.6, 3.4, '#ece6da', SH_OUT, 1);
  // monitor
  SH_rect(c, x0 + 42, ty0 + 12, 8, 7, '#8d877b', SH_OUT, 1.1);
  SH_ell(c, x0 + 46, ty0 + 20, 10, 3, '#a39d90', SH_OUT, 1.2);
  SH_rect(c, x0 + 27, ty0 - 14, 38, 28, '#ece6da', SH_OUT, 1.8, 3);
  SH_rect(c, x0 + 30, ty0 - 11, 32, 20, '#2f4a55', '#3b2a20', 1, 1.5);
  SH_ell(c, x0 + 46, ty0 + 11.6, 1, 1, '#7fb069', null);
  SH_deskScreen(c);
  // telephone (left)
  SH_rect(c, x0 + 5, ty0 + 18, 18, 12, '#d9574a', SH_OUT, 1.4, 3);
  SH_fill(c, x0 + 7, ty0 + 26, 14, 2.5, '#b8463c');
  c.fillStyle = '#fbf1d8'; for (i = 0; i < 3; i++) for (j = 0; j < 3; j++) c.fillRect(x0 + 12.5 + j * 3, ty0 + 20.5 + i * 2.6, 1.7, 1.5);
  SH_rect(c, x0 + 3.5, ty0 + 14, 7, 18, '#b8463c', SH_OUT, 1.3, 3.2);
  SH_fill(c, x0 + 5, ty0 + 16, 1.4, 13, '#ec7565');
  c.beginPath(); c.moveTo(x0 + 7, ty0 + 32); c.bezierCurveTo(x0 + 6, ty0 + 38, x0 + 14, ty0 + 34, x0 + 13, ty0 + 40); c.strokeStyle = SH_OUT; c.lineWidth = 1.2; c.stroke();
  // appointment book + pen (right)
  SH_poly(c, [x0 + 72, ty0 + 22, x0 + 93, ty0 + 22, x0 + 94, ty0 + 39, x0 + 71, ty0 + 39], '#fbf1d8', SH_OUT, 1.3);
  SH_line(c, x0 + 82.5, ty0 + 22, x0 + 82.5, ty0 + 39, '#b9a784', 1.1);
  c.fillStyle = '#b9a784'; for (i = 0; i < 5; i++) { c.fillRect(x0 + 74, ty0 + 25 + i * 2.8, 7, 0.9); c.fillRect(x0 + 84, ty0 + 25 + i * 2.8, 7.5, 0.9); }
  SH_fill(c, x0 + 84, ty0 + 27.8, 5, 0.9, '#d9574a'); SH_fill(c, x0 + 74, ty0 + 33.4, 4, 0.9, '#3aa89a');
  SH_fill(c, x0 + 81.6, ty0 + 20, 1.8, 6, '#d9574a');
  SH_line(c, x0 + 86, ty0 + 37, x0 + 94, ty0 + 30, SH_OUT, 2.8); SH_line(c, x0 + 86, ty0 + 37, x0 + 94, ty0 + 30, '#3f8fc4', 1.4);
  // pencil cup
  SH_line(c, x0 + 72, ty0 + 6, x0 + 70, ty0 - 4, '#f2c14e', 1.8); SH_line(c, x0 + 75, ty0 + 6, x0 + 76, ty0 - 5, '#d9574a', 1.8); SH_line(c, x0 + 73.5, ty0 + 6, x0 + 73.5, ty0 - 6, '#3aa89a', 1.8);
  SH_rect(c, x0 + 68.5, ty0 + 1, 10, 11, '#a58bd6', SH_OUT, 1.2, 1.5); SH_fill(c, x0 + 75, ty0 + 2, 2.6, 9, '#8a72b8');
  // coffee mug
  SH_ell(c, x0 + 92, ty0 + 13.5, 3, 3.4, null, SH_OUT, 3.2); SH_ell(c, x0 + 92, ty0 + 13.5, 3, 3.4, null, '#fbf1d8', 1.4);
  SH_rect(c, x0 + 82.5, ty0 + 7.5, 9, 11, '#fbf1d8', SH_OUT, 1.2, 2);
  SH_ell(c, x0 + 87, ty0 + 8.3, 3.6, 1.4, '#6b4426', '#3b2a20', 0.8);
  SH_paw(c, x0 + 87, ty0 + 14, 2.3, '#d9574a');
  // desk lamp (left back corner)
  SH_ell(c, x0 + 14, ty0 + 9, 7, 2.6, '#3aa89a', SH_OUT, 1.3);
  c.beginPath(); c.moveTo(x0 + 14, ty0 + 8); c.lineTo(x0 + 9, ty0 - 8); c.lineTo(x0 + 17, ty0 - 18);
  c.strokeStyle = SH_OUT; c.lineWidth = 3.2; c.stroke(); c.strokeStyle = '#d9a441'; c.lineWidth = 1.4; c.stroke();
  SH_ell(c, x0 + 9, ty0 - 8, 1.8, 1.8, '#d9a441', SH_OUT, 0.9);
  SH_poly(c, [x0 + 13, ty0 - 21, x0 + 22, ty0 - 17, x0 + 27, ty0 - 7, x0 + 12, ty0 - 10], '#3aa89a', SH_OUT, 1.5);
  SH_poly(c, [x0 + 22.5, ty0 - 15, x0 + 26, ty0 - 8, x0 + 20, ty0 - 9.2], '#2f857a', null);
  SH_ell(c, x0 + 19.5, ty0 - 8, 5.2, 1.8, '#fff3c4', SH_OUT, 0.9, 0.2);
}
var SH_DESK = { x0: SH_G.ix0 + 9 * SH_TL, ty0: SH_G.shelfY - 34 - 44 };
var SH_SCREEN_COLS = ['#7fb069', '#f2c14e', '#f2a0b5', '#66bde3'];
function SH_deskScreen(c) {                              // what the monitor shows: a little booking calendar
  var sx = SH_DESK.x0 + 31, sy = SH_DESK.ty0 - 10, i;
  SH_fill(c, sx, sy, 30, 3.6, '#3aa89a'); SH_paw(c, sx + 3, sy + 1.9, 1.4, '#fbf1d8');
  SH_fill(c, sx + 7, sy + 1.2, 12, 1.2, '#fbf1d8');
  for (i = 0; i < 8; i++) SH_fill(c, sx + 1.5 + (i % 4) * 7.2, sy + 5.5 + Math.floor(i / 4) * 6.2, 6, 5, SH_SCREEN_COLS[(i * 3) % 4]);
  c.strokeStyle = 'rgba(255,255,255,0.25)'; c.lineWidth = 1.6; c.beginPath(); c.moveTo(sx + 1, sy + 14); c.lineTo(sx + 12, sy); c.stroke();
}
var SH_STEAM = [0, 1, 2, 3, 4, 5, 6, 7].map(function (f) {       // steam curling off the coffee mug
  return function (c) {
    for (var i = 0; i < 2; i++) {
      var p = ((f + 0.5) / 8 + i * 0.5) % 1, mx = SH_DESK.x0 + 87 + Math.sin(p * 6 + i * 3) * 1.8, my = SH_DESK.ty0 + 6 - p * 11;
      c.globalAlpha = 0.55 * (1 - p);
      c.beginPath(); c.moveTo(mx, my); c.quadraticCurveTo(mx + 2, my - 2, mx, my - 4); c.strokeStyle = '#ffffff'; c.lineWidth = 1.3; c.stroke();
    }
    c.globalAlpha = 1;
  };
});
function SH_deskGlow(c) {                                // desk lamp switched on
  var x0 = SH_DESK.x0, ty0 = SH_DESK.ty0;
  SH_poly(c, [x0 + 14, ty0 - 8, x0 + 25, ty0 - 7, x0 + 42, ty0 + 30, x0 + 2, ty0 + 30], 'rgba(255,233,166,0.22)', null);
  SH_ell(c, x0 + 19.5, ty0 - 8, 5.2, 1.8, '#fff3c4', null, 0, 0.2);
}
// everything that moves on the back wall and the furniture in front of it
function SH_backDynamic(c, t, state, m) {
  var x0 = SH_DESK.x0, ty0 = SH_DESK.ty0;
  SH_wallDynamic(c, t, state, m);
  var f = Math.floor((((t * 0.5) % 1) + 1) % 1 * 8) % 8;
  SH_part(c, m, 'steam' + f, x0 + 80, ty0 - 10, 16, 18, SH_STEAM[f], 'steam0');
  var n = SH_num(state.night, 0);
  if (n > 0.2) {
    c.globalAlpha = SH_clamp((n - 0.2) / 0.3, 0, 1);
    SH_part(c, m, 'deskglow', x0, ty0 - 12, 46, 44, SH_deskGlow);
    c.globalAlpha = 1;
  }
  // live: clock hands, the highlighted calendar cell and the blinking cursor on the monitor
  SH_live(c, m);
  SH_clockHandsLive(c, state.dayFrac);
  var sx = x0 + 31, sy = ty0 - 10, cell = ((Math.floor(t / 2.5) % 8) + 8) % 8;
  SH_fill(c, sx + 1.5 + (cell % 4) * 7.2, sy + 5.5 + Math.floor(cell / 4) * 6.2, 6, 5, '#fbf1d8');
  if ((((t * 1.6) % 1) + 1) % 1 < 0.5) SH_fill(c, sx + 22, sy + 1.1, 1.2, 1.6, '#fbf1d8');
  SH_dev(c, m);
}
function SH_carrier(c, x, yb, w, h, col) {              // plastic pet carrier, door facing us
  var lt = SH_lt(col, 0.35), dk = SH_dk(col, 0.2);
  SH_rect(c, x + w * 0.3, yb - h - 5, w * 0.4, 6, '#5a4a40', SH_OUT, 1.2, 2);            // handle
  SH_rect(c, x, yb - h, w, h, '#ece6da', SH_OUT, 1.7, 5);
  c.save(); SH_rrPath(c, x, yb - h, w, h, 5); c.clip();
  SH_fill(c, x, yb - h, w, h * 0.5, col);
  SH_fill(c, x + w * 0.78, yb - h, w * 0.22, h * 0.5, dk); SH_fill(c, x + w * 0.78, yb - h * 0.5, w * 0.22, h * 0.5, '#d6cfc0');
  SH_fill(c, x + 2, yb - h + 1.5, w - 10, 1.5, lt);
  c.restore();
  SH_fill(c, x + 0.8, yb - h * 0.5 - 1, w - 1.6, 2, SH_dk(col, 0.4));
  // vents
  c.fillStyle = SH_dk(col, 0.45);
  for (var i = 0; i < 3; i++) { c.fillRect(x + 3, yb - h + 5 + i * 3, 4.5, 1.3); c.fillRect(x + w - 7.5, yb - h + 5 + i * 3, 4.5, 1.3); }
  // wire door
  var dw = w * 0.56, dh = h * 0.7, dx = x + (w - dw) / 2, dy = yb - h * 0.5 - dh / 2 + 1;
  SH_rect(c, dx, dy, dw, dh, '#4a3426', SH_OUT, 1.2, 2.5);
  SH_fill(c, dx + 2, dy + dh - 7, dw - 4, 5.5, '#f2a0b5'); SH_fill(c, dx + 2, dy + dh - 7, dw - 4, 1.2, '#f9c9d4');  // blanket inside
  c.strokeStyle = '#d8d2c6'; c.lineWidth = 0.9;
  for (var gx = dx + 3.5; gx < dx + dw - 1; gx += 3.6) { c.beginPath(); c.moveTo(gx, dy + 1); c.lineTo(gx, dy + dh - 1); c.stroke(); }
  c.beginPath(); c.moveTo(dx + 1, dy + dh * 0.5); c.lineTo(dx + dw - 1, dy + dh * 0.5); c.stroke();
  SH_rect(c, dx + dw - 1.2, dy + dh * 0.5 - 2.5, 3, 5, '#cfc9bc', SH_OUT, 0.8, 1);
  SH_rect(c, x, yb - h, w, h, null, SH_OUT, 1.7, 5);
}
function SH_crates(c) {
  var G = SH_G, T = SH_TL, x0 = G.ix0 + 11 * T, yb = G.shelfY;
  SH_carrier(c, x0 + 3, yb, 45, 33, '#3aa89a');
  SH_carrier(c, x0 + 49, yb, 44, 31, '#f2c14e');
  SH_carrier(c, x0 + 8, yb - 34.5, 40, 29, '#d9574a');
  // folded blankets + a chew bone on the right-hand carrier
  var by = yb - 32.5;
  SH_towelStack(c, x0 + 54, by, 34, ['#a58bd6', '#fbf1d8', '#d9574a', '#66bde3']);
  c.strokeStyle = 'rgba(255,255,255,0.4)'; c.lineWidth = 0.8;
  for (var i = 0; i < 6; i++) { c.beginPath(); c.moveTo(x0 + 58 + i * 5, by - 10.4); c.lineTo(x0 + 58 + i * 5, by - 15.4); c.stroke(); }
  SH_bone(c, x0 + 71, by - 24.5, 20, 8, '#fbf1d8', SH_OUT, 1, -0.15);
  // name tag on the top carrier
  SH_rect(c, x0 + 12, yb - 62, 9, 5, '#fbf1d8', SH_OUT, 0.8, 1); 
}

// =========================================================================================
// THE RECEPTION COUNTER with cash register and desk bell
// =========================================================================================
var SH_REG = { x: SH_G.regX, y: SH_G.ctrTopY1 - 5 };      // base (front centre) of the register on the countertop
var SH_BELL = { x: SH_G.bellX, y: SH_G.ctrTopY1 - 9 };    // base of the bell
var SHOP_POINTS = { register: { x: SH_REG.x, y: SH_REG.y - 56 }, bell: { x: SH_BELL.x, y: SH_BELL.y - 22 } };

function SH_counterStatic(c) {
  var G = SH_G, T = SH_TL, x0 = G.ctrX0, x1 = G.ctrX1 + 6, yb = G.ctrY1, h = G.ctrH, top = yb - h, ty0 = G.ctrTopY0, w = x1 - x0, i;
  // ---- front ----
  SH_rect(c, x0, top, w, h, '#a8743f', SH_OUT, 2);
  SH_fill(c, x0 + 1, top + 5, w - 2, 5, 'rgba(59,42,32,0.22)');                     // shadow under the top's overhang
  var n = Math.round((G.ctrX1 - x0) / T);
  for (i = 0; i < n; i++) {
    var px = x0 + i * T + 5, py = top + 11, pw = T - 10, ph = h - 22;
    SH_rect(c, px, py, pw, ph, '#b98247', '#7a4e2a', 1.2, 2);
    SH_fill(c, px + 1.2, py + 1.2, pw - 2.4, 1.4, '#dcae70'); SH_fill(c, px + 1.2, py + 1.2, 1.4, ph - 2.4, '#dcae70');
    SH_fill(c, px + 1.2, py + ph - 2.8, pw - 2.4, 1.6, '#9c6a38'); SH_fill(c, px + pw - 2.8, py + 1.2, 1.6, ph - 2.4, '#9c6a38');
    if (i % 2 === 1) SH_paw(c, px + pw / 2, py + ph / 2 - 0.5, 5.2, '#9c6a38');
    else SH_bone(c, px + pw / 2, py + ph / 2, 18, 7.5, '#9c6a38', null);
  }
  // end post and kick board
  SH_rect(c, x1 - 10, top, 10, h, '#8a5a33', SH_OUT, 1.6); SH_fill(c, x1 - 8.6, top + 6, 1.4, h - 13, '#b98247');
  SH_rect(c, x0, yb - 6, w, 6, '#6b4426', SH_OUT, 1.5);
  SH_fill(c, x0 + 2, yb - 5, w - 4, 1.2, '#8a5a33');
  // ---- countertop ----
  SH_rect(c, x0 - 0.5, ty0, w + 4, top - ty0 + 2, '#e4bb82', SH_OUT, 2, 2);
  c.save(); c.beginPath(); c.rect(x0 + 1, ty0 + 1, w + 1, top - ty0); c.clip();
  SH_fill(c, x0, ty0 + 34, w + 4, 16, '#dcb077');
  SH_line(c, x0, ty0 + 17, x1 + 4, ty0 + 17, 'rgba(168,116,63,0.55)', 1); SH_line(c, x0, ty0 + 34, x1 + 4, ty0 + 34, 'rgba(168,116,63,0.55)', 1);
  for (i = 0; i < 7; i++) { var jx = x0 + 30 + i * 57 + SH_h(i, 4) * 20; SH_line(c, jx, ty0 + (i % 3) * 17, jx, ty0 + (i % 3) * 17 + 17, 'rgba(168,116,63,0.55)', 1); }
  SH_grain(c, x0 + 4, ty0 + 3, w - 6, 44, 'rgba(168,116,63,0.3)', 22, 8);
  SH_fill(c, x0 + 2, ty0 + 1.6, w, 2, '#f4d9a6');
  // worn glossy streaks
  c.fillStyle = 'rgba(255,248,225,0.35)';
  SH_poly(c, [x0 + 120, ty0 + 4, x0 + 132, ty0 + 4, x0 + 112, ty0 + 30, x0 + 100, ty0 + 30], 'rgba(255,248,225,0.28)', null);
  SH_poly(c, [x0 + 138, ty0 + 4, x0 + 142, ty0 + 4, x0 + 122, ty0 + 30, x0 + 118, ty0 + 30], 'rgba(255,248,225,0.28)', null);
  SH_poly(c, [x0 + 330, ty0 + 8, x0 + 340, ty0 + 8, x0 + 322, ty0 + 32, x0 + 312, ty0 + 32], 'rgba(255,248,225,0.24)', null);
  c.restore();
  SH_rect(c, x0 - 0.5, top + 1, w + 4, 6, '#b98247', SH_OUT, 1.8, 2);                // front edge of the slab
  SH_fill(c, x0 + 1.5, top + 2.2, w, 1.4, '#dcae70');

  // ---- things on the counter (register and bell are drawn live) ----
  var by = G.ctrTopY1 - 8;                                                        // base line for small items
  // little plant by the wall
  SH_shadow(c, x0 + 15, by + 1, 9, 3, 0.18);
  SH_pottedPlant(c, x0 + 14, by + 1, 0.5, 0, 'snake', '#3aa89a');
  // tip jar with a heart tag
  var tx = SH_REG.x + 42;
  SH_shadow(c, tx, by + 1, 8, 2.6, 0.18);
  SH_rect(c, tx - 6, by - 13, 12, 14, 'rgba(214,238,243,0.6)', SH_OUT, 1.2, 3);
  SH_ell(c, tx - 1.5, by - 2.5, 2.6, 1.6, '#f2c14e', '#a87a1e', 0.7); SH_ell(c, tx + 2, by - 4.4, 2.6, 1.6, '#f2c14e', '#a87a1e', 0.7); SH_ell(c, tx - 1, by - 6.4, 2.6, 1.6, '#f6d978', '#a87a1e', 0.7);
  SH_fill(c, tx - 4.4, by - 11, 1.2, 9, 'rgba(255,255,255,0.75)');
  SH_rect(c, tx - 6.8, by - 15, 13.6, 3, '#cfc9bc', SH_OUT, 1, 1.2);
  SH_rect(c, tx + 4, by - 10, 7, 6, '#fbf1d8', SH_OUT, 0.8, 1);
  c.fillStyle = '#d9574a'; c.beginPath(); c.arc(tx + 6.5, by - 7.6, 1.1, 0, 7); c.arc(tx + 8.5, by - 7.6, 1.1, 0, 7); c.fill();
  SH_poly(c, [tx + 5.5, by - 7.2, tx + 9.5, by - 7.2, tx + 7.5, by - 4.9], '#d9574a', null);
  // treat jar
  var jx2 = SH_REG.x + 70;
  SH_shadow(c, jx2, by + 1, 11, 3, 0.18);
  SH_rect(c, jx2 - 9, by - 19, 18, 20, 'rgba(214,238,243,0.6)', SH_OUT, 1.4, 4);
  var bb = [[-3, -3, 0.4], [3.5, -4, -0.5], [-2.5, -8, -0.3], [3, -9.5, 0.5], [-1, -13, 0.1], [3.6, -14.5, -0.7]];
  for (i = 0; i < bb.length; i++) SH_bone(c, jx2 + bb[i][0], by + bb[i][1], 9.5, 4.2, (i % 2) ? '#d9a05a' : '#c98c48', '#7a4e2a', 0.5, bb[i][2]);
  SH_fill(c, jx2 - 6.8, by - 16, 1.6, 13, 'rgba(255,255,255,0.75)');
  SH_rect(c, jx2 - 10, by - 22.5, 20, 4.6, '#d9574a', SH_OUT, 1.3, 2); SH_fill(c, jx2 - 8.5, by - 21.7, 14, 1.2, '#ec7565');
  SH_ell(c, jx2, by - 24.5, 3, 2.2, '#b8463c', SH_OUT, 1.1);
  SH_rect(c, jx2 - 6.5, by - 9.5, 13, 6, '#fbf1d8', '#7a4e2a', 0.7, 1); SH_bone(c, jx2, by - 6.5, 8, 3.2, '#d9574a', null);
  // hand-sanitiser pump
  SH_shadow(c, SH_BELL.x - 38, by + 1, 6, 2.2, 0.18);
  SH_bottle(c, SH_BELL.x - 43, by + 1, 10, 21, '#66bde3', 'pump');
  // sign-in clipboard lying flat, pen on a chain
  var cx = SH_BELL.x + 50, cy = by - 5;
  SH_fill(c, cx - 13, cy - 7, 30, 19, 'rgba(40,26,12,0.16)');
  c.save(); c.translate(cx, cy); c.rotate(-0.08);
  SH_rect(c, -15, -10, 30, 20, '#8a5a33', SH_OUT, 1.4, 2);
  SH_rect(c, -12.5, -7.5, 25, 16, '#fffdf5', '#b9a784', 0.8);
  c.fillStyle = '#b9a784'; for (i = 0; i < 4; i++) c.fillRect(-7, -3.5 + i * 3.2, 16, 0.9);
  c.strokeStyle = '#3aa89a'; c.lineWidth = 1.1;
  for (i = 0; i < 3; i++) { c.beginPath(); c.moveTo(-10.8, -3.4 + i * 3.2); c.lineTo(-9.8, -2.4 + i * 3.2); c.lineTo(-8.2, -4.6 + i * 3.2); c.stroke(); }
  SH_rect(c, -6, -12, 12, 4.6, '#cfc9bc', SH_OUT, 1, 1.2); SH_fill(c, -4.5, -11, 9, 1, '#f2efe8');
  c.restore();
  // pen holder + chain + pen
  SH_ell(c, cx + 24, by - 1, 4, 2, '#4a3426', SH_OUT, 1.1);
  c.beginPath(); c.moveTo(cx + 24, by - 2); c.bezierCurveTo(cx + 30, by + 4, cx + 16, by + 5, cx + 12, by - 2);
  c.setLineDash([1.4, 1.6]); c.strokeStyle = '#6b6358'; c.lineWidth = 1.3; c.stroke(); c.setLineDash([]);
  SH_line(c, cx + 4, by - 9, cx + 13, by - 1, SH_OUT, 3.2); SH_line(c, cx + 4, by - 9, cx + 13, by - 1, '#d9574a', 1.6);
  SH_line(c, cx + 4, by - 9, cx + 3, by - 10, '#fbf1d8', 1.2);
  // CHECK-IN sign on a little stand
  var sx = G.ctrX1 - 60, sy = by - 21;
  SH_shadow(c, sx + 0, by + 1, 16, 3, 0.18);
  SH_rect(c, sx - 2.5, sy + 12, 5, 10, '#8a5a33', SH_OUT, 1.1); SH_rect(c, sx - 10, by - 2, 20, 4, '#7a4e2a', SH_OUT, 1.2, 1.5);
  SH_rect(c, sx - 32, sy - 4, 64, 19, '#7a4e2a', SH_OUT, 1.7, 3);
  SH_rect(c, sx - 29.5, sy - 1.5, 59, 14, '#fbf1d8', '#5e3c22', 0.9, 1.5);
  SH_txt(c, 'CHECK-IN', sx + 4.5, sy + 5.2, 12.5, '#d9574a', 'center');
  SH_paw(c, sx - 24.5, sy + 5.6, 2.6, '#3aa89a', -0.2);
  // flower vase at the open end
  var vx = G.ctrX1 - 13;
  SH_shadow(c, vx, by + 1, 6, 2.2, 0.18);
  var fl = [[-5, -22, '#f2a0b5'], [0, -27, '#fbf1d8'], [5, -21, '#f2c14e'], [-1, -18, '#d9574a']];
  for (i = 0; i < 4; i++) {
    SH_line(c, vx, by - 8, vx + fl[i][0], by + fl[i][1], '#3f7d3a', 1.4);
    SH_ell(c, vx + fl[i][0], by + fl[i][1], 3.4, 3.4, fl[i][2], SH_OUT, 1); SH_ell(c, vx + fl[i][0], by + fl[i][1], 1.2, 1.2, '#d9a441', null);
  }
  SH_poly(c, [vx - 4.5, by - 10, vx + 4.5, by - 10, vx + 3.5, by + 1, vx - 3.5, by + 1], '#66bde3', SH_OUT, 1.2);
  SH_fill(c, vx + 1.2, by - 9, 2.4, 9, '#3f8fc4'); SH_fill(c, vx - 3.4, by - 9, 1.1, 8, 'rgba(255,255,255,0.6)');
  // soft shadows where the register and bell stand
  SH_shadow(c, SH_REG.x + 2, SH_REG.y + 1, 32, 5.5, 0.2);
  SH_shadow(c, SH_BELL.x + 1, SH_BELL.y + 1.5, 14, 4, 0.2);
}
function SH_register(c, x, y, rt) {                       // x,y = base front centre; rt = seconds since the last sale
  var act = rt >= 0 && rt < 0.8, i, j;
  var open = 0, kick = 0, flag = 0;
  if (act) {
    if (rt < 0.14) { var u = rt / 0.14; open = 1 - (1 - u) * (1 - u); open *= 1.12; }
    else if (rt < 0.22) open = 1.12 - (rt - 0.14) / 0.08 * 0.12;
    else if (rt < 0.58) open = 1;
    else { var v = (rt - 0.58) / 0.22; open = 1 - v * v; }
    kick = Math.sin(rt * 30) * Math.exp(-rt * 10);
    flag = rt < 0.1 ? rt / 0.1 : rt < 0.55 ? 1 : Math.max(0, 1 - (rt - 0.55) / 0.2);
  }
  var d = open * 8;                                       // how far the drawer sticks out (screen px, towards the viewer)
  c.save(); c.translate(x, y); c.scale(1.25, 1.25);
  // pop-up price flag behind the top housing
  var fy = -40 - flag * 15;
  if (flag > 0.02) {
    SH_rect(c, -1, fy + 8, 2, 12, '#cfc9bc', SH_OUT, 0.8);
    SH_rect(c, -8, fy, 16, 10.5, '#fbf1d8', SH_OUT, 1.2, 1.5);
    SH_txt(c, '$', 0.3, fy + 5, 11, '#3f7d3a', 'center');
  }
  // body squashes a touch on the ka-ching
  c.save(); c.scale(1 + kick * 0.035, 1 - kick * 0.06);
  // crank
  SH_line(c, 19, -22, 27, -29, SH_OUT, 3.4); SH_line(c, 19, -22, 27, -29, '#cfc9bc', 1.5);
  SH_ell(c, 27.5, -30, 3, 3, '#7a4e2a', SH_OUT, 1.2);
  // top housing
  SH_rect(c, -16, -41, 32, 19, '#e2ad42', SH_OUT, 1.8, 3);
  SH_fill(c, 9, -39.5, 5.5, 16, '#bd8a2a'); SH_fill(c, -14, -39.5, 26, 1.6, '#f6dc8c');
  SH_rect(c, -12, -37.5, 24, 9.5, '#3b2a20', '#7a5a1e', 1, 1.5);                    // glass window with number tabs
  var tabs = ['#fbf1d8', '#fbf1d8', '#f2c14e'];
  for (i = 0; i < 3; i++) {
    var up = (act && rt < 0.5) ? ((i === 1) ? 1.4 : 0.6) : 0;
    SH_fill(c, -10 + i * 7.2, -35.8 - up, 5.6, 6.6, tabs[i]);
    SH_fill(c, -8.6 + i * 7.2, -33.8 - up, 2.8, 1, '#7a4e2a'); SH_fill(c, -8.6 + i * 7.2, -31.8 - up, 2.8, 1, '#7a4e2a');
  }
  SH_line(c, -11, -29.6, -4, -36.6, 'rgba(255,255,255,0.3)', 1.2);
  SH_ell(c, 0, -25, 2.2, 1.6, '#bd8a2a', '#7a5a1e', 0.8);
  // crest
  c.beginPath(); c.moveTo(-9, -41); c.quadraticCurveTo(0, -50, 9, -41); c.closePath(); SH_fs(c, '#e2ad42', SH_OUT, 1.5);
  SH_paw(c, 0, -43.4, 2.2, '#7a5a1e');
  // key deck (sloping towards the viewer)
  SH_poly(c, [-16, -23, 16, -23, 20, -11, -20, -11], '#d39f38', SH_OUT, 1.8);
  SH_poly(c, [11, -22, 15.4, -22, 19, -12, 14, -12], '#bd8a2a', null);
  for (j = 0; j < 2; j++) for (i = 0; i < 5; i++) {
    var kx = -10.4 + i * 5.2 + (j ? -1 : 0) * (i - 2) * 0.3, ky = -19.6 + j * 4.6;
    var pressed = act && rt < 0.16 && j === 1 && i === 3;
    SH_ell(c, kx, ky + (pressed ? 0.8 : 0), 1.9, 1.5, pressed ? '#d9c9a4' : (i === 4 ? '#d9574a' : '#fbf1d8'), SH_OUT, 0.8);
  }
  c.restore();
  // wooden base
  SH_rect(c, -21, -12, 42, 12, '#7a4e2a', SH_OUT, 1.8, 2);
  SH_fill(c, -19.5, -10.8, 39, 1.4, '#a8743f');
  // drawer tray (seen from above when it slides out)
  if (d > 0.3) {
    SH_rect(c, -18, -9.5, 36, d + 1, '#3b2a20', SH_OUT, 1.2);
    c.save(); c.beginPath(); c.rect(-17.4, -9, 34.8, d); c.clip();
    for (i = 0; i < 3; i++) { SH_rect(c, -16.5 + i * 8.2, -8.6, 7, 7.2, '#8fc47a', '#3f7d3a', 0.7); SH_fill(c, -14.2 + i * 8.2, -6.2, 2.4, 2.4, '#5d9d49'); }
    for (i = 0; i < 3; i++) SH_ell(c, 10.5 + (i % 2) * 4.4, -7 + i * 1.9, 2.3, 1.6, '#f2c14e', '#a87a1e', 0.7);
    c.restore();
  }
  // drawer front
  SH_rect(c, -18, -9.5 + d, 36, 8.5, '#8a5a33', SH_OUT, 1.3, 1.5);
  SH_fill(c, -16.8, -8.4 + d, 33.6, 1.2, '#b98247');
  SH_rect(c, -5, -6.6 + d, 10, 3, '#e2ad42', SH_OUT, 0.9, 1.4);
  // ka-ching sparkle
  if (act && rt < 0.45) {
    var a = 1 - rt / 0.45, rr = 7 + rt * 26;
    c.globalAlpha = a; c.strokeStyle = '#fff3c4'; c.lineWidth = 1.6;
    for (i = 0; i < 5; i++) {
      var an = -Math.PI * 0.5 + (i - 2) * 0.6;
      c.beginPath(); c.moveTo(Math.cos(an) * rr, -50 + Math.sin(an) * rr); c.lineTo(Math.cos(an) * (rr + 4.5), -50 + Math.sin(an) * (rr + 4.5)); c.stroke();
    }
    c.globalAlpha = 1;
  }
  c.restore();
}
function SH_bell(c, x, y, bt) {                           // x,y = base centre; bt = seconds since it was rung
  var act = bt >= 0 && bt < 0.6, i;
  var press = 0, wob = 0;
  if (act) {
    press = bt < 0.05 ? bt / 0.05 : bt < 0.16 ? 1 - (bt - 0.05) / 0.11 : 0;
    wob = Math.sin(bt * 46) * Math.exp(-bt * 7.5);
  }
  c.save(); c.translate(x, y);
  SH_ell(c, 0, -1.5, 12, 4, '#4a3426', SH_OUT, 1.6);                                // base
  SH_ell(c, -2, -2.6, 7, 1.4, '#6b4e3a', null);
  c.save(); c.translate(0, -3); c.rotate(wob * 0.1); c.translate(wob * 0.9, 0);
  // plunger
  SH_rect(c, -1.3, -17 + press * 3, 2.6, 6, '#bd8a2a', SH_OUT, 1);
  SH_ell(c, 0, -17.4 + press * 3, 3.4, 2, '#f6dc8c', SH_OUT, 1.1);
  // dome
  c.beginPath(); c.moveTo(-10, 0); c.bezierCurveTo(-10, -8, -6.5, -12.5, 0, -12.5); c.bezierCurveTo(6.5, -12.5, 10, -8, 10, 0);
  c.quadraticCurveTo(0, 3, -10, 0); c.closePath(); SH_fs(c, '#eab946', SH_OUT, 1.7);
  c.save(); c.clip();
  SH_ell(c, 7, -2, 6, 11, '#c4912c', null);
  SH_ell(c, 0, 2.2, 11, 2.6, '#a87a1e', null);
  c.restore();
  c.beginPath(); c.arc(0, -1, 8.2, Math.PI * 1.12, Math.PI * 1.45); c.strokeStyle = '#fff3c4'; c.lineWidth = 2; c.stroke();
  SH_ell(c, -2.2, -9.6, 1.3, 0.8, '#fff3c4', null);
  c.restore();
  // "ding" lines
  if (act) {
    var a = 1 - bt / 0.6, r = 13 + bt * 22;
    c.globalAlpha = a; c.strokeStyle = '#fff3c4'; c.lineWidth = 1.8;
    for (i = 0; i < 2; i++) {
      var rr = r + i * 5;
      c.beginPath(); c.arc(0, -8, rr, Math.PI * 1.08, Math.PI * 1.3); c.stroke();
      c.beginPath(); c.arc(0, -8, rr, Math.PI * 1.7, Math.PI * 1.92); c.stroke();
    }
    c.strokeStyle = SH_OUT; c.lineWidth = 0.6;
    // a little note hopping up
    var ny = -22 - bt * 26, nx = 8 + Math.sin(bt * 12) * 3;
    SH_ell(c, nx, ny, 2.4, 1.8, '#fff3c4', SH_OUT, 0.9, -0.4);
    SH_line(c, nx + 2, ny - 0.5, nx + 2, ny - 8, SH_OUT, 2.2); SH_line(c, nx + 2, ny - 0.5, nx + 2, ny - 8, '#fff3c4', 1);
    SH_line(c, nx + 2, ny - 8, nx + 5.5, ny - 6, SH_OUT, 2.2); SH_line(c, nx + 2, ny - 8, nx + 5.5, ny - 6, '#fff3c4', 1);
    c.globalAlpha = 1;
  }
  c.restore();
}
// baked frames: 30 per second while the register (0.8 s) or the bell (0.6 s) is animating
function SH_registerIdle(c) { SH_register(c, SH_REG.x, SH_REG.y, 99); }
function SH_bellIdle(c) { SH_bell(c, SH_BELL.x, SH_BELL.y, 99); }
var SH_REGF = [], SH_BELLF = [];
(function () {
  function rf(i) { return function (c) { SH_register(c, SH_REG.x, SH_REG.y, (i + 0.5) / 30); }; }
  function bf(i) { return function (c) { SH_bell(c, SH_BELL.x, SH_BELL.y, (i + 0.5) / 30); }; }
  for (var i = 0; i < 24; i++) SH_REGF.push(rf(i));
  for (i = 0; i < 18; i++) SH_BELLF.push(bf(i));
})();
function SH_counterDynamic(c, t, state, m) {
  var rt = SH_num(state.registerT, 99), bt = SH_num(state.bellT, 99), f;
  var rx = Math.floor(SH_REG.x - 31), ry = Math.floor(SH_REG.y - 94), bx = Math.floor(SH_BELL.x - 38), by = Math.floor(SH_BELL.y - 56);
  if (rt >= 0 && rt < 0.8) { f = Math.min(23, Math.floor(rt * 30)); SH_part(c, m, 'reg' + f, rx, ry, 73, 106, SH_REGF[f], 'regIdle'); }
  else SH_part(c, m, 'regIdle', rx, ry, 73, 106, SH_registerIdle);
  if (bt >= 0 && bt < 0.6) { f = Math.min(17, Math.floor(bt * 30)); SH_part(c, m, 'bell' + f, bx, by, 76, 62, SH_BELLF[f], 'bellIdle'); }
  else SH_part(c, m, 'bellIdle', bx, by, 76, 62, SH_bellIdle);
}

// =========================================================================================
// OTHER FURNITURE: water cooler, towel basket, bench, displays, plants
// =========================================================================================
function SH_coolerStatic(c) {
  var G = SH_G, T = SH_TL, x = G.ix0 + 24, yb = G.floorY0 + 3 * T - 5;
  SH_shadow(c, x + 1, yb, 17, 5);
  // cabinet
  SH_rect(c, x - 13, yb - 40, 26, 40, '#f3ecdc', SH_OUT, 1.8, 3);
  SH_fill(c, x + 6, yb - 39, 6, 38, '#dcd3bf'); SH_fill(c, x - 11.5, yb - 38.5, 1.6, 36, '#ffffff');
  SH_rect(c, x - 9, yb - 34, 18, 13, '#cfe6ee', '#8fb8cc', 1, 2);                   // tap recess
  SH_rect(c, x - 6.5, yb - 32, 4.5, 5, '#3f8fc4', SH_OUT, 0.9, 1); SH_rect(c, x + 2, yb - 32, 4.5, 5, '#d9574a', SH_OUT, 0.9, 1);
  SH_rect(c, x - 8, yb - 22.5, 16, 2.5, '#a39d90', SH_OUT, 0.9, 1);                 // drip tray
  SH_rect(c, x - 9, yb - 15, 18, 11, '#e6dcc6', '#b9ae97', 1, 2); SH_paw(c, x, yb - 9.6, 3.2, '#66bde3');
  SH_rect(c, x - 13, yb - 3.5, 26, 3.5, '#a39d90', SH_OUT, 1.2, 1);
  // paper-cup tube on the side
  SH_rect(c, x + 13.5, yb - 36, 6, 18, '#fbf1d8', SH_OUT, 1.1, 1.5);
  c.strokeStyle = '#cbbf9f'; c.lineWidth = 0.8; for (var i = 0; i < 4; i++) { c.beginPath(); c.moveTo(x + 14.5, yb - 32 + i * 3.6); c.lineTo(x + 18.5, yb - 32 + i * 3.6); c.stroke(); }
  // collar + bottle
  SH_rect(c, x - 8, yb - 44, 16, 5, '#cfc9bc', SH_OUT, 1.3, 1.5);
  c.beginPath();
  c.moveTo(x - 5, yb - 44); c.lineTo(x - 5, yb - 47); c.quadraticCurveTo(x - 11.5, yb - 49, x - 11.5, yb - 54); c.lineTo(x - 11.5, yb - 68);
  c.quadraticCurveTo(x - 11.5, yb - 73, x - 6, yb - 73); c.lineTo(x + 6, yb - 73); c.quadraticCurveTo(x + 11.5, yb - 73, x + 11.5, yb - 68);
  c.lineTo(x + 11.5, yb - 54); c.quadraticCurveTo(x + 11.5, yb - 49, x + 5, yb - 47); c.lineTo(x + 5, yb - 44); c.closePath();
  SH_fs(c, '#a8dcf0', SH_OUT, 1.7);
  c.save(); c.clip();
  SH_fill(c, x - 12, yb - 66, 24, 24, '#7cc6e6'); SH_fill(c, x + 5, yb - 74, 7, 32, 'rgba(63,143,196,0.35)');
  SH_fill(c, x - 12, yb - 66.6, 24, 1.2, '#d4effa');
  c.restore();
  SH_line(c, x - 11, yb - 58, x + 11, yb - 58, 'rgba(63,143,196,0.55)', 1); SH_line(c, x - 11, yb - 62.5, x + 11, yb - 62.5, 'rgba(63,143,196,0.55)', 1);
  SH_fill(c, x - 8.6, yb - 70, 2, 14, 'rgba(255,255,255,0.7)');
}
function SH_bubble(c) { SH_ell(c, 0, 0, 1.6, 1.6, 'rgba(255,255,255,0.8)', '#5aa6cf', 0.6); }
function SH_coolerDynamic(c, t, state, m) {
  var G = SH_G, T = SH_TL, x = G.ix0 + 24, yb = G.floorY0 + 3 * T - 5;
  // now and then a few bubbles glug up through the bottle
  var ph = (((t % 7) + 7) % 7) / 7;
  if (ph < 0.22) {
    for (var i = 0; i < 3; i++) {
      var p = ph / 0.22 * 1.5 - i * 0.25;
      if (p <= 0 || p >= 1) continue;
      SH_part(c, m, 'bub', -3, -3, 6, 6, SH_bubble, null, x - 3 + i * 3 + Math.sin(p * 9 + i) * 1.2, yb - 48 - p * 17);
    }
  }
}
function SH_towelBasket(c) {
  var G = SH_G, T = SH_TL, x = G.ix0 + 24, yb = G.floorY0 + 4 * T - 6;
  SH_shadow(c, x + 1, yb, 20, 5);
  // rolled towels standing in the basket
  var cols = ['#66bde3', '#fbf1d8', '#f2a0b5', '#3aa89a'];
  for (var i = 0; i < 4; i++) {
    var tx = x - 13.5 + i * 9, ty = yb - 34 - (i % 2) * 3;
    SH_rect(c, tx - 4.4, ty, 8.8, 18, cols[i], SH_OUT, 1.2, 2);
    SH_ell(c, tx, ty + 0.5, 4.4, 2.2, SH_lt(cols[i], 0.3), SH_OUT, 1.1);
    c.beginPath(); c.arc(tx, ty + 0.5, 2, 0, Math.PI * 1.5); c.strokeStyle = SH_dk(cols[i], 0.3); c.lineWidth = 0.8; c.stroke();
  }
  SH_basket(c, x - 18, yb, 36, 22, '#cf9d62');
  // a towel draped over the rim
  c.beginPath(); c.moveTo(x + 4, yb - 24); c.lineTo(x + 15, yb - 24); c.lineTo(x + 16, yb - 10); c.quadraticCurveTo(x + 10, yb - 8, x + 5, yb - 11); c.closePath();
  SH_fs(c, '#f2c14e', SH_OUT, 1.2);
  SH_fill(c, x + 6, yb - 15, 9, 1.4, '#fbf1d8'); SH_fill(c, x + 6, yb - 18, 9, 1.4, '#fbf1d8');
  // handles
  c.beginPath(); c.arc(x - 18, yb - 17, 3.4, Math.PI * 0.5, Math.PI * 1.5); c.strokeStyle = SH_OUT; c.lineWidth = 3; c.stroke(); c.strokeStyle = '#b98247'; c.lineWidth = 1.3; c.stroke();
  c.beginPath(); c.arc(x + 18, yb - 17, 3.4, Math.PI * 1.5, Math.PI * 0.5); c.strokeStyle = SH_OUT; c.lineWidth = 3; c.stroke(); c.strokeStyle = '#b98247'; c.lineWidth = 1.3; c.stroke();
}
function SH_bench(c) {
  // a cushioned waiting bench along the left wall, seen from its south end
  var G = SH_G, T = SH_TL, x0 = G.ix0 + 2, x1 = G.ix0 + T - 5, y0 = G.ctrY0 + 3 * T, y1 = y0 + 3 * T - 4, sh = 17, i;
  var ty0 = y0 - sh + 5, ty1 = y1 - sh;                                            // seat top on screen
  SH_fill(c, x0 + 4, y0 + 10, x1 - x0 + 2, y1 - y0 - 8, 'rgba(40,26,12,0.2)');      // shadow under the seat
  // legs at the south end
  SH_rect(c, x0 + 9, ty1 + 3, 5, sh - 3, '#7a4e2a', SH_OUT, 1.3); SH_rect(c, x1 - 6, ty1 + 3, 5, sh - 3, '#6b4426', SH_OUT, 1.3);
  SH_rect(c, x0 + 13, ty1 + 9, x1 - x0 - 18, 3, '#7a4e2a', SH_OUT, 1);
  // seat boards
  SH_rect(c, x0 + 6, ty0, x1 - x0 - 5, ty1 - ty0, '#c9935a', SH_OUT, 1.8, 2);
  SH_line(c, x0 + 19, ty0 + 1, x0 + 19, ty1 - 1, 'rgba(122,78,42,0.5)', 1); SH_line(c, x0 + 30, ty0 + 1, x0 + 30, ty1 - 1, 'rgba(122,78,42,0.5)', 1);
  SH_fill(c, x0 + 7.5, ty0 + 1.5, 1.6, ty1 - ty0 - 3, '#e2b77a');
  SH_rect(c, x0 + 6, ty1 - 1, x1 - x0 - 5, 5, '#a8743f', SH_OUT, 1.6, 1.5);           // front edge of the seat
  // one long seat pad with tufted seams
  var px = x0 + 11, pw = x1 - x0 - 13, py = ty0 + 13, ph = ty1 - ty0 - 27;
  SH_rect(c, px, py, pw, ph, '#3aa89a', SH_OUT, 1.6, 6);
  SH_rect(c, px + 2.5, py + 2.5, pw - 5, ph - 5, null, '#7fd0c4', 1, 4);
  SH_fill(c, px + 3, py + ph - 6.5, pw - 6, 3.5, '#2f857a');
  for (i = 1; i < 3; i++) {
    var sy = py + ph * i / 3;
    SH_line(c, px + 2, sy, px + pw - 2, sy, '#2a6f66', 1.2); SH_line(c, px + 3, sy + 1.3, px + pw - 3, sy + 1.3, '#7fd0c4', 0.9);
  }
  for (i = 0; i < 3; i++) SH_ell(c, px + pw / 2, py + ph * (i + 0.5) / 3, 1.8, 1.8, '#2a6f66', null);
  // back rest along the wall (we see its top and its south end)
  SH_rect(c, x0 - 1, ty0 - 22, 10, ty1 - ty0 + 2, '#a8743f', SH_OUT, 1.7, 3);
  SH_fill(c, x0 + 0.6, ty0 - 20, 1.8, ty1 - ty0 - 3, '#d4a56d');
  for (i = 1; i < 6; i++) SH_line(c, x0, ty0 - 22 + (ty1 - ty0) * i / 6, x0 + 8, ty0 - 22 + (ty1 - ty0) * i / 6, '#7a4e2a', 1);
  SH_rect(c, x0 - 1, ty1 - 21, 10, 24, '#7a4e2a', SH_OUT, 1.7, 1.5);
  SH_fill(c, x0 + 0.6, ty1 - 19, 1.6, 20, '#9c6a38');
  // arm rests at both ends (raised above the seat) with their posts
  for (i = 0; i < 2; i++) {
    var ay = i ? ty1 - 15 : ty0 - 8;
    SH_rect(c, x1 - 5, ay + 5, 5, 12, '#7a4e2a', SH_OUT, 1.2);
    SH_rect(c, x0 + 6, ay, x1 - x0 - 3, 7, '#b98247', SH_OUT, 1.6, 3);
    SH_fill(c, x0 + 8, ay + 1.3, x1 - x0 - 8, 1.4, '#dcae70');
  }
  // throw pillow, a forgotten tennis ball, a magazine
  c.save(); c.translate(px + pw / 2 + 1, py + 12); c.rotate(0.5);
  SH_rect(c, -8.5, -8.5, 17, 17, '#f2c14e', SH_OUT, 1.4, 4); SH_rect(c, -6, -6, 12, 12, null, '#fbe59a', 0.9, 3);
  SH_paw(c, 0, 0, 3.6, '#d9574a', -0.5);
  c.restore();
  SH_ball(c, px + pw - 6, py + ph * 0.5, 4, '#cfe04f');
  c.save(); c.translate(px + pw / 2 - 1, py + ph - 13); c.rotate(-0.2);
  SH_rect(c, -9, -6.5, 18, 13, '#fbf1d8', SH_OUT, 1.1, 1);
  SH_fill(c, -8, -5.5, 16, 4, '#d9574a'); SH_paw(c, 0, 2, 2.6, '#3f8fc4'); 
  c.restore();
}
function SH_displayToys(c) {
  // a two-tier wooden crate stand overflowing with toys
  var G = SH_G, T = SH_TL, x0 = G.ix1 - 2 * T, yb = G.ctrY0 + 4 * T - 4, i;
  SH_shadow(c, x0 + 48, yb, 46, 6);
  // back crate (higher)
  var by = yb - 24;
  var toys = [[14, -20, '#cfe04f'], [26, -23, '#f2a0b5'], [64, -21, '#66bde3'], [80, -19, '#cfe04f']];
  SH_plush(c, x0 + 45, by - 14, 6.2, '#b98247');
  SH_plush(c, x0 + 70, by - 13, 5, 'bunny');
  SH_ropeToy(c, x0 + 18, by - 16, x0 + 10, by - 38, '#fbf1d8', '#d9574a');
  for (i = 0; i < toys.length; i++) SH_ball(c, x0 + toys[i][0], by + toys[i][1], 5.2, toys[i][2]);
  SH_bone(c, x0 + 34, by - 22, 20, 8, '#66bde3', SH_OUT, 1, 0.5);
  SH_rect(c, x0 + 6, by - 18, 84, 20, '#a8743f', SH_OUT, 1.7, 2);
  for (i = 0; i < 2; i++) { SH_fill(c, x0 + 7, by - 17 + i * 9.5, 82, 1.4, '#c9935a'); SH_line(c, x0 + 7, by - 8.8 + i * 9.5, x0 + 89, by - 8.8 + i * 9.5, '#7a4e2a', 1.1); }
  // front crate (lower)
  SH_plush(c, x0 + 22, yb - 19, 5.4, 'duck');
  SH_frisbees(c, x0 + 52, yb - 19, 24, ['#d9574a', '#f2c14e', '#3aa89a']);
  var t2 = [[38, -24, '#d9574a'], [47, -22, '#cfe04f'], [82, -23, '#a58bd6'], [10, -23, '#cfe04f']];
  for (i = 0; i < t2.length; i++) SH_ball(c, x0 + t2[i][0], yb + t2[i][1], 5.2, t2[i][2]);
  SH_ropeToy(c, x0 + 60, yb - 21, x0 + 84, yb - 29, '#fbf1d8', '#3f8fc4');
  SH_rect(c, x0 + 2, yb - 22, 92, 22, '#b98247', SH_OUT, 1.8, 2);
  SH_fill(c, x0 + 3.5, yb - 20.8, 89, 1.5, '#dcae70');
  SH_line(c, x0 + 3, yb - 11, x0 + 93, yb - 11, '#7a4e2a', 1.2); SH_fill(c, x0 + 3.5, yb - 10.2, 89, 1.3, '#cf9d62');
  SH_fill(c, x0 + 3, yb - 4, 90, 3, '#a8743f');
  for (i = 0; i < 2; i++) { var nx = i ? x0 + 88 : x0 + 8; SH_ell(c, nx, yb - 16.5, 1, 1, '#5e3c22', null); SH_ell(c, nx, yb - 5.5, 1, 1, '#5e3c22', null); }
  // TOYS label
  SH_rect(c, x0 + 32, yb - 18, 32, 12, '#fbf1d8', SH_OUT, 1.2, 2);
  SH_txt(c, 'TOYS', x0 + 48, yb - 12.2, 13, '#2f857a', 'center');
}
function SH_displayFood(c) {
  // stacked sacks on a pallet with a SALE burst
  var G = SH_G, T = SH_TL, x0 = G.ix1 - 2 * T, yb = G.ctrY0 + 6 * T - 4, i;
  SH_shadow(c, x0 + 48, yb, 47, 6);
  // pallet
  SH_rect(c, x0 + 3, yb - 6, 90, 6, '#a8743f', SH_OUT, 1.5, 1);
  for (i = 0; i < 3; i++) SH_rect(c, x0 + 6 + i * 37, yb - 3.4, 10, 3.4, '#5e3c22', null);
  SH_fill(c, x0 + 4.5, yb - 5.2, 87, 1.2, '#c9935a');
  function sack(sx, sy, w, h, col, label) {             // a sack lying flat, end towards us
    SH_rect(c, sx, sy - h, w, h, col, SH_OUT, 1.5, 5);
    c.save(); SH_rrPath(c, sx, sy - h, w, h, 5); c.clip();
    SH_fill(c, sx + w * 0.78, sy - h, w * 0.22, h, SH_dk(col, 0.2)); SH_fill(c, sx, sy - 3.4, w, 3.4, SH_dk(col, 0.16));
    SH_fill(c, sx + 3, sy - h + 1.6, w * 0.6, 1.5, SH_lt(col, 0.4));
    c.restore();
    SH_rect(c, sx + w * 0.28, sy - h + 3, w * 0.44, h - 6, '#fbf1d8', SH_dk(col, 0.35), 0.8, 2);
    if (label) SH_bone(c, sx + w / 2, sy - h / 2, w * 0.3, (h - 6) * 0.45, col, null); else SH_paw(c, sx + w / 2, sy - h / 2 - 0.3, (h - 6) * 0.3, col);
    SH_rect(c, sx, sy - h, w, h, null, SH_OUT, 1.5, 5);
  }
  sack(x0 + 5, yb - 6, 43, 13, '#d9574a', 0); sack(x0 + 49, yb - 6, 43, 13, '#3aa89a', 1);
  sack(x0 + 10, yb - 19, 40, 13, '#f2c14e', 1); sack(x0 + 51, yb - 19, 37, 13, '#7fb069', 0);
  sack(x0 + 22, yb - 32, 42, 13, '#a58bd6', 0);
  // one bag standing proudly on top
  SH_bag(c, x0 + 29, yb - 45, 22, 30, '#d9574a');
  SH_bag(c, x0 + 67, yb - 32, 18, 25, '#66bde3', 'bone');
  // SALE burst on a stick
  var sx = x0 + 15, sy = yb - 52;
  SH_line(c, sx, sy + 6, sx + 2, yb - 31, SH_OUT, 3); SH_line(c, sx, sy + 6, sx + 2, yb - 31, '#c9935a', 1.3);
  c.beginPath();
  for (i = 0; i < 20; i++) { var a = i / 20 * Math.PI * 2 + 0.1, r = (i % 2) ? 15.5 : 12; c.lineTo(sx + Math.cos(a) * r, sy + Math.sin(a) * r * 0.86); }
  c.closePath(); SH_fs(c, '#f2c14e', SH_OUT, 1.6);
  c.save(); c.translate(sx, sy + 0.5); c.rotate(-0.14);
  SH_txt(c, 'SALE', 0, -0.5, 14, '#d9574a', 'center');
  c.restore();
}

// =========================================================================================
// FRONT WALL (cut away low), street door, yard door, welcome mat
// =========================================================================================
function SH_bricks(c, x, y, w, h) {
  SH_fill(c, x, y, w, h, '#c9694a');
  var rows = Math.max(1, Math.round(h / 7)), rh = h / rows, r, bx, i;
  for (r = 0; r < rows; r++) {
    i = 0;
    for (bx = x - ((r % 2) ? 8 : 0); bx < x + w; bx += 16, i++) {
      var v = SH_h(i + Math.floor(x), r * 3 + 5), xa = Math.max(bx, x), xb = Math.min(bx + 16, x + w);
      if (v > 0.7) SH_fill(c, xa, y + r * rh, xb - xa, rh, '#d27b5c'); else if (v < 0.22) SH_fill(c, xa, y + r * rh, xb - xa, rh, '#b8573c');
      if (bx > x) SH_fill(c, bx - 0.5, y + r * rh, 1, rh, '#8f4230');
    }
    if (r) SH_fill(c, x, y + r * rh - 0.5, w, 1, '#8f4230');
    SH_fill(c, x, y + r * rh + 0.6, w, 0.9, 'rgba(255,220,190,0.22)');
  }
}
function SH_flowerBox(c, x, y, w, seed) {                // y = top edge of the trough
  var i, n = Math.floor((w - 8) / 9), cols = ['#d9574a', '#f2a0b5', '#f2c14e', '#fbf1d8', '#a58bd6'];
  // brackets
  SH_poly(c, [x + 8, y + 11, x + 12, y + 11, x + 8, y + 18], '#4a3a30', SH_OUT, 1);
  SH_poly(c, [x + w - 8, y + 11, x + w - 12, y + 11, x + w - 8, y + 18], '#4a3a30', SH_OUT, 1);
  // foliage
  for (i = 0; i <= n; i++) {
    var lx = x + 5 + i * (w - 10) / n;
    SH_ell(c, lx, y - 2, 6, 5.5, (i % 2) ? '#5d9d49' : '#3f7d3a', SH_OUT, 1.2);
  }
  for (i = 0; i <= n; i++) {
    var lx2 = x + 5 + i * (w - 10) / n;
    SH_ell(c, lx2 - 1.5, y - 3.5, 2.6, 2, (i % 2) ? '#7cc260' : '#5d9d49', null);
  }
  // blooms
  for (i = 0; i < n; i++) {
    var hx = SH_h(i, seed), fx = x + 9 + i * (w - 18) / Math.max(1, n - 1) + (hx - 0.5) * 3, fy = y - 7 - SH_h(i, seed + 3) * 6;
    var col = cols[Math.floor(SH_h(i, seed + 7) * cols.length)];
    if (SH_h(i, seed + 11) > 0.62) {                    // tulip
      SH_line(c, fx, fy + 3, fx, y - 1, '#3f7d3a', 1.3);
      c.beginPath(); c.moveTo(fx - 3.2, fy - 2.6); c.lineTo(fx - 1.4, fy - 0.8); c.lineTo(fx, fy - 3.4); c.lineTo(fx + 1.4, fy - 0.8); c.lineTo(fx + 3.2, fy - 2.6);
      c.quadraticCurveTo(fx + 3.6, fy + 3.6, fx, fy + 3.6); c.quadraticCurveTo(fx - 3.6, fy + 3.6, fx - 3.2, fy - 2.6); c.closePath(); SH_fs(c, col, SH_OUT, 1);
    } else {                                            // daisy-ish
      SH_ell(c, fx, fy, 3.6, 3.4, col, SH_OUT, 1);
      SH_ell(c, fx, fy, 1.3, 1.3, col === '#f2c14e' ? '#d9574a' : '#f2c14e', null);
    }
  }
  // trough
  SH_rect(c, x, y, w, 12, '#a8743f', SH_OUT, 1.6, 2);
  SH_fill(c, x + 1.5, y + 1.2, w - 3, 1.5, '#d4a56d'); SH_fill(c, x + 1.5, y + 8.5, w - 3, 2.4, '#8a5a33');
  SH_line(c, x + 2, y + 6, x + w - 2, y + 6, '#7a4e2a', 1);
  SH_paw(c, x + w / 2, y + 6.2, 3, '#7a4e2a');
  // trailing ivy at the ends
  for (i = 0; i < 2; i++) {
    var vx = i ? x + w - 5 : x + 5;
    c.beginPath(); c.moveTo(vx, y - 1); c.quadraticCurveTo(vx + (i ? 5 : -5), y + 5, vx + (i ? 2 : -2), y + 16); c.strokeStyle = '#3f7d3a'; c.lineWidth = 1.2; c.stroke();
    SH_ell(c, vx + (i ? 3.5 : -3.5), y + 5, 2.6, 2, '#5d9d49', SH_OUT, 0.9, 0.5); SH_ell(c, vx + (i ? 1.5 : -1.5), y + 11, 2.4, 1.9, '#7cc260', SH_OUT, 0.9, -0.4); SH_ell(c, vx + (i ? 3 : -3), y + 16, 2.2, 1.8, '#5d9d49', SH_OUT, 0.9);
  }
}
function SH_glassRun(c, xa, xb, yBase, h) {             // cut-off shop window: rail, mullions, a stub of glass
  var n = Math.max(1, Math.round((xb - xa) / 74)), pw = (xb - xa) / n, i;
  for (i = 0; i < n; i++) {
    var gx = xa + i * pw;
    c.fillStyle = 'rgba(196,232,244,0.30)'; c.fillRect(gx, yBase - h, pw, h);
    c.fillStyle = 'rgba(255,255,255,0.55)'; c.fillRect(gx, yBase - h, pw, 1.4);
    c.save(); c.beginPath(); c.rect(gx, yBase - h, pw, h); c.clip();
    c.strokeStyle = 'rgba(255,255,255,0.42)'; c.lineWidth = 4; c.beginPath(); c.moveTo(gx + pw * 0.2, yBase); c.lineTo(gx + pw * 0.2 + h, yBase - h); c.stroke();
    c.lineWidth = 1.6; c.beginPath(); c.moveTo(gx + pw * 0.2 + 8, yBase); c.lineTo(gx + pw * 0.2 + 8 + h, yBase - h); c.stroke();
    c.restore();
  }
  SH_rect(c, xa - 3, yBase - 3, xb - xa + 6, 7, '#8a5a33', SH_OUT, 1.6, 1.5);
  SH_fill(c, xa - 1.5, yBase - 2, xb - xa + 3, 1.5, '#b98247');
  for (i = 0; i <= n; i++) {
    var mx = xa + i * pw;
    SH_rect(c, mx - 2.5, yBase - h - 4, 5, h + 5, '#8a5a33', SH_OUT, 1.4, 1);
    SH_fill(c, mx - 1.5, yBase - h - 3, 1.2, h + 2, '#b98247');
  }
}
function SH_doorPost(c, x, yb, h) {                     // x = left edge, 14 wide
  SH_rect(c, x, yb - h, 14, h, '#7a4e2a', SH_OUT, 1.8);
  SH_fill(c, x + 1.5, yb - h + 2, 2, h - 4, '#a8743f'); SH_fill(c, x + 9.5, yb - h + 2, 3.2, h - 4, '#64401f');
  SH_grain(c, x + 4, yb - h + 6, 5, h - 16, 'rgba(59,42,32,0.3)', 3, x, true);
  SH_rect(c, x - 2, yb - 9, 18, 9, '#6b4426', SH_OUT, 1.6, 1.5); SH_fill(c, x - 0.5, yb - 7.8, 15, 1.4, '#8a5a33');
  SH_rect(c, x - 2.5, yb - h - 7, 19, 8, '#8a5a33', SH_OUT, 1.7, 2); SH_fill(c, x - 1, yb - h - 5.8, 16, 1.5, '#b98247');
  // lantern
  var cx = x + 7, ly = yb - h - 7;
  SH_rect(c, cx - 1.5, ly - 4, 3, 4, '#4a3a30', SH_OUT, 1);
  SH_rect(c, cx - 6, ly - 19, 12, 15, '#4a3a30', SH_OUT, 1.5, 1.5);
  SH_rect(c, cx - 4, ly - 17, 8, 11, '#f6e7c3', null);
  SH_fill(c, cx - 0.5, ly - 17, 1, 11, '#4a3a30');
  SH_poly(c, [cx - 8, ly - 19, cx + 8, ly - 19, cx + 3.5, ly - 25, cx - 3.5, ly - 25], '#5a4a40', SH_OUT, 1.5);
  SH_ell(c, cx, ly - 27, 2, 2, '#d9a441', SH_OUT, 1);
}
function SH_frontSide(c, i) {                            // i = 0: left of the street door, 1: right of it
  var G = SH_G, T = SH_TL, cut = G.cut, y0t = G.frontY0 - cut, y1t = G.frontY1 - cut, yb = G.frontY1;
  var xa = i ? G.doorX1 : G.x0, xb = i ? G.x1 : G.doorX0;
  // top of the cut wall
  SH_wallTopH(c, y0t, xa, xb);
  // street face: brick with a stone cap
  SH_bricks(c, xa, y1t, xb - xa, cut);
  SH_rect(c, xa, y1t, xb - xa, cut, null, SH_OUT, 2);
  SH_rect(c, xa - (i ? 0 : 2), y1t - 1.5, xb - xa + 2, 6, '#d8d2c4', SH_OUT, 1.6, 1.5);
  SH_fill(c, xa, y1t - 0.4, xb - xa - 2, 1.4, '#f2efe6');
  SH_rect(c, xa - (i ? 0 : 2), yb - 5, xb - xa + 2, 5, '#918b80', SH_OUT, 1.5, 1);
  // corner post top
  var px = i ? G.ix1 : G.x0;
  SH_rect(c, px, y0t, T, T, '#8a5a33', SH_OUT, 2);
  SH_rect(c, px + 7, y0t + 7, T - 14, T - 14, '#a8743f', '#5e3c22', 1.2, 2);
  SH_fill(c, px + 8.5, y0t + 8.5, T - 17, 1.6, '#c9935a');
  SH_paw(c, px + T / 2, y0t + T / 2, 7, '#8a5a33');
  SH_rect(c, px, y1t, T, cut, '#7a4e2a', SH_OUT, 2);
  SH_fill(c, px + 2, y1t + 2, 3, cut - 4, '#a8743f');
  SH_grain(c, px + 8, y1t + 3, T - 16, cut - 8, 'rgba(59,42,32,0.28)', 5, 40 + i, true);
  if (!i) {
    // shop-window stub, flower box, bracket for the hanging sign
    SH_glassRun(c, G.ix0 + 10, G.doorX0 - 26, y0t + 24, 28);
    SH_flowerBox(c, G.ix0 + 10, y1t + 5, 150, 3);
    var bx = G.doorX0 - 14, byy = yb - 60;
    c.beginPath(); c.moveTo(bx, byy); c.lineTo(bx - 50, byy); c.moveTo(bx, byy + 12); c.quadraticCurveTo(bx - 14, byy + 10, bx - 18, byy);
    c.strokeStyle = SH_OUT; c.lineWidth = 3.8; c.stroke(); c.strokeStyle = '#5a4a40'; c.lineWidth = 1.7; c.stroke();
    SH_ell(c, bx - 51, byy, 2.4, 2.4, '#d9a441', SH_OUT, 1);
  } else {
    SH_glassRun(c, G.doorX1 + 26, G.ix1 - 10, y0t + 24, 28);
    SH_flowerBox(c, G.doorX1 + 36, y1t + 5, 112, 7);
    SH_flowerBox(c, G.doorX1 + 166, y1t + 5, 100, 12);
    // brass paw plate by the door
    SH_rect(c, G.doorX1 + 18, y1t + 9, 13, 11, '#e2ad42', SH_OUT, 1.2, 2); SH_paw(c, G.doorX1 + 24.5, y1t + 14.6, 3.2, '#7a5a1e');
  }
}
function SH_frontL(c) { SH_frontSide(c, 0); }
function SH_frontR(c) { SH_frontSide(c, 1); }
function SH_frontPosts(c) {                              // door posts with lanterns
  var G = SH_G;
  SH_doorPost(c, G.doorX0 - 14, G.frontY1, 70);
  SH_doorPost(c, G.doorX1, G.frontY1, 70);
}
function SH_signArt(c, open, a) {                        // OPEN / CLOSED board hanging on two chains, swung by angle a
  var G = SH_G, bx = G.doorX0 - 14 - 27, byy = G.frontY1 - 60;
  c.save(); c.translate(bx, byy); c.rotate(a);
  SH_line(c, -15, 1, -15, 8, SH_OUT, 2.2); SH_line(c, 15, 1, 15, 8, SH_OUT, 2.2);
  SH_line(c, -15, 1, -15, 8, '#918b80', 1); SH_line(c, 15, 1, 15, 8, '#918b80', 1);
  SH_rect(c, -23, 7, 46, 21, '#7a4e2a', SH_OUT, 1.8, 3);
  if (open) {
    SH_rect(c, -20.5, 9.5, 41, 16, '#3aa89a', '#2a6f66', 1, 2);
    SH_txt(c, 'OPEN', 4, 17.2, 16, '#fbf1d8', 'center');
    SH_paw(c, -14.5, 17.6, 3.2, '#fbf1d8', -0.25);
  } else {
    SH_rect(c, -20.5, 9.5, 41, 16, '#d9574a', '#9c3a30', 1, 2);
    SH_txt(c, 'CLOSED', 0, 17.2, 14, '#fbf1d8', 'center');
  }
  c.restore();
}
var SH_SIGNF = [0, 1].map(function (o) {
  return [-3, -2, -1, 0, 1, 2, 3].map(function (k) { return function (c) { SH_signArt(c, o === 1, k * 0.02); }; });
});
function SH_lanternGlow(c) {                             // left door lantern lit (stamped again for the right one)
  var G = SH_G, cx = G.doorX0 - 7, ly = G.frontY1 - 77;
  SH_rect(c, cx - 4, ly - 17, 8, 11, '#ffe08a', null); SH_fill(c, cx - 0.5, ly - 17, 1, 11, '#4a3a30');
  SH_ell(c, cx, ly - 11.5, 13, 13, 'rgba(255,223,138,0.25)', null);
}
function SH_frontDynamic(c, t, state, m) {
  var G = SH_G;
  var o = (state && state.open === false) ? 0 : 1;
  var k = Math.round((Math.sin(t * 1.4) * 0.05 + Math.sin(t * 3.1) * 0.015) / 0.02);
  k = SH_clamp(k, -3, 3);
  var bx = G.doorX0 - 14 - 27, byy = G.frontY1 - 60;
  SH_part(c, m, 'sign' + o + '_' + k, bx - 28, byy - 2, 56, 34, SH_SIGNF[o][k + 3], 'sign' + o + '_0');
  // lanterns glow at dusk
  var n = SH_num(state && state.night, 0);
  if (n > 0.2) {
    c.globalAlpha = SH_clamp((n - 0.2) / 0.3, 0, 1) * (0.92 + 0.08 * Math.sin(t * 9) * Math.sin(t * 5.3));
    SH_part(c, m, 'lglow', G.doorX0 - 7 - 15, G.frontY1 - 77 - 26, 30, 29, SH_lanternGlow);
    SH_part(c, m, 'lglow', G.doorX0 - 7 - 15, G.frontY1 - 77 - 26, 30, 29, SH_lanternGlow, null, G.doorX1 - G.doorX0 + 14, 0);
    c.globalAlpha = 1;
  }
}
function SH_yardPostN(c) {
  // tall jamb on the far side of the yard door carrying the YARD sign
  var G = SH_G, T = SH_TL, x = G.ix1 + T / 2, yb = G.ydY0, h = 82;
  SH_rect(c, x - 8, yb - h, 16, h, '#7a4e2a', SH_OUT, 1.8);
  SH_fill(c, x - 6.4, yb - h + 2, 2, h - 4, '#a8743f'); SH_fill(c, x + 3.4, yb - h + 2, 3.4, h - 4, '#64401f');
  SH_grain(c, x - 4, yb - h + 8, 7, h - 18, 'rgba(59,42,32,0.3)', 4, 77, true);
  SH_rect(c, x - 10.5, yb - 9, 21, 9, '#6b4426', SH_OUT, 1.6, 1.5);
  SH_rect(c, x - 10.5, yb - h - 7, 21, 8, '#8a5a33', SH_OUT, 1.7, 2); SH_fill(c, x - 9, yb - h - 5.8, 18, 1.5, '#b98247');
  SH_ell(c, x, yb - h - 10.5, 4.4, 4.4, '#8a5a33', SH_OUT, 1.5); SH_ell(c, x - 1.3, yb - h - 11.8, 1.4, 1.2, '#c9935a', null);
  // arrow board
  var sy = yb - h + 12;
  SH_poly(c, [x - 23, sy, x + 15, sy, x + 25, sy + 9, x + 15, sy + 18, x - 23, sy + 18], '#fbf1d8', SH_OUT, 1.8);
  SH_poly(c, [x - 21, sy + 13.5, x + 15.5, sy + 13.5, x + 13.6, sy + 16, x - 21, sy + 16], '#ead9b0', null);
  SH_txt(c, 'YARD', x - 4.5, sy + 8.6, 14.5, '#3f7d3a', 'center');
  SH_poly(c, [x + 13, sy + 5.4, x + 19.4, sy + 9, x + 13, sy + 12.6], '#3f7d3a', null);
  SH_ell(c, x - 19, sy + 3.4, 1, 1, '#7a4e2a', null); SH_ell(c, x - 19, sy + 14.6, 1, 1, '#7a4e2a', null);
}
function SH_yardPostS(c) {
  // near side of the yard door: the cut wall starts here (its top sits 'cut' px above the floor line)
  var G = SH_G, T = SH_TL, x = G.ix1, y = G.ydY1, cut = G.cut;
  SH_wallTopV(c, x, y - cut, y + 3);
  SH_line(c, x, y - cut, x + T, y - cut, SH_OUT, 2);
  // low newel post
  var cx = x + T / 2;
  SH_rect(c, cx - 9, y - cut - 16, 18, 28, '#7a4e2a', SH_OUT, 1.8, 1.5);
  SH_fill(c, cx - 7.4, y - cut - 14, 2, 24, '#a8743f'); SH_fill(c, cx + 4, y - cut - 14, 3.4, 24, '#64401f');
  SH_rect(c, cx - 11.5, y - cut - 22, 23, 8, '#8a5a33', SH_OUT, 1.7, 2); SH_fill(c, cx - 10, y - cut - 20.8, 20, 1.5, '#b98247');
  SH_ell(c, cx, y - cut - 25.5, 4.4, 4.4, '#8a5a33', SH_OUT, 1.5); SH_ell(c, cx - 1.3, y - cut - 26.8, 1.4, 1.2, '#c9935a', null);
}
function SH_welcomeMat(c) {
  var G = SH_G, mx = (G.doorX0 + G.doorX1) / 2, y = G.frontY0 - 46, w = 84, h = 36, x = mx - w / 2, i;
  SH_rect(c, x, y, w, h, '#b07a42', SH_OUT, 1.8, 4);
  SH_rect(c, x + 3.5, y + 3.5, w - 7, h - 7, '#c9935a', '#7a4e2a', 1, 2.5);
  c.strokeStyle = 'rgba(122,78,42,0.28)'; c.lineWidth = 0.8;
  for (i = 0; i < 20; i++) { c.beginPath(); c.moveTo(x + 6 + i * 3.8, y + 5); c.lineTo(x + 6 + i * 3.8, y + h - 5); c.stroke(); }
  SH_txt(c, 'WELCOME', mx, y + h / 2 - 4.5, 16, '#5e3c22', 'center');
  SH_paw(c, mx - 24, y + h - 9.5, 3.4, '#5e3c22', -0.3); SH_paw(c, mx, y + h - 9, 3.4, '#5e3c22', 0); SH_paw(c, mx + 24, y + h - 9.5, 3.4, '#5e3c22', 0.3);
}

// =========================================================================================
// SPRITE CACHE
// Canvas here is rasterised in software, so every prop is baked into offscreen bitmaps at exactly the
// device scale of the context it is drawn into and then blitted 1:1 on whole device pixels.
//  - sprites are baked in small clipped units, a few ms per frame at most (SH_CACHE.budget), so a zoom
//    step never causes a long hitch; until a new bake is complete the old bitmap is shown stretched
//  - animated parts are a handful of baked frames chosen by time / state
//  - without a usable transform (or with SH_CACHE.on = false) everything falls back to plain vector drawing
// =========================================================================================
var SH_CACHE = {
  on: true, store: {}, budget: 3.5, spent: 0, tick: -1, S: 0, sT: -1e9, settle: 120,
  fontOk: false, fontT: 0, usedText: false, bytes: 0, capBytes: 60e6, unitPx: 60000, msPerPx: 0.00005, maxPx: 16e6,
  stats: { units: 0, ms: 0, maxUnitMs: 0 }
};
function SH_now() { return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(); }
function SH_fontReady() {
  var C = SH_CACHE;
  if (C.fontOk) return true;
  var now = Date.now();
  if (now - C.fontT < 300) return false;
  C.fontT = now;
  try {
    if (typeof document === 'undefined' || !document.fonts || !document.fonts.check || document.fonts.check('16px "Jersey 25"')) C.fontOk = true;
  } catch (e) { C.fontOk = true; }
  return C.fontOk;
}
// the context's transform if it is a plain translate + uniform scale (else null -> vector drawing)
function SH_xf(c) {
  if (!SH_CACHE.on || typeof document === 'undefined' || !c.getTransform) return null;
  var m;
  try { m = c.getTransform(); } catch (e) { return null; }
  if (!m || m.b || m.c || !(m.a > 0.05) || Math.abs(m.a - m.d) > 1e-6) return null;
  return m;
}
function SH_startBake(S, bx, by, bw, bh, units, fr) {
  var dx = Math.floor(S * bx), dy = Math.floor(S * by);
  var cw = Math.max(1, Math.ceil(S * (bx + bw)) - dx), ch = Math.max(1, Math.ceil(S * (by + bh)) - dy);
  if (cw * ch > SH_CACHE.maxPx) return null;
  var cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
  var list = [], i, k;
  for (i = 0; i < units.length; i++) {
    var u = units[i];
    var ux0 = Math.max(0, Math.floor(S * u[1]) - dx), uy0 = Math.max(0, Math.floor(S * u[2]) - dy);
    var ux1 = Math.min(cw, Math.ceil(S * (u[1] + u[3])) - dx), uy1 = Math.min(ch, Math.ceil(S * (u[2] + u[4])) - dy);
    if (ux1 <= ux0 || uy1 <= uy0) continue;
    var n = Math.max(1, Math.ceil((ux1 - ux0) * (uy1 - uy0) / SH_CACHE.unitPx));
    for (k = 0; k < n; k++) {
      var a = ux0 + Math.round((ux1 - ux0) * k / n), b = ux0 + Math.round((ux1 - ux0) * (k + 1) / n);
      if (b > a) list.push([u[0], a, uy0, b - a, uy1 - uy0]);
    }
  }
  return { cv: cv, g: cv.getContext('2d'), S: S, dx: dx, dy: dy, list: list, i: 0, font: true, fr: fr, bytes: cw * ch * 4, used: 0 };
}
function SH_stepBake(w) {                                // rasterise the next unit; true when the sprite is complete
  if (w.i >= w.list.length) return true;
  var u = w.list[w.i++], g = w.g, t0 = SH_now(), C = SH_CACHE;
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.beginPath(); g.rect(u[1], u[2], u[3], u[4]); g.clip();
  g.setTransform(w.S, 0, 0, w.S, -w.dx, -w.dy);
  g.lineJoin = 'round'; g.lineCap = 'round';
  C.usedText = false;
  try { u[0](g); } catch (e) { /* keep going */ }
  if (C.usedText && !w.fr) w.font = false;
  g.restore();
  try { g.getImageData(0, 0, 1, 1); } catch (e2) { /* ignore */ }   // pay for the raster here, where it is budgeted
  var dt = SH_now() - t0;
  C.spent += dt; C.stats.units++; C.stats.ms += dt; if (dt > C.stats.maxUnitMs) C.stats.maxUnitMs = dt;
  if (C.stats.log) C.stats.log.push([u[0].name || '?', u[3] * u[4], dt]);
  return w.i >= w.list.length;
}
function SH_trim() {
  var C = SH_CACHE, k, r;
  if (C.bytes <= C.capBytes) return;
  for (k in C.store) { r = C.store[k]; if (r.alt) { C.bytes -= r.alt.bytes; r.alt = null; } }
  if (C.bytes <= C.capBytes) return;
  var keys = [];
  for (k in C.store) if (C.store[k].cur) keys.push(k);
  keys.sort(function (a, b) { return C.store[a].cur.used - C.store[b].cur.used; });
  for (var i = 0; i < keys.length && C.bytes > C.capBytes * 0.8; i++) {
    r = C.store[keys[i]];
    if (C.tick - r.cur.used < 1500) break;
    C.bytes -= r.cur.bytes; r.cur = null;
  }
}
// Work on the sprite's bitmap for scale S; returns the entry to show now (fresh, old/stretched, or the fallback's)
function SH_advance(rec, S, bx, by, bw, bh, units, fb) {
  var C = SH_CACHE, now = SH_now(), fbr = fb ? C.store[fb] : null, show = rec.cur || (fbr && fbr.cur) || null, w = rec.wip;
  if (now - C.tick > 8) { C.tick = now; C.spent = 0; }   // a new frame has begun
  if (w && w.S !== S) w = rec.wip = null;
  if (show) {
    if (!w && now - C.sT < C.settle) return show;         // zoom still moving: wait for it to settle
    if (C.spent >= C.budget) return show;
    // one unit per frame is always allowed; a further one only if it is expected to fit the budget
    var est = (w ? w.list[w.i][3] * w.list[w.i][4] : Math.min(C.unitPx, S * S * bw * bh)) * C.msPerPx;
    if (C.spent > 0 && C.spent + est > C.budget) return show;
  }
  if (!w) {
    w = rec.wip = SH_startBake(S, bx, by, bw, bh, (typeof units === 'function') ? [[units, bx, by, bw, bh]] : units, SH_fontReady());
    if (!w) return show;
  }
  for (;;) {
    if (SH_stepBake(w)) {
      if (rec.cur) {
        if (rec.cur.S !== S) { if (rec.alt) C.bytes -= rec.alt.bytes; rec.alt = rec.cur; }
        else C.bytes -= rec.cur.bytes;
      }
      rec.cur = w; rec.wip = null; w.g = null; w.list = null;
      C.bytes += w.bytes;
      if (C.bytes > C.capBytes) SH_trim();
      return w;
    }
    if (show && C.spent + w.list[w.i][3] * w.list[w.i][4] * C.msPerPx > C.budget) return show;   // next unit would not fit this frame
  }
}
// blit a cached sprite. The context must be in DEVICE space (identity transform); m is the world transform.
function SH_sprite(c, m, key, bx, by, bw, bh, units, fb, ox, oy) {
  var C = SH_CACHE, S = m.a, rec = C.store[key] || (C.store[key] = { cur: null, alt: null, wip: null }), e = rec.cur;
  if (Math.abs(S - C.S) > 1e-5) { C.S = S; C.sT = SH_now(); } else S = C.S;       // (getTransform() hands back float32 values)
  if (!e || e.S !== S || !e.font) {
    if (e && e.S !== S && rec.alt && rec.alt.S === S) { rec.cur = rec.alt; rec.alt = e; e = rec.cur; }
    if (!e || e.S !== S || (!e.font && SH_fontReady())) e = SH_advance(rec, S, bx, by, bw, bh, units, fb);
  }
  var X = Math.round(m.e + S * (ox || 0)), Y = Math.round(m.f + S * (oy || 0));
  if (!e) {                                              // could not be cached at all: draw it as vectors
    c.save(); c.setTransform(S, 0, 0, S, X, Y); c.lineJoin = 'round'; c.lineCap = 'round';
    if (typeof units === 'function') units(c); else for (var i = 0; i < units.length; i++) units[i][0](c);
    c.restore();
    return;
  }
  e.used = C.tick;
  if (e.S === S) c.drawImage(e.cv, e.dx + X, e.dy + Y);
  else { var r = S / e.S; c.drawImage(e.cv, Math.round(e.dx * r) + X, Math.round(e.dy * r) + Y, Math.ceil(e.cv.width * r), Math.ceil(e.cv.height * r)); }
}
// one piece of art: cached sprite when m is given, plain vectors otherwise. (ox, oy) shifts it in world px.
function SH_part(c, m, key, bx, by, bw, bh, units, fb, ox, oy) {
  if (m) { SH_sprite(c, m, key, bx, by, bw, bh, units, fb, ox, oy); return; }
  c.save();
  if (ox || oy) c.translate(ox, oy);
  c.beginPath(); c.rect(bx, by, bw, bh); c.clip();       // same extent as the baked sprite would have
  if (typeof units === 'function') units(c);
  else for (var i = 0; i < units.length; i++) {
    var u = units[i];
    c.save(); c.beginPath(); c.rect(u[1] - 0.5, u[2] - 0.5, u[3] + 1, u[4] + 1); c.clip(); u[0](c); c.restore();
  }
  c.restore();
}
function SH_live(c, m) { if (m) c.setTransform(m.a, 0, 0, m.d, m.e, m.f); }    // back to world space for live vector bits
function SH_dev(c, m) { if (m) c.setTransform(1, 0, 0, 1, 0, 0); }             // device space again for blits

// =========================================================================================
// PROPS, LIGHTS
// =========================================================================================
var SH_propN = 0;
// sprites: null | function | list of { x, y, w, h, u: function | [[fn, x, y, w, h], ...] }
function SH_prop(x, y, w, h, sortY, sprites, dyn) {
  var key = 'p' + (SH_propN++), list = null, i;
  x = Math.floor(x); y = Math.floor(y); w = Math.ceil(w); h = Math.ceil(h);
  if (typeof sprites === 'function') list = [{ x: x, y: y, w: w, h: h, u: sprites }];
  else if (sprites && sprites.length) list = sprites;
  return {
    x: x, y: y, w: w, h: h, sortY: sortY, sprites: list,
    draw: function (c, t, state) {
      var m = SH_xf(c);
      c.save();
      try {
        c.globalAlpha = 1; c.globalCompositeOperation = 'source-over'; c.lineJoin = 'round'; c.lineCap = 'round';
        if (m) { c.imageSmoothingEnabled = false; c.setTransform(1, 0, 0, 1, 0, 0); }
        else if (c.setLineDash) c.setLineDash([]);
        if (list) for (var k = 0; k < list.length; k++) { var q = list[k]; SH_part(c, m, key + '_' + k, q.x, q.y, q.w, q.h, q.u); }
        if (dyn) dyn(c, SH_num(t, 0), state || {}, m);
      } catch (e) { /* art must never break the frame */ }
      c.restore();
    }
  };
}
// potted plants: nine baked frames of a gentle sway
function SH_plantProp(x, yb, s, kind, pot) {
  var hgt = 84 * s, bx = Math.floor(x - 36 * s), by = Math.floor(yb - hgt), bw = Math.ceil(72 * s), bh = Math.ceil(hgt + 8), key = 'plant' + (SH_propN++);
  var frames = [];
  function mk(i) { return function (c) { SH_shadow(c, x + 1, yb - 1, 19 * s, 5.5 * s); SH_pottedPlant(c, x, yb, s, (i - 4) * 0.42 * s, kind, pot); }; }
  for (var i = 0; i < 9; i++) frames.push(mk(i));
  return {
    x: bx, y: by, w: bw, h: bh, sortY: yb + 12,
    draw: function (c, t) {
      var m = SH_xf(c);
      c.save();
      try {
        c.globalAlpha = 1; c.globalCompositeOperation = 'source-over'; c.lineJoin = 'round'; c.lineCap = 'round';
        if (m) { c.imageSmoothingEnabled = false; c.setTransform(1, 0, 0, 1, 0, 0); }
        var f = Math.round(Math.sin(SH_num(t, 0) * 1.1 + x * 0.05) * 4) + 4;
        SH_part(c, m, key + '_' + f, bx, by, bw, bh, frames[f], key + '_4');
      } catch (e) { /* ignore */ }
      c.restore();
    }
  };
}
function buildShopProps() {
  var G = SH_G, T = SH_TL, P = [];
  SH_propN = 0;                                          // stable sprite keys: building the props again reuses the cache
  // roof strip + sign: far behind everything in the building
  P.push(SH_prop(G.x0 - 14, G.roofY0 - 100, G.x1 - G.x0 + 28, 100 + G.eaveY - G.roofY0 + 4, G.eaveY,
    [{ x: G.x0 - 14, y: G.roofY0 - 52, w: G.x1 - G.x0 + 28, h: 52 + G.eaveY - G.roofY0 + 6, u: SH_roofUnits() }], SH_roofDynamic));
  // flat welcome mat (lettered, so it is a prop rather than part of the cached ground); sorts under everyone
  P.push(SH_prop((G.doorX0 + G.doorX1) / 2 - 44, G.frontY0 - 48, 88, 40, G.floorY0 + 1, SH_welcomeMat, null));
  // back wall face + the row of furniture standing against it (nobody can ever stand between them): one sprite
  var sy = G.shelfY, bt = G.eaveY - 4, bh = sy + 2 - bt, ft = sy - 142, fh = 144;
  P.push(SH_prop(G.x0 - 6, bt, G.x1 - G.x0 + 12, bh, sy, [{ x: G.x0 - 6, y: bt, w: G.x1 - G.x0 + 12, h: bh, u: SH_wallUnits().concat([
    [SH_shelfFood, G.ix0 - 2, ft, 3 * T + 4, fh], [SH_shelfToys, G.ix0 + 3 * T - 2, ft, 2 * T + 4, fh],
    [SH_rackLeashes, G.ix0 + 5 * T - 2, ft, 2 * T + 4, fh], [SH_shelfGrooming, G.ix0 + 7 * T - 2, ft, 2 * T + 4, fh],
    [SH_deskStatic, G.ix0 + 9 * T - 2, ft, 2 * T + 4, fh], [SH_crates, G.ix0 + 11 * T - 2, ft, 2 * T + 4, fh]]) }], SH_backDynamic));
  // staff side
  P.push(SH_prop(G.ix0, G.floorY0 + 3 * T - 84, T, 86, G.floorY0 + 3 * T, SH_coolerStatic, SH_coolerDynamic));
  P.push(SH_prop(G.ix0, G.floorY0 + 4 * T - 48, T, 50, G.floorY0 + 4 * T, SH_towelBasket, null));
  // yard door
  P.push(SH_prop(G.ix1 - 4, G.ydY0 - 100, T + 10, 102, G.ydY0, SH_yardPostN, null));
  P.push(SH_prop(G.ix1 - 2, G.ydY1 - G.cut - 32, T + 4, G.cut + 38, G.ydY1 + 1, SH_yardPostS, null));
  // the counter: in front of whoever works behind it, behind the owners queueing at it
  P.push(SH_prop(G.ctrX0 - 2, G.ctrTopY0 - 64, G.ctrX1 - G.ctrX0 + 14, G.ctrY1 - G.ctrTopY0 + 66, G.ctrY1,
    [{ x: G.ctrX0 - 2, y: G.ctrTopY0 - 3, w: G.ctrX1 - G.ctrX0 + 14, h: G.ctrY1 - G.ctrTopY0 + 5, u: SH_counterStatic }], SH_counterDynamic));
  // customer side
  P.push(SH_plantProp(G.ix1 - T / 2, G.ctrY1 + T - 8, 0.95, 'snake', '#c9694a'));
  P.push(SH_prop(G.ix0 - 2, G.ctrY0 + 3 * T - 40, T + 8, 3 * T + 42, G.ctrY0 + 6 * T, SH_bench, null));
  P.push(SH_prop(G.ix1 - 2 * T, G.ctrY0 + 4 * T - 74, 2 * T, 78, G.ctrY0 + 4 * T, SH_displayToys, null));
  P.push(SH_prop(G.ix1 - 2 * T, G.ctrY0 + 6 * T - 84, 2 * T, 88, G.ctrY0 + 6 * T, SH_displayFood, null));
  P.push(SH_plantProp(G.ix0 + T / 2, G.frontY0 - 16, 1.0, 'fig', '#3aa89a'));
  P.push(SH_plantProp(G.ix1 - T / 2, G.frontY0 - 16, 0.78, 'fern', '#f2c14e'));
  // low front wall, door posts, hanging sign: in front of everyone inside
  var fy = G.frontY0 - G.cut - 10, fhh = G.frontY1 + 3 - fy;
  P.push(SH_prop(G.x0 - 4, G.frontY0 - G.cut - 80, G.x1 - G.x0 + 8, G.cut + 80 + T + 2, G.frontY1, [
    { x: G.x0 - 4, y: fy, w: G.doorX0 - G.x0 + 4, h: fhh, u: SH_frontL }, { x: G.doorX1, y: fy, w: G.x1 - G.doorX1 + 4, h: fhh, u: SH_frontR },
    { x: G.doorX0 - 24, y: G.frontY1 - 108, w: 28, h: 110, u: SH_frontPosts }, { x: G.doorX1 - 4, y: G.frontY1 - 108, w: 28, h: 110, u: SH_frontPosts }], SH_frontDynamic));
  return P;
}
// Optional: bake everything for a device scale up front (e.g. behind the loading screen) so the first frames are smooth.
function shopArtPrewarm(scale) {
  if (typeof document === 'undefined' || !(scale > 0)) return;
  var C = SH_CACHE, ob = C.budget, os = C.settle, props = buildShopProps(), i, j;
  var cv = document.createElement('canvas'); cv.width = cv.height = 2;
  var c = cv.getContext('2d');
  C.budget = 1e9; C.settle = 0;
  try {
    for (i = 0; i < 50; i++) {
      var st = { night: i > 40 ? (i - 41) / 8 : 0, dayFrac: 0.3, bellT: i < 18 ? (i + 0.5) / 30 : 99, registerT: i < 24 ? (i + 0.5) / 30 : 99, open: (i % 2) === 0 };
      c.setTransform(scale, 0, 0, scale, 0, 0);
      for (j = 0; j < props.length; j++) props[j].draw(c, i * 0.23, st);
    }
  } catch (e) { /* ignore */ }
  C.budget = ob; C.settle = os;
}
// warm light pools for the evening: windows, lamps, lanterns and the (unseen) ceiling lamps
function shopLights() {
  var G = SH_G, T = SH_TL, dy = G.wallY0 + 20, warm = '#ffd98a', soft = '#ffe9b8';
  return [
    { x: G.ix0 + 4 * T, y: dy + 32, r: 90, color: soft },                         // window over the toy shelves
    { x: G.ix0 + 10 * T, y: dy + 32, r: 90, color: soft },                        // window over the desk
    { x: G.ix0 + 9 * T + 20, y: G.shelfY - 70, r: 80, color: warm },              // desk lamp
    { x: (G.ctrX0 + G.ctrX1) / 2, y: G.ctrTopY0 + 10, r: 210, color: warm },      // lamp over the counter
    { x: G.ix0 + 8.5 * T, y: G.floorY0 + 3 * T, r: 230, color: soft },            // staff area
    { x: (G.doorX0 + G.doorX1) / 2, y: G.ctrY1 + 3 * T, r: 240, color: soft },    // waiting area
    { x: G.doorX0 - 7, y: G.frontY1 - 88, r: 110, color: warm },                  // door lanterns
    { x: G.doorX1 + 7, y: G.frontY1 - 88, r: 110, color: warm },
    { x: (G.x0 + G.x1) / 2 - 95, y: G.roofY0 + 14, r: 90, color: warm },          // sign lamps
    { x: (G.x0 + G.x1) / 2 + 95, y: G.roofY0 + 14, r: 90, color: warm }
  ];
}
