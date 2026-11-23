'use strict';
var UI = {
  mode: 'title', prevMode: 'play', actions: null, mouse: { sx: 0, sy: 0, in: false },
  buildSel: null, buildTool: null, buildTab: 'care',
  summary: null, cashShown: 0, cashPulse: 0, lastRoster: 0, modalStack: [], dexSel: null, dexNew: 0,
  tasksOpen: false, rosterOpen: false,
  camFocus: null, sceneT: 0, miniT: 0, miniDirty: true, cashWorld: null, titleT: 0,
  joy: null, touchTarget: null, pinch: null, touchBuild: null
};
var $ = function (id) { return document.getElementById(id); };
function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

function initAudio() { audioInit(); if (!UI.volApplied && typeof AC !== 'undefined' && AC) { UI.volApplied = true; applyVolumes(); } }

// ---------------- modes ----------------
function setMode(m) {
  UI.mode = m;
  document.body.classList.toggle('building', m === 'build');
  document.body.classList.toggle('title', !!UI.inTitle);
  if (m !== 'build') { UI.buildSel = null; UI.buildTool = null; CAM.panX = 0; CAM.panY = 0; }
  if (m !== 'play') { UI.joy = null; UI.touchTarget = null; }
  $('buildpanel').hidden = m !== 'build';
  if (m === 'build') renderBuildPanel();
  $('buildBtn').classList.toggle('on', m === 'build');
}
function openModal(html, mode, cls) {
  if (UI.mode === 'play' || UI.mode === 'build') UI.prevMode = UI.mode;
  if (UI.mode === 'paused' || UI.mode === 'title' || UI.mode === 'summary') UI.modalStack.push({ mode: UI.mode, html: $('modal').innerHTML });
  $('modal').innerHTML = '<div class="card ' + (cls || '') + '">' + html + '</div>';
  $('modalwrap').hidden = false; UI.mode = mode;
  UI.joy = null; sfx('ui_open');
}
function closeModal() {
  var back = UI.modalStack.pop();
  sfx('ui_close');
  if (back) { if (back.mode === 'title') { openTitle(); return; } $('modal').innerHTML = back.html; UI.mode = back.mode; bindModalButtons(); return; }
  $('modalwrap').hidden = true; $('modal').innerHTML = '';
  setMode(UI.prevMode || 'play');
}
function closeAllModals() { UI.modalStack = []; $('modalwrap').hidden = true; $('modal').innerHTML = ''; setMode(UI.prevMode || 'play'); }
function bindModalButtons() {
  var m = $('modal');
  m.querySelectorAll('[data-act]').forEach(function (b) { b.onclick = function () { initAudio(); sfx('click'); MODAL_ACTS[b.getAttribute('data-act')](b); }; });
  m.querySelectorAll('select[data-set]').forEach(function (s) { s.onchange = function () { var k = s.getAttribute('data-set'), od = dayLen(); settings[k] = k === 'dayLength' ? +s.value : s.value; if (k === 'dayLength' && S) S.dayTime *= dayLen() / od; saveSettings(); }; });
  m.querySelectorAll('input[type=range][data-set]').forEach(function (s) { s.oninput = function () { initAudio(); settings[s.getAttribute('data-set')] = +s.value; saveSettings(); }; s.onchange = function () { sfx('coin'); }; });
  m.querySelectorAll('[data-look]').forEach(function (b) {
    b.onclick = function () {
      var prevLook = UI.pickLook || 0;
      UI.pickLook = +b.getAttribute('data-look');
      UI._userPickedLook = true;
      m.querySelectorAll('[data-look]').forEach(function (x) { x.classList.toggle('on', x === b); });
      var nameInp = $('titleNameInput');
      var looksArr = (typeof PLAYER_LOOKS !== 'undefined') ? PLAYER_LOOKS : [];
      if (nameInp && looksArr[UI.pickLook]) {
        var oldDef = looksArr[prevLook] && looksArr[prevLook].name;
        if (!nameInp.value.trim() || nameInp.value.trim() === oldDef) {
          nameInp.value = looksArr[UI.pickLook].name;
        }
      }
      if (typeof MP !== 'undefined') {
        MP.setProfile(nameInp ? nameInp.value : (looksArr[UI.pickLook] && looksArr[UI.pickLook].name), UI.pickLook);
      }
      sfx('click');
    };
  });
  var tName = $('titleNameInput'), tRoom = $('titleRoomInput');
  if (tName && typeof MP !== 'undefined') {
    tName.onchange = tName.onblur = function () { MP.setProfile(tName.value, UI.pickLook, tRoom ? tRoom.value : undefined); };
  }
  if (tRoom && typeof MP !== 'undefined') {
    tRoom.onchange = tRoom.onblur = function () { MP.setProfile(tName ? tName.value : undefined, UI.pickLook, tRoom.value); };
  }
  m.querySelectorAll('[data-breed]').forEach(function (b) { b.onclick = function () { UI.dexSel = b.getAttribute('data-breed'); sfx('page'); renderDex(); }; });
}
function fadeThen(fn) { var f = $('fade'); f.style.display = 'block'; void f.offsetWidth; f.classList.add('on'); setTimeout(function () { fn(); setTimeout(function () { f.classList.remove('on'); setTimeout(function () { if (!f.classList.contains('on')) f.style.display = 'none'; }, 700); }, 160); }, 420); }
function enterPlayFromState(fresh) {
  if (fresh) {
    if (typeof clearSavedGame === 'function') clearSavedGame();
    else { try { localStorage.removeItem(SAVE_KEY); localStorage.setItem(OLD_DONE_KEY, '1'); } catch (e) {} }
    S = null; newState(); S.player.look = UI.pickLook || 0;
  } else if (!loadGame()) {
    newState(); S.player.look = UI.pickLook || 0;
  } else if (S.migrated) {
    S.player.look = UI.pickLook || 0;
  }
  if (S && (fresh || UI._userPickedLook) && UI.pickLook != null) S.player.look = UI.pickLook;
  else if (S && S.player && typeof S.player.look === 'number') UI.pickLook = S.player.look;
  UI._userPickedLook = false;
  UI.inTitle = false;
  if (typeof setActiveSession === 'function') setActiveSession(true);
  if (typeof MP !== 'undefined') MP.onStartGame(fresh);
  UI.cashShown = S.cash; FX.parts = []; FX.floats = [];
  UI.modalStack = []; $('modalwrap').hidden = true; $('modal').innerHTML = ''; UI.prevMode = 'play'; setMode('play');
  CAM.ready = false; sfx('day_start'); setTimeout(dayBanner, 650);
  var gift = dailyGift();
  if (gift) setTimeout(function () { if (UI.mode === 'play' || UI.mode === 'build') showGift(gift); }, 3000);
  if (S.migrated) { var r = S.migrated.refund; delete S.migrated; saveGame(); openModal('<h2>Welcome back!</h2><p>Paws &amp; Play has moved into a bigger, prettier home. Your level, reputation and cash came along' + (r ? ', and everything you had built was refunded: <b class="good">+' + fmtMoney(r) + '</b>' : '') + '. The yard is a fresh start — time to decorate!</p><div class="row"><button data-act="back" class="primary">Let\'s go</button></div>', 'note'); bindModalButtons(); }
  else if (S.totalServed === 0 && !S.tutorial.checkin) toast('🐶 Drag anywhere on screen to walk to the SERVE pad behind the counter!', 'good');
  saveGame();
}
function startGame(fresh) {
  var tName = $('titleNameInput'), tRoom = $('titleRoomInput');
  if (typeof MP !== 'undefined' && (tName || tRoom)) {
    MP.setProfile(tName ? tName.value : undefined, UI.pickLook, tRoom ? tRoom.value : undefined);
  }
  fadeThen(function () { enterPlayFromState(fresh); });
}
function dailyGift() {
  var today = new Date(), key = today.getFullYear() + '-' + (today.getMonth() + 1) + '-' + today.getDate();
  if (!S.lastPlayDate) { S.lastPlayDate = key; S.giftStreak = 1; S.playDays = 1; saveGame(); return null; }
  if (S.lastPlayDate === key) return null;
  var y = new Date(today.getTime() - 864e5), ykey = y.getFullYear() + '-' + (y.getMonth() + 1) + '-' + y.getDate();
  S.giftStreak = S.lastPlayDate === ykey ? (S.giftStreak || 0) + 1 : 1;
  S.lastPlayDate = key; S.playDays = (S.playDays || 0) + 1;
  var amount = 25 + 15 * Math.min(S.giftStreak, 7);
  S.cash += amount; saveGame();
  return { amount: amount, streak: S.giftStreak, days: S.playDays };
}
function showGift(g) {
  if (UI.inTitle || !S) return;
  var next = g.streak < 7 ? 'Come back tomorrow for ' + fmtMoney(25 + 15 * Math.min(g.streak + 1, 7)) + '.' : 'You are at the top gift — keep the streak going!';
  openModal('<h2>🎁 Daily gift</h2><p style="text-align:center">Welcome back! The regulars chipped in:</p><div class="rating"><b class="money">+' + fmtMoney(g.amount) + '</b></div>' +
    '<p style="text-align:center">' + (g.streak > 1 ? '🔥 ' + g.streak + ' days in a row' : 'Day ' + g.days + ' of running Paws & Play') + ' · ' + next + '</p>' +
    '<div class="row"><button data-act="back" class="primary">Thanks!</button></div>', 'gift');
  bindModalButtons(); sfx('coin'); confetti(S.player.x, S.player.y - 50, 30);
}
var MODAL_ACTS = {
  play: function () { startGame(false); },
  newgame: function () {
    if (hasSave()) confirmBox('Start over? Your daycare, cash and buildings will be erased.', function () { startGame(true); });
    else startGame(true);
  },
  resume: function () { closeModal(); },
  settings: function () { openSettings(); },
  help: function () { openHelp(); },
  dex: function () { openDex(); },
  coop: function () { if (typeof MP !== 'undefined') MP.openCoopModal(); },
  partnersummary: function () { if (typeof MP !== 'undefined') MP.presentPartnerSummary(true); },
  back: function () { closeModal(); },
  nextday: function () { fadeThen(function () { closeAllModals(); setMode('play'); sfx('day_start'); setTimeout(dayBanner, 500); }); },
  defaults: function () { var od = dayLen(); settings = defaultSettings(); if (S && dayLen() !== od) S.dayTime *= dayLen() / od; saveSettings(); closeModal(); openSettings(); },
  yes: function () { var f = UI.confirmYes; closeModal(); if (f) f(); },
  no: function () { closeModal(); },
  totitle: function () { saveGame(); if (typeof setActiveSession === 'function') setActiveSession(false); fadeThen(function () { S = null; UI.modalStack = []; groundDirty = true; walkGrid = null; CAM.ready = false; FX.parts = []; FX.floats = []; $('toasts').innerHTML = ''; toastQ.length = 0; openTitle(); }); },
};
function confirmBox(text, yes) {
  UI.confirmYes = yes;
  openModal('<h2>Are you sure?</h2><p>' + text + '</p><div class="row"><button data-act="yes" class="primary">Yes</button><button data-act="no" class="flat">Cancel</button></div>', 'confirm');
  bindModalButtons();
}

