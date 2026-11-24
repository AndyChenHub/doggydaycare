'use strict';
// ================= utilities =================
function rand(a, b) { return a + Math.random() * (b - a); }
function randi(a, b) { return Math.floor(rand(a, b + 1)); }
function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function lerp(a, b, f) { return a + (b - a) * f; }
function dist(ax, ay, bx, by) { var dx = ax - bx, dy = ay - by; return Math.sqrt(dx * dx + dy * dy); }
function fmtMoney(n) { return '$' + Math.floor(n).toLocaleString(); }
function fmtDur(sec) {
  sec = Math.max(0, Math.ceil(sec));
  var m = Math.floor(sec / 60), s = sec % 60;
  if (m >= 60) { var h = Math.floor(m / 60); return h + 'h ' + (m % 60) + 'm'; }
  return m > 0 ? (m + ':' + (s < 10 ? '0' : '') + s) : (s + 's');
}
function tileOf(px) { return Math.floor(px / TILE); }
function hasTrait(d, t) { return d.traits.indexOf(t) >= 0; }
function upLvl(id) { var v = S && S.upgrades && S.upgrades[id]; return v === true ? 1 : (typeof v === 'number' && v > 0 ? Math.floor(v) : 0); }
function hasUp(id) { return upLvl(id) > 0; }
function upgCost(u) { var lv = upLvl(u.id); return Math.round(u.cost * Math.pow(1.75, lv)); }
function upgReqLvl(u) { var lv = upLvl(u.id); return u.lvl + lv * 2; }
function stationLvl(type) {
  if (!S || !S.objects) return 1;
  var best = 1;
  for (var i = 0; i < S.objects.length; i++) {
    var o = S.objects[i];
    if (o.done && o.type === type && (o.lvl || 1) > best) best = o.lvl || 1;
  }
  return best;
}

// ================= settings & storage helpers =================
var SETTINGS_KEY = 'pawsPlaySettings_v1', SAVE_KEY = 'pawsPlaySave_v2', BACKUP_SAVE_KEY = 'pawsPlaySave_backup';
var OLD_SAVE_KEY = 'pawsPlaySave_v1', OLD_DONE_KEY = 'pawsPlayImportedV1'; // the first version's save is imported once, then left alone
var LEGACY_SAVE_KEYS = ['pawsPlaySave_v3', 'pawsPlaySave'];
var ACTIVE_SESSION_KEY = 'pawsPlayActiveSession_v1';
var _memStorage = {};

function _nativePost(payload) {
  try {
    if (typeof window !== 'undefined' && window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.pawsStorage) {
      window.webkit.messageHandlers.pawsStorage.postMessage(payload);
    }
  } catch (e) {}
}

function _idbSave(key, val) {
  try {
    if (typeof indexedDB === 'undefined' || !indexedDB) return;
    var req = indexedDB.open('pawsPlayDB', 1);
    req.onupgradeneeded = function () {
      try { req.result.createObjectStore('kv'); } catch (e) {}
    };
    req.onsuccess = function () {
      try {
        var db = req.result, tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').put(val, key);
      } catch (e) {}
    };
  } catch (e) {}
}

function _readWindowNameStore() {
  try {
    if (typeof window !== 'undefined' && typeof window.name === 'string' && window.name.indexOf('__PAWS_STORE__:') === 0) {
      return JSON.parse(window.name.slice(15)) || {};
    }
  } catch (e) {}
  return {};
}

function _writeWindowNameKey(key, val) {
  try {
    if (typeof window === 'undefined') return;
    var obj = _readWindowNameStore();
    if (val === null) delete obj[key];
    else obj[key] = val;
    window.name = '__PAWS_STORE__:' + JSON.stringify(obj);
  } catch (e) {}
}

function _storageGet(key) {
  var val = null;
  try { val = localStorage.getItem(key); } catch (e) {}
  if (val) return val;
  try {
    if (typeof window !== 'undefined' && window.__PAWS_NATIVE_STORAGE__ && typeof window.__PAWS_NATIVE_STORAGE__[key] === 'string') {
      val = window.__PAWS_NATIVE_STORAGE__[key];
      try { localStorage.setItem(key, val); } catch (e2) {}
      return val;
    }
  } catch (e) {}
  var wn = _readWindowNameStore();
  if (typeof wn[key] === 'string' && wn[key]) {
    try { localStorage.setItem(key, wn[key]); } catch (e) {}
    return wn[key];
  }
  return _memStorage[key] || null;
}

function _storageSet(key, val) {
  var str = String(val);
  _memStorage[key] = str;
  try { localStorage.setItem(key, str); } catch (e) {}
  try {
    if (typeof window !== 'undefined' && window.__PAWS_NATIVE_STORAGE__) {
      window.__PAWS_NATIVE_STORAGE__[key] = str;
    }
  } catch (e) {}
  _writeWindowNameKey(key, str);
  _nativePost({ key: key, value: str });
  _idbSave(key, str);
}

function _storageRemove(key) {
  delete _memStorage[key];
  try { localStorage.removeItem(key); } catch (e) {}
  try {
    if (typeof window !== 'undefined' && window.__PAWS_NATIVE_STORAGE__) {
      delete window.__PAWS_NATIVE_STORAGE__[key];
    }
  } catch (e) {}
  _writeWindowNameKey(key, null);
  _nativePost({ remove: [key] });
}

function _parseSaveJSON(raw) {
  if (!raw || typeof raw !== 'string') return null;
  try {
    var obj = JSON.parse(raw);
    if (obj && typeof obj === 'object' && (typeof obj.day === 'number' || typeof obj.cash === 'number' || Array.isArray(obj.objects) || obj.version)) {
      return obj;
    }
  } catch (e) {}
  return null;
}

function _findBestRawSave() {
  var primary = _parseSaveJSON(_storageGet(SAVE_KEY));
  var backup = _parseSaveJSON(_storageGet(BACKUP_SAVE_KEY));
  if (primary && backup) {
    var pTs = primary.savedAt || primary.created || 0;
    var bTs = backup.savedAt || backup.created || 0;
    return bTs > pTs ? { state: backup, key: BACKUP_SAVE_KEY } : { state: primary, key: SAVE_KEY };
  }
  if (primary) return { state: primary, key: SAVE_KEY };
  if (backup) return { state: backup, key: BACKUP_SAVE_KEY };
  for (var i = 0; i < LEGACY_SAVE_KEYS.length; i++) {
    var leg = _parseSaveJSON(_storageGet(LEGACY_SAVE_KEYS[i]));
    if (leg) return { state: leg, key: LEGACY_SAVE_KEYS[i] };
  }
  if (!_storageGet(OLD_DONE_KEY)) {
    var old = _parseSaveJSON(_storageGet(OLD_SAVE_KEY));
    if (old) return { state: old, key: OLD_SAVE_KEY, isV1: true };
  }
  return null;
}

function hasSave() {
  try {
    if (typeof MP !== 'undefined' && MP.hasRemoteSave) return true;
    return !!_findBestRawSave();
  } catch (e) { return false; }
}

function peekSavedLook() {
  try {
    var found = _findBestRawSave();
    if (found && found.state && found.state.player && typeof found.state.player.look === 'number') {
      return clamp(Math.floor(found.state.player.look), 0, 3);
    }
  } catch (e) {}
  return null;
}

function defaultSettings() {
  var c = window.GAME_CONFIG || {};
  return { dayLength: c.dayLengthSeconds || 300, difficulty: c.difficulty || 'normal',
           musicVol: c.musicVolume != null ? c.musicVolume : 0.5, ambVol: c.ambienceVolume != null ? c.ambienceVolume : 0.5,
           sfxVol: c.sfxVolume != null ? c.sfxVolume : 0.8, zoom: c.cameraZoom || 1, standSec: c.standSeconds || 0.55 };
}
function sanitizeSettings(s) {
  var def = defaultSettings();
  if (!s || typeof s !== 'object') return def;
  s.dayLength = (typeof s.dayLength === 'number' && isFinite(s.dayLength) && s.dayLength >= 60) ? s.dayLength : def.dayLength;
  s.difficulty = (s.difficulty && DIFFICULTY[s.difficulty]) ? s.difficulty : def.difficulty;
  s.musicVol = (typeof s.musicVol === 'number' && isFinite(s.musicVol)) ? clamp(s.musicVol, 0, 1) : def.musicVol;
  s.ambVol = (typeof s.ambVol === 'number' && isFinite(s.ambVol)) ? clamp(s.ambVol, 0, 1) : def.ambVol;
  s.sfxVol = (typeof s.sfxVol === 'number' && isFinite(s.sfxVol)) ? clamp(s.sfxVol, 0, 1) : def.sfxVol;
  s.zoom = (typeof s.zoom === 'number' && isFinite(s.zoom)) ? clamp(s.zoom, 0.7, 1.4) : def.zoom;
  s.standSec = (typeof s.standSec === 'number' && isFinite(s.standSec) && s.standSec >= 0.35) ? clamp(s.standSec, 0.35, 1.5) : def.standSec;
  delete s.keys;
  return s;
}
var settings = defaultSettings();
try {
  var ss = JSON.parse(_storageGet(SETTINGS_KEY) || 'null');
  if (ss && typeof ss === 'object') {
    for (var k in ss) if (k in settings) settings[k] = ss[k];
    settings = sanitizeSettings(settings);
  }
} catch (e) { settings = defaultSettings(); }
function saveSettings() { settings = sanitizeSettings(settings); try { _storageSet(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) {} applyVolumes(); }
function applyVolumes() { if (typeof setVolumes === 'function') { try { setVolumes({ sfx: settings.sfxVol, music: settings.musicVol, ambience: settings.ambVol }); } catch (e) {} } }
function diff() { return DIFFICULTY[settings.difficulty] || DIFFICULTY.normal; }
function dayLen() { return settings.dayLength || 300; }

// ================= state =================
var S = null;
var FX = { parts: [], floats: [], shake: 0, flash: 0 };
var SHOPFX = { bellT: -99, registerT: -99 };
var walkGrid = null;       // Uint8Array: 1 = dogs can walk
var groundDirty = true;
var now = 0;               // animation clock, seconds
var COLLARS = ['#d9574a', '#3aa89a', '#f2c14e', '#5b8def', '#e07bb0', '#8e6bd6', '#ef8a3c', '#58b368'];

function newState() {
  var s = {
    version: 2, cash: window.GAME_CONFIG.startingCash, xp: 0, level: 1, rep: 3.0, day: 1, dayTime: 0, closing: false,
    objects: [], plots: [{ id: 'base', end: 0 }], dogs: [], owners: [], poops: [], chores: [], choreT: 4, nextId: 1, arrivalTimer: 5,
    stats: newStats(3), streak: 0, bestStreak: 0, totalServed: 0, tutorial: {}, tutorialDone: false,
    upgrades: {}, dex: {}, goals: [], life: { earned: 0, served: 0, perfect: 0, complaints: 0 }, staff: {}, specials: {}, playDays: 0, giftStreak: 0, lastPlayDate: null,
    player: { x: 12.6 * TILE, y: 24.3 * TILE, dir: 'left', face: -1, carry: null, moving: false, walkT: 0, walkDist: 0, emote: null, emoteT: 0, look: 0, stepT: 0 }, needT: 6, poopT: 30,
    created: Date.now(),
  };
  S = s; groundDirty = true; NPCS = [];
  // Empty land at startup — spawn the very first customer & dog right at the entrance and guide the player step by step!
  spawnArrival();
  if (s.owners[0]) {
    var o0 = s.owners[0], d0 = dogById(o0.dogId);
    o0.x = DOOR_X; o0.y = (MAP.shop.streetDoor.y + 0.3) * TILE;
    o0.route = [[DOOR_X, 31.3 * TILE], [QUEUE[o0.slot][0] * TILE, QUEUE[o0.slot][1] * TILE]];
    if (d0) { d0.x = o0.x + 18; d0.y = o0.y + 6; }
  }
  return s;
}
function newStats(rep) { return { earned: 0, tips: 0, served: 0, complaints: 0, perfect: 0, repStart: rep, spent: 0, complaintList: [], pets: 0, scoops: 0, baths: 0, feeds: 0, fetches: 0, goalCash: 0, wages: 0 }; }
function nid() { return S.nextId++; }

function addObject(type, x, y, instant) {
  var c = CAT_BY_ID[type];
  var dur = (!S.tutorialDone && !instant) ? Math.min(c.time, 2.5) : c.time;
  var o = { id: nid(), type: type, x: x, y: y, w: c.w, h: c.h, lvl: 1, upgrading: false, done: !!instant, buildEnd: instant ? 0 : Date.now() + dur * 1000,
            buildDur: dur, dogId: null, reservedFor: null, useAt: -99 };
  S.objects.push(o);
  markDirty();
  return o;
}
// land: true = repaint all the ground, or a plot = repaint just that rectangle
function markDirty(land) {
  walkGrid = null;
  if (land === true) groundDirty = true;
  else if (land && groundDirty !== true) { var r = { x: (land.x - 1) * TILE, y: (land.y - 1) * TILE, w: (land.w + 2) * TILE, h: (land.h + 2) * TILE }; groundDirty = groundDirty ? true : r; }
}

// ================= map =================
var PLOT_GRID = (function () {
  var g = new Array(W * H);
  for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) {
    var found = null;
    for (var i = 0; i < PLOTS.length; i++) { var p = PLOTS[i]; if (x >= p.x && x < p.x + p.w && y >= p.y && y < p.y + p.h) { found = p; break; } }
    g[y * W + x] = found;
  }
  return g;
})();
var _gridState = null, objGrid = null, baseGrid = null, _capCache = 4, _charmCache = 0, walkStamp = 0;
var _bfsPrev = new Int32Array(W * H), _bfsDist = new Int16Array(W * H), _bfsQ = new Int32Array(W * H);
var _floodSeen = new Uint8Array(W * H), _floodGrid = new Uint8Array(W * H), _floodQ = new Int32Array(W * H);

function plotOwned(p) { for (var i = 0; i < S.plots.length; i++) if (S.plots[i].id === p.id && Date.now() >= S.plots[i].end) return true; return false; }
function plotPending(p) { for (var i = 0; i < S.plots.length; i++) if (S.plots[i].id === p.id && Date.now() < S.plots[i].end) return S.plots[i]; return null; }
function plotAt(tx, ty) { if (tx < 0 || ty < 0 || tx >= W || ty >= H) return null; return PLOT_GRID[ty * W + tx]; }
function unlocked(tx, ty) { var p = plotAt(tx, ty); return !!(p && plotOwned(p)); }
function pendingAt(tx, ty) { var p = plotAt(tx, ty); return !!(p && plotPending(p)); }
// tile kind including land ownership
function baseKind(tx, ty) {
  if (tx < 0 || ty < 0 || tx >= W || ty >= H) return 'void';
  if (!walkGrid || _gridState !== S) buildWalk();
  return baseGrid[ty * W + tx];
}
function objAt(tx, ty) {
  if (tx < 0 || ty < 0 || tx >= W || ty >= H) return null;
  if (!walkGrid || _gridState !== S) buildWalk();
  return objGrid[ty * W + tx];
}
function objSolid(o) { return !o.done || !CAT_BY_ID[o.type].floor; }
var WALK_KINDS = { yard: 1, shopfloor: 1, door: 1, sidewalk: 1 };
function solidForPlayer(tx, ty) {
  if (!WALK_KINDS[baseKind(tx, ty)]) return true;
  var o = objAt(tx, ty);
  return !!(o && objSolid(o));
}
function starBaseCap(rep, dayNum) {
  if (rep < 1.6) return 1;
  if (rep < 2.8) return 2;
  if (rep < 3.35) return (dayNum <= 1 ? 2 : 3);
  if (rep < 3.9) return 4;
  if (rep < 4.4) return 5;
  if (rep < 4.85) return 6;
  return 7;
}
function boostRep(amt, px, py) {
  if (!S || !(amt > 0)) return;
  var oldCap = capacity();
  // Comeback boost: when star rating is below 3.0★, every positive care/chore action gives 1.75x star recovery!
  var mul = S.rep < 2.2 ? 2.0 : S.rep < 3.0 ? 1.65 : 1.0;
  var gain = amt * mul;
  var prev = S.rep;
  S.rep = clamp(S.rep + gain, 0.5, 5.0);
  if (Math.floor(S.rep * 10) !== Math.floor(prev * 10)) markDirty();
  var newCap = capacity();
  if (px != null && py != null && S.rep > prev) {
    float(px, py, '+' + gain.toFixed(2) + '★', '#ffd54a', 1.05);
  }
  if (newCap > oldCap) {
    toast('⭐ Star Rating rose to ' + S.rep.toFixed(1) + '★ — up to ' + newCap + ' dogs will now visit!', 'good');
  }
}
function buildWalk() {
  var N = W * H;
  if (!walkGrid) walkGrid = new Uint8Array(N);
  if (!objGrid) objGrid = new Array(N);
  if (!baseGrid) baseGrid = new Array(N);
  _gridState = S; walkStamp++;
  for (var i = 0; i < N; i++) objGrid[i] = null;
  var dNum = S ? (S.day || 1) : 1, repVal = S && typeof S.rep === 'number' ? S.rep : 3.0;
  var baseCap = starBaseCap(repVal, dNum);
  var bonusCap = 0, ch = 0, objs = S ? S.objects : [];
  for (var oi = 0; oi < objs.length; oi++) {
    var o = objs[oi], def = CAT_BY_ID[o.type], olv = o.lvl || 1;
    if (o.done && def) {
      if (def.cap) bonusCap += def.cap + Math.floor((olv - 1) / 2);
      if (def.charm) ch += def.charm * (1 + (olv - 1) * 0.6);
      else if (olv > 1) ch += (olv - 1) * 1.5;
    }
    for (var oy = o.y; oy < o.y + o.h; oy++) for (var ox = o.x; ox < o.x + o.w; ox++) {
      if (ox >= 0 && oy >= 0 && ox < W && oy < H) objGrid[oy * W + ox] = o;
    }
  }
  // Star rating also scales how much of your facility capacity owners will fill
  var starMul = repVal < 1.6 ? 0.35 : repVal < 2.4 ? 0.6 : repVal < 2.9 ? 0.8 : (1 + Math.max(0, repVal - 3.5) * 0.2);
  var cap = Math.max(1, Math.round((baseCap + bonusCap) * starMul));
  _capCache = cap; _charmCache = Math.floor(ch);
  var ownedPlots = {};
  if (S && S.plots) {
    var nowMs = Date.now();
    for (var pi = 0; pi < S.plots.length; pi++) if (nowMs >= S.plots[pi].end) ownedPlots[S.plots[pi].id] = 1;
  }
  for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) {
    var idx = y * W + x, k = layoutKind(x, y);
    if (k === 'yard') { var pl = PLOT_GRID[idx]; k = (pl && ownedPlots[pl.id]) ? 'yard' : 'locked'; }
    baseGrid[idx] = k;
    var ok = k === 'yard';
    if (ok) { var ob = objGrid[idx]; if (ob && objSolid(ob)) ok = false; }
    walkGrid[idx] = ok ? 1 : 0;
  }
}
function dogWalkable(tx, ty) { if (!walkGrid || _gridState !== S) buildWalk(); if (tx < 0 || ty < 0 || tx >= W || ty >= H) return false; return walkGrid[ty * W + tx] === 1; }
// BFS from a tile; returns {prev, dist}
function bfs(sx, sy) {
  if (!walkGrid || _gridState !== S) buildWalk();
  var prev = _bfsPrev, d = _bfsDist, q = _bfsQ, qh = 0, qt = 0;
  prev.fill(-1); d.fill(-1);
  if (sx < 0 || sy < 0 || sx >= W || sy >= H) return { prev: prev, dist: d };
  var s = sy * W + sx; d[s] = 0; q[qt++] = s;
  while (qh < qt) {
    var c = q[qh++], cx = c % W, cy = (c / W) | 0, nd = d[c] + 1;
    if (cx + 1 < W) { var n0 = c + 1; if (d[n0] < 0 && walkGrid[n0] === 1) { d[n0] = nd; prev[n0] = c; q[qt++] = n0; } }
    if (cx > 0)     { var n1 = c - 1; if (d[n1] < 0 && walkGrid[n1] === 1) { d[n1] = nd; prev[n1] = c; q[qt++] = n1; } }
    if (cy + 1 < H) { var n2 = c + W; if (d[n2] < 0 && walkGrid[n2] === 1) { d[n2] = nd; prev[n2] = c; q[qt++] = n2; } }
    if (cy > 0)     { var n3 = c - W; if (d[n3] < 0 && walkGrid[n3] === 1) { d[n3] = nd; prev[n3] = c; q[qt++] = n3; } }
  }
  return { prev: prev, dist: d };
}
function pathTo(b, tx, ty) {
  var n = ty * W + tx; if (b.dist[n] < 0) return null;
  var out = []; while (b.dist[n] > 0) { out.push([n % W, (n / W) | 0]); n = b.prev[n]; }
  return out.reverse();
}
function nearestWalkable(px, py) {
  var tx = tileOf(px), ty = tileOf(py);
  if (dogWalkable(tx, ty)) return [tx, ty];
  for (var r = 1; r < 60; r++) {
    var best = null, bd = 1e9;
    for (var y = ty - r; y <= ty + r; y++) for (var x = tx - r; x <= tx + r; x++) {
      if (Math.max(Math.abs(x - tx), Math.abs(y - ty)) !== r) continue;
      if (dogWalkable(x, y)) { var dd = dist(px, py, (x + .5) * TILE, (y + .5) * TILE); if (dd < bd) { bd = dd; best = [x, y]; } }
    }
    if (best) return best;
  }
  return YARD_ENTRY.slice();
}

// ================= derived stats =================
function capacity() {
  if (!walkGrid || _gridState !== S) buildWalk();
  return _capCache;
}
function charm() {
  if (!walkGrid || _gridState !== S) buildWalk();
  return _charmCache;
}
function happiness(d) { return d.happy == null ? 75 : d.happy; }
// What a dog can ask for. Dogs are fine on their own; now and then one of them needs you (never more than a few at once).
var NEED_INFO = {
  food:  { icon: '🍖', says: 'is hungry',       item: 'food',  wantText: 'wants food — grab a bowl at the Food Bin', complaint: 'was starving' },
  treat: { icon: '🍪', says: 'wants a treat',   item: 'treat', wantText: 'wants a treat — get one from the Treat Jar', complaint: 'never got a treat' },
  play:  { icon: '🎾', says: 'wants to play',   item: 'ball',  wantText: 'wants to play — grab a ball at the Toy Box', complaint: 'was bored to tears' },
  pet:   { icon: '❤️', says: 'wants cuddles',   item: null,    wantText: 'wants cuddles — come with empty hands', complaint: 'felt ignored' },
  bath:  { icon: '🛁', says: 'is muddy',        item: null,    wantText: 'is muddy — leash it and take it to the Bath Tub', complaint: 'came back filthy' },
};
var NEED_GRACE = 22; // seconds a dog waits happily before it starts to get upset
function complaintLine(d) { return d.traits.indexOf('diva') >= 0 ? 55 : 38; }
function dayFrac() { return clamp(S.dayTime / dayLen(), 0, 1); }
// Realistic doggy daycare daily schedule phases (8:00 AM to 6:00 PM)
function dayPhase() {
  if (!S || S.closing) return { id: 'closing', icon: '🌙', short: 'Closing', label: 'Closing Time' };
  var f = dayFrac();
  if (f < 0.35) return { id: 'morning', icon: '🌅', short: 'Drop-Off', label: 'Morning Drop-Off', banner: '🌅 Morning Drop-Off — welcome today\'s pups at the counter!' };
  if (f < 0.58) return { id: 'midday',  icon: '☀️', short: 'Play & Lunch', label: 'Lunch & Playtime', banner: '☀️ Lunch & Playtime! The pups are working up an appetite.' };
  if (f < 0.72) return { id: 'naptime', icon: '😴', short: 'Naptime', label: 'Afternoon Naptime', banner: '😴 Afternoon Naptime — quiet hour in the daycare yard.' };
  return { id: 'pickup', icon: '🌇', short: 'Pickups', label: 'Afternoon Pickups', banner: '🌇 Afternoon Pickups — owners are heading back from work!' };
}
function nightAmt() { var f = dayFrac(); var n = f > 0.78 ? (f - 0.78) / 0.22 * 0.62 : 0; if (S.closing) n = 0.72; return n; }
function playerIndoors() { var k = layoutKind(tileOf(S.player.x), tileOf(S.player.y)); return k === 'shopfloor' || k === 'door'; }
function tension() {
  var t = 0;
  S.owners.forEach(function (o) { if (o.state === 'waitCheckin' || o.state === 'waitPickup') t += 0.12 + (1 - clamp(o.patience / o.patienceMax, 0, 1)) * 0.25; });
  S.dogs.forEach(function (d) { if (d.need && d.need.t > NEED_GRACE) t += 0.15; });
  return clamp(t, 0, 1);
}

// ================= dogs & owners =================
function breedOf(d) { return BREED_BY_ID[d.breed] || BREEDS[0]; }
function makeDog() {
  var poolB = BREEDS.filter(function (x) { return !x.specialOnly; });
  var b = pick(poolB.length ? poolB : BREEDS);
  var traits = [], pool = TRAIT_IDS.slice();
  var nt = Math.random() < 0.3 ? 1 : 2;
  for (var i = 0; i < nt; i++) {
    var t;
    if (i === 0 && b.likely && Math.random() < 0.65) { t = pick(b.likely); pool.splice(pool.indexOf(t), 1); }
    else t = pool.splice(randi(0, pool.length - 1), 1)[0];
    traits.push(t);
  }
  var used = {}; S.dogs.forEach(function (d) { used[d.name] = 1; });
  var names = DOG_NAMES.filter(function (n) { return !used[n]; });
  return {
    id: nid(), name: pick(names.length ? names : DOG_NAMES), breed: b.id, coat: randi(0, b.coats.length - 1), traits: traits, fav: pick(FAV_IDS), quirk: pick(QUIRKS),
    age: randi(1, 12), seed: Math.random() * 100, collar: pick(COLLARS),
    happy: rand(68, 86), need: null, needs: { hunger: 80, clean: 90, love: 80, fun: 80 },
    x: 0, y: 0, face: 1, state: 'arriving', path: null, idleT: 0, actT: 0, speed: rand(66, 90) * (traits.indexOf('zoomies') >= 0 ? 1.35 : 1),
    petCd: 0, ownerId: null, overnight: false, pickupDay: 1, pickupAt: 0, called: false, objId: null,
    moving: false, bark: 0, mood: 0, stepped: [], kennelId: null, anim: null, animT: 0, animDur: 0, curSpeed: 0, seekObj: null, walkDist: 0,
  };
}
function setAnim(d, name, dur) {
  if (typeof DOG_ANIMS !== 'undefined' && DOG_ANIMS.indexOf(name) < 0) return;
  var base = (typeof DOG_ANIM_DUR !== 'undefined' && DOG_ANIM_DUR[name]) || 0;
  d.anim = name; d.animT = 0; d.animDur = dur || base || 2.5;
}
function dogById(id) { for (var i = 0; i < S.dogs.length; i++) if (S.dogs[i].id === id) return S.dogs[i]; return null; }
function ownerById(id) { for (var i = 0; i < S.owners.length; i++) if (S.owners[i].id === id) return S.owners[i]; return null; }
function objById(id) { for (var i = 0; i < S.objects.length; i++) if (S.objects[i].id === id) return S.objects[i]; return null; }
var QUEUE = SLOTS.slice(0, 5);           // where owners wait along the counter
var HANDOVER_SPOT = [8.9, 27.45];         // where an owner stands (customer side) to hand a dog over / take it back
var ACTION_BOX = { x: 7.4 * TILE, y: 23.3 * TILE, w: 3.4 * TILE, h: 1.9 * TILE }; // behind the counter, opposite the hand-over spot
var RECEPTION_SPOT = [6.6, 24.3];        // where a hired receptionist stands
var SHOP_WAY = { gapN: [13.1, 24.6], gapS: [13.1, 27.4], door: [16.5, 23.6], yard: [18.7, 23.6], desk: [9.9, 24.4] }; // waypoints for dogs walking through the shop
function freeSlot() {
  var used = {}; S.owners.forEach(function (o) { if (o.slot != null) used[o.slot] = 1; });
  var order = [2, 3, 1, 4, 0];
  for (var i = 0; i < order.length; i++) if (!used[order[i]]) return order[i];
  return -1;
}
var DOOR_X = (MAP.shop.streetDoor.x0 + MAP.shop.streetDoor.x1 + 1) / 2 * TILE, WALK_Y = (MAP.sidewalkY + 0.5) * TILE;
function makeOwner(kind, dog) {
  var slot = freeSlot(); if (slot < 0) return null;
  var fromLeft = Math.random() < 0.5;
  var customLook = (dog.ownerLook && typeof CUSTOMER_LOOKS !== 'undefined' && CUSTOMER_LOOKS[dog.ownerLook]) ? CUSTOMER_LOOKS[dog.ownerLook] : null;
  var o = {
    id: nid(), name: dog.ownerName || pick(OWNER_NAMES), kind: kind, dogId: dog.id, slot: slot, state: 'walkIn',
    x: fromLeft ? DOOR_X - rand(520, 640) : DOOR_X + rand(520, 640), y: WALK_Y + rand(-8, 8),
    look: customLook || dog.ownerLookObj || ((typeof randomLook === 'function') ? randomLook() : {}), dir: fromLeft ? 'right' : 'left', face: 1, moving: true,
    patience: 0, patienceMax: 0, angry: false, say: '', sayT: 0, walkT: 0, walkDist: 0, emote: null, emoteT: 0, side: fromLeft ? -1 : 1, hoT: 0,
  };
  if (!dog.ownerName) dog.ownerName = o.name;
  if (!dog.ownerLookObj) dog.ownerLookObj = o.look;
  var sl = QUEUE[slot];
  o.route = [[DOOR_X + rand(-14, 14), WALK_Y], [DOOR_X, (MAP.shop.streetDoor.y + 0.2) * TILE], [DOOR_X, 31.3 * TILE], [sl[0] * TILE, sl[1] * TILE]];
  dog.ownerId = o.id;
  S.owners.push(o);
  return o;
}
function exitRoute(o) {
  var side = Math.random() < 0.5 ? -1 : 1;
  return [[DOOR_X, 31.3 * TILE], [DOOR_X, WALK_Y], [DOOR_X + side * rand(560, 680), WALK_Y + rand(-8, 8)]];
}
function freeKennel() {
  for (var i = 0; i < S.objects.length; i++) { var o = S.objects[i]; if (o.type === 'kennel' && o.done && !o.reservedFor) return o; }
  return null;
}
function activeDogCount() { return S.dogs.filter(function (d) { return d.state !== 'leaving'; }).length; }
function patienceMul() { return diff().patience * (1 + upLvl('lounge') * 0.18); }

