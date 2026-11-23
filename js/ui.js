'use strict';
var UI = { mode: 'title', prevMode: 'play', actions: null, mouse: { sx: 0, sy: 0, in: false }, buildSel: null, buildTool: null, buildTab: 'care',
  summary: null, cashShown: 0, cashPulse: 0, rebinding: null, lastRoster: 0, modalStack: [], dexSel: null, dexNew: 0, tasksOpen: true, rosterOpen: true,
  camFocus: null, sceneT: 0, miniT: 0, miniDirty: true, cashWorld: null, titleT: 0, joy: null, touchTarget: null, pinch: null, touchBuild: null };
var $ = function (id) { return document.getElementById(id); };
var held = {};

// ---------------- keys ----------------
function keyName(code) {
  if (!code) return '—';
  var map = { Space: 'Space', Escape: 'Esc', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', ShiftLeft: 'L-Shift', ShiftRight: 'R-Shift',
    ControlLeft: 'L-Ctrl', ControlRight: 'R-Ctrl', AltLeft: 'L-Alt', AltRight: 'R-Alt', Enter: 'Enter', Tab: 'Tab', Backspace: 'Backspace', Slash: '/', Period: '.', Comma: ',', Semicolon: ';', Quote: "'" };
  if (map[code]) return map[code];
  if (code.indexOf('Key') === 0) return code.slice(3);
  if (code.indexOf('Digit') === 0) return code.slice(5);
  if (code.indexOf('Numpad') === 0) return 'Num ' + code.slice(6);
  return code;
}
function keyDown(action) { var ks = settings.keys[action] || []; for (var i = 0; i < ks.length; i++) if (ks[i] && held[ks[i]]) return true; return false; }
function actionFor(code) { for (var a in settings.keys) if (settings.keys[a].indexOf(code) >= 0) return a; return null; }
function primaryKey(a) { var ks = settings.keys[a] || []; return keyName(ks[0] || ks[1]); }
function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

window.addEventListener('keydown', function (ev) {
  initAudio();
  if (UI.rebinding) { ev.preventDefault(); finishRebind(ev.code); return; }
  if (ev.target && (ev.target.tagName === 'SELECT' || ev.target.tagName === 'INPUT')) return;
  var a = actionFor(ev.code);
  if (a) ev.preventDefault();
  held[ev.code] = true;
  if (ev.repeat) return;
  if (ev.code === 'KeyC' && typeof MP !== 'undefined') {
    if (UI.mode === 'play' || UI.mode === 'build') { MP.openCoopModal(); return; }
    if (UI.mode === 'coop') { closeModal(); return; }
  }
  if (!a) return;
  if (a === 'pause') {
    if (UI.mode === 'build') { if (UI.buildSel || UI.buildTool) { UI.buildSel = null; UI.buildTool = null; renderBuildPanel(); } else setMode('play'); }
    else if (UI.mode === 'play') openPause();
    else if (UI.mode === 'paused' || UI.mode === 'settings' || UI.mode === 'help' || UI.mode === 'confirm' || UI.mode === 'dex' || UI.mode === 'note' || UI.mode === 'coop') closeModal();
    return;
  }
  if (a === 'dex') { if (UI.mode === 'play' || UI.mode === 'build') openDex(); else if (UI.mode === 'dex') closeModal(); return; }
  if (UI.mode !== 'play' && UI.mode !== 'build') return;
  if (a === 'build') { setMode(UI.mode === 'build' ? 'play' : 'build'); sfx(UI.mode === 'build' ? 'ui_open' : 'ui_close'); return; }
  if (a === 'interact' && UI.mode === 'play') triggerZoneNow();
  if (a === 'grab' && UI.mode === 'play') {
    var act = qAction();
    if (act && !act.disabled) act.run();
    else if (act && act.disabled) { float(S.player.x, S.player.y - 92, act.label, '#ffcdd2'); sfx('error'); }
  }
});
window.addEventListener('keyup', function (ev) { held[ev.code] = false; });
window.addEventListener('blur', function () { held = {}; if (UI.mode === 'play' || UI.mode === 'build') openPause(); });

function initAudio() { audioInit(); if (!UI.volApplied && typeof AC !== 'undefined' && AC) { UI.volApplied = true; applyVolumes(); } }

