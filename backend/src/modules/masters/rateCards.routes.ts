import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { asyncHandler, notFound } from '../../lib/errors';
import { Validator, toNumber } from '../../lib/validate';
import { audit } from '../../lib/audit';
import { requireRole } from '../../middleware/auth';
import { TRUCK_TYPES } from '../../shared/masters';

/**
 * Rate cards: the freight a carrier has agreed with this shipper, one line per city pair and truck
 * type. They are a reference shown at booking and next to quotes; nothing is priced or awarded
 * from them automatically.
 */
export const rateCardsRouter = Router();

const include = {
  carrier: { select: { id: true, name: true, status: true } },
  lines: { orderBy: [{ origin: 'asc' }, { destination: 'asc' }, { truckType: 'asc' }] },
} satisfies Prisma.RateCardInclude;
type Card = Prisma.RateCardGetPayload<{ include: typeof include }>;

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
/** Today in India as YYYY-MM-DD. */
const todayIST = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const cityCase = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());

/** CURRENT, NOT_STARTED or EXPIRED by the card's dates (no dates = always current). */
export function validity(card: { validFrom: Date | null; validTo: Date | null }) {
  const today = todayIST();
  if (card.validFrom && day(card.validFrom)! > today) return 'NOT_STARTED';
  if (card.validTo && day(card.validTo)! < today) return 'EXPIRED';
  return 'CURRENT';
}

const view = (c: Card) => ({
  id: c.id,
  carrier: c.carrier,
  validFrom: day(c.validFrom),
  validTo: day(c.validTo),
  validity: validity(c),
  notes: c.notes,
  updatedAt: c.updatedAt,
  lines: c.lines.map((l) => ({
    id: l.id, origin: l.origin, destination: l.destination, truckType: l.truckType,
    rate: toNumber(l.rate), detentionPerDay: toNumber(l.detentionPerDay), transitDays: l.transitDays,
  })),
});

interface LineIn {
  origin: string;
  destination: string;
  truckType: string;
  rate: number;
  detentionPerDay: number | null;
  transitDays: number | null;
}

/** Validates the card; errors on a line are keyed `lines.<index>.<field>` so the form can place them. */
function readCard(body: Record<string, unknown>) {
  const v = new Validator(body);
  const validFrom = v.text('validFrom', 'the start date');
  const validTo = v.text('validTo', 'the end date');
  const notes = v.text('notes', 'notes', { max: 300 });
  for (const [key, d] of [['validFrom', validFrom], ['validTo', validTo]] as const) {
    if (d && (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(d)))) v.fail(key, 'Choose a valid date.');
  }
  if (validFrom && validTo && validTo < validFrom) v.fail('validTo', 'The end date must be on or after the start date.');

  const raw = Array.isArray(body.lines) ? (body.lines as Record<string, unknown>[]) : [];
  if (!raw.length) v.fail('lines', 'Add at least one rate: a pickup city, drop city, truck type and freight.');
  if (raw.length > 200) v.fail('lines', 'Keep a rate card under 200 rates.');
  const lines: LineIn[] = [];
  const seen = new Map<string, number>();
  raw.slice(0, 200).forEach((line, i) => {
    const lv = new Validator(line ?? {});
    const origin = lv.text('origin', 'the pickup city', { required: true, max: 60 });
    const destination = lv.text('destination', 'the drop city', { required: true, max: 60 });
    const truckType = lv.oneOf('truckType', 'truck type', TRUCK_TYPES);
    const rate = lv.money('rate', 'the freight per trip', { required: true });
    const detentionPerDay = lv.money('detentionPerDay', 'the detention per day');
    const transitDays = line?.transitDays == null || line.transitDays === '' ? null : lv.int('transitDays', 'transit days', 1, 15);
    if (origin && destination && origin.toLowerCase() === destination.toLowerCase()) lv.fail('destination', 'Drop city must differ from pickup city.');
    if (origin && destination && truckType) {
      const key = `${origin.toLowerCase()}|${destination.toLowerCase()}|${truckType}`;
      if (seen.has(key)) lv.fail('destination', `Same lane and truck type as rate ${seen.get(key)! + 1}. Keep one.`);
      else seen.set(key, i);
    }
    for (const [field, msg] of Object.entries(lv.fields)) v.fail(`lines.${i}.${field}`, msg);
    if (!Object.keys(lv.fields).length) {
      lines.push({ origin: cityCase(origin!), destination: cityCase(destination!), truckType: truckType!, rate: rate!, detentionPerDay, transitDays });
    }
  });
  v.done();
  return {
    validFrom: validFrom ? new Date(`${validFrom}T00:00:00.000Z`) : null,
    validTo: validTo ? new Date(`${validTo}T00:00:00.000Z`) : null,
    notes,
    lines,
  };
}

