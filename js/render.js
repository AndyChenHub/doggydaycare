'use strict';
var canvas = document.getElementById('game'), ctx = canvas.getContext('2d', { alpha: false });
var HEAD_FONT = '"Jersey 25","Trebuchet MS",sans-serif', BODY_FONT = 'Nunito,"Trebuchet MS","Segoe UI",sans-serif';
var EMOJI_FONT = '"Noto Color Emoji","Apple Color Emoji","Segoe UI Emoji",sans-serif';
var VIEW = { w: 1280, h: 720, dpr: 1 };
var CAM = { x: PLAYER_START[0] * TILE, y: PLAYER_START[1] * TILE, zoom: 1.4, panX: 0, panY: 0, ready: false };
var GROUND_SCALE = 1.5, groundCanvas = null, groundStamp = 0, worldProps = [], shopProps = null;
var CAMM = { a: 1, e: 0, f: 0 };                 // device-space camera matrix of the current frame
var GCH = { a: 0, stamp: -1, size: 512, map: {} }; // ground chunks baked at the exact device scale
var ENV = { night: 0, wind: 0 };
var OUTLINE = '#3b2a20';

function rr(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
function ell(c, x, y, rx, ry) { c.beginPath(); c.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), 0, 0, Math.PI * 2); }
// emoji are rasterised once per size and scale, then blitted (drawing text every frame is slow without a GPU)
var emojiCache = {};
function emoji(c, ch, x, y, size) {
  var m = c.getTransform();
  if (Math.abs(m.b) > 1e-6 || Math.abs(m.c) > 1e-6 || Math.abs(m.a - m.d) > 1e-6) { c.font = size + 'px ' + EMOJI_FONT; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(ch, x, y); return; }
  var px = Math.max(4, Math.round(size * m.a)), key = ch + '|' + px, sp = emojiCache[key];
  if (!sp) {
    sp = document.createElement('canvas'); sp.width = sp.height = Math.ceil(px * 1.5);
    var g = sp.getContext('2d'); g.font = px + 'px ' + EMOJI_FONT; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(ch, sp.width / 2, sp.height / 2);
    emojiCache[key] = sp;
  }
  c.save(); c.setTransform(1, 0, 0, 1, 0, 0);
  c.drawImage(sp, Math.round(m.a * x + m.e - sp.width / 2), Math.round(m.d * y + m.f - sp.height / 2));
  c.restore();
}
function srand(x, y, k) { var n = Math.sin(x * 127.1 + y * 311.7 + (k || 0) * 74.7) * 43758.5453; return n - Math.floor(n); }
var textCache = new Map();
function outlined(c, text, x, y, fill, stroke, lw) {
  fill = fill || '#fff'; stroke = stroke || 'rgba(40,26,16,0.85)'; lw = lw || 3;
  if (c.globalAlpha === 1 && !CAM.zooming) {
    var m = c.getTransform();
    if (Math.abs(m.b) < 1e-6 && Math.abs(m.c) < 1e-6 && Math.abs(m.a - m.d) < 1e-6 && m.a > 0) {
      var sc = Math.round(m.a * 100) / 100, font = c.font, key = text + '|' + font + '|' + fill + '|' + stroke + '|' + lw + '|' + sc;
      var sp = textCache.get(key);
      if (!sp) {
        var fpx = parseFloat(font) || 14, pad = Math.ceil((lw + 4) * sc);
        var mw = Math.ceil(c.measureText(text).width * sc) + pad * 2, mh = Math.ceil(fpx * 1.45 * sc) + pad * 2;
        var cv = document.createElement('canvas'); cv.width = Math.max(4, mw); cv.height = Math.max(4, mh);
        var g = cv.getContext('2d'); g.scale(sc, sc);
        g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
        g.lineWidth = lw; g.strokeStyle = stroke; g.strokeText(text, cv.width / 2 / sc, cv.height / 2 / sc);
        g.fillStyle = fill; g.fillText(text, cv.width / 2 / sc, cv.height / 2 / sc);
        sp = { cv: cv, hw: cv.width / 2, hh: cv.height / 2 };
        if (textCache.size > 260) textCache.delete(textCache.keys().next().value);
        textCache.set(key, sp);
      }
      c.save(); c.setTransform(1, 0, 0, 1, 0, 0);
      c.drawImage(sp.cv, Math.round(m.a * x + m.e - sp.hw), Math.round(m.d * y + m.f - sp.hh));
      c.restore();
      return;
    }
  }
  c.lineWidth = lw; c.strokeStyle = stroke; c.lineJoin = 'round'; c.strokeText(text, x, y); c.fillStyle = fill; c.fillText(text, x, y);
}

// ---------------- view & camera ----------------
function resizeView() {
  var vv = window.visualViewport;
  var w = Math.round(vv ? vv.width : window.innerWidth) || 390;
  var h = Math.round(vv ? vv.height : window.innerHeight) || 844;
  var dpr = Math.min(window.devicePixelRatio || 1, 2);
  VIEW.w = w; VIEW.h = h; VIEW.dpr = dpr;
  canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
}
window.addEventListener('resize', resizeView);
window.addEventListener('orientationchange', function () { setTimeout(resizeView, 50); setTimeout(resizeView, 250); });
if (window.visualViewport) window.visualViewport.addEventListener('resize', resizeView);

// The zoom is tuned for a vertical iPhone screen and clamped so the camera never extends beyond the painted world bounds.
function baseZoom() {
  var span = Math.min(VIEW.w / 8.6, VIEW.h / 15.2);
  var tilePx = Math.round(clamp(span * VIEW.dpr, 30, 120) * (settings.zoom || 1));
  var z = tilePx / TILE / VIEW.dpr;
  var minZ = Math.max(VIEW.w / (W * TILE), VIEW.h / (H * TILE));
  return Math.max(z, minZ);
}
function updateCamera(dt, tx, ty, zoomMul, snap) {
  var tz = baseZoom();
  var k = snap ? 1 : 1 - Math.exp(-dt * 4.5), kz = snap ? 1 : 1 - Math.exp(-dt * 10);
  CAM.zoom += (tz - CAM.zoom) * kz;
  if (Math.abs(tz - CAM.zoom) < 0.004) CAM.zoom = tz;
  var minZ = Math.max(VIEW.w / (W * TILE), VIEW.h / (H * TILE));
  if (CAM.zoom < minZ) CAM.zoom = minZ;
  CAM.zooming = CAM.zoom !== tz;
  var hw = VIEW.w / 2 / CAM.zoom, hh = VIEW.h / 2 / CAM.zoom;
  tx = clamp(tx, hw, Math.max(hw, W * TILE - hw)); ty = clamp(ty, hh, Math.max(hh, H * TILE - hh));
  CAM.x += (tx - CAM.x) * k; CAM.y += (ty - CAM.y) * k;
  CAM.x = clamp(CAM.x, hw, Math.max(hw, W * TILE - hw)); CAM.y = clamp(CAM.y, hh, Math.max(hh, H * TILE - hh));
}
function worldToScreen(x, y) { return { x: (x - CAM.x) * CAM.zoom + VIEW.w / 2, y: (y - CAM.y) * CAM.zoom + VIEW.h / 2 }; }
function screenToWorld(x, y) { return { x: (x - VIEW.w / 2) / CAM.zoom + CAM.x, y: (y - VIEW.h / 2) / CAM.zoom + CAM.y }; }
function applyCam(c) {
  var z = CAM.zoom * VIEW.dpr, sx = FX.shake > 0 ? rand(-5, 5) * FX.shake * VIEW.dpr : 0, sy = FX.shake > 0 ? rand(-5, 5) * FX.shake * VIEW.dpr : 0;
  CAMM.a = z; CAMM.e = Math.round(VIEW.w / 2 * VIEW.dpr - CAM.x * z + sx); CAMM.f = Math.round(VIEW.h / 2 * VIEW.dpr - CAM.y * z + sy);
  c.setTransform(z, 0, 0, z, CAMM.e, CAMM.f);
}
function reCam(c) { c.setTransform(CAMM.a, 0, 0, CAMM.a, CAMM.e, CAMM.f); }
function viewRect(pad) { var hw = VIEW.w / 2 / CAM.zoom + (pad || 0), hh = VIEW.h / 2 / CAM.zoom + (pad || 0); return { x0: CAM.x - hw, y0: CAM.y - hh, x1: CAM.x + hw, y1: CAM.y + hh }; }
function inView(v, x, y, w, h) { return x + w > v.x0 && x < v.x1 && y + h > v.y0 && y < v.y1; }

// ---------------- ground cache ----------------
function artEnv() { return { owned: function (tx, ty) { return layoutKind(tx, ty) === 'yard' && unlocked(tx, ty); }, pending: function (tx, ty) { return layoutKind(tx, ty) === 'yard' && pendingAt(tx, ty); } }; }
function rebuildGround() {
  if (!groundCanvas) { groundCanvas = document.createElement('canvas'); groundCanvas.width = W * TILE * GROUND_SCALE; groundCanvas.height = H * TILE * GROUND_SCALE; }
  var c = groundCanvas.getContext('2d'), env = artEnv(), part = groundDirty !== true && groundDirty && typeof drawWorldGround === 'function' && UI.groundOnce ? groundDirty : null;
  c.setTransform(GROUND_SCALE, 0, 0, GROUND_SCALE, 0, 0);
  if (part) { env.rect = part; try { drawWorldGround(c, env); } catch (e) { console.error('ground art', e); } delete env.rect; }
  else {
    c.clearRect(0, 0, W * TILE, H * TILE);
    try { if (typeof drawWorldGround === 'function') drawWorldGround(c, env); else fallbackGround(c, env); } catch (e) { console.error('ground art', e); fallbackGround(c, env); }
    try { if (typeof drawShopGround === 'function') drawShopGround(c); else fallbackShop(c); } catch (e) { console.error('shop ground', e); fallbackShop(c); }
    UI.groundOnce = true;
  }
  try { worldProps = typeof buildWorldProps === 'function' ? buildWorldProps(env) : []; } catch (e) { console.error('world props', e); worldProps = []; }
  if (!shopProps) { try { shopProps = typeof buildShopProps === 'function' ? buildShopProps() : []; } catch (e) { console.error('shop props', e); shopProps = []; } }
  groundDirty = false; groundStamp++; UI.miniDirty = true;
}
// Blit the ground from chunks that were resampled once to the exact device scale (1:1 blits are ~10x cheaper than scaled ones).
function drawGroundLayer(c) {
  var a = CAMM.a, ex = CAMM.e, ey = CAMM.f, C = GCH.size, GS = GROUND_SCALE;
  c.setTransform(1, 0, 0, 1, 0, 0);
  if (CAM.zooming) {
    var sx = Math.max(0, -ex / a), sy = Math.max(0, -ey / a), sw = Math.min(W * TILE - sx, canvas.width / a), sh = Math.min(H * TILE - sy, canvas.height / a);
    c.drawImage(groundCanvas, sx * GS, sy * GS, sw * GS, sh * GS, Math.round(sx * a + ex), Math.round(sy * a + ey), Math.round(sw * a), Math.round(sh * a));
    reCam(c); return;
  }
  if (GCH.a !== a || GCH.stamp !== groundStamp) { GCH.map = {}; GCH.a = a; GCH.stamp = groundStamp; }
  var maxI = Math.ceil(W * TILE * a / C) - 1, maxJ = Math.ceil(H * TILE * a / C) - 1;
  var i0 = Math.max(0, Math.floor(-ex / C)), i1 = Math.min(maxI, Math.floor((canvas.width - ex) / C)), j0 = Math.max(0, Math.floor(-ey / C)), j1 = Math.min(maxJ, Math.floor((canvas.height - ey) / C));
  var budget = UI.bakeAll ? 999 : 2;
  for (var j = j0; j <= j1; j++) for (var i = i0; i <= i1; i++) {
    var key = i + ',' + j, ch = GCH.map[key];
    if (!ch && budget > 0) {
      budget--; ch = document.createElement('canvas'); ch.width = C; ch.height = C;
      var cc = ch.getContext('2d', { alpha: false }); cc.fillStyle = '#2f4a2c'; cc.fillRect(0, 0, C, C);
      cc.drawImage(groundCanvas, i * C / a * GS, j * C / a * GS, C / a * GS, C / a * GS, 0, 0, C, C);
      GCH.map[key] = ch;
    }
    if (ch) c.drawImage(ch, i * C + ex, j * C + ey);
    else c.drawImage(groundCanvas, i * C / a * GS, j * C / a * GS, C / a * GS, C / a * GS, i * C + ex, j * C + ey, C, C);
  }
  reCam(c);
}
function fallbackGround(c, env) {
  for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) {
    var k = layoutKind(x, y), col = '#5d9d49';
    if (k === 'road') col = '#5b5f66'; else if (k === 'sidewalk') col = '#c9c3b8';
    else if (k === 'yard') col = env.owned(x, y) ? ((x + y) % 2 ? '#7cc260' : '#76bc5b') : env.pending(x, y) ? '#a08a5a' : '#5d9d49';
    c.fillStyle = col; c.fillRect(x * TILE, y * TILE, TILE + 1, TILE + 1);
  }
}
function fallbackShop(c) {
  var s = MAP.shop;
  for (var y = s.y0; y <= s.y1; y++) for (var x = s.x0; x <= s.x1; x++) {
    var k = layoutKind(x, y);
    c.fillStyle = k === 'wall' ? '#8d6e63' : k === 'counter' ? '#7a4e2a' : k === 'furniture' ? '#a8743f' : '#d7a86e';
    c.fillRect(x * TILE, y * TILE, TILE, TILE);
  }
}

