/**
 * Demo loads for clicking through the app (development only). Run after the normal seed:
 *
 *   npm run seed        # users, masters, fleet, rate cards
 *   npm run seed:demo   # these trips
 *
 * It books trips as Sunrise Foods and moves them through the REAL services (contract-rate offer, accept, approval, carrier truck assignment and LR,
 * tracking, delivery, POD, invoice and payment: the carrier steps go through the carrier services), so shipper and carrier screens show the same, consistent data.
 * Kept out of the Playwright seed so tests start from a known, empty trip list.
 * Safe to re-run: it removes the previous demo trips (reference DEMO-…) and builds them again.
 */
import 'dotenv/config';
import { Prisma } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { audit } from '../src/lib/audit';
import { acceptOffer, declineOffer, expireOffers, offerCandidates, offerRows } from '../src/modules/trips/tender.service';
import { acceptPod, approveInvoice, payInvoice, queryInvoice, raiseClaim } from '../src/modules/trips/billing.service';
import { assignTruck } from '../src/modules/carrier/execution.service';
import { issueLr } from '../src/modules/trips/lr.service';
import { cancelTrip } from '../src/modules/trips/exceptions.service';
import { markDelivered, recordEvent, reportProblem, uploadPod } from '../src/modules/carrier/onroad.service';
import { sendInvoice } from '../src/modules/carrier/invoicing.service';

const DEMO = 'DEMO-';
const day = (n: number) => {
  const d = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d;
};
const hours = (n: number) => new Date(Date.now() + n * 3600_000);

