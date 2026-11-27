/**
 * Demo data loader (development and demos only, never production).
 *
 *   npm run demo:load     load the demo company (does nothing if it is already there)
 *   npm run demo:reset    remove it and load it again (fresh dates relative to now)
 *   npm run demo:remove   remove it
 *
 * Sign in as lakshmi.menon@vasudhafoods.test (or deepa.iyer, suresh.babu, arjun.reddy) / Demo@123.
 *
 * Only the demo company, its people and the five demo carriers are touched. Trips are created and
 * moved through the workflow by the app's own API (booking, offers, approval, truck, delivery, POD,
 * claims, invoices, payment), each step on a past date, so statuses, scores, approvals and the
 * activity log are exactly what the app itself would produce.
 */
import 'dotenv/config';
import type { AddressInfo } from 'net';
import { Prisma } from '@prisma/client';
import { RealDate, installClock, setClock } from './clock';
import { prisma } from '../../src/lib/prisma';
import { hashPassword, newSessionToken } from '../../src/lib/password';
import { DEFAULT_AUTONOMY } from '../../src/modules/policies/policy.defaults';
import { createApp } from '../../src/app';
import * as D from './data';

const H = 3600_000;
const DAY = 24 * H;
const IST = 5.5 * H;
const KEY = process.env.INTEGRATION_KEY || 'dev-integration-key';
const DEMO_EMAILS = new Set<string>(Object.values(D.USERS).map((u) => u.email));
const CARRIER_NAMES = Object.values(D.CARRIERS).map((c) => c.name);

// ---------- remove ----------

/** The demo shipper, only if every user in it is a demo user (never touches a real company of the same name). */
async function demoShipper() {
  const c = await prisma.company.findFirst({ where: { name: D.SHIPPER.name, type: 'SHIPPER' }, include: { users: true } });
  if (!c) return null;
  const foreign = c.users.filter((u) => !u.email || !DEMO_EMAILS.has(u.email));
  if (foreign.length) throw new Error(`"${D.SHIPPER.name}" has users that are not demo users; not touching it.`);
  return c;
}

async function remove() {
  const shipper = await demoShipper();
  if (shipper) {
    const trips = (await prisma.trip.findMany({ where: { shipperId: shipper.id }, select: { id: true } })).map((t) => t.id);
    const userIds = shipper.users.map((u) => u.id);
    const byTrip = { tripId: { in: trips } };
    await prisma.$transaction([
      prisma.auditLog.deleteMany({ where: { OR: [byTrip, { actor: { in: userIds } }] } }),
      prisma.notification.deleteMany({ where: { companyId: shipper.id } }),
      prisma.approval.deleteMany({ where: { OR: [byTrip, { companyId: shipper.id }] } }),
      prisma.invoice.deleteMany({ where: byTrip }),
      prisma.claim.deleteMany({ where: byTrip }),
      prisma.document.deleteMany({ where: byTrip }),
      prisma.quote.deleteMany({ where: byTrip }),
      prisma.tripException.deleteMany({ where: byTrip }),
      prisma.trip.deleteMany({ where: { id: { in: trips } } }),
      prisma.lane.deleteMany({ where: { shipperId: shipper.id } }),
      prisma.rateCard.deleteMany({ where: { shipperId: shipper.id } }),
      prisma.shipperCarrier.deleteMany({ where: { shipperId: shipper.id } }),
      prisma.address.deleteMany({ where: { companyId: shipper.id } }),
      prisma.lrSeries.deleteMany({ where: { carrierId: shipper.id } }),
      prisma.shipperPolicy.deleteMany({ where: { companyId: shipper.id } }),
      prisma.user.deleteMany({ where: { companyId: shipper.id } }),
      prisma.company.delete({ where: { id: shipper.id } }),
    ]);
    console.log(`Removed ${D.SHIPPER.name}: ${trips.length} trips, ${userIds.length} users.`);
  }
  // Demo carriers go too, unless someone else now works with them.
  for (const name of CARRIER_NAMES) {
    const c = await prisma.company.findFirst({ where: { name, type: 'CARRIER' }, include: { users: true, carrierOn: true, quotes: true, wonTrips: true, listedBy: true, rateCardsGiven: true } });
    if (!c) continue;
    if (c.users.length || c.carrierOn.length || c.quotes.length || c.wonTrips.length || c.listedBy.length || c.rateCardsGiven.length) {
      console.log(`Kept carrier ${name}: other data uses it.`);
      continue;
    }
    await prisma.carrierPerformance.deleteMany({ where: { carrierId: c.id } });
    await prisma.company.delete({ where: { id: c.id } });
  }
}

