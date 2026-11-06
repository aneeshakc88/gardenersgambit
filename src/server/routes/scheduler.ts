import { Hono } from 'hono';
import type { TriggerResponse } from '@devvit/web/shared';
import { context, redis } from '@devvit/web/server';
import { createPost } from '../core/post';

export const scheduler = new Hono();

function dailyTitle(num: number): string {
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const now = new Date();
  const d = now.getDate();
  const suffix = [11,12,13].includes(d) ? 'th' : d%10===1 ? 'st' : d%10===2 ? 'nd' : d%10===3 ? 'rd' : 'th';
  return `Gardener's Gambit #${num} - ${months[now.getMonth()]} ${d}${suffix}, ${now.getFullYear()}`;
}

scheduler.post('/daily-post', async (c) => {
  try {
    const num = await redis.incrBy('dailyCount', 1);
    const post = await createPost(dailyTitle(num));
    await redis.set(`puzzleNumber:${post.id}`, String(num));
    return c.json<TriggerResponse>(
      { status: 'success', message: `Daily post #${num} created in ${context.subredditName} (${post.id})` },
      200
    );
  } catch (error) {
    console.error(`Error creating daily post: ${error}`);
    return c.json<TriggerResponse>({ status: 'error', message: 'Failed to create daily post' }, 400);
  }
});
