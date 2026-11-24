import { Router } from 'express';
import type { Address } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { asyncHandler, conflict, notFound } from '../../lib/errors';
import { Validator } from '../../lib/validate';
import { audit } from '../../lib/audit';
import { ADDRESS_KINDS } from '../../shared/masters';

// Booking executives can manage addresses too: they need them to book.
export const addressesRouter = Router();

const view = (a: Address) => ({
  id: a.id, name: a.name, city: a.city, line1: a.line1, kind: a.kind,
  contactName: a.contactName, contactPhone: a.contactPhone, hours: a.hours, isActive: a.isActive,
});

function readAddress(body: Record<string, unknown>, partial: boolean) {
  const v = new Validator(body);
  const req = !partial;
  const out: Record<string, unknown> = {};
  if (req || v.has('name')) out.name = v.text('name', 'a short name, like "Ambattur DC"', { required: true, max: 60 });
  if (req || v.has('city')) out.city = v.text('city', 'the city', { required: true, max: 60 });
  if (req || v.has('line1')) out.line1 = v.text('line1', 'the street address', { required: true, max: 200 });
  if (req || v.has('kind')) out.kind = v.oneOf('kind', 'whether it is a pickup, drop or both', ADDRESS_KINDS);
  if (req || v.has('contactName')) out.contactName = v.text('contactName', 'the contact name', { max: 60 });
  if (req || v.has('contactPhone')) out.contactPhone = v.phone('contactPhone', 'the contact mobile');
  if (req || v.has('hours')) out.hours = v.text('hours', 'the working hours', { max: 40 });
  if (v.has('isActive')) out.isActive = Boolean(body.isActive);
  v.done();
  return out;
}

async function assertUniqueName(companyId: string, name: unknown, exceptId?: string) {
  if (typeof name !== 'string') return;
  const dup = await prisma.address.findFirst({ where: { companyId, name: { equals: name, mode: 'insensitive' }, NOT: exceptId ? { id: exceptId } : undefined } });
  if (dup) throw conflict(`You already have an address called "${dup.name}".`, { name: 'This name is already used. Pick another or edit the existing one.' });
}

addressesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const includeInactive = req.query.includeInactive === 'true';
    const rows = await prisma.address.findMany({
      where: { companyId: req.user!.companyId, ...(includeInactive ? {} : { isActive: true }) },
      orderBy: [{ isActive: 'desc' }, { city: 'asc' }, { name: 'asc' }],
    });
    res.json({ addresses: rows.map(view) });
  }),
);

addressesRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const data = readAddress(req.body, false);
    await assertUniqueName(req.user!.companyId, data.name);
    const a = await prisma.address.create({ data: { ...(data as Omit<Address, 'id' | 'companyId' | 'createdAt' | 'updatedAt'>), companyId: req.user!.companyId } });
    await audit(req.user!.id, 'ADDRESS_CREATED', { id: a.id, name: a.name });
    res.status(201).json({ address: view(a) });
  }),
);

addressesRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const existing = await prisma.address.findFirst({ where: { id: req.params.id, companyId: req.user!.companyId } });
    if (!existing) throw notFound('That address no longer exists.');
    const data = readAddress(req.body, true);
    await assertUniqueName(req.user!.companyId, data.name, existing.id);
    const a = await prisma.address.update({ where: { id: existing.id }, data });
    await audit(req.user!.id, 'ADDRESS_UPDATED', { id: a.id, changes: Object.keys(data) });
    res.json({ address: view(a) });
  }),
);
