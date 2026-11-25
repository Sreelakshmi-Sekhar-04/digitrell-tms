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

async function lane(shipperId: string, origin: string, destination: string, truckType: string, budget: number, awardRule: string, carrierIds: string[]) {
  const l = await prisma.lane.upsert({
    where: { shipperId_origin_destination_truckType: { shipperId, origin, destination, truckType } },
    update: { budget: new Prisma.Decimal(budget), awardRule },
    create: { shipperId, origin, destination, truckType, budget: new Prisma.Decimal(budget), awardRule },
  });
  await prisma.laneCarrier.deleteMany({ where: { laneId: l.id } });
  await prisma.laneCarrier.createMany({ data: carrierIds.map((carrierId) => ({ laneId: l.id, carrierId })) });
  return l;
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

  await lane(sunrise.id, 'Chennai', 'Bengaluru', '32ft MXL', 46000, 'ASK', [kaveri.id, northstar.id, deccan.id, sai.id]);
  await lane(sunrise.id, 'Pune', 'Hyderabad', '20ft SXL', 40000, 'AUTO_LOWEST', [kaveri.id, northstar.id]);
  await lane(coastal.id, 'Kochi', 'Coimbatore', '19ft', 22000, 'ASK', [deccan.id]);

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
