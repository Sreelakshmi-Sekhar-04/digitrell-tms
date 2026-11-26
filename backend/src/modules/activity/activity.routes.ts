import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { asyncHandler } from '../../lib/errors';
import { ACTION_TEXT, AGENTS } from '../trips/trips.routes';
import { sendCsv } from '../insights/insights.routes';

/**
 * Read-only activity log for the shipper's company: every agent action and human decision
 * (BRD §6 "logged with who, when and why"). Entries can't be edited or deleted.
 */
export const activityRouter = Router();

const SETTINGS_TEXT: Record<string, (d: Record<string, unknown>) => string> = {
  POLICY_UPDATED: () => 'Policies changed',
  LANE_CREATED: (d) => `Lane ${d.lane} added`,
  LANE_UPDATED: (d) => `Lane updated${d.awardRule ? ` (award rule: ${d.awardRule === 'AUTO_LOWEST' ? 'automatic' : 'ask me'})` : ''}`,
  ADDRESS_CREATED: (d) => `Address ${d.name} added`,
  ADDRESS_UPDATED: () => 'Address updated',
  CARRIER_INVITED: (d) => `Carrier ${d.name} added`,
  USER_INVITED: (d) => `User invited as ${String(d.role).toLowerCase().replace(/_/g, ' ')}`,
  USER_UPDATED: () => 'User updated',
  USER_DEACTIVATED: () => 'User deactivated',
  USER_REINVITED: () => 'New invite link created',
  INVITE_ACCEPTED: () => 'Joined from an invite',
};
const TEXT = { ...ACTION_TEXT, ...SETTINGS_TEXT };

/** Filter groups shown in the "Action type" dropdown. */
const GROUPS: Record<string, string[]> = {
  decisions: ['AWARDED', 'AWARD_UNDONE', 'QUOTES_REJECTED', 'POD_ACCEPTED', 'FIX_APPROVED', 'FIX_REJECTED', 'INVOICE_APPROVED', 'INVOICE_QUERIED'],
  money: ['AWARDED', 'INVOICE_RECEIVED', 'INVOICE_APPROVED', 'INVOICE_QUERIED', 'INVOICE_PAID', 'CLAIM_RAISED', 'CLAIM_ACCEPTED', 'CLAIM_DISPUTED', 'CLAIM_WITHDRAWN'],
  changes: ['TRIP_CANCELLED', 'BOOKING_EDITED', 'DEADLINE_EXTENDED', 'CARRIERS_ADDED'],
  settings: Object.keys(SETTINGS_TEXT),
};
const PAGE = 50;

async function query(companyId: string, q: Record<string, unknown>) {
  const [trips, users] = await Promise.all([
    prisma.trip.findMany({ where: { shipperId: companyId }, select: { id: true, number: true } }),
    prisma.user.findMany({ where: { companyId }, select: { id: true, name: true } }),
  ]);
  const tripNo = new Map(trips.map((t) => [t.id, t.number]));
  const userName = new Map(users.map((u) => [u.id, u.name]));
  const text = String(q.q ?? '').trim().toUpperCase();
  const tripFilter = text ? trips.filter((t) => t.number.includes(text)).map((t) => t.id) : null;
  const who = String(q.who ?? 'all');
  const type = String(q.type ?? 'all');
  const days = Number(q.days ?? 7) || 7;

  const scope: Prisma.AuditLogWhereInput = {
    OR: [{ tripId: { in: tripFilter ?? trips.map((t) => t.id) } }, ...(tripFilter ? [] : [{ tripId: null, actor: { in: users.map((u) => u.id) } }])],
  };
  const where: Prisma.AuditLogWhereInput = {
    AND: [
      scope,
      { action: { not: 'LOGIN' } },
      { createdAt: { gte: new Date(Date.now() - days * 86400_000) } },
      ...(GROUPS[type] ? [{ action: { in: GROUPS[type] } }] : []),
      ...(who === 'people' ? [{ actor: { in: users.map((u) => u.id) } }] : who === 'agents' ? [{ actor: { notIn: users.map((u) => u.id) } }] : []),
    ],
  };
  const page = Math.max(1, Number(q.page ?? 1) || 1);
  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * PAGE, take: PAGE }),
    prisma.auditLog.count({ where }),
  ]);
  return {
    page, pageSize: PAGE, total,
    entries: rows.map((l) => {
      const d = (l.data ?? {}) as Record<string, unknown>;
      const person = userName.get(l.actor);
      return {
        id: l.id,
        at: l.createdAt,
        who: person ?? AGENTS[l.actor] ?? (l.actor.startsWith('carrier') ? 'Carrier' : 'System'),
        isPerson: !!person,
        action: l.action,
        text: (TEXT[l.action] ?? (() => l.action.toLowerCase().replace(/_/g, ' ')))(d),
        record: l.tripId ? tripNo.get(l.tripId) ?? null : null,
        tripId: l.tripId,
        reason: l.reason,
      };
    }),
  };
}

activityRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json(await query(req.user!.companyId, req.query));
  }),
);

activityRouter.get(
  '/export.csv',
  asyncHandler(async (req, res) => {
    const all = [];
    let page = 1;
    for (;;) {
      const r = await query(req.user!.companyId, { ...req.query, page });
      all.push(...r.entries);
      if (page * r.pageSize >= r.total || page >= 40) break;
      page += 1;
    }
    sendCsv(res, 'activity-log.csv', [
      ['Time (IST)', 'Who', 'Action', 'Record', 'Reason'],
      ...all.map((e) => [new Date(new Date(e.at).getTime() + 5.5 * 3600_000).toISOString().slice(0, 16).replace('T', ' '), e.who, e.text, e.record ?? '', e.reason ?? '']),
    ]);
  }),
);

