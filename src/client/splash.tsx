import './splash.css';
import { StrictMode, useEffect, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { requestExpandedMode } from '@devvit/web/client';
import type { InitResponse, LeaderboardEntry, LeaderboardResponse } from '../shared/api';


const FIREFLY_SPECS = [
  { top: 30, left: 20, dx: 60,  dy: -40, delay: 0 },
  { top: 60, left: 75, dx: -50, dy: -30, delay: 1.5 },
  { top: 22, left: 70, dx: -40, dy: 50,  delay: 3 },
  { top: 75, left: 30, dx: 45,  dy: -55, delay: 4.5 },
  { top: 45, left: 50, dx: 30,  dy: 40,  delay: 2.2 },
];

const LEAF_SPECS = [
  { left: 8,  size: 16, duration: 13, delay: -2,  drift: 30,  spin: 340 },
  { left: 28, size: 12, duration: 16, delay: -8,  drift: -24, spin: -280 },
  { left: 50, size: 18, duration: 15, delay: -5,  drift: 22,  spin: 300 },
  { left: 68, size: 13, duration: 18, delay: -11, drift: -30, spin: -320 },
  { left: 86, size: 15, duration: 14, delay: -3,  drift: 26,  spin: 260 },
];

const SplashSprites = () => (
  <>
    <div className="sunburst" aria-hidden="true" />
    <div className="glow-ring" aria-hidden="true" />
    <div className="leaf-layer" aria-hidden="true">
      {LEAF_SPECS.map((l, i) => (
        <span key={i} className="leaf" style={{
          left: `${l.left}%`, width: `${l.size}px`, height: `${l.size}px`,
          animationDuration: `${l.duration}s`, animationDelay: `${l.delay}s`,
          '--drift': `${l.drift}px`, '--spin': `${l.spin}deg`,
        } as CSSProperties} />
      ))}
    </div>
    <div className="firefly-layer" aria-hidden="true">
      {FIREFLY_SPECS.map((f, i) => (
        <span key={i} className="firefly" style={{
          top: `${f.top}%`, left: `${f.left}%`,
          '--dx': `${f.dx}px`, '--dy': `${f.dy}px`,
          animationDelay: `${f.delay}s`,
        } as CSSProperties} />
      ))}
    </div>
  </>
);

// Ambient "self-playing puzzle" on a 6×6 checkerboard (cell 40px, board 240px).
// Faithful to the game: 2 foxes advance from opposite edges toward the center
// garden, the lone gardener slides to block each in turn → they stall & retreat.
const DIORAMA_VEGGIES = [
  { src: '/assets/pumpkin.png', x: 84,  y: 124, delay: 0 },
  { src: '/assets/corn.png',    x: 124, y: 84,  delay: 0.6 },
  { src: '/assets/corn.png',    x: 164, y: 44,  delay: 1.1 },
  { src: '/assets/pumpkin.png', x: 44,  y: 164, delay: 0.3 },
];

const BoardDiorama = () => (
  <div className="diorama-enter">
    <div className="diorama" aria-hidden="true">
      <div className="diorama-board">
        {DIORAMA_VEGGIES.map((v, i) => (
          <div key={i} className="dio-token dio-veg" style={{ transform: `translate(${v.x}px, ${v.y}px)` }}>
            <img className="dio-veg-img" src={v.src} alt="" style={{ animationDelay: `${v.delay}s` }} />
          </div>
        ))}
        <div className="dio-token dio-foxA">
          <img className="dio-hop-img" src="/assets/fox1.png" alt="" />
        </div>
        <div className="dio-token dio-foxB">
          <img className="dio-hop-img" src="/assets/fox2.png" alt="" style={{ animationDelay: '0.3s' }} />
        </div>
        <div className="dio-token dio-gard">
          <img className="dio-hop-img" src="/assets/mia.png" alt="" style={{ animationDelay: '0.45s' }} />
        </div>
      </div>
    </div>
  </div>
);

const SCROLL_FOXES = [
  '/assets/fox1.png', '/assets/fox2.png', '/assets/fox3.png',
];
const SCROLL_GARDS = [
  '/assets/mia.png', '/assets/sam.png',
];
const SCROLL_DUR = 11;
const SCROLL_COUNT = 8;

const ScrollColumns = () => (
  <>
    <div className="scroll-col scroll-col-left" aria-hidden="true">
      {Array.from({ length: SCROLL_COUNT }, (_, i) => (
        <img key={i} className="scroll-sprite"
          src={SCROLL_FOXES[i % SCROLL_FOXES.length]!} alt=""
          style={{ animationDuration: `${SCROLL_DUR}s`, animationDelay: `${-(SCROLL_DUR / SCROLL_COUNT * i)}s` }} />
      ))}
    </div>
    <div className="scroll-col scroll-col-right" aria-hidden="true">
      {Array.from({ length: SCROLL_COUNT }, (_, i) => (
        <img key={i} className="scroll-sprite"
          src={SCROLL_GARDS[i % SCROLL_GARDS.length]!} alt=""
          style={{ animationDuration: `${SCROLL_DUR}s`, animationDelay: `${-(SCROLL_DUR / SCROLL_COUNT * i)}s` }} />
      ))}
    </div>
  </>
);

const LeaderboardContent = ({ entries }: { entries: LeaderboardEntry[] }) => {
  if (entries.length === 0) {
    return <div className="lb-empty">No scores yet. Be the first!</div>;
  }
  const top3 = entries.slice(0, 3);
  const rest = entries.slice(3);
  const order: (LeaderboardEntry | undefined)[] = [top3[1], top3[0], top3[2]];
  return (
    <>
      <div className="lb-podium">
        {order.map((entry, i) =>
          entry ? (
            <div key={entry.rank} className={`lb-podium-card${entry.rank === 1 ? ' first' : ''}`}>
              <div className="lb-avatar">
                <img
                  src={entry.snoovatarUrl ?? '/snoo.png'}
                  alt=""
                  onError={e => { (e.currentTarget as HTMLImageElement).src = '/snoo.png'; }}
                />
              </div>
              <div className="lb-rank-badge">{entry.rank}</div>
              <div className="lb-name">{entry.username}</div>
              <div className="lb-score-badge">{entry.score}</div>
            </div>
          ) : (
            <div key={`empty-${i}`} className="lb-podium-card empty" />
          )
        )}
      </div>
      {rest.length > 0 && (
        <div className="lb-list">
          {rest.map(e => (
            <div key={e.rank} className="lb-row">
              <span className="lb-row-rank">{e.rank}</span>
              <img
                className="lb-row-avatar"
                src={e.snoovatarUrl ?? '/snoo.png'}
                alt=""
                onError={ev => { (ev.currentTarget as HTMLImageElement).src = '/snoo.png'; }}
              />
              <span className="lb-row-name">{e.username}</span>
              <span className="lb-row-score">{e.score}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
};

type LbScope = 'puzzle' | 'global';

const Splash = () => {
  const [initData, setInitData] = useState<InitResponse | null>(null);
  const [lbOpen, setLbOpen] = useState(false);
  const [lbScope, setLbScope] = useState<LbScope>('puzzle');
  const [lbCache, setLbCache] = useState<Record<LbScope, LeaderboardEntry[] | null>>({ puzzle: null, global: null });
  const [lbFailed, setLbFailed] = useState<Record<LbScope, boolean>>({ puzzle: false, global: false });

  useEffect(() => {
    fetch('/api/init')
      .then(r => r.json() as Promise<InitResponse>)
      .then(d => setInitData(d))
      .catch(() => {});
  }, []);

  const snooUrl = initData?.snoovatarUrl ?? '/snoo.png';

  const handlePlay = (e: ReactMouseEvent) => {
    try { localStorage.setItem('gg_intent', 'play'); } catch { /* ignore */ }
    requestExpandedMode(e.nativeEvent, 'game');
  };

  const handleCreate = (e: ReactMouseEvent) => {
    try { localStorage.setItem('gg_intent', 'create'); } catch { /* ignore */ }
    requestExpandedMode(e.nativeEvent, 'game');
  };

  const loadLb = (scope: LbScope) => {
    setLbCache(prev => {
      if (prev[scope] !== null) return prev;
      fetch(`/api/leaderboard?scope=${scope}`)
        .then(r => r.json() as Promise<LeaderboardResponse>)
        .then(d => setLbCache(p => ({ ...p, [scope]: d.entries })))
        .catch(() => setLbFailed(p => ({ ...p, [scope]: true })));
      return prev;
    });
  };

  const handleLbOpen = () => {
    setLbOpen(true);
    setLbScope('puzzle');
    loadLb('puzzle');
  };

  const handleLbTab = (scope: LbScope) => {
    setLbScope(scope);
    loadLb(scope);
  };

  return (
    <div
      className={`app${initData?.customMap ? ' app-custom' : ''}`}
    >
      {initData === null ? null : initData.customMap ? <ScrollColumns /> : <SplashSprites />}
      {initData !== null && !initData.customMap && <BoardDiorama />}
      <div className="hero-enter">
        <div className="game-title">Gardener's Gambit</div>
        <div className="tagline">Trap the fox. Save the garden.</div>
        <div className="tagline-rule" aria-hidden="true">
          <svg viewBox="0 0 84 10">
            <path d="M0 5 H32" stroke="#e8b23d" strokeWidth="1" opacity="0.6" />
            <path d="M84 5 H52" stroke="#e8b23d" strokeWidth="1" opacity="0.6" />
            <path d="M42 1 C46 1 46 4 42 5 C38 6 38 9 42 9 C38 9 36 7 36 5 C36 3 38 1 42 1 Z" fill="#8fe3a8" />
          </svg>
        </div>
      </div>
      <div className={`lb-btn-enter${initData?.customMap ? ' lb-btn-enter-custom' : ''}`}>
        <button className="lb-btn" title="Leaderboard" aria-label="Leaderboard" onClick={handleLbOpen}>🏆</button>
      </div>

      {initData?.customMap && (
        <div className="vs-card-enter">
          <div className="vs-card">
            <div className="vs-side">
              <div className="vs-avatar-ring vs-ring-you">
                <img
                  className="vs-avatar"
                  src={snooUrl}
                  alt=""
                  onError={e => { (e.currentTarget as HTMLImageElement).src = '/snoo.png'; }}
                />
              </div>
              <span className="vs-name vs-name-you">u/{initData.username}</span>
            </div>
            <span className="vs-glove vs-glove-left" aria-hidden="true">🥊</span>
            <div className="vs-mid">
              <span className="vs-label">VS</span>
              {initData.topPlayer && <span className="vs-pts">{initData.topPlayer.score} pts</span>}
            </div>
            <span className="vs-glove vs-glove-right" aria-hidden="true">🥊</span>
            <div className="vs-side">
              <div className="vs-avatar-ring vs-ring-opp">
                <img
                  className="vs-avatar"
                  src={(initData.topPlayer?.snoovatarUrl ?? initData.customMap.authorSnoovatarUrl) ?? '/snoo.png'}
                  alt=""
                  onError={e => { (e.currentTarget as HTMLImageElement).src = '/snoo.png'; }}
                />
              </div>
              <span className="vs-name vs-name-opp">u/{initData.topPlayer?.username ?? initData.customMap.author}</span>
            </div>
          </div>
        </div>
      )}

      <div className="buttons buttons-enter">
        <button className="play-btn" onClick={handlePlay}>
          <span className="snoo-circle">
            {initData !== null && (
              <img
                className="btn-snoo"
                src={snooUrl}
                alt=""
                onError={e => { (e.currentTarget as HTMLImageElement).src = '/snoo.png'; }}
              />
            )}
          </span>
          {initData?.customMap ? 'Accept Challenge' : 'Play'}
        </button>
      </div>

      <button className="build-btn" onClick={handleCreate}>
        <img className="build-hammer" src="/assets/hammer.webp" alt="" />
        Build
      </button>

      {initData?.customMap && (
        <div className="splash-card made-by-card">
          <img
            className="card-avatar"
            src={initData.customMap.authorSnoovatarUrl ?? '/snoo.png'}
            alt=""
            onError={e => { (e.currentTarget as HTMLImageElement).src = '/snoo.png'; }}
          />
          <div className="card-info">
            <span className="card-label">Made by</span>
            <span className="card-username">u/{initData.customMap.author}</span>
            {initData.totalPlayers !== undefined && (
              <span className="card-stat">{initData.totalPlayers} solved</span>
            )}
          </div>
        </div>
      )}

      {!initData?.customMap && initData?.userRank !== undefined && (
        <div className="splash-card rank-card">
          <img
            className="card-avatar"
            src={snooUrl}
            alt=""
            onError={e => { (e.currentTarget as HTMLImageElement).src = '/snoo.png'; }}
          />
          <div className="card-info">
            <span className="card-label">🏆 Rank {initData.userRank}</span>
            <span className="card-username">u/{initData.username}</span>
            {initData.userScore !== undefined && (
              <span className="card-stat">{initData.userScore} pts</span>
            )}
          </div>
        </div>
      )}

      {lbOpen && (
        <div
          className="lb-modal open"
          onClick={e => { if (e.target === e.currentTarget) setLbOpen(false); }}
        >
          <div className="lb-content">
            <div className="lb-header">
              <span className="lb-title">Leaderboard</span>
              <button className="lb-close" aria-label="Close" onClick={() => setLbOpen(false)}>✕</button>
            </div>
            <div className="lb-tabs">
              <button className={`lb-tab${lbScope === 'puzzle' ? ' active' : ''}`} onClick={() => handleLbTab('puzzle')}>This Puzzle</button>
              <button className={`lb-tab${lbScope === 'global' ? ' active' : ''}`} onClick={() => handleLbTab('global')}>Global</button>
            </div>
            <div className="lb-body">
              {lbCache[lbScope] === null && !lbFailed[lbScope] && <div className="lb-loading">Loading...</div>}
              {lbFailed[lbScope] && <div className="lb-loading">Failed to load.</div>}
              {lbCache[lbScope] !== null && <LeaderboardContent entries={lbCache[lbScope]!} />}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Splash />
  </StrictMode>
);