// ---------------- title / pause / settings / help ----------------
function lookPortrait(i, size) {
  try { if (typeof personPortraitURL === 'function' && typeof PLAYER_LOOKS !== 'undefined') return personPortraitURL(PLAYER_LOOKS[i], size); } catch (e) {}
  return '';
}
function openTitle() {
  var has = hasSave();
  UI.mode = 'title'; UI.inTitle = true; document.body.classList.add('title');
  var looks = (typeof PLAYER_LOOKS !== 'undefined') ? PLAYER_LOOKS : [];
  var savedLook = (has && typeof peekSavedLook === 'function') ? peekSavedLook() : null;
  if (savedLook != null && !UI._userPickedLook) UI.pickLook = savedLook;
  else if (typeof MP !== 'undefined' && UI.pickLook == null) UI.pickLook = MP.playerLook;
  else if (UI.pickLook == null) UI.pickLook = 0;
  var pName = (typeof MP !== 'undefined' && MP.playerName) ? MP.playerName : ((looks[UI.pickLook] && looks[UI.pickLook].name) || 'Sam');
  var rCode = (typeof MP !== 'undefined' && MP.roomCode) ? MP.roomCode : 'PAWS';
  var chars = looks.length ? '<p class="small" style="margin-bottom:0">Choose your keeper</p><div class="chars">' + looks.map(function (l, i) { return '<div class="ch' + (i === UI.pickLook ? ' on' : '') + '" data-look="' + i + '"><img src="' + lookPortrait(i, 64) + '"><small>' + esc(l.name || ('Keeper ' + (i + 1))) + '</small></div>'; }).join('') + '</div>' : '';
  var mpBar = '<div class="title-mp-bar">' +
    '<label>Name <input type="text" id="titleNameInput" maxlength="18" value="' + esc(pName) + '"></label>' +
    '<label>Room <input type="text" id="titleRoomInput" maxlength="8" value="' + esc(rCode) + '" style="width:70px;text-transform:uppercase;text-align:center"></label>' +
    '</div>';
  $('modal').innerHTML = '<div class="card title"><div class="logo">Paws &amp; Play<span>DOGGY DAYCARE</span></div>' +
    '<p class="tag">Drag with one thumb to welcome pups, stack supplies,<br>and expand the cosiest daycare on iPhone!</p>' + chars + mpBar +
    '<div class="row col"><button data-act="play" class="primary big">' + (has ? '▶ Continue Daycare' : '▶ Play Daycare') + '</button>' +
    '<button data-act="coop">📱 iPhone Co-op</button>' +
    (has ? '<button data-act="newgame" class="flat">New Game</button>' : '') +
    '<div class="row" style="margin-top:0"><button data-act="help" class="flat">How to Play</button><button data-act="settings" class="flat">Settings</button></div></div></div>';
  $('modalwrap').hidden = false; bindModalButtons();
}
function openPause() {
  saveGame();
  openModal('<h2>Paused</h2><div class="row col"><button data-act="resume" class="primary big">Resume</button><button data-act="coop">📱 iPhone Co-op &amp; QR Code</button><button data-act="partnersummary">📋 What Partner Did</button><button data-act="dex">📖 Dog Breeds</button><button data-act="help">How to Play</button><button data-act="settings">Settings</button><button data-act="totitle" class="flat">Save &amp; Quit to Title</button></div>' +
    '<p class="small">Your daycare saves automatically on your iPhone.</p>', 'paused', 'narrow');
  bindModalButtons();
}
function openHelp() {
  openModal('<h2>How to Play</h2><div class="help">' +
    '<p>🕹️ <b>One-Thumb Controls:</b> Touch and drag anywhere on the screen to move your keeper with the floating joystick (or tap any spot to walk there). Every action happens <b>automatically</b> when you walk up to it!</p>' +
    '<p>🔔 <b>Check-In:</b> When an owner rings the bell at the counter, step onto the <b>SERVE pad</b>. You welcome their dog and it happily trots straight out to the daycare yard!</p>' +
    '<p>🥣 <b>Stack &amp; Serve:</b> Walk onto the <b>Food Bin</b>, <b>Toy Box</b>, or <b>Treat Jar</b> pad to stack up to 3 items in your hands, then walk past any dog asking for 🍖 food, 🎾 play, or 🍪 treats to serve them in stride! Walk by a dog with ❤️ to cuddle it, or walk by a muddy 🛁 dog to leash it to the <b>Bath Tub</b>.</p>' +
    '<p>💩 <b>Quick Scoop:</b> Walk right over poop to scoop it into your stack, then pass by the <b>Poop Bin</b> to toss it away.</p>' +
    '<p>💵 <b>Floor Unlock Pads &amp; Shop:</b> Step onto green <b>$ Pads</b> in the yard to pour cash in and build stations or hire staff on the spot, or tap <b>🔨 Shop</b> at the bottom to decorate and expand your land!</p>' +
    '<p>🏠 <b>Pickup:</b> When an owner comes back, a 🏠 marker appears over their dog. Walk near the dog to leash it, then bring it to the <b>SERVE pad</b> behind the counter to get paid!</p>' +
    '</div><div class="row"><button data-act="back" class="primary">Got it!</button></div>', 'help');
  bindModalButtons();
}
function openSettings() {
  function opt(v, cur, label) { return '<option value="' + v + '"' + (String(v) === String(cur) ? ' selected' : '') + '>' + label + '</option>'; }
  function slider(key, min, max, step) { return '<input type="range" data-set="' + key + '" min="' + min + '" max="' + max + '" step="' + step + '" value="' + settings[key] + '">'; }
  openModal('<h2>Settings</h2>' +
    '<div class="opts"><span>🎵 Music</span>' + slider('musicVol', 0, 1, 0.05) +
    '<span>🍃 Ambience</span>' + slider('ambVol', 0, 1, 0.05) +
    '<span>🔔 Sound effects</span>' + slider('sfxVol', 0, 1, 0.05) +
    '<span>🔍 Camera zoom</span>' + slider('zoom', 0.7, 1.4, 0.1) +
    '<span>Day length</span><select data-set="dayLength">' + opt(180, settings.dayLength, '3 minutes') + opt(300, settings.dayLength, '5 minutes') + opt(480, settings.dayLength, '8 minutes') + opt(720, settings.dayLength, '12 minutes') + '</select>' +
    '<span>Difficulty</span><select data-set="difficulty">' + opt('relaxed', settings.difficulty, 'Relaxed') + opt('normal', settings.difficulty, 'Normal') + opt('hectic', settings.difficulty, 'Hectic') + '</select></div>' +
    '<div class="row"><button data-act="back" class="primary">Done</button><button data-act="defaults" class="flat">Restore Defaults</button></div>', 'settings');
  bindModalButtons();
}