// ---------------- cached portraits ----------------
var portraitCache = {};
function portraitCanvas(breed, coat, size, mood) {
  var key = breed + '|' + coat + '|' + size + '|' + (mood || '');
  var pc = portraitCache[key];
  if (pc) return pc;
  pc = document.createElement('canvas'); pc.width = size * 2; pc.height = size * 2;
  var c = pc.getContext('2d'); c.scale(2, 2);
  try {
    if (typeof drawDogPortrait === 'function') drawDogPortrait(c, breed, coat, 0, 0, size, { mood: mood || 'happy' });
    else { var b = BREED_BY_ID[breed] || BREEDS[0], co = b.coats[coat] || b.coats[0]; c.fillStyle = co.base; ell(c, size / 2, size / 2, size * 0.36, size * 0.36); c.fill(); c.fillStyle = '#222'; ell(c, size * 0.4, size * 0.45, 2, 2); c.fill(); ell(c, size * 0.6, size * 0.45, 2, 2); c.fill(); }
  } catch (e) { console.error('portrait', e); }
  portraitCache[key] = pc;
  return pc;
}
function dogPortraitSrc(d, size) {
  if (typeof dogPortraitURL === 'function') { try { return dogPortraitURL(d.breed, d.coat, size, { bg: 'badge', collar: d.collar }); } catch (e) {} }
  return portraitCanvas(d.breed, d.coat, size).toDataURL();
}

// ---------------- entities ----------------
var DOG_S = 1.15;   // dogs are drawn a touch larger than true scale so the small breeds stay readable
var _dogProxy = { id: 0, breed: 'lab', coat: 0, seed: 0, face: 1, moving: false, speed: 0, state: 'idle', happy: 85,
  needs: { clean: 80, hunger: 50, love: 50, fun: 50 }, anim: null, animT: 0, animDur: 0, collar: null, wet: 0, walkDist: 0 };
function drawDogEntity(c, d, t) {
  if (d.state === 'bath' || d.state === 'kennel') return;
  var pool = false;
  if (d.state !== 'leashed') { var po = objAt(tileOf(d.x), tileOf(d.y)); if (po && po.done && po.type === 'pool') pool = d.x > po.x * TILE + 20 && d.x < (po.x + po.w) * TILE - 20 && d.y > po.y * TILE + 22 && d.y < (po.y + po.h) * TILE - 8; }
  var v = _dogProxy;
  v.id = d.id; v.breed = d.breed; v.coat = d.coat; v.seed = d.seed; v.face = d.face; v.moving = d.moving;
  v.speed = d.moving ? (d.curSpeed || d.speed) : 0; v.state = d.state; v.anim = d.anim; v.animT = d.animT; v.animDur = d.animDur;
  v.collar = d.collar; v.wet = d.wet; v.walkDist = d.walkDist;
  // mood and dirt are passed in coarse steps with hysteresis so the sprite cache does not thrash around a threshold
  var hp = d.happy == null ? 70 : d.happy, mb = d._mb == null ? -1 : d._mb, nb = hp < 15 ? 0 : hp < 30 ? 1 : hp <= 70 ? 2 : 3;
  if (mb < 0 || Math.abs(hp - [15, 30, 70][Math.min(mb, nb)]) > 4 || Math.abs(nb - mb) > 1) d._mb = mb = nb;
  v.happy = [10, 22, 50, 85][mb];
  var cl = d.needs ? d.needs.clean : 100, cb = d._cb == null ? -1 : d._cb, ncb = cl < 20 ? 0 : cl < 40 ? 1 : 2;
  if (cb < 0 || Math.abs(cl - [20, 40][Math.min(cb, ncb)]) > 4 || Math.abs(ncb - cb) > 1) d._cb = cb = ncb;
  v.needs.clean = [10, 30, 80][cb];
  if (typeof drawDog !== 'function') { c.fillStyle = breedOf(d).coats[d.coat || 0].base; ell(c, d.x, d.y - 12, 16, 10); c.fill(); ell(c, d.x + d.face * 14, d.y - 20, 7, 7); c.fill(); return; }
  try {
    if (pool) { // wading: the legs are under water, whatever the size of the dog
      var hh = -dogTop(d).top, sink = Math.round(hh * 0.3); v.anim = null; if (v.state === 'nap') v.state = 'idle';
      c.save(); c.beginPath(); c.rect(d.x - 80, d.y - 130, 160, 128); c.clip();
      drawDog(c, v, d.x, d.y + sink, DOG_S, t, { noShadow: true }); c.restore();
      c.strokeStyle = 'rgba(255,255,255,0.8)'; c.lineWidth = 2; ell(c, d.x, d.y - 3, Math.max(12, hh * 0.55) + Math.sin(t * 3 + d.seed) * 2, 4); c.stroke();
    } else drawDog(c, v, d.x, d.y, DOG_S, t);
  } catch (e) { if (!drawDogEntity.err) { drawDogEntity.err = 1; console.error('drawDog', e); } }
  if (d.sparkle > 0) { d.sparkle -= 0.016; if (Math.random() < 0.15) burst(d.x + rand(-16, 16), d.y - rand(6, 30), 'sparkle', 1); }
}
function dogTop(d) {
  if (typeof dogMetrics === 'function') { try { var m = dogMetrics(d); return { top: m.topY * DOG_S, hx: m.headX * d.face * DOG_S, hy: m.headY * DOG_S }; } catch (e) {} }
  return { top: -34, hx: 14 * d.face, hy: -22 };
}
function drawPersonEntity(c, p, t, look) {
  if (typeof drawPerson === 'function') { try { drawPerson(c, p, t, look); return; } catch (e) { if (!drawPersonEntity.err) { drawPersonEntity.err = 1; console.error('drawPerson', e); } } }
  c.fillStyle = 'rgba(40,26,12,0.22)'; ell(c, p.x, p.y, 13, 5); c.fill();
  c.fillStyle = '#3aa89a'; rr(c, p.x - 10, p.y - 46, 20, 34, 6); c.fill(); c.fillStyle = '#f1c7a3'; ell(c, p.x, p.y - 58, 11, 11); c.fill();
}
function ownerHoldsLeash(o) {
  var d = dogById(o.dogId); if (!d || d.ownerId !== o.id) return false;
  if (d.state === 'arriving') return !(o.state === 'handover' && o.hoT > 0.5 && leashSide(o));
  if (d.state === 'toOwner') return false;
  return d.state === 'leaving';
}
function drawOwnerLeash(c, o, op) {
  var d = dogById(o.dogId); if (!d || !ownerHoldsLeash(o)) return;
  var a = anchorOf(op, o.look), m = dogTop(d);
  var x0 = o.x + a.leashX, y0 = o.y + a.leashY, x1 = d.x + m.hx * 0.55, y1 = d.y + m.hy + 8;
  c.strokeStyle = '#6b4a32'; c.lineWidth = 2; c.lineCap = 'round';
  c.beginPath(); c.moveTo(x0, y0); c.quadraticCurveTo((x0 + x1) / 2, Math.max(y0, y1) + 12, x1, y1); c.stroke();
}
function playerLook() { return (typeof PLAYER_LOOKS !== 'undefined' && PLAYER_LOOKS[S.player.look || 0]) || (typeof PLAYER_LOOK !== 'undefined' ? PLAYER_LOOK : {}); }
function leashSide(o) { var d = dogById(o.dogId); return !!d && d.y < (MAP.shop.counter.y + 0.2) * TILE; } // the leash is yours once the dog is round the counter
function playerPose() {
  var P = S.player, car = P.carry;
  var hoIn = S.owners.some(function (o) { return o.state === 'handover' && o.kind === 'dropoff' && o.hoT > 0.5 && !o.byStaff && leashSide(o); });
  return { x: P.x, y: P.y, dir: P.dir, moving: P.moving, walkT: P.walkT, walkDist: P.walkDist || 0, carry: car ? (car.type === 'dog' ? 'leash' : 'item') : hoIn ? 'leash' : null, emote: P.emote, emoteT: P.emoteT, id: 0 };
}
function anchorOf(p, look) {
  if (typeof personAnchor === 'function') { try { return personAnchor(p, look, now); } catch (e) {} }
  return { handX: 0, handY: -40, headTopY: -72, leashX: 8, leashY: -34 };
}
function drawPlayer(c, t) {
  var p = playerPose(), look = playerLook(), car = S.player.carry;
  var a = anchorOf(p, look);
  if (car && car.type !== 'dog' && p.dir === 'up') drawCarry(c, car.type, p.x + a.handX, p.y + a.handY, t, car);
  drawPersonEntity(c, p, t, look);
  if (car && car.type !== 'dog' && p.dir !== 'up') drawCarry(c, car.type, p.x + a.handX, p.y + a.handY, t, car);
  if (typeof MP !== 'undefined' && MP.getOnlinePeers().length > 0) {
    c.font = '13px ' + HEAD_FONT; c.textAlign = 'center'; c.textBaseline = 'middle';
    outlined(c, MP.playerName || 'You', p.x, p.y + 12, '#a7ffeb');
  }
}
function drawRemotePeer(c, rp, t) {
  var look = (typeof PLAYER_LOOKS !== 'undefined' && PLAYER_LOOKS[rp.look || 0]) || playerLook();
  var car = rp.carry;
  var p = { x: rp.x, y: rp.y, dir: rp.dir || 'down', moving: !!rp.moving, walkT: rp.walkT || 0, walkDist: rp.walkDist || 0,
    carry: car ? (car.type === 'dog' ? 'leash' : 'item') : null, emote: rp.emote, emoteT: rp.emoteT || 0, id: 800 + (rp.look || 0) };
  var a = anchorOf(p, look);
  // Draw leash if remote peer is holding a dog
  var ld = null;
  if (car && car.type === 'dog') ld = dogById(car.id);
  if (!ld) {
    for (var i = 0; i < S.dogs.length; i++) if (S.dogs[i].state === 'leashed' && S.dogs[i].leashedBy === rp.id) { ld = S.dogs[i]; break; }
  }
  if (ld) {
    var m = dogTop(ld);
    var x0 = rp.x + a.leashX, y0 = rp.y + a.leashY, x1 = ld.x + m.hx * 0.55, y1 = ld.y + m.hy + 8;
    c.strokeStyle = '#7a3b2e'; c.lineWidth = 2.2; c.lineCap = 'round';
    c.beginPath(); c.moveTo(x0, y0); c.quadraticCurveTo((x0 + x1) / 2, Math.max(y0, y1) + 14, x1, y1); c.stroke();
    c.strokeStyle = ld.collar || '#ff80ab'; c.lineWidth = 1;
    c.beginPath(); c.moveTo(x0, y0); c.quadraticCurveTo((x0 + x1) / 2, Math.max(y0, y1) + 14, x1, y1); c.stroke();
  }
  if (car && car.type !== 'dog' && p.dir === 'up') drawCarry(c, car.type, p.x + a.handX, p.y + a.handY, t, car);
  drawPersonEntity(c, p, t, look);
  if (car && car.type !== 'dog' && p.dir !== 'up') drawCarry(c, car.type, p.x + a.handX, p.y + a.handY, t, car);
  c.font = '14px ' + HEAD_FONT; c.textAlign = 'center'; c.textBaseline = 'middle';
  outlined(c, '🐾 ' + (rp.name || 'Partner'), rp.x, rp.y + 12, '#ffe082');
  if (rp.sayT > 0 && rp.say) bubble(c, rp.x, rp.y - 84, rp.say, { size: 11, bg: '#fff8e1' });
}
function drawNpc(c, n, t) {
  var look = (typeof PLAYER_LOOKS !== 'undefined' && PLAYER_LOOKS[n.look || 0]) || playerLook();
  var ho = n.id === 'receptionist' && S.owners.some(function (o) { return o.byStaff && o.state === 'handover' && o.kind === 'dropoff' && o.hoT > 0.5 && leashSide(o); });
  var holdingDog = n.carry && n.carry.type === 'dog' ? dogById(n.carry.id) : null;
  var p = { x: n.x, y: n.y, dir: n.dir, moving: n.moving, walkT: n.walkT, walkDist: n.walkDist || 0, carry: (n.carry && !holdingDog) ? 'item' : (ho || holdingDog) ? 'leash' : null, emote: n.emote, emoteT: n.emoteT, id: 900 + (n.look || 1) };
  var a = anchorOf(p, look);
  var leashDog = holdingDog || (ho ? dogById((S.owners.filter(function (o) { return o.byStaff && o.state === 'handover'; })[0] || {}).dogId) : null);
  if (leashDog) {
    var m = dogTop(leashDog);
    c.strokeStyle = '#7a3b2e'; c.lineWidth = 2; c.lineCap = 'round';
    c.beginPath(); c.moveTo(n.x + a.leashX, n.y + a.leashY); c.quadraticCurveTo((n.x + leashDog.x) / 2, Math.max(n.y + a.leashY, leashDog.y + m.hy + 8) + 14, leashDog.x + m.hx * 0.55, leashDog.y + m.hy + 8); c.stroke();
  }
  if (n.carry && !holdingDog && p.dir === 'up') drawCarry(c, n.carry.type, n.x + a.handX, n.y + a.handY, t, n.carry);
  drawPersonEntity(c, p, t, look);
  if (n.carry && !holdingDog && p.dir !== 'up') drawCarry(c, n.carry.type, n.x + a.handX, n.y + a.handY, t, n.carry);
  var sDef = STAFF_BY_ID[n.id];
  var sLv = typeof staffLvl === 'function' ? staffLvl(n.id) : 1;
  c.font = '12px ' + HEAD_FONT; c.textAlign = 'center'; c.textBaseline = 'middle';
  outlined(c, sDef ? (sDef.icon + ' ' + sDef.name + (sLv > 1 ? ' Lv' + sLv : '')) : n.id, n.x, n.y + 11, sLv > 1 ? '#ffd54a' : '#ffe9b0');
  if (n.sayT > 0 && n.say) bubble(c, n.x, n.y - 82, n.say, { size: 11 });
}
function drawCarry(c, kind, x, y, t, car) {
  var count = clamp((car && car.n) || 1, 1, 5);
  for (var si = 0; si < count; si++) {
    var iy = y - si * 7;
    if (typeof drawCarryItem === 'function') { try { drawCarryItem(c, kind, x, iy, t); } catch (e) { emoji(c, '💩', x, iy, 18); } }
    else emoji(c, kind === 'food' ? '🥣' : kind === 'ball' ? '🎾' : kind === 'treat' ? '🍪' : '💩', x, iy, 18);
  }
  if (count > 1) {
    var by = y - (count - 1) * 7 - 10;
    c.fillStyle = '#3b2a20'; c.beginPath(); c.arc(x + 12, by, 8.5, 0, 6.3); c.fill();
    c.strokeStyle = '#fff8e6'; c.lineWidth = 1.5; c.stroke();
    c.font = '11px ' + HEAD_FONT; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillStyle = '#ffe082'; c.fillText(String(count), x + 12, by + 0.5);
  }
}
function drawLeash(c) {
  var P = S.player, d = null;
  if (P.carry && P.carry.type === 'dog') d = dogById(P.carry.id);
  else { var ho = S.owners.filter(function (o) { return o.state === 'handover' && o.kind === 'dropoff' && o.hoT > 0.5 && !o.byStaff && leashSide(o); })[0]; if (ho) d = dogById(ho.dogId); } // the leash has just been passed to you
  if (!d) return;
  var a = anchorOf(playerPose(), playerLook()), m = dogTop(d);
  var x0 = P.x + a.leashX, y0 = P.y + a.leashY, x1 = d.x + m.hx * 0.55, y1 = d.y + m.hy + 8;
  c.strokeStyle = '#7a3b2e'; c.lineWidth = 2.2; c.lineCap = 'round';
  c.beginPath(); c.moveTo(x0, y0); c.quadraticCurveTo((x0 + x1) / 2, Math.max(y0, y1) + 14, x1, y1); c.stroke();
  c.strokeStyle = d.collar || '#d9574a'; c.lineWidth = 1; c.beginPath(); c.moveTo(x0, y0); c.quadraticCurveTo((x0 + x1) / 2, Math.max(y0, y1) + 14, x1, y1); c.stroke();
}