// ---------- setup (master data) ----------

async function setup() {
  const since = new RealDate(RealDate.now() - 100 * DAY);
  const shipper = await prisma.company.create({ data: { name: D.SHIPPER.name, type: 'SHIPPER', phone: D.SHIPPER.phone, createdAt: since } });

  const users = {} as Record<D.UserKey, { id: string; email: string }>;
  for (const [key, u] of Object.entries(D.USERS) as [D.UserKey, (typeof D.USERS)[D.UserKey]][]) {
    const invited = 'invited' in u && u.invited;
    const created = await prisma.user.create({
      data: {
        companyId: shipper.id, name: u.name, email: u.email, phone: u.phone, role: u.role, createdAt: since,
        approvalLimit: u.approvalLimit != null ? new Prisma.Decimal(u.approvalLimit) : null,
        passwordHash: invited ? null : await hashPassword(D.DEMO_PASSWORD),
        ...(invited ? { inviteToken: newSessionToken(), inviteExpiresAt: new RealDate(RealDate.now() + 7 * DAY) } : {}),
      },
    });
    users[key] = { id: created.id, email: u.email };
  }

  const carriers = {} as Record<D.CarrierKey, string>;
  for (const [key, c] of Object.entries(D.CARRIERS) as [D.CarrierKey, (typeof D.CARRIERS)[D.CarrierKey]][]) {
    const existing = await prisma.company.findFirst({ where: { name: c.name, type: 'CARRIER' } });
    const row = existing ?? (await prisma.company.create({ data: { name: c.name, type: 'CARRIER', phone: c.phone, createdAt: since } }));
    const [trips, onTimePct, podDays, acceptPct] = c.perf;
    const perf = { trips, onTimePct, podDays: new Prisma.Decimal(podDays), acceptPct };
    await prisma.carrierPerformance.upsert({ where: { carrierId: row.id }, update: perf, create: { carrierId: row.id, ...perf } });
    carriers[key] = row.id;
  }

  const addresses: Record<string, string> = {};
  for (const a of D.ADDRESSES) addresses[a.name] = (await prisma.address.create({ data: { companyId: shipper.id, ...a, createdAt: since } })).id;

  // Carrier master and rate cards: every demo carrier, with agreed rates on the lanes it serves
  // (the lane's usual freight, a little under or over per carrier): the cheapest is offered first.
  for (const [key, c] of Object.entries(D.CARRIERS) as [D.CarrierKey, (typeof D.CARRIERS)[D.CarrierKey]][]) {
    await prisma.shipperCarrier.create({ data: { shipperId: shipper.id, carrierId: carriers[key], contactName: c.contact, contactPhone: c.phone, city: c.city, createdAt: since } });
    const lines = Object.values(D.LANES)
      .filter((l) => (l.carriers as readonly string[]).includes(key))
      .map((l) => ({
        origin: l.origin, destination: l.destination, truckType: l.truckType,
        rate: new Prisma.Decimal(Math.round((l.budget * (1 + c.rateVsBudget)) / 100) * 100),
        detentionPerDay: new Prisma.Decimal(1200), transitDays: Math.max(1, Math.ceil(l.transitH / 24)),
      }));
    if (lines.length) await prisma.rateCard.create({ data: { shipperId: shipper.id, carrierId: carriers[key], createdAt: since, lines: { create: lines } } });
  }

  for (const l of Object.values(D.LANES)) {
    await prisma.lane.create({
      data: {
        shipperId: shipper.id, origin: l.origin, destination: l.destination, truckType: l.truckType,
        createdAt: since, carriers: { create: l.carriers.map((k) => ({ carrierId: carriers[k], createdAt: since })) },
      },
    });
  }
  await prisma.shipperPolicy.create({
    data: { companyId: shipper.id, paymentApprovalAbove: new Prisma.Decimal(75000), quoteWindowHours: 2, podRule: 'DIGITAL', autonomy: DEFAULT_AUTONOMY, updatedById: users.lakshmi.id },
  });
  return { shipper, users, carriers, addresses };
}