// ---------------- glossary ----------------
function portraitURL(breed, coat, size, opt) {
  try { if (typeof dogPortraitURL === 'function') return dogPortraitURL(breed, coat, size, opt || {}); } catch (e) {}
  return portraitCanvas(breed, coat, size).toDataURL();
}
function openDex() {
  UI.dexNew = 0;
  var seen = BREEDS.filter(function (b) { return S.dex[b.id]; });
  if (!UI.dexSel || !S.dex[UI.dexSel]) UI.dexSel = seen.length ? seen[0].id : null;
  openModal('', 'dex', 'dex'); renderDex(); sfx('page');
}
function renderDex() {
  var n = dexCount(), card = $('modal').querySelector('.card'), og = card.querySelector('.dex-grid'), gScroll = og ? og.scrollTop : 0;
  var seen = BREEDS.filter(function (b) { return S.dex[b.id]; }).sort(function (a, b) { return (S.dex[a.id].first - S.dex[b.id].first) || (a.index - b.index); });
  var grid = seen.map(function (b, i) {
    var e = S.dex[b.id] || {}, c0 = (Array.isArray(e.coats) && e.coats.length) ? e.coats[0] : 0;
    return '<div class="dex-cell' + (UI.dexSel === b.id ? ' on' : '') + '" data-breed="' + b.id + '"><span class="num">#' + (i < 9 ? '0' : '') + (i + 1) + '</span>' + (b.cross ? '<span class="x">🧬</span>' : '') +
      '<img src="' + portraitURL(b.id, c0, 80, { bg: 'badge' }) + '"><b>' + esc(b.name) + '</b></div>';
  }).join('');
  var det;
  if (!seen.length) det = '<h3>No dogs yet</h3><p style="text-align:center">Every breed you welcome at the counter is added here, with its portrait and facts.</p>';
  else {
    var b = BREED_BY_ID[UI.dexSel] || seen[0], e = S.dex[b.id] || { n: 1, first: 1, coats: [0], best: 0, names: [] };
    var coats = (Array.isArray(e.coats) && e.coats.length) ? e.coats : [0], names = Array.isArray(e.names) ? e.names : [];
    var cross = b.cross ? b.cross.map(function (p) { return BREED_BY_ID[p] ? BREED_BY_ID[p].name : p; }).join(' × ') : '';
    det = '<img class="big" src="' + portraitURL(b.id, coats[0], 160, { bg: 'card' }) + '"><h3>' + esc(b.name) + '</h3><div class="grp">' + esc(b.group) + (cross ? ' · ' + esc(cross) : '') + '</div>' +
      '<p>' + esc(b.blurb) + '</p>' +
      (coats.length > 1 ? '<div class="coats">' + coats.map(function (ci) { var co = (b.coats && (b.coats[ci] || b.coats[0])) || { name: '' }; return '<div><img src="' + portraitURL(b.id, ci, 56, { bg: 'badge' }) + '">' + esc(co.name) + '</div>'; }).join('') + '</div>' : '<p class="small" style="text-align:center">' + esc(((b.coats && (b.coats[coats[0]] || b.coats[0])) || { name: '' }).name) + '</p>') +
      '<div class="facts"><div><span>Height</span><b>' + b.cm + ' cm</b></div><div><span>Guests met</span><b>' + (e.n || 1) + '</b></div><div><span>First met</span><b>Day ' + (e.first || 1) + '</b></div><div><span>Best pickup</span><b>' + (e.best ? e.best + '%' : '—') + '</b></div></div>' +
      '<div class="tagrow">' + (b.likely || []).filter(function (t) { return !!TRAITS[t]; }).map(function (t) { return '<span>' + TRAITS[t].icon + ' often ' + TRAITS[t].label + '</span>'; }).join('') + '</div>' +
      '<p class="fact">💡 ' + esc(b.fact) + '</p>' + (names.length ? '<p class="small">Guests so far: ' + names.map(esc).join(', ') + '</p>' : '');
  }
  var found = specialsFound();
  var sp = '<div class="specials" style="grid-column:1/-1"><div class="sp-head">⭐ Special guests <small>' + found + ' of ' + SPECIALS.length + ' found</small></div>' + SPECIALS.map(function (s) {
    var got = S.specials && S.specials[s.id];
    return got ? '<div class="sp got"><img src="' + portraitURL(s.breed, Math.min(s.coat, BREED_BY_ID[s.breed].coats.length - 1), 56, { bg: 'badge' }) + '"><b>' + esc(s.name) + '</b><small>' + esc(s.title) + '</small><small class="dim">Day ' + got.day + '</small></div>'
      : '<div class="sp"><span class="q">?</span><b>???</b><small>' + esc(s.hint) + '</small></div>';
  }).join('') + '</div>';
  grid += sp;
  card.innerHTML = '<div class="dex-head"><h2>📖 Dog Breeds</h2><span class="prog">' + n + ' met</span><button data-act="back" class="primary">Close</button></div>' +
    '<div class="dex-body"><div class="dex-grid">' + (seen.length ? grid : '<div class="empty" style="grid-column:1/-1">Nobody yet — your first guest will appear here.</div>' + sp) + '</div><div class="dex-detail">' + det + '</div></div>';
  var ng = card.querySelector('.dex-grid'), on = card.querySelector('.dex-cell.on');
  ng.scrollTop = gScroll; if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest' });
  bindModalButtons();
}

// ---------------- summary / level up / toasts ----------------
function stars(r) { var out = ''; for (var i = 1; i <= 5; i++) out += r >= i - 0.5 ? '★' : '☆'; return '<span class="stars">' + out + '</span> <small>' + r.toFixed(1) + '</small>'; }
function showSummary() {
  var s = UI.summary, dr = s.repEnd - s.repStart;
  var rating = s.complaints === 0 && s.served >= 3 ? '🏆 Flawless day!' : s.complaints <= 1 ? '👍 Good day!' : '😬 Rough day…';
  openModal('<h2>🌙 Day ' + s.day + ' complete</h2><div class="rating">' + rating + '</div>' +
    '<div class="stats"><div><span>Dogs returned</span><b>' + s.served + '</b></div><div><span>Earned</span><b class="money">' + fmtMoney(s.earned) + '</b></div>' +
    '<div><span>Tips</span><b class="money">' + fmtMoney(s.tips) + '</b></div><div><span>PAWSOME pickups</span><b>' + s.perfect + '</b></div>' +
    '<div><span>Goal rewards</span><b class="money">' + fmtMoney(s.goalCash || 0) + '</b></div><div><span>Spent</span><b>' + fmtMoney(s.spent) + '</b></div>' +
    (s.wages ? '<div><span>Staff wages</span><b class="bad">−' + fmtMoney(s.wages) + '</b></div>' : '') +
    '<div><span>Complaints</span><b class="' + (s.complaints ? 'bad' : '') + '">' + s.complaints + '</b></div><div><span>Poop left</span><b class="' + (s.leftoverPoop >= 3 ? 'bad' : '') + '">' + (s.leftoverPoop || 0) + '</b></div>' +
    '<div style="grid-column:1/3"><span>Reputation</span><b>' + stars(s.repEnd) + ' <small class="' + (dr >= 0 ? 'good' : 'bad') + '">' + (dr >= 0 ? '+' : '') + dr.toFixed(2) + '</small></b></div></div>' +
    (s.goals && s.goals.length ? '<div class="goalsum">' + s.goals.map(function (g) { return '<div class="' + (g.done ? 'good' : '') + '">' + (g.done ? '✅' : '⬜') + ' ' + esc(g.text) + '</div>'; }).join('') + '</div>' : '') +
    (s.complaintList.length ? '<div class="complaints">' + s.complaintList.map(function (c) { return '<div>📝 ' + esc(c) + '</div>'; }).join('') + '</div>' : '') +
    (S.dogs.length ? '<p class="small">🌙 ' + S.dogs.length + ' overnight guest' + (S.dogs.length > 1 ? 's are' : ' is') + ' tucked into a kennel.</p>' : '') +
    '<div class="row"><button data-act="nextday" class="primary big">☀️ Start Day ' + S.day + '</button></div>', 'summary', 'sum');
  UI.rosterHTML = null; renderRoster();
  bindModalButtons();
}
function showLevelUp(lvl, unl) {
  var el = $('levelup');
  el.innerHTML = '<div class="lv">LEVEL UP!</div><div class="num">' + lvl + '</div>' + (unl.length ? '<div class="unl">Unlocked: ' + unl.map(esc).join(' · ') + '</div>' : '');
  el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  clearTimeout(UI.lvlT); UI.lvlT = setTimeout(function () { el.classList.remove('show'); }, 3500);
}
function showBanner(title, sub) {
  var el = $('banner'); el.innerHTML = '<b>' + esc(title) + '</b><span>' + esc(sub || '') + '</span>';
  el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
}
var WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
function dayBanner() { if ($('levelup').classList.contains('show')) { setTimeout(dayBanner, 1500); return; } showBanner('Day ' + S.day, WEEKDAYS[(S.day - 1) % 7] + ' · doors open at 8'); }

