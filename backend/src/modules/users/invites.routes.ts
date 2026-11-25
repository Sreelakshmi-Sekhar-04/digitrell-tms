import { Router } from 'express';
import { prisma } from '../../lib/prisma';
import { asyncHandler, badRequest, notFound } from '../../lib/errors';
import { hashPassword, newSessionToken } from '../../lib/password';
import { audit } from '../../lib/audit';
import { sessionUser } from '../../middleware/auth';

/** Public: an invited user opens their one-time link and sets a password. */
export const invitesRouter = Router();

async function findInvite(token: string) {
  const user = await prisma.user.findUnique({ where: { inviteToken: token }, include: { company: true } });
  if (!user || !user.isActive || !user.inviteExpiresAt || user.inviteExpiresAt < new Date()) {
    throw notFound('This invite link has expired or was already used. Ask your logistics head for a new one.');
  }
  return user;
}

invitesRouter.get(
  '/:token',
  asyncHandler(async (req, res) => {
    const u = await findInvite(req.params.token);
    res.json({ invite: { name: u.name, email: u.email, companyName: u.company.name, role: u.role } });
  }),
);

invitesRouter.post(
  '/:token',
  asyncHandler(async (req, res) => {
    const u = await findInvite(req.params.token);
    const password = String(req.body?.password ?? '');
    if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
      throw badRequest('Please fix the highlighted fields.', { password: 'Use at least 8 characters with a letter and a number.' });
    }
    if (!u.email) throw badRequest('Your invite has no email for web sign-in. Ask your logistics head to add one.');
    const token = newSessionToken();
    await prisma.$transaction([
      prisma.user.update({ where: { id: u.id }, data: { passwordHash: await hashPassword(password), inviteToken: null, inviteExpiresAt: null } }),
      prisma.session.create({ data: { token, userId: u.id, expiresAt: new Date(Date.now() + 12 * 3600_000) } }),
    ]);
    await audit(u.id, 'INVITE_ACCEPTED');
    res.json({
      token,
      user: sessionUser(u),
    });
  }),
);
