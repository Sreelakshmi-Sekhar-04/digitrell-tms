import { Router } from 'express';
import { Prisma, type CarrierRate, type User } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { asyncHandler, badRequest, conflict, notFound } from '../../lib/errors';
import { Validator, toNumber } from '../../lib/validate';
import { audit } from '../../lib/audit';
import { newSessionToken } from '../../lib/password';
import { requireCarrierRole } from '../../middleware/auth';
import { LANGUAGES, TRUCK_TYPES } from '../../shared/masters';
import { CARRIER_ROLES, DEFAULT_CARRIER_AUTONOMY, GST_OPTIONS, rolesOf } from '../../shared/carrier';
import { getCarrierPolicy } from './policy.service';

/**
 * Carrier setup: rate cards, company profile, policies and users (carrier spec C3, §3.2).
 * Everyone in the carrier can view; only the owner changes these.
 */
export const setupRouter = Router();
const ownerOnly = requireCarrierRole(['OWNER'], 'Only the owner can change this. Ask them to make the change.');
const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const today = () => new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z');

// ---------- Shippers this carrier works for ----------

/** Shippers that approved this carrier on at least one lane (choices for a shipper-specific rate). */
async function myShippers(carrierId: string) {
  const rows = await prisma.laneCarrier.findMany({
    where: { carrierId },
    select: { lane: { select: { shipper: { select: { id: true, name: true } } } } },
  });
  const map = new Map(rows.map((r) => [r.lane.shipper.id, r.lane.shipper.name]));
  return [...map].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
}

setupRouter.get(
  '/shippers',
  asyncHandler(async (req, res) => {
    res.json({ shippers: await myShippers(req.user!.companyId) });
  }),
);

// ---------- Rate cards ----------

function rateView(r: CarrierRate, shippers: Map<string, string>) {
  const t = today().getTime();
  let status: 'INACTIVE' | 'EXPIRED' | 'UPCOMING' | 'ACTIVE';
  if (!r.isActive) status = 'INACTIVE';
  else if (r.validTo.getTime() < t) status = 'EXPIRED';
  else if (r.validFrom.getTime() > t) status = 'UPCOMING';
  else status = 'ACTIVE';
  const rate = toNumber(r.rate)!;
  const band = toNumber(r.bandPct)!;
  const cost = toNumber(r.tripCost);
  return {
    id: r.id,
    shipper: r.shipperId ? { id: r.shipperId, name: shippers.get(r.shipperId) ?? 'Unknown shipper' } : null,
    origin: r.origin, destination: r.destination, truckType: r.truckType,
    rate, bandPct: band, tripCost: cost,
    // Band shown on quote requests (fixed rule, rounded to the rupee).
    bandLow: Math.round(rate * (1 - band / 100)), bandHigh: Math.round(rate * (1 + band / 100)),
    marginPct: cost != null ? Math.round(((rate - cost) / rate) * 1000) / 10 : null,
    validFrom: iso(r.validFrom), validTo: iso(r.validTo), isActive: r.isActive, status,
  };
}

