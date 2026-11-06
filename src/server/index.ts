import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { createServer, getServerPort } from '@devvit/web/server';
import { api } from './routes/api';
import { forms } from './routes/forms';
import { menu } from './routes/menu';
import { triggers } from './routes/triggers';
import { scheduler } from './routes/scheduler';

const app = new Hono();

app.use('*', async (c, next) => {
  const t = Date.now();
  console.log(`[REQ] ${c.req.method} ${c.req.path}`);
  await next();
  console.log(`[RES] ${c.req.method} ${c.req.path} -> ${c.res.status} (${Date.now() - t}ms)`);
});

const internal = new Hono();

internal.route('/menu', menu);
internal.route('/form', forms);
internal.route('/triggers', triggers);
internal.route('/scheduler', scheduler);

app.route('/api', api);
app.route('/internal', internal);

serve({
  fetch: app.fetch,
  createServer,
  port: getServerPort(),
});
