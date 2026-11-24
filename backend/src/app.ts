import express from 'express';
import cors from 'cors';
import { errorHandler, notFoundHandler } from './lib/errors';
import { requireAuth, requireShipper } from './middleware/auth';
import { authRouter } from './modules/auth/auth.routes';
import { addressesRouter } from './modules/masters/addresses.routes';
import { carriersRouter } from './modules/masters/carriers.routes';
import { lanesRouter } from './modules/masters/lanes.routes';
import { usersRouter } from './modules/users/users.routes';
import { invitesRouter } from './modules/users/invites.routes';
import { policiesRouter } from './modules/policies/policies.routes';

/** Builds the Express app (kept separate from server.ts so tests can import it). */
export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (_req, res) => res.json({ status: 'ok' }));
  app.use('/api/auth', authRouter);
  app.use('/api/invites', invitesRouter);

  // Shipper module: signed-in users of a shipper company only, always scoped to their company.
  const shipper = [requireAuth, requireShipper];
  app.use('/api/addresses', shipper, addressesRouter);
  app.use('/api/carriers', shipper, carriersRouter);
  app.use('/api/lanes', shipper, lanesRouter);
  app.use('/api/users', shipper, usersRouter);
  app.use('/api/policies', shipper, policiesRouter);

  app.use('/api', notFoundHandler);
  app.use(errorHandler);
  return app;
}
