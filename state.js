// state.js — server-side single-room state with SQLite persistence.
//
// All actions go through actions.* — they mutate state, persist, and return
// the new state. The server is responsible for broadcasting after each action.

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const STATE_DB_FILE = process.env.STATE_DB_FILE || path.join(__dirname, 'data', 'state.sqlite');
const LEGACY_STATE_FILE = process.env.STATE_FILE || path.join(__dirname, 'data', 'state.json');
const WORDS_FILE = process.env.WORDS_FILE || path.join(__dirname, 'bingo_words.json');

const DEFAULT_TITLE = 'Lek finals #10 bingo';
const DEFAULT_BG = 'https://gitlab.com/megawac1/lek-drafter/-/raw/master/img/background.png?ref_type=heads&inline=false';
const DEFAULT_THEME = 'medieval';
const DEFAULT_POLL_OPTIONS = Array.from({ length: 6 }, () => '');
const STARTING_TOKENS = 10;
const BINGO_REWARD_TOKENS = 10;
const TOKEN_DRIP_INTERVAL_MS = 15 * 60_000;
const TOKEN_DRIP_AMOUNT = 1;

const FALLBACK_WORDS = Array.from({ length: 30 }, (_, i) => `Sample square ${i + 1}`);

// ---- helpers ----
function uid() { return Math.random().toString(36).slice(2, 10); }
function newGameId() { return 'g_' + Date.now().toString(36) + '_' + uid(); }
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function loadWordsFromDisk() {
  try {
    const raw = fs.readFileSync(WORDS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed.words) && parsed.words.length >= 24) return parsed;
  } catch (e) {
    console.warn('Could not load words from', WORDS_FILE, e.message);
  }
  return { center_square: null, words: FALLBACK_WORDS.slice() };
}

function writeWordsToDisk(parsed) {
  try {
    fs.mkdirSync(path.dirname(WORDS_FILE), { recursive: true });
    fs.writeFileSync(WORDS_FILE, JSON.stringify(parsed, null, 2));
  } catch (e) {
    console.warn('Could not write words to', WORDS_FILE, e.message);
  }
}

function emptyState() {
  const w = loadWordsFromDisk();
  return {
    gameId: newGameId(),
    title: DEFAULT_TITLE,
    background: DEFAULT_BG,
    theme: DEFAULT_THEME,
    locked: false,
    centerSquare: (w.center_square === null || w.center_square === undefined || w.center_square === '') ? null : w.center_square,
    wordPool: w.words.slice(),
    broadcast: null,
    poll: emptyPoll(),
    forcedWinners: [],
    players: {},          // [username]: { username, joinedAt, lastSeen, boards, tokens, tokenClockAt, confirmedBingos }
    pendingClaims: [],    // unused with new flow; kept for shape compatibility
    kicked: [],
  };
}

function emptyPoll() {
  return {
    options: DEFAULT_POLL_OPTIONS.slice(),
    votes: {},
  };
}

function normalizePoll(poll) {
  const next = emptyPoll();
  if (!poll || typeof poll !== 'object') return next;
  if (Array.isArray(poll.options) && poll.options.length === 6) {
    next.options = poll.options.map(option => String(option || '').trim().slice(0, 80));
  }
  if (poll.votes && typeof poll.votes === 'object') {
    next.votes = Object.fromEntries(
      Object.entries(poll.votes).map(([username, vote]) => {
        const slots = Array.isArray(vote) ? vote : [vote];
        return [
          username,
          slots
            .map(slot => Number(slot))
            .filter(slot => Number.isInteger(slot) && slot >= 0 && slot < 6),
        ];
      })
    );
  }
  return next;
}

function normalizePlayer(player) {
  if (!player || typeof player !== 'object') return player;
  const tokensValue = Number(player.tokens);
  const tokenClockValue = Number(player.tokenClockAt);
  const confirmedBingosValue = Number(player.confirmedBingos);
  const fallbackClock = Number(player.joinedAt) || Date.now();
  return {
    ...player,
    tokens: Number.isFinite(tokensValue) ? Math.max(0, tokensValue) : STARTING_TOKENS,
    tokenClockAt: Number.isFinite(tokenClockValue) ? tokenClockValue : fallbackClock,
    confirmedBingos: Number.isFinite(confirmedBingosValue) ? Math.max(0, Math.floor(confirmedBingosValue)) : 0,
  };
}

function normalizePlayers(players) {
  const next = {};
  Object.entries(players || {}).forEach(([username, player]) => {
    next[username] = normalizePlayer(player);
  });
  return next;
}

