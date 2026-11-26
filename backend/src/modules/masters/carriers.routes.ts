import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { asyncHandler, badRequest, conflict, notFound } from '../../lib/errors';
import { Validator } from '../../lib/validate';
import { audit } from '../../lib/audit';
import { requireRole } from '../../middleware/auth';

/**
 * Carrier master. Carriers are their own companies (carrier module), shared across shippers; each
 * shipper keeps its own record of the carriers it works with (ShipperCarrier): contact person,
 * GSTIN, notes and whether it is in use. A carrier not yet on DigitRell is recorded as INVITED
 * until it joins.
 */
export const carriersRouter = Router();

const include = {
  carrier: {
    select: {
      id: true, name: true, phone: true, status: true,
      carrierOn: { select: { lane: { select: { shipperId: true, isActive: true } } } },
      rateCardsGiven: { select: { shipperId: true, validTo: true, _count: { select: { lines: true } } } },
      listedBy: { select: { shipperId: true } },
    },
  },
} satisfies Prisma.ShipperCarrierInclude;
type Row = Prisma.ShipperCarrierGetPayload<{ include: typeof include }>;

const GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const PAN = /^[A-Z]{5}\d{4}[A-Z]$/;

function view(r: Row) {
  const c = r.carrier;
  const card = c.rateCardsGiven.find((rc) => rc.shipperId === r.shipperId);
  return {
    id: c.id,
    name: c.name,
    phone: c.phone,
    status: c.status,
    contactName: r.contactName,
    contactPhone: r.contactPhone,
    email: r.email,
    city: r.city,
    address: r.address,
    gstin: r.gstin,
    pan: r.pan,
    notes: r.notes,
    isActive: r.isActive,
    approvedLanes: c.carrierOn.filter((lc) => lc.lane.shipperId === r.shipperId && lc.lane.isActive).length,
    rateCard: card ? { rates: card._count.lines, validTo: card.validTo ? card.validTo.toISOString().slice(0, 10) : null } : null,
    // The name and owner's mobile belong to the carrier company. A shipper may correct them only
    // while the carrier hasn't joined and no other shipper lists it.
    canEditIdentity: c.status === 'INVITED' && c.listedBy.every((l) => l.shipperId === r.shipperId),
  };
}

/** Reads the shipper's own details for a carrier; every field optional. */
function readDetails(v: Validator, body: Record<string, unknown>, partial: boolean) {
  const out: Record<string, string | null | boolean> = {};
  const take = (key: string, value: () => string | null) => {
    if (!partial || v.has(key)) out[key] = value();
  };
  take('contactName', () => v.text('contactName', 'the contact person', { max: 80 }));
  take('contactPhone', () => v.phone('contactPhone', "the contact person's mobile"));
  take('email', () => v.email('email', 'the email'));
  take('city', () => v.text('city', 'the city', { max: 60 }));
  take('address', () => v.text('address', 'the address', { max: 200 }));
  take('gstin', () => {
    const s = v.text('gstin', 'the GSTIN', { max: 15 })?.toUpperCase().replace(/\s/g, '') ?? null;
    if (s && !GSTIN.test(s)) v.fail('gstin', 'Enter a 15-character GSTIN, e.g. 33AABCK1234F1Z5.');
    return s;
  });
  take('pan', () => {
    const s = v.text('pan', 'the PAN', { max: 10 })?.toUpperCase().replace(/\s/g, '') ?? null;
    if (s && !PAN.test(s)) v.fail('pan', 'Enter a 10-character PAN, e.g. AABCK1234F.');
    return s;
  });
  take('notes', () => v.text('notes', 'notes', { max: 300 }));
  if (v.has('isActive')) out.isActive = Boolean(body.isActive);
  return out;
}

async function findRow(shipperId: string, carrierId: string) {
  const row = await prisma.shipperCarrier.findUnique({ where: { shipperId_carrierId: { shipperId, carrierId } }, include });
  if (!row) throw notFound('That carrier is not in your carrier list.');
  return row;
}

carriersRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const rows = await prisma.shipperCarrier.findMany({ where: { shipperId: req.user!.companyId }, include, orderBy: { carrier: { name: 'asc' } } });
    res.json({ carriers: rows.map(view).sort((a, b) => Number(b.isActive) - Number(a.isActive)) });
  }),
);

carriersRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    res.json({ carrier: view(await findRow(req.user!.companyId, req.params.id)) });
  }),
);

/**
 * Adds a carrier to the shipper's carrier master. A carrier already on DigitRell (same name or
 * owner's mobile) is added to the list as is, rather than duplicated.
 */
