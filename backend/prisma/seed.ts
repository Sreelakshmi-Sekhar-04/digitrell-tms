/**
 * Development and test seed. Safe to re-run: it upserts by email / company name / natural keys.
 *
 * Test logins (local development and Playwright only; never use in production):
 *   anita@sunrisefoods.test   / Shipper@123   Logistics head (approver, up to ₹2,00,000), Sunrise Foods (shipper)
 *   karthik@sunrisefoods.test / Shipper@123   Booking executive (cannot approve), Sunrise Foods (shipper)
 *   priya@sunrisefoods.test   / Shipper@123   Approver up to ₹40,000, Sunrise Foods (tests the approval limit)
 *   inactive@sunrisefoods.test/ Shipper@123   Deactivated user — login must fail
 *   meera@coastalpaints.test  / Shipper@123   Logistics head, Coastal Paints (a second shipper, for data-isolation tests)
 *   vijay@kaveri.test         / Carrier@123   Owner, Kaveri Roadlines (carrier); also holds Traffic Manager
 *   divya@kaveri.test         / Carrier@123   Traffic Manager, Kaveri Roadlines
 *   suresh@kaveri.test        / Carrier@123   Accounts, Kaveri Roadlines
 *   inactive@kaveri.test      / Carrier@123   Deactivated carrier user — login must fail
 *   arjun@northstar.test      / Carrier@123   Owner, NorthStar Logistics (a second carrier, for data-isolation tests)
 *
 * Carrier sample data (Kaveri): 5 trucks (one expiring, one blocked), 3 drivers (one blocked), 4 rate cards
 * (one expired), company profile and LR series KR from 482.
 */
import 'dotenv/config';
import { PrismaClient, CompanyType, Prisma } from '@prisma/client';
import { hashPassword } from '../src/lib/password';
import { DEFAULT_AUTONOMY } from '../src/modules/policies/policy.defaults';
import { DEFAULT_CARRIER_AUTONOMY } from '../src/shared/carrier';

const prisma = new PrismaClient();

async function company(name: string, type: CompanyType, phone?: string) {
  const existing = await prisma.company.findFirst({ where: { name } });
  return existing ?? prisma.company.create({ data: { name, type, phone } });
}

async function user(
  companyId: string,
  email: string,
  name: string,
  role: string,
  password: string,
  extra: { phone?: string; isActive?: boolean; approvalLimit?: number; roles?: string[] } = {},
) {
  const passwordHash = await hashPassword(password);
  const data = {
    name, role, companyId, passwordHash,
    isActive: extra.isActive ?? true,
    roles: extra.roles ?? [],
    approvalLimit: extra.approvalLimit != null ? new Prisma.Decimal(extra.approvalLimit) : null,
  };
  return prisma.user.upsert({ where: { email }, update: data, create: { email, phone: extra.phone, ...data } });
}

async function address(companyId: string, a: { name: string; city: string; line1: string; kind: string; contactName?: string; contactPhone?: string; hours?: string }) {
  return prisma.address.upsert({ where: { companyId_name: { companyId, name: a.name } }, update: a, create: { companyId, ...a } });
}

// The budget is entered on each booking, not on the lane.
async function lane(shipperId: string, origin: string, destination: string, truckType: string, awardRule: string, carrierIds: string[]) {
  const l = await prisma.lane.upsert({
    where: { shipperId_origin_destination_truckType: { shipperId, origin, destination, truckType } },
    update: { awardRule },
    create: { shipperId, origin, destination, truckType, awardRule },
  });
  await prisma.laneCarrier.deleteMany({ where: { laneId: l.id } });
  await prisma.laneCarrier.createMany({ data: carrierIds.map((carrierId) => ({ laneId: l.id, carrierId })) });
  return l;
}