var toastQ = [];
function toast(text, kind) {
  if (UI.inTitle) return;
  toastQ.push({ text: text, kind: kind || '' });
  if (toastQ.length > 8) toastQ.shift();
  pumpToasts();
}
function pumpToasts() {
  var box = $('toasts'), max = 2;
  while (toastQ.length && box.children.length < max) {
    var q = toastQ.shift(), el = document.createElement('div'); el.className = 'toast ' + q.kind; el.textContent = q.text; box.appendChild(el);
    (function (el) {
      var life = toastQ.length > 1 ? 2000 : 3200;
      setTimeout(function () { el.classList.add('out'); }, life);
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); pumpToasts(); }, life + 380);
    })(el);
  }
}

// ---------------- build panel (iPhone Bottom Sheet) ----------------
var iconCache = {};
function objectIconURL(type) {
  if (iconCache[type]) return iconCache[type];
  var art = artOf(type); if (!art) return '';
  var def = CAT_BY_ID[type], size = 84, cv = document.createElement('canvas'); cv.width = size; cv.height = size;
  var c = cv.getContext('2d'), span = Math.max(def.w, def.h + (def.floor ? 0 : 0.9)) * TILE + 10, k = size / span;
  try {
    c.translate(size / 2 - def.w * TILE * k / 2, size - 5 - def.h * TILE * k); c.scale(k, k);
    art.draw(c, { type: type, x: 0, y: 0, w: def.w, h: def.h, id: 3, occupied: false, useT: 99, label: null }, 1.2, { night: 0, wind: 0 });
    if (art.drawFront) art.drawFront(c, { type: type, x: 0, y: 0, w: def.w, h: def.h, id: 3, occupied: false, useT: 99, label: null }, 1.2, { night: 0, wind: 0 });
    iconCache[type] = cv.toDataURL();
  } catch (e) { iconCache[type] = ''; }
  return iconCache[type];
}
function renderBuildPanel() {
  var tabs = [['care', 'Care'], ['fun', 'Fun'], ['decor', 'Decor'], ['land', 'Land'], ['biz', 'Research & Staff']];
  var h = '<div class="bp-head"><span>🔨 Shop &amp; Upgrade</span><button id="upgBtn" class="' + (UI.buildTool === 'upgrade' ? 'on' : '') + '">⬆️ Upgrade</button><button id="sellBtn" class="' + (UI.buildTool === 'sell' ? 'on' : '') + '">💸 Sell</button><button id="bpClose">Done</button></div>' +
    '<div class="tabs">' + tabs.map(function (t) { return '<button data-tab="' + t[0] + '" class="' + (UI.buildTab === t[0] ? 'on' : '') + '">' + t[1] + '</button>'; }).join('') + '</div><div class="items">';
  if (UI.buildTab === 'land') {
    PLOTS.forEach(function (p) {
      if (!p.cost) return;
      var owned = plotOwned(p), pend = plotPending(p), locked = S.level < p.lvl;
      var far = !owned && !pend && !plotAdjacent(p);
      h += '<div class="item' + (owned ? ' owned' : '') + (locked || far ? ' locked' : '') + (S.cash < p.cost && !owned && !locked ? ' poor' : '') + '" data-plot="' + p.id + '" style="grid-column:1/-1"><div class="ic">🗺️</div><div class="tx"><b>' + p.name + '</b><small>' + p.w + '×' + p.h + ' tiles · ⏱ ' + fmtDur(p.time) + (far && !locked ? ' · unlock neighbour first' : '') + '</small></div><div class="pr">' +
        (owned ? '✅' : pend ? '🚜 ' + fmtDur((pend.end - Date.now()) / 1000) : locked ? '🔒 Lv ' + p.lvl : fmtMoney(p.cost)) + '</div></div>';
    });
  } else if (UI.buildTab === 'biz') {
    h += '<div class="bp-sub">Endless Research Perks — upgradeable forever!</div>';
    UPGRADES.forEach(function (u) {
      var curLv = upLvl(u.id), reqLv = upgReqLvl(u), cost = upgCost(u);
      var locked = S.level < reqLv, poor = S.cash < cost;
      h += '<div class="item' + (locked ? ' locked' : '') + (poor && !locked ? ' poor' : '') + '" data-upg="' + u.id + '"><div class="ic">' + u.icon + '</div><div class="tx"><b>' + u.name + (curLv ? ' <span style="color:#8e6bd6">Lv' + curLv + '</span>' : '') + '</b><small>' + u.desc + '</small></div><div class="pr">' +
        (locked ? '🔒 Lv' + reqLv : '⬆️ ' + fmtMoney(cost)) + '</div></div>';
    });
    h += '<div class="bp-sub">Staff — paid per day at closing time</div>';
    STAFF.forEach(function (s) {
      var hired = staffHired(s.id), locked = S.level < s.lvl;
      h += '<div class="item' + (hired ? ' owned' : '') + (locked ? ' locked' : '') + '" data-staff="' + s.id + '" style="grid-column:1/-1"><div class="ic">' + s.icon + '</div><div class="tx"><b>' + s.name + '</b><small>' + s.desc + '</small></div><div class="pr">' +
        (hired ? '✅ Hired' : locked ? '🔒 Lv ' + s.lvl : fmtMoney(s.wage) + '/d') + '</div></div>';
    });
  } else {
    CATALOG.filter(function (c) { return c.cat === UI.buildTab; }).forEach(function (c) {
      var locked = S.level < c.lvl, poor = S.cash < c.cost, url = objectIconURL(c.id);
      h += '<div class="item' + (UI.buildSel === c.id ? ' sel' : '') + (locked ? ' locked' : '') + (poor && !locked ? ' poor' : '') + '" data-item="' + c.id + '">' +
        '<div class="ic">' + (url ? '<img src="' + url + '">' : c.icon) + '</div><div class="tx"><b>' + c.name + '</b><small>⏱ ' + fmtDur(c.time) + (c.charm >= 1 ? ' · 🌸+' + c.charm : '') + (c.cap ? ' · 🐕+' + c.cap : '') + '</small></div>' +
        '<div class="pr">' + (locked ? '🔒' + c.lvl : fmtMoney(c.cost)) + '</div></div>';
    });
  }
  h += '</div><div class="bp-tools"><span class="small" id="bpDesc"></span></div>';
  var scroll = $('buildpanel').querySelector('.items'), st = scroll ? scroll.scrollTop : 0;
  $('buildpanel').innerHTML = h;
  var ns = $('buildpanel').querySelector('.items'); if (ns) ns.scrollTop = st;
  bpShowDesc('');
  UI.bpSig = buildSig();
}
var BP_HELP = 'Tap a building in the yard to upgrade it (Lv 1 → Lv 2 → Lv 3…), or pick a new item below.';
function bpShowDesc(txt) {
  var el = $('bpDesc');
  if (el) el.textContent = txt || (UI.buildTool === 'sell' ? 'Sell mode: tap a building in the yard to sell it.' : UI.buildTool === 'upgrade' ? 'Upgrade mode: tap any building in the yard to level it up!' : UI.buildSel ? 'Tap any green tile in the yard to build ' + CAT_BY_ID[UI.buildSel].name + ' (⏱ ' + fmtDur(CAT_BY_ID[UI.buildSel].time) + ')' : BP_HELP);
}
(function () {
  var bp = $('buildpanel');
  bp.addEventListener('pointerdown', function (ev) {
    if (!ev.target.closest) return;
    var t = ev.target.closest('#bpClose,#sellBtn,#upgBtn,[data-tab],[data-item],[data-plot],[data-upg],[data-staff]'); if (!t) return;
    initAudio();
    if (t.id === 'bpClose') { setMode('play'); sfx('ui_close'); return; }
    if (t.id === 'sellBtn') { UI.buildTool = UI.buildTool === 'sell' ? null : 'sell'; UI.buildSel = null; renderBuildPanel(); sfx('click'); return; }
    if (t.id === 'upgBtn') { UI.buildTool = UI.buildTool === 'upgrade' ? null : 'upgrade'; UI.buildSel = null; renderBuildPanel(); sfx('click'); return; }
    if (t.hasAttribute('data-tab')) { UI.buildTab = t.getAttribute('data-tab'); UI.buildSel = null; sfx('click'); renderBuildPanel(); var it = bp.querySelector('.items'); if (it) it.scrollTop = 0; return; }
    if (t.hasAttribute('data-item')) {
      var id = t.getAttribute('data-item'), c = CAT_BY_ID[id];
      if (S.level < c.lvl) { toast('🔒 Reach level ' + c.lvl + ' to build a ' + c.name, 'bad'); sfx('error'); return; }
      UI.buildSel = UI.buildSel === id ? null : id; UI.buildTool = null; sfx('click'); renderBuildPanel(); return;
    }
    if (t.hasAttribute('data-staff')) {
      var sid = t.getAttribute('data-staff'), sd = STAFF_BY_ID[sid];
      if (staffHired(sid)) confirmBox('Let the <b>' + sd.name + '</b> go?', function () { toggleStaff(sid); renderBuildPanel(); });
      else if (S.level < sd.lvl) { toast('🔒 Reach level ' + sd.lvl + ' to hire a ' + sd.name, 'bad'); sfx('error'); }
      else confirmBox('Hire a <b>' + sd.name + '</b> for ' + fmtMoney(sd.wage) + ' a day?<br>' + sd.desc, function () { toggleStaff(sid); renderBuildPanel(); });
      return;
    }
    if (t.hasAttribute('data-plot')) { tryBuyPlot(PLOTS.filter(function (q) { return q.id === t.getAttribute('data-plot'); })[0]); return; }
    if (t.hasAttribute('data-upg')) {
      var u = UPG_BY_ID[t.getAttribute('data-upg')];
      var req = upgReqLvl(u), cost = upgCost(u), nextLv = upLvl(u.id) + 1;
      if (S.level < req) { toast('🔒 Reach Daycare Level ' + req + ' for ' + u.name + ' Lv ' + nextLv, 'bad'); sfx('error'); return; }
      if (S.cash < cost) { toast('Not enough cash for ' + u.name + ' Lv ' + nextLv + ' (' + fmtMoney(cost) + ')', 'bad'); sfx('error'); return; }
      confirmBox('Upgrade <b>' + u.name + '</b> to <b>Lv ' + nextLv + '</b> for ' + fmtMoney(cost) + '?<br>' + u.desc, function () { buyUpgrade(u); renderBuildPanel(); });
    }
  });
})();
function buildSig() {
  var pend = UI.buildTab === 'land' && S.plots.some(function (p) { return Date.now() < p.end + 1000; });
  return CATALOG.map(function (c) { return S.cash >= c.cost ? 1 : 0; }).join('') + PLOTS.map(function (p) { return S.cash >= p.cost ? 1 : 0; }).join('') + UPGRADES.map(function (u) { return upLvl(u.id) + ':' + (S.cash >= upgCost(u) ? 1 : 0); }).join(',') + '|' + S.level + '|' + S.plots.length + '|' + (pend ? Math.floor(Date.now() / 1000) : '');
}
function tryBuyPlot(p) {
  if (plotOwned(p) || plotPending(p)) return;
  if (S.level < p.lvl) { toast('🔒 Reach level ' + p.lvl + ' to buy ' + p.name, 'bad'); sfx('error'); return; }
  if (!plotAdjacent(p)) { toast(p.name + ' does not touch your land yet — unlock a neighbouring plot first', 'bad'); sfx('error'); return; }
  if (S.cash < p.cost) { toast('Not enough cash for ' + p.name + ' (' + fmtMoney(p.cost) + ')', 'bad'); sfx('error'); return; }
  confirmBox('Clear <b>' + p.name + '</b> for ' + fmtMoney(p.cost) + '?<br><small>⏱ Clearing takes ' + fmtDur(p.time) + ' in real time.</small>', function () { buyPlot(p); renderBuildPanel(); });
}
function promptRushSite(o) {
  var cost = rushCost(o), cName = CAT_BY_ID[o.type].name;
  var what = o.upgrading ? (cName + ' Lv ' + ((o.lvl || 1) + 1) + ' upgrade') : cName;
  if (S.cash < cost) { toast('Rushing costs ' + fmtMoney(cost) + ' — not enough cash', 'bad'); sfx('error'); return; }
  confirmBox('Finish the <b>' + what + '</b> right now for ' + fmtMoney(cost) + '?', function () {
    var c2 = rushCost(o);
    if (S.cash >= c2 && !o.done) {
      S.cash -= c2; S.stats.spent += c2; o.buildEnd = Date.now(); sfx('buy'); saveGame();
      if (typeof MP !== 'undefined') MP.recordAction('rush', { item: o.type, name: cName, icon: CAT_BY_ID[o.type].icon, cost: c2 });
    }
  });
}
function promptUpgradeObject(o) {
  var c = CAT_BY_ID[o.type], nextLv = (o.lvl || 1) + 1, req = objUpgradeReqLvl(o), cost = objUpgradeCost(o), dur = objUpgradeTime(o);
  if (S.level < req) { toast('🔒 Reach Daycare Level ' + req + ' to upgrade ' + c.name + ' to Lv ' + nextLv, 'bad'); sfx('error'); return; }
  if (S.cash < cost) { toast('Not enough cash to upgrade ' + c.name + ' to Lv ' + nextLv + ' (' + fmtMoney(cost) + ')', 'bad'); sfx('error'); return; }
  var perkTxt = c.cap ? ('+Capacity every 2 levels & +Charm') : c.charm ? ('+' + Math.round(c.charm * 0.6 * 10) / 10 + ' extra Charm') : '+Care bonus, speed & Charm';
  confirmBox('Upgrade <b>' + c.name + '</b> to <b>Lv ' + nextLv + '</b> for ' + fmtMoney(cost) + '?<br><small>⏱ Takes ' + fmtDur(dur) + ' · ' + perkTxt + '</small>', function () {
    upgradeObject(o); renderBuildPanel();
  });
}
function handleBuildTap(clientX, clientY) {
  if (UI.mode !== 'build' || !S) return;
  var mw = screenToWorld(clientX, clientY), tx = tileOf(mw.x), ty = tileOf(mw.y);
  var site = objAt(tx, ty);
  if (UI.buildSel && !(site && !site.done) && UI.buildTool !== 'upgrade' && UI.buildTool !== 'sell') {
    var def = CAT_BY_ID[UI.buildSel], x = tx - Math.floor((def.w - 1) / 2), y = ty - Math.floor((def.h - 1) / 2);
    if (S.cash < def.cost) { toast('Not enough cash for a ' + def.name, 'bad'); sfx('error'); return; }
    if (!canPlace(UI.buildSel, x, y)) { toast('Tap an open green tile in the yard', 'bad'); sfx('error'); return; }
    placeBuild(UI.buildSel, x, y);
    if (S.cash < def.cost) UI.buildSel = null;
    renderBuildPanel(); return;
  }
  var o = site;
  if (o && UI.buildTool === 'sell') {
    if (!canSell(o)) { toast(isLastEssential(o) ? 'You need at least one ' + CAT_BY_ID[o.type].name : 'A dog is using that right now', 'bad'); sfx('error'); return; }
    confirmBox('Sell the ' + CAT_BY_ID[o.type].name + ' (Lv ' + (o.lvl || 1) + ') for ' + fmtMoney(sellValue(o)) + '?', function () { sellObject(o); renderBuildPanel(); });
    return;
  }
  if (o && !o.done) {
    promptRushSite(o);
    return;
  }
  if (o && o.done) {
    promptUpgradeObject(o);
    return;
  }
  var p = plotAt(tx, ty);
  if (p && !plotOwned(p) && !plotPending(p)) tryBuyPlot(p);
}

