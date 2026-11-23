'use strict';
/* =====================================================================================================================
   Paws & Play - front-facing dog portraits ("Dogdex" glossary, roster icons, kennel / bath-tub peek faces)

   Public globals
     drawDogPortrait(c, breedId, coatIndex, x, y, size, opt)   bust portrait inside the square (x, y, size, size)
     drawDogFace(c, breedId, coatIndex, x, y, r, opt)          head only, centred on (x, y); r = half-width of the skull
                                                               (ears reach further; Pomeranian / Pomsky keep their fluff
                                                               ball: fluff radius ~1.3 r)
     dogPortraitURL(breedId, coatIndex, size, opt)             cached PNG data URL for <img> (2x pixels up to size 130,
                                                               capped above that; opt.scale forces a factor)
     dogPortraitWarm(jobs, done)                               optional: pre-build URLs in idle slices,
                                                               jobs = [[breedId, coatIndex, size, opt], ...]
   opt (all optional) = {
     mood: 'happy' (default) | 'neutral' | 'sad' | 'sleepy' | 'excited',
     t: seconds -> blink, pant, ear flick, the odd head-tilt (omit for a still picture),
     bg: 'none' (default) | 'badge' (round pastel badge) | 'card' (parchment vignette),   bgColor: badge tint override,
     silhouette: true -> flat #5a4634 shape with a "?" (undiscovered glossary entry),
     collar: CSS colour or null (also recolours the Yorkie's bow),
     seed: number -> per-dog variation (head-tilt side, spot / patch placement, blink timing),
     noCache: true -> draw live vectors (slow; debugging only) }

   How it draws: canvas is rasterised in software here, so nothing is drawn live. Each picture is baked once into an
   offscreen bitmap at exactly the device scale of the context it is drawn on, then blitted 1:1 on whole device pixels
   (stills = one blit; animated = bust + one of a few cached head frames). Bitmaps live in an LRU cache (<= ~48 MB).
   Needs BREEDS / BREED_BY_ID from breeds.js (falls back to a plain tan dog without them). Private names: DP_*.
   ===================================================================================================================== */

var DP_OUT = '#3b2a20';
var DP_SILCOL = '#5a4634';
var DP_TAU = Math.PI * 2;
var DP_BADGES = ['#f8dfae', '#cfe6c2', '#f8d0d6', '#cde3ef', '#ddd3ee', '#f6d6bf', '#c8e6df'];

function DP_clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
function DP_lerp(a, b, t) { return a + (b - a) * t; }

var DP_rgbCache = {};
function DP_rgb(col) {
  var r = DP_rgbCache[col];
  if (r) return r;
  r = [128, 128, 128];
  if (typeof col === 'string') {
    var m;
    if (col.charAt(0) === '#') {
      var h = col.slice(1);
      if (h.length === 3) h = h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2);
      var n = parseInt(h.slice(0, 6), 16);
      if (!isNaN(n)) r = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    } else if ((m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(col))) {
      r = [+m[1], +m[2], +m[3]];
    }
  }
  DP_rgbCache[col] = r;
  return r;
}
function DP_mix(a, b, t) {
  var A = DP_rgb(a), B = DP_rgb(b);
  return 'rgb(' + Math.round(A[0] + (B[0] - A[0]) * t) + ',' + Math.round(A[1] + (B[1] - A[1]) * t) + ',' + Math.round(A[2] + (B[2] - A[2]) * t) + ')';
}
function DP_lum(col) { var A = DP_rgb(col); return (A[0] * 0.299 + A[1] * 0.587 + A[2] * 0.114) / 255; }
function DP_rgba(col, a) { var A = DP_rgb(col); return 'rgba(' + A[0] + ',' + A[1] + ',' + A[2] + ',' + a + ')'; }
// detail-line colour for a given local colour: darker on light fur, lighter on dark fur
function DP_lineCol(col) { return DP_lum(col) < 0.24 ? DP_mix(col, '#ffffff', 0.26) : DP_mix(col, DP_OUT, 0.5); }

function DP_rng(seed) {
  var s = (seed | 0) + 0x9e3779b9 | 0;
  return function () {
    s = s + 0x6d2b79f5 | 0;
    var t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------- path helpers ---------- */
// Catmull-Rom spline through pts ([x, y, corner?]) appended to Path2D p
function DP_curve(p, pts, closed) {
  var n = pts.length;
  if (n < 2) return p;
  p.moveTo(pts[0][0], pts[0][1]);
  var segs = closed ? n : n - 1, k = 1 / 6;
  for (var i = 0; i < segs; i++) {
    var p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    if (!closed) { if (i === 0) p0 = p1; if (i === n - 2) p3 = p2; }
    var c1x = p1[2] ? p1[0] : p1[0] + (p2[0] - p0[0]) * k, c1y = p1[2] ? p1[1] : p1[1] + (p2[1] - p0[1]) * k;
    var c2x = p2[2] ? p2[0] : p2[0] - (p3[0] - p1[0]) * k, c2y = p2[2] ? p2[1] : p2[1] - (p3[1] - p1[1]) * k;
    p.bezierCurveTo(c1x, c1y, c2x, c2y, p2[0], p2[1]);
  }
  if (closed) p.closePath();
  return p;
}
function DP_shape(pts) { return DP_curve(new Path2D(), pts, true); }
function DP_line(pts) { return DP_curve(new Path2D(), pts, false); }
// right-side points (top -> bottom) mirrored into a full clockwise loop
function DP_symPts(R) {
  var out = R.slice(), i;
  for (i = R.length - 1; i >= 0; i--) {
    if (Math.abs(R[i][0]) < 1e-6) continue;
    out.push([-R[i][0], R[i][1], R[i][2]]);
  }
  return out;
}
function DP_sym(R) { return DP_shape(DP_symPts(R)); }
function DP_flip(pts) { var o = []; for (var i = pts.length - 1; i >= 0; i--) o.push([-pts[i][0], pts[i][1], pts[i][2]]); return o; }
function DP_ellPath(x, y, rx, ry, rot) { var p = new Path2D(); p.ellipse(x, y, Math.abs(rx), Math.abs(ry), rot || 0, 0, DP_TAU); return p; }
function DP_ell(c, x, y, rx, ry, rot, col) { c.fillStyle = col; c.beginPath(); c.ellipse(x, y, Math.abs(rx), Math.abs(ry), rot || 0, 0, DP_TAU); c.fill(); }
function DP_fillPts(c, pts, col) { c.fillStyle = col; c.fill(DP_shape(pts)); }
function DP_fillSym(c, R, col) { c.fillStyle = col; c.fill(DP_sym(R)); }
// clockwise ring of points on an ellipse (a0 = start angle, screen clockwise), optional jitter
function DP_ring(cx, cy, rx, ry, n, rnd, jit, a0) {
  var pts = [];
  for (var i = 0; i < n; i++) {
    var a = (a0 || 0) + (i + (rnd ? (rnd() - 0.5) * (jit || 0) : 0)) / n * DP_TAU;
    var k = 1 + (rnd ? (rnd() - 0.5) * (jit || 0) * 0.12 : 0);
    pts.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]);
  }
  return pts;
}
// Fur outline through a clockwise loop of "valley" points. mode 'curl' = round scallops, 'tuft' = pointed locks that hang down.
// A point's third value scales the fur depth of the edge that starts at it (0 = plain edge).
function DP_fur(pts, depth, mode, rnd, jit, into) {
  var p = into || new Path2D(), n = pts.length;
  p.moveTo(pts[0][0], pts[0][1]);
  for (var i = 0; i < n; i++) {
    var a = pts[i], b = pts[(i + 1) % n];
    var dx = b[0] - a[0], dy = b[1] - a[1], L = Math.sqrt(dx * dx + dy * dy) || 1;
    var nx = dy / L, ny = -dx / L;
    var d = depth * (a[2] === undefined ? 1 : a[2]) * (1 + (rnd ? (rnd() - 0.5) * (jit || 0) : 0));
    if (d === 0) { p.lineTo(b[0], b[1]); continue; }
    if (mode === 'curl') {
      p.bezierCurveTo(a[0] + nx * d * 1.35 + dx * 0.04, a[1] + ny * d * 1.35 + dy * 0.04,
                      b[0] + nx * d * 1.35 - dx * 0.04, b[1] + ny * d * 1.35 - dy * 0.04, b[0], b[1]);
    } else {
      // a chunky lock: convex back, sharp tip that hangs towards the lower end, concave underside
      var lean = DP_clamp(dy / L * 1.8, -1, 1), tp = 0.5 + 0.33 * lean, ex = dx / L, ey = dy / L;
      var tx = a[0] + dx * tp + nx * d, ty = a[1] + dy * tp + ny * d + Math.abs(d) * 0.2;
      if (lean >= 0) {
        p.bezierCurveTo(a[0] + nx * d * 0.95, a[1] + ny * d * 0.95, a[0] + dx * tp * 0.72 + nx * d * 1.28, a[1] + dy * tp * 0.72 + ny * d * 1.28, tx, ty);
        p.quadraticCurveTo(a[0] + dx * (tp - 0.02) + nx * d * 0.12 + ex * 0, a[1] + dy * (tp - 0.02) + ny * d * 0.12, b[0], b[1]);
      } else {
        p.quadraticCurveTo(a[0] + dx * (tp + 0.02) + nx * d * 0.12, a[1] + dy * (tp + 0.02) + ny * d * 0.12, tx, ty);
        p.bezierCurveTo(b[0] - dx * (1 - tp) * 0.72 + nx * d * 1.28, b[1] - dy * (1 - tp) * 0.72 + ny * d * 1.28, b[0] + nx * d * 0.95, b[1] + ny * d * 0.95, b[0], b[1]);
      }
    }
  }
  p.closePath();
  return p;
}
// a single lock of fur appended to path p: base centre (x, y), pointing along angle a, length len, half-width w, bend (+/-).
// mir = mirror it across the vertical axis. Always wound clockwise so overlapping locks / shapes can share one fill.
function DP_lockInto(p, x, y, a, len, w, bend, mir) {
  var ca = Math.cos(a), sa = Math.sin(a), px = -sa, py = ca, b = bend || 0, k = mir ? -1 : 1;
  var sx = x - px * w, sy = y - py * w, ex = x + px * w, ey = y + py * w, tx = x + ca * len, ty = y + sa * len;
  var c1x = x + ca * len * 0.55 + px * (w * 0.9 + b * len), c1y = y + sa * len * 0.55 + py * (w * 0.9 + b * len);
  var c2x = x + ca * len * 0.5 - px * (w * 0.7 - b * len), c2y = y + sa * len * 0.5 - py * (w * 0.7 - b * len);
  if (!mir) { p.moveTo(sx, sy); p.quadraticCurveTo(c2x, c2y, tx, ty); p.quadraticCurveTo(c1x, c1y, ex, ey); }
  else { p.moveTo(-ex, ey); p.quadraticCurveTo(-c1x, c1y, -tx, ty); p.quadraticCurveTo(-c2x, c2y, -sx, sy); }
  p.closePath();
  return p;
}
function DP_ellInto(p, x, y, rx, ry, rot) {
  rx = Math.abs(rx); ry = Math.abs(ry); rot = rot || 0;
  p.moveTo(x + Math.cos(rot) * rx, y + Math.sin(rot) * rx);
  p.ellipse(x, y, rx, ry, rot, 0, DP_TAU);
  p.closePath();
  return p;
}
// fill with a thin light edge on the top-left for dark coats (so black dogs keep their shapes); plain fill otherwise
function DP_fillRim(c, p, fill, lw) {
  if (DP_lum(fill) < 0.2) {
    var d = lw * 0.6;
    c.fillStyle = DP_mix(fill, '#ffffff', 0.16); c.fill(p);
    c.translate(d, d * 0.9); c.fillStyle = fill; c.fill(p); c.translate(-d, -d * 0.9);
  } else { c.fillStyle = fill; c.fill(p); }
}
// outline a set of overlapping parts as ONE silhouette (a single stroke), then fill / paint each. parts: {p, fill, paint(c)}
function DP_group(c, parts, lw) {
  var i, q, all = parts[0].p;
  if (parts.length > 1) { all = new Path2D(); for (i = 0; i < parts.length; i++) all.addPath(parts[i].p); }
  c.strokeStyle = DP_OUT; c.lineWidth = lw * 2; c.lineJoin = 'round'; c.lineCap = 'round';
  c.stroke(all);
  for (i = 0; i < parts.length; i++) {
    q = parts[i];
    DP_fillRim(c, q.p, q.fill, lw);
    if (q.paint) { c.save(); c.clip(q.p); q.paint(c); c.restore(); }
  }
}
// soft form shadow: everything outside an ellipse that is pushed towards the light (top-left). Call inside a clip.
function DP_shadeOut(c, cx, cy, rx, ry, col) {
  c.fillStyle = col;
  c.beginPath();
  c.rect(cx - rx * 4, cy - ry * 4, rx * 8, ry * 8);
  c.ellipse(cx, cy, rx, ry, 0, 0, DP_TAU);
  c.fill('evenodd');
}
function DP_shadeFor(fill) {
  var l = DP_lum(fill);
  return l < 0.26 ? 'rgba(0,0,0,0.30)' : (l > 0.8 ? 'rgba(110,80,52,0.15)' : 'rgba(74,42,20,0.17)');
}
// one fill for: everything outside the lit ellipse + an optional extra cast-shadow ellipse (no double darkening)
function DP_shadeOut2(c, cx, cy, rx, ry, col, ex, ey, erx, ery) {
  var p = new Path2D();
  p.rect(cx - rx * 4, cy - ry * 4, rx * 8, ry * 8);
  p.moveTo(cx + rx, cy); p.ellipse(cx, cy, rx, ry, 0, 0, DP_TAU, true); p.closePath();
  if (erx) DP_ellInto(p, ex, ey, erx, ery, 0);
  c.fillStyle = col; c.fill(p);
}
// transform right-side points for one side: rotate about (bx, by), mirror for the left (order reversed so loops stay clockwise)
function DP_xf(pts, side, bx, by, rot) {
  var out = [], ca = Math.cos(rot), sa = Math.sin(rot), i, p, dx, dy;
  for (i = 0; i < pts.length; i++) {
    p = pts[i]; dx = p[0] - bx; dy = p[1] - by;
    out.push([side * (bx + dx * ca - dy * sa), by + dx * sa + dy * ca, p[2]]);
  }
  if (side < 0) out.reverse();
  return out;
}
function DP_ticks(c, list, col, w) {   // list of [x, y, angle, len]
  c.strokeStyle = col; c.lineWidth = w; c.lineCap = 'round';
  c.beginPath();
  for (var i = 0; i < list.length; i++) {
    var k = list[i], ca = Math.cos(k[2]), sa = Math.sin(k[2]), L = k[3] || 3;
    c.moveTo(k[0], k[1]);
    c.quadraticCurveTo(k[0] + ca * L * 0.5 - sa * L * 0.25, k[1] + sa * L * 0.5 + ca * L * 0.25, k[0] + ca * L, k[1] + sa * L);
  }
  c.stroke();
}
// n random points in a box, kept at least minD apart (so curl marks never tangle)
function DP_scatter(rnd, n, x0, y0, x1, y1, minD) {
  var pts = [], tries = 0, i, ok, x, y;
  while (pts.length < n && tries++ < n * 12) {
    x = x0 + rnd() * (x1 - x0); y = y0 + rnd() * (y1 - y0); ok = true;
    for (i = 0; i < pts.length; i++) if ((pts[i][0] - x) * (pts[i][0] - x) + (pts[i][1] - y) * (pts[i][1] - y) < minD * minD) { ok = false; break; }
    if (ok) pts.push([x, y]);
  }
  return pts;
}
function DP_curlMarks(c, list, col, w) {   // list of [x, y, r, startAngle]
  c.strokeStyle = col; c.lineWidth = w; c.lineCap = 'round';
  c.beginPath();
  for (var i = 0; i < list.length; i++) {
    var k = list[i];
    c.moveTo(k[0] + Math.cos(k[3]) * k[2], k[1] + Math.sin(k[3]) * k[2]);
    c.arc(k[0], k[1], k[2], k[3], k[3] + 3.6);
  }
  c.stroke();
}

/* ---------- breed specs ----------
   All numbers are in "head units" (skull half-width is about 24), origin at the middle of the head, y down.
   hy = head centre in the 100-unit portrait box, hs = head scale.
   sk  = skull [halfWidth, top, bottom, topSquareness, jawHalfWidth, widestY]
   eye = [x, y, r, cornerRoundness(0.5 almond .. 1 round), tilt, squint]
   mz  = muzzle [bridgeHalfWidth, topY, padHalfWidth, noseY, lipY]      nose = [halfWidth, height]
   jaw = [halfWidth, openDepth]     neck = [neckHalfWidth, shoulderHalfWidth] (box units)                              */