// ---------------- modes ----------------
function setMode(m) {
  UI.mode = m;
  document.body.classList.toggle('building', m === 'build');
  document.body.classList.toggle('title', !!UI.inTitle);
  if (m !== 'build') { UI.buildSel = null; UI.buildTool = null; CAM.panX = 0; CAM.panY = 0; }
  if (m !== 'play') { UI.joy = null; UI.touchTarget = null; }
  $('buildpanel').hidden = m !== 'build';
  $('roster').hidden = m === 'build'; $('tasks').hidden = m === 'build';
  if (m === 'build') renderBuildPanel();
  $('buildBtn').classList.toggle('on', m === 'build');
}
function openModal(html, mode, cls) {
  if (UI.mode === 'play' || UI.mode === 'build') UI.prevMode = UI.mode;
  if (UI.mode === 'paused' || UI.mode === 'title' || UI.mode === 'summary') UI.modalStack.push({ mode: UI.mode, html: $('modal').innerHTML });
  $('modal').innerHTML = '<div class="card ' + (cls || '') + '">' + html + '</div>';
  $('modalwrap').hidden = false; UI.mode = mode;
  held = {}; sfx('ui_open');
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
  m.querySelectorAll('[data-bind]').forEach(function (b) { b.onclick = function () { startRebind(b.getAttribute('data-bind'), +b.getAttribute('data-slot'), b); }; });
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
function fadeThen(fn) { var f = $('fade'); f.style.display = 'block'; void f.offsetWidth; f.classList.add('on'); setTimeout(function () { fn(); setTimeout(function () { f.classList.remove('on'); setTimeout(function () { if (!f.classList.contains('on')) f.style.display = 'none'; }, 700); }, 160); }, 480); }
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
  CAM.ready = false; sfx('day_start'); setTimeout(dayBanner, 700);
  var gift = dailyGift();
  if (gift) setTimeout(function () { if (UI.mode === 'play' || UI.mode === 'build') showGift(gift); }, 3200);
  if (S.migrated) { var r = S.migrated.refund; delete S.migrated; saveGame(); openModal('<h2>Welcome back!</h2><p>Paws &amp; Play has moved into a bigger, prettier home. Your level, reputation and cash came along' + (r ? ', and everything you had built was refunded: <b class="good">+' + fmtMoney(r) + '</b>' : '') + '. The yard is a fresh start — time to decorate!</p><div class="row"><button data-act="back" class="primary">Let\'s go</button></div>', 'note'); bindModalButtons(); }
  else if (S.totalServed === 0 && !S.tutorial.checkin) toast('🐶 Welcome to Paws & Play! Your first customer is on the way — stand in the SERVE box behind the counter.', 'good');
  saveGame();
}
function startGame(fresh) {
  var tName = $('titleNameInput'), tRoom = $('titleRoomInput');
  if (typeof MP !== 'undefined' && (tName || tRoom)) {
    MP.setProfile(tName ? tName.value : undefined, UI.pickLook, tRoom ? tRoom.value : undefined);
  }
  fadeThen(function () { enterPlayFromState(fresh); });
}
// a little cash gift the first time you open the daycare each real day; coming back day after day makes it grow
function dailyGift() {
  var today = new Date(), key = today.getFullYear() + '-' + (today.getMonth() + 1) + '-' + today.getDate();
  if (S.lastPlayDate === key) return null;
  var y = new Date(today.getTime() - 864e5), ykey = y.getFullYear() + '-' + (y.getMonth() + 1) + '-' + y.getDate();
  S.giftStreak = S.lastPlayDate === ykey ? (S.giftStreak || 0) + 1 : 1;
  S.lastPlayDate = key; S.playDays = (S.playDays || 0) + 1;
  var amount = 80 + 40 * Math.min(S.giftStreak, 7);
  S.cash += amount; saveGame();
  return { amount: amount, streak: S.giftStreak, days: S.playDays };
}
function showGift(g) {
  if (UI.inTitle || !S) return;
  var next = g.streak < 7 ? 'Come back tomorrow for ' + fmtMoney(80 + 40 * Math.min(g.streak + 1, 7)) + '.' : 'You are at the top gift — keep the streak going!';
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
  defaults: function () { var od = dayLen(); settings = defaultSettings(); if (S && dayLen() !== od) S.dayTime *= dayLen() / od; saveSettings(); refreshKeyHints(); closeModal(); openSettings(); },
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
  var chars = looks.length ? '<p class="small" style="margin-bottom:0">Choose your keeper &amp; co-op room</p><div class="chars">' + looks.map(function (l, i) { return '<div class="ch' + (i === UI.pickLook ? ' on' : '') + '" data-look="' + i + '"><img src="' + lookPortrait(i, 64) + '"><small>' + esc(l.name || ('Keeper ' + (i + 1))) + '</small></div>'; }).join('') + '</div>' : '';
  var mpBar = '<div class="title-mp-bar">' +
    '<label>Name <input type="text" id="titleNameInput" maxlength="18" value="' + esc(pName) + '"></label>' +
    '<label>Room <input type="text" id="titleRoomInput" maxlength="8" value="' + esc(rCode) + '" style="width:74px;text-transform:uppercase;text-align:center"></label>' +
    '</div>';
  $('modal').innerHTML = '<div class="card title"><div class="logo">Paws &amp; Play<span>DOGGY DAYCARE</span></div>' +
    '<p class="tag">Welcome pups at the counter, keep every tail wagging,<br>and grow the cosiest daycare in town — solo or with a friend!</p>' + chars + mpBar +
    '<div class="row col"><button data-act="play" class="primary big">' + (has ? '▶ Continue Daycare' : '▶ Play Daycare') + '</button>' +
    '<button data-act="coop">📱 Connect Another Phone (Co-op)</button>' +
    (has ? '<button data-act="newgame" class="flat">New game</button>' : '') +
    '<div class="row" style="margin-top:0"><button data-act="help" class="flat">How to play</button><button data-act="settings" class="flat">Settings &amp; controls</button></div></div>' +
    '<p class="small">Move ' + primaryKey('up') + primaryKey('left') + primaryKey('down') + primaryKey('right') + ' or touch &amp; drag · stand in a box to do things · Build ' + primaryKey('build') + ' · Co-op C</p></div>';
  $('modalwrap').hidden = false; bindModalButtons();
}
function openPause() {
  saveGame();
  openModal('<h2>Paused</h2><div class="row col"><button data-act="resume" class="primary big">Resume</button><button data-act="coop">📱 Multiplayer Co-op &amp; QR Code</button><button data-act="partnersummary">📋 What Partner Did</button><button data-act="dex">📖 Dog glossary</button><button data-act="help">How to play</button><button data-act="settings">Settings &amp; controls</button><button data-act="totitle" class="flat">Save &amp; quit to title</button></div>' +
    '<p class="small">Buildings keep building in real time, even while paused or closed. Your game saves automatically.</p>', 'paused', 'narrow');
  bindModalButtons();
}
function openHelp() {
  var I = primaryKey('interact'), G = primaryKey('grab');
  openModal('<h2>How to play</h2><div class="help">' +
    '<p><b>Move</b> with ' + primaryKey('up') + primaryKey('left') + primaryKey('down') + primaryKey('right') + '. There are no buttons to press: <b>stand in a box</b> for a moment and the action happens — a little ring above your head fills up. (Impatient? ' + I + ' does it at once. ' + G + ' lets go of a dog or drops what you hold.) Mouse wheel zooms.</p>' +
    '<p>🔔 <b>Drop-off:</b> owners come in from the street and ring the bell. Stand in the <b>SERVE box behind the counter</b>: the owner walks up and their dog trots round to you. Walk the dog through the side door into the yard — it runs off to play by itself.</p>' +
    '<p>🙋 <b>Dogs look after themselves</b> most of the time. Now and then one of them needs you — just a few at a time. A bubble and a ring on the ground show who: ❤️ stand next to it for a cuddle · 🍖 stand on the Food Bin mat to take a bowl, then stand next to the dog · 🎾 the same with a ball from the Toy Box · 🛁 stand by a muddy dog to leash it, then stand on the Bath Tub mat. Dogs that wait too long get upset.</p>' +
    '<p>💩 <b>Little accidents:</b> dogs go once or twice a day, and soon after a meal — you will see them do it. Stand on a poop to scoop it, then on the Poop Bin mat. The <b>Pooper Scooper</b> (Business tab) carries five at a time.</p>' +
    '<p>🧑‍💼 <b>Staff</b> (Business tab): hire a <b>Receptionist</b> to handle the counter while you are in the yard, or a <b>Yard Helper</b> who cuddles, feeds and plays with dogs that ask and scoops poop. Wages come off your takings at closing time.</p>' +
    '<p>⭐ <b>Special guests:</b> eight rare, named dogs visit only once a hidden requirement is met — the glossary shows which you have found and a hint for the rest. They pay five times the usual price. A 🎁 <b>daily gift</b> waits for you each real day you open up, and it grows if you come back day after day.</p>' +
    '<p>🏠 <b>Pickup:</b> when an owner comes back, their dog gets a 🏠 marker (arrows at the screen edge point the way). Stand by the dog to leash it, then stand in the SERVE box behind the counter: the owner comes to take it and pays. Happy dog = bigger tip; an upset dog or a long wait means a <b>complaint</b>, which costs stars.</p>' +
    '<p>🌙 <b>Overnight:</b> with a Kennel, some owners book overnight stays. They pay much more; the dog sleeps in its kennel and goes home the next day.</p>' +
    '<p>🔨 <b>Build mode</b> (' + primaryKey('build') + '): pick something and click the yard. Builds take real time — click a site to rush it for cash. Play areas, a pool and an Auto-Feeder let dogs sort themselves out, so fewer of them need you. Buy land in the Land tab and perks in the Business tab. Decorations add <b>charm</b>: bigger tips and more customers.</p>' +
    '<p>📱 <b>Multiplayer Co-op</b> (C): tap <b>Co-op</b> to scan the QR code or share the link with another phone on your Wi-Fi (or open a second tab). Both of you can log on, walk around together, care for pups and improve the daycare. Whenever you log on after your partner has been playing, you get a summary of everything they built and did!</p>' +
    '<p>📖 <b>Glossary</b> (' + primaryKey('dex') + '): every breed you meet is added, with its portrait and facts. There are plenty of breeds and mixes to discover.</p>' +
    '</div><div class="row"><button data-act="back" class="primary">Got it</button></div>', 'help');
  bindModalButtons();
}
function openSettings() {
  var rows = Object.keys(ACTION_LABELS).map(function (a) {
    var ks = settings.keys[a] || ['', ''];
    return '<tr><td>' + ACTION_LABELS[a] + '</td><td><button class="key" data-bind="' + a + '" data-slot="0">' + keyName(ks[0]) + '</button></td><td><button class="key" data-bind="' + a + '" data-slot="1">' + keyName(ks[1]) + '</button></td></tr>';
  }).join('');
  function opt(v, cur, label) { return '<option value="' + v + '"' + (String(v) === String(cur) ? ' selected' : '') + '>' + label + '</option>'; }
  function slider(key, min, max, step) { return '<input type="range" data-set="' + key + '" min="' + min + '" max="' + max + '" step="' + step + '" value="' + settings[key] + '">'; }
  openModal('<h2>Settings</h2><p class="small">Click a key box, then press the new key (Delete clears it, Esc cancels). <b id="bindNote" class="bad"></b></p>' +
    '<table class="keys"><tr><th>Action</th><th>Key</th><th>Alt key</th></tr>' + rows + '</table>' +
    '<div class="opts"><span>🎵 Music</span>' + slider('musicVol', 0, 1, 0.05) + '<span>🍃 Ambience</span>' + slider('ambVol', 0, 1, 0.05) + '<span>🔔 Sound effects</span>' + slider('sfxVol', 0, 1, 0.05) +
    '<span>🔍 Camera zoom</span>' + slider('zoom', 0.7, 1.4, 0.1) +
    '<span>⏳ Time to stand in a box</span>' + slider('standSec', 0.3, 2, 0.1) +
    '<span>Day length</span><select data-set="dayLength">' + opt(180, settings.dayLength, '3 minutes') + opt(300, settings.dayLength, '5 minutes') + opt(480, settings.dayLength, '8 minutes') + opt(720, settings.dayLength, '12 minutes') + '</select>' +
    '<span>Difficulty</span><select data-set="difficulty">' + opt('relaxed', settings.difficulty, 'Relaxed') + opt('normal', settings.difficulty, 'Normal') + opt('hectic', settings.difficulty, 'Hectic') + '</select></div>' +
    '<div class="row"><button data-act="back" class="primary">Done</button><button data-act="defaults" class="flat">Restore defaults</button></div>', 'settings');
  bindModalButtons();
}
function startRebind(a, slot, btn) { UI.rebinding = { a: a, slot: slot, btn: btn }; btn.textContent = 'press a key…'; btn.classList.add('wait'); }
function finishRebind(code) {
  var r = UI.rebinding; UI.rebinding = null; r.btn.classList.remove('wait');
  var note = '';
  if (code !== 'Escape' || r.a === 'pause') {
    var val = (code === 'Delete') ? '' : code, other = settings.keys[r.a][1 - r.slot];
    if (!val && !other) note = ACTION_LABELS[r.a] + ' needs at least one key.';
    else {
      if (val) for (var a in settings.keys) { var ks = settings.keys[a]; for (var i = 0; i < ks.length; i++) if (ks[i] === val && !(a === r.a && i === r.slot)) { ks[i] = ''; if (a !== r.a) note = keyName(val) + ' was taken from "' + ACTION_LABELS[a] + '".'; } }
      settings.keys[r.a][r.slot] = val;
      for (var a2 in settings.keys) { // an action that lost its last key gets a default back
        var k2 = settings.keys[a2]; if (k2[0] || k2[1]) continue;
        var defs = window.GAME_CONFIG.keys[a2] || [], free = defs.filter(function (dk) { return dk && !actionFor(dk); })[0];
        if (free) { k2[0] = free; note += ' "' + ACTION_LABELS[a2] + '" is now ' + keyName(free) + '.'; } else note += ' "' + ACTION_LABELS[a2] + '" has no key — please set one.';
      }
      saveSettings();
    }
  }
  var nEl = $('bindNote'); if (nEl) nEl.textContent = note;
  $('modal').querySelectorAll('[data-bind]').forEach(function (b) { b.textContent = keyName(settings.keys[b.getAttribute('data-bind')][+b.getAttribute('data-slot')]); });
  refreshKeyHints();
}
function refreshKeyHints() { $('kBuild').textContent = primaryKey('build'); $('kDex').textContent = primaryKey('dex'); $('kPause').textContent = primaryKey('pause'); }

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
  // only the breeds you have met are listed, in the order you met them
  var seen = BREEDS.filter(function (b) { return S.dex[b.id]; }).sort(function (a, b) { return (S.dex[a.id].first - S.dex[b.id].first) || (a.index - b.index); });
  var grid = seen.map(function (b, i) {
    var e = S.dex[b.id] || {}, c0 = (Array.isArray(e.coats) && e.coats.length) ? e.coats[0] : 0;
    return '<div class="dex-cell' + (UI.dexSel === b.id ? ' on' : '') + '" data-breed="' + b.id + '"><span class="num">#' + (i < 9 ? '0' : '') + (i + 1) + '</span>' + (b.cross ? '<span class="x" title="Cross-breed">🧬</span>' : '') +
      '<img src="' + portraitURL(b.id, c0, 80, { bg: 'badge' }) + '"><b>' + esc(b.name) + '</b></div>';
  }).join('');
  var det;
  if (!seen.length) det = '<h3>No dogs yet</h3><p style="text-align:center">Every breed you welcome at the counter is added here, with its portrait and a few facts.</p>';
  else {
    var b = BREED_BY_ID[UI.dexSel] || seen[0], e = S.dex[b.id] || { n: 1, first: 1, coats: [0], best: 0, names: [] };
    var coats = (Array.isArray(e.coats) && e.coats.length) ? e.coats : [0], names = Array.isArray(e.names) ? e.names : [];
    var cross = b.cross ? b.cross.map(function (p) { return BREED_BY_ID[p] ? BREED_BY_ID[p].name : p; }).join(' × ') : '';
    det = '<img class="big" src="' + portraitURL(b.id, coats[0], 190, { bg: 'card' }) + '"><h3>' + esc(b.name) + '</h3><div class="grp">' + esc(b.group) + (cross ? ' · ' + esc(cross) : '') + '</div>' +
      '<p>' + esc(b.blurb) + '</p>' +
      (coats.length > 1 ? '<div class="coats">' + coats.map(function (ci) { var co = (b.coats && (b.coats[ci] || b.coats[0])) || { name: '' }; return '<div><img src="' + portraitURL(b.id, ci, 56, { bg: 'badge' }) + '">' + esc(co.name) + '</div>'; }).join('') + '</div>' : '<p class="small" style="text-align:center">' + esc(((b.coats && (b.coats[coats[0]] || b.coats[0])) || { name: '' }).name) + '</p>') +
      '<div class="facts"><div><span>Shoulder height</span><b>' + b.cm + ' cm</b></div><div><span>Guests met</span><b>' + (e.n || 1) + '</b></div><div><span>First met</span><b>Day ' + (e.first || 1) + '</b></div><div><span>Happiest pickup</span><b>' + (e.best ? e.best + '%' : '—') + '</b></div></div>' +
      '<div class="tagrow">' + (b.likely || []).filter(function (t) { return !!TRAITS[t]; }).map(function (t) { return '<span title="' + TRAITS[t].desc + '">' + TRAITS[t].icon + ' often ' + TRAITS[t].label + '</span>'; }).join('') + '</div>' +
      '<p class="fact">💡 ' + esc(b.fact) + '</p>' + (names.length ? '<p class="small">Guests so far: ' + names.map(esc).join(', ') + '</p>' : '');
  }
  var found = specialsFound();
  var sp = '<div class="specials" style="grid-column:1/-1"><div class="sp-head">⭐ Special guests <small>' + found + ' of ' + SPECIALS.length + ' found</small></div>' + SPECIALS.map(function (s) {
    var got = S.specials && S.specials[s.id];
    return got ? '<div class="sp got" title="' + esc(s.hint) + '"><img src="' + portraitURL(s.breed, Math.min(s.coat, BREED_BY_ID[s.breed].coats.length - 1), 56, { bg: 'badge' }) + '"><b>' + esc(s.name) + '</b><small>' + esc(s.title) + '</small><small class="dim">first seen day ' + got.day + '</small></div>'
      : '<div class="sp"><span class="q">?</span><b>???</b><small>' + esc(s.hint) + '</small></div>';
  }).join('') + '</div>';
  grid += sp;
  card.innerHTML = '<div class="dex-head"><h2>📖 Dog Glossary</h2><span class="prog">' + n + ' breed' + (n === 1 ? '' : 's') + ' met so far</span><button data-act="back" class="primary">Close</button></div>' +
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
    '<div><span>…of which tips</span><b class="money">' + fmtMoney(s.tips) + '</b></div><div><span>PAWSOME pickups</span><b>' + s.perfect + '</b></div>' +
    '<div><span>Goal rewards</span><b class="money">' + fmtMoney(s.goalCash || 0) + '</b></div><div><span>Spent</span><b>' + fmtMoney(s.spent) + '</b></div>' +
    (s.wages ? '<div><span>Staff wages</span><b class="bad">−' + fmtMoney(s.wages) + '</b></div>' : '') +
    '<div><span>Complaints</span><b class="' + (s.complaints ? 'bad' : '') + '">' + s.complaints + '</b></div><div><span>Poop left at closing</span><b class="' + (s.leftoverPoop >= 3 ? 'bad' : '') + '">' + (s.leftoverPoop || 0) + '</b></div>' +
    '<div style="grid-column:1/3"><span>Reputation</span><b>' + stars(s.repEnd) + ' <small class="' + (dr >= 0 ? 'good' : 'bad') + '">' + (dr >= 0 ? '+' : '') + dr.toFixed(2) + '</small></b></div></div>' +
    (s.goals && s.goals.length ? '<div class="goalsum">' + s.goals.map(function (g) { return '<div class="' + (g.done ? 'good' : '') + '">' + (g.done ? '✅' : '⬜') + ' ' + esc(g.text) + '</div>'; }).join('') + '</div>' : '') +
    (s.complaintList.length ? '<div class="complaints">' + s.complaintList.map(function (c) { return '<div>📝 ' + esc(c) + '</div>'; }).join('') + '</div>' : '') +
    (S.dogs.length ? '<p class="small">🌙 ' + S.dogs.length + ' overnight guest' + (S.dogs.length > 1 ? 's are' : ' is') + ' tucked into a kennel.</p>' : '') +
    '<div class="row"><button data-act="nextday" class="primary big">☀️ Start day ' + S.day + '</button></div>', 'summary', 'sum');
  UI.rosterHTML = null; renderRoster();
  bindModalButtons();
}
function showLevelUp(lvl, unl) {
  var el = $('levelup');
  el.innerHTML = '<div class="lv">LEVEL UP!</div><div class="num">' + lvl + '</div>' + (unl.length ? '<div class="unl">Unlocked: ' + unl.map(esc).join(' · ') + '</div>' : '');
  el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  clearTimeout(UI.lvlT); UI.lvlT = setTimeout(function () { el.classList.remove('show'); }, 3800);
}
function showBanner(title, sub) {
  var el = $('banner'); el.innerHTML = '<b>' + esc(title) + '</b><span>' + esc(sub || '') + '</span>';
  el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
}
var WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
function dayBanner() { if ($('levelup').classList.contains('show')) { setTimeout(dayBanner, 1500); return; } showBanner('Day ' + S.day, WEEKDAYS[(S.day - 1) % 7] + ' · doors open at 8'); }
// Notifications: a few are shown at a time (top right, next to the tasks); extra ones wait their turn so none is missed.
var toastQ = [];
function toast(text, kind) {
  if (UI.inTitle) return;
  toastQ.push({ text: text, kind: kind || '' });
  if (toastQ.length > 12) toastQ.shift();
  pumpToasts();
}
function pumpToasts() {
  var box = $('toasts'), max = window.innerHeight < 800 ? 3 : 5;
  while (toastQ.length && box.children.length < max) {
    var q = toastQ.shift(), el = document.createElement('div'); el.className = 'toast ' + q.kind; el.textContent = q.text; box.appendChild(el);
    (function (el) {
      var life = toastQ.length > 2 ? 2400 : 4000;
      setTimeout(function () { el.classList.add('out'); }, life);
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); pumpToasts(); }, life + 480);
    })(el);
  }
}