/** A carrier in a shipper's carrier master, with the shipper's own contact details for it. */
async function listCarrier(shipperId: string, carrierId: string, details: Prisma.ShipperCarrierUncheckedCreateInput extends infer T ? Omit<T & object, 'shipperId' | 'carrierId'> : never) {
  await prisma.shipperCarrier.upsert({
    where: { shipperId_carrierId: { shipperId, carrierId } },
    update: details,
    create: { shipperId, carrierId, ...details },
  });
}

type Rate = [origin: string, destination: string, truckType: string, rate: number, detentionPerDay: number | null, transitDays: number | null];

/** A carrier's rate card for a shipper (replaces its lines, so re-running the seed is safe). */
async function rateCard(shipperId: string, carrierId: string, validTo: string | null, rates: Rate[]) {
  const card = await prisma.rateCard.upsert({
    where: { shipperId_carrierId: { shipperId, carrierId } },
    update: { validTo: validTo ? new Date(`${validTo}T00:00:00.000Z`) : null },
    create: { shipperId, carrierId, validTo: validTo ? new Date(`${validTo}T00:00:00.000Z`) : null },
  });
  await prisma.rateCardLine.deleteMany({ where: { rateCardId: card.id } });
  await prisma.rateCardLine.createMany({
    data: rates.map(([origin, destination, truckType, rate, det, days]) => ({
      rateCardId: card.id, origin, destination, truckType, rate: new Prisma.Decimal(rate),
      detentionPerDay: det != null ? new Prisma.Decimal(det) : null, transitDays: days,
    })),
  });
}

/** A date `days` from today (midnight UTC), so seeded expiry states stay right whenever the seed runs. */
const fromToday = (days: number) => {
  const d = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d;
};

/**
 * Carrier sample data from the approved design (Fleet and rates): Kaveri's trucks, drivers, rate
 * cards, profile and LR series. One truck and one driver are blocked on purpose to show the rules.
 */
