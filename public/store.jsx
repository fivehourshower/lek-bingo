// store.jsx — WebSocket-backed store for the real-server build.
// Drop-in replacement for the prototype's localStorage store: exports the
// same function names (registerUser, clickSquare, etc.) but they send
// messages over a persistent WS connection. State arrives as 'state' frames
// from the server and is mirrored locally.

const STATE_KEY = 'bingo:server-state-mirror';   // not really needed, mirror lives in memory
const SESSION_KEY = 'bingo:session:v1';
const KNOWN_USERS_KEY = 'bingo:known-users:v1';
const REJOIN_KEY = 'bingo:rejoin:v1';            // username to auto-rejoin with

const ADMIN_PASSWORD = '(server-managed)';      // never used client-side
const DEFAULT_BG = 'https://gitlab.com/megawac1/lek-drafter/-/raw/master/img/background.png?ref_type=heads&inline=false';
const DEFAULT_TITLE = 'Lek finals #10 bingo';
const DEFAULT_THEME = 'medieval';
const ERAS = [
  { id: 'ancient',      label: 'Ancient',      blurb: 'Bronze, terracotta, papyrus' },
  { id: 'medieval',     label: 'Medieval',     blurb: 'Vellum, vermillion, gold leaf' },
  { id: 'renaissance',  label: 'Renaissance',  blurb: 'Ivory, verde antico, sienna' },
  { id: 'industrial',   label: 'Industrial',   blurb: 'Brass, iron, soot' },
  { id: 'modern',       label: 'Modern',       blurb: 'Mid-century atomic poster' },
  { id: 'information',  label: 'Information',  blurb: 'Neon cyan, dark grid' },
];

// ============================================================
// State mirror
// ============================================================
let _state = {
  gameId: '',
  title: DEFAULT_TITLE,
  background: DEFAULT_BG,
  theme: DEFAULT_THEME,
  locked: false,
  centerSquare: 'FREE',
  wordPool: [],
  broadcast: null,
  poll: { options: ['', '', '', '', '', ''], votes: {} },
  forcedWinners: [],
  players: {},
  presence: {},
  pendingClaims: [],
  kicked: [],
};
let _connected = false;

function getState() { return _state; }

function setState(next) {
  _state = next;
  window.dispatchEvent(new CustomEvent('bingo:state-changed'));
}

// ============================================================
// Session (per-tab) + known users
// ============================================================
function uid() { return Math.random().toString(36).slice(2, 10); }

function getSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  const s = { sessionId: 'sess_' + uid() };
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
  return s;
}
function setSession(patch) {
  const cur = getSession();
  const next = { ...cur, ...patch };
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(next));
  return next;
}
function clearSessionUser() {
  setSession({ username: undefined, isAdmin: undefined });
}