// ---------------- iPhone Touch & My Mini Mart Dynamic Virtual Joystick ----------------
function _touchDist(a, b) { var dx = a.clientX - b.clientX, dy = a.clientY - b.clientY; return Math.sqrt(dx * dx + dy * dy); }

function _startPointerOrTouch(id, clientX, clientY) {
  initAudio();
  if (UI.mode === 'play') {
    UI.joy = { id: id, ox: clientX, oy: clientY, cx: clientX, cy: clientY, dx: 0, dy: 0, active: false, moved: false, t0: performance.now() };
  } else if (UI.mode === 'build') {
    UI.mouse.sx = clientX; UI.mouse.sy = clientY; UI.mouse.in = true;
    UI.touchBuild = { id: id, ox: clientX, oy: clientY, lx: clientX, ly: clientY, moved: false };
  }
}

function _movePointerOrTouch(id, clientX, clientY) {
  if (UI.mode === 'play' && UI.joy && UI.joy.id === id) {
    var dx = clientX - UI.joy.ox, dy = clientY - UI.joy.oy, d = Math.sqrt(dx * dx + dy * dy);
    if (d > 6) { UI.joy.active = true; UI.joy.moved = true; UI.touchTarget = null; }
    if (UI.joy.active) {
      var maxR = 44;
      // My Mini Mart dynamic origin following: if thumb drags past maxR, the base follows right behind the thumb!
      if (d > maxR) {
        UI.joy.ox = clientX - (dx / d) * maxR;
        UI.joy.oy = clientY - (dy / d) * maxR;
        dx = clientX - UI.joy.ox;
        dy = clientY - UI.joy.oy;
        d = maxR;
      }
      UI.joy.cx = clientX;
      UI.joy.cy = clientY;
      UI.joy.dx = dx / maxR;
      UI.joy.dy = dy / maxR;
    }
  } else if (UI.mode === 'build' && UI.touchBuild && UI.touchBuild.id === id) {
    UI.mouse.sx = clientX; UI.mouse.sy = clientY; UI.mouse.in = true;
    var bdx = clientX - UI.touchBuild.ox, bdy = clientY - UI.touchBuild.oy;
    if (Math.sqrt(bdx * bdx + bdy * bdy) > 10) UI.touchBuild.moved = true;
    if (UI.touchBuild.moved) {
      CAM.panX -= (clientX - UI.touchBuild.lx) / CAM.zoom;
      CAM.panY -= (clientY - UI.touchBuild.ly) / CAM.zoom;
    }
    UI.touchBuild.lx = clientX; UI.touchBuild.ly = clientY;
  }
}

