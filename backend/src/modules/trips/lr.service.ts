import { prisma } from '../../lib/prisma';
import { audit } from '../../lib/audit';
import { HttpError } from '../../lib/errors';
import { loadTrip } from './tender.service';

/**
 * The carrier issues the LR (lorry receipt) once it has assigned a truck and driver.
 * TRUCK_CONFIRMED → READY_FOR_PICKUP. The number comes from the carrier's own LrSeries
 * (`LrSeries.carrierId` = the carrier company id) and is never reused.
 */

export interface LrActor { id: string; name: string }
const wrongState = (m: string) => new HttpError(409, 'WRONG_STATE', m);

/** The LR can be voided and reissued only before the trip is on the road. */
export const LR_EDITABLE = ['TRUCK_CONFIRMED', 'CLEARED', 'READY_FOR_PICKUP'] as const;

const activeOf = <T extends { kind: string; isVoid: boolean }>(docs: T[], kind: string) => docs.find((d) => d.kind === kind && !d.isVoid);

/** Normalises an optional e-way bill number; returns an error message when it is not 12 digits. */
export function readEwayBill(raw: unknown): { value: string | null; error?: string } {
  const n = typeof raw === 'string' ? raw.replace(/\s+/g, '') : '';
  if (!n) return { value: null };
  return /^\d{12}$/.test(n) ? { value: n } : { value: null, error: 'An e-way bill number has 12 digits.' };
}

const lrNumberOf = (prefix: string, n: number) => `${prefix}-${String(n).padStart(6, '0')}`;

/** Next LR number: prefix and counter move together in one transaction; numbers are never reused. */
async function nextLrNumber(tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0], companyId: string) {
  const s = await tx.lrSeries.findUnique({ where: { carrierId: companyId } });
  if (!s) throw new HttpError(409, 'NO_LR_SERIES', 'Set your LR series first in Company profile › LR series.');
  const row = await tx.lrSeries.update({ where: { carrierId: companyId }, data: { nextNumber: { increment: 1 } } });
  return lrNumberOf(row.prefix, row.nextNumber - 1);
}

/** Issue the LR (and the e-way bill record when its number is given) and make the trip ready for pickup. */
export async function issueLr(
  tripId: string, carrierCompanyId: string, by: LrActor | string, o: { ewayBill?: string | null; replaces?: { id: string; reason: string }; number?: string } = {},
) {
  const actor: LrActor = typeof by === 'string' ? { id: by, name: (await prisma.user.findUnique({ where: { id: by }, select: { name: true } }))?.name ?? 'A carrier user' } : by;
  const trip = await loadTrip(tripId);
  if (trip.carrierId !== carrierCompanyId) throw new HttpError(404, 'NOT_FOUND', 'Load not found.');
  const { replaces } = o;
  if (replaces ? !(LR_EDITABLE as readonly string[]).includes(trip.status) : trip.status !== 'TRUCK_CONFIRMED') {
    throw wrongState(replaces ? 'The LR can be voided and reissued only before the trip is on the road.' : 'The LR can be issued once a truck and driver are assigned.');
  }
  if (!replaces && activeOf(trip.documents, 'LR')) throw wrongState('An LR is already issued for this load.');
  const eway = o.ewayBill ?? null;
  const lrNumber = await prisma.$transaction(async (tx) => {
    const number = o.number ?? (await nextLrNumber(tx, carrierCompanyId));
    const created = await tx.document.create({ data: { tripId: trip.id, kind: 'LR', number, issuedById: actor.id } });
    if (replaces) {
      await tx.document.update({ where: { id: replaces.id }, data: { isVoid: true, voidReason: replaces.reason, voidedById: actor.id, voidedAt: new Date(), replacedById: created.id } });
    }
    const oldEway = activeOf(trip.documents, 'EWAY_BILL');
    if (eway && oldEway?.number !== eway) {
      if (oldEway) await tx.document.update({ where: { id: oldEway.id }, data: { isVoid: true, voidedById: actor.id, voidedAt: new Date() } });
      await tx.document.create({ data: { tripId: trip.id, kind: 'EWAY_BILL', number: eway, issuedById: actor.id } });
    }
    await tx.trip.update({ where: { id: trip.id }, data: { status: 'READY_FOR_PICKUP', lastUpdateAt: new Date() } });
    return number;
  });
  const ewayShown = eway ?? activeOf(trip.documents, 'EWAY_BILL')?.number ?? 'to follow';
  await audit(actor.id, 'DOCUMENTS_ISSUED', { lr: lrNumber, ewayBill: ewayShown, by: actor.name }, { tripId: trip.id });
  if (replaces) {
    await audit(actor.id, 'LR_VOIDED', { voided: trip.documents.find((x) => x.id === replaces.id)?.number, replacedBy: lrNumber, by: actor.name }, { tripId: trip.id, reason: replaces.reason });
  }
  return lrNumber;
}