async function carrierFleetAndRates(kaveriId: string, northstarId: string, sunriseId: string) {
  const drivers = [
    { carrierId: kaveriId, name: 'Ramesh K', phone: '+919800000121', licenceNumber: 'MH1220150045678', licenceClass: 'HGV', licenceExpiry: fromToday(1200), language: 'hi', upiId: 'ramesh.k@okaxis', upiVerifiedAt: new Date() },
    { carrierId: kaveriId, name: 'Murugan V', phone: '+919800000108', licenceNumber: 'TN0920190012345', licenceClass: 'EHV', licenceExpiry: fromToday(500), language: 'ta', upiId: 'murugan.v@oksbi', upiVerifiedAt: null },
    { carrierId: kaveriId, name: 'Selvam P', phone: '+919800000131', licenceNumber: 'TN1020100098765', licenceClass: 'HGV', licenceExpiry: fromToday(-20), language: 'ta', upiId: null, upiVerifiedAt: null },
    { carrierId: northstarId, name: 'Harish B', phone: '+919800000141', licenceNumber: 'KA0120180011111', licenceClass: 'HGV', licenceExpiry: fromToday(900), language: 'kn', upiId: null, upiVerifiedAt: null },
  ];
  const ids: Record<string, string> = {};
  for (const d of drivers) {
    const row = await prisma.driver.upsert({ where: { phone: d.phone }, update: d, create: d });
    ids[d.name] = row.id;
  }

  const truck = (number: string, truckType: string, ownership: string, docs: [number, number, number, number, number], extra: Record<string, unknown> = {}) => ({
    number, truckType, ownership, carrierId: kaveriId,
    rcExpiry: fromToday(docs[0]), insuranceExpiry: fromToday(docs[1]), permitExpiry: fromToday(docs[2]), fitnessExpiry: fromToday(docs[3]), pucExpiry: fromToday(docs[4]),
    ...extra,
  });
  const trucks = [
    // Design: insurance expires in a few days → "Expiring".
    truck('TN09BX4471', '32ft MXL', 'OWN', [2000, 3, 300, 480, 120], { make: 'Tata Signa 3518', capacityKg: new Prisma.Decimal(18000) }),
    truck('TN10AZ2210', '32ft MXL', 'ATTACHED', [1800, 210, 400, 60 + 365, 150], { make: 'Ashok Leyland 3520', capacityKg: new Prisma.Decimal(18000), ownerName: 'Senthil Transports', ownerPhone: '+919800000151', usualDriverId: ids['Murugan V'] }),
    truck('MH12QW8841', '20ft SXL', 'OWN', [1500, 80, 260, 270, 90], { make: 'Eicher Pro 3015', capacityKg: new Prisma.Decimal(9000), usualDriverId: ids['Ramesh K'] }),
    truck('KA22TT5120', '32ft MXL', 'OWN', [2200, 300, 500, 400, 200], { make: 'BharatBenz 3523R', capacityKg: new Prisma.Decimal(19000) }),
    // Permit expired → "Blocked" until renewed.
    truck('TN11CC9087', '19ft', 'OWN', [1400, 120, -5, 200, 60], { make: 'Tata 1512', capacityKg: new Prisma.Decimal(7000) }),
  ];
  for (const t of trucks) await prisma.truck.upsert({ where: { number: t.number }, update: t, create: t });
  const ns = truck('KA01NS1001', '32ft MXL', 'OWN', [2000, 300, 300, 300, 300]);
  await prisma.truck.upsert({ where: { number: ns.number }, update: { ...ns, carrierId: northstarId }, create: { ...ns, carrierId: northstarId } });

  const rates = [
    { shipperId: sunriseId, origin: 'Chennai', destination: 'Bengaluru', truckType: '32ft MXL', rate: 42500, bandPct: 5, tripCost: 38000, validFrom: fromToday(-60), validTo: fromToday(305) },
    { shipperId: null, origin: 'Pune', destination: 'Hyderabad', truckType: '20ft SXL', rate: 37000, bandPct: 7, tripCost: 33000, validFrom: fromToday(-30), validTo: fromToday(335) },
    { shipperId: sunriseId, origin: 'Chennai', destination: 'Vijayawada', truckType: '20ft SXL', rate: 36500, bandPct: 5, tripCost: 32500, validFrom: fromToday(-10), validTo: fromToday(170) },
    // Ended last month: kept for history, never used for quotes.
    { shipperId: sunriseId, origin: 'Chennai', destination: 'Madurai', truckType: '14ft', rate: 16000, bandPct: 5, tripCost: null, validFrom: fromToday(-400), validTo: fromToday(-35) },
  ];
  for (const r of rates) {
    const key = { carrierId: kaveriId, shipperId: r.shipperId, origin: r.origin, destination: r.destination, truckType: r.truckType };
    const data = { ...key, rate: new Prisma.Decimal(r.rate), bandPct: new Prisma.Decimal(r.bandPct), tripCost: r.tripCost != null ? new Prisma.Decimal(r.tripCost) : null, validFrom: r.validFrom, validTo: r.validTo };
    const existing = await prisma.carrierRate.findFirst({ where: key });
    if (existing) await prisma.carrierRate.update({ where: { id: existing.id }, data });
    else await prisma.carrierRate.create({ data });
  }

  await prisma.company.update({
    where: { id: kaveriId },
    data: {
      address: '14, Transport Nagar, Madhavaram, Chennai 600110',
      gstin: '33AAKFK1234M1Z8', pan: 'AAKFK1234M', gstOption: 'RCM', tdsDeclared: true, tdsDeclaredAt: new Date(),
      bankAccountName: 'Kaveri Roadlines', bankAccountNo: '50200012345678', bankIfsc: 'HDFC0001234',
    },
  });
  // LRs up to KR-000481 already issued (design shows KR-000482 next), so the prefix is locked.
  await prisma.lrSeries.upsert({ where: { carrierId: kaveriId }, update: {}, create: { carrierId: kaveriId, prefix: 'KR', nextNumber: 482 } });
}