var DP_SPECS = {
  lab: { hy: 42, hs: 1.12, sk: [25, 23, 19, 0.95, 15, 1], eye: [10.5, -3, 3.9, 0.92, 0.05, 0], mz: [6.8, -4, 13, 9, 18.5], nose: [6.4, 4.9], jaw: [9.8, 8],
    ear: { type: 'drop', ax: 19.5, ay: -15.5, w: 13, wb: 7.5, len: 30, out: 4.5, lift: 3.5 }, neck: [18, 31], fur: 'smooth' },
  golden: { hy: 42, hs: 1.1, sk: [24, 23, 19, 0.88, 14, 1], eye: [10, -3, 3.9, 0.9, 0.06, 0.05], mz: [6.5, -4, 12.3, 9.5, 18.5], nose: [6.1, 4.7], jaw: [9.2, 8.5],
    ear: { type: 'drop', ax: 20, ay: -14, w: 11.5, wb: 10.5, len: 30, out: 4, lift: 3, feather: 1 }, neck: [19, 32], fur: 'fluffy', cheek: [2, 7, 8] },
  shepherd: { hy: 51, hs: 1.0, sk: [22, 19, 15, 0.85, 10, -1], eye: [9, -4, 3.5, 0.62, 0.2, 0], mz: [6, -5, 10.5, 11.5, 20], nose: [5.5, 4.3], jaw: [7.8, 9],
    ear: { type: 'erect', bx: 13.5, by: -13, hw: 9, tx: 17.5, ty: -43.5, round: 0.12, fluff: 1 }, neck: [17, 30], fur: 'fluffy', cheek: [2, 5, 6] },
  husky: { hy: 49, hs: 1.05, sk: [23, 19, 15.5, 0.9, 11, 0], eye: [9.5, -3.5, 3.7, 0.6, 0.26, 0], mz: [6, -3.5, 10.5, 9.5, 17.5], nose: [5.1, 4.1], jaw: [7.8, 8.5],
    ear: { type: 'erect', bx: 13.5, by: -14, hw: 8.2, tx: 15.5, ty: -40, round: 0.16, fluff: 1 }, neck: [18, 30], fur: 'fluffy', cheek: [3, 7.5, 3] },
  collie: { hy: 47, hs: 1.03, sk: [22, 19.5, 16, 0.85, 13.5, 0], eye: [9, -3.5, 3.6, 0.75, 0.12, 0], mz: [5.5, -4, 9.8, 10.5, 18.5], nose: [5, 4], jaw: [7.2, 8.5],
    ear: { type: 'tipped', bx: 14.5, by: -13, hw: 9, tx: 21, ty: -41, fold: 0.64 }, neck: [19, 31], fur: 'fluffy', cheek: [3, 9, 2], ruff: { cy: 25, rx: 29, ry: 17, n: 12, d: 5.5, jit: 0.15 } },
  dalmatian: { hy: 42, hs: 1.12, sk: [22, 22.5, 17, 0.82, 12, 0], eye: [9.5, -3.5, 3.8, 0.85, 0.08, 0], mz: [6, -4.5, 11, 10.5, 19], nose: [5.7, 4.5], jaw: [8.2, 8.5],
    ear: { type: 'drop', ax: 18.5, ay: -17, w: 10.5, wb: 8, len: 27, out: 5, lift: 3.5 }, neck: [15, 28], fur: 'smooth' },
  bernese: { hy: 42, hs: 1.1, sk: [26, 23, 20, 0.95, 15, 1], eye: [10.5, -3, 3.8, 0.9, 0.04, 0], mz: [7, -4, 13, 9, 18.5], nose: [6.5, 4.9], jaw: [9.8, 8],
    ear: { type: 'drop', ax: 21.5, ay: -14.5, w: 11.5, wb: 9.5, len: 28, out: 4, lift: 3, feather: 1 }, neck: [21, 34], fur: 'fluffy', cheek: [2, 7, 9] },
  poodle: { hy: 50, hs: 1.04, sk: [17.5, 18, 13, 0.85, 9, -1], eye: [7.6, -2.5, 3.3, 0.85, 0.06, 0], mz: [5, -3.5, 8.2, 12, 19], nose: [4.9, 3.9], jaw: [6.2, 7.5],
    ear: { type: 'curly', cx: 23.5, cy: 11, rx: 9.5, ry: 17, n: 9 }, top: { type: 'pompom', cy: -21.5, rx: 20, ry: 14.5, n: 11 }, neck: [13, 29], fur: 'curly' },
  beagle: { hy: 42, hs: 1.12, sk: [23, 21.5, 18, 0.9, 13.5, 1], eye: [10, -2, 4.5, 0.98, 0, 0], mz: [6.2, -3, 11.5, 8.5, 17], nose: [5.9, 4.6], jaw: [8.6, 7.5],
    ear: { type: 'drop', ax: 19.5, ay: -9.5, w: 10.5, wb: 15.5, len: 35, out: 5.5, lift: 2 }, neck: [16, 29], fur: 'smooth' },
  corgi: { hy: 51, hs: 1.0, sk: [24, 18, 16, 0.98, 10, 0], eye: [9.6, -2.5, 3.9, 0.95, 0.06, 0], mz: [5.5, -2.5, 9.6, 8.5, 15.5], nose: [4.9, 3.9], jaw: [7, 8],
    ear: { type: 'erect', bx: 15.5, by: -11.5, hw: 10.5, tx: 23.5, ty: -41, round: 0.5, fluff: 0 }, neck: [19, 30], fur: 'fluffy', cheek: [2, 6, 5] },
  shiba: { hy: 48, hs: 1.05, sk: [26, 18.5, 16.5, 1.0, 12, 3], eye: [10, -3.5, 3.3, 0.6, 0.3, 0.3], mz: [5.5, -2.5, 9.4, 7.5, 14.5], nose: [4.7, 3.7], jaw: [6.8, 7.5],
    ear: { type: 'erect', bx: 16.5, by: -13, hw: 7.8, tx: 20.5, ty: -33, round: 0.25, fluff: 0, thick: 1 }, neck: [20, 31], fur: 'fluffy', cheek: [2, 5, 8] },
  dachshund: { hy: 40, hs: 1.12, sk: [19, 20.5, 14.5, 0.8, 12, -1], eye: [8.2, -6, 3.5, 0.85, 0.05, 0], mz: [4.8, -7, 8.6, 14.5, 22], nose: [5, 4], jaw: [6.3, 7.5],
    ear: { type: 'drop', ax: 16, ay: -12.5, w: 10, wb: 13.5, len: 35, out: 6, lift: 2 }, neck: [13, 26], fur: 'smooth' },
  pug: { hy: 45, hs: 1.08, sk: [27, 22, 21, 1.0, 20, 4], eye: [12.5, -0.5, 5.2, 1, 0, 0], mz: [9.5, 1, 14, 5, 15.5], nose: [4.6, 3.2], jaw: [10.5, 5],
    ear: { type: 'button', fx: 20.5, fy: -17, fw: 7, tx: 27.5, ty: -3 }, neck: [21, 32], fur: 'smooth', wrinkles: 2, flat: 1, maskUp: 1 },
  frenchie: { hy: 53, hs: 0.98, sk: [26, 19.5, 20.5, 1.08, 20, 3], eye: [12.8, 0.5, 4.5, 1, 0, 0], mz: [9.5, 2, 15, 6.5, 17.5], nose: [5.4, 3.6], jaw: [11.5, 5.5],
    ear: { type: 'erect', bx: 15.5, by: -14, hw: 11.5, tx: 21, ty: -42, round: 0.9, fluff: 0, pink: 1 }, neck: [22, 32], fur: 'smooth', wrinkles: 1, flat: 1, maskUp: 0.35 },
  chihuahua: { hy: 53, hs: 1.0, sk: [22.5, 23.5, 14.5, 0.86, 8, -4], eye: [10.8, 0, 5.2, 1, 0.04, 0], mz: [4, 2, 7.4, 8.5, 14], nose: [3.6, 2.9], jaw: [5, 5],
    ear: { type: 'erect', bx: 17, by: -13, hw: 10.5, tx: 37, ty: -38, round: 0.3, fluff: 0, pink: 1 }, neck: [11, 24], fur: 'smooth' },
  schnauzer: { hy: 46, hs: 1.06, sk: [20, 20.5, 12, 1.02, 14, -2], eye: [8.6, -3.5, 3.4, 0.9, 0, 0], mz: [6, -1, 13.5, 6.5, 15], nose: [5.6, 4.2], jaw: [10.5, 6],
    ear: { type: 'button', fx: 15, fy: -18, fw: 7.5, tx: 24, ty: -4 }, neck: [15, 28], fur: 'wire', beard: 1, brows: 1 },
  pomeranian: { hy: 52, hs: 1.0, sk: [19.5, 16.5, 13.5, 0.95, 10, 1], eye: [8.4, -1.5, 3.8, 1, 0.04, 0], mz: [4.4, 0, 7.8, 6.2, 12], nose: [3.9, 3.1], jaw: [5.6, 5.5],
    ear: { type: 'erect', bx: 11.5, by: -12, hw: 6.5, tx: 15.5, ty: -30, round: 0.25, fluff: 1 }, neck: [22, 31], fur: 'fluffy', cheek: [2, 6, 3], ruff: { cy: 3, rx: 36, ry: 33, n: 13, d: 7, big: 1 } },
  yorkie: { hy: 52, hs: 1.05, sk: [19, 17.5, 14, 0.95, 10, 0], eye: [8, -0.5, 3.9, 1, 0, 0], mz: [4.6, 1, 8, 7.5, 13.5], nose: [4, 3.2], jaw: [5.6, 5.5],
    ear: { type: 'erect', bx: 13, by: -12, hw: 7, tx: 20, ty: -33, round: 0.2, fluff: 0 }, neck: [15, 31], fur: 'silky', silk: 1 },
  labradoodle: { hy: 44, hs: 1.08, sk: [24.5, 22.5, 19, 0.95, 15, 1], eye: [10, -2.5, 3.8, 1, 0, 0], mz: [7, -2, 13, 8.5, 18], nose: [5.9, 4.6], jaw: [9, 7.5],
    ear: { type: 'shaggy', ax: 22.5, ay: -13, w: 12.5, len: 30 }, top: { type: 'fringe' }, neck: [19, 32], fur: 'shaggy', skullFur: 'tuft', mzFur: 1 },
  cockapoo: { hy: 44, hs: 1.06, sk: [22, 21, 17, 0.95, 13, 1], eye: [9.6, -1.5, 4.5, 1, 0, 0], mz: [6, -1, 11.5, 7.5, 15.5], nose: [5, 4], jaw: [7.5, 6.5],
    ear: { type: 'curly', cx: 24, cy: 12, rx: 10, ry: 21, n: 10, low: 1 }, top: { type: 'curls' }, neck: [16, 29], fur: 'curly', skullFur: 'curl' },
  puggle: { hy: 42, hs: 1.12, sk: [24.5, 21.5, 19.5, 0.97, 16, 3], eye: [11.2, -1.5, 4.7, 1, 0, 0], mz: [8, -0.5, 12.5, 7, 16], nose: [5.2, 3.8], jaw: [9.2, 6.5],
    ear: { type: 'drop', ax: 20.5, ay: -13.5, w: 10.5, wb: 10, len: 25, out: 4, lift: 3 }, neck: [18, 30], fur: 'smooth', wrinkles: 1, maskUp: 0.15 },
  pomsky: { hy: 52, hs: 1.04, sk: [20.5, 17, 14, 0.92, 10, 0], eye: [8.6, -2.5, 3.8, 0.7, 0.18, 0], mz: [5, -1.5, 8.6, 7.5, 14], nose: [4.2, 3.4], jaw: [6.2, 7],
    ear: { type: 'erect', bx: 12.5, by: -12, hw: 7.2, tx: 15.5, ty: -33, round: 0.2, fluff: 1 }, neck: [22, 31], fur: 'fluffy', cheek: [2, 6, 4], ruff: { cy: 6, rx: 31, ry: 27, n: 12, d: 6.5, big: 1 } },
  // ---------- third batch ----------
  cavalier: { hy: 44, hs: 1.04, sk: [22, 21, 16, 0.92, 12, 1], eye: [10.2, -1.5, 4.9, 1, 0, 0], mz: [5.6, -1, 10.4, 7.5, 15], nose: [5, 3.9], jaw: [7.4, 6.5],
    ear: { type: 'drop', ax: 18.5, ay: -15.5, w: 12, wb: 16, len: 41, out: 6.5, lift: 3, feather: 1, wavy: 1 }, neck: [16, 29], fur: 'fluffy', cheek: [2, 6, 6] },
  boxer: { hy: 46, hs: 1.08, sk: [23.5, 21, 19, 1.12, 18, 1], eye: [11, -4, 3.9, 0.86, 0.05, 0], mz: [9, -1.5, 15, 5, 14.5], nose: [6, 4.2], jaw: [13, 6],
    ear: { type: 'drop', ax: 18, ay: -19, w: 8.5, wb: 6.5, len: 17, out: 4.5, lift: 4.5 }, neck: [17, 31], fur: 'smooth', wrinkles: 1, flews: 1.1, underbite: 1, flat: 1 },
  aussie: { hy: 47, hs: 1.04, sk: [22, 19.5, 16, 0.86, 13, 0], eye: [9.2, -3.5, 3.8, 0.8, 0.1, 0], mz: [5.8, -4, 10, 10.5, 18.5], nose: [5.2, 4.1], jaw: [7.4, 8.5],
    ear: { type: 'tipped', bx: 15, by: -13, hw: 9.5, tx: 23, ty: -35, fold: 0.42 }, neck: [19, 31], fur: 'fluffy', cheek: [3, 8.5, 2], ruff: { cy: 25, rx: 28, ry: 15, n: 11, d: 5, jit: 0.15 } },
  bulldog: { hy: 47, hs: 1.0, sk: [30, 21, 15, 0.98, 24, 3], eye: [14.5, 0, 4.2, 1, 0, 0.1], mz: [10, 2, 15.5, 5.5, 14.5], nose: [6.2, 3.9], jaw: [17.5, 4.5],
    ear: { type: 'rose', bx: 20, by: -17, tx: 33.5, ty: -16, hw: 7 }, neck: [28, 38], fur: 'smooth', wrinkles: 2, flews: 2.2, underbite: 1.4 },
  greyhound: { hy: 40, hs: 1.08, sk: [16.5, 20, 16, 0.7, 9, -3], eye: [8, -6.5, 3.3, 0.7, 0.14, 0], mz: [4.1, -8.5, 6.9, 15.5, 22.5], nose: [4.3, 3.6], jaw: [5.2, 7],
    ear: { type: 'rose', bx: 11, by: -17, tx: 23, ty: -18, hw: 5.5 }, neck: [11.5, 28], fur: 'smooth' },
  jackrussell: { hy: 48, hs: 1.03, sk: [21.5, 19.5, 15.5, 0.9, 11.5, 0], eye: [9.3, -2.5, 3.8, 0.9, 0.06, 0], mz: [5.5, -3, 9.8, 9, 16.5], nose: [5, 4], jaw: [7.2, 7.5],
    ear: { type: 'button', fx: 15.5, fy: -17, fw: 7.5, tx: 25, ty: -4 }, neck: [15, 28], fur: 'smooth' },
  samoyed: { hy: 47, hs: 1.02, sk: [22, 19.5, 15, 0.92, 11, 0], eye: [9.4, -3, 3.4, 0.62, 0.18, 0.25], mz: [5.5, -3, 9.6, 8.5, 15.5], nose: [4.8, 3.9], jaw: [7, 7.5],
    ear: { type: 'erect', bx: 14, by: -14, hw: 8, tx: 18.5, ty: -35, round: 0.35, fluff: 1, thick: 1 }, neck: [22, 33], fur: 'fluffy', cheek: [3, 8, 3], smile: 1.5, rims: 1,
    ruff: { cy: 13, rx: 33, ry: 27, n: 15, d: 6.5, big: 1 } },
  greatdane: { hy: 38, hs: 1.08, sk: [20, 23, 19, 1.1, 16, -3], eye: [9.4, -8.5, 3.5, 0.85, 0.06, 0], mz: [10, -9.5, 13.5, 12.5, 25], nose: [6.8, 5.1], jaw: [11.5, 8],
    ear: { type: 'drop', ax: 16.5, ay: -20.5, w: 9.5, wb: 8, len: 22, out: 4.5, lift: 4.5 }, neck: [15, 30], fur: 'smooth', flews: 1.2, maskUp: 0.35 },
  cocker: { hy: 42, hs: 1.08, sk: [21, 22, 16, 0.92, 11, 0], eye: [9.6, -2, 4.8, 1, 0, 0], mz: [5.6, -2.5, 10.2, 8.5, 16.5], nose: [5.4, 4.2], jaw: [7.6, 7],
    ear: { type: 'drop', ax: 18.5, ay: -10, w: 12.5, wb: 17, len: 43, out: 6, lift: 2.5, feather: 1 }, neck: [15, 29], fur: 'fluffy', cheek: [2, 6, 6] },
  boston: { hy: 51, hs: 1.0, sk: [24, 20, 18, 1.05, 17, 2], eye: [12, -1, 5.3, 1, 0, 0], mz: [8, 1.5, 12.5, 6, 14.5], nose: [5.2, 3.6], jaw: [9.5, 5],
    ear: { type: 'erect', bx: 16.5, by: -12.5, hw: 10.5, tx: 28, ty: -40, round: 0.55, fluff: 0, pink: 1 }, neck: [18, 30], fur: 'smooth', flat: 1 },
  rottweiler: { hy: 43, hs: 1.1, sk: [26, 22, 19, 1.0, 16, 1], eye: [10.5, -4, 3.5, 0.78, 0.06, 0], mz: [8.5, -4, 13.5, 8.5, 18.5], nose: [6.6, 4.9], jaw: [10.5, 8],
    ear: { type: 'drop', ax: 20, ay: -17, w: 10.5, wb: 8, len: 21, out: 5, lift: 4 }, neck: [20, 34], fur: 'smooth', flews: 0.6 },
  bichon: { hy: 50, hs: 0.98, sk: [19, 17, 13.5, 0.95, 10, 0], eye: [8.2, -1, 4.1, 1, 0, 0], mz: [4.6, 0, 8.2, 6.5, 12.5], nose: [4.3, 3.4], jaw: [5.6, 5.5],
    ear: { type: 'none' }, neck: [18, 30], fur: 'curly', skullFur: 'curl', mzFur: 1, rims: 1,
    ruff: { cy: -2, rx: 36, ry: 36, n: 15, d: 6, big: 1, curl: 1 } },
  basset: { hy: 38, hs: 1.08, sk: [20, 22, 16, 0.8, 13, 0], eye: [9.4, -3.5, 3.8, 0.9, 0, 0], droopy: 1, mz: [7, -4, 12.5, 10.5, 19.5], nose: [6.4, 4.7], jaw: [9, 7],
    ear: { type: 'drop', ax: 16.5, ay: -8, w: 11, wb: 17, len: 58, out: 7, lift: 2 }, neck: [16, 32], fur: 'smooth', flews: 1.4, wrinkles: 1 },
  westie: { hy: 50, hs: 1.0, sk: [19, 17, 13, 0.95, 11, 0], eye: [8.2, -2, 3.4, 0.95, 0, 0], mz: [5, -1, 9, 6.5, 13], nose: [4.7, 3.7], jaw: [6.5, 5.5],
    ear: { type: 'erect', bx: 12, by: -13, hw: 6.2, tx: 15.5, ty: -33, round: 0.15, fluff: 1 }, neck: [17, 30], fur: 'wire', skullFur: 'tuft', mzFur: 1, rims: 1,
    ruff: { cy: 2, rx: 33, ry: 30, n: 14, d: 6.5, big: 1 } },
  cavapoo: { hy: 45, hs: 1.04, sk: [22, 21, 16.5, 0.95, 12.5, 1], eye: [9.8, -1.5, 4.7, 1, 0, 0], mz: [5.8, -1, 10.6, 7.5, 15], nose: [5, 4], jaw: [7.4, 6.5],
    ear: { type: 'curly', cx: 23.5, cy: 10, rx: 10, ry: 20, n: 10, low: 1 }, top: { type: 'curls' }, neck: [16, 29], fur: 'curly', skullFur: 'curl' },
  goldendoodle: { hy: 44, hs: 1.08, sk: [24.5, 22.5, 19, 0.95, 15, 1], eye: [10, -2, 3.9, 1, 0, 0], mz: [7, -2, 13, 8.5, 18], nose: [5.9, 4.6], jaw: [9, 7.5],
    ear: { type: 'curly', cx: 25, cy: 11, rx: 11, ry: 21, n: 10 }, top: { type: 'fringe', curl: 1 }, neck: [19, 32], fur: 'curly', skullFur: 'curl', mzFur: 1 },
  maltipoo: { hy: 50, hs: 1.0, sk: [19, 17, 13.5, 0.95, 10, 0], eye: [8.2, -1, 4.4, 1, 0, 0], mz: [4.6, 0, 8.2, 6.5, 12.5], nose: [4.2, 3.4], jaw: [5.6, 5.5],
    ear: { type: 'shaggy', ax: 17.5, ay: -10, w: 11, len: 30 }, top: { type: 'fringe' }, neck: [15, 29], fur: 'shaggy', skullFur: 'tuft', mzFur: 1 },
  bernedoodle: { hy: 44, hs: 1.08, sk: [25, 22.5, 19, 0.95, 15, 1], eye: [10.2, -2, 3.9, 1, 0, 0], mz: [7, -2, 13, 8.5, 18], nose: [6, 4.6], jaw: [9, 7.5],
    ear: { type: 'curly', cx: 25, cy: 11, rx: 11, ry: 21, n: 10 }, top: { type: 'curls' }, neck: [20, 33], fur: 'curly', skullFur: 'curl', mzFur: 1 },
  sheepadoodle: { hy: 44, hs: 1.08, sk: [25, 22, 19, 0.95, 15, 1], eye: [10, -1, 3.9, 1, 0, 0], mz: [7, -1, 13, 8.5, 17.5], nose: [6, 4.6], jaw: [9, 7.5],
    ear: { type: 'shaggy', ax: 22, ay: -11, w: 13, len: 33 }, top: { type: 'fringe', cover: 1 }, neck: [20, 33], fur: 'shaggy', skullFur: 'tuft', mzFur: 1 },
  chiweenie: { hy: 52, hs: 1.0, sk: [21, 21.5, 14.5, 0.86, 9, -3], eye: [9.6, -1.5, 4.6, 1, 0.04, 0], mz: [4.4, -0.5, 8, 10, 16], nose: [4, 3.2], jaw: [5.6, 5.5],
    ear: { type: 'erect', bx: 16, by: -12, hw: 10, tx: 34, ty: -31, round: 0.4, fluff: 0, pink: 1 }, neck: [12, 24], fur: 'smooth' },
  aussiedoodle: { hy: 46, hs: 1.05, sk: [22.5, 21, 17, 0.95, 13, 1], eye: [9.8, -2, 4.2, 1, 0, 0], mz: [6, -1.5, 11.5, 8, 16], nose: [5.2, 4.1], jaw: [7.8, 7],
    ear: { type: 'curly', cx: 24, cy: 11, rx: 10, ry: 20, n: 10, low: 1 }, top: { type: 'curls' }, neck: [17, 30], fur: 'curly', skullFur: 'curl' },
  mutt: { hy: 46, hs: 1.05, sk: [23, 21, 17, 0.92, 13, 1], eye: [10, -2.5, 4.2, 0.95, 0.04, 0], mz: [6, -3, 11, 9, 17], nose: [5.5, 4.3], jaw: [8.2, 8],
    ear: { type: 'tipped', bx: 15, by: -13, hw: 9.5, tx: 24, ty: -34, fold: 0.42, odd: 1 }, neck: [17, 30], fur: 'smooth' },
  alfie_terrier: { hy: 50, hs: 1.02, sk: [22, 20, 15.5, 0.9, 11, -1], eye: [9.6, -2, 4.3, 0.95, 0.05, 0], mz: [5.2, -2, 9.4, 8.5, 16], nose: [4.8, 3.8], jaw: [7.0, 7.5],
    ear: { type: 'erect', bx: 15, by: -13, hw: 9.8, tx: 26, ty: -42, round: 0.22, fluff: 0, pink: 1 }, neck: [15, 27], fur: 'smooth' },
  teddy_terrier: { hy: 46, hs: 1.05, sk: [21, 20, 14, 0.98, 13.5, -1], eye: [8.8, -2.5, 3.7, 0.92, 0, 0], mz: [6, -1, 12.8, 6.8, 15.2], nose: [5.4, 4.1], jaw: [10, 6],
    ear: { type: 'button', fx: 16, fy: -17.5, fw: 8, tx: 25.5, ty: -3.5 }, top: { type: 'curls' }, neck: [16, 29], fur: 'curly', skullFur: 'curl', beard: 1, brows: 1 }
};
var DP_MOODS = {
  happy:   { open: 1,    tongue: 1,    smile: 1,    eo: 1, sq: 0.12, sad: 0, wide: 1,    ear: 0 },
  neutral: { open: 0,    tongue: 0,    smile: 0.6,  eo: 1, sq: 0,    sad: 0, wide: 1,    ear: 0 },
  sad:     { open: 0,    tongue: 0,    smile: -1,   eo: 1, sq: 0,    sad: 1, wide: 1.04, ear: 1 },
  sleepy:  { open: 0,    tongue: 0,    smile: 0.4,  eo: 0, sq: 0,    sad: 0, wide: 1,    ear: 0.45 },
  excited: { open: 1.35, tongue: 1.25, smile: 1,    eo: 1, sq: 0,    sad: 0, wide: 1.16, ear: -0.6 }
};
// which colour each part takes for a marking pattern
function DP_palette(coat, sp) {
  var base = coat.base || '#c9935a', shade = coat.shade || DP_mix(base, '#000000', 0.25), light = coat.light || DP_mix(base, '#ffffff', 0.4);
  var mark = coat.mark || shade, P = coat.pattern || 'solid';
  // white-based parti-colours (Cocker parti, Sheepadoodle) wear their colour as patches like a Blenheim; fawn-based pieds are "fawn & white"
  if (P === 'parti' && coat.mark && DP_lum(base) > 0.75) P = 'parti-white';
  if (P === 'pied' && DP_lum(base) < 0.75) P = 'pied-fawn';
  var q = { base: base, shade: shade, light: light, mark: mark, pat: P,
            skull: base, muz: DP_mix(base, light, 0.45), jaw: DP_mix(base, light, 0.45), ear: DP_mix(base, shade, 0.6), earIn: null,
            cheek: base, chest: base, ruff: base, eyeArea: base, top: base };
  switch (P) {
    case 'saddle-mask': q.muz = mark; q.jaw = DP_mix(mark, base, 0.15); q.ear = base; q.cheek = DP_mix(base, light, 0.5); q.eyeArea = DP_mix(base, mark, 0.4); break;
    case 'husky-mask': q.muz = light; q.jaw = light; q.ear = base; q.cheek = light; q.eyeArea = light; q.earIn = light; break;
    case 'collie-blaze': q.muz = light; q.jaw = light; q.ear = base; q.ruff = light; q.chest = light; break;
    case 'spots': q.muz = base; q.jaw = base; q.ear = base; break;
    case 'bernese-tricolor': q.muz = light; q.jaw = light; q.ear = base; q.cheek = base; break;
    case 'beagle-tricolor': q.muz = light; q.jaw = light; q.ear = DP_mix(base, shade, 0.55); break;
    case 'lemon-white': q.muz = light; q.jaw = light; q.ear = DP_mix(base, shade, 0.35); break;
    case 'corgi': q.muz = light; q.jaw = light; q.ear = base; q.cheek = base; q.earIn = light; break;
    case 'urajiro': q.muz = light; q.jaw = light; q.ear = base; q.cheek = light; q.earIn = light; break;
    case 'tan-points': q.muz = mark; q.jaw = mark; q.ear = base; break;
    case 'pug-mask': q.muz = mark; q.jaw = mark; q.ear = sp.maskUp > 0.5 ? DP_mix(mark, base, 0.08) : (sp.ear.type === 'drop' ? DP_mix(shade, mark, 0.38) : DP_mix(base, shade, 0.75)); q.eyeArea = sp.maskUp > 0.5 ? mark : base; break;
    case 'brindle': q.muz = shade; q.jaw = shade; q.ear = shade; break;
    case 'pied': q.muz = base; q.jaw = base; q.ear = mark; break;
    case 'schnauzer': q.muz = light; q.jaw = light; q.ear = DP_mix(base, shade, 0.5); break;
    case 'yorkie': q.muz = DP_mix(base, light, 0.6); q.jaw = DP_mix(base, light, 0.6); q.ear = DP_mix(base, shade, 0.75); q.chest = base; break;
    case 'parti': q.muz = light; q.jaw = light; q.ear = base; q.chest = light; q.top = base; break;
    case 'blenheim': case 'parti-white': case 'jrt':
      q.skull = mark; q.muz = base; q.jaw = base; q.ear = P === 'jrt' ? DP_mix(mark, shade, 0.2) : mark; q.cheek = P === 'jrt' ? base : mark; q.eyeArea = mark;
      q.chest = base; q.ruff = base; q.top = mark; break;
    case 'boxer': q.muz = mark; q.jaw = DP_mix(mark, base, 0.12); q.ear = DP_mix(base, mark, 0.3); break;
    case 'merle': q.muz = DP_mix(light, base, 0.2); q.jaw = light; q.ear = base; q.chest = light; q.ruff = light; q.top = base; break;
    case 'harlequin': q.muz = base; q.jaw = base; q.ear = mark; break;
    case 'boston': q.muz = light; q.jaw = light; q.ear = base; break;
    case 'pied-fawn': q.muz = DP_mix(base, light, 0.6); q.jaw = DP_mix(base, light, 0.75); q.ear = DP_mix(base, shade, 0.5); q.chest = light; break;
    case 'alfie':
      q.skull = mark; q.muz = light; q.jaw = light; q.ear = mark; q.cheek = light; q.eyeArea = '#332016';
      q.chest = light; q.ruff = light; q.top = mark; break;
    case 'teddy':
      q.skull = mark; q.muz = light; q.jaw = light; q.ear = '#35383e'; q.cheek = mark; q.eyeArea = mark;
      q.chest = base; q.ruff = base; q.top = '#646870'; break;
  }
  q.dark = DP_lum(q.skull) < 0.26;
  q.eyeDark = DP_lum(q.eyeArea) < 0.26;
  q.allDark = q.dark && (P === 'solid' || P === 'brindle' || P === 'tan-points' || (P === 'schnauzer' && DP_lum(light) < 0.4));
  q.shadeCol = q.allDark ? 'rgba(0,0,0,0.30)' : (q.dark ? 'rgba(40,22,8,0.11)' : (DP_lum(base) > 0.8 ? 'rgba(110,80,52,0.15)' : 'rgba(74,42,20,0.17)'));
  q.hiCol = q.dark ? 'rgba(255,255,255,0.11)' : 'rgba(255,255,255,0.32)';
  return q;
}

