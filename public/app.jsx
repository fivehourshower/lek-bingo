// app.jsx — Root component for the server build.

function TopBar({ state, session, connected }) {
  const initials = state.title
    .split(/\s+/).slice(0, 2)
    .map(w => w.replace(/[^a-z0-9]/gi, '')[0])
    .filter(Boolean).join('').toUpperCase().slice(0, 2) || 'B';

  return (
    <div className="topbar">
      <div className="topbar-title">
        <span className="crest">{initials}</span>
        <span>{state.title}</span>
      </div>
      <div className="topbar-actions">
        {!connected && (
          <span className="pill bad" style={{
            background: 'rgba(0,0,0,.55)', color: '#ffb4b4',
            padding: '6px 12px', backdropFilter: 'blur(8px)'
          }}>
            <span className="dot" style={{ background: '#ff5b5b' }}></span>
            Reconnecting…
          </span>
        )}
        {session.username && (
          <span className="pill good" style={{
            background: 'rgba(0,0,0,.35)', color: 'white',
            padding: '6px 12px', backdropFilter: 'blur(8px)'
          }}>
            <span className="dot live"></span>
            {session.username}
          </span>
        )}
        {session.isAdmin && (
          <span className="pill warn" style={{
            background: 'rgba(0,0,0,.35)', color: 'var(--accent-soft)',
            padding: '6px 12px', backdropFilter: 'blur(8px)'
          }}>
            Admin mode
          </span>
        )}
      </div>
    </div>
  );
}

function App() {
  const state = useBingoState();
  const session = useSession();
  const connected = useConnection();
  const [adminLoginVisible, setAdminLoginVisible] = React.useState(false);
  const [winnerToast, setWinnerToast] = React.useState(null);

  // Apply theme + background to <body>
  React.useEffect(() => {
    document.body.setAttribute('data-theme', state.theme || 'medieval');
    document.body.style.setProperty('--page-bg-image', `url("${state.background}")`);
  }, [state.theme, state.background]);

  React.useEffect(() => { document.title = state.title; }, [state.title]);

  usePresence(!!session.username);

  // Winner announcement — fires for every viewer when forcedWinners grows.
  const prevWinners = React.useRef(null);
  React.useEffect(() => {
    const current = state.forcedWinners || [];
    if (prevWinners.current === null) {
      prevWinners.current = current;
      return;
    }
    const newcomers = current.filter(u => !prevWinners.current.includes(u));
    if (newcomers.length > 0) {
      setWinnerToast({ id: Date.now(), username: newcomers[0] });
      playWinnerFanfare();
      const t = setTimeout(() => setWinnerToast(null), 7000);
      prevWinners.current = current;
      return () => clearTimeout(t);
    }
    prevWinners.current = current;
  }, [(state.forcedWinners || []).join('|')]);

  let screen;
  if (session.isAdmin) {
    screen = <AdminPanel state={state} />;
  } else if (adminLoginVisible) {
    screen = <AdminLogin onBack={() => setAdminLoginVisible(false)} />;
  } else if (session.username && state.players[session.username]) {
    screen = <BingoPlay state={state} session={session} />;
  } else {
    if (session.username && !state.players[session.username]) clearSessionUser();
    screen = <Register state={state} onAdminClick={() => setAdminLoginVisible(true)} />;
  }

  React.useEffect(() => {
    if (session.isAdmin) setAdminLoginVisible(false);
  }, [session.isAdmin]);

  return (
    <>
      <TopBar state={state} session={session} connected={connected} />
      {screen}
      {state.broadcast && <BroadcastBanner broadcast={state.broadcast} />}
      {winnerToast && (
        <div className="winner-toast" onClick={() => setWinnerToast(null)}>
          <div className="winner-toast-trophy">🏆</div>
          <div className="winner-toast-body">
            <div className="winner-toast-label">Bingo confirmed</div>
            <div className="winner-toast-name">{winnerToast.username}</div>
          </div>
        </div>
      )}
    </>
  );
}

function BroadcastBanner({ broadcast }) {
  const [visible, setVisible] = React.useState(true);
  React.useEffect(() => {
    setVisible(true);
    const t = setTimeout(() => setVisible(false), 12000);
    return () => clearTimeout(t);
  }, [broadcast.id]);
  if (!visible) return null;
  return (
    <div className="broadcast" onClick={() => setVisible(false)}>
      📣 {broadcast.message}
    </div>
  );
}

let _winnerCtx;
function playWinnerFanfare() {
  try {
    _winnerCtx = _winnerCtx || new (window.AudioContext || window.webkitAudioContext)();
    const ctx = _winnerCtx;
    if (ctx.state === 'suspended') ctx.resume();
    const now = ctx.currentTime;
    [523, 659, 784, 1046].forEach((f, i) => {
      const t = now + i * 0.09;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'triangle';
      o.frequency.value = f;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.18, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
      o.connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + 0.5);
    });
  } catch (e) {}
}

Object.assign(window, { App, TopBar, BroadcastBanner, playWinnerFanfare });

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
