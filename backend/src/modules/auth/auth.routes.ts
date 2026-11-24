import { Router } from 'express';
import { prisma } from '../../lib/prisma';
import { asyncHandler, badRequest, unauthorized } from '../../lib/errors';
import { newSessionToken, verifyPassword } from '../../lib/password';
import { requireAuth } from '../../middleware/auth';

const SESSION_HOURS = 12;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const authRouter = Router();

authRouter.post(
  '/login',
  asyncHandler(async (req, res) => {
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    const password = String(req.body?.password ?? '');
    const fields: Record<string, string> = {};
    if (!email) fields.email = 'Enter your work email.';
    else if (!EMAIL_RE.test(email)) fields.email = 'Enter a valid email, like name@company.com.';
    if (!password) fields.password = 'Enter your password.';
    if (Object.keys(fields).length) throw badRequest('Please fix the highlighted fields.', fields);

    const user = await prisma.user.findUnique({ where: { email }, include: { company: true } });
    const ok = user && user.isActive && (await verifyPassword(password, user.passwordHash));
    // Same message for unknown email and wrong password, so emails can't be discovered.
    if (!user || !ok) throw unauthorized('Email or password is incorrect.');

    const token = newSessionToken();
    await prisma.session.create({ data: { token, userId: user.id, expiresAt: new Date(Date.now() + SESSION_HOURS * 3600_000) } });
    await prisma.auditLog.create({ data: { actor: user.id, action: 'LOGIN', data: { channel: 'web' } } });
    res.json({
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role, companyId: user.companyId, companyName: user.company.name, companyType: user.company.type },
    });
  }),
);

authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

authRouter.post(
  '/logout',
  requireAuth,
  asyncHandler(async (req, res) => {
    await prisma.session.deleteMany({ where: { token: req.sessionToken } });
    res.status(204).end();
  }),
);
