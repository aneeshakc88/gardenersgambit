import './splash.css';
import { StrictMode, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { requestExpandedMode } from '@devvit/web/client';
import type { InitResponse, LeaderboardEntry, LeaderboardResponse } from '../shared/api';


const SG_SRCS = [
  '/assets/fox1.png', '/assets/fox2.png', '/assets/fox3.png',
  '/assets/fox4.png', '/assets/fox5.png', '/assets/fox5.1.png',
  '/assets/corn.png', '/assets/pumpkin.png',
  '/assets/mia.png',  '/assets/sam.png',
  '/assets/putin_gardener.png', '/assets/trump_gardener.png',
  '/assets/trump_gardener1.png',
];

// [x1%, x2%, y1%, y2%] — edge/corner zones, away from center UI
const SG_ZONES: [number, number, number, number][] = [
  [2,  22,  2, 22],  // TL corner
  [40, 60,  2, 12],  // T strip (thin, above title)
  [78, 97,  2, 22],  // TR corner
  [2,  13, 28, 72],  // L side
  [87, 98, 28, 72],  // R side
  [2,  22, 78, 97],  // BL corner
  [38, 62, 85, 97],  // B strip
  [78, 97, 78, 97],  // BR corner
];

function sgAnim(src: string): string {
  if (src.includes('fox')) return 'sg-wander';
  if (src.includes('corn') || src.includes('pumpkin')) return 'sg-float';
  return 'sg-sway';
}

const SplashSprites = () => {
  const sprites = useMemo(() => (
    Array.from({ length: 20 }, (_, i) => {
      const [x1, x2, y1, y2] = SG_ZONES[i % SG_ZONES.length];
      const src = SG_SRCS[i % SG_SRCS.length];
      return {
        id: i, src,
        x:        x1 + Math.random() * (x2 - x1),
        y:        y1 + Math.random() * (y2 - y1),
        size:     36 + Math.random() * 24,
        opacity:  0.65 + Math.random() * 0.27,
        duration: 7 + Math.random() * 7,
        delay:    -(Math.random() * 14),
        anim:     sgAnim(src),
      };
    })
  ), []);

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
          src={SCROLL_FOXES[i % SCROLL_FOXES.length]} alt=""
          style={{ animationDuration: `${SCROLL_DUR}s`, animationDelay: `${-(SCROLL_DUR / SCROLL_COUNT * i)}s` }} />
      ))}
    </div>
    <div className="scroll-col scroll-col-right" aria-hidden="true">
      {Array.from({ length: SCROLL_COUNT }, (_, i) => (
        <img key={i} className="scroll-sprite"
          src={SCROLL_GARDS[i % SCROLL_GARDS.length]} alt=""
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

const Splash = () => {
  const [initData, setInitData] = useState<InitResponse | null>(null);
  const [lbOpen, setLbOpen] = useState(false);
  const [lbEntries, setLbEntries] = useState<LeaderboardEntry[] | null>(null);
  const [lbFailed, setLbFailed] = useState(false);

  useEffect(() => {
    fetch('/api/init')
      .then(r => r.json() as Promise<InitResponse>)
      .then(d => setInitData(d))
      .catch(() => {});
  }, []);

  const snooUrl = initData?.snoovatarUrl ?? '/snoo.png';

  const handlePlay = (e: React.MouseEvent) => {
    try { localStorage.setItem('gg_intent', 'play'); } catch { /* ignore */ }
    requestExpandedMode(e.nativeEvent, 'game');
  };

  const handleCreate = (e: React.MouseEvent) => {
    try { localStorage.setItem('gg_intent', 'create'); } catch { /* ignore */ }
    requestExpandedMode(e.nativeEvent, 'game');
  };

  const handleLbOpen = () => {
    setLbOpen(true);
    if (lbEntries !== null || lbFailed) return;
    fetch('/api/leaderboard')
      .then(r => r.json() as Promise<LeaderboardResponse>)
      .then(d => setLbEntries(d.entries))
      .catch(() => setLbFailed(true));
  };

  return (
    <div
      className="app"
    >
      {initData === null ? null : initData.customMap ? <ScrollColumns /> : <SplashSprites />}
      <div className="game-title">Gardener's Gambit</div>
      <div className="tagline">Trap the fox. Save the garden.</div>
      <button className="lb-btn" title="Leaderboard" aria-label="Leaderboard" onClick={handleLbOpen}>🏆</button>
      <div className="buttons">
        <button className="play-btn" onClick={handlePlay}>
          <span className="snoo-circle">
            <img
              className="btn-snoo"
              src={snooUrl}
              alt=""
              onError={e => { (e.currentTarget as HTMLImageElement).src = '/snoo.png'; }}
            />
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

      {initData?.userRank !== undefined && (
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
            <div className="lb-body">
              {lbEntries === null && !lbFailed && <div className="lb-loading">Loading...</div>}
              {lbFailed && <div className="lb-loading">Failed to load.</div>}
              {lbEntries !== null && <LeaderboardContent entries={lbEntries} />}
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