async function readRate(body: Record<string, unknown>, partial: boolean, carrierId: string, existing?: CarrierRate) {
  const v = new Validator(body);
  const req = !partial;
  const out: Prisma.CarrierRateUncheckedUpdateInput = {};
  if (req || v.has('shipperId')) {
    const id = body.shipperId ? String(body.shipperId) : null;
    if (id && !(await myShippers(carrierId)).some((s) => s.id === id)) v.fail('shipperId', 'Choose a shipper you work with, or "Any shipper".');
    out.shipperId = id;
  }
  if (req || v.has('origin')) out.origin = v.text('origin', 'the pickup city', { required: true, max: 60 })!;
  if (req || v.has('destination')) out.destination = v.text('destination', 'the drop city', { required: true, max: 60 })!;
  if (req || v.has('truckType')) out.truckType = v.oneOf('truckType', 'truck type', TRUCK_TYPES)!;
  const rate = req || v.has('rate') ? v.money('rate', 'the rate per trip', { required: true }) : toNumber(existing?.rate);
  if (req || v.has('rate')) out.rate = rate != null ? new Prisma.Decimal(rate) : undefined;
  if (req || v.has('bandPct')) out.bandPct = new Prisma.Decimal(v.decimal('bandPct', 'the band (%)', 0, 25) ?? 0);
  if (req || v.has('tripCost')) {
    const c = body.tripCost === '' || body.tripCost == null ? null : v.money('tripCost', 'the trip cost');
    if (c != null && rate != null && c >= rate) v.fail('tripCost', 'The trip cost should be below the rate, or the trip makes a loss.');
    out.tripCost = c != null ? new Prisma.Decimal(c) : null;
  }
  const from = req || v.has('validFrom') ? v.date('validFrom', 'the start date', { required: true }) : existing?.validFrom ?? null;
  const to = req || v.has('validTo') ? v.date('validTo', 'the end date', { required: true }) : existing?.validTo ?? null;
  if (req || v.has('validFrom')) out.validFrom = from ?? undefined;
  if (req || v.has('validTo')) out.validTo = to ?? undefined;
  if (from && to && to < from) v.fail('validTo', 'The end date must be on or after the start date.');
  if (v.has('isActive')) out.isActive = Boolean(body.isActive);
  if (out.origin && out.destination && String(out.origin).toLowerCase() === String(out.destination).toLowerCase()) {
    v.fail('destination', 'Pickup and drop cities must be different.');
  }
  v.done();
  return out;
}

/** Two active lines for the same shipper, lane and truck type may not cover the same dates. */
async function assertNoOverlap(carrierId: string, r: { shipperId: string | null; origin: string; destination: string; truckType: string; validFrom: Date; validTo: Date; isActive: boolean }, exceptId?: string) {
  if (!r.isActive) return;
  const clash = await prisma.carrierRate.findFirst({
    where: {
      carrierId, isActive: true, shipperId: r.shipperId, truckType: r.truckType,
      origin: { equals: r.origin, mode: 'insensitive' }, destination: { equals: r.destination, mode: 'insensitive' },
      validFrom: { lte: r.validTo }, validTo: { gte: r.validFrom },
      NOT: exceptId ? { id: exceptId } : undefined,
    },
  });
  if (clash) {
    throw conflict(`You already have a rate for this lane and truck from ${iso(clash.validFrom)} to ${iso(clash.validTo)}.`, {
      validFrom: 'These dates overlap another rate. End the old rate first or change the dates.',
    });
  }
}

const shipperMap = async (carrierId: string) => new Map((await myShippers(carrierId)).map((s) => [s.id, s.name]));

setupRouter.get(
  '/rate-cards',
  asyncHandler(async (req, res) => {
    const carrierId = req.user!.companyId;
    const includeInactive = req.query.includeInactive === 'true';
    const [rows, shippers] = await Promise.all([
      prisma.carrierRate.findMany({ where: { carrierId, ...(includeInactive ? {} : { isActive: true }) }, orderBy: [{ origin: 'asc' }, { destination: 'asc' }, { validFrom: 'desc' }] }),
      shipperMap(carrierId),
    ]);
    const order = { ACTIVE: 0, UPCOMING: 1, EXPIRED: 2, INACTIVE: 3 } as const;
    const list = rows.map((r) => rateView(r, shippers)).sort((a, b) => order[a.status] - order[b.status]);
    res.json({ rateCards: list });
  }),
);

setupRouter.post(
  '/rate-cards',
  ownerOnly,
  asyncHandler(async (req, res) => {
    const carrierId = req.user!.companyId;
    const data = (await readRate(req.body, false, carrierId)) as Prisma.CarrierRateUncheckedCreateInput;
    await assertNoOverlap(carrierId, { ...data, shipperId: data.shipperId ?? null, isActive: true, validFrom: data.validFrom as Date, validTo: data.validTo as Date });
    const r = await prisma.carrierRate.create({ data: { ...data, carrierId } });
    await audit(req.user!.id, 'RATE_CARD_ADDED', { id: r.id, lane: `${r.origin} → ${r.destination}`, rate: r.rate.toString() });
    res.status(201).json({ rateCard: rateView(r, await shipperMap(carrierId)) });
  }),
);