function spawnArrival() {
  if (freeSlot() < 0) return false;
  var d = makeDog();
  var sp = pickSpecial(); if (sp) makeSpecialDog(d, sp);
  var k = freeKennel();
  if (k && Math.random() < 0.4) { d.overnight = true; k.reservedFor = d.id; d.kennelId = k.id; }
  S.dogs.push(d);
  var o = makeOwner('dropoff', d);
  o.patienceMax = o.patience = 75 * patienceMul();
  d.x = o.x + 20; d.y = o.y + 6;
  return true;
}
function scheduleArrival() {
  var ph = dayPhase().id;
  // Morning drop-off window brings owners in steadily; Star Rating strongly drives arrival speed!
  var base = ph === 'morning' ? rand(11, 19) : ph === 'midday' ? rand(20, 32) : rand(32, 48);
  var repMul = Math.max(0.4, 0.35 + Math.pow(Math.max(0.5, S.rep) / 3.0, 1.3) * 0.75);
  var charmMul = 1 + Math.min(charm(), 120) * 0.005;
  S.arrivalTimer = base / (repMul * charmMul * (1 + upLvl('flyers') * 0.1));
}
function dogPrice(d) {
  // Earning cash is tougher and more realistic — every dollar counts!
  var base = (d.overnight ? 16 * (1 + upLvl('nightstaff') * 0.12) : 0) + breedOf(d).price * 0.24 + Math.min(S.day, 120) * 0.18;
  return Math.max(8, Math.round(base * (1 + upLvl('webcam') * 0.10) * (d.special ? 2.5 : 1)));
}
// real dogs go once or twice a day, and soon after a meal
function nextPoopDelay(d, afterMeal) { var D = dayLen(); return afterMeal ? rand(0.08, 0.16) * D : rand(0.25, 0.55) * D * (hasTrait(d, 'pooper') ? 0.55 : 1); }

// ================= special guests =================
// rare named dogs that only turn up once a hidden requirement is met (see SPECIALS in data.js)
function pickSpecial() {
  if (!S.specials) S.specials = {};
  // At most 1 special guest visit per day, and never while a special guest is already here
  if (S.lastSpecialDay === S.day) return null;
  if (S.dogs.some(function (d) { return d.special && d.state !== 'leaving'; })) return null;
  var activeSpecials = {};
  S.dogs.forEach(function (d) { if (d.special) activeSpecials[d.special] = 1; });
  var cands = SPECIALS.filter(function (sp) {
    if (activeSpecials[sp.id]) return false;
    try { return !!sp.check(S); } catch (e) { return false; }
  });
  if (!cands.length) return null;
  var chosen = null;
  // Teddy & Alfie (moraleBoost): genuinely rare special occurrences (~6% if not met yet, ~3.5% repeat)
  var moraleFresh = cands.filter(function (sp) { return sp.moraleBoost && !S.specials[sp.id]; });
  var moraleSeen = cands.filter(function (sp) { return sp.moraleBoost && S.specials[sp.id]; });
  if (moraleFresh.length && Math.random() < 0.06) chosen = pick(moraleFresh);
  else if (moraleSeen.length && Math.random() < 0.035) chosen = pick(moraleSeen);
  else {
    var fresh = cands.filter(function (sp) { return !sp.moraleBoost && !S.specials[sp.id]; });
    var seen = cands.filter(function (sp) { return !sp.moraleBoost && S.specials[sp.id]; });
    if (fresh.length && Math.random() < 0.08) chosen = pick(fresh);
    else if (seen.length && Math.random() < 0.03) chosen = pick(seen);
  }
  if (chosen) S.lastSpecialDay = S.day;
  return chosen;
}
function makeSpecialDog(d, sp) {
  d.name = sp.name; d.title = sp.title; d.breed = sp.breed; var b = breedOf(d);
  d.coat = Math.min(sp.coat, b.coats.length - 1); d.traits = sp.traits.slice(); d.special = sp.id;
  d.collar = sp.collar || '#ffd700'; d.happy = rand(82, 95);
  if (sp.ownerName) d.ownerName = sp.ownerName;
  if (sp.ownerLook) d.ownerLook = sp.ownerLook;
  if (sp.moraleBoost) {
    d.moraleBoost = true;
    d.fav = 'pets';
    d.quirk = sp.id === 'alfie' ? 'Makes instant best friends with every dog in the yard' : 'Spreads cosy cuddles and boosts every dog\'s morale';
  }
}
function moraleBoostCount() {
  if (!S || !S.dogs) return 0;
  return S.dogs.filter(function (d) { return d.moraleBoost && d.checkedIn && d.state !== 'leaving'; }).length;
}
function boostMoraleAndFriendships(guestDog, pairUp) {
  if (!S || !S.dogs) return;
  var pals = [];
  S.dogs.forEach(function (q) {
    if (q.state === 'leaving') return;
    q.happy = Math.min(100, (q.happy == null ? 75 : q.happy) + (pairUp ? 22 : 14));
    q.mood = 2.0;
    if (q.checkedIn || q === guestDog) {
      burst(q.x, q.y - 34, 'heart', 6);
      burst(q.x, q.y - 26, 'star', 4);
      if (q !== guestDog) float(q.x, q.y - 54, '💕 Morale & Friendship +!', '#ff8ad8', 1.25);
    }
    if (pairUp && q.checkedIn && !q.need && !q.called && (q.state === 'idle' || q.state === 'wander') && dogWalkable(tileOf(q.x), tileOf(q.y))) {
      pals.push(q);
    }
  });
  if (pairUp && pals.length >= 2) {
    for (var i = 0; i + 1 < pals.length; i += 2) {
      var a = pals[i], b = pals[i + 1], mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      if (!dogWalkable(tileOf(mx), tileOf(my))) { mx = a.x; my = a.y; }
      if (dogWalkable(tileOf(mx), tileOf(my))) {
        [a, b].forEach(function (q, k) {
          q.state = 'romp'; q.partner = (k ? a : b).id; q.actT = rand(5.5, 8);
          q.playA = k * Math.PI; q.rompX = mx; q.rompY = my; q.path = null; q.anim = null; q.seekObj = null;
        });
        float(a.x, a.y - 68, '🐾 Best friends!', '#ffe082', 1.3);
      }
    }
  }
}
function specialArrived(d) {
  if (!S.specials) S.specials = {};
  var first = !S.specials[d.special];
  if (first) {
    S.specials[d.special] = { day: S.day };
    gainXP(40);
    if (typeof UI !== 'undefined') UI.dexNew = (UI.dexNew || 0) + 1;
  }
  if (d.moraleBoost) {
    toast('⭐ Special guest has arrived! ' + d.name + ' (' + (d.ownerName || 'their owner') + '\'s dog) boosts all friendships & morale!', 'good');
    if (typeof showBanner === 'function') showBanner('⭐ Special guest has arrived!', (d.ownerName ? d.ownerName + ' & ' : '') + d.name + ' — all dogs\' friendships & morale boosted!');
    float(d.x, d.y - 74, '⭐ Special guest has arrived!', '#ffd54a', 1.5);
    boostMoraleAndFriendships(d, true);
  } else if (first) {
    toast('⭐ Special guest has arrived! ' + d.name + ', ' + d.title + ' — pays 5× the usual price', 'good');
  } else {
    toast('⭐ Special guest has arrived! ' + d.name + ', ' + d.title + ' is back for another visit!', 'good');
  }
  sfx('perfect');
  confetti(d.x, d.y - 40, 40);
}
function specialsFound() { return S.specials ? Object.keys(S.specials).length : 0; }

// ================= staff =================
// hired staff are saved as S.staff[id] = true and paid at closing time; NPCS holds their walking bodies
var NPCS = [];
function npcById(id) { for (var i = 0; i < NPCS.length; i++) if (NPCS[i].id === id) return NPCS[i]; return null; }
function staffHired(id) { return !!(S && S.staff && S.staff[id]); }
function hiredStaffCount() {
  if (!S || !S.staff) return 0;
  var n = 0;
  STAFF.forEach(function (s) { if (S.staff[s.id]) n++; });
  return n;
}
function staffWages() { var w = 0; STAFF.forEach(function (s) { if (staffHired(s.id)) w += s.wage; }); return w; }
function makeNpc(id) {
  var def = STAFF_BY_ID[id] || {};
  var sp = def.spot || (id === 'receptionist' ? RECEPTION_SPOT : [YARD_ENTRY[0] + 2.5, YARD_ENTRY[1] + 0.5]);
  var lk = typeof def.look === 'number' ? ((def.look + (S && S.player ? S.player.look || 0 : 0) + 1) % 4) : 1;
  return { id: id, x: sp[0] * TILE, y: sp[1] * TILE, dir: 'down', face: 1, moving: false, walkT: 0, walkDist: 0, emote: null, emoteT: 0, carry: null,
    look: lk, path: null, route: null, idleT: rand(0.4, 1.2), task: null, say: '', sayT: 0, stepT: 0, patrolIdx: 0 };
}
function syncStaff() {
  if (!S.staff) S.staff = {};
  NPCS = NPCS.filter(function (n) {
    var keep = staffHired(n.id);
    if (!keep && n.carry && n.carry.type === 'dog') {
      var ld = dogById(n.carry.id);
      if (ld && ld.state === 'npcLeashed') { ld.state = 'idle'; ld.npcHolder = null; }
    }
    return keep;
  });
  STAFF.forEach(function (s) { if (staffHired(s.id) && !npcById(s.id)) NPCS.push(makeNpc(s.id)); });
}
function toggleStaff(id) {
  var s = STAFF_BY_ID[id]; if (!s) return; if (!S.staff) S.staff = {};
  if (S.staff[id]) { delete S.staff[id]; toast(s.icon + ' ' + s.name + ' let go.', ''); }
  else { if (S.level < s.lvl) { toast('Reach level ' + s.lvl + ' to hire a ' + s.name, 'bad'); sfx('error'); return; } S.staff[id] = true; toast(s.icon + ' ' + s.name + ' hired — ' + fmtMoney(s.wage) + ' a day, paid at closing time', 'good'); sfx('coin'); }
  syncStaff(); saveGame();
  if (typeof MP !== 'undefined') MP.recordAction('staff', { item: id, name: s.name, icon: s.icon, hired: !!S.staff[id], cost: s.wage });
}
function updateNPCs(dt) {
  syncStaff();
  NPCS.forEach(function (n) {
    n.sayT -= dt; if (n.emote) { n.emoteT += dt; if (n.emoteT > 1.4) n.emote = null; }
    if (n.id === 'receptionist') updateReceptionist(n, dt);
    else if (n.id === 'runner') updateRunner(n, dt);
    else updateYardWorker(n, dt);
  });
}
var SHOP_PATROL = [[6.6, 24.3], [11.2, 22.0], [14.5, 23.8], [8.8, 24.3], [5.4, 24.3]];
function updateReceptionist(n, dt) {
  n.idleT -= dt;
  // If Pickup Runner is not hired, Receptionist only brings pickup dogs if she isn't busy and the owner has waited a long time (>45s)
  if (!staffHired('runner')) {
    S.owners.forEach(function (o) {
      if (o.state !== 'waitPickup') return;
      var d = dogById(o.dogId); if (!d) return;
      if (!(d.state === 'idle' || d.state === 'wander' || d.state === 'nap' || d.state === 'drink' || d.state === 'romp')) return;
      if (o.patienceMax - o.patience < 45) return;
      startToCounter(d);
    });
  }
  var busy = S.owners.some(function (o) { return o.state === 'toHandover' || o.state === 'handover'; });
  if (busy) {
    // Walk to the handover desk position behind the counter
    var hSpot = [8.9 * TILE, 24.3 * TILE];
    if (dist(n.x, n.y, hSpot[0], hSpot[1]) > 6) {
      moveTo(n, hSpot[0], hSpot[1], 145, dt);
      if (n.moving) n.walkT += dt;
    } else {
      n.moving = false; n.dir = 'down';
    }
    n.idleT = 1.2;
    return;
  }
  // Check if there is a shop counter chore to polish
  var shopChore = (S.chores || []).filter(function (c) { return c.kind === 'desk'; })[0];
  if (shopChore) {
    if (dist(n.x, n.y, shopChore.x, shopChore.y) > 20) {
      moveTo(n, shopChore.x, shopChore.y, 145, dt);
      if (n.moving) n.walkT += dt;
      return;
    } else {
      n.moving = false;
      doChore(shopChore);
      n.say = 'Counter sparkling!'; n.sayT = 2; n.idleT = 1.5;
      return;
    }
  }
  var ready = S.owners.filter(function (o) { return o.state === 'waitPickup' && (dogById(o.dogId) || {}).state === 'atDesk'; });
  var wc = S.owners.filter(function (o) { return o.state === 'waitCheckin'; }).sort(function (a, b) { return a.patience / a.patienceMax - b.patience / b.patienceMax; });
  if ((ready.length || wc.length) && !playerOnMat()) {
    var deskX = 8.9 * TILE, deskY = 24.3 * TILE;
    if (dist(n.x, n.y, deskX, deskY) > 10) {
      moveTo(n, deskX, deskY, 155, dt);
      if (n.moving) n.walkT += dt;
      return;
    }
    n.moving = false; n.dir = 'down';
    if (n.idleT <= 0) {
      if (ready.length) {
        summonOwner(ready[0], true); n.say = pick(['Here we go!', 'Someone missed you!']); n.sayT = 2; n.idleT = 2.0; return;
      }
      if (wc.length) {
        summonOwner(wc[0], true); n.say = pick(['Welcome!', 'Hello there!', 'Come on through!']); n.sayT = 2; n.idleT = 2.0; return;
      }
    }
    return;
  }
  // When no customer is actively being served, patrol around the reception shop floor!
  if (n.route && n.route.length) {
    var wp = n.route[0];
    if (moveTo(n, wp[0], wp[1], 115, dt)) n.route.shift();
    if (n.moving) n.walkT += dt;
    return;
  }
  n.moving = false;
  if (n.idleT <= 0) {
    n.patrolIdx = ((n.patrolIdx || 0) + 1) % SHOP_PATROL.length;
    var pt = SHOP_PATROL[n.patrolIdx];
    n.route = [[pt[0] * TILE + rand(-10, 10), pt[1] * TILE + rand(-8, 8)]];
    n.idleT = rand(1.4, 2.8);
    if (Math.random() < 0.25) { n.say = pick(['Checking bookings…', 'Stocking leashes!', 'Ready for guests!']); n.sayT = 1.8; }
  }
}
function startToCounter(d) {
  var b = bfs(tileOf(d.x), tileOf(d.y)), path = pathTo(b, YARD_ENTRY[0], YARD_ENTRY[1]);
  if (!path) { var t = nearestWalkable(d.x, d.y); d.x = (t[0] + .5) * TILE; d.y = (t[1] + .5) * TILE; b = bfs(t[0], t[1]); path = pathTo(b, YARD_ENTRY[0], YARD_ENTRY[1]); }
  if (d.objId) { var ob = objById(d.objId); if (ob) ob.dogId = null; d.objId = null; }
  endRomp(d);
  d.state = 'toCounter'; d.path = path || []; d.route = [SHOP_WAY.door, SHOP_WAY.gapN, SHOP_WAY.desk].map(function (w) { return [w[0] * TILE, w[1] * TILE]; });
  d.anim = null; d.seekObj = null; d.ox = 0; d.oy = 0; if (d.need) d.need.self = null;
}
function followRoute(d, sp, dt) { // walk a list of pixel waypoints; true when the last is reached
  if (!d.route || !d.route.length) return true;
  var w = d.route[0];
  if (moveTo(d, w[0], w[1], sp, dt)) d.route.shift();
  return !d.route.length;
}
function followPath(d, sp, dt) { // walk a tile path (from pathTo); true when done
  if (!d.path || !d.path.length) return true;
  var nx = d.path[0];
  if (!dogWalkable(nx[0], nx[1])) { d.path = null; return true; }
  if (moveTo(d, (nx[0] + 0.5) * TILE + (d.ox || 0), (nx[1] + 0.5) * TILE + (d.oy || 0), sp, dt)) d.path.shift();
  return !d.path.length;
}
// 🦮 Pickup Dog Runner: searches the yard for dogs whose owner is waiting at the counter, walks to them, and sends/escorts them to the desk!
function updateRunner(n, dt) {
  n.idleT -= dt; n.moving = false;
  if (!n.task && n.idleT <= 0) {
    var pickupDog = null;
    for (var i = 0; i < S.owners.length; i++) {
      var o = S.owners[i];
      if (o.state !== 'waitPickup') continue;
      var d = dogById(o.dogId);
      if (!d || !(d.state === 'idle' || d.state === 'wander' || d.state === 'nap' || d.state === 'drink' || d.state === 'romp' || d.state === 'kennel')) continue;
      if (S.player.carry && S.player.carry.type === 'dog' && S.player.carry.id === d.id) continue;
      pickupDog = d; break;
    }
    if (pickupDog) {
      n.task = { kind: 'fetchPickup', dogId: pickupDog.id };
      n.path = null;
      n.say = 'Finding ' + pickupDog.name + '!'; n.sayT = 2.0;
    } else {
      // Help with cuddles or patrol the yard actively
      var petDog = S.dogs.filter(function (d) { return d.checkedIn && d.need && d.need.type === 'pet' && !d.need.self && (d.state === 'idle' || d.state === 'wander' || d.state === 'nap'); })[0];
      if (petDog) { n.task = { kind: 'need', dogId: petDog.id, type: 'pet' }; n.path = null; }
      else { n.idleT = rand(0.6, 1.4); helperWalkTo(n, null); }
    }
  }
  if (!n.task) { helperWalk(n, dt); return; }
  if (n.task.kind === 'fetchPickup') {
    var fd = dogById(n.task.dogId);
    var stillWanted = fd && S.owners.some(function (o) { return o.dogId === fd.id && o.state === 'waitPickup'; });
    if (!fd || !stillWanted || fd.state === 'leashed' || fd.state === 'toCounter' || fd.state === 'atDesk') {
      n.task = null; return;
    }
    if (dist(n.x, n.y, fd.x, fd.y) < 48) {
      n.say = 'Come on, ' + fd.name + '! Pickup time!'; n.sayT = 2.2;
      n.emote = 'happy'; n.emoteT = 0;
      startToCounter(fd);
      // Runner trots back toward the yard door with the dog
      helperWalkTo(n, [(YARD_ENTRY[0] + 1.5) * TILE, (YARD_ENTRY[1] + 0.5) * TILE]);
      n.task = null; n.idleT = 1.5;
      return;
    }
    if (!n.path || n.pathT <= 0) helperWalkTo(n, [fd.x, fd.y]);
    helperWalk(n, dt);
    return;
  }
  runWorkerTask(n, dt);
}

// Specialized yard workers: cleaner (🧹), feeder (🥣), groomer (🛁), trainer (🎾), helper (🧑‍🌾 all-rounder)
function workerCanDoNeed(role, needType) {
  if (role === 'feeder') return needType === 'food' || needType === 'treat';
  if (role === 'groomer') return needType === 'bath' || needType === 'pet';
  if (role === 'trainer') return needType === 'play' || needType === 'pet';
  if (role === 'helper') return needType === 'food' || needType === 'treat' || needType === 'play' || needType === 'pet';
  return false;
}
function workerCanDoChore(role, choreKind) {
  if (choreKind === 'desk') return false;
  if (role === 'cleaner') return choreKind === 'rake' || choreKind === 'water' || choreKind === 'toys';
  if (role === 'feeder') return choreKind === 'water' || choreKind === 'bone';
  if (role === 'groomer') return choreKind === 'brush';
  if (role === 'trainer') return choreKind === 'bone' || choreKind === 'toys';
  if (role === 'helper') return true;
  return false;
}
function updateYardWorker(n, dt) {
  n.idleT -= dt; n.moving = false;
  var role = n.id, cap = poopCap();
  // If worker is currently walking a leashed dog to the bath tub, finish that task first!
  if (n.carry && n.carry.type === 'dog') {
    if (!n.task || n.task.kind !== 'toTub') n.task = { kind: 'toTub', dogId: n.carry.id };
  }
  if (!n.task && n.idleT <= 0) {
    var best = null, bd = 1e9;
    // 1. Check matching dog needs for this worker's specialty
    S.dogs.forEach(function (d) {
      if (!d.need || d.need.self || !d.checkedIn || d.helperSkip > S.clock) return;
      if (!(d.state === 'idle' || d.state === 'wander' || d.state === 'nap')) return;
      if (!workerCanDoNeed(role, d.need.type)) return;
      if (d.need.type === 'bath') {
        var freeTub = S.objects.some(function (o) { return o.done && o.type === 'tub' && !o.dogId; });
        if (!freeTub) return;
      }
      var dd = dist(n.x, n.y, d.x, d.y) - d.need.t * 30;
      if (dd < bd) { bd = dd; best = { kind: d.need.type === 'bath' ? 'washDog' : 'need', dogId: d.id, type: d.need.type }; }
    });
    // 2. Cleaner & Helper prioritize scooping poop
    if (!best && (role === 'cleaner' || role === 'helper')) {
      if (n.carry && n.carry.type === 'poop' && ((n.carry.n || 1) >= cap || !S.poops.length)) best = { kind: 'bin' };
      else if (S.poops.some(function (q) { return !(q.helperSkip > S.clock); }) && (!n.carry || n.carry.type === 'poop')) {
        var pp = S.poops.filter(function (q) { return !(q.helperSkip > S.clock); }).sort(function (a, b) { return dist(n.x, n.y, a.x, a.y) - dist(n.x, n.y, b.x, b.y); })[0];
        best = { kind: 'poop', id: pp.id };
      } else if (n.carry && n.carry.type === 'poop') best = { kind: 'bin' };
    }
    // 3. Matching yard chores for this worker's role
    if (!best && S.chores && S.chores.length) {
      var ch = S.chores.filter(function (c) { return workerCanDoChore(role, c.kind); })
        .sort(function (a, b) { return dist(n.x, n.y, a.x, a.y) - dist(n.x, n.y, b.x, b.y); })[0];
      if (ch) best = { kind: 'chore', id: ch.id };
    }
    if (best) { n.task = best; n.path = null; n.tries = 0; }
    else {
      // Keep moving & patrolling around the yard!
      n.idleT = rand(0.5, 1.3);
      helperWalkTo(n, null);
      if (Math.random() < 0.22) {
        var lines = role === 'cleaner' ? ['Keeping the grass spotless!', 'On poop patrol!']
          : role === 'feeder' ? ['Checking water & bowls!', 'Who wants kibble?']
          : role === 'groomer' ? ['Bubble bath ready!', 'Looking fluffy!']
          : role === 'trainer' ? ['Who wants to play fetch?', 'Good agility!']
          : ['Checking on the pack!', 'Good pups!'];
        n.say = pick(lines); n.sayT = 1.8;
      }
    }
  }
  if (!n.task) { helperWalk(n, dt); return; }
  runWorkerTask(n, dt);
}

