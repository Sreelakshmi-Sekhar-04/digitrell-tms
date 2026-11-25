import { Router, type Response } from 'express';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { asyncHandler } from '../../lib/errors';
import { toNumber } from '../../lib/validate';
import { listApprovals } from '../approvals/approvals.routes';
import { getPolicy } from '../policies/policies.routes';
import { tripInclude } from '../trips/tender.service';
import { tripSummary } from '../trips/trip.view';

/** Home dashboard and Reports (BRD §3.1 Reports: spend vs budget, on-time, POD speed, carrier scorecards). */
export const insightsRouter = Router();

const DAY = 86400_000;
const IST = 5.5 * 3600_000;

/** Start of the current/previous calendar month in India, as UTC instants. */
function monthStart(offset: number) {
  const nowIst = new Date(Date.now() + IST);
  const d = new Date(Date.UTC(nowIst.getUTCFullYear(), nowIst.getUTCMonth() + offset, 1));
  return new Date(d.getTime() - IST);
}

export function periodOf(key: string) {
  if (key === 'last-month') {
    const from = monthStart(-1);
    const to = monthStart(0);
    return { key, from, to, label: new Date(from.getTime() + IST).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }) };
  }
  if (key === '90d') return { key, from: new Date(Date.now() - 90 * DAY), to: new Date(Date.now() + DAY), label: 'Last 90 days' };
  const from = monthStart(0);
  return { key: 'month', from, to: new Date(Date.now() + DAY), label: new Date(from.getTime() + IST).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }) };
}