// ---------------- build panel ----------------
var iconCache = {};
function objectIconURL(type) {
  if (iconCache[type]) return iconCache[type];
  var art = artOf(type); if (!art) return '';
  var def = CAT_BY_ID[type], size = 92, cv = document.createElement('canvas'); cv.width = size; cv.height = size;
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
  var tabs = [['care', 'Care'], ['fun', 'Fun'], ['decor', 'Decor'], ['land', 'Land'], ['biz', 'Business']];
  var h = '<div class="bp-head"><span>🔨 Build</span><button id="sellBtn" class="' + (UI.buildTool === 'sell' ? 'on' : '') + '">💸 Sell</button><button id="bpClose">Done <kbd>' + primaryKey('build') + '</kbd></button></div>' +
    '<div class="tabs">' + tabs.map(function (t) { return '<button data-tab="' + t[0] + '" class="' + (UI.buildTab === t[0] ? 'on' : '') + '">' + t[1] + '</button>'; }).join('') + '</div><div class="items">';
  if (UI.buildTab === 'land') {
    PLOTS.forEach(function (p) {
      if (!p.cost) return;
      var owned = plotOwned(p), pend = plotPending(p), locked = S.level < p.lvl;
      var far = !owned && !pend && !plotAdjacent(p);
      h += '<div class="item' + (owned ? ' owned' : '') + (locked || far ? ' locked' : '') + (S.cash < p.cost && !owned && !locked ? ' poor' : '') + '" data-plot="' + p.id + '"><div class="ic">🗺️</div><div class="tx"><b>' + p.name + '</b><small>' + p.w + '×' + p.h + ' tiles · clears in ' + fmtDur(p.time) + (far && !locked ? ' · buy a neighbouring plot first' : '') + '</small></div><div class="pr">' +
        (owned ? '✅ Owned' : pend ? '🚜 ' + fmtDur((pend.end - Date.now()) / 1000) : locked ? '🔒 Lv ' + p.lvl : fmtMoney(p.cost)) + '</div></div>';
    });
  } else if (UI.buildTab === 'biz') {
    h += '<div class="bp-sub">Staff — paid per day at closing time</div>';
    STAFF.forEach(function (s) {
      var hired = staffHired(s.id), locked = S.level < s.lvl;
      h += '<div class="item' + (hired ? ' owned' : '') + (locked ? ' locked' : '') + '" data-staff="' + s.id + '"><div class="ic">' + s.icon + '</div><div class="tx"><b>' + s.name + '</b><small class="d">' + s.desc + '</small></div><div class="pr">' +
        (hired ? '✅ Hired<br><small>' + fmtMoney(s.wage) + '/day</small>' : locked ? '🔒 Lv ' + s.lvl : fmtMoney(s.wage) + '/day') + '</div></div>';
    });
    h += '<div class="bp-sub">Perks</div>';
    UPGRADES.forEach(function (u) {
      var owned = !!S.upgrades[u.id], locked = S.level < u.lvl;
      h += '<div class="item' + (owned ? ' owned' : '') + (locked ? ' locked' : '') + (S.cash < u.cost && !owned && !locked ? ' poor' : '') + '" data-upg="' + u.id + '"><div class="ic">' + u.icon + '</div><div class="tx"><b>' + u.name + '</b><small class="d">' + u.desc + '</small></div><div class="pr">' +
        (owned ? '✅ Owned' : locked ? '🔒 Lv ' + u.lvl : fmtMoney(u.cost)) + '</div></div>';
    });
  } else {
    CATALOG.filter(function (c) { return c.cat === UI.buildTab; }).forEach(function (c) {
      var locked = S.level < c.lvl, poor = S.cash < c.cost, url = objectIconURL(c.id);
      h += '<div class="item' + (UI.buildSel === c.id ? ' sel' : '') + (locked ? ' locked' : '') + (poor && !locked ? ' poor' : '') + '" data-item="' + c.id + '">' +
        '<div class="ic">' + (url ? '<img src="' + url + '">' : c.icon) + '</div><div class="tx"><b>' + c.name + '</b><small>' + c.w + '×' + c.h + ' · ⏱ ' + fmtDur(c.time) + (c.charm >= 1 ? ' · 🌸+' + c.charm : '') + (c.cap ? ' · 🐕+' + c.cap : '') + '</small><small class="d">' + c.desc + '</small></div>' +
        '<div class="pr">' + (locked ? '🔒 Lv ' + c.lvl : fmtMoney(c.cost)) + '</div></div>';
    });
  }
  h += '</div><div class="bp-tools"><span class="small" id="bpDesc"></span></div>';
  var scroll = $('buildpanel').querySelector('.items'), st = scroll ? scroll.scrollTop : 0;
  $('buildpanel').innerHTML = h;
  var ns = $('buildpanel').querySelector('.items'); if (ns) ns.scrollTop = st;
  $('buildpanel').querySelectorAll('.item').forEach(function (el) { el.title = bpDescOf(el); });
  bpShowDesc(UI.bpHover);
  UI.bpSig = buildSig();
}
var BP_HELP = 'Click a building site to rush it. Move the mouse to the screen edge to look around. Right-click or Esc cancels.';
function bpDescOf(el) { var id = el.getAttribute('data-item'), up = el.getAttribute('data-upg'), pl = el.getAttribute('data-plot'); var sf = el.getAttribute('data-staff'); return id ? CAT_BY_ID[id].name + ': ' + CAT_BY_ID[id].desc : up ? UPG_BY_ID[up].name + ': ' + UPG_BY_ID[up].desc : sf ? STAFF_BY_ID[sf].name + ': ' + STAFF_BY_ID[sf].desc + (staffHired(sf) ? ' Click to let them go.' : '') : pl ? 'More room for dogs and buildings. Clearing the land takes real time.' : ''; }
function bpShowDesc(txt) { var el = $('bpDesc'); if (el) el.textContent = txt || (UI.buildTool === 'sell' ? 'Sell mode: click something you built to sell it for half its price.' : UI.buildSel ? CAT_BY_ID[UI.buildSel].name + ': ' + CAT_BY_ID[UI.buildSel].desc : BP_HELP); }
// One set of handlers on the panel itself (acting on press), so a re-render between press and release never swallows a click.
(function () {
  var bp = $('buildpanel');
  bp.addEventListener('mouseover', function (ev) { var it = ev.target.closest ? ev.target.closest('.item') : null; UI.bpHover = it ? bpDescOf(it) : ''; bpShowDesc(UI.bpHover); });
  bp.addEventListener('mouseleave', function () { UI.bpHover = ''; bpShowDesc(''); });
  bp.addEventListener('pointerdown', function (ev) {
    if (ev.button !== 0 || !ev.target.closest) return;
    var t = ev.target.closest('#bpClose,#sellBtn,[data-tab],[data-item],[data-plot],[data-upg],[data-staff]'); if (!t) return;
    initAudio();
    if (t.id === 'bpClose') { setMode('play'); sfx('ui_close'); return; }
    if (t.id === 'sellBtn') { UI.buildTool = UI.buildTool === 'sell' ? null : 'sell'; UI.buildSel = null; renderBuildPanel(); sfx('click'); return; }
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
      else confirmBox('Hire a <b>' + sd.name + '</b> for ' + fmtMoney(sd.wage) + ' a day?<br>' + sd.desc + '<br><small>Wages come off your cash at closing time.</small>', function () { toggleStaff(sid); renderBuildPanel(); });
      return;
    }
    if (t.hasAttribute('data-plot')) { tryBuyPlot(PLOTS.filter(function (q) { return q.id === t.getAttribute('data-plot'); })[0]); return; }
    if (t.hasAttribute('data-upg')) {
      var u = UPG_BY_ID[t.getAttribute('data-upg')];
      if (S.upgrades[u.id]) return;
      if (S.level < u.lvl) { toast('🔒 Reach level ' + u.lvl + ' for ' + u.name, 'bad'); sfx('error'); return; }
      if (S.cash < u.cost) { toast('Not enough cash for ' + u.name + ' (' + fmtMoney(u.cost) + ')', 'bad'); sfx('error'); return; }
      confirmBox('Buy <b>' + u.name + '</b> for ' + fmtMoney(u.cost) + '?<br>' + u.desc, function () { buyUpgrade(u); renderBuildPanel(); });
    }
  });
})();
function buildSig() {
  var pend = UI.buildTab === 'land' && S.plots.some(function (p) { return Date.now() < p.end + 1000; });
  return CATALOG.map(function (c) { return S.cash >= c.cost ? 1 : 0; }).join('') + PLOTS.map(function (p) { return S.cash >= p.cost ? 1 : 0; }).join('') + UPGRADES.map(function (u) { return S.cash >= u.cost ? 1 : 0; }).join('') + '|' + S.level + '|' + S.plots.length + '|' + Object.keys(S.upgrades).length + '|' + (pend ? Math.floor(Date.now() / 1000) : '');
}
function tryBuyPlot(p) {
  if (plotOwned(p) || plotPending(p)) return;
  if (S.level < p.lvl) { toast('🔒 Reach level ' + p.lvl + ' to buy ' + p.name, 'bad'); sfx('error'); return; }
  if (!plotAdjacent(p)) { toast(p.name + ' does not touch your land yet — buy a neighbouring plot first', 'bad'); sfx('error'); return; }
  if (S.cash < p.cost) { toast('Not enough cash for ' + p.name + ' (' + fmtMoney(p.cost) + ')', 'bad'); sfx('error'); return; }
  confirmBox('Buy <b>' + p.name + '</b> for ' + fmtMoney(p.cost) + '? Clearing the land takes ' + fmtDur(p.time) + '.', function () { buyPlot(p); renderBuildPanel(); });
}
function handleBuildTap(clientX, clientY) {
  if (UI.mode !== 'build' || !S) return;
  var mw = screenToWorld(clientX, clientY), tx = tileOf(mw.x), ty = tileOf(mw.y);
  var site = objAt(tx, ty);
  if (UI.buildSel && !(site && !site.done)) {
    var def = CAT_BY_ID[UI.buildSel], x = tx - Math.floor((def.w - 1) / 2), y = ty - Math.floor((def.h - 1) / 2);
    if (S.cash < def.cost) { toast('Not enough cash for a ' + def.name, 'bad'); sfx('error'); return; }
    if (!canPlace(UI.buildSel, x, y)) { sfx('error'); return; }
    placeBuild(UI.buildSel, x, y);
    if (S.cash < def.cost) UI.buildSel = null;
    renderBuildPanel(); return;
  }
  var o = site;
  if (o && UI.buildTool === 'sell') {
    if (!canSell(o)) { toast(isLastEssential(o) ? 'You need at least one ' + CAT_BY_ID[o.type].name + ' — build another before selling this one' : 'A dog is using that (or it is booked) — can\'t sell it now', 'bad'); sfx('error'); return; }
    confirmBox('Sell the ' + CAT_BY_ID[o.type].name + ' for ' + fmtMoney(sellValue(o)) + '?', function () { sellObject(o); renderBuildPanel(); });
    return;
  }
  if (o && !o.done) {
    var cost = rushCost(o);
    if (S.cash < cost) { toast('Rushing costs ' + fmtMoney(cost) + ' — not enough cash', 'bad'); sfx('error'); return; }
    confirmBox('Finish the ' + CAT_BY_ID[o.type].name + ' right now for ' + fmtMoney(cost) + '?', function () {
      var c2 = rushCost(o);
      if (S.cash >= c2 && !o.done) {
        S.cash -= c2; S.stats.spent += c2; o.buildEnd = Date.now(); sfx('buy'); saveGame();
        if (typeof MP !== 'undefined') MP.recordAction('rush', { item: o.type, name: CAT_BY_ID[o.type].name, icon: CAT_BY_ID[o.type].icon, cost: c2 });
      }
    });
    return;
  }
  var p = plotAt(tx, ty);
  if (p && !plotOwned(p) && !plotPending(p)) tryBuyPlot(p);
}
canvas.addEventListener('mousemove', function (ev) { if (UI.touchActive) return; UI.mouse.sx = ev.clientX; UI.mouse.sy = ev.clientY; UI.mouse.in = true; });
canvas.addEventListener('mouseleave', function () { if (UI.touchActive) return; UI.mouse.in = false; });
canvas.addEventListener('contextmenu', function (ev) { ev.preventDefault(); if (UI.mode === 'build') { UI.buildSel = null; UI.buildTool = null; renderBuildPanel(); } });
canvas.addEventListener('wheel', function (ev) { if (UI.mode !== 'play' && UI.mode !== 'build') return; ev.preventDefault(); settings.zoom = clamp(Math.round(((settings.zoom || 1) + (ev.deltaY > 0 ? -0.1 : 0.1)) * 10) / 10, 0.7, 1.4); clearTimeout(UI.zoomSave); UI.zoomSave = setTimeout(saveSettings, 600); }, { passive: false });
canvas.addEventListener('mousedown', function (ev) {
  initAudio();
  if (UI.touchActive || UI.mode !== 'build' || ev.button !== 0) return;
  handleBuildTap(ev.clientX, ev.clientY);
});