function runWorkerTask(n, dt) {
  var t = n.task;
  if (!t) return;
  if (t.kind === 'chore') {
    var ch = null;
    for (var ci = 0; ci < (S.chores || []).length; ci++) if (S.chores[ci].id === t.id) ch = S.chores[ci];
    if (!ch) { n.task = null; return; }
    if (dist(n.x, n.y, ch.x, ch.y) < 34) {
      doChore(ch);
      n.emote = 'happy'; n.emoteT = 0;
      n.say = ch.icon + ' All done!'; n.sayT = 1.6;
      n.task = null; n.idleT = 0.7; n.path = null; return;
    }
    if (!n.path || n.pathT <= 0) helperWalkTo(n, [ch.x, ch.y]);
    helperWalk(n, dt); return;
  }
  if (t.kind === 'washDog') {
    var wd = dogById(t.dogId);
    var tub = S.objects.filter(function (o) { return o.done && o.type === 'tub' && !o.dogId; })[0];
    if (!wd || !tub || !wd.need || wd.need.type !== 'bath' || !(wd.state === 'idle' || wd.state === 'wander' || wd.state === 'nap')) {
      n.task = null; return;
    }
    if (dist(n.x, n.y, wd.x, wd.y) < 42) {
      wd.state = 'npcLeashed'; wd.npcHolder = n.id; wd.path = null; wd.anim = null;
      n.carry = { type: 'dog', id: wd.id };
      n.say = 'Bath time, ' + wd.name + '!'; n.sayT = 2.0;
      sfx('leash');
      n.task = { kind: 'toTub', dogId: wd.id }; n.path = null; return;
    }
    if (!n.path || n.pathT <= 0) helperWalkTo(n, [wd.x, wd.y]);
    helperWalk(n, dt); return;
  }
  if (t.kind === 'toTub') {
    var bd = dogById(t.dogId);
    var tub2 = S.objects.filter(function (o) { return o.done && o.type === 'tub' && !o.dogId; })[0];
    if (!bd || !tub2) {
      if (bd && bd.state === 'npcLeashed') { bd.state = 'idle'; bd.npcHolder = null; }
      n.carry = null; n.task = null; return;
    }
    // Keep the leashed dog trotting right behind the Groomer
    moveTo(bd, n.x - (DIRV[n.dir] ? DIRV[n.dir][0] * 26 : 0), n.y - (DIRV[n.dir] ? DIRV[n.dir][1] * 22 : -18), 175, dt);
    var tPad = stationPad(tub2) || { x: tub2.x * TILE, y: (tub2.y + 1) * TILE, w: tub2.w * TILE, h: TILE };
    if (inRect(n.x, n.y, tPad) || dist(n.x, n.y, (tub2.x + tub2.w / 2) * TILE, (tub2.y + 1) * TILE) < 44) {
      n.carry = null;
      var tLv = tub2.lvl || 1;
      bd.state = 'bath'; bd.actT = Math.max(1.6, 4.2 - (tLv - 1) * 0.35); bd.objId = tub2.id; tub2.dogId = bd.id; tub2.useAt = now; bd.anim = null; bd.npcHolder = null;
      bd.x = (tub2.x + tub2.w / 2) * TILE; bd.y = (tub2.y + 0.75) * TILE;
      sfx('splash'); gainXP(2); S.stats.baths++;
      n.say = 'Scrub-a-dub!'; n.sayT = 1.8; n.emote = 'happy'; n.emoteT = 0;
      n.task = null; n.idleT = 0.9; n.path = null; return;
    }
    if (!n.path || n.pathT <= 0) helperWalkTo(n, [tPad.x + tPad.w / 2, tPad.y + tPad.h / 2]);
    helperWalk(n, dt); return;
  }
  if (t.kind === 'need') {
    var d = dogById(t.dogId);
    if (!d || !d.need || d.need.self || !(d.state === 'idle' || d.state === 'wander' || d.state === 'nap')) { n.task = null; return; }
    var item = t.type === 'food' ? 'food' : t.type === 'treat' ? 'treat' : t.type === 'play' ? 'ball' : null;
    if (item && !(n.carry && n.carry.type === item)) { // fetch it from the station first
      if (n.carry && n.carry.type === 'poop') { t.kind = 'bin'; t.then = { kind: 'need', dogId: t.dogId, type: t.type }; return; }
      var st = S.objects.filter(function (o) { return o.done && STATION_ITEM[o.type] === item; })[0];
      if (!st) { n.task = null; n.idleT = 3; return; }
      var pad = stationPad(st);
      if (inRect(n.x, n.y, pad)) { n.carry = { type: item }; st.useAt = now; n.emote = 'scoop'; n.emoteT = 0; sfx('pop'); n.path = null; return; }
      if (!n.path) helperWalkTo(n, [pad.x + pad.w / 2, pad.y + pad.h / 2]);
      helperWalk(n, dt); return;
    }
    if (dist(n.x, n.y, d.x, d.y) < 44) { helperServe(n, d, t.type); n.task = null; n.idleT = 0.8; n.path = null; return; }
    if (!n.path || n.pathT <= 0) { helperWalkTo(n, [d.x, d.y]); n.tries = (n.tries || 0) + 1; if (n.tries > 5) { d.helperSkip = S.clock + 30; n.task = null; n.tries = 0; return; } }
    helperWalk(n, dt); return;
  }
  if (t.kind === 'poop') {
    var pp = null; for (var i = 0; i < S.poops.length; i++) if (S.poops[i].id === t.id) pp = S.poops[i];
    if (!pp) { n.task = null; return; }
    if (dist(n.x, n.y, pp.x, pp.y) < 24) {
      S.poops.splice(S.poops.indexOf(pp), 1); burst(pp.x, pp.y, 'dust', 6); sfx('scoop'); n.emote = 'scoop'; n.emoteT = 0;
      if (n.carry && n.carry.type === 'poop') n.carry.n = (n.carry.n || 1) + 1; else n.carry = { type: 'poop', n: 1 };
      n.task = null; n.idleT = 0.6; n.path = null; return;
    }
    if (!n.path) helperWalkTo(n, [pp.x, pp.y]);
    else if (!n.path.length) { pp.helperSkip = S.clock + 40; n.task = null; n.idleT = 0.5; return; }
    helperWalk(n, dt); return;
  }
  if (t.kind === 'bin') {
    var bin = S.objects.filter(function (o) { return o.done && o.type === 'trash'; })[0];
    if (!bin || !n.carry) { n.carry = null; n.task = t.then || null; return; }
    var bp = stationPad(bin);
    if (inRect(n.x, n.y, bp)) { n.carry = null; bin.useAt = now; sfx('trash'); n.task = t.then || null; n.idleT = 0.5; n.path = null; return; }
    if (!n.path) helperWalkTo(n, [bp.x + bp.w / 2, bp.y + bp.h / 2]);
    helperWalk(n, dt); return;
  }
  n.task = null;
}
function helperWalkTo(n, target) {
  var t0 = nearestWalkable(n.x, n.y), b = bfs(t0[0], t0[1]), goal;
  if (target) goal = nearestWalkable(target[0], target[1]);
  else {
    var c = [];
    for (var i = 0; i < W * H; i++) if (b.dist[i] >= 2 && b.dist[i] <= 11) c.push(i);
    if (!c.length) { for (var j = 0; j < W * H; j++) if (b.dist[j] > 0) c.push(j); }
    if (!c.length) return;
    var k = pick(c); goal = [k % W, (k / W) | 0];
  }
  n.path = pathTo(b, goal[0], goal[1]) || []; n.pathT = 2.8;
}
function helperWalk(n, dt) {
  if (!n.path || !n.path.length) { n.moving = false; return; }
  n.pathT -= dt;
  var nx = n.path[0];
  if (moveTo(n, (nx[0] + 0.5) * TILE, (nx[1] + 0.5) * TILE, 165, dt)) n.path.shift();
  if (n.moving) n.walkT += dt;
}
function helperServe(n, d, type) {
  n.face = d.x > n.x ? 1 : -1; n.dir = d.x > n.x ? 'right' : 'left';
  if (type === 'pet') { burst(d.x, d.y - 34, 'heart', 5); sfx('pet', d); if (d.state === 'wander') { d.state = 'idle'; d.idleT = 1.2; d.path = null; } fulfillNeed(d); setAnim(d, 'wiggle', 1.0); n.emote = 'pet'; n.emoteT = 0; }
  else if (type === 'food') { n.carry = null; fulfillNeed(d); d.state = 'eat'; d.actT = 2.4; d.path = null; d.anim = null; d.poopT = Math.min(d.poopT || 1e9, nextPoopDelay(d, true)); burst(d.x, d.y - 20, 'crumb', 8); sfx('munch'); float(d.x, d.y - 48, 'Nom nom!', '#fff'); n.emote = 'pet'; n.emoteT = 0; }
  else if (type === 'treat') { n.carry = null; fulfillNeed(d); burst(d.x, d.y - 28, 'heart', 6); sfx('munch'); if (d.state === 'wander') { d.state = 'idle'; d.idleT = 1.5; d.path = null; } setAnim(d, 'beg', 1.2); float(d.x, d.y - 48, 'Yum!', '#fff'); n.emote = 'pet'; n.emoteT = 0; }
  else if (type === 'play') { n.carry = null; fulfillNeed(d); d.state = 'play'; d.actT = 3.5; d.path = null; d.playA = Math.random() * 6.28; d.anim = null; sfx('bark', d); sfx('whoosh'); burst(d.x, d.y - 24, 'star', 6); FX.parts.push({ x: n.x, y: n.y - 50, vx: (d.x - n.x) * 1.2 + rand(-40, 40), vy: -220, life: 1.1, max: 1.1, kind: 'ball', size: 7, grav: 520 }); float(d.x, d.y - 48, 'Fetch!!', '#fff'); n.emote = 'happy'; n.emoteT = 0; }
}
// the open end of the reception counter: a dog on the other side of it from its target trots round instead of cutting through
function counterDetour(d, tx, ty) {
  var ct = MAP.shop.counter, cTop = ct.y * TILE, cBot = (ct.y + 1) * TILE, gapX = (ct.x1 + 1) * TILE + 52; // well clear of the counter's end
  var dSouth = d.y > cBot - 8, dNorth = d.y < cTop + 8, tSouth = ty > cBot - 8, tNorth = ty < cTop + 8, inRow = !dSouth && !dNorth;
  var inShop = d.x < gapX + 40 && d.x > MAP.shop.x0 * TILE;
  if (inShop && inRow && d.x < gapX - 6 && (tSouth || tNorth)) return { x: gapX, y: tNorth ? cTop - 22 : cBot + 20, lead: 230 }; // still level with the counter: out to the gap first
  if (inShop && ((dSouth && tNorth) || (dNorth && tSouth))) {
    if (d.x < gapX - 6) return { x: gapX, y: dSouth ? Math.max(d.y, cBot + 16) : Math.min(d.y, cTop - 22), lead: 230 };
    return { x: gapX, y: tNorth ? cTop - 22 : cBot + 20, lead: 230 };
  }
  return { x: tx, y: ty, lead: 0 };
}
function endRomp(d) {
  if (d.state !== 'romp') return;
  var p = dogById(d.partner); d.partner = null;
  if (p && p.state === 'romp') { p.state = 'idle'; p.idleT = p.need || p.called ? 1e9 : rand(1, 2.5); p.partner = null; p.moving = false; setAnim(p, 'sit', 1.5); }
}

// ================= glossary =================
function dexSeen(d) {
  var e = S.dex[d.breed], fresh = !e;
  if (!e) e = S.dex[d.breed] = { n: 0, first: S.day, coats: [], best: 0, names: [] };
  e.n++;
  if (e.coats.indexOf(d.coat) < 0) e.coats.push(d.coat);
  if (e.names.indexOf(d.name) < 0) { e.names.push(d.name); if (e.names.length > 6) e.names.shift(); }
  if (fresh) {
    var b = breedOf(d), n = dexCount();
    toast('📖 New breed in your glossary: ' + b.name + '!', 'good'); sfx('new_breed'); gainXP(12);
    if (typeof UI !== 'undefined') UI.dexNew = (UI.dexNew || 0) + 1;
    if (n % 5 === 0) { var bonus = n * 20; S.cash += bonus; toast('🏅 ' + n + ' breeds met  +' + fmtMoney(bonus), 'good'); confetti(S.player.x, S.player.y - 50, 40); }
  }
}
function dexCount() { return Object.keys(S.dex).length; }

// ================= daily goals (endless scaling with Daycare Level) =================
function rollGoals() {
  var tier = Math.max(0, Math.floor((S.level - 1) / 2)), pool = GOALS.slice(), out = [];
  for (var i = 0; i < 3 && pool.length; i++) {
    var g = pool.splice(randi(0, pool.length - 1), 1)[0];
    var baseN = g.n[Math.min(2, tier)];
    var extra = tier > 2 ? Math.round(baseN * (tier - 2) * 0.35) : 0;
    out.push({ id: g.id, n: baseN + extra, reward: Math.round(g.reward * (0.45 + tier * 0.25)), done: false });
  }
  S.goals = out;
}
function goalDef(id) { for (var i = 0; i < GOALS.length; i++) if (GOALS[i].id === id) return GOALS[i]; return null; }
function goalText(g) { var def = goalDef(g.id); return def ? def.text.replace('{n}', g.n) : ''; }
function goalProgress(g) { var def = goalDef(g.id); return def ? Math.min(g.n, Math.floor(S.stats[def.stat] || 0)) : 0; }
function checkGoals() {
  if (!S.tutorialDone) return;
  var completed = false;
  S.goals.forEach(function (g) {
    if (g.done || !goalDef(g.id) || goalProgress(g) < g.n) return;
    g.done = true; S.cash += g.reward; S.stats.goalCash += g.reward; completed = true;
    toast('🎯 Goal complete: ' + goalText(g) + '  +' + fmtMoney(g.reward), 'good'); sfx('goal'); gainXP(10);
    confetti(S.player.x, S.player.y - 50, 30);
  });
  if (completed) saveGame();
}

// ================= dog needs (the "director") =================
function careable(d) { return d.checkedIn && !d.called && !d.need && !(d.needCool > (S.clock || 0)) && (d.state === 'idle' || d.state === 'wander' || d.state === 'nap') && baseKind(tileOf(d.x), tileOf(d.y)) === 'yard'; }
function maxNeeds() {
  var n = S.dogs.filter(function (d) { return d.checkedIn && d.state !== 'leaving'; }).length, df = settings.difficulty;
  if (df === 'relaxed') return clamp(1 + Math.floor(n / 6), 1, 2);
  if (df === 'hectic') return clamp(2 + Math.floor(n / 4), 1, 4);
  return clamp(1 + Math.floor(n / 4), 1, 3);
}
function hasDone(type) { return S.objects.some(function (o) { return o.type === type && o.done; }); }
function hasAnyType(type) { return S.objects.some(function (o) { return o.type === type; }); }
function checkStationTut(type) {
  if (type === 'foodbin' && hasDone('foodbin')) tut('build_food');
  else if (type === 'waterbowl' && hasDone('waterbowl')) tut('build_water');
  else if (type === 'toybox' && hasDone('toybox') && S.stats && S.stats.fetches > 0) tut('build_toy');
  else if (type === 'tub' && hasDone('tub') && S.stats && S.stats.baths > 0) tut('build_tub');
}
function currentTutorialStep() {
  if (!S || S.tutorialDone || typeof TUTORIAL === 'undefined') return null;
  for (var i = 0; i < TUTORIAL.length; i++) {
    if (!S.tutorial[TUTORIAL[i].id]) {
      return { id: TUTORIAL[i].id, text: TUTORIAL[i].text, reward: TUTORIAL[i].reward || 20, idx: i, stepNum: i + 1, total: TUTORIAL.length };
    }
  }
  return null;
}
function advanceTutorialPacing() {
  if (!S || S.tutorialDone) return;
  var step = currentTutorialStep();
  if (!step) return;
  // Never let a waiting customer run out of patience while the player is learning how to play!
  S.owners.forEach(function (o) {
    if (o.state === 'waitCheckin' || o.state === 'waitPickup') {
      o.patience = Math.max(o.patience, o.patienceMax * 0.7);
    }
  });
  // Ensure the first arrival exists on step 1 if none are present
  if (step.id === 'checkin' && S.owners.length === 0 && S.dogs.length === 0) {
    spawnArrival();
    if (S.owners[0]) {
      var o0 = S.owners[0], d0 = dogById(o0.dogId);
      o0.x = DOOR_X; o0.y = (MAP.shop.streetDoor.y + 0.3) * TILE;
      o0.route = [[DOOR_X, 31.3 * TILE], [QUEUE[o0.slot][0] * TILE, QUEUE[o0.slot][1] * TILE]];
      if (d0) { d0.x = o0.x + 18; d0.y = o0.y + 6; }
    }
  }
  // Auto-complete build steps once their station is built
  if (hasDone('foodbin') && !S.tutorial.build_food) tut('build_food');
  if (hasDone('waterbowl') && !S.tutorial.build_water) {
    tut('build_water');
    var wb = S.objects.filter(function (o) { return o.type === 'waterbowl' && o.done; })[0];
    var wd = S.dogs.filter(function (q) { return q.checkedIn && q.state !== 'leaving'; })[0];
    if (wb && wd && (wd.state === 'idle' || wd.state === 'wander')) {
      goToObject(wd, wb);
      float(wd.x, wd.y - 54, '💧 Drinking fresh water!', '#80d8ff', 1.25);
    }
  }
  step = currentTutorialStep();
  if (!step) return;
  // Prevent soft-lock if player somehow spent cash before building required tutorial station
  var reqType = step.id === 'build_food' ? 'foodbin' : step.id === 'build_water' ? 'waterbowl' : step.id === 'scoop' ? 'trash' : step.id === 'build_toy' ? 'toybox' : step.id === 'build_tub' ? 'tub' : null;
  if (reqType && !hasAnyType(reqType) && CAT_BY_ID[reqType] && S.cash < CAT_BY_ID[reqType].cost) {
    S.cash = CAT_BY_ID[reqType].cost;
  }
  var d = S.dogs.filter(function (q) { return q.checkedIn && q.state !== 'leaving'; })[0];
  if (!d) return;
  var inYard = d.state !== 'toYard' && d.state !== 'leashed' && d.state !== 'npcLeashed' && d.state !== 'bath' && d.state !== 'toCounter' && d.state !== 'atDesk' && d.state !== 'toOwner' && baseKind(tileOf(d.x), tileOf(d.y)) === 'yard';
  // Hold off pickup until the player reaches the final tutorial step ('return')
  if (step.id !== 'return' && d.pickupDay === S.day && d.pickupAt < S.dayTime + 45) {
    d.pickupAt = Math.min(dayLen() - 10, S.dayTime + 45);
  }
  function setTutNeed(nType, animName) {
    if (d.state === 'romp') endRomp(d);
    d.need = { type: nType, t: 0 }; d.path = null; d.seekObj = null; d.state = 'idle'; d.idleT = 1e9; setAnim(d, animName, 1e9);
  }
  if (step.id === 'pet') {
    if (inYard && (!d.need || d.need.type !== 'pet')) setTutNeed('pet', 'sit');
  } else if (step.id === 'feed') {
    if (hasDone('foodbin') && inYard && d.state !== 'eat' && (!d.need || (d.need.type !== 'food' && d.need.type !== 'treat'))) setTutNeed('food', 'beg');
  } else if (step.id === 'scoop') {
    if (!S.poops.length && !(S.player.carry && S.player.carry.type === 'poop') && S.stats.scoops === 0 && inYard) {
      dropPoop(d);
    }
    if (hasDone('trash') && S.stats.scoops > 0 && !(S.player.carry && S.player.carry.type === 'poop')) {
      tut('scoop');
    }
  } else if (step.id === 'build_toy') {
    if (hasDone('toybox') && inYard && d.state !== 'play' && (!d.need || d.need.type !== 'play')) setTutNeed('play', 'playbow');
  } else if (step.id === 'build_tub') {
    if (hasDone('tub') && inYard && (!d.need || d.need.type !== 'bath')) setTutNeed('bath', 'scratch');
  } else if (step.id === 'return') {
    if (inYard && d.state !== 'idle') { d.state = 'idle'; d.path = null; d.idleT = 1e9; }
    if (!d.called && !S.owners.some(function (o) { return o.dogId === d.id && (o.state === 'waitPickup' || o.state === 'walkIn' || o.state === 'toHandover' || o.state === 'handover'); })) {
      d.need = null;
      d.pickupDay = S.day;
      d.pickupAt = S.dayTime;
      var ow = makeOwner('pickup', d);
      if (ow) {
        d.called = true;
        ow.patienceMax = ow.patience = 120 * patienceMul();
        ow.x = DOOR_X; ow.y = (MAP.shop.streetDoor.y + 0.3) * TILE;
        ow.route = [[DOOR_X, 31.3 * TILE], [QUEUE[ow.slot][0] * TILE, QUEUE[ow.slot][1] * TILE]];
      }
    }
  }
}
function tutorialGuidance() {
  var step = currentTutorialStep();
  if (!step) return null;
  var car = S.player.carry;
  var d = S.dogs.filter(function (q) { return q.checkedIn && q.state !== 'leaving'; })[0] || S.dogs[0] || null;
  var dName = d ? d.name : 'your dog';
  var tx = ACTION_BOX.x + ACTION_BOX.w / 2, ty = ACTION_BOX.y + ACTION_BOX.h / 2;
  var callout = 'SERVE PAD', subText = step.text, col = '#ffd54a';
  function padTarget(padId, typeId, buildLabel) {
    var obj = S.objects.filter(function (o) { return o.type === typeId; })[0];
    if (obj) {
      if (!obj.done) {
        tx = (obj.x + obj.w / 2) * TILE; ty = (obj.y + obj.h / 2) * TILE;
        callout = 'BUILDING…';
        subText = 'Wait a second for ' + CAT_BY_ID[typeId].name + ' to finish building!';
        col = '#ffe082';
        return { built: false, building: true, obj: obj };
      }
      return { built: true, building: false, obj: obj };
    }
    var up = null;
    for (var i = 0; i < UNLOCK_PADS.length; i++) if (UNLOCK_PADS[i].id === padId) { up = UNLOCK_PADS[i]; break; }
    var def = CAT_BY_ID[typeId] || { w: 2, h: 2, cost: 50, name: typeId };
    if (up) { tx = (up.x + def.w / 2) * TILE; ty = (up.y + def.h / 2) * TILE; }
    callout = buildLabel;
    subText = 'Stand on the green ' + def.icon + ' ' + def.name + ' ($' + def.cost + ') box in the yard to build it!';
    col = '#8bf06e';
    return { built: false, building: false, obj: null };
  }
  if (step.id === 'checkin') {
    tx = ACTION_BOX.x + ACTION_BOX.w / 2; ty = ACTION_BOX.y + ACTION_BOX.h / 2;
    callout = 'WELCOME DOG';
    subText = 'Step onto the SERVE pad behind the counter to welcome your first dog!';
  } else if (step.id === 'pet') {
    if (d) { tx = d.x; ty = d.y; }
    callout = 'CUDDLE ' + dName.toUpperCase();
    subText = 'Walk out to the yard and stand next to ' + dName + ' to ❤️ cuddle them!';
    col = '#ff8ad8';
  } else if (step.id === 'build_food') {
    padTarget('pad_foodbin', 'foodbin', 'BUILD FOOD BIN ($60)');
  } else if (step.id === 'feed') {
    var fb = padTarget('pad_foodbin', 'foodbin', 'BUILD FOOD BIN ($60)');
    if (fb.built) {
      if (car && car.type === 'food') {
        if (d) { tx = d.x; ty = d.y; }
        callout = 'FEED ' + dName.toUpperCase();
        subText = 'Walk over to ' + dName + ' with the kibble bowl to feed them 🍖!';
        col = '#8bf06e';
      } else {
        var fPad = stationPad(fb.obj);
        if (fPad) { tx = fPad.x + fPad.w / 2; ty = fPad.y + fPad.h / 2; }
        else { tx = (fb.obj.x + fb.obj.w / 2) * TILE; ty = (fb.obj.y + fb.obj.h) * TILE; }
        callout = 'GRAB KIBBLE';
        subText = 'Stand on the pad in front of the 🍖 Food Bin to grab a kibble bowl!';
        col = '#ffe082';
      }
    }
  } else if (step.id === 'build_water') {
    padTarget('pad_water', 'waterbowl', 'BUILD WATER FOUNTAIN ($55)');
  } else if (step.id === 'scoop') {
    var tb = padTarget('pad_trash', 'trash', 'BUILD POOP BIN ($40)');
    if (tb.built) {
      if (car && car.type === 'poop') {
        var tPad = stationPad(tb.obj);
        if (tPad) { tx = tPad.x + tPad.w / 2; ty = tPad.y + tPad.h / 2; }
        else { tx = (tb.obj.x + tb.obj.w / 2) * TILE; ty = (tb.obj.y + tb.obj.h) * TILE; }
        callout = 'TOSS IN POOP BIN';
        subText = 'Walk onto the 🗑️ Poop Bin pad to toss the poop bag away!';
        col = '#cfd8dc';
      } else if (S.poops.length) {
        tx = S.poops[0].x; ty = S.poops[0].y;
        callout = 'SCOOP POOP';
        subText = 'Walk over the 💩 poop in the yard to scoop it up!';
        col = '#ffe082';
      }
    }
  } else if (step.id === 'build_toy') {
    var tyb = padTarget('pad_toybox', 'toybox', 'BUILD TOY BOX ($65)');
    if (tyb.built) {
      if (car && car.type === 'ball') {
        if (d) { tx = d.x; ty = d.y; }
        callout = 'PLAY FETCH!';
        subText = 'Walk over to ' + dName + ' with the ball to play fetch 🎾!';
        col = '#8bf06e';
      } else {
        var tyPad = stationPad(tyb.obj);
        if (tyPad) { tx = tyPad.x + tyPad.w / 2; ty = tyPad.y + tyPad.h / 2; }
        else { tx = (tyb.obj.x + tyb.obj.w / 2) * TILE; ty = (tyb.obj.y + tyb.obj.h) * TILE; }
        callout = 'GRAB BALL';
        subText = 'Stand on the 🎾 Toy Box pad to grab a tennis ball!';
        col = '#ffe082';
      }
    }
  } else if (step.id === 'build_tub') {
    var tubB = padTarget('pad_tub', 'tub', 'BUILD BATH TUB ($110)');
    if (tubB.built) {
      if (car && car.type === 'dog') {
        var bPad = stationPad(tubB.obj);
        if (bPad) { tx = bPad.x + bPad.w / 2; ty = bPad.y + bPad.h / 2; }
        else { tx = (tubB.obj.x + tubB.obj.w / 2) * TILE; ty = (tubB.obj.y + tubB.obj.h) * TILE; }
        callout = 'WASH IN BATH TUB';
        subText = 'Walk onto the 🛁 Bath Tub pad to give ' + dName + ' a bubble bath!';
        col = '#80d8ff';
      } else {
        if (d) { tx = d.x; ty = d.y; }
        callout = 'LEASH FOR BATH';
        subText = 'Walk up to muddy ' + dName + ' to leash them for a bath 🛁!';
        col = '#80d8ff';
      }
    }
  } else if (step.id === 'return') {
    if (car && car.type === 'dog') {
      tx = ACTION_BOX.x + ACTION_BOX.w / 2; ty = ACTION_BOX.y + ACTION_BOX.h / 2;
      callout = 'RETURN AT SERVE PAD';
      subText = 'Walk back to the SERVE pad behind the counter to return ' + dName + ' to their owner!';
      col = '#ffd54a';
    } else if (d && d.state === 'bath') {
      tx = d.x; ty = d.y;
      callout = 'FINISHING BATH…';
      subText = dName + ' is finishing their bath while their owner arrives at the counter!';
      col = '#80d8ff';
    } else {
      if (d) { tx = d.x; ty = d.y; }
      callout = 'LEASH ' + dName.toUpperCase();
      subText = dName + '\'s owner is at the counter for pickup! Walk to ' + dName + ' in the yard to leash them.';
      col = '#ffe082';
    }
  }
  return { stepNum: step.stepNum, total: step.total, id: step.id, text: step.text, subText: subText, callout: callout, tx: tx, ty: ty, col: col };
}
function assignNeed(d) {
  var ph = dayPhase().id;
  var canFood = hasAnyType('foodbin') || S.tutorial.pet;
  var canPlay = hasAnyType('toybox') || S.tutorial.feed;
  var canBath = hasAnyType('tub') || S.tutorial.build_toy;
  var w = {
    food: canFood ? (ph === 'midday' ? 2.3 : 1.1) : 0.15,
    play: canPlay ? (ph === 'midday' ? 2.1 : ph === 'morning' ? 1.4 : 0.9) : 0,
    pet: ph === 'naptime' ? 2.2 : 1.3,
    bath: canBath ? 0.5 : 0
  };
  if (hasTrait(d, 'glutton') && canFood) w.food += 1.5;
  if (hasTrait(d, 'zoomies') && canPlay) w.play += 1.5;
  if (hasTrait(d, 'cuddly')) w.pet += 1.5;
  if (hasTrait(d, 'nervous')) w.pet += 0.8;
  if (hasTrait(d, 'mud') && canBath) w.bath += 1.2;
  if (hasTrait(d, 'water') && canBath) w.bath += 0.4;
  if (d.lastNeed && w[d.lastNeed]) w[d.lastNeed] *= 0.35; // a bit of variety
  var tot = 0, k; for (k in w) tot += w[k];
  var r = Math.random() * tot, type = 'pet';
  for (k in w) { r -= w[k]; if (r <= 0) { type = k; break; } }
  if (type === 'food' && hasTrait(d, 'picky') && hasDone('treatjar')) type = 'treat';
  d.need = { type: type, t: 0 }; d.lastNeed = type;
  d.path = null; d.seekObj = null; d.state = 'idle'; d.idleT = 1e9;
  // self-service: with the right facilities some needs are met without you
  if (type === 'food' && hasDone('autofeeder')) { var f = S.objects.filter(function (o) { return o.type === 'autofeeder' && o.done; }); d.need.self = 'feeder'; goToObject(d, pick(f)); }
  else if (type === 'play' && Math.random() < 0.6) { var z = S.objects.filter(function (o) { return o.done && (o.type === 'playzone' || o.type === 'agility' || o.type === 'pool'); }); if (z.length) { d.need.self = 'zone'; goToObject(d, pick(z), true); } }
  if (!d.need.self) { setAnim(d, type === 'food' || type === 'treat' ? 'beg' : type === 'play' ? 'playbow' : type === 'bath' ? 'scratch' : 'sit', 1e9); sfx('bark', d); }
  float(d.x, d.y - 60, d.name + ' ' + NEED_INFO[type].says + '!', '#fff3c4');
}
function goToObject(d, o, inside) {
  var b = bfs(tileOf(d.x), tileOf(d.y)), spots = [];
  if (inside) { for (var y = o.y; y < o.y + o.h; y++) for (var x = o.x; x < o.x + o.w; x++) spots.push([x, y]); }
  else spots = [[o.x, o.y + o.h], [o.x - 1, o.y], [o.x + o.w, o.y], [o.x, o.y - 1]];
  spots = spots.filter(function (s) { return dogWalkable(s[0], s[1]) && b.dist[s[1] * W + s[0]] >= 0; });
  if (!spots.length) { if (d.need) d.need.self = null; return; }
  var s = pick(spots), path = pathTo(b, s[0], s[1]);
  d.seekObj = o.id; d.anim = null;
  if (path && path.length) { d.path = path; d.state = 'wander'; d.ox = rand(-8, 8); d.oy = rand(-6, 8); }
}
function fulfillNeed(d, how) {
  var n = d.need; if (!n) return;
  d.happy = Math.min(100, d.happy + (how === 'self' ? 16 : 28));
  var favMap = { pet: 'pets', play: 'play', food: 'food', treat: 'treat', bath: 'bath' };
  if (how !== 'self' && d.fav === favMap[n.type]) { d.happy = Math.min(100, d.happy + 10); float(d.x, d.y - 70, '★ Favourite!', '#ffd54a'); burst(d.x, d.y - 36, 'star', 6); }
  d.need = null; d.anim = null; d.seekObj = null; d.needCool = (S.clock || 0) + 55; // a dog you just helped stays content for a while
  if (d.state === 'idle') d.idleT = rand(1, 2.5);
  burst(d.x, d.y - 34, 'heart', how === 'self' ? 3 : 6); d.mood = 1.2;
  gainXP(how === 'self' ? 2 : 5);
}
function updateDirector(dt) {
  var active = S.dogs.filter(function (d) { return d.need; }).length;
  // When no dog currently has a need, trigger the next dog activity quickly so the keeper always has fun things to do!
  if (active === 0 && S.needT > 4.5) S.needT = 4.5;
  S.needT = (S.needT == null ? 5 : S.needT) - dt;
  if (S.needT <= 0) {
    var nIn = S.dogs.filter(function (d) { return d.checkedIn && d.state !== 'leaving'; }).length;
    var packPace = nIn <= 2 ? 1.05 : 0.9;
    var phasePace = dayPhase().id === 'naptime' ? 1.3 : 1;
    S.needT = rand(7, 12) * packPace * phasePace * (settings.difficulty === 'relaxed' ? 1.3 : settings.difficulty === 'hectic' ? 0.75 : 1);
    if (active < maxNeeds()) {
      var c = S.dogs.filter(careable);
      if (c.length) { var tot = 0; c.forEach(function (d) { d._w = hasTrait(d, 'chill') ? 0.5 : 1; tot += d._w; }); var r = Math.random() * tot; for (var i = 0; i < c.length; i++) { r -= c[i]._w; if (r <= 0) { assignNeed(c[i]); break; } } }
    }
  }
}

