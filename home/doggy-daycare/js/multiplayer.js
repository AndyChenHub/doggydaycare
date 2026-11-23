'use strict';
/* ============================================================================================
   multiplayer.js — Real-time & Asynchronous Co-op Multiplayer for Paws & Play
   - Connect phones / browsers over Wi-Fi / LAN (WebSocket + HTTP fallback) or cross-tab (BroadcastChannel)
   - Synchronizes shared daycare improvements (buildings, land plots, upgrades, staff, cash, level, dogs, owners)
   - Renders co-op partners live in the world with smooth movement, carried items, leashes, and emotes
   - Tracks partner activity and shows a concise "What your partner did" summary when you log on
   - Includes a zero-dependency ISO/IEC 18004 QR Code canvas renderer for instant phone pairing
   ============================================================================================ */

var MP = (function () {
  var TAB_KEY = 'pawsPlayTabSession_v1';
  var DEV_KEY = 'pawsPlayDeviceProfile_v1';
  var TABS_HEARTBEAT_KEY = 'pawsPlayActiveTabs_v1';
  var ROOM_STORAGE_PREFIX = 'pawsPlayRoomState_v1_';

  var tabId = 'tab_' + Math.random().toString(36).slice(2, 9);
  var slot = 1;
  var playerId = '';
  var playerName = 'Sam';
  var playerLook = 0;
  var roomCode = 'PAWS';
  var inGame = false;
  var connected = false;
  var transport = 'connecting'; // 'ws' | 'http' | 'local'
  var hostId = null;
  var rev = 0;
  var seq = 0;
  var lastSeenSeq = 0;

  var ws = null;
  var wsRetryTimer = null;
  var httpPollTimer = null;
  var bc = null;

  var peers = {};          // playerId -> remote player state with interpolation targets
  var roomState = null;    // latest shared state from server
  var unreadEvents = [];   // activity events by other players since lastSeenSeq
  var recentEvents = [];   // recent activity events in the room
  var serverInfo = { port: 8000, ips: [], primaryIp: location.hostname || 'localhost', urls: [] };
  var lastMoveSent = 0;
  var lastWorldSent = 0;
  var lastLocalActionAt = 0;
  var summaryPending = false;
  var summaryShownAtSeq = 0;

  // ---------------- Identity & Multi-Tab / Multi-Device Slot Assignment ----------------
  function initIdentity() {
    // Check URL parameters (?room=XXXX&name=YYYY&player=2)
    try {
      var params = new URLSearchParams(window.location.search);
      if (params.get('room')) roomCode = cleanCode(params.get('room'));
      var urlSlot = parseInt(params.get('player') || params.get('slot') || '0', 10);
      if (urlSlot === 1 || urlSlot === 2) slot = urlSlot;
    } catch (e) {}

    // Determine whether another tab in this same browser is already active in slot 1
    var savedTab = null;
    try { savedTab = JSON.parse(sessionStorage.getItem(TAB_KEY) || 'null'); } catch (e) {}

    var activeTabs = {};
    try { activeTabs = JSON.parse(localStorage.getItem(TABS_HEARTBEAT_KEY) || '{}') || {}; } catch (e) {}
    var nowMs = Date.now();
    var slot1TakenByOtherTab = false;
    for (var tid in activeTabs) {
      if (nowMs - (activeTabs[tid].ts || 0) > 6000) {
        delete activeTabs[tid];
      } else if (tid !== (savedTab && savedTab.tabId) && activeTabs[tid].slot === 1) {
        slot1TakenByOtherTab = true;
      }
    }

    if (savedTab && savedTab.playerId) {
      tabId = savedTab.tabId || tabId;
      slot = savedTab.slot || 1;
      // If another live tab already holds slot 1 and this tab was cloned, bump to slot 2
      if (slot === 1 && slot1TakenByOtherTab) {
        slot = 2;
        savedTab = null;
      }
    } else if (slot1TakenByOtherTab && !savedTab) {
      slot = 2;
    }

    var devProfile = null;
    try { devProfile = JSON.parse(localStorage.getItem(DEV_KEY) || 'null'); } catch (e) {}
    if (!devProfile || !devProfile.baseId) {
      devProfile = {
        baseId: 'p_' + Math.random().toString(36).slice(2, 10),
        roomCode: roomCode,
        slots: {
          1: { name: 'Sam', look: 0, lastSeenSeq: 0 },
          2: { name: 'Maya', look: 1, lastSeenSeq: 0 },
        },
      };
      try { localStorage.setItem(DEV_KEY, JSON.stringify(devProfile)); } catch (e) {}
    }

    if (!window.location.search.includes('room=') && devProfile.roomCode) {
      roomCode = cleanCode(devProfile.roomCode);
    }

    var slotData = (devProfile.slots && devProfile.slots[slot]) || {
      name: slot === 1 ? 'Sam' : 'Maya',
      look: slot === 1 ? 0 : 1,
      lastSeenSeq: 0,
    };

    playerId = savedTab && savedTab.playerId ? savedTab.playerId : (devProfile.baseId + '_s' + slot);
    playerName = (savedTab && savedTab.playerName) || slotData.name || (slot === 1 ? 'Sam' : 'Maya');
    playerLook = typeof (savedTab && savedTab.playerLook) === 'number' ? savedTab.playerLook : (typeof slotData.look === 'number' ? slotData.look : (slot - 1));
    lastSeenSeq = slotData.lastSeenSeq || 0;

    try {
      var params2 = new URLSearchParams(window.location.search);
      if (params2.get('name')) playerName = params2.get('name').trim().slice(0, 18) || playerName;
    } catch (e) {}

    if (typeof UI !== 'undefined') {
      UI.pickLook = playerLook;
    }

    saveTabSession();
    beatTabHeartbeat();
    setInterval(beatTabHeartbeat, 2000);
  }

  function cleanCode(raw) {
    var s = String(raw || 'PAWS').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    return s || 'PAWS';
  }

  function saveTabSession() {
    try {
      sessionStorage.setItem(TAB_KEY, JSON.stringify({
        tabId: tabId,
        slot: slot,
        playerId: playerId,
        playerName: playerName,
        playerLook: playerLook,
        roomCode: roomCode,
      }));
    } catch (e) {}
    try {
      var devProfile = JSON.parse(localStorage.getItem(DEV_KEY) || '{}');
      devProfile.baseId = devProfile.baseId || playerId.replace(/_s\d+$/, '');
      devProfile.roomCode = roomCode;
      devProfile.slots = devProfile.slots || {};
      devProfile.slots[slot] = {
        name: playerName,
        look: playerLook,
        lastSeenSeq: lastSeenSeq,
      };
      localStorage.setItem(DEV_KEY, JSON.stringify(devProfile));
    } catch (e) {}
  }

  function beatTabHeartbeat() {
    try {
      var activeTabs = JSON.parse(localStorage.getItem(TABS_HEARTBEAT_KEY) || '{}') || {};
      var nowMs = Date.now();
      for (var k in activeTabs) {
        if (nowMs - (activeTabs[k].ts || 0) > 6000) delete activeTabs[k];
      }
      activeTabs[tabId] = { slot: slot, playerId: playerId, ts: nowMs };
      localStorage.setItem(TABS_HEARTBEAT_KEY, JSON.stringify(activeTabs));
    } catch (e) {}
  }

  // ---------------- Network & Transport ----------------
  function apiBase() {
    if (location.protocol === 'http:' || location.protocol === 'https:') {
      return location.origin;
    }
    return 'http://localhost:8000';
  }

  function wsUrl() {
    if (location.protocol === 'https:') return 'wss://' + location.host + '/ws';
    if (location.protocol === 'http:') return 'ws://' + location.host + '/ws';
    return 'ws://localhost:8000/ws';
  }

  function fetchServerInfo() {
    try {
      fetch(apiBase() + '/api/info')
        .then(function (r) { return r.json(); })
        .then(function (info) {
          if (info && info.ok) {
            serverInfo = info;
            if (typeof UI !== 'undefined' && UI.mode === 'coop') renderCoopModal();
          }
        })
        .catch(function () {});
    } catch (e) {}
  }

  function connect() {
    fetchServerInfo();
    setupBroadcastChannel();
    loadLocalRoomFallback();
    connectWebSocket();
    if (!httpPollTimer) {
      httpPollTimer = setInterval(httpFallbackTick, 1200);
    }
  }

  function setupBroadcastChannel() {
    if (bc || typeof BroadcastChannel === 'undefined') return;
    try {
      bc = new BroadcastChannel('paws_play_mp_v1');
      bc.onmessage = function (ev) {
        if (!ev || !ev.data || ev.data.roomCode !== roomCode) return;
        handleIncomingMessage(ev.data, true);
      };
    } catch (e) {}
  }

  function loadLocalRoomFallback() {
    try {
      var raw = localStorage.getItem(ROOM_STORAGE_PREFIX + roomCode);
      if (!raw) return;
      var data = JSON.parse(raw);
      if (data && data.state && !roomState) {
        roomState = data.state;
        rev = Math.max(rev, data.rev || 1);
        seq = Math.max(seq, data.seq || 0);
        if (Array.isArray(data.activityLog)) {
          recentEvents = data.activityLog;
          var unseen = data.activityLog.filter(function (e) {
            return e.playerId !== playerId && e.seq > lastSeenSeq;
          });
          if (unseen.length > unreadEvents.length) unreadEvents = unseen;
        }
      }
    } catch (e) {}
  }

  function saveLocalRoomFallback(eventToAppend) {
    try {
      var key = ROOM_STORAGE_PREFIX + roomCode;
      var data = JSON.parse(localStorage.getItem(key) || '{}') || {};
      data.code = roomCode;
      data.rev = rev;
      data.seq = seq;
      data.updatedAt = Date.now();
      if (S) data.state = serializeSharedState();
      data.activityLog = Array.isArray(data.activityLog) ? data.activityLog : [];
      if (eventToAppend) {
        if (!data.activityLog.some(function (x) { return x.seq === eventToAppend.seq; })) {
          data.activityLog.push(eventToAppend);
        }
        if (data.activityLog.length > 250) data.activityLog.splice(0, data.activityLog.length - 250);
      }
      localStorage.setItem(key, JSON.stringify(data));
    } catch (e) {}
  }

  function connectWebSocket() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
    try {
      ws = new WebSocket(wsUrl());
    } catch (e) {
      scheduleWsRetry();
      return;
    }

    ws.onopen = function () {
      connected = true;
      transport = 'ws';
      sendJoin();
      updateCoopBadge();
    };

    ws.onmessage = function (ev) {
      var msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      handleIncomingMessage(msg, false);
    };

    ws.onclose = function () {
      if (transport === 'ws') transport = 'http';
      updateCoopBadge();
      scheduleWsRetry();
    };

    ws.onerror = function () {
      try { ws.close(); } catch (e) {}
    };
  }

  function scheduleWsRetry() {
    if (wsRetryTimer) return;
    wsRetryTimer = setTimeout(function () {
      wsRetryTimer = null;
      connectWebSocket();
    }, 2500);
  }

  function sendPacket(msg, alsoHttp) {
    msg.roomCode = roomCode;
    msg.playerId = playerId;
    msg.name = playerName;
    msg.look = playerLook;
    msg.inGame = inGame;

    // Always mirror on BroadcastChannel for instant zero-latency same-browser tabs
    if (bc) {
      try { bc.postMessage(msg); } catch (e) {}
    }

    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify(msg));
        return;
      } catch (e) {}
    }

    if (alsoHttp !== false) {
      try {
        fetch(apiBase() + '/api/message', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(msg),
        })
          .then(function (r) { return r.json(); })
          .then(function (resp) {
            connected = true;
            if (transport !== 'ws') transport = 'http';
            if (resp) handleIncomingMessage(resp, false);
          })
          .catch(function () {
            if (transport !== 'ws') transport = 'local';
          });
      } catch (e) {}
    }
  }

  function sendJoin() {
    sendPacket({
      type: 'join',
      x: S && S.player ? S.player.x : PLAYER_START[0] * TILE,
      y: S && S.player ? S.player.y : PLAYER_START[1] * TILE,
      dir: S && S.player ? S.player.dir : 'down',
      face: S && S.player ? S.player.face : 1,
      state: (!roomState && S) ? serializeSharedState() : undefined,
    }, true);
  }

  function httpFallbackTick() {
    if (ws && ws.readyState === WebSocket.OPEN) return;
    if (inGame && S) {
      sendWorldSync(false);
    } else {
      try {
        fetch(apiBase() + '/api/room?room=' + encodeURIComponent(roomCode) + '&playerId=' + encodeURIComponent(playerId))
          .then(function (r) { return r.json(); })
          .then(function (resp) {
            if (resp && resp.ok) {
              connected = true;
              if (transport !== 'ws') transport = 'http';
              handleIncomingMessage({
                type: 'joined',
                roomCode: resp.roomCode,
                hostId: resp.hostId,
                rev: resp.rev,
                seq: resp.seq,
                state: resp.state,
                players: resp.players,
                unreadEvents: resp.unreadEvents,
                recentEvents: resp.recentEvents,
              }, false);
            }
          })
          .catch(function () {});
      } catch (e) {}
    }
  }

  // ---------------- Incoming Message Handling ----------------
  function handleIncomingMessage(msg, fromBc) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.roomCode && cleanCode(msg.roomCode) !== roomCode) return;

    if (msg.hostId !== undefined) hostId = msg.hostId;
    if (typeof msg.rev === 'number' && msg.rev > rev) rev = msg.rev;
    if (typeof msg.seq === 'number' && msg.seq > seq) seq = msg.seq;

    if (msg.players && typeof msg.players === 'object') {
      syncPeersMap(msg.players);
    }

    if (Array.isArray(msg.recentEvents)) {
      recentEvents = msg.recentEvents;
    }

    if (Array.isArray(msg.unreadEvents) && msg.unreadEvents.length) {
      // Merge unread events by seq
      var seenSeqs = {};
      unreadEvents.forEach(function (e) { seenSeqs[e.seq] = true; });
      msg.unreadEvents.forEach(function (e) {
        if (e.playerId !== playerId && e.seq > lastSeenSeq && !seenSeqs[e.seq]) {
          unreadEvents.push(e);
          seenSeqs[e.seq] = true;
        }
      });
      unreadEvents.sort(function (a, b) { return a.seq - b.seq; });
    }

    if (msg.type === 'joined' || msg.type === 'sync_ack') {
      if (msg.state) {
        roomState = msg.state;
        if (inGame && S && Date.now() - lastLocalActionAt > 1200) {
          applySharedState(msg.state, false);
        }
      }
      // If we already logged into the game and unreadEvents arrived just now, show summary if not shown yet
      if (inGame && summaryPending && hasSummaryToReport()) {
        summaryPending = false;
        presentPartnerSummary(false);
      }
      updateCoopBadge();
      if (typeof UI !== 'undefined' && UI.mode === 'coop') renderCoopModal();
      return;
    }

    if (msg.type === 'presence') {
      updateCoopBadge();
      if (typeof UI !== 'undefined' && UI.mode === 'coop') renderCoopModal();
      return;
    }

    if (msg.type === 'peer_update' || (fromBc && msg.type === 'player_update')) {
      var p = msg.player || msg;
      if (p && p.id !== playerId && p.playerId !== playerId) {
        updateSinglePeer(p.id ? p : {
          id: p.playerId,
          name: p.name,
          look: p.look,
          x: p.x,
          y: p.y,
          dir: p.dir,
          face: p.face,
          moving: p.moving,
          walkT: p.walkT,
          walkDist: p.walkDist,
          carry: p.carry,
          emote: p.emote,
          emoteT: p.emoteT,
          online: true,
          inGame: p.inGame,
        });
      }
      return;
    }

    if (msg.type === 'world_state' || (fromBc && msg.type === 'world_sync')) {
      var sender = msg.senderId || msg.playerId;
      if (sender === playerId) return;
      if (msg.state) {
        roomState = msg.state;
        if (inGame && S && Date.now() - lastLocalActionAt > 1200) {
          applySharedState(msg.state, false);
        }
      }
      return;
    }

    if (msg.type === 'peer_action' || (fromBc && msg.type === 'action')) {
      var sId = msg.senderId || msg.playerId;
      if (sId === playerId) return;
      var sName = msg.senderName || msg.name || 'Partner';
      var act = msg.action;
      var ev = msg.event || (act ? {
        seq: msg.seq || (++seq),
        ts: Date.now(),
        playerId: sId,
        playerName: sName,
        playerLook: typeof msg.senderLook === 'number' ? msg.senderLook : (msg.look || 0),
        day: (S && S.day) || 1,
        kind: act.kind,
        item: act.item || null,
        name: act.name || null,
        icon: act.icon || null,
        cost: act.cost || 0,
        earned: act.earned || 0,
        tip: act.tip || 0,
        dogName: act.dogName || null,
        breed: act.breed || null,
        count: act.count || 1,
        level: act.level || null,
        perfect: !!act.perfect,
        complaint: !!act.complaint,
      } : null);

      if (ev && ev.kind !== 'wave') {
        if (!recentEvents.some(function (x) { return x.seq === ev.seq; })) {
          recentEvents.push(ev);
        }
        if (!inGame) {
          // Player is still on title screen / not logged in yet: queue for login summary!
          if (!unreadEvents.some(function (x) { return x.seq === ev.seq; })) {
            unreadEvents.push(ev);
          }
        } else {
          // Player is actively in-game with partner: mark seen and show live co-op feedback
          ackSeq(ev.seq);
        }
      }

      if (msg.state) {
        roomState = msg.state;
        if (inGame && S) {
          applySharedState(msg.state, true);
        }
      }
      if (inGame && S && act) {
        showLivePartnerAction(sName, act, sId);
      }
      return;
    }

    if (msg.type === 'room_reset' || (fromBc && msg.type === 'new_game')) {
      var rSender = msg.senderId || msg.playerId;
      if (rSender === playerId) return;
      unreadEvents = [];
      recentEvents = [];
      lastSeenSeq = 0;
      if (msg.state) {
        roomState = msg.state;
        if (inGame && S) {
          applySharedState(msg.state, true);
          toast('🔄 ' + (msg.senderName || 'Partner') + ' started a new daycare!', 'good');
        }
      }
      return;
    }
  }

  function syncPeersMap(playersObj) {
    var seen = {};
    for (var pid in playersObj) {
      if (pid === playerId) continue;
      var p = playersObj[pid];
      seen[pid] = true;
      updateSinglePeer(p);
    }
    for (var existingId in peers) {
      if (!seen[existingId]) peers[existingId].online = false;
    }
    updateCoopBadge();
  }

  function updateSinglePeer(p) {
    if (!p || !p.id || p.id === playerId) return;
    var cur = peers[p.id];
    var newlyOnline = (!cur || !cur.online) && p.online;
    if (!cur) {
      cur = peers[p.id] = {
        id: p.id,
        name: p.name || 'Partner',
        look: typeof p.look === 'number' ? p.look : 1,
        x: typeof p.x === 'number' ? p.x : PLAYER_START[0] * TILE + 36,
        y: typeof p.y === 'number' ? p.y : PLAYER_START[1] * TILE,
        tx: typeof p.x === 'number' ? p.x : PLAYER_START[0] * TILE + 36,
        ty: typeof p.y === 'number' ? p.y : PLAYER_START[1] * TILE,
        dir: p.dir || 'down',
        face: p.face || 1,
        moving: !!p.moving,
        walkT: p.walkT || 0,
        walkDist: p.walkDist || 0,
        carry: p.carry || null,
        emote: p.emote || null,
        emoteT: p.emoteT || 0,
        say: '',
        sayT: 0,
        online: p.online !== false,
        inGame: p.inGame !== false,
        lastPacketAt: Date.now(),
      };
    } else {
      cur.name = p.name || cur.name;
      if (typeof p.look === 'number') cur.look = p.look;
      if (typeof p.x === 'number') {
        if (dist(cur.x, cur.y, p.x, p.y) > 220) { cur.x = p.x; cur.y = p.y; }
        cur.tx = p.x;
      }
      if (typeof p.y === 'number') cur.ty = p.y;
      if (p.dir) cur.dir = p.dir;
      if (typeof p.face === 'number') cur.face = p.face;
      cur.moving = !!p.moving;
      if (typeof p.walkDist === 'number') cur.walkDist = p.walkDist;
      if ('carry' in p) cur.carry = p.carry;
      if (p.emote) { cur.emote = p.emote; cur.emoteT = 0; }
      cur.online = p.online !== false;
      cur.inGame = p.inGame !== false;
      cur.lastPacketAt = Date.now();
    }
    if (newlyOnline && inGame && p.inGame) {
      toast('🐾 ' + cur.name + ' joined the daycare!', 'good');
      if (typeof sfx === 'function') sfx('bell');
    }
    updateCoopBadge();
  }

  // ---------------- State Synchronization ----------------
  function serializeSharedState() {
    if (!S) return null;
    var copy = JSON.parse(JSON.stringify(S));
    return copy;
  }

  function applySharedState(incoming, isAction) {
    if (!incoming || !S) return;
    var localP = S.player;
    var oldObjCount = S.objects ? S.objects.length : 0;
    var oldPlotCount = S.plots ? S.plots.length : 0;
    var oldDoneCount = S.objects ? S.objects.filter(function (o) { return o.done; }).length : 0;
    var newDoneCount = incoming.objects ? incoming.objects.filter(function (o) { return o.done; }).length : 0;

    S.cash = incoming.cash;
    S.xp = incoming.xp;
    S.level = incoming.level;
    S.rep = incoming.rep;
    S.day = incoming.day;
    if (typeof incoming.dayTime === 'number') {
      if (isAction || Math.abs(incoming.dayTime - S.dayTime) > 2.5) S.dayTime = incoming.dayTime;
      else S.dayTime = lerp(S.dayTime, incoming.dayTime, 0.35);
    }
    S.closing = !!incoming.closing;
    S.nextId = Math.max(S.nextId || 1, incoming.nextId || 1);
    S.streak = incoming.streak || 0;
    S.bestStreak = Math.max(S.bestStreak || 0, incoming.bestStreak || 0);
    S.totalServed = Math.max(S.totalServed || 0, incoming.totalServed || 0);
    if (incoming.tutorial) Object.assign(S.tutorial, incoming.tutorial);
    if (incoming.tutorialDone) S.tutorialDone = true;
    if (incoming.upgrades) Object.assign(S.upgrades, incoming.upgrades);
    if (incoming.dex) Object.assign(S.dex, incoming.dex);
    if (incoming.specials) Object.assign(S.specials, incoming.specials);
    if (incoming.staff) S.staff = incoming.staff;
    if (incoming.goals && incoming.goals.length) S.goals = incoming.goals;
    if (incoming.life) S.life = incoming.life;
    if (incoming.stats) S.stats = incoming.stats;

    // Objects & plots
    if (Array.isArray(incoming.objects)) {
      S.objects = incoming.objects;
    }
    if (Array.isArray(incoming.plots)) {
      S.plots = incoming.plots;
    }
    if (Array.isArray(incoming.poops)) {
      S.poops = incoming.poops;
    }

    // Reconcile dogs smoothly
    if (Array.isArray(incoming.dogs)) {
      var localDogMap = {};
      S.dogs.forEach(function (d) { localDogMap[d.id] = d; });
      var myLeashedId = (localP && localP.carry && localP.carry.type === 'dog') ? localP.carry.id : null;

      S.dogs = incoming.dogs.map(function (nd) {
        var od = localDogMap[nd.id];
        if (!od) return nd;
        // If local player currently has this dog on leash, keep local leash ownership
        if (myLeashedId === nd.id) {
          nd.state = 'leashed';
          nd.leashedBy = playerId;
          nd.x = od.x;
          nd.y = od.y;
          return nd;
        }
        // Smooth position if walking normally
        if (!isAction && dist(od.x, od.y, nd.x, nd.y) < 90 && nd.state === od.state) {
          nd.x = lerp(od.x, nd.x, 0.45);
          nd.y = lerp(od.y, nd.y, 0.45);
          nd.walkDist = od.walkDist;
        }
        return nd;
      });
    }

    // Reconcile owners smoothly
    if (Array.isArray(incoming.owners)) {
      var localOwnerMap = {};
      S.owners.forEach(function (o) { localOwnerMap[o.id] = o; });
      S.owners = incoming.owners.map(function (no) {
        var oo = localOwnerMap[no.id];
        if (oo && !isAction && dist(oo.x, oo.y, no.x, no.y) < 90 && no.state === oo.state) {
          no.x = lerp(oo.x, no.x, 0.45);
          no.y = lerp(oo.y, no.y, 0.45);
          no.walkDist = oo.walkDist;
          no.walkT = oo.walkT;
        }
        return no;
      });
    }

    S.player = localP;
    if (typeof sanitizeAndMigrateState === 'function') sanitizeAndMigrateState(S);

    if (isAction || S.objects.length !== oldObjCount || S.plots.length !== oldPlotCount || newDoneCount !== oldDoneCount) {
      markDirty(true);
      if (typeof syncStaff === 'function') syncStaff();
      if (typeof UI !== 'undefined' && UI.mode === 'build' && typeof renderBuildPanel === 'function') renderBuildPanel();
    }
    if (typeof saveGame === 'function') saveGame();
  }

  function showLivePartnerAction(partnerName, act, partnerId) {
    var peer = peers[partnerId];
    var px = peer ? peer.x : (S && S.player ? S.player.x : 500);
    var py = peer ? peer.y : (S && S.player ? S.player.y : 500);

    if (act.kind === 'wave') {
      if (peer) {
        peer.emote = 'wave';
        peer.emoteT = 0;
        peer.say = act.text || '👋 Hey there!';
        peer.sayT = 2.6;
        burst(peer.x, peer.y - 45, 'heart', 6);
      }
      toast('👋 ' + partnerName + ': "' + (act.text || 'Hey there!') + '"', 'good');
      if (typeof sfx === 'function') sfx('bark');
      return;
    }
    if (act.kind === 'build') {
      var bx = typeof act.x === 'number' ? (act.x + 1) * TILE : px;
      var by = typeof act.y === 'number' ? (act.y + 1) * TILE : py;
      burst(bx, by, 'dust', 14);
      float(bx, by - 20, '🔨 ' + partnerName + ' built ' + (act.name || 'something'), '#b9f6ca', 1.1);
      toast('🔨 ' + partnerName + ' started building a ' + (act.name || 'structure') + '!', 'good');
      if (typeof sfx === 'function') sfx('place');
    } else if (act.kind === 'rush') {
      toast('⚡ ' + partnerName + ' finished building ' + (act.name || 'a structure') + ' early!', 'good');
      if (typeof sfx === 'function') sfx('built');
    } else if (act.kind === 'sell') {
      toast('💸 ' + partnerName + ' sold ' + (act.name || 'an item') + ' (+' + fmtMoney(act.earned || 0) + ')', '');
    } else if (act.kind === 'plot') {
      toast('🚜 ' + partnerName + ' unlocked ' + (act.name || 'new land') + '!', 'good');
      if (typeof sfx === 'function') sfx('buy');
    } else if (act.kind === 'upgrade') {
      toast((act.icon || '⭐') + ' ' + partnerName + ' bought ' + (act.name || 'an upgrade') + '!', 'good');
      if (typeof sfx === 'function') sfx('buy');
    } else if (act.kind === 'staff') {
      toast((act.icon || '🧑‍💼') + ' ' + partnerName + (act.hired ? ' hired ' : ' let go ') + (act.name || 'staff') + '!', 'good');
    } else if (act.kind === 'checkin') {
      toast('🐕 ' + partnerName + ' checked in ' + (act.dogName || 'a dog') + '!', '');
    } else if (act.kind === 'return') {
      toast('💰 ' + partnerName + ' returned ' + (act.dogName || 'a dog') + ' (+' + fmtMoney(act.earned || 0) + ')', 'good');
      if (typeof sfx === 'function') sfx('coin');
    } else if (act.kind === 'pet' || act.kind === 'feed' || act.kind === 'treat' || act.kind === 'play' || act.kind === 'wash') {
      if (peer) {
        burst(peer.x, peer.y - 34, 'heart', 4);
      }
    } else if (act.kind === 'scoop' || act.kind === 'trash') {
      if (peer) {
        burst(peer.x, peer.y - 10, 'sparkle', 5);
      }
    }
  }

  // ---------------- Outgoing Updates & Actions ----------------
  function update(dt) {
    var nowMs = Date.now();
    // Interpolate remote peers at 60 FPS
    for (var pid in peers) {
      var rp = peers[pid];
      if (!rp.online) continue;
      if (nowMs - (rp.lastPacketAt || 0) > 15000) {
        rp.online = false;
        updateCoopBadge();
        continue;
      }
      rp.sayT = Math.max(0, (rp.sayT || 0) - dt);
      if (rp.emote) {
        rp.emoteT = (rp.emoteT || 0) + dt;
        if (rp.emoteT > 1.3) rp.emote = null;
      }
      var dx = (rp.tx || rp.x) - rp.x;
      var dy = (rp.ty || rp.y) - rp.y;
      var d = Math.sqrt(dx * dx + dy * dy);
      if (d > 0.5) {
        var step = Math.min(d, Math.max(240, d * 10) * dt);
        rp.x += (dx / d) * step;
        rp.y += (dy / d) * step;
        rp.walkDist = (rp.walkDist || 0) + step;
        rp.walkT = (rp.walkT || 0) + dt;
        rp.moving = true;
      } else {
        rp.x = rp.tx || rp.x;
        rp.y = rp.ty || rp.y;
        if (!rp.moving) rp.walkT = 0;
      }
    }

    if (!inGame || !S || !S.player) return;

    // Broadcast local player movement ~15 times/sec when moving, or every 800ms when standing
    var p = S.player;
    var moveInterval = p.moving ? 65 : 750;
    if (nowMs - lastMoveSent >= moveInterval) {
      lastMoveSent = nowMs;
      sendPacket({
        type: 'player_update',
        x: Math.round(p.x * 10) / 10,
        y: Math.round(p.y * 10) / 10,
        dir: p.dir,
        face: p.face,
        moving: !!p.moving,
        walkT: Math.round((p.walkT || 0) * 100) / 100,
        walkDist: Math.round(p.walkDist || 0),
        carry: p.carry,
        emote: p.emote,
        emoteT: p.emoteT || 0,
      }, false);
    }

    // Periodically sync shared world state (every 350ms if host or alone)
    var isHost = !hostId || hostId === playerId || !peers[hostId] || !peers[hostId].online;
    if (isHost && nowMs - lastWorldSent >= 380) {
      lastWorldSent = nowMs;
      sendWorldSync(false);
    }
  }

  function sendWorldSync(alsoHttp) {
    if (!S) return;
    var st = serializeSharedState();
    roomState = st;
    saveLocalRoomFallback(null);
    sendPacket({
      type: 'world_sync',
      rev: rev,
      x: S.player.x,
      y: S.player.y,
      dir: S.player.dir,
      face: S.player.face,
      moving: S.player.moving,
      carry: S.player.carry,
      emote: S.player.emote,
      state: st,
    }, alsoHttp);
  }

  function recordAction(kind, details) {
    if (!S) return;
    lastLocalActionAt = Date.now();
    rev++;
    var act = Object.assign({ kind: kind, day: S.day }, details || {});
    var st = serializeSharedState();
    roomState = st;

    // Local fallback event
    var localEv = null;
    if (kind !== 'wave') {
      seq++;
      localEv = {
        seq: seq,
        ts: Date.now(),
        playerId: playerId,
        playerName: playerName,
        playerLook: playerLook,
        day: S.day,
        kind: kind,
        item: act.item || null,
        name: act.name || null,
        icon: act.icon || null,
        cost: act.cost || 0,
        earned: act.earned || 0,
        tip: act.tip || 0,
        dogName: act.dogName || null,
        breed: act.breed || null,
        count: act.count || 1,
        level: act.level || null,
        perfect: !!act.perfect,
        complaint: !!act.complaint,
      };
      recentEvents.push(localEv);
      lastSeenSeq = Math.max(lastSeenSeq, seq);
      saveTabSession();
    }
    saveLocalRoomFallback(localEv);

    sendPacket({
      type: 'action',
      rev: rev,
      seq: seq,
      action: act,
      event: localEv,
      state: st,
    }, true);
  }

  function ackSeq(newSeq) {
    var target = typeof newSeq === 'number' ? newSeq : seq;
    if (target > lastSeenSeq) {
      lastSeenSeq = target;
      unreadEvents = unreadEvents.filter(function (e) { return e.seq > lastSeenSeq; });
      saveTabSession();
      sendPacket({ type: 'ack_summary', seq: lastSeenSeq }, true);
    }
  }

  // ---------------- Partner Activity Summary Generator ----------------
  function getPartnerEventsForSummary(includeRecentIfUnreadEmpty) {
    loadLocalRoomFallback();
    var evs = unreadEvents.filter(function (e) { return e.playerId !== playerId; });
    if (!evs.length && includeRecentIfUnreadEmpty) {
      evs = recentEvents.filter(function (e) { return e.playerId !== playerId; });
    }
    return evs;
  }

  function hasSummaryToReport() {
    var evs = getPartnerEventsForSummary(false);
    if (evs.length > 0) return true;
    // Also check if another player has recent events and this player has never shown a summary yet
    if (lastSeenSeq === 0) {
      var rec = recentEvents.filter(function (e) { return e.playerId !== playerId; });
      if (rec.length > 0) return true;
    }
    return false;
  }

  function buildPartnerSummary(forceIncludeRecent) {
    var evs = getPartnerEventsForSummary(forceIncludeRecent || lastSeenSeq === 0);
    var partnerNamesMap = {};
    var onlinePartners = [];
    for (var pid in peers) {
      if (peers[pid].online) {
        onlinePartners.push(peers[pid].name);
        partnerNamesMap[peers[pid].name] = peers[pid].look || 0;
      }
    }
    evs.forEach(function (e) {
      if (e.playerName) partnerNamesMap[e.playerName] = typeof e.playerLook === 'number' ? e.playerLook : 0;
    });

    var partnerNames = Object.keys(partnerNamesMap);
    var primaryPartner = partnerNames[0] || 'Your Partner';
    var primaryLook = partnerNamesMap[primaryPartner] != null ? partnerNamesMap[primaryPartner] : ((playerLook + 1) % 4);

    var builtCounts = {};
    var builtIcons = {};
    var plotsUnlocked = [];
    var upgradesBought = [];
    var staffChanges = [];
    var dogsCheckedIn = [];
    var dogsReturned = 0;
    var perfectPickups = 0;
    var cashEarned = 0;
    var cashSpent = 0;
    var tipsEarned = 0;
    var cuddles = 0;
    var feeds = 0;
    var plays = 0;
    var baths = 0;
    var scoops = 0;
    var highestLevel = 0;
    var daysCompleted = 0;

    evs.forEach(function (e) {
      switch (e.kind) {
        case 'build':
          var bName = e.name || e.item || 'Building';
          builtCounts[bName] = (builtCounts[bName] || 0) + 1;
          if (e.icon) builtIcons[bName] = e.icon;
          cashSpent += e.cost || 0;
          break;
        case 'rush':
          cashSpent += e.cost || 0;
          break;
        case 'plot':
          if (e.name && plotsUnlocked.indexOf(e.name) < 0) plotsUnlocked.push(e.name);
          cashSpent += e.cost || 0;
          break;
        case 'upgrade':
          if (e.name && upgradesBought.indexOf(e.name) < 0) upgradesBought.push((e.icon ? e.icon + ' ' : '') + e.name);
          cashSpent += e.cost || 0;
          break;
        case 'staff':
          if (e.name) staffChanges.push((e.icon ? e.icon + ' ' : '') + e.name);
          break;
        case 'checkin':
          if (e.dogName && dogsCheckedIn.indexOf(e.dogName) < 0) dogsCheckedIn.push(e.dogName);
          break;
        case 'return':
          dogsReturned++;
          cashEarned += e.earned || 0;
          tipsEarned += e.tip || 0;
          if (e.perfect) perfectPickups++;
          break;
        case 'pet': cuddles++; break;
        case 'feed':
        case 'treat': feeds++; break;
        case 'play': plays++; break;
        case 'wash': baths++; break;
        case 'scoop':
        case 'trash': scoops += e.count || 1; break;
        case 'levelup':
          if (e.level > highestLevel) highestLevel = e.level;
          break;
        case 'dayend':
          daysCompleted++;
          break;
      }
    });

    // If no discrete events were captured yet, inspect current daycare state S for any improvements beyond starter set
    if (!evs.length && S) {
      var starterCounts = { foodbin: 1, toybox: 1, trash: 1, tub: 1, flowers: 2, bush: 1 };
      (S.objects || []).forEach(function (o) {
        if (starterCounts[o.type] > 0) {
          starterCounts[o.type]--;
        } else if (CAT_BY_ID[o.type]) {
          var c = CAT_BY_ID[o.type];
          builtCounts[c.name] = (builtCounts[c.name] || 0) + 1;
          builtIcons[c.name] = c.icon;
        }
      });
      (S.plots || []).forEach(function (pl) {
        if (pl.id !== 'base') {
          var pDef = PLOTS.filter(function (x) { return x.id === pl.id; })[0];
          if (pDef && plotsUnlocked.indexOf(pDef.name) < 0) plotsUnlocked.push(pDef.name);
        }
      });
      for (var uid in (S.upgrades || {})) {
        if (S.upgrades[uid] && UPG_BY_ID[uid]) upgradesBought.push(UPG_BY_ID[uid].icon + ' ' + UPG_BY_ID[uid].name);
      }
      for (var sid in (S.staff || {})) {
        if (S.staff[sid] && STAFF_BY_ID[sid]) staffChanges.push(STAFF_BY_ID[sid].icon + ' ' + STAFF_BY_ID[sid].name);
      }
      if (S.stats) {
        dogsReturned = S.stats.served || 0;
        cashEarned = S.stats.earned || 0;
        tipsEarned = S.stats.tips || 0;
        cuddles = S.stats.pets || 0;
        feeds = S.stats.feeds || 0;
        plays = S.stats.fetches || 0;
        baths = S.stats.baths || 0;
        scoops = S.stats.scoops || 0;
      }
    }

    var builtList = Object.keys(builtCounts).map(function (name) {
      var n = builtCounts[name];
      var ic = builtIcons[name] || '🔨';
      return ic + ' ' + (n > 1 ? n + '× ' : '') + name;
    });

    // Compose concise natural-language summary paragraph
    var parts = [];
    if (builtList.length) {
      parts.push('built <b>' + builtList.join(', ') + '</b>');
    }
    if (plotsUnlocked.length) {
      parts.push('expanded the yard with <b>' + plotsUnlocked.join(', ') + '</b>');
    }
    if (upgradesBought.length) {
      parts.push('unlocked <b>' + upgradesBought.join(', ') + '</b>');
    }
    if (staffChanges.length) {
      parts.push('hired <b>' + staffChanges.join(', ') + '</b>');
    }
    var careBits = [];
    if (dogsCheckedIn.length) careBits.push('welcomed ' + dogsCheckedIn.length + ' dog' + (dogsCheckedIn.length > 1 ? 's' : '') + ' (' + dogsCheckedIn.slice(0, 4).join(', ') + (dogsCheckedIn.length > 4 ? '…' : '') + ')');
    if (cuddles) careBits.push(cuddles + ' cuddle' + (cuddles > 1 ? 's' : ''));
    if (feeds) careBits.push(feeds + ' meal' + (feeds > 1 ? 's' : ''));
    if (plays) careBits.push(plays + ' game' + (plays > 1 ? 's' : '') + ' of fetch');
    if (baths) careBits.push(baths + ' bath' + (baths > 1 ? 's' : ''));
    if (scoops) careBits.push(scoops + ' poop' + (scoops > 1 ? 's' : '') + ' scooped');
    if (careBits.length) {
      parts.push('looked after the pups (' + careBits.join(', ') + ')');
    }
    if (dogsReturned) {
      parts.push('returned <b>' + dogsReturned + ' dog' + (dogsReturned > 1 ? 's' : '') + '</b> to their owners for <b class="good">' + fmtMoney(cashEarned) + '</b>');
    } else if (cashEarned > 0) {
      parts.push('earned <b class="good">' + fmtMoney(cashEarned) + '</b>');
    }
    if (highestLevel > 1) {
      parts.push('reached <b>Level ' + highestLevel + '</b>');
    }

    var whoText = esc(partnerNames.length > 1 ? partnerNames.join(' & ') : primaryPartner);
    var prose = '';
    if (parts.length === 0) {
      prose = '<b>' + whoText + '</b> is at the daycare keeping watch over the pups on <b>Day ' + ((S && S.day) || 1) + '</b>!';
    } else if (parts.length === 1) {
      prose = 'While you were away, <b>' + whoText + '</b> ' + parts[0] + '.';
    } else {
      var lastPart = parts.pop();
      prose = 'While you were away, <b>' + whoText + '</b> ' + parts.join(', ') + ', and ' + lastPart + '!';
    }

    return {
      partnerName: primaryPartner,
      partnerLook: primaryLook,
      onlinePartners: onlinePartners,
      isPartnerOnline: onlinePartners.length > 0,
      prose: prose,
      builtList: builtList,
      plotsUnlocked: plotsUnlocked,
      upgradesBought: upgradesBought,
      staffChanges: staffChanges,
      dogsCheckedIn: dogsCheckedIn,
      dogsReturned: dogsReturned,
      perfectPickups: perfectPickups,
      cashEarned: cashEarned,
      cashSpent: cashSpent,
      tipsEarned: tipsEarned,
      cuddles: cuddles,
      feeds: feeds,
      plays: plays,
      baths: baths,
      scoops: scoops,
      highestLevel: highestLevel,
      daysCompleted: daysCompleted,
      eventCount: evs.length,
      recentTimeline: evs.slice(-6).reverse(),
    };
  }

  function presentPartnerSummary(manualOpen) {
    var sum = buildPartnerSummary(manualOpen);
    var maxSeq = seq;
    unreadEvents.forEach(function (e) { if (e.seq > maxSeq) maxSeq = e.seq; });
    recentEvents.forEach(function (e) { if (e.seq > maxSeq) maxSeq = e.seq; });
    summaryShownAtSeq = maxSeq;
    ackSeq(maxSeq);

    var portrait = typeof lookPortrait === 'function' ? lookPortrait(sum.partnerLook, 64) : '';
    var statusPill = sum.isPartnerOnline
      ? '<span class="mp-pill online">🟢 ' + esc(sum.onlinePartners.join(' & ')) + ' is playing right now!</span>'
      : '<span class="mp-pill">🐾 Room ' + esc(roomCode) + ' · Shared Daycare Log</span>';

    var impItems = []
      .concat(sum.builtList)
      .concat(sum.plotsUnlocked.map(function (p) { return '🗺️ ' + p; }))
      .concat(sum.upgradesBought)
      .concat(sum.staffChanges);

    var improvementsHTML = impItems.length
      ? '<div class="mp-sum-box"><h4>🔨 Improvements Made</h4><div class="mp-chips">' +
        impItems.map(function (it) { return '<span class="mp-chip">' + esc(it) + '</span>'; }).join('') +
        '</div></div>'
      : '<div class="mp-sum-box"><h4>🔨 Improvements Made</h4><p class="small" style="margin:2px 0">No new buildings placed since your last visit — jump into Build mode together!</p></div>';

    var totalCare = sum.cuddles + sum.feeds + sum.plays + sum.baths + sum.scoops;
    var html =
      '<div class="mp-sum-head">' +
        (portrait ? '<img class="mp-avatar" src="' + portrait + '">' : '') +
        '<div><h2>🐾 What ' + esc(sum.partnerName) + ' Did!</h2>' + statusPill + '</div>' +
      '</div>' +
      '<div class="mp-prose">' + sum.prose + '</div>' +
      improvementsHTML +
      '<div class="stats" style="margin-top:10px">' +
        '<div><span>Dogs welcomed / returned</span><b>' + sum.dogsCheckedIn.length + ' / ' + sum.dogsReturned + '</b></div>' +
        '<div><span>Cash earned by partner</span><b class="money">+' + fmtMoney(sum.cashEarned) + '</b></div>' +
        '<div><span>Care actions (❤️🍖🎾🛁)</span><b>' + (sum.cuddles + sum.feeds + sum.plays + sum.baths) + '</b></div>' +
        '<div><span>Poops scooped (💩)</span><b>' + sum.scoops + '</b></div>' +
        '<div><span>Daycare cash now</span><b class="money">' + fmtMoney(S ? S.cash : 300) + '</b></div>' +
        '<div><span>Daycare level &amp; rep</span><b>Lv ' + (S ? S.level : 1) + ' · ' + (S ? S.rep.toFixed(1) : '3.0') + '★</b></div>' +
      '</div>' +
      '<div class="row">' +
        '<button data-act="back" class="primary big">' + (sum.isPartnerOnline ? '🐾 Play Together with ' + esc(sum.partnerName) + '!' : '🐾 Let\'s Improve the Place!') + '</button>' +
      '</div>';

    openModal(html, 'note', 'mp-summary-card');
    bindModalButtons();
    if (typeof sfx === 'function') sfx('goal');
  }

  // Called when the player clicks Play / Continue on the Title Screen
  function onStartGame(fresh) {
    loadLocalRoomFallback();
    if (fresh) {
      inGame = true;
      if (S) S.player.look = playerLook;
      rev++;
      seq = 0;
      lastSeenSeq = 0;
      unreadEvents = [];
      recentEvents = [];
      roomState = serializeSharedState();
      saveLocalRoomFallback(null);
      sendPacket({ type: 'new_game', state: roomState }, true);
      updateCoopBadge();
      return false;
    }

    var appliedShared = false;
    if (roomState && roomState.version === 2) {
      if (!S) newState();
      applySharedState(roomState, true);
      appliedShared = true;
    }

    inGame = true;
    if (S) S.player.look = playerLook;
    // Offset second player slightly so they don't stand on the exact same pixel at start
    if (S && slot === 2 && dist(S.player.x, S.player.y, PLAYER_START[0] * TILE, PLAYER_START[1] * TILE) < 5) {
      S.player.x = (PLAYER_START[0] + 1.2) * TILE;
    }

    sendJoin();
    updateCoopBadge();

    // Check if the other player has been playing or did actions while we were away
    var partnerOnlineNow = Object.keys(peers).some(function (pid) { return peers[pid].online; });
    if (hasSummaryToReport() || partnerOnlineNow) {
      summaryPending = false;
      setTimeout(function () {
        if (!UI.inTitle && S) presentPartnerSummary(false);
      }, 650);
    } else {
      // Wait briefly in case the join response with unreadEvents arrives over WS a few ms later
      summaryPending = true;
      setTimeout(function () { summaryPending = false; }, 3000);
    }
    return appliedShared;
  }

  // ---------------- Co-op UI & Connect Phone Modal ----------------
  function getJoinUrl() {
    var host = (serverInfo && serverInfo.primaryIp && serverInfo.primaryIp !== 'localhost')
      ? (serverInfo.primaryIp + ':' + (serverInfo.port || location.port || 8000))
      : (location.host || 'localhost:8000');
    var proto = location.protocol === 'https:' ? 'https://' : 'http://';
    return proto + host + '/?room=' + encodeURIComponent(roomCode);
  }

  function getOnlinePeerList() {
    var list = [];
    for (var pid in peers) {
      if (peers[pid].online) list.push(peers[pid]);
    }
    return list;
  }

  function updateCoopBadge() {
    var btn = document.getElementById('coopBtn');
    var badge = document.getElementById('coopBadge');
    var hudPill = document.getElementById('coopHudPill');
    var onlinePeers = getOnlinePeerList();
    if (badge) {
      badge.hidden = onlinePeers.length === 0;
      badge.textContent = String(onlinePeers.length + 1);
    }
    if (btn) {
      btn.classList.toggle('online', onlinePeers.length > 0);
    }
    if (hudPill) {
      if (onlinePeers.length > 0) {
        hudPill.hidden = false;
        hudPill.innerHTML = '🟢 <b>' + esc(onlinePeers.map(function (p) { return p.name; }).join(', ')) + '</b> online · <small>Room ' + esc(roomCode) + '</small>';
      } else {
        hudPill.hidden = false;
        hudPill.innerHTML = '📱 <b>Room ' + esc(roomCode) + '</b> · <small>Tap to connect phone</small>';
      }
    }
  }

  function openCoopModal() {
    fetchServerInfo();
    openModal('', 'coop', 'coop-card');
    renderCoopModal();
  }

  function renderCoopModal() {
    var modal = document.getElementById('modal');
    if (!modal) return;
    var card = modal.querySelector('.card');
    if (!card) return;

    var joinUrl = getJoinUrl();
    var onlinePeers = getOnlinePeerList();
    var looks = (typeof PLAYER_LOOKS !== 'undefined') ? PLAYER_LOOKS : [];

    var peersHtml = '<div class="mp-player-list">' +
      '<div class="mp-p-row me"><img src="' + (typeof lookPortrait === 'function' ? lookPortrait(playerLook, 44) : '') + '">' +
        '<div><b>' + esc(playerName) + ' (You)</b><small>🟢 Connected · Room ' + esc(roomCode) + '</small></div>' +
        (inGame ? '<button class="wood small-btn" id="mpWaveBtn">👋 Wave</button>' : '') +
      '</div>' +
      (onlinePeers.length
        ? onlinePeers.map(function (p) {
            return '<div class="mp-p-row partner"><img src="' + (typeof lookPortrait === 'function' ? lookPortrait(p.look || 0, 44) : '') + '">' +
              '<div><b>' + esc(p.name) + '</b><small>🟢 Playing right now!</small></div>' +
              (inGame ? '<button class="wood small-btn" data-focus-peer="' + esc(p.id) + '">👁️ Find</button>' : '') +
            '</div>';
          }).join('')
        : '<div class="mp-p-row waiting"><span class="mp-wait-ico">📱</span><div><b>Waiting for other phone…</b><small>Scan the QR code or open the link below on another phone or browser tab</small></div></div>') +
      '</div>';

    var charPick = looks.length
      ? '<div class="chars mp-chars">' + looks.map(function (l, i) {
          return '<div class="ch' + (i === playerLook ? ' on' : '') + '" data-mp-look="' + i + '"><img src="' + lookPortrait(i, 48) + '"><small>' + esc(l.name) + '</small></div>';
        }).join('') + '</div>'
      : '';

    card.innerHTML =
      '<div class="dex-head"><h2>📱 Multiplayer Co-op</h2><span class="prog">Room: <b>' + esc(roomCode) + '</b></span><button data-act="back" class="primary">Close</button></div>' +
      '<div class="mp-grid">' +
        '<div class="mp-col">' +
          '<h3>1. Your Keeper Profile</h3>' +
          '<div class="mp-field"><label>Your Name</label><input type="text" id="mpNameInput" maxlength="18" value="' + esc(playerName) + '"></div>' +
          charPick +
          '<div class="mp-field" style="margin-top:8px"><label>Shared Room Code</label>' +
            '<div style="display:flex;gap:6px"><input type="text" id="mpRoomInput" maxlength="8" value="' + esc(roomCode) + '" style="text-transform:uppercase;width:110px;text-align:center;font-weight:800">' +
            '<button class="wood small-btn" id="mpJoinRoomBtn">Join / Switch Room</button></div>' +
          '</div>' +
          '<h3 style="margin-top:12px">2. Players in Daycare</h3>' +
          peersHtml +
          '<div class="row" style="margin-top:10px">' +
            '<button class="wood" id="mpShowSumBtn">📋 View What Partner Did</button>' +
          '</div>' +
        '</div>' +
        '<div class="mp-col mp-qr-col">' +
          '<h3>Connect Another Phone</h3>' +
          '<p class="small" style="margin:2px 0 8px">Point your other phone\'s camera at this QR code (on the same Wi-Fi) or open the link:</p>' +
          '<div class="mp-qr-box"><canvas id="mpQrCanvas" width="176" height="176"></canvas></div>' +
          '<div class="mp-url-box"><code id="mpUrlText">' + esc(joinUrl) + '</code></div>' +
          '<div class="row" style="margin-top:8px">' +
            '<button class="wood small-btn" id="mpCopyUrlBtn">📋 Copy Link</button>' +
            '<button class="wood small-btn" id="mpOpenTabBtn">🗔 Open 2nd Player Tab</button>' +
          '</div>' +
        '</div>' +
      '</div>';

    bindModalButtons();

    var qrCv = document.getElementById('mpQrCanvas');
    if (qrCv) drawQRCode(qrCv, joinUrl);

    var nameInp = document.getElementById('mpNameInput');
    if (nameInp) {
      nameInp.onchange = nameInp.onblur = function () {
        var v = nameInp.value.trim().slice(0, 18);
        if (v) {
          playerName = v;
          saveTabSession();
          sendJoin();
        }
      };
    }

    card.querySelectorAll('[data-mp-look]').forEach(function (el) {
      el.onclick = function () {
        var idx = +el.getAttribute('data-mp-look');
        var looksArr = (typeof PLAYER_LOOKS !== 'undefined') ? PLAYER_LOOKS : [];
        var oldDefault = looksArr[playerLook] && looksArr[playerLook].name;
        playerLook = idx;
        if (typeof UI !== 'undefined') UI.pickLook = idx;
        if (S && S.player) S.player.look = idx;
        if (looksArr[idx] && (!playerName || playerName === oldDefault)) {
          playerName = looksArr[idx].name;
        }
        saveTabSession();
        sendJoin();
        if (typeof sfx === 'function') sfx('click');
        renderCoopModal();
      };
    });

    var joinBtn = document.getElementById('mpJoinRoomBtn');
    var roomInp = document.getElementById('mpRoomInput');
    if (joinBtn && roomInp) {
      joinBtn.onclick = function () {
        var newCode = cleanCode(roomInp.value);
        if (newCode !== roomCode) {
          switchRoom(newCode);
        }
        if (typeof sfx === 'function') sfx('coin');
        renderCoopModal();
      };
    }

    var copyBtn = document.getElementById('mpCopyUrlBtn');
    if (copyBtn) {
      copyBtn.onclick = function () {
        try {
          navigator.clipboard.writeText(joinUrl);
          copyBtn.textContent = '✅ Copied!';
          setTimeout(function () { copyBtn.textContent = '📋 Copy Link'; }, 1800);
        } catch (e) {}
      };
    }

    var openTabBtn = document.getElementById('mpOpenTabBtn');
    if (openTabBtn) {
      openTabBtn.onclick = function () {
        var otherSlot = slot === 1 ? 2 : 1;
        window.open(location.pathname + '?room=' + encodeURIComponent(roomCode) + '&player=' + otherSlot, '_blank');
      };
    }

    var showSumBtn = document.getElementById('mpShowSumBtn');
    if (showSumBtn) {
      showSumBtn.onclick = function () {
        closeModal();
        presentPartnerSummary(true);
      };
    }

    var waveBtn = document.getElementById('mpWaveBtn');
    if (waveBtn) {
      waveBtn.onclick = function () {
        closeModal();
        sendWave();
      };
    }

    card.querySelectorAll('[data-focus-peer]').forEach(function (b) {
      b.onclick = function () {
        var pid = b.getAttribute('data-focus-peer');
        var rp = peers[pid];
        if (rp && typeof UI !== 'undefined') {
          closeModal();
          UI.camFocusPeer = { id: pid, t: 2.5 };
          float(rp.x, rp.y - 85, '▼ ' + rp.name, '#80d8ff', 1.2);
        }
      };
    });
  }

  function switchRoom(newCode) {
    roomCode = cleanCode(newCode);
    peers = {};
    roomState = null;
    unreadEvents = [];
    recentEvents = [];
    lastSeenSeq = 0;
    saveTabSession();
    loadLocalRoomFallback();
    sendJoin();
    updateCoopBadge();
    toast('🐾 Switched to Room ' + roomCode, 'good');
  }

  function sendWave(customText) {
    if (!S || !S.player) return;
    var text = customText || pick(['👋 Hey partner!', '🐾 Looking good!', '❤️ Great teamwork!', '🐕 Let\'s go!']);
    pEmote('wave', 1.1);
    float(S.player.x, S.player.y - 88, text, '#ffe082', 1.1);
    burst(S.player.x, S.player.y - 44, 'heart', 5);
    if (typeof sfx === 'function') sfx('bark');
    recordAction('wave', { text: text });
  }

  function setProfile(name, lookIdx, code) {
    if (typeof lookIdx === 'number') {
      playerLook = lookIdx;
      if (S && S.player) S.player.look = lookIdx;
    }
    if (typeof name === 'string' && name.trim()) {
      playerName = name.trim().slice(0, 18);
    }
    if (typeof code === 'string' && code.trim()) {
      var c = cleanCode(code);
      if (c !== roomCode) switchRoom(c);
    }
    saveTabSession();
    sendJoin();
  }

  // ---------------- Zero-Dependency ISO/IEC 18004 QR Code Generator ----------------
  // Encodes URL strings in Byte Mode (Versions 1..4, ECC Level L) onto a <canvas>
  function drawQRCode(canvas, text) {
    var ctx = canvas.getContext('2d');
    var w = canvas.width, h = canvas.height;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);

    var matrix = encodeQRMatrix(text);
    if (!matrix) return;
    var n = matrix.length;
    var pad = 2;
    var cell = Math.floor(Math.min(w, h) / (n + pad * 2));
    var ox = Math.floor((w - n * cell) / 2);
    var oy = Math.floor((h - n * cell) / 2);

    ctx.fillStyle = '#3b2a20';
    for (var r = 0; r < n; r++) {
      for (var c = 0; c < n; c++) {
        if (matrix[r][c] === 1) {
          ctx.fillRect(ox + c * cell, oy + r * cell, cell, cell);
        }
      }
    }
  }

  function encodeQRMatrix(str) {
    var bytes = [];
    for (var i = 0; i < str.length; i++) {
      var code = str.charCodeAt(i);
      if (code < 128) bytes.push(code);
      else if (code < 2048) { bytes.push(192 | (code >> 6), 128 | (code & 63)); }
      else { bytes.push(224 | (code >> 12), 128 | ((code >> 6) & 63), 128 | (code & 63)); }
    }
    // Version table for ECC Level L: [version, size, dataCodewords, ecCodewords, alignPos]
    var VERS = [
      [1, 21, 19, 7, []],
      [2, 25, 34, 10, [6, 18]],
      [3, 29, 55, 15, [6, 22]],
      [4, 33, 80, 20, [6, 26]],
      [5, 37, 108, 26, [6, 30]],
    ];
    var ver = null;
    for (var vi = 0; vi < VERS.length; vi++) {
      if (bytes.length + 2 <= VERS[vi][2]) { ver = VERS[vi]; break; }
    }
    if (!ver) { bytes = bytes.slice(0, 105); ver = VERS[4]; }

    var size = ver[1], dataLen = ver[2], ecLen = ver[3], align = ver[4];
    var bits = [];
    function pushBits(val, len) {
      for (var b = len - 1; b >= 0; b--) bits.push((val >> b) & 1);
    }
    pushBits(4, 4); // Byte mode = 0100
    pushBits(bytes.length, 8);
    for (var bi = 0; bi < bytes.length; bi++) pushBits(bytes[bi], 8);
    var maxBits = dataLen * 8;
    pushBits(0, Math.min(4, maxBits - bits.length));
    while (bits.length % 8 !== 0) bits.push(0);
    var pads = [0xec, 0x11], pi = 0;
    while (bits.length < maxBits) { pushBits(pads[pi & 1], 8); pi++; }

    var dataWords = [];
    for (var wi = 0; wi < dataLen; wi++) {
      var byteVal = 0;
      for (var b2 = 0; b2 < 8; b2++) byteVal = (byteVal << 1) | bits[wi * 8 + b2];
      dataWords.push(byteVal);
    }

    // GF(256) Reed-Solomon EC calculation
    var exp = new Array(512), log = new Array(256);
    var x = 1;
    for (var gi = 0; gi < 255; gi++) {
      exp[gi] = x; log[x] = gi;
      x <<= 1; if (x & 256) x ^= 0x11d;
    }
    for (var gi2 = 255; gi2 < 512; gi2++) exp[gi2] = exp[gi2 - 255];
    function gfMul(a, b) { return (a === 0 || b === 0) ? 0 : exp[log[a] + log[b]]; }

    var gen = [1];
    for (var ei = 0; ei < ecLen; ei++) {
      var next = new Array(gen.length + 1).fill(0);
      for (var gj = 0; gj < gen.length; gj++) {
        next[gj] ^= gen[gj];
        next[gj + 1] ^= gfMul(gen[gj], exp[ei]);
      }
      gen = next;
    }
    var rem = new Array(ecLen).fill(0);
    for (var di = 0; di < dataWords.length; di++) {
      var factor = dataWords[di] ^ rem[0];
      rem.shift(); rem.push(0);
      for (var rj = 0; rj < ecLen; rj++) rem[rj] ^= gfMul(gen[rj + 1], factor);
    }
    var allWords = dataWords.concat(rem);

    var mat = [], res = [];
    for (var r = 0; r < size; r++) {
      mat.push(new Array(size).fill(0));
      res.push(new Array(size).fill(false));
    }
    function setMod(r, c, v) {
      if (r >= 0 && r < size && c >= 0 && c < size) { mat[r][c] = v ? 1 : 0; res[r][c] = true; }
    }
    function finder(row, col) {
      for (var dr = -1; dr <= 7; dr++) for (var dc = -1; dc <= 7; dc++) {
        var inOuter = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
        var inBorder = dr === 0 || dr === 6 || dc === 0 || dc === 6;
        var inCore = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
        setMod(row + dr, col + dc, inOuter && (inBorder || inCore));
      }
    }
    finder(0, 0); finder(0, size - 7); finder(size - 7, 0);

    if (align.length) {
      for (var ai = 0; ai < align.length; ai++) for (var aj = 0; aj < align.length; aj++) {
        var ar = align[ai], ac = align[aj];
        if (res[ar][ac]) continue;
        for (var dr2 = -2; dr2 <= 2; dr2++) for (var dc2 = -2; dc2 <= 2; dc2++) {
          setMod(ar + dr2, ac + dc2, Math.max(Math.abs(dr2), Math.abs(dc2)) !== 1);
        }
      }
    }
    for (var ti = 8; ti < size - 8; ti++) {
      if (!res[6][ti]) setMod(6, ti, ti % 2 === 0);
      if (!res[ti][6]) setMod(ti, 6, ti % 2 === 0);
    }
    setMod(size - 8, 8, 1);
    for (var fi = 0; fi < 9; fi++) {
      if (!res[8][fi]) res[8][fi] = true;
      if (!res[fi][8]) res[fi][8] = true;
    }
    for (var fi2 = 0; fi2 < 8; fi2++) {
      if (!res[8][size - 1 - fi2]) res[8][size - 1 - fi2] = true;
      if (!res[size - 1 - fi2][8]) res[size - 1 - fi2][8] = true;
    }

    var bitIdx = 0, totalBits = allWords.length * 8;
    var up = true;
    for (var col = size - 1; col >= 1; col -= 2) {
      if (col === 6) col = 5;
      for (var step = 0; step < size; step++) {
        var row = up ? (size - 1 - step) : step;
        for (var dx = 0; dx < 2; dx++) {
          var cc = col - dx;
          if (!res[row][cc]) {
            var bit = 0;
            if (bitIdx < totalBits) {
              bit = (allWords[bitIdx >> 3] >> (7 - (bitIdx & 7))) & 1;
              bitIdx++;
            }
            if ((row + cc) % 2 === 0) bit ^= 1; // Mask 0
            mat[row][cc] = bit;
          }
        }
      }
      up = !up;
    }

    // Format info for ECC Level L (01), Mask 0 (000) -> 0x77c4
    var fmt = 0x77c4;
    var fCoords1 = [[8,0],[8,1],[8,2],[8,3],[8,4],[8,5],[8,7],[8,8],[7,8],[5,8],[4,8],[3,8],[2,8],[1,8],[0,8]];
    var fCoords2 = [[size-1,8],[size-2,8],[size-3,8],[size-4,8],[size-5,8],[size-6,8],[size-7,8],[8,size-8],[8,size-7],[8,size-6],[8,size-5],[8,size-4],[8,size-3],[8,size-2],[8,size-1]];
    for (var fk = 0; fk < 15; fk++) {
      var fb = (fmt >> fk) & 1;
      mat[fCoords1[fk][0]][fCoords1[fk][1]] = fb;
      mat[fCoords2[fk][0]][fCoords2[fk][1]] = fb;
    }
    return mat;
  }

  // Boot identity & connection
  initIdentity();
  setTimeout(connect, 50);

  return {
    get playerId() { return playerId; },
    get playerName() { return playerName; },
    get playerLook() { return playerLook; },
    get roomCode() { return roomCode; },
    get slot() { return slot; },
    get peers() { return peers; },
    get hasRemoteSave() { return !!(roomState && roomState.version === 2); },
    getPeer: function (id) { return peers[id] || null; },
    getOnlinePeers: getOnlinePeerList,
    setProfile: setProfile,
    switchRoom: switchRoom,
    onStartGame: onStartGame,
    update: update,
    recordAction: recordAction,
    sendWorldSync: sendWorldSync,
    sendWave: sendWave,
    openCoopModal: openCoopModal,
    renderCoopModal: renderCoopModal,
    presentPartnerSummary: presentPartnerSummary,
    buildPartnerSummary: buildPartnerSummary,
    hasSummaryToReport: hasSummaryToReport,
    drawQRCode: drawQRCode,
  };
})();
