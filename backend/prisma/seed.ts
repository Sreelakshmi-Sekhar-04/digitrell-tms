/**
 * Development and test seed. Safe to re-run: it upserts by email / company name.
 *
 * Test logins (local development and Playwright only; never use in production):
 *   anita@sunrisefoods.test   / Shipper@123   Logistics head (approver), Sunrise Foods (shipper)
 *   karthik@sunrisefoods.test / Shipper@123   Booking executive, Sunrise Foods (shipper)
 *   vijay@kaveri.test         / Carrier@123   Owner, Kaveri Roadlines (carrier) — used to test shipper-only access
 *   inactive@sunrisefoods.test/ Shipper@123   Deactivated user — login must fail
 */
import 'dotenv/config';
import { PrismaClient, CompanyType } from '@prisma/client';
import { hashPassword } from '../src/lib/password';

const prisma = new PrismaClient();

async function company(name: string, type: CompanyType) {
  const existing = await prisma.company.findFirst({ where: { name } });
  return existing ?? prisma.company.create({ data: { name, type } });
}

async function user(companyId: string, email: string, name: string, role: string, password: string, extra: { phone?: string; isActive?: boolean } = {}) {
  const passwordHash = await hashPassword(password);
  return prisma.user.upsert({
    where: { email },
    update: { name, role, companyId, passwordHash, isActive: extra.isActive ?? true },
    create: { email, name, role, companyId, passwordHash, phone: extra.phone, isActive: extra.isActive ?? true },
  });
}

async function main() {
  const sunrise = await company('Sunrise Foods Pvt Ltd', 'SHIPPER');
  const kaveri = await company('Kaveri Roadlines', 'CARRIER');

  await user(sunrise.id, 'anita@sunrisefoods.test', 'Anita Rao', 'LOGISTICS_HEAD', 'Shipper@123', { phone: '+919800000001' });
  await user(sunrise.id, 'karthik@sunrisefoods.test', 'Karthik S', 'BOOKING_EXECUTIVE', 'Shipper@123', { phone: '+919800000002' });
  await user(sunrise.id, 'inactive@sunrisefoods.test', 'Former Employee', 'BOOKING_EXECUTIVE', 'Shipper@123', { isActive: false });
  await user(kaveri.id, 'vijay@kaveri.test', 'Vijay Kumar', 'OWNER', 'Carrier@123', { phone: '+919800000101' });

  console.log('Seed complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