setupRouter.patch(
  '/rate-cards/:id',
  ownerOnly,
  asyncHandler(async (req, res) => {
    const carrierId = req.user!.companyId;
    const existing = await prisma.carrierRate.findFirst({ where: { id: req.params.id, carrierId } });
    if (!existing) throw notFound('That rate no longer exists.');
    const data = await readRate(req.body, true, carrierId, existing);
    const merged = { ...existing, ...data } as CarrierRate;
    await assertNoOverlap(carrierId, merged, existing.id);
    const r = await prisma.carrierRate.update({ where: { id: existing.id }, data });
    await audit(req.user!.id, data.isActive === false ? 'RATE_CARD_DEACTIVATED' : 'RATE_CARD_UPDATED', {
      id: r.id, changes: Object.keys(data), before: { rate: existing.rate.toString(), bandPct: existing.bandPct.toString(), validTo: iso(existing.validTo) },
    });
    res.json({ rateCard: rateView(r, await shipperMap(carrierId)) });
  }),
);

// ---------- Company profile ----------

async function profileView(companyId: string) {
  const c = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
  const missing = [
    !c.gstin && 'GSTIN', !c.pan && 'PAN', !c.gstOption && 'GST option', !c.bankAccountNo && 'bank account',
  ].filter(Boolean) as string[];
  return {
    name: c.name, phone: c.phone, address: c.address, gstin: c.gstin, pan: c.pan, gstOption: c.gstOption,
    tdsDeclared: c.tdsDeclared, tdsDeclaredAt: c.tdsDeclaredAt,
    bankAccountName: c.bankAccountName, bankAccountNo: c.bankAccountNo, bankIfsc: c.bankIfsc,
    missing,
  };
}

setupRouter.get(
  '/profile',
  asyncHandler(async (req, res) => {
    res.json({ profile: await profileView(req.user!.companyId) });
  }),
);

setupRouter.put(
  '/profile',
  ownerOnly,
  asyncHandler(async (req, res) => {
    const companyId = req.user!.companyId;
    const body = req.body ?? {};
    const v = new Validator(body);
    const data: Prisma.CompanyUpdateInput = {};
    if (v.has('address')) data.address = v.text('address', 'the registered address', { max: 200 });
    if (v.has('gstin')) {
      const g = v.text('gstin', 'the GSTIN', { max: 15 });
      const gstin = g ? g.toUpperCase().replace(/\s/g, '') : null;
      if (gstin && !/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gstin)) v.fail('gstin', 'Enter the 15-character GSTIN, e.g. 33ABCDE1234F1Z5.');
      data.gstin = gstin;
    }
    if (v.has('pan')) {
      const p = v.text('pan', 'the PAN', { max: 10 });
      const pan = p ? p.toUpperCase().replace(/\s/g, '') : null;
      if (pan && !/^[A-Z]{5}\d{4}[A-Z]$/.test(pan)) v.fail('pan', 'Enter the 10-character PAN, e.g. ABCDE1234F.');
      data.pan = pan;
    }
    // The PAN is part of the GSTIN (characters 3–12), so the two must agree.
    if (typeof data.gstin === 'string' && typeof data.pan === 'string' && !v.fields.gstin && !v.fields.pan && data.gstin.slice(2, 12) !== data.pan) {
      v.fail('pan', 'This PAN does not match the GSTIN (characters 3 to 12).');
    }
    if (v.has('gstOption')) data.gstOption = v.oneOf('gstOption', 'GST option', GST_OPTIONS, { required: false });
    if (v.has('tdsDeclared')) {
      data.tdsDeclared = Boolean(body.tdsDeclared);
      data.tdsDeclaredAt = data.tdsDeclared ? new Date() : null;
    }
    if (v.has('bankAccountName')) data.bankAccountName = v.text('bankAccountName', 'the account name', { max: 100 });
    if (v.has('bankAccountNo')) {
      const a = v.text('bankAccountNo', 'the account number', { max: 18 });
      const acc = a ? a.replace(/\s/g, '') : null;
      if (acc && !/^\d{9,18}$/.test(acc)) v.fail('bankAccountNo', 'Enter the account number: 9 to 18 digits.');
      data.bankAccountNo = acc;
    }
    if (v.has('bankIfsc')) {
      const i = v.text('bankIfsc', 'the IFSC', { max: 11 });
      const ifsc = i ? i.toUpperCase().replace(/\s/g, '') : null;
      if (ifsc && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) v.fail('bankIfsc', 'Enter the 11-character IFSC, e.g. HDFC0001234.');
      data.bankIfsc = ifsc;
    }
    if (data.bankAccountNo && !(data.bankIfsc ?? null) && !v.fields.bankIfsc) v.fail('bankIfsc', 'Enter the IFSC for this account.');
    if (data.tdsDeclared && !(data.pan ?? (await prisma.company.findUniqueOrThrow({ where: { id: companyId } })).pan)) {
      v.fail('tdsDeclared', 'The TDS declaration needs your PAN.');
    }

    v.done();

    await prisma.company.update({ where: { id: companyId }, data });
    await audit(req.user!.id, 'CARRIER_PROFILE_UPDATED', { changes: Object.keys(data) });
    res.json({ profile: await profileView(companyId) });
  }),
);

