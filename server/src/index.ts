import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import express from 'express';
import cors from 'cors';
import { env } from './env.js';
import { closeDb, getDb } from './db/index.js';
import { runMigrations } from './db/migrate.js';
import { errorHandler, notFoundHandler } from './http/async.js';
import adminRouter from './routes/admin.js';
import authRouter from './routes/auth.js';
import deviceRouter from './routes/device.js';
import eventsRouter from './routes/events.js';
import publicRouter from './routes/public.js';
import { requireAdmin } from './middleware/auth.js';
import { bootstrap } from './services/bootstrap.js';

async function main(): Promise<void> {
  const db = await getDb();
  await runMigrations(db);
  await bootstrap();

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true);

  app.use(
    cors({
      origin(origin, callback) {
        if (!origin) return callback(null, true);
        if (env.corsOrigins.includes(origin)) return callback(null, true);
        if (/^http:\/\/localhost:\d+$/.test(origin) || /^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) {
          return callback(null, true);
        }
        return callback(null, false);
      },
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'foodfest-lucky-spin', database: db.kind, time: new Date().toISOString() });
  });

  app.use('/api/auth', authRouter);
  app.use('/api/public', publicRouter);
  app.use('/api/device', deviceRouter);
  app.use('/api/events', eventsRouter);
  app.use('/api/admin', requireAdmin, adminRouter);

  // Optionally serve the built frontend (single-process deployment).
  const webDist = resolve(process.cwd(), '../web/dist');
  if (existsSync(webDist)) {
    app.use(express.static(webDist));
    app.get(/^(?!\/api).*/, (_req, res) => {
      res.sendFile(resolve(webDist, 'index.html'));
    });
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  const server = app.listen(env.port, () => {
    console.log(`[api] Food Fest Lucky Spin API listening on http://localhost:${env.port}`);
    console.log(`[api] database: ${db.kind}`);
  });

  const shutdown = async (signal: string) => {
    console.log(`[api] ${signal} received, shutting down`);
    server.close();
    await closeDb();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error) => {
  console.error('[api] failed to start', error);
  process.exit(1);
});
