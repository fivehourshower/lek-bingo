// screens.jsx — three top-level screens: Register, BingoPlay, Admin.

// ─────────────────────────────────────────────────────────────
// Modal helper
// ─────────────────────────────────────────────────────────────
function Modal({ title, onClose, children, wide }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="panel modal"
        onClick={e => e.stopPropagation()}
        style={wide ? { maxWidth: 800 } : undefined}
      >
        <div className="modal-header">
          <h3>{title}</h3>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>Close</button>
        </div>
        <div style={{ padding: 20 }}>{children}</div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// REGISTER
// ─────────────────────────────────────────────────────────────
function Register({ state, onAdminClick }) {
  const [name, setName] = React.useState('');
  const [boardCount, setBoardCount] = React.useState(1);
  const [err, setErr] = React.useState('');

  const submit = async (e) => {
    e.preventDefault();
    const res = await registerUser(name, boardCount);
    if (res && res.error) setErr(res.error);
  };

  // Resume options: only usernames THIS browser has connected as before,
  // and only if they still exist in the current game and aren't kicked.
  const knownUsers = getKnownUsers().filter(
    u => state.players[u] && !state.kicked.includes(u)
  );

  return (
    <div className="shell">
      <div className="shell-main">
        <div className="panel ornate panel-pad register-card">
          <div className="row" style={{ justifyContent: 'center', marginBottom: 14 }}>
            <span className="pill warn" style={{
              fontFamily: 'var(--font-mono)', textTransform: 'uppercase'
            }}>
              {state.locked ? '🔒 Room locked' : 'Sign in to play'}
            </span>
          </div>
          <h1>Take a seat</h1>
          <p className="lead">
            Pick a name, claim squares as you watch the drama unfold, and follow other spectators' boards live below.
          </p>

          <form onSubmit={submit} className="col" style={{ gap: 16 }}>
            <input
              className="input input-lg"
              placeholder="Your handle"
              value={name}
              onChange={e => { setName(e.target.value); setErr(''); }}
              autoFocus
              maxLength={20}
            />
            <div className="row" style={{ justifyContent: 'center', gap: 10 }}>
              <span className="h-soft" style={{ fontSize: 13 }}>Boards:</span>
              <div className="row" style={{ gap: 4 }}>
                {[1, 2].map(n => (
                  <button
                    key={n}
                    type="button"
                    className={'btn btn-sm ' + (boardCount === n ? 'btn-primary' : 'btn-ghost')}
                    onClick={() => setBoardCount(n)}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
            {err && <div className="pill bad" style={{ alignSelf: 'center' }}>{err}</div>}
            <button type="submit" className="btn btn-primary" style={{ fontSize: 16, padding: '14px 24px' }}>
              Enter the hall
            </button>
          </form>

          {knownUsers.length > 0 && (
            <div style={{ marginTop: 20 }}>
              <div className="h-faint" style={{
                fontSize: 11, letterSpacing: '.18em',
                textTransform: 'uppercase', textAlign: 'center', marginBottom: 8
              }}>
                Resume as
              </div>
              <div className="row wrap" style={{ justifyContent: 'center', gap: 6 }}>
                {knownUsers.slice(0, 6).map(u => (
                  <button
                    key={u}
                    className="btn btn-ghost btn-xs"
                    onClick={() => { setName(u); }}
                  >
                    {u}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="divider"></div>
          <button className="btn btn-ghost btn-sm" onClick={onAdminClick} style={{ width: '100%' }}>
            Admin sign-in
          </button>
        </div>
      </div>
      <div>
        <LiveStrip state={state} selfUsername={null} />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// BINGO PLAY
// ─────────────────────────────────────────────────────────────
function BingoPlay({ state, session }) {
  const me = state.players[session.username];
  const [expanded, setExpanded] = React.useState(null); // player obj or null
  const [showBingoToast, setShowBingoToast] = React.useState(false);
  const [pendingExpanded, setPendingExpanded] = React.useState(false);

  // celebrate bingo: detect changes in own bingo count
  const bingoCount = me ? me.boards.reduce((sum, b) => sum + detectBingos(b.claimed).length, 0) : 0;
  const prevBingo = React.useRef(bingoCount);
  React.useEffect(() => {
    if (bingoCount > prevBingo.current) {
      setShowBingoToast(true);
      const t = setTimeout(() => setShowBingoToast(false), 4500);
      return () => clearTimeout(t);
    }
    prevBingo.current = bingoCount;
  }, [bingoCount]);

  if (!me) {
    // We were kicked or removed — return to register
    return (
      <div className="shell">
        <div className="shell-main">
          <div className="panel ornate panel-pad register-card">
            <h1>You've left the game</h1>
            <p className="lead">Refresh to sign in again.</p>
          </div>
        </div>
      </div>
    );
  }

  const isWinner = state.forcedWinners.includes(session.username);

  return (
    <div className="shell">
      <div className="shell-main">
        <div className="row wrap" style={{
          justifyContent: 'space-between', width: '100%', maxWidth: 1200,
          margin: '0 auto 14px', gap: 10,
        }}>
          <div className="row" style={{ gap: 12 }}>
            <span className="pill good">
              Playing as <strong style={{ marginLeft: 4 }}>{session.username}</strong>
            </span>
            {bingoCount > 0 && !isWinner && (
              <span className="pill warn">BINGO ×{bingoCount} · awaiting host confirmation</span>
            )}
            {isWinner && (
              <span className="pill good">🏆 Winner confirmed</span>
            )}
          </div>
          <div className="row" style={{ gap: 8 }}>
            {me.boards.length < 2 && (
              <button className="btn btn-sm" onClick={requestSecondBoard}>
                + Second board
              </button>
            )}
            <button className="btn btn-ghost btn-sm" onClick={logout}>
              Leave game
            </button>
          </div>
        </div>

        <div className="boards-wrap">
          {me.boards.map((b, idx) => (
            <Board
              key={b.id}
              board={b}
              isOwn={true}
              label={me.boards.length > 1 ? `Board ${idx + 1}` : 'Your board'}
              onSquareClick={(sq) => clickSquare(idx, sq)}
              canRemove={me.boards.length > 1}
              onRemove={() => {
                if (confirm('Remove this board? Your claims on it will be lost.')) {
                  removeBoard(idx);
                }
              }}
            />
          ))}
        </div>

        <div style={{ marginTop: 22 }}>
          <span className="floating-hint">
            Tap a square to claim · Tap again to unclaim · Host confirms BINGOs
          </span>
        </div>
      </div>

      <div>
        <LiveStrip
          state={state}
          selfUsername={session.username}
          onClickPlayer={(p) => setExpanded(p)}
        />
      </div>

      {expanded && (
        <Modal title={`${expanded.username}'s board${expanded.boards.length > 1 ? 's' : ''}`} onClose={() => setExpanded(null)} wide>
          <div className="row wrap" style={{ justifyContent: 'center', gap: 20 }}>
            {expanded.boards.map((b, i) => (
              <ReadOnlyBoard
                key={i}
                board={b}
                scale={0.85}
                hideBingo={!state.forcedWinners.includes(expanded.username)}
              />
            ))}
          </div>
        </Modal>
      )}

      {showBingoToast && (
        <div className="broadcast" style={{
          background: 'var(--bingo-glow)', color: 'var(--accent-on)',
          fontSize: 22, letterSpacing: '.12em'
        }}>
          🎉 BINGO! 🎉
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// ADMIN PANEL
// ─────────────────────────────────────────────────────────────
function AdminLogin({ onBack }) {
  const [pw, setPw] = React.useState('');
  const [err, setErr] = React.useState('');
  const submit = async (e) => {
    e.preventDefault();
    const res = await adminLogin(pw);
    if (res && res.error) setErr(res.error);
  };
  return (
    <div className="shell">
      <div className="shell-main">
        <div className="panel ornate panel-pad register-card">
          <h1>Admin</h1>
          <p className="lead">Enter the host password to manage the room.</p>
          <form onSubmit={submit} className="col" style={{ gap: 14 }}>
            <input
              className="input input-lg"
              type="password"
              placeholder="Password"
              value={pw}
              onChange={e => { setPw(e.target.value); setErr(''); }}
              autoFocus
            />
            {err && <div className="pill bad" style={{ alignSelf: 'center' }}>{err}</div>}
            <button type="submit" className="btn btn-primary">Unlock admin</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={onBack}>Back to sign in</button>
          </form>
        </div>
      </div>
    </div>
  );
}

function AdminPanel({ state }) {
  const [tab, setTab] = React.useState('bingos');
  const [inspecting, setInspecting] = React.useState(null); // username or null
  const [notification, setNotification] = React.useState(null); // { username, lines }
  const [title, setTitle] = React.useState(state.title);
  const [bg, setBg] = React.useState(state.background);
  const [wordsJson, setWordsJson] = React.useState(() =>
    JSON.stringify({ center_square: state.centerSquare, words: state.wordPool }, null, 2)
  );
  const [wordsErr, setWordsErr] = React.useState('');
  const [wordsSaved, setWordsSaved] = React.useState(false);
  const [bcastMsg, setBcastMsg] = React.useState('');

  React.useEffect(() => { setTitle(state.title); }, [state.title]);
  React.useEffect(() => { setBg(state.background); }, [state.background]);

  const live = getLiveUsernames(state);
  const players = Object.values(state.players);

  // Players who have at least one BINGO line but haven't been confirmed as winner yet.
  const bingoQueue = players
    .map(p => ({
      player: p,
      lines: p.boards.reduce((acc, b, i) => acc.concat(detectBingos(b.claimed).map(l => ({ ...l, boardIdx: i }))), []),
    }))
    .filter(x => x.lines.length > 0 && !state.forcedWinners.includes(x.player.username));

  // — Admin notification: when a player newly enters the bingo queue, ping + toast.
  const prevBingoUsers = React.useRef(null);
  React.useEffect(() => {
    const current = new Set(bingoQueue.map(x => x.player.username));
    if (prevBingoUsers.current === null) {
      // first render — just record
      prevBingoUsers.current = current;
      return;
    }
    const newcomers = [...current].filter(u => !prevBingoUsers.current.has(u));
    if (newcomers.length > 0) {
      const username = newcomers[0];
      const lines = bingoQueue.find(x => x.player.username === username)?.lines.length || 1;
      setNotification({ id: Date.now(), username, lines });
      playBingoChime();
      setTab('bingos');
      const t = setTimeout(() => setNotification(null), 6000);
      prevBingoUsers.current = current;
      return () => clearTimeout(t);
    }
    prevBingoUsers.current = current;
  }, [bingoQueue.map(x => x.player.username).join('|')]);

  const saveTitle = () => updateTitle(title);
  const saveBg = () => updateBackground(bg);
  const saveWords = async () => {
    try {
      const parsed = JSON.parse(wordsJson);
      if (!Array.isArray(parsed.words) || parsed.words.length < 24) {
        setWordsErr('Need at least 24 words in the "words" array.');
        return;
      }
      const res = await setWordList(parsed);
      if (res && res.error) { setWordsErr(res.error); return; }
      setWordsErr('');
      setWordsSaved(true);
      setTimeout(() => setWordsSaved(false), 2000);
    } catch (e) {
      setWordsErr('Invalid JSON: ' + e.message);
    }
  };

  const tabs = [
    { id: 'bingos',   label: 'Confirm BINGO', badge: bingoQueue.length || null },
    { id: 'players',  label: 'Players',       badge: players.length || null },
    { id: 'room',     label: 'Room',          badge: null },
    { id: 'words',    label: 'Word list',     badge: null },
    { id: 'broadcast',label: 'Broadcast',     badge: null },
    { id: 'danger',   label: 'Reset / End',   badge: null },
  ];

  return (
    <div className="shell">
      <div className="admin-grid">
        <div className="admin-sidebar">
          <div className="row" style={{ marginBottom: 6 }}>
            <span className="floating-hint">
              Admin · {state.title}
            </span>
          </div>
          {tabs.map(t => (
            <button
              key={t.id}
              className={'admin-tab' + (tab === t.id ? ' active' : '')}
              onClick={() => setTab(t.id)}
            >
              {t.label}
              {t.badge ? <span className="badge">{t.badge}</span> : null}
            </button>
          ))}
          <div style={{ marginTop: 12 }}>
            <button className="btn btn-ghost btn-sm" onClick={adminLogout} style={{ width: '100%' }}>
              Sign out of admin
            </button>
          </div>
        </div>

        <div className="panel panel-pad">
          {tab === 'bingos' && (
            <div className="admin-section">
              <h2>Confirm BINGO</h2>
              <p className="hint">
                Players claim squares themselves. When a row, column, or diagonal lights up, they appear here
                for you to confirm — or click <em>Inspect</em> to scrub their board if you spot a wrongful claim.
              </p>
              {bingoQueue.length === 0 && (
                <div className="panel panel-pad" style={{
                  background: 'var(--panel-bg-2)', textAlign: 'center',
                  color: 'var(--ink-faint)', fontStyle: 'italic'
                }}>
                  No BINGOs waiting. The hall watches in silence.
                </div>
              )}
              {bingoQueue.map(({ player, lines }) => (
                <div key={player.username} className="claim-row" style={{ flexWrap: 'wrap' }}>
                  <div className="who">
                    <span className={'dot' + (live.has(player.username) ? ' live' : '')} style={{ marginRight: 6 }}></span>
                    {player.username}
                  </div>
                  <div className="what">
                    <span className="pill good" style={{ marginRight: 8 }}>
                      BINGO ×{lines.length}
                    </span>
                    <span style={{ fontSize: 12, color: 'var(--ink-faint)', fontFamily: 'var(--font-mono)' }}>
                      {lines.map(l => formatLine(l)).join(' · ')}
                    </span>
                  </div>
                  <div className="actions">
                    <button className="btn btn-sm" onClick={() => setInspecting(player.username)}>Inspect</button>
                    <button className="btn btn-primary btn-sm" onClick={() => forceWinner(player.username)}>Confirm winner</button>
                  </div>
                </div>
              ))}
              {state.forcedWinners.length > 0 && (
                <>
                  <div className="divider"></div>
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <div className="h-soft" style={{ fontSize: 13 }}>
                      Confirmed winners: {state.forcedWinners.join(', ')}
                    </div>
                    <button className="btn btn-ghost btn-sm" onClick={clearForcedWinners}>Clear winners</button>
                  </div>
                </>
              )}
            </div>
          )}

          {tab === 'players' && (
            <div className="admin-section">
              <h2>Players ({players.length})</h2>
              <p className="hint">{live.size} currently live. Kicking a player removes their boards and bans the name until you unkick.</p>
              {players.length === 0 && <div className="hint" style={{ fontStyle: 'italic' }}>No players have joined yet.</div>}
              <div className="panel" style={{ padding: '4px 12px' }}>
                {players.map(p => {
                  const lines = p.boards.reduce((s, b) => s + detectBingos(b.claimed).length, 0);
                  const claims = p.boards.reduce((s, b) => s + b.claimed.filter(Boolean).length, 0);
                  return (
                    <div key={p.username} className="player-row">
                      <div className="row" style={{ gap: 10 }}>
                        <span className={'dot' + (live.has(p.username) ? ' live' : '')}></span>
                        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}>{p.username}</span>
                        {lines > 0 && <span className="pill good">BINGO ×{lines}</span>}
                        {state.forcedWinners.includes(p.username) && <span className="pill good">🏆 Winner</span>}
                      </div>
                      <div className="meta">
                        <span>{claims} claims · {p.boards.length} board{p.boards.length > 1 ? 's' : ''}</span>
                        <button className="btn btn-ghost btn-xs" onClick={() => setInspecting(p.username)}>Inspect</button>
                        {!state.forcedWinners.includes(p.username) && (
                          <button className="btn btn-ghost btn-xs" onClick={() => forceWinner(p.username)}>Mark winner</button>
                        )}
                        <button className="btn btn-ghost btn-xs btn-danger" onClick={() => {
                          if (confirm(`Kick ${p.username}?`)) kickUser(p.username);
                        }}>Kick</button>
                      </div>
                    </div>
                  );
                })}
              </div>
              {state.kicked.length > 0 && (
                <>
                  <h2 style={{ marginTop: 18 }}>Kicked</h2>
                  <div className="row wrap" style={{ gap: 6 }}>
                    {state.kicked.map(u => (
                      <span key={u} className="pill bad" style={{ padding: '4px 12px' }}>
                        {u}
                        <button className="btn btn-ghost btn-xs" style={{ marginLeft: 8, padding: '0 6px' }} onClick={() => unkickUser(u)}>↺</button>
                      </span>
                    ))}
                  </div>
                </>
              )}
              {state.forcedWinners.length > 0 && (
                <button className="btn btn-ghost btn-sm" style={{ marginTop: 14 }} onClick={clearForcedWinners}>
                  Clear winners
                </button>
              )}
            </div>
          )}

          {tab === 'room' && (
            <div className="admin-section">
              <h2>Room settings</h2>
              <p className="hint">Title, era theme, background, and lock state — visible to all players in real time.</p>

              <div className="col">
                <label className="h-soft" style={{ fontSize: 12, letterSpacing: '.1em', textTransform: 'uppercase' }}>Title</label>
                <div className="field-row">
                  <input className="input" value={title} onChange={e => setTitle(e.target.value)} />
                  <button className="btn btn-sm" onClick={saveTitle} disabled={title === state.title}>Save</button>
                </div>
              </div>

              <div className="col" style={{ marginTop: 14 }}>
                <label className="h-soft" style={{ fontSize: 12, letterSpacing: '.1em', textTransform: 'uppercase' }}>Era theme</label>
                <div className="row wrap" style={{ gap: 8 }}>
                  {ERAS.map(era => (
                    <button
                      key={era.id}
                      className={'btn btn-sm ' + (state.theme === era.id ? 'btn-primary' : 'btn-ghost')}
                      onClick={() => updateTheme(era.id)}
                      style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2, padding: '8px 12px' }}
                    >
                      <span style={{ fontWeight: 700 }}>{era.label}</span>
                      <span style={{ fontSize: 10, opacity: .8, letterSpacing: '.04em', textTransform: 'none' }}>
                        {era.blurb}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="col" style={{ marginTop: 14 }}>
                <label className="h-soft" style={{ fontSize: 12, letterSpacing: '.1em', textTransform: 'uppercase' }}>Background image URL</label>
                <div className="field-row">
                  <input className="input" value={bg} onChange={e => setBg(e.target.value)} placeholder="https://..." />
                  <button className="btn btn-sm" onClick={saveBg} disabled={bg === state.background}>Save</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => { setBg(DEFAULT_BG); updateBackground(DEFAULT_BG); }}>Reset</button>
                </div>
              </div>

              <div className="row" style={{ marginTop: 16, gap: 12 }}>
                <button
                  className={'btn ' + (state.locked ? 'btn-danger' : '')}
                  onClick={() => setLocked(!state.locked)}
                >
                  {state.locked ? '🔒 Unlock room' : 'Lock room (no new joiners)'}
                </button>
                <span className="hint">
                  {state.locked
                    ? 'Players in the room can keep playing; new sign-ins are blocked.'
                    : 'New players can join freely.'}
                </span>
              </div>
            </div>
          )}

          {tab === 'words' && (
            <div className="admin-section">
              <h2>Word list (bingo_words.json)</h2>
              <p className="hint">
                Paste a JSON with <code>center_square</code> (string or null) and <code>words</code> (array of strings, 24+).
                Saving regenerates the pool — existing boards keep their words; new boards use the new pool.
              </p>
              <textarea
                className="input textarea"
                value={wordsJson}
                onChange={e => { setWordsJson(e.target.value); setWordsErr(''); }}
                spellCheck={false}
              />
              {wordsErr && <div className="pill bad" style={{ alignSelf: 'flex-start' }}>{wordsErr}</div>}
              {wordsSaved && <div className="pill good" style={{ alignSelf: 'flex-start' }}>Saved ✓</div>}
              <div className="row" style={{ gap: 8 }}>
                <button className="btn btn-primary btn-sm" onClick={saveWords}>Save words</button>
                <button className="btn btn-ghost btn-sm" onClick={() => {
                  if (confirm('Re-deal all player boards using the current word list?')) reissueBoards();
                }}>Re-deal all boards</button>
              </div>
            </div>
          )}

          {tab === 'broadcast' && (
            <div className="admin-section">
              <h2>Broadcast a message</h2>
              <p className="hint">Pop a banner on every player's screen. Use sparingly — for game-state announcements, breaks, etc.</p>
              <textarea
                className="input"
                style={{ minHeight: 100, fontFamily: 'var(--font-body)', fontSize: 15 }}
                value={bcastMsg}
                onChange={e => setBcastMsg(e.target.value)}
                placeholder="e.g. Scheduled break — back in 10 minutes"
                maxLength={200}
              />
              <div className="row" style={{ gap: 8 }}>
                <button
                  className="btn btn-primary btn-sm"
                  disabled={!bcastMsg.trim()}
                  onClick={() => { broadcast(bcastMsg.trim()); setBcastMsg(''); }}
                >
                  Send broadcast
                </button>
                {state.broadcast && (
                  <button className="btn btn-ghost btn-sm" onClick={clearBroadcast}>
                    Dismiss current banner
                  </button>
                )}
              </div>
              {state.broadcast && (
                <div className="panel panel-pad" style={{ marginTop: 12, background: 'var(--panel-bg-2)' }}>
                  <div className="h-faint" style={{ fontSize: 10, letterSpacing: '.16em', textTransform: 'uppercase', marginBottom: 6 }}>Currently broadcasting</div>
                  <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16 }}>
                    "{state.broadcast.message}"
                  </div>
                </div>
              )}
            </div>
          )}

          {tab === 'danger' && (
            <div className="admin-section">
              <h2>Reset & end controls</h2>
              <p className="hint">Reset wipes all players + boards. Re-deal keeps players, gives them fresh boards.</p>
              <div className="col" style={{ gap: 10 }}>
                <button className="btn" onClick={() => {
                  if (confirm('Re-deal all boards? Players stay, claims & winners cleared.')) reissueBoards();
                }}>Re-deal all boards (keep players)</button>
                <button className="btn btn-danger" onClick={() => {
                  if (confirm('Fully reset the game? All players will be removed and the room cleared.')) resetGame();
                }}>Full reset (wipe everything)</button>
              </div>
            </div>
          )}
        </div>
      </div>

      {inspecting && state.players[inspecting] && (
        <InspectorModal
          player={state.players[inspecting]}
          isWinner={state.forcedWinners.includes(inspecting)}
          onClose={() => setInspecting(null)}
        />
      )}

      <div>
        <LiveStrip
          state={state}
          selfUsername={null}
          onClickPlayer={(p) => setInspecting(p.username)}
        />
      </div>

      {notification && (
        <div
          className="broadcast"
          style={{
            background: 'var(--bingo-glow)',
            color: 'var(--accent-on)',
            cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 12,
          }}
          onClick={() => { setInspecting(notification.username); setNotification(null); }}
        >
          🔔 <strong>{notification.username}</strong> has BINGO ×{notification.lines} · click to inspect
        </div>
      )}
    </div>
  );
}

// Short pleasant chime using WebAudio — two-tone bell.
let _audioCtx;
function playBingoChime() {
  try {
    _audioCtx = _audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const ctx = _audioCtx;
    if (ctx.state === 'suspended') ctx.resume();
    const now = ctx.currentTime;
    [
      { f: 880, t: now,        d: 0.18 },
      { f: 1320, t: now + 0.12, d: 0.26 },
    ].forEach(({ f, t, d }) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'triangle';
      o.frequency.value = f;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.18, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + d);
      o.connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + d + 0.05);
    });
  } catch (e) { /* audio may be blocked before first interaction */ }
}

// Admin board inspector — click any square to toggle claimed/unclaimed.
function InspectorModal({ player, isWinner, onClose }) {
  return (
    <Modal title={`Inspect: ${player.username}`} onClose={onClose} wide>
      <p className="hint" style={{ marginTop: 0 }}>
        Click any square to toggle. Use this to revoke wrongful claims before confirming a BINGO.
      </p>
      <div className="row wrap" style={{ justifyContent: 'center', gap: 20, marginTop: 8 }}>
        {player.boards.map((b, i) => {
          const lines = detectBingos(b.claimed);
          return (
            <div key={b.id} className="board-col">
              <div className="board-header" style={{ width: '100%', maxWidth: 460 }}>
                <div className="label">Board {i + 1}</div>
                {lines.length > 0 && <span className="pill good">BINGO ×{lines.length}</span>}
              </div>
              <div className="board-letters" style={{ width: '100%', maxWidth: 460 }}>
                {['B','I','N','G','O'].map(l => <span key={l}>{l}</span>)}
              </div>
              <div className={'board' + (lines.length ? ' has-bingo' : '')} style={{ maxWidth: 460 }}>
                {b.words.map((word, si) => (
                  <div
                    key={si}
                    className={[
                      'cell',
                      si === 12 && 'free',
                      b.claimed[si] && 'claimed',
                      b.pending[si] && 'pending',
                    ].filter(Boolean).join(' ')}
                    data-word={si === 12 && word === 'FREE' ? undefined : word}
                    onClick={() => si !== 12 && adminToggleSquare(player.username, i, si)}
                  >
                    <span>{word}</span>
                  </div>
                ))}
                <BingoLines lines={lines} />
              </div>
            </div>
          );
        })}
      </div>
      <div className="divider"></div>
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        {!isWinner ? (
          <button className="btn btn-primary" onClick={() => { forceWinner(player.username); onClose(); }}>
            🏆 Confirm as winner
          </button>
        ) : (
          <span className="pill good">🏆 Confirmed winner</span>
        )}
        <button className="btn btn-ghost btn-sm" onClick={onClose}>Done</button>
      </div>
    </Modal>
  );
}

function formatLine(l) {
  if (l.type === 'row')  return `Board ${l.boardIdx + 1} · row ${l.index + 1}`;
  if (l.type === 'col')  return `Board ${l.boardIdx + 1} · col ${'BINGO'[l.index]}`;
  return `Board ${l.boardIdx + 1} · diag ${l.index === 0 ? '↘' : '↙'}`;
}

function timeAgo(ts) {
  const sec = Math.round((Date.now() - ts) / 1000);
  if (sec < 5) return 'just now';
  if (sec < 60) return sec + 's ago';
  const min = Math.round(sec / 60);
  if (min < 60) return min + 'm ago';
  return Math.round(min / 60) + 'h ago';
}

Object.assign(window, { Register, BingoPlay, AdminLogin, AdminPanel, Modal, InspectorModal, formatLine });