// ---------- LR series (the carrier numbers its own lorry receipts; the prefix and counter are locked once used) ----------

async function lrSeriesView(carrierId: string) {
  const s = await prisma.lrSeries.findUnique({ where: { carrierId } });
  if (!s) return null;
  const used = await prisma.document.count({ where: { kind: 'LR', trip: { carrierId } } });
  return { prefix: s.prefix, nextNumber: s.nextNumber, preview: `${s.prefix}-${String(s.nextNumber).padStart(6, '0')}`, inUse: used > 0 };
}

setupRouter.get(
  '/lr-series',
  asyncHandler(async (req, res) => {
    res.json({ lrSeries: await lrSeriesView(req.user!.companyId) });
  }),
);

setupRouter.put(
  '/lr-series',
  ownerOnly,
  asyncHandler(async (req, res) => {
    const carrierId = req.user!.companyId;
    const v = new Validator(req.body ?? {});
    const prefix = String(req.body?.prefix ?? '').trim().toUpperCase();
    if (!/^[A-Z0-9]{2,6}$/.test(prefix)) v.fail('prefix', 'Use 2 to 6 letters or digits, for example KR.');
    const rawNext = req.body?.nextNumber;
    const nextNumber = rawNext == null || rawNext === '' ? null : Number(rawNext);
    if (nextNumber != null && (!Number.isInteger(nextNumber) || nextNumber < 1 || nextNumber > 999999)) v.fail('nextNumber', 'Enter a whole number from 1 to 999999.');
    const cur = await lrSeriesView(carrierId);
    if (cur?.inUse && (cur.prefix !== prefix || (nextNumber != null && nextNumber !== cur.nextNumber))) {
      v.fail('prefix', 'LRs have been issued, so the series is locked. Numbers are never reused.');
    }
    v.done();
    await prisma.lrSeries.upsert({
      where: { carrierId },
      update: { prefix, ...(nextNumber != null ? { nextNumber } : {}) },
      create: { carrierId, prefix, nextNumber: nextNumber ?? 1 },
    });
    await audit(req.user!.id, 'LR_SERIES_SET', { prefix, nextNumber });
    res.json({ lrSeries: await lrSeriesView(carrierId) });
  }),
);

// ---------- Policies ----------

const AGENTS = ['quote', 'truckAssignment', 'documents', 'billing'] as const;
type Agent = (typeof AGENTS)[number];