const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : null);
/** Rounds half away from zero (−7.5 → −8, 7.5 → 8), unlike Math.round which rounds −7.5 to −7. */
const roundHalfAway = (x: number) => Math.sign(x) * Math.round(Math.abs(x));
const avg = (xs: number[]) => (xs.length ? roundHalfAway((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);

type T = Prisma.TripGetPayload<{ include: { lane: true; carrier: { select: { id: true; name: true } }; pickupAddress: true; dropAddress: true } }>;
const onTime = (t: T) => !!(t.deliveredAt && t.promisedEta && t.deliveredAt <= t.promisedEta);
const podDays = (t: T) => (t.deliveredAt && t.podAcceptedAt ? (t.podAcceptedAt.getTime() - t.deliveredAt.getTime()) / DAY : null);

/** All figures for one period, computed by fixed rules from the trip records. */
export async function metrics(shipperId: string, from: Date, to: Date) {
  const include = { lane: true, carrier: { select: { id: true, name: true } }, pickupAddress: true, dropAddress: true } as const;
  const [awarded, delivered, booked, claims] = await Promise.all([
    prisma.trip.findMany({ where: { shipperId, awardedAt: { gte: from, lt: to }, status: { not: 'CANCELLED' } }, include }),
    prisma.trip.findMany({ where: { shipperId, deliveredAt: { gte: from, lt: to } }, include }),
    prisma.trip.count({ where: { shipperId, createdAt: { gte: from, lt: to } } }),
    prisma.claim.findMany({ where: { trip: { shipperId }, createdAt: { gte: from, lt: to }, status: { not: 'WITHDRAWN' } } }),
  ]);
  const spend = awarded.reduce((s, t) => s + (toNumber(t.awardedAmount) ?? 0), 0);
  const withBudget = awarded.filter((t) => t.lane?.budget != null);
  const budget = withBudget.reduce((s, t) => s + toNumber(t.lane!.budget)!, 0);
  const measured = delivered.filter((t) => t.promisedEta);

  const lanes = new Map<string, { lane: string; trips: number; spend: number; budget: number }>();
  for (const t of awarded) {
    const key = `${t.pickupAddress?.city ?? t.lane?.origin} → ${t.dropAddress?.city ?? t.lane?.destination}`;
    const row = lanes.get(key) ?? { lane: key, trips: 0, spend: 0, budget: 0 };
    row.trips += 1;
    row.spend += toNumber(t.awardedAmount) ?? 0;
    row.budget += toNumber(t.lane?.budget) ?? 0;
    lanes.set(key, row);
  }

  const carriers = new Map<string, { carrier: string; trips: number; delivered: T[]; vsBudget: number[] }>();
  for (const t of awarded) {
    if (!t.carrier) continue;
    const row = carriers.get(t.carrier.id) ?? { carrier: t.carrier.name, trips: 0, delivered: [], vsBudget: [] };
    row.trips += 1;
    if (t.lane?.budget) row.vsBudget.push(((toNumber(t.awardedAmount)! - toNumber(t.lane.budget)!) / toNumber(t.lane.budget)!) * 100);
    carriers.set(t.carrier.id, row);
  }
  for (const t of delivered) {
    if (!t.carrier) continue;
    const row = carriers.get(t.carrier.id) ?? { carrier: t.carrier.name, trips: 0, delivered: [], vsBudget: [] };
    row.delivered.push(t);
    carriers.set(t.carrier.id, row);
  }

  return {
    kpis: {
      trips: booked,
      awarded: awarded.length,
      spend,
      budget: withBudget.length ? budget : null,
      delivered: delivered.length,
      onTimePct: pct(measured.filter(onTime).length, measured.length),
      avgPodDays: avg(delivered.map(podDays).filter((x): x is number => x != null)),
      claims: claims.length,
      claimValue: claims.reduce((s, c) => s + toNumber(c.amount)!, 0),
    },
    byLane: [...lanes.values()].sort((a, b) => b.spend - a.spend),
    scorecard: [...carriers.values()]
      .map((c) => {
        const m = c.delivered.filter((t) => t.promisedEta);
        return {
          carrier: c.carrier, trips: c.trips, delivered: c.delivered.length,
          onTimePct: pct(m.filter(onTime).length, m.length),
          avgPodDays: avg(c.delivered.map(podDays).filter((x): x is number => x != null)),
          vsBudgetPct: c.vsBudget.length ? roundHalfAway(avg(c.vsBudget)!) : null,
        };
      })
      .sort((a, b) => b.trips - a.trips),
  };
}

insightsRouter.get(
  '/dashboard',
  asyncHandler(async (req, res) => {
    const shipperId = req.user!.companyId;
    const [approvals, policy, laneCount, lanesWithCarriers, tripCount, active, m, podsPending] = await Promise.all([
      listApprovals(shipperId),
      getPolicy(shipperId),
      prisma.lane.count({ where: { shipperId, isActive: true } }),
      prisma.lane.count({ where: { shipperId, isActive: true, carriers: { some: {} } } }),
      prisma.trip.count({ where: { shipperId } }),
      prisma.trip.findMany({ where: { shipperId, status: { notIn: ['CLOSED', 'CANCELLED'] } }, include: tripInclude, orderBy: { updatedAt: 'desc' }, take: 5 }),
      metrics(shipperId, monthStart(0), new Date(Date.now() + DAY)),
      prisma.trip.count({ where: { shipperId, status: 'DELIVERED' } }),
    ]);
    const addresses = await prisma.address.count({ where: { companyId: shipperId, isActive: true } });
    const setup = [
      { id: 'addresses', title: 'Save your addresses', done: addresses > 0 },
      { id: 'lanes', title: 'Add your lanes', done: laneCount > 0 },
      { id: 'carriers', title: 'Approve carriers', done: lanesWithCarriers > 0 },
      { id: 'limits', title: 'Check approval limits', done: !!policy.updatedById },
      { id: 'booking', title: 'Book a truck', done: tripCount > 0 },
    ];
    res.json({
      firstTime: tripCount === 0,
      setup,
      approvals: approvals.slice(0, 3),
      approvalsCount: approvals.length,
      activeTrips: active.map((t) => tripSummary(t, policy.podRule)),
      month: { ...m.kpis, podsPending },
    });
  }),
);

insightsRouter.get(
  '/reports',
  asyncHandler(async (req, res) => {
    const p = periodOf(String(req.query.period ?? 'month'));
    const m = await metrics(req.user!.companyId, p.from, p.to);
    res.json({ period: { key: p.key, label: p.label, from: p.from, to: p.to }, ...m });
  }),
);

/** CSV with a header row; values quoted when needed. */
export function sendCsv(res: Response, filename: string, rows: (string | number | null)[][]) {
  const esc = (v: string | number | null) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send('﻿' + rows.map((r) => r.map(esc).join(',')).join('\r\n'));
}

insightsRouter.get(
  '/reports/trips.csv',
  asyncHandler(async (req, res) => {
    const p = periodOf(String(req.query.period ?? 'month'));
    const trips = await prisma.trip.findMany({
      where: { shipperId: req.user!.companyId, createdAt: { gte: p.from, lt: p.to } },
      include: { lane: true, carrier: true, pickupAddress: true, dropAddress: true, invoices: true },
      orderBy: { createdAt: 'asc' },
    });
    const d = (x: Date | null) => (x ? new Date(x.getTime() + IST).toISOString().slice(0, 16).replace('T', ' ') : '');
    sendCsv(res, `trips-${p.key}.csv`, [
      ['Trip', 'Booked (IST)', 'From', 'To', 'Truck type', 'Weight (t)', 'Status', 'Carrier', 'Awarded (INR)', 'Budget (INR)', 'Delivered (IST)', 'On time', 'Invoice', 'Invoice total (INR)', 'Paid (IST)'],
      ...trips.map((t) => {
        const inv = t.invoices.find((i) => i.status !== 'REPLACED');
        return [
          t.number, d(t.createdAt), t.pickupAddress?.city ?? '', t.dropAddress?.city ?? '', t.truckType, t.weightKg != null ? toNumber(t.weightKg)! / 1000 : null,
          t.status, t.carrier?.name ?? '', toNumber(t.awardedAmount), toNumber(t.lane?.budget), d(t.deliveredAt),
          t.deliveredAt && t.promisedEta ? (t.deliveredAt <= t.promisedEta ? 'Yes' : 'No') : '',
          inv?.number ?? '', inv ? toNumber(inv.total) : null, d(inv?.paidAt ?? null),
        ];
      }),
    ]);
  }),
);