// ================= Daytime Yard & Shop Chores (keeps player busy & recovers Star Rating!) =================
var CHORE_TYPES = [
  { kind: 'rake',  icon: '🍂', label: 'Sweep yard leaves',     cash: 3, rep: 0.05, xp: 3, where: 'yard' },
  { kind: 'water', icon: '💧', label: 'Pour fresh cool water', cash: 4, rep: 0.05, xp: 3, where: 'yard' },
  { kind: 'bone',  icon: '🦴', label: 'Hide surprise bone',    cash: 5, rep: 0.06, xp: 4, where: 'yard' },
  { kind: 'toys',  icon: '🧸', label: 'Tidy scattered toys',   cash: 3, rep: 0.05, xp: 3, where: 'yard' },
  { kind: 'brush', icon: '🪮', label: 'Prep grooming station', cash: 4, rep: 0.05, xp: 3, where: 'yard' },
  { kind: 'desk',  icon: '✨', label: 'Polish front counter',  cash: 4, rep: 0.06, xp: 3, where: 'shop' },
];
function spawnChore() {
  if (!S) return false;
  if (!Array.isArray(S.chores)) S.chores = [];
  if (S.chores.length >= 2) return false;
  var usedKinds = {};
  S.chores.forEach(function (c) { usedKinds[c.kind] = 1; });
  var pool = CHORE_TYPES.filter(function (ct) { return !usedKinds[ct.kind]; });
  if (!pool.length) return false;
  var def = pick(pool), wx, wy;
  if (def.where === 'shop') {
    wx = 12.2 * TILE; wy = 24.3 * TILE;
  } else {
    var spots = [];
    for (var ty = 19; ty <= 30; ty++) for (var tx = 19; tx <= 30; tx++) {
      if (dogWalkable(tx, ty) && !objAt(tx, ty)) {
        var px = (tx + 0.5) * TILE, py = (ty + 0.5) * TILE;
        if (dist(px, py, S.player.x, S.player.y) > 70 && !S.chores.some(function (c) { return dist(px, py, c.x, c.y) < 110; })) {
          spots.push([px, py]);
        }
      }
    }
    if (!spots.length) return false;
    var sp = pick(spots); wx = sp[0]; wy = sp[1];
  }
  S.chores.push({ id: nid(), kind: def.kind, icon: def.icon, label: def.label, cash: def.cash, rep: def.rep, xp: def.xp, x: wx, y: wy, age: 0 });
  return true;
}
function updateChores(dt) {
  if (!S) return;
  if (!Array.isArray(S.chores)) S.chores = [];
  for (var i = 0; i < S.chores.length; i++) S.chores[i].age += dt;
  // Spawn chores faster when star rating is low (<3.0★) or when waiting for dogs/owners!
  var fast = S.rep < 3.0 || S.dogs.every(function (d) { return !d.need; });
  S.choreT = (S.choreT == null ? 4 : S.choreT) - dt;
  if (S.choreT <= 0) {
    S.choreT = fast ? rand(5, 8) : rand(9, 14);
    if (S.chores.length < 2) spawnChore();
  }
}
function doChore(ch) {
  if (!S || !ch) return;
  var idx = S.chores ? S.chores.indexOf(ch) : -1;
  if (idx >= 0) S.chores.splice(idx, 1);
  S.cash += ch.cash; S.stats.earned += ch.cash; S.life.earned += ch.cash;
  gainXP(ch.xp || 3);
  boostRep(ch.rep || 0.05, ch.x, ch.y - 54);
  burst(ch.x, ch.y - 10, 'sparkle', 10);
  coinFly(ch.x, ch.y - 20, 3);
  float(ch.x, ch.y - 34, '+' + fmtMoney(ch.cash) + ' · ' + ch.icon + ' Done!', '#b9f6ca', 1.15);
  pEmote('happy', 0.45);
  sfx('coin');
  // Bonus interaction: if it was a surprise bone or fresh water, nearby dogs cheer up!
  S.dogs.forEach(function (d) {
    if (d.checkedIn && dist(d.x, d.y, ch.x, ch.y) < 180) {
      d.happy = Math.min(100, d.happy + 6);
      burst(d.x, d.y - 28, 'heart', 3);
    }
  });
  saveGame();
}
function runRepCampaign(kind) {
  if (!S) return false;
  var cost = kind === 'ad' ? 95 : 35;
  var gain = kind === 'ad' ? 0.80 : 0.35;
  var title = kind === 'ad' ? '📸 Pet Magazine Feature' : '🍪 Free Pup Cup Social';
  if (S.cash < cost) { toast('Need ' + fmtMoney(cost) + ' for ' + title, 'bad'); sfx('error'); return false; }
  if (S.rep >= 5.0) { toast('⭐ Your daycare is already at a perfect 5.0★ rating!', 'good'); return false; }
  S.cash -= cost; S.stats.spent += cost;
  var oldRep = S.rep;
  S.rep = clamp(S.rep + gain, 0.5, 5.0);
  markDirty();
  S.dogs.forEach(function (d) { if (d.checkedIn) { d.happy = Math.min(100, d.happy + 10); burst(d.x, d.y - 30, 'heart', 5); } });
  confetti(S.player.x, S.player.y - 50, 35);
  sfx('perfect');
  toast('⭐ ' + title + '! Star Rating: ' + oldRep.toFixed(1) + '★ → ' + S.rep.toFixed(1) + '★ (Max ' + capacity() + ' dogs!)', 'good');
  if (S.arrivalTimer > 4) S.arrivalTimer = 4;
  saveGame();
  return true;
}
function dropPoop(d) {
  var ptx = tileOf(d.x - d.face * 16), pty = tileOf(d.y + 2), px2 = d.x - d.face * 16, py2 = d.y + 2;
  if (!dogWalkable(ptx, pty)) { px2 = d.x; ptx = tileOf(d.x); pty = tileOf(d.y); }
  if (!dogWalkable(ptx, pty + 1)) py2 = Math.min(py2, pty * TILE + 14);
  S.poops.push({ id: nid(), x: px2, y: py2, age: 0, seed: Math.random() });
  float(d.x, d.y - 48, 'Oops!', '#d7ccc8');
  d.stepped.push(S.poops[S.poops.length - 1].id);
}

// ================= My Mini Mart proximity & carry-stack interactions =================
var DWELL = { key: null, t: 0, lock: null };
var PAD_FILL = { id: null, prog: 0, coinT: 0 };
function stackCap() { return ((window.GAME_CONFIG && window.GAME_CONFIG.stackCapacity) || 2) + upLvl('scooper'); }
function poopCap() { return 2 + upLvl('scooper'); }
function carryLabel(c) {
  if (!c) return '';
  var n = c.n || 1;
  var base = c.type === 'food' ? 'food bowl' : c.type === 'ball' ? 'ball' : c.type === 'treat' ? 'treat' : c.type === 'poop' ? 'poop bag' : 'dog';
  return n > 1 ? (n + '× ' + base + 's') : base;
}
function pEmote(name, dur) { var p = S.player; p.emote = name; p.emoteT = 0; p.emoteDur = dur || 0.5; }
var DIRV = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
var padCache = { stamp: -1, map: {} };
function stationPad(o) {
  if (!walkGrid || _gridState !== S) buildWalk();
  if (padCache.stamp !== walkStamp) { padCache.stamp = walkStamp; padCache.map = {}; }
  var key = o.id + ':' + o.x + ',' + o.y, hit = padCache.map[key];
  if (hit !== undefined) return hit;
  var rows = [o.y + o.h, o.y - 1], pad = null;
  for (var ri = 0; ri < rows.length && !pad; ri++) {
    var ty = rows[ri], xs = [];
    for (var tx = o.x; tx < o.x + o.w; tx++) if (baseKind(tx, ty) === 'yard' && !solidForPlayer(tx, ty)) xs.push(tx);
    if (xs.length) pad = { x: xs[0] * TILE + 4, y: ty * TILE + 4, w: (xs[xs.length - 1] - xs[0] + 1) * TILE - 8, h: TILE - 8, below: ri === 0 };
  }
  padCache.map[key] = pad;
  return pad;
}
function inRect(x, y, r) { return r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h; }
var STATION_ITEM = { foodbin: 'food', toybox: 'ball', treatjar: 'treat' };
function dwellTime(kind) {
  var b = (settings && settings.standSec) || (window.GAME_CONFIG && window.GAME_CONFIG.standSeconds) || 0.55;
  if (kind === 'poop') return b * 0.75;
  if (kind === 'trash') return b * 0.75;
  if (kind === 'station') return b * 0.85;
  if (kind === 'dog') return b * 1.0;
  if (kind === 'mat') return b * 1.05;
  return b;
}
function canPlacePadObj(type, x, y) {
  var c = CAT_BY_ID[type];
  if (!c) return false;
  for (var ty = y; ty < y + c.h; ty++) for (var tx = x; tx < x + c.w; tx++) {
    if (baseKind(tx, ty) !== 'yard') return false;
    if (objAt(tx, ty)) return false;
    for (var i = 0; i < KEEP_CLEAR.length; i++) if (KEEP_CLEAR[i][0] === tx && KEEP_CLEAR[i][1] === ty) return false;
  }
  return keepsConnected(x, y, c.w, c.h);
}
function plotById(id) {
  for (var i = 0; i < PLOTS.length; i++) if (PLOTS[i].id === id) return PLOTS[i];
  return null;
}
function findPlotPadSpot(p) {
  if (!p) return null;
  var pw = 2, ph = 2;
  function validSpot(sx, sy) {
    for (var ty = sy; ty < sy + ph; ty++) for (var tx = sx; tx < sx + pw; tx++) {
      if (baseKind(tx, ty) !== 'yard') return false;
      if (objAt(tx, ty)) return false;
    }
    return true;
  }
  if (p.padX != null && p.padY != null && validSpot(p.padX, p.padY)) return [p.padX, p.padY];
  // Search border tiles inside owned yard right next to plot p
  var candidates = [];
  for (var y = Math.max(MAP.yard.y0, p.y - ph); y <= Math.min(MAP.yard.y1 - ph + 1, p.y + p.h); y++) {
    for (var x = Math.max(MAP.yard.x0, p.x - pw); x <= Math.min(MAP.yard.x1 - pw + 1, p.x + p.w); x++) {
      var touches = (x + pw === p.x && y < p.y + p.h && y + ph > p.y) ||
                    (x === p.x + p.w && y < p.y + p.h && y + ph > p.y) ||
                    (y + ph === p.y && x < p.x + p.w && x + pw > p.x) ||
                    (y === p.y + p.h && x < p.x + p.w && x + pw > p.x);
      if (touches && validSpot(x, y)) candidates.push([x, y]);
    }
  }
  if (!candidates.length) return null;
  var cx = p.x + p.w / 2, cy = p.y + p.h / 2;
  candidates.sort(function (a, b) { return dist(a[0] + 1, a[1] + 1, cx, cy) - dist(b[0] + 1, b[1] + 1, cx, cy); });
  return candidates[0];
}
function activeUnlockPads() {
  if (!S || typeof UNLOCK_PADS === 'undefined') return [];
  if (!S.builtPads) S.builtPads = {};
  var tutStepObj = !S.tutorialDone && typeof currentTutorialStep === 'function' ? currentTutorialStep() : null;
  var maxItems = !S.tutorialDone ? 1 : 2;
  var out = [], itemCount = 0;
  for (var i = 0; i < UNLOCK_PADS.length; i++) {
    if (itemCount >= maxItems) break;
    var up = UNLOCK_PADS[i];
    if (S.builtPads[up.id]) continue;
    if (!S.tutorialDone) {
      if (!up.tutStep || !tutStepObj) continue;
      var reqIdx = -1;
      for (var ti = 0; ti < TUTORIAL.length; ti++) if (TUTORIAL[ti].id === up.tutStep) { reqIdx = ti; break; }
      if (reqIdx < 0 || reqIdx > tutStepObj.idx) continue;
    }
    if (up.plot && up.plot !== 'base') {
      var reqP = plotById(up.plot);
      if (!reqP || !plotOwned(reqP)) continue;
    }
    if (up.kind === 'obj') {
      var def = CAT_BY_ID[up.type];
      if (!def) continue;
      if (!up.ignoreLvl && S.level < def.lvl) continue;
      if (up.uniqueType && S.objects.some(function (o) { return o.type === up.type; })) continue;
      if (!canPlacePadObj(up.type, up.x, up.y)) continue;
      out.push({
        id: up.id, kind: 'obj', type: up.type, x: up.x, y: up.y, w: def.w, h: def.h,
        name: def.name, icon: def.icon, cost: def.cost,
        rect: { x: up.x * TILE + 2, y: up.y * TILE + 2, w: def.w * TILE - 4, h: def.h * TILE - 4 },
      });
      itemCount++;
    } else if (up.kind === 'staff') {
      var sd = STAFF_BY_ID[up.staffId];
      if (!sd || S.level < sd.lvl || staffHired(up.staffId)) continue;
      var sw = up.w || 2, sh = up.h || 2;
      out.push({
        id: up.id, kind: 'staff', staffId: up.staffId, x: up.x, y: up.y, w: sw, h: sh,
        name: sd.name, icon: sd.icon, cost: sd.wage,
        rect: { x: up.x * TILE + 2, y: up.y * TILE + 2, w: sw * TILE - 4, h: sh * TILE - 4 },
      });
      itemCount++;
    }
  }
  // During the onboarding tutorial, hide land expansion boxes so the player focuses 100% on the current step!
  if (!S.tutorialDone) return out;
  // Stand-on Land Expansion Boxes along the border of adjacent locked plots!
  for (var pi = 0; pi < PLOTS.length; pi++) {
    var pl = PLOTS[pi];
    if (!pl.cost || plotOwned(pl)) continue;
    if (!plotAdjacent(pl)) continue;
    var spot = findPlotPadSpot(pl);
    if (!spot) continue;
    var pend = plotPending(pl);
    out.push({
      id: 'pad_plot_' + pl.id, kind: 'plot', plotId: pl.id, plot: pl,
      x: spot[0], y: spot[1], w: 2, h: 2,
      name: pl.name, icon: '🗺️', cost: pl.cost, lvl: pl.lvl, pending: pend, unlocks: pl.unlocks || [],
      rect: { x: spot[0] * TILE + 2, y: spot[1] * TILE + 2, w: 2 * TILE - 4, h: 2 * TILE - 4 },
    });
  }
  return out;
}
function updateUnlockPads(dt) {
  if (!S || UI.mode !== 'play') { PAD_FILL.id = null; PAD_FILL.prog = 0; return; }
  var pads = activeUnlockPads(), p = S.player, hit = null;
  for (var i = 0; i < pads.length; i++) {
    if (inRect(p.x, p.y, pads[i].rect)) { hit = pads[i]; break; }
  }
  if (!hit) { PAD_FILL.id = null; PAD_FILL.prog = 0; PAD_FILL.warnId = null; return; }
  if (hit.kind === 'plot') {
    if (hit.pending) { PAD_FILL.id = hit.id; PAD_FILL.prog = 0; return; }
    if (S.level < hit.lvl) {
      if (PAD_FILL.warnId !== hit.id) {
        PAD_FILL.warnId = hit.id;
        toast('🔒 Reach Level ' + hit.lvl + ' to expand ' + hit.name + (hit.unlocks.length ? ' (Unlocks ' + hit.unlocks.join(', ') + ')' : ''), 'bad');
      }
      PAD_FILL.id = hit.id; PAD_FILL.prog = 0; return;
    }
  }
  if (S.cash < hit.cost) {
    if (hit.kind === 'plot' && PAD_FILL.warnId !== hit.id) {
      PAD_FILL.warnId = hit.id;
      toast('🗺️ Expand ' + hit.name + ' (' + fmtMoney(hit.cost) + ') — Unlocks: ' + (hit.unlocks || []).join(', '), '');
    }
    PAD_FILL.id = hit.id; PAD_FILL.prog = 0;
    return;
  }
  if (PAD_FILL.id !== hit.id) { PAD_FILL.id = hit.id; PAD_FILL.prog = 0; PAD_FILL.coinT = 0; }
  PAD_FILL.prog += dt / 1.15;
  PAD_FILL.coinT -= dt;
  if (PAD_FILL.coinT <= 0) {
    PAD_FILL.coinT = 0.11;
    var cx = (hit.x + hit.w / 2) * TILE, cy = (hit.y + hit.h / 2) * TILE;
    FX.parts.push({ x: p.x, y: p.y - 34, vx: (cx - p.x) * 3.2, vy: (cy - (p.y - 34)) * 3.2 - 40, life: 0.25, max: 0.25, kind: 'coin', size: 10, grav: 120, rot: Math.random() * 6 });
    sfx('tick');
  }
  if (PAD_FILL.prog >= 1) {
    PAD_FILL.id = null; PAD_FILL.prog = 0;
    if (!S.builtPads) S.builtPads = {};
    if (hit.kind === 'obj') {
      var c = CAT_BY_ID[hit.type];
      S.cash -= c.cost; S.stats.spent += c.cost;
      S.builtPads[hit.id] = true;
      var o = addObject(hit.type, hit.x, hit.y, false);
      var ox = (o.x + o.w / 2) * TILE, oy = (o.y + o.h / 2) * TILE;
      if (!c.floor && !canStand(p.x, p.y)) { p.y = (o.y + o.h + 0.45) * TILE; }
      S.dogs.forEach(function (d) {
        if (d.state === 'leashed' || d.state === 'bath' || d.state === 'kennel' || d.state === 'leaving' || d.state === 'arriving') return;
        var tx = tileOf(d.x), ty = tileOf(d.y);
        if (tx >= o.x && tx < o.x + o.w && ty >= o.y && ty < o.y + o.h) { var t2 = nearestWalkable(d.x, d.y); d.x = (t2[0] + .5) * TILE; d.y = (t2[1] + .5) * TILE; }
      });
      burst(ox, oy, 'dust', 18); float(ox, o.y * TILE - 10, '🔨 Building ' + c.name + ' (' + fmtDur(o.buildDur || c.time) + ')', '#ffe082', 1.15);
      toast('🏗️ Started building ' + c.name + ' — finishes in ' + fmtDur(o.buildDur || c.time), 'good');
      sfx('place'); checkStationTut(hit.type);
      if (typeof MP !== 'undefined') MP.recordAction('build', { item: hit.type, name: c.name, icon: c.icon, cost: c.cost, x: hit.x, y: hit.y });
      saveGame();
    } else if (hit.kind === 'staff') {
      S.builtPads[hit.id] = true;
      toggleStaff(hit.staffId);
      var sx = (hit.x + hit.w / 2) * TILE, sy = (hit.y + hit.h / 2) * TILE;
      confetti(sx, sy, 28); tut('build');
    } else if (hit.kind === 'plot' && hit.plot) {
      buyPlot(hit.plot);
      var px = (hit.x + 1) * TILE, py = (hit.y + 1) * TILE;
      burst(px, py, 'dust', 22);
      confetti(px, py, 32);
    }
  }
}

// the zone the player is standing in, with what would happen there
function currentZone() {
  var p = S.player, car = p.carry, best = null;
  function offer(z) {
    if (!best || (best.disabled && !z.disabled) || (!!best.disabled === !!z.disabled && (z.prio || 0) > (best.prio || 0))) best = z;
  }
  // check-in mat
  if (inRect(p.x, p.y, ACTION_BOX)) {
    var busyO = S.owners.filter(function (o) { return o.state === 'toHandover' || o.state === 'handover'; })[0];
    var z = { key: 'mat', kind: 'mat', rect: ACTION_BOX, prio: 3 };
    if (busyO) {
      z.disabled = true; z.quiet = true; z.label = 'Serving customer…';
    } else if (car && car.type === 'dog') {
      var cd = dogById(car.id), ow = S.owners.filter(function (o) { return o.dogId === car.id && o.state === 'waitPickup'; })[0];
      if (!cd) { S.player.carry = null; z.disabled = true; z.quiet = true; z.label = ''; }
      else if (ow) { z.label = 'Return ' + cd.name + ' to ' + ow.name; z.run = function () { summonOwner(ow); }; z.lockKey = 'mat:' + ow.id; }
      else {
        var waitingIn = S.owners.filter(function (o) { return o.state === 'waitCheckin'; }).sort(function (a, b) { return a.patience / a.patienceMax - b.patience / b.patienceMax; });
        if (waitingIn.length) {
          var woIn = waitingIn[0], wdIn = dogById(woIn.dogId);
          z.label = 'Welcome ' + woIn.name + ' & ' + wdIn.name; z.run = function () { summonOwner(woIn); }; z.lockKey = 'mat:' + woIn.id;
        } else {
          z.label = 'Walk ' + cd.name + ' into the yard'; z.disabled = true;
        }
      }
    } else {
      var waiting = S.owners.filter(function (o) { return o.state === 'waitCheckin'; }).sort(function (a, b) { return a.patience / a.patienceMax - b.patience / b.patienceMax; });
      if (waiting.length) {
        var wo = waiting[0], wd = dogById(wo.dogId);
        z.label = 'Welcome ' + wo.name + ' & ' + wd.name + (wd.overnight ? ' (overnight)' : '');
        z.run = function () { summonOwner(wo); }; z.lockKey = 'mat:' + wo.id;
      } else {
        var fetching = S.dogs.filter(function (d) { return d.state === 'toCounter' || d.state === 'atDesk'; })[0];
        var wpOw = S.owners.filter(function (o) { return o.state === 'waitPickup'; })[0];
        var wpDog = wpOw ? dogById(wpOw.dogId) : null;
        z.label = fetching ? 'Receptionist is bringing ' + fetching.name : wpDog ? (wpOw.name + ' is waiting for ' + wpDog.name + ' (' + breedOf(wpDog).name + ') — find them in the yard!') : 'SERVE pad — customers check in here';
        z.disabled = true; z.quiet = true;
      }
    }
    offer(z);
  }
  // station mats
  S.objects.forEach(function (o) {
    if (!o.done) return;
    var t = o.type, it = STATION_ITEM[t];
    if (!it && t !== 'trash' && t !== 'tub' && t !== 'kennel') return;
    var pad = stationPad(o); if (!inRect(p.x, p.y, pad)) return;
    var z = { key: 'obj' + o.id, kind: t === 'trash' ? 'trash' : 'station', rect: pad, obj: o, prio: 2 };
    if (it) {
      var maxS = stackCap();
      var itemTitle = it === 'food' ? 'food bowl' : it === 'ball' ? 'ball' : 'treat';
      if (!car || (car.type === it && (car.n || 1) < maxS)) {
        var nextN = (car && car.type === it ? (car.n || 1) : 0) + 1;
        z.label = 'Stack ' + itemTitle + ' (' + nextN + '/' + maxS + ')';
        z.lockKey = 'obj' + o.id + ':' + nextN;
        z.run = function () { grab(it, o); };
      } else if (car && car.type !== 'dog' && car.type !== 'poop' && car.type !== it) {
        z.label = 'Switch to ' + itemTitle;
        z.lockKey = 'obj' + o.id + ':swap:' + it;
        z.run = function () { S.player.carry = null; grab(it, o); };
      } else if (car && car.type === it) {
        z.label = 'Stack full (' + maxS + '/' + maxS + ')'; z.disabled = true; z.quiet = true;
      } else {
        z.label = 'Hands full'; z.disabled = true;
      }
    } else if (t === 'trash') {
      if (car && car.type === 'poop') { z.label = 'Toss poop away'; z.run = function () { o.useAt = now; doTrash(); }; }
      else if (car && car.type !== 'dog') { z.label = 'Clear ' + carryLabel(car); z.run = function () { o.useAt = now; S.player.carry = null; sfx('trash'); }; }
      else { z.label = 'Poop Bin'; z.disabled = true; z.quiet = true; }
    } else if (t === 'tub') {
      if (o.dogId) { var bd = dogById(o.dogId); z.label = (bd ? bd.name : 'A dog') + ' is getting scrubbed…'; z.disabled = true; z.quiet = true; }
      else if (car && car.type === 'dog') { z.label = 'Give ' + dogById(car.id).name + ' a bath'; z.run = function () { doWash(o); }; }
      else { z.label = 'Bath Tub — walk a muddy dog here'; z.disabled = true; z.quiet = true; }
    } else if (t === 'kennel') {
      if (car && car.type === 'dog') {
        var kd = dogById(car.id);
        if (o.dogId) { z.label = 'This kennel is taken'; z.disabled = true; }
        else if (o.reservedFor && o.reservedFor !== kd.id) { z.label = 'Reserved for ' + (dogById(o.reservedFor) || {}).name; z.disabled = true; }
        else { z.label = 'Tuck ' + kd.name + ' in for a nap'; z.run = function () { doKennel(o, kd); }; }
      } else if (!car && o.dogId) { var nd = dogById(o.dogId); z.label = 'Take ' + nd.name + ' out of the kennel'; z.run = function () { doLeash(nd); }; }
      else { z.label = 'Kennel'; z.disabled = true; z.quiet = true; }
    }
    offer(z);
  });
  // dogs that need you, whose owner is waiting, OR that you can play/train/cuddle with anytime!
  S.dogs.forEach(function (d) {
    if (!(d.state === 'idle' || d.state === 'wander' || d.state === 'nap' || d.state === 'eat' || d.state === 'play')) return;
    var wanted = d.called && S.owners.some(function (o) { return o.dogId === d.id && o.state === 'waitPickup'; });
    var hasNeed = !!(d.need && !d.need.self);
    var canBonusCare = d.checkedIn && !wanted && !hasNeed && !(d.careCd > (S.clock || 0)) && d.state !== 'play' && d.state !== 'eat';
    if (!wanted && !hasNeed && !canBonusCare) return;
    var dd = dist(p.x, p.y, d.x, d.y); if (dd > 54) return;
    var z = { key: 'dog' + d.id, kind: 'dog', dog: d, prio: (wanted || hasNeed ? 4 : 2.8) - dd / 100 };
    var holdingDog = car && car.type === 'dog';
    if (wanted && !holdingDog) {
      var wo2 = S.owners.filter(function (o) { return o.dogId === d.id; })[0];
      z.label = 'Leash ' + d.name + ' for ' + (wo2 ? wo2.name : 'pickup');
      z.run = function () { doLeash(d); };
    } else if (wanted) {
      z.label = 'Return your current dog first'; z.disabled = true;
    } else if (hasNeed) {
      var n = d.need.type, info = NEED_INFO[n];
      if (n === 'pet' && !holdingDog) { z.label = 'Cuddle ' + d.name; z.run = function () { doPet(d); }; }
      else if (n === 'bath' && !holdingDog) { z.label = 'Leash ' + d.name + ' for a bath'; z.run = function () { doLeash(d); }; }
      else if (car && car.type === 'food' && (n === 'food' || n === 'treat')) { z.label = 'Feed ' + d.name; z.run = function () { doFeed(d); }; }
      else if (car && car.type === 'treat' && (n === 'treat' || n === 'food')) { z.label = 'Give ' + d.name + ' a treat'; z.run = function () { doTreat(d); }; }
      else if (car && car.type === 'ball' && n === 'play') { z.label = 'Play fetch with ' + d.name; z.run = function () { doPlay(d); }; }
      else { z.label = d.name + ' ' + info.wantText; z.disabled = true; }
    } else if (canBonusCare && !holdingDog && !(car && car.type === 'poop')) {
      if (car && car.type === 'ball') { z.label = '🎾 Play bonus fetch with ' + d.name + ' (+$2 · +★)'; z.run = function () { doPlay(d, true); }; }
      else if (car && car.type === 'treat') { z.label = '🍪 Teach ' + d.name + ' a trick (+$2 · +★)'; z.run = function () { doTreat(d, true); }; }
      else if (car && car.type === 'food') { z.label = '🍖 Give ' + d.name + ' a snack (+$2 · +★)'; z.run = function () { doFeed(d, true); }; }
      else if (!car) { z.label = '❤️ Cuddle & brush ' + d.name + ' (+$1 · +★)'; z.run = function () { doPet(d, true); }; }
    } else {
      return;
    }
    offer(z);
  });
  // daytime yard & shop chores — walk over to complete for instant cash & Star Rating recovery!
  if (!car || car.type !== 'dog') (S.chores || []).forEach(function (ch) {
    var cd = dist(p.x, p.y, ch.x, ch.y);
    if (cd > 44) return;
    offer({
      key: 'chore' + ch.id, kind: 'station', chore: ch, prio: 3.4 - cd / 100,
      label: ch.icon + ' ' + ch.label + ' (+' + fmtMoney(ch.cash) + ' · +★)',
      run: function () { doChore(ch); }
    });
  });
  // poop — instant walk-over scoop!
  if (!car || car.type !== 'dog') S.poops.forEach(function (pp) {
    if (dist(p.x, p.y, pp.x, pp.y) > 38) return;
    var z = { key: 'poop' + pp.id, kind: 'poop', poop: pp, prio: 5 }, bag = car && car.type === 'poop';
    if (!car || (car.type !== 'poop' && car.type !== 'dog')) { z.label = 'Scoop poop'; z.run = function () { doScoop(pp); }; }
    else if (bag && (car.n || 1) < poopCap()) { z.label = 'Scoop (' + ((car.n || 1) + 1) + '/' + poopCap() + ')'; z.run = function () { doScoop(pp); }; }
    else if (bag) { z.label = 'Scooper full — pass by the Poop Bin'; z.disabled = true; }
    offer(z);
  });
  if (best) { best.time = dwellTime(best.kind); if (!best.lockKey) best.lockKey = best.key; }
  return best;
}
function updateDwell(dt) {
  updateUnlockPads(dt);
  var z = UI.mode === 'play' ? currentZone() : null;
  UI.zone = z;
  if (!z || (z.lockKey !== DWELL.lock && !(z.disabled && z.key === 'mat'))) DWELL.lock = null;
  if (!z || z.disabled || z.lockKey === DWELL.lock) { DWELL.key = z ? z.lockKey : null; DWELL.t = 0; return; }
  if (DWELL.key !== z.lockKey) { DWELL.key = z.lockKey; DWELL.t = 0; }
  DWELL.t += dt;
  if (DWELL.t >= z.time) { DWELL.t = 0; DWELL.lock = z.lockKey; z.run(); sfx('pop'); }
}
function triggerZoneNow() {
  var z = currentZone();
  if (z && !z.disabled && z.lockKey !== DWELL.lock) { DWELL.t = 0; DWELL.lock = z.lockKey; z.run(); return true; }
  if (z && z.disabled && !z.quiet) { float(S.player.x, S.player.y - 92, z.label, '#ffcdd2'); sfx('error'); }
  return false;
}
function qAction() {
  var car = S.player.carry; if (!car) return null;
  if (car.type === 'dog') { var d = dogById(car.id); return canReleaseAt(S.player.x, S.player.y) ? { label: 'Let ' + (d ? d.name : 'dog') + ' go', run: doRelease } : { label: 'Walk into the yard to let go', disabled: true }; }
  return { label: 'Drop ' + carryLabel(car), run: function () {
    var p2 = S.player;
    if (car.type === 'poop') { if (baseKind(tileOf(p2.x), tileOf(p2.y)) === 'yard') { for (var pi = 0; pi < (car.n || 1); pi++) S.poops.push({ id: nid(), x: p2.x + p2.face * 16 + pi * 9, y: p2.y + 4 + (pi % 2) * 6, age: car.age || 0, seed: Math.random() }); } else { float(p2.x, p2.y - 80, 'Not indoors!', '#ffcdd2'); sfx('error'); return; } }
    S.player.carry = null; sfx('pop'); } };
}
function canReleaseAt(px, py) {
  var tx = tileOf(px), ty = tileOf(py);
  for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) if (dogWalkable(tx + dx, ty + dy)) return true;
  return false;
}
function grab(it, ob) {
  var car = S.player.carry, maxS = stackCap();
  if (car && car.type === it) {
    car.n = Math.min(maxS, (car.n || 1) + 1);
  } else {
    S.player.carry = { type: it, n: 1 };
  }
  if (ob) ob.useAt = now;
  sfx('pop'); pEmote('scoop', 0.28);
  float(S.player.x, S.player.y - 74, S.player.carry.n + ' / ' + maxS, '#fff8e1', 0.95);
}
function consumeCarryItem() {
  var car = S.player.carry;
  if (!car) return;
  if ((car.n || 1) > 1) car.n--;
  else S.player.carry = null;
}