async function policyView(companyId: string) {
  const p = await getCarrierPolicy(companyId);
  const approvers = await prisma.user.findMany({ where: { companyId, isActive: true }, orderBy: { name: 'asc' } });
  return {
    bandPct: toNumber(p.bandPct), marginFloorPct: toNumber(p.marginFloorPct), invoiceApprovalAbove: toNumber(p.invoiceApprovalAbove),
    backupApproverId: p.backupApproverId,
    autonomy: { ...DEFAULT_CARRIER_AUTONOMY, ...(p.autonomy as Record<string, number>) },
    approvers: approvers.map((u) => ({ id: u.id, name: u.name, roles: rolesOf(u) })),
    updatedAt: p.updatedAt,
  };
}

setupRouter.get(
  '/policies',
  asyncHandler(async (req, res) => {
    res.json({ policy: await policyView(req.user!.companyId) });
  }),
);

setupRouter.put(
  '/policies',
  ownerOnly,
  asyncHandler(async (req, res) => {
    const companyId = req.user!.companyId;
    const current = await getCarrierPolicy(companyId);
    const body = req.body ?? {};
    const v = new Validator(body);
    const data: Prisma.CarrierPolicyUncheckedUpdateInput = { updatedById: req.user!.id };
    if (v.has('bandPct')) data.bandPct = new Prisma.Decimal(v.decimal('bandPct', 'the rate band (%)', 0, 25) ?? 0);
    if (v.has('marginFloorPct')) data.marginFloorPct = new Prisma.Decimal(v.decimal('marginFloorPct', 'the margin floor (%)', 0, 50) ?? 0);
    if (v.has('invoiceApprovalAbove')) data.invoiceApprovalAbove = new Prisma.Decimal(v.money('invoiceApprovalAbove', 'the invoice approval limit', { required: true }) ?? 0);
    if (v.has('backupApproverId')) {
      const id = body.backupApproverId ? String(body.backupApproverId) : null;
      if (id && !(await prisma.user.findFirst({ where: { id, companyId, isActive: true } }))) v.fail('backupApproverId', 'Choose an active person in your company.');
      data.backupApproverId = id;
    }
    if (v.has('autonomy')) {
      const a = body.autonomy as Record<string, unknown>;
      const next: Record<Agent, number> = { ...DEFAULT_CARRIER_AUTONOMY, ...(current.autonomy as Record<Agent, number>) };
      if (!a || typeof a !== 'object') v.fail('autonomy', 'Choose a level for each agent.');
      else {
        for (const [k, lv] of Object.entries(a)) {
          if (!AGENTS.includes(k as Agent)) v.fail('autonomy', `Unknown agent "${k}".`);
          else if (![0, 1, 2].includes(Number(lv))) v.fail(`autonomy.${k}`, 'Choose suggest only, ask first or act within limits.');
          else next[k as Agent] = Number(lv);
        }
      }
      data.autonomy = next;
    }
    v.done();
    await prisma.carrierPolicy.update({ where: { companyId }, data });
    await audit(req.user!.id, 'CARRIER_POLICY_UPDATED', {
      changes: Object.keys(data).filter((k) => k !== 'updatedById'),
      before: { bandPct: current.bandPct.toString(), marginFloorPct: current.marginFloorPct.toString(), invoiceApprovalAbove: current.invoiceApprovalAbove.toString(), autonomy: current.autonomy as Prisma.InputJsonValue },
    });
    res.json({ policy: await policyView(companyId) });
  }),
);

// ---------- Users and roles ----------

const INVITE_DAYS = 7;
const newInvite = () => ({ inviteToken: newSessionToken(), inviteExpiresAt: new Date(Date.now() + INVITE_DAYS * 86400_000) });
const userView = (u: User) => ({
  id: u.id, name: u.name, email: u.email, phone: u.phone, roles: rolesOf(u), language: u.language,
  isActive: u.isActive, status: !u.isActive ? 'INACTIVE' : u.passwordHash ? 'ACTIVE' : 'INVITED',
});

function readRoles(v: Validator, raw: unknown): string[] | null {
  const list = Array.isArray(raw) ? raw.map(String) : [];
  const clean = CARRIER_ROLES.filter((r) => list.includes(r));
  if (!clean.length || clean.length !== new Set(list).size) {
    v.fail('roles', 'Choose at least one role: owner, traffic manager or accounts.');
    return null;
  }
  return clean;
}

