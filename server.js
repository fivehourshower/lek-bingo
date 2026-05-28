// server.js — Express static + WebSocket multiplayer server.

const http = require('http');
const path = require('path');
const express = require('express');
const { WebSocketServer } = require('ws');
const { init, getState, snapshotFor, actions, uid } = require('./state');

const PORT = parseInt(process.env.PORT || '3000', 10);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'nanohope';

init();

const app = express();
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
app.get('/health', (_req, res) => res.json({ ok: true }));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Active connections.
// Map<connectionId, { ws, username, isAdmin, lastSeen }>
const conns = new Map();

function presenceMap() {
  const out = {};
  for (const [id, c] of conns) {
    if (c.username) out[id] = { username: c.username, ts: c.lastSeen };
  }
  return out;
}

function broadcast() {
  const state = getState();
  const presence = presenceMap();
  const payload = JSON.stringify({ type: 'state', state: snapshotFor(presence) });
  for (const [, c] of conns) {
    if (c.ws.readyState === c.ws.OPEN) c.ws.send(payload);
  }
}

function sendTo(c, message) {
  if (c.ws.readyState === c.ws.OPEN) c.ws.send(JSON.stringify(message));
}

function sendStateTo(c) {
  const state = getState();
  const presence = presenceMap();
  sendTo(c, {
    type: 'state',
    state: snapshotFor(presence),
    you: { username: c.username, isAdmin: !!c.isAdmin },
  });
}

wss.on('connection', (ws) => {
  const id = uid();
  const c = { id, ws, username: null, isAdmin: false, lastSeen: Date.now() };
  conns.set(id, c);
  sendStateTo(c);

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); }
    catch (e) { return; }
    handleMessage(c, msg);
  });

  ws.on('close', () => {
    conns.delete(id);
    broadcast();
  });
  ws.on('error', () => {
    conns.delete(id);
  });
});

function requireAdmin(c, fn) {
  if (!c.isAdmin) return;
  fn();
  broadcast();
}

function handleMessage(c, msg) {
  c.lastSeen = Date.now();
  switch (msg.type) {
    case 'heartbeat':
      // Don't broadcast on heartbeat — too chatty. Presence is updated next state push.
      return;

    case 'register': {
      const res = actions.registerUser(msg.username, msg.boardCount || 1);
      if (res.error) { sendTo(c, { type: 'registerResult', error: res.error }); return; }
      c.username = String(msg.username).trim();
      sendTo(c, { type: 'registerResult', ok: true });
      broadcast();
      return;
    }

    case 'logout': {
      c.username = null;
      c.isAdmin = false;
      broadcast();
      return;
    }

    case 'clickSquare':
      if (!c.username) return;
      actions.clickSquare(c.username, msg.boardIdx, msg.squareIdx);
      broadcast();
      return;

    case 'requestSecondBoard':
      if (!c.username) return;
      actions.requestSecondBoard(c.username);
      broadcast();
      return;

    case 'pollVote':
      if (!c.username) return;
      actions.votePrediction(c.username, msg.optionIdx);
      broadcast();
      return;

    case 'awardBingoTokens':
      if (!c.username) return;
      actions.awardBingoTokens(c.username, msg.amount);
      broadcast();
      return;

    case 'removeBoard':
      if (!c.username) return;
      actions.removeBoard(c.username, msg.boardIdx);
      broadcast();
      return;

    case 'adminAuth': {
      if (msg.password === ADMIN_PASSWORD) {
        c.isAdmin = true;
        sendTo(c, { type: 'adminAuthResult', ok: true });
        sendStateTo(c);
      } else {
        sendTo(c, { type: 'adminAuthResult', error: 'Incorrect password.' });
      }
      return;
    }

    case 'adminLogout':
      c.isAdmin = false;
      sendStateTo(c);
      return;

    case 'admin': {
      if (!c.isAdmin) return;
      const { action, args = [] } = msg;
      switch (action) {
        case 'resetGame':         actions.resetGame(); break;
        case 'reissueBoards':     actions.reissueBoards(); break;
        case 'updateTitle':       actions.updateTitle(args[0]); break;
        case 'updateBackground':  actions.updateBackground(args[0]); break;
        case 'updateTheme':       actions.updateTheme(args[0]); break;
        case 'setLocked':         actions.setLocked(args[0]); break;
        case 'kickUser': {
          const target = args[0];
          actions.kickUser(target);
          // Disconnect any active session as that user
          for (const [, conn] of conns) {
            if (conn.username === target) {
              sendTo(conn, { type: 'kicked' });
              conn.username = null;
            }
          }
          break;
        }
        case 'unkickUser':        actions.unkickUser(args[0]); break;
        case 'setWordList': {
          const res = actions.setWordList(args[0]);
          sendTo(c, { type: 'wordsResult', ...(res || {}) });
          break;
        }
        case 'setPollOptions':   actions.setPollOptions(args[0]); break;
        case 'resetPredictions': actions.resetPredictions(); break;
        case 'broadcast':         actions.broadcast(args[0], args[1]); break;
        case 'clearBroadcast':    actions.clearBroadcast(); break;
        case 'forceWinner':       actions.forceWinner(args[0]); break;
        case 'clearForcedWinners':actions.clearForcedWinners(); break;
        case 'adminToggleSquare': actions.adminToggleSquare(args[0], args[1], args[2]); break;
        default: return; // unknown
      }
      broadcast();
      return;
    }
  }
}

// Prune stale connections (idle clients that never sent a heartbeat)
const STALE_AFTER_MS = 60_000;
setInterval(() => {
  const now = Date.now();
  let changed = false;
  for (const [id, c] of conns) {
    if (now - c.lastSeen > STALE_AFTER_MS) {
      try { c.ws.terminate(); } catch (e) {}
      conns.delete(id);
      changed = true;
    }
  }
  if (changed) broadcast();
}, 15_000);

server.listen(PORT, () => {
  console.log(`Bingo server listening on :${PORT}`);
  console.log(`  Admin password: ${ADMIN_PASSWORD === 'nanohope' ? '(default)' : '(custom from env)'}`);
});
