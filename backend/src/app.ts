import express from 'express';
import cors from 'cors';
import { errorHandler, notFoundHandler } from './lib/errors';
import { requireAuth, requireShipper } from './middleware/auth';
import { authRouter } from './modules/auth/auth.routes';
import { addressesRouter } from './modules/masters/addresses.routes';
import { carriersRouter } from './modules/masters/carriers.routes';
import { lanesRouter } from './modules/masters/lanes.routes';
import { rateCardsRouter } from './modules/masters/rateCards.routes';
import { usersRouter } from './modules/users/users.routes';
import { invitesRouter } from './modules/users/invites.routes';
import { policiesRouter } from './modules/policies/policies.routes';
import { bookingsRouter } from './modules/trips/bookings.routes';
import { tripsRouter } from './modules/trips/trips.routes';
import { approvalsRouter } from './modules/approvals/approvals.routes';
import { integrationRouter } from './modules/integration/integration.routes';
import { insightsRouter } from './modules/insights/insights.routes';
import { activityRouter } from './modules/activity/activity.routes';
import { profileRouter } from './modules/users/profile.routes';

/** Builds the Express app (kept separate from server.ts so tests can import it). */
export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  // CORS_ORIGIN = comma-separated web app origins (required in production); any origin in development.
  const origins = (process.env.CORS_ORIGIN ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  app.use(cors(origins.length ? { origin: origins } : undefined));
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (_req, res) => res.json({ status: 'ok' }));
  app.use('/api/auth', authRouter);
  app.use('/api/invites', invitesRouter);

  // Shipper module: signed-in users of a shipper company only, always scoped to their company.
  const shipper = [requireAuth, requireShipper];
  app.use('/api/addresses', shipper, addressesRouter);
  app.use('/api/carriers', shipper, carriersRouter);
  app.use('/api/lanes', shipper, lanesRouter);
  app.use('/api/rate-cards', shipper, rateCardsRouter);
  app.use('/api/users', shipper, usersRouter);
  app.use('/api/policies', shipper, policiesRouter);
  app.use('/api/bookings', shipper, bookingsRouter);
  app.use('/api/trips', shipper, tripsRouter);
  app.use('/api/approvals', shipper, approvalsRouter);
  app.use('/api/insights', shipper, insightsRouter);
  app.use('/api/activity', shipper, activityRouter);
  app.use('/api/profile', shipper, profileRouter);

  // Stand-ins for modules not built yet (carrier quotes) and test tools. Key-protected.
  app.use('/api/integration', integrationRouter);

  app.use('/api', notFoundHandler);
  app.use(errorHandler);
  return app;
}
