import { Hono } from 'hono';
import { context, redis, reddit } from '@devvit/web/server';
import { createPost } from '../core/post';
import type {
  DecrementResponse,
  IncrementResponse,
  InitResponse,
  PostScoreResponse,
  PublishMapResponse,
  SubmitScoreResponse,
  LeaderboardEntry,
  LeaderboardResponse,
} from '../../shared/api';

type ErrorResponse = {
  status: 'error';
  message: string;
};

export const api = new Hono();

const GLOBAL_LB = 'leaderboard:global';

// Rank in a sorted set counted from the top (highest score = rank 1).
async function standingOf(key: string, member: string): Promise<{ rank?: number; score?: number; total: number }> {
  const all = await redis.zRange(key, 0, -1, { by: 'rank' });
  const total = all.length;
  const idx = all.findIndex(e => e.member === member);
  if (idx < 0) return { total };
  return { rank: total - idx, score: all[idx]!.score, total };
}

api.get('/debug', (c) => {
  const stage = c.req.query('stage') ?? '?';
  const msg = c.req.query('msg') ?? '';
  const ua = c.req.header('user-agent') ?? '';
  console.log(`[SPLASH-DEBUG] stage=${stage} msg=${msg} ua=${ua}`);
  return c.json({ ok: true });
});

api.get('/init', async (c) => {
  const { postId } = context;

  if (!postId) {
    console.error('API Init Error: postId not found in devvit context');
    return c.json<ErrorResponse>(
      {
        status: 'error',
        message: 'postId is required but missing from context',
      },
      400
    );
  }

  try {
    const usernameRaw = await reddit.getCurrentUsername();
    const [count, customMapRaw, puzzleNumberRaw, snoovatarUrl] = await Promise.all([
      redis.get('count'),
      redis.get(`customMap:${postId}`),
      redis.get(`puzzleNumber:${postId}`),
      usernameRaw ? reddit.getSnoovatarUrl(usernameRaw) : Promise.resolve(undefined),
    ]);

    const customMeta = customMapRaw
      ? (JSON.parse(customMapRaw) as {
          title: string;
          author: string;
          grid: number[][];
          cols: number;
          rows: number;
          gardenerSkin?: number;
          foxSkin?: number;
        })
      : null;

    const username = usernameRaw ?? 'anonymous';

    const lbKey = `leaderboard:${postId}`;
    const [allLbEntries, authorSnooUrl, streakRaw, globalStanding] = await Promise.all([
      redis.zRange(lbKey, 0, -1, { by: 'rank' }),
      customMeta?.author ? reddit.getSnoovatarUrl(customMeta.author).catch(() => undefined) : Promise.resolve(undefined),
      redis.get(`streak:${username}`),
      standingOf(GLOBAL_LB, username),
    ]);
    const lbTotal = allLbEntries.length;
    const userLbIdx = allLbEntries.findIndex(e => e.member === username);
    const userRank = userLbIdx >= 0 ? lbTotal - userLbIdx : undefined;
    const userLbScore = userLbIdx >= 0 ? allLbEntries[userLbIdx]!.score : undefined;
    const streak = streakRaw ? (JSON.parse(streakRaw) as { count: number }).count : undefined;

    return c.json<InitResponse>({
      type: 'init',
      postId: postId,
      count: count ? parseInt(count) : 0,
      username,
      puzzleNumber: puzzleNumberRaw ? parseInt(puzzleNumberRaw) : undefined,
      snoovatarUrl: snoovatarUrl ?? undefined,
      userRank,
      userScore: userLbScore,
      totalPlayers: lbTotal > 0 ? lbTotal : undefined,
      streak,
      globalRank: globalStanding.rank,
      globalScore: globalStanding.score,
      globalTotalPlayers: globalStanding.total > 0 ? globalStanding.total : undefined,
      customMap: customMeta
        ? {
            title: customMeta.title,
            author: customMeta.author,
            authorSnoovatarUrl: authorSnooUrl ?? undefined,
            grid: customMeta.grid,
            cols: customMeta.cols,
            rows: customMeta.rows,
            gardenerSkin: customMeta.gardenerSkin ?? 0,
            foxSkin: customMeta.foxSkin ?? 0,
          }
        : null,
    });
  } catch (error) {
    console.error(`API Init Error for post ${postId}:`, error);
    let errorMessage = 'Unknown error during initialization';
    if (error instanceof Error) {
      errorMessage = `Initialization failed: ${error.message}`;
    }
    return c.json<ErrorResponse>(
      { status: 'error', message: errorMessage },
      400
    );
  }
});

api.post('/increment', async (c) => {
  const { postId } = context;
  if (!postId) {
    return c.json<ErrorResponse>(
      {
        status: 'error',
        message: 'postId is required',
      },
      400
    );
  }

  const count = await redis.incrBy('count', 1);
  return c.json<IncrementResponse>({
    count,
    postId,
    type: 'increment',
  });
});