// ---------------- objects ----------------
function artOf(type) { return (typeof OBJECT_ART !== 'undefined' && OBJECT_ART[type]) || null; }
function artObj(o) {
  var occ = o.dogId ? dogById(o.dogId) : null, res = o.reservedFor ? dogById(o.reservedFor) : null;
  return { type: o.type, x: o.x, y: o.y, w: o.w, h: o.h, id: o.id, occupied: !!occ, useT: now - (o.useAt == null ? -99 : o.useAt), label: occ ? occ.name : res ? res.name : null };
}
function drawObjectBase(c, o, t) {
  var px = o.x * TILE, py = o.y * TILE, w = o.w * TILE, h = o.h * TILE;
  if (!o.done) { drawSite(c, o, t); return; }
  var art = artOf(o.type), ao = artObj(o);
  if (art) { try { art.draw(c, ao, t, ENV); } catch (e) { if (!art.err) { art.err = 1; console.error('object art ' + o.type, e); } } }
  else { c.fillStyle = CAT_BY_ID[o.type].floor ? 'rgba(243,210,122,0.9)' : '#b9824d'; rr(c, px + 3, py + 3, w - 6, h - 6, 8); c.fill(); emoji(c, CAT_BY_ID[o.type].icon, px + w / 2, py + h / 2, Math.min(w, h) * 0.5); }
  // occupant face (kennel doorway / bath tub)
  var occ = o.dogId ? dogById(o.dogId) : null;
  if (occ) {
    var an = (art && art.anchor) || { headX: w / 2, headY: h * 0.6, headR: 13 };
    var bathing = occ.state === 'bath';
    try {
      if (typeof drawDogFace === 'function') drawDogFace(c, occ.breed, occ.coat, px + an.headX, py + an.headY + (bathing ? Math.sin(t * 5) * 1.2 : 0), an.headR, { mood: bathing ? (hasTrait(occ, 'water') ? 'happy' : 'neutral') : 'sleepy', t: t, seed: Math.floor(occ.seed), collar: occ.collar });
      else { c.fillStyle = breedOf(occ).coats[occ.coat || 0].base; ell(c, px + an.headX, py + an.headY, an.headR, an.headR); c.fill(); }
    } catch (e) {}
    if (!bathing && Math.random() < 0.012) FX.parts.push({ x: px + an.headX + 10, y: py + an.headY - 14, vx: 6, vy: -12, life: 1.5, max: 1.5, kind: 'z', size: 12 });
  }
  if (art && art.drawFront) { try { art.drawFront(c, ao, t, ENV); } catch (e) {} }
  if (occ && occ.state === 'bath') {
    var left = clamp(occ.actT / 4, 0, 1), bx = px + w / 2;
    c.fillStyle = 'rgba(40,26,16,0.7)'; rr(c, bx - 26, py - 16, 52, 9, 4.5); c.fill(); c.fillStyle = '#66bde3'; rr(c, bx - 24.5, py - 14.5, 49 * (1 - left), 6, 3); c.fill();
  }
  var olv = o.lvl || 1;
  if (olv > 1 || UI.mode === 'build') {
    var lx = px + w - 13, ly = py + 10;
    c.fillStyle = olv > 1 ? '#8e6bd6' : 'rgba(59,42,32,0.78)';
    rr(c, lx - 13, ly - 7, 26, 14, 5); c.fill();
    c.strokeStyle = '#fff8e6'; c.lineWidth = 1.2; c.stroke();
    c.font = '10.5px ' + HEAD_FONT; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillStyle = olv > 1 ? '#ffe66d' : '#fff8e6';
    c.fillText('Lv' + olv, lx, ly + 0.5);
  }
}
function drawSite(c, o, t) {
  var px = o.x * TILE, py = o.y * TILE, w = o.w * TILE, left = Math.max(0, (o.buildEnd - Date.now()) / 1000), prog = clamp(1 - left / Math.max(1, o.buildDur), 0, 1);
  if (o.upgrading) {
    var artU = artOf(o.type);
    if (artU) {
      c.save(); c.globalAlpha = 0.72;
      try { artU.draw(c, artObj(o), t, ENV); if (artU.drawFront) artU.drawFront(c, artObj(o), t, ENV); } catch (e) {}
      c.restore();
    }
  }
  var ok = false;
  if (!o.upgrading && typeof drawConstruction === 'function') { try { drawConstruction(c, artObj(o), t, prog); ok = true; } catch (e) {} }
  if (!ok && !o.upgrading) { c.fillStyle = '#a1887f'; rr(c, px + 2, py + 2, w - 4, o.h * TILE - 4, 6); c.fill(); }
  var bw = Math.max(68, w - 6), bx = px + w / 2 - bw / 2, by = py - 20;
  c.fillStyle = 'rgba(40,26,16,0.82)'; rr(c, bx - 2, by - 2, bw + 4, 17, 7); c.fill();
  c.fillStyle = o.upgrading ? '#c3a6ff' : '#8bd46e'; rr(c, bx, by, Math.max(5, bw * prog), 13, 5); c.fill();
  var lbl = (o.upgrading ? '⬆️Lv' + ((o.lvl || 1) + 1) + ' ' : '🔨 ') + fmtDur(left);
  c.font = '12.5px ' + HEAD_FONT; c.textAlign = 'center'; c.textBaseline = 'middle'; outlined(c, lbl, px + w / 2, by + 6.5, '#fff', 'rgba(40,26,16,0.9)', 2.5);
}