/* ---------- geometry for one portrait (mood + animation applied) ---------- */
// mood + animation state. Animation is a handful of discrete frames (blink, pant, head-tilt gesture, ear flick) so every
// frame can be served from a cached bitmap; only the small vertical bob stays continuous (it is applied at blit time).
function DP_pose(sp, opt) {
  var moodName = DP_MOODS[opt.mood] ? opt.mood : 'happy', m = DP_MOODS[moodName];
  var t = (typeof opt.t === 'number' && isFinite(opt.t)) ? opt.t : null;
  var hasSeed = typeof opt.seed === 'number' && isFinite(opt.seed);
  var seed = hasSeed ? Math.floor(opt.seed) : 0, dir = (seed & 1) ? 1 : -1;
  var eoL = m.eo > 0 ? 1 : 0, pant = 0, tw0 = 0, tw1 = 0, tiltL = 0, bob = 0;
  if (moodName === 'sad') tiltL = dir;
  if (t === null) { if (hasSeed && !tiltL) tiltL = dir; }
  else {
    var bp = (t + (seed % 7) * 0.53) % 3.7;
    if (eoL && bp < 0.13) eoL = 0;
    if (m.open > 0) { var sn = Math.sin(t * 9); pant = sn > 0 ? 1 : 0; bob += sn * 0.25; }
    if (moodName === 'sleepy') bob += Math.sin(t * 1.7) * 0.8;
    if (moodName === 'excited') bob -= Math.abs(Math.sin(t * 6.5)) * 1.4;
    var tp = t * 0.17 + seed * 0.37, tc = Math.floor(tp);
    if (moodName !== 'sad' && moodName !== 'sleepy' && tp - tc < 0.22) tiltL = ((tc + seed) & 1) ? 1 : -1;      // a little head-tilt now and then
    var ph = t * 0.9 + seed * 1.3, tw = ph % 4.6;
    if (tw < 0.14 && moodName !== 'sleepy') { if ((seed + Math.floor(ph / 4.6)) & 1) tw1 = 1; else tw0 = 1; }   // ear flick
  }
  return { moodName: moodName, m: m, t: t, seed: ((seed % 16) + 16) % 16, hasSeed: hasSeed, eoL: eoL, pant: pant, tw: [tw0, tw1], tilt: tiltL * (moodName === 'sad' ? 0.06 : 0.05), bob: bob,
           hy: sp.hy + (moodName === 'sad' ? 1.2 : 0), key: moodName + '.' + eoL + pant + (tiltL + 1) + tw0 + tw1 };
}
// S = portrait size in the caller's units (sets the outline weight); px = size in device pixels (sets the level of detail)
function DP_geom(sp, coat, opt, S, pose, px) {
  pose = pose || DP_pose(sp, opt);
  px = px || S;
  var m = pose.m, g = { sp: sp, coat: coat, S: S, m: m, moodName: pose.moodName, t: pose.t, seed: pose.seed, hs: sp.hs };
  g.q = DP_palette(coat, sp);
  g.u = S / 100;
  g.lwBox = DP_clamp(0.95 + S * 0.009, 1.25, 3.6) / g.u;     // outline width in box units
  g.lw = g.lwBox / sp.hs;                                     // ... in head units
  g.D = px >= 96; g.M = px >= 52;
  g.earTw = [pose.tw[0] * 0.12, pose.tw[1] * 0.12];
  g.tilt = pose.tilt; g.bob = pose.bob; g.eo = pose.eoL;
  g.tongue = m.tongue * (1 + 0.07 * pose.pant);
  g.sw = sp.sk[0]; g.st = sp.sk[1]; g.sb = sp.sk[2];
  g.ex = sp.eye[0]; g.ey = sp.eye[1]; g.er0 = sp.eye[2]; g.er = sp.eye[2] * m.wide;
  g.openU = m.open > 0 ? sp.jaw[1] * m.open * (1 + 0.13 * pose.pant) : 0;   // mouth opening in head units
  g.hyBox = pose.hy;
  var pt = coat.pattern;
  g.odd = ((pt === 'merle' || pt === 'harlequin') && pose.hasSeed && pose.seed % 3 === 1) ? ((pose.seed & 4) ? 1 : -1) : 0;
  return g;
}
function DP_skullPts(g) {
  var s = g.sp.sk, w = s[0], top = s[1], bot = s[2], sq = s[3], jw = s[4], cy = s[5];
  return [[0, -top], [w * (0.12 + 0.43 * sq), -top * (0.74 + 0.23 * sq)], [w * (0.52 + 0.40 * sq), -top * (0.22 + 0.40 * sq)], [w, cy],
          [(w + jw) / 2 + (w - jw) * 0.12, cy + (bot - cy) * 0.55], [jw * 0.78, cy + (bot - cy) * 0.93], [0, bot]];
}
function DP_muzPts(g) {
  var z = g.sp.mz, bw = z[0], y0 = z[1], w = z[2], ny = z[3], y1 = z[4], notch = (y1 - ny) * 0.2;
  if (g.sp.beard) {
    return [[0, y0], [bw, y0 + 0.6], [w * 0.72, ny - 1.5], [w + 0.5, ny + 3.5], [w + 2.6, y1 + 2.2, 1], [w * 0.76, y1 - 0.5], [w * 0.42, y1 + 1.2], [0, y1 - notch, 1]];
  }
  return [[0, y0], [bw * 0.9, y0 + 0.6], [bw + (w - bw) * 0.35, y0 + (ny - y0) * 0.6], [w, ny + (y1 - ny) * 0.3],
          [w * 0.9, y1 - (y1 - ny) * 0.2], [w * 0.5, y1], [0, y1 - notch, 1]];
}
function DP_lipPts(g) {
  var z = g.sp.mz, w = z[2], ny = z[3], y1 = z[4], notch = (y1 - ny) * 0.2, sm = g.m.smile * (g.m.smile > 0 ? (g.sp.smile || 1) : 1);
  var R = g.sp.beard ? [[w * 0.42, y1 + 1.2], [w * 0.74, y1 - 0.3]]
                     : [[w * 0.5, y1], [w * 0.9, y1 - (y1 - ny) * 0.2], [w * (1.0 + 0.02 * sm), y1 - (y1 - ny) * (0.42 + 0.16 * sm)]];
  var L = DP_flip(R);
  return L.concat([[0, y1 - notch, 1]], R);
}
function DP_jawPts(g) {
  var z = g.sp.mz, y1 = z[4], jw = g.sp.jaw[0], op = g.openU, yb = y1 + op + 2.3;
  if (g.sp.beard) {
    var d = op * 0.5;
    return [[0, y1 - 6], [jw, y1 - 5], [jw + 1.6, y1 + 3], [jw + 1.2, y1 + 9 + d], [jw * 0.62, y1 + 14.5 + d, 1], [jw * 0.34, y1 + 11 + d], [0, y1 + 16 + d, 1]];
  }
  return [[0, y1 - 6], [jw * 0.9, y1 - 5], [jw * 1.02, y1 - 1], [jw * 0.98, y1 + op * 0.45], [jw * 0.62, yb - 0.9], [0, yb]];
}
function DP_mouthPts(g) {
  var y1 = g.sp.mz[4], mo = Math.max(g.sp.jaw[0] - 1.7, 2), op = g.openU, up = g.sp.mzFur ? 0.5 : 4;
  return [[0, y1 - up - 1], [mo * 0.8, y1 - up], [mo, y1 + op * 0.35], [mo * 0.62, y1 + op - 0.9], [0, y1 + op]];
}
function DP_tonguePts(g) {
  var y1 = g.sp.mz[4], mo = Math.max(g.sp.jaw[0] - 1.7, 2), op = g.openU, tw = mo * 0.62;
  var tb = y1 + op + (g.tongue - 0.7) * 3.4;
  var up = g.sp.mzFur ? 0 : 3;
  return [[0, y1 - up - 1], [tw * 0.95, y1 - up], [tw, tb - tw * 1.0], [tw * 0.7, tb - tw * 0.26], [0, tb]];
}