api.post('/decrement', async (c) => {
  const { postId } = context;
  if (!postId) {
    return c.json<ErrorResponse>(
      {
        status: 'error',
        message: 'postId is required',
      },
      400
    );
  }

  const count = await redis.incrBy('count', -1);
  return c.json<DecrementResponse>({
    count,
    postId,
    type: 'decrement',
  });
});

api.post('/publishMap', async (c) => {
  try {
    const body = await c.req.json<{ title: string; grid: number[][]; cols: number; rows: number; gardenerSkin?: number; foxSkin?: number; verified?: boolean }>();
    const author = await reddit.getCurrentUsername() ?? 'anonymous';
    const mapTitle = body.title || 'Custom Map';

    const post = await createPost(`${mapTitle} by u/${author}`, true);
    const postUrl = `https://www.reddit.com${post.permalink}`;

    await redis.set(`customMap:${post.id}`, JSON.stringify({
      title: body.title,
      grid: body.grid,
      cols: body.cols,
      rows: body.rows,
      gardenerSkin: body.gardenerSkin ?? 0,
      foxSkin: body.foxSkin ?? 0,
      author,
      createdAt: Date.now(),
    }));

    if (body.verified) {
      const foxCount = body.grid.flat().filter((cell: number) => cell === 4).length;
      if (foxCount >= 1 && foxCount <= 3) {
        const entry = {
          id: `${Date.now()}-${post.id}`,
          title: body.title,
          author,
          grid: body.grid,
          cols: body.cols,
          rows: body.rows,
          gardenerSkin: body.gardenerSkin ?? 0,
          foxSkin: body.foxSkin ?? 0,
          difficulty: foxCount,
          foxCount,
          verifiedAt: new Date().toISOString(),
          verifiedAtTs: Date.now(),
          postId: post.id,
          postUrl,
          sourceType: 'custom',
        };
        await redis.zAdd(`verified_levels:${foxCount}`, { score: Date.now(), member: JSON.stringify(entry) });
      }
    }

    return c.json<PublishMapResponse>({ type: 'publishMap', postId: post.id, postUrl, author });
  } catch (err) {
    return c.json<ErrorResponse>({ status: 'error', message: String(err) }, 400);
  }
});

api.get('/verifiedLevels', async (c) => {
  try {
    const d = c.req.query('difficulty');
    const diffs = d ? [parseInt(d)] : [1, 2, 3];
    const out: Record<string, unknown[]> = {};
    for (const diff of diffs) {
      const raw = await redis.zRange(`verified_levels:${diff}`, 0, -1, { by: 'rank' });
      out[`difficulty_${diff}`] = raw.map((e) => JSON.parse(e.member));
    }
    return c.json(out);
  } catch (err) {
    return c.json<ErrorResponse>({ status: 'error', message: String(err) }, 400);
  }
});

api.post('/submitScore', async (c) => {
  const { postId } = context;
  if (!postId) return c.json<ErrorResponse>({ status: 'error', message: 'postId required' }, 400);

  try {
    const body = await c.req.json<{ score: number }>();
    const username = await reddit.getCurrentUsername() ?? 'anonymous';
    const lbKey = `leaderboard:${postId}`;

    const existing = await redis.zScore(lbKey, username);
    let streak: number | undefined;
    if (existing === undefined) {
      // First solve of this post: record local score, then credit global points once.
      await redis.zAdd(lbKey, { member: username, score: body.score });
      await redis.incrBy(`completions:${username}`, 1);

      const [puzzleNumberRaw, customMapRaw] = await Promise.all([
        redis.get(`puzzleNumber:${postId}`),
        redis.get(`customMap:${postId}`),
      ]);
      const customAuthor = customMapRaw ? (JSON.parse(customMapRaw) as { author?: string }).author : undefined;
      const isSelfAuthored = customAuthor !== undefined && customAuthor === username;
      // Global points: first-try score, deduped per post, excluding your own published maps.
      if (!isSelfAuthored) {
        await redis.zIncrBy(GLOBAL_LB, username, body.score);
      }
      // Streak: daily puzzles only. Consecutive puzzle numbers extend it; a gap resets it.
      if (puzzleNumberRaw) {
        const num = parseInt(puzzleNumberRaw);
        const raw = await redis.get(`streak:${username}`);
        const prev = raw ? (JSON.parse(raw) as { count: number; lastPuzzle: number }) : undefined;
        const count = prev && prev.lastPuzzle === num - 1 ? prev.count + 1 : 1;
        streak = count;
        await redis.set(`streak:${username}`, JSON.stringify({ count, lastPuzzle: num }));
      }
    } else {
      const raw = await redis.get(`streak:${username}`);
      streak = raw ? (JSON.parse(raw) as { count: number }).count : undefined;
    }

    const recordedScore = existing ?? body.score;
    const allEntries = await redis.zRange(lbKey, 0, -1, { by: 'rank' });
    const total = allEntries.length;
    const rankFromBottom = allEntries.findIndex(e => e.member === username);
    const rank = rankFromBottom >= 0 ? total - rankFromBottom : total;

    // Fixed 400-pt ranges (0-400, 401-800, …), gaps filled so the x-axis is continuous.
    // Tail collapses into a final overflow bucket once the range count exceeds MAX_BUCKETS.
    const BUCKET = 400;
    const MAX_BUCKETS = 10;
    const counts = new Map<number, number>();
    let maxIdx = 0;
    for (const { score } of allEntries) {
      const idx = Math.floor(Math.max(0, score) / BUCKET);
      counts.set(idx, (counts.get(idx) ?? 0) + 1);
      if (idx > maxIdx) maxIdx = idx;
    }
    const capIdx = Math.min(maxIdx, MAX_BUCKETS - 1);
    const buckets: { min: number; count: number; overflow?: boolean }[] = [];
    for (let i = 0; i <= capIdx; i++) {
      let count = counts.get(i) ?? 0;
      const overflow = i === capIdx && maxIdx > capIdx;
      if (overflow) for (let j = capIdx + 1; j <= maxIdx; j++) count += counts.get(j) ?? 0;
      buckets.push(overflow ? { min: i * BUCKET, count, overflow } : { min: i * BUCKET, count });
    }

    const global = await standingOf(GLOBAL_LB, username);
    return c.json<SubmitScoreResponse>({ type: 'submitScore', submitted: existing === undefined, yourScore: recordedScore, rank, total, buckets, streak, globalRank: global.rank, globalScore: global.score });
  } catch (err) {
    return c.json<ErrorResponse>({ status: 'error', message: String(err) }, 400);
  }
});

