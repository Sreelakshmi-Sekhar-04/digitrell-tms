import type { Prisma } from '@prisma/client';
import { prisma } from './prisma';

/** Every human decision and change is logged with who, what and why (BRD §6). */
export function audit(actor: string, action: string, data?: Prisma.InputJsonValue, extra: { tripId?: string; reason?: string } = {}) {
  return prisma.auditLog.create({ data: { actor, action, data, tripId: extra.tripId, reason: extra.reason } });
}
