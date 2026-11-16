import cookieParser from 'cookie-parser';
import express from 'express';
import { env } from './env.ts';
import { logger } from './lib/logger.ts';
import { closePool, healthcheck } from './db/pool.ts';
import { accessLog, corsMiddleware, requestId, requireJsonBody, securityHeaders } from './middleware/security.ts';
import { attachAuth, csrfGuard, requireAuth } from './middleware/auth.ts';
import { errorHandler, notFoundHandler } from './middleware/errors.ts';
import { authRouter } from './routes/auth.ts';
import { ticketsRouter } from './routes/tickets.ts';
import { openRouter } from './routes/open.ts';
import { workspaceRouter } from './routes/workspace.ts';
import { startWorkers, stopWorkers } from './workers/expiry.ts';

export const app = express();
app.set('trust proxy', env.trustProxyHops);
app.disable('x-powered-by');

app.use(requestId);
app.use(securityHeaders);
app.use(corsMiddleware);
app.use(cookieParser());
app.use(express.json({ limit: env.bodyLimitBytes }));
app.use(requireJsonBody);
app.use(accessLog);
app.use(attachAuth);
app.use(csrfGuard);

app.get('/health', (_req, res) => {
  res.status(200).json({ ok: true, service: 'envinity-api' });
});
app.get('/health/db', async (_req, res) => {
  const result = await healthcheck();
  res.status(result.ok ? 200 : 503).json(result);
});

app.use('/api/auth', authRouter);
app.use('/api/tickets', requireAuth, ticketsRouter);
app.use('/api/open', requireAuth, openRouter);
app.use('/api/workspace', requireAuth, workspaceRouter);

app.use(notFoundHandler);
app.use(errorHandler);

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'));
if (isMain || process.env.ENVINITY_START === '1') {
  const server = app.listen(env.apiPort, env.apiHost, () => {
    logger.info(`envinity api listening on http://${env.apiHost}:${env.apiPort}`);
  });
  if (env.workersEnabled) startWorkers();

  const shutdown = (signal: string) => {
    logger.info(`received ${signal}, shutting down`);
    stopWorkers();
    server.close(() => {
      closePool()
        .catch(() => {})
        .finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}
