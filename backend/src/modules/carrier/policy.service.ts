import { prisma } from '../../lib/prisma';
import { DEFAULT_CARRIER_AUTONOMY } from '../../shared/carrier';

/** The carrier's policy row, created with defaults the first time it's needed. */
export async function getCarrierPolicy(companyId: string) {
  return (
    (await prisma.carrierPolicy.findUnique({ where: { companyId } })) ??
    prisma.carrierPolicy.create({ data: { companyId, autonomy: DEFAULT_CARRIER_AUTONOMY } })
  );
}