// ---------------- speech & tags ----------------
var bubbleCache = new Map();
function bubble(c, x, y, text, opt) {
  opt = opt || {};
  var size = opt.size || 12, bg = opt.bg || '#fffaf0', fg = opt.fg || '#4a3426', stroke = opt.stroke || OUTLINE;
  if (c.globalAlpha === 1 && !CAM.zooming) {
    var m = c.getTransform();
    if (Math.abs(m.b) < 1e-6 && Math.abs(m.c) < 1e-6 && Math.abs(m.a - m.d) < 1e-6 && m.a > 0) {
      var sc = Math.round(m.a * 100) / 100, key = text + '|' + size + '|' + bg + '|' + fg + '|' + stroke + '|' + sc;
      var sp = bubbleCache.get(key);
      if (!sp) {
        c.font = '700 ' + size + 'px ' + BODY_FONT;
        var w = c.measureText(text).width + 16, h = size + 12, pad = 4;
        var cw = Math.ceil((w + pad * 2) * sc), ch = Math.ceil((h + 8 + pad * 2) * sc);
        var cv = document.createElement('canvas'); cv.width = Math.max(4, cw); cv.height = Math.max(4, ch);
        var g = cv.getContext('2d'); g.scale(sc, sc);
        var ox = w / 2 + pad, oy = h + pad;
        g.font = '700 ' + size + 'px ' + BODY_FONT;
        g.fillStyle = bg; g.strokeStyle = stroke; g.lineWidth = 1.6;
        rr(g, ox - w / 2, oy - h, w, h, 9); g.fill(); g.stroke();
        g.beginPath(); g.moveTo(ox - 5, oy - 1); g.lineTo(ox, oy + 6); g.lineTo(ox + 5, oy - 1); g.fillStyle = bg; g.fill();
        g.beginPath(); g.moveTo(ox - 5, oy - 0.5); g.lineTo(ox, oy + 6); g.lineTo(ox + 5, oy - 0.5); g.stroke();
        g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, ox, oy - h / 2 + 0.5);
        sp = { cv: cv, ox: ox * sc, oy: oy * sc };
        if (bubbleCache.size > 90) bubbleCache.delete(bubbleCache.keys().next().value);
        bubbleCache.set(key, sp);
      }
      c.save(); c.setTransform(1, 0, 0, 1, 0, 0);
      c.drawImage(sp.cv, Math.round(m.a * x + m.e - sp.ox), Math.round(m.d * y + m.f - sp.oy));
      c.restore();
      return;
    }
  }
  c.font = '700 ' + size + 'px ' + BODY_FONT;
  var w2 = c.measureText(text).width + 16, h2 = size + 12;
  c.fillStyle = bg; c.strokeStyle = stroke; c.lineWidth = 1.6;
  rr(c, x - w2 / 2, y - h2, w2, h2, 9); c.fill(); c.stroke();
  c.beginPath(); c.moveTo(x - 5, y - 1); c.lineTo(x, y + 6); c.lineTo(x + 5, y - 1); c.fillStyle = bg; c.fill();
  c.beginPath(); c.moveTo(x - 5, y - 0.5); c.lineTo(x, y + 6); c.lineTo(x + 5, y - 0.5); c.stroke();
  c.fillStyle = fg; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(text, x, y - h2 / 2 + 0.5);
}
function iconBubble(c, x, y, ch, urgent, pulse) {
  var s = 1 + (pulse ? Math.sin(now * 8) * 0.08 : 0);
  c.save(); c.translate(x, y); c.scale(s, s);
  c.fillStyle = urgent ? '#ffd9d4' : '#fffaf0'; c.strokeStyle = urgent ? '#d9574a' : OUTLINE; c.lineWidth = 1.6;
  c.beginPath(); c.moveTo(-4, -3); c.lineTo(0, 5); c.lineTo(4, -3); c.closePath(); c.fill(); c.stroke();
  ell(c, 0, -14, 13, 12.5); c.fill(); c.stroke();
  emoji(c, ch, 0, -13, 14);
  c.restore();
}
function keyCap(c, x, y, label) {
  c.font = '15px ' + HEAD_FONT; var w = Math.max(20, c.measureText(label).width + 10);
  var bob = Math.sin(now * 5) * 2;
  c.fillStyle = '#4a3426'; rr(c, x - w / 2, y - 9 + bob + 3, w, 19, 5); c.fill();
  c.fillStyle = '#fffaf0'; rr(c, x - w / 2, y - 10 + bob, w, 19, 5); c.fill(); c.strokeStyle = '#4a3426'; c.lineWidth = 1.6; c.stroke();
  c.fillStyle = '#4a3426'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(label, x, y + bob);
}
function drawOwnerUI(c, o, t) {
  var d = dogById(o.dogId), top = -82;
  if (o.sayT > 0 && o.say && o.state !== 'waitPickup') { bubble(c, o.x, o.y + top, o.say, { size: 11 }); return; }
  if (o.state !== 'waitCheckin' && o.state !== 'waitPickup') return;
  var f = clamp(o.patience / o.patienceMax, 0, 1), col = f > 0.5 ? '#6fbf5a' : f > 0.25 ? '#f2c14e' : '#d9574a';
  var bx = o.x, by = o.y + top - 6, pickup = o.state === 'waitPickup';
  var cardW = pickup ? 86 : 56;
  c.fillStyle = pickup ? '#fff1c9' : '#fffaf0'; c.strokeStyle = f < 0.25 ? '#d9574a' : OUTLINE; c.lineWidth = 1.8;
  c.beginPath(); c.moveTo(bx - 5, by + 14); c.lineTo(bx, by + 21); c.lineTo(bx + 5, by + 14); c.closePath(); c.fill(); c.stroke();
  rr(c, bx - cardW / 2, by - 32, cardW, 47, 9); c.fill(); c.stroke();
  if (d) {
    var px0 = bx - cardW / 2 + 2;
    if (typeof drawDogPortrait === 'function') { try { drawDogPortrait(c, d.breed, d.coat, px0, by - 31, 34, { collar: d.collar }); } catch (e) {} }
    else c.drawImage(portraitCanvas(d.breed, d.coat, 36), px0, by - 31, 34, 34);
  }
  if (pickup && d) {
    c.font = '10px ' + HEAD_FONT; c.textAlign = 'left'; c.textBaseline = 'middle';
    c.fillStyle = '#7a4e2a'; c.fillText('PICKUP:', bx - cardW / 2 + 37, by - 21);
    c.font = '12px ' + HEAD_FONT; c.fillStyle = '#3b2a20';
    c.fillText(d.name.slice(0, 7), bx - cardW / 2 + 37, by - 8);
  } else {
    emoji(c, d && d.overnight ? '🌙' : '📋', bx + 17, by - 14, 13);
  }
  c.fillStyle = 'rgba(74,52,38,0.25)'; rr(c, bx - cardW / 2 + 5, by + 7, cardW - 10, 5, 2.5); c.fill();
  c.fillStyle = col; rr(c, bx - cardW / 2 + 5, by + 7, Math.max(3, (cardW - 10) * f), 5, 2.5); c.fill();
  if (f < 0.25) { c.font = '23px ' + HEAD_FONT; c.textAlign = 'center'; outlined(c, '!', bx, by - 42 + Math.sin(t * 12) * 2, '#ff6b5a'); }
  c.font = '14px ' + HEAD_FONT; c.textAlign = 'center'; c.textBaseline = 'middle'; outlined(c, o.name, o.x, o.y + 12, '#fff');
}
function drawDogUI(c, d, t) {
  if (d.state === 'leaving' || d.state === 'arriving') return;
  var m = dogTop(d), x = d.x, y = d.y + m.top - 6, inK = d.state === 'kennel', inB = d.state === 'bath';
  if (inK || inB) { var k = objById(d.objId); if (k) { x = (k.x + k.w / 2) * TILE; y = k.y * TILE - (inB ? 22 : 4); } }
  c.font = '14px ' + HEAD_FONT; c.textAlign = 'center'; c.textBaseline = 'middle';
  if (!inK && !inB) { outlined(c, d.name, d.x, d.y + 11, d.special ? '#ffd54a' : '#fff'); if (d.special) { c.font = '11px ' + HEAD_FONT; outlined(c, '⭐ ' + (d.title || 'special guest'), d.x, d.y + 24, '#ffe9a0'); if (Math.random() < 0.08) burst(d.x + rand(-18, 18), d.y - rand(4, 36), 'sparkle', 1); } }
  var leashed = S.player.carry && S.player.carry.id === d.id;
  // No pickup notification on the dog! The owner at the counter shows which dog they want, and the player finds the dog in the yard.
  if (inB) return;
  if (d.need && !leashed) {
    var urgent = d.need.t > NEED_GRACE;
    iconBubble(c, x + (urgent ? Math.sin(t * 30) * 1.2 : 0), y + Math.sin(t * 4 + d.seed) * 2, NEED_INFO[d.need.type].icon, urgent, true);
  } else if (d.mood > 0) { c.globalAlpha = clamp(d.mood, 0, 1); heart(c, x, y - 6 - (1.2 - d.mood) * 12, 7, '#ff6b8a'); c.globalAlpha = 1; }
  if (!inK && (d.need || dist(d.x, d.y, S.player.x, S.player.y) < 130)) {
    var h = d.happy, col = h > 70 ? '#6fbf5a' : h > 40 ? '#f2c14e' : '#d9574a';
    c.fillStyle = 'rgba(40,26,16,0.6)'; rr(c, d.x - 16, d.y + 19, 32, 5, 2.5); c.fill(); c.fillStyle = col; rr(c, d.x - 15, d.y + 20, 30 * h / 100, 3, 1.5); c.fill();
  }
}
// ---------------- interaction zones ("stand in the box") ----------------
function matUseful(o) {
  var car = S.player.carry, t = o.type;
  if (STATION_ITEM[t]) { if (car) return false; var want = STATION_ITEM[t]; return S.dogs.some(function (d) { return d.need && !d.need.self && (NEED_INFO[d.need.type].item === want || (want === 'food' && d.need.type === 'treat' && !hasDone('treatjar'))); }); }
  if (t === 'trash') return !!(car && car.type !== 'dog');
  if (t === 'tub') { if (!(car && car.type === 'dog') || o.dogId) return false; var d = dogById(car.id); return !!(d && d.need && d.need.type === 'bath'); }
  if (t === 'kennel') return !!(car && car.type === 'dog' && !o.dogId && (!o.reservedFor || o.reservedFor === car.id));
  return false;
}
var PAD_ICON = { foodbin: '🍖', toybox: '🎾', treatjar: '🍪', trash: '💩', tub: '🛁', kennel: '💤' };
function drawPad(c, r, t, lit, active) {
  var pulse = lit ? 0.5 + Math.sin(t * 5) * 0.25 : 0;
  c.fillStyle = active ? 'rgba(255,244,200,0.55)' : lit ? 'rgba(255,244,200,' + (0.28 + pulse * 0.2) + ')' : 'rgba(255,250,230,0.16)';
  rr(c, r.x, r.y, r.w, r.h, 9); c.fill();
  c.strokeStyle = active ? '#fff5c0' : lit ? 'rgba(255,236,150,' + (0.7 + pulse * 0.3) + ')' : 'rgba(255,250,230,0.45)'; c.lineWidth = lit || active ? 2.6 : 1.6;
  c.setLineDash(lit || active ? [] : [6, 5]); rr(c, r.x, r.y, r.w, r.h, 9); c.stroke(); c.setLineDash([]);
}
function drawPlayerGuide(c, t) {
  var p = S.player, car = p.carry, tx = null, ty = null, col = '#ffe082', tutG = null;
  if (!S.tutorialDone && typeof tutorialGuidance === 'function') {
    tutG = tutorialGuidance();
    if (tutG) { tx = tutG.tx; ty = tutG.ty; col = tutG.col || '#ffe082'; }
  }
  if (tx == null || ty == null) {
    if (car && car.type === 'dog') {
      var cd = dogById(car.id);
      var ow = S.owners.filter(function (o) { return o.dogId === car.id && (o.state === 'waitPickup' || o.state === 'toHandover' || o.state === 'handover'); })[0];
      if (ow) { tx = ACTION_BOX.x + ACTION_BOX.w / 2; ty = ACTION_BOX.y + ACTION_BOX.h / 2; col = '#ffd54a'; }
      else if (cd && cd.need && cd.need.type === 'bath') {
        var tub = S.objects.filter(function (o) { return o.done && o.type === 'tub' && !o.dogId; })[0];
        if (tub) { var tp = stationPad(tub) || { x: tub.x * TILE, y: tub.y * TILE, w: tub.w * TILE, h: tub.h * TILE }; tx = tp.x + tp.w / 2; ty = tp.y + tp.h / 2; col = '#80d8ff'; }
      }
    } else if (car && car.type === 'poop') {
      var bin = S.objects.filter(function (o) { return o.done && o.type === 'trash'; })[0];
      if (bin) { var bp = stationPad(bin) || { x: bin.x * TILE, y: bin.y * TILE, w: bin.w * TILE, h: bin.h * TILE }; tx = bp.x + bp.w / 2; ty = bp.y + bp.h / 2; col = '#cfd8dc'; }
    } else if (car && (car.type === 'food' || car.type === 'treat' || car.type === 'ball')) {
      var wantDog = S.dogs.filter(function (d) {
        if (!d.checkedIn || !d.need || d.need.self) return false;
        var nt = d.need.type;
        return (car.type === 'food' && (nt === 'food' || nt === 'treat')) || (car.type === 'treat' && (nt === 'treat' || nt === 'food')) || (car.type === 'ball' && nt === 'play');
      }).sort(function (a, b) { return dist(p.x, p.y, a.x, a.y) - dist(p.x, p.y, b.x, b.y); })[0];
      if (wantDog) { tx = wantDog.x; ty = wantDog.y; col = '#8bf06e'; }
    } else {
      var wc = S.owners.filter(function (o) { return o.state === 'waitCheckin'; })[0];
      if (wc) { tx = ACTION_BOX.x + ACTION_BOX.w / 2; ty = ACTION_BOX.y + ACTION_BOX.h / 2; col = '#ffd54a'; }
      else {
        var nd = S.dogs.filter(function (d) { return d.checkedIn && d.need && !d.need.self && (d.state === 'idle' || d.state === 'wander' || d.state === 'nap'); })
          .sort(function (a, b) { return b.need.t - a.need.t; })[0];
        if (nd) {
          var reqItem = NEED_INFO[nd.need.type] && NEED_INFO[nd.need.type].item;
          if (reqItem) {
            var st = S.objects.filter(function (o) { return o.done && STATION_ITEM[o.type] === reqItem; })[0];
            if (st) { var sp = stationPad(st); if (sp) { tx = sp.x + sp.w / 2; ty = sp.y + sp.h / 2; col = '#ffe082'; } }
          } else { tx = nd.x; ty = nd.y; col = '#ff8a80'; }
        } else if (S.chores && S.chores.length) {
          var nearCh = S.chores.slice().sort(function (a, b) { return dist(p.x, p.y, a.x, a.y) - dist(p.x, p.y, b.x, b.y); })[0];
          if (nearCh) { tx = nearCh.x; ty = nearCh.y; col = '#80d8ff'; }
        }
      }
    }
  }
  if (tx == null || ty == null) return;
  if (tutG) {
    var bob = Math.sin(t * 6) * 5;
    var pulseR = 22 + Math.sin(t * 5) * 4;
    c.save();
    c.strokeStyle = col; c.lineWidth = 2.6; c.setLineDash([6, 4]);
    ell(c, tx, ty + 4, pulseR, pulseR * 0.58); c.stroke();
    c.setLineDash([]);
    bubble(c, tx, ty - 34 + bob, '▼ ' + tutG.callout, { size: 12, bg: '#2b1b12', fg: '#ffe66d', stroke: col });
    c.restore();
  }
  var d = dist(p.x, p.y, tx, ty);
  if (d < 52) return;
  var ang = Math.atan2(ty - (p.y - 6), tx - p.x), r = 34 + Math.sin(t * 7) * 3;
  var ax = p.x + Math.cos(ang) * r, ay = p.y - 6 + Math.sin(ang) * r * 0.72;
  c.save(); c.translate(ax, ay); c.rotate(ang);
  c.fillStyle = col; c.strokeStyle = OUTLINE; c.lineWidth = 2;
  c.beginPath(); c.moveTo(10, 0); c.lineTo(-5, -6.5); c.lineTo(-2.5, 0); c.lineTo(-5, 6.5); c.closePath();
  c.fill(); c.stroke();
  c.restore();
}
function drawZones(c, t, v) {
  var z = UI.zone, car = S.player.carry;
  // 1. SERVE pad behind the counter
  var mr = ACTION_BOX, waiting = S.owners.some(function (o) { return o.state === 'waitCheckin'; });
  var wantedHere = car && car.type === 'dog' && S.owners.some(function (o) { return o.dogId === car.id && o.state === 'waitPickup'; });
  var lit = waiting || wantedHere, on = z && z.key === 'mat';
  drawPad(c, { x: mr.x + 3, y: mr.y + 3, w: mr.w - 6, h: mr.h - 6 }, t, lit, on);
  c.globalAlpha = lit || on ? 1 : 0.65; emoji(c, '🔔', mr.x + mr.w - 18, mr.y + 16, 15); c.globalAlpha = 1;
  c.font = '14px ' + HEAD_FONT; c.textAlign = 'left'; c.textBaseline = 'middle'; c.fillStyle = lit || on ? '#fff5c0' : 'rgba(255,250,230,0.8)'; c.fillText('SERVE', mr.x + 10, mr.y + 15);
  // 2. Station mats
  S.objects.forEach(function (o) {
    if (!o.done || !PAD_ICON[o.type]) return;
    var pad = stationPad(o); if (!pad || !inView(v, pad.x, pad.y, pad.w, pad.h)) return;
    var useful = matUseful(o), act = z && z.key === 'obj' + o.id;
    drawPad(c, pad, t, useful, act);
    c.globalAlpha = useful || act ? 1 : 0.55; emoji(c, PAD_ICON[o.type], pad.x + pad.w / 2, pad.y + pad.h / 2 + 1, 15); c.globalAlpha = 1;
  });
  // 3. In-world My Mini Mart floor unlock pads ($Cost pads & Land Expansion boxes)
  if (typeof activeUnlockPads === 'function') {
    var upads = activeUnlockPads();
    for (var ui = 0; ui < upads.length; ui++) {
      var up = upads[ui], rx = up.x * TILE + 3, ry = up.y * TILE + 3, rw = up.w * TILE - 6, rh = up.h * TILE - 6;
      if (!inView(v, rx - 40, ry - 40, rw + 80, rh + 80)) continue;
      var isPlot = up.kind === 'plot';
      var pend = isPlot ? up.pending : null;
      var lvlOk = !isPlot || S.level >= (up.lvl || 1);
      var canAfford = !pend && lvlOk && S.cash >= up.cost;
      var filling = typeof PAD_FILL !== 'undefined' && PAD_FILL.id === up.id && PAD_FILL.prog > 0;
      var pulse = canAfford ? 0.5 + Math.sin(t * 5) * 0.25 : 0;
      c.fillStyle = pend ? 'rgba(255, 193, 7, 0.28)' : isPlot ? (canAfford ? 'rgba(245, 180, 45, ' + (0.28 + pulse * 0.16) + ')' : 'rgba(65, 44, 24, 0.34)') : (canAfford ? 'rgba(85, 195, 75, ' + (0.24 + pulse * 0.14) + ')' : 'rgba(40, 26, 16, 0.24)');
      rr(c, rx, ry, rw, rh, 10); c.fill();
      if (filling) {
        c.save(); rr(c, rx, ry, rw, rh, 10); c.clip();
        c.fillStyle = isPlot ? 'rgba(255, 213, 74, 0.72)' : 'rgba(127, 235, 100, 0.65)';
        var fh = rh * clamp(PAD_FILL.prog, 0, 1);
        c.fillRect(rx, ry + rh - fh, rw, fh);
        c.restore();
      }
      c.strokeStyle = filling ? '#ffe66d' : pend ? '#ffd54a' : isPlot ? (canAfford ? '#ffe082' : 'rgba(255,224,130,0.55)') : (canAfford ? '#9ef08a' : 'rgba(255,250,230,0.4)');
      c.lineWidth = canAfford || isPlot ? 2.6 : 1.6;
      c.setLineDash(canAfford ? [] : [6, 5]);
      rr(c, rx, ry, rw, rh, 10); c.stroke(); c.setLineDash([]);
      var cx = rx + rw / 2, cy = ry + rh / 2;
      if (isPlot) {
        emoji(c, pend ? '🚜' : '🗺️', cx, cy - 16, 16);
        c.font = '11.5px ' + HEAD_FONT; c.textAlign = 'center'; c.textBaseline = 'middle';
        outlined(c, up.name, cx, cy + 1, '#fff8e1', 'rgba(30,18,10,0.92)', 2.4);
        var pSub = pend ? fmtDur((pend.end - Date.now()) / 1000) : !lvlOk ? ('🔒 Lv ' + up.lvl) : fmtMoney(up.cost);
        c.font = '12.5px ' + HEAD_FONT;
        outlined(c, pSub, cx, cy + 16, pend ? '#ffe082' : canAfford ? '#b9f6ca' : '#ffd0c4', 'rgba(30,18,10,0.92)', 2.5);
        if (up.unlocks && up.unlocks.length && dist(S.player.x, S.player.y, cx, cy) < 135) {
          bubble(c, cx, ry - 6, 'Unlocks: ' + up.unlocks.join(' · '), { size: 11, bg: '#4a3426', fg: '#ffe9a8', stroke: '#2a1a10' });
        }
      } else {
        emoji(c, up.icon, cx, cy - 8, 16);
        c.font = '13px ' + HEAD_FONT; c.textAlign = 'center'; c.textBaseline = 'middle';
        outlined(c, fmtMoney(up.cost), cx, cy + 9, canAfford ? '#b9f6ca' : '#ffd0c4', 'rgba(30,18,10,0.9)', 2.5);
      }
    }
  }
  // 4. Daytime Yard & Shop Chores (walk over to complete for cash & ★ Star Rating!)
  if (S.chores && S.chores.length) {
    S.chores.forEach(function (ch) {
      if (!inView(v, ch.x - 45, ch.y - 45, 90, 90)) return;
      var actC = z && z.key === 'chore' + ch.id, puC = 0.5 + Math.sin(t * 5 + ch.id) * 0.5;
      c.fillStyle = actC ? 'rgba(128, 216, 255, 0.38)' : 'rgba(255, 248, 225, 0.22)';
      ell(c, ch.x, ch.y, 26, 13); c.fill();
      c.strokeStyle = actC ? '#80d8ff' : 'rgba(255, 230, 128, ' + (0.65 + puC * 0.35) + ')';
      c.lineWidth = actC ? 3 : 2.2; c.setLineDash(actC ? [] : [5, 4]);
      ell(c, ch.x, ch.y, 26, 13); c.stroke(); c.setLineDash([]);
      var bobY = ch.y - 12 + Math.sin(t * 4.5 + ch.id) * 3;
      emoji(c, ch.icon, ch.x, bobY, 18);
      c.font = '11.5px ' + HEAD_FONT; c.textAlign = 'center'; c.textBaseline = 'middle';
      outlined(c, '+' + fmtMoney(ch.cash) + ' ★', ch.x, ch.y + 11, '#ffe66d', 'rgba(30,18,10,0.9)', 2.4);
    });
  }
  // 5. Rings round the dogs that have an active care need (never highlight pickup dogs — player must find them!)
  S.dogs.forEach(function (d) {
    if (!(d.state === 'idle' || d.state === 'wander' || d.state === 'nap' || d.state === 'eat' || d.state === 'play')) return;
    if (!d.need || d.need.self) return;
    if (!inView(v, d.x - 50, d.y - 30, 100, 60)) return;
    var act = z && z.key === 'dog' + d.id, urgent = d.need && d.need.t > NEED_GRACE, pu = 0.5 + Math.sin(t * 5 + d.seed) * 0.5;
    c.fillStyle = act ? 'rgba(255,244,200,0.35)' : 'rgba(255,250,230,0.14)'; ell(c, d.x, d.y, 40, 16); c.fill();
    c.strokeStyle = urgent ? 'rgba(255,120,100,' + (0.6 + pu * 0.4) + ')' : 'rgba(255,240,190,' + (0.55 + pu * 0.35) + ')';
    c.lineWidth = act ? 3.2 : 2.4; c.setLineDash(act ? [] : [7, 5]); c.lineDashOffset = -t * 16; ell(c, d.x, d.y, 40, 16); c.stroke(); c.setLineDash([]);
  });
  // 5. My Mini Mart directional pointer around player's feet
  if (UI.mode === 'play') drawPlayerGuide(c, t);
}
// the ring that fills up while you stand in a box
function drawDwellProgress(c, t) {
  var z = UI.zone; if (!z || z.disabled || DWELL.t <= 0) return;
  var f = clamp(DWELL.t / z.time, 0, 1), p = S.player;
  c.fillStyle = 'rgba(40,26,16,0.45)'; ell(c, p.x, p.y - 92, 15, 15); c.fill();
  c.strokeStyle = 'rgba(255,255,255,0.35)'; c.lineWidth = 4; c.beginPath(); c.arc(p.x, p.y - 92, 11, 0, 6.283); c.stroke();
  c.strokeStyle = '#ffe66d'; c.lineWidth = 4; c.lineCap = 'round'; c.beginPath(); c.arc(p.x, p.y - 92, 11, -Math.PI / 2, -Math.PI / 2 + f * 6.283); c.stroke(); c.lineCap = 'butt';
}
function highlight(c, tg, t, keyLabel) {
  var a = 0.6 + Math.sin(t * 8) * 0.25, kx, ky;
  c.strokeStyle = 'rgba(255,250,230,' + a + ')'; c.lineWidth = 3; c.setLineDash([7, 5]); c.lineDashOffset = -t * 28;
  if (tg.kind === 'dog') { ell(c, tg.dog.x, tg.dog.y, 28, 11); c.stroke(); kx = tg.dog.x; ky = tg.dog.y + 42; }
  else if (tg.kind === 'owner') { ell(c, tg.o.x, tg.o.y, 22, 9); c.stroke(); kx = tg.o.x; ky = tg.o.y - 134; }
  else if (tg.kind === 'poop') { ell(c, tg.poop.x, tg.poop.y, 16, 8); c.stroke(); kx = tg.poop.x; ky = tg.poop.y + 26; }
  else if (tg.kind === 'obj') { var o = tg.obj; rr(c, o.x * TILE + 1, o.y * TILE + 1, o.w * TILE - 2, o.h * TILE - 2, 8); c.stroke(); kx = (o.x + o.w / 2) * TILE; ky = o.y * TILE - 30; }
  c.setLineDash([]);
  if (keyLabel) keyCap(c, kx, ky, keyLabel);
}