// Touch controls for iOS / mobile (virtual joystick, tap-to-walk, build tap/pan, pinch-to-zoom)
function _touchDist(a, b) { var dx = a.clientX - b.clientX, dy = a.clientY - b.clientY; return Math.sqrt(dx * dx + dy * dy); }
canvas.addEventListener('touchstart', function (ev) {
  initAudio();
  UI.touchActive = true;
  if (UI.mode !== 'play' && UI.mode !== 'build') return;
  ev.preventDefault();
  if (ev.touches.length >= 2) {
    UI.joy = null; UI.touchBuild = null;
    var t0 = ev.touches[0], t1 = ev.touches[1];
    UI.pinch = { d0: Math.max(10, _touchDist(t0, t1)), z0: settings.zoom || 1, mx: (t0.clientX + t1.clientX) / 2, my: (t0.clientY + t1.clientY) / 2 };
    return;
  }
  var t = ev.changedTouches[0];
  if (!t) return;
  if (UI.mode === 'play') {
    UI.joy = { id: t.identifier, ox: t.clientX, oy: t.clientY, cx: t.clientX, cy: t.clientY, dx: 0, dy: 0, active: false, moved: false, t0: performance.now() };
  } else if (UI.mode === 'build') {
    UI.mouse.sx = t.clientX; UI.mouse.sy = t.clientY; UI.mouse.in = true;
    UI.touchBuild = { id: t.identifier, ox: t.clientX, oy: t.clientY, lx: t.clientX, ly: t.clientY, moved: false };
  }
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
  var i, t = null;
  if (UI.mode === 'play' && UI.joy) {
    for (i = 0; i < ev.touches.length; i++) if (ev.touches[i].identifier === UI.joy.id) { t = ev.touches[i]; break; }
    if (!t) return;
    var dx = t.clientX - UI.joy.ox, dy = t.clientY - UI.joy.oy, dist2 = Math.sqrt(dx * dx + dy * dy);
    if (dist2 > 10) { UI.joy.active = true; UI.joy.moved = true; UI.touchTarget = null; }
    if (UI.joy.active) {
      var maxR = 52, r = Math.min(maxR, dist2), k = dist2 > 0 ? r / dist2 : 0;
      UI.joy.cx = UI.joy.ox + dx * k; UI.joy.cy = UI.joy.oy + dy * k;
      UI.joy.dx = (dx * k) / maxR; UI.joy.dy = (dy * k) / maxR;
    }
  } else if (UI.mode === 'build' && UI.touchBuild) {
    for (i = 0; i < ev.touches.length; i++) if (ev.touches[i].identifier === UI.touchBuild.id) { t = ev.touches[i]; break; }
    if (!t) return;
    UI.mouse.sx = t.clientX; UI.mouse.sy = t.clientY; UI.mouse.in = true;
    var bdx = t.clientX - UI.touchBuild.ox, bdy = t.clientY - UI.touchBuild.oy;
    if (Math.sqrt(bdx * bdx + bdy * bdy) > 12) UI.touchBuild.moved = true;
    if (UI.touchBuild.moved) {
      CAM.panX -= (t.clientX - UI.touchBuild.lx) / CAM.zoom;
      CAM.panY -= (t.clientY - UI.touchBuild.ly) / CAM.zoom;
    }
    UI.touchBuild.lx = t.clientX; UI.touchBuild.ly = t.clientY;
  }
}, { passive: false });

