import { Router } from 'express';
import { prisma } from '../../lib/prisma';
import { asyncHandler, conflict } from '../../lib/errors';
import { Validator } from '../../lib/validate';
import { audit } from '../../lib/audit';
import { requireRole } from '../../middleware/auth';

/**
 * Carrier directory for the shipper. Carriers are their own companies (carrier module); the
 * shipper only lists them and can add one by name and phone, which records it as INVITED until
 * the carrier joins. That is the minimal integration point the shipper workflow needs.
 */
export const carriersRouter = Router();

carriersRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const carriers = await prisma.company.findMany({
      where: { type: 'CARRIER' },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, phone: true, status: true, carrierOn: { where: { lane: { shipperId: req.user!.companyId } }, select: { laneId: true } } },
    });
    res.json({
      carriers: carriers.map((c) => ({ id: c.id, name: c.name, phone: c.phone, status: c.status, approvedLanes: c.carrierOn.length })),
    });
  }),
);

carriersRouter.post(
  '/',
  requireRole('LOGISTICS_HEAD'),
  asyncHandler(async (req, res) => {
    const v = new Validator(req.body);
    const name = v.text('name', 'the carrier company name', { required: true, max: 80 });
    const phone = v.phone('phone', "the owner's mobile", { required: true });
    v.done();
    const dup = await prisma.company.findFirst({
      where: { type: 'CARRIER', OR: [{ name: { equals: name!, mode: 'insensitive' } }, { phone: phone! }] },
    });
    if (dup) {
      const byName = dup.name.toLowerCase() === name!.toLowerCase();
      throw conflict(`${dup.name} is already on DigitRell.`, byName ? { name: 'This carrier is already listed. Pick it from the list.' } : { phone: `This number belongs to ${dup.name}.` });
    }
    const c = await prisma.company.create({ data: { name: name!, phone, type: 'CARRIER', status: 'INVITED' } });
    await audit(req.user!.id, 'CARRIER_INVITED', { id: c.id, name: c.name, byShipper: req.user!.companyId });
    res.status(201).json({ carrier: { id: c.id, name: c.name, phone: c.phone, status: c.status, approvedLanes: 0 } });
  }),
);