// ---------------- main render ----------------
var _renderList = [], _renderPool = [], _ownerPose = { x: 0, y: 0, dir: 'down', moving: false, walkT: 0, walkDist: 0, carry: null, emote: null, emoteT: 0, id: 0 };
function _pushRender(n, y, kind, ref) {
  var item = _renderPool[n];
  if (!item) item = _renderPool[n] = { y: 0, k: 0, ref: null };
  item.y = y; item.k = kind; item.ref = ref;
  _renderList[n] = item;
  return n + 1;
}
function render(dt) {
  var c = ctx, t = now, i;
  if (groundDirty || !groundCanvas) rebuildGround();
  if (!walkGrid || _gridState !== S) buildWalk();
  ENV.night = nightAmt(); ENV.wind = Math.sin(t * 0.4) * 0.5 + Math.sin(t * 1.13 + 2) * 0.3;
  c.setTransform(1, 0, 0, 1, 0, 0); c.fillStyle = '#5d9d49'; c.fillRect(0, 0, canvas.width, canvas.height);
  applyCam(c);
  var v = viewRect(TILE * 3);
  drawGroundLayer(c);
  if (UI.mode === 'build') drawBuildGrid(c);
  // floor objects
  for (i = 0; i < S.objects.length; i++) { var fo = S.objects[i]; if (fo.done && CAT_BY_ID[fo.type].floor && inView(v, fo.x * TILE, fo.y * TILE, fo.w * TILE, fo.h * TILE)) drawObjectBase(c, fo, t); }
  drawAmbientGround(c, t, v);
  if (!UI.inTitle) {
    drawZones(c, t, v);
    if (UI.mode === 'play' && UI.touchTarget) {
      var tt = UI.touchTarget, tp = 0.5 + Math.sin(t * 8) * 0.3;
      c.strokeStyle = 'rgba(255,245,192,' + (0.55 + tp * 0.35) + ')'; c.lineWidth = 2.2;
      ell(c, tt.x, tt.y, 12 + tp * 4, 5 + tp * 1.6); c.stroke();
    }
  }
  for (i = 0; i < S.poops.length; i++) {
    var pp = S.poops[i];
    if (typeof drawPoop === 'function') { try { drawPoop(c, pp.x, pp.y, pp.age, t, pp.seed); continue; } catch (e) {} }
    c.fillStyle = '#6d4c41'; ell(c, pp.x, pp.y, 8, 4.5); c.fill(); ell(c, pp.x, pp.y - 4, 6, 3.6); c.fill();
  }
  // y-sorted things (1=prop, 2=obj, 3=dog, 4=owner, 5=npc, 6=player)
  var listN = 0, st = { night: ENV.night, wind: ENV.wind, dayFrac: dayFrac(), bellT: now - SHOPFX.bellT, registerT: now - SHOPFX.registerT, open: !S.closing };
  for (i = 0; i < worldProps.length; i++) { var wp = worldProps[i]; if (inView(v, wp.x, wp.y, wp.w, wp.h)) listN = _pushRender(listN, wp.sortY, 1, wp); }
  if (shopProps) for (i = 0; i < shopProps.length; i++) { var sp = shopProps[i]; if (inView(v, sp.x, sp.y, sp.w, sp.h)) listN = _pushRender(listN, sp.sortY, 1, sp); }
  for (i = 0; i < S.objects.length; i++) { var ob = S.objects[i]; if ((!ob.done || !CAT_BY_ID[ob.type].floor) && inView(v, ob.x * TILE - TILE, ob.y * TILE - TILE * 3, ob.w * TILE + TILE * 2, ob.h * TILE + TILE * 3)) listN = _pushRender(listN, (ob.y + ob.h) * TILE - 2, 2, ob); }
  for (i = 0; i < S.dogs.length; i++) { var dg = S.dogs[i]; if (inView(v, dg.x - 60, dg.y - 90, 120, 110)) listN = _pushRender(listN, dg.y, 3, dg); }
  for (i = 0; i < S.owners.length; i++) { var ow = S.owners[i]; if (inView(v, ow.x - 40, ow.y - 100, 80, 120)) listN = _pushRender(listN, ow.y, 4, ow); }
  if (typeof NPCS !== 'undefined') for (i = 0; i < NPCS.length; i++) { var np = NPCS[i]; if (inView(v, np.x - 40, np.y - 100, 80, 120)) listN = _pushRender(listN, np.y, 5, np); }
  if (!UI.inTitle && typeof MP !== 'undefined') {
    var rPeers = MP.getOnlinePeers();
    for (i = 0; i < rPeers.length; i++) {
      var rp = rPeers[i];
      if (rp.inGame !== false && inView(v, rp.x - 50, rp.y - 100, 100, 120)) listN = _pushRender(listN, rp.y + 0.4, 7, rp);
    }
  }
  listN = _pushRender(listN, S.player.y + 0.5, 6, null);
  _renderList.length = listN;
  _renderList.sort(function (a, b) { return a.y - b.y; });
  for (i = 0; i < listN; i++) {
    var e = _renderList[i], k = e.k, r = e.ref;
    if (k === 1) { try { r.draw(c, t, st); } catch (err) { if (!r.err) { r.err = 1; console.error('prop', err); } } }
    else if (k === 2) drawObjectBase(c, r, t);
    else if (k === 3) drawDogEntity(c, r, t);
    else if (k === 4) {
      var op = _ownerPose; op.x = r.x; op.y = r.y; op.dir = r.dir; op.moving = r.moving; op.walkT = r.walkT; op.walkDist = r.walkDist || 0;
      op.carry = ownerHoldsLeash(r) ? 'leash' : null; op.emote = r.angry ? 'angry' : r.emote; op.emoteT = r.emote ? r.emoteT : t; op.id = r.id;
      drawOwnerLeash(c, r, op); drawPersonEntity(c, op, t, r.look);
    }
    else if (k === 5) drawNpc(c, r, t);
    else if (k === 7) drawRemotePeer(c, r, t);
    else { drawLeash(c); drawPlayer(c, t); }
  }
  for (i = 0; i < S.objects.length; i++) { var o2 = S.objects[i], art = artOf(o2.type); if (o2.done && art && art.drawOver && CAT_BY_ID[o2.type].floor && inView(v, o2.x * TILE, o2.y * TILE, o2.w * TILE, o2.h * TILE)) { try { art.drawOver(c, artObj(o2), t, ENV); } catch (err) {} } }
  drawAmbientAir(c, t, v);
  if (UI.mode === 'play') drawDwellProgress(c, t);
  if (!UI.inTitle) {
    for (i = 0; i < S.owners.length; i++) { var ow2 = S.owners[i]; if (inView(v, ow2.x - 60, ow2.y - 140, 120, 160)) drawOwnerUI(c, ow2, t); }
    for (i = 0; i < S.dogs.length; i++) { var dg2 = S.dogs[i]; if (inView(v, dg2.x - 80, dg2.y - 120, 160, 160)) drawDogUI(c, dg2, t); }
  }
  drawFX(c);
  if (UI.mode === 'build') drawBuildGhost(c, t);
  drawLighting(c, t, v);
  // screen-space overlays
  c.setTransform(VIEW.dpr, 0, 0, VIEW.dpr, 0, 0);
  if (FX.flash > 0) { c.fillStyle = 'rgba(255,60,40,' + FX.flash * 0.3 + ')'; c.fillRect(0, 0, VIEW.w, VIEW.h); }
  if (UI.mode === 'play' || UI.mode === 'build') drawEdgeIndicators(c, t);
  if (UI.mode === 'play' && !UI.inTitle && UI.joy && UI.joy.active) {
    c.save();
    c.fillStyle = 'rgba(40,26,16,0.24)'; c.strokeStyle = 'rgba(255,248,230,0.75)'; c.lineWidth = 2.6;
    ell(c, UI.joy.ox, UI.joy.oy, 44, 44); c.fill(); c.stroke();
    c.fillStyle = 'rgba(255,248,230,0.92)'; c.strokeStyle = '#3b2a20'; c.lineWidth = 2.0;
    ell(c, UI.joy.cx, UI.joy.cy, 19, 19); c.fill(); c.stroke();
    c.restore();
  }
}

