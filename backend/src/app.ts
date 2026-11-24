import express from 'express';
import cors from 'cors';
import { errorHandler, notFoundHandler } from './lib/errors';
import { authRouter } from './modules/auth/auth.routes';

/** Builds the Express app (kept separate from server.ts so tests can import it). */
export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (_req, res) => res.json({ status: 'ok' }));
  app.use('/api/auth', authRouter);

  app.use('/api', notFoundHandler);
  app.use(errorHandler);
  return app;
}