async function assertListed(shipperId: string, carrierId: string) {
  const link = await prisma.shipperCarrier.findUnique({ where: { shipperId_carrierId: { shipperId, carrierId } }, include: { carrier: true } });
  if (!link) throw notFound('That carrier is not in your carrier list. Add it under Carriers first.');
  return link;
}

rateCardsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const carrierId = req.query.carrierId ? String(req.query.carrierId) : undefined;
    const cards = await prisma.rateCard.findMany({ where: { shipperId: req.user!.companyId, ...(carrierId ? { carrierId } : {}) }, include, orderBy: { carrier: { name: 'asc' } } });
    res.json({ rateCards: cards.map(view) });
  }),
);

rateCardsRouter.get(
  '/:carrierId',
  asyncHandler(async (req, res) => {
    await assertListed(req.user!.companyId, req.params.carrierId);
    const card = await prisma.rateCard.findUnique({ where: { shipperId_carrierId: { shipperId: req.user!.companyId, carrierId: req.params.carrierId } }, include });
    res.json({ rateCard: card ? view(card) : null });
  }),
);

/** Creates or replaces a carrier's rate card (header and every line) in one step. */
rateCardsRouter.put(
  '/:carrierId',
  requireRole('LOGISTICS_HEAD'),
  asyncHandler(async (req, res) => {
    const shipperId = req.user!.companyId;
    const link = await assertListed(shipperId, req.params.carrierId);
    const d = readCard(req.body);
    const where = { shipperId_carrierId: { shipperId, carrierId: link.carrierId } };
    const lines = d.lines.map((l) => ({
      origin: l.origin, destination: l.destination, truckType: l.truckType, rate: new Prisma.Decimal(l.rate),
      detentionPerDay: l.detentionPerDay != null ? new Prisma.Decimal(l.detentionPerDay) : null, transitDays: l.transitDays,
    }));
    const existed = !!(await prisma.rateCard.findUnique({ where }));
    const card = await prisma.$transaction(async (tx) => {
      const c = await tx.rateCard.upsert({
        where,
        create: { shipperId, carrierId: link.carrierId, validFrom: d.validFrom, validTo: d.validTo, notes: d.notes },
        update: { validFrom: d.validFrom, validTo: d.validTo, notes: d.notes },
      });
      await tx.rateCardLine.deleteMany({ where: { rateCardId: c.id } });
      await tx.rateCardLine.createMany({ data: lines.map((l) => ({ ...l, rateCardId: c.id })) });
      return tx.rateCard.findUniqueOrThrow({ where: { id: c.id }, include });
    });
    await audit(req.user!.id, existed ? 'RATE_CARD_UPDATED' : 'RATE_CARD_CREATED', { carrierId: link.carrierId, carrier: link.carrier.name, rates: lines.length });
    res.status(existed ? 200 : 201).json({ rateCard: view(card) });
  }),
);

rateCardsRouter.delete(
  '/:carrierId',
  requireRole('LOGISTICS_HEAD'),
  asyncHandler(async (req, res) => {
    const shipperId = req.user!.companyId;
    const link = await assertListed(shipperId, req.params.carrierId);
    const card = await prisma.rateCard.findUnique({ where: { shipperId_carrierId: { shipperId, carrierId: link.carrierId } } });
    if (!card) throw notFound('This carrier has no rate card.');
    await prisma.rateCard.delete({ where: { id: card.id } });
    await audit(req.user!.id, 'RATE_CARD_DELETED', { carrierId: link.carrierId, carrier: link.carrier.name });
    res.status(204).end();
  }),
);

/**
 * Agreed rates for one city pair and truck type, per carrier, from this shipper's current rate
 * cards. Cards that have expired or not started yet are left out.
 */
export async function agreedRates(shipperId: string, origin: string, destination: string, truckType: string, carrierIds: string[]) {
  const lines = await prisma.rateCardLine.findMany({
    where: {
      truckType,
      origin: { equals: origin, mode: 'insensitive' },
      destination: { equals: destination, mode: 'insensitive' },
      rateCard: { shipperId, carrierId: { in: carrierIds } },
    },
    include: { rateCard: true },
  });
  const rates = new Map<string, { rate: number; detentionPerDay: number | null; transitDays: number | null }>();
  for (const l of lines) {
    if (validity(l.rateCard) !== 'CURRENT') continue;
    rates.set(l.rateCard.carrierId, { rate: toNumber(l.rate)!, detentionPerDay: toNumber(l.detentionPerDay), transitDays: l.transitDays });
  }
  return rates;
}