async function main() {
  const sunrise = await company('Sunrise Foods Pvt Ltd', 'SHIPPER');
  const coastal = await company('Coastal Paints', 'SHIPPER');
  // Carriers number their own LRs; any old shipper-keyed series rows are removed.
  await prisma.lrSeries.deleteMany({ where: { carrierId: { in: [sunrise.id, coastal.id] } } });
  const kaveri = await company('Kaveri Roadlines', 'CARRIER', '+919800000101');
  const northstar = await company('NorthStar Logistics', 'CARRIER', '+919800000102');
  const deccan = await company('Deccan Freight Carriers', 'CARRIER', '+919800000103');
  const sai = await company('Sai Ganesh Transport', 'CARRIER', '+919800000104');
  for (const [c, prefix] of [[northstar, 'NSL'], [deccan, 'DFC'], [sai, 'SGT']] as const) {
    await prisma.lrSeries.upsert({ where: { carrierId: c.id }, update: {}, create: { carrierId: c.id, prefix } });
  }

  await user(sunrise.id, 'anita@sunrisefoods.test', 'Anita Rao', 'LOGISTICS_HEAD', 'Shipper@123', { phone: '+919800000001', approvalLimit: 200000 });
  await user(sunrise.id, 'karthik@sunrisefoods.test', 'Karthik S', 'BOOKING_EXECUTIVE', 'Shipper@123', { phone: '+919800000002' });
  await user(sunrise.id, 'priya@sunrisefoods.test', 'Priya Nair', 'APPROVER', 'Shipper@123', { phone: '+919800000003', approvalLimit: 40000 });
  await user(sunrise.id, 'inactive@sunrisefoods.test', 'Former Employee', 'BOOKING_EXECUTIVE', 'Shipper@123', { isActive: false });
  await user(coastal.id, 'meera@coastalpaints.test', 'Meera Pillai', 'LOGISTICS_HEAD', 'Shipper@123', { phone: '+919800000201', approvalLimit: 100000 });
  await user(kaveri.id, 'vijay@kaveri.test', 'Vijay Kumar', 'OWNER', 'Carrier@123', { phone: '+919800000101', roles: ['TRAFFIC_MANAGER'] });
  await user(kaveri.id, 'divya@kaveri.test', 'Divya R', 'TRAFFIC_MANAGER', 'Carrier@123', { phone: '+919800000111' });
  await user(kaveri.id, 'suresh@kaveri.test', 'Suresh M', 'ACCOUNTS', 'Carrier@123', { phone: '+919800000112' });
  await user(kaveri.id, 'inactive@kaveri.test', 'Former Driver Desk', 'TRAFFIC_MANAGER', 'Carrier@123', { isActive: false });
  await user(northstar.id, 'arjun@northstar.test', 'Arjun Mehta', 'OWNER', 'Carrier@123', { phone: '+919800000102' });

  await address(sunrise.id, { name: 'Ambattur DC', city: 'Chennai', line1: 'Plot 14, SIDCO Industrial Estate, Ambattur', kind: 'PICKUP', contactName: 'Selvam', contactPhone: '+919400000010', hours: '08:00–20:00' });
  await address(sunrise.id, { name: 'Hosur Plant', city: 'Bengaluru', line1: 'SIPCOT Phase 2, Hosur Road', kind: 'BOTH', contactName: 'Gate office', contactPhone: '+918000000055', hours: '24 h' });
  await address(sunrise.id, { name: 'Chakan Warehouse', city: 'Pune', line1: 'Gat 112, Chakan MIDC', kind: 'PICKUP', contactName: 'Prakash', contactPhone: '+919400000020' });
  await address(sunrise.id, { name: 'Medchal DC', city: 'Hyderabad', line1: 'Survey 45, Medchal Industrial Area', kind: 'DROP', contactName: 'Ravi', contactPhone: '+919400000030' });
  await address(coastal.id, { name: 'Kochi Depot', city: 'Kochi', line1: 'Kalamassery Industrial Area', kind: 'BOTH' });

  // Carrier master: each shipper's own record of the carriers it works with.
  await listCarrier(sunrise.id, kaveri.id, { contactName: 'Vijay Kumar', contactPhone: '+919800000101', email: 'ops@kaveri.test', city: 'Chennai', address: '12, Transport Nagar, Madhavaram', gstin: '33AABCK1234F1Z5', pan: 'AABCK1234F' });
  await listCarrier(sunrise.id, northstar.id, { contactName: 'Imran Shaikh', contactPhone: '+919800000112', email: 'bookings@northstar.test', city: 'Bengaluru', gstin: '29AACCN5678K1Z2' });
  await listCarrier(sunrise.id, deccan.id, { contactName: 'Ramesh Goud', contactPhone: '+919800000113', city: 'Hyderabad', notes: 'Slow with PODs; follow up after delivery.' });
  await listCarrier(sunrise.id, sai.id, { contactName: 'Ganesh Pawar', city: 'Pune' });
  await listCarrier(coastal.id, deccan.id, { contactName: 'Ramesh Goud', contactPhone: '+919800000113', city: 'Hyderabad' });

  await lane(sunrise.id, 'Chennai', 'Bengaluru', '32ft MXL', 'ASK', [kaveri.id, northstar.id, deccan.id, sai.id]);
  await lane(sunrise.id, 'Pune', 'Hyderabad', '20ft SXL', 'AUTO_LOWEST', [kaveri.id, northstar.id]);
  await lane(coastal.id, 'Kochi', 'Coimbatore', '19ft', 'ASK', [deccan.id]);

  // Agreed rates (₹ per trip, detention ₹ per day, transit days). Sai Ganesh has no rate card yet.
  await rateCard(sunrise.id, kaveri.id, null, [
    ['Chennai', 'Bengaluru', '32ft MXL', 44500, 1500, 1],
    ['Pune', 'Hyderabad', '20ft SXL', 38500, 1200, 2],
  ]);
  await rateCard(sunrise.id, northstar.id, null, [
    ['Chennai', 'Bengaluru', '32ft MXL', 45200, 1500, 1],
    ['Pune', 'Hyderabad', '20ft SXL', 39000, null, 2],
  ]);
  await rateCard(sunrise.id, deccan.id, null, [['Chennai', 'Bengaluru', '32ft MXL', 43800, 1000, 2]]);
  await rateCard(coastal.id, deccan.id, null, [['Kochi', 'Coimbatore', '19ft', 21000, 800, 1]]);

  // Track records (owned by the carrier/tracking modules later). Sai Ganesh, Velan etc. invited later have none.
  const perf = [
    [kaveri.id, 22, 96, 1.2, 91],
    [northstar.id, 15, 93, 1.8, 88],
    [deccan.id, 13, 84, 3.5, 79],
    [sai.id, 14, 90, 2.1, 85],
  ] as const;
  for (const [carrierId, trips, onTimePct, podDays, acceptPct] of perf) {
    const data = { trips, onTimePct, podDays: new Prisma.Decimal(podDays), acceptPct };
    await prisma.carrierPerformance.upsert({ where: { carrierId }, update: data, create: { carrierId, ...data } });
  }

  for (const c of [sunrise, coastal]) {
    await prisma.shipperPolicy.upsert({
      where: { companyId: c.id },
      update: {},
      create: { companyId: c.id, autonomy: DEFAULT_AUTONOMY },
    });
  }

  await carrierFleetAndRates(kaveri.id, northstar.id, sunrise.id);

  for (const c of [kaveri, northstar, deccan, sai]) {
    await prisma.carrierPolicy.upsert({ where: { companyId: c.id }, update: {}, create: { companyId: c.id, autonomy: DEFAULT_CARRIER_AUTONOMY } });
  }

  console.log('Seed complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