function _onTouchEnd(ev) {
  if (ev.touches.length < 2) UI.pinch = null;
  var i, t;
  for (i = 0; i < ev.changedTouches.length; i++) {
    t = ev.changedTouches[i];
    if (UI.joy && t.identifier === UI.joy.id) {
      if (!UI.joy.moved && performance.now() - UI.joy.t0 < 360 && S && UI.mode === 'play') {
        var mw = screenToWorld(t.clientX, t.clientY);
        var z = UI.zone;
        if (z && !z.disabled && (dist(mw.x, mw.y, S.player.x, S.player.y) < 42 || (z.rect && inRect(mw.x, mw.y, z.rect)))) {
          triggerZoneNow();
        } else {
          UI.touchTarget = { x: mw.x, y: mw.y, stuck: 0 };
        }
      }
      UI.joy = null;
    }
    if (UI.touchBuild && t.identifier === UI.touchBuild.id) {
      if (!UI.touchBuild.moved && UI.mode === 'build') {
        UI.mouse.sx = t.clientX; UI.mouse.sy = t.clientY; UI.mouse.in = true;
        handleBuildTap(t.clientX, t.clientY);
      }
      UI.touchBuild = null;
    }
  }
}
canvas.addEventListener('touchend', _onTouchEnd, { passive: false });
canvas.addEventListener('touchcancel', _onTouchEnd, { passive: false });