/* ---------- marking patterns (fills are batched per colour: every canvas op costs) ---------- */
function DP_blazePts(g, wTop, wMid) {
  var z = g.sp.mz, er = g.er0;
  return DP_symPts([[0, -g.st - 4], [wTop, -g.st - 4], [wTop * 0.9, g.ey - er * 3], [wMid, g.ey - er * 0.4], [z[0] * 1.1, z[1] + (z[3] - z[1]) * 0.3],
                    [z[2] * 0.8, z[3]], [z[2] * 0.6, z[3] + 3], [0, z[3] + 3.5]]);
}
// n random blobs appended to path p
function DP_spotsInto(p, rnd, n, x0, y0, x1, y1, r0, r1, avoid) {
  for (var i = 0, tries = 0; i < n && tries < n * 8; tries++) {
    var x = x0 + rnd() * (x1 - x0), y = y0 + rnd() * (y1 - y0), r = r0 + rnd() * rnd() * (r1 - r0), ok = true;
    if (avoid) for (var k = 0; k < avoid.length; k++) { var a = avoid[k], dx = x - a[0], dy = y - a[1]; if (dx * dx + dy * dy < (a[2] + r) * (a[2] + r)) ok = false; }
    if (!ok) continue;
    DP_ellInto(p, x, y, r * (0.85 + rnd() * 0.4), r * (0.75 + rnd() * 0.3), rnd() * 3.14);
    i++;
  }
  return p;
}
// n ragged "torn" patches (merle marbling, harlequin) appended to path p; clockwise so overlaps merge
function DP_tornInto(p, rnd, n, x0, y0, x1, y1, r0, r1, avoid) {
  for (var i = 0, tries = 0; i < n && tries < n * 8; tries++) {
    var x = x0 + rnd() * (x1 - x0), y = y0 + rnd() * (y1 - y0), r = r0 + rnd() * (r1 - r0), ok = true, k;
    if (avoid) for (k = 0; k < avoid.length; k++) { var a = avoid[k], dx = x - a[0], dy = y - a[1]; if (dx * dx + dy * dy < (a[2] + r * 0.7) * (a[2] + r * 0.7)) ok = false; }
    if (!ok) continue;
    var m = 6 + Math.floor(rnd() * 3), a0 = rnd() * DP_TAU, sx = 0.75 + rnd() * 0.6, pts = [];
    for (k = 0; k < m; k++) {
      var an = a0 + (k + (rnd() - 0.5) * 0.5) / m * DP_TAU, rr = r * (0.55 + rnd() * 0.6);
      pts.push([x + Math.cos(an) * rr * sx, y + Math.sin(an) * rr / sx, rnd() < 0.4 ? 1 : 0]);
    }
    DP_curve(p, pts, true);
    i++;
  }
  return p;
}
function DP_furPatch(c, cx, cy, rx, ry, mode, col) {
  c.fillStyle = col;
  c.fill(DP_fur(DP_ring(cx, cy, rx, ry, 9, DP_rng(19), 0.4, -1.2), mode === 'curl' ? 1.8 : 2.4, mode));
}
function DP_brindleInto(A, g) {   // tiger-stripe streaks on the forehead and cheeks
  var rb = DP_rng(31 + g.seed), st = g.st, sw = g.sw, i, s;
  for (i = 0; i < 4; i++) { var yb = -st * 0.9 + i * 2.2 + rb() * 1.2, lb = 9 + rb() * 2.5; for (s = -1; s <= 1; s += 2) DP_lockInto(A, 3 + i * 5.2, yb, 1.15 - i * 0.12, lb, 1.25, -0.16, s < 0); }
  for (i = 0; i < 3; i++) { var lc = 7.5 + rb() * 2; for (s = -1; s <= 1; s += 2) DP_lockInto(A, sw * 0.62 + i * 2.2, 3.5 + i * 5, 0.75, lc, 1.2, -0.14, s < 0); }
  return A;
}
function DP_paintSkull(c, g) {
  var q = g.q, sp = g.sp, ex = g.ex, ey = g.ey, er = g.er0, z = sp.mz, bw = z[0], y0 = z[1], mw = z[2], ny = z[3], y1 = z[4];
  var sw = g.sw, st = g.st, sb = g.sb, i, s, light = q.light, mark = q.mark, base = q.base, A = new Path2D(), B = new Path2D();
  function fa(col) { c.fillStyle = col; c.fill(A); }
  function fb(col) { c.fillStyle = col; c.fill(B); }
  switch (q.pat) {
    case 'solid':
      DP_ell(c, 0, ny + 2, mw + 4, (y1 - y0) * 0.62, 0, DP_mix(base, light, 0.14));
      break;
    case 'husky-mask':
      DP_fillSym(c, [[0, ey + er * 1.3, 1], [ex * 0.36, ey - er * 1.7], [ex * 0.86, ey - er * 3.1], [ex + er * 1.7, ey - er * 2.6], [ex + er * 3.0, ey - er * 0.5],
                     [sw * 1.04, ey + er * 1.6], [sw * 1.6, ey + 9], [sw * 1.6, sb + 40], [0, sb + 40]], light);
      break;
    case 'saddle-mask':
      DP_fillSym(c, [[0, -st - 3], [sw * 0.55, -st - 3], [sw * 0.44, -st * 0.7], [ex * 0.62, ey - er * 3.3], [0, ey - er * 1.5]], DP_rgba(mark, 0.5));
      for (s = -1; s <= 1; s += 2) {
        DP_ellInto(A, s * sw * 0.66, ey + 11, 8.5, 7.5, 0);
        DP_ellInto(A, s * ex * 0.96, ey - er * 2.5, er * 1.0, er * 0.62, -s * 0.25);
        DP_ellInto(B, s * (ex - er * 0.5), ey + er * 0.5, er * 1.5, er * 1.0, s * 0.5);
      }
      fa(DP_mix(base, light, 0.58)); fb(DP_rgba(mark, 0.55));
      DP_fillSym(c, [[0, y0 - 2.5], [bw * 0.8, y0 - 1.5], [bw + 1.6, y0 + 4], [mw + 1.2, ny + 1], [mw + 1.8, y1 + 2], [0, y1 + 4]], mark);
      if (g.M && /sable/i.test(g.coat.name || '')) {
        var rs = DP_rng(77), tk = [];
        for (i = 0; i < 14; i++) tk.push([(rs() - 0.5) * sw * 1.7, -st * 0.9 + rs() * (st + sb) * 0.9, 1.5 + (rs() - 0.5), 3.5]);
        DP_ticks(c, tk, DP_rgba(mark, 0.55), g.lw * 0.8);
      }
      break;
    case 'collie-blaze':
      if (g.coat.mark) {   // tricolour: copper brows and cheeks
        for (s = -1; s <= 1; s += 2) { DP_ellInto(A, s * ex * 0.95, ey - er * 2.4, er * 0.95, er * 0.62, -s * 0.25); DP_ellInto(A, s * (mw + 3.8), ny + 3, 5.5, 7, s * 0.3); }
        fa(mark);
      }
      DP_fillPts(c, DP_blazePts(g, 3.4, 4.2), light); break;
    case 'blenheim': case 'parti-white': case 'jrt':   // skull is filled with the patch colour; paint the white back in
      var jr = q.pat === 'jrt', tri = DP_lum(mark) < 0.25, sd = (g.seed & 1) ? 1 : -1;
      if (tri) {
        for (s = -1; s <= 1; s += 2) { DP_ellInto(B, s * ex * 0.98, ey - er * 2.35, er * 0.95, er * 0.66, -s * 0.25); DP_ellInto(B, s * (mw + 4.6), ny + 1.5, 6.2, 8, s * 0.3); }
        fb('#c4793c');
      }
      DP_curve(A, DP_blazePts(g, jr ? 5.4 : 3.4, jr ? 6.6 : 4.4), true);
      for (s = -1; s <= 1; s += 2) DP_ellInto(A, s * (mw + 3.2), y1 - 0.5, 7.2, 8.5, 0);
      if (jr) { DP_ellInto(A, 0, sb, sw * 0.9, 9.5, 0); DP_ellInto(A, sd * sw * 0.72, sb - 3, sw * 0.42, 12, sd * 0.4); }
      if (q.pat === 'parti-white') DP_ellInto(A, sd * sw * 0.8, ny + 3, 7.5, 10, sd * 0.3);
      fa(base);
      if (q.pat === 'blenheim') DP_fillPts(c, [[0, -st * 0.72], [2.6, -st * 0.5, 0], [0, -st * 0.27], [-2.6, -st * 0.5, 0]], mark);   // the "Blenheim spot"
      break;
    case 'boxer':
      if (/brindle/i.test(g.coat.name || '')) { DP_brindleInto(B, g); fb(DP_mix(mark, base, 0.3)); B = new Path2D(); }
      for (s = -1; s <= 1; s += 2) DP_ellInto(B, s * ex, ey + er * 0.1, er * 2.0, er * 1.65, 0);
      fb(DP_rgba(mark, 0.42));
      DP_fillSym(c, [[0, ey - er * 0.6], [ex * 0.55, ey - er * 0.3], [ex + er * 1.3, ey + er * 1.4], [mw + 2.5, ny + 2], [mw + 2.5, y1 + 3], [0, y1 + 3]], DP_rgba(mark, 0.6));
      DP_fillPts(c, DP_blazePts(g, 2.2, 2.5), light);
      break;
    case 'merle':
      var rm = DP_rng(400 + g.seed * 17), sm = (g.seed & 2) ? 1 : -1;
      DP_tornInto(B, rm, 7, -sw * 1.1, -st * 1.1, sw * 1.1, sb * 0.7, 2.5, 6, [[0, ny, mw]]);
      fb(DP_mix(base, mark, 0.42));
      DP_tornInto(A, rm, 1, sm * (ex + 2), ey - er * 1.5, sm * (ex + 4), ey - er * 0.5, er * 2.1, er * 2.3, null);   // a big patch over one eye
      DP_tornInto(A, rm, 7, -sw * 1.1, -st * 1.1, sw * 1.1, sb * 0.8, 2.2, 6.5, [[0, ny, mw], [-sm * ex, ey, er * 1.3]]);
      fa(mark);
      DP_fillPts(c, DP_blazePts(g, 2.4, 3.2), light);
      break;
    case 'harlequin':
      var rh = DP_rng(700 + g.seed * 23), sh2 = (g.seed & 1) ? 1 : -1;
      DP_tornInto(A, rh, 1, sh2 * (ex + 1), ey - er * 1.8, sh2 * (ex + 3), ey - er * 0.8, er * 2.3, er * 2.6, null);
      DP_tornInto(A, rh, 6, -sw * 1.05, -st * 1.05, sw * 1.05, sb, 2.2, 5.5, [[0, ny, mw * 0.8], [-sh2 * ex, ey, er * 1.4]]);
      fa(mark);
      break;
    case 'boston':
      if (g.coat.mark) { DP_brindleInto(A, g); fa(DP_mix(q.mark, base, 0.3)); }
      DP_fillPts(c, DP_blazePts(g, 2.1, 2.9), light);
      break;
    case 'pied-fawn':
      DP_curve(A, DP_blazePts(g, 3.4, 4.8), true);
      fa(light);
      break;
    case 'parti':
      DP_curve(A, DP_blazePts(g, 4.5, 6), true);
      for (s = -1; s <= 1; s += 2) DP_ellInto(A, s * (mw + 3.5), y1 - 1, 6.5, 7.5, 0);
      fa(light);
      break;
    case 'bernese-tricolor':
      for (s = -1; s <= 1; s += 2) {
        DP_ellInto(A, s * (mw + 4.2), ny + 3.5, 6.8, 9.5, s * 0.35);
        DP_ellInto(A, s * ex * 0.98, ey - er * 2.55, er * 1.05, er * 0.72, -s * 0.25);
      }
      fa(mark);
      DP_fillPts(c, DP_blazePts(g, 1.5, 2.4), light);
      break;
    case 'beagle-tricolor':
    case 'lemon-white':
      DP_curve(A, DP_blazePts(g, 2.0, 3.3), true);
      for (s = -1; s <= 1; s += 2) DP_ellInto(A, s * (mw + 2), y1 - 0.5, 5, 6, 0);
      fa(light);
      break;
    case 'corgi':
      if (g.coat.mark) DP_fillSym(c, [[0, -st * 0.5], [sw * 0.3, -st * 0.62], [sw * 0.62, -st * 0.78], [sw * 0.8, -st * 1.3], [0, -st * 1.3]], DP_mix(mark, base, 0.2));
      DP_curve(A, DP_blazePts(g, 1.2, 2.1), true);
      for (s = -1; s <= 1; s += 2) DP_ellInto(A, s * (mw + 3), y1 - 1, 8, 8.5, s * 0.3);
      fa(light);
      break;
    case 'urajiro':
      for (s = -1; s <= 1; s += 2) {
        if (g.coat.mark) DP_ellInto(B, s * sw * 0.66, ey + er * 2 + 6.5, sw * 0.5 + 2.6, 12.4, s * 0.38);
        DP_ellInto(B, s * ex * 0.9, ey - er * 2.7, er * 0.97, er * 0.66, -s * 0.3);
        DP_ellInto(A, s * sw * 0.68, ey + er * 2 + 7.5, sw * 0.5, 10.2, s * 0.38);
      }
      fb(g.coat.mark ? mark : DP_mix(base, light, 0.7));
      DP_ellInto(A, 0, y1 + 1, mw + 4, 8, 0);
      fa(light);
      break;
    case 'tan-points':
      for (s = -1; s <= 1; s += 2) {
        DP_ellInto(A, s * ex * 0.92, ey - er * 2.45, er * 0.9, er * 0.62, -s * 0.25);
        DP_ellInto(A, s * (mw + 1.8), ny + 4, 4.6, 6.5, s * 0.3);
      }
      fa(mark);
      break;
    case 'pug-mask':
      var u = sp.maskUp || 0;
      if (u > 0.5) {
        DP_fillSym(c, [[0, ey - er * 0.9], [ex - er * 0.9, ey - er * 1.25], [ex + er * 0.3, ey - er * 1.5], [ex + er * 1.55, ey - er * 0.3], [ex + er * 1.3, ey + er * 1.35],
                       [mw + 2.5, ny + 5.5], [mw + 1.5, y1 + 3], [0, y1 + 5]], mark);
        if (g.M) DP_fillPts(c, [[0, -st * 0.56], [1.7, -st * 0.43], [0, -st * 0.26], [-1.7, -st * 0.43]], DP_mix(base, mark, 0.3));   // forehead "thumbprint"
      } else {
        DP_ell(c, 0, y0 + 1.5, bw + 2.5 + u * 9, 3.5 + u * 9, 0, DP_mix(mark, base, 0.3));
        DP_ell(c, 0, ny + 3, mw + 2.5, (y1 - ny) * 0.95, 0, DP_mix(mark, base, 0.12));
      }
      break;
    case 'brindle':
      DP_brindleInto(A, g);
      fa(DP_mix(mark, base, 0.25));
      break;
    case 'pied':
      s = (g.seed & 1) ? 1 : -1;
      DP_curve(A, [[s * ex * 0.3, ey - er * 3.6], [s * (ex + er * 2.6), ey - er * 5], [s * sw * 1.4, ey - er * 2], [s * sw * 1.4, ey + er * 2.4],
                   [s * (ex + er * 1.7), ey + er * 2.5], [s * (ex - er * 1.6), ey + er * 1.3]], true);
      DP_ellInto(A, -s * sw * 0.86, -st * 0.7, 8.5, 8, 0);
      fa(mark);
      break;
    case 'spots':
      DP_spotsInto(A, DP_rng(1200 + g.seed * 13), 11, -sw, -st, sw, sb, 1.3, 3.3, [[-ex, ey, er * 1.5], [ex, ey, er * 1.5], [0, ny + 2, mw * 0.9]]);
      fa(mark);
      break;
    case 'schnauzer':
      if (DP_lum(light) - DP_lum(base) > 0.15) { for (s = -1; s <= 1; s += 2) DP_ellInto(A, s * sw * 0.7, ey + 9, 7, 6, 0); fa(DP_mix(base, light, 0.3)); }
      break;
    case 'alfie':
      for (s = -1; s <= 1; s += 2) DP_ellInto(B, s * ex * 0.96, ey + er * 0.05, er * 1.9, er * 1.65, -s * 0.12);
      fb('#332016');
      DP_curve(A, DP_blazePts(g, 3.8, 5.2), true);
      for (s = -1; s <= 1; s += 2) DP_ellInto(A, s * (mw + 3.2), y1 - 0.5, 7.6, 8.8, 0);
      DP_ellInto(A, 0, sb, sw * 0.92, 9.5, 0);
      fa(light);
      break;
    case 'teddy':
      for (s = -1; s <= 1; s += 2) DP_ellInto(A, s * sw * 0.72, ey + 8.5, 7.5, 6.8, 0);
      fa(DP_mix(mark, light, 0.45));
      DP_fillPts(c, DP_blazePts(g, 2.2, 2.6), 'rgba(245,244,240,0.38)');
      break;
  }
}
function DP_muzNeedsPaint(pat) { return pat === 'husky-mask' || pat === 'urajiro' || pat === 'tan-points' || pat === 'spots'; }
function DP_paintMuz(c, g) {
  var q = g.q, sp = g.sp, z = sp.mz, bw = z[0], y0 = z[1], mw = z[2], ny = z[3], y1 = z[4], nw = sp.nose[0];
  switch (q.pat) {
    case 'husky-mask':   // the dark cap runs a little way down the bridge
      DP_fillPts(c, [[-bw * 1.3, y0 - 2], [bw * 1.3, y0 - 2], [bw * 0.4, y0 + (ny - y0) * 0.42], [0, y0 + (ny - y0) * 0.62, 1], [-bw * 0.4, y0 + (ny - y0) * 0.42]], q.base);
      break;
    case 'urajiro':
    case 'tan-points':   // coat colour stays on top of the muzzle
      DP_fillPts(c, [[-bw * 1.4, y0 - 2], [bw * 1.4, y0 - 2], [nw * 1.05, ny - 1], [nw * 0.7, ny + 1], [-nw * 0.7, ny + 1], [-nw * 1.05, ny - 1]], q.base);
      break;
    case 'spots':
      c.fillStyle = q.mark; c.fill(DP_spotsInto(new Path2D(), DP_rng(555 + g.seed * 5), 7, -mw, ny - 1, mw, y1, 0.5, 1.0, [[0, ny, nw * 1.2]]));
      break;
  }
}
function DP_paintChest(c, g, yTop) {
  var q = g.q, sp = g.sp, nw = sp.neck[0], sh = sp.neck[1], s, i, light = q.light, mark = q.mark, base = q.base, B = 112, A = new Path2D();
  var fluffy = sp.fur !== 'smooth';
  function fa(col) { c.fillStyle = col; c.fill(A); }
  switch (q.pat) {
    case 'solid': case 'pug-mask':
      if (fluffy) DP_furPatch(c, 0, 89, sh * 0.5, 12, sp.fur === 'curly' ? 'curl' : 'tuft', DP_mix(base, light, 0.55));
      break;
    case 'saddle-mask':
      DP_furPatch(c, 0, 89, sh * 0.46, 12, 'tuft', DP_mix(base, light, 0.5));
      for (s = -1; s <= 1; s += 2) DP_ellInto(A, s * sh * 1.05, 86, sh * 0.42, 24, 0);
      fa(mark);
      break;
    case 'husky-mask':
      DP_fillSym(c, [[0, yTop - 6], [nw * 0.92, yTop], [sh * 0.66, 82], [sh * 0.6, B], [0, B]], light);
      break;
    case 'collie-blaze': case 'parti':
      for (s = -1; s <= 1; s += 2) DP_ellInto(A, s * sh * 1.04, 93, sh * 0.42, 13, 0);
      if (q.pat === 'parti') DP_ellInto(A, ((g.seed & 1) ? -1 : 1) * sh * 0.55, 96, 7, 6, 0.3);
      fa(base);
      break;
    case 'spots':
      DP_spotsInto(A, DP_rng(900 + g.seed * 3), 12, -sh, yTop, sh, 100, 1.2, 3.0, null);
      fa(mark);
      break;
    case 'bernese-tricolor':
      for (s = -1; s <= 1; s += 2) DP_ellInto(A, s * 10.5, 84, 6.5, 5.5, s * 0.7);
      fa(mark);
      DP_fillSym(c, [[0, yTop - 4], [5, yTop], [7, 80], [13.5, 86.5], [9, 93], [6, B], [0, B]], light);
      break;
    case 'beagle-tricolor':
      for (s = -1; s <= 1; s += 2) DP_ellInto(A, s * sh * 1.08, 90, sh * 0.42, 18, 0);
      fa(mark);
      DP_fillSym(c, [[0, yTop - 6], [nw * 0.8, yTop], [sh * 0.52, 84], [sh * 0.55, B], [0, B]], light);
      break;
    case 'lemon-white':
      DP_fillSym(c, [[0, yTop - 6], [nw * 0.8, yTop], [sh * 0.58, 84], [sh * 0.6, B], [0, B]], light);
      break;
    case 'corgi':
      DP_fillSym(c, [[0, yTop - 6], [nw * 0.9, yTop], [sh * 0.72, 84], [sh * 0.68, B], [0, B]], light);
      break;
    case 'urajiro':
      if (g.coat.mark) DP_fillSym(c, [[0, yTop - 6], [nw * 0.86, yTop + 1], [sh * 0.66, 86], [sh * 0.58, B], [0, B]], mark);
      DP_fillSym(c, [[0, yTop - 6], [nw * 0.72, yTop + 2], [sh * 0.52, 87], [sh * 0.44, B], [0, B]], light);
      break;
    case 'tan-points':
      for (s = -1; s <= 1; s += 2) DP_curve(A, [[s * 2.2, 84.5], [s * sh * 0.34, 81.5], [s * sh * 0.42, 86], [s * sh * 0.2, 90.5]], true);
      fa(mark);
      break;
    case 'brindle':
      var rb = DP_rng(61 + g.seed);
      for (i = 0; i < 4; i++) { var yb = 76 + i * 3.5 + rb() * 2, lb = 10 + rb() * 3; for (s = -1; s <= 1; s += 2) DP_lockInto(A, sh * 0.3 + i * 5.5, yb, 1.2, lb, 1.3, -0.12, s < 0); }
      fa(DP_mix(mark, base, 0.25));
      DP_ell(c, 0, 93, 5, 9, 0, '#f1ebe0');
      break;
    case 'pied':
      DP_ell(c, ((g.seed & 1) ? -1 : 1) * sh * 0.8, 95, 11, 9, 0.2, mark);
      break;
    case 'blenheim': case 'parti-white': case 'jrt':
      for (s = -1; s <= 1; s += 2) DP_ellInto(A, s * sh * 1.08, q.pat === 'jrt' ? 96 : 90, sh * 0.4, q.pat === 'jrt' ? 9 : 15, 0);
      if (q.pat === 'parti-white') DP_ellInto(A, ((g.seed & 1) ? -1 : 1) * sh * 0.5, 97, 8, 6, 0.3);
      fa(mark);
      break;
    case 'boxer':
      if (/brindle/i.test(g.coat.name || '')) {
        var rx = DP_rng(61 + g.seed);
        for (i = 0; i < 4; i++) { var yx = 76 + i * 3.5 + rx() * 2; for (s = -1; s <= 1; s += 2) DP_lockInto(A, sh * 0.3 + i * 5.5, yx, 1.2, 10 + rx() * 3, 1.3, -0.12, s < 0); }
        fa(DP_mix(mark, base, 0.3));
      }
      DP_fillSym(c, [[0, yTop - 6], [nw * 0.55, yTop + 2], [sh * 0.42, 84], [sh * 0.48, B], [0, B]], light);
      break;
    case 'merle':
      for (s = -1; s <= 1; s += 2) DP_ellInto(A, s * sh * 1.04, 92, sh * 0.44, 15, 0);
      fa(base);
      A = new Path2D(); DP_tornInto(A, DP_rng(90 + g.seed), 6, -sh * 1.1, 80, sh * 1.1, 104, 2.5, 5, [[0, 92, sh * 0.7]]);
      fa(q.mark);
      break;
    case 'harlequin':
      DP_tornInto(A, DP_rng(95 + g.seed * 7), 7, -sh, yTop, sh, 104, 2.5, 6.5, null);
      fa(mark);
      break;
    case 'boston':
      if (g.coat.mark) { for (i = 0; i < 4; i++) for (s = -1; s <= 1; s += 2) DP_lockInto(A, sh * 0.5 + i * 5, 78 + i * 4, 1.2, 11, 1.3, -0.12, s < 0); fa(DP_mix(mark, base, 0.3)); }
      DP_fillSym(c, [[0, yTop - 6], [nw * 0.7, yTop + 1], [sh * 0.55, 84], [sh * 0.5, B], [0, B]], light);
      break;
    case 'pied-fawn':
      for (s = -1; s <= 1; s += 2) DP_ellInto(A, s * sh * 1.08, 88, sh * 0.42, 16, 0);
      fa(base);
      break;
    case 'schnauzer':
      if (DP_lum(light) - DP_lum(base) > 0.15) DP_furPatch(c, 0, 92, sh * 0.42, 11, 'tuft', DP_mix(base, light, 0.75));
      break;
    case 'yorkie':
      for (s = -1; s <= 1; s += 2) DP_ellInto(A, s * sh * 1.0, 90, sh * 0.52, 22, 0);
      fa(mark);
      break;
    case 'teddy':
      DP_furPatch(c, 0, 91, sh * 0.46, 12, 'curl', light);
      break;
  }
  // form shadow on the right + the shadow cast by the head, in one fill
  DP_shadeOut2(c, -sh * 0.22, 78, sh * 1.12, 34, q.shadeCol, 1.5, yTop + 3, nw * 1.25, 10.5);
}
function DP_paintRuff(c, g, r) {
  var q = g.q, rx = r.rx, ry = r.ry, cy = r.cy;
  if (q.pat === 'husky-mask') {
    DP_ell(c, 0, cy + ry * 0.62, rx * 0.86, ry * 0.7, 0, q.light);
  } else if (q.pat !== 'collie-blaze') {
    c.fillStyle = DP_mix(q.ruff, q.light, 0.6);
    c.fill(DP_fur(DP_ring(0, cy + ry * 0.08, rx * 0.72, ry * 0.72, r.n - 3, DP_rng(5), 0.5, 0.3), r.d * 0.8, r.curl ? 'curl' : 'tuft'));
  }
  DP_shadeOut(c, -rx * 0.2, cy - ry * 0.2, rx * 1.05, ry * 1.06, DP_shadeFor(q.ruff));
}

