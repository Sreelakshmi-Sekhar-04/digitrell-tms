import { Router } from 'express';
import { Prisma, type User } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { asyncHandler, badRequest, conflict, notFound } from '../../lib/errors';
import { Validator, toNumber } from '../../lib/validate';
import { audit } from '../../lib/audit';
import { newSessionToken } from '../../lib/password';
import { requireRole } from '../../middleware/auth';
import { CHANNELS, LANGUAGES, ROLES_WITH_LIMIT, SHIPPER_ROLES, type ShipperRole } from '../../shared/masters';

export const usersRouter = Router();
const INVITE_DAYS = 7;

const view = (u: User) => ({
  id: u.id, name: u.name, email: u.email, phone: u.phone, role: u.role,
  approvalLimit: toNumber(u.approvalLimit), language: u.language, channel: u.channel, isActive: u.isActive,
  status: !u.isActive ? 'INACTIVE' : u.passwordHash ? 'ACTIVE' : 'INVITED',
});

const newInvite = () => ({ inviteToken: newSessionToken(), inviteExpiresAt: new Date(Date.now() + INVITE_DAYS * 86400_000) });

/**
 * Role and approval limit go together: approver roles need a limit, booking executives have none,
 * and nobody can grant a limit above the inviting user's own.
 */
function checkRoleAndLimit(v: Validator, role: ShipperRole | null, limit: number | null, actorLimit: number | null) {
  if (!role) return;
  if (ROLES_WITH_LIMIT.includes(role) && limit == null) v.fail('approvalLimit', 'Set how much this person can approve in one decision.');
  if (role === 'BOOKING_EXECUTIVE' && limit != null) v.fail('approvalLimit', 'Booking executives cannot approve, so they have no limit.');
  if (limit != null && actorLimit != null && limit > actorLimit) {
    v.fail('approvalLimit', `You can grant up to your own limit, ₹${actorLimit.toLocaleString('en-IN')}.`);
  }
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

usersRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const users = await prisma.user.findMany({ where: { companyId: req.user!.companyId }, orderBy: [{ isActive: 'desc' }, { name: 'asc' }] });
    res.json({ users: users.map(view) });
  }),
);

usersRouter.post(
  '/',
  requireRole('LOGISTICS_HEAD'),
  asyncHandler(async (req, res) => {
    const actor = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
    const v = new Validator(req.body);
    const name = v.text('name', 'their name', { required: true, max: 80 });
    const phone = v.phone('phone', 'their mobile', { required: true });
    const email = v.email('email', 'their email');
    const role = v.oneOf('role', 'a role', SHIPPER_ROLES);
    const approvalLimit = v.money('approvalLimit', 'the approval limit');
    const language = v.oneOf('language', 'a language', LANGUAGES, { required: false }) ?? 'en';
    const channel = v.oneOf('channel', 'how they get messages', CHANNELS, { required: false }) ?? 'whatsapp';
    checkRoleAndLimit(v, role, approvalLimit, toNumber(actor.approvalLimit));
    v.done();
    await assertUniqueContact(email, phone);
    const user = await prisma.user.create({
      data: {
        companyId: req.user!.companyId, name: name!, phone, email, role: role!, language, channel,
        approvalLimit: approvalLimit != null ? new Prisma.Decimal(approvalLimit) : null, ...newInvite(),
      },
    });
    await audit(req.user!.id, 'USER_INVITED', { id: user.id, role: user.role, approvalLimit });
    res.status(201).json({ user: view(user), invitePath: `/invite/${user.inviteToken}` });
  }),
);

usersRouter.patch(
  '/:id',
  requireRole('LOGISTICS_HEAD'),
  asyncHandler(async (req, res) => {
    const target = await prisma.user.findFirst({ where: { id: req.params.id, companyId: req.user!.companyId } });
    if (!target) throw notFound('That user no longer exists.');
    const actor = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
    const self = target.id === actor.id;
    const v = new Validator(req.body);
    const data: Prisma.UserUpdateInput = {};
    if (v.has('name')) data.name = v.text('name', 'their name', { required: true, max: 80 })!;
    if (v.has('phone')) data.phone = v.phone('phone', 'their mobile', { required: true });
    if (v.has('email')) data.email = v.email('email', 'their email');
    if (v.has('language')) data.language = v.oneOf('language', 'a language', LANGUAGES)!;
    if (v.has('channel')) data.channel = v.oneOf('channel', 'how they get messages', CHANNELS)!;
    const role = v.has('role') ? v.oneOf('role', 'a role', SHIPPER_ROLES) : (target.role as ShipperRole);
    const limit = v.has('approvalLimit') ? v.money('approvalLimit', 'the approval limit') : toNumber(target.approvalLimit);
    if (v.has('role') || v.has('approvalLimit')) {
      // Your own limit can stay as it is; only changes are capped at your own limit.
      checkRoleAndLimit(v, role, limit, self ? null : toNumber(actor.approvalLimit));
      data.role = role!;
      data.approvalLimit = limit != null ? new Prisma.Decimal(limit) : null;
    }
    if (v.has('isActive')) data.isActive = Boolean(req.body.isActive);
    // Guard against locking the company out of its own settings.
    if (self && (data.isActive === false || (data.role && data.role !== 'LOGISTICS_HEAD'))) {
      throw badRequest("You can't deactivate yourself or remove your own logistics head role. Ask another logistics head.");
    }
    v.done();
    await assertUniqueContact((data.email as string) ?? null, (data.phone as string) ?? null, target.id);
    const user = await prisma.user.update({ where: { id: target.id }, data });
    if (data.isActive === false) await prisma.session.deleteMany({ where: { userId: user.id } });
    await audit(req.user!.id, data.isActive === false ? 'USER_DEACTIVATED' : 'USER_UPDATED', { id: user.id, changes: Object.keys(data) });
    res.json({ user: view(user) });
  }),
);

usersRouter.post(
  '/:id/invite',
  requireRole('LOGISTICS_HEAD'),
  asyncHandler(async (req, res) => {
    const target = await prisma.user.findFirst({ where: { id: req.params.id, companyId: req.user!.companyId } });
    if (!target) throw notFound('That user no longer exists.');
    if (target.passwordHash) throw badRequest(`${target.name} has already joined.`);
    if (!target.isActive) throw badRequest(`${target.name} is deactivated. Reactivate them first.`);
    const user = await prisma.user.update({ where: { id: target.id }, data: newInvite() });
    await audit(req.user!.id, 'USER_REINVITED', { id: user.id });
    res.json({ user: view(user), invitePath: `/invite/${user.inviteToken}` });
  }),
);