async function main() {
  // Re-running rebuilds the demo trips from scratch (only trips whose reference starts with DEMO-).
  const old = (await prisma.trip.findMany({ where: { reference: { startsWith: DEMO } }, select: { id: true } })).map((t) => t.id);
  if (old.length) {
    const tripId = { in: old };
    await prisma.$transaction([
      prisma.auditLog.deleteMany({ where: { tripId } }),
      prisma.approval.deleteMany({ where: { tripId } }),
      prisma.invoice.deleteMany({ where: { tripId } }),
      prisma.claim.deleteMany({ where: { tripId } }),
      prisma.tripException.deleteMany({ where: { tripId } }),
      prisma.document.deleteMany({ where: { tripId } }),
      prisma.quote.deleteMany({ where: { tripId } }),
      prisma.trip.deleteMany({ where: { id: tripId } }),
    ]);
    console.log(`Removed ${old.length} old demo trips.`);
  }
  const company = async (name: string) => prisma.company.findFirstOrThrow({ where: { name } });
  const sunrise = await company('Sunrise Foods Pvt Ltd');
  const kaveri = await company('Kaveri Roadlines');
  const northstar = await company('NorthStar Logistics');
  const deccan = await company('Deccan Freight Carriers');
  const sai = await company('Sai Ganesh Transport');
  const anita = await prisma.user.findUniqueOrThrow({ where: { email: 'anita@sunrisefoods.test' } });
  const divya = await prisma.user.findUniqueOrThrow({ where: { email: 'divya@kaveri.test' } });
  const actor = { id: anita.id, name: anita.name, role: anita.role };
  const addr = async (name: string) => prisma.address.findFirstOrThrow({ where: { companyId: sunrise.id, name } });
  const ambattur = await addr('Ambattur DC');
  const hosur = await addr('Hosur Plant');
  const chakan = await addr('Chakan Warehouse');
  const medchal = await addr('Medchal DC');
  const lane = async (origin: string, destination: string, truckType: string) =>
    prisma.lane.findFirstOrThrow({ where: { shipperId: sunrise.id, origin, destination, truckType }, include: { carriers: true } });
  const chennaiBlr = await lane('Chennai', 'Bengaluru', '32ft MXL');
  const puneHyd = await lane('Pune', 'Hyderabad', '20ft SXL');
  // Contract rates come from the seed's rate cards. Kaveri's Chennai → Bengaluru line is lowered to ₹42,500 so Kaveri is
  // first in line on that lane (Deccan ₹43,800 next, then NorthStar ₹45,200). Bengaluru → Hyderabad has no
  // contract line, so booking it fails with NO_CONTRACT_RATE (not seeded).
  await prisma.rateCardLine.updateMany({
    where: { origin: 'Chennai', destination: 'Bengaluru', truckType: '32ft MXL', rateCard: { shipperId: sunrise.id, carrierId: kaveri.id } },
    data: { rate: new Prisma.Decimal(42500) },
  });
  // Some carriers (Deccan) have no login in the seed; the offer only records who answered, so a placeholder id will do.
  const userOf = async (companyId: string) => (await prisma.user.findFirst({ where: { companyId, isActive: true } })) ?? { id: 'demo-carrier-user' };

  let n = 0;
  async function book(l: typeof chennaiBlr, pickup: typeof ambattur, drop: typeof hosur, o: { date: number; material: string; tonnes: number; closesIn?: number }) {
    // The offer list is built from the shipper's contract lines: cheapest first, only the first is offered.
    const closesIn = o.closesIn ?? 48;
    const candidates = await offerCandidates(sunrise.id, pickup.city, drop.city, l.truckType, day(o.date).toISOString().slice(0, 10));
    if (!candidates.length) throw new Error(`No contract rate for ${pickup.city} → ${drop.city}, ${l.truckType}`);
    const { rows, respondBy } = offerRows(candidates, closesIn);
    n += 1;
    const t = await prisma.trip.create({
      data: {
        shipperId: sunrise.id, laneId: l.id, pickupAddressId: pickup.id, dropAddressId: drop.id, pickupDate: day(o.date), truckType: l.truckType,
        material: o.material, weightKg: new Prisma.Decimal(o.tonnes * 1000), reference: `${DEMO}${String(n).padStart(2, '0')}`,
        receiverContact: '+919400000030', status: 'QUOTES_REQUESTED', quoteDeadline: respondBy, createdById: anita.id,
        quotes: { create: rows },
      },
    });
    await audit(anita.id, 'BOOKED', { lane: `${pickup.city} → ${drop.city}`, channel: 'web' }, { tripId: t.id });
    await audit('tender-agent', 'OFFER_SENT', { carrier: candidates[0].carrierName, amount: candidates[0].rate, sequence: 1, of: candidates.length }, { tripId: t.id });
    return t;
  }
  const kaveriUser = divya;
  /** Kaveri (Divya) accepts the offer; the load is awarded at once. */
  const accept = (tripId: string) => acceptOffer(tripId, kaveri.id, kaveriUser.id);
  const pass = (tripId: string, reason: string) => declineOffer(tripId, kaveri.id, kaveriUser.id, reason);
  /** The offer to this carrier ran out of time (the real expire job moves it on). */
  const lapse = async (tripId: string, carrierId: string) => {
    await prisma.quote.updateMany({ where: { tripId, carrierId, status: 'REQUESTED' }, data: { respondBy: hours(-1) } });
    await expireOffers();
  };
  const award = async (tripId: string, carrierId: string) => {
    if (carrierId === kaveri.id) await accept(tripId);
    else await acceptOffer(tripId, carrierId, (await userOf(carrierId)).id);
    await prisma.trip.update({ where: { id: tripId }, data: { awardedAt: hours(-1) } }); // past the undo window
  };
  const truckOf = async (number: string) => prisma.truck.findUniqueOrThrow({ where: { number } });
  const driverOf = async (name: string) => prisma.driver.findFirstOrThrow({ where: { carrierId: kaveri.id, name } });

  // Extra Kaveri fleet for the assign flow (idempotent; the normal seed has the rest): free 32ft MXL and 20ft SXL trucks, one 32ft MXL with
  // an expired insurance paper (shows the compliance block), and drivers incl. one whose LGV licence does not fit a 32ft truck.
  const fleetDocs = (insuranceDays: number) => ({ rcExpiry: day(1500), insuranceExpiry: day(insuranceDays), permitExpiry: day(300), fitnessExpiry: day(400), pucExpiry: day(120) });
  for (const t of [
    { number: 'TN09YY0042', truckType: '32ft MXL', capacityKg: 18000, make: 'Tata Prima 3530', ...fleetDocs(250) },
    { number: 'MH12QW9902', truckType: '20ft SXL', capacityKg: 9000, make: 'Eicher Pro 3012', ...fleetDocs(250) },
    { number: 'TN09ZZ0007', truckType: '32ft MXL', capacityKg: 18000, make: 'Ashok Leyland 3518', ...fleetDocs(-12) }, // insurance expired: Blocked
  ]) {
    const row = { ...t, carrierId: kaveri.id, ownership: 'OWN', capacityKg: new Prisma.Decimal(t.capacityKg), isActive: true };
    await prisma.truck.upsert({ where: { number: t.number }, update: row, create: row });
  }
  for (const d of [
    { name: 'Anbu S', phone: '+919800000161', licenceNumber: 'TN0920170033333', licenceClass: 'HGV', licenceExpiry: day(700), language: 'ta' },
    { name: 'Karthik R', phone: '+919800000162', licenceNumber: 'TN0920160044444', licenceClass: 'HGV', licenceExpiry: day(900), language: 'ta' },
    { name: 'Dinesh M', phone: '+919800000163', licenceNumber: 'TN0920200055555', licenceClass: 'LGV', licenceExpiry: day(800), language: 'ta' }, // LGV: not for a 20ft or 32ft truck
  ]) {
    const row = { carrierId: kaveri.id, isActive: true, ...d };
    await prisma.driver.upsert({ where: { phone: d.phone }, update: row, create: row });
  }

  // Kaveri's owner (Vijay, also traffic manager) assigns trucks through the real carrier service; the owner also issues the LRs through the carrier LR service.
  const vijay = await prisma.user.findUniqueOrThrow({ where: { email: 'vijay@kaveri.test' } });
  const by = { id: vijay.id, name: vijay.name, roles: ['OWNER', 'TRAFFIC_MANAGER'] };
  const assign = async (tripId: string, truckNo: string, driverName: string, override?: string) => {
    const truck = await truckOf(truckNo);
    const driver = await driverOf(driverName);
    await assignTruck(tripId, kaveri.id, by, { truckId: truck.id, driverId: driver.id, pickupEta: hours(6), override: override ? { reason: override } : null });
  };
  let eway = 0;
  const withLr = async (tripId: string, truckNo: string, driverName: string, ewb = true, override?: string) => {
    await assign(tripId, truckNo, driverName, override);
    eway += 1;
    await issueLr(tripId, kaveri.id, by, { ewayBill: ewb ? `1810${String(44000000 + eway * 7919).slice(0, 8)}` : undefined });
  };
  // Kaveri's staff work through the real carrier services (carrier/onroad.service.ts and invoicing.service.ts): the
  // owner (Vijay) records the driver's steps and sends invoices; Suresh (Accounts) sends one above the invoice limit,
  // which waits for the owner's approval. The shipper's own steps use the shipper's services.
  const suresh = await prisma.user.findUniqueOrThrow({ where: { email: 'suresh@kaveri.test' } });
  const accountsBy = { id: suresh.id, name: suresh.name, roles: ['ACCOUNTS'] };
  const lrOf = async (tripId: string) => (await prisma.document.findFirstOrThrow({ where: { tripId, kind: 'LR', isVoid: false } })).number!;
  const step = (tripId: string, type: 'REACHED_PICKUP' | 'LOADED' | 'LOCATION' | 'REACHED_DROP', location: string | null = null, eta: Date | null = null) =>
    recordEvent(tripId, kaveri.id, by, { type, location, eta });
  const toDrop = async (tripId: string) => {
    await step(tripId, 'REACHED_PICKUP');
    await step(tripId, 'LOADED', null, hours(20));
    await step(tripId, 'REACHED_DROP');
  };
  const release = (tripId: string) => prisma.trip.update({ where: { id: tripId }, data: { truckId: null, driverId: null } });
  const uploadSigned = async (tripId: string, remarks: string | null = null) => uploadPod(tripId, kaveri.id, by, { lrNumber: await lrOf(tripId), photoUrl: null, remarks });
  /** Delivered, POD uploaded (a clean POD is accepted by the shipper's rule). */
  const finish = async (tripId: string, qty: number) => {
    await toDrop(tripId);
    await markDelivered(tripId, kaveri.id, by, { goodQty: qty, damagedQty: 0, remarks: null });
    await uploadSigned(tripId);
    await release(tripId);
  };
  const invoice = (tripId: string, who = by, detention = 0) => sendInvoice(tripId, kaveri.id, who, { detention });

  // Completed trips come first so their trucks and drivers are free again for the in-flight ones below.
  // A. Closed: paid.
  const t11 = await book(chennaiBlr, ambattur, hosur, { date: -10, material: 'Biscuits (packed cartons)', tonnes: 14 });
  await award(t11.id, kaveri.id);
  await withLr(t11.id, 'TN10AZ2210', 'Murugan V');
  await finish(t11.id, 220);
  await invoice(t11.id);
  await approveInvoice(t11.id, sunrise.id, actor);
  await payInvoice(t11.id, sunrise.id, actor, 'UPI', 'UPI432198765012');
  // B. Invoiced and past its due date: the payment reminder is available.
  const t10 = await book(chennaiBlr, ambattur, hosur, { date: -22, material: 'Biscuits (packed cartons)', tonnes: 15 });
  await award(t10.id, kaveri.id);
  await withLr(t10.id, 'KA22TT5120', 'Murugan V');
  await finish(t10.id, 220);
  await invoice(t10.id);
  await prisma.invoice.updateMany({ where: { tripId: t10.id, status: { not: 'REPLACED' } }, data: { dueDate: day(-2) } });
  // B2. Invoice queried by the shipper (detention it did not agree): send a corrected one.
  const t17 = await book(chennaiBlr, ambattur, hosur, { date: -7, material: 'Biscuits (packed cartons)', tonnes: 14 });
  await award(t17.id, kaveri.id);
  await withLr(t17.id, 'TN09BX4471', 'Ramesh K');
  await finish(t17.id, 218);
  await invoice(t17.id, by, 1500);
  await queryInvoice(t17.id, sunrise.id, actor, 'Detention of ₹1,500 was not agreed and no delay is logged. Please resend without it.');
  // C. Delivered, POD accepted: ready to invoice.
  const t9 = await book(puneHyd, chakan, medchal, { date: -4, material: 'Snacks', tonnes: 8 });
  await award(t9.id, kaveri.id);
  await withLr(t9.id, 'MH12QW9902', 'Ramesh K');
  await finish(t9.id, 180);
  // C2. POD accepted; Suresh (Accounts) prepared the invoice above the limit: waiting for the owner's approval.
  const t18 = await book(chennaiBlr, ambattur, hosur, { date: -5, material: 'Biscuits (packed cartons)', tonnes: 14 });
  await award(t18.id, kaveri.id);
  await withLr(t18.id, 'TN09YY0042', 'Karthik R');
  await finish(t18.id, 216);
  await invoice(t18.id, accountsBy);
  // C3. Delivered with damage; the shipper accepted the POD and raised a claim that waits for the carrier's answer.
  const t19 = await book(chennaiBlr, ambattur, hosur, { date: -4, material: 'Biscuits (packed cartons)', tonnes: 14 });
  await award(t19.id, kaveri.id);
  await withLr(t19.id, 'KA22TT5120', 'Murugan V');
  await toDrop(t19.id);
  await markDelivered(t19.id, kaveri.id, by, { goodQty: 214, damagedQty: 6, remarks: 'Six cartons crushed at the drop' });
  await uploadSigned(t19.id, 'Six cartons marked damaged on receipt');
  await release(t19.id);
  await acceptPod(t19.id, sunrise.id, actor);
  await raiseClaim(t19.id, sunrise.id, actor, { kind: 'DAMAGE', qty: 6, unitValue: 450, description: 'Six cartons crushed on arrival, photos attached to the POD' });
  // D. Delivered: waiting for the signed POD (this LR has no e-way bill number).
  const t13 = await book(chennaiBlr, ambattur, hosur, { date: -3, material: 'Biscuits (packed cartons)', tonnes: 14 });
  await award(t13.id, kaveri.id);
  await withLr(t13.id, 'TN09BX4471', 'Ramesh K', false);
  await toDrop(t13.id);
  await markDelivered(t13.id, kaveri.id, by, { goodQty: 220, damagedQty: 0, remarks: null });
  await release(t13.id);

  // In flight.
  // E. On hold: breakdown near Krishnagiri. The carrier proposed a swap that costs the shipper ₹3,500: waiting for the shipper to decide.
  // Selvam's licence is expired: the owner overrode the block when assigning.
  const t8 = await book(chennaiBlr, ambattur, hosur, { date: -2, material: 'Biscuits (packed cartons)', tonnes: 16 });
  await award(t8.id, kaveri.id);
  await withLr(t8.id, 'KA22TT5120', 'Selvam P', true, 'Licence renewal filed; papers arrive tomorrow');
  await prisma.trip.update({ where: { id: t8.id }, data: { driverId: null } }); // keep Selvam off the fleet's "on trip"
  await step(t8.id, 'REACHED_PICKUP');
  await step(t8.id, 'LOADED', null, hours(6));
  const swapTruck = await truckOf('TN09YY0042');
  const swapDriver = await driverOf('Karthik R');
  await reportProblem(t8.id, kaveri.id, by, {
    kind: 'BREAKDOWN', description: 'Clutch failure near Krishnagiri, 2 photos. Repair 18 h.',
    proposal: { fix: 'SWAP', label: 'Swap to a free truck from Hosur', newEta: hours(11), extraCost: 3500, payer: 'SHIPPER', swap: { truckId: swapTruck.id, driverId: swapDriver.id, override: null } },
  });
  // F. In transit: MH 12 QW 8841 with Ramesh K.
  const t7 = await book(puneHyd, chakan, medchal, { date: -1, material: 'Snacks', tonnes: 8 });
  await award(t7.id, kaveri.id);
  await withLr(t7.id, 'MH12QW8841', 'Ramesh K');
  await step(t7.id, 'REACHED_PICKUP', 'Chakan Warehouse');
  await step(t7.id, 'LOADED', 'Chakan Warehouse', hours(20));
  await step(t7.id, 'LOCATION', 'Solapur bypass', hours(18));
  // F2. In transit and at the drop: record the delivery.
  const t20 = await book(puneHyd, chakan, medchal, { date: -1, material: 'Snacks', tonnes: 9 });
  await award(t20.id, kaveri.id);
  await withLr(t20.id, 'MH12QW9902', 'Anbu S');
  await prisma.trip.update({ where: { id: t20.id }, data: { driverId: null } }); // keep Anbu free for the other loads
  await toDrop(t20.id);
  // G. Ready for pickup: LR issued, TN 10 AZ 2210 with Murugan V. Nothing recorded yet: start with Reached pickup.
  const t6 = await book(chennaiBlr, ambattur, hosur, { date: 0, material: 'Biscuits (packed cartons)', tonnes: 15 });
  await award(t6.id, kaveri.id);
  await withLr(t6.id, 'TN10AZ2210', 'Murugan V');
  // H. Truck assigned (TN 09 BX 4471 is Expiring; driver Anbu S): carrier to issue the LR.
  const t5b = await book(chennaiBlr, ambattur, hosur, { date: 1, material: 'Biscuits (packed cartons)', tonnes: 13 });
  await award(t5b.id, kaveri.id);
  await assign(t5b.id, 'TN09BX4471', 'Anbu S');
  // I. Won: assign a truck. Free choices: TN 09 YY 0042 (ready), TN 09 ZZ 0007 (insurance expired: owner override), drivers Karthik R, Dinesh M (LGV).
  const t5 = await book(chennaiBlr, ambattur, hosur, { date: 1, material: 'Biscuits (packed cartons)', tonnes: 14 });
  await award(t5.id, kaveri.id);

  // New offers.
  await book(chennaiBlr, ambattur, hosur, { date: 2, material: 'Biscuits (packed cartons)', tonnes: 14 });
  await book(puneHyd, chakan, medchal, { date: 3, material: 'Snacks', tonnes: 12 });
  await book(chennaiBlr, ambattur, hosur, { date: 3, material: 'Biscuits (packed cartons)', tonnes: 13, closesIn: 2 });
  // Kaveri did not answer in time; Deccan Freight accepted and won it.
  const t12 = await book(chennaiBlr, ambattur, hosur, { date: -3, material: 'Biscuits (packed cartons)', tonnes: 14 });
  await lapse(t12.id, kaveri.id);
  await award(t12.id, deccan.id);
  // You passed: no truck free that day.
  const t14 = await book(chennaiBlr, ambattur, hosur, { date: 2, material: 'Biscuits (packed cartons)', tonnes: 15 });
  await pass(t14.id, 'No truck free that day');
  // Offer expired: no answer before the response time ran out.
  const t15 = await book(chennaiBlr, ambattur, hosur, { date: 1, material: 'Biscuits (packed cartons)', tonnes: 10 });
  await lapse(t15.id, kaveri.id);
  // Cancelled by the shipper while the offer was open.
  const t16 = await book(chennaiBlr, ambattur, hosur, { date: 4, material: 'Biscuits (packed cartons)', tonnes: 14 });
  await cancelTrip(t16.id, sunrise.id, actor, 'ORDER_CANCELLED', null);

  console.log(`Demo loads created: ${n} trips for Sunrise Foods, covering every status on Kaveri Roadlines' desk.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

