import { prisma } from '../../lib/prisma';
import { HttpError } from '../../lib/errors';
import { byName, fieldsOf, type BulkSpec, type Checked } from '../../lib/bulk';
import { TRUCK_TYPES } from '../../shared/masters';
import { createBooking, readBooking, type ReadBooking } from './bookings.routes';

/** Bulk upload of bookings (docs/shipper/BULK_UPLOAD.md, "Bookings"): same checks as the booking form. */

const DATE_HELP = 'Enter the pickup date as YYYY-MM-DD or DD-MM-YYYY.';

/** YYYY-MM-DD, DD-MM-YYYY or DD/MM/YYYY (day first) to YYYY-MM-DD, or null when not a real date. */
export function normaliseDate(s: string): string | null {
  const t = s.trim();
  let y: string, m: string, d: string;
  let x = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (x) [, y, m, d] = x;
  else if ((x = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(t))) [, d, m, y] = x;
  else return null;
  const iso = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  const dt = new Date(`${iso}T00:00:00.000Z`);
  return Number.isNaN(dt.getTime()) || dt.toISOString().slice(0, 10) !== iso ? null : iso;
}

const weightKey = (raw: string) => {
  const n = Number(raw.replace(',', '.'));
  return Number.isFinite(n) ? String(Math.round(n * 1000)) : raw.trim();
};
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

const compositeKey = (pickupId: string, dropId: string, date: string, truck: string, material: string, weightKg: string) =>
  ['c', pickupId, dropId, date, truck, norm(material), weightKg].join('|');
const refKey = (reference: string) => `r|${norm(reference)}`;

// Form field names to spreadsheet column keys (the NO_LANE error's `lane` field shows on the pickup column).
const FIELD_TO_COLUMN: Record<string, string> = { pickupAddressId: 'pickup', dropAddressId: 'drop', lane: 'pickup' };

