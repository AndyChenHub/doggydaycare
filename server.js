'use strict';
/**
 * Paws & Play — Doggy Daycare Multiplayer & Static Server
 * Zero-dependency Node.js HTTP + RFC 6455 WebSocket server.
 * - Serves static game files on http://0.0.0.0:8000
 * - Provides real-time co-op multiplayer rooms via WebSocket (/ws) + HTTP fallback (/api/*)
 * - Persists shared daycare state and partner activity logs to saves/room_<CODE>.json
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const url = require('url');

const PORT = parseInt(process.env.PORT || '8000', 10);
const ROOT_DIR = __dirname;
const SAVE_DIR = path.join(ROOT_DIR, 'saves');

if (!fs.existsSync(SAVE_DIR)) {
  try { fs.mkdirSync(SAVE_DIR, { recursive: true }); } catch (e) {}
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

// ---------------- LAN IP Discovery ----------------
function getLanIPs() {
  const nets = os.networkInterfaces();
  const candidates = [];
  for (const name of Object.keys(nets)) {
    const lower = name.toLowerCase();
    const isVirtual = lower.includes('wsl') || lower.includes('hyper-v') || lower.includes('vethernet') || lower.includes('docker') || lower.includes('vbox') || lower.includes('vmware');
    for (const net of nets[name] || []) {
      const fam = typeof net.family === 'string' ? net.family : String(net.family);
      if ((fam === 'IPv4' || fam === '4') && !net.internal && net.address !== '127.0.0.1') {
        let priority = isVirtual ? 3 : 1;
        if (net.address.startsWith('192.168.') || net.address.startsWith('10.')) priority -= 0.5;
        candidates.push({ address: net.address, name, priority });
      }
    }
  }
  candidates.sort((a, b) => a.priority - b.priority);
  return candidates.map(c => c.address);
}

// ---------------- Room State & Persistence ----------------
const rooms = new Map();

function cleanRoomCode(raw) {
  const s = String(raw || 'PAWS').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  return s || 'PAWS';
}

function roomSavePath(code) {
  return path.join(SAVE_DIR, 'room_' + cleanRoomCode(code) + '.json');
}

function getRoom(rawCode) {
  const code = cleanRoomCode(rawCode);
  if (rooms.has(code)) return rooms.get(code);

  const room = {
    code,
    rev: 1,
    seq: 0,
    hostId: null,
    state: null,
    players: {},       // playerId -> { id, name, look, x, y, dir, face, moving, walkT, walkDist, carry, emote, emoteT, online, inGame, lastSeenAt, lastSeenSeq }
    activityLog: [],   // [{ seq, ts, playerId, playerName, playerLook, kind, ... }]
    clients: new Set(),
    saveTimer: null,
    updatedAt: Date.now(),
  };

  // Load persisted state from disk if available
  const file = roomSavePath(code);
  if (fs.existsSync(file)) {
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (data && typeof data === 'object') {
        room.rev = data.rev || 1;
        room.seq = data.seq || 0;
        room.state = data.state || null;
        room.activityLog = Array.isArray(data.activityLog) ? data.activityLog.slice(-400) : [];
        if (data.players && typeof data.players === 'object') {
          for (const pid of Object.keys(data.players)) {
            const p = data.players[pid];
            room.players[pid] = {
              id: pid,
              name: p.name || 'Keeper',
              look: typeof p.look === 'number' ? p.look : 0,
              x: p.x || 427,
              y: p.y || 1164,
              dir: p.dir || 'down',
              face: p.face || 1,
              moving: false,
              walkT: 0,
              walkDist: p.walkDist || 0,
              carry: null,
              emote: null,
              emoteT: 0,
              online: false,
              inGame: false,
              lastSeenAt: p.lastSeenAt || 0,
              lastSeenSeq: p.lastSeenSeq || 0,
            };
          }
        }
      }
    } catch (e) {
      console.error('Failed to load room save:', code, e.message);
    }
  }

  rooms.set(code, room);
  return room;
}

function saveRoomToDisk(room, immediate) {
  if (!room) return;
  const writeNow = () => {
    room.saveTimer = null;
    try {
      const payload = {
        code: room.code,
        rev: room.rev,
        seq: room.seq,
        updatedAt: Date.now(),
        state: room.state,
        players: room.players,
        activityLog: room.activityLog.slice(-400),
      };
      fs.writeFileSync(roomSavePath(room.code), JSON.stringify(payload));
    } catch (e) {
      console.error('Error saving room', room.code, e.message);
    }
  };
  if (immediate) {
    if (room.saveTimer) clearTimeout(room.saveTimer);
    writeNow();
  } else if (!room.saveTimer) {
    room.saveTimer = setTimeout(writeNow, 1500);
  }
}

function refreshRoomPresence(room) {
  const now = Date.now();
  for (const pid of Object.keys(room.players)) {
    const p = room.players[pid];
    // Mark offline if no WS client and no HTTP poll in last 10s
    let hasWs = false;
    for (const c of room.clients) {
      if (c.playerId === pid && !c.closed) { hasWs = true; break; }
    }
    if (!hasWs && now - (p.lastSeenAt || 0) > 10000) {
      p.online = false;
      p.inGame = false;
      p.moving = false;
    }
  }
  // Elect host: prefer an online player who is currently inGame
  const curHost = room.hostId && room.players[room.hostId];
  if (!curHost || !curHost.online || !curHost.inGame) {
    let best = null;
    for (const pid of Object.keys(room.players)) {
      const p = room.players[pid];
      if (p.online && p.inGame) { best = pid; break; }
    }
    if (!best) {
      for (const pid of Object.keys(room.players)) {
        const p = room.players[pid];
        if (p.online) { best = pid; break; }
      }
    }
    room.hostId = best;
  }
}

function ensurePlayer(room, msg) {
  const pid = String(msg.playerId || 'p_default');
  let p = room.players[pid];
  if (!p) {
    const existingCount = Object.keys(room.players).length;
    const defLook = typeof msg.look === 'number' ? msg.look : (existingCount % 4);
    const defNames = ['Sam', 'Maya', 'Kai', 'Lily'];
    p = room.players[pid] = {
      id: pid,
      name: msg.name || defNames[defLook] || ('Keeper ' + (existingCount + 1)),
      look: defLook,
      x: typeof msg.x === 'number' ? msg.x : 8.9 * 48,
      y: typeof msg.y === 'number' ? msg.y : 24.25 * 48,
      dir: msg.dir || 'down',
      face: msg.face || 1,
      moving: false,
      walkT: 0,
      walkDist: 0,
      carry: null,
      emote: null,
      emoteT: 0,
      online: true,
      inGame: !!msg.inGame,
      lastSeenAt: Date.now(),
      lastSeenSeq: 0,
    };
  } else {
    p.online = true;
    p.lastSeenAt = Date.now();
    if (typeof msg.name === 'string' && msg.name.trim()) p.name = msg.name.trim().slice(0, 20);
    if (typeof msg.look === 'number') p.look = msg.look;
    if (typeof msg.inGame === 'boolean') p.inGame = msg.inGame;
  }
  return p;
}

function getUnreadEventsFor(room, playerId) {
  const p = room.players[playerId];
  const sinceSeq = p ? (p.lastSeenSeq || 0) : 0;
  return room.activityLog.filter(ev => ev.playerId !== playerId && ev.seq > sinceSeq);
}

// Merge incoming state with room.state so important improvements are never lost
function mergeSharedState(room, incoming, isAction) {
  if (!incoming || typeof incoming !== 'object') return;
  if (!room.state || isAction) {
    room.state = incoming;
    return;
  }
  // Keep higher or latest progression values while accepting simulation updates from host
  const cur = room.state;
  // Merge upgrades, dex, specials, tutorial so unlocked items never disappear
  if (cur.upgrades && incoming.upgrades) Object.assign(incoming.upgrades, cur.upgrades);
  if (cur.dex && incoming.dex) {
    for (const k of Object.keys(cur.dex)) {
      if (!incoming.dex[k] || (cur.dex[k].n || 0) > (incoming.dex[k].n || 0)) incoming.dex[k] = cur.dex[k];
    }
  }
  if (cur.specials && incoming.specials) Object.assign(incoming.specials, cur.specials);
  if (cur.tutorial && incoming.tutorial) Object.assign(incoming.tutorial, cur.tutorial);
  if (cur.tutorialDone) incoming.tutorialDone = true;
  if (typeof cur.nextId === 'number' && typeof incoming.nextId === 'number') {
    incoming.nextId = Math.max(cur.nextId, incoming.nextId);
  }
  room.state = incoming;
}

function recordActivity(room, player, action) {
  if (!action || !action.kind) return null;
  // Don't clutter persistent summary log with pure emotes like wave
  if (action.kind === 'wave') return null;

  room.seq++;
  const ev = {
    seq: room.seq,
    ts: Date.now(),
    playerId: player.id,
    playerName: player.name,
    playerLook: player.look,
    day: (room.state && room.state.day) || action.day || 1,
    kind: action.kind,
    item: action.item || null,
    name: action.name || null,
    icon: action.icon || null,
    cost: typeof action.cost === 'number' ? action.cost : 0,
    earned: typeof action.earned === 'number' ? action.earned : 0,
    tip: typeof action.tip === 'number' ? action.tip : 0,
    dogName: action.dogName || null,
    breed: action.breed || null,
    count: typeof action.count === 'number' ? action.count : 1,
    level: action.level || null,
    perfect: !!action.perfect,
    complaint: !!action.complaint,
    overnight: !!action.overnight,
    text: action.text || null,
  };
  room.activityLog.push(ev);
  if (room.activityLog.length > 400) {
    room.activityLog.splice(0, room.activityLog.length - 400);
  }
  // The acting player has obviously seen up to their own event
  player.lastSeenSeq = Math.max(player.lastSeenSeq || 0, room.seq);
  return ev;
}

function handleRoomMessage(room, msg, senderWs) {
  const type = msg.type || 'sync';
  const player = ensurePlayer(room, msg);
  refreshRoomPresence(room);

  if (type === 'join') {
    if (!room.state && msg.state) {
      room.state = msg.state;
      room.rev++;
      saveRoomToDisk(room, false);
    }
    refreshRoomPresence(room);
    const unreadEvents = getUnreadEventsFor(room, player.id);
    return {
      type: 'joined',
      roomCode: room.code,
      hostId: room.hostId,
      rev: room.rev,
      seq: room.seq,
      state: room.state,
      players: room.players,
      unreadEvents,
      recentEvents: room.activityLog.slice(-80),
    };
  }

  if (type === 'player_update') {
    if (typeof msg.x === 'number') player.x = msg.x;
    if (typeof msg.y === 'number') player.y = msg.y;
    if (typeof msg.dir === 'string') player.dir = msg.dir;
    if (typeof msg.face === 'number') player.face = msg.face;
    if (typeof msg.moving === 'boolean') player.moving = msg.moving;
    if (typeof msg.walkT === 'number') player.walkT = msg.walkT;
    if (typeof msg.walkDist === 'number') player.walkDist = msg.walkDist;
    if ('carry' in msg) player.carry = msg.carry;
    if ('emote' in msg) player.emote = msg.emote;
    if (typeof msg.emoteT === 'number') player.emoteT = msg.emoteT;
    refreshRoomPresence(room);

    broadcastToRoom(room, {
      type: 'peer_update',
      roomCode: room.code,
      hostId: room.hostId,
      player,
    }, senderWs);

    return { ok: true, hostId: room.hostId, rev: room.rev, seq: room.seq };
  }

  if (type === 'world_sync') {
    if (typeof msg.x === 'number') player.x = msg.x;
    if (typeof msg.y === 'number') player.y = msg.y;
    if (typeof msg.dir === 'string') player.dir = msg.dir;
    if (typeof msg.face === 'number') player.face = msg.face;
    if (typeof msg.moving === 'boolean') player.moving = msg.moving;
    if ('carry' in msg) player.carry = msg.carry;
    if ('emote' in msg) player.emote = msg.emote;

    // Accept world state if from host or if room has no state or rev is current
    const isHost = room.hostId === player.id || !room.hostId;
    if (msg.state && (isHost || !room.state || (msg.rev && msg.rev >= room.rev))) {
      mergeSharedState(room, msg.state, false);
      room.updatedAt = Date.now();
      saveRoomToDisk(room, false);
      broadcastToRoom(room, {
        type: 'world_state',
        roomCode: room.code,
        hostId: room.hostId,
        rev: room.rev,
        seq: room.seq,
        senderId: player.id,
        state: room.state,
        players: room.players,
      }, senderWs);
    }
    return {
      type: 'sync_ack',
      roomCode: room.code,
      hostId: room.hostId,
      rev: room.rev,
      seq: room.seq,
      players: room.players,
      state: (!isHost && room.state) ? room.state : undefined,
      unreadEvents: getUnreadEventsFor(room, player.id),
    };
  }

  if (type === 'action') {
    room.rev++;
    if (msg.state) {
      mergeSharedState(room, msg.state, true);
    }
    const ev = recordActivity(room, player, msg.action);
    room.updatedAt = Date.now();
    saveRoomToDisk(room, false);

    broadcastToRoom(room, {
      type: 'peer_action',
      roomCode: room.code,
      hostId: room.hostId,
      rev: room.rev,
      seq: room.seq,
      senderId: player.id,
      senderName: player.name,
      senderLook: player.look,
      action: msg.action,
      event: ev,
      state: room.state,
      players: room.players,
    }, senderWs);

    return {
      type: 'action_ack',
      ok: true,
      rev: room.rev,
      seq: room.seq,
      event: ev,
    };
  }

  if (type === 'ack_summary') {
    const ackSeq = typeof msg.seq === 'number' ? msg.seq : room.seq;
    player.lastSeenSeq = Math.max(player.lastSeenSeq || 0, ackSeq);
    saveRoomToDisk(room, false);
    return { ok: true, lastSeenSeq: player.lastSeenSeq };
  }

  if (type === 'new_game') {
    room.rev++;
    room.seq = 0;
    room.state = msg.state || null;
    room.activityLog = [];
    for (const pid of Object.keys(room.players)) {
      room.players[pid].lastSeenSeq = 0;
    }
    saveRoomToDisk(room, true);
    broadcastToRoom(room, {
      type: 'room_reset',
      roomCode: room.code,
      hostId: room.hostId,
      rev: room.rev,
      seq: 0,
      senderId: player.id,
      senderName: player.name,
      state: room.state,
    }, senderWs);
    return { ok: true, rev: room.rev, seq: 0 };
  }

  return { ok: true, rev: room.rev, seq: room.seq };
}

// ---------------- WebSocket (RFC 6455) ----------------
function wsSend(sock, obj) {
  if (!sock || sock.destroyed || !sock.writable) return;
  let str;
  try { str = typeof obj === 'string' ? obj : JSON.stringify(obj); } catch (e) { return; }
  const payload = Buffer.from(str, 'utf8');
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x81; // FIN + text
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  try { sock.write(Buffer.concat([header, payload])); } catch (e) {}
}

function broadcastToRoom(room, obj, excludeSock) {
  if (!room || !room.clients.size) return;
  const str = JSON.stringify(obj);
  for (const client of room.clients) {
    if (client !== excludeSock && !client.closed) {
      wsSend(client.sock, str);
    }
  }
}

function setupWebSocket(req, sock) {
  const key = req.headers['sec-websocket-key'];
  if (!key) { sock.destroy(); return; }
  const accept = crypto
    .createHash('sha1')
    .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64');

  sock.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    'Sec-WebSocket-Accept: ' + accept + '\r\n\r\n'
  );
  sock.setNoDelay(true);

  const client = { sock, room: null, playerId: null, closed: false };
  let rxBuf = Buffer.alloc(0);

  function cleanup() {
    if (client.closed) return;
    client.closed = true;
    const room = client.room;
    if (room) {
      room.clients.delete(client);
      if (client.playerId && room.players[client.playerId]) {
        // Check if player has another active socket in this room
        let stillHere = false;
        for (const c of room.clients) {
          if (c.playerId === client.playerId && !c.closed) { stillHere = true; break; }
        }
        if (!stillHere) {
          room.players[client.playerId].online = false;
          room.players[client.playerId].inGame = false;
          room.players[client.playerId].moving = false;
        }
      }
      refreshRoomPresence(room);
      saveRoomToDisk(room, false);
      broadcastToRoom(room, {
        type: 'presence',
        roomCode: room.code,
        hostId: room.hostId,
        players: room.players,
      }, null);
    }
  }

  sock.on('data', chunk => {
    rxBuf = Buffer.concat([rxBuf, chunk]);
    while (rxBuf.length >= 2) {
      const b0 = rxBuf[0];
      const b1 = rxBuf[1];
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let payloadLen = b1 & 0x7f;
      let offset = 2;

      if (payloadLen === 126) {
        if (rxBuf.length < 4) return;
        payloadLen = rxBuf.readUInt16BE(2);
        offset = 4;
      } else if (payloadLen === 127) {
        if (rxBuf.length < 10) return;
        payloadLen = Number(rxBuf.readBigUInt64BE(2));
        offset = 10;
      }

      const maskLen = masked ? 4 : 0;
      if (rxBuf.length < offset + maskLen + payloadLen) return;

      const mask = masked ? rxBuf.subarray(offset, offset + 4) : null;
      offset += maskLen;
      const data = Buffer.from(rxBuf.subarray(offset, offset + payloadLen));
      rxBuf = rxBuf.subarray(offset + payloadLen);

      if (opcode === 0x08) { // Close
        cleanup();
        try { sock.end(); } catch (e) {}
        return;
      }
      if (opcode === 0x09) { // Ping -> Pong
        try { sock.write(Buffer.from([0x8a, 0x00])); } catch (e) {}
        continue;
      }
      if (opcode !== 0x01 && opcode !== 0x02) continue;

      if (masked && mask) {
        for (let i = 0; i < data.length; i++) data[i] ^= mask[i & 3];
      }

      let msg;
      try { msg = JSON.parse(data.toString('utf8')); } catch (e) { continue; }
      if (!msg || typeof msg !== 'object') continue;

      const roomCode = cleanRoomCode(msg.roomCode || (client.room && client.room.code) || 'PAWS');
      const room = getRoom(roomCode);
      if (client.room && client.room !== room) {
        client.room.clients.delete(client);
      }
      client.room = room;
      client.playerId = String(msg.playerId || client.playerId || 'p_default');
      room.clients.add(client);

      const resp = handleRoomMessage(room, msg, client);
      if (resp) {
        wsSend(sock, resp);
      }
      if (msg.type === 'join') {
        broadcastToRoom(room, {
          type: 'presence',
          roomCode: room.code,
          hostId: room.hostId,
          players: room.players,
        }, client);
      }
    }
  });

  sock.on('close', cleanup);
  sock.on('end', cleanup);
  sock.on('error', cleanup);
}

// ---------------- HTTP Server ----------------
function readJsonBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 5 * 1024 * 1024) req.destroy();
    });
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); } catch (e) { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

function sendJson(res, status, obj) {
  const data = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store',
  });
  res.end(data);
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  const parsed = url.parse(req.url || '/', true);
  const pathname = decodeURIComponent(parsed.pathname || '/');

  // API endpoints
  if (pathname === '/api/info') {
    const ips = getLanIPs();
    const primaryIp = ips[0] || 'localhost';
    sendJson(res, 200, {
      ok: true,
      port: PORT,
      ips,
      primaryIp,
      urls: ips.map(ip => `http://${ip}:${PORT}`),
    });
    return;
  }

  if (pathname === '/api/room' && req.method === 'GET') {
    const code = cleanRoomCode(parsed.query.room || 'PAWS');
    const room = getRoom(code);
    refreshRoomPresence(room);
    const pid = parsed.query.playerId ? String(parsed.query.playerId) : null;
    sendJson(res, 200, {
      ok: true,
      roomCode: room.code,
      hostId: room.hostId,
      rev: room.rev,
      seq: room.seq,
      state: room.state,
      players: room.players,
      unreadEvents: pid ? getUnreadEventsFor(room, pid) : [],
      recentEvents: room.activityLog.slice(-80),
    });
    return;
  }

  if (pathname === '/api/message' && req.method === 'POST') {
    const msg = await readJsonBody(req);
    const room = getRoom(msg.roomCode || 'PAWS');
    const resp = handleRoomMessage(room, msg, null);
    sendJson(res, 200, resp || { ok: true });
    return;
  }

  // Static files
  let relPath = pathname === '/' ? '/index.html' : pathname;
  const safePath = path.normalize(path.join(ROOT_DIR, relPath));
  if (!safePath.startsWith(ROOT_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.stat(safePath, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(safePath).toLowerCase();
    const mime = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': mime,
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': ext === '.woff2' ? 'public, max-age=86400' : 'no-cache',
    });
    fs.createReadStream(safePath).pipe(res);
  });
});

server.on('upgrade', (req, sock) => {
  setupWebSocket(req, sock);
});

process.on('SIGINT', () => {
  for (const room of rooms.values()) saveRoomToDisk(room, true);
  process.exit(0);
});
process.on('SIGTERM', () => {
  for (const room of rooms.values()) saveRoomToDisk(room, true);
  process.exit(0);
});

server.listen(PORT, '0.0.0.0', () => {
  const ips = getLanIPs();
  console.log(`🐾 Paws & Play Multiplayer Server running on:`);
  console.log(`   Local:   http://localhost:${PORT}/`);
  ips.forEach(ip => console.log(`   Network: http://${ip}:${PORT}/`));
});
