'use strict';
var UI = {
  mode: 'title', prevMode: 'play', actions: null, mouse: { sx: 0, sy: 0, in: false },
  buildSel: null, buildTool: null, buildTab: 'care', buildRot: 0, moveObj: null, moveRot: 0, dragPos: null, actionObj: null,
  summary: null, cashShown: 0, cashPulse: 0, lastRoster: 0, modalStack: [], dexSel: null, dexNew: 0,
  tasksOpen: false, rosterOpen: false,
  camFocus: null, sceneT: 0, miniT: 0, miniDirty: true, cashWorld: null, titleT: 0,
  joy: null, touchTarget: null, pinch: null, touchBuild: null
};
var $ = function (id) { return document.getElementById(id); };
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

function initAudio() { audioInit(); if (!UI.volApplied && typeof AC !== 'undefined' && AC) { UI.volApplied = true; applyVolumes(); } }

// ---------------- modes ----------------
function setMode(m) {
  var wasMode = UI.mode;
  UI.mode = m;
  document.body.classList.toggle('building', m === 'build');
  document.body.classList.toggle('title', !!UI.inTitle);
  if (m !== 'build') { UI.buildSel = null; UI.buildTool = null; UI.moveObj = null; UI.dragPos = null; UI.buildRot = 0; UI.moveRot = 0; CAM.panX = 0; CAM.panY = 0; }
  if (m !== 'play') { UI.joy = null; UI.touchTarget = null; }
  if (m === 'play' && S && S.player && typeof unstuckPlayer === 'function') {
    unstuckPlayer(S.player, true);
  }
  if (m === 'build') {
    UI.buildSel = null;
    UI.buildTool = null;
    UI.moveObj = null;
    UI.dragPos = null;
    UI.buildRot = 0;
    UI.moveRot = 0;
    if (wasMode !== 'confirm') {
      CAM.panX = 0;
      CAM.panY = 0;
      if (!CAM.buildZoom) CAM.buildZoom = 1;
    }
    if (S && !S.tutorialDone && typeof tutorialRequiredBuildType === 'function') {
      var reqType = tutorialRequiredBuildType();
      if (reqType && CAT_BY_ID[reqType]) {
        UI.buildTab = CAT_BY_ID[reqType].cat || 'care';
      }
    }
  }
  $('buildpanel').hidden = m !== 'build';
  if (m === 'build') renderBuildPanel();
  $('buildBtn').classList.toggle('on', m === 'build');
  if (typeof setScene === 'function' && !UI.inTitle) {
    setScene(m === 'summary' ? 'summary' : m === 'build' ? 'build' : 'play');
  }
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
  if (tName) {
    tName.oninput = function () { UI._userTypedName = true; };
    tName.onchange = tName.onblur = function () {
      UI.pendingPlayerName = tName.value.trim().slice(0, 18);
      if (typeof MP !== 'undefined') MP.setProfile(UI.pendingPlayerName || undefined, UI.pickLook);
    };
  }
  if (tRoom) {
    tRoom.oninput = tRoom.onchange = tRoom.onblur = function () {
      UI.pendingJoinCode = tRoom.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    };
  }
  m.querySelectorAll('[data-breed]').forEach(function (b) { b.onclick = function () { UI.dexSel = b.getAttribute('data-breed'); sfx('page'); renderDex(); }; });
}
function fadeThen(fn) { var f = $('fade'); f.style.display = 'block'; void f.offsetWidth; f.classList.add('on'); setTimeout(function () { fn(); setTimeout(function () { f.classList.remove('on'); setTimeout(function () { if (!f.classList.contains('on')) f.style.display = 'none'; }, 700); }, 160); }, 420); }
function enterPlayFromState(fresh) {
  var isFreshStart = !!fresh;
  var isJoiningRoom = !!UI.joiningDaycare;
  UI.joiningDaycare = false;
  if (fresh) {
    if (typeof clearSavedGame === 'function') clearSavedGame();
    else { try { localStorage.removeItem(SAVE_KEY); localStorage.setItem(OLD_DONE_KEY, '1'); } catch (e) {} }
    S = null; newState(); S.player.look = UI.pickLook || 0;
  } else if (isJoiningRoom) {
    // Joining a shared daycare by Room Code: start from a clean base with savedAt=0 so the shared room snapshot applies without broadcasting a New Game reset!
    isFreshStart = false;
    S = null; newState();
    S.created = 0; S.savedAt = 0;
    S.player.look = UI.pickLook || 0;
  } else if (!loadGame()) {
    isFreshStart = true;
    newState(); S.player.look = UI.pickLook || 0;
  } else if (S.migrated) {
    S.player.look = UI.pickLook || 0;
  }
  if (isFreshStart && S) {
    S.objects = [];
    S.chores = [];
    markDirty(true);
  }
  if (S && (isFreshStart || isJoiningRoom || UI._userPickedLook) && UI.pickLook != null) S.player.look = UI.pickLook;
  else if (S && S.player && typeof S.player.look === 'number') UI.pickLook = S.player.look;
  UI._userPickedLook = false;
  UI.titleStep = 'menu';
  UI.inTitle = false;
  if (typeof setActiveSession === 'function') setActiveSession(true);
  if (typeof MP !== 'undefined') MP.onStartGame(isFreshStart);
  UI.cashShown = S.cash; FX.parts = []; FX.floats = [];
  UI.modalStack = []; $('modalwrap').hidden = true; $('modal').innerHTML = ''; UI.prevMode = 'play'; setMode('play');
  CAM.ready = false; sfx('day_start'); setTimeout(dayBanner, 650);
  var gift = isJoiningRoom ? null : dailyGift();
  if (gift) setTimeout(function () { if (UI.mode === 'play' || UI.mode === 'build') showGift(gift); }, 3000);
  if (S.offlineReport) {
    var rep = S.offlineReport; delete S.offlineReport; saveGame();
    toast('🧑‍💼 Staff ran the shop for ' + fmtDur(rep.sec) + ' while closed: cared for ' + rep.dogs + ' dogs and netted +' + fmtMoney(rep.earned) + ' (after supplies & staff cut)!', 'good');
  }
  if (S.migrated) { var r = S.migrated.refund; delete S.migrated; saveGame(); openModal('<h2>Welcome back!</h2><p>Paws &amp; Play has moved into a bigger, prettier home. Your level, reputation and cash came along' + (r ? ', and everything you had built was refunded: <b class="good">+' + fmtMoney(r) + '</b>' : '') + '. The yard is a fresh start — time to decorate!</p><div class="row"><button data-act="back" class="primary">Let\'s go</button></div>', 'note'); bindModalButtons(); }
  else if (S.totalServed === 0 && !S.tutorial.checkin) toast('🐶 Tap 🔨 Shop at the bottom to select and place your first Kennel on the lawn!', 'good');
  if (!isJoiningRoom) saveGame();
}
var CURRENT_ASSET_VER = '26';
function isOnlineAndSynced() {
  if (typeof MP !== 'undefined' && typeof MP.isCloudReady === 'function') {
    return MP.isCloudReady();
  }
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}
function updateNetGate() {
  var gate = $('netgate');
  if (!gate) return true;
  var ok = isOnlineAndSynced();
  if (gate.hidden !== ok) gate.hidden = ok;
  if (!ok) {
    var navOnline = typeof navigator === 'undefined' || navigator.onLine !== false;
    var rCode = (typeof MP !== 'undefined' && MP.roomCode) ? MP.roomCode : 'PAWS';
    setText('netTitle', navOnline ? '☁️ Syncing Across Phones…' : '📡 No Internet Connection');
    setText('netMsg', navOnline
      ? 'Connecting to the Cloud Sync server (Room: ' + rCode + '). The game requires an active connection so your daycare stays synced across phones.'
      : 'Paws & Play cannot run without internet. Connect to Wi-Fi or 5G so your daycare stays synced across phones.');
    setText('netStatus', navOnline ? ('🔄 Connecting to Cloud Relay (Room ' + rCode + ')…') : '❌ Offline — Game paused until internet is restored');
  }
  return ok;
}
function checkAndReloadIfUpdated( startFreshAfterReload ) {
  if (typeof fetch !== 'function' || (location.protocol !== 'http:' && location.protocol !== 'https:')) return false;
  try {
    fetch('index.html?_cb=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.text() : ''; })
      .then(function (txt) {
        var m = txt && txt.match(/js\/game\.js\?v=(\d+)/);
        if (m && m[1] && m[1] !== CURRENT_ASSET_VER) {
          if (startFreshAfterReload) {
            try { if (typeof clearSavedGame === 'function') clearSavedGame(); sessionStorage.setItem('paws_autostart_fresh', '1'); } catch (e) {}
          } else if (S && !UI.inTitle && typeof saveGame === 'function') {
            try { saveGame(); } catch (e) {}
          }
          location.reload();
        }
      }).catch(function () {});
  } catch (e) {}
  return false;
}
function startGame(fresh) {
  if (!updateNetGate()) {
    toast('📡 Internet & Cloud Sync required to play!', 'bad');
    if (typeof MP !== 'undefined' && MP.reconnectNow) MP.reconnectNow();
    return;
  }
  checkAndReloadIfUpdated(fresh);
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
  var hearts = 4 + Math.min(S.giftStreak, 7);
  S.cash += amount; S.hearts = (S.hearts || 0) + hearts;
  if (S.life) S.life.hearts = (S.life.hearts || 0) + hearts;
  if (typeof MP !== 'undefined') MP.recordAction('gift', { earned: amount, name: 'Daily Gift', icon: '🎁' });
  saveGame();
  return { amount: amount, hearts: hearts, streak: S.giftStreak, days: S.playDays };
}
function showGift(g) {
  if (UI.inTitle || !S) return;
  var next = g.streak < 7 ? 'Come back tomorrow for ' + fmtMoney(25 + 15 * Math.min(g.streak + 1, 7)) + ' & +' + (4 + Math.min(g.streak + 1, 7)) + '💛.' : 'You are at the top gift — keep the streak going!';
  openModal('<h2>🎁 Daily gift</h2><p style="text-align:center">Welcome back! The regulars chipped in:</p><div class="rating"><b class="money">+' + fmtMoney(g.amount) + '</b> &nbsp; <b style="color:#d48b1c">+' + (g.hearts || 5) + '💛</b></div>' +
    '<p style="text-align:center">' + (g.streak > 1 ? '🔥 ' + g.streak + ' days in a row' : 'Day ' + g.days + ' of running Paws & Play') + ' · ' + next + '</p>' +
    '<div class="row"><button data-act="back" class="primary">Thanks!</button></div>', 'gift');
  bindModalButtons(); sfx('coin'); confetti(S.player.x, S.player.y - 50, 30);
}
var MODAL_ACTS = {
  play: function () { UI.joiningDaycare = false; startGame(!hasSave()); },
  newgame: function () {
    UI.titleStep = 'create';
    UI.pendingRoomCode = (typeof MP !== 'undefined' && MP.generateRoomCode) ? MP.generateRoomCode() : 'PAWS24';
    openTitle();
  },
  titlecreate: function () {
    UI.titleStep = 'create';
    if (!UI.pendingRoomCode) {
      UI.pendingRoomCode = (typeof MP !== 'undefined' && MP.generateRoomCode) ? MP.generateRoomCode() : 'PAWS24';
    }
    openTitle();
  },
  titlejoin: function () {
    UI.titleStep = 'join';
    openTitle();
  },
  titleback: function () {
    UI.titleStep = 'menu';
    openTitle();
  },
  confirmcreate: function () {
    var tName = $('titleNameInput');
    var looks = (typeof PLAYER_LOOKS !== 'undefined') ? PLAYER_LOOKS : [];
    var defName = (looks[UI.pickLook || 0] && looks[UI.pickLook || 0].name) || 'Sam';
    var chosenName = (tName && tName.value.trim()) ? tName.value.trim().slice(0, 18) : defName;
    var createCode = UI.pendingRoomCode || ((typeof MP !== 'undefined' && MP.roomCode) ? MP.roomCode : 'PAWS24');
    UI.pendingPlayerName = chosenName;
    UI.joiningDaycare = false;
    var doCreate = function () {
      if (typeof MP !== 'undefined') {
        MP.setProfile(chosenName, UI.pickLook, createCode);
      }
      UI.pendingRoomCode = null;
      startGame(true);
    };
    if (hasSave()) {
      confirmBox('Create a new Daycare (Room <b>' + esc(createCode) + '</b>) as <b>' + esc(chosenName) + '</b>?<br><small>Your previous local daycare will be replaced by this new Daycare.</small>', doCreate);
    } else {
      doCreate();
    }
  },
  confirmjoin: function () {
    var tName = $('titleNameInput'), tRoom = $('titleRoomInput');
    var looks = (typeof PLAYER_LOOKS !== 'undefined') ? PLAYER_LOOKS : [];
    var defName = (looks[UI.pickLook || 0] && looks[UI.pickLook || 0].name) || 'Sam';
    var chosenName = (tName && tName.value.trim()) ? tName.value.trim().slice(0, 18) : defName;
    var rawCode = (tRoom ? tRoom.value : (UI.pendingJoinCode || '')).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    if (!rawCode || rawCode.length < 3) {
      sfx('error');
      if (tRoom) {
        tRoom.focus();
        tRoom.style.borderColor = '#d9574a';
      }
      return;
    }
    UI.pendingPlayerName = chosenName;
    UI.pendingJoinCode = rawCode;
    UI.joiningDaycare = true;
    if (typeof MP !== 'undefined') {
      MP.setProfile(chosenName, UI.pickLook);
      MP.switchRoom(rawCode, true);
    }
    startGame(false);
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
  moveobj: function () {
    var o = UI.actionObj; closeModal();
    if (!o) return;
    if ((o.type === 'tub' || o.type === 'groomhouse') && o.dogId) { toast('Wait for the bath to finish before moving ' + CAT_BY_ID[o.type].name, 'bad'); sfx('error'); return; }
    setMode('build'); UI.buildTool = 'move'; UI.buildSel = null; UI.moveObj = o; UI.moveRot = o.rot || 0; UI.dragPos = { x: o.x, y: o.y }; renderBuildPanel();
    toast('↔️ Drag ' + CAT_BY_ID[o.type].name + ' anywhere on the lawn (or tap 🔄 Rotate)!', '');
  },
  rotobj: function () {
    var o = UI.actionObj; closeModal();
    if (!o) return;
    if ((o.type === 'tub' || o.type === 'groomhouse') && o.dogId) { toast('Wait for the bath to finish before rotating ' + CAT_BY_ID[o.type].name, 'bad'); sfx('error'); return; }
    if (typeof rotateObjectInPlace === 'function' && rotateObjectInPlace(o)) {
      renderBuildPanel();
      return;
    }
    setMode('build'); UI.buildTool = 'move'; UI.buildSel = null; UI.moveObj = o; UI.moveRot = ((o.rot || 0) + 1) % 4; UI.dragPos = { x: o.x, y: o.y }; renderBuildPanel();
    toast('🔄 Rotated ' + CAT_BY_ID[o.type].name + ' — drag it to an open green spot on the lawn!', '');
  },
  upgobj: function () {
    var o = UI.actionObj; closeModal();
    if (o) {
      if (o.upgrading) promptRushSite(o);
      else promptUpgradeObject(o);
    }
  },
  cutrib: function () {
    var o = UI.actionObj; closeModal();
    if (o && typeof cutRibbon === 'function') { cutRibbon(o); renderBuildPanel(); }
  },
  boostsite: function () {
    var o = UI.actionObj; closeModal();
    if (o && typeof heartBoostSite === 'function') { heartBoostSite(o); renderBuildPanel(); }
  },
  lendpaw: function () {
    var o = UI.actionObj; closeModal();
    if (o && typeof lendAPaw === 'function') { lendAPaw(o); renderBuildPanel(); }
  },
  rushsite: function () {
    var o = UI.actionObj; closeModal();
    if (!o) return;
    var c2 = rushCost(o), cName = CAT_BY_ID[o.type] ? CAT_BY_ID[o.type].name : o.type;
    if (S.cash < c2) { toast('Finishing now costs ' + fmtMoney(c2) + ' — not enough cash', 'bad'); sfx('error'); return; }
    if (!o.done || o.upgrading) {
      S.cash -= c2; S.stats.spent += c2;
      if (!o.done) o.buildEnd = Date.now();
      else if (o.upgrading) o.upgradeEnd = Date.now();
      sfx('buy'); checkBuilds();
      if (typeof MP !== 'undefined') MP.recordAction('rush', { item: o.type, objId: o.id, name: cName, icon: CAT_BY_ID[o.type].icon, cost: c2 });
      saveGame(); renderBuildPanel();
    }
  },
  trainstaff: function () {
    var sid = UI.actionStaff; closeModal();
    if (sid) { trainStaff(sid); renderBuildPanel(); }
  },
  firestaff: function () {
    var sid = UI.actionStaff; closeModal();
    if (sid && staffHired(sid)) { toggleStaff(sid); renderBuildPanel(); }
  },
  sellobj: function () {
    var o = UI.actionObj; closeModal();
    if (!o) return;
    if (!canSell(o)) { toast(isLastEssential(o) ? 'You need at least one ' + CAT_BY_ID[o.type].name : 'A dog is using that right now', 'bad'); sfx('error'); return; }
    confirmBox('Sell the ' + CAT_BY_ID[o.type].name + ' (Lv ' + (o.lvl || 1) + ') for ' + fmtMoney(sellValue(o)) + '?', function () { sellObject(o); renderBuildPanel(); });
  },
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
  if (!UI.titleStep) UI.titleStep = 'menu';
  var looks = (typeof PLAYER_LOOKS !== 'undefined') ? PLAYER_LOOKS : [];
  var savedLook = (has && typeof peekSavedLook === 'function') ? peekSavedLook() : null;
  if (savedLook != null && !UI._userPickedLook) UI.pickLook = savedLook;
  else if (typeof MP !== 'undefined' && UI.pickLook == null) UI.pickLook = MP.playerLook;
  else if (UI.pickLook == null) UI.pickLook = 0;
  var pName = UI.pendingPlayerName || ((typeof MP !== 'undefined' && MP.playerName) ? MP.playerName : ((looks[UI.pickLook] && looks[UI.pickLook].name) || 'Sam'));
  var rCode = (typeof MP !== 'undefined' && MP.roomCode) ? MP.roomCode : 'PAWS';

  if (UI.titleStep === 'create' || UI.titleStep === 'join') {
    var isCreate = UI.titleStep === 'create';
    if (isCreate && !UI.pendingRoomCode) {
      UI.pendingRoomCode = (typeof MP !== 'undefined' && MP.generateRoomCode) ? MP.generateRoomCode() : rCode;
    }
    var joinCodeVal = UI.pendingJoinCode != null ? UI.pendingJoinCode : ((typeof window !== 'undefined' && window.location && window.location.search.indexOf('room=') >= 0) ? rCode : '');
    var chars = looks.length ? '<div class="title-field"><label>1. Select a Keeper</label><div class="chars">' + looks.map(function (l, i) { return '<div class="ch' + (i === UI.pickLook ? ' on' : '') + '" data-look="' + i + '"><img src="' + lookPortrait(i, 64) + '"><small>' + esc(l.name || ('Keeper ' + (i + 1))) + '</small></div>'; }).join('') + '</div></div>' : '';
    var nameField = '<div class="title-field"><label for="titleNameInput">2. Type in Your Name</label><input type="text" id="titleNameInput" class="title-input" maxlength="18" value="' + esc(pName) + '" placeholder="Enter your name…"></div>';
    var roomField = isCreate
      ? '<div class="title-field"><label>3. Your Daycare Code (Share with friends!)</label><div class="title-code-badge">🏠 Room Code: <b>' + esc(UI.pendingRoomCode) + '</b></div></div>'
      : '<div class="title-field"><label for="titleRoomInput">3. Enter Daycare Code to Join</label><input type="text" id="titleRoomInput" class="title-input code" maxlength="8" value="' + esc(joinCodeVal) + '" placeholder="Enter 6-character code…"></div>';

    $('modal').innerHTML = '<div class="card title"><div class="logo">Paws &amp; Play<span>DOGGY DAYCARE</span></div>' +
      '<div class="title-step-head">' + (isCreate ? '🏠 Create a Daycare' : '🤝 Join a Daycare') + '</div>' +
      '<div class="title-setup-box">' + chars + nameField + roomField + '</div>' +
      '<div class="row col">' +
        (isCreate
          ? '<button data-act="confirmcreate" class="primary big">🏠 Start My Daycare</button>'
          : '<button data-act="confirmjoin" class="primary big">🤝 Join Daycare</button>') +
        '<button data-act="titleback" class="flat">← Back</button>' +
      '</div></div>';
    $('modalwrap').hidden = false; bindModalButtons();
    return;
  }

  $('modal').innerHTML = '<div class="card title"><div class="logo">Paws &amp; Play<span>DOGGY DAYCARE</span></div>' +
    '<p class="tag">Drag with one thumb to welcome pups, stack supplies,<br>and run a shared daycare synced across iPhones!</p>' +
    '<div class="row col">' +
      (has ? '<button data-act="play" class="primary big">▶ Continue Daycare (Room: ' + esc(rCode) + ')</button>' : '') +
      '<button data-act="titlecreate" class="' + (has ? 'wood big' : 'primary big') + '">🏠 Create a Daycare</button>' +
      '<button data-act="titlejoin" class="wood big">🤝 Join a Daycare</button>' +
      '<div class="row" style="margin-top:2px"><button data-act="help" class="flat">How to Play</button><button data-act="settings" class="flat">Settings &amp; Co-op</button></div>' +
    '</div></div>';
  $('modalwrap').hidden = false; bindModalButtons();
}
function openPause() {
  saveGame();
  openModal('<h2>Paused</h2><div class="row col"><button data-act="resume" class="primary big">Resume</button><button data-act="dex">📖 Dog Breeds</button><button data-act="settings">⚙️ Settings &amp; Co-op</button><button data-act="help">How to Play</button><button data-act="totitle" class="flat">Save &amp; Quit to Title</button></div>' +
    '<p class="small">Your daycare saves automatically on your iPhone.</p>', 'paused', 'narrow');
  bindModalButtons();
}
function openHelp() {
  openModal('<h2>How to Play</h2><div class="help">' +
    '<p>🕹️ <b>One-Thumb Controls:</b> Touch and drag anywhere on the screen to move your keeper with the floating joystick (or tap any spot to walk there). Every action happens <b>automatically</b> when you walk up to it!</p>' +
    '<p>⭐ <b>Star Rating &amp; Dog Count:</b> Your <b>★ Star Rating</b> controls how many dogs visit your daycare! Raise your stars (or recover from a low rating) by completing <b>🍂💧🦴✨ Yard &amp; Shop Chores</b>, playing fetch, cuddling, teaching tricks, or running an <b>Open House</b> in <b>🔨 Shop → Research &amp; Staff</b>.</p>' +
    '<p>🥣 <b>Stack, Play &amp; Train Anytime:</b> Walk onto the <b>Food Bin</b>, <b>Toy Box</b>, or <b>Treat Jar</b> pad to stack items, then walk up to any dog in the yard to play fetch, teach tricks, feed snacks, or cuddle them for bonus cash and ★ Reputation!</p>' +
    '<p>💵 <b>Floor Unlock Boxes &amp; Land Expansion:</b> Step onto green <b>$ Boxes</b> or golden <b>🗺️ Land Expansion Boxes</b> at the yard border to build stations and unlock new land with new attractions!</p>' +
    '<p>🏠 <b>Kennels &amp; Pickups:</b> The number of dogs allowed in your daycare equals your number of built <b>🏠 Kennels</b> (unlock more Kennels as you level up!). At pickup time, check which dog the owner at the counter asks for — pickup dogs have <b>no home icon</b> and keep doing their own thing on the lawn, so find them, walk near them to leash them, and return them at the <b>SERVE pad</b>!</p>' +
    '</div><div class="row"><button data-act="back" class="primary">Got it!</button></div>', 'help');
  bindModalButtons();
}
function openSettings() {
  function opt(v, cur, label) { return '<option value="' + v + '"' + (String(v) === String(cur) ? ' selected' : '') + '>' + label + '</option>'; }
  function slider(key, min, max, step) { return '<input type="range" data-set="' + key + '" min="' + min + '" max="' + max + '" step="' + step + '" value="' + settings[key] + '">'; }
  var rCode = (typeof MP !== 'undefined' && MP.roomCode) ? MP.roomCode : 'PAWS';
  var onlineN = (typeof MP !== 'undefined' && MP.getOnlinePeers) ? MP.getOnlinePeers().length : 0;
  openModal('<h2>Settings</h2>' +
    '<div class="opts"><span>🎵 Music</span>' + slider('musicVol', 0, 1, 0.05) +
    '<span>🍃 Ambience</span>' + slider('ambVol', 0, 1, 0.05) +
    '<span>🔔 Sound effects</span>' + slider('sfxVol', 0, 1, 0.05) +
    '<span>🔍 Camera zoom</span>' + slider('zoom', 0.7, 1.4, 0.1) +
    '<span>Day length</span><select data-set="dayLength">' + opt(180, settings.dayLength, '3 minutes') + opt(300, settings.dayLength, '5 minutes') + opt(480, settings.dayLength, '8 minutes') + opt(720, settings.dayLength, '12 minutes') + '</select>' +
    '<span>Difficulty</span><select data-set="difficulty">' + opt('relaxed', settings.difficulty, 'Relaxed') + opt('normal', settings.difficulty, 'Normal') + opt('hectic', settings.difficulty, 'Hectic') + '</select></div>' +
    '<div class="row col" style="margin-top:10px">' +
      '<button data-act="coop" class="wood">📱 iPhone Co-op &amp; Room Setup (Room: ' + esc(rCode) + (onlineN ? ' · 🟢 ' + (onlineN + 1) + ' Online' : '') + ')</button>' +
      (S ? '<button data-act="partnersummary" class="flat">📋 View What Partner Did</button>' : '') +
    '</div>' +
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
    var mLv = typeof breedMasteryLvl === 'function' ? breedMasteryLvl(b.id) : 0;
    return '<div class="dex-cell' + (UI.dexSel === b.id ? ' on' : '') + '" data-breed="' + b.id + '"><span class="num">#' + (i < 9 ? '0' : '') + (i + 1) + (mLv > 0 ? ' · ★' + mLv : '') + '</span>' + (b.cross ? '<span class="x">🧬</span>' : '') +
      '<img src="' + portraitURL(b.id, c0, 80, { bg: 'badge' }) + '"><b>' + esc(b.name) + '</b></div>';
  }).join('');
  var det;
  if (!seen.length) det = '<h3>No dogs yet</h3><p style="text-align:center">Every breed you welcome at the counter is added here, with its portrait and facts.</p>';
  else {
    var b = BREED_BY_ID[UI.dexSel] || seen[0], e = S.dex[b.id] || { n: 1, first: 1, coats: [0], best: 0, names: [] };
    var coats = (Array.isArray(e.coats) && e.coats.length) ? e.coats : [0], names = Array.isArray(e.names) ? e.names : [];
    var cross = b.cross ? b.cross.map(function (p) { return BREED_BY_ID[p] ? BREED_BY_ID[p].name : p; }).join(' × ') : '';
    var bmLv = typeof breedMasteryLvl === 'function' ? breedMasteryLvl(b.id) : 0;
    var bmNext = typeof breedMasteryNextAt === 'function' ? breedMasteryNextAt(bmLv) : 2;
    det = '<img class="big" src="' + portraitURL(b.id, coats[0], 160, { bg: 'card' }) + '"><h3>' + esc(b.name) + '</h3><div class="grp">' + esc(b.group) + (cross ? ' · ' + esc(cross) : '') + ' · <b>★ Mastery Lv ' + bmLv + ' (+' + (bmLv * 8) + '% Pay)</b></div>' +
      '<p>' + esc(b.blurb) + '</p>' +
      (coats.length > 1 ? '<div class="coats">' + coats.map(function (ci) { var co = (b.coats && (b.coats[ci] || b.coats[0])) || { name: '' }; return '<div><img src="' + portraitURL(b.id, ci, 56, { bg: 'badge' }) + '">' + esc(co.name) + '</div>'; }).join('') + '</div>' : '<p class="small" style="text-align:center">' + esc(((b.coats && (b.coats[coats[0]] || b.coats[0])) || { name: '' }).name) + '</p>') +
      '<div class="facts"><div><span>Height</span><b>' + b.cm + ' cm</b></div><div><span>Guests met</span><b>' + (e.n || 1) + ' / ' + bmNext + ' next ★</b></div><div><span>First met</span><b>Day ' + (e.first || 1) + '</b></div><div><span>Best pickup</span><b>' + (e.best ? e.best + '%' : '—') + '</b></div></div>' +
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
    '<div><span>Paw Hearts</span><b style="color:#d48b1c">+' + (s.hearts || 0) + '💛</b></div><div><span>Goal rewards</span><b class="money">' + fmtMoney(s.goalCash || 0) + '</b></div>' +
    '<div><span>Spent</span><b>' + fmtMoney(s.spent) + '</b></div>' +
    (s.wages ? '<div><span>Staff wages</span><b class="bad">−' + fmtMoney(s.wages) + '</b></div>' : '<div><span>Day</span><b>#' + s.day + '</b></div>') +
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
function dayBanner() {
  if ($('levelup').classList.contains('show')) { setTimeout(dayBanner, 1500); return; }
  var ev = typeof currentDailyEvent === 'function' ? currentDailyEvent() : null;
  if (ev) {
    showBanner('Day ' + S.day + ' · ' + ev.icon + ' ' + ev.name, ev.desc);
  } else {
    showBanner('Day ' + S.day, WEEKDAYS[(S.day - 1) % 7] + ' · doors open at 8');
  }
}

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
var ROT_LABELS = ['South ↓', 'East →', 'North ↑', 'West ←'];
function renderBuildPanel() {
  var isMinimized = !!(UI.buildSel || UI.moveObj || UI.buildTool === 'move' || UI.buildTool === 'upgrade' || UI.buildTool === 'sell');
  $('buildpanel').classList.toggle('minimized', isMinimized);
  if (isMinimized) {
    var hMin = '';
    if (UI.buildSel && CAT_BY_ID[UI.buildSel]) {
      var sDef = CAT_BY_ID[UI.buildSel];
      var sCost = typeof itemCost === 'function' ? itemCost(sDef.id) : sDef.cost;
      var sTime = typeof itemBuildTime === 'function' ? itemBuildTime(sDef.id) : sDef.time;
      var effT = !S.tutorialDone ? Math.min(sTime, 2.5) : sTime;
      var sUrl = objectIconURL(sDef.id);
      var bRot = ((UI.buildRot || 0) % 4 + 4) % 4;
      var bDims = typeof objDims === 'function' ? objDims(sDef, bRot) : { w: sDef.w, h: sDef.h };
      if (!UI.dragPos && typeof defaultBuildSpot === 'function') UI.dragPos = defaultBuildSpot(sDef.id, bRot);
      hMin = '<div class="bp-min-bar">' +
        '<div class="ic">' + (sUrl ? '<img src="' + sUrl + '">' : sDef.icon) + '</div>' +
        '<div class="tx"><b>Placing ' + esc(sDef.name) + ' (' + fmtMoney(sCost) + ' · ⏱ ' + fmtDur(effT) + ')</b>' +
        '<small>Hold &amp; drag building to move it · 1 finger pans map · 2 fingers zoom (' + bDims.w + '×' + bDims.h + ' · ' + ROT_LABELS[bRot] + ')</small></div>' +
        '<button id="bpConfirmPlace" class="bp-ok-btn" aria-label="Place">✓ Place</button>' +
        '<button id="bpRotateObj" class="bp-rot-btn" aria-label="Rotate">🔄</button>' +
        '<button id="bpCancelPlace" class="bp-cancel-x" aria-label="Cancel">✕</button>' +
      '</div>';
    } else if (UI.moveObj && CAT_BY_ID[UI.moveObj.type]) {
      var mDef = CAT_BY_ID[UI.moveObj.type];
      var mUrl = objectIconURL(mDef.id);
      var mRot = ((UI.moveRot != null ? UI.moveRot : (UI.moveObj.rot || 0)) % 4 + 4) % 4;
      var mDims = typeof objDims === 'function' ? objDims(mDef, mRot) : { w: mDef.w, h: mDef.h };
      if (!UI.dragPos) UI.dragPos = { x: UI.moveObj.x, y: UI.moveObj.y };
      hMin = '<div class="bp-min-bar">' +
        '<div class="ic">' + (mUrl ? '<img src="' + mUrl + '">' : mDef.icon) + '</div>' +
        '<div class="tx"><b>↔️ Moving ' + esc(mDef.name) + ' (' + mDims.w + '×' + mDims.h + ' · ' + ROT_LABELS[mRot] + ')</b>' +
        '<small>Hold &amp; drag building to move it · 1 finger pans map · 2 fingers zoom</small></div>' +
        '<button id="bpConfirmPlace" class="bp-ok-btn" aria-label="Place">✓ Place</button>' +
        '<button id="bpRotateObj" class="bp-rot-btn" aria-label="Rotate">🔄</button>' +
        '<button id="bpCancelPlace" class="bp-cancel-x" aria-label="Cancel">✕</button>' +
      '</div>';
    } else if (UI.buildTool === 'move') {
      hMin = '<div class="bp-min-bar">' +
        '<div class="ic">↔️</div>' +
        '<div class="tx"><b>↔️ Move &amp; Rotate Mode</b>' +
        '<small>Hold any building to drag it · 1 finger pans map · 2 fingers zoom!</small></div>' +
        '<button id="bpCancelPlace" class="bp-cancel-x" aria-label="Cancel">✕</button>' +
      '</div>';
    } else if (UI.buildTool === 'upgrade') {
      hMin = '<div class="bp-min-bar">' +
        '<div class="ic">⬆️</div>' +
        '<div class="tx"><b>⬆️ Upgrade Mode</b>' +
        '<small>Tap any building on the lawn to upgrade its Level!</small></div>' +
        '<button id="bpCancelPlace" class="bp-cancel-x" aria-label="Cancel">✕</button>' +
      '</div>';
    } else if (UI.buildTool === 'sell') {
      hMin = '<div class="bp-min-bar">' +
        '<div class="ic">💸</div>' +
        '<div class="tx"><b>💸 Sell Mode</b>' +
        '<small>Tap any building on the lawn to sell it for cash!</small></div>' +
        '<button id="bpCancelPlace" class="bp-cancel-x" aria-label="Cancel">✕</button>' +
      '</div>';
    }
    $('buildpanel').innerHTML = hMin;
    UI.bpSig = buildSig();
    return;
  }
  var tabs = [['care', 'Care'], ['fun', 'Fun'], ['decor', 'Decor'], ['land', 'Land'], ['biz', 'Research & Staff']];
  var bBusy = typeof activeBuildCount === 'function' ? activeBuildCount() : 0;
  var bMax = typeof maxBuilders === 'function' ? maxBuilders() : 1;
  var bChip = '<small class="bp-builders' + (bBusy >= bMax ? ' full' : '') + '">👷 ' + bBusy + '/' + bMax + '</small>';
  var h = '<div class="bp-head"><span>🔨 Shop ' + bChip + '</span><button id="moveBtn" class="' + (UI.buildTool === 'move' ? 'on' : '') + '">↔️ Move</button><button id="upgBtn" class="' + (UI.buildTool === 'upgrade' ? 'on' : '') + '">⬆️ Upgrade</button><button id="sellBtn" class="' + (UI.buildTool === 'sell' ? 'on' : '') + '">💸 Sell</button><button id="bpClose">Done</button></div>' +
    '<div class="tabs">' + tabs.map(function (t) { return '<button data-tab="' + t[0] + '" class="' + (UI.buildTab === t[0] ? 'on' : '') + '">' + t[1] + '</button>'; }).join('') + '</div><div class="items">';
  if (UI.buildTab === 'land') {
    h += '<div class="bp-sub">Stand on the golden 🗺️ box at the yard border or tap below to expand!</div>';
    PLOTS.forEach(function (p) {
      if (!p.cost) return;
      var owned = plotOwned(p), pend = plotPending(p), locked = S.level < p.lvl;
      var far = !owned && !pend && !plotAdjacent(p);
      var unlTxt = (p.unlocks && p.unlocks.length) ? ' · Unlocks: ' + p.unlocks.join(', ') : '';
      h += '<div class="item' + (owned ? ' owned' : '') + (locked || far ? ' locked' : '') + (S.cash < p.cost && !owned && !locked ? ' poor' : '') + '" data-plot="' + p.id + '" style="grid-column:1/-1"><div class="ic">🗺️</div><div class="tx"><b>' + p.name + '</b><small>' + p.w + '×' + p.h + ' tiles · ⏱ ' + fmtDur(p.time) + unlTxt + (far && !locked ? ' · unlock neighbour first' : '') + '</small></div><div class="pr">' +
        (owned ? '✅' : pend ? '🚜 ' + fmtDur((pend.end - Date.now()) / 1000) : locked ? '🔒 Lv ' + p.lvl : fmtMoney(p.cost)) + '</div></div>';
    });
    var fTierL = typeof franchiseTier === 'function' ? franchiseTier() : 0;
    var fCostL = typeof franchiseCost === 'function' ? franchiseCost() : 750;
    var fReqL = typeof franchiseReqLvl === 'function' ? franchiseReqLvl() : 2;
    var fLockedL = S.level < fReqL;
    h += '<div class="bp-sub">🏆 Endless Franchise Certification — boost boarding pay, Hearts &amp; build speed forever!</div>';
    h += '<div class="item' + (fLockedL ? ' locked' : '') + (S.cash < fCostL && !fLockedL ? ' poor' : '') + '" data-franchise="1" style="grid-column:1/-1"><div class="ic">🏆</div><div class="tx"><b>' + esc(franchiseName(fTierL + 1)) + ' <span style="color:#8e6bd6">Tier ' + (fTierL + 1) + '</span></b><small>+15% Boarding Pay, +15% Paw Hearts, +10 Yard Charm &amp; +2m PAWSOME Build Boost (Current: ' + esc(franchiseName(fTierL)) + ')</small></div><div class="pr">' +
      (fLockedL ? '🔒 Lv ' + fReqL : '⬆️ ' + fmtMoney(fCostL)) + '</div></div>';
  } else if (UI.buildTab === 'biz') {
    h += '<div class="bp-sub">💛 Paw Heart Rewards (You have ' + (S.hearts || 0) + '💛 · earn from PAWSOME pickups, chores &amp; co-op!)</div>';
    if (typeof HEART_PERKS !== 'undefined') {
      HEART_PERKS.forEach(function (hp) {
        var poorH = (S.hearts || 0) < hp.hearts;
        h += '<div class="item' + (poorH ? ' poor' : '') + '" data-heartperk="' + hp.id + '" style="grid-column:1/-1"><div class="ic">' + hp.icon + '</div><div class="tx"><b>' + esc(hp.name) + '</b><small>' + esc(hp.desc) + '</small></div><div class="pr" style="color:' + (poorH ? '#d9574a' : '#c77d0a') + '">' + hp.hearts + '💛</div></div>';
      });
    }
    h += '<div class="bp-sub">⭐ Boost Star Rating (' + S.rep.toFixed(1) + '★ · ' + capacity() + ' Kennel slot' + (capacity() === 1 ? '' : 's') + ')</div>';
    h += '<div class="item' + (S.cash < 35 ? ' poor' : '') + '" data-repboost="social"><div class="ic">🍪</div><div class="tx"><b>Pup Cup Social</b><small>Instant +0.35★ Star Rating &amp; happy pups</small></div><div class="pr">$35</div></div>';
    h += '<div class="item' + (S.cash < 95 ? ' poor' : '') + '" data-repboost="ad"><div class="ic">📸</div><div class="tx"><b>Pet Magazine Ad</b><small>Instant +0.80★ Star Rating &amp; faster arrivals</small></div><div class="pr">$95</div></div>';
    var fTier = typeof franchiseTier === 'function' ? franchiseTier() : 0;
    var fCost = typeof franchiseCost === 'function' ? franchiseCost() : 750;
    var fReq = typeof franchiseReqLvl === 'function' ? franchiseReqLvl() : 2;
    var fLocked = S.level < fReq;
    h += '<div class="item' + (fLocked ? ' locked' : '') + (S.cash < fCost && !fLocked ? ' poor' : '') + '" data-franchise="1" style="grid-column:1/-1"><div class="ic">🏆</div><div class="tx"><b>' + esc(franchiseName(fTier + 1)) + ' <span style="color:#8e6bd6">Tier ' + (fTier + 1) + '</span></b><small>Endless Empire Rank: +15% Boarding Pay, +15% Paw Hearts, +10 Charm &amp; +2m PAWSOME Build Boost</small></div><div class="pr">' +
      (fLocked ? '🔒 Lv ' + fReq : '⬆️ ' + fmtMoney(fCost)) + '</div></div>';
    h += '<div class="bp-sub">Endless Research Perks — upgradeable forever!</div>';
    UPGRADES.forEach(function (u) {
      var curLv = upLvl(u.id), reqLv = upgReqLvl(u), cost = upgCost(u);
      var locked = S.level < reqLv, poor = S.cash < cost;
      h += '<div class="item' + (locked ? ' locked' : '') + (poor && !locked ? ' poor' : '') + '" data-upg="' + u.id + '" style="grid-column:1/-1"><div class="ic">' + u.icon + '</div><div class="tx"><b>' + u.name + (curLv ? ' <span style="color:#8e6bd6">Lv' + curLv + '</span>' : '') + '</b><small>' + u.desc + '</small></div><div class="pr">' +
        (locked ? '🔒 Lv' + reqLv : '⬆️ ' + fmtMoney(cost)) + '</div></div>';
    });
    h += '<div class="bp-sub">Staff — hire &amp; train infinitely (Lv 1 → Lv ∞) for faster speed &amp; bonus pay!</div>';
    STAFF.forEach(function (s) {
      var hired = staffHired(s.id), locked = S.level < s.lvl, sLv = hired ? staffLvl(s.id) : 0, tCost = hired ? staffTrainCost(s.id) : 0;
      h += '<div class="item' + (locked ? ' locked' : '') + (hired && S.cash < tCost ? ' poor' : '') + '" data-staff="' + s.id + '" style="grid-column:1/-1"><div class="ic">' + s.icon + '</div><div class="tx"><b>' + s.name + (hired ? ' <span style="color:#8e6bd6">Lv ' + sLv + '</span>' : '') + '</b><small>' + s.desc + (hired ? ' · Tap to Train Lv ' + (sLv + 1) + ' (+12% speed, +care bonus &amp; +15% offline pay)' : '') + '</small></div><div class="pr">' +
        (hired ? '⬆️ ' + fmtMoney(tCost) : locked ? '🔒 Lv ' + s.lvl : fmtMoney(s.wage) + '/d') + '</div></div>';
    });
  } else {
    var reqTutItem = (!S.tutorialDone && typeof tutorialRequiredBuildType === 'function') ? tutorialRequiredBuildType() : null;
    if (reqTutItem && CAT_BY_ID[reqTutItem]) {
      h += '<div class="bp-sub">🎓 Tutorial: Select <b>' + CAT_BY_ID[reqTutItem].icon + ' ' + esc(CAT_BY_ID[reqTutItem].name) + '</b> below to place it on the lawn!</div>';
    }
    CATALOG.filter(function (c) { return c.cat === UI.buildTab; }).forEach(function (c) {
      var cCost = typeof itemCost === 'function' ? itemCost(c.id) : c.cost;
      var cReq = typeof itemReqLvl === 'function' ? itemReqLvl(c.id) : c.lvl;
      var cTime = typeof itemBuildTime === 'function' ? itemBuildTime(c.id) : c.time;
      var locked = S.level < cReq, poor = S.cash < cCost, url = objectIconURL(c.id), isTut = reqTutItem === c.id;
      var kCount = (c.id === 'kennel' && typeof kennelCount === 'function') ? kennelCount(true) : 0;
      var lockLabel = (c.id === 'kennel' && !S.tutorialDone && kCount >= 1) ? '🔒 Tut' : ('🔒 Lv' + cReq);
      var titleSuffix = c.id === 'kennel' ? (' <small style="color:#58b368">(#' + (kCount + 1) + ' → ' + (kCount + 1) + ' Dog' + (kCount + 1 > 1 ? 's' : '') + ')</small>') : '';
      h += '<div class="item' + (UI.buildSel === c.id ? ' sel' : '') + (locked ? ' locked' : '') + (poor && !locked ? ' poor' : '') + '" data-item="' + c.id + '"' + (isTut ? ' style="box-shadow:0 0 0 3px #ffe66d"' : '') + '>' +
        '<div class="ic">' + (url ? '<img src="' + url + '">' : c.icon) + '</div><div class="tx"><b>' + c.name + titleSuffix + (isTut ? ' <span style="color:#d9574a">🎓 Place Now</span>' : '') + '</b><small>⏱ ' + fmtDur(cTime) + (c.charm >= 1 ? ' · 🌸+' + c.charm : '') + (c.cap ? ' · 🐕+' + c.cap + ' allowed' : '') + '</small></div>' +
        '<div class="pr">' + (locked ? lockLabel : fmtMoney(cCost)) + '</div></div>';
    });
  }
  h += '</div><div class="bp-tools"><span class="small" id="bpDesc"></span></div>';
  var scroll = $('buildpanel').querySelector('.items'), st = scroll ? scroll.scrollTop : 0;
  $('buildpanel').innerHTML = h;
  var ns = $('buildpanel').querySelector('.items'); if (ns) ns.scrollTop = st;
  bpShowDesc('');
  UI.bpSig = buildSig();
}
var BP_HELP = '1 finger drags map · 2 fingers zoom · Hold any building to move it, or tap to Upgrade / Sell.';
function bpShowDesc(txt) {
  var el = $('bpDesc');
  if (el) el.textContent = txt || (UI.buildTool === 'move' ? (UI.moveObj ? 'Moving ' + CAT_BY_ID[UI.moveObj.type].name + ' — tap any open green spot in the yard to place it!' : 'Move mode: tap any building or item in the yard to relocate it for free.') : UI.buildTool === 'sell' ? 'Sell mode: tap a building in the yard to sell it.' : UI.buildTool === 'upgrade' ? 'Upgrade mode: tap any building in the yard to level it up!' : UI.buildSel ? 'Tap any green tile in the yard to build ' + CAT_BY_ID[UI.buildSel].name + ' (⏱ ' + fmtDur(typeof itemBuildTime === 'function' ? itemBuildTime(UI.buildSel) : CAT_BY_ID[UI.buildSel].time) + ')' : BP_HELP);
}
(function () {
  var bp = $('buildpanel');
  var SHOP_SEL = '#bpClose,#bpCancelPlace,#bpConfirmPlace,#bpRotateObj,#moveBtn,#sellBtn,#upgBtn,[data-tab],[data-item],[data-plot],[data-upg],[data-staff],[data-repboost],[data-franchise],[data-heartperk]';
  var tapState = null;
  var lastHandledAt = 0;

  function handleShopAction(t) {
    if (!t) return;
    initAudio();
    if (t.id === 'bpClose') { setMode('play'); sfx('ui_close'); return; }
    if (t.id === 'bpConfirmPlace') {
      confirmDraggedBuildOrMove();
      return;
    }
    if (t.id === 'bpRotateObj') {
      if (UI.buildSel) {
        UI.buildRot = ((UI.buildRot || 0) + 1) % 4;
        if (UI.dragPos) {
          var rDims = typeof objDims === 'function' ? objDims(UI.buildSel, UI.buildRot) : { w: 1, h: 1 };
          UI.dragPos.x = clamp(UI.dragPos.x, MAP.yard.x0, MAP.yard.x1 - rDims.w + 1);
          UI.dragPos.y = clamp(UI.dragPos.y, MAP.yard.y0, MAP.yard.y1 - rDims.h + 1);
        }
        sfx('click');
        renderBuildPanel();
      } else if (UI.moveObj) {
        UI.moveRot = (((UI.moveRot != null ? UI.moveRot : (UI.moveObj.rot || 0)) + 1) % 4);
        var mPos = UI.dragPos || { x: UI.moveObj.x, y: UI.moveObj.y };
        var mrDims = typeof objDims === 'function' ? objDims(UI.moveObj.type, UI.moveRot) : { w: UI.moveObj.w, h: UI.moveObj.h };
        mPos.x = clamp(mPos.x, MAP.yard.x0, MAP.yard.x1 - mrDims.w + 1);
        mPos.y = clamp(mPos.y, MAP.yard.y0, MAP.yard.y1 - mrDims.h + 1);
        UI.dragPos = mPos;
        if (typeof canMoveObject === 'function' && canMoveObject(UI.moveObj, mPos.x, mPos.y, UI.moveRot)) {
          moveObject(UI.moveObj, mPos.x, mPos.y, UI.moveRot);
        } else {
          sfx('click');
        }
        renderBuildPanel();
      }
      return;
    }
    if (t.id === 'bpCancelPlace') {
      UI.buildSel = null; UI.moveObj = null; UI.buildTool = null; UI.dragPos = null;
      UI.buildRot = 0; UI.moveRot = 0;
      sfx('ui_close');
      renderBuildPanel();
      return;
    }
    if (t.hasAttribute('data-repboost')) { runRepCampaign(t.getAttribute('data-repboost')); renderBuildPanel(); return; }
    if (t.hasAttribute('data-heartperk')) { if (typeof buyHeartPerk === 'function') buyHeartPerk(t.getAttribute('data-heartperk')); renderBuildPanel(); return; }
    if (t.hasAttribute('data-franchise')) { buyFranchiseTier(); renderBuildPanel(); return; }
    if (t.id === 'moveBtn') { UI.buildTool = UI.buildTool === 'move' ? null : 'move'; UI.buildSel = null; UI.moveObj = null; UI.dragPos = null; renderBuildPanel(); sfx('click'); return; }
    if (t.id === 'sellBtn') { UI.buildTool = UI.buildTool === 'sell' ? null : 'sell'; UI.buildSel = null; UI.moveObj = null; UI.dragPos = null; renderBuildPanel(); sfx('click'); return; }
    if (t.id === 'upgBtn') { UI.buildTool = UI.buildTool === 'upgrade' ? null : 'upgrade'; UI.buildSel = null; UI.moveObj = null; UI.dragPos = null; renderBuildPanel(); sfx('click'); return; }
    if (t.hasAttribute('data-tab')) { UI.buildTab = t.getAttribute('data-tab'); UI.buildSel = null; UI.moveObj = null; UI.dragPos = null; sfx('click'); renderBuildPanel(); var it = bp.querySelector('.items'); if (it) it.scrollTop = 0; return; }
    if (t.hasAttribute('data-item')) {
      var id = t.getAttribute('data-item'), c = CAT_BY_ID[id];
      var reqL = typeof itemReqLvl === 'function' ? itemReqLvl(id) : c.lvl;
      if (S.level < reqL) {
        if (id === 'kennel' && !S.tutorialDone) toast('🎓 Finish the onboarding tutorial first before building a 2nd Kennel!', 'bad');
        else toast('🔒 Reach Daycare Level ' + reqL + ' to build another ' + c.name, 'bad');
        sfx('error'); return;
      }
      if (typeof canStartNewBuild === 'function' && !canStartNewBuild()) {
        warnBuilderBusy();
        return;
      }
      UI.buildSel = UI.buildSel === id ? null : id; UI.buildRot = 0; UI.buildTool = null; UI.moveObj = null;
      UI.dragPos = (UI.buildSel && typeof defaultBuildSpot === 'function') ? defaultBuildSpot(UI.buildSel, 0) : null;
      sfx('click'); renderBuildPanel(); return;
    }
    if (t.hasAttribute('data-staff')) {
      var sid = t.getAttribute('data-staff'), sd = STAFF_BY_ID[sid];
      if (staffHired(sid)) {
        var curSLv = staffLvl(sid), trCost = staffTrainCost(sid);
        UI.actionStaff = sid;
        openModal('<h2>' + sd.icon + ' ' + esc(sd.name) + ' <small>Lv ' + curSLv + '</small></h2>' +
          '<p style="text-align:center">' + esc(sd.desc) + '<br><small>Current bonuses: +' + ((curSLv - 1) * 12) + '% walk speed · +' + ((curSLv - 1) * 4) + ' care happiness · +' + ((curSLv - 1) * 15) + '% offline shift pay</small></p>' +
          '<div class="row col">' +
          '<button data-act="trainstaff" class="primary">⬆️ Train to Lv ' + (curSLv + 1) + ' (' + fmtMoney(trCost) + ')</button>' +
          '<button data-act="firestaff" class="flat">Let ' + esc(sd.name) + ' Go (' + fmtMoney(sd.wage) + '/d)</button>' +
          '<button data-act="back" class="flat">Cancel</button>' +
          '</div>', 'confirm', 'narrow');
        bindModalButtons();
      } else if (S.level < sd.lvl) { toast('🔒 Reach level ' + sd.lvl + ' to hire a ' + sd.name, 'bad'); sfx('error'); }
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
  }

  var lastScrollAt = 0;

  function shopTargetKey(el) {
    if (!el) return '';
    if (el.id) return '#' + el.id;
    var attrs = ['data-tab', 'data-item', 'data-plot', 'data-upg', 'data-staff', 'data-repboost', 'data-franchise', 'data-heartperk'];
    for (var i = 0; i < attrs.length; i++) {
      if (el.hasAttribute && el.hasAttribute(attrs[i])) return attrs[i] + ':' + el.getAttribute(attrs[i]);
    }
    return '';
  }

  bp.addEventListener('scroll', function () {
    lastScrollAt = Date.now();
    if (tapState) tapState.moved = true;
    UI.shopTouching = false;
  }, true);

  bp.addEventListener('pointerdown', function (ev) {
    if (!ev.target || !ev.target.closest) return;
    var t = ev.target.closest(SHOP_SEL);
    if (!t) { tapState = null; return; }
    var scEl = bp.querySelector('.items');
    UI.shopTouching = true;
    tapState = {
      id: ev.pointerId,
      target: t,
      key: shopTargetKey(t),
      x0: ev.clientX,
      y0: ev.clientY,
      scroll0: scEl ? scEl.scrollTop : 0,
      moved: false
    };
  });

  bp.addEventListener('pointermove', function (ev) {
    if (!tapState || (ev.pointerId != null && tapState.id != null && ev.pointerId !== tapState.id)) return;
    var dx = ev.clientX - tapState.x0, dy = ev.clientY - tapState.y0;
    var scEl = bp.querySelector('.items');
    var dScroll = scEl ? Math.abs(scEl.scrollTop - tapState.scroll0) : 0;
    if (Math.sqrt(dx * dx + dy * dy) > 10 || dScroll > 3) {
      tapState.moved = true;
    }
  });

  bp.addEventListener('pointercancel', function () {
    tapState = null;
    UI.shopTouching = false;
  });

  bp.addEventListener('pointerup', function (ev) {
    UI.shopTouching = false;
    if (!tapState) return;
    var st = tapState;
    tapState = null;
    if (ev.pointerId != null && st.id != null && ev.pointerId !== st.id) return;
    var scEl = bp.querySelector('.items');
    var dScroll = scEl ? Math.abs(scEl.scrollTop - st.scroll0) : 0;
    var dx = ev.clientX - st.x0, dy = ev.clientY - st.y0;
    if (st.moved || Math.sqrt(dx * dx + dy * dy) > 10 || dScroll > 3 || Date.now() - lastScrollAt < 160) return;
    var upTarget = (ev.target && ev.target.closest) ? ev.target.closest(SHOP_SEL) : st.target;
    if (!upTarget) return;
    if (upTarget !== st.target && shopTargetKey(upTarget) !== st.key) return;
    lastHandledAt = Date.now();
    handleShopAction(upTarget);
  });

  bp.addEventListener('click', function (ev) {
    if (Date.now() - lastHandledAt < 450 || Date.now() - lastScrollAt < 220) return;
    if (!ev.target || !ev.target.closest) return;
    var t = ev.target.closest(SHOP_SEL);
    if (!t) return;
    handleShopAction(t);
  });
})();
function buildSig() {
  var pend = UI.buildTab === 'land' && S.plots.some(function (p) { return Date.now() < p.end + 1000; });
  var stSig = STAFF.map(function (s) { return staffLvl(s.id) + ':' + (S.cash >= staffTrainCost(s.id) ? 1 : 0); }).join(',');
  var catSig = CATALOG.map(function (c) { var cost = typeof itemCost === 'function' ? itemCost(c.id) : c.cost; return (S.cash >= cost ? 1 : 0); }).join('');
  var bCnt = typeof activeBuildCount === 'function' ? activeBuildCount() : 0;
  var bMax = typeof maxBuilders === 'function' ? maxBuilders() : 1;
  return catSig + ':' + (typeof kennelCount === 'function' ? kennelCount(true) : 0) + '|' + PLOTS.map(function (p) { return S.cash >= p.cost ? 1 : 0; }).join('') + UPGRADES.map(function (u) { return upLvl(u.id) + ':' + (S.cash >= upgCost(u) ? 1 : 0); }).join(',') + '|' + stSig + '|' + franchiseTier() + ':' + (S.cash >= franchiseCost() ? 1 : 0) + '|' + S.level + '|' + S.plots.length + '|' + (S.hearts || 0) + '|' + bCnt + '/' + bMax + '|' + (pend ? Math.floor(Date.now() / 1000) : '');
}
function tryBuyPlot(p) {
  if (plotOwned(p)) return;
  var pend = plotPending(p);
  if (pend) {
    if (typeof canLendAPaw === 'function' && canLendAPaw(pend)) {
      lendAPaw(pend);
      renderBuildPanel();
    }
    return;
  }
  if (typeof canStartNewBuild === 'function' && !canStartNewBuild()) { warnBuilderBusy(); return; }
  if (S.level < p.lvl) { toast('🔒 Reach level ' + p.lvl + ' to expand ' + p.name, 'bad'); sfx('error'); return; }
  if (!plotAdjacent(p)) { toast(p.name + ' does not touch your land yet — unlock a neighbouring plot first', 'bad'); sfx('error'); return; }
  if (S.cash < p.cost) { toast('Not enough cash for ' + p.name + ' (' + fmtMoney(p.cost) + ')', 'bad'); sfx('error'); return; }
  var unlHtml = (p.unlocks && p.unlocks.length) ? '<br><small>🎁 Unlocks in this area: <b>' + p.unlocks.join(' · ') + '</b></small>' : '';
  confirmBox('Expand into <b>' + p.name + '</b> for ' + fmtMoney(p.cost) + '?<br><small>⏱ Clearing takes ' + fmtDur(p.time) + ' in real time (PAWSOME pickups, Goals &amp; Partner Lend-a-Paw shave time!).</small>' + unlHtml, function () { buyPlot(p); renderBuildPanel(); });
}
function promptObjectActions(o) {
  var c = CAT_BY_ID[o.type], lv = o.lvl || 1, nextLv = lv + 1, cost = objUpgradeCost(o), req = objUpgradeReqLvl(o);
  UI.actionObj = o;
  var dispName = (o.type === 'kennel' && typeof kennelSuiteName === 'function') ? kennelSuiteName(lv) : c.name;
  var upgLabel = o.upgrading
    ? ('⬆️ Upgrading to Lv ' + nextLv + ' (' + fmtDur(siteTimeLeft(o)) + ') — Boost!')
    : S.level < req
      ? ('⬆️ Upgrade to ' + (o.type === 'kennel' ? kennelSuiteName(nextLv) : 'Lv ' + nextLv) + ' (🔒 Lv ' + req + ')')
      : ('⬆️ Upgrade to ' + (o.type === 'kennel' ? kennelSuiteName(nextLv) : 'Lv ' + nextLv) + ' (' + fmtMoney(cost) + ')');
  var ribBtn = o.readyRibbon ? '<button data-act="cutrib" class="primary">🎀 Cut Grand Opening Ribbon (+3💛)</button>' : '';
  var sellBtn = canSell(o) ? '<button data-act="sellobj" class="flat">💸 Sell (' + fmtMoney(sellValue(o)) + ')</button>' : '';
  var extraNote = o.type === 'kennel'
    ? ('<br><small style="color:#8a5a12"><b>Luxury Suite Lv ' + lv + ':</b> +' + ((lv - 1) * 8) + '% boarding pay · +' + ((lv - 1) * 12) + '% overnight pay · +' + Math.round((lv - 1) * 2.5 * 10) / 10 + ' Charm</small>')
    : '';
  openModal('<h2>' + c.icon + ' ' + esc(dispName) + ' <small>Lv ' + lv + '</small></h2>' +
    '<p style="text-align:center">' + esc(c.desc) + extraNote + '</p>' +
    '<div class="row col">' +
    ribBtn +
    '<button data-act="moveobj" class="primary">↔️ Move to Another Spot</button>' +
    '<button data-act="rotobj" class="wood">🔄 Rotate 90° (' + ROT_LABELS[((o.rot || 0) + 1) % 4] + ')</button>' +
    '<button data-act="upgobj">' + upgLabel + '</button>' +
    sellBtn +
    '<button data-act="back" class="flat">Cancel</button>' +
    '</div>', 'confirm', 'narrow');
  bindModalButtons();
}
function promptRushSite(o) {
  var c = CAT_BY_ID[o.type], cName = c ? c.name : o.type;
  var what = o.upgrading
    ? (o.type === 'kennel' ? kennelSuiteName((o.lvl || 1) + 1) : (cName + ' Lv ' + ((o.lvl || 1) + 1) + ' upgrade'))
    : cName;
  var left = typeof siteTimeLeft === 'function' ? siteTimeLeft(o) : Math.max(0, (o.buildEnd - Date.now()) / 1000);
  var cashCost = rushCost(o), hCost = typeof heartBoostCost === 'function' ? heartBoostCost() : 5;
  var canPaw = typeof canLendAPaw === 'function' && canLendAPaw(o);
  UI.actionObj = o;
  var pawBtn = canPaw ? '<button data-act="lendpaw" class="primary">🤝 Lend a Paw to ' + esc(o.startedByName || 'Partner') + ' (Free · +3💛)</button>' : '';
  var heartBtn = '<button data-act="boostsite" class="wood">💛 Speed Up -30m (' + hCost + '💛 · You have ' + (S.hearts || 0) + '💛)</button>';
  var rushBtn = '<button data-act="rushsite" class="primary">⚡ Finish Now (' + fmtMoney(cashCost) + ')</button>';
  openModal('<h2>' + (c ? c.icon : '🔨') + ' ' + esc(what) + '</h2>' +
    '<p style="text-align:center">⏱ <b>' + fmtDur(left) + '</b> remaining.<br><small>PAWSOME pickups (-10m+), Goals (-5m/-30m), Spot Events (-15m) &amp; Partner Lend-a-Paw also speed this up!</small></p>' +
    '<div class="row col">' + pawBtn + heartBtn + rushBtn + '<button data-act="back" class="flat">Keep Waiting</button></div>', 'confirm', 'narrow');
  bindModalButtons();
}
function promptUpgradeObject(o) {
  if (o.upgrading) { promptRushSite(o); return; }
  if (typeof canStartNewBuild === 'function' && !canStartNewBuild()) { warnBuilderBusy(); return; }
  var c = CAT_BY_ID[o.type], nextLv = (o.lvl || 1) + 1, req = objUpgradeReqLvl(o), cost = objUpgradeCost(o), dur = objUpgradeTime(o);
  var targetName = (o.type === 'kennel' && typeof kennelSuiteName === 'function') ? kennelSuiteName(nextLv) : (c.name + ' Lv ' + nextLv);
  if (S.level < req) { toast('🔒 Reach Daycare Level ' + req + ' to upgrade to ' + targetName, 'bad'); sfx('error'); return; }
  if (S.cash < cost) { toast('Not enough cash for ' + targetName + ' (' + fmtMoney(cost) + ')', 'bad'); sfx('error'); return; }
  var perkTxt = o.type === 'kennel'
    ? ('+8% boarding pay, +12% overnight pay, happier wake-ups, +12% VIP odds & +2.5 Charm (1 Kennel = 1 Dog)')
    : c.charm
      ? ('+' + Math.round(c.charm * 0.6 * 10) / 10 + ' extra Charm')
      : '+Care bonus, faster action & +1.5 Charm';
  confirmBox('Upgrade <b>' + esc(c.name) + '</b> to <b>' + esc(targetName) + '</b> for ' + fmtMoney(cost) + '?<br><small>⏱ Takes ' + fmtDur(dur) + ' (stays 100% usable while upgrading!) · ' + perkTxt + '</small>', function () {
    upgradeObject(o); renderBuildPanel();
  });
}
function updateDragPosFromScreen(clientX, clientY) {
  if (!S) return;
  var mw = screenToWorld(clientX, clientY), tx = tileOf(mw.x), ty = tileOf(mw.y);
  if (UI.buildSel && CAT_BY_ID[UI.buildSel]) {
    var bDims = typeof objDims === 'function' ? objDims(UI.buildSel, UI.buildRot || 0) : CAT_BY_ID[UI.buildSel];
    var bb = typeof ownedYardBounds === 'function' ? ownedYardBounds(bDims.w, bDims.h) : { minX: MAP.yard.x0, maxX: MAP.yard.x1 - bDims.w + 1, minY: MAP.yard.y0, maxY: MAP.yard.y1 - bDims.h + 1 };
    UI.dragPos = {
      x: clamp(tx - Math.floor((bDims.w - 1) / 2), bb.minX, bb.maxX),
      y: clamp(ty - Math.floor((bDims.h - 1) / 2), bb.minY, bb.maxY)
    };
  } else if (UI.moveObj && CAT_BY_ID[UI.moveObj.type]) {
    var mRot = UI.moveRot != null ? UI.moveRot : (UI.moveObj.rot || 0);
    var mDims = typeof objDims === 'function' ? objDims(UI.moveObj.type, mRot) : UI.moveObj;
    var mb = typeof ownedYardBounds === 'function' ? ownedYardBounds(mDims.w, mDims.h) : { minX: MAP.yard.x0, maxX: MAP.yard.x1 - mDims.w + 1, minY: MAP.yard.y0, maxY: MAP.yard.y1 - mDims.h + 1 };
    UI.dragPos = {
      x: clamp(tx - Math.floor((mDims.w - 1) / 2), mb.minX, mb.maxX),
      y: clamp(ty - Math.floor((mDims.h - 1) / 2), mb.minY, mb.maxY)
    };
  }
}

function confirmDraggedBuildOrMove() {
  if (UI.mode !== 'build' || !S) return false;
  if (UI.moveObj) {
    var mo = UI.moveObj, mDef = CAT_BY_ID[mo.type];
    var mRot = UI.moveRot != null ? UI.moveRot : (mo.rot || 0);
    var mDims = typeof objDims === 'function' ? objDims(mDef, mRot) : { w: mDef.w, h: mDef.h, rot: mRot };
    var mx = UI.dragPos ? UI.dragPos.x : mo.x, my = UI.dragPos ? UI.dragPos.y : mo.y;
    if (canMoveObject(mo, mx, my, mDims.rot)) {
      moveObject(mo, mx, my, mDims.rot);
      UI.moveObj = null;
      UI.moveRot = 0;
      UI.dragPos = null;
      if (UI.autoMoveTool) {
        UI.buildTool = null;
        UI.autoMoveTool = false;
      }
      renderBuildPanel();
      return true;
    }
    toast('Drag ' + mDef.name + ' onto an open green spot on the lawn', 'bad'); sfx('error');
    return false;
  }
  if (UI.buildSel) {
    var def = CAT_BY_ID[UI.buildSel];
    var bRot = UI.buildRot || 0;
    var bDims = typeof objDims === 'function' ? objDims(def, bRot) : { w: def.w, h: def.h, rot: bRot };
    if (!UI.dragPos && typeof defaultBuildSpot === 'function') UI.dragPos = defaultBuildSpot(UI.buildSel, bRot);
    var x = UI.dragPos ? UI.dragPos.x : 24, y = UI.dragPos ? UI.dragPos.y : 24;
    var bCost = typeof itemCost === 'function' ? itemCost(UI.buildSel) : def.cost;
    var bReq = typeof itemReqLvl === 'function' ? itemReqLvl(UI.buildSel) : def.lvl;
    if (S.level < bReq) { toast('🔒 Reach Level ' + bReq + ' to build another ' + def.name, 'bad'); sfx('error'); return false; }
    if (typeof canStartNewBuild === 'function' && !canStartNewBuild()) { warnBuilderBusy(); return false; }
    if (S.cash < bCost) { toast('Not enough cash for a ' + def.name + ' (' + fmtMoney(bCost) + ')', 'bad'); sfx('error'); return false; }
    if (!canPlace(UI.buildSel, x, y, bDims.rot)) { toast('Drag ' + def.name + ' onto an open green spot on the lawn', 'bad'); sfx('error'); return false; }
    if (!placeBuild(UI.buildSel, x, y, bDims.rot)) return false;
    UI.buildSel = null;
    UI.buildRot = 0;
    UI.dragPos = null;
    if (!S.tutorialDone) {
      setMode('play');
      return true;
    }
    renderBuildPanel();
    return true;
  }
  return false;
}

function handleBuildTap(clientX, clientY) {
  if (UI.mode !== 'build' || !S) return;
  var mw = screenToWorld(clientX, clientY), tx = tileOf(mw.x), ty = tileOf(mw.y);
  var site = objAt(tx, ty);
  if (UI.moveObj) {
    updateDragPosFromScreen(clientX, clientY);
    confirmDraggedBuildOrMove();
    return;
  }
  if (UI.buildTool === 'move') {
    if (site) {
      if ((site.type === 'tub' || site.type === 'groomhouse') && site.dogId) { toast('Wait for the bath to finish before moving ' + CAT_BY_ID[site.type].name, 'bad'); sfx('error'); return; }
      UI.moveObj = site; UI.moveRot = site.rot || 0; UI.dragPos = { x: site.x, y: site.y }; sfx('click'); renderBuildPanel();
      toast('↔️ Drag ' + CAT_BY_ID[site.type].name + ' anywhere on the lawn (or tap 🔄 Rotate)!', '');
    } else {
      toast('Touch & drag any building on the lawn to move or rotate it', '');
    }
    return;
  }
  if (UI.buildSel && !(site && !site.done) && UI.buildTool !== 'upgrade' && UI.buildTool !== 'sell') {
    updateDragPosFromScreen(clientX, clientY);
    confirmDraggedBuildOrMove();
    return;
  }
  var o = site;
  if (o && UI.buildTool === 'sell') {
    if (!canSell(o)) { toast(isLastEssential(o) ? 'You need at least one ' + CAT_BY_ID[o.type].name : 'A dog is using that right now', 'bad'); sfx('error'); return; }
    confirmBox('Sell the ' + CAT_BY_ID[o.type].name + ' (Lv ' + (o.lvl || 1) + ') for ' + fmtMoney(sellValue(o)) + '?', function () { sellObject(o); renderBuildPanel(); });
    return;
  }
  if (o && o.readyRibbon && !UI.buildTool) {
    cutRibbon(o);
    renderBuildPanel();
    return;
  }
  if (o && (!o.done || o.upgrading) && UI.buildTool !== 'move' && UI.buildTool !== 'sell') {
    promptRushSite(o);
    return;
  }
  if (o && o.done) {
    if (UI.buildTool === 'upgrade') promptUpgradeObject(o);
    else promptObjectActions(o);
    return;
  }
  var p = plotAt(tx, ty);
  if (p && !plotOwned(p)) tryBuyPlot(p);
}

// ---------------- iPhone Touch & My Mini Mart Dynamic Virtual Joystick ----------------
function _touchDist(a, b) { var dx = a.clientX - b.clientX, dy = a.clientY - b.clientY; return Math.sqrt(dx * dx + dy * dy); }

function _touchHitsActiveBuilding(clientX, clientY) {
  if (!S || (!UI.buildSel && !UI.moveObj)) return false;
  var mw = screenToWorld(clientX, clientY), wx = mw.x / TILE, wy = mw.y / TILE;
  var type = UI.moveObj ? UI.moveObj.type : UI.buildSel;
  var rot = UI.moveObj ? (UI.moveRot != null ? UI.moveRot : (UI.moveObj.rot || 0)) : (UI.buildRot || 0);
  var dims = typeof objDims === 'function' ? objDims(type, rot) : (CAT_BY_ID[type] || { w: 1, h: 1 });
  var pos = UI.dragPos || (UI.moveObj ? { x: UI.moveObj.x, y: UI.moveObj.y } : (typeof defaultBuildSpot === 'function' ? defaultBuildSpot(type, rot) : { x: 24, y: 24 }));
  var pad = 1.15;
  return wx >= pos.x - pad && wx <= pos.x + dims.w + pad && wy >= pos.y - pad && wy <= pos.y + dims.h + pad;
}

function _clearBuildHoldTimer() {
  if (UI.touchBuild && UI.touchBuild.holdTimer) {
    clearTimeout(UI.touchBuild.holdTimer);
    UI.touchBuild.holdTimer = null;
  }
}

function _startPointerOrTouch(id, clientX, clientY) {
  initAudio();
  if (UI.mode === 'play') {
    UI.joy = { id: id, ox: clientX, oy: clientY, cx: clientX, cy: clientY, dx: 0, dy: 0, active: false, moved: false, t0: performance.now() };
  } else if (UI.mode === 'build') {
    _clearBuildHoldTimer();
    UI.mouse.sx = clientX; UI.mouse.sy = clientY; UI.mouse.in = true;
    var startSite = null;
    if (S) {
      var mw0 = screenToWorld(clientX, clientY);
      startSite = objAt(tileOf(mw0.x), tileOf(mw0.y));
    }
    var draggingBuilding = false;
    var freshlyGrabbed = false;
    // In Move mode, touching a building immediately grabs it so you can drag only the building
    if (UI.buildTool === 'move' && !UI.moveObj && startSite) {
      if ((startSite.type === 'tub' || startSite.type === 'groomhouse') && startSite.dogId) {
        toast('Wait for the bath to finish before moving ' + CAT_BY_ID[startSite.type].name, 'bad'); sfx('error');
      } else {
        UI.moveObj = startSite; UI.moveRot = startSite.rot || 0; UI.dragPos = { x: startSite.x, y: startSite.y };
        draggingBuilding = true; freshlyGrabbed = true;
        sfx('click'); renderBuildPanel();
      }
    } else if ((UI.buildSel || UI.moveObj) && _touchHitsActiveBuilding(clientX, clientY)) {
      draggingBuilding = true;
      updateDragPosFromScreen(clientX, clientY);
    }
    var tb = {
      id: id, ox: clientX, oy: clientY, lx: clientX, ly: clientY,
      moved: false, pannedMap: false, grabbedSite: startSite,
      draggingBuilding: draggingBuilding, freshlyGrabbed: freshlyGrabbed, holdTimer: null
    };
    UI.touchBuild = tb;
    // Holding a building (without panning the map) grabs that building and moves ONLY the building!
    if (!draggingBuilding && (startSite || UI.buildSel || UI.moveObj) && UI.buildTool !== 'sell' && UI.buildTool !== 'upgrade') {
      tb.holdTimer = setTimeout(function () {
        if (!UI.touchBuild || UI.touchBuild !== tb || tb.pannedMap || UI.mode !== 'build') return;
        tb.holdTimer = null;
        if (startSite && !UI.buildSel && !UI.moveObj) {
          if ((startSite.type === 'tub' || startSite.type === 'groomhouse') && startSite.dogId) {
            toast('Wait for the bath to finish before moving ' + CAT_BY_ID[startSite.type].name, 'bad'); sfx('error');
            return;
          }
          UI.autoMoveTool = !UI.buildTool;
          UI.buildTool = 'move';
          UI.moveObj = startSite;
          UI.moveRot = startSite.rot || 0;
          UI.dragPos = { x: startSite.x, y: startSite.y };
          tb.draggingBuilding = true;
          tb.freshlyGrabbed = true;
          sfx('click');
          renderBuildPanel();
          toast('↔️ Holding ' + CAT_BY_ID[startSite.type].name + ' — drag to move!', '');
        } else if (UI.buildSel || UI.moveObj) {
          tb.draggingBuilding = true;
          updateDragPosFromScreen(tb.lx, tb.ly);
          sfx('click');
        }
      }, 210);
    }
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
    var tb = UI.touchBuild;
    UI.mouse.sx = clientX; UI.mouse.sy = clientY; UI.mouse.in = true;
    var bdx = clientX - tb.ox, bdy = clientY - tb.oy;
    var stepDx = clientX - tb.lx, stepDy = clientY - tb.ly;
    if (Math.sqrt(bdx * bdx + bdy * bdy) > 8) tb.moved = true;
    if (tb.draggingBuilding) {
      // Holding/dragging a building: ONLY move the building while the map stays 100% stationary!
      if (UI.buildSel || UI.moveObj) {
        updateDragPosFromScreen(clientX, clientY);
      }
    } else if (tb.moved) {
      // One-finger drag on the map (when not holding a building): pan the camera around the yard!
      _clearBuildHoldTimer();
      tb.pannedMap = true;
      var z = Math.max(0.2, CAM.zoom || 1);
      var maxPanX = W * TILE * 0.48, maxPanY = H * TILE * 0.48;
      CAM.panX = clamp((CAM.panX || 0) - stepDx / z, -maxPanX, maxPanX);
      CAM.panY = clamp((CAM.panY || 0) - stepDy / z, -maxPanY, maxPanY);
    }
    tb.lx = clientX; tb.ly = clientY;
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
    var tb = UI.touchBuild;
    _clearBuildHoldTimer();
    if (UI.mode === 'build') {
      UI.mouse.sx = clientX; UI.mouse.sy = clientY; UI.mouse.in = true;
      if (tb.draggingBuilding && (UI.buildSel || UI.moveObj)) {
        updateDragPosFromScreen(clientX, clientY);
        if (tb.moved || !tb.freshlyGrabbed) {
          confirmDraggedBuildOrMove();
        }
      } else if (!tb.moved && !tb.pannedMap) {
        handleBuildTap(clientX, clientY);
      }
    }
    UI.touchBuild = null;
  }
}

canvas.addEventListener('touchstart', function (ev) {
  if (UI.mode !== 'play' && UI.mode !== 'build') return;
  ev.preventDefault();
  if (ev.touches.length >= 2) {
    _clearBuildHoldTimer();
    UI.joy = null; UI.touchBuild = null;
    var t0 = ev.touches[0], t1 = ev.touches[1];
    var zStart = UI.mode === 'build' ? (CAM.buildZoom || 1) : (settings.zoom || 1);
    UI.pinch = { d0: Math.max(10, _touchDist(t0, t1)), z0: zStart, mx: (t0.clientX + t1.clientX) / 2, my: (t0.clientY + t1.clientY) / 2 };
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
    var ratio = d / UI.pinch.d0;
    var mx = (t0.clientX + t1.clientX) / 2, my = (t0.clientY + t1.clientY) / 2;
    if (UI.mode === 'build') {
      CAM.buildZoom = clamp(Math.round(UI.pinch.z0 * ratio * 100) / 100, 0.42, 2.0);
      var z = Math.max(0.2, CAM.zoom || 1);
      var maxPanX = W * TILE * 0.48, maxPanY = H * TILE * 0.48;
      CAM.panX = clamp((CAM.panX || 0) - (mx - UI.pinch.mx) / z, -maxPanX, maxPanX);
      CAM.panY = clamp((CAM.panY || 0) - (my - UI.pinch.my) / z, -maxPanY, maxPanY);
    } else {
      settings.zoom = clamp(Math.round(UI.pinch.z0 * ratio * 20) / 20, 0.5, 1.5);
      clearTimeout(UI.zoomSave); UI.zoomSave = setTimeout(saveSettings, 600);
    }
    UI.pinch.mx = mx; UI.pinch.my = my;
    return;
  }
  for (var i = 0; i < ev.touches.length; i++) {
    var t = ev.touches[i];
    _movePointerOrTouch(t.identifier, t.clientX, t.clientY);
  }
}, { passive: false });

canvas.addEventListener('wheel', function (ev) {
  if (UI.mode !== 'play' && UI.mode !== 'build') return;
  ev.preventDefault();
  var factor = ev.deltaY < 0 ? 1.1 : 0.9;
  if (UI.mode === 'build') {
    CAM.buildZoom = clamp(Math.round((CAM.buildZoom || 1) * factor * 100) / 100, 0.42, 2.0);
  } else {
    settings.zoom = clamp(Math.round((settings.zoom || 1) * factor * 20) / 20, 0.5, 1.5);
    clearTimeout(UI.zoomSave); UI.zoomSave = setTimeout(saveSettings, 600);
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
  setText('hearts', String(Math.floor(S.hearts || 0)));
  UI.heartPulse = Math.max(0, (UI.heartPulse || 0) - dt);
  setStyle('heartbox', 'transform', UI.heartPulse > 0 ? 'scale(' + (1 + Math.round(UI.heartPulse * 10) / 20) + ')' : '');
  if (!UI.cashRect || now - (UI.cashRectT || 0) > 1 || now < (UI.cashRectT || 0)) { UI.cashRect = $('cashbox').getBoundingClientRect(); UI.cashRectT = now; }
  UI.cashWorld = screenToWorld(UI.cashRect.left + 18, UI.cashRect.top + UI.cashRect.height / 2);
  var rep = stars(S.rep); if (UI.repHTML !== rep) { UI.repHTML = rep; $('rep').innerHTML = rep; }
  setText('lvl', S.level);
  setStyle('xpbar', 'width', Math.round(S.xp / lvlNeed(S.level) * 50) * 2 + '%');
  var D = dayLen(), f = S.dayTime / D, mins = 8 * 60 + Math.floor(f * 600 / 10) * 10, hh = Math.floor(mins / 60), mm = mins % 60;
  var ph = typeof dayPhase === 'function' ? dayPhase() : { icon: '🌅', short: 'Open' };
  var dEv = typeof currentDailyEvent === 'function' ? currentDailyEvent() : null;
  setText('dayname', 'Day ' + S.day + ' · ' + ph.icon + ' ' + ph.short + (dEv ? ' · ' + dEv.icon : ''));
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
  var tutReqBuild = (!S.tutorialDone && typeof tutorialRequiredBuildType === 'function') ? tutorialRequiredBuildType() : null;
  if ($('buildBtn')) $('buildBtn').classList.toggle('tut-pulse', !!(UI.mode === 'play' && tutReqBuild));
  if (UI.mode === 'play') {
    if (z) hh2 += '<span data-hact="interact" class="' + (z.disabled ? 'dim' : '') + '">' + (z.disabled ? '' : '⚡ ') + esc(z.label) + '</span>';
    else if (!S.tutorialDone && typeof tutorialGuidance === 'function') {
      var tg = tutorialGuidance();
      if (tg) hh2 = '<span data-hact="' + (tg.needShop ? 'openbuild' : 'tut') + '">🎓 Step ' + tg.stepNum + '/' + tg.total + ': ' + esc(tg.subText) + '</span>';
    } else {
      var adv = typeof currentAdvisorHint === 'function' ? currentAdvisorHint() : null;
      if (adv) hh2 = '<span data-hact="' + esc(adv.act || 'staff') + '">' + esc(adv.text) + '</span>';
    }
  } else if (UI.mode === 'build') {
    if (UI.buildSel && CAT_BY_ID[UI.buildSel]) {
      var selDef = CAT_BY_ID[UI.buildSel];
      hh2 = '<span data-hact="build">🎓 Tap any open green spot on the lawn to place your ' + selDef.icon + ' ' + esc(selDef.name) + '!</span>';
    } else if (!S.tutorialDone && tutReqBuild && CAT_BY_ID[tutReqBuild]) {
      var bDef = CAT_BY_ID[tutReqBuild];
      hh2 = '<span data-hact="build">🎓 Select ' + bDef.icon + ' ' + esc(bDef.name) + ' in the Shop below to place it on the lawn!</span>';
    }
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
  if (UI.hudT - UI.lastRoster > 0.45 || UI.hudT < UI.lastRoster) { UI.lastRoster = UI.hudT; renderTasks(); renderRoster(); if (UI.mode === 'build' && !UI.shopTouching && UI.bpSig !== buildSig()) renderBuildPanel(); }
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
    var wv = S.goalWave || 1;
    var gsub = UI.tasksOpen ? ('Wave ' + wv + ' · ' + dn + '/' + S.goals.length) : (nextGoal ? ('W' + wv + ': ' + goalText(nextGoal)) : ('Wave ' + wv + ' done!'));
    h = '<div class="ph" id="tasksHead"><span>🎯</span><span class="ph-sub">' + esc(gsub) + '</span><span class="chev">' + (UI.tasksOpen ? '▲' : '▼') + '</span></div>';
    if (UI.tasksOpen) {
      var evNow = typeof currentDailyEvent === 'function' ? currentDailyEvent() : null;
      if (evNow) h += '<div class="goal done"><div class="gt"><span>' + evNow.icon + ' <b>' + esc(evNow.name) + '</b></span></div><div class="gt"><small>' + esc(evNow.desc) + '</small></div></div>';
      h += S.goals.map(function (g) { var p = goalProgress(g); return '<div class="goal' + (g.done ? ' done' : '') + '"><div class="gt"><span>' + (g.done ? '✅ ' : '') + esc(goalText(g)) + '</span><b>' + (g.done ? 'Done!' : '+' + fmtMoney(g.reward)) + '</b></div><div class="gb"><div style="width:' + (p / g.n * 100) + '%"></div></div></div>'; }).join('');
      if (typeof MILESTONES !== 'undefined') {
        h += '<div class="goal" style="border-top:1px solid rgba(120,80,40,0.2);padding-top:4px;margin-top:4px"><div class="gt"><b>🏆 Endless Empire Milestones</b></div></div>';
        h += MILESTONES.slice(0, 4).map(function (m) {
          var tier = milestoneTier(m.id), cur = milestoneValue(m), tgt = milestoneTarget(m, tier), rew = milestoneReward(m, tier);
          var pct = clamp(Math.round(cur / tgt * 100), 0, 100);
          return '<div class="goal"><div class="gt"><span>' + m.icon + ' ' + esc(m.name) + ' T' + (tier + 1) + ': ' + esc(m.text.replace('{n}', tgt)) + ' (' + cur + '/' + tgt + ')</span><b>+' + fmtMoney(rew) + '</b></div><div class="gb"><div style="width:' + pct + '%"></div></div></div>';
        }).join('');
      }
    }
  }
  if (UI.tasksHTML !== h) {
    UI.tasksHTML = h; $('tasks').innerHTML = h;
    $('tasksHead').onclick = function () { UI.tasksOpen = !UI.tasksOpen; if (UI.tasksOpen) UI.rosterOpen = false; sfx('click'); renderTasks(); renderRoster(); };
  }
}
function moodBar(v) { var col = v > 70 ? '#6fbf5a' : v > 40 ? '#f2c14e' : '#d9574a'; return '<div class="mood"><u><s style="width:' + Math.round(v / 4) * 4 + '%;background:' + col + '"></s></u></div>'; }
function renderRoster() {
  var dogs = S.dogs.filter(function (d) { return d.checkedIn && d.state !== 'leaving'; });
  var waiting = S.owners.filter(function (o) { return o.state === 'waitCheckin' || o.state === 'waitPickup' || o.state === 'walkIn'; }).length;
  var needy = dogs.filter(function (d) { return d.need && !d.need.self; }).length;
  var badges = (needy ? ' 🙋' + needy : '') + (waiting ? ' 🔔' + waiting : '');
  var h = '<div class="ph" id="rosterHead"><span>🐕 Pups</span><span class="ph-sub">' + activeDogCount() + '/' + capacity() + badges + '</span><span class="chev">' + (UI.rosterOpen ? '▲' : '▼') + '</span></div>';
  if (UI.rosterOpen) {
    if (!dogs.length) h += '<div class="empty">No pups yet — welcome customers at the counter!</div>';
    function rank(d) { return d.need && !d.need.self ? 0 : 1; }
    dogs.sort(function (a, b) { return rank(a) - rank(b) || a.happy - b.happy; });
    dogs.forEach(function (d) {
      var hp = d.happy, need = d.need && !d.need.self ? d.need : null;
      // Do not mark pickup dogs in the roster — player checks the owner at the counter and finds the dog in the yard!
      var ico = need ? NEED_INFO[need.type].icon : d.state === 'kennel' || d.state === 'nap' ? '💤' : d.state === 'bath' ? '🛁' : d.state === 'leashed' ? '🦮' : d.overnight && d.pickupDay > S.day ? '🌙' : '🐾';
      var cls = 'dog' + (need && need.t > NEED_GRACE ? ' sad' : need ? ' asks' : '');
      var pct = '<span class="hp" style="color:' + (hp > 70 ? '#3f7d3a' : hp > 40 ? '#b87514' : '#c2483c') + '">' + Math.round(hp / 2) * 2 + '%</span>';
      h += '<div class="' + cls + '" data-dog="' + d.id + '"><img src="' + dogPortraitSrc(d, 44) + '"><b>' + esc(d.name) + '</b><span class="ico">' + ico + '</span>' + moodBar(hp) + pct + '</div>';
    });
  }
  var el = $('roster');
  if (UI.rosterHTML !== h) {
    UI.rosterHTML = h; var sc = el.scrollTop; el.innerHTML = h; el.scrollTop = sc;
    $('rosterHead').onclick = function () { UI.rosterOpen = !UI.rosterOpen; if (UI.rosterOpen) UI.tasksOpen = false; sfx('click'); renderRoster(); renderTasks(); };
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
    var netOk = updateNetGate();
    if (S) {
      var active = netOk && (UI.mode === 'play' || UI.mode === 'build') && !document.hidden;
      if (active) update(dt);
      else if (netOk) updateFX(dt * 0.5);
      // Portrait iPhone camera centered horizontally on the player!
      var P = S.player, v = DIRV[P.dir] || [0, 0];
      var tx = P.x + (P.moving ? v[0] * 32 : 0);
      var ty = P.y - 16 + (P.moving ? v[1] * 32 : 0), zm = 1;
      if (UI.camFocus) { UI.camFocus.t -= dt; var fd = dogById(UI.camFocus.id); if (fd && UI.camFocus.t > 0 && !P.moving) { tx = fd.x; ty = fd.y - 20; } else UI.camFocus = null; }
      if (UI.camFocusPeer && typeof MP !== 'undefined') { UI.camFocusPeer.t -= dt; var fp = MP.getPeer(UI.camFocusPeer.id); if (fp && fp.online && UI.camFocusPeer.t > 0 && !P.moving) { tx = fp.x; ty = fp.y - 24; } else UI.camFocusPeer = null; }
      var building = UI.mode === 'build' || (UI.mode === 'confirm' && UI.prevMode === 'build');
      if (building) {
        if (typeof ownedYardView === 'function') {
          var yv = ownedYardView();
          var maxPanX = W * TILE * 0.48, maxPanY = H * TILE * 0.48;
          CAM.panX = clamp(CAM.panX || 0, -maxPanX, maxPanX);
          CAM.panY = clamp(CAM.panY || 0, -maxPanY, maxPanY);
          tx = yv.cx + CAM.panX;
          ty = yv.cy + CAM.panY;
          zm = yv.zoomMul;
        }
      }
      UI.bakeAll = !CAM.ready; updateCamera(dt, tx, ty, zm, !CAM.ready || building); CAM.ready = true;
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
window.addEventListener('beforeunload', function () { if (S && typeof clearWaitingOwners === 'function') clearWaitingOwners(S); saveGame(); });
document.addEventListener('visibilitychange', function () {
  if (document.hidden) {
    if (S && typeof clearWaitingOwners === 'function') clearWaitingOwners(S);
    saveGame();
    try { if (typeof AC !== 'undefined' && AC && AC.suspend) AC.suspend(); } catch (e) {}
  }
  else { lastT = performance.now(); try { if (typeof AC !== 'undefined' && AC) audioInit(); } catch (e) {} }
});
$('buildBtn').onclick = function () { initAudio(); if (UI.mode === 'play' || UI.mode === 'build') { setMode(UI.mode === 'build' ? 'play' : 'build'); sfx('ui_open'); } this.blur(); };
if ($('netRetryBtn')) $('netRetryBtn').onclick = function () {
  initAudio(); sfx('click');
  setText('netStatus', '🔄 Reconnecting to Cloud Sync Server…');
  if (typeof MP !== 'undefined' && MP.reconnectNow) MP.reconnectNow();
};
$('pauseBtn').onclick = function () { initAudio(); if (UI.mode === 'play' || UI.mode === 'build') openPause(); this.blur(); };
$('dexBtn').onclick = function () { initAudio(); if (UI.mode === 'play' || UI.mode === 'build') openDex(); this.blur(); };
if ($('repPill')) $('repPill').onclick = function () {
  if (!S) return;
  initAudio(); sfx('click');
  toast('⭐ ' + S.rep.toFixed(1) + '★ Rating boosts arrival speed & tips! (' + capacity() + ' Kennel slot' + (capacity() === 1 ? '' : 's') + ' · Luxury Suite Avg Lv ' + kennelSuiteLevel().toFixed(1) + ')', 'good');
};
if ($('heartbox')) $('heartbox').onclick = function () {
  if (!S) return;
  initAudio(); sfx('click');
  toast('💛 ' + (S.hearts || 0) + ' Paw Hearts — earned from PAWSOME pickups, chores, breeds, ribbons & co-op! Spend in 🔨 Shop → Research & Staff or tap any build to shave 30m!', 'good');
};
if ($('touchDropBtn')) $('touchDropBtn').onclick = function () { initAudio(); if (UI.mode === 'play') { var qa = qAction(); if (qa && !qa.disabled) qa.run(); } };
$('hint').addEventListener('pointerdown', function (ev) {
  var sp = ev.target && ev.target.closest ? ev.target.closest('[data-hact]') : null;
  if (!sp || !S) return;
  initAudio();
  var act = sp.getAttribute('data-hact');
  if (act === 'interact' && UI.mode === 'play') triggerZoneNow();
  else if (act === 'grab' && UI.mode === 'play') { var qa = qAction(); if (qa && !qa.disabled) qa.run(); }
  else if (act === 'openbuild') { setMode('build'); sfx('ui_open'); }
  else if (act === 'tut') { UI.tasksOpen = !UI.tasksOpen; if (UI.tasksOpen) UI.rosterOpen = false; sfx('click'); renderTasks(); renderRoster(); }
  else if (act === 'staff') { UI.buildTab = 'biz'; setMode('build'); sfx('ui_open'); }
  else if (act === 'land') { UI.buildTab = 'land'; setMode('build'); sfx('ui_open'); }
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
    if (typeof sessionStorage !== 'undefined' && sessionStorage.getItem('paws_autostart_fresh') === '1') {
      try { sessionStorage.removeItem('paws_autostart_fresh'); } catch (e) {}
      enterPlayFromState(true);
      setTimeout(function () { $('splash').classList.add('gone'); setTimeout(function () { $('splash').style.display = 'none'; }, 800); }, 250);
    } else if (typeof hasActiveSession === 'function' && hasActiveSession()) {
      enterPlayFromState(false);
      setTimeout(function () { $('splash').classList.add('gone'); setTimeout(function () { $('splash').style.display = 'none'; }, 800); }, 250);
    } else {
      openTitle();
    }
    checkAndReloadIfUpdated(false);
    requestAnimationFrame(frame);
  }
  try { Promise.all([document.fonts.load('20px "Jersey 25"'), document.fonts.load('700 14px Nunito'), document.fonts.load('800 14px Nunito')]).then(go, go); } catch (e) { go(); }
  setTimeout(go, 2500);
})();