function getKnownUsers() {
  try {
    const raw = localStorage.getItem(KNOWN_USERS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) { return []; }
}
function rememberUser(username) {
  const list = getKnownUsers().filter(u => u !== username);
  list.unshift(username);
  localStorage.setItem(KNOWN_USERS_KEY, JSON.stringify(list.slice(0, 8)));
}
function forgetUser(username) {
  const list = getKnownUsers().filter(u => u !== username);
  localStorage.setItem(KNOWN_USERS_KEY, JSON.stringify(list));
}

// ============================================================
// WebSocket connection
// ============================================================
let ws = null;
let reconnectAttempts = 0;
const PENDING = {};   // pending request promises by tag

function wsUrl() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/`;
}

function send(msg) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  ws.send(JSON.stringify(msg));
  return true;
}

function awaitReply(tag) {
  return new Promise((resolve) => {
    PENDING[tag] = resolve;
    setTimeout(() => {
      if (PENDING[tag]) {
        PENDING[tag]({ error: 'No response from server (timeout).' });
        delete PENDING[tag];
      }
    }, 5000);
  });
}

function resolveReply(tag, payload) {
  if (PENDING[tag]) {
    PENDING[tag](payload);
    delete PENDING[tag];
  }
}

function connect() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  try {
    ws = new WebSocket(wsUrl());
  } catch (e) {
    scheduleReconnect();
    return;
  }
  ws.onopen = () => {
    _connected = true;
    reconnectAttempts = 0;
    window.dispatchEvent(new CustomEvent('bingo:connection-changed'));
    // Auto re-register if we have a pending username in localStorage
    const rejoin = localStorage.getItem(REJOIN_KEY);
    const sess = getSession();
    if (sess.username && rejoin === sess.username) {
      send({ type: 'register', username: sess.username, boardCount: 1 });
    }
  };
  ws.onclose = () => {
    _connected = false;
    window.dispatchEvent(new CustomEvent('bingo:connection-changed'));
    scheduleReconnect();
  };
  ws.onerror = () => { /* fall through to onclose */ };
  ws.onmessage = (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch (e) { return; }
    handleServerMessage(msg);
  };
}

function scheduleReconnect() {
  reconnectAttempts++;
  const delay = Math.min(15000, 500 * Math.pow(1.5, reconnectAttempts));
  setTimeout(connect, delay);
}

function handleServerMessage(msg) {
  switch (msg.type) {
    case 'state':
      setState(msg.state || _state);
      // If server attached a `you`, sync local session
      if (msg.you) {
        const sess = getSession();
        const patch = {};
        if (msg.you.username !== undefined && msg.you.username !== sess.username) patch.username = msg.you.username;
        if (msg.you.isAdmin !== undefined && msg.you.isAdmin !== sess.isAdmin) patch.isAdmin = msg.you.isAdmin;
        if (Object.keys(patch).length > 0) setSession(patch);
      }
      return;
    case 'registerResult':
      resolveReply('register', msg);
      return;
    case 'adminAuthResult':
      resolveReply('adminAuth', msg);
      return;
    case 'wordsResult':
      resolveReply('words', msg);
      return;
    case 'kicked':
      localStorage.removeItem(REJOIN_KEY);
      clearSessionUser();
      window.dispatchEvent(new CustomEvent('bingo:state-changed'));
      return;
  }
}

connect();

// ============================================================
// Actions — fire-and-forget (state updates arrive via 'state' frames)
// ============================================================

async function registerUser(username, boardCount = 1) {
  username = (username || '').trim();
  if (!username) return { error: 'Username required' };
  if (username.length > 20) return { error: 'Username too long (20 max)' };
  if (!send({ type: 'register', username, boardCount })) return { error: 'Not connected.' };
  const res = await awaitReply('register');
  if (res.ok) {
    setSession({ username });
    localStorage.setItem(REJOIN_KEY, username);
    rememberUser(username);
  }
  return res;
}

function logout() {
  send({ type: 'logout' });
  localStorage.removeItem(REJOIN_KEY);
  clearSessionUser();
}

function requestSecondBoard() { send({ type: 'requestSecondBoard' }); }
function removeBoard(boardIdx) { send({ type: 'removeBoard', boardIdx }); }
function clickSquare(boardIdx, squareIdx) { send({ type: 'clickSquare', boardIdx, squareIdx }); }

// admin
async function adminLogin(password) {
  if (!send({ type: 'adminAuth', password })) return { error: 'Not connected.' };
  const res = await awaitReply('adminAuth');
  if (res.ok) setSession({ isAdmin: true });
  return res;
}
function adminLogout() {
  send({ type: 'adminLogout' });
  setSession({ isAdmin: false });
}

function adminCall(action, ...args) { send({ type: 'admin', action, args }); }
function adminToggleSquare(username, boardIdx, squareIdx) { adminCall('adminToggleSquare', username, boardIdx, squareIdx); }
function resetGame()                  { adminCall('resetGame'); }
function reissueBoards()              { adminCall('reissueBoards'); }
function updateTitle(t)               { adminCall('updateTitle', t); }
function updateBackground(u)          { adminCall('updateBackground', u); }
function updateTheme(t)               { adminCall('updateTheme', t); }
function setLocked(v)                 { adminCall('setLocked', v); }
function kickUser(u)                  { adminCall('kickUser', u); }
function unkickUser(u)                { adminCall('unkickUser', u); }
function setPollOptions(options)      { adminCall('setPollOptions', options); }
function resetPredictions()           { adminCall('resetPredictions'); }
async function setWordList(parsed) {
  if (!send({ type: 'admin', action: 'setWordList', args: [parsed] })) return { error: 'Not connected.' };
  return await awaitReply('words');
}
function broadcast(message, persistFor = 'none') { adminCall('broadcast', message, persistFor); }
function clearBroadcast()             { adminCall('clearBroadcast'); }
function forceWinner(username)        { adminCall('forceWinner', username); }
function clearForcedWinners()         { adminCall('clearForcedWinners'); }
function votePrediction(optionIdx)    { send({ type: 'pollVote', optionIdx }); }
function awardBingoTokens(amount = 10) { send({ type: 'awardBingoTokens', amount }); }

// Heartbeat (keeps presence alive)
function heartbeat() { send({ type: 'heartbeat' }); }

// ============================================================
// Selectors
// ============================================================
// Server-derived presence: anyone in state.presence has an open WS connection.
const PRESENCE_TTL = 60_000;   // matches server-side stale prune; used as a soft check
function getLiveUsernames(state) {
  const now = Date.now();
  const live = new Set();
  Object.values(state.presence || {}).forEach(p => {
    if (!p || !p.username) return;
    if (p.ts && now - p.ts > PRESENCE_TTL) return;
    live.add(p.username);
  });
  return live;
}

function detectBingos(claimed) {
  const lines = [];
  for (let r = 0; r < 5; r++) {
    if ([0,1,2,3,4].every(c => claimed[r * 5 + c])) lines.push({ type: 'row', index: r });
  }
  for (let c = 0; c < 5; c++) {
    if ([0,1,2,3,4].every(r => claimed[r * 5 + c])) lines.push({ type: 'col', index: c });
  }
  if ([0,6,12,18,24].every(i => claimed[i])) lines.push({ type: 'diag', index: 0 });
  if ([4,8,12,16,20].every(i => claimed[i])) lines.push({ type: 'diag', index: 1 });
  return lines;
}

// ============================================================
// React hooks
// ============================================================
function useBingoState() {
  const [state, setStateLocal] = React.useState(() => getState());
  React.useEffect(() => {
    const sync = () => setStateLocal(getState());
    window.addEventListener('bingo:state-changed', sync);
    return () => window.removeEventListener('bingo:state-changed', sync);
  }, []);
  return state;
}

function useSession() {
  const [sess, setSess] = React.useState(() => getSession());
  React.useEffect(() => {
    const id = setInterval(() => setSess(getSession()), 500);
    return () => clearInterval(id);
  }, []);
  return sess;
}

function usePresence(active) {
  React.useEffect(() => {
    if (!active) return;
    heartbeat();
    const id = setInterval(heartbeat, 4000);
    return () => clearInterval(id);
  }, [active]);
}

function useConnection() {
  const [c, setC] = React.useState(_connected);
  React.useEffect(() => {
    const sync = () => setC(_connected);
    window.addEventListener('bingo:connection-changed', sync);
    return () => window.removeEventListener('bingo:connection-changed', sync);
  }, []);
  return c;
}

// ============================================================
// (no-op shims so app.jsx's demo controls can still import without crashing)
// ============================================================
function spawnBot() { /* not supported in server mode */ }
function randomClaimsAllBots() { /* not supported */ }
function seedBotsIfEmpty() { /* not supported */ }
function disconnectOnUnload() { /* server detects via WS close */ }
function mutate() { /* not used on server build */ }
function shuffle(a) { return a; }

Object.assign(window, {
  // constants
  ADMIN_PASSWORD, DEFAULT_BG, DEFAULT_TITLE, DEFAULT_THEME, ERAS,
  // state
  getState,
  // session
  getSession, setSession, clearSessionUser, getKnownUsers, rememberUser, forgetUser,
  // actions
  registerUser, logout, requestSecondBoard, removeBoard,
  clickSquare, adminToggleSquare,
  adminLogin, adminLogout, resetGame, reissueBoards,
  updateTitle, updateBackground, updateTheme, setLocked, kickUser, unkickUser, setWordList,
  setPollOptions, resetPredictions,
  broadcast, clearBroadcast, forceWinner, clearForcedWinners, votePrediction, awardBingoTokens,
  heartbeat, disconnectOnUnload,
  // selectors
  getLiveUsernames, detectBingos,
  // hooks
  useBingoState, useSession, usePresence, useConnection,
  // shims
  spawnBot, randomClaimsAllBots, seedBotsIfEmpty, mutate, shuffle, uid,
});