// ---------- API client and the clock ----------

let base = '';
async function api(token: string | null, method: string, path: string, body?: unknown) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : { 'x-integration-key': KEY }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(json)}`);
  return json;
}
const carrierApi = (method: string, path: string, body?: unknown) => api(null, method, `/integration${path}`, body);

let latestAllowed = 0;
/**
 * Runs one step at demo time `t`, then moves the rows the step wrote (created/updated "now") back to
 * `t`, keeping their order. Every demo time is at least 5 minutes before the load started.
 */
async function at(t: number, tripId: () => string | undefined, fn: () => Promise<void>) {
  // Office-hour shifts can push a late step past "now" when the demo is loaded in the morning (IST);
  // cap it at the latest allowed time instead of failing. Order is kept: later steps share the cap.
  if (t > latestAllowed) t = latestAllowed;
  const r0 = RealDate.now();
  setClock(t);
  try {
    await fn();
  } finally {
    setClock(null);
  }
  const id = tripId();
  if (!id) return;
  const shift = `${(r0 - t) / 1000} seconds`;
  const since = new RealDate(r0 - 2000).toISOString().replace('Z', '');
  for (const table of ['Quote', 'Document', 'Claim', 'Invoice', 'Approval', 'TripException', 'AuditLog']) {
    await prisma.$executeRawUnsafe(`UPDATE "${table}" SET "createdAt" = "createdAt" - $1::interval WHERE "tripId" = $2 AND "createdAt" >= $3::timestamp`, shift, id, since);
  }
  for (const table of ['Claim', 'Invoice', 'TripException']) {
    await prisma.$executeRawUnsafe(`UPDATE "${table}" SET "updatedAt" = "updatedAt" - $1::interval WHERE "tripId" = $2 AND "updatedAt" >= $3::timestamp`, shift, id, since);
  }
  await prisma.$executeRawUnsafe(`UPDATE "Trip" SET "createdAt" = "createdAt" - $1::interval WHERE "id" = $2 AND "createdAt" >= $3::timestamp`, shift, id, since);
  await prisma.$executeRawUnsafe(`UPDATE "Trip" SET "updatedAt" = "updatedAt" - $1::interval WHERE "id" = $2 AND "updatedAt" >= $3::timestamp`, shift, id, since);
}

/** Booking time: a clock time (IST) N days ago, or N hours ago. */
function bookedAt(w: D.When, now: number) {
  if ('hoursAgo' in w) return now - w.hoursAgo * H;
  const [hh, mm] = w.at.split(':').map(Number);
  const istMidnight = Math.floor((now + IST) / DAY) * DAY - IST;
  return istMidnight - w.daysAgo * DAY + (hh * 60 + mm) * 60_000;
}
const istDate = (t: number) => new RealDate(t + IST).toISOString().slice(0, 10);

/** People act in office hours (IST 09:30–19:00): later work moves to the next morning, unless that is still ahead. */
function office(t: number, jitterMin = 0) {
  const hour = ((t + IST) % DAY) / H;
  if (hour >= 9.5 && hour < 19) return t;
  const dayStart = Math.floor((t + IST) / DAY) * DAY - IST;
  const next = (hour < 9.5 ? dayStart : dayStart + DAY) + (10 * 60 + jitterMin) * 60_000;
  return next > latestAllowed ? t : next;
}

/** Small deterministic generator so the same dataset gives the same truck numbers and references. */
function rng(seed: number) {
  return () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
}
const DRIVERS = ['Murugan K', 'Selvaraj P', 'Ramesh Gowda', 'Imran Khan', 'Baldev Singh', 'Venkatesh R', 'Santosh Jadhav', 'Anil Yadav', 'Prakash Naik', 'Raju Thomas'];
const LETTERS = 'ABCDEFGHJKLMNPRSTUVWXYZ';

// ---------- one trip ----------

interface Ctx {
  users: Record<D.UserKey, { id: string }>;
  tokens: Record<string, string>;
  carriers: Record<D.CarrierKey, string>;
  addresses: Record<string, string>;
  invoiceSeq: Record<string, number>;
}

async function runTrip(s: D.TripSpec, i: number, ctx: Ctx, now: number) {
  const lane = D.LANES[s.lane];
  const reach = (st: D.Stage) => D.STAGES.indexOf(s.until) >= D.STAGES.indexOf(st);
  const tok = (u: D.UserKey) => ctx.tokens[u];
  const r = rng(1000 + i * 7919);
  const jitter = () => Math.floor(r() * 50);
  let tripId: string | undefined;
  let number = '';
  const id = () => tripId;
  const T0 = bookedAt(s.booked, now);
  let c = T0;

  // 1. Booking (pickup the next morning).
  await at(T0, id, async () => {
    const res = await api(tok(s.by), 'POST', '/bookings', {
      pickupAddressId: ctx.addresses[lane.from], dropAddressId: ctx.addresses[lane.to], pickupDate: istDate(T0 + 20 * H),
      truckType: lane.truckType, material: s.material, weightTonnes: s.tonnes, reference: s.reference,
    });
    tripId = res.trip.id;
    number = res.trip.number;
  });
  if (!reach('quoted')) return;

  // 2. Offers: the cheapest contract carrier is offered first; each outcome moves the offer on.
  const PASS_REASONS = ['No truck free that day', 'Truck committed elsewhere', 'Rate no longer works for us', 'Driver shortage'];
  const offered = async () => prisma.quote.findFirstOrThrow({ where: { tripId, status: 'REQUESTED' }, orderBy: { sequence: 'asc' } });
  for (const [k, outcome] of s.offers.entries()) {
    const q = await offered();
    if (outcome === 'pass' || outcome === 'rejected') {
      c += 0.4 * H;
      await at(c, id, () => carrierApi('POST', '/quotes', { tripNumber: number, carrierId: q.carrierId, accept: false, reason: PASS_REASONS[k % PASS_REASONS.length] }));
    } else if (outcome === 'noanswer') {
      c += 2 * H + 60_000;
      await at(c, id, () => carrierApi('POST', `/trips/${number}/expire-quotes`));
    } else {
      c += 0.35 * H;
      await at(c, id, () => carrierApi('POST', '/quotes', { tripNumber: number, carrierId: q.carrierId, accept: true }));
    }
  }

  if (s.cancel && s.until === 'quoted') {
    await at(T0 + s.cancel.afterH * H, id, () => api(tok('lakshmi'), 'POST', `/trips/${tripId}/cancel`, { reason: s.cancel!.reason, note: s.cancel!.note }));
    return;
  }
  if (!reach('awarded')) return;

  // 3. Accepting awarded the trip at once; the shipper only got a notification.
  const awarded = await prisma.trip.findUniqueOrThrow({ where: { id: tripId } });
  if (awarded.status !== 'AWARDED' || !awarded.carrierId) throw new Error(`${number}: expected an award, trip is ${awarded.status}. Check the offers in the dataset.`);
  const carrierKey = (Object.keys(ctx.carriers) as D.CarrierKey[]).find((k) => ctx.carriers[k] === awarded.carrierId)!;
  const carrier = D.CARRIERS[carrierKey];
  const amount = Number(awarded.awardedAmount);

  if (s.cancel) {
    await at(T0 + s.cancel.afterH * H, id, () => api(tok('lakshmi'), 'POST', `/trips/${tripId}/cancel`, { reason: s.cancel!.reason, note: s.cancel!.note }));
    return;
  }
  if (!reach('truck')) return;

  // 4. Truck, driver, LR and e-way bill.
  c = Math.max(c + 1.5 * H, T0 + 5 * H);
  const digits = (n: number) => String(Math.floor(r() * 10 ** n)).padStart(n, '0');
  const truckNumber = `${carrier.state} ${String(1 + Math.floor(r() * 58)).padStart(2, '0')} ${LETTERS[Math.floor(r() * LETTERS.length)]}${LETTERS[Math.floor(r() * LETTERS.length)]} ${1000 + Math.floor(r() * 9000)}`;
  await at(c, id, () =>
    carrierApi('POST', `/trips/${number}/truck`, {
      truckNumber, driverName: DRIVERS[Math.floor(r() * DRIVERS.length)], driverPhone: `90000${digits(5)}`,
      lrNumber: `${carrier.code}-LR-${digits(5)}`, ewayBillNumber: `3310${digits(8)}`, ewayValidUntil: new RealDate(c + 3 * DAY).toISOString(),
    }),
  );
  if (!reach('transit')) return;

  // 5. On the road.
  const pickup = Math.max(T0 + 20 * H, c + 3 * H);
  const loaded = pickup + 1.5 * H;
  const eta = loaded + lane.transitH * H;
  await at(pickup, id, () => carrierApi('POST', `/trips/${number}/events`, { type: 'REACHED_PICKUP' }));
  await at(loaded, id, () => carrierApi('POST', `/trips/${number}/events`, { type: 'LOADED', eta: new RealDate(eta).toISOString() }));
  let delayH = s.lateH ?? 0;
  const mid = Math.min(loaded + 0.45 * lane.transitH * H, latestAllowed - 20 * 60_000);
  if (mid > loaded + 30 * 60_000 && !s.exception) {
    await at(mid, id, () => carrierApi('POST', `/trips/${number}/events`, { type: 'LOCATION', location: lane.midway, eta: new RealDate(eta + delayH * H).toISOString() }));
  }
  if (s.exception) {
    const ex = s.exception;
    const when = loaded + 0.35 * lane.transitH * H;
    delayH += ex.fix?.delayH ?? 0;
    const proposal = ex.fix ? { ...ex.fix, newEta: new RealDate(eta + delayH * H).toISOString() } : undefined;
    let exceptionId = '';
    await at(when, id, async () => {
      exceptionId = (await carrierApi('POST', `/trips/${number}/exceptions`, { kind: ex.kind, description: ex.description, proposal })).exceptionId;
    });
    if (ex.pending) return;
    if (ex.kind !== 'DELAY') {
      if (ex.fix?.payer === 'SHIPPER' && ex.fix.extraCost > 0) await at(when + 0.5 * H, id, () => api(tok('lakshmi'), 'POST', `/trips/${tripId}/exception/approve`));
      await at(when + (ex.fix?.delayH ?? 2) * 0.8 * H, id, () => carrierApi('POST', `/exceptions/${exceptionId}/resolve`, {}));
    }
  }
  if (!reach('delivered')) return;

  // 6. Delivered, POD photo; review and claims when it isn't clean.
  const deliveredAt = eta + delayH * H;
  const damaged = s.damaged ?? 0;
  await at(deliveredAt - 0.5 * H, id, () => carrierApi('POST', `/trips/${number}/events`, { type: 'REACHED_DROP', location: lane.destination }));
  await at(deliveredAt, id, () => carrierApi('POST', `/trips/${number}/delivered`, { goodQty: s.units - damaged, damagedQty: damaged, remarks: s.podRemarks }));
  c = deliveredAt + 1 * H;
  await at(c, id, () => carrierApi('POST', `/trips/${number}/pod`, { qrMatched: true, remarks: s.podRemarks }));
  let claimNumber = '';
  if (s.claim) {
    c = office(c + 1.5 * H, jitter());
    const { kind, qty, unitValue, description } = s.claim;
    await at(c, id, async () => {
      claimNumber = (await api(tok('lakshmi'), 'POST', `/trips/${tripId}/claims`, { kind, qty, unitValue, description })).claim.number;
    });
  }
  if (!reach('pod')) return;
  if (s.claim) {
    c = office(c + 18 * H, jitter());
    const accept = s.claim.accept !== false;
    await at(c, id, () => carrierApi('POST', `/claims/${claimNumber}/response`, { accept, note: accept ? 'Accepted. Deduct it from our invoice.' : 'Seal was intact at delivery; we dispute the shortage.' }));
  }
  if (damaged || s.podRemarks) {
    c = office(c + 2 * H, jitter());
    await at(c, id, () => api(tok('lakshmi'), 'POST', `/trips/${tripId}/pod/accept`));
  }
  if (!reach('invoiced')) return;

  // 7. Invoice, approval and payment.
  c = office(c + 40 * H, jitter());
  ctx.invoiceSeq[carrierKey] = (ctx.invoiceSeq[carrierKey] ?? 400) + 1;
  const deduction = s.claim && s.claim.accept !== false ? s.claim.qty * s.claim.unitValue : 0;
  await at(c, id, () =>
    carrierApi('POST', `/trips/${number}/invoice`, {
      number: `${carrier.code}/26-27/${ctx.invoiceSeq[carrierKey]}`, freight: s.invoiceFreight ?? amount, detention: s.detention ?? 0, claimDeduction: deduction,
    }),
  );
  if (s.query) {
    await at(office(c + 20 * H, jitter()), id, () => api(tok('lakshmi'), 'POST', `/trips/${tripId}/invoice/query`, { reason: s.query }));
    return;
  }
  if (!reach('closed')) return;
  c = office(c + 22 * H, jitter());
  await at(c, id, () => api(tok('suresh'), 'POST', `/trips/${tripId}/invoice/approve`));
  c = office(c + 26 * H, jitter());
  const reference = s.pay === 'BANK' ? `NEFT N${istDate(c).replace(/-/g, '')}${digits(6)}` : `UPI ${digits(12)}`;
  await at(c, id, () => api(tok('suresh'), 'POST', `/trips/${tripId}/invoice/pay`, { mode: s.pay ?? 'UPI', reference }));
}

// ---------- load ----------

async function load() {
  if (await demoShipper()) {
    console.log(`${D.SHIPPER.name} is already loaded. Run "npm run demo:reset" to load it again.`);
    return;
  }
  const now = RealDate.now();
  latestAllowed = now - 5 * 60_000;
  const { users, carriers, addresses } = await setup();

  installClock();
  const server = createApp().listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  try {
    const tokens: Record<string, string> = {};
    for (const [key, u] of Object.entries(D.USERS)) {
      if ('invited' in u && u.invited) continue;
      tokens[key] = (await api(null, 'POST', '/auth/login', { email: u.email, password: D.DEMO_PASSWORD })).token;
    }
    const ctx: Ctx = { users, tokens, carriers, addresses, invoiceSeq: {} };
    // In booking order.
    const order = D.TRIPS.map((s, i) => ({ s, i, t: bookedAt(s.booked, now) })).sort((a, b) => a.t - b.t);
    for (const { s, i } of order) await runTrip(s, i, ctx, now);
    // The loader's own sign-ins are not part of the story.
    await prisma.auditLog.deleteMany({ where: { action: 'LOGIN', actor: { in: Object.values(users).map((u) => u.id) } } });
    await prisma.session.deleteMany({ where: { userId: { in: Object.values(users).map((u) => u.id) } } });
  } finally {
    server.close();
  }

  const counts = await prisma.trip.groupBy({ by: ['status'], where: { shipper: { name: D.SHIPPER.name } }, _count: true });
  console.log(`Loaded ${D.SHIPPER.name}: ${D.TRIPS.length} trips (${counts.map((x) => `${x.status.toLowerCase()} ${x._count}`).join(', ')}).`);
  console.log(`Sign in as ${D.USERS.lakshmi.email} / ${D.DEMO_PASSWORD}`);
}

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Demo data is never loaded in production.');
  const cmd = process.argv[2] ?? 'load';
  if (cmd === 'remove') await remove();
  else if (cmd === 'reset') {
    await remove();
    await load();
  } else if (cmd === 'load') await load();
  else throw new Error(`Unknown command "${cmd}". Use load, reset or remove.`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    console.error('If a load stopped half-way, run "npm run demo:reset".');
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