export const bookingsBulk: BulkSpec<ReadBooking> = {
  kind: 'bookings',
  title: 'Bookings',
  noun: 'booking',
  columns: [
    { key: 'reference', header: 'Your reference', example: 'PO-4471', help: 'Your own reference for this booking. If given, it identifies the booking: the same reference is never booked twice.' },
    { key: 'pickup', header: 'Pickup address', required: true, example: 'Pune Plant', help: 'Short name of a saved pickup address (see the Lists sheet).' },
    { key: 'drop', header: 'Drop address', required: true, example: 'Mumbai Warehouse', help: 'Short name of a saved drop address (see the Lists sheet).' },
    { key: 'pickupDate', header: 'Pickup date', required: true, example: '2026-12-05', help: 'YYYY-MM-DD, DD-MM-YYYY or DD/MM/YYYY. Not in the past, at most 60 days ahead.' },
    { key: 'truckType', header: 'Truck type', required: true, example: TRUCK_TYPES[0], help: 'Choose from the list.', options: TRUCK_TYPES },
    { key: 'material', header: 'Material', required: true, example: 'Auto parts', help: 'What is being moved.' },
    { key: 'weightTonnes', header: 'Weight (tonnes)', required: true, example: '14', help: 'Between 0.1 and 60.' },
    { key: 'budget', header: 'Budget per trip (₹)', example: '45000', help: 'Required on lanes where the lowest quote within budget is awarded automatically.' },
    { key: 'receiverContact', header: 'Receiver contact', example: 'Ravi 9876543210', help: 'Who receives the load.' },
    { key: 'notes', header: 'Notes for carrier', example: 'Call before arrival', help: 'Up to 200 characters.' },
    { key: 'quoteWindowHours', header: 'Quote window (hours)', example: '4', help: 'How long carriers have to quote, 1 to 48. Leave empty for your default.' },
  ],

  async lists(ctx) {
    const addresses = await prisma.address.findMany({ where: { companyId: ctx.user.companyId, isActive: true }, orderBy: { name: 'asc' }, select: { name: true, kind: true } });
    return {
      'Pickup addresses': addresses.filter((a) => a.kind !== 'DROP').map((a) => a.name),
      'Drop addresses': addresses.filter((a) => a.kind !== 'PICKUP').map((a) => a.name),
    };
  },

  async check(rows, ctx) {
    const companyId = ctx.user.companyId;
    const addresses = await prisma.address.findMany({ where: { companyId, isActive: true } });
    const find = byName(addresses);

    // Resolve each row's lookups first, so existing trips can be loaded once.
    const parsed = rows.map((r) => ({
      pickup: r.pickup ? find(r.pickup) : undefined,
      drop: r.drop ? find(r.drop) : undefined,
      date: r.pickupDate ? normaliseDate(r.pickupDate) : null,
    }));
    const refs = [...new Set(rows.map((r) => r.reference.trim()).filter(Boolean))];
    const dates = [...new Set(parsed.map((p) => p.date).filter((d): d is string => !!d))];
    const existing = refs.length || dates.length
      ? await prisma.trip.findMany({
          where: {
            shipperId: companyId, status: { not: 'CANCELLED' },
            OR: [
              ...(refs.length ? [{ reference: { in: refs, mode: 'insensitive' as const } }] : []),
              ...(dates.length ? [{ pickupDate: { in: dates.map((d) => new Date(`${d}T00:00:00.000Z`)) } }] : []),
            ],
          },
          select: { number: true, reference: true, pickupAddressId: true, dropAddressId: true, pickupDate: true, truckType: true, material: true, weightKg: true },
        })
      : [];
    const booked = new Map<string, string>();
    for (const t of existing) {
      if (t.reference) booked.set(refKey(t.reference), t.number);
      if (t.pickupAddressId && t.dropAddressId && t.pickupDate && t.truckType && t.material && t.weightKg != null) {
        booked.set(compositeKey(t.pickupAddressId, t.dropAddressId, t.pickupDate.toISOString().slice(0, 10), t.truckType, t.material, String(Math.round(Number(t.weightKg)))), t.number);
      }
    }

    const out: Checked<ReadBooking>[] = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const { pickup, drop, date } = parsed[i];
      const errors: Record<string, string> = {};
      const unknown = (name: string) => `No saved address called "${name}". Check the Lists sheet or add it under Master data → Addresses.`;
      if (r.pickup && !pickup) errors.pickup = unknown(r.pickup);
      if (r.drop && !drop) errors.drop = unknown(r.drop);
      if (r.pickupDate && !date) errors.pickupDate = DATE_HELP;

      // Duplicate rule from the doc: your reference if given, else the full booking details.
      const key = r.reference
        ? refKey(r.reference)
        : pickup && drop && date && r.truckType && r.material && r.weightTonnes
          ? compositeKey(pickup.id, drop.id, date, r.truckType, r.material, weightKey(r.weightTonnes))
          : undefined;
      const already = key ? booked.get(key) : undefined;
      if (already && !Object.keys(errors).length) {
        out.push({ status: 'DUPLICATE', errors: {}, key, note: `Already booked as ${already}` });
        continue;
      }

      const body = {
        reference: r.reference, pickupAddressId: pickup?.id ?? '', dropAddressId: drop?.id ?? '', pickupDate: date ?? r.pickupDate,
        truckType: r.truckType, material: r.material, weightTonnes: r.weightTonnes, budget: r.budget,
        receiverContact: r.receiverContact, notes: r.notes, quoteWindowHours: r.quoteWindowHours,
      };
      const res = await fieldsOf(() => readBooking(body, companyId));
      for (const [field, message] of Object.entries(res.errors)) {
        const col = FIELD_TO_COLUMN[field] ?? field;
        if (!errors[col]) errors[col] = message; // our own name/date messages win over the generic ones
      }
      if (Object.keys(errors).length || !res.value) {
        out.push({ status: 'INVALID', errors, key });
        continue;
      }
      const b = res.value;
      out.push({
        status: 'NEW', errors: {}, key, data: b,
        note: `${b.pickup.city} → ${b.drop.city}: quote request to ${b.lane.carriers.length} carrier${b.lane.carriers.length === 1 ? '' : 's'}`,
      });
    }
    return out;
  },

  async apply(row, ctx) {
    if (!row.data) throw new HttpError(400, 'VALIDATION_FAILED', 'This row could not be saved. Try it again.');
    const trip = await createBooking(row.data, ctx.user);
    return { ref: trip.id };
  },
};