// ----- owners meet you on the check-in mat -----
function summonOwner(o, byStaff) {
  o.byStaff = !!byStaff;
  o.state = 'toHandover'; o.slot = null; o.route = [[HANDOVER_SPOT[0] * TILE, HANDOVER_SPOT[1] * TILE]]; o.hoT = 0; o.emote = null; o.awayT = 0;
  o.say = o.kind === 'dropoff' ? pick(['Hi! This is ' + dogById(o.dogId).name + '.', 'Here we are!', 'Thanks for having us!']) : pick(['There you are!', 'Hello again!', 'Was my baby good?']); o.sayT = 1.8;
}
function doCheckIn(o) {
  var d = dogById(o.dogId);
  if (!d) return;
  o.state = 'walkOut'; o.route = exitRoute(o); o.say = pick(['Be good, ' + d.name + '!', 'Thank you!', 'See you this afternoon!', 'Have fun, buddy!']); o.sayT = 2.2; o.emote = 'wave'; o.emoteT = 0;
  d.checkedIn = true; d.anim = null; d.poopT = nextPoopDelay(d, false); d.ownerId = null;
  // My Mini Mart flow: newly checked-in dogs trot happily through the side door into the yard on their own!
  d.state = 'toYard'; d.route = [SHOP_WAY.gapN, SHOP_WAY.door, SHOP_WAY.yard].map(function (w) { return [w[0] * TILE, w[1] * TILE]; }); d.autoRelease = false; d.leashedBy = null;
  var D = dayLen();
  if (d.overnight) { d.pickupDay = S.day + 1; d.pickupAt = rand(0.60, 0.88) * D; }
  else {
    d.pickupDay = S.day;
    var minStay = rand(0.42, 0.62) * D;
    var afternoonPickup = rand(0.68, 0.92) * D;
    d.pickupAt = clamp(Math.max(S.dayTime + minStay, afternoonPickup), S.dayTime + Math.min(75, D * 0.35), D - 10);
  }
  gainXP(4); sfx('bark', d); float(d.x, d.y - 50, 'Welcome, ' + d.name + '!', '#fff');
  burst(d.x, d.y - 24, 'sparkle', 8);
  dexSeen(d); if (d.special) specialArrived(d);
  if (!o.byStaff) {
    tut('checkin');
    if (typeof MP !== 'undefined') MP.recordAction('checkin', { dogName: d.name, breed: breedOf(d).name, overnight: !!d.overnight });
  }
  saveGame();
}
function doLeash(d) {
  if (!d) return;
  if (d.objId) { var ob = objById(d.objId); if (ob) ob.dogId = null; d.objId = null; }
  d.state = 'leashed'; d.path = null; d.anim = null; d.seekObj = null; d.autoRelease = false; d.leashedBy = typeof MP !== 'undefined' ? MP.playerId : null; S.player.carry = { type: 'dog', id: d.id };
  sfx('leash'); float(d.x, d.y - 44, 'Come on, ' + d.name + '!', '#fff');
  if (typeof MP !== 'undefined') MP.sendWorldSync(false);
  saveGame();
}
function doRelease() {
  var p = S.player, d = p.carry ? dogById(p.carry.id) : null; p.carry = null;
  if (!d) { saveGame(); return; }
  var v = DIRV[p.dir] || [0, 0];
  var t = nearestWalkable(p.x + v[0] * 24, p.y + v[1] * 24);
  if (!dogWalkable(tileOf(d.x), tileOf(d.y))) { d.x = (t[0] + 0.5) * TILE; d.y = (t[1] + 0.5) * TILE; }
  d.state = 'idle'; d.idleT = 0.8; d.path = null; d.autoRelease = false; d.leashedBy = null;
  if (d.need) { d.idleT = 1e9; } else setAnim(d, 'jump', 0.75);
  sfx('pop'); tut('release');
  if (typeof MP !== 'undefined') MP.sendWorldSync(false);
  saveGame();
}
function doPet(d, isBonus) {
  if (!d || d.petCd > 0) return;
  d.petCd = 0.35;
  d.careCd = (S.clock || 0) + 10;
  burst(d.x, d.y - 34, 'heart', 5); sfx('pet', d); S.stats.pets++;
  if (d.state === 'wander') { d.state = 'idle'; d.idleT = 1.2; d.path = null; }
  if (d.need && d.need.type === 'pet') fulfillNeed(d); else d.happy = Math.min(100, d.happy + 6);
  if (isBonus) { S.cash += 1; S.stats.earned += 1; S.life.earned += 1; float(d.x, d.y - 52, '+$1 Cuddle!', '#ffe66d'); }
  boostRep(0.02, d.x, d.y - 70);
  if (d.state !== 'kennel' && d.state !== 'leashed') setAnim(d, 'wiggle', 1.0);
  pEmote('pet', 0.4); tut('pet');
  if (typeof MP !== 'undefined') MP.recordAction('pet', { dogName: d.name });
  saveGame();
}
function doFeed(d, isBonus) {
  if (!d) return;
  consumeCarryItem();
  d.careCd = (S.clock || 0) + 10;
  if (hasTrait(d, 'picky')) float(d.x, d.y - 62, 'Hmph. Kibble again?', '#ffe0b2');
  if (d.need && (d.need.type === 'food' || d.need.type === 'treat')) { fulfillNeed(d); if (hasTrait(d, 'picky') && d.need == null) d.happy -= 8; }
  else d.happy = Math.min(100, d.happy + 7);
  var bonus = upLvl('kibble') * 5 + (stationLvl('foodbin') - 1) * 3;
  if (bonus > 0) d.happy = Math.min(100, d.happy + bonus);
  if (isBonus) { S.cash += 2; S.stats.earned += 2; S.life.earned += 2; }
  boostRep(0.025, d.x, d.y - 68);
  d.state = 'eat'; d.actT = 2.4; d.path = null; d.anim = null; d.poopT = Math.min(d.poopT || 1e9, nextPoopDelay(d, true));
  burst(d.x, d.y - 20, 'crumb', 8); sfx('munch'); gainXP(2); tut('build_food'); tut('feed'); S.stats.feeds++;
  float(d.x, d.y - 48, isBonus ? '+$2 Snack!' : 'Nom nom!', '#fff'); pEmote('pet', 0.35);
  if (typeof MP !== 'undefined') MP.recordAction('feed', { dogName: d.name });
  saveGame();
}
function doTreat(d, isBonus) {
  if (!d) return;
  consumeCarryItem();
  d.careCd = (S.clock || 0) + 10;
  var tBonus = (stationLvl('treatjar') - 1) * 4;
  if (d.need && (d.need.type === 'food' || d.need.type === 'treat')) fulfillNeed(d); else d.happy = Math.min(100, d.happy + 10 + tBonus);
  if (tBonus > 0) d.happy = Math.min(100, d.happy + tBonus);
  if (isBonus) { S.cash += 2; S.stats.earned += 2; S.life.earned += 2; }
  boostRep(0.03, d.x, d.y - 68);
  burst(d.x, d.y - 28, 'heart', 6); sfx('munch'); gainXP(2); tut('feed'); S.stats.feeds++;
  if (d.state === 'wander') { d.state = 'idle'; d.idleT = 1.5; d.path = null; }
  setAnim(d, 'beg', 1.2);
  float(d.x, d.y - 48, isBonus ? '+$2 Good trick!' : 'Yum!', '#fff'); pEmote('pet', 0.35);
  if (typeof MP !== 'undefined') MP.recordAction('treat', { dogName: d.name });
  saveGame();
}
function doPlay(d, isBonus) {
  if (!d) return;
  consumeCarryItem();
  d.careCd = (S.clock || 0) + 10;
  if (d.need && d.need.type === 'play') fulfillNeed(d); else d.happy = Math.min(100, d.happy + 9);
  var pBonus = (stationLvl('toybox') - 1) * 3;
  if (pBonus > 0) d.happy = Math.min(100, d.happy + pBonus);
  if (isBonus) { S.cash += 2; S.stats.earned += 2; S.life.earned += 2; }
  boostRep(0.03, d.x, d.y - 68);
  d.state = 'play'; d.actT = 3.5; d.path = null; d.playA = Math.random() * 6.28; d.anim = null;
  sfx('bark', d); sfx('whoosh'); burst(d.x, d.y - 24, 'star', 6); gainXP(2); S.stats.fetches++;
  tut('build_toy');
  FX.parts.push({ x: S.player.x, y: S.player.y - 50, vx: (d.x - S.player.x) * 1.2 + rand(-40, 40), vy: -220, life: 1.1, max: 1.1, kind: 'ball', size: 7, grav: 520 });
  float(d.x, d.y - 48, isBonus ? '+$2 Fetch!!' : 'Fetch!!', '#fff'); pEmote('happy', 0.45);
  if (typeof MP !== 'undefined') MP.recordAction('play', { dogName: d.name });
  saveGame();
}
function doScoop(pp) {
  var idx = S.poops.indexOf(pp); if (idx >= 0) S.poops.splice(idx, 1);
  sfx('scoop'); burst(pp.x, pp.y, 'dust', 6); pEmote('scoop', 0.35); S.stats.scoops++;
  var car = S.player.carry;
  if (car && car.type === 'poop') { car.n = (car.n || 1) + 1; float(pp.x, pp.y - 30, car.n + ' / ' + poopCap(), '#d7ccc8'); }
  else { S.player.carry = { type: 'poop', age: pp.age, n: 1 }; float(pp.x, pp.y - 30, '1 / ' + poopCap(), '#d7ccc8'); }
  if (typeof MP !== 'undefined') MP.recordAction('scoop', { count: 1 });
  saveGame();
}
function doTrash() {
  var n = (S.player.carry && S.player.carry.n) || 1;
  S.player.carry = null; sfx('trash'); gainXP((1 + stationLvl('trash')) * n); tut('build_trash'); tut('scoop');
  boostRep(0.025 * n, S.player.x, S.player.y - 102);
  float(S.player.x, S.player.y - 80, '+ Clean yard!', '#b9f6ca'); burst(S.player.x, S.player.y - 50, 'sparkle', 8);
  if (typeof MP !== 'undefined') MP.sendWorldSync(false);
  saveGame();
}
function doWash(ob) {
  var d = S.player.carry ? dogById(S.player.carry.id) : null; S.player.carry = null;
  if (!d) { saveGame(); return; }
  var tLv = (ob && ob.lvl) || 1;
  d.state = 'bath'; d.actT = Math.max(1.6, 4.2 - (tLv - 1) * 0.35); d.objId = ob.id; ob.dogId = d.id; ob.useAt = now; d.anim = null; d.autoRelease = false; d.leashedBy = null;
  d.x = (ob.x + ob.w / 2) * TILE; d.y = (ob.y + 0.75) * TILE;
  boostRep(0.035, d.x, d.y - 45);
  sfx('splash'); gainXP(2 + tLv); S.stats.baths++; tut('build_tub');
  if (typeof MP !== 'undefined') MP.recordAction('wash', { dogName: d.name });
  saveGame();
}
function doKennel(ob, d) {
  if (!d) return;
  S.player.carry = null;
  d.state = 'kennel'; d.objId = ob.id; ob.dogId = d.id; ob.useAt = now; d.anim = null; d.autoRelease = false; d.leashedBy = null;
  d.x = (ob.x + ob.w / 2) * TILE; d.y = (ob.y + ob.h - 0.3) * TILE;
  if (d.need && d.need.type !== 'bath') fulfillNeed(d, 'self');
  sfx('pop'); float(d.x, d.y - 70, 'Zzz…', '#e3f2fd');
  if (typeof MP !== 'undefined') MP.recordAction('kennel', { dogName: d.name });
  saveGame();
}
function doReturn(o) {
  var d = dogById(o.dogId), p = S.player;
  if (!d) { o.state = 'walkOut'; o.slot = null; o.route = exitRoute(o); saveGame(); return; }
  if (p.carry && p.carry.id === d.id) p.carry = null;
  var h = happiness(d), price = dogPrice(d);
  var tipRate = h >= 92 ? 0.25 : h >= 78 ? 0.14 : h >= 60 ? 0.06 : 0;
  if (hasTrait(d, 'diva')) tipRate *= 1.75;
  var complaint = h < complaintLine(d);
  if (!complaint && h >= 75) { S.streak++; S.bestStreak = Math.max(S.bestStreak, S.streak); } else S.streak = 0;
  var streakMul = 1 + Math.min(S.streak, 10) * 0.06;
  var tip = o.angry ? 0 : Math.round(price * tipRate * (1 + charm() * 0.008) * streakMul * (1 + upLvl('loyalty') * 0.15));
  var total = price + tip;
  S.cash += total; S.stats.earned += total; S.stats.tips += tip; S.stats.served++; S.totalServed++; S.life.earned += total; S.life.served++;
  if (d.overnight) S.life.overnights = (S.life.overnights || 0) + 1;
  SHOPFX.registerT = now; sfx('register');
  var reg = (typeof SHOP_POINTS !== 'undefined' && SHOP_POINTS.register) || { x: o.x, y: o.y - 50 };
  coinFly(reg.x, reg.y, Math.min(16, 4 + Math.round(total / 10)));
  float(o.x, o.y - 92, '+' + fmtMoney(price) + (tip ? '  +' + fmtMoney(tip) + ' tip' : ''), '#ffe66d', 1.3);
  var e = S.dex[d.breed]; if (e) e.best = Math.max(e.best || 0, Math.round(h));
  if (complaint) {
    var why = (d.need && NEED_INFO[d.need.type]) ? NEED_INFO[d.need.type].complaint : (d.lastNeed && NEED_INFO[d.lastNeed]) ? NEED_INFO[d.lastNeed].complaint : 'was unhappy';
    fileComplaint(o.name + ': "' + d.name + ' ' + why + '!"', 0.45);
    o.say = 'I\'m filing a complaint!'; o.sayT = 3; o.emote = 'angry'; o.emoteT = 0;
  } else {
    var g = h >= 90 ? 0.08 : h >= 75 ? 0.04 : h >= 55 ? 0.02 : 0;
    S.rep = Math.min(5, S.rep + g);
    if (h >= 90) { S.stats.perfect++; S.life.perfect++; float(o.x, o.y - 120, 'PAWSOME! ★', '#ff8ad8', 1.6); confetti(o.x, o.y - 50, 30); sfx('perfect'); o.emote = 'happy'; o.emoteT = 0; pEmote('happy', 0.8); }
    else sfx('coin');
    o.say = pick(h >= 75 ? ['Wow, so happy!', 'Best daycare ever!', 'Look at that tail go!', 'Five stars!'] : ['Thanks.', 'Okay, see you.', 'Hmm, alright.']); o.sayT = 2.5;
    if (S.streak >= 2) float(p.x, p.y - 110, 'Happy streak x' + S.streak + '!', '#80d8ff', 1.2);
  }
  gainXP(5 + Math.round(h / 18));
  d.state = 'leaving'; d.ownerId = o.id; d.anim = null; d.need = null; d.route = null; d.leashedBy = null;
  if (d.kennelId) { var k = objById(d.kennelId); if (k) k.reservedFor = null; d.kennelId = null; }
  o.state = 'walkOut'; o.slot = null; o.route = exitRoute(o);
  tut('return');
  if (typeof MP !== 'undefined' && !o.byStaff) MP.recordAction('return', { dogName: d.name, earned: total, tip: tip, perfect: h >= 90, complaint: complaint });
  saveGame();
}
function fileComplaint(text, repHit) {
  S.rep = Math.max(0.5, S.rep - repHit); S.stats.complaints++; S.stats.complaintList.push(text); S.life.complaints++;
  S.streak = 0; markDirty();
  toast('📝 Complaint filed — ' + text, 'bad'); sfx('complaint'); FX.shake = 0.45; FX.flash = 0.35;
  saveGame();
}
function gainXP(n) {
  S.xp += n;
  var leveled = false;
  while (S.xp >= lvlNeed(S.level)) {
    S.xp -= lvlNeed(S.level); S.level++; leveled = true;
    var unl = CATALOG.filter(function (c) { return c.lvl === S.level; }).map(function (c) { return c.name; })
      .concat(PLOTS.filter(function (p) { return p.lvl === S.level && p.cost; }).map(function (p) { return p.name; }))
      .concat(UPGRADES.filter(function (u) { return u.lvl === S.level; }).map(function (u) { return u.name; }));
    showLevelUp(S.level, unl);
    confetti(S.player.x, S.player.y - 50, 60); sfx('level');
    if (typeof MP !== 'undefined') MP.recordAction('levelup', { level: S.level });
  }
  if (leveled) { markDirty(); saveGame(); }
}
function tut(id) {
  if (S.tutorialDone || S.tutorial[id]) return;
  var tDef = TUTORIAL.filter(function (t) { return t.id === id; })[0];
  if (!tDef) return;
  var rew = tDef.reward || 15;
  S.tutorial[id] = true; S.cash += rew;
  toast('✅ ' + tDef.text + '  +$' + rew, 'good'); sfx('goal');
  if (TUTORIAL.every(function (t) { return S.tutorial[t.id]; })) {
    S.tutorialDone = true; S.cash += 25; toast('🎓 Training complete! +$25 bonus. Daily goals unlocked.', 'good'); confetti(S.player.x, S.player.y - 50, 50);
    rollGoals();
  }
  saveGame();
}

function canPlace(type, x, y) {
  var c = CAT_BY_ID[type];
  for (var ty = y; ty < y + c.h; ty++) for (var tx = x; tx < x + c.w; tx++) {
    if (baseKind(tx, ty) !== 'yard') return false;
    if (objAt(tx, ty)) return false;
    for (var i = 0; i < KEEP_CLEAR.length; i++) if (KEEP_CLEAR[i][0] === tx && KEEP_CLEAR[i][1] === ty) return false;
  }
  if (!c.floor || true) { if (!keepsConnected(x, y, c.w, c.h)) return false; }
  var p = S.player, r = 13;
  if (p.x + r > x * TILE && p.x - r < (x + c.w) * TILE && p.y + 5 > y * TILE && p.y - 11 < (y + c.h) * TILE) return false;
  return true;
}
// would blocking this rectangle cut off part of the yard from the yard door?
function keepsConnected(x, y, w, h) {
  if (!walkGrid || _gridState !== S) buildWalk();
  var start = YARD_ENTRY[1] * W + YARD_ENTRY[0], N = W * H;
  function flood(g, seen) {
    if (!g[start]) return -1;
    seen.fill(0);
    var q = _floodQ, qt = 0, n = 0;
    seen[start] = 1; q[qt++] = start;
    while (qt > 0) {
      var cI = q[--qt]; n++;
      var cx = cI % W, cy = (cI / W) | 0;
      if (cx + 1 < W) { var n0 = cI + 1; if (g[n0] && !seen[n0]) { seen[n0] = 1; q[qt++] = n0; } }
      if (cx > 0)     { var n1 = cI - 1; if (g[n1] && !seen[n1]) { seen[n1] = 1; q[qt++] = n1; } }
      if (cy + 1 < H) { var n2 = cI + W; if (g[n2] && !seen[n2]) { seen[n2] = 1; q[qt++] = n2; } }
      if (cy > 0)     { var n3 = cI - W; if (g[n3] && !seen[n3]) { seen[n3] = 1; q[qt++] = n3; } }
    }
    return n;
  }
  var nBefore = flood(walkGrid, _floodSeen); if (nBefore === -1) return false;
  _floodGrid.set(walkGrid);
  var lost = 0;
  for (var ty = y; ty < y + h; ty++) for (var tx = x; tx < x + w; tx++) { var idx = ty * W + tx; if (_floodGrid[idx] && _floodSeen[idx]) lost++; _floodGrid[idx] = 0; }
  var nAfter = flood(_floodGrid, _floodSeen); if (nAfter === -1) return false;
  return nAfter === nBefore - lost; // everything that was reachable (minus the footprint) still is
}
function canMoveObject(o, nx, ny) {
  if (!o) return false;
  if (o.type === 'tub' && o.dogId) return false; // wait until bath finishes
  for (var ty = ny; ty < ny + o.h; ty++) for (var tx = nx; tx < nx + o.w; tx++) {
    if (baseKind(tx, ty) !== 'yard') return false;
    var existing = objAt(tx, ty);
    if (existing && existing !== o) return false;
    for (var i = 0; i < KEEP_CLEAR.length; i++) if (KEEP_CLEAR[i][0] === tx && KEEP_CLEAR[i][1] === ty) return false;
  }
  return keepsConnectedMoving(o, nx, ny);
}
function keepsConnectedMoving(o, nx, ny) {
  if (!walkGrid || _gridState !== S) buildWalk();
  var start = YARD_ENTRY[1] * W + YARD_ENTRY[0];
  function flood(g, seen) {
    if (!g[start]) return -1;
    seen.fill(0);
    var q = _floodQ, qt = 0, n = 0;
    seen[start] = 1; q[qt++] = start;
    while (qt > 0) {
      var cI = q[--qt]; n++;
      var cx = cI % W, cy = (cI / W) | 0;
      if (cx + 1 < W) { var n0 = cI + 1; if (g[n0] && !seen[n0]) { seen[n0] = 1; q[qt++] = n0; } }
      if (cx > 0)     { var n1 = cI - 1; if (g[n1] && !seen[n1]) { seen[n1] = 1; q[qt++] = n1; } }
      if (cy + 1 < H) { var n2 = cI + W; if (g[n2] && !seen[n2]) { seen[n2] = 1; q[qt++] = n2; } }
      if (cy > 0)     { var n3 = cI - W; if (g[n3] && !seen[n3]) { seen[n3] = 1; q[qt++] = n3; } }
    }
    return n;
  }
  _floodGrid.set(walkGrid);
  // Free o's current footprint if it was solid
  if (objSolid(o)) {
    for (var oy = o.y; oy < o.y + o.h; oy++) for (var ox = o.x; ox < o.x + o.w; ox++) {
      if (ox >= 0 && oy >= 0 && ox < W && oy < H && baseKind(ox, oy) === 'yard') _floodGrid[oy * W + ox] = 1;
    }
  }
  var nBefore = flood(_floodGrid, _floodSeen); if (nBefore === -1) return false;
  if (!objSolid(o)) return true;
  var lost = 0;
  for (var ty = ny; ty < ny + o.h; ty++) for (var tx = nx; tx < nx + o.w; tx++) {
    var idx = ty * W + tx;
    if (_floodGrid[idx] && _floodSeen[idx]) lost++;
    _floodGrid[idx] = 0;
  }
  var nAfter = flood(_floodGrid, _floodSeen); if (nAfter === -1) return false;
  return nAfter === nBefore - lost;
}
function moveObject(o, nx, ny) {
  if (!canMoveObject(o, nx, ny)) { sfx('error'); return false; }
  o.x = nx; o.y = ny;
  markDirty();
  var c = CAT_BY_ID[o.type];
  if (o.dogId) {
    var kd = dogById(o.dogId);
    if (kd && kd.state === 'kennel') { kd.x = (o.x + o.w / 2) * TILE; kd.y = (o.y + o.h - 0.3) * TILE; }
  }
  if (!c.floor && !canStand(S.player.x, S.player.y)) { S.player.y = (o.y + o.h + 0.45) * TILE; }
  S.dogs.forEach(function (d) {
    if (d.state === 'leashed' || d.state === 'bath' || d.state === 'kennel' || d.state === 'leaving' || d.state === 'arriving') return;
    var tx = tileOf(d.x), ty = tileOf(d.y);
    if (tx >= o.x && tx < o.x + o.w && ty >= o.y && ty < o.y + o.h && objSolid(o)) {
      var t2 = nearestWalkable(d.x, d.y); d.x = (t2[0] + .5) * TILE; d.y = (t2[1] + .5) * TILE;
    }
    d.path = null;
  });
  if (objSolid(o)) {
    S.poops = S.poops.filter(function (pp) { var tx = tileOf(pp.x), ty = tileOf(pp.y); return !(tx >= o.x && tx < o.x + o.w && ty >= o.y && ty < o.y + o.h); });
  }
  var cx = (o.x + o.w / 2) * TILE, cy = (o.y + o.h / 2) * TILE;
  burst(cx, cy, 'dust', 14);
  float(cx, o.y * TILE - 10, '↔️ Moved ' + (c ? c.name : 'item'), '#80d8ff', 1.15);
  sfx('place');
  if (typeof MP !== 'undefined') MP.recordAction('move', { item: o.type, name: c ? c.name : o.type, icon: c ? c.icon : '↔️', x: nx, y: ny });
  saveGame();
  return true;
}
function placeBuild(type, x, y) {
  var c = CAT_BY_ID[type];
  if (!c || S.level < c.lvl || S.cash < c.cost || !canPlace(type, x, y)) { sfx('error'); return false; }
  S.cash -= c.cost; S.stats.spent += c.cost;
  var o = addObject(type, x, y, false);
  // push dogs out of the new footprint
  S.dogs.forEach(function (d) {
    if (d.state === 'leashed' || d.state === 'bath' || d.state === 'kennel' || d.state === 'leaving' || d.state === 'arriving') return;
    var tx = tileOf(d.x), ty = tileOf(d.y);
    if (tx >= o.x && tx < o.x + o.w && ty >= o.y && ty < o.y + o.h) { var t = nearestWalkable(d.x, d.y); d.x = (t[0] + .5) * TILE; d.y = (t[1] + .5) * TILE; }
    d.path = null;
  });
  S.poops = S.poops.filter(function (pp) { var tx = tileOf(pp.x), ty = tileOf(pp.y); return !(tx >= o.x && tx < o.x + o.w && ty >= o.y && ty < o.y + o.h); });
  float((x + c.w / 2) * TILE, y * TILE - 12, '-' + fmtMoney(c.cost), '#ff8a80');
  burst((x + c.w / 2) * TILE, (y + c.h / 2) * TILE, 'dust', 16); sfx('place');
  checkStationTut(type);
  if (typeof MP !== 'undefined') MP.recordAction('build', { item: type, name: c.name, icon: c.icon, cost: c.cost, x: x, y: y });
  saveGame();
  return true;
}
function rushCost(o) {
  var left = Math.max(0, (o.buildEnd - Date.now()) / 1000);
  return Math.max(15, Math.ceil(Math.pow(left, 0.78) * 1.4) + 10);
}
function objUpgradeCost(o) {
  var c = CAT_BY_ID[o.type], lv = (o && o.lvl) || 1;
  return Math.max(40, Math.round((c ? c.cost : 100) * Math.pow(1.65, lv)));
}
function objUpgradeTime(o) {
  var c = CAT_BY_ID[o.type], lv = (o && o.lvl) || 1;
  return Math.max(25, Math.round((c ? c.time : 45) * Math.pow(1.5, lv)));
}
function objUpgradeReqLvl(o) {
  var c = CAT_BY_ID[o.type], lv = (o && o.lvl) || 1;
  return (c ? c.lvl : 1) + lv;
}
function upgradeObject(o) {
  var c = o && CAT_BY_ID[o.type];
  if (!o || !c || !o.done) { sfx('error'); return false; }
  var cost = objUpgradeCost(o), req = objUpgradeReqLvl(o), dur = objUpgradeTime(o);
  if (S.level < req || S.cash < cost) { sfx('error'); return false; }
  S.cash -= cost; S.stats.spent += cost;
  o.done = false; o.upgrading = true; o.buildDur = dur; o.buildEnd = Date.now() + dur * 1000;
  markDirty();
  var cx = (o.x + o.w / 2) * TILE, cy = o.y * TILE;
  float(cx, cy - 12, '-' + fmtMoney(cost), '#ff8a80');
  burst(cx, (o.y + o.h / 2) * TILE, 'dust', 14); sfx('place');
  toast('⬆️ Upgrading ' + c.name + ' to Lv ' + ((o.lvl || 1) + 1) + ' (' + fmtDur(dur) + ')', 'good');
  saveGame();
  return true;
}
function sellValue(o) {
  var c = CAT_BY_ID[o.type], lv = (o && o.lvl) || 1;
  if (!c) return 0;
  var invested = c.cost;
  for (var i = 1; i < lv; i++) invested += Math.round(c.cost * Math.pow(1.65, i));
  return Math.floor(invested * (o.done ? 0.5 : 0.75));
}
var ESSENTIAL = { foodbin: 1, toybox: 1, trash: 1, tub: 1 };
function isLastEssential(o) { return ESSENTIAL[o.type] && o.done && S.objects.filter(function (x) { return x.type === o.type && x.done; }).length <= 1; }
function canSell(o) { return !o.dogId && !o.reservedFor && !isLastEssential(o); }
function sellObject(o) {
  if (!canSell(o)) { sfx('error'); return; }
  var val = sellValue(o), c = CAT_BY_ID[o.type];
  S.cash += val;
  S.objects.splice(S.objects.indexOf(o), 1); markDirty();
  float((o.x + o.w / 2) * TILE, o.y * TILE, '+' + fmtMoney(val), '#ffe66d');
  burst((o.x + o.w / 2) * TILE, (o.y + o.h / 2) * TILE, 'dust', 14); sfx('sell');
  S.dogs.forEach(function (d) { d.path = null; if (d.seekObj === o.id) d.seekObj = null; });
  if (typeof MP !== 'undefined') MP.recordAction('sell', { item: o.type, name: c ? c.name : o.type, icon: c ? c.icon : '💸', earned: val });
  saveGame();
}
// a plot can only be bought if it touches land that is already owned (or being cleared)
function plotAdjacent(p) {
  return PLOTS.some(function (q) {
    if (q === p || !(plotOwned(q) || plotPending(q))) return false;
    var overlapX = p.x < q.x + q.w && q.x < p.x + p.w, overlapY = p.y < q.y + q.h && q.y < p.y + p.h;
    return (overlapX && (p.y === q.y + q.h || q.y === p.y + p.h)) || (overlapY && (p.x === q.x + q.w || q.x === p.x + p.w));
  });
}
function buyPlot(p) {
  if (!p || S.cash < p.cost || S.level < p.lvl || plotOwned(p) || plotPending(p) || !plotAdjacent(p)) { sfx('error'); return; }
  S.cash -= p.cost; S.stats.spent += p.cost;
  S.plots.push({ id: p.id, end: Date.now() + p.time * 1000 });
  sfx('buy');
  var unlTxt = (p.unlocks && p.unlocks.length) ? ' · Unlocks: ' + p.unlocks.join(', ') : '';
  toast('🚜 Expanding ' + p.name + ' — ready in ' + fmtDur(p.time) + unlTxt, 'good');
  markDirty(p);
  if (typeof MP !== 'undefined') MP.recordAction('plot', { item: p.id, name: p.name, icon: '🗺️', cost: p.cost });
  saveGame();
}
function buyUpgrade(u) {
  if (!u) { sfx('error'); return false; }
  var cost = upgCost(u), req = upgReqLvl(u), nextLv = upLvl(u.id) + 1;
  if (S.cash < cost || S.level < req) { sfx('error'); return false; }
  S.cash -= cost; S.stats.spent += cost; S.upgrades[u.id] = nextLv;
  sfx('buy'); gainXP(Math.round(cost / 35) + 4);
  toast(u.icon + ' ' + u.name + ' upgraded to Lv ' + nextLv + '!', 'good'); confetti(S.player.x, S.player.y - 50, 24);
  if (typeof MP !== 'undefined') MP.recordAction('upgrade', { item: u.id, name: u.name + ' Lv ' + nextLv, icon: u.icon, cost: cost });
  saveGame();
  return true;
}
function checkBuilds() {
  var t = Date.now(), changed = false;
  S.objects.forEach(function (o) {
    if (!o.done && t >= o.buildEnd) {
      var wasUpg = !!o.upgrading;
      if (wasUpg) { o.lvl = (o.lvl || 1) + 1; o.upgrading = false; }
      o.done = true; markDirty(); changed = true;
      var c = CAT_BY_ID[o.type];
      if (c) {
        var cx = (o.x + o.w / 2) * TILE, cy = (o.y + o.h / 2) * TILE;
        var msg = wasUpg ? (c.name + ' Lv ' + (o.lvl || 1) + '!') : (c.name + ' built!');
        confetti(cx, cy, 30); float(cx, o.y * TILE - 10, msg, '#b9f6ca', 1.3);
        toast((wasUpg ? '⬆️ ' : '🏗️ ') + msg, 'good'); sfx('built'); gainXP(Math.round(c.cost * (o.lvl || 1) / 30) + 4);
      }
      checkStationTut(o.type);
    }
  });
  S.plots.forEach(function (pl) {
    if (pl.end && t >= pl.end && !pl.announced) {
      pl.announced = true; changed = true;
      var p = PLOTS.filter(function (q) { return q.id === pl.id; })[0];
      if (p) {
        markDirty(p);
        var unlMsg = (p.unlocks && p.unlocks.length) ? ' New unlock boxes ready: ' + p.unlocks.join(' · ') : ' More room to build!';
        toast('🗺️ ' + p.name + ' is open!' + unlMsg, 'good');
        if (typeof showBanner === 'function') showBanner('🗺️ ' + p.name + ' Expanded!', (p.unlocks && p.unlocks.length) ? 'Unlocked: ' + p.unlocks.join(' · ') : 'New buildable land & unlock boxes!');
        sfx('built'); confetti((p.x + p.w / 2) * TILE, (p.y + p.h / 2) * TILE, 55);
      } else markDirty(true);
    }
  });
  if (changed) saveGame();
}