/* ---------- ears (both sides are built into shared paths: one stroke + a few fills for the pair) ---------- */
function DP_earRot(g, side, erect) {
  var e = g.m.ear, r = erect ? (e > 0 ? e * 0.34 : e * 0.09) : (e > 0 ? e * 0.07 : e * 0.24);
  return r + g.earTw[side < 0 ? 0 : 1] * (erect ? 1 : 0.6);
}
function DP_earInnerCol(g) {
  var q = g.q, e = g.sp.ear;
  if (e.pink) return DP_mix('#eeb0a4', q.base, 0.18);
  return DP_mix(q.earIn || q.light, '#e8a596', q.dark ? 0.55 : 0.3);
}
function DP_earErect(c, g) {
  var e = g.sp.ear, q = g.q, lw = g.lw, hw = e.hw, s, i;
  var dx = e.tx - e.bx, dy = e.ty - e.by, L = Math.sqrt(dx * dx + dy * dy) || 1, ux = dx / L, uy = dy / L, px = -uy, py = ux;
  var Bi = [e.bx - hw, e.by + 6], Bo = [e.bx + hw * 1.05, e.by + 8], T = [e.tx, e.ty];
  var r = (e.round || 0) * hw, pts = [[e.bx, e.by + 10], Bi];
  pts.push([(Bi[0] + T[0]) / 2 - px * hw * 0.2, (Bi[1] + T[1]) / 2 - py * hw * 0.2]);
  if (e.round > 0.4) {
    pts.push([T[0] - px * r * 0.62 - ux * r * 0.25, T[1] - py * r * 0.62 - uy * r * 0.25]);
    pts.push([T[0] + px * r * 0.1, T[1] + py * r * 0.1]);
    pts.push([T[0] + px * r * 0.7 - ux * r * 0.42, T[1] + py * r * 0.7 - uy * r * 0.42]);
  } else pts.push([T[0], T[1], e.round < 0.18 ? 1 : 0]);
  pts.push([(Bo[0] + T[0]) / 2 + px * hw * 0.3, (Bo[1] + T[1]) / 2 + py * hw * 0.3]);
  pts.push(Bo);
  var C = [e.bx + hw * 0.08, e.by + 5], k = e.thick ? 0.56 : 0.66, inner = [], deep = [];
  for (i = 0; i < pts.length; i++) inner.push([C[0] + (pts[i][0] - C[0]) * k + ux * L * 0.03 + px * hw * 0.02, C[1] + (pts[i][1] - C[1]) * k * 1.04 + uy * L * 0.03, pts[i][2]]);
  for (i = 0; i < inner.length; i++) deep.push([C[0] + (inner[i][0] - C[0]) * 0.62 + px * hw * 0.1, C[1] + (inner[i][1] - C[1]) * 0.7, inner[i][2]]);
  var outerCol = q.ear;
  if (q.pat === 'saddle-mask') outerCol = DP_mix(q.mark, q.base, 0.22);
  if (q.pat === 'corgi' && g.coat.mark) outerCol = DP_mix(q.mark, q.base, 0.3);
  if (q.pat === 'pied') outerCol = q.mark;
  var inCol = DP_earInnerCol(g), PO = new Path2D(), PI = new Path2D(), PD = new Path2D(), PF = new Path2D(), a0 = Math.atan2(uy, ux);
  for (s = -1; s <= 1; s += 2) {
    var rot = DP_earRot(g, s, true), ca = Math.cos(rot), sa = Math.sin(rot);
    DP_curve(PO, DP_xf(pts, s, e.bx, e.by, rot), true);
    DP_curve(PI, DP_xf(inner, s, e.bx, e.by, rot), true);
    DP_curve(PD, DP_xf(deep, s, e.bx, e.by, rot), true);
    if (e.fluff && g.M) {   // fur tufts in the ear opening
      var fl = [[-0.36, 1, 0.1, 0.4, 0.05], [0.02, 1, 0.22, 0.32, -0.05], [0.36, 2, 0.42, 0.24, -0.06]];
      for (i = 0; i < 3; i++) {
        var fx = C[0] + hw * fl[i][0] - e.bx, fy = C[1] + fl[i][1] - e.by;
        DP_lockInto(PF, e.bx + fx * ca - fy * sa, e.by + fx * sa + fy * ca, a0 + fl[i][2] + rot, L * fl[i][3], hw * 0.2, fl[i][4], s < 0);
      }
    }
  }
  DP_group(c, [{ p: PO, fill: outerCol, paint: DP_earPatchPaint(g) }], lw);
  c.fillStyle = inCol; c.fill(PI);
  c.fillStyle = DP_mix(inCol, DP_OUT, 0.3); c.fill(PD);
  if (e.fluff && g.M) { c.fillStyle = q.earIn || DP_mix(q.light, q.base, 0.25); c.fill(PF); }
}
function DP_earTipped(c, g) {
  var e = g.sp.ear, q = g.q, lw = g.lw, hw = e.hw, s;
  var PU = new Path2D(), PF = new Path2D(), PI = new Path2D(), PS = new Path2D();
  for (s = -1; s <= 1; s += 2) {
    // e.odd: one ear stands (almost) up, the other folds - the classic scruffy mix look
    var f = e.fold || 0.6;
    if (e.odd && s === ((g.seed & 1) ? -1 : 1)) f = 1;
    var Bi = [e.bx - hw, e.by + 6], Bo = [e.bx + hw * 1.05, e.by + 8], T = [e.tx, e.ty];
    var Fi = [DP_lerp(Bi[0], T[0], f), DP_lerp(Bi[1], T[1], f)], Fo = [DP_lerp(Bo[0], T[0], f) + hw * 0.1, DP_lerp(Bo[1], T[1], f)];
    var mx = (Fi[0] + Fo[0]) / 2, my = (Fi[1] + Fo[1]) / 2, fw = Fo[0] - Fi[0], C = [e.bx, e.by + 5];
    var drop = (1 - f) * Math.abs(e.ty - e.by) * 0.78 + g.m.ear * 1.5;
    var upPts = [[e.bx, e.by + 10], Bi, [(Bi[0] + Fi[0]) / 2 - hw * 0.14, (Bi[1] + Fi[1]) / 2], [Fi[0], Fi[1] - 0.6], [mx, my - 2.6], [Fo[0], Fo[1] - 0.4],
                 [(Bo[0] + Fo[0]) / 2 + hw * 0.24, (Bo[1] + Fo[1]) / 2], Bo];
    var flapPts = [[Fi[0] - 0.7, Fi[1] - 0.2], [mx, my - 2.8], [Fo[0] + 0.8, Fo[1]], [mx + fw * 0.46, my + drop * 0.5], [mx + fw * 0.22, my + drop, 1], [mx - fw * 0.26, my + drop * 0.55]];
    var inPts = [[C[0] - hw * 0.66, C[1] + 3], [Fi[0] + fw * 0.13, Fi[1] + 1], [Fo[0] - fw * 0.16, Fo[1] + 2], [C[0] + hw * 0.68, C[1] + 5]];
    var shPts = [[mx - fw * 0.32, my + drop * 0.55], [mx + fw * 0.18, my + drop * 1.02], [mx + fw * 0.4, my + drop * 0.6], [mx + fw * 0.3, my + drop * 1.45], [mx - fw * 0.1, my + drop * 1.5]];
    var rot = DP_earRot(g, s, true);
    DP_curve(PU, DP_xf(upPts, s, e.bx, e.by, rot), true);
    DP_curve(PI, DP_xf(inPts, s, e.bx, e.by, rot), true);
    if (f < 0.99) { DP_curve(PF, DP_xf(flapPts, s, e.bx, e.by, rot), true); DP_curve(PS, DP_xf(shPts, s, e.bx, e.by, rot), true); }
  }
  var inCol = DP_earInnerCol(g), pp = DP_earPatchPaint(g);
  DP_group(c, [{ p: PU, fill: q.ear, paint: pp }], lw);
  c.fillStyle = inCol; c.fill(PI);
  c.fillStyle = DP_mix(inCol, DP_OUT, 0.28); c.fill(PS);       // shadow under the folded tip
  DP_group(c, [{ p: PF, fill: DP_mix(q.ear, q.dark ? '#ffffff' : '#000000', 0.1), paint: pp }], lw);
}
function DP_dropPts(e, g) {
  var ax = e.ax, ay = e.ay, w = e.w, wb = e.wb, len = e.len + (g.m.ear > 0 ? g.m.ear * 1.5 : 0), out = e.out, lift = e.lift || 3;
  return [[ax - w * 0.36, ay + 1.5], [ax + w * 0.22, ay - lift], [ax + w * 0.84, ay + len * 0.06 + 1], [ax + w * 0.8 + out * 0.5 + (wb - w) * 0.3, ay + len * 0.45],
          [ax + out + wb * 0.5, ay + len * 0.8], [ax + out + wb * 0.05, ay + len], [ax + out - wb * 0.45, ay + len * 0.84], [ax - w * 0.3 + out * 0.4, ay + len * 0.45]];
}
function DP_earDrop(c, g) {
  var e = g.sp.ear, q = g.q, lw = g.lw, pts = DP_dropPts(e, g), col = q.ear, s, i;
  var len = e.len + (g.m.ear > 0 ? g.m.ear * 1.5 : 0);
  if (q.pat === 'pied' || q.pat === 'parti') col = q.pat === 'pied' ? q.mark : q.base;
  var PE = new Path2D(), PL = new Path2D(), PS = new Path2D(), PN = new Path2D(), bx = e.ax + e.out, by = e.ay + len;
  // shade: the lobe / underside of the flap
  var sh = [[pts[3][0] - e.w * 0.12, pts[3][1] + len * 0.05], [pts[4][0] - e.wb * 0.06, pts[4][1]], [pts[5][0], pts[5][1] - len * 0.02], [pts[6][0] + e.wb * 0.1, pts[6][1] - len * 0.01],
            [bx - e.wb * 0.12, by - len * 0.3], [bx + e.wb * 0.22, by - len * 0.42]];
  var fold = [[e.ax - e.w * 0.12, e.ay + 1.2], [e.ax + e.w * 0.3, e.ay - e.lift * 0.15], [e.ax + e.w * 0.62, e.ay + len * 0.1 + 1.5]];
  var st1 = [[e.ax + 1.5, e.ay + len * 0.3], [e.ax + 2.5 + e.out * 0.3, e.ay + len * 0.55], [e.ax + 1.5 + e.out * 0.7, e.ay + len * 0.8]];
  var st2 = [[e.ax + e.w * 0.55, e.ay + len * 0.28], [e.ax + e.w * 0.6 + e.out * 0.4, e.ay + len * 0.52], [e.ax + e.wb * 0.3 + e.out, e.ay + len * 0.76]];
  for (s = -1; s <= 1; s += 2) {
    var rot = DP_earRot(g, s, false), ca = Math.cos(rot), sa = Math.sin(rot);
    DP_curve(PE, DP_xf(pts, s, e.ax, e.ay, rot), true);
    DP_curve(PS, DP_xf(sh, s, e.ax, e.ay, rot), true);
    if (g.M) {
      DP_curve(PN, DP_xf(fold, s, e.ax, e.ay, rot), false);
      if (e.feather) { DP_curve(PN, DP_xf(st1, s, e.ax, e.ay, rot), false); DP_curve(PN, DP_xf(st2, s, e.ax, e.ay, rot), false); }
    }
    if (e.feather) {   // feathering that hangs off the lower edge
      var fl = [[0.34, -0.2, 1.4, 0.2, 0.24, -0.08], [-0.02, -0.12, 1.62, 0.21, 0.26, 0.04], [-0.34, -0.2, 1.8, 0.17, 0.22, 0.08]];
      for (i = 0; i < 3; i++) {
        var fx = bx + e.wb * fl[i][0] - e.ax, fy = by + len * fl[i][1] - e.ay;
        DP_lockInto(PL, e.ax + fx * ca - fy * sa, e.ay + fx * sa + fy * ca, fl[i][2] + rot, len * fl[i][3], e.wb * fl[i][4], fl[i][5], s < 0);
      }
    }
  }
  var parts = [{ p: PE, fill: col }];
  if (e.feather) parts.unshift({ p: PL, fill: col });
  if (q.pat === 'spots') parts[parts.length - 1].paint = function (c) {
    var A = new Path2D();
    for (var k = -1; k <= 1; k += 2) {
      DP_ellInto(A, k * (e.ax + e.out), e.ay + len * 0.8, e.wb * 0.75, len * 0.26, k * 0.2);
      DP_spotsInto(A, DP_rng(300 + g.seed * 11 + (k > 0 ? 5 : 0)), 6, k > 0 ? e.ax - e.w * 0.3 : -e.ax - e.w, e.ay, k > 0 ? e.ax + e.w : -e.ax + e.w * 0.3, e.ay + len * 0.5, 1.4, 3.2, null);
    }
    c.fillStyle = q.mark; c.fill(A);
  };
  else parts[parts.length - 1].paint = DP_earPatchPaint(g);
  DP_group(c, parts, lw);
  c.fillStyle = DP_shadeFor(col); c.fill(PS);
  if (g.M) { c.strokeStyle = DP_lineCol(col); c.lineWidth = lw * 0.5; c.stroke(PN); }
}
function DP_earButton(c, g) {
  var e = g.sp.ear, q = g.q, lw = g.lw, col = q.ear, s;
  var ty = e.ty + (g.m.ear > 0 ? g.m.ear * 1.5 : g.m.ear * 2);
  var pts = [[e.fx - e.fw, e.fy + 2.5], [e.fx - e.fw * 0.2, e.fy - 2.6], [e.fx + e.fw * 0.75, e.fy - 0.5], [e.fx + e.fw * 1.15, e.fy + (ty - e.fy) * 0.45],
             [e.tx, ty], [e.fx + (e.tx - e.fx) * 0.35 - e.fw * 0.25, e.fy + (ty - e.fy) * 0.62]];
  var sh = [[pts[3][0] - e.fw * 0.15, pts[3][1]], [pts[4][0] - 0.4, pts[4][1] - 0.6], [pts[5][0] + e.fw * 0.2, pts[5][1] + 0.5], [e.fx + e.fw * 0.55, e.fy + (ty - e.fy) * 0.42]];
  var fold = [[e.fx - e.fw * 0.55, e.fy + 1.6], [e.fx + e.fw * 0.1, e.fy + 0.2], [e.fx + e.fw * 0.8, e.fy + 2.4]];
  var PE = new Path2D(), PS = new Path2D(), PN = new Path2D();
  for (s = -1; s <= 1; s += 2) {
    var rot = g.earTw[s < 0 ? 0 : 1] * 0.6;
    DP_curve(PE, DP_xf(pts, s, e.fx, e.fy, rot), true);
    DP_curve(PS, DP_xf(sh, s, e.fx, e.fy, rot), true);
    DP_curve(PN, DP_xf(fold, s, e.fx, e.fy, rot), false);
  }
  DP_group(c, [{ p: PE, fill: col }], lw);
  c.fillStyle = DP_shadeFor(col); c.fill(PS);
  if (g.M) { c.strokeStyle = DP_lineCol(col); c.lineWidth = lw * 0.5; c.stroke(PN); }
}
function DP_earFur(c, g) {
  var e = g.sp.ear, q = g.q, lw = g.lw, col = q.ear, curly = e.type === 'curly', cx, cy, rx, ry, n, s, i;
  if (curly) { cx = e.cx; cy = e.cy + (g.m.ear > 0 ? g.m.ear : 0); rx = e.rx; ry = e.ry; n = e.n; }
  else { cx = e.ax + 3; cy = e.ay + e.len * 0.5; rx = e.w * 0.74; ry = e.len * 0.54; n = 8; }
  if (q.pat === 'parti') col = q.base;
  var ring = DP_ring(cx, cy, rx, ry, n, DP_rng(41), curly ? 0.35 : 0.4, -1.2), PE = new Path2D(), m = [], r2 = DP_rng(43), pv = [cx, cy - ry];
  var marks = [];
  for (i = 0; i < 5; i++) marks.push(curly ? [cx + (i % 2 ? 0.3 : -0.3) * rx + (r2() - 0.5) * rx * 0.3, cy - ry * 0.66 + i * ry * 0.33, 1.6 + r2() * 0.7, r2() * 6]
                                                         : [cx + (r2() - 0.5) * rx * 1.0, cy - ry * 0.6 + i * ry * 0.26, 1.45 + (r2() - 0.5) * 0.5, 5]);
  for (s = -1; s <= 1; s += 2) {
    var rot = DP_earRot(g, s, false), ca = Math.cos(rot), sa = Math.sin(rot);
    DP_fur(DP_xf(ring, s, pv[0], pv[1], rot), curly ? 2.6 : 3.4, curly ? 'curl' : 'tuft', null, 0, PE);
    if (g.M) for (i = 0; i < marks.length; i++) {
      var k = marks[i], dx = k[0] - pv[0], dy = k[1] - pv[1], X = pv[0] + dx * ca - dy * sa, Y = pv[1] + dx * sa + dy * ca;
      m.push(curly ? [s * X, Y, k[2], k[3]] : [s * X, Y, s > 0 ? k[2] + rot : Math.PI - k[2] - rot, k[3]]);
    }
  }
  var ppf = DP_earPatchPaint(g);
  DP_group(c, [{ p: PE, fill: col, paint: (g.D || ppf) ? function (c) {
    if (ppf) ppf(c);
    if (!g.D) return;
    var A = new Path2D();
    A.rect(-80, -80, 160, 160);
    for (var k = -1; k <= 1; k += 2) { A.moveTo(k * cx - rx * 0.3 + rx * 1.15, cy - ry * 0.25); A.ellipse(k * cx - rx * 0.3, cy - ry * 0.25, rx * 1.15, ry * 1.05, 0, 0, DP_TAU, true); A.closePath(); }
    c.fillStyle = DP_shadeFor(col); c.fill(A, 'evenodd');
  } : null }], lw);
  if (g.M) { if (curly) DP_curlMarks(c, m, DP_lineCol(col), lw * 0.5); else DP_ticks(c, m, DP_lineCol(col), lw * 0.5); }
}
// merle / harlequin / alfie patches on the ears (used as a DP_group paint callback: already clipped to the ear)
function DP_earPatchPaint(g) {
  var q = g.q;
  if (q.pat === 'alfie') {
    return function (c) {
      var A = new Path2D(), e = g.sp.ear;
      for (var s = -1; s <= 1; s += 2) DP_ellInto(A, s * e.tx, e.ty + 6, 11, 14, s * 0.25);
      c.fillStyle = '#2f1e14'; c.fill(A);
    };
  }
  if (q.pat !== 'merle') return null;
  return function (c) {
    var A = new Path2D();
    DP_tornInto(A, DP_rng(610 + g.seed * 29), q.pat === 'merle' ? 16 : 12, -46, -50, 46, 70, 3, 7, null);
    c.fillStyle = q.pat === 'merle' ? q.mark : q.base; c.fill(A);
  };
}
// rose ear: a small flap folded back and out, showing a curl of its inside (Greyhound, Bulldog)
function DP_earRose(c, g) {
  var e = g.sp.ear, q = g.q, lw = g.lw, hw = e.hw, bx = e.bx, by = e.by, dx = e.tx - bx, dy = e.ty - by, s;
  var lift = g.m.ear > 0 ? g.m.ear * 2.2 : g.m.ear * 1.5;
  var pts = [[bx - hw * 0.7, by + hw * 0.6], [bx - hw * 0.1, by - hw * 0.85], [bx + dx * 0.55, by + dy * 0.45 - hw * 0.75 - lift * 0.3], [e.tx, e.ty + lift, 1],
             [bx + dx * 0.72, by + dy * 0.75 + hw * 0.55 + lift * 0.6], [bx + dx * 0.3, by + hw * 0.95], [bx - hw * 0.2, by + hw * 1.05]];
  var inner = [[bx + dx * 0.08, by + hw * 0.15], [bx + dx * 0.5, by + dy * 0.4 - hw * 0.2 - lift * 0.2], [e.tx - dx * 0.12, e.ty + lift + hw * 0.22],
               [bx + dx * 0.55, by + dy * 0.6 + hw * 0.45 + lift * 0.4], [bx + dx * 0.2, by + hw * 0.6]];
  var fold = [[bx + dx * 0.1, by - hw * 0.3], [bx + dx * 0.45, by + dy * 0.35 - hw * 0.5 - lift * 0.25], [e.tx - dx * 0.08, e.ty + lift - hw * 0.05]];
  var PO = new Path2D(), PI = new Path2D(), PN = new Path2D();
  for (s = -1; s <= 1; s += 2) {
    var rot = g.earTw[s < 0 ? 0 : 1] * 0.8;
    DP_curve(PO, DP_xf(pts, s, bx, by, rot), true);
    DP_curve(PI, DP_xf(inner, s, bx, by, rot), true);
    DP_curve(PN, DP_xf(fold, s, bx, by, rot), false);
  }
  DP_group(c, [{ p: PO, fill: q.ear, paint: DP_earPatchPaint(g) }], lw);
  c.fillStyle = DP_mix(DP_earInnerCol(g), DP_OUT, 0.25); c.fill(PI);
  if (g.M) { c.strokeStyle = DP_lineCol(q.ear); c.lineWidth = lw * 0.5; c.stroke(PN); }
}
function DP_ears(c, g, layer) {
  var type = g.sp.ear.type, back = (type === 'erect' || type === 'tipped' || type === 'rose');
  if (type === 'none') return;   // hidden in the fluff (Bichon)
  if ((layer === 'back') !== back) return;
  if (type === 'erect') DP_earErect(c, g);
  else if (type === 'rose') DP_earRose(c, g);
  else if (type === 'tipped') DP_earTipped(c, g);
  else if (type === 'drop') DP_earDrop(c, g);
  else if (type === 'button') DP_earButton(c, g);
  else DP_earFur(c, g);
}