async function assertUniqueContact(email: string | null, phone: string | null, exceptId?: string) {
  const or: Prisma.UserWhereInput[] = [];
  if (email) or.push({ email });
  if (phone) or.push({ phone });
  if (!or.length) return;
  const dup = await prisma.user.findFirst({ where: { OR: or, NOT: exceptId ? { id: exceptId } : undefined } });
  if (!dup) return;
  if (email && dup.email === email) throw conflict('Someone already uses this email on DigitRell.', { email: 'This email is already in use.' });
  throw conflict('Someone already uses this mobile number on DigitRell.', { phone: 'This mobile number is already in use.' });
}

setupRouter.get(
  '/users',
  asyncHandler(async (req, res) => {
    const users = await prisma.user.findMany({ where: { companyId: req.user!.companyId }, orderBy: [{ isActive: 'desc' }, { name: 'asc' }] });
    res.json({ users: users.map(userView) });
  }),
);

setupRouter.post(
  '/users',
  ownerOnly,
  asyncHandler(async (req, res) => {
    const v = new Validator(req.body);
    const name = v.text('name', 'their name', { required: true, max: 80 });
    const phone = v.phone('phone', 'their mobile', { required: true });
    const email = v.email('email', 'their email');
    const roles = readRoles(v, req.body?.roles);
    const language = v.oneOf('language', 'a language', LANGUAGES, { required: false }) ?? 'en';
    v.done();
    await assertUniqueContact(email, phone);
    const user = await prisma.user.create({
      data: { companyId: req.user!.companyId, name: name!, phone, email, role: roles![0], roles: roles!.slice(1), language, ...newInvite() },
    });
    await audit(req.user!.id, 'USER_INVITED', { id: user.id, roles: roles! });
    res.status(201).json({ user: userView(user), invitePath: `/invite/${user.inviteToken}` });
  }),
);

setupRouter.patch(
  '/users/:id',
  ownerOnly,
  asyncHandler(async (req, res) => {
    const companyId = req.user!.companyId;
    const target = await prisma.user.findFirst({ where: { id: req.params.id, companyId } });
    if (!target) throw notFound('That user no longer exists.');
    const self = target.id === req.user!.id;
    const v = new Validator(req.body);
    const data: Prisma.UserUpdateInput = {};
    if (v.has('name')) data.name = v.text('name', 'their name', { required: true, max: 80 })!;
    if (v.has('phone')) data.phone = v.phone('phone', 'their mobile', { required: true });
    if (v.has('email')) data.email = v.email('email', 'their email');
    if (v.has('language')) data.language = v.oneOf('language', 'a language', LANGUAGES)!;
    let roles = rolesOf(target);
    if (v.has('roles')) {
      const r = readRoles(v, req.body.roles);
      if (r) {
        roles = r;
        data.role = r[0];
        data.roles = r.slice(1);
      }
    }
    if (v.has('isActive')) data.isActive = Boolean(req.body.isActive);
    v.done();
    if (self && (data.isActive === false || !roles.includes('OWNER'))) {
      throw badRequest("You can't deactivate yourself or remove your own owner role. Ask another owner.");
    }
    // The company must always keep at least one active owner.
    const losesOwner = rolesOf(target).includes('OWNER') && target.isActive && (data.isActive === false || !roles.includes('OWNER'));
    if (losesOwner) {
      const owners = await prisma.user.findMany({ where: { companyId, isActive: true, NOT: { id: target.id } } });
      if (!owners.some((u) => rolesOf(u).includes('OWNER'))) throw badRequest('Your company needs at least one active owner.');
    }
    await assertUniqueContact((data.email as string) ?? null, (data.phone as string) ?? null, target.id);
    const user = await prisma.user.update({ where: { id: target.id }, data });
    if (data.isActive === false) await prisma.session.deleteMany({ where: { userId: user.id } });
    await audit(req.user!.id, data.isActive === false ? 'USER_DEACTIVATED' : 'USER_UPDATED', { id: user.id, changes: Object.keys(data), before: { roles: rolesOf(target) } });
    res.json({ user: userView(user) });
  }),
);