carriersRouter.post(
  '/',
  requireRole('LOGISTICS_HEAD'),
  asyncHandler(async (req, res) => {
    const shipperId = req.user!.companyId;
    const v = new Validator(req.body);
    const name = v.text('name', 'the carrier company name', { required: true, max: 80 });
    const phone = v.phone('phone', "the owner's mobile", { required: true });
    const details = readDetails(v, req.body, false);
    v.done();

    const existing = await prisma.company.findFirst({
      where: { type: 'CARRIER', OR: [{ name: { equals: name!, mode: 'insensitive' } }, { phone: phone! }] },
      include: { listedBy: { where: { shipperId } } },
    });
    if (existing?.listedBy.length) {
      const byName = existing.name.toLowerCase() === name!.toLowerCase();
      throw conflict(`${existing.name} is already in your carrier list.`, byName ? { name: 'This carrier is already in your list. Edit it there.' } : { phone: `This number belongs to ${existing.name}, already in your list.` });
    }
    if (existing && existing.name.toLowerCase() !== name!.toLowerCase() && existing.phone === phone) {
      // Same mobile, different name: don't guess which is right.
      throw conflict(`This number belongs to ${existing.name}.`, { phone: `This number belongs to ${existing.name}. Use that name to add them.` });
    }

    const carrierId = await prisma.$transaction(async (tx) => {
      const c = existing ?? (await tx.company.create({ data: { name: name!, phone, type: 'CARRIER', status: 'INVITED' } }));
      await tx.shipperCarrier.create({ data: { shipperId, carrierId: c.id, ...details } });
      return c.id;
    });
    await audit(req.user!.id, existing ? 'CARRIER_LISTED' : 'CARRIER_INVITED', { id: carrierId, name: existing?.name ?? name, byShipper: shipperId });
    res.status(201).json({ carrier: view(await findRow(shipperId, carrierId)), alreadyOnDigitRell: !!existing });
  }),
);

carriersRouter.patch(
  '/:id',
  requireRole('LOGISTICS_HEAD'),
  asyncHandler(async (req, res) => {
    const shipperId = req.user!.companyId;
    const current = await findRow(shipperId, req.params.id);
    const v = new Validator(req.body);
    const details = readDetails(v, req.body, true);
    const identity: { name?: string; phone?: string } = {};
    const canEditIdentity = view(current).canEditIdentity;
    if (v.has('name') && req.body.name !== current.carrier.name) {
      if (!canEditIdentity) v.fail('name', 'The name is set by the carrier on DigitRell and cannot be changed here.');
      else identity.name = v.text('name', 'the carrier company name', { required: true, max: 80 }) ?? undefined;
    }
    if (v.has('phone')) {
      const p = v.phone('phone', "the owner's mobile", { required: true });
      if (p && p !== current.carrier.phone) {
        if (!canEditIdentity) v.fail('phone', "The owner's mobile is set by the carrier on DigitRell and cannot be changed here.");
        else identity.phone = p;
      }
    }
    if (details.isActive === false && current.isActive) {
      const lanes = view(current).approvedLanes;
      if (lanes) v.fail('isActive', `Remove ${current.carrier.name} from its ${lanes} active lane${lanes > 1 ? 's' : ''} first, so no new quote requests go to it.`);
    }
    v.done();
    if (identity.name || identity.phone) {
      const dup = await prisma.company.findFirst({
        where: { type: 'CARRIER', id: { not: current.carrierId }, OR: [...(identity.name ? [{ name: { equals: identity.name, mode: 'insensitive' as const } }] : []), ...(identity.phone ? [{ phone: identity.phone }] : [])] },
      });
      if (dup) throw badRequest('Please fix the highlighted fields.', identity.name && dup.name.toLowerCase() === identity.name.toLowerCase() ? { name: `${dup.name} is already on DigitRell.` } : { phone: `This number belongs to ${dup.name}.` });
    }

    await prisma.$transaction(async (tx) => {
      if (identity.name || identity.phone) await tx.company.update({ where: { id: current.carrierId }, data: identity });
      await tx.shipperCarrier.update({ where: { shipperId_carrierId: { shipperId, carrierId: current.carrierId } }, data: details });
    });
    await audit(req.user!.id, 'CARRIER_UPDATED', { id: current.carrierId, changes: [...Object.keys(details), ...Object.keys(identity)] });
    res.json({ carrier: view(await findRow(shipperId, current.carrierId)) });
  }),
);