// ================= Smart Business Advisor & Employee Hints =================
function currentAdvisorHint() {
  if (!S) return null;
  var dogsIn = S.dogs.filter(function (d) { return d.checkedIn && d.state !== 'leaving'; }).length;
  var needy = S.dogs.filter(function (d) { return d.checkedIn && d.need && !d.need.self; }).length;
  var waitingO = S.owners.filter(function (o) { return o.state === 'waitCheckin' || o.state === 'waitPickup'; }).length;
  var staffN = hiredStaffCount();
  if ((dogsIn >= 3 && staffN === 0) || (dogsIn >= 5 && staffN <= 1) || (needy >= 2 && staffN === 0)) {
    return { id: 'many_dogs', act: 'staff', text: '💡 Too many dogs to manage alone! Think about hiring employees in 🔨 Shop → Staff.' };
  }
  if (waitingO >= 2 && !staffHired('receptionist')) {
    return { id: 'hire_rec', act: 'staff', text: '💡 Customers are waiting at the counter — think about hiring a 🧑‍💼 Receptionist!' };
  }
  if ((S.poops.length >= 2 || (S.chores && S.chores.length >= 2)) && !staffHired('cleaner') && S.totalServed >= 1) {
    return { id: 'hire_clean', act: 'staff', text: '💡 Yard mess is piling up — think about hiring a 🧹 Grounds Keeper!' };
  }
  if (S.dogs.some(function (d) { return d.need && d.need.type === 'bath' && d.need.t > 6; }) && !staffHired('groomer') && hasDone('tub')) {
    return { id: 'hire_groom', act: 'staff', text: '💡 Muddy pups waiting for baths? Hire a 🛁 Pet Groomer to bathe them automatically!' };
  }
  if (S.dogs.filter(function (d) { return d.need && (d.need.type === 'food' || d.need.type === 'treat'); }).length >= 2 && !staffHired('feeder')) {
    return { id: 'hire_feed', act: 'staff', text: '💡 Hungry dogs asking at once? Think about hiring a 🥣 Kennel Chef!' };
  }
  if (S.owners.some(function (o) { return o.state === 'waitPickup' && (o.patienceMax - o.patience) > 10; }) && !staffHired('runner')) {
    return { id: 'hire_run', act: 'staff', text: '💡 Busy searching for pickup dogs? Hire a 🦮 Pickup Runner to fetch them from the yard!' };
  }
  if (dogsIn >= capacity() && S.level >= 2 && S.plots.length === 1) {
    return { id: 'expand_land', act: 'land', text: '💡 Daycare is full! Step on the golden 🗺️ box at the fence to expand your business & unlock new workers.' };
  }
  return null;
}
function updateAdvisorHints(dt) {
  if (!S) return;
  S._hintCd = Math.max(0, (S._hintCd || 0) - dt);
  if (S._hintCd > 0) return;
  var h = currentAdvisorHint();
  if (h && S._lastHintId !== h.id) {
    S._lastHintId = h.id;
    S._hintCd = 34;
    toast(h.text, '');
  }
}

// ================= simulation =================
var _iterOwners = [], _iterDogs = [];
function update(dt) {
  now += dt; S.clock = (S.clock || 0) + dt;
  checkBuilds();
  advanceTutorialPacing();
  var D = dayLen(), i, n;
  if (!S.closing) {
    S.dayTime += dt;
    var curPhase = dayPhase();
    if (!S._lastPhase) S._lastPhase = curPhase.id;
    else if (S._lastPhase !== curPhase.id) {
      S._lastPhase = curPhase.id;
      if (curPhase.banner) toast(curPhase.banner, '');
      if (curPhase.id === 'naptime') {
        S.dogs.forEach(function (dg) {
          if (dg.checkedIn && !dg.called && !dg.need && (dg.state === 'idle' || dg.state === 'wander') && zoneAt(dg.x, dg.y) !== 'pool' && Math.random() < 0.65) {
            dg.state = 'nap'; dg.path = null; dg.actT = rand(10, 18);
          }
        });
      }
    }
    if (S.dayTime >= D) { S.dayTime = D; S.closing = true; toast('🌇 Closing time! Finish the last pickups.', ''); sfx('day_end'); }
  }
  if (!S.closing && S.dayTime < D - 55) {
    if (!S.tutorialDone && S.dogs.length >= 1) {
      S.arrivalTimer = 6;
    } else {
      S.arrivalTimer -= dt;
      if (S.arrivalTimer <= 0) {
        var atCounter = 0;
        for (i = 0; i < S.owners.length; i++) if (S.owners[i].state !== 'walkOut') atCounter++; // keep the queue at the counter short
        var canArrive = dayPhase().id !== 'pickup' || activeDogCount() === 0;
        if (canArrive && atCounter < 3 && activeDogCount() < capacity() && spawnArrival()) scheduleArrival(); else S.arrivalTimer = 4;
      }
    }
  }
  for (i = 0; i < S.dogs.length; i++) {
    var d = S.dogs[i];
    if (!d.checkedIn || d.called || d.state === 'leaving') continue;
    var due = (d.pickupDay < S.day) || (d.pickupDay === S.day && (S.dayTime >= d.pickupAt || (S.closing && !d.overnight)));
    if (due && freeSlot() >= 0) {
      var o = makeOwner('pickup', d); if (!o) continue;
      d.called = true; o.patienceMax = o.patience = 95 * patienceMul();
    }
  }
  updateDirector(dt);
  updateChores(dt);
  updateAdvisorHints(dt);
  updatePlayer(dt);
  updateDwell(dt);
  updateNPCs(dt);
  n = S.owners.length; _iterOwners.length = n;
  for (i = 0; i < n; i++) _iterOwners[i] = S.owners[i];
  for (i = 0; i < n; i++) updateOwner(_iterOwners[i], dt);
  n = S.dogs.length; _iterDogs.length = n;
  for (i = 0; i < n; i++) _iterDogs[i] = S.dogs[i];
  for (i = 0; i < n; i++) updateDog(_iterDogs[i], dt);
  for (i = 0; i < S.poops.length; i++) S.poops[i].age += dt;
  checkGoals();
  if (S.closing) {
    var pending = S.owners.length > 0, dueOvernight = false;
    for (i = 0; i < S.dogs.length; i++) {
      var dg = S.dogs[i];
      if (!dg.overnight || dg.state === 'leaving' || dg.called) pending = true;
      if (dg.overnight && dg.checkedIn && dg.pickupDay <= S.day) dueOvernight = true;
    }
    if (!pending && !dueOvernight) endDay();
  }
  if (typeof MP !== 'undefined') MP.update(dt);
  updateFX(dt);
}

function updatePlayer(dt) {
  var p = S.player, mx = 0, my = 0, analog = false;
  if (UI.mode === 'play' || UI.mode === 'build') {
    if (typeof UI !== 'undefined' && UI.joy && UI.joy.active && (UI.joy.dx || UI.joy.dy)) {
      mx = UI.joy.dx; my = UI.joy.dy; analog = true; UI.touchTarget = null;
    } else if (UI.mode === 'play' && typeof UI !== 'undefined' && UI.touchTarget) {
      var tdx = UI.touchTarget.x - p.x, tdy = UI.touchTarget.y - p.y, td = Math.sqrt(tdx * tdx + tdy * tdy);
      if (td < 6) UI.touchTarget = null;
      else { mx = tdx / td; my = tdy / td; }
    }
  }
  if (p.emote) { p.emoteT += dt; if (p.emoteT > (p.emoteDur || 0.5)) p.emote = null; }
  var len = Math.sqrt(mx * mx + my * my);
  p.moving = len > 0.02;
  if (p.moving) {
    var sp = (window.GAME_CONFIG.playerSpeed || 250) * (1 + upLvl('sneakers') * 0.08);
    var spdScale = analog ? Math.min(1, len) : 1;
    mx = mx / len * sp * spdScale * dt; my = my / len * sp * spdScale * dt;
    if (Math.abs(mx) > 0.01) p.face = mx > 0 ? 1 : -1;
    if (Math.abs(mx) >= Math.abs(my) && Math.abs(mx) > 0.01) p.dir = mx > 0 ? 'right' : 'left'; else if (Math.abs(my) > 0.01) p.dir = my > 0 ? 'down' : 'up';
    var ox = p.x, oy = p.y;
    var okX = !mx || movePlayer(p, mx, 0), okY = !my || movePlayer(p, 0, my);
    // blocked while walking straight at a doorway or past a corner: slide sideways into the opening
    if (!okX && !my) slideAssist(p, mx, 0, sp * dt * 0.8); else if (!okY && !mx) slideAssist(p, 0, my, sp * dt * 0.8);
    if (p.x === ox && p.y === oy) {
      p.moving = false;
      if (typeof UI !== 'undefined' && UI.touchTarget) { UI.touchTarget.stuck = (UI.touchTarget.stuck || 0) + dt; if (UI.touchTarget.stuck > 0.25) UI.touchTarget = null; }
    } else {
      if (typeof UI !== 'undefined' && UI.touchTarget) UI.touchTarget.stuck = 0;
      var wd0 = p.walkDist || 0;
      p.walkT += dt; p.walkDist = wd0 + dist(ox, oy, p.x, p.y);
      if (p.emote !== 'handover' && p.emote !== 'receive') p.emote = null;
      if (Math.floor(p.walkDist / 33) !== Math.floor(wd0 / 33)) { // a footstep every half jog stride
        var k = baseKind(tileOf(p.x), tileOf(p.y));
        sfx(k === 'yard' ? 'step_grass' : k === 'sidewalk' ? 'step_stone' : 'step_wood');
        if (k === 'yard') FX.parts.push({ x: p.x - (DIRV[p.dir][0]) * 6, y: p.y, vx: rand(-14, 14), vy: -16, life: 0.45, max: 0.45, kind: 'grass', size: 3, grav: 60 });
        else FX.parts.push({ x: p.x, y: p.y, vx: rand(-8, 8), vy: -6, life: 0.35, max: 0.35, kind: 'dust', size: 2.5 });
      }
    }
  }
  // a freshly checked-in dog is let off the leash by itself once you are a few steps into the yard
  if (p.carry && p.carry.type === 'dog') {
    var ld = dogById(p.carry.id);
    if (ld && ld.autoRelease && p.x > (YARD_ENTRY[0] + 1.6) * TILE && baseKind(tileOf(p.x), tileOf(p.y)) === 'yard' && canReleaseAt(p.x, p.y)) doRelease();
  }
}
function canStand(nx, ny) {
  var ct = MAP.shop.counter; // the counter top overhangs the staff side a little: keep the player's feet out from under it
  if (nx + 12 > ct.x0 * TILE && nx - 12 < (ct.x1 + 1) * TILE && ny + 4 > (ct.y - 0.6) * TILE && ny - 11 < (ct.y + 1) * TILE) return false;
  var r = 12, x0 = tileOf(nx - r), x1 = tileOf(nx + r), y0 = tileOf(ny - 11), y1 = tileOf(ny + 4);
  for (var ty = y0; ty <= y1; ty++) for (var tx = x0; tx <= x1; tx++) if (solidForPlayer(tx, ty)) return false;
  return true;
}
function movePlayer(p, dx, dy) {
  if (!canStand(p.x + dx, p.y + dy)) return false;
  p.x += dx; p.y += dy; return true;
}
function slideAssist(p, dx, dy, step) {
  for (var k = 4; k <= 26; k += 2) for (var s = -1; s <= 1; s += 2) {
    var ax = dy ? s * k : 0, ay = dx ? s * k : 0;
    if (canStand(p.x + dx + ax, p.y + dy + ay) && canStand(p.x + (ax ? s * Math.min(step, k) : 0), p.y + (ay ? s * Math.min(step, k) : 0))) { p.x += ax ? s * Math.min(step, k) : 0; p.y += ay ? s * Math.min(step, k) : 0; return true; }
  }
  return false;
}

function moveTo(e, tx, ty, sp, dt) {
  var dx = tx - e.x, dy = ty - e.y, d = Math.sqrt(dx * dx + dy * dy);
  if (d < 1) { e.x = tx; e.y = ty; e.moving = false; return true; }
  var s = Math.min(d, sp * dt);
  e.x += dx / d * s; e.y += dy / d * s; e.moving = true; e.curSpeed = sp; e.walkDist = (e.walkDist || 0) + s;
  if (Math.abs(dx) > 0.5) e.face = dx > 0 ? 1 : -1;
  if (e.look) { if (Math.abs(dx) >= Math.abs(dy)) e.dir = dx > 0 ? 'right' : 'left'; else e.dir = dy > 0 ? 'down' : 'up'; }
  return s >= d - 0.01;
}
function playerOnMat() { return inRect(S.player.x, S.player.y, ACTION_BOX); }

function updateOwner(o, dt) {
  o.sayT -= dt; if (o.emote) { o.emoteT += dt; if (o.emoteT > 1.6 && o.emote !== 'angry' && o.emote !== 'impatient' && o.emote !== 'handover') o.emote = null; }
  var d = dogById(o.dogId), dName = d ? d.name : 'a pup';
  if (o.moving) o.walkT += dt;
  if (o.state === 'walkIn' || o.state === 'walkOut' || o.state === 'toHandover') {
    if (!Array.isArray(o.route) || !o.route.length || !Array.isArray(o.route[0])) {
      if (o.state === 'walkIn') o.route = [[QUEUE[o.slot || 0][0] * TILE, QUEUE[o.slot || 0][1] * TILE]];
      else if (o.state === 'toHandover') o.route = [[HANDOVER_SPOT[0] * TILE, HANDOVER_SPOT[1] * TILE]];
      else o.route = exitRoute(o);
    }
    var tgt = o.route[0];
    if (moveTo(o, tgt[0], tgt[1], o.state === 'toHandover' ? 210 : 120, dt)) {
      o.route.shift();
      if (!o.route.length) {
        if (o.state === 'walkIn') {
          o.state = o.kind === 'dropoff' ? 'waitCheckin' : 'waitPickup'; o.moving = false; o.dir = 'up';
          o.say = o.kind === 'dropoff' ? pick(['Hello?', 'Drop-off for ' + dName + '!', 'Anyone here?', 'Hi there!']) : pick(['Here for ' + dName + '!', 'Where\'s my baby?', 'Pickup please!']);
          o.sayT = 2.5; o.emote = 'ring'; o.emoteT = 0;
          SHOPFX.bellT = now; sfx('bell');
          if (o.kind === 'pickup') {
            var bName = d ? breedOf(d).name : 'dog';
            o.say = 'Pickup for ' + dName + ' (' + bName + '), please!';
            o.sayT = 3.5;
            toast('🔔 ' + o.name + ' is at the counter asking for ' + dName + ' (' + bName + ') — find them in the yard!', '');
          } else if (d && d.special) {
            o.say = 'Special guest ' + dName + ' has arrived!';
            toast('⭐ Special guest has arrived! ' + o.name + ' is at the counter with ' + dName + '!', 'good');
            if (typeof showBanner === 'function') showBanner('⭐ Special guest has arrived!', o.name + ' & ' + dName + (d.moraleBoost ? ' — boosts all friendships & morale!' : ' — ' + d.title));
            float(o.x, o.y - 96, '⭐ Special guest has arrived!', '#ffd54a', 1.5);
            sfx('perfect');
            if (d.moraleBoost) boostMoraleAndFriendships(d, false);
          } else toast('🔔 ' + o.name + ' is at the counter with ' + dName, '');
        } else if (o.state === 'toHandover') {
          o.state = 'handover'; o.moving = false; o.dir = 'right'; o.hoT = 0; o.emote = 'handover'; o.emoteT = 0;
        } else {
          S.owners.splice(S.owners.indexOf(o), 1);
          if (d && d.ownerId === o.id && (d.state === 'leaving' || d.state === 'arriving')) S.dogs.splice(S.dogs.indexOf(d), 1);
          return;
        }
      }
    }
  } else if (o.state === 'handover') {
    o.moving = false; o.dir = 'up';
    var staff = o.byStaff ? npcById('receptionist') : null;
    var car = S.player.carry, okHands = staff ? true : o.kind === 'dropoff' ? true : !!(car && car.type === 'dog' && car.id === o.dogId);
    if (okHands && (staff || playerOnMat())) { o.hoT += dt; o.awayT = 0; }
    else {
      o.hoT = Math.max(0, o.hoT - dt * 2); o.awayT = (o.awayT || 0) + dt;
      if (o.awayT > 3 || (o.kind === 'pickup' && !okHands && o.hoT <= 0)) { o.state = o.kind === 'dropoff' ? 'waitCheckin' : 'waitPickup'; o.emote = null; o.dir = 'up'; o.awayT = 0; o.byStaff = false; if (d && d.state === 'toOwner') { d.state = 'toCounter'; d.path = []; d.route = [[SHOP_WAY.gapN[0] * TILE, SHOP_WAY.gapN[1] * TILE], [SHOP_WAY.desk[0] * TILE, SHOP_WAY.desk[1] * TILE]]; } return; }
    }
    if (staff) { staff.dir = 'down'; staff.face = 1; if (o.hoT > 0 && staff.emote !== (o.kind === 'pickup' ? 'handover' : 'receive')) { staff.emote = o.kind === 'pickup' ? 'handover' : 'receive'; staff.emoteT = 0; } }
    else {
      if (!S.player.moving && playerOnMat()) S.player.dir = 'down';
      if (o.hoT > 0 && !S.player.moving && S.player.emote !== (o.kind === 'pickup' ? 'handover' : 'receive')) pEmote(o.kind === 'pickup' ? 'handover' : 'receive', 0.6);
    }
    if (o.hoT >= 0.65 && d) {
      if (o.kind === 'dropoff') { doCheckIn(o); }
      else if (staff) {
        if (d.state !== 'toOwner') { d.state = 'toOwner'; d.path = null; d.anim = null; d.route = [SHOP_WAY.gapN, SHOP_WAY.gapS].map(function (w) { return [w[0] * TILE, w[1] * TILE]; }).concat([[o.x + 18, o.y + 14]]); }
        if (dist(d.x, d.y, o.x + 18, o.y + 14) < 24 || o.hoT > 2.1) doReturn(o);
      } else { doReturn(o); }
    }
  } else {
    o.moving = false;
    o.patience -= dt;
    var pf = o.patience / o.patienceMax;
    if (pf < 0.3 && !o.emote && !o.angry) { o.emote = 'impatient'; o.emoteT = 0; }
    if (o.patience <= 0 && !o.angry) {
      if (o.state === 'waitCheckin') {
        fileComplaint(o.name + ' gave up waiting at the counter', 0.25);
        o.state = 'walkOut'; o.slot = null; o.route = exitRoute(o); o.say = 'Forget it!'; o.sayT = 2.5; o.emote = 'angry'; o.emoteT = 0;
        if (d) { d.state = 'leaving'; if (d.kennelId) { var k = objById(d.kennelId); if (k) k.reservedFor = null; } }
      } else {
        o.angry = true; o.say = 'I\'ve been waiting forever!'; o.sayT = 3; o.emote = 'angry'; o.emoteT = 0;
        fileComplaint(o.name + ' waited too long for ' + (d ? d.name : 'their dog'), 0.35);
      }
    }
  }
  // the dog that walks with its owner
  if (d && (d.state === 'arriving' || d.state === 'leaving') && d.ownerId === o.id) {
    var v = DIRV[o.dir] || [0, 1], bx, by, fast = 0;
    if (o.state === 'handover' && o.kind === 'dropoff') {
      // trot round the counter to whoever is taking the leash (you in the box, or the receptionist)
      var act = (o.byStaff && npcById('receptionist')) || S.player;
      if (o.hoT > 0.2) { var det = counterDetour(d, act.x + (d.x < act.x ? -26 : 26), act.y + 6); bx = det.x; by = det.y; fast = det.lead || 200; }
      else { bx = o.x + 18; by = o.y + 14; fast = 200; }
    } else if (o.moving) { bx = o.x - v[0] * 30 + (v[0] === 0 ? 16 : 0); by = o.y - v[1] * 26 + 4; }
    else { bx = o.x + 16; by = o.y + 24; }
    var dd = dist(d.x, d.y, bx, by);
    if (dd > 3) moveTo(d, bx, by, fast || Math.max(70, dd * 5), dt); else { d.moving = false; }
    if (!o.moving && !d.moving && !d.anim && Math.random() < dt * 0.4) setAnim(d, pick(['sit', 'sniff', 'sit']), 3);
    if (d.moving) d.anim = null; else if (d.anim) { d.animT += dt; if (d.animDur > 0 && d.animT > d.animDur) d.anim = null; }
  }
}