function _endPointerOrTouch(id, clientX, clientY) {
  if (UI.joy && UI.joy.id === id) {
    if (!UI.joy.moved && performance.now() - UI.joy.t0 < 380 && S && UI.mode === 'play') {
      var mw = screenToWorld(clientX, clientY);
      var z = UI.zone;
      if (z && !z.disabled && (dist(mw.x, mw.y, S.player.x, S.player.y) < 48 || (z.rect && inRect(mw.x, mw.y, z.rect)))) {
        triggerZoneNow();
      } else {
        UI.touchTarget = { x: mw.x, y: mw.y, stuck: 0 };
      }
    }
    UI.joy = null;
  }
  if (UI.touchBuild && UI.touchBuild.id === id) {
    if (!UI.touchBuild.moved && UI.mode === 'build') {
      UI.mouse.sx = clientX; UI.mouse.sy = clientY; UI.mouse.in = true;
      handleBuildTap(clientX, clientY);
    }
    UI.touchBuild = null;
  }
}

canvas.addEventListener('touchstart', function (ev) {
  if (UI.mode !== 'play' && UI.mode !== 'build') return;
  ev.preventDefault();
  if (ev.touches.length >= 2) {
    UI.joy = null; UI.touchBuild = null;
    var t0 = ev.touches[0], t1 = ev.touches[1];
    UI.pinch = { d0: Math.max(10, _touchDist(t0, t1)), z0: settings.zoom || 1, mx: (t0.clientX + t1.clientX) / 2, my: (t0.clientY + t1.clientY) / 2 };
    return;
  }
  var t = ev.changedTouches[0];
  if (t) _startPointerOrTouch(t.identifier, t.clientX, t.clientY);
}, { passive: false });

canvas.addEventListener('touchmove', function (ev) {
  if (UI.mode !== 'play' && UI.mode !== 'build') return;
  ev.preventDefault();
  if (ev.touches.length >= 2 && UI.pinch) {
    var t0 = ev.touches[0], t1 = ev.touches[1], d = Math.max(10, _touchDist(t0, t1));
    settings.zoom = clamp(Math.round(UI.pinch.z0 * (d / UI.pinch.d0) * 10) / 10, 0.7, 1.4);
    var mx = (t0.clientX + t1.clientX) / 2, my = (t0.clientY + t1.clientY) / 2;
    if (UI.mode === 'build') { CAM.panX -= (mx - UI.pinch.mx) / CAM.zoom; CAM.panY -= (my - UI.pinch.my) / CAM.zoom; }
    UI.pinch.mx = mx; UI.pinch.my = my;
    clearTimeout(UI.zoomSave); UI.zoomSave = setTimeout(saveSettings, 600);
    return;
  }
  for (var i = 0; i < ev.touches.length; i++) {
    var t = ev.touches[i];
    _movePointerOrTouch(t.identifier, t.clientX, t.clientY);
  }
}, { passive: false });

function _onTouchEnd(ev) {
  if (ev.touches.length < 2) UI.pinch = null;
  for (var i = 0; i < ev.changedTouches.length; i++) {
    var t = ev.changedTouches[i];
    _endPointerOrTouch(t.identifier, t.clientX, t.clientY);
  }
}
canvas.addEventListener('touchend', _onTouchEnd, { passive: false });
canvas.addEventListener('touchcancel', _onTouchEnd, { passive: false });

// Also support pointer touch/drag seamlessly in iOS WKWebView / simulator
canvas.addEventListener('pointerdown', function (ev) {
  if (ev.pointerType === 'touch') return;
  if (UI.mode !== 'play' && UI.mode !== 'build') return;
  _startPointerOrTouch('ptr', ev.clientX, ev.clientY);
});
window.addEventListener('pointermove', function (ev) {
  if (ev.pointerType === 'touch') return;
  _movePointerOrTouch('ptr', ev.clientX, ev.clientY);
});
window.addEventListener('pointerup', function (ev) {
  if (ev.pointerType === 'touch') return;
  _endPointerOrTouch('ptr', ev.clientX, ev.clientY);
});

// ---------------- HUD ----------------
var domCache = {};
function setText(id, v) { if (domCache[id] !== v) { domCache[id] = v; var el = $(id); if (el) el.textContent = v; } }
function setStyle(id, prop, v) { var k = id + '.' + prop; if (domCache[k] !== v) { domCache[k] = v; var el = $(id); if (el) el.style[prop] = v; } }
function updateHUD(dt) {
  UI.cashShown += (S.cash - UI.cashShown) * Math.min(1, dt * 8);
  if (Math.abs(S.cash - UI.cashShown) < 1) UI.cashShown = S.cash;
  setText('cash', fmtMoney(Math.round(UI.cashShown)));
  UI.cashPulse = Math.max(0, UI.cashPulse - dt);
  setStyle('cashbox', 'transform', UI.cashPulse > 0 ? 'scale(' + (1 + Math.round(UI.cashPulse * 10) / 20) + ')' : '');
  if (!UI.cashRect || now - (UI.cashRectT || 0) > 1 || now < (UI.cashRectT || 0)) { UI.cashRect = $('cashbox').getBoundingClientRect(); UI.cashRectT = now; }
  UI.cashWorld = screenToWorld(UI.cashRect.left + 18, UI.cashRect.top + UI.cashRect.height / 2);
  var rep = stars(S.rep); if (UI.repHTML !== rep) { UI.repHTML = rep; $('rep').innerHTML = rep; }
  setText('lvl', S.level);
  setStyle('xpbar', 'width', Math.round(S.xp / lvlNeed(S.level) * 50) * 2 + '%');
  var D = dayLen(), f = S.dayTime / D, mins = 8 * 60 + Math.floor(f * 600 / 10) * 10, hh = Math.floor(mins / 60), mm = mins % 60;
  setText('dayname', 'Day ' + S.day + (S.closing ? ' · closing' : ''));
  setText('clock', ((hh - 1) % 12 + 1) + ':' + (mm < 10 ? '0' : '') + mm + (hh < 12 ? ' AM' : ' PM'));
  var fq = Math.round(f * 60) / 60, ang = Math.PI * (1 - fq);
  setStyle('daybar', 'width', (fq * 100).toFixed(1) + '%');
  setStyle('sun', 'transform', 'translate(' + Math.round(11 + Math.cos(ang) * 7) + 'px,' + Math.round(12 - Math.sin(ang) * 7) + 'px)');
  setText('cap', activeDogCount() + '/' + capacity());
  setText('charm', charm());
  setText('streak', S.streak > 1 ? '🔥x' + S.streak : '');
  var badge = $('dexBadge'), bh = !UI.dexNew; if (badge.hidden !== bh) badge.hidden = bh; if (UI.dexNew) setText('dexBadge', UI.dexNew);
  // Contextual hint pill above bottom dock
  var z = UI.zone, hh2 = '';
  if (UI.mode === 'play') {
    if (z) hh2 += '<span data-hact="interact" class="' + (z.disabled ? 'dim' : '') + '">' + (z.disabled ? '' : '⚡ ') + esc(z.label) + '</span>';
    else if (!S.tutorialDone && !S.tutorial.checkin) hh2 = '<span class="dim">Drag anywhere to walk to the SERVE pad</span>';
  }
  if (UI.hintHTML !== hh2) { UI.hintHTML = hh2; $('hint').innerHTML = hh2; }
  // Floating Drop button when carrying items or a dog
  var tDrop = $('touchDropBtn');
  if (tDrop) {
    var qa2 = UI.mode === 'play' && S.player.carry ? qAction() : null;
    var canDrop = !!(qa2 && !qa2.disabled);
    if (tDrop.hidden !== !canDrop) tDrop.hidden = !canDrop;
    if (canDrop) setText('touchDropBtn', '🐾 ' + qa2.label);
  }
  UI.hudT = (UI.hudT || 0) + dt;
  if (UI.hudT - UI.lastRoster > 0.45 || UI.hudT < UI.lastRoster) { UI.lastRoster = UI.hudT; renderTasks(); renderRoster(); if (UI.mode === 'build' && UI.bpSig !== buildSig()) renderBuildPanel(); }
}

