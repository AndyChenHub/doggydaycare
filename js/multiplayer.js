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

  var mqttWs = null;
  var mqttConnected = false;
  var mqttConnAcked = false;
  var mqttEverConnected = false;
  var mqttFailStreak = 0;
  var mqttPid = 1;
  var mqttRxBuf = new Uint8Array(0);
  var mqttSubTopics = [];
  var mqttPingTimer = null;
  var mqttRetryTimer = null;
  var mqttBrokerIdx = 0;
  var MQTT_BROKERS = [
    'wss://broker.emqx.io:8084/mqtt',
    'wss://broker.hivemq.com:8884/mqtt',
    'wss://test.mosquitto.org:8081'
  ];

  var peers = {};          // playerId -> remote player state with interpolation targets
  var peerAcks = {};       // guestPlayerId -> last processed clientActSeq by Host
  var pendingActions = []; // Guest reliable outbox: [{ seq, pkt, sentAt, tries }]
  var localActSeq = 0;     // monotonic action counter for this client
  var hostAckedActSeq = 0; // highest localActSeq acknowledged by Host
  var roomState = null;    // latest shared state from server
  var unreadEvents = [];   // activity events by other players since lastSeenSeq
  var recentEvents = [];   // recent activity events in the room
  var serverInfo = { port: 8000, ips: ['192.168.15.107'], primaryIp: (location.hostname && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') ? location.hostname : '192.168.15.107', urls: [] };
  var lastMoveSent = 0;
  var lastTickSent = 0;
  var lastWorldSent = 0;
  var lastRetainedSent = 0;
  var lastLocalActionAt = 0;
  var lastResetTs = 0;
  var joiningWaitUntil = 0;
  var awaitingInitialSync = false;
  var joinedAsGuest = false;
  var retainedDebounceTimer = null;
  var lastKnownCash = null;
  var lastKnownHearts = null;
  var lastKnownXp = null;
  var lastKnownLevel = null;
  var lastKnownRep = null;
  var prevSentX = null, prevSentY = null, prevSentAt = 0;
  var lastSentMoving = false, lastSentDir = 'down', lastSentCarrySig = '';
  var lastPingSentAt = 0, peerLatencyMs = 0;
  var pendingRetainedPublish = false;
  var syncSoonTimer = null;
  var browserOnline = (typeof navigator === 'undefined' || navigator.onLine !== false);
  var summaryPending = false;
  var summaryShownAtSeq = 0;

  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('online', function () {
      browserOnline = true;
      mqttBrokerIdx = 0;
      mqttFailStreak = 0;
      connectCloudRelay();
      updateCoopBadge();
    });
    window.addEventListener('offline', function () {
      browserOnline = false;
      mqttConnected = false;
      mqttConnAcked = false;
      connected = false;
      if (mqttWs) { try { mqttWs.close(); } catch (e) {} mqttWs = null; }
      updateCoopBadge();
    });
    window.addEventListener('pageshow', function () {
      handleAppResume();
    });
  }
  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') handleAppResume();
    });
  }

  function handleAppResume() {
    browserOnline = (typeof navigator === 'undefined' || navigator.onLine !== false);
    if (!browserOnline) return;
    if (!mqttWs || mqttWs.readyState !== WebSocket.OPEN || !mqttConnected) {
      reconnectNow();
    } else {
      try { mqttWs.send(new Uint8Array([0xc0, 0x00])); } catch (e) {}
      if (inGame) sendJoin();
    }
  }

  function isCloudReady() {
    if (typeof window !== 'undefined' && window.__HEADLESS_TEST__) {
      return window.__TEST_ONLINE__ !== false;
    }
    var navOn = (typeof navigator === 'undefined' || navigator.onLine !== false) && browserOnline;
    return !!(navOn && mqttConnected && mqttWs && mqttWs.readyState === WebSocket.OPEN);
  }

  function reconnectNow() {
    browserOnline = (typeof navigator === 'undefined' || navigator.onLine !== false);
    if (mqttRetryTimer) { clearTimeout(mqttRetryTimer); mqttRetryTimer = null; }
    if (mqttWs) { try { mqttWs.close(); } catch (e) {} mqttWs = null; }
    mqttConnected = false;
    mqttConnAcked = false;
    mqttBrokerIdx = 0;
    mqttFailStreak = 0;
    connectCloudRelay();
  }

  function computeHostId() {
    var candidates = [];
    if (inGame && playerId && !awaitingInitialSync) {
      candidates.push({ id: playerId, rank: joinedAsGuest ? 1 : 0 });
    }
    for (var pid in peers) {
      var rp = peers[pid];
      if (rp && rp.online && rp.inGame !== false && !rp.awaitingSync) {
        candidates.push({ id: pid, rank: rp.joinedAsGuest ? 1 : 0 });
      }
    }
    if (!candidates.length) {
      if (inGame && playerId) return playerId;
      return hostId || null;
    }
    candidates.sort(function (a, b) {
      if (a.rank !== b.rank) return a.rank - b.rank;
      return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0);
    });
    hostId = candidates[0].id;
    return hostId;
  }

  function isSimHost() {
    if (awaitingInitialSync && joiningWaitUntil > Date.now()) return false;
    if (!inGame) return true;
    var hid = computeHostId();
    return !hid || hid === playerId;
  }

  function snapshotEconomyBaseline() {
    if (!S) return;
    lastKnownCash = S.cash;
    lastKnownHearts = S.hearts || 0;
    lastKnownXp = S.xp || 0;
    lastKnownLevel = S.level || 1;
    lastKnownRep = S.rep || 3.0;
  }

  // ---------------- Identity & Multi-Tab / Multi-Device Slot Assignment ----------------
  function generateSecureRoomCode() {
    var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    var out = '';
    try {
      if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
        var arr = new Uint8Array(6);
        crypto.getRandomValues(arr);
        for (var i = 0; i < 6; i++) out += chars.charAt(arr[i] % chars.length);
        return out;
      }
    } catch (e) {}
    for (var j = 0; j < 6; j++) out += chars.charAt(Math.floor(Math.random() * chars.length));
    return out;
  }

  function safeJsonParse(raw) {
    if (!raw || typeof raw !== 'string' || raw.length > 524288) return null;
    try {
      return JSON.parse(raw, function (k, v) {
        if (k === '__proto__' || k === 'constructor' || k === 'prototype') return undefined;
        return v;
      });
    } catch (e) {
      return null;
    }
  }

  function cleanStr(val, maxLen) {
    if (typeof val !== 'string') return '';
    return val.replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, maxLen || 32);
  }

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
    try { devProfile = safeJsonParse(localStorage.getItem(DEV_KEY) || ''); } catch (e) {}
    if (!devProfile || !devProfile.baseId) {
      if (roomCode === 'PAWS' && !(typeof window !== 'undefined' && window.location && window.location.search.includes('room='))) {
        roomCode = generateSecureRoomCode();
      }
      devProfile = {
        baseId: 'p_' + generateSecureRoomCode() + generateSecureRoomCode(),
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

  // ---------------- Network & Transport (Cloud MQTT-over-WSS + BroadcastChannel + Local Storage) ----------------
  function mqttEncodeLen(len) {
    var out = [];
    do {
      var d = len % 128;
      len = Math.floor(len / 128);
      if (len > 0) d |= 0x80;
      out.push(d);
    } while (len > 0);
    return out;
  }
  function mqttUtf8Bytes(str) {
    if (typeof TextEncoder !== 'undefined') {
      return Array.from(new TextEncoder().encode(str));
    }
    var utf8 = unescape(encodeURIComponent(str));
    var arr = new Array(utf8.length);
    for (var i = 0; i < utf8.length; i++) arr[i] = utf8.charCodeAt(i);
    return arr;
  }
  function mqttUtf8Decode(u8) {
    if (typeof TextDecoder !== 'undefined') {
      return new TextDecoder().decode(u8);
    }
    var s = '';
    for (var i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
    try { return decodeURIComponent(escape(s)); } catch (e) { return s; }
  }
  function mqttEncodeStr(s) {
    var b = mqttUtf8Bytes(s);
    return [(b.length >> 8) & 0xff, b.length & 0xff].concat(b);
  }
  function mqttConnectPacket(clientId) {
    var vh = mqttEncodeStr('MQTT').concat([4, 2, 0, 30]);
    var pl = mqttEncodeStr(clientId);
    var rem = vh.concat(pl);
    return new Uint8Array([0x10].concat(mqttEncodeLen(rem.length), rem));
  }
  function nextMqttPid() {
    mqttPid = (mqttPid % 65000) + 1;
    return mqttPid;
  }
  function mqttSubPacket(topic, pid) {
    var rem = [(pid >> 8) & 0xff, pid & 0xff].concat(mqttEncodeStr(topic), [0]);
    return new Uint8Array([0x82].concat(mqttEncodeLen(rem.length), rem));
  }
  function mqttUnsubPacket(topic, pid) {
    var rem = [(pid >> 8) & 0xff, pid & 0xff].concat(mqttEncodeStr(topic));
    return new Uint8Array([0xa2].concat(mqttEncodeLen(rem.length), rem));
  }
  function mqttPubPacket(topic, payloadStr, retain) {
    var tb = mqttEncodeStr(topic);
    var pb = mqttUtf8Bytes(payloadStr);
    var remLen = tb.length + pb.length;
    var lenBytes = mqttEncodeLen(remLen);
    var out = new Uint8Array(1 + lenBytes.length + remLen);
    var idx = 0;
    out[idx++] = 0x30 | (retain ? 1 : 0);
    for (var i = 0; i < lenBytes.length; i++) out[idx++] = lenBytes[i];
    for (var j = 0; j < tb.length; j++) out[idx++] = tb[j];
    for (var k = 0; k < pb.length; k++) out[idx++] = pb[k];
    return out;
  }
  function mqttAppendRx(chunk) {
    if (!chunk || !chunk.length) return;
    if (!mqttRxBuf.length) {
      mqttRxBuf = chunk;
      return;
    }
    var merged = new Uint8Array(mqttRxBuf.length + chunk.length);
    merged.set(mqttRxBuf, 0);
    merged.set(chunk, mqttRxBuf.length);
    mqttRxBuf = merged;
  }
  function mqttConsumeBuffer(onPacket) {
    var buf = mqttRxBuf;
    var pos = 0;
    while (pos < buf.length) {
      var type = buf[pos];
      var mult = 1, val = 0, idx = pos + 1;
      var incomplete = false;
      var b = 0;
      do {
        if (idx >= buf.length) { incomplete = true; break; }
        b = buf[idx++];
        val += (b & 127) * mult;
        mult *= 128;
        if (mult > 2097152) { mqttRxBuf = new Uint8Array(0); return; } // corrupt stream guard
      } while ((b & 128) !== 0);
      if (incomplete || idx + val > buf.length) break;
      var pType = type & 0xf0;
      if (pType === 0x30) {
        var tLen = (buf[idx] << 8) | buf[idx + 1];
        var topic = mqttUtf8Decode(buf.subarray(idx + 2, idx + 2 + tLen));
        var qos = (type >> 1) & 3;
        var pStart = idx + 2 + tLen + (qos > 0 ? 2 : 0);
        var payload = mqttUtf8Decode(buf.subarray(pStart, idx + val));
        onPacket(0x30, { topic: topic, payload: payload, retain: (type & 1) === 1 });
      } else if (pType === 0x20) {
        onPacket(0x20, { rc: val >= 2 ? buf[idx + 1] : 0 });
      } else if (pType === 0x90) {
        onPacket(0x90, { pid: val >= 2 ? ((buf[idx] << 8) | buf[idx + 1]) : 0 });
      } else if (pType === 0xd0) {
        onPacket(0xd0, {});
      }
      pos = idx + val;
    }
    mqttRxBuf = pos < buf.length ? buf.slice(pos) : new Uint8Array(0);
  }
  function mqttTopicLive(code) { return 'pawsplay/v2/' + cleanCode(code || roomCode) + '/live'; }
  function mqttTopicSnap(code) { return 'pawsplay/v2/' + cleanCode(code || roomCode) + '/snapshot'; }
  function currentBrokerLabel() {
    var u = MQTT_BROKERS[mqttBrokerIdx % MQTT_BROKERS.length] || '';
    if (u.indexOf('emqx') >= 0) return 'emqx';
    if (u.indexOf('hivemq') >= 0) return 'hivemq';
    if (u.indexOf('mosquitto') >= 0) return 'mosquitto';
    return 'cloud';
  }
  function subscribeCurrentRoom(sock) {
    if (!sock || sock.readyState !== WebSocket.OPEN) return;
    try {
      for (var i = 0; i < mqttSubTopics.length; i++) {
        sock.send(mqttUnsubPacket(mqttSubTopics[i], nextMqttPid()));
      }
      var liveT = mqttTopicLive(roomCode);
      var snapT = mqttTopicSnap(roomCode);
      mqttSubTopics = [liveT, snapT];
      sock.send(mqttSubPacket(liveT, nextMqttPid()));
      sock.send(mqttSubPacket(snapT, nextMqttPid()));
    } catch (e) {}
  }

  function connectCloudRelay() {
    if (typeof WebSocket === 'undefined') return;
    if (mqttWs && (mqttWs.readyState === WebSocket.OPEN || mqttWs.readyState === WebSocket.CONNECTING)) return;
    var url = MQTT_BROKERS[mqttBrokerIdx % MQTT_BROKERS.length];
    var sock;
    try {
      sock = new WebSocket(url, 'mqtt');
      sock.binaryType = 'arraybuffer';
    } catch (e) {
      scheduleCloudRetry(false);
      return;
    }
    mqttWs = sock;
    mqttConnAcked = false;
    mqttRxBuf = new Uint8Array(0);
    mqttSubTopics = [];
    var socketEverAuthed = false;
    var connectTimeout = setTimeout(function () {
      if (mqttWs === sock && !mqttConnAcked) {
        try { sock.close(); } catch (e) {}
      }
    }, 6500);

    sock.onopen = function () {
      if (mqttWs !== sock) return;
      try {
        // MQTT 3.1.1 guarantees <=23-byte ClientIds on every broker
        var safeId = playerId.replace(/[^a-zA-Z0-9]/g, '').slice(-12);
        var cid = 'pp_' + safeId + '_' + Math.random().toString(36).slice(2, 6);
        sock.send(mqttConnectPacket(cid));
      } catch (e) {}
    };

    sock.onmessage = function (ev) {
      if (mqttWs !== sock || !ev || !ev.data) return;
      try {
        var u8 = new Uint8Array(ev.data);
        mqttAppendRx(u8);
        mqttConsumeBuffer(function (pType, info) {
          if (pType === 0x20) {
            // CONNACK received — now subscribe to room topics!
            clearTimeout(connectTimeout);
            if (info.rc !== 0) {
              try { sock.close(); } catch (e) {}
              return;
            }
            socketEverAuthed = true;
            mqttConnAcked = true;
            mqttEverConnected = true;
            mqttFailStreak = 0;
            mqttConnected = true;
            connected = true;
            transport = 'cloud';
            subscribeCurrentRoom(sock);
            if (mqttPingTimer) clearInterval(mqttPingTimer);
            mqttPingTimer = setInterval(function () {
              if (mqttWs === sock && sock.readyState === WebSocket.OPEN) {
                try { sock.send(new Uint8Array([0xc0, 0x00])); } catch (e) {}
              }
            }, 15000);
            updateCoopBadge();
            if (typeof UI !== 'undefined' && UI.mode === 'coop') renderCoopModal();
          } else if (pType === 0x90) {
            // SUBACK received — safe to announce presence & flush any pending new-game snapshot!
            if (pendingRetainedPublish && S && !awaitingInitialSync) {
              pendingRetainedPublish = false;
              roomState = serializeSharedState();
              sendPacket({ type: 'new_game', rev: rev, ts: lastResetTs || Date.now(), state: roomState }, true);
              publishRetainedSnapshot(true);
            }
            sendJoin();
            updateCoopBadge();
            if (typeof UI !== 'undefined' && UI.mode === 'coop') renderCoopModal();
          } else if (pType === 0x30) {
            var msg = safeJsonParse(info.payload);
            if (msg) handleIncomingMessage(msg, true);
          }
        });
      } catch (e) {}
    };

    sock.onclose = function () {
      clearTimeout(connectTimeout);
      if (mqttWs === sock) {
        mqttWs = null;
        mqttConnected = false;
        mqttConnAcked = false;
        mqttRxBuf = new Uint8Array(0);
        mqttSubTopics = [];
        if (mqttPingTimer) { clearInterval(mqttPingTimer); mqttPingTimer = null; }
        transport = 'local';
        updateCoopBadge();
        if (typeof UI !== 'undefined' && UI.mode === 'coop') renderCoopModal();
        scheduleCloudRetry(socketEverAuthed);
      }
    };

    sock.onerror = function () {
      try { sock.close(); } catch (e) {}
    };
  }

  function scheduleCloudRetry(wasAuthed) {
    if (mqttRetryTimer) return;
    // Broker Affinity: never split phones across different public MQTT servers after a normal disconnect or iOS background suspend!
    // Always reconnect to the primary broker (idx 0) first; only fail over if primary fails 3 consecutive times.
    if (wasAuthed) {
      mqttBrokerIdx = 0;
      mqttFailStreak = 0;
    } else {
      mqttFailStreak++;
      if (mqttFailStreak >= 3) {
        mqttBrokerIdx = (mqttBrokerIdx + 1) % MQTT_BROKERS.length;
        mqttFailStreak = 0;
      }
    }
    var delay = wasAuthed ? 1200 : 2400;
    mqttRetryTimer = setTimeout(function () {
      mqttRetryTimer = null;
      connectCloudRelay();
    }, delay);
  }

  function publishRetainedSnapshot(force) {
    if (!S || awaitingInitialSync || !mqttWs || mqttWs.readyState !== WebSocket.OPEN || !mqttConnected) return;
    var nowMs = Date.now();
    var waitMs = 1200 - (nowMs - lastRetainedSent);
    if (!force && waitMs > 0) {
      // Trailing-edge debounce: NEVER silently drop a newer snapshot!
      if (!retainedDebounceTimer) {
        retainedDebounceTimer = setTimeout(function () {
          retainedDebounceTimer = null;
          publishRetainedSnapshot(true);
        }, waitMs + 20);
      }
      return;
    }
    if (retainedDebounceTimer) { clearTimeout(retainedDebounceTimer); retainedDebounceTimer = null; }
    try {
      var snap = {
        type: 'retained_snapshot',
        roomCode: roomCode,
        senderId: playerId,
        senderName: playerName,
        senderLook: playerLook,
        rev: rev,
        seq: seq,
        ts: nowMs,
        state: serializeSharedState(),
        recentEvents: recentEvents.slice(-80),
      };
      mqttWs.send(mqttPubPacket(mqttTopicSnap(roomCode), JSON.stringify(snap), true));
      lastRetainedSent = nowMs;
    } catch (e) {}
  }

  function connect() {
    setupBroadcastChannel();
    loadLocalRoomFallback();
    connectCloudRelay();
  }

  function setupBroadcastChannel() {
    if (!bc && typeof BroadcastChannel !== 'undefined') {
      try {
        bc = new BroadcastChannel('paws_play_mp_v1');
        bc.onmessage = function (ev) {
          if (!ev || !ev.data || ev.data.roomCode !== roomCode) return;
          handleIncomingMessage(ev.data, true);
        };
      } catch (e) {}
    }
    if (typeof window !== 'undefined' && window.addEventListener && !setupBroadcastChannel._storageBound) {
      setupBroadcastChannel._storageBound = true;
      window.addEventListener('storage', function (ev) {
        if (!ev || !ev.key) return;
        if (ev.key === ROOM_STORAGE_PREFIX + roomCode && ev.newValue) {
          try {
            var data = JSON.parse(ev.newValue);
            if (data && data.lastSenderId && data.lastSenderId !== playerId && data.state) {
              handleIncomingMessage({
                type: 'world_state',
                roomCode: roomCode,
                senderId: data.lastSenderId,
                rev: data.rev || 1,
                seq: data.seq || 0,
                state: data.state,
                recentEvents: data.activityLog || [],
              }, true);
            }
          } catch (e) {}
        }
      });
    }
  }

  function loadLocalRoomFallback() {
    try {
      var raw = localStorage.getItem(ROOM_STORAGE_PREFIX + roomCode);
      if (!raw) return;
      var data = JSON.parse(raw);
      if (data && data.state && (!roomState || (data.rev || 0) > rev)) {
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
      data.lastSenderId = playerId;
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

  function sendPacket(msg, retainSnapshot) {
    msg.roomCode = roomCode;
    msg.playerId = playerId;
    msg.name = playerName;
    msg.look = playerLook;
    msg.inGame = inGame;
    msg.awaitingSync = !!awaitingInitialSync;
    msg.joinedAsGuest = !!joinedAsGuest;

    // 1. Same-browser tabs via BroadcastChannel
    if (bc) {
      try { bc.postMessage(msg); } catch (e) {}
    }

    // 2. Cross-iPhone / Cross-Device via MQTT-over-WSS Cloud Relay
    if (mqttWs && mqttWs.readyState === WebSocket.OPEN && mqttConnected) {
      try {
        mqttWs.send(mqttPubPacket(mqttTopicLive(roomCode), JSON.stringify(msg), false));
        if (retainSnapshot && S && !awaitingInitialSync) {
          publishRetainedSnapshot(false);
        }
      } catch (e) {}
    }
  }

  function sendPeerHello() {
    sendPacket({
      type: 'peer_update',
      x: S && S.player ? Math.round(S.player.x * 10) / 10 : PLAYER_START[0] * TILE,
      y: S && S.player ? Math.round(S.player.y * 10) / 10 : PLAYER_START[1] * TILE,
      vx: 0,
      vy: 0,
      dir: S && S.player ? S.player.dir : 'down',
      face: S && S.player ? S.player.face : 1,
      moving: !!(S && S.player && S.player.moving),
      carry: S && S.player ? S.player.carry : null,
      emote: S && S.player ? S.player.emote : null,
      emoteT: S && S.player ? (S.player.emoteT || 0) : 0,
    }, false);
  }

  function sendJoin() {
    var waitRemote = awaitingInitialSync || (joiningWaitUntil > Date.now() && !roomState);
    sendPacket({
      type: 'join',
      rev: rev,
      seq: seq,
      x: S && S.player ? Math.round(S.player.x * 10) / 10 : PLAYER_START[0] * TILE,
      y: S && S.player ? Math.round(S.player.y * 10) / 10 : PLAYER_START[1] * TILE,
      dir: S && S.player ? S.player.dir : 'down',
      face: S && S.player ? S.player.face : 1,
      moving: !!(S && S.player && S.player.moving),
      carry: S && S.player ? S.player.carry : null,
      state: (!roomState && S && inGame && !waitRemote) ? serializeSharedState() : undefined,
    }, false);
  }

  function touchPeerFromMessage(msg) {
    if (!msg || typeof msg !== 'object') return;
    var pid = msg.playerId || msg.senderId;
    if (!pid || pid === playerId) return;
    // Do not mark an offline retained snapshot sender as currently online!
    if (msg.type === 'retained_snapshot') return;
    var info = {
      id: pid,
      name: msg.name || msg.senderName,
      look: typeof msg.look === 'number' ? msg.look : (typeof msg.senderLook === 'number' ? msg.senderLook : undefined),
      online: true,
    };
    if ('inGame' in msg) info.inGame = msg.inGame;
    if ('awaitingSync' in msg) info.awaitingSync = !!msg.awaitingSync;
    if ('joinedAsGuest' in msg) info.joinedAsGuest = !!msg.joinedAsGuest;
    if (typeof msg.x === 'number' && typeof msg.y === 'number') {
      info.x = msg.x;
      info.y = msg.y;
    }
    if (typeof msg.vx === 'number') info.vx = msg.vx;
    if (typeof msg.vy === 'number') info.vy = msg.vy;
    if (msg.dir) info.dir = msg.dir;
    if (typeof msg.face === 'number') info.face = msg.face;
    if ('moving' in msg) info.moving = !!msg.moving;
    if (typeof msg.walkT === 'number') info.walkT = msg.walkT;
    if (typeof msg.walkDist === 'number') info.walkDist = msg.walkDist;
    if ('carry' in msg) info.carry = msg.carry;
    if (msg.emote) { info.emote = msg.emote; info.emoteT = msg.emoteT || 0; }
    updateSinglePeer(info);
  }

  function syncSoon(retain) {
    if (!inGame || !S || awaitingInitialSync || !isSimHost()) return;
    if (syncSoonTimer) return;
    syncSoonTimer = setTimeout(function () {
      syncSoonTimer = null;
      if (!inGame || !S || awaitingInitialSync || !isSimHost()) return;
      lastTickSent = Date.now();
      sendLiveTick();
      if (retain) {
        lastWorldSent = Date.now();
        sendWorldSync(true);
      }
    }, 120);
  }

  function hasUnackedLocalAction(acksObj) {
    if (acksObj && typeof acksObj[playerId] === 'number' && acksObj[playerId] > hostAckedActSeq) {
      hostAckedActSeq = acksObj[playerId];
      if (pendingActions.length) {
        pendingActions = pendingActions.filter(function (pa) { return pa.seq > hostAckedActSeq; });
      }
    }
    return pendingActions.length > 0 || (localActSeq > hostAckedActSeq && (Date.now() - lastLocalActionAt < 4500));
  }

  // ---------------- Incoming Message Handling ----------------
  function handleIncomingMessage(msg, fromBc) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.roomCode && cleanCode(msg.roomCode) !== roomCode) return;

    if (typeof msg.rev === 'number' && msg.rev > rev) rev = msg.rev;
    if (typeof msg.seq === 'number' && msg.seq > seq) seq = msg.seq;

    if (msg.players && typeof msg.players === 'object') {
      syncPeersMap(msg.players);
    }

    // Keep partner presence alive and updated from EVERY live message type!
    touchPeerFromMessage(msg);

    if (Array.isArray(msg.recentEvents)) {
      var seenRec = {};
      recentEvents.forEach(function (e) { seenRec[e.seq] = true; });
      msg.recentEvents.forEach(function (e) {
        if (e && typeof e.seq === 'number' && !seenRec[e.seq]) {
          recentEvents.push(e);
          seenRec[e.seq] = true;
        }
        if (e && e.playerId !== playerId && e.seq > lastSeenSeq && !unreadEvents.some(function (u) { return u.seq === e.seq; })) {
          unreadEvents.push(e);
        }
      });
      recentEvents.sort(function (a, b) { return a.seq - b.seq; });
      unreadEvents.sort(function (a, b) { return a.seq - b.seq; });
    }

    if (Array.isArray(msg.unreadEvents) && msg.unreadEvents.length) {
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

    if (msg.type === 'join') {
      if (msg.playerId && msg.playerId !== playerId) {
        if (msg.state && !msg.awaitingSync && (awaitingInitialSync || !roomState || (msg.rev || 0) > rev)) {
          roomState = msg.state;
          if (inGame && S && (awaitingInitialSync || !hasUnackedLocalAction(null))) {
            awaitingInitialSync = false;
            applySharedState(msg.state, false);
          }
        }
        // Immediately reply with our live presence so the partner sees us on screen right away!
        sendPeerHello();
        // If we have authoritative state (not awaiting sync), send full daycare state immediately!
        if (inGame && S && !awaitingInitialSync && (msg.awaitingSync || isSimHost() || rev >= (msg.rev || 0))) {
          sendWorldSync(false);
          sendLiveTick();
        }
        if (typeof UI !== 'undefined' && UI.mode === 'coop') renderCoopModal();
      }
      return;
    }

    if (msg.type === 'new_game') {
      if (msg.playerId && msg.playerId !== playerId && msg.state) {
        lastResetTs = msg.ts || Date.now();
        awaitingInitialSync = false;
        roomState = msg.state;
        rev = Math.max(rev, msg.rev || 1);
        seq = 0;
        lastSeenSeq = 0;
        unreadEvents = [];
        recentEvents = [];
        peerAcks = {};
        if (inGame && S) {
          applySharedState(msg.state, true);
          toast('🔄 Synced New Game from ' + (msg.name || 'partner phone') + '!', 'good');
          sendPeerHello();
        }
      }
      return;
    }

    if (msg.type === 'retained_snapshot' || msg.type === 'joined' || msg.type === 'sync_ack') {
      var snapTs = msg.ts || (msg.state && (msg.state.savedAt || msg.state.created)) || 0;
      if (lastResetTs > 0 && snapTs > 0 && snapTs < lastResetTs) {
        if (S && !awaitingInitialSync) publishRetainedSnapshot(true);
        return;
      }
      var anyOnlineNow = getOnlinePeerList().some(function (rp) { return rp.inGame !== false; });
      if (msg.state && (awaitingInitialSync || !roomState || (msg.rev || 0) >= rev || snapTs > ((S && S.savedAt) || 0))) {
        if (msg.type === 'retained_snapshot' && !anyOnlineNow && typeof clearWaitingOwners === 'function') {
          clearWaitingOwners(msg.state);
        }
        roomState = msg.state;
        rev = Math.max(rev, msg.rev || 1);
        if (inGame && S && msg.senderId !== playerId && (awaitingInitialSync || (!anyOnlineNow && Date.now() - lastLocalActionAt > 900))) {
          var wasAwaiting = awaitingInitialSync;
          awaitingInitialSync = false;
          applySharedState(msg.state, false);
          if (wasAwaiting) sendPeerHello();
        }
      }
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

    if (msg.type === 'ping') {
      if (msg.playerId && msg.playerId !== playerId) {
        sendPacket({ type: 'pong', t0: msg.t0, targetId: msg.playerId }, false);
      }
      return;
    }

    if (msg.type === 'pong') {
      if (msg.targetId === playerId && typeof msg.t0 === 'number') {
        var rtt = Math.max(1, Date.now() - msg.t0);
        peerLatencyMs = peerLatencyMs ? Math.round(peerLatencyMs * 0.6 + rtt * 0.4) : rtt;
        updateCoopBadge();
      }
      return;
    }

    if (msg.type === 'live_tick') {
      if (msg.playerId === playerId) return;
      // Only non-host (Guest) applies live_ticks from the authoritative Sim Host
      if (inGame && S && !isSimHost()) {
        applyLiveTick(msg);
      }
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
          vx: p.vx,
          vy: p.vy,
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
          awaitingSync: !!p.awaitingSync,
        });
      }
      return;
    }

    if (msg.type === 'world_state' || (fromBc && msg.type === 'world_sync')) {
      var sender = msg.senderId || msg.playerId;
      if (sender === playerId) return;
      if (msg.state) {
        var wTs = msg.ts || msg.state.savedAt || msg.state.created || 0;
        if (lastResetTs > 0 && wTs > 0 && wTs < lastResetTs) return;
        roomState = msg.state;
        // Apply world_sync if we are awaiting initial join sync OR we are Guest receiving from Host!
        var pendingLocal = hasUnackedLocalAction(msg.acks);
        if (inGame && S && (awaitingInitialSync || (!isSimHost() && !pendingLocal))) {
          var wasWaiting = awaitingInitialSync;
          awaitingInitialSync = false;
          applySharedState(msg.state, false);
          if (wasWaiting) sendPeerHello();
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
        seq: typeof msg.seq === 'number' ? msg.seq : (++seq),
        ts: Date.now(),
        playerId: cleanStr(sId, 40),
        playerName: cleanStr(sName, 18) || 'Partner',
        playerLook: typeof msg.senderLook === 'number' ? clamp(Math.floor(msg.senderLook), 0, 3) : (typeof msg.look === 'number' ? clamp(Math.floor(msg.look), 0, 3) : 0),
        day: (S && S.day) || 1,
        kind: cleanStr(act.kind, 20),
        item: cleanStr(act.item, 24) || null,
        name: cleanStr(act.name, 32) || null,
        icon: cleanStr(act.icon, 8) || null,
        cost: (typeof act.cost === 'number' && isFinite(act.cost)) ? Math.max(0, Math.floor(act.cost)) : 0,
        earned: (typeof act.earned === 'number' && isFinite(act.earned)) ? Math.max(0, Math.floor(act.earned)) : 0,
        tip: (typeof act.tip === 'number' && isFinite(act.tip)) ? Math.max(0, Math.floor(act.tip)) : 0,
        dogName: cleanStr(act.dogName, 24) || null,
        breed: cleanStr(act.breed, 24) || null,
        count: (typeof act.count === 'number' && isFinite(act.count)) ? clamp(Math.floor(act.count), 1, 20) : 1,
        level: (typeof act.level === 'number' && isFinite(act.level)) ? clamp(Math.floor(act.level), 1, 999) : null,
        perfect: !!act.perfect,
        complaint: !!act.complaint,
      } : null);

      if (ev && ev.kind !== 'wave' && ev.kind !== 'leash' && ev.kind !== 'unleash') {
        if (!recentEvents.some(function (x) { return x.seq === ev.seq; })) {
          recentEvents.push(ev);
        }
        if (!inGame) {
          if (!unreadEvents.some(function (x) { return x.seq === ev.seq; })) {
            unreadEvents.push(ev);
          }
        } else {
          ackSeq(ev.seq);
        }
      }

      if (inGame && S) {
        if (isSimHost()) {
          // Sim Host: NEVER overwrite canonical cash/dogs with Guest's stale snapshot!
          // Apply Guest's exact economy deltas + targeted entity mutations on top of Host state, then broadcast canonical tick/world!
          applyGuestActionOnHost(sId, act, msg.state, msg.clientActSeq);
        } else {
          // Guest receiving Host's action (or another peer's action): apply canonical state while respecting un-acked local deltas!
          var stillPending = hasUnackedLocalAction(msg.acks);
          if (msg.state) {
            roomState = msg.state;
            applySharedState(msg.state, true, act, stillPending);
          }
        }
      } else if (msg.state) {
        roomState = msg.state;
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
      peerAcks = {};
      awaitingInitialSync = false;
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
    computeHostId();
    updateCoopBadge();
  }

  function updateSinglePeer(p) {
    if (!p || !p.id || p.id === playerId) return;
    var cur = peers[p.id];
    var wasOnlineInGame = !!(cur && cur.online && cur.inGame !== false);
    if (!cur) {
      cur = peers[p.id] = {
        id: p.id,
        name: p.name || 'Partner',
        look: typeof p.look === 'number' ? p.look : 1,
        x: typeof p.x === 'number' ? p.x : PLAYER_START[0] * TILE + 36,
        y: typeof p.y === 'number' ? p.y : PLAYER_START[1] * TILE,
        tx: typeof p.x === 'number' ? p.x : PLAYER_START[0] * TILE + 36,
        ty: typeof p.y === 'number' ? p.y : PLAYER_START[1] * TILE,
        vx: typeof p.vx === 'number' ? p.vx : 0,
        vy: typeof p.vy === 'number' ? p.vy : 0,
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
        awaitingSync: !!p.awaitingSync,
        joinedAsGuest: !!p.joinedAsGuest,
        lastPacketAt: Date.now(),
      };
    } else {
      var nowP = Date.now(), dtP = Math.max(0.016, (nowP - (cur.lastPacketAt || nowP)) / 1000);
      if (p.name) cur.name = p.name;
      if (typeof p.look === 'number') cur.look = p.look;
      if (typeof p.x === 'number' && typeof p.y === 'number') {
        if (typeof p.vx === 'number' && typeof p.vy === 'number') {
          cur.vx = p.vx;
          cur.vy = p.vy;
        } else if (dtP < 0.35 && p.moving) {
          cur.vx = (p.x - (cur.tx || cur.x)) / dtP;
          cur.vy = (p.y - (cur.ty || cur.y)) / dtP;
        } else {
          cur.vx = 0;
          cur.vy = 0;
        }
        if (dist(cur.x, cur.y, p.x, p.y) > 220) { cur.x = p.x; cur.y = p.y; }
        cur.tx = p.x;
        cur.ty = p.y;
      }
      if (p.dir) cur.dir = p.dir;
      if (typeof p.face === 'number') cur.face = p.face;
      if ('moving' in p) {
        cur.moving = !!p.moving;
        if (!cur.moving) { cur.vx = 0; cur.vy = 0; }
      }
      if (typeof p.walkDist === 'number') cur.walkDist = p.walkDist;
      if ('carry' in p) cur.carry = p.carry;
      if (p.emote) { cur.emote = p.emote; cur.emoteT = 0; }
      cur.online = p.online !== false;
      if ('inGame' in p) cur.inGame = p.inGame !== false;
      if ('awaitingSync' in p) cur.awaitingSync = !!p.awaitingSync;
      if ('joinedAsGuest' in p) cur.joinedAsGuest = !!p.joinedAsGuest;
      cur.lastPacketAt = nowP;
    }
    computeHostId();
    if (!wasOnlineInGame && cur.online && cur.inGame !== false && inGame) {
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

  function applySharedState(incoming, isAction, remoteAct, protectPendingLocal) {
    if (!incoming || !S) return;
    var localP = S.player;
    var oldObjCount = S.objects ? S.objects.length : 0;
    var oldPlotCount = S.plots ? S.plots.length : 0;
    var oldDoneCount = S.objects ? S.objects.filter(function (o) { return o.done; }).length : 0;
    var newDoneCount = incoming.objects ? incoming.objects.filter(function (o) { return o.done; }).length : 0;
    var concurrentLocalEdit = !!protectPendingLocal || (isAction && (Date.now() - lastLocalActionAt < 1500));

    // Shared Economy: if local player has an unacknowledged spend/earn in flight, preserve local cash + apply remote delta!
    if (concurrentLocalEdit && remoteAct && typeof remoteAct.cashDelta === 'number' && isFinite(remoteAct.cashDelta) && remoteAct.cashDelta !== 0) {
      S.cash = clamp(Math.floor(S.cash + remoteAct.cashDelta), 0, 1e9);
    } else if (concurrentLocalEdit && remoteAct && ((remoteAct.cost || 0) > 0 || (remoteAct.earned || 0) > 0)) {
      var delta = (remoteAct.earned || 0) - (remoteAct.cost || 0);
      S.cash = clamp(Math.floor(S.cash + delta), 0, 1e9);
    } else if (!protectPendingLocal && typeof incoming.cash === 'number' && isFinite(incoming.cash)) {
      S.cash = clamp(Math.floor(incoming.cash), 0, 1e9);
    }

    // Shared Paw Hearts: mirror concurrent delta merge so partner heart gains/spends aren't clobbered
    if (concurrentLocalEdit && remoteAct && typeof remoteAct.heartsDelta === 'number' && isFinite(remoteAct.heartsDelta) && remoteAct.heartsDelta !== 0) {
      S.hearts = clamp(Math.floor((S.hearts || 0) + remoteAct.heartsDelta), 0, 1e9);
    } else if (!protectPendingLocal && typeof incoming.hearts === 'number' && isFinite(incoming.hearts)) {
      S.hearts = clamp(Math.floor(incoming.hearts), 0, 1e9);
    }
    if ('vipMagnet' in incoming) S.vipMagnet = !!(incoming.vipMagnet || (concurrentLocalEdit && S.vipMagnet));

    if (!protectPendingLocal) {
      if (typeof incoming.xp === 'number' && isFinite(incoming.xp)) S.xp = concurrentLocalEdit ? Math.max(S.xp || 0, clamp(Math.floor(incoming.xp), 0, 1e9)) : clamp(Math.floor(incoming.xp), 0, 1e9);
      if (typeof incoming.level === 'number' && isFinite(incoming.level)) S.level = Math.max(concurrentLocalEdit ? (S.level || 1) : 1, clamp(Math.floor(incoming.level), 1, 999));
      if (typeof incoming.rep === 'number' && isFinite(incoming.rep)) S.rep = clamp(incoming.rep, 0.5, 5.0);
    }
    if (typeof incoming.day === 'number' && isFinite(incoming.day)) S.day = clamp(Math.floor(incoming.day), 1, 99999);
    if (typeof incoming.dayTime === 'number' && isFinite(incoming.dayTime)) {
      if (isAction || Math.abs(incoming.dayTime - S.dayTime) > 2.5) S.dayTime = incoming.dayTime;
      else S.dayTime = lerp(S.dayTime, incoming.dayTime, 0.35);
    }
    S.closing = !!incoming.closing;
    S.nextId = Math.max(S.nextId || 1, incoming.nextId || 1);
    S.streak = incoming.streak || 0;
    S.bestStreak = Math.max(S.bestStreak || 0, incoming.bestStreak || 0);
    S.totalServed = Math.max(S.totalServed || 0, incoming.totalServed || 0);
    S.tutorial = Object.assign({}, S.tutorial || {}, incoming.tutorial || {});
    S.tutorialDone = !!(S.tutorialDone || incoming.tutorialDone);
    if (incoming.upgrades && typeof incoming.upgrades === 'object') {
      S.upgrades = S.upgrades || {};
      for (var uk in incoming.upgrades) {
        S.upgrades[uk] = Math.max(S.upgrades[uk] || 0, incoming.upgrades[uk] || 0);
      }
    }
    S.builtPads = Object.assign({}, S.builtPads || {}, incoming.builtPads || {});
    if (incoming.dex) Object.assign(S.dex, incoming.dex);
    if (incoming.specials) Object.assign(S.specials, incoming.specials);
    if (incoming.staff && typeof incoming.staff === 'object') {
      S.staff = concurrentLocalEdit ? Object.assign({}, S.staff || {}, incoming.staff) : JSON.parse(JSON.stringify(incoming.staff));
    }
    if (incoming.staffLvl && typeof incoming.staffLvl === 'object') {
      S.staffLvl = S.staffLvl || {};
      for (var slk in incoming.staffLvl) {
        S.staffLvl[slk] = Math.max(S.staffLvl[slk] || 1, incoming.staffLvl[slk] || 1);
      }
    }
    S.franchiseTier = typeof incoming.franchiseTier === 'number' ? Math.max(concurrentLocalEdit ? (S.franchiseTier || 0) : 0, incoming.franchiseTier) : (S.franchiseTier || 0);
    S.goalWave = typeof incoming.goalWave === 'number' ? Math.max(concurrentLocalEdit ? (S.goalWave || 1) : 1, incoming.goalWave) : (S.goalWave || 1);
    if (incoming.milestones && typeof incoming.milestones === 'object') {
      S.milestones = S.milestones || {};
      for (var mk in incoming.milestones) {
        S.milestones[mk] = Math.max(S.milestones[mk] || 0, incoming.milestones[mk] || 0);
      }
    }
    if ('dailyEvent' in incoming) S.dailyEvent = incoming.dailyEvent;
    if (Array.isArray(incoming.chores)) S.chores = incoming.chores;
    if ('repEvent' in incoming) S.repEvent = incoming.repEvent;
    if (incoming.goals && incoming.goals.length) S.goals = incoming.goals;
    if (incoming.life) S.life = incoming.life;
    if (incoming.stats) S.stats = incoming.stats;
    if (incoming.created) S.created = incoming.created;
    if (incoming.savedAt) S.savedAt = incoming.savedAt;

    // Objects & plots: if concurrentLocalEdit (excluding sell), merge local and incoming objects by id so simultaneous builds both stay
    if (Array.isArray(incoming.objects)) {
      if (concurrentLocalEdit && (!remoteAct || remoteAct.kind !== 'sell')) {
        var mergedObjs = incoming.objects.slice();
        var incomingIds = {};
        mergedObjs.forEach(function (o) { if (o && o.id != null) incomingIds[o.id] = true; });
        (S.objects || []).forEach(function (lo) {
          if (lo && lo.id != null && !incomingIds[lo.id]) mergedObjs.push(lo);
        });
        S.objects = mergedObjs;
      } else {
        S.objects = incoming.objects;
      }
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
        if (myLeashedId === nd.id) {
          nd.state = 'leashed';
          nd.leashedBy = playerId;
          nd.x = od.x;
          nd.y = od.y;
          return nd;
        }
        if (!isAction && dist(od.x, od.y, nd.x, nd.y) < 110 && nd.state === od.state) {
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
        if (oo && !isAction && dist(oo.x, oo.y, no.x, no.y) < 110 && no.state === oo.state) {
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
    snapshotEconomyBaseline();

    if (isAction || S.objects.length !== oldObjCount || S.plots.length !== oldPlotCount || newDoneCount !== oldDoneCount) {
      markDirty(true);
      if (typeof syncStaff === 'function') syncStaff();
      if (typeof UI !== 'undefined' && UI.mode === 'build' && typeof renderBuildPanel === 'function') renderBuildPanel();
    }
    if (typeof saveGame === 'function') {
      try {
        window.__APPLYING_REMOTE_SYNC__ = true;
        saveGame();
      } finally {
        window.__APPLYING_REMOTE_SYNC__ = false;
      }
    }
  }

  // Authoritative Sim Host merge for a Guest's action: applies exact deltas + targeted entity mutations on top of Host's canonical state!
  function applyGuestActionOnHost(senderId, act, incoming, clientActSeq) {
    if (!S || !act) return;
    if (typeof clientActSeq === 'number' && peerAcks[senderId] >= clientActSeq) {
      // Duplicate packet already processed — just re-broadcast ack via live_tick
      sendLiveTick();
      return;
    }
    peerAcks[senderId] = typeof clientActSeq === 'number' ? clientActSeq : ((peerAcks[senderId] || 0) + 1);

    var kind = act.kind || '';
    var structural = false;

    // 1. Exact economy deltas (Host cash/hearts are NEVER overwritten by Guest's stale totals!)
    if (typeof act.cashDelta === 'number' && isFinite(act.cashDelta) && act.cashDelta !== 0) {
      S.cash = clamp(Math.floor(S.cash + act.cashDelta), 0, 1e9);
      if (act.cashDelta > 0) { S.stats.earned = (S.stats.earned || 0) + act.cashDelta; if (S.life) S.life.earned = (S.life.earned || 0) + act.cashDelta; }
      else { S.stats.spent = (S.stats.spent || 0) + Math.abs(act.cashDelta); }
    } else if ((act.cost || 0) > 0 || (act.earned || 0) > 0) {
      var fallbackDelta = (act.earned || 0) - (act.cost || 0);
      if (fallbackDelta !== 0) S.cash = clamp(Math.floor(S.cash + fallbackDelta), 0, 1e9);
    }
    if (typeof act.heartsDelta === 'number' && isFinite(act.heartsDelta) && act.heartsDelta !== 0) {
      S.hearts = clamp(Math.floor((S.hearts || 0) + act.heartsDelta), 0, 1e9);
      if (act.heartsDelta > 0) {
        if (S.stats) S.stats.hearts = (S.stats.hearts || 0) + act.heartsDelta;
        if (S.life) S.life.hearts = (S.life.hearts || 0) + act.heartsDelta;
      }
    }
    if (typeof act.xpDelta === 'number' && isFinite(act.xpDelta) && act.xpDelta > 0) {
      S.xp = (S.xp || 0) + act.xpDelta;
      if (typeof lvlNeed === 'function') {
        while (S.xp >= lvlNeed(S.level)) { S.xp -= lvlNeed(S.level); S.level++; }
      }
    }
    if (typeof act.repDelta === 'number' && isFinite(act.repDelta) && act.repDelta !== 0) {
      S.rep = clamp((S.rep || 3.0) + act.repDelta, 0.5, 5.0);
    }

    // 2. Safe monotonic metadata merges from incoming state or compact act.meta (can never lose Host progress)
    var metaSrc = incoming || (act && act.meta) || null;
    if (metaSrc) {
      S.nextId = Math.max(S.nextId || 1, metaSrc.nextId || 1);
      S.tutorial = Object.assign({}, S.tutorial || {}, metaSrc.tutorial || {});
      S.tutorialDone = !!(S.tutorialDone || metaSrc.tutorialDone);
      S.builtPads = Object.assign({}, S.builtPads || {}, metaSrc.builtPads || {});
      if (metaSrc.dex) Object.assign(S.dex, metaSrc.dex);
      if (metaSrc.specials) Object.assign(S.specials, metaSrc.specials);
      if (metaSrc.upgrades && typeof metaSrc.upgrades === 'object') {
        S.upgrades = S.upgrades || {};
        for (var uk in metaSrc.upgrades) S.upgrades[uk] = Math.max(S.upgrades[uk] || 0, metaSrc.upgrades[uk] || 0);
      }
      if (metaSrc.staffLvl && typeof metaSrc.staffLvl === 'object') {
        S.staffLvl = S.staffLvl || {};
        for (var slk in metaSrc.staffLvl) S.staffLvl[slk] = Math.max(S.staffLvl[slk] || 1, metaSrc.staffLvl[slk] || 1);
      }
      if (typeof metaSrc.franchiseTier === 'number') S.franchiseTier = Math.max(S.franchiseTier || 0, metaSrc.franchiseTier);
      if (metaSrc.milestones && typeof metaSrc.milestones === 'object') {
        S.milestones = S.milestones || {};
        for (var mk in metaSrc.milestones) S.milestones[mk] = Math.max(S.milestones[mk] || 0, metaSrc.milestones[mk] || 0);
      }
      S.bestStreak = Math.max(S.bestStreak || 0, metaSrc.bestStreak || 0);
    }

    function findIn(arr, id) {
      if (!Array.isArray(arr) || id == null) return null;
      for (var i = 0; i < arr.length; i++) if (arr[i] && arr[i].id === id) return arr[i];
      return null;
    }
    function upsertObjById(id) {
      var srcObj = (act && act.objData && act.objData.id === id) ? act.objData : (incoming ? findIn(incoming.objects, id) : null);
      if (!srcObj) return false;
      var cloned = JSON.parse(JSON.stringify(srcObj));
      for (var i = 0; i < S.objects.length; i++) {
        if (S.objects[i].id === id) { S.objects[i] = cloned; return true; }
      }
      S.objects.push(cloned);
      return true;
    }
    function upsertPlotData(pid) {
      var sp = (act && act.plotData && act.plotData.id === pid) ? act.plotData : (incoming ? findIn(incoming.plots, pid) : null);
      if (!sp) return false;
      var clonedP = JSON.parse(JSON.stringify(sp));
      for (var pi = 0; pi < S.plots.length; pi++) {
        if (S.plots[pi].id === pid) { S.plots[pi] = clonedP; return true; }
      }
      S.plots.push(clonedP);
      return true;
    }

    // 3. Targeted entity mutations by action kind
    if (kind === 'build' || kind === 'move' || kind === 'rotate' || kind === 'upgrade_obj' || kind === 'rush' || kind === 'lend_paw' || kind === 'ribbon') {
      structural = true;
      if (act.objId != null) {
        upsertObjById(act.objId);
      } else if (act.plotId) {
        upsertPlotData(act.plotId);
      } else if (kind === 'build' && incoming && Array.isArray(incoming.objects)) {
        var hostIds = {};
        S.objects.forEach(function (o) { hostIds[o.id] = true; });
        incoming.objects.forEach(function (io) {
          if (io && !hostIds[io.id]) S.objects.push(JSON.parse(JSON.stringify(io)));
        });
      }
      markDirty(true);
    } else if (kind === 'sell') {
      structural = true;
      if (act.objId != null) {
        S.objects = S.objects.filter(function (o) { return o.id !== act.objId; });
      }
      markDirty(true);
    } else if (kind === 'plot') {
      structural = true;
      if (act.plotId) {
        upsertPlotData(act.plotId);
      } else if (incoming && Array.isArray(incoming.plots)) {
        incoming.plots.forEach(function (ipl) {
          var existing = findIn(S.plots, ipl.id);
          if (!existing) S.plots.push(JSON.parse(JSON.stringify(ipl)));
          else if (ipl.end < existing.end) existing.end = ipl.end;
        });
      }
      markDirty(true);
    } else if (kind === 'staff') {
      structural = true;
      if (act.item) {
        S.staff = S.staff || {};
        if (act.hired) S.staff[act.item] = true;
        else delete S.staff[act.item];
        if (typeof syncStaff === 'function') syncStaff();
      }
    } else if (kind === 'upgrade' || kind === 'staff_train' || kind === 'franchise' || kind === 'repboost') {
      structural = true;
      markDirty(true);
    } else if (kind === 'heartperk') {
      structural = true;
      if (act.item === 'build_boost' && typeof shaveActiveTimers === 'function') {
        shaveActiveTimers(3600, 'Heart Boost!');
      } else if (act.item === 'joy_party' && typeof boostMoraleAndFriendships === 'function') {
        boostMoraleAndFriendships(null, true);
      } else if (act.item === 'vip_magnet') {
        S.vipMagnet = true;
        S.lastSpecialDay = 0;
        if (S.arrivalTimer > 5) S.arrivalTimer = 5;
      } else if (act.objId != null) {
        upsertObjById(act.objId);
      }
    } else if (kind === 'leash') {
      var ld = findIn(S.dogs, act.dogId);
      if (ld) {
        if (ld.objId) { var prevOb = findIn(S.objects, ld.objId); if (prevOb && prevOb.dogId === ld.id) prevOb.dogId = null; ld.objId = null; }
        ld.state = 'leashed';
        ld.leashedBy = senderId;
        ld.path = null; ld.anim = null; ld.seekObj = null; ld.autoRelease = false;
      }
    } else if (kind === 'unleash') {
      var ud = findIn(S.dogs, act.dogId);
      if (ud && (ud.leashedBy === senderId || ud.state === 'leashed')) {
        ud.state = 'idle';
        ud.idleT = ud.need ? 1e9 : 0.8;
        ud.leashedBy = null;
        ud.path = null;
        if (typeof act.x === 'number' && typeof act.y === 'number') { ud.x = act.x; ud.y = act.y; }
      }
    } else if (kind === 'checkin') {
      structural = true;
      var cd = findIn(S.dogs, act.dogId);
      var icd = (act && act.dogData) || (incoming ? findIn(incoming.dogs, act.dogId) : null);
      if (cd && icd) {
        cd.checkedIn = true; cd.state = icd.state || 'toYard'; cd.route = icd.route || cd.route;
        cd.ownerId = null; cd.leashedBy = null; cd.pickupDay = icd.pickupDay; cd.pickupAt = icd.pickupAt;
      }
      var co = findIn(S.owners, act.ownerId);
      if (co) {
        co.state = 'walkOut'; co.slot = null;
        if (typeof exitRoute === 'function') co.route = exitRoute(co);
      }
    } else if (kind === 'return') {
      structural = true;
      var rd = findIn(S.dogs, act.dogId);
      if (rd) {
        rd.state = 'leaving'; rd.ownerId = act.ownerId || rd.ownerId; rd.anim = null; rd.need = null; rd.route = null; rd.leashedBy = null;
        if (rd.kennelId) { var rk = findIn(S.objects, rd.kennelId); if (rk) rk.reservedFor = null; rd.kennelId = null; }
      }
      var ro = findIn(S.owners, act.ownerId);
      if (ro) {
        ro.state = 'walkOut'; ro.slot = null;
        if (typeof exitRoute === 'function') ro.route = exitRoute(ro);
      }
      S.totalServed = (S.totalServed || 0) + 1;
      if (S.stats) { S.stats.served = (S.stats.served || 0) + 1; S.stats.tips = (S.stats.tips || 0) + (act.tip || 0); if (act.perfect) S.stats.perfect = (S.stats.perfect || 0) + 1; }
      if (S.life) { S.life.served = (S.life.served || 0) + 1; if (act.perfect) S.life.perfect = (S.life.perfect || 0) + 1; }
      if (!act.complaint) S.streak = (S.streak || 0) + 1; else S.streak = 0;
      S.bestStreak = Math.max(S.bestStreak || 0, S.streak || 0);
      if (act.perfect && typeof shaveActiveTimers === 'function') {
        shaveActiveTimers(600 + (typeof franchiseTier === 'function' ? franchiseTier() : 0) * 120, 'PAWSOME!');
      }
    } else if (kind === 'pet' || kind === 'feed' || kind === 'treat' || kind === 'play' || kind === 'wash' || kind === 'kennel') {
      var td = findIn(S.dogs, act.dogId);
      var itd = (act && act.dogData) || (incoming ? findIn(incoming.dogs, act.dogId) : null);
      if (td && itd) {
        td.happy = itd.happy;
        td.need = itd.need;
        td.careCd = itd.careCd;
        td.anim = itd.anim;
        td.animT = 0;
        td.animDur = itd.animDur || 0;
        if (kind === 'wash' || kind === 'kennel') {
          if (td.objId && td.objId !== itd.objId) {
            var oldOb = findIn(S.objects, td.objId);
            if (oldOb && oldOb.dogId === td.id) oldOb.dogId = null;
          }
          td.state = itd.state; td.actT = itd.actT; td.objId = itd.objId; td.leashedBy = null; td.x = itd.x; td.y = itd.y;
          var newOb = findIn(S.objects, itd.objId);
          if (newOb) newOb.dogId = td.id;
        } else if (kind === 'feed' || kind === 'play') {
          td.state = itd.state; td.actT = itd.actT; td.path = null;
        }
      }
      if (S.stats) {
        if (kind === 'pet') S.stats.pets = (S.stats.pets || 0) + 1;
        else if (kind === 'feed' || kind === 'treat') S.stats.feeds = (S.stats.feeds || 0) + 1;
        else if (kind === 'play') S.stats.fetches = (S.stats.fetches || 0) + 1;
        else if (kind === 'wash') S.stats.baths = (S.stats.baths || 0) + 1;
      }
    } else if (kind === 'scoop') {
      if (act.poopId != null) {
        S.poops = S.poops.filter(function (pp) { return pp.id !== act.poopId; });
      } else if (typeof act.x === 'number' && typeof act.y === 'number') {
        var bestIdx = -1, bestD = 75;
        for (var ppi = 0; ppi < S.poops.length; ppi++) {
          var pd = dist(S.poops[ppi].x, S.poops[ppi].y, act.x, act.y);
          if (pd < bestD) { bestD = pd; bestIdx = ppi; }
        }
        if (bestIdx >= 0) S.poops.splice(bestIdx, 1);
      }
      if (S.stats) S.stats.scoops = (S.stats.scoops || 0) + 1;
    } else if (kind === 'chore') {
      if (act.choreId != null && Array.isArray(S.chores)) {
        S.chores = S.chores.filter(function (ch) { return ch.id !== act.choreId; });
      }
      structural = true;
    } else if (kind === 'repevent') {
      S.repEvent = null;
      if (!act.complaint && typeof shaveActiveTimers === 'function') shaveActiveTimers(900, 'Event!');
      structural = true;
    } else if (kind === 'dayend' && incoming && incoming.day > S.day) {
      applySharedState(incoming, true, act, false);
      return;
    }

    if (typeof sanitizeAndMigrateState === 'function') sanitizeAndMigrateState(S);
    snapshotEconomyBaseline();
    if (typeof UI !== 'undefined' && UI.mode === 'build' && typeof renderBuildPanel === 'function') renderBuildPanel();

    // Immediately save locally and broadcast Host's canonical state + ack back to Guest!
    if (typeof saveGame === 'function') {
      try {
        window.__APPLYING_REMOTE_SYNC__ = true;
        saveGame();
      } finally {
        window.__APPLYING_REMOTE_SYNC__ = false;
      }
    }
    rev++;
    lastTickSent = Date.now();
    sendLiveTick();
    if (structural) {
      lastWorldSent = Date.now();
      sendWorldSync(true);
    }
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
    } else if (act.kind === 'lend_paw') {
      toast('🤝 ' + partnerName + ' lent a paw on ' + (act.name || 'a project') + '!', 'good');
      if (typeof sfx === 'function') sfx('perfect');
    } else if (act.kind === 'ribbon') {
      toast('🎀 ' + partnerName + ' cut the ribbon on ' + (act.name || 'a new build') + '!', 'good');
      if (typeof sfx === 'function') sfx('built');
    } else if (act.kind === 'heartperk') {
      toast((act.icon || '💛') + ' ' + partnerName + ' used ' + (act.name || 'a Paw Heart boost') + '!', 'good');
      if (typeof sfx === 'function') sfx('perfect');
    } else if (act.kind === 'move' || act.kind === 'rotate') {
      var mx = typeof act.x === 'number' ? (act.x + 1) * TILE : px;
      var my = typeof act.y === 'number' ? (act.y + 1) * TILE : py;
      burst(mx, my, 'dust', 12);
      toast((act.kind === 'rotate' ? '🔄 ' : '↔️ ') + partnerName + (act.kind === 'rotate' ? ' rotated ' : ' moved ') + (act.name || 'an item') + '!', '');
    } else if (act.kind === 'upgrade_obj') {
      toast('⬆️ ' + partnerName + ' started upgrading ' + (act.name || 'a building') + ' (-' + fmtMoney(act.cost || 0) + ')!', 'good');
      if (typeof sfx === 'function') sfx('place');
    } else if (act.kind === 'staff_train') {
      toast('⬆️ ' + partnerName + ' trained ' + (act.name || 'staff') + ' (-' + fmtMoney(act.cost || 0) + ')!', 'good');
      if (typeof sfx === 'function') sfx('level');
    } else if (act.kind === 'franchise') {
      toast('🏆 ' + partnerName + ' promoted daycare to ' + (act.name || 'new tier') + ' (-' + fmtMoney(act.cost || 0) + ')!', 'good');
      if (typeof sfx === 'function') sfx('level');
    } else if (act.kind === 'repboost') {
      toast((act.icon || '⭐') + ' ' + partnerName + ' ran ' + (act.name || 'a promotion') + ' (-' + fmtMoney(act.cost || 0) + ')!', 'good');
      if (typeof sfx === 'function') sfx('perfect');
    } else if (act.kind === 'chore' || act.kind === 'repevent') {
      if (act.earned > 0) toast((act.icon || '✨') + ' ' + partnerName + ': ' + (act.name || 'completed task') + ' (+' + fmtMoney(act.earned) + ')', 'good');
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

  // Compact 4 Hz authoritative entity & economy tick (includes full dog/owner/poop reconciliation + action acks)
  function sendLiveTick() {
    if (!S || awaitingInitialSync) return;
    sendPacket({
      type: 'live_tick',
      rev: rev,
      acks: Object.assign({}, peerAcks),
      x: S.player ? Math.round(S.player.x * 10) / 10 : undefined,
      y: S.player ? Math.round(S.player.y * 10) / 10 : undefined,
      dir: S.player ? S.player.dir : undefined,
      face: S.player ? S.player.face : undefined,
      moving: !!(S.player && S.player.moving),
      carry: S.player ? S.player.carry : null,
      cash: S.cash,
      hearts: S.hearts || 0,
      rep: Math.round(S.rep * 100) / 100,
      level: S.level,
      xp: S.xp,
      day: S.day,
      dayTime: Math.round(S.dayTime * 10) / 10,
      closing: !!S.closing,
      streak: S.streak || 0,
      totalServed: S.totalServed || 0,
      dogs: (S.dogs || []).map(function (d) {
        return {
          id: d.id, x: Math.round(d.x), y: Math.round(d.y), face: d.face, moving: !!d.moving, state: d.state,
          happy: Math.round(d.happy || 75), need: d.need, called: !!d.called, checkedIn: !!d.checkedIn,
          leashedBy: d.leashedBy || null, npcHolder: d.npcHolder || null, objId: d.objId || null,
          kennelId: d.kennelId || null, ownerId: d.ownerId || null, anim: d.anim || null,
          actT: Math.round((d.actT || 0) * 10) / 10, pickupDay: d.pickupDay, pickupAt: d.pickupAt,
          breed: d.breed, name: d.name, coat: d.coat, traits: d.traits, fav: d.fav, quirk: d.quirk,
          collar: d.collar, overnight: !!d.overnight, special: d.special || null, title: d.title || null,
          speed: d.speed, moraleBoost: !!d.moraleBoost, specialId: d.specialId || null
        };
      }),
      owners: (S.owners || []).map(function (o) {
        return {
          id: o.id, dogId: o.dogId, kind: o.kind, name: o.name, look: o.look, slot: o.slot,
          x: Math.round(o.x), y: Math.round(o.y), dir: o.dir, moving: !!o.moving,
          state: o.state, patience: Math.round(o.patience), patienceMax: Math.round(o.patienceMax || 90),
          hoT: Math.round((o.hoT || 0) * 100) / 100, angry: !!o.angry, byStaff: !!o.byStaff,
          emote: o.emote || null, say: o.sayT > 0 ? o.say : '', sayT: Math.max(0, Math.round((o.sayT || 0) * 10) / 10)
        };
      }),
      poops: (S.poops || []).map(function (pp) {
        return { id: pp.id, x: Math.round(pp.x), y: Math.round(pp.y), age: Math.round((pp.age || 0) * 10) / 10, seed: pp.seed || 0 };
      })
    }, false);
  }

  function applyLiveTick(tick) {
    if (!tick || !S) return;
    var pendingLocal = hasUnackedLocalAction(tick.acks);
    if (!pendingLocal) {
      if (typeof tick.cash === 'number' && isFinite(tick.cash)) S.cash = clamp(Math.floor(tick.cash), 0, 1e9);
      if (typeof tick.hearts === 'number' && isFinite(tick.hearts)) S.hearts = clamp(Math.floor(tick.hearts), 0, 1e9);
      if (typeof tick.rep === 'number' && isFinite(tick.rep)) S.rep = clamp(tick.rep, 0.5, 5.0);
      if (typeof tick.level === 'number' && isFinite(tick.level)) S.level = Math.max(S.level || 1, clamp(Math.floor(tick.level), 1, 999));
      if (typeof tick.xp === 'number' && isFinite(tick.xp)) S.xp = clamp(Math.floor(tick.xp), 0, 1e9);
      if (typeof tick.streak === 'number') S.streak = tick.streak;
      if (typeof tick.totalServed === 'number') S.totalServed = Math.max(S.totalServed || 0, tick.totalServed);
      snapshotEconomyBaseline();
    }
    if (typeof tick.day === 'number' && tick.day > S.day) {
      S.day = tick.day;
      S.dayTime = typeof tick.dayTime === 'number' ? tick.dayTime : 0;
      S.closing = !!tick.closing;
    } else if (typeof tick.dayTime === 'number' && isFinite(tick.dayTime) && tick.day === S.day) {
      if (Math.abs(tick.dayTime - S.dayTime) > 2.5) S.dayTime = tick.dayTime;
      else S.dayTime = lerp(S.dayTime, tick.dayTime, 0.35);
      S.closing = !!tick.closing;
    }

    var myLeashedId = (S.player && S.player.carry && S.player.carry.type === 'dog') ? S.player.carry.id : null;
    if (Array.isArray(tick.dogs)) {
      var dMap = {};
      (S.dogs || []).forEach(function (d) { dMap[d.id] = d; });
      var nextDogs = [];
      var occObj = {};
      tick.dogs.forEach(function (td) {
        var ld = dMap[td.id];
        if (!ld) {
          // Brand-new dog spawned by Host: materialize immediately on Guest!
          ld = {
            id: td.id, breed: td.breed, name: td.name || 'Pup', coat: td.coat || 0,
            traits: Array.isArray(td.traits) ? td.traits : [], fav: td.fav || 'pets', quirk: td.quirk || '',
            collar: td.collar || '#d9574a', overnight: !!td.overnight, special: td.special || null,
            title: td.title || null, speed: td.speed || 95, moraleBoost: !!td.moraleBoost, specialId: td.specialId || null,
            x: td.x, y: td.y, ox: 0, oy: 0, face: td.face || 1, moving: !!td.moving, curSpeed: 0, walkDist: 0,
            state: td.state || 'arriving', happy: typeof td.happy === 'number' ? td.happy : 80,
            needs: { clean: 90 }, need: td.need || null, called: !!td.called, checkedIn: !!td.checkedIn,
            leashedBy: td.leashedBy || null, npcHolder: td.npcHolder || null, objId: td.objId || null,
            kennelId: td.kennelId || null, ownerId: td.ownerId || null, anim: td.anim || null, animT: 0, animDur: 0,
            actT: td.actT || 0, pickupDay: td.pickupDay || S.day, pickupAt: td.pickupAt || 200,
            petCd: 0, mood: 0, bark: 3, idleT: 1, stepped: [], path: null, route: null
          };
          if (td.id >= (S.nextId || 1)) S.nextId = td.id + 1;
        } else if (myLeashedId === ld.id) {
          // Keep local player's active leash position & state smooth
          ld.state = 'leashed';
          ld.leashedBy = playerId;
          if (!pendingLocal) {
            ld.happy = typeof td.happy === 'number' ? td.happy : ld.happy;
            if ('need' in td) ld.need = td.need;
            ld.called = !!td.called;
          }
        } else {
          var gap = dist(ld.x, ld.y, td.x, td.y);
          if (gap < 150) {
            var nx = lerp(ld.x, td.x, 0.55);
            var ny = lerp(ld.y, td.y, 0.55);
            ld.walkDist = (ld.walkDist || 0) + dist(ld.x, ld.y, nx, ny);
            ld.x = nx; ld.y = ny;
          } else {
            ld.x = td.x; ld.y = td.y;
          }
          ld.face = td.face || ld.face;
          ld.moving = !!td.moving || gap > 6;
          if (!pendingLocal) {
            ld.state = td.state || ld.state;
            ld.happy = typeof td.happy === 'number' ? td.happy : ld.happy;
            if ('need' in td) ld.need = td.need;
            ld.called = !!td.called;
            ld.checkedIn = !!td.checkedIn;
            ld.leashedBy = td.leashedBy || null;
            ld.npcHolder = td.npcHolder || null;
            ld.objId = td.objId || null;
            ld.kennelId = td.kennelId || null;
            ld.ownerId = td.ownerId || null;
            ld.anim = td.anim || null;
            ld.actT = typeof td.actT === 'number' ? td.actT : ld.actT;
            if (td.pickupDay != null) ld.pickupDay = td.pickupDay;
            if (td.pickupAt != null) ld.pickupAt = td.pickupAt;
          }
        }
        if (ld.objId && (ld.state === 'bath' || ld.state === 'kennel')) occObj[ld.objId] = ld.id;
        nextDogs.push(ld);
      });
      S.dogs = nextDogs;
      // Clear local leash carry if that dog actually left the daycare on Host
      if (myLeashedId && !S.dogs.some(function (d) { return d.id === myLeashedId; })) {
        S.player.carry = null;
      }
      // Keep station occupancy (bath tub / kennel dogId) synced with Host
      if (Array.isArray(S.objects)) {
        S.objects.forEach(function (o) {
          if (o && (o.type === 'tub' || o.type === 'groomhouse' || o.type === 'kennel')) {
            o.dogId = occObj[o.id] || null;
          }
        });
      }
    }

    if (Array.isArray(tick.owners)) {
      var oMap = {};
      (S.owners || []).forEach(function (o) { oMap[o.id] = o; });
      var nextOwners = [];
      tick.owners.forEach(function (to) {
        var lo = oMap[to.id];
        if (!lo) {
          lo = {
            id: to.id, dogId: to.dogId, kind: to.kind || 'dropoff', name: to.name || 'Owner',
            look: to.look || 0, slot: to.slot, x: to.x, y: to.y, dir: to.dir || 'up',
            moving: !!to.moving, walkT: 0, walkDist: 0, state: to.state || 'walkIn',
            patience: to.patience || 80, patienceMax: to.patienceMax || 90,
            hoT: to.hoT || 0, angry: !!to.angry, byStaff: !!to.byStaff,
            emote: to.emote || null, emoteT: 0, say: to.say || '', sayT: to.sayT || 0, route: []
          };
          if (to.id >= (S.nextId || 1)) S.nextId = to.id + 1;
        } else {
          // If local Guest is actively standing on handover mat with this owner, don't reset their local handover progress!
          var localHandover = lo.state === 'handover' && !lo.byStaff && typeof playerOnMat === 'function' && playerOnMat();
          var ogap = dist(lo.x, lo.y, to.x, to.y);
          if (ogap < 150) {
            var ox = lerp(lo.x, to.x, 0.55);
            var oy = lerp(lo.y, to.y, 0.55);
            lo.walkDist = (lo.walkDist || 0) + dist(lo.x, lo.y, ox, oy);
            lo.x = ox; lo.y = oy;
          } else {
            lo.x = to.x; lo.y = to.y;
          }
          lo.dir = to.dir || lo.dir;
          lo.moving = !!to.moving || ogap > 6;
          if (!localHandover && !pendingLocal) {
            lo.state = to.state || lo.state;
            if (typeof to.hoT === 'number') lo.hoT = to.hoT;
          }
          if (typeof to.patience === 'number') lo.patience = to.patience;
          if (typeof to.patienceMax === 'number') lo.patienceMax = to.patienceMax;
          lo.angry = !!to.angry;
          lo.byStaff = !!to.byStaff;
          if (to.emote) lo.emote = to.emote;
          if (to.say && to.sayT > 0 && !lo.sayT) { lo.say = to.say; lo.sayT = to.sayT; }
        }
        nextOwners.push(lo);
      });
      S.owners = nextOwners;
    }

    if (Array.isArray(tick.poops) && !pendingLocal) {
      S.poops = tick.poops.map(function (pp) {
        return { id: pp.id, x: pp.x, y: pp.y, age: pp.age || 0, seed: pp.seed || 0 };
      });
    }
  }

  // ---------------- Outgoing Updates & Actions ----------------
  function update(dt) {
    var nowMs = Date.now();
    // If joining an empty/brand-new room with no retained snapshot and no partner after 4s, clear awaitingInitialSync
    if (awaitingInitialSync && joiningWaitUntil > 0 && nowMs > joiningWaitUntil) {
      awaitingInitialSync = false;
      computeHostId();
    }

    // Interpolate remote peers at 60 FPS with velocity dead-reckoning (client-side prediction)
    var anyPartnerOnline = false;
    var peerChanged = false;
    for (var pid in peers) {
      var rp = peers[pid];
      if (!rp.online) continue;
      if (nowMs - (rp.lastPacketAt || 0) > 15000) {
        rp.online = false;
        peerChanged = true;
        continue;
      }
      anyPartnerOnline = true;
      rp.sayT = Math.max(0, (rp.sayT || 0) - dt);
      if (rp.emote) {
        rp.emoteT = (rp.emoteT || 0) + dt;
        if (rp.emoteT > 1.3) rp.emote = null;
      }
      // Dead-reckoning: while moving and within 220ms of last packet, extrapolate target position by (vx, vy)
      var ageSec = (nowMs - (rp.lastPacketAt || nowMs)) / 1000;
      if (rp.moving && ageSec < 0.22 && (rp.vx || rp.vy)) {
        var predX = (rp.tx || rp.x) + rp.vx * dt;
        var predY = (rp.ty || rp.y) + rp.vy * dt;
        if (typeof canStand === 'function' ? canStand(predX, predY) : true) {
          rp.tx = predX;
          rp.ty = predY;
        }
      }
      var dx = (rp.tx || rp.x) - rp.x;
      var dy = (rp.ty || rp.y) - rp.y;
      var d = Math.sqrt(dx * dx + dy * dy);
      if (d > 0.4) {
        var step = Math.min(d, Math.max(265, d * 12) * dt);
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
    if (peerChanged) {
      computeHostId();
      updateCoopBadge();
    }

    if (!inGame || !S || !S.player) return;

    // Broadcast local player movement at 10 Hz (100ms) while moving (stays well below public MQTT rate limits!)
    // or immediately on start/stop/direction/carry change, plus a 2s idle heartbeat so partner presence never times out.
    var p = S.player;
    var carrySig = p.carry ? (p.carry.type + ':' + (p.carry.id || p.carry.n || 1)) : '';
    var stateChanged = (!!p.moving !== lastSentMoving) || (p.dir !== lastSentDir) || (carrySig !== lastSentCarrySig);
    var moveInterval = p.moving ? 100 : 2000;
    if (stateChanged || nowMs - lastMoveSent >= moveInterval) {
      var dtSent = Math.max(0.016, (nowMs - (prevSentAt || nowMs)) / 1000);
      var vx = (p.moving && prevSentX != null) ? Math.round((p.x - prevSentX) / dtSent) : 0;
      var vy = (p.moving && prevSentY != null) ? Math.round((p.y - prevSentY) / dtSent) : 0;
      prevSentX = p.x; prevSentY = p.y; prevSentAt = nowMs;
      lastSentMoving = !!p.moving; lastSentDir = p.dir; lastSentCarrySig = carrySig;
      lastMoveSent = nowMs;
      sendPacket({
        type: 'player_update',
        x: Math.round(p.x * 10) / 10,
        y: Math.round(p.y * 10) / 10,
        vx: clamp(vx, -450, 450),
        vy: clamp(vy, -450, 450),
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

    // Measure peer ping every 4 seconds when a partner is online
    if (anyPartnerOnline && nowMs - lastPingSentAt >= 4000) {
      lastPingSentAt = nowMs;
      sendPacket({ type: 'ping', t0: nowMs }, false);
    }

    // Authoritative Sim Host broadcasts 4 Hz compact entity+economy ticks & periodic full snapshots
    var hostNow = isSimHost();
    // Guest reliable outbox: automatically retransmit any un-acked Guest action every 750ms over QoS 0 MQTT (deduplicated on Host!)
    if (!hostNow && anyPartnerOnline && pendingActions.length) {
      for (var ai = pendingActions.length - 1; ai >= 0; ai--) {
        var pa = pendingActions[ai];
        if (pa.seq <= hostAckedActSeq || pa.tries >= 6) {
          pendingActions.splice(ai, 1);
          continue;
        }
        if (nowMs - pa.sentAt >= 750) {
          pa.sentAt = nowMs;
          pa.tries++;
          sendPacket(pa.pkt, false);
        }
      }
    } else if (hostNow && pendingActions.length) {
      pendingActions = [];
    }
    if (hostNow && !awaitingInitialSync && anyPartnerOnline && nowMs - lastTickSent >= 250) {
      lastTickSent = nowMs;
      sendLiveTick();
    }
    if (hostNow && !awaitingInitialSync && nowMs - lastWorldSent >= 4500) {
      lastWorldSent = nowMs;
      sendWorldSync(true);
    }
  }

  function sendWorldSync(alsoHttp) {
    if (!S || awaitingInitialSync) return;
    var st = serializeSharedState();
    roomState = st;
    saveLocalRoomFallback(null);
    sendPacket({
      type: 'world_sync',
      rev: rev,
      acks: Object.assign({}, peerAcks),
      x: S.player ? Math.round(S.player.x * 10) / 10 : undefined,
      y: S.player ? Math.round(S.player.y * 10) / 10 : undefined,
      dir: S.player ? S.player.dir : undefined,
      face: S.player ? S.player.face : undefined,
      moving: !!(S.player && S.player.moving),
      carry: S.player ? S.player.carry : null,
      emote: S.player ? S.player.emote : null,
      state: st,
    }, !!alsoHttp && isSimHost());
  }

  function recordAction(kind, details) {
    if (!S) return;
    lastLocalActionAt = Date.now();
    rev++;
    localActSeq++;
    var cashDelta = (typeof lastKnownCash === 'number' && isFinite(lastKnownCash)) ? (S.cash - lastKnownCash) : 0;
    var heartsDelta = (typeof lastKnownHearts === 'number' && isFinite(lastKnownHearts)) ? ((S.hearts || 0) - lastKnownHearts) : 0;
    var xpDelta = 0;
    if (typeof lastKnownXp === 'number' && typeof lastKnownLevel === 'number') {
      if ((S.level || 1) === lastKnownLevel) xpDelta = Math.max(0, (S.xp || 0) - lastKnownXp);
      else if ((S.level || 1) > lastKnownLevel && typeof lvlNeed === 'function') {
        xpDelta = Math.max(0, lvlNeed(lastKnownLevel) - lastKnownXp + (S.xp || 0));
      }
    }
    var repDelta = (typeof lastKnownRep === 'number' && isFinite(lastKnownRep)) ? Math.round(((S.rep || 3.0) - lastKnownRep) * 1000) / 1000 : 0;
    snapshotEconomyBaseline();

    var act = Object.assign({
      kind: kind,
      day: S.day,
      cashDelta: cashDelta,
      heartsDelta: heartsDelta,
      xpDelta: xpDelta,
      repDelta: repDelta,
    }, details || {});
    var hostNow = isSimHost();

    // For Guest actions while Host is online, attach ONLY compact targeted entity data (~500 bytes instead of 25 KB!)
    // so QoS 0 public MQTT never fragments or drops Guest actions!
    var st = hostNow ? serializeSharedState() : null;
    if (hostNow) {
      roomState = st;
    } else {
      if (act.objId != null && Array.isArray(S.objects)) {
        for (var oi = 0; oi < S.objects.length; oi++) {
          if (S.objects[oi].id === act.objId) { act.objData = JSON.parse(JSON.stringify(S.objects[oi])); break; }
        }
      }
      if (act.plotId && Array.isArray(S.plots)) {
        for (var pi = 0; pi < S.plots.length; pi++) {
          if (S.plots[pi].id === act.plotId) { act.plotData = JSON.parse(JSON.stringify(S.plots[pi])); break; }
        }
      }
      if (act.dogId != null && Array.isArray(S.dogs)) {
        for (var di = 0; di < S.dogs.length; di++) {
          if (S.dogs[di].id === act.dogId) {
            var gd = S.dogs[di];
            act.dogData = {
              id: gd.id, happy: gd.happy, need: gd.need, careCd: gd.careCd, anim: gd.anim, animDur: gd.animDur,
              state: gd.state, actT: gd.actT, objId: gd.objId, leashedBy: gd.leashedBy, x: gd.x, y: gd.y,
              checkedIn: gd.checkedIn, route: gd.route, pickupDay: gd.pickupDay, pickupAt: gd.pickupAt
            };
            break;
          }
        }
      }
      act.meta = {
        nextId: S.nextId,
        tutorial: S.tutorial,
        tutorialDone: S.tutorialDone,
        builtPads: S.builtPads,
        upgrades: S.upgrades,
        staffLvl: S.staffLvl,
        franchiseTier: S.franchiseTier,
        bestStreak: S.bestStreak,
      };
    }

    var localEv = null;
    if (kind !== 'wave' && kind !== 'leash' && kind !== 'unleash') {
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

    if (hostNow) hostAckedActSeq = localActSeq;
    var retainNow = hostNow && !awaitingInitialSync && kind !== 'wave' && kind !== 'leash' && kind !== 'unleash';
    var pkt = {
      type: 'action',
      rev: rev,
      seq: seq,
      clientActSeq: localActSeq,
      fromHost: hostNow,
      acks: hostNow ? Object.assign({}, peerAcks) : undefined,
      x: S.player ? Math.round(S.player.x * 10) / 10 : undefined,
      y: S.player ? Math.round(S.player.y * 10) / 10 : undefined,
      dir: S.player ? S.player.dir : undefined,
      face: S.player ? S.player.face : undefined,
      moving: !!(S.player && S.player.moving),
      carry: S.player ? S.player.carry : null,
      action: act,
      event: localEv,
      state: st,
    };
    if (!hostNow && kind !== 'wave') {
      pendingActions.push({ seq: localActSeq, pkt: pkt, sentAt: Date.now(), tries: 1 });
      if (pendingActions.length > 20) pendingActions.shift();
    }
    sendPacket(pkt, retainNow);
    if (retainNow) lastWorldSent = Date.now();
  }

  function ackSeq(newSeq) {
    var target = typeof newSeq === 'number' ? newSeq : seq;
    if (target > lastSeenSeq) {
      lastSeenSeq = target;
      unreadEvents = unreadEvents.filter(function (e) { return e.seq > lastSeenSeq; });
      saveTabSession();
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
    var pawsLent = [];
    var ribbonsCut = [];
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
        case 'lend_paw':
          if (e.name && pawsLent.indexOf(e.name) < 0) pawsLent.push(e.name);
          break;
        case 'ribbon':
          if (e.name && ribbonsCut.indexOf(e.name) < 0) ribbonsCut.push(e.name);
          break;
        case 'heartperk':
          if (e.name && upgradesBought.indexOf(e.name) < 0) upgradesBought.push((e.icon ? e.icon + ' ' : '💛 ') + e.name);
          break;
        case 'plot':
          if (e.name && plotsUnlocked.indexOf(e.name) < 0) plotsUnlocked.push(e.name);
          cashSpent += e.cost || 0;
          break;
        case 'upgrade':
        case 'upgrade_obj':
        case 'franchise':
        case 'repboost':
          if (e.name && upgradesBought.indexOf(e.name) < 0) upgradesBought.push((e.icon ? e.icon + ' ' : '') + e.name);
          cashSpent += e.cost || 0;
          break;
        case 'staff':
        case 'staff_train':
          if (e.name) staffChanges.push((e.icon ? e.icon + ' ' : '') + e.name);
          cashSpent += e.cost || 0;
          break;
        case 'chore':
        case 'repevent':
          cashEarned += e.earned || 0;
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

    // Compose concise natural-language summary paragraph (all user/network strings strictly HTML-escaped!)
    var parts = [];
    if (builtList.length) {
      parts.push('built <b>' + builtList.map(esc).join(', ') + '</b>');
    }
    if (plotsUnlocked.length) {
      parts.push('expanded the yard with <b>' + plotsUnlocked.map(esc).join(', ') + '</b>');
    }
    if (pawsLent.length) {
      parts.push('lent a paw to speed up <b>' + pawsLent.map(esc).join(', ') + '</b>');
    }
    if (ribbonsCut.length) {
      parts.push('cut the grand-opening ribbon on <b>' + ribbonsCut.map(esc).join(', ') + '</b>');
    }
    if (upgradesBought.length) {
      parts.push('unlocked <b>' + upgradesBought.map(esc).join(', ') + '</b>');
    }
    if (staffChanges.length) {
      parts.push('hired <b>' + staffChanges.map(esc).join(', ') + '</b>');
    }
    var careBits = [];
    if (dogsCheckedIn.length) careBits.push('welcomed ' + dogsCheckedIn.length + ' dog' + (dogsCheckedIn.length > 1 ? 's' : '') + ' (' + dogsCheckedIn.slice(0, 4).map(esc).join(', ') + (dogsCheckedIn.length > 4 ? '…' : '') + ')');
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
    if (fresh) {
      inGame = true;
      awaitingInitialSync = false;
      joinedAsGuest = false;
      joiningWaitUntil = 0;
      lastResetTs = Date.now();
      lastLocalActionAt = lastResetTs;
      peerAcks = {};
      if (S) {
        S.player.look = playerLook;
        S.objects = [];
        S.chores = [];
        S.created = lastResetTs;
        S.savedAt = lastResetTs;
        snapshotEconomyBaseline();
      }
      rev = Math.max(rev, (roomState && roomState.rev) || 0) + 1000;
      seq = 0;
      lastSeenSeq = 0;
      unreadEvents = [];
      recentEvents = [];
      try { localStorage.removeItem(ROOM_STORAGE_PREFIX + roomCode); } catch (e) {}
      roomState = serializeSharedState();
      saveLocalRoomFallback(null);
      if (mqttConnected && mqttWs && mqttWs.readyState === WebSocket.OPEN) {
        pendingRetainedPublish = false;
        sendPacket({ type: 'new_game', rev: rev, ts: lastResetTs, state: roomState }, true);
        publishRetainedSnapshot(true);
      } else {
        pendingRetainedPublish = true;
      }
      computeHostId();
      sendJoin();
      updateCoopBadge();
      return false;
    }

    loadLocalRoomFallback();
    var appliedShared = false;
    if (roomState && roomState.version === 2) {
      var rTs = roomState.savedAt || roomState.created || 0;
      var lTs = (S && (S.savedAt || S.created)) || 0;
      if (!S) newState();
      if (awaitingInitialSync || rTs >= lTs || (S.objects && S.objects.length === 0 && Array.isArray(roomState.objects) && roomState.objects.length > 0)) {
        awaitingInitialSync = false;
        applySharedState(roomState, true);
        appliedShared = true;
      }
    }

    inGame = true;
    if (S) {
      S.player.look = playerLook;
      snapshotEconomyBaseline();
    }
    // Offset second player slightly so they don't stand on the exact same pixel at start
    if (S && slot === 2 && dist(S.player.x, S.player.y, PLAYER_START[0] * TILE, PLAYER_START[1] * TILE) < 5) {
      S.player.x = (PLAYER_START[0] + 1.2) * TILE;
    }

    computeHostId();
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
        hudPill.innerHTML = '🟢 <b>' + esc(onlinePeers.map(function (p) { return p.name; }).join(', ')) + '</b>';
      } else {
        hudPill.hidden = false;
        hudPill.innerHTML = '📱 <b>' + esc(roomCode) + '</b>';
      }
    }
  }

  function openCoopModal() {
    if (!mqttConnected) connectCloudRelay();
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
    var pingTxt = peerLatencyMs > 0 ? (' · ⚡ ' + peerLatencyMs + 'ms') : '';
    var roleTxt = onlinePeers.length ? (isSimHost() ? ' · 👑 Host' : ' · 🐾 Synced') : '';
    var netBadge = mqttConnected
      ? '🟢 Cloud Sync (' + currentBrokerLabel() + ') · Room ' + esc(roomCode) + roleTxt + pingTxt
      : '🟡 Reconnecting… · Room ' + esc(roomCode) + pingTxt;

    var peersHtml = '<div class="mp-player-list">' +
      '<div class="mp-p-row me"><img src="' + (typeof lookPortrait === 'function' ? lookPortrait(playerLook, 44) : '') + '">' +
        '<div><b>' + esc(playerName) + ' (You)</b><small>' + netBadge + '</small></div>' +
        (inGame ? '<button class="wood small-btn" id="mpWaveBtn">👋 Wave</button>' : '') +
      '</div>' +
      (onlinePeers.length
        ? onlinePeers.map(function (p) {
            return '<div class="mp-p-row partner"><img src="' + (typeof lookPortrait === 'function' ? lookPortrait(p.look || 0, 44) : '') + '">' +
              '<div><b>' + esc(p.name) + '</b><small>🟢 Playing right now!</small></div>' +
              (inGame ? '<button class="wood small-btn" data-focus-peer="' + esc(p.id) + '">👁️ Find</button>' : '') +
            '</div>';
          }).join('')
        : '<div class="mp-p-row waiting"><span class="mp-wait-ico">📱</span><div><b>Waiting for partner iPhone…</b><small>Enter Room Code <b>' + esc(roomCode) + '</b> on another iPhone (works over Wi-Fi or 5G!)</small></div></div>') +
      '</div>';

    var charPick = looks.length
      ? '<div class="chars mp-chars">' + looks.map(function (l, i) {
          return '<div class="ch' + (i === playerLook ? ' on' : '') + '" data-mp-look="' + i + '"><img src="' + lookPortrait(i, 48) + '"><small>' + esc(l.name) + '</small></div>';
        }).join('') + '</div>'
      : '';

    card.innerHTML =
      '<div class="dex-head"><h2>📱 iPhone Co-op</h2><span class="prog">Room: <b>' + esc(roomCode) + '</b></span><button data-act="back" class="primary">Close</button></div>' +
      '<div class="mp-grid">' +
        '<div class="mp-col">' +
          '<h3>1. Your Keeper Profile</h3>' +
          '<div class="mp-field"><label>Your Name</label><input type="text" id="mpNameInput" maxlength="18" value="' + esc(playerName) + '"></div>' +
          charPick +
          '<div class="mp-field" style="margin-top:8px"><label>Shared Room Code</label>' +
            '<div style="display:flex;gap:6px"><input type="text" id="mpRoomInput" maxlength="8" value="' + esc(roomCode) + '" style="text-transform:uppercase;width:110px;text-align:center;font-weight:800">' +
            '<button class="wood small-btn" id="mpJoinRoomBtn">Join Room</button></div>' +
          '</div>' +
          '<h3 style="margin-top:12px">2. Players in Daycare</h3>' +
          peersHtml +
          '<div class="row" style="margin-top:10px">' +
            '<button class="wood" id="mpShowSumBtn">📋 View What Partner Did</button>' +
          '</div>' +
        '</div>' +
        '<div class="mp-col mp-qr-col">' +
          '<h3>Connect Another iPhone</h3>' +
          '<p class="small" style="margin:2px 0 8px">Enter Room Code <b>' + esc(roomCode) + '</b> in the app on another iPhone, or scan this QR code on Wi-Fi:</p>' +
          '<div class="mp-qr-box"><canvas id="mpQrCanvas" width="160" height="160"></canvas></div>' +
          '<div class="mp-url-box"><code id="mpUrlText">' + esc(joinUrl) + '</code></div>' +
          '<div class="row" style="margin-top:8px">' +
            '<button class="wood small-btn" id="mpCopyUrlBtn">📋 Copy Link</button>' +
            (location.protocol === 'http:' || location.protocol === 'https:' ? '<button class="wood small-btn" id="mpOpenTabBtn">➕ Open 2nd Player Tab</button>' : '') +
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
        window.open(location.pathname + '?room=' + encodeURIComponent(roomCode) + '&player=' + otherSlot, '_blank', 'noopener,noreferrer');
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

  function switchRoom(newCode, isJoiningExisting) {
    roomCode = cleanCode(newCode);
    peers = {};
    peerAcks = {};
    pendingActions = [];
    hostId = null;
    roomState = null;
    unreadEvents = [];
    recentEvents = [];
    lastSeenSeq = 0;
    if (isJoiningExisting) {
      lastResetTs = 0;
      lastLocalActionAt = 0;
      awaitingInitialSync = true;
      joinedAsGuest = true;
      joiningWaitUntil = Date.now() + 4500;
    } else {
      awaitingInitialSync = false;
      joinedAsGuest = false;
      joiningWaitUntil = 0;
    }
    saveTabSession();
    loadLocalRoomFallback();
    if (roomState && roomState.version === 2 && !isJoiningExisting) {
      awaitingInitialSync = false;
    }
    if (mqttWs && mqttWs.readyState === WebSocket.OPEN && mqttConnected) {
      subscribeCurrentRoom(mqttWs);
    } else {
      connectCloudRelay();
    }
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
    get roomState() { return roomState; },
    get hostId() { return computeHostId(); },
    get hasRemoteSave() { return !!(roomState && roomState.version === 2); },
    isSimHost: isSimHost,
    isCloudReady: isCloudReady,
    reconnectNow: reconnectNow,
    syncSoon: syncSoon,
    getPeer: function (id) { return peers[id] || null; },
    getOnlinePeers: getOnlinePeerList,
    setProfile: setProfile,
    switchRoom: switchRoom,
    generateRoomCode: generateSecureRoomCode,
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