/* ---------- face features ---------- */
function DP_eyeInto(p, x, y, s, rot, a, up, upo, lo, kk, lidOnly) {
  var ca = Math.cos(rot), sa = Math.sin(rot);
  function X(u, v) { return x + s * (u * ca - v * sa); }
  function Y(u, v) { return y + (u * sa + v * ca); }
  p.moveTo(X(-a, 0), Y(-a, 0));
  p.bezierCurveTo(X(-a * kk, -up * 1.33), Y(-a * kk, -up * 1.33), X(a * kk, -upo * 1.33), Y(a * kk, -upo * 1.33), X(a, 0), Y(a, 0));
  if (lidOnly) return;
  p.bezierCurveTo(X(a * kk, lo * 1.33), Y(a * kk, lo * 1.33), X(-a * kk, lo * 1.33), Y(-a * kk, lo * 1.33), X(-a, 0), Y(-a, 0));
  p.closePath();
}
function DP_eyes(c, g) {
  var sp = g.sp, q = g.q, lw = g.lw, r = g.er, k = sp.eye[3], tilt = sp.eye[4] || 0, m = g.m, s;
  var squint = Math.max(sp.eye[5] || 0, m.sq), eo = g.eo;
  var a = r * (1 + (1 - k) * 0.6), up = r * (k < 0.8 ? 0.9 : 1) * eo, lo = r * (k < 0.8 ? 0.74 : 0.96) * (1 - squint * 0.75) * eo;
  var kk = DP_lerp(0.5, 1, DP_clamp((k - 0.5) / 0.5, 0, 1)), rot = -tilt + (m.sad ? 0.24 : 0), upo = m.sad ? up * 0.79 : up;
  var custom = !!g.coat.eye, iris = g.coat.eye || (q.eyeDark ? '#9a6434' : '#5e391f');
  var P = new Path2D(), ex = g.ex, ey = g.ey;
  c.lineCap = 'round'; c.lineJoin = 'round';
  if (eo < 0.22) {   // closed: soft downward arcs with lashes
    for (s = -1; s <= 1; s += 2) {
      var ca = Math.cos(rot), sa = Math.sin(rot), X = function (u, v) { return s * ex + s * (u * ca - v * sa); }, Y = function (u, v) { return ey + u * sa + v * ca; };
      P.moveTo(X(-a, -r * 0.1), Y(-a, -r * 0.1)); P.quadraticCurveTo(X(0, r * 0.95), Y(0, r * 0.95), X(a, -r * 0.1), Y(a, -r * 0.1));
      if (g.D) { P.moveTo(X(a * 0.55, r * 0.36), Y(a * 0.55, r * 0.36)); P.lineTo(X(a * 0.8, r * 0.75), Y(a * 0.8, r * 0.75)); P.moveTo(X(a * 0.95, r * 0.02), Y(a * 0.95, r * 0.02)); P.lineTo(X(a * 1.28, r * 0.3), Y(a * 1.28, r * 0.3)); }
    }
    c.strokeStyle = q.eyeDark ? DP_mix(q.eyeArea, '#ffffff', 0.5) : DP_OUT; c.lineWidth = lw * 0.9; c.stroke(P);
  } else {
    var PP = new Path2D(), PL = new Path2D(), PH = new Path2D(), pr = Math.min(r * (custom ? 0.46 : 0.62), Math.min(up, lo) * 0.96);
    var hr = r * (m.wide > 1.1 ? 0.4 : 0.33) * Math.min(1, eo + 0.2), h2 = r * (m.sad || m.wide > 1.1 ? 0.2 : 0.13);
    for (s = -1; s <= 1; s += 2) {
      DP_eyeInto(P, s * ex, ey, s, rot, a, up, upo, lo, kk, false);
      DP_eyeInto(PL, s * ex, ey, s, rot, a, up, upo, lo, kk, true);
      DP_ellInto(PP, s * ex, ey, pr, pr, 0);
      DP_ellInto(PH, s * ex - r * 0.3, ey - r * 0.36 * eo, hr, hr, 0);   // highlights stay top-left on both eyes
      if (g.M) DP_ellInto(PH, s * ex + r * 0.36, ey + r * 0.3 * eo, h2, h2, 0);
    }
    if (q.eyeDark) { c.strokeStyle = DP_mix(q.eyeArea, '#ffffff', 0.2); c.lineWidth = lw * 1.5; c.stroke(P); }
    if (sp.rims) { c.strokeStyle = '#2a1a14'; c.lineWidth = lw * 2.1; c.stroke(P); }   // dark "halo" round the eyes of white fluffballs
    c.fillStyle = (custom || g.M || q.eyeDark) ? iris : '#2a1a12'; c.fill(P);
    if (g.odd) {   // merle odd eyes: one blue, one brown
      var PO = new Path2D(); DP_eyeInto(PO, g.odd * ex, ey, g.odd, rot, a, up, upo, lo, kk, false);
      c.fillStyle = custom ? '#7a4a26' : '#6ec6e8'; c.fill(PO);
    }
    if (custom || g.M || q.eyeDark) { c.fillStyle = '#1b110c'; c.fill(PP); }
    c.strokeStyle = custom ? '#2a1c14' : DP_OUT; c.lineWidth = lw * (g.M ? 0.62 : 0.5); c.stroke(P);
    if (g.M) { c.lineWidth = lw * 1.0; c.stroke(PL); }
    c.fillStyle = '#ffffff'; c.fill(PH);
    if (sp.droopy) {   // hound eyes: heavy upper lids and a sagging red haw underneath
      var PW = new Path2D(), PLd = new Path2D(), PLe = new Path2D(), dr = sp.droopy;
      for (s = -1; s <= 1; s += 2) {
        var X0 = s * ex;
        PW.moveTo(X0 - a * 0.8, ey + lo * 0.45); PW.quadraticCurveTo(X0 + s * a * 0.1, ey + lo + r * 1.45 * dr, X0 + a * 0.85, ey + lo * 0.45);
        PW.quadraticCurveTo(X0, ey + lo + r * 0.35, X0 - a * 0.8, ey + lo * 0.45); PW.closePath();
        PLd.moveTo(X0 - a * 1.2, ey - up * 0.1); PLd.quadraticCurveTo(X0, ey - up * 2.1, X0 + a * 1.2, ey - up * 0.1);
        PLd.quadraticCurveTo(X0, ey - up * (1.05 - 0.55 * dr), X0 - a * 1.2, ey - up * 0.1); PLd.closePath();
        PLe.moveTo(X0 - a * 1.05, ey - up * 0.12); PLe.quadraticCurveTo(X0, ey - up * (1.02 - 0.55 * dr), X0 + a * 1.05, ey - up * 0.12);
      }
      c.fillStyle = '#cf7c78'; c.fill(PW); c.strokeStyle = DP_OUT; c.lineWidth = lw * 0.5; c.stroke(PW);
      c.fillStyle = q.eyeArea; c.fill(PLd);
      c.strokeStyle = q.eyeDark ? DP_mix(q.eyeArea, '#ffffff', 0.3) : DP_OUT; c.lineWidth = lw * (g.M ? 0.95 : 0.7); c.stroke(PLe);
    }
  }
  if (g.M && (m.sad || g.moodName === 'excited')) {   // mood brows
    var PB = new Path2D();
    for (s = -1; s <= 1; s += 2) {
      if (m.sad) { PB.moveTo(s * (ex - r * 1.2), ey - r * 2.35); PB.quadraticCurveTo(s * ex, ey - r * 2.3, s * (ex + r * 1.2), ey - r * 1.55); }
      else { PB.moveTo(s * (ex - r * 1.0), ey - r * 2.1); PB.quadraticCurveTo(s * ex, ey - r * 2.75, s * (ex + r * 1.1), ey - r * 2.2); }
    }
    c.strokeStyle = DP_lineCol(q.eyeArea); c.lineWidth = lw * 0.7; c.stroke(PB);
  }
}
function DP_nose(c, g) {
  var sp = g.sp, z = sp.mz, ny = z[3], nw = sp.nose[0], nh = sp.nose[1], lw = g.lw;
  var P = DP_shape(DP_symPts([[0, ny - nh * 0.5], [nw * 0.62, ny - nh * 0.52], [nw, ny - nh * 0.14], [nw * 0.74, ny + nh * 0.3], [nw * 0.24, ny + nh * 0.52], [0, ny + nh * 0.46]]));
  c.fillStyle = g.coat.nose || '#2b201c'; c.fill(P);
  c.strokeStyle = DP_lum(g.q.muz) < 0.26 ? '#120c0a' : DP_OUT; c.lineWidth = lw * 0.7; c.stroke(P);
  if (g.D) { var N = new Path2D(); DP_ellInto(N, -nw * 0.42, ny + nh * 0.12, nw * 0.17, nh * 0.13, 0.4); DP_ellInto(N, nw * 0.42, ny + nh * 0.12, nw * 0.17, nh * 0.13, -0.4); c.fillStyle = 'rgba(8,4,2,0.6)'; c.fill(N); }
  DP_ell(c, -nw * 0.28, ny - nh * 0.22, nw * 0.36, nh * 0.15, -0.15, 'rgba(255,255,255,' + (g.M ? 0.42 : 0.3) + ')');
}
function DP_wrinkles(c, g) {
  var sp = g.sp, q = g.q, lw = g.lw, ex = g.ex, ey = g.ey, er = g.er0, z = sp.mz, s, st = g.st, lv = sp.wrinkles, A = new Path2D(), B = new Path2D();
  if (!g.M) return;
  for (s = -1; s <= 1; s += 2) {
    if (lv >= 2) {
      DP_curve(A, [[s * 2.2, ey - er * 2.1], [s * ex * 0.55, ey - er * 2.6], [s * ex * 1.05, ey - er * 2.25]], false);
      DP_curve(A, [[s * 3.4, ey - er * 2.9], [s * ex * 0.62, ey - er * 3.35], [s * ex * 1.0, ey - er * 3.1]], false);
      DP_curve(B, [[s * 1.2, z[3] - sp.nose[1] * 1.05], [s * z[0] * 0.75, z[3] - sp.nose[1] * 1.5], [s * (z[2] * 0.95), z[3] - 1]], false);   // nose roll
    } else DP_curve(A, [[s * 2.6, ey - er * 2.2], [s * ex * 0.55, ey - er * 2.55], [s * ex * 0.95, ey - er * 2.3]], false);
  }
  if (lv >= 2) { A.moveTo(0, -st * 0.2); A.lineTo(0.3, ey - er * 1.6); }
  c.lineCap = 'round'; c.lineWidth = lw * 0.55;
  c.strokeStyle = DP_lineCol(q.skull); c.stroke(A);
  if (lv >= 2) {
    c.strokeStyle = DP_lineCol(q.muz); c.stroke(B);
    if (g.D) { var M = new Path2D(); DP_ellInto(M, -(z[2] + 3.2), z[3] + 5.5, 0.7, 0.7, 0); DP_ellInto(M, z[2] + 3.2, z[3] + 5.5, 0.7, 0.7, 0); c.fillStyle = DP_mix(q.skull, DP_OUT, 0.75); c.fill(M); }
  }
}
function DP_bow(c, x, y, s, col, lw) {
  var L = new Path2D(), D = new Path2D(), k;
  for (k = -1; k <= 1; k += 2) {
    DP_curve(L, [[x + k * 0.8 * s, y], [x + k * 5.6 * s, y - 3.6 * s], [x + k * 6.6 * s, y + 0.2 * s], [x + k * 5.4 * s, y + 3.6 * s]], true);
    D.moveTo(x + k * 1.2 * s, y - 0.3 * s); D.lineTo(x + k * 4.4 * s, y - 1.5 * s); D.lineTo(x + k * 4.4 * s, y + 1.6 * s); D.closePath();
  }
  DP_group(c, [{ p: L, fill: col }], lw);
  c.fillStyle = DP_mix(col, DP_OUT, 0.35); c.fill(D);
  DP_group(c, [{ p: DP_ellPath(x, y, 1.9 * s, 2.2 * s), fill: col }], lw);
}