function updateDog(d, dt) {
  d.petCd -= dt; d.mood -= dt; d.bark -= dt;
  if (d.state === 'arriving' || d.state === 'leaving') return;
  var zone = zoneAt(d.x, d.y), k = diff().decay, mb = moraleBoostCount();
  // happiness: slowly recovers by itself; drops only while a need has been waiting too long
  if (d.need) {
    d.need.t += dt;
    if (d.need.self === 'zone' && zone && (zone === 'playzone' || zone === 'agility' || zone === 'pool')) { d.need.zoneT = (d.need.zoneT || 0) + dt; if (d.need.zoneT > 5) fulfillNeed(d, 'self'); }
    if (d.need && d.need.t > NEED_GRACE && d.state !== 'kennel' && d.state !== 'bath') d.happy -= 1.0 * k * (hasTrait(d, 'diva') ? 1.4 : 1) * (mb ? Math.max(0.45, 1 - mb * 0.25) : 1) * dt;
    if (d.need && d.need.self && d.need.t > 40) d.need.self = null; // gave up on the facility: now it needs you
  } else if (d.state !== 'leashed') {
    var gain = 0.22 + mb * 0.45;
    if (zone === 'playzone' || zone === 'agility' || zone === 'sandpit') gain += 0.5;
    if (zone === 'pool') gain += hasTrait(d, 'water') ? 1 : 0.4;
    if (zone === 'napmat' || d.state === 'kennel') gain += 0.3;
    if ((hasTrait(d, 'social') || mb > 0) && S.dogs.some(function (o) { return o !== d && o.checkedIn && dist(o.x, o.y, d.x, d.y) < 130; })) gain += 0.15 + mb * 0.15;
    d.happy = Math.min(mb > 0 ? 100 : 96, d.happy + gain * dt);
  }
  if (d.state !== 'leashed' && d.state !== 'kennel' && d.state !== 'bath') {
    if (zone === 'pool' && Math.random() < dt * 3) burst(d.x, d.y - 6, 'splash', 2);
    if (zone === 'sandpit' && !d.moving && !d.anim && Math.random() < dt * 0.5) setAnim(d, 'dig', 2);
    S.poops.forEach(function (pp) {
      var dd = dist(pp.x, pp.y, d.x, d.y);
      if (pp.age > 30 && dd < 110) d.happy -= (hasTrait(d, 'nervous') ? 0.5 : 0.2) * dt;
      if (dd < 14 && pp.age > 1.5 && d.stepped.indexOf(pp.id) < 0) {
        d.stepped.push(pp.id); d.happy -= 4; burst(d.x, d.y, 'dust', 6);
        if (!(now - (pp.ewAt || -99) < 4)) { pp.ewAt = now; float(d.x, d.y - 52, 'Ew! Stepped in poop!', '#d7ccc8'); sfx('squish'); }
      }
    });
  }
  d.happy = clamp(d.happy, 0, 100);
  d.needs.clean = d.need && d.need.type === 'bath' ? 12 : 90; // muddy look
  if (d.happy < 30 && d.bark <= 0 && Math.random() < dt * 0.25) { d.bark = 7; sfx('whine', d); }
  if (d.need && !d.need.self && d.bark <= 0 && d.need.t > 4 && Math.random() < dt * 0.12) { d.bark = 9; sfx('bark', d); }
  if (d.anim) { d.animT += dt; if (d.animDur > 0 && d.animT > d.animDur) d.anim = null; }

  // behaviour
  if (d.state === 'npcLeashed') {
    var npc = d.npcHolder ? npcById(d.npcHolder) : null;
    if (!npc || !npc.carry || npc.carry.id !== d.id) { d.state = 'idle'; d.npcHolder = null; d.idleT = 0.5; }
    return;
  }
  if (d.state === 'leashed') {
    var peerHolder = (typeof MP !== 'undefined' && d.leashedBy && d.leashedBy !== MP.playerId) ? MP.getPeer(d.leashedBy) : null;
    var p = (peerHolder && peerHolder.online) ? peerHolder : S.player;
    var v = DIRV[p.dir] || [0, 1], tx = p.x - v[0] * 36, ty = p.y - v[1] * 30 + 5;
    if (p.dir === 'down') { tx = p.x + (d.x >= p.x ? 34 : -34); ty = p.y + 4; } // never hide behind the player
    var ctr = MAP.shop.counter, underTop = tx > ctr.x0 * TILE - 10 && tx < (ctr.x1 + 1) * TILE + 10 && ty > ctr.y * TILE - 26 && ty < (ctr.y + 1) * TILE + 8;
    if (underTop || solidForPlayer(tileOf(tx), tileOf(ty - 3))) { // no room behind the player (counter, wall): heel at the side instead
      var alts = [[34, 4], [-34, 4], [v[0] * 34, v[1] * 28 + 5], [0, 5]];
      for (var ai = 0; ai < alts.length; ai++) { var qx = p.x + alts[ai][0], qy = p.y + alts[ai][1]; if (!solidForPlayer(tileOf(qx), tileOf(qy - 3)) && !(qy > ctr.y * TILE - 26 && qy < (ctr.y + 1) * TILE + 8 && qx < (ctr.x1 + 1) * TILE + 10)) { tx = qx; ty = qy; break; } }
    }
    // a pickup hand-over in progress: the dog trots over to its owner
    var ho = S.owners.filter(function (o) { return o.state === 'handover' && o.kind === 'pickup' && o.dogId === d.id; })[0];
    if (ho && ho.hoT > 0.2) { tx = ho.x + 18; ty = ho.y + 14; }
    // dog and its target on opposite sides of the reception counter: trot round the open end instead of cutting through it
    var det = counterDetour(d, tx, ty), lead = det.lead; tx = det.x; ty = det.y;
    if (ho && !lead) lead = 200;
    var dd = dist(d.x, d.y, tx, ty);
    if (dd > 5) moveTo(d, tx, ty, lead || Math.max(70, dd * 6), dt); else { d.moving = false; d.curSpeed = 0; if (p.x !== d.x) d.face = p.x > d.x ? 1 : -1; }
    return;
  }
  if (d.state === 'toYard') { // a freshly checked-in dog trots through to the yard on its own and greets the pack
    d.anim = null;
    if (followRoute(d, 130, dt)) {
      d.route = null; d.state = 'idle'; d.idleT = d.need ? 1e9 : 0.7; d.autoRelease = false; setAnim(d, 'jump', 0.75);
      greetYardPal(d);
    }
    return;
  }
  if (d.state === 'toCounter') { // fetched to the desk for a pickup the receptionist is handling
    d.anim = null;
    if (followPath(d, 130, dt) && followRoute(d, 130, dt)) { d.route = null; d.state = 'atDesk'; d.moving = false; d.face = -1; setAnim(d, 'sit', 1e9); }
    return;
  }
  if (d.state === 'atDesk') {
    d.moving = false; if (!d.anim) setAnim(d, 'sit', 1e9);
    var wantsMe = S.owners.some(function (o) { return o.dogId === d.id && (o.state === 'waitPickup' || o.state === 'toHandover' || o.state === 'handover'); });
    if (!wantsMe || !npcById('receptionist')) { d.state = 'toYard'; d.anim = null; d.route = [SHOP_WAY.gapN, SHOP_WAY.door, SHOP_WAY.yard].map(function (w) { return [w[0] * TILE, w[1] * TILE]; }); }
    return;
  }
  if (d.state === 'toOwner') { d.anim = null; if (followRoute(d, 170, dt)) d.moving = false; return; }
  if (d.state === 'drink') {
    d.moving = false; d.actT -= dt;
    if (Math.random() < dt * 6) FX.parts.push({ x: d.x + d.face * 14 + rand(-6, 6), y: d.y - 6, vx: rand(-20, 20), vy: -40, life: 0.5, max: 0.5, kind: 'splash', size: 2.5, grav: 200 });
    if (d.actT <= 0) { d.state = 'idle'; d.idleT = d.need ? 1e9 : 0.6; d.anim = null; d.happy = Math.min(100, d.happy + 3); setAnim(d, 'shake', 0.9); }
    return;
  }
  if (d.state === 'romp') { // two dogs chasing each other round in a circle, pouncing and wrestling
    var pd = dogById(d.partner);
    if (!pd || pd.state !== 'romp' || pd.partner !== d.id) { endRomp(d); d.state = 'idle'; d.idleT = d.need ? 1e9 : 0.5; d.partner = null; d.moving = false; return; }
    d.actT -= dt; d.playA += dt * 2.4;
    var cx = d.rompX + Math.cos(d.playA) * 34, cy = d.rompY + Math.sin(d.playA) * 22;
    var closeBy = dist(d.x, d.y, pd.x, pd.y) < 46;
    if (d.anim && d.animT < d.animDur) { d.moving = false; }
    else if (closeBy && Math.random() < dt * 0.9) { setAnim(d, Math.random() < 0.5 ? 'pounce' : 'wrestle', Math.random() < 0.5 ? 0.8 : 1.4); d.face = pd.x > d.x ? 1 : -1; d.moving = false; if (Math.random() < 0.5) sfx('bark', d); }
    else if (dogWalkable(tileOf(cx), tileOf(cy))) { var mv = dist(d.x, d.y, cx, cy); d.walkDist = (d.walkDist || 0) + mv; if (mv > 0.5) d.face = cx > d.x ? 1 : -1; d.x = cx; d.y = cy; d.moving = mv > 0.3; d.curSpeed = 140; }
    else d.playA += 1.2;
    if (Math.random() < dt * 2) burst(d.x, d.y, 'dust', 1);
    if (d.actT <= 0) { var mbR = moraleBoostCount(); endRomp(d); d.state = 'idle'; d.idleT = d.need ? 1e9 : rand(1, 2.5); d.partner = null; d.moving = false; d.happy = Math.min(100, d.happy + (hasTrait(d, 'social') ? 9 : 6) + mbR * 5); burst(d.x, d.y - 30, 'heart', 4 + mbR * 2); if (mbR) float(d.x, d.y - 54, '💕 Best friends!', '#ff8ad8', 1.1); setAnim(d, 'playbow', 1.2); }
    return;
  }
  // toilet: every dog has its own schedule (once or twice a day, and soon after a meal)
  if (d.checkedIn && (d.state === 'idle' || d.state === 'wander') && baseKind(tileOf(d.x), tileOf(d.y)) === 'yard' && !zone) {
    if (d.poopT == null) d.poopT = nextPoopDelay(d, false);
    d.poopT -= dt;
    if (d.poopT <= 0 && !d.poopAt && S.poops.length < 8 && !(d.anim && d.animDur > 0 && d.animT < d.animDur && d.animDur < 1e8)) {
      d.state = 'idle'; d.idleT = 2.8; d.path = null; d.seekObj = null; d.moving = false; setAnim(d, 'poop', 2.4); d.poopAt = now + 1.9;
    }
  }
  if (d.poopAt && now >= d.poopAt) { d.poopAt = null; dropPoop(d); d.poopT = nextPoopDelay(d, false); }
  if (d.state === 'kennel') { d.moving = false; return; }
  if (d.state === 'bath') {
    d.moving = false; d.actT -= dt;
    if (Math.random() < dt * 10) burst(d.x + rand(-22, 22), d.y - 20, 'bubble', 1);
    if (d.actT <= 0) {
      if (d.need && d.need.type === 'bath') fulfillNeed(d); else d.happy = Math.min(100, d.happy + (hasTrait(d, 'water') ? 12 : 4));
      var ob = objById(d.objId); if (ob) ob.dogId = null; d.objId = null;
      var t = nearestWalkable(d.x, d.y + TILE * 2.2); // hop out a little way from the tub, off its mat
      d.x = (t[0] + .5) * TILE; d.y = (t[1] + .5) * TILE; d.state = 'idle'; d.idleT = 1.6; d.sparkle = 3; setAnim(d, 'shake', 1.1);
      burst(d.x, d.y - 24, 'sparkle', 12); burst(d.x, d.y - 20, 'splash', 14); sfx('shake'); sfx('ding'); float(d.x, d.y - 52, 'Squeaky clean!', '#b3e5fc');
    }
    return;
  }
  if (d.state === 'eat') { d.moving = false; d.actT -= dt; if (d.actT <= 0) { d.state = 'idle'; d.idleT = d.need ? 1e9 : 0.5; } return; }
  if (d.state === 'play') {
    d.actT -= dt; d.playA += dt * 4.5; d.curSpeed = 160;
    var cx = d.x + Math.cos(d.playA) * 170 * dt, cy = d.y + Math.sin(d.playA) * 110 * dt;
    if (dogWalkable(tileOf(cx), tileOf(cy))) { d.walkDist = (d.walkDist || 0) + dist(d.x, d.y, cx, cy); d.face = cx > d.x ? 1 : -1; d.x = cx; d.y = cy; d.moving = true; } else d.playA += 1.5;
    if (d.actT <= 0) { d.state = 'idle'; d.idleT = 0.8; d.moving = false; setAnim(d, 'playbow', 0.8); }
    return;
  }
  if (d.state === 'nap') { d.moving = false; d.actT -= dt; if (Math.random() < dt * 0.8) FX.parts.push({ x: d.x + d.face * 12, y: d.y - 26, vx: 6, vy: -12, life: 1.4, max: 1.4, kind: 'z', size: 12 }); if (d.actT <= 0) { d.state = 'idle'; d.idleT = 0.3; } return; }
  if (d.state === 'idle') {
    d.moving = false; d.curSpeed = 0; d.idleT -= dt;
    if (d.need && !d.need.self && !d.anim) setAnim(d, d.need.type === 'food' || d.need.type === 'treat' ? 'beg' : d.need.type === 'play' ? 'playbow' : d.need.type === 'bath' ? 'scratch' : 'sit', 1e9);
    if (d.idleT <= 0 && !(d.anim && d.animDur > 0 && d.animT < d.animDur)) chooseWander(d);
    return;
  }
  if (d.state === 'wander') {
    if (!d.path || !d.path.length) {
      d.moving = false; d.curSpeed = 0;
      if (d.seekObj) {
        var fo = objById(d.seekObj); d.seekObj = null;
        if (fo && fo.done && fo.type === 'autofeeder' && d.need && d.need.type === 'food') { fulfillNeed(d, 'self'); d.state = 'eat'; d.actT = 2.4; fo.useAt = now; burst(d.x, d.y - 20, 'crumb', 6); return; }
        if (fo && fo.done && fo.type === 'waterbowl' && !d.need) { d.state = 'drink'; d.actT = rand(2.5, 4); fo.useAt = now; d.face = (fo.x + fo.w / 2) * TILE > d.x ? 1 : -1; setAnim(d, 'drink', 1e9); return; }
      }
      d.state = 'idle'; d.idleT = d.need ? 1e9 : rand(1.2, 4.5);
      if (d.need) return;
      var r = Math.random();
      if (d.happy < 30) setAnim(d, 'sad', d.idleT);
      else if (r < 0.3) setAnim(d, 'sit', d.idleT);
      else if (r < 0.42) setAnim(d, 'sniff', Math.min(d.idleT, 2.2));
      else if (r < 0.5) setAnim(d, 'scratch', Math.min(d.idleT, 1.8));
      else if (r < 0.56 && d.happy > 70) setAnim(d, 'roll', Math.min(d.idleT, 2.2));
      else if (r < 0.6 && (d.breed === 'husky' || d.breed === 'pomsky' || d.breed === 'beagle' || d.breed === 'basset')) { setAnim(d, 'howl', 1.8); sfx('howl', d); }
      return;
    }
    var nx = d.path[0];
    if (!dogWalkable(nx[0], nx[1])) { d.path = null; return; }
    var sp = d.speed * (zone === 'pool' ? 0.6 : 1) * (d.seekObj ? 1.25 : 1);
    d.anim = null;
    if (moveTo(d, (nx[0] + 0.5) * TILE + d.ox, (nx[1] + 0.5) * TILE + d.oy, sp, dt)) d.path.shift();
  }
}
function greetYardPal(d) {
  if (!S || !S.dogs) return;
  var pals = S.dogs.filter(function (q) {
    return q !== d && q.checkedIn && !q.need && !q.called && (q.state === 'idle' || q.state === 'wander') && dogWalkable(tileOf(q.x), tileOf(q.y));
  });
  if (!pals.length) return;
  pals.sort(function (a, b) { return dist(d.x, d.y, a.x, a.y) - dist(d.x, d.y, b.x, b.y); });
  var m = pals[0];
  d.face = m.x >= d.x ? 1 : -1;
  m.face = d.x >= m.x ? 1 : -1;
  burst(d.x, d.y - 28, 'heart', 3);
  burst(m.x, m.y - 28, 'heart', 3);
  float(m.x, m.y - 48, '🐾 Hi ' + d.name + '!', '#fff8e1', 1.1);
  d.happy = Math.min(100, d.happy + 4);
  m.happy = Math.min(100, m.happy + 4);
}
function zoneAt(px, py) {
  var o = objAt(tileOf(px), tileOf(py));
  return o && o.done && CAT_BY_ID[o.type].floor ? o.type : null;
}
function chooseWander(d) {
  var sx = tileOf(d.x), sy = tileOf(d.y);
  if (!dogWalkable(sx, sy)) { var t = nearestWalkable(d.x, d.y); d.x = (t[0] + .5) * TILE; d.y = (t[1] + .5) * TILE; sx = t[0]; sy = t[1]; }
  d.anim = null;
  if (d.need && !d.need.self) { d.state = 'idle'; d.idleT = 1e9; return; }
  var ph = dayPhase().id, here = zoneAt(d.x, d.y);
  var napP = ph === 'naptime' ? (here === 'napmat' ? 0.75 : 0.48) : (hasTrait(d, 'sleepy') ? 0.35 : 0.08);
  if (here !== 'pool' && !d.need && Math.random() < napP) { d.state = 'nap'; d.actT = ph === 'naptime' ? rand(9, 16) : rand(5, 10); return; }
  if (!d.need) {
    var bowls = S.objects.filter(function (o) { return o.type === 'waterbowl' && o.done; });
    if (bowls.length && Math.random() < 0.18) { goToObject(d, pick(bowls)); if (d.state === 'wander') return; }
    var mbW = moraleBoostCount(), playBoost = ph === 'midday' ? 0.16 : ph === 'naptime' ? -0.08 : 0.04;
    var rompChance = clamp((hasTrait(d, 'social') ? 0.22 : 0.12) + playBoost + mbW * 0.2 + (d.moraleBoost ? 0.18 : 0), 0.04, 0.65);
    if (Math.random() < rompChance) {
      var mates = S.dogs.filter(function (q) { return q !== d && q.checkedIn && !q.need && (q.state === 'idle' || q.state === 'wander') && dist(q.x, q.y, d.x, d.y) < (mbW ? 360 : 260) && dogWalkable(tileOf(q.x), tileOf(q.y)); });
      if (mates.length) {
        var specialMates = mates.filter(function (q) { return q.moraleBoost; });
        var m = (d.moraleBoost && specialMates.length) ? pick(specialMates) : pick(mates), mx = (d.x + m.x) / 2, my = (d.y + m.y) / 2;
        if (dogWalkable(tileOf(mx), tileOf(my))) {
          [d, m].forEach(function (q, i) { q.state = 'romp'; q.partner = (i ? d : m).id; q.actT = rand(5, 7.5); q.playA = i * Math.PI; q.rompX = mx; q.rompY = my; q.path = null; q.anim = null; q.seekObj = null; });
          float(d.x, d.y - 50, mbW ? '🐾 Best friends!' : 'Chase me!', '#fff'); sfx('bark', d); return;
        }
      }
    }
  }
  var b = bfs(sx, sy), goal = null;
  if (!goal) {
    var wants = [];
    S.objects.forEach(function (o) {
      if (!o.done || !CAT_BY_ID[o.type].floor) return;
      var inside = 0; S.dogs.forEach(function (q) { if (q !== d && q.x >= o.x * TILE && q.x < (o.x + o.w) * TILE && q.y >= o.y * TILE && q.y < (o.y + o.h) * TILE) inside++; });
      if (inside >= Math.max(1, Math.floor(o.w * o.h / 2.5))) return; // full: no piling up
      var w = 0;
      if (o.type === 'playzone') w = ph === 'midday' ? 2.2 : 1.2;
      if (o.type === 'sandpit') w = hasTrait(d, 'mud') ? 2 : 0.8;
      if (o.type === 'agility') w = hasTrait(d, 'zoomies') ? 3 : 1.2;
      if (o.type === 'pool') w = hasTrait(d, 'water') ? 3 : 0.4;
      if (o.type === 'napmat' && (hasTrait(d, 'sleepy') || ph === 'naptime')) w = ph === 'naptime' ? 3.5 : 2;
      if (w > 0) wants.push({ o: o, w: w });
    });
    if (wants.length && Math.random() < 0.45) {
      var tot = wants.reduce(function (s, x) { return s + x.w; }, 0), r = Math.random() * tot;
      for (var i = 0; i < wants.length; i++) { r -= wants[i].w; if (r <= 0) { var o = wants[i].o; goal = [o.x + randi(0, o.w - 1), o.y + randi(0, o.h - 1)]; break; } }
    }
  }
  if (!goal) {
    var cands = [];
    for (var n = 0; n < W * H; n++) if (b.dist[n] > 0 && b.dist[n] <= 7) cands.push(n);
    if (!cands.length) { d.state = 'idle'; d.idleT = 1.5; return; }
    var c = pick(cands); goal = [c % W, (c / W) | 0];
  }
  var path = pathTo(b, goal[0], goal[1]);
  if (!path || !path.length) { d.state = 'idle'; d.idleT = 1; return; }
  d.path = path; d.state = 'wander'; d.ox = rand(-10, 10); d.oy = rand(-8, 10);
}

// ================= day cycle =================
function endDay() {
  S.dogs.forEach(function (d) {
    if (d.overnight) {
      var k = objById(d.kennelId);
      if (d.objId && d.objId !== d.kennelId) { var o = objById(d.objId); if (o) o.dogId = null; }
      if (S.player.carry && S.player.carry.id === d.id) S.player.carry = null;
      if (k) { if (k.dogId && k.dogId !== d.id) { var other = dogById(k.dogId); if (other) { other.state = 'idle'; other.objId = null; } } k.dogId = d.id; d.objId = k.id; d.state = 'kennel'; d.x = (k.x + k.w / 2) * TILE; d.y = (k.y + k.h - 0.3) * TILE; }
      d.anim = null; d.path = null; d.need = null;
      d.happy = hasUp('nightstaff') ? 95 : Math.max(d.happy, 70);
    }
  });
  if (S.player.carry && S.player.carry.type !== 'dog') S.player.carry = null;
  var leftover = S.poops.length; S.poops = [];
  S.stats.leftoverPoop = leftover;
  var wages = staffWages();
  if (wages) { S.cash = Math.max(0, S.cash - wages); S.stats.wages = wages; }
  S.life.bestPerfectDay = Math.max(S.life.bestPerfectDay || 0, S.stats.perfect);
  NPCS.forEach(function (n) { n.carry = null; n.task = null; n.path = null; });
  if (leftover >= 3) { S.rep = Math.max(0, S.rep - 0.1 * Math.min(leftover, 6)); }
  UI.summary = JSON.parse(JSON.stringify(S.stats)); UI.summary.day = S.day; UI.summary.repEnd = S.rep;
  UI.summary.goals = S.goals.map(function (g) { return { text: goalText(g), done: g.done, reward: g.reward }; });
  S.day++; S.dayTime = 0; S.closing = false; S._lastPhase = 'morning'; S.stats = newStats(S.rep); S.arrivalTimer = 5; S.needT = 10; markDirty();
  S.dogs.forEach(function (d) { d.called = false; });
  if (S.tutorialDone) rollGoals();
  saveGame();
  if (typeof MP !== 'undefined') MP.recordAction('dayend', { day: UI.summary.day, earned: UI.summary.earned, served: UI.summary.served });
  showSummary();
}

// ================= save / load / migration =================
function _isnum(v) { return typeof v === 'number' && isFinite(v); }

function saveGame() {
  try {
    if (!S) return;
    if (typeof DEMO !== 'undefined' && S === DEMO) return;
    if (typeof UI !== 'undefined' && UI.inTitle) return;
    S.version = 2;
    S.savedAt = Date.now();
    var json = JSON.stringify(S);
    if (!json || json.length < 20) return;
    _storageSet(SAVE_KEY, json);
    _storageSet(BACKUP_SAVE_KEY, json);
  } catch (e) {}
}

function clearSavedGame() {
  try {
    _storageRemove(SAVE_KEY);
    _storageRemove(BACKUP_SAVE_KEY);
    for (var i = 0; i < LEGACY_SAVE_KEYS.length; i++) _storageRemove(LEGACY_SAVE_KEYS[i]);
    _storageSet(OLD_DONE_KEY, '1');
  } catch (e) {}
}

function setActiveSession(active) {
  try {
    if (active) sessionStorage.setItem(ACTIVE_SESSION_KEY, '1');
    else sessionStorage.removeItem(ACTIVE_SESSION_KEY);
  } catch (e) {}
}

function hasActiveSession() {
  try { return sessionStorage.getItem(ACTIVE_SESSION_KEY) === '1' && hasSave(); } catch (e) { return false; }
}

var VALID_DOG_STATES = {
  arriving: 1, leaving: 1, leashed: 1, idle: 1, wander: 1, nap: 1, eat: 1,
  play: 1, bath: 1, kennel: 1, drink: 1, romp: 1, toYard: 1, toCounter: 1, atDesk: 1, toOwner: 1
};
var VALID_OWNER_STATES = {
  walkIn: 1, waitCheckin: 1, waitPickup: 1, toHandover: 1, handover: 1, walkOut: 1
};