// ---------------- lighting ----------------
function collectLights(v) {
  var out = [];
  function add(arr) { if (!arr) return; for (var i = 0; i < arr.length; i++) { var l = arr[i]; if (l && inView(v, l.x - l.r, l.y - l.r, l.r * 2, l.r * 2)) out.push(l); } }
  if (!collectLights.stamp || collectLights.stamp !== groundStamp) {
    collectLights.stamp = groundStamp; collectLights.world = []; collectLights.shop = [];
    try { if (typeof worldLights === 'function') collectLights.world = worldLights(artEnv()) || []; } catch (e) {}
    try { if (typeof shopLights === 'function') collectLights.shop = shopLights() || []; } catch (e) {}
  }
  add(collectLights.world); add(collectLights.shop);
  S.objects.forEach(function (o) { var art = artOf(o.type); if (o.done && art && art.light) { try { add([art.light(artObj(o), ENV)]); } catch (e) {} } });
  return out;
}
var glowCache = {};
function glowSprite(rPx, color) {
  var r = clamp(Math.round(rPx / 16) * 16, 32, 128), key = r + color, g = glowCache[key];
  if (g) return g;
  g = document.createElement('canvas'); g.width = g.height = r * 2;
  var n = parseInt(color.slice(1), 16), rgb = ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255);
  var gc = g.getContext('2d'), gr = gc.createRadialGradient(r, r, 0, r, r, r);
  gr.addColorStop(0, 'rgba(' + rgb + ',0.62)'); gr.addColorStop(0.35, 'rgba(' + rgb + ',0.34)'); gr.addColorStop(0.7, 'rgba(' + rgb + ',0.1)'); gr.addColorStop(1, 'rgba(' + rgb + ',0)');
  gc.fillStyle = gr; gc.fillRect(0, 0, r * 2, r * 2);
  glowCache[key] = g; return g;
}
// Time-of-day tint is a plain DOM overlay (the browser blends it off the main thread); lamps get small pre-baked warm glows.
function drawLighting(c, t, v) {
  var f = dayFrac(), n = ENV.night;
  var morning = clamp(1 - f / 0.14, 0, 1) * 0.11, gold = clamp((f - 0.58) / 0.2, 0, 1) * (1 - clamp((f - 0.86) / 0.14, 0, 1) * 0.6) * 0.15, dark = n * 0.42;
  var al = morning + gold + dark, css = 'rgba(0, 0, 0, 0)';
  if (al > 0.012) {
    var r = (255 * morning + 255 * gold + 30 * dark) / al, g = (214 * morning + 160 * gold + 28 * dark) / al, b = (190 * morning + 70 * gold + 84 * dark) / al;
    css = 'rgba(' + Math.round(r / 6) * 6 + ',' + Math.round(g / 6) * 6 + ',' + Math.round(b / 6) * 6 + ',' + (Math.round(Math.min(0.6, al) * 50) / 50) + ')';
  }
  if (drawLighting.css !== css) { drawLighting.css = css; document.getElementById('tint').style.backgroundColor = css; }
  if (n > 0.12) {
    var lights = collectLights(v);
    if (lights.length > 9) { lights.sort(function (p, q) { return dist(p.x, p.y, CAM.x, CAM.y) - dist(q.x, q.y, CAM.x, CAM.y); }); lights.length = 9; }
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalAlpha = clamp(n * 1.9, 0, 1);
    for (var i = 0; i < lights.length; i++) {
      var l = lights[i], col = l.color || '#ffd890';
      if (col.charAt(0) !== '#' || col.length !== 7) col = '#ffd890';
      var sp = glowSprite(Math.min(l.r * CAMM.a * 0.8, 128), col);
      c.drawImage(sp, Math.round(l.x * CAMM.a + CAMM.e - sp.width / 2), Math.round(l.y * CAMM.a + CAMM.f - sp.height / 2));
    }
    c.globalAlpha = 1;
    reCam(c);
  }
}

// ---------------- off-screen indicators (full-width vertical iPhone viewport) ----------------
function drawEdgeIndicators(c, t) {
  var items = [];
  // Point to owners waiting at the counter (never point to pickup dogs in the yard — player must find the dog!)
  S.owners.forEach(function (o) {
    if (o.state === 'waitCheckin') items.push({ x: o.x, y: o.y - 40, icon: '🔔', col: '#fff1c9', urgent: o.patience / o.patienceMax < 0.3 });
    else if (o.state === 'waitPickup') items.push({ x: o.x, y: o.y - 40, icon: (S.player.carry && S.player.carry.id === o.dogId) ? '💰' : '🔔', col: (S.player.carry && S.player.carry.id === o.dogId) ? '#c8f7b0' : '#ffe082', urgent: o.patience / o.patienceMax < 0.3 });
  });
  S.dogs.forEach(function (d) { if (!d.checkedIn || !d.need || d.need.self || d.state === 'leaving' || d.state === 'leashed' || d.state === 'kennel' || d.need.t < 2) return; items.push({ x: d.x, y: d.y - 20, icon: NEED_INFO[d.need.type].icon, col: d.need.t > NEED_GRACE ? '#ffd9d4' : '#fffaf0', urgent: d.need.t > NEED_GRACE, small: true }); });
  var padX = 32, topY = 114, botY = VIEW.h - 88;
  items.forEach(function (it) {
    var s = worldToScreen(it.x, it.y);
    if (s.x > padX && s.x < VIEW.w - padX && s.y > topY && s.y < botY) return;
    var cx = VIEW.w / 2, cy = VIEW.h / 2, ang = Math.atan2(s.y - cy, s.x - cx);
    var ex = clamp(s.x, padX, VIEW.w - padX), ey = clamp(s.y, topY, botY);
    var r = it.small ? 15 : 19, pulse = 1 + (it.urgent ? Math.sin(t * 9) * 0.1 : Math.sin(t * 4) * 0.04);
    c.save(); c.translate(ex, ey); c.scale(pulse, pulse);
    c.fillStyle = it.col; c.strokeStyle = it.urgent ? '#d9574a' : OUTLINE; c.lineWidth = 2.2;
    c.save(); c.rotate(ang); c.beginPath(); c.moveTo(r + 10, 0); c.lineTo(r - 3, -8); c.lineTo(r - 3, 8); c.closePath(); c.fill(); c.stroke(); c.restore();
    ell(c, 0, 0, r, r); c.fill(); c.stroke();
    emoji(c, it.icon, 0, 1, it.small ? 14 : 18);
    c.restore();
  });
}