// ---------------- HUD ----------------
// DOM writes are skipped when nothing changed: without a GPU every repaint of a HUD panel is expensive.
var domCache = {};
function setText(id, v) { if (domCache[id] !== v) { domCache[id] = v; $(id).textContent = v; } }
function setStyle(id, prop, v) { var k = id + '.' + prop; if (domCache[k] !== v) { domCache[k] = v; $(id).style[prop] = v; } }
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
  setText('dayname', 'Day ' + S.day + (S.closing ? ' · closing time' : ''));
  setText('clock', ((hh - 1) % 12 + 1) + ':' + (mm < 10 ? '0' : '') + mm + (hh < 12 ? ' AM' : ' PM'));
  var fq = Math.round(f * 60) / 60, ang = Math.PI * (1 - fq);
  setStyle('daybar', 'width', (fq * 100).toFixed(1) + '%');
  setStyle('sun', 'transform', 'translate(' + Math.round(22 + Math.cos(ang) * 15) + 'px,' + Math.round(24 - Math.sin(ang) * 16) + 'px)');
  setText('cap', activeDogCount() + ' / ' + capacity());
  setText('charm', charm());
  setText('streak', S.streak > 1 ? '🔥 x' + S.streak : '');
  var badge = $('dexBadge'), bh = !UI.dexNew; if (badge.hidden !== bh) badge.hidden = bh; if (UI.dexNew) setText('dexBadge', UI.dexNew);
  // action hints
  var z = UI.zone, hh2 = '';
  if (UI.mode === 'build') hh2 = '<span data-hact="build">🔨 Build mode — pick an item, tap/click the yard. <kbd>' + primaryKey('build') + '</kbd> to leave</span>';
  if (UI.mode === 'play') {
    if (z) hh2 += '<span data-hact="interact" class="' + (z.disabled ? 'dim' : '') + '">' + (z.disabled ? '' : '⏳ Stay here: ') + esc(z.label) + '</span>';
    var car = S.player.carry;
    if (car) { var qa = qAction(); if (qa && !qa.disabled) hh2 += '<span data-hact="grab" class="dim"><kbd>' + primaryKey('grab') + '</kbd> ' + esc(qa.label) + '</span>'; }
    if (!hh2 && !S.tutorialDone && !S.tutorial.checkin) hh2 = '<span class="dim">Stand in the SERVE box behind the counter</span>';
  }
  if (UI.hintHTML !== hh2) { UI.hintHTML = hh2; $('hint').innerHTML = hh2; }
  // Mobile touch action buttons
  var tAct = $('touchActBtn'), tDrop = $('touchDropBtn');
  if (tAct) {
    var canAct = UI.mode === 'play' && z && !z.disabled;
    if (tAct.hidden !== !canAct) tAct.hidden = !canAct;
  }
  if (tDrop) {
    var qa2 = UI.mode === 'play' && S.player.carry ? qAction() : null;
    var canDrop = !!(qa2 && !qa2.disabled);
    if (tDrop.hidden !== !canDrop) tDrop.hidden = !canDrop;
    if (canDrop) setText('touchDropBtn', '🐾 ' + qa2.label);
  }
  UI.hudT = (UI.hudT || 0) + dt;
  if (UI.hudT - UI.lastRoster > 0.5 || UI.hudT < UI.lastRoster) { UI.lastRoster = UI.hudT; renderTasks(); renderRoster(); if (UI.mode === 'build' && UI.bpSig !== buildSig()) renderBuildPanel(); }
  UI.miniT -= dt; if (UI.miniT <= 0) { UI.miniT = 0.25; drawMinimap($('minimap')); }
}
function needBar(v, ic) { var col = v > 60 ? '#6fbf5a' : v > 35 ? '#f2c14e' : '#d9574a'; return '<div class="nb"><i>' + ic + '</i><u><s style="width:' + Math.round(v / 5) * 5 + '%;background:' + col + '"></s></u></div>'; }
function renderTasks() {
  var h;
  if (!S.tutorialDone) {
    var doneN = TUTORIAL.filter(function (t) { return S.tutorial[t.id]; }).length, nextSeen = false;
    h = '<div class="ph" id="tasksHead">🎓 Getting started <small>' + doneN + ' / ' + TUTORIAL.length + '</small><span class="chev">' + (UI.tasksOpen ? '▲' : '▼') + '</span></div>';
    var compact = window.innerHeight < 800, shown = 0;
    if (UI.tasksOpen) h += TUTORIAL.map(function (t) { var d = S.tutorial[t.id], nx = !d && !nextSeen; if (nx) nextSeen = true; if (compact && (d || ++shown > 3)) return ''; return '<div class="task' + (d ? ' done' : nx ? ' next' : '') + '"><span class="box">' + (d ? '✓' : '') + '</span><span>' + t.text + '</span></div>'; }).join('');
  } else {
    var dn = S.goals.filter(function (g) { return g.done; }).length;
    h = '<div class="ph" id="tasksHead">🎯 Today\'s goals <small>' + dn + ' / ' + S.goals.length + '</small><span class="chev">' + (UI.tasksOpen ? '▲' : '▼') + '</span></div>';
    if (UI.tasksOpen) h += S.goals.map(function (g) { var p = goalProgress(g); return '<div class="goal' + (g.done ? ' done' : '') + '"><div class="gt"><span>' + (g.done ? '✅ ' : '') + esc(goalText(g)) + '</span><b>' + (g.done ? 'Done!' : '+' + fmtMoney(g.reward)) + '</b></div><div class="gb"><div style="width:' + (p / g.n * 100) + '%"></div></div></div>'; }).join('');
  }
  if (UI.tasksHTML !== h) { UI.tasksHTML = h; $('tasks').innerHTML = h; $('tasksHead').onclick = function () { UI.tasksOpen = !UI.tasksOpen; sfx('click'); renderTasks(); }; }
}
function moodBar(v) { var col = v > 70 ? '#6fbf5a' : v > 40 ? '#f2c14e' : '#d9574a'; return '<div class="mood"><u><s style="width:' + Math.round(v / 4) * 4 + '%;background:' + col + '"></s></u></div>'; }
function renderRoster() {
  var dogs = S.dogs.filter(function (d) { return d.checkedIn && d.state !== 'leaving'; });
  var waiting = S.owners.filter(function (o) { return o.state === 'waitCheckin' || (o.state === 'walkIn' && o.kind === 'dropoff'); }).length;
  var compact = window.innerHeight < 800, needy = dogs.filter(function (d) { return d.need && !d.need.self; }).length;
  var h = '<div class="ph" id="rosterHead">🐕 Guests <small>' + activeDogCount() + ' / ' + capacity() + (needy ? ' · 🙋 ' + needy : '') + (waiting ? ' · 🔔 ' + waiting : '') + '</small><span class="chev">' + (UI.rosterOpen ? '▲' : '▼') + '</span></div>';
  if (UI.rosterOpen) {
    if (!dogs.length) h += '<div class="empty">No guests yet — owners ring the bell at the counter.</div>';
    function rank(d) { var w = d.called && S.owners.some(function (o) { return o.dogId === d.id && o.state === 'waitPickup'; }); return w ? 0 : d.need && !d.need.self ? 1 : 2; }
    dogs.sort(function (a, b) { return rank(a) - rank(b) || a.happy - b.happy; });
    dogs.forEach(function (d) {
      var hp = d.happy, wanted = rank(d) === 0, need = d.need && !d.need.self ? d.need : null;
      var ico = wanted ? '🏠' : need ? NEED_INFO[need.type].icon : d.state === 'kennel' || d.state === 'nap' ? '💤' : d.state === 'bath' ? '🛁' : d.state === 'leashed' ? '🦮' : d.overnight && d.pickupDay > S.day ? '🌙' : '';
      var what = wanted ? 'Owner waiting!' : need ? NEED_INFO[need.type].says : d.state === 'kennel' ? 'In a kennel' : d.state === 'bath' ? 'In the bath' : d.state === 'leashed' ? 'On your leash' : d.state === 'nap' ? 'Napping' : d.state === 'play' || d.state === 'romp' ? 'Playing with friends' : d.state === 'eat' ? 'Eating' : d.moraleBoost ? 'Boosting friendships & morale!' : 'Happy on its own';
      if (d.overnight && d.pickupDay > S.day && !wanted) what += ' · 🌙 overnight';
      var bObj = breedOf(d), coatObj = (bObj.coats && (bObj.coats[d.coat] || bObj.coats[0])) || { name: 'Standard' };
      var traitStr = Array.isArray(d.traits) ? d.traits.map(function (t) { return TRAITS[t] ? TRAITS[t].label : t; }).join(', ') : '';
      var favLabel = (d.fav && FAVORITES[d.fav]) ? FAVORITES[d.fav].label : 'belly rubs';
      var tip = esc(d.name + ' — ' + bObj.name + ' (' + coatObj.name + '). ' + traitStr + '. Loves ' + favLabel + '. ' + (d.quirk || '') + '.');
      var cls = 'dog' + (compact ? ' c' : '') + (wanted ? ' wanted' : '') + (need && need.t > NEED_GRACE ? ' sad' : need ? ' asks' : '');
      var pct = '<span class="hp" style="color:' + (hp > 70 ? '#3f7d3a' : hp > 40 ? '#b87514' : '#c2483c') + '">' + Math.round(hp / 2) * 2 + '%</span>';
      if (compact) h += '<div class="' + cls + '" data-dog="' + d.id + '" title="' + tip + '"><img src="' + dogPortraitSrc(d, 44) + '"><b>' + esc(d.name) + '</b><span class="ico">' + ico + '</span>' + moodBar(hp) + pct + '</div>';
      else h += '<div class="' + cls + '" data-dog="' + d.id + '" title="' + tip + '"><img src="' + dogPortraitSrc(d, 44) + '"><div class="di"><div class="dn"><b>' + (d.special ? '⭐ ' : '') + esc(d.name) + '</b><small>' + (d.special ? esc(d.title) : breedOf(d).name) + '</small>' + pct + '</div>' + moodBar(hp) + '<div class="st">' + ico + ' ' + esc(what) + '</div></div></div>';
    });
  }
  var el = $('roster');
  if (UI.rosterHTML !== h) {
    UI.rosterHTML = h; var sc = el.scrollTop; el.innerHTML = h; el.scrollTop = sc;
    $('rosterHead').onclick = function () { UI.rosterOpen = !UI.rosterOpen; sfx('click'); renderRoster(); };
    el.querySelectorAll('[data-dog]').forEach(function (c) { c.onclick = function () { var d = dogById(+c.getAttribute('data-dog')); if (d) { UI.camFocus = { id: d.id, t: 2.2 }; float(d.x, d.y - 80, '▼ ' + d.name, '#ffe082', 1.2); burst(d.x, d.y - 30, 'star', 6); sfx('click'); } }; });
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
  var dt = Math.min(0.05, (ts - lastT) / 1000); lastT = ts;
  try {
    if (S) {
      var active = UI.mode === 'play' || UI.mode === 'build';
      if (active) update(dt);
      else updateFX(dt * 0.5);
      var P = S.player, v = DIRV[P.dir] || [0, 0], tx = P.x + (P.moving ? v[0] * 46 : 0), ty = P.y - 26 + (P.moving ? v[1] * 40 : 0), zm = 1;
      if (UI.camFocus) { UI.camFocus.t -= dt; var fd = dogById(UI.camFocus.id); if (fd && UI.camFocus.t > 0 && !P.moving) { tx = fd.x; ty = fd.y - 20; } else UI.camFocus = null; }
      if (UI.camFocusPeer && typeof MP !== 'undefined') { UI.camFocusPeer.t -= dt; var fp = MP.getPeer(UI.camFocusPeer.id); if (fp && fp.online && UI.camFocusPeer.t > 0 && !P.moving) { tx = fp.x; ty = fp.y - 24; } else UI.camFocusPeer = null; }
      var building = UI.mode === 'build' || (UI.mode === 'confirm' && UI.prevMode === 'build');
      if (building) {
        if (UI.mouse.in && UI.mode === 'build') { var e = 46, sp = 620 * dt, m = UI.mouse, rEdge = VIEW.w - (VIEW.w <= 1280 ? 276 : 332); if (m.sx < e) CAM.panX -= sp; if (m.sx > rEdge - e && m.sx < rEdge + 6) CAM.panX += sp; if (m.sx > VIEW.w - 8) CAM.panX += sp; if (m.sy < e) CAM.panY -= sp; if (m.sy > VIEW.h - e) CAM.panY += sp; }
        if (P.moving) { CAM.panX *= 0.9; CAM.panY *= 0.9; }
        CAM.panX = clamp(CAM.panX, -W * TILE, W * TILE); CAM.panY = clamp(CAM.panY, -H * TILE, H * TILE);
        tx += CAM.panX; ty += CAM.panY;
        var hw = VIEW.w / 2 / CAM.zoom, hh = VIEW.h / 2 / CAM.zoom; // keep the pan from drifting past the map edge
        CAM.panX += clamp(tx, hw, Math.max(hw, W * TILE - hw)) - tx; CAM.panY += clamp(ty, hh, Math.max(hh, H * TILE - hh)) - ty;
      }
      if (VIEW.w < 1500) tx += (UI.colW || 270) * 0.42 / CAM.zoom; // keep the player centred in the part of the screen the side panels leave free
      UI.bakeAll = !CAM.ready; updateCamera(dt, tx, ty, zm, !CAM.ready); CAM.ready = true;
      render(dt); updateHUD(dt);
      saveT += dt; if (saveT > 3) { saveT = 0; saveGame(); }
      UI.sceneT -= dt; if (UI.sceneT <= 0) { UI.sceneT = 0.5; setScene(UI.mode === 'summary' ? 'summary' : UI.mode === 'build' ? 'build' : 'play'); }
    } else {
      if (!DEMO) makeDemo();
      S = DEMO; now += dt; UI.titleT += dt;
      DEMO.dogs.forEach(function (d) { updateDog(d, dt); }); DEMO.poops = []; updateFX(dt);
      var a = UI.titleT * 0.05;
      UI.bakeAll = !CAM.ready; updateCamera(dt, (25 + Math.cos(a) * 9) * TILE, (20 + Math.sin(a * 1.3) * 7) * TILE, 1, !CAM.ready); CAM.ready = true;
      UI.zone = null; render(dt);
      if (!UI.firstFrame) { // keep the loading screen up until the scenery sprites are baked
        var left = 0; try { if (typeof worldArtPrewarm === 'function') left = worldArtPrewarm(CAMM.a, 24); } catch (e) {}
        try { if (typeof prewarmPerson === 'function' && typeof PLAYER_LOOKS !== 'undefined') prewarmPerson(PLAYER_LOOKS[UI.pickLook || 0], CAMM.a, 6); } catch (e) {}
        if (!(left > 0) || UI.titleT > 3.5) { UI.firstFrame = true; setTimeout(function () { $('splash').classList.add('gone'); setTimeout(function () { $('splash').style.display = 'none'; }, 800); }, 120); }
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
if ($('touchActBtn')) $('touchActBtn').onclick = function () { initAudio(); if (UI.mode === 'play') triggerZoneNow(); };
if ($('touchDropBtn')) $('touchDropBtn').onclick = function () { initAudio(); if (UI.mode === 'play') { var qa = qAction(); if (qa && !qa.disabled) qa.run(); } };
if ($('touchWaveBtn')) $('touchWaveBtn').onclick = function () { initAudio(); if (typeof MP !== 'undefined' && (UI.mode === 'play' || UI.mode === 'build')) MP.sendWave(); };
(function setupFixedJoystick() {
  var jz = $('joystickZone'), jb = $('joyBase'), jk = $('joyKnob');
  if (!jz || !jb || !jk) return;
  var jId = null, ox = 0, oy = 0, maxR = 38;
  function updateKnob(cx, cy) {
    var dx = cx - ox, dy = cy - oy, d = Math.sqrt(dx * dx + dy * dy);
    var r = Math.min(maxR, d), k = d > 0 ? r / d : 0;
    jk.style.transform = 'translate(' + Math.round(dx * k) + 'px,' + Math.round(dy * k) + 'px)';
    UI.joy = { id: jId, ox: ox, oy: oy, cx: ox + dx * k, cy: oy + dy * k, dx: (dx * k) / maxR, dy: (dy * k) / maxR, active: d > 4, moved: true };
    if (d > 4) UI.touchTarget = null;
  }
  jz.addEventListener('touchstart', function (ev) {
    initAudio(); ev.preventDefault(); ev.stopPropagation();
    var t = ev.changedTouches[0]; if (!t) return;
    jId = t.identifier;
    var rect = jb.getBoundingClientRect();
    ox = rect.left + rect.width / 2; oy = rect.top + rect.height / 2;
    updateKnob(t.clientX, t.clientY);
  }, { passive: false });
  jz.addEventListener('touchmove', function (ev) {
    if (jId == null) return;
    ev.preventDefault(); ev.stopPropagation();
    for (var i = 0; i < ev.touches.length; i++) {
      if (ev.touches[i].identifier === jId) { updateKnob(ev.touches[i].clientX, ev.touches[i].clientY); break; }
    }
  }, { passive: false });
  function endJoy(ev) {
    if (jId == null) return;
    for (var i = 0; i < ev.changedTouches.length; i++) {
      if (ev.changedTouches[i].identifier === jId) {
        jId = null; jk.style.transform = 'translate(0px,0px)'; UI.joy = null; break;
      }
    }
  }
  jz.addEventListener('touchend', endJoy, { passive: false });
  jz.addEventListener('touchcancel', endJoy, { passive: false });
})();
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
refreshKeyHints();
// wait (briefly) for the bundled fonts so canvas text and cached images use them, then start
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