// Upgrades and sanitizes any saved game state across game updates so it never crashes and continues seamlessly.
function sanitizeAndMigrateState(s) {
  if (!s || typeof s !== 'object') return null;

  var startCash = (window.GAME_CONFIG && _isnum(window.GAME_CONFIG.startingCash)) ? window.GAME_CONFIG.startingCash : 300;
  s.version = 2;
  s.cash = _isnum(s.cash) ? Math.max(0, Math.floor(s.cash)) : startCash;
  s.xp = _isnum(s.xp) ? Math.max(0, Math.floor(s.xp)) : 0;
  s.level = (_isnum(s.level) && s.level >= 1) ? Math.floor(s.level) : 1;
  s.rep = _isnum(s.rep) ? clamp(s.rep, 0, 5) : 3.0;
  s.day = (_isnum(s.day) && s.day >= 1) ? Math.floor(s.day) : 1;
  var D = dayLen();
  s.dayTime = _isnum(s.dayTime) ? clamp(s.dayTime, 0, D) : 0;
  s.closing = !!s.closing;
  s.clock = _isnum(s.clock) ? Math.max(0, s.clock) : 0;
  s.arrivalTimer = _isnum(s.arrivalTimer) ? clamp(s.arrivalTimer, 1, 60) : 5;
  s.needT = _isnum(s.needT) ? clamp(s.needT, 1, 30) : 10;
  s.poopT = _isnum(s.poopT) ? clamp(s.poopT, 1, 120) : 30;
  s.streak = (_isnum(s.streak) && s.streak >= 0) ? Math.floor(s.streak) : 0;
  s.bestStreak = (_isnum(s.bestStreak) && s.bestStreak >= 0) ? Math.max(s.streak, Math.floor(s.bestStreak)) : s.streak;
  s.totalServed = (_isnum(s.totalServed) && s.totalServed >= 0) ? Math.floor(s.totalServed) : 0;
  s.playDays = (_isnum(s.playDays) && s.playDays >= 0) ? Math.floor(s.playDays) : 0;
  s.giftStreak = (_isnum(s.giftStreak) && s.giftStreak >= 0) ? Math.floor(s.giftStreak) : 0;
  s.lastPlayDate = typeof s.lastPlayDate === 'string' ? s.lastPlayDate : null;
  s.created = _isnum(s.created) ? s.created : Date.now();

  // Stats & Lifetime counters
  var defStats = newStats(s.rep);
  if (!s.stats || typeof s.stats !== 'object') s.stats = defStats;
  else {
    for (var sk in defStats) {
      if (sk === 'complaintList') {
        s.stats.complaintList = Array.isArray(s.stats.complaintList)
          ? s.stats.complaintList.filter(function (c) { return typeof c === 'string'; })
          : [];
      } else {
        s.stats[sk] = _isnum(s.stats[sk]) ? s.stats[sk] : defStats[sk];
      }
    }
  }

  var defLife = { earned: 0, served: 0, perfect: 0, complaints: 0, overnights: 0, bestPerfectDay: 0 };
  if (!s.life || typeof s.life !== 'object') s.life = defLife;
  else {
    for (var lk in defLife) s.life[lk] = _isnum(s.life[lk]) ? s.life[lk] : defLife[lk];
  }

  // Tutorial, upgrades, staff, specials
  if (!s.tutorial || typeof s.tutorial !== 'object' || Array.isArray(s.tutorial)) s.tutorial = {};
  s.tutorialDone = !!s.tutorialDone || TUTORIAL.every(function (t) { return !!s.tutorial[t.id]; });

  if (!s.upgrades || typeof s.upgrades !== 'object' || Array.isArray(s.upgrades)) s.upgrades = {};
  if (!s.staff || typeof s.staff !== 'object' || Array.isArray(s.staff)) s.staff = {};
  for (var stId in s.staff) { if (!STAFF_BY_ID[stId]) delete s.staff[stId]; }

  if (!s.specials || typeof s.specials !== 'object' || Array.isArray(s.specials)) s.specials = {};
  for (var spId in s.specials) {
    var spVal = s.specials[spId];
    if (!spVal) { delete s.specials[spId]; continue; }
    if (typeof spVal !== 'object' || !_isnum(spVal.day)) {
      s.specials[spId] = { day: _isnum(spVal) ? Math.max(1, Math.floor(spVal)) : s.day };
    }
  }

  // Glossary (dex)
  if (!s.dex || typeof s.dex !== 'object' || Array.isArray(s.dex)) s.dex = {};
  for (var bId in s.dex) {
    var bDef = BREED_BY_ID[bId];
    if (!bDef) { delete s.dex[bId]; continue; }
    var entry = s.dex[bId];
    if (!entry || typeof entry !== 'object') entry = { n: 1, first: s.day, coats: [0], best: 0, names: [] };
    entry.n = (_isnum(entry.n) && entry.n >= 1) ? Math.floor(entry.n) : 1;
    entry.first = (_isnum(entry.first) && entry.first >= 1) ? Math.floor(entry.first) : 1;
    entry.best = _isnum(entry.best) ? clamp(Math.round(entry.best), 0, 100) : 0;
    var maxCoat = Math.max(0, (bDef.coats ? bDef.coats.length : 1) - 1);
    if (!Array.isArray(entry.coats)) entry.coats = [0];
    entry.coats = entry.coats
      .map(function (c) { return _isnum(c) ? clamp(Math.floor(c), 0, maxCoat) : 0; })
      .filter(function (c, idx, arr) { return arr.indexOf(c) === idx; });
    if (!entry.coats.length) entry.coats = [0];
    entry.names = Array.isArray(entry.names)
      ? entry.names.filter(function (nm) { return typeof nm === 'string' && nm.length > 0; }).slice(-6)
      : [];
    s.dex[bId] = entry;
  }

  // Plots
  var plotMap = {};
  PLOTS.forEach(function (p) { plotMap[p.id] = p; });
  var rawPlots = Array.isArray(s.plots) ? s.plots : [];
  var seenPlots = {}, cleanPlots = [];
  for (var pi = 0; pi < rawPlots.length; pi++) {
    var pl = rawPlots[pi];
    if (!pl || typeof pl !== 'object' || !plotMap[pl.id] || seenPlots[pl.id]) continue;
    seenPlots[pl.id] = true;
    cleanPlots.push({
      id: pl.id,
      end: _isnum(pl.end) ? pl.end : 0,
      announced: !!pl.announced || !_isnum(pl.end) || Date.now() >= pl.end
    });
  }
  if (!seenPlots.base) cleanPlots.unshift({ id: 'base', end: 0, announced: true });
  s.plots = cleanPlots;

  // Objects
  var maxId = _isnum(s.nextId) ? Math.max(1, Math.floor(s.nextId)) : 1;
  var rawObjects = Array.isArray(s.objects) ? s.objects : [];
  var cleanObjects = [], usedObjIds = {};
  for (var oi = 0; oi < rawObjects.length; oi++) {
    var o = rawObjects[oi];
    if (!o || typeof o !== 'object') continue;
    var cDef = CAT_BY_ID[o.type];
    if (!cDef) {
      // If a building type was removed in a game update, refund a reasonable amount so the player loses nothing
      if (_isnum(o.cost) && o.cost > 0) s.cash += Math.floor(o.cost);
      continue;
    }
    var oid = (_isnum(o.id) && o.id >= 1 && !usedObjIds[Math.floor(o.id)]) ? Math.floor(o.id) : maxId++;
    usedObjIds[oid] = true;
    if (oid >= maxId) maxId = oid + 1;
    var ox = _isnum(o.x) ? Math.floor(o.x) : 20;
    var oy = _isnum(o.y) ? Math.floor(o.y) : 18;
    var olv = (_isnum(o.lvl) && o.lvl >= 1) ? Math.floor(o.lvl) : 1;
    var buildDur = (_isnum(o.buildDur) && o.buildDur > 0) ? o.buildDur : (cDef.time || 10);
    var buildEnd = _isnum(o.buildEnd) ? o.buildEnd : 0;
    var isDone = !!o.done || buildEnd <= 0 || Date.now() >= buildEnd;
    if (isDone && o.upgrading && buildEnd > 0 && Date.now() >= buildEnd) olv++;
    cleanObjects.push({
      id: oid,
      type: o.type,
      x: clamp(ox, 0, W - cDef.w),
      y: clamp(oy, 0, H - cDef.h),
      w: cDef.w,
      h: cDef.h,
      lvl: olv,
      upgrading: !isDone && !!o.upgrading,
      done: isDone,
      buildEnd: isDone ? 0 : buildEnd,
      buildDur: buildDur,
      dogId: _isnum(o.dogId) ? Math.floor(o.dogId) : null,
      reservedFor: _isnum(o.reservedFor) ? Math.floor(o.reservedFor) : null,
      useAt: -99
    });
  }
  s.objects = cleanObjects;

  // Poops
  var rawPoops = Array.isArray(s.poops) ? s.poops : [];
  var cleanPoops = [];
  for (var ppi = 0; ppi < rawPoops.length; ppi++) {
    var pp = rawPoops[ppi];
    if (!pp || typeof pp !== 'object' || !_isnum(pp.x) || !_isnum(pp.y)) continue;
    var pid = (_isnum(pp.id) && pp.id >= 1) ? Math.floor(pp.id) : maxId++;
    if (pid >= maxId) maxId = pid + 1;
    cleanPoops.push({
      id: pid,
      x: clamp(pp.x, 0, W * TILE),
      y: clamp(pp.y, 0, H * TILE),
      age: (_isnum(pp.age) && pp.age >= 0) ? pp.age : 0,
      seed: _isnum(pp.seed) ? pp.seed : Math.random(),
      ewAt: -99
    });
  }
  s.poops = cleanPoops;
  if (!Array.isArray(s.chores)) s.chores = [];
  s.choreT = _isnum(s.choreT) ? clamp(s.choreT, 1, 20) : 4;

  // Player
  var defP = {
    x: PLAYER_START[0] * TILE, y: PLAYER_START[1] * TILE, dir: 'up', face: 1, carry: null,
    moving: false, walkT: 0, walkDist: 0, emote: null, emoteT: 0, look: 0, stepT: 0
  };
  if (!s.player || typeof s.player !== 'object') s.player = defP;
  else {
    s.player.x = _isnum(s.player.x) ? clamp(s.player.x, TILE, (W - 1) * TILE) : defP.x;
    s.player.y = _isnum(s.player.y) ? clamp(s.player.y, TILE, (H - 1) * TILE) : defP.y;
    s.player.dir = DIRV[s.player.dir] ? s.player.dir : 'down';
    s.player.face = s.player.face === -1 ? -1 : 1;
    s.player.moving = false;
    s.player.walkT = _isnum(s.player.walkT) ? s.player.walkT : 0;
    s.player.walkDist = _isnum(s.player.walkDist) ? s.player.walkDist : 0;
    s.player.emote = null;
    s.player.emoteT = 0;
    s.player.look = _isnum(s.player.look) ? clamp(Math.floor(s.player.look), 0, 3) : 0;
    s.player.stepT = 0;
    var car = s.player.carry;
    if (car && typeof car === 'object') {
      if (car.type === 'food' || car.type === 'ball' || car.type === 'treat') {
        s.player.carry = { type: car.type };
      } else if (car.type === 'poop') {
        s.player.carry = { type: 'poop', age: _isnum(car.age) ? car.age : 0, n: _isnum(car.n) ? clamp(Math.floor(car.n), 1, 5) : 1 };
      } else if (car.type === 'dog' && _isnum(car.id)) {
        s.player.carry = { type: 'dog', id: Math.floor(car.id) };
      } else {
        s.player.carry = null;
      }
    } else {
      s.player.carry = null;
    }
  }

  // Dogs
  var rawDogs = Array.isArray(s.dogs) ? s.dogs : [];
  var cleanDogs = [], dogMap = {};
  for (var di = 0; di < rawDogs.length; di++) {
    var d = rawDogs[di];
    if (!d || typeof d !== 'object') continue;
    var did = (_isnum(d.id) && d.id >= 1 && !dogMap[Math.floor(d.id)]) ? Math.floor(d.id) : maxId++;
    if (did >= maxId) maxId = did + 1;
    var b = BREED_BY_ID[d.breed] || BREEDS[0];
    d.id = did;
    d.breed = b.id;
    d.coat = _isnum(d.coat) ? clamp(Math.floor(d.coat), 0, Math.max(0, b.coats.length - 1)) : 0;
    d.name = (typeof d.name === 'string' && d.name.trim()) ? d.name.trim() : DOG_NAMES[did % DOG_NAMES.length];
    if (!Array.isArray(d.traits)) d.traits = [];
    d.traits = d.traits.filter(function (t) { return !!TRAITS[t]; });
    if (!d.traits.length) d.traits = [(b.likely && b.likely[0] && TRAITS[b.likely[0]]) ? b.likely[0] : TRAIT_IDS[0]];
    d.fav = (d.fav && FAVORITES[d.fav]) ? d.fav : FAV_IDS[0];
    d.quirk = (typeof d.quirk === 'string' && d.quirk) ? d.quirk : QUIRKS[0];
    d.age = _isnum(d.age) ? clamp(Math.floor(d.age), 1, 15) : 3;
    d.seed = _isnum(d.seed) ? d.seed : Math.random() * 100;
    d.collar = (typeof d.collar === 'string' && d.collar) ? d.collar : COLLARS[did % COLLARS.length];
    d.happy = _isnum(d.happy) ? clamp(d.happy, 0, 100) : 75;
    if (!d.needs || typeof d.needs !== 'object') d.needs = { hunger: 80, clean: 90, love: 80, fun: 80 };
    else {
      d.needs.hunger = _isnum(d.needs.hunger) ? clamp(d.needs.hunger, 0, 100) : 80;
      d.needs.clean = _isnum(d.needs.clean) ? clamp(d.needs.clean, 0, 100) : 90;
      d.needs.love = _isnum(d.needs.love) ? clamp(d.needs.love, 0, 100) : 80;
      d.needs.fun = _isnum(d.needs.fun) ? clamp(d.needs.fun, 0, 100) : 80;
    }
    if (d.need && typeof d.need === 'object' && NEED_INFO[d.need.type]) {
      d.need.t = _isnum(d.need.t) ? Math.max(0, d.need.t) : 0;
    } else {
      d.need = null;
    }
    if (d.lastNeed && !NEED_INFO[d.lastNeed]) d.lastNeed = null;
    d.x = _isnum(d.x) ? clamp(d.x, 0, W * TILE) : (YARD_ENTRY[0] + 1.5) * TILE;
    d.y = _isnum(d.y) ? clamp(d.y, 0, H * TILE) : (YARD_ENTRY[1] + 0.5) * TILE;
    d.face = d.face === -1 ? -1 : 1;
    d.state = VALID_DOG_STATES[d.state] ? d.state : (d.checkedIn ? 'idle' : 'arriving');
    d.idleT = _isnum(d.idleT) ? d.idleT : 1;
    d.actT = (_isnum(d.actT) && d.actT > 0) ? d.actT : 2;
    d.playA = _isnum(d.playA) ? d.playA : 0;
    d.ox = _isnum(d.ox) ? d.ox : 0;
    d.oy = _isnum(d.oy) ? d.oy : 0;
    d.speed = (_isnum(d.speed) && d.speed > 20) ? d.speed : 78;
    d.curSpeed = _isnum(d.curSpeed) ? d.curSpeed : 0;
    d.petCd = _isnum(d.petCd) ? Math.max(0, d.petCd) : 0;
    d.bark = _isnum(d.bark) ? Math.max(0, d.bark) : 0;
    d.mood = _isnum(d.mood) ? Math.max(0, d.mood) : 0;
    d.walkDist = _isnum(d.walkDist) ? Math.max(0, d.walkDist) : 0;
    d.stepped = Array.isArray(d.stepped) ? d.stepped : [];
    d.checkedIn = !!d.checkedIn;
    d.overnight = !!d.overnight;
    d.pickupDay = _isnum(d.pickupDay) ? Math.max(1, Math.floor(d.pickupDay)) : s.day;
    d.pickupAt = _isnum(d.pickupAt) ? clamp(d.pickupAt, 0, D) : D * 0.5;
    d.called = !!d.called;
    d.ownerId = _isnum(d.ownerId) ? Math.floor(d.ownerId) : null;
    d.objId = _isnum(d.objId) ? Math.floor(d.objId) : null;
    d.kennelId = _isnum(d.kennelId) ? Math.floor(d.kennelId) : null;
    d.seekObj = _isnum(d.seekObj) ? Math.floor(d.seekObj) : null;
    // Reset animation-clock-relative timestamps so reload at now=0 never freezes dog behaviour
    d.poopAt = null;
    if (d.anim === 'poop') d.anim = null;
    d.animT = _isnum(d.animT) ? Math.max(0, d.animT) : 0;
    d.animDur = _isnum(d.animDur) ? Math.max(0, d.animDur) : 0;
    if (_isnum(d.needCool) && d.needCool > s.clock + 60) d.needCool = s.clock + 30;
    if (_isnum(d.helperSkip) && d.helperSkip > s.clock + 60) d.helperSkip = 0;
    if (Array.isArray(d.path)) {
      d.path = d.path.filter(function (pt) { return Array.isArray(pt) && _isnum(pt[0]) && _isnum(pt[1]); });
    } else d.path = null;
    if (Array.isArray(d.route)) {
      d.route = d.route.filter(function (pt) { return Array.isArray(pt) && _isnum(pt[0]) && _isnum(pt[1]); });
    } else d.route = null;

    dogMap[did] = d;
    cleanDogs.push(d);
  }

  // Owners
  var rawOwners = Array.isArray(s.owners) ? s.owners : [];
  var cleanOwners = [], ownerMap = {}, usedSlots = {};
  for (var wi = 0; wi < rawOwners.length; wi++) {
    var ow = rawOwners[wi];
    if (!ow || typeof ow !== 'object') continue;
    var owDog = _isnum(ow.dogId) ? dogMap[Math.floor(ow.dogId)] : null;
    if (!owDog) continue; // owner without a valid dog would crash handover/UI
    var owId = (_isnum(ow.id) && ow.id >= 1 && !ownerMap[Math.floor(ow.id)]) ? Math.floor(ow.id) : maxId++;
    if (owId >= maxId) maxId = owId + 1;
    ow.id = owId;
    ow.dogId = owDog.id;
    ow.name = (typeof ow.name === 'string' && ow.name.trim()) ? ow.name.trim() : OWNER_NAMES[owId % OWNER_NAMES.length];
    ow.kind = ow.kind === 'pickup' ? 'pickup' : 'dropoff';
    ow.state = VALID_OWNER_STATES[ow.state] ? ow.state : 'walkIn';
    ow.x = _isnum(ow.x) ? clamp(ow.x, -800, W * TILE + 800) : DOOR_X;
    ow.y = _isnum(ow.y) ? clamp(ow.y, 0, H * TILE) : WALK_Y;
    ow.dir = DIRV[ow.dir] ? ow.dir : 'up';
    ow.face = ow.face === -1 ? -1 : 1;
    ow.moving = !!(ow.state === 'walkIn' || ow.state === 'walkOut' || ow.state === 'toHandover');
    ow.walkT = _isnum(ow.walkT) ? ow.walkT : 0;
    ow.walkDist = _isnum(ow.walkDist) ? ow.walkDist : 0;
    ow.look = (ow.look && typeof ow.look === 'object') ? ow.look : ((typeof randomLook === 'function') ? randomLook() : {});
    var defPat = (ow.kind === 'pickup' ? 95 : 75) * (DIFFICULTY[settings.difficulty] ? DIFFICULTY[settings.difficulty].patience : 1);
    ow.patienceMax = (_isnum(ow.patienceMax) && ow.patienceMax > 0) ? ow.patienceMax : defPat;
    ow.patience = _isnum(ow.patience) ? clamp(ow.patience, 0, ow.patienceMax) : ow.patienceMax;
    ow.angry = !!ow.angry;
    ow.say = typeof ow.say === 'string' ? ow.say : '';
    ow.sayT = _isnum(ow.sayT) ? Math.max(0, ow.sayT) : 0;
    ow.emote = typeof ow.emote === 'string' ? ow.emote : null;
    ow.emoteT = _isnum(ow.emoteT) ? Math.max(0, ow.emoteT) : 0;
    ow.hoT = _isnum(ow.hoT) ? Math.max(0, ow.hoT) : 0;
    ow.awayT = _isnum(ow.awayT) ? Math.max(0, ow.awayT) : 0;
    ow.byStaff = !!ow.byStaff;

    if (ow.state === 'walkIn' || ow.state === 'waitCheckin' || ow.state === 'waitPickup') {
      var sl = (_isnum(ow.slot) && ow.slot >= 0 && ow.slot < QUEUE.length && !usedSlots[Math.floor(ow.slot)]) ? Math.floor(ow.slot) : -1;
      if (sl < 0) {
        for (var si = 0; si < QUEUE.length; si++) if (!usedSlots[si]) { sl = si; break; }
      }
      if (sl < 0) continue; // no counter slot available
      ow.slot = sl;
      usedSlots[sl] = true;
    } else {
      ow.slot = null;
    }

    if (Array.isArray(ow.route)) {
      ow.route = ow.route.filter(function (pt) { return Array.isArray(pt) && _isnum(pt[0]) && _isnum(pt[1]); });
    } else {
      ow.route = [];
    }
    if (ow.state === 'walkIn' && !ow.route.length) {
      var qSlot = QUEUE[ow.slot || 0];
      ow.route = [[qSlot[0] * TILE, qSlot[1] * TILE]];
    } else if (ow.state === 'toHandover' && !ow.route.length) {
      ow.route = [[HANDOVER_SPOT[0] * TILE, HANDOVER_SPOT[1] * TILE]];
    } else if (ow.state === 'walkOut' && !ow.route.length) {
      ow.route = exitRoute(ow);
    }

    ownerMap[owId] = ow;
    cleanOwners.push(ow);
  }
  s.owners = cleanOwners;

  // Bind S temporarily so walkGrid / objById / dogById / canStand helpers work against s
  var prevS = S;
  S = s;
  s.dogs = cleanDogs;
  markDirty(true);
  buildWalk();

  // Reconcile object <-> dog references (tubs & kennels)
  s.objects.forEach(function (o) {
    if (o.dogId != null) {
      var occ = dogMap[o.dogId];
      var expectedState = o.type === 'tub' ? 'bath' : o.type === 'kennel' ? 'kennel' : null;
      if (!occ || !o.done || !expectedState || occ.state !== expectedState || occ.objId !== o.id) {
        o.dogId = null;
      }
    }
    if (o.reservedFor != null) {
      var resDog = dogMap[o.reservedFor];
      if (!resDog || resDog.state === 'leaving' || !resDog.overnight || o.type !== 'kennel' || !o.done) {
        o.reservedFor = null;
      } else {
        resDog.kennelId = o.id;
      }
    }
  });

  // Reconcile player carry <-> leashed dog
  var carriedDogId = (s.player.carry && s.player.carry.type === 'dog') ? s.player.carry.id : null;
  if (carriedDogId != null) {
    var cd = dogMap[carriedDogId];
    if (!cd || cd.state === 'leaving') {
      s.player.carry = null;
      carriedDogId = null;
    } else {
      cd.state = 'leashed';
      cd.checkedIn = true;
      if (cd.objId) { var cob = objById(cd.objId); if (cob) cob.dogId = null; cd.objId = null; }
    }
  }

  // Filter and reconcile dogs after owner & object links are known
  var finalDogs = [];
  for (var fdi = 0; fdi < s.dogs.length; fdi++) {
    var fd = s.dogs[fdi];
    if (fd.state === 'arriving') {
      var dropOw = fd.ownerId ? ownerMap[fd.ownerId] : null;
      if (!dropOw) {
        dropOw = s.owners.filter(function (o) { return o.dogId === fd.id && o.kind === 'dropoff'; })[0] || null;
      }
      if (!dropOw) {
        if (!fd.checkedIn) {
          if (fd.kennelId) { var fk = objById(fd.kennelId); if (fk && fk.reservedFor === fd.id) fk.reservedFor = null; }
          continue; // drop orphaned un-checked-in arriving dog
        }
        fd.state = 'idle';
        fd.idleT = 1;
      } else {
        fd.ownerId = dropOw.id;
      }
    } else if (fd.state === 'leaving') {
      var leaveOw = fd.ownerId ? ownerMap[fd.ownerId] : null;
      if (!leaveOw) continue; // already paid & owner left
    } else if (fd.state === 'leashed') {
      if (carriedDogId !== fd.id) {
        var tw = nearestWalkable(fd.x, fd.y);
        fd.x = (tw[0] + 0.5) * TILE; fd.y = (tw[1] + 0.5) * TILE;
        fd.state = 'idle'; fd.idleT = 1; fd.autoRelease = false; fd.leashedBy = null;
      }
    } else if (fd.state === 'bath' || fd.state === 'kennel') {
      var stObj = fd.objId ? objById(fd.objId) : null;
      var wantType = fd.state === 'bath' ? 'tub' : 'kennel';
      if (!stObj || !stObj.done || stObj.type !== wantType) {
        var tw2 = nearestWalkable(fd.x, fd.y);
        fd.x = (tw2[0] + 0.5) * TILE; fd.y = (tw2[1] + 0.5) * TILE;
        fd.state = 'idle'; fd.idleT = 1; fd.objId = null;
      } else {
        stObj.dogId = fd.id;
      }
    } else if (fd.state === 'romp') {
      var part = _isnum(fd.partner) ? dogMap[fd.partner] : null;
      if (!part || part.state !== 'romp' || part.partner !== fd.id || !_isnum(fd.rompX) || !_isnum(fd.rompY)) {
        fd.state = 'idle'; fd.idleT = 1; fd.partner = null;
      }
    } else if (fd.state === 'toYard') {
      if (!fd.route || !fd.route.length) {
        fd.route = [SHOP_WAY.gapN, SHOP_WAY.door, SHOP_WAY.yard].map(function (w) { return [w[0] * TILE, w[1] * TILE]; });
      }
    } else if (fd.state === 'toCounter') {
      if (!fd.route || !fd.route.length) {
        fd.route = [SHOP_WAY.door, SHOP_WAY.gapN, SHOP_WAY.desk].map(function (w) { return [w[0] * TILE, w[1] * TILE]; });
      }
    } else if (fd.state === 'toOwner') {
      if (!fd.route || !fd.route.length) {
        fd.state = 'atDesk';
      }
    }

    // Ensure yard dogs are standing on a walkable yard tile
    if (fd.checkedIn && (fd.state === 'idle' || fd.state === 'wander' || fd.state === 'nap' || fd.state === 'eat' || fd.state === 'play' || fd.state === 'drink')) {
      if (!dogWalkable(tileOf(fd.x), tileOf(fd.y))) {
        var nw = nearestWalkable(fd.x, fd.y);
        fd.x = (nw[0] + 0.5) * TILE; fd.y = (nw[1] + 0.5) * TILE;
        fd.path = null;
      }
    }

    // Reconcile d.called with active pickup owners so closing time never deadlocks
    if (fd.checkedIn && fd.state !== 'leaving') {
      var hasPickupOwner = s.owners.some(function (o) {
        return o.dogId === fd.id && o.kind === 'pickup' && o.state !== 'walkOut';
      });
      fd.called = hasPickupOwner;
    }

    finalDogs.push(fd);
  }
  s.dogs = finalDogs;

  // Ensure every remaining owner still points to a dog in finalDogs
  var finalDogMap = {};
  s.dogs.forEach(function (d) { finalDogMap[d.id] = d; });
  s.owners = s.owners.filter(function (o) { return !!finalDogMap[o.dogId]; });

  // Ensure player is not stuck inside a newly solid tile after a game update
  if (!canStand(s.player.x, s.player.y)) {
    var bestP = null, bestD = 1e9;
    for (var py = 6; py < H - 3; py++) {
      for (var px = 4; px < W - 3; px++) {
        var wx = (px + 0.5) * TILE, wy = (py + 0.5) * TILE;
        if (canStand(wx, wy)) {
          var d2 = dist(s.player.x, s.player.y, wx, wy);
          if (d2 < bestD) { bestD = d2; bestP = [wx, wy]; }
        }
      }
    }
    if (bestP) { s.player.x = bestP[0]; s.player.y = bestP[1]; }
    else { s.player.x = PLAYER_START[0] * TILE; s.player.y = PLAYER_START[1] * TILE; }
  }

  // Daily goals
  if (!Array.isArray(s.goals)) s.goals = [];
  s.goals = s.goals.filter(function (g) {
    return g && typeof g === 'object' && goalDef(g.id) && _isnum(g.n) && g.n > 0 && _isnum(g.reward);
  });
  if (s.tutorialDone && !s.goals.length) {
    rollGoals();
  }

  s.nextId = maxId;
  S = prevS;
  return s;
}

// Ensures no humans are stuck waiting at the counter for dogs when the app is closed, backgrounded, or reloaded.
// If workers (Receptionist / Yard Helper) are hired, they run the shop while closed — but earning offline cash is much harder!
function clearWaitingOwners(s, simulateOfflineShift) {
  if (!s || typeof s !== 'object') return;
  var prevS = S;
  S = s;
  try {
    var D = dayLen();
    var wCount = hiredStaffCount();
    var hasWorkers = wCount > 0;
    var remainingDogs = [];
    var dogsById = {};
    (s.dogs || []).forEach(function (d) { if (d) dogsById[d.id] = d; });

    // Settle or clear any owners currently at the counter or walking in
    (s.owners || []).forEach(function (o) {
      if (!o) return;
      var d = dogsById[o.dogId];
      if (o.kind === 'pickup' && d && d.checkedIn && d.state !== 'leaving') {
        if (hasWorkers) {
          // Hired staff handle the pickup while closed, but offline net earnings are much lower (after staff/supply costs)
          var payRate = Math.min(0.48, 0.20 + wCount * 0.06);
          var pay = Math.max(2, Math.round(dogPrice(d) * payRate));
          s.cash = (s.cash || 0) + pay;
          if (s.stats) { s.stats.earned = (s.stats.earned || 0) + pay; s.stats.served = (s.stats.served || 0) + 1; }
          if (s.life) { s.life.earned = (s.life.earned || 0) + pay; s.life.served = (s.life.served || 0) + 1; }
          s.totalServed = (s.totalServed || 0) + 1;
          if (s.player && s.player.carry && s.player.carry.type === 'dog' && s.player.carry.id === d.id) s.player.carry = null;
          if (d.objId) { var ob = objById(d.objId); if (ob && ob.dogId === d.id) ob.dogId = null; }
          if (d.kennelId) { var k = objById(d.kennelId); if (k && k.reservedFor === d.id) k.reservedFor = null; }
          d._settledOnClose = true;
        }
      } else if (o.kind === 'dropoff' && d && !d.checkedIn) {
        if (d.kennelId) { var k2 = objById(d.kennelId); if (k2 && k2.reservedFor === d.id) k2.reservedFor = null; }
        d._settledOnClose = true;
      }
    });

    (s.dogs || []).forEach(function (d) {
      if (!d || d._settledOnClose || d.state === 'leaving' || (!d.checkedIn && d.state === 'arriving')) return;
      d.called = false;
      d.ownerId = null;
      if (d.state === 'toCounter' || d.state === 'atDesk' || d.state === 'toOwner' || d.state === 'npcLeashed') {
        var tw = nearestWalkable(d.x, d.y);
        d.x = (tw[0] + 0.5) * TILE; d.y = (tw[1] + 0.5) * TILE;
        d.state = 'idle'; d.route = null; d.path = null; d.npcHolder = null;
      }
      // Give the player breathing room before any daytime pickup owner arrives after reopening
      if (!d.overnight && d.pickupDay <= s.day && !s.closing) {
        d.pickupAt = clamp(Math.max((s.dayTime || 0) + 35, d.pickupAt || D * 0.75), (s.dayTime || 0) + 20, D - 8);
      }
      remainingDogs.push(d);
    });
    s.dogs = remainingDogs;
    s.owners = [];
    s.arrivalTimer = Math.max(s.arrivalTimer || 0, 5);

    // If workers are hired and the app was closed for a while, workers run the shop offline (at much lower net profit)
    if (simulateOfflineShift && hasWorkers && _isnum(s.savedAt)) {
      var elapsedSec = Math.floor((Date.now() - s.savedAt) / 1000);
      if (elapsedSec >= 45) {
        var cappedSec = Math.min(elapsedSec, 6 * 3600);
        var teamFactor = Math.min(1.2, 0.25 + wCount * 0.14);
        var capNow = Math.max(1, starBaseCap(s.rep || 3, s.day || 1));
        var dogsHandled = Math.max(1, Math.floor((cappedSec / 180) * teamFactor * Math.min(capNow, 6)));
        var netPerDog = Math.max(2, Math.round((2.5 + (s.level || 1) * 0.35) * Math.min(1.1, 0.5 + wCount * 0.12)));
        var totalNet = dogsHandled * netPerDog;
        s.cash = (s.cash || 0) + totalNet;
        s.totalServed = (s.totalServed || 0) + dogsHandled;
        if (s.stats) { s.stats.earned = (s.stats.earned || 0) + totalNet; s.stats.served = (s.stats.served || 0) + dogsHandled; }
        if (s.life) { s.life.earned = (s.life.earned || 0) + totalNet; s.life.served = (s.life.served || 0) + dogsHandled; }
        s.offlineReport = { sec: cappedSec, dogs: dogsHandled, earned: totalNet, workers: wCount };
      }
    }
  } catch (e) {}
  S = prevS;
}

function loadGame() {
  try {
    var found = _findBestRawSave();
    if (!found || !found.state) return false;
    var raw = found.state;
    // Only use v1 reset-and-refund migration if it came from the v1 save key or is a v1 save with old map coordinates
    var isLegacyV1Map = raw.version === 1 && (found.isV1 || (Array.isArray(raw.objects) && raw.objects.some(function (o) { return o && _isnum(o.x) && o.x < 18; })));
    if (isLegacyV1Map) {
      _storageSet(OLD_DONE_KEY, '1');
      migrateV1(raw);
      return true;
    }
    var clean = sanitizeAndMigrateState(raw);
    if (!clean) return false;
    clearWaitingOwners(clean, true);
    S = clean;
    markDirty(true);
    NPCS = [];
    syncStaff();
    saveGame();
    return true;
  } catch (e) {
    console.error('loadGame recovery error', e);
  }
  return false;
}

// the first version had a different, smaller map: keep the progress, refund what was built
function migrateV1(old) {
  var OLD_COST = { kennel: 150, foodbin: 80, toybox: 80, trash: 50, tub: 250, treatjar: 150, playzone: 220, pool: 450, agility: 650, napmat: 120,
    flowers: 20, hydrant: 30, bush: 35, bench: 60, tree: 70, lamp: 50, statue: 220, fountain: 380 };
  var OLD_PLOT = { north: 300, east: 700, south: 400 };
  var refund = 0, free = { foodbin: 1, toybox: 1, trash: 1, tub: 1, flowers: 2, bush: 1 }; // the starter set was free
  (old.objects || []).forEach(function (o) { if (!o) return; if (free[o.type] > 0) free[o.type]--; else refund += OLD_COST[o.type] || (CAT_BY_ID[o.type] ? CAT_BY_ID[o.type].cost : 0) || 0; });
  (old.plots || []).forEach(function (p) { if (!p) return; refund += OLD_PLOT[p.id] || 0; });
  refund = Math.max(0, refund);
  newState();
  S.cash = Math.floor((_isnum(old.cash) ? old.cash : 300) + refund);
  S.xp = _isnum(old.xp) ? old.xp : 0;
  S.level = (_isnum(old.level) && old.level >= 1) ? Math.floor(old.level) : 1;
  S.rep = _isnum(old.rep) ? clamp(old.rep, 0, 5) : 3;
  S.day = (_isnum(old.day) && old.day >= 1) ? Math.floor(old.day) : 1;
  S.totalServed = _isnum(old.totalServed) ? old.totalServed : 0;
  S.bestStreak = _isnum(old.bestStreak) ? old.bestStreak : 0;
  S.tutorial = (old.tutorial && typeof old.tutorial === 'object') ? old.tutorial : {};
  S.tutorialDone = !!old.tutorialDone;
  if (old.upgrades && typeof old.upgrades === 'object') S.upgrades = old.upgrades;
  if (old.dex && typeof old.dex === 'object') S.dex = old.dex;
  if (old.life && typeof old.life === 'object') S.life = old.life;
  if (old.staff && typeof old.staff === 'object') S.staff = old.staff;
  if (old.specials && typeof old.specials === 'object') S.specials = old.specials;
  if (_isnum(old.playDays)) S.playDays = old.playDays;
  if (_isnum(old.giftStreak)) S.giftStreak = old.giftStreak;
  if (typeof old.lastPlayDate === 'string') S.lastPlayDate = old.lastPlayDate;
  if (old.player && _isnum(old.player.look)) S.player.look = clamp(Math.floor(old.player.look), 0, 3);
  S.stats = newStats(S.rep);
  S = sanitizeAndMigrateState(S);
  if (S.tutorialDone) rollGoals();
  S.migrated = { refund: refund };
  NPCS = []; syncStaff();
  saveGame();
}

if (typeof window !== 'undefined' && window.addEventListener) {
  window.addEventListener('pagehide', function () { if (S) clearWaitingOwners(S); saveGame(); });
  window.addEventListener('beforeunload', function () { if (S) clearWaitingOwners(S); saveGame(); });
}
