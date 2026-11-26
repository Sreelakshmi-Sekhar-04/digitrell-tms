/**
 * Development and test seed. Safe to re-run: it upserts by email / company name / natural keys.
 *
 * Test logins (local development and Playwright only; never use in production):
 *   anita@sunrisefoods.test   / Shipper@123   Logistics head (approver, up to ₹2,00,000), Sunrise Foods (shipper)
 *   karthik@sunrisefoods.test / Shipper@123   Booking executive (cannot approve), Sunrise Foods (shipper)
 *   priya@sunrisefoods.test   / Shipper@123   Approver up to ₹40,000, Sunrise Foods (tests the approval limit)
 *   inactive@sunrisefoods.test/ Shipper@123   Deactivated user — login must fail
 *   meera@coastalpaints.test  / Shipper@123   Logistics head, Coastal Paints (a second shipper, for data-isolation tests)
 *   vijay@kaveri.test         / Carrier@123   Owner, Kaveri Roadlines (carrier) — used to test shipper-only access
 */
import 'dotenv/config';
import { PrismaClient, CompanyType, Prisma } from '@prisma/client';
import { hashPassword } from '../src/lib/password';
import { DEFAULT_AUTONOMY } from '../src/modules/policies/policy.defaults';

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
  extra: { phone?: string; isActive?: boolean; approvalLimit?: number } = {},
) {
  const passwordHash = await hashPassword(password);
  const data = {
    name, role, companyId, passwordHash,
    isActive: extra.isActive ?? true,
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

async function main() {
  const sunrise = await company('Sunrise Foods Pvt Ltd', 'SHIPPER');
  const coastal = await company('Coastal Paints', 'SHIPPER');
  const kaveri = await company('Kaveri Roadlines', 'CARRIER', '+919800000101');
  const northstar = await company('NorthStar Logistics', 'CARRIER', '+919800000102');
  const deccan = await company('Deccan Freight Carriers', 'CARRIER', '+919800000103');
  const sai = await company('Sai Ganesh Transport', 'CARRIER', '+919800000104');

  await user(sunrise.id, 'anita@sunrisefoods.test', 'Anita Rao', 'LOGISTICS_HEAD', 'Shipper@123', { phone: '+919800000001', approvalLimit: 200000 });
  await user(sunrise.id, 'karthik@sunrisefoods.test', 'Karthik S', 'BOOKING_EXECUTIVE', 'Shipper@123', { phone: '+919800000002' });
  await user(sunrise.id, 'priya@sunrisefoods.test', 'Priya Nair', 'APPROVER', 'Shipper@123', { phone: '+919800000003', approvalLimit: 40000 });
  await user(sunrise.id, 'inactive@sunrisefoods.test', 'Former Employee', 'BOOKING_EXECUTIVE', 'Shipper@123', { isActive: false });
  await user(coastal.id, 'meera@coastalpaints.test', 'Meera Pillai', 'LOGISTICS_HEAD', 'Shipper@123', { phone: '+919800000201', approvalLimit: 100000 });
  await user(kaveri.id, 'vijay@kaveri.test', 'Vijay Kumar', 'OWNER', 'Carrier@123', { phone: '+919800000101' });

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

  console.log('Seed complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