function countBingoLines(claimed) {
  const lines = [];
  for (let r = 0; r < 5; r++) {
    if ([0, 1, 2, 3, 4].every(c => claimed[r * 5 + c])) lines.push({ type: 'row', index: r });
  }
  for (let c = 0; c < 5; c++) {
    if ([0, 1, 2, 3, 4].every(r => claimed[r * 5 + c])) lines.push({ type: 'col', index: c });
  }
  if ([0, 6, 12, 18, 24].every(i => claimed[i])) lines.push({ type: 'diag', index: 0 });
  if ([4, 8, 12, 16, 20].every(i => claimed[i])) lines.push({ type: 'diag', index: 1 });
  return lines;
}

function countBingosForPlayer(player) {
  if (!player || !Array.isArray(player.boards)) return 0;
  return player.boards.reduce((sum, board) => sum + countBingoLines(board.claimed).length, 0);
}

function getVoteLimitForPlayer(username) {
  const player = state.players[username];
  if (!player) return 0;
  return Math.max(0, Number(player.tokens) || 0);
}

function adjustPlayerTokens(username, delta) {
  const player = state.players[username];
  if (!player) return false;
  player.tokens = Math.max(0, (Number(player.tokens) || 0) + delta);
  return true;
}

function maybeGrantPassiveToken(player, nowTs) {
  const lastTick = Number.isFinite(Number(player.tokenClockAt)) ? Number(player.tokenClockAt) : nowTs;
  const elapsed = nowTs - lastTick;
  if (elapsed < TOKEN_DRIP_INTERVAL_MS) return 0;
  const intervals = Math.floor(elapsed / TOKEN_DRIP_INTERVAL_MS);
  if (intervals <= 0) return 0;
  player.tokens = Math.max(0, Number(player.tokens) || 0) + intervals * TOKEN_DRIP_AMOUNT;
  player.tokenClockAt = lastTick + intervals * TOKEN_DRIP_INTERVAL_MS;
  return intervals;
}

function makeBoard(state) {
  const pool = (state.wordPool && state.wordPool.length >= 24) ? state.wordPool : FALLBACK_WORDS;
  const shuffled = shuffle(pool);
  let center, picks;
  if (state.centerSquare) {
    center = state.centerSquare;
    picks = shuffled.filter(w => w !== center).slice(0, 24);
  } else {
    center = shuffled[0];
    picks = shuffled.slice(1, 25);
  }
  while (picks.length < 24) picks.push(pool[picks.length % pool.length]);
  const words = [...picks.slice(0, 12), center, ...picks.slice(12, 24)];
  return {
    id: uid(),
    words,
    claimed: words.map((_, i) => i === 12),
    pending: Array(25).fill(false),
  };
}

// ---- persistence ----
let state;
let db;
let getStateRowStmt;
let upsertStateStmt;
let transientBroadcast = null;
let broadcastTimer = null;

const BROADCAST_DURATIONS = {
  '1m': 60_000,
  '5m': 5 * 60_000,
  '10m': 10 * 60_000,
  '30m': 30 * 60_000,
  forever: null,
};

function initDb() {
  if (db) return;
  fs.mkdirSync(path.dirname(STATE_DB_FILE), { recursive: true });
  db = new Database(STATE_DB_FILE);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);
  getStateRowStmt = db.prepare('SELECT value FROM app_state WHERE key = ?');
  upsertStateStmt = db.prepare(`
    INSERT INTO app_state (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = excluded.updated_at
  `);
}