// ---------------- build overlays ----------------
function drawBuildGrid(c) {
  var v = viewRect(TILE);
  c.strokeStyle = 'rgba(255,255,255,0.16)'; c.lineWidth = 1;
  var x0 = Math.max(MAP.yard.x0, tileOf(v.x0)), x1 = Math.min(MAP.yard.x1, tileOf(v.x1)), y0 = Math.max(MAP.yard.y0, tileOf(v.y0)), y1 = Math.min(MAP.yard.y1, tileOf(v.y1));
  for (var y = y0; y <= y1; y++) for (var x = x0; x <= x1; x++) if (baseKind(x, y) === 'yard') c.strokeRect(x * TILE + .5, y * TILE + .5, TILE - 1, TILE - 1);
  PLOTS.forEach(function (p) {
    if (plotOwned(p)) return;
    var pend = plotPending(p), cx = (p.x + p.w / 2) * TILE, cy = (p.y + p.h / 2) * TILE;
    c.fillStyle = pend ? 'rgba(255,193,7,0.14)' : 'rgba(30,20,10,0.16)'; c.fillRect(p.x * TILE, p.y * TILE, p.w * TILE, p.h * TILE);
    c.strokeStyle = '#ffe082'; c.lineWidth = 2.5; c.setLineDash([10, 7]); c.strokeRect(p.x * TILE + 3, p.y * TILE + 3, p.w * TILE - 6, p.h * TILE - 6); c.setLineDash([]);
    var label = pend ? p.name + ' — clearing ' + fmtDur((pend.end - Date.now()) / 1000) : p.name + ' — ' + fmtMoney(p.cost) + (S.level < p.lvl ? '  (level ' + p.lvl + ')' : !plotAdjacent(p) ? '  (buy a neighbour first)' : '');
    bubble(c, cx, cy - 34, label, { size: 14, bg: '#4a3426', fg: '#ffe9a8', stroke: '#2a1a10' });
  });
}
function mouseWorld() { return screenToWorld(UI.mouse.sx, UI.mouse.sy); }
function drawBuildGhost(c, t) {
  if (UI.moveObj) {
    var mo = UI.moveObj, mc = CAT_BY_ID[mo.type];
    c.save();
    c.strokeStyle = '#80d8ff'; c.lineWidth = 3; c.setLineDash([7, 5]);
    rr(c, mo.x * TILE + 1, mo.y * TILE + 1, mo.w * TILE - 2, mo.h * TILE - 2, 8); c.stroke();
    c.setLineDash([]);
    bubble(c, (mo.x + mo.w / 2) * TILE, mo.y * TILE - 10, '↔️ Moving ' + (mc ? mc.name : 'item') + ' — tap new green spot', { size: 11.5, bg: '#1b4d6e', fg: '#e1f5fe', stroke: '#0d2b40' });
    c.restore();
  }
  var m = UI.mouse; if (!m.in) return;
  var mw = mouseWorld(), tx = tileOf(mw.x), ty = tileOf(mw.y);
  if (UI.moveObj) {
    var mo2 = UI.moveObj, mDef = CAT_BY_ID[mo2.type], mx = tx - Math.floor((mDef.w - 1) / 2), my = ty - Math.floor((mDef.h - 1) / 2);
    var mOk = canMoveObject(mo2, mx, my);
    c.fillStyle = mOk ? 'rgba(128,216,255,0.34)' : 'rgba(255,90,80,0.32)';
    rr(c, mx * TILE + 1, my * TILE + 1, mDef.w * TILE - 2, mDef.h * TILE - 2, 8); c.fill();
    c.strokeStyle = mOk ? '#80d8ff' : '#ff6b5a'; c.lineWidth = 2.5; c.stroke();
    c.globalAlpha = mOk ? 0.85 : 0.5;
    var mArt = artOf(mo2.type);
    if (mArt) { try { mArt.draw(c, { type: mo2.type, x: mx, y: my, w: mDef.w, h: mDef.h, id: mo2.id, occupied: false, useT: 99, label: null }, t, ENV); } catch (e) {} }
    c.globalAlpha = 1;
    return;
  }
  if (UI.buildSel) {
    var def = CAT_BY_ID[UI.buildSel], x = tx - Math.floor((def.w - 1) / 2), y = ty - Math.floor((def.h - 1) / 2);
    var site = objAt(tx, ty);
    if (site && !site.done) { siteHint(c, site); return; }
    var ok = canPlace(UI.buildSel, x, y) && S.cash >= def.cost && S.level >= def.lvl;
    c.fillStyle = ok ? 'rgba(120,240,150,0.32)' : 'rgba(255,90,80,0.32)'; rr(c, x * TILE + 1, y * TILE + 1, def.w * TILE - 2, def.h * TILE - 2, 8); c.fill();
    c.strokeStyle = ok ? '#8bf0a4' : '#ff6b5a'; c.lineWidth = 2.5; c.stroke();
    c.globalAlpha = ok ? 0.85 : 0.5;
    var art = artOf(UI.buildSel);
    if (art) { try { art.draw(c, { type: UI.buildSel, x: x, y: y, w: def.w, h: def.h, id: 7, occupied: false, useT: 99, label: null }, t, ENV); } catch (e) {} }
    c.globalAlpha = 1;
  } else {
    var o = objAt(tx, ty);
    if (o) {
      var sell = UI.buildTool === 'sell', mv = UI.buildTool === 'move';
      if (!sell && !mv && !o.done) { siteHint(c, o); return; }
      c.strokeStyle = sell ? '#ff6b5a' : mv ? '#80d8ff' : '#c3a6ff'; c.lineWidth = 3; rr(c, o.x * TILE + 1, o.y * TILE + 1, o.w * TILE - 2, o.h * TILE - 2, 8); c.stroke();
      var label = sell
        ? (canSell(o) ? 'Sell for ' + fmtMoney(sellValue(o)) : isLastEssential(o) ? 'Your only one — can\'t sell' : 'In use — can\'t sell')
        : mv
        ? ('↔️ Tap to pick up & move ' + CAT_BY_ID[o.type].name)
        : (CAT_BY_ID[o.type].name + ' Lv' + (o.lvl || 1) + ' · Tap to Move / Upgrade');
      bubble(c, (o.x + o.w / 2) * TILE, o.y * TILE - 10, label, { size: 11.5, bg: '#4a3426', fg: '#fff', stroke: '#2a1a10' });
    } else {
      var p = plotAt(tx, ty);
      if (p && !plotOwned(p) && !plotPending(p)) { c.strokeStyle = '#ffe082'; c.lineWidth = 5; c.strokeRect(p.x * TILE + 3, p.y * TILE + 3, p.w * TILE - 6, p.h * TILE - 6); }
    }
  }
}
function siteHint(c, o) {
  c.strokeStyle = '#ffe082'; c.lineWidth = 3; rr(c, o.x * TILE + 1, o.y * TILE + 1, o.w * TILE - 2, o.h * TILE - 2, 8); c.stroke();
  bubble(c, (o.x + o.w / 2) * TILE, o.y * TILE - 30, 'Tap: finish now for ' + fmtMoney(rushCost(o)), { size: 12, bg: '#4a3426', fg: '#fff', stroke: '#2a1a10' });
}

// ---------------- particles ----------------
function heart(c, x, y, s, col) {
  c.fillStyle = col; c.beginPath(); c.moveTo(x, y + s * 0.9); c.bezierCurveTo(x - s * 1.6, y - s * 0.2, x - s * 0.8, y - s * 1.3, x, y - s * 0.4); c.bezierCurveTo(x + s * 0.8, y - s * 1.3, x + s * 1.6, y - s * 0.2, x, y + s * 0.9); c.fill();
  c.strokeStyle = 'rgba(120,30,50,0.6)'; c.lineWidth = 1; c.stroke();
}
function star(c, x, y, r, rot, col) {
  c.fillStyle = col; c.beginPath();
  for (var i = 0; i < 10; i++) { var a = rot + i * Math.PI / 5, rr2 = i % 2 ? r * 0.45 : r; c.lineTo(x + Math.cos(a) * rr2, y + Math.sin(a) * rr2); }
  c.closePath(); c.fill(); c.strokeStyle = 'rgba(140,90,10,0.7)'; c.lineWidth = 1; c.stroke();
}
function burst(x, y, kind, n) {
  for (var i = 0; i < n; i++) {
    var a = Math.random() * Math.PI * 2, s = rand(24, 105);
    var p = { x: x, y: y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 46, life: rand(0.5, 1.1), kind: kind, size: rand(3, 6), grav: 90, rot: Math.random() * 6 };
    if (kind === 'heart') { p.vx *= 0.4; p.vy = rand(-80, -46); p.grav = -12; p.size = rand(5, 8); }
    if (kind === 'bubble') { p.vx *= 0.2; p.vy = rand(-46, -22); p.grav = -6; p.size = rand(3, 7); }
    if (kind === 'star') { p.grav = 40; p.size = rand(5, 8); }
    if (kind === 'sparkle') { p.grav = 30; p.size = rand(6, 12); }
    if (kind === 'splash') { p.vy = rand(-110, -60); p.grav = 300; p.size = rand(2, 4); }
    p.max = p.life; FX.parts.push(p);
  }
}
function confetti(x, y, n) {
  var cols = ['#d9574a', '#f2c14e', '#6fbf5a', '#66bde3', '#a58bd6', '#f2a0b5'];
  for (var i = 0; i < n; i++) { var a = rand(-Math.PI, 0), s = rand(140, 380); FX.parts.push({ x: x, y: y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(1, 1.9), max: 1.9, kind: 'conf', col: pick(cols), size: rand(4, 8), grav: 420, rot: Math.random() * 6 }); }
}
function coinFly(x, y, n) {
  for (var i = 0; i < n; i++) FX.parts.push({ x: x + rand(-14, 14), y: y + rand(-8, 8), vx: rand(-150, 150), vy: rand(-280, -150), life: 1.3 + i * 0.04, max: 1.3 + i * 0.04, kind: 'coin', size: 12, grav: 0, home: true, delay: 0.38 + i * 0.045, rot: Math.random() * 6 });
}
function float(x, y, text, col, scale) { FX.floats.push({ x: x, y: y, text: text, col: col || '#fff', life: 1.7, max: 1.7, scale: scale || 1 }); }
function updateFX(dt) {
  FX.shake = Math.max(0, FX.shake - dt); FX.flash = Math.max(0, FX.flash - dt);
  var home = UI.cashWorld || { x: CAM.x, y: CAM.y - 300 };
  var parts = FX.parts, pw = 0, i;
  for (i = 0; i < parts.length; i++) {
    var p = parts[i];
    p.life -= dt;
    if (p.home) {
      p.delay -= dt;
      if (p.delay < 0) { var dx = home.x - p.x, dy = home.y - p.y, d = Math.sqrt(dx * dx + dy * dy); if (d < 26) { UI.cashPulse = 0.3; sfx('tick'); continue; } p.vx += dx / d * 3400 * dt; p.vy += dy / d * 3400 * dt; p.vx *= 0.9; p.vy *= 0.9; }
      else { p.vy += 620 * dt; }
    } else p.vy += (p.grav || 0) * dt;
    p.x += p.vx * dt; p.y += p.vy * dt;
    if (p.life > 0 || (p.home && p.life > -2.5)) parts[pw++] = p;
  }
  parts.length = pw;
  if (parts.length > 700) parts.splice(0, parts.length - 700);
  var floats = FX.floats, fw = 0;
  for (i = 0; i < floats.length; i++) {
    var f = floats[i];
    f.life -= dt; f.y -= 30 * dt;
    if (f.life > 0) floats[fw++] = f;
  }
  floats.length = fw;
  updateAmbient(dt);
}
function drawFX(c) {
  FX.parts.forEach(function (p) {
    var a = clamp(p.life / p.max, 0, 1); c.globalAlpha = p.home ? 1 : Math.min(1, a * 1.6);
    switch (p.kind) {
      case 'heart': heart(c, p.x, p.y, p.size * (0.6 + a * 0.5), '#ff6b8a'); break;
      case 'star': star(c, p.x, p.y, p.size, p.rot + p.life * 3, '#ffd54a'); break;
      case 'sparkle': c.fillStyle = '#fffbe0'; c.save(); c.translate(p.x, p.y); c.rotate(p.life * 4); var s = p.size * a; c.beginPath(); c.moveTo(0, -s); c.quadraticCurveTo(0, 0, s, 0); c.quadraticCurveTo(0, 0, 0, s); c.quadraticCurveTo(0, 0, -s, 0); c.quadraticCurveTo(0, 0, 0, -s); c.fill(); c.restore(); break;
      case 'bubble': c.strokeStyle = 'rgba(255,255,255,0.9)'; c.lineWidth = 1.4; ell(c, p.x, p.y, p.size, p.size); c.stroke(); c.fillStyle = 'rgba(255,255,255,0.35)'; ell(c, p.x - p.size * 0.3, p.y - p.size * 0.3, p.size * 0.3, p.size * 0.3); c.fill(); break;
      case 'dust': c.fillStyle = 'rgba(200,175,135,0.7)'; ell(c, p.x, p.y, p.size * (1.6 - a), p.size * (1.6 - a)); c.fill(); break;
      case 'grass': c.strokeStyle = '#5d9d49'; c.lineWidth = 1.6; c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(p.x + Math.cos(p.rot || 0) * 4, p.y - 4); c.stroke(); break;
      case 'crumb': c.fillStyle = '#9a6b3f'; ell(c, p.x, p.y, 1.8, 1.8); c.fill(); break;
      case 'splash': c.fillStyle = '#cfeeff'; ell(c, p.x, p.y, p.size, p.size); c.fill(); break;
      case 'ball': c.fillStyle = '#d4e157'; ell(c, p.x, p.y, 6, 6); c.fill(); c.strokeStyle = OUTLINE; c.lineWidth = 1.4; c.stroke(); break;
      case 'z': c.font = Math.round(p.size * 1.3) + 'px ' + HEAD_FONT; c.textAlign = 'center'; c.textBaseline = 'middle'; outlined(c, 'z', p.x, p.y, '#e6f3ff', 'rgba(40,40,90,0.6)', 2.5); break;
      case 'conf': c.fillStyle = p.col; c.save(); c.translate(p.x, p.y); c.rotate(p.rot + p.life * 8); c.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2); c.restore(); break;
      case 'coin': var sq = Math.abs(Math.cos(p.rot + p.life * 9)); c.fillStyle = '#f2c14e'; ell(c, p.x, p.y, 7 * Math.max(0.25, sq), 7); c.fill(); c.strokeStyle = '#a8743f'; c.lineWidth = 1.8; c.stroke(); if (sq > 0.5) { c.fillStyle = '#a8743f'; c.font = '11px ' + HEAD_FONT; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('$', p.x, p.y + 0.5); } break;
    }
  });
  c.globalAlpha = 1;
  FX.floats.forEach(function (f) {
    var a = clamp(f.life / f.max * 1.6, 0, 1), pop = 1 + Math.max(0, (f.life - f.max + 0.2)) * 3;
    c.globalAlpha = a; c.font = Math.round(19 * f.scale * pop) + 'px ' + HEAD_FONT; c.textAlign = 'center'; c.textBaseline = 'middle';
    outlined(c, f.text, f.x, f.y, f.col, 'rgba(40,26,16,0.85)', 4);
  });
  c.globalAlpha = 1;
}

