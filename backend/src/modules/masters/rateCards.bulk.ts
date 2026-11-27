import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { conflict } from '../../lib/errors';
import { toNumber } from '../../lib/validate';
import { audit } from '../../lib/audit';
import { type BulkSpec, type Checked, byName, fieldsOf } from '../../lib/bulk';
import { TRUCK_TYPES } from '../../shared/masters';
import { assertListed, readCard } from './rateCards.routes';

interface RateData {
  carrierId: string;
  carrierName: string;
  origin: string;
  destination: string;
  truckType: string;
  rate: number;
  detentionPerDay: number | null;
  transitDays: number | null;
  validFrom: Date | null;
  validTo: Date | null;
  cardExists: boolean;
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const rupees = (n: number) => `₹${n.toLocaleString('en-IN')}`;

/** YYYY-MM-DD stays; DD-MM-YYYY and DD/MM/YYYY become YYYY-MM-DD. Anything else is left for the card check to refuse. */
function isoDate(s: string) {
  const m = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(s.trim());
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : s.trim();
}

/** "17FT" -> "17ft": the sheet is not case-sensitive about truck types. */
const canonTruck = (s: string) => TRUCK_TYPES.find((t) => t.toLowerCase() === norm(s)) ?? s.trim();

const money = (n: number | null) => (n == null ? 'none' : rupees(n));

/** Bulk upload for Master data > Rate cards: one row is one rate line of a carrier's card. */
export const rateCardsBulk: BulkSpec<RateData> = {
  kind: 'rate-cards',
  title: 'Rate cards',
  noun: 'rate',
  roles: ['LOGISTICS_HEAD'],
  columns: [
    { key: 'carrier', header: 'Carrier', required: true, example: 'NorthStar Logistics', help: 'A carrier in your carrier list (see the Lists sheet).' },
    { key: 'origin', header: 'Pickup city', required: true, example: 'Chennai', help: 'City trucks load in.' },
    { key: 'destination', header: 'Drop city', required: true, example: 'Bengaluru', help: 'City trucks unload in. Must differ from the pickup city.' },
    { key: 'truckType', header: 'Truck type', required: true, example: '17ft', help: 'Choose from the list.', options: TRUCK_TYPES },
    { key: 'rate', header: 'Freight per trip (₹)', required: true, example: '46000', help: 'Agreed freight for one trip, in rupees.' },
    { key: 'detentionPerDay', header: 'Detention per day (₹)', example: '1500', help: 'Charged per day the truck waits beyond free time, if agreed. Blank leaves any saved value as it is.' },
    { key: 'transitDays', header: 'Transit days', example: '2', help: 'Days in transit, 1 to 15. Blank leaves any saved value as it is.' },
    { key: 'validFrom', header: 'Valid from', example: '2026-04-01', help: 'Card start date (YYYY-MM-DD, DD-MM-YYYY or DD/MM/YYYY). All rows of one carrier must agree.' },
    { key: 'validTo', header: 'Valid till', example: '2027-03-31', help: 'Card end date, same formats. All rows of one carrier must agree.' },
  ],

  async lists(ctx) {
    const links = await prisma.shipperCarrier.findMany({ where: { shipperId: ctx.user.companyId, isActive: true }, include: { carrier: { select: { name: true } } } });
    return { Carriers: links.map((l) => l.carrier.name).sort((a, b) => a.localeCompare(b)) };
  },

  async check(rows, ctx) {
    const shipperId = ctx.user.companyId;
    const [links, cards] = await Promise.all([
      prisma.shipperCarrier.findMany({ where: { shipperId }, include: { carrier: { select: { name: true } } } }),
      prisma.rateCard.findMany({ where: { shipperId }, include: { lines: true } }),
    ]);
    const carrierOf = byName(links.map((l) => ({ name: l.carrier.name, id: l.carrierId })));
    const cardOf = new Map(cards.map((c) => [c.carrierId, c]));

    // 1. Each row on its own, with the same per-line and date checks as the rate card form.
    const items = await Promise.all(rows.map(async (r) => {
      const errors: Record<string, string> = {};
      const carrier = r.carrier.trim() ? carrierOf(r.carrier) : undefined;
      if (!r.carrier.trim()) errors.carrier = 'Enter the carrier.';
      else if (!carrier) errors.carrier = `${r.carrier.trim()} is not in your carrier list. Add it under Carriers first.`;
      const card = await fieldsOf(() =>
        readCard({
          validFrom: isoDate(r.validFrom), validTo: isoDate(r.validTo),
          lines: [{ origin: r.origin, destination: r.destination, truckType: canonTruck(r.truckType), rate: r.rate, detentionPerDay: r.detentionPerDay, transitDays: r.transitDays }],
        }),
      );
      for (const [k, m] of Object.entries(card.errors)) errors[k.replace(/^lines\.\d+\./, '')] = m;
      return { errors, carrier, line: card.value?.lines[0], validFrom: card.value?.validFrom ?? null, validTo: card.value?.validTo ?? null };
    }));

    // 2. All rows of one carrier must agree on the card dates.
    const agreed = new Map<string, { validFrom?: string; validTo?: string }>();
    for (const it of items) {
      if (!it.carrier || Object.keys(it.errors).length) continue;
      const a = agreed.get(it.carrier.id) ?? {};
      for (const f of ['validFrom', 'validTo'] as const) {
        const d = day(it[f]);
        if (!d) continue;
        if (a[f] === undefined) a[f] = d;
        else if (a[f] !== d) it.errors[f] = `Another row for ${it.carrier.name} has a different ${f === 'validFrom' ? 'start' : 'end'} date. All rows of one carrier must agree.`;
      }
      agreed.set(it.carrier.id, a);
    }

    // 3. Status against what is saved.
    return items.map((it): Checked<RateData> => {
      if (Object.keys(it.errors).length || !it.carrier || !it.line) return { status: 'INVALID', errors: it.errors };
      const { carrier, line } = it;
      const card = cardOf.get(carrier.id);
      const key = [carrier.id, norm(line.origin), norm(line.destination), line.truckType].join('|');

      const from = it.validFrom ?? card?.validFrom ?? null;
      const to = it.validTo ?? card?.validTo ?? null;
      if ((it.validFrom || it.validTo) && from && to && day(to)! < day(from)!) {
        return { status: 'INVALID', errors: { validTo: 'The end date must be on or after the start date (including the dates already on the card).' } };
      }

      const data: RateData = { carrierId: carrier.id, carrierName: carrier.name, ...line, validFrom: it.validFrom, validTo: it.validTo, cardExists: !!card };
      const saved = card?.lines.find((l) => norm(l.origin) === norm(line.origin) && norm(l.destination) === norm(line.destination) && l.truckType === line.truckType);
      if (!saved) return { status: 'NEW', errors: {}, key, data, note: card ? undefined : `Creates a rate card for ${carrier.name}` };

      // Blank optional cells leave the saved value alone, so a re-upload of the same file is a duplicate.
      const changes: string[] = [];
      const oldRate = toNumber(saved.rate)!;
      if (oldRate !== line.rate) changes.push(`Freight ${rupees(oldRate)} → ${rupees(line.rate)}`);
      const oldDet = toNumber(saved.detentionPerDay);
      if (line.detentionPerDay != null && line.detentionPerDay !== oldDet) changes.push(`Detention ${money(oldDet)} → ${rupees(line.detentionPerDay)}`);
      if (line.transitDays != null && line.transitDays !== saved.transitDays) changes.push(`Transit ${saved.transitDays ?? 'none'} → ${line.transitDays} days`);
      if (it.validFrom && day(it.validFrom) !== day(card!.validFrom)) changes.push(`Card starts ${day(it.validFrom)}`);
      if (it.validTo && day(it.validTo) !== day(card!.validTo)) changes.push(`Card ends ${day(it.validTo)}`);
      if (!changes.length) return { status: 'DUPLICATE', errors: {}, key, note: 'This rate is already saved' };
      return { status: 'UPDATE', errors: {}, key, data, note: changes.join('; ') };
    });
  },

  async apply(row, ctx) {
    const d = row.data!;
    const shipperId = ctx.user.companyId;
    const link = await assertListed(shipperId, d.carrierId);
    const where = { shipperId_carrierId: { shipperId, carrierId: d.carrierId } };
    try {
      const { lineId, created } = await prisma.$transaction(async (tx) => {
        const had = !!(await tx.rateCard.findUnique({ where }));
        // Dates are only set when the row gives them; other rates on the card are never touched.
        const card = await tx.rateCard.upsert({
          where,
          create: { shipperId, carrierId: d.carrierId, validFrom: d.validFrom, validTo: d.validTo },
          update: { ...(d.validFrom ? { validFrom: d.validFrom } : {}), ...(d.validTo ? { validTo: d.validTo } : {}) },
        });
        const values = {
          rate: new Prisma.Decimal(d.rate),
          ...(d.detentionPerDay != null ? { detentionPerDay: new Prisma.Decimal(d.detentionPerDay) } : {}),
          ...(d.transitDays != null ? { transitDays: d.transitDays } : {}),
        };
        const existing = await tx.rateCardLine.findFirst({
          where: { rateCardId: card.id, origin: { equals: d.origin, mode: 'insensitive' }, destination: { equals: d.destination, mode: 'insensitive' }, truckType: d.truckType },
        });
        const line = existing
          ? await tx.rateCardLine.update({ where: { id: existing.id }, data: values })
          : await tx.rateCardLine.create({ data: { rateCardId: card.id, origin: d.origin, destination: d.destination, truckType: d.truckType, ...values } });
        return { lineId: line.id, created: !had };
      });
      await audit(ctx.user.id, created ? 'RATE_CARD_CREATED' : 'RATE_CARD_UPDATED', { carrierId: d.carrierId, carrier: link.carrier.name, rates: 1, bulk: true });
      return { ref: lineId };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw conflict('This rate was added by someone else a moment ago. Upload the file again.', { carrier: 'This rate was added by someone else a moment ago. Upload the file again.' });
      }
      throw err;
    }
  },
};