function renderTasks() {
  var h;
  if (!S.tutorialDone) {
    var doneN = TUTORIAL.filter(function (t) { return S.tutorial[t.id]; }).length, nextTask = TUTORIAL.filter(function (t) { return !S.tutorial[t.id]; })[0];
    var sub = UI.tasksOpen ? (doneN + '/' + TUTORIAL.length) : (nextTask ? nextTask.text : (doneN + '/' + TUTORIAL.length));
    h = '<div class="ph" id="tasksHead"><span>🎓</span><span class="ph-sub">' + esc(sub) + '</span><span class="chev">' + (UI.tasksOpen ? '▲' : '▼') + '</span></div>';
    if (UI.tasksOpen) {
      var nextSeen = false;
      h += TUTORIAL.map(function (t) {
        var d = S.tutorial[t.id], nx = !d && !nextSeen; if (nx) nextSeen = true;
        return '<div class="task' + (d ? ' done' : nx ? ' next' : '') + '"><span class="box">' + (d ? '✓' : '') + '</span><span>' + esc(t.text) + '</span></div>';
      }).join('');
    }
  } else {
    var dn = S.goals.filter(function (g) { return g.done; }).length;
    var nextGoal = S.goals.filter(function (g) { return !g.done; })[0];
    var gsub = UI.tasksOpen ? (dn + '/' + S.goals.length) : (nextGoal ? goalText(nextGoal) : 'All goals done!');
    h = '<div class="ph" id="tasksHead"><span>🎯</span><span class="ph-sub">' + esc(gsub) + '</span><span class="chev">' + (UI.tasksOpen ? '▲' : '▼') + '</span></div>';
    if (UI.tasksOpen) h += S.goals.map(function (g) { var p = goalProgress(g); return '<div class="goal' + (g.done ? ' done' : '') + '"><div class="gt"><span>' + (g.done ? '✅ ' : '') + esc(goalText(g)) + '</span><b>' + (g.done ? 'Done!' : '+' + fmtMoney(g.reward)) + '</b></div><div class="gb"><div style="width:' + (p / g.n * 100) + '%"></div></div></div>'; }).join('');
  }
  if (UI.tasksHTML !== h) {
    UI.tasksHTML = h; $('tasks').innerHTML = h;
    $('tasksHead').onclick = function () { UI.tasksOpen = !UI.tasksOpen; if (UI.tasksOpen) UI.rosterOpen = false; sfx('click'); renderTasks(); renderRoster(); };
  }
}
function moodBar(v) { var col = v > 70 ? '#6fbf5a' : v > 40 ? '#f2c14e' : '#d9574a'; return '<div class="mood"><u><s style="width:' + Math.round(v / 4) * 4 + '%;background:' + col + '"></s></u></div>'; }
function renderRoster() {
  var dogs = S.dogs.filter(function (d) { return d.checkedIn && d.state !== 'leaving'; });
  var waiting = S.owners.filter(function (o) { return o.state === 'waitCheckin' || (o.state === 'walkIn' && o.kind === 'dropoff'); }).length;
  var needy = dogs.filter(function (d) { return d.need && !d.need.self; }).length;
  var pickupN = dogs.filter(function (d) { return d.called && S.owners.some(function (o) { return o.dogId === d.id && o.state === 'waitPickup'; }); }).length;
  var badges = (pickupN ? ' 🏠' + pickupN : '') + (needy ? ' 🙋' + needy : '') + (waiting ? ' 🔔' + waiting : '');
  var h = '<div class="ph" id="rosterHead"><span>🐕 Pups</span><span class="ph-sub">' + activeDogCount() + '/' + capacity() + badges + '</span><span class="chev">' + (UI.rosterOpen ? '▲' : '▼') + '</span></div>';
  if (UI.rosterOpen) {
    if (!dogs.length) h += '<div class="empty">No pups yet — welcome customers at the counter!</div>';
    function rank(d) { var w = d.called && S.owners.some(function (o) { return o.dogId === d.id && o.state === 'waitPickup'; }); return w ? 0 : d.need && !d.need.self ? 1 : 2; }
    dogs.sort(function (a, b) { return rank(a) - rank(b) || a.happy - b.happy; });
    dogs.forEach(function (d) {
      var hp = d.happy, wanted = rank(d) === 0, need = d.need && !d.need.self ? d.need : null;
      var ico = wanted ? '🏠' : need ? NEED_INFO[need.type].icon : d.state === 'kennel' || d.state === 'nap' ? '💤' : d.state === 'bath' ? '🛁' : d.state === 'leashed' ? '🦮' : d.overnight && d.pickupDay > S.day ? '🌙' : '🐾';
      var cls = 'dog c' + (wanted ? ' wanted' : '') + (need && need.t > NEED_GRACE ? ' sad' : need ? ' asks' : '');
      var pct = '<span class="hp" style="color:' + (hp > 70 ? '#3f7d3a' : hp > 40 ? '#b87514' : '#c2483c') + '">' + Math.round(hp / 2) * 2 + '%</span>';
      h += '<div class="' + cls + '" data-dog="' + d.id + '"><img src="' + dogPortraitSrc(d, 44) + '"><b>' + esc(d.name) + '</b><span class="ico">' + ico + '</span>' + moodBar(hp) + pct + '</div>';
    });
  }
  var el = $('roster');
  if (UI.rosterHTML !== h) {
    UI.rosterHTML = h; var sc = el.scrollTop; el.innerHTML = h; el.scrollTop = sc;
    $('rosterHead').onclick = function () { UI.rosterOpen = !UI.rosterOpen; if (UI.rosterOpen) UI.tasksOpen = false; sfx('click'); renderRoster(); renderTasks(); };
    el.querySelectorAll('[data-dog]').forEach(function (c) {
      c.onclick = function () {
        var d = dogById(+c.getAttribute('data-dog'));
        if (d) {
          UI.rosterOpen = false; renderRoster();
          UI.camFocus = { id: d.id, t: 1.8 };
          UI.touchTarget = { x: d.x, y: d.y, stuck: 0 };
          float(d.x, d.y - 80, '▼ ' + d.name, '#ffe082', 1.2);
          burst(d.x, d.y - 30, 'star', 6); sfx('click');
        }
      };
    });
  }
}