/** Void the current LR and issue a new number. Only before the trip is in transit; the reason is required. */
export async function reissueLr(tripId: string, carrierCompanyId: string, by: LrActor | string, o: { reason: string; ewayBill?: string | null }) {
  const trip = await loadTrip(tripId);
  if (trip.carrierId !== carrierCompanyId) throw new HttpError(404, 'NOT_FOUND', 'Load not found.');
  const cur = activeOf(trip.documents, 'LR');
  if (!cur) throw wrongState('There is no LR to void.');
  return issueLr(tripId, carrierCompanyId, by, { ewayBill: o.ewayBill, replaces: { id: cur.id, reason: o.reason } });
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Printable lorry receipt (HTML). Shows the current LR, or a VOID watermark when the number was voided. Callers check access first. */
export async function lrHtml(tripId: string) {
  const trip = await loadTrip(tripId);
  const lr = activeOf(trip.documents, 'LR') ?? [...trip.documents].reverse().find((x) => x.kind === 'LR');
  if (!lr) throw new HttpError(404, 'NOT_FOUND', 'No LR has been issued for this load yet.');
  const eway = activeOf(trip.documents, 'EWAY_BILL');
  const date = lr.createdAt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
  const addr = (a: { name: string; line1: string; city: string } | null) => (a ? `${esc(a.name)}<br>${esc(a.line1)}, ${esc(a.city)}` : '—');
  const weight = trip.weightKg != null ? `${(Number(trip.weightKg.toString()) / 1000).toLocaleString('en-IN')} t` : '—';
  const cell = (label: string, value: string) => `<div class="c"><div class="l">${label}</div><div class="v">${value}</div></div>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>LR ${esc(lr.number)}</title>
<style>body{font-family:Arial,Helvetica,sans-serif;color:#17202a;margin:24px auto;max-width:760px;padding:0 16px}header{display:flex;justify-content:space-between;border-bottom:2px solid #17202a;padding-bottom:10px;margin-bottom:14px}
h1{font-size:18px;margin:0}.g{display:grid;grid-template-columns:1fr 1fr;gap:10px}.c{border:1px solid #c8ced6;border-radius:6px;padding:8px 10px}.l{font-size:11px;color:#5b6572;text-transform:uppercase}.v{font-size:14px;margin-top:2px}
.void{color:#b42318;font-size:28px;font-weight:700;border:3px solid #b42318;display:inline-block;padding:0 10px;transform:rotate(-6deg);margin-top:6px}.note{color:#b42318}.sign{margin-top:40px;display:flex;justify-content:space-between;font-size:12px;color:#5b6572}
@media print{body{margin:0}}</style></head><body>
<header><div><h1>Lorry receipt</h1><div>${esc(trip.carrier?.name)}</div></div>
<div style="text-align:right"><div style="font-size:20px;font-weight:700">${esc(lr.number)}</div><div>Date ${esc(date)}</div>${lr.isVoid ? '<div class="void">VOID</div>' : ''}</div></header>
<div class="g">
${cell('Consignor (pickup)', addr(trip.pickupAddress))}${cell('Consignee (drop)', addr(trip.dropAddress))}
${cell('Carrier', esc(trip.carrier?.name))}${cell('Trip', esc(trip.number))}
${cell('Truck', esc(trip.truckNumber ?? '—'))}${cell('Driver', `${esc(trip.driverName ?? '—')}${trip.driverPhone ? ' · ' + esc(trip.driverPhone) : ''}`)}
${cell('Material', esc(trip.material ?? '—'))}${cell('Weight', esc(weight))}
${cell('Reference', esc(trip.reference ?? '—'))}${cell('E-way bill', esc(eway?.number ?? 'To follow'))}
</div>
${lr.isVoid ? `<p class="note">Voided: ${esc(lr.voidReason)}</p>` : ''}
<div class="sign"><div>Consignor signature</div><div>Driver signature</div><div>Consignee signature</div></div>
</body></html>`;
}