// ---------------- ambient life: butterflies, leaves, motes, fireflies, birds, cloud shadows ----------------
var AMB = { spots: null, flies: [], leaves: [], motes: [], fire: [], birds: [], clouds: [], t: 0 };
function ambSpots() {
  if (AMB.spots) return AMB.spots;
  var s = null; try { if (typeof worldAmbientSpots === 'function') s = worldAmbientSpots(); } catch (e) {}
  s = s || {};
  var yard = { x: MAP.yard.x0 * TILE, y: MAP.yard.y0 * TILE, w: (MAP.yard.x1 - MAP.yard.x0 + 1) * TILE, h: (MAP.yard.y1 - MAP.yard.y0 + 1) * TILE };
  if (!s.butterflies || !s.butterflies.length) s.butterflies = [yard];
  if (!s.fireflies || !s.fireflies.length) s.fireflies = [yard];
  if (!s.leaves) s.leaves = [];
  AMB.spots = s;
  for (var i = 0; i < 16; i++) { var r = pick(s.butterflies); AMB.flies.push({ x: r.x + Math.random() * r.w, y: r.y + Math.random() * r.h, a: Math.random() * 6.3, r: r, col: pick(['#f2c14e', '#f2a0b5', '#ffffff', '#a58bd6', '#ef8a3c', '#8fd3f4']), ph: Math.random() * 9, s: rand(0.8, 1.25) }); }
  for (var j = 0; j < 26; j++) { var fr = pick(s.fireflies); AMB.fire.push({ x: fr.x + Math.random() * fr.w, y: fr.y + Math.random() * fr.h, ph: Math.random() * 9, a: Math.random() * 6.3, r: fr }); }
  for (var k = 0; k < 5; k++) AMB.clouds.push({ x: Math.random() * W * TILE, y: Math.random() * H * TILE, rx: rand(220, 420), ry: rand(110, 190), v: rand(10, 20) });
  for (var m = 0; m < 34; m++) AMB.motes.push({ x: Math.random(), y: Math.random(), ph: Math.random() * 9, s: rand(0.6, 1.5) });
  return s;
}
function updateAmbient(dt) {
  var s = ambSpots(); AMB.t += dt;
  AMB.flies.forEach(function (b) {
    if (Math.abs(b.x - CAM.x) > 760 || Math.abs(b.y - CAM.y) > 520) { // too far to be seen: move it to a meadow spot near the camera
      var nx = CAM.x + rand(-620, 620), ny = CAM.y + rand(-420, 420), k = layoutKind(tileOf(nx), tileOf(ny));
      if ((k === 'yard' || k === 'scenery') && Math.abs(nx - CAM.x) > 330) { b.x = nx; b.y = ny; b.r = { x: nx - 170, y: ny - 110, w: 340, h: 220 }; }
    }
    b.a += (Math.random() - 0.5) * dt * 6; b.x += Math.cos(b.a) * 26 * dt; b.y += Math.sin(b.a) * 18 * dt + Math.sin(AMB.t * 5 + b.ph) * 0.3;
    if (b.x < b.r.x || b.x > b.r.x + b.r.w || b.y < b.r.y || b.y > b.r.y + b.r.h) b.a = Math.atan2(b.r.y + b.r.h / 2 - b.y, b.r.x + b.r.w / 2 - b.x);
  });
  AMB.fire.forEach(function (f) { f.a += (Math.random() - 0.5) * dt * 4; f.x += Math.cos(f.a) * 12 * dt; f.y += Math.sin(f.a) * 9 * dt; if (f.x < f.r.x || f.x > f.r.x + f.r.w || f.y < f.r.y || f.y > f.r.y + f.r.h) f.a = Math.atan2(f.r.y + f.r.h / 2 - f.y, f.r.x + f.r.w / 2 - f.x); });
  AMB.clouds.forEach(function (cl) { cl.x += cl.v * dt; if (cl.x - cl.rx > W * TILE) { cl.x = -cl.rx; cl.y = Math.random() * H * TILE; } });
  // falling leaves / petals
  if (!AMB.near || AMB.t - AMB.nearT > 2) { AMB.nearT = AMB.t; AMB.near = s.leaves.filter(function (q) { return Math.abs(q.x - CAM.x) < 700 && Math.abs(q.y - CAM.y) < 520; }); }
  if (AMB.near.length && AMB.leaves.length < 22 && Math.random() < dt * 1.8) { var l = pick(AMB.near); AMB.leaves.push({ x: l.x + rand(-30, 30), y: l.y + rand(-10, 20), gy: l.y + rand(70, 130), ph: Math.random() * 9, life: 7, col: pick(['#8fcf6a', '#c9d65a', '#f2c14e', '#f2a0b5', '#e58a4a']), s: rand(0.8, 1.3) }); }
  var lvs = AMB.leaves, lw = 0, li;
  for (li = 0; li < lvs.length; li++) {
    var lf = lvs[li]; lf.life -= dt;
    if (lf.y < lf.gy) { lf.y += 22 * dt; lf.x += (Math.sin(AMB.t * 2 + lf.ph) * 22 + ENV.wind * 30) * dt; }
    if (lf.life > 0) lvs[lw++] = lf;
  }
  lvs.length = lw;
  // a bird crossing now and then
  if (AMB.birds.length < 2 && Math.random() < dt * 0.06 && ENV.night < 0.3) { var dir = Math.random() < 0.5 ? 1 : -1; AMB.birds.push({ x: dir > 0 ? CAM.x - 900 : CAM.x + 900, y: CAM.y + rand(-300, 200), v: dir * rand(150, 210), ph: Math.random() * 9, vy: rand(-14, 14) }); }
  var brds = AMB.birds, bw = 0;
  for (li = 0; li < brds.length; li++) {
    var bd = brds[li]; bd.x += bd.v * dt; bd.y += bd.vy * dt;
    if (Math.abs(bd.x - CAM.x) < 1500) brds[bw++] = bd;
  }
  brds.length = bw;
}
function drawAmbientGround(c, t, v) {
  ambSpots();
  var day = 1 - ENV.night;
  AMB.leaves.forEach(function (l) { if (l.y >= l.gy) { c.globalAlpha = clamp(l.life / 2, 0, 0.9); leaf(c, l.x, l.y, l.ph, l.col, l.s); } });
  c.globalAlpha = 1;
  AMB.birds.forEach(function (b) { if (overShop(b.x + 30, b.y + 150)) return; c.fillStyle = 'rgba(30,20,10,0.13)'; ell(c, b.x + 30, b.y + 150, 9, 4); c.fill(); });
}
function overShop(x, y) { var s = MAP.shop; return x > (s.x0 - 1) * TILE && x < (s.x1 + 2) * TILE && y > (s.y0 - 4) * TILE && y < (s.y1 + 1) * TILE; }
function leaf(c, x, y, rot, col, s) { c.save(); c.translate(x, y); c.rotate(rot); c.scale(s, s); c.fillStyle = col; c.beginPath(); c.moveTo(-4, 0); c.quadraticCurveTo(0, -4, 4, 0); c.quadraticCurveTo(0, 4, -4, 0); c.fill(); c.restore(); }
function drawAmbientAir(c, t, v) {
  var day = 1 - clamp(ENV.night * 1.6, 0, 1);
  AMB.leaves.forEach(function (l) { if (l.y < l.gy && inView(v, l.x - 8, l.y - 8, 16, 16)) { c.globalAlpha = 0.95; leaf(c, l.x, l.y, Math.sin(t * 3 + l.ph) * 1.2, l.col, l.s); } });
  c.globalAlpha = 1;
  if (day > 0.05) AMB.flies.forEach(function (b) {
    if (!inView(v, b.x - 10, b.y - 30, 20, 40)) return;
    var flap = Math.abs(Math.sin(t * 14 + b.ph)), yy = b.y - 16 + Math.sin(t * 3 + b.ph) * 4;
    c.globalAlpha = day; c.fillStyle = 'rgba(40,26,12,0.12)'; ell(c, b.x, b.y + 6, 3.5, 1.5); c.fill();
    c.fillStyle = b.col; c.strokeStyle = 'rgba(59,42,32,0.7)'; c.lineWidth = 0.8;
    ell(c, b.x - 3.2 * flap * b.s, yy - 1, 3.6 * flap * b.s + 0.5, 3.4 * b.s); c.fill(); c.stroke(); ell(c, b.x + 3.2 * flap * b.s, yy - 1, 3.6 * flap * b.s + 0.5, 3.4 * b.s); c.fill(); c.stroke();
    c.fillStyle = '#3b2a20'; ell(c, b.x, yy, 0.9, 3); c.fill();
  });
  c.globalAlpha = 1;
  AMB.birds.forEach(function (b) {
    if (overShop(b.x, b.y)) return;
    var flap = Math.sin(t * 12 + b.ph), d = b.v > 0 ? 1 : -1;
    c.save(); c.translate(b.x, b.y); c.scale(d, 1);
    c.fillStyle = '#5b4a3f'; c.strokeStyle = OUTLINE; c.lineWidth = 1.2;
    ell(c, 0, 0, 8, 4.5); c.fill(); c.stroke(); ell(c, 7, -2, 3.6, 3.4); c.fill(); c.stroke();
    c.fillStyle = '#f2c14e'; c.beginPath(); c.moveTo(10, -2); c.lineTo(14, -1); c.lineTo(10, 0); c.fill();
    c.fillStyle = '#7a6555'; c.beginPath(); c.moveTo(-3, -1); c.lineTo(1, -1 - 11 * flap); c.lineTo(5, -1); c.closePath(); c.fill(); c.stroke();
    c.restore();
  });
  // sun motes drifting (screen-anchored but drawn in world space so they parallax gently)
  if (day > 0.1) {
    c.fillStyle = '#fff8d8';
    AMB.motes.forEach(function (m) {
      var x = v.x0 + ((m.x * (v.x1 - v.x0) + t * 9 * m.s + CAM.x * 0.15) % (v.x1 - v.x0) + (v.x1 - v.x0)) % (v.x1 - v.x0), y = v.y0 + ((m.y * (v.y1 - v.y0) + Math.sin(t * 0.7 + m.ph) * 24 - t * 3 * m.s + CAM.y * 0.15) % (v.y1 - v.y0) + (v.y1 - v.y0)) % (v.y1 - v.y0);
      c.globalAlpha = (0.18 + Math.sin(t * 1.7 + m.ph) * 0.14) * day; ell(c, x, y, 1.3 * m.s, 1.3 * m.s); c.fill();
    });
    c.globalAlpha = 1;
  }
  if (ENV.night > 0.25) {
    c.globalCompositeOperation = 'lighter';
    AMB.fire.forEach(function (f) {
      if (!inView(v, f.x - 12, f.y - 40, 24, 50)) return;
      var a = clamp(Math.sin(t * 2.2 + f.ph) * 0.7 + 0.3, 0, 1) * clamp((ENV.night - 0.25) * 3, 0, 1), yy = f.y - 18 + Math.sin(t * 1.3 + f.ph) * 6;
      c.globalAlpha = a * 0.35; c.fillStyle = '#e9ff8a'; ell(c, f.x, yy, 7, 7); c.fill(); c.globalAlpha = a; c.fillStyle = '#f7ffc8'; ell(c, f.x, yy, 1.8, 1.8); c.fill();
    });
    c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
  }
}

// ---------------- minimap ----------------
var miniBase = null;
function drawMinimap(mc) {
  if (!mc) return;
  var c = mc.getContext('2d'), sw = mc.width, sh = mc.height, k = sw / (W * TILE);
  if (!miniBase || UI.miniDirty) {
    miniBase = miniBase || document.createElement('canvas'); miniBase.width = sw; miniBase.height = sh;
    var bc = miniBase.getContext('2d');
    if (groundCanvas) bc.drawImage(groundCanvas, 0, 0, sw, sh);
    bc.fillStyle = 'rgba(255,250,235,0.10)'; bc.fillRect(0, 0, sw, sh);
    UI.miniDirty = false;
  }
  c.clearRect(0, 0, sw, sh); c.drawImage(miniBase, 0, 0);
  S.objects.forEach(function (o) { c.fillStyle = !o.done ? '#f2c14e' : CAT_BY_ID[o.type].floor ? 'rgba(255,240,200,0.75)' : '#7a4e2a'; c.fillRect(o.x * TILE * k, o.y * TILE * k, Math.max(2, o.w * TILE * k), Math.max(2, o.h * TILE * k)); });
  S.poops.forEach(function (p) { c.fillStyle = '#5a3a22'; c.fillRect(p.x * k - 1, p.y * k - 1, 2, 2); });
  S.dogs.forEach(function (d) { if (d.state === 'leaving') return; var h = d.happy; c.fillStyle = h > 70 ? '#8bf06e' : h > 40 ? '#ffd54a' : '#ff6b5a'; c.strokeStyle = '#2a1a10'; c.lineWidth = 1; c.beginPath(); c.arc(d.x * k, d.y * k, 3, 0, 6.3); c.fill(); c.stroke(); });
  S.owners.forEach(function (o) { var wait = o.state === 'waitCheckin' || o.state === 'waitPickup'; c.fillStyle = wait ? ((Math.sin(now * 8) > 0) ? '#fff' : '#ffb300') : '#d8c8ff'; c.beginPath(); c.arc(o.x * k, o.y * k, wait ? 3.5 : 2.5, 0, 6.3); c.fill(); c.strokeStyle = '#2a1a10'; c.stroke(); });
  var P = S.player; c.fillStyle = '#3aa89a'; c.strokeStyle = '#fff'; c.lineWidth = 1.6; c.beginPath(); c.arc(P.x * k, P.y * k, 4, 0, 6.3); c.fill(); c.stroke();
  if (typeof MP !== 'undefined') {
    MP.getOnlinePeers().forEach(function (rp) {
      if (rp.inGame === false) return;
      c.fillStyle = '#ff6b8a'; c.strokeStyle = '#fff'; c.lineWidth = 1.6;
      c.beginPath(); c.arc(rp.x * k, rp.y * k, 4, 0, 6.3); c.fill(); c.stroke();
    });
  }
  var v = viewRect(0); c.strokeStyle = 'rgba(255,255,255,0.85)'; c.lineWidth = 1.2; c.strokeRect(v.x0 * k, v.y0 * k, (v.x1 - v.x0) * k, (v.y1 - v.y0) * k);
}
