import './splash.css';
import { StrictMode, useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { requestExpandedMode } from '@devvit/web/client';
import type { InitResponse, LeaderboardEntry, LeaderboardResponse } from '../shared/api';


const SG_SRCS = [
  '/assets/fox1.png', '/assets/fox2.png', '/assets/fox3.png',
  '/assets/fox4.png', '/assets/fox5.png',
  '/assets/corn.png', '/assets/pumpkin.png',
  '/assets/mia.png',  '/assets/sam.png',
  '/assets/putin_gardener.png', '/assets/trump_gardener.png',
];

function sgAnim(src: string): string {
  if (src.includes('fox')) return 'sg-wander';
  if (src.includes('corn') || src.includes('pumpkin')) return 'sg-float';
  return 'sg-sway';
}

const SplashSprites = () => {
  const sprites = useMemo(() => {
    // Rejection-sample positions so no two sprites overlap. Min centre gap in %-space
    // (x and y map to different px, but a generous gap keeps sprites clear even when foxes drift).
    const GAP = 11;
    const placed: { x: number; y: number }[] = [];
    const out: { id: number; src: string; x: number; y: number; size: number; opacity: number; duration: number; delay: number; anim: string }[] = [];
    // Centre box (where buttons/title sit) is capped at 2 sprites; everyone else keeps clear of a
    // wider halo around it, then spreads over the rest of the board.
    const CENTER = 2;
    const inBox = (x: number, y: number) => x >= 25 && x <= 75 && y >= 25 && y <= 75;
    let attempts = 0;
    while (out.length < 14 && attempts < 2000) {
      attempts++;
      const wantCenter = out.length < CENTER;
      const x = wantCenter ? 38 + Math.random() * 24 : 5 + Math.random() * 90;
      const y = wantCenter ? 38 + Math.random() * 24 : 7 + Math.random() * 86;
      if (!wantCenter && inBox(x, y)) continue;
      if (placed.some(p => Math.hypot(p.x - x, p.y - y) < GAP)) continue;
      placed.push({ x, y });
      const src = SG_SRCS[out.length % SG_SRCS.length]!;
      out.push({
        id: out.length, src, x, y,
        size:     36 + Math.random() * 24,
        opacity:  0.65 + Math.random() * 0.27,
        duration: 7 + Math.random() * 7,
        delay:    -(Math.random() * 14),
        anim:     sgAnim(src),
      });
    }
    return out;
  }, []);

  return (
    <div className="sg-layer" aria-hidden="true">
      {sprites.map(s => (
        <img key={s.id} className="sg-sprite" src={s.src} alt=""
          style={{
            left: `${s.x}%`, top: `${s.y}%`,
            width: `${s.size}px`, height: `${s.size}px`,
            opacity: s.opacity,
            animationName: s.anim,
            animationDuration: `${s.duration}s`,
            animationDelay: `${s.delay}s`,
          }}
        />
      ))}
    </div>
  );
};

const SCROLL_FOXES = [
  '/assets/fox1.png', '/assets/fox2.png',
  '/assets/fox3.png', '/assets/fox4.png',
];
const SCROLL_GARDS = [
  '/assets/mia.png',            '/assets/sam.png',
  '/assets/trump_gardener.png', '/assets/putin_gardener.png',
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
      className="app"
    >
      {initData === null ? null : initData.customMap ? <ScrollColumns /> : <SplashSprites />}
      <div className="game-title">Gardener's Gambit</div>
      <div className="tagline">Trap the fox. Save the garden.</div>
      <button className={`lb-btn${initData?.customMap ? ' lb-btn-custom' : ''}`} title="Leaderboard" aria-label="Leaderboard" onClick={handleLbOpen}>🏆</button>
      <div className="buttons">
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
          Play
        </button>
        <button className="create-btn" onClick={handleCreate}>
          Create Level
        </button>
      </div>

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

      {(initData?.globalRank !== undefined || initData?.userRank !== undefined) && (
        <div className="splash-card rank-card">
          <img
            className="card-avatar"
            src={snooUrl}
            alt=""
            onError={e => { (e.currentTarget as HTMLImageElement).src = '/snoo.png'; }}
          />
          <div className="card-info">
            <span className="card-label">
              🏆 {initData.globalRank !== undefined ? `Global Rank ${initData.globalRank}` : `Rank ${initData.userRank}`}
            </span>
            <span className="card-username">u/{initData.username}</span>
            {initData.globalScore !== undefined && (
              <span className="card-stat">{initData.globalScore} pts</span>
            )}
          </div>
          {initData.streak !== undefined && initData.streak > 0 && (
            <div className="streak-badge">🔥 {initData.streak}</div>
          )}
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