/* ---------- the head ---------- */
function DP_head(c, g, opt) {
  var sp = g.sp, q = g.q, lw = g.lw, z = sp.mz, y1 = z[4], ny = z[3], mw = z[2], sw = g.sw, st = g.st, sb = g.sb, s, i;
  var rnd = DP_rng(17), P, T;
  // --- behind the head ---
  if (sp.silk) {   // yorkie: long silky fall
    var fall = [[sw * 0.5, -st + 1], [sw + 3.5, -st * 0.4], [sw + 6.6, 6], [sw + 7.6, 18], [sw + 6.8, 26.5], [sw + 4.4, 31.5, 1], [sw + 1.6, 25.5], [sw - 1.6, 30, 1], [sw - 5, 23], [sw - 8, 14], [sw - 7, 0]];
    var fc = DP_mix(q.base, q.shade, 0.25), PF = new Path2D(), PH = new Path2D(), PN = new Path2D();
    for (s = -1; s <= 1; s += 2) {
      DP_curve(PF, DP_xf(fall, s, 0, 0, 0), true);
      DP_curve(PH, DP_xf([[sw + 2.6, -st * 0.25], [sw + 5.9, 8], [sw + 6.6, 19], [sw + 5, 26], [sw + 3.4, 19], [sw + 3.1, 8]], s, 0, 0, 0), true);
      DP_curve(PN, DP_xf([[sw - 2.6, 4], [sw - 1.6, 14], [sw - 2.6, 23]], s, 0, 0, 0), false);
    }
    DP_group(c, [{ p: PF, fill: fc }], lw);
    c.fillStyle = DP_mix(q.base, q.light, 0.4); c.fill(PH);
    if (g.M) { c.strokeStyle = DP_lineCol(fc); c.lineWidth = lw * 0.5; c.stroke(PN); }
  }
  DP_ears(c, g, 'back');
  // --- skull + cheeks + jaw + muzzle: one outline ---
  var skull;
  if (sp.skullFur) skull = DP_fur(DP_ring(0, (sb - st) / 2, sw * 0.97, (st + sb) / 2 * 0.97, sp.skullFur === 'curl' ? 15 : 13, rnd, 0.4, -1.57), sp.skullFur === 'curl' ? 2.2 : 3.0, sp.skullFur);
  else skull = DP_shape(DP_symPts(DP_skullPts(g)));
  var cheeks = null, extra = null;
  if (sp.cheek) {
    var n = sp.cheek[0], len = sp.cheek[1], cy0 = sp.cheek[2];
    cheeks = new Path2D();
    for (i = 0; i < n; i++) for (s = -1; s <= 1; s += 2) DP_lockInto(cheeks, sw - 2.5 - i * (sw * 0.13), cy0 + i * (len * 0.62), 0.55 + i * 0.3, len * (1 - i * 0.12), len * 0.5, 0.1, s < 0);
  }
  var jawP = DP_shape(DP_symPts(DP_jawPts(g)));
  var muzP = sp.mzFur ? DP_fur(DP_ring(0, (z[1] + y1) / 2, mw + 1.4, (y1 - z[1]) / 2 + 0.2, 9, DP_rng(21), 0.3, -1.57), 2.0, 'tuft') : DP_shape(DP_symPts(DP_muzPts(g)));
  if (sp.silk) {   // moustache falls
    extra = new Path2D();
    for (s = -1; s <= 1; s += 2) DP_curve(extra, DP_xf([[mw * 0.3, ny + 2.5], [mw * 0.95, ny + 0.8], [mw + 3.2, y1 - 1], [mw + 3.8, y1 + 6], [mw + 1.4, y1 + 12, 1], [mw * 0.62, y1 + 6.5], [mw * 0.36, y1 + 1]], s, 0, 0, 0), true);
  }
  var flewP = null;
  if (sp.flews) {   // hanging upper lips (Boxer, Great Dane, Basset, Bulldog)
    var fl = sp.flews, opn = g.openU;
    flewP = new Path2D();
    for (s = -1; s <= 1; s += 2) DP_curve(flewP, DP_xf([[mw * 0.5, y1 - 2.5], [mw * 0.96, ny + (y1 - ny) * 0.3], [mw + 1.3 * fl, y1 + 0.3], [mw + 0.7 * fl, y1 + 3 * fl + opn * 0.45],
                                                        [mw * 0.74, y1 + 4 * fl + opn * 0.55], [mw * 0.42, y1 + 1.6 + opn * 0.35]], s, 0, 0, 0), true);
  }
  var all = new Path2D();
  if (flewP) all.addPath(flewP);
  all.addPath(skull); if (cheeks) all.addPath(cheeks); all.addPath(jawP); all.addPath(muzP); if (extra) all.addPath(extra);
  c.strokeStyle = DP_OUT; c.lineWidth = lw * 2; c.lineJoin = 'round'; c.lineCap = 'round';
  c.stroke(all);
  if (cheeks) DP_fillRim(c, cheeks, q.cheek, lw);
  DP_fillRim(c, skull, q.skull, lw);
  c.save(); c.clip(skull);
  DP_paintSkull(c, g);
  DP_shadeOut(c, -sw * 0.14, (sb - st) / 2 - 2.5, sw * 1.04, (st + sb) / 2 * 1.04, q.shadeCol);
  if (g.M) {
    DP_ell(c, -sw * 0.42, -st * 0.62, sw * 0.26, st * 0.12, -0.5, q.hiCol);
    if (cheeks || (g.D && sp.fur === 'fluffy')) {   // a few fur strokes where the cheek fluff joins the face, wisps on the crown
      T = g.D ? [[-2.8, -st * 0.86, 1.15, 3.4], [2.2, -st * 0.88, 1.95, 3.4]] : [];
      if (cheeks)
      for (s = -1; s <= 1; s += 2) for (i = 0; i < 2; i++) T.push([s * (sw - 5.5 - i * 2.5), sp.cheek[2] - 1 + i * 4.5, s > 0 ? 1.0 : 2.14, 3.6]);
      DP_ticks(c, T, DP_lineCol(q.cheek), lw * 0.5);
    }
  }
  c.restore();
  // lower jaw, mouth, tongue
  DP_fillRim(c, jawP, q.jaw, lw);
  if (g.openU > 0.6) {
    c.fillStyle = '#6f2730'; c.fill(DP_shape(DP_symPts(DP_mouthPts(g))));
    var tpts = DP_tonguePts(g), tb = y1 + g.openU + (g.tongue - 0.7) * 3.4, tw = tpts[2][0];
    P = DP_shape(DP_symPts(tpts));
    c.fillStyle = '#f08d9c'; c.fill(P);
    if (g.M) { P.moveTo(0, y1 + 0.5); P.lineTo(0, tb - 2.2); }
    c.strokeStyle = '#8a3346'; c.lineWidth = lw * 0.6; c.stroke(P);
  }
  if (flewP) {
    DP_fillRim(c, flewP, q.muz, lw);
    if (g.M) {
      P = new Path2D();
      for (s = -1; s <= 1; s += 2) DP_curve(P, [[s * mw * 0.62, y1 + 1.2 + g.openU * 0.3], [s * (mw * 0.9), y1 + 2.2 * sp.flews + g.openU * 0.4], [s * (mw + 0.6 * sp.flews), y1 + 1.4 * sp.flews]], false);
      c.strokeStyle = DP_lineCol(q.muz); c.lineWidth = lw * 0.5; c.stroke(P);
    }
  }
  // muzzle on top
  DP_fillRim(c, muzP, q.muz, lw);
  if (extra) { c.fillStyle = q.muz; c.fill(extra); }
  if (DP_muzNeedsPaint(q.pat)) { c.save(); c.clip(muzP); DP_paintMuz(c, g); c.restore(); }
  var mp = DP_muzPts(g), hgt = y1 - ny, dk = DP_lum(q.muz) < 0.26;
  if (!sp.beard && !sp.mzFur && g.M) {   // soft shadow along the underside of the pads
    c.fillStyle = dk ? 'rgba(0,0,0,0.25)' : 'rgba(74,42,20,0.13)';
    c.fill(DP_shape(DP_symPts([[0, y1 - hgt * 0.2 - 0.2], [mw * 0.47, y1 - 0.4], [mw * 0.85, y1 - hgt * 0.2 - 0.2], [mw * 0.93, ny + hgt * 0.34], [mw * 0.6, y1 - hgt * 0.36], [0, y1 - hgt * 0.52]])));
  }
  // lip line, philtrum, mouth corners in one stroke
  P = DP_line(DP_lipPts(g));
  P.moveTo(0, ny + sp.nose[1] * 0.46); P.lineTo(0, y1 - hgt * 0.2);
  if (g.m.smile < 0 && !sp.beard) for (s = -1; s <= 1; s += 2) { P.moveTo(s * mw * 0.98, y1 - hgt * 0.3); P.quadraticCurveTo(s * (mw + 1.4), y1 - hgt * 0.1, s * (mw + 1.6), y1 + 1.6); }
  c.strokeStyle = dk ? '#120c0a' : DP_OUT; c.lineWidth = lw * 0.72; c.stroke(P);
  if (g.M && !sp.beard && !sp.mzFur) {
    P = new Path2D();
    for (s = -1; s <= 1; s += 2) DP_curve(P, [[s * mp[2][0], mp[2][1]], [s * mp[3][0], mp[3][1]], [s * mp[4][0], mp[4][1]]], false);
    c.strokeStyle = dk ? 'rgba(255,255,255,0.16)' : DP_rgba(DP_mix(q.muz, DP_OUT, 0.55), 0.55); c.lineWidth = lw * 0.5; c.stroke(P);
  }
  if (g.D) {
    P = new Path2D();
    for (s = -1; s <= 1; s += 2) for (i = 0; i < 3; i++) DP_ellInto(P, s * (mw * (0.42 + i * 0.19)), ny + hgt * (0.5 + (i === 1 ? 0.16 : 0)), 0.42, 0.42, 0);
    c.fillStyle = DP_lineCol(q.muz); c.fill(P);
  }
  if (sp.beard && g.M) {   // beard strands
    P = new Path2D();
    P.moveTo(-3, y1 + 5 + g.openU); P.lineTo(-3.6, y1 + 10 + g.openU * 0.5); P.moveTo(3.2, y1 + 5.5 + g.openU); P.lineTo(3.8, y1 + 10 + g.openU * 0.5);
    for (s = -1; s <= 1; s += 2) DP_curve(P, [[s * mw * 0.6, ny + 1], [s * mw * 0.95, ny + 5], [s * (mw + 1.2), y1 - 0.5]], false);
    c.strokeStyle = DP_lineCol(q.jaw); c.lineWidth = lw * 0.5; c.stroke(P);
  }
  if (sp.underbite) {   // lower canines peeking up over the lip
    var ub = sp.underbite, yT = y1 + (g.openU > 0.6 ? g.openU - 0.2 : 2.4), tx0 = sp.jaw[0] * 0.66;
    P = new Path2D();
    for (s = -1; s <= 1; s += 2) { P.moveTo(s * (tx0 - 1.5 * ub), yT); P.quadraticCurveTo(s * (tx0 - 0.2), yT - 2.2 * ub, s * (tx0 + 0.5 * ub), yT - 3.4 * ub); P.quadraticCurveTo(s * (tx0 + 1.1 * ub), yT - 1.2 * ub, s * (tx0 + 1.3 * ub), yT); P.closePath(); }
    c.fillStyle = '#fffaf0'; c.fill(P);
    c.strokeStyle = DP_OUT; c.lineWidth = lw * 0.55; c.stroke(P);
  }
  if (sp.wrinkles) DP_wrinkles(c, g);
  // --- ears that hang in front ---
  DP_ears(c, g, 'front');
  // --- top-knots that sit behind the eyes line ---
  var top = sp.top;
  if (top && top.type === 'pompom') {
    DP_group(c, [{ p: DP_fur(DP_ring(0, top.cy, top.rx, top.ry, top.n, DP_rng(9), 0.35, -1.57), 2.9, 'curl'), fill: q.top, paint: function (c) {
      DP_shadeOut(c, -top.rx * 0.22, top.cy - top.ry * 0.28, top.rx * 1.08, top.ry * 1.1, DP_shadeFor(q.top));
      if (g.M) DP_ell(c, -top.rx * 0.4, top.cy - top.ry * 0.45, top.rx * 0.3, top.ry * 0.2, -0.4, q.hiCol);
    } }], lw);
    if (g.M) { var r2 = DP_rng(12); T = DP_scatter(r2, 8, -top.rx * 0.68, top.cy - top.ry * 0.55, top.rx * 0.68, top.cy + top.ry * 0.6, 6.4).map(function (p) { return [p[0], p[1], 1.7 + r2() * 0.8, r2() * 6]; }); DP_curlMarks(c, T, DP_lineCol(q.top), lw * 0.5); }
  }
  if (top && top.type === 'curls') {
    DP_group(c, [{ p: DP_fur(DP_ring(0, -st * 0.86, sw * 0.7, 8, 8, DP_rng(9), 0.35, -1.57), 2.5, 'curl'), fill: q.top, paint: g.D ? function (c) {
      DP_shadeOut(c, -4, -st * 0.86 - 3, sw * 0.78, 9.5, DP_shadeFor(q.top));
    } : null }], lw);
    if (g.M) { T = []; var r3 = DP_rng(14); for (i = 0; i < 5; i++) T.push([(i - 2) * 5.2 + r3(), -st * 0.86 + (r3() - 0.5) * 6, 1.7 + r3() * 0.6, r3() * 6]); DP_curlMarks(c, T, DP_lineCol(q.top), lw * 0.5); }
  }
  DP_eyes(c, g);
  DP_nose(c, g);
  // --- things that overlap the eyes ---
  if (sp.brows) {
    var er = g.er0;
    P = new Path2D();
    var bring = DP_ring(g.ex + er * 0.15, g.ey - er * 2.15, er * 2.05, er * 0.82, 6, DP_rng(51), 0.2, -2.7);
    for (s = -1; s <= 1; s += 2) DP_fur(DP_xf(bring, s, g.ex, g.ey - er * 2.15, 0.16), er * 0.62, 'tuft', null, 0, P);
    DP_group(c, [{ p: P, fill: q.pat === 'schnauzer' ? q.light : DP_mix(q.base, q.light, 0.6) }], lw * 0.8);
  }
  if (top && top.type === 'fringe') {
    var fcol = DP_mix(q.base, q.light, 0.45), tipY = g.ey - g.er0 * (top.cover ? -0.15 : 1.9), mcy = -st * (top.cover ? 0.6 : 0.74), mry = (tipY - mcy) - 2.6;
    if (q.pat === 'parti-white' || q.pat === 'blenheim') fcol = q.base;
    DP_group(c, [{ p: DP_fur(DP_ring(0, mcy, sw * (top.cover ? 0.8 : 0.56), mry, top.cover ? 11 : 8, DP_rng(33), 0.3, -1.57), top.curl ? 2.4 : 3.0, top.curl ? 'curl' : 'tuft'), fill: fcol }], lw * 0.9);
    if (g.M && top.curl) DP_curlMarks(c, [[-6, mcy - 1, 1.8, 1], [1, mcy - 3, 1.7, 3], [6.5, mcy, 1.8, 5], [-1, mcy + 3, 1.6, 2]], DP_lineCol(fcol), lw * 0.5);
    else if (g.M) DP_ticks(c, top.cover ? [[-12, mcy, 1.9, 5], [-5, mcy - 2, 1.7, 5.5], [1, mcy - 1, 1.5, 6], [7, mcy - 2, 1.3, 5.5], [13, mcy, 1.2, 5]]
                                     : [[-6, mcy - 1, 1.9, 4], [0.5, mcy - 2, 1.5, 4.5], [6, mcy - 0.5, 1.2, 4]], DP_lineCol(fcol), lw * 0.5);
  }
  if (sp.silk) {   // top-knot + bow
    var K1 = new Path2D(), K2 = new Path2D();
    DP_lockInto(K1, 2.2, -st + 1, -Math.PI / 2 + 0.62, 12, 3.4, 0.12, false); DP_lockInto(K1, 2.2, -st + 1, -Math.PI / 2 + 0.62, 12, 3.4, 0.12, true);
    DP_lockInto(K2, 0, -st + 1, -Math.PI / 2, 13.5, 3.6, 0, false);
    DP_group(c, [{ p: K1, fill: DP_mix(q.base, q.light, 0.35) }, { p: K2, fill: DP_mix(q.base, q.light, 0.55) }], lw * 0.85);
    if (g.M) { P = new Path2D(); for (s = -1; s <= 1; s += 2) DP_curve(P, [[s * 1.5, -st + 3], [s * 6, -st * 0.6], [s * sw * 0.62, -st * 0.1]], false); c.strokeStyle = DP_lineCol(q.skull); c.lineWidth = lw * 0.5; c.stroke(P); }
    DP_bow(c, 0, -st + 1.5, 1.15, (opt && typeof opt.collar === 'string' && opt.collar) || '#d9574a', lw * 0.85);
  }
}

