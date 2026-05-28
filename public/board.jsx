// board.jsx — Bingo board components: Square, Board, MiniBoard, LiveStrip.

function Square({ word, claimed, pending, isFree, onClick, dimmed }) {
  const cls = [
    'cell',
    isFree && 'free',
    claimed && 'claimed',
    pending && 'pending',
    dimmed && 'dimmed',
  ].filter(Boolean).join(' ');
  // Show the full word as a hover tooltip via CSS ::before (skip for the FREE label).
  const tipWord = (isFree && word === 'FREE') ? undefined : word;
  return (
    <div className={cls} onClick={onClick} role="button" tabIndex={isFree ? -1 : 0} data-word={tipWord}>
      <span>{word}</span>
    </div>
  );
}

// Render BINGO line overlay paths for a 5x5 grid.
// We render the line as %-based coords inside .line-overlay (which inset 14px to match board padding).
function BingoLines({ lines }) {
  if (!lines.length) return null;
  // 5x5 grid; cell width fraction 1/5; we want lines through centers of cells
  const c = (i) => (i + 0.5) * (100 / 5); // center of cell i in %
  const paths = lines.map((l, idx) => {
    let d;
    if (l.type === 'row') {
      d = `M ${c(0)} ${c(l.index)} L ${c(4)} ${c(l.index)}`;
    } else if (l.type === 'col') {
      d = `M ${c(l.index)} ${c(0)} L ${c(l.index)} ${c(4)}`;
    } else if (l.type === 'diag' && l.index === 0) {
      d = `M ${c(0)} ${c(0)} L ${c(4)} ${c(4)}`;
    } else {
      d = `M ${c(4)} ${c(0)} L ${c(0)} ${c(4)}`;
    }
    return <path key={idx} d={d} />;
  });
  return (
    <div className="line-overlay">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none">{paths}</svg>
    </div>
  );
}

function Board({ board, isOwn, label, onSquareClick, onRemove, canRemove }) {
  const lines = detectBingos(board.claimed);
  return (
    <div className="board-col">
      <div className="board-header" style={{ width: '100%', maxWidth: 560 }}>
        <div className="label">{label}</div>
        <div className="row" style={{ gap: 8 }}>
          {lines.length > 0 && (
            <span className="pill good">BINGO ×{lines.length}</span>
          )}
          {canRemove && (
            <button className="btn btn-ghost btn-xs" onClick={onRemove}>Remove</button>
          )}
        </div>
      </div>
      <div className="board-letters" style={{ width: '100%', maxWidth: 560 }}>
        {['B','I','N','G','O'].map(l => <span key={l}>{l}</span>)}
      </div>
      <div className={'board' + (lines.length ? ' has-bingo' : '')}>
        {board.words.map((word, i) => (
          <Square
            key={i}
            word={word}
            claimed={board.claimed[i]}
            pending={board.pending[i]}
            isFree={i === 12}
            onClick={isOwn ? () => onSquareClick(i) : undefined}
          />
        ))}
        <BingoLines lines={lines} />
      </div>
    </div>
  );
}

// Static, read-only board for spectator view (e.g. modal expand).
// hideBingo: don't reveal completed lines/glow (used for unconfirmed bingos shown to other players).
function ReadOnlyBoard({ board, scale = 1, hideBingo = false }) {
  const lines = hideBingo ? [] : detectBingos(board.claimed);
  return (
    <div className="board-col">
      <div className="board-letters" style={{ width: '100%', maxWidth: 560 * scale }}>
        {['B','I','N','G','O'].map(l => <span key={l}>{l}</span>)}
      </div>
      <div className={'board' + (lines.length ? ' has-bingo' : '')} style={{ maxWidth: 560 * scale, cursor: 'default' }}>
        {board.words.map((word, i) => (
          <div
            key={i}
            className={[
              'cell',
              i === 12 && 'free',
              board.claimed[i] && 'claimed',
              board.pending[i] && 'pending',
            ].filter(Boolean).join(' ')}
            data-word={i === 12 && word === 'FREE' ? undefined : word}
            style={{ cursor: 'default' }}
          >
            <span>{word}</span>
          </div>
        ))}
        <BingoLines lines={lines} />
      </div>
    </div>
  );
}

