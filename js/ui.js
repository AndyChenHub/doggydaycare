'use strict';
var UI = {
  mode: 'title', prevMode: 'play', actions: null, mouse: { sx: 0, sy: 0, in: false },
  buildSel: null, buildTool: null, buildTab: 'care', moveObj: null, actionObj: null,
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
  UI.mode = m;
  document.body.classList.toggle('building', m === 'build');
  document.body.classList.toggle('title', !!UI.inTitle);
  if (m !== 'build') { UI.buildSel = null; UI.buildTool = null; UI.moveObj = null; CAM.panX = 0; CAM.panY = 0; }
  if (m !== 'play') { UI.joy = null; UI.touchTarget = null; }
  if (m === 'build') {
    UI.buildSel = null;
    UI.buildTool = null;
    UI.moveObj = null;
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
  var gift = dailyGift();
  if (gift) setTimeout(function () { if (UI.mode === 'play' || UI.mode === 'build') showGift(gift); }, 3000);
  if (S.offlineReport) {
    var rep = S.offlineReport; delete S.offlineReport; saveGame();
    toast('🧑‍💼 Staff ran the shop for ' + fmtDur(rep.sec) + ' while closed: cared for ' + rep.dogs + ' dogs and netted +' + fmtMoney(rep.earned) + ' (after supplies & staff cut)!', 'good');
  }
  if (S.migrated) { var r = S.migrated.refund; delete S.migrated; saveGame(); openModal('<h2>Welcome back!</h2><p>Paws &amp; Play has moved into a bigger, prettier home. Your level, reputation and cash came along' + (r ? ', and everything you had built was refunded: <b class="good">+' + fmtMoney(r) + '</b>' : '') + '. The yard is a fresh start — time to decorate!</p><div class="row"><button data-act="back" class="primary">Let\'s go</button></div>', 'note'); bindModalButtons(); }
  else if (S.totalServed === 0 && !S.tutorial.checkin) toast('🐶 Tap 🔨 Shop at the bottom to select and place your first Kennel on the lawn!', 'good');
  if (!isJoiningRoom) saveGame();
}
var CURRENT_ASSET_VER = '21';
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
    if (o.type === 'tub' && o.dogId) { toast('Wait for the bath to finish before moving the Bath Tub', 'bad'); sfx('error'); return; }
    setMode('build'); UI.buildTool = 'move'; UI.buildSel = null; UI.moveObj = o; renderBuildPanel();
    toast('↔️ Tap any open green tile in the yard to move ' + CAT_BY_ID[o.type].name, '');
  },
  upgobj: function () {
    var o = UI.actionObj; closeModal();
    if (o) promptUpgradeObject(o);
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
function renderBuildPanel() {
  var isPlacing = !!(UI.buildSel || UI.moveObj);
  $('buildpanel').classList.toggle('minimized', isPlacing);
  if (isPlacing) {
    var hMin = '';
    if (UI.buildSel && CAT_BY_ID[UI.buildSel]) {
      var sDef = CAT_BY_ID[UI.buildSel];
      var sCost = typeof itemCost === 'function' ? itemCost(sDef.id) : sDef.cost;
      var sTime = typeof itemBuildTime === 'function' ? itemBuildTime(sDef.id) : sDef.time;
      var effT = !S.tutorialDone ? Math.min(sTime, 2.5) : sTime;
      var sUrl = objectIconURL(sDef.id);
      hMin = '<div class="bp-min-bar">' +
        '<div class="ic">' + (sUrl ? '<img src="' + sUrl + '">' : sDef.icon) + '</div>' +
        '<div class="tx"><b>Placing ' + esc(sDef.name) + ' (' + fmtMoney(sCost) + ' · ⏱ ' + fmtDur(effT) + ')</b>' +
        '<small>Tap any open green tile on the lawn to place · Drag to pan</small></div>' +
        '<button id="bpCancelPlace" class="bp-cancel-x" aria-label="Cancel">✕</button>' +
      '</div>';
    } else if (UI.moveObj && CAT_BY_ID[UI.moveObj.type]) {
      var mDef = CAT_BY_ID[UI.moveObj.type];
      var mUrl = objectIconURL(mDef.id);
      hMin = '<div class="bp-min-bar">' +
        '<div class="ic">' + (mUrl ? '<img src="' + mUrl + '">' : mDef.icon) + '</div>' +
        '<div class="tx"><b>↔️ Moving ' + esc(mDef.name) + '</b>' +
        '<small>Tap any open green tile on the lawn to relocate</small></div>' +
        '<button id="bpCancelPlace" class="bp-cancel-x" aria-label="Cancel">✕</button>' +
      '</div>';
    }
    $('buildpanel').innerHTML = hMin;
    UI.bpSig = buildSig();
    return;
  }
  var tabs = [['care', 'Care'], ['fun', 'Fun'], ['decor', 'Decor'], ['land', 'Land'], ['biz', 'Research & Staff']];
  var h = '<div class="bp-head"><span>🔨 Shop</span><button id="moveBtn" class="' + (UI.buildTool === 'move' ? 'on' : '') + '">↔️ Move</button><button id="upgBtn" class="' + (UI.buildTool === 'upgrade' ? 'on' : '') + '">⬆️ Upgrade</button><button id="sellBtn" class="' + (UI.buildTool === 'sell' ? 'on' : '') + '">💸 Sell</button><button id="bpClose">Done</button></div>' +
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
    h += '<div class="bp-sub">🏆 Endless Franchise Certification — expand capacity &amp; pay forever!</div>';
    h += '<div class="item' + (fLockedL ? ' locked' : '') + (S.cash < fCostL && !fLockedL ? ' poor' : '') + '" data-franchise="1" style="grid-column:1/-1"><div class="ic">🏆</div><div class="tx"><b>' + esc(franchiseName(fTierL + 1)) + ' <span style="color:#8e6bd6">Tier ' + (fTierL + 1) + '</span></b><small>Permanent +2 Max Dog Capacity, +12% All Boarding Pay &amp; +10 Yard Charm (Current: ' + esc(franchiseName(fTierL)) + ')</small></div><div class="pr">' +
      (fLockedL ? '🔒 Lv ' + fReqL : '⬆️ ' + fmtMoney(fCostL)) + '</div></div>';
  } else if (UI.buildTab === 'biz') {
    h += '<div class="bp-sub">⭐ Boost Star Rating (' + S.rep.toFixed(1) + '★ → Max ' + capacity() + ' dogs)</div>';
    h += '<div class="item' + (S.cash < 35 ? ' poor' : '') + '" data-repboost="social"><div class="ic">🍪</div><div class="tx"><b>Pup Cup Social</b><small>Instant +0.35★ Star Rating &amp; happy pups</small></div><div class="pr">$35</div></div>';
    h += '<div class="item' + (S.cash < 95 ? ' poor' : '') + '" data-repboost="ad"><div class="ic">📸</div><div class="tx"><b>Pet Magazine Ad</b><small>Instant +0.80★ Star Rating &amp; more dogs</small></div><div class="pr">$95</div></div>';
    var fTier = typeof franchiseTier === 'function' ? franchiseTier() : 0;
    var fCost = typeof franchiseCost === 'function' ? franchiseCost() : 750;
    var fReq = typeof franchiseReqLvl === 'function' ? franchiseReqLvl() : 2;
    var fLocked = S.level < fReq;
    h += '<div class="item' + (fLocked ? ' locked' : '') + (S.cash < fCost && !fLocked ? ' poor' : '') + '" data-franchise="1" style="grid-column:1/-1"><div class="ic">🏆</div><div class="tx"><b>' + esc(franchiseName(fTier + 1)) + ' <span style="color:#8e6bd6">Tier ' + (fTier + 1) + '</span></b><small>Endless Empire Rank: +2 Max Dog Capacity, +12% Boarding Pay &amp; +10 Charm per Tier</small></div><div class="pr">' +
      (fLocked ? '🔒 Lv ' + fReq : '⬆️ ' + fmtMoney(fCost)) + '</div></div>';
    h += '<div class="bp-sub">Endless Research Perks — upgradeable forever!</div>';
    UPGRADES.forEach(function (u) {
      var curLv = upLvl(u.id), reqLv = upgReqLvl(u), cost = upgCost(u);
      var locked = S.level < reqLv, poor = S.cash < cost;
      h += '<div class="item' + (locked ? ' locked' : '') + (poor && !locked ? ' poor' : '') + '" data-upg="' + u.id + '"><div class="ic">' + u.icon + '</div><div class="tx"><b>' + u.name + (curLv ? ' <span style="color:#8e6bd6">Lv' + curLv + '</span>' : '') + '</b><small>' + u.desc + '</small></div><div class="pr">' +
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
        '<div class="ic">' + (url ? '<img src="' + url + '">' : c.icon) + '</div><div class="tx"><b>' + c.name + titleSuffix + (isTut ? ' <span style="color:#d9574a">🎓 Place Now</span>' : '') + '</b><small>⏱ ' + fmtDur(!S.tutorialDone ? Math.min(cTime, 2.5) : cTime) + (c.charm >= 1 ? ' · 🌸+' + c.charm : '') + (c.cap ? ' · 🐕+' + c.cap + ' allowed' : '') + '</small></div>' +
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
var BP_HELP = 'Tap any building in the yard to Move, Upgrade, or Sell it, or pick a new item below.';
function bpShowDesc(txt) {
  var el = $('bpDesc');
  if (el) el.textContent = txt || (UI.buildTool === 'move' ? (UI.moveObj ? 'Moving ' + CAT_BY_ID[UI.moveObj.type].name + ' — tap any open green spot in the yard to place it!' : 'Move mode: tap any building or item in the yard to relocate it for free.') : UI.buildTool === 'sell' ? 'Sell mode: tap a building in the yard to sell it.' : UI.buildTool === 'upgrade' ? 'Upgrade mode: tap any building in the yard to level it up!' : UI.buildSel ? 'Tap any green tile in the yard to build ' + CAT_BY_ID[UI.buildSel].name + ' (⏱ ' + fmtDur(CAT_BY_ID[UI.buildSel].time) + ')' : BP_HELP);
}
(function () {
  var bp = $('buildpanel');
  bp.addEventListener('pointerdown', function (ev) {
    if (!ev.target.closest) return;
    var t = ev.target.closest('#bpClose,#bpCancelPlace,#moveBtn,#sellBtn,#upgBtn,[data-tab],[data-item],[data-plot],[data-upg],[data-staff],[data-repboost],[data-franchise]'); if (!t) return;
    initAudio();
    if (t.id === 'bpClose') { setMode('play'); sfx('ui_close'); return; }
    if (t.id === 'bpCancelPlace') {
      UI.buildSel = null; UI.moveObj = null;
      if (UI.buildTool === 'move') UI.buildTool = null;
      CAM.panX = 0; CAM.panY = 0;
      sfx('ui_close');
      renderBuildPanel();
      return;
    }
    if (t.hasAttribute('data-repboost')) { runRepCampaign(t.getAttribute('data-repboost')); renderBuildPanel(); return; }
    if (t.hasAttribute('data-franchise')) { buyFranchiseTier(); renderBuildPanel(); return; }
    if (t.id === 'moveBtn') { UI.buildTool = UI.buildTool === 'move' ? null : 'move'; UI.buildSel = null; UI.moveObj = null; renderBuildPanel(); sfx('click'); return; }
    if (t.id === 'sellBtn') { UI.buildTool = UI.buildTool === 'sell' ? null : 'sell'; UI.buildSel = null; UI.moveObj = null; renderBuildPanel(); sfx('click'); return; }
    if (t.id === 'upgBtn') { UI.buildTool = UI.buildTool === 'upgrade' ? null : 'upgrade'; UI.buildSel = null; UI.moveObj = null; renderBuildPanel(); sfx('click'); return; }
    if (t.hasAttribute('data-tab')) { UI.buildTab = t.getAttribute('data-tab'); UI.buildSel = null; UI.moveObj = null; sfx('click'); renderBuildPanel(); var it = bp.querySelector('.items'); if (it) it.scrollTop = 0; return; }
    if (t.hasAttribute('data-item')) {
      var id = t.getAttribute('data-item'), c = CAT_BY_ID[id];
      var reqL = typeof itemReqLvl === 'function' ? itemReqLvl(id) : c.lvl;
      if (S.level < reqL) {
        if (id === 'kennel' && !S.tutorialDone) toast('🎓 Finish the onboarding tutorial first before building a 2nd Kennel!', 'bad');
        else toast('🔒 Reach Daycare Level ' + reqL + ' to build another ' + c.name, 'bad');
        sfx('error'); return;
      }
      UI.buildSel = UI.buildSel === id ? null : id; UI.buildTool = null; UI.moveObj = null; CAM.panX = 0; CAM.panY = 0; sfx('click'); renderBuildPanel(); return;
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
  });
})();
function buildSig() {
  var pend = UI.buildTab === 'land' && S.plots.some(function (p) { return Date.now() < p.end + 1000; });
  var stSig = STAFF.map(function (s) { return staffLvl(s.id) + ':' + (S.cash >= staffTrainCost(s.id) ? 1 : 0); }).join(',');
  var catSig = CATALOG.map(function (c) { var cost = typeof itemCost === 'function' ? itemCost(c.id) : c.cost; return (S.cash >= cost ? 1 : 0); }).join('');
  return catSig + ':' + (typeof kennelCount === 'function' ? kennelCount(true) : 0) + '|' + PLOTS.map(function (p) { return S.cash >= p.cost ? 1 : 0; }).join('') + UPGRADES.map(function (u) { return upLvl(u.id) + ':' + (S.cash >= upgCost(u) ? 1 : 0); }).join(',') + '|' + stSig + '|' + franchiseTier() + ':' + (S.cash >= franchiseCost() ? 1 : 0) + '|' + S.level + '|' + S.plots.length + '|' + (pend ? Math.floor(Date.now() / 1000) : '');
}
function tryBuyPlot(p) {
  if (plotOwned(p) || plotPending(p)) return;
  if (S.level < p.lvl) { toast('🔒 Reach level ' + p.lvl + ' to expand ' + p.name, 'bad'); sfx('error'); return; }
  if (!plotAdjacent(p)) { toast(p.name + ' does not touch your land yet — unlock a neighbouring plot first', 'bad'); sfx('error'); return; }
  if (S.cash < p.cost) { toast('Not enough cash for ' + p.name + ' (' + fmtMoney(p.cost) + ')', 'bad'); sfx('error'); return; }
  var unlHtml = (p.unlocks && p.unlocks.length) ? '<br><small>🎁 Unlocks in this area: <b>' + p.unlocks.join(' · ') + '</b></small>' : '';
  confirmBox('Expand into <b>' + p.name + '</b> for ' + fmtMoney(p.cost) + '?<br><small>⏱ Clearing takes ' + fmtDur(p.time) + ' in real time.</small>' + unlHtml, function () { buyPlot(p); renderBuildPanel(); });
}
function promptObjectActions(o) {
  var c = CAT_BY_ID[o.type], lv = o.lvl || 1, nextLv = lv + 1, cost = objUpgradeCost(o), req = objUpgradeReqLvl(o);
  UI.actionObj = o;
  var upgLabel = S.level < req ? ('⬆️ Upgrade Lv ' + nextLv + ' (🔒 Lv ' + req + ')') : ('⬆️ Upgrade to Lv ' + nextLv + ' (' + fmtMoney(cost) + ')');
  var sellBtn = canSell(o) ? '<button data-act="sellobj" class="flat">💸 Sell (' + fmtMoney(sellValue(o)) + ')</button>' : '';
  openModal('<h2>' + c.icon + ' ' + esc(c.name) + ' <small>Lv ' + lv + '</small></h2>' +
    '<p style="text-align:center">' + esc(c.desc) + '</p>' +
    '<div class="row col">' +
    '<button data-act="moveobj" class="primary">↔️ Move to Another Spot</button>' +
    '<button data-act="upgobj">' + upgLabel + '</button>' +
    sellBtn +
    '<button data-act="back" class="flat">Cancel</button>' +
    '</div>', 'confirm', 'narrow');
  bindModalButtons();
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
  if (UI.moveObj) {
    var mo = UI.moveObj, mDef = CAT_BY_ID[mo.type], mx = tx - Math.floor((mDef.w - 1) / 2), my = ty - Math.floor((mDef.h - 1) / 2);
    if (canMoveObject(mo, mx, my)) {
      moveObject(mo, mx, my);
      UI.moveObj = null;
      renderBuildPanel();
      return;
    }
    if (site && site !== mo) {
      if (site.type === 'tub' && site.dogId) { toast('Wait for the bath to finish before moving the Bath Tub', 'bad'); sfx('error'); return; }
      UI.moveObj = site; sfx('click'); renderBuildPanel();
      toast('↔️ Picked up ' + CAT_BY_ID[site.type].name + ' — tap an open green spot in the yard!', '');
      return;
    }
    toast('Tap an open green tile in the yard to place ' + mDef.name, 'bad'); sfx('error');
    return;
  }
  if (UI.buildTool === 'move') {
    if (site) {
      if (site.type === 'tub' && site.dogId) { toast('Wait for the bath to finish before moving the Bath Tub', 'bad'); sfx('error'); return; }
      UI.moveObj = site; sfx('click'); renderBuildPanel();
      toast('↔️ Picked up ' + CAT_BY_ID[site.type].name + ' — tap any open green spot to move it!', '');
    } else {
      toast('Tap any building or item in the yard that you want to move', '');
    }
    return;
  }
  if (UI.buildSel && !(site && !site.done) && UI.buildTool !== 'upgrade' && UI.buildTool !== 'sell') {
    var def = CAT_BY_ID[UI.buildSel], x = tx - Math.floor((def.w - 1) / 2), y = ty - Math.floor((def.h - 1) / 2);
    var bCost = typeof itemCost === 'function' ? itemCost(UI.buildSel) : def.cost;
    var bReq = typeof itemReqLvl === 'function' ? itemReqLvl(UI.buildSel) : def.lvl;
    if (S.level < bReq) { toast('🔒 Reach Level ' + bReq + ' to build another ' + def.name, 'bad'); sfx('error'); return; }
    if (S.cash < bCost) { toast('Not enough cash for a ' + def.name + ' (' + fmtMoney(bCost) + ')', 'bad'); sfx('error'); return; }
    if (!canPlace(UI.buildSel, x, y)) { toast('Tap an open green tile on the lawn', 'bad'); sfx('error'); return; }
    placeBuild(UI.buildSel, x, y);
    UI.buildSel = null;
    CAM.panX = 0; CAM.panY = 0;
    if (!S.tutorialDone) {
      setMode('play');
      return;
    }
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
    if (UI.buildTool === 'upgrade') promptUpgradeObject(o);
    else promptObjectActions(o);
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
        var zoomSection = !!(UI.buildSel || UI.moveObj || UI.buildTool === 'move');
        if (zoomSection && typeof ownedYardView === 'function') {
          var yv = ownedYardView();
          tx = yv.cx;
          ty = yv.cy;
          zm = yv.zoomMul;
        } else {
          if (P.moving) { CAM.panX *= 0.9; CAM.panY *= 0.9; }
          ty += 70 / CAM.zoom;
        }
        CAM.panX = clamp(CAM.panX, -W * TILE, W * TILE); CAM.panY = clamp(CAM.panY, -H * TILE, H * TILE);
        tx += CAM.panX; ty += CAM.panY;
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
  toast('⭐ ' + S.rep.toFixed(1) + '★ Rating attracts up to ' + capacity() + ' dogs! Complete yard chores (🍂💧🦴✨), cuddle/play with dogs, or run a Pup Cup Social in Shop to boost stars!', 'good');
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