/* ---------- bust, background, whole portrait ---------- */
function DP_bgPath(bg) {
  var p = new Path2D();
  if (bg === 'badge') { p.arc(50, 52, 46.5, 0, DP_TAU); }
  else { var x = 2.5, y = 2.5, w = 95, h = 95, r = 13; p.moveTo(x + r, y); p.arcTo(x + w, y, x + w, y + h, r); p.arcTo(x + w, y + h, x, y + h, r); p.arcTo(x, y + h, x, y, r); p.arcTo(x, y, x + w, y, r); p.closePath(); }
  return p;
}
function DP_bg(c, bg, b, opt, S) {
  var p = DP_bgPath(bg), u = 100 / S;
  if (bg === 'badge') {
    var col = opt.bgColor || DP_BADGES[((b && b.index) || 0) % DP_BADGES.length];
    c.fillStyle = DP_mix(col, DP_OUT, 0.28); c.beginPath(); c.arc(50, 53.2, 46.5, 0, DP_TAU); c.fill();
    c.fillStyle = col; c.fill(p);
    c.save(); c.clip(p);
    DP_ell(c, 50, 40, 40, 34, 0, DP_mix(col, '#ffffff', 0.32));
    c.strokeStyle = DP_mix(col, '#ffffff', 0.55); c.lineWidth = Math.max(1.6, 1.2 * u); c.beginPath(); c.arc(50, 52, 43.6, 0, DP_TAU); c.stroke();
    c.restore();
    c.strokeStyle = DP_mix(col, DP_OUT, 0.45); c.lineWidth = Math.max(0.9, 0.9 * u); c.stroke(p);
  } else {
    var gr = c.createRadialGradient(50, 44, 8, 50, 50, 68);
    gr.addColorStop(0, '#fff9e9'); gr.addColorStop(0.6, '#fbf1d8'); gr.addColorStop(1, '#eed9ae');
    c.fillStyle = gr; c.fill(p);
    c.strokeStyle = '#d6bc8a'; c.lineWidth = Math.max(1, 1.0 * u); c.stroke(p);
  }
}
function DP_bust(c, g, opt, clipped, ruffOnly) {
  var sp = g.sp, q = g.q, hs = sp.hs;
  if (!ruffOnly) DP_chest(c, g, opt, clipped);
  if (sp.ruff) {
    var r = sp.ruff;
    c.save(); c.translate(0, g.hyBox); c.scale(hs, hs);
    var rp = DP_fur(DP_ring(0, r.cy, r.rx, r.ry, r.n, DP_rng(3), r.jit || 0.3, -1.5), r.curl ? r.d * 0.8 : r.d, r.curl ? 'curl' : 'tuft');
    DP_group(c, [{ p: rp, fill: q.ruff, paint: function (c) {
      DP_paintRuff(c, g, r);
      if (g.M) {
        var m = [], r2 = DP_rng(29), i, a, lc = DP_lineCol(DP_lum(q.ruff) > 0.8 ? DP_mix(q.ruff, '#b9a58a', 0.5) : q.ruff);
        for (i = 0; i < 12; i++) { a = (i + r2() * 0.6) / 12 * DP_TAU; if (Math.sin(a) < -0.55) continue; m.push([Math.cos(a) * r.rx * 0.78, r.cy + Math.sin(a) * r.ry * 0.78, Math.atan2(Math.sin(a) + 0.5, Math.cos(a) * 0.6), 4.2]); }
        if (r.curl) DP_curlMarks(c, m.map(function (k, j) { return [k[0], k[1], 1.8 + (j % 3) * 0.3, j * 1.7]; }), lc, g.lw * 0.5);
        else DP_ticks(c, m, lc, g.lw * 0.5);
      }
    } }], g.lw);
    c.restore();
  }
}
function DP_collarY(g) { return g.hyBox + (g.sp.mz[4] + g.sp.jaw[1] * 0.5 + 6.5) * g.sp.hs; }
function DP_chest(c, g, opt, clipped) {
  var sp = g.sp, q = g.q, lw = g.lwBox, nw = sp.neck[0], sh = sp.neck[1], hs = sp.hs, yTop = g.hyBox + 5 * hs, P, R;
  var fur = sp.fur, col = opt.collar, hasCollar = col && typeof col === 'string' && !(sp.ruff && sp.ruff.big);
  R = [[0, yTop - 4, 0], [nw * 0.95, yTop], [nw * 1.04, yTop + 9], [nw + (sh - nw) * 0.45, 77], [sh * 0.93, 84.5]];
  if (clipped) R.push([sh * 1.02, 93], [sh * 1.04, 116, 0], [0, 116, 0]);
  else if (fur === 'smooth') R.push([sh, 91], [sh * 0.82, 96.8], [sh * 0.43, 98.8], [0, 99.2]);
  else R.push([sh * 0.99, 90], [sh * 0.8, 94.8], [sh * 0.42, 96.4], [0, 96.6]);
  if (fur === 'smooth') P = DP_sym(R);
  else P = DP_fur(DP_symPts(R), fur === 'curly' ? 2.3 : fur === 'shaggy' ? 3.1 : fur === 'wire' ? 1.7 : 2.7, fur === 'curly' ? 'curl' : 'tuft');
  DP_group(c, [{ p: P, fill: q.chest, paint: function (c) {
    DP_paintChest(c, g, yTop);
    if (g.M && fur === 'smooth') {
      DP_ticks(c, [[-2.6, 85.5, 1.25, 4.2], [2.4, 86.5, 1.9, 4.2], [-0.4, 90.5, 1.5, 3.6], [-sh * 0.6, 88.5, 1.25, 8], [sh * 0.6, 88.5, 1.9, 8]], DP_rgba(DP_lineCol(q.chest), 0.7), lw * 0.5);
    }
    if (g.M && fur !== 'smooth') {
      var lc = DP_lineCol(DP_lum(q.chest) > 0.8 ? DP_mix(q.chest, '#b9a58a', 0.5) : q.chest), m = [], r2 = DP_rng(23), i;
      if (fur === 'curly') { m = DP_scatter(r2, 8, -sh * 0.75, 79, sh * 0.75, 96, 6.6).map(function (p) { return [p[0], p[1], 1.8 + r2() * 0.8, r2() * 6]; }); DP_curlMarks(c, m, lc, lw * 0.5); }
      else { for (i = 0; i < 7; i++) { var fx = (i - 3) * sh * 0.24 + (r2() - 0.5) * 3; m.push([fx, 83 + r2() * 10 - Math.abs(i - 3) * 1.2, 1.57 + fx * 0.012, 4.2]); } DP_ticks(c, m, lc, lw * 0.5); }
    }
    if (hasCollar) {
      var yc = DP_collarY(g), x0 = nw + 9;
      var band = new Path2D(); band.moveTo(-x0, yc - 4.2); band.quadraticCurveTo(0, yc + 7.4, x0, yc - 4.2);
      c.lineCap = 'butt';
      c.strokeStyle = DP_OUT; c.lineWidth = 5 + lw * 1.5; c.stroke(band);
      c.strokeStyle = col; c.lineWidth = 5; c.stroke(band);
      var hi = new Path2D(); hi.moveTo(-x0, yc - 5.4); hi.quadraticCurveTo(0, yc + 6.2, x0, yc - 5.4);
      c.strokeStyle = 'rgba(255,255,255,0.35)'; c.lineWidth = 1.1; c.stroke(hi);
      c.lineCap = 'round';
    }
  } }], lw);
  if (hasCollar) {   // name tag
    var ty = DP_collarY(g) + 6.6;
    DP_group(c, [{ p: DP_ellPath(0, ty, 3.1, 3.3), fill: '#f2c14e' }], lw * 0.8);
    DP_ell(c, -0.8, ty - 0.9, 1.1, 0.9, 0, 'rgba(255,255,255,0.6)');
  }
}
function DP_renderBust(c, L, g, opt, faceOnly, skipBg) {
  var bg = (opt.bg === 'badge' || opt.bg === 'card') ? opt.bg : null;
  c.lineJoin = 'round'; c.lineCap = 'round';
  if (faceOnly) {
    if (L.sp.ruff && L.sp.ruff.big) { c.save(); c.translate(50, 0); DP_bust(c, g, opt, false, true); c.restore(); }
    return;
  }
  if (bg && !skipBg) DP_bg(c, bg, L.b, opt, g.S);
  c.save();
  if (bg) { var cp = DP_bgPath(bg); if (bg === 'badge') cp.rect(-10, -10, 120, 62); c.clip(cp); }
  c.translate(50, 0);
  DP_bust(c, g, opt, !!bg, false);
  c.restore();
}
function DP_renderHead(c, g, opt, posed) {
  c.lineJoin = 'round'; c.lineCap = 'round';
  c.save();
  c.translate(50, g.hyBox + (posed ? g.bob : 0)); if (posed) c.rotate(g.tilt); c.scale(g.sp.hs, g.sp.hs);
  DP_head(c, g, opt);
  c.restore();
}
function DP_render(c, L, S, opt, faceOnly, skipBg, pose, px) {
  var g = DP_geom(L.sp, L.coat, opt, S, pose, px);
  DP_renderBust(c, L, g, opt, faceOnly, skipBg);
  DP_renderHead(c, g, opt, true);
}

/* ---------- bitmap cache + public API ----------
   Canvas here is rasterised in software: a live vector portrait costs milliseconds, a 1:1 blit costs microseconds.
   So every draw is served from cached bitmaps baked at exactly the device scale and blitted on whole device pixels:
   one "bust" bitmap (background, chest, ruff) + one "head" bitmap per animation frame.                                  */
var DP_PAD = 8;
var DP_sprites = new Map(), DP_spritePx = 0, DP_SPRITE_MAX = 900, DP_SPRITE_MAXPX = 12e6;   // LRU, <= ~48 MB
var DP_last = new Map();            // logical key -> last bitmap drawn for it (fallback while a new one is pending)
var DP_bakeT0 = 0, DP_bakeSpent = 0, DP_BAKE_BUDGET = 3.5, DP_REBAKE_DELAY = 150;
var DP_urls = {};
function DP_now() { return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(); }
function DP_canvas(w, h) {
  var cv = null;
  if (typeof document !== 'undefined' && document.createElement) { cv = document.createElement('canvas'); cv.width = w; cv.height = h; }
  else if (typeof OffscreenCanvas !== 'undefined') cv = new OffscreenCanvas(w, h);
  return cv;
}
function DP_lookup(breedId, coatIndex) {
  var b = (typeof BREED_BY_ID !== 'undefined' && BREED_BY_ID) ? BREED_BY_ID[breedId] : null;
  if (!b && typeof BREEDS !== 'undefined' && BREEDS && BREEDS.length) b = BREEDS[0];
  var coats = (b && b.coats && b.coats.length) ? b.coats : [{ name: 'Tan', base: '#c9935a', shade: '#a8743f', light: '#ecd2a4', pattern: 'solid' }];
  var ci = Math.floor(+coatIndex) || 0;
  ci = ((ci % coats.length) + coats.length) % coats.length;
  var sp = DP_SPECS[b ? b.id : ''] || DP_SPECS.mutt || DP_SPECS.lab;
  return { b: b, coat: coats[ci] || coats[0], ci: ci, sp: sp, id: b ? b.id : 'lab' };
}
// draws the whole 100-unit box (already transformed) as vectors - plain or as a silhouette. kpx = device pixels per box unit
function DP_paint(c, L, S, opt, faceOnly, kpx) {
  if (!opt.silhouette) { DP_render(c, L, S, opt, faceOnly, false, null, kpx * 100); return; }
  var bg = (opt.bg === 'badge' || opt.bg === 'card') ? opt.bg : null;
  if (bg && !faceOnly) DP_bg(c, bg, L.b, opt, S);
  var dim = Math.max(8, Math.ceil((100 + 2 * DP_PAD) * kpx)), tmp = DP_canvas(dim, dim);
  if (tmp) {
    var x = tmp.getContext('2d');
    x.scale(kpx, kpx); x.translate(DP_PAD, DP_PAD);
    DP_render(x, L, S, { mood: 'neutral', bg: opt.bg }, faceOnly, true, null, 40);   // low detail: only the outline shape matters
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.globalCompositeOperation = 'source-in';
    x.fillStyle = DP_SILCOL; x.fillRect(0, 0, dim, dim);
    c.save();
    c.imageSmoothingEnabled = true;
    c.drawImage(tmp, -DP_PAD, -DP_PAD, dim / kpx, dim / kpx);
    c.restore();
  }
  // a chunky pixel-font "?" drawn as shapes (no dependency on a web font having loaded)
  var hy = faceOnly ? L.sp.hy : Math.min(L.sp.hy + 4, 56), u = faceOnly ? 2.7 * L.sp.hs : 3, rows = ['.####.', '##..##', '....##', '...##.', '..##..', '......', '..##..', '..##..'];
  var Q = new Path2D(), r, i2;
  for (r = 0; r < 8; r++) for (i2 = 0; i2 < 6; i2++) if (rows[r].charAt(i2) === '#') Q.rect(50 + (i2 - 3) * u, hy + (r - 4) * u, u * 1.04, u * 1.04);
  c.save();
  c.translate(u * 0.28, u * 0.45); c.fillStyle = 'rgba(40,26,12,0.38)'; c.fill(Q);
  c.translate(-u * 0.28, -u * 0.45); c.fillStyle = '#fbf1d8'; c.fill(Q);
  c.restore();
}
// A baked bitmap: { cv, kpx (device px per box unit), pad (px around the box) }.
// lkey = what the picture is; kpx = the resolution wanted; fam = family key for "show a neighbouring frame meanwhile".
function DP_bitmap(lkey, fam, kpx, painter) {
  var rk = Math.round(kpx * 2000), key = lkey + '@' + rk, sp = DP_sprites.get(key), now, fb;
  if (sp) { DP_sprites.delete(key); DP_sprites.set(key, sp); DP_last.set(lkey, sp); if (fam) DP_last.set(fam, sp); return sp; }
  now = DP_now();
  if (now - DP_bakeT0 > 14) { DP_bakeT0 = now; DP_bakeSpent = 0; }
  fb = DP_last.get(lkey);
  if (fb) {   // same picture baked at another scale: stretch it while the scale keeps changing (camera zoom), re-bake at most every DP_REBAKE_DELAY ms
    if (now - fb.t < DP_REBAKE_DELAY || DP_bakeSpent > DP_BAKE_BUDGET) return fb;
  } else if (fam && DP_bakeSpent > DP_BAKE_BUDGET) {
    fb = DP_last.get(fam);   // another frame of the same dog
    if (fb) return fb;
  }
  var pad = Math.ceil(DP_PAD * kpx), dim = Math.ceil(100 * kpx) + 2 * pad, cv = DP_canvas(dim, dim);
  if (!cv) return null;
  var x = cv.getContext('2d');
  x.translate(pad, pad); x.scale(kpx, kpx);
  painter(x);
  sp = { cv: cv, kpx: kpx, pad: pad, lkey: lkey, fam: fam, t: now };
  DP_sprites.set(key, sp); DP_spritePx += dim * dim;
  DP_last.set(lkey, sp); if (fam) DP_last.set(fam, sp);
  while (DP_sprites.size > DP_SPRITE_MAX || (DP_spritePx > DP_SPRITE_MAXPX && DP_sprites.size > 2)) {
    var first = DP_sprites.keys().next().value, old = DP_sprites.get(first);
    DP_spritePx -= old.cv.width * old.cv.height; DP_sprites.delete(first);
    if (DP_last.get(old.lkey) === old) DP_last.delete(old.lkey);
    if (old.fam && DP_last.get(old.fam) === old) DP_last.delete(old.fam);
  }
  DP_bakeSpent += DP_now() - now;
  return sp;
}
// blit a baked bitmap so that box point (0,0) lands on (x, y); offY = extra vertical offset in box units
function DP_blit(c, sp, m, aligned, x, y, k, offY) {
  if (aligned) {
    var kpx = k * m.a;
    if (Math.abs(sp.kpx - kpx) < 1e-6) {
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.drawImage(sp.cv, Math.round(m.a * x + m.e) - sp.pad, Math.round(m.d * y + m.f + offY * kpx) - sp.pad);
      c.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
      return;
    }
  }
  var u = k / sp.kpx;   // caller units per bitmap pixel
  c.drawImage(sp.cv, x - sp.pad * u, y + offY * k - sp.pad * u, sp.cv.width * u, sp.cv.height * u);
}
function DP_draw(c, breedId, coatIndex, x, y, size, opt, faceOnly) {
  if (!c || !(size > 0) || !isFinite(x) || !isFinite(y)) return;
  var sm0 = c.imageSmoothingEnabled;
  if (sm0 === false) c.imageSmoothingEnabled = true;
  DP_drawInner(c, breedId, coatIndex, x, y, size, opt || {}, faceOnly);
  if (sm0 === false) c.imageSmoothingEnabled = false;
}
function DP_drawInner(c, breedId, coatIndex, x, y, size, opt, faceOnly) {
  var depth = 0;
  try {
    var L = DP_lookup(breedId, coatIndex), sp = L.sp, m = c.getTransform ? c.getTransform() : { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
    var aligned = m.b === 0 && m.c === 0 && m.a > 0 && Math.abs(m.a - m.d) < 1e-9;
    var scale = aligned ? m.a : (Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) || 1), k = size / 100, kpx = k * scale;
    if (!opt.noCache && kpx <= 14 && kpx > 0.02) {
      var col = typeof opt.collar === 'string' ? opt.collar : '';
      var base = L.id + '|' + L.ci + '|' + Math.round(size * 8) + '|' + (faceOnly ? 'F' : (opt.bg || '') + '|' + (opt.bgColor || '')) + '|' + col + '|', A, B = null;
      if (opt.silhouette) {
        A = DP_bitmap('S' + base, null, kpx, function (x2) { DP_paint(x2, L, size, opt, faceOnly, kpx); });
        if (A) { DP_blit(c, A, m, aligned, x, y, k, 0); return; }
      } else {
        var pose = DP_pose(sp, opt), g = null, pat = L.coat.pattern, needBust = !faceOnly || !!(sp.ruff && sp.ruff.big);
        // the seed only changes the picture through the tilt side, except for coats with random markings (16 layouts)
        var seedKey = pose.hasSeed ? ((pat === 'spots' || pat === 'brindle' || pat === 'merle' || pat === 'harlequin' || pat === 'boxer' || pat === 'boston') ? pose.seed : (pose.seed & 1)) : '';
        if (pose.t === null) {   // a still: one bitmap, one blit
          A = DP_bitmap('P' + base + seedKey + '|' + pose.moodName, null, kpx, function (x2) { DP_render(x2, L, size, opt, faceOnly, false, pose, kpx * 100); });
          if (A) { DP_blit(c, A, m, aligned, x, y, k, 0); return; }
        }
        if (needBust) B = DP_bitmap('B' + base + (pose.moodName === 'sad' ? 's' : '') + '|' + seedKey, null, kpx, function (x2) {
          g = g || DP_geom(sp, L.coat, opt, size, pose, kpx * 100); DP_renderBust(x2, L, g, opt, faceOnly, false);
        });
        A = DP_bitmap('H' + base + seedKey + '|' + pose.key, 'H' + base + seedKey, kpx, function (x2) {
          g = g || DP_geom(sp, L.coat, opt, size, pose, kpx * 100); g.bob = 0; DP_renderHead(x2, g, opt, true);
        });
        if (A && (B || !needBust)) {
          if (B) DP_blit(c, B, m, aligned, x, y, k, 0);
          DP_blit(c, A, m, aligned, x, y, k, pose.bob);
          return;
        }
      }
    }
    c.save(); depth++;
    c.translate(x, y); c.scale(k, k);
    DP_paint(c, L, size, opt, faceOnly, kpx);
    c.restore(); depth--;
  } catch (err) {
    while (depth-- > 0) c.restore();
    if (typeof console !== 'undefined' && !DP_draw.warned) { DP_draw.warned = true; console.warn('dogportrait: draw failed', err); }
  }
}
function drawDogPortrait(c, breedId, coatIndex, x, y, size, opt) {
  DP_draw(c, breedId, coatIndex, x, y, size, opt, false);
}
function drawDogFace(c, breedId, coatIndex, x, y, r, opt) {
  if (!(r > 0)) return;
  var sp = DP_lookup(breedId, coatIndex).sp, big = sp.ruff && sp.ruff.big;
  var k = big ? r * 1.3 / (sp.ruff.rx * sp.hs) : r / (sp.sk[0] * sp.hs);
  var cy = sp.hy + (big ? sp.ruff.cy : (sp.sk[2] - sp.sk[1]) / 2) * sp.hs;   // middle of the head in box units
  DP_draw(c, breedId, coatIndex, x - 50 * k, y - cy * k, 100 * k, opt, true);
}
function dogPortraitURL(breedId, coatIndex, size, opt) {
  opt = opt || {};
  size = Math.max(8, Math.min(1024, Math.round(+size) || 64));
  var L = DP_lookup(breedId, coatIndex);
  var key = L.id + '|' + L.ci + '|' + size + '|' + (DP_MOODS[opt.mood] ? opt.mood : 'happy') + '|' + (opt.bg || '') + '|' + (opt.bgColor || '') + '|' + (opt.silhouette ? 1 : 0) + '|' +
            (opt.collar || '') + '|' + (typeof opt.seed === 'number' ? opt.seed : '') + '|' + (typeof opt.t === 'number' ? DP_pose(L.sp, opt).key : '') + '|' + (opt.scale || '');
  if (DP_urls[key]) return DP_urls[key];
  var url = '';
  try {
    // 2x for crisp scaling; big portraits are capped (software raster + PNG encoding must stay around 10 ms) unless opt.scale says otherwise
    var dpr = (typeof devicePixelRatio === 'number' && devicePixelRatio > 0) ? devicePixelRatio : 1;
    var f = (typeof opt.scale === 'number' && opt.scale > 0) ? Math.min(4, opt.scale) : (size <= 130 ? 2 : Math.max(Math.min(2, dpr), 260 / size));
    var dim = Math.round(size * f), cv = DP_canvas(dim, dim);
    if (cv && cv.toDataURL) {
      var x = cv.getContext('2d');
      x.scale(dim / 100, dim / 100);
      DP_paint(x, L, size, opt, false, dim / 100);
      url = cv.toDataURL('image/png');
    }
  } catch (err) { url = ''; }
  if (url) DP_urls[key] = url;
  return url;
}
// Optional: build portrait URLs a few at a time while the game is idle, so opening the glossary never hitches.
// jobs = [[breedId, coatIndex, size, opt], ...]; done() is called when all are cached.
function dogPortraitWarm(jobs, done) {
  var i = 0, list = (jobs || []).slice();
  function step() {
    var t0 = DP_now();
    while (i < list.length && DP_now() - t0 < 6) { var j = list[i++]; if (j) dogPortraitURL(j[0], j[1], j[2], j[3]); }
    if (i < list.length) setTimeout(step, 30); else if (typeof done === 'function') done();
  }
  if (typeof setTimeout === 'function') setTimeout(step, 0);
}