function MiniBoard({ player, isSelf, isLive, isConfirmedWinner, onClick }) {
  const boards = player.boards;
  const claimedCount = boards.reduce((s, b) => s + b.claimed.filter(Boolean).length, 0);
  const total = 25 * boards.length;
  // Only reveal BINGO publicly once the host has confirmed it.
  const bingoLines = isConfirmedWinner
    ? boards.reduce((s, b) => s + detectBingos(b.claimed).length, 0)
    : 0;
  const cls = [
    'mini-card',
    boards.length > 1 && 'multi-board',
    bingoLines > 0 && 'has-bingo',
    isSelf && 'is-self',
  ].filter(Boolean).join(' ');
  return (
    <div className={cls} onClick={onClick}>
      <div className="mini-card-header">
        <div className="row" style={{ gap: 6 }}>
          <span className={'dot' + (isLive ? ' live' : '')}></span>
          <span className="name">{player.username}</span>
        </div>
        <span className="count">{claimedCount}/{total}</span>
      </div>
      <div className="mini-boards-row">
        {boards.map((board, bi) => (
          <div className="mini-board-panel" key={bi}>
            {boards.length > 1 && (
              <span className="mini-board-label">{bi + 1}</span>
            )}
            <div className="mini-grid">
              {board.words.map((_, i) => (
                <div
                  key={i}
                  className={[
                    'mc',
                    i === 12 && 'free',
                    board.claimed[i] && 'claimed',
                    board.pending[i] && 'pending',
                  ].filter(Boolean).join(' ')}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
      {bingoLines > 0 && (
        <div style={{
          marginTop: 6, textAlign: 'center',
          fontFamily: 'var(--font-display)',
          fontSize: 11, letterSpacing: '.12em',
          color: 'var(--bingo-glow)', fontWeight: 700
        }}>
          BINGO ×{bingoLines}
        </div>
      )}
    </div>
  );
}

function LiveStrip({ state, selfUsername, onClickPlayer }) {
  const live = getLiveUsernames(state);
  const confirmed = new Set(state.forcedWinners || []);
  const players = Object.values(state.players);
  // sort: self first, then live, then others; within group by claim count desc
  const sorted = players.slice().sort((a, b) => {
    if (a.username === selfUsername) return -1;
    if (b.username === selfUsername) return 1;
    const al = live.has(a.username) ? 1 : 0;
    const bl = live.has(b.username) ? 1 : 0;
    if (al !== bl) return bl - al;
    const ac = a.boards[0].claimed.filter(Boolean).length;
    const bc = b.boards[0].claimed.filter(Boolean).length;
    return bc - ac;
  });
  if (sorted.length === 0) {
    return (
      <>
        <div className="live-strip-title"><span className="pip"></span> Live boards · waiting for players</div>
        <div className="live-strip" style={{ padding: '8px 28px 24px' }}>
          <span className="floating-hint" style={{ fontStyle: 'italic' }}>
            No active players yet — be the first to join.
          </span>
        </div>
      </>
    );
  }
  const liveCount = sorted.filter(p => live.has(p.username)).length;
  return (
    <>
      <div className="live-strip-title">
        <span className="pip"></span>
        Live boards · {liveCount} online{sorted.length > liveCount ? ` · ${sorted.length - liveCount} idle` : ''}
      </div>
      <div className="live-strip">
        {sorted.map(p => (
          <MiniBoard
            key={p.username}
            player={p}
            isSelf={p.username === selfUsername}
            isLive={live.has(p.username)}
            isConfirmedWinner={confirmed.has(p.username)}
            onClick={() => onClickPlayer && onClickPlayer(p)}
          />
        ))}
      </div>
    </>
  );
}

Object.assign(window, { Square, Board, ReadOnlyBoard, MiniBoard, LiveStrip, BingoLines });
