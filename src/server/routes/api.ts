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
    const [allLbEntries, authorSnooUrl] = await Promise.all([
      redis.zRange(lbKey, 0, -1, { by: 'rank' }),
      customMeta?.author ? reddit.getSnoovatarUrl(customMeta.author).catch(() => undefined) : Promise.resolve(undefined),
    ]);
    const lbTotal = allLbEntries.length;
    const userLbIdx = allLbEntries.findIndex(e => e.member === username);
    const userRank = userLbIdx >= 0 ? lbTotal - userLbIdx : undefined;
    const userLbScore = userLbIdx >= 0 ? allLbEntries[userLbIdx].score : undefined;

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
        await redis.lPush(`verified_levels:${foxCount}`, JSON.stringify(entry));
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
      const raw = await redis.lRange(`verified_levels:${diff}`, 0, -1);
      out[`difficulty_${diff}`] = raw.map((s: string) => JSON.parse(s));
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
    if (existing === undefined) {
      await redis.zAdd(lbKey, { member: username, score: body.score });
    }

    const recordedScore = existing ?? body.score;
    const allEntries = await redis.zRange(lbKey, 0, -1, { by: 'rank' });
    const total = allEntries.length;
    const rankFromBottom = allEntries.findIndex(e => e.member === username);
    const rank = rankFromBottom >= 0 ? total - rankFromBottom : total;

    const BUCKET = 100;
    const bucketMap = new Map<number, number>();
    for (const { score } of allEntries) {
      const b = Math.floor(score / BUCKET) * BUCKET;
      bucketMap.set(b, (bucketMap.get(b) ?? 0) + 1);
    }
    const buckets = Array.from(bucketMap.entries())
      .map(([min, count]) => ({ min, count }))
      .sort((a, b) => a.min - b.min);

    return c.json<SubmitScoreResponse>({ type: 'submitScore', submitted: existing === undefined, yourScore: recordedScore, rank, total, buckets });
  } catch (err) {
    return c.json<ErrorResponse>({ status: 'error', message: String(err) }, 400);
  }
});

api.get('/leaderboard', async (c) => {
  const { postId } = context;
  if (!postId) return c.json<ErrorResponse>({ status: 'error', message: 'postId required' }, 400);

  try {
    const lbKey = `leaderboard:${postId}`;
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

    return c.json<LeaderboardResponse>({ type: 'leaderboard', entries });
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

    // Post comment as the user
    await reddit.submitComment({
      id: postId,
      text: `🌱 I solved Gardener's Gambit in **${body.time}** — Score: **${body.score} pts**`,
      runAs: 'USER',
    });

    return c.json<PostScoreResponse>({ type: 'postScore', username, score: body.score });
  } catch (err) {
    return c.json<ErrorResponse>({ status: 'error', message: String(err) }, 400);
  }
});