function loadLegacyStateFromDisk() {
  try {
    const raw = fs.readFileSync(LEGACY_STATE_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function persistNow(nextState) {
  try {
    initDb();
    upsertStateStmt.run('state', JSON.stringify(nextState), Date.now());
  } catch (e) {
    console.warn('Persist failed:', e.message);
  }
}

function clearBroadcastTimer() {
  if (!broadcastTimer) return;
  clearTimeout(broadcastTimer);
  broadcastTimer = null;
}

function scheduleBroadcastExpiration(expiresAt) {
  clearBroadcastTimer();
  if (!expiresAt) return;
  const delay = Math.max(0, expiresAt - Date.now());
  broadcastTimer = setTimeout(() => {
    broadcastTimer = null;
    actions.clearBroadcast();
  }, delay);
}

function activeBroadcast() {
  return transientBroadcast || state.broadcast || null;
}

function isBroadcastExpired(broadcast) {
  return !!(broadcast && broadcast.expiresAt && Date.now() >= broadcast.expiresAt);
}

function sanitizeLoadedBroadcast() {
  if (!state.broadcast) return false;
  if (isBroadcastExpired(state.broadcast)) {
    state.broadcast = null;
    clearBroadcastTimer();
    return true;
  }
  scheduleBroadcastExpiration(state.broadcast.expiresAt);
  return false;
}

function loadState() {
  try {
    initDb();
    const row = getStateRowStmt.get('state');
    if (row && row.value) {
      return JSON.parse(row.value);
    }

    // One-time migration path for existing installs that still have state.json.
    const legacy = loadLegacyStateFromDisk();
    if (legacy) {
      persistNow(legacy);
      return legacy;
    }

    return null;
  } catch (e) {
    return null;
  }
}

let _persistTimer = null;
function persist() {
  if (_persistTimer) return;
  _persistTimer = setTimeout(() => {
    _persistTimer = null;
    persistNow(state);
  }, 250);
}

function init() {
  initDb();
  state = loadState() || emptyState();
  state.poll = normalizePoll(state.poll);
  state.players = normalizePlayers(state.players);
  transientBroadcast = null;
  if (sanitizeLoadedBroadcast()) persistNow(state);
  // Always overwrite the word pool from disk on boot (so admins editing the
  // mounted JSON outside the UI take effect on restart).
  const w = loadWordsFromDisk();
  state.wordPool = w.words.slice();
  state.centerSquare = (w.center_square === null || w.center_square === undefined || w.center_square === '') ? null : w.center_square;
}

function getState() { return state; }

// ---- presence is derived from active connections, not stored ----
// The server passes a `presence` object into the snapshot before broadcasting.
function snapshotFor(presence) {
  return { ...state, broadcast: activeBroadcast(), presence };
}

// ---- actions ----
const actions = {
  registerUser(username, boardCount = 1) {
    username = String(username || '').trim();
    if (!username) return { error: 'Username required' };
    if (username.length > 20) return { error: 'Username too long (20 max)' };
    if (state.kicked.includes(username)) return { error: 'This username has been kicked.' };
    if (state.locked && !state.players[username]) return { error: 'The room is locked. No new players.' };

    const existing = state.players[username];
    if (existing) {
      existing.lastSeen = Date.now();
      if (existing.tokens === undefined || existing.tokens === null) existing.tokens = STARTING_TOKENS;
      if (!Number.isFinite(Number(existing.tokenClockAt))) existing.tokenClockAt = Date.now();
      if (boardCount === 2 && existing.boards.length < 2) existing.boards.push(makeBoard(state));
    } else {
      state.players[username] = {
        username,
        joinedAt: Date.now(),
        lastSeen: Date.now(),
        boards: Array.from({ length: boardCount }, () => makeBoard(state)),
        tokens: STARTING_TOKENS,
        tokenClockAt: Date.now(),
        confirmedBingos: 0,
      };
    }
    persist();
    return { ok: true };
  },

  requestSecondBoard(username) {
    const p = state.players[username];
    if (!p || p.boards.length >= 2) return;
    p.boards.push(makeBoard(state));
    persist();
  },

  removeBoard(username, boardIdx) {
    const p = state.players[username];
    if (!p || p.boards.length <= 1) return;
    p.boards.splice(boardIdx, 1);
    persist();
  },

  clickSquare(username, boardIdx, squareIdx) {
    const p = state.players[username];
    if (!p || !p.boards[boardIdx]) return;
    if (squareIdx === 12) return;
    p.boards[boardIdx].claimed[squareIdx] = !p.boards[boardIdx].claimed[squareIdx];
    persist();
  },

  adminToggleSquare(username, boardIdx, squareIdx) {
    const p = state.players[username];
    if (!p || !p.boards[boardIdx] || squareIdx === 12) return;
    p.boards[boardIdx].claimed[squareIdx] = !p.boards[boardIdx].claimed[squareIdx];
    persist();
  },

  resetGame() {
    const next = emptyState();
    next.title = state.title;
    next.background = state.background;
    next.theme = state.theme;
    next.wordPool = state.wordPool;
    next.centerSquare = state.centerSquare;
    next.poll = normalizePoll(state.poll);
    next.poll.votes = {};
    Object.entries(state.players).forEach(([username, player]) => {
      next.players[username] = {
        ...player,
        tokens: Math.max(0, Number(player.tokens) || 0),
      };
    });
    state = next;
    transientBroadcast = null;
    clearBroadcastTimer();
    persist();
  },

  reissueBoards() {
    state.gameId = newGameId();
    Object.values(state.players).forEach(p => {
      p.boards = p.boards.map(() => makeBoard(state));
      p.confirmedBingos = 0;
    });
    state.pendingClaims = [];
    state.forcedWinners = [];
    persist();
  },

  updateTitle(title) {
    state.title = String(title || '').slice(0, 80);
    persist();
  },
  updateBackground(url) {
    state.background = String(url || '');
    persist();
  },
  updateTheme(theme) {
    const valid = ['ancient','medieval','renaissance','industrial','modern','information'];
    if (valid.includes(theme)) state.theme = theme;
    persist();
  },
  setLocked(locked) {
    state.locked = !!locked;
    persist();
  },
  kickUser(username) {
    delete state.players[username];
    if (!state.kicked.includes(username)) state.kicked.push(username);
    persist();
  },
  unkickUser(username) {
    state.kicked = state.kicked.filter(u => u !== username);
    persist();
  },
  setWordList(parsed) {
    if (!parsed || !Array.isArray(parsed.words) || parsed.words.length < 24) {
      return { error: 'words must be an array of 24+ strings' };
    }
    state.wordPool = parsed.words.slice();
    const cs = parsed.center_square;
    state.centerSquare = (cs === null || cs === undefined || cs === '') ? null : cs;
    writeWordsToDisk({ center_square: state.centerSquare, words: state.wordPool });
    persist();
    return { ok: true };
  },

  setPollOptions(options) {
    if (!Array.isArray(options) || options.length !== 6) {
      return { error: 'poll options must be an array of 6 strings' };
    }
    const normalized = options.map(option => String(option || '').trim().slice(0, 80));
    if (normalized.some(option => !option)) {
      return { error: 'all 6 poll options are required' };
    }
    state.poll = normalizePoll(state.poll);
    state.poll.options = normalized;
    persist();
    return { ok: true };
  },

  resetPredictions() {
    state.poll = normalizePoll(state.poll);
    Object.entries(state.poll.votes).forEach(([username, votes]) => {
      adjustPlayerTokens(username, Array.isArray(votes) ? votes.length : 0);
    });
    state.poll.votes = {};
    persist();
  },

  awardBingoTokens(username) {
    username = String(username || '').trim();
    const player = state.players[username];
    if (!player) return { error: 'Player required' };
    const currentBingos = countBingosForPlayer(player);
    const confirmedBingos = Math.max(0, Number(player.confirmedBingos) || 0);
    const pendingBingos = Math.max(0, currentBingos - confirmedBingos);

    if (pendingBingos <= 0) {
      if (!state.forcedWinners.includes(username)) state.forcedWinners.push(username);
      persist();
      return { ok: true, granted: 0 };
    }

    adjustPlayerTokens(username, pendingBingos * BINGO_REWARD_TOKENS);
    player.confirmedBingos = confirmedBingos + pendingBingos;
    if (!state.forcedWinners.includes(username)) state.forcedWinners.push(username);
    persist();
    return { ok: true, granted: pendingBingos };
  },

  grantPassiveTokens(now = Date.now()) {
    let changed = false;
    Object.values(state.players).forEach(player => {
      const grantedIntervals = maybeGrantPassiveToken(player, now);
      if (grantedIntervals > 0) changed = true;
    });
    if (changed) persist();
    return { changed };
  },

  votePrediction(username, optionIdx) {
    username = String(username || '').trim();
    const p = state.players[username];
    if (!p) return { error: 'Player required' };
    state.poll = normalizePoll(state.poll);
    const idx = Number(optionIdx);
    if (!Number.isInteger(idx) || idx < 0 || idx >= state.poll.options.length) {
      return { error: 'Invalid poll option' };
    }
    if (!state.poll.options[idx]) {
      return { error: 'Poll option is not configured' };
    }
    const currentVotes = Array.isArray(state.poll.votes[username])
      ? state.poll.votes[username].slice()
      : (state.poll.votes[username] === undefined || state.poll.votes[username] === null ? [] : [state.poll.votes[username]]);
    const normalizedVotes = currentVotes
      .map(slot => Number(slot))
      .filter(slot => Number.isInteger(slot) && slot >= 0 && slot < state.poll.options.length);

    const tokens = getVoteLimitForPlayer(username);
    if (tokens <= 0) return { error: 'No tokens left' };
    normalizedVotes.push(idx);
    adjustPlayerTokens(username, -1);

    state.poll.votes[username] = normalizedVotes;
    persist();
    return { ok: true };
  },

  broadcast(message, persistFor = 'none') {
    const durationMs = BROADCAST_DURATIONS[persistFor] ?? null;
    const broadcast = {
      id: uid(),
      message: String(message || '').slice(0, 200),
      ts: Date.now(),
      persistFor: durationMs === null ? 'none' : persistFor,
      expiresAt: durationMs === null ? null : Date.now() + durationMs,
    };

    clearBroadcastTimer();
    if (durationMs === null && persistFor !== 'forever') {
      transientBroadcast = broadcast;
      state.broadcast = null;
    } else {
      transientBroadcast = null;
      state.broadcast = broadcast;
      if (broadcast.expiresAt) scheduleBroadcastExpiration(broadcast.expiresAt);
    }
    persist();
    return { ok: true };
  },
  clearBroadcast() {
    transientBroadcast = null;
    state.broadcast = null;
    clearBroadcastTimer();
    persist();
  },
  forceWinner(username) {
    if (!state.forcedWinners.includes(username)) state.forcedWinners.push(username);
    persist();
  },
  clearForcedWinners() {
    state.forcedWinners = [];
    persist();
  },
};

module.exports = { init, getState, snapshotFor, actions, uid };