api.get('/leaderboard', async (c) => {
  const { postId } = context;
  const scope = c.req.query('scope') === 'global' ? 'global' : 'puzzle';

  try {
    let lbKey: string;
    if (scope === 'global') {
      lbKey = GLOBAL_LB;
    } else {
      if (!postId) return c.json<ErrorResponse>({ status: 'error', message: 'postId required' }, 400);
      lbKey = `leaderboard:${postId}`;
    }
    const allEntries = await redis.zRange(lbKey, 0, 99, { by: 'rank', reverse: true });

    const top10 = allEntries.slice(0, 10);
    const snoovatarUrls = await Promise.all(
      top10.map(({ member }) => reddit.getSnoovatarUrl(member).catch(() => undefined))
    );

    const entries: LeaderboardEntry[] = allEntries.map(({ member, score }, i) => ({
      rank: i + 1,
      username: member,
      score,
      snoovatarUrl: i < 10 ? snoovatarUrls[i] : undefined,
    }));

    return c.json<LeaderboardResponse>({ type: 'leaderboard', scope, entries });
  } catch (err) {
    return c.json<ErrorResponse>({ status: 'error', message: String(err) }, 400);
  }
});

api.post('/postComment', async (c) => {
  const { postId } = context;
  if (!postId) return c.json<ErrorResponse>({ status: 'error', message: 'postId required' }, 400);

  try {
    const body = await c.req.json<{ comment: string }>();
    const username = await reddit.getCurrentUsername() ?? 'anonymous';

    await reddit.submitComment({
      id: postId,
      text: body.comment,
      runAs: 'USER',
    });

    return c.json({ type: 'postComment', username });
  } catch (err) {
    return c.json<ErrorResponse>({ status: 'error', message: String(err) }, 400);
  }
});

async function getOrCreateStickyComment(postId: string): Promise<string> {
  const cacheKey = `sticky:${postId}`;
  const cached = await redis.get(cacheKey);
  if (cached) return cached;

  const comments = await reddit.getComments({ postId: postId as `t3_${string}`, sort: 'old', limit: 100 }).all();
  const existing = comments.find((cm) => cm.stickied);
  if (existing) {
    await redis.set(cacheKey, existing.id);
    return existing.id;
  }

  const created = await reddit.submitComment({
    id: postId as `t3_${string}`,
    text: '🌱 Post your scores here!',
    runAs: 'APP',
  });
  await created.distinguish(true);
  await redis.set(cacheKey, created.id);
  return created.id;
}

api.post('/postScore', async (c) => {
  const { postId } = context;
  if (!postId) return c.json<ErrorResponse>({ status: 'error', message: 'postId required' }, 400);

  try {
    const body = await c.req.json<{ score: number; time: string }>();
    const username = await reddit.getCurrentUsername() ?? 'anonymous';

    // Store high score per user
    const key = `score:${postId}:${username}`;
    const prev = await redis.get(key);
    const prevScore = prev ? parseInt(prev) : 0;
    if (body.score > prevScore) await redis.set(key, String(body.score));

    // Reply to sticky comment as the user (generic score comments must not be top-level)
    const stickyId = await getOrCreateStickyComment(postId);
    await reddit.submitComment({
      id: stickyId as `t1_${string}`,
      text: `🌱 I solved Gardener's Gambit in **${body.time}** — Score: **${body.score} pts**`,
      runAs: 'USER',
    });

    return c.json<PostScoreResponse>({ type: 'postScore', username, score: body.score });
  } catch (err) {
    return c.json<ErrorResponse>({ status: 'error', message: String(err) }, 400);
  }
});