// ---------------- main loop ----------------
var lastT = performance.now(), saveT = 0, DEMO = null;
function makeDemo() {
  var keep = S; newState(); DEMO = S;
  DEMO.plots.push({ id: 'north', end: 0, announced: true }, { id: 'east', end: 0, announced: true });
  [['kennel', 19, 26], ['kennel', 19, 29], ['playzone', 24, 25], ['pool', 33, 20], ['agility', 34, 26], ['fountain', 26, 12], ['tree', 21, 9], ['tree', 29, 8], ['tree', 40, 23], ['lamp', 23, 22], ['lamp', 31, 24], ['bench', 27, 15], ['pond', 20, 13], ['gazebo', 36, 29], ['sandpit', 29, 21], ['topiary', 28, 29], ['statue', 25, 20], ['picnic', 22, 15], ['birdbath', 30, 13], ['napmat', 26, 30], ['flowers', 23, 9], ['flowers', 24, 9], ['flowers', 25, 9], ['bush', 18, 18], ['hydrant', 31, 27], ['treatjar', 25, 18], ['waterbowl', 29, 18]]
    .forEach(function (a) { try { if (CAT_BY_ID[a[0]]) addObject(a[0], a[1], a[2], true); } catch (e) {} });
  for (var i = 0; i < 12; i++) { var d = makeDog(); d.checkedIn = true; d.pickupDay = 999; var t = nearestWalkable((20 + Math.random() * 22) * TILE, (9 + Math.random() * 20) * TILE); d.x = (t[0] + .5) * TILE; d.y = (t[1] + .5) * TILE; d.state = 'idle'; d.idleT = Math.random() * 2; d.needs = { hunger: 90, clean: 90, love: 90, fun: 80 }; d.poopT = 1e9; DEMO.dogs.push(d); }
  DEMO.dayTime = dayLen() * 0.3; DEMO.player.x = 8.5 * TILE; DEMO.player.y = 25.3 * TILE;
  S = keep; markDirty(true);
}
function frame(ts) {
  var dt = clamp((ts - lastT) / 1000, 0.001, 0.05); lastT = ts;
  try {
    if (S) {
      var active = UI.mode === 'play' || UI.mode === 'build';
      if (active) update(dt);
      else updateFX(dt * 0.5);
      // Portrait iPhone camera centered horizontally on the player!
      var P = S.player, v = DIRV[P.dir] || [0, 0];
      var tx = P.x + (P.moving ? v[0] * 32 : 0);
      var ty = P.y - 16 + (P.moving ? v[1] * 32 : 0), zm = 1;
      if (UI.camFocus) { UI.camFocus.t -= dt; var fd = dogById(UI.camFocus.id); if (fd && UI.camFocus.t > 0 && !P.moving) { tx = fd.x; ty = fd.y - 20; } else UI.camFocus = null; }
      if (UI.camFocusPeer && typeof MP !== 'undefined') { UI.camFocusPeer.t -= dt; var fp = MP.getPeer(UI.camFocusPeer.id); if (fp && fp.online && UI.camFocusPeer.t > 0 && !P.moving) { tx = fp.x; ty = fp.y - 24; } else UI.camFocusPeer = null; }
      var building = UI.mode === 'build' || (UI.mode === 'confirm' && UI.prevMode === 'build');
      if (building) {
        if (P.moving) { CAM.panX *= 0.9; CAM.panY *= 0.9; }
        CAM.panX = clamp(CAM.panX, -W * TILE, W * TILE); CAM.panY = clamp(CAM.panY, -H * TILE, H * TILE);
        tx += CAM.panX; ty += CAM.panY + 70 / CAM.zoom;
        var hw = VIEW.w / 2 / CAM.zoom, hh = VIEW.h / 2 / CAM.zoom;
        CAM.panX += clamp(tx, hw, Math.max(hw, W * TILE - hw)) - tx; CAM.panY += clamp(ty, hh, Math.max(hh, H * TILE - hh)) - ty;
      }
      UI.bakeAll = !CAM.ready; updateCamera(dt, tx, ty, zm, !CAM.ready); CAM.ready = true;
      render(dt); updateHUD(dt);
      saveT += dt; if (saveT > 3) { saveT = 0; saveGame(); }
      UI.sceneT -= dt; if (UI.sceneT <= 0) { UI.sceneT = 0.5; setScene(UI.mode === 'summary' ? 'summary' : UI.mode === 'build' ? 'build' : 'play'); }
    } else {
      if (!DEMO) makeDemo();
      S = DEMO; now += dt; UI.titleT += dt;
      DEMO.dogs.forEach(function (d) { updateDog(d, dt); }); DEMO.poops = []; updateFX(dt);
      var a = UI.titleT * 0.05;
      UI.bakeAll = !CAM.ready; updateCamera(dt, (25 + Math.cos(a) * 6) * TILE, (21 + Math.sin(a * 1.3) * 6) * TILE, 1, !CAM.ready); CAM.ready = true;
      UI.zone = null; render(dt);
      if (!UI.firstFrame) {
        var left = 0; try { if (typeof worldArtPrewarm === 'function') left = worldArtPrewarm(CAMM.a, 24); } catch (e) {}
        try { if (typeof prewarmPerson === 'function' && typeof PLAYER_LOOKS !== 'undefined') prewarmPerson(PLAYER_LOOKS[UI.pickLook || 0], CAMM.a, 6); } catch (e) {}
        if (!(left > 0) || UI.titleT > 3.2) { UI.firstFrame = true; setTimeout(function () { $('splash').classList.add('gone'); setTimeout(function () { $('splash').style.display = 'none'; }, 800); }, 120); }
      }
      UI.sceneT -= dt; if (UI.sceneT <= 0) { UI.sceneT = 0.5; setScene('title'); }
      S = null;
    }
  } catch (err) { if (!frame.err) { frame.err = 1; console.error('frame error', err); } if (UI.inTitle) S = null; }
  requestAnimationFrame(frame);
}
function setScene(mode) {
  if (typeof Music === 'undefined' || !Music.setScene) return;
  try { Music.setScene({ mode: mode, dayFrac: S ? dayFrac() : 0.3, indoors: mode === 'title' ? false : playerIndoors(), tension: mode === 'play' ? tension() : 0 }); } catch (e) {}
}
window.addEventListener('beforeunload', saveGame);
document.addEventListener('visibilitychange', function () {
  if (document.hidden) { saveGame(); try { if (typeof AC !== 'undefined' && AC && AC.suspend) AC.suspend(); } catch (e) {} }
  else { try { if (typeof AC !== 'undefined' && AC) audioInit(); } catch (e) {} }
});
$('buildBtn').onclick = function () { initAudio(); if (UI.mode === 'play' || UI.mode === 'build') { setMode(UI.mode === 'build' ? 'play' : 'build'); sfx('ui_open'); } this.blur(); };
$('pauseBtn').onclick = function () { initAudio(); if (UI.mode === 'play' || UI.mode === 'build') openPause(); this.blur(); };
$('dexBtn').onclick = function () { initAudio(); if (UI.mode === 'play' || UI.mode === 'build') openDex(); this.blur(); };
if ($('coopBtn')) $('coopBtn').onclick = function () { initAudio(); if (typeof MP !== 'undefined' && (UI.mode === 'play' || UI.mode === 'build')) MP.openCoopModal(); this.blur(); };
if ($('coopHudPill')) $('coopHudPill').onclick = function () { initAudio(); if (typeof MP !== 'undefined' && (UI.mode === 'play' || UI.mode === 'build')) MP.openCoopModal(); };
if ($('touchDropBtn')) $('touchDropBtn').onclick = function () { initAudio(); if (UI.mode === 'play') { var qa = qAction(); if (qa && !qa.disabled) qa.run(); } };
$('hint').addEventListener('pointerdown', function (ev) {
  var sp = ev.target && ev.target.closest ? ev.target.closest('[data-hact]') : null;
  if (!sp || !S) return;
  initAudio();
  var act = sp.getAttribute('data-hact');
  if (act === 'interact' && UI.mode === 'play') triggerZoneNow();
  else if (act === 'grab' && UI.mode === 'play') { var qa = qAction(); if (qa && !qa.disabled) qa.run(); }
  else if (act === 'build' && UI.mode === 'build') { setMode('play'); sfx('ui_close'); }
});
document.addEventListener('pointerdown', function () { initAudio(); }, true);
document.addEventListener('touchstart', function () { initAudio(); }, { passive: true, capture: true });
document.addEventListener('touchend', function () { initAudio(); }, { passive: true, capture: true });

resizeView();
(function boot() {
  var started = false;
  function go() {
    if (started) return; started = true;
    var sc = baseZoom() * VIEW.dpr; CAM.zoom = baseZoom();
    try { if (typeof shopArtPrewarm === 'function') shopArtPrewarm(sc); } catch (e) {}
    try { if (typeof warmObjectArt === 'function') warmObjectArt(sc); } catch (e) {}
    if (typeof hasActiveSession === 'function' && hasActiveSession()) {
      enterPlayFromState(false);
      setTimeout(function () { $('splash').classList.add('gone'); setTimeout(function () { $('splash').style.display = 'none'; }, 800); }, 250);
    } else {
      openTitle();
    }
    requestAnimationFrame(frame);
  }
  try { Promise.all([document.fonts.load('20px "Jersey 25"'), document.fonts.load('700 14px Nunito'), document.fonts.load('800 14px Nunito')]).then(go, go); } catch (e) { go(); }
  setTimeout(go, 2500);
})();
