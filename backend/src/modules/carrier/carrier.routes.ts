import { Router } from 'express';
import { prisma } from '../../lib/prisma';
import { asyncHandler } from '../../lib/errors';
import { fleetRouter } from './fleet.routes';
import { setupRouter } from './setup.routes';
import { loadsRouter } from './loads.routes';

/**
 * Carrier desk API (`/api/carrier`). Mounted behind requireAuth + requireCarrier, and every query is
 * scoped to the signed-in user's carrier company. The carrier never sees other carriers' quotes, the
 * shipper's budget or other carriers' scores (carrier spec §3.2).
 */
export const carrierRouter = Router();

carrierRouter.get(
  '/me',
  asyncHandler(async (req, res) => {
    const u = req.user!;
    const company = await prisma.company.findUniqueOrThrow({ where: { id: u.companyId }, select: { id: true, name: true, phone: true, status: true } });
    res.json({ user: u, company });
  }),
);


// Phase 2: trucks and drivers; rate cards, company profile, policies, users.
carrierRouter.use(fleetRouter);
carrierRouter.use(setupRouter);
// Phase 3: loads, quotes, quote approvals and Home.
carrierRouter.use(loadsRouter);
